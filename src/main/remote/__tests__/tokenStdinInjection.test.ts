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
    });
    expect(cmd).toContain('--token-stdin');
    expect(cmd).toContain('--host-tag "vps-hk"');
    expect(cmd).not.toMatch(/--token\s+\S/); // 无 "--token <明文>" 形态(--token-stdin 不算,因其后无空格跟值)
    expect(cmd).toContain('"/home/tester/.termpro-host/bundle/1.2.3/host.js"');
    expect(cmd).toContain('"/home/tester/.termpro-host/hosts/vps-hk/host.port"');
    expect(cmd).toContain('"/home/tester/.termpro-host/hosts/vps-hk/host.log"');
    expect(cmd).toContain('setsid nohup env');
    expect(cmd).toContain('< /dev/stdin');
    // A6:远端 Origin 白名单经 env 注入(host.ts 已实现按逗号分隔解析)
    expect(cmd).toContain('TERMPRO_ALLOWED_ORIGINS=');
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
          (cmd) => (cmd === 'node -v' ? { code: 0, stdout: 'v20.11.0\n', stderr: '' } : null),
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
