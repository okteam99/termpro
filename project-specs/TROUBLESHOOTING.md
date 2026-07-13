# OkWork 排查手册（TROUBLESHOOTING）

> teamwork PMO 在 mode A query / E · discuss 触及「排查 / 报错 / 查 log / 查环境」时按需 read。
> 与 [KNOWLEDGE.md](./KNOWLEDGE.md) 互补：KNOWLEDGE = 踩坑注意点 · 本文 = 操作步骤。
>
> **路径硬规则**：`project-specs/TROUBLESHOOTING.md`（teamwork 固定路径 · 与 product-overview/ 同级）。

---

## 一、环境 / 前置

| 项目 | 要求 |
|------|------|
| Node.js | ≥ 20 |
| 包管理器 | npm（lock 文件基于 npm） |
| 操作系统 | macOS（M1 阶段仅 macOS） |
| 原生模块 | node-pty 需与 Electron 版本对齐编译；`npm start` / `make` 时 forge 自动处理 |

**没有 staging / production 服务端**。本项目是 macOS 桌面应用，只有两种运行形态：
- **本地开发**：`npm start`（Vite HMR + Electron，开发者本机）
- **发布包**：GitHub Actions release.yml 出包（`.zip`），用户在机器上运行

---

## 二、跑 / 调试命令

```bash
# 安装依赖（含 node-pty 原生模块编译）
npm install

# 启动开发环境（electron-forge start：Vite HMR + Electron）
npm start

# 全量类型检查（无构建产物）
npm run typecheck

# lint
npm run lint

# 单元测试（vitest）
npm test

# 无头冒烟（CI 可用）
OKWORK_SMOKE=1 npx electron-forge start
# 渲染层完成 Host 握手 + 首个 PTY 输出后打印 SMOKE_OK 自动退出
# 30s 超时打印 SMOKE_TIMEOUT，以 exit(1) 退出
# userData 隔离至 os.tmpdir()/okwork-smoke，不污染本地布局存档
```

验证门禁（每阶段提交前必须三绿）：`npm run typecheck` + `npm test` + 冒烟 `SMOKE_OK`。

---

## 三、常见报错 → 排查链

### 3.1 node-pty 启动报错 / 版本不匹配

**现象**：`npm start` 时报 `NODE_MODULE_VERSION` 不匹配 / `Error: The module was compiled against a different Node.js version` 类错误。

**原因**：Electron 升级后 node-pty 原生 `.node` 文件未重编。

**排查链**：
1. 直接重跑 `npm start`（forge rebuild 步骤会自动重编 node-pty）
2. 如仍报错，手动触发：`npx electron-rebuild` 或 `npm run make`
3. 确认 Electron 版本与 node-pty 版本在 `package.json` 中对齐

---

### 3.2 冒烟超时（SMOKE_TIMEOUT）

**现象**：`OKWORK_SMOKE=1 npx electron-forge start` 30s 后打印 `SMOKE_TIMEOUT`，进程以 exit(1) 退出。

**原因**：渲染层未完成 Host 握手，或首个 PTY 输出未到达。

**排查链**：
1. 查看 `npm start` 终端输出，确认 `utilityProcess`（Host 进程）是否正常拉起
2. 检查 MessagePort 握手路径：renderer → main → host 的 `client` 消息是否建立（见 `src/main/main.ts`）
3. 打开 DevTools（`View → Toggle Developer Tools`），查看 renderer console 是否有 HostClient attach 错误
4. 确认 `PROTOCOL_VERSION` 在 `src/shared/protocol.ts` 中主/渲进程一致

---

### 3.3 终端无输出 / 卡死

**现象**：PTY 会话启动，但终端区域无任何输出，或滚动卡死。

**原因**：PTY 流控 `pause` 后 `resume` 未被触发（ack 回执未到达 host）；或 WebGL context 超限。

**排查链**：
1. 检查流控状态：Host 累计 `unacked > 512 KB`（highWatermark）会调 `proc.pause()`；需 renderer 调用 `hostClient.ack(sessionId, bytes)` 触发 resume（lowWatermark 128 KB）
2. 流控常量定义在 `src/shared/protocol.ts` 的 `FLOW` 对象
3. WebGL context 超限：检查是否在多个 tab 同时挂了 WebGL renderer——TerminalView 应只给可见 tab 挂 `WebglAddon`，切走时卸载 context（见 `src/renderer/terminal/TerminalView.tsx`）
4. DevTools → Console，搜索 `pty:data` / `pty:ack` 事件是否正常收发

---

### 3.4 shell integration（OSC 133）异常 / p10k 提示 console output

**现象**：zsh 启动时 Powerlevel10k 提示 `console output during init`；或 OSC 133 命令边界事件未触发，tab 状态点不更新。

**说明**：
- shell integration 仅对 zsh 生效（ZDOTDIR 包装自动注入 OSC 133/7）
- 注入钩子在 `.zshrc` 末尾输出 OSC 序列，p10k instant-prompt 可能提示该警告（与 VS Code 同模式，**无功能影响**）
- bash / fish 暂不支持，待后续

**排查链**：
1. 用环境变量关闭 shell integration 来隔离复现：
   ```bash
   OKWORK_NO_SHELL_INTEGRATION=1 npm start
   ```
2. 如关闭后问题消失，排查 `src/host/shellIntegration.ts` 注入逻辑
3. 如关闭后仍异常，问题在其他路径（与 shell integration 无关）

---

### 3.5 协议不兼容（远程/版本不匹配）

**现象**：连接远程 Host（M5 后）时握手失败；或 Host 与 UI 版本不一致时消息类型报错。

**排查链**：
1. 检查 `src/shared/protocol.ts` 中 `PROTOCOL_VERSION`（当前 = 1）
2. M5 远程接入后需做版本握手校验；本地开发期间主/渲进程共用同一份 `shared/protocol.ts`，不会出现版本差异
3. 如升级后出现消息类型不匹配，确认 `RpcMethods` 注册表两侧（host / renderer）同步更新

---

## 四、日志在哪 / 怎么看

OkWork 是开发态桌面应用，没有集中日志文件。排查时看以下几处：

| 来源 | 位置 / 方式 |
|------|------------|
| **Electron main 进程** | `npm start` 运行的终端窗口（stdout/stderr） |
| **Host 进程（utilityProcess）** | 同上（utilityProcess 的 stderr 通过 electron-forge 合并输出） |
| **Renderer（React UI）** | 应用内 DevTools → Console（`View → Toggle Developer Tools` 或 `⌥⌘I`） |
| **CI 构建日志** | GitHub Actions → 对应 workflow run 页面 |

> 开发期排查：优先看 `npm start` 终端输出 + DevTools Console，不要假设存在独立日志文件路径。

---

## 五、发版 / 签名公证排查

### 5.1 发版流程

```bash
npm version patch        # 或 minor/major：改版本号 + commit + 打 tag
git push --follow-tags   # 推 tag 即触发 release.yml 出包
```

| 工作流 | 触发 | 内容 |
|--------|------|------|
| `ci.yml` | push main / PR | typecheck + vitest（ubuntu） |
| `release.yml` | 打 `v*` tag / 手动触发 | macOS(arm64) 构建：测试 + 冒烟 + `npm run make`；tag 时附 zip 发 GitHub Release；手动触发只传 artifact |

### 5.2 签名与公证

forge 的 `osxSign` / `osxNotarize` 从以下 6 个 GitHub Secrets 读取（secrets 已存入仓库，GitHub API 读不出已存 secret 的真值）：

```
APPLE_CERTIFICATE_BASE64
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

**secrets 缺失时**：forge 自动回退 ad-hoc 签名。用户下载后首次打开需：
- 右键 → 打开，或
- `xattr -dr com.apple.quarantine /Applications/OkWork.app`

**流水线带 Gatekeeper 验收步骤**：`codesign --verify` + `stapler validate` + `spctl`。

**配置更省事的做法**：在 okteam99 组织设置里把 6 个 secrets 升为 org-level secrets（可见范围选 okwork），手动触发一次 Release 工作流即可验证签名+公证全链路。

> 发版后**不要**替用户安装/升级 `/Applications` 里的应用——用户通过应用内升级胶囊（侧栏左下角）自行更新。

---

## 六、本地敏感配置（`.teamwork-local-env/`）

🔐 本机敏感配置统一放 **`.teamwork-local-env/`**（项目根 · teamwork session 初始化自动创建 + 双重 gitignore · **绝不进仓库 / 不进 feature 产物 / 不进归档 zip**）：

- **键值型**（Apple 证书密码 / API key / token）→ `.teamwork-local-env/config.properties`（`KEY=value`）
- **整文件型**（p12 证书 / `cert.p12.base64`）→ 直接作为文件放本目录

加载方式（用于本地手动设置 secrets / 验证发版）：

```bash
# 键值型 secret（shell source 进环境变量）
set -a; . ./.teamwork-local-env/config.properties; set +a

# 然后手动设置 GitHub secrets（示例，变量名见 §五）
gh secret set APPLE_CERTIFICATE_BASE64 -R okteam99/termpro < .teamwork-local-env/cert.p12.base64
gh secret set APPLE_CERTIFICATE_PASSWORD -R okteam99/termpro
```

🔴 本文（TROUBLESHOOTING.md **会进仓库**）里**只写变量名 / 加载方式**，**真值只在 `.teamwork-local-env/`**。

---

## 安全约束（必读）

🔴 PMO 排查时必守：

- **无线上服务端环境**（OkWork 是桌面应用）——不存在 staging / production 写操作授权问题
- 不写 secret / token / 证书真值到本文（用 `$ENV_VAR` 占位符）· **真值放 `.teamwork-local-env/` 或 GitHub Secrets**
- 不复述 secret 到主对话
- Apple 证书 / signing identity 等敏感凭据仅通过 GitHub Secrets 或本地 `.teamwork-local-env/` 传递

---

## 维护

- 命令验证：Electron / forge 大版本升级后同步核对
- 新增排查项 / 已知约束变化时同步本文（主要素材来源：`docs/DEV.md §5 已知约束`）

末。
