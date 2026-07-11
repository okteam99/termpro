// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// 「添加项目」内的「添加远程机」入口:点击就地叠加 RemoteHostsPage;Esc 只关顶层
// (不连带关掉添加项目 modal);关闭后刷新配置列表,新连上的机器进「已连接远程机」组。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const { hostRegistryMock } = vi.hoisted(() => {
  const localClient = {
    info: { hostId: 'local', protocolVersion: 1, platform: 'darwin', homedir: '/Users/liam', shell: '/bin/zsh' },
    rpc: vi.fn(async () => ({})),
  };
  const hostRegistryMock = {
    local: vi.fn(() => localClient),
    getOrCreateRemote: vi.fn(),
    drop: vi.fn(),
    forWorkspace: vi.fn(() => localClient),
    forHostId: vi.fn(() => localClient),
  };
  return { hostRegistryMock };
});

vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));

import { AddWorkspaceModal } from '../AddWorkspaceModal';
import { useAppStore } from '../../state/store';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';

// 可变配置源:模拟用户在 RemoteHostsPage 里添加+连接了一台机器后的 list() 结果变化
let remoteConfigs: Array<Record<string, unknown>> = [];

function installTermpro() {
  Object.defineProperty(window, 'termpro', {
    value: {
      platform: 'darwin',
      pickDirectory: vi.fn(async () => null),
      remoteHost: {
        list: vi.fn(async () => remoteConfigs),
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
  remoteConfigs = [];
  useAppStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    persistMode: 'v2',
    creatingWorkspace: false,
  });
  useRemoteHostRuntimeStore.setState({ runtime: {}, reconnecting: {} });
  installTermpro();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).termpro;
});

describe('添加项目 ·「添加远程机」入口', () => {
  it('无已连接远程机时:入口行 + 空态提示可见', async () => {
    render(<AddWorkspaceModal onClose={vi.fn()} />);

    expect(
      await screen.findByRole('button', { name: /添加远程机/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/暂无已连接的远程机/)).toBeInTheDocument();
  });

  it('点击入口叠加 RemoteHostsPage;Esc 只关顶层,不关「添加项目」', async () => {
    const onClose = vi.fn();
    render(<AddWorkspaceModal onClose={onClose} />);

    fireEvent.click(
      await screen.findByRole('button', { name: /添加远程机/ }),
    );

    // RemoteHostsPage 空态(list 为空)
    expect(await screen.findByText('还没有远程机 · 点击下方添加')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByText('还没有远程机 · 点击下方添加')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('添加项目')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('弹层里连上机器后关闭:列表刷新,新机器进「已连接远程机」组', async () => {
    render(<AddWorkspaceModal onClose={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole('button', { name: /添加远程机/ }),
    );
    await screen.findByText('还没有远程机 · 点击下方添加');

    // 模拟用户在弹层内添加并连接成功
    remoteConfigs = [
      {
        id: 'cfg-1',
        alias: 'mini-pc',
        host: '192.168.1.40',
        port: 22,
        username: 'liam',
        authType: 'key',
        createdAt: Date.now(),
      },
    ];
    useRemoteHostRuntimeStore
      .getState()
      .applyEvent({ configId: 'cfg-1', stage: 'ready' });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(await screen.findByText('mini-pc')).toBeInTheDocument();
    expect(screen.getByText('已连接远程机')).toBeInTheDocument();
    expect(screen.queryByText(/暂无已连接的远程机/)).not.toBeInTheDocument();
  });
});
