import { describe, expect, it, vi } from 'vitest';
import { runMigration } from '../../renderer/state/workspaceMigration';
import type { MigrationDeps } from '../../renderer/state/workspaceMigration';
import type {
  PersistedStateV1,
  PersistedStateV2,
  PersistedTab,
} from '../../renderer/state/store';
import type { WorkspaceEntry } from '../../shared/protocol';

function v1ws(id: string, name: string, root: string) {
  const tabs: PersistedTab[] = [{ id: `${id}-t`, cwd: root }];
  return { id, name, root, activeTabId: tabs[0].id, tabs };
}

function v1(
  workspaces: PersistedStateV1['workspaces'],
  migrationFailureCount?: number,
): PersistedStateV1 {
  return {
    version: 1,
    activeWorkspaceId: workspaces[0]?.id ?? null,
    workspaces,
    migrationFailureCount,
  };
}

/** 假 Host 注册表:幂等 upsert by id;failIds 中的 id 抛错(注入失败) */
function makeDeps(failIds: Set<string> = new Set()) {
  const registry = new Map<string, WorkspaceEntry>();
  const createWorkspace = vi.fn(async (input: { id: string; name: string; root: string }) => {
    if (failIds.has(input.id)) throw new Error(`create failed: ${input.id}`);
    if (!registry.has(input.id)) registry.set(input.id, { ...input });
    return registry.get(input.id)!;
  });
  const backupV1 = vi.fn(async () => undefined);
  const writeArchive = vi.fn();
  const deps: MigrationDeps = { createWorkspace, backupV1, writeArchive };
  return { registry, deps, createWorkspace, backupV1, writeArchive, failIds };
}

describe('workspace 迁移器(v1→v2)', () => {
  it('test_n_zero_marks_migrated_with_empty_registry_no_error (MIG-001)', async () => {
    const { deps, createWorkspace, writeArchive, registry } = makeDeps();
    const out = await runMigration(v1([]), deps);
    expect(out.mode).toBe('v2');
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
    // 翻 v2 标记
    expect((writeArchive.mock.calls[0][0] as PersistedStateV2).version).toBe(2);
  });

  it('test_no_v1_file_fresh_install_treated_as_migrated_no_retry (MIG-002)', async () => {
    const { deps, createWorkspace } = makeDeps();
    const out = await runMigration(null, deps);
    expect(out.mode).toBe('v2');
    expect(out.archive).toBeNull();
    expect(out.prompt).toBe(false);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('test_n_gt_zero_each_workspace_created_with_original_id_preserved (MIG-003)', async () => {
    const { deps, createWorkspace, registry } = makeDeps();
    await runMigration(
      v1([v1ws('v1-a', 'A', '/a'), v1ws('v1-b', 'B', '/b')]),
      deps,
    );
    expect(createWorkspace).toHaveBeenCalledWith({ id: 'v1-a', name: 'A', root: '/a' });
    expect(createWorkspace).toHaveBeenCalledWith({ id: 'v1-b', name: 'B', root: '/b' });
    expect([...registry.keys()].sort()).toEqual(['v1-a', 'v1-b']);
  });

  it('test_successful_migration_backs_up_original_v1_file (MIG-004)', async () => {
    const { deps, backupV1 } = makeDeps();
    await runMigration(v1([v1ws('a', 'A', '/a')]), deps);
    expect(backupV1).toHaveBeenCalledTimes(1);
  });

  it('test_second_launch_after_success_does_not_recreate_entries (MIG-005)', async () => {
    const { deps, createWorkspace } = makeDeps();
    const v2: PersistedStateV2 = {
      version: 2,
      activeWorkspaceId: 'a',
      workspaces: [{ workspaceId: 'a', activeTabId: 'a-t', tabs: [{ id: 'a-t', cwd: '/a' }] }],
      migrationFailureCount: 0,
    };
    const out = await runMigration(v2, deps);
    expect(out.mode).toBe('v2');
    expect(out.archive).toBe(v2);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('test_partial_create_failure_leaves_v1_file_intact_and_unmarked (MIG-006)', async () => {
    const { deps, writeArchive } = makeDeps(new Set(['b']));
    const source = v1([v1ws('a', 'A', '/a'), v1ws('b', 'B', '/b'), v1ws('c', 'C', '/c')]);
    const out = await runMigration(source, deps);
    expect(out.mode).toBe('v1');
    // 未打 v2 标记:任何 writeArchive 都不是 version 2
    for (const call of writeArchive.mock.calls) {
      expect((call[0] as PersistedStateV1).version).toBe(1);
    }
    // v1 workspace 数据完好(未删/未截断)
    const persisted = writeArchive.mock.calls.at(-1)![0] as PersistedStateV1;
    expect(persisted.workspaces.map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('test_failed_migration_falls_back_to_full_v1_mode_name_root_writable (MIG-007)', async () => {
    const { deps } = makeDeps(new Set(['a']));
    const out = await runMigration(v1([v1ws('a', 'A', '/a')]), deps);
    expect(out.mode).toBe('v1');
    const archive = out.archive as PersistedStateV1;
    expect(archive.version).toBe(1);
    // v1 全功能:workspace 仍带 name/root(可读写)
    expect(archive.workspaces[0]).toMatchObject({ name: 'A', root: '/a' });
  });

  it('test_failed_migration_retries_automatically_on_next_launch (MIG-008)', async () => {
    // 首次失败
    const first = makeDeps(new Set(['a']));
    const out1 = await runMigration(v1([v1ws('a', 'A', '/a')]), first.deps);
    expect(out1.mode).toBe('v1');
    // 下次启动:存档仍 version 1 → 再次触发 create(自动重试,无需用户操作)
    const second = makeDeps();
    await runMigration(out1.archive, second.deps);
    expect(second.createWorkspace).toHaveBeenCalledWith({ id: 'a', name: 'A', root: '/a' });
  });

  it('test_three_consecutive_failures_trigger_single_lightweight_prompt_no_flood (MIG-009)', async () => {
    // 已连续失败 2 次(prevCount=2),第 3 次失败 → 跨阈值提示
    const third = makeDeps(new Set(['a']));
    const out3 = await runMigration(v1([v1ws('a', 'A', '/a')], 2), third.deps);
    expect(out3.failureCount).toBe(3);
    expect(out3.prompt).toBe(true);

    // 第 4、5 次仍失败 → 不再提示(不刷屏)
    const fourth = makeDeps(new Set(['a']));
    const out4 = await runMigration(v1([v1ws('a', 'A', '/a')], 3), fourth.deps);
    expect(out4.failureCount).toBe(4);
    expect(out4.prompt).toBe(false);

    const fifth = makeDeps(new Set(['a']));
    const out5 = await runMigration(v1([v1ws('a', 'A', '/a')], 4), fifth.deps);
    expect(out5.prompt).toBe(false);
  });

  it('test_eventual_success_after_retries_marks_idempotent_no_duplicate_records (MIG-010)', async () => {
    // 共享注册表模拟跨启动:第一次前 2 条成功、第 3 条失败中断
    const registry = new Map<string, WorkspaceEntry>();
    const failIds = new Set(['c']);
    const createWorkspace = vi.fn(async (input: { id: string; name: string; root: string }) => {
      if (failIds.has(input.id)) throw new Error(`create failed: ${input.id}`);
      if (!registry.has(input.id)) registry.set(input.id, { ...input });
      return registry.get(input.id)!;
    });
    const deps: MigrationDeps = {
      createWorkspace,
      backupV1: vi.fn(async () => undefined),
      writeArchive: vi.fn(),
    };
    const source = v1([v1ws('a', 'A', '/a'), v1ws('b', 'B', '/b'), v1ws('c', 'C', '/c')]);

    const out1 = await runMigration(source, deps);
    expect(out1.mode).toBe('v1');
    expect([...registry.keys()].sort()).toEqual(['a', 'b']); // c 中断

    // 下一次启动重试且全部成功
    failIds.delete('c');
    const out2 = await runMigration(out1.archive, deps);
    expect(out2.mode).toBe('v2');
    // 各 id 只出现一次(a/b 不因重试重复 create),c 补齐
    expect([...registry.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect((deps.writeArchive as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].version).toBe(2);
  });
});
