// BrowserProfileStore:CRUD、默认 profile 保护、落盘文档损坏兜底。
// 存储走 SettingsStore 抽象——测试用 JsonFileSettingsStore + 临时目录(真实落盘路径),
// 顺带覆盖原子写与损坏回退。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserProfileStore } from '../browserProfileStore';
import { JsonFileSettingsStore } from '../settingsStore';
import { DEFAULT_PROFILE_ID, PROFILE_ID_RE } from '../../shared/browserProfile';

let tmpDir: string;
let store: BrowserProfileStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-profiles-'));
  store = new BrowserProfileStore(
    new JsonFileSettingsStore({ userDataDir: () => tmpDir, file: 'browser-profiles.json' }),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('BrowserProfileStore', () => {
  it('新建:自造 32 位 hex id,名称 trim,UA 可选', () => {
    const p = store.save({ name: '  工作号  ' });
    expect(PROFILE_ID_RE.test(p.id)).toBe(true);
    expect(p.name).toBe('工作号');
    expect(p.userAgent).toBeUndefined();
    expect(p.createdAt).toBeGreaterThan(0);

    const q = store.save({ name: '指纹机', userAgent: ' Mozilla/5.0 Custom ' });
    expect(q.userAgent).toBe('Mozilla/5.0 Custom');
    expect(store.list().map((x) => x.id)).toEqual([p.id, q.id]);
  });

  it('更新:改名/改 UA;UA 置空 = 回落系统默认(字段删除)', () => {
    const p = store.save({ name: 'a', userAgent: 'UA-1' });
    const renamed = store.save({ id: p.id, name: 'b', userAgent: 'UA-2' });
    expect(renamed).toMatchObject({ id: p.id, name: 'b', userAgent: 'UA-2' });
    expect(renamed.createdAt).toBe(p.createdAt);

    const cleared = store.save({ id: p.id, name: 'b', userAgent: '   ' });
    expect(cleared.userAgent).toBeUndefined();
    expect(store.get(p.id)?.userAgent).toBeUndefined();
  });

  it('校验:空名拒绝;更新不存在的 id 拒绝', () => {
    expect(() => store.save({ name: '   ' })).toThrow();
    expect(() => store.save({ id: 'f'.repeat(32), name: 'x' })).toThrow();
  });

  it('默认 profile 保护:save 拒绝、delete 恒 false', () => {
    expect(() => store.save({ id: DEFAULT_PROFILE_ID, name: 'hack' })).toThrow();
    expect(store.delete(DEFAULT_PROFILE_ID)).toBe(false);
  });

  it('删除:命中 true 并落盘;未命中 false 幂等', () => {
    const p = store.save({ name: 'a' });
    expect(store.delete(p.id)).toBe(true);
    expect(store.get(p.id)).toBeNull();
    expect(store.delete(p.id)).toBe(false);
  });

  it('落盘文档损坏/形状非法 → 兜底空表,坏条目静默丢弃', () => {
    const file = path.join(tmpDir, 'browser-profiles.json');
    fs.writeFileSync(file, 'not json{{{');
    expect(store.list()).toEqual([]);

    const good = { id: 'b'.repeat(32), name: 'ok', createdAt: 1 };
    fs.writeFileSync(
      file,
      JSON.stringify([
        good,
        { id: 'BAD', name: 'x', createdAt: 1 }, // id 非 32hex
        { id: 'c'.repeat(32), name: '  ', createdAt: 1 }, // 空名
        { id: 'b'.repeat(32), name: 'dup', createdAt: 2 }, // 重复 id
        null,
      ]),
    );
    expect(store.list()).toEqual([good]);
  });

  it('跨实例持久化(同一文档)', () => {
    const p = store.save({ name: 'a' });
    const store2 = new BrowserProfileStore(
      new JsonFileSettingsStore({ userDataDir: () => tmpDir, file: 'browser-profiles.json' }),
    );
    expect(store2.get(p.id)?.name).toBe('a');
  });
});
