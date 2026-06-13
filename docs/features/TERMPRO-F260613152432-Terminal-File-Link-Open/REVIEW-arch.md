---
role: architect
review_scope: code-review
execution: subagent
verdict: APPROVE
target_commit: 56cff61
files_read:
  - src/renderer/terminal/terminalLinks.ts
  - src/renderer/terminal/__tests__/terminalLinkFilePanelRouting.test.ts
  - src/renderer/terminal/terminalRegistry.ts
  - src/renderer/filepanel/locateRegistry.ts
  - src/preload/preload.ts
  - project-specs/DEV-RULES.md
---

# REVIEW-arch(TERMPRO-F260613152432-Terminal-File-Link-Open)

verdict: **APPROVE** · 技术正确 · 最小改动 · 层次正确 · 无过度设计

## Findings

- **ARCH-1(info)**:路由完全正确。`openTarget`(terminalLinks.ts:53-63)将 `dir`→`openTargetInFilePanelFirst`(定位优先,locate-false/reject 回退系统打开),`file`→`openTargetFallback`(:28-34 按 SYSTEM_OPEN_EXT 二分:openPath / openViewerWindow)。文件分支永不调 `tryLocateInFilePanel`,故根内文件不再降级 location-only。精确匹配 AC-1/2/3。
- **ARCH-2(info)**:dir 分支的 `void` 非回归。`ILink.activate` 签名 `(event,text)=>void`,原 call site 本就 fire-and-forget,`openTarget` 保持同语义;`tryLocateInFilePanel` 的 reject 之前也无 caller await。
- **ARCH-3(info)**:无遗漏激活路径。`SystemWebLinkProvider.activate`(web · :178-182)未触,仍 `openExternal`(AC-5);`LinkHighlighter` 仅上色无激活逻辑,正确无需改;`terminalRegistry.ts` 接线不变。唯一 fs 激活点已正确更新。
- **ARCH-4(info)**:无 DEV-RULES 分层违规。renderer 不直接碰 fs/PTY/git——存在性仍走 `hostClient.rpc('fs.stat'/'pty.cwd')`,打开动作走 `window.termpro` preload bridge;`openTarget` 纯路由无新 IO。
- **ARCH-5(low · 非阻塞)**:`openTargetFallback` 的 `kind` 参数对 file 路径略显冗余(经 openTarget 进来时恒为 'file',`kind==='dir'` 守卫只对 dir-locate-fail 路径有意义)。**PMO 裁决:REJECT**——共享 fallback 让「dir 定位失败」与「file 直开」汇于一处,是更简的总设计(Architect 自评「不值得改」)。无动作。

## 简洁性评估
未过度设计:无配置开关(DEC-1/OoS 正确延后)、无双动作管线、除一个微型 router 外无新抽象。`openTargetInFilePanelFirst` 仍仅用于 dir。测试重写干净映射 T-001~006→AC-1~5,替换过期 location-only 断言,新增 :line:col 端到端测试。
