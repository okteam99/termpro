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

/**
 * 探测某技能的安装版本 + agent 存在性。
 * 🔴 模型(teamwork 约定):真身在共享 canonical ~/.agents/skills/<name>;claude 只读
 * ~/.claude/skills,故在那放【软链】指向 canonical;codex 直接扫 ~/.agents/skills(teamwork
 * 只在那儿也能被 codex 看到为证),【不】在 ~/.codex/skills 放东西——放了就与 canonical 双扫
 * 重复(2026-07-15 事故)。所以 codex 的「已装版本」= canonical 版本;claude 经软链读到同一份。
 */
export function skillStatus(name: string, homedir: string = os.homedir()): SkillStatusResult {
  assertValidSkillName(name);
  const loc = agentLocations(homedir);
  const canonicalVersion = versionAt(loc.sharedSkills, name);
  const codexPresent = existsSafe(loc.codex.homeMarker);
  return {
    // claude 经 ~/.claude/skills/<name> 软链解引用读到 canonical 版本
    claude: { present: existsSafe(loc.claude.homeMarker), version: versionAt(loc.claude.skillsDir, name) },
    // codex 直接读共享 canonical,故其已装版本 = canonical 版本
    codex: { present: codexPresent, version: canonicalVersion },
    shared: { present: existsSafe(path.dirname(loc.sharedSkills)), version: canonicalVersion },
    // 旧 bug 残留:~/.codex/skills 也有一份 → 与 canonical 双扫重复,需清
    duplicate: codexPresent && versionAt(loc.codex.skillsDir, name) !== null,
  };
}

/**
 * 安装/更新:真身写共享 canonical ~/.agents/skills/<name>/SKILL.md;claude 在场则在
 * ~/.claude/skills/<name> 放软链指向 canonical(匹配 teamwork;软链失败退拷贝)。
 * 不往 ~/.codex/skills 放(codex 直接读 canonical),并清理旧版遗留在那里的同名残留(去重)。
 */
export function skillInstall(
  name: string,
  content: string,
  homedir: string = os.homedir(),
): SkillStatusResult {
  assertValidSkillName(name);
  const loc = agentLocations(homedir);
  // 1. canonical 真身(codex 与共享读这里)
  const canonicalDir = path.join(loc.sharedSkills, name);
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalDir, 'SKILL.md'), content, 'utf8');
  // 2. claude 只读 ~/.claude/skills:软链到 canonical(失败退拷贝)
  if (existsSafe(loc.claude.homeMarker)) {
    try {
      linkToCanonical(canonicalDir, path.join(loc.claude.skillsDir, name), content);
    } catch (err) {
      console.warn(`[host] skill link into ${loc.claude.skillsDir} failed:`, err);
    }
  }
  // 3. 去重:codex 也读 canonical,~/.codex/skills 里再有一份就重复 → 移除(清旧 bug 残留)
  try {
    fs.rmSync(path.join(loc.codex.skillsDir, name), { recursive: true, force: true });
  } catch {
    /* best-effort 清理 */
  }
  return skillStatus(name, homedir);
}

/** 在 linkPath 建指向 canonicalDir 的相对软链;已是正确软链则跳过,旧真实拷贝/错软链先删。 */
function linkToCanonical(canonicalDir: string, linkPath: string, content: string): void {
  const rel = path.relative(path.dirname(linkPath), canonicalDir);
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      if (fs.readlinkSync(linkPath) === rel) return; // 已正确
      fs.unlinkSync(linkPath);
    } else {
      fs.rmSync(linkPath, { recursive: true, force: true }); // 旧真实拷贝 → 换软链
    }
  } catch {
    /* linkPath 不存在 */
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(rel, linkPath);
  } catch {
    // 软链失败(如 Windows 无权限)→ 退拷贝
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(path.join(linkPath, 'SKILL.md'), content, 'utf8');
  }
}
