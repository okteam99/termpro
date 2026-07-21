// 浏览器 Profile 快照同步(权威在 main):启动拉全量 + 订阅变更,落进 store
// (setBrowserProfiles 同时做失效绑定对账)。主窗与浏览器窗格壳窗都要 init——
// 各渲染进程一份 store,分区计算(BrowserPanel)与 UA 透传都吃本地快照。
// list 失败(异常路径)→ browserProfilesLoaded 保持 false:profile 绑定工作区的
// webview 不落错分区(渲染门见 BrowserPanel),默认 profile 工作区零影响。

import { useAppStore } from '../state/store';

let initialized = false;

export function initProfilesSync(): void {
  if (initialized) return;
  initialized = true;

  window.okwork?.browserProfile
    ?.list?.()
    .then((profiles) => useAppStore.getState().setBrowserProfiles(profiles))
    .catch((err) => console.error('[renderer] browser profile list failed:', err));
  window.okwork?.browserProfile?.onChanged?.((profiles) =>
    useAppStore.getState().setBrowserProfiles(profiles),
  );
}

/** 仅供单测:允许重复 init */
export function __resetProfilesSyncForTests(): void {
  initialized = false;
}
