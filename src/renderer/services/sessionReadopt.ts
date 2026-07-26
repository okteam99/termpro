// 服务端会话收养(PENDING-006 落地):以服务端 session.list 为单源,把客户端没有对应
// tab/inst 的既有会话重建成 tab 并 attach 回放——覆盖「客户端重启后重连」「断开期丢过
// inst / full-drop 后重连」两类场景。语义:只要用户没主动关 tab(pty.kill)/删项目,
// 服务端会话(live 续跑 + exited 保留)在下次连接时全量回到 UI。
//
// 结构:mapSessionCwdToWorkspace(纯函数·最长 root 前缀匹配)→ rebuildTabForSnapshot
// (store.adoptSessionTab 建 tab 回传 tabId)→ readoptHostSessions(readoptHost 的
// 生产 hooks 单源 + 每 hostId 串行化)。reconcileBadge 从 reconnectWiring 迁入本模块
// (wiring 保留 re-export 兼容),避免 wiring↔本模块循环依赖。
//
// 本模块对 hostId 无远程假设('local'|configId 同构收养):client 经 hostRegistry.forHostId
// 寻址,workspace 映射按 w.hostId 过滤。当前调用方两处(均远程):reconnectWiring(闪断重连
// onReconnected)与 remoteWorkspaceSync(host ready 首拉 workspace.list 落地后)——后者是
// 「重启后重连」的收养入口:必须等注册表进 store,cwd→workspace 映射才有素材。
// 本地('local')收养入口随「本地 host standalone 化」里程碑接入,约束相同:hydrate 落地后调用。

import {
  readoptHost,
  findTab,
  bindRestoredSessionTab,
  writeTerminalNotice,
} from '../terminal/terminalRegistry';
import { t } from '../../shared/i18n';
import { useAppStore } from '../state/store';
import type { WorkspaceState } from '../state/store';
import type { SessionSnapshot } from '../../shared/protocol';
import type { HostClient } from './hostClient';

/**
 * 据快照对账 tab 徽标(AC-5/AC-12·渲染半侧·A3 review-fix):
 * - activity:running→保 running·idle/exited→归 idle(消除过期 running 残留);
 * - 🔴 status==='exited' → 落 `tab.exited=true` + 透传 `exitCode`(北极星:断线期 build 跑完·重连
 *   看到「✓ exit N 已完成」徽标)。host reattach 不重发 pty:exit、App.tsx onExit 不触发·唯有此接线
 *   能点亮 store 的 `tab.exited`(TabBar 据此渲染 tabbar-tab--exited + hint);缺此则徽标永不亮(Q2)。
 */
export function reconcileBadge(
  hostId: string,
  sessionId: string,
  snapshot: SessionSnapshot,
): void {
  const tabId = findTab(hostId, sessionId);
  if (!tabId) return;
  // 收养成功 → 清「已提示」位:此后若再收养失败,才是值得再说一次的新情况(见 noticedTabs)
  noticedTabs.delete(tabId);
  const exited = snapshot.status === 'exited';
  useAppStore.getState().updateTab(tabId, {
    activity: snapshot.state === 'running' ? 'running' : 'idle',
    // exited 是单调终态,只在 exited 快照置真(不把 live 快照回写成 false·避免抹掉已亮徽标)
    ...(exited
      ? { exited: true, exitCode: snapshot.exitCode ?? undefined }
      : {}),
  });
}

/**
 * 会话 cwd → 该 host 下归属 workspace(最长 root 前缀匹配·纯函数)。
 * 匹配不到(如 spawn cwd 回退过家目录 / 项目已删)→ null,调用方跳过该会话
 * (留在服务端,不 kill——收养只做加法)。
 */
export function mapSessionCwdToWorkspace(
  workspaces: readonly WorkspaceState[],
  hostId: string,
  cwd: string,
): WorkspaceState | null {
  let best: WorkspaceState | null = null;
  let bestLen = -1; // 归一化 root 长度(比较基准统一用归一化值,不混用原始 w.root)
  for (const w of workspaces) {
    if (w.hostId !== hostId) continue;
    const root = w.root.endsWith('/') ? w.root.slice(0, -1) : w.root;
    if (cwd !== root && !cwd.startsWith(root + '/')) continue;
    if (root.length > bestLen) {
      best = w;
      bestLen = root.length;
    }
  }
  return best;
}

/** readoptHost path② 的生产 rebuildTab:cwd 映射到 workspace → 建 tab 回传 tabId。 */
export function rebuildTabForSnapshot(
  hostId: string,
  snap: SessionSnapshot,
): string | null {
  const s = useAppStore.getState();
  const ws = mapSessionCwdToWorkspace(s.workspaces, hostId, snap.cwd);
  if (!ws) return null;
  return s.adoptSessionTab(ws.id, snap.cwd, snap.title);
}

/**
 * 远程 tab 布局恢复(用户规则 2026-07:服务端升级/重启后 session 内容可丢,tab 名称/
 * 数量/顺序不能丢)。调用点唯一:startRemoteWorkspaceSync 在首拉 workspace.list 落地
 * (setHostWorkspaces)之后、readoptHostSessions 之前**同步**调用——同步是硬约束:
 * 恢复 tab 的 sessionId 预绑定必须赶在 React 挂载 TerminalView(ensureSession)之前,
 * 否则挂载先 new spawn,收养路径①就接不回原会话(变成重复 tab)。
 *
 * 消费即删(单次性):ws 已带 tab(闪断未 drop,live 视图态为准)或 ws 已不在注册表
 * (服务端删除项目)→ 对应条目直接丢弃,不留陈旧布局。
 */
export function restoreRemoteTabLayouts(
  configId: string,
  bind: typeof bindRestoredSessionTab = bindRestoredSessionTab,
): void {
  const s = useAppStore.getState();
  for (const layout of s.consumeRemoteTabLayouts(configId)) {
    if (
      !s.restoreWorkspaceTabs(
        layout.workspaceId,
        layout.tabs,
        layout.activeTabId,
        layout.browserProfileId,
      )
    ) {
      continue;
    }
    for (const t of layout.tabs) {
      if (t.sessionId) bind(t.id, configId, t.sessionId, t.cwd);
    }
  }
}

/**
 * 本地孤儿会话回收(评审 P2-2):路径② 映射不到 workspace 的**本地**会话(cwd 曾回退
 * home / workspace 已删)直接 kill——embedded 时代 reload 即 kill,不回收是「续跑却
 * 不可见不可达」的行为回归。仅本地:远程维持「收养只做加法」(其他设备可能还挂着)。
 */
function reapUnmappedLocalSession(
  _hostId: string,
  snap: SessionSnapshot,
  client: HostClient,
): void {
  console.warn(
    '[sessionReadopt] reaping unmapped local session %s cwd=%s',
    snap.sessionId,
    snap.cwd,
  );
  void client.rpc('pty.kill', { sessionId: snap.sessionId }).catch(() => undefined);
}

/** hostId → 在途收养 promise(串行化尾指针) */
const inflight = new Map<string, Promise<void>>();

/** 收养失败重试退避(2026-07-23「连着但无法输入」):readoptHost 幂等(已收养 inst
 *  增量 re-attach 近零成本),整轮重跑安全。host 已 drop 时 getClient 落空 → readopt
 *  早退成功,重试链自然终止。 */
const READOPT_RETRY_DELAYS_MS: readonly number[] = [2000, 6000];

/**
 * 已写过收养失败提示、且此后未成功收养过的 tab。
 * 提示是写进 xterm 缓冲的,对满屏 TUI 而言每写一行就是一行错位 —— 链路反复闪断时每轮
 * 重连都补一条,几轮下来就把 TUI 界面戳成筛子(用户实测截图:同一行连刷 5 遍)。
 * 一条提示足够可行动,重复毫无新增信息:收养成功前只写一次(见 reconcileBadge 清位)。
 */
const noticedTabs = new Set<string>();

/** 末次重试仍失败 → 终端里说话(「不许无声死 tab」惯例):该 tab 的输入正被 host
 *  归属门静默丢弃,必须给用户一条可行动的提示。同一 tab 收养成功前只说一次。 */
function notifyAdoptFailed(tabId: string, error: unknown): void {
  if (noticedTabs.has(tabId)) return;
  noticedTabs.add(tabId);
  const message = error instanceof Error ? error.message : String(error);
  writeTerminalNotice(
    tabId,
    t(
      '[OkWork] Could not restore this session after reconnecting: {message} — disconnect and reconnect this machine to retry',
      { message },
    ),
  );
}

/** 测试钩子:清空「已提示」记忆(生产由收养成功经 reconcileBadge 清位)。 */
export function __resetAdoptNoticeMemoForTests(): void {
  noticedTabs.clear();
}

/**
 * 收养入口(生产 hooks 单源·hostId 同构:'local'|configId):同 hostId 的并发调用
 * 串行执行——onReconnected(闪断)与 startRemoteWorkspaceSync(ready 首拉后)可能
 * 背靠背触发,并行跑会双双看到「本地无 inst」而重建两份 tab;串行后后一轮经
 * adoptedSids/localSids 去重自然收敛为 no-op。
 * 失败退避重试(READOPT_RETRY_DELAYS_MS,重试轮全部串在同一尾指针内);全部尝试
 * 失败只 WARN + 逐失败 tab 终端提示(收养是尽力恢复,不阻断连接可用性)——绝不能
 * 静默放弃:未收养的 inst 在 host 侧无归属,pty:input 会被无声丢弃(输入黑洞)。
 */
export function readoptHostSessions(
  hostId: string,
  readopt: typeof readoptHost = readoptHost,
  opts?: {
    retryDelaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const delays = opts?.retryDelaysMs ?? READOPT_RETRY_DELAYS_MS;
  const sleep =
    opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempt = (isFinal: boolean): Promise<void> =>
    readopt(hostId, {
      reconcileBadge,
      rebuildTab: rebuildTabForSnapshot,
      // 终端可见提示只挂末次尝试:中间尝试静默重试,避免瞬断场景刷重复提示行
      ...(isFinal ? { onAdoptFailed: notifyAdoptFailed } : {}),
      // 本地孤儿回收策略仅挂 'local'(评审 P2-2);远程不传 → 默认 no-op 只做加法
      ...(hostId === 'local' ? { onUnadopted: reapUnmappedLocalSession } : {}),
    });
  const prev = inflight.get(hostId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      for (let i = 0; ; i++) {
        const isFinal = i >= delays.length;
        try {
          await attempt(isFinal);
          return;
        } catch (err) {
          if (isFinal) throw err;
          console.warn(
            '[sessionReadopt] readopt attempt %d failed hostId=%s — retrying in %dms',
            i + 1,
            hostId,
            delays[i],
            err,
          );
          await sleep(delays[i]);
        }
      }
    })
    .catch((err) => {
      console.warn('[sessionReadopt] readopt failed hostId=%s', hostId, err);
    })
    .finally(() => {
      if (inflight.get(hostId) === next) inflight.delete(hostId);
    });
  inflight.set(hostId, next);
  return next;
}
