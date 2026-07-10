// AC-9 认证失败告警节流:shouldAlert 纯函数跨窗口(T-019)+ 真实 ws 突发单窗口 emit≤1(T-020)。
// 现状(改前):authFailures.length>=threshold 后每次失败都 emit → 刷屏;本测把节流锁定为
// 「同一冷却窗内至多一次」,回归时(若节流被误删)T-020 会失败(emit 次数 > 1)。
import { describe, it, expect, afterEach } from 'vitest';
import {
  shouldAlert,
  AUTH_FAIL_ALERT,
  AUTH_FAIL_ALERT_COOLDOWN_MS,
} from '../wsServer';
import { startTestHost, TestClient, TestHost, waitFor, describePty } from './wsTestHarness';

let host: TestHost | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (host) {
    await host.close();
    host = null;
  }
});

function track(c: TestClient): TestClient {
  clients.push(c);
  return c;
}

describePty('AC-9 shouldAlert 纯函数跨窗口 (T-019)', () => {
  const threshold = AUTH_FAIL_ALERT; // 10
  const cooldownMs = AUTH_FAIL_ALERT_COOLDOWN_MS; // 60_000

  it('count < threshold → 恒 false(未达阈值,无论时间差多大)', () => {
    expect(shouldAlert(1_000, 0, threshold - 1, threshold, cooldownMs)).toBe(false);
    expect(shouldAlert(1_000_000, -Infinity, 0, threshold, cooldownMs)).toBe(false);
  });

  it('count >= threshold 且首窗(lastAlertAt=-Infinity)→ true(首次告警)', () => {
    expect(shouldAlert(1_000, -Infinity, threshold, threshold, cooldownMs)).toBe(true);
    expect(shouldAlert(1_000, -Infinity, threshold + 5, threshold, cooldownMs)).toBe(true);
  });

  it('count >= threshold 且 now-lastAlertAt < cooldownMs → false(同窗口节流)', () => {
    expect(shouldAlert(1_000, 500, threshold, threshold, cooldownMs)).toBe(false);
    expect(shouldAlert(60_000, 500, threshold + 10, threshold, cooldownMs)).toBe(false); // 差 59500ms
    expect(shouldAlert(60_498, 499, threshold, threshold, cooldownMs)).toBe(false); // 差 59999ms(60000-1)
  });

  it('count >= threshold 且 now-lastAlertAt >= cooldownMs → true(跨窗口重新告警)', () => {
    expect(shouldAlert(61_000, 1_000, threshold, threshold, cooldownMs)).toBe(true); // 恰好 60000ms
    expect(shouldAlert(70_000, 1_000, threshold, threshold, cooldownMs)).toBe(true);
  });
});

describePty('AC-9 真实 ws 突发单窗口 emit≤1 (T-020)', () => {
  it('同一窗口内 20 次错误 token 连接 → onAuthAlert 至多 emit 1 次;阈值后合法连接仍成功', async () => {
    host = await startTestHost({ token: 'right-throttle' });
    for (let i = 0; i < 20; i++) {
      const bad = track(new TestClient(host.url(`wrong-${i}`)));
      await bad.waitOpen().catch(() => {});
    }
    await waitFor(() => host!.authAlerts.length > 0, 2_000);
    // 节流回归门:改前实现会 emit 多次(10..20 每次一发);节流后单窗口只应有 1 条。
    expect(host.authAlerts.length).toBe(1);
    expect(host.authAlerts[0]).toBeGreaterThanOrEqual(AUTH_FAIL_ALERT);
    expect(
      host.logs.filter((l) => l.includes('repeated ws auth failures')).length,
    ).toBe(1);
    // 节流是告警频率控制 · 非阻断:阈值后合法连接仍成功
    const good = track(new TestClient(host.url()));
    const info = await good.handshake();
    expect(info.protocolVersion).toBe(1);
  });
});
