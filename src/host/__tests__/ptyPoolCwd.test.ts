// resolveSpawnCwd(2026-07-15):spawn cwd 不存在(如清理掉的 worktree)时回退【最近存在
// 祖先】而非家目录——workspace tab 的 cwd 恒在项目内,最近存在祖先仍落在工作区内,
// 避免落家目录后被容器 profile.d 的 `cd /workspace` 带去挂载根(与工作区不一致)。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveSpawnCwd } from '../ptyPool';

const HOME = '/home/tester';
let root: string; // 存在的项目根

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-cwd-'));
  fs.mkdirSync(path.join(root, 'proj', '.worktree'), { recursive: true });
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveSpawnCwd', () => {
  it('cwd 存在 → 原样返回', () => {
    const proj = path.join(root, 'proj');
    expect(resolveSpawnCwd(proj, HOME)).toBe(proj);
  });

  it('清理掉的 worktree → 回退最近存在祖先(仍在项目内),非家目录', () => {
    // /…/proj/.worktree/ADM-gone 不存在;.worktree 存在 → 落 .worktree(项目内)
    const gone = path.join(root, 'proj', '.worktree', 'ADM-gone');
    expect(resolveSpawnCwd(gone, HOME)).toBe(path.join(root, 'proj', '.worktree'));
  });

  it('worktree 容器目录也没了 → 继续上溯到项目根', () => {
    const deeperGone = path.join(root, 'proj', 'nope', 'deeper', 'x');
    expect(resolveSpawnCwd(deeperGone, HOME)).toBe(path.join(root, 'proj'));
  });

  it('彻底无关的野路径(祖先一路到文件系统根)→ 退家目录', () => {
    expect(resolveSpawnCwd('/nonexistent-xyz-123/a/b', HOME)).toBe(HOME);
  });
});
