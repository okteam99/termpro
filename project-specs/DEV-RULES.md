# TermPro 开发规范(DEV-RULES)

> 本项目团队约定的开发规矩 · blueprint/dev 必须遵守 · 与之冲突要么改方案、要么在 TECH 显式记原因。
> 维护:人工 · 新规矩讨论后由人加入。
>
> ⚠️ 本次内容由 AI 依据 README.md / CLAUDE.md / docs/DEV.md 草拟，待团队定稿确认。

---

## 架构 / 分层

**依赖方向:**`renderer` → `shared` ← `host`；renderer 与 host 之间**只能**通过 `src/shared/protocol.ts` 定义的消息类型通信，不得绕过。

### 🔴 UI 永不直接碰 fs / PTY / git

renderer 里**禁止** `node:fs`、`node-pty` 任何导入。所有工程数据访问（PTY、文件读写/watch、git）必须经 `src/renderer/services/hostClient.ts` 以 HostService 协议发起。
理由：远程就绪的前提，UI 不改一行即可迁移到远程 Host。

### 🔴 Host 进程零 Electron import

`src/host/` 下所有文件禁止 `import ... from 'electron'`。
OS 通知 / Dock 角标逻辑留在壳层（`src/main/`），由 host 事件驱动。
理由：host 本地跑在 utilityProcess，远程跑在 ssh 拉起的独立 node，必须同一份代码。

### 🔴 改通信契约先改 `src/shared/protocol.ts`

新增 RPC 方法或事件类型，**必须先**在 `protocol.ts` 声明（消息类型、RpcMethods 注册表、FLOW 常量），再分别实现 host 侧 handler 和 renderer 侧调用。
理由：单一契约单源，防止类型漂移。

### UI 中路径一律 `(hostId, path)`

renderer 里不出现裸本地路径字符串。文件树 / 读写 / watch 全走 host fs 服务。
API 设计粗粒度：`readdir` 一次返回带 git 状态的完整条目；watcher 事件在 host 侧去抖合并。
理由：避免 WAN 场景 chatty 调用。

### git / gh 在 host 侧 shell out 执行

`src/host/gitService.ts` 负责 shell out `git` / `gh`，UI 只接收结构化结果。
Monaco diff 内容同样经 fs 服务获取。

### 会话状态机驻留 host

Tab 状态机（running/waiting/done/idle）在 `src/host/sessionTracker.ts`，UI 断开时照常运行。
host 维护输出环形缓冲，重连回放。

---

## 命名

- Host 侧服务文件：`{功能}Service.ts`（如 `fsService.ts`、`gitService.ts`）
- Host 侧核心模块：直接名词（`ptyPool.ts`、`sessionTracker.ts`、`outputScanner.ts`）
- renderer 状态：Zustand store 在 `src/renderer/state/store.ts`，持久化逻辑在同目录 `persistence.ts`
- 共享协议消息类型：在 `protocol.ts` 用字面量联合类型定义，`t` 字段区分消息种类

---

## 错误处理

- Host RPC handler 内的错误统一结构化返回给 renderer，不在 host 侧静默吞掉
- git shell out 失败：返回空结构化结果 + stderr 摘要，不抛异常到 UI 层
- 流控异常（watermark 持续超限）：记 warn 日志，PTY pause；不崩进程

---

## 测试策略

- 测试框架：**vitest**（`npm test`）
- host 层核心逻辑（流控、状态机、扫描器）必须有单元测试，放 `src/host/__tests__/`
- 每个里程碑收尾跑**无头冒烟**：
  ```bash
  TERMPRO_SMOKE=1 npx electron-forge start
  # 打印 SMOKE_OK 视为通过；30 s 超时打印 SMOKE_TIMEOUT 以 exit(1) 退出
  ```
- 验证门禁（提交前三绿才提交）：`npm run typecheck` + `npm test` + 冒烟

---

## 代码风格

- 语言：**TypeScript**，`tsconfig` 严格模式
- 类型检查：`npm run typecheck`（`tsc --noEmit` 全量，无构建产物）
- Lint：`npm run lint`（eslint `.ts/.tsx`）
- 提交前必须 typecheck + lint 通过，不接受 `@ts-ignore` 或 `eslint-disable` 而不写理由注释

---

## 性能 / 生命周期红线

### 🔴 PTY → UI 必做流控

watermark + pause/resume 机制在 `src/host/ptyPool.ts` 实现，常量定义在 `src/shared/protocol.ts` 的 `FLOW` 对象（`highWatermark = 512 * 1024`，`lowWatermark = 128 * 1024`）。
本地 / 远程共用同一机制，不得绕过。
理由：agent 倾倒 build 日志时无流控会导致内存与帧率同时崩溃。

### 🔴 WebGL context 只给可见 tab

`TerminalView` 挂载时为当前 tab 附加 `WebglAddon`，切走时卸载 WebGL context（保留 Terminal 实例与 buffer）。
后台 tab 照常 `write()` 进 buffer，不挂 WebGL renderer。
理由：GPU context 数量有上限。

### 🔴 Monaco 懒加载，首屏只有终端

Monaco editor 不得在首屏 bundle 里加载，必须按需动态 import。
理由：首屏只应加载终端，编辑器是低频路径。

### 🔴 node-pty 原生模块随 Electron 重编

Electron 版本升级后立即重编 node-pty，走 forge 标准流程（`npm start` / `make` 自动触发 `rebuild`）。
不得跳过重编直接运行。

---

## 其他约定

### 里程碑节奏

- 里程碑拆 3–6 个阶段，**每阶段一个 commit**，验证门禁三绿才进下一阶段
- commit 信息用中文或英文均可，需说明「做了什么 + 为什么」

### 发版

```bash
npm version patch   # 或 minor/major：改版本号 + commit + 打 tag
git push --follow-tags   # 推 tag 触发 CI 出包发 GitHub Release
```

发版后**不替用户安装 / 升级** `/Applications` 里的应用；用户通过应用内升级胶囊自行更新。

### 终端设计原则

终端保持哑且工具无关：不解析特定 agent 输出、不依赖特定 agent 钩子。
状态感知只走标准协议（进程名轮询、OSC 133/7、BEL/OSC 9/777）。
