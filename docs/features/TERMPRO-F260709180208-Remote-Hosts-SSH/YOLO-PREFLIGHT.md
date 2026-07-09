# YOLO 预研 + 核心决策确认（TERMPRO-F260709180208-Remote-Hosts-SSH · BL-003）

> yolo run 范围：BL-003 → BL-004 → BL-005 串行连续交付（用户一次性授权 · 2026-07-10）。
> 本文件为首个 Feature（BL-003）的预研门产物；BL-004/005 启动时各自复制本轮已确认决策 + 增量预研。

---

## 1. 深入调研（grounded 真实代码 · 2026-07-10 实读）

- **任务实质**：M5 远程 Host（模型 A）Wave 2——让 TermPro 管理远程机（CRUD + 凭据钥匙串）、经 SSH 隧道连上远程 standalone host（BL-002 产物）、首次连接自动部署 host bundle、Settings → Remote Hosts 管理 UI。
- **真实代码现状**（实读 `src/shared/protocol.ts`、`src/host/host.ts|hostCore.ts|wsServer.ts|token.ts`、`src/main/main.ts`、`src/renderer/services/hostClient.ts`、`scripts/package-host.mjs`）：
  - BL-002 基建完整可复用：standalone host（`--listen` loopback 强制 + token 闸〔env 读后抹/file 0600/fd/stdin · 禁 argv 明文 · 常量时间校验〕+ host.info-first 门控 + 心跳 + 认证失败滑动窗告警 `onAuthAlert`）；固定日志行 `[host] token=%s` / `[host] listening ws://%s:%d`（可 grep 捕获）。
  - `hostClient.ts` 已有 Transport 抽象（MessagePort/WebSocket 双实现）+ 版本兼容校验（`checkHostInfoCompatible` + `ProtocolIncompatibleError`），但**单例单连接**，WS 入口仅 dev 开关 `VITE_TERMPRO_REMOTE_WS`。
  - `main.ts` 仅本地 utilityProcess 拉起 host（MessagePort 直连 renderer），零 SSH 代码；deps 零 ssh 库。
  - 部署产物：`scripts/package-host.mjs` 产 host.js 单 bundle + node-pty 平台原生二进制 + package.json（engines node>=20）+ 可选 tar.gz。
  - `hostCore.ts` `hostId:'local'` 硬编码；`WorkspaceEntry` 无 host 归属概念（注册表天然 per-host）。
  - 全景 UI 权威已用户确认（2026-07-09）：`/settings/remote-hosts`（最近使用 + 手动添加 + 密钥/密码 + 测试连接 + 空态/失败注入态）与 `/workspace/add-workspace`（sitemap.md 登记）。
- **范围边界**：做 WS-01-S3 全部 AC（远程机 CRUD/凭据/隧道/自动部署/生命周期事件/Settings UI）+ PENDING-003（Origin 校验纵深、认证告警节流、token 交接运维面——stdout 落盘风险与 token-file TOCTOU 在部署编排一并设计）。不做 mobile 客户端、不做 ~/.ssh/config 导入（Q-003 已否）、不做 Sidebar 分组（BL-004）、不做会话存活（BL-005）。
- **未知与风险**：R2 密码认证（选 ssh2 库解决）；远程机首次部署的进度可视化粒度（上传/启动/握手三段，blueprint 定）；ssh2 在 Electron main 的打包兼容（纯 JS · 可选 native cpu-features 不装）；实机 e2e 依赖可达的远程机（test 阶段以 loopback ssh localhost 或容器模拟兜底）。

## 2. 核心重要决策（已逐条用户确认 · 2026-07-10）

| # | 决策点 | 拍板结果 | 用户答复 |
|---|--------|----------|---------|
| 1 | SSH 实现路线 | **node `ssh2` 库**（纯 JS）：隧道 + exec 部署 + sftp 上传一库全包；连接编排器驻 **Electron main 进程**，renderer 经 IPC 收生命周期事件，UI 永不碰 SSH | ok（按推荐） |
| 2 | 凭据存储语义 | **Electron safeStorage**：加密密钥在系统钥匙串、凭据密文落 userData（零明文落盘）；接受与「条目直存钥匙串」的字面差异（keytar 已弃维护 · 零 native 依赖） | ok（按推荐） |
| 3 | 远程机运行时前提 | 远程机需 **node ≥20**（WS-01 R1 兜底 · BL-002 产物 engines 已定）；缺 node → 明确报错 + 引导，v1 不自动下载 node | ok（按推荐） |
| 4 | 多 host 客户端结构 | hostClient 单例 → **per-host HostClient 注册表**（BL-003 建结构 · BL-004 全面消费）；远程连接 = main 建 SSH 本地端口转发 → renderer 直连 `ws://127.0.0.1:<port>?token=…`（PTY 流量不过 Electron IPC） | ok（按推荐） |
| 5 | BL-005 会话存活语义（预授权） | 按 host 形态分：嵌入式保持「断开即杀」；standalone 断开 → 会话存活 + scrollback 环形缓冲 + 重连认领（协议向后兼容追加 · 不 bump 版本） | ok（按推荐） |
| 6 | 执行编排 | BL-003→004→005 **串行**；merge_target=`yolo/m5-remote-host` 集成分支（已建并推送）；pm_acceptance 自动 approved_and_ship（WARN 留痕）；feature MR 自动合入集成分支；**集成分支 → main 的 MR 由用户人工拍板** | ok（按推荐） |

附加确认：PENDING-003 并入 BL-003 · PENDING-002 并入 BL-004（台账原建议 · 含在「🧩 我补的假设」内一并 ok）。

## 3. 用户确认

- **确认范围**：用户已逐条拍板上方 §2 核心决策（6 项全按推荐）+ 知悉 §1 范围/风险 · **授权 yolo 自主执行**（零暂停点直到 ship · 三个 BL 连续）。
- **评审安全网知悉**：本项目 `disable_external_review=false` → **异质 external（codex CLI）已 opt-in 且 CLI 就绪**（`/opt/homebrew/bin/codex` 实测存在）· 三视角评审全真跑 · 同 stage fix-retry ≤10 轮硬停止损。
- **确认记录**：用户在 PMO emit 的「Prepare + YOLO 预研门」暂停点（含 🎯 理解 / ⚙️ 配置 / 📋 6 项核心决策表 / 安全网知悉）后回复原话 **「ok」** = 选 💡 推荐项（全部默认 + 全部推荐决策）· 2026-07-10。
