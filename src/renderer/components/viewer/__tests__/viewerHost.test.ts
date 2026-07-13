// @vitest-environment jsdom
// 查看器窗口 host 连接选路(viewerHost):本机走既有 connect();远程按需取隧道
// 经本地转发端口 ws 直连;隧道不存在(远程机未连接)→ 确定性拒绝,绝不回落本机。

import { afterEach, describe, expect, it, vi } from 'vitest';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../../../services/hostClient', () => ({
  hostClient: { connect },
}));

import { connectViewerHost, isRemoteHost } from '../viewerHost';

const getTunnel = vi.fn();
function mockOkwork() {
  Object.defineProperty(window, 'okwork', {
    value: { remoteHost: { getTunnel } },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  connect.mockReset();
  getTunnel.mockReset();
  delete (window as unknown as Record<string, unknown>).okwork;
});

describe('isRemoteHost', () => {
  it("缺省 / '' / 'local' 都是本机;其余是远程", () => {
    expect(isRemoteHost(undefined)).toBe(false);
    expect(isRemoteHost('')).toBe(false);
    expect(isRemoteHost('local')).toBe(false);
    expect(isRemoteHost('cfg-1')).toBe(true);
  });
});

describe('connectViewerHost', () => {
  it('本机(缺省 hostId):直接 connect(),不查隧道', async () => {
    mockOkwork();
    connect.mockResolvedValue({ hostId: 'local' });

    await connectViewerHost(undefined);

    expect(connect).toHaveBeenCalledWith();
    expect(getTunnel).not.toHaveBeenCalled();
  });

  it('远程:getTunnel → 经 ws://127.0.0.1:{port}?token=… 连接(token 做 URL 编码)', async () => {
    mockOkwork();
    getTunnel.mockResolvedValue({ localPort: 50123, token: 'a+b/c' });
    connect.mockResolvedValue({ hostId: 'local' });

    await connectViewerHost('cfg-1');

    expect(getTunnel).toHaveBeenCalledWith({ id: 'cfg-1' });
    expect(connect).toHaveBeenCalledWith({
      wsUrl: `ws://127.0.0.1:50123?token=${encodeURIComponent('a+b/c')}`,
    });
  });

  it('远程但隧道不存在(未连接):确定性拒绝,绝不回落本机 connect()', async () => {
    mockOkwork();
    getTunnel.mockResolvedValue(null);

    await expect(connectViewerHost('cfg-1')).rejects.toThrow(
      'Remote machine is not connected',
    );
    expect(connect).not.toHaveBeenCalled();
  });
});
