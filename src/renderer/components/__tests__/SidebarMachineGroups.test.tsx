// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004 · Sidebar 机器分组:本机组置顶(AC-1)· M=0 单本机组头(AC-10)·
// 连接展开 + 徽标(AC-2)· 组头连接态(AC-8)· 断线两段式回落(AC-11)。
// hostRegistry/remoteWorkspaceSync 全 mock(避免真实 WebSocket/PTY 依赖),
// window.termpro.remoteHost 用内存态假配置,store 直接 setState 种子(复刻
// notificationBadge.test.ts / RemoteHostsPage.test.tsx 既有模式)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import type { RemoteHostConfig } from '../../../shared/remoteHost';

expect.extend(matchers);

const { hostRegistryMock } = vi.hoisted(() => {
  function makeClient(homedir: string) {
    return {
      info: { hostId: 'x', protocolVersion: 1, platform: 'darwin', homedir, shell: '/bin/zsh' },
      connect: vi.fn(async () => ({})),
      rpc: vi.fn(async () => ({})),
      onDown: vi.fn(() => () => undefined),
      dispose: vi.fn(),
      onWorkspaceChanged: vi.fn(() => () => undefined),
      onSessionEvent: vi.fn(() => () => undefined),
    };
  }
  const localClient = makeClient('/Users/liam');
  const remoteClients = new Map<string, ReturnType<typeof makeClient>>();
  function remoteClientFor(id: string) {
    if (!remoteClients.has(id)) remoteClients.set(id, makeClient('/home/liam'));
    return remoteClients.get(id)!;
  }
  const hostRegistryMock = {
    local: vi.fn(() => localClient),
    getOrCreateRemote: vi.fn((id: string) => remoteClientFor(id)),
    drop: vi.fn(),
    forWorkspace: vi.fn((ws: { hostId: string }) =>
      ws.hostId === 'local' ? localClient : remoteClientFor(ws.hostId),
    ),
    forHostId: vi.fn((id: string) => (id === 'local' ? localClient : remoteClientFor(id))),
  };
  return { hostRegistryMock };
});

vi.mock('../../services/hostRegistry', () => ({ hostRegistry: hostRegistryMock }));
vi.mock('../../services/remoteWorkspaceSync', () => ({
  startRemoteWorkspaceSync: vi.fn(async () => undefined),
  stopRemoteWorkspaceSync: vi.fn(),
}));

import { Sidebar } from '../Sidebar';
import { useAppStore } from '../../state/store';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';

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

function installTermpro(remoteHostList: () => Promise<RemoteHostConfig[]> = async () => []) {
  Object.defineProperty(window, 'termpro', {
    value: {
      version: '0.3.13',
      devChannel: false,
      platform: 'darwin',
      smoke: false,
      requestHostPort: vi.fn(),
      pickDirectory: vi.fn(async () => null),
      onMenu: vi.fn(() => () => undefined),
      smokeOk: vi.fn(),
      storeGet: vi.fn(),
      storeSet: vi.fn(),
      setDockBadge: vi.fn(),
      focusWindow: vi.fn(),
      onUpdateEvent: vi.fn(() => () => undefined),
      installUpdate: vi.fn(),
      openViewerWindow: vi.fn(),
      showTerminalContextMenu: vi.fn(),
      showTabContextMenu: vi.fn(),
      clipboardWriteText: vi.fn(),
      clipboardReadText: vi.fn(),
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
      openInBrowser: vi.fn(),
      onViewerAddTab: vi.fn(() => () => undefined),
      remoteHost: {
        list: vi.fn(remoteHostList),
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

function localWs(id: string, name: string, tabCount = 0) {
  return {
    id,
    name,
    root: `/Users/liam/apps/${name}`,
    hostId: 'local',
    tabs: Array.from({ length: tabCount }, (_, i) => ({ id: `${id}-t${i}`, title: 't', cwd: '/r' })),
    activeTabId: null,
  };
}

function remoteWs(id: string, name: string, hostId: string, tabCount = 0) {
  return {
    id,
    name,
    root: `/home/liam/apps/${name}`,
    hostId,
    tabs: Array.from({ length: tabCount }, (_, i) => ({ id: `${id}-t${i}`, title: 't', cwd: '/r' })),
    activeTabId: null,
  };
}

beforeEach(() => {
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
  useRemoteHostRuntimeStore.setState({ runtime: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).termpro;
  vi.clearAllMocks();
});

describe('AC-1 · 本机组置顶 + 远程机组未连接态', () => {
  it('本机组是首个 machine-group,含 N 个 workspace 行;远程组显别名 + 连接入口,不展开', async () => {
    useAppStore.setState({
      workspaces: [localWs('l1', 'TermPro'), localWs('l2', 'aon-core')],
      activeWorkspaceId: 'l1',
    });
    installTermpro(async () => [
      makeConfig({ id: 'cfg-1', alias: 'mini-pc' }),
      makeConfig({ id: 'cfg-2', alias: 'dev-server' }),
    ]);

    render(<Sidebar />);

    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());
    expect(screen.getByText('dev-server')).toBeInTheDocument();

    const groups = screen.queryAllByTestId('machine-group');
    expect(groups[0]).toHaveAttribute('data-machine-id', 'local');
    expect(screen.getByText('TermPro')).toBeInTheDocument();
    expect(screen.getByText('aon-core')).toBeInTheDocument();

    // 两个远程机组各有一个"连接"入口,workspace 行数为 0(未展开)
    expect(screen.getAllByRole('button', { name: '连接' })).toHaveLength(2);
    expect(screen.queryByTestId('machine-workspace-row')).not.toBeInTheDocument();
  });
});

describe('AC-10 · M=0 纯本机退化态', () => {
  it('恰好渲染 1 个 machine-group,无远程占位', async () => {
    useAppStore.setState({ workspaces: [localWs('l1', 'TermPro')], activeWorkspaceId: 'l1' });
    installTermpro(async () => []);

    render(<Sidebar />);
    await waitFor(() => expect(window.termpro.remoteHost.list).toHaveBeenCalled());

    expect(screen.queryAllByTestId('machine-group')).toHaveLength(1);
    expect(screen.queryByText(/远程/)).not.toBeInTheDocument();
  });
});

describe('AC-2 · 连接后展开 workspace + 会话徽标(含 0)', () => {
  it('runtime ready → 展开该机 workspace,首连 0 tab 显式渲染"0 个标签"', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 0)],
      activeWorkspaceId: 'r1',
    });
    installTermpro(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();

    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'ready' });
    });

    expect(await screen.findByText('aon-edge')).toBeInTheDocument();
    const badge = screen.getByText('0 个标签');
    expect(badge).toHaveClass('sidebar-machine-sessions--zero');
  });
});

describe('AC-8 · 组头连接生命周期', () => {
  it('connecting/deploying → CONNECT_STAGE_LABEL 文案;failed → 失败原因 + 重试', async () => {
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
    installTermpro(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());

    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'deploying', percent: 47 });
    });
    expect(screen.getByText(/部署中…/)).toBeInTheDocument();
    expect(screen.getByText(/47%/)).toBeInTheDocument();

    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'failed', reason: 'unreachable' });
    });
    expect(screen.getByText(/不可达/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});

describe('AC-11 · 断线两段式回落', () => {
  it('panel 阶段:红点 + 行内"已断开"标签(仍展开)→ 900ms 后 folded:组头折叠为"已断开 · 点击重连"', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 1)],
      activeWorkspaceId: 'r1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installTermpro(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText('aon-edge')).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'disconnected' });
    });

    // panel 阶段:仍展开,行内"已断开"标签
    expect(screen.getByText('aon-edge')).toBeInTheDocument();
    expect(screen.getByText('已断开')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });

    // folded 阶段:组头折叠,workspace 行消失,呈现"已断开 · 点击重连"
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();
    expect(screen.getByText('已断开 · 点击重连')).toBeInTheDocument();
  });
});

describe('E1 · 本机组内拖拽落位映射到全量数组坐标(review 修 · 与 d4-core 双保险)', () => {
  it('远程已连 + 本机 ws 在全量数组内不连续(远程项目排前面)→ 拖拽仍落在正确全量位置,不误动远程项目', async () => {
    // 全量数组刻意让本机 ws 不是前缀连续(远程 ws 排最前),复刻 review 描述的"子集下标≠全量下标"场景。
    useAppStore.setState({
      workspaces: [
        remoteWs('r1', 'aon-edge', 'cfg-1', 0),
        localWs('l1', 'TermPro'),
        localWs('l2', 'aon-core'),
      ],
      activeWorkspaceId: 'l1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installTermpro(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await screen.findByText('aon-edge');

    const l2Row = screen.getByText('aon-core').closest('.sidebar-item') as HTMLElement;
    const l1Row = screen.getByText('TermPro').closest('.sidebar-item') as HTMLElement;
    expect(l2Row).toBeTruthy();
    expect(l1Row).toBeTruthy();

    // 🔴 不能用 fireEvent.dragOver(el, {clientY}) 的 eventInit 简写——RTL 对未识别的 dragover
    // 事件类型退回普通 MouseEvent,clientY 是只读 accessor,Object.assign 式合并会静默丢弃
    // (探测实测:eventInit 传的 clientY 在处理函数里恒读到 undefined)。改用构造函数传参 +
    // dispatchEvent,clientY 才会真正生效。
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() };
    const dragStartEvent = new MouseEvent('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStartEvent, 'dataTransfer', { value: dataTransfer });
    fireEvent(l2Row, dragStartEvent);

    vi.spyOn(l1Row, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 140,
      height: 40,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 100,
      toJSON() {
        return {};
      },
    });
    // clientY 105 < midY(120) → 拖到 l1 上半部 → 插到 l1 之前
    const dragOverEvent = new MouseEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: 105,
    });
    Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dataTransfer });
    fireEvent(l1Row, dragOverEvent);

    const ids = useAppStore.getState().workspaces.map((w) => w.id);
    // 远程项目 r1 全局位置不受本机组内重排影响(仍在最前);本机子集内 l2 排到 l1 之前。
    expect(ids).toEqual(['r1', 'l2', 'l1']);
  });
});

describe('E4 · Sidebar 会话中远程机配置列表轮询刷新(review 修)', () => {
  it('list 变化后远程组更新:新机出现;已删机器组消失 + 触发 stopRemoteWorkspaceSync', async () => {
    vi.useFakeTimers();
    let currentList: RemoteHostConfig[] = [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })];
    installTermpro(async () => currentList);
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });

    render(<Sidebar />);
    await vi.waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());

    // 新增一台远程机配置(模拟用户在「远程机」管理页新增,list 下次轮询会拿到它)
    currentList = [...currentList, makeConfig({ id: 'cfg-2', alias: 'dev-server' })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('dev-server')).toBeInTheDocument();

    // 删除 mini-pc(cfg-1)→ 下次轮询后该机组消失,且触发 stopRemoteWorkspaceSync 清理其 sync/runtime
    currentList = currentList.filter((c) => c.id !== 'cfg-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText('mini-pc')).not.toBeInTheDocument();
    expect(screen.getByText('dev-server')).toBeInTheDocument();
    expect(useRemoteHostRuntimeStore.getState().runtime['cfg-1']).toBeUndefined();

    const { stopRemoteWorkspaceSync } = await import('../../services/remoteWorkspaceSync');
    expect(stopRemoteWorkspaceSync).toHaveBeenCalledWith('cfg-1');
  });
});
