// Phase 4 · ptyPool 多订阅镜像(M2 · docs/features/multi-device-mirror.md §B/§4 Phase4)。
// 🔴 沙箱注意:真 node-pty 在沙箱 `posix_spawnp failed` 为预存在失败(同 ptyPoolDetach 基线)——
// 本文件因此在沙箱红,是已知基线非回归;真机/CI 应绿。
//
// 分两段:①直驱 PtyPool(真 pty)—— 订阅者模型的核心不变式;②真 ws + hostCore —— attach
// mode 门控对 client.sessions 的影响(mirror 不摘他人 / exclusive 摘他人)。

import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import { FLOW, HostMessage } from '../../shared/protocol';
import { PtyPool } from '../ptyPool';
import {
  waitFor,
  delay,
  describePty,
  startTestHost,
  TestClient,
  TestHost,
} from './wsTestHarness';

const CWD = os.tmpdir();
// 3MB 纯净字节流(与 ptyPoolDetach 同款):无 ack 会在高水位处 pause。
const FLOOD = "head -c 3000000 /dev/zero | tr '\\0' x\n";

let pool: PtyPool | null = null;
let host: TestHost | null = null;
let clients: TestClient[] = [];

afterEach(async () => {
  pool?.dispose();
  pool = null;
  delete process.env.TERMPRO_SESSION_RING_BYTES;
  for (const c of clients) c.close();
  clients = [];
  await host?.close();
  host = null;
});

function mkClient(): TestClient {
  const c = new TestClient(host!.url());
  clients.push(c);
  return c;
}

describePty('PtyPool 多订阅镜像(M2 · Phase4)', () => {
  // 1. 双订阅镜像:同段输出双收 · ack 互不干扰 · 任一端 input 双收回显
  it('双订阅镜像:两订阅者收到同一段 pty:data;B input 后 A/B 都收到回显', async () => {
    pool = new PtyPool('standalone');
    let aOut = '';
    let bOut = '';
    const sid = pool.spawn(
      { cwd: CWD, cols: 80, rows: 24 },
      (m) => {
        if (m.t === 'pty:data') aOut += m.data;
      },
      undefined,
      1,
    );
    await waitFor(() => pool!.pid(sid) !== null, 8000);

    const res = pool.reattach(
      sid,
      (m) => {
        if (m.t === 'pty:data') bOut += m.data;
      },
      { cols: 80, rows: 24, resumeOffset: 0, mode: 'mirror', subscriberId: 2 },
    );
    expect(res).not.toBeNull();
    expect(res!.found).toBe(true);

    pool.input(sid, 'echo MIRROR_TEST\n');
    await waitFor(
      () => aOut.includes('MIRROR_TEST') && bOut.includes('MIRROR_TEST'),
      8000,
    );

    // A 过量 ack(clamp 安全)不应扰动 B 的后续接收(ack 独立性 · 轻量校验,详细数值见 T-2)
    pool.ack(sid, 999_999, 1);

    // B 打字 → 回显广播回双方(任一端可输入 · B6)
    pool.input(sid, 'echo FROM_B\n');
    await waitFor(
      () => aOut.includes('FROM_B') && bOut.includes('FROM_B'),
      8000,
    );
  });

  // 2. 多订阅免 pause(B2 v2 · 收尾评审 P2-2/P2-3):共享 PTY 的 pause 必然耦合全体,
  //    多订阅唯一背压 = desync 驱逐 + session:desynced 事件;PTY 不被任何慢端憋停。
  it('多订阅免 pause:双慢端 → 双 desync + 各收 session:desynced;PTY 跑完全量;reattach 恢复', async () => {
    pool = new PtyPool('standalone');
    let aBytes = 0;
    let bBytes = 0;
    const aMsgs: HostMessage[] = [];
    const bMsgs: HostMessage[] = [];
    const sid = pool.spawn(
      { cwd: CWD, cols: 80, rows: 24 },
      (m) => {
        aMsgs.push(m);
        if (m.t === 'pty:data') aBytes += m.bytes;
      },
      undefined,
      1,
    );
    await waitFor(() => pool!.pid(sid) !== null, 8000);
    pool.reattach(
      sid,
      (m) => {
        bMsgs.push(m);
        if (m.t === 'pty:data') bBytes += m.bytes;
      },
      { cols: 80, rows: 24, resumeOffset: 0, mode: 'mirror', subscriberId: 2 },
    );

    pool.input(sid, FLOOD);
    // 双方都不 ack:各自越过 desync 阈值(2×high=1MiB)被剔出增量流,并各收一条 desynced
    await waitFor(
      () =>
        aMsgs.some((m) => m.t === 'session:desynced') &&
        bMsgs.some((m) => m.t === 'session:desynced'),
      12000,
    );
    // 停发点在阈值附近(高于高水位、远低于全量)——证明不是 pause 憋停形态
    expect(aBytes).toBeGreaterThan(FLOW.highWatermark);
    expect(aBytes).toBeLessThan(3_000_000 * 0.9);

    // 🔴 关键:PTY 未被任何一端憋停 —— absoluteOffset 跑完全量(经 reattach 的
    // nextOffset 观测;第三订阅者反复 upsert 幂等无副作用)
    await waitFor(() => {
      const r = pool!.reattach(sid, () => {}, {
        cols: 80,
        rows: 24,
        resumeOffset: 0,
        mode: 'mirror',
        subscriberId: 3,
      });
      return r !== null && r.nextOffset >= 3_000_000;
    }, 12000);

    // ack 不能复活 desync 端(剔出即终态,恢复只经 reattach)
    const bStalled = bBytes;
    pool.ack(sid, 999_999_999, 2);
    pool.input(sid, 'echo AFTER_DESYNC\n');
    await delay(400);
    expect(bBytes).toBe(bStalled);

    // B mirror reattach → 全量重同步 + 恢复增量流
    let bOut2 = '';
    const res = pool.reattach(
      sid,
      (m) => {
        if (m.t === 'pty:data') bOut2 += m.data;
      },
      { cols: 80, rows: 24, resumeOffset: 0, mode: 'mirror', subscriberId: 2 },
    );
    expect(res!.full).toBe(true);
    pool.input(sid, 'echo B_RECOVERED\n');
    await waitFor(() => bOut2.includes('B_RECOVERED'), 8000);
  });

  // 3. 慢端 desync(多订阅):B 落后越 desync 阈值(2×high=1MiB)→ desync;A 不被 B 憋停;
  //    B 旧 offset reattach → full=true(gap 超 ring 由 sliceFrom 天然判定)
  it('慢端 desync:B 不 ack 落后超阈值 → desync;A 正常 ack 时不受影响;B 旧 offset reattach → full', async () => {
    // 阈值 1MiB 远小于 3MB flood → B(从不 ack)必在中途越界触发 desync;A 同步自 ack 恒健康。
    pool = new PtyPool('standalone');
    let aBytes = 0;
    let bBytes = 0;
    // 🔴 A 在自己的 send 回调里同步立即 ack(而非定时器):onData→广播→A.send 同一同步调用栈内
    // 完成 ack,保证 A 的 unacked 在下一个 chunk 到达前必已清零 —— 避免定时器在真实 pty 突发
    // 吞吐下被事件循环饿死、导致 A 自己也意外越过 desync 硬顶(曾踩坑:见本文件历史)。
    const sid = pool.spawn(
      { cwd: CWD, cols: 80, rows: 24 },
      (m) => {
        if (m.t === 'pty:data') {
          aBytes += m.bytes;
          pool!.ack(sid, m.bytes, 1);
        }
      },
      undefined,
      1,
    );
    await waitFor(() => pool!.pid(sid) !== null, 8000);
    pool.reattach(
      sid,
      (m) => {
        if (m.t === 'pty:data') bBytes += m.bytes;
      },
      { cols: 80, rows: 24, resumeOffset: 0, mode: 'mirror', subscriberId: 2 },
    );

    pool.input(sid, FLOOD);
    // 🔴 关键断言:A 未被 B 憋停 —— 能收完全量(desync 剔出 B 后 PTY 由 A 流控推进)
    await waitFor(() => aBytes >= 3_000_000 * 0.99, 12000);

    // B 早早停在远小于 A 的字节数(desync 后不再收增量)
    expect(bBytes).toBeLessThan(aBytes);
    const bAfterFlood = bBytes;
    await delay(300);
    expect(bBytes).toBe(bAfterFlood); // 不再增长

    // B 用旧 resumeOffset(远落后于当前 absoluteOffset)重连(mirror)→ full=true 全量补屏
    const res = pool.reattach(sid, () => {}, {
      cols: 80,
      rows: 24,
      resumeOffset: 0,
      mode: 'mirror',
      subscriberId: 2,
    });
    expect(res).not.toBeNull();
    expect(res!.full).toBe(true);
  });

  // 4. min-size(B5):PTY 尺寸 = min(全体订阅者视口);订阅者离开重算放大
  it('min-size:A(100x40)+B mirror(80x24)→ pty 取 80x24;B unsubscribe → 恢复 100x40', async () => {
    pool = new PtyPool('standalone');
    let aOut = '';
    const sid = pool.spawn(
      { cwd: CWD, cols: 100, rows: 40 },
      (m) => {
        if (m.t === 'pty:data') aOut += m.data;
      },
      undefined,
      1,
    );
    await waitFor(() => pool!.pid(sid) !== null, 8000);

    pool.input(sid, 'stty size\n');
    await waitFor(() => aOut.includes('40 100'), 8000); // stty size 输出「rows cols」
    aOut = '';

    let bOut = '';
    const res = pool.reattach(
      sid,
      (m) => {
        if (m.t === 'pty:data') bOut += m.data;
      },
      { cols: 80, rows: 24, resumeOffset: 0, mode: 'mirror', subscriberId: 2 },
    );
    expect(res).not.toBeNull();

    pool.input(sid, 'stty size\n');
    await waitFor(
      () => aOut.includes('24 80') && bOut.includes('24 80'),
      8000,
    );

    // B 离开 → min 只剩 A(100x40)→ 重算放大恢复
    aOut = '';
    pool.unsubscribe(sid, 2);
    pool.input(sid, 'stty size\n');
    await waitFor(() => aOut.includes('40 100'), 8000);
  });

  // 5. exclusive 抢占:B reattach(exclusive)→ A 收 session:takenover 且此后不再收 pty:data
  it('exclusive 抢占:B(exclusive)reattach → A 收 session:takenover · 此后输出只到 B', async () => {
    pool = new PtyPool('standalone');
    let aOut = '';
    const aMsgs: HostMessage[] = [];
    const sid = pool.spawn(
      { cwd: CWD, cols: 80, rows: 24 },
      (m) => {
        aMsgs.push(m);
        if (m.t === 'pty:data') aOut += m.data;
      },
      undefined,
      1,
    );
    await waitFor(() => pool!.pid(sid) !== null, 8000);

    pool.input(sid, 'echo A_ALIVE\n');
    await waitFor(() => aOut.includes('A_ALIVE'), 8000);
    const aOutBeforeTakeover = aOut;

    // B reattach 省略 mode → 缺省 'exclusive'(旧客户端零回归语义,亦是本测试要的抢占路径)
    let bOut = '';
    const res = pool.reattach(
      sid,
      (m) => {
        if (m.t === 'pty:data') bOut += m.data;
      },
      { cols: 80, rows: 24, resumeOffset: 0, subscriberId: 2 },
    );
    expect(res).not.toBeNull();
    expect(
      aMsgs.some((m) => m.t === 'session:takenover' && m.sessionId === sid),
    ).toBe(true);

    pool.input(sid, 'echo ONLY_B\n');
    await waitFor(() => bOut.includes('ONLY_B'), 8000);
    await delay(300);
    // 🔴 否定断言:A 摘除后不再收任何新 pty:data(区分「转移」vs「仍在扇出」)
    expect(aOut).toBe(aOutBeforeTakeover);
    expect(aOut).not.toContain('ONLY_B');
  });

  // 6. 空集等价 detach:双订阅者先后 unsubscribe → 摘空 resume(ring 续录);重 attach 含摘空期输出
  it('空集等价 detach:双订阅者先后 unsubscribe → 摘空 resume;重 attach 回放含摘空期产出', async () => {
    // 大 ring:避免双订阅同时不 ack 时提前触发 desync(本测试要的是「摘空收尾」路径)。
    process.env.TERMPRO_SESSION_RING_BYTES = String(4 * 1024 * 1024);
    pool = new PtyPool('standalone');
    let aBytes = 0;
    let bBytes = 0;
    const sid = pool.spawn(
      { cwd: CWD, cols: 80, rows: 24 },
      (m) => {
        if (m.t === 'pty:data') aBytes += m.bytes;
      },
      undefined,
      1,
    );
    await waitFor(() => pool!.pid(sid) !== null, 8000);
    pool.reattach(
      sid,
      (m) => {
        if (m.t === 'pty:data') bBytes += m.bytes;
      },
      { cols: 80, rows: 24, resumeOffset: 0, mode: 'mirror', subscriberId: 2 },
    );

    pool.input(sid, FLOOD);
    await waitFor(
      () => aBytes > FLOW.highWatermark && bBytes > FLOW.highWatermark,
      12000,
    );
    await delay(400); // 确认已憋停(双方都不 ack)
    const stalledA = aBytes;
    const stalledB = bBytes;
    expect(stalledA).toBeLessThan(3_000_000 * 0.9);

    // 只摘 A:B 仍活跃且未回落 → 保持 paused(B 字节数不再增长)
    pool.unsubscribe(sid, 1);
    await delay(400);
    expect(bBytes).toBe(stalledB);

    // 摘空(B 也摘除)→ 等价旧 detach 收尾:resume,ring 续录
    pool.unsubscribe(sid, 2);
    expect(pool.pid(sid)).not.toBeNull(); // 未 kill(续跑,非旧 embedded kill 语义)

    await delay(2500); // 续跑到全量(预算同 ptyPoolDetach T-002)
    const res = pool.reattach(sid, () => {}, {
      cols: 80,
      rows: 24,
      resumeOffset: 0,
      mode: 'mirror',
      subscriberId: 3,
    });
    expect(res).not.toBeNull();
    expect(res!.nextOffset).toBeGreaterThan(stalledA); // 摘空期续跑产出更多字节(resume 生效)
    expect(res!.nextOffset).toBeGreaterThanOrEqual(3_000_000 * 0.99); // 跑完全量
  });
});

describePty('hostCore attach-mode 门控(M2 · B3/B6)', () => {
  // 7a. mirror attach 不摘他人 client.sessions:双 client 都能 input
  it('mirror attach 不摘他人 client.sessions:双 client 都能 input(同屏)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const { sessionId } = (await a.rpc('pty.spawn', {
      cwd: CWD,
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    await waitFor(() => host!.core.pool.pid(sessionId) !== null, 8000);

    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
      mode: 'mirror',
    })) as { found: boolean };
    expect(res.found).toBe(true);

    // A 的订阅未被摘(mirror 不动他人 client.sessions)→ A 的 input 仍生效
    a.send({ t: 'pty:input', sessionId, data: 'echo FROM_A\n' });
    // B 的 input 也生效(新订阅者)
    b.send({ t: 'pty:input', sessionId, data: 'echo FROM_B\n' });
    await waitFor(() => (b.ptyData.get(sessionId) ?? '').includes('FROM_A'), 8000);
    await waitFor(() => (a.ptyData.get(sessionId) ?? '').includes('FROM_B'), 8000);
  });

  // 7b. exclusive attach 摘他人 client.sessions:他人 input 被拒
  it('exclusive attach 摘他人 client.sessions:被摘者 input 被拒 · 收 session:takenover', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const { sessionId } = (await a.rpc('pty.spawn', {
      cwd: CWD,
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    await waitFor(() => host!.core.pool.pid(sessionId) !== null, 8000);

    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
      mode: 'exclusive',
    })) as { found: boolean };
    expect(res.found).toBe(true);

    // A 收到 session:takenover(exclusive 抢占通知)
    await waitFor(
      () =>
        a.messages.some(
          (m) => m.t === 'session:takenover' && m.sessionId === sessionId,
        ),
      4000,
    );

    // A 已被摘除 client.sessions → input 被门控拒绝;B 的 input 生效
    a.send({ t: 'pty:input', sessionId, data: 'echo FROM_A_REJECTED\n' });
    b.send({ t: 'pty:input', sessionId, data: 'echo FROM_B_OK\n' });
    await waitFor(() => (b.ptyData.get(sessionId) ?? '').includes('FROM_B_OK'), 8000);
    await delay(300);
    expect(b.ptyData.get(sessionId) ?? '').not.toContain('FROM_A_REJECTED');
  });
});
