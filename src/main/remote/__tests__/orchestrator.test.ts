// AC-2/5/11/12/13/14 orchestrator 状态机 + in-flight guard + 失败分类 + 认领/重试/删除。
// 全部注入桩 connectSsh(DI · ARCH-B10),不 mock static,不触网。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RemoteHostOrchestrator, isLegalTransition } from '../orchestrator';
import { CredentialStore, HostConfigStore, type SafeStorageLike } from '../credentialStore';
import type { RemoteEvent, RemoteStage } from '../../../shared/remoteHost';
import { createRoutedSsh, bufferOf, flushMicrotasks, type RoutedSsh } from './testKit';

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
  startTimeoutMs?: number;
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
    ...(opts.startTimeoutMs !== undefined ? { startTimeoutMs: opts.startTimeoutMs } : {}),
  });
  orchestrator.onEvent((e) => events.push(e));
  return { orchestrator, configStore, credentials, events, probe, connectSsh };
}

function healthyDefaults() {
  return [
    (cmd: string) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
    (cmd: string) =>
      cmd.includes('command -v node')
        ? { code: 0, stdout: 'v20.11.0 /usr/bin/node\n', stderr: '' }
        : null,
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
    expect(cmd).toContain('--host-tag "vps-hk"');
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
  it('T-023 node 缺失(探测无任何候选)→ failed·nodeMissing', async () => {
    const routed = createRoutedSsh({
      execHandlers: [
        (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
        (cmd) => (cmd.includes('command -v node') ? { code: 0, stdout: '', stderr: '' } : null),
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

  it('T-024 node18(< 20)→ failed·nodeMissing,detail 携带实测版本与路径,无半成品', async () => {
    const routed = createRoutedSsh({
      execHandlers: [
        (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
        (cmd) =>
          cmd.includes('command -v node')
            ? { code: 0, stdout: 'v18.19.0 /usr/bin/node\n', stderr: '' }
            : null,
      ],
    });
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.find((e) => e.stage === 'failed');
    expect(failEvent?.reason).toBe('nodeMissing');
    // 「装了但过旧」与「没装」文案分离:detail 报实测版本 + 路径,不误导用户去重装
    expect(failEvent?.detail).toContain('v18.19.0');
    expect(failEvent?.detail).toContain('/usr/bin/node');
    expect(routed.sftpWriteDir).not.toHaveBeenCalled();
  });

  it('多候选(PATH v18 + nvm v20)→ 选最高 major 到 ready,启动命令引用选中绝对路径', async () => {
    const nvmNode = '/home/tester/.nvm/versions/node/v20.11.0/bin/node';
    let started = false;
    const routed = createRoutedSsh({
      execHandlers: [
        (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
        (cmd) =>
          cmd.includes('command -v node')
            ? { code: 0, stdout: `v18.19.0 /usr/bin/node\nv20.11.0 ${nvmNode}\n`, stderr: '' }
            : null,
        (cmd) => (cmd === 'uname -sm' ? { code: 0, stdout: 'Darwin arm64\n', stderr: '' } : null),
      ],
      sftpReadFile: (p) => {
        if (p.endsWith('host.port')) {
          return started ? bufferOf({ port: 5555, pid: 4242, hostTag: 'vps-hk' }) : null;
        }
        return null; // 无既有 bundle → 走首次部署
      },
    });
    const originalExecDetached = routed.execDetached;
    routed.execDetached = vi.fn(async (cmd: string, stdin: string) => {
      started = true;
      return originalExecDetached(cmd, stdin);
    });
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    // PATH 里的 v18 不应导致误拒:nodeMissing 不出现,流程走到 ready
    expect(h.events.find((e) => e.reason === 'nodeMissing')).toBeUndefined();
    expect(h.events.at(-1)?.stage).toBe('ready');
    // 启动命令必须引用选中的 nvm 绝对路径(非裸 node),且带 setsid 降级前缀
    const startCmd = (routed.execDetached as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(startCmd).toContain(`"${nvmNode}"`);
    expect(startCmd).toContain('command -v setsid');
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

  it('🔴 陈旧 ready 自愈:ready 态再次 connect() 不再静默 no-op——等价 disconnect-first 重建至 ready', async () => {
    // 场景:WS 已死但 main 无感知(无隧道 close 事件),renderer 已 drop 显示「未连接」,
    // 用户点 Connect。旧行为命中 ACTIVE 守卫 no-op → 点了永远没反应。
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('ready');
    const eventsBefore = h.events.length;

    const routed2 = createFreshDeploySsh('vps-hk');
    h.connectSsh.mockImplementationOnce(async () => routed2);
    await h.orchestrator.connect('vps-hk');

    const seq = h.events.slice(eventsBefore).map((e) => e.stage);
    expect(seq[0]).toBe('disconnected'); // disconnect-first 复位
    expect(seq.at(-1)).toBe('ready'); // 隧道重建成功
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

  it('🔴 A4/E3 回归:connect() 命中在途 test() 时,等待其结束后仍真正进入编排(连接意图不被静默丢弃)', async () => {
    let resolveTest!: () => void;
    let testStarted = false;
    let connectRan = false;
    const h = makeHarness({
      connectSshImpl: async () => {
        if (!testStarted) {
          // 第一次调用属于 test():卡住直到测试显式放行,验证 connect() 确实在等它
          testStarted = true;
          await new Promise<void>((resolve) => {
            resolveTest = resolve;
          });
          return createRoutedSsh({ execHandlers: healthyDefaults() });
        }
        connectRan = true;
        return createFreshDeploySsh('vps-hk');
      },
    });
    saveConfig(h.configStore);

    const testPromise = h.orchestrator.test('vps-hk');
    // test() 的实际执行经 mutex 链的 .then() 调度(微任务),不是同步发生的——
    // 先让微任务队列跑一轮,确保 connectSshImpl 真的已经进入「卡住」分支并捕获
    // 到 resolveTest,再发起 connect()。
    await flushMicrotasks();
    expect(testStarted).toBe(true);
    const connectPromise = h.orchestrator.connect('vps-hk');

    // 放行 test() 的 connectSsh
    resolveTest();
    await testPromise;
    await connectPromise;

    // 关键断言:connect() 真正跑了自己的 runConnect(不是复用/丢弃 test 的 promise)
    expect(connectRan).toBe(true);
    expect(h.events.at(-1)?.stage).toBe('ready');
  });

  it('🔴 A4/E3 回归:test() 命中在途 connect() 时,等其结束后仍真正跑自己的探测(不复用 connect 的结果)', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    let testConnectSshCalls = 0;
    const h = makeHarness({
      connectSshImpl: async () => {
        testConnectSshCalls++;
        if (testConnectSshCalls === 1) return routed; // connect() 的调用
        return createRoutedSsh({ execHandlers: healthyDefaults() }); // test() 的调用
      },
    });
    saveConfig(h.configStore);

    const connectPromise = h.orchestrator.connect('vps-hk');
    const testPromise = h.orchestrator.test('vps-hk');

    const [, testResult] = await Promise.all([connectPromise, testPromise]);
    // test() 必须真正发起了自己的 connectSsh 调用(第 2 次),而非直接复用 connect 的结果
    expect(testConnectSshCalls).toBe(2);
    expect(testResult).toEqual({ ok: true });
  });
});

describe('AC-6 版本不兼容 → failed·incompatible + 断开(main 前移探测 · Q1/A14)', () => {
  it('probe 探测跑通但 compatible:false(真·版本不符)→ 状态落 failed·incompatible,tunnel/ssh 均已关闭', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({
      connectSshImpl: async () => routed,
      probeImpl: async () => ({ ok: true, compatible: false, detail: 'PROTOCOL_INCOMPATIBLE' }),
    });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.at(-1);
    expect(failEvent?.stage).toBe('failed');
    expect(failEvent?.reason).toBe('incompatible');
    expect(routed.close).toHaveBeenCalled();
    // 建过的隧道 server 必须已被关闭(不留悬挂本地转发端口)
    const forwardResults = (routed.forwardOut as ReturnType<typeof vi.fn>).mock.results;
    const lastServer = forwardResults.at(-1)?.value as unknown as { closed: boolean };
    expect(lastServer.closed).toBe(true);
  });

  it('🔴 A14 回归:probe 探测本身没跑通(!ok,瞬时传输失败)→ 状态落 failed·startFailed(非 incompatible),可重试', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({
      connectSshImpl: async () => routed,
      // 首装后的 verifying 探测瞬时失败(隧道时序/超时/被关等)——刚部署成功的
      // host 不该被误报「版本不兼容·请升级」
      probeImpl: async () => ({ ok: false, detail: 'probe timeout' }),
    });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.at(-1);
    expect(failEvent?.stage).toBe('failed');
    expect(failEvent?.reason).toBe('startFailed');
    expect(failEvent?.reason).not.toBe('incompatible');
    expect(routed.close).toHaveBeenCalled();
    const forwardResults = (routed.forwardOut as ReturnType<typeof vi.fn>).mock.results;
    const lastServer = forwardResults.at(-1)?.value as unknown as { closed: boolean };
    expect(lastServer.closed).toBe(true);
  });
});

describe('startFailed·port 文件超时 → detail 拼入远端 host.log 尾部', () => {
  it('host 启动即崩(端口文件永不出现)时,failed 事件 detail 携带 host.log 崩因', async () => {
    // 真实案例:token 经 `后台进程 < /dev/stdin &` 注入在高 RTT 远端必丢,
    // host fail-closed 拒启,崩因只落在 host.log —— UI 必须能看到它。
    const ssh = createRoutedSsh({
      execHandlers: healthyDefaults(),
      sftpReadFile: (p) => {
        if (p.endsWith('host.log')) {
          return Buffer.from(
            '[host] refusing empty token from --token-stdin: blank/whitespace-only token\n',
            'utf8',
          );
        }
        return null; // .ready 缺 → 走部署;host.port 永不出现 → 超时
      },
    });
    const h = makeHarness({ connectSshImpl: async () => ssh, startTimeoutMs: 0 });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.at(-1);
    expect(failEvent?.stage).toBe('failed');
    expect(failEvent?.reason).toBe('startFailed');
    expect(failEvent?.detail).toContain('port file did not appear before timeout');
    expect(failEvent?.detail).toContain('refusing empty token');
    expect(ssh.close).toHaveBeenCalled();
  });

  it('host.log 也不存在(sftp 读回 null)时,detail 维持超时主因,不额外拼接', async () => {
    const ssh = createRoutedSsh({
      execHandlers: healthyDefaults(),
      sftpReadFile: () => null,
    });
    const h = makeHarness({ connectSshImpl: async () => ssh, startTimeoutMs: 0 });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');

    const failEvent = h.events.at(-1);
    expect(failEvent?.stage).toBe('failed');
    expect(failEvent?.reason).toBe('startFailed');
    expect(failEvent?.detail).toBe('port file did not appear before timeout');
  });
});

describe('🔴 A2 SSH 断链检测(AC-12 缺口修复)', () => {
  it('ready 后底层 ssh 连接层 close(非本地转发 server 主动关)→ 探测到并转 disconnected', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');
    expect(h.events.at(-1)?.stage).toBe('ready');

    // 模拟远端网络中断:底层 ssh2 Client 触发 close,而非本地 net.Server 自己出错
    routed.simulateSshClose();

    expect(h.events.at(-1)?.stage).toBe('disconnected');
  });

  it('主动 disconnect() 触发的 ssh close 不产生重复/多余的 disconnected 事件', async () => {
    const routed = createFreshDeploySsh('vps-hk');
    const h = makeHarness({ connectSshImpl: async () => routed });
    saveConfig(h.configStore);

    await h.orchestrator.connect('vps-hk');
    await h.orchestrator.disconnect('vps-hk');
    const disconnectedCount = h.events.filter((e) => e.stage === 'disconnected').length;

    // disconnect() 内部会 close ssh(间接触发 onClose 回调)——但此时 stage 已经
    // 不是 ready/verifying,守卫应吞掉重复回调,不重复 emit
    routed.simulateSshClose();
    expect(h.events.filter((e) => e.stage === 'disconnected').length).toBe(disconnectedCount);
  });
});

describe('🔴 E9 disconnect() 有界超时,不长阻塞', () => {
  it('在途编排卡住时,disconnect() 仍在有界时间内返回(不会等满整个编排)', async () => {
    // 🔴 关键:不覆盖 sleep(不像 makeHarness 默认那样注入「瞬时 resolve」的桩)——
    // 用真实定时器,才能真正验证 disconnect() 内部超时用的是有界的具体时长
    // (实现常量 DISCONNECT_WAIT_TIMEOUT_MS=5s),而不只是「存在某个 race」。
    const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
    const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage: makeSafeStorage() });
    const orchestrator = new RemoteHostOrchestrator({
      connectSsh: async () => new Promise(() => {}), // 永不 resolve,模拟网络黑洞
      credentials,
      configStore,
      bundleDir: () => '/local/bundle/darwin-arm64',
      appVersion: '1.0.0',
    });
    saveConfig(configStore);

    const connectPromise = orchestrator.connect('vps-hk');
    void connectPromise.catch(() => undefined);

    const start = Date.now();
    await orchestrator.disconnect('vps-hk');
    const elapsed = Date.now() - start;
    // 有界在实现常量(5s)附近,远小于「永不 resolve」的无穷等待
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(9_000);
  }, 15_000);
});
