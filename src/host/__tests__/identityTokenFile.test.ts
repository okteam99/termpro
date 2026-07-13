// 多设备同屏 TECH §A.2:身份 token 文件落盘(0600/0700 + 原子替换)。
// PENDING-003 token-file 运维面收口的服务端半侧。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeIdentityTokenFile } from '../token';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-identity-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeIdentityTokenFile', () => {
  it('落盘内容 = token,文件 0600、目录 0700(umask 无关,显式 chmod 兜底)', () => {
    const file = path.join(tmpRoot, 'identity', 'id-abc', 'token');
    writeIdentityTokenFile(file, 'tok-128bit');

    expect(fs.readFileSync(file, 'utf8')).toBe('tok-128bit');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it('原子替换:重复写覆盖为最新 token,不留 tmp 残余', () => {
    const file = path.join(tmpRoot, 'token');
    writeIdentityTokenFile(file, 'old-token');
    writeIdentityTokenFile(file, 'new-token');

    expect(fs.readFileSync(file, 'utf8')).toBe('new-token');
    const leftovers = fs.readdirSync(tmpRoot).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
