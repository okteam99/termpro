// git 感知服务:全部 shell out 到 git CLI(execFile,无 shell 注入面),
// 只读操作,OkWork 不代办任何 worktree 写操作(README §四 M2 边界)。

import { execFile } from 'node:child_process';
import {
  GitFileStatus,
  GitInfo,
  GitStatusEntry,
  WorktreeInfo,
} from '../shared/protocol';

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

/** 解析 `git worktree list --porcelain` 输出(纯函数,可测) */
export function parseWorktreesPorcelain(out: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  // porcelain 块以空行分隔:worktree <path> / HEAD <sha> / branch refs/heads/<x> 或 detached
  for (const block of out.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    const pathLine = lines.find((l) => l.startsWith('worktree '));
    if (!pathLine) continue;
    if (lines.some((l) => l === 'bare')) continue;
    const headLine = lines.find((l) => l.startsWith('HEAD '));
    const branchLine = lines.find((l) => l.startsWith('branch '));
    worktrees.push({
      path: pathLine.slice('worktree '.length).trim(),
      head: headLine ? headLine.slice('HEAD '.length).trim().slice(0, 7) : '',
      branch: branchLine
        ? branchLine.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
        : null,
    });
  }
  return worktrees;
}

export async function gitWorktrees(
  cwd: string,
): Promise<{ worktrees: WorktreeInfo[] }> {
  let out: string;
  try {
    out = await git(['worktree', 'list', '--porcelain'], cwd);
  } catch {
    return { worktrees: [] };
  }
  return { worktrees: parseWorktreesPorcelain(out) };
}

/** 解析 `git status --porcelain -z` 输出(纯函数,可测) */
export function parseStatusPorcelainZ(out: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  const parts = out.split('\0').filter((p) => p.length > 0);
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec.length < 4 || rec[2] !== ' ') continue;
    const x = rec[0];
    const y = rec[1];
    // 目录条目(untracked/ignored 整目录)带尾斜杠,归一掉便于树查表
    const path = rec.slice(3).replace(/\/$/, '');
    let status: GitFileStatus;
    if (x === '?') status = 'untracked';
    else if (x === '!') status = 'ignored';
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
  return entries;
}

export async function gitStatus(
  toplevel: string,
): Promise<{ entries: GitStatusEntry[] }> {
  let out: string;
  try {
    out = await git(['status', '--porcelain', '-z', '--ignored=matching'], toplevel);
  } catch {
    return { entries: [] };
  }
  return { entries: parseStatusPorcelainZ(out) };
}

/** 读 ref 下文件内容;不存在/二进制 → null */
export async function gitShow(
  toplevel: string,
  ref: string,
  path: string,
): Promise<{ content: string | null }> {
  try {
    const out = await git(['show', `${ref}:${path}`], toplevel);
    if (out.includes('\0')) return { content: null };
    return { content: out };
  } catch {
    return { content: null };
  }
}

/** 解析 `git diff --name-status -z` 输出(纯函数,可测)。
 *  形如 STATUS\0path\0,R/C 带相似度且有两个路径(old\0new) */
export function parseDiffNameStatusZ(out: string): GitStatusEntry[] {
  const tokens = out.split('\0').filter((t) => t.length > 0);
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const newPath = tokens[i + 2];
      if (newPath) entries.push({ path: newPath, status: 'renamed' });
      i += 2;
    } else {
      const path = tokens[i + 1];
      if (!path) break;
      let mapped: GitStatusEntry['status'];
      if (kind === 'A') mapped = 'added';
      else if (kind === 'D') mapped = 'deleted';
      else if (kind === 'U') mapped = 'conflicted';
      else mapped = 'modified'; // M / T 等
      entries.push({ path, status: mapped });
      i += 1;
    }
  }
  return entries;
}

/** 变更文件列表:有 baseRef → merge-base 比对(含未提交);否则未提交变更 */
export async function gitChangedFiles(
  toplevel: string,
  baseRef?: string,
): Promise<{ entries: GitStatusEntry[]; mergeBase: string | null }> {
  if (!baseRef) {
    const { entries } = await gitStatus(toplevel);
    // ignored 只服务文件树着色;diff 列表里无意义(也无内容可比)
    return {
      entries: entries.filter((e) => e.status !== 'ignored'),
      mergeBase: null,
    };
  }
  let mergeBase: string;
  try {
    mergeBase = (await git(['merge-base', baseRef, 'HEAD'], toplevel)).trim();
  } catch {
    return { entries: [], mergeBase: null };
  }
  let out: string;
  try {
    out = await git(['diff', '--name-status', '-z', mergeBase], toplevel);
  } catch {
    return { entries: [], mergeBase };
  }
  const entries = parseDiffNameStatusZ(out);
  // diff <base> 不含未跟踪文件,补上以与「未提交变更」模式语义一致
  try {
    const others = await git(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      toplevel,
    );
    const seen = new Set(entries.map((e) => e.path));
    for (const p of others.split('\0')) {
      if (p && !seen.has(p)) entries.push({ path: p, status: 'untracked' });
    }
  } catch {
    /* 尽力而为 */
  }
  return { entries, mergeBase };
}
