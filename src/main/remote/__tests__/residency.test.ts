// 🔴 P0 · ARCH-B8 · 认领-或-确定性回收决策表(TC.md §2 六分支穷举)。
// decideResidency 是纯函数;两条安全守门断言必须真实成立:
//   T-034「兄弟永不误杀」——决策中 kill 从不出现
//   T-033「token 陈旧不 livelock」——probe 失败后同栈转 reap/deploy,非再次 claim
import { describe, it, expect } from 'vitest';
import { cmdlineMatchesHostTag, decideResidency, resolveResidency } from '../residency';
import { createRoutedSsh, bufferOf, FakeServer, asNetServer } from './testKit';

const CONFIG_ID = 'vps-hk';

describe('AC-13/AC-4/AC-8 residency 决策表(纯函数)', () => {
  it('T-032 claim 命中:portRaw 有效+token 非空+bundleReady+probe 通过', () => {
    const decision = decideResidency({
      configId: CONFIG_ID,
      portRaw: { port: 4123, pid: 999, hostTag: CONFIG_ID },
      storedToken: 'stored-token',
      bundleReady: true,
      probeResult: { ok: true, compatible: true },
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
      storedToken: 'good-token',
      probeHostInfo: async () => ({ ok: true, compatible: true }),
      buildTunnel: async () => ({ server: asNetServer(server), localPort: 41234 }),
    });
    expect(resolution.decision.action).toBe('claim');
    expect(resolution.claimed?.tunnel.localPort).toBe(41234);
    // 认领分支不应执行 kill 或 rm 陈旧文件
    expect(ssh.execCalls.some((c) => c.startsWith('kill'))).toBe(false);
    expect(ssh.execCalls.some((c) => c.includes('rm -f'))).toBe(false);
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
      storedToken: 'good-token',
      probeHostInfo: async () => {
        probeCalls++;
        if (probeCalls === 1) return { ok: false, detail: 'transient network hiccup' };
        return { ok: true, compatible: true };
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
