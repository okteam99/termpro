// 查看窗口入口:files(文件内容窗口,多 tab)/ diff(git diff,模态)。
import './viewer.css';
import { useEffect } from 'react';
import { hostClient } from '../../services/hostClient';
import { tildify } from '../../state/store';
import { DiffPanel } from './DiffPanel';
import { FilesWindow } from './FilesWindow';
import { isRemoteHost } from './viewerHost';
import { useViewerConnection } from './useViewerConnection';
import { t } from '../../../shared/i18n';

export type ViewerPayload =
  | {
      mode: 'files';
      initialPath: string;
      initialKind?: 'file' | 'dir';
      /** 缺省/'local' = 本机;远程 = workspace 的 configId(一窗一 host) */
      hostId?: string;
    }
  | {
      mode: 'diff';
      toplevel: string;
      baseRef: string | null;
      /** 打开时初选的文件(toplevel 相对路径) */
      initialPath?: string;
      /** 缺省/'local' = 本机;远程 = workspace 的 configId */
      hostId?: string;
    };

export function ViewerWindow({ payload }: { payload: ViewerPayload }) {
  if (payload.mode === 'files') {
    return (
      <FilesWindow
        initialPath={payload.initialPath}
        initialKind={payload.initialKind ?? 'file'}
        hostId={payload.hostId}
      />
    );
  }
  return <DiffWindow payload={payload} />;
}

function DiffWindow({
  payload,
}: {
  payload: Extract<ViewerPayload, { mode: 'diff' }>;
}) {
  const { ready, error, disconnected, refreshing, refresh } = useViewerConnection(payload.hostId);

  useEffect(() => {
    if (!ready) return;
    const homedir = hostClient.info?.homedir;
    const base = `Diff · ${tildify(payload.toplevel, homedir)}`;
    document.title = payload.baseRef
      ? `${base} · vs ${payload.baseRef}`
      : `${base} · ${t('Uncommitted changes')}`;
  }, [ready, payload]);

  // Esc / ⌘W 关窗(模态生命周期由 main 管)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      window.close();
    };
    window.addEventListener('keydown', onKey);
    const offMenu = window.okwork.onMenu((action) => {
      if (action === 'close-tab') window.close();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      offMenu();
    };
  }, []);

  if (error) {
    return (
      <div className="viewer-window">
        <div className="viewer-message">{t('Host connection failed: {error}', { error })}</div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="viewer-window">
        <div className="viewer-message">{t('Connecting to host…')}</div>
      </div>
    );
  }

  const homedir = hostClient.info?.homedir;
  const title = `Diff · ${tildify(payload.toplevel, homedir)}${payload.baseRef ? ` · vs ${payload.baseRef}` : ` · ${t('Uncommitted changes')}`}`;

  return (
    <div className="viewer-window">
      <div className="viewer-header">
        <span className="viewer-title" title={title}>
          {title}
        </span>
        <div className="viewer-actions">
          {/* 「默认应用打开」是本机 OS 动作:远程仓库路径交给本机 shell 会静默作用于
              本机同名目录(D-7 误路由),远程窗口直接不渲染该入口 */}
          {!isRemoteHost(payload.hostId) && (
            <button
              className="viewer-btn"
              onClick={() => window.okwork.openPath(payload.toplevel)}
              title={t('Open the repo directory with the default app')}
            >
              {t('Open with default app')}
            </button>
          )}
          <button
            className="viewer-btn viewer-btn--close"
            onClick={() => window.close()}
            title="Esc"
          >
            ×
          </button>
        </div>
      </div>
      {disconnected && (
        <div className="viewer-disconnected" role="status">
          <span className="viewer-disconnected__text">
            {t('Disconnected from host · your open files are kept')}
          </span>
          <button className="viewer-btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? t('Reconnecting…') : t('Refresh')}
          </button>
        </div>
      )}
      <DiffPanel
        toplevel={payload.toplevel}
        baseRef={payload.baseRef}
        initialPath={payload.initialPath}
      />
    </div>
  );
}
