// @vitest-environment jsdom
// 事故回归(2026-07-20):旧会话(vim/claude TUI 等)开了鼠标跟踪
// (`\x1b[?1002h`/`?1006h`)后被异常终止(host 被杀/连接掉线),从未发关闭序列。
// xterm 的模式状态是纯前端存量,不随死会话消失——respawn 到同一个跨挂载存活的
// 实例(如 remirrorIfTakenOver 的 !found 分支)若不清状态,新 shell 从没开过鼠标
// 跟踪,却会把触控板移动的 SGR 报文当键入,刷屏 `command not found`。
// ensureSession 对任何真正发起 pty.spawn 的路径先 term.reset(),用真实 xterm
// Terminal(而非桩)断言 term.modes.mouseTrackingMode 被清零,而非仅打桩验证调用。
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeClient = {
  info: { homedir: '/home/u' },
  rpc: vi.fn(async (method: string) => {
    if (method === 'pty.spawn') return { sessionId: 'fresh-sid' };
    return {};
  }),
  attachPty: vi.fn(() => () => {}),
  input: vi.fn(),
  resize: vi.fn(),
  ack: vi.fn(),
};

vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    forWorkspace: vi.fn(() => fakeClient),
    forHostId: vi.fn(() => fakeClient),
    local: vi.fn(() => fakeClient),
  },
}));

import { disposeTerminal, ensureSession, getOrCreateTerminal } from '../terminalRegistry';

afterEach(() => {
  disposeTerminal('tab-mouse-leak');
  vi.clearAllMocks();
});

describe('ensureSession 清理跨会话残留的终端模式', () => {
  it('respawn 前旧会话遗留的鼠标跟踪模式被 reset() 清零', async () => {
    const inst = getOrCreateTerminal('tab-mouse-leak');
    // 模拟旧会话(如今已死)开过 SGR 鼠标跟踪但没来得及关闭
    // (term.write 异步处理,须等回调触发才能断言解析后的模式状态)
    await new Promise<void>((resolve) => inst.term.write('\x1b[?1002h\x1b[?1006h', resolve));
    expect(inst.term.modes.mouseTrackingMode).not.toBe('none');

    // 旧会话判定为已死:respawn 到【同一个】inst(不是新建 tab)
    inst.sessionId = null;
    await ensureSession('tab-mouse-leak', '/repo', 'local');

    expect(inst.term.modes.mouseTrackingMode).toBe('none');
    expect(inst.sessionId).toBe('fresh-sid');
  });

  it('全新 tab 首次 spawn 不受影响(reset 对空终端是 no-op)', async () => {
    await ensureSession('tab-mouse-leak', '/repo', 'local');
    const inst = getOrCreateTerminal('tab-mouse-leak');
    expect(inst.sessionId).toBe('fresh-sid');
    expect(inst.term.modes.mouseTrackingMode).toBe('none');
  });
});
