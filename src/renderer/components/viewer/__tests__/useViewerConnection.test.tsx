// @vitest-environment jsdom
// 掉线不清空:就绪后 host 退出 → disconnected(保内容)而非 error(整窗清空);refresh 走 reconnect。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => {
  let downCb: (() => void) | null = null;
  return {
    onDown: vi.fn((cb: () => void) => {
      downCb = cb;
      return () => {
        downCb = null;
      };
    }),
    fireDown: () => downCb?.(),
    resetDown: () => {
      downCb = null;
    },
    connectViewerHost: vi.fn(),
    reconnectViewerHost: vi.fn(),
  };
});
vi.mock('../../../services/hostClient', () => ({ hostClient: { onDown: h.onDown } }));
vi.mock('../viewerHost', () => ({
  connectViewerHost: h.connectViewerHost,
  reconnectViewerHost: h.reconnectViewerHost,
  isRemoteHost: () => false,
}));

import { useViewerConnection } from '../useViewerConnection';

const connectViewerHost = h.connectViewerHost;
const reconnectViewerHost = h.reconnectViewerHost;

afterEach(() => {
  cleanup();
  h.resetDown();
  connectViewerHost.mockReset();
  reconnectViewerHost.mockReset();
  h.onDown.mockClear();
});

describe('useViewerConnection', () => {
  it('初次连上 → ready;之后 host 退出 → disconnected(不 error,内容保留)', async () => {
    connectViewerHost.mockResolvedValue({ homedir: '/h' });
    const { result } = renderHook(() => useViewerConnection('local'));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.disconnected).toBe(false);

    // host 退出
    act(() => h.fireDown());
    expect(result.current.disconnected).toBe(true);
    expect(result.current.error).toBeNull(); // 关键:不整窗清空
    expect(result.current.ready).toBe(true); // 内容仍挂载
  });

  it('refresh → reconnectViewerHost;成功清 disconnected', async () => {
    connectViewerHost.mockResolvedValue({ homedir: '/h' });
    reconnectViewerHost.mockResolvedValue({ homedir: '/h' });
    const { result } = renderHook(() => useViewerConnection('local'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => h.fireDown());
    expect(result.current.disconnected).toBe(true);

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.disconnected).toBe(false));
    expect(reconnectViewerHost).toHaveBeenCalledWith('local');
  });

  it('初次连接就失败 → error(整窗错误屏,无内容可留)', async () => {
    connectViewerHost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useViewerConnection('local'));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.ready).toBe(false);
    expect(result.current.disconnected).toBe(false);
  });

  it('refresh 失败 → 保留 disconnected 横幅(可再试),不抛', async () => {
    connectViewerHost.mockResolvedValue({ homedir: '/h' });
    reconnectViewerHost.mockRejectedValue(new Error('still down'));
    const { result } = renderHook(() => useViewerConnection('local'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => h.fireDown());

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.disconnected).toBe(true); // 仍显示横幅
  });
});
