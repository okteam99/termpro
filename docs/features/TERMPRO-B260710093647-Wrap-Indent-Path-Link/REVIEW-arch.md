---
reviewer: architect
verdict: APPROVE
---
# Architect Review — BUG-TERMPRO-B260710093647-001（跨缩进拼接折行路径链接）

评审对象：commit `1b8c799` · `src/renderer/terminal/terminalLinks.ts` + `terminalLinkParse.ts` + `terminalLinkWrap.test.ts`
姿态：默认质疑；每条结论给实证；已在 worktree 内实跑 typecheck / vitest 取证。

## 实证门禁（本次亲自复核）
- `npx tsc --noEmit` → exit 0（无类型错误）。
- `npx vitest run …/terminalLinkWrap.test.ts` → **7 passed**（4 既有 wrap 用例 + 3 新增,全绿,未见既有语义被改动）。
- `grep resolveFsCandidates / resolveCandidateSpanning / resolveJoinedAcrossIndent / adjacentAcrossIndent / ResolvedFsLink` 跨 `src`：**除 `terminalLinks.ts` 自身外无其他文件引用**——新增 API 无跨模块耦合面,`LinkHighlighter` 与 `FsLinkProvider` 同文件,契约变更影响面封闭。

## 已核对无虞的点

1. **架构红线维持**：新增路径全部经 `this.getClient().rpc('fs.stat', …)`(terminalLinks.ts:333)解析,renderer 未新增任何 `fs`/`node`/electron import;`resolveJoinedAcrossIndent` 只调 `resolveCandidateText`→`stat`→rpc,不直碰磁盘。红线未破。
2. **热路径无 RPC 放大(关键)**：`resolveJoinedAcrossIndent` 里 `chain` 起始长度 1,若 `adjacentAcrossIndent` 首次即 false 则 `chain` 停在长度 1,`for (n = chain.length; n >= 2; n--)` 直接不进循环、**零 stat 返回 null**(terminalLinks.ts:408-421)。即普通(非缩进续行)候选拼接阶段不产生任何额外 RPC,只多一次纯函数 `adjacentAcrossIndent`。放大严格局限于真实的「贴行尾 + 缩进续行」形态。
3. **最长优先 + consumed 跳过正确**：命中返回 `consumed=n`,调用方 `i += joined.consumed - 1` 后 `continue`→外层 `i++`,精确跳过被吞的 n 个候选(terminalLinks.ts:430-436),无重复成链、无漏解析;`consumed≥2` 保证 i 单调前进,不会死循环/回退。
4. **「真路径从链中段起」可自愈**：若 `c1+c2` 均 miss(real path 实际是 `c2+c3`),join 返回 null → c1 走 spanning 回退 → 外层推进到 c2 → 重新起链 `[c2,c3]` 命中。逐 i 重入覆盖了「起点候选不属于路径」的情形,不因贪婪起链而漏。
5. **web 候选夹在中间不误拼**:传入 `resolveFsCandidates` 的 cands 已 `.filter(kind==='fs')`(terminalLinks.ts:300, 550),但 `adjacentAcrossIndent` 的 `head = ll.text.slice(rowBreak, c2.start)` 读的是**原始逻辑行文本**,一旦缝隙里含被过滤掉的 web URL,`/^[ │⎿]*$/` 判负→不拼接。过滤未制造假相邻。
6. **同物理行的两候选永不拼**:`r2 !== r1 + 1` 直接 return false(terminalLinks.ts:197),同行空格分隔的两条路径保持独立。
7. **stat 是最终 oracle,不误拼**:test「hanging indent with unrelated continuation」证实拼接落空后回退到前缀目录单链(terminalLinkWrap.test.ts:115-127);安全性质(无关下一行不吞)保持。
8. **续段以 `/` 开头是合法续接、且被正确重建**:硬折行若恰好断在 `/` 前,`c2` 会以 `/` 开头,`c1.text + c2.text` 直接拼回原路径(缝隙只含空白/gutter,不含路径字符)。allow 绝对样式的 c2 是必要的正确行为,不是缺陷。
9. **顺序 for(非 Promise.all)是算法必需,非退化**:consumed-跳过要求前一候选解析结果决定后续是否被吞,天然不可并行。改为顺序循环是正确性前提,hover 的 fs 解析虽由并行变串行,但 5s `statCache` 兜底 + 单行候选数通常 1~3,延迟增量可忽略。
10. **`:line:col` 后缀跨行(尾段)正确**:拼接文本末尾的 `:12:5` 由 `resolveCandidateText`→`stripLineCol` 统一剥离(terminalLinks.ts:351),不影响 stat。
11. **epoch 竞态守护到位**:`LinkHighlighter.scan` 在每次 `await resolveFsCandidates` 后 `if (this.epoch !== myEpoch) return`(terminalLinks.ts:552),陈旧扫描提前退出且不触碰 `this.decos`(clear/register 在循环之后),不会清掉当前有效高亮。
12. **越界防御**:`adjacentAcrossIndent` 对 `ll.pos[c1.end-1]?.row === undefined` 有 guard;`resolve()` 对 `!s || !e` 有 continue(terminalLinks.ts:459)。
13. **MAX_JOIN_PARTS 截断语义一致**:chain ≤ 6,`n` 从 6..2 至多 5 次 stat,与注释「MAX-1」吻合;超 6 段路径退化为旧的半截链(可接受,极长路径)。

## Findings

### A1 · MINOR · 高亮热路径 stat 放大在极端输出下仍可观(有界·多缓存兜底)
- 实证:`LinkHighlighter.scan` 对每条可视逻辑行调 `resolveFsCandidates`(terminalLinks.ts:548);真实「缩进续行」形态下每条起链候选至多 5 次 stat(terminalLinks.ts:413)。
- 失败场景:满屏都是 Claude Code 工具调用式「铺满行尾 + 缩进续段」的长路径(如连续多条 worktree 路径输出),单次 scan 可达 ~(可视行数 × 5) 次 `fs.stat` RPC;流式输出下 `onWriteParsed` 每 200ms 触发一轮,首轮未进 5s `statCache` 的文本会实打实打到 host。
- 不确定性:实际 Claude Code 输出里「wrap 且缩进的长路径」占比通常很低,多数行 chain 长度 1(0 stat),故大概率不触发。属容量问题非正确性。
- 建议:暂不改;上线后若 host `fs.stat` 出现突发负载,再考虑对「join 落空」的拼接文本加一层短时负缓存(negative statCache),或对每轮 scan 的拼接尝试次数设软上限。

### A2 · MINOR · join 与 spanning-回退不组合(需要同时「修剪 + 跨缩进拼接」时退化为半截)
- 实证:`resolveJoinedAcrossIndent` 对链只做整段 `resolveCandidateText`(terminalLinks.ts:418),不含 `resolveCandidateSpanning` 的物理行前缀/后缀修剪;两条回退路径彼此独立(terminalLinks.ts:431-445)。
- 失败场景:某候选 `c1` 因「其上一物理满行被误拼」需 spanning 取后缀,同时又有缩进续段 `c2` 需拼接——此时 join(用完整 c1.text)落空,回退只对 c1 做 spanning 得到半截,`c2` 另行解析多半 miss,整条路径拿不全。
- 不确定性:Ink 的续行缩进是**一致**行为(要么全部续行都缩进被切成多候选,要么都不),「一段无缩进续接 + 一段缩进续接」混合与 Ink 实际渲染相悖,现实概率极低;doc「补充洞察」的残留风险段已隐含此类组合不穷举。
- 建议:不阻塞;若日后遇真实反例,再让 join 的每段用 spanning 结果替代原始候选文本(代价 O(段×行) stat)。当前留注释说明「join 走整段 exact-match,不叠加 spanning」即可。

### A3 · NIT · `:line:col` 断在 wrap 缝隙中会丢列号(既有解析限制,join 无能为力)
- 实证:`PATH_RE` 的 `(?::\d+(?::\d+)?)?` 后缀须紧贴路径本体(terminalLinkParse.ts:24);若换行恰好切在 `foo.ts:12` 与 `:5` 之间,`:5` 不构成独立候选,拼接无从发生。
- 失败场景:`…/foo.ts:12`(行尾)+ 缩进 `:5` → 只链到 `foo.ts:12`,列 `5` 丢失。定位仍到文件与行,退化温和。
- 建议:不改。属 `PATH_RE` 既有边界,非本 fix 引入,概率极低。

### A4 · NIT · `tail` 允许尾随空格 + 双绝对路径,理论上可桥接两条无关路径(stat oracle 兜底)
- 实证:`adjacentAcrossIndent` 的 `tail` 判据是 `/^ *$/`(允许非空空格,terminalLinks.ts:202);仅在软折行 join(`buildLogicalLine` 因 `isWrapped` 而非 `reachesRightEdge` 相接)下 `tail` 才可能非空。
- 失败场景:两条绝对路径落在相邻软折行、缝隙仅空格,`/a/b/` + `/c/d` 拼成 `/a/b//c/d`(POSIX 归一为 `/a/b/c/d`),若该归一路径恰存在则误链。
- 不确定性:Ink 缩进是硬折行场景(`tail` 恒为空),软折行不加缩进,构造上几乎不可能;且须归一后路径真实存在。属天文级低概率,`stat` 为最终闸门。
- 建议:不改。若想更保守,可将 `tail` 收紧为 `/^$/`(要求候选恰贴物理行尾),与 `buildLogicalLine` 的 `reachesRightEdge` 前提对齐——但当前不构成实际风险。

### A5 · 记录点(既有·非本 fix 引入)· rowSegments 对段尾宽字符(CJK)少算 1 列
- 实证:`rowSegments` 的 `width = endCol - startCol + 1`,`endCol` 取末 code-unit 的 col(terminalLinks.ts:176);段尾若为宽字符(占 2 列),其第二格未计入,蓝色高亮/装饰宽度短 1 格。
- 说明:`rowSegments` 本次未改动(diff 外),属既有行为;本 fix 把 fs 高亮从「单 span」改为「多 parts 分段」后,分段边界变多,该短算会作用到更多段尾,但**不是新缺陷类**,且仅影响装饰末格的视觉、不影响链接命中/点击(range 与 activate 走独立路径)。
- 建议:归入既有 backlog,若要修则在 `lineToString`/`rowSegments` 用 `cell.getWidth()` 累加真实列宽;不属本 bugfix 范围。

## 结论

**verdict: APPROVE。** 修复选型正确(resolver 层跨缩进拼接、以 `fs.stat` 为 oracle、hover 与常驻高亮共用同一 resolver 一处修两处),核心不变式经代码走查与实跑成立:架构红线未破、热路径普通场景零 RPC 放大、consumed 跳过与逐 i 重入在数学上自洽、既有 4 个 wrap 回归用例语义未变(7/7 绿)。所列 5 条 finding 均为 MINOR/NIT/既有记录,无一影响正确性或安全性,不存在 BLOCKER/MAJOR——A1(容量放大)有 chain-length-1 零 stat 与 5s 缓存双重兜底、A2/A4 与 Ink 实际渲染相悖属理论边界、A3/A5 为既有解析/渲染限制非本 fix 引入。可直接进入 test/pm_acceptance;建议把 A1 的 host `fs.stat` 负载列为上线观察项、A2 的「join 不叠加 spanning」补一句代码注释。
