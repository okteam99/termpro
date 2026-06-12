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

// RPC 方法签名表:新增方法在这里登记,两端自动获得类型。
export interface RpcMethods {
  'host.info': { params: undefined; result: HostInfo };
  'pty.spawn': { params: SpawnOptions; result: { sessionId: string } };
  'pty.kill': { params: { sessionId: string }; result: undefined };
  'fs.readdir': { params: { path: string }; result: { entries: DirEntry[] } };
  'fs.home': { params: undefined; result: { path: string } };
}

export type RpcMethodName = keyof RpcMethods;

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
  | { t: 'pty:title'; sessionId: string; processName: string };
