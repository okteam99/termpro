// 轻量 i18n(零依赖 · 纯 TS · 可被 renderer/main/shared 任意进程 import)。
// 约定:代码内文案一律写英文原文,t() 以英文原文为 key 查中文字典(i18n.zh.ts);
// 字典缺条目 → 原样返回英文(英文即默认文案,永不缺失)。
// locale 一次定死随系统语言,会话中不切换(无需响应式/重渲染钩子):
//  - renderer:模块加载时 navigator.language 自检(Electron renderer 反映系统语言);
//  - main:app ready 后显式 setLocale(resolveLocale(app.getLocale()))(见 main.ts);
//  - 测试(node/jsdom):navigator 缺失或 en-US → 'en',断言天然确定性(不读 LANG 等环境变量)。

import { zh } from './i18n.zh';

export type Locale = 'en' | 'zh-CN';

/** 任意 BCP-47/系统 locale 字符串 → 本项目支持的 Locale(zh* → zh-CN,其余 → en) */
export function resolveLocale(raw: string | null | undefined): Locale {
  return /^zh/i.test(raw ?? '') ? 'zh-CN' : 'en';
}

let locale: Locale =
  typeof navigator !== 'undefined' ? resolveLocale(navigator.language) : 'en';

export function setLocale(next: Locale): void {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

/**
 * 翻译 + 参数插值:t('Install v{version} and restart?', { version: '1.2.3' })。
 * 🔴 zh 字典的 key 必须与代码内英文原文逐字符一致(含标点/占位符),否则静默回退英文——
 * 新增/改动文案时同步维护 i18n.zh.ts。
 */
export function t(text: string, params?: Record<string, string | number>): string {
  let out = locale === 'zh-CN' ? (zh[text] ?? text) : text;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}
