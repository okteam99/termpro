// openHtmlPreview 编排单测(openPreview.ts):选根失败 / 未连接机器(forHostId miss,绝不
// 兜底 local)/ RPC 失败(旧 host unknown rpc method vs 其它错误)/ URL 构建失败 / 成功路径。
// hostRegistry 与 openBuiltinBrowser 均 mock——本文件只验证编排的分支选择与参数透传,
// 选根/拼 URL 的纯逻辑由 previewUrl.test.ts 覆盖,不重复断言。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { forHostId, openBuiltinBrowserMock } = vi.hoisted(() => ({
  forHostId: vi.fn(),
  openBuiltinBrowserMock: vi.fn(),
}));
vi.mock('../hostRegistry', () => ({ hostRegistry: { forHostId } }));
vi.mock('../openBuiltinBrowser', () => ({ openBuiltinBrowser: openBuiltinBrowserMock }));

import { openHtmlPreview } from '../openPreview';

const BASE_ARGS = {
  filePath: '/repo/index.html',
  workspaceRoot: '/repo',
  effectiveRoot: '/repo',
  hostId: 'cfg-1',
  terminalTabId: 't1',
};

beforeEach(() => {
  forHostId.mockReset();
  openBuiltinBrowserMock.mockReset();
});

describe('openHtmlPreview', () => {
  it('选根失败(file 越界)→ 确定性失败文案,不触碰 hostRegistry', async () => {
    const res = await openHtmlPreview({ ...BASE_ARGS, filePath: '/elsewhere/index.html' });
    expect(res).toEqual({
      ok: false,
      message: 'This file is outside the workspace — cannot start a preview',
    });
    expect(forHostId).not.toHaveBeenCalled();
  });

  it('forHostId 未命中(目标机未连接)→ 绝不兜底 local,确定性失败文案', async () => {
    forHostId.mockReturnValue(null);
    const res = await openHtmlPreview(BASE_ARGS);
    expect(res).toEqual({ ok: false, message: 'Target machine is not connected' });
    expect(forHostId).toHaveBeenCalledWith('cfg-1');
    expect(openBuiltinBrowserMock).not.toHaveBeenCalled();
  });

  it('preview.ensure 抛 unknown rpc method(旧 host)→ 升级提示', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('unknown rpc method: preview.ensure'));
    forHostId.mockReturnValue({ rpc });
    const res = await openHtmlPreview(BASE_ARGS);
    expect(res).toEqual({
      ok: false,
      message: "This machine's host is too old for preview — upgrade it",
    });
  });

  it('preview.ensure 抛其它错误 → 通用失败文案(带原始错误信息)', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    forHostId.mockReturnValue({ rpc });
    const res = await openHtmlPreview(BASE_ARGS);
    expect(res).toEqual({
      ok: false,
      message: 'Failed to start the preview server: ECONNREFUSED',
    });
  });

  it('preview.ensure 成功但返回的 info 与 filePath 不在同一 root(越界)→ URL 构建失败文案', async () => {
    const rpc = vi.fn().mockResolvedValue({ root: '/other', port: 1234, token: 'tok' });
    forHostId.mockReturnValue({ rpc });
    const res = await openHtmlPreview(BASE_ARGS);
    expect(res).toEqual({ ok: false, message: 'Failed to build the preview URL' });
  });

  it('成功路径:preview.ensure 拿到 {root,port,token} → 拼 URL → 按 hostId+preview:true 开预览标签', async () => {
    const rpc = vi.fn().mockResolvedValue({ root: '/repo', port: 54321, token: 'tok-abc' });
    forHostId.mockReturnValue({ rpc });

    const res = await openHtmlPreview(BASE_ARGS);

    expect(rpc).toHaveBeenCalledWith('preview.ensure', { root: '/repo' });
    expect(openBuiltinBrowserMock).toHaveBeenCalledWith(
      't1',
      'http://127.0.0.1:54321/tok-abc/index.html',
      { netHostId: 'cfg-1', preview: true },
    );
    expect(res).toEqual({ ok: true });
  });

  it('选根:workspaceRoot 未命中但 effectiveRoot 命中 → root 取 effectiveRoot', async () => {
    const rpc = vi.fn().mockResolvedValue({ root: '/wt', port: 1, token: 'tok' });
    forHostId.mockReturnValue({ rpc });

    await openHtmlPreview({
      ...BASE_ARGS,
      filePath: '/wt/index.html',
      workspaceRoot: '/repo',
      effectiveRoot: '/wt',
    });

    expect(rpc).toHaveBeenCalledWith('preview.ensure', { root: '/wt' });
  });
});
