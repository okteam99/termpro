// HostService 协议:UI ↔ Host 之间唯一的通信契约(README §5)。
// 传输无关:本地走 MessagePort,远程走 WebSocket,消息形状不变。

export const PROTOCOL_VERSION = 1;

// 本端能兼容对话的最旧协议版本(闭区间下界)。向后兼容追加不 bump PROTOCOL_VERSION,
// 仅破坏性变更才上调。缺省(旧 host 不带此字段)按等同 protocolVersion 处理。
export const PROTOCOL_MIN_COMPATIBLE = 1;

/**
 * 客户端依赖的服务端(host)最低应用版本(用户规则 2026-07-13)。
 * 连接时 host.info.appVersion 低于此值(或旧 host 未上报)→ 先升级服务端,在跑任务可关闭;
 * ≥ 此值即收养(即使低于客户端自身版本——不为无关紧要的小版本差杀 session)。
 * 🔴 硬编码维护:客户端功能开始依赖更新的 host 行为/RPC 时,上调到该行为首次发布的版本。
 * 当前 = 快照 bracketedPaste 字段引入版本(收养回放恢复粘贴聚合依赖 host 上报)。
 */
export const HOST_MIN_APP_VERSION = '0.3.58';

// PTY 输出流控水位(未确认字节数):超过 high 暂停 PTY,低于 low 恢复。
export const FLOW = {
  highWatermark: 512 * 1024,
  lowWatermark: 128 * 1024,
} as const;

/**
 * 远程文件传输(下载/上传)分块参数。
 * chunkBytes = 512KiB:明文块 base64 编码后 ≈683KB,约占 WS_MAX_PAYLOAD(host/wsServer.ts,
 * 32MB)2.1% —— 上界受共享 SSH 隧道队头阻塞约束(块太大 → 单块占满隧道带宽,同隧道复用的
 * 其他 RPC/PTY 流量排队延迟陡增);下界受 RTT 吞吐天花板(块太小 → 单块往返开销主导,
 * 高延迟链路吞吐塌缩,例如洲际链路 RTT 200ms 时几十 KB 的块跑不满带宽)。
 * maxChunkBytes = 1MiB:host 侧钳制的分块上限(高带宽低延迟链路可用更大块,但不得超此值)。
 * maxFileBytes = 2GiB:单文件传输上限(超出建议走 rsync/scp 等专用工具)。
 * maxConcurrentUploads = 4:单客户端在途上传并发上限(防大量并发写打爆磁盘 IO/fd)。
 */
export const TRANSFER = {
  chunkBytes: 512 * 1024,
  maxChunkBytes: 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  maxConcurrentUploads: 4,
} as const;

export interface SpawnOptions {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
}

export interface HostInfo {
  hostId: string;
  protocolVersion: number;
  /** 本端能兼容的最旧协议版本;缺省视同 = protocolVersion(向后兼容) */
  minCompatible?: number;
  platform: string;
  homedir: string;
  shell: string;
  /**
   * 能力位(向后兼容追加·BL-005)。含 'session.resume' 表示支持 session.list/attach
   * (断线重连回放收养)。旧 host 省略(undefined)→ renderer 判为不支持 → 重连退化 new spawn。
   * 🔴 稳定信号 = 字段存在性,非错误文案匹配(QA-14)。standalone host 填,embedded 省略。
   */
  capabilities?: string[];
  /**
   * host 软件的应用版本(x.y.z,向后兼容追加)。编排器启动 host 时经
   * OKWORK_HOST_APP_VERSION 注入,与部署的 bundle/<version>/ 同源。
   * 🔴 用户规则 2026-07-13:连接时 host 版本低于客户端依赖的最低版本
   * (HOST_MIN_APP_VERSION)→ 先升级服务端(在跑任务可关闭)。
   * 旧 host 省略(undefined)→ main 侧视为过旧,一样触发升级(versionCompat.isHostAppOutdated)。
   */
  appVersion?: string;
}

/**
 * 会话状态快照(session.list 返回元素 · BL-005)。tracker「当前态」——
 * 🔴 不含未读计数 / 离散 bell·notify 累积(sessionTracker emit-and-forget·M-1/ARCH-5)。
 */
export interface SessionSnapshot {
  sessionId: string;
  /** spawn cwd(AC-3 重建 tab 用) */
  cwd: string;
  /** 最近前台进程名(pty.process);exited 后取退出前最后已知值 */
  title: string;
  /** live = 运行中;exited = 断开期跑完/崩溃的保留态(AC-12) */
  status: 'live' | 'exited';
  /** tracker 当前态(AC-5 徽标对账) */
  state: 'idle' | 'running';
  quiet: boolean;
  altscreen: boolean;
  /**
   * 前台 TUI 是否已开 bracketed paste(?2004h)。ring 只存字节,开机时的模式序列常被
   * 挤出全量回放切片 → renderer 收养 reset 后据此恢复 xterm 模式(粘贴聚合依赖 200~ 包裹)。
   * 旧 host 省略(undefined)→ 不恢复(向后兼容,行为同修复前)。
   */
  bracketedPaste?: boolean;
  /**
   * 前台 TUI 当前开着的鼠标/焦点上报私有模式(?1000 / ?1002 / ?1006 … 见
   * RESTORABLE_DEC_MODES)。与 bracketedPaste 同因:这些模式序列在 TUI 启动瞬间发出,
   * 断线久了早被挤出 ring 全量切片,收养 reset() 后 xterm 不再编码鼠标事件 →
   * 「重连后鼠标点不动」(用户报障 2026-08-14,opencode 一类可鼠标交互的 TUI)。
   * 旧 host 省略(undefined)→ 不恢复(向后兼容,行为同修复前)。
   */
  mouseModes?: number[];
  /** status='exited' 时的退出码;live 为 null */
  exitCode: number | null;
}

/**
 * 收养全量回放时允许据快照补写的 DEC 私有模式白名单(鼠标上报 + 编码 + 焦点上报)。
 * 🔴 白名单而非透传:补写的字节直接进本地 xterm 解析,只放行这些**无视觉副作用**的
 * 输入类模式;屏幕类模式(?1049 备用屏等)另有专门分支(会清屏,必须判切片自含)。
 */
export const RESTORABLE_DEC_MODES = [
  9, // X10 兼容鼠标(仅按下)
  1000, // VT200 鼠标(按下+释放)
  1001, // 高亮鼠标跟踪
  1002, // 按钮事件(含拖动)
  1003, // 任意移动事件
  1004, // 焦点进出上报
  1005, // UTF-8 扩展坐标
  1006, // SGR 扩展坐标(现代 TUI 主流)
  1015, // urxvt 扩展坐标
  1016, // SGR 像素级坐标
] as const;

/** 快照里的模式号是否可安全补写(host 上报与 renderer 补写两侧共用同一判据) */
export function isRestorableDecMode(mode: number): boolean {
  return (RESTORABLE_DEC_MODES as readonly number[]).includes(mode);
}

/**
 * session.attach 返回(重连收养回放 · BL-005)。
 * 🔴 nextOffset = 回放后的绝对字节偏移(renderer 据此更新 renderedBytes·不自算 byteLength·EXT-B-5)。
 */
export interface SessionAttachResult {
  /** false = 该 sessionId 已不存在(被逐/从未有)→ renderer 退化 new spawn(AC-11 幂等收养 miss) */
  found: boolean;
  /** true = renderer 须先 term.reset() 清屏再写 data(gap 超缓冲/重建 tab);false = 增量补屏 */
  full: boolean;
  /** data 首字节的绝对偏移 */
  baseOffset: number;
  /** 回放载荷(gap 或整缓冲;UTF-8 安全边界切片) */
  data: string;
  /** 回放后的绝对偏移(= baseOffset + 本次 data 字节数);renderer 用它更新 renderedBytes */
  nextOffset: number;
  /** 收养即返当前快照(AC-5 对账,省一次 list) */
  snapshot: SessionSnapshot;
}

export interface GitInfo {
  /** 会话所在工作区(worktree)根;非 git 目录为 null */
  toplevel: string | null;
  /** 该仓库主工作区(main worktree)根 */
  mainWorktree: string | null;
  /** 当前分支名;detached 时为短 SHA */
  branch: string | null;
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

export interface GitStatusEntry {
  /** 相对 toplevel 的路径 */
  path: string;
  status: GitFileStatus;
}

export interface WorktreeInfo {
  /** 工作区根(绝对路径);列表第一项为主工作区 */
  path: string;
  /** 分支名;detached 为 null */
  branch: string | null;
  /** HEAD 短 SHA */
  head: string;
}

/** Workspace 注册表记录(Host 单源:id/name/root)。协议 DTO + 推送快照元素。 */
export interface WorkspaceEntry {
  /** 稳定 id(幂等键 + UI 存档 v2 外键单源);create 省略时 Host 生成 */
  id: string;
  /** 展示名(Host 单源) */
  name: string;
  /** 绝对路径的 workspace 根目录 */
  root: string;
}

// RPC 方法签名表:新增方法在这里登记,两端自动获得类型。
export interface RpcMethods {
  'host.info': { params: undefined; result: HostInfo };
  'pty.spawn': { params: SpawnOptions; result: { sessionId: string } };
  'pty.kill': { params: { sessionId: string }; result: undefined };
  /** 查询会话 shell 进程的实时 cwd(macOS lsof / Linux procfs) */
  'pty.cwd': { params: { sessionId: string }; result: { cwd: string | null } };
  'fs.readdir': { params: { path: string }; result: { entries: DirEntry[] } };
  'fs.home': { params: undefined; result: { path: string } };
  /** 递归监听目录变化,事件经 fs:changed 推送 */
  'fs.watch': { params: { path: string }; result: { watchId: number } };
  'fs.unwatch': { params: { watchId: number }; result: undefined };
  /** 轻量存在性检查(终端链接 hover 校验用);kind='file' 时 size/mtimeMs 由带
   *  'fs.transfer' 能力位的 host 恒填(下载前的元信息预检,不必先发 readFileRange 打头阵)。
   *  旧 host / 无该能力位时字段可能省略,renderer 按 undefined 兜底。 */
  'fs.stat': {
    params: { path: string };
    result: { kind: 'file' | 'dir' | null; size?: number; mtimeMs?: number };
  };
  /** 解析真实路径;不存在/不可读时返回 null */
  'fs.realpath': { params: { path: string }; result: { path: string | null } };
  'git.info': { params: { cwd: string }; result: GitInfo };
  'git.status': {
    params: { toplevel: string };
    result: { entries: GitStatusEntry[] };
  };
  /** 列出 cwd 所属仓库的全部工作区(供 WorkTree 面板下拉绑定) */
  'git.worktrees': { params: { cwd: string }; result: { worktrees: WorktreeInfo[] } };
  /** 读文本文件(2MB 上限;二进制/超限 content=null 并置标记) */
  'fs.readFile': {
    params: { path: string };
    result: { content: string | null; binary: boolean; truncated: boolean; size: number };
  };
  /** 读二进制文件(图片预览用,20MB 上限);超限 → base64=null */
  'fs.readFileBinary': {
    params: { path: string };
    result: { base64: string | null; size: number };
  };
  'fs.writeFile': { params: { path: string; content: string }; result: undefined };
  /**
   * 把受限类型的 base64 数据写入 Host 自分配的临时文件。路径/文件名不由 renderer 指定,
   * 防目录穿越;当前仅开放 PNG(远程剪贴板图片)。
   */
  'fs.writeTempFile': {
    params: { kind: 'png'; base64: string };
    result: { path: string };
  };
  /** 把 src 移动进 destDir(拖拽内部移动);重名自动加后缀不覆盖;原地移动忽略;
   *  禁止把目录移进自身/子孙。返回最终目标绝对路径。 */
  'fs.move': {
    params: { src: string; destDir: string };
    result: { dst: string };
  };
  /** 把 src 复制进 destDir(外部拖入/复制);递归;重名自动加后缀;返回最终目标绝对路径。 */
  'fs.copy': {
    params: { src: string; destDir: string };
    result: { dst: string };
  };
  /** 新建单层目录(目录浏览器「新建目录」用);父目录须已存在,已存在/无权限抛错 */
  'fs.mkdir': { params: { path: string }; result: undefined };
  // ---- 远程文件传输:下载(分块读)/ 上传(分块写)· TRANSFER 常量定分块/并发上限 ----
  /** 分块读文件(下载用):offset/length 定位;length 钳 [1, TRANSFER.maxChunkBytes]。
   *  eof=true 表示读到文件末尾(含越界读:offset≥size → bytes=0,eof=true)。
   *  size/mtimeMs 与本次读取取自同一 fd(与实际读取内容强一致,防 TOCTOU)。 */
  'fs.readFileRange': {
    params: { path: string; offset: number; length: number };
    result: { base64: string; bytes: number; eof: boolean; size: number; mtimeMs: number };
  };
  /** 开始一次上传(分块写):目标目录/文件名/声明大小由 renderer 提供,临时落地路径由
   *  Host 自分配(renderer 无法指定,防目录穿越;同 fs.writeTempFile 口径)。 */
  'fs.uploadBegin': {
    params: { destDir: string; name: string; size: number };
    result: { transferId: string };
  };
  /** 写入一个分块;offset 须等于已接收字节数(强制顺序到达,乱序/重传直接拒绝且不落盘)。 */
  'fs.uploadChunk': {
    params: { transferId: string; offset: number; base64: string };
    result: { received: number };
  };
  /** 结束上传:commit=true → 原子落地到目标目录(重名自动加后缀,不覆盖已有文件);
   *  commit=false → 放弃并清理临时文件。未知 transferId:commit=false 幂等返回 path=null,
   *  commit=true 抛错。 */
  'fs.uploadEnd': {
    params: { transferId: string; commit: boolean };
    result: { path: string | null };
  };
  /** 读 ref 下的文件内容(不存在/二进制 → null) */
  'git.show': {
    params: { toplevel: string; ref: string; path: string };
    result: { content: string | null };
  };
  /** 变更文件列表:有 baseRef 时 = merge-base(baseRef,HEAD) 与工作区的差异;否则 = 未提交变更 */
  'git.changedFiles': {
    params: { toplevel: string; baseRef?: string };
    result: { entries: GitStatusEntry[]; mergeBase: string | null };
  };
  // ---- Workspace 注册表(驻留 Host,模型 A 地基)----
  /** 列出机器全部 workspace(注册表全量,顺序=插入序,排序是 UI 视图态职责) */
  'workspace.list': { params: undefined; result: { workspaces: WorkspaceEntry[] } };
  /** 新建/迁移写入;幂等:id 已存在→返回既有(不重复插入)。省略 id 时 Host 生成 */
  'workspace.create': {
    params: { id?: string; name: string; root: string };
    result: WorkspaceEntry;
  };
  /** 删除;幂等:不存在→no-op success */
  'workspace.remove': { params: { id: string }; result: undefined };
  /** 改名/改根;不存在→抛错;同值→no-op。返回更新后记录 */
  'workspace.update': {
    params: { id: string; name?: string; root?: string };
    result: WorkspaceEntry;
  };
  // ---- 断线重连回放收养(BL-005 · 向后兼容追加 · 不 bump PROTOCOL_VERSION)----
  /**
   * 列出该 host 现存会话(含 exited 保留态)+ 状态快照。token 闸后单租户全可见
   * (AC-8:连上机器即见全部会话是特性)。旧 host 无此方法 → unknown rpc 稳定错误 →
   * renderer catch 退化 new spawn(双保险:能力位 capabilities + catch)。
   */
  'session.list': { params: undefined; result: { sessions: SessionSnapshot[] } };
  /**
   * 重连收养既有会话:换 send + 回放缓冲 + resize 对账 + last-attach-wins 所有权转移。
   * resumeOffset = renderer 报的「已渲染绝对字节偏移」(非 host ack 计数·防双写·ARCH-B-4)。
   * found=false → 该 sessionId 已不存在,renderer 退化 new spawn(AC-11)。
   */
  'session.attach': {
    params: {
      sessionId: string;
      resumeOffset: number;
      cols: number;
      rows: number;
      /** 'mirror'=加入订阅(多端同屏,不摘他人);缺省/'exclusive'=独占接续(last-attach-wins,
       *  摘除其他订阅者并各发 session:takenover)。旧客户端省略 → 'exclusive' 零回归(M2)。 */
      mode?: 'mirror' | 'exclusive';
    };
    result: SessionAttachResult;
  };
  // ---- OkWork 会话内技能探测/安装(okwork skill · 向后兼容追加)----
  /** 探测某技能在各 agent 位置的安装版本 + agent 存在性(横条据此判未装/可更新)。 */
  'skill.status': { params: { name: string }; result: SkillStatusResult };
  /** 安装/更新:把 SKILL.md 写入 canonical + 各已装 agent 的 skills 目录;返回安装后状态。 */
  'skill.install': { params: { name: string; content: string }; result: SkillStatusResult };
  // ---- 项目内 HTML 预览(host/previewServer.ts · 向后兼容追加)----
  /** 懒启动/幂等:为 root 起(或复用既有)静态预览 server,返回其 port/token。 */
  'preview.ensure': { params: { root: string }; result: PreviewInfo };
  /** 关闭 root 对应的预览 server(全局:不分客户端,同 root 共用同实例故全局停)。 */
  'preview.stop': { params: { root: string }; result: { stopped: boolean } };
  // ---- 云端浏览器(host/browserService.ts · headless Chromium · 向后兼容追加)----
  // 默认无头:agent 与浏览器同机,不再经 SSH 反向转发打回本机浏览器。
  // 只有本地要预览时才起 screencast(browser.startPreview),平时零画面流量。
  /** 探测远端 Chromium 可用性 + 当前运行状态(不启动;找不到时带安装指引)。 */
  'browser.status': { params: undefined; result: BrowserRuntimeStatus };
  /** 列出云端浏览器的标签(首次调用会懒启动 Chromium)。 */
  'browser.listTabs': { params: undefined; result: { tabs: BrowserTabSnapshot[] } };
  'browser.openTab': { params: { url?: string }; result: { tabId: string } };
  'browser.closeTab': { params: { tabId: string }; result: undefined };
  'browser.activateTab': { params: { tabId: string }; result: undefined };
  /** tabId 省略 = 当前活跃标签(无标签时自动开一个)。 */
  'browser.navigate': { params: { tabId?: string; url: string }; result: { tabId: string } };
  /** 刷新标签(☁ 预览的工具栏动作;tabId 省略 = 当前活跃标签)。 */
  'browser.reload': { params: { tabId?: string }; result: undefined };
  /** 历史后退/前进。ok=false = 没有可去的历史条目(与本地 webview 的静默 no-op 同语义)。 */
  'browser.goBack': { params: { tabId?: string }; result: { ok: boolean } };
  'browser.goForward': { params: { tabId?: string }; result: { ok: boolean } };
  'browser.eval': { params: { tabId?: string; code: string }; result: { value: unknown } };
  /** 可见区 PNG(base64,不含 data: 前缀)。 */
  'browser.screenshot': { params: { tabId?: string }; result: { base64: string } };
  'browser.getHtml': { params: { tabId?: string }; result: { html: string } };
  'browser.getText': { params: { tabId?: string }; result: { text: string } };
  'browser.click': { params: { tabId?: string; selector: string }; result: { ok: boolean } };
  'browser.type': {
    params: { tabId?: string; selector: string; text: string };
    result: { ok: boolean };
  };
  'browser.scroll': { params: { tabId?: string; dy?: number }; result: { scrollY: number } };
  'browser.waitFor': {
    params: { tabId?: string; selector: string; timeoutMs?: number };
    result: { ok: boolean };
  };
  /** 显式关掉云端 Chromium(省远端内存;下次调用会重新懒启动)。 */
  'browser.shutdown': { params: undefined; result: undefined };
  // ---- 本地预览(只有要看的时候才开;关掉即零画面流量)----
  /**
   * 开始把该标签的画面推回本地(CDP screencast → browser:frame 事件)。
   * 🔴 帧走 ack 门控(见 browser:frameAck):隧道上恒最多一帧在途,
   * 画面不会把同隧道的终端输出与心跳挤到队尾(那条隧道 FIFO 无优先级)。
   */
  'browser.startPreview': {
    params: {
      tabId?: string;
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
      /**
       * 独立帧通道的关联 id(客户端自己生成的 UUID,先连 /frames?sid=<它> 再发本调用)。
       * 带上 → 帧走那条**二进制**通道(独立 SSH channel,不与终端挤同一条 FIFO);
       * 省略 → 退回主连接的 browser:frame JSON 消息(旧客户端零破坏)。
       */
      streamId?: string;
    };
    result: { tabId: string; /** 帧是否走了独立二进制通道(false = 退回 JSON) */ binary: boolean };
  };
  /** 停止推流(不关标签、不关浏览器)。tabId 省略 = 停全部。 */
  'browser.stopPreview': { params: { tabId?: string }; result: undefined };
  /** 把本地的鼠标/键盘事件派发到云端页面(坐标系 = 帧 metadata 的设备像素)。 */
  'browser.input': {
    params: { tabId?: string; event: BrowserInputEvent };
    result: undefined;
  };
  /** 预览窗口尺寸变化 → 同步远端视口(否则看到的排版与真实宽度不符)。 */
  'browser.resize': {
    params: { tabId?: string; width: number; height: number; deviceScaleFactor?: number };
    result: undefined;
  };
}

/**
 * 预览态下从本地转发到云端页面的输入事件。字段形状对齐 CDP Input.dispatch*Event,
 * 但 host 侧会做白名单与数值校验后才转发(不盲目透传 renderer 给的东西)。
 */
export type BrowserInputEvent =
  | {
      kind: 'mouse';
      type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
      x: number;
      y: number;
      button?: 'left' | 'right' | 'middle' | 'back' | 'forward' | 'none';
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      kind: 'key';
      type: 'keyDown' | 'keyUp' | 'char';
      key?: string;
      code?: string;
      text?: string;
      windowsVirtualKeyCode?: number;
      modifiers?: number;
    }
  /**
   * 整段文本插入(输入法上屏 / 粘贴)。
   * 🔴 中文一类的输入法上屏是「一次给出若干字」,粘贴更是任意长度——都不是按键事件,
   * 硬拆成 char 会丢掉合成语义,也过不了监听 composition 的页面。
   */
  | { kind: 'text'; text: string };

/** screencast 帧的位置/缩放信息(本地据此把点击坐标换算回页面坐标)。 */
export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
}

/**
 * 云端浏览器运行状态(browser.status)。available=false 时 hint 是给人看的安装指引——
 * host 不替用户往服务器上装浏览器,只告诉他装什么(见 host/chromiumLocator.ts)。
 */
export interface BrowserRuntimeStatus {
  available: boolean;
  executablePath: string | null;
  running: boolean;
  hint?: string;
}

/** 云端浏览器的一个标签(tabId = CDP targetId)。 */
export interface BrowserTabSnapshot {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
}

/** 项目内 HTML 预览:某 root 对应的静态 server 信息(host/previewServer.ts)。 */
export interface PreviewInfo {
  root: string;
  port: number;
  token: string;
}

/** 某技能在一个 agent 位置的状态(present=该 agent 存在;version=已装版本或 null)。 */
export interface SkillLocationStatus {
  present: boolean;
  version: string | null;
}
/** 技能在各 agent 位置的探测结果(shared=共享 ~/.agents/skills canonical)。 */
export interface SkillStatusResult {
  claude: SkillLocationStatus;
  codex: SkillLocationStatus;
  shared: SkillLocationStatus;
  /** codex 同时读 ~/.codex/skills 与 ~/.agents/skills:两处都装了同名技能 → 选择器重复,需去重。 */
  duplicate: boolean;
}

export type RpcMethodName = keyof RpcMethods;

// 会话状态事件(host 侧状态机产出;UI 不解析终端输出,只消费语义事件)
export type SessionEvent =
  | { kind: 'state'; state: 'idle' | 'running'; via: 'process' | 'osc133' }
  | { kind: 'cmd-done'; exitCode: number | null }
  | { kind: 'bell' }
  | { kind: 'notify'; title: string; body: string }
  | { kind: 'quiet'; quiet: boolean }
  | { kind: 'altscreen'; on: boolean };

// UI → Host
export type ClientMessage =
  | { t: 'rpc:req'; id: number; method: RpcMethodName; params?: unknown }
  | { t: 'pty:input'; sessionId: string; data: string }
  | { t: 'pty:resize'; sessionId: string; cols: number; rows: number }
  | { t: 'pty:ack'; sessionId: string; bytes: number }
  // 云端浏览器预览的帧确认:host 收到才发下一帧(隧道上恒最多一帧在途)。
  // 不 ack 就不再发 —— 预览端卡住/关掉时画面自动停,不会把隧道灌满。
  | { t: 'browser:frameAck'; tabId: string; seq: number };

// Host → UI
export type HostMessage =
  | { t: 'rpc:res'; id: number; ok: true; result: unknown }
  | { t: 'rpc:res'; id: number; ok: false; error: string }
  | { t: 'pty:data'; sessionId: string; data: string; bytes: number }
  | { t: 'pty:exit'; sessionId: string; exitCode: number }
  | { t: 'pty:title'; sessionId: string; processName: string }
  | { t: 'session:event'; sessionId: string; event: SessionEvent }
  // 该订阅者被 exclusive attach 摘除(last-attach-wins 抢占 · M2 向后兼容追加)。
  // 旧客户端不识别此 t 值 → 按惯例忽略未知消息类型,零破坏。
  | { t: 'session:takenover'; sessionId: string }
  // 该订阅者落后超 desync 阈值被剔出增量流(M2 收尾评审 P2-1):renderer 收到即自动
  // mirror re-attach 全量重同步,不静默冻屏。旧客户端忽略未知 t,零破坏。
  | { t: 'session:desynced'; sessionId: string }
  | { t: 'fs:changed'; watchId: number }
  // 注册表变更后向全部客户端广播全量快照(非增量);收端按 id 协调本地视图态
  | { t: 'workspace:changed'; workspaces: WorkspaceEntry[] }
  // 云端浏览器预览帧(base64 JPEG)。只发给开了预览的客户端;收端必须回
  // browser:frameAck,否则不再有下一帧(背压见 ClientMessage 的注释)。
  | {
      t: 'browser:frame';
      tabId: string;
      seq: number;
      data: string;
      metadata: BrowserFrameMetadata;
    };
