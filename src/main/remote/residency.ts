// 🔴 ARCH-11 核心:认领-或-确定性回收(TECH SSH-4)。
//
// decideResidency() 是纯决策函数(无 IO,ARCH-B8 P0 决策表 · T-032..T-037 穷举六分支)。
// resolveResidency() 是执行编排(喂真实/桩 SshConnectionLike + probeHostInfo + buildTunnel,
// 跑 sftp 探测 → 决策 → 按决策执行 kill/清陈旧/建隧道)。
//
// 安全性质(Round 2 加固,勿破坏):
//   ① 认领必过 main 侧 token 闸(前移探测)——token 不匹配立即同栈回收,无 livelock(ARCH-B1)
//   ② reap 仅杀 cmdline 含【本 configId】--host-tag 的进程——兄弟/无关进程永不 kill(ARCH-B2)
//   ③ cmdline 比对用 argv 分词【全等】,非裸 substring(R2V-3/R2-4)

import type { Server as NetServer } from 'node:net';
import type { RemotePortFile } from '../../shared/remoteHost';
import { HOST_MIN_APP_VERSION } from '../../shared/protocol';
import { isHostAppOutdated } from '../../shared/versionCompat';
import type { SshConnectionLike } from './ssh';
import type { ProbeResult } from './probeHostInfo';

export type ResidencyAction =
  | 'claim'
  | 'reapThenDeploy'
  | 'cleanStaleThenDeploy'
  | 'freshDeploy';

export interface ResidencyDecision {
  action: ResidencyAction;
  /** true 仅当 reapThenDeploy——kill 从不出现在其余三个分支(T-034 守门断言)。 */
  kill: boolean;
  /** 是否需要 `rm -f host.port` 清理陈旧端口文件。 */
  cleanStale: boolean;
}

export interface ResidencyDecisionInput {
  configId: string;
  portRaw: RemotePortFile | null;
  storedToken: string | null;
  bundleReady: boolean;
  /**
   * 仅当「认领候选」条件成立(portRaw 有效 + storedToken 非空)时才有意义。
   * hostOutdated:host 应用版本低于客户端依赖的最低服务端版本 HOST_MIN_APP_VERSION
   * (含旧 host 未上报 appVersion),由 resolveResidency 在 probe ok 时经
   * isHostAppOutdated 计算——true 则禁止认领,落回收分支升级服务端(用户规则 2026-07-13)。
   */
  probeResult: { ok: boolean; compatible?: boolean; hostOutdated?: boolean } | null;
  /** `kill -0 <pid>` 结果;仅当需要 reap 判定时才有意义。 */
  killAliveResult: boolean | null;
  /** darwin `ps -o command=` 或 linux `/proc/<pid>/cmdline`(`\0` 分隔)原始输出。 */
  cmdlineResult: string | null;
}

/**
 * argv 分词【全等】比对(R2V-3/R2-4):`--host-tag` 后一 token === configId,
 * 非裸 substring(防「同前缀」误判)。兼容 darwin(空格分隔)与 linux(`\0` 分隔)两种
 * cmdline 输出格式。
 */
export function cmdlineMatchesHostTag(cmdline: string | null, configId: string): boolean {
  if (!cmdline) return false;
  const tokens = cmdline.includes('\0')
    ? cmdline.split('\0').filter((t) => t.length > 0)
    : cmdline.trim().split(/\s+/);
  const idx = tokens.indexOf('--host-tag');
  if (idx === -1) return false;
  return tokens[idx + 1] === configId;
}

/**
 * 纯决策(TECH SSH-4 算法,认领门闸按用户规则 2026-07-13 调整):
 *   1. 认领候选(portRaw 有效 + storedToken 非空)且 probe 通过 且 host 版本 ≥ 客户端
 *      依赖的最低服务端版本(HOST_MIN_APP_VERSION)→ claim
 *   2. 否则确定性回收:pid 存活 且 cmdline 精确含本 configId 的 --host-tag → reapThenDeploy(唯一
 *      允许 kill 的分支);否则(pid 死 / cmdline 不匹配即「兄弟或无关进程」)→ cleanStaleThenDeploy,
 *      绝不 kill(消 ARCH-B2 误杀)。
 *   3. 未认领且 !bundleReady → freshDeploy(首装场景 · T-037)
 *
 * 🔴 用户规则 2026-07-13(反转旧 2026-07 规则「协议兼容就收养」):连接时服务端版本
 * 必须 ≥ 客户端声明的最低依赖版本,否则先升级服务端——在跑任务可以被关闭。协议兼容
 * 但 appVersion 低于最低依赖(或旧 host 根本不上报 appVersion)的活 host 不再收养,
 * 落 reapThenDeploy 升级。基准是硬编码的 HOST_MIN_APP_VERSION 而非客户端自身版本:
 * 满足最低依赖即收养(含 host 高于客户端的多设备场景),不为无关小版本差杀 session。
 *
 * 认领候选仍【不】要求 bundleReady:bundleReady 按【客户端当前 appVersion】的 bundle
 * 目录判定,客户端一升级它必为 false;版本门闸统一走 probe 结果(协议闭区间 +
 * hostOutdated),不靠 bundle 目录有无。
 */
export function decideResidency(input: ResidencyDecisionInput): ResidencyDecision {
  const { configId, portRaw, storedToken, bundleReady, probeResult, killAliveResult, cmdlineResult } =
    input;

  // portRaw.hostTag==configId 呼应 TECH「认领候选」条件(自证字段,非安全边界——
  // 真正的身份闸是下方 main 侧 probe 的 token 校验;此处只是廉价的宽松前置过滤)。
  const candidateEligible = portRaw !== null && portRaw.hostTag === configId && !!storedToken;
  if (
    candidateEligible &&
    probeResult?.ok &&
    probeResult.compatible !== false &&
    probeResult.hostOutdated !== true
  ) {
    return { action: 'claim', kill: false, cleanStale: false };
  }

  const alive = portRaw?.pid != null && killAliveResult === true;
  const tagMatches = alive && cmdlineMatchesHostTag(cmdlineResult, configId);
  if (alive && tagMatches) {
    return { action: 'reapThenDeploy', kill: true, cleanStale: true };
  }

  if (!bundleReady) {
    return { action: 'freshDeploy', kill: false, cleanStale: portRaw !== null };
  }
  return { action: 'cleanStaleThenDeploy', kill: false, cleanStale: portRaw !== null };
}

// ---- 执行编排 --------------------------------------------------------------

export interface BuiltTunnel {
  server: NetServer;
  localPort: number;
}

export interface ResidencyContext {
  ssh: SshConnectionLike;
  /** 远端绝对数据目录(OKWORK_HOST_DATA_DIR 值,路径全程绝对 · ARCH-B9)。 */
  dataDir: string;
  configId: string;
  /**
   * 服务端身份键(多设备同屏 TECH §0.3):端口文件路径/portRaw.hostTag 比对/cmdline
   * reap 比对全部以此为基准。缺省 = configId(隔离模式/旧调用方零变化)。
   */
  hostTag?: string;
  /**
   * 服务端身份 token 文件绝对路径(收敛模式 · TECH §A.2)。提供且端口文件存在时,
   * 以该文件内容为【权威】token 源(sftp 读序恒在端口文件之后——happens-before:
   * 见到端口文件 ⇒ 身份文件已完整);读不到 → 回落 storedToken 本地缓存(可能陈旧,
   * probe 兜底),绝不臆造(fail-closed)。
   */
  identityTokenPath?: string;
  appVersion: string;
  /**
   * 客户端依赖的服务端最低应用版本(认领版本门闸基准 · 用户规则 2026-07-13)。
   * 缺省 = HOST_MIN_APP_VERSION(shared/protocol.ts 硬编码,客户端功能依赖更新的
   * host 行为时上调);测试注入。🔴 不是 ctx.appVersion:host 满足最低依赖即收养,
   * 不为无关紧要的小版本差杀 session。
   */
  minHostAppVersion?: string;
  storedToken: string | null;
  probeHostInfo: (localPort: number, token: string) => Promise<ProbeResult>;
  buildTunnel: (remotePort: number) => Promise<BuiltTunnel>;
  /** kill 后轮询确认死亡的时钟(测试可注入快进)。 */
  sleep?: (ms: number) => Promise<void>;
  killPollTimeoutMs?: number;
}

export interface ResidencyResolution {
  decision: ResidencyDecision;
  portRaw: RemotePortFile | null;
  /**
   * 是否曾尝试认领(即候选条件成立、发起过 main 探测)——不论最终成败。
   * 🔴 R2V-2:orchestrator 据此判是否需先 emit 'claiming' 再回退到 'deploying'
   * (claiming→deploying 合法边,T-010b);候选条件不成立时(无 portRaw/无 token/
   * 无 bundle)直接从 'connecting' 到 'deploying',不途经 claiming。
   */
  attemptedClaim: boolean;
  /** 仅 claim 分支携带:已建好的隧道 + 探测结果(供 orchestrator 直接 emit verifying)。 */
  claimed?: { tunnel: BuiltTunnel; probe: ProbeResult };
  /**
   * 本轮实际用于探测/认领的 token(多设备同屏 TECH §A.2):服务端身份文件内容优先,
   * 回落 storedToken。claim 成功时 orchestrator 必须以此为 session token(并回写本地
   * 缓存)——设备 B 认领设备 A 起的 host 时,本地 storedToken 可能为空/陈旧。
   */
  effectiveToken: string | null;
}

function portFilePath(dataDir: string, configId: string): string {
  return `${dataDir}/hosts/${configId}/host.port`;
}

function bundleReadyPath(dataDir: string, appVersion: string): string {
  return `${dataDir}/bundle/${appVersion}/.ready`;
}

function parsePortFile(buf: Buffer | null): RemotePortFile | null {
  if (!buf) return null;
  try {
    const parsed = JSON.parse(buf.toString('utf8')) as Partial<RemotePortFile>;
    if (
      typeof parsed.port === 'number' &&
      typeof parsed.pid === 'number' &&
      typeof parsed.hostTag === 'string'
    ) {
      return { port: parsed.port, pid: parsed.pid, hostTag: parsed.hostTag };
    }
    return null;
  } catch {
    return null;
  }
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_CLAIM_PROBE_RETRIES = 3;
const DEFAULT_CLAIM_PROBE_RETRY_DELAY_MS = 300;

/**
 * 🔴 EXT-B-2:claim 探测重试次数(不含首次尝试)。网络刚从抖动恢复是 claim 探测
 * 最易假阴性的时刻——tag-match+alive 的活 host 自证属本 configId,单探 miss
 * 不该直接判定回收(否则连同断线期跑完的 build 一并销毁)。env 可注入。
 */
function claimProbeRetries(): number {
  const raw = process.env.OKWORK_CLAIM_PROBE_RETRIES;
  if (raw === undefined) return DEFAULT_CLAIM_PROBE_RETRIES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CLAIM_PROBE_RETRIES;
}

/**
 * 执行编排:sftp 探测 bundleReady/portRaw → (候选路径:建隧道 + main 探测) →
 * decideResidency → 按决策执行 kill(确定性轮询死亡)/ 清陈旧。
 *
 * 🔴 不在此处执行「部署」本身(SSH-5 由 deploy.ts 负责);本函数只负责判定 +
 * 回收执行,返回的 decision.action ∈ {reapThenDeploy, cleanStaleThenDeploy, freshDeploy}
 * 时,调用方(orchestrator)继续走部署+启动分支。
 */
export async function resolveResidency(ctx: ResidencyContext): Promise<ResidencyResolution> {
  const sleep = ctx.sleep ?? defaultSleep;
  // 身份键:收敛模式下为派生 hostTag,隔离/旧调用方缺省回落 configId(TECH §A.4)
  const tag = ctx.hostTag ?? ctx.configId;
  const bundleReady = (await ctx.ssh.sftpReadFile(bundleReadyPath(ctx.dataDir, ctx.appVersion))) !== null;
  const portRaw = parsePortFile(await ctx.ssh.sftpReadFile(portFilePath(ctx.dataDir, tag)));

  // 🔴 服务端身份 token 权威源(TECH §A.2):读序恒在端口文件之后(happens-before)。
  // 文件在 → 覆盖本地 storedToken(设备 B 认领设备 A 的 host 的唯一 token 通道);
  // 文件缺/空 → 回落本地缓存(旧 host 未写身份文件/隔离模式),probe 兜底,不臆造。
  let effectiveToken = ctx.storedToken;
  if (ctx.identityTokenPath && portRaw !== null) {
    const tokenBuf = await ctx.ssh.sftpReadFile(ctx.identityTokenPath);
    const serverToken = tokenBuf?.toString('utf8').trim();
    if (serverToken) effectiveToken = serverToken;
  }

  let probeResult: { ok: boolean; compatible?: boolean; hostOutdated?: boolean } | null = null;
  let candidateTunnel: BuiltTunnel | undefined;
  let fullProbe: ProbeResult | undefined;
  // 🔴 与 decideResidency 同口径:候选不看 bundleReady(客户端升级后新版 bundle 必缺,
  // 版本门闸统一走 probe 的协议判定 + hostOutdated,不靠 bundle 目录有无)。
  const candidateEligible =
    portRaw !== null && portRaw.hostTag === tag && !!effectiveToken;

  if (candidateEligible) {
    candidateTunnel = await ctx.buildTunnel(portRaw!.port);
    const maxRetries = claimProbeRetries();
    // 🔴 EXT-B-2 有界重试:同一隧道上重探(不重建隧道),瞬时失败短退避后再试;
    // 仍未 ok 才把最终失败结果交给下方 decideResidency(该函数保持纯——重试只
    // 发生在这层执行编排,decideResidency 永远只看「最终一次」probeResult)。
    for (let attempt = 0; ; attempt++) {
      try {
        fullProbe = await ctx.probeHostInfo(candidateTunnel.localPort, effectiveToken!);
        probeResult = {
          ok: fullProbe.ok,
          compatible: fullProbe.compatible,
          // 🔴 用户规则 2026-07-13:probe 跑通才有版本可比;基准是【客户端依赖的最低
          // 服务端版本】(非客户端自身版本)。host 未上报 appVersion(现网旧版 host)
          // 按过旧计——连接时升级服务端,在跑任务可关闭。
          hostOutdated: fullProbe.ok
            ? isHostAppOutdated(
                fullProbe.hostInfo?.appVersion,
                ctx.minHostAppVersion ?? HOST_MIN_APP_VERSION,
              )
            : undefined,
        };
      } catch (err) {
        // 🔴 E7 防御性修复:probeHostInfo 契约上「永不 reject」(probeHostInfo.ts 自述),
        // 但若某实现(测试桩/未来变更)违反契约抛出,决不能让候选隧道泄漏——立即关闭
        // 并归一为探测失败,继续走确定性回收(不 livelock,也不重试:契约违反不是
        // 「瞬时网络失败」)。
        candidateTunnel.server.close();
        candidateTunnel = undefined;
        probeResult = { ok: false };
        fullProbe = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        break;
      }
      if (probeResult.ok || attempt >= maxRetries) break;
      await sleep(DEFAULT_CLAIM_PROBE_RETRY_DELAY_MS);
    }
  }

  let killAliveResult: boolean | null = null;
  let cmdlineResult: string | null = null;
  const claimWouldSucceed =
    candidateEligible &&
    probeResult?.ok === true &&
    probeResult.compatible !== false &&
    probeResult.hostOutdated !== true;

  if (!claimWouldSucceed && portRaw?.pid != null) {
    const aliveRes = await ctx.ssh.exec(`kill -0 "${portRaw.pid}" 2>/dev/null && echo Y || echo N`);
    killAliveResult = aliveRes.stdout.trim() === 'Y';
    if (killAliveResult) {
      cmdlineResult = await readRemoteCmdline(ctx.ssh, portRaw.pid);
    }
  }

  const decision = decideResidency({
    // 决策表的 configId 字段语义 =「本编排身份 tag」:收敛模式传派生 hostTag,
    // reap 安全性质②③(cmdline --host-tag 全等比对)随之以 hostTag 为基准——
    // 新旧 tag 并存期旧 configId host 因 tag 不等恒判兄弟,零误杀(TECH §A.4)。
    configId: tag,
    portRaw,
    storedToken: effectiveToken,
    bundleReady,
    probeResult,
    killAliveResult,
    cmdlineResult,
  });

  if (decision.action === 'claim') {
    return {
      decision,
      portRaw,
      attemptedClaim: true,
      claimed: { tunnel: candidateTunnel!, probe: fullProbe! },
      effectiveToken,
    };
  }

  // 未认领:关掉本次为候选探测建的隧道(候选失败 · 不落 livelock)
  if (candidateTunnel) {
    candidateTunnel.server.close();
  }

  if (decision.kill && portRaw?.pid != null) {
    await killAndWait(ctx.ssh, portRaw.pid, sleep, ctx.killPollTimeoutMs ?? 3000);
  }
  if (decision.cleanStale) {
    await ctx.ssh.exec(`rm -f "${portFilePath(ctx.dataDir, tag)}"`);
  }

  return { decision, portRaw, attemptedClaim: candidateEligible, effectiveToken };
}

/** darwin `ps -o command=` / linux `/proc/<pid>/cmdline` 双路径读取(取到即用,失败留空)。 */
async function readRemoteCmdline(ssh: SshConnectionLike, pid: number): Promise<string | null> {
  const cmd =
    `(tr '\\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null) || ` +
    `(ps -o command= -p "${pid}" 2>/dev/null)`;
  const res = await ssh.exec(cmd);
  const out = res.stdout.trim();
  return out.length > 0 ? out : null;
}

async function killAndWait(
  ssh: SshConnectionLike,
  pid: number,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  await ssh.exec(`kill "${pid}" 2>/dev/null`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await ssh.exec(`kill -0 "${pid}" 2>/dev/null && echo Y || echo N`);
    if (res.stdout.trim() !== 'Y') return;
    await sleep(200);
  }
  await ssh.exec(`kill -9 "${pid}" 2>/dev/null`);
}
