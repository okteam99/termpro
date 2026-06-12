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
    const cands = extractCandidates(text);
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

  private async resolve(
    cands: ReturnType<typeof extractCandidates>,
    cols: number[],
    y: number,
  ): Promise<ILink[] | undefined> {
    const home = hostClient.info?.homedir ?? '';
    const cwd = await this.cwd();
    const links: ILink[] = [];

    await Promise.all(
      cands.map(async (c) => {
        let p: string | null = c.text;
        if (p.startsWith('file://')) {
          p = fileUrlToPath(p);
          if (!p) return;
        }
        p = stripLineCol(p);
        if (p.startsWith('~')) p = home + p.slice(1);
        if (!p.startsWith('/')) p = `${cwd.replace(/\/$/, '')}/${p}`;
        const kind = await this.stat(p);
        if (!kind) return;
        const abs = p;
        links.push({
          range: {
            start: { x: cols[c.start] + 1, y },
            end: { x: cols[c.end - 1] + 1, y },
          },
          text: c.text,
          decorations: { underline: true, pointerCursor: true },
          activate: () => openTarget(abs, kind),
        });
      }),
    );
    return links.length > 0 ? links : undefined;
  }
}
