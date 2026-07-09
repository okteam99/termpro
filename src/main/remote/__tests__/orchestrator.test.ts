// AC-2/5/11/12/13/14 orchestrator 状态机 + in-flight guard + 失败分类 + 认领/重试/删除。
// 全部注入桩 connectSsh(DI · ARCH-B10),不 mock static,不触网。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RemoteHostOrchestrator, isLegalTransition } from '../orchestrator';
import { CredentialStore, HostConfigStore, type SafeStorageLike } from '../credentialStore';
import type { RemoteEvent, RemoteStage } from '../../../shared/remoteHost';
import { createRoutedSsh, bufferOf, type RoutedSsh } from './testKit';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termpro-orch-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSafeStorage(): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (p: string) => Buffer.from(`ENC:${p}`, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').slice(4),
  };
}

interface Harness {
  orchestrator: RemoteHostOrchestrator;
  configStore: HostConfigStore;
  credentials: CredentialStore;
  events: RemoteEvent[];
  probe: ReturnType<typeof vi.fn>;
  connectSsh: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: {
  connectSshImpl?: (o: unknown) => Promise<RoutedSsh>;
  probeImpl?: (localPort: number, token: string) => Promise<{ ok: boolean; compatible?: boolean; detail?: string }>;
} = {}): Harness {
  const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
  const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage() });
  const events: RemoteEvent[] = [];
  const probe = vi.fn(
    opts.probeImpl ?? (async () => ({ ok: true, compatible: true })),
  );
  const connectSsh = vi.fn(
    opts.connectSshImpl ?? (async () => createRoutedSsh({ execHandlers: healthyDefaults() })),
  );
  const orchestrator = new RemoteHostOrchestrator({
    connectSsh: connectSsh as never,
    credentials,
    configStore,
    bundleDir: () => '/local/bundle/darwin-arm64',
    appVersion: '1.0.0',
    probeHostInfo: probe as never,
    sleep: async () => undefined,
  });
  orchestrator.onEvent((e) => events.push(e));
  return { orchestrator, configStore, credentials, events, probe, connectSsh };
}

function healthyDefaults() {
  return [
    (cmd: string) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
    (cmd: string) => (cmd === 'node -v' ? { code: 0, stdout: 'v20.11.0\n', stderr: '' } : null),
    (cmd: string) => (cmd === 'uname -sm' ? { code: 0, stdout: 'Darwin arm64\n', stderr: '' } : null),
  ];
}

/** 首装场景专用 ssh 桩:host.port 在 execDetached 被调用后才「出现」(模拟真实启动时序)。 */
function createFreshDeploySsh(configId: string): RoutedSsh {
  let started = false;
  const ssh = createRoutedSsh({
    execHandlers: healthyDefaults(),
    sftpReadFile: (p) => {
      if (p.endsWith('.ready')) return null; // 无既有 bundle → 走部署
      if (p.endsWith('host.port')) {
        return started ? bufferOf({ port: 5555, pid: 4242, hostTag: configId }) : null;
      }
      return null;
    },
  });
  const originalExecDetached = ssh.execDetached;
  ssh.execDetached = vi.fn(async (cmd: string, stdin: string) => {
    started = true;
    return originalExecDetached(cmd, stdin);
  });
  return ssh;
}

function saveConfig(configStore: HostConfigStore, id = 'vps-hk') {
  return configStore.save({
    id,
    alias: 'vps-hk',
    host: '1.2.3.4',
    port: 22,
    username: 'root',
    authType: 'password',
  });
}

describe('AC-5 isLegalTransition(纯函数)', () => {
  it('T-010 非法边被拒绝', () => {
    expect(isLegalTransition('idle', 'ready')).toBe(false);
    expect(isLegalTransition('deploying', 'ready')).toBe(false);
    expect(isLegalTransition('connecting', 'ready')).toBe(false);
    expect(isLegalTransition('idle', 'deploying')).toBe(false);
  });

  it('合法边组合(含 R2V-2 补的 claiming→deploying / claiming→failed)', () => {
    expect(isLegalTransition('idle', 'connecting')).toBe(true);
    expect(isLegalTransition('connecting', 'deploying')).toBe(true);
    expect(isLegalTransition('connecting', 'claiming')).toBe(true);
    expect(isLegalTransition('deploying', 'starting')).toBe(true);
    expect(isLegalTransition('starting', 'verifying')).toBe(true);
    expect(isLegalTransition('claiming', 'verifying')).toBe(true);
    expect(isLegalTransition('verifying', 'ready')).toBe(true);
    expect(isLegalTransition('ready', 'disconnected')).toBe(true);
    expect(isLegalTransition('failed', 'connecting')).toBe(true);
    expect(isLegalTransition('disconnected', 'connecting')).toBe(true);
  });

  it('T-010b claiming→deploying 与 claiming→failed 在合法集内', () => {
    expect(isLegalTransition('claiming', 'deploying')).toBe(true);
    expect(isLegalTransition('claiming', 'failed')).toBe(true);
  });

  it('同阶段重复(如 deploying 多次进度事件)恒合法', () => {
    expect(isLegalTransition('deploying', 'deploying')).toBe(true);
  });
});

describe('AC-2 test() 仅认证+可达,不部署不拉起', () => {
  it('T-005 认证通过 → { ok: true },sftpWriteDir/execDetached/probe 均未被调用', async () => {
    const routed = createRoutedSsh({ execHandlers: healthyDefaults() });
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    const result = await h.orchestrator.test('vps-hk');
    expect(result).toEqual({ ok: true });
    expect(routed.close).toHaveBeenCalled();
    expect(routed.sftpWriteDir).not.toHaveBeenCalled();
    expect(routed.execDetached).not.toHaveBeenCalled();
    expect(h.probe).not.toHaveBeenCalled();
  });

  it('测试连接失败与连接失败共享同一分类(T-004 呼应)', async () => {
    const h = makeHarness({
      connectSshImpl: async () => {
        throw new Error('connect ECONNREFUSED 1.2.3.4:22');
      },
    });
    saveConfig(h.configStore);
    const result = await h.orchestrator.test('vps-hk');
    expect(result).toEqual({ ok: false, reason: 'unreachable', detail: expect.any(String) });
  });
});

describe('AC-5 状态机全链路(首次部署到 ready)', () => {
  it('T-010/T-011 idle→connecting→deploying→starting→verifying→ready 有序广播,无乱序/无重复 ready', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const stages = h.events.map((e) => e.stage);
    // 允许 deploying 内多次进度事件(去重后应严格递进)
    const uniqueSequence: RemoteStage[] = [];
    for (const s of stages) {
      if (uniqueSequence[uniqueSequence.length - 1] !== s) uniqueSequence.push(s);
    }
    expect(uniqueSequence).toEqual([
      'connecting',
      'deploying',
      'starting',
      'verifying',
      'ready',
    ]);
    // 恰好一次 ready,无重复
    expect(stages.filter((s) => s === 'ready')).toHaveLength(1);
    expect(routed.execDetached).toHaveBeenCalledTimes(1);
    const [cmd, stdin] = routed.execDetachedCalls[0] ? [routed.execDetachedCalls[0].cmd, routed.execDetachedCalls[0].stdin] : ['', ''];
    expect(cmd).toContain('--host-tag vps-hk');
    expect(cmd).toContain('--token-stdin');
    expect(stdin.length).toBeGreaterThan(0);
  });
});

describe('AC-13 认领驻留进程(不重启)', () => {
  it('T-028 驻留进程在 + storedToken 有效 → 走认领,不 execDetached', async () => {
    const configId = 'vps-hk';
    const routed = createRoutedSsh({
      execHandlers: healthyDefaults(),
      sftpReadFile: (p) => {
        if (p.endsWith('.ready')) return bufferOf('ok');
        if (p.endsWith('host.port')) return bufferOf({ port: 6000, pid: 321, hostTag: configId });
        return null;
      },
    });
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore, configId);
    h.credentials.setSecret(`hosttoken:${configId}`, 'preexisting-token');

    await h.orchestrator.connect(configId);

    const stages = h.events.map((e) => e.stage);
    expect(stages).toContain('claiming');
    expect(stages).not.toContain('deploying');
    expect(stages).not.toContain('starting');
    expect(routed.execDetached).not.toHaveBeenCalled();
    const claimingEvent = h.events.find((e) => e.stage === 'claiming');
    expect(claimingEvent?.fastPath).toBe(true);
  });
});

describe('AC-11 缺 node / node<20 中止,无半成品', () => {
  it('T-023 node 缺失(command not found)→ failed·nodeMissing', async () => {
    const routed = createRoutedSsh({
      execHandlers: [
        (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
        (cmd) => (cmd === 'node -v' ? { code: 127, stdout: '', stderr: 'command not found' } : null),
      ],
    });
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.find((e) => e.stage === 'failed');
    expect(failEvent?.reason).toBe('nodeMissing');
    expect(routed.sftpWriteDir).not.toHaveBeenCalled();
    expect(routed.execDetached).not.toHaveBeenCalled();
  });

  it('T-024 node18(< 20)→ failed·nodeMissing,无半成品', async () => {
    const routed = createRoutedSsh({
      execHandlers: [
        (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
        (cmd) => (cmd === 'node -v' ? { code: 0, stdout: 'v18.19.0\n', stderr: '' } : null),
      ],
    });
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.find((e) => e.stage === 'failed');
    expect(failEvent?.reason).toBe('nodeMissing');
    expect(routed.sftpWriteDir).not.toHaveBeenCalled();
  });
});

describe('AC-12 认证失败改配置重试 / 断开后手动重连', () => {
  it('T-025 首次 auth 失败 → 改配置重试 → 到 ready', async () => {
    let attempt = 0;
    const h = makeHarness({
      connectSshImpl: async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error('All configured authentication methods failed');
        }
        return createFreshDeploySsh('vps-hk');
      },
    });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('failed');
    expect(h.events.at(-1)?.reason).toBe('auth');

    // 用户「改正凭据」后重试(此处只关心状态机允许 failed→connecting 重入)
    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('ready');
    expect(attempt).toBe(2);
  });

  it('T-026 ready 后隧道断开 → disconnected → 手动重连至 ready', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('ready');

    // 模拟隧道断开:找到最近一次 forwardOut 返回的 server 并触发 close
    const forwardCalls = (routed.forwardOut as ReturnType<typeof vi.fn>).mock.results;
    const lastServer = forwardCalls.at(-1)?.value as unknown as { emit: (e: string) => void };
    lastServer.emit('close');

    expect(h.events.at(-1)?.stage).toBe('disconnected');

    // 手动重连
    const routed2 = createFreshDeploySsh('vps-hk');
    h.connectSsh.mockImplementationOnce(async () => routed2);
    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('ready');
  });
});

describe('AC-14 删除随删清凭据 + 活跃连接先断开', () => {
  it('T-030 ready 态删除:先 best-effort disconnect,再清配置+凭据', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);
    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('ready');

    await h.orchestrator.disconnect('vps-hk');
    h.configStore.delete('vps-hk');
    h.credentials.deleteAllForConfig('vps-hk');

    expect(h.events.at(-1)?.stage).toBe('disconnected');
    expect(h.configStore.list()).toEqual([]);
    expect(h.credentials.getSecret('hosttoken:vps-hk')).toBeNull();
  });
});

describe('ARCH-B3 in-flight guard', () => {
  it('并发 connect() 同一 configId 复用同一 Promise,不重复编排', async () => {
    let connectCalls = 0;
    const h = makeHarness({
      connectSshImpl: async () => {
        connectCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return createFreshDeploySsh('vps-hk');
      },
    });
    saveConfig(h.configStore);

    const [p1, p2] = [h.orchestrator.connect('vps-hk'), h.orchestrator.connect('vps-hk')];
    await Promise.all([p1, p2]);
    expect(connectCalls).toBe(1);
  });
});
