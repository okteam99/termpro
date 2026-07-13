// @vitest-environment jsdom
// AC-5 嵌入式 MessagePort 路径零回归:公共 API 签名不变、无新增往返、版本/token 门控
// 不侵入嵌入式路径(仅 WS 路径生效)。用 jsdom MessageChannel 驱动真实 MessagePort。
import { describe, it, expect, beforeEach } from 'vitest';
import { HostClient, hostClient } from '../hostClient';
import type { HostInfo } from '../../../shared/protocol';

/**
 * 建一个假的「main + host」:window.okwork.requestHostPort 触发时,经 MessageChannel
 * 把 port2 以 host:port 事件投递给 renderer,并在 port1 侧应答 host.info。
 * @returns 记录 renderer→host 收到的消息,用于往返计数。
 */
function installFakeEmbeddedHost(info: HostInfo): {
  received: Array<{ t?: string; method?: string; id?: number }>;
} {
  const received: Array<{ t?: string; method?: string; id?: number }> = [];
  (window as unknown as { okwork: { requestHostPort(): void } }).okwork = {
    requestHostPort() {
      const ch = new MessageChannel();
      // host 侧(port1)应答 host.info
      ch.port1.onmessage = (e: MessageEvent) => {
        const msg = e.data as { t?: string; method?: string; id?: number };
        received.push(msg);
        if (msg.t === 'rpc:req' && msg.method === 'host.info') {
          ch.port1.postMessage({
            t: 'rpc:res',
            id: msg.id,
            ok: true,
            result: info,
          });
        }
      };
      // 把 port2 交给 renderer(模拟 preload 的 window.postMessage 端口转移)
      const ev = new MessageEvent('message', {
        data: { t: 'host:port' },
        ports: [ch.port2],
      });
      window.dispatchEvent(ev);
    },
  };
  return { received };
}

const V1_INFO: HostInfo = {
  hostId: 'local',
  protocolVersion: 1,
  minCompatible: 1,
  platform: 'darwin',
  homedir: '/home/x',
  shell: '/bin/zsh',
};

beforeEach(() => {
  delete (window as unknown as { okwork?: unknown }).okwork;
});

describe('AC-5 hostClient 公共 API 签名不变 (T-061)', () => {
  it('单例暴露的公共方法/属性与落地前一致', () => {
    for (const m of [
      'connect',
      'rpc',
      'attachPty',
      'input',
      'resize',
      'ack',
      'onDown',
      'onFsChanged',
      'onSessionEvent',
    ]) {
      expect(typeof (hostClient as unknown as Record<string, unknown>)[m]).toBe(
        'function',
      );
    }
    // info 只读属性存在(初始 null)
    expect('info' in hostClient).toBe(true);
  });
});

describe('AC-5 嵌入式路径无新增往返 (T-062)', () => {
  it('connect 仅发一条 host.info,无 hello/welcome 等新消息', async () => {
    const client = new HostClient();
    const { received } = installFakeEmbeddedHost(V1_INFO);
    const info = await client.connect();
    expect(info.protocolVersion).toBe(1);
    // renderer→host 只发了一条消息,且是 host.info
    expect(received.length).toBe(1);
    expect(received[0].method).toBe('host.info');
  });
});

describe('AC-5 版本/token 门控不侵入嵌入式路径 (T-063)', () => {
  it('嵌入式握手不做版本区间校验:host 返回不兼容版本仍连上', async () => {
    // host 声明 v999/min999(与客户端 v1 完全不兼容)。若嵌入式误跑版本门控,
    // connect 会 reject;此处必须 resolve —— 证明版本校验只在 WS 路径。
    const client = new HostClient();
    installFakeEmbeddedHost({ ...V1_INFO, protocolVersion: 999, minCompatible: 999 });
    const info = await client.connect();
    expect(info.protocolVersion).toBe(999);
  });
});
