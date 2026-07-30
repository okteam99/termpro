// WatchService 手工有界模式(2026-07-20 远程 host 卡死事故):Linux 无原生递归
// inotify,Node JS 兜底每事件全树重扫会饿死事件循环——手工实现改为 root+子目录
// 各挂非递归 watcher,预算/深度封顶,新建子目录增量补挂,事件只发去抖信号。
// forceManual 注入让本套测试在任意平台都走手工路径。
//
// 平台注记:手工模式生产上**只在 linux 启用**(inotify);macOS/win32 走原生递归
// fs.watch,是另一条代码路径(由 wsRpcParity T-032/T-033 覆盖)。`forceManual: true`
// 纯属测试注入,macOS 上跑它测的是一条生产永不执行的路径。
// 而 macOS 的非递归 fs.watch 走 FSEvents,嵌套多 watcher 有事件漏发/深层穿透怪癖:
// 2026-07-29 v0.3.93 的 Release(build-macos)就栽在「已存在子目录内的变化」上,同
// commit 的 CI(ubuntu)却全绿;本地单跑 8/8 绿、全量套件并行负载下连续触碰 5s 零事件
// —— 是负载相关的漏发,不是竞态,重试也救不回来。
// 故:凡依赖「事件真的送达」的用例一律 linux only(itDelivers),macOS 只留断言「静默」
// 的那条(不依赖投递)。CI=ubuntu 仍 7/7 全覆盖。
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

/** 依赖「事件真的送达」的用例只在 linux 跑(见文件头平台注记)。 */
const itDelivers = it.runIf(process.platform === 'linux');

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
  itDelivers('根目录变化 → 去抖后收到 fs:changed', async () => {
    const id = svc.watch(root);
    fs.writeFileSync(path.join(root, 'a.txt'), 'x');
    await waitForEvent(1);
    expect(events[0]).toEqual({ t: 'fs:changed', watchId: id });
  });

  itDelivers('已存在子目录内的变化也有信号', async () => {
    const id = svc.watch(root);
    fs.writeFileSync(path.join(root, 'sub', 'deep', 'b.txt'), 'x');
    await waitForEvent(1);
    expect(events[0]).toEqual({ t: 'fs:changed', watchId: id });
  });

  itDelivers(
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

  itDelivers(
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

  itDelivers('预算封顶不炸:超出预算后根目录信号仍工作', async () => {
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
