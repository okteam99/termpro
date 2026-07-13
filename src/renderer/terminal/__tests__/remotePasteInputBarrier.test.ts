import { describe, expect, it } from 'vitest';
import { RemotePasteInputBarrier } from '../remotePasteInputBarrier';

describe('RemotePasteInputBarrier', () => {
  it('图片上传期间的后续键入排在 OkWork 注入的 bracketed paste 之后', () => {
    const barrier = new RemotePasteInputBarrier();
    barrier.capture('typed-after-ctrl-v');
    barrier.inject(() => {
      barrier.capture('\x1b[200~/tmp/image.png\x1b[201~');
    });

    expect(barrier.drain()).toEqual([
      '\x1b[200~/tmp/image.png\x1b[201~',
      'typed-after-ctrl-v',
    ]);
    expect(barrier.drain()).toEqual([]);
  });

  it('注入抛错也会复位 injecting,后续输入不被误标成注入数据', () => {
    const barrier = new RemotePasteInputBarrier();
    expect(() =>
      barrier.inject(() => {
        throw new Error('paste failed');
      }),
    ).toThrow('paste failed');
    barrier.capture('user');
    expect(barrier.drain()).toEqual(['user']);
  });
});
