// @vitest-environment jsdom
// 项目内 HTML 预览(阶段4):三级预览根回退(纯函数)+ HtmlPreview 组件行为
// (webview src/partition、远程 hold 时序、reloadSeq→reload、错误屏+重试、脏态提示条)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../../services/hostClient', () => ({
  hostClient: { info: { homedir: '/Users/test' }, rpc },
}));

import { HtmlPreview, resolvePreviewRoot, dirnameOf } from '../HtmlPreview';

const hold = vi.fn().mockResolvedValue({ local: true, exits: [] });
function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: { browserNet: { hold } },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  rpc.mockReset();
  hold.mockReset();
  hold.mockResolvedValue({ local: true, exits: [] });
  delete (window as unknown as Record<string, unknown>).okwork;
});

function webviewEl(): HTMLElement {
  const el = document.querySelector('webview');
  if (!el) throw new Error('webview not found');
  return el as HTMLElement;
}

// ---- 预览根三级回退(纯函数)----

describe('resolvePreviewRoot', () => {
  it.each([
    [
      'payload previewRoot 优先(不看 gitToplevel)',
      { previewRoot: '/repo', gitToplevel: '/other', path: '/repo/a/b.html' },
      '/repo',
    ],
    [
      '无 previewRoot → 用 gitToplevel',
      { previewRoot: null, gitToplevel: '/repo', path: '/repo/a/b.html' },
      '/repo',
    ],
    [
      'previewRoot 空串按无处理 → 用 gitToplevel',
      { previewRoot: '', gitToplevel: '/repo', path: '/repo/a/b.html' },
      '/repo',
    ],
    [
      '都无 → dirname(path)',
      { previewRoot: null, gitToplevel: null, path: '/repo/a/b.html' },
      '/repo/a',
    ],
    [
      'gitToplevel 也可能是 undefined(git.info 出参可选链)',
      { previewRoot: undefined, gitToplevel: undefined, path: '/repo/b.html' },
      '/repo',
    ],
  ])('%s', (_label, args, expected) => {
    expect(resolvePreviewRoot(args)).toBe(expected);
  });
});

describe('dirnameOf', () => {
  it.each([
    ['/repo/a/b.html', '/repo/a'],
    ['/repo/b.html', '/repo'],
    ['/b.html', '/'],
    ['/repo/a/', '/repo'],
  ])('dirnameOf(%s) = %s', (input, expected) => {
    expect(dirnameOf(input)).toBe(expected);
  });
});

// ---- HtmlPreview 组件 ----

describe('HtmlPreview', () => {
  it('本机:preview.ensure → buildPreviewUrl 拼 src,partition=persist:browser,不 hold', async () => {
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') {
        return Promise.resolve({ root: '/repo', port: 4123, token: 'tok' });
      }
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
    const el = webviewEl();
    expect(el.getAttribute('src')).toBe('http://127.0.0.1:4123/tok/index.html');
    expect(el.getAttribute('partition')).toBe('persist:browser');
    expect(hold).not.toHaveBeenCalled();
  });

  it('远程:先 hold([hostId]) 再设 src,partition 带 hostId,unmount → hold([])', async () => {
    mockOkwork();
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') {
        return Promise.resolve({ root: '/ws', port: 5000, token: 'tk' });
      }
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    const { unmount } = render(
      <HtmlPreview
        path="/ws/index.html"
        hostId="cfg-1"
        previewRoot="/ws"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
    expect(hold).toHaveBeenCalledWith(['cfg-1']);
    const el = webviewEl();
    expect(el.getAttribute('partition')).toBe('persist:browser-cfg-1');
    unmount();
    expect(hold).toHaveBeenLastCalledWith([]);
  });

  it('无 previewRoot → git.info(cwd=dirname(path)) 的 toplevel 起 server', async () => {
    rpc.mockImplementation((method: string, params: unknown) => {
      if (method === 'git.info') {
        expect(params).toEqual({ cwd: '/repo/sub' });
        return Promise.resolve({ toplevel: '/repo', mainWorktree: '/repo', branch: 'main' });
      }
      if (method === 'preview.ensure') {
        expect(params).toEqual({ root: '/repo' });
        return Promise.resolve({ root: '/repo', port: 9, token: 'z' });
      }
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    render(
      <HtmlPreview path="/repo/sub/index.html" reloadSeq={0} dirty={false} onRequestSave={() => {}} />,
    );
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
  });

  it('git.info 失败(非致命)→ 退化到 dirname(path) 起 server', async () => {
    rpc.mockImplementation((method: string, params: unknown) => {
      if (method === 'git.info') return Promise.reject(new Error('boom'));
      if (method === 'preview.ensure') {
        expect(params).toEqual({ root: '/repo/sub' });
        return Promise.resolve({ root: '/repo/sub', port: 9, token: 'z' });
      }
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    render(
      <HtmlPreview path="/repo/sub/index.html" reloadSeq={0} dirty={false} onRequestSave={() => {}} />,
    );
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
  });

  it('reloadSeq 变化(非首帧)→ webview.reload() 被调用(jsdom 无原生方法,挂桩观察 · mock ref)', async () => {
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') {
        return Promise.resolve({ root: '/repo', port: 4123, token: 'tok' });
      }
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    const { rerender } = render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
    const el = webviewEl() as HTMLElement & { reload: () => void };
    el.reload = vi.fn();
    rerender(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={1}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await waitFor(() => expect(el.reload).toHaveBeenCalledTimes(1));
    // 再挂载(reloadSeq 首帧不变)不重复 reload
    rerender(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={1}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    expect(el.reload).toHaveBeenCalledTimes(1);
  });

  it('preview.ensure 报 unknown rpc method → host 过旧文案 + 重试按钮重跑成功', async () => {
    rpc.mockRejectedValue(new Error('unknown rpc method: preview.ensure'));
    render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await screen.findByText("This machine's host is too old for preview — upgrade it");
    rpc.mockReset();
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') return Promise.resolve({ root: '/repo', port: 1, token: 't' });
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
  });

  it('preview.ensure 其它失败 → 确定性 message 文案(与 openPreview.ts 同款措辞)', async () => {
    rpc.mockRejectedValue(new Error('ECONNREFUSED'));
    render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await screen.findByText('Failed to start the preview server: ECONNREFUSED');
  });

  it('buildPreviewUrl 返回 null(root 与文件不匹配)→ 错误屏', async () => {
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') return Promise.resolve({ root: '/other', port: 1, token: 't' });
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await screen.findByText('Failed to build the preview URL');
  });

  it('dirty=true → 顶部提示条,点「Save & refresh」调 onRequestSave', async () => {
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') return Promise.resolve({ root: '/repo', port: 1, token: 't' });
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    const onRequestSave = vi.fn();
    render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty
        onRequestSave={onRequestSave}
      />,
    );
    fireEvent.click(await screen.findByText('Save & refresh'));
    expect(onRequestSave).toHaveBeenCalledTimes(1);
  });

  it('dirty=false → 不渲染提示条', async () => {
    rpc.mockImplementation((method: string) => {
      if (method === 'preview.ensure') return Promise.resolve({ root: '/repo', port: 1, token: 't' });
      return Promise.reject(new Error(`unexpected rpc ${method}`));
    });
    render(
      <HtmlPreview
        path="/repo/index.html"
        previewRoot="/repo"
        reloadSeq={0}
        dirty={false}
        onRequestSave={() => {}}
      />,
    );
    await waitFor(() => expect(document.querySelector('webview')).toBeTruthy());
    expect(screen.queryByText('Save & refresh')).toBeNull();
  });
});
