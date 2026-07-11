// 凭据存储(D-2 · safeStorage · ADR-001)+ 远程机配置台账(remote-hosts.json)。
// 两文件、职责分离(TECH SSH-2):
//   userData/remote-hosts.json          —— 非密文配置数组(RemoteHostConfig[])
//   userData/remote-hosts.secrets.json  —— { [key]: base64(safeStorage.encryptString(plaintext)) }
//
// userData 路径可注入(测试用临时目录),不直接绑死 Electron app.getPath —— main.ts
// 组装时传入 () => app.getPath('userData')。

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RemoteHostConfig, RemoteHostConfigInput } from '../../shared/remoteHost';
import { t } from '../../shared/i18n';

const SECRETS_FILE = 'remote-hosts.secrets.json';
const CONFIG_FILE = 'remote-hosts.json';

/** safeStorage 的最小接缝(测试注入桩,不直接依赖 electron 类型)。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface CredentialStoreDeps {
  /** userData 目录(可注入 · 测试用 fs.mkdtempSync)。 */
  userDataDir: () => string;
  /** 默认取 electron.safeStorage;测试注入桩(vi.mock('electron') 的等价物)。 */
  safeStorage: SafeStorageLike;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * 三类密钥键位(ARCH-6):
 *   cred:<id>:password    — SSH 登录密码(永不出 main)
 *   cred:<id>:passphrase  — 私钥 passphrase(永不出 main)
 *   hosttoken:<id>        — host loopback capability token(一次性经 ws URL 出 main · ADR-001)
 */
export class CredentialStore {
  constructor(private readonly deps: CredentialStoreDeps) {}

  private secretsPath(): string {
    return path.join(this.deps.userDataDir(), SECRETS_FILE);
  }

  private readAll(): Record<string, string> {
    return readJson(this.secretsPath(), {});
  }

  private writeAll(map: Record<string, string>): void {
    writeJsonAtomic(this.secretsPath(), map);
  }

  isAvailable(): boolean {
    return this.deps.safeStorage.isEncryptionAvailable();
  }

  /** 加密→base64→落盘。safeStorage 不可用时抛错,绝不明文落盘(AC-3)。 */
  setSecret(key: string, plaintext: string): void {
    if (!this.isAvailable()) {
      throw new Error(
        t('Local credential encryption is unavailable — cannot store the password safely'),
      );
    }
    const encrypted = this.deps.safeStorage.encryptString(plaintext);
    const map = this.readAll();
    map[key] = encrypted.toString('base64');
    this.writeAll(map);
  }

  /** 读→base64 decode→decryptString(瞬时,不缓存明文)。 */
  getSecret(key: string): string | null {
    const map = this.readAll();
    const b64 = map[key];
    if (b64 === undefined) return null;
    try {
      return this.deps.safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }

  deleteSecret(key: string): void {
    const map = this.readAll();
    if (!(key in map)) return;
    delete map[key];
    this.writeAll(map);
  }

  /** AC-14:删机随删必清 cred:<id>:* + hosttoken:<id>,无孤儿密文。 */
  deleteAllForConfig(configId: string): void {
    const map = this.readAll();
    const prefixes = [`cred:${configId}:`, `hosttoken:${configId}`];
    let changed = false;
    for (const key of Object.keys(map)) {
      if (
        key === `hosttoken:${configId}` ||
        key.startsWith(`cred:${configId}:`)
      ) {
        delete map[key];
        changed = true;
      }
    }
    void prefixes; // 上面判定已覆盖;prefixes 仅作可读性注记
    if (changed) this.writeAll(map);
  }
}

export interface HostConfigStoreDeps {
  userDataDir: () => string;
}

/** save 入参:配置 + 密文是否已存在的呈现标记(hasPassword/hasPassphrase 由调用方据是否传入明文决定)。 */
export type HostConfigSaveInput = RemoteHostConfigInput & {
  hasPassword?: boolean;
  hasPassphrase?: boolean;
};

/** remote-hosts.json 的 RemoteHostConfig[] CRUD(TECH 允许折进 credentialStore.ts)。 */
export class HostConfigStore {
  constructor(private readonly deps: HostConfigStoreDeps) {}

  private configPath(): string {
    return path.join(this.deps.userDataDir(), CONFIG_FILE);
  }

  list(): RemoteHostConfig[] {
    return readJson<RemoteHostConfig[]>(this.configPath(), []);
  }

  private persist(list: RemoteHostConfig[]): void {
    writeJsonAtomic(this.configPath(), list);
  }

  get(id: string): RemoteHostConfig | null {
    return this.list().find((c) => c.id === id) ?? null;
  }

  /** 新建(省略 id)或更新(id 命中既有)。 */
  save(input: HostConfigSaveInput): RemoteHostConfig {
    const list = this.list();
    if (input.id) {
      const idx = list.findIndex((c) => c.id === input.id);
      if (idx >= 0) {
        const updated: RemoteHostConfig = {
          ...list[idx],
          alias: input.alias,
          host: input.host,
          port: input.port,
          username: input.username,
          authType: input.authType,
          privateKeyPath: input.privateKeyPath,
          hasPassword: input.hasPassword ?? list[idx].hasPassword ?? false,
          hasPassphrase: input.hasPassphrase ?? list[idx].hasPassphrase ?? false,
        };
        list[idx] = updated;
        this.persist(list);
        return updated;
      }
    }
    const created: RemoteHostConfig = {
      id: input.id ?? generateId(),
      alias: input.alias,
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.authType,
      privateKeyPath: input.privateKeyPath,
      hasPassword: input.hasPassword ?? false,
      hasPassphrase: input.hasPassphrase ?? false,
      createdAt: Date.now(),
    };
    list.push(created);
    this.persist(list);
    return created;
  }

  delete(id: string): void {
    const list = this.list();
    const next = list.filter((c) => c.id !== id);
    if (next.length !== list.length) this.persist(next);
  }

  /** 成功 ready 时更新(AC-7 最近使用倒序排序依据)。 */
  touchLastUsed(id: string, now = Date.now()): void {
    const list = this.list();
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) return;
    list[idx] = { ...list[idx], lastUsed: now };
    this.persist(list);
  }
}

function generateId(): string {
  return crypto.randomBytes(9).toString('base64url');
}
