/** Electron NativeImage 的最小可测形状(main.ts 注入 clipboard.readImage() 结果)。 */
export interface ClipboardNativeImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface ClipboardImagePayload {
  base64: string;
  size: number;
}

/** 与 Host WS 32 MiB payload / fs 二进制读取上限对齐:20 MiB raw → 约 27 MiB base64。 */
export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * 本机剪贴板图片统一转 PNG。空剪贴板返回 null;超限在进入 renderer/WS 前即拒绝,
 * 避免 base64 膨胀后才把 renderer 或远程连接撑爆。
 */
export function encodeClipboardImage(
  image: ClipboardNativeImage,
  maxBytes = MAX_CLIPBOARD_IMAGE_BYTES,
): ClipboardImagePayload | null {
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  if (png.length === 0) return null;
  if (png.length > maxBytes) {
    throw new Error(`clipboard image is too large (${png.length} bytes; max ${maxBytes})`);
  }
  return { base64: png.toString('base64'), size: png.length };
}
