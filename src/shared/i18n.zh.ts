// 中文字典:key = 代码内英文原文(逐字符一致,含占位符),value = 中文文案。
// 缺条目 → t() 回退英文。按 UI 区块分节维护,新增文案随改动同步补条目。
export const zh: Record<string, string> = {
  // --- Sidebar ---
  '⬆ New version v{version} available — download, then confirm to install':
    '⬆ 新版本 v{version} — 下载后确认安装',
  'Connecting to update source…': '正在连接更新源…',
  'Waiting to confirm install…': '等待确认安装…',
  'Downloading {percent}% (confirm to install when done)': '下载中 {percent}%(完成后确认安装)',
  'Downloading… (confirm to install when done)': '下载中(完成后确认安装)…',
  'Restarting to finish the update…': '即将重启完成升级…',
  'Auto-update failed — opened the release page': '自动升级失败,已打开发布页',
  'Download the new version, then confirm to install and restart':
    '下载新版本，完成后确认安装并重启',
  'Local': '本机',
  'Disconnected · Click to reconnect': '已断开 · 点击重连',
  'Notifications': '通知',
  'Rename Workspace': '重命名 Workspace',

  // --- MachineGroup ---
  'Connecting…': '连接中…',
  'Deploying…': '部署中…',
  'Starting host…': '启动 host…',
  'Claiming…': '认领中…',
  'Verifying handshake…': '握手校验…',
  'Retry': '重试',
  'Retry now (reset backoff and reconnect immediately)': '立即重试(复位退避即刻再连)',
  'Retry now': '立即重试',
  'Reconnect': '重连',
  'Connect': '连接',
  'Reconnecting…': '重连中…',
  'Not connected · Connect to see its workspaces': '未连接 · 连接后显示该机上的 workspace',
  'No projects on this machine yet · Add one': '此机器暂无项目 · 添加一个',

  // --- MachineWorkspaceRow ---
  'Disconnected': '已断开',

  // --- NotificationCenter ---
  'Just now': '刚刚',
  '{minutes} min ago': '{minutes} 分钟前',
  '{hours} hr ago': '{hours} 小时前',
  '{days} d ago': '{days} 天前',
  'Mark all as read': '全部已读',
  'Clear': '清空',
  'No notifications': '暂无通知',

  // --- TabBar ---
  'New tab (workspace root)': '新 Tab（workspace 根）',
  'New tab (choose directory…)': '新 Tab（选择目录…）',
  'Rename Tab': '重命名 Tab',
  'Leave empty to restore default name': '留空恢复默认名',

  // --- RenameModal ---
  'Cancel': '取消',
  'Save': '保存',

  // --- SettingsEntry ---
  'Version {version}': '版本 {version}',
  'Version unknown': '版本未知',
  'Close': '关闭',
  'Keep the bottom input bar pinned to the viewport when scrolling up through history (visible and typeable)':
    '向上滚动查看历史时,把底部输入栏固定在视口底部(可见可输入)',
  'Pin bottom bar': '底部输入栏固定',
  'Dev-channel build, separate data directory, no update checks':
    '开发渠道构建,独立数据目录,不检查更新',

  // --- WorktreeDropdown ---
  'Copied path': '已复制路径',
  'Copy workspace path': '复制工作区路径',

  // --- FilePanel ---
  'Local-only action — unavailable in remote workspaces': '本机专属操作,远程 workspace 不可用',
  'Open diff view': '打开 Diff 视图',
  'Open with default browser': '用系统默认浏览器打开',
  'Show in Finder': '在 Finder 中显示(跳转所在目录)',
  'Open in Finder': '在 Finder 中打开',

  // --- App ---
  'Host process exited — press ⌘R to reload the window': 'Host 进程已退出,⌘R 重载窗口可恢复',
  'Host connection failed: {error}': 'Host 连接失败:{error}',
  'Remote machine is not connected': '远程机未连接',
  'Connecting to host…': '连接 Host…',
  '⌘T for a new terminal': '⌘T 新建终端',
  'Add a workspace on the left to get started': '在左侧添加一个 Workspace 开始',

  // --- RemoteHostsPage ---
  'Untitled': '未命名',
  '⚠ Connection lost': '⚠ 连接已断开',
  '✓ Connected': '✓ 已连接',
  'Disconnect': '断开',
  'Test connection': '测试连接',
  'Edit': '编辑',
  'Delete': '删除',
  'Testing connection…': '测试连接中…',
  '✓ Reachable': '✓ 已连通',
  'Claimed a running host process · Verifying handshake…': '已认领运行中的 host 进程 · 握手校验…',
  'Found a running host process · Claiming…': '发现已运行的 host 进程 · 认领中…',
  'Upload bundle': '上传 bundle',
  'Start host': '启动 host',
  'Verify handshake': '握手验证',
  'Detected remote arch · {arch}': '已探测远端架构 · {arch}',
  'Delete {alias}? Stored credentials will also be removed': '确认删除 {alias}?将同时清除已存凭据',
  ' · Current connection will be disconnected first': ' · 将先断开当前连接',
  'Yes': '是',
  'No': '否',
  'Password': '密码',
  'Key': '密钥',
  'Remote Hosts': '远程机',
  'SSH key or password login · Passwords/passphrases stored in system keychain':
    'SSH 密钥或密码登录 · 密码/私钥密码存入系统钥匙串',
  'No remote hosts yet · Click below to add one': '还没有远程机 · 点击下方添加',
  'Add remote host': '添加远程机',
  'Recently used': '最近使用',
  'Manually added': '手动添加',
  'No manually added remote hosts yet': '暂无手动添加的远程机',
  'Edit remote host': '编辑远程机',
  'Configure remote host': '配置远程机',
  'Name': '名称',
  'Auth method': '认证方式',
  'SSH Key': 'SSH 密钥',
  'Password is stored in the system keychain, never written to disk in plaintext':
    '密码存入系统钥匙串,不明文落盘',
  'Private key path': '私钥路径',
  'e.g. ~/.ssh/id_ed25519': '例如 ~/.ssh/id_ed25519',
  'Private key passphrase (optional)': '私钥密码(可选)',
  'Passphrase for the encrypted private key · stored in the system keychain, never written to disk in plaintext':
    '加密私钥的 passphrase · 存入系统钥匙串,不明文落盘',
  'Credential encryption unavailable — keychain access was denied':
    '凭据加密不可用——钥匙串访问被拒绝',
  'Passwords cannot be saved or read in this session, so connections will fail as "Authentication failed". Quit and reopen the app, then choose "Always Allow" when the system asks for keychain access.':
    '本次会话密码存不进也读不出,连接会一律报「认证失败」。请完全退出应用后重新打开,在系统弹出钥匙串授权时选择「始终允许」。',

  // --- AddWorkspaceModal ---
  'Target host is disconnected': '目标机器已断开',
  'Directory name cannot be . / .. or contain /': '目录名不能是 . / .. 或包含 /',
  '{platform} · Local directory': '{platform} · 本地目录',
  'Connected remote hosts': '已连接远程机',
  'SSH key or password login': 'SSH 密钥或密码登录',
  'No connected remote hosts yet · Add and connect one to pick a remote directory here':
    '暂无已连接的远程机 · 添加并连接后即可在此选择远程目录',
  '‹ Back': '‹ 返回',
  'Reading directory…': '正在读取目录…',
  '(empty directory)': '(空目录)',
  'Add Project': '添加项目',
  'Project registers on the selected host · visible after any device connects':
    '项目注册在所选机器上 · 任何设备连接后可见',
  'New directory name': '新目录名',
  'Creating…': '创建中…',
  'Create': '创建',
  'Create a new folder in the current directory': '在当前目录下新建文件夹',
  '+ New folder': '+ 新建目录',
  'Select': '选择',

  // --- MarkdownPreview ---
  'mermaid render failed': 'mermaid 渲染失败',
  'Zoom out': '缩小',
  'Zoom in': '放大',
  'Fit to window (double-click has the same effect)': '适配窗口(双击同效)',
  'Reset': '重置',
  'Close (Esc)': '关闭(Esc)',
  '(mermaid render failed)': '(mermaid 渲染失败)',
  'Binary file, cannot preview': '二进制文件,无法预览',
  'File too large ({size} MB), cannot preview': '文件过大({size} MB),无法预览',
  'Failed to read: {error}': '读取失败:{error}',
  'Collapse outline': '收起大纲',
  'Expand outline': '展开大纲',
  '(no headings)': '(无标题)',

  // --- FilesWindow ---
  '{count} unsaved file(s). Close the window anyway?': '有 {count} 个未保存的文件,确定关闭窗口?',
  'Close (⌘W)': '关闭(⌘W)',
  'Preview': '预览',
  'Open with the default app': '用系统默认应用打开',
  'Open with default app': '系统应用打开',

  // --- DiffPanel ---
  'Monaco failed to load': 'Monaco 加载失败',
  'File too large ({size} MB > 2MB)': '文件过大({size} MB > 2MB)',
  'Failed to load original content: {error}': '原始内容加载失败:{error}',
  'Uncommitted changes(vs HEAD)': '未提交变更(vs HEAD)',
  'Reload changed files list': '重新加载变更列表',
  'Loading…': '加载中…',
  'No changes': '无变更',

  // --- ViewerWindow ---
  'Uncommitted changes': '未提交变更',
  'Open the repo directory with the default app': '用系统默认应用打开仓库目录',

  // --- FileView ---
  'Image too large ({size}MB > 20MB), please open with the default app':
    '图片过大({size}MB > 20MB),请用系统应用打开',
  'Binary file, cannot preview (open in an external editor instead)':
    '二进制文件,无法预览(可外跳编辑器打开)',
  'File too large ({size}MB > 2MB), please open in an external editor':
    '文件过大({size}MB > 2MB),请外跳编辑器',
  'Save failed: {error}': '保存失败:{error}',

  // --- store ---
  'Remote operations are unavailable in local fallback mode': '远程操作在本地回退模式下不可用',
  'Failed to create workspace, please retry': '新增 workspace 失败,请重试',
  'Failed to delete workspace, please retry': '删除 workspace 失败,请重试',
  'Failed to rename workspace, please retry': '重命名 workspace 失败,请重试',

  // --- persistence ---
  'Failed to read the workspace registry, retrying…': '无法读取 Workspace 注册表,正在重试…',
  'Workspace migration is not yet complete — continuing with the local archive (will retry automatically)':
    'Workspace 迁移暂未完成,已继续以本地存档运行(将自动重试)',

  // --- sessionEvents ---
  '{label} · Command finished': '{label} · 命令完成',
  '{label} · Command finished (exit code {code})': '{label} · 命令完成(退出码 {code})',
  'OkWork · Done': 'OkWork · 完成',
  '{label} · Bell rang (may be waiting for input)': '{label} · 响铃(可能在等输入)',
  'OkWork · Attention': 'OkWork · 注意',
  '{label} · Quiet for 1+ min, may be waiting for input': '{label} · 静默 1 分钟+,可能在等输入',

  // --- terminalRegistry ---
  '[OkWork] Terminal failed to start: {message}': '[OkWork] 终端启动失败:{message}',
  'Close this tab and reopen it to retry': '关闭该 tab 后重新打开即可重试',
  '[OkWork] Session mirrored on another device took exclusive control — switch back to this tab to re-mirror':
    '[OkWork] 会话已被另一设备独占接管 · 回到此 tab 自动恢复镜像',

  // --- bottomBarPin ---
  '↓ Back to bottom': '↓ 回到底部',

  // --- shared/remoteHost FAIL_REASON_COPY ---
  'Unreachable': '不可达',
  'Connection refused / host unreachable': 'Connection refused / 主机不可达',
  'Authentication failed': '认证失败',
  'Permission denied (check key / password / username)':
    'Permission denied（检查密钥 / 密码 / 用户名）',
  'Timed out': '超时',
  'Connection timed out (10s)': 'Connection timed out（10s）',
  'Node.js runtime missing': '缺少 Node.js 运行时',
  'node not found on the remote PATH, login shell, or common install locations (nvm / fnm / Homebrew / volta)':
    '在远端 PATH、登录 shell 及常见安装位置(nvm / fnm / Homebrew / volta)均未找到 node',
  'Install Node.js 20 or newer on the remote machine, then retry':
    '请在远端机器安装 Node.js 20 或更高版本后重试连接',
  'Unsupported architecture': '架构不支持',
  'No bundled host build for this remote architecture': '该远端架构暂无内置 host 产物',
  'Run `npm i -g okwork-host` on the remote machine, then retry':
    '请在远端执行 `npm i -g okwork-host` 手动安装后重试',
  'Deploy failed': '部署失败',
  'Host bundle upload interrupted (network / disk / permissions)':
    '上传 host 产物中断（网络 / 磁盘 / 权限）',
  'Start failed': '启动失败',
  'Remote host process failed to start': '远端 host 进程未能拉起',
  'Incompatible version': '版本不兼容',
  'Remote host protocol version is incompatible with this app · disconnected':
    '远端 host 与当前应用协议版本不兼容 · 已断开',
  'Internal error': '内部错误',
  'Connection orchestration error (see app logs)': '连接编排异常（详见应用日志）',

  // --- main/exitConfirmation ---
  'Close the main window?': '关闭主窗口？',
  'Tab content may be lost after closing and reopening. Cancel to keep Workspace, Tab, and Terminal views available.':
    '关闭后再打开，Tab 内容可能丢失。取消后 Workspace、Tab 和 Terminal 视图保持可用。',
  'Close Window': '关闭窗口',
  'Quit OkWork?': '退出 OkWork？',
  'Tab content may be lost after quitting and reopening. State still gets a chance to persist before exit.':
    '退出后再打开，Tab 内容可能丢失。确认退出前会保留原有状态落盘机会。',
  'Quit': '退出',
  'Install v{version} and restart?': '安装 v{version} 并重启？',
  'Install the update and restart?': '安装更新并重启？',
  'The update has been downloaded. After confirming, OkWork restarts and hands off to Squirrel.Mac to finish installing.':
    '升级包已下载完成。确认后 OkWork 会重启并交给 Squirrel.Mac 完成安装。',
  'Later': '稍后',
  'Install and Restart': '安装并重启',

  // --- 设置:终端链接打开方式 ---
  'Open links in': '链接打开方式',
  'Built-in browser': '内置浏览器',
  'System browser': '系统浏览器',
  'Built-in for remote terminals only': '仅远程终端用内置浏览器',
  'Where terminal links open. ⌘/Ctrl+click always opens in the system browser.':
    '终端里点击链接的打开位置。⌘/Ctrl+点击恒用系统浏览器。',

  // --- 浏览器面板:加载失败错误条 ---
  'Page failed to load: {error}': '页面加载失败：{error}',

  // --- 浏览器面板:窗格窗口化(弹出/回落) ---
  'Move this browser to a separate window': '把浏览器弹出为独立窗口',
  'This browser is open in a separate window': '浏览器已在独立窗口打开',
  'Focus window': '聚焦窗口',
  'Dock back': '收回面板',
  'Dock back to the panel': '收回到主窗口面板',
  'Focus the OkBrowser window': '聚焦 OkBrowser 独立窗口',

  // --- main/rendererRecovery(崩溃自愈 give-up 弹窗) ---
  'OkWork keeps crashing': 'OkWork 持续崩溃',
  'Automatic recovery was stopped after repeated crashes. Press ⌘R to retry manually; if it keeps failing, quit and relaunch OkWork.':
    '多次崩溃后已停止自动恢复。按 ⌘R 手动重试；若仍反复失败，请退出并重新打开 OkWork。',
  'OK': '好',

  // --- main/main 右键菜单 ---
  'Rename…': '重命名…',
  'Close Tab': '关闭 Tab',
  'Copy': '复制',
  'Paste': '粘贴',
  'Select All': '全选',
  'Clear Screen': '清屏',
  'The local clipboard has no image or text to paste': '本机剪贴板中没有可粘贴的图片或文本',
  'Could not paste the clipboard into the remote terminal: {message}':
    '无法把剪贴板内容粘贴到远程终端：{message}',
  'The Remote Host is running an older version; reconnect the remote host to upgrade it and enable image paste':
    '远程 Host 正在运行旧版本；重新连接该远程 Host 即可升级并启用图片粘贴',

  // --- main/remote 凭据与编排 ---
  'Local credential encryption is unavailable — cannot store the password safely':
    '本机凭据加密不可用,无法安全保存密码',
  'Found node {version} ({path}), but ≥ {major} is required':
    '已找到 node {version}({path}),但需要 ≥ {major}',

  // --- opus 评审 P1-1 补漏(阶段2 t() 化后漏进字典的 key)---
  'Host': '主机',
  'User': '用户',
  'Port': '端口',
  'No workspaces': '暂无 Workspace',
  'Add Workspace': '添加 Workspace',
  'Remove workspace': '移除 Workspace',
  'Remove workspace "{name}"? Terminal sessions will be closed.':
    '移除 Workspace“{name}”？其终端会话将被关闭。',
  'New tab': '新 Tab',
  'New tab options': '新 Tab 选项',
  'Close tab': '关闭 Tab',
  'Show file panel': '显示文件面板',
  'Hide file panel': '隐藏文件面板',
  'Show browser': '显示内置浏览器',
  'Hide browser': '隐藏内置浏览器',
  'No session': '无会话',
  'Refresh': '刷新',
  'Apply': '应用',
  'Choose…': '选择…',
  'Reload worktrees': '重新加载 worktree',
  'not a git repo': '非 git 仓库',
  '(unreadable)': '(不可读)',
  '{count} entries': '{count} 项',
  'About': '关于',
  'Settings': '设置',
  'Language': '语言',
  'System': '跟随系统',
  '‹ OUTLINE': '‹ 大纲',

  // --- 应用菜单(main · buildMenu) ---
  'New Tab': '新建 Tab',
  'Quit {name}': '退出 {name}',

  // 以下 key 有意留英(两端同文案),勿当漏项:
  //   '0 session' / '{count} session' / '{count} session · {running} running'
  //     —— 用户指定徽章用 "N session"(2026-07-11);
  //   'Rename workspace'(已统一为 'Rename Workspace',无小写调用点);
  //   'DEV'(渠道徽标)/ 'Root' / 'WorkTree' / 'Diff' / 'diff' / 'detached' /
  //   'detached · {head}' / '{branch} · {head}' / 'exit {code}' / 'exited'
  //     —— git/终端术语与纯插值,不译;
  //   'English' / '简体中文'(语言名以本族语显示)/ 'Shell'(菜单标题,终端术语)。

  // --- BrowserPanel ---
  'Back': '后退',
  'Forward': '前进',
  'Stop': '停止',
  'Open in system browser': '用系统浏览器打开',
  'Enter a URL or search to get started': '输入网址或搜索内容开始浏览',
  'Local network': '本机网络',
  'No connected remote machines': '无已连接的远程机',
  'Browser network exit: {name}': '浏览器网络出口:{name}',
  // OkWork 技能横条(okwork skill)
  'Install the okwork skill to let the AI operate the built-in browser':
    '安装 okwork 技能,让 AI 能操作内置浏览器',
  'An update to the okwork skill is available': 'okwork 技能有可用更新',
  'Install': '安装',
  'Update': '更新',
  'Installing…': '安装中…',
  'Dismiss': '关闭',
  'Hide for 24 hours': '隐藏 24 小时',
  'okwork skill installed · restart the agent (or start a new one) to use it':
    'okwork 技能已安装 · 重启 agent(或新开一个)即可使用',
  'Target machine is not connected': '目标机器未连接',
  'Disconnected from host · your open files are kept': '已与 host 断开 · 打开的文件已保留',
};
