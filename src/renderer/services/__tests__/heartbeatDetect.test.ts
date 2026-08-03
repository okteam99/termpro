// BL-005 · AC-13(T-026/T-027):app 层心跳有界时延判断线 + 周期/超时 env 可注入。
// 喂「静默不回」probe(模拟合盖·onclose 不及时)+ fake timers 断言有界 T 内判死(QA-B-8),
// 无需真 ws/pty integration。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heartbeat, readHeartbeatEnv, type HeartbeatConfig } from '../heartbeat';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('app_heartbeat_timeout_detects_disconnect_within_bounded_T (T-026)', () => {
  it('传输挂起(probe 永不 resolve)→ 在 interval+timeout 内判死一次', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    // 静默不回:probe 返回一个永不 settle 的 promise
    const hb = new Heartbeat(cfg, { probe: () => new Promise<never>(() => {}), onDead });
    hb.start();

    // 尚未到首拍 interval → 不判死
    await vi.advanceTimersByTimeAsync(90);
    expect(onDead).not.toHaveBeenCalled();

    // interval(100) 触发首拍 probe,再过 timeout(100)窗口未回 → 判死
    await vi.advanceTimersByTimeAsync(120); // 累计 210ms > interval+timeout
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('probe 按时回应则不判死,继续下一拍', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => Promise.resolve({ ok: true }), onDead });
    hb.start();

    await vi.advanceTimersByTimeAsync(500); // 多拍都正常回应
    expect(onDead).not.toHaveBeenCalled();
    hb.stop();
  });

  it('probe 抛错(传输错误)同样判死', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 50, timeoutMs: 200 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => Promise.reject(new Error('ws closed')), onDead });
    hb.start();

    await vi.advanceTimersByTimeAsync(80); // 首拍 probe reject
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('probe 正常回应 → onAlive 携带该拍往返耗时(组头 RTT 展示的数据源)', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 200 };
    const onAlive = vi.fn();
    const hb = new Heartbeat(cfg, {
      // probe 耗时 50ms 才回(fake timers 下 Date.now 同步推进,RTT 恰为 50)
      probe: () => new Promise((resolve) => { setTimeout(() => resolve({ ok: true }), 50); }),
      onDead: vi.fn(),
      onAlive,
    });
    hb.start();

    await vi.advanceTimersByTimeAsync(160); // interval(100) + probe 耗时(50)
    expect(onAlive).toHaveBeenCalledTimes(1);
    expect(onAlive).toHaveBeenCalledWith(50);
    hb.stop();
  });

  it('stop 后不再判死(避免退订后仍触发)', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => new Promise<never>(() => {}), onDead });
    hb.start();
    hb.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDead).not.toHaveBeenCalled();
  });
});

describe('heartbeat_inbound_activity_counts_as_liveness (P1 · 2026-08 总掉线)', () => {
  it('probe 挂起但窗口内有入站流量 → 不判死,放弃本拍排下一拍;流量停止后下一拍判死', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => new Promise<never>(() => {}), onDead });
    hb.start();

    // t=100 首拍 probe 挂起;t=150 有入站流量(pty:data 挤占窗口的拥塞场景)
    await vi.advanceTimersByTimeAsync(150);
    hb.notifyActivity();
    // t=200 本拍窗口到期:有活动 → 不判死,排下一拍(t=300 起拍)
    await vi.advanceTimersByTimeAsync(100);
    expect(onDead).not.toHaveBeenCalled();

    // t=300 下一拍 probe 挂起,窗口 (300,400] 内零入站 → t=400 判死一次
    await vi.advanceTimersByTimeAsync(200);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('流量持续期间永不判死(持续拥塞但链路确实在投递字节)', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => new Promise<never>(() => {}), onDead });
    hb.start();

    // 每 50ms 一次入站流量,跑 10 个拍周期:每拍窗口内都有活动 → 恒不判死
    for (let t = 0; t < 2000; t += 50) {
      await vi.advanceTimersByTimeAsync(50);
      hb.notifyActivity();
    }
    expect(onDead).not.toHaveBeenCalled();
    hb.stop();
  });

  it('陈旧活动(probe 起拍之前)不算存活证明 → 照常判死', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => new Promise<never>(() => {}), onDead });
    hb.start();

    // t=50 有活动(首拍 t=100 之前);此后彻底静默
    await vi.advanceTimersByTimeAsync(50);
    hb.notifyActivity();
    // t=100 起拍,窗口 (100,200] 零入站 → t=200 判死(50ms 前的活动不豁免)
    await vi.advanceTimersByTimeAsync(160);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('probe reject(传输错误)不受活动豁免 → 立即判死', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 50, timeoutMs: 200 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => Promise.reject(new Error('ws closed')), onDead });
    hb.start();
    hb.notifyActivity(); // 有活动也不豁免 reject(ws 已关是权威死讯)
    await vi.advanceTimersByTimeAsync(80);
    expect(onDead).toHaveBeenCalledTimes(1);
  });
});

describe('heartbeat_interval_timeout_env_injectable (T-027)', () => {
  it('注入极短周期 → 断线检测按注入值加速(可 BDD 有界断言)', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 10, timeoutMs: 10 };
    const onDead = vi.fn();
    const hb = new Heartbeat(cfg, { probe: () => new Promise<never>(() => {}), onDead });
    hb.start();
    await vi.advanceTimersByTimeAsync(25); // 10+10 < 25
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('注入的计时器 seam 被使用(不依赖真实全局 setTimeout)', async () => {
    const cfg: HeartbeatConfig = { intervalMs: 100, timeoutMs: 100 };
    const onDead = vi.fn();
    const setTimer = vi.fn((fn: () => void, _ms: number) => setTimeout(fn, _ms));
    const clearTimer = vi.fn((h: ReturnType<typeof setTimeout>) => clearTimeout(h));
    const hb = new Heartbeat(cfg, {
      probe: () => new Promise<never>(() => {}),
      onDead,
      setTimer,
      clearTimer,
    });
    hb.start();
    expect(setTimer).toHaveBeenCalled(); // interval timer 走注入 seam
    hb.stop();
    expect(clearTimer).toHaveBeenCalled();
  });

  it('readHeartbeatEnv 缺失 env 时回退默认 5s/5s(T≈10s 上界)', () => {
    const cfg = readHeartbeatEnv();
    expect(cfg.intervalMs).toBe(5000);
    expect(cfg.timeoutMs).toBe(5000);
  });
});
