// CDP 客户端契约:请求/响应配对、事件分发、超时、断连拒绝在途调用。
// 全程喂假传输(不起真 Chromium)——同 heartbeat.ts 的注入 seam 惯例。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CdpConnection,
  CdpError,
  type CdpTransport,
} from '../cdpClient';

/** 可编程的假 CDP 端:记录发出的帧,手工回灌响应/事件/断连。 */
function fakeTransport() {
  const sent: Array<Record<string, unknown>> = [];
  let onMessage: ((data: string) => void) | null = null;
  let onClose: ((reason: string) => void) | null = null;
  let closed = false;
  const transport: CdpTransport = {
    send: (data) => {
      if (closed) throw new Error('transport closed');
      sent.push(JSON.parse(data));
    },
    close: () => {
      closed = true;
    },
    onMessage: (cb) => {
      onMessage = cb;
    },
    onClose: (cb) => {
      onClose = cb;
    },
  };
  return {
    transport,
    sent,
    get closed() {
      return closed;
    },
    reply: (msg: unknown) => onMessage?.(JSON.stringify(msg)),
    raw: (data: string) => onMessage?.(data),
    drop: (reason = 'socket died') => onClose?.(reason),
  };
}

async function connect(fake: ReturnType<typeof fakeTransport>) {
  return CdpConnection.open('ws://fake', {
    transportFactory: async () => fake.transport,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CdpConnection', () => {
  it('按 id 配对请求与响应,sessionId 原样带上(flatten 模式路由到标签)', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);

    const p = conn.send('Runtime.evaluate', { expression: '1+1' }, 'sess-1');
    expect(fake.sent[0]).toMatchObject({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: '1+1' },
      sessionId: 'sess-1',
    });

    fake.reply({ id: 1, result: { value: 2 } });
    await expect(p).resolves.toEqual({ value: 2 });
  });

  it('CDP 错误 → reject CdpError(带 code),不是静默 resolve undefined', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);
    const p = conn.send('Page.navigate', { url: 'about:blank' });
    fake.reply({ id: 1, error: { code: -32000, message: 'Cannot navigate' } });
    await expect(p).rejects.toThrow('Cannot navigate');
    await expect(p).rejects.toMatchObject({ code: -32000 });
  });

  it('事件按 method 分发给订阅者,退订后不再收', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);
    const frames: unknown[] = [];
    const off = conn.on('Page.screencastFrame', (e) => frames.push(e));

    fake.reply({
      method: 'Page.screencastFrame',
      params: { data: 'AAAA', sessionId: 7 },
      sessionId: 'sess-1',
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      method: 'Page.screencastFrame',
      sessionId: 'sess-1',
      params: { data: 'AAAA' },
    });

    off();
    fake.reply({ method: 'Page.screencastFrame', params: {} });
    expect(frames).toHaveLength(1);
  });

  it('一个订阅者抛错不影响其他订阅者(事件分发不该被单点毒死)', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);
    const seen: string[] = [];
    conn.on('Target.targetCreated', () => {
      throw new Error('boom');
    });
    conn.on('Target.targetCreated', () => seen.push('second'));
    fake.reply({ method: 'Target.targetCreated', params: {} });
    expect(seen).toEqual(['second']);
  });

  it('超时 → reject,且迟到响应不会再动已结算的调用', async () => {
    const fake = fakeTransport();
    const conn = await CdpConnection.open('ws://fake', {
      transportFactory: async () => fake.transport,
      defaultTimeoutMs: 1000,
    });
    const p = conn.send('Page.navigate', { url: 'https://slow.test' });
    const rejected = expect(p).rejects.toThrow('cdp timeout: Page.navigate');
    await vi.advanceTimersByTimeAsync(1100);
    await rejected;

    // 迟到的响应:已无 pending 记录,静默丢弃(不得抛 unhandled)
    expect(() => fake.reply({ id: 1, result: { ok: true } })).not.toThrow();
  });

  it('🔴 连接断开 → 在途调用立即 reject,不留给调用方吊死', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);
    const a = conn.send('Runtime.evaluate', { expression: 'x' });
    const b = conn.send('Page.captureScreenshot');

    fake.drop('chromium died');

    await expect(a).rejects.toThrow('chromium died');
    await expect(b).rejects.toThrow('chromium died');
    expect(conn.closed).toBe(true);
    // 断开后再发 → 立刻 reject(不排队等一个永远不会回来的响应)
    await expect(conn.send('Runtime.evaluate')).rejects.toBeInstanceOf(CdpError);
  });

  it('畸形帧丢弃,不拖垮连接(同 wsServer 口径)', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);
    expect(() => fake.raw('{not json')).not.toThrow();
    const p = conn.send('Runtime.evaluate');
    fake.reply({ id: 1, result: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('close() 拒绝在途调用并关传输(host 收尾不留悬挂 Promise)', async () => {
    const fake = fakeTransport();
    const conn = await connect(fake);
    const p = conn.send('Runtime.evaluate');
    conn.close();
    await expect(p).rejects.toThrow(/closed by host/);
    expect(fake.closed).toBe(true);
  });
});
