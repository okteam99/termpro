// 直驱 PtyPool + 真 node-pty 的行为断言(BL-005)。
// 🔴 沙箱注意:真 node-pty 在沙箱 `posix_spawnp failed` 为预存在失败(GO/test-baseline
// BL-003/004 同基线)——本文件因此在沙箱红,是已知基线非回归;真机/CI 应绿。

import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import { FLOW } from '../../shared/protocol';
import { PtyPool } from '../ptyPool';
import { RingBuffer } from '../ringBuffer';
import { waitFor, delay, describePty } from './wsTestHarness';

const CWD = os.tmpdir();
// 3MB 纯净字节流(命令回显极短,可忽略);attached-无 ack 会在 ~512KiB 处 pause。
const FLOOD = "head -c 3000000 /dev/zero | tr '\\0' x\n";
const RING_CAP = new RingBuffer().capacityBytes;

let pool: PtyPool | null = null;
afterEach(() => {
  pool?.dispose();
  pool = null;
});

describePty('PtyPool detach / exited / cap (BL-005)', () => {
  // T-002: detached_session_bypasses_flowcontrol_proc_not_paused_ring_fills (AC-1)
  it('灌满打到 paused → detach 复活续跑 · ring 持续增长 · pid 存活(AC-1·ARCH-B-3)', async () => {
    pool = new PtyPool('standalone');
    let received = 0;
    const sid = pool.spawn({ cwd: CWD, cols: 80, rows: 24 }, (m) => {
      if (m.t === 'pty:data') received += m.bytes;
    });
    await waitFor(() => pool!.pid(sid) !== null, 8000);

    // 灌远超高水位(无 ack)→ attached 会话 proc.pause() 憋停,received 不会达全量
    pool.input(sid, FLOOD);
    await waitFor(() => received > FLOW.highWatermark, 12000);
    await delay(400); // 确认已憋停
    const stalled = received;
    expect(stalled).toBeLessThan(3_000_000 * 0.9); // 未跑完 = 确实被 pause

    // detach:解已 paused 会话(proc.resume)+ 旁路流控(attached=false 不再 pause)
    pool.detach(sid);
    expect(pool.pid(sid)).not.toBeNull(); // 进程未被 kill —— 断开续跑

    // 续跑到全量:2.5s 足够跑完剩余 ~2.5MB(若 detach 未 resume 会永远停在 ~512KiB)
    await delay(2500);
    const res = pool.reattach(sid, () => {}, { cols: 80, rows: 24, resumeOffset: 0 });
    expect(res).not.toBeNull();
    expect(res!.nextOffset).toBeGreaterThan(stalled); // 续跑 = 复活生效
    expect(res!.nextOffset).toBeGreaterThanOrEqual(3_000_000 * 0.99); // 跑完全量
    // ring 有界:整缓冲 ≤ capacity;resumeOffset=0 已被挤出 → full 回退
    expect(res!.full).toBe(true);
    expect(Buffer.byteLength(res!.data, 'utf8')).toBeLessThanOrEqual(RING_CAP);
  });

  // T-003: embedded_mode_client_close_kills_session_zero_regression (AC-2)
  it('embedded:kill 立即回收(onExit delete·不转 exited)·零回归', async () => {
    pool = new PtyPool('embedded');
    let exited = false;
    const sid = pool.spawn({ cwd: CWD, cols: 80, rows: 24 }, (m) => {
      if (m.t === 'pty:exit') exited = true;
    });
    await waitFor(() => pool!.pid(sid) !== null, 8000);

    pool.kill(sid);
    await waitFor(() => exited, 8000);
    expect(pool.pid(sid)).toBeNull(); // 已删除(非 exited 保留)
    expect(pool.list()).toEqual([]); // embedded 从不进 session.list
  });

  // T-004: embedded_mode_allocates_no_scrollback_ring_memory_purity (AC-2)
  it('embedded:不分配 ring(回放为空)· 不进 session.list', async () => {
    pool = new PtyPool('embedded');
    let received = 0;
    const sid = pool.spawn({ cwd: CWD, cols: 80, rows: 24 }, (m) => {
      if (m.t === 'pty:data') received += m.bytes;
    });
    pool.input(sid, 'echo hello-embedded\n');
    await waitFor(() => received > 0, 8000);

    expect(pool.list()).toEqual([]); // 无重连语义 → 不进快照
    // ring===null 的行为证据:reattach 回放为空(真 ring 会缓冲输出 → data 非空)
    const res = pool.reattach(sid, () => {}, { cols: 80, rows: 24, resumeOffset: 0 });
    expect(res).not.toBeNull();
    expect(res!.data).toBe('');
    expect(res!.nextOffset).toBeGreaterThan(0); // 但确产出过字节(absoluteOffset 累加)
  });

  // T-025: exited_residency_same_lifetime_no_short_timer_only_pressure_evicts (AC-12)
  it('standalone 退出转 exited 保留(退出码+scrollback)·无短时窗回收', async () => {
    pool = new PtyPool('standalone');
    let exited = false;
    const sid = pool.spawn({ cwd: CWD, cols: 80, rows: 24 }, (m) => {
      if (m.t === 'pty:exit') exited = true;
    });
    await waitFor(() => pool!.pid(sid) !== null, 8000);

    pool.input(sid, 'exit 3\n');
    await waitFor(() => exited, 8000);

    const snaps = pool.list();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].sessionId).toBe(sid);
    expect(snaps[0].status).toBe('exited');
    expect(snaps[0].exitCode).toBe(3); // 进程退出码(onExit)
    expect(pool.pid(sid)).toBeNull(); // 死 pty → null

    // 时间流逝无短时窗删除(模拟深夜 build 完成→早晨回来)
    await delay(1500);
    expect(pool.list()).toHaveLength(1); // 仍在(仅压力下才逐)
  });

  // T-037: session_cap_evicts_oldest_exited_by_exit_time_live_survive (AC-9)
  it('cap 满:逐最旧 exited(按 exit 时间)· live 全存活 · 无 exited 可逐则拒新建', async () => {
    pool = new PtyPool('standalone', 3); // cap=3
    const spawn1 = () => pool!.spawn({ cwd: CWD, cols: 80, rows: 24 }, () => {});
    const isExited = (id: string) =>
      pool!.list().find((x) => x.sessionId === id)?.status === 'exited';

    const s1 = spawn1(); // 保持 live
    await waitFor(() => pool!.pid(s1) !== null, 8000);
    const s2 = spawn1();
    await waitFor(() => pool!.pid(s2) !== null, 8000);
    pool.input(s2, 'exit 0\n');
    await waitFor(() => isExited(s2), 8000); // s2 exited(较早)
    await delay(60); // 拉开 exit 时间
    const s3 = spawn1();
    await waitFor(() => pool!.pid(s3) !== null, 8000);
    pool.input(s3, 'exit 0\n');
    await waitFor(() => isExited(s3), 8000); // s3 exited(较晚)

    expect(pool.list()).toHaveLength(3); // s1 live, s2/s3 exited

    // 触发逐出:逐最旧 exited = s2(排序键 exitedAt 升序 · 最近完成的最后逐)
    const s4 = spawn1();
    const ids1 = pool.list().map((x) => x.sessionId);
    expect(ids1).not.toContain(s2); // 最旧 exited 被逐
    expect(ids1).toEqual(expect.arrayContaining([s1, s3, s4]));
    expect(pool.pid(s1)).not.toBeNull(); // live 存活(绝不逐 live)

    // 再逐:逐掉剩余唯一 exited(s3)
    const s5 = spawn1();
    expect(pool.list().map((x) => x.sessionId)).not.toContain(s3);

    // 此时 s1/s4/s5 全 live · 无 exited 可逐 → 拒新建(绝不逐 live · QA-7)
    expect(() => spawn1()).toThrow(/cap reached/);
    for (const s of [s1, s4, s5]) expect(pool.pid(s)).not.toBeNull();
  });
});
