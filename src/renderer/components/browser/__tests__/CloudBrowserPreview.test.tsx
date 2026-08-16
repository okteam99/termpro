// @vitest-environment jsdom
// 云端浏览器预览组件:推流生命周期(挂上开、卸载停)、ack 纪律、坐标换算。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CloudBrowserPreview } from '../CloudBrowserPreview';
import type { HostClient } from '../../../services/hostClient';
import type { BrowserFrameMessage } from '../../../services/hostClient';

/** 假 HostClient:记录 RPC + 手工投帧。 */
function fakeClient(over: { startError?: Error } = {}) {
  let frameCb: ((f: BrowserFrameMessage) => void) | null = null;
  const rpc = vi.fn(async (method: string, _params?: unknown) => {
    if (method === 'browser.startPreview') {
      if (over.startError) throw over.startError;
      return { tabId: 'cloud-tab-1' };
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
    } as unknown as HostClient;

    const view = render(<CloudBrowserPreview client={client} />);
    view.unmount(); // start 还没返回就卸载
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

describe('输入转发', () => {
  async function mounted() {
    const f = fakeClient();
    render(<CloudBrowserPreview client={f.client} />);
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('browser.startPreview', {}));
    f.emit(); // 先来一帧,建立 metadata(坐标换算依据)
    await waitFor(() => expect(f.acks).toHaveLength(1));
    const canvas = document.querySelector('canvas')!;
    return { ...f, canvas };
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
    fireEvent.keyDown(f.canvas, { key: 'a', code: 'KeyA' });
    let events = f.rpc.mock.calls
      .filter(([m]) => m === 'browser.input')
      .map(([, a]) => (a as { event: { type: string; text?: string } }).event);
    expect(events.filter((e) => e.type === 'keyDown')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'char' && e.text === 'a')).toHaveLength(1);

    // Ctrl+C 不该被当成可打印字符补一个 char
    fireEvent.keyDown(f.canvas, { key: 'c', code: 'KeyC', ctrlKey: true });
    events = f.rpc.mock.calls
      .filter(([m]) => m === 'browser.input')
      .map(([, a]) => (a as { event: { type: string; text?: string } }).event);
    expect(events.filter((e) => e.type === 'char')).toHaveLength(1);
  });

  it('modifiers 按 CDP 位编码(Alt=1 Ctrl=2 Meta=4 Shift=8)', async () => {
    const f = await mounted();
    fireEvent.keyDown(f.canvas, { key: 'Enter', code: 'Enter', shiftKey: true, ctrlKey: true });
    const event = f.rpc.mock.calls
      .filter(([m]) => m === 'browser.input')
      .map(([, a]) => (a as { event: { modifiers?: number } }).event)
      .at(-1);
    expect(event?.modifiers).toBe(2 | 8);
  });
});
