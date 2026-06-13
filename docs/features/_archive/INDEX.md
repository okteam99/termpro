# Feature 归档索引

> teamwork ship-finalize 自动维护 · 每个交付 Feature 的**过程层**产物归档为 `<id>.zip`(含 state.json / 各 stage 产物)· **代码是唯一真相** · 此处仅留可追溯快照。
> 需要历史细节时 `unzip <id>.zip`。

| Feature | 描述 | 交付归档时间 | 归档物 |
| --- | --- | --- | --- |
| TERMPRO-F260613041948-quiet-notify | 收紧 M3「运行中静默1分钟→可能在等输入」:后台 tab 仅在离开后有新输出再停住才提示,离开后无新增不提示。渲染层 lastOutputAt>deactivatedAt 同源时钟判据(弃脆弱的时间差推断),不改协议/host。 | 2026-06-13T05:09:52Z | `TERMPRO-F260613041948-quiet-notify.zip` |
