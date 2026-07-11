// i18n 核心语义:en 原文即 key 即默认文案 · zh 查字典缺条目回退 · 参数插值 · locale 解析。
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, resolveLocale, setLocale, t } from '../i18n';
import { zh } from '../i18n.zh';

const initial = getLocale();
afterEach(() => setLocale(initial));

describe('测试环境确定性(opus 评审 P1-2)', () => {
  it('vitest 下初始 locale 恒 en——Node 21+ navigator.language 反映宿主 LANG,不钉死则 zh 开发机上 node 环境断言会红', () => {
    expect(initial).toBe('en');
  });
});

describe('resolveLocale', () => {
  it('zh 前缀(任意大小写/地区变体)→ zh-CN', () => {
    expect(resolveLocale('zh')).toBe('zh-CN');
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLocale('ZH-TW')).toBe('zh-CN');
  });

  it('非 zh / 空 / null → en(英文即默认)', () => {
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('ja-JP')).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });
});

describe('t()', () => {
  it('en locale → 原样返回英文原文(不查字典)', () => {
    setLocale('en');
    expect(t('Connect')).toBe('Connect');
  });

  it('zh locale 查到字典条目 → 返回中文', () => {
    setLocale('zh-CN');
    zh['__test_key__'] = '测试值';
    try {
      expect(t('__test_key__')).toBe('测试值');
    } finally {
      delete zh['__test_key__'];
    }
  });

  it('zh locale 字典缺条目 → 静默回退英文原文', () => {
    setLocale('zh-CN');
    expect(t('__missing_key_never_added__')).toBe('__missing_key_never_added__');
  });

  it('参数插值:{name} 占位符替换,数字 0 不被 falsy 吞', () => {
    setLocale('en');
    expect(t('Install v{version} and restart?', { version: '1.2.3' })).toBe(
      'Install v1.2.3 and restart?',
    );
    expect(t('{n} left', { n: 0 })).toBe('0 left');
  });

  it('zh 译文中的占位符同样被插值', () => {
    setLocale('zh-CN');
    zh['__test_tpl__ {n}'] = '共 {n} 个';
    try {
      expect(t('__test_tpl__ {n}', { n: 3 })).toBe('共 3 个');
    } finally {
      delete zh['__test_tpl__ {n}'];
    }
  });

  it('同名占位符多次出现全部替换(replaceAll 语义)', () => {
    setLocale('en');
    expect(t('{a} + {a}', { a: 'x' })).toBe('x + x');
  });
});
