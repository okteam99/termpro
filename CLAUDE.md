<!-- TEAMWORK_BEGIN:teamwork-pointer v8.147.1 -->
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

# TermPro — Agent 工作守则

## 模型分工(固定原则)

主循环跑 Fable 5(orchestrator),按任务性质把工作派给子代理,**保持主循环精简以节省额度**:

| 角色 | 模型 | 负责 |
|---|---|---|
| **Orchestrator(主循环)** | Fable 5 | 任务拆解、阶段规划、子代理调度、集成接线、提交/推送、验证门禁、小型精准修改 |
| **重推理阶段** | `opus` 子代理 | 架构/协议设计推演、复杂并发与竞态分析、疑难 bug 根因、代码评审(每个里程碑收尾必做)、安全敏感路径审查 |
| **明确规格的实现** | `sonnet` 子代理 | UI 组件(给足接口与设计规格)、文档、机械性改造、测试编写 |

子代理用 Agent 工具的 `model` 参数指定;并行无依赖的子代理在同一消息里一起发。
子代理产出必须经主循环验证(typecheck + vitest + 冒烟)才能提交。

## 常用命令

- 开发:`npm start`;类型:`npm run typecheck`;单测:`npm test`
- 无头冒烟:`TERMPRO_SMOKE=1 npx electron-forge start`(SMOKE_OK 即通过)
- 发版:`npm version patch && git push --follow-tags`(CI 自动出包发 Release)

## 流程纪律(本项目已验证的节奏)

1. 里程碑拆 3-6 个阶段,**每阶段一个 commit**,绿了才进下一阶段
2. 每阶段验证门禁:`tsc` + `vitest` + 冒烟,三绿才提交
3. 里程碑收尾:opus 评审新增核心代码 → 修复 P1(P2 酌情)→ 勾 README 清单 → push
4. 发版后**不要**替用户安装/升级 /Applications 里的应用——用户自己通过应用内升级胶囊更新(用户指令,2026-06)
5. 架构红线见 README §五:UI 永不直接碰 fs/PTY/git,只走 HostService 协议;
   Host 进程零 Electron import(远程就绪)

## 目录速查

- `src/host/` 纯 Node Host(PTY 池/git/watch/扫描器/状态机)— 改这里注意远程就绪约束
- `src/shared/protocol.ts` 唯一通信契约,加 RPC 先改这里
- `src/renderer/` React UI(store=zustand,terminal 实例在 registry 跨挂载存活)
- `docs/DEV.md` 开发细节与已知约束
