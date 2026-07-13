// AC-2 host.info-first 门控(仅 WS)+ AC-5 嵌入式路径不受门控。
// 真实 host 核心 + 真实 ws 服务端/客户端。
import { describe, it, expect, afterEach } from 'vitest';
import { startTestHost, TestClient, TestHost, waitFor, describePty } from './wsTestHarness';
import { createHostCore, PortLike } from '../hostCore';

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

describePty('AC-2 host.info-first 门控', () => {
  it('T-008 首条即 host.info → 正常放行,无额外往返', async () => {
    host = await startTestHost();
    const c = track(new TestClient(host.url()));
    const info = await c.handshake();
    expect(info.protocolVersion).toBe(1);
    // 握手后可正常发起其余 RPC(与 MessagePort 同构)
    const home = (await c.rpc('fs.home')) as { path: string };
    expect(typeof home.path).toBe('string');
    // 无 hello/welcome 等新消息类型:收到的只有 rpc:res
    expect(host.core.clients.size).toBe(1);
  });

  it('host.info 上报 OKWORK_HOST_APP_VERSION(升级判定数据源);未注入则省略字段', async () => {
    // 用户规则 2026-07-13:main 侧以 host.info.appVersion 判定服务端是否过旧
    // (缺省 = 旧 host = 过旧 → 连接时升级)。env 由启动方注入,host 逐请求读取。
    host = await startTestHost();
    process.env.OKWORK_HOST_APP_VERSION = '9.9.9';
    try {
      const c = track(new TestClient(host.url()));
      const info = await c.handshake();
      expect(info.appVersion).toBe('9.9.9');
    } finally {
      delete process.env.OKWORK_HOST_APP_VERSION;
    }
    const c2 = track(new TestClient(host.url()));
    const info2 = await c2.handshake();
    expect(info2.appVersion).toBeUndefined();
  });

  it('T-009 首条不是 host.info(直接 pty.spawn)→ 断开且无响应', async () => {
    host = await startTestHost();
    const c = track(new TestClient(host.url()));
    await c.waitOpen();
    c.send({
      t: 'rpc:req',
      id: 1,
      method: 'pty.spawn',
      params: { cwd: process.cwd(), shell: '/bin/sh', cols: 80, rows: 24 },
    });
    await c.waitClose();
    // 该消息不产生任何 rpc:res
    expect(c.messages.find((m) => m.t === 'rpc:res')).toBeUndefined();
    // 资源回收:client 表项被移除
    await waitFor(() => host!.core.clients.size === 0);
  });

  it('T-010 host.info 响应返回前插入其他消息 → 断开(pipelined 第二帧)', async () => {
    host = await startTestHost();
    const c = track(new TestClient(host.url()));
    await c.waitOpen();
    // 同步背靠背发两帧,并 cork/uncork 强制合入同一 TCP 段 → 服务端在同一 data
    // 事件里先后处理:host.info passes(gate→awaiting-response),第二帧在响应发出
    // 前到达 → 触发违规断开(deferred-flip 尚未跑)。避免分段导致的非确定性。
    const sock = (c.ws as unknown as { _socket: { cork(): void; uncork(): void } })
      ._socket;
    sock.cork();
    c.send({ t: 'rpc:req', id: 1, method: 'host.info', params: undefined });
    c.send({ t: 'pty:input', sessionId: 'ghost', data: 'x' });
    sock.uncork();
    await c.waitClose();
    await waitFor(() => host!.core.clients.size === 0);
  });

  it('T-011 握手超时(未发 host.info)→ 断开回收', async () => {
    host = await startTestHost({ handshakeTimeoutMs: 150 });
    const c = track(new TestClient(host.url()));
    await c.waitOpen();
    // 什么都不发,等超时
    await c.waitClose();
    await waitFor(() => host!.core.clients.size === 0);
  });

  it('T-012 三种门控违规收敛同一断言:关闭 + 回收 + 无响应,无半连接态', async () => {
    // 场景 A:首条非 host.info
    host = await startTestHost({ handshakeTimeoutMs: 150 });
    const a = track(new TestClient(host.url()));
    await a.waitOpen();
    a.send({ t: 'rpc:req', id: 1, method: 'fs.home', params: undefined });
    await a.waitClose();

    // 场景 B:超时不发起
    const b = track(new TestClient(host.url()));
    await b.waitOpen();
    await b.waitClose();

    // 两条都无 rpc:res,且 host 侧无残留 client
    expect(a.messages.some((m) => m.t === 'rpc:res')).toBe(false);
    expect(b.messages.some((m) => m.t === 'rpc:res')).toBe(false);
    await waitFor(() => host!.core.clients.size === 0);
  });
});

describePty('AC-5 嵌入式 MessagePort 路径不受门控 (T-013)', () => {
  it('嵌入式路径首条非 host.info(直接 pty.spawn)仍正常处理,不断开', async () => {
    // 用普通 PortLike 直接接入 hostCore(模拟嵌入式),证明门控只在 WS 适配器层
    const core = createHostCore();
    let closed = false;
    const outbound: Array<{ t?: string; ok?: boolean; result?: unknown }> = [];
    let msgListener: ((e: { data: unknown; ports: PortLike[] }) => void) | null =
      null;
    const port: PortLike = {
      postMessage: (m) => outbound.push(m as { t?: string }),
      on: (event: 'message' | 'close', listener: (...args: never[]) => void) => {
        if (event === 'message')
          msgListener = listener as unknown as (e: {
            data: unknown;
            ports: PortLike[];
          }) => void;
        else (listener as () => void); // close 不订阅
      },
      start: () => {},
      close: () => {
        closed = true;
      },
    };
    core.attachClient(port);
    // 首条直接 pty.spawn(嵌入式无门控)
    msgListener!({
      data: {
        t: 'rpc:req',
        id: 1,
        method: 'pty.spawn',
        params: { cwd: process.cwd(), shell: '/bin/sh', cols: 80, rows: 24 },
      },
      ports: [],
    });
    await waitFor(() =>
      outbound.some(
        (m) => m.t === 'rpc:res' && (m as { ok?: boolean }).ok === true,
      ),
    );
    const res = outbound.find((m) => m.t === 'rpc:res') as {
      ok: boolean;
      result: { sessionId: string };
    };
    expect(res.ok).toBe(true);
    expect(typeof res.result.sessionId).toBe('string');
    expect(closed).toBe(false);
    // 收尾:kill 会话
    msgListener!({
      data: {
        t: 'rpc:req',
        id: 2,
        method: 'pty.kill',
        params: { sessionId: res.result.sessionId },
      },
      ports: [],
    });
  });
});
