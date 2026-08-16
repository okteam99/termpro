// 云端浏览器预览通道:背压(隧道上恒最多一帧在途)+ 输入校验 + 推流生命周期。
//
// 🔴 背压是这组的重点:画面与终端输出、心跳共用同一条 WS/SSH 隧道,那条隧道
// FIFO 无优先级。帧一旦排队,终端输入会卡、心跳 probe 会被挤到超时窗口之外
// (2026-08 那次「远端 CPU 打满、组头还挂 34ms」就是同一条隧道的拥塞表现)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserService } from '../browserService';
import { fakeChromium } from './fakeChromium';

const DATA_DIR = path.join(os.tmpdir(), 'okwork-browser-preview-test');

function setup() {
  const chromium = fakeChromium();
  const service = new BrowserService({
    dataDir: DATA_DIR,
    locate: () => '/usr/bin/chromium',
    launch: () => chromium.launch(),
    connect: () => chromium.connect(),
    platform: 'linux',
    isRoot: false,
    idleTimeoutMs: 0,
    logger: { log: () => undefined, error: () => undefined },
  });
  const frames: Array<{ tabId: string; seq: number; data: string }> = [];
  return { chromium, service, frames, sink: (f: typeof frames[number]) => frames.push(f) };
}

/** 让假 Chromium 吐一帧 screencastFrame(带 CDP 侧的 ack sessionId)。 */
function emitFrame(
  chromium: ReturnType<typeof fakeChromium>,
  session: string,
  data: string,
  cdpFrameId = 1,
) {
  chromium.event('Page.screencastFrame', {
    data,
    sessionId: cdpFrameId,
    metadata: { deviceWidth: 1280, deviceHeight: 800, pageScaleFactor: 1, offsetTop: 0, scrollOffsetX: 0, scrollOffsetY: 0 },
  }, session);
}

/** 取本次 attach 拿到的 CDP session(假 Chromium 按顺序发号) */
function lastSession(chromium: ReturnType<typeof fakeChromium>): string {
  const attach = chromium.calls.filter((c) => c.method === 'Target.attachToTarget');
  expect(attach.length).toBeGreaterThan(0);
  return chromium.attachedSessions[chromium.attachedSessions.length - 1];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('预览背压', () => {
  it('🔴 上一帧没 ack → 新帧直接丢弃,不排队(隧道上恒最多一帧在途)', async () => {
    const { chromium, service, frames, sink } = setup();
    const tabId = await service.startPreview(sink);
    const session = lastSession(chromium);

    emitFrame(chromium, session, 'frame-1');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ tabId, seq: 1, data: 'frame-1' });

    // 客户端还没 ack:后面这些帧一律丢掉,绝不堆进隧道
    emitFrame(chromium, session, 'frame-2');
    emitFrame(chromium, session, 'frame-3');
    emitFrame(chromium, session, 'frame-4');
    expect(frames).toHaveLength(1);

    // ack 之后才放行下一帧,且拿到的是**最新**的那张(丢掉的不补发)
    service.ackFrame(tabId, 1);
    emitFrame(chromium, session, 'frame-5');
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ seq: 2, data: 'frame-5' });
  });

  it('🔴 丢帧时仍对 Chromium 立即 ack:页面不因隧道慢而冻住', async () => {
    const { chromium, service, sink } = setup();
    await service.startPreview(sink);
    const session = lastSession(chromium);

    emitFrame(chromium, session, 'f1', 11);
    emitFrame(chromium, session, 'f2', 12); // 这张会被丢
    emitFrame(chromium, session, 'f3', 13); // 这张也会被丢

    // 三张都要对 Chromium ack(不 ack 它就不再产帧 → 预览端看到的是静止画面)
    const acks = chromium.calls.filter((c) => c.method === 'Page.screencastFrameAck');
    expect(acks.map((c) => c.params.sessionId)).toEqual([11, 12, 13]);
    expect(acks.every((c) => c.sessionId === session)).toBe(true);
  });

  it('序号对不上的迟到 ack 不放行下一帧(防旧 ack 误开闸)', async () => {
    const { chromium, service, frames, sink } = setup();
    const tabId = await service.startPreview(sink);
    const session = lastSession(chromium);

    emitFrame(chromium, session, 'f1');
    service.ackFrame(tabId, 99); // 不是在途的那一帧
    emitFrame(chromium, session, 'f2');
    expect(frames).toHaveLength(1);

    service.ackFrame(tabId, 1); // 正确序号
    emitFrame(chromium, session, 'f3');
    expect(frames).toHaveLength(2);
  });

  it('预览端不回 ack(关窗/崩了)→ 超时后自动停流,不把标签钉在等 ack 态', async () => {
    vi.useFakeTimers();
    const { chromium, service, frames, sink } = setup();
    await service.startPreview(sink);
    const session = lastSession(chromium);

    emitFrame(chromium, session, 'f1');
    expect(frames).toHaveLength(1);
    expect(service.previewing).toBe(true);

    await vi.advanceTimersByTimeAsync(16_000);
    expect(service.previewing).toBe(false);
    expect(chromium.calls.some((c) => c.method === 'Page.stopScreencast')).toBe(true);

    // 停流后再来的帧不再送出
    emitFrame(chromium, session, 'f2');
    expect(frames).toHaveLength(1);
  });
});

describe('预览生命周期', () => {
  it('startPreview 用 JPEG + 限长边(不是整幅 PNG:那是几百 KB 一帧)', async () => {
    const { chromium, service, sink } = setup();
    await service.startPreview(sink);
    const start = chromium.calls.find((c) => c.method === 'Page.startScreencast');
    expect(start?.params).toMatchObject({
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
  });

  it('重复 startPreview 幂等:旧订阅先撤,不会一帧送两遍', async () => {
    const { chromium, service, frames, sink } = setup();
    const tabId = await service.startPreview(sink);
    await service.startPreview(sink, { tabId });
    const session = lastSession(chromium);
    emitFrame(chromium, session, 'f1');
    expect(frames).toHaveLength(1);
  });

  it('stopPreview 后零画面流量(默认无头的本意)', async () => {
    const { chromium, service, frames, sink } = setup();
    const tabId = await service.startPreview(sink);
    const session = lastSession(chromium);
    service.stopPreview(tabId);
    expect(service.previewing).toBe(false);
    emitFrame(chromium, session, 'f1');
    expect(frames).toHaveLength(0);
  });

  it('关标签 / 关浏览器 → 推流态一并清掉', async () => {
    const { service, sink } = setup();
    const tabId = await service.startPreview(sink);
    await service.closeTab(tabId);
    expect(service.previewing).toBe(false);

    const again = await service.startPreview(sink);
    expect(again).toBeTruthy();
    await service.shutdown();
    expect(service.previewing).toBe(false);
  });

  it('🔴 有人看着预览时不许空闲回收(画面正动着,浏览器不能被关掉)', async () => {
    vi.useFakeTimers();
    const chromium = fakeChromium();
    const service = new BrowserService({
      dataDir: DATA_DIR,
      locate: () => '/usr/bin/chromium',
      launch: () => chromium.launch(),
      connect: () => chromium.connect(),
      idleTimeoutMs: 60_000,
      logger: { log: () => undefined, error: () => undefined },
    });
    const tabId = await service.startPreview(() => undefined);

    // 预览期间没有任何 RPC 调用(帧是 host 推的),但也不该被当成空闲
    await vi.advanceTimersByTimeAsync(200_000);
    expect(service.status().running).toBe(true);

    // 关掉预览后,空闲回收恢复正常
    service.stopPreview(tabId);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(service.status().running).toBe(false);
  });
});

describe('输入转发', () => {
  it('鼠标事件落成 CDP Input.dispatchMouseEvent(滚轮才带 delta)', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    await service.dispatchInput({
      kind: 'mouse',
      type: 'mousePressed',
      x: 100.4,
      y: 200.6,
      button: 'left',
      clickCount: 1,
    });
    const press = chromium.calls.find(
      (c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mousePressed',
    );
    expect(press?.params).toMatchObject({ x: 100.4, y: 200.6, button: 'left', clickCount: 1 });
    expect(press?.params.deltaY).toBeUndefined();

    await service.dispatchInput({ kind: 'mouse', type: 'mouseWheel', x: 10, y: 20, deltaY: -120 });
    const wheel = chromium.calls.find(
      (c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mouseWheel',
    );
    expect(wheel?.params).toMatchObject({ deltaY: -120, deltaX: 0 });
  });

  it('键盘事件落成 Input.dispatchKeyEvent', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    await service.dispatchInput({ kind: 'key', type: 'char', text: 'a' });
    const key = chromium.calls.find((c) => c.method === 'Input.dispatchKeyEvent');
    expect(key?.params).toMatchObject({ type: 'char', text: 'a' });
  });

  it('🔴 不盲目透传:未知事件类型拒绝,畸形数值被钳成安全值', async () => {
    const { chromium, service } = setup();
    await service.openTab();

    await expect(
      service.dispatchInput({
        kind: 'mouse',
        type: 'drop' as unknown as 'mousePressed',
        x: 0,
        y: 0,
      }),
    ).rejects.toThrow(/bad mouse event/);
    await expect(
      service.dispatchInput({ kind: 'key', type: 'paste' as unknown as 'keyDown' }),
    ).rejects.toThrow(/bad key event/);

    // NaN / 超范围 / 未知按钮 → 钳到安全值,不原样丢给 CDP
    await service.dispatchInput({
      kind: 'mouse',
      type: 'mouseMoved',
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      button: 'scroll' as unknown as 'left',
      clickCount: 999,
      modifiers: 9999,
    });
    const moved = chromium.calls.find(
      (c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mouseMoved',
    );
    expect(moved?.params).toMatchObject({
      x: 0,
      y: 0,
      button: 'none',
      clickCount: 3,
      modifiers: 15,
    });
  });

  it('超长 text 被截断(一次灌进整篇文本不该当成一个按键事件)', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    await service.dispatchInput({ kind: 'key', type: 'char', text: 'x'.repeat(5000) });
    const key = chromium.calls.find((c) => c.method === 'Input.dispatchKeyEvent');
    expect(String(key?.params.text)).toHaveLength(256);
  });

  it('resize 同步远端视口,尺寸钳在合理范围', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    await service.resizeViewport(1600, 900, 2);
    expect(
      chromium.calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride')?.params,
    ).toMatchObject({ width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });

    await service.resizeViewport(-5, 999_999, 99);
    const clamped = chromium.calls
      .filter((c) => c.method === 'Emulation.setDeviceMetricsOverride')
      .at(-1);
    expect(clamped?.params).toMatchObject({ width: 1, height: 8192, deviceScaleFactor: 3 });
  });
});
