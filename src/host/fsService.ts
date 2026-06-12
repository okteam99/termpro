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

/** 文本文件上限:超过不读(查看器场景,防大文件拖垮 IPC) */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  return probe.includes(0);
}

export async function readTextFile(path: string): Promise<{
  content: string | null;
  binary: boolean;
  truncated: boolean;
  size: number;
}> {
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('not a regular file');
  if (stat.size > MAX_FILE_BYTES) {
    return { content: null, binary: false, truncated: true, size: stat.size };
  }
  const buf = await fs.readFile(path);
  if (looksBinary(buf)) {
    return { content: null, binary: true, truncated: false, size: stat.size };
  }
  return {
    content: buf.toString('utf8'),
    binary: false,
    truncated: false,
    size: stat.size,
  };
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  // 只允许写已存在的普通文件:查看器是「轻编辑」,不负责新建
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error('not a regular file');
  await fs.writeFile(path, content, 'utf8');
}
