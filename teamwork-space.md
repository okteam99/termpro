# Teamwork Space

> **本项目知识地图根 · 索引之索引** · 任何 session 先读本文件 → 指向每个知识节点(子项目 / 规划 / 工程文档 / 三方 / 归档冷库)· **代码是细节唯一真相**。
> 🔴 变更需用户确认(R5)· 任一单元格 ≤ 1 行 · 维护规范 → `docs/teamwork-space-guide.md`(随 skill · 不复制进项目)。
> 🔴 本文件 bootstrap **自动建骨架** · 子项目清单 / 规划章节由 product-overview「✅ 已确认」+ Feature Planning 回填(派生关系不变)。

## 知识入口（索引之索引 · 零死角）

<!-- 🔴 每个磁盘上存在的知识节点一行指针 · 漏一个 = 知识泄露死角 · bootstrap 自动探测维护 -->

| 知识域 | 入口 | 内含 |
|--------|------|------|
| 工程规范(workspace) | [`project-specs/`](project-specs/) | DEV-RULES · KNOWLEDGE · GLOSSARY · TROUBLESHOOTING · RESOURCES |
| 系统架构(workspace) | [`project-specs/ARCHITECTURE.md`](project-specs/ARCHITECTURE.md) | 子项目拓扑 + 依赖 + 目录布局 |
| 代码（唯一真相） | `grep` + `Read` 源码 | 🔴 细节一律现查代码 · 不信文档转述 |

## 子项目清单（路由权威 · 待规划填充）

<!-- 🔴 docs_root 必填(路由权威)· 由 product-overview ✅确认 + Feature Planning 拆分后填入 · 单项目 = 1 行 · **空表时 state.py 路由校验 SKIP**(填入后才生效) -->

| 缩写 | 名称 | 类型 | 职责范围 | docs_root | 承接执行线 | 技术栈 | 需要 UI | 消费方 | 完成度 |
|------|------|------|----------|-----------|-----------|--------|---------|--------|--------|
<!-- 待规划填充:此处尚无子项目行 → 路由校验 SKIP -->

---

> 完整结构(规划状态 / 执行线 / 待规划池 / 跨项目变更)见模板 `templates/teamwork-space.md` + guide · **系统架构**(子项目拓扑/依赖/目录)→ `project-specs/ARCHITECTURE.md`(已外迁)· 规划期按需补。
