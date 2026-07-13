// SSH 连接薄封装(ssh2 Client)—— main 进程唯一直接触碰 ssh2 的模块。
// 纯 Node,零 Electron import(SSH 编排全在 main,但实现本身不依赖 Electron API,
// 保持与 host/ 同等的「远程就绪」纪律,便于未来若需要也可脱离 Electron 复用)。
//
// orchestrator/residency/deploy 一律只依赖 SshConnectionLike + ConnectSsh 工厂类型
// (DI 接缝 · ARCH-B10);本文件的 SshConnection 是生产实现,测试全部注入桩,不导入本文件。

import { Client, type SFTPWrapper, type ConnectConfig } from 'ssh2';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import type { Duplex } from 'node:stream';

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
  /** 动态出站(浏览器 SOCKS 代理用):经 SSH direct-tcpip 打洞到远端网络任意目标。
   *  目标主机名字符串原样交给远端 sshd 解析(远程 DNS)。🔴 并发开通道(不走 serialize):
   *  direct-tcpip 的 forwardOut 回调在【远端连上目标之后】才 resolve(含远程 DNS+TCP 握手),
   *  一旦串行化,某标签访问被黑洞的主机会让该连接卡到 OS connect 超时(数十秒),期间
   *  冻结所有其它标签的新连接——对「走远程网络浏览」是高频硬伤。见 forwardOut(隧道)
   *  同样并发开 direct-tcpip 通道且长期稳定;serialize 只为 exec/sftp 的 session 型通道
   *  抖动而设,不适用 direct-tcpip。 */
  openOutbound(dstHost: string, dstPort: number): Promise<Duplex>;
  /**
   * 注册连接层 close/error 监听(AC-12 断链检测 · A2):底层 ssh2 Client 的
   * 'close'/'error' 都会触发。本地转发 net.Server 并不会在 SSH 连接掉线时
   * 自动 close/error(它独立监听本地 accept),故 orchestrator 必须另经此接口
   * 才能感知远端连接真的断了。intentional close()(orchestrator 主动调用)也会
   * 触发此回调——调用方需据自身状态判断是否为预期内收尾(不可在此接口内部去重)。
   */
  onClose(cb: (err?: Error) => void): void;
  close(): void;
  /**
   * 本次连接实握的 host key 的 SHA-256 摘要(hostTag 派生源 · 多设备同屏 TECH §A.1)。
   * 未握到(老 ssh2 未回调 hostVerifier / 桩未配置)→ null,调用方 fail-safe 退隔离模式。
   * 🔴 仅「顺路捕获」,不改变信任模型(hostVerifier 恒接受,TOFU/pinning 超本 RD 范围)。
   */
  hostKeyFingerprint(): Buffer | null;
}

/** DI 接缝(ARCH-B10):orchestrator 只依赖此工厂类型,不直接 new/调 static。 */
export type ConnectSsh = (o: SshConnectOptions) => Promise<SshConnectionLike>;

const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000;
const DEFAULT_KEEPALIVE_COUNT_MAX = 3;

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * 🔴 纵深防御(TECH §依赖与影响面「main 侧断线感知时延」·ARCH-B-1 补充,非替代
 * disconnect-first):ssh2 自身 keepalive——冻结 TCP(合盖/断网)下 renderer 心跳
 * 可能数分钟才感知,main 靠此主动探活也能较快 emit disconnected。心跳仍是权威
 * fast 信号,这只是纵深;env 可注入(测试/调优免碰真实网络等待)。
 */
export function buildKeepaliveConfig(): Pick<ConnectConfig, 'keepaliveInterval' | 'keepaliveCountMax'> {
  return {
    keepaliveInterval: envPositiveInt('OKWORK_SSH_KEEPALIVE_MS', DEFAULT_KEEPALIVE_INTERVAL_MS),
    keepaliveCountMax: envPositiveInt('OKWORK_SSH_KEEPALIVE_COUNT', DEFAULT_KEEPALIVE_COUNT_MAX),
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * 🔴 全新远端部署必挂修复(0.3.33「部署失败 No such file」):上传前须创建的
 * 远端目录全集。此前只收集 remoteDir + 每个文件的【直接】父目录——bundle 里
 * `node_modules/node-pty/...` 这类「中间层无直接文件」的目录(`node_modules/`、
 * `build/`)不会进 mkdir 列表;SFTP mkdir 非递归,首个深层 mkdir(如
 * `<tmp>/node_modules/node-pty`)因父级缺失返回 NO_SUCH_FILE(OpenSSH 原话
 * "No such file")→ 部署 100% 失败。isEnoent 修复(7fa5580)让首连走到部署
 * 阶段后,这颗一直被前置 bug 遮蔽的雷才暴露。
 *
 * 只补 remoteDir【以内】的祖先——remoteDir 自身的父链由调用方保证
 * (deploy.ts 已 `mkdir -p ${dataDir}/bundle`)。不能越界向上:对已存在目录
 * mkdir,OpenSSH 返回的是 FAILURE(message "Failure"),isEexist 识别不了,
 * 反而致败。返回按长度升序(父路径恒短于子路径,先建父)。
 */
export function planRemoteDirs(remoteDir: string, posixRelFiles: string[]): string[] {
  const dirs = new Set<string>([remoteDir]);
  for (const rel of posixRelFiles) {
    let d = path.posix.dirname(`${remoteDir}/${rel}`);
    while (d.length > remoteDir.length) {
      dirs.add(d);
      d = path.posix.dirname(d);
    }
  }
  return [...dirs].sort((a, b) => a.length - b.length);
}

/** ssh2 SFTP 状态码(SFTP.js STATUS_CODE.NO_SUCH_FILE;err.code 是数字,非字符串)。 */
const SFTP_NO_SUCH_FILE = 2;

/**
 * 🔴 首连必挂修复:ssh2 的 SFTP 错误 `err.code = errorCode` 是【数字】状态码
 * (NO_SUCH_FILE = 2),message 是 sftp-server 原话(OpenSSH 为 "No such file")。
 * 此前只比对字符串 'ENOENT'/'NO_SUCH_FILE',真实远端的「文件不存在」永远不被
 * 识别 → sftpReadFile 对全新机器上必然缺失的 .ready/host.port 抛错而非返回 null
 * → 首连 100% 「内部错误 No such file」。字符串 'ENOENT' 分支保留(本地 fs 语义
 * 的桩/未来实现)。
 */
export function isEnoent(err: unknown): boolean {
  const code = (err as { code?: string | number } | undefined)?.code;
  return code === 'ENOENT' || code === SFTP_NO_SUCH_FILE;
}

/**
 * 生产实现。串行化 channel 创建避免并发 exec/sftp 抖动(ssh2 单条 Client 上
 * 高并发 channel 请求偶发 timeout,TECH SSH-1 · 「串行化避免并发 channel 抖动」)。
 */
export class SshConnection implements SshConnectionLike {
  private readonly client: Client;
  private readonly hostKeyDigest: Buffer | null;
  private queue: Promise<void> = Promise.resolve();
  private sftpCached: Promise<SFTPWrapper> | null = null;

  private constructor(client: Client, hostKeyDigest: Buffer | null) {
    this.client = client;
    this.hostKeyDigest = hostKeyDigest;
  }

  static connect(o: SshConnectOptions): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      // hostVerifier 在 ready 之前回调,先存局部再随实例构造带入
      let hostKeyDigest: Buffer | null = null;
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
        resolve(new SshConnection(client, hostKeyDigest));
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
        // 🔴 多设备同屏 TECH §A.1:顺路捕获 host key 指纹(hostTag 派生源)。
        // 恒 return true = 严格保持现状信任模型(此前本就无任何 host key 校验);
        // 不设 hostHash(要原始 key 字节自算 SHA-256,而非 ssh2 的 hex 摘要字符串)。
        hostVerifier: (key: Buffer | { data?: Buffer }) => {
          const raw = Buffer.isBuffer(key)
            ? key
            : Buffer.isBuffer((key as { data?: Buffer }).data)
              ? (key as { data: Buffer }).data
              : null;
          if (raw) {
            hostKeyDigest = crypto.createHash('sha256').update(raw).digest();
          }
          return true;
        },
        ...buildKeepaliveConfig(),
      });
    });
  }

  hostKeyFingerprint(): Buffer | null {
    return this.hostKeyDigest;
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

  /**
   * 🔴 SFTP channel 复用(channel 泄漏修复):此前每次 sftp 操作都
   * `client.sftp()` 新开一条 subsystem channel 且从不关闭——OpenSSH 默认
   * `MaxSessions=10`,orchestrator 启动阶段 pollPortFile 每 300ms 一次
   * sftpReadFile,几秒内即把并发 channel 耗尽,第 11 条起 channel open 直接
   * 失败。改为整条连接复用同一条 SFTP channel;channel close/error(含连接
   * 断开)后失效缓存,下一次操作重开。
   */
  private sftp(): Promise<SFTPWrapper> {
    if (this.sftpCached) return this.sftpCached;
    const created: Promise<SFTPWrapper> = new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        const invalidate = () => {
          if (this.sftpCached === created) this.sftpCached = null;
        };
        sftp.on('close', invalidate);
        sftp.on('error', invalidate);
        resolve(sftp);
      });
    });
    // 打开失败同样失效缓存,避免 rejected promise 永久卡死后续所有 sftp 操作
    created.catch(() => {
      if (this.sftpCached === created) this.sftpCached = null;
    });
    this.sftpCached = created;
    return created;
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
      const sortedDirs = planRemoteDirs(remoteDir, files.map(toPosix));
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

  /**
   * 🔴 不走 serialize:浏览器一条 TCP 连接 = 一条 direct-tcpip 通道,而 ssh2 的
   * forwardOut 回调在【远端 connect 到目标之后】才 resolve(含远程 DNS + TCP 握手,
   * 非「通道一开就返回」)。若串行化,某标签访问被防火墙黑洞的主机时,该连接的
   * forwardOut 要等到 OS connect 超时(数十秒)才 settle,期间队列卡死,所有其它
   * 标签/子资源都开不了新连接——对「走远程网络浏览」是用户高频撞上的硬伤。
   * direct-tcpip 并发开通道本就安全(上面隧道 forwardOut 每个 socket 直接并发
   * client.forwardOut 且长期稳定为证);serialize 是为 exec/sftp 这类 session 型
   * 通道的并发抖动(SSH-1)而设,不适用 direct-tcpip,故此处并发发起、互不阻塞。
   */
  openOutbound(dstHost: string, dstPort: number): Promise<Duplex> {
    return new Promise<Duplex>((resolve, reject) => {
      this.client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
        if (err) return reject(err);
        resolve(stream);
      });
    });
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

/**
 * 🔴 必须显式传 mode 保留本地权限位:ssh2 fastPut 不传 opts.mode 时不做 fchmod,
 * 远端按服务端默认(0644)落盘 —— bundle 里 node-pty 的 spawn-helper 丢执行位后,
 * darwin 远端每次 pty.spawn 都被 posix_spawn EACCES 拒绝,抛「posix_spawnp failed.」
 * (Linux 远端走 forkpty 不用 helper,故此前 linux 部署掩盖了该缺陷)。
 */
function putFile(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  const mode = fs.statSync(localPath).mode & 0o777;
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, { mode }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
