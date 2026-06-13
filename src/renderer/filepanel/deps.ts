// 生产 FilePanelDeps 实现:包 hostClient RPC + 真实 timer。
// 测试注入 fake,不使用此文件。

import { hostClient } from '../services/hostClient';
import { getSessionId } from '../terminal/terminalRegistry';
import type { FilePanelDeps } from './types';

export function makeHostDeps(): FilePanelDeps {
  return {
    getSessionId(tabId) {
      return getSessionId(tabId);
    },

    ptyCwd(sessionId) {
      return hostClient.rpc('pty.cwd', { sessionId });
    },

    gitInfo(cwd) {
      return hostClient.rpc('git.info', { cwd });
    },

    gitWorktrees(cwd) {
      return hostClient.rpc('git.worktrees', { cwd });
    },

    gitStatus(toplevel) {
      return hostClient.rpc('git.status', { toplevel });
    },

    readdir(path) {
      return hostClient.rpc('fs.readdir', { path });
    },

    realpath(path) {
      return hostClient.rpc('fs.realpath', { path });
    },

    watch(path) {
      return hostClient.rpc('fs.watch', { path });
    },

    unwatch(watchId) {
      return hostClient.rpc('fs.unwatch', { watchId });
    },

    onFsChanged(cb) {
      return hostClient.onFsChanged(cb);
    },

    setTimeout(fn, ms) {
      return globalThis.setTimeout(fn, ms);
    },

    clearTimeout(h) {
      globalThis.clearTimeout(h);
    },

    setInterval(fn, ms) {
      return globalThis.setInterval(fn, ms);
    },

    clearInterval(h) {
      globalThis.clearInterval(h);
    },
  };
}
