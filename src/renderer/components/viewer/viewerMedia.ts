// 查看器媒体加载(用户指令 2026-08-14:内置支持视频格式打开 · 上限提到 100M)。
//
// 为什么不用 fs.readFileBinary 一把梭:那条 RPC 把整份 base64 塞进**一条** WS 消息,
// host 侧上限 20MB、链路侧 WS_MAX_PAYLOAD 32MB —— 100MB 文件 base64 后 ≈137MB,
// 无论如何过不去。故走既有的分块读 `fs.readFileRange`(512KiB/块,下载通道同一条),
// 在渲染层拼成 Blob → object URL 喂给 <video>/<img>。
// 附带好处:**不需要升级远程 host** —— 分块读是已有能力(能力位 'fs.transfer'),
// 老 host(无该能力)自动回落 readFileBinary 的 20MB 老路径。
//
// TOCTOU 口径与 transferCore 一致:首块的 size/mtimeMs 记基线,后续块不等即判定源文件
// 传输中被改写,立即中止,不把新旧内容拼进同一份 Blob。
//
// 零 React/DOM-API 依赖(只用 Blob/atob,jsdom 里可直测),组件只消费返回值。

import { TRANSFER, type RpcMethodName, type RpcMethods } from '../../../shared/protocol';

/** 查看器内置预览的媒体上限(视频/大图):100MB —— 再大只剩「下载到本机」一条路 */
export const VIEWER_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

/** Chromium 真能解的容器/编码(mkv/avi 等不列:与其放进去黑屏,不如直接给下载入口) */
const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
};

export function videoMime(path: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? (VIDEO_MIME[m[1].toLowerCase()] ?? null) : null;
}

export type MediaRpc = <M extends RpcMethodName>(
  method: M,
  params: RpcMethods[M]['params'],
) => Promise<RpcMethods[M]['result']>;

export type MediaLoadResult =
  | { ok: true; blob: Blob; size: number }
  | {
      ok: false;
      reason: 'too-large' | 'file-changed' | 'canceled' | 'not-a-file' | 'io';
      size?: number;
      detail?: string;
    };

/** base64 → 原始字节(图片/视频是二进制,不能走 TextDecoder)。
 *  显式基于 ArrayBuffer 构造:Blob 的 BlobPart 不收 SharedArrayBuffer 支撑的视图。 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 把整份文件读进内存 Blob。supportsTransfer=true 走分块(上限 VIEWER_MAX_MEDIA_BYTES),
 * 否则回落单条 readFileBinary(host 侧 20MB 上限,超限返回 base64=null → too-large)。
 */
export async function loadMediaBlob(deps: {
  rpc: MediaRpc;
  supportsTransfer: boolean;
  path: string;
  mime: string;
  onProgress?(done: number, total: number): void;
  isCanceled?(): boolean;
}): Promise<MediaLoadResult> {
  const { rpc, supportsTransfer, path, mime } = deps;
  const isCanceled = deps.isCanceled ?? (() => false);

  if (!supportsTransfer) {
    try {
      const r = await rpc('fs.readFileBinary', { path });
      if (r.base64 === null) return { ok: false, reason: 'too-large', size: r.size };
      return {
        ok: true,
        blob: new Blob([base64ToBytes(r.base64)], { type: mime }),
        size: r.size,
      };
    } catch (err) {
      return { ok: false, reason: 'io', detail: errMessage(err) };
    }
  }

  let total: number;
  try {
    const stat = await rpc('fs.stat', { path });
    if (stat.kind !== 'file') return { ok: false, reason: 'not-a-file' };
    total = stat.size ?? 0;
  } catch (err) {
    return { ok: false, reason: 'io', detail: errMessage(err) };
  }
  if (total > VIEWER_MAX_MEDIA_BYTES) {
    return { ok: false, reason: 'too-large', size: total };
  }

  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let baseline: { size: number; mtimeMs: number } | null = null;
  deps.onProgress?.(0, total);
  for (;;) {
    if (isCanceled()) return { ok: false, reason: 'canceled' };
    let block: Awaited<ReturnType<MediaRpc>> & {
      base64: string;
      bytes: number;
      eof: boolean;
      size: number;
      mtimeMs: number;
    };
    try {
      block = await rpc('fs.readFileRange', {
        path,
        offset,
        length: TRANSFER.chunkBytes,
      });
    } catch (err) {
      return { ok: false, reason: 'io', detail: errMessage(err) };
    }
    if (baseline === null) {
      baseline = { size: block.size, mtimeMs: block.mtimeMs };
      // 首块才知道 fd 视角的真实大小(stat 到首读之间文件可能已被换掉)
      if (block.size > VIEWER_MAX_MEDIA_BYTES) {
        return { ok: false, reason: 'too-large', size: block.size };
      }
      total = block.size;
    } else if (block.size !== baseline.size || block.mtimeMs !== baseline.mtimeMs) {
      return { ok: false, reason: 'file-changed' };
    }
    if (block.bytes > 0) {
      parts.push(base64ToBytes(block.base64));
      offset += block.bytes;
      deps.onProgress?.(offset, total);
    }
    if (block.eof) break;
    // 防呆:host 既没给字节也没报 eof(不该发生)——不空转
    if (block.bytes === 0) return { ok: false, reason: 'io', detail: 'empty chunk' };
  }
  return { ok: true, blob: new Blob(parts, { type: mime }), size: offset };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
