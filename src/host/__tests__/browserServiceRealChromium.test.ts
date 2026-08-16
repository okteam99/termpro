// 真 Chromium 集成验证:证明我们对 CDP 的假设本身成立(flatten attach、
// Runtime.evaluate 的 returnByValue、Input.insertText 触发真实输入事件……)。
// 单测里的 fakeChromium 只能证明「代码符合我的假设」,证不了假设对不对。
//
// 默认 skip:CI 机器上没有浏览器,也不该为跑测试去装。本地验证用
//   OKWORK_TEST_REAL_CHROMIUM=1 npx vitest run src/host/__tests__/browserServiceRealChromium.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserService } from '../browserService';
import { locateChromium } from '../chromiumLocator';

const enabled = process.env.OKWORK_TEST_REAL_CHROMIUM === '1';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-real-chromium-'));
const service = new BrowserService({ dataDir, idleTimeoutMs: 0 });

afterAll(() => {
  service.dispose();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** 用 data: URL 喂一张自带表单的页面,不依赖任何外部网络。 */
const PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><meta charset="utf-8"><title>okwork cdp probe</title>
<body>
  <h1 id="title">cloud browser</h1>
  <input id="user" />
  <button id="go" onclick="document.getElementById('out').textContent = 'clicked:' + (window.__trusted ? 'trusted' : 'synthetic')">go</button>
  <div id="out"></div>
  <div id="typed"></div>
  <script>
    document.getElementById('go').addEventListener('click', (e) => { window.__trusted = e.isTrusted; }, true);
    document.getElementById('user').addEventListener('input', (e) => {
      document.getElementById('typed').textContent = e.target.value + '|trusted=' + e.isTrusted;
    });
    setTimeout(() => {
      const d = document.createElement('div');
      d.id = 'late';
      d.textContent = 'late element';
      document.body.appendChild(d);
    }, 300);
  </script>
</body>`)}`;

describe.skipIf(!enabled)('真 Chromium 端到端(默认 skip)', () => {
  it('本机能找到 Chromium(找不到就没法跑这组)', () => {
    expect(locateChromium()).toBeTruthy();
    expect(service.status().available).toBe(true);
  });

  it('懒启动 → 导航 → 取文本/HTML(证明 attach+evaluate 的假设成立)', async () => {
    const tabId = await service.navigate(PAGE);
    expect(tabId).toBeTruthy();
    await service.waitFor('#title', 5000, tabId);

    const text = await service.getText(tabId);
    expect(text).toContain('cloud browser');
    const html = await service.getHtml(tabId);
    expect(html).toContain('<title>okwork cdp probe</title>');
  }, 60_000);

  it('🔴 click 是真实事件:页面读到的 isTrusted 必须为 true', async () => {
    await service.navigate(PAGE);
    await service.waitFor('#go');
    await service.click('#go');
    // 真实 Input.dispatchMouseEvent → isTrusted=true;若退化成 el.click() 会是 synthetic
    const out = await service.evaluate('document.getElementById("out").textContent');
    expect(out).toBe('clicked:trusted');
  }, 60_000);

  it('🔴 type 是真实输入:值落到 input 且事件 isTrusted', async () => {
    await service.navigate(PAGE);
    await service.waitFor('#user');
    await service.typeText('#user', 'alice@okok.ai');
    const value = await service.evaluate('document.getElementById("user").value');
    expect(value).toBe('alice@okok.ai');
    const typed = await service.evaluate('document.getElementById("typed").textContent');
    expect(typed).toBe('alice@okok.ai|trusted=true');
  }, 60_000);

  it('waitFor 等得到延迟出现的元素,等不到的会超时报错', async () => {
    await service.navigate(PAGE);
    await expect(service.waitFor('#late', 5000)).resolves.toBe(true);
    await expect(service.waitFor('#never-ever', 500)).rejects.toThrow(/timeout waiting for/);
  }, 60_000);

  it('screenshot 返回真 PNG(魔数校验,不是随便一串 base64)', async () => {
    await service.navigate(PAGE);
    const base64 = await service.screenshot();
    const buf = Buffer.from(base64, 'base64');
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }, 60_000);

  it('多标签:开/列/关,tabId 就是 CDP targetId', async () => {
    const a = await service.openTab(PAGE);
    const b = await service.openTab('about:blank');
    const tabs = await service.listTabs();
    expect(tabs.map((t) => t.tabId)).toEqual(expect.arrayContaining([a, b]));
    expect(tabs.find((t) => t.tabId === b)?.active).toBe(true);

    await service.closeTab(b);
    expect((await service.listTabs()).map((t) => t.tabId)).not.toContain(b);
  }, 60_000);

  it('页面里抛的错原样冒出来(元素不存在的文案要能指导 agent)', async () => {
    await service.navigate(PAGE);
    await expect(service.click('#nonexistent')).rejects.toThrow(/element not found: #nonexistent/);
  }, 60_000);

  it('🔴 预览:真 screencast 出真 JPEG 帧,ack 后续帧继续来', async () => {
    const tabId = await service.navigate(PAGE);
    await service.waitFor('#title', 5000, tabId);

    const frames: Array<{ seq: number; data: string }> = [];
    await service.startPreview((f) => frames.push(f), { tabId });

    // 让页面动起来(screencast 只在有重绘时产帧)
    for (let i = 0; i < 6 && frames.length < 3; i++) {
      await service.evaluate(`document.body.style.background = 'hsl(${i * 60},80%,50%)'`, tabId);
      // 每收到一帧就 ack,放行下一帧
      for (const f of frames) service.ackFrame(tabId, f.seq);
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(frames.length).toBeGreaterThan(0);
    // JPEG 魔数 FF D8 FF
    const buf = Buffer.from(frames[0].data, 'base64');
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(frames[0].seq).toBe(1);

    service.stopPreview(tabId);
    expect(service.previewing).toBe(false);
  }, 60_000);

  it('🔴 预览输入:转发的点击真的作用到页面上(isTrusted)', async () => {
    const tabId = await service.navigate(PAGE);
    await service.waitFor('#go', 5000, tabId);
    // 取按钮中心坐标,按预览态的方式派发(与 UI 转发同一条路径)
    const box = (await service.evaluate(
      `(() => { const r = document.getElementById('go').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      tabId,
    )) as { x: number; y: number };

    await service.dispatchInput({ kind: 'mouse', type: 'mouseMoved', x: box.x, y: box.y }, tabId);
    await service.dispatchInput(
      { kind: 'mouse', type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 },
      tabId,
    );
    await service.dispatchInput(
      { kind: 'mouse', type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 },
      tabId,
    );
    await expect(
      service.evaluate('document.getElementById("out").textContent', tabId),
    ).resolves.toBe('clicked:trusted');

    // 键盘同理:聚焦输入框后逐字符打进去
    await service.evaluate('document.getElementById("user").focus()', tabId);
    for (const ch of 'hi') {
      await service.dispatchInput({ kind: 'key', type: 'char', text: ch }, tabId);
    }
    await expect(
      service.evaluate('document.getElementById("user").value', tabId),
    ).resolves.toBe('hi');
  }, 60_000);

  it('resize 真的改变页面看到的视口宽度', async () => {
    const tabId = await service.navigate(PAGE);
    await service.resizeViewport(900, 600, 1, tabId);
    await expect(service.evaluate('window.innerWidth', tabId)).resolves.toBe(900);
    await expect(service.evaluate('window.innerHeight', tabId)).resolves.toBe(600);
  }, 60_000);

  // 假替身只能证明「收到 targetDestroyed 会清缓存」,证不了 Chromium 真的发这个事件。
  it('🔴 页面 window.close 自关后仍能继续用(targetDestroyed 真的到达)', async () => {
    const tabId = await service.openTab(PAGE);
    await service.waitFor('#title', 5000, tabId);
    await service.getText(tabId); // 建立 session 缓存

    // 页面把自己关掉(agent 驱动的站点里很常见:弹窗流程走完自动 close)
    await service.evaluate('setTimeout(() => window.close(), 0)', tabId).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));

    // 不带 tabId 的调用必须还能用 —— 不能因为一次自关就永久失灵
    const revived = await service.navigate(PAGE);
    expect(revived).not.toBe(tabId);
    await expect(service.getText(revived)).resolves.toContain('cloud browser');
  }, 60_000);

  it('shutdown 后进程真的没了,再调用会重新拉起', async () => {
    await service.navigate(PAGE);
    expect(service.status().running).toBe(true);
    await service.shutdown();
    expect(service.status().running).toBe(false);
    await service.navigate(PAGE);
    expect(service.status().running).toBe(true);
  }, 60_000);
});
