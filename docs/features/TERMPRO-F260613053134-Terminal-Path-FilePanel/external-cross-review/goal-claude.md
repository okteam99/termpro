---
review_model: 2.1.177 (Claude Code)
review_role: external
review_stage: goal
target_commit: 458b7c1ca7902711121ab4ace2129778b5c7a3c4
target_base: main
title: "TERMPRO-F260613053134-Terminal-Path-FilePanel · goal stage external review"
generated_at: "2026-06-13T05:52:52Z"
invoked_by: state.py external-review (v8.20)
host: codex-cli
---
REVIEW-ACK goal-claude-20260613T054849Z

---
perspective: external-claude
target: prd
generated_at: "2026-06-13T05:48:49Z"
files_read:
  - PRD.md
  - src/renderer/terminal/terminalLinks.ts
  - src/renderer/components/FilePanel.tsx
  - src/renderer/state/store.ts
model: "claude-opus-4-8"
findings:
  - id: CR-1
    checklist: C1
    severity: high
    location: "PRD.md AC-1 / 优先级解释段（owning tab）"
    issue: "PRD 把目标统一表述为「owning tab 的 File Panel」，但 File Panel 只为「当前 active workspace 的 active tab」渲染；若 owning tab 属于非活动 workspace，仅前台化该 tab 无法让它的 File Panel 出现。"
    rationale: "FilePanel.tsx:54-61 的状态全部从 selectActiveWorkspace + activeTab 派生，背景 workspace 的 tab 其 File Panel 从未挂载；AC-1 通篇未提切换 active workspace。"
    suggestion: "明确：终端链接是否可能在背景 workspace 的终端被激活。若可能，AC-1 必须同时前台化 owning workspace；若不可能（背景终端不可点击），则声明 owning tab 恒为当前 active tab，并据此简化「foreground」语义。"
  - id: CR-2
    checklist: C2
    severity: high
    location: "PRD.md AC-1（make File Panel visible）/ AC-9（without changing File Panel visibility）"
    issue: "多条 AC 以「让 File Panel 可见 / 不改变可见性」为可测断言，但 File Panel 当前是常驻 pane，store 只有 filePanelWidth，没有 hidden/collapsed 概念，「可见」未被定义。"
    rationale: "store.ts 无任何 File Panel 可见性/折叠状态，FilePanel.tsx 始终渲染该 pane；在「可见」未定义前，AC-1 的「make visible」与 AC-9 的「不改变可见性」无法被具体测试。"
    suggestion: "先定义可见性模型（如新增 collapsed 标志或以 width 阈值判定）以及「make visible」具体执行什么；若 pane 实为始终可见，则删去可见性相关措辞以免产生不可测断言。"
  - id: CR-3
    checklist: C5
    severity: high
    location: "PRD.md AC-4 / 术语解释段（auto 推导值写入绑定）/ 待决策项（空）"
    issue: "AC-4 在一次「定位浏览」点击中，把 auto 推导的 root/worktree 写入 tab 的持久化绑定——查看路径这一动作静默改变了面板的持久根，且跨刷新/重启存活。"
    rationale: "updateTabFilePanel 会持久化 filePanel；一个意在定位文件的点击改变 tab 的 root 绑定，可能令用户在之后刷新/切换时困惑。这是真实的产品取舍，但「待决策项」标为无。"
    suggestion: "将此提升为显式待决策项，列出选项（写入 auto 绑定 vs 仅定位不持久化）并与产品/用户确认；当前 PRD 把一个有争议的副作用当作既定事实。"
  - id: CR-4
    checklist: C4
    severity: low
    location: "PRD.md AC-4（applies expansion state scoped to the new effective root）"
    issue: "expanded 是 per-tab 的单一绝对路径集合、两种模式共享，并无 per-mode 展开存储；「expansion state scoped to the new effective root」可能误导实现去新增不存在的 per-mode 展开结构。"
    rationale: "store.ts TabFilePanelState.expanded 仅一个 string[]，FilePanel.tsx 在渲染时按 effectiveRoot 过滤；「scoped」是渲染时涌现而非按模式存储。"
    suggestion: "澄清「scoped」指共享 expanded 集合中位于新 effective root 之外的路径自然不渲染；若确实要 per-mode 展开集，需在 PRD 明确并相应调整持久化形状。"
  - id: CR-5
    checklist: C3
    severity: low
    location: "PRD.md AC-8（case sensitivity matched to the host filesystem when detectable）"
    issue: "「when detectable」无任何探测方法定义；macOS 大小写敏感性是 per-volume 的（APFS 默认不敏感 vs 大小写敏感卷 / 外置盘），同一主机不同卷结论不同。"
    rationale: "缺少探测机制时，containment 结果随卷而变，AC 无法可复现地测试，且可能在外置/网络卷上判错。"
    suggestion: "定义探测方式（per-volume 探针 / pathconf）以及不可探测时的降级（例如默认大小写敏感比较，或直接转 AC-9 fallback）。"
  - id: CR-6
    checklist: C3
    severity: low
    location: "PRD.md AC-5 / 流程图（select and scroll file row）/ containment"
    issue: "当目标恰好等于 effective root 本身时，树里没有它对应的行（行从 root 的子项 depth 0 开始），「展开祖先链 / 选中行」没有可定位对象。"
    rationale: "FilePanel.tsx flattenTree 以 effectiveRoot 的子项作为 depth 0，root 自身无行；AC-5 默认目标必有一行可定位。"
    suggestion: "明确 target == effective root 时的行为（如视为「已定位」：仅确保面板可见、不选中任何行），避免错误落入「行缺失」的 AC-9 兜底。"
  - id: CR-7
    checklist: C3
    severity: low
    location: "PRD.md AC-9（path disappears between resolution and activation）"
    issue: "存在性由 5s 的 hover stat 缓存判定；hover 后被删除但仍在 5s 内的路径，激活时仍被当作存在，定位可能跑在已消失路径上。"
    rationale: "terminalLinks.ts STAT_CACHE_MS=5000，activate 复用缓存的 kind；AC-9 的「disappears」要求激活时刻有新鲜校验，而非沿用 hover 缓存结果。"
    suggestion: "要求在激活时（或在首个目录层读取失败时）重新校验存在性/类型，再进入定位或落入 AC-9，避免对缓存乐观假设。"
  - id: CR-8
    checklist: C1
    severity: low
    location: "PRD.md AC-2 / AC-3 / AC-5（scrolls/selects the target row · selected/highlighted）"
    issue: "File Panel 当前没有任何「选中/高亮行」概念（点击文件行直接 openViewerWindow）；AC 引入了持久选中态却未定义其生命周期。"
    rationale: "FilePanel.tsx 的行无 selected 状态，「选中/高亮」属净新增；未定义：用户滚动、点别处、切 tab、刷新后选中是否保留/何时清除。"
    suggestion: "定义选中模型生命周期（何时置位、何时清除、是否跨 tab 切换/刷新保留），使 AC-2/3/5 可被无歧义测试。"
findings_summary:
  blocker: 0
  high: 3
  low: 5
  info: 0
  total: 8
---

# 详情（人读补充）

本轮以代码为锚做异质视角采样。PRD 已历经 5 版、3 轮外审，contai​nment / location-only / line-col / 并发 last-click-wins 等已较成熟，未见逻辑相互矛盾的 blocker。最有价值的三条独立发现集中在「PRD 的语义建立在尚不存在的 UI 状态概念之上」：

1. **owning tab vs owning workspace（CR-1）**：File Panel 仅渲染 active workspace 的 active tab。PRD 全程只说「owning tab」，但 tab 隶属 workspace；若链接可在背景 workspace 触发，「前台化 owning tab + 显示其 File Panel」必须同时切 workspace，否则面板根本不挂载。需先界定背景 workspace 的终端是否可点。

2. **「可见性」未定义（CR-2）**：store 只有 filePanelWidth，没有 hidden/collapsed。AC-1「make visible」与 AC-9「不改变可见性」都建立在一个当前不存在的概念上，导致不可测。

3. **导航点击持久化改绑定（CR-3）**：AC-4 把 auto 推导根写入持久绑定，是「查看即改持久态」的副作用，却被放进既定事实而非待决策项。建议显式让用户拍板。

其余 5 条为低风险细化：expanded 跨模式共享语义（CR-4）、大小写敏感探测缺失（CR-5）、target==root 边界（CR-6）、5s stat 缓存与「路径消失」兜底的时序（CR-7）、选中态生命周期未定义（CR-8）。建议进入 blueprint 前优先解决 CR-1/CR-2/CR-3，其余可在 TECH/TC 阶段细化。
