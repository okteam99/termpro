// Remote Host 删除硬门：把 Profile catalog 的纯快照归一成 renderer 可展示的依赖。
// 本模块只依赖结构化 snapshot/共享 DTO，不 import catalog 具体实现，便于 main 注入。

import type {
  ProfileMigrationPhase,
  ProfileStorageRef,
} from '../shared/browserProfile';
import type {
  RemoteHostDependency,
  RemoteHostDependencyType,
} from '../shared/remoteHost';

export interface RemoteProfileDependencyCatalogEntry {
  profileId: string;
  nameHint: string;
  storage: ProfileStorageRef;
  lifecycle: 'active' | 'deleting' | 'delete_failed';
}

export interface RemoteProfileDependencyMigration {
  operationId: string;
  profileId: string;
  source: ProfileStorageRef;
  target: ProfileStorageRef;
  phase: ProfileMigrationPhase;
  committed: boolean;
}

/** ProfileAuthorityCatalog.snapshot() 的最小结构投影；额外字段不影响结构化赋值。 */
export interface RemoteProfileDependencyCatalogSnapshot {
  profiles: RemoteProfileDependencyCatalogEntry[];
  migrations: RemoteProfileDependencyMigration[];
}

export interface RemoteHostDependencyQueryPort {
  dependenciesForHost(
    hostId: string,
  ): RemoteHostDependency[] | Promise<RemoteHostDependency[]>;
}

function remoteHostId(storage: ProfileStorageRef): string | null {
  return storage.kind === 'remote' ? storage.hostId : null;
}

const DEPENDENCY_ORDER: Record<RemoteHostDependencyType, number> = {
  current_storage: 0,
  migration_source: 1,
  migration_target: 2,
  delete_cleanup: 3,
  source_cleanup: 4,
};

/**
 * 纯计算：只要某 Host 仍是当前存储、迁移任一端或待清理端，就必须阻止 Host 删除。
 * committed 是唯一切换边界：提交前 source/target 都是迁移依赖；提交后 source 只剩
 * source_cleanup，target 已由 profile.storage 的 current_storage 表示。
 */
export function collectRemoteProfileDependencies(
  hostId: string,
  snapshot: RemoteProfileDependencyCatalogSnapshot,
): RemoteHostDependency[] {
  const names = new Map(
    snapshot.profiles.map(
      (profile) => [profile.profileId, profile.nameHint] as const,
    ),
  );
  const dependencies: RemoteHostDependency[] = [];
  const add = (profileId: string, type: RemoteHostDependencyType) => {
    dependencies.push({
      profileId,
      profileName: names.get(profileId) || profileId,
      type,
    });
  };

  for (const profile of snapshot.profiles) {
    if (remoteHostId(profile.storage) !== hostId) continue;
    add(
      profile.profileId,
      profile.lifecycle === 'active' ? 'current_storage' : 'delete_cleanup',
    );
  }

  for (const migration of snapshot.migrations) {
    if (migration.committed) {
      if (remoteHostId(migration.source) === hostId) {
        add(migration.profileId, 'source_cleanup');
      }
      continue;
    }
    if (remoteHostId(migration.source) === hostId) {
      add(migration.profileId, 'migration_source');
    }
    if (remoteHostId(migration.target) === hostId) {
      add(migration.profileId, 'migration_target');
    }
  }

  // catalog 理论上不会重复 operation；仍在边界去重，避免 UI 重复行和调用方误判数量。
  const unique = new Map<string, RemoteHostDependency>();
  for (const dependency of dependencies) {
    unique.set(`${dependency.profileId}\0${dependency.type}`, dependency);
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.profileName.localeCompare(b.profileName) ||
      a.profileId.localeCompare(b.profileId) ||
      DEPENDENCY_ORDER[a.type] - DEPENDENCY_ORDER[b.type],
  );
}

/** DI adapter：main 可直接传 catalog.snapshot getter，不让 IPC 认识 catalog 类。 */
export class RemoteProfileDependencies implements RemoteHostDependencyQueryPort {
  constructor(
    private readonly getSnapshot: () =>
      | RemoteProfileDependencyCatalogSnapshot
      | Promise<RemoteProfileDependencyCatalogSnapshot>,
  ) {}

  async dependenciesForHost(hostId: string): Promise<RemoteHostDependency[]> {
    const snapshot = await this.getSnapshot();
    return collectRemoteProfileDependencies(hostId, snapshot);
  }
}
