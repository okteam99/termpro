// 🔴 P0 · ARCH-B8 · 认领-或-确定性回收决策表(TC.md §2 六分支穷举)。
// decideResidency 是纯函数;两条安全守门断言必须真实成立:
//   T-034「兄弟永不误杀」——决策中 kill 从不出现
//   T-033「token 陈旧不 livelock」——probe 失败后同栈转 reap/deploy,非再次 claim
import { describe, it, expect } from 'vitest';
import type { HostInfo } from '../../../shared/protocol';
import { cmdlineMatchesHostTag, decideResidency, resolveResidency } from '../residency';
import { createRoutedSsh, bufferOf, FakeServer, asNetServer } from './testKit';

const CONFIG_ID = 'vps-hk';

/** probe ok 时的 hostInfo 桩:appVersion 是认领版本门闸的判定源(用户规则 2026-07-13);
 *  省略 appVersion = 现网旧版 host(未上报该字段 → 视为过旧)。 */
function hostInfoOf(appVersion?: string): HostInfo {
  return {
    hostId: 'remote',
    protocolVersion: 1,
    platform: 'linux',
    homedir: '/home/tester',
    shell: '/bin/bash',
    ...(appVersion ? { appVersion } : {}),
  };
}

describe('AC-13/AC-4/AC-8 residency 决策表(纯函数)', () => {
  it('T-032 claim 命中:portRaw 有效+token 非空+probe 通过+版本不过旧', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: true,
      probeResult: { ok: true, compatible: true, hostOutdated: false },
      killAliveResult: null,
      cmdlineResult: null,
    });
    expect(decision).toEqual({ action: 'claim', kill: false, cleanStale: false });
  });

  it('T-033 候选 host 活着但 probe 不可达(瞬时抖动)→ abortLiveUnreachable,绝不 kill(护在跑会话)', () => {
    // 🔴 2026-07-15 事故修复:候选(portRaw+token)+ 活体 + cmdline 属本 tag,但 probe
    // 非 ok(不可达)——这是传输问题不是坏 host,绝不 reap(reap 会连同 PTY 里在跑的
    // codex/agent 一起毙掉)。放弃本次、不杀不清,host 存活待下次隧道稳后 claim。
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stale-token',
      bundleReady: true,
      probeResult: { ok: false },
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
    });
    expect(decision).toEqual({ action: 'abortLiveUnreachable', kill: false, cleanStale: false });
  });

  it('T-034 兄弟存活但 tag 不符 → cleanStaleThenDeploy,kill 从未出现', () => {
    const siblingCmdlines = [
      // 兄弟 host:含别的 --host-tag
      `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag vps-other`,
      // 无关进程:压根没有 --host-tag
      `node some-unrelated-script.js`,
      // 前缀碰撞(精确匹配非 substring):tag 值恰好是本 configId 的前缀
      `node host.js --token-stdin --host-tag ${CONFIG_ID}-extra`,
    ];
    for (const cmdline of siblingCmdlines) {
      const decision = decideResidency({
        configId: CONFIG_ID,
        portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
        storedToken: null,
        bundleReady: true,
        probeResult: null,
        killAliveResult: true,
        cmdlineResult: cmdline,
      });
      expect(decision.action).toBe('cleanStaleThenDeploy');
      expect(decision.kill).toBe(false);
    }
  });

  it('T-035 reap 放行:alive 且 cmdline 精确含本 configId 的 --host-tag', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 555, hostTag: CONFIG_ID },
      storedToken: null,
      bundleReady: true,
      probeResult: null,
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
    });
    expect(decision).toEqual({ action: 'reapThenDeploy', kill: true, cleanStale: true });
  });

  it('T-036 pid 已死 → 仅清陈旧,不 kill', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 555, hostTag: CONFIG_ID },
      storedToken: 'x',
      bundleReady: true,
      probeResult: { ok: false },
      killAliveResult: false,
      cmdlineResult: null,
    });
    expect(decision).toEqual({ action: 'cleanStaleThenDeploy', kill: false, cleanStale: true });
  });

  it('T-037 无 bundle(无论端口文件如何)→ freshDeploy', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: null,
      storedToken: null,
      bundleReady: false,
      probeResult: null,
      killAliveResult: null,
      cmdlineResult: null,
    });
    expect(decision).toEqual({ action: 'freshDeploy', kill: false, cleanStale: false });
  });

  it('T-038 活 host 协议兼容但版本过旧 → reapThenDeploy(连接时升级服务端 · 2026-07-13)', () => {
    // 🔴 用户规则 2026-07-13(反转旧规则):协议兼容不再是收养的充分条件——host
    // appVersion 低于客户端(或未上报)即视为过旧,连接时先升级服务端,在跑任务可关闭。
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: false,
      probeResult: { ok: true, compatible: true, hostOutdated: true },
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
    });
    expect(decision).toEqual({ action: 'reapThenDeploy', kill: true, cleanStale: true });
  });

  it('T-038b 客户端升级(bundleReady=false)+ 活 host 版本不过旧 → 仍 claim(只升不降)', () => {
    // host 版本 ≥ 客户端(如另一同版/新版设备刚升级过服务端)→ 收养,不部署不重启;
    // bundleReady 仍不是候选门槛(按客户端当前版本判定,升级后必 false)。
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: false,
      probeResult: { ok: true, compatible: true, hostOutdated: false },
      killAliveResult: null,
      cmdlineResult: null,
    });
    expect(decision).toEqual({ action: 'claim', kill: false, cleanStale: false });
  });

  it('T-039 活 host 协议【不】兼容(低于最低兼容版本)→ reapThenDeploy,才允许升级服务端', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: false,
      probeResult: { ok: true, compatible: false },
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
    });
    expect(decision).toEqual({ action: 'reapThenDeploy', kill: true, cleanStale: true });
  });

  it('🔴 T-040 forceRedeploy + 本可 claim 的完美候选(portRaw+token+probe ok+版本不过旧)+ alive + tag 匹配 → reapThenDeploy(kill=true)', () => {
    // 用户显式升级(Remote Hosts「Update」):candidateEligible 因 forceRedeploy 整体作废,
    // 即使换个 forceRedeploy:false 本会 claim 的完美候选,也必须落回收分支——活着且
    // cmdline 属本 tag → reapThenDeploy,kill 安全性质②③不受影响。
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: true,
      probeResult: { ok: true, compatible: true, hostOutdated: false },
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
      forceRedeploy: true,
    });
    expect(decision).toEqual({ action: 'reapThenDeploy', kill: true, cleanStale: true });
  });

  it('🔴 T-041 forceRedeploy + probe 失败 + alive + tag 匹配 → reapThenDeploy(证明 abortLiveUnreachable 在 force 下不可达)', () => {
    // 若不置 forceRedeploy,同样的输入(candidateEligible 成立 + tagMatches + probe 非 ok)
    // 会落 T-033 的 abortLiveUnreachable(护在跑会话)。force 置位后 candidateEligible
    // 整体作废,该分支的前置条件不再成立,直接落 2 的 reapThenDeploy——用户已明确要求
    // 升级,愿意接受在跑任务被关闭。
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stale-token',
      bundleReady: true,
      probeResult: { ok: false },
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
      forceRedeploy: true,
    });
    expect(decision).toEqual({ action: 'reapThenDeploy', kill: true, cleanStale: true });
  });

  it('🔴 T-042 forceRedeploy + alive 但 cmdline 是兄弟(tag 不符)→ cleanStaleThenDeploy 且 kill=false(安全性质②在 force 下不放宽)', () => {
    // force 只放宽「要不要换」,从不放宽「能不能杀」——兄弟/无关进程依然永不 kill,
    // 即使用户点了「升级服务端」也一样。
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: true,
      probeResult: null,
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag vps-other`,
      forceRedeploy: true,
    });
    expect(decision).toEqual({ action: 'cleanStaleThenDeploy', kill: false, cleanStale: true });
  });

  it('🔴 T-043 forceRedeploy + pid 已死 → cleanStaleThenDeploy,kill=false', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 555, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: true,
      probeResult: null,
      killAliveResult: false,
      cmdlineResult: null,
      forceRedeploy: true,
    });
    expect(decision).toEqual({ action: 'cleanStaleThenDeploy', kill: false, cleanStale: true });
  });

  it('cmdlineMatchesHostTag:darwin 空格分隔 / linux NUL 分隔均可解析', () => {
    expect(cmdlineMatchesHostTag('node host.js --host-tag abc', 'abc')).toBe(true);
    expect(cmdlineMatchesHostTag('node\0host.js\0--host-tag\0abc', 'abc')).toBe(true);
    expect(cmdlineMatchesHostTag('node host.js --host-tag abcd', 'abc')).toBe(false);
    expect(cmdlineMatchesHostTag(null, 'abc')).toBe(false);
    expect(cmdlineMatchesHostTag('node host.js', 'abc')).toBe(false);
  });
});

describe('resolveResidency 执行编排(注入 ssh 桩)', () => {
  it('claim 路径:建隧道 + main 探测通过 → 返回 claimed,不做任何 kill/清理 exec', async () => {
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5000, pid: 111, hostTag: CONFIG_ID });
        }
        return null;
      },
    });
    const server = new FakeServer(41234);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'good-token',
      probeHostInfo: async () => ({ ok: true, compatible: true, hostInfo: hostInfoOf('1.0.0') }),
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 41234 }),
    });
    expect(resolution.decision.action).toBe('claim');
    expect(resolution.claimed?.tunnel.localPort).toBe(41234);
    // 认领分支不应执行 kill 或 rm 陈旧文件
    expect(ssh.execCalls.some((c) => c.startsWith('kill'))).toBe(false);
    expect(ssh.execCalls.some((c) => c.includes('rm -f'))).toBe(false);
  });

  it('T-038e .ready 缺失 + 活 host 低于客户端但 ≥ 最低依赖版本 → 仍 claim,零 kill/rm/部署', async () => {
    // 🔴 用户规则 2026-07-13 精确语义:门闸基准是【客户端依赖的最低服务端版本】
    // (minHostAppVersion/HOST_MIN_APP_VERSION),不是客户端自身版本——host 1.5.0 <
    // 客户端 2.0.0 但 ≥ 最低依赖 1.0.0,满足依赖就收养,不为小版本差杀 session。
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return null;
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5300, pid: 777, hostTag: CONFIG_ID });
        }
        return null;
      },
    });
    const server = new FakeServer(46001);
    let probeCalls = 0;
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '2.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'good-token',
      probeHostInfo: async () => {
        probeCalls++;
        return { ok: true, compatible: true, hostInfo: hostInfoOf('1.5.0') };
      },
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 46001 }),
    });
    expect(probeCalls).toBeGreaterThan(0);
    expect(resolution.decision.action).toBe('claim');
    expect(resolution.claimed?.tunnel.localPort).toBe(46001);
    expect(ssh.execCalls.some((c) => c.startsWith('kill'))).toBe(false);
    expect(ssh.execCalls.some((c) => c.includes('rm -f'))).toBe(false);
  });

  it('🔴 T-038g 活 host 协议兼容但低于最低依赖版本(未上报 appVersion 的现网旧 host)→ reapThenDeploy 升级服务端', async () => {
    // 用户规则 2026-07-13 的主场景:旧版 host 一直被收养导致服务端永不升级——
    // probe 跑通、协议兼容,但 hostInfo 无 appVersion → 低于任何最低依赖 → 过旧,
    // kill 在跑 host + 清端口文件,交由 orchestrator 部署新版并重启。
    let killSent = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return null; // 新版 bundle 未部署
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5600, pid: 990, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.startsWith('kill "990"')) {
            killSent = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
        (cmd) =>
          cmd.startsWith('kill -0 "990"')
            ? { code: 0, stdout: killSent ? 'N\n' : 'Y\n', stderr: '' }
            : null,
        (cmd) =>
          cmd.includes('/proc/990/cmdline') || cmd.includes('-p "990"')
            ? { code: 0, stdout: `node host.js --host-tag ${CONFIG_ID}`, stderr: '' }
            : null,
      ],
    });
    const candidateServer = new FakeServer(46003);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '2.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'good-token',
      probeHostInfo: async () => ({ ok: true, compatible: true, hostInfo: hostInfoOf() }),
      buildTunnel: async () => ({ server: asNetServer(candidateServer), localPort: 46003 }),
      sleep: async () => undefined,
    });
    expect(resolution.decision.action).toBe('reapThenDeploy');
    expect(candidateServer.closed).toBe(true);
    expect(ssh.execCalls.some((c) => c.startsWith('kill ') && c.includes('990'))).toBe(true);
    expect(ssh.execCalls.some((c) => c.includes('rm -f') && c.includes('host.port'))).toBe(true);
  });

  it('🔴 T-044 resolveResidency:forceRedeploy + 活体可 claim host 场景 → buildTunnel/probeHostInfo 零调用,attemptedClaim=false,reapThenDeploy 执行 kill+清端口文件', async () => {
    // 🔴 用户显式升级(Remote Hosts「Update」按钮):即使 host.port/token 齐全、探测本会
    // 通过——force 置位后整段候选探测(建隧道 + main 探测)必须完全不跑(省 10s 级探测
    // 超时,决策已注定非 claim),ARCH-B1 的 claim-would-succeed 短路同样必须失效。
    let killSent = false;
    let tunnelCalls = 0;
    let probeCalls = 0;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5700, pid: 991, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.startsWith('kill "991"')) {
            killSent = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
        (cmd) =>
          cmd.startsWith('kill -0 "991"')
            ? { code: 0, stdout: killSent ? 'N\n' : 'Y\n', stderr: '' }
            : null,
        (cmd) =>
          cmd.includes('/proc/991/cmdline') || cmd.includes('-p "991"')
            ? { code: 0, stdout: `node host.js --host-tag ${CONFIG_ID}`, stderr: '' }
            : null,
      ],
    });
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'good-token',
      forceRedeploy: true,
      probeHostInfo: async () => {
        probeCalls++;
        return { ok: true, compatible: true, hostInfo: hostInfoOf('1.0.0') };
      },
      buildTunnel: async () => {
        tunnelCalls++;
        return { server: asNetServer(new FakeServer(46010)), localPort: 46010 };
      },
      sleep: async () => undefined,
    });
    expect(tunnelCalls).toBe(0); // 不建候选隧道
    expect(probeCalls).toBe(0); // 不探测
    expect(resolution.attemptedClaim).toBe(false);
    expect(resolution.decision.action).toBe('reapThenDeploy');
    expect(ssh.execCalls.some((c) => c.startsWith('kill "991"'))).toBe(true);
    expect(ssh.execCalls.some((c) => c.includes('rm -f') && c.includes('host.port'))).toBe(true);
  });

  it('T-038f 升级场景 + probe 失败但 host 活体属本 tag → abortLiveUnreachable:关候选隧道但不 kill/不清', async () => {
    // 🔴 2026-07-15 事故修复:bundleReady=false 的候选路径上 probe 失败(不可达)——只要
    // 活体 cmdline 属本 tag,就绝不 reap(护在跑会话);仅关掉本次为探测建的候选隧道,
    // 不 kill、不 rm host.port。host 存活待下次隧道稳后 claim 挂回。
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return null; // 新版 bundle 未部署
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5400, pid: 888, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) =>
          cmd.startsWith('kill -0 "888"') ? { code: 0, stdout: 'Y\n', stderr: '' } : null,
        (cmd) =>
          cmd.includes('/proc/888/cmdline') || cmd.includes('-p "888"')
            ? { code: 0, stdout: `node host.js --host-tag ${CONFIG_ID}`, stderr: '' }
            : null,
      ],
    });
    const candidateServer = new FakeServer(46002);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '2.0.0',
      storedToken: 'stale-token',
      probeHostInfo: async () => ({ ok: false, detail: 'token mismatch' }),
      buildTunnel: async () => ({ server: asNetServer(candidateServer), localPort: 46002 }),
      sleep: async () => undefined,
    });
    expect(resolution.decision.action).toBe('abortLiveUnreachable');
    expect(candidateServer.closed).toBe(true); // 候选隧道仍关(不 livelock)
    expect(ssh.execCalls.some((c) => c.startsWith('kill "888"'))).toBe(false); // 绝不 kill 活 host
    expect(ssh.execCalls.some((c) => c.includes('rm -f') && c.includes('host.port'))).toBe(false);
  });

  it('probe 失败但 host 活体属本 tag → 关候选隧道 + abortLiveUnreachable(不 kill,护会话)', async () => {
    // 🔴 2026-07-15 事故修复:活体属本 tag + probe 不可达 → 不 reap;仅关候选隧道(不 livelock)。
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5000, pid: 222, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) =>
          cmd.startsWith('kill -0 "222"') ? { code: 0, stdout: 'Y\n', stderr: '' } : null,
        (cmd) =>
          cmd.includes('/proc/222/cmdline') || cmd.includes('-p "222"')
            ? { code: 0, stdout: `node host.js --host-tag ${CONFIG_ID}`, stderr: '' }
            : null,
      ],
    });
    const candidateServer = new FakeServer(42111);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      storedToken: 'stale-token',
      probeHostInfo: async () => ({ ok: false, detail: 'token mismatch' }),
      buildTunnel: async () => ({ server: asNetServer(candidateServer), localPort: 42111 }),
      sleep: async () => undefined,
    });
    expect(resolution.decision.action).toBe('abortLiveUnreachable');
    expect(candidateServer.closed).toBe(true);
    expect(ssh.execCalls.some((c) => c.startsWith('kill "222"'))).toBe(false);
    expect(ssh.execCalls.some((c) => c.includes('rm -f') && c.includes('host.port'))).toBe(false);
  });

  it('无 bundle → freshDeploy,从不建候选隧道/探测', async () => {
    const ssh = createRoutedSsh({ sftpReadFile: () => null });
    let tunnelCalls = 0;
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      storedToken: null,
      probeHostInfo: async () => {
        throw new Error('should not probe when no bundle/portRaw');
      },
      buildTunnel: async () => {
        tunnelCalls++;
        return { server: asNetServer(new FakeServer()), localPort: 1 };
      },
    });
    expect(resolution.decision.action).toBe('freshDeploy');
    expect(tunnelCalls).toBe(0);
  });

  it('🔴 EXT-B-2:claim 探测瞬时失败一次后重试成功 → 仍走 claim,不 kill/不 reap', async () => {
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5100, pid: 333, hostTag: CONFIG_ID });
        }
        return null;
      },
    });
    const server = new FakeServer(45001);
    let probeCalls = 0;
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'good-token',
      probeHostInfo: async () => {
        probeCalls++;
        if (probeCalls === 1) return { ok: false, detail: 'transient network hiccup' };
        return { ok: true, compatible: true, hostInfo: hostInfoOf('1.0.0') };
      },
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 45001 }),
      sleep: async () => undefined,
    });
    expect(probeCalls).toBe(2);
    expect(resolution.decision.action).toBe('claim');
    expect(resolution.claimed?.tunnel.localPort).toBe(45001);
    // 重试后成功不该有任何 kill/清陈旧 exec(区别于「最终失败落 reap」的路径)
    expect(ssh.execCalls.some((c) => c.startsWith('kill'))).toBe(false);
    expect(ssh.execCalls.some((c) => c.includes('rm -f'))).toBe(false);
  });

  it('🔴 EXT-B-2 + 事故修复:探测耗尽重试预算仍失败,但 host 活体属本 tag → abortLiveUnreachable(不 kill)', async () => {
    // 🔴 2026-07-15 事故修复:此前「持续失败 → reapThenDeploy」会在跨境隧道抖动时把正在
    // 跑 codex 的活 host 杀掉。改为:仍跑满重试预算(不无限重试),但最终判定【不可达】而非
    // 【坏 host】——绝不 reap 活体,放弃本次让上层稍后重试(隧道稳则 claim 挂回,会话存活)。
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5200, pid: 444, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) =>
          cmd.startsWith('kill -0 "444"') ? { code: 0, stdout: 'Y\n', stderr: '' } : null,
        (cmd) =>
          cmd.includes('/proc/444/cmdline') || cmd.includes('-p "444"')
            ? { code: 0, stdout: `node host.js --host-tag ${CONFIG_ID}`, stderr: '' }
            : null,
      ],
    });
    const server = new FakeServer(45002);
    let probeCalls = 0;
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      storedToken: 'good-token',
      probeHostInfo: async () => {
        probeCalls++;
        return { ok: false, detail: 'persistent failure' };
      },
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 45002 }),
      sleep: async () => undefined,
    });
    // 默认 OKWORK_CLAIM_PROBE_RETRIES=3(不含首次)→ 共 4 次尝试后才判定失败(重试预算不变)
    expect(probeCalls).toBe(4);
    expect(resolution.decision.action).toBe('abortLiveUnreachable');
    expect(server.closed).toBe(true); // 候选隧道关闭
    expect(ssh.execCalls.some((c) => c.startsWith('kill "444"'))).toBe(false); // 绝不杀活 host
  });

  it('Phase 2:服务端身份 token 覆盖本地陈旧缓存 → 用 server token 探测并 claim', async () => {
    const probeTokens: string[] = [];
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5500, pid: 900, hostTag: CONFIG_ID });
        }
        if (path.endsWith('/identity/tag-x/token')) return Buffer.from('server-tok\n', 'utf8');
        return null;
      },
    });
    const server = new FakeServer(47001);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      identityTokenPath: '/home/tester/.termpro-host/identity/tag-x/token',
      appVersion: '1.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'stale-local-token',
      probeHostInfo: async (_port, token) => {
        probeTokens.push(token);
        return { ok: true, compatible: true, hostInfo: hostInfoOf('1.0.0') };
      },
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 47001 }),
    });
    expect(probeTokens).toEqual(['server-tok']); // trim 后的服务端 token,非本地陈旧值
    expect(resolution.decision.action).toBe('claim');
    expect(resolution.effectiveToken).toBe('server-tok');
  });

  it('Phase 2:身份文件缺失 → 回落本地 storedToken(旧 host/崩溃残局,probe 兜底)', async () => {
    const probeTokens: string[] = [];
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5501, pid: 901, hostTag: CONFIG_ID });
        }
        return null; // 身份文件不存在
      },
    });
    const server = new FakeServer(47002);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      identityTokenPath: '/home/tester/.termpro-host/identity/tag-x/token',
      appVersion: '1.0.0',
      minHostAppVersion: '1.0.0',
      storedToken: 'local-cache-token',
      probeHostInfo: async (_port, token) => {
        probeTokens.push(token);
        return { ok: true, compatible: true, hostInfo: hostInfoOf('1.0.0') };
      },
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 47002 }),
    });
    expect(probeTokens).toEqual(['local-cache-token']);
    expect(resolution.effectiveToken).toBe('local-cache-token');
  });

  it('Phase 2:端口文件不存在 → 不读身份文件(读序钉死在端口文件之后)', async () => {
    const readPaths: string[] = [];
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        readPaths.push(path);
        return null;
      },
    });
    await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      identityTokenPath: '/home/tester/.termpro-host/identity/tag-x/token',
      appVersion: '1.0.0',
      storedToken: null,
      probeHostInfo: async () => ({ ok: false }),
      buildTunnel: async () => {
        throw new Error('no candidate, no tunnel');
      },
    });
    expect(readPaths.some((p) => p.includes('/identity/'))).toBe(false);
  });

  it('🔴 E7 回归:probeHostInfo 违反契约抛出(而非返回 {ok:false})→ 候选隧道仍被关闭,不泄漏', async () => {
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 4999, pid: 111, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        // 死 pid(kill -0 失败)→ 落 cleanStaleThenDeploy,不涉及 kill,行为可预测
        (cmd) => (cmd.includes('kill -0') ? { code: 0, stdout: 'N\n', stderr: '' } : null),
      ],
    });
    const candidateServer = new FakeServer(43000);
    const resolution = await resolveResidency({
      ssh,
      dataDir: '/home/tester/.termpro-host',
      configId: CONFIG_ID,
      appVersion: '1.0.0',
      storedToken: 'some-token',
      probeHostInfo: async () => {
        throw new Error('network hiccup mid-probe');
      },
      buildTunnel: async () => ({ server: asNetServer(candidateServer), localPort: 43000 }),
      sleep: async () => undefined,
    });

    // 探测异常应被归一为「探测失败」,继续走确定性回收(不 livelock、不让异常冒泡炸掉整个 connect())
    expect(resolution.decision.action).toBe('cleanStaleThenDeploy');
    // 关键断言:候选隧道必须已关闭,不泄漏 net.Server
    expect(candidateServer.closed).toBe(true);
  });

  it('🔴 评审 P2 回归:候选隧道建成后,kill-alive 探测的 ssh.exec 抛出 → resolveResidency reject 且候选隧道仍被关闭', async () => {
    // 🔴 与 E7 同族但不同触发点:E7 是 probeHostInfo 本身违反契约抛出(已被归一吞掉,
    // 继续走确定性回收);这里是 claim 判定已落定「非 claim」之后,下一步 kill -0 探测的
    // ssh.exec 本身抛出(如连接在此刻被作废/断线)——此前该异常会让 resolveResidency
    // 直接 reject,下方「未认领关隧道」永不执行,调用方只 close ssh,候选隧道监听口常驻。
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5800, pid: 321, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.startsWith('kill -0 "321"')) {
            throw new Error('ssh channel closed mid-probe');
          }
          return null;
        },
      ],
    });
    const candidateServer = new FakeServer(46020);
    await expect(
      resolveResidency({
        ssh,
        dataDir: '/home/tester/.termpro-host',
        configId: CONFIG_ID,
        appVersion: '1.0.0',
        minHostAppVersion: '1.0.0',
        storedToken: 'stale-token',
        // probe 未通过(非 claim)→ 才会走到下方 kill -0 探测分支
        probeHostInfo: async () => ({ ok: false, detail: 'unreachable' }),
        buildTunnel: async () => ({ server: asNetServer(candidateServer), localPort: 46020 }),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('ssh channel closed mid-probe');
    expect(candidateServer.closed).toBe(true); // 候选隧道仍被关闭,不泄漏监听口
  });
});
