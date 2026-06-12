import { describe, expect, it } from 'vitest';
import {
  initialState,
  reduce,
  computeEffectiveRoot,
  sortEntries,
  computeDirtyDirs,
  worktreeLabel,
  joinPath,
} from '../core';
import type { FilePanelState, FilePanelInputs } from '../types';
import type { DirEntry, GitStatusEntry, WorktreeInfo } from '../../../shared/protocol';

// ── 辅助构造器 ──────────────────────────────────────────────────────────────

function makeInputs(patch: Partial<FilePanelInputs> = {}): FilePanelInputs {
  return {
    tabId: 't1',
    mode: 'root',
    rootPath: undefined,
    worktreePath: undefined,
    fallbackCwd: '/home',
    ...patch,
  };
}

function stateWithRoot(root: string, patch: Partial<FilePanelState> = {}): FilePanelState {
  const s = initialState();
  return {
    ...s,
    effectiveRoot: root,
    inputs: makeInputs({ rootPath: root }),
    autoRoot: root,
    autoWorktree: root,
    worktrees: [{ path: root, branch: 'main', head: 'abc1234' }],
    ...patch,
  };
}

// ── 1. 过期裁决 ──────────────────────────────────────────────────────────────

describe('过期裁决', () => {
  it('resolveDone gen 不符 → 丢弃', () => {
    const s = { ...initialState(), generation: 2 };
    const out = reduce(s, {
      t: 'resolveDone',
      gen: 1,
      autoRoot: '/repo',
      autoWorktree: '/repo',
      gitInfo: { toplevel: '/repo', mainWorktree: '/repo', branch: 'main' },
      worktrees: [],
      liveCwd: '/repo',
    });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });

  it('topDone root 不符 → 丢弃', () => {
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'topDone', root: '/other', seq: s.topSeq, entries: [] });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });

  it('statusDone root 不符 → 丢弃', () => {
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'statusDone', root: '/other', seq: s.statusSeq, entries: [] });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });

  it('topDone seq 不符 → 丢弃', () => {
    const s = stateWithRoot('/repo', { topSeq: 3 });
    const out = reduce(s, { t: 'topDone', root: '/repo', seq: 2, entries: [] });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });

  it('topFail seq 不符 → 丢弃', () => {
    const s = stateWithRoot('/repo', { topSeq: 3 });
    const out = reduce(s, { t: 'topFail', root: '/repo', seq: 2 });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });

  it('statusDone seq 不符 → 丢弃', () => {
    const s = stateWithRoot('/repo', { statusSeq: 5 });
    const out = reduce(s, { t: 'statusDone', root: '/repo', seq: 4, entries: [] });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });
});

// ── 2. inputs 全等短路 ───────────────────────────────────────────────────────

describe('inputs 全等短路', () => {
  it('同值 inputs → 原 state 引用、空 effects', () => {
    const s = { ...initialState(), inputs: makeInputs() };
    const out = reduce(s, { t: 'inputs', inputs: makeInputs() });
    expect(out.state).toBe(s);
    expect(out.effects).toHaveLength(0);
  });
});

// ── 3. inputs 世代规则 ───────────────────────────────────────────────────────

describe('inputs 世代规则', () => {
  it('仅 tabId 变 → gen+1、发 resolve、lastPolledCwd 清 null', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1' }),
      lastPolledCwd: '/old',
    };
    const out = reduce(s, { t: 'inputs', inputs: makeInputs({ tabId: 't2' }) });
    expect(out.state.generation).toBe(s.generation + 1);
    expect(out.state.lastPolledCwd).toBeNull();
    const resolveEff = out.effects.find((e) => e.k === 'resolve');
    expect(resolveEff).toBeDefined();
    expect((resolveEff as Extract<typeof resolveEff, { k: 'resolve' }>)?.tabId).toBe('t2');
  });

  it('仅 rootPath 从 undefined→"/repo" 且 autoRoot="/repo":gen+1 发 resolve,不含 fetchTop/stopWatch/startWatch,树不变', () => {
    // Root 锁定回写同值场景:rootPath 写入与 autoRoot 相同,树不重拉
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', rootPath: undefined }),
      autoRoot: '/repo',
      autoWorktree: '/repo',
      effectiveRoot: '/repo',
      topEntries: [{ name: 'src', kind: 'dir' }],
      topSeq: 1,
    };
    const out = reduce(s, { t: 'inputs', inputs: makeInputs({ tabId: 't1', rootPath: '/repo' }) });
    expect(out.state.generation).toBe(s.generation + 1);
    const resolveEff = out.effects.find((e) => e.k === 'resolve');
    expect(resolveEff).toBeDefined();
    // 树相关 effect 不应出现
    expect(out.effects.some((e) => e.k === 'fetchTop')).toBe(false);
    expect(out.effects.some((e) => e.k === 'stopWatch')).toBe(false);
    expect(out.effects.some((e) => e.k === 'startWatch')).toBe(false);
    // topEntries 保持不变
    expect(out.state.topEntries).toEqual(s.topEntries);
  });

  it('仅 mode 变(root→worktree)且 effectiveRoot 改变 → 不发 resolve,但发 fetchTop/startWatch + stopWatch', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', mode: 'root', rootPath: '/repo' }),
      autoWorktree: '/repo/wt',
      effectiveRoot: '/repo',
      watchId: 42,
      topSeq: 1,
    };
    const out = reduce(s, { t: 'inputs', inputs: makeInputs({ tabId: 't1', mode: 'worktree', rootPath: '/repo' }) });
    // mode/worktreePath 不触发重解析
    expect(out.effects.some((e) => e.k === 'resolve')).toBe(false);
    // root 变了 → 树重建
    expect(out.effects.some((e) => e.k === 'fetchTop')).toBe(true);
    expect(out.effects.some((e) => e.k === 'startWatch')).toBe(true);
    expect(out.effects.some((e) => e.k === 'stopWatch')).toBe(true);
  });

  it('tabId 变 null → bump gen 不发 resolve', () => {
    const s: FilePanelState = { ...initialState(), inputs: makeInputs({ tabId: 't1' }) };
    const out = reduce(s, { t: 'inputs', inputs: makeInputs({ tabId: null }) });
    expect(out.state.generation).toBe(s.generation + 1);
    expect(out.effects.some((e) => e.k === 'resolve')).toBe(false);
  });
});

// ── 4. resolveDone ───────────────────────────────────────────────────────────

describe('resolveDone', () => {
  it('rootPath undefined 且 autoRoot 非空 → lockRoot effect', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', rootPath: undefined }),
    };
    const out = reduce(s, {
      t: 'resolveDone',
      gen: 0,
      autoRoot: '/repo',
      autoWorktree: '/repo',
      gitInfo: { toplevel: '/repo', mainWorktree: '/repo', branch: 'main' },
      worktrees: [{ path: '/repo', branch: 'main', head: 'abc1234' }],
      liveCwd: '/repo',
    });
    expect(out.effects.some((e) => e.k === 'lockRoot')).toBe(true);
  });

  it('rootPath 已有值 → 无 lockRoot', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', rootPath: '/repo' }),
    };
    const out = reduce(s, {
      t: 'resolveDone',
      gen: 0,
      autoRoot: '/repo',
      autoWorktree: '/repo',
      gitInfo: { toplevel: '/repo', mainWorktree: '/repo', branch: 'main' },
      worktrees: [{ path: '/repo', branch: 'main', head: 'abc1234' }],
      liveCwd: '/repo',
    });
    expect(out.effects.some((e) => e.k === 'lockRoot')).toBe(false);
  });

  it('着色补拉:root 没变但 worktrees 新含 root → fetchStatus effect,statusSeq+1', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', rootPath: '/repo' }),
      effectiveRoot: '/repo',
      autoWorktree: '/repo',
      worktrees: [], // 原来空
      statusSeq: 2,
    };
    const out = reduce(s, {
      t: 'resolveDone',
      gen: 0,
      autoRoot: '/repo',
      autoWorktree: '/repo',
      gitInfo: { toplevel: '/repo', mainWorktree: '/repo', branch: 'main' },
      worktrees: [{ path: '/repo', branch: 'main', head: 'abc1234' }],
      liveCwd: '/repo',
    });
    expect(out.state.statusSeq).toBe(3);
    expect(out.effects.some((e) => e.k === 'fetchStatus')).toBe(true);
  });

  it('非 git(worktrees 空且 autoWorktree≠root)且有残色 → 清色且 statusSeq+1 且无 fetchStatus', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', rootPath: '/plain' }),
      effectiveRoot: '/plain',
      autoWorktree: '/other',
      worktrees: [],
      statusSeq: 1,
      statusMap: new Map([['a.ts', 'modified']]),
      dirtyDirs: new Set(['src']),
    };
    const out = reduce(s, {
      t: 'resolveDone',
      gen: 0,
      autoRoot: '/plain',
      autoWorktree: null,
      gitInfo: { toplevel: null, mainWorktree: null, branch: null },
      worktrees: [],
      liveCwd: '/plain',
    });
    expect(out.state.statusSeq).toBe(2);
    expect(out.state.statusMap.size).toBe(0);
    expect(out.state.dirtyDirs.size).toBe(0);
    expect(out.effects.some((e) => e.k === 'fetchStatus')).toBe(false);
  });

  it('effectiveRoot 从 null→有值 → fetchTop+startWatch', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1', rootPath: undefined }),
      effectiveRoot: null,
    };
    const out = reduce(s, {
      t: 'resolveDone',
      gen: 0,
      autoRoot: '/repo',
      autoWorktree: '/repo',
      gitInfo: { toplevel: '/repo', mainWorktree: '/repo', branch: 'main' },
      worktrees: [{ path: '/repo', branch: 'main', head: 'abc1234' }],
      liveCwd: '/repo',
    });
    expect(out.effects.some((e) => e.k === 'fetchTop')).toBe(true);
    expect(out.effects.some((e) => e.k === 'startWatch')).toBe(true);
  });
});

// ── 5. pollTick ──────────────────────────────────────────────────────────────

describe('pollTick', () => {
  it('首测(prev=null)只记录,无 effect', () => {
    const s = { ...initialState(), lastPolledCwd: null };
    const out = reduce(s, { t: 'pollTick', cwd: '/repo' });
    expect(out.state.lastPolledCwd).toBe('/repo');
    expect(out.effects).toHaveLength(0);
  });

  it('同值只记录,无 effect', () => {
    const s = { ...initialState(), lastPolledCwd: '/repo' };
    const out = reduce(s, { t: 'pollTick', cwd: '/repo' });
    expect(out.state.lastPolledCwd).toBe('/repo');
    expect(out.effects).toHaveLength(0);
  });

  it('cd 漂移 → gen+1 + resolve effect,无树/watch/status effect', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1' }),
      lastPolledCwd: '/repo',
      generation: 1,
    };
    const out = reduce(s, { t: 'pollTick', cwd: '/repo/sub' });
    expect(out.state.generation).toBe(2);
    const resolveEff = out.effects.find((e) => e.k === 'resolve');
    expect(resolveEff).toBeDefined();
    expect(out.effects.some((e) => e.k === 'fetchTop')).toBe(false);
    expect(out.effects.some((e) => e.k === 'startWatch')).toBe(false);
    expect(out.effects.some((e) => e.k === 'stopWatch')).toBe(false);
    expect(out.effects.some((e) => e.k === 'fetchStatus')).toBe(false);
  });

  it('cwd null → 原 state', () => {
    const s = { ...initialState() };
    const out = reduce(s, { t: 'pollTick', cwd: null });
    expect(out.state).toBe(s);
  });
});

// ── 6. refresh ───────────────────────────────────────────────────────────────

describe('refresh', () => {
  it('effectiveRoot 非 null → resolve + partialRefreshTree + fetchStatus(git 根时)', () => {
    const s: FilePanelState = {
      ...stateWithRoot('/repo'),
      inputs: makeInputs({ tabId: 't1', rootPath: '/repo' }),
      expanded: new Set(['/repo/src']),
      generation: 1,
    };
    const out = reduce(s, { t: 'refresh' });
    expect(out.effects.some((e) => e.k === 'resolve')).toBe(true);
    expect(out.effects.some((e) => e.k === 'partialRefreshTree')).toBe(true);
    expect(out.effects.some((e) => e.k === 'fetchStatus')).toBe(true);
    // 不含 stopWatch/startWatch
    expect(out.effects.some((e) => e.k === 'stopWatch')).toBe(false);
    expect(out.effects.some((e) => e.k === 'startWatch')).toBe(false);
    // partialRefreshTree 携带 expanded 快照
    const partEff = out.effects.find((e) => e.k === 'partialRefreshTree') as Extract<(typeof out.effects)[number], { k: 'partialRefreshTree' }>;
    expect(partEff.expanded).toContain('/repo/src');
  });

  it('effectiveRoot null → 仅 resolve', () => {
    const s: FilePanelState = {
      ...initialState(),
      inputs: makeInputs({ tabId: 't1' }),
      effectiveRoot: null,
    };
    const out = reduce(s, { t: 'refresh' });
    expect(out.effects.some((e) => e.k === 'resolve')).toBe(true);
    expect(out.effects.some((e) => e.k === 'partialRefreshTree')).toBe(false);
    expect(out.effects.some((e) => e.k === 'fetchStatus')).toBe(false);
    expect(out.effects.some((e) => e.k === 'stopWatch')).toBe(false);
    expect(out.effects.some((e) => e.k === 'startWatch')).toBe(false);
  });
});

// ── 7. toggleDir ─────────────────────────────────────────────────────────────

describe('toggleDir', () => {
  it('展开未缓存 → fetchChild', () => {
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'toggleDir', absPath: '/repo/src' });
    expect(out.state.expanded.has('/repo/src')).toBe(true);
    expect(out.effects.some((e) => e.k === 'fetchChild')).toBe(true);
  });

  it('展开已缓存 → 无 effect', () => {
    const s = stateWithRoot('/repo', {
      cache: new Map([['/repo/src', [{ name: 'a.ts', kind: 'file' }]]]),
    });
    const out = reduce(s, { t: 'toggleDir', absPath: '/repo/src' });
    expect(out.state.expanded.has('/repo/src')).toBe(true);
    expect(out.effects.some((e) => e.k === 'fetchChild')).toBe(false);
  });

  it('收起 → 无 effect 且 cache 保留', () => {
    const s = stateWithRoot('/repo', {
      expanded: new Set(['/repo/src']),
      cache: new Map([['/repo/src', [{ name: 'a.ts', kind: 'file' }]]]),
    });
    const out = reduce(s, { t: 'toggleDir', absPath: '/repo/src' });
    expect(out.state.expanded.has('/repo/src')).toBe(false);
    expect(out.state.cache.has('/repo/src')).toBe(true);
    expect(out.effects).toHaveLength(0);
  });
});

// ── 8. topDone/statusDone/childFail ─────────────────────────────────────────

describe('topDone/statusDone/childFail', () => {
  it('topDone 排序:目录优先', () => {
    const entries: DirEntry[] = [
      { name: 'z.ts', kind: 'file' },
      { name: 'src', kind: 'dir' },
      { name: 'a.ts', kind: 'file' },
    ];
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'topDone', root: '/repo', seq: s.topSeq, entries });
    expect(out.state.topEntries[0].kind).toBe('dir');
    expect(out.state.topEntries[1].name).toBe('a.ts');
    expect(out.state.topEntries[2].name).toBe('z.ts');
  });

  it('statusDone 构建 statusMap+dirtyDirs,ignored 不上卷', () => {
    const entries: GitStatusEntry[] = [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'node_modules/x', status: 'ignored' },
    ];
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'statusDone', root: '/repo', seq: s.statusSeq, entries });
    expect(out.state.statusMap.get('src/a.ts')).toBe('modified');
    expect(out.state.dirtyDirs.has('src')).toBe(true);
    // ignored 的祖先不上卷
    expect(out.state.dirtyDirs.has('node_modules')).toBe(false);
  });

  it('childFail → errPaths 记录', () => {
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'childFail', root: '/repo', absPath: '/repo/secret' });
    expect(out.state.errPaths.has('/repo/secret')).toBe(true);
  });
});

// ── 9. 迁移纯函数 ─────────────────────────────────────────────────────────────

describe('watchReady', () => {
  it('首个 watcher → 采纳,无 effect', () => {
    const s = stateWithRoot('/repo');
    const out = reduce(s, { t: 'watchReady', root: '/repo', watchId: 7 });
    expect(out.state.watchId).toBe(7);
    expect(out.effects).toHaveLength(0);
  });

  it('同根并发两个 startWatch(A→B→A 往返)→ 采纳后到者,旧 watchId 补 stopWatch', () => {
    const s = stateWithRoot('/repo', { watchId: 7 });
    const out = reduce(s, { t: 'watchReady', root: '/repo', watchId: 9 });
    expect(out.state.watchId).toBe(9);
    expect(out.effects).toEqual([{ k: 'stopWatch', watchId: 7 }]);
  });

  it('重复送达同一 watchId → 采纳,不自停', () => {
    const s = stateWithRoot('/repo', { watchId: 7 });
    const out = reduce(s, { t: 'watchReady', root: '/repo', watchId: 7 });
    expect(out.state.watchId).toBe(7);
    expect(out.effects).toHaveLength(0);
  });
});

describe('computeDirtyDirs', () => {
  it('ignored 不上卷', () => {
    const entries: GitStatusEntry[] = [
      { path: 'node_modules/dep/index.js', status: 'ignored' },
      { path: 'src/a.ts', status: 'modified' },
    ];
    const dirs = computeDirtyDirs(entries, '/repo');
    expect(dirs.has('node_modules')).toBe(false);
    expect(dirs.has('node_modules/dep')).toBe(false);
    expect(dirs.has('src')).toBe(true);
  });

  it('祖先全标', () => {
    const entries: GitStatusEntry[] = [{ path: 'a/b/c.ts', status: 'added' }];
    const dirs = computeDirtyDirs(entries, '/repo');
    expect(dirs.has('a')).toBe(true);
    expect(dirs.has('a/b')).toBe(true);
  });

  it('顶层文件(无父目录)不产生 dirtyDirs 条目', () => {
    const entries: GitStatusEntry[] = [{ path: 'readme.md', status: 'modified' }];
    const dirs = computeDirtyDirs(entries, '/repo');
    expect(dirs.size).toBe(0);
  });
});

describe('sortEntries', () => {
  it('目录优先,同类按名排序', () => {
    const entries: DirEntry[] = [
      { name: 'z.ts', kind: 'file' },
      { name: 'b', kind: 'dir' },
      { name: 'a', kind: 'dir' },
      { name: 'a.ts', kind: 'file' },
    ];
    const sorted = sortEntries(entries);
    expect(sorted[0].name).toBe('a');
    expect(sorted[1].name).toBe('b');
    expect(sorted[2].name).toBe('a.ts');
    expect(sorted[3].name).toBe('z.ts');
  });
});

describe('worktreeLabel', () => {
  const main: WorktreeInfo = { path: '/repo', branch: 'main', head: 'abc1234' };
  const sub: WorktreeInfo = { path: '/repo/.worktree/feat', branch: 'feat', head: 'def5678' };
  const ext: WorktreeInfo = { path: '/other/repo', branch: 'ext', head: 'ghi9012' };

  it('主工作区 → "."', () => {
    expect(worktreeLabel(main, '/repo')).toBe('.');
  });

  it('子路径 → 裁剪前缀', () => {
    expect(worktreeLabel(sub, '/repo')).toBe('.worktree/feat');
  });

  it('外部路径 → 原样', () => {
    expect(worktreeLabel(ext, '/repo')).toBe('/other/repo');
  });
});

describe('joinPath', () => {
  it('父路径不以 / 结尾', () => {
    expect(joinPath('/repo', 'src')).toBe('/repo/src');
  });

  it('父路径以 / 结尾', () => {
    expect(joinPath('/repo/', 'src')).toBe('/repo/src');
  });
});

describe('computeEffectiveRoot', () => {
  it('"" 归一为 null', () => {
    const s = { ...initialState(), inputs: makeInputs({ rootPath: '' }) };
    expect(computeEffectiveRoot(s)).toBeNull();
  });

  it('rootPath 优先于 autoRoot', () => {
    const s = { ...initialState(), inputs: makeInputs({ rootPath: '/bound' }), autoRoot: '/auto' };
    expect(computeEffectiveRoot(s)).toBe('/bound');
  });

  it('mode=worktree 走 worktreePath ?? autoWorktree', () => {
    const s = {
      ...initialState(),
      inputs: makeInputs({ mode: 'worktree', worktreePath: '/wt' }),
      autoWorktree: '/auto-wt',
    };
    expect(computeEffectiveRoot(s)).toBe('/wt');
  });
});
