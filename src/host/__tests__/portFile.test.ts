// AC-8 端口文件交接(SSH-4):listening 后按 TERMPRO_HOST_PORT_FILE 写 {port,pid,hostTag}
// (wx=O_CREAT|O_EXCL|O_WRONLY,0600,无 TOCTOU);陈旧文件 EEXIST → fail-closed(T-016/T-017)。
// 以及 --host-tag 仅自证(端口文件/日志),绝不参与 token 端口闸(T-038)。
//
// 真实子进程(见 hostSubprocessHarness.ts):host.ts 顶层入口在 import 时即分流并可能
// process.exit,不安全在 vitest worker 内直接 import;用打包后的 host.cjs 起独立 OS 进程,
// 让入口副作用与 vitest 进程完全隔离。首次打包(vite build)有秒级开销,故放宽本文件超时。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { ensureHostBundle, spawnHost, SpawnedHost } from './hostSubprocessHarness';

let bundlePath: string;
const spawned: SpawnedHost[] = [];
const tmpDirs: string[] = [];

beforeAll(async () => {
  bundlePath = await ensureHostBundle();
}, 60_000);

afterEach(() => {
  for (const s of spawned.splice(0)) s.kill();
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function track(s: SpawnedHost): SpawnedHost {
  spawned.push(s);
  return s;
}

function tmpDataDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-host-portfile-'));
  tmpDirs.push(d);
  return d;
}

async function waitForFile(file: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitForFile timeout: ${file}`);
}

describe('AC-8 端口文件 wx(O_EXCL)|0600 + {port,pid,hostTag}', () => {
  it(
    'T-016 listening 后写端口文件:openSync(path,"wx",0o600) + 内容 {port,pid,hostTag} 可回读',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const host = track(
        spawnHost(bundlePath, ['--listen', '127.0.0.1:0', '--host-tag', 'cfg-portfile-1'], {
          TERMPRO_HOST_TOKEN: 'portfile-token-1',
          TERMPRO_HOST_PORT_FILE: portFile,
        }),
      );
      const m = await host.waitForStdout(
        /\[host\] listening ws:\/\/([^:]+):(\d+) protocol=v(\d+)/,
      );
      const listeningPort = Number(m[2]);

      await waitForFile(portFile);
      const stat = fs.statSync(portFile);
      expect(stat.mode & 0o777).toBe(0o600);

      const content = JSON.parse(fs.readFileSync(portFile, 'utf8')) as {
        port: number;
        pid: number;
        hostTag: string;
      };
      expect(content.port).toBe(listeningPort);
      expect(content.pid).toBe(host.child.pid);
      expect(content.hostTag).toBe('cfg-portfile-1');
    },
    20_000,
  );

  it(
    'T-017 陈旧端口文件已存在 → openSync wx 抛 EEXIST → console.error + exit(1),内容不被覆盖(无 TOCTOU 窗口)',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const staleContent = JSON.stringify({ port: 1, pid: 424242, hostTag: 'stale-tag' });
      fs.writeFileSync(portFile, staleContent, { mode: 0o600 });

      const host = track(
        spawnHost(bundlePath, ['--listen', '127.0.0.1:0', '--host-tag', 'cfg-portfile-2'], {
          TERMPRO_HOST_TOKEN: 'portfile-token-2',
          TERMPRO_HOST_PORT_FILE: portFile,
        }),
      );
      // ws server 已成功起来(listening 日志会打),失败只发生在随后写端口文件那一步
      await host.waitForStdout(/\[host\] listening/);
      const code = await host.waitForExit(5_000);
      expect(code).toBe(1);
      expect(host.getStderr()).toMatch(/stale port file, refusing/);
      // fail-closed:陈旧文件内容原封不动(证无覆盖窗口/无 TOCTOU)
      expect(fs.readFileSync(portFile, 'utf8')).toBe(staleContent);
    },
    20_000,
  );
});

describe('AC-8 --host-tag 自证不入端口闸', () => {
  it(
    'T-038 host 以 --host-tag 启动后,错误 token 仍被拒;正确 token 仍放行(host-tag 与 verifyToken 解耦)',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const host = track(
        spawnHost(bundlePath, ['--listen', '127.0.0.1:0', '--host-tag', 'cfg-portfile-3'], {
          TERMPRO_HOST_TOKEN: 'right-token-3',
          TERMPRO_HOST_PORT_FILE: portFile,
        }),
      );
      const m = await host.waitForStdout(/\[host\] listening ws:\/\/([^:]+):(\d+)/);
      const port = Number(m[2]);

      // 错误 token(不管 host-tag 是什么、host 是否以某 host-tag 启动)→ 仍被拒
      const bad = new WebSocket(`ws://127.0.0.1:${port}/?token=wrong-token`);
      const badOutcome = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 4_000);
        bad.on('open', () => {
          clearTimeout(timer);
          resolve('opened');
        });
        bad.on('close', () => {
          clearTimeout(timer);
          resolve('closed');
        });
        bad.on('error', () => {
          clearTimeout(timer);
          resolve('errored');
        });
      });
      expect(badOutcome).not.toBe('opened');

      // 正确 token → 放行(证明 host-tag 从未替代或参与 token 闸)
      const good = new WebSocket(`ws://127.0.0.1:${port}/?token=right-token-3`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('open timeout')), 4_000);
        good.on('open', () => {
          clearTimeout(timer);
          resolve();
        });
        good.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      good.close();

      // 结构断言(照 tokenGate.test.ts T-015 的源码审查惯例):hostTag 只流向端口文件 JSON,
      // 绝不出现在 startWsServer({...}) 调用块或 resolveToken(...) 调用里。
      const src = fs.readFileSync(path.join(__dirname, '..', 'host.ts'), 'utf8');
      expect(src).toMatch(/argValue\(process\.argv,\s*'--host-tag'\)/);
      const startCall = /startWsServer\(\{[\s\S]*?\}\)/.exec(src);
      expect(startCall).not.toBeNull();
      expect(startCall![0]).not.toMatch(/hostTag/);
      const resolveCall = /resolveToken\([^)]*\)/.exec(src);
      expect(resolveCall).not.toBeNull();
      expect(resolveCall![0]).not.toMatch(/hostTag/);
    },
    20_000,
  );
});
