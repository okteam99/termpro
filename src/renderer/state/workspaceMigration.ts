// UI 存档 v1→v2 迁移器(壳层驱动,由 renderer 的 initPersistence 调用)。
// 纯逻辑 + 注入依赖(create/backup/writeArchive),可脱离真实 Host/Electron 单测。
//
// 迁移完成唯一标记 = UI 存档顶层 version:1=未迁移(v1 全功能) / 2=已迁移。
//   - 逐条 workspace.create 保留原 id(幂等键 + v2 外键连续性)。
//   - 全部成功 → 备份原 v1 存档 → 写 v2 存档(翻标记)。
//   - 任一 create/备份失败 → 不翻 v2,保持 v1 全功能,失败计数 +1 落盘,下次启动重试。
//   - 连续 3 次失败 → 一次性轻量提示(仅跨越阈值那次,不刷屏)。

import type { WorkspaceEntry } from '../../shared/protocol';
import type {
  PersistedState,
  PersistedStateV1,
  PersistedStateV2,
} from './store';

export interface MigrationDeps {
  /** 逐条写入 Host 注册表(= hostClient.rpc('workspace.create', ...));幂等 upsert by id */
  createWorkspace(input: {
    id: string;
    name: string;
    root: string;
  }): Promise<WorkspaceEntry>;
  /** 备份原 v1 存档(= window.termpro.backupV1Archive());失败 reject */
  backupV1(): Promise<void>;
  /** 落盘存档(= window.termpro.storeSet(...)) */
  writeArchive(state: PersistedState): void;
}

export type MigrationMode = 'v1' | 'v2';

export interface MigrationOutcome {
  /** persistence 模式:v2=已迁移(去 name/root) / v1=fallback(全功能) */
  mode: MigrationMode;
  /** 供 hydrate 使用的存档(null=全新安装,从空注册表 hydrate) */
  archive: PersistedState | null;
  /** 跨启动累计迁移失败次数 */
  failureCount: number;
  /** 本次是否应发一次性提示(连续 3 次失败跨越阈值那次) */
  prompt: boolean;
}

function toV2Archive(v1: PersistedStateV1): PersistedStateV2 {
  return {
    version: 2,
    activeWorkspaceId: v1.activeWorkspaceId,
    workspaces: v1.workspaces.map((w) => ({
      workspaceId: w.id,
      activeTabId: w.activeTabId,
      tabs: w.tabs,
    })),
    migrationFailureCount: 0,
    ui: v1.ui,
  };
}

/**
 * 依据原始存档决定迁移动作。
 * - null(全新安装)或 version==2(已迁移)→ 直接 v2 模式,不产生 create 调用。
 * - version==1 → 逐条迁移;全成功翻 v2,否则保持 v1 并累计失败。
 */
export async function runMigration(
  raw: unknown,
  deps: MigrationDeps,
): Promise<MigrationOutcome> {
  const archive = raw as PersistedState | null;

  // 全新安装:无存档 → 视同已迁移(从空注册表 hydrate),不重试、不 create
  if (archive == null) {
    return { mode: 'v2', archive: null, failureCount: 0, prompt: false };
  }
  // 已迁移:version==2 → 幂等跳过
  if (archive.version === 2) {
    return {
      mode: 'v2',
      archive,
      failureCount: archive.migrationFailureCount ?? 0,
      prompt: false,
    };
  }

  // version==1(或 legacy 落到此分支):需迁移
  const v1 = archive as PersistedStateV1;
  const prevCount = v1.migrationFailureCount ?? 0;

  try {
    // 逐条 create,保留原 id(幂等:重试已存在的 id 返回既有,不重复插入)
    for (const w of v1.workspaces) {
      await deps.createWorkspace({ id: w.id, name: w.name, root: w.root });
    }
    // 全部成功 → 备份 → 翻 v2
    await deps.backupV1();
    const v2 = toV2Archive(v1);
    deps.writeArchive(v2);
    return { mode: 'v2', archive: v2, failureCount: 0, prompt: false };
  } catch (err) {
    // 任一失败(create / 备份):不翻 v2,保持 v1 全功能,失败计数 +1 落盘
    console.warn('[renderer] migration create failed:', err);
    const failureCount = prevCount + 1;
    const persisted: PersistedStateV1 = {
      ...v1,
      version: 1,
      migrationFailureCount: failureCount,
    };
    deps.writeArchive(persisted);
    return {
      mode: 'v1',
      archive: persisted,
      failureCount,
      // 仅跨越阈值那次(2→3)提示,4/5 次不再刷屏
      prompt: failureCount === 3,
    };
  }
}
