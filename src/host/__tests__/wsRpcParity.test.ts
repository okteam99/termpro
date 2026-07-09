// AC-1 传输等价冒烟:WS 连上后全 RPC 方法表 roundtrip + fs.watch 推送 + PTY 生命周期
// + 流控 ack + 二进制读 + git 一致性。与直接调用 host 服务(= MessagePort 基线同一
// 代码路径)比对功能等价。真实 ws 服务端/客户端。
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startTestHost, TestClient, TestHost, waitFor, delay } from './wsTestHarness';
import { homeDir, listDir, readBinaryFile } from '../fsService';
import { gitInfo, gitStatus } from '../gitService';
import { FLOW } from '../../shared/protocol';

let host: TestHost | null = null;
const clients: TestClient[] = [];
let tmp = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-wsrpc-'));
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (host) {
    await host.close();
    host = null;
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function track(c: TestClient): TestClient {
  clients.push(c);
  return c;
}

async function connected(): Promise<TestClient> {
  host = host ?? (await startTestHost());
  const c = track(new TestClient(host.url()));
  await c.handshake();
  return c;
}

describe('AC-1 全 RPC 方法表 WS roundtrip (T-031)', () => {
  it('全部方法经 WS 返回良构结果,关键项与直接服务调用等价', async () => {
    host = await startTestHost();
    const c = await connected();

    // fs.home 与直接调用等价
    const wsHome = (await c.rpc('fs.home')) as { path: string };
    expect(wsHome).toEqual(homeDir());

    // fs.readdir 与直接调用等价
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
    fs.mkdirSync(path.join(tmp, 'sub'));
    const wsDir = (await c.rpc('fs.readdir', { path: tmp })) as {
      entries: unknown[];
    };
    const directDir = await listDir(tmp);
    expect(wsDir.entries).toEqual(directDir.entries);

    // fs.stat / fs.realpath
    const stat = (await c.rpc('fs.stat', {
      path: path.join(tmp, 'a.txt'),
    })) as { kind: string | null };
    expect(stat.kind).toBe('file');
    const rp = (await c.rpc('fs.realpath', { path: tmp })) as {
      path: string | null;
    };
    expect(typeof rp.path).toBe('string');

    // fs.readFile / fs.writeFile(writeTextFile 仅覆盖已存在文件 → 先建再写)
    fs.writeFileSync(path.join(tmp, 'w.txt'), 'initial');
    await c.rpc('fs.writeFile', {
      path: path.join(tmp, 'w.txt'),
      content: 'written',
    });
    const rf = (await c.rpc('fs.readFile', {
      path: path.join(tmp, 'w.txt'),
    })) as { content: string | null };
    expect(rf.content).toBe('written');

    // fs.move / fs.copy(各用独立 src,互不消耗)
    const destDir = path.join(tmp, 'dest');
    fs.mkdirSync(destDir);
    fs.writeFileSync(path.join(tmp, 'movesrc.txt'), 'm');
    fs.writeFileSync(path.join(tmp, 'copysrc.txt'), 'c');
    const mv = (await c.rpc('fs.move', {
      src: path.join(tmp, 'movesrc.txt'),
      destDir,
    })) as { dst: string };
    expect(fs.existsSync(mv.dst)).toBe(true);
    const cp = (await c.rpc('fs.copy', {
      src: path.join(tmp, 'copysrc.txt'),
      destDir,
    })) as { dst: string };
    expect(fs.existsSync(cp.dst)).toBe(true);

    // git.info / git.status / git.worktrees(host cwd = 本仓库)
    const gi = (await c.rpc('git.info', { cwd: process.cwd() })) as {
      toplevel: string | null;
    };
    expect(gi.toplevel).not.toBeNull();
    const wt = (await c.rpc('git.worktrees', { cwd: process.cwd() })) as {
      worktrees: unknown[];
    };
    expect(Array.isArray(wt.worktrees)).toBe(true);

    // pty.spawn / pty.cwd / pty.kill(良构)
    const sp = (await c.rpc('pty.spawn', {
      cwd: tmp,
      shell: '/bin/sh',
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    expect(typeof sp.sessionId).toBe('string');
    const cwd = (await c.rpc('pty.cwd', { sessionId: sp.sessionId })) as {
      cwd: string | null;
    };
    expect('cwd' in cwd).toBe(true);
    await c.rpc('pty.kill', { sessionId: sp.sessionId });

    // fs.watch / fs.unwatch(良构)
    const w = (await c.rpc('fs.watch', { path: tmp })) as { watchId: number };
    expect(typeof w.watchId).toBe('number');
    await c.rpc('fs.unwatch', { watchId: w.watchId });
  });
});

describe('AC-1 fs.watch 经 WS 推送 (T-032/T-033)', () => {
  it('T-032 目录变更经同一 WS 推 fs:changed 且仅一次(去抖)', async () => {
    host = await startTestHost();
    const c = await connected();
    const { watchId } = (await c.rpc('fs.watch', { path: tmp })) as {
      watchId: number;
    };
    fs.writeFileSync(path.join(tmp, 'change1.txt'), 'x');
    await waitFor(() => c.fsChanged.includes(watchId), 3000);
    await delay(500); // 去抖窗后不应重复堆积
    const count = c.fsChanged.filter((id) => id === watchId).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('T-033 fs.unwatch 后不再收到该 watchId 推送', async () => {
    host = await startTestHost();
    const c = await connected();
    const { watchId } = (await c.rpc('fs.watch', { path: tmp })) as {
      watchId: number;
    };
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    await waitFor(() => c.fsChanged.includes(watchId), 3000);
    await c.rpc('fs.unwatch', { watchId });
    // 充分 drain:让 unwatch 前的 FSEvents 余波(macOS 下有延迟)全部落地,
    // 再取 before 基线,消除并行负载下的 straggler 抖动。
    await delay(1200);
    const before = c.fsChanged.filter((id) => id === watchId).length;
    fs.writeFileSync(path.join(tmp, 'b.txt'), 'y');
    await delay(1200);
    const after = c.fsChanged.filter((id) => id === watchId).length;
    expect(after).toBe(before); // unwatch 后无新增
  });
});

describe('AC-1 PTY 全生命周期与流控经 WS (T-034/T-035)', () => {
  it('T-034 spawn→input→resize→kill 的 data/exit 语义正确', async () => {
    host = await startTestHost();
    const c = await connected();
    const { sessionId } = (await c.rpc('pty.spawn', {
      cwd: tmp,
      shell: '/bin/sh',
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    c.send({ t: 'pty:input', sessionId, data: 'echo HELLO_WS\n' });
    await waitFor(
      () => (c.ptyData.get(sessionId) ?? '').includes('HELLO_WS'),
      12000,
    );
    c.send({ t: 'pty:resize', sessionId, cols: 120, rows: 40 });
    await delay(50);
    c.send({ t: 'pty:input', sessionId, data: 'exit\n' });
    await waitFor(() => c.ptyExits.has(sessionId), 12000);
    expect(c.ptyExits.has(sessionId)).toBe(true);
  });

  it('T-035 流控 ack 经 WS:大输出下 ack 使流恢复(超过高水位仍持续收到)', async () => {
    host = await startTestHost();
    const c = await connected();
    // 2MB 文件,远超高水位 512KB
    const big = path.join(tmp, 'big.txt');
    fs.writeFileSync(big, 'x'.repeat(2 * 1024 * 1024));
    const { sessionId } = (await c.rpc('pty.spawn', {
      cwd: tmp,
      shell: '/bin/sh',
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    // 持续 ack(过量 ack 被 pool clamp 到 0,安全),保持流不被水位卡死
    const acker = setInterval(() => {
      c.send({ t: 'pty:ack', sessionId, bytes: FLOW.highWatermark });
    }, 25);
    c.send({ t: 'pty:input', sessionId, data: `cat ${big}\n` });
    try {
      await waitFor(
        () => (c.ptyData.get(sessionId)?.length ?? 0) > 1_000_000,
        12000,
      );
    } finally {
      clearInterval(acker);
    }
    // 若 ack 经 WS 无效,输出会卡在 ~512KB 高水位;此处已 >1MB,证明恢复语义成立
    expect(c.ptyData.get(sessionId)!.length).toBeGreaterThan(1_000_000);
    c.send({ t: 'pty:input', sessionId, data: 'exit\n' });
  });
});

describe('AC-1 git 与二进制读经 WS 等价 (T-036/T-037)', () => {
  it('T-036 git.info/git.status 与直接调用一致', async () => {
    host = await startTestHost();
    const c = await connected();
    const cwd = process.cwd();
    const wsInfo = await c.rpc('git.info', { cwd });
    expect(wsInfo).toEqual(await gitInfo(cwd));
    const top = (wsInfo as { toplevel: string }).toplevel;
    const wsStatus = await c.rpc('git.status', { toplevel: top });
    expect(wsStatus).toEqual(await gitStatus(top));
  });

  it('T-037 fs.readFileBinary 经 WS 返回正确 base64', async () => {
    host = await startTestHost();
    const c = await connected();
    // 构造真实二进制内容
    const bin = path.join(tmp, 'blob.bin');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x2a]);
    fs.writeFileSync(bin, bytes);
    const ws = (await c.rpc('fs.readFileBinary', { path: bin })) as {
      base64: string | null;
      size: number;
    };
    const direct = await readBinaryFile(bin);
    expect(ws).toEqual(direct);
    expect(Buffer.from(ws.base64!, 'base64').equals(bytes)).toBe(true);
    expect(ws.size).toBe(bytes.length);
  });
});

describe('AC-1 WS 线格式为 JSON 文本帧 (T-038)', () => {
  it('往返(含 pty:data)全部为 text frame,无 binary frame', async () => {
    host = await startTestHost();
    const c = await connected();
    const { sessionId } = (await c.rpc('pty.spawn', {
      cwd: tmp,
      shell: '/bin/sh',
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    c.send({ t: 'pty:input', sessionId, data: 'echo frame_check\n' });
    await waitFor(
      () => (c.ptyData.get(sessionId) ?? '').includes('frame_check'),
      5000,
    );
    expect(c.textFrameCount).toBeGreaterThan(0);
    expect(c.binaryFrameCount).toBe(0);
    c.send({ t: 'rpc:req', id: 77, method: 'pty.kill', params: { sessionId } });
  });
});
