import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePanelController } from '../controller';
import type { FilePanelDeps, FilePanelInputs, TimerHandle } from '../types';
import type { DirEntry, GitInfo, GitStatusEntry, WorktreeInfo } from '../../../shared/protocol';

// ── fake deps 基础设施 ───────────────────────────────────────────────────────

/** 手动控制的 deferred:测试侧按调用顺序 resolveNext/rejectNext 释放 */
function makeDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type DeferredQueue<T> = {
  calls: Array<{ args: unknown[]; deferred: ReturnType<typeof makeDeferred<T>> }>;
  /** 返回下一个入队的 deferred(即最先未释放的那个) */
  nextDeferred(): ReturnType<typeof makeDeferred<T>>;
  resolveNext(v: T): void;
  rejectNext(e?: unknown): void;
  callCount(): number;
  lastArgs(): unknown[] | undefined;
};

function makeQueue<T>(): DeferredQueue<T> & { mock: (...args: unknown[]) => Promise<T> } {
  const calls: Array<{ args: unknown[]; deferred: ReturnType<typeof makeDeferred<T>> }> = [];
  const mock = (...args: unknown[]): Promise<T> => {
    const deferred = makeDeferred<T>();
    calls.push({ args, deferred });
    return deferred.promise;
  };
  return {
    calls,
    mock,
    nextDeferred() {
      const pending = calls.find((c) => {
        // 尚未 settled 的(promise 仍在等待)
        return true; // 我们按顺序取第一个未处理的
      });
      // 找第一个还没被处理的
      const idx = calls.findIndex((c) => !(c as { settled?: boolean }).settled);
      if (idx === -1) throw new Error('no pending deferred');
      return calls[idx].deferred;
    },
    resolveNext(v: T) {
      const idx = calls.findIndex((c) => !(c as { settled?: boolean }).settled);
      if (idx === -1) throw new Error('no pending deferred');
      (calls[idx] as { settled?: boolean }).settled = true;
      calls[idx].deferred.resolve(v);
    },
    rejectNext(e: unknown = new Error('rejected')) {
      const idx = calls.findIndex((c) => !(c as { settled?: boolean }).settled);
      if (idx === -1) throw new Error('no pending deferred');
      (calls[idx] as { settled?: boolean }).settled = true;
      calls[idx].deferred.reject(e);
    },
    callCount() { return calls.length; },
    lastArgs() { return calls[calls.length - 1]?.args; },
  };
}

// 标准 worktree 构造
function wt(path: string, branch = 'main'): WorktreeInfo {
  return { path, branch, head: 'abc1234' };
}

function makeGitInfo(toplevel: string | null): GitInfo {
  return { toplevel, mainWorktree: toplevel, branch: toplevel ? 'main' : null };
}

const ENTRIES: DirEntry[] = [{ name: 'src', kind: 'dir' }, { name: 'pkg.json', kind: 'file' }];

interface FakeDepsControl {
  ptyCwd: ReturnType<typeof makeQueue<{ cwd: string | null }>>;
  gitInfo: ReturnType<typeof makeQueue<GitInfo>>;
  gitWorktrees: ReturnType<typeof makeQueue<{ worktrees: WorktreeInfo[] }>>;
  gitStatus: ReturnType<typeof makeQueue<{ entries: GitStatusEntry[] }>>;
  readdir: ReturnType<typeof makeQueue<{ entries: DirEntry[] }>>;
  realpath: ReturnType<typeof makeQueue<{ path: string | null }>>;
  watch: ReturnType<typeof makeQueue<{ watchId: number }>>;
  unwatch: ReturnType<typeof makeQueue<void>>;
  emitFs(watchId: number): void;
  getSessionId: ReturnType<typeof vi.fn>;
  lockRoot: ReturnType<typeof vi.fn>;
  persistExpanded: ReturnType<typeof vi.fn>;
  deps: FilePanelDeps;
}

function makeFakeDeps(): FakeDepsControl {
  const ptyCwd = makeQueue<{ cwd: string | null }>();
  const gitInfo = makeQueue<GitInfo>();
  const gitWorktrees = makeQueue<{ worktrees: WorktreeInfo[] }>();
  const gitStatus = makeQueue<{ entries: GitStatusEntry[] }>();
  const readdir = makeQueue<{ entries: DirEntry[] }>();
  const realpath = makeQueue<{ path: string | null }>();
  const watch = makeQueue<{ watchId: number }>();
  const unwatch = makeQueue<void>();

  const fsListeners = new Set<(watchId: number) => void>();

  const getSessionId = vi.fn((_tabId: string) => 'sid-default');
  const lockRoot = vi.fn();
  const persistExpanded = vi.fn();

  const deps: FilePanelDeps = {
    getSessionId: (tabId) => getSessionId(tabId),
    ptyCwd: (...args) => ptyCwd.mock(...args),
    gitInfo: (...args) => gitInfo.mock(...args),
    gitWorktrees: (...args) => gitWorktrees.mock(...args),
    gitStatus: (...args) => gitStatus.mock(...args),
    readdir: (...args) => readdir.mock(...args),
    realpath: (...args) => realpath.mock(...args),
    watch: (...args) => watch.mock(...args),
    unwatch: (...args) => unwatch.mock(...args),
    onFsChanged: (cb) => {
      fsListeners.add(cb);
      return () => { fsListeners.delete(cb); };
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };

  return {
    ptyCwd, gitInfo, gitWorktrees, gitStatus, readdir, realpath, watch, unwatch,
    emitFs: (watchId) => { fsListeners.forEach((cb) => cb(watchId)); },
    getSessionId,
    lockRoot,
    persistExpanded,
    deps,
  };
}

function makeInputs(patch: Partial<FilePanelInputs> = {}): FilePanelInputs {
  return { tabId: 't1', mode: 'root', rootPath: undefined, worktreePath: undefined, fallbackCwd: '/repo', initialExpanded: [], ...patch };
}

async function flush() {
  // 多轮 microtask 让链式 promise 全部 settle
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ── 测试 ────────────────────────────────────────────────────────────────────

describe('FilePanelController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. 首启持久化 rootPath,着色不缺席(防回归 0907491)
  it('首启:readdir 先到,着色等 worktrees 到位后补拉', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 放行 readdir
    expect(fake.readdir.callCount()).toBe(1);
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();

    // 放行 watch
    expect(fake.watch.callCount()).toBe(1);
    fake.watch.resolveNext({ watchId: 1 });
    await flush();

    // 此时 gitStatus 尚未被调(worktrees 还未到位)
    const statusBeforeResolve = fake.gitStatus.callCount();

    // 放行 resolve 链:ptyCwd → gitInfo → gitWorktrees
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    await flush();

    // resolveDone 触发 issueStatusOrClear → gitStatus 被调
    expect(fake.gitStatus.callCount()).toBeGreaterThan(statusBeforeResolve);
    fake.gitStatus.resolveNext({ entries: [{ path: 'a.ts', status: 'modified' }] });
    await flush();

    expect(ctrl.getSnapshot().statusMap.get('a.ts')).toBe('modified');
    expect(ctrl.getSnapshot().worktrees.length).toBe(1);
    ctrl.dispose();
  });

  it('首启:resolve 链先到,readdir 后到,着色结论相同', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 先放行 resolve 链
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();

    // resolveDone 后立即触发 fetchStatus
    expect(fake.gitStatus.callCount()).toBe(1);
    fake.gitStatus.resolveNext({ entries: [{ path: 'b.ts', status: 'added' }] });
    await flush();

    // 再放行 readdir
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 2 });
    await flush();

    expect(ctrl.getSnapshot().statusMap.get('b.ts')).toBe('added');
    ctrl.dispose();
  });

  // 2. tab 快速切换飞行丢弃
  it('tab 快速切换:t1 的飞行结果不污染 t2', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: undefined, fallbackCwd: '/repo1' }));
    await flush();

    // t1 的 ptyCwd 挂起
    expect(fake.ptyCwd.callCount()).toBe(1);

    // 快速切换到 t2
    ctrl.setInputs(makeInputs({ tabId: 't2', rootPath: '/repo2', fallbackCwd: '/repo2' }));
    await flush();

    // 放行 t1 的链(应被 gen 闸丢弃)
    fake.ptyCwd.resolveNext({ cwd: '/repo1' });
    await flush();
    if (fake.gitInfo.callCount() > 0) {
      fake.gitInfo.resolveNext(makeGitInfo('/repo1'));
      await flush();
    }
    if (fake.gitWorktrees.callCount() > 0) {
      fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo1')] });
      await flush();
    }

    // 放行 t2 的链
    fake.ptyCwd.resolveNext({ cwd: '/repo2' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo2'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo2')] });
    await flush();
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 10 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    // snapshot 应反映 t2
    expect(ctrl.getSnapshot().autoRoot).toBe('/repo2');
    // t2 rootPath 已绑定,lockRoot 不应被 t1 误触发
    // (t2 rootPath 有值,所以 lockRoot 不被调)
    expect(fake.lockRoot).not.toHaveBeenCalledWith('t1', expect.anything());
    ctrl.dispose();
  });

  // 3. 手动 ⟳ 重解析 cwd(防回归场景③)
  it('手动 refresh:ptyCwd/gitInfo/gitWorktrees 再次被调,readdir 再次被调,watch 不重建', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 稳态建立
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 5 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    const ptyCwdBefore = fake.ptyCwd.callCount();
    const gitInfoBefore = fake.gitInfo.callCount();
    const gitWtBefore = fake.gitWorktrees.callCount();
    const readdirBefore = fake.readdir.callCount();
    const watchCountBefore = fake.watch.callCount();
    const unwatchCountBefore = fake.unwatch.callCount();
    const snapshotExpandedBefore = new Set(ctrl.getSnapshot().expanded);

    ctrl.refresh();
    await flush();

    // resolve 重跑
    expect(fake.ptyCwd.callCount()).toBeGreaterThan(ptyCwdBefore);
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    expect(fake.gitInfo.callCount()).toBeGreaterThan(gitInfoBefore);
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    expect(fake.gitWorktrees.callCount()).toBeGreaterThan(gitWtBefore);
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();

    // readdir 再次被调(partialRefresh)
    expect(fake.readdir.callCount()).toBeGreaterThan(readdirBefore);
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();

    // gitStatus 再次被调
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    // watch/unwatch 计数不变(不重建 watcher)
    expect(fake.watch.callCount()).toBe(watchCountBefore);
    expect(fake.unwatch.callCount()).toBe(unwatchCountBefore);

    // expanded 不变
    expect(ctrl.getSnapshot().expanded).toEqual(snapshotExpandedBefore);
    ctrl.dispose();
  });

  // 4. watch 刷新保展开
  it('watch 触发 refresh:expanded 保留,topEntries 更新,watchId 不变', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 稳态
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 7 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    // 展开一个目录
    ctrl.toggleDir('/repo/src');
    await flush();
    fake.readdir.resolveNext({ entries: [{ name: 'index.ts', kind: 'file' }] });
    await flush();
    expect(ctrl.getSnapshot().expanded.has('/repo/src')).toBe(true);

    const topEntriesBeforeRefresh = ctrl.getSnapshot().topEntries;

    // 触发 fs 事件
    fake.emitFs(7);
    // debounce 250ms:精确推进而非 runAllTimersAsync(避免轮询 infinite loop)
    vi.advanceTimersByTime(250);
    await flush();

    // resolve 重跑
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();

    // partialRefresh:顶层
    const newEntries: DirEntry[] = [{ name: 'src', kind: 'dir' }, { name: 'new.ts', kind: 'file' }];
    fake.readdir.resolveNext({ entries: newEntries });
    await flush();

    // partialRefresh:expanded /repo/src
    const newChildEntries: DirEntry[] = [{ name: 'updated.ts', kind: 'file' }];
    fake.readdir.resolveNext({ entries: newChildEntries });
    await flush();

    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    expect(ctrl.getSnapshot().expanded.has('/repo/src')).toBe(true);
    expect(ctrl.getSnapshot().cache.get('/repo/src')).toEqual([{ name: 'updated.ts', kind: 'file' }]);
    expect(ctrl.getSnapshot().topEntries).not.toBe(topEntriesBeforeRefresh);

    ctrl.dispose();
  });

  // 5. debounce 合并
  it('debounce:emitFs ×3 快速触发,refresh 流程只跑一次', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 稳态
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 3 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    const readdirBefore = fake.readdir.callCount();

    // 快速 emit ×3(间隔 <250ms):三次间隔 100ms,debounce 从最后一次计 250ms
    fake.emitFs(3);
    vi.advanceTimersByTime(100);
    fake.emitFs(3);
    vi.advanceTimersByTime(100);
    fake.emitFs(3);
    // 推进 250ms 触发 debounce(不用 runAllTimersAsync 避免轮询 infinite loop)
    vi.advanceTimersByTime(250);
    await flush();

    // partialRefresh 只触发一次 readdir
    expect(fake.readdir.callCount()).toBe(readdirBefore + 1);
    ctrl.dispose();
  });

  // 6. stale watch 补 unwatch
  it('stale watch:setInputs 切换 root 后,旧 watch promise 成功时补 unwatch', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/a', fallbackCwd: '/a' }));
    await flush();

    // resolve 链
    fake.ptyCwd.resolveNext({ cwd: '/a' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/a'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/a')] });
    await flush();

    // readdir /a 放行
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();

    // watch('/a') 挂起(还未 resolve)
    expect(fake.watch.callCount()).toBe(1);

    // 切换到 /b
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/b', fallbackCwd: '/b' }));
    await flush();

    // 放行 /a 的 watch resolve(stale)
    fake.watch.resolveNext({ watchId: 7 });
    await flush();

    // stale watch 应被 unwatch
    expect(fake.unwatch.callCount()).toBeGreaterThan(0);
    const unwatchArgs = fake.unwatch.calls.map((c) => c.args[0]);
    expect(unwatchArgs).toContain(7);

    ctrl.dispose();
  });

  // 7. StrictMode 双实例不泄漏
  it('StrictMode 双实例:ctrl1 dispose 后飞行结果不影响后续调用,ctrl2 正常出全量 snapshot', async () => {
    const fake1 = makeFakeDeps();
    const ctrl1 = new FilePanelController({ deps: fake1.deps, lockRoot: fake1.lockRoot, persistExpanded: fake1.persistExpanded });
    ctrl1.start();
    ctrl1.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // ctrl1 的 ptyCwd 挂起
    expect(fake1.ptyCwd.callCount()).toBe(1);

    // dispose ctrl1
    ctrl1.dispose();
    await flush();

    // ctrl1 的飞行 RPC resolve(不应引起后续调用)
    fake1.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    // gitInfo 不应被 ctrl1 调用(已 disposed)
    expect(fake1.gitInfo.callCount()).toBe(0);

    // ctrl2(新实例,独立 fake)
    const fake2 = makeFakeDeps();
    const ctrl2 = new FilePanelController({ deps: fake2.deps, lockRoot: fake2.lockRoot, persistExpanded: fake2.persistExpanded });
    ctrl2.start();
    ctrl2.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    fake2.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake2.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake2.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake2.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake2.watch.resolveNext({ watchId: 99 });
    await flush();
    fake2.gitStatus.resolveNext({ entries: [{ path: 'x.ts', status: 'modified' }] });
    await flush();

    expect(ctrl2.getSnapshot().autoRoot).toBe('/repo');
    expect(ctrl2.getSnapshot().topEntries.length).toBeGreaterThan(0);
    expect(ctrl2.getSnapshot().statusMap.get('x.ts')).toBe('modified');

    ctrl2.dispose();
  });

  // 8. Root 锁定恰好一次 + 同值不重拉树
  it('Root 锁定恰好一次,同值 rootPath 回写不重拉树', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: undefined, fallbackCwd: '/repo' }));
    await flush();

    // 放行第一轮 resolve(lockRoot 应被调)
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();

    expect(fake.lockRoot).toHaveBeenCalledTimes(1);
    expect(fake.lockRoot).toHaveBeenCalledWith('t1', '/repo');

    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 8 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    const readdirAfterFirstResolve = fake.readdir.callCount();
    const watchAfterFirstResolve = fake.watch.callCount();

    // 模拟 store 回写:setInputs rootPath='/repo'(同值)
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 放行第二轮 resolve
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    // lockRoot 仍只 1 次
    expect(fake.lockRoot).toHaveBeenCalledTimes(1);
    // readdir 顶层没有再拉(树没重拉)
    expect(fake.readdir.callCount()).toBe(readdirAfterFirstResolve);
    // watch 没有重建
    expect(fake.watch.callCount()).toBe(watchAfterFirstResolve);

    ctrl.dispose();
  });

  // 9. 非 git 降级
  // autoWorktree = anchorInfo.toplevel ?? anchor;anchor=/plain;toplevel=null → autoWorktree='/plain'
  // isGitToplevel: worktrees 空但 autoWorktree=='/plain'==root → true → gitStatus 调用
  // gitStatus 返回空 entries → statusMap/dirtyDirs 空;gitInfo.toplevel===null
  it('非 git:gitInfo 全 null、gitWorktrees 失败,statusMap/dirtyDirs 为空,topEntries 正常', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/plain', fallbackCwd: '/plain' }));
    await flush();

    // readdir 先放行
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 4 });
    await flush();

    // resolve:gitInfo 全 null,gitWorktrees reject
    fake.ptyCwd.resolveNext({ cwd: '/plain' });
    await flush();
    fake.gitInfo.resolveNext({ toplevel: null, mainWorktree: null, branch: null });
    await flush();
    // anchorInfo(同路径复用 info) → toplevel null;gitWorktrees reject
    fake.gitWorktrees.rejectNext(new Error('not a git repo'));
    await flush();
    await flush();

    // gitStatus 可能被调(autoWorktree=='/plain'==root),若调则放行空结果
    if (fake.gitStatus.callCount() > 0) {
      fake.gitStatus.resolveNext({ entries: [] });
      await flush();
    }

    expect(ctrl.getSnapshot().statusMap.size).toBe(0);
    expect(ctrl.getSnapshot().dirtyDirs.size).toBe(0);
    expect(ctrl.getSnapshot().gitInfo?.toplevel).toBeNull();
    expect(ctrl.getSnapshot().topEntries.length).toBeGreaterThan(0);

    ctrl.dispose();
  });

  // 10. cd 轮询触发重解析不重拉树
  // 验证语义:rootPath 锁定情况下,cd 漂移触发 resolve 重跑,但 effectiveRoot 不变所以树不重拉
  it('cd 轮询:同值不触发 resolve;漂移触发 resolve 不重拉树', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 稳态
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 6 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    const readdirAfterStable = fake.readdir.callCount();
    const gitInfoAfterStable = fake.gitInfo.callCount();

    // 同值 tick:不触发 resolve
    vi.advanceTimersByTime(2000);
    await flush();
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    expect(fake.gitInfo.callCount()).toBe(gitInfoAfterStable);

    // 漂移 tick:cd 到 '/elsewhere' → 触发 resolve(gen+1)
    // 轮询 → ptyCwd('/elsewhere') → pollTick dispatch → runResolve → ptyCwd again
    // 用辅助函数帮助释放所有未决的 ptyCwd 队列
    vi.advanceTimersByTime(2000);
    await flush();
    // 循环放行所有 pending ptyCwd 直到 gitInfo 被调或超时
    let attempts = 0;
    while (fake.gitInfo.callCount() <= gitInfoAfterStable && attempts < 10) {
      const idx = fake.ptyCwd.calls.findIndex((c) => !(c as { settled?: boolean }).settled);
      if (idx !== -1) {
        (fake.ptyCwd.calls[idx] as { settled?: boolean }).settled = true;
        fake.ptyCwd.calls[idx].deferred.resolve({ cwd: '/elsewhere' });
      }
      await flush();
      attempts++;
    }

    // 触发新 resolve(gen+1) → gitInfo 被再次调用
    expect(fake.gitInfo.callCount()).toBeGreaterThan(gitInfoAfterStable);

    // resolve 链放行:cwd='/elsewhere',anchor=rootPath='/repo'
    // runResolve:gitInfo(cwd) → autoRoot='/repo';anchor='/repo'≠cwd → anchorInfo=gitInfo(anchor)
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));   // gitInfo('/elsewhere') 结果
    await flush();
    // anchor !== cwd → 第二次调用 gitInfo(anchor='/repo')
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));   // gitInfo('/repo') 结果
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    // readdir 顶层计数不变(树没动)
    expect(fake.readdir.callCount()).toBe(readdirAfterStable);
    // effectiveRoot 仍为 '/repo'(rootPath 绑定不动)
    expect(ctrl.getSnapshot().effectiveRoot).toBe('/repo');

    ctrl.dispose();
  });

  // 11. 轮询 sessionId 实时读
  it('sessionId 先 null(skip ptyCwd),改 sid-1 后 tick 调 ptyCwd', async () => {
    const fake = makeFakeDeps();
    fake.getSessionId.mockReturnValue(null); // 初始 null

    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: undefined, fallbackCwd: '/repo' }));
    await flush();

    // 第一次 tick(2s):sessionId=null → ptyCwd 不调
    vi.advanceTimersByTime(2000);
    await flush();
    expect(fake.ptyCwd.callCount()).toBe(0);

    // 改为有效 sessionId
    fake.getSessionId.mockReturnValue('sid-1');

    // 第二次 tick:ptyCwd 被调
    vi.advanceTimersByTime(2000);
    await flush();
    expect(fake.ptyCwd.callCount()).toBe(1);

    ctrl.dispose();
  });

  // 12. WorkTree 未绑定 + cd 漂移:轮询驱动 resolveDone 内 effectiveRoot 改变 → 整树重建
  it('WorkTree 模式无绑定时 cd 漂移 → 停旧 watch、重置展开、重拉新根树与着色', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(
      makeInputs({ tabId: 't1', mode: 'worktree', rootPath: undefined, fallbackCwd: '/repoA' }),
    );
    await flush();

    // resolve 链 #1:anchor===cwd 时复用 gitInfo,worktree 模式 effectiveRoot=autoWorktree=/repoA
    fake.ptyCwd.resolveNext({ cwd: '/repoA' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repoA'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repoA')] });
    await flush();
    expect(ctrl.getSnapshot().effectiveRoot).toBe('/repoA');

    // 树 + watch + 着色就位,再展开一个子目录
    expect(fake.readdir.calls[0].args[0]).toBe('/repoA');
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 11 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [{ path: 'a.ts', status: 'modified' }] });
    await flush();
    ctrl.toggleDir('/repoA/src');
    await flush();
    expect(fake.readdir.calls[1].args[0]).toBe('/repoA/src');
    fake.readdir.resolveNext({ entries: [{ name: 'x.ts', kind: 'file' }] });
    await flush();
    expect(ctrl.getSnapshot().expanded.has('/repoA/src')).toBe(true);

    // tick #1:同值只记录,不触发重解析
    const gitInfoCalls = fake.gitInfo.callCount();
    vi.advanceTimersByTime(2000);
    await flush();
    fake.ptyCwd.resolveNext({ cwd: '/repoA' });
    await flush();
    expect(fake.gitInfo.callCount()).toBe(gitInfoCalls);

    // tick #2:漂移到 /repoB → resolve 链 #2
    vi.advanceTimersByTime(2000);
    await flush();
    fake.ptyCwd.resolveNext({ cwd: '/repoB' });
    await flush();
    fake.ptyCwd.resolveNext({ cwd: '/repoB' }); // resolve 链自己的 ptyCwd
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repoB'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repoB')] });
    await flush();

    // resolveDone:effectiveRoot /repoA→/repoB,走 applyRootChange
    expect(ctrl.getSnapshot().effectiveRoot).toBe('/repoB');
    // 旧 watcher 被停
    expect(fake.unwatch.lastArgs()?.[0]).toBe(11);
    // 展开态被重置
    expect(ctrl.getSnapshot().expanded.size).toBe(0);
    // 新根树 + 着色重拉
    expect(fake.readdir.calls[2].args[0]).toBe('/repoB');
    fake.readdir.resolveNext({ entries: [{ name: 'b.ts', kind: 'file' }] });
    await flush();
    fake.watch.resolveNext({ watchId: 12 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [{ path: 'b.ts', status: 'untracked' }] });
    await flush();
    expect(ctrl.getSnapshot().topEntries[0]?.name).toBe('b.ts');
    expect(ctrl.getSnapshot().statusMap.get('b.ts')).toBe('untracked');

    ctrl.dispose();
  });

  // 13. 展开态持久化 + 切 tab 恢复(端到端,经真实 effect)
  it('toggleDir 持久化展开;切到带 initialExpanded 的 tab 恢复展开并补拉子目录', async () => {
    const fake = makeFakeDeps();
    const ctrl = new FilePanelController({ deps: fake.deps, lockRoot: fake.lockRoot, persistExpanded: fake.persistExpanded });
    ctrl.start();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo' }));
    await flush();

    // 稳态
    fake.ptyCwd.resolveNext({ cwd: '/repo' });
    await flush();
    fake.gitInfo.resolveNext(makeGitInfo('/repo'));
    await flush();
    fake.gitWorktrees.resolveNext({ worktrees: [wt('/repo')] });
    await flush();
    fake.readdir.resolveNext({ entries: ENTRIES });
    await flush();
    fake.watch.resolveNext({ watchId: 20 });
    await flush();
    fake.gitStatus.resolveNext({ entries: [] });
    await flush();

    // 展开一个目录 → persistExpanded 写回该 tab
    ctrl.toggleDir('/repo/src');
    await flush();
    expect(fake.persistExpanded).toHaveBeenCalledWith('t1', ['/repo/src']);
    fake.readdir.resolveNext({ entries: [{ name: 'index.ts', kind: 'file' }] });
    await flush();
    expect(ctrl.getSnapshot().cache.has('/repo/src')).toBe(true);

    // 切到 t2(不同根),再切回 t1 并带回持久化展开集
    ctrl.setInputs(makeInputs({ tabId: 't2', rootPath: '/repo2', fallbackCwd: '/repo2' }));
    await flush();
    expect(ctrl.getSnapshot().expanded.size).toBe(0); // t2 无展开

    const readdirBeforeReturn = fake.readdir.callCount();
    ctrl.setInputs(makeInputs({ tabId: 't1', rootPath: '/repo', fallbackCwd: '/repo', initialExpanded: ['/repo/src'] }));
    await flush();

    // 回到 t1:展开态恢复
    expect(ctrl.getSnapshot().expanded.has('/repo/src')).toBe(true);
    // 顶层 + 展开子目录都补拉(缓存随根切换已清)
    fake.readdir.resolveNext({ entries: ENTRIES }); // 顶层
    await flush();
    expect(fake.readdir.callCount()).toBeGreaterThan(readdirBeforeReturn);
    // 子目录补拉请求中应含 /repo/src
    const childCalls = fake.readdir.calls.slice(readdirBeforeReturn).map((c) => c.args[0]);
    expect(childCalls).toContain('/repo/src');

    ctrl.dispose();
  });
});
