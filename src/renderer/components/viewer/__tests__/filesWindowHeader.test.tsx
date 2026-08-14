// @vitest-environment jsdom
// 查看器头部常驻入口(用户指令 2026-08-14):远程文件 → Preview 前有「刷新」、Save 右有
// 「下载」;本机文件两者都不给。刷新 = 内容子树整棵重挂载(所有预览器一律从 host 重读),
// 有未保存修改先确认。各内容组件在此整体 mock(只数挂载次数),避免拉起 monaco/webview。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { hostClient } = vi.hoisted(() => ({
  hostClient: { info: { homedir: '/home/pi' }, rpc: vi.fn(), supportsTransfer: vi.fn(() => true) },
}));
vi.mock('../../../services/hostClient', () => ({ hostClient }));
vi.mock('../../../terminal/terminalRegistry', () => ({ disposeTerminal: vi.fn() }));
vi.mock('../useViewerConnection', () => ({
  useViewerConnection: () => ({
    ready: true,
    error: null,
    disconnected: false,
    refreshing: false,
    refresh: vi.fn(),
  }),
}));

const { mounts, dirtyHooks } = vi.hoisted(() => ({
  mounts: { file: 0, md: 0, html: 0, dir: 0 },
  dirtyHooks: [] as Array<(d: boolean) => void>,
}));
vi.mock('../FileView', () => ({
  FileView: (props: { onDirtyChange?: (d: boolean) => void }) => {
    mounts.file += 1;
    if (props.onDirtyChange) dirtyHooks.push(props.onDirtyChange);
    return <div data-testid="file-view" />;
  },
}));
vi.mock('../MarkdownPreview', () => ({
  MarkdownPreview: () => {
    mounts.md += 1;
    return <div data-testid="md-preview" />;
  },
}));
vi.mock('../HtmlPreview', () => ({
  HtmlPreview: () => {
    mounts.html += 1;
    return <div data-testid="html-preview" />;
  },
}));
vi.mock('../DirListing', () => ({
  DirListing: () => {
    mounts.dir += 1;
    return <div data-testid="dir-listing" />;
  },
}));
vi.mock('../DownloadAction', () => ({
  HeaderDownloadButton: ({ path }: { path: string }) => (
    <button data-testid="header-download">{`dl:${path}`}</button>
  ),
  DownloadAction: () => null,
}));

import { FilesWindow } from '../FilesWindow';

function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: {
      onViewerAddTab: () => () => undefined,
      onMenu: () => () => undefined,
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
    },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  mounts.file = 0;
  mounts.md = 0;
  mounts.html = 0;
  mounts.dir = 0;
  dirtyHooks.length = 0;
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('FilesWindow 头部:远程常驻刷新 + 下载', () => {
  it('远程 markdown 文件:Preview 之前有刷新、Save 之后有下载', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/home/pi/PRD.md" hostId="pi" />);
    const labels = [...document.querySelectorAll('.viewer-actions button')].map(
      (b) => b.textContent,
    );
    expect(labels.indexOf('Refresh')).toBe(0);
    expect(labels.indexOf('Refresh')).toBeLessThan(labels.indexOf('Preview'));
    expect(labels.indexOf('Save')).toBeLessThan(
      labels.findIndex((l) => l?.startsWith('dl:')),
    );
    expect(screen.getByTestId('header-download').textContent).toBe(
      'dl:/home/pi/PRD.md',
    );
  });

  it('远程纯文本 / 图片(无 Preview 段)照样有刷新与下载', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/home/pi/a.log" hostId="pi" />);
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.getByTestId('header-download')).toBeTruthy();
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('远程目录 tab:有刷新,无下载(目录不是可下载的单文件)', () => {
    mockOkwork();
    render(
      <FilesWindow initialPath="/home/pi/logs" initialKind="dir" hostId="pi" />,
    );
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.queryByTestId('header-download')).toBeNull();
  });

  it('本机文件两个入口都不给(头部已有 Finder / 默认应用)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/Users/liam/PRD.md" hostId="local" />);
    expect(screen.queryByText('Refresh')).toBeNull();
    expect(screen.queryByTestId('header-download')).toBeNull();
  });
});

describe('FilesWindow 刷新:整棵内容子树重挂载', () => {
  it('点刷新 → FileView / markdown 预览都重新挂载(从 host 重读)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/home/pi/PRD.md" hostId="pi" />);
    const before = { file: mounts.file, md: mounts.md };
    expect(before.file).toBeGreaterThan(0);
    expect(before.md).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Refresh'));
    expect(mounts.file).toBe(before.file + 1);
    expect(mounts.md).toBe(before.md + 1);
  });

  it('目录 listing 同样重挂载', () => {
    mockOkwork();
    render(
      <FilesWindow initialPath="/home/pi/logs" initialKind="dir" hostId="pi" />,
    );
    const before = mounts.dir;
    fireEvent.click(screen.getByText('Refresh'));
    expect(mounts.dir).toBe(before + 1);
  });

  it('有未保存修改:确认才刷新,取消则原样不动', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/home/pi/PRD.md" hostId="pi" />);
    act(() => dirtyHooks.forEach((fn) => fn(true)));
    const before = mounts.file;

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByText('Refresh'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mounts.file).toBe(before);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByText('Refresh'));
    expect(mounts.file).toBe(before + 1);
  });

  it('无未保存修改时不弹确认', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/home/pi/PRD.md" hostId="pi" />);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Refresh'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
