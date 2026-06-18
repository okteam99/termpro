// markdown 预览里链接点击的目标解析(纯函数,零 DOM,可单测)。
// 相对路径按 **markdown 文件所在目录** 解析(而非渲染进程的 document base),
// 归一吸收 . / ..;最终类型交由调用方 fs.stat 决定文件/目录开窗。

import { fileUrlToPath } from '../../terminal/terminalLinkParse';

export type MarkdownTarget =
  | { kind: 'external'; url: string } // http(s) → 系统浏览器
  | { kind: 'anchor'; id: string } // 文档内 #锚点 → 滚动
  | { kind: 'path'; abs: string }; // 本地路径 → 待 stat 分流

/** p 的父目录(POSIX,纯字符串) */
function dirOf(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i <= 0 ? '/' : trimmed.slice(0, i);
}

/** 归一 POSIX 路径:吸收 . 与 ..(不触磁盘) */
function normalize(p: string): string {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    } else {
      out.push(seg);
    }
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}

/**
 * 解析 markdown 链接 href → 目标。
 * - `#x` → 锚点;`http(s)://` → 外链;`file://`/绝对/`~`/相对 → 本地路径。
 * - 其余协议(mailto/tel…)主进程 open-external 只放行 http(s),返回 null 忽略。
 * - 解析失败 / 空 → null。
 */
export function resolveMarkdownHref(
  rawHref: string,
  mdFileAbsPath: string,
  homedir: string,
): MarkdownTarget | null {
  const href = rawHref.trim();
  if (!href) return null;

  if (href.startsWith('#')) {
    try {
      return { kind: 'anchor', id: decodeURIComponent(href.slice(1)) };
    } catch {
      return { kind: 'anchor', id: href.slice(1) };
    }
  }
  if (/^https?:\/\//i.test(href)) return { kind: 'external', url: href };
  // 非 file 的其它协议(mailto/tel/vscode…)不处理
  if (/^(?!file:)[a-z][a-z0-9+.-]*:/i.test(href)) return null;

  let p: string | null;
  if (href.startsWith('file://')) {
    p = fileUrlToPath(href);
  } else {
    // 去掉 fragment / query,再解码 %xx(空格等)
    p = href.replace(/[?#].*$/, '');
    try {
      p = decodeURIComponent(p);
    } catch {
      /* 非法转义则保留原文 */
    }
  }
  if (!p) return null;

  if (p === '~' || p.startsWith('~/')) p = homedir + p.slice(1);
  if (!p.startsWith('/')) p = `${dirOf(mdFileAbsPath)}/${p}`;
  return { kind: 'path', abs: normalize(p) };
}
