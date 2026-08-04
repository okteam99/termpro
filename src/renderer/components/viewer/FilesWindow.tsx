// 文件内容窗口:所有可编辑文件共用的单窗口多 tab。
// markdown 默认预览(FileView 始终挂载以保留未保存编辑),其他文件直接编辑。
// ⌘W 关当前 tab(关完关窗),Esc 关窗。

import './viewer.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { basename, tildify } from '../../state/store';
import { FileView } from './FileView';
import { MarkdownPreview } from './MarkdownPreview';
import { HtmlPreview } from './HtmlPreview';
import { DirListing } from './DirListing';
import { isRemoteHost } from './viewerHost';
import { useViewerConnection } from './useViewerConnection';
import { isPreviewable } from '../../services/previewUrl';
import { t } from '../../../shared/i18n';

interface FileTab {
  id: string;
  path: string;
  /** dir = 目录 listing tab(无编辑/脏态),file = 文件内容 tab */
  kind: 'file' | 'dir';
  dirty: boolean;
  /** null = 非 markdown/html 或目录(无预览/编辑切换) */
  viewMode: 'preview' | 'edit' | null;
  /** viewMode 非 null 时对应的预览种类;决定盖在 FileView 上面的是哪个预览组件 */
  previewKind: 'md' | 'html' | null;
  /** html 预览根(FilePanel 已知 workspaceRoot/effectiveRoot 时传入);
   *  缺省时 HtmlPreview 自己按 git.info → dirname(path) 回退 */
  previewRoot?: string;
}

const isMarkdown = (p: string) => /\.(md|markdown)$/i.test(p);

export function FilesWindow({
  initialPath,
  initialKind = 'file',
  initialPreviewRoot,
  hostId,
}: {
  initialPath: string;
  initialKind?: 'file' | 'dir';
  initialPreviewRoot?: string;
  /** 缺省/'local' = 本机;远程 = configId(本窗口 hostClient 单例连它) */
  hostId?: string;
}) {
  const remote = isRemoteHost(hostId);
  const { ready, error, disconnected, refreshing, refresh } = useViewerConnection(hostId);
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // html 预览的 reload 触发信号(保存后 +1);md 预览不需要,读的是内存中的编辑器值
  const [reloadSeqs, setReloadSeqs] = useState<Map<string, number>>(new Map());
  const saveFns = useRef(new Map<string, () => void>());
  const getValueFns = useRef(new Map<string, () => string>());
  // beforeunload 守卫用:实时镜像 tabs / 用户已确认放弃修改
  const tabsRef = useRef<FileTab[]>([]);
  tabsRef.current = tabs;
  const closeConfirmedRef = useRef(false);

  // 任何关窗路径(Esc/×/最后一个 tab/红绿灯/⌘R)统一经 beforeunload
  // 拦截:有脏 tab 时先确认,避免无声丢失未保存修改
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (closeConfirmedRef.current) return;
      const dirtyCount = tabsRef.current.filter((t) => t.dirty).length;
      if (dirtyCount === 0) return;
      e.preventDefault();
      e.returnValue = false;
      setTimeout(() => {
        if (
          window.confirm(t('{count} unsaved file(s). Close the window anyway?', { count: dirtyCount }))
        ) {
          closeConfirmedRef.current = true;
          window.close();
        }
      });
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const addOrFocus = useCallback(
    (path: string, kind: 'file' | 'dir', previewRoot?: string) => {
      setTabs((prev) => {
        const existing = prev.find((t) => t.path === path);
        if (existing) {
          setActiveId(existing.id);
          return prev;
        }
        const previewKind: 'md' | 'html' | null =
          kind !== 'file' ? null : isMarkdown(path) ? 'md' : isPreviewable(path) ? 'html' : null;
        const tab: FileTab = {
          id: crypto.randomUUID(),
          path,
          kind,
          dirty: false,
          viewMode: previewKind ? 'preview' : null,
          previewKind,
          ...(previewRoot ? { previewRoot } : {}),
        };
        setActiveId(tab.id);
        return [...prev, tab];
      });
    },
    [],
  );

  useEffect(() => {
    addOrFocus(initialPath, initialKind, initialPreviewRoot);
  }, [initialPath, initialKind, initialPreviewRoot, addOrFocus]);

  // 窗口复用:主窗口/listing 再次开 → main 推送 add-tab(带 kind + 可选 previewRoot)
  useEffect(
    () => window.okwork.onViewerAddTab((t) => addOrFocus(t.path, t.kind, t.previewRoot)),
    [addOrFocus],
  );

  const closeTab = useCallback((id: string) => {
    saveFns.current.delete(id);
    getValueFns.current.delete(id);
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        window.close();
        return next;
      }
      setActiveId((curr) =>
        curr === id ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : curr,
      );
      return next;
    });
  }, []);

  // ⌘W → 关当前 tab
  useEffect(() => {
    return window.okwork.onMenu((action) => {
      if (action === 'close-tab' && activeId) closeTab(activeId);
    });
  }, [activeId, closeTab]);

  // Esc → 关窗(Monaco 内部的 Esc 不拦)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      if (document.querySelector('.md-lightbox')) return; // 放大层自己处理
      window.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const homedir = hostClient.info?.homedir;

  useEffect(() => {
    document.title = active
      ? `${basename(active.path)}${active.dirty ? ' ●' : ''} — OkWork`
      : 'OkWork';
  }, [active]);

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

  const setViewMode = (id: string, mode: 'preview' | 'edit') => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id && t.viewMode ? { ...t, viewMode: mode } : t)),
    );
  };
  const setDirty = (id: string, dirty: boolean) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, dirty } : t)));
  };
  const bumpReloadSeq = (id: string) => {
    setReloadSeqs((prev) => {
      const next = new Map(prev);
      next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
  };

  return (
    <div className="viewer-window">
      <div className="viewer-header files-header">
        <div className="files-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`files-tab${tab.id === activeId ? ' files-tab--active' : ''}`}
              title={tildify(tab.path, homedir)}
              onClick={() => setActiveId(tab.id)}
            >
              <span className="files-tab-name">
                {basename(tab.path)}
                {tab.dirty ? ' ●' : ''}
              </span>
              <button
                className="files-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                title={t('Close (⌘W)')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="viewer-actions">
          {active?.viewMode && (
            <div className="files-seg">
              <button
                className={`viewer-btn${active.viewMode === 'preview' ? ' viewer-btn--on' : ''}`}
                onClick={() => setViewMode(active.id, 'preview')}
              >
                {t('Preview')}
              </button>
              <button
                className={`viewer-btn${active.viewMode === 'edit' ? ' viewer-btn--on' : ''}`}
                onClick={() => setViewMode(active.id, 'edit')}
              >
                {t('Edit')}
              </button>
            </div>
          )}
          {active?.kind === 'file' && (
            <button
              className="viewer-btn"
              disabled={!active.dirty}
              onClick={() => saveFns.current.get(active.id)?.()}
              title="⌘S"
            >
              {t('Save')}
            </button>
          )}
          {/* 「Finder 中显示」与「默认应用打开」同属本机 OS 动作:远程路径交给本机 shell
              会静默作用于本机同名(但无关)文件——远程窗口直接不渲染这两个入口(D-7)。
              只给文件 tab:目录 tab 的「默认应用打开」本就是拿 Finder 开这个目录,
              再挂一个「跳转所在目录」只会让人分不清两个按钮的差别。 */}
          {active?.kind === 'file' && !remote && (
            <button
              className="viewer-btn"
              onClick={() => window.okwork.showItemInFolder(active.path)}
              title={t('Show in Finder')}
            >
              {t('Reveal in Finder')}
            </button>
          )}
          {active && !remote && (
            <button
              className="viewer-btn"
              onClick={() => window.okwork.openPath(active.path)}
              title={t('Open with the default app')}
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

      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        if (tab.kind === 'dir') {
          return (
            <div
              key={tab.id}
              className="files-body"
              style={{ display: isActive ? 'flex' : 'none' }}
            >
              <DirListing path={tab.path} hostId={hostId} />
            </div>
          );
        }
        const showPreview = tab.viewMode === 'preview';
        return (
          <div
            key={tab.id}
            className="files-body"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            {/* markdown/html:FileView 始终挂载保留未保存编辑;预览盖在上面 */}
            <div
              className="files-pane"
              style={{ display: showPreview ? 'none' : 'flex' }}
            >
              <FileView
                path={tab.path}
                onDirtyChange={(d) => setDirty(tab.id, d)}
                onSaved={() => bumpReloadSeq(tab.id)}
                registerSave={(fn) => {
                  if (fn) saveFns.current.set(tab.id, fn);
                  else saveFns.current.delete(tab.id);
                }}
                registerGetValue={(fn) => {
                  if (fn) getValueFns.current.set(tab.id, fn);
                  else getValueFns.current.delete(tab.id);
                }}
              />
            </div>
            {showPreview && tab.previewKind === 'md' && (
              <div className="files-pane" style={{ display: 'flex' }}>
                <MarkdownPreview
                  path={tab.path}
                  hostId={hostId}
                  getEditorValue={() =>
                    getValueFns.current.get(tab.id)?.() ?? null
                  }
                />
              </div>
            )}
            {showPreview && tab.previewKind === 'html' && (
              <div className="files-pane" style={{ display: 'flex' }}>
                <HtmlPreview
                  path={tab.path}
                  hostId={hostId}
                  previewRoot={tab.previewRoot}
                  reloadSeq={reloadSeqs.get(tab.id) ?? 0}
                  dirty={tab.dirty}
                  onRequestSave={() => saveFns.current.get(tab.id)?.()}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
