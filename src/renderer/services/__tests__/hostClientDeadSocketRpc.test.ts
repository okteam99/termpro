// @vitest-environment jsdom
// 修 2026-07「重连时 rpc timeout: session.attach」:链路已死、onclose 还没派发的窗口里
// 发出的 RPC 会被 WebSocket 规范静默丢弃(CLOSING/CLOSED 上的 send 不抛也不发),
// 于是干吊满超时才现身 —— 收养逐会话串行 attach,连着几轮就把「Could not restore」
// 刷成一屏。守卫:非 OPEN 立刻抛,rpc 就地拒并拆记账。
import { describe, expect, it, vi } from 'vitest';
import { HostClient, WebSocketTransport } from '../hostClient';
import type { ClientMessage } from '../../../shared/protocol';

const MSG: ClientMessage = {
  t: 'rpc:req',
  id: 1,
  method: 'host.info',
  params: undefined,
};

function fakeWs(readyState: number): { ws: WebSocket; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  return { ws: { readyState, send } as unknown as WebSocket, send };
}

describe('WebSocketTransport.send 非 OPEN 守卫', () => {
  it('CLOSING / CLOSED → 抛「host connection lost」而非静默丢弃', () => {
    for (const state of [WebSocket.CLOSING, WebSocket.CLOSED]) {
      const { ws, send } = fakeWs(state);
      expect(() => new WebSocketTransport(ws).send(MSG)).toThrow(/host connection lost/);
      expect(send).not.toHaveBeenCalled(); // 规范上这一发是白发,不如不发
    }
  });

  it('CONNECTING → 同样先拒(原生 send 会抛 InvalidStateError,统一成一种错)', () => {
    const { ws, send } = fakeWs(WebSocket.CONNECTING);
    expect(() => new WebSocketTransport(ws).send(MSG)).toThrow(/host connection lost/);
    expect(send).not.toHaveBeenCalled();
  });

  it('OPEN → 正常序列化下发', () => {
    const { ws, send } = fakeWs(WebSocket.OPEN);
    new WebSocketTransport(ws).send(MSG);
    expect(send).toHaveBeenCalledWith(JSON.stringify(MSG));
  });
});

describe('rpc 遇发送失败即拒(不吊满超时)', () => {
  /** 只实现 Transport 契约的桩:send 必抛,模拟死链路。 */
  function clientWithFailingSend(): HostClient {
    const client = new HostClient();
    const transport = {
      send: () => {
        throw new Error('host connection lost');
      },
      onMessage: () => {},
      onClose: () => {},
      close: () => {},
    };
    // 直连桩传输(不跑握手):本用例只验 rpc 的发送失败分支
    (client as unknown as { transport: typeof transport }).transport = transport;
    return client;
  }

  it('send 抛 → promise 立刻 reject,不等超时', async () => {
    vi.useFakeTimers();
    try {
      const client = clientWithFailingSend();
      // 不推进任何计时器:能拒说明走的是发送失败分支,不是超时分支
      await expect(client.rpc('session.list', undefined)).rejects.toThrow(
        /host connection lost/,
      );
      expect(vi.getTimerCount()).toBe(0); // 计时器已拆,无空转
    } finally {
      vi.useRealTimers();
    }
  });

  it('拒后 pending 不留残条(同 id 不会被后到的响应/超时二次处理)', async () => {
    const client = clientWithFailingSend();
    await expect(client.rpc('session.list', undefined)).rejects.toThrow();
    const pending = (client as unknown as { pending: Map<number, unknown> }).pending;
    expect(pending.size).toBe(0);
  });
});
