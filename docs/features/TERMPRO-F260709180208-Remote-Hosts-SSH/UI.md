---
pages:
  - {id: settings-remote-hosts, title: "Remote Hosts Management"}
panorama_medium: same-stack
panorama_path: docs/design
pages_changed:
  - page_id: settings-remote-hosts
    route_path: /settings/remote-hosts
    change_range: "在既有 RemoteHostsModal 上增量细化:测试三态 → 完整连接生命周期(空闲/连接中/部署中%/启动中/认领中/握手校验/已连接/失败分类/已断开);新增三段部署进度 stepper + 快路径认领单行提示;失败态分类文案(不可达/认证失败/超时/缺 Node/版本不兼容)与测试连接共用同一口径;删除确认补凭据清除与活跃连接提示;私钥认证表单补 passphrase 字段并修正路径占位符"
    acceptance_criteria_refs: [AC-1, AC-2, AC-4, AC-5, AC-7, AC-11, AC-12, AC-13, AC-14]
---

# Remote Hosts 连接编排 · UI 设计决策记录

## 范围与方法

本次是**纯增量**:在已用户确认的 `/settings/remote-hosts` 页(`RemoteHostsModal` / `RemoteHostsPage`,`docs/design/preview-project/src/main.jsx` E 节)上补齐 PRD 新增的连接生命周期呈现。未新增路由、未改动其他任何页面(A/B/C/D 节零字节变更)、未改动 Sidebar/FilePanel/TabBar 等共享组件。`REMOTE_HOSTS_SEED`(与 `/workspace/add-workspace` 页共用的主机 mock 数据)字段形状不变,仅在 `RemoteHostsPage` 内部的可变副本(`manualHosts` state)上叠加运行态,不影响 Add Workspace 页的主机选择器。

## 状态徽标体系(AC-5)

连接生命周期取代原先的「测试三态徽标」成为行内状态的主展示层,两者关系:

| 触发 | 状态来源 | 展示优先级 |
|---|---|---|
| 点「连接/重试/重连」 | `hostRuntime[id]`(mock 时序驱动,见下) | 高 —— 存在非空 `hostRuntime` 即接管整行状态区,屏蔽测试徽标 |
| 点「测试连接」 | `testState[id]`(沿用既有实现,未改语义) | 低 —— 仅在无 `hostRuntime` 时展示 |
| 皆无 | `host.status`(`connected`/`disconnected`) | 兜底 —— 决定闲置态是「已连接」还是「未连接」 |

点位映射(dot 颜色,`.remote-hosts__dot--*`):

| PRD 状态机节点 | dot 颜色 | 徽标文案 | 说明 |
|---|---|---|---|
| idle(从未连接 / 用户主动断开) | 灰(`--fg-dim`,复用原 `--disconnected`) | 无徽标,仅按钮 | `ready → idle` 转移=点「断开」 |
| connecting / deploying / starting / claiming / verifying | 琥珀(`--amber`,新增 `--active`) | 对应阶段文案(见下)+ `add-ws__spinner--sm`(复用 Add Workspace 页已有 spinner 组件,零新增关键帧) | 忙碌态**不渲染任何按钮**(`renderStatusArea` 直接 return 徽标),避免用户在编排中途触发编辑/删除/重复连接的竞态 |
| ready(握手校验通过) | 绿(`--green`,复用原 `--connected`) | 「✓ 已连接」 | 完成后 `hostRuntime[id]` 立即清空,回落到 `host.status==='connected'` 的稳态路径(单一事实来源,不留两套并行状态) |
| failed | 红(`--red`,新增 `--fail`) | `FAIL_REASONS[reason].label`(见下表) | 保留 `hostRuntime`,直到用户点「重试」 |
| disconnected(ready 后隧道意外断开) | 红(同 failed,视觉区分靠文案不靠颜色——两者都是「需要用户介入」的红色语义) | 「⚠ 连接已断开」 | 复用 Sidebar `MachineGroup` 已有的 `lost` 语义命名(该组件里红点+"lost"就是同一种"曾连上、现在掉线"叙事),两处红点在全局设计语言里对应同一件事 |

## 失败原因口径统一(AC-2 核心要求)

新增 `FAIL_REASONS` 字典是本次唯一的"单一事实来源"重构:「测试连接」与「连接」失败徽标现在从同一个对象取文案,不再各写各的字符串字面量(改动前 `renderTestArea` 的失败文案是硬编码 `"连接失败 · Permission denied (publickey)"`,与「连接」流程完全独立、无法保证口径一致)。

| key | label | detail | guidance | 触发场景 |
|---|---|---|---|---|
| `unreachable` | 不可达 | `Connection refused` | — | 测试连接 / 连接·connecting 阶段 |
| `auth` | 认证失败 | `Permission denied (publickey)` | — | 测试连接 / 连接·connecting 阶段 |
| `timeout` | 超时 | `Connection timed out (10s)` | — | 测试连接 / 连接·connecting 阶段 |
| `nodeMissing` | 缺少 Node.js 运行时 | 远端未检测到 node ≥ 20 | 请在远端机器安装 Node.js 20 或更高版本后重试连接 | 仅「连接」·deploying 阶段(AC-11);测试连接不部署,不会触发 |
| `incompatible` | 版本不兼容 | 远端 host v0.2.1 与当前应用 v0.3.12 协议不兼容 · 已断开 | — | 仅「连接」·verifying 阶段(AC-6) |

失败行下方新增 `.remote-hosts__fail-detail` 面板(红色描边卡片)展示 `detail` 与可选的 `guidance`,与 Add Workspace 页 `.add-ws__error-summary` 同一视觉家族(等宽字体 + 红色 + 浅红背景),但改为常驻在行内展开而非覆盖层,因为 Remote Hosts 页需要**同时**看到多台机器的状态,不能像 Add Workspace 的单机连接流程那样用整卡覆盖层遮住列表。

## 部署进度呈现(AC-4)

`renderProgressPanel` 在 `deploying/starting/claiming/verifying` 四态渲染,分两种视觉:

1. **首次部署(全链路)**:三段水平 stepper「上传 bundle → 启动 host → 握手验证」,状态三态(done 打勾绿字 / active 转圈高亮 + 百分比 / pending 空心灰点),上方附一行「已探测远端架构 · darwin-arm64」呼应 AC-4 的 uname 探测语义。视觉直接照搬 Add Workspace 页 `.add-ws__deploy-list` 的检查项语言(✓ 打勾、spinner、配色),但从纵向清单改为横向 stepper —— 因为 Remote Hosts 页每台机器只有一行的水平预算,纵向清单会把列表撑得过高;横向 stepper 在窄空间内传达同等信息密度。
2. **快路径(AC-13)**:曾成功连接过的机器(`lastUsed` 有值)重连时,不出现「上传 bundle」段,直接一行提示「发现已运行的 host 进程 · 认领中…」→「已认领运行中的 host 进程 · 握手校验…」,对应 PRD "若驻留进程仍在 → 认领既有进程不重复启动" 的产品语义。mock 时序里快路径固定走认领分支(`connecting → claiming → verifying → ready`),因为 D-5 已确认 host 进程是驻留常态,「认领」是快路径的主叙事;"跳过上传但仍需启动"的次级分支与本组件共享同一状态机骨架(仅 `fast` 标记控制文案分叉),未在默认演示数据里单独实例化第二台机器来展示——避免为覆盖一个视觉上高度相似的分支而膨胀 mock 主机列表(会连带影响 Add Workspace 页共享的 `REMOTE_HOSTS_SEED`)。

## 各态 → 动作按钮映射

| stage | 主操作 | 次操作(仅手动添加区,最近使用区只保留主操作以贯彻「一键」) |
|---|---|---|
| idle | 连接(主色) | 测试连接 / 编辑 / 删除 |
| ready | 断开 | 测试连接 / 编辑 / 删除 |
| 忙碌(connecting…verifying) | 无按钮,仅徽标 | 无 |
| failed | 重试(主色) | 测试连接 / 编辑 / 删除 |
| disconnected(lost) | 重连(主色) | 测试连接 / 编辑 / 删除 |

新增 `.remote-hosts__action--primary`(蓝底白字,复用 `.remote-hosts__btn--primary` 的配色变量)让「连接/重试/重连」这一主操作在行内视觉上一眼可辨,区别于「测试连接/编辑」等次要灰底按钮。

## 最近使用区(AC-7)

原实现只有测试连接按钮、无法一键连接 —— 已补齐:紧凑模式(`compact=true`)下只展示单一主操作按钮(连接/断开/重试/重连,视状态而定),不显示测试连接/编辑/删除,强化「快捷区」定位,与「手动添加」区(完整 CRUD)分工明确。两区共享同一 `manualHosts` 数据源与 `hostRuntime` 运行态,因此同一台机器在两个区块的状态**实时同步**(例如在手动添加区点连接,最近使用区的同一行会同步显示进度徽标)。

## 删除确认(AC-14)

确认文案从原来的纯「确认删除?」扩展为「确认删除 {alias}?将同时清除已存凭据」,若该机器当前处于 ready/忙碌态则追加「· 将先断开当前连接」。未新增二次弹窗或额外交互步骤 —— 单行文案已经把两条 AC-14 要求(随删清凭据、活跃连接先断开)讲清楚,保持既有「行内 是/否」的确认交互模式不变(项目未见 Modal-in-Modal 先例,不引入新范式)。

## 测试连接 vs 连接(AC-2)

`test-fail` 顶栏 preset 的注入目标从原来的 `mini-pc`(该机默认即为已连接状态,"测试一台已连接的机器"叙事不自洽)改为 `vps-hk`(从未连接过的机器,"连接前先测试"是其唯一合理场景)。这是本次唯一一处调整既有 mock 数据行为的地方,理由:让 preset 演示的场景在产品叙事上站得住脚,不影响任何 AC 覆盖或跨页面依赖。

## 私钥认证表单(AC-3 语义)

- 私钥路径 input 的 placeholder 从「默认使用 ssh config / agent」改为「例如 ~/.ssh/id_ed25519」—— 原文案暗示"可导入/回退到 ssh config",与 PRD Out of Scope 明确否决的 Q-003(不导入 `~/.ssh/config`)矛盾,是需要修正的既有缺陷,顺手一并修掉。
- 新增「私钥密码(可选)」密码框(`type="password"`),对应 AC-2/AC-3 的 passphrase 语义;此前表单只有私钥路径,没有 passphrase 输入位,是 PRD 明确要求但实现遗漏的字段。密码框而非明文框,提示语「加密私钥的 passphrase · 存入系统钥匙串,不明文落盘」与已有的密码字段提示语同构。

## 复用清单(与既有设计语言的关系)

- Spinner:直接复用 `.add-ws__spinner` / `.add-ws__spinner--sm`(未新建关键帧),用于忙碌徽标与 stepper 的 active 段。
- 失败态视觉家族:配色/等宽字体/边框风格对齐 `.add-ws__error-summary`。
- 红点"lost"语义:对齐 Sidebar `.sidebar-machine-dot--lost` / `MachineGroup` 已有的"曾连上现掉线"叙事,不另造新词汇。
- 按钮/徽标基础类名(`.remote-hosts__action` / `.remote-hosts__badge`)全部延用既有 BEM 前缀,新增修饰符(`--primary` / `--active` / `--lost`)遵循既有 `--pending/--ok/--fail` 命名节奏。
- 行结构重构:`.remote-hosts__row` 的 `border-bottom` 上移到新增的外层 `.remote-hosts__entry` 包裹层,使每行可在下方追加可选的进度/失败详情子块而不破坏列表分隔线逻辑;这是唯一的结构性(非纯新增)改动,影响面仅限本页列表渲染。

## AC → UI 状态映射表(验收对照)

| AC | 对应 UI 元素 |
|---|---|
| AC-1 | 手动添加区增/改/删表单(未改动,沿用既有实现) |
| AC-2 | 测试连接徽标(三态)+ `FAIL_REASONS` 与「连接」失败共享口径 |
| AC-4 | `renderProgressPanel` 全链路三段 stepper + 架构探测行 |
| AC-5 | `hostRuntime` 驱动的 dot/badge/按钮全状态切换(idle/connecting/deploying/starting/verifying/ready/failed/disconnected) |
| AC-7 | 最近使用区紧凑单按钮一键连接 |
| AC-11 | `FAIL_REASONS.nodeMissing`(含引导文案)+ `node-missing` 顶栏 preset |
| AC-12 | 失败态「重试」按钮 / disconnected 态「重连」按钮,均复用 `beginHostConnect` 走通至 ready |
| AC-13 | fast 分支跳过上传段 + 认领单行提示 + `deploying` 顶栏 preset(展示未跳过场景的百分比快照) |
| AC-14 | 删除确认文案(凭据清除 + 活跃连接提示) |

## 顶栏 preset 清单(页面到不了的态)

| preset key | 标签 | 注入内容 | 为何走 preset 而非真实交互 |
|---|---|---|---|
| `default` | 默认 | 无(原样) | — |
| `empty` | 空态 | `manualHosts=[]` | 沿用既有 preset |
| `test-fail` | 测试失败 | `testState.vps-hk='fail'` + `testFailReason.vps-hk='auth'` | 沿用既有 preset(目标机改为 vps-hk,见上) |
| `deploying` | 部署中 · 63% | `hostRuntime['gpu-box']={stage:'deploying',percent:63,...}` | 部署进度是转瞬即逝的 mock 时序中间帧,真实点击会在 ~1.5s 内自动跑完,preset 冻结在 63% 便于截图/评审查看 stepper 中段视觉 |
| `node-missing` | 失败 · 缺 Node | `hostRuntime['vps-hk']={stage:'failed',reason:'nodeMissing'}` | 该失败分类只应在真实远端探测失败时出现,mock 定时器只演示成功路径,不模拟失败分支 |
| `incompatible` | 失败 · 版本不兼容 | `hostRuntime['gpu-box']={stage:'failed',reason:'incompatible'}` | 同上,verifying 阶段的版本不兼容需真实握手失败才触发 |
| `lost` | 连接已断开 | `hostRuntime['mini-pc']={stage:'lost'}` | 隧道意外断开是外部事件(网络/远端进程退出),非用户可主动触发的 UI 动作,只能靠 preset 呈现 |

真实点击可达的状态(无需 preset):idle → connecting → deploying(百分比递增)→ starting → verifying → ready 全链路(gpu-box / vps-hk 演示首次部署,AC-4);idle → connecting → claiming → verifying → ready 快路径(dev-server 演示认领,AC-13);ready → 点「断开」→ idle;failed/lost → 点「重试/重连」→ 复用同一 mock 时序走到 ready(AC-12);删除确认的凭据/活跃连接文案(对 mini-pc 点删除即可见)。

## 验证

`cd docs/design/preview-project && npx vite build` 通过(见改动摘要)。另用 headless 浏览器(gstack browse)逐一走查:默认态截图、gpu-box 全链路点击(connecting → deploying 25% 三段 stepper + 架构行 → 快路径 claim 一行提示)、四个新增 preset(deploying/node-missing/incompatible/lost)截图、删除确认文案(mini-pc,含"将先断开当前连接")、表单新增 passphrase 字段——均按设计呈现,控制台无报错。
