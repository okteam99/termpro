# 测试基线失败集（test-baseline · 项目级单源）

> **telos**：brownfield 项目的共享测试套件常带**预存在失败**（base 即红 · 历史重构遗留 / 其他 feature 欠债）。没有登记机制时，**每个**碰到该套件的 feature 都要重复「stash → 跑 base → diff → 在 REVIEW 里论证非本 feature 回归」的甄别成本（同一批失败被逐 feature 反复甄别）。
>
> 本文件把「base 上**已知**的预存在失败」登记成**项目级单源**，让 test gate 改成**差分**判定：
> - **0 个新增失败**（当前失败 ⊆ 本表）→ 红 base 也放行（不是回归）。
> - **有新增失败**（当前失败 − 本表 ≠ ∅）→ = 回归（修）**或** 新出现的预存在（核实后 `--add` 登记原因）。
>
> 下一个 feature 直接读本表，不再重新 derive。

## 用法

```bash
# 登记一个预存在失败（核实确属 base 即红、非本 feature 引入后）
state.py test-baseline --add --feature <feature路径> \
  --test-id "<与 --current-failures 一致的用例 id>" \
  --suite "<套件/命令>" --reason "<为何红 · 谁的债 · 何时清>" [--base-commit <sha>]

# 看当前登记
state.py test-baseline --list --feature <feature路径>

# 差分预览（跑完套件后 · 不写状态）
state.py test-baseline --diff --feature <feature路径> --current "id1,id2,id3"

# 在 test-complete / dev-complete 走差分 gate（红 base + 0 新增 → 放行）
state.py test-complete --integration-test-exit-code 1 --current-failures "id1,id2" ...
```

## 🔴 纪律

- **id 一致**：`--test-id` / `--current-failures` 用**同一种**用例标识（如 pytest nodeid、`suite::case`、vitest 全名）· 工具按字符串精确匹配。
- **登记要有原因 + 清账计划**：不是「把红的都塞进来绕过 gate」· 每条写清「谁的债 / 何时清」· stale 条目（已不再失败）应删（`--diff` 会标 `stale_registered` 提示）。
- **只登记 base 即红的**：本 feature 改动**新引入**的失败**绝不登记** —— 那是回归，必须修。核实方法 = 在 base（无本 feature 改动）上跑该用例确认即红。
- **单源**：执行态在各套件、登记在本表 · test gate 差分自本表 · 不在别处复制。

## 登记表

| 失败用例 (id) | 套件/命令 | 基线 commit | 原因（谁的债 · 何时清） | 登记于 |
|---|---|---|---|---|
<!-- 示例（删之）：| developer_earnings_it::test_settlement | cargo test --lib | a1b2c3d | F-Bv2 重构遗留 · 待 owner 修(REVIEW-#42) | 2026-06-15 | -->
| src/host/__tests__/wsMultiClientIsolation.test.ts,src/host/__tests__/wsRpcParity.test.ts,src/host/__tests__/wsHandshakeGate.test.ts | npx vitest run (src/host PTY-exercising WS suites) | — | 沙箱环境 posix_spawnp failed(PTY fork 被拒)· 非代码缺陷 · BL-003 前已存在(stash 复核基线同样 12 失败)· 环境债 · 真实 CI/本机有 PTY 时自愈 · 与本 Feature 改动(wsServer Origin/节流·未碰 PTY 路径)无关 | 2026-07-09 |
| src/host/__tests__/wsMultiClientIsolation.test.ts,src/host/__tests__/wsRpcParity.test.ts,src/host/__tests__/wsHandshakeGate.test.ts,src/host/__tests__/tokenGate.test.ts | npx vitest run (host PTY-exercising suites) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · BL-004 未碰 src/host PTY 路径(改动全在 renderer+workspaceService)· stash 复核基线同样失败 · 与 BL-003 同基线 | 2026-07-10 |
| src/host/__tests__/ptyPoolDetach.test.ts,src/host/__tests__/reconnectContinuity.integration.test.ts | npx vitest run (src/host BL-005 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · BL-005 新增 detach/reattach/exited/reconnect 集成测真 node-pty · 0 断言失败(逻辑全绿)· 与 BL-003/004 同基线 · 真实 CI/本机有 PTY 时自愈 | 2026-07-10 |
| src/host/__tests__/wsMultiClientIsolation.test.ts | npx vitest run (src/host 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · 0 断言失败 · 与 BL-003/004 同基线 · 真机/CI 有 PTY 时自愈 · 独立条目(对齐单文件 --current 精确匹配) | 2026-07-10 |
| src/host/__tests__/wsRpcParity.test.ts | npx vitest run (src/host 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · 0 断言失败 · 与 BL-003/004 同基线 · 真机/CI 有 PTY 时自愈 · 独立条目(对齐单文件 --current 精确匹配) | 2026-07-10 |
| src/host/__tests__/wsHandshakeGate.test.ts | npx vitest run (src/host 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · 0 断言失败 · 与 BL-003/004 同基线 · 真机/CI 有 PTY 时自愈 · 独立条目(对齐单文件 --current 精确匹配) | 2026-07-10 |
| src/host/__tests__/tokenGate.test.ts | npx vitest run (src/host 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · 0 断言失败 · 与 BL-003/004 同基线 · 真机/CI 有 PTY 时自愈 · 独立条目(对齐单文件 --current 精确匹配) | 2026-07-10 |
| src/host/__tests__/ptyPoolDetach.test.ts | npx vitest run (src/host 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · 0 断言失败 · 与 BL-003/004 同基线 · 真机/CI 有 PTY 时自愈 · 独立条目(对齐单文件 --current 精确匹配) | 2026-07-10 |
| src/host/__tests__/reconnectContinuity.integration.test.ts | npx vitest run (src/host 真 PTY 套件) | — | 沙箱 posix_spawnp failed(PTY fork 被拒)· 环境债非代码缺陷 · 0 断言失败 · 与 BL-003/004 同基线 · 真机/CI 有 PTY 时自愈 · 独立条目(对齐单文件 --current 精确匹配) | 2026-07-10 |
| wsRpcParity.test.ts > AC-1 fs.watch 经 WS 推送 (T-032/T-033) > T-032 目录变更经同一 WS 推 fs:changed 且仅一次(去抖) | npx vitest run | 0fa8e29 | 既有间歇 flake(非本 Feature 引入):本 Feature 动代码**之前**的基线跑就已红过一次;本 Feature 全部改动在 renderer/main IPC 层,与 host 的 fs.watch 路径无交集。特征=负载敏感的限时预算断言(pokeUntilFsEvent 在 budgetMs 内收 fs:changed),单独重跑 3/3 通过、并发满载时偶红。清偿建议:把该断言从固定预算改为轮询到达+上界重试,或提高 budgetMs。 | 2026-08-05 |
| src/host/__tests__/ptyPoolMirror.test.ts | npx vitest run(全量并发时) | 66ddeb2 | 负载敏感间歇 flake(非本 Feature 引入):全量并发跑偶红,断言是 PTY ring 的字节数恒等(本次 expected 908665 to be 907641,差 1024 = 正好一个读块),即「摘空期产出」在高负载下多录/少录一个 chunk。**单独重跑 3/3 全过**(reflake-ptyPoolMirror-{1,2,3}.log);本 Feature 改动全在 renderer + main/remote,git diff 7d2dc6c..66ddeb2 -- src/host/ = 0 文件;同一份 src/host 代码在本 Feature 的第二轮门禁里全绿。清偿建议:把该断言从字节数恒等改为「≥ 摘空前基线且单调」,或在断言前等 ring 稳定(轮询到连续两次读数相同)。owner = host PTY 模块 | 2026-08-05 |
