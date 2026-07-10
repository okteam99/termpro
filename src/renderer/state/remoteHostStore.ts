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
  /** 写入/覆盖某 configId 的运行态(main 推送事件 与 renderer 本地握手结果共用同一落点)。 */
  applyEvent(e: RemoteEvent): void;
  /** 清空某 configId 运行态(手动断开/删除后回落 idle,不留孤儿展示态)。 */
  clear(configId: string): void;
}

export const useRemoteHostRuntimeStore = create<RemoteHostRuntimeState>((set) => ({
  runtime: {},
  applyEvent(e) {
    set((s) => ({ runtime: { ...s.runtime, [e.configId]: e } }));
  },
  clear(configId) {
    set((s) => {
      if (!(configId in s.runtime)) return s;
      const next = { ...s.runtime };
      delete next[configId];
      return { runtime: next };
    });
  },
}));
