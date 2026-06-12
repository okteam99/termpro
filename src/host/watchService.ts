// 目录变化监听:每个订阅一个 recursive fs.watch(macOS FSEvents),
// host 侧 300ms 去抖后只推一个「变了」信号,UI 自己决定刷新粒度。

import fs from 'node:fs';
import { HostMessage } from '../shared/protocol';

const DEBOUNCE_MS = 300;

interface WatchEntry {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

export class WatchService {
  private seq = 0;
  private watches = new Map<number, WatchEntry>();

  constructor(private send: (msg: HostMessage) => void) {}

  watch(path: string): number {
    const watchId = ++this.seq;
    const watcher = fs.watch(path, { recursive: true }, () =>
      this.schedule(watchId),
    );
    watcher.on('error', () => this.unwatch(watchId));
    this.watches.set(watchId, { watcher, timer: null });
    return watchId;
  }

  unwatch(watchId: number): void {
    const entry = this.watches.get(watchId);
    if (!entry) return;
    entry.watcher.close();
    if (entry.timer) clearTimeout(entry.timer);
    this.watches.delete(watchId);
  }

  dispose(): void {
    for (const id of [...this.watches.keys()]) this.unwatch(id);
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
