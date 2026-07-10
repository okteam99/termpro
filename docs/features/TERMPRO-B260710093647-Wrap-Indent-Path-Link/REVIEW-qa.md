---
reviewer: qa
verdict: NEEDS_REVISION
---

# QA Review

对象：commit `1b8c799`（FsLinkProvider 跨缩进候选拼接，修复 BUG-TERMPRO-B260710093647-001）。
已跑 `npx vitest run src/renderer/terminal/__tests__/` — 11 files / 93 tests 全绿（含新 3 用例）。已读 `terminalLinks.ts` 全文、`terminalLinkParse.ts`、bug 报告 md、commit diff。

## 覆盖良好的点

- **断言强度足够**：新 3 用例全部同时断言 `text`（完整字符串相等）与 `range`（`start`/`end` 的 x/y），不是只检查存在链接。3-row 链式用例（`terminalLinkWrap.test.ts:129-152`）连 x 坐标都精确断言到列号，能捕获拼接后 index→col 换算错误。
- **longest-first 被真实验证**：用例 4（`terminalLinkWrap.test.ts:92-113`）故意让 `stat` 同时命中真实前缀目录 `dir` 和拼接后完整路径 `full`，断言最终链接文本是 `full` 而非 `dir`——这确实验证了"最长优先压过真实前缀目录"，不是摆设用例。
- **落空回退路径有覆盖**：用例 5 验证"缝隙是空白/gutter 形态上满足 adjacent，但拼接后 stat 落空 → 回退到前缀候选单独成链"，这条链路（`resolveJoinedAcrossIndent` 返回 null → `resolveCandidateSpanning` 兜底）被实际执行到，不是纸面覆盖。
- **既有 4 个折行回归用例保持绿**（软折行 / 硬折行 / 上下不误拼两个方向），确认本次重构（`Promise.all` → 顺序 for 循环、`resolve`/`LinkHighlighter.scan` 共用 `resolveFsCandidates`）没有破坏原有行为。
- **`:line:col` 后缀机制**本身在 `terminalLinkParse.test.ts:45-47,72-74` 有扎实覆盖（候选提取保留后缀、`stripLineCol` 单测），跨缩进拼接只是复用这套机制在拼接后的整段文本上跑一次，风险较低。

## Findings

**Q1 / MAJOR / `LinkHighlighter` 的 parts 分段高亮（"缝隙不上色"）零测试覆盖**
- 实证：全仓库 `grep -rn "LinkHighlighter"` 只命中 `terminalLinks.ts` 自身和 `terminalRegistry.ts` 的实例化代码，`__tests__/` 目录下没有任何文件引用 `LinkHighlighter`。
- 场景：本次修复把 `LinkHighlighter.scan()` 从"每候选单独 `resolveCandidateSpanning` + 单一 `startIdx/endIdx`"改成"共用 `resolveFsCandidates` + 按 `r.parts` 逐段 `rowSegments` 注册 decoration"，commit message 明确宣称"拼接链接按 parts 分段高亮，缩进缝不上色"——这是本次改动向用户承诺的可见行为之一，但没有任何用例验证：常驻高亮真的只给两段（候选本身）上色、缩进缝隙的空格/gutter 字符没有被错误地整段覆盖上色。如果 `rowSegments`/`parts` 边界算错（比如 off-by-one 把缝隙也纳入某一段），不会被任何测试捕获，只能等用户视觉发现。
- 建议：`registerDecoration`/`registerMarker` 依赖真实渲染上下文，直接测太重；但可以对 `this.term.registerDecoration` 打 spy，驱动 `attach()`→ fake timer 触发 `scan()`，断言：调用次数（=parts 段数，不多不少）+ 每次调用的 `x`/`width` 落在候选段范围内、不覆盖缝隙列。这是本次改动里此前完全没有单测护栏的新代码路径，建议必须补。

**Q2 / MAJOR / gutter 字符（│、⎿）实际出现在缝隙中的场景未测试**
- 实证：`adjacentAcrossIndent` 的 `head` 正则是 `/^[ │⎿]*$/`（`terminalLinks.ts:202`），专门为 `│`、`⎿` 两个字符设计；但 3 个新用例的续行缩进全部是纯空格（`'    ' + tail`、`'  ' + c2`、`'  ' + c3`），没有一个用例的缝隙里真的出现 `│` 或 `⎿`。
- 场景：bug 报告本身背景是 Claude Code（Ink TUI）的工具调用输出，这类输出里续行前缀常见形如 `⎿ ` 或竖线框线 `│  `——这正是加这两个字符到白名单的动机（代码注释里也点名是"gutter 竖线"）。但目前这条专门写的字符集分支从未被任何用例执行到：如果字符打错（比如全角 `｜` U+FF5C 误写成半角、或者 `⎿` 打成形近字符）、或正则字符类范围写错，测试不会发现。
- 建议：至少补 1 个用例，续行形如 `'⎿ ' + tail` 或 `'│   ' + tail`，验证拼接依然成功且这两个 gutter 字符本身不进入最终链接 `text`（否则打开的路径会带进 gutter 字符导致 stat 必然失败）。

**Q3 / MINOR / "缝隙里有非空白尾随内容"（tail 非空场景）未测试，是 head 校验的镜像分支**
- 实证：`adjacentAcrossIndent` 判断两个条件——`tail`（c1 结束到本行末尾）与 `head`（下一行行首到 c2 开始）都必须是纯空白/gutter。已有用例（3-row 链式、用例 4）里 c1 恰好紧贴 `reachesRightEdge` 判定的那个边界字符，`tail` 天然为空字符串；用例 5 是靠 `head` 不合法（`unrelated/words` 前的合法缩进其实仍满足 head 正则，实际是靠拼接后 stat 落空来拒绝，不是靠 tail/head 校验拒绝）来触发回退。换句话说，7 个用例里没有一个是"c1 之后、本行结束前还有非空白杂字符" → tail 校验生效并 break 链的场景。
- 风险评估：这条分支即使被写错也不会导致误链接——最终 `fs.stat` 仍是 oracle，误判 adjacent=true 顶多多做一次注定落空的 stat 请求，不会产生错误链接（真实存在的路径恰好等于"截断路径+杂字符+续行内容"拼接结果的概率可忽略）。所以定级 MINOR 而非 MAJOR：值得补但不紧急，收益是提前在单测层面发现正则/逻辑笔误，而不是防止用户可见的错误。
- 建议：可选补 1 个用例，如某行铺满到边界但候选本身没到边界（候选后面还有一两个非空白字符也算进 `reachesRightEdge` 触发的"行"），验证不会跨行拼接。

**Q4 / MINOR / MAX_JOIN_PARTS=6 边界未测试**
- 实证：`MAX_JOIN_PARTS = 6`（`terminalLinks.ts:182`），链长收集在 `resolveJoinedAcrossIndent` 的 for 循环里用 `chain.length < MAX_JOIN_PARTS` 卡住；现有最长用例（3-row 链式）链长只到 3，从未触达上限截断，也从未验证"真实路径需要 7 段才能拼全，被上限砍到 6 段后优雅地找不到链接（不崩溃、不误链接短的 6 段）"这一已知限制。
- 说明：这个限制已经在 bug 报告"补充洞察"里被显式记录为已知残留风险，不是被隐藏的 gap，且是防御性设计（限 stat RPC 次数），补测试主要价值是"确认不崩溃"而非发现新行为缺陷。价值有限，可以不补。

**Q5 / NIT / 拼接候选中夹 URL 未直接测试，但代码路径分析可自然规避**
- `provideLinks`（`terminalLinks.ts:300`）在调用 `resolveFsCandidates` 前已经 `filter((c) => c.kind === 'fs')`，把 web 候选排除在拼接链输入之外；即使 URL 物理上夹在两个 fs 候选之间同一行内，也会让该行的 `tail`（或跨行时的 `head`）非纯空白，被 `adjacentAcrossIndent` 的正则天然拒绝。逻辑上安全，不是必须补的用例。

**Q6 / NIT / 软折行(auto-wrap) + 悬挂缩进组合未测试**
- 悬挂缩进是硬折行 TUI 主动插入的前导空格，auto-wrap（软折行）是终端逐字符续接、不会额外插入空格；这个组合在实践中不构成真实场景（除非被折断词本身恰好在原文里紧跟空格，那属于普通文本内容而非"缝隙"），不新增测试影响不大。

**Q7 / NIT / 测试确定性观察（非阻塞）**
- `statExisting` 的 fake `rpc` 对传入 path 统一做 `.replace(/\/+$/, '')` 尾斜杠归一（`terminalLinkWrap.test.ts:21`），这层归一化是测试桩自己做的，如果真实 host 端 `fs.stat` RPC 对尾斜杠不归一（未验证，超出本次评审范围），测试可能掩盖真实环境下的行为差异——但这是既有 4 个回归用例就有的既有模式，不是本次改动引入的新问题，不计入本次 finding。
- 异步方面：`resolveFsCandidates`/`resolveJoinedAcrossIndent` 内部循环里的 `await` 都是顺序的（不是 `Promise.all`），测试里的 `provide()` 用单一 Promise 等待 `provideLinks` 回调，没有并发触发多次 `provideLinks`/`scan` 的场景，`LinkHighlighter.epoch` 取消逻辑也完全没有测试触达（与 Q1 同源，LinkHighlighter 整体零覆盖）。不重复计分，并入 Q1。

## 结论

新增的 3 个用例本身质量不错——断言到位、真实验证了 longest-first 与"跨缩进拼接"这个核心机制，对 `FsLinkProvider.resolve()`（hover 路径）的覆盖是扎实的。但本次改动的另一半——`LinkHighlighter` 常驻高亮的 parts 分段逻辑（Q1）——完全没有测试验证，而这恰恰是 commit message 明确宣称的行为承诺；同时该修复专门为之设计的 gutter 字符分支（Q2，│/⎿，直接对应 bug 报告的真实场景 Claude Code Ink 输出）也从未被任何用例执行到。这两点建议 dev 补齐后再进入下一阶段；其余（Q3/Q4）价值较低可自行取舍，Q5/Q6 无需处理。

**verdict: NEEDS_REVISION**（2 条 MAJOR：Q1 LinkHighlighter 高亮分段无测试、Q2 gutter 字符分支无测试；2 条 MINOR：Q3 tail 校验镜像分支、Q4 MAX_JOIN_PARTS 边界；3 条 NIT：Q5/Q6/Q7）
