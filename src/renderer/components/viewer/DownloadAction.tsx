// 查看器里「不能预览」时的兜底动作(用户指令 2026-08-13):远程文件预览不了
// (二进制 / 超出预览上限,如 mp4)时,给一个「下载到本机」按钮——否则那扇窗里
// 只剩一句死文案,远程文件既看不了也拿不到(本机文件另有 Finder/默认应用两个入口)。
//
// 复用 transferCore.runDownload(与文件面板下载同一套分块 / TOCTOU 基线 / 票据清理),
// 但**不进 transferManager 队列**:查看器是独立渲染进程,进程内的队列与主窗那份互不
// 可见,传输列表 UI 也只在主窗——这里只需单文件的按钮内进度与终态文案。

import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { localTransferBridge } from '../../services/transferManager';
import { runDownload, type TransferFailure } from '../../services/transferCore';
import { TRANSFER } from '../../../shared/protocol';
import { basename } from '../../state/store';
import { t } from '../../../shared/i18n';

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  /** 终态文案(成功/失败/取消/门禁不过);按钮同时保留,可再来一次 */
  | { kind: 'message'; text: string };

/** TRANSFER.maxFileBytes 的人类可读文案(与 FilePanel 同口径) */
function formatByteLimit(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

function failureMessage(reason: TransferFailure, detail?: string): string {
  if (reason === 'canceled') return t('Transfer canceled');
  if (reason === 'file-changed') {
    return t('File changed during transfer — canceled');
  }
  if (reason === 'link-lost') return t('Connection lost during transfer');
  return t('Transfer failed: {error}', { error: detail || reason });
}

function percent(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.floor((done / total) * 100));
}

/** 远程文件「下载到本机」:系统保存对话框选落点 → 分块拉取 → 按钮内进度 + 终态文案 */
export function DownloadAction({ path }: { path: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const canceledRef = useRef(false);
  const aliveRef = useRef(true);

  // 卸载(关 tab / 关窗 / 切文件)即视为取消:runDownload 的分块循环下一轮就退出,
  // 并在 finally 里 finish({commit:false}) 释放本机写票,不留孤儿 fd 与 .part 文件。
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      canceledRef.current = true;
    };
  }, []);

  const start = useCallback(() => {
    // 门禁与文件面板同口径,只是查看器窗口里没有「去远程机设置页」的跳转入口,
    // 故 host 过旧这一支只给确定性文案,不做跳转。
    if (!hostClient.info) {
      setPhase({ kind: 'message', text: t('Remote machine is not connected') });
      return;
    }
    if (!hostClient.supportsTransfer()) {
      setPhase({
        kind: 'message',
        text: t('Remote host is too old — update it in Remote Hosts'),
      });
      return;
    }
    canceledRef.current = false;
    setPhase({ kind: 'running', done: 0, total: 0 });
    void (async () => {
      const settle = (text: string) => {
        if (aliveRef.current) setPhase({ kind: 'message', text });
      };
      let size: number;
      try {
        // 传输前贴近实际时刻复核一次(预览失败时拿到的 size 可能已过期);
        // 大小闸门与文件面板同一条(TRANSFER.maxFileBytes)。
        const stat = await hostClient.rpc('fs.stat', { path });
        if (stat.kind !== 'file') {
          settle(t('Transfer failed: {error}', { error: 'not a regular file' }));
          return;
        }
        size = stat.size ?? 0;
      } catch (err) {
        settle(failureMessage('remote-io', (err as Error)?.message));
        return;
      }
      if (size > TRANSFER.maxFileBytes) {
        settle(
          t('File is too large (limit {limit})', {
            limit: formatByteLimit(TRANSFER.maxFileBytes),
          }),
        );
        return;
      }
      try {
        const res = await runDownload({
          rpc: (method, params) => hostClient.rpc(method, params),
          bridge: localTransferBridge,
          path,
          name: basename(path),
          size,
          onProgress: (done) => {
            if (aliveRef.current) setPhase({ kind: 'running', done, total: size });
          },
          isCanceled: () => canceledRef.current,
        });
        settle(
          res.ok
            ? t('Saved to {path}', { path: res.localPath })
            : failureMessage(res.reason, res.detail),
        );
      } catch (err) {
        settle(failureMessage('local-io', (err as Error)?.message));
      }
    })();
  }, [path]);

  if (phase.kind === 'running') {
    return (
      <div className="viewer-message-actions">
        <span className="viewer-message-note">
          {t('Downloading… {percent}%', {
            percent: percent(phase.done, phase.total),
          })}
        </span>
        <button
          className="viewer-btn"
          onClick={() => {
            canceledRef.current = true;
          }}
        >
          {t('Cancel')}
        </button>
      </div>
    );
  }
  return (
    <div className="viewer-message-actions">
      {phase.kind === 'message' && (
        <span className="viewer-message-note">{phase.text}</span>
      )}
      <button className="viewer-btn" onClick={start}>
        {t('Download to local')}
      </button>
    </div>
  );
}
