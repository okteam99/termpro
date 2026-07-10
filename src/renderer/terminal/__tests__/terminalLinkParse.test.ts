import { describe, expect, it } from 'vitest';
import {
  extractCandidates,
  fileUrlToPath,
  stripLineCol,
} from '../terminalLinkParse';

const texts = (s: string) => extractCandidates(s).map((c) => c.text);

describe('extractCandidates', () => {
  it('file:// 为 fs 候选;http(s) 为 web 候选(仅高亮,激活归 WebLinksAddon)', () => {
    const cands = extractCandidates(
      'see https://chatgpt.com/codex?x=1 and file:///Users/liam/a.png',
    );
    expect(cands.map((c) => [c.text, c.kind])).toEqual([
      ['https://chatgpt.com/codex?x=1', 'web'],
      ['file:///Users/liam/a.png', 'fs'],
    ]);
  });

  it('http(s) URL 遇全角/CJK 字符即停(不吞中文/全角标点·仅 http 类)', () => {
    // 全角括号(半/全角形式区)紧贴 URL — 不再吞进链接
    expect(texts('见 https://github.com/okteam99/termpro/pull/18（yolo）')).toEqual([
      'https://github.com/okteam99/termpro/pull/18',
    ]);
    // 汉字 / CJK 标点紧贴 URL
    expect(texts('https://example.com中文标点。')).toEqual(['https://example.com']);
    expect(texts('https://example.com、逗号')).toEqual(['https://example.com']);
    // 正常 ASCII URL(query / fragment / percent)不受影响
    expect(texts('https://a.b/c?x=1#f%20g')).toEqual(['https://a.b/c?x=1#f%20g']);
  });

  it('绝对 / ~ / ./ ../ / 相对路径', () => {
    expect(texts('open /usr/local/bin/zig now')).toEqual(['/usr/local/bin/zig']);
    expect(texts('cfg ~/apps/okok/aifriend ok')).toEqual(['~/apps/okok/aifriend']);
    expect(texts('run ./scripts/dev.sh and ../other/x')).toEqual([
      './scripts/dev.sh',
      '../other/x',
    ]);
    expect(texts('edit src/renderer/App.tsx please')).toEqual([
      'src/renderer/App.tsx',
    ]);
  });

  it(':line:col 后缀保留在候选文本里', () => {
    expect(texts('err at src/host/host.ts:42:7 boom')).toEqual([
      'src/host/host.ts:42:7',
    ]);
  });

  it('尾部标点剔除,但不剔 :行号', () => {
    expect(texts('(see /tmp/a.log).')).toEqual(['/tmp/a.log']);
    expect(texts('at src/x.ts:10,')).toEqual(['src/x.ts:10']);
  });

  it('URL 内部路径不重复产出;噪音不命中', () => {
    expect(texts('https://x.com/a/b/c plain words and/or nothing')).toEqual([
      'https://x.com/a/b/c',
      'and/or',
    ]); // and/or 形似路径,靠 stat 校验兜底过滤
    expect(texts('no links here')).toEqual([]);
  });

  it('CJK 前缀不影响提取(列映射在 provider 层处理)', () => {
    expect(texts('保存到 file:///Users/liam/图片/a.png 了')).toEqual([
      'file:///Users/liam/图片/a.png',
    ]);
  });
});

describe('helpers', () => {
  it('stripLineCol', () => {
    expect(stripLineCol('src/a.ts:1:2')).toBe('src/a.ts');
    expect(stripLineCol('src/a.ts')).toBe('src/a.ts');
  });
  it('fileUrlToPath', () => {
    expect(fileUrlToPath('file:///Users/liam/a%20b.png')).toBe(
      '/Users/liam/a b.png',
    );
    expect(fileUrlToPath('file://localhost/tmp/x')).toBe('/tmp/x');
    expect(fileUrlToPath('notfile://x')).toBeNull();
  });
});
