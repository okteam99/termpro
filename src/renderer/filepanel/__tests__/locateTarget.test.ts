import { describe, expect, it, vi } from 'vitest';
import { FilePanelController } from '../controller';
import type { FilePanelDeps, FilePanelInputs, TimerHandle } from '../types';
import type { DirEntry, GitInfo, GitStatusEntry, WorktreeInfo } from '../../../shared/protocol';

function makeInputs(patch: Partial<FilePanelInputs> = {}): FilePanelInputs {
  return {
    tabId: 't1',
    mode: 'root',
    rootPath: '/repo',
    worktreePath: undefined,
    fallbackCwd: '/repo',
    initialExpanded: [],
    ...patch,
  };
}

function entries(...items: Array<[string, DirEntry['kind']]>): DirEntry[] {
  return items.map(([name, kind]) => ({ name, kind }));
}

function gitInfo(root: string | null): GitInfo {
  return { toplevel: root, mainWorktree: root, branch: root ? 'main' : null };
}

interface FakeDeps {
  deps: FilePanelDeps;
  persistExpanded: ReturnType<typeof vi.fn>;
  persistMode: ReturnType<typeof vi.fn>;
  readdir: ReturnType<typeof vi.fn>;
}

function makeDeps(tree: Record<string, DirEntry[]>): FakeDeps {
  const persistExpanded = vi.fn();
  const persistMode = vi.fn();
  const readdir = vi.fn(async (path: string) => ({ entries: tree[path] ?? [] }));
  const deps: FilePanelDeps = {
    platform: 'darwin',
    getSessionId: () => null,
    ptyCwd: async () => ({ cwd: '/repo' }),
    gitInfo: async () => gitInfo('/repo'),
    gitWorktrees: async (): Promise<{ worktrees: WorktreeInfo[] }> => ({
      worktrees: [{ path: '/repo', branch: 'main', head: 'abc1234' }],
    }),
    gitStatus: async (): Promise<{ entries: GitStatusEntry[] }> => ({ entries: [] }),
    readdir,
    realpath: async (path: string) => ({ path }),
    watch: async () => ({ watchId: 1 }),
    unwatch: async () => undefined,
    onFsChanged: () => () => undefined,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis) as (h: TimerHandle) => void,
  };
  return { deps, persistExpanded, persistMode, readdir };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function makeController(fake: FakeDeps): FilePanelController {
  return new FilePanelController({
    deps: fake.deps,
    lockRoot: vi.fn(),
    persistExpanded: fake.persistExpanded,
    persistMode: fake.persistMode,
  });
}

describe('FilePanelController locateTarget', () => {
  it('locates a file inside current Root without opening fallback', async () => {
    const fake = makeDeps({
      '/repo': entries(['src', 'dir']),
      '/repo/src': entries(['App.tsx', 'file']),
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 1, path: '/repo/src/App.tsx', kind: 'file', sourceTabId: 't1' })).resolves.toBe(true);

    const view = ctrl.getSnapshot();
    expect(view.expanded.has('/repo/src')).toBe(true);
    expect(view.locateHighlightPath).toBe('/repo/src/App.tsx');
    expect(view.locateScrollPath).toBe('/repo/src/App.tsx');
    expect(fake.persistMode).not.toHaveBeenCalled();
  });

  it('switches to current WorkTree before enclosing Root', async () => {
    const fake = makeDeps({
      '/repo': entries(['.worktree', 'dir']),
      '/repo/.worktree/feature-a': entries(['src', 'dir']),
      '/repo/.worktree/feature-a/src': entries(['index.ts', 'file']),
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs({ mode: 'root', rootPath: '/repo', worktreePath: '/repo/.worktree/feature-a' }));
    await flush();

    await expect(ctrl.locateTarget({
      id: 2,
      path: '/repo/.worktree/feature-a/src/index.ts',
      kind: 'file',
      sourceTabId: 't1',
    })).resolves.toBe(true);

    const view = ctrl.getSnapshot();
    expect(view.effectiveRoot).toBe('/repo/.worktree/feature-a');
    expect(view.expanded.has('/repo/.worktree/feature-a/src')).toBe(true);
    expect(view.locateHighlightPath).toBe('/repo/.worktree/feature-a/src/index.ts');
    expect(fake.persistMode).toHaveBeenCalledWith('t1', 'worktree');
  });

  it('returns false without mutation when the target row is missing', async () => {
    const fake = makeDeps({
      '/repo': entries(['src', 'dir']),
      '/repo/src': entries(['Other.tsx', 'file']),
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 3, path: '/repo/src/Gone.tsx', kind: 'file', sourceTabId: 't1' })).resolves.toBe(false);
    const view = ctrl.getSnapshot();
    expect(view.locateHighlightPath).toBeNull();
    expect(view.expanded.has('/repo/src')).toBe(false);
  });

  it('stales an in-flight locate when generation changes', async () => {
    const fake = makeDeps({
      '/repo': entries(['src', 'dir']),
      '/repo/src': entries(['App.tsx', 'file']),
      '/other': entries(['README.md', 'file']),
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();
    const locating = ctrl.locateTarget({ id: 4, path: '/repo/src/App.tsx', kind: 'file', sourceTabId: 't1' });
    ctrl.setInputs(makeInputs({ rootPath: '/other', fallbackCwd: '/other' }));
    await flush();

    await expect(locating).resolves.toBe(true);
    expect(ctrl.getSnapshot().effectiveRoot).toBe('/other');
    expect(ctrl.getSnapshot().locateHighlightPath).toBeNull();
  });

  it('rejects a locate request from a different tab before mutating state', async () => {
    const fake = makeDeps({
      '/repo': entries(['src', 'dir']),
      '/repo/src': entries(['App.tsx', 'file']),
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs({ tabId: 'active-tab' }));
    await flush();

    await expect(ctrl.locateTarget({
      id: 5,
      path: '/repo/src/App.tsx',
      kind: 'file',
      sourceTabId: 'background-tab',
    })).resolves.toBe(false);

    expect(ctrl.getSnapshot().locateHighlightPath).toBeNull();
    expect(fake.readdir).not.toHaveBeenCalledWith('/repo/src');
  });

  it('loads a directory target before marking it expanded', async () => {
    const fake = makeDeps({
      '/repo': entries(['src', 'dir']),
      '/repo/src': entries(['App.tsx', 'file']),
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 6, path: '/repo/src', kind: 'dir', sourceTabId: 't1' })).resolves.toBe(true);

    const view = ctrl.getSnapshot();
    expect(view.expanded.has('/repo/src')).toBe(true);
    expect(view.cache.get('/repo/src')).toEqual(entries(['App.tsx', 'file']));
    expect(view.locateHighlightPath).toBe('/repo/src');
    expect(view.locateScrollPath).toBe('/repo/src');
    expect(fake.readdir).toHaveBeenCalledWith('/repo/src');
  });

  it('does not case-fold missing rows on non-darwin hosts', async () => {
    const fake = makeDeps({
      '/repo': entries(['src', 'dir']),
      '/repo/src': entries(['App.tsx', 'file']),
    });
    fake.deps.platform = 'linux';
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 7, path: '/repo/SRC/App.tsx', kind: 'file', sourceTabId: 't1' })).resolves.toBe(false);

    const view = ctrl.getSnapshot();
    expect(view.expanded.has('/repo/src')).toBe(false);
    expect(view.locateHighlightPath).toBeNull();
  });

  it('rejects display containment when realpath escapes the root', async () => {
    const fake = makeDeps({
      '/repo': entries(['link', 'dir']),
      '/repo/link': entries(['file.ts', 'file']),
    });
    fake.deps.realpath = async (path: string) => ({
      path: path === '/repo/link/file.ts' ? '/private/tmp/file.ts' : path,
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 8, path: '/repo/link/file.ts', kind: 'file', sourceTabId: 't1' })).resolves.toBe(false);

    const view = ctrl.getSnapshot();
    expect(view.expanded.has('/repo/link')).toBe(false);
    expect(view.locateHighlightPath).toBeNull();
  });

  it('returns false without mutation when a required directory cannot be read', async () => {
    const rootEntries = entries(['src', 'dir']);
    const fake = makeDeps({
      '/repo': rootEntries,
    });
    fake.deps.readdir = vi.fn(async (path: string) => {
      if (path === '/repo/src') throw new Error('unreadable');
      return { entries: path === '/repo' ? rootEntries : [] };
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 9, path: '/repo/src/App.tsx', kind: 'file', sourceTabId: 't1' })).resolves.toBe(false);

    const view = ctrl.getSnapshot();
    expect(view.expanded.has('/repo/src')).toBe(false);
    expect(view.cache.has('/repo/src')).toBe(false);
    expect(view.locateHighlightPath).toBeNull();
  });

  it('uses display segments for in-root symlink paths', async () => {
    const fake = makeDeps({
      '/repo': entries(['link', 'dir']),
      '/repo/link': entries(['file.ts', 'file']),
    });
    fake.deps.realpath = async (path: string) => ({
      path: path === '/repo/link/file.ts' ? '/repo/real/file.ts' : path,
    });
    const ctrl = makeController(fake);
    ctrl.setInputs(makeInputs());
    await flush();

    await expect(ctrl.locateTarget({ id: 10, path: '/repo/link/file.ts', kind: 'file', sourceTabId: 't1' })).resolves.toBe(true);

    const view = ctrl.getSnapshot();
    expect(view.expanded.has('/repo/link')).toBe(true);
    expect(view.locateHighlightPath).toBe('/repo/link/file.ts');
    expect(view.locateHighlightPath).not.toBe('/repo/real/file.ts');
  });

  it('keeps cross-mode store input echo as a no-op after locateCommit', async () => {
    const fake = makeDeps({
      '/repo': entries(['.worktree', 'dir']),
      '/repo/.worktree/feature-a': entries(['src', 'dir']),
      '/repo/.worktree/feature-a/src': entries(['index.ts', 'file']),
    });
    const holder: { ctrl?: FilePanelController } = {};
    fake.persistMode.mockImplementation((_tabId: string, mode: 'root' | 'worktree') => {
      holder.ctrl?.setInputs(makeInputs({
        mode,
        rootPath: '/repo',
        worktreePath: '/repo/.worktree/feature-a',
      }));
    });
    const ctrl = makeController(fake);
    holder.ctrl = ctrl;
    ctrl.setInputs(makeInputs({
      mode: 'root',
      rootPath: '/repo',
      worktreePath: '/repo/.worktree/feature-a',
    }));
    await flush();
    fake.readdir.mockClear();

    await expect(ctrl.locateTarget({
      id: 11,
      path: '/repo/.worktree/feature-a/src/index.ts',
      kind: 'file',
      sourceTabId: 't1',
    })).resolves.toBe(true);
    await flush();

    const worktreeRootReads = fake.readdir.mock.calls.filter(([path]) => path === '/repo/.worktree/feature-a');
    expect(worktreeRootReads).toHaveLength(1);
    expect(fake.persistMode).toHaveBeenCalledWith('t1', 'worktree');
    expect(ctrl.getSnapshot().effectiveRoot).toBe('/repo/.worktree/feature-a');
    expect(ctrl.getSnapshot().locateHighlightPath).toBe('/repo/.worktree/feature-a/src/index.ts');
  });
});
