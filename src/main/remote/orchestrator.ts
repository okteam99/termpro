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
  RemoteTunnelInfo,
  TestResult,
} from '../../shared/remoteHost';
import type { ConnectSsh, ReverseForwardHandle, SshAuth, SshConnectionLike } from './ssh';
import { BROWSER_MCP_REMOTE_PORT } from '../../shared/browserMcp';
import type { CredentialStore, HostConfigStore } from './credentialStore';
import { detectArch } from './hostBundle';
import { NODE_PROBE_COMMAND, pickBestNode } from './nodeProbe';
import { resolveResidency, type BuiltTunnel } from './residency';
import { createSocksProxyServer } from './socksProxy';
import { resolveHostTag } from './hostIdentity';
import { acquireMkdirLock, releaseMkdirLock } from './mkdirLock';
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
  /**
   * 浏览器「走远程机网络」用的本地 SOCKS5 代理(懒建:仅当某个浏览器面板选中本机
   * 为出口时才 browserProxyFor 拉起,不选就恒 null,零开销)。断线/disconnect 时随
   * closeSessionTransport 一并关闭——底层 ssh.openOutbound 依赖的 channel 已随连接
   * 失效,残留的 SOCKS server 只会对新连接抛错,必须立即回收。
   */
  socksServer: NetServer | null;
  socksPort: number | null;
  /** browserProxyFor 并发去重(同一 configId 多面板同时选中):共享同一次拉起。 */
  socksInflight: Promise<number | null> | null;
  /**
   * 浏览器 MCP 反向转发句柄(remote→local · 阶段3):host ready 时自动建(不同于 SOCKS
   * 的懒建——session 内 agent 随时可能用,故 ready 即备好),把本机浏览器 MCP server 透到
   * 容器回环固定端口。断线/disconnect 随 closeSessionTransport 一并撤销(底层 channel 已亡)。
   */
  browserMcpForward: ReverseForwardHandle | null;
  /**
   * 反向转发建立中令牌(同步置位,防并发双建):ready-emit 与 setBrowserMcpForward 的
   * 补建循环可能并发进入 establishBrowserMcpForward,二者在 forwardInToLocal 的 await
   * 窗口内都见 browserMcpForward 尚为 null → 各建一条,泄漏一个 'tcp connection' 监听。
   * establish 入口同步比对/置令牌杜绝之。用令牌(而非布尔)是因:断线+快速重连会起一次
   * 新 establish(新令牌),旧 establish 的 finally 只在「令牌仍是自己」时才清,不会误清
   * 新一轮的守卫(评审 P3)。
   */
  browserMcpForwardToken: object | null;
  /**
   * 本次拉起的一次性标识(评审 P3 加固):startSocksProxy 的 listen 是异步的,其回调
   * 赋值 socksServer 前比对 socksToken 是否仍是「发起本次拉起时」那枚——release/断线
   * 会把它置 null/换新,回调据此发现「已被取消」→ 自关 server 不赋值,杜绝在途拉起
   * 泄漏监听口(stage/ssh 守卫挡不住 release,因 release 不改 stage/ssh)。
   */
  socksToken: object | null;
}

export type ProbeHostInfoLike = (localPort: number, token: string) => Promise<ProbeResult>;

export interface ConnectOpts {
  /**
   * 用户显式发起的服务端升级(remoteHost:upgrade · Remote Hosts「Update」按钮):
   * 跳过 claim 收养,活 host 属本 tag 则 reap 后重部署当前 app 版本 bundle
   * (语义与安全边界见 residency.ts ResidencyDecisionInput.forceRedeploy)。
   */
  forceRedeploy?: boolean;
}

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
  /** 首启锁陈旧阈值(TECH §A.3,默认 120s 与部署锁同口径;测试注入)。 */
  startLockStaleMs?: number;
  /**
   * A6:注入远端 host 进程的 OKWORK_ALLOWED_ORIGINS(逗号分隔,host.ts 侧已按此
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
 * 🔴 A6:注入 OKWORK_ALLOWED_ORIGINS(host.ts 侧已实现按逗号分隔解析,见
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
  /** 服务端身份键(多设备同屏 TECH §0.3):端口/日志路径 + --host-tag 以此为基准。
   *  缺省 = configId(隔离模式/旧测试零变化)。 */
  hostTag?: string;
  /** 身份 token 文件远端绝对路径(收敛模式注入 OKWORK_HOST_IDENTITY_FILE;隔离模式省略)。 */
  identityFile?: string;
  allowedOrigins?: string;
  /** 远端 node 绝对路径(nodeProbe 解析);缺省 'node' 仅供测试兜底,生产恒传。 */
  nodePath?: string;
}): string {
  const tag = opts.hostTag ?? opts.configId;
  const portFile = `${opts.dataDir}/hosts/${tag}/host.port`;
  const logFile = `${opts.dataDir}/hosts/${tag}/host.log`;
  const entry = `${opts.dataDir}/bundle/${opts.appVersion}/host.js`;
  const allowedOrigins = opts.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const nodeBin = (opts.nodePath ?? 'node').replace(/["'\r\n]/g, '');
  // 收敛模式(TECH §A.2):注入身份 token 文件路径,host 自写 0600(先于端口文件)
  const identityEnv = opts.identityFile
    ? `OKWORK_HOST_IDENTITY_FILE="${opts.identityFile}" `
    : '';
  // 🔴 重启前把上一实例日志轮转到 .prev(2026-07-15 事故:host.log 用 `>` 截断,host 重启/
  // 被 reap 时新实例覆盖旧实例输出,崩溃现场丢失——查死因无据)。轮转保留恰好一份前序日志
  // (含 node 未捕获异常栈,stderr 经 2>&1 已并入),不无界增长。
  return (
    `sh -c 't=$(cat); s=; command -v setsid >/dev/null 2>&1 && s=setsid; ` +
    `mv -f "${logFile}" "${logFile}.prev" 2>/dev/null; ` +
    `printf %s "$t" | $s nohup env OKWORK_HOST_DATA_DIR="${opts.dataDir}" ` +
    `OKWORK_HOST_PORT_FILE="${portFile}" OKWORK_HOST_APP_VERSION="${opts.appVersion}" ` +
    `${identityEnv}OKWORK_ALLOWED_ORIGINS="${allowedOrigins}" ` +
    `"${nodeBin}" "${entry}" --listen 127.0.0.1:0 --token-stdin --host-tag "${tag}" ` +
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
  /** 本机浏览器 MCP server 端口(main 起好 MCP 后 setBrowserMcpForward 注入);null=特性未就绪。 */
  private browserMcpLocalPort: number | null = null;

  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * 声明本机浏览器 MCP server 端口(阶段3):此后每台 host ready 都自动建反向转发,
   * 令容器内 agent 经 127.0.0.1:BROWSER_MCP_REMOTE_PORT 打回本机 MCP。已 ready 的会话
   * 立即补建(main 的 MCP server 异步起,可能晚于某些 host 连上)。传 null 关特性。
   */
  setBrowserMcpForward(localPort: number | null): void {
    this.browserMcpLocalPort = localPort;
    if (localPort == null) return;
    for (const [configId, session] of this.sessions) {
      if (session.stage === 'ready' && session.ssh && !session.browserMcpForward) {
        void this.establishBrowserMcpForward(configId);
      }
    }
  }

  /** 为某 ready 会话建浏览器 MCP 反向转发(best-effort,失败不影响会话可用)。 */
  private async establishBrowserMcpForward(configId: string): Promise<void> {
    const localPort = this.browserMcpLocalPort;
    if (localPort == null) return;
    const session = this.sessions.get(configId);
    if (!session || session.stage !== 'ready' || !session.ssh) return;
    // 同步防并发双建(见 browserMcpForwardToken 注释):已建/建中即让路
    if (session.browserMcpForward || session.browserMcpForwardToken) return;
    const token = {};
    session.browserMcpForwardToken = token;
    const ssh = session.ssh;
    try {
      const handle = await ssh.forwardInToLocal(localPort, BROWSER_MCP_REMOTE_PORT);
      // 竞态守卫:建转发期间断线/换连接/被新一轮抢占 → 立即撤销在途句柄,不挂到已亡会话上
      if (session.stage !== 'ready' || session.ssh !== ssh || session.browserMcpForwardToken !== token) {
        handle.close();
        return;
      }
      session.browserMcpForward = handle;
    } catch (err) {
      console.warn(`[remote] browser MCP reverse-forward failed for ${configId}:`, err);
    } finally {
      if (session.browserMcpForwardToken === token) session.browserMcpForwardToken = null;
    }
  }

  connect(configId: string, opts?: ConnectOpts): Promise<void> {
    // 🔴 forceRedeploy(用户显式升级)不吃 in-flight 去重:普通 connect 在途时用户点
    // Update,若直接返回旧 promise,force 语义被静默吞掉(旧编排可能正 claim 旧 host)。
    // 跳过去重走下方自愈块:作废在途会话(僵尸 runConnect 经 isCurrent 自弃),force
    // 编排经 mutex 排在其后串行执行——同 id 永无并发 runConnect。
    const existingConnect = this.connectInflight.get(configId);
    if (existingConnect && !opts?.forceRedeploy) return existingConnect;

    let session = this.ensureSession(configId);
    // 🔴 陈旧/孤儿态自愈:renderer 只在自认为「未连接」时才发 connect(Sidebar 的
    // Connect/重连/重试按钮;RemoteHostsPage 在 ready 态只给 Disconnect)。走到这里
    // 说明 connectInflight 已无此 id(上一次 connect 已 settle),却仍停在 ready 或某
    // active 阶段——必是过期:
    //   · ready:WS 已死但 main 无心跳感知(renderer 重连预算耗尽已 drop);
    //   · active:上一次编排被取消/中断后没清干净(closeSessionTransport 不改 stage、
    //     disconnect 的 wasActive 只认 ready/verifying)留下的孤儿态。
    // 旧实现:ready 走 disconnect-first 重建、active 静默 no-op。后者会让「点 Connect
    // 永远没反应」(2026-07-20 事故)。统一改为:作废旧会话对象(在途的僵尸 runConnect
    // 经 sessions 身份校验在下个 emit/写入点自弃),必要时广播 disconnected 让 renderer
    // 同步,再以全新会话重建。
    if (session.stage === 'ready' || ACTIVE_STAGES.has(session.stage)) {
      const wasConnected = session.stage === 'ready' || session.stage === 'verifying';
      this.closeSessionTransport(session);
      // ready/verifying→disconnected 是合法边,广播给 renderer;connecting/deploying/…
      // →disconnected 非法,safeEmit 吞掉(renderer 端本就已本地清空,无须此事件)。
      if (wasConnected) this.safeEmit(configId, { stage: 'disconnected' });
      this.sessions.delete(configId);
      session = this.ensureSession(configId); // 全新 idle 会话,与僵尸引用彻底分家
    }

    const priorMutex = this.mutex.get(configId) ?? Promise.resolve();
    const promise: Promise<void> = priorMutex
      .catch(() => undefined)
      .then(() => this.runConnect(configId, session, opts));
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
    // disconnect-vs-connect 竞态:等待期间用户可能又点了 Connect(新 tracked 进
    // connectInflight)——意图已翻转为「要连」,放手让新编排跑,绝不清它的会话/去重槽。
    const currentInflight = this.connectInflight.get(configId);
    if (currentInflight && currentInflight !== pending) return;

    const session = this.sessions.get(configId);
    if (!session) return;
    const wasActive = session.stage === 'ready' || session.stage === 'verifying';
    this.closeSessionTransport(session);
    if (wasActive) {
      this.safeEmit(configId, { stage: 'disconnected' });
    }
    // 🔴 彻底作废这次连接尝试(2026-07-20 事故根因):此前只关传输、不清 connectInflight
    //   /mutex、也不改 session.stage——若编排卡在途(connectSsh 黑洞/部署慢),会话就冻在
    //   某 active 阶段且去重槽仍被占,用户再点 Connect 命中 connect() 顶部的 connectInflight
    //   去重(返回那条卡死的 Promise)→「点了没反应」。这里摘除会话对象 + 清去重槽:
    //   在途 runConnect 仍持旧 session 引用,其直接写入落到被替换的孤儿对象(无害),其
    //   emit/failSession 经 sessions 身份不符而自弃,其 watcher 经资源身份校验对新会话无效;
    //   下一次 connect() 立刻走全新编排。清槽用 === pending 守卫,不误删并发新 connect 的槽。
    // 用一个全新的 'disconnected' 会话替换旧对象(而非纯删除):stages() 快照据此仍报
    //   disconnected(浏览器出口选择器契约),后续 connect 从 disconnected→connecting 起步。
    //   直接置 stage 属「新对象初始化」而非状态转移,不经 emit 的转移守卫。
    this.sessions.delete(configId);
    this.ensureSession(configId).stage = 'disconnected';
    if (this.connectInflight.get(configId) === pending) this.connectInflight.delete(configId);
    if (this.mutex.get(configId) === pending) this.mutex.delete(configId);
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

  /**
   * 已就绪会话的本地转发隧道(查看器窗口直连远程 host 用 · remoteHost:tunnel)。
   * 仅 stage==='ready' 返回;其余阶段(含 verifying——版本确认未过)一律 null,
   * 调用方按「远程机未连接」处理。按需拉取而非事件广播,呼应 E8:token 不落
   * 无关窗口,只在某窗口确要建连时给它。
   */
  tunnelFor(configId: string): RemoteTunnelInfo | null {
    const session = this.sessions.get(configId);
    if (!session || session.stage !== 'ready') return null;
    if (session.localPort === null || session.token === null) return null;
    return { localPort: session.localPort, token: session.token };
  }

  /**
   * 全部会话的当前阶段快照(configId → stage)。浏览器网络选择器据此列出「哪些远程机
   * 现在可作为出口」(仅 ready 可选)。按需快照而非事件广播——选择器打开时拉一次即可,
   * 运行态权威仍是 remoteHost:event 流(选择器组件已订阅,断线会自回退)。
   */
  stages(): Record<string, RemoteStage> {
    const out: Record<string, RemoteStage> = {};
    for (const [configId, session] of this.sessions) out[configId] = session.stage;
    return out;
  }

  /**
   * 懒建/复用某 ready 会话的本地 SOCKS5 代理端口(浏览器面板选中该机为网络出口时调用)。
   * 未 ready / 无 ssh → null(调用方按「该机不可用,回退本机网络」处理)。
   * 幂等:已建则返回缓存端口;并发调用经 socksInflight 去重共享同一次拉起。
   * 🔴 listen 是异步的,拉起期间会话可能断线——listen 回调里二次校验 stage/ssh 未变,
   * 变了就自关 server 返回 null(绝不把流量交给已失效的 ssh 连接)。
   */
  async browserProxyFor(configId: string): Promise<{ socksPort: number } | null> {
    const session = this.sessions.get(configId);
    if (!session || session.stage !== 'ready' || !session.ssh) return null;
    if (session.socksServer && session.socksPort !== null) {
      return { socksPort: session.socksPort };
    }
    if (session.socksInflight) {
      const port = await session.socksInflight;
      return port === null ? null : { socksPort: port };
    }
    const token = {};
    session.socksToken = token;
    const inflight = this.startSocksProxy(session, session.ssh, token);
    session.socksInflight = inflight;
    const port = await inflight;
    if (session.socksInflight === inflight) session.socksInflight = null;
    return port === null ? null : { socksPort: port };
  }

  /** 浏览器面板取消选中该机(改回本机/换台机)时回收其 SOCKS 代理。幂等。 */
  releaseBrowserProxy(configId: string): void {
    const session = this.sessions.get(configId);
    if (!session) return;
    // 先失效 token:若某次拉起仍在途(listen 未回调),其回调会因 token 失配自关 server,
    // 不会把监听口赋回 session(P3 加固);已建好的 server 下面照常关。
    session.socksToken = null;
    session.socksInflight = null;
    if (session.socksServer) {
      try {
        session.socksServer.close();
      } catch {
        /* 忽略:可能已关闭 */
      }
      session.socksServer = null;
    }
    session.socksPort = null;
  }

  private startSocksProxy(
    session: RemoteHostSession,
    ssh: SshConnectionLike,
    token: object,
  ): Promise<number | null> {
    return new Promise((resolve) => {
      let server: NetServer;
      try {
        server = createSocksProxyServer((host, port) => ssh.openOutbound(host, port));
      } catch {
        resolve(null);
        return;
      }
      const onError = () => {
        try {
          server.close();
        } catch {
          /* 忽略 */
        }
        resolve(null);
      };
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        // 竞态守卫:listen 期间断线(closeSessionTransport 置 stage≠ready / 换 ssh / 清
        // socksToken)或 release(仅清 socksToken,不改 stage/ssh)→ 丢弃这台 server,
        // 不赋回 session(回退本机网络),杜绝泄漏监听口。
        if (session.stage !== 'ready' || session.ssh !== ssh || session.socksToken !== token) {
          try {
            server.close();
          } catch {
            /* 忽略 */
          }
          resolve(null);
          return;
        }
        const addr = server.address();
        const localPort = addr && typeof addr === 'object' && addr !== null ? addr.port : 0;
        session.socksServer = server;
        session.socksPort = localPort;
        resolve(localPort);
      });
    });
  }

  onEvent(cb: (e: RemoteEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * macOS 系统唤醒恢复:合盖期间 TCP/channel 终态可能丢失,旧 runConnect Promise
   * 因此仍占 connectInflight/mutex。逐 configId 换新 session 世代并立即清去重槽:
   * renderer 收到 disconnected 后可按既有重连编排重新 connect;旧异步调用迟到恢复时
   * 因 session 身份不符只能自弃,不能污染新连接。
   */
  resetAfterSystemResume(): void {
    for (const [configId, session] of [...this.sessions]) {
      const hasInflight =
        this.connectInflight.has(configId) || this.mutex.has(configId);
      if (!ACTIVE_STAGES.has(session.stage) && !hasInflight) continue;

      // 先摘权威身份/去重槽,再关旧资源:即使 close 同步触发 watcher,资源身份校验也
      // 看不到旧 session;renderer 随后发来的重连不会再命中旧 Promise。
      this.sessions.delete(configId);
      this.connectInflight.delete(configId);
      this.mutex.delete(configId);
      this.closeSessionTransport(session);

      const replacement = this.ensureSession(configId);
      replacement.stage = 'disconnected';
      const event: RemoteEvent = { configId, stage: 'disconnected' };
      for (const cb of this.listeners) cb(event);
    }
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
        socksServer: null,
        socksPort: null,
        socksInflight: null,
        socksToken: null,
        browserMcpForward: null,
        browserMcpForwardToken: null,
      };
      this.sessions.set(configId, session);
    }
    return session;
  }

  private closeSessionTransport(session: RemoteHostSession): void {
    // 🔴 SOCKS 代理先于 ssh 关闭:createSocksProxyServer.close() 会立即销毁全部在途
    // 浏览器连接(=断开远程机 立即断流);其底层 openOutbound channel 随下面 ssh.close()
    // 失效,残留 server 只会对新连接抛错。socksInflight 置 null 让并发在途的
    // browserProxyFor 落到「listen 后竞态守卫」分支(stage 已非 ready → 自关返回 null)。
    if (session.socksServer) {
      try {
        session.socksServer.close();
      } catch {
        /* 忽略:可能已关闭 */
      }
      session.socksServer = null;
    }
    session.socksPort = null;
    session.socksInflight = null;
    session.socksToken = null;
    if (session.browserMcpForward) {
      try {
        session.browserMcpForward.close(); // unforwardIn + 摘 tcp 监听(底层 channel 随 ssh.close 亡)
      } catch {
        /* 忽略:连接可能已断 */
      }
      session.browserMcpForward = null;
    }
    // 清建立中令牌:在途 establish 的守卫将失配 → 自弃句柄,重连后新一轮可补建
    session.browserMcpForwardToken = null;
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
    // 资源身份校验:仅当这台 server 仍是当前会话的转发 server 时才判「断线」。作废的
    // 僵尸尝试关掉它自己的 server 时,当前会话(可能已是接管的新连接)的 forwardServer
    // 已不是它 → 不误触发 handleTransportDown 拆掉新连接(2026-07-20 完整修复)。
    const handleDown = () => {
      if (this.sessions.get(configId)?.forwardServer === server) {
        this.handleTransportDown(configId);
      }
    };
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
    // 资源身份校验(同 wireDisconnectWatcher):仅当这条 ssh 仍是当前会话的连接时才判
    // 断线。僵尸尝试的 ssh 关闭(或它超时自关)不得拆掉已接管的新会话(2026-07-20)。
    ssh.onClose(() => {
      if (this.sessions.get(configId)?.ssh === ssh) this.handleTransportDown(configId);
    });
  }

  /**
   * 首启锁输家 / post-lock recheck 的对端 token 获取(TECH §A.3):服务端身份文件
   * 优先(收敛模式,赢家 host 已在端口文件之前写好);回落本地凭据缓存(隔离模式
   * 同机双实例共享同一份凭据文件)。取到即回写缓存;取不到返回 null(调用方
   * fail-closed,绝不臆造 token)。
   */
  private async readPeerToken(
    ssh: SshConnectionLike,
    identityFile: string | undefined,
    hostTag: string,
  ): Promise<string | null> {
    if (identityFile) {
      try {
        const buf = await ssh.sftpReadFile(identityFile);
        const tok = buf?.toString('utf8').trim();
        if (tok) {
          this.deps.credentials.setSecret(tokenKey(hostTag), tok);
          return tok;
        }
      } catch {
        /* 读失败 → 回落本地缓存 */
      }
    }
    return this.deps.credentials.getSecret(tokenKey(hostTag));
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

  private async runConnect(
    configId: string,
    session: RemoteHostSession,
    opts?: ConnectOpts,
  ): Promise<void> {
    // 本次尝试是否仍当值:disconnect()/connect() 自愈会把会话对象从 map 摘除/替换,
    // 此后本(僵尸)尝试的 session 引用 !== 当前 map 里的会话。任何会改状态/发事件的
    // 动作前都据此自弃,杜绝僵尸编排污染接管的新会话(用户指令 2026-07-20 · 完整修复)。
    const isCurrent = () => this.sessions.get(configId) === session;

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
      if (!isCurrent()) return; // 已作废:静默,不把失败 emit 到接管的新会话
      this.failSession(configId, classifyConnectError(err), sanitizeDetail(err));
      return;
    }
    // 🔴 连上后先验当值:cancel/断开最常发生在 connectSsh 在途(黑洞连接 10s 才超时),
    //   此刻会话可能已被作废——立即弃连,不接管 session、不装 watcher、不再往下编排。
    if (!isCurrent()) {
      ssh.close();
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
      // 品牌改名(TermPro → OkWork)刻意保留旧目录名,理由见 hostCore.ts 同名注释。
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

      // 🔴 多设备同屏 Phase 2(TECH §A.4):hostTag=服务端身份键,isolate 缺省
      // 【false=收敛】——同(服务器指纹+SSH 用户)的所有设备派生同一 tag,共享一个
      // Host。指纹缺失/isolate=true → 退化 tag==configId(隔离,现状行为)。
      const hostTag = resolveHostTag({
        isolate: config.isolate ?? false,
        configId,
        username: config.username,
        fpDigest: ssh.hostKeyFingerprint(),
      });
      const converged = hostTag !== configId;
      const identityFile = converged ? `${dataDir}/identity/${hostTag}/token` : undefined;

      const storedToken = this.deps.credentials.getSecret(tokenKey(hostTag));

      const residency = await resolveResidency({
        ssh,
        dataDir,
        configId,
        hostTag,
        identityTokenPath: identityFile,
        appVersion: this.deps.appVersion,
        storedToken,
        forceRedeploy: opts?.forceRedeploy,
        probeHostInfo: (localPort, token) => probe(localPort, token),
        buildTunnel: (remotePort) => this.buildTunnel(ssh, remotePort),
        sleep,
      });

      if (residency.decision.action === 'claim') {
        const { tunnel } = residency.claimed!;
        session.forwardServer = tunnel.server;
        session.localPort = tunnel.localPort;
        // 🔴 EXT-B-2/Phase 2:claim 用 residency 实际探测通过的 token(服务端身份
        // 文件优先,回落本地缓存)——设备 B 认领设备 A 起的 host 时本地缓存为空,
        // 服务端文件是唯一通道;认领成功即回写本地缓存(心跳/快速重连用)。
        // 生成新 token 只发生在未认领的部署分支,claim 分支绝不换 token。
        const claimToken = residency.effectiveToken!;
        session.token = claimToken;
        session.remotePid = residency.portRaw?.pid ?? null;
        if (claimToken !== storedToken) {
          this.deps.credentials.setSecret(tokenKey(hostTag), claimToken);
        }

        this.emit(configId, { stage: 'claiming', fastPath: true, arch });
        this.wireDisconnectWatcher(configId, tunnel.server);
        this.emit(configId, {
          stage: 'verifying',
          fastPath: true,
          arch,
          tunnel: { localPort: tunnel.localPort, token: claimToken },
        });
        this.emit(configId, { stage: 'ready' });
        void this.establishBrowserMcpForward(configId);
        this.deps.configStore.touchLastUsed(configId);
        return;
      }

      // 🔴 保护在跑会话(2026-07-15 事故):host 活着且属本 tag,但探测不可达(瞬时隧道
      // 抖动 / 重连未稳)。绝不部署第二个 host(会撞端口文件),也不杀老 host——直接失败,
      // 让用户/自动重连稍后重试;届时隧道稳则 claim 挂回,in-flight 的 codex/agent 存活。
      if (residency.decision.action === 'abortLiveUnreachable') {
        ssh.close();
        this.failSession(
          configId,
          'unreachable',
          'host still running but unreachable (transient network); kept alive to protect running sessions — retry to re-attach',
        );
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

      const hostDir = `${dataDir}/hosts/${hostTag}`;
      const portFilePath = `${hostDir}/host.port`;
      const startTimeoutMs = this.deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;

      try {
        await ssh.exec(`mkdir -p "${hostDir}"`);
      } catch (err) {
        this.failSession(configId, 'startFailed', sanitizeDetail(err));
        ssh.close();
        return;
      }

      // 🔴 首启锁(多设备同屏 TECH §A.3):双设备同时发现「无 host」时,只允许一个
      // 起进程——若不互斥,输家的 host 撞端口文件 wx EEXIST 自杀,但输家设备持
      // 【自己的】token 探测赢家 → 必失败 → 误 reap 赢家(最危险回归)。锁输家不起
      // 进程,改为等赢家端口文件 → 读服务端身份 token → 认领。
      const startLockDir = `${hostDir}/.starting`;
      const lockOutcome = await acquireMkdirLock(ssh, startLockDir, {
        staleMs: this.deps.startLockStaleMs,
      });

      let sessionToken: string;
      let portRaw: RemotePortFile | null = null;

      if (lockOutcome === 'acquired') {
        try {
          // post-lock recheck:residency 判定与取锁之间,赢家可能已完成启动并释放锁
          // ——此时端口文件已在,直接转认领路径,绝不再起第二个进程。
          portRaw = await pollPortFile(ssh, portFilePath, 0, sleep);
          if (portRaw) {
            const peerToken = await this.readPeerToken(ssh, identityFile, hostTag);
            if (!peerToken) {
              this.failSession(
                configId,
                'startFailed',
                'peer host running but identity token unreadable',
              );
              ssh.close();
              return;
            }
            sessionToken = peerToken;
          } else {
            const newToken = generateToken();
            try {
              await ssh.execDetached(
                buildStartCommand({
                  dataDir,
                  appVersion: this.deps.appVersion,
                  configId,
                  hostTag,
                  identityFile,
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
            portRaw = await pollPortFile(ssh, portFilePath, startTimeoutMs, sleep);
            if (!portRaw) {
              // 超时主因之外,把远端 host.log 尾部拼进 detail(host 启动即崩时,崩因
              // 只落在这份被启动命令重定向的日志里,不捞回来 UI 只剩一句 timeout)。
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
            sessionToken = newToken;
            this.deps.credentials.setSecret(tokenKey(hostTag), newToken);
          }
        } finally {
          // 无论成败必释放(失败不释放会让其它设备等满陈旧阈值才能重试)
          await releaseMkdirLock(ssh, startLockDir).catch(() => undefined);
        }
      } else {
        // waitForPeer(锁被另一设备持有):等赢家端口文件出现 → 读服务端身份 token 认领
        portRaw = await pollPortFile(ssh, portFilePath, startTimeoutMs, sleep);
        if (!portRaw) {
          this.failSession(
            configId,
            'startFailed',
            'peer start did not produce port file before timeout',
          );
          ssh.close();
          return;
        }
        const peerToken = await this.readPeerToken(ssh, identityFile, hostTag);
        if (!peerToken) {
          // fail-closed:有端口无可读 token(隔离模式双实例竞速/崩溃残局)——
          // 不臆造 token 去探测;失败可重试,下次 connect 走 residency 认领路径。
          this.failSession(
            configId,
            'startFailed',
            'peer host started but identity token unreadable',
          );
          ssh.close();
          return;
        }
        sessionToken = peerToken;
      }

      const tunnel = await this.buildTunnel(ssh, portRaw.port);
      session.forwardServer = tunnel.server;
      session.localPort = tunnel.localPort;
      session.token = sessionToken;
      session.remotePid = portRaw.pid;

      const probeResult = await probe(tunnel.localPort, sessionToken);
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
        tunnel: { localPort: tunnel.localPort, token: sessionToken },
      });
      this.emit(configId, { stage: 'ready' });
      void this.establishBrowserMcpForward(configId);
      this.deps.configStore.touchLastUsed(configId);
    } catch (err) {
      // 本次尝试已被作废(disconnect/自愈把会话摘除/替换):静默收尾。此时若 emit
      // 'failed' 会命中接管的新会话,且非法转移会二次抛出成 main 未处理拒绝(可能弹窗)。
      if (!isCurrent()) {
        try {
          ssh.close();
        } catch {
          /* 已关 */
        }
        return;
      }
      this.failSession(configId, 'internal', sanitizeDetail(err));
      ssh.close();
    }
  }
}
