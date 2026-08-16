// 中文字典:key = 代码内英文原文(逐字符一致,含占位符),value = 中文文案。
// 缺条目 → t() 回退英文。按 UI 区块分节维护,新增文案随改动同步补条目。
export const zh: Record<string, string> = {
  // --- Sidebar ---
  '⬆ New version v{version} available — download, then confirm to install':
    '⬆ 新版本 v{version} — 下载后确认安装',
  'Connecting to update source…': '正在连接更新源…',
  'Waiting to confirm install…': '等待确认安装…',
  'Downloading {percent}% (confirm to install when done)':
    '下载中 {percent}%(完成后确认安装)',
  'Downloading… (confirm to install when done)': '下载中(完成后确认安装)…',
  'Restarting to finish the update…': '即将重启完成升级…',
  'Auto-update failed — opened the release page': '自动升级失败,已打开发布页',
  'Download the new version, then confirm to install and restart':
    '下载新版本，完成后确认安装并重启',
  Local: '本机',
  'Disconnected · Click to reconnect': '已断开 · 点击重连',
  Notifications: '通知',
  'Edit Project': '编辑项目',
  'Edit project': '编辑项目',
  'Browser profile': '浏览器 Profile',
  'Profiles have isolated cookies and storage. Switching reloads this project’s browser tabs.':
    'Profile 之间 cookie 与存储相互隔离;切换会重载本项目的浏览器标签。',

  // --- MachineGroup ---
  'Connecting…': '连接中…',
  'Deploying…': '部署中…',
  'Starting host…': '启动 host…',
  'Claiming…': '认领中…',
  'Verifying handshake…': '握手校验…',
  Retry: '重试',
  'Retry now (reset backoff and reconnect immediately)':
    '立即重试(复位退避即刻再连)',
  'Retry now': '立即重试',
  Reconnect: '重连',
  Connect: '连接',
  'Reconnecting…': '重连中…',
  'Round-trip time of the last health probe':
    '最近一次探活的往返耗时(含远端处理;探活迟迟不回时显示已等待时长)',
  'Not connected · Connect to see its projects':
    '未连接 · 连接后显示该机上的项目',
  'No projects on this machine yet · Add one': '此机器暂无项目 · 添加一个',

  // --- MachineWorkspaceRow ---
  Disconnected: '已断开',

  // --- NotificationCenter ---
  'Just now': '刚刚',
  '{minutes} min ago': '{minutes} 分钟前',
  '{hours} hr ago': '{hours} 小时前',
  '{days} d ago': '{days} 天前',
  'Mark all as read': '全部已读',
  Clear: '清空',
  'No notifications': '暂无通知',

  // --- TabBar ---
  'New tab (project root)': '新 Tab（项目根）',
  'New tab (choose directory…)': '新 Tab（选择目录…）',
  'Rename Tab': '重命名 Tab',
  'Leave empty to restore default name': '留空恢复默认名',

  // --- RenameModal ---
  Cancel: '取消',
  Save: '保存',

  // --- SettingsEntry ---
  'Version {version}': '版本 {version}',
  'Version unknown': '版本未知',
  Close: '关闭',
  'Keep the bottom input bar pinned to the viewport when scrolling up through history (visible and typeable)':
    '向上滚动查看历史时,把底部输入栏固定在视口底部(可见可输入)',
  'Pin bottom bar': '底部输入栏固定',
  'Dev-channel build, separate data directory, no update checks':
    '开发渠道构建,独立数据目录,不检查更新',

  // --- WorktreeDropdown ---
  'Copied path': '已复制路径',
  'Copy project path': '复制项目路径',

  // --- FilePanel ---
  'Local-only action — unavailable in remote projects':
    '本机专属操作,远程项目不可用',
  'Open diff view': '打开 Diff 视图',
  'Show in Finder': '在 Finder 中显示(跳转所在目录)',
  'Open in Finder': '在 Finder 中打开',
  'Preview in built-in browser': '内置浏览器预览',
  'New subfolder': '新建子目录',
  'Folder name': '目录名',
  'Invalid folder name': '目录名不合法',
  'Create folder failed: {error}': '创建目录失败:{error}',

  // --- FilePanel:远程文件传输(阶段3)---
  'Download to local': '下载到本机',
  'Upload to this folder': '上传到此目录',
  'Remote host is too old — click to open Remote Hosts and update it':
    '远程服务端版本过旧——点击打开「远程机」页升级',
  'Transfer already in progress': '该项正在传输中',
  'File is too large (limit {limit})': '文件过大(上限 {limit})',
  'Saved to {path}': '已保存到 {path}',
  'Uploaded {count} file(s)': '已上传 {count} 个文件',
  'Transfer canceled': '传输已取消',
  'File changed during transfer — canceled': '文件在传输中被修改,已中止',
  'Connection lost during transfer': '传输中链路断开',
  'Transfer failed: {error}': '传输失败:{error}',

  // --- 查看器:预览不了时的「下载到本机」兜底(2026-08-13)+ 头部常驻刷新/下载(08-14)---
  'Downloading… {percent}%': '下载中… {percent}%',
  'Remote host is too old — update it in Remote Hosts':
    '远程服务端版本过旧,请到「远程机」页升级',
  Download: '下载',
  'Reload from the remote machine': '从远程机重新读取',
  'Unsaved changes will be discarded. Refresh anyway?':
    '有未保存的修改,刷新会丢弃。仍要刷新吗?',

  // --- 内置浏览器:远程出口加载失败的人话文案(2026-08-14 用户报障)---
  'Nothing is listening on {target} on remote machine "{exit}" (the tunnel itself is fine)':
    '远程机「{exit}」上没有服务在监听 {target}(隧道本身正常)',
  'Tunnel to exit "{exit}" is unavailable (disconnected or reconnecting); traffic never falls back to this machine':
    '出口「{exit}」的隧道不可用(已断开或正在重连);流量不会回落本机网络',

  // --- 查看器:内置视频播放 / 大图分块加载(2026-08-14)---
  'Loading… {percent}%': '加载中… {percent}%',
  'Too large to preview ({size}MB > {limit}MB)':
    '超出预览上限({size}MB > {limit}MB)',
  'File changed while loading — refresh to retry': '文件在读取中被修改,请刷新重试',
  'Cannot play this video format — download it and open it locally':
    '无法播放该视频编码,请下载后用本机播放器打开',

  // --- 项目内 HTML 预览(openPreview.ts · openHtmlPreview 失败文案)---
  'This file is outside the project — cannot start a preview':
    '该文件不在当前项目内,无法启动预览',
  "This machine's host is too old for preview — update it from Settings → Remote Hosts":
    '该机器的 host 版本过旧,到 设置 → 远程机 点「升级」后可用预览',
  'Failed to start the preview server: {error}': '预览服务器启动失败:{error}',
  'Failed to build the preview URL': '预览地址生成失败',

  // --- App ---
  'Host process exited — press ⌘R to reload the window':
    'Host 进程已退出,⌘R 重载窗口可恢复',
  'Host connection failed: {error}': 'Host 连接失败:{error}',
  'Remote machine is not connected': '远程机未连接',
  'Connecting to host…': '连接 Host…',
  '⌘T for a new terminal': '⌘T 新建终端',
  'Add a project on the left to get started': '在左侧添加一个项目开始',

  // --- RemoteHostsPage ---
  Untitled: '未命名',
  '⚠ Connection lost': '⚠ 连接已断开',
  '✓ Connected': '✓ 已连接',
  Disconnect: '断开',
  'Failed to connect to {alias}: {reason}': '连接 {alias} 失败:{reason}',
  'Disconnecting…': '正在断开…',
  // 🔴 'Update' 字面量已被 OkworkSkillBanner 占用(→'更新',技能更新按钮);此处升级远端 host
  // 是不同语境的版本升级+强制重部署,用更具体的键名 'Update host' 防止字典重复键冲突。
  'Update host': '升级',
  'Upgrade host on {alias} to v{version}? All running sessions on that machine (including background agents and sessions from other devices) will be terminated':
    '将 {alias} 上的 host 升级到 v{version}?该机器上所有在跑会话(含后台 agent 与其他设备的会话)都会被终止',
  'Test connection': '测试连接',
  Edit: '编辑',
  Delete: '删除',
  'Current storage location': '当前存储位置',
  'Migration source': '迁移来源',
  'Migration target': '迁移目标',
  'Profile deletion cleanup': 'Profile 删除清理',
  'Previous location cleanup': '原位置清理',
  '{alias} is still used by Browser Profiles':
    '{alias} 仍被浏览器 Profile 使用',
  'Move or finish cleanup for these Profiles before deleting the Remote Host.':
    '删除远程机前，请先迁移这些 Profile 或完成其清理。',
  'Open Browser Profiles': '打开浏览器 Profile',
  'Testing connection…': '测试连接中…',
  '✓ Reachable': '✓ 已连通',
  'Claimed a running host process · Verifying handshake…':
    '已认领运行中的 host 进程 · 握手校验…',
  'Found a running host process · Claiming…':
    '发现已运行的 host 进程 · 认领中…',
  'Upload bundle': '上传 bundle',
  'Start host': '启动 host',
  'Verify handshake': '握手验证',
  'Detected remote arch · {arch}': '已探测远端架构 · {arch}',
  'Delete {alias}? Stored credentials will also be removed':
    '确认删除 {alias}?将同时清除已存凭据',
  ' · Current connection will be disconnected first': ' · 将先断开当前连接',
  Yes: '是',
  No: '否',
  Password: '密码',
  Key: '密钥',
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
  Name: '名称',
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
  'Directory name cannot be . / .. or contain /':
    '目录名不能是 . / .. 或包含 /',
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
  Create: '创建',
  'Create a new folder in the current directory': '在当前目录下新建文件夹',
  '+ New folder': '+ 新建目录',
  Select: '选择',

  // --- MarkdownPreview ---
  'mermaid render failed': 'mermaid 渲染失败',
  'Zoom out': '缩小',
  'Zoom in': '放大',
  'Fit to window (double-click has the same effect)': '适配窗口(双击同效)',
  Reset: '重置',
  'Close (Esc)': '关闭(Esc)',
  '(mermaid render failed)': '(mermaid 渲染失败)',
  'Binary file, cannot preview': '二进制文件,无法预览',
  'File too large ({size} MB), cannot preview': '文件过大({size} MB),无法预览',
  'Failed to read: {error}': '读取失败:{error}',
  'Collapse outline': '收起大纲',
  'Expand outline': '展开大纲',
  '(no headings)': '(无标题)',

  // --- FilesWindow ---
  '{count} unsaved file(s). Close the window anyway?':
    '有 {count} 个未保存的文件,确定关闭窗口?',
  'Close (⌘W)': '关闭(⌘W)',
  Preview: '预览',
  'Open with the default app': '用系统默认应用打开',
  'Open with default app': '系统应用打开',
  // 按钮短标题(工具栏)+ tooltip 复用 FilePanel 的 'Show in Finder'(在 Finder 中显示…)
  'Reveal in Finder': 'Finder 中显示',

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

  // --- HtmlPreview(项目内 HTML 预览 · 查看器窗口)---
  'Preview shows the saved file — save to refresh':
    '预览显示的是已保存内容——保存后自动刷新',
  'Save & refresh': '保存并刷新',

  // --- store ---
  'Remote operations are unavailable in local fallback mode':
    '远程操作在本地回退模式下不可用',
  'Failed to create project, please retry': '新增项目失败,请重试',
  'Failed to delete project, please retry': '删除项目失败,请重试',
  'Failed to rename project, please retry': '重命名项目失败,请重试',

  // --- persistence ---
  'Failed to read the project registry, retrying…':
    '无法读取项目注册表,正在重试…',
  'Project migration is not yet complete — continuing with the local archive (will retry automatically)':
    '项目迁移暂未完成,已继续以本地存档运行(将自动重试)',

  // --- sessionEvents ---
  '{label} · Command finished': '{label} · 命令完成',
  '{label} · Command finished (exit code {code})':
    '{label} · 命令完成(退出码 {code})',
  'OkWork · Done': 'OkWork · 完成',
  '{label} · Bell rang (may be waiting for input)':
    '{label} · 响铃(可能在等输入)',
  'OkWork · Attention': 'OkWork · 注意',
  '{label} · Quiet for 1+ min, may be waiting for input':
    '{label} · 静默 1 分钟+,可能在等输入',

  // --- terminalRegistry ---
  '[OkWork] Terminal failed to start: {message}':
    '[OkWork] 终端启动失败:{message}',
  'Close this tab and reopen it to retry': '关闭该 tab 后重新打开即可重试',
  '[OkWork] Session mirrored on another device took exclusive control — switch back to this tab to re-mirror':
    '[OkWork] 会话已被另一设备独占接管 · 回到此 tab 自动恢复镜像',
  '[OkWork] Could not restore this session after reconnecting: {message} — press any key to retry':
    '[OkWork] 重连后未能恢复此会话:{message} —— 按任意键即重试恢复',

  // --- bottomBarPin ---
  '↓ Back to bottom': '↓ 回到底部',

  // --- shared/remoteHost FAIL_REASON_COPY ---
  Unreachable: '不可达',
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
  'No bundled host build for this remote architecture':
    '该远端架构暂无内置 host 产物',
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
  'Connection orchestration error (see app logs)':
    '连接编排异常（详见应用日志）',

  // --- main/exitConfirmation ---
  'Close the main window?': '关闭主窗口？',
  'Tab content may be lost after closing and reopening. Cancel to keep Project, Tab, and Terminal views available.':
    '关闭后再打开，Tab 内容可能丢失。取消后 Project、Tab 和 Terminal 视图保持可用。',
  'Close Window': '关闭窗口',
  'Quit OkWork?': '退出 OkWork？',
  'Tab content may be lost after quitting and reopening. State still gets a chance to persist before exit.':
    '退出后再打开，Tab 内容可能丢失。确认退出前会保留原有状态落盘机会。',
  Quit: '退出',
  'Install v{version} and restart?': '安装 v{version} 并重启？',
  'Install the update and restart?': '安装更新并重启？',
  'The update has been downloaded. After confirming, OkWork restarts and hands off to Squirrel.Mac to finish installing.':
    '升级包已下载完成。确认后 OkWork 会重启并交给 Squirrel.Mac 完成安装。',
  Later: '稍后',
  'Install and Restart': '安装并重启',

  // --- 设置弹层共用 ---
  Done: '完成',

  // --- 设置:语言弹层 ---
  'Interface language': '界面语言',
  'Follow the system language.': '跟随系统语言。',

  // --- 设置:浏览器设置弹层(链接打开方式 + 内置浏览器默认打开方式) ---
  'Browser Settings': '浏览器设置',
  'Where terminal links open, and how the built-in browser opens.':
    '终端里点击链接的打开位置,以及内置浏览器的默认打开方式。',
  '⌘/Ctrl+click a terminal link always opens the system browser.':
    '⌘/Ctrl+点击终端链接恒用系统浏览器。',
  'Open links in': '链接打开方式',
  'Built-in browser': '内置浏览器',
  'Terminal links open in OkWork’s own browser.':
    '终端链接落 OkWork 自带的浏览器。',
  'System browser': '系统浏览器',
  'Terminal links open in your default browser.':
    '终端链接交给系统默认浏览器。',
  'Built-in for remote terminals only': '仅远程终端用内置浏览器',
  'Remote terminals use the built-in browser (localhost URLs are only reachable through it); local terminals use the system browser.':
    '远程终端用内置浏览器(localhost 类地址只有经它才可达);本机终端走系统浏览器。',
  'Open the built-in browser in': '内置浏览器默认打开方式',
  'Separate window': '独立窗口',
  'The built-in browser opens as its own OkBrowser window.':
    '内置浏览器弹成独立的 OkBrowser 窗口。',
  'In the app panel': '页面内',
  'The built-in browser opens in the panel on the right of the main window.':
    '内置浏览器开在主窗右侧的面板里。',

  // --- 设置:浏览器 Profile 管理区块(BrowserProfilesSection) ---
  'Browser profiles': '浏览器 Profile',
  'Each Profile has isolated cookies, saved passwords, storage and an optional custom User-Agent. Projects choose a Profile in their edit dialog.':
    '每个 Profile 拥有独立的 cookie、已保存密码与存储空间，并可自定义 User-Agent。项目在其编辑弹层里选择使用哪个 Profile。',
  'Passwords are encrypted on this device. After filling, the website and connected OkBrowser Agents can read them.':
    '密码已在此设备上加密。填入网页后，网站和已连接的 OkBrowser Agent 可以读取它们。',
  'OkWork (built-in)': 'OkWork(内置)',
  'Default Profile': '默认 Profile',
  'Built-in': '内置',
  'Shared default storage · system User-Agent':
    '共享默认存储 · 系统 User-Agent',
  'System default User-Agent': '系统默认 User-Agent',
  'New profile': '新建 Profile',
  'Profile name': 'Profile 名称',
  Random: '随机',
  'Generate a random User-Agent': '随机生成一个 User-Agent',
  'Password storage': '密码存储',
  'This device': '此设备',
  Offline: '离线',
  'Change location': '更改位置',
  Available: '可用',
  Connected: '已连接',
  'Reconnect this Remote Host first': '请先重新连接此远程机',
  'Profile storage compatible': 'Profile 存储兼容',
  'Update this Remote Host to use Profile storage':
    '请升级此远程机以使用 Profile 存储',
  'Could not verify Profile storage. Reconnect this Remote Host.':
    '无法验证 Profile 存储，请重新连接此远程机。',
  'Change storage location': '更改存储位置',
  'Could not load storage locations. Try again.': '无法加载存储位置，请重试。',
  'This storage location is not available. Reconnect or update the Remote Host.':
    '此存储位置当前不可用，请重新连接或升级远程机。',
  'The move could not start. The current storage location was kept.':
    '迁移无法启动，当前存储位置保持不变。',
  'Retry could not start.': '无法启动重试。',
  'The page session may continue with local cookies, but password and Profile changes are paused. Reconnect the Remote Host.':
    '页面会话和本地 cookie 可继续使用，但密码与 Profile 修改已暂停。请重新连接远程机。',
  'Copying Profile data…': '正在复制 Profile 数据…',
  'Verifying the new copy…': '正在校验新副本…',
  'Switching storage location…': '正在切换存储位置…',
  'Move failed. The previous storage location is still in use.':
    '迁移失败，仍在使用原存储位置。',
  'Move complete. The previous copy still needs cleanup.':
    '迁移已完成，原副本仍需清理。',
  'Move to {location}': '迁移到 {location}',
  'This Remote Host, its administrators, and processes running as the configured SSH user can decrypt the Profile data and saved passwords.':
    '此远程机、其管理员以及以所配置 SSH 用户运行的进程均可解密该 Profile 数据和已保存密码。',
  'Copying → Verifying → Switching. If the move fails before switching, the current location stays in use.':
    '复制 → 校验 → 切换。若在切换前失败，将继续使用当前位置。',
  'Working…': '处理中…',
  'Move Profile': '迁移 Profile',
  Continue: '继续',
  // 'Edit'/'Delete' 字典已有(RemoteHostsPage 引入),不重复加
  'Delete Profile "{name}"? Its saved passwords, cookies, logins and cache will be cleared from its storage locations.':
    '删除 Profile「{name}」？它在各存储位置中的已保存密码、cookie、登录态与缓存都将被清除。',

  // --- 浏览器 Profile(main/browserProfileStore 校验文案) ---
  'The built-in profile cannot be modified': '内置 profile 不可修改',
  'Profile name is required': 'Profile 名称不能为空',
  'Browser profile not found': '该浏览器 profile 不存在',
  'Invalid host id': '非法的主机 id',

  // --- 浏览器面板:加载失败错误条 ---
  'Page failed to load: {error}': '页面加载失败：{error}',

  // --- 浏览器面板:窗格窗口化(弹出/回落) ---
  'Move this browser to a separate window': '把浏览器弹出为独立窗口',
  'This browser is open in a separate window': '浏览器已在独立窗口打开',
  'Focus window': '聚焦窗口',
  'Dock back': '收回面板',
  'Dock back to the panel': '收回到主窗口面板',
  'Focus the OkBrowser window': '聚焦 OkBrowser 独立窗口',
  'Project browser profile — click to edit the project':
    '当前 Project 使用的浏览器 Profile——点击编辑项目',
  'Close all browser tabs?': '关闭所有浏览器标签？',
  'This window has {count} browser tabs open. "Close All" closes them all; "Hide" keeps them running and hides the window; "Dock back" returns them to the panel.':
    '该窗口开着 {count} 个浏览器标签。「全部关闭」会关掉所有标签；「隐藏」保留标签运行并隐藏窗口；「收回面板」把它们送回主窗口面板。',
  'The browser panel has {count} tabs open. "Close All" closes them all; "Hide" collapses the panel and keeps them.':
    '浏览器面板开着 {count} 个标签。「全部关闭」会关掉所有标签；「隐藏」收起面板并保留它们。',
  'Close All': '全部关闭',
  Hide: '隐藏',

  // --- main/rendererRecovery(崩溃自愈 give-up 弹窗) ---
  'OkWork keeps crashing': 'OkWork 持续崩溃',
  'Automatic recovery was stopped after repeated crashes. Press ⌘R to retry manually; if it keeps failing, quit and relaunch OkWork.':
    '多次崩溃后已停止自动恢复。按 ⌘R 手动重试；若仍反复失败，请退出并重新打开 OkWork。',
  OK: '好',

  // --- main/main 右键菜单 ---
  'Rename…': '重命名…',
  'Close Tab': '关闭 Tab',
  Copy: '复制',
  Paste: '粘贴',
  'Select All': '全选',
  'Clear Screen': '清屏',
  Speech: '语音',
  'The local clipboard has no image or text to paste':
    '本机剪贴板中没有可粘贴的图片或文本',
  'Could not paste the clipboard into the remote terminal: {message}':
    '无法把剪贴板内容粘贴到远程终端：{message}',
  'The Remote Host is running an older version; update it from Settings → Remote Hosts to enable image paste':
    '远程 Host 版本过旧;到 设置 → 远程机 点「升级」后即可粘贴图片',

  // --- main/remote 凭据与编排 ---
  'Local credential encryption is unavailable — cannot store the password safely':
    '本机凭据加密不可用,无法安全保存密码',
  'Found node {version} ({path}), but ≥ {major} is required':
    '已找到 node {version}({path}),但需要 ≥ {major}',

  // --- opus 评审 P1-1 补漏(阶段2 t() 化后漏进字典的 key)---
  Host: '主机',
  User: '用户',
  Port: '端口',
  'No projects': '暂无项目',
  'Remove project': '移除项目',
  'Remove project "{name}"? Terminal sessions will be closed.':
    '移除项目“{name}”？其终端会话将被关闭。',
  'New tab': '新 Tab',
  'New tab options': '新 Tab 选项',
  'Close tab': '关闭 Tab',
  Files: '文件',
  'Show file panel': '显示文件面板',
  'Hide file panel': '隐藏文件面板',
  'Show browser': '显示内置浏览器',
  'Hide browser': '隐藏内置浏览器',
  'No session': '无会话',
  Refresh: '刷新',
  Apply: '应用',
  'Choose…': '选择…',
  'Reload worktrees': '重新加载 worktree',
  'not a git repo': '非 git 仓库',
  '(unreadable)': '(不可读)',
  '{count} entries': '{count} 项',
  About: '关于',
  Settings: '设置',
  Language: '语言',
  System: '跟随系统',
  '‹ OUTLINE': '‹ 大纲',

  // --- 浏览器密码库(BL-006) ---
  'Saved Passwords': '已保存的密码',
  'Search saved passwords': '搜索已保存的密码',
  'Search site, username or Profile': '搜索网站、用户名或 Profile',
  'Filter by Profile': '按 Profile 筛选',
  'All Profiles': '全部 Profile',
  'Loading saved passwords': '正在加载已保存的密码',
  'No saved passwords yet': '还没有已保存的密码',
  'A password appears here after a confirmed sign-in in OkBrowser.':
    '在 OkBrowser 中确认登录成功后，密码会出现在这里。',
  'No matching saved passwords': '没有匹配的已保存密码',
  'Try another site, username or Profile filter.':
    '请尝试其他网站、用户名或 Profile 筛选条件。',
  'Encrypted on this device': '已在此设备上加密',
  'Open trusted window…': '打开受信任窗口…',
  'Opening…': '正在打开…',
  'Deleting…': '正在删除…',
  'Delete this saved password?': '删除这个已保存的密码？',
  'Could not load saved passwords': '无法加载已保存的密码',
  'Could not delete this saved password. The entry was kept; try again.':
    '无法删除这个已保存的密码。条目已保留，请重试。',
  'Could not open the trusted password window. Try again.':
    '无法打开受信任密码窗口，请重试。',
  'System encryption is unavailable. No passwords were returned or changed.':
    '系统加密不可用。未返回或更改任何密码。',
  'The local vault could not be read safely. No passwords were returned or changed.':
    '无法安全读取本地密码库。未返回或更改任何密码。',
  'The local vault could not be opened. Try again.':
    '无法打开本地密码库，请重试。',
  'The local vault is temporarily unavailable. No passwords were returned or changed.':
    '本地密码库暂时不可用。未返回或更改任何密码。',
  'This list contains metadata only. Passwords stay encrypted and bound to an exact site and Profile.':
    '此列表仅包含元数据。密码保持加密，并精确绑定到网站和 Profile。',
  'OkWork will not save, fill, reveal or copy passwords until system encryption is available.':
    '系统加密恢复可用前，OkWork 不会保存、填充、显示或复制密码。',
  Disabled: '已停用',
  Unknown: '未知',

  'Trusted password window': '受信任密码窗口',
  'Loading saved password…': '正在加载已保存的密码…',
  'Isolated presentation · ordinary OkWork pages cannot trigger decryption':
    '隔离展示 · 普通 OkWork 页面无法触发解密',
  'Password safety notes': '密码安全说明',
  'Only your explicit click in this window can decrypt and copy this password.':
    '只有你在此窗口中的明确点击才能解密和复制这个密码。',
  'Reveal password': '显示密码',
  'Revealing…': '正在显示…',
  'Reveal for 10 seconds again': '再次显示 10 秒',
  'Password masked': '密码已遮盖',
  'Password revealed': '密码已显示',
  'The password is hidden by default and is masked again after 10 seconds.':
    '密码默认隐藏，并会在 10 秒后重新遮盖。',
  'Visible only in this window. Masking again in {seconds} seconds.':
    '仅在此窗口可见。将在 {seconds} 秒后重新遮盖。',
  'Copy password': '复制密码',
  'Copy to system clipboard': '复制到系统剪贴板',
  'Copying…': '正在复制…',
  'Copy again · reset 60 seconds': '再次复制 · 重新计时 60 秒',
  'Clipboard clear lease: {seconds} seconds remaining':
    '剪贴板清除倒计时：剩余 {seconds} 秒',
  'Copied. It will be cleared in {seconds} seconds only if the clipboard has not changed.':
    '已复制。如果剪贴板内容未被更改，将在 {seconds} 秒后清除。',
  'Copying exports the password to the system clipboard. Other apps and ordinary OkWork pages may read it.':
    '复制会将密码导出到系统剪贴板，其他应用和普通 OkWork 页面可能读取它。',
  'Other apps and ordinary OkWork pages may read the exported value until it is cleared.':
    '导出的内容被清除前，其他应用和普通 OkWork 页面可能读取它。',
  'System encryption is unavailable. The password was not released.':
    '系统加密不可用，密码未被释放。',
  'This password could not be decrypted. It was not released.':
    '无法解密这个密码，密码未被释放。',
  'This saved password no longer exists.': '这个已保存的密码已不存在。',
  'This window is no longer authorized to access the saved password.':
    '此窗口已无权访问这个已保存的密码。',
  'The password action could not be completed safely. Try again.':
    '无法安全完成密码操作，请重试。',

  'Password vault · this device': '密码库 · 此设备',
  'Filled values are readable by this page and connected OkBrowser Agents':
    '填充值可被此页面及已连接的 OkBrowser Agent 读取',
  'After an explicit copy, other local apps and ordinary OkWork pages may read the password from the system clipboard; OkWork clears it after 60 seconds only if unchanged.':
    '用户明确复制后，其他本机应用和普通 OkWork 页面可能从系统剪贴板读取密码；仅当内容未变化时，OkWork 才会在 60 秒后清除。',
  'Password filled from {profile}': '已从 {profile} 填充密码',
  'Account: {username}': '账号：{username}',
  'Saved account filled': '已填充保存的账号',
  'A saved account was selected': '已选择一个保存的账号',
  '{username} · more accounts are available': '{username} · 还有其他账号可用',
  'More saved accounts are available for this site': '此网站还有其他已保存账号',
  'Switch account': '切换账号',
  'New password saved automatically': '新密码已自动保存',
  '{profile} · stored in {location}': '{profile} · 存储于 {location}',
  '{profile} · encrypted on this device': '{profile} · 已在此设备上加密',
  'Saved password updated': '已更新保存的密码',
  'The previous password was replaced only after a confirmed sign-in.':
    '仅在确认登录成功后才替换了旧密码。',
  'Sign-in failed · saved password unchanged': '登录失败 · 已保存密码未更改',
  'Correct the password and try again.': '请更正密码后重试。',
  'Could not confirm sign-in · password not saved':
    '无法确认登录成功 · 未保存密码',
  'Any existing saved password remains unchanged.': '现有已保存密码保持不变。',
  'Password protection is unavailable': '密码保护不可用',
  'OkWork will not save, fill, reveal or copy passwords.':
    'OkWork 不会保存、填充、显示或复制密码。',
  'The page session may continue, but password save and fill are paused.':
    '页面会话可继续使用，但密码保存与填充已暂停。',
  'Password features are disabled on this HTTP page':
    '此 HTTP 页面已停用密码功能',
  'Use HTTPS or loopback HTTP to save and fill passwords.':
    '请使用 HTTPS 或回环 HTTP 来保存和填充密码。',
  'current Profile': '当前 Profile',
  Manage: '管理',
  'After filling a web page': '填充网页后',
  'After copying to the clipboard': '复制到剪贴板后',
  'The website and connected OkBrowser Agents can read values in the page DOM.':
    '网站和已连接的 OkBrowser Agent 可以读取页面 DOM 中的值。',
  'Search masked entries and open the isolated trusted password window.':
    '搜索遮盖的条目，并打开隔离的受信任密码窗口。',
  'Delete failed': '删除失败',
  'Retry cleanup': '重试清理',
  'Profile cleanup did not finish. The profile remains disabled and can be retried.':
    'Profile 清理未完成。该 Profile 保持停用，可再次重试。',
  '{count} saved passwords': '{count} 个已保存密码',
  'The Remote Host storing this Profile is offline. Reconnect it and retry.':
    '存储此 Profile 的远程机已离线，请重新连接后重试。',
  'The Remote Host did not respond. Check the connection and retry.':
    '远程机没有响应，请检查连接后重试。',
  'Password changes are paused while this Profile is moving.':
    '此 Profile 迁移期间，密码修改已暂停。',
  'The remote password storage could not be opened safely. No passwords were returned.':
    '无法安全打开远程密码存储，未返回任何密码。',
  'Update the Remote Host before using password storage.':
    '请先升级远程机，再使用密码存储。',
  'The selected password storage is unavailable. OkWork will not save, fill, reveal or copy passwords until it reconnects.':
    '所选密码存储不可用。恢复连接前，OkWork 不会保存、填充、显示或复制密码。',
  'Some password storage locations are unavailable': '部分密码存储位置不可用',
  'Unavailable Profiles are hidden. Reconnect their Remote Host, then retry.':
    '不可用的 Profile 已隐藏，请重新连接对应远程机后重试。',
  'Password storage follows each Profile': '密码存储位置跟随各 Profile',

  // --- 应用菜单(main · buildMenu) ---
  'New Tab': '新建 Tab',
  'Quit {name}': '退出 {name}',
  File: '文件',

  // 以下 key 有意留英(两端同文案),勿当漏项:
  //   '0 session' / '{count} session' / '{count} session · {running} running'
  //     —— 用户指定徽章用 "N session"(2026-07-11);
  //   'DEV'(渠道徽标)/ 'Root' / 'WorkTree' / 'Diff' / 'diff' / 'detached' /
  //   'detached · {head}' / '{branch} · {head}' / 'exit {code}' / 'exited'
  //     —— git/终端术语与纯插值,不译;
  //   'English' / '简体中文'(语言名以本族语显示)/ 'Shell'(菜单标题,终端术语)。

  // --- BrowserPanel ---
  Back: '后退',
  Forward: '前进',
  Stop: '停止',
  'Open in system browser': '用系统浏览器打开',
  'Enter a URL or search to get started': '输入网址或搜索内容开始浏览',
  'Local network': '本机网络',
  'No connected remote machines': '无已连接的远程机',
  'Browser network exit: {name}': '浏览器网络出口:{name}',
  "Preview tabs stay on their project's machine":
    '预览标签固定使用所属机器的网络出口',
  // OkWork 技能横条(okwork skill)
  'Install the okwork skill to let the AI operate the built-in browser':
    '安装 okwork 技能,让 AI 能操作内置浏览器',
  'An update to the okwork skill is available': 'okwork 技能有可用更新',
  Install: '安装',
  Update: '更新',
  'Installing…': '安装中…',
  Dismiss: '关闭',
  'Hide for 24 hours': '隐藏 24 小时',
  'okwork skill installed · restart the agent (or start a new one) to use it':
    'okwork 技能已安装 · 重启 agent(或新开一个)即可使用',
  'Target machine is not connected': '目标机器未连接',
  'Disconnected from host · your open files are kept':
    '已与 host 断开 · 打开的文件已保留',
};
