---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review=true(单模型 · 异质评审降级为同模型 exec 自审 · 已 startup WARN)"
review_via: subagent
perspective: external-claude
target: blueprint
generated_at: "2026-07-09T13:30:00Z"
files_read:
  - "docs/features/TERMPRO-F260709092310-Host-Standalone-Transport/external-review-prompts/blueprint-claude-subagent-20260709T131512Z.md (TC.md + TECH.md inline)"
  - "src/host/host.ts"
  - "src/shared/protocol.ts"
  - "src/host/ptyPool.ts"
  - "src/renderer/services/hostClient.ts"
  - "src/host/watchService.ts"
  - "forge.config.ts"
  - "vite.host.config.ts"
  - ".github/workflows/release.yml"
  - ".github/workflows/ci.yml"
model: "claude-opus (subagent · degraded same-model self-review)"
findings:
  - id: CR-1
    checklist: C6
    severity: high
    location: "TECH.md §接口 / §测试清单(wsOwnership.cwdNotOwner)/ 待决策对照 ① 引用「TC-K3」 vs TC.md Layer D(TC-D01..D08 无 pty.cwd)+ frontmatter tests[](T-039..046 无 pty.cwd)"
    issue: "TECH 承诺给 pty.cwd 补归属校验(修复实锤的跨客户端 cwd 泄露),并声称由「TC-K3 / wsOwnership.cwdNotOwner」覆盖;但 TC.md 的 frontmatter tests[](verify-ac 单源)与 AC-6 覆盖矩阵中根本没有 pty.cwd 越权拒绝用例,且「TC-K1/K2/K3」这套编号在 TC.md 中不存在(TC 实际用 TC-D01..D08)。"
    rationale: "已核实 src/host/host.ts L175-179 pty.cwd 直接 pool.pid(sid)→processCwd 无 client.sessions.has 守卫,是真实安全缺口;pty.cwd 在 TC 里仅出现在 TC-C01(T-031)的功能等价 roundtrip 方法表,不校验归属。于是这条安全修复在蓝图里零测试覆盖,且 TDD 回归门(只钉了 T-041 pty.kill)不会拦住它;TECH↔TC 交叉引用(TC-K*)整体悬空,说明两文档编号不同源。"
    suggestion: "在 TC.md 补一条 Layer D 用例(如 TC-D09 / 新 T-0xx,covers_ac:[AC-6],P0,对照 T-041 同款回归门语义:修复前必须失败),断言 A 无法经 pty.cwd 读到 B 会话 cwd;并把 TECH 里 TC-K1/K2/K3 的引用改写为 TC.md 实际 id(TC-D03=T-041 等),消除悬空交叉引用。"
  - id: CR-2
    checklist: C6
    severity: high
    location: "TECH.md §常量表 WS_MAX_PAYLOAD=32 MiB(L1381)/ 落定对照 ④ vs TC.md TC-E02(T-048)/ TC-E03(T-049)仍写「~10MB」(L942/L952)"
    issue: "同一蓝图内 TECH 已把 payload 上限精确落定为 32 MiB(并明言「取代 PRD 的 ~10MB 量级锚点」),但共交付的 TC-E02/TC-E03 两条 P0 边界对照用例仍以「~10MB」为断言基准,尤其 TC-E03「略低于上限(如上限的 95%)」——95% × 10MB 与 95% × 32MiB 相差 3 倍以上。"
    rationale: "TC 的『阈值口径说明』约定 TECH 定稿后只改数字,而 TECH 已在本蓝图定稿;留着两个互相矛盾的数值,dev 极可能把 P0 边界对(超限拒绝 / 略低于上限成功)写在错误的 cap 上,导致边界测试形同虚设或误伤 readFileBinary 20MB→base64 ~27MB 的合法大帧。"
    suggestion: "现在就把 TC-E02/TC-E03 的断言基准从 ~10MB 同步为 TECH 的 32 MiB(TC-E03 的 95% 边界按 32 MiB 计算),使蓝图内部自洽后再进 dev。"
  - id: CR-3
    checklist: C5
    severity: high
    location: "TECH.md §wsServer 限速(AUTH_RATE_WINDOW/MAX,进程级不依赖源 IP,L1296)+ TC.md TC-B08(T-021)『按尝试次数不依赖源地址』"
    issue: "限速用『进程级失败尝试计数、跨所有连接共享一个窗口』,而 AC-3 的威胁主体正是同机其他用户/进程——该攻击者只需每窗口发 AUTH_RATE_MAX(=10)次坏 token,即可把冷却窗口一直续上,持续锁死合法客户端的连接/重连(BL-005)。T-021 还把这一行为钉成 P0 契约。"
    rationale: "token 已是 128-bit(TC-B01),暴力破解在数学上不可行,限速对『挡爆破』的边际安全收益近乎为零;但全局计数器反而给同租户攻击者提供了一个可持续的拒绝服务杠杆(每 60s 触发一次即永久锁定),是安全设计里典型的『防御手段引入新的可用性攻击面』。这是需要有意识决策、而非默认接受的取舍。"
    suggestion: "至少二选一并在 TECH 记录理由:(a)对已成功完成 token+握手的连接/来源豁免限速,使坏 token 洪泛不影响在线合法客户端;或(b)鉴于 128-bit token 已足够,评估是否保留该限速(若保留,把 T-021 的语义改为『不因换端口绕过』但不要求全局单桶锁死)。"
  - id: CR-4
    checklist: C6
    severity: low
    location: "TC.md TC-D07(T-045)心跳超时『~10s 的整数倍』占位 / TC-B07(T-020)『约 10 次以上』 vs TECH.md §常量表 PING_INTERVAL_MS=30000(检测窗 ~30–60s)、AUTH_RATE_MAX=10 精确值"
    issue: "TC 里几处阈值仍是量级占位,而 TECH(共交付)已给精确值:心跳 TC-D07 写『~10s 整数倍』与 TECH 的 30s/检测窗 30–60s 对不上;限速 TC-B07『约 10 次以上』与 TECH 精确 ≥10 边界口径松。"
    rationale: "与 CR-2 同理,TECH 既已定稿,占位断言应即刻收敛到 TECH 数值,否则 dev 面对同一蓝图内两处不一致的阈值,心跳/限速用例的边界(第 10 还是第 11 次触发限速、心跳窗到底多久)无法确定地写成可执行断言。"
    suggestion: "把 TC-D07 的心跳阈值改为对齐 TECH 的检测窗(~30–60s / PING_INTERVAL_MS 的整数倍),TC-B07 明确写成『窗内第 10 次失败后的后续尝试被拒』这类确定边界,与 TECH §常量表逐条对齐。"
  - id: CR-5
    checklist: C2
    severity: low
    location: "TC.md TC-B02(T-015 常量时间:结构/源码模式匹配或 spy)+ TC-B05(T-018『关闭 code/reason/响应时序特征完全一致』)"
    issue: "TC-B02 用源码模式匹配 / spy 断言常量时间比较,属白盒且脆(改写等价实现即误报失败);TC-B05 把『响应时序特征一致』纳入断言,而 TC 自己在 B02 里已声明 CI 计时噪声大、不可作判据——两处口径互相打架。"
    rationale: "时序不可区分性在 CI 无法稳定断言;TECH 设计里未带 token 与错 token 都是同一路径 socket.destroy() 零信息,本就是『构造上一致』,应断言结构等价(相同 close code/reason、无 body),而非测量时序,否则用例天然 flaky 或靠掐表判定不可靠。"
    suggestion: "TC-B05 去掉『响应时序特征』这一维,只断言两场景走同一 destroy 路径(相同 close code/reason、零 body);TC-B02 的常量时间保持结构/spy 审查即可,但在文档里点明它是白盒守卫、随实现等价替换需同步更新。"
  - id: CR-6
    checklist: C6
    severity: low
    location: "TC.md frontmatter T-053..T-059 file: .github/workflows/host-package-smoke.yml vs TECH.md §改动文件清单 .github/workflows/host-package.yml(L1445)"
    issue: "AC-4 打包实机冒烟的 CI 工作流文件名在两文档里不一致:TC 用 host-package-smoke.yml,TECH 用 host-package.yml。"
    rationale: "同一蓝图对同一新增 CI job 给了两个文件名,dev 落地时会二选一或两建,导致 verify-ac 按 TC 的 file 字段找不到实际产物、或 CI 里出现命名漂移。"
    suggestion: "统一为单一规范文件名(建议 host-package-smoke.yml 与 TC frontmatter 对齐,或反向统一),两文档同步。"
  - id: CR-7
    checklist: C4
    severity: info
    location: "TC.md TC-B09(T-022)『绑定 127.0.0.1(或 ::1)』 vs TECH.md §wsServer『server.listen(port, "127.0.0.1")』+ argv host ∈ {127.0.0.1, ::1, localhost}"
    issue: "TECH 允许 argv host 段取 ::1 / localhost,却恒 listen('127.0.0.1');于是 TC-B09 断言里的『(或 ::1)』分支在 TECH 语义下永远不成立——传 ::1 仍只得到 v4 绑定。"
    rationale: "校验白名单接受 ::1 但实际绑定固定 v4,是一处小的自相矛盾:要么 IPv6-only 环境下客户端连 [::1]:port 会失败,要么白名单该收窄。属边界一致性,不阻断。"
    suggestion: "决策二选一:真支持 ::1 就按 argv 实际绑定对应地址族;否则从白名单与 TC-B09 的『(或 ::1)』一并移除,只承诺 127.0.0.1。"
  - id: CR-8
    checklist: C5
    severity: info
    location: "TECH.md §wsServer token 取 ?token= query(L1295)/ dev 开关 VITE_TERMPRO_REMOTE_WS = 含 token 的完整 ws URL"
    issue: "token 经 ?token= query 传入。query-string 承载密钥属通用反模式(易进 URL 型日志 / 代理访问日志 / devtools Network 面板 / 浏览器历史)。"
    rationale: "本 Feature 是 loopback + dev-only 开关、无中间 HTTP 代理,风险有限;但 TECH 已列出 Sec-WebSocket-Protocol / header 备选,优先选它可让密钥不出现在任何 URL 面上,契合 TECH『token 明文绝不入日志』的既定纪律。"
    suggestion: "把首选信道定为 Sec-WebSocket-Protocol(或 header),query 仅作兜底或删除;在 TECH 明确标注首选,避免 dev 默认走 query。"
findings_summary:
  blocker: 0
  high: 3
  low: 3
  info: 2
  total: 8
---

# 详情（人读补充）

## 评审范围与降级声明

本评审为**同模型 exec 自审(degraded · config-disabled)**:localconfig `disable_external_review=true`,异质外部评审降级为同族模型隔离冷审。已按 blueprint 变体 checklist C1–C6 逐项核对 TC.md + TECH.md,并**逐字核对 worktree 真实代码**验证 TECH 的 grounded 前提,而非仅信任文档自述。

## 已核实为真、无需改动的强项(便于主对话区分「已验」与「待改」)

- **TECH grounded 前提全部属实(逐一读码核对)**:
  - `src/host/host.ts` L169-173 `pty.kill` 确无 `client.sessions.has` 守卫;L175-179 `pty.cwd` 同类缺陷属实(CR-1 的安全前提成立)。
  - `src/host/ptyPool.ts` L46 `{ ...process.env, ...opts.env }` → L54 `pty.spawn(..., { env })`,token 走 env 确会被 PTY 继承,`delete` 是必要动作(ARCH-R3-1 属实)。
  - `PortLike`(host.ts L36-45)语义与 WS message/close/send 对齐,`attachClient`(L88-140)多客户端/归属/回收逻辑可被 WS 直接复用,pty:input/resize/ack(L107-121)已有归属校验。
  - `src/host/watchService.ts` 为 per-client 实例、`watchId` 实例内自增,AC-6 的 watchId 隔离由现结构天然保证(TECH 论断属实)。
  - `src/shared/protocol.ts` 消息 JSON-safe、`HostInfo` 无 minCompatible、`PROTOCOL_VERSION=1`;`hostClient.ts` L22 `port: MessagePort` 硬绑、公共 API 面与 TC-G02 清单一致。
  - `forge.config.ts` node-pty external + asar unpack + prebuilds 仅留 `darwin-*`(L113-121);`release.yml` 仅单 macOS job 无 Linux 打包;`ci.yml` ubuntu 可挂 host 单测——AC-4 spike「全新 CI 能力」判断属实。
- **版本区间闭区间逻辑 TC↔TECH 完全自洽**:把 TC-A01 六条 Examples(T-001..006)逐条代入 TECH 伪代码 `negotiated=min(Vc,Vh); (Mc≤neg≤Vc)∧(Mh≤neg≤Vh)`,结果与 TC 的 result 列**逐条吻合**;且 TC Gherkin 的 `(h_ver≥c_min)∧(c_ver≥h_min)` 与 TECH 的 `max(Mc,Mh)≤min(Vc,Vh)` 代数等价。C6 此处无缺口。
- **C1 覆盖完整**:AC-1..AC-7 全部被 tests[].covers_ac 引用,无孤儿 AC、无单测 AC、无引用不存在的 AC;63 条 test id 与覆盖矩阵一一对应。
- **C3 失败/边界占比充分**:握手三违规、token 拒绝/限速、多客户端越权、畸形输入五类、静默断连、并发交错帧、D-1 降级路径均有 TC,非成功用例远超 30%。

## Checklist 逐项结论

- **C1(TC↔AC 映射)**:通过。
- **C2(TC 可执行性)**:基本通过;CR-5(常量时间/时序断言脆弱)为可执行性瑕疵。
- **C3(边界与失败用例)**:通过(占比健康)。
- **C4(TECH 架构一致性)**:通过;WS→PortLike 一层抽象复用既有契约、host 零 Electron import 维持,架构干净;仅 CR-7 一处 ::1 绑定小矛盾。
- **C5(可行性与风险)**:打包 spike 门控 + 时间盒 + D-1 兜底、安全面(熵/常量时间/loopback/禁 argv/env 抹除)均显式且到位;唯 CR-3(限速自 DoS)是需主对话/用户拍板的设计取舍,CR-8 为信道优选建议。
- **C6(TC↔TECH 对齐)**:最集中的问题域——CR-1(pty.cwd 无测 + TC-K* 悬空引用,high)、CR-2(payload 10MB vs 32MiB,high)、CR-4/CR-6(阈值与文件名占位未收敛,low)。TECH 既已定稿,这些跨文档不一致应在进 dev 前收敛。

## 给主对话的处置建议

- **进 dev 前必收敛(建议门禁)**:CR-1(补 pty.cwd 归属回归门 + 修 TC-K* 引用)、CR-2(payload 数值同步 32 MiB)。二者都直接决定 P0 用例是否有效。
- **需一次显式决策**:CR-3(限速全局单桶是否保留 / 如何豁免在线合法客户端)——建议纳入 §待决策,与 D-1 并列由用户裁决。
- **随手可清**:CR-4/CR-5/CR-6/CR-7/CR-8,dev 阶段顺带对齐即可。

> 降级说明:本次为同模型自审,缺少真正异质视角对『版本协商语义 / 限速威胁模型』的独立采样;上述 CR-3 的安全取舍建议主对话再以对抗质疑二次压测,不因单模型自审即视为定论。
