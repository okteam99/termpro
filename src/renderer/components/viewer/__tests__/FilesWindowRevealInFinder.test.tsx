// @vitest-environment jsdom
// 文件窗工具栏的「Finder 中显示」入口:目的是从预览一步跳到文件所在目录。
// 三条边界:本机文件 tab 才有(D-7 远程不渲染:本机 shell 会静默作用于同名无关文件);
// 目录 tab 不重复挂(它的「系统应用打开」本就是拿 Finder 开这个目录)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../services/hostClient', () => ({
  hostClient: { info: { homedir: '/Users/test' }, rpc: vi.fn() },
}));
vi.mock('../useViewerConnection', () => ({
  useViewerConnection: () => ({
    ready: true,
    error: null,
    disconnected: false,
    refreshing: false,
    refresh: vi.fn(),
  }),
}));
// 重子组件桩掉(Monaco / markdown 渲染与本用例无关)
vi.mock('../FileView', () => ({ FileView: () => <div /> }));
vi.mock('../MarkdownPreview', () => ({ MarkdownPreview: () => <div /> }));
vi.mock('../DirListing', () => ({ DirListing: () => <div /> }));

import { FilesWindow } from '../FilesWindow';

const showItemInFolder = vi.fn();
const openPath = vi.fn();
function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: {
      showItemInFolder,
      openPath,
      onViewerAddTab: () => () => {},
      onMenu: () => () => {},
    },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  showItemInFolder.mockReset();
  openPath.mockReset();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('FilesWindow · Finder 中显示', () => {
  it('本机文件 tab:点按钮 → showItemInFolder(当前 tab 的绝对路径)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/docs/plan.md" />);
    fireEvent.click(screen.getByText('Reveal in Finder'));
    expect(showItemInFolder).toHaveBeenCalledWith('/repo/docs/plan.md');
    expect(openPath).not.toHaveBeenCalled(); // 与「系统应用打开」是两个动作
  });

  it('远程窗口:不渲染该入口(D-7·本机 shell 会跳到本机同名无关文件)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/workspace/aon-main/plan.md" hostId="cfg-1" />);
    expect(screen.queryByText('Reveal in Finder')).toBeNull();
    expect(screen.queryByText('Open with default app')).toBeNull();
  });

  it('目录 tab:不渲染(避免与「系统应用打开」两个按钮语义打架)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/docs" initialKind="dir" />);
    expect(screen.queryByText('Reveal in Finder')).toBeNull();
    expect(screen.getByText('Open with default app')).toBeTruthy();
  });
});
