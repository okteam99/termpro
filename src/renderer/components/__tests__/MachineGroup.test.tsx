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
    expect(screen.getByText('0 session')).toBeInTheDocument();
    expect(screen.getByText('2 session · 1 running')).toBeInTheDocument();
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
    fireEvent.click(screen.getByTitle('Rename workspace'));
    expect(onRenameWorkspace).toHaveBeenCalledWith(machine, machine.workspaces?.[0]);
    fireEvent.click(screen.getByTitle('Remove workspace'));
    expect(onRemoveWorkspace).toHaveBeenCalledWith(machine, machine.workspaces?.[0]);
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });
});

describe('MachineGroup · 组头连接延迟(心跳 RTT)', () => {
  it('connected + rttMs → 圆点在云图标之后,延迟毫秒数紧随圆点', () => {
    const { container } = render(
      <MachineGroup machine={remoteMachine({ status: 'connected', rttMs: 12, workspaces: [] })} />,
    );
    const rtt = screen.getByText('12ms');
    expect(rtt).toHaveClass('sidebar-machine-rtt');
    // 顺序断言:icon → dot → rtt
    const header = container.querySelector('.sidebar-machine-header')!;
    const children = Array.from(header.children);
    const iconIdx = children.findIndex((el) => el.classList.contains('sidebar-machine-icon'));
    const dotIdx = children.findIndex((el) => el.classList.contains('sidebar-machine-dot'));
    const rttIdx = children.findIndex((el) => el.classList.contains('sidebar-machine-rtt'));
    expect(iconIdx).toBeGreaterThanOrEqual(0);
    expect(dotIdx).toBe(iconIdx + 1);
    expect(rttIdx).toBe(dotIdx + 1);
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

  it('failed → 失败原因(FAIL_REASON_COPY 单源)+ 重试按钮', () => {
    const onRetry = vi.fn();
    render(
      <MachineGroup
        machine={remoteMachine({
          runtime: { configId: 'cfg-1', stage: 'failed', reason: 'unreachable' },
        })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/Unreachable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('cfg-1');
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
