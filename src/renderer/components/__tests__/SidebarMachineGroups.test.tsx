// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004 · Sidebar 机器分组:本机组置顶(AC-1)· M=0 单本机组头(AC-10)·
// 连接展开 + 徽标(AC-2)· 组头连接态(AC-8)· 断线两段式回落(AC-11)。
// hostRegistry/remoteWorkspaceSync 全 mock(避免真实 WebSocket/PTY 依赖),
// window.okwork.remoteHost 用内存态假配置,store 直接 setState 种子(复刻
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
      reconnect: vi.fn(async () => ({})),
      rpc: vi.fn(async () => ({})),
      onDown: vi.fn(() => () => undefined),
      dispose: vi.fn(),
      onWorkspaceChanged: vi.fn(() => () => undefined),
      onSessionEvent: vi.fn(() => () => undefined),
      onReconnectNeeded: vi.fn((_cb: () => void) => {
        return () => {
          /* noop unsubscribe */
        };
      }),
      onRtt: vi.fn((_cb: (ms: number) => void) => {
        return () => {
          /* noop unsubscribe */
        };
      }),
    };
  }
  const localClient = makeClient('/Users/liam');
  const remoteClients = new Map<string, ReturnType<typeof makeClient>>();
  function remoteClientFor(id: string) {
    if (!remoteClients.has(id)) {
      remoteClients.set(id, makeClient('/home/liam'));
    }
    const client = remoteClients.get(id);
    if (!client) {
      throw new Error(`Client for ${id} not found`);
    }
    return client;
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
import {
  useRemoteHostRuntimeStore,
  __resetRemoteHostOrchestrationForTest,
} from '../../state/remoteHostStore';
import { reconnectController } from '../../services/reconnectWiring';

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

interface RemoteEvent {
  configId: string;
  stage: string;
  [key: string]: unknown;
}

function installOkwork(remoteHostList: () => Promise<RemoteHostConfig[]> = async () => []) {
  let emitRemoteEvent: ((e: RemoteEvent) => void) | undefined;
  Object.defineProperty(window, 'okwork', {
    value: {
      version: '0.3.13',
      devChannel: false,
      platform: 'darwin',
      smoke: false,
      requestHostPort: vi.fn(),
      pickDirectory: vi.fn(async () => null),
      onMenu: vi.fn(() => () => {
        /* noop */
      }),
      smokeOk: vi.fn(),
      storeGet: vi.fn(),
      storeSet: vi.fn(),
      setDockBadge: vi.fn(),
      focusWindow: vi.fn(),
      onUpdateEvent: vi.fn(() => () => {
        /* noop */
      }),
      installUpdate: vi.fn(),
      openViewerWindow: vi.fn(),
      showTerminalContextMenu: vi.fn(),
      showTabContextMenu: vi.fn(),
      clipboardWriteText: vi.fn(),
      clipboardReadText: vi.fn(),
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
      onViewerAddTab: vi.fn(() => () => {
        /* noop */
      }),
      remoteHost: {
        list: vi.fn(remoteHostList),
        save: vi.fn(),
        delete: vi.fn(),
        test: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        disconnectAwait: vi.fn(async () => ({})),
        onEvent: vi.fn((cb: (e: RemoteEvent) => void) => {
          emitRemoteEvent = cb;
          return () => {
            emitRemoteEvent = undefined;
          };
        }),
      },
    },
    writable: true,
    configurable: true,
  });
  return { emitRemoteEvent: () => emitRemoteEvent };
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
  useRemoteHostRuntimeStore.setState({
    runtime: {},
    reconnecting: {},
    rtt: {},
    // OKWORK-F260805033051:弃用/断开在途标记搬到了模块级 store(原来是组件内 useRef,
    // 每次挂载天然干净)。不在此重置会跨用例残留,让后续用例的事件被弃用闸吞掉。
    abandoned: {},
    settling: {},
  });
  __resetRemoteHostOrchestrationForTest();
  // 🔴 mock client 的实例缓存(remoteClients)定义在 vi.mock 工厂作用域里,**跨用例存活**:
  // 某条用例把 `reconnect` 改成返回被拒绝的 promise(如 AC-7b 验失败 toast),这个覆盖会
  // 一直留到后面的用例,让它们的握手无声地走进 .catch 分支。
  // 实证:AC-8「重连触发收养」曾因此永远等不到 onReconnected —— 症状看起来像生产代码不调,
  // 实际是上一条用例的 mock 残留。每条用例开头把握手恢复成「默认成功」。
  for (const id of ['cfg-1', 'cfg-2']) {
    (hostRegistryMock.getOrCreateRemote(id).reconnect as ReturnType<typeof vi.fn>).mockResolvedValue(
      {},
    );
  }
  // 🔴 种默认值时**调用了** getOrCreateRemote,这会被 spy 记进调用历史 —— 而 AC-6(c) 的灵魂
  // 断言正是「残余 verifying 不得触发新握手 → getOrCreateRemote 调用次数为 0」,种子调用会把
  // 它撞红。种完必须清调用记录(mockClear 只清历史、保留实现)。
  // (这条撞红本身是好消息:说明那条断言是真锁,不是空壳。)
  hostRegistryMock.getOrCreateRemote.mockClear();
  hostRegistryMock.drop.mockClear();
  hostRegistryMock.forWorkspace.mockClear();
  hostRegistryMock.forHostId.mockClear();
});

afterEach(() => {
  cleanup();
  try {
    vi.useRealTimers();
  } catch {
    /* already using real timers */
  }
  vi.clearAllMocks();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('AC-1 · 本机组置顶 + 远程机组未连接态', () => {
  it('本机组是首个 machine-group,含 N 个 workspace 行;远程组显别名 + 连接入口,不展开', async () => {
    useAppStore.setState({
      workspaces: [localWs('l1', 'OkWork'), localWs('l2', 'aon-core')],
      activeWorkspaceId: 'l1',
    });
    installOkwork(async () => [
      makeConfig({ id: 'cfg-1', alias: 'mini-pc' }),
      makeConfig({ id: 'cfg-2', alias: 'dev-server' }),
    ]);

    render(<Sidebar />);

    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());
    expect(screen.getByText('dev-server')).toBeInTheDocument();

    const groups = screen.queryAllByTestId('machine-group');
    expect(groups[0]).toHaveAttribute('data-machine-id', 'local');
    expect(screen.getByText('OkWork')).toBeInTheDocument();
    expect(screen.getByText('aon-core')).toBeInTheDocument();

    // 两个远程机组各有一个"连接"入口,workspace 行数为 0(未展开)
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(2);
    expect(screen.queryByTestId('machine-workspace-row')).not.toBeInTheDocument();
  });
});

describe('AC-10 · M=0 纯本机退化态', () => {
  it('恰好渲染 1 个 machine-group,无远程占位', async () => {
    useAppStore.setState({ workspaces: [localWs('l1', 'OkWork')], activeWorkspaceId: 'l1' });
    installOkwork(async () => []);

    render(<Sidebar />);
    await waitFor(() => expect(window.okwork.remoteHost.list).toHaveBeenCalled());

    expect(screen.queryAllByTestId('machine-group')).toHaveLength(1);
    expect(screen.queryByText(/远程/)).not.toBeInTheDocument();
  });
});

describe('AC-2 · 连接后展开 workspace + 会话徽标(含 0)', () => {
  it('runtime ready → 展开该机 workspace,首连 0 tab 显式渲染"0 session"', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 0)],
      activeWorkspaceId: 'r1',
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();

    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'ready' });
    });

    expect(await screen.findByText('aon-edge')).toBeInTheDocument();
    // 图标形态徽标:语义文本在 aria-label/title 上
    const badge = screen.getByLabelText('0 session');
    expect(badge).toHaveClass('sidebar-machine-sessions--zero');
  });
});

describe('AC-8 · 组头连接生命周期', () => {
  // T-014(AC-7):失败的呈现从「组头常驻 ✗ 原因 + Retry」改道为「全局 toast + 组头回落待连接」。
  it('connecting/deploying → CONNECT_STAGE_LABEL 文案;failed → 全局 toast + 组头回落(AC-7)', async () => {
    useAppStore.setState({ workspaces: [], activeWorkspaceId: null, transientNotice: null });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('mini-pc')).toBeInTheDocument());

    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'deploying', percent: 47 });
    });
    expect(screen.getByText(/Deploying…/)).toBeInTheDocument();
    expect(screen.getByText(/47%/)).toBeInTheDocument();

    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'failed', reason: 'unreachable' });
    });
    // 组头:失败痕迹不留,回落成可再连的连接图标钮
    expect(screen.queryByText(/Unreachable/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    // 呈现出口改为全局 toast(文案取 failReasonCopy 单源 · 带别名)
    await waitFor(() => {
      const notice = useAppStore.getState().transientNotice;
      expect(notice).toContain('mini-pc');
      expect(notice).toContain('Unreachable');
    });
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
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText('aon-edge')).toBeInTheDocument();

    vi.useFakeTimers();
    act(() => {
      useRemoteHostRuntimeStore.getState().applyEvent({ configId: 'cfg-1', stage: 'disconnected' });
    });

    // panel 阶段:仍展开,行内"已断开"标签
    expect(screen.getByText('aon-edge')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });

    // folded 阶段:组头折叠,workspace 行消失,呈现"已断开 · 点击重连"
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();
    expect(screen.getByText('Disconnected · Click to reconnect')).toBeInTheDocument();
  });
});

describe('E1 · 本机组内拖拽落位映射到全量数组坐标(review 修 · 与 d4-core 双保险)', () => {
  it('远程已连 + 本机 ws 在全量数组内不连续(远程项目排前面)→ 拖拽仍落在正确全量位置,不误动远程项目', async () => {
    // 全量数组刻意让本机 ws 不是前缀连续(远程 ws 排最前),复刻 review 描述的"子集下标≠全量下标"场景。
    useAppStore.setState({
      workspaces: [
        remoteWs('r1', 'aon-edge', 'cfg-1', 0),
        localWs('l1', 'OkWork'),
        localWs('l2', 'aon-core'),
      ],
      activeWorkspaceId: 'l1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await screen.findByText('aon-edge');

    const l2Row = screen.getByText('aon-core').closest('.sidebar-item') as HTMLElement;
    const l1Row = screen.getByText('OkWork').closest('.sidebar-item') as HTMLElement;
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
    installOkwork(async () => currentList);
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

// ────────────────────────────────────────────────────────────────────────────
// OKWORK-F260805033051 · 21 条 SidebarMachineGroups 集成测试用例
// ────────────────────────────────────────────────────────────────────────────

describe('AC-2 · 点断开立即回未连接态 (T-003~005)', () => {
  it('test_AC2_disconnect_click_reverts_next_render_no_panel', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 1)],
      activeWorkspaceId: 'r1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
      rtt: { 'cfg-1': 50 },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText('aon-edge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();

    // 点击断开钮（不通过 emitRemoteEvent,直接验证同步本地复位）
    const disconnectBtn = screen.getByRole('button', { name: 'Disconnect' });
    act(() => {
      fireEvent.click(disconnectBtn);
    });

    // 同一渲染周期内即回未连接态：不显示延迟、不展开 workspace、出现连接钮
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('test_AC2_disconnect_does_not_call_window_confirm', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('test_AC2_AC6_late_disconnected_event_never_enters_panel_stage', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 1)],
      activeWorkspaceId: 'r1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText('aon-edge')).toBeInTheDocument();
    vi.useFakeTimers();

    // 点击断开
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    // 点击后组头已回落,现在推送迟到的 disconnected 事件
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'disconnected' });
    });

    // workspace 行不出现 panel 态的"已断开"标签
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();

    // 推进时间超过 900ms 也不会进入 panel
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('aon-edge')).not.toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });
});

describe('AC-5 · 点取消立即回未连接态 (T-009)', () => {
  it('test_AC5_cancel_click_reverts_synchronously_without_waiting_for_event', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'connecting' } },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText(/Connecting/)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    act(() => {
      fireEvent.click(cancelBtn);
    });

    // 同步回落到未连接态,不需要任何事件推送
    expect(screen.queryByText(/Connecting/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });
});

describe('AC-6 · 取消后残余写入不得复活组头 (T-010~013)', () => {
  it('test_AC6a_residual_lifecycle_events_after_cancel_do_not_revive_group', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'connecting' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText(/Connecting/)).toBeInTheDocument();

    // 点击取消
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    // 验证组头已回落
    expect(screen.queryByText(/Connecting/)).not.toBeInTheDocument();

    // 现在推送残余事件
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'deploying' });
    });

    // 组头不应该被复活为 active 展示
    expect(screen.queryByText(/Deploying/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('test_AC6c_residual_verifying_after_cancel_does_not_trigger_new_handshake', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'connecting' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await screen.findByText(/Connecting/);

    // 点击取消
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });

    // 验证 abandoned 标记已被设置
    expect(useRemoteHostRuntimeStore.getState().isAbandoned('cfg-1')).toBe(true);

    // 推送残余 verifying 事件
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({
        configId: 'cfg-1',
        stage: 'verifying',
        tunnel: { localPort: 5555, token: 'xyz' },
      });
    });

    // 灵魂断言：hostRegistry.getOrCreateRemote 未被调用（getOrCreateRemote 一旦调用就会把客户端塞进去）
    const { hostRegistry: hostReg } = await import('../../services/hostRegistry');
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const callsToGetOrCreate = (hostReg.getOrCreateRemote as any).mock.calls.filter(
      (call: any[]) => call[0] === 'cfg-1',
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
    expect(callsToGetOrCreate).toHaveLength(0);

    // 验证 UI 状态：组头仍显示连接图标,不进入 verifying
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.queryByText(/Verifying/)).not.toBeInTheDocument();
  });

  it('test_AC6b_inflight_handshake_resolve_after_cancel_does_not_adopt', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'verifying' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    // 准备一个可控的握手 promise
    let resolveHandshake: (() => void) | undefined;
    const handshakePromise = new Promise<void>((r) => {
      resolveHandshake = r;
    });

    const mockClient = hostRegistryMock.getOrCreateRemote('cfg-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockClient.reconnect as any).mockReturnValue(handshakePromise);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockClient.rpc as any).mockResolvedValue({});

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    // 推送 verifying 事件,触发 beginHandshake
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({
        configId: 'cfg-1',
        stage: 'verifying',
        tunnel: { localPort: 5555, token: 'xyz' },
      });
    });

    // 验证握手已启动（reconnect 被调用）
    expect(mockClient.reconnect).toHaveBeenCalled();

    // 现在点击取消,置 abandoned 标记
    act(() => {
      useRemoteHostRuntimeStore.getState().abandon('cfg-1');
    });

    // 握手 resolve（模拟对端关闭后的成功握手）
    act(() => {
      resolveHandshake?.();
    });

    // 轮询等待微任务链完成
    await vi.waitFor(() => {
      // 灵魂断言：rpc 不应该被调用过（既不 session.list 也不 session.attach）
      const rpcCalls = (mockClient.rpc as any).mock.calls;
      const listOrAttachCalls = rpcCalls.filter(
        (call: any[]) =>
          call[0] === 'session.list' || call[0] === 'session.attach',
      );
      expect(listOrAttachCalls).toHaveLength(0);
    });
  });

  it('test_AC6b_inflight_handshake_reject_after_cancel_does_not_toast_failed', async () => {
    useAppStore.setState({ transientNotice: null });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'verifying' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    let rejectHandshake: ((e: Error) => void) | undefined;
    const handshakePromise = new Promise<void>((_, r) => {
      rejectHandshake = r;
    });

    const mockClient = hostRegistryMock.getOrCreateRemote('cfg-1');
    (mockClient.reconnect as any).mockReturnValue(handshakePromise);

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({
        configId: 'cfg-1',
        stage: 'verifying',
        tunnel: { localPort: 5555, token: 'xyz' },
      });
    });

    // 点击取消
    act(() => {
      useRemoteHostRuntimeStore.getState().abandon('cfg-1');
    });

    // 握手 reject
    act(() => {
      rejectHandshake?.(new Error('ws error'));
    });

    // 等待微任务
    await vi.waitFor(() => {
      const notice = useAppStore.getState().transientNotice;
      expect(notice).toBeNull();
    });
  });
});

describe('AC-7 · 失败弹 toast 回落 (T-015~018)', () => {
  it('test_AC7a_main_pushed_failed_event_shows_toast_and_group_falls_back', async () => {
    useAppStore.setState({ transientNotice: null });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'connecting' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await screen.findByText(/Connecting/);

    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'failed', reason: 'unreachable' });
    });

    // 断言 toast 弹出
    await waitFor(() => {
      const notice = useAppStore.getState().transientNotice;
      expect(notice).toContain('mini-pc');
      expect(notice).toContain('Unreachable');
    });

    // 组头回落为连接图标钮
    expect(screen.queryByText(/Connecting/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('test_AC7b_local_handshake_catch_failed_shows_toast_and_group_falls_back', async () => {
    useAppStore.setState({ transientNotice: null });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'verifying' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    // 🔴 必须把**被拒绝的那条**交给组件。此前写的是 `.catch(...)` 之后的链 ——
    // catch 把拒绝吞成了 resolve,组件走的是 `.then` 分支,根本到不了写 failed / 弹 toast 的路径,
    // 于是断言拿到 transientNotice = null。catch 只挂在旁支上用于压掉未处理拒绝告警。
    const handshakePromise = Promise.reject(new Error('Protocol error'));
    handshakePromise.catch(() => {
      /* 仅为消除 unhandled rejection 告警;传给组件的仍是上面那条被拒绝的 promise */
    });
    const mockClient = hostRegistryMock.getOrCreateRemote('cfg-1');
    (mockClient.reconnect as any).mockReturnValue(handshakePromise);

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({
        configId: 'cfg-1',
        stage: 'verifying',
        tunnel: { localPort: 5555, token: 'xyz' },
      });
    });

    // 等待握手 reject 和后续处理，toast 由 effect 驱动所以需要 waitFor
    await waitFor(() => {
      const notice = useAppStore.getState().transientNotice;
      expect(notice).toBeTruthy();
      expect(notice).toContain('mini-pc');
    });

    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('test_AC7_reconnect_backoff_period_failed_event_does_not_toast', async () => {
    useAppStore.setState({ transientNotice: null });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'connecting' } },
      reconnecting: { 'cfg-1': true },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    // 清空 notice 来确保测试前为 null
    useAppStore.setState({ transientNotice: null });

    // 推送 failed 事件（在 reconnecting 期间）
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'failed', reason: 'unreachable' });
    });

    // 断言：toast 不应该弹出（isReconnecting 守卫）
    expect(useAppStore.getState().transientNotice).toBeNull();
  });
});

describe('AC-8 · 断开重连收养 (T-019)', () => {
  it('test_AC8_disconnect_routes_through_stopsync_and_reconnect_triggers_readopt', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    const onReconnectedSpy = vi.spyOn(reconnectController, 'onReconnected');

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    const { stopRemoteWorkspaceSync } = await import('../../services/remoteWorkspaceSync');

    // 点击断开
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    // 验证 stopRemoteWorkspaceSync 被调用
    expect(stopRemoteWorkspaceSync).toHaveBeenCalledWith('cfg-1');

    // 重新连接
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });

    // 🔴 点连接**不等于**握手完成。`onReconnected` 是在 beginHandshake 的 `.then` 里调的,
    // 要真的把握手走完才会触发 —— 此前这条只点了连接就断言它被调用,注释写着「模拟握手完成」
    // 但一步都没模拟,期望永远不可能满足。
    // 先等排队兑现(resume 在兑现点执行,弃用闸随之打开),否则下面推的事件会被闸①吞掉。
    await vi.waitFor(() => {
      expect(useRemoteHostRuntimeStore.getState().isAbandoned('cfg-1')).toBe(false);
    });

    // 推 verifying{tunnel} → 触发 beginHandshake;mock client 的 reconnect 默认 resolve,
    // 续体走 .then → applyEvent(ready) → reconnectController.onReconnected
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({
        configId: 'cfg-1',
        stage: 'verifying',
        tunnel: { localPort: 5555, token: 'xyz' },
      });
    });

    await vi.waitFor(() => {
      expect(onReconnectedSpy).toHaveBeenCalledWith('cfg-1');
    });
  });
});

describe('AC-9 · 手动断开/取消后不自动重连 (T-021~022, T-038)', () => {
  it('test_AC9_disconnect_click_on_connected_calls_reconnectcontroller_cancel', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    const cancelSpy = vi.spyOn(reconnectController, 'cancel');

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    expect(cancelSpy).toHaveBeenCalledWith('cfg-1');
  });

  it('test_AC9_gate4_onreconnectneeded_blocked_when_abandoned', async () => {
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    const onDisconnectedSpy = vi.spyOn(reconnectController, 'onDisconnected');

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    // 设置 abandoned 标记（模拟点击断开）
    act(() => {
      useRemoteHostRuntimeStore.getState().abandon('cfg-1');
    });

    // 获取 mock client 并模拟调用 onReconnectNeeded
    const mockClient = hostRegistryMock.getOrCreateRemote('cfg-1');
    const onReconnectNeededCalls = (mockClient.onReconnectNeeded as any).mock.calls;

    // 检查是否有注册的回调（在组件挂载时）
    if (onReconnectNeededCalls.length > 0) {
      const callback = onReconnectNeededCalls[onReconnectNeededCalls.length - 1][0];

      onDisconnectedSpy.mockClear();

      // 调用回调（模拟心跳判死）
      act(() => {
        callback();
      });

      // 断言：onDisconnected 不应被调用
      expect(onDisconnectedSpy).not.toHaveBeenCalledWith('cfg-1');
    }
  });

  it('test_AC9_queued_connect_rechecks_abandoned_before_firing_ipc', async () => {
    let resolveDisconnect: (() => void) | undefined;
    const disconnectPromise = new Promise<void>((r) => {
      resolveDisconnect = r;
    });

    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });

    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    (window.okwork.remoteHost.disconnectAwait as any).mockReturnValue(disconnectPromise);
    (window.okwork.remoteHost.connect as any).mockClear();

    render(<Sidebar />);
    await screen.findByText('mini-pc');
    // Ensure Disconnect button is rendered (machine in connected state)
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();

    // 点击断开
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    // 验证断开在途
    expect(useRemoteHostRuntimeStore.getState().settling['cfg-1']).toBe(true);

    // 在 settling 期间点击连接（排队）
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });

    // 用户改主意,再次表达「断开」意图。
    // 🔴 这里**不能**再点断开钮:第一次断开后组头已回落成连接钮,断开钮根本没渲染
    //   (UI 上到不了「排队中再点断开」这个态)。本条要验的是 Sidebar 那条**已排队的 .then**
    //   在兑现前会复查意图,所以直接从 store 触发弃用,等价于任一入口的断开 handler。
    act(() => {
      useRemoteHostRuntimeStore.getState().abandon('cfg-1');
    });
    expect(useRemoteHostRuntimeStore.getState().isAbandoned('cfg-1')).toBe(true);

    // resolve 断开 promise → 排队的 connect 到点,但意图已撤销 → 不得发 IPC
    act(() => {
      resolveDisconnect?.();
    });

    // 🔴 先等一个**正向**信号证明链条确实走完了(settling 被 finally 清掉),再断言「没发」。
    // 直接把 not.toHaveBeenCalled() 塞进 waitFor 是假绿:它在第一次轮询就通过,
    // 什么都没等到,也就什么都没证明。
    await vi.waitFor(() => {
      expect(useRemoteHostRuntimeStore.getState().settling['cfg-1']).toBeUndefined();
    });
    expect(window.okwork.remoteHost.connect).not.toHaveBeenCalled();
  });
});

describe('AC-10 · 自动重连中「立即重试」+断开可用 (T-024)', () => {
  it('test_AC9_AC10_AC12_disconnect_click_during_reconnecting_terminates_and_falls_back', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 1)],
      activeWorkspaceId: 'r1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'connecting' } },
      reconnecting: { 'cfg-1': true },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    const cancelSpy = vi.spyOn(reconnectController, 'cancel');

    render(<Sidebar />);
    expect(await screen.findByText('mini-pc')).toBeInTheDocument();

    const { stopRemoteWorkspaceSync } = await import('../../services/remoteWorkspaceSync');

    // 点击断开
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    // 验证调用链路
    expect(cancelSpy).toHaveBeenCalledWith('cfg-1');
    expect(stopRemoteWorkspaceSync).toHaveBeenCalledWith('cfg-1');

    // 验证组头回落为未连接
    expect(screen.queryByText('mini-pc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });
});

describe('AC-12 · 断开已连接/重连中的机器激活项回落 (T-028)', () => {
  it('test_AC12_disconnect_connected_active_machine_calls_stopsync_for_fallback', async () => {
    useAppStore.setState({
      workspaces: [remoteWs('r1', 'aon-edge', 'cfg-1', 1)],
      activeWorkspaceId: 'r1',
    });
    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);

    render(<Sidebar />);
    expect(await screen.findByText('aon-edge')).toBeInTheDocument();

    const { stopRemoteWorkspaceSync } = await import('../../services/remoteWorkspaceSync');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    expect(stopRemoteWorkspaceSync).toHaveBeenCalledWith('cfg-1');
  });
});

describe('AC-13 · 取消后连接排队 8 秒上界 (T-029~031)', () => {
  it('test_AC13_busy_state_click_is_queued_not_immediately_fired', async () => {
    // 🔴 本条**不开 fake timers**:它不需要推进时间,而 `screen.findBy*` 内部靠真实定时器
    // 轮询,假时钟一开就永远等不到 → 卡满 20s 超时。
    let resolveDisconnect: (() => void) | undefined;
    const disconnectPromise = new Promise<void>((r) => {
      resolveDisconnect = r;
    });
    void resolveDisconnect; // 本条只验排队中的中间态,不需要让它结算

    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });

    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    (window.okwork.remoteHost.disconnectAwait as any).mockReturnValue(disconnectPromise);
    (window.okwork.remoteHost.connect as any).mockClear();

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    // 点击断开
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    // 在 settling 期间点击连接
    const connectBtn = screen.getByRole('button', { name: 'Connect' });
    act(() => {
      fireEvent.click(connectBtn);
    });

    // 断言：此刻 connect IPC 未被调用（排队中）
    expect(window.okwork.remoteHost.connect).not.toHaveBeenCalled();

    // 断言：连接按钮有 aria-busy
    expect(connectBtn).toHaveAttribute('aria-busy', 'true');

    // 🔴 忙碌必须「看得见」:aria-busy 只给读屏,不产生像素。
    // dev 期实测过只写 aria-busy 时忙碌态与常态**像素级相同**——这两条锁住可见反馈本身,
    // 少了它们,谁把 MachineCtlButton 里的 spinner 三元撤回去、全部用例照样绿。
    // (生产代码已实现 .sidebar-machine-ctl__busy;harness 走英文 fallback 故 title 是英文键。)
    expect(connectBtn.querySelector('.sidebar-machine-ctl__busy')).toBeTruthy();
    expect(connectBtn).toHaveAttribute('title', 'Disconnecting…');

    // 点击必须真实派发：原生 disabled 会让浏览器吞掉 click，
    // 那正好退化回 AC-13 要防的「点了没反应」
    expect(connectBtn).not.toHaveAttribute('disabled');
  });

  it('test_AC13_pending_disconnect_resolves_fires_queued_connect_exactly_once', async () => {
    let resolveDisconnect: (() => void) | undefined;
    const disconnectPromise = new Promise<void>((r) => {
      resolveDisconnect = r;
    });

    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });

    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    (window.okwork.remoteHost.disconnectAwait as any).mockReturnValue(disconnectPromise);
    (window.okwork.remoteHost.connect as any).mockClear();

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    // 点击断开,再点连接
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });

    // resolve 断开 promise
    act(() => {
      resolveDisconnect?.();
    });

    // 等待兑现
    await vi.waitFor(() => {
      expect(window.okwork.remoteHost.connect).toHaveBeenCalledTimes(1);
    });
  });

  it('test_AC13_eight_second_upper_bound_fires_connect_even_if_disconnect_hangs', async () => {
    // 🔴 fake timers 必须在**首次渲染与 findBy* 之后**才开:`findBy*` 靠真实定时器轮询,
    // 提前开假时钟会让它永远等不到 → 20s 超时(不是产品问题,是工装顺序问题)。
    // 断开 promise 永不 resolve
    const disconnectPromise = new Promise<void>(() => {
      /* 故意不 resolve —— 8 秒上界就是为这种悬挂兜底的 */
    });

    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });

    installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    (window.okwork.remoteHost.disconnectAwait as any).mockReturnValue(disconnectPromise);
    (window.okwork.remoteHost.connect as any).mockClear();

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    vi.useFakeTimers(); // ← 渲染稳定之后才切假时钟

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });

    // 上界到达前不放行 —— 这条对照断言是本用例的价值所在:
    // 只断言「8 秒后发出」只能证明「迟早会发」,证明不了**上界**。
    await vi.advanceTimersByTimeAsync(7999);
    expect(window.okwork.remoteHost.connect).not.toHaveBeenCalled();

    // 跨过 8 秒 → 放行(disconnectAwait 仍未 resolve)
    // 🔴 用 advanceTimersByTimeAsync(它会同时 flush 微任务),**不要** vi.waitFor ——
    // waitFor 靠真实定时器轮询,与假时钟同处一条用例必然互锁。
    await vi.advanceTimersByTimeAsync(1);
    expect(window.okwork.remoteHost.connect).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('AC-14 · 弃用机器重新连接清弃用标记 (T-032)', () => {
  it('test_AC14_abandoned_machine_reconnect_clears_flag_lifecycle_renders_normally', async () => {
    let resolveDisconnect: (() => void) | undefined;
    const disconnectPromise = new Promise<void>((r) => {
      resolveDisconnect = r;
    });

    useRemoteHostRuntimeStore.setState({
      runtime: { 'cfg-1': { configId: 'cfg-1', stage: 'ready' } },
    });
    const bridge = installOkwork(async () => [makeConfig({ id: 'cfg-1', alias: 'mini-pc' })]);
    (window.okwork.remoteHost.disconnectAwait as any).mockReturnValue(disconnectPromise);
    (window.okwork.remoteHost.connect as any).mockClear();

    render(<Sidebar />);
    await screen.findByText('mini-pc');

    // 1. 点击断开 → 置 abandoned
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    });
    expect(useRemoteHostRuntimeStore.getState().isAbandoned('cfg-1')).toBe(true);

    // 2. 点击连接 → 排队中，isAbandoned 仍为 true（闸门不得提前开），connect IPC 未发出
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    });
    expect(useRemoteHostRuntimeStore.getState().isAbandoned('cfg-1')).toBe(true);
    expect(window.okwork.remoteHost.connect).not.toHaveBeenCalled();

    // 3. 让 disconnectAwait 结算 → isAbandoned 变假，connect IPC 发出
    act(() => {
      resolveDisconnect?.();
    });
    await vi.waitFor(() => {
      expect(useRemoteHostRuntimeStore.getState().isAbandoned('cfg-1')).toBe(false);
    });
    expect(window.okwork.remoteHost.connect).toHaveBeenCalled();

    // 4. 推送生命周期事件 → 应正常通过（不被弃用闸吞掉）
    const emitEvent = bridge.emitRemoteEvent();
    expect(emitEvent).toBeDefined();
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'connecting' });
    });
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'deploying' });
    });
    act(() => {
      emitEvent!({
        configId: 'cfg-1',
        stage: 'verifying',
        tunnel: { localPort: 5555, token: 'xyz' },
      });
    });
    act(() => {
      emitEvent!({ configId: 'cfg-1', stage: 'ready' });
    });

    // 验证 runtime 已更新为 ready
    expect(useRemoteHostRuntimeStore.getState().runtime['cfg-1']?.stage).toBe('ready');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
});
