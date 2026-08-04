// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004/D-7:远程 workspace(hostId !== 'local')激活时,FilePanel 的「文件内容/Diff」
// 三入口——顶部 Diff 按钮、文件行本身、行内 diff 按钮——已解禁:查看器窗口 payload 按
// workspace.hostId 直连远程 host(mode:'file'/'diff' 均带 hostId 字段),不再 aria-disabled、
// 不再弹提示。仍然禁用的只剩「本机 OS 动作」两入口——Finder 中显示(文件行)、Finder 中
// 打开(目录行)——一律确定性禁用(aria-disabled + 1.8s 行内提示,词条
// 「Local-only action — unavailable in remote projects」)。用 aria-disabled 而非
// 原生 disabled:原生 disabled 的按钮不派发 click,会让「点击必须有确定性反馈」静默失效。
// 这两个(showItemInFolder/openPath)是本机 OS 动作:远程 ws 的路径是该机上的路径,交给
// 本机执行会静默作用于本机同名但无关的文件——必须禁用(review A1/E2)。
// html 预览(globe 按钮)阶段 2 起本机/远程均可用(openHtmlPreview 按 hostId 严格路由,
// 见 openPreview.ts),不再是「本机 OS 动作」——这里只验证 FilePanel 正确透传参数,
// openHtmlPreview 内部编排(选根/RPC/失败分支)由 openPreview.test.ts 单独覆盖。
// 目录展开/收起与 git 着色树浏览完全不受影响,本机 workspace 语义零变化(payload 不带 hostId)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// store.ts → terminalRegistry.ts 会拉入 @xterm/* 浏览器模块;本测试只验证 FilePanel 的
// 渲染/交互逻辑,mock 掉终端注册表断开该链(复刻 notificationBadge.test.ts 的惯例)。
vi.mock('../../terminal/terminalRegistry', () => ({ disposeTerminal: vi.fn() }));

const { hostRegistryMock, localClient, remoteClient } = vi.hoisted(() => {
  const localClient = { info: { homedir: '/Users/liam' }, rpc: vi.fn(async () => ({})) };
  const remoteClient = { info: { homedir: '/home/pi' }, rpc: vi.fn(async () => ({})) };
  return {
    localClient,
    remoteClient,
    hostRegistryMock: {
      local: vi.fn(() => localClient),
      forWorkspace: vi.fn((ws: { hostId: string }) =>
        ws.hostId === 'local' ? localClient : remoteClient,
      ),
      forHostId: vi.fn((hostId: string) => (hostId === 'local' ? localClient : remoteClient)),
    },
  };
});
vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

// FilePanel 的 globe 按钮只需验证「按正确参数调用 openHtmlPreview」+「失败时提示返回的
// message」两件事;RPC 编排/选根/失败分支属 openPreview.ts 自己的职责,见 openPreview.test.ts。
const { openHtmlPreviewMock } = vi.hoisted(() => ({
  openHtmlPreviewMock: vi.fn(
    async (): Promise<{ ok: true } | { ok: false; message: string }> => ({ ok: true }),
  ),
}));
vi.mock('../../services/openPreview', () => ({ openHtmlPreview: openHtmlPreviewMock }));

const { useFilePanelMock, toggleDir } = vi.hoisted(() => {
  const toggleDir = vi.fn();
  const view = {
    effectiveRoot: '/repo',
    autoRoot: '/repo',
    autoWorktree: '/repo',
    gitInfo: { toplevel: '/repo', branch: 'main', head: 'abc1234' },
    worktrees: [{ path: '/repo', branch: 'main', head: 'abc1234' }],
    topEntries: [
      { name: 'src', kind: 'dir' as const },
      { name: 'README.md', kind: 'file' as const },
      { name: 'index.html', kind: 'file' as const },
    ],
    expanded: new Set<string>(),
    cache: new Map(),
    errPaths: new Set<string>(),
    statusMap: new Map([['README.md', 'modified' as const]]),
    dirtyDirs: new Set<string>(),
    locateHighlightPath: null,
    locateScrollPath: null,
  };
  return {
    toggleDir,
    useFilePanelMock: vi.fn(() => ({
      view,
      toggleDir,
      refresh: vi.fn(),
      locateTarget: vi.fn(),
      clearLocateHighlight: vi.fn(),
      clearLocateScrollPath: vi.fn(),
    })),
  };
});
vi.mock('../../filepanel/useFilePanel', () => ({ useFilePanel: useFilePanelMock }));

import { FilePanel } from '../FilePanel';
import { useAppStore } from '../../state/store';

function seedWorkspace(hostId: string): void {
  useAppStore.setState({
    workspaces: [
      {
        id: 'ws1',
        name: 'proj',
        root: '/repo',
        hostId,
        tabs: [{ id: 't1', title: 'proj', cwd: '/repo' }],
        activeTabId: 't1',
      },
    ],
    activeWorkspaceId: 'ws1',
  } as unknown as Parameters<typeof useAppStore.setState>[0]);
}

function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: {
      openViewerWindow: vi.fn(),
      pickDirectory: vi.fn(),
      getPathForFile: vi.fn(),
      startFileDrag: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
    writable: true,
    configurable: true,
  });
}

const LOCAL_ONLY_HINT = 'Local-only action — unavailable in remote projects';

beforeEach(() => {
  mockOkwork();
  hostRegistryMock.local.mockClear();
  hostRegistryMock.forWorkspace.mockClear();
  hostRegistryMock.forHostId.mockClear();
  localClient.rpc.mockClear();
  remoteClient.rpc.mockClear();
  toggleDir.mockClear();
  useFilePanelMock.mockClear();
  openHtmlPreviewMock.mockClear();
  openHtmlPreviewMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('远程 workspace:文件/Diff 入口解禁 + 本机 OS 动作禁用(D-7)', () => {
  beforeEach(() => seedWorkspace('cfg-1'));

  it('顶部 Diff 按钮:不再 aria-disabled,点击按 hostId 直连远程 host 打开 diff 查看器', () => {
    render(<FilePanel />);
    const diffBtn = screen.getByRole('button', { name: 'Diff' });
    expect(diffBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(diffBtn);

    expect(window.okwork.openViewerWindow).toHaveBeenCalledWith({
      mode: 'diff',
      toplevel: '/repo',
      baseRef: null,
      hostId: 'cfg-1',
    });
    expect(screen.queryByText(LOCAL_ONLY_HINT)).not.toBeInTheDocument();
  });

  it('文件行本身(README.md):不再 aria-disabled,点击按 hostId 直连远程 host 打开文件查看器', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row') as HTMLElement;
    expect(fileRow).not.toHaveAttribute('aria-disabled');

    fireEvent.click(fileRow);

    expect(window.okwork.openViewerWindow).toHaveBeenCalledWith({
      mode: 'file',
      path: '/repo/README.md',
      hostId: 'cfg-1',
    });
    expect(screen.queryByText(LOCAL_ONLY_HINT)).not.toBeInTheDocument();
  });

  it('行内 diff 按钮(README.md):不再 aria-disabled,点击按 hostId 直连远程 host 打开 diff 查看器(带 initialPath)', () => {
    render(<FilePanel />);
    const rowDiffBtn = screen.getByText('diff');
    expect(rowDiffBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(rowDiffBtn);

    expect(window.okwork.openViewerWindow).toHaveBeenCalledWith({
      mode: 'diff',
      toplevel: '/repo',
      baseRef: null,
      initialPath: 'README.md',
      hostId: 'cfg-1',
    });
    expect(screen.queryByText(LOCAL_ONLY_HINT)).not.toBeInTheDocument();
  });

  it('内置浏览器预览(html 文件行 globe 按钮):远程不再 aria-disabled,按 hostId 调用 openHtmlPreview', async () => {
    render(<FilePanel />);
    const htmlRow = screen.getByText('index.html').closest('.file-panel__row') as HTMLElement;
    // index.html 无 git status(canDiff=false)→ 该行仅 [globe, folder-show] 两个 action
    const globeBtn = within(htmlRow).getAllByRole('button')[0];
    expect(globeBtn).not.toHaveAttribute('aria-disabled');

    await act(async () => {
      fireEvent.click(globeBtn);
    });

    expect(openHtmlPreviewMock).toHaveBeenCalledWith({
      filePath: '/repo/index.html',
      workspaceRoot: '/repo',
      effectiveRoot: '/repo',
      hostId: 'cfg-1',
      terminalTabId: 't1',
    });
    expect(screen.queryByText(LOCAL_ONLY_HINT)).not.toBeInTheDocument();
  });

  it('预览失败(openHtmlPreview 返回 ok:false):行内提示显示其确定性 message', async () => {
    openHtmlPreviewMock.mockResolvedValueOnce({ ok: false, message: 'preview boom' });
    render(<FilePanel />);
    const htmlRow = screen.getByText('index.html').closest('.file-panel__row') as HTMLElement;
    const globeBtn = within(htmlRow).getAllByRole('button')[0];

    await act(async () => {
      fireEvent.click(globeBtn);
    });

    expect(screen.getByText('preview boom')).toBeInTheDocument();
  });

  it('Finder 中显示(文件行按钮):仍 aria-disabled,不调用 showItemInFolder,弹本机专属提示', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row') as HTMLElement;
    // README.md 有 git status(canDiff=true)→ 该行 [diff, folder-show] 两个 action
    const folderShowBtn = within(fileRow).getAllByRole('button')[1];
    expect(folderShowBtn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(folderShowBtn);

    expect(window.okwork.showItemInFolder).not.toHaveBeenCalled();
    expect(screen.getByText(LOCAL_ONLY_HINT)).toBeInTheDocument();
  });

  it('Finder 中打开(目录行按钮):远程整个不渲染(用户指令 2026-08-04),新建子目录按钮保留', () => {
    render(<FilePanel />);
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    // 远程隐藏本机 OS 动作入口(非禁用形态);「新建子目录」经 host RPC,远程可用
    expect(within(dirRow).queryByTitle('Open in Finder')).not.toBeInTheDocument();
    const newDirBtn = within(dirRow).getByTitle('New subfolder');

    fireEvent.click(newDirBtn);

    expect(window.okwork.openPath).not.toHaveBeenCalled();
    // 按钮点击 stopPropagation,不应连带触发行的 toggleDir
    expect(toggleDir).not.toHaveBeenCalled();
  });

  it('目录行展开/收起完全不受影响(树浏览在范围)', () => {
    render(<FilePanel />);
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    expect(dirRow).not.toHaveAttribute('aria-disabled');

    fireEvent.click(dirRow);

    expect(toggleDir).toHaveBeenCalledWith('/repo/src');
  });

  it('git 着色树浏览照常生效(远程不影响 statusMap 派生的着色类)', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row') as HTMLElement;
    expect(fileRow.className).toContain('file-panel__row--git-modified');
  });

  it('提示是行内条(非 modal)· 1.8s 后自动消失', () => {
    vi.useFakeTimers();
    try {
      render(<FilePanel />);
      // 触发入口用仍禁用的「Finder 中显示」(文件行;目录行 Finder 入口远程已不渲染)
      const fileRow = screen.getByText('README.md').closest('.file-panel__row') as HTMLElement;
      const folderShowBtn = within(fileRow).getAllByRole('button')[1];
      fireEvent.click(folderShowBtn);
      expect(screen.getByText(LOCAL_ONLY_HINT)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_800);
      });

      expect(screen.queryByText(LOCAL_ONLY_HINT)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('本机 workspace:零回归', () => {
  beforeEach(() => seedWorkspace('local'));

  it('顶部 Diff 按钮正常可点(无 aria-disabled),打开 diff 查看器且不带 hostId', () => {
    render(<FilePanel />);
    const diffBtn = screen.getByRole('button', { name: 'Diff' });
    expect(diffBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(diffBtn);

    expect(window.okwork.openViewerWindow).toHaveBeenCalledWith({
      mode: 'diff',
      toplevel: '/repo',
      baseRef: null,
    });
    expect(screen.queryByText(LOCAL_ONLY_HINT)).not.toBeInTheDocument();
  });

  it('文件行点击正常打开查看器(无禁用,payload 不带 hostId)', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row') as HTMLElement;
    expect(fileRow).not.toHaveAttribute('aria-disabled');

    fireEvent.click(fileRow);

    expect(window.okwork.openViewerWindow).toHaveBeenCalledWith({
      mode: 'file',
      path: '/repo/README.md',
    });
  });

  it('homedir/RPC 走本机单例(forWorkspace 解析到 localClient)', () => {
    render(<FilePanel />);
    expect(hostRegistryMock.forWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ws1', hostId: 'local' }),
    );
  });

  it('内置浏览器预览(html 文件行):本机同样调用 openHtmlPreview(hostId=local,无禁用)', async () => {
    render(<FilePanel />);
    const htmlRow = screen.getByText('index.html').closest('.file-panel__row') as HTMLElement;
    const globeBtn = within(htmlRow).getAllByRole('button')[0];
    expect(globeBtn).not.toHaveAttribute('aria-disabled');

    await act(async () => {
      fireEvent.click(globeBtn);
    });

    expect(openHtmlPreviewMock).toHaveBeenCalledWith({
      filePath: '/repo/index.html',
      workspaceRoot: '/repo',
      effectiveRoot: '/repo',
      hostId: 'local',
      terminalTabId: 't1',
    });
  });

  it('Finder 中显示(文件行):正常调用 showItemInFolder(无禁用)', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row') as HTMLElement;
    const folderShowBtn = within(fileRow).getAllByRole('button')[1];
    expect(folderShowBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(folderShowBtn);

    expect(window.okwork.showItemInFolder).toHaveBeenCalledWith('/repo/README.md');
  });

  it('Finder 中打开(目录行):正常调用 openPath(无禁用;与新建子目录按钮并存)', () => {
    render(<FilePanel />);
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    const folderOpenBtn = within(dirRow).getByTitle('Open in Finder');
    expect(folderOpenBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(folderOpenBtn);

    expect(window.okwork.openPath).toHaveBeenCalledWith('/repo/src');
  });
});
