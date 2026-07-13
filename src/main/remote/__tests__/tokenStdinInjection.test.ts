// AC-8 token 经 --token-stdin 注入 · 零落盘零日志。
// 启动命令 argv 含 --token-stdin --host-tag <id>,不含 --token <明文>;token 只经
// execDetached 的 stdin 参数传递(独立信道),从不出现在任何被 exec 的 shell 命令里
// (等价于「不出现在远端可被 ps/cmdline/日志窥见的地方」——SshConnectionLike 的
// execDetached(cmd, stdin) 签名本身就把两者结构性分离,本测断言编排器不违反这个分离)。
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RemoteHostOrchestrator, buildStartCommand } from '../orchestrator';
import { CredentialStore, HostConfigStore, type SafeStorageLike } from '../credentialStore';
import { createRoutedSsh, bufferOf } from './testKit';

describe('AC-8 buildStartCommand', () => {
  it('T-018 argv 含 --token-stdin --host-tag <id>,不含 --token <明文>;路径全程绝对', () => {
    const cmd = buildStartCommand({
      dataDir: '/home/tester/.termpro-host',
      appVersion: '1.2.3',
      configId: 'vps-hk',
      nodePath: '/opt/homebrew/bin/node',
    });
    expect(cmd).toContain('--token-stdin');
    expect(cmd).toContain('--host-tag "vps-hk"');
    expect(cmd).not.toMatch(/--token\s+\S/); // 无 "--token <明文>" 形态(--token-stdin 不算,因其后无空格跟值)
    expect(cmd).toContain('"/home/tester/.termpro-host/bundle/1.2.3/host.js"');
    expect(cmd).toContain('"/home/tester/.termpro-host/hosts/vps-hk/host.port"');
    expect(cmd).toContain('"/home/tester/.termpro-host/hosts/vps-hk/host.log"');
    // node 用探测解析出的绝对路径(非交互 PATH 不可依赖),双引号包裹
    expect(cmd).toContain('"/opt/homebrew/bin/node"');
    // darwin 无 setsid:恒前缀改为按需降级($s 惯用式),整体 sh -c 单引号包裹
    expect(cmd).toContain("sh -c '");
    expect(cmd).toContain('command -v setsid');
    expect(cmd).toContain('$s nohup env');
    // token 注入:先 t=$(cat) 同步收完 stdin 再经机内管道喂 node——
    // 禁 `< /dev/stdin`(sh 秒退后 sshd 拆会话 stdin,晚到的 token 必丢,
    // 高 RTT 远端 100% 复现空 token fail-closed 拒启)
    expect(cmd).toContain('t=$(cat);');
    expect(cmd).toContain('printf %s "$t" |');
    expect(cmd).not.toContain('/dev/stdin');
    // sh -c 单引号体内不得再有单引号(外层登录 shell 可能是 fish/csh)
    expect(cmd.slice(cmd.indexOf("sh -c '") + 7, -1)).not.toContain("'");
    // A6:远端 Origin 白名单经 env 注入(host.ts 已实现按逗号分隔解析)
    expect(cmd).toContain('TERMPRO_ALLOWED_ORIGINS=');
    // 应用版本经 env 注入(host.info.appVersion 数据源 · 用户规则 2026-07-13 升级判定)
    expect(cmd).toContain('TERMPRO_HOST_APP_VERSION="1.2.3"');
  });

  it('nodePath 缺省回落裸 node;含双引号/换行的异常路径被剥除,不破坏命令边界', () => {
    const fallback = buildStartCommand({
      dataDir: '/d',
      appVersion: '1.0.0',
      configId: 'a',
    });
    expect(fallback).toContain('"node"');
    const hostile = buildStartCommand({
      dataDir: '/d',
      appVersion: '1.0.0',
      configId: 'a',
      nodePath: '/tmp/x"; rm -rf /; echo "\n/pwn/node',
    });
    expect(hostile).not.toContain('"; rm');
    expect(hostile).not.toContain('\n');
  });

  it('A6 buildStartCommand 可注入自定义 allowedOrigins(main.ts 按打包/dev 场景算出)', () => {
    const cmd = buildStartCommand({
      dataDir: '/home/tester/.termpro-host',
      appVersion: '1.2.3',
      configId: 'vps-hk',
      allowedOrigins: 'null,file://,http://localhost:5173',
    });
    expect(cmd).toContain('TERMPRO_ALLOWED_ORIGINS="null,file://,http://localhost:5173"');
  });
});

describe('AC-8 T-018 端到端(编排器层):token 只经 execDetached stdin 参数,不进任何 exec 命令', () => {
  it('token 明文不出现在任何 ssh.exec() 调用的命令字符串里', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termpro-tokinj-'));
    try {
      const configId = 'vps-hk';
      const configStore = new HostConfigStore({ userDataDir: () => tmpDir });
      const safeStorage: SafeStorageLike = {
        isEncryptionAvailable: () => true,
        encryptString: (p) => Buffer.from(`ENC:${p}`, 'utf8'),
        decryptString: (b) => b.toString('utf8').slice(4),
      };
      const credentials = new CredentialStore({ userDataDir: () => tmpDir, safeStorage });
      configStore.save({
        id: configId,
        alias: 'vps-hk',
        host: '1.2.3.4',
        port: 22,
        username: 'root',
        authType: 'password',
      });

      let started = false;
      let capturedToken: string | null = null;
      const routed = createRoutedSsh({
        execHandlers: [
          (cmd) => (cmd === 'echo $HOME' ? { code: 0, stdout: '/home/tester\n', stderr: '' } : null),
          (cmd) =>
            cmd.includes('command -v node')
              ? { code: 0, stdout: 'v20.11.0 /usr/bin/node\n', stderr: '' }
              : null,
          (cmd) => (cmd === 'uname -sm' ? { code: 0, stdout: 'Darwin arm64\n', stderr: '' } : null),
        ],
        sftpReadFile: (p) => {
          if (p.endsWith('.ready')) return null;
          if (p.endsWith('host.port')) {
            return started ? bufferOf({ port: 6100, pid: 777, hostTag: configId }) : null;
          }
          return null;
        },
      });
      const originalExecDetached = routed.execDetached;
      routed.execDetached = async (cmd: string, stdin: string) => {
        capturedToken = stdin;
        started = true;
        return originalExecDetached(cmd, stdin);
      };

      const orchestrator = new RemoteHostOrchestrator({
        connectSsh: async () => routed,
        credentials,
        configStore,
        bundleDir: () => '/local/bundle/darwin-arm64',
        appVersion: '1.0.0',
        probeHostInfo: async () => ({ ok: true, compatible: true }),
        sleep: async () => undefined,
      });

      await orchestrator.connect(configId);

      expect(capturedToken).not.toBeNull();
      const token = capturedToken as unknown as string;
      expect(token.length).toBeGreaterThan(10);

      // token 明文绝不出现在任何被 exec() 的命令字符串里(mkdir/kill/rm/touch/node -v/…)
      for (const execCmd of routed.execCalls) {
        expect(execCmd).not.toContain(token);
      }
      // execDetached 的 cmd 参数(与 stdin 分离传递)本身也不该含 token
      for (const call of routed.execDetachedCalls) {
        expect(call.cmd).not.toContain(token);
      }
      // main 侧留存的 hosttoken:<id> 密文合规(非泄露·ADR-001)——只断言存在,不断言明文
      expect(credentials.getSecret(`hosttoken:${configId}`)).toBe(token);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
