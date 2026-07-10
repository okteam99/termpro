// 终端链接候选提取(纯函数,可单测,零依赖)。
// 三类:file:// URL、绝对/~/.// 路径、含斜杠的相对路径;
// http(s) 链接只记录占位范围(由 WebLinksAddon 渲染,这里避免重叠)。

export interface LinkCandidate {
  /** 原文(含可能的 :line:col 后缀) */
  text: string;
  /** string 索引区间 [start, end) */
  start: number;
  end: number;
  /** web=http(s)(激活由 WebLinksAddon 负责,这里只用于上色);fs=文件/路径 */
  kind: 'web' | 'fs';
}

// http(s) URL 主体:非空白 **且非全角/CJK 字符**——终端里 URL 后紧跟中文/全角标点(如
// `https://…/pull/18（yolo…`)时,`\S+` 会把全角字符也吞进链接,导致可点范围越界。
// 排除区段:CJK 标点(　-〿)、假名(぀-ヿ)、CJK 统一表意含扩展 A(㐀-鿿)、
// 谚文(가-힯)、CJK 兼容表意(豈-﫿)、半/全角形式(＀-￯)。仅作用于 http 类 URL。
const HTTP_RE =
  /https?:\/\/[^\s　-〿぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]+/g;
const FILE_URL_RE = /file:\/\/\S+/g;
// 绝对(/、~/、./、../)或含至少一个斜杠的相对路径,可带 :行(:列) 后缀
const PATH_RE =
  /((?:~|\.{1,2})?\/[\w.@%+-]+(?:\/[\w.@%+-]+)*\/?|(?<![\w/.~-])[\w.@%+-]+(?:\/[\w.@%+-]+)+\/?)(?::\d+(?::\d+)?)?/g;

/** 去掉尾部标点(保留 :line:col 数字后缀);跨缩进拼接的派生续接段复用 */
export function trimTrailingPunct(s: string): string {
  let out = s;
  while (out && /[)\]}>.,;:'"`!?]$/.test(out) && !/:\d+$/.test(out)) {
    out = out.slice(0, -1);
  }
  return out;
}

export function extractCandidates(text: string): LinkCandidate[] {
  const taken: Array<[number, number]> = [];
  const out: LinkCandidate[] = [];
  const overlaps = (s: number, e: number) =>
    taken.some(([a, b]) => s < b && e > a);

  const push = (raw: string, start: number, kind: 'web' | 'fs') => {
    const str = trimTrailingPunct(raw);
    if (!str) return;
    const end = start + str.length;
    // 纯斜杠、单字符等噪音
    if (kind === 'fs' && str.replace(/[/:.~]/g, '').length < 2) return;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    out.push({ text: str, start, end, kind });
  };

  // http(s):产出 web 候选(激活归 WebLinksAddon,高亮用)
  for (const m of text.matchAll(HTTP_RE)) {
    push(m[0], m.index ?? 0, 'web');
  }
  for (const m of text.matchAll(FILE_URL_RE)) {
    push(m[0], m.index ?? 0, 'fs');
  }
  for (const m of text.matchAll(PATH_RE)) {
    push(m[0], m.index ?? 0, 'fs');
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 去掉 :line(:col) 后缀,返回纯路径 */
export function stripLineCol(p: string): string {
  return p.replace(/(?::\d+){1,2}$/, '');
}

/** file:// URL → 本地路径(失败返回 null) */
export function fileUrlToPath(u: string): string | null {
  if (!u.startsWith('file://')) return null;
  try {
    // file://host/path 与 file:///path 都取 pathname
    const url = new URL(u);
    const p = decodeURIComponent(url.pathname);
    return p || null;
  } catch {
    return null;
  }
}
