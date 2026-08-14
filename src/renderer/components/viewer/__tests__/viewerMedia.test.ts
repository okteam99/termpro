// @vitest-environment jsdom
// 查看器媒体加载(用户指令 2026-08-14:内置视频 + 上限 100M):分块拼装 / 100MB 闸门 /
// TOCTOU 基线 / 取消 / 老 host 回落单条 readFileBinary。零组件依赖,直喂 fake rpc。
import { describe, expect, it, vi } from 'vitest';
import {
  VIEWER_MAX_MEDIA_BYTES,
  base64ToBytes,
  loadMediaBlob,
  videoMime,
} from '../viewerMedia';
import { TRANSFER } from '../../../../shared/protocol';

const MIME = 'video/mp4';

/** 分段拼(512KiB 一次性 spread 进 fromCharCode 会爆栈——是测试辅助的问题,不是被测代码) */
function b64(bytes: number[]): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return btoa(bin);
}

/** 造一个按 chunkBytes 分块回放 body 的 fake host */
function fakeRangeHost(body: number[], over?: { size?: number; mtimeMs?: (call: number) => number }) {
  let call = 0;
  const size = over?.size ?? body.length;
  return vi.fn(async (method: string, params: Record<string, number>) => {
    if (method === 'fs.stat') return { kind: 'file', size, mtimeMs: 1 };
    if (method === 'fs.readFileRange') {
      call += 1;
      const offset = params.offset as number;
      const slice = body.slice(offset, offset + TRANSFER.chunkBytes);
      return {
        base64: b64(slice),
        bytes: slice.length,
        eof: offset + slice.length >= body.length,
        size,
        mtimeMs: over?.mtimeMs ? over.mtimeMs(call) : 1,
      };
    }
    throw new Error(`unexpected rpc ${method}`);
  });
}

describe('videoMime(能真播的容器才认)', () => {
  it('mp4/m4v/mov/webm/ogv 认;mkv/avi/txt 不认', () => {
    expect(videoMime('/a/1.mp4')).toBe('video/mp4');
    expect(videoMime('/a/1.M4V')).toBe('video/mp4');
    expect(videoMime('/a/1.mov')).toBe('video/quicktime');
    expect(videoMime('/a/1.webm')).toBe('video/webm');
    expect(videoMime('/a/1.ogv')).toBe('video/ogg');
    expect(videoMime('/a/1.mkv')).toBeNull();
    expect(videoMime('/a/1.avi')).toBeNull();
    expect(videoMime('/a/notes.txt')).toBeNull();
  });
});

describe('base64ToBytes', () => {
  it('还原原始字节(含 0x00 与高位字节)', () => {
    expect([...base64ToBytes(b64([0, 1, 254, 255]))]).toEqual([0, 1, 254, 255]);
  });
});

describe('loadMediaBlob · 分块路径', () => {
  it('按块拼回完整内容,进度回调收敛到总大小', async () => {
    const body = Array.from({ length: 1000 }, (_, i) => i % 256);
    const rpc = fakeRangeHost(body);
    const progress: number[] = [];
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: true,
      path: '/v/1.mp4',
      mime: MIME,
      onProgress: (done) => progress.push(done),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.size).toBe(1000);
    expect(res.blob.type).toBe(MIME);
    expect([...new Uint8Array(await res.blob.arrayBuffer())]).toEqual(body);
    expect(progress.at(-1)).toBe(1000);
  });

  it('超 100MB → too-large,一个字节都不读', async () => {
    const rpc = fakeRangeHost([1, 2, 3], { size: VIEWER_MAX_MEDIA_BYTES + 1 });
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: true,
      path: '/v/big.mp4',
      mime: MIME,
    });
    expect(res).toMatchObject({ ok: false, reason: 'too-large' });
    expect(rpc).toHaveBeenCalledTimes(1); // 只 stat,没走 readFileRange
  });

  it('读取途中 mtime 变了 → file-changed(不把新旧内容拼一起)', async () => {
    const body = Array.from({ length: TRANSFER.chunkBytes + 10 }, () => 7);
    const rpc = fakeRangeHost(body, { mtimeMs: (call) => (call === 1 ? 1 : 2) });
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: true,
      path: '/v/1.mp4',
      mime: MIME,
    });
    expect(res).toMatchObject({ ok: false, reason: 'file-changed' });
  });

  it('取消在块边界生效', async () => {
    const body = Array.from({ length: TRANSFER.chunkBytes * 3 }, () => 1);
    const rpc = fakeRangeHost(body);
    let canceled = false;
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: true,
      path: '/v/1.mp4',
      mime: MIME,
      onProgress: () => {
        canceled = true; // 第一块读完即取消
      },
      isCanceled: () => canceled,
    });
    expect(res).toMatchObject({ ok: false, reason: 'canceled' });
  });

  it('目标不是普通文件 → not-a-file', async () => {
    const rpc = vi.fn(async () => ({ kind: 'dir' }));
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: true,
      path: '/v',
      mime: MIME,
    });
    expect(res).toMatchObject({ ok: false, reason: 'not-a-file' });
  });

  it('rpc 抛错 → io(带原因)', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('EACCES');
    });
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: true,
      path: '/v/1.mp4',
      mime: MIME,
    });
    expect(res).toMatchObject({ ok: false, reason: 'io', detail: 'EACCES' });
  });
});

describe('loadMediaBlob · 老 host 回落(无 fs.transfer 能力位)', () => {
  it('走单条 readFileBinary', async () => {
    const rpc = vi.fn(async () => ({ base64: b64([9, 8, 7]), size: 3 }));
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: false,
      path: '/v/1.mp4',
      mime: MIME,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect([...new Uint8Array(await res.blob.arrayBuffer())]).toEqual([9, 8, 7]);
  });

  it('老 host 的 20MB 上限(base64=null)→ too-large', async () => {
    const rpc = vi.fn(async () => ({ base64: null, size: 30 * 1024 * 1024 }));
    const res = await loadMediaBlob({
      rpc: rpc as never,
      supportsTransfer: false,
      path: '/v/1.mp4',
      mime: MIME,
    });
    expect(res).toMatchObject({ ok: false, reason: 'too-large' });
  });
});
