// 断线重连回放收养 · 端到端(真 hostCore + 真 ws + 真 node-pty · wsTestHarness)。
// 🔴 沙箱注意:真 node-pty 在沙箱 `posix_spawnp failed` 为预存在失败(GO/test-baseline
// BL-003/004 同基线)——本文件因此在沙箱红,是已知基线非回归;真机/CI 应绿。
//
// 🔴 按层拆(QA-B-1):本集成测只断言 host 协议/回放字节(gap / baseOffset===resumeOffset /
// nextOffset / snapshot 值 / last-attach-wins 转移);渲染断言(reset/renderedBytes/徽标)
// 在 terminalRegistryReadopt 渲染层单测(renderer 侧,不属本 host 层)。

import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import type {
  SessionAttachResult,
  SessionSnapshot,
} from '../../shared/protocol';
import { startTestHost, TestClient, waitFor, delay, TestHost, describePty } from './wsTestHarness';

const CWD = os.tmpdir();

// 断开后才输出的可计算标记:值只在输出出现、不在命令源码出现(排除命令回显干扰)。
// echo $((111111111*10)) → 命令源含 "111111111*10",输出行含 "1111111110"。
const COMPUTED = '1111111110';
const computeCmd = (extra = '') =>
  `sleep 0.4; echo $((111111111*10))${extra}\n`;

const byteLen = (s: string) => Buffer.byteLength(s, 'utf8');
const dataBytes = (c: TestClient, sid: string) =>
  byteLen(c.ptyData.get(sid) ?? '');

let host: TestHost | null = null;
let clients: TestClient[] = [];

function mkClient(tokenOverride?: string | null): TestClient {
  const c = new TestClient(host!.url(tokenOverride));
  clients.push(c);
  return c;
}

async function spawnSession(
  c: TestClient,
  cols = 80,
  rows = 24,
): Promise<string> {
  const { sessionId } = (await c.rpc('pty.spawn', {
    cwd: CWD,
    cols,
    rows,
  })) as { sessionId: string };
  return sessionId;
}

afterEach(async () => {
  for (const c of clients) c.close();
  clients = [];
  await host?.close();
  host = null;
  delete process.env.OKWORK_MAX_SESSIONS;
});

describePty('Reconnect continuity (BL-005 · host 协议侧)', () => {
  // T-001: standalone_session_survives_client_disconnect_proc_keeps_running (AC-1)
  it('断开期会话续跑:不 kill · 断开期字节可经重连 attach 回放', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);

    // 先跑一条 marker 确认双向通;记录已渲染字节
    a.send({ t: 'pty:input', sessionId: sid, data: 'echo READY_MARK\n' });
    await waitFor(() => (a.ptyData.get(sid) ?? '').includes('READY_MARK'), 8000);
    const renderedBytes = dataBytes(a, sid);

    // 排一条断开后 0.4s 才输出的命令,随即断开(marker 尚未输出)
    a.send({ t: 'pty:input', sessionId: sid, data: computeCmd() });
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);
    expect(host.core.pool.pid(sid)).not.toBeNull(); // 未 kill(续跑)

    // 重连 B,attach 从 renderedBytes → 回放含断开期产出的计算值
    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: renderedBytes,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);
    await waitFor(() => {
      // attach 回放 + 后续 live 都进 b.ptyData;断开期计算值必现
      return (b.ptyData.get(sid) ?? '').includes(COMPUTED) ||
        res.data.includes(COMPUTED);
    }, 8000);
    expect(res.data.includes(COMPUTED) || (b.ptyData.get(sid) ?? '').includes(COMPUTED)).toBe(true);
  });

  // T-005: reconnect_incremental_replay_gap_only_no_double_write (AC-3)
  it('增量回放 gap:full=false · baseOffset===resumeOffset · nextOffset===baseOffset+byteLen(data)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    a.send({ t: 'pty:input', sessionId: sid, data: 'echo READY_MARK\n' });
    await waitFor(() => (a.ptyData.get(sid) ?? '').includes('READY_MARK'), 8000);
    const renderedBytes = dataBytes(a, sid);

    // 断开期产出小量新字节(不触发 ring 驱逐 → gap 增量,非 full)
    a.send({ t: 'pty:input', sessionId: sid, data: computeCmd() });
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);
    await delay(700); // 待断开期命令输出完

    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: renderedBytes,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;

    expect(res.found).toBe(true);
    expect(res.full).toBe(false); // gap 在缓冲内 → 增量
    expect(res.baseOffset).toBe(renderedBytes); // 起点 = renderer 报的偏移
    // nextOffset = data 末字节后的绝对偏移(host 契约不变式)
    expect(res.nextOffset).toBe(res.baseOffset + byteLen(res.data));
    expect(res.data).toContain(COMPUTED); // 确有断开期 gap 字节
  });

  // T-009: session_list_discovers_existing_sessions_after_reconnect (AC-4)
  it('session.list 发现现存会话(含 cwd/title/status/state)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const s1 = await spawnSession(a);
    const s2 = await spawnSession(a);
    await waitFor(
      () => host!.core.pool.pid(s1) !== null && host!.core.pool.pid(s2) !== null,
      8000,
    );
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);

    const b = mkClient();
    await b.handshake();
    const { sessions } = (await b.rpc('session.list')) as {
      sessions: SessionSnapshot[];
    };
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toEqual(expect.arrayContaining([s1, s2]));
    for (const snap of sessions) {
      expect(snap.status).toBe('live');
      expect(typeof snap.cwd).toBe('string');
      expect(typeof snap.title).toBe('string');
      expect(['idle', 'running']).toContain(snap.state);
    }
  });

  // T-010: session_attach_adopts_same_pid_no_respawn_io_restored (AC-4)
  it('attach 收养同 pid(非重 spawn)· I/O 双向恢复', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);
    const pidBefore = host.core.pool.pid(sid);
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);

    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);
    expect(host.core.pool.pid(sid)).toBe(pidBefore); // 同一 PTY(非重 spawn)
    expect(host.core.pool.list()).toHaveLength(1); // 无第二个会话

    // B 收养后可 input,输出回 B
    b.send({ t: 'pty:input', sessionId: sid, data: 'echo HELLO_B\n' });
    await waitFor(() => (b.ptyData.get(sid) ?? '').includes('HELLO_B'), 8000);
  });

  // T-011: session_list_snapshot_reconciles_badge_running_to_idle (AC-5)
  it('快照 state 反映当前态(命令完成 → idle)· 无未读计数字段', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    a.send({ t: 'pty:input', sessionId: sid, data: 'echo done\n' });
    await waitFor(() => (a.ptyData.get(sid) ?? '').includes('done'), 8000);
    // 待前台进程名轮询/OSC133 沉降回 idle —— 🔴 poll session.list 直到 idle(非固定 delay·
    // CI 慢环境固定 2s 不够会 flaky:tracker 进程轮询/OSC133 尚未把 running→idle 翻过来)
    let snap!: SessionSnapshot;
    const idleDeadline = Date.now() + 8000;
    while (Date.now() < idleDeadline) {
      const { sessions } = (await a.rpc('session.list')) as { sessions: SessionSnapshot[] };
      const found = sessions.find((s) => s.sessionId === sid);
      if (found) snap = found;
      if (found && found.state === 'idle') break;
      await delay(200);
    }
    expect(snap.state).toBe('idle'); // 当前态(非事件补发)
    // 快照只有当前态字段,无未读 bell/notify 累积计数
    expect(Object.keys(snap).sort()).toEqual([
      'altscreen',
      'bracketedPaste',
      'cwd',
      'exitCode',
      'mouseModes',
      'quiet',
      'sessionId',
      'state',
      'status',
      'title',
    ]);
  });

  // T-015: attach_without_token_rejected_at_ws_gate (AC-8)
  it('无/错 token 连接被 ws upgrade 层 destroy · 现存会话不受影响', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);

    const bad = mkClient('wrong-token-xxxx');
    await expect(bad.waitOpen(3000)).rejects.toThrow(); // socket.destroy → 打不开
    const none = mkClient(null); // 完全不带 token
    await expect(none.waitOpen(3000)).rejects.toThrow();

    expect(host.core.pool.pid(sid)).not.toBeNull(); // 现存会话不受影响
  });

  // T-016: new_client_empty_set_can_attach_existing_session_by_sessionid (AC-8)
  it('新 client(空 Set)可按 sessionId 收养(非 per-client Set 拦死)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);

    // 全新 client(sessions Set 为空)
    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);
    // 收养后 B 拥有 sid:input/resize/ack 均生效
    b.send({ t: 'pty:input', sessionId: sid, data: 'echo OWNED_BY_B\n' });
    await waitFor(() => (b.ptyData.get(sid) ?? '').includes('OWNED_BY_B'), 8000);
  });

  // T-017: session_count_cap_rejects_new_spawn_never_evicts_running (AC-9)
  it('会话数上限:拒新建(rpc ok:false)· 绝不逐运行中 · 手动 kill 腾位后可再建', async () => {
    process.env.OKWORK_MAX_SESSIONS = '2';
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const s1 = await spawnSession(a);
    const s2 = await spawnSession(a);
    await waitFor(
      () => host!.core.pool.pid(s1) !== null && host!.core.pool.pid(s2) !== null,
      8000,
    );

    // 第 3 个 spawn:无 exited 可逐 → 拒新建(rpc reject)
    await expect(spawnSession(a)).rejects.toThrow(/cap reached/);
    // 既有 live 会话 pid 全存活(绝不逐运行中)
    expect(host.core.pool.pid(s1)).not.toBeNull();
    expect(host.core.pool.pid(s2)).not.toBeNull();

    // 手动 kill 腾位后可再建
    await a.rpc('pty.kill', { sessionId: s1 });
    await waitFor(() => host!.core.pool.pid(s1) === null, 8000);
    const s3 = await spawnSession(a);
    expect(host.core.pool.pid(s3)).not.toBeNull();
  });

  // T-021: idempotent_adoption_existing_sessionid_hit_no_double_spawn (AC-11)
  it('幂等收养:attach 命中即收养(不 new spawn·无第二个 PTY)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);
    const pidBefore = host.core.pool.pid(sid);
    // 假死窗:旧连接未 reap,新 client 抢先 attach
    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);
    expect(host.core.pool.pid(sid)).toBe(pidBefore); // 仍同一 PTY
    expect(host.core.pool.list()).toHaveLength(1); // 无重复 spawn
  });

  // T-022: adoption_reattach_resize_reconciles_terminal_dimensions (AC-11)
  it('收养 resize 对账:attach 携新 cols/rows → pty.resize 生效(stty size)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a, 80, 24);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);

    const b = mkClient();
    await b.handshake();
    await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 120,
      rows: 40,
    });
    // resize 生效:pty winsize 变为 40 行 120 列
    b.send({ t: 'pty:input', sessionId: sid, data: 'stty size\n' });
    await waitFor(() => (b.ptyData.get(sid) ?? '').includes('40 120'), 8000);
  });

  // T-023: session_exit_during_disconnect_retained_exited_with_scrollback_and_exitcode (AC-12)
  it('断线期退出:转 exited 保留(最终 scrollback + 进程退出码 3)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);

    // 排「断开后 0.4s 输出完成日志并 exit 3」,随即断开
    a.send({
      t: 'pty:input',
      sessionId: sid,
      data: 'sleep 0.4; echo BUILD_DONE_LOG; exit 3\n',
    });
    a.close();
    await waitFor(() => host!.core.clients.size === 0, 4000);

    // 断线期退出 → 转 exited 保留(未 delete)
    await waitFor(
      () =>
        host!.core.pool.list().find((s) => s.sessionId === sid)?.status ===
        'exited',
      8000,
    );
    const snap = host.core.pool.list().find((s) => s.sessionId === sid)!;
    expect(snap.status).toBe('exited');
    expect(snap.exitCode).toBe(3); // 🔴 进程 onExit 退出码(非 tracker 命令退出码)
    expect(host.core.pool.pid(sid)).toBeNull();

    // 重连回放最终 scrollback
    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);
    expect(res.snapshot.status).toBe('exited');
    expect(res.snapshot.exitCode).toBe(3);
    expect(res.data).toContain('BUILD_DONE_LOG');
  });

  // T-024: exited_session_listed_and_replays_final_output_and_completed_badge (AC-12)
  it('exited 会话:session.list 列出(status=exited·exitCode=0)· attach 回放最终输出', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);

    a.send({
      t: 'pty:input',
      sessionId: sid,
      data: 'echo FINAL_LOG_LINE; exit 0\n',
    });
    await waitFor(
      () =>
        host!.core.pool.list().find((s) => s.sessionId === sid)?.status ===
        'exited',
      8000,
    );

    const { sessions } = (await a.rpc('session.list')) as {
      sessions: SessionSnapshot[];
    };
    const snap = sessions.find((s) => s.sessionId === sid)!;
    expect(snap.status).toBe('exited');
    expect(snap.exitCode).toBe(0);

    const res = (await a.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);
    expect(res.data).toContain('FINAL_LOG_LINE');
  });

  // T-028: last_attach_wins_ownership_transfer_output_routes_to_new_owner (AC-14)
  it('last-attach-wins:输出转移到新 owner B · 🔴 A 的 ptyData 不再增长(否定断言)', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    a.send({ t: 'pty:input', sessionId: sid, data: 'echo A_INIT\n' });
    await waitFor(() => (a.ptyData.get(sid) ?? '').includes('A_INIT'), 8000);
    const aLenBeforeTransfer = dataBytes(a, sid);

    // B attach 同 sid → 所有权转移到 B(A 仍连着,但不再是 owner)
    const b = mkClient();
    await b.handshake();
    const res = (await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    })) as SessionAttachResult;
    expect(res.found).toBe(true);

    // 后续输出经 B 触发,只路由到 B
    b.send({ t: 'pty:input', sessionId: sid, data: 'echo ROUTED_TO_B\n' });
    await waitFor(() => (b.ptyData.get(sid) ?? '').includes('ROUTED_TO_B'), 8000);
    await delay(300);
    // 🔴 否定断言:转移后 A 的 ptyData 不再增长(区分「转移」vs「被禁的扇出」)
    expect(dataBytes(a, sid)).toBe(aLenBeforeTransfer);
    expect(a.ptyData.get(sid) ?? '').not.toContain('ROUTED_TO_B');
  });

  // T-029: prior_owner_input_rejected_after_ownership_transfer (AC-14)
  it('转移后旧 owner A 的 input 被归属守卫拒绝 · B 的 input 生效', async () => {
    host = await startTestHost({ mode: 'standalone' });
    const a = mkClient();
    await a.handshake();
    const sid = await spawnSession(a);
    await waitFor(() => host!.core.pool.pid(sid) !== null, 8000);

    const b = mkClient();
    await b.handshake();
    await b.rpc('session.attach', {
      sessionId: sid,
      resumeOffset: 0,
      cols: 80,
      rows: 24,
    });

    // A 已非 owner(sessions Set 已被移除 sid)→ A 的 input 被拒(不执行)
    a.send({ t: 'pty:input', sessionId: sid, data: 'echo FROM_A_SHOULD_DROP\n' });
    // B 的 input 正常生效
    b.send({ t: 'pty:input', sessionId: sid, data: 'echo FROM_B_OK\n' });
    await waitFor(() => (b.ptyData.get(sid) ?? '').includes('FROM_B_OK'), 8000);
    await delay(300);
    // A 的命令从未执行 → 输出里不含其结果(命令回显也不会有:input 在 host 层即被丢弃)
    expect(b.ptyData.get(sid) ?? '').not.toContain('FROM_A_SHOULD_DROP');
  });
});
