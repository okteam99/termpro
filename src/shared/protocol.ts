// HostService 协议:UI ↔ Host 之间唯一的通信契约(README §5)。
// 传输无关:本地走 MessagePort,远程走 WebSocket,消息形状不变。

export const PROTOCOL_VERSION = 1;

// PTY 输出流控水位(未确认字节数):超过 high 暂停 PTY,低于 low 恢复。
export const FLOW = {
  highWatermark: 512 * 1024,
  lowWatermark: 128 * 1024,
} as const;

export interface SpawnOptions {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
}

export interface HostInfo {
  hostId: string;
  protocolVersion: number;
  platform: string;
  homedir: string;
  shell: string;
}

export interface GitInfo {
  /** 会话所在工作区(worktree)根;非 git 目录为 null */
  toplevel: string | null;
  /** 该仓库主工作区(main worktree)根 */
  mainWorktree: string | null;
  /** 当前分支名;detached 时为短 SHA */
  branch: string | null;
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

export interface GitStatusEntry {
  /** 相对 toplevel 的路径 */
  path: string;
  status: GitFileStatus;
}

export interface WorktreeInfo {
  /** 工作区根(绝对路径);列表第一项为主工作区 */
  path: string;
  /** 分支名;detached 为 null */
  branch: string | null;
  /** HEAD 短 SHA */
  head: string;
}

// RPC 方法签名表:新增方法在这里登记,两端自动获得类型。
export interface RpcMethods {
  'host.info': { params: undefined; result: HostInfo };
  'pty.spawn': { params: SpawnOptions; result: { sessionId: string } };
  'pty.kill': { params: { sessionId: string }; result: undefined };
  /** 查询会话 shell 进程的实时 cwd(macOS lsof / Linux procfs) */
  'pty.cwd': { params: { sessionId: string }; result: { cwd: string | null } };
  'fs.readdir': { params: { path: string }; result: { entries: DirEntry[] } };
  'fs.home': { params: undefined; result: { path: string } };
  /** 递归监听目录变化,事件经 fs:changed 推送 */
  'fs.watch': { params: { path: string }; result: { watchId: number } };
  'fs.unwatch': { params: { watchId: number }; result: undefined };
  /** 轻量存在性检查(终端链接 hover 校验用) */
  'fs.stat': { params: { path: string }; result: { kind: 'file' | 'dir' | null } };
  'git.info': { params: { cwd: string }; result: GitInfo };
  'git.status': {
    params: { toplevel: string };
    result: { entries: GitStatusEntry[] };
  };
  /** 列出 cwd 所属仓库的全部工作区(供 WorkTree 面板下拉绑定) */
  'git.worktrees': { params: { cwd: string }; result: { worktrees: WorktreeInfo[] } };
  /** 读文本文件(2MB 上限;二进制/超限 content=null 并置标记) */
  'fs.readFile': {
    params: { path: string };
    result: { content: string | null; binary: boolean; truncated: boolean; size: number };
  };
  'fs.writeFile': { params: { path: string; content: string }; result: undefined };
  /** 读 ref 下的文件内容(不存在/二进制 → null) */
  'git.show': {
    params: { toplevel: string; ref: string; path: string };
    result: { content: string | null };
  };
  /** 变更文件列表:有 baseRef 时 = merge-base(baseRef,HEAD) 与工作区的差异;否则 = 未提交变更 */
  'git.changedFiles': {
    params: { toplevel: string; baseRef?: string };
    result: { entries: GitStatusEntry[]; mergeBase: string | null };
  };
}

export type RpcMethodName = keyof RpcMethods;

// 会话状态事件(host 侧状态机产出;UI 不解析终端输出,只消费语义事件)
export type SessionEvent =
  | { kind: 'state'; state: 'idle' | 'running'; via: 'process' | 'osc133' }
  | { kind: 'cmd-done'; exitCode: number | null }
  | { kind: 'bell' }
  | { kind: 'notify'; title: string; body: string }
  | { kind: 'quiet'; quiet: boolean }
  | { kind: 'altscreen'; on: boolean };

// UI → Host
export type ClientMessage =
  | { t: 'rpc:req'; id: number; method: RpcMethodName; params?: unknown }
  | { t: 'pty:input'; sessionId: string; data: string }
  | { t: 'pty:resize'; sessionId: string; cols: number; rows: number }
  | { t: 'pty:ack'; sessionId: string; bytes: number };

// Host → UI
export type HostMessage =
  | { t: 'rpc:res'; id: number; ok: true; result: unknown }
  | { t: 'rpc:res'; id: number; ok: false; error: string }
  | { t: 'pty:data'; sessionId: string; data: string; bytes: number }
  | { t: 'pty:exit'; sessionId: string; exitCode: number }
  | { t: 'pty:title'; sessionId: string; processName: string }
  | { t: 'session:event'; sessionId: string; event: SessionEvent }
  | { t: 'fs:changed'; watchId: number };
