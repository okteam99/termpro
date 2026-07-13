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

  it('T-033 token 陈旧(probe 失败)→ 同栈 reap+deploy,不 livelock', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stale-token',
      bundleReady: true,
      probeResult: { ok: false },
      killAliveResult: true,
      cmdlineResult: `node host.js --listen 127.0.0.1:0 --token-stdin --host-tag ${CONFIG_ID}`,
    });
    expect(decision.action).toBe('reapThenDeploy');
    expect(decision.kill).toBe(true);
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

  it('T-038f 升级场景 + 陈旧 token(probe 失败)→ 仍落 reapThenDeploy 且候选隧道被关', async () => {
    // 锁定:bundleReady=false 的新候选路径上,probe 失败(如 token 陈旧)后的回收
    // 行为与 bundleReady=true 口径完全一致——关候选隧道、kill 本 tag 活体、清 port 文件。
    let killSent = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return null; // 新版 bundle 未部署
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5400, pid: 888, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.startsWith('kill "888"')) {
            killSent = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
        (cmd) =>
          cmd.startsWith('kill -0 "888"')
            ? { code: 0, stdout: killSent ? 'N\n' : 'Y\n', stderr: '' }
            : null,
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
    expect(resolution.decision.action).toBe('reapThenDeploy');
    expect(candidateServer.closed).toBe(true);
    expect(ssh.execCalls.some((c) => c.startsWith('kill ') && c.includes('888'))).toBe(true);
    expect(ssh.execCalls.some((c) => c.includes('rm -f') && c.includes('host.port'))).toBe(true);
  });

  it('probe 失败 → 关闭候选隧道 + 落回收分支(不 livelock)', async () => {
    // kill 222 发出后再查 kill -0 应返回「已死」,模拟进程正常响应 SIGTERM 退出,
    // 避免 killAndWait 真实轮询满 3s 超时(否则测试会真实等待到超时 wall-clock)。
    let killSent = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5000, pid: 222, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) => {
          // 精确匹配「纯 kill」(非 kill -0):`kill "222" 2>/dev/null`
          if (cmd.startsWith('kill "222"')) {
            killSent = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
        (cmd) =>
          cmd.startsWith('kill -0 "222"')
            ? { code: 0, stdout: killSent ? 'N\n' : 'Y\n', stderr: '' }
            : null,
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
    expect(resolution.decision.action).toBe('reapThenDeploy');
    expect(candidateServer.closed).toBe(true);
    expect(ssh.execCalls.some((c) => c.startsWith('kill ') && c.includes('222'))).toBe(true);
    expect(ssh.execCalls.some((c) => c.includes('rm -f') && c.includes('host.port'))).toBe(true);
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

  it('🔴 EXT-B-2:claim 探测持续失败超过重试预算 → 落回收(reapThenDeploy),而非无限重试', async () => {
    let killSent = false;
    const ssh = createRoutedSsh({
      sftpReadFile: (path) => {
        if (path.endsWith('.ready')) return bufferOf('ok');
        if (path.endsWith('host.port')) {
          return bufferOf({ port: 5200, pid: 444, hostTag: CONFIG_ID });
        }
        return null;
      },
      execHandlers: [
        (cmd) => {
          if (cmd.startsWith('kill "444"')) {
            killSent = true;
            return { code: 0, stdout: '', stderr: '' };
          }
          return null;
        },
        (cmd) =>
          cmd.startsWith('kill -0 "444"')
            ? { code: 0, stdout: killSent ? 'N\n' : 'Y\n', stderr: '' }
            : null,
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
    // 默认 TERMPRO_CLAIM_PROBE_RETRIES=3(不含首次)→ 共 4 次尝试后才判定失败
    expect(probeCalls).toBe(4);
    expect(resolution.decision.action).toBe('reapThenDeploy');
    expect(server.closed).toBe(true);
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
});
