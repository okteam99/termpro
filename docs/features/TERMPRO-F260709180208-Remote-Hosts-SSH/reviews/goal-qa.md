# QA 冷审 — BL-003 远程机管理与 SSH 连接编排 PRD

verdict: NEEDS_REVISION

（4 条 medium 实质问题：失败重试无 AC、AC-8 安全项过载且验证钩子失真、AC-9 验证方式在自述测试兜底下不可操作、复用连接跳过部署的快路径无 AC。核心 3 条 AC 均已覆盖，故非 high；但上述 medium 影响可测性与验收完整性，须修订。）

files_read:
- docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/PRD.md
- product-overview/workstream/WS-01-remote-host.md
- docs/ROADMAP.md
- docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/YOLO-PREFLIGHT.md
- src/host/wsServer.ts
- src/host/token.ts
- src/host/host.ts
- src/renderer/services/hostClient.ts
- src/main/main.ts
- scripts/package-host.mjs

## 核心 AC 覆盖对账（WS-01-S3 三条核心 AC）

| WS-01-S3 核心 AC | PRD 覆盖 | 结论 |
|---|---|---|
| ① 添加远程机（密钥/密码）→ 测试连接可达 | AC-1（CRUD + 重启存活）+ AC-2（测试连接可达 · 三类失败） | 覆盖 |
| ② 首次连接自动部署拉起远程 host · 进度可视 · 握手成功 | AC-4（三段进度）+ AC-6（握手兼容 + 冒烟）| 覆盖 |
| ③ 凭据零明文 | AC-3（safeStorage · 零明文 · 不入渲染进程）| 覆盖（含用户确认的语义偏离，见 QA-8）|

三条核心 AC 无遗漏。以下为完备性/可测试性/优先级/一致性的实质问题。

## findings

### QA-1 · 失败后「重试」无验收标准
- severity: medium
- category: quality
- description: 交付预期表第 3 行承诺「可重试」，状态机也画了 `failed --> connecting: 重试` 与 `disconnected --> connecting`（PRD 151-156 行），但 10 条 AC 里没有任何一条验证「失败后用户就地修正并重连成功、failed 态清除」。这是本 Feature 最高频的真实路径（错密码→改密码→重连）。
- suggestion: 新增 AC（建议 P0/P1）：Given 一次连接因认证失败/不可达进入 failed / When 用户修正凭据或恢复网络后点重试 / Then 状态从 failed 重新进入 connecting 并可达 ready，前次错误提示被清除、无残留连接对象。
- code_evidence: docs/features/.../PRD.md:151-156（状态机含重试边）、PRD.md:81（交付预期「可重试」）— 均无对应 AC

### QA-2 · AC-8 安全项过载 + 验证钩子过宽 + 节流未量化
- severity: medium
- category: quality
- description: AC-8 把四件相互独立的安全保证（① 非白名单 Origin 拒绝 ② 认证失败告警节流 ③ token 经安全信道交接不落远端持久日志 ④ token 文件写入无 TOCTOU）塞进一条 AC，test_refs 无法一一追溯。其 grep_keyword `origin|authAlert|token` 过宽——`token` 在 token.ts 遍地命中、`authAlert` 亦是既有符号，机器校验会因既有代码平凡通过，证明不了本 Feature 的**新**行为。另外「告警有节流不刷屏」未量化：当前 `recordAuthFailure` 一旦窗口内计数达阈值（10），此后**每一次**失败都再触发 `onAuthAlert`/日志（计数持续 ≥10），即当前实现在持续攻击下会刷屏——AC 想要的「节流」正是要改这个，但没定义节流策略（每窗口至多 1 次？退避？）。
- suggestion: 拆成 AC-8a Origin 白名单、AC-8b 告警节流、AC-8c token 交接不落持久日志、AC-8d token 文件写入 TOCTOU-safe 四条；每条给可判定阈值（如「同一 60s 窗口内 onAuthAlert 至多触发 1 次」）；grep 钩子收紧到能证明新行为的独有符号（如 Origin 校验函数名、`O_EXCL`/`wx` 之类的 TOCTOU-safe 写标志），而非 `token`。
- code_evidence: src/host/wsServer.ts:191-201（`recordAuthFailure` 阈值后每次失败均告警 · 未节流）、wsServer.ts:203-222（upgrade 处理仅校验 token · 当前无任何 Origin 逻辑）

### QA-3 · AC-9（缺 node）验证方式在自述测试兜底下不可操作
- severity: medium
- category: quality
- description: AC-9 校验「远端无 node 或 node<20 → 部署中止 + 引导」，交付预期第 3 行的验证方式写「无 node 的机器上重试」。但 PRD「开工前必须想清的」自述 e2e 兜底是 `ssh localhost`（本机 sshd）——本机必有 node，无法制造 node 缺失/降版场景。AC-9 因此无法在声明的测试环境里转成可运行用例。
- suggestion: 在 AC-9 或 TECH 备注里指定 node 缺失/降版的模拟手段（如部署侧对远端 `node -v` 探测点做可注入 stub / 用清空 PATH 的 ssh exec / 容器镜像不含 node），使 AC-9 可离线判定，而非依赖真有一台没装 node 的机器。
- code_evidence: docs/features/.../PRD.md:178（测试兜底 = ssh localhost）与 PRD.md:109（AC-9）冲突

### QA-4 · 「已部署且版本符 → 复用连接跳过上传」快路径无 AC
- severity: medium
- category: quality
- description: 状态机建模了 `connecting --> starting: 产物已就绪`（PRD 148-149 行）、时序图画了「检测 host 产物与版本」后 `alt 无产物或版本不符` 才上传（PRD 128-132 行），AC-7 也提供一键重连；但没有 AC 验证「远端已部署且版本兼容时，第二次连接跳过 bundle 上传、直接 starting→ready」。缺此 AC，一个每次连接都重传 bundle 的实现仍能通过全部现有 AC——这是可感知的体验退化（大 bundle 每连必传）与验收漏洞。
- suggestion: 新增 AC：Given 远端已部署且版本兼容 / When 再次连接 / Then 部署编排检测到产物就绪，跳过上传阶段，进度直接进入 starting，且 UI 不出现「上传」段。
- code_evidence: docs/features/.../PRD.md:129-132（时序 alt 分支）、PRD.md:148-149（状态机 `产物已就绪` 边）— 无对应 AC

### QA-5 · AC-8 Origin 白名单须不误杀真实 renderer
- severity: low
- category: technical-consistency
- description: AC-8 要求「非白名单 Origin 拒绝」，但合法客户端是 Electron renderer（loadFile 下 Origin 为 `file://`，dev server 下为 `http://localhost:<vite>`，且原生 WebSocket 有可能不带 Origin 头）。若白名单/缺失 Origin 的处置定义不当，会把真实客户端一起挡掉。这是 blueprint 需先定死的判定表，PRD 层至少应把「缺失 Origin 如何处置（放行/拒绝）」列为待定并指向 TECH。
- suggestion: 在 AC-8（拆分后的 Origin 项）注明白名单集合来源（Electron renderer 的合法 Origin + 缺失 Origin 的明确处置），并在 TECH 层给判定矩阵；测试须同时覆盖「浏览器 Origin 拒绝」与「真实 renderer Origin/无 Origin 放行」两向。
- code_evidence: src/host/wsServer.ts:203-222（当前 upgrade 仅 token 校验 · 引入 Origin 逻辑不得回归破坏 hostClient WebSocketTransport 连接路径 src/renderer/services/hostClient.ts:186-224）

### QA-6 · AC-10（删机清凭据）优先级偏低
- severity: low
- category: business-alignment
- description: AC-10「删除机器 → 凭据一并从加密存储清除」定为 P2。删除主机却残留其加密密码/passphrase 属安全卫生与正确性问题（孤儿密文），虽已加密静置、实际风险有界，但 P2 与「凭据零明文/最小驻留」的安全基调不太匹配。
- suggestion: 上调 AC-10 至 P1；或在 PRD 说明「加密静置 + 无解密密钥引用即等效清除」的判断依据，明确保留 P2 的理由。
- code_evidence: 无（文档内优先级判断）

### QA-7 · 「测试连接」与「连接」的失败口径不一致且范围边界未言明
- severity: low
- category: technical-consistency
- description: AC-2「测试连接」失败分类为 不可达/认证失败/超时；交付预期第 3 行「连接失败」分类为 认证失败/不可达/缺 node/版本不兼容（无超时）。两处口径不齐；且 PRD 从未说明「测试连接」是否比「连接」更轻（不部署、不查 node/版本），读者/QA 可能误以为测试连接也要走到 node/握手校验。
- suggestion: 明确「测试连接 = 仅验可达 + 认证」与「连接 = 可达+认证+部署+握手」的范围边界，并把两处失败分类对齐（超时归入哪一侧、缺 node/版本不兼容只属连接路径）。同时建议各错误 AC 注明提示落在哪个 UI 面（用户可见 toast/行内提示 vs 仅日志），避免「明确提示」只落日志。
- code_evidence: docs/features/.../PRD.md:81 与 PRD.md:102 口径不一致

### QA-8 · AC-3 对上游「仅存钥匙串」字面偏离——已确认，留痕
- severity: info
- category: business-alignment
- description: WS-01-S3 核心 AC ③ 原文为「凭据仅存系统钥匙串」，AC-3 实为 safeStorage（密文落 userData、加密密钥在钥匙串）。这是字面偏离，但已由用户逐条确认（YOLO-PREFLIGHT §2#2 · D-2），PRD 待决策项表亦如实登记「接受与 AC 字面差异」。判定为合规，不需改。
- suggestion: 无需修改；仅提示后续 verify-ac / goal-complete 评审勿把「钥匙串」字面不符误报为缺陷——PRD D-2 与本条即为溯源锚点。
- code_evidence: docs/features/.../PRD.md:92（D-2）、PRD.md:103（AC-3 · grep safeStorage）

---

# Round 2 验证 — PRD v0.2（复审 · 只验 Round 1 findings 是否消解 + 有无新问题）

verdict: APPROVE

（Round 1 全部 8 条 findings 在 v0.2 有效消解；AC 由 10 条重排至 14 条，覆盖只增不减；复审未发现实质性新问题。仅 1 条 info 级残留（AC-10 grep 仍留宽泛 `origin` 兜底项），不阻断。status 已由 draft 转 pending_review。）

files_read (Round 2):
- docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/PRD.md（v0.2 全文重读）

## Round 1 findings 消解对账

| finding | Round 1 严重度 | v0.2 处置 | 消解判定 |
|---|---|---|---|
| QA-1 失败重试无 AC | medium | 新增 **AC-12(P0)**：failed 修正后重试至 ready + disconnected 手动重连；状态机加 `failed→connecting`/`disconnected→connecting` 边 | ✅ 消解 |
| QA-2 AC-8 过载/grep 过宽/节流未量化 | medium | AC-8 拆三：**AC-8** token-stdin 注入+端口文件 O_EXCL0600（grep 收紧 `token-stdin\|tokenStdin\|portFile`）、**AC-9** 节流量化「同窗口至多 emit 1 次」（grep `authAlert\|AUTH_FAIL\|alertThrottle`）、**AC-10** Origin 白名单（grep `checkOrigin\|ORIGIN_ALLOW\|origin`）；节流条明确对齐现状 wsServer 刷屏基线 | ✅ 消解（AC-10 grep 见残留 R2-1） |
| QA-3 AC-9 缺 node 验证不可操作 | medium | 迁为 **AC-11(P1)**，指定「受控 exec 桩/PATH shim 模拟 无 node 与 node 18」，§开工前❓亦注「不依赖真机」 | ✅ 消解（且加覆盖 node18 降版态，更周全） |
| QA-4 复用连接跳过上传无 AC | medium | 新增 **AC-13(P1)**：同版本→跳过上传（日志可观测 skip）+ 认领驻留进程不重启；时序图/状态机同步建模 | ✅ 消解 |
| QA-5 Origin 白名单勿误杀真实 renderer | low | 并入 **AC-10**：白名单=真实 renderer 值集（file://或 null / dev vite origin），「无 Origin 头/白名单内不误杀」 | ✅ 消解 |
| QA-6 AC-10 删机清凭据 P2 偏低 | low | 升为 **AC-14(P1)**：safeStorage 凭据随删必清 + 活跃连接 best-effort 先断 | ✅ 消解 |
| QA-7 测试连接/连接口径不一致 | low | **AC-2** 明确「仅认证+可达探测·不部署不拉起 host」，失败分类与连接流程统一 | ✅ 消解 |
| QA-8 safeStorage 字面偏离留痕 | info | ADR-001 落地 + D-2 与上游 4 处台账措辞同步；AC-3 显式区分「SSH 凭据永不入渲染进程」vs「host loopback token 按设计入 ws URL」 | ✅ 已留痕 |

## 复审：修订有无引入新问题

逐项核对未见实质性回归：
- 新增 `verifying` 态（ARCH-3）在 AC-5 状态枚举、AC-6、状态机、时序图四处一致，无悬挂态。
- AC-3「host loopback token 入 renderer ws URL」与代码现状一致（hostClient.ts:186-224 `WebSocketTransport` 确经 `?token=` 连接），且与 AC-8「远端 token 不落持久文件」不矛盾（两者分属 renderer 内存态 vs 远端持久态，语义正交）。
- AC 重排后旧 10 条覆盖全部保留（老 AC-9→AC-11、老 AC-10→AC-14），无覆盖丢失。
- 私钥「仅路径引用不入库」（ARCH-5 / AC-2 / AC-3 / Out of Scope）为自洽的 v1 收敛，passphrase 仍走 safeStorage，无 UX 断裂。
- D-6（resources 内置全架构 bundle）为 AC-4 地基性新依赖，已在 §隐藏前提③ 显式登记 CI extraResource 接线要求并保留 npm 兜底释放阀——假设已被捕获，非 PRD 层缺陷。

## 残留（info · 不阻断 APPROVE）

- **R2-1（info/quality）**：AC-10 的 grep_keyword `checkOrigin|ORIGIN_ALLOW|origin` 仍保留宽泛的裸 `origin` 兜底项——真实锚点 `checkOrigin`/`ORIGIN_ALLOW` 已够特异，裸 `origin` 可能被代码里无关 `origin` 平凡命中，略削机器校验强度。建议实现落地后删掉裸 `origin` 只留两个特异符号。非阻断。
- **R2-2（info/quality）**：交付预期表第 3 行验证方式仍写「无 node 的机器上重试」，与 AC-11「exec 桩/PATH shim 模拟」的实测手段措辞不完全一致（前者述用户可感知场景、后者述 QA 模拟法，无逻辑冲突）。可选：在该行括注「(测试经 exec 桩模拟)」以彻底对齐。非阻断。
