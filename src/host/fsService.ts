import { promises as fs } from 'node:fs';
import os from 'node:os';
import { DirEntry } from '../shared/protocol';

export async function listDir(path: string): Promise<{ entries: DirEntry[] }> {
  const dirents = await fs.readdir(path, { withFileTypes: true });
  const entries: DirEntry[] = dirents.map((d) => ({
    name: d.name,
    kind: d.isDirectory()
      ? 'dir'
      : d.isSymbolicLink()
        ? 'symlink'
        : d.isFile()
          ? 'file'
          : 'other',
  }));
  // 目录优先,各自按名称排序
  entries.sort((a, b) => {
    const ad = a.kind === 'dir' ? 0 : 1;
    const bd = b.kind === 'dir' ? 0 : 1;
    return ad - bd || a.name.localeCompare(b.name);
  });
  return { entries };
}

export function homeDir(): { path: string } {
  return { path: os.homedir() };
}
