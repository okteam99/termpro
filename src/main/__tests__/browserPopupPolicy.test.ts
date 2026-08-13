// 弹窗分流(用户指令 2026-08-12):Google 登录一类的 window.open 弹窗开真子窗
// (保住 opener/postMessage/window.close),普通 target=_blank 仍落面板新标签。
import { describe, expect, it } from 'vitest';
import {
  POPUP_MAX_CHILD_WINDOWS,
  POPUP_MIN_INTERVAL_MS,
  browserPopupWindowTitle,
  decideBrowserPopup,
  hasWindowGeometryFeature,
  isPopupRequest,
} from '../browserPopupPolicy';

const req = (over: Partial<Parameters<typeof decideBrowserPopup>[0]> = {}) => ({
  url: 'https://accounts.google.com/o/oauth2/auth',
  disposition: 'new-window' as const,
  frameName: '',
  features: 'width=500,height=600',
  ...over,
});

const ctx = (over: Partial<Parameters<typeof decideBrowserPopup>[1]> = {}) => ({
  mode: 'pane' as const,
  now: 10_000,
  lastOpenAt: 0,
  hasNamedWindow: false,
  childWindowCount: 0,
  ...over,
});

describe('hasWindowGeometryFeature(弹窗信号)', () => {
  it('几何/装饰特性 → 弹窗;空串与 noopener 一类修饰 → 不是', () => {
    expect(hasWindowGeometryFeature('width=500,height=600')).toBe(true);
    expect(hasWindowGeometryFeature('popup=1')).toBe(true);
    expect(hasWindowGeometryFeature(' toolbar=no , location=no ')).toBe(true);
    expect(hasWindowGeometryFeature('')).toBe(false);
    expect(hasWindowGeometryFeature('noopener')).toBe(false);
    expect(hasWindowGeometryFeature('noopener,noreferrer')).toBe(false);
  });
});

describe('isPopupRequest(两条判据任一命中)', () => {
  it('disposition=new-window 即弹窗,哪怕没带 features', () => {
    expect(isPopupRequest(req({ features: '' }))).toBe(true);
  });

  it('features 带几何特性即弹窗,哪怕 disposition 报的是标签', () => {
    expect(
      isPopupRequest(
        req({ disposition: 'foreground-tab', features: 'width=500' }),
      ),
    ).toBe(true);
  });

  it('纯 target=_blank(无特性、标签 disposition)不是弹窗', () => {
    expect(
      isPopupRequest(req({ disposition: 'foreground-tab', features: '' })),
    ).toBe(false);
  });
});

describe('decideBrowserPopup(落位分流)', () => {
  it('Google 登录式弹窗 → 开子浏览器窗口', () => {
    expect(decideBrowserPopup(req(), ctx())).toEqual({ kind: 'child-window' });
  });

  it('普通新标签语义 → 面板新标签(旧行为不变)', () => {
    expect(
      decideBrowserPopup(
        req({ disposition: 'foreground-tab', features: '' }),
        ctx(),
      ),
    ).toEqual({ kind: 'pane-tab' });
    expect(
      decideBrowserPopup(
        req({ disposition: 'background-tab', features: '' }),
        ctx(),
      ),
    ).toEqual({ kind: 'pane-tab' });
  });

  it('非 http(s) 恒拒(file:/javascript: 等)', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>x',
      'okwork://x',
    ]) {
      expect(decideBrowserPopup(req({ url }), ctx())).toEqual({
        kind: 'deny',
        reason: 'scheme',
      });
    }
  });

  it('同名子窗已在 → 复用(聚焦+导航),且不受限频约束', () => {
    expect(
      decideBrowserPopup(
        req({ frameName: 'gauth' }),
        ctx({ hasNamedWindow: true, lastOpenAt: 10_000 }),
      ),
    ).toEqual({ kind: 'reuse-window' });
  });

  it('限频窗口内的新请求 → 拒(防弹窗轰炸)', () => {
    expect(
      decideBrowserPopup(
        req(),
        ctx({ lastOpenAt: 10_000 - POPUP_MIN_INTERVAL_MS }),
      ),
    ).toEqual({ kind: 'deny', reason: 'flood' });
    // 刚过限频线即放行
    expect(
      decideBrowserPopup(
        req(),
        ctx({ lastOpenAt: 10_000 - POPUP_MIN_INTERVAL_MS - 1 }),
      ),
    ).toEqual({ kind: 'child-window' });
  });

  it('子窗数到顶 → 拒(不再开窗)', () => {
    expect(
      decideBrowserPopup(
        req(),
        ctx({ childWindowCount: POPUP_MAX_CHILD_WINDOWS }),
      ),
    ).toEqual({ kind: 'deny', reason: 'window-cap' });
  });

  it('external 宿主(查看器等无面板窗口)恒送系统浏览器', () => {
    expect(decideBrowserPopup(req(), ctx({ mode: 'external' }))).toEqual({
      kind: 'external',
    });
    expect(
      decideBrowserPopup(
        req({ disposition: 'foreground-tab', features: '' }),
        ctx({ mode: 'external' }),
      ),
    ).toEqual({ kind: 'external' });
  });
});

describe('browserPopupWindowTitle(反钓鱼标题)', () => {
  it('域名打头,页面标题在后', () => {
    expect(
      browserPopupWindowTitle(
        'https://accounts.google.com/x',
        '登录 - Google 账号',
      ),
    ).toBe('accounts.google.com · 登录 - Google 账号');
  });

  it('无标题只显域名;URL 不可解析回退标题/about:blank', () => {
    expect(browserPopupWindowTitle('https://example.com:8443/x', '')).toBe(
      'example.com:8443',
    );
    expect(browserPopupWindowTitle('', 'Loading')).toBe('Loading');
    expect(browserPopupWindowTitle('', '')).toBe('about:blank');
  });
});
