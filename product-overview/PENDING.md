# 待规划需求池(PENDING)

> 跨 Feature/session 的"范围外但要做"项 · 等用户拍板启动 · 只留 active(📝/🔄)· 转化即从表删。

| ID | 标题 | 来源 | 目标项目 | 背景(1-3 句) | 状态 | 加入日期 |
|---|---|---|---|---|---|---|
| PENDING-001 | 迁移边界健壮性组(BL-001 F4/F8) | BL-001 review defer | TERMPRO | 部分迁移+fallback 删除+重试的已删复活;畸形 v1 存档(非数组/单条坏条目)致 hydrate 崩溃或永卡 v1 无诊断。低概率窄触发,一组做:数组守卫+单条容错跳过+坏条目上报 | 📝 | 2026-07-10 |
| PENDING-002 | Workspace 注册表周边小项组(BL-001 F6/F9/F11/F13 · F10 已并入 BL-004) | BL-001 review defer | TERMPRO | 备份内容断言缺失(F6);remove/update no-op 仍广播 churn(F9);viewer 广播冗余(F11);注册表重试耗尽提示措辞(F13)。F10(service 边界 params 校验)已并入 BL-004 AC-9(远程面真耦合)。余 4 项均 MINOR/NIT · F11/F13 判据不可测需先改判据 · 单开 | 📝 | 2026-07-10 |
| PENDING-003 | WS 安全纵深与 token 运维面组(BL-002 F6/F7/F9) | BL-002 review defer | TERMPRO | Origin 校验纵深(token 熵仍是真屏障);认证失败告警节流;token 交接运维面(stdout 落盘风险/token-file TOCTOU)。归 BL-003 部署流程一并设计 | 📝 | 2026-07-10 |
| PENDING-004 | WS 边界补测与门控细节组(BL-002 F8/F11/F12) | BL-002 review defer | TERMPRO | 恰好 32MiB 帧/逐字节慢速握手/pong 迟到/握手风暴补测;门控实现细节(非数字 id 边缘/done-flip 时序/连接数上限→BL-003/005);poke 临时文件清理等 info 项 | 📝 | 2026-07-10 |
| PENDING-005 | 远程 workspace 独立查看器窗口可见性(BL-004 D-7 延后) | BL-004 goal PL-5/ARCH-3 defer | TERMPRO | 独立文件/Diff BrowserWindow 各自持本窗口 hostRegistry 单例·无远程 client(token 依 BL-003 E8 只推主窗口);远程 workspace 看文件内容/Diff 需跨窗口远程访问=重开 E8 跨窗口 token 安全面。收窄了上游 WS-01-S4 AC②「任一客户端可见」/BL-001 多客户端定义,授权延后 | 📝 | 2026-07-10 |
| PENDING-006 | 重连 path② 关闭 tab 后重新发现-重建(BL-005 E3/A4/Q3 defer) | BL-005 review defer | TERMPRO | readoptHost path②(session.list 有会话、本地无 inst → 据快照重建 tab)在 v1 生产 `rebuildTab: () => null` 未接线。重建需把远程会话 cwd 映射到该机某 workspace + store.addTab 建 tab 且回传 tabId(现 addTab 不返回 tabId·无 session→workspace 映射),牵扯大于「极小复用」故显式延后。常态重连(AC-15 抑制 drop → inst 存活 → path①)已覆盖北极星;仅命中「断开期关过 tab / 曾 full-drop 后重连」边缘。readoptHost path② 逻辑 + 单测 T-036 俱在,接 store 建 tab 路径即启用 | 📝 | 2026-07-10 |
