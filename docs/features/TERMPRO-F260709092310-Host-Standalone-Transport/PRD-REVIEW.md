---
prd_feature_id: TERMPRO-F260709092310-Host-Standalone-Transport
review_round: 3
review_started_at: "2026-07-09T09:30:00Z"
review_completed_at: "2026-07-09T12:10:00Z"
reviewers: [qa, architect, pl]
verdicts: {qa: APPROVE, architect: APPROVE, pl: APPROVE}
reviews:
  - role: qa
    review_scope: prd
    execution: subagent
    verdict: NEEDS_REVISION
    started_at: "2026-07-09T09:30:00Z"
    completed_at: "2026-07-09T09:40:00Z"
    files_read: [PRD.md, WS-01-remote-host.md, ROADMAP.md, host.ts, protocol.ts, hostClient.ts, ptyPool.ts]
    findings:
      - id: QA-1
        severity: high
        description: "握手超时/中断/半连接语义未定义:不发 hello、发一半断线、握手前收到业务消息,均无判据。"
        suggestion: "补超时阈值、资源回收断言、『握手前非握手消息一律拒绝』。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:超时/半开是否属 TECH 细节不该进 PRD?但「不存在可交互的半连接态」是安全行为契约而非实现参数,不定判据则 AC-2 的『不进入半连接状态』无法测。质疑不成立,采纳(阈值数值留 TECH,行为进 AC)。
          rationale: "v0.2 AC-2 补:校验完成前忽略/拒绝非握手消息;超时主动断开回收;时序图加注。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-2
        severity: high
        description: "鉴权拒绝的响应契约未定;暴力破解未覆盖;token 生成/分发渠道未说明(测试无法构造前置)。"
        suggestion: "定拒绝格式、限流或显式 Out of Scope、补 token 来源。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:loopback + ssh 隧道双前提下限流是否过度设计?steelman:同机其他用户可无限尝试 token,无限速则 128-bit 熵可被长期爆破(虽不现实,但基础限速成本极低);拒绝格式不定则测试断言悬空。部分成立:采纳「统一立即关闭(零信息)+ 基础限速」,拒绝把完整防爆破体系(锁定/审计)纳入本 Feature——超出本机端口闸定位。
          rationale: "v0.2 AC-3 补:统一关闭零信息、基础限速、token 生成分发契约(stdout 单行,BL-003 经 ssh exec 捕获);GLOSSARY 术语随 TECH 定稿再登记。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-3
        severity: medium
        description: "AC-1 冒烟清单漏 12 个 RPC,尤其 fs.watch(推送型,WS 下最易语义漂移);『与 MessagePort 一致』未定义。"
        suggestion: "补 fs.watch 至清单,定义一致性,全表覆盖归 TC。"
        category: technical-consistency
        code_evidence:
          file_path: "src/shared/protocol.ts"
          line_range: "67-121"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:冒烟清单本就是抽样,列全是否让 AC 变 TC?回读 protocol.ts:fs.watch 依赖 host 主动推送 fs:changed,是 WS 长连接下唯一新风险形态的方法类,抽样漏它 = 漏掉最该抽的样本;「一致」不定义则验收口径漂移。质疑不成立,采纳(清单补 watch/writeFile/kill,一致=功能等价,全表归 TC)。
          rationale: "v0.2 AC-1 补 fs.watch(fs:changed 经 WS 推送)+ 定义功能等价 + 全表覆盖归 TC。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-4
        severity: medium
        description: "畸形输入(非 JSON/超限/未知类型)可能崩掉共享 host 进程,单客户端 DoS 全部用户,无 AC 覆盖。"
        suggestion: "增补『不崩、仅断开发送方』验收。"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/host.ts"
          line_range: "99-123"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:嵌入式模式消息来自可信 preload,该风险是否只在 WS 面存在、可归 TECH?回读 host.ts:99-123:消息分发确无异常边界;WS 面开放后任何本地进程可发任意字节,进程级崩溃波及全部客户端会话,这是行为契约级底线不是实现细节。质疑不成立,采纳为新 AC-7(P0)。
          rationale: "v0.2 新增 AC-7:畸形输入不崩 host、不波及他客户端、仅断开发送方。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-5
        severity: medium
        description: "WS 静默断连(无 FIN/RST)检测机制未定,AC-6『断开即回收』在网络分区下不可测。"
        suggestion: "定心跳策略为显式验收点;watchId per-client 隔离纳入验证。"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/host.ts"
          line_range: "126-136"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:loopback 验收场景不存在拔网线,心跳是否为 BL-005 的活?steelman:静默断连在 loopback 也会发生(客户端进程被 kill -9 时 OS 会关 socket…实际会发 RST;但挂起/僵死进程不会)——僵死客户端不回收 = 会话/watcher 泄漏,这是本 Feature 的资源回收契约,BL-005 管的是重连不是回收。质疑不成立,采纳(心跳参数 TECH 定,行为进 AC-6)。
          rationale: "v0.2 AC-6 补:心跳超时视同断开回收(参数 TECH 定)。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-6
        severity: medium
        description: "AC-6 本质是跨客户端越权防线,category=functional/P1 与其安全属性不匹配。"
        suggestion: "category 改 security。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:归属校验逻辑已存在(host.ts:107-121),这是回归项不是新安全面,改类是否形式主义?但分类决定它进哪个测试套件与回归清单,WS 多连接是该防线首次暴露给不可信对端,归 security 使其不可被带宽降级跳过。质疑不成立,采纳(priority 维持 P1,category 改 security)。
          rationale: "v0.2 机读块 AC-6 category: security。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-7
        severity: low
        description: "『UI 呈现』措辞与 requires_ui:false 矛盾,验收口径歧义。"
        suggestion: "改『客户端捕获结构化错误』或翻 flag。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:错误最终总要给人看,去掉 UI 字样是否掩耳盗铃?本 Feature 的交付边界是「信息结构化送达调用方」,呈现复用既有错误提示机制(零新组件),两层分开后 requires_ui=false 自洽。质疑不成立,按非 UI 通道采纳(与 PL-4 同源合并处理)。
          rationale: "v0.2 AC-2/交付预期改『捕获结构化错误(含双方版本号),呈现复用既有机制,无新 UI 设计面』。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: QA-8
        severity: low
        description: "AC-4『正常启动』无可观测信号,CI 无法自动判定。"
        suggestion: "定义可 grep 的固定日志行。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:日志格式是否属 TECH?格式细节是,但「存在机器可判定的就绪信号」是验收可自动化的前提,PRD 定信号存在性+示例,TECH 定确切格式。质疑不成立,采纳。
          rationale: "v0.2 交付预期+AC-4:固定 listening 日志行(示例格式)作 CI 判定。"
          responded_at: "2026-07-09T10:10:00Z"
  - role: architect
    review_scope: prd
    execution: subagent
    verdict: NEEDS_REVISION
    started_at: "2026-07-09T09:30:00Z"
    completed_at: "2026-07-09T09:45:00Z"
    files_read: [PRD.md, WS-01-remote-host.md, ROADMAP.md, 业务架构与产品规划.md, ARCHITECTURE.md, host.ts, protocol.ts, hostClient.ts, main.ts, preload.ts, package.json, forge.config.ts, vite.host.config.ts]
    findings:
      - id: ARCH-1
        severity: high
        description: "『版本兼容』按双端同源/严格相等定义与远程漂移前提自相矛盾——客户端一升级远程 host 未同步就全拒。"
        suggestion: "兼容 = 最低兼容区间(welcome/reject 带 protocolVersion+minCompatible);前提改『嵌入式同源/远程可漂移』。"
        category: technical-consistency
        code_evidence:
          file_path: "src/shared/protocol.ts"
          line_range: "4"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:v1 只有一个版本,区间是否 YAGNI、严格相等更简单?steelman 我自己的原稿:loopback 验收双端确同源,== 能过验收——但握手规则一旦写死,首个漂移场景(BL-003 部署后客户端升级)就会把「兼容拒绝」变「全拒」,而那时改规则 = 改已部署 host。规则必须在首次部署前就是区间制。质疑不成立,采纳。
          rationale: "v0.2 AC-2 改最低兼容区间(含『区间内不相等仍可连』正例);§背景/隐藏前提改『远程可漂移』;PROTOCOL_VERSION 策略归本 Feature 所有。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: ARCH-2
        severity: medium
        description: "hello/welcome/reject 三新消息疑似过度设计:版本已由 host.info 承载;且握手层次(传输层 vs 协议层)未澄清,恐侵入嵌入式路径抵触 AC-5。"
        suggestion: "复用 host.info 校验;若坚持独立握手须声明仅 WS 前导、嵌入式零往返。"
        category: technical-consistency
        code_evidence:
          file_path: "src/renderer/services/hostClient.ts"
          line_range: "96-99"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:独立握手消息是否更利于未来扩展(能力协商/加密参数)?steelman 原设计:专用握手帧语义更清晰——但现需求只有版本+身份,host.info 已全承载且是连接后既有首调,新消息类型 = 三处联合类型膨胀 + 嵌入式路径被迫兼容;未来真要能力协商时区间版本本身就能引导升级。质疑不成立,采纳复用方案(时序图已改)。
          rationale: "v0.2 时序图改为『WS upgrade 带 token → 首调 host.info(附 minCompatible)→ 客户端区间校验』;AC-5 增『校验不侵入嵌入式路径』;不新造握手消息类型。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: ARCH-3
        severity: medium
        description: "token 是远程机同租户隔离的真实边界(ssh 只挡网络入口),AC-3 只验有无,未约束熵与比较方式。"
        suggestion: "≥128-bit 随机、常量时间比较、基础限速;威胁模型更正为同租户。"
        category: security
        code_evidence:
          file_path: "src/host/host.ts"
          line_range: "88"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:把熵/常量时间写进 PRD 是否下沉过深?这三项是安全 AC 的可验证判据而非实现选型(对应测试:token 长度断言/比较函数审查),不写则 AC-3 退化为存在性检查;威胁模型错位会误导 blueprint 把 token 当形式。质疑不成立,采纳。
          rationale: "v0.2 §背景新增认证边界段(同租户威胁模型);AC-3 补熵/常量时间/限速。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: ARCH-4
        severity: medium
        description: "探索性打包 spike(R1)与确定性传输工作捆死在同批 P0,协议侧完成也可能被 spike 卡死无法 complete。"
        suggestion: "spike 门控子阶段+兜底路径满足 AC-4,transport+handshake 可独立落地。"
        category: quality
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:分阶段是否给了「打包永远做不完」的口子?不会——AC-4 仍是 P0 交付物,门控只改变其与其他 AC 的耦合方式(独立验收),且 D-1 预案把 spike 失败的出口显式化为用户裁决而非静默降级。质疑不成立,采纳(与 PL-3 同源)。
          rationale: "v0.2 AC-4 标注门控 spike、独立分阶段交付;待决策项 D-1 预案。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: ARCH-5
        severity: low
        description: "PROTOCOL_VERSION 与 BL-001 并行同改,递增规则无协调(双方都 bump 到 2 会打架)。"
        suggestion: "向后兼容追加不 bump;由后合者统一,与区间语义一致。"
        category: technical-consistency
        code_evidence:
          file_path: "src/shared/protocol.ts"
          line_range: "4"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:BL-001 加 workspace.* 后旧 host 收到未知方法会报错,是否必须 bump?回读 host.ts:242-243:未知方法走统一 error 响应不崩溃,客户端可优雅处理——「新增可选 RPC = 向后兼容不 bump」成立;规则 owner 归本 Feature(校验执行者)职责清晰。质疑不成立,采纳。
          rationale: "v0.2 §开工前·隐藏前提② 写明版本策略与 owner;BL-001 侧 v0.2 已同步注明不 bump。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: ARCH-6
        severity: low
        description: "『PTY 二进制流』措辞失准:现协议全 JSON-safe 字符串;WS 线格式/分帧未定。"
        suggestion: "钉死 JSON 文本帧、措辞改『PTY 输出流』。"
        category: technical-consistency
        code_evidence:
          file_path: "src/shared/protocol.ts"
          line_range: "145"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:钉死 JSON 文本帧会不会堵死未来二进制帧优化?不会——这是本 Feature 的交付口径(最小改动复用现形状),未来优化是显式的协议演进(配合版本区间);现在含糊反而诱导 blueprint 发明二进制分帧。质疑不成立,采纳。
          rationale: "v0.2 §开工前·涟漪:WS = JSON 文本帧承载既有消息形状。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: ARCH-7
        severity: low
        description: "新增 ws 运行时依赖未登记;host.info.hostId 硬编码 'local' 与模型 A 的机器身份归属需标注。"
        suggestion: "登记依赖入打包;Out of Scope 注明 hostId 归下游。"
        category: technical-consistency
        code_evidence:
          file_path: "src/host/host.ts"
          line_range: "152"
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:依赖登记是否纯 TECH 事务?ws 是 host 打包矩阵的输入(影响 AC-4 产物),PRD 层一句登记防 blueprint 漏算;hostId 不标注则评审者会误以为本 Feature 要交付机器身份。质疑不成立,采纳。
          rationale: "v0.2 §涟漪登记 ws 依赖;Out of Scope 增 hostId 沿用 'local' 条目。"
          responded_at: "2026-07-09T10:10:00Z"
  - role: pl
    review_scope: prd
    execution: subagent
    verdict: NEEDS_REVISION
    started_at: "2026-07-09T09:30:00Z"
    completed_at: "2026-07-09T09:50:00Z"
    files_read: [PRD.md, WS-01-remote-host.md, ROADMAP.md, 业务架构与产品规划.md, release.yml, forge.config.ts]
    findings:
      - id: PL-CHALLENGE-1
        severity: high
        description: "PRD 自相矛盾:Out of Scope 称『不自研认证』,AC-3 却要求 token 鉴权;从 M5 文档到 WS-01 无一处讲清二者如何共存。"
        suggestion: "显式区分跨网信任(ssh 承担)与本机端口闸(capability token),改 Out of Scope 措辞。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:读者是否自然能懂 token≠认证协议、无需专门厘清?实证反驳:三个冷审里两个(PL/QA)都被这对措辞绊住,说明歧义真实存在;且「不自研认证」是 M5 的产品级承诺,与 P0 安全 AC 字面冲突必须在文档层解决。质疑不成立,采纳。
          rationale: "v0.2 §背景新增『认证边界厘清』段(两层认证);Out of Scope 改精确措辞。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: PL-CHALLENGE-2
        severity: medium
        description: "token 生成/分发/生命周期未定义,是 BL-003 依赖的跨 Feature 接口契约,不定义会倒逼 BL-003 回改本 Feature。"
        suggestion: "补 AC 或开工前登记:未传入自动生成+stdout 打印+进程存活期固定。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:token 来源是否 TECH 细节?其「如何被外部调用方拿到」是跨 Feature 接口承诺(BL-003 的 ssh exec 捕获依赖它),接口锚点属 PRD 层;具体实现(crypto API 选型)仍归 TECH。质疑不成立,采纳进 AC-3。
          rationale: "v0.2 AC-3 补 token 生成与分发契约(stdout 单行/存活期固定/不落盘不轮换),显式标注供 BL-003 引用。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: PL-CHALLENGE-3
        severity: medium
        description: "AC-4(高风险探索 spike,仓库零 Linux 打包基建)与确定性 AC 同批全绿才过,会拖累核心交付;缺降级/合并策略。"
        suggestion: "写明 spike 失败时的合并策略与降级路径。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:允许分阶段合并是否变相降低 P0 承诺?不是——AC-4 维持 P0 且有 D-1 显式出口(兜底或用户裁决延期),分阶段只解耦验收时序;release.yml 仅 macos-14 的现状证实 Linux CI 是全新能力,捆死确有拖垮风险。质疑不成立,采纳(与 ARCH-4 合并处理)。
          rationale: "v0.2 AC-4 门控+独立交付;D-1 预案;§开工前 CI 隔离注记(不阻塞 macOS 发版)。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: PL-CHALLENGE-4
        severity: medium
        description: "requires_ui:false 与 AC-2/交付预期的『UI 呈现』矛盾,流程会跳过 UI 设计而验收又要 UI。"
        suggestion: "二选一:降为非 UI 通道并去『UI』字样,或翻 flag。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:选非 UI 通道是否把错误体验推给『以后没人管』?不会——信息送达(结构化错误)是本 Feature 契约,呈现复用既有错误提示机制且 BL-003/BL-004 的连接 UI(全景已含连接失败态)才是该体验的正主。质疑不成立,按方案(a)采纳(与 QA-7 同源)。
          rationale: "v0.2 全文去『UI 呈现』,改『客户端捕获结构化错误+复用既有提示机制』。"
          responded_at: "2026-07-09T10:10:00Z"
      - id: PL-CHALLENGE-5
        severity: low
        description: "AC-6 边际价值存疑:归属校验逻辑传输无关已就绪,该 AC 到底验证传输特有的什么?不说明易被执行者跳过。"
        suggestion: "补一句 AC-6 验证的传输特有风险。"
        category: premise-challenge
        pm_response:
          action: ADOPT
          adversarial_self_check: |
            质疑:是否干脆砍掉 AC-6(逻辑推论已覆盖)?steelman 保留方:PortLike 包装层是新代码,WS 并发连接的帧序/缓冲与 MessagePort 语义不同,归属判定依赖 client 映射在新传输下首次受真并发压力——这是真实的传输特有面。砍掉质疑不成立,采纳「保留+写明验证目标」。
          rationale: "v0.2 AC-6 括注传输特有风险(并发 WS 连接的消息路由/归属判定不因帧序缓冲错乱)。"
          responded_at: "2026-07-09T10:10:00Z"
overall_verdict: APPROVE
next_round_required: false
overall_decided_at: "2026-07-09T12:10:00Z"
---

# PRD-REVIEW（TERMPRO-F260709092310-Host-Standalone-Transport）Round 1

冷审三方(隔离 subagent):QA=NEEDS_REVISION(8) · Architect=NEEDS_REVISION(7) · PL=NEEDS_REVISION(5 · 含 PL-CHALLENGE 段)。
PM 全部 20 条逐条对抗自查后 ADOPT(QA-2 部分采纳:基础限速纳入、完整防爆破体系明确拒绝为过度设计;ARCH-2 采纳后放弃独立握手三消息的原设计)· PRD 修订至 v0.2。

## PL-CHALLENGE 段(六问结论)

① 价值前提:成立(S2 是 S3/S5 唯一前置,硬阻塞依赖)。② 问题定义:真问题(三个代码缺口均可验证);「传输」与「打包 spike」两类性质已用门控解耦。③ 范围最小化:AC-4 门控化、AC-6 保留但写明验证目标。④ 上游对齐:token 有 WS-01-S2 授权,与「不自研认证」的共存已在 v0.2 背景厘清(PL-1)。⑤ 复活检查:无。⑥ 既有行为变更:无(AC-5 P0 钉死零回归);CI 新增构建不阻塞既有发版已注记。

## 整合结论(Round 1)

- overall_verdict: NEEDS_REVISION → PRD 已修订 v0.2
- next_round_required: true → Round 2 验证模式(重派冷 Agent 核实 fix + 找新)

---

# Round 2(验证模式 · 重派冷 Agent)

Round 1 的 20 条:QA 6/8 VERIFIED-FIXED(QA-1/QA-5 残留)· Arch 7/7 站得住(2 条派生残留)· PL 5/5 VERIFIED-FIXED。新 finding 9 条 + 2 条残留,PM 处置 → PRD 修订 v0.3:

### qa(R2)· verdict: NEEDS_REVISION → 处置

- **QA-1 残留** 「忽略/拒绝」二值未钉死。ADOPT → v0.3 AC-2 钉死「断开连接」(与 host.info-first 门控合并为单一可测行为)。
- **QA-5 残留** watchId 隔离被静默半采纳(处置纪律问题,QA-R2-4 同源)。承认失误并 ADOPT → v0.3 AC-6 补 watchId 与 sessionId 同构验证;本轮起多子项 finding 逐子项交代。
- **QA-R2-1(高)** AC-2「双方互查」措辞 vs 单向机制不一致。与 ARCH-R2-1 同源,ADOPT → v0.3 AC-2 拆两段:客户端单方互区间判定(四数齐备)+ host 仅做顺序/资源门控(非版本 enforcement)。
- **QA-R2-2(中)** 限速/payload 上限缺阈值注记。ADOPT → v0.3 补「TECH 定 + 量级示例」(限速 ~10 次/分;payload ~10MB 且须容纳 readFileBinary base64 帧)。
- **QA-R2-3(中)** loopback 下源 IP 限速失效。ADOPT → v0.3 AC-3「按连接尝试计数,不依赖源地址」。
- **QA-R2-4(低 · 流程)** 多子项 finding 的处置完整性。ADOPT(纪律修正,见 QA-5 残留处置)。

### architect(R2)· verdict: NEEDS_REVISION → 处置

- **ARCH-R2-1(med)** 复用 host.info 后校验者/门控条件自相矛盾(host 拿不到客户端版本,无法做版本拒绝;门控事件应为 host.info-first;须 WS-scoped)。PM 自查:steelman v0.2 写法(host 主动防御更纵深)——但 host 侧版本 enforcement 必须回传客户端版本 = 重新膨胀刚砍掉的握手往返,且客户端四数齐备可单方判定,纵深收益为零。ADOPT → v0.3 AC-2 重写(客户端判定 + host 顺序门控 + 仅 WS 生效),时序图同步。
- **ARCH-R2-2(med-high)** token 显式传入经 argv 会被 /proc/cmdline 泄露,击穿同租户边界。ADOPT(信道白名单部分裁量:Arch 建议禁 argv/env,PL-R2-3 论证 /proc/environ 仅同 uid 可读、env 不违威胁模型——采 PL 论证,禁 argv、允许 env/stdin/fd/0600 文件)→ v0.3 AC-3 ②。
- **ARCH-R2-3(low)** minCompatible 缺省语义未定。ADOPT → v0.3 AC-2「缺省视同等于 protocolVersion」。
- **ARCH-R2-4(low)** fs.watch 递归 linux 依赖 node≥20。ADOPT → v0.3 涟漪注记 + D-1 兜底基线绑定 + engines 建议。
- **ARCH-R2-5(low)** ARCHITECTURE.md「二进制流」口径漂移。ADOPT → v0.3 涟漪登记,dev 阶段顺带校正(PRD 外产物不在本文件改)。

### pl(R2)· verdict: NEEDS_REVISION → 处置

- **PL-CHALLENGE-R2-1(high)** token 契约未覆盖重连场景,将倒逼 BL-005 回改「不落盘不轮换」。PM 自查:质疑「重连是 BL-005 的事,本 PRD 是否越界」——但契约措辞「不落盘」若不区分 host/client 侧,字面上已禁掉 client 缓存,这是本契约自己挖的坑必须自己填。ADOPT → v0.3 AC-3 ③「host 侧不落盘;不禁止 client 缓存复用;再获取机制归 BL-003/BL-005」。
- **PL-CHALLENGE-R2-2(med)** D-1 失败判据不可操作。ADOPT → v0.3 D-1 补时间盒(≤2 工作日)+ 可枚举方案集 + 客观判据原则。
- **PL-CHALLENGE-R2-3(med)** 显式传入信道空白。与 ARCH-R2-2 同源 ADOPT(见上)。
- **PL-CHALLENGE-R2-4(low)** hostId 归属标注错(BL-001 不产机器身份)。ADOPT → v0.3 改「生产归 BL-003 · 消费归 BL-004」。

overall_verdict(R2): NEEDS_REVISION → PRD v0.3 · next_round_required: true → Round 3 验证

---

# Round 3(验证模式 · 收敛)

- **qa: APPROVE** — 残留 2 条 + R2 四条全 VERIFIED-FIXED(断开语义钉死 · watchId 同构验证 · AC-2 拆分可写确定性 TC · 阈值量级 · 限速维度)。advisory:QA-R3-1(**实锤**:现代码 `pty.kill` RPC 路径缺 `client.sessions.has` 归属校验,AC-6 的 TC 必须覆盖此路径)· QA-R3-2(区间语义 TECH 给闭区间伪代码)· QA-R3-3(量级锚点须 TECH 落定后再写断言 TC)。
- **architect: APPROVE** — R2 五条全 VERIFIED-FIXED(AC-2 两段自洽无 enforcement 残句 · 信道白名单 · env 裁量技术正确 · minCompatible 缺省 · 措辞漂移登记)。advisory:ARCH-R3-1(**重要**:ptyPool 以 `{...process.env}` spawn shell,token 走 env 时 host 读取后必须 `delete process.env.<VAR>` 再 spawn)· ARCH-R3-2(交付预期「连接关闭」可收紧为「客户端主动断开」)。
- **pl: APPROVE** — R2 四条全 VERIFIED-FIXED(host/client 侧不落盘区分闭环 BL-005 · D-1 判据三要素可操作 · 信道裁决与威胁模型自洽 · hostId 归属对齐 WS)。advisory:PL-R3-1(D-1 时间盒耗尽即判失败,不因方案未试完顺延)· PL-R3-2(client 缓存 token 的持久化介质 BL-003/005 开工前钉死,建议比照凭据入钥匙串)。

**收敛:verdicts 全 APPROVE · PRD 定稿 v0.3 · 交付 blueprint 的 advisory 清单:QA-R3-1/2/3 · ARCH-R3-1/2 · PL-R3-1/2。**

> 用户已确认 PRD v0.3(2026-07-09 · 选项 1)· status→confirmed · business_direction_locked→true
