// 随机 UA 生成:形状像真的(四家桌面浏览器之一)、版本落在近期区间、随机源可注入。

import { describe, expect, it } from 'vitest';
import { randomUserAgent } from '../randomUserAgent';

const SHAPES = [
  /^Mozilla\/5\.0 \((Macintosh; Intel Mac OS X 10_15_7|Windows NT 10\.0; Win64; x64)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(1[0-9]{2})\.0\.0\.0 Safari\/537\.36$/,
  /^Mozilla\/5\.0 \((Macintosh; Intel Mac OS X 10_15_7|Windows NT 10\.0; Win64; x64)\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(1[0-9]{2})\.0\.0\.0 Safari\/537\.36 Edg\/\2\.0\.0\.0$/,
  /^Mozilla\/5\.0 \((Macintosh; Intel Mac OS X 10\.15|Windows NT 10\.0; Win64; x64); rv:(1[0-9]{2})\.0\) Gecko\/20100101 Firefox\/\2\.0$/,
  /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\) Version\/18\.[3-6] Safari\/605\.1\.15$/,
];

describe('randomUserAgent', () => {
  it('多次生成,每个都命中四种真实形状之一', () => {
    for (let i = 0; i < 200; i++) {
      const ua = randomUserAgent();
      expect(SHAPES.some((re) => re.test(ua)), ua).toBe(true);
    }
  });

  it('随机源可注入(确定性):rand 恒 0 → 首选组合;恒 0.999 → 末选组合', () => {
    const lo = randomUserAgent(() => 0);
    expect(lo).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    );
    const hi = randomUserAgent(() => 0.999);
    expect(hi).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    );
  });

  it('Chrome/Firefox 主版本落在声明区间', () => {
    for (let i = 0; i < 100; i++) {
      const ua = randomUserAgent();
      const chrome = /Chrome\/(\d+)\./.exec(ua);
      if (chrome) expect(Number(chrome[1])).toBeGreaterThanOrEqual(136);
      if (chrome) expect(Number(chrome[1])).toBeLessThanOrEqual(140);
      const fx = /Firefox\/(\d+)\./.exec(ua);
      if (fx) expect(Number(fx[1])).toBeGreaterThanOrEqual(138);
      if (fx) expect(Number(fx[1])).toBeLessThanOrEqual(142);
    }
  });
});
