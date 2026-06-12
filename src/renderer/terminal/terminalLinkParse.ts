// 终端链接候选提取(纯函数,可单测,零依赖)。
// 三类:file:// URL、绝对/~/.// 路径、含斜杠的相对路径;
// http(s) 链接只记录占位范围(由 WebLinksAddon 渲染,这里避免重叠)。

export interface LinkCandidate {
  /** 原文(含可能的 :line:col 后缀) */
  text: string;
  /** string 索引区间 [start, end) */
  start: number;
  end: number;
}

const HTTP_RE = /https?:\/\/\S+/g;
const FILE_URL_RE = /file:\/\/\S+/g;
// 绝对(/、~/、./、../)或含至少一个斜杠的相对路径,可带 :行(:列) 后缀
const PATH_RE =
  /((?:~|\.{1,2})?\/[\w.@%+\-]+(?:\/[\w.@%+\-]+)*\/?|(?<![\w/.~-])[\w.@%+\-]+(?:\/[\w.@%+\-]+)+\/?)(?::\d+(?::\d+)?)?/g;

/** 去掉尾部标点(保留 :line:col 数字后缀) */
function trimTrailingPunct(s: string): string {
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

  // http(s):占位,不产出
  for (const m of text.matchAll(HTTP_RE)) {
    taken.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }

  const push = (raw: string, start: number) => {
    const str = trimTrailingPunct(raw);
    if (!str) return;
    const end = start + str.length;
    // 纯斜杠、单字符等噪音
    if (str.replace(/[/:.~]/g, '').length < 2) return;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    out.push({ text: str, start, end });
  };

  for (const m of text.matchAll(FILE_URL_RE)) {
    push(m[0], m.index ?? 0);
  }
  for (const m of text.matchAll(PATH_RE)) {
    push(m[0], m.index ?? 0);
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
