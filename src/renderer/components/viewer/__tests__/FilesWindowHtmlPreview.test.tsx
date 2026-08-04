// @vitest-environment jsdom
// FilesWindow · html tab 默认 Preview 模式(阶段4 · 用户指令:点 html 文件默认预览,
// 与 md 一致)。子组件(Monaco/HtmlPreview 网络请求)与本用例无关,一律桩掉;只验证
// FilesWindow 自己的编排:viewMode/previewKind 初值、Preview↔Edit 切换不卸载
// FileView(保未保存内容)、保存后 reloadSeq+1 传给 HtmlPreview。
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
vi.mock('../DirListing', () => ({ DirListing: () => <div /> }));
vi.mock('../MarkdownPreview', () => ({ MarkdownPreview: () => <div data-testid="md-preview" /> }));

// FileView 桩:暴露一个「save」按钮触发 onSaved(模拟保存成功路径)。是否被卸载重挂
// 靠比较 DOM 节点身份(mock 组件本身会随 FilesWindow 每次 re-render 重新执行函数体,
// 那是正常的 React 渲染,不代表卸载——真正的卸载/重挂会产生新的 DOM 节点)。
vi.mock('../FileView', () => ({
  FileView: ({ onSaved }: { onSaved?: () => void }) => (
    <button data-testid="fileview-save" onClick={() => onSaved?.()}>
      save
    </button>
  ),
}));

const htmlPreviewProps = vi.fn();
vi.mock('../HtmlPreview', () => ({
  HtmlPreview: (props: { reloadSeq: number; previewRoot?: string; dirty: boolean }) => {
    htmlPreviewProps(props);
    return <div data-testid="html-preview" data-reload-seq={props.reloadSeq} />;
  },
}));

import { FilesWindow } from '../FilesWindow';

function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: {
      onViewerAddTab: () => () => {},
      onMenu: () => () => {},
    },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  htmlPreviewProps.mockReset();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('FilesWindow · html 默认预览(阶段4)', () => {
  it('打开 .html 文件:viewMode=preview/previewKind=html → 渲染 HtmlPreview,不是 MarkdownPreview', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/index.html" initialPreviewRoot="/repo" />);
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    expect(screen.queryByTestId('md-preview')).toBeNull();
    expect(htmlPreviewProps).toHaveBeenCalledWith(
      expect.objectContaining({ previewRoot: '/repo', reloadSeq: 0, dirty: false }),
    );
  });

  it('Preview/Edit 切换:HtmlPreview 挂/卸,但 FileView 全程不卸载(未保存内容不丢——同一 DOM 节点)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/index.html" />);
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    const fileViewNode = screen.getByTestId('fileview-save');

    fireEvent.click(screen.getByText('Edit'));
    expect(screen.queryByTestId('html-preview')).toBeNull();
    // 真正的卸载重挂会产生新 DOM 节点;同一节点 = FileView 全程常挂载,只是可见性变了
    expect(screen.getByTestId('fileview-save')).toBe(fileViewNode);

    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByTestId('html-preview')).toBeTruthy();
    expect(screen.getByTestId('fileview-save')).toBe(fileViewNode);
  });

  it('保存(FileView onSaved)→ 该 tab 的 reloadSeq +1,HtmlPreview 收到新值', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/index.html" />);
    expect(screen.getByTestId('html-preview').getAttribute('data-reload-seq')).toBe('0');

    fireEvent.click(screen.getByTestId('fileview-save'));
    expect(screen.getByTestId('html-preview').getAttribute('data-reload-seq')).toBe('1');

    fireEvent.click(screen.getByTestId('fileview-save'));
    expect(screen.getByTestId('html-preview').getAttribute('data-reload-seq')).toBe('2');
  });

  it('.md 文件:仍走 MarkdownPreview(html 预览改造未回归 markdown 既有行为)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/README.md" />);
    expect(screen.getByTestId('md-preview')).toBeTruthy();
    expect(screen.queryByTestId('html-preview')).toBeNull();
  });

  it('普通文本文件(.ts):无 Preview/Edit 分段按钮(viewMode=null)', () => {
    mockOkwork();
    render(<FilesWindow initialPath="/repo/index.ts" />);
    expect(screen.queryByText('Preview')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByTestId('html-preview')).toBeNull();
    expect(screen.queryByTestId('md-preview')).toBeNull();
  });
});
