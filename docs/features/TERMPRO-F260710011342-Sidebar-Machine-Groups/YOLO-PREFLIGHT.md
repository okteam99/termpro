# YOLO 预研 + 核心决策确认（TERMPRO-F260710011342-Sidebar-Machine-Groups · BL-004）

> yolo run 范围：BL-003 → **BL-004** → BL-005 串行连续交付（用户一次性授权 · 2026-07-10「yolo 模式完成这三个待做」+ 逐条确认「ok」）。BL-003 已交付合入集成分支 yolo/m5-remote-host。本文件为 BL-004 预研门产物。

---

## 1. 深入调研（grounded 真实代码 · 基于含 BL-003 的集成分支）

- **任务实质**：WS-01-S4——Sidebar 按机器分组（本机 + 各远程机 · 连接即发现该机 workspace 与会话徽标）；「添加项目」= 选择机器 → 本机系统对话框 / 远程目录浏览器（fs.readdir over 远程 host）→ 创建落**对应 Host 注册表**。让 BL-003 已建的 per-host 连接能力真正被 Sidebar/工作台消费。
- **真实代码现状**（实读集成分支）：
  - `src/renderer/components/Sidebar.tsx`（329 行）：**平铺 workspace 列表**（单 host 假设）· `import { hostClient }` 直接用本地单例 · 「+」走 `dialog:pick-directory` 原生对话框 · 无机器分组概念。
  - BL-003 已交付：`src/renderer/services/hostRegistry.ts`（per-host HostClient 注册表 · 'local' + 远程键）· `src/main/remote/remoteHostIpc.ts`（remoteHost:list/connect/event 等）· `src/renderer/state/remoteHostStore.ts`（运行时事件态）。**BL-004 全面消费这些**（BL-003 只建结构未迁消费方）。
  - `src/shared/protocol.ts`：`workspace.list/create/remove/update` 已存在（BL-001）· `host.info.hostId` 恒 'local'（真实化是 BL-004 前置——见决策 3）。
  - 全景 `/workspace/add-workspace`（`docs/design/preview-project/src/main.jsx`）：MachineGroup 分组 + 「添加项目」modal（选机器→本机目录/远程目录浏览器）+ connecting/deploying/error 注入态 · 已用户确认（2026-07-09）。
- **范围边界**：做 WS-01-S4 全部 AC（Sidebar 机器分组 + 连接即发现该机 workspace/会话徽标 + 添加项目选机器→远程目录浏览器→落对应注册表 + 远程 workspace 终端/文件/git 全链路走该机 host）+ **PENDING-002**（注册表周边小项组：备份内容断言 / remove·update no-op churn / service 边界 params 运行时校验 / viewer 广播冗余 / 重试耗尽提示措辞）。不做：会话存活/重连（BL-005）· mobile。
- **未知与风险**：① `hostClient` 单例被 store/terminal/filepanel 40+ 处引用——迁移到 hostRegistry 按 host 选择是本 Feature 最大改面，须保本机路径零回归；② `host.info.hostId` 真实化（恒 'local'→真实 id）涉 protocol.ts，需向后兼容；③ 远程目录浏览器 = fs.readdir over 远程 host client，依赖 BL-003 连接真跑通（沙箱无真机 → 桩测 + 真机 spike 发版前）。

## 2. 核心重要决策（yolo auto 代决 · 承 BL-003 已确认技术路线 · 错向成本低可 blueprint 前推翻）

| # | 决策点 | 倾向 | 备注 |
|---|--------|------|------|
| 1 | hostClient 单例 → hostRegistry 迁移范围 | **渐进迁移 · 保本机路径零回归**：store/terminal/filepanel 的 host 消费改为按当前 workspace 所属 hostId 选 client（本机 workspace → 'local' 复用既有单例，行为不变；远程 workspace → 对应远程 client） | BL-003 已备 hostRegistry 结构 · 本 Feature 迁消费 |
| 2 | host.info.hostId 真实化 | **协议向后兼容追加**：host.info 返回真实 hostId（本机=稳定本机 id / 远程=配置 id），renderer 以此为 per-host 键；缺省（旧 host）回退 'local' | protocol.ts 零破坏追加 · BL-003 已标为 BL-004 前置 |
| 3 | Sidebar 机器分组数据源 | **本机置顶 + 远程机分组**：本机组恒在（workspace.list on local）；远程机组来自 remoteHost:list，连接后拉该机 workspace.list + 会话徽标；未连接机器显示「连接」入口 | 对齐全景 MachineGroup |
| 4 | 添加项目落注册表 | **选机器→该机目录浏览器→workspace.create on 该 host client**：本机走原生 dialog:pick-directory（保留）；远程走 fs.readdir over 远程 host 的目录浏览器 → workspace.create 落**该机** Host 注册表 | 对齐全景「添加项目」modal |
| 5 | PENDING-002 并入范围 | **本 Feature 顺路清**：F6 备份内容断言 / F9 remove·update no-op 不广播（churn）/ F10 service 边界 params 运行时校验(BL-004 远程面正是消费点) / F11 viewer 广播冗余 / F13 重试耗尽提示措辞 | 台账原建议 BL-004 开工前清 |
| 6 | 执行编排 | 串行 BL-004 · merge_target=yolo/m5-remote-host · pm_acceptance 自动 approved_and_ship(WARN) · MR 自动合入集成分支 · 集成→main 人工 | 同 BL-003 |

## 3. 用户确认

- **确认范围**：用户 2026-07-10「yolo 模式完成这三个待做」+ 对 BL-003 预研门 6 决策逐条「ok」= **blanket 授权三个 BL 连续自主执行**（零暂停点直到各自 ship）。BL-004 承接同一授权；本 §2 决策均延续 BL-003 已确认的技术路线（hostRegistry/per-host 键/safeStorage 等）或对齐已用户确认的全景，无偏离原授权的新方向。
- **评审安全网知悉**：worktree 无 localconfig → 第三视角默认降级同模型 subagent 隔离冷审（非跨模型异质 · 已知悉 · 三视角评审全真跑）。
- **确认记录**：blanket yolo 授权（用户原话「yolo 模式完成这三个待做」+「ok」）· BL-004 §2 为 auto 代决 · 各计 concerns WARN · 错向可在 blueprint 前被评审推翻。
