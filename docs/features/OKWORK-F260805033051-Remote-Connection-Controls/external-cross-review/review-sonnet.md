---
review_model: sonnet
review_via: subagent
files_read:
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/external-review-prompts/review-subagent-review-20260805T101805Z.md
  - project-specs/KNOWLEDGE.md
  - project-specs/test-baseline.md
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/TC.md
  - docs/features/OKWORK-F260805033051-Remote-Connection-Controls/TECH.md
  - src/main/remote/__tests__/credentialStore.test.ts
  - src/main/remote/remoteHostIpc.ts
  - src/preload/preload.ts
  - src/renderer/components/MachineGroup.tsx
  - src/renderer/components/Sidebar.css
  - src/renderer/components/Sidebar.tsx
  - src/renderer/components/__tests__/MachineGroup.test.tsx
  - src/renderer/components/__tests__/SidebarMachineGroups.test.tsx
  - src/renderer/components/__tests__/SidebarReconnect.test.tsx
  - src/renderer/components/settings/RemoteHostsPage.tsx
  - src/renderer/components/settings/__tests__/RemoteHostsPage.test.tsx
  - src/renderer/state/remoteHostStore.ts
  - src/renderer/types.d.ts
  - src/shared/i18n.zh.ts
  - src/shared/remoteHost.ts
  - src/renderer/services/remoteWorkspaceSync.ts (partial · stopRemoteWorkspaceSync)
  - src/renderer/services/hostRegistry.ts (partial · drop/forWorkspace)
  - src/renderer/services/reconnectController.ts (partial · cancel)
  - src/main/remote/orchestrator.ts (partial · connect/disconnect/connectInflight)
target_commit: d1d75d9e30bcbf1bb6d0a618dfbd4273bf05dc66
coverage: [测试真实性与覆盖, 代码质量盲区(错误处理/日志/并发), a11y(自选方向)]
---

# 第三视角冷审(external-claude · sonnet · subagent)

## Coverage 申报

### 1. 测试真实性与覆盖

方法:不信任 TC.md 的覆盖率表面数字,逐一打开 `MachineGroup.test.tsx`(全文 374 行)、
`SidebarMachineGroups.test.tsx`(全文 371 行)、`SidebarReconnect.test.tsx`(全文 250 行)、
`RemoteHostsPage.test.tsx`(相关段落)通读断言内容,再用 `grep -rl` 对 `disconnectAwait` /
`aria-busy` / `sidebar-machine-ctl__busy` / `pendingDisconnectRef` / `onDisconnect` / `onCancel` /
`T-029` `T-030` `T-031` `T-037` `T-038` 在全 `src/**/*.test.ts(x)` 做穷举命中检查。

发现:本次 diff 的头号交付物——组头连接控件图标化 + 断开/取消按钮 + AC-13 忙碌态排队
(`Sidebar.tsx` 的 `handleDisconnectMachine`/`handleConnectMachine`/`pendingDisconnectRef`/
`settling`,`MachineGroup.tsx` 的 `onDisconnect`/`onCancel`/`busy` 渲染)——在整个测试树里
零命中(见 CR-1)。这与 `TECH.md` 自己的「完工自查」第 K 行结论**完全吻合**(dev 自己也读证到了
同一个零覆盖事实,并诚实标注「归 test stage · ❌ 欠账」)。因此我不把「测试未写」本身当作
新发现重复开单——按任务简报要求,这条已登记(TC.md 38 条 integration 用例欠账)。但我认为
**实际影响面比登记的更严重**,严重在:`TC.md` 的 YAML frontmatter 和 AC 覆盖表本身**没有
被同步订正**,仍然自称「✅」「覆盖率 15/15(100%)」「测试总数 38」,且给 T-038 编了具体的
`file:`/`function:` 字段——这在 `TECH.md` 已经写明「不是已完成项」之后依然成立,构成两份
一并提交的文档相互矛盾。见 CR-1。

另检查 `credentialStore.test.ts` 的 AC-3 IPC 通道白名单断言(`channelNames.sort()).toEqual([...].sort())`)
——这是真实的精确匹配断言(非空壳),`disconnectAwait` 被正确纳入,无问题。

### 2. 代码质量盲区(错误处理 / 日志可观测性 / 并发)

逐行读 `Sidebar.tsx`(全文 903 行)与 `RemoteHostsPage.tsx` 相关段落,交叉核对
`remoteHostStore.ts`(全文)、`orchestrator.ts`(connect/disconnect 段)、`hostRegistry.ts`、
`remoteWorkspaceSync.ts`、`reconnectController.ts` 的相关函数,验证本次新增的「弃用闸」与
「断开排队」两套状态机在跨组件场景下是否真的自洽。发现一个此前未被任何风险表(R1-R6)
覆盖的并发缺口:`pendingDisconnectRef` 是 `Sidebar` 组件内的 `useRef`,`RemoteHostsPage` 的
`handleConnect`/`handleDisconnect` 完全不知道它的存在,见 CR-2。另发现 `disconnectAwait`
的失败路径在 main/renderer 两端均无日志(CR-4,推断性质,当前代码路径下触发概率低但非零)。

### 3. a11y(自选方向)

选它的原因:本次 diff 专门为 `MachineCtlButton` 新增了 `aria-busy` + `title` + `aria-label`
三件套,且 `TECH.md`/`TC.md` 都明确讨论过「忙碌反馈要让人看得见」这件事(v0.3 自查发现
纯 `aria-busy` 在像素上和常态无区别,已经补了 spinner)——说明团队已经很认真地对待了**视觉**
反馈,但推理链条里有一个未被检验的假设：`aria-busy` 单独放在一个非 `aria-live` 区域的
`<button>` 上，对屏幕阅读器用户是否真的构成「反馈」。这是 checklist 候选里给的方向之一，
且没有被 TC.md/TECH.md 的任何一次自查覆盖过（两份文档只讨论了"看得见"，没讨论"听得见"）。
见 CR-5(标注推断边界)。

---

## Findings

### CR-1 | high | `docs/features/OKWORK-F260805033051-Remote-Connection-Controls/TC.md` frontmatter `tests:` (T-038 条目) + AC-9/AC-13 覆盖表 + `docs/.../TECH.md` §完工自查表格 K 行

**标题**:TC.md 仍然自称 AC-13/AC-9 核心机制「已测 · 100%覆盖」，但同一次提交里 TECH.md 自己的
逐行核验已经把这个结论推翻，两份文档未被相互订正，且 TC.md 的失实结论是**默认可见的那份**
（覆盖率表、✅ 标记），TECH.md 的更正埋在「完工自查」长表的第 K 行。

**证据**（均为直接读证，非转述）：
- `TC.md` frontmatter 明确给出 T-038 的 `file: src/renderer/components/__tests__/SidebarMachineGroups.test.tsx`
  与 `function: test_AC9_queued_connect_rechecks_abandoned_before_firing_ipc`，`covers_ac: ["AC-9","AC-13"]`，`priority: P0`。
  但我读了 `SidebarMachineGroups.test.tsx` 全文（371 行）：不存在该函数，不存在任何
  `settling`/`disconnectAwait`/`onDisconnect`/`onCancel` 相关断言；该文件的 `installOkwork()` mock
  （L94-102）里 `remoteHost` 对象根本没有 `disconnectAwait` 字段——如果真有用例点了断开钮，
  会在 `window.okwork.remoteHost.disconnectAwait({id})` 处直接 `TypeError`（这一点 `TECH.md` 的
  K 行自己也预判到了：「Sidebar 测试的 installOkwork 里没有 disconnectAwait mock，第一条点断开的
  用例会直接 TypeError」）。
- 全仓穷举：`grep -rln "disconnectAwait" src --include="*.test.ts" --include="*.test.tsx"` 零命中；
  `grep -rln "aria-busy\|ctl__busy\|pendingDisconnectRef" src/renderer --include="*.test.ts*"` 零命中；
  `T-029`/`T-030`/`T-031`/`T-037`/`T-038` 在测试文件里的所有命中都属于**其他里程碑**复用的编号
  （host token gate、WS RPC parity、orchestrator residency 等），没有一个是本 Feature 的 AC-13 用例。
  `TECH.md` 承诺「落新文件 `remoteHostStoreAbandonGate.test.ts`」（T-037）——该文件不存在。
- `TC.md` 表格行：`| AC-13 | ... | T-029, T-030, T-031, T-038 | ✅ |`、
  `覆盖率: 15 / 15（100%）· 测试总数 38`——这两处在本次 diff 里被**新写入/修改**（不是历史遗留未碰的行），
  且是 diff 范围内、AC-13/AC-9 这两行 P0 验收标准仅有的"是否已测"信号源。
- `TECH.md` 同一次提交的表格 K 行原话："**不是已完成项，review 勿据本表判为已覆盖**...
  闸 4（AC-9）与 AC-13 排队全仓零用例（`aria-busy` 在 `*.test.ts*` 零命中）"——与我独立复核的结论
  逐字吻合，证明 TECH.md 的更正是准确的；但这份准确的更正**没有反向同步回 TC.md**，
  TC.md 仍然保留着失实的 ✅/100%。

**失败时序**：一个只看 TC.md（该项目最常被检索的"这条 AC 测了吗"入口，而非要在长达数百行的
TECH.md 完工自查表里翻到第 K 行）的后续开发者/评审者，会认为 AC-13（P0）与 AC-9 的排队复查分支
已经有 P0 集成测试兜底。若之后有人重构 `handleConnectMachine`（例如误删 `Sidebar.tsx:563` 那行
`isAbandoned` 复查——TC.md 自己的 v0.4 变更记录写明"删掉那行守卫其余 37 条全绿"），CI 会保持全绿，
真实回归（用户断开又立刻改主意再断开，界面显示已断开但后台仍会建隧道连上）不会被任何自动化捕获，
只能靠人工在生产环境撞见。

**建议**：在 TC.md 的 T-029/T-030/T-031/T-037/T-038 五条 frontmatter 与 AC-9/AC-13 覆盖表行上
补一个与 TECH.md K 行一致的「⚠️ 未实装·test stage 欠账」标记（哪怕只是去掉 ✅ 改成 🚧，覆盖率数字
拆成"设计 15/15·实装 X/15"），避免两份并交的文档口径不一致；`remoteHostsPageNonce.test.ts`（主仓
未跟踪文件，经查是上个里程碑 `0fa8e29` 遗留，非本 Feature 产出）不构成免责证据。

---

### CR-2 | high | `src/renderer/components/Sidebar.tsx:188,552-566,578-596` vs `src/renderer/components/settings/RemoteHostsPage.tsx:320-324,334-340`

**标题**:AC-13 的"断开在途时连接请求排队"保护是 `Sidebar` 组件私有状态，`RemoteHostsPage`
（常驻挂载的 Sidebar 之上可同时打开的设置弹层）完全不知情，跨这两个入口操作同一台机器时，
AC-13 要消灭的"点了没反应"症状原样复现。

**证据**：
- `Sidebar.tsx:188`：`const pendingDisconnectRef = useRef<Map<string, Promise<void>>>(new Map());`
  ——组件实例私有的 `useRef`，不经 `useRemoteHostRuntimeStore`（全局共享 store）暴露。
- `Sidebar.tsx:578-596` `handleDisconnectMachine`：调用 `window.okwork.remoteHost.disconnectAwait({id})`，
  把返回的 promise 存进上面这个私有 `pendingDisconnectRef`。
- `Sidebar.tsx:552-566` `handleConnectMachine`：只查**自己这个 ref**里有没有 `pending`，
  没有就立即发 `connect`；这正是它能防"点了没反应"的机制，但保护范围仅限于"由同一个
  Sidebar 实例发起断开、又由同一个 Sidebar 实例发起重连"这一条路径。
- `RemoteHostsPage.tsx:320-324` `handleConnect`：`resume(config.id)` 后直接
  `window.okwork.remoteHost.connect({id: config.id})`，未查询任何"是否有断开在途"的信号——
  它甚至不知道 `pendingDisconnectRef`/`disconnectAwait` 这两个概念的存在。
- `RemoteHostsPage.tsx:334-340` `handleDisconnect`：走的是旧 `window.okwork.remoteHost.disconnect({id})`
  （`ipcRenderer.send`，即发即忘，`preload.ts` 印证），**不产生任何 Sidebar 可以感知的 promise**。
- `orchestrator.ts:414-421`：`disconnect()` 内部 `await Promise.race([pending.catch(()=>undefined), sleep(DISCONNECT_WAIT_TIMEOUT_MS=5000)])`——即无论走哪个 IPC 通道触发，main 侧这次拆除都可能耗时到 5 秒量级，这是两个入口共享的、真实存在的竞态窗口。

**失败时序**：用户在侧栏点击某远程机的断开图标钮（`handleDisconnectMachine` 触发，main 侧
`orchestrator.disconnect` 进入内部最长 5s 的等待/收尾）。在这 5 秒窗口内，用户打开「远程机」
设置页（Sidebar 依旧挂载，`RemoteHostsPage` 只是叠加渲染），因为共享的 `runtimeMap`/`abandoned`
已被 `clearRuntime`/`abandon` 同步清空，设置页此时显示的也是"未连接·可连接"状态——用户点击
设置页的「连接」按钮，`RemoteHostsPage.handleConnect` 立即发出 `connect({id})`，落在
main 侧仍在收尾上一次 `disconnect` 的同一个 `configId` 上。根据 `Sidebar.tsx:541-543` 注释里
开发者自己对这个主进程行为的描述："直接发会命中主进程 connect 的在途去重（返回那条正在被拆掉的
promise），结果是无事发生、也无任何事件回来"——即用户点击连接后，没有 toast、没有状态变化、
没有任何反馈，这正是 AC-13 这整个里程碑要消灭的原始症状，只是换了个从设置页触发的路径复现。

**建议**：把"是否有断开在途"的信号从 `Sidebar` 组件私有 `useRef` 提升为
`useRemoteHostRuntimeStore` 里已有的 `settling` 状态可查询的量（例如让
`RemoteHostsPage.handleConnect` 在发 `connect` 前也检查 `store.settling[id]`，必要时复用/移植
`Sidebar` 的排队逻辑）；或者至少在 `RemoteHostsPage` 的连接按钮上依据 `settling` 禁用/提示，
避免在已知竞态窗口内发出注定被吞掉的 IPC。

---

### CR-3 | low | `src/renderer/components/Sidebar.tsx:586-594`

**标题**:若 `handleDisconnectMachine` 在同一 `configId` 上被连续调用两次（第二次发生在第一次
`disconnectAwait` 尚未 resolve 时），先完成的那次 `.finally()` 会无条件把 `settling` 清为
`false`，掩盖第二次仍在途的忙碌状态。

**证据**：
```
586	    const p = window.okwork.remoteHost
587	      .disconnectAwait({ id })
588	      .catch(() => undefined)
589	      .finally(() => {
590	        setSettlingMachine(id, false);
591	        if (pendingDisconnectRef.current.get(id) === p) {
592	          pendingDisconnectRef.current.delete(id);
593	        }
594	      });
595	    pendingDisconnectRef.set(id, p);
```
`pendingDisconnectRef` 的清理有 `=== p` 守卫（防止被更新的 promise 覆盖后误删），但
`setSettlingMachine(id, false)`（第 590 行）**没有等价的守卫**——不管是不是"当前生效"的那次
`disconnectAwait`，只要它 resolve/reject 了就会把 settling 清空。

**失败时序**：需要 `handleDisconnectMachine(id)` 在第一次 `disconnectAwait` 完成前被第二次调用
（例如极快速的双击落在 React 尚未把按钮从"断开/取消"重渲染为"连接"之前的同一 tick 内，
或未来新增的调用路径）。此时：click1 → `setSettling(true)`，`disconnectAwait` → p1；
click2（p1 未 resolve）→ 各步骤重复执行，`disconnectAwait` → p2 覆盖 `pendingDisconnectRef`；
p1 先 resolve → 其 `.finally` 把 `settling` 置回 `false`（尽管 p2 仍在途）→ 连接钮的忙碌 spinner
提前消失，视觉上暗示"断开已完成"，而 p2 代表的那次断开其实还没收尾。由于本组件当前的渲染规则下，
点击断开会在**同一 tick 内**同步把可见控件切换为"连接"钮（`clearRuntime` 是四步同步序列的一部分），
实测触发窗口非常窄（需要两次物理点击命中同一个 DOM 节点、且都发生在 React 完成该次状态更新的重渲染
之前），我没有找到当前 UI 下一条稳定可达的双击路径，因此定为 low 而非 high；但这是一个真实存在的
逻辑漏洞，一旦未来任何新代码路径重复调用 `handleDisconnectMachine`（例如键盘快捷键、批量操作），
就会现形。

**建议**：给 `setSettlingMachine(id, false)` 加上与 `pendingDisconnectRef` 相同的
"仅当我是当前生效的那次 promise" 守卫。

---

### CR-4 | info | `src/main/remote/remoteHostIpc.ts:110-113` + `src/renderer/components/Sidebar.tsx:586-588`

**标题**:`disconnectAwait` 的失败路径在 main 与 renderer 两端都没有任何日志，一旦未来
`orchestrator.disconnect` 引入真实的拒绝路径，用户报告的"断开卡住"类问题将完全没有排查线索。

**证据**：
```
main:  ipcMain.handle(REMOTE_HOST_CHANNELS.disconnectAwait, (_event, payload) => {
         return orchestrator.disconnect(payload.id);   // 无 try/catch,无日志
       });
renderer: .disconnectAwait({ id }).catch(() => undefined)   // 静默吞掉,无 console.error/日志
```
我读了 `orchestrator.ts:414-449` 的 `disconnect()` 实现：当前所有内部 `await` 均已各自
`.catch(() => undefined)` 包裹，方法本身目前不会 reject（这点是直接读证的事实，非推断）。
因此**当前**这个吞异常分支基本是死代码路径，真实风险等级低；但这纯属实现细节巧合，
不是接口契约——`disconnectAwait` 在 preload/types.d.ts 里对外声明为 `Promise<void>`
（可以 reject），调用方已经写了 `.catch`，说明作者也预期它可能失败，只是没有配套日志。

**失败时序（推断，非当前可复现）**：未来任何一次对 `orchestrator.disconnect` 的重构
（例如把某个内部 `await` 的 `.catch(() => undefined)` 漏掉，或新增一个会同步 throw 的分支）
引入真实拒绝后，用户点击断开卡住/UI 行为异常时，开发者翻遍 renderer devtools 与 main 进程日志
都找不到任何一行与这次失败相关的输出，只能靠复现。

**建议**：在两端的 `.catch`/handler 里补一行 `console.warn`/项目既有日志通道，带上 `configId`，
成本很低，为未来的契约变化留一个安全网。

---

### CR-5 | low | `src/renderer/components/MachineGroup.tsx:215-242`（`MachineCtlButton`)· 推断部分见下

**标题**:AC-13 忙碌态的反馈通路只覆盖了"看得见"，没有覆盖"听得见"——`aria-busy` 单独挂在一个
普通 `<button>` 上（无 `aria-live` 包裹、`aria-label` 按设计刻意保持"连接"不变），对屏幕阅读器
用户构成的实际反馈可能和视觉修复之前一样是"零变化"。

**证据（代码事实，直接读证）**：
```
229	    <button
230	      className={`sidebar-machine-ctl sidebar-machine-ctl--${variant}`}
231	      title={busy ? t('Disconnecting…') : label}
232	      aria-label={label}                    // busy 时依然是「连接」，未变
233	      aria-busy={busy || undefined}
234	      onClick={...}
235	    >
236	      {busy ? <span className="sidebar-machine-ctl__busy" aria-hidden="true" /> : icon}
237	    </button>
```
spinner 本身标了 `aria-hidden="true"`（第 236/239 行，两处引用同一渲染分支，行号见组件全文
215-242），也就是说 busy 态下这个按钮暴露给可访问性树的信息只有：`aria-label="Connect"`
不变 + `aria-busy="true"`。没有 `aria-live` 区域、没有 `aria-describedby`、`title` 属性在
`aria-label` 存在时不参与可访问名计算（仅部分浏览器/AT 组合会把它当 tooltip 弱提示）。

**推断部分（未用真实读屏软件验证，明确标注）**：`aria-busy` 按 WAI-ARIA 规范的主要设计目标是
配合 `aria-live` 区域使用（"内容正在更新，AT 可以选择等更新完再播报"），对一个**非 live region
的交互控件**，主流屏幕阅读器（NVDA/JAWS/VoiceOver）是否会把 `aria-busy` 的翻转朗读为一次可感知的
状态变化，我没有用真实 AT 逐一验证，只能作为已知的 a11y 实践经验提出，标注为推断。

**为什么值得一提**：`TECH.md`/`TC.md` 两份文档都专门为这个忙碌反馈补过一轮修复（v0.3 发现纯
`aria-busy` 在**像素**上和常态没区别，补了 spinner），修复理由原话是"忙碌是主动反馈，不该等
hover 才现形"——这个论证链条里隐含的假设是"`aria-busy` 那部分反馈本身对读屏用户是够用的，
缺的只是视觉那半"。我没有在两份文档的任何一处自查表格里看到"读屏用户能否感知 busy 态"被单独
验证过；如果上面的推断成立，实际状态是"视觉用户现在有反馈，读屏用户可能仍然没有"，
和 v0.3 修复之前"两类用户都没反馈"相比只解决了一半人群。

**建议**：补一个视觉隐藏的 `aria-live="polite"` 状态节点（在 settling 切真/切假时更新文本，
例如"正在断开，请稍候"/清空），或验证目标 AT 组合是否确实会播报 `aria-busy` 的变化，
二选一其一即可关闭这条。

---

## 已核查、未发现问题的项(按要求申报"查了什么")

- `credentialStore.test.ts` AC-3 IPC 通道白名单：`Object.keys(REMOTE_HOST_CHANNELS).sort()` 与
  硬编码数组精确匹配，非空壳断言，`disconnectAwait` 被正确纳入。
- `hostRegistry.drop()`（`get + dispose?.() + delete`）与 `stopRemoteWorkspaceSync()`
  （`teardownListeners + dropHostWorkspaces + hostRegistry.drop`）均为幂等实现，
  `handleDisconnectMachine` 内即使被重复调用也不会因重复 drop/teardown 本身崩溃或抛错
  （CR-3 的问题出在 `settling` 标记，不是这两个函数本身）。
- `i18n.zh.ts`：本次复用的按钮文案（Connect/Disconnect/Cancel/Reconnect/Retry now）在改动前
  已存在于字典；新增的两条（`Failed to connect to {alias}: {reason}` / `Disconnecting…`）
  均已补齐中文译文，未发现缺译。
- 重复点击处于 `settling` 态的"连接"图标钮会排队出多个 `Promise.race(...).then(...)` 链，
  理论上可能在 `pending` resolve 时并发发出多条 `connect({id})`；但读了
  `orchestrator.ts:322,376-409` 的 `connectInflight` 去重机制后确认 main 侧对同一 `configId`
  的并发 `connect()` 天然去重，这条路径最多造成几条冗余 IPC，不构成正确性问题，未单独列为 finding。
- `KNOWLEDGE.md GO-037` / `TECH.md R5`（`deploying` 阶段取消可能留远端锁，下次连接最长等 120s）：
  文档自称"代码读证 · 未实测"，我读了 `orchestrator.ts:414-421` 的 5 秒等待/强收尾模式，
  与该条目描述的机制一致，未发现与代码矛盾之处；`deploy.ts`/`mkdirLock.ts` 本身不在本次 diff 改动
  范围内，我没有去读，无法对其具体行号做二次读证，仅确认与已读到的 orchestrator 行为不冲突。
  该项已登记（用户 D-7 已拍板接受），不重开。
- R6（设置页 `handleDisconnect` 不走 `stopRemoteWorkspaceSync`，AC-12 仅侧栏入口成立）：
  读了 `RemoteHostsPage.tsx:334-340`，确认它确实只调用 `hostRegistry.drop(id)`，未调用
  `stopRemoteWorkspaceSync`/`dropHostWorkspaces`/`teardownListeners`，与登记描述一致，
  未发现比已记录更严重的后果，不重开。

## 我没能验证的项

- CR-5 的核心论断（`aria-busy` 在无 `aria-live` 包裹时是否被主流 AT 播报）未用真实屏幕阅读器验证，
  已在该 finding 内明确标注为推断。
- 未独立重跑测试套件（任务简报已给出 dev 的实跑证据：1724 passed/0 failed/6 skipped，
  typecheck 干净，SMOKE_OK），本审仅静态读代码与测试源码。
- `orchestrator.ts` 中 `closeSessionTransport`/`safeEmit` 等被 `disconnect()` 调用的内部函数未逐行走查，
  CR-4 里"当前不会 reject"的结论建立在我读到的 414-449 行范围内所有 `await` 均已 `.catch` 包裹这一
  事实上，未反向证明这些内部函数自身不含未捕获的同步 throw。
- `deploy.ts`/`mkdirLock.ts`（GO-037 涉及的具体文件）未读，仅确认与已读的 orchestrator 行为一致，
  不构成独立读证。

## Verdict

**NEEDS_REVISION**

理由：两条 high 级发现都指向同一件事——AC-13/AC-9 这两条 P0 验收标准，其"排队/复查弃用标记"
机制目前既没有自动化测试兜底（CR-1，且相关文档口径不一致，容易被后续维护者误判为已覆盖），
又存在一条尚未被任何风险表登记、真实可达的跨入口竞态会让同一症状复现（CR-2）。两者叠加意味着
这个刚刚宣称"消灭点了没反应"的里程碑，在"设置页 + 侧栏同时使用"这个完全正常的用户行为模式下，
没有代码防护，也没有测试会在未来的重构中报警。建议在合入前至少让 CR-2 有一个明确的处理决定
（修复或书面记录为已知风险交 PM 定夺，参照 R6 的处理方式），并推动 TC.md 与 TECH.md 的覆盖率口径
对齐（CR-1）。CR-3/CR-4/CR-5 不阻塞合入,可作为后续小改进登记。
