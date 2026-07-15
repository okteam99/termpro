// OkWork 会话内技能(okwork):打包在 app 里,经 skill.install RPC 由 host 写入 agent 的
// skills 目录。单一 okwork 技能,当前封装「操作内置浏览器」,未来扩展更多 OkWork 能力。
// 版本单一真源 = OKWORK_SKILL_VERSION,插值进 frontmatter 的 version 字段;host 探测时
// 解析已装文件的 version 与本常量比对,判「未装 / 可更新 / 最新」。

export const OKWORK_SKILL_VERSION = 'v1.0.0';

/** 技能规范名(skills 目录名 + frontmatter name)。 */
export const OKWORK_SKILL_NAME = 'okwork';

/** SKILL.md 全文(含 frontmatter)。frontmatter version 由常量插值,避免与探测口径漂移。 */
export const OKWORK_SKILL_MD = `---
name: okwork
version: ${OKWORK_SKILL_VERSION}
description: 在 OkWork 会话内操作 OkWork 的内置浏览器——抓数据、截图、分析 DOM、执行 JS、点击/输入/滚动、管理标签,基于用户【已登录】的真实浏览器会话。当用户要"打开/操作浏览器""抓某网站数据""截个图看看""填个表单""盯页面变化"且处于 OkWork 会话时使用。
---

# OkWork Skill

OkWork 会话内可直接调用 OkWork 应用自身的能力。当前封装:**操作内置浏览器**。本技能会随 OkWork 增加更多【会话内可调用能力】持续扩展。

## 何时用
- 读/抓一个网页,尤其【需要登录】的站点——用的就是你在 OkWork 里已登录的真实会话。
- 截图、分析 DOM、在页面里执行 JS。
- 点击 / 输入 / 滚动 / 等元素 / 填表提交。
- 管理浏览器标签。

## 1. 连接(每个终端先做一次)
先看环境变量 \`$OKWORK_BROWSER_MCP_URL\`:
- **有值** = 你在 OkWork 会话里,浏览器可用。接上:
  \`\`\`bash
  claude mcp add --transport http okbrowser "$OKWORK_BROWSER_MCP_URL"
  \`\`\`
  Codex 等其它 agent:把一个 streamable-HTTP MCP 指向同一个 \`$OKWORK_BROWSER_MCP_URL\` 即可。
- **无值** = 不在 OkWork 会话 / 特性未开,浏览器不可用,别硬试。

连上后会出现 13 个 \`browser_*\` 工具。

## ⚠️ 这是用户的真实登录会话
你操作的是用户【真实浏览器会话】(带 cookie、已登录各账号),**不是沙箱**。
- 读取 / 导航 / 截图 / 抓数据:放心用。
- 有副作用的动作(发帖、付款、删除、改设置、发消息):**必须先向用户确认**,不要自作主张。

## 2. 工具速查
**读取** — browser_navigate(url) · browser_get_text / browser_get_html(抓数据首选)· browser_screenshot · browser_eval(code)
**操作** — browser_click(selector) · browser_type(selector,text) · browser_scroll(dy?) · browser_wait_for(selector,timeoutMs?)
**标签** — browser_list_tabs · browser_open_tab(url?) · browser_close_tab(id) · browser_activate_tab(id)

默认操作当前活跃标签;多标签时先 list_tabs 拿 id,再用 browserTabId 指定。

## 3. 可靠性套路(避坑)
- **先等再取**:SPA 内容异步渲染,抓取前先 \`browser_wait_for\` 关键选择器,别拿半截。
- **"not ready; retry" 就重试**:webview 刚挂载/切换未就绪会这么报,稍候重试即可(非硬错)。
- **弹出窗格会拒绝**:报 "popped out to a separate window" = 用户把浏览器独立成窗了,提示他点图标 dock 回来再驱动。
- **抓数据用 get_text/get_html,别用截图**:文本/DOM 可解析;截图只用于看长相/布局。
- **新开干净上下文用 open_tab**,不污染用户当前标签。

## 4. 常用流程
### 抓登录后的数据
navigate → wait_for(结果选择器)→ get_text/eval 提取 →(需翻页则 click 下一页 → wait_for → 重复)→ 汇总结构化返回。

### 验收本地 dev server(远程开发常用)
OkWork 浏览器可走远程机网络访问 remote localhost:navigate 到 dev 地址 → wait_for → screenshot 看长相 + get_html 查结构 → 报告问题。

### 填表提交
wait_for(表单)→ type(各字段)→ click(提交)→ wait_for(成功标志)确认。

### 盯页面变化
navigate → 用较长 timeout 的 wait_for 等目标状态选择器,或周期性 get_text 比对。
`;
