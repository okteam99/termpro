// 文件查看 / 轻编辑(Monaco 懒加载);图片直接内嵌预览。
// 重编辑/重型素材请用「系统应用打开」。

import { useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import type { Monaco } from '../../monaco/setup';
import type * as monacoNs from 'monaco-editor';

interface Props {
  path: string;
  /** 保存状态回传给 header(脏标记/保存按钮) */
  onDirtyChange?(dirty: boolean): void;
  registerSave?(fn: (() => void) | null): void;
  /** 暴露当前编辑器内容(markdown 预览读取未保存修改用) */
  registerGetValue?(fn: (() => string) | null): void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
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

function imageMime(p: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? (IMAGE_MIME[m[1].toLowerCase()] ?? null) : null;
}

export function FileView(props: Props) {
  const mime = imageMime(props.path);
  // 组件类型不同,路径在图片/文本间切换时 React 自动卸载重建,hooks 安全
  if (mime) return <ImageView path={props.path} mime={mime} />;
  return <TextFileView {...props} />;
}

function ImageView({ path, mime }: { path: string; mime: string }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; url: string; size: number }
  >({ phase: 'loading' });
  const [dims, setDims] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setState({ phase: 'loading' });
    setDims(null);
    hostClient.rpc('fs.readFileBinary', { path }).then(
      (r) => {
        if (disposed) return;
        if (r.base64 === null) {
          setState({
            phase: 'error',
            message: `图片过大(${(r.size / 1024 / 1024).toFixed(1)}MB > 20MB),请用系统应用打开`,
          });
          return;
        }
        setState({
          phase: 'ready',
          url: `data:${mime};base64,${r.base64}`,
          size: r.size,
        });
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

  if (state.phase !== 'ready') {
    return (
      <div className="viewer-body">
        <div className="viewer-message">
          {state.phase === 'loading' ? '加载中…' : state.message}
        </div>
      </div>
    );
  }
  const kb = state.size / 1024;
  const sizeText =
    kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.ceil(kb)} KB`;
  return (
    <div className="viewer-body viewer-body--image">
      <div className="viewer-image-wrap">
        <img
          className="viewer-image"
          src={state.url}
          alt={path}
          onLoad={(e) => {
            const img = e.currentTarget;
            setDims(`${img.naturalWidth}×${img.naturalHeight}`);
          }}
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
  onDirtyChange,
  registerSave,
  registerGetValue,
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
            ? '二进制文件,无法预览(可外跳编辑器打开)'
            : `文件过大(${(file.size / 1024 / 1024).toFixed(1)}MB > 2MB),请外跳编辑器`,
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
        theme: 'termpro-dark',
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
          })
          .catch((e) => {
            setState({
              phase: 'error',
              message: `保存失败:${e instanceof Error ? e.message : e}`,
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
        <div className="viewer-message">
          {state.phase === 'loading' ? '加载中…' : state.message}
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
