---
feature_id: "TERMPRO-F260613041948-quiet-notify"
stage: pm_acceptance
ac_verification: "5/5 通过"
generated_at: "2026-06-13T05:06:00Z"
---

# PM 验收(TERMPRO-F260613041948-quiet-notify)

## 逐条 AC 对照(用户视角)

| AC | 期望(用户视角) | 实现 | 验收 |
|----|----------------|------|------|
| AC-1 | 离开 tab 后**没新动静**(含从未激活)→ 1 分钟后**不**再无端提示 | `hadOutputSinceLeave=false` → `decideQuietAction` 抑制(不标 waiting/不通知) | ✅ T-001/T-002 + 三视角 review |
| AC-2 | 离开后**有新输出再停住** → 提示一次「可能在等输入」(通知中心,不弹系统通知) | `lastOutputAt>deactivatedAt` → 标 waiting + 一次通知(闩锁) | ✅ T-003 |
| AC-3 | 正看着的 / 当前 tab → 跟以前一样不打扰 | `isCurrentTab`/`focusedTab` 分支在 gating 前短路,行为不变 | ✅ T-004 |
| AC-4 | 回看该 tab 或它又动起来 → 提示消失,且要再次「有新增→停住」才会再提醒 | `resetTabActivity` 重置基线 + `quiet:false`/`clearAttention` | ✅ T-005 |
| AC-5 | 反复切来切去 → 以最近一次离开为准判断 | `recordDeactivated` 覆盖写最近时刻 | ✅ T-006 |

## 核心用户价值

✅ **达成**:解决了「离开一个其实没在干活的 tab(挂着的 server / 空闲编辑器),1 分钟后还被『可能在等输入』无端打扰」—— 现在只有「离开后真的产出了新内容、然后停住(很可能命令跑完在等你)」才提示;通知中心不再被噪音淹没。

## 质量

- typecheck ✓ · vitest 113 全绿(含 11 新测)· 无头冒烟 SMOKE_OK · verify-ac 5/5
- 三视角 review 全 APPROVE(Architect / QA / External codex)· 评审纠正了初稿脆弱的时间差判据 → 健壮的同源时间戳比较
- 范围克制:纯渲染层,未改协议/host,未触碰 done/bell/通知 其他信号(Q1=A)
- 遗留:2 条 P2 集成测试债(需 jsdom · 已 deferred 登记,纯逻辑已 11 测覆盖)

## 待用户拍板:三选项(见主对话)
