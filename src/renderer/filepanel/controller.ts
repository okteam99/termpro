// FilePanelController:runtime 层,执行 reduce 产出的 effect,桥接 React。
// 构造函数纯(无订阅/无 timer):StrictMode 渲染期可安全创建丢弃。
// start()/dispose() 幂等;disposed 后所有飞行 promise 回调被 disposed 闸挡住。

import { initialState, reduce, toView } from './core';
import type {
  FilePanelDeps,
  FilePanelEffect,
  FilePanelEvent,
  FilePanelInputs,
  FilePanelState,
  FilePanelView,
  TimerHandle,
} from './types';

export interface ControllerOpts {
  deps: FilePanelDeps;
  lockRoot(tabId: string, rootPath: string): void;
}

export class FilePanelController {
  private readonly deps: FilePanelDeps;
  private readonly opts: ControllerOpts;
  private state: FilePanelState = initialState();
  private cachedView: FilePanelView = toView(this.state);
  private listeners = new Set<() => void>();
  private started = false;
  private disposed = false;
  private fsUnsub: (() => void) | null = null;
  // 轮询状态
  private pollingTabId: string | null = null;
  private pollingTimer: TimerHandle | null = null;
  // debounce(watch 触发 refresh)
  private debounceTimer: TimerHandle | null = null;

  constructor(opts: ControllerOpts) {
    this.opts = opts;
    this.deps = opts.deps;
  }

  /** 幂等;订阅 deps.onFsChanged;按当前 inputs 同步轮询 */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.fsUnsub = this.deps.onFsChanged((id) => {
      if (id !== this.state.watchId) return;
      // debounce 250ms,重复事件重置计时
      if (this.debounceTimer !== null) this.deps.clearTimeout(this.debounceTimer);
      this.debounceTimer = this.deps.setTimeout(() => {
        this.debounceTimer = null;
        this.dispatch({ t: 'refresh' });
      }, 250);
    });
    this.syncPolling();
  }

  /** 幂等;之后忽略一切 dispatch;退订 onFsChanged;清轮询与 debounce;unwatch 飞行中 watch */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // 退订 fs 事件
    if (this.fsUnsub) {
      this.fsUnsub();
      this.fsUnsub = null;
    }

    // 清 debounce
    if (this.debounceTimer !== null) {
      this.deps.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 清轮询
    if (this.pollingTimer !== null) {
      this.deps.clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.pollingTabId = null;

    // unwatch 当前已知 watchId(飞行中的 startWatch 在 runStartWatch 里补 unwatch)
    if (this.state.watchId !== null) {
      void this.deps.unwatch(this.state.watchId).catch(() => {});
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  // ── React 桥 ───────────────────────────────────────────────────────────────

  /** 返回缓存引用;仅 state 变化时重建(useSyncExternalStore 硬约束,否则无限渲染) */
  getSnapshot(): FilePanelView {
    return this.cachedView;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── 交互入口 ───────────────────────────────────────────────────────────────

  setInputs(inputs: FilePanelInputs): void {
    this.dispatch({ t: 'inputs', inputs });
  }

  toggleDir(absPath: string): void {
    this.dispatch({ t: 'toggleDir', absPath });
  }

  /** 手动 ⟳:立即 dispatch,无 debounce */
  refresh(): void {
    this.dispatch({ t: 'refresh' });
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  private dispatch(ev: FilePanelEvent): void {
    if (this.disposed) return;

    const { state, effects } = reduce(this.state, ev);

    // state 引用变了 → 重建视图并通知 listeners
    if (state !== this.state) {
      this.state = state;
      this.cachedView = toView(state);
      this.listeners.forEach((cb) => cb());
    }

    for (const eff of effects) {
      this.runEffect(eff);
    }

    this.syncPolling();
  }

  private runEffect(eff: FilePanelEffect): void {
    switch (eff.k) {
      case 'resolve':
        void this.runResolve(eff);
        break;
      case 'fetchTop':
        this.deps
          .readdir(eff.root)
          .then(({ entries }) => {
            this.dispatch({ t: 'topDone', root: eff.root, seq: eff.seq, entries });
          })
          .catch(() => {
            this.dispatch({ t: 'topFail', root: eff.root, seq: eff.seq });
          });
        break;
      case 'startWatch':
        void this.runStartWatch(eff);
        break;
      case 'stopWatch':
        void this.deps.unwatch(eff.watchId).catch(() => {});
        break;
      case 'fetchStatus':
        this.deps
          .gitStatus(eff.root)
          .then(({ entries }) => {
            this.dispatch({ t: 'statusDone', root: eff.root, seq: eff.seq, entries });
          })
          .catch(() => {
            // 失败静默:保留旧色,与现码一致
          });
        break;
      case 'fetchChild':
        this.deps
          .readdir(eff.absPath)
          .then(({ entries }) => {
            this.dispatch({ t: 'childDone', root: eff.root, absPath: eff.absPath, entries });
          })
          .catch(() => {
            this.dispatch({ t: 'childFail', root: eff.root, absPath: eff.absPath });
          });
        break;
      case 'lockRoot':
        this.opts.lockRoot(eff.tabId, eff.rootPath);
        break;
      case 'partialRefreshTree':
        void this.runPartialRefresh(eff);
        break;
    }
  }

  /** Phase 1 解析链:语义对照现码 FilePanel.tsx 170-253 行 */
  private async runResolve(eff: Extract<FilePanelEffect, { k: 'resolve' }>): Promise<void> {
    // 实时读 sessionId(spawn 不触发 React 渲染,必须每次现查)
    const sid = this.deps.getSessionId(eff.tabId);
    let cwd: string | null = null;
    if (sid) {
      try {
        const res = await this.deps.ptyCwd(sid);
        cwd = res.cwd;
      } catch {
        cwd = null;
      }
    }
    cwd = cwd ?? eff.fallbackCwd;

    // 纯优化短路:正确性由 reduce 入口 gen 闸保证
    if (this.state.generation !== eff.gen || this.disposed) return;

    let info = { toplevel: null as string | null, mainWorktree: null as string | null, branch: null as string | null };
    try {
      info = await this.deps.gitInfo(cwd);
    } catch {
      // 非 git 目录或不可达
    }

    if (this.state.generation !== eff.gen || this.disposed) return;

    const autoRoot = info.mainWorktree ?? cwd;
    const anchor = eff.rootPath ?? autoRoot;

    let anchorInfo = { toplevel: null as string | null, mainWorktree: null as string | null, branch: null as string | null };
    // 锚点与 cwd 相同时复用 info,避免重复 RPC
    if (anchor === cwd) {
      anchorInfo = info;
    } else {
      try {
        anchorInfo = await this.deps.gitInfo(anchor);
      } catch {
        // 锚点不是 git 目录
      }
    }

    if (this.state.generation !== eff.gen || this.disposed) return;

    let wts: import('../../shared/protocol').WorktreeInfo[] = [];
    try {
      const res = await this.deps.gitWorktrees(anchor);
      wts = res.worktrees;
    } catch {
      // 非 git 或不可达
    }

    if (this.state.generation !== eff.gen || this.disposed) return;

    this.dispatch({
      t: 'resolveDone',
      gen: eff.gen,
      autoRoot,
      autoWorktree: anchorInfo.toplevel ?? anchor,
      gitInfo: anchorInfo,
      worktrees: wts,
      liveCwd: cwd,
    });
  }

  private async runStartWatch(eff: Extract<FilePanelEffect, { k: 'startWatch' }>): Promise<void> {
    let watchId: number;
    try {
      const res = await this.deps.watch(eff.root);
      watchId = res.watchId;
    } catch {
      // watch 不可用,静默容忍(无监听继续跑)
      return;
    }

    // stale watch:root 已变或已 dispose → 补 unwatch,不泄漏
    if (this.disposed || this.state.effectiveRoot !== eff.root) {
      void this.deps.unwatch(watchId).catch(() => {});
      return;
    }

    this.dispatch({ t: 'watchReady', root: eff.root, watchId });
  }

  /** Partial refresh:顶层 + 已展开子目录;失败静默(保旧 cache/topEntries) */
  private async runPartialRefresh(eff: Extract<FilePanelEffect, { k: 'partialRefreshTree' }>): Promise<void> {
    if (this.disposed) return;

    // 顶层
    try {
      const { entries } = await this.deps.readdir(eff.root);
      if (this.disposed) return;
      this.dispatch({ t: 'topDone', root: eff.root, seq: eff.topSeq, entries });
    } catch {
      // 失败静默:保旧 topEntries,不派 topFail
      if (this.disposed) return;
    }

    // 已展开子目录
    for (const absPath of eff.expanded) {
      if (this.disposed) return;
      try {
        const { entries } = await this.deps.readdir(absPath);
        if (this.disposed) return;
        this.dispatch({ t: 'childDone', root: eff.root, absPath, entries });
      } catch {
        // 静默:保旧 cache、不记 errPaths
      }
    }
  }

  /** 根据当前状态调整轮询 interval(2s):tab 变化/dispose 时切换 */
  private syncPolling(): void {
    const target = this.started && !this.disposed ? this.state.inputs.tabId : null;

    if (target === this.pollingTabId) return;

    // 清旧轮询
    if (this.pollingTimer !== null) {
      this.deps.clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.pollingTabId = target;

    if (target !== null) {
      this.pollingTimer = this.deps.setInterval(() => {
        const sid = this.deps.getSessionId(target);
        if (!sid) return;
        this.deps
          .ptyCwd(sid)
          .then(({ cwd }) => {
            this.dispatch({ t: 'pollTick', cwd });
          })
          .catch(() => {});
      }, 2000);
    }
  }
}
