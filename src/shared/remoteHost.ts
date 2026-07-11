// 远程机管理与 SSH 连接编排 —— main ↔ renderer 跨层单一事实来源（EXT-6）。
// 传输无关的纯类型 + 常量：FailReason/RemoteStage 枚举、文案、IPC 通道名、配置 DTO。
// main 产（orchestrator emit RemoteEvent）· renderer 消费（RemoteHostsPage 派生 FAIL_REASONS）。
// 🔴 零 Node / 零 Electron import —— shared 层纪律（既能被 host 打包链引，也能被 renderer bundle 引）。

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
  tunnel?: { localPort: number; token: string };
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
} as const;

/** 失败分类文案单源（renderer FAIL_REASONS 从此派生 · UI.md 呈现口径）。 */
export interface FailReasonCopy {
  /** UI 徽标/详情标签 */
  label: string;
  /** 详情行（技术细节 · 零凭据明文） */
  detail?: string;
  /** 可选引导文案（如缺 node / 架构不支持的手装指引） */
  guidance?: string;
}

export const FAIL_REASON_COPY: Record<FailReason, FailReasonCopy> = {
  unreachable: { label: '不可达', detail: 'Connection refused / 主机不可达' },
  auth: { label: '认证失败', detail: 'Permission denied（检查密钥 / 密码 / 用户名）' },
  timeout: { label: '超时', detail: 'Connection timed out（10s）' },
  nodeMissing: {
    label: '缺少 Node.js 运行时',
    // 探测已覆盖 login shell 与常见安装位置(nvm/fnm/Homebrew/volta · nodeProbe.ts),
    // 走到这里就是真没装/真过旧;版本过旧时 runtime detail 会携带实测版本与路径覆盖此行。
    detail: '在远端 PATH、登录 shell 及常见安装位置(nvm / fnm / Homebrew / volta)均未找到 node',
    guidance: '请在远端机器安装 Node.js 20 或更高版本后重试连接',
  },
  archUnsupported: {
    label: '架构不支持',
    detail: '该远端架构暂无内置 host 产物',
    guidance: '请在远端执行 `npm i -g termpro-host` 手动安装后重试',
  },
  deployFailed: { label: '部署失败', detail: '上传 host 产物中断（网络 / 磁盘 / 权限）' },
  startFailed: { label: '启动失败', detail: '远端 host 进程未能拉起' },
  incompatible: {
    label: '版本不兼容',
    detail: '远端 host 与当前应用协议版本不兼容 · 已断开',
  },
  internal: { label: '内部错误', detail: '连接编排异常（详见应用日志）' },
};
