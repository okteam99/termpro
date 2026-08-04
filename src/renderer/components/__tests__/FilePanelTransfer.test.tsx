// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// 远程文件传输 阶段3:FilePanel 行内下载/上传按钮的渲染/禁用三态/点击编排单测。
// transferManager 整体 mock 掉(其自身队列/分块逻辑由 transferCore.test.ts +
// transferManager.test.ts 覆盖),这里只验证 FilePanel 按设计正确调用它 + 三态禁用门
// + stopPropagation 不误触发行的默认动作(开查看器/toggleDir)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// store.ts → terminalRegistry.ts 拉入 @xterm/*;与 FilePanelRemoteDisabled.test.tsx 同惯例断链。
vi.mock('../../terminal/terminalRegistry', () => ({ disposeTerminal: vi.fn() }));

const { hostRegistryMock, localClient, remoteClient, defaultRemoteInfo } = vi.hoisted(() => {
  const defaultRemoteInfo = { homedir: '/home/pi', capabilities: ['fs.transfer'] };
  const localClient = {
    info: { homedir: '/Users/liam' },
    rpc: vi.fn(async () => ({})),
    supportsTransfer: vi.fn(() => false),
  };
  const remoteClient = {
    info: defaultRemoteInfo as { homedir: string; capabilities: string[] } | null,
    rpc: vi.fn(async (method: string) => {
      if (method === 'fs.stat') return { kind: 'file', size: 1234, mtimeMs: 1 };
      return {};
    }),
    supportsTransfer: vi.fn(() => true),
  };
  return {
    localClient,
    remoteClient,
    defaultRemoteInfo,
    hostRegistryMock: {
      local: vi.fn(() => localClient),
      forWorkspace: vi.fn((ws: { hostId: string }) => (ws.hostId === 'local' ? localClient : remoteClient)),
      forHostId: vi.fn((hostId: string) => (hostId === 'local' ? localClient : remoteClient)),
    },
  };
});
vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

const { openHtmlPreviewMock } = vi.hoisted(() => ({
  openHtmlPreviewMock: vi.fn(async (): Promise<{ ok: true }> => ({ ok: true })),
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
      { name: 'plain.txt', kind: 'file' as const },
    ],
    expanded: new Set<string>(),
    cache: new Map(),
    errPaths: new Set<string>(),
    statusMap: new Map(),
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

const { transferManagerMock } = vi.hoisted(() => ({
  transferManagerMock: {
    download: vi.fn(async () => undefined),
    upload: vi.fn(async () => undefined),
    cancel: vi.fn(),
    isBusy: vi.fn(() => false),
    list: vi.fn(() => []),
    subscribe: vi.fn(() => () => undefined),
    onFinal: vi.fn(() => () => undefined),
  },
}));
vi.mock('../../services/transferManager', () => ({ transferManager: transferManagerMock }));

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

beforeEach(() => {
  mockOkwork();
  hostRegistryMock.local.mockClear();
  hostRegistryMock.forWorkspace.mockClear();
  localClient.rpc.mockClear();
  remoteClient.rpc.mockClear();
  remoteClient.supportsTransfer.mockClear();
  remoteClient.supportsTransfer.mockReturnValue(true);
  remoteClient.info = defaultRemoteInfo;
  toggleDir.mockClear();
  transferManagerMock.download.mockClear();
  transferManagerMock.upload.mockClear();
  transferManagerMock.isBusy.mockClear();
  transferManagerMock.isBusy.mockReturnValue(false);
  transferManagerMock.list.mockClear();
  transferManagerMock.list.mockReturnValue([]);
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('FilePanel: 远程文件传输行内按钮(阶段3)', () => {
  it('本机 workspace:文件行/目录行都不渲染下载/上传按钮', () => {
    seedWorkspace('local');
    render(<FilePanel />);
    const fileRow = screen.getByText('plain.txt').closest('.file-panel__row') as HTMLElement;
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    expect(within(fileRow).queryByTitle('Download to local')).not.toBeInTheDocument();
    expect(within(dirRow).queryByTitle('Upload to this folder')).not.toBeInTheDocument();
  });

  it('远程 workspace:文件行渲染下载按钮,目录行渲染上传按钮(均非 aria-disabled)', () => {
    seedWorkspace('cfg-1');
    render(<FilePanel />);
    const fileRow = screen.getByText('plain.txt').closest('.file-panel__row') as HTMLElement;
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    const downloadBtn = within(fileRow).getByTitle('Download to local');
    const uploadBtn = within(dirRow).getByTitle('Upload to this folder');
    expect(downloadBtn).not.toHaveAttribute('aria-disabled');
    expect(uploadBtn).not.toHaveAttribute('aria-disabled');
  });

  it('无能力位(supportsTransfer=false):aria-disabled + 点击弹确定性提示,不调用 transferManager', () => {
    seedWorkspace('cfg-1');
    remoteClient.supportsTransfer.mockReturnValue(false);
    render(<FilePanel />);
    const fileRow = screen.getByText('plain.txt').closest('.file-panel__row') as HTMLElement;
    const btn = within(fileRow).getByTitle(
      'Remote host is too old — upgrade the server to transfer files',
    );
    expect(btn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(btn);

    expect(
      screen.getByText('Remote host is too old — upgrade the server to transfer files'),
    ).toBeInTheDocument();
    expect(transferManagerMock.download).not.toHaveBeenCalled();
    expect(remoteClient.rpc).not.toHaveBeenCalled();
  });

  it('未连接(client.info 为空):aria-disabled + 提示「远程机未连接」', () => {
    seedWorkspace('cfg-1');
    remoteClient.info = null;
    render(<FilePanel />);
    const fileRow = screen.getByText('plain.txt').closest('.file-panel__row') as HTMLElement;
    const btn = within(fileRow).getByTitle('Remote machine is not connected');
    expect(btn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(btn);

    expect(screen.getByText('Remote machine is not connected')).toBeInTheDocument();
    expect(transferManagerMock.download).not.toHaveBeenCalled();
  });

  it('isBusy=true:aria-disabled + 提示「该项正在传输中」', () => {
    seedWorkspace('cfg-1');
    transferManagerMock.isBusy.mockReturnValue(true);
    render(<FilePanel />);
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    const btn = within(dirRow).getByTitle('Transfer already in progress');
    expect(btn).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(btn);

    expect(screen.getByText('Transfer already in progress')).toBeInTheDocument();
    expect(transferManagerMock.upload).not.toHaveBeenCalled();
  });

  it('点击下载按钮(启用态):stopPropagation 不开查看器;fs.stat 后调用 transferManager.download', async () => {
    seedWorkspace('cfg-1');
    render(<FilePanel />);
    const fileRow = screen.getByText('plain.txt').closest('.file-panel__row') as HTMLElement;
    const btn = within(fileRow).getByTitle('Download to local');

    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.okwork.openViewerWindow).not.toHaveBeenCalled();
    expect(remoteClient.rpc).toHaveBeenCalledWith('fs.stat', { path: '/repo/plain.txt' });
    expect(transferManagerMock.download).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        hostId: 'cfg-1',
        path: '/repo/plain.txt',
        name: 'plain.txt',
        size: 1234,
      }),
    );
  });

  it('fs.stat 判过大/非文件:showHint 提示,不调用 transferManager.download', async () => {
    seedWorkspace('cfg-1');
    remoteClient.rpc.mockImplementationOnce(async () => ({ kind: 'dir', size: 0, mtimeMs: 0 }));
    render(<FilePanel />);
    const fileRow = screen.getByText('plain.txt').closest('.file-panel__row') as HTMLElement;
    const btn = within(fileRow).getByTitle('Download to local');

    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/File is too large/)).toBeInTheDocument();
    expect(transferManagerMock.download).not.toHaveBeenCalled();
  });

  it('点击上传按钮(启用态):stopPropagation 不触发 toggleDir,调用 transferManager.upload', () => {
    seedWorkspace('cfg-1');
    render(<FilePanel />);
    const dirRow = screen.getByText('src').closest('.file-panel__row') as HTMLElement;
    const btn = within(dirRow).getByTitle('Upload to this folder');

    fireEvent.click(btn);

    expect(toggleDir).not.toHaveBeenCalled();
    expect(transferManagerMock.upload).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', hostId: 'cfg-1', destDir: '/repo/src' }),
    );
  });
});
