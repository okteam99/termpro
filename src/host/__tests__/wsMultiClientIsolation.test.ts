// AC-6 多客户端隔离:sessionId/watchId 归属、pty.kill/pty.cwd 越权(安全回归门)、
// clean/静默断连只回收自己、并发交错不串扰。真实 ws 双客户端。
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  startTestHost,
  TestClient,
  TestHost,
  waitFor,
  delay,
} from './wsTestHarness';

let host: TestHost | null = null;
const clients: TestClient[] = [];
let tmp = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-iso-'));
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

async function newClient(): Promise<TestClient> {
  const c = track(new TestClient(host!.url()));
  await c.handshake();
  return c;
}

async function spawn(c: TestClient, cwd = tmp): Promise<string> {
  const { sessionId } = (await c.rpc('pty.spawn', {
    cwd,
    shell: '/bin/sh',
    cols: 80,
    rows: 24,
  })) as { sessionId: string };
  return sessionId;
}

describe('AC-6 会话归属越权(控制消息)', () => {
  it('T-039 pty:input 越权被忽略(sessionB 不受影响)', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    const sa = await spawn(a);
    const sb = await spawn(b);
    // A 用 sessionB 发 input → 应被忽略(A 不拥有 sb)
    a.send({ t: 'pty:input', sessionId: sb, data: 'echo PWNED_BY_A\n' });
    // B 自己正常 echo
    b.send({ t: 'pty:input', sessionId: sb, data: 'echo B_OWN\n' });
    await waitFor(() => (b.ptyData.get(sb) ?? '').includes('B_OWN'), 12000);
    await delay(200);
    expect(b.ptyData.get(sb) ?? '').not.toContain('PWNED_BY_A');
    a.send({ t: 'pty:input', sessionId: sa, data: 'exit\n' });
    b.send({ t: 'pty:input', sessionId: sb, data: 'exit\n' });
  });

  it('T-040 pty:resize 越权被忽略(sessionB 仍可用)', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    await spawn(a);
    const sb = await spawn(b);
    // A 用 sessionB 发 resize → 忽略,不崩、B 仍能 echo
    a.send({ t: 'pty:resize', sessionId: sb, cols: 5, rows: 5 });
    b.send({ t: 'pty:input', sessionId: sb, data: 'echo STILL_OK\n' });
    await waitFor(() => (b.ptyData.get(sb) ?? '').includes('STILL_OK'), 12000);
    expect(b.ptyData.get(sb) ?? '').toContain('STILL_OK');
  });
});

describe('AC-6 pty.kill / pty.cwd 越权(安全回归门 T-041 / T-041b)', () => {
  it('T-041 pty.kill RPC 越权被拒绝:A 无法杀死 B 的会话', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    await spawn(a);
    const sb = await spawn(b);
    // A 尝试 kill B 的 sessionB(归属守卫:静默忽略)
    await a.rpc('pty.kill', { sessionId: sb });
    await delay(300);
    // 回归门:sessionB 必须存活(B 未收到 pty:exit,仍可 echo)
    expect(b.ptyExits.has(sb)).toBe(false);
    b.send({ t: 'pty:input', sessionId: sb, data: 'echo B_ALIVE\n' });
    await waitFor(() => (b.ptyData.get(sb) ?? '').includes('B_ALIVE'), 12000);
    expect(b.ptyData.get(sb) ?? '').toContain('B_ALIVE');
  });

  it('T-041b pty.cwd RPC 越权被拒绝:A 读不到 B 的 cwd(返回 null)', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    const distinct = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-bcwd-'));
    await spawn(a);
    const sb = await spawn(b, distinct);
    // A 尝试读 B 的 cwd(归属守卫:返回 null,不泄露 distinct 目录)
    const res = (await a.rpc('pty.cwd', { sessionId: sb })) as {
      cwd: string | null;
    };
    expect(res.cwd).toBeNull();
    fs.rmSync(distinct, { recursive: true, force: true });
  });
});

describe('AC-6 watchId 归属与 fs:changed 路由', () => {
  it('T-042 fs.unwatch 越权:A 动不了 B 的 watcher(B 仍收推送)', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    // A、B 各 watch 同一路径(watchId 各自实例内自增,天然隔离)
    const wa = (await a.rpc('fs.watch', { path: tmp })) as { watchId: number };
    const wb = (await b.rpc('fs.watch', { path: tmp })) as { watchId: number };
    // A 用 B 的 watchId 调 unwatch(作用在 A 自己的 WatchService,动不到 B)
    await a.rpc('fs.unwatch', { watchId: wb.watchId });
    await delay(100);
    fs.writeFileSync(path.join(tmp, 'evt.txt'), 'x');
    // B 的 watcher 仍存活 → 仍收到推送
    await waitFor(() => b.fsChanged.includes(wb.watchId), 3000);
    expect(b.fsChanged.includes(wb.watchId)).toBe(true);
    void wa;
  });

  it('T-043 fs:changed 不跨客户端广播(仅归属方经自身连接收到)', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    // 只有 B watch 共享路径;A 不 watch。变更只应经 B 的连接推送,A 侧零收。
    // (fs:changed 由归属 client 的 WatchService.send 走该 client 的端口发出,
    // 天然不广播 —— 用「非归属方 A 全程零收」直接钉死无跨连接广播。)
    const wb = (await b.rpc('fs.watch', { path: tmp })) as { watchId: number };
    fs.writeFileSync(path.join(tmp, 'shared.txt'), 'x');
    await waitFor(() => b.fsChanged.includes(wb.watchId), 3000);
    await delay(500); // 去抖窗 + 余量
    expect(b.fsChanged).toContain(wb.watchId);
    expect(a.fsChanged.length).toBe(0); // 非归属方从未收到任何 fs:changed
  });
});

describe('AC-6 断连回收只涉及自身', () => {
  it('T-044 clean 断开:只回收 A 的会话,B 不受影响', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    const sa = await spawn(a);
    const sb = await spawn(b);
    expect(host.core.pool.pid(sa)).not.toBeNull();
    // A 主动断开
    a.close();
    await waitFor(() => host!.core.pool.pid(sa) === null, 3000);
    // B 的会话仍在,且能继续工作
    expect(host.core.pool.pid(sb)).not.toBeNull();
    b.send({ t: 'pty:input', sessionId: sb, data: 'echo B_SURVIVES\n' });
    await waitFor(() => (b.ptyData.get(sb) ?? '').includes('B_SURVIVES'), 12000);
  });

  it('T-045 静默断连(心跳 pong 超时)→ terminate → 回收 A,B 不受影响', async () => {
    host = await startTestHost({ pingIntervalMs: 60 });
    const a = await newClient();
    const b = await newClient();
    const sa = await spawn(a);
    const sb = await spawn(b);
    // A 的底层 socket 暂停读取 → 收不到 ping、也不 auto-pong → 心跳判定僵死
    (a.ws as unknown as { _socket: { pause(): void } })._socket.pause();
    await waitFor(() => host!.core.pool.pid(sa) === null, 4000);
    expect(host.core.pool.pid(sa)).toBeNull();
    // B 不受影响
    expect(host.core.pool.pid(sb)).not.toBeNull();
    b.send({ t: 'pty:input', sessionId: sb, data: 'echo B_OK\n' });
    await waitFor(() => (b.ptyData.get(sb) ?? '').includes('B_OK'), 12000);
  });
});

describe('AC-6 并发交错帧不串扰 (T-046)', () => {
  it('A、B 近乎同时交错操作各自会话,路由不错乱', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    const sa = await spawn(a);
    const sb = await spawn(b);
    // 交错发送
    for (let i = 0; i < 5; i++) {
      a.send({ t: 'pty:input', sessionId: sa, data: `echo A${i}\n` });
      b.send({ t: 'pty:input', sessionId: sb, data: `echo B${i}\n` });
    }
    await waitFor(
      () =>
        (a.ptyData.get(sa) ?? '').includes('A4') &&
        (b.ptyData.get(sb) ?? '').includes('B4'),
      12000,
    );
    // A 的数据里没有 B 的输出,反之亦然
    const aOut = a.ptyData.get(sa) ?? '';
    const bOut = b.ptyData.get(sb) ?? '';
    expect(aOut).toContain('A0');
    expect(aOut).not.toMatch(/B\d/);
    expect(bOut).toContain('B0');
    expect(bOut).not.toMatch(/A\d/);
    a.send({ t: 'pty:input', sessionId: sa, data: 'exit\n' });
    b.send({ t: 'pty:input', sessionId: sb, data: 'exit\n' });
  });
});
