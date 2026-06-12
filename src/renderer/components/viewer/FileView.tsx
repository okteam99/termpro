// 文件查看 / 轻编辑(Monaco 懒加载)。重编辑请外跳专业编辑器。

import { useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import type { Monaco } from '../../monaco/setup';
import type * as monacoNs from 'monaco-editor';

interface Props {
  path: string;
  /** 保存状态回传给 header(脏标记/保存按钮) */
  onDirtyChange?(dirty: boolean): void;
  registerSave?(fn: (() => void) | null): void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready' };

export function FileView({ path, onDirtyChange, registerSave }: Props) {
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
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);

      setState({ phase: 'ready' });
    }

    void boot();
    return () => {
      disposed = true;
      registerSave?.(null);
      editor?.dispose();
      model?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
