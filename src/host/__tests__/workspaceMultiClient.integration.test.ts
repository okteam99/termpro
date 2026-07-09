// 双客户端集成(AC-3 P1):真实 Host 广播路径(WorkspaceService)+ 真实收端协调(reconcileWorkspaces)。
// 不跨真实 MessagePort —— 两个内存 send 收集器充当客户端端口(TC 分层 5 补充洞察允许的等效 harness)。

import { promises as nodeFs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage, WorkspaceEntry } from '../../shared/protocol';
import { WorkspaceService } from '../workspaceService';
import { reconcileWorkspaces } from '../../renderer/state/workspaceSync';
import type { WorkspaceState } from '../../renderer/state/store';

let tempDir: string | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

interface FakeClient {
  id: number;
  messages: HostMessage[];
  lastSnapshot(): WorkspaceEntry[] | null;
}

async function harness(): Promise<{
  svc: WorkspaceService;
  a: FakeClient;
  b: FakeClient;
}> {
  tempDir = await mkdtemp(join(tmpdir(), 'termpro-mc-'));
  const svc = new WorkspaceService(tempDir);
  await svc.load();
  const mk = (id: number): FakeClient => {
    const messages: HostMessage[] = [];
    svc.addClient(id, (msg) => messages.push(msg));
    return {
      id,
      messages,
      lastSnapshot() {
        const changed = [...messages]
          .reverse()
          .find((m) => m.t === 'workspace:changed');
        return changed && changed.t === 'workspace:changed'
          ? changed.workspaces
          : null;
      },
    };
  };
  return { svc, a: mk(1), b: mk(2) };
}

function ws(id: string, name: string, root: string, tabIds: string[]): WorkspaceState {
  return {
    id,
    name,
    root,
    tabs: tabIds.map((t) => ({ id: t, title: t, cwd: root })),
    activeTabId: tabIds[0] ?? null,
  };
}

describe('workspace 多客户端集成', () => {
  it('test_client_a_create_pushes_snapshot_client_b_synthesizes_default_view (INT-001)', async () => {
    const { svc, a, b } = await harness();
    const entry = (await svc.handle('workspace.create', {
      name: 'proj',
      root: '/tmp/proj',
    })) as WorkspaceEntry;

    // 广播到全部客户端(含发起端 A)
    expect(a.lastSnapshot()?.map((w) => w.id)).toEqual([entry.id]);
    expect(b.lastSnapshot()?.map((w) => w.id)).toEqual([entry.id]);

    // B 本地空(初始 activeWorkspaceId=null)→ 协调:合成默认视图,不抢激活
    const result = reconcileWorkspaces([], null, b.lastSnapshot()!);
    expect(result.workspaces.map((w) => w.id)).toEqual([entry.id]);
    expect(result.workspaces[0].tabs).toHaveLength(1);
    expect(result.workspaces[0].tabs[0].cwd).toBe('/tmp/proj');
    expect(result.activeWorkspaceId).toBeNull(); // 新增不抢占 B 的激活态
  });

  it('test_client_a_rename_client_b_syncs_name_only_keeps_local_view_state (INT-002)', async () => {
    const { svc, b } = await harness();
    // 双方已存在 other + w1(均在注册表)
    const other = (await svc.handle('workspace.create', {
      name: 'Other',
      root: '/o',
    })) as WorkspaceEntry;
    const entry = (await svc.handle('workspace.create', {
      name: 'old',
      root: '/r',
    })) as WorkspaceEntry;

    // B 本地:w1 非默认排序位、2 个 tab、活跃 tab = t2
    const bLocal = [
      ws(other.id, 'Other', '/o', ['o1']),
      { ...ws(entry.id, 'old', '/r', ['t1', 't2']), activeTabId: 't2' },
    ];

    await svc.handle('workspace.update', { id: entry.id, name: 'renamed' });
    const snap = b.lastSnapshot()!;
    const result = reconcileWorkspaces(bLocal, other.id, snap);

    const w1 = result.workspaces.find((w) => w.id === entry.id)!;
    expect(w1.name).toBe('renamed');
    expect(w1.tabs.map((t) => t.id)).toEqual(['t1', 't2']); // tab 数/内容不变
    expect(w1.activeTabId).toBe('t2'); // 活跃 tab 不变
    expect(result.workspaces.map((w) => w.id)).toEqual([other.id, entry.id]); // 排序位不变
    expect(result.disposedTabIds).toEqual([]);
  });

  it('test_client_b_removes_workspace_active_on_client_a_disposes_and_switches (INT-003)', async () => {
    const { svc, a } = await harness();
    const w1 = (await svc.handle('workspace.create', {
      name: 'w1',
      root: '/w1',
    })) as WorkspaceEntry;
    const w2 = (await svc.handle('workspace.create', {
      name: 'w2',
      root: '/w2',
    })) as WorkspaceEntry;

    // A 本地:打开 w1(含 1 个运行中 tab)+ w2,active=w1
    const aLocal = [ws(w1.id, 'w1', '/w1', ['pty-1']), ws(w2.id, 'w2', '/w2', ['pty-2'])];

    // B 删除 w1
    await svc.handle('workspace.remove', { id: w1.id });
    const snap = a.lastSnapshot()!;
    expect(snap.map((w) => w.id)).toEqual([w2.id]);

    const result = reconcileWorkspaces(aLocal, w1.id, snap);
    expect(result.disposedTabIds).toEqual(['pty-1']); // 回收 w1 全部 tab
    expect(result.workspaces.map((w) => w.id)).toEqual([w2.id]);
    expect(result.activeWorkspaceId).toBe(w2.id); // 活跃切到剩余首个
  });

  it('test_failed_create_rpc_on_client_a_does_not_push_to_client_b (INT-004)', async () => {
    const { svc, a, b } = await harness();
    // 注册表写入注入失败(磁盘只读模拟)
    vi.spyOn(nodeFs, 'writeFile').mockRejectedValueOnce(new Error('EROFS'));

    await expect(
      svc.handle('workspace.create', { name: 'x', root: '/x' }),
    ).rejects.toThrow(/EROFS/);

    // 失败不广播:A、B 均未收到 workspace:changed(无变更未推送)
    expect(a.messages.some((m) => m.t === 'workspace:changed')).toBe(false);
    expect(b.messages.some((m) => m.t === 'workspace:changed')).toBe(false);
  });
});
