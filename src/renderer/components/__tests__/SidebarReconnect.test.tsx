// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-005 · A1/A2/Q1(review-fix·断线重连编排的**生产接线**·堵幽灵覆盖复发):
// 上轮 controller seam 单测到位但没接进生产——onAttemptFailed 无生产调用方(A2)、readopt 由 main
// 'ready' 事件在 ws 打开前触发致冻结(A1)、900ms drop 闸内联在 Sidebar 无测(Q1)。本测在 Sidebar
// 组件层直驱 main 事件 + 控制 client.reconnect 的 promise 时序,断言 Sidebar 正确调用注入的
// reconnectController(onReconnected/onAttemptFailed 何时被调)+ 真实 drop 闸生产路径。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import type { RemoteHostConfig } from '../../../shared/remoteHost';

expect.extend(matchers);

const { hostRegistryMock, remoteClient } = vi.hoisted(() => {
  const remoteClient = {
    info: { hostId: 'r', protocolVersion: 1, platform: 'linux', homedir: '/home/liam', shell: '/bin/bash' },
    reconnectable: true,
    reconnect: vi.fn(),
    connect: vi.fn(),
    rpc: vi.fn(),
    onReconnectNeeded: vi.fn(() => () => undefined),
    onDown: vi.fn(() => () => undefined),
    onWorkspaceChanged: vi.fn(() => () => undefined),
    onSessionEvent: vi.fn(() => () => undefined),
    supportsSessionResume: () => true,
  };
  const localClient = { ...remoteClient, reconnectable: false, info: { ...remoteClient.info, homedir: '/Users/liam' } };
  const hostRegistryMock = {
    local: vi.fn(() => localClient),
    getOrCreateRemote: vi.fn(() => remoteClient),
    forHostId: vi.fn((id: string) => (id === 'local' ? localClient : remoteClient)),
    forWorkspace: vi.fn((ws: { hostId: string }) => (ws.hostId === 'local' ? localClient : remoteClient)),
    drop: vi.fn(),
  };
  return { hostRegistryMock, remoteClient };
});

const { reconnectControllerMock } = vi.hoisted(() => ({
  reconnectControllerMock: {
    onReconnected: vi.fn(),
    onAttemptFailed: vi.fn(),
    onDisconnected: vi.fn(),
    manualRetry: vi.fn(),
    isActive: vi.fn(() => false),
  },
}));

vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));
vi.mock('../../services/remoteWorkspaceSync', () => ({
  startRemoteWorkspaceSync: vi.fn(async () => undefined),
  stopRemoteWorkspaceSync: vi.fn(),
}));
vi.mock('../../services/reconnectWiring', () => ({ reconnectController: reconnectControllerMock }));

import { Sidebar } from '../Sidebar';
import { useAppStore } from '../../state/store';
import {
  useRemoteHostRuntimeStore,
  __resetRemoteHostOrchestrationForTest,
} from '../../state/remoteHostStore';
import { stopRemoteWorkspaceSync } from '../../services/remoteWorkspaceSync';

function makeConfig(overrides: Partial<RemoteHostConfig> = {}): RemoteHostConfig {
  return {
    id: 'cfg-1',
    alias: 'mini-pc',
    host: '192.168.1.40',
    port: 22,
    username: 'liam',
    authType: 'key',
    createdAt: Date.now(),
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let eventHandler: (e: Record<string, unknown>) => void = () => undefined;

function installOkwork() {
  eventHandler = () => undefined;
  Object.defineProperty(window, 'okwork', {
    value: {
      version: '0.3.13',
      devChannel: false,
      platform: 'darwin',
      smoke: false,
      requestHostPort: vi.fn(),
      pickDirectory: vi.fn(async () => null),
      onMenu: vi.fn(() => () => undefined),
      smokeOk: vi.fn(),
      onUpdateEvent: vi.fn(() => () => undefined),
      installUpdate: vi.fn(),
      showTabContextMenu: vi.fn(),
      remoteHost: {
        list: vi.fn(async () => [makeConfig()]),
        save: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onEvent: vi.fn((cb: typeof eventHandler) => {
          eventHandler = cb;
          return () => undefined;
        }),
      },
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
  useRemoteHostRuntimeStore.setState({ runtime: {}, reconnecting: {} });
  __resetRemoteHostOrchestrationForTest();
  remoteClient.rpc.mockResolvedValue({});
  remoteClient.connect.mockResolvedValue(remoteClient.info);
  remoteClient.onReconnectNeeded.mockReturnValue(() => undefined);
  installOkwork();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('A1 · readopt 由 reconnect promise resolve 驱动(非 main ready 事件·防终端冻结)', () => {
  it('verifying→reconnect(ws 未 open) + main ready 到达 → onReconnected 尚未调;reconnect resolve 后才收养', async () => {
    const d = deferred<typeof remoteClient.info>();
    remoteClient.reconnect.mockReturnValue(d.promise);

    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());

    // ① 收 verifying{tunnel} → beginHandshake 调 client.reconnect(新 ws·promise pending)
    act(() => eventHandler({ configId: 'cfg-1', stage: 'verifying', tunnel: { localPort: 5000, token: 'tok' } }));
    expect(remoteClient.reconnect).toHaveBeenCalledWith({
      wsUrl: 'ws://127.0.0.1:5000?token=tok',
    });

    // ② main 快路径同步连发的 'ready' 到达(ws 尚未 open)→ **不驱动收养**(A1 修复:否则 attach reject 冻结)
    act(() => eventHandler({ configId: 'cfg-1', stage: 'ready' }));
    expect(reconnectControllerMock.onReconnected).not.toHaveBeenCalled();

    // ③ ws 真 open(reconnect resolve)→ 此刻才 onReconnected(transport 就绪·attach 不 reject)
    await act(async () => {
      d.resolve(remoteClient.info);
      await Promise.resolve();
    });
    await waitFor(() => expect(reconnectControllerMock.onReconnected).toHaveBeenCalledWith('cfg-1'));
  });
});

describe('A2 · onAttemptFailed 生产接线(退避重试 + 超预算 drop 不再空转)', () => {
  it('握手失败(reconnect reject)→ onAttemptFailed(configId)', async () => {
    const d = deferred<typeof remoteClient.info>();
    remoteClient.reconnect.mockReturnValue(d.promise);

    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());

    act(() => eventHandler({ configId: 'cfg-1', stage: 'verifying', tunnel: { localPort: 5000, token: 'tok' } }));
    await act(async () => {
      d.reject(new Error('host ws connect failed'));
      await Promise.resolve();
    });
    await waitFor(() => expect(reconnectControllerMock.onAttemptFailed).toHaveBeenCalledWith('cfg-1'));
  });

  it('重连期 main emit failed → onAttemptFailed;非重连期 failed 被 isReconnecting 守卫忽略', async () => {
    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());

    // 非重连期:failed 不误入重连状态机(守卫)
    act(() => eventHandler({ configId: 'cfg-1', stage: 'failed', reason: 'unreachable' }));
    expect(reconnectControllerMock.onAttemptFailed).not.toHaveBeenCalled();

    // 进入重连期(reconnectController 先占·此处直接置态模拟)→ failed 推进退避重试
    act(() => useRemoteHostRuntimeStore.getState().setReconnecting('cfg-1', true));
    act(() => eventHandler({ configId: 'cfg-1', stage: 'failed', reason: 'unreachable' }));
    expect(reconnectControllerMock.onAttemptFailed).toHaveBeenCalledWith('cfg-1');
  });
});

describe('Q1 · Sidebar 900ms drop 闸生产路径(CR-1 gate·非死助手)', () => {
  it('reconnecting 期 disconnected → 即便 >900ms 也不 stopRemoteWorkspaceSync(抑制 full drop)', async () => {
    vi.useFakeTimers();
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
      reconnecting: { 'cfg-1': true },
    });

    render(<Sidebar />);
    await vi.waitFor(() => expect(window.okwork.remoteHost.list).toHaveBeenCalled());

    act(() => useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'disconnected' }));
    act(() => vi.advanceTimersByTime(5000)); // 远超 900ms

    expect(stopRemoteWorkspaceSync).not.toHaveBeenCalled();
  });

  it('非 reconnecting(确定断线)→ 900ms 后 stopRemoteWorkspaceSync(不回归 BL-004 full drop)', async () => {
    vi.useFakeTimers();
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
      reconnecting: {},
    });

    render(<Sidebar />);
    await vi.waitFor(() => expect(window.okwork.remoteHost.list).toHaveBeenCalled());

    act(() => useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'disconnected' }));
    act(() => vi.advanceTimersByTime(900));

    expect(stopRemoteWorkspaceSync).toHaveBeenCalledWith('cfg-1');
  });

  it('A5:disconnected 先到(未 reconnecting·已排 timer)→ 随后进入 reconnecting → 主动清 timer·不漏 drop', async () => {
    vi.useFakeTimers();
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
      reconnecting: {},
    });

    render(<Sidebar />);
    await vi.waitFor(() => expect(window.okwork.remoteHost.list).toHaveBeenCalled());

    // main 的 disconnected 先于心跳判死到达 → 此刻 isReconnecting=false → 排上 900ms drop timer
    act(() => useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'disconnected' }));
    // 随后 reconnectController 先占 reconnecting → A5 effect 主动清掉已排 timer
    act(() => useRemoteHostRuntimeStore.getState().setReconnecting('cfg-1', true));
    act(() => vi.advanceTimersByTime(5000));

    expect(stopRemoteWorkspaceSync).not.toHaveBeenCalled(); // 侧路不再脆弱·gate 真闭合
  });
});
