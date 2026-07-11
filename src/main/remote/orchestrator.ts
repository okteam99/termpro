// RemoteHostOrchestrator(main 进程 · TECH SSH-1)。
// 持有 Map<configId, RemoteHostSession>;connect() 主流程:
//   connecting → probe(node/uname) → residency 判定
//     ├ claim   → claiming → verifying → ready
//     └ 部署    → deploying → starting → verifying → ready
// 失败按 §错误处理表分类;per-configId in-flight guard(ARCH-B3)。
//
// 🔴 ARCH-B1 落地说明:main 侧 probeHostInfo 已完成「我方 + 版本兼容」的权威判定
// (verifying 事件本身就是探测通过后才 emit 的)。renderer 的二次握手确认是
// UX 层的额外保险(near-必成功),不是 main 状态机的必要输入——因此本编排器在
// emit verifying 后自主推进到 ready,不依赖任何 renderer→main 回馈信道
// (§接口表也确实未开这样的通道)。

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server as NetServer } from 'node:net';
import type {
  FailReason,
  HostArch,
  RemoteEvent,
  RemoteHostConfig,
  RemotePortFile,
  RemoteStage,
  TestResult,
} from '../../shared/remoteHost';
import type { ConnectSsh, SshAuth, SshConnectionLike } from './ssh';
import type { CredentialStore, HostConfigStore } from './credentialStore';
import { detectArch } from './hostBundle';
import { NODE_PROBE_COMMAND, pickBestNode } from './nodeProbe';
import { resolveResidency, type BuiltTunnel } from './residency';
import { deployBundle } from './deploy';
import { t } from '../../shared/i18n';
import { probeHostInfo as defaultProbeHostInfo, type ProbeResult } from './probeHostInfo';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_START_TIMEOUT_MS = 15_000;
const MIN_NODE_MAJOR = 20;
/** E9:disconnect() 等在途编排最长这么久,超时后仍强制收尾本地资源(不长阻塞调用方 IPC)。 */
const DISCONNECT_WAIT_TIMEOUT_MS = 5_000;
/** buildStartCommand 未显式传 allowedOrigins 时的兜底(与 host 侧 DEFAULT_ALLOWED_ORIGINS 同口径)。 */
const DEFAULT_ALLOWED_ORIGINS = 'null,file://';

// ---- 合法状态转移表(AC-5 · R2V-2 补 claiming→deploying / claiming→failed) ----

const LEGAL_TRANSITIONS: Record<RemoteStage, RemoteStage[]> = {
  idle: ['connecting'],
  connecting: ['deploying', 'claiming', 'failed'],
  deploying: ['starting', 'failed'],
  starting: ['verifying', 'failed'],
  // R2V-2:claiming→deploying(probe 失败同栈回退)· claiming→failed(回退中确定失败)
  claiming: ['verifying', 'deploying', 'failed'],
  verifying: ['ready', 'failed'],
  ready: ['disconnected'],
  failed: ['connecting'],
  disconnected: ['connecting'],
};

/** 纯函数:from===to(如 deploying 内多次进度事件)恒合法;否则查表。 */
export function isLegalTransition(from: RemoteStage, to: RemoteStage): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

const ACTIVE_STAGES = new Set<RemoteStage>([
  'connecting',
  'deploying',
  'starting',
  'claiming',
  'verifying',
  'ready',
]);

// ---- session ----------------------------------------------------------------

interface RemoteHostSession {
  configId: string;
  stage: RemoteStage;
  ssh: SshConnectionLike | null;
  forwardServer: NetServer | null;
  localPort: number | null;
  token: string | null;
  remotePid: number | null;
}

export type ProbeHostInfoLike = (localPort: number, token: string) => Promise<ProbeResult>;

export interface OrchestratorDeps {
  /** 🔴 DI 接缝(ARCH-B10):生产传 SshConnection.connect,测试传桩。 */
  connectSsh: ConnectSsh;
  credentials: CredentialStore;
  configStore: HostConfigStore;
  /** 本地(应用侧)resources/host-bundles/<arch>/ 定位。 */
  bundleDir: (arch: HostArch) => string;
  appVersion: string;
  /** 测试注入替换 main 侧 host.info 探测(默认真实 probeHostInfo)。 */
  probeHostInfo?: ProbeHostInfoLike;
  sleep?: (ms: number) => Promise<void>;
  connectTimeoutMs?: number;
  startTimeoutMs?: number;
  /**
   * A6:注入远端 host 进程的 TERMPRO_ALLOWED_ORIGINS(逗号分隔,host.ts 侧已按此
   * 格式解析)。main.ts 按打包/dev 场景算出(打包=null,file://;dev 追加 vite
   * origin)。未传时退化为 DEFAULT_ALLOWED_ORIGINS(与本机 embedded host 的内建
   * 默认同口径)。
   */
  allowedOrigins?: string;
}

function tokenKey(configId: string): string {
  return `hosttoken:${configId}`;
}

function generateToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

function sanitizeDetail(err: unknown): string {
  // 🔴 零凭据明文:err.message 由 ssh2/本模块自身产出,不含密码/token(构造处已
  // 避免拼接凭据);此处仅统一转字符串,不做额外脱敏正则(过度脱敏会误伤主机名等
  // 排障必需信息)。
  return err instanceof Error ? err.message : String(err);
}

export function classifyConnectError(err: unknown): FailReason {
  const msg = sanitizeDetail(err).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (
    msg.includes('authentication') ||
    msg.includes('all configured authentication methods failed') ||
    msg.includes('permission denied')
  ) {
    return 'auth';
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('ehostunreach') ||
    msg.includes('enotfound') ||
    msg.includes('getaddrinfo') ||
    msg.includes('unreachable') ||
    msg.includes('enetunreach')
  ) {
    return 'unreachable';
  }
  return 'internal';
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function buildAuth(config: RemoteHostConfig, credentials: CredentialStore): SshAuth {
  if (config.authType === 'password') {
    const password = credentials.getSecret(`cred:${config.id}:password`) ?? undefined;
    return { username: config.username, password };
  }
  const passphrase = credentials.getSecret(`cred:${config.id}:passphrase`) ?? undefined;
  let privateKey: Buffer | undefined;
  if (config.privateKeyPath) {
    try {
      privateKey = fs.readFileSync(expandHome(config.privateKeyPath));
    } catch {
      privateKey = undefined;
    }
  }
  return { username: config.username, privateKey, passphrase };
}

/**
 * 启动命令(TECH SSH-4):`--host-tag` 显式 argv,路径全程绝对(ARCH-B9)。
 * 🔴 A7/E6:全部远端路径统一双引号包裹(防路径含空格/特殊字符破坏 shell 解析)。
 * 🔴 A6:注入 TERMPRO_ALLOWED_ORIGINS(host.ts 侧已实现按逗号分隔解析,见
 * host.ts:61-72)。
 * 🔴 darwin 远端修复:macOS 无 setsid(util-linux 专属),恒前缀 setsid 会
 * `command not found` 启动必败——`$s` 惯用式按远端实际有无 setsid 降级为裸
 * nohup。整条 sh -c 单引号包裹(内部无单引号),外层登录 shell 为 fish/csh
 * 时 `$s`/POSIX 语法也不会被错误解释。
 * 🔴 node 用 nodeProbe 解析出的【绝对路径】(非交互 PATH 常无 node,见
 * NODE_PROBE_COMMAND 注释);双引号/换行剥除防拼接破界。
 * 🔴 token 注入不可用 `后台进程 < /dev/stdin &`:sh 秒退后 sshd 随即拆会话
 *  stdin,经 SSH channel 晚到(甚至已缓冲)的 token 数据不会进入已后台化进程
 * ——远端 macOS sshd 实测必丢,host 读到空 token fail-closed 拒启(表现为
 * 「port file did not appear before timeout」)。必须先 `t=$(cat)` 同步收完
 *  stdin(阻塞到 execDetached half-close 的 EOF,保证 token 已落地),再经
 *  机内管道喂给 node。printf 为 POSIX sh 内建,token 不上 argv(ps 不可见)。
 */
export function buildStartCommand(opts: {
  dataDir: string;
  appVersion: string;
  configId: string;
  allowedOrigins?: string;
  /** 远端 node 绝对路径(nodeProbe 解析);缺省 'node' 仅供测试兜底,生产恒传。 */
  nodePath?: string;
}): string {
  const portFile = `${opts.dataDir}/hosts/${opts.configId}/host.port`;
  const logFile = `${opts.dataDir}/hosts/${opts.configId}/host.log`;
  const entry = `${opts.dataDir}/bundle/${opts.appVersion}/host.js`;
  const allowedOrigins = opts.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const nodeBin = (opts.nodePath ?? 'node').replace(/["'\r\n]/g, '');
  return (
    `sh -c 't=$(cat); s=; command -v setsid >/dev/null 2>&1 && s=setsid; ` +
    `printf %s "$t" | $s nohup env TERMPRO_HOST_DATA_DIR="${opts.dataDir}" ` +
    `TERMPRO_HOST_PORT_FILE="${portFile}" TERMPRO_ALLOWED_ORIGINS="${allowedOrigins}" ` +
    `"${nodeBin}" "${entry}" --listen 127.0.0.1:0 --token-stdin --host-tag "${opts.configId}" ` +
    `> "${logFile}" 2>&1 &'`
  );
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollPortFile(
  ssh: SshConnectionLike,
  filePath: string,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<RemotePortFile | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const buf = await ssh.sftpReadFile(filePath);
    if (buf) {
      try {
        const parsed = JSON.parse(buf.toString('utf8')) as Partial<RemotePortFile>;
        if (
          typeof parsed.port === 'number' &&
          typeof parsed.pid === 'number' &&
          typeof parsed.hostTag === 'string'
        ) {
          return { port: parsed.port, pid: parsed.pid, hostTag: parsed.hostTag };
        }
      } catch {
        /* 畸形内容:继续轮询(可能正在写入中) */
      }
    }
    if (Date.now() >= deadline) return null;
    await sleep(300);
  }
}

// ---- orchestrator -------------------------------------------------------------

export class RemoteHostOrchestrator {
  private readonly sessions = new Map<string, RemoteHostSession>();
  /**
   * 🔴 A4/E3 修复(两张表,语义不同,严禁合一):
   *  - `connectInflight`:仅 connect() 写入/读取,纯粹用来给「并发 connect() 打同一
   *    configId」去重复用同一个 Promise(ARCH-B3 本义)。
   *  - `mutex`:connect() 与 test() 都会写入,单纯用来把两者按到达顺序**串行化**
   *    (都触碰同一 configId 的 ssh/host.port,不能并发跑),但绝不允许一个操作
   *    的 Promise 被另一操作复用/顶替——旧实现只有一张共享 `inflight` map,
   *    connect() 命中 test() 的在途 Promise 时直接 `return existing`,导致
   *    connect() 的连接意图被静默丢弃(看似成功 resolve,实际从未进 runConnect);
   *    且 connect() 的 `finally` 无条件 delete 会误删 test() 刚写入的槽位。
   */
  private readonly connectInflight = new Map<string, Promise<void>>();
  private readonly mutex = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<(e: RemoteEvent) => void>();

  constructor(private readonly deps: OrchestratorDeps) {}

  connect(configId: string): Promise<void> {
    const existingConnect = this.connectInflight.get(configId);
    if (existingConnect) return existingConnect;

    const session = this.ensureSession(configId);
    if (ACTIVE_STAGES.has(session.stage)) {
      // 已在连接中或已就绪:不重复编排(ARCH-B3 语义扩展——不仅并发调用复用同一
      // Promise,处于活跃阶段时的新调用也是 no-op,由用户走 disconnect 再 connect)。
      return Promise.resolve();
    }

    const priorMutex = this.mutex.get(configId) ?? Promise.resolve();
    const promise: Promise<void> = priorMutex
      .catch(() => undefined)
      .then(() => this.runConnect(configId, session));
    const tracked = promise.finally(() => {
      if (this.connectInflight.get(configId) === tracked) this.connectInflight.delete(configId);
      if (this.mutex.get(configId) === tracked) this.mutex.delete(configId);
    });
    this.connectInflight.set(configId, tracked);
    this.mutex.set(configId, tracked);
    return tracked;
  }

  async disconnect(configId: string): Promise<void> {
    const pending = this.mutex.get(configId);
    if (pending) {
      // 🔴 E9:在途编排(部署/启动)不安全中断,best-effort 等它自然结束,但不能
      // 无界阻塞调用方(IPC handler)——超时后放弃等待,直接强制收尾本地资源
      // (net.Server/ssh 连接),在途编排的后续 ssh 调用会因连接已关而自然失败,
      // 由其自身 catch 分支收场(不会崩溃/悬挂)。
      await Promise.race([pending.catch(() => undefined), this.sleep(DISCONNECT_WAIT_TIMEOUT_MS)]);
    }
    const session = this.sessions.get(configId);
    if (!session) return;
    const wasActive = session.stage === 'ready' || session.stage === 'verifying';
    this.closeSessionTransport(session);
    if (wasActive) {
      this.safeEmit(configId, { stage: 'disconnected' });
    }
  }

  test(configId: string): Promise<TestResult> {
    const priorMutex = this.mutex.get(configId) ?? Promise.resolve();
    const promise: Promise<TestResult> = priorMutex
      .catch(() => undefined)
      .then(() => this.runTest(configId));
    const tracked = promise.finally(() => {
      if (this.mutex.get(configId) === tracked) this.mutex.delete(configId);
    });
    this.mutex.set(configId, tracked);
    return tracked;
  }

  onEvent(cb: (e: RemoteEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      this.closeSessionTransport(session);
    }
    this.sessions.clear();
    this.connectInflight.clear();
    this.mutex.clear();
    this.listeners.clear();
  }

  // ---- 内部 -------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? defaultSleep)(ms);
  }

  private ensureSession(configId: string): RemoteHostSession {
    let session = this.sessions.get(configId);
    if (!session) {
      session = {
        configId,
        stage: 'idle',
        ssh: null,
        forwardServer: null,
        localPort: null,
        token: null,
        remotePid: null,
      };
      this.sessions.set(configId, session);
    }
    return session;
  }

  private closeSessionTransport(session: RemoteHostSession): void {
    if (session.forwardServer) {
      try {
        session.forwardServer.close();
      } catch {
        /* 忽略:可能已关闭 */
      }
      session.forwardServer = null;
    }
    if (session.ssh) {
      try {
        session.ssh.close();
      } catch {
        /* 忽略 */
      }
      session.ssh = null;
    }
    session.localPort = null;
  }

  /** 校验 + 更新 stage + 广播(唯一改变 session.stage 的入口)。 */
  private emit(configId: string, partial: Omit<RemoteEvent, 'configId'>): void {
    const session = this.ensureSession(configId);
    if (!isLegalTransition(session.stage, partial.stage)) {
      throw new Error(
        `[remote] illegal stage transition for ${configId}: ${session.stage} -> ${partial.stage}`,
      );
    }
    session.stage = partial.stage;
    const event: RemoteEvent = { configId, ...partial };
    for (const cb of this.listeners) cb(event);
  }

  /** disconnect() 等收尾路径用:转移不合法时静默(本就是幂等收尾,不应抛给调用方)。 */
  private safeEmit(configId: string, partial: Omit<RemoteEvent, 'configId'>): void {
    try {
      this.emit(configId, partial);
    } catch {
      /* 幂等收尾:忽略非法边 */
    }
  }

  private failSession(configId: string, reason: FailReason, detail?: string): void {
    this.emit(configId, { stage: 'failed', reason, detail });
  }

  private buildTunnel(ssh: SshConnectionLike, remotePort: number): Promise<BuiltTunnel> {
    return new Promise((resolve, reject) => {
      let server: NetServer;
      try {
        server = ssh.forwardOut(0, remotePort);
      } catch (err) {
        reject(err);
        return;
      }
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        const localPort = addr && typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve({ server, localPort });
      };
      const onError = (err: Error) => {
        server.off('listening', onListening);
        reject(err);
      };
      server.once('listening', onListening);
      server.once('error', onError);
    });
  }

  /**
   * ready/verifying 态下检测到「断线」的唯一入口(本地转发 server 挂/SSH 连接层
   * close 都会调用此处)。收尾:关掉本地残留资源(隧道/ssh)+ emit disconnected。
   */
  private handleTransportDown(configId: string): void {
    const session = this.sessions.get(configId);
    if (!session) return;
    if (session.stage === 'ready' || session.stage === 'verifying') {
      this.closeSessionTransport(session);
      this.safeEmit(configId, { stage: 'disconnected' });
    }
  }

  /** 本地转发 net.Server 挂了(其自身 accept 循环出错/被动关闭)。 */
  private wireDisconnectWatcher(configId: string, server: NetServer): void {
    const handleDown = () => this.handleTransportDown(configId);
    server.on('close', handleDown);
    server.on('error', handleDown);
  }

  /**
   * 🔴 A2 修复(AC-12 缺口):本地转发 net.Server 只监听「本地 accept」层面的
   * 事件,SSH 连接本身在远端断线/网络中断时并不会让本地 server emit close/error
   * ——之前完全没有代码在监听底层 ssh2 Client 的 close/error,导致 ready 后
   * 真实断线永远探测不到。这里注册 ssh.onClose,在 SSH 连接层面断开时同样触发
   * handleTransportDown。
   *
   * 该回调也会在我们自己主动调用 ssh.close()(如 disconnect()/失败收尾路径)时
   * 触发——不需要额外去重:这些路径在调用 ssh.close() 之前都已经把 session.stage
   * 转出 ready/verifying(或马上会转),而 handleTransportDown 的守卫正是基于
   * 当前 stage 是否仍是 ready/verifying,天然幂等(见函数顶部注释的时序论证)。
   */
  private wireSshDisconnectWatcher(configId: string, ssh: SshConnectionLike): void {
    ssh.onClose(() => this.handleTransportDown(configId));
  }

  private async runTest(configId: string): Promise<TestResult> {
    const config = this.deps.configStore.get(configId);
    if (!config) return { ok: false, reason: 'internal', detail: 'config not found' };
    let ssh: SshConnectionLike;
    try {
      const auth = buildAuth(config, this.deps.credentials);
      ssh = await this.deps.connectSsh({
        host: config.host,
        port: config.port,
        auth,
        readyTimeoutMs: this.deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      });
    } catch (err) {
      return { ok: false, reason: classifyConnectError(err), detail: sanitizeDetail(err) };
    }
    // T-005:仅认证+可达,不部署不拉起——立即关闭,不触碰 sftp/exec/probe
    ssh.close();
    return { ok: true };
  }

  private async runConnect(configId: string, session: RemoteHostSession): Promise<void> {
    const config = this.deps.configStore.get(configId);
    if (!config) {
      this.failSession(configId, 'internal', 'config not found');
      return;
    }

    this.emit(configId, { stage: 'connecting' });

    let ssh: SshConnectionLike;
    try {
      const auth = buildAuth(config, this.deps.credentials);
      ssh = await this.deps.connectSsh({
        host: config.host,
        port: config.port,
        auth,
        readyTimeoutMs: this.deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      });
    } catch (err) {
      this.failSession(configId, classifyConnectError(err), sanitizeDetail(err));
      return;
    }
    session.ssh = ssh;
    this.wireSshDisconnectWatcher(configId, ssh);

    const probe = this.deps.probeHostInfo ?? defaultProbeHostInfo;
    const sleep = this.deps.sleep ?? defaultSleep;

    try {
      const homeRes = await ssh.exec('echo $HOME');
      const home = homeRes.stdout.trim();
      if (!home) {
        this.failSession(configId, 'internal', 'empty remote $HOME');
        ssh.close();
        return;
      }
      const dataDir = `${home}/.termpro-host`;

      // 🔴 探测不走裸 `node -v`(exec 通道是非交互 shell,nvm/fnm/Homebrew 装的
      // node 全在它 PATH 之外):NODE_PROBE_COMMAND 收集 PATH/login-shell/常见
      // 安装位置全部候选,TS 侧选最高 major;绝对路径贯穿到启动命令(见 nodeProbe.ts)。
      const nodeRes = await ssh.exec(NODE_PROBE_COMMAND);
      const nodeBest = pickBestNode(nodeRes.stdout);
      if (nodeBest === null) {
        this.failSession(configId, 'nodeMissing');
        ssh.close();
        return;
      }
      if (nodeBest.major < MIN_NODE_MAJOR) {
        this.failSession(
          configId,
          'nodeMissing',
          t('Found node {version} ({path}), but ≥ {major} is required', {
            version: nodeBest.version,
            path: nodeBest.path,
            major: MIN_NODE_MAJOR,
          }),
        );
        ssh.close();
        return;
      }

      const unameRes = await ssh.exec('uname -sm');
      const arch = detectArch(unameRes.stdout);
      if (arch === null) {
        this.failSession(configId, 'archUnsupported');
        ssh.close();
        return;
      }

      const storedToken = this.deps.credentials.getSecret(tokenKey(configId));

      const residency = await resolveResidency({
        ssh,
        dataDir,
        configId,
        appVersion: this.deps.appVersion,
        storedToken,
        probeHostInfo: (localPort, token) => probe(localPort, token),
        buildTunnel: (remotePort) => this.buildTunnel(ssh, remotePort),
        sleep,
      });

      if (residency.decision.action === 'claim') {
        const { tunnel } = residency.claimed!;
        session.forwardServer = tunnel.server;
        session.localPort = tunnel.localPort;
        // 🔴 EXT-B-2 确认:claim 复用 storedToken(host 进程本身没重启,它仍只认
        // 这个 token)——生成新 token(:590 generateToken())只发生在未认领的部署
        // 分支,claim 分支绝不换 token(否则收养瞬间就把自己踢出)。
        session.token = storedToken;
        session.remotePid = residency.portRaw?.pid ?? null;

        this.emit(configId, { stage: 'claiming', fastPath: true, arch });
        this.wireDisconnectWatcher(configId, tunnel.server);
        this.emit(configId, {
          stage: 'verifying',
          fastPath: true,
          arch,
          tunnel: { localPort: tunnel.localPort, token: storedToken! },
        });
        this.emit(configId, { stage: 'ready' });
        this.deps.configStore.touchLastUsed(configId);
        return;
      }

      // 未认领(reapThenDeploy / cleanStaleThenDeploy / freshDeploy):resolveResidency
      // 内部已完成 kill/清陈旧;此处统一走部署+启动分支。
      // 🔴 R2V-2:曾尝试过认领(候选条件成立、发起过 main 探测但失败)则先经 claiming
      // 态,claiming→deploying 是显式合法边(T-010b)——没尝试过认领(如首装无
      // portRaw)则直接 connecting→deploying,不途经 claiming。
      if (residency.attemptedClaim) {
        this.emit(configId, { stage: 'claiming', fastPath: true, arch });
      }
      this.emit(configId, { stage: 'deploying', percent: 0, arch });

      const localBundleDir = this.deps.bundleDir(arch);
      try {
        await deployBundle({
          ssh,
          dataDir,
          appVersion: this.deps.appVersion,
          localBundleDir,
          sleep,
          onProgress: (pct) => {
            // deploying 内多次进度事件:from===to 恒合法(isLegalTransition)
            this.emit(configId, { stage: 'deploying', percent: pct, arch });
          },
        });
      } catch (err) {
        this.failSession(configId, 'deployFailed', sanitizeDetail(err));
        ssh.close();
        return;
      }

      this.emit(configId, { stage: 'starting', arch });

      const newToken = generateToken();
      const hostDir = `${dataDir}/hosts/${configId}`;
      try {
        await ssh.exec(`mkdir -p "${hostDir}"`);
        await ssh.execDetached(
          buildStartCommand({
            dataDir,
            appVersion: this.deps.appVersion,
            configId,
            allowedOrigins: this.deps.allowedOrigins,
            nodePath: nodeBest.path,
          }),
          newToken,
        );
      } catch (err) {
        this.failSession(configId, 'startFailed', sanitizeDetail(err));
        ssh.close();
        return;
      }

      const portRaw = await pollPortFile(
        ssh,
        `${hostDir}/host.port`,
        this.deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS,
        sleep,
      );
      if (!portRaw) {
        // 超时主因之外,把远端 host.log 尾部拼进 detail(host 启动即崩时,崩因只落
        // 在这份被启动命令重定向的日志里,不捞回来 UI 只剩一句自说自话的 timeout)。
        let detail = 'port file did not appear before timeout';
        try {
          const log = await ssh.sftpReadFile(`${hostDir}/host.log`);
          const tail = log
            ?.toString('utf8')
            .trim()
            .split('\n')
            .slice(-3)
            .join(' | ')
            .slice(-400);
          if (tail) detail += ` · host.log: ${tail}`;
        } catch {
          /* 日志读取失败不掩盖超时主因 */
        }
        this.failSession(configId, 'startFailed', detail);
        ssh.close();
        return;
      }

      this.deps.credentials.setSecret(tokenKey(configId), newToken);

      const tunnel = await this.buildTunnel(ssh, portRaw.port);
      session.forwardServer = tunnel.server;
      session.localPort = tunnel.localPort;
      session.token = newToken;
      session.remotePid = portRaw.pid;

      const probeResult = await probe(tunnel.localPort, newToken);
      // 🔴 A14 修复:此前 !probeResult.ok(隧道时序/超时/被关等瞬时传输失败)与
      // probeResult.compatible===false(真·版本不符)被合并成同一个 incompatible——
      // 刚部署成功的 host 一次瞬时探测失败就被报「版本不兼容·请升级」,分类/文案/
      // 重试语义全错(incompatible 提示升级、不该重试;瞬时失败该归 startFailed,
      // 可重试)。拆两支:探测本身没跑通(!ok)→ startFailed;探测跑通但版本判定
      // 不兼容(ok 且 compatible===false)→ incompatible。
      if (probeResult.ok && probeResult.compatible === false) {
        this.failSession(configId, 'incompatible', probeResult.detail);
        tunnel.server.close();
        session.forwardServer = null;
        ssh.close();
        return;
      }
      if (!probeResult.ok) {
        this.failSession(configId, 'startFailed', probeResult.detail);
        tunnel.server.close();
        session.forwardServer = null;
        ssh.close();
        return;
      }

      this.wireDisconnectWatcher(configId, tunnel.server);
      this.emit(configId, {
        stage: 'verifying',
        arch,
        tunnel: { localPort: tunnel.localPort, token: newToken },
      });
      this.emit(configId, { stage: 'ready' });
      this.deps.configStore.touchLastUsed(configId);
    } catch (err) {
      this.failSession(configId, 'internal', sanitizeDetail(err));
      ssh.close();
    }
  }
}
