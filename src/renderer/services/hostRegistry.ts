// per-host HostClient 结构(SSH-6 · ARCH-8):'local' 复用既有单例(本地路径零变化),
// 远程机各按 configId 持有独立 HostClient,经 hostRegistry.getOrCreateRemote 连本地转发端口。
// BL-003 边界:只建结构 + 让远程连接跑通;不迁移任何现有 hostClient 消费方
// (App.tsx / Sidebar / FilePanel / viewer/* 等 40+ 处继续用 'local' 单例,行为零变化)。
// 按 host 选择客户端的全面消费(Sidebar/TabBar 感知远程机)归 BL-004。

import { HostClient, hostClient } from './hostClient';

const LOCAL_KEY = 'local';

export class HostRegistry {
  private clients = new Map<string, HostClient>([[LOCAL_KEY, hostClient]]);

  /** 本地嵌入式 host 单例(= 既有 hostClient,零变化)。 */
  local(): HostClient {
    return this.clients.get(LOCAL_KEY)!;
  }

  /**
   * 取或建 configId 对应的远程 HostClient。新建不自动连接——
   * 由调用方 `client.connect({ wsUrl })` 触发握手(RemoteHostsPage 在收到
   * main emit 的 `verifying{tunnel}` 后调用,做版本二次确认)。
   */
  getOrCreateRemote(configId: string, wsUrl: string): HostClient {
    void wsUrl; // 保留形参与 TECH SSH-6 签名对齐;连接时机由调用方显式触发
    let client = this.clients.get(configId);
    if (!client) {
      client = new HostClient();
      this.clients.set(configId, client);
    }
    return client;
  }

  /** 断开并释放某 configId 的远程客户端(删除远程机 / 手动断开后清理)。 */
  drop(configId: string): void {
    this.clients.get(configId)?.dispose?.();
    this.clients.delete(configId);
  }
}

export const hostRegistry = new HostRegistry();
