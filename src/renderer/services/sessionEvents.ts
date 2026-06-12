// 会话事件 → UI 状态/通知 的策略层。
// Host 只产出语义事件;在不在看、要不要打扰,是 UI 的决策(本文件)。
// 策略:聚焦中的 tab 不打扰;窗口失焦才发系统通知;软信号(静默)只进
// 应用内徽标与通知中心,不发系统通知;同一等待期每 tab 只提醒一次
// (闩锁,用户回看该 tab 或命令周期翻转才复位)。

import { hostClient } from './hostClient';
import { findTabBySessionId } from '../terminal/terminalRegistry';
import { tabPathLabel, useAppStore } from '../state/store';

let inited = false;
/** tabId → 最近一次 cmd-done 的退出码(state:idle 到来时消费) */
const lastExit = new Map<string, number | null>();
/** 已就「可能在等输入」提醒过的 tab(bell/quiet/notify 共用闩锁)。
 *  codex 等 Agent 输出断续,quiet/bell 信号会反复翻转——闩锁保证
 *  同一等待期只刷一条,直到用户回看或命令周期结束 */
const waitingNotified = new Set<string>();
/** tabId → 最近一条 notify 文本(闩锁期内相同内容不重复进通知) */
const lastNotifyText = new Map<string, string>();

/** 用户正看着的 tab 视为已读:解除其等待提醒闩锁 */
function clearAttention(): void {
  if (!document.hasFocus()) return;
  const s = useAppStore.getState();
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  const tabId = ws?.activeTabId;
  if (!tabId) return;
  waitingNotified.delete(tabId);
  lastNotifyText.delete(tabId);
}

export function initSessionEvents(): void {
  if (inited) return;
  inited = true;

  hostClient.onSessionEvent((sessionId, event) => {
    const tabId = findTabBySessionId(sessionId);
    if (!tabId) return;
    const s = useAppStore.getState();
    const ws = s.workspaces.find((w) => w.tabs.some((t) => t.id === tabId));
    const tab = ws?.tabs.find((t) => t.id === tabId);
    if (!ws || !tab) return;

    const focusedTab =
      document.hasFocus() &&
      s.activeWorkspaceId === ws.id &&
      ws.activeTabId === tabId;
    // 与 TabBar 显示规则一致,通知里能对上是哪个 tab
    const label =
      tab.customName ?? tabPathLabel(ws.root, tab.cwd, hostClient.info?.homedir);

    switch (event.kind) {
      case 'state': {
        const prev = tab.activity ?? 'idle';
        // 状态翻转 = 新的命令周期,等待提醒闩锁随之复位
        waitingNotified.delete(tabId);
        lastNotifyText.delete(tabId);
        if (event.state === 'running') {
          s.updateTab(tabId, { activity: 'running' });
          break;
        }
        // idle:单次 set 合并全部变更,避免徽标订阅看到撕裂中间态
        const finishedInBackground = prev === 'running' && !focusedTab;
        const ec = lastExit.get(tabId);
        lastExit.delete(tabId);
        s.updateTab(tabId, {
          activity: 'idle',
          waiting: false,
          ...(finishedInBackground ? { unseenDone: true } : {}),
        });
        if (finishedInBackground) {
          const text =
            ec === undefined || ec === null
              ? `${label} · 命令完成`
              : `${label} · 命令完成(退出码 ${ec})`;
          s.pushNotification({ workspaceId: ws.id, tabId, kind: 'done', text });
          osNotify('TermPro · 完成', text, ws.id, tabId);
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
        // 同一等待期只提醒一次(也覆盖 cat 二进制等 bell 风暴)
        if (waitingNotified.has(tabId)) break;
        waitingNotified.add(tabId);
        const text = `${label} · 响铃(可能在等输入)`;
        s.pushNotification({ workspaceId: ws.id, tabId, kind: 'bell', text });
        osNotify('TermPro · 注意', text, ws.id, tabId);
        break;
      }

      case 'notify': {
        if (focusedTab) break; // 正看着的 tab 不打扰
        const text = `${label} · ${event.title ? `${event.title}: ` : ''}${event.body}`;
        if ((tab.activity ?? 'idle') === 'running') {
          s.updateTab(tabId, { waiting: true });
        }
        // 闩锁期内相同内容不重复进通知(Agent 重复 ping);新内容放行
        if (waitingNotified.has(tabId) && lastNotifyText.get(tabId) === text) {
          break;
        }
        waitingNotified.add(tabId);
        lastNotifyText.set(tabId, text);
        s.pushNotification({ workspaceId: ws.id, tabId, kind: 'notify', text });
        osNotify(event.title || 'TermPro', event.body, ws.id, tabId);
        break;
      }

      case 'quiet':
        if (event.quiet) {
          if (!focusedTab && (tab.activity ?? 'idle') === 'running') {
            s.updateTab(tabId, { waiting: true });
            // 输出断续 → quiet 反复翻转:同一等待期只进一条通知
            if (!waitingNotified.has(tabId)) {
              waitingNotified.add(tabId);
              s.pushNotification({
                workspaceId: ws.id,
                tabId,
                kind: 'waiting',
                text: `${label} · 静默 10s+,可能在等输入`,
              });
            }
          }
        } else {
          s.updateTab(tabId, { waiting: false });
        }
        break;

      case 'altscreen':
        // 暂不参与策略(保留信号)
        break;
    }
  });

  // 回看即解锁:窗口重新聚焦、或聚焦状态下切 tab(store 任何变更都会
  // 触发 subscribe,覆盖 setActiveTab 路径)
  window.addEventListener('focus', clearAttention);

  // Dock 角标 = 需要注意的 tab 数(waiting / unseenDone);顺带清理
  // 已关闭 tab 的辅助 Map,避免缓慢泄漏
  let lastBadge = -1;
  useAppStore.subscribe((s) => {
    clearAttention();
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
    for (const id of [...lastNotifyText.keys()]) {
      if (!liveTabs.has(id)) lastNotifyText.delete(id);
    }
    if (count !== lastBadge) {
      lastBadge = count;
      window.termpro.setDockBadge(count);
    }
  });
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
