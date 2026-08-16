// 云端浏览器的**整条链路**:真 ws 客户端 → wsServer → hostCore RPC 分发 →
// browserService → 真 Chromium,再把 screencast 帧沿原路推回来并 ack。
//
// 单测覆盖的是 browserService 内部;hostCore 的接线(RPC 分发、帧只推给发起方、
// frameAck 的归属校验、断连停流)只有在这里才被真正执行到。
//
// 默认 skip(CI 上没有浏览器):
//   OKWORK_TEST_REAL_CHROMIUM=1 npx vitest run src/host/__tests__/browserRpc.integration.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostMessage } from '../../shared/protocol';
import { startTestHost, TestClient, waitFor, type TestHost } from './wsTestHarness';

const enabled = process.env.OKWORK_TEST_REAL_CHROMIUM === '1';

const PAGE = `data:text/html,${encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><title>rpc probe</title><body><h1 id="t">cloud rpc</h1><button id="go" onclick="document.title=\'clicked\'">go</button></body>',
)}`;

let host: TestHost | null = null;

beforeAll(async () => {
  if (!enabled) return;
  // standalone:云端浏览器能力位只在这个形态上报(embedded 本机不需要)
  host = await startTestHost({ mode: 'standalone' });
});

afterAll(async () => {
  if (!host) return;
  host.core.browser.dispose();
  await host.close();
});

/** 取该客户端收到的全部预览帧。 */
function framesOf(client: TestClient) {
  return client.messages.filter(
    (m): m is Extract<HostMessage, { t: 'browser:frame' }> => m.t === 'browser:frame',
  );
}

describe.skipIf(!enabled)('云端浏览器 RPC 全链路(默认 skip)', () => {
  it('standalone host 上报 browser.headless 能力位,status 说得出装没装', async () => {
    const client = new TestClient(host!.url());
    const info = await client.handshake();
    expect(info.capabilities).toContain('browser.headless');

    const status = (await client.rpc('browser.status')) as {
      available: boolean;
      running: boolean;
    };
    expect(status.available).toBe(true);
    // 🔴 只探测不启动:问一句状态不该在服务器上拉起浏览器
    expect(status.running).toBe(false);
    client.close();
  }, 30_000);

  it('经 RPC 开标签 → 导航 → 取文本 → 点击,全链路走通', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();

    const { tabId } = (await client.rpc('browser.navigate', { url: PAGE })) as {
      tabId: string;
    };
    expect(tabId).toBeTruthy();
    await client.rpc('browser.waitFor', { tabId, selector: '#t', timeoutMs: 5000 });

    const { text } = (await client.rpc('browser.getText', { tabId })) as { text: string };
    expect(text).toContain('cloud rpc');

    await client.rpc('browser.click', { tabId, selector: '#go' });
    const { value } = (await client.rpc('browser.eval', {
      tabId,
      code: 'document.title',
    })) as { value: unknown };
    expect(value).toBe('clicked');

    const tabs = (await client.rpc('browser.listTabs')) as {
      tabs: Array<{ tabId: string }>;
    };
    expect(tabs.tabs.map((t) => t.tabId)).toContain(tabId);
    client.close();
  }, 60_000);

  it('🔴 预览帧沿 ws 推回并受 ack 门控:不 ack 就只有一帧', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    const { tabId } = (await client.rpc('browser.navigate', { url: PAGE })) as {
      tabId: string;
    };
    await client.rpc('browser.startPreview', { tabId });

    // 让页面持续重绘产帧
    const paint = async (i: number) =>
      client.rpc('browser.eval', {
        tabId,
        code: `document.body.style.background='hsl(${i * 40},80%,50%)'`,
      });

    for (let i = 0; i < 5; i++) await paint(i);
    await waitFor(() => framesOf(client).length >= 1, 8000);

    // 不 ack:隧道上恒最多一帧在途 —— 再怎么重绘也不该堆出第二帧
    const before = framesOf(client).length;
    for (let i = 5; i < 12; i++) await paint(i);
    await new Promise((r) => setTimeout(r, 600));
    expect(framesOf(client).length).toBe(before);
    expect(before).toBe(1);

    // ack 之后才放行下一帧
    const first = framesOf(client)[0];
    expect(first.seq).toBe(1);
    client.send({ t: 'browser:frameAck', tabId: first.tabId, seq: first.seq });
    for (let i = 12; i < 16; i++) await paint(i);
    await waitFor(() => framesOf(client).length >= 2, 8000);
    expect(framesOf(client)[1].seq).toBe(2);

    await client.rpc('browser.stopPreview', { tabId });
    client.close();
  }, 60_000);

  it('🔴 帧只推给发起预览的客户端(别人没要画面,不占它的隧道)', async () => {
    const viewer = new TestClient(host!.url());
    const bystander = new TestClient(host!.url());
    await viewer.handshake();
    await bystander.handshake();

    const { tabId } = (await viewer.rpc('browser.navigate', { url: PAGE })) as {
      tabId: string;
    };
    await viewer.rpc('browser.startPreview', { tabId });
    for (let i = 0; i < 5; i++) {
      await viewer.rpc('browser.eval', {
        tabId,
        code: `document.body.style.background='hsl(${i * 40},70%,60%)'`,
      });
    }
    await waitFor(() => framesOf(viewer).length >= 1, 8000);
    expect(framesOf(bystander)).toHaveLength(0);

    // 旁观者也不能替发起方推进背压(frameAck 认归属)
    const first = framesOf(viewer)[0];
    bystander.send({ t: 'browser:frameAck', tabId: first.tabId, seq: first.seq });
    for (let i = 5; i < 10; i++) {
      await viewer.rpc('browser.eval', {
        tabId,
        code: `document.body.style.background='hsl(${i * 40},70%,60%)'`,
      });
    }
    await new Promise((r) => setTimeout(r, 500));
    expect(framesOf(viewer)).toHaveLength(1); // 仍卡在等**发起方**的 ack

    await viewer.rpc('browser.stopPreview', { tabId });
    viewer.close();
    bystander.close();
  }, 60_000);

  it('🔴 客户端断开 → 它开的预览随之停(别对着没人收的 sink 继续截帧)', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    const { tabId } = (await client.rpc('browser.navigate', { url: PAGE })) as {
      tabId: string;
    };
    await client.rpc('browser.startPreview', { tabId });
    expect(host!.core.browser.previewing).toBe(true);

    client.close();
    await waitFor(() => host!.core.browser.previewing === false, 5000);
    expect(host!.core.browser.previewing).toBe(false);
    // 浏览器与标签本身不动:agent 可能还在用
    expect(host!.core.browser.status().running).toBe(true);
  }, 60_000);

  it('预览态下的输入经 RPC 真的作用到页面', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    const { tabId } = (await client.rpc('browser.navigate', { url: PAGE })) as {
      tabId: string;
    };
    await client.rpc('browser.waitFor', { tabId, selector: '#go', timeoutMs: 5000 });
    const { value: box } = (await client.rpc('browser.eval', {
      tabId,
      code: `(() => { const r = document.getElementById('go').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    })) as { value: { x: number; y: number } };

    for (const type of ['mousePressed', 'mouseReleased']) {
      await client.rpc('browser.input', {
        tabId,
        event: { kind: 'mouse', type, x: box.x, y: box.y, button: 'left', clickCount: 1 },
      });
    }
    const { value: title } = (await client.rpc('browser.eval', {
      tabId,
      code: 'document.title',
    })) as { value: unknown };
    expect(title).toBe('clicked');
    client.close();
  }, 60_000);

  it('畸形输入被 host 拒绝,不撕掉 CDP 连接(后续 RPC 照常)', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    const { tabId } = (await client.rpc('browser.navigate', { url: PAGE })) as {
      tabId: string;
    };
    await expect(
      client.rpc('browser.input', {
        tabId,
        event: { kind: 'mouse', type: 'teleport', x: 1, y: 1 },
      }),
    ).rejects.toThrow(/bad mouse event/);

    // 连接还活着:再发一条正常 RPC 应当照常返回
    await expect(client.rpc('browser.getText', { tabId })).resolves.toMatchObject({
      text: expect.stringContaining('cloud rpc'),
    });
    client.close();
  }, 60_000);

  it('browser.shutdown 关掉浏览器,后续调用重新懒启动', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    await client.rpc('browser.navigate', { url: PAGE });
    expect(host!.core.browser.status().running).toBe(true);

    await client.rpc('browser.shutdown');
    expect(host!.core.browser.status().running).toBe(false);

    await client.rpc('browser.listTabs');
    expect(host!.core.browser.status().running).toBe(true);
    client.close();
  }, 60_000);
});
