// host.ts 的顶层入口在 import 时即按 process.argv 分流(含可能的 process.exit),
// 不安全在 vitest worker 进程内直接 import。本脚手架复用 scripts/package-host.mjs
// 同口径的 vite 打包(node builtins + node-pty/bufferutil/utf-8-validate external),
// 把 host.ts 打成单文件 CJS bundle,再以真实子进程启动 —— 让入口级副作用(exit/
// SIGTERM 清理/端口文件写)发生在独立 OS 进程内,与 vitest worker 完全隔离。
// 非 .test 文件,vitest 不当测试跑(与 wsTestHarness.ts 同惯例)。

import { build } from 'vite';
import { builtinModules } from 'node:module';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

let cached: Promise<string> | null = null;

/** 打包 host.ts → 临时目录下单文件 host.cjs;跨用例复用同一 bundle(减少重复打包耗时)。 */
export function ensureHostBundle(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-host-bundle-'));
      const external = [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'node-pty',
        'bufferutil',
        'utf-8-validate',
      ];
      await build({
        configFile: false,
        logLevel: 'warn',
        resolve: {
          conditions: ['node'],
          mainFields: ['module', 'jsnext:main', 'jsnext'],
        },
        build: {
          outDir,
          emptyOutDir: true,
          minify: false,
          lib: {
            entry: path.join(repoRoot, 'src/host/host.ts'),
            fileName: () => 'host.cjs',
            formats: ['cjs'],
          },
          rollupOptions: { external },
        },
      });
      return path.join(outDir, 'host.cjs');
    })();
  }
  return cached;
}

export interface SpawnedHost {
  child: ChildProcess;
  getStdout(): string;
  getStderr(): string;
  /** 轮询 stdout 累积文本直到匹配 pattern,返回匹配结果。 */
  waitForStdout(pattern: RegExp, timeoutMs?: number): Promise<RegExpExecArray>;
  /** 等待进程退出,返回退出码(null=被信号杀)。 */
  waitForExit(timeoutMs?: number): Promise<number | null>;
  kill(): void;
}

/**
 * 以真实子进程启动打包后的 host.cjs。
 * @param stdin 若提供,经子进程 stdin 写入后 half-close(EOF)——供 `--token-stdin` 场景注入
 *   token(resolveToken 走 fs.readFileSync(0),读到 EOF 返回);不提供则 stdin 为 'ignore'。
 */
export function spawnHost(
  bundlePath: string,
  argv: string[],
  env: NodeJS.ProcessEnv = {},
  stdin?: string,
): SpawnedHost {
  const child = spawn(process.execPath, [bundlePath, ...argv], {
    // node-pty/ws 打包时标 external(同 package-host.mjs 口径),bundle 独居临时目录、
    // 向上找不到仓库 node_modules —— 经 NODE_PATH 显式指回仓库 node_modules 供 require() 解析。
    env: { ...process.env, NODE_PATH: path.join(repoRoot, 'node_modules'), ...env },
    stdio: [stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  if (stdin !== undefined) {
    child.stdin?.write(stdin);
    child.stdin?.end();
  }
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdout += d.toString('utf8');
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
  });
  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      exitCode = code;
      resolve(code);
    });
  });
  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    async waitForStdout(pattern: RegExp, timeoutMs = 5_000): Promise<RegExpExecArray> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const m = pattern.exec(stdout);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(
        `waitForStdout timeout for ${pattern}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      );
    },
    async waitForExit(timeoutMs = 5_000): Promise<number | null> {
      if (exitCode !== undefined) return exitCode;
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<number | null>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `waitForExit timeout\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
              ),
            ),
          timeoutMs,
        );
      });
      try {
        return await Promise.race([exited, timeout]);
      } finally {
        clearTimeout(timer!);
      }
    },
    kill(): void {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    },
  };
}
