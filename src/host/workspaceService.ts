// Workspace RPC 服务核心(纯 Node,零 Electron)。
// 把「注册表 CRUD + 全客户端广播」从 utilityProcess bootstrap 里剥离,
// 使多客户端广播契约(AC-3/INT-001..004)可脱离真实 MessagePort 单测。

import type { HostMessage, WorkspaceEntry } from '../shared/protocol';
import { WorkspaceRegistry } from './workspaceRegistry';

type WorkspaceMethod =
  | 'workspace.list'
  | 'workspace.create'
  | 'workspace.remove'
  | 'workspace.update';

/** WARN + throw:输入非法(可恢复),日志带失败字段供排查。 */
function fail(field: string): never {
  console.warn(`[host] workspace params invalid: ${field}`);
  throw new Error(`invalid workspace params: ${field}`);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 运行时 params 校验(AC-9/F10),先于 registry.create/update/remove 执行,非法 → throw 不落盘。
 * 远程面(远程 workspace.create over WAN)正是此校验的消费点——不能只信注册表内部校验
 * (注册表方法签名声明的类型在运行时经 WAN JSON 反序列化后不受 TS 静态检查保护)。
 */
function validateParams(method: WorkspaceMethod, params: unknown): void {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'workspace.list':
      return;
    case 'workspace.create': {
      if (!isNonEmptyString(p.name)) fail('name');
      if (
        typeof p.root !== 'string' ||
        p.root.trim().length === 0 ||
        !p.root.startsWith('/')
      ) {
        fail('root');
      }
      if (p.id !== undefined && !isNonEmptyString(p.id)) fail('id');
      return;
    }
    case 'workspace.update': {
      if (!isNonEmptyString(p.id)) fail('id');
      if (p.name === undefined && p.root === undefined) fail('name/root');
      if (p.name !== undefined && !isNonEmptyString(p.name)) fail('name');
      if (p.root !== undefined && !isNonEmptyString(p.root)) fail('root');
      return;
    }
    case 'workspace.remove': {
      if (!isNonEmptyString(p.id)) fail('id');
      return;
    }
  }
}

export class WorkspaceService {
  private readonly registry: WorkspaceRegistry;
  private readonly senders = new Map<number, (msg: HostMessage) => void>();

  constructor(dataDir: string, registry?: WorkspaceRegistry) {
    this.registry = registry ?? new WorkspaceRegistry(dataDir);
  }

  load(): Promise<void> {
    return this.registry.load();
  }

  /** 注册一个客户端的 send(用于广播);多窗口共用一个 host */
  addClient(id: number, send: (msg: HostMessage) => void): void {
    this.senders.set(id, send);
  }

  removeClient(id: number): void {
    this.senders.delete(id);
  }

  get clientCount(): number {
    return this.senders.size;
  }

  /** 注册表变更后向全部客户端(含发起端)广播全量快照 */
  private broadcast(): void {
    const msg: HostMessage = {
      t: 'workspace:changed',
      workspaces: this.registry.list(),
    };
    for (const send of this.senders.values()) send(msg);
  }

  /**
   * 处理 workspace.* RPC。成功持久化后才广播;失败(reject)不广播(INT-004)。
   * 先落盘再广播,保证「广播出去的快照 = 已落盘状态」。
   */
  async handle(method: WorkspaceMethod, params: unknown): Promise<unknown> {
    await this.registry.load();
    validateParams(method, params);
    switch (method) {
      case 'workspace.list':
        return { workspaces: this.registry.list() };
      case 'workspace.create': {
        const p = params as { id?: string; name: string; root: string };
        const entry = await this.registry.create(p);
        this.broadcast();
        return entry;
      }
      case 'workspace.remove': {
        const p = params as { id: string };
        await this.registry.remove(p.id);
        this.broadcast();
        return undefined;
      }
      case 'workspace.update': {
        const p = params as { id: string; name?: string; root?: string };
        const entry: WorkspaceEntry = await this.registry.update(p.id, {
          name: p.name,
          root: p.root,
        });
        this.broadcast();
        return entry;
      }
    }
  }
}
