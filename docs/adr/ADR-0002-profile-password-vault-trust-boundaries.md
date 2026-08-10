---
id: ADR-0002
title: Profile 密码库采用 main 权威与 guest/ordinary/trusted 三层最小权限边界
status: accepted
date: 2026-08-10
tags: [browser, password-vault, security, electron]
triggered_by: "OKWORK-F260807022801-Profile-Password-Vault"
supersedes: []
---

## 背景

OkBrowser 的网站 webview、普通 OkWork renderer、连接浏览器的 Agent 和密码管理 UI 处在不同信任域。
密码一旦填进网页 DOM，网站脚本与 Agent 就可能观察；一旦由用户复制到系统剪贴板，本机其他应用与普通
OkWork 页面也可能读取。与此同时，Profile 删除可能跨 Vault、Cookie、站点存储和缓存部分失败，不能先移除
Profile 元数据再后台尽力清理。

BL-006 还必须为 BL-007 的 Remote Host 权威存储保留清晰领域边界，但在只有一个存储实现时不提前制造 provider
抽象或双写协议。

## 决策

1. **Vault 由 Electron main 进程唯一权威管理。** 本地实现按 `profileId` 分文件落在 Electron `userData` 下，
   使用 `safeStorage` 加密；系统加密不可用、密文损坏或解密失败时一律 fail-closed，不落明文、不返回空密码
   冒充成功。
2. **调用面按三层最小权限拆分。**
   - 固定 guest preload 只能对当前 sender 绑定的 Profile + exact origin 请求候选、提交候选和报告可观察登录结果；
   - ordinary preload/renderer 只能取脱敏元数据、删除条目和请求打开可信窗口，没有 reveal/copy/guest API；
   - 独立 sandbox trusted window 使用固定 preload，只有真实用户点击后，main 才签发并消费绑定
     `sender + entry + action` 的短时一次性 proof 来 reveal 或 copy。
3. **明文释放有明确时限与披露。** reveal 10 秒后重新遮罩；copy 建立 60 秒租约，只在剪贴板内容仍未变化时清除，
   应用退出时同样条件清理。Profile 设置、Saved Passwords 和 OkBrowser chrome 同时披露 DOM/Agent 与 clipboard
   两类暴露面。
4. **删除是状态机，不是 best-effort 回调。** Profile 先进入不可使用的 `deleting/delete_failed` 状态，立即从保存、
   填充、显示和复制路径撤权；Vault、Cookie、站点存储和缓存全部清理成功后才移除元数据。失败跨重启保留并可重试。
5. **BL-006 不提前抽象远程 provider。** `LocalPasswordVault` 只接收 Profile/origin/username 等领域参数，不接收
   Electron `session`、WebContents 或 renderer DTO；BL-007 在出现第二个实现时再抽取 provider 与迁移协议。

## 理由

- main 权威可避免网站、Agent 或被篡改 renderer 获得通用 Vault 明文能力。
- 三个独立 surface 比一个“万能密码 IPC + 前端自律”更容易用 sender、origin 和真实用户动作做物理约束。
- 诚实承认 DOM 与剪贴板的导出边界，比复制后仍宣称“受 Vault 保护”更符合真实系统权限模型。
- 删除先撤权再清数据，能保证部分失败时 Profile 不会恢复成可使用状态。
- 等第二个存储实现出现再抽象，避免 BL-006 为尚未实现的远程迁移语义制造错误接口。

## 备选方案（考虑过，拒绝）

| 方案 | 拒绝理由 |
|---|---|
| 使用 Chromium 密码库或复制完整 Chromium Profile | 无法维持 OkWork 的 Profile/exact-origin 领域语义，也会把 Cookie、LocalStorage 等无关数据卷入同步 |
| 普通 Settings renderer 直接调用 reveal/copy IPC | renderer 一旦被 XSS、依赖或调试代码篡改即可绕过用户动作批量解密 |
| 提交表单即保存 | 输错或无法确认的密码会覆盖最后一个可用凭据 |
| Profile 元数据先删，其他数据后台清理 | 部分失败不可见、不可重试，且删除承诺与真实残留不一致 |
| BL-006 同时实现 local/remote provider 抽象和双写 | 远程权威、断线、迁移与回滚语义尚未实现；过早抽象会把猜测固化为接口 |

## 后果

- **正面**：密码明文能力有可审计的最小权限边界；Profile/origin 隔离和删除失败语义一致；BL-007 可复用领域 API。
- **负面**：维护四类 main/preload/UI 接缝和独立 trusted window；显示/复制需额外窗口；标准网页登录成功判定只能覆盖可观察信号。
- **约束**：任何新增密码入口都必须先归类为 guest、ordinary 或 trusted；不得向普通 renderer 增加通用 reveal/copy 通道。
- **约束**：远程 provider 接入不得在 Host 断线时静默回退到本机影子 Vault；该语义由 BL-007 另立决策与测试。

## 相关

- 代码：`src/main/localPasswordVault.ts`、`src/main/passwordVaultIpc.ts`、`src/preload/browserGuestPreload.ts`、
  `src/preload/passwordTrustedPreload.ts`
- 回归：`src/main/__tests__/browserPassword*.test.ts`、`e2e/password-vault.e2e.cjs`
- 过程快照：`features/_archive/OKWORK-F260807022801-Profile-Password-Vault.zip`
