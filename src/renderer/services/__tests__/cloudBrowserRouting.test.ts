// @vitest-environment jsdom
// agent 的 browser_* 打到哪个浏览器:云端 headless vs 本机 webview。
// 🔴 这组测试守的是「渐进启用,零破坏」——远端没装 Chromium 的存量用户升级后
// 行为必须一字不变(继续走本机 webview + 反向转发)。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import { hostRegistry } from '../hostRegistry';
import {
  resolveBrowserBackend,
  invalidateCloudBrowserProbe,
  __resetCloudBrowserRoutingForTest,
} from '../cloudBrowserRouting';
import * as bc from '../browserControl';
import { registerBrowserView, __clearBrowserViewsForTest } from '../browserViewRegistry';

const TERM = 'term1';
const REMOTE = 'cfg-remote';

/** 假远程 HostClient:只实现路由要用的能力位与 rpc。 */
function fakeClient(over: {
  capabilities?: string[];
  status?: { available: boolean; hint?: string };
  statusError?: Error;
} = {}) {
  const rpc = vi.fn(async (method: string) => {
    if (method === 'browser.status') {
      if (over.statusError) throw over.statusError;
      return {
        available: over.status?.available ?? true,
        executablePath: over.status?.available === false ? null : '/usr/bin/chromium',
        running: false,
        ...(over.status?.hint ? { hint: over.status.hint } : {}),
      };
    }
    if (method === 'browser.listTabs') {
      return { tabs: [{ tabId: 'cloud-1', url: 'https://cloud.test', title: 'C', active: true }] };
    }
    if (method === 'browser.navigate') return { tabId: 'cloud-1' };
    if (method === 'browser.openTab') return { tabId: 'cloud-2' };
    if (method === 'browser.getText') return { text: 'cloud text' };
    if (method === 'browser.screenshot') return { base64: 'Q0xPVUQ=' };
    if (method === 'browser.click') return { ok: true };
    return {};
  });
  return {
    info: { capabilities: over.capabilities ?? ['browser.headless'] },
    supportsCloudBrowser() {
      return (over.capabilities ?? ['browser.headless']).includes('browser.headless');
    },
    rpc,
  };
}

function registerRemote(client: unknown, hostId = REMOTE) {
  // 直接塞进注册表内部 map(getOrCreateRemote 会造真 HostClient)
  (hostRegistry as unknown as { clients: Map<string, unknown> }).clients.set(hostId, client);
}

function seedWorkspace(hostId: string) {
  const ws: WorkspaceState = {
    id: 'ws1',
    name: 'w',
    root: '/w',
    hostId,
    tabs: [
      {
        id: TERM,
        title: 't',
        cwd: '/w',
        browser: { tabs: [{ id: 'local-a', url: 'https://local.test' }], activeTabId: 'local-a' },
      },
    ],
    activeTabId: TERM,
  };
  useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws1', browserPanelOpen: true });
}

function fakeView() {
  return {
    loadURL: vi.fn(async () => undefined),
    executeJavaScript: vi.fn(async (code: string) =>
      code.includes('innerText') ? 'local text' : 'local',
    ),
    capturePage: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,LOCAL' })),
  } as unknown as HTMLWebViewElement;
}

beforeEach(() => {
  __resetCloudBrowserRoutingForTest();
  __clearBrowserViewsForTest();
  (hostRegistry as unknown as { clients: Map<string, unknown> }).clients.delete(REMOTE);
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null, browserPanelOpen: false });
});

describe('后端判定', () => {
  it('本机 workspace → 恒走本机 webview(本地不需要云端那套)', async () => {
    await expect(resolveBrowserBackend('local')).resolves.toMatchObject({
      kind: 'local',
      reason: 'local-host',
    });
  });

  it('🔴 旧 host(无 browser.headless 能力位)→ 本机 webview,且一个 RPC 都不发', async () => {
    const client = fakeClient({ capabilities: ['session.resume'] });
    registerRemote(client);
    await expect(resolveBrowserBackend(REMOTE)).resolves.toMatchObject({
      kind: 'local',
      reason: 'no-capability',
    });
    expect(client.rpc).not.toHaveBeenCalled(); // 不许对旧 host 盲发 unknown rpc
  });

  it('🔴 远端有能力位但没装 Chromium → 本机 webview(存量用户零破坏)', async () => {
    registerRemote(fakeClient({ status: { available: false, hint: 'apt-get install chromium' } }));
    await expect(resolveBrowserBackend(REMOTE)).resolves.toMatchObject({
      kind: 'local',
      reason: 'no-chromium',
    });
  });

  it('远端有能力位且装了 Chromium → 云端', async () => {
    registerRemote(fakeClient());
    const backend = await resolveBrowserBackend(REMOTE);
    expect(backend.kind).toBe('cloud');
  });

  it('远程 client 不在注册表(断线竞态)→ 退本机,不抛', async () => {
    await expect(resolveBrowserBackend(REMOTE)).resolves.toMatchObject({ kind: 'local' });
  });

  it('判定结果缓存:并发首调只探一次,后续零往返', async () => {
    const client = fakeClient();
    registerRemote(client);
    await Promise.all([
      resolveBrowserBackend(REMOTE),
      resolveBrowserBackend(REMOTE),
      resolveBrowserBackend(REMOTE),
    ]);
    await resolveBrowserBackend(REMOTE);
    const probes = client.rpc.mock.calls.filter(([m]) => m === 'browser.status');
    expect(probes).toHaveLength(1);
  });

  it('探测失败(连接抖动)不缓存:下次重问,不把瞬时故障钉成永久没有', async () => {
    const client = fakeClient({ statusError: new Error('host connection lost') });
    registerRemote(client);
    await expect(resolveBrowserBackend(REMOTE)).resolves.toMatchObject({
      kind: 'local',
      reason: 'no-chromium',
    });
    await resolveBrowserBackend(REMOTE);
    expect(client.rpc.mock.calls.filter(([m]) => m === 'browser.status')).toHaveLength(2);
  });

  it('invalidate 后重新探测(重连/装了浏览器之后能翻身)', async () => {
    const client = fakeClient({ status: { available: false } });
    registerRemote(client);
    await expect(resolveBrowserBackend(REMOTE)).resolves.toMatchObject({ kind: 'local' });

    invalidateCloudBrowserProbe(REMOTE);
    registerRemote(fakeClient({ status: { available: true } }));
    await expect(resolveBrowserBackend(REMOTE)).resolves.toMatchObject({ kind: 'cloud' });
  });
});

describe('browserControl 按后端分流', () => {
  it('云端:navigate / getText / screenshot / listTabs 走 browser.* RPC,不碰 webview', async () => {
    const client = fakeClient();
    registerRemote(client);
    seedWorkspace(REMOTE);
    const view = fakeView();
    registerBrowserView('local-a', view);

    await expect(bc.navigate(TERM, 'https://cloud.test')).resolves.toEqual({
      browserTabId: 'cloud-1',
    });
    await expect(bc.getText(TERM)).resolves.toBe('cloud text');
    // 裸 base64 在这层补回 data: 前缀,与本机路径同一契约
    await expect(bc.screenshot(TERM)).resolves.toBe('data:image/png;base64,Q0xPVUQ=');
    await expect(bc.listTabs(TERM)).resolves.toEqual([
      { id: 'cloud-1', url: 'https://cloud.test', title: 'C', active: true, net: REMOTE },
    ]);

    // 本机 webview 全程没被碰过
    expect((view.loadURL as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((view.executeJavaScript as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((view.capturePage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('🔴 远端没装 Chromium:同样的调用落回本机 webview(行为与改动前一致)', async () => {
    registerRemote(fakeClient({ status: { available: false } }));
    seedWorkspace(REMOTE);
    const view = fakeView();
    registerBrowserView('local-a', view);

    await expect(bc.getText(TERM)).resolves.toBe('local text');
    await expect(bc.screenshot(TERM)).resolves.toBe('data:image/png;base64,LOCAL');
    expect((view.executeJavaScript as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('云端标签 id 原样透传(agent 拿到什么就能传回什么)', async () => {
    const client = fakeClient();
    registerRemote(client);
    seedWorkspace(REMOTE);

    await expect(bc.openTab(TERM, 'https://x.test')).resolves.toEqual({
      browserTabId: 'cloud-2',
    });
    await bc.closeTab(TERM, 'cloud-2');
    expect(client.rpc).toHaveBeenCalledWith('browser.closeTab', { tabId: 'cloud-2' });
    await bc.activateTab(TERM, 'cloud-1');
    expect(client.rpc).toHaveBeenCalledWith('browser.activateTab', { tabId: 'cloud-1' });
  });

  it('云端路径不受本机窗格状态影响(弹出/无窗格都照常打远端)', async () => {
    registerRemote(fakeClient());
    // 本机窗格被弹出到独立窗口——本机路径会拒绝,云端路径与它无关
    const ws: WorkspaceState = {
      id: 'ws1',
      name: 'w',
      root: '/w',
      hostId: REMOTE,
      tabs: [{ id: TERM, title: 't', cwd: '/w', browser: { tabs: [], activeTabId: null, poppedOut: true } }],
      activeTabId: TERM,
    };
    useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws1' });

    await expect(bc.navigate(TERM, 'https://cloud.test')).resolves.toEqual({
      browserTabId: 'cloud-1',
    });
  });
});
