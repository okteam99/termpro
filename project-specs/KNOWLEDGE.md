# 项目本地知识库

> 本文件记录开发中积累的 **OkWork 项目特有事实 / 踩坑 / 用户偏好**（AI 沉淀）。
> 不记录:开发规矩/约定(走 DEV-RULES.md)、决策(走 ADR)、通用规范(走 standards/rules)、术语(走 GLOSSARY.md)、复盘(走 retros/)。
> Teamwork 在 triage(用户输入承接阶段)会扫描本文件,注入「📚 相关项目事实」段。

> 📌 **术语 → `GLOSSARY.md`**;**开发规矩/约定 → `DEV-RULES.md`**。本文件不再收录这两类。

---

## 🛡️ 复发防御清单(dev 起草前必读 · shift-left)

> **不是通用最佳实践,是本项目 code review 反复抓到的同几类**。写代码时**主动规避**,不是写完等 review 抓 ——
> 被预防掉的 finding 永远不需要多轮收敛。
> 本清单起于 `OKWORK-F260805033051`(一轮 review 出 1 BLOCKER + 3 MAJOR,**全部集中在异步编排的收口**)。
> 本项目大量代码是 renderer ↔ main ↔ 远程 host 的跨进程异步编排,下面每一条都在这个语境下反复咬人。

| # | 写的时候问自己 | 反例(真出过) |
|---|---|---|
| RD-1 | **跨 await 边界排队时,"意图"和"闸门"是同一个变量吗?** 是 → 拆开。一个布尔同时扛「拒收上一代残余」和「接受下一代意图」必然出错 | `resume` 放在排队**前**,闸全开而 IPC 还没发 → 被取消那次编排的残余事件把连接真做成,组头变绿(AC-6 逐字失败) |
| RD-2 | **in-flight 去重槽(Set/Map)在"取消/作废"路径上有出口吗?** 只有 `.finally` 一个出口 = 那条 promise 永不落定时槽位永久泄漏 | 握手去重槽只在 `.finally` 释放;ws 卡在 upgrade → 新隧道的握手被自己的去重挡在门外,组头绿灯而终端全哑 |
| RD-3 | **promise 闭包里 `new` 出来的资源(ws / timer / 子进程),实例上持引用了吗?** teardown 够不着闭包里的东西 | `connectViaWebSocket` 的 ws 只活在闭包,`this.transport` 要到 `onopen` 才设 → dispose 落在「已 new 未 open」窗口时关不掉它 → 孤儿 ws + 心跳 |
| RD-4 | **teardown 是"按 key 查表"还是"对捕获到的那个实例"?** 按 key 有两种失灵:key 已被更早的清理删掉(no-op,该关的没人关)、表里已换新一代实例(误杀) | 闸③收尾 `hostRegistry.drop(configId)`,而该 id 早被 `stopRemoteWorkspaceSync` 删了 → no-op |
| RD-5 | **这个不变式是 machine/session 级的,却放进了组件私有 `useRef` 吗?** 多入口(侧栏 + 设置页可同时挂载)时,一个入口建立的不变式对另一个入口**不存在** | 断开在途表放在 Sidebar 的 ref 里,设置页看不见 → 直接发 connect 撞主进程在途去重 =「点了没反应」换个入口原样复现 |
| RD-6 | **存进共享表、会被别人 `race`/`await` 的 promise,是已 `.catch` 的那条吗?** 裸 promise 一旦 reject,下游的 `.then` 整条不执行 | `pendingDisconnects` 存了裸 promise → reject 时排队的连接意图永久卡死 + 未处理 rejection |
| RD-7 | **"有反馈"是给眼睛的还是只给读屏的?** `aria-busy` / `aria-live` 不产生任何像素 | 忙碌态只写 `aria-busy`,截图与常态**像素级相同** —— 用户点了 5 秒看不到任何变化,正是该 AC 明令禁止的症状 |
| RD-8 | **同构分支复制了几份?** 每多一份,下一个新增的不变式就要记得在每一处各写一遍 —— 本 Feature 因此栽了**两次**(握手实现两份 / 三个只差 label 的按钮分支) | 设置页有独立的一份 `beginHandshake`,只给侧栏设闸 → 设置页留一条无人管理的活连接 |

### 🧪 测试工装类(写测试时防 · 这几条的共同特征是「长得像通过」)

> 起于同一个 Feature 的 test stage:38 条新用例的红从 14→12→8→5→1,**没有一条是产品缺陷**,
> 全是下面这几类。它们比产品 bug 更危险 —— 产品 bug 会红,这些会**绿**。

| # | 写的时候问自己 | 反例(真出过) |
|---|---|---|
| RD-9 | **拿不到测试前置条件时,用例是失败还是静默跳过?** `if (x) { ...断言... }` 形态 = 拿不到就跳过,报绿但零验证 | 9 条用例没接住 `installOkwork()` 返回值,`emitEvent` 恒 undefined,全被 `if` 跳过 —— 它们「通过」了几轮才被发现 |
| RD-10 | **等待写法依赖 promise 链的深度吗?** 数 `await Promise.resolve()` 次数 = 押注实现细节,生产代码加一层就红 | 生产代码把表里存的从裸 promise 换成 `.catch().finally()` 后的链,链深 +2,一批用例当场红 |
| RD-11 | **正向断言用轮询,负向断言用固定 flush** —— `waitFor(() => expect(x).not.toHaveBeenCalled())` **第一次轮询就通过**,什么都没等到;而给「等一件事发生」用固定 flush 又会因链深变化而脆 | 断言「排队的 connect 不得发出」写进 waitFor,实际什么都没证明。正解:先等一个**正向**信号(如 settling 被清)证明链条走完,再断言「没发」 |
| RD-12 | **fake timers 与轮询 API 不能共存**:`vi.waitFor` / `findBy*` 靠**真实定时器**轮询,假时钟一开就永远等不到 → 卡满超时。要推进时间就用 `advanceTimersByTimeAsync`(它同时 flush 微任务),且同一用例里一个 waitFor 都不留 | 9 条用例 20s 超时,症状看起来像死锁,实际是工装互锁 |
| RD-13 | **mock 与模块级状态跨用例存活吗?** 症状极具欺骗性:看起来像**生产代码不干活** | ① `vi.mock` 工厂里的实例缓存:前一条把 `reconnect` 改成 reject,后一条的握手静默走 `.catch`,表现为「`onReconnected` 不被调用」;② 模块级容器(非 zustand state)`setState` 清不掉,表现为「事件被闸吞掉」。两者都要在 `beforeEach` 显式重置 |
| RD-14 | **改测试让红变绿之前,先问「是不是断言编码了已被推翻的旧语义」** | AC-14 断言「点连接即解除弃用」,而那正是 review 的 BLOCKER 修掉的行为 —— 照着它「修绿」的最省事走法就是**把生产代码改回旧行为**,等于悄悄退回修复 |
| RD-15 | **安全承诺是否先对照了实际 OS principal 与已有 FS/PTY 能力?** `main-only`/capability/`0600` 只说明接口和跨 UID 边界；同一 SSH 用户若已有任意文件与 shell 能力，就不能再承诺阻止该主体读取或解密 | BL-007 初稿把 ordinary renderer 的专用 RPC 隔离误写成能隔离同 SSH UID 的通用 Host token/终端 Agent；review 逐条走生产 FS/PTY 路径后发现物理权限模型与 AC 自相矛盾，最终按 WS-02 回归真实信任边界 |
| RD-16 | **远端目标的 `ready` 是否和当前连接代的协议兼容性一起进入“可选 + 可提交”条件?** 只在 main 最终提交时拒绝会把确定性不兼容暴露成用户点 Continue 后才失败 | BL-007 迁移选择器最初只看 Host stage；review 发现旧 bundle 仍可选择，修为 generation-scoped `describe` 缓存/失效、renderer 禁用与 main 签计划前复验 |

📌 **判据来源**:RD-1..RD-8、RD-15..RD-16 每条对应相关 Feature `REVIEW.md` 的 confirmed finding；RD-9..RD-14 对应 `TEST-REPORT.md §6` 的测试自身缺陷登记(均含失败时序与实证)。
📌 **清单会长**:同类第 2 次被抓即入;**已在清单里还复发 = 规避法不够硬,该强化那一条**,而不是再记一遍。

---

## 🔀 Flagged Ambiguities(已澄清的歧义)

> 评审循环中暴露"用户用 X 词同时指 A 和 B"时,澄清完后**实时**记录到此。
> 防止下个 Feature 来同样的词又得 PMO 重新询问澄清一次。

| ID | 模糊词 | 澄清结论 | 触发 Feature | 时间 |
|----|--------|---------|-------------|------|
| FA-001 | "Root / WorkTree" | Root = tab 首次进入时锁定的主目录(不随 cd 漂移);WorkTree = 用户显式选绑的 worktree 根(从 `git worktree list` 选)。两者均与**单个 tab** 绑定持久化,不是全局 | M2 | 2026-06 |

---

## ⚠️ Gotchas(陷阱 / 约束 / 历史坑)

> 项目特有的陷阱、历史踩坑、外部系统的怪癖。**不是决策**——是被动发现的客观约束。

| ID | 主题 | 描述 | 规避方法 | 发现时间 | 触发 Feature |
|----|------|------|---------|---------|-------------|
| GO-001 | pty | node-pty 是原生模块,**Electron 升级即需重编** | 走 forge 标准流程(`npm start` / `make`),`rebuild` 配置自动处理 | README | M1 |
| GO-002 | render | **WebGL context 每页有上限**;后台 tab 持有 context 会超限 | 仅挂载可见 tab 的 `WebglAddon`;切走时卸载 context,保留 Terminal 实例与 buffer | README §六 | M1 |
| GO-003 | ipc | **沙箱 preload 无 `process.env`**;冒烟开关无法直接读 | main 通过 `additionalArguments: ['--okwork-smoke']` 传入,preload 读 `process.argv` | DEV.md §5 | M1 |
| GO-004 | ipc | **MessagePort 必须经 `window.postMessage` 转移**;contextBridge 不能直接传 port | 见 `preload.ts`:`event.sender.postMessage → window.postMessage(ports)` (Electron 官方模式) | DEV.md §4.6 | M1 |
| GO-005 | pty | **PTY → UI 必须做流控**(watermark + pause/resume);否则 agent 倾倒 build 日志时内存与帧率一起崩 | highWatermark=512 KB / lowWatermark=128 KB;FLOW 常量在 `src/shared/protocol.ts`;本地/远程共用同一机制 | README §六 | M1 |
| GO-006 | render | **terminalRegistry 跨 React 挂载存活**;组件卸载不销毁 Terminal 实例 | 切 tab/workspace 复用同一 xterm.js 实例;仅 `disposeTerminal(tabId)` 才真销毁,否则 scrollback/连接中断 | DEV.md §4.4 | M1 |
| GO-007 | persist | **持久化必须先 hydrate 后订阅**;否则初始空状态覆盖存档 | `initPersistence()` 按序:storeGet → hydrate → 设 `hydrated=true` → 再启动 Zustand 订阅;UI 以 `hydrated` flag 门控渲染 | DEV.md §4.5 | M1 |
| GO-008 | ipc | `PROTOCOL_VERSION = 1`;M5 远程接入时需做**版本握手校验** | 版本号定义在 `src/shared/protocol.ts`;接入时需在握手阶段校验双端版本 | DEV.md §5 | M5 |
| GO-009 | shell | **shell integration 仅 zsh**;bash/fish 待后续 | spawn zsh 时经 ZDOTDIR 包装自动注入 OSC 133/7;`OKWORK_NO_SHELL_INTEGRATION=1` 可关闭 | DEV.md §5 | M3 |
| GO-010 | shell | **p10k instant prompt 兼容**:.zshrc 末尾注入 OSC 序列可能触发"console output during init"提示 | 与 VS Code 同模式,无功能影响;用户知情即可,无需修复 | DEV.md §5 | M3 |
| GO-011 | filepanel | **查看器保存无 mtime 守卫**;文件被外部修改后保存会直接覆盖 | 跟进项:读时记 mtime,写时校验;当前轻编辑场景已接受此风险 | DEV.md §5 | M4 |
| GO-012 | notify | **UI 完全关闭期间收不到系统通知** | M1-M4 靠重连对账兜底;推送通道留 M5 后 | DEV.md §5 | M3 |
| GO-013 | filepanel | **FilePanel 编排遗留 P2**(opus 评审 2026-06,均与重构前等价或更优):① refresh/lockRoot 后 resolveDone 冗余二拉 git.status(seq 闸自纠正);② childDone 无 seq,懒拉与 partial 重拉并发时 last-writer-wins;③ dispose/watchReady 同 tick 边界无专测 | 暂接受;单 reducer 三道过期闸(resolveDone 按 generation、树/着色按 root、top/status 按单调 seq)已覆盖主路径 | DEV.md §5 | v0.3 |
| GO-014 | notify | **「可能在等输入」静默判据勿用「quiet 到达时刻 − 去激活时刻」时间差推断**:host `tick`(~1.5s)抖动 + 传输延迟 + host/renderer 时钟不同源 → 同时产生漏报/误报(评审 ARCH-1 证伪) | 用渲染层**同源时间戳** `lastOutputAt > deactivatedAt` 直接比较(`src/renderer/services/quietGate.ts`)· 两值均取 renderer `Date.now()` | 2026-06 | OKWORK-F260613041948-quiet-notify |
| GO-015 | build | **teamwork worktree 跑无头冒烟报 `Cannot find the package "electron"`**:worktree 默认无 `node_modules`,electron-forge 在 worktree 根找 `node_modules/electron` 失败(找到 lock 文件即停,不向上回退主仓)· tsc/vitest 不受影响(Node 向上解析能命中主仓 node_modules)。**例外:host 子进程类测试也受影响**——`hostSubprocessHarness` spawn 的 host.cjs 落在系统临时目录,靠 `NODE_PATH=<worktree>/node_modules` 解析 external 依赖(node-pty 等),worktree 无 node_modules → 子进程 loader 崩(表象是 `portFile.test.ts` 全员 waitForStdout 超时,B260710093647 实证) | 在 worktree 内软链(node_modules 已 gitignored · ship 删 worktree 时随之清除):`ln -sfn <主仓>/node_modules/electron node_modules/electron`(冒烟)+ `ln -sfn <主仓>/node_modules/node-pty node_modules/node-pty`(host 子进程测试;bufferutil/utf-8-validate 若存在同理) | 2026-06/2026-07 | OKWORK-F260613152432 + OKWORK-B260710093647 |
| GO-016 | notify | **通知有两套互不联动的"已读"状态**:源 A `notifications[].read`(顶部 🔔 角标读它 · `Sidebar.tsx`)/ 源 B tab `waiting`·`unseenDone`(状态点 / 工作区 attention pill / Dock 角标)。后台事件同时写两套;**任何"使 tab 可见 = 查看"的入口必须同步两套**,否则角标残留(setActiveTab、setActiveWorkspace 各漏一处即本 bug) | 新增/修改任何"查看 tab"入口一律走 `markTabViewed(workspaceId, tabId)`(`store.ts` · 清源 B + 按 tabId 标源 A 已读) | 2026-06 | OKWORK-B260614065346 |
| GO-017 | test | **renderer store 单测会经 `terminalRegistry` 拉入 `@xterm/*`**(vitest 默认 node env 无 DOM · import 链易崩) | 测试顶部 `vi.mock('../../terminal/terminalRegistry', () => ({ disposeTerminal: () => {} }))` 断链,再 `useAppStore.setState/getState` 直驱 store action(见 `notificationBadge.test.ts`) | 2026-06 | OKWORK-B260614065346 |
| GO-018 | terminal/links | **OSC 8 超链接(程序用转义序列内嵌 URI 的可点链接)由 xterm 核心 `OscLinkProvider` 处理 · 优先级高于自定义 `registerLinkProvider`**(注册下标小者胜 · 核心 provider 下标 0)· 故自定义 `SystemWebLinkProvider` 拦不住 OSC 8 链接;未设 `linkHandler` 时 OSC 链接落核心 `defaultActivate` → `confirm('could be dangerous')` + `window.open()` 弹框 | 控制 OSC 8 链接打开行为必须设 `Terminal({ linkHandler })`(`activate` 路由到 `window.okwork.openExternal`)· `allowNonHttpProtocols` 默认 false 已把 URI 限制在 http/https(与 main `shell:open-external` 的 `^https?` 守卫一致)· 纯文本链接仍归 `SystemWebLinkProvider` | 2026-06 | OKWORK-B260614085337 |
| GO-019 | lifecycle | **Electron `before-quit` 不是"用户主动退出"专属入口**;系统 logout/shutdown 与已确认退出/安装也会走这里,在此 `preventDefault()` 弹确认会阻塞 OS 退出或造成二次确认 | 用户 App Quit 只从菜单/Cmd+Q 显式入口发起确认;`before-quit` 仅标记 quitting 放行;安装确认前用专用 lifecycle helper 标记 `quitAndInstall()` 可绕过二次确认 | 2026-06 | OKWORK-F260614081920-Close-Install-Confirmation |
| GO-020 | render | **WebGL 字形图集分页超上限触发合并/删页(`_mergePages`/`_deletePage`)会重排所有字形的 `texturePage` 索引**,但已绘制单元格 `a_texpage`/纹理坐标不会自动同步;合并 fire `onRemoveTextureAtlasCanvas` 却**不调度新帧** → 大量不同 CJK 字形撑爆图集后采样错误纹理页 → 错位/串字乱码(**与 DPR 无关** · 故只清 DPR 的 0847660 治不了 · 区别 GO-002 的 context 数量上限) | 创建 `WebglAddon` 后订阅 `onRemoveTextureAtlasCanvas`+`onChangeTextureAtlas`,微任务去抖触发 `term.refresh(0, rows-1)` 整屏重绘让索引对齐重排后的图集(`src/renderer/terminal/webglAtlasResync.ts`)· **不订阅 `onAdd`**(增页不重排既有索引);真实复现需 CJK 字形撑过 ~16 图集页(`e2e/atlas-resync.e2e.cjs`) | 2026-06 | OKWORK-B260615152207 |
| GO-021 | state/hydrate | **renderer 对 Host 权威数据(workspace.list)做 v2 hydrate 时,「RPC 读失败」≠「权威真空」**:读失败若被当空注册表,孤儿丢弃逻辑会清空全部视图态,且 hydrate 后的防抖写回会把空态固化落盘(不可逆丢 tab/面板/排序) | 权威读结果用 `null`(失败)区分 `[]`(真空);失败路径不 hydrate、不启动写回订阅(finishHydrate 模式:订阅只在成功路径启动)+ 有限重试;见 `src/renderer/state/persistence.ts` | 2026-07 | OKWORK-F260709092258 |
| GO-022 | fs.watch/test | **macOS fs.watch(FSEvents)流异步启动存在死窗口**:调用返回 ≠ 流已在接收;紧跟 watch 之后的首次文件变更可能**永久丢事件**(不补发),高并行负载下高发 —— 任何固定等待预算都救不了(是丢不是慢) | 「watch 后立刻变更」场景用 poke 循环(持续制造新变更直到首事件到达,见 `wsTestHarness.pokeUntilFsEvent`);或等流就绪再做首次变更 | 2026-07 | OKWORK-F260709092310 |
| GO-023 | build | **`ws` 的可选原生加速依赖 bufferutil/utf-8-validate 是 try/catch 懒加载**;vite 打包会把可选 require 变成构建期硬解析 → 找不到即构建失败 → host 启动崩(SMOKE_TIMEOUT) | `vite.host.config.ts` 与 `scripts/package-host.mjs` 把二者与 node-pty 一样列 external(运行时 ws 自行 try/catch 兜底) | 2026-07 | OKWORK-F260709092310 |
| GO-024 | build | **ssh2 的可选原生依赖 `cpu-features` 会拖垮 electron rebuild**:ssh2 纯 JS(`require('cpu-features')` 在 try/catch 内·缺失即纯 JS 回退),但 electron-forge start/make 默认重建**所有** native 模块,node-gyp 在无构建链环境编译 cpu-features 失败 → start/make 崩 | `forge.config.ts` `rebuildConfig: { onlyModules: ['node-pty'] }` 白名单化——只重建 app 真正需要的 node-pty,不碰 cpu-features(也不误伤 vite/rollup 平台 optional 二进制·那些非 electron rebuild 范畴) | 2026-07 | OKWORK-F260709180208 |
| GO-025 | remote/security | **远程机凭据存储语义 = safeStorage 非钥匙串条目**:密码/passphrase 经 `safeStorage.encryptString`→base64 落 `userData/remote-hosts.secrets.json`(密文)·加密密钥在 OS 钥匙串;私钥仅路径引用**内容不入库**;host loopback capability token(经 ws URL 出 main)≠ SSH 登录凭据(永不入 renderer)——两类 secret 边界勿混(ADR-001·上游 Q-003 措辞已注 safeStorage) | 见 `src/main/remote/credentialStore.ts`·`setSecret` 在 `!isEncryptionAvailable` 时抛错拒存不明文兜底;save 前置校验 isAvailable() 防 has* 旗标与密文不符 | 2026-07 | OKWORK-F260709180208 |
| GO-026 | remote/concurrency | **远程 host「认领驻留进程」reap 必须双因子身份核验防兄弟误杀**:configId 只在 env 不进 argv 时,`ps`/`/proc/cmdline` 对同机所有 host 签名相同 → 按 pid+`host.js` 签名 kill 会误杀兄弟 host。且认领握手在 renderer 会致 livelock(main emit verifying 后不等反馈) | ① host 启动注 `--host-tag <configId>` 显式 argv(仅自证不入 token 闸)·reap 唯一放行=cmdline argv 分词**全等**本 configId(非裸 substring);② 认领验证**前移 main**(storedToken 自建 node-ws 探测 host.info·probe 失败同栈回收不 livelock)·见 `src/main/remote/residency.ts` | 2026-07 | OKWORK-F260709180208 |
| GO-027 | remote/deploy | **远端部署锁用非递归 mkdir 保原子**,但锁目录父目录(`~/.termpro-host/bundle`)首装不存在 → 非递归 mkdir 连环 ENOENT → waitForPeer 轮询永不出现的 .ready → 120s deployFailed(桩测全 mock exec 掩盖·测绿产红)。且「锁存在但 meta 缺失」若恒判 age=0 会致 meta-less 锁**永久 wedge** | 取锁前 `mkdir -p "${dataDir}/bundle"`(锁目录本身仍非递归保原子);meta 缺失改按**锁目录 mtime**(`stat -c %Y`/`-f %m` 跨平台)兜底陈旧判定,不永久 wedge;远端路径 shell 命令统一双引号(远端 $HOME 含空格即破)·见 `src/main/remote/deploy.ts` | 2026-07 | OKWORK-F260709180208 |
| GO-028 | renderer/multi-host | **hostClient 单例 → per-host 时,数据模型/路由/持久化/会话四面必须同步迁,漏一面即静默错**:① store workspace 加运行时 `hostId`·远程 ws **不持久化**(实时 workspace.list 发现·serialize v1+v2 双分支都 filter hostId==='local'·否则远程 ws 落存档被 runMigration 本机重建成孤儿);② 广播协调**按 hostId 作用域**(applyWorkspaceSnapshot 本机快照只协调 local 子集·远程 ws 原位 merge-back 透传·否则本机加一个项目就清空所有远程机分组·active=远程时守卫不被抢);③ 会话路由用 **(hostId,sessionId) 复合键**(sessionId 仅 per-host 唯一·防串 tab) | per-host 键=hostRegistry map 键('local'\|configId·非 host.info.hostId);读兜底 `forWorkspace`(未命中 local+WARN)/写 `forHostId`(未命中 **null 绝不兜底**·create 拿 null 拒绝不落本机);本机 ws 维持**连续前缀不变式**(addWorkspace/reconcile 本机新增插到首个远程 ws 前·否则拖拽子集下标≠全量下标错位)·见 `src/renderer/state/{store,workspaceSync}.ts` | 2026-07 | OKWORK-F260710011342 |
| GO-029 | build/gate | **「无残留裸消费」门禁不能用使用点 grep**:`hostClient\.` 漏折行(标识符独占行·下行才 `.`)·`\bhostClient\b` 误红注释·`import[^;]*hostClient` 跨进 `from '.../hostClient'` 路径段假阳误红 type-import·行级 grep 漏多行 import — 五个坑 | 门禁 = **import 集正则**(perl -0777 多行 + 大小写敏感 + 花括号作用域):`import\s+(?:type\s+)?\{[^}]*\bhostClient\b[^}]*\}`(小写单例 specifier·`HostClient` 大写 type 天然放行·路径段被花括号排除)+ tsc 背靠(残留 `hostClient.x` 未 import→cannot find name)·配守门元测试锁正则不退化·见 `hostClientImportGate.test.ts` | 2026-07 | OKWORK-F260710011342 |
| GO-030 | ui/remote | **远程 workspace 的「本地 OS 动作」入口(openInBrowser/showItemInFolder/openPath/openViewerWindow)必须按 isRemote 确定性禁用**:否则点远程文件把**远程绝对路径**交本机 shell·同名巧合静默开错本机文件(无反馈)。禁用用 **`aria-disabled` 非原生 `disabled`**(原生 disabled 按钮不派发 click→提示弹不出=静默失败) | isRemote 时按钮 aria-disabled + onClick 早返 `showRemoteFileHint()`「远程文件独立窗口暂不支持」;树浏览/git 着色不禁(经 forWorkspace 走远程 host 照常)·见 `src/renderer/components/FilePanel.tsx` | 2026-07 | OKWORK-F260710011342 |
| GO-031 | remote/reconnect | **重连必须 disconnect-first**:`orchestrator.connect(configId)` 在 `stage==='ready'`(ACTIVE_STAGES 含 ready)是 **no-op** → 心跳检测的断线(TCP 冻结·main 侧 stage 仍 ready)驱动不了隧道重建·重连死锁。且 ssh2 默认无 keepalive·冻结 TCP 数分钟不 emit disconnected | reconnectController 先 `await remoteHost.disconnect(configId)`(stage ready→disconnected)再 `connect`;纵深加 ssh2 `keepaliveInterval`/`keepaliveCountMax`(env 注入·不替代 disconnect-first) | 2026-07 | OKWORK-F260710042746 |
| GO-032 | remote/reconnect | **重连收养(session.attach)必须等新 ws 真 open·不能由 main 'ready' stage 事件驱动**:main claim 快路径**同步连发** verifying+ready(orchestrator.ts:550-557)·而 `client.reconnect({wsUrl})` 的 ws.onopen 要等隧道 RTT → 收 ready 就 readopt 时 transport 仍 null → rpc 恒 reject → **重连后终端冻结**(无回放/无 live/打字无反应·确定性非偶发) | readopt 由 `client.reconnect().then(...)`(ws-open promise)驱动·非 stage 事件;ready useEffect 只留 workspace 发现 + 订阅 | 2026-07 | OKWORK-F260710042746 |
| GO-033 | test/coverage | **seam-tested-but-not-wired 幽灵覆盖**:单测直驱一个 helper/controller 的 seam(如 `onAttemptFailed`/`scheduleDropUnlessReconnecting`)全绿·但**生产事件源到该 seam 的接线缺失**(全仓 grep 该符号仅测试+定义处)→ AC 生产路径实际空转/失效·测却绿(比经典幽灵覆盖更隐蔽:测跑得动·就是没接生产)。verify-ac / 单测挡不住 | review 阶段对**每条 seam grep 生产调用方**(非仅测试);测断言「删掉生产 gate/接线测须变红」;接线层测(Sidebar/wiring)非仅 controller seam | 2026-07 | OKWORK-F260710042746 |
| GO-034 | remote/reconnect | **增量回放游标 renderedBytes 必须用 host 给的 bytes 字段·不是 `data.length`**:xterm write 的是字符串·CJK/emoji 一字符多字节·用 `.length`(字符数)累加 → 游标偏移错位 → 重连回放双写/错位。且游标须 **onData 同步累加**(term.write 之前)非 write 回调(异步滞后·在途 chunk 致 resumeOffset 偏小又双写) | renderedBytes 在 onData 同步 `+= pty:data.bytes`(host 算好的字节数);ack 仍留 write 回调(背压);session.attach 返 nextOffset 权威推进不自算 | 2026-07 | OKWORK-F260710042746 |
| GO-035 | remote/reconnect | **断线期 exited 会话重连后「已完成」徽标要从 session.list 快照点亮·不能等 pty:exit**:host reattach **不重发** pty:exit(会话早退出)·而 store `tab.exited` 只由渲染进程 onExit 设 → 重连后徽标永不亮(AC-12 北极星徽标半侧失效·scrollback 回放本身通过) | reconcileBadge 据 `snapshot.status==='exited'` 落 `tab.exited+exitCode`(单调终态·不回写 live) | 2026-07 | OKWORK-F260710042746 |
| GO-036 | test/baseline | **test-baseline `--diff` 按 test-id 字符串精确匹配·登记与 `--current` 粒度必须一致**:历史把多个失败文件登记成一条逗号合并串·而 `--current` 传单文件→ 拆分后与合并串不匹配→ 全判 NEW_FAILURES(假阳性 stale_registered) | 逐文件独立 `--add`(单文件一条)·`--current-failures` 传同粒度单文件列表;`--list`/`--diff` 带 `--feature` 定位 worktree project-specs | 2026-07 | OKWORK-F260710042746 |
| GO-037 | remote/deploy | **`deploying` 阶段取消会把部署锁留在远端·下一次连接最长空等 120s 后 deployFailed**(代码读证 · 未实测):`deploy.ts:213` 的 `finally { releaseMkdirLock }` 本身是对的,但取消走 `orchestrator.disconnect()` —— 它等在途编排 ≤5s(`orchestrator.ts:419`)超时即强关 ssh,而真实 bundle 上传常 >5s → finally 里那条 `rm -rf` 的 ssh exec 随连接一起失败 → 锁目录 `${dataDir}/bundle/.deploying-${version}` 残留。下次连接:`acquireMkdirLock` 见锁未陈旧(age ≤ 120s,`deploy.ts:37` `DEFAULT_LOCK_STALE_MS`)→ `waitForPeer` → `waitForReady` 轮询一个永不出现的 `.ready`,超时 120s 抛 `deployFailed`(`deploy.ts:118`) | **不是死锁,是一次性延迟**:锁 age > 120s 后 `mkdirLock.ts:88-92` break-and-reacquire 自动接管 → 再点一次连接即恢复。用户 D-7 已拍板接受此代价,本次不修。若日后要修:取消路径显式发一条独立 ssh 会话 `rm -rf` 锁目录,或给 `waitForReady` 加「等待中锁已陈旧则提前 break」的复检 | 2026-08 | OKWORK-F260805033051 |
| GO-038 | test/security | **带密码的浏览器 E2E fixture 不得用 GET 提交登录表单**：即使产品日志完全脱敏，浏览器仍会把用户名/密码放进 URL；地址栏、导航历史、截图和失败日志随即成为新的持久暴露面。本 Feature 初版视觉证据正是在地址栏看到随机密码哨兵才暴露该问题 | fixture 用 `method="post"`，服务端不记录 body；截图前额外检查成功页 URL 无 credential query；任何 reveal 场景只在内存断言明文，等重新遮罩后再截图 | 2026-08 | OKWORK-F260807022801-Profile-Password-Vault |
| GO-039 | remote/security | **Remote Profile 的 main-only RPC 是应用接口隔离，不是同 SSH UID 的 OS 隔离**：配置 SSH 用户、Remote Host 管理员及以该用户运行的任意 FS/PTY 进程都可读取 master key 与密文并解密；`0700/0600` 只挡其他 UID | 产品与确认 UI 必须明确该信任边界；普通 renderer 仍不得获得专用 Profile/Vault API 或 capability。若要隔离同 UID Agent，只能改为独立 OS principal/第二 SSH 身份或 E2EE，不能靠路径 deny、capability 或权限位话术 | 2026-08 | OKWORK-F260810051623-Remote-Profile-Authority |

---

## 🎨 Preferences(用户偏好)

> 用户在产品层面强调的偏好。**不是规范**——是用户的口味。

| ID | 类别 | 偏好 | 来源 | 记录时间 |
|----|------|------|------|---------|
| PR-001 | 发版 | 发版后**不替用户安装/升级** `/Applications` 里的应用;用户自己通过应用内升级胶囊(Squirrel.Mac)更新 | CLAUDE.md 用户指令 | 2026-06 |

---

## ❌ Out of Scope(已拒绝过的方案/方向)

> 拒绝过的方案 / 方向——防止 AI 反复提同一个被否的方案。
> PMO 在 Goal Stage 起草前必扫描本段。

| ID | 拒绝的方向 | 拒绝理由 | 拒绝时间 | 触发 Feature / 决策点 |
|----|-----------|---------|---------|----------------------|
| OS-001 | 完整编辑器 / LSP | 重度编辑外跳专业编辑器;本产品卖点是会话编排而非编辑器 | README | 产品定位 |
| OS-002 | 内置或绑定特定 agent / 解析特定 agent 输出格式 | 终端保持哑且工具无关是第一设计原则;可选 adapter 插件但核心永不依赖 | README | 产品定位 |
| OS-003 | 通用终端的极致性能竞赛 | 够流畅跑 agent CLI 即可;性能不是本产品差异化点 | README §四 | 产品定位 |
| OS-004 | Windows / Linux 支持 | 先 macOS;M1 阶段仅 macOS | README §四 | M1 |
| OS-005 | Ghostty fork(原生 Swift 路线) | 单窗口+侧栏+自绘 tab 需重写整个窗口层;文件树/diff/通知全要 Swift 手搓;终端品质本身不是本产品卖点;投入收益错配 | README §七 | 选型调研 2026-06 |

🔴 **PMO 起草 Goal / 评审循环时必须先扫 OS-NNN 列表**:发现 PRD 草案重新提了被否方向 → 直接打回让 PM 改写或显式说明"为什么本次重新审视"(必须有新触发原因,否则违规)。

---

## 按主题索引

> PMO preflight 时可按主题快速 grep。

- **pty**: GO-001, GO-005
- **render**: GO-002, GO-006, GO-020
- **terminal/links**: GO-018
- **ipc**: GO-003, GO-004, GO-008
- **persist**: GO-007
- **shell**: GO-009, GO-010
- **build**: GO-015
- **filepanel**: GO-011, GO-013
- **notify**: GO-012, GO-014, GO-016
- **test**: GO-017, GO-038(security)
- **lifecycle**: GO-019
- **remote/security**: GO-025, GO-039
- **remote/concurrency**: GO-026
- **remote/deploy**: GO-027, GO-024(build), GO-037
- **renderer/multi-host**: GO-028
- **build/gate**: GO-029
- **ui/remote**: GO-030
- **发版**: PR-001
- **歧义**: FA-001
- **拒绝**: OS-001, OS-002, OS-003, OS-004, OS-005

---

## 归档(archived)

> 已不适用的 Gotcha / Preference,保留备查。Feature 新启动时 PMO preflight 可忽略本段。

| ID | 原内容 | 归档原因 | 归档时间 |
|----|--------|---------|---------|
| — | — | — | — |
