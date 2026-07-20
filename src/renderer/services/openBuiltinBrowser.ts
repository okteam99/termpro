// 内置浏览器的统一开口(设置项 builtinBrowserSurface 的消费方 · 用户指令 2026-07-20):
// 终端链接、tabbar 地球钮都走这里,保证「默认打开方式」在所有入口一致。
//
// 落位优先级(手动摆放 > 默认值):
//   1. 该终端 tab 的窗格已弹出为独立窗口 → 经 main 转投壳窗(壳窗自带聚焦);
//   2. 窗格正显示在主窗面板里(面板开着且有标签)→ 就地追加标签,不搬家;
//   3. 都没有(全新打开)→ 按 builtinBrowserSurface:'window' 弹独立窗口,'pane' 开面板。
//
// 🔴 window 分支必须先 addBrowserTab 再读回状态:壳窗以「完整窗格快照」起步并接管
// 所有权(见 BrowserPanel.handlePopout),快照里没有新标签的话链接就丢了。

import { useAppStore } from '../state/store';

export function openBuiltinBrowser(terminalTabId: string, url = ''): void {
  const s = useAppStore.getState();
  const ws = s.workspaces.find((w) => w.tabs.some((tb) => tb.id === terminalTabId));
  const tab = ws?.tabs.find((tb) => tb.id === terminalTabId);

  // 1. 已弹出:内容归壳窗所有,主窗镜像绝不自己种标签
  if (tab?.browser?.poppedOut) {
    window.okwork?.browserPane?.addTab?.(terminalTabId, url);
    return;
  }

  // 2. 已在面板里显示 / 3. 设置为面板 → 直接落面板(addBrowserTab 顺手开面板)
  const dockedVisible = s.browserPanelOpen && (tab?.browser?.tabs.length ?? 0) > 0;
  if (dockedVisible || s.builtinBrowserSurface === 'pane') {
    s.addBrowserTab(terminalTabId, url);
    return;
  }

  // 3. 独立窗口:先把标签种进窗格,再拿最新快照弹窗并移交所有权
  s.addBrowserTab(terminalTabId, url);
  const after = useAppStore.getState();
  const afterWs = after.workspaces.find((w) => w.tabs.some((tb) => tb.id === terminalTabId));
  const afterTab = afterWs?.tabs.find((tb) => tb.id === terminalTabId);
  const pane = afterTab?.browser;
  if (!afterTab || !pane || pane.tabs.length === 0) return; // tab 已关等竞态:标签留在镜像里即可
  window.okwork?.browserPane?.popout?.({
    terminalTabId,
    tabName: afterTab.customName ?? afterTab.title ?? 'Tab',
    ownerHostId: afterWs?.hostId ?? 'local',
    pane: { tabs: pane.tabs, activeTabId: pane.activeTabId },
  });
  after.popOutBrowserPane(terminalTabId);
}
