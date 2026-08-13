// @vitest-environment jsdom
// 查看器「预览不了 → 下载到本机」(用户指令 2026-08-13):
// 门禁三态(未连接 / host 过旧 / 超限)· 成功落终态文案 · 进行中可取消 ·
// 卸载即取消(释放本机写票)· 只有「预览不了」这一支才长按钮(远程才给)。
// 分块/TOCTOU/票据清理本身由 transferCore.test.ts 覆盖,这里整体 mock runDownload。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { TRANSFER } from '../../../../shared/protocol';

const { hostClient } = vi.hoisted(() => ({
  hostClient: {
    info: { homedir: '/home/pi' } as { homedir: string } | null,
    rpc: vi.fn(),
    supportsTransfer: vi.fn(() => true),
  },
}));
vi.mock('../../../services/hostClient', () => ({ hostClient }));

const { runDownload } = vi.hoisted(() => ({ runDownload: vi.fn() }));
vi.mock('../../../services/transferCore', () => ({ runDownload }));
vi.mock('../../../services/transferManager', () => ({ localTransferBridge: {} }));
// store.ts → terminalRegistry.ts 会拉入 @xterm/*;与其他渲染层组件单测同惯例断链。
vi.mock('../../../terminal/terminalRegistry', () => ({ disposeTerminal: vi.fn() }));
// FileView 的 monaco 懒加载:走到「预览不了」分支前不碰它的 API,空对象足够。
vi.mock('../../../monaco/setup', () => ({ default: {} }));

import { DownloadAction } from '../DownloadAction';
import { FileView } from '../FileView';

const PATH = '/home/pi/videos/1.mp4';

function statOk(size: number) {
  hostClient.rpc.mockImplementation(async (method: string) =>
    method === 'fs.stat' ? { kind: 'file', size, mtimeMs: 1 } : {},
  );
}

afterEach(() => {
  cleanup();
  hostClient.info = { homedir: '/home/pi' };
  hostClient.rpc.mockReset();
  hostClient.supportsTransfer.mockReset();
  hostClient.supportsTransfer.mockReturnValue(true);
  runDownload.mockReset();
});

describe('DownloadAction · 门禁', () => {
  it('远程机未连接 → 确定性文案,不发起传输', async () => {
    hostClient.info = null;
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    expect(await screen.findByText('Remote machine is not connected')).toBeTruthy();
    expect(runDownload).not.toHaveBeenCalled();
  });

  it('host 版本过旧 → 引导升级文案,不发起传输', async () => {
    hostClient.supportsTransfer.mockReturnValue(false);
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    expect(
      await screen.findByText('Remote host is too old — update it in Remote Hosts'),
    ).toBeTruthy();
    expect(runDownload).not.toHaveBeenCalled();
  });

  it('超出传输上限 → 提示上限,不发起传输(闸门与文件面板同一条)', async () => {
    statOk(TRANSFER.maxFileBytes + 1);
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    await waitFor(() => expect(hostClient.rpc).toHaveBeenCalled());
    expect(await screen.findByText(/File is too large/)).toBeTruthy();
    expect(runDownload).not.toHaveBeenCalled();
  });

  it('目标不是普通文件 → 失败文案,不发起传输', async () => {
    hostClient.rpc.mockResolvedValue({ kind: 'dir' });
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    expect(await screen.findByText(/not a regular file/)).toBeTruthy();
    expect(runDownload).not.toHaveBeenCalled();
  });
});

describe('DownloadAction · 传输', () => {
  it('成功 → 显示落盘路径,且按 stat 复核后的 size 传给 runDownload', async () => {
    statOk(3_000_000);
    runDownload.mockResolvedValue({ ok: true, localPath: '/Users/liam/1.mp4' });
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    expect(await screen.findByText('Saved to /Users/liam/1.mp4')).toBeTruthy();
    expect(runDownload).toHaveBeenCalledTimes(1);
    expect(runDownload.mock.calls[0][0]).toMatchObject({
      path: PATH,
      name: '1.mp4',
      size: 3_000_000,
    });
  });

  it('失败原因 → 各自的确定性文案', async () => {
    statOk(1000);
    runDownload.mockResolvedValue({ ok: false, reason: 'link-lost' });
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    expect(await screen.findByText('Connection lost during transfer')).toBeTruthy();
  });

  it('进行中显示进度并可取消:点取消后 isCanceled() 即为 true', async () => {
    statOk(1000);
    let deps: {
      onProgress: (done: number) => void;
      isCanceled: () => boolean;
    } | null = null;
    let settle: ((r: unknown) => void) | null = null;
    runDownload.mockImplementation(
      (d: { onProgress: (done: number) => void; isCanceled: () => boolean }) => {
        deps = d;
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
    );
    render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    await waitFor(() => expect(deps).not.toBeNull());
    deps!.onProgress(500);
    expect(await screen.findByText('Downloading… 50%')).toBeTruthy();
    expect(deps!.isCanceled()).toBe(false);

    fireEvent.click(screen.getByText('Cancel'));
    expect(deps!.isCanceled()).toBe(true);
    settle!({ ok: false, reason: 'canceled' });
    expect(await screen.findByText('Transfer canceled')).toBeTruthy();
  });

  it('卸载(关 tab/关窗)即取消——分块循环下一轮退出并释放本机写票', async () => {
    statOk(1000);
    let deps: { isCanceled: () => boolean } | null = null;
    runDownload.mockImplementation((d: { isCanceled: () => boolean }) => {
      deps = d;
      return new Promise(() => undefined); // 永不落定:传输仍在途
    });
    const view = render(<DownloadAction path={PATH} />);
    fireEvent.click(screen.getByText('Download to local'));
    await waitFor(() => expect(deps).not.toBeNull());
    expect(deps!.isCanceled()).toBe(false);
    view.unmount();
    expect(deps!.isCanceled()).toBe(true);
  });
});

describe('FileView · 只有「预览不了」这一支才长下载按钮', () => {
  it('远程 + 文件超预览上限 → 文案旁出现「下载到本机」', async () => {
    hostClient.rpc.mockResolvedValue({
      content: null,
      binary: false,
      size: 2_900_000,
    });
    render(<FileView path={PATH} hostId="pi" />);
    expect(await screen.findByText(/File too large/)).toBeTruthy();
    expect(screen.getByText('Download to local')).toBeTruthy();
  });

  it('远程 + 二进制文件 → 同样给下载入口', async () => {
    hostClient.rpc.mockResolvedValue({ content: null, binary: true, size: 42 });
    render(<FileView path={PATH} hostId="pi" />);
    expect(await screen.findByText(/Binary file/)).toBeTruthy();
    expect(screen.getByText('Download to local')).toBeTruthy();
  });

  it('本机文件不给(头部已有 Finder / 默认应用两个入口)', async () => {
    hostClient.rpc.mockResolvedValue({
      content: null,
      binary: true,
      size: 42,
    });
    render(<FileView path={PATH} hostId="local" />);
    expect(await screen.findByText(/Binary file/)).toBeTruthy();
    expect(screen.queryByText('Download to local')).toBeNull();
  });

  it('加载失败(非「预览不了」)不长下载按钮', async () => {
    hostClient.rpc.mockRejectedValue(new Error('EACCES'));
    render(<FileView path={PATH} hostId="pi" />);
    expect(await screen.findByText('EACCES')).toBeTruthy();
    expect(screen.queryByText('Download to local')).toBeNull();
  });
});
