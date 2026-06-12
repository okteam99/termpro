// 会话事件 → UI 状态/通知 的策略层。
// Host 只产出语义事件;在不在看、要不要打扰,是 UI 的决策(本文件)。
// 策略:聚焦中的 tab 不打扰;窗口失焦才发系统通知;软信号(静默)只进
// 应用内徽标与通知中心,不发系统通知。

import { hostClient } from './hostClient';
import { findTabBySessionId } from '../terminal/terminalRegistry';
import { useAppStore } from '../state/store';

let inited = false;
/** tabId → 最近一次 cmd-done 的退出码(state:idle 到来时消费) */
const lastExit = new Map<string, number | null>();
/** tabId → 上次铃声系统通知时间(限流,防 bell 风暴) */
const lastBellNotify = new Map<string, number>();
const BELL_THROTTLE_MS = 5_000;

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
    const label = tab.customName ?? tab.processName ?? tab.title;

    switch (event.kind) {
      case 'state': {
        const prev = tab.activity ?? 'idle';
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
        // 铃声限流:同 tab 5s 内只进一次通知(防 cat 二进制等 bell 风暴)
        const last = lastBellNotify.get(tabId) ?? 0;
        if (Date.now() - last < BELL_THROTTLE_MS) break;
        lastBellNotify.set(tabId, Date.now());
        const text = `${label} · 响铃(可能在等输入)`;
        s.pushNotification({ workspaceId: ws.id, tabId, kind: 'bell', text });
        osNotify('TermPro · 注意', text, ws.id, tabId);
        break;
      }

      case 'notify': {
        const text = `${label} · ${event.title ? `${event.title}: ` : ''}${event.body}`;
        if (!focusedTab && (tab.activity ?? 'idle') === 'running') {
          s.updateTab(tabId, { waiting: true });
        }
        s.pushNotification({ workspaceId: ws.id, tabId, kind: 'notify', text });
        osNotify(event.title || 'TermPro', event.body, ws.id, tabId);
        break;
      }

      case 'quiet':
        if (event.quiet) {
          if (!focusedTab && (tab.activity ?? 'idle') === 'running') {
            s.updateTab(tabId, { waiting: true });
            s.pushNotification({
              workspaceId: ws.id,
              tabId,
              kind: 'waiting',
              text: `${label} · 静默 10s+,可能在等输入`,
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
  });

  // Dock 角标 = 需要注意的 tab 数(waiting / unseenDone);顺带清理
  // 已关闭 tab 的辅助 Map,避免缓慢泄漏
  let lastBadge = -1;
  useAppStore.subscribe((s) => {
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
    for (const id of [...lastBellNotify.keys()]) {
      if (!liveTabs.has(id)) lastBellNotify.delete(id);
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
