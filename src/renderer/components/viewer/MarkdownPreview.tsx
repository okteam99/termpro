// Markdown 预览:marked + DOMPurify + mermaid(懒加载) + 放大灯箱。
// 内容源:优先取编辑器未保存值,否则读磁盘。

import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { hostClient } from '../../services/hostClient';

interface Props {
  path: string;
  /** 编辑器有未保存内容时优先取它(无编辑器/未打开则 null → 读磁盘) */
  getEditorValue?: () => string | null;
}

// ── 模块级 mermaid 单例:只初始化一次 ──────────────────────────────────────
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let mermaidInitialized = false;

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mmd = m.default;
      if (!mermaidInitialized) {
        mermaidInitialized = true;
        mmd.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          darkMode: true,
        });
      }
      return mmd;
    });
  }
  return mermaidPromise;
}

// ── mermaid ブロック抽出 ────────────────────────────────────────────────────
interface MermaidChunk {
  code: string;
  idx: number;
}

const MERMAID_FENCE_RE = /^```mermaid[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

function extractMermaid(raw: string): { text: string; chunks: MermaidChunk[] } {
  const chunks: MermaidChunk[] = [];
  let idx = 0;
  const text = raw.replace(MERMAID_FENCE_RE, (_match, code: string) => {
    const current = idx++;
    chunks.push({ code: code.trimEnd(), idx: current });
    return `<div class="md-mermaid" data-idx="${current}"></div>`;
  });
  return { text, chunks };
}

// ── 一意 id カウンタ ────────────────────────────────────────────────────────
let renderCounter = 0;

// ── marked 設定(同期モード) ────────────────────────────────────────────────
marked.setOptions({ gfm: true, breaks: false });

// ── コンポーネント ──────────────────────────────────────────────────────────
export function MarkdownPreview({ path, getEditorValue }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxSvg, setLightboxSvg] = useState<string | null>(null);

  // ── Esc でライトボックスを閉じる(window への伝搬を止める) ──────────────
  useEffect(() => {
    if (!lightboxSvg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxSvg(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [lightboxSvg]);

  // ── メイン:マウント/path 変更のたびに再レンダー ────────────────────────
  useEffect(() => {
    const containerOrNull = containerRef.current;
    if (!containerOrNull) return;
    // Re-bind as non-nullable for use across awaits (TypeScript strict).
    const container: HTMLDivElement = containerOrNull;

    let cancelled = false;

    async function render() {
      // 1. コンテンツ取得
      let rawText: string;
      const fromEditor = getEditorValue?.() ?? null;
      if (fromEditor !== null) {
        rawText = fromEditor;
      } else {
        let file: Awaited<ReturnType<typeof hostClient.rpc<'fs.readFile'>>>;
        try {
          file = await hostClient.rpc('fs.readFile', { path });
        } catch (e) {
          if (cancelled) return;
          container.innerHTML = '';
          const msg = document.createElement('div');
          msg.className = 'viewer-message';
          msg.textContent = `读取失败:${e instanceof Error ? e.message : String(e)}`;
          container.appendChild(msg);
          return;
        }
        if (cancelled) return;
        if (file.content === null) {
          container.innerHTML = '';
          const msg = document.createElement('div');
          msg.className = 'viewer-message';
          msg.textContent = file.binary
            ? '二进制文件,无法预览'
            : `文件过大(${(file.size / 1024 / 1024).toFixed(1)} MB),无法预览`;
          container.appendChild(msg);
          return;
        }
        rawText = file.content;
      }

      // 2. Mermaid ブロック抽出 → プレースホルダー埋め込み
      const { text: textWithoutMermaid, chunks } = extractMermaid(rawText);

      // 3. marked で HTML 生成(同期)
      const rawHtml = marked.parse(textWithoutMermaid, { async: false }) as string;

      // 4. DOMPurify でサニタイズ
      const safeHtml = DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: ['div'],
        ADD_ATTR: ['data-idx', 'class'],
      });

      if (cancelled) return;

      // 5. DOM に注入
      container.innerHTML = safeHtml;

      if (chunks.length === 0) return;

      // 6. Mermaid をレンダー(lazy)
      let mmd: typeof import('mermaid').default;
      try {
        mmd = await getMermaid();
      } catch {
        // mermaid 自体が読めない場合はプレースホルダーをそのまま残す
        return;
      }
      if (cancelled) return;

      for (const chunk of chunks) {
        if (cancelled) return;
        const placeholder = container.querySelector<HTMLElement>(
          `.md-mermaid[data-idx="${chunk.idx}"]`,
        );
        if (!placeholder) continue;

        const uid = `mmd-${Date.now()}-${++renderCounter}`;
        try {
          const { svg } = await mmd.render(uid, chunk.code);
          if (cancelled) return;
          placeholder.innerHTML = svg; // mermaid strict モードの出力はサニタイズ済み
          // SVG クリック → ライトボックス
          placeholder.style.cursor = 'zoom-in';
        } catch {
          if (cancelled) return;
          placeholder.innerHTML = '';
          const pre = document.createElement('pre');
          pre.textContent = chunk.code;
          const note = document.createElement('div');
          note.className = 'md-mermaid-error';
          note.textContent = '(mermaid 渲染失败)';
          placeholder.appendChild(pre);
          placeholder.appendChild(note);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  // getEditorValue は関数参照が変わっても問題ないので path のみ依存
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ── mermaid コンテナへのクリック委譲 ──────────────────────────────────
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as Element).closest<HTMLElement>('.md-mermaid');
    if (!el) return;
    const svgEl = el.querySelector('svg');
    if (!svgEl) return;
    // SVG のアウター HTML をライトボックスへ渡す
    setLightboxSvg(svgEl.outerHTML);
  };

  return (
    <>
      {/* スクロールコンテナ */}
      <div
        className="md-preview"
        ref={containerRef}
        onClick={handleContainerClick}
      />

      {/* ライトボックス */}
      {lightboxSvg && (
        <div
          className="md-lightbox"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxSvg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setLightboxSvg(null);
            }
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div className="md-lightbox-panel">
            <button
              className="md-lightbox-close"
              onClick={() => setLightboxSvg(null)}
              aria-label="关闭"
            >
              ×
            </button>
            {/* 信頼できる mermaid 出力 SVG を表示 */}
            <div
              className="md-lightbox-svg"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: lightboxSvg }}
            />
          </div>
        </div>
      )}
    </>
  );
}
