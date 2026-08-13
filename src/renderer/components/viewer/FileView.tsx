// 文件查看 / 轻编辑(Monaco 懒加载);图片直接内嵌预览。
// 重编辑/重型素材请用「系统应用打开」。

import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { hostClient } from '../../services/hostClient';
import type { Monaco } from '../../monaco/setup';
import type * as monacoNs from 'monaco-editor';
import { t } from '../../../shared/i18n';
import { DownloadAction } from './DownloadAction';
import { isRemoteHost } from './viewerHost';

interface Props {
  path: string;
  /** 本窗口连的 host(缺省/'local' = 本机);远程 + 不能预览 → 给「下载到本机」兜底 */
  hostId?: string;
  /** 保存状态回传给 header(脏标记/保存按钮) */
  onDirtyChange?(dirty: boolean): void;
  registerSave?(fn: (() => void) | null): void;
  /** 暴露当前编辑器内容(markdown 预览读取未保存修改用) */
  registerGetValue?(fn: (() => string) | null): void;
  /** 保存成功后触发(HTML 预览据此 reloadSeq+1,让盖在上面的 <webview> 拿新盘内容) */
  onSaved?(): void;
}

type LoadState =
  | { phase: 'loading' }
  /** unpreviewable = 文件本身预览不了(二进制/超限),而非加载/保存出错——
   *  只有这一支才挂「下载到本机」兜底,保存失败之类的错误不该长出下载按钮 */
  | { phase: 'error'; message: string; unpreviewable?: boolean }
  | { phase: 'ready' };

/** 可内嵌 <img> 渲染的图片类型(icns 等浏览器不认的仍走系统应用) */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

const SVG_MIME = 'image/svg+xml';

function imageMime(p: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? (IMAGE_MIME[m[1].toLowerCase()] ?? null) : null;
}

/** base64(任意字节)→ UTF-8 文本 */
function decodeBase64Utf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * 消毒 SVG 源用于内联渲染。<img> 把 SVG 当独立 XML 严格解析,缺 xmlns / 用了未声明的
 * xlink 前缀等不合规写法会整张空白(Illustrator/Sketch/sprite 导出常见);内联进 HTML
 * 走宽松解析器自动补命名空间即可正常显示。消毒走与 markdown 预览一致的 svg profile,
 * 剥离 <script>/事件处理器,杜绝内联带来的 XSS。
 */
export function sanitizeSvgForInline(b64: string): string {
  return DOMPurify.sanitize(decodeBase64Utf8(b64), {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

export function FileView(props: Props) {
  const mime = imageMime(props.path);
  // 组件类型不同,路径在图片/文本间切换时 React 自动卸载重建,hooks 安全
  if (mime) {
    return <ImageView path={props.path} mime={mime} hostId={props.hostId} />;
  }
  return <TextFileView {...props} />;
}

/** 预览不了的兜底动作条:远程 → 下载到本机;本机 → 无(头部已有 Finder/默认应用两个入口) */
function UnpreviewableActions({
  path,
  hostId,
}: {
  path: string;
  hostId?: string;
}) {
  if (!isRemoteHost(hostId)) return null;
  return <DownloadAction path={path} />;
}

function ImageView({
  path,
  mime,
  hostId,
}: {
  path: string;
  mime: string;
  hostId?: string;
}) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; message: string; unpreviewable?: boolean }
    | { phase: 'ready'; base64: string; size: number }
  >({ phase: 'loading' });
  const [dims, setDims] = useState<string | null>(null);
  // 非 null = <img> 把该 SVG 当独立 XML 解析失败,改内联渲染消毒后的源(见 sanitizeSvgForInline)
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    setState({ phase: 'loading' });
    setDims(null);
    setSvgHtml(null);
    hostClient.rpc('fs.readFileBinary', { path }).then(
      (r) => {
        if (disposed) return;
        if (r.base64 === null) {
          setState({
            phase: 'error',
            message: t('Image too large ({size}MB > 20MB), please open with the default app', {
              size: (r.size / 1024 / 1024).toFixed(1),
            }),
            unpreviewable: true,
          });
          return;
        }
        setState({ phase: 'ready', base64: r.base64, size: r.size });
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
  }, [path, mime]);

  // 消毒后的 SVG 经 ref 注入(与 markdown 预览一致,不用 dangerouslySetInnerHTML)
  useEffect(() => {
    const el = svgHostRef.current;
    if (el) el.innerHTML = svgHtml ?? '';
  }, [svgHtml]);

  if (state.phase !== 'ready') {
    const unpreviewable = state.phase === 'error' && state.unpreviewable;
    return (
      <div className="viewer-body">
        <div className={`viewer-message${unpreviewable ? ' viewer-message--column' : ''}`}>
          {state.phase === 'loading' ? t('Loading…') : state.message}
          {unpreviewable && <UnpreviewableActions path={path} hostId={hostId} />}
        </div>
      </div>
    );
  }
  const kb = state.size / 1024;
  const sizeText =
    kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.ceil(kb)} KB`;

  // <img> 解析失败回退:内联消毒后的 SVG(救回缺命名空间等不合规写法)
  if (svgHtml !== null) {
    return (
      <div className="viewer-body viewer-body--image">
        <div ref={svgHostRef} className="viewer-image-wrap viewer-svg-inline" />
        <div className="viewer-image-meta">{sizeText} · SVG</div>
      </div>
    );
  }

  const triggerSvgFallback = () => {
    if (mime === SVG_MIME) setSvgHtml(sanitizeSvgForInline(state.base64));
  };
  return (
    <div className="viewer-body viewer-body--image">
      <div className="viewer-image-wrap">
        <img
          className="viewer-image"
          src={`data:${mime};base64,${state.base64}`}
          alt={path}
          onLoad={(e) => {
            const img = e.currentTarget;
            // SVG 报 0×0 = 当作独立 XML 解析失败(缺命名空间等)→ 内联消毒渲染兜底
            if (img.naturalWidth && img.naturalHeight) {
              setDims(`${img.naturalWidth}×${img.naturalHeight}`);
            } else {
              triggerSvgFallback();
            }
          }}
          onError={triggerSvgFallback}
        />
      </div>
      <div className="viewer-image-meta">
        {dims ? `${dims} · ` : ''}
        {sizeText}
      </div>
    </div>
  );
}

function TextFileView({
  path,
  hostId,
  onDirtyChange,
  registerSave,
  registerGetValue,
  onSaved,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const savedVersionRef = useRef(0);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let disposed = false;
    let editor: monacoNs.editor.IStandaloneCodeEditor | null = null;
    let model: monacoNs.editor.ITextModel | null = null;
    setState({ phase: 'loading' });

    async function boot() {
      let monaco: Monaco;
      try {
        monaco = (await import('../../monaco/setup')).default;
      } catch (e) {
        if (!disposed) setState({ phase: 'error', message: String(e) });
        return;
      }
      let file: Awaited<ReturnType<typeof load>>;
      async function load() {
        return hostClient.rpc('fs.readFile', { path });
      }
      try {
        file = await load();
      } catch (e) {
        if (!disposed) {
          setState({
            phase: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      if (disposed) return;
      if (file.content === null) {
        setState({
          phase: 'error',
          message: file.binary
            ? t('Binary file, cannot preview (open in an external editor instead)')
            : t('File too large ({size}MB > 2MB), please open in an external editor', {
                size: (file.size / 1024 / 1024).toFixed(1),
              }),
          unpreviewable: true,
        });
        return;
      }
      const el = containerRef.current;
      if (!el) return;

      // 复用 Uri 对应的旧 model 会带着旧内容,直接销毁重建
      const uri = monaco.Uri.file(path);
      monaco.editor.getModel(uri)?.dispose();
      model = monaco.editor.createModel(file.content, undefined, uri);
      editor = monaco.editor.create(el, {
        model,
        theme: 'okwork-dark',
        fontSize: 12,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: 'none',
      });
      editorRef.current = editor;
      savedVersionRef.current = model.getAlternativeVersionId();
      onDirtyChange?.(false);

      model.onDidChangeContent(() => {
        onDirtyChange?.(
          model!.getAlternativeVersionId() !== savedVersionRef.current,
        );
      });

      const save = () => {
        const m = editor?.getModel();
        if (!m) return;
        const content = m.getValue();
        void hostClient
          .rpc('fs.writeFile', { path, content })
          .then(() => {
            savedVersionRef.current = m.getAlternativeVersionId();
            onDirtyChange?.(false);
            onSaved?.();
          })
          .catch((e) => {
            setState({
              phase: 'error',
              message: t('Save failed: {error}', {
                error: e instanceof Error ? e.message : String(e),
              }),
            });
          });
      };
      registerSave?.(save);
      registerGetValue?.(() => editor?.getModel()?.getValue() ?? '');
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);

      setState({ phase: 'ready' });
    }

    void boot();
    return () => {
      disposed = true;
      registerSave?.(null);
      registerGetValue?.(null);
      editor?.dispose();
      model?.dispose();
      editorRef.current = null;
    };
  }, [path]);

  return (
    <div className="viewer-body">
      {state.phase !== 'ready' && (
        <div
          className={`viewer-message${
            state.phase === 'error' && state.unpreviewable
              ? ' viewer-message--column'
              : ''
          }`}
        >
          {state.phase === 'loading' ? t('Loading…') : state.message}
          {state.phase === 'error' && state.unpreviewable && (
            <UnpreviewableActions path={path} hostId={hostId} />
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className="viewer-editor"
        style={{ visibility: state.phase === 'ready' ? 'visible' : 'hidden' }}
      />
    </div>
  );
}
