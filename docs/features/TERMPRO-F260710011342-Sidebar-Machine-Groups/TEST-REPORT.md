# TEST-REPORT · BL-004 机器分组 Sidebar + 添加项目流程

- **Feature**: TERMPRO-F260710011342-Sidebar-Machine-Groups
- **Stage**: test（QA 集成验收 + AC 全覆盖最终验证）
- **日期**: 2026-07-10 · **base**: origin/yolo/m5-remote-host

## 门禁总览

| 门禁 | 结果 |
|------|------|
| `tsc --noEmit`（全仓） | ✅ 0 错误 |
| `vitest run`（全量） | ✅ 681 passed · 1 skipped · 0 failed |
| import 集门禁（perl -0777 权威正则 + 守门元测试） | ✅ 无残留裸 hostClient 单例 importer |
| verify-ac.py（AC↔test 机读覆盖） | ✅ 11/11 AC · 无幽灵测试（TC frontmatter 全对齐真实文件） |
| 无头冒烟（`TERMPRO_SMOKE=1`） | ✅ SMOKE_OK |
| E2E 脚本（`e2e/sidebar-machine-groups.e2e.sh`） | ✅ E2E PASS |

## 端到端验证分层（e2e/sidebar-machine-groups.e2e.sh · 可运行）

- **L1 无头冒烟（✅ SMOKE_OK）**：整应用启动 → 嵌入式 host 握手 → renderer 加载机器分组 Sidebar。证明 hostClient→hostRegistry **53 消费点迁移**未回归本机路径（AC-6 硬约束：本机 host 行为零变化）。
- **L2 组件+数据模型（✅ renderer 422 全绿）**：Sidebar 机器分组/AddWorkspaceModal 远程目录浏览器/作用域隔离/复合键路由/D-7 远程文件禁用/import 集门禁。
- **L3 真机远程（承接 spike）**：远程 workspace 全链路走该机 host + 添加项目落远程注册表——沙箱无 sshd，承接 BL-003 concern·发版前真机 spike。

## AC 覆盖矩阵（11/11 · 无幽灵测试）

| AC | 覆盖 | 验收要点 |
|----|------|---------|
| AC-1 | SidebarMachineGroups | 本机组置顶 + M 远程机组未连接态 |
| AC-2 | SidebarMachineGroups + MachineWorkspaceRow | 连接展开该机 workspace + 徽标(本客户端 tab 数·可为 0) |
| AC-3 | AddWorkspaceRemoteDir | 远程目录浏览器加载/空/错误态 |
| AC-4 | AddWorkspaceRemoteDir + remoteCreateScope | workspace.create on 该 host + create 不落本机(forHostId null 拒绝) |
| AC-5 | grepgate + composite-route + FilePanelRemoteDisabled + hr-remote + deps | 全消费点经 forWorkspace 走该机 host + import 集门禁 + 远程文件禁用 |
| AC-6 | hostClientEmbeddedRegression + snapshot-scope + composite-nocross | 本机零回归 + 作用域隔离 + 复合键不串 tab |
| AC-7 | hostRegistry | 权威键=map 键(local\|configId)·hostId='local' 恒解析既有单例 |
| AC-8 | SidebarMachineGroups | 组头连接中/失败+重试(复用 BL-003 事件面) |
| AC-9 | workspaceServiceParamsValidation | workspace service 边界 params 校验(F10) |
| AC-10 | SidebarMachineGroups | M=0 单本机组头 |
| AC-11 | remoteDisconnectFallback | 断线活跃 ws 回落本机首个 + 组折叠 |

## 最高风险守门（真捕获回归·三视角 verify 确认非绿桩）

- **作用域隔离（blueprint E2 BLOCKER 区）**：本机加项目不清远程组 + 远程 active 不被抢 + 远程快照不动本机——双层（纯函数 workspaceSync + store 集成）真断言，旧码此场景真红、新码真绿。
- **拖拽下标（review E1）**：多机场景（远程排前）拖本机 ws 落位正确（全量坐标系 + 前缀不变式双保险），旧码误动远程项、新码正确 + 不随 serialize 持久错位。
- **D-7 远程文件禁用**：6 入口（3 内容 + 3 系统打开）全 aria-disabled+提示（非原生 disabled 静默失败），树浏览不受影响。
- **import 集门禁**：perl -0777 权威正则（免疫折行/注释/type/path/多行五坑）+ 守门元测试锁正则不退化。

## 预存在基线（差分 0 新增）

host PTY 测试 `posix_spawnp`（node-pty native）——npm i 装上 native 模块后本轮全跑通（681 passed）；BL-004 未碰 src/host PTY 路径（改动全在 renderer + workspaceService）。已登记 project-specs/test-baseline.md（与 BL-003 同基线）。

## 发版前/后续 concerns（已 add-concern 留痕）

- 真机远程 spike（远程 workspace 全链路 + 添加项目落远程注册表·承接 BL-003）。
- PENDING-005 远程查看器窗口可见性延后（D-7）。
- F8 deferred：Sidebar 握手编排镜像 RemoteHostsPage 双源（复用面扩大前收敛单源）。

## 结论

**集成验收通过**。integration exit-code=0 · e2e（分层·恒跑层全绿·真机层 spike）· verify-ac 11/11 真覆盖 · 冒烟 SMOKE_OK。三视角代码评审两轮收敛 APPROVE，地基作用域隔离/复合键/本机零回归均真断言守门。可进 pm_acceptance。
