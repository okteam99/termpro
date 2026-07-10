import './Sidebar.css';
import { useEffect, useRef, useState } from 'react';
import { useAppStore, tildify } from '../state/store';
import type { WorkspaceState } from '../state/store';
import { hostRegistry } from '../services/hostRegistry';
import {
  startRemoteWorkspaceSync,
  stopRemoteWorkspaceSync,
} from '../services/remoteWorkspaceSync';
import { useRemoteHostRuntimeStore } from '../state/remoteHostStore';
import type { RemoteHostConfig } from '../../shared/remoteHost';
import { ProtocolIncompatibleError } from '../../shared/versionCompat';
import { RenameModal } from './RenameModal';
import { NotificationCenter } from './NotificationCenter';
import { SettingsEntry } from './SettingsEntry';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { MachineGroup, type MachineInfo } from './MachineGroup';
import type { MachineWorkspaceRowData } from './MachineWorkspaceRow';

/** 断线两段式回落(D-8/AC-11)的 panel 阶段时长:UI 先亮断线态,再确定性折叠组头。 */
const DISCONNECT_PANEL_MS = 900;

/** 远程机配置列表轮询间隔(E4):remoteHost:save/delete 是纯 request-response IPC,main 不推
 *  「配置列表已变」广播事件——Sidebar 常驻挂载,若只在挂载时拉一次,会话中在「远程机」管理页
 *  新增/删除远程机后 Sidebar 分组不会更新(新机不出现·已删机组残留)。轻量轮询兜底,不新增
 *  IPC 通道(main/preload 改动不在本 Feature write scope 内)。 */
const REMOTE_CONFIG_POLL_MS = 5000;

/** Small pencil icon 12×12 */
function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8.5 1.5 L10.5 3.5 L4 10 L1.5 10.5 L2 8 Z" />
      <line x1="7" y1="3" x2="9" y2="5" />
    </svg>
  );
}

/** Bell icon 13×13 */
function BellIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Bell body */}
      <path d="M6.5 1.5 C4.567 1.5 3 3.067 3 5 L3 8 L2 9 L11 9 L10 8 L10 5 C10 3.067 8.433 1.5 6.5 1.5 Z" />
      {/* Clapper */}
      <path d="M5.5 9.5 C5.5 10.328 5.948 11 6.5 11 C7.052 11 7.5 10.328 7.5 9.5" />
    </svg>
  );
}

/** 左下角升级胶囊:有新 Release 时出现,点击下载并升级 */
function UpdatePill() {
  const [ev, setEv] = useState<{
    state:
      | 'available'
      | 'checking'
      | 'downloading'
      | 'confirming'
      | 'restarting'
      | 'error';
    version?: string;
    percent?: number;
  } | null>(null);

  useEffect(() => window.termpro.onUpdateEvent(setEv), []);

  if (!ev) return null;
  // 真实下载进度(主进程流式下载广播);无 Content-Length 时退回脉冲动画
  const percent = ev.state === 'downloading' ? ev.percent : undefined;
  const label =
    ev.state === 'available'
      ? `⬆ 新版本 v${ev.version} — 下载后确认安装`
      : ev.state === 'checking'
        ? '正在连接更新源…'
        : ev.state === 'confirming'
          ? '等待确认安装…'
        : ev.state === 'downloading'
          ? percent != null
            ? `下载中 ${percent}%(完成后确认安装)`
            : '下载中(完成后确认安装)…'
          : ev.state === 'restarting'
            ? '即将重启完成升级…'
            : '自动升级失败,已打开发布页';

  const progressStyle: React.CSSProperties =
    percent != null
      ? {
          background: `linear-gradient(90deg, var(--accent) ${percent}%, var(--bg-active) ${percent}%)`,
          color: '#fff',
        }
      : {};

  return (
    <button
      className={`sidebar-update-pill sidebar-update-pill--${ev.state}${
        ev.state === 'downloading' && percent == null
          ? ' sidebar-update-pill--indeterminate'
          : ''
      }`}
      style={
        {
          WebkitAppRegion: 'no-drag',
          ...progressStyle,
        } as React.CSSProperties
      }
      disabled={
        ev.state === 'checking' ||
        ev.state === 'downloading' ||
        ev.state === 'confirming' ||
        ev.state === 'restarting'
      }
      onClick={() => window.termpro.installUpdate()}
      title="下载新版本，完成后确认安装并重启"
    >
      {label}
    </button>
  );
}

/** ws → MachineWorkspaceRow 的展示态(per-host homedir tildify + 会话徽标源 = 本客户端 tabs)。 */
function toRowData(
  ws: WorkspaceState,
  activeWorkspaceId: string | null,
  disconnectedPanel: boolean,
): MachineWorkspaceRowData {
  const homedir = hostRegistry.forWorkspace(ws).info?.homedir ?? undefined;
  const tildified = tildify(ws.root, homedir);
  const meta = ws.branch ? `⎇ ${ws.branch} · ${tildified}` : tildified;
  const tabRunning = ws.tabs.filter((t) => t.activity === 'running').length;
  return {
    id: ws.id,
    name: ws.name,
    meta,
    active: ws.id === activeWorkspaceId,
    tabCount: ws.tabs.length,
    tabRunning,
    disconnectedPanel,
  };
}

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const moveWorkspace = useAppStore((s) => s.moveWorkspace);
  const notifications = useAppStore((s) => s.notifications);

  const runtimeMap = useRemoteHostRuntimeStore((s) => s.runtime);
  const applyRuntimeEvent = useRemoteHostRuntimeStore((s) => s.applyEvent);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  // Modal state: null = closed, string = workspace id being renamed
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ncOpen, setNcOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Track the id of the workspace currently being dragged (本机组内拖拽排序)
  const draggingWsId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [remoteConfigs, setRemoteConfigs] = useState<RemoteHostConfig[]>([]);

  // 🔴 E4 修复:轮询而非一次性拉取——「远程机」管理页新增/删除配置不会推事件到 Sidebar,
  // 只挂载时拉一次会导致会话中新机不出现、已删机组残留(其 sync/runtime 也不会被清)。
  useEffect(() => {
    let alive = true;
    const knownIds = new Set<string>();

    async function refresh() {
      const list = await window.termpro.remoteHost.list();
      if (!alive) return;
      const nextIds = new Set(list.map((c) => c.id));
      // 配置已从列表消失(被删除)→ 清理该机残留 sync 订阅 + runtime 展示态 + client(防已删
      // 机器组常驻 Sidebar、其 remoteWorkspaceSync 悬挂订阅不退)。
      for (const id of knownIds) {
        if (!nextIds.has(id)) {
          stopRemoteWorkspaceSync(id);
          useRemoteHostRuntimeStore.getState().clear(id);
        }
      }
      knownIds.clear();
      nextIds.forEach((id) => knownIds.add(id));
      setRemoteConfigs(list);
    }

    void refresh();
    const timer = setInterval(() => void refresh(), REMOTE_CONFIG_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Sidebar 常驻挂载(不像 RemoteHostsPage 弹层那样按需挂卸)。组头「连接」入口(AC-8)不能只
  // 依赖「远程机」管理页恰好同时开着才走得通握手——本效果独立转发 main 的连接生命周期事件到
  // runtime store,并在 verifying{tunnel} 时完成同一套握手编排(镜像 RemoteHostsPage.tsx 的
  // beginHandshake 核心路径:connect(wsUrl)→ 冒烟 → 本地合成 ready 态,main 侧协议本身不推
  // 'ready',由 renderer 握手成功后写入)。
  // 🔴 与 RemoteHostsPage 重合挂载时不会重复连接:hostRegistry.getOrCreateRemote 对已存在的
  // client 直接返回同一实例,HostClient.connect() 内部靠 connectPromise 缓存去重(两处调用
  // 落在同一个 promise 上)。本效果不复制 RemoteHostsPage 的 E6"断开在途"过滤——Sidebar 无独立
  // 「断开」入口,该竞态只在用户同时打开 RemoteHostsPage 手动断开时才可能出现;若后续复用面扩大,
  // 建议把握手编排整体收敛进 remoteWorkspaceSync.ts 单源消解本处重复。
  const handshakingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    function beginHandshake(configId: string, tunnel: { localPort: number; token: string }) {
      if (handshakingRef.current.has(configId)) return;
      handshakingRef.current.add(configId);
      const wsUrl = `ws://127.0.0.1:${tunnel.localPort}?token=${encodeURIComponent(tunnel.token)}`;
      const client = hostRegistry.getOrCreateRemote(configId, wsUrl);
      client
        .connect({ wsUrl })
        .then(async () => {
          try {
            await client.rpc('fs.readdir', { path: client.info?.homedir ?? '/' });
          } catch {
            // 冒烟失败不阻断 ready —— 握手(host.info + 版本兼容)已是核心判据
          }
          applyRuntimeEvent({ configId, stage: 'ready' });
        })
        .catch((err: unknown) => {
          applyRuntimeEvent({
            configId,
            stage: 'failed',
            reason: err instanceof ProtocolIncompatibleError ? 'incompatible' : 'internal',
            detail: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          handshakingRef.current.delete(configId);
        });
    }

    return window.termpro.remoteHost.onEvent((e) => {
      applyRuntimeEvent(e);
      if (e.stage === 'verifying' && e.tunnel) beginHandshake(e.configId, e.tunnel);
    });
  }, [applyRuntimeEvent]);

  // 观测到某 configId ready → 该机 workspace 发现编排(TECH §远程 workspace 发现 · E5 会话订阅
  // 同生命周期)。与「谁完成了握手」解耦——不论是本组件的 beginHandshake 还是 RemoteHostsPage
  // 完成的握手,只要 runtime 落到 ready 就触发一次,重入由 remoteWorkspaceSync 内部去重。
  const syncedHosts = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [configId, evt] of Object.entries(runtimeMap)) {
      if (evt.stage === 'ready' && !syncedHosts.current.has(configId)) {
        syncedHosts.current.add(configId);
        void startRemoteWorkspaceSync(configId, '');
      } else if (evt.stage !== 'ready') {
        syncedHosts.current.delete(configId);
      }
    }
  }, [runtimeMap]);

  // 断线两段式回落(D-8/AC-11):panel 阶段(0-900ms,红点 + 该机活跃 ws 行内"已断开"标签,
  // 期间锁定其它 workspace 行点击)→ folded 阶段(组头折叠回未连接态外观,仍标"已断开"区别于
  // 从未连接的灰态)。纯 UI 呈现节奏,不依赖 store 是否已 dropHostWorkspaces(该 action 落地前后
  // 折叠时序均正确——workspaces:null 由本组件直接计算,不取决于 store 数组内容)。
  const [panelHosts, setPanelHosts] = useState<Record<string, boolean>>({});
  const panelTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const prevStages = useRef<Record<string, string | undefined>>({});

  useEffect(() => {
    for (const [configId, evt] of Object.entries(runtimeMap)) {
      const prev = prevStages.current[configId];
      if (evt.stage === 'disconnected' && prev !== 'disconnected') {
        setPanelHosts((s) => ({ ...s, [configId]: true }));
        clearTimeout(panelTimers.current[configId]);
        panelTimers.current[configId] = setTimeout(() => {
          setPanelHosts((s) => {
            if (!s[configId]) return s;
            const next = { ...s };
            delete next[configId];
            return next;
          });
          // folded 阶段:退订该机订阅 + 清 store 该 host 全部 workspace(含 active 回落本机首个)
          // + drop client(E-4/D-8 三步同一原子操作)
          stopRemoteWorkspaceSync(configId);
        }, DISCONNECT_PANEL_MS);
      } else if (evt.stage !== 'disconnected' && prev === 'disconnected') {
        clearTimeout(panelTimers.current[configId]);
        setPanelHosts((s) => {
          if (!s[configId]) return s;
          const next = { ...s };
          delete next[configId];
          return next;
        });
      }
      prevStages.current[configId] = evt.stage;
    }
  }, [runtimeMap]);

  useEffect(
    () => () => {
      Object.values(panelTimers.current).forEach(clearTimeout);
    },
    [],
  );

  // panel 阶段内点击其它 workspace 行不响应(等待确定性回落完成,防止用户在瞬间半路打断)
  const selectionLocked = Object.values(panelHosts).some(Boolean);

  function handleAdd() {
    setAddModalOpen(true);
  }

  function handleRemove(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    if (window.confirm(`Remove workspace "${name}"? Terminal sessions will be closed.`)) {
      void removeWorkspace(id);
    }
  }

  function openRenameModal(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setEditingId(id);
  }

  function handleModalSave(id: string, name: string) {
    void renameWorkspace(id, name);
  }

  function handleModalClose() {
    setEditingId(null);
  }

  function handleConnectMachine(id: string) {
    window.termpro.remoteHost.connect({ id });
  }

  function handleSelectWorkspace(_machine: MachineInfo, ws: MachineWorkspaceRowData) {
    if (selectionLocked) return;
    setActiveWorkspace(ws.id);
  }

  // --- Drag handlers(仅本机组内重排;远程组无拖拽,与设计一致)---

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, wsId: string) {
    draggingWsId.current = wsId;
    setDraggingId(wsId);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox compat
    e.dataTransfer.setData('text/plain', wsId);
  }

  function handleDragEnd() {
    draggingWsId.current = null;
    setDraggingId(null);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, targetWsId: string) {
    e.preventDefault();
    const srcId = draggingWsId.current;
    if (!srcId || srcId === targetWsId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const before = e.clientY < midY;

    // 🔴 E1 修复:必须用全量 workspaces 数组下标(moveWorkspace 的 toIndex 语义 = 全量数组
    // splice 下标),不能用本机子集(localWorkspaces)渲染下标直接当全量下标——当本机 ws 在
    // 全量数组里不连续时(例如远程机已连接、随后新建本机项目 append 到远程 ws 之后)子集下标
    // ≠全量下标,会把本机项目拖到错误的全局位置(甚至越过远程组的项目)。
    const srcIndex = workspaces.findIndex((w) => w.id === srcId);
    const targetIndex = workspaces.findIndex((w) => w.id === targetWsId);
    if (srcIndex < 0 || targetIndex < 0) return;

    const insertIndex = before ? targetIndex : targetIndex + 1;
    let dest = insertIndex;
    if (srcIndex < insertIndex) dest = insertIndex - 1;
    if (dest === srcIndex) return;

    moveWorkspace(srcId, dest < 0 ? 0 : dest);
  }

  // Find the workspace being renamed (for the modal's initial name)
  const editingWorkspace = editingId
    ? workspaces.find((w) => w.id === editingId) ?? null
    : null;

  const localWorkspaces = workspaces.filter((w) => w.hostId === 'local');

  const localMachine: MachineInfo = {
    id: 'local',
    kind: 'local',
    label: '本机',
    workspaces: localWorkspaces.map((w) => toRowData(w, activeWorkspaceId, false)),
  };

  const remoteMachines: MachineInfo[] = remoteConfigs.map((cfg) => {
    const runtime = runtimeMap[cfg.id];
    const inPanel = !!panelHosts[cfg.id];
    const wsForHost = workspaces.filter((w) => w.hostId === cfg.id);
    const addr = `${cfg.username}@${cfg.host}`;

    if (runtime?.stage === 'ready') {
      return {
        id: cfg.id,
        kind: 'remote',
        alias: cfg.alias,
        addr,
        status: 'connected',
        workspaces: wsForHost.map((w) => toRowData(w, activeWorkspaceId, false)),
      };
    }

    if (runtime?.stage === 'disconnected') {
      if (inPanel) {
        return {
          id: cfg.id,
          kind: 'remote',
          alias: cfg.alias,
          addr,
          status: 'lost',
          foldedLost: false,
          workspaces: wsForHost.map((w) =>
            toRowData(w, activeWorkspaceId, w.id === activeWorkspaceId),
          ),
        };
      }
      return {
        id: cfg.id,
        kind: 'remote',
        alias: cfg.alias,
        addr,
        status: 'lost',
        foldedLost: true,
        emptyLabel: '已断开 · 点击重连',
        workspaces: null,
      };
    }

    // 未连接(从未连接过)或连接生命周期进行中/失败(AC-8 由 runtime 驱动组头呈现)
    return {
      id: cfg.id,
      kind: 'remote',
      alias: cfg.alias,
      addr,
      status: 'disconnected',
      runtime,
      workspaces: null,
    };
  });

  const machines = [localMachine, ...remoteMachines];

  return (
    <aside className="sidebar">
      {/* 顶部标题栏,留出 traffic light 空间 */}
      <div className="sidebar-header">
        {/* Bell notification button */}
        <button
          ref={bellRef}
          className="sidebar-bell-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setNcOpen((v) => !v)}
          title="通知"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className="sidebar-bell-badge">{badgeLabel}</span>
          )}
        </button>
        <button
          className="sidebar-add-btn"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleAdd}
          title="Add workspace"
        >
          +
        </button>
      </div>

      {/* Notification center dropdown — anchored to sidebar */}
      <NotificationCenter open={ncOpen} onClose={() => setNcOpen(false)} />

      {/* 机器分组列表(AC-1):本机组恒置顶恒显 · M 个远程机组(未连接=别名+连接入口不展开) */}
      <div className="sidebar-list">
        {machines.map((machine) =>
          machine.kind === 'local' ? (
            machine.workspaces && machine.workspaces.length > 0 ? (
              <div key={machine.id} className="sidebar-machine-group" data-testid="machine-group" data-machine-id="local">
                <div className="sidebar-machine-header">
                  <span className="sidebar-machine-label">{machine.label}</span>
                </div>
                {machine.workspaces.map((row, idx) => {
                  const ws = localWorkspaces[idx];
                  const isDragging = ws.id === draggingId;
                  return (
                    <div
                      key={ws.id}
                      draggable
                      className={`sidebar-item${row.active ? ' sidebar-item--active' : ''}${isDragging ? ' sidebar-item--dragging' : ''}`}
                      onClick={() => handleSelectWorkspace(machine, row)}
                      onDragStart={(e) => handleDragStart(e, ws.id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, ws.id)}
                    >
                      <div className="sidebar-item-name-row">
                        <span className="sidebar-item-name">{ws.name}</span>
                        <button
                          className="sidebar-edit-btn no-drag"
                          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                          onClick={(e) => openRenameModal(e, ws.id)}
                          title="Rename workspace"
                        >
                          <PencilIcon />
                        </button>
                      </div>
                      <span className="sidebar-item-meta">{row.meta}</span>
                      <button
                        className="sidebar-remove-btn"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        onClick={(e) => handleRemove(e, ws.id, ws.name)}
                        title="Remove workspace"
                      >
                        &times;
                      </button>
                      {(() => {
                        const attention = ws.tabs.filter((t) => t.waiting || t.unseenDone).length;
                        return attention > 0 ? (
                          <span className="sidebar-attention-pill">{attention}</span>
                        ) : null;
                      })()}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div key={machine.id} className="sidebar-empty" data-testid="machine-group" data-machine-id="local">
                <span className="sidebar-empty-text">No workspaces</span>
                <button className="sidebar-add-ws-btn" onClick={handleAdd}>
                  Add Workspace
                </button>
              </div>
            )
          ) : (
            <MachineGroup
              key={machine.id}
              machine={machine}
              onConnect={handleConnectMachine}
              onRetry={handleConnectMachine}
              onSelectWorkspace={handleSelectWorkspace}
            />
          ),
        )}
      </div>

      {/* 左下角:升级提示 + 用户信息入口(含 DEV 徽标) */}
      <div className="sidebar-footer">
        <UpdatePill />
        <SettingsEntry devChannel={window.termpro.devChannel} />
      </div>

      {/* Rename modal — rendered at sidebar root level */}
      {editingWorkspace && (
        <RenameModal
          title="重命名 Workspace"
          initialValue={editingWorkspace.name}
          onSave={(name) => handleModalSave(editingWorkspace.id, name)}
          onClose={handleModalClose}
        />
      )}

      {/* 添加项目 modal(D-4/AC-3/AC-4):选机器(本机置顶+已连接远程机)→ 本机对话框 / 远程目录浏览器 */}
      {addModalOpen && <AddWorkspaceModal onClose={() => setAddModalOpen(false)} />}
    </aside>
  );
}
