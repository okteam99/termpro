import { promises as nodeFs } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRegistry } from '../workspaceRegistry';

let tempDir: string | null = null;

async function freshDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'termpro-registry-'));
  return tempDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('WorkspaceRegistry CRUD / 持久化 / 幂等 / 并发', () => {
  it('test_create_returns_record_with_id_name_root (REG-001)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    const entry = await reg.create({ name: 'proj', root: '/tmp/proj' });
    expect(entry.id).toBeTruthy();
    expect(entry.name).toBe('proj');
    expect(entry.root).toBe('/tmp/proj');
    expect(reg.list().map((w) => w.id)).toContain(entry.id);
  });

  it('test_create_with_supplied_id_is_idempotent_for_migration (REG-002)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    const a = await reg.create({ id: 'orig-id-1', name: 'p', root: '/a' });
    const b = await reg.create({ id: 'orig-id-1', name: 'p', root: '/a' });
    expect(a.id).toBe('orig-id-1');
    expect(b.id).toBe('orig-id-1');
    expect(reg.list().filter((w) => w.id === 'orig-id-1')).toHaveLength(1);
  });

  it('test_list_has_no_registry_side_sorting_ordering_is_ui_concern (REG-003)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    await reg.create({ id: 'z', name: 'z', root: '/z' });
    await reg.create({ id: 'a', name: 'a', root: '/a' });
    await reg.create({ id: 'm', name: 'm', root: '/m' });
    // 顺序 = 插入序,不做任何排序
    expect(reg.list().map((w) => w.id)).toEqual(['z', 'a', 'm']);
  });

  it('test_update_only_touches_name_root_fields (REG-004)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    await reg.create({ id: 'w1', name: 'old', root: '/a' });
    const updated = await reg.update('w1', { name: 'new' });
    expect(updated.name).toBe('new');
    expect(updated.root).toBe('/a');
    // 记录天然不含视图态字段
    expect(Object.keys(updated).sort()).toEqual(['id', 'name', 'root']);
  });

  it('test_remove_excludes_id_from_subsequent_list (REG-005)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    await reg.create({ id: 'w1', name: 'w', root: '/a' });
    await reg.remove('w1');
    expect(reg.list().map((w) => w.id)).not.toContain('w1');
    // 幂等删除:再次 remove 不抛错
    await expect(reg.remove('w1')).resolves.toBeUndefined();
  });

  it('test_persists_across_registry_reinstantiation_same_data_dir (REG-006)', async () => {
    const dir = await freshDir();
    const reg1 = new WorkspaceRegistry(dir);
    await reg1.load();
    await reg1.create({ id: 'w1', name: 'one', root: '/one' });
    await reg1.create({ id: 'w2', name: 'two', root: '/two' });

    const reg2 = new WorkspaceRegistry(dir);
    await reg2.load();
    expect(reg2.list()).toEqual([
      { id: 'w1', name: 'one', root: '/one' },
      { id: 'w2', name: 'two', root: '/two' },
    ]);
  });

  it('test_data_dir_injectable_via_constructor_not_electron_api (REG-007)', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'termpro-reg-a-'));
    const dirB = await mkdtemp(join(tmpdir(), 'termpro-reg-b-'));
    try {
      const regA = new WorkspaceRegistry(dirA);
      const regB = new WorkspaceRegistry(dirB);
      await regA.load();
      await regB.load();
      await regA.create({ id: 'a1', name: 'a', root: '/a' });
      await regB.create({ id: 'b1', name: 'b', root: '/b' });
      // 两实例互不干扰
      expect(regA.list().map((w) => w.id)).toEqual(['a1']);
      expect(regB.list().map((w) => w.id)).toEqual(['b1']);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it('test_concurrent_create_same_id_yields_single_record_no_throw (REG-008)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    const results = await Promise.all([
      reg.create({ id: 'race-1', name: 'p', root: '/p' }),
      reg.create({ id: 'race-1', name: 'p', root: '/p' }),
    ]);
    expect(results.every((r) => r.id === 'race-1')).toBe(true);
    expect(reg.list().filter((w) => w.id === 'race-1')).toHaveLength(1);
  });

  it('test_concurrent_creates_serialize_no_lost_update', async () => {
    const dir = await freshDir();
    const reg = new WorkspaceRegistry(dir);
    await reg.load();
    const ids = Array.from({ length: 20 }, (_, i) => `ws-${i}`);
    await Promise.all(
      ids.map((id) => reg.create({ id, name: id, root: `/r/${id}` })),
    );
    // 内存:全部落表,无丢更新
    expect(reg.list().map((w) => w.id).sort()).toEqual([...ids].sort());
    // 盘上:重新实例化仍读回全部(串行写队列的队尾 = 全量快照)
    const reg2 = new WorkspaceRegistry(dir);
    await reg2.load();
    expect(reg2.list().map((w) => w.id).sort()).toEqual([...ids].sort());
  });

  it('test_corrupt_registry_file_initializes_empty_without_crash (REG-009)', async () => {
    const dir = await freshDir();
    await writeFile(join(dir, 'workspaces.json'), '{ this is not json');
    const reg = new WorkspaceRegistry(dir);
    await expect(reg.load()).resolves.toBeUndefined();
    expect(reg.list()).toEqual([]);
    // 自愈:之后 create 正常写入并被后续 list 看到
    const entry = await reg.create({ id: 'w1', name: 'w', root: '/a' });
    expect(reg.list().map((w) => w.id)).toEqual([entry.id]);
    // 损坏文件被保全(重命名 .corrupt-*),不静默丢
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('test_write_failure_rolls_back_memory', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    await reg.create({ id: 'ok', name: 'ok', root: '/ok' });

    // 下一次写盘失败(磁盘满/权限模拟)
    const spy = vi
      .spyOn(nodeFs, 'writeFile')
      .mockRejectedValueOnce(new Error('ENOSPC'));

    await expect(reg.create({ id: 'bad', name: 'bad', root: '/bad' })).rejects.toThrow(
      /ENOSPC/,
    );
    spy.mockRestore();

    // 内存回滚:失败条目不在表内,盘上也无(内存=盘一致)
    expect(reg.list().map((w) => w.id)).toEqual(['ok']);
    const onDisk = JSON.parse(
      await readFile(join(tempDir as string, 'workspaces.json'), 'utf8'),
    );
    expect(onDisk.workspaces.map((w: { id: string }) => w.id)).toEqual(['ok']);
  });

  it('rejects invalid input (empty name / non-absolute root)', async () => {
    const reg = new WorkspaceRegistry(await freshDir());
    await reg.load();
    await expect(reg.create({ name: '  ', root: '/a' })).rejects.toThrow(/name/);
    await expect(reg.create({ name: 'p', root: 'relative/path' })).rejects.toThrow(
      /root/,
    );
    await expect(reg.update('missing', { name: 'x' })).rejects.toThrow(
      /not found/,
    );
  });

  // F2 回归:QA probe 固化。整条 mutation 串行队列后,并发写 + 前序写失败回滚
  // 不再让后序写落盘含被回滚条目的陈旧快照(内存/盘/广播一致,失败条目不复活)。
  it('test_concurrent_create_first_write_fails_no_stale_snapshot_no_revive (F2)', async () => {
    const dir = await freshDir();
    const reg = new WorkspaceRegistry(dir);
    await reg.load();

    // 首个落盘失败(a),其后一个成功(b);两笔并发入队,串行执行
    const spy = vi
      .spyOn(nodeFs, 'writeFile')
      .mockRejectedValueOnce(new Error('ENOSPC'));

    const results = await Promise.allSettled([
      reg.create({ id: 'a', name: 'a', root: '/a' }),
      reg.create({ id: 'b', name: 'b', root: '/b' }),
    ]);
    spy.mockRestore();

    // a 写失败被拒、b 成功(唯一「成功操作」)
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);

    // 内存 = 广播用的 list():只含 b,不含被回滚的 a
    expect(reg.list().map((w) => w.id)).toEqual(['b']);
    // 盘面同样只含 b(后序写不再落陈旧快照 [a,b])
    const onDisk = JSON.parse(
      await readFile(join(dir, 'workspaces.json'), 'utf8'),
    );
    expect(onDisk.workspaces.map((w: { id: string }) => w.id)).toEqual(['b']);

    // 重启(重新实例化读盘):被回滚的 a 不复活
    const reg2 = new WorkspaceRegistry(dir);
    await reg2.load();
    expect(reg2.list().map((w) => w.id)).toEqual(['b']);
  });

  // F3 回归:命中既有 id 且字段不同 → 真 upsert(更新落盘),而非 insert-if-absent。
  it('test_create_existing_id_with_changed_fields_updates_upsert (F3)', async () => {
    const dir = await freshDir();
    const reg = new WorkspaceRegistry(dir);
    await reg.load();
    await reg.create({ id: 'w1', name: 'A', root: '/a' });

    const updated = await reg.create({ id: 'w1', name: 'A2', root: '/a2' });
    expect(updated).toEqual({ id: 'w1', name: 'A2', root: '/a2' });
    expect(reg.list()).toEqual([{ id: 'w1', name: 'A2', root: '/a2' }]);

    // 落盘且重启保留更新后的字段
    const reg2 = new WorkspaceRegistry(dir);
    await reg2.load();
    expect(reg2.list()).toEqual([{ id: 'w1', name: 'A2', root: '/a2' }]);

    // 字段一致 → 幂等 no-op,不额外写盘
    const spy = vi.spyOn(nodeFs, 'writeFile');
    const same = await reg.create({ id: 'w1', name: 'A2', root: '/a2' });
    expect(same).toEqual({ id: 'w1', name: 'A2', root: '/a2' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
