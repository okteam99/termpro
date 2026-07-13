// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-003 RemoteHostsPage(移植自 docs/design/preview-project · ARCH-B6)。
// hostRegistry 全 mock(避免真实 WebSocket/PTY 依赖),window.okwork.remoteHost 用内存态假桥。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

import { RemoteHostsPage } from '../RemoteHostsPage';
import { useRemoteHostRuntimeStore } from '../../../state/remoteHostStore';
import {
  buildIncompatibleDetail,
  ProtocolIncompatibleError,
} from '../../../../shared/versionCompat';
import type {
  RemoteEvent,
  RemoteHostConfig,
  RemoteHostConfigInput,
  TestResult,
} from '../../../../shared/remoteHost';
import type { HostInfo } from '../../../../shared/protocol';

// hostRegistry 全 mock:本文件只验证 RemoteHostsPage 的调用契约(getOrCreateRemote/connect/drop),
// 不驱动真实 WebSocket 握手(那属于 hostClientConnectOpts.test.ts / host 侧集成测)。
const { fakeRemoteClient, hostRegistryMock } = vi.hoisted(() => {
  const fakeRemoteClient = {
    info: null as HostInfo | null,
    connect: vi.fn(),
    // 🔴 E2(review-fix):beginHandshake 改调 client.reconnect(单一 owner·硬门④)——mock 补该方法,
    // 握手驱动断言从 connect 迁到 reconnect。
    reconnect: vi.fn(),
    rpc: vi.fn(),
    dispose: vi.fn(),
  };
  const hostRegistryMock = {
    local: vi.fn(() => fakeRemoteClient),
    getOrCreateRemote: vi.fn(() => fakeRemoteClient),
    drop: vi.fn(),
  };
  return { fakeRemoteClient, hostRegistryMock };
});

vi.mock('../../../services/hostRegistry', () => ({
  hostRegistry: hostRegistryMock,
}));

// reconnectWiring 全 mock:页面只依赖 cancel(用户主动断开终止在途重连编排),
// 真实模块会拖入 remoteWorkspaceSync/sessionReadopt 等重依赖,与本文件无关。
const { reconnectControllerMock } = vi.hoisted(() => ({
  reconnectControllerMock: { cancel: vi.fn() },
}));
vi.mock('../../../services/reconnectWiring', () => ({
  reconnectController: reconnectControllerMock,
}));

function makeConfig(overrides: Partial<RemoteHostConfig> = {}): RemoteHostConfig {
  return {
    id: 'cfg-1',
    alias: 'mini-pc',
    host: '192.168.1.40',
    port: 22,
    username: 'liam',
    authType: 'key',
    privateKeyPath: '~/.ssh/id_ed25519',
    hasPassword: false,
    hasPassphrase: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** 内存态假桥:list/save/delete 对一份可变数组做真实 CRUD,onEvent 记录监听者供 emit 驱动。 */
function makeRemoteHostBridge(initial: RemoteHostConfig[] = []) {
  const configs = [...initial];
  const listeners: Array<(e: RemoteEvent) => void> = [];
  let seq = 0;

  const bridge = {
    list: vi.fn(async (): Promise<RemoteHostConfig[]> => [...configs]),
    save: vi.fn(
      async (payload: {
        config: RemoteHostConfigInput;
        password?: string;
        passphrase?: string;
      }): Promise<RemoteHostConfig> => {
        const idx = payload.config.id
          ? configs.findIndex((c) => c.id === payload.config.id)
          : -1;
        const id = payload.config.id ?? `cfg-new-${++seq}`;
        const record: RemoteHostConfig = {
          id,
          alias: payload.config.alias,
          host: payload.config.host,
          port: payload.config.port,
          username: payload.config.username,
          authType: payload.config.authType,
          privateKeyPath: payload.config.privateKeyPath,
          hasPassword: !!payload.password || (idx >= 0 ? !!configs[idx].hasPassword : false),
          hasPassphrase:
            !!payload.passphrase || (idx >= 0 ? !!configs[idx].hasPassphrase : false),
          lastUsed: idx >= 0 ? configs[idx].lastUsed : undefined,
          createdAt: idx >= 0 ? configs[idx].createdAt : Date.now(),
        };
        if (idx >= 0) configs[idx] = record;
        else configs.push(record);
        return record;
      },
    ),
    delete: vi.fn(async (payload: { id: string }): Promise<void> => {
      const idx = configs.findIndex((c) => c.id === payload.id);
      if (idx >= 0) configs.splice(idx, 1);
    }),
    test: vi.fn(async (): Promise<TestResult> => ({ ok: true })),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn((cb: (e: RemoteEvent) => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
  };

  function emit(e: RemoteEvent) {
    listeners.slice().forEach((cb) => cb(e));
  }

  return { bridge, emit, configs };
}

async function renderPage(initial: RemoteHostConfig[] = []) {
  const { bridge, emit, configs } = makeRemoteHostBridge(initial);
  Object.defineProperty(window, 'okwork', {
    value: { remoteHost: bridge },
    writable: true,
    configurable: true,
  });
  const onClose = vi.fn();
  const utils = render(<RemoteHostsPage onClose={onClose} />);
  // 等首次 list() 落地(否则空态引导会短暂闪现,导致后续查询抓错元素)
  await waitFor(() => expect(bridge.list).toHaveBeenCalled());
  return { ...utils, bridge, emit, configs, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  hostRegistryMock.getOrCreateRemote.mockReturnValue(fakeRemoteClient);
  hostRegistryMock.local.mockReturnValue(fakeRemoteClient);
});

afterEach(() => {
  cleanup();
  useRemoteHostRuntimeStore.setState({ runtime: {} });
  delete (window as unknown as { okwork?: unknown }).okwork;
});

// --- T-003: settings 列表随 save 实时更新,无需重开弹层(AC-1) ---
describe('test_AC1_settings_list_live_update', () => {
  it('adding a host via the form updates the manual list in place', async () => {
    const { bridge } = await renderPage([]);

    expect(screen.getByText('No remote hosts yet · Click below to add one')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add remote host'));

    fireEvent.change(screen.getByPlaceholderText('alias'), {
      target: { value: 'gpu-box' },
    });
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), {
      target: { value: 'gpu.lan' },
    });
    fireEvent.change(screen.getByPlaceholderText('root'), {
      target: { value: 'root' },
    });
    fireEvent.change(screen.getByPlaceholderText('22'), {
      target: { value: '2222' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(bridge.save).toHaveBeenCalledTimes(1));
    const payload = bridge.save.mock.calls[0][0];
    expect(payload.config).toMatchObject({
      alias: 'gpu-box',
      host: 'gpu.lan',
      username: 'root',
      port: 2222,
      authType: 'password',
    });
    expect(payload.password).toBe('secret123');

    // 保存后:表单收起,列表(不重开弹层)直接反映新主机
    await waitFor(() => expect(screen.getByText('gpu-box')).toBeInTheDocument());
    expect(screen.queryByText('No remote hosts yet · Click below to add one')).toBeNull();
    expect(bridge.list).toHaveBeenCalledTimes(2); // 挂载一次 + save 后刷新一次
  });

  it('editing a host does not resend an unchanged placeholder password', async () => {
    const config = makeConfig({ id: 'cfg-1', alias: 'mini-pc', authType: 'password', hasPassword: true });
    const { bridge } = await renderPage([config]);

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(bridge.save).toHaveBeenCalledTimes(1));
    const payload = bridge.save.mock.calls[0][0];
    expect(payload.password).toBeUndefined();
  });
});

// --- T-015: 最近使用区紧凑单按钮一键连接(AC-7) ---
describe('test_AC7_recent_area_one_click_connect', () => {
  it('recent section shows only the primary action; clicking it issues connect', async () => {
    const recent = makeConfig({
      id: 'mini-pc',
      alias: 'mini-pc',
      lastUsed: Date.now() - 3_600_000,
    });
    const notRecent = makeConfig({ id: 'dev-server', alias: 'dev-server' });
    const { bridge, container } = await renderPage([recent, notRecent]);

    expect(screen.getByText('Recently used')).toBeInTheDocument();
    const sections = container.querySelectorAll('.remote-hosts__section');
    const recentSection = sections[0];
    const recentButtons = within(recentSection as HTMLElement).getAllByRole('button');
    // 紧凑模式:只保留主操作,无测试连接/编辑/删除
    expect(recentButtons).toHaveLength(1);
    expect(recentButtons[0]).toHaveTextContent('Connect');

    fireEvent.click(recentButtons[0]);
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'mini-pc' });
  });

  it('hosts without lastUsed are excluded from the recent section', async () => {
    const notRecent = makeConfig({ id: 'dev-server', alias: 'dev-server' });
    await renderPage([notRecent]);
    expect(screen.queryByText('Recently used')).toBeNull();
  });

  // --- Q3(code review medium):此前只测单按钮/一键连接/排除规则,未断言多条最近项的
  // 真实倒序渲染顺序。三个 lastUsed 各异的主机、故意乱序传给 list(),断言渲染顺序
  // 是组件内部 recentHosts useMemo 的 sort 结果,而非传入顺序的巧合。 ---
  it('renders recent hosts sorted by lastUsed descending, independent of list() order (Q3)', async () => {
    const now = Date.now();
    const a = makeConfig({ id: 'a', alias: 'a', lastUsed: now - 3 * 3_600_000 }); // 3h 前(最旧)
    const b = makeConfig({ id: 'b', alias: 'b', lastUsed: now - 1 * 3_600_000 }); // 1h 前(最新)
    const c = makeConfig({ id: 'c', alias: 'c', lastUsed: now - 2 * 3_600_000 }); // 2h 前(居中)
    // 刻意乱序传入(a, c, b),渲染顺序不应等于传入顺序
    const { container } = await renderPage([a, c, b]);

    const recentSection = container.querySelectorAll('.remote-hosts__section')[0] as HTMLElement;
    const renderedAliases = Array.from(
      recentSection.querySelectorAll('.remote-hosts__alias'),
    ).map((el) => el.textContent);

    expect(renderedAliases).toEqual(['b', 'c', 'a']);
  });
});

// --- 连接生命周期渲染随 onEvent 事件切换徽标/stepper(AC-4/AC-5) ---
describe('connection_lifecycle_renders_from_onEvent', () => {
  it('renders the three-stage deploy stepper with percent and detected arch', async () => {
    const config = makeConfig({ id: 'gpu-box', alias: 'gpu-box' });
    const { emit, container } = await renderPage([config]);

    emit({ configId: 'gpu-box', stage: 'deploying', percent: 25, arch: 'darwin-arm64' });

    await waitFor(() =>
      expect(screen.getByText('Detected remote arch · darwin-arm64')).toBeInTheDocument(),
    );
    expect(screen.getByText('Upload bundle')).toBeInTheDocument();
    const percentEl = container.querySelector('.remote-hosts__progress-percent');
    expect(percentEl?.textContent?.trim()).toBe('25%');
  });

  it('fastPath claiming/verifying shows a single-line claim message, not the stepper', async () => {
    const config = makeConfig({ id: 'dev-server', lastUsed: Date.now() - 1000 });
    await renderPage([config]);

    useRemoteHostRuntimeStore.getState().applyEvent({
      configId: 'dev-server',
      stage: 'claiming',
      fastPath: true,
    });

    await waitFor(() =>
      expect(screen.getByText('Found a running host process · Claiming…')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Upload bundle')).toBeNull();
  });

  it('drives verifying → ready through hostRegistry handshake (AC-6 · main 前移探测后的版本二次确认)', async () => {
    const config = makeConfig({ id: 'gpu-box', alias: 'gpu-box' });
    const { emit } = await renderPage([config]);

    const info: HostInfo = {
      hostId: 'local',
      protocolVersion: 1,
      minCompatible: 1,
      platform: 'linux',
      homedir: '/root',
      shell: '/bin/bash',
    };
    fakeRemoteClient.reconnect.mockResolvedValueOnce(info);
    fakeRemoteClient.rpc.mockResolvedValueOnce({ entries: [] });

    emit({
      configId: 'gpu-box',
      stage: 'verifying',
      tunnel: { localPort: 4321, token: 'tok-1' },
    });

    await waitFor(() =>
      expect(hostRegistryMock.getOrCreateRemote).toHaveBeenCalledWith(
        'gpu-box',
        'ws://127.0.0.1:4321?token=tok-1',
      ),
    );
    expect(fakeRemoteClient.reconnect).toHaveBeenCalledWith({
      wsUrl: 'ws://127.0.0.1:4321?token=tok-1',
    });
    await waitFor(() => expect(screen.getByText('✓ Connected')).toBeInTheDocument());
  });

  // --- A3(code review MAJOR):main 可能在同一同步栈背靠背 emit verifying 紧跟 ready
  // (例如认领快路径)。若握手触发靠一个"采样当前 runtimeMap"的被动 effect,React 会把
  // 两次 setState 批处理成一次渲染,effect 只看得到最终落地的 ready,永远观测不到中间的
  // verifying → connect({wsUrl})/冒烟从未发生。握手必须挂在 onEvent 回调本身、逐条事件
  // 同步判定,不依赖事后渲染采样。此用例复现该竞态:两条事件不 await、背靠背同步 emit。
  it('back-to-back verifying→ready in the same synchronous tick still triggers the handshake (A3)', async () => {
    const config = makeConfig({ id: 'gpu-box', alias: 'gpu-box' });
    const { emit } = await renderPage([config]);

    const info: HostInfo = {
      hostId: 'local',
      protocolVersion: 1,
      minCompatible: 1,
      platform: 'linux',
      homedir: '/root',
      shell: '/bin/bash',
    };
    fakeRemoteClient.reconnect.mockResolvedValueOnce(info);
    fakeRemoteClient.rpc.mockResolvedValueOnce({ entries: [] });

    // 不 await、不经额外 render:main 同步栈内背靠背两次 emit
    emit({
      configId: 'gpu-box',
      stage: 'verifying',
      tunnel: { localPort: 4321, token: 'tok-1' },
    });
    emit({ configId: 'gpu-box', stage: 'ready' });

    // 握手必须在 verifying 事件到达的那一刻同步发起 —— 不需要 waitFor/额外渲染才能观测到
    expect(hostRegistryMock.getOrCreateRemote).toHaveBeenCalledWith(
      'gpu-box',
      'ws://127.0.0.1:4321?token=tok-1',
    );
    expect(fakeRemoteClient.reconnect).toHaveBeenCalledWith({
      wsUrl: 'ws://127.0.0.1:4321?token=tok-1',
    });
  });

  it('handshake rejecting with ProtocolIncompatibleError renders failed · incompatible', async () => {
    const config = makeConfig({ id: 'gpu-box' });
    const { emit } = await renderPage([config]);
    fakeRemoteClient.reconnect.mockRejectedValueOnce(
      new ProtocolIncompatibleError(buildIncompatibleDetail(1, 1, 3, 2)),
    );

    emit({
      configId: 'gpu-box',
      stage: 'verifying',
      tunnel: { localPort: 1, token: 't' },
    });

    await waitFor(() => expect(screen.getByText('✗ Incompatible version')).toBeInTheDocument());
  });

  it('ready → disconnect returns to idle, notifies main, and drops the remote client', async () => {
    const config = makeConfig({ id: 'mini-pc' });
    const { bridge, emit } = await renderPage([config]);
    emit({ configId: 'mini-pc', stage: 'ready' });
    await waitFor(() => expect(screen.getByText('✓ Connected')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Disconnect'));

    expect(bridge.disconnect).toHaveBeenCalledWith({ id: 'mini-pc' });
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('mini-pc');
    // 用户意图 = 保持断开:在途重连编排(退避计时器/尝试)必须一并终止,否则会被重新拉起
    expect(reconnectControllerMock.cancel).toHaveBeenCalledWith('mini-pc');
    await waitFor(() => expect(screen.queryByText('✓ Connected')).toBeNull());
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  // --- E6(code review MINOR):disconnect 后,main 侧编排可能仍有残余事件在管道里排队
  // (例如断开前已入队的重连/重部署尾迹,或断开与新一轮 verifying 之间的时序竞态)——
  // 一旦照单全收,会把已清空的 runtime 瞬时"复活"到 ready(UI 抖动),且残余的 verifying
  // 事件还会对已 drop 的 client 重新触发握手。「断开」在当前 UI 只在 ready 态可点(忙碌态
  // 不渲染任何按钮 · UI.md),故用 ready→断开 作为可达触发点,验证断开之后抵达的残余
  // 事件(deploying/verifying/ready)被过滤:不 revive、不重新握手。 ---
  it('disconnect abandons the configId: later residual events are ignored, not revived, no re-handshake (E6)', async () => {
    const config = makeConfig({ id: 'gpu-box', alias: 'gpu-box' });
    const { emit } = await renderPage([config]);

    emit({ configId: 'gpu-box', stage: 'ready' });
    await waitFor(() => expect(screen.getByText('✓ Connected')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Disconnect'));
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('gpu-box');
    await waitFor(() => expect(screen.queryByText('✓ Connected')).toBeNull());
    expect(screen.getByText('Connect')).toBeInTheDocument();

    // 断开之后,残余的在途编排事件才抵达(排队延迟 / 时序竞态):deploying → verifying{tunnel} → ready
    vi.clearAllMocks();
    hostRegistryMock.getOrCreateRemote.mockReturnValue(fakeRemoteClient);
    emit({ configId: 'gpu-box', stage: 'deploying', percent: 80, arch: 'linux-x64' });
    emit({
      configId: 'gpu-box',
      stage: 'verifying',
      tunnel: { localPort: 9999, token: 'stale-tok' },
    });
    emit({ configId: 'gpu-box', stage: 'ready' });

    // 既不重新握手,也不把 UI 复活到 ready —— 行仍是 idle「连接」态
    expect(hostRegistryMock.getOrCreateRemote).not.toHaveBeenCalled();
    expect(fakeRemoteClient.reconnect).not.toHaveBeenCalled();
    expect(screen.queryByText('✓ Connected')).toBeNull();
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('reconnecting after a disconnect clears the abandoned mark (verifying handshakes again)', async () => {
    const config = makeConfig({ id: 'gpu-box', alias: 'gpu-box' });
    const { bridge, emit } = await renderPage([config]);

    emit({ configId: 'gpu-box', stage: 'ready' });
    await waitFor(() => expect(screen.getByText('✓ Connected')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Disconnect'));
    await waitFor(() => expect(screen.getByText('Connect')).toBeInTheDocument());

    // 用户重新点「连接」→ 应解除"已弃"标记,后续 verifying 恢复正常握手
    fireEvent.click(screen.getByText('Connect'));
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'gpu-box' });

    const info: HostInfo = {
      hostId: 'local',
      protocolVersion: 1,
      minCompatible: 1,
      platform: 'linux',
      homedir: '/root',
      shell: '/bin/bash',
    };
    fakeRemoteClient.reconnect.mockResolvedValueOnce(info);
    fakeRemoteClient.rpc.mockResolvedValueOnce({ entries: [] });

    emit({
      configId: 'gpu-box',
      stage: 'verifying',
      tunnel: { localPort: 4321, token: 'fresh-tok' },
    });

    expect(hostRegistryMock.getOrCreateRemote).toHaveBeenCalledWith(
      'gpu-box',
      'ws://127.0.0.1:4321?token=fresh-tok',
    );
    await waitFor(() => expect(screen.getByText('✓ Connected')).toBeInTheDocument());
  });
});

// --- 失败分类展示 + 重试/重连按钮(AC-2/AC-12,口径取自 shared/remoteHost.ts FAIL_REASON_COPY) ---
describe('failure_classification_and_retry', () => {
  it('failed·auth shows the classified badge + detail panel; retry re-issues connect', async () => {
    const config = makeConfig({ id: 'vps-hk', alias: 'vps-hk' });
    const { bridge, emit } = await renderPage([config]);

    emit({ configId: 'vps-hk', stage: 'failed', reason: 'auth' });

    await waitFor(() => expect(screen.getByText('✗ Authentication failed')).toBeInTheDocument());
    expect(screen.getByText(/Permission denied/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'vps-hk' });
  });

  it('disconnected (lost) shows the reconnect badge/button distinct from failed', async () => {
    const config = makeConfig({ id: 'mini-pc' });
    const { bridge, emit } = await renderPage([config]);

    emit({ configId: 'mini-pc', stage: 'disconnected' });

    await waitFor(() => expect(screen.getByText('⚠ Connection lost')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Reconnect'));
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'mini-pc' });
  });

  it('busy stages render no action buttons (no edit/delete/retry mid-orchestration)', async () => {
    const config = makeConfig({ id: 'gpu-box' });
    const { emit, container } = await renderPage([config]);
    emit({ configId: 'gpu-box', stage: 'connecting' });
    await waitFor(() => expect(screen.getByText('Connecting…')).toBeInTheDocument());
    const row = container.querySelector('.remote-hosts__row') as HTMLElement;
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });
});

// --- 测试连接三态(AC-2,与"连接"共用同一 FAIL_REASONS 口径) ---
describe('test_connection_badge_states', () => {
  it('idle test button shows pending → ok', async () => {
    const config = makeConfig({ id: 'vps-hk' });
    let resolveTest: (r: TestResult) => void = () => {};
    const { bridge } = await renderPage([config]);
    bridge.test.mockImplementationOnce(
      () => new Promise<TestResult>((resolve) => (resolveTest = resolve)),
    );

    fireEvent.click(screen.getByText('Test connection'));
    expect(screen.getByText('Testing connection…')).toBeInTheDocument();

    resolveTest({ ok: true });
    await waitFor(() => expect(screen.getByText('✓ Reachable')).toBeInTheDocument());
  });

  it('idle test button shows pending → fail with classified reason', async () => {
    const config = makeConfig({ id: 'vps-hk' });
    const { bridge } = await renderPage([config]);
    bridge.test.mockResolvedValueOnce({ ok: false, reason: 'timeout' });

    fireEvent.click(screen.getByText('Test connection'));
    await waitFor(() => expect(screen.getByText(/✗ Timed out/)).toBeInTheDocument());
  });
});

// --- 删除确认(AC-14):凭据清除文案 + 活跃连接提示 ---
describe('delete_confirmation_credential_and_active_connection_copy', () => {
  it('idle delete shows credential-clear copy without the active-connection suffix', async () => {
    const config = makeConfig({ id: 'mini-pc', alias: 'mini-pc' });
    await renderPage([config]);

    fireEvent.click(screen.getByText('Delete'));
    expect(
      screen.getByText('Delete mini-pc? Stored credentials will also be removed'),
    ).toBeInTheDocument();
  });

  it('busy/ready delete appends the "will disconnect first" suffix, and confirming deletes + drops the client', async () => {
    const config = makeConfig({ id: 'mini-pc', alias: 'mini-pc' });
    const { bridge, emit } = await renderPage([config]);
    emit({ configId: 'mini-pc', stage: 'ready' });
    await waitFor(() => expect(screen.getByText('✓ Connected')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Delete'));
    expect(
      screen.getByText('Delete mini-pc? Stored credentials will also be removed · Current connection will be disconnected first'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Yes'));
    await waitFor(() => expect(bridge.delete).toHaveBeenCalledWith({ id: 'mini-pc' }));
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('mini-pc');
    await waitFor(() => expect(screen.queryByText('mini-pc')).toBeNull());
  });

  it('cancelling delete ("否") leaves the host in place and calls neither delete nor drop', async () => {
    const config = makeConfig({ id: 'mini-pc', alias: 'mini-pc' });
    const { bridge } = await renderPage([config]);

    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('No'));

    expect(screen.getByText('mini-pc')).toBeInTheDocument();
    expect(bridge.delete).not.toHaveBeenCalled();
    expect(hostRegistryMock.drop).not.toHaveBeenCalled();
  });
});
