import './Sidebar.css';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { useAppStore, tildify } from '../state/store';
import type { WorkspaceState } from '../state/store';
import { hostRegistry } from '../services/hostRegistry';
import type { HostClient } from '../services/hostClient';
import {
  startRemoteWorkspaceSync,
  stopRemoteWorkspaceSync,
} from '../services/remoteWorkspaceSync';
import { reconnectController } from '../services/reconnectWiring';
import { scheduleDropUnlessReconnecting } from '../services/reconnectController';
import { useRemoteHostRuntimeStore } from '../state/remoteHostStore';
import type { RemoteHostConfig } from '../../shared/remoteHost';
import { ProtocolIncompatibleError } from '../../shared/versionCompat';
import { WorkspaceEditModal } from './WorkspaceEditModal';
import { NotificationCenter } from './NotificationCenter';
import { SettingsEntry } from './SettingsEntry';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { RemoteHostsPage } from './settings/RemoteHostsPage';
import {
  LocalMachineIcon,
  MachineChevron,
  MachineGroup,
  aggregateBadge,
  type MachineInfo,
} from './MachineGroup';
import {
  PencilIcon,
  SessionBadge,
  type MachineWorkspaceRowData,
} from './MachineWorkspaceRow';

/** 断线两段式回落(D-8/AC-11)的 panel 阶段时长:UI 先亮断线态,再确定性折叠组头。 */
const DISCONNECT_PANEL_MS = 900;

/** 远程机配置列表轮询间隔(E4):remoteHost:save/delete 是纯 request-response IPC,main 不推
 *  「配置列表已变」广播事件——Sidebar 常驻挂载,若只在挂载时拉一次,会话中在「远程机」管理页
 *  新增/删除远程机后 Sidebar 分组不会更新(新机不出现·已删机组残留)。轻量轮询兜底,不新增
 *  IPC 通道(main/preload 改动不在本 Feature write scope 内)。 */
const REMOTE_CONFIG_POLL_MS = 5000;

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

  useEffect(() => window.okwork.onUpdateEvent(setEv), []);

  if (!ev) return null;
  // 真实下载进度(主进程流式下载广播);无 Content-Length 时退回脉冲动画
  const percent = ev.state === 'downloading' ? ev.percent : undefined;
  const label =
    ev.state === 'available'
      ? t('⬆ New version v{version} available — download, then confirm to install', {
          version: ev.version ?? '',
        })
      : ev.state === 'checking'
        ? t('Connecting to update source…')
        : ev.state === 'confirming'
          ? t('Waiting to confirm install…')
        : ev.state === 'downloading'
          ? percent != null
            ? t('Downloading {percent}% (confirm to install when done)', { percent })
            : t('Downloading… (confirm to install when done)')
          : ev.state === 'restarting'
            ? t('Restarting to finish the update…')
            : t('Auto-update failed — opened the release page');

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
      onClick={() => window.okwork.installUpdate()}
      title={t('Download the new version, then confirm to install and restart')}
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
    attention: ws.tabs.filter((t) => t.waiting || t.unseenDone).length,
    disconnectedPanel,
  };
}

export function Sidebar() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const moveWorkspace = useAppStore((s) => s.moveWorkspace);
  const notifications = useAppStore((s) => s.notifications);
  const collapsedMachines = useAppStore((s) => s.collapsedMachines);
  const toggleMachineCollapsed = useAppStore((s) => s.toggleMachineCollapsed);

  const runtimeMap = useRemoteHostRuntimeStore((s) => s.runtime);
  const reconnectingMap = useRemoteHostRuntimeStore((s) => s.reconnecting);
  const applyRuntimeEvent = useRemoteHostRuntimeStore((s) => s.applyEvent);
  const rttMap = useRemoteHostRuntimeStore((s) => s.rtt);
  const setRtt = useRemoteHostRuntimeStore((s) => s.setRtt);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  // Modal state: null = closed, string = workspace id being edited
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ncOpen, setNcOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  // 「机器组空态添加项目」入口:预选该机直达目录浏览器(undefined = 常规从选机开始)
  const [addModalHost, setAddModalHost] = useState<string | undefined>(undefined);
  // 远程机组头齿轮 → 「远程机」配置弹层(与 SettingsEntry 菜单入口同一组件,可编辑/删除远程机)
  const [remoteHostsOpen, setRemoteHostsOpen] = useState(false);
  // 弹层关闭后焦点归还(对齐 SettingsEntry 的 AC-6 归还机制)
  const remoteHostsPrevFocusRef = useRef<HTMLElement | null>(null);
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
      const list = await window.okwork.remoteHost.list();
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
      // review V1(perf):list 内容等值则不 setState(避免每 5s 轮询无条件新引用触发整个 Sidebar 重渲)。
      setRemoteConfigs((prev) =>
        prev.length === list.length &&
        prev.every((c, i) =>
          c.id === list[i].id && c.alias === list[i].alias &&
          c.host === list[i].host && c.port === list[i].port,
        )
          ? prev
          : list,
      );
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
      // 🔴 硬门④ call site:改调 reconnect(单一 owner)而非 connect——重连时 main re-emit
      // verifying{tunnel},若走 connect() 命中陈旧 connectPromise → 新 ws 不开、假 ready 污染 UI。
      // reconnect() 复位 connectPromise 后开新 ws;初次连接 connectPromise=null 时复位是 no-op 等价 connect。
      client
        .reconnect({ wsUrl })
        .then(async () => {
          try {
            await client.rpc('fs.readdir', { path: client.info?.homedir ?? '/' });
          } catch {
            // 冒烟失败不阻断 ready —— 握手(host.info + 版本兼容)已是核心判据
          }
          applyRuntimeEvent({ configId, stage: 'ready' });
          // 🔴 A1(review-fix):readopt 收养由 reconnect promise resolution 驱动(ws 真 open·transport
          // 已就绪)——而非 main 的 'ready' stage 事件(那会在 ws 打开前触发 session.attach → reject →
          // 收养静默中止 → 终端冻结)。初次连接 wasReconnecting=false·onReconnected 内为廉价 no-op。
          reconnectController.onReconnected(configId);
        })
        .catch((err: unknown) => {
          applyRuntimeEvent({
            configId,
            stage: 'failed',
            reason: err instanceof ProtocolIncompatibleError ? 'incompatible' : 'internal',
            detail: err instanceof Error ? err.message : String(err),
          });
          // 🔴 A2(review-fix):握手失败(ws 打不开 / 不兼容)→ 推进退避重试;超预算 → 确定断线 drop。
          // 非 reconnecting(初次连接失败)时 onAttemptFailed 内守卫使其 no-op。
          reconnectController.onAttemptFailed(configId);
        })
        .finally(() => {
          handshakingRef.current.delete(configId);
        });
    }

    return window.okwork.remoteHost.onEvent((e) => {
      applyRuntimeEvent(e);
      if (e.stage === 'verifying' && e.tunnel) {
        beginHandshake(e.configId, e.tunnel);
      } else if (
        e.stage === 'failed' &&
        useRemoteHostRuntimeStore.getState().isReconnecting(e.configId)
      ) {
        // 🔴 A2(review-fix):重连期 main emit 'failed'(隧道重建失败:ssh 抛/token 拒/不可达)→
        // 推进退避重试或超预算 drop。守卫到 isReconnecting——初次连接失败不误入重连状态机。
        reconnectController.onAttemptFailed(e.configId);
      }
    });
  }, [applyRuntimeEvent]);

  // 观测到某 configId ready → 该机 workspace 发现编排(TECH §远程 workspace 发现 · E5 会话订阅
  // 同生命周期)。与「谁完成了握手」解耦——不论是本组件的 beginHandshake 还是 RemoteHostsPage
  // 完成的握手,只要 runtime 落到 ready 就触发一次,重入由 remoteWorkspaceSync 内部去重。
  const syncedHosts = useRef<Set<string>>(new Set());
  // 🔴 重连/RTT 接线按 **client 实例**键控(WeakSet),不按 configId:用户手动断开会
  // hostRegistry.drop(dispose + 删除实例),重新连接时 getOrCreateRemote 造**新实例**——
  // 若按 configId 记「已接线」,新实例永远接不上 onReconnectNeeded/onRtt(掉线不再自动重连)。
  // 旧实例已从 registry 摘除,随 GC 释放,WeakSet 不延长其生命周期。
  const reconnectWired = useRef<WeakSet<HostClient>>(new WeakSet());
  const rttWired = useRef<WeakSet<HostClient>>(new WeakSet());
  useEffect(() => {
    for (const [configId, evt] of Object.entries(runtimeMap)) {
      if (evt.stage === 'ready') {
        if (!syncedHosts.current.has(configId)) {
          syncedHosts.current.add(configId);
          void startRemoteWorkspaceSync(configId, '');
        }
        // 🔴 A1(review-fix):收养回放**不再**在此(main 'ready' stage 事件)驱动——它会在新 ws 打开前
        // 触发 session.attach → reject → 收养静默中止 → 终端冻结。改由 beginHandshake 的
        // `client.reconnect().then`(ws 真 open 后)调 reconnectController.onReconnected。此处仅保留与
        // 「谁完成握手」解耦的 workspace 发现 + onReconnectNeeded 订阅。
        // 订该 client 的「需要重连」信号(心跳判死 / transport close·每实例仅订一次)→ 启动重连编排
        const client = hostRegistry.forHostId(configId);
        if (client && !reconnectWired.current.has(client)) {
          client.onReconnectNeeded?.(() =>
            reconnectController.onDisconnected(configId),
          );
          reconnectWired.current.add(client);
        }
        // 订该 client 的心跳 RTT(每实例仅订一次;实例跨瞬时重连复用,手动断开后是新实例)
        // → 组头连接延迟展示。心跳首拍在 interval(5s)后才有值:接线时立即种一发,连上即见延迟。
        if (client?.onRtt && !rttWired.current.has(client)) {
          rttWired.current.add(client);
          client.onRtt((ms) => setRtt(configId, ms));
          const t0 = Date.now();
          void client.rpc('host.info', undefined).then(
            () => setRtt(configId, Date.now() - t0),
            () => undefined,
          );
        }
      } else {
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
        delete panelTimers.current[configId];
        // 🔴 CR-1 ② / Q1(review-fix):把 900ms drop gate **收敛到被测 seam** scheduleDropUnlessReconnecting
        // ——reconnecting 期返 null(不启动 drop 倒计时·抑制 AC-15 full drop);非 reconnecting(确定断线/
        // 机器删除)才排 900ms 折叠(不回归 BL-004)。生产路径由此走 T-030/031 断言的同一函数:删掉其
        // 内 isReconnecting gate 测即变红。folded 阶段 stopSync = 清 panel 展示态 + stopRemoteWorkspaceSync
        // (退订 + 清 store 该 host 全部 workspace + drop client·E-4/D-8 三步)。
        const handle = scheduleDropUnlessReconnecting(configId, {
          isReconnecting: (id) =>
            useRemoteHostRuntimeStore.getState().isReconnecting(id),
          stopSync: (id) => {
            setPanelHosts((s) => {
              if (!s[id]) return s;
              const next = { ...s };
              delete next[id];
              return next;
            });
            stopRemoteWorkspaceSync(id);
          },
          delayMs: DISCONNECT_PANEL_MS,
        });
        if (handle) panelTimers.current[configId] = handle;
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

  // 🔴 A5(review-fix·CR-1 gate 真闭合):某 host 进入 reconnecting 的一刻,主动清掉可能已排上的 900ms
  // drop 计时器。修的是「main 的 disconnected 先于 renderer 心跳判死到达」竞态——那时 isReconnecting 仍
  // false·上面的 gate 会放行排上 drop 计时器·若随后的 connecting 事件因任何原因晚于 900ms 就会漏 drop
  // 击穿 AC-15。reconnecting 置真后 drop 的唯一出口就是 reconnectController 超预算分支,故此处清 timer 安全。
  useEffect(() => {
    for (const [configId, on] of Object.entries(reconnectingMap)) {
      if (on && panelTimers.current[configId] !== undefined) {
        clearTimeout(panelTimers.current[configId]);
        delete panelTimers.current[configId];
      }
    }
  }, [reconnectingMap]);

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

  function confirmRemove(id: string, name: string) {
    if (
      window.confirm(
        t('Remove workspace "{name}"? Terminal sessions will be closed.', { name }),
      )
    ) {
      void removeWorkspace(id);
    }
  }

  function handleRemove(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    confirmRemove(id, name);
  }

  function openEditModal(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setEditingId(id);
  }

  function handleModalClose() {
    setEditingId(null);
  }

  function handleConnectMachine(id: string) {
    window.okwork.remoteHost.connect({ id });
  }

  function openRemoteHostsModal() {
    remoteHostsPrevFocusRef.current = document.activeElement as HTMLElement | null;
    setRemoteHostsOpen(true);
  }

  function closeRemoteHostsModal() {
    setRemoteHostsOpen(false);
    remoteHostsPrevFocusRef.current?.focus();
    remoteHostsPrevFocusRef.current = null;
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

  // Find the workspace being edited (for the modal's initial name/profile)
  const editingWorkspace = editingId
    ? workspaces.find((w) => w.id === editingId) ?? null
    : null;

  const localWorkspaces = workspaces.filter((w) => w.hostId === 'local');

  const localMachine: MachineInfo = {
    id: 'local',
    kind: 'local',
    label: t('Local'),
    workspaces: localWorkspaces.map((w) => toRowData(w, activeWorkspaceId, false)),
  };

  const remoteMachines: MachineInfo[] = remoteConfigs.map((cfg) => {
    const runtime = runtimeMap[cfg.id];
    const inPanel = !!panelHosts[cfg.id];
    const wsForHost = workspaces.filter((w) => w.hostId === cfg.id);
    const addr = `${cfg.username}@${cfg.host}`;

    // BL-005 · AC-15:瞬时断线·重连中——保活该机 workspace 可见(不折叠·不消失),组头琥珀脉冲。
    // reconnecting 是 store 单源标志(reconnectController 先占),优先于 runtime.stage 的 disconnected 呈现。
    if (reconnectingMap[cfg.id]) {
      return {
        id: cfg.id,
        kind: 'remote',
        alias: cfg.alias,
        addr,
        status: 'reconnecting',
        workspaces: wsForHost.map((w) => toRowData(w, activeWorkspaceId, false)),
      };
    }

    if (runtime?.stage === 'ready') {
      return {
        id: cfg.id,
        kind: 'remote',
        alias: cfg.alias,
        addr,
        status: 'connected',
        rttMs: rttMap[cfg.id],
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
        emptyLabel: t('Disconnected · Click to reconnect'),
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
          title={t('Notifications')}
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
          title={t('Add Workspace')}
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
                <div
                  className="sidebar-machine-header sidebar-machine-header--clickable"
                  onClick={() => toggleMachineCollapsed('local')}
                >
                  <MachineChevron collapsed={collapsedMachines.includes('local')} />
                  <LocalMachineIcon />
                  <span className="sidebar-machine-label">{machine.label}</span>
                  {/* 折叠态兜底可见性:聚合会话徽标 + 全组注意力小丸 */}
                  {collapsedMachines.includes('local') && (
                    <>
                      <SessionBadge ws={aggregateBadge(machine.workspaces)} />
                      {(() => {
                        const attention = localWorkspaces.reduce(
                          (n, w) =>
                            n + w.tabs.filter((tab) => tab.waiting || tab.unseenDone).length,
                          0,
                        );
                        return attention > 0 ? (
                          <span className="sidebar-attention-pill sidebar-attention-pill--inline">
                            {attention}
                          </span>
                        ) : null;
                      })()}
                    </>
                  )}
                </div>
                {!collapsedMachines.includes('local') &&
                machine.workspaces.map((row, idx) => {
                  const ws = localWorkspaces[idx];
                  const isDragging = ws.id === draggingId;
                  return (
                    <div
                      key={ws.id}
                      draggable
                      className={`sidebar-item sidebar-item--removable${row.active ? ' sidebar-item--active' : ''}${isDragging ? ' sidebar-item--dragging' : ''}`}
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
                          onClick={(e) => openEditModal(e, ws.id)}
                          title={t('Edit workspace')}
                        >
                          <PencilIcon />
                        </button>
                        <SessionBadge ws={row} />
                      </div>
                      <span className="sidebar-item-meta">{row.meta}</span>
                      <button
                        className="sidebar-remove-btn"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        onClick={(e) => handleRemove(e, ws.id, ws.name)}
                        title={t('Remove workspace')}
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
                <span className="sidebar-empty-text">{t('No workspaces')}</span>
                <button className="sidebar-add-ws-btn" onClick={handleAdd}>
                  {t('Add Workspace')}
                </button>
              </div>
            )
          ) : (
            <MachineGroup
              key={machine.id}
              machine={machine}
              collapsed={collapsedMachines.includes(machine.id)}
              onToggleCollapse={toggleMachineCollapsed}
              onConnect={handleConnectMachine}
              onRetry={handleConnectMachine}
              onManualRetry={(id) => reconnectController.manualRetry(id)}
              onSelectWorkspace={handleSelectWorkspace}
              onRemoveWorkspace={(_m, ws) => confirmRemove(ws.id, ws.name)}
              onRenameWorkspace={(_m, ws) => setEditingId(ws.id)}
              onAddWorkspace={(id) => {
                setAddModalHost(id);
                setAddModalOpen(true);
              }}
              onOpenSettings={openRemoteHostsModal}
            />
          ),
        )}
      </div>

      {/* 左下角:升级提示 + 用户信息入口(含 DEV 徽标) */}
      <div className="sidebar-footer">
        <UpdatePill />
        <SettingsEntry devChannel={window.okwork.devChannel} />
      </div>

      {/* 工作区编辑弹层(改名 + 浏览器 profile)— 渲染在 sidebar 根节点 */}
      {editingWorkspace && (
        <WorkspaceEditModal workspace={editingWorkspace} onClose={handleModalClose} />
      )}

      {/* 远程机配置弹层(组头齿轮入口):编辑/删除远程机;删除后 E4 轮询清残留分组 */}
      {remoteHostsOpen && <RemoteHostsPage onClose={closeRemoteHostsModal} />}

      {/* 添加项目 modal(D-4/AC-3/AC-4):选机器(本机置顶+已连接远程机)→ 本机对话框 / 远程目录浏览器 */}
      {addModalOpen && (
        <AddWorkspaceModal
          initialHostId={addModalHost}
          onClose={() => {
            setAddModalOpen(false);
            setAddModalHost(undefined);
          }}
        />
      )}
    </aside>
  );
}
