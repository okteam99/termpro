// 项目内 HTML 预览:previewUrl.ts 纯逻辑单测。
// ① pickPreviewRoot 三分支(workspaceRoot 命中 / effectiveRoot 命中 / 都不在 → null);
// ② buildPreviewUrl 逐段编码(空格/中文/#/?)+ 越界 → null。

import { describe, expect, it } from 'vitest';
import { buildPreviewUrl, isPreviewable, pickPreviewRoot } from '../previewUrl';
import type { PreviewInfo } from '../../../shared/protocol';

describe('isPreviewable', () => {
  it('.html/.htm 大小写不敏感 → true;其余 → false', () => {
    expect(isPreviewable('index.html')).toBe(true);
    expect(isPreviewable('INDEX.HTML')).toBe(true);
    expect(isPreviewable('page.htm')).toBe(true);
    expect(isPreviewable('style.css')).toBe(false);
    expect(isPreviewable('README.md')).toBe(false);
    expect(isPreviewable('html')).toBe(false); // 无扩展名的裸词不算
  });
});

describe('pickPreviewRoot', () => {
  it('file 在 workspaceRoot 下 → 选 workspaceRoot(即便也在 effectiveRoot 下)', () => {
    expect(
      pickPreviewRoot({
        filePath: '/repo/sub/index.html',
        workspaceRoot: '/repo',
        effectiveRoot: '/repo/sub',
      }),
    ).toBe('/repo');
  });

  it('file 不在 workspaceRoot 下、但在 effectiveRoot 下 → 选 effectiveRoot', () => {
    expect(
      pickPreviewRoot({
        filePath: '/repo/worktrees/feat/index.html',
        workspaceRoot: '/repo/main',
        effectiveRoot: '/repo/worktrees/feat',
      }),
    ).toBe('/repo/worktrees/feat');
  });

  it('两者都不含 file → null(绝不猜根)', () => {
    expect(
      pickPreviewRoot({
        filePath: '/elsewhere/index.html',
        workspaceRoot: '/repo',
        effectiveRoot: '/repo/sub',
      }),
    ).toBeNull();
  });

  it('workspaceRoot/effectiveRoot 缺省(null/undefined)→ 对应分支跳过', () => {
    expect(
      pickPreviewRoot({ filePath: '/repo/index.html', workspaceRoot: null, effectiveRoot: '/repo' }),
    ).toBe('/repo');
    expect(
      pickPreviewRoot({
        filePath: '/repo/index.html',
        workspaceRoot: undefined,
        effectiveRoot: undefined,
      }),
    ).toBeNull();
  });

  it('file 与 root 相等(root 自身是待预览文件的父目录路径字符串)也算命中', () => {
    expect(
      pickPreviewRoot({ filePath: '/repo', workspaceRoot: '/repo', effectiveRoot: null }),
    ).toBe('/repo');
  });
});

describe('buildPreviewUrl', () => {
  const info: PreviewInfo = { root: '/repo', port: 54321, token: 'tok-abc123' };

  it('普通相对路径:token + 各段拼在 URL 里,host 恒 127.0.0.1', () => {
    expect(buildPreviewUrl(info, '/repo/dist/index.html')).toBe(
      'http://127.0.0.1:54321/tok-abc123/dist/index.html',
    );
  });

  it('root 自身(无相对路径段)→ 只有 token 一段', () => {
    expect(buildPreviewUrl(info, '/repo')).toBe('http://127.0.0.1:54321/tok-abc123');
  });

  it('路径段含空格 → 逐段 encodeURIComponent(%20),分隔符 / 保留', () => {
    expect(buildPreviewUrl(info, '/repo/my folder/index.html')).toBe(
      'http://127.0.0.1:54321/tok-abc123/my%20folder/index.html',
    );
  });

  it('路径段含中文 → UTF-8 百分号编码', () => {
    const url = buildPreviewUrl(info, '/repo/文档/首页.html');
    expect(url).toBe(
      `http://127.0.0.1:54321/tok-abc123/${encodeURIComponent('文档')}/${encodeURIComponent('首页.html')}`,
    );
    expect(url).not.toContain('文档');
  });

  it('路径段含 # → %23,? → %3F(否则被当 fragment/query 截断)', () => {
    expect(buildPreviewUrl(info, '/repo/a#b/c?d.html')).toBe(
      'http://127.0.0.1:54321/tok-abc123/a%23b/c%3Fd.html',
    );
  });

  it('file 不在 info.root 下 → null(绝不吐注定 404 的 URL)', () => {
    expect(buildPreviewUrl(info, '/elsewhere/index.html')).toBeNull();
    // 前缀碰巧相似但不是真子路径(/repository vs /repo)也要判越界
    expect(buildPreviewUrl(info, '/repository/index.html')).toBeNull();
  });
});
