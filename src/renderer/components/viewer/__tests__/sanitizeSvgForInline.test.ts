// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeSvgForInline } from '../FileView';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('sanitizeSvgForInline', () => {
  it('保留图形元素(缺 xmlns 也救得回 → 内联宽松解析)', () => {
    const out = sanitizeSvgForInline(
      b64('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
    );
    expect(out).toContain('<svg');
    expect(out).toContain('<rect');
  });

  it('剥离 <script>,杜绝内联 XSS', () => {
    const out = sanitizeSvgForInline(
      b64('<svg viewBox="0 0 10 10"><script>window.x=1</script><rect/></svg>'),
    );
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).toContain('<rect');
  });

  it('剥离事件处理器属性', () => {
    const out = sanitizeSvgForInline(
      b64('<svg viewBox="0 0 10 10"><rect onload="evil()" onclick="evil()"/></svg>'),
    );
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('正确解码 UTF-8(中文 <text> 不乱码)', () => {
    const out = sanitizeSvgForInline(
      b64('<svg viewBox="0 0 80 20"><text x="0" y="15">中文标签</text></svg>'),
    );
    expect(out).toContain('中文标签');
  });
});
