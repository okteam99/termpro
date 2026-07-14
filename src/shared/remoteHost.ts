// 远程机管理与 SSH 连接编排 —— main ↔ renderer 跨层单一事实来源（EXT-6）。
// 传输无关的纯类型 + 常量：FailReason/RemoteStage 枚举、文案、IPC 通道名、配置 DTO。
// main 产（orchestrator emit RemoteEvent）· renderer 消费（RemoteHostsPage/MachineGroup 经 failReasonCopy 取词）。
// 🔴 零 Node / 零 Electron import —— shared 层纪律（既能被 host 打包链引，也能被 renderer bundle 引）。

import { t } from './i18n';

/** 连接生命周期阶段（与 PRD 状态机 / UI.md 状态徽标一一对应）。 */
export type RemoteStage =
  | 'idle'
  | 'connecting'
  | 'deploying'
  | 'starting'
  | 'claiming'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'disconnected';

/** 失败分类（UI.md 定 5 类 + 本 Feature 补 4 类内部态 · 呈现并入既有 5 类视觉）。 */
export type FailReason =
  | 'unreachable'
  | 'auth'
  | 'timeout'
  | 'nodeMissing'
  | 'archUnsupported'
  | 'deployFailed'
  | 'startFailed'
  | 'incompatible'
  | 'internal';

/** 远端架构标签（bundle 目录名 · uname 归一化目标）。 */
export type HostArch = 'darwin-arm64' | 'linux-x64' | 'linux-arm64';

/** 已就绪会话的本地转发隧道（renderer 直连 host 用 · localPort + capability token）。 */
export interface RemoteTunnelInfo {
  localPort: number;
  token: string;
}

/** main→renderer 事件 DTO（单向 · 经 remoteHost:event 推送）。 */
export interface RemoteEvent {
  configId: string;
  stage: RemoteStage;
  /** deploying 段 sftp 上传进度 0..100 */
  percent?: number;
  reason?: FailReason;
  /** 失败详情（🔴 零凭据明文） */
  detail?: string;
  /** 探测到的远端架构（AC-4 呼应「已探测远端架构」行） */
  arch?: HostArch;
  /** 仅 verifying 就绪时携带：renderer 经此本地转发端口 + token 做版本二次确认 */
  tunnel?: RemoteTunnelInfo;
  /** AC-13：跳过上传 / 认领驻留进程走的快路径 */
  fastPath?: boolean;
}

/** test 连接结果（仅认证 + 可达探测 · 不部署 · AC-2）。 */
export type TestResult =
  | { ok: true }
  | { ok: false; reason: FailReason; detail?: string };

export type AuthType = 'password' | 'key';

/** 远程机配置（存 userData/remote-hosts.json · 无任何明文凭据）。 */
export interface RemoteHostConfig {
  /** 稳定 id = per-host 键（≠ host.info.hostId 恒 'local' · ARCH-8） */
  id: string;
  alias: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  /** 私钥路径引用（内容不入库 · ARCH-5） */
  privateKeyPath?: string;
  /** password 密文是否已存（UI 呈现用 · 密文在 secrets 文件） */
  hasPassword?: boolean;
  /** key 的 passphrase 密文是否已存 */
  hasPassphrase?: boolean;
  /** 最近使用倒序（AC-7）· 成功 ready 时更新 */
  lastUsed?: number;
  /**
   * 隔离模式（多设备同屏 TECH §A.4）：true=每端独立 Host（hostTag=configId，现状行为）；
   * false/缺省=按（服务器指纹+SSH 用户）收敛到共享 Host。
   * 🔴 Phase 1 期编排侧默认按 true 占位（零行为变化），Phase 2 翻转默认收敛。
   */
  isolate?: boolean;
  createdAt: number;
}

/** save 入参：配置（id 可选 · 省略=新建）+ 明文敏感值（仅单向进 main · 永无 get 通道 · AC-3）。 */
export interface RemoteHostConfigInput {
  id?: string;
  alias: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  privateKeyPath?: string;
  /** 见 RemoteHostConfig.isolate；缺省=收敛（Phase 2 起生效） */
  isolate?: boolean;
}

/** 远端交接端口文件（host 写 O_EXCL / main sftp 读 · SSH-4）。 */
export interface RemotePortFile {
  port: number;
  pid: number;
  /** = configId（host 从 --host-tag 写入 · reap 双验读此比对区分兄弟 · ARCH-B2） */
  hostTag: string;
}

/** IPC 通道名（preload bridge ↔ main handler 单源 · 防两处字面量漂移）。 */
export const REMOTE_HOST_CHANNELS = {
  list: 'remoteHost:list',
  save: 'remoteHost:save',
  delete: 'remoteHost:delete',
  test: 'remoteHost:test',
  connect: 'remoteHost:connect',
  disconnect: 'remoteHost:disconnect',
  event: 'remoteHost:event',
  tunnel: 'remoteHost:tunnel',
  capabilities: 'remoteHost:capabilities',
  /** 全部会话阶段快照（浏览器网络选择器列出可用出口 · configId→RemoteStage）。 */
  stages: 'remoteHost:stages',
} as const;

/**
 * 内置浏览器的网络出口选择（面板级，非 per-tab —— persist:browser 是全局唯一 session
 * partition，代理设在 session 级，所有标签共享同一出口）。
 * hostId='local' = 本机直连（默认）；否则 = 某台 ready 远程机的 configId，其流量经该机
 * 上的本地 SOCKS5 代理走远程网络（远程 DNS）。
 */
export interface BrowserNetworkState {
  /** 当前生效出口：'local' 或远程机 configId。 */
  hostId: string;
  /** 远程出口的别名（UI 展示用；hostId==='local' 时省略）。 */
  alias?: string;
  /** 远程出口断线中（fail-closed：代理仍指向已失效端口、请求快速失败，**绝不静默
   *  回退本机网络**——否则本应走远程的流量会从本机 IP 出去，且 localhost 类地址
   *  瞬间换语义。该机重连 ready 后 main 自动重建代理并清除此标志）。 */
  down?: boolean;
}

/** 浏览器网络出口 IPC 通道（renderer ↔ main）。 */
export const BROWSER_NET_CHANNELS = {
  /** 设置出口（renderer→main，invoke）：返回最终生效态；请求远程但该机不可用 → 回退 local。 */
  set: 'browserNet:set',
  /** 查询当前出口（renderer→main，invoke）：面板挂载时对齐权威态。 */
  get: 'browserNet:get',
  /** 出口变更推送（main→renderer）：含断线自动回退 local——UI 据此同步高亮/提示。 */
  changed: 'browserNet:changed',
} as const;

/**
 * 凭据面能力(renderer 打开远程机管理时查询)。encryptionAvailable=false 意味着
 * safeStorage 拿不到钥匙串密钥(典型:启动时钥匙串授权被拒)——此时密码既存不进
 * (save 被 A9 前置校验拒绝)也读不出(getSecret 恒 null,连接必然 auth 失败),
 * UI 须以横幅明示自救路径,而非让用户面对误导性的「认证失败」。
 */
export interface RemoteHostCapabilities {
  encryptionAvailable: boolean;
}

/** 失败分类文案单源（renderer 经 failReasonCopy 取词 · UI.md 呈现口径）。 */
export interface FailReasonCopy {
  /** UI 徽标/详情标签 */
  label: string;
  /** 详情行（技术细节 · 零凭据明文） */
  detail?: string;
  /** 可选引导文案（如缺 node / 架构不支持的手装指引） */
  guidance?: string;
}

// 🔴 调用期取词(语言切换特性 2026-07-13):曾是模块级常量,t() 会被冻结在导入期
// 语言——持久化偏好(argv 注入晚于本模块求值)与运行时切换均不生效。改为函数后
// main/renderer 任意时刻调用都得当前语言,原「main 勿消费」时序约束一并解除。
export function failReasonCopyMap(): Record<FailReason, FailReasonCopy> {
  return {
    unreachable: {
      label: t('Unreachable'),
      detail: t('Connection refused / host unreachable'),
    },
    auth: {
      label: t('Authentication failed'),
      detail: t('Permission denied (check key / password / username)'),
    },
    timeout: { label: t('Timed out'), detail: t('Connection timed out (10s)') },
    nodeMissing: {
      label: t('Node.js runtime missing'),
      // 探测已覆盖 login shell 与常见安装位置(nvm/fnm/Homebrew/volta · nodeProbe.ts),
      // 走到这里就是真没装/真过旧;版本过旧时 runtime detail 会携带实测版本与路径覆盖此行。
      detail: t(
        'node not found on the remote PATH, login shell, or common install locations (nvm / fnm / Homebrew / volta)',
      ),
      guidance: t('Install Node.js 20 or newer on the remote machine, then retry'),
    },
    archUnsupported: {
      label: t('Unsupported architecture'),
      detail: t('No bundled host build for this remote architecture'),
      guidance: t('Run `npm i -g okwork-host` on the remote machine, then retry'),
    },
    deployFailed: {
      label: t('Deploy failed'),
      detail: t('Host bundle upload interrupted (network / disk / permissions)'),
    },
    startFailed: {
      label: t('Start failed'),
      detail: t('Remote host process failed to start'),
    },
    incompatible: {
      label: t('Incompatible version'),
      detail: t('Remote host protocol version is incompatible with this app · disconnected'),
    },
    internal: {
      label: t('Internal error'),
      detail: t('Connection orchestration error (see app logs)'),
    },
  };
}

/** 单条查询 + 兜底(UI 徽标兜底 unreachable;测试态调用点自定 'auth') */
export function failReasonCopy(
  reason: string | null | undefined,
  fallback: FailReason = 'unreachable',
): FailReasonCopy {
  const m = failReasonCopyMap();
  return m[reason as FailReason] ?? m[fallback];
}
