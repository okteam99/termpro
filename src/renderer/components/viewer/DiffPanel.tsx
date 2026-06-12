// DiffPanel: changed-files list + Monaco diff editor (lazy-loaded).

import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import type { Monaco } from '../../monaco/setup';
import type * as monacoNs from 'monaco-editor';
import type { GitStatusEntry, GitFileStatus } from '../../../shared/protocol';

interface Props {
  toplevel: string;
  baseRef: string | null;
  /** 打开时初选的文件(toplevel 相对路径);仅首轮列表加载生效 */
  initialPath?: string;
}

// path helpers
function joinPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : parent + '/' + name;
}

// Status letter + color class
function statusLetter(status: GitFileStatus): string {
  switch (status) {
    case 'modified':   return 'M';
    case 'added':      return 'A';
    case 'deleted':    return 'D';
    case 'renamed':    return 'R';
    case 'untracked':  return 'U';
    case 'ignored':    return 'I';
    case 'conflicted': return 'C';
  }
}

function statusColorClass(status: GitFileStatus): string {
  switch (status) {
    case 'modified':   return 'diff-status--modified';
    case 'added':      return 'diff-status--added';
    case 'deleted':    return 'diff-status--deleted';
    case 'renamed':    return 'diff-status--renamed';
    case 'untracked':  return 'diff-status--untracked';
    case 'ignored':    return 'diff-status--ignored';
    case 'conflicted': return 'diff-status--conflicted';
  }
}

type LoadPhase = 'idle' | 'loading' | 'error';

interface SideState {
  phase: LoadPhase;
  message?: string;
}

export function DiffPanel({ toplevel, baseRef, initialPath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 初选只消费一次:之后的 ⟳ 重载回到「选第一条」的默认行为
  const initialPathRef = useRef<string | null>(initialPath ?? null);

  // List state
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [mergeBase, setMergeBase] = useState<string | null>(null);
  const [listPhase, setListPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Side-load state (for showing loading/error inside the diff area)
  const [sideState, setSideState] = useState<SideState>({ phase: 'idle' });

  // Monaco refs — persistent across selections
  const monacoRef = useRef<Monaco | null>(null);
  const diffEditorRef = useRef<monacoNs.editor.IDiffEditor | null>(null);
  const origModelRef = useRef<monacoNs.editor.ITextModel | null>(null);
  const modModelRef = useRef<monacoNs.editor.ITextModel | null>(null);

  // Epoch counters: one for list fetches, one for side loads
  const listEpochRef = useRef(0);
  const sideEpochRef = useRef(0);

  // --- list fetch ---
  const fetchList = useCallback(async (epoch: number) => {
    setListPhase('loading');
    setListError('');
    setEntries([]);
    setMergeBase(null);
    setSelected(null);
    try {
      const res = await hostClient.rpc('git.changedFiles', {
        toplevel,
        baseRef: baseRef ?? undefined,
      });
      if (listEpochRef.current !== epoch) return;
      setEntries(res.entries);
      setMergeBase(res.mergeBase);
      setListPhase('ready');
      // 有初选且仍在列表中 → 选它;否则选第一条
      const want = initialPathRef.current;
      initialPathRef.current = null;
      const hit =
        want && res.entries.some((e) => e.path === want) ? want : null;
      if (hit) setSelected(hit);
      else if (res.entries.length > 0) setSelected(res.entries[0].path);
    } catch (e) {
      if (listEpochRef.current !== epoch) return;
      setListPhase('error');
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, [toplevel, baseRef]);

  // Re-fetch list on mount / toplevel / baseRef change
  useEffect(() => {
    const epoch = ++listEpochRef.current;
    void fetchList(epoch);
  }, [fetchList]);

  // --- Monaco editor setup (once, on mount) ---
  useEffect(() => {
    let disposed = false;

    async function bootEditor() {
      let monaco: Monaco;
      try {
        monaco = (await import('../../monaco/setup')).default;
      } catch {
        return;
      }
      if (disposed) return;
      monacoRef.current = monaco;
      const el = hostRef.current;
      if (!el) return;

      const editor = monaco.editor.createDiffEditor(el, {
        theme: 'termpro-dark',
        readOnly: true,
        renderSideBySide: true,
        automaticLayout: true,
        fontSize: 12,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });
      diffEditorRef.current = editor;
    }

    void bootEditor();

    return () => {
      disposed = true;
      origModelRef.current?.dispose();
      origModelRef.current = null;
      modModelRef.current?.dispose();
      modModelRef.current = null;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  // --- Side load when selection or mergeBase changes ---
  useEffect(() => {
    if (!selected) return;
    const entry = entries.find((e) => e.path === selected);
    if (!entry) return;

    const epoch = ++sideEpochRef.current;
    setSideState({ phase: 'loading' });

    async function loadSides() {
      if (!entry) return;
      const monaco = monacoRef.current;
      const diffEditor = diffEditorRef.current;

      // Wait for monaco to be available (it boots async)
      if (!monaco || !diffEditor) {
        // Retry after a short tick — editor may still be loading
        let attempts = 0;
        while ((!monacoRef.current || !diffEditorRef.current) && attempts < 50) {
          await new Promise<void>((r) => setTimeout(r, 100));
          attempts++;
          if (sideEpochRef.current !== epoch) return;
        }
        if (!monacoRef.current || !diffEditorRef.current) {
          setSideState({ phase: 'error', message: 'Monaco 加载失败' });
          return;
        }
      }

      const mc = monacoRef.current!;
      const de = diffEditorRef.current!;

      // Determine ref for original side
      const origRef = mergeBase ?? 'HEAD';
      const skipOrig = entry.status === 'untracked' || entry.status === 'added';
      const skipMod = entry.status === 'deleted';

      // Fetch both sides concurrently
      const [origResult, modResult] = await Promise.allSettled([
        skipOrig
          ? Promise.resolve({ content: '' })
          : hostClient
              .rpc('git.show', { toplevel, ref: origRef, path: entry.path })
              .then((r) => ({ content: r.content ?? '' })),
        skipMod
          ? Promise.resolve({ content: '' })
          : hostClient
              .rpc('fs.readFile', { path: joinPath(toplevel, entry.path) })
              .then((r) => {
                if (r.content === null) {
                  if (r.binary) throw new Error('二进制文件,无法预览');
                  throw new Error(
                    `文件过大(${(r.size / 1024 / 1024).toFixed(1)} MB > 2MB)`,
                  );
                }
                return { content: r.content };
              }),
      ]);

      if (sideEpochRef.current !== epoch) return;

      if (origResult.status === 'rejected') {
        setSideState({
          phase: 'error',
          message: `原始内容加载失败:${origResult.reason instanceof Error ? origResult.reason.message : String(origResult.reason)}`,
        });
        return;
      }
      if (modResult.status === 'rejected') {
        setSideState({
          phase: 'error',
          message: `${modResult.reason instanceof Error ? modResult.reason.message : String(modResult.reason)}`,
        });
        return;
      }

      const origContent = origResult.value.content;
      const modContent = modResult.value.content;

      // Dispose old models
      origModelRef.current?.dispose();
      modModelRef.current?.dispose();

      // Create new models with synthetic URIs to avoid collisions
      const origUri = mc.Uri.parse(
        `termpro-diff://orig/${encodeURIComponent(entry.path)}`,
      );
      const modUri = mc.Uri.parse(
        `termpro-diff://mod/${encodeURIComponent(entry.path)}`,
      );
      mc.editor.getModel(origUri)?.dispose();
      mc.editor.getModel(modUri)?.dispose();

      const origModel = mc.editor.createModel(origContent, undefined, origUri);
      const modModel = mc.editor.createModel(modContent, undefined, modUri);
      origModelRef.current = origModel;
      modModelRef.current = modModel;

      if (sideEpochRef.current !== epoch) {
        origModel.dispose();
        modModel.dispose();
        return;
      }

      de.setModel({ original: origModel, modified: modModel });
      setSideState({ phase: 'idle' });
    }

    void loadSides();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mergeBase, toplevel]);

  const handleReload = useCallback(() => {
    const epoch = ++listEpochRef.current;
    void fetchList(epoch);
  }, [fetchList]);

  const modeLabel = baseRef
    ? `vs ${baseRef}(merge-base)`
    : '未提交变更(vs HEAD)';

  return (
    <div className="diff-layout">
      {/* Left: file list */}
      <div className="diff-files">
        {/* Header strip */}
        <div className="diff-files__header">
          <span className="diff-files__mode" title={modeLabel}>{modeLabel}</span>
          <button
            className="diff-files__reload"
            onClick={handleReload}
            title="重新加载变更列表"
          >
            ⟳
          </button>
        </div>

        {/* List body */}
        {listPhase === 'loading' && (
          <div className="diff-files__message">加载中…</div>
        )}
        {listPhase === 'error' && (
          <div className="diff-files__message diff-files__message--error">{listError}</div>
        )}
        {listPhase === 'ready' && entries.length === 0 && (
          <div className="diff-files__message">无变更</div>
        )}
        {listPhase === 'ready' && entries.map((entry) => (
          <div
            key={entry.path}
            className={`diff-file-row${selected === entry.path ? ' diff-file-row--selected' : ''}`}
            onClick={() => setSelected(entry.path)}
            title={entry.path}
          >
            <span className={`diff-status ${statusColorClass(entry.status)}`}>
              {statusLetter(entry.status)}
            </span>
            <span className="diff-file-row__path">{entry.path}</span>
          </div>
        ))}
      </div>

      {/* Right: Monaco diff editor */}
      <div className="diff-editor-host" style={{ position: 'relative' }}>
        {/* Overlay messages */}
        {(sideState.phase !== 'idle' || (listPhase === 'ready' && entries.length === 0)) && (
          <div className="viewer-message">
            {sideState.phase === 'loading'
              ? '加载中…'
              : sideState.phase === 'error'
              ? sideState.message
              : listPhase === 'ready' && entries.length === 0
              ? '无变更'
              : null}
          </div>
        )}
        <div
          ref={hostRef}
          style={{
            position: 'absolute',
            inset: 0,
            visibility:
              sideState.phase === 'idle' && !(listPhase === 'ready' && entries.length === 0)
                ? 'visible'
                : 'hidden',
          }}
        />
      </div>
    </div>
  );
}
