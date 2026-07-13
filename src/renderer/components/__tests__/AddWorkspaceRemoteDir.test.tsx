// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004 · AC-3/AC-4:添加项目 - 远程目录浏览器加载/空/错误态 + 确认创建落该远程机组
// (非本机 client)。hostRegistry 全 mock;store 用真实 useAppStore(addWorkspace 内部按
// targetHostId 走 hostRegistry.forHostId 路由,是 AC-4"未落本地 client"断言的真实生产路径)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const { hostRegistryMock, localClient, remoteClient } = vi.hoisted(() => {
  const localClient = {
    info: { hostId: 'local', protocolVersion: 1, platform: 'darwin', homedir: '/Users/liam', shell: '/bin/zsh' },
    rpc: vi.fn(async () => ({})),
  };
  const remoteClient = {
    info: { hostId: 'x', protocolVersion: 1, platform: 'linux', homedir: '/home/liam', shell: '/bin/bash' },
    rpc: vi.fn(),
  };
  const hostRegistryMock = {
    local: vi.fn(() => localClient),
    getOrCreateRemote: vi.fn(() => remoteClient),
    drop: vi.fn(),
    forWorkspace: vi.fn((ws: { hostId: string }) => (ws.hostId === 'local' ? localClient : remoteClient)),
    forHostId: vi.fn((id: string) => (id === 'local' ? localClient : remoteClient)),
  };
  return { hostRegistryMock, localClient, remoteClient };
});

vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

import { AddWorkspaceModal } from '../AddWorkspaceModal';
import { useAppStore } from '../../state/store';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';

function installTermpro() {
  Object.defineProperty(window, 'termpro', {
    value: {
      platform: 'darwin',
      pickDirectory: vi.fn(async () => null),
      remoteHost: {
        list: vi.fn(async () => [
          {
            id: 'cfg-1',
            alias: 'mini-pc',
            host: '192.168.1.40',
            port: 22,
            username: 'liam',
            authType: 'key',
            createdAt: Date.now(),
          },
        ]),
        save: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    creatingWorkspace: false,
  });
  useRemoteHostRuntimeStore.setState({ runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } } });
  installTermpro();
  localClient.rpc.mockClear();
  remoteClient.rpc.mockReset();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).termpro;
});

describe('AC-3 · 远程目录浏览器加载态', () => {
  it('fs.readdir 未落定期间显示转圈 +「正在读取目录…」· 创建按钮禁用', async () => {
    let resolveReaddir: (v: { entries: never[] }) => void = () => undefined;
    remoteClient.rpc.mockImplementation(
      () => new Promise((resolve) => { resolveReaddir = resolve; }),
    );

    render(<AddWorkspaceModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('mini-pc'));

    expect(await screen.findByText('Reading directory…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();

    resolveReaddir({ entries: [] });
    await waitFor(() => expect(screen.getByText('(empty directory)')).toBeInTheDocument());
  });
});

describe('AC-3 · 远程空目录态', () => {
  it('readdir resolve 空数组 → 渲染"(空目录)",非错误块', async () => {
    remoteClient.rpc.mockResolvedValue({ entries: [] });

    render(<AddWorkspaceModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('mini-pc'));

    expect(await screen.findByText('(empty directory)')).toBeInTheDocument();
    expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument();
  });
});

describe('AC-3 · 远程目录 EACCES 错误态', () => {
  it('readdir reject → 渲染错误块(含 EACCES 文案)+ 重试按钮 · 创建按钮禁用', async () => {
    remoteClient.rpc.mockRejectedValue(
      new Error("EACCES: permission denied, scandir '/home/liam/.config'"),
    );

    render(<AddWorkspaceModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('mini-pc'));

    expect(await screen.findByText(/EACCES/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('(empty directory)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select' })).toBeDisabled();
  });
});

describe('新建目录 · 远程机浏览器内联创建', () => {
  it('输入名字回车 → fs.mkdir 落远程 client → 自动进入新目录', async () => {
    const readdirPaths: string[] = [];
    remoteClient.rpc.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'fs.readdir') {
        readdirPaths.push((params as { path: string }).path);
        return { entries: [] };
      }
      if (method === 'fs.mkdir') return undefined;
      return {};
    });

    render(<AddWorkspaceModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('mini-pc'));
    await screen.findByText('(empty directory)');

    fireEvent.click(screen.getByRole('button', { name: '+ New folder' }));
    const input = screen.getByPlaceholderText('New directory name');
    fireEvent.change(input, { target: { value: 'proj' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(remoteClient.rpc).toHaveBeenCalledWith('fs.mkdir', { path: '/home/liam/proj' }),
    );
    // 创建后自动导航进新目录(底部路径即新目录,可直接创建项目)
    await waitFor(() => expect(readdirPaths).toContain('/home/liam/proj'));
    expect(screen.queryByPlaceholderText('New directory name')).not.toBeInTheDocument();
  });

  it('fs.mkdir reject → 内联错误文案,编辑器保持打开,不导航', async () => {
    remoteClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'fs.readdir') return { entries: [] };
      if (method === 'fs.mkdir') {
        throw new Error("EEXIST: file already exists, mkdir '/home/liam/proj'");
      }
      return {};
    });

    render(<AddWorkspaceModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('mini-pc'));
    await screen.findByText('(empty directory)');

    fireEvent.click(screen.getByRole('button', { name: '+ New folder' }));
    const input = screen.getByPlaceholderText('New directory name');
    fireEvent.change(input, { target: { value: 'proj' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/EEXIST/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New directory name')).toBeInTheDocument();
    // 仍停在原目录(fs.readdir 只有进入时那一次)
    const readdirCalls = remoteClient.rpc.mock.calls.filter(([m]) => m === 'fs.readdir');
    expect(readdirCalls).toHaveLength(1);
  });
});

describe('initialHostId · 机器组空态入口直达目录浏览器', () => {
  it('传入已连接机 configId → 跳过选机步,直接加载该机 homedir', async () => {
    remoteClient.rpc.mockResolvedValue({ entries: [] });

    render(<AddWorkspaceModal onClose={vi.fn()} initialHostId="cfg-1" />);

    // 未点任何机器行,直接进入目录步(出现返回钮 + 该机目录已开始加载)
    expect(await screen.findByText('(empty directory)')).toBeInTheDocument();
    expect(remoteClient.rpc).toHaveBeenCalledWith('fs.readdir', { path: '/home/liam' });
  });

  it('传入未连接/未知机 → 留在选机步(不静默指向错误机器)', async () => {
    useRemoteHostRuntimeStore.setState({ runtime: {} }); // cfg-1 未连接
    render(<AddWorkspaceModal onClose={vi.fn()} initialHostId="cfg-1" />);

    // 仍是选机步:能看到「本机」行,未发起远程 readdir
    expect(await screen.findByText(/Local directory|本地目录/)).toBeInTheDocument();
    expect(remoteClient.rpc).not.toHaveBeenCalled();
  });
});

describe('AC-4 · 确认创建落该远程机组', () => {
  it('workspace.create 调用落在远程 client · 本地 client 未被调用 · 创建后关闭 modal', async () => {
    remoteClient.rpc.mockImplementation(async (method: string) => {
      if (method === 'fs.readdir') return { entries: [] };
      if (method === 'workspace.create') {
        return { id: 'srv-ae', name: 'liam', root: '/home/liam' };
      }
      return {};
    });

    const onClose = vi.fn();
    render(<AddWorkspaceModal onClose={onClose} />);
    fireEvent.click(await screen.findByText('mini-pc'));
    await screen.findByText('(empty directory)');

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(remoteClient.rpc).toHaveBeenCalledWith(
      'workspace.create',
      expect.objectContaining({ root: '/home/liam' }),
    );
    expect(localClient.rpc).not.toHaveBeenCalledWith('workspace.create', expect.anything());

    // 新 workspace 带 hostId=cfg-1 入该机组视图态(非持久化 · D-6),不落本机
    const created = useAppStore.getState().workspaces.find((w) => w.id === 'srv-ae');
    expect(created?.hostId).toBe('cfg-1');
  });
});
