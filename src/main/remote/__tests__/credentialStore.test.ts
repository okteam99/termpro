// AC-3 safeStorage 加解密 + 零明文 + 私钥仅路径 + 无 get-secret 通道;
// AC-14 删机随删清凭据无孤儿密文。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CredentialStore, HostConfigStore, type SafeStorageLike } from '../credentialStore';
import { REMOTE_HOST_CHANNELS } from '../../../shared/remoteHost';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-creds-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 可逆桩:密文 = "ENC:" + base64(plaintext),用于往返断言而不依赖真实 OS keychain。 */
function makeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((plaintext: string) => Buffer.from(`ENC:${plaintext}`, 'utf8')),
    decryptString: vi.fn((encrypted: Buffer) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('ENC:')) throw new Error('bad ciphertext');
      return text.slice(4);
    }),
  };
}

function makeStore(available = true): { store: CredentialStore; safeStorage: SafeStorageLike } {
  const safeStorage = makeSafeStorage(available);
  return {
    store: new CredentialStore({ userDataDir: () => tmpDir, safeStorage }),
    safeStorage,
  };
}

describe('AC-3 CredentialStore', () => {
  it('T-006 密码/passphrase 经 safeStorage 加密 · 磁盘零明文 · 往返一致', () => {
    const { store, safeStorage } = makeStore();
    store.setSecret('cred:m1:password', 'hunter2-secret');
    store.setSecret('cred:m1:passphrase', 'pp-secret');

    const raw = fs.readFileSync(path.join(tmpDir, 'remote-hosts.secrets.json'), 'utf8');
    expect(raw).not.toContain('hunter2-secret');
    expect(raw).not.toContain('pp-secret');
    expect(safeStorage.encryptString).toHaveBeenCalledWith('hunter2-secret');
    expect(safeStorage.encryptString).toHaveBeenCalledWith('pp-secret');

    expect(store.getSecret('cred:m1:password')).toBe('hunter2-secret');
    expect(store.getSecret('cred:m1:passphrase')).toBe('pp-secret');
  });

  it('safeStorage 不可用 → setSecret 拒存,不明文落盘(AC-3)', () => {
    const { store } = makeStore(false);
    expect(() => store.setSecret('cred:m1:password', 'hunter2-secret')).toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'remote-hosts.secrets.json'))).toBe(false);
  });

  it('T-007 私钥仅存路径 · 无 get-secret 通道(结构断言)', () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const saved = configStore.save({
      alias: 'k',
      host: 'k.example',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKeyPath: '~/.ssh/id_ed25519',
    });
    expect(saved.privateKeyPath).toBe('~/.ssh/id_ed25519');
    const rawConfig = fs.readFileSync(path.join(tmpDir, 'remote-hosts.json'), 'utf8');
    expect(rawConfig).not.toContain('PRIVATE KEY');

    // IPC 面只有 REMOTE_HOST_CHANNELS 枚举的这些通道——无 get-secret / read-password 之类。
    // tunnel 返回的是「已就绪会话的本地转发端口 + 隧道 capability token」(查看器窗口
    // 直连 host 用),不触碰 SSH 密码/passphrase/私钥等存储凭据,不违背 AC-3。
    // capabilities 只回 { encryptionAvailable: boolean }(safeStorage 可用性,零敏感值)。
    const channelNames = Object.keys(REMOTE_HOST_CHANNELS);
    expect(channelNames.sort()).toEqual(
      [
        'list',
        'save',
        'delete',
        'test',
        'connect',
        'disconnect',
        'event',
        'tunnel',
        'capabilities',
      ].sort(),
    );
    expect(channelNames.some((n) => /secret|password|passphrase/i.test(n))).toBe(false);
  });

  it('T-029 删机随删清凭据,无孤儿密文', () => {
    const { store } = makeStore();
    store.setSecret('cred:m1:password', 'pw');
    store.setSecret('hosttoken:m1', 'tok-m1');
    store.setSecret('cred:m2:password', 'pw2');

    store.deleteAllForConfig('m1');

    expect(store.getSecret('cred:m1:password')).toBeNull();
    expect(store.getSecret('hosttoken:m1')).toBeNull();
    // m2 不受影响(无孤儿清理误伤)
    expect(store.getSecret('cred:m2:password')).toBe('pw2');

    const raw = fs.readFileSync(path.join(tmpDir, 'remote-hosts.secrets.json'), 'utf8');
    expect(raw).not.toContain('m1');
  });

  it('deleteSecret 单条删除是幂等的', () => {
    const { store } = makeStore();
    store.setSecret('hosttoken:m1', 'tok');
    store.deleteSecret('hosttoken:m1');
    expect(store.getSecret('hosttoken:m1')).toBeNull();
    expect(() => store.deleteSecret('hosttoken:m1')).not.toThrow();
  });
});
