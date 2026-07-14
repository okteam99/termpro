// 在用出口集合上报(标签级出口 · 2026-07):订阅 store,计算「面板打开时全部终端 tab
// 的全部浏览器标签」的出口全集(resolveBrowserTabNet:显式 netHostId 优先,缺省=
// 所属机器),变化时声明式上报 main(browserNet.syncExits)——main 对账 acquire/release
// SOCKS 与分区代理。面板关闭 = webview 全卸载 = 集合为空(远程 SOCKS 全回收)。
// 顶替旧 browserNetFollow(全局单出口跟随):标签级出口下「跟着机器走」由新建标签的
// netHostId 默认值承担,无需再切全局代理。

import { resolveBrowserTabNet, useAppStore } from '../state/store';

let initialized = false;

/** 计算当前在用的远程出口集合(排序去重;'local' 直连不上报)。 */
export function collectExits(s: {
  browserPanelOpen: boolean;
  workspaces: Array<{
    hostId: string;
    tabs: Array<{ browser?: { tabs: Array<{ netHostId?: string }> } }>;
  }>;
}): string[] {
  if (!s.browserPanelOpen) return [];
  const exits = new Set<string>();
  for (const w of s.workspaces) {
    for (const t of w.tabs) {
      for (const bt of t.browser?.tabs ?? []) {
        const hostId = resolveBrowserTabNet(bt, w.hostId);
        if (hostId !== 'local') exits.add(hostId);
      }
    }
  }
  return [...exits].sort();
}

export function initExitsSync(): void {
  if (initialized) return;
  initialized = true;

  let lastKey = '__unset__';
  const sync = (): void => {
    const exits = collectExits(useAppStore.getState());
    const key = exits.join(',');
    if (key === lastKey) return;
    lastKey = key;
    void window.okwork?.browserNet?.syncExits?.(exits);
  };

  sync();
  useAppStore.subscribe(sync);
}
