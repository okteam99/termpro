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

/** 仅解析开头 YAML frontmatter 里的 version(--- 块内),不误读正文。 */
export function parseSkillVersion(md: string): string | null {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const v = fm[1].match(/^version:\s*(\S+)\s*$/m);
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
  const loc = agentLocations(homedir);
  const targets = [loc.sharedSkills]; // canonical 恒写
  if (existsSafe(loc.claude.homeMarker)) targets.push(loc.claude.skillsDir);
  if (existsSafe(loc.codex.homeMarker)) targets.push(loc.codex.skillsDir);
  for (const skillsDir of targets) {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  }
  return skillStatus(name, homedir);
}
