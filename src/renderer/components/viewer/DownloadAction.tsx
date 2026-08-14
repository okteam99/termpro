// 查看器的「下载到本机」(用户指令 2026-08-13 / 2026-08-14):
// ① 预览不了时(二进制 / 超上限)在消息旁给一个兜底按钮;
// ② 远程文件在头部 Save 右侧常驻一个下载按钮(所有预览器一视同仁)。
// 本机文件不给这两个入口——那扇窗头部已有 Finder / 默认应用两个本机动作。
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

/** 头部按钮里的终态文案留存时长:够读一眼,又不常驻占位 */
const HEADER_NOTE_TTL_MS = 6000;

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

/**
 * 单文件下载状态机(两种呈现共用):门禁 → stat 复核 → 分块拉取 → 终态文案。
 * 卸载(关 tab / 关窗)即视为取消:runDownload 的分块循环下一轮就退出,并在 finally 里
 * finish({commit:false}) 释放本机写票,不留孤儿 fd 与 .part 文件。
 */
function useFileDownload(path: string) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const canceledRef = useRef(false);
  const aliveRef = useRef(true);

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
        // 传输前贴近实际时刻复核一次(打开时拿到的 size 可能已过期);
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

  const cancel = useCallback(() => {
    canceledRef.current = true;
  }, []);

  const clearMessage = useCallback(() => {
    setPhase((prev) => (prev.kind === 'message' ? { kind: 'idle' } : prev));
  }, []);

  return { phase, start, cancel, clearMessage };
}

/** 预览不了时的兜底动作条:文案 + 「下载到本机」,终态文案常驻(该屏本就没别的内容) */
export function DownloadAction({ path }: { path: string }) {
  const { phase, start, cancel } = useFileDownload(path);

  if (phase.kind === 'running') {
    return (
      <div className="viewer-message-actions">
        <span className="viewer-message-note">
          {t('Downloading… {percent}%', {
            percent: percent(phase.done, phase.total),
          })}
        </span>
        <button className="viewer-btn" onClick={cancel}>
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

/** 头部常驻下载按钮(Save 右侧):进行中显示百分比、点击即取消;终态文案短暂留存后自清 */
export function HeaderDownloadButton({ path }: { path: string }) {
  const { phase, start, cancel, clearMessage } = useFileDownload(path);

  // 头部空间紧,终态文案不常驻:留 6s 够读一眼,之后自动收起(完整文案仍在 title 里)
  useEffect(() => {
    if (phase.kind !== 'message') return;
    const timer = setTimeout(clearMessage, HEADER_NOTE_TTL_MS);
    return () => clearTimeout(timer);
  }, [phase, clearMessage]);

  if (phase.kind === 'running') {
    return (
      <button
        className="viewer-btn"
        onClick={cancel}
        title={t('Cancel')}
      >{`${percent(phase.done, phase.total)}%`}</button>
    );
  }
  return (
    <>
      {phase.kind === 'message' && (
        <span className="viewer-message-note" title={phase.text}>
          {phase.text}
        </span>
      )}
      <button className="viewer-btn" onClick={start} title={t('Download to local')}>
        {t('Download')}
      </button>
    </>
  );
}
