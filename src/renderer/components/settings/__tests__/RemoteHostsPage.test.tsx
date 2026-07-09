// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-003 RemoteHostsPage(移植自 docs/design/preview-project · ARCH-B6)。
// hostRegistry 全 mock(避免真实 WebSocket/PTY 依赖),window.termpro.remoteHost 用内存态假桥。
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
  Object.defineProperty(window, 'termpro', {
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
  delete (window as unknown as { termpro?: unknown }).termpro;
});

// --- T-003: settings 列表随 save 实时更新,无需重开弹层(AC-1) ---
describe('test_AC1_settings_list_live_update', () => {
  it('adding a host via the form updates the manual list in place', async () => {
    const { bridge } = await renderPage([]);

    expect(screen.getByText('还没有远程机 · 点击下方添加')).toBeInTheDocument();
    fireEvent.click(screen.getByText('添加远程机'));

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
    fireEvent.click(screen.getByRole('button', { name: '密码' }));
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });

    fireEvent.click(screen.getByText('保存'));

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
    expect(screen.queryByText('还没有远程机 · 点击下方添加')).toBeNull();
    expect(bridge.list).toHaveBeenCalledTimes(2); // 挂载一次 + save 后刷新一次
  });

  it('editing a host does not resend an unchanged placeholder password', async () => {
    const config = makeConfig({ id: 'cfg-1', alias: 'mini-pc', authType: 'password', hasPassword: true });
    const { bridge } = await renderPage([config]);

    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByText('保存'));

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

    expect(screen.getByText('最近使用')).toBeInTheDocument();
    const sections = container.querySelectorAll('.remote-hosts__section');
    const recentSection = sections[0];
    const recentButtons = within(recentSection as HTMLElement).getAllByRole('button');
    // 紧凑模式:只保留主操作,无测试连接/编辑/删除
    expect(recentButtons).toHaveLength(1);
    expect(recentButtons[0]).toHaveTextContent('连接');

    fireEvent.click(recentButtons[0]);
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'mini-pc' });
  });

  it('hosts without lastUsed are excluded from the recent section', async () => {
    const notRecent = makeConfig({ id: 'dev-server', alias: 'dev-server' });
    await renderPage([notRecent]);
    expect(screen.queryByText('最近使用')).toBeNull();
  });
});

// --- 连接生命周期渲染随 onEvent 事件切换徽标/stepper(AC-4/AC-5) ---
describe('connection_lifecycle_renders_from_onEvent', () => {
  it('renders the three-stage deploy stepper with percent and detected arch', async () => {
    const config = makeConfig({ id: 'gpu-box', alias: 'gpu-box' });
    const { emit, container } = await renderPage([config]);

    emit({ configId: 'gpu-box', stage: 'deploying', percent: 25, arch: 'darwin-arm64' });

    await waitFor(() =>
      expect(screen.getByText('已探测远端架构 · darwin-arm64')).toBeInTheDocument(),
    );
    expect(screen.getByText('上传 bundle')).toBeInTheDocument();
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
      expect(screen.getByText('发现已运行的 host 进程 · 认领中…')).toBeInTheDocument(),
    );
    expect(screen.queryByText('上传 bundle')).toBeNull();
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
    fakeRemoteClient.connect.mockResolvedValueOnce(info);
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
    expect(fakeRemoteClient.connect).toHaveBeenCalledWith({
      wsUrl: 'ws://127.0.0.1:4321?token=tok-1',
    });
    await waitFor(() => expect(screen.getByText('✓ 已连接')).toBeInTheDocument());
  });

  it('handshake rejecting with ProtocolIncompatibleError renders failed · incompatible', async () => {
    const config = makeConfig({ id: 'gpu-box' });
    const { emit } = await renderPage([config]);
    fakeRemoteClient.connect.mockRejectedValueOnce(
      new ProtocolIncompatibleError(buildIncompatibleDetail(1, 1, 3, 2)),
    );

    emit({
      configId: 'gpu-box',
      stage: 'verifying',
      tunnel: { localPort: 1, token: 't' },
    });

    await waitFor(() => expect(screen.getByText('✗ 版本不兼容')).toBeInTheDocument());
  });

  it('ready → disconnect returns to idle, notifies main, and drops the remote client', async () => {
    const config = makeConfig({ id: 'mini-pc' });
    const { bridge, emit } = await renderPage([config]);
    emit({ configId: 'mini-pc', stage: 'ready' });
    await waitFor(() => expect(screen.getByText('✓ 已连接')).toBeInTheDocument());

    fireEvent.click(screen.getByText('断开'));

    expect(bridge.disconnect).toHaveBeenCalledWith({ id: 'mini-pc' });
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('mini-pc');
    await waitFor(() => expect(screen.queryByText('✓ 已连接')).toBeNull());
    expect(screen.getByText('连接')).toBeInTheDocument();
  });
});

// --- 失败分类展示 + 重试/重连按钮(AC-2/AC-12,口径取自 shared/remoteHost.ts FAIL_REASON_COPY) ---
describe('failure_classification_and_retry', () => {
  it('failed·auth shows the classified badge + detail panel; retry re-issues connect', async () => {
    const config = makeConfig({ id: 'vps-hk', alias: 'vps-hk' });
    const { bridge, emit } = await renderPage([config]);

    emit({ configId: 'vps-hk', stage: 'failed', reason: 'auth' });

    await waitFor(() => expect(screen.getByText('✗ 认证失败')).toBeInTheDocument());
    expect(screen.getByText(/Permission denied/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('重试'));
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'vps-hk' });
  });

  it('disconnected (lost) shows the reconnect badge/button distinct from failed', async () => {
    const config = makeConfig({ id: 'mini-pc' });
    const { bridge, emit } = await renderPage([config]);

    emit({ configId: 'mini-pc', stage: 'disconnected' });

    await waitFor(() => expect(screen.getByText('⚠ 连接已断开')).toBeInTheDocument());
    fireEvent.click(screen.getByText('重连'));
    expect(bridge.connect).toHaveBeenCalledWith({ id: 'mini-pc' });
  });

  it('busy stages render no action buttons (no edit/delete/retry mid-orchestration)', async () => {
    const config = makeConfig({ id: 'gpu-box' });
    const { emit, container } = await renderPage([config]);
    emit({ configId: 'gpu-box', stage: 'connecting' });
    await waitFor(() => expect(screen.getByText('连接中…')).toBeInTheDocument());
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

    fireEvent.click(screen.getByText('测试连接'));
    expect(screen.getByText('测试连接中…')).toBeInTheDocument();

    resolveTest({ ok: true });
    await waitFor(() => expect(screen.getByText('✓ 已连通')).toBeInTheDocument());
  });

  it('idle test button shows pending → fail with classified reason', async () => {
    const config = makeConfig({ id: 'vps-hk' });
    const { bridge } = await renderPage([config]);
    bridge.test.mockResolvedValueOnce({ ok: false, reason: 'timeout' });

    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => expect(screen.getByText(/✗ 超时/)).toBeInTheDocument());
  });
});

// --- 删除确认(AC-14):凭据清除文案 + 活跃连接提示 ---
describe('delete_confirmation_credential_and_active_connection_copy', () => {
  it('idle delete shows credential-clear copy without the active-connection suffix', async () => {
    const config = makeConfig({ id: 'mini-pc', alias: 'mini-pc' });
    await renderPage([config]);

    fireEvent.click(screen.getByText('删除'));
    expect(
      screen.getByText('确认删除 mini-pc?将同时清除已存凭据'),
    ).toBeInTheDocument();
  });

  it('busy/ready delete appends the "will disconnect first" suffix, and confirming deletes + drops the client', async () => {
    const config = makeConfig({ id: 'mini-pc', alias: 'mini-pc' });
    const { bridge, emit } = await renderPage([config]);
    emit({ configId: 'mini-pc', stage: 'ready' });
    await waitFor(() => expect(screen.getByText('✓ 已连接')).toBeInTheDocument());

    fireEvent.click(screen.getByText('删除'));
    expect(
      screen.getByText('确认删除 mini-pc?将同时清除已存凭据 · 将先断开当前连接'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('是'));
    await waitFor(() => expect(bridge.delete).toHaveBeenCalledWith({ id: 'mini-pc' }));
    expect(hostRegistryMock.drop).toHaveBeenCalledWith('mini-pc');
    await waitFor(() => expect(screen.queryByText('mini-pc')).toBeNull());
  });

  it('cancelling delete ("否") leaves the host in place and calls neither delete nor drop', async () => {
    const config = makeConfig({ id: 'mini-pc', alias: 'mini-pc' });
    const { bridge } = await renderPage([config]);

    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('否'));

    expect(screen.getByText('mini-pc')).toBeInTheDocument();
    expect(bridge.delete).not.toHaveBeenCalled();
    expect(hostRegistryMock.drop).not.toHaveBeenCalled();
  });
});
