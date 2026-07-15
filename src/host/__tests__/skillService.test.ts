// host 技能探测/安装:temp home 下验证 present/version 报告 + 写 canonical + 各已装
// agent 目录 + 更新覆盖 + frontmatter version 解析(host 按此判未装/可更新)。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseSkillVersion, skillInstall, skillStatus } from '../skillService';

const NAME = 'okwork';
let home: string;

function md(version: string): string {
  return `---\nname: ${NAME}\nversion: ${version}\ndescription: x\n---\n\n# body\nversion: not-this\n`;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-skill-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('parseSkillVersion', () => {
  it('只取 frontmatter 的 version,不误读正文里的 version:', () => {
    expect(parseSkillVersion(md('v1.2.3'))).toBe('v1.2.3');
  });
  it('无 frontmatter → null', () => {
    expect(parseSkillVersion('# 无 frontmatter\nversion: v9')).toBeNull();
  });
});

describe('skillStatus', () => {
  it('无任何 agent → 全 present=false,version=null', () => {
    const s = skillStatus(NAME, home);
    expect(s.claude).toEqual({ present: false, version: null });
    expect(s.codex).toEqual({ present: false, version: null });
    expect(s.shared).toEqual({ present: false, version: null });
  });

  it('agent 存在但未装技能 → present=true,version=null', () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    const s = skillStatus(NAME, home);
    expect(s.claude.present).toBe(true);
    expect(s.claude.version).toBeNull();
    expect(s.codex.present).toBe(true);
  });
});

describe('skillInstall', () => {
  it('写 canonical + 各已装 agent 的 skills 目录,version 全部就位', () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });

    const after = skillInstall(NAME, md('v1.0.0'), home);
    expect(after.claude.version).toBe('v1.0.0');
    expect(after.codex.version).toBe('v1.0.0');
    expect(after.shared.version).toBe('v1.0.0');

    // 实际文件落地
    for (const rel of ['.agents/skills', '.claude/skills', '.codex/skills']) {
      const f = path.join(home, rel, NAME, 'SKILL.md');
      expect(fs.existsSync(f)).toBe(true);
      expect(parseSkillVersion(fs.readFileSync(f, 'utf8'))).toBe('v1.0.0');
    }
  });

  it('agent 未装则不给它写(只写 canonical)', () => {
    // 无 ~/.claude、无 ~/.codex
    const after = skillInstall(NAME, md('v1.0.0'), home);
    expect(after.shared.version).toBe('v1.0.0');
    expect(fs.existsSync(path.join(home, '.claude', 'skills', NAME))).toBe(false);
    expect(fs.existsSync(path.join(home, '.codex', 'skills', NAME))).toBe(false);
  });

  it('更新:旧版本被新版本覆盖', () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    skillInstall(NAME, md('v1.0.0'), home);
    expect(skillStatus(NAME, home).claude.version).toBe('v1.0.0');

    skillInstall(NAME, md('v2.0.0'), home);
    expect(skillStatus(NAME, home).claude.version).toBe('v2.0.0');
    expect(skillStatus(NAME, home).shared.version).toBe('v2.0.0');
  });
});
