# Teamwork Space

> **本项目知识地图根 · 索引之索引** · 任何 session 先读本文件 → 指向每个知识节点(产品愿景 / 工程文档 / 系统架构 / 代码)· **代码是细节唯一真相**。
> 🔴 变更需用户确认(R5)· 任一单元格 ≤ 1 行 · 维护规范 → `docs/teamwork-space-guide.md`(随 skill · 不复制进项目)。
> 🔴 本项目为**单子项目**(N=1)· `product-overview/` 已建立为上游产品规划权威，`README.md` 继续作为公开产品说明与里程碑叙述。

## 知识入口（索引之索引 · 零死角）

<!-- 🔴 每个磁盘上存在的知识节点一行指针 · 漏一个 = 知识泄露死角 -->

| 知识域 | 入口 | 内含 |
|--------|------|------|
| 产品规划上游 | [`product-overview/OkWork_业务架构与产品规划.md`](product-overview/OkWork_业务架构与产品规划.md) | 产品定位 · 业务架构 · 执行线列表 · MVP 范围 · 分阶段路线图 |
| 规划单元(WS) | [`product-overview/workstream/`](product-overview/workstream/) | WS-01 M5 远程 Host(模型 A)· 拆解/波次/风险 |
| Feature 排期(BL) | [`docs/ROADMAP.md`](docs/ROADMAP.md) | Wave 编排 · BL-001…005 状态 · 关联 WS |
| 产品说明 / 里程碑 | [`README.md`](README.md) | 定位 · 概念模型 · UI 蓝图 · M1–M5 里程碑 · 架构(远程就绪)· 选型决策 |
| 待规划需求池 | [`product-overview/PENDING.md`](product-overview/PENDING.md) | 跨 Feature/session 的 active 待规划项 |
| 工程速查(开发者手册) | [`docs/DEV.md`](docs/DEV.md) | 环境 · 命令 · 目录结构 · 架构要点 · CI/发版 · 已知约束 |
| 工程规范(workspace) | [`project-specs/`](project-specs/) | DEV-RULES · KNOWLEDGE · GLOSSARY · TROUBLESHOOTING |
| 系统架构(workspace) | [`project-specs/ARCHITECTURE.md`](project-specs/ARCHITECTURE.md) | UI壳↔Host 拓扑 + 依赖契约 + `src/` 目录布局 |
| 架构决策(ADR) | [`docs/adr/INDEX.md`](docs/adr/INDEX.md) | 跨 Feature 影响 / 反悔成本高 / 选哪个不显然的决策 —— **为什么选 A 不选 B** |
| 流程复盘 | [`docs/retros/`](docs/retros/) | 一 Feature 一份归因叙述(流程拦住了什么 · 代价花在哪);机器字段在 `project-specs/PROCESS-LEDGER.md` |
| 交付归档(冷库) | [`docs/features/_archive/INDEX.md`](docs/features/_archive/INDEX.md) | 已交付 Feature 的过程稿 zip + 业务描述索引 · 先读描述判相关再解压 |
| 代码(唯一真相) | `grep` + `Read` 源码 | 🔴 细节一律现查代码 · 不信文档转述 |

## 子项目清单（路由权威）

<!-- 🔴 docs_root 必填(路由权威)· 单项目 = 1 行 -->

| 缩写 | 名称 | 类型 | 职责范围 | docs_root | 承接执行线 | 技术栈 | 需要 UI | 消费方 | 完成度 |
|------|------|------|----------|-----------|-----------|--------|---------|--------|--------|
| OKWORK | OkWork | business | 负责:终端为主体的多工程/多会话工作台(UI壳 + Host + 状态感知)。不负责:绑定特定 agent · 完整编辑器/LSP · Windows/Linux | `docs/features` | Line 0-5 | Electron · React(Vite) · xterm.js · node-pty · monaco | 是 | - | 0/5 BL(WS-01 M5 远程 Host · 详 ROADMAP.md)· M1–M4 ✅ |

---

> 完整结构(规划状态 / 执行线 / 待规划池 / 跨项目变更)见模板 `templates/teamwork-space.md` + guide · **系统架构**(UI壳↔Host 拓扑/依赖/目录)→ `project-specs/ARCHITECTURE.md`。规划期(product-overview)按需补。
