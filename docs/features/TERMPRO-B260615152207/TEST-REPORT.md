---
feature_id: "TERMPRO-B260615152207-Terminal-Garbled-Text"
author: QA
status: confirmed
prd_ref: N/A (Bug 流程 · 无 PRD/TC · 规格依据 bugfix/BUG-TERMPRO-B260615152207-001.md)
tc_ref: N/A (Bug 流程)
test_run_at: "2026-06-15T17:47:00Z"
evidence:
  integration_test_exit_code: 0
  e2e_test_exit_code: 0
  ac_coverage_verify: N/A   # Bug 无 PRD/TC · verify-ac 自动 skip
revision_history:
  - version: v0.1
    date: "2026-06-15"
    author: QA
    summary: 首版 · 单测 207 + 真实 WebGL e2e(图集溢出→resync)PASS
---

# 终端 CJK 渲染乱码修复 - Test Report

> 🟢 teamwork test-stage 产物。Bug 流程:规格依据 = `bugfix/BUG-TERMPRO-B260615152207-001.md`(§现象/§根因/§修复方案 已 review APPROVE)。

---

## §1 测试范围

| 层 | 范围 | 文件 / 入口 | 责任人 |
|---|---|---|---|
| integration(进程内单测套件) | 全量回归(含本修复的接线契约单测) | `vitest run`(24 文件 · 含 `src/renderer/terminal/__tests__/webglAtlasResync.test.ts` 7 例) | QA |
| e2e(真实 Electron + 真实 WebGL) | **复现根因触发路径**:真实 WebglAddon + 海量 CJK → 真实图集分页溢出 → 验证修复响应 | `docs/features/TERMPRO-B260615152207/e2e/atlas-resync.e2e.cjs` | QA |
| 像素级「肉眼无乱码」 | 真实窗口视觉确认 | 🔴 人工(无 pixel-diff 基建 · 见 §4) | 用户 |

---

## §2 integration 结果(全量回归)

### 2.1 执行命令
```bash
npm test    # vitest run
```

### 2.2 stdout 摘录
```text
✓ src/renderer/terminal/__tests__/webglAtlasResync.test.ts (7 tests)
Test Files  24 passed (24)
     Tests  207 passed (207)
```
新增 7 例覆盖:删页(合并)→ refresh(0,rows-1)、换图集 → refresh、一帧多次去抖为一次、跨窗口再次触发、rows=0 端点不为负、**不订阅 onAdd(锁定设计意图)**、stop() 解除订阅。

### 2.3 exit-code
`integration_test_exit_code = 0`

---

## §3 e2e 结果(真实 WebGL · 复现 bug 触发路径)

### 3.1 前置环境
- 真实 Electron 42.4.0 渲染进程 · WebGL 2.0 经 ANGLE(Apple Metal · M5 Max)· 非 jsdom mock
- 真实 `@xterm/addon-webgl@0.19.0` WebglAddon + `@xterm/addon-unicode11`(CJK 计宽 · 同生产)
- 被测修复 `src/renderer/terminal/webglAtlasResync.ts` 经 esbuild **现场转译**注入(跑生产代码本身 · 非复刻)

### 3.2 执行命令
```bash
node_modules/.bin/electron docs/features/TERMPRO-B260615152207/e2e/atlas-resync.e2e.cjs
```

### 3.3 stdout 摘录
```text
E2E_RESULT {"webglActive":true,"removeFired":4,"helperRefreshCount":1,"written":13440,"cols":80,"rows":24}
E2E_OK atlas-overflow→resync (removeFired=4 refresh=1 glyphs=13440)
```
(多次运行稳定复现 · 另一轮:glyphs=15360 · removeFired=4 · refresh=1)

### 3.4 断言含义(双重验证)
1. **根因触发为真**:写满 13440+ 个「不同」CJK 字形后,真实字形图集超过分页上限,真实触发 `onRemoveTextureAtlasCanvas` **4 次**(页合并/删页 = `texturePage` 索引重排 · 正是错位/串字乱码的根因机制)。这在真实 WebGL 下实证了 diagnose 的根因假设。
2. **修复响应为真**:被测 `wireWebglAtlasResync` 在该事件后触发了 `term.refresh` 整屏重绘(helperRefreshCount>0 · 微任务去抖把同帧 4 次合并合成 1 次刷新 → 单元格 `texturePage` 与重排后图集对齐)。

### 3.5 exit-code
`e2e_test_exit_code = 0`(E2E_OK)

---

## §4 残留 / 人工确认项(非阻断)

- e2e 证明了「真实图集在 CJK 下确会溢出 + 修复确会响应重绘」,但**不做像素比对**(无 playwright/pixel-diff 基建)。最终「肉眼看不到乱码」由用户在真实窗口确认(用户正是在真实使用中报告本 bug · 装新版后跑中文密集输出即可验)。
- 修复仅订阅低频 remove/change 事件 → 正常 ASCII / 低字形量场景零额外刷新,无可见回归(三视角 review 一致 · 见 REVIEW.md)。

---

## §5 既有套件回归
全量 `vitest run` 24 文件 207 例全过 · 无回归。无头冒烟(dev 阶段)`SMOKE_OK` · host exited 0。

---

## §6 结论
- integration exit 0 · e2e exit 0 · 原 bug 触发路径在真实 WebGL 下复现且修复响应验证通过。
- 关联回归测试:`bugfix/BUG-TERMPRO-B260615152207-001.md` §回归测试 + `webglAtlasResync.test.ts` + 本 e2e。
