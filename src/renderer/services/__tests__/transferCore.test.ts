// 远程文件传输 阶段3:transferCore 纯逻辑单测(rpc/bridge 全 mock,不碰真实 HostClient/
// window.okwork)。覆盖设计文档列出的关键路径:全流程/eof/file-changed/取消/rpc reject/
// beginSave 取消(runDownload);offset 推进/对账失败/失败路径 uploadEnd(commit:false)
// 必调(runUpload)。
import { describe, expect, it, vi } from 'vitest';
import { runDownload, runUpload, type TransferBridge, type TransferRpc } from '../transferCore';

function b64(bytes: number): string {
  return Buffer.alloc(bytes, 'x').toString('base64');
}

describe('runDownload', () => {
  it('全流程:多块读取 → 本机盘落地,进度/offset 正确推进,commit:true 收尾', async () => {
    const chunk1 = b64(5);
    const chunk2 = b64(3);
    const rpc = vi.fn(async (method: string, params: unknown) => {
      expect(method).toBe('fs.readFileRange');
      const { offset } = params as { offset: number };
      if (offset === 0) {
        return { base64: chunk1, bytes: 5, eof: false, size: 8, mtimeMs: 1000 };
      }
      expect(offset).toBe(5);
      return { base64: chunk2, bytes: 3, eof: true, size: 8, mtimeMs: 1000 };
    }) as unknown as TransferRpc;

    const writes: { offset: number; base64: string }[] = [];
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 'wtk-1', name: 'a.bin' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(async (p) => {
        writes.push({ offset: p.offset, base64: p.base64 });
        return { written: p.base64.length };
      }),
      read: vi.fn(),
      finish: vi.fn(async (p) => (p.commit ? { path: '/local/a.bin' } : { path: null })),
    };

    const progress: number[] = [];
    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a.bin',
      name: 'a.bin',
      size: 8,
      onProgress: (n) => progress.push(n),
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: true, localPath: '/local/a.bin' });
    expect(writes).toEqual([
      { offset: 0, base64: chunk1 },
      { offset: 5, base64: chunk2 },
    ]);
    expect(progress).toEqual([5, 8]);
    expect(bridge.finish).toHaveBeenCalledTimes(1);
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'wtk-1', commit: true });
  });

  it('eof 终止:单块即 eof=true 时循环立即结束,不再多发一次 readFileRange', async () => {
    const rpc = vi.fn(async () => ({
      base64: b64(4),
      bytes: 4,
      eof: true,
      size: 4,
      mtimeMs: 1,
    })) as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 't', name: 'a' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(async () => ({ written: 4 })),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: '/local/a' })),
    };

    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 4,
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: true, localPath: '/local/a' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('mtimeMs 在传输期间变化 → file-changed,且 finish(commit:false) 必调', async () => {
    let call = 0;
    const rpc = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { base64: b64(2), bytes: 2, eof: false, size: 10, mtimeMs: 1000 };
      }
      // 第二块 mtimeMs 变了(文件被改写)
      return { base64: b64(2), bytes: 2, eof: false, size: 10, mtimeMs: 2000 };
    }) as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 'wtk', name: 'a' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(async () => ({ written: 2 })),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: null })),
    };

    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 10,
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'file-changed' });
    expect(bridge.finish).toHaveBeenCalledTimes(1);
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'wtk', commit: false });
  });

  it('取消在块边界生效:第一块写完后 isCanceled 转 true → 不再发第二块,finish(commit:false)', async () => {
    const rpc = vi.fn(async () => ({
      base64: b64(2),
      bytes: 2,
      eof: false,
      size: 100,
      mtimeMs: 1,
    })) as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 'wtk', name: 'a' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(async () => ({ written: 2 })),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: null })),
    };

    let canceled = false;
    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 100,
      onProgress: () => {
        canceled = true; // 第一块写完(onProgress 触发)后置位,下一次块边界检查即命中
      },
      isCanceled: () => canceled,
    });

    expect(res).toEqual({ ok: false, reason: 'canceled' });
    expect(rpc).toHaveBeenCalledTimes(1); // 只发了第一块
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'wtk', commit: false });
  });

  it('rpc reject(链路断)→ link-lost,finally 保证 finish(commit:false) 必调', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('host connection lost');
    }) as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 'wtk', name: 'a' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: null })),
    };

    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 10,
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'link-lost', detail: 'host connection lost' });
    expect(bridge.finish).toHaveBeenCalledTimes(1);
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'wtk', commit: false });
  });

  it('rpc reject(业务错误,非链路文案)→ remote-io', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('not a regular file');
    }) as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 'wtk', name: 'a' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: null })),
    };

    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 10,
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'remote-io', detail: 'not a regular file' });
  });

  it('beginSave 返回 null(用户取消保存对话框)→ canceled,零 RPC 副作用', async () => {
    const rpc = vi.fn() as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => null),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(),
      finish: vi.fn(),
    };

    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 10,
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'canceled' });
    expect(rpc).not.toHaveBeenCalled();
    expect(bridge.write).not.toHaveBeenCalled();
    expect(bridge.finish).not.toHaveBeenCalled();
  });

  it('bridge.write 失败(本机盘 IO 错误)→ local-io,finish(commit:false) 必调', async () => {
    const rpc = vi.fn(async () => ({
      base64: b64(2),
      bytes: 2,
      eof: true,
      size: 2,
      mtimeMs: 1,
    })) as unknown as TransferRpc;
    const bridge: TransferBridge = {
      beginSave: vi.fn(async () => ({ ticket: 'wtk', name: 'a' })),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(async () => {
        throw new Error('ENOSPC');
      }),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: null })),
    };

    const res = await runDownload({
      rpc,
      bridge,
      path: '/remote/a',
      name: 'a',
      size: 2,
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'local-io', detail: 'ENOSPC' });
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'wtk', commit: false });
  });
});

describe('runUpload', () => {
  it('offset 严格推进:begin → 两块 read/uploadChunk → uploadEnd(commit:true),读票 finish(commit:false) 释放', async () => {
    const chunk1 = b64(4);
    const chunk2 = b64(2);
    let readCall = 0;
    const bridge: TransferBridge = {
      beginSave: vi.fn(),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(async (p) => {
        readCall += 1;
        if (readCall === 1) {
          expect(p.offset).toBe(0);
          return { base64: chunk1, bytes: 4, eof: false, size: 6, mtimeMs: 500 };
        }
        expect(p.offset).toBe(4);
        return { base64: chunk2, bytes: 2, eof: true, size: 6, mtimeMs: 500 };
      }),
      finish: vi.fn(async () => ({ path: null })),
    };

    const chunkCalls: { offset: number; base64: string }[] = [];
    const rpc = vi.fn(async (method: string, params: unknown) => {
      if (method === 'fs.uploadBegin') return { transferId: 'up-1' };
      if (method === 'fs.uploadChunk') {
        const p = params as { transferId: string; offset: number; base64: string };
        chunkCalls.push({ offset: p.offset, base64: p.base64 });
        expect(p.transferId).toBe('up-1');
        return { received: p.offset + Buffer.from(p.base64, 'base64').length };
      }
      if (method === 'fs.uploadEnd') {
        const p = params as { transferId: string; commit: boolean };
        expect(p.transferId).toBe('up-1');
        expect(p.commit).toBe(true);
        return { path: '/remote/dir/a.bin' };
      }
      throw new Error(`unexpected method ${method}`);
    }) as unknown as TransferRpc;

    const progress: number[] = [];
    const res = await runUpload({
      rpc,
      bridge,
      destDir: '/remote/dir',
      file: { ticket: 'rtk-1', name: 'a.bin', size: 6 },
      onProgress: (n) => progress.push(n),
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: true, remotePath: '/remote/dir/a.bin' });
    expect(chunkCalls).toEqual([
      { offset: 0, base64: chunk1 },
      { offset: 4, base64: chunk2 },
    ]);
    expect(progress).toEqual([4, 6]);
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'rtk-1', commit: false });
  });

  it('received 对账失败(乱序/丢块)→ offset-mismatch 立即停,uploadEnd(commit:false) 必调', async () => {
    const bridge: TransferBridge = {
      beginSave: vi.fn(),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(async () => ({
        base64: b64(4),
        bytes: 4,
        eof: false,
        size: 10,
        mtimeMs: 1,
      })),
      finish: vi.fn(async () => ({ path: null })),
    };

    const rpc = vi.fn(async (method: string) => {
      if (method === 'fs.uploadBegin') return { transferId: 'up-2' };
      if (method === 'fs.uploadChunk') return { received: 999 }; // 对不上 offset+bytes
      if (method === 'fs.uploadEnd') return { path: null };
      throw new Error('unexpected');
    }) as unknown as TransferRpc;

    const res = await runUpload({
      rpc,
      bridge,
      destDir: '/remote/dir',
      file: { ticket: 'rtk', name: 'a', size: 10 },
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'offset-mismatch' });
    expect(rpc).toHaveBeenCalledWith('fs.uploadEnd', { transferId: 'up-2', commit: false });
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'rtk', commit: false });
  });

  it('失败路径(链路断在 uploadChunk):link-lost,uploadEnd(commit:false) + bridge.finish(commit:false) 均必调', async () => {
    const bridge: TransferBridge = {
      beginSave: vi.fn(),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(async () => ({
        base64: b64(4),
        bytes: 4,
        eof: false,
        size: 10,
        mtimeMs: 1,
      })),
      finish: vi.fn(async () => ({ path: null })),
    };

    const rpc = vi.fn(async (method: string) => {
      if (method === 'fs.uploadBegin') return { transferId: 'up-3' };
      if (method === 'fs.uploadChunk') throw new Error('rpc timeout: fs.uploadChunk');
      throw new Error('should not reach uploadEnd success path check');
    }) as unknown as TransferRpc;

    const res = await runUpload({
      rpc,
      bridge,
      destDir: '/remote/dir',
      file: { ticket: 'rtk', name: 'a', size: 10 },
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({
      ok: false,
      reason: 'link-lost',
      detail: 'rpc timeout: fs.uploadChunk',
    });
    expect(rpc).toHaveBeenCalledWith('fs.uploadEnd', { transferId: 'up-3', commit: false });
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'rtk', commit: false });
  });

  it('uploadBegin 本身失败:不发 uploadEnd(无 transferId),仍释放读票 finish(commit:false)', async () => {
    const bridge: TransferBridge = {
      beginSave: vi.fn(),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(),
      finish: vi.fn(async () => ({ path: null })),
    };
    const rpc = vi.fn(async () => {
      throw new Error('too many concurrent uploads (max 4)');
    }) as unknown as TransferRpc;

    const res = await runUpload({
      rpc,
      bridge,
      destDir: '/remote/dir',
      file: { ticket: 'rtk', name: 'a', size: 10 },
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({
      ok: false,
      reason: 'remote-io',
      detail: 'too many concurrent uploads (max 4)',
    });
    expect(rpc).toHaveBeenCalledTimes(1); // 只有 uploadBegin 这一发
    expect(bridge.finish).toHaveBeenCalledWith({ ticket: 'rtk', commit: false });
  });

  it('file-changed:第二块 read 的 mtimeMs 与首块基线不等 → 中止,uploadEnd(commit:false) 必调', async () => {
    let call = 0;
    const bridge: TransferBridge = {
      beginSave: vi.fn(),
      beginOpen: vi.fn(async () => []),
      write: vi.fn(),
      read: vi.fn(async () => {
        call += 1;
        if (call === 1) return { base64: b64(2), bytes: 2, eof: false, size: 10, mtimeMs: 100 };
        return { base64: b64(2), bytes: 2, eof: false, size: 10, mtimeMs: 200 };
      }),
      finish: vi.fn(async () => ({ path: null })),
    };
    const rpc = vi.fn(async (method: string) => {
      if (method === 'fs.uploadBegin') return { transferId: 'up-4' };
      if (method === 'fs.uploadChunk') return { received: 2 };
      if (method === 'fs.uploadEnd') return { path: null };
      throw new Error('unexpected');
    }) as unknown as TransferRpc;

    const res = await runUpload({
      rpc,
      bridge,
      destDir: '/remote/dir',
      file: { ticket: 'rtk', name: 'a', size: 10 },
      onProgress: () => {},
      isCanceled: () => false,
    });

    expect(res).toEqual({ ok: false, reason: 'file-changed' });
    expect(rpc).toHaveBeenCalledWith('fs.uploadEnd', { transferId: 'up-4', commit: false });
  });
});
