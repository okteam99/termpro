// 主窗侧:workspace 的浏览器 profile 绑定变更 → 转发给该 ws 已弹出的壳窗
// (壳窗 store 独立,收到后按新 profile 重挂 webview 换分区)。变更源两路:
// 主窗 WorkspaceEditModal 保存,或壳窗内编辑经 main 回流(App.onWorkspaceEdit,
// 发起壳窗已本地生效,用 exceptTerminalTabId 跳过防重复推送)。
import { useAppStore } from '../state/store';

export function relayProfileToPoppedPanes(
  workspaceId: string,
  profileId: string,
  exceptTerminalTabId?: string,
): void {
  const ws = useAppStore.getState().workspaces.find((w) => w.id === workspaceId);
  for (const tb of ws?.tabs ?? []) {
    if (tb.id === exceptTerminalTabId || !tb.browser?.poppedOut) continue;
    window.okwork?.browserPane?.setProfile?.(tb.id, profileId);
  }
}
