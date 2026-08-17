// @vitest-environment jsdom
// 云端浏览器预览组件:推流生命周期(挂上开、卸载停)、ack 纪律、坐标换算。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CloudBrowserPreview } from '../CloudBrowserPreview';
import type { HostClient } from '../../../services/hostClient';
import type { BrowserFrameMessage } from '../../../services/hostClient';
import type { BrowserFrameHeader } from '../../../../shared/browserFrameCodec';

/** 假 HostClient:记录 RPC + 手工投帧。 */
function fakeClient(over: { startError?: Error; binaryChannel?: FakeChannel | null } = {}) {
  let frameCb: ((f: BrowserFrameMessage) => void) | null = null;
  const rpc = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'browser.startPreview') {
      if (over.startError) throw over.startError;
      return {
        tabId: 'cloud-tab-1',
        binary: Boolean((params as { streamId?: string })?.streamId && over.binaryChannel),
      };
    }
    return undefined;
  });
  const acks: Array<{ tabId: string; seq: number }> = [];
  const client = {
    rpc,
    onBrowserFrame: (cb: (f: BrowserFrameMessage) => void) => {
      frameCb = cb;
      return () => {
        frameCb = null;
      };
    },
    ackBrowserFrame: (tabId: string, seq: number) => acks.push({ tabId, seq }),
    openBrowserFrameChannel: () => over.binaryChannel ?? null,
  } as unknown as HostClient;
  return {
    client,
    rpc,
    acks,
    get subscribed() {
      return frameCb !== null;
    },
    emit: (over2: Partial<BrowserFrameMessage> = {}) =>
      frameCb?.({
        t: 'browser:frame',
        tabId: 'cloud-tab-1',
        seq: 1,
        data: 'AAAA',
        metadata: {
          deviceWidth: 1000,
          deviceHeight: 500,
          pageScaleFactor: 1,
          offsetTop: 0,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
        },
        ...over2,
      } as BrowserFrameMessage),
  };
}

/** 假的二进制帧通道(等价 openBrowserFrameChannel 的返回)。 */
function fakeChannel() {
  const listeners = new Set<(h: BrowserFrameHeader, jpeg: Uint8Array) => void>();
  const acks: Array<{ tabId: string; seq: number }> = [];
  let closed = false;
  const channel = {
    streamId: 'sid-1',
    ready: Promise.resolve(),
    onFrame(cb: (h: BrowserFrameHeader, jpeg: Uint8Array) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ack: (tabId: string, seq: number) => acks.push({ tabId, seq }),
    close: () => {
      closed = true;
      listeners.clear();
    },
  };
  return {
    channel,
    acks,
    get closed() {
      return closed;
    },
    emit: (seq = 1, tabId = 'cloud-tab-1') =>
      listeners.forEach((cb) =>
        cb(
          {
            tabId,
            seq,
            metadata: {
              deviceWidth: 1000,
              deviceHeight: 500,
              pageScaleFactor: 1,
              offsetTop: 0,
              scrollOffsetX: 0,
              scrollOffsetY: 0,
            },
          },
          new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
        ),
      ),
  };
}

type FakeChannel = ReturnType<typeof fakeChannel>['channel'];

/** jsdom 没有真实排版/解码:给 canvas 一个固定显示尺寸,并让 Image 立刻 onload。 */
function stubCanvasAndImage(displayWidth = 500, displayHeight = 250) {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
    left: 0,
    top: 0,
    width: displayWidth,
    height: displayHeight,
    right: displayWidth,
    bottom: displayHeight,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect;
  class InstantImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 1000;
    height = 500;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', InstantImage);
  // jsdom 没有 createImageBitmap;给个立刻兑现的替身(尺寸与 metadata 对齐)
  vi.stubGlobal('createImageBitmap', async () => ({
    width: 1000,
    height: 500,
    close: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
}

beforeEach(() => {
  stubCanvasAndImage();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('推流生命周期', () => {
  it('挂上即 startPreview;卸载必 stopPreview 并退订(组件在 = 有人在看)', async () => {
    const f = fakeClient();
    const view = render(<CloudBrowserPreview client={f.client} tabId="t1" />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', { tabId: 't1' }));
    expect(f.subscribed).toBe(true);

    view.unmount();
    expect(f.rpc).toHaveBeenCalledWith('browser.stopPreview', { tabId: 'cloud-tab-1' });
    expect(f.subscribed).toBe(false);
  });

  it('🔴 卸载与 startPreview 返回竞态:已经不看了也要把流停掉(不留孤儿流)', async () => {
    const pendingStarts: Array<(v: { tabId: string }) => void> = [];
    const rpc = vi.fn(async (method: string, _params?: unknown) => {
      if (method === 'browser.startPreview') {
        return new Promise<{ tabId: string }>((r) => pendingStarts.push(r));
      }
      return undefined;
    });
    const client = {
      rpc,
      onBrowserFrame: () => () => undefined,
      ackBrowserFrame: () => undefined,
      openBrowserFrameChannel: () => null,
    } as unknown as HostClient;

    const view = render(<CloudBrowserPreview client={client} />);
    // 等 startPreview 真的发出去(在途未返回),这才是要测的竞态
    await waitFor(() => expect(pendingStarts).toHaveLength(1));
    view.unmount();
    pendingStarts[0]?.({ tabId: 'late-tab' });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('browser.stopPreview', { tabId: 'late-tab' }),
    );
  });

  it('startPreview 失败 → 显示错误,不静默空白', async () => {
    const f = fakeClient({ startError: new Error('no Chromium found on this host') });
    const onError = vi.fn();
    render(<CloudBrowserPreview client={f.client} onError={onError} />);
    await waitFor(() => expect(screen.getByText(/no Chromium found/)).toBeTruthy());
    expect(onError).toHaveBeenCalledWith('no Chromium found on this host');
  });
});

describe('ack 纪律(背压的另一半)', () => {
  it('🔴 画完才 ack(不是收到就 ack):否则 host 会按网速而非渲染速度推帧', async () => {
    const f = fakeClient();
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.subscribed).toBe(true));
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', {}));

    f.emit({ seq: 7 });
    // Image.onload 在微任务里触发 → drawImage 之后才 ack
    await waitFor(() => expect(f.acks).toEqual([{ tabId: 'cloud-tab-1', seq: 7 }]));
  });

  it('单帧解码失败照样 ack(一张坏帧不该让推流永远卡住)', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    const f = fakeClient();
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.subscribed).toBe(true));

    f.emit({ seq: 3 });
    await waitFor(() => expect(f.acks).toEqual([{ tabId: 'cloud-tab-1', seq: 3 }]));
  });

  it('别的标签的帧不处理也不 ack(不替他人推进背压)', async () => {
    const f = fakeClient();
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', {}));

    f.emit({ tabId: 'someone-else', seq: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(f.acks).toEqual([]);
  });
});

describe('独立二进制通道', () => {
  it('🔴 有通道时:帧走通道渲染,ack 也回通道(主连接零画面流量)', async () => {
    const ch = fakeChannel();
    const f = fakeClient({ binaryChannel: ch.channel });
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() =>
      expect(f.rpc).toHaveBeenCalledWith(
        'browser.startPreview',
        expect.objectContaining({ streamId: expect.any(String) }),
      ),
    );

    ch.emit(5);
    await waitFor(() => expect(ch.acks).toEqual([{ tabId: 'cloud-tab-1', seq: 5 }]));
    // 主连接的 ack 通道一次都没用
    expect(f.acks).toEqual([]);
  });

  it('没有通道(本地/旧 host)→ 退回主连接 JSON 帧,功能不缺', async () => {
    const f = fakeClient({ binaryChannel: null });
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', {}));
    f.emit({ seq: 2 });
    await waitFor(() => expect(f.acks).toEqual([{ tabId: 'cloud-tab-1', seq: 2 }]));
  });

  it('卸载时关掉通道(不留一条空转的 SSH channel)', async () => {
    const ch = fakeChannel();
    const f = fakeClient({ binaryChannel: ch.channel });
    const view = render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalled());
    view.unmount();
    expect(ch.closed).toBe(true);
  });
});

describe('输入法与粘贴(用户真要操作页面就少不了)', () => {
  async function mountedIme() {
    const f = fakeClient();
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', {}));
    const ime = document.querySelector('textarea')!;
    const inputs = () =>
      f.rpc.mock.calls
        .filter(([m]) => m === 'browser.input')
        .map(([, a]) => (a as { event: Record<string, unknown> }).event);
    return { ...f, ime, inputs };
  }

  it('🔴 中文上屏走整段 text(canvas 起不了 IME,所以键盘挂在取词区上)', async () => {
    const f = await mountedIme();
    fireEvent.compositionStart(f.ime);
    // 合成期间的按键不该转发(那些是给本地输入法的)
    fireEvent.keyDown(f.ime, { key: 'Process', code: 'KeyN' });
    expect(f.inputs()).toHaveLength(0);

    fireEvent.compositionEnd(f.ime, { data: '你好世界' });
    expect(f.inputs()).toEqual([{ kind: 'text', text: '你好世界' }]);
  });

  it('🔴 粘贴整段送过去(密码/URL 靠手打进远端页面不现实)', async () => {
    const f = await mountedIme();
    const clipboardData = { getData: (type: string) => (type === 'text/plain' ? 'sk-abc123' : '') };
    fireEvent.paste(f.ime, { clipboardData });
    expect(f.inputs()).toEqual([{ kind: 'text', text: 'sk-abc123' }]);
  });

  it('普通英文仍走按键路径(keyDown + char),不受输入法改造影响', async () => {
    const f = await mountedIme();
    fireEvent.keyDown(f.ime, { key: 'a', code: 'KeyA' });
    const kinds = f.inputs().map((e) => `${e.kind}:${e.type ?? ''}`);
    expect(kinds).toEqual(['key:keyDown', 'key:char']);
  });

  it('点画面把焦点交给取词区(否则打字没反应)', async () => {
    const f = await mountedIme();
    const canvas = document.querySelector('canvas')!;
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0, detail: 1 });
    expect(document.activeElement).toBe(f.ime);
  });
});

describe('输入转发', () => {
  async function mounted() {
    const f = fakeClient();
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', {}));
    f.emit(); // 先来一帧,建立 metadata(坐标换算依据)
    await waitFor(() => expect(f.acks).toHaveLength(1));
    // 鼠标归 canvas,键盘归取词区(canvas 起不了输入法,见组件注释)
    const canvas = document.querySelector('canvas')!;
    const keyboard = document.querySelector('textarea')!;
    return { ...f, canvas, keyboard };
  }

  it('🔴 坐标按「帧像素 / 显示尺寸」换算(canvas 500 宽 ↔ 页面 1000 宽 → ×2)', async () => {
    const f = await mounted();
    fireEvent.mouseDown(f.canvas, { clientX: 100, clientY: 50, button: 0, detail: 1 });

    const call = f.rpc.mock.calls.find(([m]) => m === 'browser.input');
    expect(call?.[1]).toMatchObject({
      tabId: 'cloud-tab-1',
      event: { kind: 'mouse', type: 'mousePressed', x: 200, y: 100, button: 'left', clickCount: 1 },
    });
  });

  it('滚轮带 delta;右键映射成 right', async () => {
    const f = await mounted();
    fireEvent.wheel(f.canvas, { clientX: 0, clientY: 0, deltaX: 0, deltaY: -120 });
    fireEvent.mouseDown(f.canvas, { clientX: 0, clientY: 0, button: 2, detail: 1 });

    const inputs = f.rpc.mock.calls.filter(([m]) => m === 'browser.input').map(([, a]) => a);
    expect(inputs.some((a) => (a as { event: { deltaY?: number } }).event.deltaY === -120)).toBe(true);
    expect(
      inputs.some((a) => (a as { event: { button?: string } }).event.button === 'right'),
    ).toBe(true);
  });

  it('可打印字符补发 char(CDP 的 keyDown 自己不插入文本);修饰键组合不补', async () => {
    const f = await mounted();
    fireEvent.keyDown(f.keyboard, { key: 'a', code: 'KeyA' });
    let events = f.rpc.mock.calls
      .filter(([m]) => m === 'browser.input')
      .map(([, a]) => (a as { event: { type: string; text?: string } }).event);
    expect(events.filter((e) => e.type === 'keyDown')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'char' && e.text === 'a')).toHaveLength(1);

    // Ctrl+C 不该被当成可打印字符补一个 char
    fireEvent.keyDown(f.keyboard, { key: 'c', code: 'KeyC', ctrlKey: true });
    events = f.rpc.mock.calls
      .filter(([m]) => m === 'browser.input')
      .map(([, a]) => (a as { event: { type: string; text?: string } }).event);
    expect(events.filter((e) => e.type === 'char')).toHaveLength(1);
  });

  it('modifiers 按 CDP 位编码(Alt=1 Ctrl=2 Meta=4 Shift=8)', async () => {
    const f = await mounted();
    fireEvent.keyDown(f.keyboard, { key: 'Enter', code: 'Enter', shiftKey: true, ctrlKey: true });
    const event = f.rpc.mock.calls
      .filter(([m]) => m === 'browser.input')
      .map(([, a]) => (a as { event: { modifiers?: number } }).event)
      .at(-1);
    expect(event?.modifiers).toBe(2 | 8);
  });
});
