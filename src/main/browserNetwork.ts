// 内置浏览器网络出口控制器（main 进程）。persist:browser session 的代理指向:
//   'local' = 直连（系统默认网络）；远程 = 该机本地 SOCKS5 端口（流量走远程网络 + 远程 DNS）。
//
// 三条纪律：
//  1. WebRTC 防泄漏：选远程出口时对所有 browser guest 设 disable_non_proxied_udp——
//     SOCKS5 只代理 TCP，WebRTC 的 UDP 会绕过代理直接暴露本机真实 IP，与「走远程机
//     网络」的语义相悖；回本机则恢复 default。
//  2. 断线 fail-closed(用户指令 2026-07-14「远程 tab 的浏览器不要自动切 local」):
//     当前出口的远程机断开 → 只标记 down + 广播,**不回退 local**——静默切换出口会让
//     本应走远程网络的流量从本机 IP 出去(泄漏),且 localhost 类地址瞬间换语义。
//     代理保持指向已失效端口(请求快速失败,可见可解释),WebRTC 防泄漏策略不放开;
//     该机重连 ready 后自动重建 SOCKS 并恢复(onHostUp)。回 local 只有两条路:
//     用户手动选 local / 用户删除该机(onHostRemoved,显式意图)。
//  3. 切换即释放旧出口:换台机/回本机时 releaseBrowserProxy 旧远程,不泄漏本地端口。
//
// 纯逻辑 + DI 接缝(setProxy/setWebRtcPolicy 等由 main.ts 注入真实 Electron 实现),
// 便于单测不触碰 Electron/网络。

import type { BrowserNetworkState } from '../shared/remoteHost';

export type WebRtcPolicy = 'default' | 'disable_non_proxied_udp';

export interface BrowserNetworkDeps {
  /** persist:browser session 的代理设置接缝：rules=null 表示直连（mode:direct）。 */
  setProxy: (rules: string | null) => Promise<void>;
  /** 拉起/复用某远程机本地 SOCKS 端口;非 ready → null(回退 local)。 */
  browserProxyFor: (configId: string) => Promise<{ socksPort: number } | null>;
  /** 取消选中远程出口时回收其 SOCKS 代理(幂等)。 */
  releaseBrowserProxy: (configId: string) => void;
  /** 对所有 browser guest webContents 设 WebRTC IP 处理策略。 */
  setWebRtcPolicy: (policy: WebRtcPolicy) => void;
  /** configId → alias(UI 展示;取不到 → undefined)。 */
  aliasOf: (configId: string) => string | undefined;
  /** 出口变更广播(main→renderer)。 */
  emitChanged: (state: BrowserNetworkState) => void;
}

const LOCAL: BrowserNetworkState = { hostId: 'local' };

export class BrowserNetworkController {
  private current: BrowserNetworkState = { ...LOCAL };
  /** set 串行化:快速连点切换出口时不让 setProxy/release 交错(后到者以最终态为准)。 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BrowserNetworkDeps) {}

  get(): BrowserNetworkState {
    return this.current;
  }

  set(hostId: string): Promise<BrowserNetworkState> {
    const run = this.queue.then(
      () => this.applySet(hostId),
      () => this.applySet(hostId),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 某远程机断线:若它正是当前出口 → 标记 down + 广播(fail-closed,见纪律 2)。
   * 不动代理(死端口=请求快速失败)、不放开 WebRTC 防泄漏、不释放代理(orchestrator
   * closeSessionTransport 已关它的 SOCKS,release 幂等留给后续切换路径)。
   * 非当前出口一律忽略(不应误动其它出口)。
   */
  onHostDown(configId: string): void {
    if (this.current.hostId !== configId || this.current.down) return;
    this.commit({ ...this.current, down: true });
  }

  /**
   * 某远程机重连就绪:若它正是当前出口且处于 down → 重建 SOCKS + 恢复代理 + 清标志。
   * 经同一队列串行(不与用户 set 交错);重建失败保持 down(fail-closed,等下一次 ready)。
   */
  onHostUp(configId: string): void {
    const run = this.queue.then(
      () => this.applyHostUp(configId),
      () => this.applyHostUp(configId),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
  }

  /** 用户删除某远程机(显式意图):若它是当前出口 → 回 local(唯一的自动回退入口)。 */
  onHostRemoved(configId: string): void {
    if (this.current.hostId !== configId) return;
    void this.set('local');
  }

  private async applyHostUp(configId: string): Promise<void> {
    if (this.current.hostId !== configId || !this.current.down) return;
    const proxy = await this.deps.browserProxyFor(configId);
    if (!proxy) return; // ready→又断的竞态:保持 down,等下一次 ready
    try {
      await this.deps.setProxy(`socks5://127.0.0.1:${proxy.socksPort}`);
    } catch {
      this.deps.releaseBrowserProxy(configId);
      return; // 保持 down(fail-closed),绝不静默落 local
    }
    this.deps.setWebRtcPolicy('disable_non_proxied_udp');
    this.commit({ hostId: configId, alias: this.deps.aliasOf(configId) });
  }

  private async applySet(hostId: string): Promise<BrowserNetworkState> {
    const prev = this.current;

    if (hostId !== 'local') {
      const proxy = await this.deps.browserProxyFor(hostId);
      if (proxy) {
        try {
          // 先切到新代理,再释放旧远程——避免出现「旧 server 已关但 session 还指向它」的空窗
          await this.deps.setProxy(`socks5://127.0.0.1:${proxy.socksPort}`);
        } catch {
          // 🔴 setProxy 失败(评审 P2-3):回收刚建起的新 SOCKS 端口(否则泄漏监听口),
          // 回退 local。commit local 而非停在 prev,current 与 session 代理态才一致。
          this.deps.releaseBrowserProxy(hostId);
          await this.deps.setProxy(null).catch(() => undefined);
          this.deps.setWebRtcPolicy('default');
          this.releasePrevRemote(prev, 'local');
          return this.commit({ ...LOCAL });
        }
        this.deps.setWebRtcPolicy('disable_non_proxied_udp');
        this.releasePrevRemote(prev, hostId);
        return this.commit({ hostId, alias: this.deps.aliasOf(hostId) });
      }
      // 请求的远程机不可用(非 ready / 断线竞态):落到下面回退 local,保证浏览器仍可用
    }

    await this.deps.setProxy(null);
    this.deps.setWebRtcPolicy('default');
    this.releasePrevRemote(prev, 'local');
    return this.commit({ ...LOCAL });
  }

  private releasePrevRemote(prev: BrowserNetworkState, nextHostId: string): void {
    if (prev.hostId !== 'local' && prev.hostId !== nextHostId) {
      this.deps.releaseBrowserProxy(prev.hostId);
    }
  }

  private commit(state: BrowserNetworkState): BrowserNetworkState {
    this.current = state;
    this.deps.emitChanged(state);
    return state;
  }
}
