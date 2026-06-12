// Markdown 预览:marked + DOMPurify + mermaid(懒加载)+ 点击放大灯箱。
// 内容源:优先编辑器未保存值,否则读磁盘。
// 安全边界:marked 原样透传 HTML,一切防护依赖 DOMPurify 默认严格配置;
// mermaid 块走 lexer token 级抽取(围栏感知,文档里展示 ```mermaid 示例
// 不会被误渲染),占位符用每次渲染的随机 nonce,用户内容无法伪造命中。

import { useEffect, useRef, useState } from 'react';
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
        securityLevel: 'strict', // 输出经 mermaid 内置 DOMPurify 消毒
        darkMode: true,
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
  // DOMPurify 默认配置即可:div/class/data-* 本就在默认白名单,
  // on*/javascript:/script 等全部默认拒绝。占位符防伪造靠 nonce。
  return { html: DOMPurify.sanitize(html), chunks };
}

export function MarkdownPreview({ path, getEditorValue }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxSvg, setLightboxSvg] = useState<string | null>(null);

  // 灯箱:Esc 关闭(capture + stopPropagation,不触发窗口级关闭)
  useEffect(() => {
    if (!lightboxSvg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxSvg(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true });
  }, [lightboxSvg]);

  // 主渲染:挂载 / path 变化时执行
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // render 是提升的函数声明,TS 闭包收窄失效;显式重绑非空引用
    const root: HTMLDivElement = container;
    let cancelled = false;

    const showMessage = (text: string) => {
      container.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'viewer-message';
      msg.textContent = text;
      container.appendChild(msg);
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
      root.innerHTML = html;

      if (chunks.length === 0) return;

      // 3. mermaid 渲染
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

  // 点击 mermaid 图 → 灯箱
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as Element).closest<HTMLElement>('.md-mermaid');
    if (!el) return;
    const svgEl = el.querySelector('svg');
    if (!svgEl) return;
    setLightboxSvg(svgEl.outerHTML);
  };

  return (
    <>
      <div
        className="md-preview"
        ref={containerRef}
        onClick={handleContainerClick}
      />
      {lightboxSvg && (
        <div
          className="md-lightbox"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightboxSvg(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="md-lightbox-panel">
            <button
              className="md-lightbox-close"
              onClick={() => setLightboxSvg(null)}
              aria-label="关闭"
            >
              ×
            </button>
            <div
              className="md-lightbox-svg"
              // 防御纵深:即便上游已是 mermaid strict 消毒输出,灯箱再过一遍
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(lightboxSvg, {
                  USE_PROFILES: { svg: true, svgFilters: true },
                }),
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
