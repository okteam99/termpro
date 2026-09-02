import * as pty from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FLOW,
  HostMessage,
  SessionAttachResult,
  SessionSnapshot,
  SpawnOptions,
} from '../shared/protocol';
import { OutputScanner } from './outputScanner';
import { SessionTracker } from './sessionTracker';
import { RingBuffer } from './ringBuffer';
import { integrationEnv } from './shellIntegration';

/**
 * 会话的一个订阅端(M2 多订阅镜像 · 取代旧单 owner 的 send/unacked/attached 三字段)。
 * `id` = hostCore 分配的 client.id;spawn 初始订阅者 / 直调 pool 的旧测试缺省 -1。
 */
interface Subscriber {
  id: number;
  send: (msg: HostMessage) => void;
  /** 已发出但该订阅者尚未 ack 的字节数(独立流控记账,互不干扰) */
  unacked: number;
  /** 落后越过 ring 容量(unacked > ring.capacityBytes)→ 剔出流控判据、停发增量 pty:data,
   *  待其下次 reattach 时 sliceFrom 自然 full=true 全量重同步。仅多订阅时启用(见 recalc 调用点)。 */
  desync: boolean;
  /** 该订阅者视口(min-size 政策取全体订阅者 min 作为 PTY 实际尺寸) */
  cols: number;
  rows: number;
}

interface Session {
  id: string;
  pty: pty.IPty;
  /** PTY 级暂停标记(由订阅者集合的 unacked 派生 · B2);单订阅者语义与旧版逐点等价 */
  paused: boolean;
  lastProcess: string;
  scanner: OutputScanner;
  tracker: SessionTracker;
  /** 订阅者集合(取代旧单 send/unacked/attached)。size===0 ⇔ 旧 attached=false(旁路流控)。 */
  subscribers: Map<number, Subscriber>;
  // ---- BL-005 断线重连/续跑 ----
  /** host 形态注入:embedded 不分配 ring / onExit 立即 delete(零回归) */
  mode: 'embedded' | 'standalone';
  /** 状态机:live=运行中;exited=断开期跑完/崩溃的保留态(AC-12) */
  status: 'live' | 'exited';
  /** 回放源:仅 standalone 分配的字节上限环形缓冲;ring 由全体订阅者共享,各持独立回放游标 */
  ring: RingBuffer | null;
  /** 累计发出总字节(单调):增量回放游标基准(与 ring.absoluteOffset 同步) */
  absoluteOffset: number;
  /** exited 时的退出码(进程/会话退出码 · SessionSnapshot.exitCode 单源) */
  exitCode: number | null;
  /** onExit 时刻 Date.now():会话数上限「先逐最旧 exited」的排序键(升序 · ARCH-B-8) */
  exitedAt: number | null;
  /** 用户显式 kill 标记:区分「自然退出→exited 保留」vs「手动 kill→彻底逐出」(D-9) */
  evicting: boolean;
  /** spawn cwd(session.list 重建 tab 用) */
  cwd: string;
  /** shell basename(title 兜底) */
  shellName: string;
  /** 在途的重绘拨动定时器(见 nudgeRedraw);任何真实 resize 落地即作废 */
  redrawNudge: NodeJS.Timeout | null;
}

const PROCESS_POLL_MS = 1500;
/**
 * 重绘拨动的还原延迟(见 nudgeRedraw):要大到中间尺寸能被前台程序观测(否则比对新旧
 * 尺寸的 TUI 会跳过重绘),又小到用户看不出那一行的抖动。env 可调(测试用短值)。
 */
const DEFAULT_REDRAW_NUDGE_MS = 60;
const REDRAW_NUDGE_MS = (() => {
  const n = Number(process.env.OKWORK_REDRAW_NUDGE_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_REDRAW_NUDGE_MS;
})();
const DEFAULT_MAX_SESSIONS = 64;
/** spawn / 直调 pool 的旧调用点缺省订阅者 id(hostCore 恒传真实 client.id,不会撞这个值)。 */
const DEFAULT_SUBSCRIBER_ID = -1;
/**
 * 多订阅 desync 驱逐阈值(收尾评审 P2-3):解耦 ring 容量(256KiB 会误伤健康高 RTT 端,
 * RTT×吞吐 轻易超过)并抬到高水位之上——2×highWatermark = 1MiB 给在途留余量。
 * full-resync 正确性与该阈值无关(sliceFrom 据游标是否仍在 ring 判 full)。env 可调(测试)。
 */
const DEFAULT_DESYNC_UNACKED = 2 * FLOW.highWatermark;

function envDesyncUnacked(): number {
  const n = Number(process.env.OKWORK_DESYNC_UNACKED);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DESYNC_UNACKED;
}

function envMaxSessions(): number {
  const n = Number(process.env.OKWORK_MAX_SESSIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_SESSIONS;
}

/**
 * spawn cwd 解析(2026-07-15):请求目录不存在时(如清理掉的 worktree),回退到它的
 * 【最近存在祖先】而非家目录——workspace tab 的 cwd 恒在项目内,最近存在祖先仍落在
 * 项目/工作区内(如 /ws/proj/.worktree/gone → /ws/proj),避免落到家目录被容器 profile.d
 * 的 `cd /workspace` 又带去挂载根(与工作区不一致)。祖先一路走到文件系统根(说明是
 * 彻底无关的野路径)才退家目录。
 */
export function resolveSpawnCwd(requested: string, homedir: string): string {
  if (fs.existsSync(requested)) return requested;
  let dir = requested;
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // 抵达文件系统根仍无存在祖先
    if (fs.existsSync(parent)) {
      // 落到根('/' 或 Windows 盘根)说明请求是野路径,退家目录更合理
      return parent === path.parse(parent).root ? homedir : parent;
    }
    dir = parent;
  }
  return homedir;
}

export class PtyPool {
  private sessions = new Map<string, Session>();
  private seq = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  /**
   * @param mode host 形态(D-1):embedded=本机嵌入式(零回归)· standalone=远程/loopback
   *             (分配 ring / onExit 转 exited 保留态 / 会话数上限)。默认 embedded 保持
   *             既有 `new PtyPool()` 调用点行为不变。
   */
  constructor(
    private readonly mode: 'embedded' | 'standalone' = 'embedded',
    private readonly maxSessions: number = envMaxSessions(),
    private readonly desyncUnackedLimit: number = envDesyncUnacked(),
  ) {}

  /** 共享单例:会话初始订阅者由 spawn 时传入的 send/subscriberId 决定(M2:后续可多订阅镜像)。 */
  spawn(
    opts: SpawnOptions,
    send: (msg: HostMessage) => void,
    onExit?: (sessionId: string) => void,
    subscriberId: number = DEFAULT_SUBSCRIBER_ID,
  ): string {
    // 会话数上限(仅 standalone):溢出先逐最旧 exited,无 exited 可逐 → 拒新建
    // (绝不逐运行中会话 · QA-7/D-9)。embedded 无 exited 堆积,不设上限(零回归)。
    if (this.mode === 'standalone' && this.sessions.size >= this.maxSessions) {
      if (!this.evictOldestExited()) {
        throw new Error(
          `session cap reached (${this.maxSessions}); kill a session to free a slot`,
        );
      }
    }

    const shell =
      opts.shell ??
      process.env.SHELL ??
      (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const id = `s${++this.seq}-${Date.now().toString(36)}`;
    // 持久化恢复的 cwd 可能已被删除(如清理掉的 worktree):回退最近存在祖先(仍在
    // 工作区内),而非家目录——否则容器 profile.d 的 `cd /workspace` 会再把它带去挂载根,
    // 与工作区项目目录不一致(2026-07-15)。
    let cwd = opts.cwd;
    if (!fs.existsSync(cwd)) {
      const resolved = resolveSpawnCwd(cwd, os.homedir());
      console.warn(`[host] spawn cwd missing (${cwd}) → nearest existing ancestor ${resolved}`);
      cwd = resolved;
    }
    const baseEnv = { ...process.env, ...opts.env } as Record<string, string>;
    // 浏览器 MCP stdio 桥在 ~/.agents/skills/okwork/okwork-browser-mcp。
    // 注入 PATH 后 `claude mcp add -- okwork-browser-mcp` 不用把 tab uuid 写进配置。
    if (baseEnv.OKWORK_BROWSER_MCP_URL) {
      const mcpBin = path.join(os.homedir(), '.agents', 'skills', 'okwork');
      const prev = baseEnv.PATH || process.env.PATH || '';
      const parts = prev.split(path.delimiter).filter(Boolean);
      if (!parts.includes(mcpBin)) {
        baseEnv.PATH = `${mcpBin}${path.delimiter}${prev}`;
      }
    }
    // zsh 自动注入 shell integration(OSC 133/7);失败或非 zsh 静默跳过
    const integration = integrationEnv(shell, baseEnv);
    const initCols = Math.max(2, opts.cols);
    const initRows = Math.max(1, opts.rows);
    const proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: initCols,
      rows: initRows,
      cwd,
      env: { ...baseEnv, ...integration },
    });
    const shellName = shell.split('/').pop() ?? shell;
    const tracker = new SessionTracker({
      shellName,
      emit: (event) => {
        if (process.env.OKWORK_SMOKE) {
          console.log('[host] session:event %s %s', id, JSON.stringify(event));
        }
        this.broadcastAll(session, { t: 'session:event', sessionId: id, event });
      },
    });
    const scanner = new OutputScanner({
      onBell: () => tracker.onBell(),
      onOsc: (code, payload) => tracker.onOsc(code, payload),
      onAltScreen: (on) => tracker.onAltScreen(on),
      onBracketedPaste: (on) => tracker.onBracketedPaste(on),
      onMouseMode: (mode, on) => tracker.onMouseMode(mode, on),
    });

    const session: Session = {
      id,
      pty: proc,
      paused: false,
      lastProcess: '',
      scanner,
      tracker,
      subscribers: new Map([
        [
          subscriberId,
          {
            id: subscriberId,
            send,
            unacked: 0,
            desync: false,
            cols: initCols,
            rows: initRows,
          },
        ],
      ]),
      mode: this.mode,
      status: 'live',
      ring: this.mode === 'standalone' ? new RingBuffer() : null,
      absoluteOffset: 0,
      exitCode: null,
      exitedAt: null,
      evicting: false,
      cwd,
      shellName,
      redrawNudge: null,
    };

    proc.onData((data) => {
      // 观察(只读)→ 入 ring(回放源)→ 逐订阅者流控记账 → 广播(desync 门过滤)
      scanner.feed(data);
      tracker.onOutput();
      const bytes = Buffer.byteLength(data);
      session.absoluteOffset += bytes;
      session.ring?.push(data);

      // 🔴 流控双政体(收尾评审 P2-2/P2-3 修订 · 设计 §B2 v2):
      //  - 单订阅(size===1):pause/resume 高低水位,与旧单 owner 逐字节一致(零回归);
      //    永不 desync(卡死订阅者照旧 pause 保持)。
      //  - 多订阅(size>1):【免 pause】——共享 PTY 的 pause 必然耦合全体订阅者,与
      //    「快端不受慢端拖累」矛盾;唯一背压 = desync 驱逐(阈值 DESYNC_UNACKED,
      //    解耦 ring 容量并抬到高水位之上,给健康高 RTT 链路留在途余量),被驱逐者
      //    收 session:desynced → renderer 自动 mirror re-attach 全量重同步(P2-1)。
      //  - 空集:旁路流控不 pause,ring 续录(断开续跑 · AC-1 零回归)。
      // 内存上界:每活跃订阅者 unacked ≤ DESYNC_UNACKED 即被驱逐(不再发)→ 发送
      // 缓冲有界;ring 自身有界 → 任意慢端都不能让内存无界。
      const desyncGate = session.ring !== null && session.subscribers.size > 1;
      let soleOver = false;
      for (const sub of session.subscribers.values()) {
        if (sub.desync) continue; // 已剔出流控:不再记账、不再收增量
        sub.unacked += bytes;
        if (desyncGate && sub.unacked > this.desyncUnackedLimit) {
          // 本 chunk 起停发增量;显式通知该端(否则存活连接静默冻屏 · P2-1)
          sub.desync = true;
          sub.send({ t: 'session:desynced', sessionId: id });
          continue;
        }
        if (session.subscribers.size === 1 && sub.unacked > FLOW.highWatermark) {
          soleOver = true;
        }
      }
      if (!session.paused && soleOver) {
        session.paused = true;
        proc.pause();
      }

      const msg: HostMessage = { t: 'pty:data', sessionId: id, data, bytes };
      for (const sub of session.subscribers.values()) {
        if (!sub.desync) sub.send(msg);
      }
    });

    proc.onExit(({ exitCode }) => {
      this.cancelNudge(session); // 死 pty resize 会抛
      if (session.mode === 'embedded' || session.evicting) {
        // 嵌入式:立即 delete(零回归)· 手动 kill:彻底逐出(不留 exited)
        this.sessions.delete(id);
        this.stopPollingIfIdle();
        onExit?.(id); // 归属方清理(自然退出时 client.sessions 不留死条目)
        this.broadcastAll(session, { t: 'pty:exit', sessionId: id, exitCode });
        return;
      }
      // standalone 自然退出:转 exited 保留态(保留 ring + 退出码 · AC-12)
      session.status = 'exited';
      session.exitCode = exitCode;
      session.exitedAt = Date.now();
      session.tracker.freeze(); // 冻结最终快照 · 停对死 pty 轮询(CR-4)
      this.stopPollingIfIdle();
      onExit?.(id); // 死会话无归属 I/O:从 owner set 摘除(仍留在 pool 供 list/attach)
      // 🔴 pty:exit 先广播再清订阅者集合(不变式4):清空后 subscribers.size===0
      // 派生「旧 attached=false」,与现行语义等价,顺序错了会漏发给仍在线的订阅者。
      this.broadcastAll(session, { t: 'pty:exit', sessionId: id, exitCode });
      session.subscribers.clear();
    });

    this.sessions.set(id, session);
    this.ensurePolling();
    return id;
  }

  /**
   * UI 消费完一批输出后回执;水位回落则恢复 PTY 读取。
   * @param subscriberId 缺省(旧调用点):恰一个订阅者时作用于它(兼容旧测试/嵌入式单端调用),
   *   否则 no-op(多订阅下匿名 ack 无法判定归属,宁可丢弃不可误推进他人游标)。
   *   🔴 安全关键:ack 只推进【自己】的 unacked,绝不触他人(B6 ack 独立性)。
   */
  ack(sessionId: string, bytes: number, subscriberId?: number): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.status === 'exited') return;
    const sub = this.resolveSubscriber(s, subscriberId);
    if (!sub) return;
    sub.unacked = Math.max(0, sub.unacked - bytes);
    this.maybeResume(s);
  }

  input(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.status === 'exited') return;
    s.pty.write(data);
  }

  /**
   * @param subscriberId 在场且是订阅者 → 更新其视口 + min-size 重算(变则 pty.resize · B5)。
   *   缺省(旧调用点/嵌入式)→ 若恰一个订阅者:同步其视口 + 直接 pty.resize(等价旧单 owner
   *   行为);否则(0 或 >1 个订阅者)直接 pty.resize,不落地任何订阅者视口。
   */
  resize(sessionId: string, cols: number, rows: number, subscriberId?: number): void {
    if (cols < 2 || rows < 1) return;
    const s = this.sessions.get(sessionId);
    if (!s || s.status === 'exited') return;

    if (subscriberId !== undefined) {
      const sub = s.subscribers.get(subscriberId);
      if (!sub) return; // 非订阅者越权改尺寸:忽略(不落地/不 resize)
      sub.cols = cols;
      sub.rows = rows;
      this.recalcMinSize(s);
      return;
    }

    if (s.subscribers.size === 1) {
      const sub = s.subscribers.values().next().value as Subscriber;
      sub.cols = cols;
      sub.rows = rows;
    }
    this.cancelNudge(s); // 同 recalcMinSize:真实尺寸优先于在途拨动还原
    s.pty.resize(cols, rows);
  }

  kill(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    // exited(pty 已死):直接从 pool 删除(用户显式清理已完成会话)
    if (s.status === 'exited') {
      this.sessions.delete(sessionId);
      this.stopPollingIfIdle();
      return;
    }
    // live:标记 evicting → kill → onExit 走「彻底逐出」分支(不转 exited)
    s.evicting = true;
    s.pty.kill();
  }

  pid(sessionId: string): number | null {
    const s = this.sessions.get(sessionId);
    // 🔴 exited 显式返 null:node-pty pty.pid 退出后仍返旧值,勿对死 pid 调 processCwd(EXT-B-6)
    if (!s || s.status === 'exited') return null;
    return s.pty.pid ?? null;
  }

  /**
   * 断开该会话的**全部**订阅者(端口 close · standalone 旧直调路径 / 测试直调):
   *  - subscribers 清空 → 旧 attached=false 派生生效(断开续跑)
   *  - 🔴 解已 paused 会话:paused=false; proc.resume()(断开瞬间已憋停的会话须复活,
   *    否则无订阅者 ack → 永不 resume → 整段憋停 → 击穿 AC-1 · ARCH-B-3)
   *  - 单订阅者时与旧版逐行等价(旧测试直调不变式1)。
   */
  detach(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (s.status === 'live' && s.paused) {
      s.paused = false;
      s.pty.resume();
    }
    s.subscribers.clear();
  }

  /**
   * 只摘一个订阅者(M2 · 断连清理 hostCore.ts 调用点)。摘空 → 等价 detach 收尾(B4/不变式7):
   * live 且 paused → resume;ring 续录天然成立(无需额外动作)。仍有订阅者残留时按 B2/B5
   * 重算 min-size + 尝试 resume(摘除的订阅者可能曾是拖住 pause/放大 min 的那个)。
   */
  unsubscribe(sessionId: string, subscriberId: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (!s.subscribers.delete(subscriberId)) return; // 非订阅者:no-op
    this.recalcMinSize(s); // 内部守卫 status/size,空集或非 live 天然 no-op
    this.maybeResume(s);
  }

  /**
   * 重连收养既有会话:换/加订阅者 + resize 对账 + 回放切片 + 记账复位(BL-005 · CR-2 · M2)。
   * 🔴 全程同步禁 await(reattach 三不变式①):算切片 + 变更订阅者集合同一 tick 完成。
   * exited 分支跳过 proc.resize + 流控记账(死 pty resize 会抛 · 纯回放最终 scrollback · ARCH-B-6)。
   * @param opts.mode 缺省 'exclusive'(旧客户端/旧测试零回归):摘除全部其他订阅者(各收
   *   session:takenover)→ last-attach-wins,resize 对账 = 直接 pty.resize(与旧单 owner 逐点等价)。
   *   'mirror':保留他人订阅,仅 upsert 本订阅者,resize 对账走 min-size 重算(B5)。
   * @param opts.subscriberId 缺省 DEFAULT_SUBSCRIBER_ID(-1,旧调用点/单订阅测试兼容)。
   * @returns SessionAttachResult;会话不存在(被逐/从未有)→ null(caller 产 found=false)。
   */
  reattach(
    sessionId: string,
    newSend: (msg: HostMessage) => void,
    opts: {
      cols: number;
      rows: number;
      resumeOffset: number;
      mode?: 'mirror' | 'exclusive';
      subscriberId?: number;
    },
  ): SessionAttachResult | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;

    const mode = opts.mode ?? 'exclusive';
    const subscriberId = opts.subscriberId ?? DEFAULT_SUBSCRIBER_ID;

    // 先算回放切片(捕获至当前 absoluteOffset),再变更订阅者集合 —— 同一同步 tick,无 onData 插入
    const slice = s.ring
      ? s.ring.sliceFrom(opts.resumeOffset)
      : { data: '', baseOffset: s.absoluteOffset, full: true };
    const nextOffset = s.absoluteOffset;

    if (mode === 'exclusive') {
      // last-attach-wins(pool 内半 · hostCore 侧另摘 client.sessions):摘除全部其他订阅者,
      // 各发 session:takenover。单订阅者旧调用点(subscriberId 恒等于既有唯一 key)此循环
      // 天然空转 —— 零回归。
      for (const [subId, sub] of s.subscribers) {
        if (subId === subscriberId) continue;
        sub.send({ t: 'session:takenover', sessionId });
        s.subscribers.delete(subId);
      }
    }

    // upsert 本订阅者(unacked=0/desync=false/视口更新 · 两种 mode 一致 · B3)
    s.subscribers.set(subscriberId, {
      id: subscriberId,
      send: newSend,
      unacked: 0,
      desync: false,
      cols: opts.cols,
      rows: opts.rows,
    });

    if (mode === 'exclusive') {
      // 🔴 逐点等价旧单 owner 代码:仅复位记账标记,不额外调用 pty.resume()
      // (旧代码同款,未额外解憋停;引入新副作用会破坏「现行完全一致」不变式)。
      s.paused = false;
      if (s.status === 'live' && opts.cols >= 2 && opts.rows >= 1) {
        try {
          s.pty.resize(opts.cols, opts.rows);
        } catch (err) {
          console.warn('[host] reattach resize failed for', sessionId, err);
        }
      }
    } else {
      // mirror:不抢占他人视口,按 min-size 重算(B5);新订阅者 unacked=0 不会新增 pause
      // 需求,只可能解除既有 pause(健康订阅者已回落时 · B2)。
      if (s.status === 'live') this.recalcMinSize(s);
      this.maybeResume(s);
    }

    // full 回放 = 差分重绘的基准态已被挤出 ring → 客户端 reset 后只能拼出碎片。
    // 尺寸对账完成后拨动一下逼前台程序整屏重画(exited 会话无进程可逼,天然跳过)。
    if (slice.full && s.status === 'live') this.nudgeRedraw(s);

    return {
      found: true,
      full: slice.full,
      baseOffset: slice.baseOffset,
      data: slice.data,
      nextOffset,
      snapshot: this.snapshotOf(s),
    };
  }

  /** 列出该 host 现存会话(live + exited)+ 状态快照;embedded 会话不进 list(AC-2)。 */
  list(): SessionSnapshot[] {
    const out: SessionSnapshot[] = [];
    for (const s of this.sessions.values()) {
      if (s.mode === 'embedded') continue;
      out.push(this.snapshotOf(s));
    }
    return out;
  }

  private snapshotOf(s: Session): SessionSnapshot {
    const t = s.tracker.snapshot();
    return {
      sessionId: s.id,
      cwd: s.cwd,
      // exited 后 lastProcess 定格为退出前最后已知值;从未轮询到则兜底 shell 名
      title: s.lastProcess || s.shellName,
      status: s.status,
      state: t.state,
      quiet: t.quiet,
      altscreen: t.altscreen,
      bracketedPaste: t.bracketedPaste,
      mouseModes: t.mouseModes,
      // 🔴 exitCode 取进程 onExit(非 tracker 的最近命令退出码 · QA-B-7)
      exitCode: s.status === 'exited' ? s.exitCode : null,
    };
  }

  /** 全订阅者广播(session:event/pty:exit/pty:title · B6,不受 desync 门控 —— 轻量事件继续活)。 */
  private broadcastAll(s: Session, msg: HostMessage): void {
    for (const sub of s.subscribers.values()) sub.send(msg);
  }

  /**
   * 解析 ack 目标订阅者:显式 subscriberId → 精确查(找不到即 no-op,绝不误推进他人);
   * 缺省 → 恰一个订阅者时兼容旧调用作用于它,否则 no-op(B6 ack 独立性安全关键)。
   */
  private resolveSubscriber(s: Session, subscriberId?: number): Subscriber | undefined {
    if (subscriberId !== undefined) return s.subscribers.get(subscriberId);
    return s.subscribers.size === 1 ? s.subscribers.values().next().value : undefined;
  }

  /**
   * 派生 resume 判据(B2 v2 · 收尾评审 P2-2):
   *  - size===1:∀ 活跃订阅者 unacked < lowWatermark → resume(= 旧单 owner 行为);
   *  - size!==1(多订阅或空集):恒 resume——多订阅政体免 pause(见 onData 注释),
   *    单订阅期憋停的 pause 在第二个镜像端加入时立即释放(否则新健康端被旧卡死端
   *    饿死:paused → 无 onData → 旧端永不越 desync 阈值 → 死锁式冻结);空集 =
   *    现行 detach/unsubscribe 摘空收尾(live 且 paused → resume · 不变式7)。
   */
  private maybeResume(s: Session): void {
    if (s.status !== 'live' || !s.paused) return;
    if (s.subscribers.size === 1) {
      for (const sub of s.subscribers.values()) {
        if (sub.desync) continue;
        if (sub.unacked >= FLOW.lowWatermark) return; // 未回落 → 保持 paused
      }
    }
    s.paused = false;
    s.pty.resume();
  }

  /**
   * min-size 重算(B5,tmux 式):PTY 尺寸 = min(全体订阅者 cols) × min(全体订阅者 rows)
   * (过滤 cols<2/rows<1 的非法视口)。变化才 pty.resize;单订阅者时 min=其视口=旧单 owner
   * 行为(但该路径只在 mirror/多订阅场景调用,exclusive 走独立的直接 resize 分支)。
   */
  /**
   * 强制前台程序整屏重绘(full 回放收尾 · 修「重连后屏幕停在碎片态」)。
   *
   * 全量回放只能重放 ring 里剩下的字节,而 TUI 发的是【差分】重绘(基于它以为的屏幕态)。
   * gap 超缓冲时那个基准态早被挤掉 → 客户端 term.reset() 后拼出来的是碎片,除非让程序
   * 自己重画一遍。唯一不侵入输入流的办法是 SIGWINCH(不能塞 Ctrl-L:那是往 app 注入按键)。
   *
   * 🔴 必须【真的改一下尺寸再改回来】:内核只在 winsize 实际变化时发 SIGWINCH,而 reattach
   * 的 resize 对账在尺寸没变时是 no-op —— 这正是 ringBuffer 老注释里「靠 proc.resize 逼重绘
   * 兜底」从来没生效的原因。同 tick 改回去也不行:Ink 一类 TUI 会比对新旧尺寸,一样即跳过
   * 重绘。故先缩一行,下一拍还原,让中间尺寸可观测(用户实测「再断开重连一次就恢复」正是
   * 重连时视口尺寸恰好抖了一下、误打误撞触发了同一条路径)。
   *
   * 期间任何真实 resize 落地都会作废在途还原(见 resize / recalcMinSize),不覆盖新尺寸。
   */
  private nudgeRedraw(s: Session): void {
    if (s.status !== 'live') return;
    const cols = s.pty.cols;
    const rows = s.pty.rows;
    if (!(cols >= 2 && rows >= 2)) return; // rows-1 会退化成非法视口
    this.cancelNudge(s);
    try {
      s.pty.resize(cols, rows - 1);
    } catch (err) {
      console.warn('[host] redraw nudge failed for', s.id, err);
      return;
    }
    s.redrawNudge = setTimeout(() => {
      s.redrawNudge = null;
      if (s.status !== 'live') return;
      try {
        s.pty.resize(cols, rows);
      } catch (err) {
        console.warn('[host] redraw nudge restore failed for', s.id, err);
      }
    }, REDRAW_NUDGE_MS);
    // host 进程不该被这个定时器吊住生命周期(测试里同理)
    s.redrawNudge.unref?.();
  }

  /** 作废在途重绘拨动(真实 resize / 会话终止时调用,避免还原覆盖新尺寸)。 */
  private cancelNudge(s: Session): void {
    if (!s.redrawNudge) return;
    clearTimeout(s.redrawNudge);
    s.redrawNudge = null;
  }

  private recalcMinSize(s: Session): void {
    if (s.status !== 'live' || s.subscribers.size === 0) return;
    let minCols = Infinity;
    let minRows = Infinity;
    for (const sub of s.subscribers.values()) {
      if (sub.cols < 2 || sub.rows < 1) continue;
      if (sub.cols < minCols) minCols = sub.cols;
      if (sub.rows < minRows) minRows = sub.rows;
    }
    if (!Number.isFinite(minCols) || !Number.isFinite(minRows)) return;
    if (minCols === s.pty.cols && minRows === s.pty.rows) return;
    this.cancelNudge(s); // 真实尺寸落地 → 在途拨动还原作废(否则会还原成旧尺寸)
    try {
      s.pty.resize(minCols, minRows);
    } catch (err) {
      console.warn('[host] min-size resize failed for', s.id, err);
    }
  }

  /**
   * 逐出最旧 exited 会话(排序键 = exitedAt 升序 · 最近完成的最后逐 · 保北极星刚跑完的
   * build 最后被逐 · ARCH-B-8)。无 exited 可逐 → false(caller 拒新建,绝不逐 live)。
   */
  private evictOldestExited(): boolean {
    let oldest: Session | null = null;
    for (const s of this.sessions.values()) {
      if (s.status !== 'exited') continue;
      if (oldest === null || (s.exitedAt ?? 0) < (oldest.exitedAt ?? 0)) {
        oldest = s;
      }
    }
    if (oldest === null) return false;
    this.sessions.delete(oldest.id);
    this.stopPollingIfIdle();
    return true;
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      this.cancelNudge(s);
      s.pty.kill();
    }
    this.sessions.clear();
    this.stopPollingIfIdle();
  }

  /** 前台进程名轮询:变化时上报,用作 tab 标题与 running/idle 信号(M3 的信号①) */
  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      for (const s of this.sessions.values()) {
        // exited 会话已冻结:停对死 pty 读 .process / tick(CR-4)
        if (s.status === 'exited') continue;
        const name = s.pty.process;
        if (name && name !== s.lastProcess) {
          s.lastProcess = name;
          this.broadcastAll(s, { t: 'pty:title', sessionId: s.id, processName: name });
          s.tracker.onProcessName(name);
        }
        s.tracker.tick();
      }
    }, PROCESS_POLL_MS);
  }

  /** 无 live 会话时停轮询(exited 会话不需轮询死 pty · CR-4)。 */
  private stopPollingIfIdle(): void {
    if (!this.pollTimer) return;
    let hasLive = false;
    for (const s of this.sessions.values()) {
      if (s.status === 'live') {
        hasLive = true;
        break;
      }
    }
    if (!hasLive) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
