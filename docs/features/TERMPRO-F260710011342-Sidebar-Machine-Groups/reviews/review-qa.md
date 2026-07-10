---
review_role: qa
feature_id: TERMPRO-F260710011342-Sidebar-Machine-Groups
baseline: origin/yolo/m5-remote-host...HEAD
tc_baseline: TC.md (35 test · verify-ac 11/11 form)
verdict: NEEDS_REVISION
reviewed_at: 2026-07-10
default_stance: 质疑弱断言 / 形式覆盖
---

# QA 代码评审 — BL-004 机器分组 Sidebar + 添加项目流程

## TL;DR

数据模型作用域隔离(本 Feature 真正的最高风险 = R-3「本机加一个项目就清空所有远程机分组」)
的测试**是真捕获回归、不是形式覆盖**——`workspaceSync.test.ts` 纯函数层 + `workspaceSnapshotScope.test.ts`
store 集成层双覆盖,均驱动真实 `reconcileWorkspaces`/`applyWorkspaceSnapshot`/`setHostWorkspaces`。
E4 create 不落本机、E3 serialize 双分支过滤 + v1 CRUD 拒绝、复合键不串 tab、AC-9 params 校验、
D-7 远程文件禁用——都用真实 store/registry/service,桩保真,无「绿测红产」。

**但 verify-ac 的 11/11 是形式覆盖**:TC.md `tests:` frontmatter 有 **4 处 test 文件路径与实现漂移**,
其中 **`BL004-U-grepgate`(import 集门禁·E1·blueprint 钦定的 R-1 首要防线)整条未实现**——
既无 vitest 也无门禁脚本。我手工跑了 TECH.md 权威 perl 正则:当前迁移**是干净的**(importer ⊆ 豁免集、
tsc 绿),所以这是**缺失的回归护栏,不是活的路由 bug**;但它恰是蓝图反复强调「测绿实则漏」
(KNOWLEDGE GO-027 同型陷阱)的那一条,不该在「11/11 通过」的表象下消失。

**Verdict = NEEDS_REVISION**:补 `BL004-U-grepgate` 门禁(P0 声明 · 廉价 · 一条 perl/JS 扫源码断言即可),
并把 TC.md frontmatter 与实现对齐(或补齐 routing 集成/local 基线两条声明测试)。代码本身正确,故非 BLOCKER。

---

## Findings

### Q1 · High · open · `BL004-U-grepgate`(import 集门禁 · E1)整条未实现——最高风险 AC-5 静态门禁缺失

- **位置**:声明于 `TC.md:102-107`(`file: hostConsumerGrepGate.test.ts`)· 规格于 `TECH.md:220-240`
  (perl -0777 花括号作用域正则 + CI 脚本)· R-1 主防线 `TECH.md:477` · 「测绿实则漏」`TECH.md:511`。
  **实际**:全仓无 `hostConsumerGrepGate.test.ts`、无 `0777`/`allowlist`/门禁脚本(`scripts/` 下只有
  `package-host.mjs`/`verify-host-artifact.mjs`,无关)。
- **为何是 open 而非 info**:这条门禁是 blueprint 明确升格为 R-1「迁移面大漏迁 → 远程走错本机 host」
  的**首要**防线,且 TC 标 P0。verify-ac 把它记进 AC-5 覆盖(AC-5 10 test 里的一条),但机读通过掩盖了
  它不存在的事实。
- **实测缓释**:我用 TECH.md 权威正则
  `import\s+(?:type\s+)?\{[^}]*\bhostClient\b[^}]*\}`(perl -0777)扫 `src/renderer`(排除豁免集 =
  `services/hostClient.ts`/`services/hostRegistry.ts`/`components/viewer/*`/`__tests__`),
  结果 **GATE CLEAN**(无非豁免文件 import 单例 hostClient)+ `tsc --noEmit` 零报错。故当前无活路由 bug。
- **残余风险**:无自动门禁 → 后续任一 migrated consumer 若新增裸 `import { hostClient }`,
  远程 workspace 会静默读本机 fs/git/pty,tsc 不拦(合法 import)、无测试拦。这正是 AC-5「全链路走该机」
  会退化且**测试全绿**的场景。
- **建议**:补一条 unit(Node fs 扫 `src/renderer/**/*.{ts,tsx}`,对每文件跑同一条正则,
  importer 集 ⊄ 豁免 allowlist 即 fail 并报文件)。TECH.md 已给出可直接移植的脚本与豁免常量。
  ~30 行,消除该 open。

### Q2 · Medium · open · `BL004-I-route-terminal/-fs/-git` 集成测试未按声明落地;route-fs 的 `useFilePanel` 接线闭包无测试直接驱动

- **位置**:声明于 `TC.md:84-101`(`file: remoteWorkspaceRouting.test.ts`,3 条 P0,断言
  「pty.spawn/fs.readdir/git.info 落 remoteStub · localStub 零调用」)。**该文件不存在**。实际分布:
  - **route-terminal**:`sessionRouteCompositeKey.test.ts:98-114` 真实覆盖——`ensureSession` 经
    `forWorkspace({hostId})` 取 client,pty.spawn/attachPty/resize 落远程桩,`hostRegistry.local` 零调用。✓ 实质等价。
  - **route-git**:源码接线在位(`App.tsx:77-79` `forWorkspace(w).rpc('git.info',{cwd:w.root})`),
    但**无测试驱动 App.tsx 分支刷新断言落远程**。grep 门禁本应是静态兜底——也缺(见 Q1)。
  - **route-fs**:`deps.test.ts` 证明 `makeHostDeps(resolveClient)` 路由到 `resolveClient()` 返回值;
    `useFilePanel.ts:34-37` 接线 `resolveClient = () => forWorkspace(selectActiveWorkspace())`。
    但**没有测试驱动 useFilePanel/FilePanel 在远程 active ws 下断言 fs.readdir 落远程**——
    `FilePanelRemoteDisabled.test.tsx:66` 把 `useFilePanel` 整个 mock 掉,接线闭包未被执行。
- **判定**:route-fs 接线是一行纯闭包、两半各自有测,风险低;但 AC-5「全链路走该机 host」(声明最高风险)
  的信心部分依赖**未被驱动的接线 + 缺失的静态门禁**。属形式覆盖偏弱,非活 bug(gate 手工验证干净)。
- **建议**:优先补 Q1 门禁(静态穷举覆盖所有消费点,含 App.tsx 折行 git.info);route-fs 可加一条
  driving useFilePanel 的 unit(remote active ws → deps.readdir 落 remoteStub)封口。

### Q3 · Low · open · verify-ac 11/11 = 形式覆盖:TC.md frontmatter 4 处 test 文件路径与实现漂移

- `verify-ac.py` 读 `TC.md` frontmatter 的 `tests:` 声明算覆盖,**不校验文件存在/通过**。以下声明路径无对应文件:
  | 声明 id | TC 声明文件 | 实际 |
  |---|---|---|
  | `BL004-U-badge-zero/-semantic` | `state/__tests__/tabBadge.test.ts` | `components/__tests__/MachineWorkspaceRow.test.tsx`(已实现·改名)✓ |
  | `BL004-I-route-*` | `services/__tests__/remoteWorkspaceRouting.test.ts` | 无此文件(见 Q2) |
  | `BL004-U-grepgate` | `services/__tests__/hostConsumerGrepGate.test.ts` | 无此文件(见 Q1) |
  | `BL004-U-local-baseline` | `state/__tests__/localRegressionBaseline.test.ts` | 无此文件(见 Q4) |
- **判定**:非代码缺陷,但 QA 契约单源(TC.md)已与现实脱节,「11/11 通过」不能作为交付门禁的实质依据。
- **建议**:补齐缺失测试后回填 frontmatter 路径,或在 TC.md 记录替代覆盖的理由,使 `covers_ac` 绑定与文件一致。

### Q4 · Low · open · `BL004-U-local-baseline` 金标准差分基线未实现;本机零回归靠行为等价 + 套件 green 覆盖

- **位置**:`TC.md:120-125` 声明「RPC 调用序列(方法+参数+顺序)=== 金标准基线数组(0 新增 · 0 缺失)」。
  无 `localRegressionBaseline.test.ts`,无「金标准数组」断言。
- **缓释**:本机零回归**行为等价**已覆盖——`sessionEventsComposite.test.ts:93-190`「本机路径行为等价
  (AC-6/QA-15)」6 条逐条断言 updateTab/notification/homedir 序列不变;`deps`/`terminalLink*`/`workspaceCrud`
  等既有套件零改动仍绿(套件级门禁)。缺的是**显式可回归的金标准锚点**,替代覆盖可接受但弱于声明形态。
- **建议**:酌情补一条记录 forWorkspace('local')===单例 + RPC 序列快照的锚点;或降级 TC 声明。

### Q5 · Info · open · 全量 `npx vitest run` 有 1 条 FAIL,但非 BL-004 引入

- `src/host/__tests__/wsMultiClientIsolation.test.ts`「并发交错帧不串扰(T-046)」在全量并发跑时 FAIL
  (PTY echo 交错 timing),**该文件不在 BL-004 diff**,**单独跑 9/9 全绿**(`npx vitest run <file>` 通过)。
  → 判定为**既有并发 flake**,与本 Feature 无关。
- **影响**:AC-6「npm test 全绿」CI 门禁当前在全量跑下呈红。需**归因清楚**(非 BL-004 回归),
  BL-004 自身新增/触及的全部 test 均通过。建议把该 flake 单独挂账,避免误记到本 Feature。

---

## 作用域隔离守门断言复核(团队最高风险项)— 结论:真捕获,非形式

- **`workspaceSnapshotScope.test.ts`(store 集成)**:驱动真实 `applyWorkspaceSnapshot`(本机快照)与
  `setHostWorkspaces`(远程快照)。断言强度足:
  - 本机快照后远程 `r1/r2` 仍在(`toEqual(['l1','l2','r1','r2','l3'])`)+ hostId 保持 + 远程 active `r1`
    不被抢回 + `disposeTerminal` 未触远程 tab(`s1/s2`)。真断言「不删 + 不抢」。
  - 远程 `cfg-1` 快照(r2 删)只回收 `s2`,不触本机 `t1`/其它远程 `s3`,本机 active `l1` 不变。对称成立。
- **`workspaceSync.test.ts`(纯函数)**:独立 `describe('作用域隔离(scopeHostId)')` 7 条——域外原位透传、
  active 属域外不抢焦、per-host 只协调该机、新增合成 `hostId=scopeHostId`(非 local)、
  active 复位链(本机首个 → 数组首个 → null)。这是 R-3 的机制级钉死。
- 两层互补 = **真回归护栏**。这是本次实现最扎实的部分。

## 桩保真度复核 — 结论:忠实,无「绿测红产」(除 Q1 缺失门禁)

- 关键路径(create/serialize/scope/params)用**真实** `useAppStore` + 真实 `hostRegistry`/`WorkspaceService`,
  仅 mock `terminalRegistry.disposeTerminal`(为断 @xterm 浏览器 import 链 · 不影响被测行为)——合法。
- `remoteCreateScope.test.ts` 用真 `hostRegistry` + `vi.spyOn(hostClient,'rpc')`,证明 forHostId null → 拒绝、
  远程命中 → 落远程、本地零调用。高保真。
- 组件层 mock 的 `hostRegistry` 桩 `forWorkspace/forHostId` 形状与生产语义一致(local→单例 / 远程→该机 client)。
- 未发现忠实度问题会导致「桩绿而产品红」;唯一「绿而漏」是 Q1——但那是**门禁不存在**(空缺),
  不是桩说谎。

## AC↔test 覆盖(机读 vs 实质)

| AC | verify-ac 机读 | 实质 | 备注 |
|----|------|------|------|
| AC-1/10/8/11 | ✓ | ✓ 实质 | `SidebarMachineGroups.test.tsx` 行为覆盖(ID 标记缺但断言在) |
| AC-2 | ✓ | ✓ 实质 | 徽标 0 显式渲染 + 语义=本客户端 tab 数(`MachineWorkspaceRow.test.tsx`) |
| AC-3/4 | ✓ | ✓ 实质 | `AddWorkspaceRemoteDir.test.tsx` 真 store.addWorkspace 落远程 |
| AC-5 | ✓(10) | **部分形式** | route-terminal 实质;route-fs/git 接线在位但驱动弱;**grepgate 缺(Q1)** |
| AC-6 | ✓(9) | ✓ 实质(baseline 弱) | 复合键不串 + sessionEvents 等价实质;金标准锚点缺(Q4) |
| AC-7 | ✓ | ✓ 实质 | `hostRegistry.test.ts` 含 key-authority 双源消除 |
| AC-9 | ✓ | ✓ 实质 | 真 WorkspaceService + temp dir · 边界穷举 · 不落坏 · 不广播 |

## 结论

- **代码正确性**:迁移干净(手工门禁 CLEAN + tsc 绿),数据模型作用域隔离扎实,BL-004 触及的全部测试通过。
- **测试质量**:高风险项(E2/E3/E4/E5/复合键/params/D-7)= 真捕获回归。
- **门禁短板**:`BL004-U-grepgate`(P0 声明 · R-1 首要防线)整条缺失,加上 3 处 TC frontmatter 漂移,
  使 verify-ac 11/11 名不副实。
- **Verdict = NEEDS_REVISION**:必须补 Q1 门禁(廉价·封口 AC-5 静态穷举);建议同步对齐 TC.md 与实现(Q3)、
  酌情补 route-fs driving 测(Q2)/local 基线锚点(Q4);Q5 flake 归账澄清。
