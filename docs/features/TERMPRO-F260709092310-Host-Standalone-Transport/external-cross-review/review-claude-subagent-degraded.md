---
review_model: claude-subagent-degraded
heterogeneous: false
degraded: true
degraded_mode: config-disabled
degraded_reason: "localconfig disable_external_review=true(单模型 · 异质评审降级为同模型 exec 自审 · 已 startup WARN)"
review_via: subagent
---

# 代码评审 — TERMPRO-F260709092310 Host Standalone + WS 传输 + 握手

- perspective: external-claude(降级同模型自审)
- target: code
- generated_at: "2026-07-10T00:34:00Z"
- 评审基线: `git diff main...HEAD`(33 files, +6973/-259);typecheck 0 报错;`vitest run` 113 passed(实测)
- files_read:
  - docs/.../TECH.md
  - src/host/token.ts
  - src/host/wsServer.ts
  - src/host/hostCore.ts
  - src/host/host.ts
  - src/shared/versionCompat.ts
  - src/shared/protocol.ts
  - src/renderer/services/hostClient.ts
  - src/host/__tests__/{tokenGate,wsHandshakeGate,wsMalformedInput}.test.ts
  - src/renderer/services/__tests__/hostClientVersionCheck.test.ts

## findings_summary
- blocker: 0
- high: 1
- low: 4
- info: 1
- total: 6

## findings

### CR-1 — 空 token(file/fd/stdin 通道)未拒绝 → 静默 auth bypass
- checklist: C3(边界/输入校验)
- severity: high
- location: `src/host/token.ts:69,82,87,91` + `src/host/wsServer.ts:213` + `src/host/token.ts:101-107`
- issue: `resolveToken` 只对 **env** 通道做了空值守卫(`envToken !== ''`,token.ts:69);`--token-file`/`--token-fd`/`--token-stdin` 三条通道直接 `.trim()` 返回,**无非空校验**。空/纯空白 token 源 → 解析出 `token=''`。
- rationale: `verifyToken('', '')` 恒返回 `true`(`sha256('')===sha256('')`,token.ts:103-106);而 upgrade 侧 `url.searchParams.get('token')` 对 `?token=`(空串)返回 `''`(非 `null`,故绕过 wsServer.ts:213 的 `provided===null` 拒绝分支)→ `verifyToken('', '')` 通过。结果:运维一旦把 `--token-file` 指向空/空白文件,端口闸**完全失效**,任意本机进程带 `?token=` 即可接入并 spawn PTY / 读文件。这是安全控制的 fail-open(与 TECH「token 是本机 loopback 端口唯一屏障」的威胁模型直接冲突)。
- suggestion: `resolveToken` 在**所有**通道 return 前统一断言 `token.trim().length > 0`(建议再加最小长度,如 ≥16),空即 `throw`(fail-closed);并在 `startWsServer` 入口对 `opts.token` 补一道非空断言做纵深。补 T-0xx 覆盖「空 token 文件 → 启动即拒绝」。

### CR-2 — WS upgrade 无 Origin 校验(纵深缺失)
- checklist: C3(认证/权限边界)
- severity: low
- location: `src/host/wsServer.ts:203-222`(`httpServer.on('upgrade')`)
- issue: upgrade 回调只校验 `?token=`,未校验 `Origin` 头。
- rationale: 真实屏障是 128-bit token 熵(无 token 即被 `socket.destroy()`),故不是可利用漏洞;但浏览器语境下任意本机网页均可发起 `ws://127.0.0.1:<port>` 探测,Origin 白名单是廉价的 DNS-rebinding/CSRF 式探测纵深。
- suggestion: 若客户端恒为已知 Electron/renderer origin,可对 `req.headers.origin` 做白名单(缺失/不匹配即 destroy);无法枚举则至少记 WARN。属加固项,不阻断合并。

### CR-3 — host.info-first 门控 done-flip 依赖 microtask/TCP 分段时序(脆弱)
- checklist: C1(实现 vs TECH 一致性 / 状态机健壮性)
- severity: low
- location: `src/host/wsServer.ts:129-143`(`postMessage` 内 `queueMicrotask` gate-flip)
- issue: gate 从 `awaiting-response`→`done` 的翻转靠「host.info 响应发出后下一微任务」完成;是否放行 pipelined 第二帧取决于该帧是否与 host.info 落在同一 data 事件(TCP 分段)。
- rationale: 安全性正确(`awaiting-response` 期任何帧都 violation → 无泄露,gate 从不提前放行非 host.info);但对 pipelining 客户端的「断开与否」是**非确定性**的(T-010 靠 cork/uncork 人为拼段才稳定复现)。属可维护性/契约清晰度隐患,非安全洞。
- suggestion: 要么显式声明「握手期不支持 pipelining」为对外契约并在注释固化,要么改为确定性判据(如:awaiting-response 期收到**任何** inbound 帧即 violation,不依赖 microtask 竞争窗口)——当前实现其实已接近该语义,建议去掉对 microtask 时序的隐性依赖表述。

### CR-4 — 自动生成 token 打印至 stdout,若 stdout 被重定向落盘则持久化
- checklist: C6(可观测性 / 敏感信息)
- severity: low
- location: `src/host/host.ts:59-61`(`console.log('[host] token=%s', token)`)
- issue: 自动生成 token 单行打印到 stdout 供调用方捕获(设计如此),但 TECH 声称「host 侧不落盘」。
- rationale: 若 host 以 systemd/`>logfile` 方式运行,stdout 被采集,则 128-bit token 明文进入持久日志,与「不落盘」意图相悖。ssh-exec 捕获场景无碍,但部署形态无法约束调用方。
- suggestion: 文档明确「stdout 严禁重定向到持久日志」;或改为仅在 stdout 为 TTY/pipe 时打印,落盘场景走一次性 fd/`--token-fd` 回传,避免明文入日志。

### CR-5 — `--token-file` 校验存在 TOCTOU 且跟随符号链接
- checklist: C3(资源/权限边界)
- severity: low
- location: `src/host/token.ts:76`(`fs.statSync`)→ `src/host/token.ts:82`(`fs.readFileSync`)
- issue: 先 `statSync` 校验 0600 再 `readFileSync` 读取,两步分离(TOCTOU);`statSync` 跟随符号链接。
- rationale: 同机攻击者若能在校验与读取之间替换该路径,或提供一条指向他控 0600 文件的符号链接,可影响 token 源。需对 token 文件路径有写权限,故实际利用面窄。
- suggestion: `open()` 后对**同一 fd** `fstatSync` 校验权限再读;并用 `lstat` 拒绝符号链接(或校验 `st.uid === process.getuid()`)。

### CR-6 — token 通过但未握手的连接即分配 Client/WatchService
- checklist: C3(资源清理 / 边界)
- severity: info
- location: `src/host/wsServer.ts:224-233`(`connection` → `attachClient`)→ `src/host/hostCore.ts:73-81`
- issue: `attachClient` 在 host.info 门控通过**之前**即为每条已过 token 的连接建 Client + WatchService,握手超时(10s)前一直驻留。
- rationale: 有界(受 `HANDSHAKE_TIMEOUT_MS` 约束)且需持有 token,故仅 info 级;但握手前就实例化 per-client 资源,略偏离「门控通过再落资源」的最小暴露原则。
- suggestion: 可选——把 Client/WatchService 的创建延后到 gate=done(host.info 完成)后再 attach;当前实现可接受,记录备查即可。

---

## 逐检查项小结(C1–C6)

- **C1 实现 vs TECH 一致性**:高度一致。入口分流(host.ts:36)、`wsPortAdapter`→`PortLike`→`attachClient` 复用(wsServer.ts:54/232)、闭区间版本判定(versionCompat.ts:16-31,与 TECH 伪代码 `max(Mc,Mh)≤min(Vc,Vh)` 等价)、HostInfo 追加 `minCompatible`(protocol.ts:33 + hostCore.ts:143)、pty.kill/pty.cwd 归属守卫(hostCore.ts:159-177,实锤 R3 advisory 已落地)均按 TECH 落地。唯一脆弱点见 CR-3。
- **C2 错误处理**:门控违规/超时/畸形/token 拒绝/不兼容各条失败路径均实现且带 WARN(wsServer.ts:76-80,91,215;versionCompat 结构化 error)。`ws.on('error')`(wsServer.ts:121)兜住 maxPayload 超限冒泡,AC-7 不崩他客户端由 wsMalformedInput.test.ts 6 例覆盖。未见「假设永远成功」的裸路径。
- **C3 边界条件**:loopback 强制(wsServer.ts:170)、0.0.0.0 拒绝(T-022 实测)、maxPayload=32MiB、env 读后即抹(token.ts:55-59,T-025/T-030 实测未泄露进 PTY)均到位。缺口集中在 token 空值(CR-1,high)、TOCTOU(CR-5)、Origin(CR-2)。
- **C4 KNOWLEDGE/约束**:host 侧文件(hostCore/wsServer/token/host)**零 Electron import**,远程就绪红线遵守;改契约先改 protocol.ts 亦遵守;`ws` 纯 JS 依赖不引入新 native(bufferutil external 已在冒烟阶段处理)。
- **C5 测试覆盖**:113 passed 实测通过。AC-1 全方法 WS 冒烟(wsRpcParity)、AC-2 版本矩阵含边界(T-001…007)、AC-3 token 六通道 + 失败告警不阻断(T-014…030)、AC-6 双客户端归属、AC-7 畸形六例均真跑真实 host 进程,非两端 mock。**覆盖缺口**:无「空 token 源」用例(对应 CR-1);无 Origin 用例(CR-2)。
- **C6 可观测性**:日志含 client label + 原因,token 明文不入 WARN/ERROR 日志(核对全部 logger 行)。唯一敏感项是 stdout 的 `[host] token=`(CR-4,设计内但需部署约束)。

## 结论
无 blocker。CR-1(high · 空 token 通道 fail-open)建议合并前修复并补测试;CR-2…CR-5(low)为加固/健壮性项,可择机;CR-6(info)记录备查。整体实现与 TECH 高度吻合,归属守卫与 env 抹除等安全要点已真实落地并有集成测试佐证。
