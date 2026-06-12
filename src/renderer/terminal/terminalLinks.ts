// 终端文件/路径链接提供器:hover 才做存在性校验(fs.stat),
// 相对路径按会话实时 cwd 解析(2.5s 记忆),命中后下划线 + 点击打开。
// 列映射按 buffer cell 逐格构建——路径前有 CJK 宽字符时索引≠列号。

import type {
  IBufferLine,
  ILink,
  ILinkProvider,
  Terminal,
} from '@xterm/xterm';
import { hostClient } from '../services/hostClient';
import {
  extractCandidates,
  fileUrlToPath,
  stripLineCol,
} from './terminalLinkParse';

const STAT_CACHE_MS = 5_000;
const CWD_CACHE_MS = 2_500;

// 交给系统打开的扩展名(图片/媒体/压缩包等);其余进 TermPro 文件窗口
const SYSTEM_OPEN_EXT =
  /\.(png|jpe?g|gif|webp|bmp|svg|icns|ico|pdf|zip|gz|tgz|tar|7z|dmg|app|mp4|mov|avi|mkv|mp3|wav|flac|woff2?|ttf|otf|eot)$/i;

function openTarget(absPath: string, kind: 'file' | 'dir'): void {
  if (kind === 'dir' || SYSTEM_OPEN_EXT.test(absPath)) {
    window.termpro.openPath(absPath);
  } else {
    window.termpro.openViewerWindow({ mode: 'file', path: absPath });
  }
}

/** buffer 行 → 文本 + 每个 code unit 对应的列号(0 基) */
function lineToString(line: IBufferLine): { text: string; cols: number[] } {
  let text = '';
  const cols: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    if (cell.getWidth() === 0) continue; // 宽字符尾随占位格
    const chars = cell.getChars() || ' ';
    for (let k = 0; k < chars.length; k++) {
      text += chars[k];
      cols.push(x);
    }
  }
  return { text, cols };
}

export class FsLinkProvider implements ILinkProvider {
  private statCache = new Map<
    string,
    { kind: 'file' | 'dir' | null; ts: number }
  >();
  private cwdCache: { cwd: string; ts: number } | null = null;

  constructor(
    private term: Terminal,
    private getSessionId: () => string | null,
    private getFallbackCwd: () => string,
  ) {}

  provideLinks(
    y: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const line = this.term.buffer.active.getLine(y - 1);
    if (!line) {
      callback(undefined);
      return;
    }
    const { text, cols } = lineToString(line);
    const cands = extractCandidates(text).filter((c) => c.kind === 'fs');
    if (cands.length === 0) {
      callback(undefined);
      return;
    }
    void this.resolve(cands, cols, y).then(callback, () => callback(undefined));
  }

  private async cwd(): Promise<string> {
    const now = Date.now();
    if (this.cwdCache && now - this.cwdCache.ts < CWD_CACHE_MS) {
      return this.cwdCache.cwd;
    }
    let cwd = this.getFallbackCwd();
    const sid = this.getSessionId();
    if (sid) {
      try {
        const r = await hostClient.rpc('pty.cwd', { sessionId: sid });
        if (r.cwd) cwd = r.cwd;
      } catch {
        /* host 忙时退回 fallback */
      }
    }
    this.cwdCache = { cwd, ts: now };
    return cwd;
  }

  private async stat(p: string): Promise<'file' | 'dir' | null> {
    const now = Date.now();
    const hit = this.statCache.get(p);
    if (hit && now - hit.ts < STAT_CACHE_MS) return hit.kind;
    let kind: 'file' | 'dir' | null = null;
    try {
      kind = (await hostClient.rpc('fs.stat', { path: p })).kind;
    } catch {
      kind = null;
    }
    this.statCache.set(p, { kind, ts: now });
    if (this.statCache.size > 500) this.statCache.clear();
    return kind;
  }

  /** 文本候选 → 绝对路径 + 类型(不存在返回 null);高亮器复用同一套缓存 */
  async resolveCandidateText(
    text: string,
  ): Promise<{ abs: string; kind: 'file' | 'dir' } | null> {
    let p: string | null = text;
    if (p.startsWith('file://')) {
      p = fileUrlToPath(p);
      if (!p) return null;
    }
    p = stripLineCol(p);
    const home = hostClient.info?.homedir ?? '';
    if (p.startsWith('~')) p = home + p.slice(1);
    if (!p.startsWith('/')) {
      const cwd = await this.cwd();
      p = `${cwd.replace(/\/$/, '')}/${p}`;
    }
    const kind = await this.stat(p);
    return kind ? { abs: p, kind } : null;
  }

  private async resolve(
    cands: ReturnType<typeof extractCandidates>,
    cols: number[],
    y: number,
  ): Promise<ILink[] | undefined> {
    const links: ILink[] = [];
    await Promise.all(
      cands.map(async (c) => {
        const hit = await this.resolveCandidateText(c.text);
        if (!hit) return;
        links.push({
          range: {
            start: { x: cols[c.start] + 1, y },
            end: { x: cols[c.end - 1] + 1, y },
          },
          text: c.text,
          decorations: { underline: true, pointerCursor: true },
          activate: () => openTarget(hit.abs, hit.kind),
        });
      }),
    );
    return links.length > 0 ? links : undefined;
  }
}

// ---- 链接常驻高亮(蓝色):随输出/滚动扫描可视区,decoration 上色 ----

const LINK_COLOR = '#4a8df8';
const HIGHLIGHT_DEBOUNCE_MS = 200;

export class LinkHighlighter {
  private decos: { dispose(): void }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;

  constructor(
    private term: Terminal,
    private provider: FsLinkProvider,
  ) {}

  attach(): void {
    this.term.onWriteParsed(() => this.schedule());
    this.term.onScroll(() => this.schedule());
    this.term.onResize(() => this.schedule());
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scan();
    }, HIGHLIGHT_DEBOUNCE_MS);
  }

  private clear(): void {
    for (const d of this.decos) d.dispose();
    this.decos = [];
  }

  private async scan(): Promise<void> {
    const myEpoch = ++this.epoch;
    const buf = this.term.buffer.active;
    const top = buf.viewportY;
    const bottom = Math.min(top + this.term.rows, buf.length);

    interface Hit {
      absLine: number;
      startCol: number;
      widthCells: number;
    }
    const hits: Hit[] = [];

    for (let y = top; y < bottom; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const { text, cols } = lineToString(line);
      for (const c of extractCandidates(text)) {
        if (c.kind === 'web') {
          hits.push({
            absLine: y,
            startCol: cols[c.start],
            widthCells: cols[c.end - 1] - cols[c.start] + 1,
          });
        } else {
          const hit = await this.provider.resolveCandidateText(c.text);
          if (this.epoch !== myEpoch) return; // 已有新一轮扫描
          if (!hit) continue;
          hits.push({
            absLine: y,
            startCol: cols[c.start],
            widthCells: cols[c.end - 1] - cols[c.start] + 1,
          });
        }
      }
    }
    if (this.epoch !== myEpoch) return;

    this.clear();
    const cursorAbs = buf.baseY + buf.cursorY;
    for (const h of hits) {
      // marker 以光标行为锚点
      const marker = this.term.registerMarker(h.absLine - cursorAbs);
      if (!marker) continue;
      const deco = this.term.registerDecoration({
        marker,
        x: h.startCol,
        width: h.widthCells,
        foregroundColor: LINK_COLOR,
      });
      if (deco) {
        this.decos.push({
          dispose: () => {
            deco.dispose();
            marker.dispose();
          },
        });
      } else {
        marker.dispose();
      }
    }
  }
}
