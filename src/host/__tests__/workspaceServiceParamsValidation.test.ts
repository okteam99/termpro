// AC-9/F10 · PENDING-002:workspace.create/update/remove 运行时 params 校验(先于 registry 写入)。
// 远程面(远程 workspace.create over WAN)正是消费点——WAN JSON 反序列化后不受 TS 静态检查保护。
// TC BL004-U-params-valid / BL004-U-params-reject。

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceService } from '../workspaceService';
import type { WorkspaceEntry } from '../../shared/protocol';

let tempDir: string | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function freshService(): Promise<WorkspaceService> {
  tempDir = await mkdtemp(join(tmpdir(), 'termpro-wsvc-'));
  const svc = new WorkspaceService(tempDir);
  await svc.load();
  return svc;
}

async function list(svc: WorkspaceService): Promise<WorkspaceEntry[]> {
  const res = (await svc.handle('workspace.list', undefined)) as {
    workspaces: WorkspaceEntry[];
  };
  return res.workspaces;
}

describe('BL004-U-params-valid: 合法 params 通过', () => {
  it('create 合法 params 正常落注册表', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'proj',
      root: '/tmp/proj',
    })) as WorkspaceEntry;
    expect(entry).toMatchObject({ name: 'proj', root: '/tmp/proj' });
    expect(await list(svc)).toHaveLength(1);
  });

  it('create 省略 id 合法(Host 生成)', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'proj',
      root: '/tmp/proj',
    })) as WorkspaceEntry;
    expect(entry.id).toBeTruthy();
  });

  it('update 只带 name 或只带 root 均合法(至少一个)', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'p',
      root: '/tmp/p',
    })) as WorkspaceEntry;
    const r1 = (await svc.handle('workspace.update', {
      id: entry.id,
      name: 'renamed',
    })) as WorkspaceEntry;
    expect(r1.name).toBe('renamed');
    const r2 = (await svc.handle('workspace.update', {
      id: entry.id,
      root: '/tmp/p2',
    })) as WorkspaceEntry;
    expect(r2.root).toBe('/tmp/p2');
  });

  it('remove 合法 id 通过', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'p',
      root: '/tmp/p',
    })) as WorkspaceEntry;
    await expect(svc.handle('workspace.remove', { id: entry.id })).resolves.toBeUndefined();
    expect(await list(svc)).toHaveLength(0);
  });
});

describe('BL004-U-params-reject: 非法 params 拒绝 · 不落坏数据', () => {
  it('create 缺 name → 拒绝,注册表不变', async () => {
    const svc = await freshService();
    await expect(svc.handle('workspace.create', { root: '/tmp/x' })).rejects.toThrow(/name/);
    expect(await list(svc)).toEqual([]);
  });

  it('create name 非 string 类型 → 拒绝', async () => {
    const svc = await freshService();
    await expect(
      svc.handle('workspace.create', { name: 123, root: '/tmp/x' }),
    ).rejects.toThrow(/name/);
  });

  it('create name 空白串 → 拒绝', async () => {
    const svc = await freshService();
    await expect(
      svc.handle('workspace.create', { name: '   ', root: '/tmp/x' }),
    ).rejects.toThrow(/name/);
  });

  it('create 缺 root → 拒绝', async () => {
    const svc = await freshService();
    await expect(svc.handle('workspace.create', { name: 'p' })).rejects.toThrow(/root/);
  });

  it('create root 非绝对路径(相对路径)→ 拒绝', async () => {
    const svc = await freshService();
    await expect(
      svc.handle('workspace.create', { name: 'p', root: 'relative/path' }),
    ).rejects.toThrow(/root/);
  });

  it('create id 越界(空串)→ 拒绝', async () => {
    const svc = await freshService();
    await expect(
      svc.handle('workspace.create', { id: '', name: 'p', root: '/tmp/x' }),
    ).rejects.toThrow(/id/);
  });

  it('create id 非 string 类型 → 拒绝', async () => {
    const svc = await freshService();
    await expect(
      svc.handle('workspace.create', { id: 42, name: 'p', root: '/tmp/x' }),
    ).rejects.toThrow(/id/);
  });

  it('update 缺 id → 拒绝', async () => {
    const svc = await freshService();
    await expect(svc.handle('workspace.update', { name: 'x' })).rejects.toThrow(/id/);
  });

  it('update 既无 name 也无 root(空 patch)→ 拒绝', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'p',
      root: '/tmp/p',
    })) as WorkspaceEntry;
    await expect(svc.handle('workspace.update', { id: entry.id })).rejects.toThrow(
      /name\/root/,
    );
    // 不落坏数据:字段未变
    expect(await list(svc)).toEqual([entry]);
  });

  it('update name 类型错(非 string)→ 拒绝', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'p',
      root: '/tmp/p',
    })) as WorkspaceEntry;
    await expect(
      svc.handle('workspace.update', { id: entry.id, name: 42 }),
    ).rejects.toThrow(/name/);
    expect(await list(svc)).toEqual([entry]); // 未落坏
  });

  it('remove 缺 id → 拒绝 · 不落坏既有数据', async () => {
    const svc = await freshService();
    const entry = (await svc.handle('workspace.create', {
      name: 'p',
      root: '/tmp/p',
    })) as WorkspaceEntry;
    const before = await list(svc);
    await expect(svc.handle('workspace.remove', {})).rejects.toThrow(/id/);
    expect(await list(svc)).toEqual(before);
    expect(before).toEqual([entry]);
  });

  it('remove id 非 string 类型 → 拒绝', async () => {
    const svc = await freshService();
    await expect(svc.handle('workspace.remove', { id: 7 })).rejects.toThrow(/id/);
  });

  it('缺字段拒绝时不广播(无副作用泄漏)', async () => {
    const svc = await freshService();
    const messages: unknown[] = [];
    svc.addClient(1, (msg) => messages.push(msg));
    await expect(svc.handle('workspace.create', { root: '/tmp/x' })).rejects.toThrow();
    expect(messages).toEqual([]);
  });
});
