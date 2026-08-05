// 远程机连接运行态(main → renderer 事件驱动 · 不持久化):configId → 最近一次 RemoteEvent。
// 刻意独立于 state/store.ts(BL-003 write scope 隔离,避免与并行 Feature 改动冲突);
// BL-004 前瞻:Sidebar 可直接订阅同一份 useRemoteHostRuntimeStore,无需重构本切片。
//
// 订阅时机:由消费方(当前 = RemoteHostsPage)在挂载时调 window.okwork.remoteHost.onEvent(applyEvent),
// 卸载时退订。不做模块级自动订阅——window.okwork 桥在测试/构建时机不定,模块顶层订阅会绑死
// import 时刻的桥状态,不可测;交给组件生命周期管理更符合本仓已用惯例(如 hostClient 的 onDown)。

import { create } from 'zustand';
import type { RemoteEvent } from '../../shared/remoteHost';

interface RemoteHostRuntimeState {
  /** configId → 最近一次 RemoteEvent;无 key = 该机从未连接过(idle)。 */
  runtime: Record<string, RemoteEvent>;
  /**
   * BL-005(CR-1):configId → 是否正处于「瞬时断线·重连中」。reconnectController **同步先占**
   * 此态再走 disconnect-first(disconnect() 会自发广播 disconnected)。Sidebar 900ms drop 计时器
   * gate 到 `!isReconnecting(configId)`——reconnecting 期不启动 full-drop 倒计时(抑制 AC-15)。
   */
  reconnecting: Record<string, boolean>;
  /** configId → 最近一次心跳探活 RTT(ms;组头连接延迟展示,展示 gate 在 connected 态)。 */
  rtt: Record<string, number>;
  /** 写入/覆盖某 configId 的运行态(main 推送事件 与 renderer 本地握手结果共用同一落点)。 */
  applyEvent(e: RemoteEvent): void;
  /** 清空某 configId 运行态(手动断开/删除后回落 idle,不留孤儿展示态)。 */
  clear(configId: string): void;
  /** 写入某 configId 的最近 RTT(hostClient 心跳 onRtt 驱动)。 */
  setRtt(configId: string, ms: number): void;
  /** 置/清某 configId 的 reconnecting 态(reconnectController 单源驱动)。 */
  setReconnecting(configId: string, on: boolean): void;
  /** 查询某 configId 是否 reconnecting(Sidebar drop 计时器 gate·CR-1)。 */
  isReconnecting(configId: string): boolean;

  // ---- OKWORK-F260805033051:用户主动放弃(断开/取消)后的「弃用闸」 ----
  /**
   * configId → 用户已主动放弃这台机(点了断开/取消)。为真时本 store 拒绝一切**运行态写入**。
   *
   * 🔴 为什么需要:用户点断开后仍有多条通道会把状态写回来——main 推送的残余生命周期事件、
   * 取消时**已在途的那次握手的续体**(`.then` 写 ready / `.catch` 写 failed,是本地闭包)、
   * 以及从 ready/verifying 断开时 main 必发的迟到 `disconnected`。不挡住就会出现
   * 「界面已断开、后台却连上了」。
   *
   * 🔴 **本闸只是纵深防御的一层**:它挡「写状态」,挡不住订阅回调里的**副作用**
   * (残余 `verifying` 会调 `beginHandshake` 真去开 ws)。副作用必须在
   * `Sidebar.tsx` 的订阅首行 / `beginHandshake` 入口 / 握手续体 / `onReconnectNeeded`
   * 接线各自设闸。详见 TECH.md §架构「两道闸」。
   */
  abandoned: Record<string, true>;
  /** configId → 断开 IPC 在途。驱动连接钮的忙碌指示 + 连接点击的排队(AC-13)。 */
  settling: Record<string, true>;
  /**
   * 置弃用。
   * 🔴 **只允许在用户点击 handler 内调用**(侧栏/设置页的断开、取消)。
   * 🔴 **`reconnectController` 的 disconnect-first 绝不能走这里** —— 它的 `deps.disconnect`
   * 必须保持裸 IPC(`reconnectWiring.ts`),否则自动重连会给自己贴弃用标记、当场自锁死。
   */
  abandon(configId: string): void;
  /** 解除弃用(用户重新表达连接意图)。调用点有三个:侧栏连接 / 设置页连接 / 设置页升级。 */
  resume(configId: string): void;
  /** 查询(供非 React 上下文用:订阅回调 / 握手续体 / onReconnectNeeded 接线)。 */
  isAbandoned(configId: string): boolean;
  /** 置/清断开 IPC 在途。 */
  setSettling(configId: string, on: boolean): void;
  /** 销毁该 configId 的全部痕迹(含 abandoned)。🔴 **仅配置被删除时调**。 */
  forget(configId: string): void;
}

export const useRemoteHostRuntimeStore = create<RemoteHostRuntimeState>((set, get) => ({
  runtime: {},
  reconnecting: {},
  rtt: {},
  abandoned: {},
  settling: {},
  applyEvent(e) {
    if (get().abandoned[e.configId]) return; // 弃用闸①:残余事件 / 在途握手续体的写入一律丢弃
    set((s) => ({ runtime: { ...s.runtime, [e.configId]: e } }));
  },
  clear(configId) {
    set((s) => {
      const hasRuntime = configId in s.runtime;
      const hasReconnecting = configId in s.reconnecting;
      const hasRtt = configId in s.rtt;
      const hasSettling = configId in s.settling;
      if (!hasRuntime && !hasReconnecting && !hasRtt && !hasSettling) return s;
      const runtime = { ...s.runtime };
      delete runtime[configId];
      const reconnecting = { ...s.reconnecting };
      delete reconnecting[configId];
      const rtt = { ...s.rtt };
      delete rtt[configId];
      const settling = { ...s.settling };
      delete settling[configId];
      // 🔴 刻意**不清 abandoned**:它的生命周期由 abandon/resume/forget 显式管理。
      // 断开流程里 clear 紧跟在 abandon 之后,若在此顺手清掉,残余事件立刻就能写穿。
      return { runtime, reconnecting, rtt, settling };
    });
  },
  setRtt(configId, ms) {
    if (get().abandoned[configId]) return; // 弃用闸②:rtt 是独立写入点,不经 applyEvent
    set((s) => ({ rtt: { ...s.rtt, [configId]: ms } }));
  },
  setReconnecting(configId, on) {
    // 弃用闸③:reconnecting 也是独立写入点,且在组头派生里**优先级最高**
    // (Sidebar 的 reconnecting 分支排在 ready / disconnected 之前),被置真会当场
    // 让已断开的机器显示成「重连中」。
    // 🔴 **只挡置真、清假恒放行** —— 否则某机一旦被判弃用,谁都清不掉它的 reconnecting
    // 标记,会永久卡在「重连中」展示。
    if (on && get().abandoned[configId]) return;
    set((s) => {
      if (!!s.reconnecting[configId] === on) return s;
      const reconnecting = { ...s.reconnecting };
      if (on) reconnecting[configId] = true;
      else delete reconnecting[configId];
      return { reconnecting };
    });
  },
  isReconnecting(configId) {
    return !!get().reconnecting[configId];
  },
  abandon(configId) {
    set((s) => (s.abandoned[configId] ? s : { abandoned: { ...s.abandoned, [configId]: true } }));
  },
  resume(configId) {
    set((s) => {
      if (!s.abandoned[configId]) return s;
      const abandoned = { ...s.abandoned };
      delete abandoned[configId];
      return { abandoned };
    });
  },
  isAbandoned(configId) {
    return !!get().abandoned[configId];
  },
  setSettling(configId, on) {
    set((s) => {
      if (!!s.settling[configId] === on) return s;
      const settling = { ...s.settling };
      if (on) settling[configId] = true;
      else delete settling[configId];
      return { settling };
    });
  },
  forget(configId) {
    set((s) => {
      if (!s.abandoned[configId]) return s;
      const abandoned = { ...s.abandoned };
      delete abandoned[configId];
      return { abandoned };
    });
  },
}));
