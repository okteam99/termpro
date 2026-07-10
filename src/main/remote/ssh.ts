// SSH 连接薄封装(ssh2 Client)—— main 进程唯一直接触碰 ssh2 的模块。
// 纯 Node,零 Electron import(SSH 编排全在 main,但实现本身不依赖 Electron API,
// 保持与 host/ 同等的「远程就绪」纪律,便于未来若需要也可脱离 Electron 复用)。
//
// orchestrator/residency/deploy 一律只依赖 SshConnectionLike + ConnectSsh 工厂类型
// (DI 接缝 · ARCH-B10);本文件的 SshConnection 是生产实现,测试全部注入桩,不导入本文件。

import { Client, type SFTPWrapper } from 'ssh2';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

export interface SshAuth {
  username: string;
  /** 明文仅存活于本次 connect 调用栈(调用方从 credentialStore 瞬时解密取得) */
  password?: string;
  /** 从 privateKeyPath 读取的内容(不入库 · ARCH-5) */
  privateKey?: Buffer;
  passphrase?: string;
}

export interface SshConnectOptions {
  host: string;
  port: number;
  auth: SshAuth;
  readyTimeoutMs: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** orchestrator/residency/deploy 只依赖此接口(可注入桩 · T-005/008)。 */
export interface SshConnectionLike {
  exec(cmd: string): Promise<ExecResult>;
  /** 驻留启动:写 stdin 后 half-close(令远端 readFileSync(0) 得 EOF)。 */
  execDetached(cmd: string, stdin: string): Promise<void>;
  sftpReadFile(remotePath: string): Promise<Buffer | null>;
  sftpWriteDir(
    localDir: string,
    remoteDir: string,
    onProgress: (pct: number) => void,
  ): Promise<void>;
  /** 版本目录原子切换(SSH-5);目标已存在时应拒绝(调用方据此判并发赢家)。 */
  sftpRename(from: string, to: string): Promise<void>;
  /** 本地端口转发:127.0.0.1:localPort → 远端 127.0.0.1:remotePort。 */
  forwardOut(localPort: number, remotePort: number): net.Server;
  /**
   * 注册连接层 close/error 监听(AC-12 断链检测 · A2):底层 ssh2 Client 的
   * 'close'/'error' 都会触发。本地转发 net.Server 并不会在 SSH 连接掉线时
   * 自动 close/error(它独立监听本地 accept),故 orchestrator 必须另经此接口
   * 才能感知远端连接真的断了。intentional close()(orchestrator 主动调用)也会
   * 触发此回调——调用方需据自身状态判断是否为预期内收尾(不可在此接口内部去重)。
   */
  onClose(cb: (err?: Error) => void): void;
  close(): void;
}

/** DI 接缝(ARCH-B10):orchestrator 只依赖此工厂类型,不直接 new/调 static。 */
export type ConnectSsh = (o: SshConnectOptions) => Promise<SshConnectionLike>;

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function isEnoent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === ('NO_SUCH_FILE' as unknown);
}

/**
 * 生产实现。串行化 channel 创建避免并发 exec/sftp 抖动(ssh2 单条 Client 上
 * 高并发 channel 请求偶发 timeout,TECH SSH-1 · 「串行化避免并发 channel 抖动」)。
 */
export class SshConnection implements SshConnectionLike {
  private readonly client: Client;
  private queue: Promise<void> = Promise.resolve();

  private constructor(client: Client) {
    this.client = client;
  }

  static connect(o: SshConnectOptions): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.removeAllListeners();
        client.destroy();
        reject(new Error(`ssh connect timeout after ${o.readyTimeoutMs}ms`));
      }, o.readyTimeoutMs);

      client.on('ready', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new SshConnection(client));
      });
      client.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      client.connect({
        host: o.host,
        port: o.port,
        username: o.auth.username,
        password: o.auth.password,
        privateKey: o.auth.privateKey,
        passphrase: o.auth.passphrase,
        readyTimeout: o.readyTimeoutMs,
      });
    });
  }

  /** 串行化:下一个 channel 请求等前一个 settle(成功或失败都不阻塞后续)。 */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) reject(err);
        else resolve(sftp);
      });
    });
  }

  exec(cmd: string): Promise<ExecResult> {
    return this.serialize(
      () =>
        new Promise<ExecResult>((resolve, reject) => {
          this.client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let stdout = '';
            let stderr = '';
            stream.on('data', (d: Buffer) => {
              stdout += d.toString('utf8');
            });
            stream.stderr.on('data', (d: Buffer) => {
              stderr += d.toString('utf8');
            });
            stream.on('close', (code: number | null) => {
              resolve({ code: code ?? 0, stdout, stderr });
            });
            stream.on('error', reject);
          });
        }),
    );
  }

  execDetached(cmd: string, stdin: string): Promise<void> {
    return this.serialize(
      () =>
        new Promise<void>((resolve, reject) => {
          this.client.exec(cmd, (err, stream) => {
            if (err) return reject(err);
            let settled = false;
            const done = (fn: () => void) => {
              if (settled) return;
              settled = true;
              fn();
            };
            // 消耗 stdout/stderr 防 channel 缓冲区背压卡住(不关心内容)
            stream.on('data', () => {});
            stream.stderr.on('data', () => {});
            stream.on('error', (e: Error) => done(() => reject(e)));
            stream.on('close', () => done(() => resolve()));
            stream.write(stdin, (writeErr?: Error | null) => {
              if (writeErr) {
                done(() => reject(writeErr));
                return;
              }
              // half-close:令远端 readFileSync(0) 读到 EOF(不关读端,只关写端)
              stream.end();
            });
          });
        }),
    );
  }

  sftpReadFile(remotePath: string): Promise<Buffer | null> {
    return this.serialize(async () => {
      const sftp = await this.sftp();
      return new Promise<Buffer | null>((resolve, reject) => {
        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            if (isEnoent(err)) return resolve(null);
            return reject(err);
          }
          resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
      });
    });
  }

  sftpWriteDir(
    localDir: string,
    remoteDir: string,
    onProgress: (pct: number) => void,
  ): Promise<void> {
    return this.serialize(async () => {
      const sftp = await this.sftp();
      const files = listFilesRecursive(localDir);
      const dirs = new Set<string>();
      dirs.add(remoteDir);
      for (const f of files) {
        const remoteFile = `${remoteDir}/${toPosix(f)}`;
        dirs.add(path.posix.dirname(remoteFile));
      }
      const sortedDirs = [...dirs].sort((a, b) => a.length - b.length);
      for (const d of sortedDirs) {
        await mkdirRemote(sftp, d);
      }
      let uploaded = 0;
      for (const f of files) {
        const localPath = path.join(localDir, f);
        const remotePath = `${remoteDir}/${toPosix(f)}`;
        await putFile(sftp, localPath, remotePath);
        uploaded++;
        onProgress(files.length === 0 ? 100 : Math.round((uploaded / files.length) * 100));
      }
      if (files.length === 0) onProgress(100);
    });
  }

  sftpRename(from: string, to: string): Promise<void> {
    return this.serialize(async () => {
      const sftp = await this.sftp();
      return new Promise<void>((resolve, reject) => {
        sftp.rename(from, to, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  forwardOut(localPort: number, remotePort: number): net.Server {
    const server = net.createServer((socket) => {
      this.client.forwardOut(
        '127.0.0.1',
        socket.remotePort ?? 0,
        '127.0.0.1',
        remotePort,
        (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          // .pipe() 两端自动尊重 backpressure(ARCH-7);main 不解析字节。
          socket.pipe(stream);
          stream.pipe(socket);
          stream.on('close', () => socket.destroy());
          socket.on('close', () => stream.destroy());
          stream.on('error', () => socket.destroy());
          socket.on('error', () => stream.destroy());
        },
      );
    });
    server.listen(localPort, '127.0.0.1');
    return server;
  }

  onClose(cb: (err?: Error) => void): void {
    this.client.on('close', () => cb());
    this.client.on('error', (err: Error) => cb(err));
  }

  close(): void {
    this.client.end();
  }
}

function listFilesRecursive(root: string, sub = ''): string[] {
  const abs = path.join(root, sub);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = sub ? path.join(sub, e.name) : e.name;
    if (e.isDirectory()) {
      out.push(...listFilesRecursive(root, rel));
    } else if (e.isFile()) {
      out.push(rel);
    }
    // symlink 等其他类型:跳过(bundle 产物不含 symlink)
  }
  return out;
}

function mkdirRemote(sftp: SFTPWrapper, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dir, (err) => {
      if (err && !isEexist(err)) return reject(err);
      resolve();
    });
  });
}

/**
 * 🔴 A8/E5 修复:此前任意非 undefined code 都被当 EEXIST 放行,会把 ENOENT(父
 * 目录不存在)之类的真实失败也当「已存在」吞掉,掩盖如 A1 那类「父目录缺失」的
 * bug(sftpWriteDir 的 mkdir 链会静默跳过而非报错,后续 putFile 才会以更费解的
 * 方式失败)。只对确凿的「已存在」信号放行,其余一律上抛。
 */
export function isEexist(err: unknown): boolean {
  const e = err as { code?: string | number; message?: string } | undefined;
  if (!e) return false;
  if (e.code === 'EEXIST') return true;
  const msg = (e.message ?? '').toLowerCase();
  return msg.includes('file exists') || msg.includes('already exists');
}

function putFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
