// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004 · AC-2/D-9:会话徽标 = 本客户端在该 workspace 的活跃 tab 数,0 必须显式可见(不被 falsy 吞)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

import {
  formatTabBadge,
  MachineWorkspaceRow,
  type MachineWorkspaceRowData,
} from '../MachineWorkspaceRow';

afterEach(cleanup);

function row(overrides: Partial<MachineWorkspaceRowData> = {}): MachineWorkspaceRowData {
  return {
    id: 'w1',
    name: 'aon-edge',
    meta: 'main · ~/apps/aon-edge',
    active: false,
    tabCount: 0,
    ...overrides,
  };
}

describe('formatTabBadge(BL004-U-badge-zero / BL004-U-badge-semantic)', () => {
  it('tabCount=0 → 显式渲染"0 个标签" · zero=true(不被 `{n && ...}` 吞掉)', () => {
    const badge = formatTabBadge({ tabCount: 0 });
    expect(badge.text).toBe('0 个标签');
    expect(badge.zero).toBe(true);
  });

  it('tabCount>0 且无 running → 只显总数', () => {
    const badge = formatTabBadge({ tabCount: 2 });
    expect(badge.text).toBe('2 个标签');
    expect(badge.zero).toBe(false);
  });

  it('tabCount>0 含 running → 附带 running 计数', () => {
    const badge = formatTabBadge({ tabCount: 3, tabRunning: 1 });
    expect(badge.text).toBe('3 个标签 · 1 running');
    expect(badge.zero).toBe(false);
  });

  it('语义 = 本客户端 tab 数,非主机侧会话数:首连远程机 0 tab 时恒显 0,不受"主机侧其实有会话"影响', () => {
    // 徽标输入只接受 tabCount/tabRunning(本客户端 store 派生),没有"主机侧会话数"入参可接——
    // 这本身就是对该语义的结构性保证:无论主机侧状态如何,调用方只能传本客户端 tab 数。
    const badge = formatTabBadge({ tabCount: 0, tabRunning: 0 });
    expect(badge.zero).toBe(true);
    expect(badge.text).toBe('0 个标签');
  });
});

describe('<MachineWorkspaceRow>', () => {
  it('tabCount=0 渲染 .sidebar-machine-sessions--zero 修饰符(灰态非隐藏)', () => {
    render(<MachineWorkspaceRow ws={row({ tabCount: 0 })} />);
    const badge = screen.getByText('0 个标签');
    expect(badge).toHaveClass('sidebar-machine-sessions--zero');
  });

  it('tabCount>0 不带 zero 修饰符', () => {
    render(<MachineWorkspaceRow ws={row({ tabCount: 2, tabRunning: 1 })} />);
    const badge = screen.getByText('2 个标签 · 1 running');
    expect(badge).not.toHaveClass('sidebar-machine-sessions--zero');
  });

  it('active=true → sidebar-item--active', () => {
    const { container } = render(<MachineWorkspaceRow ws={row({ active: true })} />);
    expect(container.querySelector('.sidebar-item--active')).toBeInTheDocument();
  });

  it('disconnectedPanel=true(D-8 panel 阶段)→ 渲染"已断开"标签 + sidebar-item--disconnected', () => {
    const { container } = render(
      <MachineWorkspaceRow ws={row({ active: true, disconnectedPanel: true })} />,
    );
    expect(screen.getByText('已断开')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-item--disconnected')).toBeInTheDocument();
  });

  it('onClick 触发 + role=button;不传 onClick 时无 role', () => {
    const onClick = vi.fn();
    const { rerender } = render(<MachineWorkspaceRow ws={row()} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<MachineWorkspaceRow ws={row()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
