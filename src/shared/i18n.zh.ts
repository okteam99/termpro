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
  "Remote files aren't supported in a separate window yet": '远程文件独立窗口暂不支持',
  'Open diff view': '打开 Diff 视图',
  'Open with default browser': '用系统默认浏览器打开',
  'Show in Finder': '在 Finder 中显示(跳转所在目录)',
  'Open in Finder': '在 Finder 中打开',

  // --- App ---
  'Host process exited — press ⌘R to reload the window': 'Host 进程已退出,⌘R 重载窗口可恢复',
  'Host connection failed: {error}': 'Host 连接失败:{error}',
  'Connecting to host…': '连接 Host…',
  '⌘T for a new terminal': '⌘T 新建终端',
  'Add a workspace on the left to get started': '在左侧添加一个 Workspace 开始',
};
