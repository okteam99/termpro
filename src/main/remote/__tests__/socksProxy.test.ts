// 内置浏览器"经远程机网络"用的 SOCKS5 代理最小实现(RFC 1928 子集)。
// 全部用真实 net.connect 连 createSocksProxyServer(listen(0) 拿随机端口),
// openOutbound 用桩注入(PassThrough 当 Duplex = 回声"远端服务":写入即读回)。
import { describe, it, expect } from 'vitest';
import * as net from 'node:net';
import { PassThrough } from 'node:stream';
import { createSocksProxyServer, mapConnectError, type OpenOutbound } from '../socksProxy';

// ---- 测试脚手架:构造 SOCKS5 帧字节 / 收发辅助 ----

function greetingFrame(methods: number[]): Buffer {
  return Buffer.from([0x05, methods.length, ...methods]);
}

function ipv4RequestFrame(cmd: number, ip: [number, number, number, number], port: number): Buffer {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  return Buffer.concat([Buffer.from([0x05, cmd, 0x00, 0x01, ...ip]), portBuf]);
}

function domainRequestFrame(cmd: number, domain: string, port: number): Buffer {
  const domainBuf = Buffer.from(domain, 'utf8');
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  return Buffer.concat([
    Buffer.from([0x05, cmd, 0x00, 0x03, domainBuf.length]),
    domainBuf,
    portBuf,
  ]);
}

async function startServer(openOutbound: OpenOutbound): Promise<net.Server> {
  const server = createSocksProxyServer(openOutbound);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return server;
}

function portOf(server: net.Server): number {
  return (server.address() as net.AddressInfo).port;
}

async function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** 累积收到的字节 + 事件驱动的"等到至少 n 字节"(不忙轮询)。 */
function makeReceiver(socket: net.Socket) {
  let acc = Buffer.alloc(0);
  const waiters: Array<{ n: number; onData: () => void }> = [];
  socket.on('data', (chunk: Buffer) => {
    acc = Buffer.concat([acc, chunk]);
    for (const w of waiters.slice()) {
      if (acc.length >= w.n) {
        waiters.splice(waiters.indexOf(w), 1);
        w.onData();
      }
    }
  });
  return {
    get buffer() {
      return acc;
    },
    atLeast(n: number, timeoutMs = 2000): Promise<Buffer> {
      if (acc.length >= n) return Promise.resolve(acc);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.onData === onData);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`timeout waiting for >= ${n} bytes, got ${acc.length}`));
        }, timeoutMs);
        const onData = () => {
          clearTimeout(timer);
          resolve(acc);
        };
        waiters.push({ n, onData });
      });
    },
  };
}

function waitForClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) return resolve();
    socket.once('close', () => resolve());
  });
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

const SUCCESS_REPLY = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
const NO_AUTH_METHOD_OK = Buffer.from([0x05, 0x00]);

describe('createSocksProxyServer 完整握手 + CONNECT + 数据往返', () => {
  it('domain ATYP:握手成功、connect 成功、数据双向回声', async () => {
    const calls: Array<{ host: string; port: number }> = [];
    const openOutbound: OpenOutbound = async (host, port) => {
      calls.push({ host, port });
      return new PassThrough();
    };
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x00]));
      await rx.atLeast(2);
      expect(rx.buffer.subarray(0, 2)).toEqual(NO_AUTH_METHOD_OK);

      client.write(domainRequestFrame(0x01, 'example.com', 443));
      await rx.atLeast(12);
      expect(rx.buffer.subarray(2, 12)).toEqual(SUCCESS_REPLY);
      expect(calls).toEqual([{ host: 'example.com', port: 443 }]);

      client.write('hello-socks-echo');
      await rx.atLeast(12 + 'hello-socks-echo'.length);
      expect(rx.buffer.subarray(12).toString('utf8')).toBe('hello-socks-echo');
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('分片:greeting/request 一字节一字节写,行为与整包一致', () => {
  it('逐字节写入仍能完成握手 + connect + 回声', async () => {
    const openOutbound: OpenOutbound = async () => new PassThrough();
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      const frame = Buffer.concat([greetingFrame([0x00]), domainRequestFrame(0x01, 'a.b', 80)]);
      for (const byte of frame) {
        await new Promise<void>((resolve, reject) =>
          client.write(Buffer.from([byte]), (err) => (err ? reject(err) : resolve())),
        );
        await new Promise((r) => setImmediate(r));
      }
      await rx.atLeast(12);
      expect(rx.buffer.subarray(0, 2)).toEqual(NO_AUTH_METHOD_OK);
      expect(rx.buffer.subarray(2, 12)).toEqual(SUCCESS_REPLY);

      client.write('x');
      await rx.atLeast(13);
      expect(rx.buffer.subarray(12).toString('utf8')).toBe('x');
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('管线化:greeting+request+payload 一个 write 全发,payload 不丢', () => {
  it('提前发送的负载先于 pipe 冲入 duplex,最终经回声原样收到', async () => {
    const openOutbound: OpenOutbound = async () => new PassThrough();
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      const payload = 'pipelined-payload';
      const all = Buffer.concat([
        greetingFrame([0x00]),
        domainRequestFrame(0x01, 'pipeline.example', 8080),
        Buffer.from(payload, 'utf8'),
      ]);
      client.write(all);

      // 2(greeting) + 10(connect reply) + payload.length(回声)
      await rx.atLeast(2 + 10 + payload.length);
      expect(rx.buffer.subarray(0, 2)).toEqual(NO_AUTH_METHOD_OK);
      expect(rx.buffer.subarray(2, 12)).toEqual(SUCCESS_REPLY);
      expect(rx.buffer.subarray(12).toString('utf8')).toBe(payload);
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('IPv4 ATYP 解析', () => {
  it('93.184.216.34 这样的点分十进制原样交给 openOutbound', async () => {
    const calls: Array<{ host: string; port: number }> = [];
    const openOutbound: OpenOutbound = async (host, port) => {
      calls.push({ host, port });
      return new PassThrough();
    };
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x00]));
      await rx.atLeast(2);
      client.write(ipv4RequestFrame(0x01, [93, 184, 216, 34], 80));
      await rx.atLeast(12);
      expect(calls).toEqual([{ host: '93.184.216.34', port: 80 }]);
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('greeting:无 no-auth 方法', () => {
  it('METHODS 不含 0x00 → 回 [0x05,0xFF] 且连接结束', async () => {
    const openOutbound: OpenOutbound = async () => new PassThrough();
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x01, 0x02])); // GSSAPI / 用户名密码,均非 no-auth
      await rx.atLeast(2);
      expect(rx.buffer).toEqual(Buffer.from([0x05, 0xff]));
      await waitForClose(client);
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('request:CMD 非 CONNECT', () => {
  it('CMD=0x03(UDP ASSOCIATE)→ REP=0x07 且连接结束', async () => {
    const openOutbound: OpenOutbound = async () => new PassThrough();
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x00]));
      await rx.atLeast(2);
      client.write(ipv4RequestFrame(0x03, [1, 2, 3, 4], 53));
      await rx.atLeast(12);
      expect(rx.buffer.subarray(2, 12)).toEqual(
        Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      await waitForClose(client);
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('connect 失败 → REP 映射', () => {
  it('ECONNREFUSED → REP=0x05', async () => {
    const openOutbound: OpenOutbound = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    };
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x00]));
      await rx.atLeast(2);
      client.write(domainRequestFrame(0x01, 'refused.example', 1));
      await rx.atLeast(12);
      expect(rx.buffer.subarray(2, 12)).toEqual(
        Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      await waitForClose(client);
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });

  it('getaddrinfo ENOTFOUND → REP=0x04', async () => {
    // 故意 reject 裸字符串(非 Error 实例)——mapConnectError 必须两种形状都认得
    const openOutbound: OpenOutbound = async () => {
      throw 'getaddrinfo ENOTFOUND no-such-host.invalid';
    };
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x00]));
      await rx.atLeast(2);
      client.write(domainRequestFrame(0x01, 'no-such-host.invalid', 80));
      await rx.atLeast(12);
      expect(rx.buffer.subarray(2, 12)).toEqual(
        Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      await waitForClose(client);
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('server.close() 断流在途连接', () => {
  it('已进入 piping 态的连接在 server.close() 后收到 close', async () => {
    const openOutbound: OpenOutbound = async () => new PassThrough();
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(greetingFrame([0x00]));
      await rx.atLeast(2);
      client.write(domainRequestFrame(0x01, 'still-open.example', 80));
      await rx.atLeast(12); // 至此已建立双向管道(piping 态)

      const closed = waitForClose(client);
      await closeServer(server);
      await closed; // 若 server.close() 没能销毁在途连接,这里会因 hookTimeout 挂起超时失败
    } finally {
      client.destroy();
    }
  });
});

describe('VER 非 5 → destroy(不回任何字节)', () => {
  it('greeting 首字节非 0x05,socket 被直接 destroy,不发送任何回复', async () => {
    const openOutbound: OpenOutbound = async () => new PassThrough();
    const server = await startServer(openOutbound);
    const client = await connectClient(portOf(server));
    client.on('error', () => {});
    const rx = makeReceiver(client);
    try {
      client.write(Buffer.from([0x04, 0x01, 0x00])); // VER=4(非法)
      await waitForClose(client);
      expect(rx.buffer.length).toBe(0); // destroy 前未发送任何回复字节
    } finally {
      client.destroy();
      await closeServer(server);
    }
  });
});

describe('mapConnectError 纯函数', () => {
  it('ECONNREFUSED / refused → 0x05', () => {
    expect(mapConnectError(new Error('connect ECONNREFUSED 127.0.0.1:22'))).toBe(0x05);
    expect(mapConnectError('Connection refused')).toBe(0x05);
  });

  it('ENOTFOUND / EHOSTUNREACH / unreachable / getaddrinfo → 0x04', () => {
    expect(mapConnectError(new Error('getaddrinfo ENOTFOUND foo.invalid'))).toBe(0x04);
    expect(mapConnectError(new Error('connect EHOSTUNREACH 10.0.0.1'))).toBe(0x04);
    expect(mapConnectError('Host is unreachable')).toBe(0x04);
  });

  it('其余未识别的失败 → 0x01(兜底)', () => {
    expect(mapConnectError(new Error('something odd happened'))).toBe(0x01);
    expect(mapConnectError({})).toBe(0x01);
    expect(mapConnectError(undefined)).toBe(0x01);
  });
});
