// OkWork Host 进程入口 — 纯 Node,零 Electron import(README §5 远程就绪)。
// 入口分流:
//   argv 含 --profile-store-rpc       → main-only SSH stdin/stdout 单请求模式
//   argv 含 --listen 127.0.0.1:<port> → standalone WebSocket 模式(远程/loopback)
//   否则                              → 嵌入式模式(utilityProcess + parentPort,现状)
// 两种模式共用 hostCore(传输无关);新增 WS 逻辑全在 wsServer,嵌入式路径零侵入。

import * as fs from 'node:fs';
import { PROTOCOL_VERSION } from '../shared/protocol';
import { createHostCore, PortLike } from './hostCore';
import { runRemoteProfileRpc } from './profileStoreRpc';

// stdout/stderr 写失败免疫(同 main.ts 2026-07-23):host 的日志走 nohup 重定向文件/
// 父进程管道,任一先死后 console.* 会以 stream 'error'(EPIPE/EIO)炸掉进程——host 一死
// 全部会话陪葬。日志写不出去只能静默丢弃,不能决定 host 存亡。
process.stdout?.on?.('error', () => undefined);
process.stderr?.on?.('error', () => undefined);
import { gitInfo } from './gitService';
import { healWorkspaceProfile, OKWORK_PROFILE_PATH } from './profileHeal';
import { resolveToken, writeIdentityTokenFile } from './token';
import { startWsServer } from './wsServer';

function runInteractiveHost(): void {
  // 形态注入(D-1 · BL-005):--listen → standalone(远程/loopback · 断线续跑 + 回放收养);
  // --standalone → standalone 语义 + parentPort 传输(本地嵌入式崩溃存活:renderer 死/重载
  // 只 detach 不 kill,重连收养回放——形态与传输正交,本机也走远程同款会话生命周期);
  // 都没有 → embedded(kill-on-close 兜底,保留给显式回退)。分流在 argv 层,createHostCore 之前前移。
  const core = createHostCore(
    process.argv.includes('--listen') || process.argv.includes('--standalone')
      ? 'standalone'
      : 'embedded',
  );

  // dev/远程冒烟自测:host cwd 即项目仓库时验证 git 链路
  function maybeGitSmoke(): void {
    if (process.env.OKWORK_SMOKE) {
      void gitInfo(process.cwd()).then(
        (info) => console.log('[host] git smoke:', JSON.stringify(info)),
        (err) => console.error('[host] git smoke failed:', err),
      );
    }
  }

  /** 解析 --listen <host:port> → { host, port };host 段须为 loopback。 */
  function parseListen(argv: string[]): { host: string; port: number } {
    const i = argv.indexOf('--listen');
    const spec = argv[i + 1] ?? '127.0.0.1:0';
    // 支持 IPv6(::1):按最后一个冒号切端口
    const lastColon = spec.lastIndexOf(':');
    const host = lastColon > 0 ? spec.slice(0, lastColon) : '127.0.0.1';
    const port =
      lastColon > 0 ? Number(spec.slice(lastColon + 1)) : Number(spec);
    return {
      host: host.replace(/^\[|\]$/g, ''),
      port: Number.isNaN(port) ? 0 : port,
    };
  }

  /** 取 flag 后紧跟的一个 argv 值;缺失返回 undefined。 */
  function argValue(argv: string[], flag: string): string | undefined {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  }

  if (process.argv.includes('--listen')) {
    // ---- standalone WebSocket 模式 ----
    // 存量 okwork-node 容器自愈:旧镜像 profile.d 无条件 `cd /workspace` 会清掉
    // 显式 spawn cwd(远程新终端根目录≠项目目录)。须在任何 pty.spawn 之前完成。
    if (healWorkspaceProfile() === 'healed') {
      console.log(
        '[host] healed stale %s (unconditional cd /workspace)',
        OKWORK_PROFILE_PATH,
      );
    }
    const { host, port } = parseListen(process.argv);
    // configId 自证标签(远程编排注入):仅写入端口文件/日志供 main 侧 reap 双验识别
    // 同机兄弟 host(SSH-4·ARCH-B2),绝不参与下方 token 端口闸——闸仍只认 token。
    const hostTag = argValue(process.argv, '--host-tag');
    // token 解析(env 读后即抹,置于任何 pool.spawn 之前);禁 argv 明文
    let token: string;
    let source: string;
    try {
      const resolved = resolveToken(process.argv, process.env);
      token = resolved.token;
      source = resolved.source;
    } catch (err) {
      console.error('[host]', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Origin 白名单(AC-10 纵深):main 侧(dev-main buildStartCommand)按打包/dev 场景算出
    // 完整白名单经 env 注入,逗号分隔;缺省(embedded 本机路径/未注入)→ 维持 wsServer 内建
    // DEFAULT_ALLOWED_ORIGINS(向后兼容,行为不变)。
    const allowedOriginsEnv = process.env.OKWORK_ALLOWED_ORIGINS;
    const allowedOrigins = allowedOriginsEnv
      ? new Set(
          allowedOriginsEnv
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        )
      : undefined;

    startWsServer({
      host,
      port,
      token,
      attachClient: (p: PortLike) => core.attachClient(p),
      allowedOrigins,
    }).then(
      (handle) => {
        // 自动生成 token 时单行打印供调用方/ssh exec 捕获(显式传入则不回显)。
        // 结构上仅限非驻留模式(无 OKWORK_HOST_PORT_FILE):驻留态由 main 编排经
        // --token-stdin 注入(source==='stdin',本就不会走这条分支),但仅凭「调用方
        // 永远传 --token-stdin」这一隐性契约维持不落盘 —— 任何未来误将驻留 host 以
        // generated token 起、或调试改动绕过 --token-stdin,都会把 128-bit token 明文
        // 写进被 main 重定向的 host.log。改为显式结构约束:驻留态(有端口文件)恒不
        // 打印 token,即便 source 意外为 'generated' 也不落盘(纵深 · E12)。
        const isResident = Boolean(process.env.OKWORK_HOST_PORT_FILE);
        if (source === 'generated' && !isResident) {
          console.log('[host] token=%s', token);
        }
        // 固定 listening 日志行(CI 可 grep · AC-4)
        console.log(
          '[host] listening ws://%s:%d protocol=v%d',
          handle.address,
          handle.port,
          PROTOCOL_VERSION,
        );
        // 驻留端口交接文件(main sftp 回读用 · SSH-4)。O_CREAT|O_EXCL|O_WRONLY:
        // 陈旧文件视为 main 未先清理 = bug,fail-closed 拒绝覆盖而非静默复用
        // (无 TOCTOU 窗口 · AC-8)。
        const portFile = process.env.OKWORK_HOST_PORT_FILE;
        if (portFile) {
          let fd: number;
          try {
            fd = fs.openSync(portFile, 'wx', 0o600);
          } catch {
            console.error('[host] stale port file, refusing:', portFile);
            process.exit(1);
            return;
          }
          // 🔴 P1-1(收尾评审):身份 token 只允许【赢得端口文件 wx】的进程落盘——
          // 双赢家(锁陈旧被跨机时钟偏差误 break)时输家已在上面 EEXIST 自杀,绝不
          // 覆盖赢家 token(否则身份文件≠现网 host 的 token → 第三设备 probe 必败
          // → 误 reap 服役中 host)。happens-before 仍成立:身份提交先于端口文件
          // 【合法内容】写入,读者(pollPortFile/parsePortFile)对空/畸形内容重试。
          const identityFile = process.env.OKWORK_HOST_IDENTITY_FILE;
          if (identityFile) {
            try {
              writeIdentityTokenFile(identityFile, token);
            } catch (err) {
              console.error(
                '[host] identity token write failed:',
                err instanceof Error ? err.message : String(err),
              );
              process.exit(1);
            }
            // dataDir 权限收紧(best-effort · TECH §A.2):失败不阻断启动
            try {
              const dataDir = process.env.OKWORK_HOST_DATA_DIR;
              if (dataDir) fs.chmodSync(dataDir, 0o700);
            } catch {
              /* best-effort */
            }
          }
          fs.writeFileSync(
            fd,
            JSON.stringify({ port: handle.port, pid: process.pid, hostTag }),
          );
          fs.closeSync(fd);
          // 正常回收:main 断连/重启前发 SIGTERM → 清端口文件,不留陈旧供下次 EEXIST 误判。
          process.on('SIGTERM', () => {
            try {
              fs.unlinkSync(portFile);
            } catch {
              /* 已被清理或从未创建,忽略 */
            }
            process.exit(0);
          });
        }
        maybeGitSmoke();
      },
      (err) => {
        console.error(
          '[host] failed to start ws server:',
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      },
    );
  } else {
    // ---- 嵌入式模式(现状,一字不改语义)----
    // utilityProcess 子进程里 Electron 注入的 parentPort(运行时存在,不引类型)
    const parentPort = (process as unknown as { parentPort?: PortLike })
      .parentPort;

    if (!parentPort) {
      console.error(
        '[host] no parentPort — start with --listen <127.0.0.1:port> for standalone mode',
      );
      process.exit(1);
    } else {
      parentPort.on('message', (e) => {
        const data = e.data as { t?: string } | undefined;
        if (data?.t === 'client' && e.ports[0]) {
          core.attachClient(e.ports[0]);
        }
      });

      console.log(
        '[host] ready, pid=%d, protocol=v%d',
        process.pid,
        PROTOCOL_VERSION,
      );

      maybeGitSmoke();
    }
  }
}

// Profile store is a main-only, one-request SSH stdio mode. It must branch
// before createHostCore so it neither opens the generic WS service nor touches
// utilityProcess parentPort. Existing --listen/embedded behaviour stays inside
// runInteractiveHost unchanged.
if (process.argv.includes('--profile-store-rpc')) {
  void runRemoteProfileRpc();
} else {
  runInteractiveHost();
}
