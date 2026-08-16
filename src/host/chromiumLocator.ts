// 远端 Chromium 定位:host 侧不下载浏览器,只**找**已有的那一份。
//
// 为什么不自动下载:host bundle 是经 SSH 部署的单文件 host.js,悄悄往用户服务器上拉
// 150MB+ 二进制、写进未声明的目录,是用户没同意过的事。找不到就明确报「没有」+ 给安装
// 指引,由用户决定装哪一份(apt/系统包/puppeteer 缓存都行)。
//
// 纯函数 + 注入 seam(exists):不碰真实 fs 即可单测优先级顺序。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 无头运行也需要的最小开关集(容器/无 X11 的服务器是主场景)。 */
export const CHROMIUM_BASE_ARGS: readonly string[] = [
  '--headless=new',
  '--disable-gpu',
  // 容器里常见的 /dev/shm 只有 64MB,Chromium 渲染大页面会直接崩
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  // 后台标签会被降频甚至冻结,agent 驱动的非活跃标签必须照常跑
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/** Linux 上以 root 跑(容器默认)时 sandbox 起不来,必须显式关掉。 */
export const CHROMIUM_NO_SANDBOX_ARG = '--no-sandbox';

const LINUX_CANDIDATES: readonly string[] = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/snap/bin/chromium',
];

const DARWIN_CANDIDATES: readonly string[] = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export interface ChromiumLocatorDeps {
  platform: NodeJS.Platform;
  homedir: string;
  env: Record<string, string | undefined>;
  exists(p: string): boolean;
  /** 列目录(用于扫 puppeteer 缓存的版本目录);不存在/不可读回空数组 */
  listDir(p: string): string[];
}

export const realLocatorDeps: ChromiumLocatorDeps = {
  platform: process.platform,
  homedir: os.homedir(),
  env: process.env,
  exists: (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  listDir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
};

/**
 * puppeteer / @puppeteer/browsers 的缓存布局:
 *   ~/.cache/puppeteer/chrome/<平台-版本>/chrome-<平台>/chrome
 *   ~/.cache/puppeteer/chrome-headless-shell/<平台-版本>/.../chrome-headless-shell
 * 版本目录名不可预测,只能扫。取排序末位(版本号字典序≈新的在后)。
 */
function puppeteerCacheCandidates(deps: ChromiumLocatorDeps): string[] {
  const root =
    deps.env.PUPPETEER_CACHE_DIR || path.join(deps.homedir, '.cache', 'puppeteer');
  const out: string[] = [];
  for (const flavor of ['chrome-headless-shell', 'chrome']) {
    const flavorDir = path.join(root, flavor);
    const versions = deps.listDir(flavorDir).sort();
    for (const version of versions.reverse()) {
      const versionDir = path.join(flavorDir, version);
      for (const inner of deps.listDir(versionDir)) {
        const innerDir = path.join(versionDir, inner);
        const binName =
          flavor === 'chrome-headless-shell' ? 'chrome-headless-shell' : 'chrome';
        out.push(path.join(innerDir, binName));
        // macOS 版 puppeteer 缓存里是 .app 包
        out.push(
          path.join(innerDir, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        );
      }
    }
  }
  return out;
}

/**
 * 找一份可用的 Chromium。优先级:
 *   ① OKWORK_CHROMIUM_PATH 显式指定(用户说了算,不再猜)
 *   ② 系统安装的 chrome/chromium(平台相关的常见路径)
 *   ③ puppeteer 缓存(用户跑过 `npx @puppeteer/browsers install` 的情况)
 * 都没有 → null,由调用方给安装引导。
 */
export function locateChromium(
  deps: ChromiumLocatorDeps = realLocatorDeps,
): string | null {
  const explicit = deps.env.OKWORK_CHROMIUM_PATH?.trim();
  if (explicit) return deps.exists(explicit) ? explicit : null;

  const system =
    deps.platform === 'darwin'
      ? DARWIN_CANDIDATES
      : deps.platform === 'linux'
        ? LINUX_CANDIDATES
        : [];
  for (const candidate of system) {
    if (deps.exists(candidate)) return candidate;
  }
  for (const candidate of puppeteerCacheCandidates(deps)) {
    if (deps.exists(candidate)) return candidate;
  }
  return null;
}

/** 找不到浏览器时给终端用户看的安装指引(平台相关,一句话可复制)。 */
export function chromiumInstallHint(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'Install Chromium on the remote host, e.g. `apt-get install -y chromium` (or `npx @puppeteer/browsers install chrome-headless-shell@stable`), then set OKWORK_CHROMIUM_PATH if it lives outside the standard paths.';
  }
  if (platform === 'darwin') {
    return 'Install Google Chrome, or set OKWORK_CHROMIUM_PATH to an existing Chromium binary.';
  }
  return 'Set OKWORK_CHROMIUM_PATH to a Chromium binary on this host.';
}

/**
 * 组装启动参数。userDataDir 按 Profile 分目录 —— 云端浏览器的登录态必须跟着 Profile 走,
 * 否则多个 Profile 会共用同一份 cookie(等于把用户的身份隔离拆了)。
 * 端口传 0:让 Chromium 自选空闲端口,从 stderr 的 "DevTools listening on ws://..." 回读。
 * 同一台机器上可能并存多个 host(不同 configId),写死端口必冲突。
 */
export function buildChromiumArgs(opts: {
  userDataDir: string;
  platform: NodeJS.Platform;
  /** 以 root 运行(容器常态)→ 追加 --no-sandbox */
  isRoot: boolean;
  windowSize?: { width: number; height: number };
  extraArgs?: readonly string[];
}): string[] {
  const args = [
    ...CHROMIUM_BASE_ARGS,
    '--remote-debugging-port=0',
    `--user-data-dir=${opts.userDataDir}`,
  ];
  if (opts.platform === 'linux' && opts.isRoot) args.push(CHROMIUM_NO_SANDBOX_ARG);
  if (opts.windowSize) {
    args.push(`--window-size=${opts.windowSize.width},${opts.windowSize.height}`);
  }
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);
  return args;
}

/** 从 Chromium stderr 里抠出 DevTools 的 browser 级 ws endpoint。 */
export function parseDevToolsEndpoint(stderrChunk: string): string | null {
  const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderrChunk);
  return m ? m[1] : null;
}
