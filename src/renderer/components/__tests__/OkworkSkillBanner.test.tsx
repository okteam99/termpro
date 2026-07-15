// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
// 横条:未装→显示安装+点装后消失;最新→不显示;× →消失且 snooze;旧 host(RPC 失败)→不显示。
// VITEST 下 i18n 恒 'en',故断言英文文案。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

const rpc = vi.fn();
let clientForHost: { rpc: typeof rpc } | null = { rpc };
vi.mock('../../services/hostRegistry', () => ({
  hostRegistry: { forHostId: () => clientForHost },
}));

import { OkworkSkillBanner } from '../OkworkSkillBanner';
import { useAppStore } from '../../state/store';
import { OKWORK_SKILL_VERSION } from '../../../shared/okworkSkill';
import type { SkillStatusResult } from '../../../shared/protocol';

const _ls = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (_ls.has(k) ? _ls.get(k)! : null),
  setItem: (k: string, v: string) => void _ls.set(k, String(v)),
  removeItem: (k: string) => void _ls.delete(k),
  clear: () => _ls.clear(),
});

function seed(hostId = 'cfg-1') {
  useAppStore.setState({
    workspaces: [{ id: 'ws1', name: 'w', root: '/w', hostId, tabs: [], activeTabId: null }],
    activeWorkspaceId: 'ws1',
  } as never);
}
const status = (o: Partial<SkillStatusResult>): SkillStatusResult => ({
  claude: { present: false, version: null },
  codex: { present: false, version: null },
  shared: { present: false, version: null },
  duplicate: false,
  ...o,
});

beforeEach(() => {
  _ls.clear();
  rpc.mockReset();
  clientForHost = { rpc };
});
afterEach(cleanup);

describe('OkworkSkillBanner', () => {
  it('未装 → 显示安装横条;点「Install」调 skill.install,装好后消失', async () => {
    seed();
    rpc.mockImplementation((m: string) =>
      m === 'skill.status'
        ? Promise.resolve(status({ claude: { present: true, version: null } }))
        : Promise.resolve(status({ claude: { present: true, version: OKWORK_SKILL_VERSION } })),
    );
    render(<OkworkSkillBanner />);

    const btn = await screen.findByRole('button', { name: 'Install' });
    expect(screen.getByText(/operate the built-in browser/)).toBeInTheDocument();

    fireEvent.click(btn);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('skill.install', expect.objectContaining({ name: 'okwork' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install' })).toBeNull());
  });

  it('最新 → 不显示横条', async () => {
    seed();
    rpc.mockResolvedValue(status({ claude: { present: true, version: OKWORK_SKILL_VERSION } }));
    render(<OkworkSkillBanner />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('skill.status', { name: 'okwork' }));
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  });

  it('装了但旧 → 显示「Update」', async () => {
    seed();
    rpc.mockResolvedValue(status({ claude: { present: true, version: 'v0.0.1' } }));
    render(<OkworkSkillBanner />);
    expect(await screen.findByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('× 关闭 → 横条消失且写入 snooze', async () => {
    seed('cfg-x');
    rpc.mockResolvedValue(status({ codex: { present: true, version: null } }));
    render(<OkworkSkillBanner />);
    const close = await screen.findByRole('button', { name: 'Dismiss' });
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install' })).toBeNull());
    expect(_ls.get('okwork-skill-snooze:cfg-x')).toBeTruthy();
  });

  it('旧 host(skill.status 抛错)→ 不显示', async () => {
    seed();
    rpc.mockRejectedValue(new Error('unknown rpc method: skill.status'));
    render(<OkworkSkillBanner />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('机器未连(forHostId→null)→ 不探测、不显示(评审 P2:写路由绝不兜底 local)', async () => {
    seed('cfg-remote-down');
    clientForHost = null;
    render(<OkworkSkillBanner />);
    await Promise.resolve();
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });
});
