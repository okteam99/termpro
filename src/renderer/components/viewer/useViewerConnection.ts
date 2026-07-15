// 查看器窗口的 host 连接态(FilesWindow / DiffWindow 共用)。
// 关键(用户指令 2026-07-15):连接不稳定/host 退出时,**已加载出内容的窗口不清空重载**——
// 保住已打开文档,只标记 disconnected 让窗口挂一条【手动刷新】横幅;绝不自动刷新状态。
// 区分两态:
//  - error:初次连接就失败(内容从未加载)→ 整窗错误屏(无内容可留)。
//  - disconnected:曾就绪后掉线 → 内容保留 + 可手动 refresh(reconnect)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { connectViewerHost, reconnectViewerHost } from './viewerHost';
import { t } from '../../../shared/i18n';

export interface ViewerConnection {
  ready: boolean;
  error: string | null;
  disconnected: boolean;
  refreshing: boolean;
  /** 手动刷新:reconnect(远程重取隧道);成功清 disconnected,失败保留横幅可再试。 */
  refresh: () => void;
}

export function useViewerConnection(hostId: string | undefined): ViewerConnection {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const readyRef = useRef(false);
  readyRef.current = ready;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDisconnected(false);
    connectViewerHost(hostId).then(
      () => {
        if (!cancelled) setReady(true);
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    const off = hostClient.onDown(() => {
      if (cancelled) return;
      // 已就绪(内容已加载)后掉线 → 保内容挂横幅;否则(初次都没连上)才整窗报错
      if (readyRef.current) setDisconnected(true);
      else setError(t('Host process exited — press ⌘R to reload the window'));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [hostId]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    reconnectViewerHost(hostId).then(
      () => {
        setDisconnected(false);
        setRefreshing(false);
      },
      () => {
        setRefreshing(false); // 仍连不上:保留横幅,用户可再点 / ⌘R
      },
    );
  }, [hostId]);

  return { ready, error, disconnected, refreshing, refresh };
}
