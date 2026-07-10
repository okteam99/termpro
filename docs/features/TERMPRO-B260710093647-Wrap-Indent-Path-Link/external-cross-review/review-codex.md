---
reviewer: external
model_family: codex (OpenAI · codex exec CLI)
heterogeneous: true
---

## Findings

1. **MAJOR** — [terminalLinks.ts:139](/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260710093647-Wrap-Indent-Path-Link/src/renderer/terminal/terminalLinks.ts:139)、[terminalLinks.ts:403](/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260710093647-Wrap-Indent-Path-Link/src/renderer/terminal/terminalLinks.ts:403) — resize 后硬折行链接再次只剩半截。  
   **失败场景：**40 列时首行恰好铺满、第二行带 4 空格缩进，完整路径可正确拼接；resize 到 80 列后，真实换行不会 reflow/设置 `isWrapped`，首行也不再到达当前右边界，因此 `buildLogicalLine` 不再包含第二行。实测完整链接退化为首行真实目录，第二行无链接。`onResize` 的高亮扫描会立即显示这个错误结果。

2. **MAJOR** — [terminalLinks.ts:408](/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260710093647-Wrap-Indent-Path-Link/src/renderer/terminal/terminalLinks.ts:408) — 续行必须自己是 fs candidate，路径在最终组件内折行时仍无法修复。  
   **失败场景：**首行是存在的目录 `/home/u/.../apps/`，第二行为 `    IOS-scaffold`，完整的 `/home/u/.../apps/IOS-scaffold` 也存在。由于 `IOS-scaffold` 不含 `/`，不会被 `extractCandidates` 识别，拼接函数根本不会尝试完整路径，最终仍只链接前缀目录。当前回归测试的续段均含多个 `/`，未覆盖任意列宽下很常见的 basename/组件内断点。

3. **MAJOR** — [terminalLinks.ts:409](/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260710093647-Wrap-Indent-Path-Link/src/renderer/terminal/terminalLinks.ts:409)、[terminalLinks.ts:430](/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260710093647-Wrap-Indent-Path-Link/src/renderer/terminal/terminalLinks.ts:430)、[terminalLinks.ts:548](/Users/liam/apps/okok/TermPro/.worktree/TERMPRO-B260710093647-Wrap-Indent-Path-Link/src/renderer/terminal/terminalLinks.ts:548) — 拼接落空时产生重叠后缀的串行 `fs.stat` 放大，并进入常驻高亮热路径。  
   **失败场景：**6 个相邻、缩进后的路径候选均不存在时，实测一次解析发出 21 次 `fs.stat`，原逻辑只需 6 次；60 个候选的理论上限为 345 次。`MAX_JOIN_PARTS` 只限制每个起点，外层仍从每个候选重新尝试后缀链，而且全部串行等待。首次扫描、唯一输出及并发中的扫描不受 5 秒缓存充分保护；远程 Host 下可能造成数秒至数十秒的高亮延迟和 RPC 压力。实际 RTT 影响未在真实远程机量测，但调用放大是确定的。

补充核对：

- CJK 双宽前缀后的起始列换算在实测中正确。
- 跨缩进的 `:42:10` 能保留高亮文本并以剥离后路径执行 `stat`。
- 常规三段最长优先及 `consumed` 跳过数学未发现错误。
- `tsc --noEmit`、目标文件 ESLint、`git show --check` 通过。
- Vitest 因只读沙箱无法创建临时目录而未启动；上述失败均由不落盘的内存 harness 直接驱动该实现复现。

🔄 TERMPRO-B260710093647-Wrap-Indent-Path-Link (Bug · review) | 下一步:修复 resize、无斜杠续段及 stat 放大并补回归测试  
📁 docs/features/TERMPRO-B260710093647-Wrap-Indent-Path-Link  
🌿 fix/termpro-b260710093647-wrap-indent-path-link

verdict: NEEDS_REVISION