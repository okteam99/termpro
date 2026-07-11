// 会话事件 → UI 状态/通知 的策略层。
// Host 只产出语义事件;在不在看、要不要打扰,是 UI 的决策(本文件)。
// 策略:聚焦中的 tab 不打扰;当前 tab(激活工作区的激活 tab,即用户
// 正看着或回到窗口第一眼就能看到的)无论窗口聚焦与否都不生成通知,
// 只亮状态点;窗口失焦才发系统通知;软信号(静默)只进应用内徽标与
// 通知中心,不发系统通知;每 tab 通知一次后,直到用户回看该 tab
// (clearAttention)才复位——命令周期翻转(running/idle)不复位,因为
// Agent 会自驱地反复翻转状态,那不是用户输入,不应解锁重复通知。
//
// BL-004:sessionId 仅 per-host 唯一,本机 + 远程订阅共用同一策略——抽出
// routeSessionEvent(hostId, sessionId, event) 作为单一 router,本机订阅走
// initSessionEvents()(生命周期同现状,随 app),远程订阅由 remoteWorkspaceSync
// 的 ready 编排调用同一 router(不在本模块级 init,避免「谁在 host 连上时挂
// session 订阅」职责悬空)。反查改 (hostId,sessionId) 复合键(findTab),
// 防本机+远程同名 sessionId 串 tab。

import { hostRegistry } from './hostRegistry';
import { findTab } from '../terminal/terminalRegistry';
import { tabPathLabel, useAppStore } from '../state/store';
import type { SessionEvent } from '../../shared/protocol';
import {
  decideQuietAction,
  hadOutputSinceLeave,
  pruneClosedTabs,
  recordDeactivated,
  resetTabActivity,
} from './quietGate';
import { t } from '../../shared/i18n';

let inited = false;
/** tabId → 最近一次 cmd-done 的退出码(state:idle 到来时消费) */
const lastExit = new Map<string, number | null>();
/** 已通知过的 tab(done/bell/quiet/notify 共用一把闩锁)。一旦为某 tab
 *  出过通知,在用户回看该 tab(clearAttention)之前不再出第二条——
 *  Agent 自驱的 running/idle 翻转、断续输出、内容变体的重复 ping 都不
 *  解锁(均非用户输入)。状态点/角标照常亮,只是不再"通知"。 */
const waitingNotified = new Set<string>();

/** 用户正看着的 tab 视为已读:解除其等待提醒闩锁 */
function clearAttention(): void {
  if (!document.hasFocus()) return;
  const s = useAppStore.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  const tabId = ws?.activeTabId;
  if (!tabId) return;
  waitingNotified.delete(tabId);
}

/**
 * 单一 router:(hostId, sessionId) 复合键定位 tab,套现有全部通知/角标策略。
 * 本机订阅(initSessionEvents)与远程订阅(remoteWorkspaceSync ready 编排)
 * 共用同一函数,保证本机路径行为在改造前后逐条等价(AC-6/QA-15)。
 */
export function routeSessionEvent(
  hostId: string,
  sessionId: string,
  event: SessionEvent,
): void {
  const tabId = findTab(hostId, sessionId);
  if (!tabId) return;
  const s = useAppStore.getState();
  const ws = s.workspaces.find((w) => w.tabs.some((t) => t.id === tabId));
  const tab = ws?.tabs.find((t) => t.id === tabId);
  if (!ws || !tab) return;

  // 当前 tab:激活工作区的激活 tab(窗口失焦时即"最后打开的")。
  // 它的动静用户自己看得到,不为它生成任何通知
  const isCurrentTab =
    s.activeWorkspaceId === ws.id && ws.activeTabId === tabId;
  const focusedTab = document.hasFocus() && isCurrentTab;
  // 与 TabBar 显示规则一致,通知里能对上是哪个 tab。homedir 按该 event 归属
  // ws 的 host 取(forWorkspace(ws)),远程机路径 tildify 用远程机 homedir
  const label =
    tab.customName ??
    tabPathLabel(ws.root, tab.cwd, hostRegistry.forWorkspace(ws).info?.homedir);

  switch (event.kind) {
    case 'state': {
      const prev = tab.activity ?? 'idle';
      // 注意:状态翻转不复位闩锁。Agent 的 shell 集成会刷出多轮
      // running→idle,若每轮都复位就会反复弹通知(本次 review 根因)。
      // 只有用户回看 tab(clearAttention)才复位。
      if (event.state === 'running') {
        s.updateTab(tabId, { activity: 'running' });
        break;
      }
      // idle:单次 set 合并全部变更,避免徽标订阅看到撕裂中间态。
      // 当前 tab 不算"后台完成":回到窗口直接看得到结果,不标
      // unseenDone(否则角标挂死——它不会被再次激活来清标记)
      const finishedInBackground =
        prev === 'running' && !focusedTab && !isCurrentTab;
      const ec = lastExit.get(tabId);
      lastExit.delete(tabId);
      s.updateTab(tabId, {
        activity: 'idle',
        waiting: false,
        ...(finishedInBackground ? { unseenDone: true } : {}),
      });
      // 角标(unseenDone)照常亮;但通知每 tab 只出一次,回看才复位
      if (finishedInBackground && !waitingNotified.has(tabId)) {
        waitingNotified.add(tabId);
        const text =
          ec === undefined || ec === null
            ? t('{label} · Command finished', { label })
            : t('{label} · Command finished (exit code {code})', { label, code: ec });
        s.pushNotification({ workspaceId: ws.id, tabId, kind: 'done', text });
        osNotify(t('TermPro · Done'), text, ws.id, tabId);
      }
      break;
    }

    case 'cmd-done':
      // 不直接通知:紧随其后的 state:idle 统一处理,这里只存退出码
      lastExit.set(tabId, event.exitCode);
      break;

    case 'bell': {
      if (focusedTab) break;
      s.updateTab(tabId, { waiting: true });
      if (isCurrentTab) break; // 当前 tab:亮状态点即可,不进通知
      // 同一等待期只提醒一次(也覆盖 cat 二进制等 bell 风暴)
      if (waitingNotified.has(tabId)) break;
      waitingNotified.add(tabId);
      const text = t('{label} · Bell rang (may be waiting for input)', { label });
      s.pushNotification({ workspaceId: ws.id, tabId, kind: 'bell', text });
      osNotify(t('TermPro · Attention'), text, ws.id, tabId);
      break;
    }

    case 'notify': {
      if (focusedTab) break; // 正看着的 tab 不打扰
      const text = `${label} · ${event.title ? `${event.title}: ` : ''}${event.body}`;
      if ((tab.activity ?? 'idle') === 'running') {
        s.updateTab(tabId, { waiting: true });
      }
      if (isCurrentTab) break; // 当前 tab:亮状态点即可,不进通知
      // 每 tab 只通知一次(Agent 会重复 ping,内容变体也不放行),
      // 回看该 tab 才复位
      if (waitingNotified.has(tabId)) break;
      waitingNotified.add(tabId);
      s.pushNotification({ workspaceId: ws.id, tabId, kind: 'notify', text });
      osNotify(event.title || 'TermPro', event.body, ws.id, tabId);
      break;
    }

    case 'quiet':
      if (event.quiet) {
        // 后台 tab 仅在「离开后有新输出再停住」才提示;离开后无新增不打扰
        // (AC-1/AC-2)。当前 tab / 聚焦 tab 行为不变(AC-3)。
        const action = decideQuietAction({
          focusedTab,
          isCurrentTab,
          running: (tab.activity ?? 'idle') === 'running',
          hadOutputSinceLeave: hadOutputSinceLeave(tabId),
          alreadyNotified: waitingNotified.has(tabId),
        });
        if (action.setWaiting) s.updateTab(tabId, { waiting: true });
        if (action.pushNotification) {
          waitingNotified.add(tabId);
          s.pushNotification({
            workspaceId: ws.id,
            tabId,
            kind: 'waiting',
            text: t('{label} · Quiet for 1+ min, may be waiting for input', { label }),
          });
        }
      } else {
        s.updateTab(tabId, { waiting: false });
      }
      break;

    case 'altscreen':
      // 暂不参与策略(保留信号)
      break;
  }
}

export function initSessionEvents(): void {
  if (inited) return;
  inited = true;

  hostRegistry
    .local()
    .onSessionEvent((sessionId, event) => routeSessionEvent('local', sessionId, event));

  // 回看即解锁:窗口重新聚焦、或聚焦状态下切 tab(store 任何变更都会
  // 触发 subscribe,覆盖 setActiveTab 路径)
  window.addEventListener('focus', clearAttention);

  // Dock 角标 = 需要注意的 tab 数(waiting / unseenDone);顺带清理
  // 已关闭 tab 的辅助 Map,避免缓慢泄漏
  let lastBadge = -1;
  // 追踪激活 tab 变化:旧的→后台(记 deactivatedAt,供「离开后是否有新输出」判定);
  // 新的→重置基线(用户在看,要求下一轮重新「去激活后有新增」才提示,AC-4/AC-5)
  let prevActiveTabId: string | null = null;
  useAppStore.subscribe((s) => {
    clearAttention();
    const aw = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    const curActiveTabId = aw?.activeTabId ?? null;
    if (curActiveTabId !== prevActiveTabId) {
      if (prevActiveTabId) recordDeactivated(prevActiveTabId);
      if (curActiveTabId) resetTabActivity(curActiveTabId);
      prevActiveTabId = curActiveTabId;
    }
    let count = 0;
    const liveTabs = new Set<string>();
    for (const w of s.workspaces) {
      for (const t of w.tabs) {
        liveTabs.add(t.id);
        if (t.waiting || t.unseenDone) count++;
      }
    }
    for (const id of [...lastExit.keys()]) {
      if (!liveTabs.has(id)) lastExit.delete(id);
    }
    for (const id of [...waitingNotified]) {
      if (!liveTabs.has(id)) waitingNotified.delete(id);
    }
    pruneClosedTabs(liveTabs);
    if (count !== lastBadge) {
      lastBadge = count;
      window.termpro.setDockBadge(count);
    }
  });
}

/** 仅供单测:清空本模块的跨事件闩锁状态(lastExit/waitingNotified),避免用例间串味。 */
export function __resetSessionEventsStateForTest(): void {
  lastExit.clear();
  waitingNotified.clear();
}

function osNotify(
  title: string,
  body: string,
  workspaceId: string,
  tabId: string,
): void {
  if (document.hasFocus()) return; // 聚焦时只走应用内徽标
  try {
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.termpro.focusWindow();
      const s = useAppStore.getState();
      s.setActiveWorkspace(workspaceId);
      s.setActiveTab(workspaceId, tabId);
    };
  } catch {
    // Notification 不可用则静默
  }
}
