# 项目本地知识库

> 本文件记录开发中积累的 **TermPro 项目特有事实 / 踩坑 / 用户偏好**（AI 沉淀）。
> 不记录:开发规矩/约定(走 DEV-RULES.md)、决策(走 ADR)、通用规范(走 standards/rules)、术语(走 GLOSSARY.md)、复盘(走 retros/)。
> Teamwork 在 triage(用户输入承接阶段)会扫描本文件,注入「📚 相关项目事实」段。

> 📌 **术语 → `GLOSSARY.md`**;**开发规矩/约定 → `DEV-RULES.md`**。本文件不再收录这两类。

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
| GO-003 | ipc | **沙箱 preload 无 `process.env`**;冒烟开关无法直接读 | main 通过 `additionalArguments: ['--termpro-smoke']` 传入,preload 读 `process.argv` | DEV.md §5 | M1 |
| GO-004 | ipc | **MessagePort 必须经 `window.postMessage` 转移**;contextBridge 不能直接传 port | 见 `preload.ts`:`event.sender.postMessage → window.postMessage(ports)` (Electron 官方模式) | DEV.md §4.6 | M1 |
| GO-005 | pty | **PTY → UI 必须做流控**(watermark + pause/resume);否则 agent 倾倒 build 日志时内存与帧率一起崩 | highWatermark=512 KB / lowWatermark=128 KB;FLOW 常量在 `src/shared/protocol.ts`;本地/远程共用同一机制 | README §六 | M1 |
| GO-006 | render | **terminalRegistry 跨 React 挂载存活**;组件卸载不销毁 Terminal 实例 | 切 tab/workspace 复用同一 xterm.js 实例;仅 `disposeTerminal(tabId)` 才真销毁,否则 scrollback/连接中断 | DEV.md §4.4 | M1 |
| GO-007 | persist | **持久化必须先 hydrate 后订阅**;否则初始空状态覆盖存档 | `initPersistence()` 按序:storeGet → hydrate → 设 `hydrated=true` → 再启动 Zustand 订阅;UI 以 `hydrated` flag 门控渲染 | DEV.md §4.5 | M1 |
| GO-008 | ipc | `PROTOCOL_VERSION = 1`;M5 远程接入时需做**版本握手校验** | 版本号定义在 `src/shared/protocol.ts`;接入时需在握手阶段校验双端版本 | DEV.md §5 | M5 |
| GO-009 | shell | **shell integration 仅 zsh**;bash/fish 待后续 | spawn zsh 时经 ZDOTDIR 包装自动注入 OSC 133/7;`TERMPRO_NO_SHELL_INTEGRATION=1` 可关闭 | DEV.md §5 | M3 |
| GO-010 | shell | **p10k instant prompt 兼容**:.zshrc 末尾注入 OSC 序列可能触发"console output during init"提示 | 与 VS Code 同模式,无功能影响;用户知情即可,无需修复 | DEV.md §5 | M3 |
| GO-011 | filepanel | **查看器保存无 mtime 守卫**;文件被外部修改后保存会直接覆盖 | 跟进项:读时记 mtime,写时校验;当前轻编辑场景已接受此风险 | DEV.md §5 | M4 |
| GO-012 | notify | **UI 完全关闭期间收不到系统通知** | M1-M4 靠重连对账兜底;推送通道留 M5 后 | DEV.md §5 | M3 |
| GO-013 | filepanel | **FilePanel 编排遗留 P2**(opus 评审 2026-06,均与重构前等价或更优):① refresh/lockRoot 后 resolveDone 冗余二拉 git.status(seq 闸自纠正);② childDone 无 seq,懒拉与 partial 重拉并发时 last-writer-wins;③ dispose/watchReady 同 tick 边界无专测 | 暂接受;单 reducer 三道过期闸(resolveDone 按 generation、树/着色按 root、top/status 按单调 seq)已覆盖主路径 | DEV.md §5 | v0.3 |

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
- **render**: GO-002, GO-006
- **ipc**: GO-003, GO-004, GO-008
- **persist**: GO-007
- **shell**: GO-009, GO-010
- **filepanel**: GO-011, GO-013
- **notify**: GO-012
- **发版**: PR-001
- **歧义**: FA-001
- **拒绝**: OS-001, OS-002, OS-003, OS-004, OS-005

---

## 归档(archived)

> 已不适用的 Gotcha / Preference,保留备查。Feature 新启动时 PMO preflight 可忽略本段。

| ID | 原内容 | 归档原因 | 归档时间 |
|----|--------|---------|---------|
| — | — | — | — |
