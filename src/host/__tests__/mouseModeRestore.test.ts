// 断线重连后鼠标失灵(用户报障 2026-08-14:opencode 一类可鼠标交互的 TUI)。
// 根因:?1000/?1002/?1006 这些模式序列在 TUI 启动一瞬发出,断线久了早被挤出 ring 的
// 全量切片;收养回放先 term.reset() 再写切片,xterm 于是不知道远端还开着鼠标跟踪,
// 根本不编码鼠标事件发回去 → 点了没反应。治法与 ?2004h 同款:host 跟踪当前模式集合,
// 进快照,renderer 全量回放时补写。本文件覆盖 host 侧链路(扫描器 → tracker → 快照)。
import { describe, expect, it, vi } from 'vitest';
import { OutputScanner } from '../outputScanner';
import { SessionTracker } from '../sessionTracker';
import { RESTORABLE_DEC_MODES, isRestorableDecMode } from '../../shared/protocol';

function wired() {
  const tracker = new SessionTracker({ shellName: 'zsh', emit: vi.fn() });
  const scanner = new OutputScanner({
    onMouseMode: (mode, on) => tracker.onMouseMode(mode, on),
    onAltScreen: (on) => tracker.onAltScreen(on),
    onBracketedPaste: (on) => tracker.onBracketedPaste(on),
  });
  const feed = (s: string) => scanner.feed(s);
  return { tracker, feed };
}

describe('白名单(协议层单源)', () => {
  it('只放行鼠标/焦点上报类,屏幕类模式不在内', () => {
    for (const mode of [9, 1000, 1002, 1003, 1004, 1006, 1015, 1016]) {
      expect(isRestorableDecMode(mode)).toBe(true);
    }
    // 备用屏 / 粘贴 / 光标键等另有专门处置,绝不走通用补写
    for (const mode of [1049, 1047, 47, 2004, 1, 25]) {
      expect(isRestorableDecMode(mode)).toBe(false);
    }
    expect(RESTORABLE_DEC_MODES).toContain(1006);
  });
});

describe('扫描器 → tracker:模式集合跟随输出流', () => {
  it('TUI 常见开法(一条 CSI 多参数)全部记下', () => {
    const { tracker, feed } = wired();
    feed('\x1b[?1002;1006h'); // 按钮事件 + SGR 坐标
    expect(tracker.snapshot().mouseModes).toEqual([1002, 1006]);
  });

  it('分开发的多条也累积;关闭即移除', () => {
    const { tracker, feed } = wired();
    feed('\x1b[?1000h');
    feed('\x1b[?1006h');
    expect(tracker.snapshot().mouseModes).toEqual([1000, 1006]);
    feed('\x1b[?1000l');
    expect(tracker.snapshot().mouseModes).toEqual([1006]);
  });

  it('TUI 退出时的成套关闭 → 集合清空(不把死模式带进重连)', () => {
    const { tracker, feed } = wired();
    feed('\x1b[?1002;1003;1006h');
    feed('\x1b[?1002;1003;1006l');
    expect(tracker.snapshot().mouseModes).toEqual([]);
  });

  it('序列被 chunk 切开照样认(扫描器状态跨 feed 保持)', () => {
    const { tracker, feed } = wired();
    feed('\x1b[?10');
    feed('02;10');
    feed('06h');
    expect(tracker.snapshot().mouseModes).toEqual([1002, 1006]);
  });

  it('非白名单私有模式不进集合(?1049 备用屏走自己的分支)', () => {
    const { tracker, feed } = wired();
    feed('\x1b[?1049h\x1b[?2004h');
    expect(tracker.snapshot().mouseModes).toEqual([]);
    expect(tracker.snapshot().altscreen).toBe(true);
    expect(tracker.snapshot().bracketedPaste).toBe(true);
  });

  it('会话退出冻结后不再改动(快照定格退出前终态)', () => {
    const { tracker, feed } = wired();
    feed('\x1b[?1006h');
    tracker.freeze();
    feed('\x1b[?1006l');
    expect(tracker.snapshot().mouseModes).toEqual([1006]);
  });
});
