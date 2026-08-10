---
feature_id: OKWORK-F260810051623-Remote-Profile-Authority
flow: Feature
total_wall: 9.2h
ai_autonomous_min: 115
await_user_min: 379
host: codex-cli
---

# 流程复盘 · OKWORK-F260810051623-Remote-Profile-Authority

## 一、各阶段耗时

| stage | 耗时 | 其中等用户 | 总轮次 | 其中协调开销 |
|---|---:|---:|---:|---:|
| goal | 24m | 9m | 2 | 0 |
| ui_design | 44m | 366m | 2 | 0 |
| panorama_sync | 1m | 0 | 1 | 0 |
| blueprint | 13m | 0 | 1 | 0 |
| dev | 20m | 0 | 6 | 2 |
| review | 3m | 0 | 2 | 1 |
| test | 6m | 0 | 2 | 1 |
| browser_e2e | 4m | 0 | 1 | 0 |
| pm_acceptance | 4m | 3m | 1 | 0 |

机器汇总：工作阶段总和 115m；最耗时工作阶段为 ui_design 44m（38%）。总墙钟减 AI 活动和已标记用户等待后的差额是未标记挂机空闲，不计作 AI 工作。

## 二、耗时归因

### dev

- **协调开销 2/6 轮**，类型：全文件格式噪声收敛；worktree 验证依赖补齐。
- **最大的一笔**：误用默认 Prettier 改写整文件后撤回格式噪声，并为独立验证补齐 worktree 依赖。
- **可避免**：以项目 ESLint/既有格式为准，不在存量文件上运行默认 Prettier write；验证开始前按 KNOWLEDGE 的 worktree 依赖清单一次准备。

### review

- **协调开销 1/2 轮**，类型：上游信任边界冲突回补。
- **最大的一笔**：F1 暴露“main-only/文件权限”承诺与同 SSH UID 任意 FS/PTY 的真实权限模型矛盾，用户确认回归 WS-02 信任边界后同步 PRD/TECH/TC/UI/预览。
- **可避免**：Goal/TECH 起草时先把安全承诺逐项映射到 OS principal 与已有生产能力；本次已沉淀 RD-15/GO-039 与 ADR-0003。

### test

- **协调开销 1/2 轮**，类型：已登记基线 flake 复验。
- **最大的一笔**：首次全量出现两个 Host fs.watch/负载 flake；定向 18/18 后再跑完整套件，最终唯一 T-032 由机器差分确认 `new=[]`。
- **可避免**：不能省略 full rerun，但 test runner 可在发现精确已登记 ID 后直接输出差分口径与复验建议，减少人工编排。

## 三、流程反思

- **拦住真问题**：Goal fast review 拦下 2 个 high 需求缺口；Code Review 拦下 F1 BLOCKER（安全承诺与同 UID 权限矛盾）和 F2 MAJOR（不兼容 Host 可提交）；两项均修复。真实 Host CLI/Electron E2E 证明跨进程与视觉边界。
- **纯过场候选**：无。panorama_sync 只有 1m，但承接了用户要求的最新 UI 反向同步；browser_e2e 在 connector 无实例时仍用 shipped Electron 产物提供了 10 张证据。
- **流程新判例**：test-start brief 要求 `test-complete --test-runner/--test-tree-hash`，但当前 test-complete parser 不接受这两个参数；fast review-retry 的通用 brief 也提示 `--verify-fixes`，而 fast roster 没有 external baseline，命令必失败。建议 teamwork 让 brief 按实际 parser/roster 生成。Browser E2E 的“URL bar”规则也应明确 Electron 内置浏览器可用应用 chrome + 地址栏满足。
- **成本异常**：UI design 的 366m 是用户等待，不是 AI 工作；测试的 T-032 是已登记负载 flake，报告保留真实 exit 1 并由差分门禁放行，没有伪写全绿。

## 四、起草可预防性

- **4/4 可预防**。缺的考虑点：迁移清源失败应与 authority 提交分界逐项对齐；main-only 必须写现有 renderer token 负向验收；安全承诺需先对照实际 OS principal 与 FS/PTY 权限模型；目标可用性需在 UI 选择前绑定当前连接代兼容性。

## 五、给下一个 feature 的一句话

BL-008 必须复用本次唯一 authority、connection generation 与迁移提交边界，并明确区分 Cookie 可继续使用和密码能力 fail-closed；测试门禁开始前先核对 brief 参数与实际 parser。
