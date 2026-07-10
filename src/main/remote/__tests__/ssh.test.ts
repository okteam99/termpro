// 🔴 A8/E5:isEexist 只对确凿的「已存在」信号放行,不再把任意非 undefined code
// (含 ENOENT 等真实失败)都当 EEXIST 吞掉——否则会掩盖如 A1 那类「父目录缺失」的
// bug(sftpWriteDir 的 mkdir 链静默跳过而非报错)。
import { describe, it, expect, afterEach } from 'vitest';
import { isEexist, isEnoent, buildKeepaliveConfig } from '../ssh';

// 🔴 首连必挂回归:ssh2 SFTP 错误的 code 是【数字】状态码(NO_SUCH_FILE = 2),
// isEnoent 必须认得它,否则全新远端读 .ready/host.port 抛「No such file」而非返回 null。
describe('isEnoent 识别 ssh2 数字 SFTP 状态码', () => {
  it('ssh2 真实形状:code = 2(数字)+ OpenSSH message "No such file" → true', () => {
    const err = Object.assign(new Error('No such file'), { code: 2 });
    expect(isEnoent(err)).toBe(true);
  });

  it('本地 fs 语义:code === "ENOENT" → true(桩/未来实现保留)', () => {
    expect(isEnoent({ code: 'ENOENT' })).toBe(true);
  });

  it('其他 SFTP 状态码(PERMISSION_DENIED=3 / FAILURE=4)→ false(真实失败必须上抛)', () => {
    expect(isEnoent({ code: 3, message: 'Permission denied' })).toBe(false);
    expect(isEnoent({ code: 4, message: 'Failure' })).toBe(false);
  });

  it('undefined/null/无 code → false', () => {
    expect(isEnoent(undefined)).toBe(false);
    expect(isEnoent(null)).toBe(false);
    expect(isEnoent(new Error('No such file'))).toBe(false);
  });
});

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

// 🔴 纵深防御(ARCH-B-1 补充):ssh2 keepalive 默认值 + env 可注入,让冻结 TCP
// 下 main 也能较快探活断线(不替代 disconnect-first,只是补一条快感知路径)。
describe('buildKeepaliveConfig ssh keepalive 纵深防御', () => {
  afterEach(() => {
    delete process.env.TERMPRO_SSH_KEEPALIVE_MS;
    delete process.env.TERMPRO_SSH_KEEPALIVE_COUNT;
  });

  it('无 env 覆盖 → 默认 15000ms / 3 次', () => {
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });

  it('env 可注入覆盖默认值', () => {
    process.env.TERMPRO_SSH_KEEPALIVE_MS = '5000';
    process.env.TERMPRO_SSH_KEEPALIVE_COUNT = '2';
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 5000, keepaliveCountMax: 2 });
  });

  it('非法/非正数 env → 落回默认值(不产出 0 或 NaN keepalive)', () => {
    process.env.TERMPRO_SSH_KEEPALIVE_MS = 'not-a-number';
    process.env.TERMPRO_SSH_KEEPALIVE_COUNT = '-1';
    expect(buildKeepaliveConfig()).toEqual({ keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  });
});
