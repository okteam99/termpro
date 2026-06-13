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
});
