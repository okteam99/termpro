// @vitest-environment jsdom
// DECRQM 拦截修复(用户报告 2026-07-15「进 vim 卡死」根因):xterm 自带 requestMode 在
// 线上压缩包里抛 ReferenceError → 解析写入循环崩 → 终端冻死。getOrCreateTerminal 自注册
// DECRQM(CSI ? mode $ p / CSI mode $ p)handler 拦在内建之前(返回 true 跳过它),回
// 「未识别(0)」应答。本测验证真实注册确实拦截 DECRQM 并把应答经 client.input 送回。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getOrCreateTerminal, __clearRegistryForTest } from '../terminalRegistry';

// 剪贴板桥(getOrCreateTerminal 内 installRemoteClipboardPasteHandler 会读)
beforeAll(() => {
  (window as unknown as { okwork: unknown }).okwork = {
    clipboardReadImage: vi.fn(async () => null),
    clipboardReadText: vi.fn(async () => ''),
  };
});

afterEach(() => {
  __clearRegistryForTest();
});

function writeAndFlush(term: { write(d: string, cb?: () => void): void }, data: string) {
  return new Promise<void>((resolve) => term.write(data, () => resolve()));
}

describe('DECRQM 拦截', () => {
  it('CSI ? mode $ p:拦截 + 回 `?mode;0$y`,经 client.input 送回(不触发内建 requestMode)', async () => {
    const inst = getOrCreateTerminal('t-decrqm');
    const input = vi.fn();
    inst.sessionId = 's1';
    inst.client = { input } as never;

    await writeAndFlush(inst.term, '\x1b[?2026$p'); // 同步输出模式查询(vim 进入常发)
    await writeAndFlush(inst.term, '\x1b[?1049$p'); // 备用屏幕模式查询

    expect(input).toHaveBeenCalledWith('s1', '\x1b[?2026;0$y');
    expect(input).toHaveBeenCalledWith('s1', '\x1b[?1049;0$y');
    // 恰好 2 次 = 只有我们的应答,内建(线上崩溃的)requestMode 被跳过(否则会多出它的应答)
    expect(input).toHaveBeenCalledTimes(2);
  });

  it('ANSI 形式 CSI mode $ p(无 ? 前缀):回不带 ? 的应答', async () => {
    const inst = getOrCreateTerminal('t-decrqm2');
    const input = vi.fn();
    inst.sessionId = 's2';
    inst.client = { input } as never;

    await writeAndFlush(inst.term, '\x1b[4$p'); // 查询 IRM(插入替换)

    expect(input).toHaveBeenCalledWith('s2', '\x1b[4;0$y');
  });

  it('未 spawn(无 client)时不抛,静默跳过', async () => {
    const inst = getOrCreateTerminal('t-decrqm3'); // client=null
    await expect(writeAndFlush(inst.term, '\x1b[?2026$p')).resolves.toBeUndefined();
  });
});
