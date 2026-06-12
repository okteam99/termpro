import { describe, expect, it } from 'vitest';
import {
  parseDiffNameStatusZ,
  parseStatusPorcelainZ,
  parseWorktreesPorcelain,
} from '../gitService';

const NUL = '\0';

describe('parseStatusPorcelainZ', () => {
  it('解析常见状态', () => {
    const out =
      [' M src/a.ts', '?? new.txt', 'A  added.ts', ' D gone.ts'].join(NUL) +
      NUL;
    expect(parseStatusPorcelainZ(out)).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'new.txt', status: 'untracked' },
      { path: 'added.ts', status: 'added' },
      { path: 'gone.ts', status: 'deleted' },
    ]);
  });

  it('rename 记录跳过原路径,不误解析', () => {
    const out = ['R  new-name.ts', 'old-name.ts', ' M other.ts'].join(NUL) + NUL;
    expect(parseStatusPorcelainZ(out)).toEqual([
      { path: 'new-name.ts', status: 'renamed' },
      { path: 'other.ts', status: 'modified' },
    ]);
  });

  it('未合并冲突态:UU/AA/DD 都标记 conflicted', () => {
    const out = ['UU both.ts', 'AA both-added.ts', 'DD both-deleted.ts'].join(NUL) + NUL;
    expect(parseStatusPorcelainZ(out).map((e) => e.status)).toEqual([
      'conflicted',
      'conflicted',
      'conflicted',
    ]);
  });

  it('空输出与含空格路径', () => {
    expect(parseStatusPorcelainZ('')).toEqual([]);
    const out = ' M dir with space/file name.ts' + NUL;
    expect(parseStatusPorcelainZ(out)).toEqual([
      { path: 'dir with space/file name.ts', status: 'modified' },
    ]);
  });
});

describe('parseDiffNameStatusZ', () => {
  it('解析 A/M/D/T/U 与 R/C 双路径', () => {
    const out =
      ['M', 'src/a.ts', 'A', 'new.ts', 'D', 'old.ts', 'T', 'mode.sh', 'U', 'conflict.ts', 'R086', 'before.ts', 'after.ts', 'C075', 'src.ts', 'copy.ts'].join(NUL) + NUL;
    expect(parseDiffNameStatusZ(out)).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'new.ts', status: 'added' },
      { path: 'old.ts', status: 'deleted' },
      { path: 'mode.sh', status: 'modified' },
      { path: 'conflict.ts', status: 'conflicted' },
      { path: 'after.ts', status: 'renamed' },
      { path: 'copy.ts', status: 'renamed' },
    ]);
  });

  it('空输出', () => {
    expect(parseDiffNameStatusZ('')).toEqual([]);
  });
});

describe('parseWorktreesPorcelain', () => {
  it('解析主工作区 + 普通 worktree + detached', () => {
    const out = [
      'worktree /repo',
      'HEAD 0123456789abcdef',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktree/feat-x',
      'HEAD fedcba9876543210',
      'branch refs/heads/feature/x',
      '',
      'worktree /repo/.worktree/detached-one',
      'HEAD aaaa111122223333',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktreesPorcelain(out)).toEqual([
      { path: '/repo', head: '0123456', branch: 'main' },
      { path: '/repo/.worktree/feat-x', head: 'fedcba9', branch: 'feature/x' },
      { path: '/repo/.worktree/detached-one', head: 'aaaa111', branch: null },
    ]);
  });

  it('跳过 bare 仓库条目', () => {
    const out = ['worktree /bare.git', 'bare', '', 'worktree /wt', 'HEAD abc1234567', 'branch refs/heads/dev', ''].join('\n');
    expect(parseWorktreesPorcelain(out)).toEqual([
      { path: '/wt', head: 'abc1234', branch: 'dev' },
    ]);
  });
});
