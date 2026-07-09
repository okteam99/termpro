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
import { resolveResidency, type BuiltTunnel } from './residency';
import { deployBundle } from './deploy';
import { probeHostInfo as defaultProbeHostInfo, type ProbeResult } from './probeHostInfo';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_START_TIMEOUT_MS = 15_000;
const MIN_NODE_MAJOR = 20;

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

function parseNodeMajor(stdout: string): number | null {
  const match = stdout.trim().match(/^v?(\d+)\./);
  return match ? Number(match[1]) : null;
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

/** 启动命令(TECH SSH-4):`--host-tag` 显式 argv,路径全程绝对(ARCH-B9)。 */
export function buildStartCommand(opts: {
  dataDir: string;
  appVersion: string;
  configId: string;
}): string {
  const portFile = `${opts.dataDir}/hosts/${opts.configId}/host.port`;
  const logFile = `${opts.dataDir}/hosts/${opts.configId}/host.log`;
  const entry = `${opts.dataDir}/bundle/${opts.appVersion}/host.js`;
  return (
    `setsid nohup env TERMPRO_HOST_DATA_DIR=${opts.dataDir} TERMPRO_HOST_PORT_FILE=${portFile} ` +
    `node ${entry} --listen 127.0.0.1:0 --token-stdin --host-tag ${opts.configId} ` +
    `> ${logFile} 2>&1 < /dev/stdin &`
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
  /** 🔴 per-configId 在途互斥(ARCH-B3):connect/test 共享,防并发编排竞争 host.port。 */
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<(e: RemoteEvent) => void>();

  constructor(private readonly deps: OrchestratorDeps) {}

  connect(configId: string): Promise<void> {
    const existing = this.inflight.get(configId);
    if (existing) return existing.then(() => undefined, () => undefined);

    const session = this.ensureSession(configId);
    if (ACTIVE_STAGES.has(session.stage)) {
      // 已在连接中或已就绪:不重复编排(ARCH-B3 语义扩展——不仅并发调用复用同一
      // Promise,处于活跃阶段时的新调用也是 no-op,由用户走 disconnect 再 connect)。
      return Promise.resolve();
    }

    const promise = this.runConnect(configId, session).finally(() => {
      this.inflight.delete(configId);
    });
    this.inflight.set(configId, promise);
    return promise;
  }

  async disconnect(configId: string): Promise<void> {
    const existing = this.inflight.get(configId);
    if (existing) {
      // 在途编排(部署/启动)不安全中断,best-effort 等它自然结束
      await existing.catch(() => undefined);
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
    const existing = this.inflight.get(configId);
    const chain = existing
      ? existing.catch(() => undefined).then(() => this.runTest(configId))
      : this.runTest(configId);
    const tracked = chain.finally(() => {
      if (this.inflight.get(configId) === tracked) this.inflight.delete(configId);
    });
    this.inflight.set(configId, tracked);
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
    this.inflight.clear();
    this.listeners.clear();
  }

  // ---- 内部 -------------------------------------------------------------

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

  private wireDisconnectWatcher(configId: string, server: NetServer): void {
    const handleDown = () => {
      const session = this.sessions.get(configId);
      if (!session) return;
      if (session.stage === 'ready' || session.stage === 'verifying') {
        this.safeEmit(configId, { stage: 'disconnected' });
      }
    };
    server.on('close', handleDown);
    server.on('error', handleDown);
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

      const nodeRes = await ssh.exec('node -v');
      const nodeMajor = parseNodeMajor(nodeRes.stdout);
      if (nodeRes.code !== 0 || nodeMajor === null || nodeMajor < MIN_NODE_MAJOR) {
        this.failSession(configId, 'nodeMissing');
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
        await ssh.exec(`mkdir -p ${hostDir}`);
        await ssh.execDetached(
          buildStartCommand({ dataDir, appVersion: this.deps.appVersion, configId }),
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
        this.failSession(configId, 'startFailed', 'port file did not appear before timeout');
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
      if (!probeResult.ok || probeResult.compatible === false) {
        this.failSession(configId, 'incompatible', probeResult.detail);
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
