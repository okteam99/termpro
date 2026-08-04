// @vitest-environment jsdom
// exitHoldCounter(评审 P1-1):同窗多 html tab 共享 hostId 引用计数,任一 tab 卸载
// 不该拆掉其它 tab 仍在用的 hold。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquire,
  release,
  __resetExitHoldCounterForTest,
} from '../exitHoldCounter';

const hold = vi.fn().mockResolvedValue({ local: true, exits: [] });

function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: { browserNet: { hold } },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  hold.mockClear();
  __resetExitHoldCounterForTest();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('exitHoldCounter', () => {
  it('acquire 上报含新增 hostId 的全集', async () => {
    mockOkwork();
    await acquire('h1');
    expect(hold).toHaveBeenLastCalledWith(['h1']);
  });

  it('同一 hostId 两 tab 各自 acquire:release 一个后仍上报含该 hostId 的集合,全释放后上报空', async () => {
    mockOkwork();
    await acquire('h1'); // tab A
    await acquire('h1'); // tab B(同 hostId)
    expect(hold).toHaveBeenLastCalledWith(['h1']);

    await release('h1'); // tab A 卸载
    // 仍有 tab B 在用:全集里 h1 不能消失
    expect(hold).toHaveBeenLastCalledWith(['h1']);

    await release('h1'); // tab B 卸载,计数归零
    expect(hold).toHaveBeenLastCalledWith([]);
  });

  it('多 hostId 独立记账,去重排序', async () => {
    mockOkwork();
    await acquire('b');
    await acquire('a');
    await acquire('b'); // b 的第二个引用
    expect(hold).toHaveBeenLastCalledWith(['a', 'b']);

    await release('b');
    expect(hold).toHaveBeenLastCalledWith(['a', 'b']); // b 仍有一个引用

    await release('a');
    expect(hold).toHaveBeenLastCalledWith(['b']);

    await release('b');
    expect(hold).toHaveBeenLastCalledWith([]);
  });

  it('release 一个从未 acquire 过的 hostId:无害 no-op,不产生负计数', async () => {
    mockOkwork();
    await acquire('x');
    await release('y'); // 不存在的 key
    expect(hold).toHaveBeenLastCalledWith(['x']);
    await release('x');
    await release('x'); // 再 release 同一 key(已归零)仍无害
    expect(hold).toHaveBeenLastCalledWith([]);
  });

  it('上报失败(IPC 拒绝)→ console.warn 吞掉,不抛给调用方', async () => {
    Object.defineProperty(window, 'okwork', {
      value: { browserNet: { hold: vi.fn().mockRejectedValue(new Error('boom')) } },
      writable: true,
      configurable: true,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(acquire('h1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
