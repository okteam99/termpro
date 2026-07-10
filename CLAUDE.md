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
