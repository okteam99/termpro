// Markdown 预览:marked + DOMPurify + mermaid(懒加载)+ 大纲 + 可缩放灯箱。
// 内容源:优先编辑器未保存值,否则读磁盘。
// 安全边界:marked 原样透传 HTML,一切防护依赖 DOMPurify 默认严格配置;
// mermaid 块走 lexer token 级抽取(围栏感知),占位符用随机 nonce 防伪造;
// mermaid 配置 htmlLabels:false → 标签为纯 SVG <text>,可安全序列化进灯箱
// (svg profile 消毒不再剥掉 foreignObject 文本)。

import { useCallback, useEffect, useRef, useState } from 'react';
import { marked, type Token, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { hostClient } from '../../services/hostClient';

interface Props {
  path: string;
  /** 编辑器有未保存内容时优先取它(无编辑器/未打开则 null → 读磁盘) */
  getEditorValue?: () => string | null;
}

// ---- mermaid 模块级单例:懒加载 + 只初始化一次 ----

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        darkMode: true,
        // 纯 SVG 文本标签:灯箱序列化/svg-profile 消毒后文字不丢
        flowchart: { htmlLabels: false },
        class: { htmlLabels: false },
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

// ---- token 级 mermaid 抽取(围栏感知)----

interface BuildResult {
  html: string;
  chunks: string[];
}

function buildHtml(raw: string, nonce: string): BuildResult {
  const chunks: string[] = [];

  const replaceInList = (list: Token[]): void => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.type === 'code' && /^mermaid\s*$/i.test((t as Tokens.Code).lang ?? '')) {
        const idx = chunks.length;
        chunks.push((t as Tokens.Code).text);
        const placeholder: Tokens.HTML = {
          type: 'html',
          raw: '',
          pre: false,
          block: true,
          text: `<div class="md-mermaid" data-mmd="${nonce}-${idx}"></div>\n`,
        };
        list[i] = placeholder;
        continue;
      }
      const withChildren = t as { tokens?: Token[]; items?: { tokens?: Token[] }[] };
      if (withChildren.tokens) replaceInList(withChildren.tokens);
      if (withChildren.items) {
        for (const item of withChildren.items) {
          if (item.tokens) replaceInList(item.tokens);
        }
      }
    }
  };

  const tokens = marked.lexer(raw, { gfm: true, breaks: false });
  replaceInList(tokens);
  const html = marked.parser(tokens);
  return { html: DOMPurify.sanitize(html), chunks };
}

// ---- 可缩放拖拽灯箱 ----

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const SCALE_MIN = 0.2;
const SCALE_MAX = 8;

function SvgLightbox({ chunk, onClose }: { chunk: string; onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef({ w: 800, h: 600 });
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [renderError, setRenderError] = useState<string | null>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const fit = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const { w, h } = naturalRef.current;
    const scale = Math.min(vp.clientWidth / w, vp.clientHeight / h, 2) * 0.92;
    setT({
      scale,
      x: (vp.clientWidth - w * scale) / 2,
      y: (vp.clientHeight - h * scale) / 2,
    });
  }, []);

  // 用原始 mermaid 源码在灯箱内重新渲染(与内联同一条管线,
  // 不做「序列化 + 再消毒」——那条路会丢标签),然后量尺寸适配视口
  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    void (async () => {
      try {
        const mmd = await getMermaid();
        const id = `lb-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
        const { svg } = await mmd.render(id, chunk);
        if (cancelled) return;
        const ct = contentRef.current;
        if (!ct) return;
        ct.innerHTML = svg; // strict 模式输出,mermaid 内置消毒
        const svgEl = ct.querySelector('svg');
        if (!svgEl) return;
        // mermaid 给 svg 带 max-width 行内样式,清掉才能按真实尺寸缩放
        svgEl.style.maxWidth = 'none';
        const vb = svgEl.viewBox?.baseVal;
        const w = vb?.width || svgEl.getBoundingClientRect().width || 800;
        const h = vb?.height || svgEl.getBoundingClientRect().height || 600;
        svgEl.setAttribute('width', String(w));
        svgEl.setAttribute('height', String(h));
        naturalRef.current = { w, h };
        fit();
      } catch {
        if (!cancelled) setRenderError('mermaid 渲染失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chunk, fit]);

  // 滚轮缩放(锚定光标);React 的 wheel 是 passive,必须原生监听
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setT((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * factor));
        const k = scale / prev.scale;
        return { scale, x: px - (px - prev.x) * k, y: py - (py - prev.y) * k };
      });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const cx = vp.clientWidth / 2;
    const cy = vp.clientHeight / 2;
    setT((prev) => {
      const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, prev.scale * factor));
      const k = scale / prev.scale;
      return { scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k };
    });
  };

  return (
    <div
      className="md-lb-panel"
      ref={viewportRef}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // 工具条上的按下不进入拖拽,否则 pointer capture 会吞掉按钮 click
        if ((e.target as Element).closest('.md-lb-toolbar')) return;
        dragRef.current = { px: e.clientX, py: e.clientY, ox: t.x, oy: t.y };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        setT((prev) => ({
          ...prev,
          x: d.ox + (e.clientX - d.px),
          y: d.oy + (e.clientY - d.py),
        }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onDoubleClick={fit}
    >
      <div
        ref={contentRef}
        className="md-lb-content"
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}
      />
      {renderError && <div className="viewer-message">{renderError}</div>}
      <div className="md-lb-toolbar">
        <button onClick={() => zoomBy(1 / 1.25)} title="缩小">
          −
        </button>
        <span className="md-lb-scale">{Math.round(t.scale * 100)}%</span>
        <button onClick={() => zoomBy(1.25)} title="放大">
          +
        </button>
        <button onClick={fit} title="适配窗口(双击同效)">
          重置
        </button>
        <button onClick={onClose} title="关闭(Esc)">
          ×
        </button>
      </div>
    </div>
  );
}

// ---- 大纲 ----

interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export function MarkdownPreview({ path, getEditorValue }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chunksRef = useRef<string[]>([]);
  const [lightboxChunk, setLightboxChunk] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(true);

  // 灯箱:Esc 关闭(capture + stopPropagation,不触发窗口级关闭)
  useEffect(() => {
    if (!lightboxChunk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxChunk(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [lightboxChunk]);

  // 主渲染:挂载 / path 变化时执行
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const root: HTMLDivElement = container;
    let cancelled = false;

    const showMessage = (text: string) => {
      container.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'viewer-message';
      msg.textContent = text;
      container.appendChild(msg);
      setOutline([]);
    };

    async function render() {
      // 1. 取内容
      let rawText: string;
      const fromEditor = getEditorValue?.() ?? null;
      if (fromEditor !== null) {
        rawText = fromEditor;
      } else {
        try {
          const file = await hostClient.rpc('fs.readFile', { path });
          if (cancelled) return;
          if (file.content === null) {
            showMessage(
              file.binary
                ? '二进制文件,无法预览'
                : `文件过大(${(file.size / 1024 / 1024).toFixed(1)} MB),无法预览`,
            );
            return;
          }
          rawText = file.content;
        } catch (e) {
          if (cancelled) return;
          showMessage(`读取失败:${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }

      // 2. 渲染管线(nonce 每次渲染都不同)
      const nonce = crypto.randomUUID();
      const { html, chunks } = buildHtml(rawText, nonce);
      if (cancelled) return;
      chunksRef.current = chunks;
      root.innerHTML = html;

      // 3. 大纲:h1-h4 赋 id 收集
      const headings = Array.from(
        root.querySelectorAll<HTMLElement>('h1, h2, h3, h4'),
      );
      const items: OutlineItem[] = [];
      headings.forEach((h, i) => {
        const text = h.textContent?.trim() ?? '';
        if (!text) return;
        const id = `md-h-${i}`;
        h.id = id;
        items.push({ id, text, level: Number(h.tagName[1]) });
      });
      setOutline(items);

      if (chunks.length === 0) return;

      // 4. mermaid 渲染
      let mmd: typeof import('mermaid').default;
      try {
        mmd = await getMermaid();
      } catch {
        return; // mermaid 加载失败:保留空占位
      }
      if (cancelled) return;

      for (let i = 0; i < chunks.length; i++) {
        if (cancelled) return;
        const placeholder = root.querySelector<HTMLElement>(
          `.md-mermaid[data-mmd="${nonce}-${i}"]`,
        );
        if (!placeholder) continue;
        try {
          const { svg } = await mmd.render(
            `mmd-${nonce.slice(0, 8)}-${i}`,
            chunks[i],
          );
          if (cancelled) return;
          placeholder.innerHTML = svg; // strict 模式输出已消毒
          placeholder.style.cursor = 'zoom-in';
        } catch {
          if (cancelled) return;
          placeholder.innerHTML = '';
          const pre = document.createElement('pre');
          pre.textContent = chunks[i];
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
    // getEditorValue 引用变化无影响,只随 path 重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // 点击 mermaid 图 → 灯箱(传原始源码,灯箱内重新渲染)
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as Element).closest<HTMLElement>('.md-mermaid');
    if (!el) return;
    const key = el.getAttribute('data-mmd');
    if (!key) return;
    const idx = Number(key.slice(key.lastIndexOf('-') + 1));
    const chunk = chunksRef.current[idx];
    if (chunk == null) return;
    setLightboxChunk(chunk);
  };

  const scrollToHeading = (id: string) => {
    containerRef.current
      ?.querySelector(`#${CSS.escape(id)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <div className="md-layout">
        <div
          className={`md-outline${outlineOpen ? '' : ' md-outline--closed'}`}
        >
          <button
            className="md-outline-toggle"
            onClick={() => setOutlineOpen((v) => !v)}
            title={outlineOpen ? '收起大纲' : '展开大纲'}
          >
            {outlineOpen ? '‹ OUTLINE' : '›'}
          </button>
          {outlineOpen && (
            <div className="md-outline-list">
              {outline.length === 0 && (
                <div className="md-outline-empty">(无标题)</div>
              )}
              {outline.map((it) => (
                <div
                  key={it.id}
                  className="md-outline-item"
                  style={{ paddingLeft: 10 + (it.level - 1) * 14 }}
                  onClick={() => scrollToHeading(it.id)}
                  title={it.text}
                >
                  {it.text}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="md-scroll">
          <div
            className="md-preview"
            ref={containerRef}
            onClick={handleContainerClick}
          />
        </div>
      </div>
      {lightboxChunk && (
        <div
          className="md-lightbox"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxChunk(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <SvgLightbox
            chunk={lightboxChunk}
            onClose={() => setLightboxChunk(null)}
          />
        </div>
      )}
    </>
  );
}
