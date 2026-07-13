// AC-8 端口文件交接(SSH-4):listening 后按 OKWORK_HOST_PORT_FILE 写 {port,pid,hostTag}
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
          OKWORK_HOST_TOKEN: 'portfile-token-1',
          OKWORK_HOST_PORT_FILE: portFile,
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
          OKWORK_HOST_TOKEN: 'portfile-token-2',
          OKWORK_HOST_PORT_FILE: portFile,
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
          OKWORK_HOST_TOKEN: 'right-token-3',
          OKWORK_HOST_PORT_FILE: portFile,
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

function waitOpen(ws: WebSocket, timeoutMs = 4_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('open timeout')), timeoutMs);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function waitOutcome(ws: WebSocket, timeoutMs = 4_000): Promise<'opened' | 'closed' | 'errored' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve('opened');
    });
    ws.on('close', () => {
      clearTimeout(timer);
      resolve('closed');
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve('errored');
    });
  });
}

describe('A6 · OKWORK_ALLOWED_ORIGINS env 注入(host 侧接线)', () => {
  it(
    '设置该 env 后白名单按注入值生效(注入 origin 放行 · 非注入 origin 仍拒,即不回落 DEFAULT)',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const host = track(
        spawnHost(bundlePath, ['--listen', '127.0.0.1:0'], {
          OKWORK_HOST_TOKEN: 'origin-env-token',
          OKWORK_HOST_PORT_FILE: portFile,
          OKWORK_ALLOWED_ORIGINS: 'http://localhost:5173,file://',
        }),
      );
      const m = await host.waitForStdout(/\[host\] listening ws:\/\/([^:]+):(\d+)/);
      const port = Number(m[2]);

      // 注入值(dev vite origin)→ 放行
      const injected = new WebSocket(`ws://127.0.0.1:${port}/?token=origin-env-token`, {
        origin: 'http://localhost:5173',
      });
      await waitOpen(injected);
      injected.close();

      // 'null' 是 wsServer 内建 DEFAULT 的一员,但本次注入值不含它 —— 一旦 host.ts 传入
      // 非空 allowedOrigins,wsServer 按 `opts.allowedOrigins ?? DEFAULT` 覆盖语义生效,
      // 不回落 DEFAULT,故此处仍应被拒(证明 env 值确被下传,不是摆设)。
      const notInjected = new WebSocket(`ws://127.0.0.1:${port}/?token=origin-env-token`, {
        origin: 'null',
      });
      expect(await waitOutcome(notInjected)).not.toBe('opened');
    },
    20_000,
  );

  it(
    '未设置该 env 时维持 wsServer 内建 DEFAULT_ALLOWED_ORIGINS(file:// 仍放行,向后兼容)',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const host = track(
        spawnHost(bundlePath, ['--listen', '127.0.0.1:0'], {
          OKWORK_HOST_TOKEN: 'origin-default-token',
          OKWORK_HOST_PORT_FILE: portFile,
        }),
      );
      const m = await host.waitForStdout(/\[host\] listening ws:\/\/([^:]+):(\d+)/);
      const port = Number(m[2]);

      const fileOrigin = new WebSocket(`ws://127.0.0.1:${port}/?token=origin-default-token`, {
        origin: 'file://',
      });
      await waitOpen(fileOrigin);
      fileOrigin.close();
    },
    20_000,
  );
});

describe('Q2 · AC-8 token-stdin 零落盘/零回显(host 侧证否,补 TC 落地风险#2)', () => {
  it(
    '经 --token-stdin 注入的 token 明文不出现在端口文件内容,也不出现在 host 的 stdout/stderr(恒不回显)',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const secretToken = 'stdin-secret-9f3e7a2c1d5b8046';
      const host = track(
        spawnHost(
          bundlePath,
          ['--listen', '127.0.0.1:0', '--token-stdin', '--host-tag', 'cfg-portfile-q2'],
          { OKWORK_HOST_PORT_FILE: portFile },
          `${secretToken}\n`,
        ),
      );
      const m = await host.waitForStdout(/\[host\] listening ws:\/\/([^:]+):(\d+)/);
      const port = Number(m[2]);
      await waitForFile(portFile);

      // ① 端口文件内容不含 token 明文
      expect(fs.readFileSync(portFile, 'utf8')).not.toContain(secretToken);

      // 正例锚点:token 确实生效(证「未在输出里看到」不是因为 host 根本没读到 token 就挂了)
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(secretToken)}`);
      await waitOpen(ws);
      ws.close();

      // ② host 的 stdout/stderr(即将被重定向进 host.log 的同一流)不含 token 明文
      // (--token-stdin 路径 source==='stdin',host.ts 仅 source==='generated' 才回显)
      await new Promise((r) => setTimeout(r, 100)); // 让可能的滞后输出落进缓冲区
      expect(host.getStdout()).not.toContain(secretToken);
      expect(host.getStderr()).not.toContain(secretToken);
    },
    20_000,
  );
});

describe('E12 · 驻留态恒不回显 token(结构纵深,防未来误用 generated token 起驻留 host)', () => {
  it(
    '设置 OKWORK_HOST_PORT_FILE 且未显式传 token(落到 generated 分支)时,stdout 恒不出现 "[host] token=" 回显行',
    async () => {
      const dataDir = tmpDataDir();
      const portFile = path.join(dataDir, 'host.port');
      const host = track(
        spawnHost(bundlePath, ['--listen', '127.0.0.1:0', '--host-tag', 'cfg-portfile-e12'], {
          OKWORK_HOST_PORT_FILE: portFile,
          // 故意不传 OKWORK_HOST_TOKEN / --token-*:resolveToken 落到 generated 分支
          // (source==='generated'),验证「驻留态」这一结构约束独立生效,不依赖 source。
        }),
      );
      await host.waitForStdout(/\[host\] listening ws:\/\//);
      await waitForFile(portFile);
      // 让可能的滞后输出落进缓冲区,再断言回显行始终未出现
      await new Promise((r) => setTimeout(r, 100));
      expect(host.getStdout()).not.toMatch(/\[host\] token=/);
    },
    20_000,
  );
});
