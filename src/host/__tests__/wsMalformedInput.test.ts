// AC-7 畸形输入:任意畸形帧下 host 进程不崩、其他客户端不受影响,仅拒绝/断开发送方。
import { it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startTestHost, TestClient, TestHost, delay, describePty } from './wsTestHarness';

const SMALL_CAP = 512 * 1024;

let host: TestHost | null = null;
const clients: TestClient[] = [];
let tmp = '';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-mal-'));
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (host) {
    await host.close();
    host = null;
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function track(c: TestClient): TestClient {
  clients.push(c);
  return c;
}

async function newClient(): Promise<TestClient> {
  const c = track(new TestClient(host!.url()));
  await c.handshake();
  return c;
}

describePty('AC-7 畸形输入 host 不崩、他客户端无感', () => {
  it('T-047 非 JSON 帧 → host 不崩,A 断开,B 不受影响', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    // B 正常收发
    const home = (await b.rpc('fs.home')) as { path: string };
    expect(typeof home.path).toBe('string');
    // A 发非 JSON 垃圾
    a.sendRaw('this is not json {{{{ \x00\x01garbage');
    await a.waitClose();
    // B 依旧可用(host 存活)
    const again = (await b.rpc('fs.home')) as { path: string };
    expect(again.path).toBe(home.path);
  });

  it('T-048 超 maxPayload 单帧 → 拒绝并断开发送方,host 存活', async () => {
    host = await startTestHost({ maxPayload: SMALL_CAP });
    const a = await newClient();
    const b = await newClient();
    // 超上限的合法 JSON(700KB content),服务端 maxPayload 直接拒帧关连接
    const huge = 'x'.repeat(700 * 1024);
    a.send({
      t: 'rpc:req',
      id: 1,
      method: 'fs.writeFile',
      params: { path: path.join(tmp, 'f'), content: huge },
    });
    await a.waitClose();
    // host 未崩:B 仍可 RPC
    const home = (await b.rpc('fs.home')) as { path: string };
    expect(typeof home.path).toBe('string');
  });

  it('T-049 略低于上限的合法大帧仍成功(与 DoS 上限不冲突)', async () => {
    host = await startTestHost({ maxPayload: SMALL_CAP });
    const c = await newClient();
    // 预建文件(writeTextFile 仅覆盖已存在文件),再写入 ~300KB(<512KB 上限)
    const target = path.join(tmp, 'big.txt');
    fs.writeFileSync(target, '');
    const content = 'y'.repeat(300 * 1024);
    await c.rpc('fs.writeFile', { path: target, content });
    expect(fs.readFileSync(target, 'utf8').length).toBe(content.length);
  });

  it('T-050 未知消息类型 → host 不崩,忽略,他客户端无感', async () => {
    host = await startTestHost();
    const a = await newClient();
    const b = await newClient();
    a.send({ t: 'bogus:type', foo: 'bar' });
    await delay(150);
    // A 未崩连接仍在,可继续正常 RPC
    const ah = (await a.rpc('fs.home')) as { path: string };
    expect(typeof ah.path).toBe('string');
    // B 无感
    const bh = (await b.rpc('fs.home')) as { path: string };
    expect(typeof bh.path).toBe('string');
  });

  it('T-051 畸形 rpc:req(缺 method)→ 返回 error 而非崩溃', async () => {
    host = await startTestHost();
    const c = await newClient();
    // 缺 method:走 per-RPC try/catch → rpc:res ok:false(与 MessagePort 一致)
    await expect(
      c.rpc(undefined as unknown as string, {}),
    ).rejects.toThrow();
    // 进程存活:后续正常 RPC 仍可用
    const home = (await c.rpc('fs.home')) as { path: string };
    expect(typeof home.path).toBe('string');
  });

  it('fs.writeTempFile 拒绝畸形 base64/伪 PNG,连接仍可继续使用', async () => {
    host = await startTestHost();
    const c = await newClient();
    await expect(
      c.rpc('fs.writeTempFile', { kind: 'png', base64: 'not-base64!' }),
    ).rejects.toThrow(/base64/i);
    await expect(
      c.rpc('fs.writeTempFile', {
        kind: 'png',
        base64: Buffer.from('not png').toString('base64'),
      }),
    ).rejects.toThrow(/PNG/i);
    const home = (await c.rpc('fs.home')) as { path: string };
    expect(typeof home.path).toBe('string');
  });

  it('T-052 综合存活性:历经全部畸形场景后,全新客户端仍能正常连接与 RPC', async () => {
    host = await startTestHost({ maxPayload: SMALL_CAP });
    const a = await newClient();
    // 依次触发各类畸形
    a.sendRaw('not-json{{{');
    await delay(50);
    const b = await newClient();
    b.send({
      t: 'rpc:req',
      id: 1,
      method: 'fs.writeFile',
      params: { path: path.join(tmp, 'f'), content: 'z'.repeat(700 * 1024) },
    });
    await delay(50);
    const d = await newClient();
    d.send({ t: 'weird:unknown' });
    await d.rpc(undefined as unknown as string, {}).catch(() => undefined);
    await delay(100);
    // 全新客户端 C:token + host.info 握手 + 任意 RPC 全部成功
    const c = track(new TestClient(host.url()));
    const info = await c.handshake();
    expect(info.protocolVersion).toBe(1);
    const home = (await c.rpc('fs.home')) as { path: string };
    expect(typeof home.path).toBe('string');
    void b;
  });
});
