// 云端浏览器的本地预览:远端 headless Chromium 的画面贴到 canvas,
// 本地的鼠标/键盘转回去执行。默认无头,这个组件挂上才有画面流量,卸载即停。
//
// 坐标换算是这里唯一容易错的地方:canvas 按 CSS 像素铺开,远端页面按帧
// metadata 里的设备像素排版,两者比例不一定相等(窗口小、DPR 不同)。
// 所有输入事件都要先换算回页面坐标再发,否则点击会落在偏移的位置上。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserFrameMetadata, BrowserInputEvent } from '../../../shared/protocol';
import type { HostClient } from '../../services/hostClient';
import { t } from '../../../shared/i18n';
import './CloudBrowserPreview.css';

export interface CloudBrowserPreviewProps {
  client: HostClient;
  /** 要看哪个标签;省略 = 云端当前活跃标签 */
  tabId?: string;
  /** 画质(JPEG quality),默认由 host 定 */
  quality?: number;
  onError?(message: string): void;
}

/** CDP 的 modifiers 位:Alt=1 Ctrl=2 Meta=4 Shift=8 */
function modifiersOf(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const MOUSE_BUTTONS = ['left', 'middle', 'right'] as const;

export function CloudBrowserPreview({
  client,
  tabId,
  quality,
  onError,
}: CloudBrowserPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 已建立推流的标签 id(host 解析出来的,可能与传入的 tabId 不同) */
  const streamTabRef = useRef<string | null>(null);
  /** 最近一帧的 metadata:输入坐标换算的依据 */
  const metaRef = useRef<BrowserFrameMetadata | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError?.(message);
    },
    [onError],
  );

  // ---- 推流生命周期:挂上就开,卸载必停(组件在 = 有人在看)----
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const offFrame = client.onBrowserFrame((frame) => {
      if (disposed || frame.tabId !== streamTabRef.current) return;
      metaRef.current = frame.metadata;
      const img = new Image();
      img.onload = () => {
        if (disposed) return;
        // 画布尺寸跟随帧的真实像素,避免每帧重设导致的闪烁
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx?.drawImage(img, 0, 0);
        setLive(true);
        // 🔴 画完才 ack:ack 是「我消化完了」,不是「我收到了」。
        // 提前 ack 会让 host 按网络速度而不是本地渲染速度推帧,越积越卡。
        client.ackBrowserFrame(frame.tabId, frame.seq);
      };
      img.onerror = () => {
        // 单帧解码失败不该让推流卡死:照样 ack,等下一帧
        if (!disposed) client.ackBrowserFrame(frame.tabId, frame.seq);
      };
      img.src = `data:image/jpeg;base64,${frame.data}`;
    });

    void client
      .rpc('browser.startPreview', {
        ...(tabId ? { tabId } : {}),
        ...(quality ? { quality } : {}),
      })
      .then((res) => {
        if (disposed) {
          // 卸载与 startPreview 返回的竞态:已经不看了就立刻停,别留孤儿流
          void client.rpc('browser.stopPreview', { tabId: res.tabId }).catch(() => undefined);
          return;
        }
        streamTabRef.current = res.tabId;
      })
      .catch(fail);

    return () => {
      disposed = true;
      offFrame();
      const streaming = streamTabRef.current;
      streamTabRef.current = null;
      if (streaming) {
        void client.rpc('browser.stopPreview', { tabId: streaming }).catch(() => undefined);
      }
    };
  }, [client, tabId, quality, fail]);

  // ---- 视口同步:预览区尺寸变了就告诉远端,否则看到的排版不是这个宽度该有的样子 ----
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      const streaming = streamTabRef.current;
      if (!streaming) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void client
        .rpc('browser.resize', {
          tabId: streaming,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          deviceScaleFactor: Math.min(window.devicePixelRatio || 1, 2),
        })
        .catch(() => undefined);
    };
    const observer = new ResizeObserver(() => {
      // 拖动窗口会连发几十次;去抖,免得把隧道灌满 resize RPC
      if (timer) clearTimeout(timer);
      timer = setTimeout(push, 150);
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  /** canvas 上的 CSS 坐标 → 远端页面坐标(canvas 内容尺寸 / 显示尺寸)。 */
  const toPagePoint = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const meta = metaRef.current;
    // 页面坐标系以 CSS 像素计;帧是设备像素,按 metadata 的 deviceWidth 归一
    const pageWidth = meta?.deviceWidth || canvas.width;
    const pageHeight = meta?.deviceHeight || canvas.height;
    return {
      x: ((e.clientX - rect.left) / rect.width) * pageWidth,
      y: ((e.clientY - rect.top) / rect.height) * pageHeight,
    };
  }, []);

  const sendInput = useCallback(
    (event: BrowserInputEvent) => {
      const streaming = streamTabRef.current;
      if (!streaming) return;
      void client.rpc('browser.input', { tabId: streaming, event }).catch(() => undefined);
    },
    [client],
  );

  const onMouse = useCallback(
    (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved') =>
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const point = toPagePoint(e);
        if (!point) return;
        sendInput({
          kind: 'mouse',
          type,
          x: point.x,
          y: point.y,
          button: type === 'mouseMoved' ? 'none' : (MOUSE_BUTTONS[e.button] ?? 'left'),
          clickCount: type === 'mouseMoved' ? 0 : e.detail || 1,
          modifiers: modifiersOf(e),
        });
      },
    [sendInput, toPagePoint],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const point = toPagePoint(e);
      if (!point) return;
      sendInput({
        kind: 'mouse',
        type: 'mouseWheel',
        x: point.x,
        y: point.y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        modifiers: modifiersOf(e),
      });
    },
    [sendInput, toPagePoint],
  );

  const onKey = useCallback(
    (type: 'keyDown' | 'keyUp') => (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      // 预览区拿到焦点时,按键归远端页面——别让它顺带触发本地快捷键
      e.preventDefault();
      e.stopPropagation();
      sendInput({
        kind: 'key',
        type,
        key: e.key,
        code: e.code,
        modifiers: modifiersOf(e),
      });
      // 可打印字符另发一次 char:CDP 的 keyDown 不会自己插入文本
      if (type === 'keyDown' && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        sendInput({ kind: 'key', type: 'char', text: e.key, modifiers: modifiersOf(e) });
      }
    },
    [sendInput],
  );

  return (
    <div className="cloud-browser-preview" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="cloud-browser-preview__canvas"
        tabIndex={0}
        onMouseDown={onMouse('mousePressed')}
        onMouseUp={onMouse('mouseReleased')}
        onMouseMove={onMouse('mouseMoved')}
        onWheel={onWheel}
        onKeyDown={onKey('keyDown')}
        onKeyUp={onKey('keyUp')}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!live && !error && (
        <div className="cloud-browser-preview__overlay">{t('Connecting to the cloud browser…')}</div>
      )}
      {error && (
        <div className="cloud-browser-preview__overlay cloud-browser-preview__overlay--error">
          {error}
        </div>
      )}
    </div>
  );
}

export default CloudBrowserPreview;
