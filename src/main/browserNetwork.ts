// 内置浏览器网络出口控制器（main 进程）。persist:browser session 的代理指向:
//   'local' = 直连（系统默认网络）；远程 = 该机本地 SOCKS5 端口（流量走远程网络 + 远程 DNS）。
//
// 三条纪律：
//  1. WebRTC 防泄漏：选远程出口时对所有 browser guest 设 disable_non_proxied_udp——
//     SOCKS5 只代理 TCP，WebRTC 的 UDP 会绕过代理直接暴露本机真实 IP，与「走远程机
//     网络」的语义相悖；回本机则恢复 default。
//  2. 断线自动回退:当前出口的远程机断开 → 回退 local + 广播。远程 SOCKS server 已由
//     orchestrator.closeSessionTransport 关闭,若不回退 session 会卡在已失效的代理端口上,
//     浏览器全部请求失败(表现为「整个浏览器打不开任何网页」)。
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
   * 某远程机断线:若它正是当前出口 → 回退 local + 广播。非当前出口一律忽略
   * (它的 SOCKS server 断开不影响浏览器,且不应误动其它出口)。
   */
  onHostDown(configId: string): void {
    if (this.current.hostId !== configId) return;
    void this.set('local');
  }

  private async applySet(hostId: string): Promise<BrowserNetworkState> {
    const prev = this.current;

    if (hostId !== 'local') {
      const proxy = await this.deps.browserProxyFor(hostId);
      if (proxy) {
        // 先切到新代理,再释放旧远程——避免出现「旧 server 已关但 session 还指向它」的空窗
        await this.deps.setProxy(`socks5://127.0.0.1:${proxy.socksPort}`);
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
