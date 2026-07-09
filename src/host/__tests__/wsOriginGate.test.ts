// AC-10 Origin 纵深防御(token 仍是主屏障;此为额外一层):checkOrigin 白名单矩阵(T-021)+
// 真实 upgrade 对异源拒绝 / file:// · null · 无 Origin 头放行(T-022)。
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { checkOrigin, DEFAULT_ALLOWED_ORIGINS, startWsServer } from '../wsServer';
import { createHostCore } from '../hostCore';
import type { WsServerHandle } from '../wsServer';

describe('AC-10 checkOrigin 白名单矩阵 (T-021)', () => {
  const allow = new Set(['null', 'file://', 'http://localhost:5173']);

  const cases: Array<{ origin: string | undefined; expected: boolean; label: string }> = [
    { origin: undefined, expected: true, label: '无 Origin 头(Node 客户端 / main probe)→ 放行' },
    { origin: 'file://', expected: true, label: 'file:// → 放行' },
    { origin: 'null', expected: true, label: 'null → 放行' },
    { origin: 'http://localhost:5173', expected: true, label: 'dev vite origin(注入白名单)→ 放行' },
    { origin: 'http://evil.com', expected: false, label: '异源 → 拒绝' },
  ];

  it.each(cases)('$label', ({ origin, expected }) => {
    expect(checkOrigin(origin, allow)).toBe(expected);
  });

  it('默认白名单含 null / file://,不含任意异源', () => {
    expect(checkOrigin('null', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(checkOrigin('file://', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(checkOrigin(undefined, DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(checkOrigin('http://evil.com', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });
});

describe('AC-10 真实 upgrade Origin 强制 (T-022)', () => {
  let handle: WsServerHandle | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  function urlFor(port: number, token: string): string {
    return `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
  }

  function waitOutcome(ws: WebSocket, timeoutMs = 4000): Promise<'opened' | 'closed' | 'errored'> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('errored'), timeoutMs);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve('opened');
      });
      ws.on('close', () => {
        clearTimeout(timer);
        resolve('closed');
      });
      ws.on('error', () => {
        clearTimeout(timer);
        resolve('errored');
      });
    });
  }

  it('异源 Origin(即便 token 正确)被拒;file:// / null / 无 Origin 头放行;Origin 合法但 token 错仍拒', async () => {
    const core = createHostCore();
    handle = await startWsServer({
      host: '127.0.0.1',
      port: 0,
      token: 'origin-gate-token',
      attachClient: (p) => core.attachClient(p),
      allowedOrigins: new Set(['null', 'file://']),
    });
    const port = handle.port;

    // 异源 + 正确 token → 拒绝(token 不是唯一屏障,Origin 纵深生效)
    const evil = new WebSocket(urlFor(port, 'origin-gate-token'), { origin: 'http://evil.com' });
    sockets.push(evil);
    expect(await waitOutcome(evil)).not.toBe('opened');

    // file:// + 正确 token → 放行
    const fileOrigin = new WebSocket(urlFor(port, 'origin-gate-token'), { origin: 'file://' });
    sockets.push(fileOrigin);
    expect(await waitOutcome(fileOrigin)).toBe('opened');

    // null + 正确 token → 放行
    const nullOrigin = new WebSocket(urlFor(port, 'origin-gate-token'), { origin: 'null' });
    sockets.push(nullOrigin);
    expect(await waitOutcome(nullOrigin)).toBe('opened');

    // 无 Origin 头(Node ws 客户端默认不发)+ 正确 token → 放行,不误杀
    const noOrigin = new WebSocket(urlFor(port, 'origin-gate-token'));
    sockets.push(noOrigin);
    expect(await waitOutcome(noOrigin)).toBe('opened');

    // Origin 合法(file://)但 token 错 → 仍拒(token 是主屏障,Origin 只是纵深)
    const badToken = new WebSocket(urlFor(port, 'wrong-token'), { origin: 'file://' });
    sockets.push(badToken);
    expect(await waitOutcome(badToken)).not.toBe('opened');
  });

  it('未显式传 allowedOrigins 时走 DEFAULT_ALLOWED_ORIGINS(file:// 放行 · 异源拒绝)', async () => {
    const core = createHostCore();
    handle = await startWsServer({
      host: '127.0.0.1',
      port: 0,
      token: 'default-origin-token',
      attachClient: (p) => core.attachClient(p),
    });
    const port = handle.port;

    const fileOrigin = new WebSocket(urlFor(port, 'default-origin-token'), { origin: 'file://' });
    sockets.push(fileOrigin);
    expect(await waitOutcome(fileOrigin)).toBe('opened');

    const evil = new WebSocket(urlFor(port, 'default-origin-token'), { origin: 'http://evil.com' });
    sockets.push(evil);
    expect(await waitOutcome(evil)).not.toBe('opened');
  });
});
