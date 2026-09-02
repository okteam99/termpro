// OkWork 会话内技能(okwork):打包在 app 里,经 skill.install RPC 由 host 写入 agent 的
// skills 目录。单一 okwork 技能,当前封装两套浏览器工具。
// 版本单一真源 = OKWORK_SKILL_VERSION,插值进 frontmatter 的 version 字段;host 探测时
// 解析已装文件的 version 与本常量比对,判「未装 / 可更新 / 最新」。

export const OKWORK_SKILL_VERSION = 'v1.2.0';

/** 技能规范名(skills 目录名 + frontmatter name)。 */
export const OKWORK_SKILL_NAME = 'okwork';

/** SKILL.md 全文(含 frontmatter)。frontmatter version 由常量插值,避免与探测口径漂移。 */
export const OKWORK_SKILL_MD = `---
name: okwork
version: ${OKWORK_SKILL_VERSION}
description: 在 OkWork 会话内操作浏览器。inner_browser_* 驱动本机内置已登录窗格;headless_remote_browser_* 驱动远程机 headless Chromium。两套工具互不混用。
---

# OkWork Skill

OkWork 会话内可直接调用 OkWork 应用自身的能力。当前封装:**两套浏览器工具,显式分开,不要混用**。

- \`inner_browser_*\`:本机 **OkWork 内置浏览器**(用户已登录的真实会话,带 cookie)。
- \`headless_remote_browser_*\`:远程机上的 **headless Chromium**(不是笔记本上的窗格)。只在远程 session 且该机装了 Chromium 时可用。

旧名 \`browser_*\` 已删除,不要再调。

## 何时用
- 要用户已登录的站点 → \`inner_browser_*\`。
- 要走远程机网络(验收远端 localhost、不碰用户本机 cookie)→ \`headless_remote_browser_*\`。
- 截图、DOM、JS、点击/输入/滚动、管标签:两套都有对应工具。

## 1. 连接(每个终端先做一次)
先看环境变量 \`$OKWORK_BROWSER_MCP_URL\`:
- **有值** = 你在 OkWork 会话里。**不要**把 URL 写进 MCP 配置(URL 里有终端 uuid,会冻在旧 tab 上)。用 stdio 桥,每次启动从当前进程 env 现取:
  \`\`\`bash
  claude mcp add --transport stdio okbrowser -- okwork-browser-mcp
  \`\`\`
  命令名稳定,不含 uuid。桥读 \`OKWORK_BROWSER_MCP_URL\`,OkWork 已把 \`~/.agents/skills/okwork\` 加进该终端 PATH。若提示 command not found:先点会话里的 okwork 技能安装/更新,再新开或重启 agent。
  Codex 等:stdio MCP,command=\`okwork-browser-mcp\`,继承终端环境即可。
- **无值** = 不在 OkWork 会话 / 特性未开,浏览器不可用,别硬试。

连上后会出现 26 个工具:13 个 \`inner_browser_*\` + 13 个 \`headless_remote_browser_*\`。

若配置里已经有 \`--transport http okbrowser http://127.0.0.1:…/mcp/<uuid>\`,删掉再按上面加一次。

## ⚠️ inner_browser_* 是用户的真实登录会话
你操作的是用户【真实浏览器会话】(带 cookie、已登录各账号),**不是沙箱**。
- 读取 / 导航 / 截图 / 抓数据:放心用。
- 有副作用的动作(发帖、付款、删除、改设置、发消息):**必须先向用户确认**,不要自作主张。

\`headless_remote_browser_*\` 是远程机上的独立 Chromium,默认没有用户本机 cookie。

## 2. 工具速查
把前缀换成 \`inner_browser_\` 或 \`headless_remote_browser_\`:

**读取** — *_navigate(url) · *_get_text / *_get_html(抓数据首选)· *_screenshot · *_eval(code)
**操作** — *_click(selector) · *_type(selector,text) · *_scroll(dy?) · *_wait_for(selector,timeoutMs?)
**标签** — *_list_tabs · *_open_tab(url?) · *_close_tab(id) · *_activate_tab(id)

默认操作当前活跃标签;多标签时先 list_tabs 拿 id,再用 browserTabId 指定。两套标签 id **不要混用**。

## 3. 可靠性套路(避坑)
- **先等再取**:SPA 内容异步渲染,抓取前先 \`*_wait_for\` 关键选择器,别拿半截。
- **inner "not ready; retry" 就重试**:webview 刚挂载/切换未就绪会这么报,稍候重试即可(非硬错)。
- **inner 弹出窗格会拒绝**:报 "popped out to a separate window" = 用户把浏览器独立成窗了,提示他点图标 dock 回来再驱动。
- **headless 不可用会硬报错**(本机 session / 没装 Chromium / 旧 host),不要改去调 inner 凑合,除非用户要的就是本机已登录会话。
- **抓数据用 get_text/get_html,别用截图**:文本/DOM 可解析;截图只用于看长相/布局。
- **新开干净上下文用 open_tab**,不污染用户当前标签。

## 4. 常用流程
### 抓登录后的数据(本机内置)
inner_browser_navigate → inner_browser_wait_for → inner_browser_get_text / eval。

### 验收远程机上的 dev server
headless_remote_browser_navigate 到远端 localhost → wait_for → screenshot + get_html。

### 填表提交
wait_for(表单)→ type(各字段)→ click(提交)→ wait_for(成功标志)确认。同一套前缀用到底。

### 盯页面变化
navigate → 用较长 timeout 的 wait_for 等目标状态选择器,或周期性 get_text 比对。
`;
