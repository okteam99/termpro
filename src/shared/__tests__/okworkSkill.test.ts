// okwork 技能内容守门:frontmatter version 与常量单一真源不漂移 + 关键内容在位
// (host 探测按 frontmatter version 判陈旧,漂移会导致「装了也永远显示可更新」)。
import { describe, it, expect } from 'vitest';
import {
  OKWORK_SKILL_MD,
  OKWORK_SKILL_NAME,
  OKWORK_SKILL_VERSION,
} from '../okworkSkill';

describe('okwork skill 模块', () => {
  it('frontmatter 的 version 与 OKWORK_SKILL_VERSION 一致(单一真源)', () => {
    const m = OKWORK_SKILL_MD.match(/^version:\s*(\S+)\s*$/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(OKWORK_SKILL_VERSION);
  });

  it('frontmatter 的 name 与 OKWORK_SKILL_NAME 一致', () => {
    const m = OKWORK_SKILL_MD.match(/^name:\s*(\S+)\s*$/m);
    expect(m?.[1]).toBe(OKWORK_SKILL_NAME);
  });

  it('含连接引导 + 真登录会话安全提醒 + 浏览器工具引用', () => {
    expect(OKWORK_SKILL_MD).toContain('claude mcp add --transport http okbrowser');
    expect(OKWORK_SKILL_MD).toContain('$OKWORK_BROWSER_MCP_URL');
    expect(OKWORK_SKILL_MD).toContain('真实浏览器会话');
    expect(OKWORK_SKILL_MD).toContain('browser_wait_for');
  });

  it('以 YAML frontmatter 起始(--- 界定),host 可解析', () => {
    expect(OKWORK_SKILL_MD.startsWith('---\n')).toBe(true);
    expect(OKWORK_SKILL_MD.indexOf('\n---', 4)).toBeGreaterThan(0);
  });
});
