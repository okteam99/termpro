// 查看窗口入口:files(文件内容窗口,多 tab)/ diff(git diff,模态)。
import './viewer.css';
import { useEffect, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { tildify } from '../../state/store';
import { DiffPanel } from './DiffPanel';
import { FilesWindow } from './FilesWindow';
import { t } from '../../../shared/i18n';

export type ViewerPayload =
  | { mode: 'files'; initialPath: string; initialKind?: 'file' | 'dir' }
  | {
      mode: 'diff';
      toplevel: string;
      baseRef: string | null;
      /** 打开时初选的文件(toplevel 相对路径) */
      initialPath?: string;
    };

export function ViewerWindow({ payload }: { payload: ViewerPayload }) {
  if (payload.mode === 'files') {
    return (
      <FilesWindow
        initialPath={payload.initialPath}
        initialKind={payload.initialKind ?? 'file'}
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hostClient.connect().then(
      () => setReady(true),
      (e) => setError(String(e)),
    );
    return hostClient.onDown(() =>
      setError(t('Host process exited — press ⌘R to reload the window')),
    );
  }, []);

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
    const offMenu = window.termpro.onMenu((action) => {
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
          <button
            className="viewer-btn"
            onClick={() => window.termpro.openPath(payload.toplevel)}
            title={t('Open the repo directory with the default app')}
          >
            {t('Open with default app')}
          </button>
          <button
            className="viewer-btn viewer-btn--close"
            onClick={() => window.close()}
            title="Esc"
          >
            ×
          </button>
        </div>
      </div>
      <DiffPanel
        toplevel={payload.toplevel}
        baseRef={payload.baseRef}
        initialPath={payload.initialPath}
      />
    </div>
  );
}
