// 查询进程实时 cwd:工具无关的「会话在哪」信号源(README §四)。
// macOS 走 lsof(按需调用,不轮询),Linux 走 procfs。

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

const LSOF_TIMEOUT_MS = 3_000;

export async function processCwd(pid: number): Promise<string | null> {
  if (process.platform === 'linux') {
    try {
      return await fs.readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      { timeout: LSOF_TIMEOUT_MS },
      (err, stdout) => {
        if (err) return resolve(null);
        const line = stdout.split('\n').find((l) => l.startsWith('n'));
        resolve(line ? line.slice(1) : null);
      },
    );
  });
}
