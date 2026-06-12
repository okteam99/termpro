// 查看窗口入口:files(文件内容窗口,多 tab)/ diff(git diff,模态)。
import './viewer.css';
import { useEffect, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { tildify } from '../../state/store';
import { DiffPanel } from './DiffPanel';
import { FilesWindow } from './FilesWindow';

export type ViewerPayload =
  | { mode: 'files'; initialPath: string }
  | { mode: 'diff'; toplevel: string; baseRef: string | null };

export function ViewerWindow({ payload }: { payload: ViewerPayload }) {
  if (payload.mode === 'files') {
    return <FilesWindow initialPath={payload.initialPath} />;
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
      setError('Host 进程已退出,⌘R 重载窗口可恢复'),
    );
  }, []);

  useEffect(() => {
    if (!ready) return;
    const homedir = hostClient.info?.homedir;
    const base = `Diff · ${tildify(payload.toplevel, homedir)}`;
    document.title = payload.baseRef
      ? `${base} · vs ${payload.baseRef}`
      : `${base} · 未提交变更`;
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
  const title = `Diff · ${tildify(payload.toplevel, homedir)}${payload.baseRef ? ` · vs ${payload.baseRef}` : ' · 未提交变更'}`;

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
            title="用系统默认应用打开仓库目录"
          >
            系统应用打开
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
      <DiffPanel toplevel={payload.toplevel} baseRef={payload.baseRef} />
    </div>
  );
}
