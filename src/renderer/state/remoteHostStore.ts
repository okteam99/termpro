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
    // 🔴 REVIEW F2:握手去重槽必须随弃用一并作废。它原先只有 `.finally` 一个出口——
    // 若那条握手 promise 永不落定(ws 卡在 upgrade,见 hostClient 的 connectingWs),
    // 槽位就永久留着,之后**新隧道**的 beginHandshake 会被自己的去重挡在门外:
    // main 照常 emit ready(不依赖 renderer 握手)→ 组头绿灯而终端全哑。
    handshaking.delete(configId);
    // 🔴 REVIEW F1:用户改主意点了断开 → 撤销此前排队的连接意图(否则排到点还会发 IPC)。
    connectIntent.delete(configId);
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
  /**
   * 🔴 名副其实地销毁**全部**五张表的痕迹 —— 不只 `abandoned`。
   * 现有两个调用点都紧跟 `clear(id)`,只删 abandoned 也够用;但 JSDoc 与 TECH 数据结构表
   * 承诺的是「销毁全部痕迹」,谁哪天按字面单独调它,runtime/rtt/reconnecting/settling 会全部留下。
   * 让实现兑现契约,比让契约迁就实现安全。
   */
  forget(configId) {
    handshaking.delete(configId);
    connectIntent.delete(configId);
    pendingDisconnects.delete(configId);
    set((s) => {
      if (
        !(configId in s.abandoned) &&
        !(configId in s.runtime) &&
        !(configId in s.rtt) &&
        !(configId in s.reconnecting) &&
        !(configId in s.settling)
      ) {
        return s;
      }
      const abandoned = { ...s.abandoned };
      const runtime = { ...s.runtime };
      const rtt = { ...s.rtt };
      const reconnecting = { ...s.reconnecting };
      const settling = { ...s.settling };
      delete abandoned[configId];
      delete runtime[configId];
      delete rtt[configId];
      delete reconnecting[configId];
      delete settling[configId];
      return { abandoned, runtime, rtt, reconnecting, settling };
    });
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// machine 级连接编排的共享原语(REVIEW round 1 · F1/F2/F4/F5)
//
// 🔴 **为什么收在这里而不是各组件自己 useRef**:侧栏与设置页是**两个可同时挂载**的入口,
// 各持一份私有 ref 时,一个入口建立的不变式对另一个入口不存在——F4 就是这么来的
// (设置页不知道侧栏登记过 pendingDisconnect,直接发 IPC 撞上 main 的在途去重 →「点了没反应」)。
// TECH §简洁性自查 早就写过同一句话(当时说的是握手实现两份):「重复实现意味着每个新增的
// 不变式都要记得在两个地方各写一遍」。本轮 finding 是那句话的第二次应验,所以不逐点打补丁。
//
// 这三个容器**刻意不进 zustand state**:promise 不可序列化,且它们的变化不该触发重渲染
// (真正驱动 UI 的是 store 里的 `settling`)。
// ─────────────────────────────────────────────────────────────────────────────

/** configId → 断开 IPC 在途的那条 promise(连接排队等它收尾)。 */
const pendingDisconnects = new Map<string, Promise<unknown>>();
/** configId → 用户已表达但尚未兑现的连接意图(排队中)。 */
const connectIntent = new Set<string>();
/** configId → 握手在途(去重槽;`abandon`/`forget` 会作废它 —— F2)。 */
const handshaking = new Set<string>();

/** 排队等待断开收尾的上界:断开若卡住,连接意图最多压 8 秒就放行(TECH 🛡️ 兜底清单)。 */
export const DISCONNECT_QUEUE_TIMEOUT_MS = 8000;

/**
 * 登记一次「断开 IPC 在途」:置忙碌态 + 记 promise,结算时**只清自己这一条**。
 *
 * 🔴 REVIEW F5:守卫 `pendingDisconnects.get(id) === p` 必须同时护住 `settling` 的清除,
 * 不能只护住 map 的删除 —— 否则第二次断开在途时,前一次的 finally 会把忙碌指示提前抹掉。
 */
export function trackDisconnect(configId: string, p: Promise<unknown>): void {
  // 🔴 **存进表里的必须是已 catch 的那条链,不是裸 promise**(REVIEW NF-1)。
  // `requestConnect` 会 `Promise.race` 表里这条:裸 promise 一旦 reject,race 跟着 reject →
  // `.then` 里的 `fulfill()` 永不执行 → `connectIntent` 永久卡住一条(该机此后点连接全被
  // 「意图已存在」逻辑外的路径绕过)+ 一条未处理的 rejection。
  // 重构前的 Sidebar 存的正是 `.catch().finally()` **之后**的链,所以没这个问题 ——
  // 这是本轮把编排搬进 store 时把「存哪条」搞错了,属新引入,不是历史遗留。
  const settled: Promise<unknown> = p
    .catch((err: unknown) => {
      // REVIEW CR-4:此前两端都零日志。当前 orchestrator.disconnect 内部各 await 都有
      // .catch 包裹、基本不会真 reject,但静默吞掉意味着日后重构把它变成会 reject 时无迹可循。
      console.warn(`[remoteHost] disconnectAwait rejected for ${configId}:`, err);
    })
    .finally(() => {
      // 已被更晚的一次断开取代 → 不动它的态(REVIEW F5:这条守卫必须同时护住 map 删除与 settling 清除)
      if (pendingDisconnects.get(configId) !== settled) return;
      pendingDisconnects.delete(configId);
      useRemoteHostRuntimeStore.getState().setSettling(configId, false);
    });
  pendingDisconnects.set(configId, settled);
  useRemoteHostRuntimeStore.getState().setSettling(configId, true);
}

/**
 * 表达连接意图:断开在途则排队等它收尾(有 8 秒上界),否则立即兑现。
 *
 * 🔴 REVIEW F1(BLOCKER)—— **`resume` 必须在兑现点、与发 IPC 同步紧邻,不能在排队前**:
 * `resume` 一调,四道闸(applyEvent/setRtt/setReconnecting 三个写入闸 + 副作用闸)全部失效;
 * 而被取消那次的 `runConnect` 在 main 侧**一行没停**(`orchestrator.disconnect` 只 await 不中断)。
 * 若排队期间就把闸开了,残余 `claiming/verifying/ready` 会照单全收 → 组头变绿、残余 `verifying`
 * 真去对**旧隧道**开 ws 把连接建成 → main 醒来再拆掉;握手若 reject 收场还会弹一条假的
 * 「连接失败」toast。那是 AC-6 三句逐字失败。
 *
 * 🔴 兑现前查的是**连接意图**而非 `isAbandoned`:意图被 `abandon` 撤销(用户改主意点了断开),
 * 这比查弃用标记更直接 —— 弃用标记此刻**本来就该是真**(machine 仍处于「用户要它断开」的状态),
 * 真正该问的是「用户还想连吗」。
 */
export function requestConnect(configId: string, fire: () => void): void {
  connectIntent.add(configId);
  const pending = pendingDisconnects.get(configId);
  if (!pending) {
    fulfill();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  void Promise.race([
    pending,
    new Promise<void>((r) => {
      timer = setTimeout(r, DISCONNECT_QUEUE_TIMEOUT_MS);
    }),
  ]).then(() => {
    if (timer !== undefined) clearTimeout(timer); // REVIEW F10:pending 先赢时别留空转计时器
    fulfill();
  });

  function fulfill(): void {
    if (!connectIntent.delete(configId)) return; // 意图已被撤销(用户改主意断开了)
    useRemoteHostRuntimeStore.getState().resume(configId); // 🔴 与下一行同步紧邻,勿拆开
    fire();
  }
}

/**
 * 握手去重槽:返回 false = 已有握手在途,调用方应早退。
 * 拿到 true 的调用方**必须**在握手落定后调 `endHandshake`(`abandon`/`forget` 也会替它清)。
 */
export function tryBeginHandshake(configId: string): boolean {
  if (handshaking.has(configId)) return false;
  handshaking.add(configId);
  return true;
}

export function endHandshake(configId: string): void {
  handshaking.delete(configId);
}

/** 仅供测试:重置模块级容器(它们不在 zustand state 里,`setState` 清不掉)。 */
export function __resetRemoteHostOrchestrationForTest(): void {
  pendingDisconnects.clear();
  connectIntent.clear();
  handshaking.clear();
}
