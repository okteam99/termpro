// Workspace 注册表(纯 Node,零 Electron import — README §5 远程就绪)。
// 数据目录经构造参数注入(非 app.getPath),保证零 Electron 且单测可用临时目录。
//
// 并发正确性(F2/F5 收敛):
//   - 内存数组是唯一真相:load() 一次读盘进内存,之后只在串行队列内读写。
//   - 每条 mutation(校验 + 改内存 + 落盘 + 失败回滚)作为一个原子单元进单一串行队列
//     (mutationQueue),队列外绝不改内存。后到的 mutation 必等前一条整体完成后才跑,
//     天然看到前一条结果(杜绝丢更新),且「内存 / 盘 / 广播」不会在队列边界外分叉。
//     这消除了旧「同步改内存 + 只串行化写盘 + 入队时捕获快照」下的时点差破口:
//     并发写 + 前序写失败回滚时,后序写不再落盘含被回滚条目的陈旧快照。
//   - 原子写:写唯一临时名(pid+seq)→ fsync → rename(rename 原子;临时名带 pid+seq 防并发互相覆盖)。
//   - 写失败在同一单元内先回滚内存再抛,保证「广播出去的快照 = 已落盘状态」在任意交错下成立。

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkspaceEntry } from '../shared/protocol';

/** 注册表文件自身 schema 版本(独立于 PROTOCOL_VERSION 与 UI 存档 version) */
const REGISTRY_FILE_VERSION = 1;

interface RegistryFile {
  version: number;
  workspaces: WorkspaceEntry[];
}

function isValidEntry(v: unknown): v is WorkspaceEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.name === 'string' &&
    typeof e.root === 'string'
  );
}

/** 校验 create/update 的 name(trim 后 1..255) */
function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new Error(`invalid workspace name: ${JSON.stringify(name)}`);
  }
  return trimmed;
}

/** 校验 root 为非空绝对路径 */
function validRoot(root: string): string {
  if (typeof root !== 'string' || root.length === 0 || !path.isAbsolute(root)) {
    throw new Error(`invalid workspace root (must be absolute path): ${JSON.stringify(root)}`);
  }
  return root;
}

export class WorkspaceRegistry {
  private readonly filePath: string;
  private workspaces: WorkspaceEntry[] = [];
  private loadPromise: Promise<void> | null = null;
  // 整条 mutation 的串行队列(改内存 + 落盘 + 回滚 都排这里)
  private mutationQueue: Promise<void> = Promise.resolve();
  private writeSeq = 0;

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'workspaces.json');
  }

  /** 读盘进内存(幂等;并发调用共享同一次读) */
  load(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.filePath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // 全新:空注册表
        this.workspaces = [];
        return;
      }
      // 读失败(权限等):不崩、不静默丢,以空注册表启动
      console.error('[host] registry read failed:', err);
      this.workspaces = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw) as RegistryFile;
      const list = Array.isArray(parsed?.workspaces)
        ? parsed.workspaces.filter(isValidEntry)
        : [];
      this.workspaces = list;
    } catch (err) {
      // 损坏 JSON:保全原文件(重命名 .corrupt-<ts>),以空注册表启动(不静默丢)
      console.error('[host] registry read failed (corrupt), preserving file:', err);
      await this.preserveCorrupt();
      this.workspaces = [];
    }
  }

  private async preserveCorrupt(): Promise<void> {
    try {
      const dst = `${this.filePath}.corrupt-${Date.now()}`;
      await fsp.rename(this.filePath, dst);
    } catch (err) {
      console.error('[host] registry corrupt-file preserve failed:', err);
    }
  }

  /** 全量快照(顺序=插入序;排序是 UI 视图态职责) */
  list(): WorkspaceEntry[] {
    return this.workspaces.map((w) => ({ ...w }));
  }

  /**
   * 新建/迁移写入(整条 mutation 串行,见文件头)。
   * - id 已存在且 name/root 一致 → 幂等 no-op,返回既有(不写盘)。
   * - id 已存在但字段不同 → upsert:更新 name/root 并落盘(F3:迁移重试保留 fallback 期改名/改根)。
   * - id 不存在 → 追加。省略 id 时生成 randomUUID。写盘失败 → 回滚内存并抛。
   */
  async create(input: { id?: string; name: string; root: string }): Promise<WorkspaceEntry> {
    return this.enqueue(async () => {
      const name = validName(input.name);
      const root = validRoot(input.root);
      const id = input.id && input.id.length > 0 ? input.id : randomUUID();

      const idx = this.workspaces.findIndex((w) => w.id === id);
      if (idx >= 0) {
        const existing = this.workspaces[idx];
        // 幂等:字段一致(迁移重跑 / 回声)→ 内存未变,不写盘
        if (existing.name === name && existing.root === root) {
          return { ...existing };
        }
        // upsert:字段不同 → 更新落盘
        const next: WorkspaceEntry = { id, name, root };
        this.workspaces[idx] = next;
        try {
          await this.atomicWrite(this.snapshot());
        } catch (err) {
          this.workspaces[idx] = existing; // 回滚
          console.error('[host] registry write failed:', err);
          throw err;
        }
        return { ...next };
      }

      const entry: WorkspaceEntry = { id, name, root };
      this.workspaces.push(entry);
      try {
        await this.atomicWrite(this.snapshot());
      } catch (err) {
        this.workspaces = this.workspaces.filter((w) => w.id !== id); // 回滚新增
        console.error('[host] registry write failed:', err);
        throw err;
      }
      return { ...entry };
    });
  }

  /** 删除。幂等:不存在→no-op success。写盘失败→回滚内存并抛。 */
  async remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const idx = this.workspaces.findIndex((w) => w.id === id);
      if (idx < 0) return; // 幂等 no-op(不写盘)

      const [removed] = this.workspaces.splice(idx, 1);
      try {
        await this.atomicWrite(this.snapshot());
      } catch (err) {
        // 串行队列内回滚,期间无并发 mutation 改动数组,idx 位置稳定
        this.workspaces.splice(idx, 0, removed);
        console.error('[host] registry write failed:', err);
        throw err;
      }
    });
  }

  /** 改名/改根。不存在→抛错。写盘失败→回滚内存并抛。 */
  async update(id: string, patch: { name?: string; root?: string }): Promise<WorkspaceEntry> {
    return this.enqueue(async () => {
      const idx = this.workspaces.findIndex((w) => w.id === id);
      if (idx < 0) {
        throw new Error(`workspace not found: ${id}`);
      }
      const prev = this.workspaces[idx];
      const next: WorkspaceEntry = { ...prev };
      if (patch.name !== undefined) next.name = validName(patch.name);
      if (patch.root !== undefined) next.root = validRoot(patch.root);

      this.workspaces[idx] = next;
      try {
        await this.atomicWrite(this.snapshot());
      } catch (err) {
        this.workspaces[idx] = prev; // 回滚
        console.error('[host] registry write failed:', err);
        throw err;
      }
      return { ...next };
    });
  }

  /** 当前内存的落盘快照(在串行队列内取,恒与将广播的内存一致) */
  private snapshot(): RegistryFile {
    return {
      version: REGISTRY_FILE_VERSION,
      workspaces: this.workspaces.map((w) => ({ ...w })),
    };
  }

  /**
   * 把整条 mutation 串进单一队列:前一条整体完成(含落盘/回滚)后才跑下一条。
   * 队列尾吞错,避免一次失败 reject 掉所有未来 mutation;调用方仍从返回的 promise
   * 拿到本次结果/异常。
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(op, op);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async atomicWrite(data: RegistryFile): Promise<void> {
    await fsp.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${++this.writeSeq}.tmp`;
    const json = JSON.stringify(data, null, 2);
    await fsp.writeFile(tmp, json, 'utf8');
    // fsync 落盘再 rename(rename 原子)
    const fh = await fsp.open(tmp, 'r+');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, this.filePath);
  }
}
