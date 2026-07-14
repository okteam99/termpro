// 浏览器网络出口跟随活跃终端 tab 所属机器(用户指令 2026-07-14「默认选项跟着 tab
// 所属的机器走」)。出口仍是面板级(persist:browser session 级代理,硬约束不变),
// 本模块只做「默认值对齐」:
//   - 面板打开 / 打开状态下切换活跃终端 tab → browserNet.set(该 tab 所属 ws.hostId)
//     (远程未 ready 时 main 按既有语义回退 local,UI 如实显示);
//   - 停留在同一 tab 期间不重复下发——用户手动改出口在该 tab 内生效,切 tab 才重新对齐;
//   - 面板关闭不跟随(不为不可见的浏览做代理churn),下次打开重新对齐。
// 权威态单源仍在 main(BrowserNetworkController);本模块只发 set 意图,不镜像状态。

import { useAppStore } from '../state/store';

let initialized = false;

export function initBrowserNetFollow(): void {
  if (initialized) return;
  initialized = true;

  let lastTabId: string | null = null;
  const sync = (): void => {
    const s = useAppStore.getState();
    if (!s.browserPanelOpen) {
      lastTabId = null; // 关面板重置:下次打开对当前 tab 重新对齐
      return;
    }
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    const tabId = ws?.activeTabId ?? null;
    if (!tabId || tabId === lastTabId) return;
    lastTabId = tabId;
    void window.okwork?.browserNet?.set?.(ws!.hostId);
  };

  sync(); // 初始对齐(面板可能随存档恢复即打开)
  useAppStore.subscribe(sync);
}
