// 终端链接打开策略(设置项 linkBrowserMode 的消费方 · 用户指令 2026-07-14):
// 'builtin' → 恒落来源终端 tab 的内置浏览器窗格(面板/独立窗口由 openBuiltinBrowser 定);
// 'system' → 恒走系统浏览器;
// 'builtinForRemote' → 仅远程终端 tab 用内置(本机 tab 走系统)——远程场景里
//   localhost 类地址只有经内置浏览器+远程网络出口才可达。
// 返回 true = 已在内置浏览器处理;false = 调用方(activateWebLink)落系统浏览器。
// ⌘/Ctrl+点击在 terminalLinks.activateWebLink 层已短路,不进本策略。

import { useAppStore } from '../state/store';
import { openBuiltinBrowser } from './openBuiltinBrowser';

export function openTerminalLinkViaPolicy(terminalTabId: string, url: string): boolean {
  const s = useAppStore.getState();
  if (s.linkBrowserMode === 'system') return false;
  if (s.linkBrowserMode === 'builtinForRemote') {
    const ws = s.workspaces.find((w) => w.tabs.some((tb) => tb.id === terminalTabId));
    // 找不到归属 ws(极早期/已关 tab 竞态)按本机语义处理 → 系统浏览器,安全降级
    if (!ws || ws.hostId === 'local') return false;
  }
  // 落面板还是独立窗口由 builtinBrowserSurface + 当前摆放决定(openBuiltinBrowser 单源)
  openBuiltinBrowser(terminalTabId, url);
  return true;
}
