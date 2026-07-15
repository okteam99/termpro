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
  it('容忍 BOM / 引号 / 行尾注释(评审 P3)', () => {
    expect(parseSkillVersion('﻿---\nversion: v1.0.0\n---\n')).toBe('v1.0.0');
    expect(parseSkillVersion('---\nversion: "v1.0.0"\n---\n')).toBe('v1.0.0');
    expect(parseSkillVersion('---\nversion: v1.0.0 # note\n---\n')).toBe('v1.0.0');
  });
});

describe('name 白名单(评审 P2:防越界写)', () => {
  it('含 / 或 .. 的 name → 抛错,不落盘', () => {
    for (const bad of ['../../evil', 'a/b', '..', '/abs', '']) {
      expect(() => skillStatus(bad, home)).toThrow(/invalid skill name/);
      expect(() => skillInstall(bad, md('v1'), home)).toThrow(/invalid skill name/);
    }
    // 确认没有越界目录被创建
    expect(fs.existsSync(path.join(home, '..', 'evil'))).toBe(false);
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

describe('skillInstall(canonical 真身 + claude 软链,codex 不放东西)', () => {
  it('真身写共享 canonical;claude 在场 → 放软链指向 canonical', () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

    const after = skillInstall(NAME, md('v1.0.0'), home);
    // canonical 真身就位
    const canonical = path.join(home, '.agents/skills', NAME, 'SKILL.md');
    expect(fs.existsSync(canonical)).toBe(true);
    expect(parseSkillVersion(fs.readFileSync(canonical, 'utf8'))).toBe('v1.0.0');
    // claude 是软链(非真实拷贝)且解引用到同一份
    const link = path.join(home, '.claude/skills', NAME);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(after.claude.version).toBe('v1.0.0');
    expect(after.shared.version).toBe('v1.0.0');
  });

  it('codex 在场 → canonical 就位,【不】往 ~/.codex/skills 放东西;codex 已装版本=canonical', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    const after = skillInstall(NAME, md('v1.0.0'), home);
    expect(fs.existsSync(path.join(home, '.agents/skills', NAME, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.codex/skills', NAME))).toBe(false); // 不落 codex 目录
    expect(after.codex.version).toBe('v1.0.0'); // 经 canonical
    expect(after.duplicate).toBe(false);
  });

  it('去重:旧 bug 在 ~/.codex/skills 遗留的一份 → install 时被移除,duplicate 清零', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    // 模拟旧状态:canonical + ~/.codex/skills 都有 → codex 双扫重复
    for (const rel of ['.agents/skills', '.codex/skills']) {
      const dir = path.join(home, rel, NAME);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), md('v1.0.0'), 'utf8');
    }
    expect(skillStatus(NAME, home).duplicate).toBe(true);

    const after = skillInstall(NAME, md('v1.0.0'), home);
    expect(fs.existsSync(path.join(home, '.codex/skills', NAME))).toBe(false); // 残留已清
    expect(fs.existsSync(path.join(home, '.agents/skills', NAME, 'SKILL.md'))).toBe(true); // canonical 保留
    expect(after.duplicate).toBe(false);
  });

  it('claude 旧真实拷贝 → 重装换成软链', () => {
    const realCopy = path.join(home, '.claude/skills', NAME);
    fs.mkdirSync(realCopy, { recursive: true });
    fs.writeFileSync(path.join(realCopy, 'SKILL.md'), md('v0.9.0'), 'utf8');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

    skillInstall(NAME, md('v1.0.0'), home);
    expect(fs.lstatSync(realCopy).isSymbolicLink()).toBe(true); // 已换软链
    expect(skillStatus(NAME, home).claude.version).toBe('v1.0.0');
  });

  it('更新:canonical 旧版本被新版本覆盖', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    skillInstall(NAME, md('v1.0.0'), home);
    expect(skillStatus(NAME, home).shared.version).toBe('v1.0.0');
    skillInstall(NAME, md('v2.0.0'), home);
    expect(skillStatus(NAME, home).shared.version).toBe('v2.0.0');
    expect(skillStatus(NAME, home).codex.version).toBe('v2.0.0');
  });
});
