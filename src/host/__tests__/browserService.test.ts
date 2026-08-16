// 云端浏览器服务:懒启动/幂等/回收 + 控制原语落到正确的 CDP 调用。
// 全程用 fakeChromium(真 CdpConnection + 假进程与假 ws),不起真浏览器。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserService, BrowserUnavailableError } from '../browserService';
import { fakeChromium } from './fakeChromium';

const DATA_DIR = path.join(os.tmpdir(), 'okwork-browser-test');

function setup(over: {
  chromium?: ReturnType<typeof fakeChromium>;
  locate?: () => string | null;
  idleTimeoutMs?: number;
} = {}) {
  const chromium = over.chromium ?? fakeChromium();
  const launches: string[] = [];
  const service = new BrowserService({
    dataDir: DATA_DIR,
    locate: over.locate ?? (() => '/usr/bin/chromium'),
    launch: (exe) => {
      launches.push(exe);
      return chromium.launch();
    },
    connect: () => chromium.connect(),
    platform: 'linux',
    isRoot: false,
    idleTimeoutMs: over.idleTimeoutMs ?? 0,
    logger: { log: () => undefined, error: () => undefined },
  });
  return { chromium, service, launches };
}

/** 某方法被调用的次数(fakeChromium 记录了全部 CDP 调用) */
const countOf = (chromium: ReturnType<typeof fakeChromium>, method: string) =>
  chromium.calls.filter((c) => c.method === method).length;

/**
 * profile 锁在不在。
 * 🔴 不能用 existsSync:SingletonLock 是指向 `host-<pid>` 的符号链接,那个目标从来
 * 不存在,existsSync 跟随链接后恒返回 false。lstat 才看得见链接本身。
 */
function lockExists(chromiumDir: string): boolean {
  try {
    fs.lstatSync(path.join(chromiumDir, 'SingletonLock'));
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('BrowserService 生命周期', () => {
  it('🔴 status 只探测不启动:看一眼不该在用户服务器上拉起浏览器进程', () => {
    const { chromium, service } = setup();
    const status = service.status();
    expect(status).toMatchObject({
      available: true,
      executablePath: '/usr/bin/chromium',
      running: false,
    });
    expect(chromium.calls).toHaveLength(0);
    expect(chromium.killed).toBe(false);
  });

  it('远端没装 Chromium → available=false + 安装指引;调用方法抛可读错误', async () => {
    const { service } = setup({ locate: () => null });
    const status = service.status();
    expect(status.available).toBe(false);
    expect(status.executablePath).toBeNull();
    expect(status.hint).toBeTruthy();
    await expect(service.listTabs()).rejects.toBeInstanceOf(BrowserUnavailableError);
    await expect(service.listTabs()).rejects.toThrow(/no Chromium found/);
  });

  it('🔴 懒启动 + 幂等:并发首调只起一个进程(两个 agent 同时开工不该起两份)', async () => {
    const { chromium, service, launches } = setup();
    expect(launches).toHaveLength(0); // 构造完还没起

    const [a, b, c] = await Promise.all([
      service.openTab('https://a.test'),
      service.openTab('https://b.test'),
      service.listTabs(),
    ]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(Array.isArray(c)).toBe(true);
    // 三个并发首调共享同一次启动(starting 共享 Promise);否则远端会多出两个 Chromium
    expect(launches).toEqual(['/usr/bin/chromium']);
    expect(service.status().running).toBe(true);
    expect(countOf(chromium, 'Target.createTarget')).toBe(2);

    // 已就绪后继续调用也不再启动
    await service.listTabs();
    expect(launches).toHaveLength(1);
  });

  it('shutdown 先优雅关(Browser.close)再 SIGKILL 兜底,且幂等', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    await service.shutdown();
    expect(countOf(chromium, 'Browser.close')).toBe(1);
    expect(chromium.killed).toBe(true);
    expect(service.status().running).toBe(false);
    await expect(service.shutdown()).resolves.toBeUndefined(); // 幂等
  });

  it('Chromium 自己死了(OOM kill)→ 状态归零,下次调用重新拉起', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    expect(service.status().running).toBe(true);

    chromium.die(137);
    expect(service.status().running).toBe(false);

    // 重新拉起(新的假进程)——不能因为上一个死了就永久瘫痪
    const second = fakeChromium();
    const revived = new BrowserService({
      dataDir: DATA_DIR,
      locate: () => '/usr/bin/chromium',
      launch: () => second.launch(),
      connect: () => second.connect(),
      idleTimeoutMs: 0,
      logger: { log: () => undefined, error: () => undefined },
    });
    await expect(revived.openTab()).resolves.toBeTruthy();
  });

  it('空闲超时 → 自动回收(远端内存不是免费的);有活动则顺延', async () => {
    vi.useFakeTimers();
    const { chromium, service } = setup({ idleTimeoutMs: 60_000 });
    await service.openTab();
    expect(service.status().running).toBe(true);

    // 59s 时又有调用 → 计时重置,不该回收
    await vi.advanceTimersByTimeAsync(59_000);
    await service.listTabs();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(service.status().running).toBe(true);

    // 此后彻底静默 → 到点回收
    await vi.advanceTimersByTimeAsync(61_000);
    expect(service.status().running).toBe(false);
    expect(chromium.killed).toBe(true);
  });

  it('dispose 同步 kill(host 退出路径不能留僵尸 Chromium)', async () => {
    const { chromium, service } = setup();
    await service.openTab();
    service.dispose();
    expect(chromium.killed).toBe(true);
    await expect(service.openTab()).rejects.toThrow(/disposed/);
  });

  // profile 锁是「上一个实例被 SIGKILL / OOM killer 干掉」的残留。远端内存紧张时这是
  // 常态,不能让一次 OOM 把云端浏览器永久钉死(退出码 21,起一次死一次)。
  it('主人已经不在的陈旧锁 → 启动前直接清掉', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-lock-stale-'));
    const chromiumDir = path.join(dataDir, 'chromium');
    fs.mkdirSync(chromiumDir, { recursive: true });
    // pid 999999 几乎不可能存在 → 判定陈旧
    fs.symlinkSync('host-999999', path.join(chromiumDir, 'SingletonLock'));

    const chromium = fakeChromium();
    const service = new BrowserService({
      dataDir,
      locate: () => '/usr/bin/chromium',
      launch: () => chromium.launch(),
      connect: () => chromium.connect(),
      idleTimeoutMs: 0,
      logger: { log: () => undefined, error: () => undefined },
    });

    await expect(service.openTab()).resolves.toBeTruthy();
    expect(lockExists(chromiumDir)).toBe(false);
    service.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // 🔴 SIGKILL 之后进程短时间内仍在进程表里(没被回收),kill(pid,0) 照样成功 ——
  // 陈旧判定在这个时机会误判成「主人还在」。所以要按「是不是我们自己启动过的 pid」再兜一层。
  it('🔴 锁的主人还「活着」但正是我们自己启动的 → 撞锁后清掉重试,不永久起不来', async () => {
    vi.useFakeTimers();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-lock-own-'));
    const chromiumDir = path.join(dataDir, 'chromium');
    fs.mkdirSync(chromiumDir, { recursive: true });
    // 主人 = 当前进程(必然存活),同时让假 Chromium 也用这个 pid = 「我们启动的」
    fs.symlinkSync(`host-${process.pid}`, path.join(chromiumDir, 'SingletonLock'));

    let attempts = 0;
    const good = fakeChromium({ pid: process.pid });
    const service = new BrowserService({
      dataDir,
      locate: () => '/usr/bin/chromium',
      launch: () => {
        attempts++;
        if (lockExists(chromiumDir)) {
          const dead = fakeChromium({ announceEndpoint: false, pid: process.pid });
          queueMicrotask(() =>
            dead.stderrExit(21, 'Failed to create SingletonLock: File exists (17)'),
          );
          return dead.proc;
        }
        return good.launch();
      },
      connect: () => good.connect(),
      idleTimeoutMs: 0,
      logger: { log: () => undefined, error: () => undefined },
    });

    const openPromise = service.openTab();
    await vi.advanceTimersByTimeAsync(3000); // 走完重试退避
    await expect(openPromise).resolves.toBeTruthy();
    expect(attempts).toBeGreaterThan(1);
    expect(lockExists(chromiumDir)).toBe(false);

    service.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('🔴 别人的实例活着占着 profile 锁 → 不动它,如实报错', async () => {
    vi.useFakeTimers();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-lock-other-'));
    const chromiumDir = path.join(dataDir, 'chromium');
    fs.mkdirSync(chromiumDir, { recursive: true });
    // 主人存活(当前进程),但我们启动的假进程 pid 是 4242 → 不是我们的锁
    fs.symlinkSync(`host-${process.pid}`, path.join(chromiumDir, 'SingletonLock'));

    const service = new BrowserService({
      dataDir,
      locate: () => '/usr/bin/chromium',
      launch: () => {
        const dead = fakeChromium({ announceEndpoint: false });
        queueMicrotask(() =>
          dead.stderrExit(21, 'Failed to create SingletonLock: File exists (17)'),
        );
        return dead.proc;
      },
      connect: () => fakeChromium().connect(),
      idleTimeoutMs: 0,
      logger: { log: () => undefined, error: () => undefined },
    });

    const p = service.openTab();
    const assertion = expect(p).rejects.toThrow(/SingletonLock/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    // 别人的锁必须原样留着:删了会两个实例共写同一个 profile
    expect(lockExists(chromiumDir)).toBe(true);

    service.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('Chromium 起来了但不报 DevTools endpoint → 超时并 kill,不静默挂住', async () => {
    vi.useFakeTimers();
    const silent = fakeChromium({ announceEndpoint: false });
    const { service } = setup({ chromium: silent });
    const p = service.openTab();
    const assertion = expect(p).rejects.toThrow(/DevTools endpoint/);
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    expect(silent.killed).toBe(true);
  });
});

describe('BrowserService 标签与控制原语', () => {
  it('listTabs 只报 page 类 target,并标出活跃标签', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    const first = await service.openTab('https://a.test');
    const second = await service.openTab('https://b.test');
    // 混进一个非 page target(service worker 一类),不该出现在标签列表里
    chromium.targets.push({
      targetId: 'sw-1',
      url: 'https://a.test/sw.js',
      title: 'sw',
      type: 'service_worker',
    });

    const tabs = await service.listTabs();
    expect(tabs.map((t) => t.tabId)).toEqual([first, second]);
    expect(tabs.find((t) => t.tabId === second)?.active).toBe(true);
    expect(tabs.find((t) => t.tabId === first)?.active).toBe(false);
  });

  it('navigate 省略 tabId:没有标签时自动开一个,并成为活跃标签', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    const tabId = await service.navigate('https://example.test/login');
    expect(tabId).toBeTruthy();
    expect(countOf(chromium, 'Target.createTarget')).toBe(1);
    const nav = chromium.calls.find((c) => c.method === 'Page.navigate');
    expect(nav?.params).toMatchObject({ url: 'https://example.test/login' });
    // 后续调用复用同一标签,不再新开
    await service.navigate('https://example.test/next');
    expect(countOf(chromium, 'Target.createTarget')).toBe(1);
  });

  it('navigate 失败(errorText)→ 抛,不当成功返回', async () => {
    const chromium = fakeChromium({
      override: (method) =>
        method === 'Page.navigate' ? { errorText: 'net::ERR_NAME_NOT_RESOLVED' } : undefined,
    });
    const { service } = setup({ chromium });
    await expect(service.navigate('https://nope.invalid')).rejects.toThrow(
      /ERR_NAME_NOT_RESOLVED/,
    );
  });

  it('每个标签只 attach 一次(session 复用,不给 Chromium 攒 fd)', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    const tabId = await service.openTab();
    await service.getText(tabId);
    await service.getHtml(tabId);
    await service.scroll(100, tabId);
    expect(countOf(chromium, 'Target.attachToTarget')).toBe(1);
  });

  it('🔴 click 派发真实鼠标事件(过得了只认 isTrusted 的站点),坐标取元素中心', async () => {
    const chromium = fakeChromium({
      override: (method, params) =>
        method === 'Runtime.evaluate' && String(params.expression).includes('getBoundingClientRect')
          ? { result: { type: 'object', value: { x: 120.4, y: 240.6 } } }
          : undefined,
    });
    const { service } = setup({ chromium });
    await expect(service.click('#submit')).resolves.toBe(true);

    const mouse = chromium.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((c) => c.params.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased',
    ]);
    // 坐标取整后的元素中心
    expect(mouse[1].params).toMatchObject({ x: 120, y: 241, button: 'left', clickCount: 1 });
  });

  it('零尺寸元素拿不到坐标 → 回退 DOM click(不是直接失败)', async () => {
    const chromium = fakeChromium({
      override: (method, params) =>
        method === 'Runtime.evaluate' && String(params.expression).includes('getBoundingClientRect')
          ? { result: { type: 'object', value: null } }
          : undefined,
    });
    const { service } = setup({ chromium });
    await expect(service.click('#ghost')).resolves.toBe(true);
    expect(countOf(chromium, 'Input.dispatchMouseEvent')).toBe(0);
    const fallback = chromium.calls.filter(
      (c) => c.method === 'Runtime.evaluate' && String(c.params.expression).includes('.click()'),
    );
    expect(fallback).toHaveLength(1);
  });

  it('元素不存在 → 页面里抛的错原样冒出来(agent 依赖这句文案定位问题)', async () => {
    const chromium = fakeChromium({
      override: (method) =>
        method === 'Runtime.evaluate'
          ? {
              exceptionDetails: {
                exception: { description: 'Error: element not found: #nope\n    at <anonymous>' },
              },
            }
          : undefined,
    });
    const { service } = setup({ chromium });
    await expect(service.click('#nope')).rejects.toThrow('Error: element not found: #nope');
  });

  it('type 走 Input.insertText 真实输入(不是 setter hack),并补一发 change', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    await service.typeText('#user', 'alice@okok.ai');
    const insert = chromium.calls.find((c) => c.method === 'Input.insertText');
    expect(insert?.params).toMatchObject({ text: 'alice@okok.ai' });
    const changeEval = chromium.calls.filter(
      (c) => c.method === 'Runtime.evaluate' && String(c.params.expression).includes("Event('change'"),
    );
    expect(changeEval).toHaveLength(1);
  });

  it('空文本不发 insertText(清空输入框是合法用法,不该塞个空串事件)', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    await service.typeText('#user', '');
    expect(countOf(chromium, 'Input.insertText')).toBe(0);
  });

  it('screenshot 返回裸 base64,且截图前把目标页带到前台', async () => {
    const { chromium, service } = setup();
    await expect(service.screenshot()).resolves.toBe('ZmFrZS1wbmc=');
    // 多标签时 headless 只有前台页能截图(真 Chromium 会回 "Not attached to an
    // active page")——bringToFront 必须先于 captureScreenshot
    const order = chromium.calls
      .map((c) => c.method)
      .filter((m) => m === 'Page.bringToFront' || m === 'Page.captureScreenshot');
    expect(order).toEqual(['Page.bringToFront', 'Page.captureScreenshot']);
  });

  it('waitFor 的轮询在页面里跑,超时预算钳到上限(不给 CDP 通道压往返)', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    await service.waitFor('#ready', 999_999_999);
    const evals = chromium.calls.filter((c) => c.method === 'Runtime.evaluate');
    const waiting = evals.find((c) => String(c.params.expression).includes('setInterval'));
    expect(waiting).toBeTruthy();
    // 页面里的 deadline 用的是钳后预算(120s),不是 agent 传进来的天文数字
    expect(String(waiting?.params.expression)).toContain('120000');
    expect(waiting?.params.awaitPromise).toBe(true);
  });

  // 页面自己 window.close 后,活跃标签指向一个已经不存在的 target。session 是缓存的,
  // 死标签不会触发重新 attach —— 不自愈的话后续命令会一直打向不存在的 session,
  // 这台机器的浏览器就此永久失灵。
  it('🔴 标签被页面自己关掉(targetDestroyed)→ 清缓存并自动重开,不永久瘫痪', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });

    const tabId = await service.openTab('https://a.test');
    await service.getText(tabId); // 建立 session 缓存
    expect(countOf(chromium, 'Target.attachToTarget')).toBe(1);

    // 页面自己关掉:Chromium 推 targetDestroyed
    chromium.targets.length = 0;
    chromium.event('Target.targetDestroyed', { targetId: tabId });

    // 省略 tabId 的调用自愈:开新标签 + 重新 attach
    await expect(service.getText()).resolves.toBeTruthy();
    expect(countOf(chromium, 'Target.createTarget')).toBe(2);
    expect(countOf(chromium, 'Target.attachToTarget')).toBe(2);
  });

  it('标签消失时它的预览一并停掉(不对着不存在的页面留推流态)', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    const tabId = await service.startPreview(() => undefined);
    expect(service.previewing).toBe(true);

    chromium.event('Target.targetDestroyed', { targetId: tabId });
    expect(service.previewing).toBe(false);
  });

  it('attach 失败也有兜底:省略 tabId 时换新标签,指名的仍照实报错', async () => {
    let dead = '';
    const chromium = fakeChromium({
      override: (method, params) =>
        method === 'Target.attachToTarget' && params.targetId === dead
          ? new Error('No target with given id found')
          : undefined,
    });
    const { service } = setup({ chromium });
    dead = await service.openTab('https://a.test');

    await expect(service.getText()).resolves.toBeTruthy(); // 自愈
    await expect(service.getText(dead)).rejects.toThrow(/No target with given id/);
  });

  it('closeTab 清掉缓存的 session,活跃标签跟着让位', async () => {
    const chromium = fakeChromium();
    const { service } = setup({ chromium });
    const tabId = await service.openTab();
    await service.getText(tabId); // 触发 attach
    await service.closeTab(tabId);
    expect(chromium.targets.find((t) => t.targetId === tabId)).toBeUndefined();

    // 再用同名 tab 会重新 attach(而不是拿着已死的 session 发命令)
    chromium.targets.push({ targetId: tabId, url: 'about:blank', title: '', type: 'page' });
    await service.getText(tabId);
    expect(countOf(chromium, 'Target.attachToTarget')).toBe(2);
  });
});
