---
reviewers: [architect, qa, external]
verdict: APPROVE
stage: review
target_commit: 0925098
review_base: a3fbc69
external_model: codex-cli 0.139.0
---

# Review 汇总 — TERMPRO-B260615152207(WebGL 图集分页变更整屏重绘消除 CJK 乱码)

三视角独立评审,各自落盘:`REVIEW-arch.md`(architect)/ `REVIEW-qa.md`(qa)/ `external-cross-review/review-codex.md`(异质模型 codex)。

## verdict:✅ APPROVE(三视角一致 · 无 P1 阻断)

| 视角 | verdict | 关键结论 |
|------|---------|----------|
| Architect | APPROVE | 深核机制:`term.refresh(0,rows-1)` → `_clearModel(true)`+`_updateModel` 确实按重排后的图集重建每个单元格 `a_texpage`(addon 源 GlyphRenderer/WebglRenderer 实证)。**关键发现**:页合并触发 `onRemove` 但**不调度新帧**(`_requestRedrawViewport` 未调用 · `_requestClearModel` 也从不复位)→ 坏帧滞留到下个无关触发才修正。本 fix 正好补上「合并后调度一帧」。不冗余、不过度设计、分层正确。 |
| QA | APPROVE | 再入风险已被 xterm `RenderDebouncer`(rAF)化解,helper 微任务去抖不会同步再入;假桩忠实建模 `IEvent`;仅订阅低频 remove/change,无可见回归。 |
| External(codex) | APPROVE | `findings: []`,无阻断;自跑 `typecheck` + `npm test`(206)通过;narrowly scoped。 |

## Findings 裁决(逐条 · 举证对称)

> 三视角均无 P1。以下为 advisory,逐条裁决处置:

1. **P2-1 · 未有测试锁定「不订阅 onAdd」设计意图**(architect + qa 共同提出)
   - 裁决:**ADOPT**。增页不重排既有 `texturePage` 索引(addon `TextureAtlas` 仅 `_mergePages`/`_deletePage` 重排 · 均 fire onRemove),订阅 onAdd 只会在正常填充期刷新风暴;这是 regression-sensitive 决策,值得守。
   - 处置:已补一例 `wire 后 addCount === 0` 断言(commit 0925098)· vitest 207 全过。

2. **P2-2 · dispose 幂等未测**(qa · 标低风险)
   - 裁决:**REJECT(不增测)**。实证:真实 `WebglAddon` 用 vscode 风格 `Emitter`,重复 dispose 是 no-op;本 helper 的 disposable 走 `Set.delete`,二次调用同样幂等(无副作用 / 不抛)。增测价值低于噪音。

3. **advisory · `scheduled=false` 置于 refresh 之前**(architect)
   - 裁决:**REJECT(保持现状)**。architect 自评「marginally more conservative · 非必需」:refresh 经 rAF 异步派发(QA 实证),且重绘仅命中已缓存字形、不新增页、不再 fire 事件 → 循环可证终止。改为 refresh 后置反而让「合并落在本次 refresh 期间」少调度一帧。保持现状。

4. **advisory · `wireWebglAtlasResync` 返回值在组件未捕获**(architect)
   - 裁决:**REJECT(无需改)**。实证:addon 的图集 Emitter 经 `_register` 注册,`webgl.dispose()` 清空 `_listeners`;activate/deactivate/context-loss/disposeTerminal 全生命周期覆盖,uncaptured stop() 无实际后果。

## 残留风险(非阻断 · 已转 test 阶段必做项)

自动化用假 WebGL 事件源,**未**在真实 Electron 窗口验证 CJK 渲染。三视角一致认为:单测粒度只能到「接线契约」(jsdom 无 WebGL),真复发验证须在 test/pm 阶段做。BUG 报告 §回归测试 已登记;test 阶段**必做**:
- 真窗口 CJK soak(字形撑过 ~16 图集页)观察是否复现错位/串字;
- DOM 渲染器 A/B(关 WebGL)对照 + 码点日志(`term.write` 处),活体钉死根因在 WebGL 图集而非数据通路;
- ASCII 正常输出无闪烁 spot check。

## 修复建议
无需返工(verdict APPROVE)。P2-1 已落地;test 阶段执行上述运行期验证后回填 BUG 报告 §修复记录的「QA 验证」。
