---
reviewer: architect
stage: review
verdict: APPROVE
---
# Architect Review — TERMPRO-B260615152207

## 结论 (verdict + 1-2 句)
**APPROVE.** 机制核验通过:这是 addon 自身在「页合并后缺少一帧重渲染调度」的真实缺口,fix 恰好补上这一缺口且最小化。我读穿了 addon 全部相关源码(`TextureAtlas` / `WebglRenderer` / `GlyphRenderer` / `WebglAddon`)与 xterm 核心 `refresh → renderRows` 路径,确认 `term.refresh(0,rows-1)` 真能触发 `a_texpage` 全量重建(高置信)。无 P1。仅有少量 advisory。

## Findings (级别 · 论点 · 证据 · 建议)

### advisory-1 · `_requestClearModel` 合并后永久为 true,fix 的「补一帧」才是真正起效点(非全量重绘开销担忧)
- 论点:addon 内 `_requestClearModel` 设 `true` 后**从不复位**,因此一旦发生过页合并,此后**每一帧** `renderRows` 都会走 `_clearModel(true)+_updateModel(0,rows-1)` 全量重建。也就是说:真正缺的不是"重建逻辑",而是"合并那一刻**调度下一帧**"的触发——core/addon 在合并路径上**不**发 `_requestRedraw`。
- 证据:
  - `node_modules/@xterm/addon-webgl/src/TextureAtlas.ts:133-136`(`beginFrame(){return this._requestClearModel}`)、`:195`(merge 处 `this._requestClearModel = true`)、`:798`(overflow 页同样置 true);全文件**无**任何处把它复位为 false(已用编译产物 `lib/addon-webgl.mjs` grep 复核:仅 1 处 `=!1` 为字段初始化,2 处 `=!0`)。
  - `WebglRenderer.ts:343-352`:`if (beginFrame()) { _clearModel(true); _updateModel(0, rows-1); }` —— 全量重建确实存在且 merge 后恒触发。
  - `WebglRenderer.ts` 全文 grep `_requestRedraw`:合并/atlas add/remove 路径**均不**调用 `_requestRedrawViewport()`(只有 resize/focus/blur/selection/cursor/contextRestore 会)。即 merge 后**无人调度新帧**。
- 影响:这恰恰解释了 bug 现象——合并在「正在执行的帧 N」内发生(`_drawToCache→_createNewPage`),帧 N 里 merge **之前**已处理的单元格仍持旧 texpage、已上传 buffer 里历史单元格也是旧 texpage,帧 N 收尾即画出错位;此后**没有**自动帧 N+1 去消费那个已恒为 true 的 flag,坏画面**滞留**至下一次无关重绘(光标闪烁/新输出/resize)。fix 的 `term.refresh()` 正是补上这缺失的"帧 N+1 调度"。**结论:fix 不冗余、定位准确。** 无需改动,仅记录此机理。

### advisory-2 · 全量重绘成本可接受,但合并后会"每帧全量"——非本 fix 引入
- 论点:由于 advisory-1 的 flag 永真,合并后每帧全量 `_updateModel`(rows×cols 次 `updateCell`,命中 glyph cache,无重新栅格化)。这是 addon 既有行为,不是本 fix 带来的额外开销;fix 仅额外多调度**一次** RAF 重绘。
- 证据:`GlyphRenderer.ts:216-287` `updateCell→_updateCell` 走 `_atlas.getRasterizedGlyph`(`TextureAtlas.ts:257-272` 命中 `_cacheMap`,不再 `_drawToCache`)。
- 建议:无。仅说明 fix 的增量开销 = 单次去抖 RAF,可忽略。

### advisory-3 · 注释口径已对齐 macOS 上限
- `webglAtlasResync.ts:2` 写 `~min(32, MAX_TEXTURE_IMAGE_UNITS)≈16`,与 `GlyphRenderer.ts:121-123`(`Math.min(32, MAX_TEXTURE_IMAGE_UNITS)`)一致。准确,无需改。

## 简洁性评估 (是否过度设计 / 能否更简单 / 职责归层)
- **不过度设计。** 21 行实现 + 一个 4 行 wiring,无新状态机、无额外生命周期对象。`scheduled` 单布尔 + `queueMicrotask` 去抖是合理且最小的形态。
- **抽象正当。** 抽成独立纯函数 + 两个结构化 interface(`AtlasEventSource`/`Refreshable`)的唯一动机是**可单测**(6 个 vitest 全绿,免拉起 WebGL2/jsdom),这是值得的——否则该逻辑要么内联进 React effect 不可测,要么得 mock 整个 addon。职责归层正确:它活在 renderer 终端层,只消费 addon 的公开 `IEvent` 与 Terminal 公开 `refresh/rows`(`typings/xterm.d.ts:1283` `refresh(start,end)`、`:829` `readonly rows`),**未**穿透到 host/protocol 层,符合本项目 UI/Host 红线。
- **能否更简单?** 理论上"更简单"是去游说上游 xterm 在 merge 路径 `_requestRedrawViewport()`(根因在 addon)。但那不可控、周期长;在消费侧补一帧是务实且隔离的最小修复。维持现状。

## 机制正确性核验 (Q1–Q6)

**Q1 — refresh 是否真重建 texpage?置信度 H(高)。**
路径全链路核验:`term.refresh(0,rows-1)` → `_core.refresh` → `RenderService.refreshRows` → `_renderDebouncer.refresh(...)`(RAF 去抖,`lib/xterm.mjs`:`addRefreshCallback`/`requestAnimationFrame(()=>this._innerRefresh())`)→ `_renderRows` → `renderer.renderRows(e,i)`。在 `WebglRenderer.renderRows`(`:346-352`),因合并后 `beginFrame()` 恒 true,执行 `_clearModel(true)+_updateModel(0, rows-1)`;`_updateModel` 对每个非跳过单元格调 `_glyphRenderer.updateCell(...)`(`:528`),进而 `GlyphRenderer._updateCell` 写入 `array[$i+4]=$glyph.texturePage`、texcoord、texsize(`:255-276`)。而合并已把每个 glyph 的 `texturePage` 重排为新页号(`TextureAtlas._mergePages:215` `g.texturePage = mergedPageIndex`;`_deletePage:240` `g.texturePage--`),`getRasterizedGlyph` 取回的就是**重排后的对象**(cache 里存的是同一引用,merge 原地改字段)。故 refresh **确实重建 `a_texpage`/texcoord**,非"从缓存原样回放旧 texpage"。

> 重要细节:`_updateModel:506-512` 有"无变化则 continue"的跳过优化(仅比对 code/bg/fg/ext,**不**比对 texpage)。单看会担心"码点没变 → 跳过 → 旧 texpage 残留"。但 `renderRows:347` 在全量分支**先 `_clearModel(true)`**(清空 `_model.cells` 与 glyph 顶点),使本帧每个单元格都 `!== cached` 必然进入 `updateCell`,跳过优化在合并帧被 `_clearModel` 旁路。故无"跳过导致 texpage 不刷新"的漏洞。

**Q2 — 重入/死循环?provably terminates。**
`scheduled=false` 在 `refresh()` **之前**复位(`webglAtlasResync.ts:40-41`)确实使 refresh 期间的新事件能再排一个微任务。但终止性成立:refresh 触发的是对**已缓存** glyph 的重绘(`getRasterizedGlyph` 命中 cache,不 `_drawToCache`),**不新增页**,`_createNewPage` 不被调用 → 不发 onAdd/onRemove、不再置 flag → 无新事件 → 无新微任务。即便偶发一次额外微任务也只是多一次幂等 refresh,**有界收敛**。把 `scheduled=false` 移到 refresh 之后会更保守(把"refresh 内同步触发的事件"也并入本次,彻底杜绝额外一跳),但当前写法已可证终止,**非必须**。advisory 级,不阻塞。

**Q3 — 只挂 onRemove+onChange、不挂 onAdd,正确。**
`_deletePage`(`:235-244`,删页 `texturePage--`)与 `_mergePages`(`:207-233`,合并 `texturePage=mergedPageIndex`)是**仅有**两处重排既有 glyph 索引的路径,二者都只伴随 `_onRemoveTextureAtlasCanvas.fire`(`:224`)。`onChange` 覆盖整张 atlas 被替换(`WebglRenderer._refreshCharAtlas:283-289`,DPR/resize/主题变更换 atlas 实例)。而纯 `_onAddTextureAtlasCanvas.fire`(`:203` 新建空页 / `:196` 合并后追加新页 / `:799` overflow 页)**不改动任何既有 glyph 的 texturePage**——新页追加在末尾、既有索引不动。故订阅 onAdd 对修复无贡献,反而会在正常填充期(每新建一页就 fire)制造刷新风暴。**不挂 onAdd 是正确取舍。**(注:合并那次会**同时** fire remove×4 与 add×1,remove 已覆盖,去抖合并为一次 refresh。)

**Q4 — 生命周期/泄漏:无泄漏。**
`WebglAddon` 的三个 atlas Emitter 均 `this._register(new Emitter)`(`WebglAddon.ts:22-27`),且 `_renderer` 亦 `_register`,renderer 内 atlas 事件经 `Event.forward` 转发并以 `_charAtlasDisposable`(MutableDisposable)持有(`WebglRenderer.ts:285-288`)。`webgl.dispose()`(Disposable)级联 dispose 所有 `_register` 项 → Emitter `dispose()` 将 `_listeners=void 0`(编译产物已核),订阅随之释放。resync 的两个 `IEvent` 监听挂在这些 Emitter 上,故 `webgl.dispose()` 时自动断开,**即使组件不调用返回的 stop() 也不泄漏**——与代码注释一致。TerminalView 在 `!active`(`:45-46`)与 `onContextLoss`(`:52-55`)两条路径都 `webgl.dispose()` 后置 `inst.webgl=null`,下次激活 `new WebglAddon()` 重新 wire,**每个 webgl 实例一组监听、随其 dispose 释放**,activate/deactivate/context-loss/disposeTerminal 全覆盖,无跨切换累积。唯一遗漏点:wiring 的 stop() 未捕获,故无法**单独**先于 webgl 解绑——但因生命周期与 webgl 完全绑定,这没有实际后果。advisory 级。

**Q5 — 见上「简洁性评估」。** 非冗余(core/addon 不在 merge 发 redraw,见 advisory-1)、抽象因可测性而正当、归层正确。

**Q6 — 生产中是否可能失效?核验为否。**
- "refresh 被并进坏帧已绘的同一帧"——不会。merge 发生在帧 N 的 `_updateModel` 同步执行中,此时 `onRemove` 同步 fire → `scheduleResync` 同步排**微任务**;微任务在帧 N 的 RAF 回调结束后、下一 RAF 之前执行,调 `term.refresh` → 入 `_renderDebouncer` → **下一个 RAF**(帧 N+1)重渲染。即坏帧 N 仍会闪一下,但帧 N+1 即刻纠正,且因 flag 永真帧 N+1 是全量重建。对用户=至多一帧瞬态,功能性修复成立。
- "merge 不发 onRemove"——不成立:`_mergePages` 对每个被并页都 `_onRemoveTextureAtlasCanvas.fire(p.canvas)`(`:224`)。
- 唯一可设想的残余:若 merge 后**直到下一次 refresh 之前再无任何渲染驱动**,坏帧 N 会滞留到该微任务 refresh——但本 fix 正是那个 refresh 的来源,所以反而是它消除了滞留。**无失效路径。**

## 验证
- `npx vitest run .../webglAtlasResync.test.ts` → 6/6 通过(本地复跑确认)。
- 公开 API 契约核对:`@xterm/xterm/typings/xterm.d.ts:1283 refresh(start,end)`、`:829 readonly rows`——helper 的 `Refreshable` interface 与之吻合。
