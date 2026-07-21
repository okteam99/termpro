// 内置浏览器网络出口控制器(main 进程 · 标签级出口/多分区版 2026-07)。
//
// 模型:出口 → session 分区【集合】(profile × 出口 二维,2026-07-21)。local 直连
// 不归本控制器管;每台在用远程机对应一组组合分区(默认 profile 的
// persist:browser-<configId> + 每个自定义 profile 的 persist:browser-prof-<pid>-<configId>,
// 集合由 main 经 deps.partitionsOf 注入,单源 = browserPartitionPolicy),每个组合分区
// 恒 setProxy(socks5://127.0.0.1:<该机本地 SOCKS 端口>) + <-loopback>(撤销 Chromium
// 对 localhost 的隐式代理豁免——走远程出口的核心场景就是访问 remote localhost)。
// SOCKS 端口仍按 configId 一份(同一出口各 profile 共享隧道;隔离的是存储不是链路)。
//
// 四条纪律:
//  1. 声明式对账:renderer(各窗口)上报「在用出口集合」(syncExits),本控制器
//     acquire 新增 / release 不再使用——没有引用计数漂移(集合就是事实)。
//  2. 断线 fail-closed(per-分区):出口远程机断线只标 down + 广播;该分区代理留在
//     死端口(请求快速失败),绝不静默改直连;重连 ready 自动重建 SOCKS(新端口)
//     重 setProxy 并清 down。
//  3. 删除该机(显式意图)= release + 从快照移除(标签的 netHostId 失效,由 UI 引导改选)。
//  4. WebRTC 防泄漏静态化:远程分区 guest 恒 disable_non_proxied_udp(main.ts 在
//     attach 时按分区判定,不再全局切换)。
//
// 纯逻辑 + DI 接缝(setProxy 等由 main.ts 注入真实 Electron 实现),便于单测。

import type { BrowserExitState, BrowserNetworkSnapshot } from '../shared/remoteHost';

export interface BrowserNetworkDeps {
  /** 某分区的代理设置接缝;rules=null 表示直连(mode:direct)。远程分区恒带 <-loopback>。 */
  setProxy: (partition: string, rules: string | null) => Promise<void>;
  /** 某出口(configId)的全部组合分区(默认 profile + 每个自定义 profile;调用期取值,
   *  profile 增删后集合自动变新)。单源 = main 的 browserPartitionPolicy.partitionsOfExit。 */
  partitionsOf: (configId: string) => string[];
  /** 拉起/复用某远程机本地 SOCKS 端口;非 ready → null。 */
  browserProxyFor: (configId: string) => Promise<{ socksPort: number } | null>;
  /** 出口不再使用时回收其 SOCKS 代理(幂等)。 */
  releaseBrowserProxy: (configId: string) => void;
  /** configId → alias(UI 展示;取不到 → undefined)。 */
  aliasOf: (configId: string) => string | undefined;
  /** 快照变更广播(main→renderer 各窗口)。 */
  emitChanged: (snapshot: BrowserNetworkSnapshot) => void;
}

interface ExitEntry {
  /** 断线中(fail-closed);代理指向的端口已死,等 onHostUp 重建 */
  down: boolean;
}

// 黑洞代理:指向必然连不上的端口(fail-closed 默认)。远程分区在 acquire 到活端口
// 【之前】必须先落黑洞,否则该 session 从未 setProxy → Electron 按 direct 解析 →
// 首个 attach 的 guest 从本机 IP/DNS 出去(评审 P1-1:fail-OPEN 窗口)。加载时机
// 泄漏与断线泄漏同类,同一「绝不静默落直连」铁律(2026-07-14 用户指令)覆盖。
const BLACKHOLE_PROXY = 'socks5://127.0.0.1:1';

export class BrowserNetworkController {
  /** 在用远程出口(configId → 状态);local 不入表 */
  private exits = new Map<string, ExitEntry>();
  /** 对账/恢复串行化:syncExits 与 onHostUp 交错会重复建/漏建 SOCKS */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BrowserNetworkDeps) {}

  /**
   * 黑洞预封(评审 P1-1):对尚未 acquire 的远程分区先落黑洞代理,消灭「首个 guest
   * 在 acquire 前 attach → 走本机直连」的 fail-open 窗口。启动时对全部已存 config、
   * 新增 config 保存后对该 config 调用。已在用(exits 有 entry)的分区不动(其代理
   * 已是活端口或 down 死端口,都 fail-closed)。
   */
  preseal(hostIds: string[]): Promise<void> {
    return this.enqueue(async () => {
      for (const hostId of hostIds) {
        if (!hostId || hostId === 'local' || this.exits.has(hostId)) continue;
        await this.sealAll(hostId);
      }
    });
  }

  /**
   * profile 集合变化(新增 profile 保存后调用):各出口的组合分区集合已变。
   * 在用且 up 的出口 → 重放 acquire(活代理覆盖到新组合分区);其余(未在用/down)
   * → 全量黑洞(新组合分区在首个 guest attach 前绝不裸奔,与 preseal 同一 P1-1 铁律)。
   */
  onProfilesChanged(hostIds: string[]): Promise<void> {
    return this.enqueue(async () => {
      for (const hostId of hostIds) {
        if (!hostId || hostId === 'local') continue;
        const e = this.exits.get(hostId);
        if (e && !e.down) await this.acquire(hostId);
        else await this.sealAll(hostId);
      }
    });
  }

  /** 某出口全部组合分区落黑洞(fail-closed 兜底;单分区失败不阻断其余)。 */
  private async sealAll(hostId: string): Promise<void> {
    for (const partition of this.deps.partitionsOf(hostId)) {
      await this.deps.setProxy(partition, BLACKHOLE_PROXY).catch(() => undefined);
    }
  }

  snapshot(): BrowserNetworkSnapshot {
    const exits: BrowserExitState[] = [...this.exits.entries()].map(([hostId, e]) => ({
      hostId,
      alias: this.deps.aliasOf(hostId),
      ...(e.down ? { down: true } : {}),
    }));
    return { exits };
  }

  /** 声明式对账:hostIds = 当前所有窗口全部浏览器标签的出口全集('local' 忽略)。 */
  syncExits(hostIds: string[]): Promise<BrowserNetworkSnapshot> {
    return this.enqueue(async () => {
      const want = new Set(hostIds.filter((h) => h && h !== 'local'));
      let changed = false;
      // release 不再使用的出口(分区代理不清,无人使用无副作用;SOCKS 端口回收)
      for (const hostId of [...this.exits.keys()]) {
        if (!want.has(hostId)) {
          this.exits.delete(hostId);
          this.deps.releaseBrowserProxy(hostId);
          changed = true;
        }
      }
      // acquire 新增的出口
      for (const hostId of want) {
        if (!this.exits.has(hostId)) {
          await this.acquire(hostId);
          changed = true;
        }
      }
      const snap = this.snapshot();
      if (changed) this.deps.emitChanged(snap);
      return snap;
    });
  }

  /** 某远程机断线:在用出口 → 标 down + 广播(fail-closed,见纪律 2);其余忽略。 */
  onHostDown(configId: string): void {
    const e = this.exits.get(configId);
    if (!e || e.down) return;
    e.down = true;
    this.deps.emitChanged(this.snapshot());
  }

  /** 某远程机重连就绪:在用且 down → 重建 SOCKS(新端口)重 setProxy + 清 down。 */
  onHostUp(configId: string): void {
    void this.enqueue(async () => {
      const e = this.exits.get(configId);
      if (!e || !e.down) return;
      await this.acquire(configId); // acquire 失败会保持 down(又断竞态,等下一次 ready)
      this.deps.emitChanged(this.snapshot());
    });
  }

  /** 用户删除某远程机(显式意图):release + 移出快照。 */
  onHostRemoved(configId: string): void {
    void this.enqueue(async () => {
      if (!this.exits.delete(configId)) return;
      this.deps.releaseBrowserProxy(configId);
      this.deps.emitChanged(this.snapshot());
    });
  }

  /** 建立(或重建)某出口:SOCKS + 全部组合分区代理。失败 → 挂 down(fail-closed,
   *  绝不落直连;部分分区已设的活代理随 release 变死端口,同样快速失败)。 */
  private async acquire(configId: string): Promise<void> {
    const proxy = await this.deps.browserProxyFor(configId);
    if (!proxy) {
      this.exits.set(configId, { down: true });
      return;
    }
    try {
      for (const partition of this.deps.partitionsOf(configId)) {
        await this.deps.setProxy(partition, `socks5://127.0.0.1:${proxy.socksPort}`);
      }
    } catch {
      // setProxy 失败:回收刚建的端口防泄漏,挂 down(任何分区绝不落直连;
      // 已设活代理的分区随端口回收指向死端口——fail-closed 不破)
      this.deps.releaseBrowserProxy(configId);
      this.exits.set(configId, { down: true });
      return;
    }
    this.exits.set(configId, { down: false });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
