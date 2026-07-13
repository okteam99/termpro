import { describe, expect, it } from 'vitest';
import { encodeClipboardImage } from '../clipboardImage';

describe('encodeClipboardImage', () => {
  it('空 NativeImage 返回 null,不调用 toPNG', () => {
    let encoded = false;
    expect(
      encodeClipboardImage({
        isEmpty: () => true,
        toPNG: () => {
          encoded = true;
          return Buffer.alloc(0);
        },
      }),
    ).toBeNull();
    expect(encoded).toBe(false);
  });

  it('PNG 转为带原始大小的 base64', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(
      encodeClipboardImage({ isEmpty: () => false, toPNG: () => png }),
    ).toEqual({ base64: png.toString('base64'), size: png.length });
  });

  it('编码前拒绝超限图片', () => {
    expect(() =>
      encodeClipboardImage(
        { isEmpty: () => false, toPNG: () => Buffer.alloc(5) },
        4,
      ),
    ).toThrow(/too large/i);
  });
});
