// Standalone host 端口闸的 capability token:来源解析 + 生成 + 常量时间校验。
// 威胁模型:远程机上的同机其他用户/进程(ssh 隧道只挡网络入口,token 是本机
// loopback 端口的唯一屏障)。纯 Node,零 Electron(远程就绪)。

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

/** 128-bit 随机源;base64url 编码为 22 字符无填充 token。 */
export const TOKEN_BYTES = 16;

/** 读后即抹的环境变量名(读取后立即 delete,防经 {...process.env} 泄露进 PTY)。 */
export const TOKEN_ENV = 'TERMPRO_HOST_TOKEN';

export type TokenSource = 'env' | 'file' | 'fd' | 'stdin' | 'generated';

export interface ResolvedToken {
  token: string;
  source: TokenSource;
}

/** 生成 128-bit token(base64url)。 */
export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  return argv[i + 1];
}

/**
 * fail-closed 非空断言:file/fd/stdin 三通道 trim 后若为空/全空白,
 * `verifyToken('', expected)` 对非空 expected 恒为 false,但对错配到「同样解析出
 * 空串」的场景(如两端都读到空文件)会造成端口闸静默失效。三通道一律拒绝启动。
 */
function requireNonEmptyToken(token: string, description: string): string {
  if (token === '') {
    throw new Error(
      `[host] refusing empty token from ${description}: blank/whitespace-only ` +
        'token content would fail-open the port gate; provide a non-empty token',
    );
  }
  return token;
}

/**
 * 解析 token 来源(TECH §token 生命周期)。
 * 优先级:显式传入(env / --token-file / --token-fd / --token-stdin)> 自动生成。
 *
 * 安全约束:
 *  - **禁 argv 明文**:出现 `--token <明文>` 立即抛错(Linux /proc/<pid>/cmdline
 *    同机他用户可读,击穿同租户边界)。
 *  - **env 读后即抹**:若 env 存在该变量,无论是否被选用都**立即 delete**,置于
 *    任何 pool.spawn 之前(否则 PTY 经 {...process.env} 继承 token)。
 *  - **--token-file 须 0600**:文件权限弱于 0600(group/other 任一位非 0)则拒绝。
 */
export interface ResolveTokenDeps {
  /** 读取数字 fd 的内容(--token-fd / --token-stdin);默认 fs.readFileSync。
   *  作为测试可注入的窄接缝(ESM 下 fs 命名空间不可 spy)。 */
  readFd?: (fd: number) => string;
}

export function resolveToken(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  deps: ResolveTokenDeps = {},
): ResolvedToken {
  const readFd = deps.readFd ?? ((fd: number) => fs.readFileSync(fd, 'utf8'));
  // env 读后即抹 —— 无条件执行(即便最终选用其他信道),防泄露进 PTY。
  const envToken = env[TOKEN_ENV];
  if (envToken !== undefined) {
    delete env[TOKEN_ENV];
  }

  // 禁 argv 明文
  if (argv.includes('--token')) {
    throw new Error(
      '[host] refusing --token <plaintext>: argv is readable by same-host ' +
        'users via /proc/<pid>/cmdline; use env/--token-file/--token-fd/--token-stdin',
    );
  }

  if (envToken !== undefined && envToken !== '') {
    return { token: envToken, source: 'env' };
  }

  const file = argValue(argv, '--token-file');
  if (file !== undefined) {
    const st = fs.statSync(file);
    // 拒绝 group/other 任一权限位(须 0600 或更严)
    if ((st.mode & 0o077) !== 0) {
      throw new Error(
        `[host] refusing token file with permissions ${(st.mode & 0o777).toString(8)}: require 0600`,
      );
    }
    return {
      token: requireNonEmptyToken(fs.readFileSync(file, 'utf8').trim(), `--token-file ${file}`),
      source: 'file',
    };
  }

  const fd = argValue(argv, '--token-fd');
  if (fd !== undefined) {
    return {
      token: requireNonEmptyToken(readFd(Number(fd)).trim(), `--token-fd ${fd}`),
      source: 'fd',
    };
  }

  if (argv.includes('--token-stdin')) {
    return {
      token: requireNonEmptyToken(readFd(0).trim(), '--token-stdin'),
      source: 'stdin',
    };
  }

  return { token: generateToken(), source: 'generated' };
}

/**
 * 常量时间 token 校验:先 sha256(消除长度泄露 + 定长)再 timingSafeEqual。
 * 绝不用 === / 逐字比较 / 提前 return 的可变时间实现。
 */
export function verifyToken(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  // a、b 恒为 32 字节,长度一致,timingSafeEqual 不会因长度差抛错
  return crypto.timingSafeEqual(a, b);
}
