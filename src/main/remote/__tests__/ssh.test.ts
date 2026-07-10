// 🔴 A8/E5:isEexist 只对确凿的「已存在」信号放行,不再把任意非 undefined code
// (含 ENOENT 等真实失败)都当 EEXIST 吞掉——否则会掩盖如 A1 那类「父目录缺失」的
// bug(sftpWriteDir 的 mkdir 链静默跳过而非报错)。
import { describe, it, expect } from 'vitest';
import { isEexist } from '../ssh';

describe('A8/E5 isEexist 窄化', () => {
  it('code === "EEXIST" → true', () => {
    expect(isEexist({ code: 'EEXIST' })).toBe(true);
  });

  it('message 含 "File exists" / "already exists"(不区分大小写)→ true', () => {
    expect(isEexist({ message: 'SFTP error: File exists' })).toBe(true);
    expect(isEexist({ message: 'Failure: directory already exists' })).toBe(true);
    expect(isEexist({ message: 'FILE EXISTS' })).toBe(true);
  });

  it('ENOENT(父目录不存在)→ false(真实失败,必须上抛,不能被静默吞掉)', () => {
    expect(isEexist({ code: 'ENOENT', message: 'No such file or directory' })).toBe(false);
  });

  it('权限错误 → false', () => {
    expect(isEexist({ code: 'EACCES', message: 'Permission denied' })).toBe(false);
  });

  it('任意数字 SFTP 状态码但无「已存在」语义的 message → false(此前的漏洞:任意非 undefined code 都被放行)', () => {
    expect(isEexist({ code: 4, message: 'SSH_FX_FAILURE: disk full' })).toBe(false);
  });

  it('undefined/null → false', () => {
    expect(isEexist(undefined)).toBe(false);
    expect(isEexist(null)).toBe(false);
  });
});
