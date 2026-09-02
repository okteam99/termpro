// headless-remote 工具该不该打到远端 Chromium(能力位 + 真装了浏览器)。
// inner_browser_* 不走这里,直接本机 webview。
//
// 背景:agent 跑在远端 session 里,浏览器却在用户本机——中间靠 SSH 反向转发把 MCP
// 打回来,链路长且脆(那条转发"经常挂死"是有记录的)。远端自己有浏览器后,
// 控制走 127.0.0.1,反向转发这条路整个不需要了。
//
// 🔴 渐进启用,零破坏:只有「远程 host + 有 browser.* 能力位 + 那台机器上真装了
// Chromium」三条同时成立才走云端;差任何一条都维持现状(本机 webview + 反向转发)。
// 远端没装浏览器的存量用户升级后行为一字不变。
//
// 判定结果按 hostId 缓存:每次 browser_* 调用都问一遍 browser.status 等于给每个
// agent 动作加一个跨洋往返。断线/重连会清缓存(能力与可用性都可能变)。

import type { HostClient } from './hostClient';
import { hostRegistry } from './hostRegistry';

/** 一次路由判定的结果。 */
export type BrowserBackend =
  | { kind: 'local'; reason: 'local-host' | 'no-capability' | 'no-chromium' | 'probe-failed' }
  | { kind: 'cloud'; client: HostClient; hostId: string };

interface CachedProbe {
  available: boolean;
  hint?: string;
}

const probeCache = new Map<string, CachedProbe>();
/** 在途探测:并发的 browser_* 首调共享同一次 status 往返 */
const inflight = new Map<string, Promise<CachedProbe>>();

/** 断线/重连/手动断开后清掉该机的判定(装没装 Chromium 可能已经变了)。 */
export function invalidateCloudBrowserProbe(hostId?: string): void {
  if (hostId === undefined) {
    probeCache.clear();
    inflight.clear();
    return;
  }
  probeCache.delete(hostId);
  inflight.delete(hostId);
}

/** 仅供单测:清空全部缓存。 */
export function __resetCloudBrowserRoutingForTest(): void {
  invalidateCloudBrowserProbe();
}

async function probe(hostId: string, client: HostClient): Promise<CachedProbe> {
  const cached = probeCache.get(hostId);
  if (cached) return cached;
  const running = inflight.get(hostId);
  if (running) return running;

  const p = client
    .rpc('browser.status', undefined)
    .then((status) => {
      const entry: CachedProbe = {
        available: status.available,
        ...(status.hint ? { hint: status.hint } : {}),
      };
      probeCache.set(hostId, entry);
      return entry;
    })
    .catch((err: unknown) => {
      // 探测失败(旧 host / 连接抖动)不缓存:下次再问,别把一次瞬时故障
      // 钉死成"这台机永远没有浏览器"
      console.warn(
        `[cloudBrowser] status probe failed hostId=${hostId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { available: false } satisfies CachedProbe;
    })
    .finally(() => {
      inflight.delete(hostId);
    });
  inflight.set(hostId, p);
  return p;
}

/**
 * 决定某终端 tab 所在机器的浏览器后端。
 * hostId='local'(本机 workspace)→ 恒走本机 webview:本地根本不需要云端那套。
 */
export async function resolveBrowserBackend(hostId: string): Promise<BrowserBackend> {
  if (!hostId || hostId === 'local') return { kind: 'local', reason: 'local-host' };
  const client = hostRegistry.forHostId(hostId);
  // 远程 client 不在(断线竞态)→ 维持现状路径,不在这里报错
  if (!client) return { kind: 'local', reason: 'no-capability' };
  if (!client.supportsCloudBrowser()) return { kind: 'local', reason: 'no-capability' };
  const status = await probe(hostId, client);
  if (!status.available) return { kind: 'local', reason: 'no-chromium' };
  return { kind: 'cloud', client, hostId };
}

/** 远端装了浏览器但暂时不可用时,给 agent 的错误里带上安装指引。 */
export function cloudBrowserHint(hostId: string): string | undefined {
  return probeCache.get(hostId)?.hint;
}
