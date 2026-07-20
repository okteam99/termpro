// WatchService 手工有界模式(2026-07-20 远程 host 卡死事故):Linux 无原生递归
// inotify,Node JS 兜底每事件全树重扫会饿死事件循环——手工实现改为 root+子目录
// 各挂非递归 watcher,预算/深度封顶,新建子目录增量补挂,事件只发去抖信号。
// forceManual 注入让本套测试在任意平台都走手工路径。
//
// 平台注记:手工模式生产上只在 linux 启用(inotify)。macOS 的非递归 fs.watch 走
// FSEvents,嵌套多 watcher 有事件漏发/深层穿透怪癖 → 三个细粒度用例仅在 linux 跑
// (CI=ubuntu 全覆盖;okwork-node 容器实测 7/7 PASS 2026-07-20),本地跑基础组。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HostMessage } from '../../shared/protocol';
import { WatchService } from '../watchService';

let root: string;
let svc: WatchService;
let events: HostMessage[];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForEvent(count: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (events.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${count} events, got ${events.length}`);
    }
    await sleep(50);
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-watch-'));
  fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  events = [];
  svc = new WatchService((m) => events.push(m), { forceManual: true });
});

afterEach(() => {
  svc.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('WatchService manual bounded mode', () => {
  it('根目录变化 → 去抖后收到 fs:changed', async () => {
    const id = svc.watch(root);
    fs.writeFileSync(path.join(root, 'a.txt'), 'x');
    await waitForEvent(1);
    expect(events[0]).toEqual({ t: 'fs:changed', watchId: id });
  });

  it('已存在子目录内的变化也有信号', async () => {
    const id = svc.watch(root);
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'b.txt'), 'x');
    await waitForEvent(1);
    expect(events[0]).toEqual({ t: 'fs:changed', watchId: id });
  });

  it.runIf(process.platform === 'linux')(
    'watch 后新建的子目录会被增量补挂:其内部变化有信号',
    async () => {
    svc.watch(root);
    fs.mkdirSync(path.join(root, 'later'));
    await waitForEvent(1); // 目录创建本身的信号(也给异步补挂留时间)
    await sleep(200);
    events.length = 0;
    fs.writeFileSync(path.join(root, 'later', 'c.txt'), 'x');
    await waitForEvent(1);
    },
  );

  it.runIf(process.platform === 'linux')(
    'node_modules 不建 watcher:内部变化无信号,预算不被吃掉',
    async () => {
    svc.watch(root);
    await sleep(100);
    events.length = 0;
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'x.js'), 'x');
    await sleep(700); // > 去抖窗口,确认静默
    expect(events).toEqual([]);
    },
  );

  it.runIf(process.platform === 'linux')('预算封顶不炸:超出预算后根目录信号仍工作', async () => {
    const tight = new WatchService((m) => events.push(m), {
      forceManual: true,
      maxDirs: 2, // root + sub,deep/node_modules 超预算
    });
    try {
      const id = tight.watch(root);
      fs.writeFileSync(path.join(root, 'top.txt'), 'x');
      await waitForEvent(1);
      expect(events[0]).toEqual({ t: 'fs:changed', watchId: id });
    } finally {
      tight.dispose();
    }
  });

  it('unwatch 后不再有信号', async () => {
    const id = svc.watch(root);
    svc.unwatch(id);
    fs.writeFileSync(path.join(root, 'd.txt'), 'x');
    await sleep(600);
    expect(events).toEqual([]);
  });
});
