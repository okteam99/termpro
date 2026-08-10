// @vitest-environment jsdom
// BL-005 · A3/Q2(review-fix·北极星渲染半侧生产接线):真实 reconnectWiring.reconcileBadge → store。
// 上轮 T-034/035 只断言「readoptHost 调了注入的 reconcileBadge spy」+ inst 的只读死字段,真实接线
// (findTab → useAppStore.updateTab)零测,导致「重连收养 exited 会话 → 徽标点亮」是幽灵覆盖。
// 本测直驱真实 reconcileBadge,断言 store 的 tab.exited/exitCode/activity 真被落地——删掉 exited 分支
// 或 findTab 接线,本测即变红。用 __setInstForTest 注册 (hostId,sessionId) → tabId 反查映射。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileBadge, reconnectController } from '../reconnectWiring';
import { useRemoteHostRuntimeStore } from '../../state/remoteHostStore';
import {
  __clearRegistryForTest,
  __setInstForTest,
  type TermInstance,
} from '../../terminal/terminalRegistry';
import { useAppStore, type WorkspaceState } from '../../state/store';
import type { SessionSnapshot } from '../../../shared/protocol';

function snap(over: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    sessionId: 's1',
    cwd: '/repo',
    title: 'zsh',
    status: 'live',
    state: 'idle',
    quiet: false,
    altscreen: false,
    exitCode: null,
    ...over,
  };
}

/** 注册一个 (hostId,sessionId) → tabId 反查项(findTab 依据),不构造真 xterm。 */
function registerInst(tabId: string, hostId: string, sessionId: string): void {
  __setInstForTest(tabId, { hostId, sessionId } as unknown as TermInstance);
}

function seedWorkspaceWithTab(tabId: string): void {
  const ws: WorkspaceState = {
    id: 'w1',
    name: 'aon-edge',
    root: '/repo',
    hostId: 'cfg-1',
    tabs: [{ id: tabId, title: 'zsh', cwd: '/repo', activity: 'running' }],
    activeTabId: tabId,
  };
  useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'w1' });
}

function tab(tabId: string) {
  return useAppStore
    .getState()
    .workspaces.flatMap((w) => w.tabs)
    .find((t) => t.id === tabId)!;
}

beforeEach(() => {
  __clearRegistryForTest();
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
});

afterEach(() => {
  __clearRegistryForTest();
});

describe('reconcileBadge 生产接线落 store(A3/Q2)', () => {
  it('exited 快照 → 真落 store tab.exited=true + exitCode(北极星「✓ exit N 已完成」徽标点亮)', () => {
    registerInst('tab-1', 'cfg-1', 's1');
    seedWorkspaceWithTab('tab-1');

    reconcileBadge('cfg-1', 's1', snap({ status: 'exited', state: 'idle', exitCode: 0 }));

    expect(tab('tab-1').exited).toBe(true); // TabBar 据此渲染 tabbar-tab--exited + hint
    expect(tab('tab-1').exitCode).toBe(0);
    expect(tab('tab-1').activity).toBe('idle');
  });

  it('exited 非零退出码透传(如 build 失败 exit 1)', () => {
    registerInst('tab-1', 'cfg-1', 's1');
    seedWorkspaceWithTab('tab-1');

    reconcileBadge('cfg-1', 's1', snap({ status: 'exited', state: 'idle', exitCode: 1 }));

    expect(tab('tab-1').exited).toBe(true);
    expect(tab('tab-1').exitCode).toBe(1);
  });

  it('live running 快照 → activity=running·不误置 exited', () => {
    registerInst('tab-1', 'cfg-1', 's1');
    seedWorkspaceWithTab('tab-1');

    reconcileBadge('cfg-1', 's1', snap({ status: 'live', state: 'running' }));

    expect(tab('tab-1').activity).toBe('running');
    expect(tab('tab-1').exited).toBeFalsy(); // live 快照不回写 exited
  });

  it('live idle 快照 → 消除过期 running 残留(AC-5)·不置 exited', () => {
    registerInst('tab-1', 'cfg-1', 's1');
    seedWorkspaceWithTab('tab-1'); // 种子 activity=running

    reconcileBadge('cfg-1', 's1', snap({ status: 'live', state: 'idle' }));

    expect(tab('tab-1').activity).toBe('idle');
    expect(tab('tab-1').exited).toBeFalsy();
  });

  it('(hostId,sessionId) 无对应 inst → findTab miss → 不动 store(不误改同名 sessionId 的本机 tab)', () => {
    // 只注册本机 tab,反查远程 cfg-1/s1 应 miss
    registerInst('tab-local', 'local', 's1');
    seedWorkspaceWithTab('tab-1');
    useAppStore.getState().updateTab('tab-1', { activity: 'running' });

    reconcileBadge('cfg-1', 's1', snap({ status: 'exited', exitCode: 0 }));

    expect(tab('tab-1').exited).toBeFalsy(); // 未被误改
  });
});

describe('生产接线:disconnect-first 走 disconnectAwait(2026-08-10 事故根因行)', () => {
  it('onDisconnected → disconnectAwait(可等待),绝不再走即发即忘 disconnect', async () => {
    vi.useFakeTimers();
    useRemoteHostRuntimeStore.setState({ runtime: {}, reconnecting: {} });
    const disconnectAwait = vi.fn(() => Promise.resolve());
    const legacyDisconnect = vi.fn();
    const connect = vi.fn();
    (window as unknown as { okwork: unknown }).okwork = {
      remoteHost: { connect, disconnect: legacyDisconnect, disconnectAwait },
    };
    try {
      reconnectController.onDisconnected('wire-cfg-1');
      expect(disconnectAwait).toHaveBeenCalledWith({ id: 'wire-cfg-1' });
      expect(legacyDisconnect).not.toHaveBeenCalled(); // 回退成旧通道 → 本断言变红
      await Promise.resolve();
      await Promise.resolve();
      expect(connect).toHaveBeenCalledWith({ id: 'wire-cfg-1' }); // 且在 await 之后才发
    } finally {
      reconnectController.cancel('wire-cfg-1'); // 清退避/看门狗计时器,不泄漏到其它测试
      vi.useRealTimers();
    }
  });
});
