// @vitest-environment jsdom
// FilesWindow · html tab 默认 Preview 模式(阶段4 · 用户指令:点 html 文件默认预览,
// 与 md 一致)。子组件(Monaco/HtmlPreview 网络请求)与本用例无关,一律桩掉;只验证
// FilesWindow 自己的编排:viewMode/previewKind 初值、Preview↔Edit 切换不卸载
// FileView(保未保存内容)、保存后 reloadSeq+1 传给 HtmlPreview。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

type AddTabCallback = (t: { path: string; kind: 'file' | 'dir'; previewRoot?: string }) => void;

/** onAddTab 可选:捕获 FilesWindow 订阅的 add-tab 回调,供用例手动触发「窗口复用追加 tab」。 */
function mockOkwork(onAddTab?: (cb: AddTabCallback) => void) {
  Object.defineProperty(window, 'okwork', {
    value: {
      onViewerAddTab: (cb: AddTabCallback) => {
        onAddTab?.(cb);
        return () => {};
      },
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

  it('评审 P2-14:关闭 tab 后 reloadSeqs 清掉对应键(即便 id 被复用,新 tab 的 reloadSeq 仍从 0 起)', () => {
    let addTab: AddTabCallback | null = null;
    mockOkwork((cb) => {
      addTab = cb;
    });
    // jsdom 的 window.close() 会真的拆掉 document(不是 Electron 里「关掉这个查看器窗口」
    // 那种无害 no-op),桩掉避免测试环境本身被销毁——closeTab 在最后一个 tab 关闭时会调它。
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID');
    uuidSpy.mockReturnValueOnce(
      'id-1' as unknown as `${string}-${string}-${string}-${string}-${string}`,
    );

    render(<FilesWindow initialPath="/repo/a.html" />);
    expect(screen.getByTestId('html-preview').getAttribute('data-reload-seq')).toBe('0');
    fireEvent.click(screen.getByTestId('fileview-save'));
    expect(screen.getByTestId('html-preview').getAttribute('data-reload-seq')).toBe('1');

    // 关掉这个(唯一)tab:closeTab 触发 window.close()(jsdom 下安全 no-op),
    // reloadSeqs 里 'id-1' 这条也该被一并删除(评审 P2-14 的修复点)。
    fireEvent.click(screen.getByTitle('Close (⌘W)'));

    // 新开一个 tab,mock id 复用同一个 'id-1' ——只是为了在测试里让「reloadSeqs 是否还
    // 留着旧键」变得可观察:若 closeTab 没清 reloadSeqs,这个新 tab 会错误地继承
    // reloadSeq=1(误判成「已经保存过一次」),而不是一个全新 tab 该有的 0。
    uuidSpy.mockReturnValueOnce(
      'id-1' as unknown as `${string}-${string}-${string}-${string}-${string}`,
    );
    act(() => {
      addTab!({ path: '/repo/b.html', kind: 'file' });
    });

    expect(screen.getByTestId('html-preview').getAttribute('data-reload-seq')).toBe('0');
    uuidSpy.mockRestore();
    closeSpy.mockRestore();
  });
});
