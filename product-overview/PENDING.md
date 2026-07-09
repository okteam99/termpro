# 待规划需求池(PENDING)

> 跨 Feature/session 的"范围外但要做"项 · 等用户拍板启动 · 只留 active(📝/🔄)· 转化即从表删。

| ID | 标题 | 来源 | 目标项目 | 背景(1-3 句) | 状态 | 加入日期 |
|---|---|---|---|---|---|---|
| PENDING-003 | WS 安全纵深与 token 运维面组(BL-002 F6/F7/F9) | BL-002 review defer | TERMPRO | Origin 校验纵深(token 熵仍是真屏障);认证失败告警节流;token 交接运维面(stdout 落盘风险/token-file TOCTOU)。归 BL-003 部署流程一并设计 | 📝 | 2026-07-10 |
| PENDING-004 | WS 边界补测与门控细节组(BL-002 F8/F11/F12) | BL-002 review defer | TERMPRO | 恰好 32MiB 帧/逐字节慢速握手/pong 迟到/握手风暴补测;门控实现细节(非数字 id 边缘/done-flip 时序/连接数上限→BL-003/005);poke 临时文件清理等 info 项 | 📝 | 2026-07-10 |
