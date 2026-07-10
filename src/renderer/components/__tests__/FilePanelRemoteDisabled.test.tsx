// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004/D-7:远程 workspace(hostId !== 'local')激活时,FilePanel 的「文件内容」三入口——
// 顶部 Diff 按钮、文件行本身、行内 diff 按钮——一律确定性禁用(aria-disabled + 1.8s 行内
// 提示),但目录展开/收起与 git 着色树浏览完全不受影响。用 aria-disabled 而非原生
// disabled:原生 disabled 的按钮不派发 click,会让「点击必须有确定性反馈」静默失效。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    },
  };
});
vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

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

function mockTermpro() {
  Object.defineProperty(window, 'termpro', {
    value: {
      openViewerWindow: vi.fn(),
      pickDirectory: vi.fn(),
      getPathForFile: vi.fn(),
      startFileDrag: vi.fn(),
      openPath: vi.fn(),
      openInBrowser: vi.fn(),
      showItemInFolder: vi.fn(),
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  mockTermpro();
  hostRegistryMock.local.mockClear();
  hostRegistryMock.forWorkspace.mockClear();
  localClient.rpc.mockClear();
  remoteClient.rpc.mockClear();
  toggleDir.mockClear();
  useFilePanelMock.mockClear();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).termpro;
});

describe('远程 workspace:文件三入口禁用(D-7)', () => {
  beforeEach(() => seedWorkspace('cfg-1'));

  it('顶部 Diff 按钮:aria-disabled + 不调用 openViewerWindow + 点击弹提示', () => {
    render(<FilePanel />);
    const diffBtn = screen.getByRole('button', { name: 'Diff' });
    expect(diffBtn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(diffBtn);

    expect(window.termpro.openViewerWindow).not.toHaveBeenCalled();
    expect(screen.getByText('远程文件独立窗口暂不支持')).toBeInTheDocument();
  });

  it('文件行本身:点击不调用 openViewerWindow,弹提示', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row')!;
    expect(fileRow).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(fileRow);

    expect(window.termpro.openViewerWindow).not.toHaveBeenCalled();
    expect(screen.getByText('远程文件独立窗口暂不支持')).toBeInTheDocument();
  });

  it('行内 diff 按钮:点击不调用 openViewerWindow,弹提示', () => {
    render(<FilePanel />);
    const rowDiffBtn = screen.getByText('diff');
    expect(rowDiffBtn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(rowDiffBtn);

    expect(window.termpro.openViewerWindow).not.toHaveBeenCalled();
    expect(screen.getByText('远程文件独立窗口暂不支持')).toBeInTheDocument();
  });

  it('目录行展开/收起完全不受影响(树浏览在范围)', () => {
    render(<FilePanel />);
    const dirRow = screen.getByText('src').closest('.file-panel__row')!;
    expect(dirRow).not.toHaveAttribute('aria-disabled');

    fireEvent.click(dirRow);

    expect(toggleDir).toHaveBeenCalledWith('/repo/src');
  });

  it('git 着色树浏览照常生效(远程不影响 statusMap 派生的着色类)', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row')!;
    expect(fileRow.className).toContain('file-panel__row--git-modified');
  });

  it('提示是行内条(非 modal)· 1.8s 后自动消失', () => {
    vi.useFakeTimers();
    try {
      render(<FilePanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Diff' }));
      expect(screen.getByText('远程文件独立窗口暂不支持')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1_800);
      });

      expect(screen.queryByText('远程文件独立窗口暂不支持')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('本机 workspace:零回归', () => {
  beforeEach(() => seedWorkspace('local'));

  it('顶部 Diff 按钮正常可点(无 aria-disabled),打开 diff 查看器', () => {
    render(<FilePanel />);
    const diffBtn = screen.getByRole('button', { name: 'Diff' });
    expect(diffBtn).not.toHaveAttribute('aria-disabled');

    fireEvent.click(diffBtn);

    expect(window.termpro.openViewerWindow).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'diff', toplevel: '/repo' }),
    );
    expect(screen.queryByText('远程文件独立窗口暂不支持')).not.toBeInTheDocument();
  });

  it('文件行点击正常打开查看器(无禁用)', () => {
    render(<FilePanel />);
    const fileRow = screen.getByText('README.md').closest('.file-panel__row')!;
    expect(fileRow).not.toHaveAttribute('aria-disabled');

    fireEvent.click(fileRow);

    expect(window.termpro.openViewerWindow).toHaveBeenCalledWith({
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
});
