---
reviewers: [architect, qa, external]
verdict: APPROVE
findings:
  - {id: Q1, severity: MAJOR, status: fixed, title: "LinkHighlighter parts 分段高亮零测试覆盖", source: qa}
  - {id: Q2, severity: MAJOR, status: fixed, title: "gutter 字符(│/⎿)白名单分支无用例执行", source: qa}
  - {id: Q3, severity: MINOR, status: fixed, title: "tail 守卫(候选后同行杂字符)镜像分支无用例", source: qa}
  - {id: Q4, severity: MINOR, status: deferred, title: "MAX_JOIN_PARTS=6 上限边界未测试", source: qa}
  - {id: Q5, severity: NIT, status: rejected, title: "拼接候选中夹 URL 未直接测试", source: qa}
  - {id: Q6, severity: NIT, status: rejected, title: "软折行+悬挂缩进组合未测试", source: qa}
  - {id: Q7, severity: NIT, status: rejected, title: "fake stat 尾斜杠归一可能掩盖真实差异", source: qa}
  - {id: A1, severity: MINOR, status: fixed, title: "高亮热路径 join stat 放大(容量)", source: arch}
  - {id: A2, severity: MINOR, status: fixed, title: "join 不叠加 spanning 需注释说明", source: arch}
  - {id: A3, severity: NIT, status: rejected, title: ":line:col 断在 wrap 缝隙丢列号(既有解析限制)", source: arch}
  - {id: A4, severity: NIT, status: rejected, title: "tail 允许尾随空格理论可桥接双绝对路径", source: arch}
  - {id: A5, severity: MINOR, status: deferred, title: "rowSegments 段尾宽字符 decoration 短 1 列(既有)", source: arch}
  - {id: E1, severity: MAJOR, status: rejected, title: "resize 后硬折行 join 失效退化半截(降级为既有限制记录)", source: external}
  - {id: E2, severity: MAJOR, status: fixed, title: "续段不含斜杠(basename 内折行)不构成候选 → 不拼接", source: external}
  - {id: E3, severity: MAJOR, status: fixed, title: "拼接落空时重叠后缀链串行 stat 放大(降级 MINOR · 已加固)", source: external}
---

# REVIEW 汇总 — TERMPRO-B260710093647-Wrap-Indent-Path-Link

评审对象:dev 产出 `1b8c799`(跨缩进拼接折行路径链接)。三视角独立评审:
- `REVIEW-arch.md`(architect · opus subagent):**APPROVE**(0 BLOCKER/MAJOR · 2 MINOR + 2 NIT + 1 记录点)
- `REVIEW-qa.md`(qa · sonnet subagent):**NEEDS_REVISION**(2 MAJOR + 2 MINOR + 3 NIT)
- `external-cross-review/review.md`(external · codex/GPT 异质模型):**NEEDS_REVISION**(3 MAJOR)

PMO 逐条质疑核实(两个方向都给实证)后,采纳项已在本 stage 内 fix(commit 见下),最终 **verdict: APPROVE**(无 open BLOCKER/MAJOR)。

## 裁决明细(仅记与原评审不同或需实证的判断)

**采纳并修复**
- **Q1(qa MAJOR)**:grep 证实 `LinkHighlighter` 除 registry 实例化外零引用,而 parts 分段是本次新代码路径 → 新增 `terminalLinkHighlight.test.ts`:spy `registerDecoration`,断言恰好 `[{row:0,x:10,w:30},{row:1,x:4,w:30}]` 两段、缩进缝无 decoration。
- **Q2(qa MAJOR)**:确认 3 个新用例缝隙全为纯空格,`[ │⎿]` 字符集分支未执行 → 补 `│ ⎿ ` 缝隙用例(拼接成功 + gutter 不入 text)。
- **Q3(qa MINOR)**:补决定性用例——候选后同行有 `)` 时,即便拼接路径真实存在也不拼(比 QA 建议的更强:stat 故意给拼接路径放行,专测守卫本身)。
- **E2(external MAJOR · 本轮最有价值 finding)**:核实属实——`PATH_RE` 相对分支要求 ≥1 斜杠,basename 内折行的续段(如 `IOS-scaffold`)不构成候选,链根本不会尝试,换个终端宽度原 bug 即复发。修复:`adjacentAcrossIndent` 重构为 `continuationPiece`——续接段从续行文本直接派生(`CONT_RUN_RE` + `trimTrailingPunct`),不再要求是候选;吞并改为按链覆盖区间(`endIdx`)跳过候选。补 2 用例(无斜杠续段整条成链 / 尾随引号修剪)。
- **E3(external MAJOR → 降级 MINOR 后加固)**:21 vs 6 次 stat 的算术属实,但 `statCache` 同样缓存 miss(5s 负缓存,`terminalLinks.ts stat()` 对 null 也 set),重复扫描有兜底;全 miss 长链需「连续多行贴右边界的斜杠 token + 缩进续行且拼接均不存在」,形态罕见。仍加固:`MAX_JOIN_STATS_PER_LINE=12` 每逻辑行确定性预算(耗尽即回退单候选解析)。列为上线观察项(host fs.stat 负载)。
- **A1(arch MINOR)**:与 E3 同源,同一加固covers;观察项已记 BUG 报告补充洞察。
- **A2(arch MINOR)**:已在 `resolveJoinedAcrossIndent` doc 注释补「join 只做 exact 解析,不叠加 spanning 修剪」及理由。

**驳回(附实证)**
- **E1(external MAJOR → rejected as MAJOR · 记录为既有限制)**:现象属实但非本 fix 引入——硬折行 join(`reachesRightEdge`)是 dev 前既有机制,resize 变宽后历史行不 reflow,修复前后 resize 后行为同为「半截前缀链」(修复严格变好:resize 前整条可用,resize 后退化不劣于旧行为,且 stat 兜底无误链)。buffer 层原理上无法恢复「这曾是一条折行」;Ink 活区按新宽度重绘自愈。已记 BUG 报告「补充洞察」。
- **Q5/Q6/Q7、A3/A4(NIT)**:维持各评审自己给出的「无需处理」结论(缝隙正则天然拒 URL / 软折行无缩进场景 / 既有测试桩模式 / 既有 PATH_RE 边界 / 天文概率 + stat 兜底)。

**延后(记录去处)**
- **Q4**:MAX_JOIN_PARTS 边界——防御性上限,BUG 报告已显式记录,补测收益为「确认不崩溃」,不值一个仪式用例。
- **A5**:既有宽字符 decoration 短 1 列 → `product-overview/PENDING.md` PENDING-007。

## 验证门禁(review-fix 后 · worktree)
`tsc --noEmit` exit 0 · `vitest run` **774 passed / 1 skipped**(`evidence/review-fix-vitest.log` · 全部 9+2 折行用例 + 高亮分段用例绿)· `TERMPRO_SMOKE=1` → `SMOKE_OK`。

## 结论
核心机制(stat 为 oracle 的跨缩进拼接)经三方确认正确;E2 修复把「续接段必须是候选」的过窄条件放宽为文本派生,覆盖 basename 内折行的常见形态;性能加固后热路径普通场景零额外 RPC。无 open BLOCKER/MAJOR → **APPROVE**,进入 test。
