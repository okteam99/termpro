// 设置 → 终端层实时同步。store 为纯 zustand(无 selector 中间件),故用普通
// subscribe + 自记上次值,仅在关心的字段变化时把新值应用到所有已存在终端。

import { useAppStore } from '../state/store';
import { applyPinBottomBar } from '../terminal/terminalRegistry';

let initialized = false;

export function initSettingsSync(): void {
  if (initialized) return;
  initialized = true;

  let lastPin = useAppStore.getState().pinBottomBar;
  applyPinBottomBar(lastPin); // 推入初值(hydrate 后的变更由下方订阅兜住)
  useAppStore.subscribe((state) => {
    if (state.pinBottomBar !== lastPin) {
      lastPin = state.pinBottomBar;
      applyPinBottomBar(lastPin);
    }
  });
}
