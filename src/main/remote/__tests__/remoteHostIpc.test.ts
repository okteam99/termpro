// A9 safeStorage 不可用时 save 拒绝(不落半成品配置);E8 事件只推给 getMainWindow()
// 返回的窗口(不广播到全部 BrowserWindow,防隧道 token 泄漏到无关窗口)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const onListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      on: vi.fn((channel: string, fn: (...args: unknown[]) => void) => {
        const arr = onListeners.get(channel) ?? [];
        arr.push(fn);
        onListeners.set(channel, arr);
      }),
      removeAllListeners: vi.fn((channel: string) => {
        onListeners.delete(channel);
      }),
      __handlers: handlers,
      __onListeners: onListeners,
    },
  };
});

import { ipcMain } from 'electron';
import { registerRemoteHostIpc } from '../remoteHostIpc';
import { RemoteHostOrchestrator } from '../orchestrator';
import { CredentialStore, HostConfigStore, type SafeStorageLike } from '../credentialStore';
import { REMOTE_HOST_CHANNELS } from '../../../shared/remoteHost';
import { createRoutedSsh } from './testKit';

interface FakeIpcMain {
  __handlers: Map<string, (...args: unknown[]) => unknown>;
  __onListeners: Map<string, Array<(...args: unknown[]) => void>>;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-ipc-'));
  const fake = ipcMain as unknown as FakeIpcMain;
  fake.__handlers.clear();
  fake.__onListeners.clear();
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSafeStorage(available: boolean): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (p: string) => Buffer.from(`ENC:${p}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').slice(4),
  };
}

function makeOrchestrator(credentials: CredentialStore, configStore: HostConfigStore) {
  return new RemoteHostOrchestrator({
    connectSsh: async () => createRoutedSsh(),
    credentials,
    configStore,
    bundleDir: () => '/local/bundle/darwin-arm64',
    appVersion: '1.0.0',
  });
}

describe('A9 remoteHostIpc.save 前置校验 safeStorage 可用性', () => {
  it('不可用 + 请求存密码 → 整个 save 拒绝,不落半成品配置(无「声称已存密码但实际无密文」的记录)', async () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(false) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);

    const fake = ipcMain as unknown as FakeIpcMain;
    const saveHandler = fake.__handlers.get(REMOTE_HOST_CHANNELS.save)!;

    // handler 是同步函数,同步 throw(与真实 Electron ipcMain.handle 语义一致:
    // sync throw 会被 Electron 自动包成 rejected invoke() promise,但直接调用
    // handler 本体时看到的就是同步异常)。
    expect(() =>
      saveHandler(
        {},
        {
          config: { alias: 'a', host: 'h', port: 22, username: 'root', authType: 'password' },
          password: 'secret',
        },
      ),
    ).toThrow(/encryption is unavailable/);

    expect(configStore.list()).toEqual([]);
  });

  it('不可用 + 仅私钥认证(无密码/passphrase)→ 正常保存(私钥路径不需要加密)', async () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(false) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);

    const fake = ipcMain as unknown as FakeIpcMain;
    const saveHandler = fake.__handlers.get(REMOTE_HOST_CHANNELS.save)!;
    const saved = await saveHandler(
      {},
      {
        config: {
          alias: 'k',
          host: 'h',
          port: 22,
          username: 'root',
          authType: 'key',
          privateKeyPath: '~/.ssh/id_ed25519',
        },
      },
    );
    expect((saved as { id: string }).id).toBeTruthy();
    expect(configStore.list()).toHaveLength(1);
  });

  it('可用时正常 save + setSecret 往返', async () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);

    const fake = ipcMain as unknown as FakeIpcMain;
    const saveHandler = fake.__handlers.get(REMOTE_HOST_CHANNELS.save)!;
    const saved = (await saveHandler(
      {},
      {
        config: { alias: 'a', host: 'h', port: 22, username: 'root', authType: 'password' },
        password: 'secret',
      },
    )) as { id: string; hasPassword?: boolean };
    expect(saved.hasPassword).toBe(true);
    expect(credentials.getSecret(`cred:${saved.id}:password`)).toBe('secret');
  });
});

describe('remoteHostIpc.capabilities 凭据面能力查询', () => {
  function capabilitiesWith(available: boolean): unknown {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({
      userDataDir: () => tmpDir,
      safeStorage: makeSafeStorage(available),
    });
    const orchestrator = makeOrchestrator(credentials, configStore);
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);
    const fake = ipcMain as unknown as FakeIpcMain;
    return fake.__handlers.get(REMOTE_HOST_CHANNELS.capabilities)!({});
  }

  it('safeStorage 可用 → encryptionAvailable: true', () => {
    expect(capabilitiesWith(true)).toEqual({ encryptionAvailable: true });
  });

  it('safeStorage 不可用(钥匙串授权被拒等)→ encryptionAvailable: false(renderer 据此挂横幅)', () => {
    expect(capabilitiesWith(false)).toEqual({ encryptionAvailable: false });
  });
});

describe('E8 remoteHost:event 只推给 getMainWindow() 返回的窗口', () => {
  it('事件送到 getMainWindow() 返回的窗口(隧道 token 不会经此广播到任意窗口——实现已不再调用 getAllWindows)', async () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    configStore.save({
      id: 'vps-hk',
      alias: 'vps-hk',
      host: 'bad.example',
      port: 22,
      username: 'root',
      authType: 'password',
    });

    const orchestrator = new RemoteHostOrchestrator({
      connectSsh: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      credentials,
      configStore,
      bundleDir: () => '/local/bundle/darwin-arm64',
      appVersion: '1.0.0',
    });

    const mainSent: unknown[] = [];
    const mainWin = {
      isDestroyed: () => false,
      webContents: { send: (_channel: string, event: unknown) => mainSent.push(event) },
    };
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => mainWin as never);

    await orchestrator.connect('vps-hk');

    expect(mainSent.length).toBeGreaterThan(0);
    expect(
      mainSent.some((e) => (e as { stage?: string }).stage === 'failed'),
    ).toBe(true);
  });

  it('getMainWindow() 返回 null(主窗口未就绪/已关闭)→ 事件安静丢弃,不抛错', async () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    configStore.save({
      id: 'vps-hk',
      alias: 'vps-hk',
      host: 'bad.example',
      port: 22,
      username: 'root',
      authType: 'password',
    });
    const orchestrator = new RemoteHostOrchestrator({
      connectSsh: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      credentials,
      configStore,
      bundleDir: () => '/local/bundle/darwin-arm64',
      appVersion: '1.0.0',
    });
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);

    await expect(orchestrator.connect('vps-hk')).resolves.toBeUndefined();
  });
});

describe('remoteHost:upgrade 用户显式升级服务端(forceRedeploy · Remote Hosts「Update」按钮)', () => {
  // 🔴 评审 P2 纵深防御后:upgrade 是 remoteHost 通道里唯一会终止用户远端在跑进程的
  // 指令,而 preload 四窗共用——只信主窗口 sender(与 tunnel 通道的归属校验同族)。
  // webContents 用一个独立引用对象充当「身份」,与 event.sender 做 === 比对。
  function makeMainWin() {
    const webContents = {};
    const win = { isDestroyed: () => false, webContents };
    return { win, webContents };
  }

  function setup(getMainWindow: () => unknown) {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    const connectSpy = vi.spyOn(orchestrator, 'connect').mockResolvedValue(undefined);
    registerRemoteHostIpc(orchestrator, credentials, configStore, getMainWindow as never);
    const fake = ipcMain as unknown as FakeIpcMain;
    const upgradeListeners = fake.__onListeners.get(REMOTE_HOST_CHANNELS.upgrade) ?? [];
    expect(upgradeListeners).toHaveLength(1);
    return { connectSpy, upgrade: upgradeListeners[0] };
  }

  it('主窗口 sender + 合法 payload → orchestrator.connect(id, { forceRedeploy: true }) 被调(确认交互在 renderer 侧,main 不二次拦截)', () => {
    const { win, webContents } = makeMainWin();
    const { connectSpy, upgrade } = setup(() => win);

    upgrade({ sender: webContents }, { id: 'vps-hk' });

    expect(connectSpy).toHaveBeenCalledWith('vps-hk', { forceRedeploy: true });
  });

  it('sender 非主窗口 webContents → 不被调(纵深防御,与 tunnel 通道归属校验同族)', () => {
    const { win } = makeMainWin();
    const { connectSpy, upgrade } = setup(() => win);

    upgrade({ sender: {} }, { id: 'vps-hk' }); // 非主窗口的 webContents 引用

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('getMainWindow() 返回 null → 不被调', () => {
    const { connectSpy, upgrade } = setup(() => null);
    upgrade({ sender: {} }, { id: 'vps-hk' });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('主窗口已销毁(isDestroyed() 为 true)→ 不被调', () => {
    const destroyedWin = { isDestroyed: () => true, webContents: {} };
    const { connectSpy, upgrade } = setup(() => destroyedWin);
    upgrade({ sender: destroyedWin.webContents }, { id: 'vps-hk' });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('payload 非法(undefined / id 非 string)→ 不被调', () => {
    const { win, webContents } = makeMainWin();
    const { connectSpy, upgrade } = setup(() => win);

    upgrade({ sender: webContents }, undefined);
    upgrade({ sender: webContents }, { id: 42 });
    upgrade({ sender: webContents }, {});

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('dispose 后 upgrade listener 被移除(照 connect/disconnect 同族反注册)', () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    const dispose = registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);

    const fake = ipcMain as unknown as FakeIpcMain;
    expect(fake.__onListeners.get(REMOTE_HOST_CHANNELS.upgrade)).toHaveLength(1);

    dispose();

    expect(fake.__onListeners.has(REMOTE_HOST_CHANNELS.upgrade)).toBe(false);
  });
});

describe('remoteHost:tunnel 请求方归属校验(P2-1 纵深防御)', () => {
  it('谓词拒绝的请求方拿到 null(不触达 orchestrator);放行的请求方走 tunnelFor', () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    const tunnelFor = vi
      .spyOn(orchestrator, 'tunnelFor')
      .mockReturnValue({ localPort: 50000, token: 'tok' });

    const allowedSender = { id: 1 };
    registerRemoteHostIpc(
      orchestrator,
      credentials,
      configStore,
      () => null,
      (sender, configId) => sender === (allowedSender as never) && configId === 'cfg-1',
    );
    const fake = ipcMain as unknown as FakeIpcMain;
    const tunnelHandler = fake.__handlers.get(REMOTE_HOST_CHANNELS.tunnel)!;

    // 非归属窗口(sender 不匹配)→ null,且不泄露「会话是否存在」(不触达 tunnelFor)
    expect(tunnelHandler({ sender: { id: 2 } }, { id: 'cfg-1' })).toBeNull();
    // 归属窗口但请求别台机器的 token(configId 不匹配)→ null
    expect(tunnelHandler({ sender: allowedSender }, { id: 'cfg-2' })).toBeNull();
    expect(tunnelFor).not.toHaveBeenCalled();

    // 归属窗口 + 本机器 → 放行到 tunnelFor
    expect(tunnelHandler({ sender: allowedSender }, { id: 'cfg-1' })).toEqual({
      localPort: 50000,
      token: 'tok',
    });
    expect(tunnelFor).toHaveBeenCalledWith('cfg-1');
  });

  it('未传谓词(测试桩场景)→ 不校验,直接走 tunnelFor', () => {
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage(true) });
    const orchestrator = makeOrchestrator(credentials, configStore);
    vi.spyOn(orchestrator, 'tunnelFor').mockReturnValue(null);
    registerRemoteHostIpc(orchestrator, credentials, configStore, () => null);

    const fake = ipcMain as unknown as FakeIpcMain;
    const tunnelHandler = fake.__handlers.get(REMOTE_HOST_CHANNELS.tunnel)!;
    expect(tunnelHandler({ sender: {} }, { id: 'cfg-1' })).toBeNull();
    expect(orchestrator.tunnelFor).toHaveBeenCalledWith('cfg-1');
  });
});
