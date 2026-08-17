// 预览帧率实测(默认 skip):量的是「ack 门控 + 独立通道」下的真实到帧速率。
//
// 🔴 结论先写在这里,免得每次都要重跑:帧率被**往返时间**钉死,不是被 Chromium 的
// 产帧能力钉死。窗口=1 意味着 一帧周期 = 网络往返 + 本地解码绘制 + ack 回程,
// 所以 fps ≈ 1000 / (RTT + 渲染耗时)。本机环回(RTT≈0)量到的是这套实现的上限。
//
//   OKWORK_TEST_REAL_CHROMIUM=1 npx vitest run src/host/__tests__/browserFrameRate.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { decodeBrowserFrame, encodeFrameAck } from '../../shared/browserFrameCodec';
import { startTestHost, type TestHost } from './wsTestHarness';
import { TestClient } from './wsTestHarness';

const enabled = process.env.OKWORK_TEST_REAL_CHROMIUM === '1';

/** 一个持续重绘的页面:用 rAF 改背景色,保证 Chromium 一直有新帧可产。 */
const ANIMATED_PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><meta charset="utf-8"><title>fps probe</title>
<body style="margin:0">
<div id="box" style="width:100vw;height:100vh"></div>
<script>
  let i = 0;
  function tick() {
    i = (i + 7) % 360;
    document.getElementById('box').style.background = 'hsl(' + i + ',80%,50%)';
    requestAnimationFrame(tick);
  }
  tick();
</script>
</body>`)}`;

let host: TestHost | null = null;

beforeAll(async () => {
  if (!enabled) return;
  host = await startTestHost({ mode: 'standalone' });
});

afterAll(async () => {
  if (!host) return;
  host.core.browser.dispose();
  await host.close();
});

describe.skipIf(!enabled)('预览帧率(默认 skip)', () => {
  it('量一段窗口内的到帧数 + 帧间隔分布', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    const streamId = crypto.randomUUID();

    const url = new URL(host!.url());
    url.pathname = '/frames';
    url.searchParams.set('sid', streamId);
    const ws = new WebSocket(url.toString());
    const arrivals: number[] = [];
    let bytes = 0;
    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      const decoded = decodeBrowserFrame(new Uint8Array(raw));
      if (!decoded) return;
      arrivals.push(Date.now());
      bytes += decoded.data.length;
      // 立刻 ack(等价「渲染很快」的理想客户端:量的是链路+实现的上限)
      ws.send(encodeFrameAck({ tabId: decoded.header.tabId, seq: decoded.header.seq }));
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const { tabId } = (await client.rpc('browser.navigate', { url: ANIMATED_PAGE })) as {
      tabId: string;
    };
    await client.rpc('browser.resize', { tabId, width: 1280, height: 800 });
    await client.rpc('browser.startPreview', { tabId, streamId });

    const MEASURE_MS = 4000;
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, MEASURE_MS));
    const elapsed = Date.now() - startedAt;

    const fps = (arrivals.length / elapsed) * 1000;
    const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
    const p90 = gaps[Math.floor(gaps.length * 0.9)] ?? 0;
    const avgKb = arrivals.length ? bytes / arrivals.length / 1024 : 0;

    console.log(
      `[fps] ${fps.toFixed(1)} fps · 帧数=${arrivals.length}/${elapsed}ms · ` +
        `帧间隔 中位=${median}ms p90=${p90}ms · 平均帧=${avgKb.toFixed(1)}KB · ` +
        `≈${((bytes / elapsed) * 1000 / 1024 / 1024).toFixed(2)}MB/s`,
    );

    // 本机环回下不该低到个位数——真低了说明实现里有多余的串行等待
    expect(arrivals.length).toBeGreaterThan(10);

    await client.rpc('browser.stopPreview', { tabId });
    ws.close();
    client.close();
  }, 60_000);

  // 🔴 证一件事:窗口=1 时帧率 ≈ 1000/RTT,与 Chromium 能产多少帧无关。
  // 跨境 200ms 的链路上,这套实现的天花板就是 5fps —— 是否够用要按这个数判断,
  // 不能拿本机环回的 ~100fps 骗自己。
  it('人为给 ack 加延迟(模拟 RTT)→ 帧率按 1000/RTT 塌下来', async () => {
    const client = new TestClient(host!.url());
    await client.handshake();
    const streamId = crypto.randomUUID();
    const FAKE_RTT_MS = 100;

    const url = new URL(host!.url());
    url.pathname = '/frames';
    url.searchParams.set('sid', streamId);
    const ws = new WebSocket(url.toString());
    let count = 0;
    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      const decoded = decodeBrowserFrame(new Uint8Array(raw));
      if (!decoded) return;
      count++;
      // 延迟 ack = 把往返时间搬到本地来模拟
      setTimeout(
        () => ws.send(encodeFrameAck({ tabId: decoded.header.tabId, seq: decoded.header.seq })),
        FAKE_RTT_MS,
      );
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const { tabId } = (await client.rpc('browser.navigate', { url: ANIMATED_PAGE })) as {
      tabId: string;
    };
    await client.rpc('browser.startPreview', { tabId, streamId });

    const MEASURE_MS = 3000;
    await new Promise((r) => setTimeout(r, MEASURE_MS));
    const fps = (count / MEASURE_MS) * 1000;
    const ceiling = 1000 / FAKE_RTT_MS;
    console.log(
      `[fps] 模拟 RTT=${FAKE_RTT_MS}ms → ${fps.toFixed(1)} fps(理论上限 ${ceiling} fps)`,
    );

    // 帧率贴着 1000/RTT 的天花板,不会超过它
    expect(fps).toBeLessThanOrEqual(ceiling * 1.2);
    expect(fps).toBeGreaterThan(ceiling * 0.5);

    await client.rpc('browser.stopPreview', { tabId });
    ws.close();
    client.close();
  }, 60_000);
});
