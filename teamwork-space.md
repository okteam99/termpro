# Teamwork Space

> **本项目知识地图根 · 索引之索引** · 任何 session 先读本文件 → 指向每个知识节点(产品愿景 / 工程文档 / 系统架构 / 代码)· **代码是细节唯一真相**。
> 🔴 变更需用户确认(R5)· 任一单元格 ≤ 1 行 · 维护规范 → `docs/teamwork-space-guide.md`(随 skill · 不复制进项目)。
> 🔴 本项目为**单子项目**(N=1)· 暂无 `product-overview/`(产品愿景以 `README.md` 为权威源)· 后续若纳入多线规划再补。

## 知识入口（索引之索引 · 零死角）

<!-- 🔴 每个磁盘上存在的知识节点一行指针 · 漏一个 = 知识泄露死角 -->

| 知识域 | 入口 | 内含 |
|--------|------|------|
| 产品愿景 / 里程碑 | [`README.md`](README.md) | 定位 · 概念模型 · UI 蓝图 · M1–M5 里程碑 · 架构(远程就绪)· 选型决策 |
| 工程速查(开发者手册) | [`docs/DEV.md`](docs/DEV.md) | 环境 · 命令 · 目录结构 · 架构要点 · CI/发版 · 已知约束 |
| 工程规范(workspace) | [`project-specs/`](project-specs/) | DEV-RULES · KNOWLEDGE · GLOSSARY · TROUBLESHOOTING |
| 系统架构(workspace) | [`project-specs/ARCHITECTURE.md`](project-specs/ARCHITECTURE.md) | UI壳↔Host 拓扑 + 依赖契约 + `src/` 目录布局 |
| 代码(唯一真相) | `grep` + `Read` 源码 | 🔴 细节一律现查代码 · 不信文档转述 |

## 子项目清单（路由权威）

<!-- 🔴 docs_root 必填(路由权威)· 单项目 = 1 行 -->

| 缩写 | 名称 | 类型 | 职责范围 | docs_root | 承接执行线 | 技术栈 | 需要 UI | 消费方 | 完成度 |
|------|------|------|----------|-----------|-----------|--------|---------|--------|--------|
| TERMPRO | TermPro | business | 负责:终端为主体的多工程/多会话工作台(UI壳 + Host + 状态感知)。不负责:绑定特定 agent · 完整编辑器/LSP · Windows/Linux | `docs/features` | -（无 product-overview） | Electron · React(Vite) · xterm.js · node-pty · monaco | 是 | - | 0/0 · 里程碑见 README §四(M1–M4 ✅ · M5 远程 Host 待做) |

---

> 完整结构(规划状态 / 执行线 / 待规划池 / 跨项目变更)见模板 `templates/teamwork-space.md` + guide · **系统架构**(UI壳↔Host 拓扑/依赖/目录)→ `project-specs/ARCHITECTURE.md`。规划期(product-overview)按需补。
