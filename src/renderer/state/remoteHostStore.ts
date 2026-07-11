// 远程机连接运行态(main → renderer 事件驱动 · 不持久化):configId → 最近一次 RemoteEvent。
// 刻意独立于 state/store.ts(BL-003 write scope 隔离,避免与并行 Feature 改动冲突);
// BL-004 前瞻:Sidebar 可直接订阅同一份 useRemoteHostRuntimeStore,无需重构本切片。
//
// 订阅时机:由消费方(当前 = RemoteHostsPage)在挂载时调 window.termpro.remoteHost.onEvent(applyEvent),
// 卸载时退订。不做模块级自动订阅——window.termpro 桥在测试/构建时机不定,模块顶层订阅会绑死
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
}

export const useRemoteHostRuntimeStore = create<RemoteHostRuntimeState>((set, get) => ({
  runtime: {},
  reconnecting: {},
  rtt: {},
  applyEvent(e) {
    set((s) => ({ runtime: { ...s.runtime, [e.configId]: e } }));
  },
  clear(configId) {
    set((s) => {
      const hasRuntime = configId in s.runtime;
      const hasReconnecting = configId in s.reconnecting;
      const hasRtt = configId in s.rtt;
      if (!hasRuntime && !hasReconnecting && !hasRtt) return s;
      const runtime = { ...s.runtime };
      delete runtime[configId];
      const reconnecting = { ...s.reconnecting };
      delete reconnecting[configId];
      const rtt = { ...s.rtt };
      delete rtt[configId];
      return { runtime, reconnecting, rtt };
    });
  },
  setRtt(configId, ms) {
    set((s) => ({ rtt: { ...s.rtt, [configId]: ms } }));
  },
  setReconnecting(configId, on) {
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
}));
