---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review=true(单模型 · 异质评审降级为同模型 exec 自审 · 已 startup WARN)"
review_via: subagent
verify_fixes: true
target_commit: e10fe00f919f9ff6d2494b46f3e2cc68a24817df
---

# 修复验证评审(Round1 · verify-fixes) — TERMPRO-F260709092310 Host Standalone + WS 传输 + 握手

- perspective: external-claude(降级同模型自审 · 验证轮)
- target: code
- generated_at: "2026-07-10T01:05:00Z"
- 验证基线: fix commit `e10fe00`(parent `6d460e8`);上轮评审基线 `8570979`
- 范围锁定: 逐条裁决统一台账 F1–F5 修复 fixed/not-fixed + 只回归审查修复 diff 本身引入的新问题(禁全量重扫)
- 台账映射: **F3 = 上轮 external CR-1**(token 空值 fail-open · 本 external 认领项);F1/F2/F4/F5 为跨视角台账项
- files_read:
  - src/host/token.ts(全)
  - src/host/watchService.ts(全)
  - src/host/gitService.ts:147-205
  - src/host/__tests__/tokenGate.test.ts(diff + 新增用例)
  - src/host/__tests__/wsTestHarness.ts(pokeUntilFsEvent)
  - src/host/__tests__/wsRpcParity.test.ts(diff)
  - src/host/__tests__/wsMultiClientIsolation.test.ts(diff)
  - .github/workflows/host-package.yml(diff)
  - docs/.../TC.md(F4 diff)
- 实测: `vitest run tokenGate + wsRpcParity + wsMultiClientIsolation` → 35 passed;fs.watch 重跑第二轮 17 passed(F1 稳定性复核)

## 逐条裁决

### F3(= CR-1)— 空 token(file/fd/stdin)fail-open → auth bypass ✅ FIXED
- checklist: C3
- 修复实证: `src/host/token.ts:37-45` 新增 `requireNonEmptyToken`,并在三通道 return 前统一套用 —— `--token-file`(:98)、`--token-fd`(:106)、`--token-stdin`(:113);env 通道原有 `envToken !== ''` 守卫仍在(:84),generated 走 `crypto.randomBytes`(:22)恒非空。
- 根因是否真闭合: **是**。经 `resolveToken` 的**所有**信道现在都不可能返回 `token===''`,故 host 侧 expected token 恒非空;`verifyToken('', 非空)` 恒 false(:125-131),上轮描述的 `?token=`(空串,非 null,绕过 wsServer 的 `provided===null` 拒绝分支)→ `verifyToken('','')` 通过的 fail-open 链路从源头被切断。
- 测试实证: `tokenGate.test.ts` 新增 3 空值单测(空白文件 / fd 空 / stdin 空 → 均 `toThrow(/refusing empty token/)`)+ 1 集成断言(非空 host 上客户端 `?token=` 空串被拒 · readyState≠OPEN · 零消息)。本地 35 passed 覆盖。
- 残留(不阻断 · info): 上轮 suggestion 里「在 `startWsServer` 入口对 `opts.token` 补一道非空断言做纵深」未落地。当前实机入口(host.ts)只经 `resolveToken` 取 token,不可达空值;仅当有直接以 `token:''` 调 `startWsServer` 的旁路调用方才会重现,现无此调用方。属纵深加固建议,非本 finding 未修 —— finding 本身(空源 → fail-open)已 fail-closed。

### F1 — fs.watch 集成测试 flakiness(poke 循环)✅ FIXED
- checklist: C5
- 根因重判是否成立: **成立**。`fs.watch(path,{recursive:true})` 在 macOS 底层绑 FSEvents,RPC 返回 watchId ≠ 流已开始接收;满负载下「返回后第一次写」可能落进流未就绪的死窗口而**永久丢事件**(不补发)—— 这解释了为何任何固定预算(3000/8000ms)都注定超时,是「丢」不是「慢」。
- 修复实证: `wsTestHarness.ts:228-268` 新增 `pokeUntilFsEvent`,持续以唯一文件名 poke(防去重)直到命中「流已就绪」窗口收到事件或预算耗尽;正向等待点 T-032/T-033(wsRpcParity.test.ts:164/176)、T-042/T-043(wsMultiClientIsolation.test.ts:135/148)改用之。
- 回归正确性: watchService 未过滤 dotfile(`watchService.ts:20-28` 裸 `fs.watch` 回调,无 startsWith('.')/ignore),故 `.fs-poke-*` 能触发事件;负向断言未削弱 —— T-042 中 A 先 unwatch 自身 watch、T-043 中 A 从不 watch,故 poke 写入 tmp 不会破坏 `a.fsChanged.length===0`;T-033 unwatch 后的「不再收」窗口不变。
- 稳定性实证: 两轮独立跑(35 passed + 17 passed)fs.watch 用例全绿。

### F2 — linux-arm64 产物缺失 ✅ FIXED(CI 层可静态核验)
- checklist: C1/C5
- 修复实证: `.github/workflows/host-package.yml:36-37` matrix 新增 `ubuntu-24.04-arm → linux-arm64`,采 GitHub 原生 arm64 hosted runner(非 QEMU 仿真),复用同一「打包 + verify-host-artifact 实机验证」步骤;注释回写了本地 Apple-Silicon docker `--platform linux/arm64` 复现结论。
- 裁决口径: 产物矩阵项已落 workflow(可静态核验);「docker arm64 native VERIFY_OK」实机结论在 commit message,本评审环境无法独立复跑 CI,取 workflow 变更为准 —— 满足 AC-4/TC-F05「产物存在性」判据且超出(改成真实机验证)。

### F4 — TC test_refs 文件名错指 ×7 ✅ FIXED
- checklist: C5(TC↔实现映射)
- 修复实证: `TC.md` T-053…T-059(共 7 条)`file:` 由不存在的 `.github/workflows/host-package-smoke.yml` 改为真实存在的 `.github/workflows/host-package.yml`;已核验 `host-package-smoke.yml` 确不存在(`ls` No such file)。纯文档校正,不涉运行时。

### F5 — T-031 parity 缺 git.show/git.changedFiles ✅ FIXED
- checklist: C5
- 修复实证: `wsRpcParity.test.ts:118-135` 新增两段 WS-vs-直调等价断言:`git.show{toplevel,ref:'HEAD',path:'package.json'}` vs `gitShow(...)`(并断言 content 非空)、`git.changedFiles{toplevel}` vs `gitChangedFiles(...)`;签名与 `gitService.ts:147/189` 对齐(`{content}` / `{entries,mergeBase}`)。本地实测该 describe 全绿。

## 修复 diff 是否引入新问题

无 blocker / high。仅 info 级观察(均不阻断):

### N-1 — pokeUntilFsEvent 遗留 `.fs-poke-*` 文件不清理 · info
- location: `wsTestHarness.ts:248`
- 每次 poke 在 dir(临时目录)写唯一文件且不删除,循环命中越晚遗留越多。落在 `os.tmpdir()` 下的测试临时目录,无功能影响,可选在返回前清理或改用 `afterEach` 递归删。

### N-2 — T-038/T-039b 等待预算上调(5000→12000)· info
- location: `wsRpcParity.test.ts:285`、`wsMultiClientIsolation.test.ts:103`
- 抗并行负载抖动的超时放宽,提升测试墙钟上限但不改判定语义,非正确性问题;若真实链路需要 12s 才回帧则另有隐患,当前实测远快于此,属余量。

### N-3 — F3 纵深断言未加(承接上轮 CR-1 suggestion 残留)· info
- 见 F3 裁决「残留」段:`startWsServer` 入口无 `opts.token` 非空断言。现无可达空值旁路,记录备查,非本轮回归引入的新洞。

## 结论
统一台账 F1–F5 **全部 FIXED**:F3(=CR-1 · 本 external 认领的 high)fail-closed 从源头闭合并有单测+集成佐证;F1 根因重判成立、修法正确且两轮实测稳定、负向断言未削弱;F2 CI 矩阵项已落且升级为实机验证;F4/F5 文档与测试校正到位。修复 diff 未引入 blocker/high 新问题,仅 3 项 info 级观察(测试遗留文件 / 超时余量 / 纵深断言),可择机、不阻断合并。
