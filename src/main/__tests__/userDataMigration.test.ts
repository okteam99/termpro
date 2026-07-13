import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { migrateLegacyUserData } from '../userDataMigration';

const silentLog = { log: () => undefined, error: () => undefined };

describe('migrateLegacyUserData (TermPro → OkWork 改名迁移)', () => {
  let root: string;
  let legacy: string;
  let current: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-mig-'));
    legacy = path.join(root, 'TermPro');
    current = path.join(root, 'OkWork');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('migrates_legacy_dir_when_current_missing', () => {
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'state.json'), '{"v":2}');
    migrateLegacyUserData(legacy, current, silentLog);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(current, 'state.json'), 'utf8')).toBe('{"v":2}');
  });

  it('replaces_current_dir_when_it_exists_but_is_empty', () => {
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'state.json'), '{}');
    fs.mkdirSync(current);
    migrateLegacyUserData(legacy, current, silentLog);
    expect(fs.existsSync(path.join(current, 'state.json'))).toBe(true);
  });

  it('never_overwrites_nonempty_current_dir', () => {
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'state.json'), '{"old":1}');
    fs.mkdirSync(current);
    fs.writeFileSync(path.join(current, 'state.json'), '{"new":1}');
    migrateLegacyUserData(legacy, current, silentLog);
    expect(fs.readFileSync(path.join(current, 'state.json'), 'utf8')).toBe('{"new":1}');
    // 旧目录原地保留,可人工恢复
    expect(fs.readFileSync(path.join(legacy, 'state.json'), 'utf8')).toBe('{"old":1}');
  });

  it('noops_when_legacy_dir_missing', () => {
    migrateLegacyUserData(legacy, current, silentLog);
    expect(fs.existsSync(current)).toBe(false);
  });
});
