// 中央查看器壳:覆盖终端区,Esc / × 关闭。
// 内容:file → FileView;diff → DiffPanel(U3)。

import './viewer.css';
import { useEffect, useRef, useState } from 'react';
import { useAppStore, tildify } from '../../state/store';
import { hostClient } from '../../services/hostClient';
import { FileView } from './FileView';
import { DiffPanel } from './DiffPanel';

export function ViewerOverlay() {
  const viewer = useAppStore((s) => s.viewer);
  const closeViewer = useAppStore((s) => s.closeViewer);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 冒泡阶段 + 跳过来自 Monaco 内部的 Esc(查找框/多光标/IME 需要它)
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      closeViewer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, closeViewer]);

  if (!viewer) return null;

  const homedir = hostClient.info?.homedir;
  const title =
    viewer.mode === 'file'
      ? tildify(viewer.path, homedir)
      : `Diff · ${tildify(viewer.toplevel, homedir)}${viewer.baseRef ? ` · vs ${viewer.baseRef}` : ' · 未提交变更'}`;

  const openIn = (editor: 'vscode' | 'zed') => {
    const target = viewer.mode === 'file' ? viewer.path : viewer.toplevel;
    window.termpro.openInEditor(editor, target);
  };

  return (
    <div className="viewer-overlay">
      <div className="viewer-header">
        <span className="viewer-title" title={title}>
          {title}
          {dirty ? ' ●' : ''}
        </span>
        <div className="viewer-actions">
          {viewer.mode === 'file' && (
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
            onClick={closeViewer}
            title="Esc"
          >
            ×
          </button>
        </div>
      </div>
      {viewer.mode === 'file' ? (
        <FileView
          path={viewer.path}
          onDirtyChange={setDirty}
          registerSave={(fn) => {
            saveRef.current = fn;
          }}
        />
      ) : (
        <DiffPanel toplevel={viewer.toplevel} baseRef={viewer.baseRef} />
      )}
    </div>
  );
}
