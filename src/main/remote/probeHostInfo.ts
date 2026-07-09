// main 侧 Node-ws host.info 探测(认领验证前移 · ARCH-B1)。
// 对 127.0.0.1:<localPort>?token=<token> 发 host.info 首帧,复用 checkHostInfoCompatible
// 判定版本兼容。🔴 有界超时(R2-5,复用握手超时口径 HANDSHAKE_TIMEOUT_MS=10s)+
// 无论成功/失败/超时都 close(),绝不留悬挂 host client。

import { WebSocket } from 'ws';
import type { HostInfo, ClientMessage, HostMessage } from '../../shared/protocol';
import { checkHostInfoCompatible } from '../../shared/versionCompat';

/** 与 host wsServer 的握手超时口径对齐(host.ts HANDSHAKE_TIMEOUT_MS)。 */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  ok: boolean;
  hostInfo?: HostInfo;
  compatible?: boolean;
  /** 探测失败时的简述(零凭据明文,仅供日志)。 */
  detail?: string;
}

export interface ProbeHostInfoDeps {
  timeoutMs?: number;
  /** 测试注入:替换真实 WebSocket 构造(避免真连接)。 */
  createWebSocket?: (url: string) => WebSocket;
}

export type ProbeHostInfoFn = (
  localPort: number,
  token: string,
  deps?: ProbeHostInfoDeps,
) => Promise<ProbeResult>;

/**
 * 对本地转发端口发 host.info,用后即关闭。永不 reject —— 一切失败态归一为
 * `{ ok: false, detail }`,调用方(residency)只需判 ok。
 */
export const probeHostInfo: ProbeHostInfoFn = (localPort, token, deps = {}) => {
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
  const url = `ws://127.0.0.1:${localPort}?token=${encodeURIComponent(token)}`;
  const make = deps.createWebSocket ?? ((u: string) => new WebSocket(u));

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = make(url);
    } catch (err) {
      resolve({ ok: false, detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* 已关闭/未开则忽略 */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, detail: 'probe timeout' });
    }, timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }

    ws.on('open', () => {
      const req: ClientMessage = { t: 'rpc:req', id: 1, method: 'host.info' };
      ws.send(JSON.stringify(req));
    });

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let data: HostMessage;
      try {
        const text = Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.from(raw as ArrayBuffer).toString('utf8');
        data = JSON.parse(text) as HostMessage;
      } catch {
        finish({ ok: false, detail: 'malformed probe response' });
        return;
      }
      if (data.t !== 'rpc:res' || data.id !== 1) return;
      if (!data.ok) {
        finish({ ok: false, detail: 'host.info rpc error' });
        return;
      }
      const info = data.result as HostInfo;
      const { compatible } = checkHostInfoCompatible(info);
      finish({ ok: true, hostInfo: info, compatible });
    });

    ws.on('error', (err) => {
      finish({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    });

    ws.on('close', () => {
      finish({ ok: false, detail: 'closed before host.info response' });
    });
  });
};
