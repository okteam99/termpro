---
reviewer: qa
stage: review
verdict: APPROVE
---
# QA Review — TERMPRO-B260615152207

## 结论 (verdict + 1-2 句)
**APPROVE**(advisory 若干 · 无 P1 阻断)。单测对接线契约（订阅 / 去抖 / dispose / 端点钳制）覆盖正确且与真实 xterm Emitter / refresh 语义一致；helper 实现简洁、无重入风险、对正常使用无回归面。唯一实质缺口是「真实 WebGL 图集溢出 + CJK 错位」**只能在真实窗口活体验证**（jsdom 无法复现），这一点 BUG 报告 §回归测试已显式声明留待 test/pm 阶段——属流程内的 known gap，不构成本阶段阻断；但 test/pm 阶段必须真正补做 A/B 活体验证，否则「bug 已消除」无运行期证据。

## 覆盖评估 (单测覆盖了什么 / 没覆盖什么 · 真实复发场景的运行期验证缺口)

**单测覆盖（6 例 · 全绿 · 实跑确认 4ms pass）**：
- 接线契约层面，覆盖到位：
  - remove → 微任务后 `refresh(0, rows-1)`，且微任务前不同步触发（去抖语义正确，T35-46）。
  - change 同样触发（T48-58）。
  - 一帧内多事件去抖为一次 refresh（防风暴 / 防重入，T60-71）。
  - 去抖窗口结束后新一轮再触发（非一次性闩锁，T73-84）。
  - rows=0 端点钳制 `refresh(0, 0)`（`Math.max(0, rows-1)`，T86-95）。
  - stop() 解除订阅且 removeCount/changeCount 归零、后续事件不再 refresh（无泄漏，T97-113）。

**没覆盖（合理 / 不合理分别标注）**：
- **真实 WebGL 图集页合并 / 真实 CJK 错位渲染** —— 未覆盖。**合理**：jsdom 无 WebGL 上下文，无法烘焙真实字形图集、无法触发 `_mergePages/_deletePage`，单测桩注入是唯一可行的单元粒度。但这意味着单测**只证明了「接线正确」，没有证明「接线能消除 bug」**——因为根因在 addon 内部（`renderRows` 的 `beginFrame()` 全量重建路径，WebglRenderer.ts:345-348），而单测完全 stub 掉了 addon。
- **`onAddTextureAtlasCanvas` 故意不订阅** —— 未锁入测试。设计决策（增页不重排既有索引）正确，但无测试钉死它（见 Finding P2-1）。
- **re-entrancy / refresh 触发新一轮 atlas 事件** —— 未直接覆盖；但经源码核实风险为零（见 Finding advisory-1 的实证）。

**真实复发场景的运行期验证缺口（核心）**：
BUG 报告 §根因分析「运行期需复核确认的点」与 §回归测试均已点名三项活体验证（DOM A/B、码点日志、atlas 事件相关性），并明确「留待 test/pm 阶段在真实窗口确认」。**该缺口已被报告捕获，但尚未执行**。dev 阶段仅以冒烟（SMOKE_OK，无头、无真实 GPU 渲染）确认「接线不破坏启动」——这**不能**证明乱码消除。

## Findings (级别 · 论点 · 证据 · 建议测试)

**[advisory-1] 重入风险经实证为零（确认 fix 安全 · 非缺陷）**
- 论点：报告与注释反复强调「微任务去抖防 refresh 自身触发图集变更造成同步重入」，需确认这个担心是否真实、去抖是否真的拦得住。
- 证据：`term.refresh()` → `CoreBrowserTerminal.refresh`(CoreBrowserTerminal.ts:852) → `RenderService.refreshRows` → `RenderDebouncer.refresh`(RenderDebouncer.ts:49-53)，**经 `requestAnimationFrame` 异步派发**，并非同步渲染。真正会 fire `onRemoveTextureAtlasCanvas` 的 `renderRows`/`_mergePages`（WebglRenderer.ts:323-348, TextureAtlas.ts:224）发生在 rAF 内，**不在** helper 的微任务调用栈里。故 `term.refresh` 不可能同步重入 `scheduleResync`。即便 rAF 内的渲染确实再次触发 atlas 事件，那也是新的一轮微任务、`scheduled=false` 已复位，正常去抖即可，不会失控递归。
- 建议测试：无需新增（实现已安全）；可在 KNOWLEDGE.md 沉淀「refresh 经 rAF 异步、故微任务去抖足以隔离重入」这一论据，避免后人误以为防的是同步递归。

**[P2-1] `onAdd` 故意不订阅的设计决策未被测试锁定**
- 论点：注释与报告都强调「增页不订阅，否则正常填充期刷新风暴」。这是与原方案 A（曾列 add 为兜底）的**有意偏离**，是回归敏感点——若后人「补全」订阅 add，会重新引入刷新风暴。当前无测试守护。
- 证据：webglAtlasResync.ts:11-12, 44-47 仅订阅 remove/change；`AtlasEventSource` 接口（L15-18）甚至不暴露 `onAddTextureAtlasCanvas`，类型层面已部分自我保护。但行为层面无断言。
- 建议测试：给 fake 增加 `emitAdd` + 一个 `onAddTextureAtlasCanvas` 存根，断言 `wireWebglAtlasResync` **不订阅** add（addListeners.size === 0）/ emitAdd 后不触发 refresh。低成本、把设计意图固化为测试。

**[P2-2] dispose 幂等性未覆盖**
- 论点：stop() 返回函数若被调用两次（如 effect cleanup 竞态 + 显式调用），当前对每个 disposable 调用 `dispose()`；vscode Emitter 的 disposable 二次 dispose 安全，但 helper 未测幂等。
- 证据：webglAtlasResync.ts:48-50 无「已停止」守卫，直接遍历 disposables。真实 Emitter disposable 二次 dispose 是 no-op（event.ts dispose 内部判空），故实际安全，但 fake 的 `Set.delete` 二次调用也安全——属低风险。
- 建议测试（可选）：stop(); stop(); 再 emit，断言不抛、不 refresh。advisory 级，不阻断。

**[advisory-2] 测试桩 fidelity 充分 · 无假信心**
- 论点：fake 用 `Set<listener>` + `dispose:()=>set.delete(l)` 建模，需确认是否忠实于真实 xterm IEvent。
- 证据：addon 用 vscode 风格 `Emitter`（TextureAtlas.ts:18 `import { Emitter } from 'vs/base/common/event'`），`.event` 是「订阅函数返回 IDisposable，dispose 移除该监听」。fake 的 add/dispose/fire 三元语义与之**契约一致**。helper 仅依赖这三点，未依赖 Emitter 的 deliveryQueue / 顺序 / 重复订阅去重等高级语义，故桩不会产生假信心。唯一不建模的是「fire 期间 dispose 当前监听」的边界——但 helper 的监听只调 `scheduleResync`（同步置 flag + queueMicrotask），不在 fire 栈内 dispose，故该边界与本 fix 无关。结论：fidelity 足够，无误导。

**[advisory-3] 正常使用无可见回归（确认 · 非缺陷）**
- 论点：新增 refresh 是否在非合并场景造成闪烁 / 性能退化。
- 证据：监听仅挂 remove(`_deletePage`/`_mergePages`)/change(图集整体替换) 两个**低频**事件，正常逐字填充走 `onAdd`（未订阅）。即便误触发，refresh 经 rAF 去抖 + addon 自身 `beginFrame()` 在 merge 后本就要全量重建（WebglRenderer.ts:346-348），helper 的 refresh 只是确保这次全量重建被「拉起来跑一帧」，与引擎既有行为同向，不会引入额外重绘语义。无可见回归面。

## test/pm 阶段必做的运行期验证建议
单测绿 + tsc + 冒烟 SMOKE_OK 是**接线层面的充分证据**，但对「CJK 乱码是否真消除」是**advisory 级别的不充分**——非本阶段阻断（报告已显式延后），但 test/pm **必须**补做下列活体验证，否则不得判「bug 已修复」：

1. **真实窗口 CJK-heavy soak（必做 · 直接复现验证）**：在真实 TermPro 窗口跑大量不同 CJK 字形长输出（teamwork/Claude Code 流程日志、`cat` 多样中文文本、中文 TUI），持续到字形数撑过 maxAtlasPages(~16) 触发页合并，目视确认无错位/串字/叠字。这是唯一能证伪 bug 的测试。
2. **DOM 渲染器 A/B（必做 · 钉死根因层）**：同一份正确码点下，强制关闭/降级 WebGL（不 loadAddon webgl）跑同样输出——若 DOM 下不乱、WebGL 下乱（且打了本 fix 后 WebGL 也不乱），则根因钉死在 WebGL 图集，fix 命中正确层。
3. **atlas 事件相关性 + 码点日志（建议）**：在 `onRemoveTextureAtlasCanvas` 与 `terminalRegistry.ts:138 term.write` 处加临时日志，确认（a）抵达 write 的码点正确（活体排除数据通路），（b）乱码出现时刻与 remove 事件相关，（c）打 fix 后 remove 事件仍触发但乱码不再现 → 闭环证明。
4. **回归面抽查（建议）**：纯 ASCII / 英文长输出下确认无新增闪烁或卡顿（验证 advisory-3 的「无可见回归」结论在真机成立）。
5. **建议把验证结论回填** BUG 报告 §修复记录的「QA 验证：⏳ 待 test 阶段」与 §回归测试的活体验证项，使机读 frontmatter（`shipped`/`current_stage`）与人读结论一致后再 ship。
