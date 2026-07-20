// 目录变化监听:每个订阅 300ms 去抖后只推一个「变了」信号,UI 自己决定刷新粒度。
//
// 🔴 平台分径(2026-07-20 远程 host 卡死事故):
//   darwin/win32 → 原生递归 fs.watch(FSEvents/ReadDirectoryChangesW,内核态,零回归)。
//   linux        → 无原生递归 inotify,Node 的 JS 兜底(internal recursive_watch 的
//                  #watchFolder)每次事件对全树 readdirSync 重扫并常驻全树文件表——
//                  大仓库 + agent 高频写文件时事件循环 100% 饿死、内存吃到 GB 级,
//                  WS 探测全超时,机器被判 unreachable。改用有界手工实现:root 与
//                  子目录各挂一个【非递归】fs.watch(内核级 inotify,事件本身廉价),
//                  广度优先建 watcher,总数/深度封顶,跳过高churn目录;事件只发去抖
//                  信号 + 增量补挂新建子目录,绝不重扫全树。超出预算的深层目录收不到
//                  信号(面板刷新在导航时兜底),这是有意的降级——绝不换回全树扫描。

import fs from 'node:fs';
import path from 'node:path';
import { HostMessage } from '../shared/protocol';

const DEBOUNCE_MS = 300;
// 预算:面板可视树(顶层+已展开子目录)通常远小于此;node_modules/.git 只被跳过
// 【建 watcher】,其父目录条目增删仍会经父级 watcher 出信号。
const MAX_DIRS = 256;
const MAX_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);

interface WatchEntry {
  /** dir 绝对路径 → 该目录的非递归 watcher(darwin/win32 恒单条:root 递归)。 */
  watchers: Map<string, fs.FSWatcher>;
  timer: NodeJS.Timeout | null;
  root: string;
  /** 该订阅剩余可建 watcher 数(仅手工模式使用)。 */
  budget: number;
}

export interface WatchServiceOptions {
  /** 测试注入:任意平台强制走手工有界实现。缺省 = process.platform === 'linux'。 */
  forceManual?: boolean;
  maxDirs?: number;
  maxDepth?: number;
}

export class WatchService {
  private seq = 0;
  private watches = new Map<number, WatchEntry>();
  private readonly manual: boolean;
  private readonly maxDirs: number;
  private readonly maxDepth: number;

  constructor(
    private send: (msg: HostMessage) => void,
    opts: WatchServiceOptions = {},
  ) {
    this.manual = opts.forceManual ?? process.platform === 'linux';
    this.maxDirs = opts.maxDirs ?? MAX_DIRS;
    this.maxDepth = opts.maxDepth ?? MAX_DEPTH;
  }

  watch(watchPath: string): number {
    const watchId = ++this.seq;
    const entry: WatchEntry = {
      watchers: new Map(),
      timer: null,
      root: watchPath,
      budget: this.maxDirs,
    };
    if (!this.manual) {
      const watcher = fs.watch(watchPath, { recursive: true }, () =>
        this.schedule(watchId),
      );
      watcher.on('error', () => this.unwatch(watchId));
      entry.watchers.set(watchPath, watcher);
      this.watches.set(watchId, entry);
      return watchId;
    }

    // 手工模式:root 建不起来 = 订阅整体失败(与原递归路径同语义,抛给调用方);
    // 子目录失败只降级跳过。先注册 entry 再 BFS,addDir 需要它记账。
    this.watches.set(watchId, entry);
    try {
      this.addDir(watchId, entry, watchPath, 0);
    } catch (err) {
      this.watches.delete(watchId);
      throw err;
    }
    this.walkSubdirs(watchId, entry, watchPath, 0);
    return watchId;
  }

  unwatch(watchId: number): void {
    const entry = this.watches.get(watchId);
    if (!entry) return;
    for (const w of entry.watchers.values()) w.close();
    entry.watchers.clear();
    if (entry.timer) clearTimeout(entry.timer);
    this.watches.delete(watchId);
  }

  dispose(): void {
    for (const id of [...this.watches.keys()]) this.unwatch(id);
  }

  /** 给 dir 挂非递归 watcher 并记账;root 之外的失败由调用方吞掉(降级)。 */
  private addDir(watchId: number, entry: WatchEntry, dir: string, depth: number): void {
    if (entry.budget <= 0 || entry.watchers.has(dir)) return;
    const watcher = fs.watch(dir, (_event, filename) => {
      this.schedule(watchId);
      // 新建子目录增量补挂(仅查【本目录下这一个条目】,O(1) stat,绝不扫树)
      if (filename && depth < this.maxDepth) {
        this.maybeAddChildDir(watchId, entry, dir, filename.toString(), depth);
      }
    });
    watcher.on('error', () => {
      // 目录被删/不可读:只摘本目录 watcher;root 出错则整个订阅按原语义解除
      if (dir === entry.root) {
        this.unwatch(watchId);
        return;
      }
      watcher.close();
      if (this.watches.get(watchId) === entry) {
        entry.watchers.delete(dir);
        entry.budget += 1;
      }
    });
    entry.watchers.set(dir, watcher);
    entry.budget -= 1;
  }

  /** BFS 建初始 watcher 树:每目录一次 readdir,受 budget/深度双上限约束。 */
  private walkSubdirs(watchId: number, entry: WatchEntry, dir: string, depth: number): void {
    if (depth >= this.maxDepth || entry.budget <= 0) return;
    const queue: Array<{ dir: string; depth: number }> = [{ dir, depth }];
    while (queue.length > 0 && entry.budget > 0) {
      const cur = queue.shift()!;
      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(cur.dir, { withFileTypes: true });
      } catch {
        continue; // 目录消失/无权限:跳过
      }
      for (const d of dirents) {
        if (entry.budget <= 0) return;
        if (!d.isDirectory() || d.isSymbolicLink() || SKIP_DIRS.has(d.name)) continue;
        const child = path.join(cur.dir, d.name);
        try {
          this.addDir(watchId, entry, child, cur.depth + 1);
        } catch {
          continue; // 子目录挂不上:降级跳过
        }
        if (cur.depth + 1 < this.maxDepth) {
          queue.push({ dir: child, depth: cur.depth + 1 });
        }
      }
    }
  }

  /** 事件里出现的条目若是【新建目录】则补挂 + 补扫其子树(同样受预算约束)。 */
  private maybeAddChildDir(
    watchId: number,
    entry: WatchEntry,
    parent: string,
    name: string,
    parentDepth: number,
  ): void {
    if (SKIP_DIRS.has(name) || entry.budget <= 0) return;
    const child = path.join(parent, name);
    if (entry.watchers.has(child)) return;
    fs.promises
      .lstat(child)
      .then((st) => {
        if (!st.isDirectory()) return;
        // 异步窗口内订阅可能已解除/换代
        if (this.watches.get(watchId) !== entry) return;
        try {
          this.addDir(watchId, entry, child, parentDepth + 1);
        } catch {
          return;
        }
        this.walkSubdirs(watchId, entry, child, parentDepth + 1);
      })
      .catch(() => undefined); // 条目已删(典型:临时文件),忽略
  }

  private schedule(watchId: number): void {
    const entry = this.watches.get(watchId);
    if (!entry || entry.timer) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.send({ t: 'fs:changed', watchId });
    }, DEBOUNCE_MS);
  }
}
