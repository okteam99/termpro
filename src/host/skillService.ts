// OkWork 会话内技能的探测/安装(host · 纯 Node fs,本地/远程统一)。
// 把 app 打包的 SKILL.md 写入 agent 的 skills 目录,让 session 内的 claude/codex 发现它。
// 采用【直接写文件】(非软链):跨平台稳(Windows 软链需权限)、幂等、更新即重写。
// 目标:① 共享 canonical ~/.agents/skills/<name>/(部分 agent 直接读这)② 各已装 agent
// 的 skills 目录(~/.claude/skills、~/.codex/skills)。探测按各处 frontmatter version 报告,
// 由上层(app)与打包版本比对判「未装 / 可更新 / 最新」。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SkillStatusResult } from '../shared/protocol';

function existsSafe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * 技能名白名单(评审 P2):name 经 RPC 传入,直接进 path.join + mkdir + 写文件。校验其
 * 不含路径分隔符/`..`/绝对路径,杜绝越界写(host fs 面刻意不暴露任意路径新建文件的原语)。
 */
function assertValidSkillName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`invalid skill name: ${name}`);
  }
}

/** 仅解析开头 YAML frontmatter 里的 version(--- 块内),不误读正文;容忍 BOM/引号/行尾注释。 */
export function parseSkillVersion(md: string): string | null {
  const body = md.replace(/^﻿/, ''); // 去 BOM,否则 ^--- 失配
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  // 值可带引号、行尾可有 # 注释;取第一段非空白/非引号/非 # 的 token
  const v = fm[1].match(/^version:\s*["']?([^"'\s#]+)/m);
  return v ? v[1] : null;
}

function versionAt(skillsDir: string, name: string): string | null {
  try {
    return parseSkillVersion(fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8'));
  } catch {
    return null;
  }
}

interface AgentLoc {
  homeMarker: string; // agent 是否存在的标志目录(~/.claude 等)
  skillsDir: string; // 写入/读取的 skills 目录
}

function agentLocations(homedir: string): { claude: AgentLoc; codex: AgentLoc; sharedSkills: string } {
  return {
    claude: { homeMarker: path.join(homedir, '.claude'), skillsDir: path.join(homedir, '.claude', 'skills') },
    codex: { homeMarker: path.join(homedir, '.codex'), skillsDir: path.join(homedir, '.codex', 'skills') },
    sharedSkills: path.join(homedir, '.agents', 'skills'),
  };
}

/** 探测某技能在各 agent 位置的安装版本 + agent 存在性。 */
export function skillStatus(name: string, homedir: string = os.homedir()): SkillStatusResult {
  assertValidSkillName(name);
  const loc = agentLocations(homedir);
  return {
    claude: { present: existsSafe(loc.claude.homeMarker), version: versionAt(loc.claude.skillsDir, name) },
    codex: { present: existsSafe(loc.codex.homeMarker), version: versionAt(loc.codex.skillsDir, name) },
    shared: { present: existsSafe(path.dirname(loc.sharedSkills)), version: versionAt(loc.sharedSkills, name) },
  };
}

/** 安装/更新:写 canonical + 各已装 agent 的 skills 目录;返回安装后状态。 */
export function skillInstall(
  name: string,
  content: string,
  homedir: string = os.homedir(),
): SkillStatusResult {
  assertValidSkillName(name);
  const loc = agentLocations(homedir);
  const writeInto = (skillsDir: string) => {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  };
  // canonical 必写(失败即抛,横条显示 retry);各 agent 目录 best-effort——某个不可写
  // (EACCES)不该整单失败(评审 P3),其余目标照写,返回真实状态让横条按实反映。
  writeInto(loc.sharedSkills);
  for (const skillsDir of [loc.claude, loc.codex]) {
    if (!existsSafe(skillsDir.homeMarker)) continue;
    try {
      writeInto(skillsDir.skillsDir);
    } catch (err) {
      console.warn(`[host] skill install into ${skillsDir.skillsDir} failed:`, err);
    }
  }
  return skillStatus(name, homedir);
}
