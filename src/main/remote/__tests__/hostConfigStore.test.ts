// AC-1 台账 CRUD + 持久化跨重启;AC-7 最近使用倒序。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HostConfigStore } from '../credentialStore';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-hostcfg-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeStore(dir = tmpDir): HostConfigStore {
  return new HostConfigStore({ userDataDir: () => dir });
}

describe('AC-1 HostConfigStore CRUD', () => {
  it('T-001 CRUD 操作更新列表', () => {
    const store = makeStore();
    expect(store.list()).toEqual([]);

    const created = store.save({
      alias: 'vps-hk',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
    });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe(created.id);
    expect(created.createdAt).toBeGreaterThan(0);

    const updated = store.save({ ...created, alias: 'vps-hk-renamed' });
    expect(updated.id).toBe(created.id);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].alias).toBe('vps-hk-renamed');

    store.delete(created.id);
    expect(store.list()).toEqual([]);
  });

  it('T-002 持久化跨重启(新 store 实例读到同一目录)', () => {
    const store1 = makeStore();
    const created = store1.save({
      alias: 'vps-sg',
      host: '5.6.7.8',
      port: 2222,
      username: 'ubuntu',
      authType: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
    });

    const store2 = makeStore();
    const list = store2.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: created.id,
      alias: 'vps-sg',
      host: '5.6.7.8',
      privateKeyPath: '~/.ssh/id_ed25519',
    });
  });

  it('T-014 最近使用区按 lastUsed 倒序', () => {
    const store = makeStore();
    const a = store.save({ alias: 'a', host: 'a.example', port: 22, username: 'root', authType: 'password' });
    const b = store.save({ alias: 'b', host: 'b.example', port: 22, username: 'root', authType: 'password' });
    const c = store.save({ alias: 'c', host: 'c.example', port: 22, username: 'root', authType: 'password' });

    store.touchLastUsed(a.id, 1000);
    store.touchLastUsed(c.id, 3000);
    store.touchLastUsed(b.id, 2000);

    const sorted = [...store.list()].sort((x, y) => (y.lastUsed ?? 0) - (x.lastUsed ?? 0));
    expect(sorted.map((c) => c.alias)).toEqual(['c', 'b', 'a']);
  });

  it('私钥仅存路径(不含私钥内容)', () => {
    const store = makeStore();
    store.save({
      alias: 'k',
      host: 'k.example',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKeyPath: '/Users/tester/.ssh/id_ed25519',
    });
    const raw = fs.readFileSync(path.join(tmpDir, 'remote-hosts.json'), 'utf8');
    expect(raw).toContain('/Users/tester/.ssh/id_ed25519');
    expect(raw).not.toContain('PRIVATE KEY');
  });
});
