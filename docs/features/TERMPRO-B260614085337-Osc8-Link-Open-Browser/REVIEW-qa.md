# REVIEW-qa — BUG-TERMPRO-B260614085337-001 (OSC 8 链接直开系统浏览器)

**Reviewer**: QA (skeptical posture)
**Dev commit**: `3a07bb7`
**Scope**: `terminalLinks.ts` (`createOscLinkHandler`), `terminalRegistry.ts` (Terminal 构造接线), `terminalWebLinks.test.ts` (新增 2 条 OSC8 测试), BUG 报告。

## Summary

修复正确且最小:给 `new Terminal({...})` 设 `linkHandler: createOscLinkHandler()`,使 xterm 核心 `OscLinkProvider` 的 OSC 8 激活走 `linkHandler.activate` → `window.termpro.openExternal`,永不触达 `defaultActivate`(`confirm` + `window.open` 弹框)。根因诊断准确(已对 `OscLinkProvider.ts:89` / `:114` 实证),改动语义正确,主进程 `^https?://` 守卫与 `allowNonHttpProtocols=false`(默认)构成双重协议防护。门禁三绿我已本地复跑确认:tsc 0 错、vitest 19 文件/179 测试全过、smoke harness 存在且 BUG 报告 `SMOKE_OK` 声明合理。

唯一实质性发现是 P2 接线测试缺口:`terminalRegistry.ts:56` 的接线本身无测试覆盖,新增测试只验证工厂隔离行为。考虑到这是极小修复,该缺口可接受,建议补一条轻量接线断言以防回归,但不阻塞合并。

## Findings

### F1 — 接线层无回归覆盖(工厂被测,Terminal 构造未被测)
- **Severity**: P2
- **Claim**: 2 条新测试直接调 `createOscLinkHandler()` 验证工厂,但**没有**断言 `Terminal` 实际以 `linkHandler: createOscLinkHandler()` 构造。若未来重构误删 `terminalRegistry.ts:56`,bug 会回归而 3 条测试仍全绿——真正的回归点(接线)裸奔。
- **Evidence**:
  - `src/renderer/terminal/__tests__/terminalWebLinks.test.ts:105-130` — 测试仅 import 工厂并调 `handler.activate(...)`,不触及 registry。
  - `src/renderer/terminal/terminalRegistry.ts:56` — 接线点 `linkHandler: createOscLinkHandler()`,无任何 test 文件 import `getOrCreateTerminal`/`terminalRegistry`(grep 确认:`__tests__/` 下三个文件均不引用)。
- **Skeptic check**: 我考虑过这是否过苛。接线点是单行字面量,误删风险低;且 `terminalRegistry` 依赖真实 xterm + addon,单测成本高(jsdom 下 `Terminal` 构造/canvas 受限,SettingsEntry 测试已见 `getContext` 警告)。但「测了工厂≠测了 bug 不复发」是真实缺口:回归测试的目标应是「锁住接线」而非「锁住工厂」。
- **Verdict**: **CONFIRMED**(轻量,非阻塞)
- **Suggested fix**: 轻量断言即可——不必构造真 `Terminal`,可在测试里断言 registry 模块在构造选项里包含 `linkHandler`(例如对 `@xterm/xterm` 的 `Terminal` 做 mock,捕获构造参数,断言 `opts.linkHandler` 为函数对象且其 `activate` 路由到 `openExternal`)。或在 BUG 报告/README 标注此接线为「无单测、靠 smoke + 人工」的已知约束。

### F2 — 新测试相对 pre-fix 代码是否「有意义的回归」而非「重言式」
- **Severity**: P3(澄清,非缺陷)
- **Claim**: 复核 task 关注点 1——测试是否在 pre-fix 代码上失败。
- **Evidence**: `createOscLinkHandler` 是本 commit 新增的导出(`terminalLinks.ts:163`)。pre-fix 代码无此导出,故测试在 pre-fix 上是 **import/调用即报错**,而非「断言失败暴露弹框」。
- **Skeptic check**: 严格说这条不是经典意义上「红→绿」回归测试(它锁的是新工厂的行为契约:preventDefault + openExternal + 不碰 confirm/open),真正能在 pre-fix 红、post-fix 绿的测试应锁**接线**(见 F1)。但工厂行为契约本身有价值且非重言式——`activate` 确实可能被误写成走 `window.open`,该断言能抓住。
- **Verdict**: **CONFIRMED as written, but classified correctly**:这是「行为契约测试」,不是「接线回归测试」。两者的缺口由 F1 承接。非阻塞。

### F3 — 非 http(s) OSC8 scheme 未测
- **Severity**: P3(可接受缺口)
- **Claim**: 没有针对 `file:`/`javascript:`/无效 URL 等非 http(s) OSC8 的测试。
- **Evidence**: `OscLinkProvider.ts:72-82` — `allowNonHttpProtocols` 为 falsy(本修复未设,默认 false)时,provider 在**到达 handler 之前**就 `ignoreLink = true` 过滤掉非 http(s) 与无效 URL。故非 http(s) scheme **根本不会**调用本 handler;即使调用,主进程 `main.ts:102` 的 `^https?://` 守卫也会拦下。
- **Skeptic check**: 因此「非 http OSC8 不放行」这条在本修复链路里由 xterm 上游 + 主进程双重保证,与本 handler 无关;为它在 handler 单测里加用例意义不大(测的是别人的代码)。BUG 报告 §回归测试曾写「非 http 协议不放行」,但实际新增测试**未含**此断言——这是文档与测试的轻微不一致,但因上游已保证,不构成功能缺口。
- **Verdict**: **REJECTED as a defect**(缺口可接受);**附注**:BUG 报告 line 9 / 149 提及「非 http 不放行」但测试未覆盖,属文档措辞略宽,无需阻塞。

### F4 — 既有路径回归风险(SystemWebLinkProvider / FsLinkProvider)
- **Severity**: P3(确认无回归)
- **Claim**: 复核 task 关注点 3——纯文本链接与文件路径链接是否被影响。
- **Evidence**:
  - `terminalLinks.ts` diff 仅**新增** `createOscLinkHandler` 与一处 `ILinkHandler` type import;`SystemWebLinkProvider`(`:172`)、`FsLinkProvider`(`:209`)代码逐字未改。
  - `terminalRegistry.ts` 仅在构造选项**新增**一行 `linkHandler`,`registerLinkProvider(SystemWebLinkProvider/FsLinkProvider)`(`:88`/`:96`)接线未动。
  - `linkHandler` 仅被 xterm `OscLinkProvider` 消费(provider 的 `activate` 自带回调,不读 `rawOptions.linkHandler`);故对自定义 provider 零影响。
  - 既有 `SystemWebLinkProvider` 测试(`terminalWebLinks.test.ts:65-94`)本地复跑通过。
- **Skeptic check**: 是否可能 `linkHandler` 改变了 hover/decoration 全局行为?查 `OscLinkProvider.ts:90-91` 的 `hover`/`leave` 仅在 OSC 链接上经由 `linkHandler?.hover?.`,本 handler 未实现 hover/leave(可选),退化为 no-op,与 pre-fix `defaultActivate` 路径无 hover 行为一致,无回归。
- **Verdict**: **CONFIRMED no regression**

### F5 — 门禁三绿声明核验
- **Severity**: P3(核验通过)
- **Claim**: 复核 task 关注点 4——tsc/vitest/smoke 声明是否属实。
- **Evidence(本地复跑)**:
  - `npx tsc --noEmit` → exit 0(0 错)。`linkHandler?: ILinkHandler | null` 与 `ILinkHandler` 均在 `@xterm/xterm/typings/xterm.d.ts:163/1353` 公开,类型合法。
  - `npx vitest run` → **19 文件 / 179 测试全过**(与报告一致)。
  - smoke:`SMOKE_OK` 输出点存在于 `main.ts:204`,harness 真实;BUG 报告 `SMOKE_OK` 声明合理(本审查未跑 electron-forge,但 harness 存在且无相关改动触及主进程握手)。
- **Skeptic check**: smoke 是唯一我未亲自复跑的门禁(electron 启动成本高且本修复不触主进程握手路径);声明可信但属「未由 QA 独立复现」。
- **Verdict**: **CONFIRMED**(tsc/vitest 亲验;smoke 信任声明 + harness 存在)

## 结论

修复根因正确、范围最小、无既有路径回归,门禁可信(tsc/vitest 亲验通过)。唯一确认的 P2 是接线层测试缺口(F1),鉴于修复体量极小、接线为单行字面量、registry 单测成本高,该缺口**可接受**,建议补轻量接线断言但不阻塞。无 P1。

**Confirmed P1: 0 · Confirmed P2: 1 (F1, non-blocking) · Confirmed P3: 4**

VERDICT: APPROVE
