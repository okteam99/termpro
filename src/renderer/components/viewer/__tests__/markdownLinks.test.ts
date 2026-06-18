import { describe, expect, it } from 'vitest';
import { resolveMarkdownHref } from '../markdownLinks';

const MD = '/Users/liam/proj/docs/guide.md';
const HOME = '/Users/liam';

describe('resolveMarkdownHref', () => {
  it('http(s) → 外链', () => {
    expect(resolveMarkdownHref('https://a.com/x', MD, HOME)).toEqual({
      kind: 'external',
      url: 'https://a.com/x',
    });
  });

  it('#锚点 → anchor(解码)', () => {
    expect(resolveMarkdownHref('#%E4%B8%AD%E6%96%87', MD, HOME)).toEqual({
      kind: 'anchor',
      id: '中文',
    });
  });

  it('相对路径按 markdown 文件目录解析', () => {
    expect(resolveMarkdownHref('./api.md', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/Users/liam/proj/docs/api.md',
    });
  });

  it('.. 上溯并归一', () => {
    expect(resolveMarkdownHref('../src/app.ts', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/Users/liam/proj/src/app.ts',
    });
  });

  it('裸相对名 → 同目录', () => {
    expect(resolveMarkdownHref('notes/todo.md', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/Users/liam/proj/docs/notes/todo.md',
    });
  });

  it('绝对路径原样(归一)', () => {
    expect(resolveMarkdownHref('/etc/./hosts', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/etc/hosts',
    });
  });

  it('~ 展开 home', () => {
    expect(resolveMarkdownHref('~/x/y.md', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/Users/liam/x/y.md',
    });
  });

  it('file:// → 路径', () => {
    expect(resolveMarkdownHref('file:///tmp/a%20b.txt', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/tmp/a b.txt',
    });
  });

  it('去掉 fragment/query,解码空格', () => {
    expect(resolveMarkdownHref('./a%20b.md#sec', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/Users/liam/proj/docs/a b.md',
    });
  });

  it('指向目录(末尾斜杠)', () => {
    expect(resolveMarkdownHref('../assets/', MD, HOME)).toEqual({
      kind: 'path',
      abs: '/Users/liam/proj/assets',
    });
  });

  it('其它协议(mailto)忽略', () => {
    expect(resolveMarkdownHref('mailto:a@b.com', MD, HOME)).toBeNull();
  });

  it('空 href → null', () => {
    expect(resolveMarkdownHref('   ', MD, HOME)).toBeNull();
  });
});
