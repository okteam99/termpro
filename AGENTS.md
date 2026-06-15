<!-- TEAMWORK_BEGIN:teamwork-pointer v8.167.1 -->
## Teamwork 协作模式

本项目使用 [Teamwork](https://github.com/okteam99/teamwork) 多角色协作流程。

- **完整规范**：`~/.claude/skills/teamwork/SKILL.md`（Claude Code）/ `~/.codex/skills/teamwork/SKILL.md`（Codex CLI）
- **9 条 L1 红线** + Stage 流转 + 暂停点协议 详见 SKILL.md
- **新 session 必跑** `python3 {SKILL_ROOT}/tools/bootstrap.py`（系统维护）+ 按 SKILL.md § Triage 入口规范分诊
- **state.json 写操作** 走 `tools/state.py` 单源（详 SKILL.md § PMO 软约束）

🔴 PMO 是项目流程统一承接者 · 不直接动代码 · 调度 RD/QA/Designer/架构师 完成实施。

🔴 **worktree 写文件路径**：teamwork worktree 模式下 · 文件写入优先用 **worktree 内路径**（推荐绝对路径）· 避免污染主工作区主分支、影响其他并行 Feature。确需写入主工作区的 · 须先经用户确认。

## Subagent 默认授权（Teamwork 流程）

用户明确授权 AI（本文件适用宿主：Claude Code / Codex CLI / Gemini CLI）在 Teamwork 流程中**默认使用 subagent · 无需每次另行确认**（满足各宿主 subagent 工具契约的 "user explicitly asks"）。适用：PRD / Blueprint / Review 各阶段 cross-review 与多角色评审、PL 对抗质疑（隔离执行）、并行探索调研、互不重叠 write scope 的实现子任务、验证/测试类 sidecar。
约束（纪律单源 = SKILL.md · 此处不复述）：子任务**边界清晰且够大**才派（R4 判据 ·「该不该用」仍 AI 自决）· 代码类 subagent 声明文件/模块范围且只写 worktree 内路径 · stage 流转 / commit / complete 仍由主对话掌控（不外包流程）· 主对话负责最终整合与交付。
<!-- TEAMWORK_END:teamwork-pointer -->
