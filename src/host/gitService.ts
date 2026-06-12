// git 感知服务:全部 shell out 到 git CLI(execFile,无 shell 注入面),
// 只读操作,TermPro 不代办任何 worktree 写操作(README §四 M2 边界)。

import { execFile } from 'node:child_process';
import { GitFileStatus, GitInfo, GitStatusEntry } from '../shared/protocol';

const GIT_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 4 * 1024 * 1024;

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

export async function gitInfo(cwd: string): Promise<GitInfo> {
  let toplevel: string | null;
  try {
    toplevel = (await git(['rev-parse', '--show-toplevel'], cwd)).trim() || null;
  } catch {
    return { toplevel: null, mainWorktree: null, branch: null };
  }
  if (!toplevel) return { toplevel: null, mainWorktree: null, branch: null };

  let branch: string | null = null;
  try {
    branch = (await git(['branch', '--show-current'], cwd)).trim() || null;
  } catch {
    /* ignore */
  }
  if (!branch) {
    // detached HEAD → 短 SHA
    try {
      branch = (await git(['rev-parse', '--short', 'HEAD'], cwd)).trim() || null;
    } catch {
      /* 空仓库等 */
    }
  }

  // worktree list 第一条固定为主工作区
  let mainWorktree: string | null = null;
  try {
    const out = await git(['worktree', 'list', '--porcelain'], cwd);
    const first = out
      .split('\n')
      .find((line) => line.startsWith('worktree '));
    mainWorktree = first ? first.slice('worktree '.length).trim() : null;
  } catch {
    /* ignore */
  }

  return { toplevel, mainWorktree: mainWorktree ?? toplevel, branch };
}

export async function gitStatus(
  toplevel: string,
): Promise<{ entries: GitStatusEntry[] }> {
  let out: string;
  try {
    out = await git(['status', '--porcelain', '-z'], toplevel);
  } catch {
    return { entries: [] };
  }

  const entries: GitStatusEntry[] = [];
  const parts = out.split('\0').filter((p) => p.length > 0);
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4 || rec[2] !== ' ') continue;
    const x = rec[0];
    const y = rec[1];
    const path = rec.slice(3);
    let status: GitFileStatus;
    if (x === '?') status = 'untracked';
    else if (
      x === 'U' ||
      y === 'U' ||
      (x === 'A' && y === 'A') ||
      (x === 'D' && y === 'D') // both-deleted 也是未合并冲突态
    ) {
      status = 'conflicted';
    } else if (x === 'R' || x === 'C') {
      status = 'renamed';
      i++; // -z 模式下 rename/copy 的原路径是下一条记录,跳过
    } else if (x === 'D' || y === 'D') status = 'deleted';
    else if (x === 'A') status = 'added';
    else status = 'modified';
    entries.push({ path, status });
  }
  return { entries };
}
