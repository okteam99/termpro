// per-host HostClient 结构(SSH-6 · ARCH-8):'local' 复用既有单例(本地路径零变化),
// 远程机各按 configId 持有独立 HostClient,经 hostRegistry.getOrCreateRemote 连本地转发端口。
// BL-003 边界:只建结构 + 让远程连接跑通;不迁移任何现有 hostClient 消费方。
// BL-004:新增 forWorkspace/forHostId 两个路由原语,按「是否用户主动写操作」分流兜底策略——
// forWorkspace(读/展示消费)未命中兜底 local + 恒 WARN;forHostId(写操作定向路由)未命中→null,绝不兜底。

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

  /**
   * 消费路由(终端/fs/git/展示读)。hostId='local' → 既有单例(零回归);configId → 远程 client。
   * 🔴 未命中(远程 client 缺失)→ 兜底 local 但**无条件 WARN**(正防静默误路由,log 出 hostId
   *    供排查)。此路径只在断线瞬间竞态可达,且活跃 RPC 已被断线态门控拦在前。
   * 🔴 不做 host.info.hostId 二次解析——路由权威键 = 本 map 的键,不参与 host.info 内容。
   */
  forWorkspace(ws: { hostId: string }): HostClient {
    const c = this.clients.get(ws.hostId);
    if (!c) {
      if (ws.hostId !== LOCAL_KEY) {
        console.warn(
          `[hostRegistry] forWorkspace miss hostId=${ws.hostId} → fallback local(疑断线竞态)`,
        );
      }
      return this.local();
    }
    return c;
  }

  /**
   * 写操作定向路由(workspace.create 落哪台机 · 用户主动流程 · 不经断线门控)。
   * 🔴 未命中 → 返回 null(**绝不兜底 local**)。create 路径拿到 null 必须拒绝创建 + 提示
   *    「目标机器已断开」,否则会把远程建仓静默落本机(写误路由)。
   */
  forHostId(hostId: string): HostClient | null {
    return this.clients.get(hostId) ?? null;
  }
}

export const hostRegistry = new HostRegistry();
