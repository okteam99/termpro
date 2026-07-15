// @vitest-environment jsdom
// AI 浏览器控制桥(渲染层侧 · 阶段2):派发 main 控制请求到 browserControl,结果回传;
// 白名单拦未知方法;方法抛错 → ok:false。经真实 listTabs(同步、无需 webview)端到端验证。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../state/store';
import type { WorkspaceState } from '../../state/store';
import {
  __resetBrowserControlBridgeForTest,
  initBrowserControlBridge,
} from '../browserControlBridge';

const TERM = 'term1';
let invokeCb: ((req: { requestId: string; method: string; args: unknown[] }) => void) | null = null;
const sendResult = vi.fn();

function seed(browser?: { tabs: { id: string; url: string }[]; activeTabId: string | null }) {
  const ws: WorkspaceState = {
    id: 'ws1',
    name: 'w',
    root: '/w',
    hostId: 'local',
    tabs: [{ id: TERM, title: 't', cwd: '/w', browser }],
    activeTabId: TERM,
  };
  useAppStore.setState({ workspaces: [ws], activeWorkspaceId: 'ws1', browserPanelOpen: true });
}

beforeEach(() => {
  invokeCb = null;
  sendResult.mockClear();
  (window as unknown as { okwork: unknown }).okwork = {
    browserControl: {
      onInvoke: (cb: typeof invokeCb) => {
        invokeCb = cb;
        return () => undefined;
      },
      sendResult,
    },
  };
  useAppStore.setState({ workspaces: [], activeWorkspaceId: null });
  __resetBrowserControlBridgeForTest();
  initBrowserControlBridge();
});

async function invoke(method: string, args: unknown[]) {
  invokeCb!({ requestId: 'r1', method, args });
  await new Promise((r) => setTimeout(r, 0)); // 让 async 派发 flush
}

describe('browserControlBridge', () => {
  it('已知方法 listTabs → ok:true + 结果', async () => {
    seed({ tabs: [{ id: 'a', url: 'https://a.dev' }], activeTabId: 'a' });
    await invoke('listTabs', [TERM]);
    expect(sendResult).toHaveBeenCalledWith({
      requestId: 'r1',
      ok: true,
      value: [{ id: 'a', url: 'https://a.dev', title: undefined, active: true, net: 'local' }],
    });
  });

  it('未知方法 → ok:false + error', async () => {
    await invoke('rm_rf', [TERM]);
    expect(sendResult).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r1', ok: false }),
    );
    expect(sendResult.mock.calls[0][0].error).toMatch(/unknown browser control method/);
  });

  it('方法抛错(终端 tab 不存在)→ ok:false + error 透传', async () => {
    seed({ tabs: [], activeTabId: null });
    await invoke('listTabs', ['no-such-term']);
    const arg = sendResult.mock.calls[0][0];
    expect(arg.ok).toBe(false);
    expect(arg.error).toMatch(/terminal tab not found/);
  });
});
