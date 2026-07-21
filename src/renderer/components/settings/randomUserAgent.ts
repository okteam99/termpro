// 随机 UA 生成(用户指令 2026-07-21:profile 表单的 UA 字段加「随机生成」按钮)。
// 池子刻意小而保守:主流桌面浏览器(Chrome/Edge/Firefox/Safari)× mac/win,主版本号
// 在近期区间内随机——冷门平台/远古版本的花哨组合反而更容易被指纹识别。
// 版本区间是会过时的常量,升级时只动这里。

/** 近期主版本区间(闭区间;2026-07 口径,过期就 bump)。 */
const CHROME_MAJOR: [number, number] = [136, 140];
const FIREFOX_MAJOR: [number, number] = [138, 142];
/** Safari 次版本(主版本恒 18) */
const SAFARI_MINOR: [number, number] = [3, 6];

const MAC = 'Macintosh; Intel Mac OS X 10_15_7';
const WIN = 'Windows NT 10.0; Win64; x64';

function pickInt(rand: () => number, [lo, hi]: [number, number]): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
}

/** 生成一个「像真的」的桌面浏览器 UA;rand 可注入(测试注种子)。 */
export function randomUserAgent(rand: () => number = Math.random): string {
  const kind = pick(rand, ['chrome', 'edge', 'firefox', 'safari'] as const);
  const platform = pick(rand, [MAC, WIN] as const);
  switch (kind) {
    case 'chrome': {
      const v = pickInt(rand, CHROME_MAJOR);
      return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`;
    }
    case 'edge': {
      const v = pickInt(rand, CHROME_MAJOR);
      return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36 Edg/${v}.0.0.0`;
    }
    case 'firefox': {
      const v = pickInt(rand, FIREFOX_MAJOR);
      // Firefox 的 mac 平台段带 rv 且无下划线格式
      const fxPlatform =
        platform === MAC ? `Macintosh; Intel Mac OS X 10.15; rv:${v}.0` : `${platform}; rv:${v}.0`;
      return `Mozilla/5.0 (${fxPlatform}) Gecko/20100101 Firefox/${v}.0`;
    }
    case 'safari': {
      // Safari 只在 mac 上像真的
      const minor = pickInt(rand, SAFARI_MINOR);
      return `Mozilla/5.0 (${MAC}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.${minor} Safari/605.1.15`;
    }
  }
}
