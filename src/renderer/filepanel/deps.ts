// 生产 FilePanelDeps 实现:包 host client RPC + 真实 timer。
// 测试注入 fake,不使用此文件。
// BL-004:client 不再固定单例——resolveClient 由调用方(useFilePanel.ts)传入,
// call-time 解析(每次方法调用现查),使切 workspace(含切到远程机)不重建 controller
// 也能换 host(controller 懒创建只 new 一次,固定住 client 会让远程消费恒走本机)。

import type { HostClient } from '../services/hostClient';
import { getSessionId } from '../terminal/terminalRegistry';
import type { FilePanelDeps } from './types';

export function makeHostDeps(resolveClient: () => HostClient): FilePanelDeps {
  return {
    // 🔴 platform 是构造期会被一次性读走的值字段(不像其余方法逐次调用),
    // 若像迁移前一样在此处直接取值,只会解析出 makeHostDeps() 调用那一刻的 host——
    // 改用 getter,每次访问都重新 resolveClient(),随当前 workspace 的 host 走。
    get platform() {
      return resolveClient().info?.platform ?? null;
    },

    getSessionId(tabId) {
      return getSessionId(tabId);
    },

    ptyCwd(sessionId) {
      return resolveClient().rpc('pty.cwd', { sessionId });
    },

    gitInfo(cwd) {
      return resolveClient().rpc('git.info', { cwd });
    },

    gitWorktrees(cwd) {
      return resolveClient().rpc('git.worktrees', { cwd });
    },

    gitStatus(toplevel) {
      return resolveClient().rpc('git.status', { toplevel });
    },

    readdir(path) {
      return resolveClient().rpc('fs.readdir', { path });
    },

    realpath(path) {
      return resolveClient().rpc('fs.realpath', { path });
    },

    watch(path) {
      return resolveClient().rpc('fs.watch', { path });
    },

    unwatch(watchId) {
      return resolveClient().rpc('fs.unwatch', { watchId });
    },

    onFsChanged(cb) {
      return resolveClient().onFsChanged(cb);
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
