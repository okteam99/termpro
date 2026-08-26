// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// 浏览器 Profile 管理区块(BrowserSettingsPage 追加区块):内置行恒在展示 + 自定义
// profile 的增/改/删。store 镜像用 useAppStore.setState 播种(profilesSync 服务本身
// 不在本测试范围内);window.okwork.browserProfile 用内存态假桥挂桩。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// store.ts → terminalRegistry.ts 会拉入 @xterm/* 浏览器模块,本测试与终端无关,
// mock 掉断开该链(复刻 BrowserPanel.test.tsx 的惯例)。
vi.mock('../../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(),
}));

import { BrowserProfilesSection } from '../BrowserProfilesSection';
import { useAppStore } from '../../../state/store';
import type {
  BrowserProfile,
  BrowserProfileInput,
  BrowserProfileSummary,
  ProfileStorageTargetStatus,
} from '../../../../shared/browserProfile';

function profile(
  overrides: Partial<BrowserProfileSummary> = {},
): BrowserProfileSummary {
  return {
    id: 'p1',
    name: 'Work',
    createdAt: 1,
    storage: { kind: 'local' },
    storageLabel: 'This device',
    availability: 'ready',
    ...overrides,
  };
}

/** 挂桩 window.okwork.browserProfile:save/delete 默认成功,可传 override 令其 reject。 */
function mockBridge(
  overrides: {
    save?: (input: BrowserProfileInput) => Promise<BrowserProfile>;
    delete?: (payload: { id: string }) => Promise<void>;
    storageTargets?: () => Promise<ProfileStorageTargetStatus[]>;
    remoteAvailable?: () => Promise<
      Array<{
        hostId: string;
        profileId: string;
        name: string;
        createdAt: number;
        epoch: number;
      }>
    >;
  } = {},
) {
  let remoteEventListener: (() => void) | null = null;
  const bridge = {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn(
      overrides.save ??
        (async (input: BrowserProfileInput) => ({
          id: input.id ?? 'new-id',
          name: input.name,
          userAgent: input.userAgent,
          createdAt: Date.now(),
        })),
    ),
    delete: vi.fn(overrides.delete ?? (async () => undefined)),
    retryDelete: vi.fn(async () => ({ status: 'deleted' as const })),
    listStorageTargets: vi.fn(
      overrides.storageTargets ??
        (async () => [
          { hostId: 'host-1', compatibility: 'compatible' as const },
        ]),
    ),
    planStorageChange: vi.fn(
      async (input: { profileId: string; target: unknown }) => ({
        planId: 'plan-1',
        profileId: input.profileId,
        target: input.target,
        targetLabel: 'build-box',
        canDecryptDisclosure: true,
        steps: ['copying', 'verifying', 'switching'] as const,
      }),
    ),
    confirmStorageChange: vi.fn(async () => ({
      accepted: true as const,
      operationId: 'operation-1',
    })),
    retryStorageChange: vi.fn(async () => ({
      accepted: true as const,
      operationId: 'operation-1',
    })),
    listRemoteAvailable: vi.fn(overrides.remoteAvailable ?? (async () => [])),
    joinRemote: vi.fn(async () => profile()),
    retryContinuity: vi.fn(async () => undefined),
    prepareContinuity: vi.fn(async () => ({
      ready: true as const,
      syncedCount: 0,
      skippedCount: 0,
    })),
    onChanged: vi.fn(() => () => undefined),
  };
  (window as unknown as { okwork: unknown }).okwork = {
    browserProfile: bridge,
    remoteHost: {
      list: vi.fn(async () => [
        {
          id: 'host-1',
          alias: 'build-box',
          host: '10.0.0.8',
          port: 22,
          username: 'liam',
          authType: 'key',
          hasPassword: false,
          hasPassphrase: false,
          createdAt: 1,
        },
      ]),
      stages: vi.fn(async () => ({ 'host-1': 'ready' })),
      onEvent: vi.fn((callback: () => void) => {
        remoteEventListener = callback;
        return () => {
          remoteEventListener = null;
        };
      }),
    },
  };
  return Object.assign(bridge, {
    emitRemoteEvent: () => remoteEventListener?.(),
  });
}

beforeEach(() => {
  useAppStore.setState({ browserProfiles: [] });
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { okwork?: unknown }).okwork;
  vi.restoreAllMocks();
});

describe('BrowserProfilesSection', () => {
  it('内置行恒在且无编辑/删除按钮;自定义 profile 逐行展示 UA 摘要', () => {
    mockBridge();
    useAppStore.setState({
      browserProfiles: [
        profile({ id: 'p1', name: 'Work', userAgent: 'CustomUA/1.0' }),
        profile({ id: 'p2', name: 'Personal' }),
      ],
    });
    render(<BrowserProfilesSection />);

    expect(screen.getByText('OkWork (built-in)')).toBeInTheDocument();
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.getAllByText('Storage location: This device')).toHaveLength(
      3,
    );

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('CustomUA/1.0')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getAllByText('System default User-Agent')).toHaveLength(2);
    expect(screen.queryByText(/AUTHORITY/)).toBeNull();

    // 只有两个自定义 profile 各一对编辑/删除;内置行不贡献按钮
    expect(screen.getAllByText('Edit')).toHaveLength(2);
    expect(screen.getAllByText('Delete')).toHaveLength(2);
  });

  it('新增:点新建 → 填名 → 保存以 {name, userAgent} 调用 save;名称空白时保存禁用', async () => {
    const bridge = mockBridge();
    render(<BrowserProfilesSection />);

    fireEvent.click(screen.getByText('+ New profile'));
    const saveBtn = screen.getByText('Save');
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Profile name'), {
      target: { value: 'Shopping' },
    });
    fireEvent.change(screen.getByPlaceholderText('System default User-Agent'), {
      target: { value: 'UA-X' },
    });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(bridge.save).toHaveBeenCalledWith({
        id: undefined,
        name: 'Shopping',
        userAgent: 'UA-X',
      });
    });
    // 保存成功后表单关闭
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText('Profile name'),
      ).not.toBeInTheDocument();
    });
  });

  it('编辑:点某行编辑 → 表单预填 → 保存带 id', async () => {
    const bridge = mockBridge();
    useAppStore.setState({
      browserProfiles: [
        profile({ id: 'p1', name: 'Work', userAgent: 'CustomUA/1.0' }),
      ],
    });
    render(<BrowserProfilesSection />);

    fireEvent.click(screen.getByText('Edit'));
    const nameInput = screen.getByPlaceholderText(
      'Profile name',
    ) as HTMLInputElement;
    const uaInput = screen.getByPlaceholderText(
      'System default User-Agent',
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('Work');
    expect(uaInput.value).toBe('CustomUA/1.0');

    fireEvent.change(nameInput, { target: { value: 'Work (renamed)' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(bridge.save).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Work (renamed)',
        userAgent: 'CustomUA/1.0',
      });
    });
  });

  it('删除:confirm 确认后调用 delete;取消则不调用', async () => {
    const bridge = mockBridge();
    useAppStore.setState({
      browserProfiles: [profile({ id: 'p1', name: 'Work' })],
    });
    render(<BrowserProfilesSection />);

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByText('Delete'));
    expect(bridge.delete).not.toHaveBeenCalled();

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(bridge.delete).toHaveBeenCalledWith({ id: 'p1' });
    });
  });

  it('save reject → 表单内展示错误行,表单不关闭', async () => {
    const bridge = mockBridge({
      save: async () => {
        throw new Error('Profile name is required');
      },
    });
    render(<BrowserProfilesSection />);

    fireEvent.click(screen.getByText('+ New profile'));
    fireEvent.change(screen.getByPlaceholderText('Profile name'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText(/Profile name is required/)).toBeInTheDocument();
    });
    expect(bridge.save).toHaveBeenCalled();
    // 表单仍开着
    expect(screen.getByPlaceholderText('Profile name')).toBeInTheDocument();
  });

  it('test_AC1_AC2_shows_storage_location_and_requires_eligible_target_confirmation', async () => {
    const bridge = mockBridge();
    useAppStore.setState({ browserProfiles: [profile()] });
    render(<BrowserProfilesSection />);

    fireEvent.click(screen.getAllByText('Change location')[1]);
    await screen.findByText('build-box');
    expect(bridge.listStorageTargets).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('build-box'));
    fireEvent.click(screen.getByText('Continue'));

    await waitFor(() =>
      expect(bridge.planStorageChange).toHaveBeenCalledWith({
        profileId: 'p1',
        target: { kind: 'remote', hostId: 'host-1' },
      }),
    );
    expect(screen.getByText('Move to build-box')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This Remote Host, its administrators, and processes running as the configured SSH user can decrypt the Profile data and saved passwords.',
      ),
    ).toBeInTheDocument();
    expect(bridge.confirmStorageChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Move Profile'));
    await waitFor(() =>
      expect(bridge.confirmStorageChange).toHaveBeenCalledWith({
        planId: 'plan-1',
      }),
    );
  });

  it('Escape closes the storage dialog and leaves the profiles section mounted', async () => {
    mockBridge();
    useAppStore.setState({ browserProfiles: [profile()] });
    render(<BrowserProfilesSection />);
    fireEvent.click(screen.getAllByText('Change location')[1]);
    await screen.findByRole('dialog', { name: /Change storage location/ });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Change storage location/ })).toBeNull();
    expect(screen.getByText('Browser profiles')).toBeInTheDocument();
  });

  it('test_AC2_disables_ready_but_incompatible_target_with_actionable_reason_before_submit', async () => {
    const bridge = mockBridge({
      storageTargets: async () => [
        {
          hostId: 'host-1',
          compatibility: 'incompatible',
          code: 'PROFILE_STORAGE_INCOMPATIBLE',
        },
      ],
    });
    useAppStore.setState({ browserProfiles: [profile()] });
    render(<BrowserProfilesSection />);

    fireEvent.click(screen.getAllByText('Change location')[1]);
    const host = await screen.findByText('build-box');
    const choice = host.closest('label');
    expect(choice).toHaveAttribute('aria-disabled', 'true');
    expect(choice?.querySelector('input')).toBeDisabled();
    expect(screen.getByText('Continue')).toBeDisabled();
    expect(
      screen.getByText('Update this Remote Host to use Profile storage'),
    ).toBeInTheDocument();
    expect(bridge.planStorageChange).not.toHaveBeenCalled();
  });

  it('test_AC2_clears_compatible_target_state_when_the_host_connection_generation_changes', async () => {
    let compatible = true;
    const bridge = mockBridge({
      storageTargets: async () =>
        compatible
          ? [{ hostId: 'host-1', compatibility: 'compatible' }]
          : [
              {
                hostId: 'host-1',
                compatibility: 'incompatible',
                code: 'PROFILE_STORAGE_INCOMPATIBLE',
              },
            ],
    });
    useAppStore.setState({ browserProfiles: [profile()] });
    render(<BrowserProfilesSection />);

    fireEvent.click(screen.getAllByText('Change location')[1]);
    const host = await screen.findByText('build-box');
    fireEvent.click(host);
    expect(screen.getByText('Continue')).not.toBeDisabled();

    compatible = false;
    bridge.emitRemoteEvent();

    await screen.findByText('Update this Remote Host to use Profile storage');
    expect(screen.getByText('Continue')).toBeDisabled();
  });

  it('远程存储离线时保留页面会话提示并禁用修改', () => {
    mockBridge();
    useAppStore.setState({
      browserProfiles: [
        profile({
          storage: { kind: 'remote', hostId: 'host-1' },
          storageLabel: 'build-box',
          availability: 'offline',
        }),
      ],
    });
    render(<BrowserProfilesSection />);

    expect(
      screen.getByText('Storage location: build-box · Offline'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The page session may continue with local cookies/),
    ).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeDisabled();
    expect(screen.getByText('Delete')).toBeDisabled();
    expect(screen.getAllByText('Change location')[1]).toBeDisabled();
  });

  it('迁移失败只允许重试，不开放新的迁移、编辑或删除', async () => {
    const bridge = mockBridge();
    useAppStore.setState({
      browserProfiles: [
        profile({
          migration: {
            operationId: 'operation-1',
            phase: 'failed',
            sourceLabel: 'This device',
            targetLabel: 'build-box',
            errorCode: 'PROFILE_STORAGE_TIMEOUT',
          },
        }),
      ],
    });
    render(<BrowserProfilesSection />);

    expect(screen.getAllByText('Change location')[1]).toBeDisabled();
    expect(screen.getByText('Edit')).toBeDisabled();
    expect(screen.getByText('Delete')).toBeDisabled();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() =>
      expect(bridge.retryStorageChange).toHaveBeenCalledWith({
        operationId: 'operation-1',
      }),
    );
  });

  it('test_AC9_renders_sanitized_login_continuity_summary_and_recovery_actions', async () => {
    const bridge = mockBridge({
      remoteAvailable: async () => [
        {
          hostId: 'host-1',
          profileId: 'b'.repeat(32),
          name: 'Shared browsing',
          createdAt: 2,
          epoch: 0,
        },
      ],
    });
    useAppStore.setState({
      browserProfiles: [
        profile({
          storage: { kind: 'remote', hostId: 'host-1' },
          storageLabel: 'build-box',
          loginContinuity: {
            state: 'attention',
            syncedCount: 12,
            pendingCount: 2,
            skippedCount: 3,
            conflictCount: 1,
            reasons: ['COOKIE_SESSION_POLICY'],
            canRetry: true,
          },
        }),
      ],
    });
    render(<BrowserProfilesSection />);

    expect(screen.getByText('Storage location: build-box')).toBeInTheDocument();
    expect(
      screen.getByText('Login continuity · Needs attention'),
    ).toBeInTheDocument();
    expect(screen.getByText(/12 synced · 2 pending · 3 skipped · 1 conflicts/)).toBeInTheDocument();
    expect(
      screen.getByText('Session-only cookie kept on this device'),
    ).toBeInTheDocument();

    const useButton = await screen.findByText('Use on this device');
    expect(screen.getByText('Shared browsing')).toBeInTheDocument();
    fireEvent.click(useButton);
    await waitFor(() =>
      expect(bridge.joinRemote).toHaveBeenCalledWith({
        hostId: 'host-1',
        profileId: 'b'.repeat(32),
      }),
    );

    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() =>
      expect(bridge.retryContinuity).toHaveBeenCalledWith({ profileId: 'p1' }),
    );
    expect(screen.queryByText(/AUTHORITY/i)).toBeNull();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(screen.queryByText(/example\.com|session-token|cookie-value/i)).toBeNull();
  });
});
