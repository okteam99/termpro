// 远程文件传输 阶段3:transferManager 单测。用 createTransferManager() 构造隔离实例,
// 注入 fake bridge/runDownload/runUpload——不碰真实 window.okwork,也不依赖真实
// runDownload/runUpload 的分块循环(那部分由 transferCore.test.ts 单独覆盖)。
// 覆盖:串行队列(并发1)、isBusy、跨 workspace list() 过滤 + 终态自清、cancel 排队/运行
// 两态、subscribe 通知。
import { describe, expect, it, vi } from 'vitest';
import { createTransferManager } from '../transferManager';
import type { TransferBridge } from '../transferCore';
import type { HostClient } from '../hostClient';

function fakeClient(overrides?: Partial<HostClient>): HostClient {
  return {
    rpc: vi.fn(async (method: string) => {
      if (method === 'fs.stat') return { kind: 'file', size: 100, mtimeMs: 1 };
      return {};
    }),
    ...overrides,
  } as unknown as HostClient;
}

function fakeBridge(overrides?: Partial<TransferBridge>): TransferBridge {
  return {
    beginSave: vi.fn(async () => ({ ticket: 'wtk', name: 'a' })),
    beginOpen: vi.fn(async () => []),
    write: vi.fn(async () => ({ written: 0 })),
    read: vi.fn(async () => ({ base64: '', bytes: 0, eof: true, size: 0, mtimeMs: 0 })),
    finish: vi.fn(async () => ({ path: null })),
    ...overrides,
  };
}

/** 挂起的 deferred:让测试精确控制某次传输何时"完成",以此观察队列的串行时序。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('transferManager: 串行队列(并发1)', () => {
  it('两个 download 先后入队,第二个的 job 在第一个落定前不会开跑', async () => {
    const d1 = deferred<{ ok: true; localPath: string }>();
    const started: string[] = [];
    const runDownload = vi.fn((deps: { path: string }) => {
      started.push(deps.path);
      return deps.path === '/a' ? d1.promise : Promise.resolve({ ok: true, localPath: '/b-local' });
    });

    const manager = createTransferManager({
      bridge: fakeBridge(),
      runDownload: runDownload as never,
    });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/b', name: 'b', size: 10 });

    // 两次 download() 都已 resolve(入队即返回,不等运行完成),但第二个任务还没开跑
    expect(started).toEqual(['/a']);

    d1.resolve({ ok: true, localPath: '/a-local' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(['/a', '/b']);
  });
});

describe('transferManager: isBusy', () => {
  it('同 hostId+remotePath+direction 且非终态 → true;不同 direction/终态后 → false', async () => {
    const d1 = deferred<{ ok: true; localPath: string }>();
    const runDownload = vi.fn(() => d1.promise);
    const manager = createTransferManager({ bridge: fakeBridge(), runDownload: runDownload as never });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/f', name: 'f', size: 10 });

    expect(manager.isBusy('h1', '/f', 'download')).toBe(true);
    expect(manager.isBusy('h1', '/f', 'upload')).toBe(false); // 方向不同
    expect(manager.isBusy('h1', '/other', 'download')).toBe(false); // 路径不同
    expect(manager.isBusy('h2', '/f', 'download')).toBe(false); // host 不同

    d1.resolve({ ok: true, localPath: '/local/f' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.isBusy('h1', '/f', 'download')).toBe(false); // 已终态
  });
});

describe('transferManager: list() 跨 workspace 过滤 + 纯读 + 终态 TTL 自清', () => {
  it('只返回本 workspace 的条目;同一 revision 内多次调用返回同一个数组引用', async () => {
    // 🔴 useSyncExternalStore 契约:getSnapshot(= list())在一次渲染里会被 React 调用多次,
    // 必须每次都拿到同一个引用,否则 Object.is 判"变了"→ 强制重渲染 → 死循环(实测复现过
    // 「Maximum update depth exceeded」,故有此专项断言,不只测内容,也测引用稳定性)。
    const manager = createTransferManager({
      bridge: fakeBridge(),
      runDownload: vi.fn(async () => ({ ok: true, localPath: '/local/a' })) as never,
    });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
    await manager.download({ client, workspaceId: 'ws2', hostId: 'h1', path: '/x', name: 'x', size: 10 });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const ws1List1 = manager.list('ws1');
    expect(ws1List1).toHaveLength(1);
    expect(ws1List1[0].name).toBe('a');
    expect(ws1List1[0].state).toBe('done');

    // ws2 的条目不出现在 ws1 的 list() 里
    expect(manager.list('ws2')).toHaveLength(1);

    // 同一 revision 内(没有新的 notify())再次 list('ws1')→ 必须是同一个数组引用
    const ws1List2 = manager.list('ws1');
    expect(ws1List2).toBe(ws1List1);
  });

  it('终态项 TTL 到期后自动摘除(+ notify()),不是靠"被 list() 读过一次"摘除', async () => {
    vi.useFakeTimers();
    try {
      const manager = createTransferManager({
        bridge: fakeBridge(),
        runDownload: vi.fn(async () => ({ ok: true, localPath: '/local/a' })) as never,
      });
      const client = fakeClient();
      const cb = vi.fn();
      manager.subscribe(cb);

      await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
      await vi.advanceTimersByTimeAsync(0); // 让 runDownload 的微任务链落定为 done

      expect(manager.list('ws1')).toHaveLength(1);
      // 反复读多次也不提前清除(纯读,无副作用)
      expect(manager.list('ws1')).toHaveLength(1);
      expect(manager.list('ws1')).toHaveLength(1);

      cb.mockClear();
      await vi.advanceTimersByTimeAsync(10_000); // 越过 TTL

      expect(cb).toHaveBeenCalled(); // TTL 摘除也走 notify(),订阅方能感知
      expect(manager.list('ws1')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('非终态条目(queued/running)恒出现,不受 TTL 影响', async () => {
    const d1 = deferred<{ ok: true; localPath: string }>();
    const manager = createTransferManager({
      bridge: fakeBridge(),
      runDownload: vi.fn(() => d1.promise) as never,
    });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });

    expect(manager.list('ws1')).toHaveLength(1);
    expect(manager.list('ws1')).toHaveLength(1); // 第二次仍在(未终态)
    expect(manager.list('ws1')[0].state).toBe('running');
  });
});

describe('transferManager: cancel', () => {
  it('排队中的条目:cancel 直接标 canceled 并出队,不会被跑到', async () => {
    const d1 = deferred<{ ok: true; localPath: string }>();
    const runB = vi.fn(async () => ({ ok: true, localPath: '/b' }));
    const runDownload = vi.fn((deps: { path: string }) =>
      deps.path === '/a' ? d1.promise : runB(),
    );
    const manager = createTransferManager({ bridge: fakeBridge(), runDownload: runDownload as never });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/b', name: 'b', size: 10 });

    const items = manager.list('ws1');
    const queuedItem = items.find((it) => it.name === 'b')!;
    expect(queuedItem.state).toBe('queued');

    manager.cancel(queuedItem.id);
    expect(manager.list('ws1').find((it) => it.id === queuedItem.id)?.state).toBe('canceled');

    // 释放第一个任务,让队列继续推进——b 的 job 不应被执行(已出队)
    d1.resolve({ ok: true, localPath: '/a' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runB).not.toHaveBeenCalled();
  });

  it('运行中的条目:cancel 置 canceling,isCanceled() 闭包在块边界读到后落定为 canceled', async () => {
    let isCanceledFn: (() => boolean) | null = null;
    const runDownload = vi.fn(
      (deps: { isCanceled: () => boolean }) =>
        new Promise((resolve) => {
          isCanceledFn = deps.isCanceled;
          // 模拟运行中,直到外部通过 isCanceled() 观察到取消再落定
          const check = () => {
            if (deps.isCanceled()) {
              resolve({ ok: false, reason: 'canceled' });
            } else {
              setTimeout(check, 1);
            }
          };
          check();
        }),
    );
    const manager = createTransferManager({ bridge: fakeBridge(), runDownload: runDownload as never });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
    await Promise.resolve();

    const running = manager.list('ws1')[0];
    expect(running.state).toBe('running');
    expect(isCanceledFn).not.toBeNull();
    expect(isCanceledFn!()).toBe(false);

    manager.cancel(running.id);
    expect(manager.list('ws1').find((it) => it.id === running.id)?.state).toBe('canceling');
    expect(isCanceledFn!()).toBe(true);

    // 等待运行中的 promise 落定
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.list('ws1').find((it) => it.id === running.id)?.state).toBe('canceled');
  });
});

describe('transferManager: subscribe', () => {
  it('入队/状态变化都触发通知', async () => {
    // 🔴 用 deferred(而非立即 resolve 的 mock):立即 resolve 的 job 会在同一批微任务里
    // 把 queued→running→done 全跑完,`await manager.download()` 落定时三次 notify 都
    // 已发生,"入队后但未完成"这一中间态就观察不到——deferred 卡住 running 阶段,
    // 才能在此处断言"完成前"与"完成后"的调用次数确有差别。
    const d = deferred<{ ok: true; localPath: string }>();
    const manager = createTransferManager({
      bridge: fakeBridge(),
      runDownload: vi.fn(() => d.promise) as never,
    });
    const cb = vi.fn();
    const unsubscribe = manager.subscribe(cb);
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
    expect(cb).toHaveBeenCalled();
    expect(manager.list('ws1')[0].state).toBe('running'); // job 卡在 deferred,尚未落定

    const callsAfterEnqueue = cb.mock.calls.length;
    d.resolve({ ok: true, localPath: '/a-local' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(cb.mock.calls.length).toBeGreaterThan(callsAfterEnqueue); // done 落定也触发一次

    unsubscribe();
    cb.mockClear();
    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/b', name: 'b', size: 10 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('onFinal 精确通知一次(不因批量上传逐文件出现在 list() 而重复触发)', async () => {
    const manager = createTransferManager({
      bridge: fakeBridge({
        beginOpen: vi.fn(async () => [
          { ticket: 't1', name: 'f1', size: 10, path: '/local/f1' },
          { ticket: 't2', name: 'f2', size: 10, path: '/local/f2' },
        ]),
      }),
      runUpload: vi.fn(async (deps: { file: { name: string } }) => ({
        ok: true,
        remotePath: `/remote/${deps.file.name}`,
      })) as never,
    });
    const client = fakeClient();
    const finals: string[] = [];
    manager.onFinal((item) => finals.push(`${item.name}:${item.state}`));

    await manager.upload({ client, workspaceId: 'ws1', hostId: 'h1', destDir: '/remote' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(finals).toEqual(['f1:done', 'f2:done']);
  });
});

describe('transferManager: download 前置校验', () => {
  it('fs.stat kind !== file → 记一条 failed(too-large 类目复用),不进运行队列', async () => {
    const client = fakeClient({
      rpc: vi.fn(async () => ({ kind: 'dir' })) as unknown as HostClient['rpc'],
    });
    const runDownload = vi.fn();
    const manager = createTransferManager({ bridge: fakeBridge(), runDownload: runDownload as never });

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/d', name: 'd', size: 10 });

    expect(runDownload).not.toHaveBeenCalled();
    const items = manager.list('ws1');
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('failed');
    expect(items[0].error).toBe('too-large');
  });
});

// P1-1:取消排队中的 upload 永久泄漏本机读票(8 槽配额锁死)。upload() 在 beginOpen
// 时就已为每个选中文件开好读票;若条目还在 queued 就被 cancel,从没跑到 runUpload
// 的 finally 去释放那张票——票据要等 30min idleTtl 才被 main 侧 sweepIdle 回收。
describe('transferManager: cancel 排队中的 upload → 释放已开的本机读票(P1-1)', () => {
  it('cancel 一个还在 queued 的 upload 条目 → job.dispose() 触发 bridge.finish(ticket, commit:false)', async () => {
    const dRunning = deferred<{ ok: true; remotePath: string }>();
    const finish = vi.fn(async (p: { ticket: string; commit: boolean }) => ({ path: null }));
    const manager = createTransferManager({
      bridge: fakeBridge({
        beginOpen: vi.fn(async () => [
          { ticket: 't-a', name: 'a', size: 10, path: '/local/a' },
          { ticket: 't-b', name: 'b', size: 10, path: '/local/b' },
        ]),
        finish,
      }),
      runUpload: vi.fn((deps: { file: { name: string } }) =>
        deps.file.name === 'a' ? dRunning.promise : Promise.resolve({ ok: true, remotePath: '/remote/b' }),
      ) as never,
    });
    const client = fakeClient();

    await manager.upload({ client, workspaceId: 'ws1', hostId: 'h1', destDir: '/remote' });
    finish.mockClear(); // 只关心 cancel 触发的那一次 finish 调用

    const items = manager.list('ws1');
    const runningItem = items.find((it) => it.name === 'a')!;
    const queuedItem = items.find((it) => it.name === 'b')!;
    expect(runningItem.state).toBe('running'); // 串行队列:a 先跑,卡在 deferred
    expect(queuedItem.state).toBe('queued'); // b 还没轮到

    manager.cancel(queuedItem.id);

    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({ ticket: 't-b', commit: false });
    expect(manager.list('ws1').find((it) => it.id === queuedItem.id)?.state).toBe('canceled');

    dRunning.resolve({ ok: true, remotePath: '/remote/a' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('cancel 排队中的 download 条目(job 无 dispose)→ 照常取消,不因缺 dispose 而报错', async () => {
    // 回归防护:Job.dispose 是可选字段,download 的 job 从不设置它——cancel 的
    // disposeJob() 必须能安全处理"job 存在但没有 dispose"这种情况。
    const d1 = deferred<{ ok: true; localPath: string }>();
    const runB = vi.fn(async () => ({ ok: true, localPath: '/b' }));
    const runDownload = vi.fn((deps: { path: string }) =>
      deps.path === '/a' ? d1.promise : runB(),
    );
    const manager = createTransferManager({ bridge: fakeBridge(), runDownload: runDownload as never });
    const client = fakeClient();

    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/a', name: 'a', size: 10 });
    await manager.download({ client, workspaceId: 'ws1', hostId: 'h1', path: '/b', name: 'b', size: 10 });

    const queuedItem = manager.list('ws1').find((it) => it.name === 'b')!;
    expect(() => manager.cancel(queuedItem.id)).not.toThrow();
    expect(manager.list('ws1').find((it) => it.id === queuedItem.id)?.state).toBe('canceled');

    d1.resolve({ ok: true, localPath: '/a' });
    await Promise.resolve();
    await Promise.resolve();
  });
});

// P1-2:beginOpen() 拒绝(main 侧多选中途失败/配额回滚后重抛)静默无反应——用户点了
// 上传按钮却什么都没发生。修法:transferManager.upload() 把 reject 转成一条可见的
// failed 终态(走 onFinal/showHint 的既有管线),不让异常穿透出 upload() 本身。
describe('transferManager: upload 的 bridge.beginOpen() 失败(P1-2)', () => {
  it('beginOpen() reject → upload() 本身 resolve(不外抛),记一条可见的 failed 终态', async () => {
    const manager = createTransferManager({
      bridge: fakeBridge({
        beginOpen: vi.fn(async () => {
          throw new Error('too many local transfer tickets (max 8)');
        }),
      }),
    });
    const client = fakeClient();
    const finals: string[] = [];
    manager.onFinal((item) => finals.push(`${item.name}:${item.state}:${item.error}`));

    await expect(
      manager.upload({ client, workspaceId: 'ws1', hostId: 'h1', destDir: '/remote/dir' }),
    ).resolves.toBeUndefined();

    const items = manager.list('ws1');
    expect(items).toHaveLength(1);
    expect(items[0].direction).toBe('upload');
    expect(items[0].state).toBe('failed');
    expect(items[0].error).toBe('local-io');
    expect(finals).toEqual(['dir:failed:local-io']); // onFinal 精确触发一次,showHint 有得说
  });
});
