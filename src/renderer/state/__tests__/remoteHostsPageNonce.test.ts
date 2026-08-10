// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useAppStore } from '../store';

describe('remoteHostsPageNonce(「远程机」设置页深链打开信号)', () => {
  it('默认 0(store create 初值)', () => {
    // 本测试文件模块隔离,store 尚未被改动 → 读到 create() 默认值
    expect(useAppStore.getState().remoteHostsPageNonce).toBe(0);
  });

  it('openRemoteHostsPage 每次调用自增(用 nonce 而非布尔,连点两次也能重触发)', () => {
    const before = useAppStore.getState().remoteHostsPageNonce;
    useAppStore.getState().openRemoteHostsPage();
    expect(useAppStore.getState().remoteHostsPageNonce).toBe(before + 1);
    useAppStore.getState().openRemoteHostsPage();
    expect(useAppStore.getState().remoteHostsPageNonce).toBe(before + 2);
  });
});
