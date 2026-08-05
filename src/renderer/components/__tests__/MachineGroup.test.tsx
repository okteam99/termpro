// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// BL-004 · AC-1/AC-8/AC-10/AC-11:机器组头连接生命周期呈现 + 未连接/折叠态。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

import { MachineGroup, type MachineInfo } from '../MachineGroup';

afterEach(cleanup);

function remoteMachine(overrides: Partial<MachineInfo> = {}): MachineInfo {
  return {
    id: 'cfg-1',
    kind: 'remote',
    alias: 'mini-pc',
    addr: 'liam@192.168.1.40',
    status: 'disconnected',
    workspaces: null,
    ...overrides,
  };
}

describe('MachineGroup · 未连接(AC-1)', () => {
  it('显别名 + 连接入口按钮,不展开 workspace 行', () => {
    render(<MachineGroup machine={remoteMachine()} />);
    expect(screen.getByText('mini-pc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.queryByTestId('machine-workspace-row')).not.toBeInTheDocument();
  });

  it('点击「连接」→ onConnect(machineId)', () => {
    const onConnect = vi.fn();
    render(<MachineGroup machine={remoteMachine()} onConnect={onConnect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('cfg-1');
  });

  it('本机组(kind=local)无 dot、无连接入口,只显标签', () => {
    render(
      <MachineGroup
        machine={{ id: 'local', kind: 'local', label: 'Local', workspaces: [] }}
      />,
    );
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });
});

describe('MachineGroup · 已连接展开(AC-2)', () => {
  it('渲染 workspace 行(含 0 徽标)', () => {
    render(
      <MachineGroup
        machine={remoteMachine({
          status: 'connected',
          workspaces: [
            { id: 'w1', name: 'aon-edge', meta: 'main · ~/apps/aon-edge', active: false, tabCount: 0 },
            { id: 'w2', name: 'ml-lab', meta: 'main · ~/work/ml-lab', active: false, tabCount: 2, tabRunning: 1 },
          ],
        })}
      />,
    );
    expect(screen.getByText('aon-edge')).toBeInTheDocument();
    expect(screen.getByText('ml-lab')).toBeInTheDocument();
    // 图标形态徽标:语义文本在 aria-label/title 上
    expect(screen.getByLabelText('0 session')).toBeInTheDocument();
    expect(screen.getByLabelText('2 session · 1 running')).toBeInTheDocument();
  });

  it('点击 workspace 行 → onSelectWorkspace(machine, ws)', () => {
    const onSelectWorkspace = vi.fn();
    const machine = remoteMachine({
      status: 'connected',
      workspaces: [{ id: 'w1', name: 'aon-edge', meta: 'x', active: false, tabCount: 0 }],
    });
    render(<MachineGroup machine={machine} onSelectWorkspace={onSelectWorkspace} />);
    fireEvent.click(screen.getByText('aon-edge'));
    expect(onSelectWorkspace).toHaveBeenCalledWith(machine, machine.workspaces?.[0]);
  });

  it('行级铅笔/× → onRenameWorkspace/onRemoveWorkspace,且不触发行选中(stopPropagation)', () => {
    const onSelectWorkspace = vi.fn();
    const onRenameWorkspace = vi.fn();
    const onRemoveWorkspace = vi.fn();
    const machine = remoteMachine({
      status: 'connected',
      workspaces: [{ id: 'w1', name: 'aon-edge', meta: 'x', active: false, tabCount: 0 }],
    });
    render(
      <MachineGroup
        machine={machine}
        onSelectWorkspace={onSelectWorkspace}
        onRenameWorkspace={onRenameWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
      />,
    );
    fireEvent.click(screen.getByTitle('Edit project'));
    expect(onRenameWorkspace).toHaveBeenCalledWith(machine, machine.workspaces?.[0]);
    fireEvent.click(screen.getByTitle('Remove project'));
    expect(onRemoveWorkspace).toHaveBeenCalledWith(machine, machine.workspaces?.[0]);
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });
});

describe('MachineGroup · 组头连接延迟(心跳 RTT)', () => {
  it('connected + rttMs → 顺序:云图标 → 机器名 → 延迟单元(内含同色小圆点)', () => {
    const { container } = render(
      <MachineGroup machine={remoteMachine({ status: 'connected', rttMs: 12, workspaces: null })} />,
    );
    const rtt = screen.getByText('12ms');
    expect(rtt).toHaveClass('sidebar-machine-rtt');
    // 圆点并入延迟单元(同色 currentColor),不再渲染独立状态圆点
    expect(rtt.querySelector('.sidebar-machine-rtt-dot')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-machine-dot')).not.toBeInTheDocument();
    const header = container.querySelector('.sidebar-machine-header')!;
    const children = Array.from(header.children);
    const iconIdx = children.findIndex((el) => el.classList.contains('sidebar-machine-icon'));
    const labelIdx = children.findIndex((el) => el.classList.contains('sidebar-machine-label'));
    const rttIdx = children.findIndex((el) => el.classList.contains('sidebar-machine-rtt'));
    expect(iconIdx).toBeGreaterThanOrEqual(0);
    expect(labelIdx).toBe(iconIdx + 1);
    expect(rttIdx).toBe(labelIdx + 1);
  });

  it('延迟分级配色:<200 绿(good) · 200-499 琥珀(fair) · ≥500 红(poor)', () => {
    const { rerender } = render(
      <MachineGroup machine={remoteMachine({ status: 'connected', rttMs: 12, workspaces: null })} />,
    );
    expect(screen.getByText('12ms')).toHaveClass('sidebar-machine-rtt--good');
    rerender(
      <MachineGroup machine={remoteMachine({ status: 'connected', rttMs: 244, workspaces: null })} />,
    );
    expect(screen.getByText('244ms')).toHaveClass('sidebar-machine-rtt--fair');
    rerender(
      <MachineGroup machine={remoteMachine({ status: 'connected', rttMs: 500, workspaces: null })} />,
    );
    expect(screen.getByText('500ms')).toHaveClass('sidebar-machine-rtt--poor');
  });

  it('已连接 + 0 workspace → 渲染「添加项目」入口,点击回调 machineId', () => {
    const onAddWorkspace = vi.fn();
    render(
      <MachineGroup
        machine={remoteMachine({ status: 'connected', workspaces: [] })}
        onAddWorkspace={onAddWorkspace}
      />,
    );
    const entry = screen.getByRole('button', { name: /No projects on this machine yet/ });
    fireEvent.click(entry);
    expect(onAddWorkspace).toHaveBeenCalledWith('cfg-1');
  });

  it('已连接且有 workspace 行 → 不渲染「添加项目」空态入口', () => {
    render(
      <MachineGroup
        machine={remoteMachine({
          status: 'connected',
          workspaces: [{ id: 'w1', name: 'aon-edge', meta: 'x', active: false, tabCount: 0 }],
        })}
        onAddWorkspace={vi.fn()}
      />,
    );
    expect(screen.queryByText(/No projects on this machine yet/)).not.toBeInTheDocument();
  });

  it('机器名超过 10 字符 → 截断加省略号,全名保留在 title', () => {
    render(
      <MachineGroup
        machine={remoteMachine({ alias: 'production-eu-west-1', status: 'connected', workspaces: [] })}
      />,
    );
    expect(screen.getByText('production…')).toBeInTheDocument();
    expect(screen.getByText('production…')).toHaveAttribute('title', 'production-eu-west-1');
  });

  it('rttMs 缺省或非 connected 态 → 不渲染延迟', () => {
    const { rerender } = render(
      <MachineGroup machine={remoteMachine({ status: 'connected', workspaces: [] })} />,
    );
    expect(document.querySelector('.sidebar-machine-rtt')).not.toBeInTheDocument();
    rerender(
      <MachineGroup
        machine={remoteMachine({ status: 'reconnecting', rttMs: 12, workspaces: [] })}
      />,
    );
    expect(document.querySelector('.sidebar-machine-rtt')).not.toBeInTheDocument();
  });
});

describe('MachineGroup · 连接生命周期(AC-8)', () => {
  it('connecting → 复用 CONNECT_STAGE_LABEL 文案', () => {
    render(
      <MachineGroup machine={remoteMachine({ runtime: { configId: 'cfg-1', stage: 'connecting' } })} />,
    );
    expect(screen.getByText(/Connecting…/)).toBeInTheDocument();
  });

  it('deploying → 文案 + 百分比', () => {
    render(
      <MachineGroup
        machine={remoteMachine({
          runtime: { configId: 'cfg-1', stage: 'deploying', percent: 47 },
        })}
      />,
    );
    expect(screen.getByText(/Deploying…/)).toBeInTheDocument();
    expect(screen.getByText(/47%/)).toBeInTheDocument();
  });

  // T-016(AC-7):failed 不再进组头。原用例断言的是「✗ 原因 + Retry 按钮」常驻组头,
  // 该呈现已整体改道为全局 toast(见 SidebarMachineGroups 的 T-014),组头回落成
  // 「未连接」外观。这里反向断言:失败原因文案与 Retry 钮都**不得**出现,取而代之
  // 的是可再连的连接图标钮。
  it('failed → 组头不留失败痕迹,回落成连接图标钮(AC-7)', () => {
    const onConnect = vi.fn();
    render(
      <MachineGroup
        machine={remoteMachine({
          runtime: { configId: 'cfg-1', stage: 'failed', reason: 'unreachable' },
        })}
        onConnect={onConnect}
      />,
    );
    expect(screen.queryByText(/Unreachable/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('cfg-1');
  });
});

describe('MachineGroup · 断线两段式回落(AC-11/D-8)', () => {
  it('panel 阶段:红点(lost)态 + workspace 行内"已断开"标签,未折叠', () => {
    const { container } = render(
      <MachineGroup
        machine={remoteMachine({
          status: 'lost',
          foldedLost: false,
          workspaces: [
            { id: 'w1', name: 'aon-edge', meta: 'x', active: true, tabCount: 1, disconnectedPanel: true },
          ],
        })}
      />,
    );
    expect(container.querySelector('.sidebar-machine-group--lost')).toBeInTheDocument();
    expect(screen.getByText('aon-edge')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('folded 阶段:workspaces=null + foldedLost → "已断开 · 点击重连" + 重连按钮', () => {
    const onConnect = vi.fn();
    render(
      <MachineGroup
        machine={remoteMachine({
          status: 'lost',
          foldedLost: true,
          emptyLabel: 'Disconnected · Click to reconnect',
          workspaces: null,
        })}
        onConnect={onConnect}
      />,
    );
    expect(screen.getByText('Disconnected · Click to reconnect')).toBeInTheDocument();
    expect(screen.queryByTestId('machine-workspace-row')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(onConnect).toHaveBeenCalledWith('cfg-1');
  });
});

describe('MachineGroup · 展开/折叠(用户需求 2026-07-13)', () => {
  const connected = (): MachineInfo =>
    remoteMachine({
      status: 'connected',
      rttMs: 114,
      workspaces: [
        { id: 'w1', name: 'aon-main', meta: 'm1', active: false, tabCount: 2, tabRunning: 1 },
        { id: 'w2', name: 'okok', meta: 'm2', active: true, tabCount: 3 },
      ],
    });

  it('点组头 → onToggleCollapse(machineId);缺省不传则组头不可点(零回归)', () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <MachineGroup machine={connected()} onToggleCollapse={onToggle} />,
    );
    fireEvent.click(container.querySelector('.sidebar-machine-header')!);
    expect(onToggle).toHaveBeenCalledWith('cfg-1');

    rerender(<MachineGroup machine={connected()} />);
    expect(container.querySelector('.sidebar-machine-header--clickable')).toBeNull();
    expect(container.querySelector('.sidebar-machine-chevron')).toBeNull();
  });

  it('collapsed:隐藏全部 workspace 行,组头显聚合徽标(tab 求和 · running 求和)', () => {
    render(
      <MachineGroup machine={connected()} collapsed onToggleCollapse={() => {}} />,
    );
    expect(screen.queryByText('aon-main')).not.toBeInTheDocument();
    expect(screen.queryByText('okok')).not.toBeInTheDocument();
    // aggregateBadge:tabCount=5 · running=1(SessionBadge aria-label 单源 formatTabBadge)
    expect(screen.getByLabelText('5 session · 1 running')).toBeInTheDocument();
  });

  it('组头聚合注意力气泡(远程 workspace attention 求和,折叠也显 · 2026-07-15)', () => {
    const machine = {
      ...connected(),
      workspaces: [
        { id: 'w1', name: 'aon-main', meta: 'm1', active: false, tabCount: 2, tabRunning: 1, attention: 2 },
        { id: 'w2', name: 'okok', meta: 'm2', active: true, tabCount: 3, attention: 1 },
      ],
    };
    const { container } = render(
      <MachineGroup machine={machine} collapsed onToggleCollapse={() => {}} />,
    );
    const pill = container.querySelector('.sidebar-machine-header .sidebar-attention-pill');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('3'); // 2 + 1
  });

  it('collapsed 未连接组:隐藏「未连接」提示,组头 Connect 按钮仍在且点击不触发折叠切换', () => {
    const onToggle = vi.fn();
    const onConnect = vi.fn();
    render(
      <MachineGroup
        machine={remoteMachine()}
        collapsed
        onToggleCollapse={onToggle}
        onConnect={onConnect}
      />,
    );
    expect(
      screen.queryByText('Not connected · Connect to see its projects'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('cfg-1');
    expect(onToggle).not.toHaveBeenCalled(); // stopPropagation:按钮点击不折叠
  });
});

describe('MachineGroup · 组头 + 添加项目入口(用户需求 2026-08-03,替代齿轮设置入口)', () => {
  it('远程机已连接 + onAddWorkspace → 渲染 + 钮;点击回调 machineId 且不触发折叠(stopPropagation)', () => {
    const onAddWorkspace = vi.fn();
    const onToggle = vi.fn();
    render(
      <MachineGroup
        machine={remoteMachine({ status: 'connected', rttMs: 80, workspaces: [] })}
        onAddWorkspace={onAddWorkspace}
        onToggleCollapse={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Project' }));
    expect(onAddWorkspace).toHaveBeenCalledWith('cfg-1');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('未连接(workspaces=null)不渲染 + 钮;齿轮设置入口已移除', () => {
    render(<MachineGroup machine={remoteMachine()} onAddWorkspace={() => {}} />);
    expect(
      screen.queryByRole('button', { name: 'Add Project' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Configure remote host' }),
    ).not.toBeInTheDocument();
  });

  it('缺省不传 onAddWorkspace 不渲染 + 钮(零回归)', () => {
    render(<MachineGroup machine={remoteMachine({ status: 'connected', workspaces: [] })} />);
    expect(
      screen.queryByRole('button', { name: 'Add Project' }),
    ).not.toBeInTheDocument();
  });
});
