// @vitest-environment jsdom
// 「单个 session 卡死」根因回归(用户报告 2026-07-29,截图:整屏定格在错位重叠的半帧)。
//
// xterm 的 WriteBuffer._innerWrite 主循环是**裸调**:先 `_action(chunk)`(解析,含我们注册
// 的 OSC/CSI handler 与解析中触发的 onData/onResize),紧接着裸调 write 回调,然后才
// `_bufferOffset++` 并在收尾排下一拍 `setTimeout`。任一处抛出 → 偏移不推进、下一拍不排 →
// 该 Terminal 的写入泵**永久停摆**:后续 write 只入队不消费(屏幕定格在半帧)、回调永不
// 触发 → 永不 ack → host 流控憋停这条 PTY。表征即「心跳/其它 tab 全绿,单独一个终端
// 卡死、ctrl+c 无反应」,重连收养也救不回来(回放同样只是往死队列里塞)。
//
// 直接触发源是 WebSocketTransport.send 在非 OPEN 时故意抛的「host connection lost」,而
// ack/input/resize 三条恰好都从解析循环内部下探到传输层。本测锁的是通用防线:凡我们塞进
// 解析路径的回调抛出,写入泵都必须照常往下跑。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeClient = {
  reconnectable: true,
  supportsSessionResume: () => true,
  supportsSessionMirror: () => true,
  rpc: vi.fn(async () => ({})),
  attachPty: vi.fn(() => () => {}),
  input: vi.fn(),
  resize: vi.fn(),
  ack: vi.fn(),
  epoch: 1,
};

vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: {
    forHostId: vi.fn(() => fakeClient),
    forWorkspace: vi.fn(() => fakeClient),
    local: vi.fn(() => fakeClient),
  },
}));

import {
  bindRestoredSessionTab,
  getOrCreateTerminal,
  ingestPtyData,
  __clearRegistryForTest,
} from '../terminalRegistry';
import type { HostClient } from '../../services/hostClient';

const clipboardWriteText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fakeClient.input.mockImplementation(() => undefined);
  fakeClient.ack.mockImplementation(() => undefined);
  (window as unknown as { okwork: unknown }).okwork = {
    clipboardReadImage: vi.fn(async () => null),
    clipboardReadText: vi.fn(async () => ''),
    clipboardWriteText,
  };
  // 护栏会 console.error 记账,别把测试输出刷成一片红
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  __clearRegistryForTest();
  vi.restoreAllMocks();
});

/**
 * 写一段并等它的回调 —— 回调不来即写入泵已停摆(卡死态),超时后显式失败,
 * 而不是让用例吊满 vitest 默认超时后只报一句语焉不详的 timeout。
 */
function writeAndFlush(
  term: { write(d: string, cb?: () => void): void },
  data: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('write pump wedged: xterm 的 write 回调再没触发过')),
      1000,
    );
    term.write(data, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('解析循环内抛异常不再冻死终端', () => {
  it('DECRQM 应答时 client.input 抛(死链路上 send 抛)→ 后续输出照常上屏', async () => {
    const inst = getOrCreateTerminal('t-wedge-decrqm');
    inst.sessionId = 's1';
    inst.client = fakeClient as unknown as HostClient;
    fakeClient.input.mockImplementation(() => {
      throw new Error('host connection lost');
    });

    // 这一段自身就会撞上抛异常的应答路径
    await expect(writeAndFlush(inst.term, '\x1b[?2026$p')).resolves.toBeUndefined();
    // 关键断言:泵还活着,再写还能上屏(修复前这里永远等不到回调)
    await expect(writeAndFlush(inst.term, 'hello')).resolves.toBeUndefined();
    expect(inst.term.buffer.active.getLine(0)?.translateToString(true)).toContain('hello');
  });

  it('自动应答(DA1)经 term.onData 下探传输层抛 → 写入泵不停摆', async () => {
    fakeClient.input.mockImplementation(() => {
      throw new Error('host connection lost');
    });
    // 经 bindRestoredSessionTab 走真实 wireLiveSession/wireInputOnce 接线
    bindRestoredSessionTab('t-wedge-ondata', 'cfg-1', 's2', '/ws');
    const inst = getOrCreateTerminal('t-wedge-ondata');
    // 当代连接上已有归属 → deliverInput 直发(否则走攒键自愈路径,碰不到传输层)
    inst.attachedEpoch = fakeClient.epoch;

    await expect(writeAndFlush(inst.term, '\x1b[c')).resolves.toBeUndefined(); // DA1 查询
    expect(fakeClient.input).toHaveBeenCalled(); // 应答确实走了会抛的那条路
    await expect(writeAndFlush(inst.term, 'still alive')).resolves.toBeUndefined();
  });

  // 备注:上一条即便摘掉 guardParse 也会绿——xterm 6 的 Emitter 自己 try/catch 了每个
  // listener(实测栈:m._deliver → onUnexpectedError → setTimeout 重抛),泵不会停。
  // 保留它是为了钉住这条豁免:哪天 xterm 换回裸调,这里会连同护栏一起被验到。
  // 真正会停摆、也确实是本次故障现场的是下面两条(OSC/CSI handler 与 write 回调)。

  it('OSC 52 落本机剪贴板时抛 → 写入泵不停摆', async () => {
    const inst = getOrCreateTerminal('t-wedge-osc52');
    clipboardWriteText.mockImplementation(() => {
      throw new Error('ipc channel closed');
    });

    await expect(
      writeAndFlush(inst.term, `\x1b]52;c;${btoa('copied')}\x07`),
    ).resolves.toBeUndefined();
    expect(clipboardWriteText).toHaveBeenCalled();
    await expect(writeAndFlush(inst.term, 'still alive')).resolves.toBeUndefined();
  });

  it('ack 回调抛(WriteBuffer 在 _bufferOffset++ 之前裸调它)→ 写入泵不停摆', async () => {
    const inst = getOrCreateTerminal('t-wedge-ack');
    fakeClient.ack.mockImplementation(() => {
      throw new Error('host connection lost');
    });

    ingestPtyData(
      inst,
      't-wedge-ack',
      fakeClient as unknown as HostClient,
      's3',
      'chunk one\r\n',
      11,
    );
    await expect(writeAndFlush(inst.term, 'chunk two')).resolves.toBeUndefined();
    expect(fakeClient.ack).toHaveBeenCalled();
  });
});
