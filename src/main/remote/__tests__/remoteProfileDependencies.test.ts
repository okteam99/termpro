import { describe, expect, it } from 'vitest';
import {
  collectRemoteProfileDependencies,
  RemoteProfileDependencies,
  type RemoteProfileDependencyCatalogSnapshot,
} from '../../remoteProfileDependencies';

const snapshot: RemoteProfileDependencyCatalogSnapshot = {
  profiles: [
    {
      profileId: 'p-current',
      nameHint: 'Current',
      storage: { kind: 'remote', hostId: 'host-a' },
      lifecycle: 'active',
    },
    {
      profileId: 'p-deleting',
      nameHint: 'Deleting',
      storage: { kind: 'remote', hostId: 'host-a' },
      lifecycle: 'delete_failed',
    },
    {
      profileId: 'p-local',
      nameHint: 'Local',
      storage: { kind: 'local' },
      lifecycle: 'active',
    },
    {
      profileId: 'p-target',
      nameHint: 'Target',
      storage: { kind: 'local' },
      lifecycle: 'active',
    },
    {
      profileId: 'p-cleanup',
      nameHint: 'Cleanup',
      storage: { kind: 'remote', hostId: 'host-b' },
      lifecycle: 'active',
    },
  ],
  migrations: [
    {
      operationId: 'op-inflight',
      profileId: 'p-target',
      source: { kind: 'local' },
      target: { kind: 'remote', hostId: 'host-a' },
      phase: 'copying',
      committed: false,
    },
    {
      operationId: 'op-source',
      profileId: 'p-current',
      source: { kind: 'remote', hostId: 'host-a' },
      target: { kind: 'remote', hostId: 'host-c' },
      phase: 'verifying',
      committed: false,
    },
    {
      operationId: 'op-cleanup',
      profileId: 'p-cleanup',
      source: { kind: 'remote', hostId: 'host-a' },
      target: { kind: 'remote', hostId: 'host-b' },
      phase: 'cleanup_pending',
      committed: true,
    },
  ],
};

describe('collectRemoteProfileDependencies Host 删除依赖纯计算', () => {
  it('test_AC8_blocks_host_delete_for_authority_migration_and_cleanup_dependencies', () => {
    expect(collectRemoteProfileDependencies('host-a', snapshot)).toEqual([
      {
        profileId: 'p-cleanup',
        profileName: 'Cleanup',
        type: 'source_cleanup',
      },
      {
        profileId: 'p-current',
        profileName: 'Current',
        type: 'current_storage',
      },
      {
        profileId: 'p-current',
        profileName: 'Current',
        type: 'migration_source',
      },
      {
        profileId: 'p-deleting',
        profileName: 'Deleting',
        type: 'delete_cleanup',
      },
      {
        profileId: 'p-target',
        profileName: 'Target',
        type: 'migration_target',
      },
    ]);
  });

  it('无关 Host 返回空；DI adapter 每次取最新 snapshot', async () => {
    let current = snapshot;
    const dependencies = new RemoteProfileDependencies(() => current);
    expect(await dependencies.dependenciesForHost('host-z')).toEqual([]);

    current = { profiles: [], migrations: [] };
    expect(await dependencies.dependenciesForHost('host-a')).toEqual([]);
  });
});
