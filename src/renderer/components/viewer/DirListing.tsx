// 目录 listing:markdown 里点到目录链接(或在列表里点子目录)时展示该目录下所有条目。
// 点条目 → 经 openViewerWindow 在本窗口开新 tab(文件开内容 tab,目录开 listing tab)。
import { useEffect, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { tildify } from '../../state/store';
import type { DirEntry } from '../../../shared/protocol';
import { t } from '../../../shared/i18n';

function parentOf(p: string): string {
  const t = p.replace(/\/+$/, '');
  const i = t.lastIndexOf('/');
  return i <= 0 ? '/' : t.slice(0, i);
}
const joinPath = (dir: string, name: string) =>
  `${dir.replace(/\/+$/, '')}/${name}`;

/** 目录优先,组内大小写不敏感排序 */
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    const ad = a.kind === 'dir' ? 0 : 1;
    const bd = b.kind === 'dir' ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return a.name.localeCompare(b.name);
  });
}

function openEntry(abs: string, kind: DirEntry['kind']): void {
  // 软链类型未知 → stat 后再分流;其余按已知 kind 直接开
  if (kind === 'symlink') {
    void hostClient.rpc('fs.stat', { path: abs }).then(
      (r) => {
        if (r.kind) {
          window.termpro.openViewerWindow({
            mode: r.kind === 'dir' ? 'dir' : 'file',
            path: abs,
          });
        }
      },
      () => undefined,
    );
    return;
  }
  window.termpro.openViewerWindow({
    mode: kind === 'dir' ? 'dir' : 'file',
    path: abs,
  });
}

export function DirListing({ path }: { path: string }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; entries: DirEntry[] }
  >({ phase: 'loading' });

  useEffect(() => {
    let disposed = false;
    setState({ phase: 'loading' });
    hostClient.rpc('fs.readdir', { path }).then(
      (r) => {
        if (!disposed) setState({ phase: 'ready', entries: sortEntries(r.entries) });
      },
      (e) => {
        if (!disposed) {
          setState({
            phase: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, [path]);

  const homedir = hostClient.info?.homedir;
  const atRoot = path.replace(/\/+$/, '') === '';

  return (
    <div className="viewer-body dir-listing">
      <div className="dir-listing-path" title={path}>
        {tildify(path, homedir)}
      </div>
      {state.phase === 'loading' && (
        <div className="viewer-message">{t('Loading…')}</div>
      )}
      {state.phase === 'error' && (
        <div className="viewer-message">{state.message}</div>
      )}
      {state.phase === 'ready' && (
        <div className="dir-listing-rows">
          {!atRoot && (
            <button
              className="dir-row dir-row--up"
              onClick={() =>
                window.termpro.openViewerWindow({
                  mode: 'dir',
                  path: parentOf(path),
                })
              }
            >
              <FolderGlyph />
              <span className="dir-row-name">..</span>
            </button>
          )}
          {state.entries.length === 0 && (
            <div className="dir-listing-empty">{t('(empty directory)')}</div>
          )}
          {state.entries.map((e) => (
            <button
              key={e.name}
              className="dir-row"
              title={e.name}
              onClick={() => openEntry(joinPath(path, e.name), e.kind)}
            >
              {e.kind === 'dir' ? <FolderGlyph /> : <FileGlyph />}
              <span className="dir-row-name">{e.name}</span>
              {e.kind === 'symlink' && <span className="dir-row-tag">↪</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 复用主面板视觉语言的极简描边图标(14px)
function FolderGlyph() {
  return (
    <svg
      className="dir-row-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M1.8 4.2h4l1.4 1.6h7v6.6a.8.8 0 0 1-.8.8H1.8a.8.8 0 0 1-.8-.8V5a.8.8 0 0 1 .8-.8Z" />
    </svg>
  );
}
function FileGlyph() {
  return (
    <svg
      className="dir-row-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <path d="M4 1.8h5l3 3v9.4a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.6a.8.8 0 0 1 .8-.8Z" />
      <path d="M9 1.8v3.2h3" />
    </svg>
  );
}
