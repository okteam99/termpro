// @vitest-environment jsdom
// 「单个 session 卡死」根因(用户报告 2026-07-29):WebSocketTransport.send 在非 OPEN 时
// **故意抛**(见 hostClientDeadSocketRpc:让 rpc 就地拒、不吊满超时),而 ack/input/resize
// 这三条数据报恰好都从 **xterm 的解析/写入循环内部**被同步调用 —— 尤其 ack,是
// WriteBuffer._innerWrite 在 `_bufferOffset++` 之前裸调的 write 回调,每来一段输出就跑一次。
// 于是链路刚死、onclose 还没派发的那个窗口里,下一段输出的 ack 抛进解析循环 → 偏移不推进、
// 下一拍不排 → 该 Terminal 的写入泵永久停摆:屏幕定格在半帧、回调永不触发 → 永不 ack →
// host 流控憋停这条 PTY。心跳与其它 tab 全绿,唯独这一个 session 卡死,重连也救不回来。
//
// 分界:rpc 保持「发送失败即拒」(那是它要的快速失败),数据报路径一律吞——链路已死时
// 这一发本就是白发,输入由 deliverInput 的代次自愈补发、尺寸由 session.attach 带回、
// ack 由 reattach 复位 unacked 抹平。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HostClient } from '../hostClient';

/** 只实现 Transport 契约的桩:send 必抛,模拟「链路已死、onclose 未到」的窗口。 */
function clientWithFailingSend(): { client: HostClient; send: ReturnType<typeof vi.fn> } {
  const client = new HostClient();
  const send = vi.fn(() => {
    throw new Error('host connection lost');
  });
  const transport = { send, onMessage: () => {}, onClose: () => {}, close: () => {} };
  (client as unknown as { transport: typeof transport }).transport = transport;
  return { client, send };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('数据报路径(ack/input/resize)在死链路上不上抛', () => {
  it('ack:发送失败只吞不抛(否则 xterm 写入泵在 _bufferOffset++ 前当场停摆)', () => {
    const { client, send } = clientWithFailingSend();
    expect(() => client.ack('s1', 4096)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1); // 确实试过发,不是被别的门提前挡掉
  });

  it('input:发送失败只吞不抛(DECRQM/DA 自动应答就在解析循环里发)', () => {
    const { client } = clientWithFailingSend();
    expect(() => client.input('s1', '\x1b[?2026;0$y')).not.toThrow();
  });

  it('resize:发送失败只吞不抛(DECCOLM / CSI 8 t 在解析中触发)', () => {
    const { client } = clientWithFailingSend();
    expect(() => client.resize('s1', 120, 40)).not.toThrow();
  });

  it('丢弃留痕:不许无声吞(排障要能看见链路在丢包)', () => {
    const { client } = clientWithFailingSend();
    client.ack('s1', 1);
    expect(console.warn).toHaveBeenCalled();
  });

  it('rpc 不受影响:仍旧发送失败即拒(hostClientDeadSocketRpc 的分界不变)', async () => {
    const { client } = clientWithFailingSend();
    await expect(client.rpc('session.list', undefined)).rejects.toThrow(
      /host connection lost/,
    );
  });
});
