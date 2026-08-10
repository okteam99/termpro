// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// 工作区编辑弹层:改名 + 浏览器 profile 选择。store 用 useAppStore.setState 播种,
// renameWorkspace/setWorkspaceBrowserProfile 用注入的 vi.fn() 或真实 store 实现按需验证。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// store.ts → terminalRegistry.ts 会拉入 @xterm/* 浏览器模块,本测试与终端无关,
// mock 掉断开该链(复刻 BrowserProfilesSection.test.tsx 的惯例)。
vi.mock('../../terminal/terminalRegistry', () => ({
  disposeTerminal: vi.fn(),
  getSessionId: vi.fn(),
}));

import { WorkspaceEditModal } from '../WorkspaceEditModal';
import { useAppStore } from '../../state/store';
import type { BrowserProfile } from '../../../shared/browserProfile';

function profile(overrides: Partial<BrowserProfile> = {}): BrowserProfile {
  return { id: 'p1', name: 'Work', createdAt: 1, ...overrides };
}

// store 是模块级单例,某个用例注入的 vi.fn() 会残留污染后续用例——每个用例前把
// renameWorkspace/setWorkspaceBrowserProfile 复位到真实实现(捕获于首次 getState())。
const realRenameWorkspace = useAppStore.getState().renameWorkspace;
const realSetWorkspaceBrowserProfile = useAppStore.getState().setWorkspaceBrowserProfile;

beforeEach(() => {
  useAppStore.setState({
    browserProfiles: [],
    workspaces: [],
    renameWorkspace: realRenameWorkspace,
    setWorkspaceBrowserProfile: realSetWorkspaceBrowserProfile,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WorkspaceEditModal', () => {
  it('渲染:名称预填;select 含内置项 + 自定义 profiles;当前绑定被选中', () => {
    useAppStore.setState({
      browserProfiles: [
        profile({ id: 'p1', name: 'Work' }),
        profile({ id: 'p2', name: 'Personal' }),
        profile({ id: 'p3', name: 'Deleting', deletionState: 'deleting' }),
      ],
    });
    render(
      <WorkspaceEditModal
        workspace={{ id: 'w1', name: 'my-project', browserProfileId: 'p2' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('my-project')).toBeInTheDocument();
    expect(screen.getByText('OkWork (built-in)')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.queryByText('Deleting')).toBeNull();

    const select = screen.getByLabelText('Browser profile') as HTMLSelectElement;
    expect(select.value).toBe('p2');
  });

  it('未绑定 profile 时(缺省)select 落在内置项', () => {
    useAppStore.setState({ browserProfiles: [profile({ id: 'p1', name: 'Work' })] });
    render(
      <WorkspaceEditModal workspace={{ id: 'w1', name: 'my-project' }} onClose={vi.fn()} />,
    );
    const select = screen.getByLabelText('Browser profile') as HTMLSelectElement;
    expect(select.value).toBe('default');
  });

  it('只改名保存 → renameWorkspace 被调、setWorkspaceBrowserProfile 效果不变(绑定原样)', () => {
    const renameWorkspace = vi.fn();
    const setWorkspaceBrowserProfile = vi.fn();
    useAppStore.setState({
      browserProfiles: [profile({ id: 'p1', name: 'Work' })],
      renameWorkspace: renameWorkspace as any,
      setWorkspaceBrowserProfile,
    });
    render(
      <WorkspaceEditModal
        workspace={{ id: 'w1', name: 'my-project', browserProfileId: 'p1' }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('my-project'), {
      target: { value: 'renamed-project' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(renameWorkspace).toHaveBeenCalledWith('w1', 'renamed-project');
    expect(setWorkspaceBrowserProfile).not.toHaveBeenCalled();
  });

  it('只换 profile 保存 → 绑定更新、renameWorkspace 不被调', () => {
    const renameWorkspace = vi.fn();
    const setWorkspaceBrowserProfile = vi.fn();
    useAppStore.setState({
      browserProfiles: [profile({ id: 'p1', name: 'Work' }), profile({ id: 'p2', name: 'Personal' })],
      renameWorkspace: renameWorkspace as any,
      setWorkspaceBrowserProfile,
    });
    render(
      <WorkspaceEditModal
        workspace={{ id: 'w1', name: 'my-project', browserProfileId: 'p1' }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Browser profile'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByText('Save'));

    expect(setWorkspaceBrowserProfile).toHaveBeenCalledWith('w1', 'p2');
    expect(renameWorkspace).not.toHaveBeenCalled();
  });

  it('选回内置(default)→ 绑定清除(browserProfileId undefined)', () => {
    // 用真实 store 实现,验证端到端效果(store 自身已覆盖 default 清绑定逻辑)
    useAppStore.setState({
      browserProfiles: [profile({ id: 'p1', name: 'Work' })],
      workspaces: [
        {
          id: 'w1',
          name: 'my-project',
          root: '/tmp/my-project',
          hostId: 'local',
          browserProfileId: 'p1',
          tabs: [],
          activeTabId: null,
        },
      ],
    });
    render(
      <WorkspaceEditModal
        workspace={{ id: 'w1', name: 'my-project', browserProfileId: 'p1' }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Browser profile'), { target: { value: 'default' } });
    fireEvent.click(screen.getByText('Save'));

    const ws = useAppStore.getState().workspaces.find((w) => w.id === 'w1');
    expect(ws?.browserProfileId).toBeUndefined();
  });

  it('onSave 覆盖(壳窗模式):保存只回调不碰本窗 store,随后 onClose', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const renameWorkspace = vi.fn();
    const setWorkspaceBrowserProfile = vi.fn();
    useAppStore.setState({
      browserProfiles: [profile({ id: 'p1', name: 'Work' }), profile({ id: 'p2', name: 'Personal' })],
      renameWorkspace: renameWorkspace as any,
      setWorkspaceBrowserProfile,
    });
    render(
      <WorkspaceEditModal
        workspace={{ id: 'shell-ws', name: 'my-project', browserProfileId: 'p1' }}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('my-project'), {
      target: { value: '  renamed  ' },
    });
    fireEvent.change(screen.getByLabelText('Browser profile'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith({ name: 'renamed', profileId: 'p2' });
    expect(onClose).toHaveBeenCalled();
    expect(renameWorkspace).not.toHaveBeenCalled();
    expect(setWorkspaceBrowserProfile).not.toHaveBeenCalled();
  });

  it('默认路径换 profile:该 ws 已弹出壳窗被推送 setProfile,未弹出 tab 不推', () => {
    const setProfile = vi.fn();
    (window as unknown as { okwork: unknown }).okwork = {
      browserPane: { setProfile },
    };
    useAppStore.setState({
      browserProfiles: [profile({ id: 'p1', name: 'Work' }), profile({ id: 'p2', name: 'Personal' })],
      workspaces: [
        {
          id: 'w1',
          name: 'my-project',
          root: '/w',
          hostId: 'local',
          browserProfileId: 'p1',
          tabs: [
            {
              id: 't-pop',
              title: 't',
              cwd: '/w',
              browser: { tabs: [], activeTabId: null, poppedOut: true },
            },
            {
              id: 't-dock',
              title: 't2',
              cwd: '/w',
              browser: { tabs: [], activeTabId: null },
            },
          ],
          activeTabId: 't-pop',
        },
      ],
    });
    render(
      <WorkspaceEditModal
        workspace={{ id: 'w1', name: 'my-project', browserProfileId: 'p1' }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Browser profile'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByText('Save'));

    expect(setProfile).toHaveBeenCalledTimes(1);
    expect(setProfile).toHaveBeenCalledWith('t-pop', 'p2');
    delete (window as unknown as Record<string, unknown>).okwork;
  });

  it('名称空白 → 保存按钮 disabled', () => {
    useAppStore.setState({ browserProfiles: [] });
    render(
      <WorkspaceEditModal workspace={{ id: 'w1', name: 'my-project' }} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByDisplayValue('my-project'), { target: { value: '   ' } });
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('Esc → onClose 且无副作用', () => {
    const onClose = vi.fn();
    const renameWorkspace = vi.fn();
    const setWorkspaceBrowserProfile = vi.fn();
    useAppStore.setState({
      browserProfiles: [],
      renameWorkspace: renameWorkspace as any,
      setWorkspaceBrowserProfile,
    });
    render(
      <WorkspaceEditModal workspace={{ id: 'w1', name: 'my-project' }} onClose={onClose} />,
    );

    fireEvent.change(screen.getByDisplayValue('my-project'), { target: { value: 'changed' } });
    fireEvent.keyDown(screen.getByDisplayValue('changed'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
    expect(renameWorkspace).not.toHaveBeenCalled();
    expect(setWorkspaceBrowserProfile).not.toHaveBeenCalled();
  });

  it('取消 → onClose 且无副作用', () => {
    const onClose = vi.fn();
    const renameWorkspace = vi.fn();
    const setWorkspaceBrowserProfile = vi.fn();
    useAppStore.setState({
      browserProfiles: [],
      renameWorkspace: renameWorkspace as any,
      setWorkspaceBrowserProfile,
    });
    render(
      <WorkspaceEditModal workspace={{ id: 'w1', name: 'my-project' }} onClose={onClose} />,
    );

    fireEvent.change(screen.getByDisplayValue('my-project'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalled();
    expect(renameWorkspace).not.toHaveBeenCalled();
    expect(setWorkspaceBrowserProfile).not.toHaveBeenCalled();
  });
});
