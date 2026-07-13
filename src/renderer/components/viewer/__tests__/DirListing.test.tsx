// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../../services/hostClient', () => ({
  hostClient: { info: { homedir: '/Users/test' }, rpc },
}));

import { DirListing } from '../DirListing';

const openViewerWindow = vi.fn();
function mockTermpro() {
  Object.defineProperty(window, 'termpro', {
    value: { openViewerWindow },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  rpc.mockReset();
  openViewerWindow.mockReset();
  delete (window as unknown as Record<string, unknown>).termpro;
});

const names = () =>
  Array.from(document.querySelectorAll('.dir-row-name')).map(
    (e) => e.textContent,
  );

describe('DirListing', () => {
  it('列举条目(目录优先、组内字母序),点击开对应窗口', async () => {
    mockTermpro();
    rpc.mockImplementation((method: string) =>
      method === 'fs.readdir'
        ? Promise.resolve({
            entries: [
              { name: 'b.ts', kind: 'file' },
              { name: 'sub', kind: 'dir' },
              { name: 'a.ts', kind: 'file' },
            ],
          })
        : Promise.resolve({ kind: null }),
    );
    render(<DirListing path="/repo/docs" />);
    await screen.findByText('sub');

    // .. 在首,随后目录优先 → sub,再文件字母序 a.ts/b.ts
    expect(names()).toEqual(['..', 'sub', 'a.ts', 'b.ts']);

    fireEvent.click(screen.getByText('a.ts'));
    expect(openViewerWindow).toHaveBeenCalledWith({
      mode: 'file',
      path: '/repo/docs/a.ts',
    });

    fireEvent.click(screen.getByText('sub'));
    expect(openViewerWindow).toHaveBeenCalledWith({
      mode: 'dir',
      path: '/repo/docs/sub',
    });
  });

  it('点 .. 回上级目录', async () => {
    mockTermpro();
    rpc.mockResolvedValue({ entries: [] });
    render(<DirListing path="/repo/docs" />);
    await screen.findByText('..');
    fireEvent.click(screen.getByText('..'));
    expect(openViewerWindow).toHaveBeenCalledWith({ mode: 'dir', path: '/repo' });
  });

  it('空目录给出提示', async () => {
    mockTermpro();
    rpc.mockResolvedValue({ entries: [] });
    render(<DirListing path="/repo/docs" />);
    await screen.findByText('(empty directory)');
  });

  it('远程窗口(hostId):条目点击与 .. 的 payload 都带回 hostId(防跨窗误路由)', async () => {
    mockTermpro();
    rpc.mockImplementation((method: string) =>
      method === 'fs.readdir'
        ? Promise.resolve({ entries: [{ name: 'a.ts', kind: 'file' }] })
        : Promise.resolve({ kind: null }),
    );
    render(<DirListing path="/repo/docs" hostId="cfg-1" />);
    await screen.findByText('a.ts');

    fireEvent.click(screen.getByText('a.ts'));
    expect(openViewerWindow).toHaveBeenCalledWith({
      mode: 'file',
      path: '/repo/docs/a.ts',
      hostId: 'cfg-1',
    });

    fireEvent.click(screen.getByText('..'));
    expect(openViewerWindow).toHaveBeenCalledWith({
      mode: 'dir',
      path: '/repo',
      hostId: 'cfg-1',
    });
  });

  it('软链点击先 stat 再按真实类型开窗', async () => {
    mockTermpro();
    rpc.mockImplementation((method: string) =>
      method === 'fs.readdir'
        ? Promise.resolve({ entries: [{ name: 'link', kind: 'symlink' }] })
        : Promise.resolve({ kind: 'dir' }),
    );
    render(<DirListing path="/repo" />);
    fireEvent.click(await screen.findByText('link'));
    // stat 返回 dir → 以 dir 模式开
    await vi.waitFor(() =>
      expect(openViewerWindow).toHaveBeenCalledWith({
        mode: 'dir',
        path: '/repo/link',
      }),
    );
  });
});
