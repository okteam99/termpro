// 独立查看器窗口(V3 完整实现)。
import './viewer.css';
import { useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { tildify } from '../../state/store';
import { FileView } from './FileView';
import { DiffPanel } from './DiffPanel';

export type ViewerPayload =
  | { mode: 'file'; path: string }
  | { mode: 'diff'; toplevel: string; baseRef: string | null };

export function ViewerWindow({ payload }: { payload: ViewerPayload }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => void) | null>(null);

  // Connect to host on mount;host 崩溃时给出恢复提示
  useEffect(() => {
    hostClient.connect().then(
      () => setReady(true),
      (e) => setError(String(e)),
    );
    return hostClient.onDown(() =>
      setError('Host 进程已退出,⌘R 重载窗口可恢复'),
    );
  }, []);

  // Set document.title once host is ready (homedir available)
  useEffect(() => {
    if (!ready) return;
    const homedir = hostClient.info?.homedir;
    if (payload.mode === 'file') {
      document.title = tildify(payload.path, homedir);
    } else {
      const base = `Diff · ${tildify(payload.toplevel, homedir)}`;
      document.title = payload.baseRef
        ? `${base} · vs ${payload.baseRef}`
        : `${base} · 未提交变更`;
    }
  }, [ready, payload]);

  // Esc closes the window (skip inside .monaco-editor)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      window.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ⌘W via native menu → close-tab action
  useEffect(() => {
    return window.termpro.onMenu((action) => {
      if (action === 'close-tab') window.close();
    });
  }, []);

  if (error) {
    return (
      <div className="viewer-window">
        <div className="viewer-message">Host 连接失败:{error}</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="viewer-window">
        <div className="viewer-message">连接 Host…</div>
      </div>
    );
  }

  const homedir = hostClient.info?.homedir;
  const title =
    payload.mode === 'file'
      ? tildify(payload.path, homedir)
      : `Diff · ${tildify(payload.toplevel, homedir)}${payload.baseRef ? ` · vs ${payload.baseRef}` : ' · 未提交变更'}`;

  const openIn = (editor: 'vscode' | 'zed') => {
    const target = payload.mode === 'file' ? payload.path : payload.toplevel;
    window.termpro.openInEditor(editor, target);
  };

  return (
    <div className="viewer-window">
      <div className="viewer-header">
        <span className="viewer-title" title={title}>
          {title}
          {dirty ? ' ●' : ''}
        </span>
        <div className="viewer-actions">
          {payload.mode === 'file' && (
            <button
              className="viewer-btn"
              disabled={!dirty}
              onClick={() => saveRef.current?.()}
              title="⌘S"
            >
              保存
            </button>
          )}
          <button className="viewer-btn" onClick={() => openIn('vscode')}>
            VS Code
          </button>
          <button className="viewer-btn" onClick={() => openIn('zed')}>
            Zed
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
      {payload.mode === 'file' ? (
        <FileView
          path={payload.path}
          onDirtyChange={setDirty}
          registerSave={(fn) => {
            saveRef.current = fn;
          }}
        />
      ) : (
        <DiffPanel toplevel={payload.toplevel} baseRef={payload.baseRef} />
      )}
    </div>
  );
}
