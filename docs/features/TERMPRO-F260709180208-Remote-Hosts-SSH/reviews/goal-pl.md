# PL 对抗质疑 · BL-003 远程机管理与 SSH 连接编排（Goal Stage）

- **角色**：Product Lead（隔离冷审 · 未参与起草 · 职责 = 试图杀死或缩小本 Feature）
- **评审对象**：`docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/PRD.md`（v0.1）
- **日期**：2026-07-10

## verdict

**NEEDS_REVISION**（轻量修订 · 方向成立不需重做）

一句话：本 Feature 在**价值前提上不可杀**——它是让已交付的 BL-001/BL-002 首次产生用户可见价值的「拱心石」，且源于用户明确诉求；**复活检查干净**；对 Q-002/自动部署/模型 A 边界**忠实承接**。但存在一处**实质的上游保真裂缝**（凭据存储语义 safeStorage vs 上游 4 份文档「仅存钥匙串」的矛盾未被消解，且以批量「ok」登记为已裁决），加上 2-3 处可收缩项。修订成本很低（对齐台账 / 拆 AC / 标注释放阀），不动 Feature 骨架。

## files_read

- `docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/PRD.md`（评审对象 v0.1）
- `docs/features/TERMPRO-F260709180208-Remote-Hosts-SSH/YOLO-PREFLIGHT.md`（意图锚 · 6 决策）
- `product-overview/workstream/WS-01-remote-host.md`（WS-01-S3 权威 + R1-R5 风险）
- `product-overview/TermPro_业务架构与产品规划.md`（Q-002 line 126 / Q-003 line 127 / Host 独立可执行 line 96）
- `docs/ROADMAP.md`（BL-003 行 line 29 + 依赖图）
- `project-specs/KNOWLEDGE.md`（OS-001…OS-005 已否方向 + GO-008 版本握手）
- `docs/design/sitemap.md`（`/settings/remote-hosts` line 13）

---

## findings

### PL-CHALLENGE-1 · 凭据存储语义与上游 4 份文档矛盾（保真裂缝 · 批量 ok ≠ 隔离确认）
- **severity**: major
- **category**: premise-challenge
- **对应质疑**：④ 上游对齐 + ⑥ 既有/已定属性变更
- **description**：上游 **4 处**对凭据存储的原文措辞一致且明确为「**凭据本体入系统钥匙串**」——
  - Q-003（业务规划 line 127）：「密码凭据存**系统钥匙串**」
  - Host 独立可执行（业务规划 line 96）：「密码凭据存**系统钥匙串**」
  - ROADMAP BL-003 核心 AC③（line 29）：「凭据**仅存钥匙串**零明文」
  - WS-01-S3 核心 AC③ / sitemap line 13：「密码凭据存**系统钥匙串**」

  而 PRD 的 D-2 / AC-3 改成 **Electron safeStorage 语义**：加密**密钥**在钥匙串、凭据**密文落 userData 文件**。PRD 自己承认「接受与 AC『仅存钥匙串』字面差异」。这不是措辞差异，是**威胁模型差异**：safeStorage 密文落盘意味凭据密文进入 userData → 会被 **Time Machine / 备份**捕获；而 Keychain 条目有独立保护域。用户当初说「存钥匙串」很可能正是为「secret 不落应用文件」。**问题不在于 safeStorage 本身不合理**（它是 Electron 惯用法、零 native 依赖，合理），而在于：(a) 用户对此差异的同意是 YOLO-PREFLIGHT 里 **6 项批量「ok」= 全按推荐**的一环，不是对「密码会以密文落在 App 文件里而非 OS 钥匙串」这一安全属性变更的**隔离知情确认**；(b) 修订后 4 份上游文档**仍写着「仅存钥匙串」**，与 PRD 形成未消解的台账矛盾，会误导 BL-004/BL-005 与未来读者。
- **suggestion**：二选一消解矛盾——**要么**把 D-2 从「已裁决」回退为 §待决策项，用一句人话向用户复述可感知差异（「密码会以加密文件形式存在 App 数据目录，会进入 Mac 备份；OS 钥匙串仅存解密密钥」）请其对该单点重新拍板；**要么**（若维持 safeStorage）落一条 ADR，并**同步修订** Q-003 / ROADMAP AC③ / WS-01-S3 AC③ / sitemap 的「仅存钥匙串」措辞为「safeStorage（密钥在钥匙串·密文落 userData）」，消除台账矛盾。任一路径成本都 < 15 分钟。

### PL-CHALLENGE-2 · AC-8 部分重述已交付的 BL-002 能力 + Origin 校验对本形态的适用性存疑
- **severity**: minor
- **category**: premise-challenge
- **对应质疑**：③ 范围最小化
- **description**：AC-8 把三件事捆一起（P1 · PENDING-003 并入）：(a) 非白名单 **Origin 拒绝**，(b) 认证失败**告警节流**，(c) token 交接无 TOCTOU / 不落远端持久日志。其中——
  - (b) 告警节流：YOLO-PREFLIGHT §1 明确 **BL-002 已交付**「认证失败滑动窗告警 `onAuthAlert`」。AC-8 把它重述为 BL-003 新 AC，有**返工/凑数**风险。
  - (a) Origin 白名单：本连接是 **Electron 自家 renderer** 经 SSH 隧道直连 `127.0.0.1:<ephemeral port>?token=…`，**不存在浏览器 Origin**；token 已被 PRD 自认「仍是主屏障」。浏览器 Origin 头校验防的是「恶意网页经 DNS-rebinding 打本地回环端口」这类场景，对「桌面 App + 每连接临时端口 + token」的纵深收益很薄，属于对**不适用威胁**的加固。
- **suggestion**：拆 AC-8。(b) 改判据为「**验证** BL-002 既有 `onAuthAlert` 节流仍生效 + 补回归测试，**不重建**」。(a) 若保留须写明具体威胁（回环端口的 rebinding/CSRF-to-WS）否则降 P2 或移出 v1；token 交接/日志零明文（c）是本 Feature 真新增，保留 P1。

### PL-CHALLENGE-3 · AC-10 可延后，但「凭据清理」半段有安全理由不能一并砍
- **severity**: minor
- **category**: premise-challenge
- **对应质疑**：③ 范围最小化
- **description**：AC-10（P2）= 删除机器时 (i) 凭据从加密存储清除 + (ii) 有活跃连接先断开再删。质疑面点名 AC-10 是否 v1 必要：其中 (ii) 是可延后的边缘态；但 (i) **凭据清理**若不做，会在 safeStorage 里留下**孤儿密文凭据**，直接削弱 AC-3 的「凭据生命周期零残留」叙事——这半段有安全卫生理由，不宜与 (ii) 一起砍。
- **suggestion**：保持 AC-10 P2，但在描述里把 (i) 凭据清理标为「随删必做」（AC-3 的自然收尾），(ii) 断连再删可作为容错增强延后。避免整条 AC 被当纯 P2 一刀切掉。

### PL-CHALLENGE-4 · 自动部署（AC-4/AC-9）是关键路径上最重的技术赌注 · R1 已备 npm 兜底
- **severity**: minor
- **category**: premise-challenge
- **对应质疑**：② 问题定义 + ③ 范围最小化
- **description**：AC-4（SFTP 上传 bundle + 版本探测 + 拉起）是本 Feature **单点最重**的一块，AC-9 是其失败兜底。WS-01 **R1 缓解**（line 216）已写明存在更轻的路线：「远程机 node ≥20 + **npm 包安装 host**」。也就是说 v1 的**核心用户价值（连上远程机跑终端）**其实只需 隧道 + 握手 + 手动装好的 host 就能达成，自动部署是体验增益而非价值必要项。**我不主张砍**（它是 ROADMAP 核心 AC② · 用户已批），但它应被显式标为**时间线告急时的释放阀**（退回 npm 手装引导）。另外自动部署的**头号失败态是半成品**——PRD 隐藏前提已提「不留半成品状态」，但需在 blueprint 保证**幂等重部署**（版本不符→覆盖而非叠加）。
- **suggestion**：在 PRD §Out of Scope 或风险区显式记「若关键路径告急，AC-4 自动部署可退回 R1 的 npm 手装兜底路线（连接/握手不受影响）」，把它标成可控释放阀；并在 AC-9/AC-4 补一句「重部署幂等（覆盖旧产物）」验收要求。

### PL-CHALLENGE-5 · D-5「部署即驻留」把 BL-005 会话存活模型的一角提前拉进 BL-003
- **severity**: minor
- **category**: premise-challenge
- **对应质疑**：④ 上游对齐（边界）
- **description**：WS-01-S3 范围与 ROADMAP BL-003 均**未提进程驻留**；驻留/会话存活是 WS-01-S5 / BL-005（R3）的地盘。D-5 让 BL-003 就「以驻留方式启动」host，同时又说「UI 断开后会话仍按 hostCore 现行为回收」——形成**驻留但回收**的中间态。风险：UI 断开后，host 进程按什么被收？若「进程驻留」但「会话回收」两条语义没对齐，可能在远端**留下孤儿 host 进程**（端口占用 / 资源泄漏），而真正的存活语义要等 BL-005 才补。虽 D-5 已预授权，但边界处的资源生命周期需要在 blueprint 明确。
- **suggestion**：blueprint 明确 BL-003 阶段「UI 断开」时远端 host 进程的确定性归宿（是随隧道关闭而退，还是驻留等 BL-005 认领）；若驻留，须有**孤儿进程回收/幂等再连认领同一进程**的兜底，避免多次连接堆叠 host 进程。可在 PRD §Out of Scope 补一句界定 BL-003 只保证「无孤儿进程泄漏」，存活/认领归 BL-005。

---

## 六问逐条留痕（含通过项）

- **① 价值前提（谁用 / 不做会怎样）**：✅ 不可杀。本 Feature 是让**已交付**的 BL-001（workspace 注册表迁 Host）+ BL-002（standalone host + WS + 握手）首次产生**任何用户可见价值**的拱心石——不做则前两波沉没成本归零。且源于用户明确诉求（WS-01 line 107「配置 SSH 登录后部分项目用远程机开发」）。无杀点。
- **② 问题定义（真问题 vs 方案伪装）**：✅ 真问题（连不上真实远程机）。唯一「方案味」是自动部署，已在 PL-CHALLENGE-4 处理（有 R1 npm 兜底，标释放阀即可）。
- **③ 范围最小化**：见 PL-CHALLENGE-2/3/4。**对质疑面点名的 AC-7（最近使用）我不主张砍**——它同时被 Q-003（line 127「最近使用 + 手动添加」）与 sitemap（line 13「最近使用只读快捷区·含相对时间」）**双重上游确认**，且实现上仅是对既有 host 列表按 `lastConnectedAt` 排序的薄封装，成本低、保真。砍它反而偏离已确认全景。
- **④ 上游对齐**：主体忠实（CRUD/测试连接/自动部署/模型 A 边界均可 cite 对应上游行）。唯一裂缝 = 凭据存储语义（PL-CHALLENGE-1）+ 驻留边界（PL-CHALLENGE-5）。**未发现擅自扩范围**：PENDING-003（AC-8）与自动部署均有 YOLO-PREFLIGHT §2 用户确认背书。
- **⑤ 复活检查**：✅ 干净。`~/.ssh/config 导入`被 PRD 正确列入 Out of Scope（Q-003 已否），「最近使用」由 TermPro 自身成功连接填充、**非**读取 ssh config，不构成换皮复活。OS-004（Windows/Linux 支持）**未被复活**——PRD 的「连 macOS 客户端 → Linux 远端 host」是 M5 远程设计的既定轴（BL-002 已出 linux-x64 二进制），与 OS-004 所指「TermPro 客户端跑在 Win/Linux」是不同轴。OS-001/002/003/005 与本 Feature 无交集。
- **⑥ 既有行为变更**：PRD 声明「无既有可感知默认行为变更」，对**运行时行为**成立（本地嵌入式 host 路径零变化、dev 开关保留、per-host 注册表须保本机路径不变）。唯一「原 A→现 B」= 凭据存储从已定的「仅存钥匙串」变为「safeStorage 密文落盘」，虽登记进 §待决策项表但标为**已裁决**而非开放 —— 已并入 PL-CHALLENGE-1 要求消解。

---

# Round 2 验证（PRD v0.2 + ADR-001 · 2026-07-10）

**verdict：APPROVE**（5 条 Round 1 质疑全部有效消解 · PL-CHALLENGE-1 的 REJECT 理由**接受** · 仅留 2 条非阻塞残留 note）

files_read（增量）：PRD.md v0.2 · `adrs/ADR-001-credential-storage-safestorage.md` · `adrs/INDEX.md` · 复核 4 处上游台账实际同步状态（grep 验证）。

## 逐条处置复核

### PL-CHALLENGE-1 → **接受 REJECT + 确认 remedy B 已落地**（原 major → resolved）
- **REJECT（不回退重问用户）我接受，理由成立且经我复核**：我 Round 1 最强论据是「批量 ok ≠ 隔离知情确认」。回读 `YOLO-PREFLIGHT.md §2 决策表第 2 行`原文——它**在自己那一行就摊开了**关键事实：「加密密钥在系统钥匙串、凭据密文落 userData（零明文落盘）；接受与『条目直存钥匙串』的字面差异」。差异**没有埋在散文里**，是逐行列明的表格项；yolo 前置授权设计下，用户审阅逐行决策表后回「ok = 全按推荐」正是既定的知情同意机制。我原论据的事实前提（差异未被单独摊开）被证伪 → 再回退重问 = **re-litigate 用户已在事实在场下做过的决定**，违反「不重开已决决策」。故我撤回该 remedy（REJECT 正确）。
- **威胁增量小 我也复核为技术成立**：safeStorage 密文即便随 userData 进 Time Machine，解密密钥仍在登录钥匙串（且钥匙串本身受登录密码保护）；备份/文件泄漏获得者拿到的是**无密钥密文 ≠ 明文**。与 keytar 的实际安全差是「密文多存在一处 App 文件位置」，而该处仍是密文。ADR-001 §威胁模型段准确表述了这一点。属可接受增量。
- **remedy B（ADR + 上游同步）已执行**，我 grep 复核 4 处**决策-of-record 位置全部同步**：业务规划 Q-003 行（line127 已注「实现语义 = safeStorage…ADR-001」）、WS-01-S3 核心 AC③（line184）、ROADMAP BL-003 AC③（line29）、sitemap remote-hosts 行（line13）均已带 safeStorage + ADR-001 指针。ADR-001 结构完整（背景/决策/威胁模型/影响 + 私钥不适用声明）。台账主矛盾消除。

### PL-CHALLENGE-2 → **ADOPT · 已消解**
AC-8 已拆三条（8 token 交接 P1 / 9 节流 P1 / 10 Origin P2）。① 我 Round 1 对「节流疑似 BL-002 已交付」的质疑——团队**做了我要求的『先验证不重建』**，验证结论是：BL-002 只交付了告警本身，超阈值后**每次失败都 emit = 刷屏**，节流（每窗口 ≤1 次）是**真缺口**。AC-9 现明写现状 baseline 与 delta，精确锚定真差，我的返工疑虑被验证反驳、接受。② Origin（AC-10）降 P2 + 写明具体威胁（回环端口 DNS-rebinding）+ 白名单值集（打包 file:// 或 null / dev vite origin）+ **「无 Origin 头/白名单内不误杀自家客户端」**——正中我 Round 1 的适用性质疑（Electron renderer 无浏览器 Origin 不能被误杀）。消解。

### PL-CHALLENGE-3 → **ADOPT · 已消解**
AC-14 升 P1，凭据清理标「**随删必清**（防孤儿密文 · AC-3 生命周期收尾）」，断连改 best-effort。正是我要求的「security 半段必做、edge 半段降级」拆法。消解。

### PL-CHALLENGE-4 → **ADOPT · 已消解**
§风险与释放阀 显式登记 npm 手装释放阀（触发须 WARN，退回 WS-01 R1）+ AC-4 补「重部署幂等（版本不符→整体覆盖非叠加）」。两项 ask 全落。消解。

### PL-CHALLENGE-5 → **ADOPT · 已消解**
D-5 边界收紧至「**无孤儿进程堆叠**——再连必认领既有驻留进程（端口文件发现+握手验证），版本更替旧进程确定性退出后再启新」；AC-13 把认领路径显式化并可测；Out of Scope 界定 BL-003 只保「进程驻留+无孤儿堆叠」，会话存活归 BL-005。正中我要求的确定性生命周期+防进程泄漏。消解。

## 残留（非阻塞 · note-only · 不改 APPROVE）

- **R2-N1（台账 · minor）**：remedy B 同步了 4 处**决策-of-record**位置，但同名措辞的**二级复述**仍有 3 处未注记：业务规划 `line 96`（Host 独立可执行 bullet「密码凭据存系统钥匙串」）、WS-01 `line 38`（frontmatter scope「凭据入系统钥匙串」· 机读）、WS-01 `line 110`（§背景 Q-003 散文）。这些是次级重述，主判据位置已同步不影响 verify，但未来 grep「系统钥匙串」仍会命中无 ADR 指针的行。**建议**：blueprint 前对这几处做一次 `grep 系统钥匙串` 扫尾，给残余重述补一句 ADR-001 指针。不阻塞。
- **R2-N2（前瞻 watch · low）**：v0.2 新增 D-6「应用 resources 内置全架构 bundle」是 AC-4 自动部署的新地基，其成立**取决于 CI 实际产出全 3 架构 node-pty 预编译**（隐藏前提③自述 linux-arm64 仍「依 CI 矩阵」未实证）。若 linux-arm64 预编译缺位，该架构自动部署会**静默落到 npm 释放阀**。已被 AC-11 同类「探测到其他架构→明确报错」口径 + 释放阀覆盖，属正确下沉 blueprint/CI 的项，**非缺陷**；仅提示 blueprint 别丢：D-6 可用性 = CI 三架构预编译齐备，linux-arm64 需实证补齐或显式标记降级路径。

## Round 2 结论

草案方向自 Round 1 起未变、且**质疑驱动的收敛是实质性的**（节流缺口被验证证实、Origin 误杀风险被白名单值集堵住、凭据/进程生命周期收尾补齐、台账主矛盾消除）。PL-CHALLENGE-1 的 REJECT 我**明确接受**——它以「决策表逐行摊开差异 + 威胁增量技术成立」正当地驳回了我的 remedy，且仍执行了非争议的 remedy B。Goal Stage 从 PL 对抗视角 **APPROVE**，2 条残留为非阻塞 note，可在 blueprint 顺带扫尾。
