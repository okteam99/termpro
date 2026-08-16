// Chromium 定位优先级 + 启动参数 + DevTools endpoint 解析。纯函数,注入假 fs。
import { describe, expect, it } from 'vitest';
import {
  buildChromiumArgs,
  chromiumInstallHint,
  locateChromium,
  parseDevToolsEndpoint,
  type ChromiumLocatorDeps,
} from '../chromiumLocator';

function deps(over: Partial<ChromiumLocatorDeps> & { files?: string[] }): ChromiumLocatorDeps {
  const files = new Set(over.files ?? []);
  const dirs = new Map<string, string[]>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/') || '/';
      const child = parts[i];
      const list = dirs.get(dir) ?? [];
      if (!list.includes(child)) list.push(child);
      dirs.set(dir, list);
    }
  }
  return {
    platform: over.platform ?? 'linux',
    homedir: over.homedir ?? '/home/dev',
    env: over.env ?? {},
    exists: over.exists ?? ((p) => files.has(p)),
    listDir: over.listDir ?? ((p) => dirs.get(p) ?? []),
  };
}

describe('locateChromium', () => {
  it('OKWORK_CHROMIUM_PATH 优先于一切;指定了但不存在 → null(不再猜别的)', () => {
    const files = ['/custom/chrome', '/usr/bin/chromium'];
    expect(
      locateChromium(deps({ files, env: { OKWORK_CHROMIUM_PATH: '/custom/chrome' } })),
    ).toBe('/custom/chrome');
    // 用户明确指了一个不存在的路径 → 报没有,而不是悄悄回退到系统那份
    expect(
      locateChromium(deps({ files, env: { OKWORK_CHROMIUM_PATH: '/gone/chrome' } })),
    ).toBeNull();
  });

  it('linux 按常见路径顺序命中(google-chrome 优先于 chromium)', () => {
    expect(
      locateChromium(deps({ files: ['/usr/bin/chromium', '/usr/bin/google-chrome'] })),
    ).toBe('/usr/bin/google-chrome');
    expect(locateChromium(deps({ files: ['/usr/bin/chromium'] }))).toBe(
      '/usr/bin/chromium',
    );
  });

  it('darwin 走 .app 内的可执行文件', () => {
    const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(locateChromium(deps({ platform: 'darwin', files: [p] }))).toBe(p);
  });

  it('系统没有 → 回落 puppeteer 缓存(headless-shell 优先,同 flavor 取版本号靠后的)', () => {
    const base = '/home/dev/.cache/puppeteer';
    const older = `${base}/chrome-headless-shell/linux-120.0.0/chrome-headless-shell-linux64/chrome-headless-shell`;
    const newer = `${base}/chrome-headless-shell/linux-131.0.0/chrome-headless-shell-linux64/chrome-headless-shell`;
    expect(locateChromium(deps({ files: [older, newer] }))).toBe(newer);
  });

  it('哪儿都没有 → null,并给得出平台相关的安装指引', () => {
    expect(locateChromium(deps({ files: [] }))).toBeNull();
    expect(chromiumInstallHint('linux')).toMatch(/chromium/i);
    expect(chromiumInstallHint('darwin')).toMatch(/OKWORK_CHROMIUM_PATH/);
  });
});

describe('buildChromiumArgs', () => {
  it('端口恒为 0(同机多 host 并存,写死端口必冲突)+ userDataDir 跟着 Profile', () => {
    const args = buildChromiumArgs({
      userDataDir: '/data/profiles/p1',
      platform: 'linux',
      isRoot: false,
    });
    expect(args).toContain('--remote-debugging-port=0');
    expect(args).toContain('--user-data-dir=/data/profiles/p1');
    expect(args).toContain('--headless=new');
    // 容器里 /dev/shm 太小会让渲染进程直接崩
    expect(args).toContain('--disable-dev-shm-usage');
  });

  it('linux + root → --no-sandbox(容器默认 root,不关 sandbox 起不来);非 root 不加', () => {
    expect(
      buildChromiumArgs({ userDataDir: '/d', platform: 'linux', isRoot: true }),
    ).toContain('--no-sandbox');
    expect(
      buildChromiumArgs({ userDataDir: '/d', platform: 'linux', isRoot: false }),
    ).not.toContain('--no-sandbox');
    // macOS 上没有这个问题,root 也不加
    expect(
      buildChromiumArgs({ userDataDir: '/d', platform: 'darwin', isRoot: true }),
    ).not.toContain('--no-sandbox');
  });

  it('窗口尺寸与额外参数按需追加', () => {
    const args = buildChromiumArgs({
      userDataDir: '/d',
      platform: 'linux',
      isRoot: false,
      windowSize: { width: 1440, height: 900 },
      extraArgs: ['--proxy-server=socks5://127.0.0.1:1080'],
    });
    expect(args).toContain('--window-size=1440,900');
    expect(args).toContain('--proxy-server=socks5://127.0.0.1:1080');
  });
});

describe('parseDevToolsEndpoint', () => {
  it('从 stderr 抠出 browser 级 ws endpoint', () => {
    expect(
      parseDevToolsEndpoint(
        'DevTools listening on ws://127.0.0.1:45231/devtools/browser/6f0a-11ee\n',
      ),
    ).toBe('ws://127.0.0.1:45231/devtools/browser/6f0a-11ee');
  });

  it('无关输出 → null(启动噪声不该被误认成 endpoint)', () => {
    expect(parseDevToolsEndpoint('[0816/120000.1:ERROR:bus.cc(399)] Failed to connect')).toBeNull();
    expect(parseDevToolsEndpoint('')).toBeNull();
  });
});
