// 假 Chromium:一个能应答 CDP 的测试替身(进程 + CDP 端一起假)。
// 让 browserService 的逻辑能端到端跑——含真 CdpConnection 的编解码,只有最外层
// 的 ws 与真实浏览器进程被替换。非 .test 文件,vitest 不当测试跑(同 wsTestHarness 惯例)。

import type { BrowserProcessLike } from '../browserService';
import { CdpConnection, type CdpTransport } from '../cdpClient';

export interface FakeTarget {
  targetId: string;
  url: string;
  title: string;
  type: string;
}

export interface FakeChromiumOptions {
  /** 启动后是否自动打印 DevTools endpoint(false 用来测「起不来」分支) */
  announceEndpoint?: boolean;
  /** 假进程 pid(profile 锁归属测试要让它等于一个真实存活的 pid) */
  pid?: number;
  /** 覆盖某些 CDP 方法的应答(测错误分支);返回 undefined 表示走默认应答 */
  override?: (
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ) => unknown;
}

/**
 * 建一个假 Chromium。返回进程替身 + 连接工厂 + 内部状态(供断言)。
 * 默认实现覆盖 browserService 用到的 CDP 面:Target.* / Page.* / Runtime.* / Input.*。
 */
export function fakeChromium(opts: FakeChromiumOptions = {}) {
  const targets: FakeTarget[] = [];
  const attached = new Map<string, string>(); // sessionId → targetId
  const calls: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
  let seq = 0;
  let killed = false;
  let exitCb: ((code: number | null) => void) | null = null;
  let stderrCb: ((chunk: string) => void) | null = null;

  const proc: BrowserProcessLike = {
    pid: opts.pid ?? 4242,
    stderr: { on: (_ev, cb) => { stderrCb = cb as (c: string) => void; } },
    stdout: { on: () => undefined },
    on: (_ev, cb) => { exitCb = cb; },
    kill: () => {
      if (!killed) {
        killed = true;
        exitCb?.(null);
      }
      return true;
    },
  };

  /** 默认 CDP 应答:够 browserService 跑通,不追求 CDP 全貌。 */
  function respond(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): unknown {
    const overridden = opts.override?.(method, params, sessionId);
    if (overridden !== undefined) return overridden;
    switch (method) {
      case 'Target.getTargets':
        return { targetInfos: targets };
      case 'Target.createTarget': {
        const targetId = `target-${++seq}`;
        targets.push({
          targetId,
          url: String(params.url ?? 'about:blank'),
          title: '',
          type: 'page',
        });
        return { targetId };
      }
      case 'Target.closeTarget': {
        const idx = targets.findIndex((t) => t.targetId === params.targetId);
        if (idx >= 0) targets.splice(idx, 1);
        return { success: true };
      }
      case 'Target.activateTarget':
        return {};
      case 'Target.attachToTarget': {
        const sid = `session-${++seq}`;
        attached.set(sid, String(params.targetId));
        return { sessionId: sid };
      }
      case 'Page.enable':
      case 'Page.bringToFront':
        return {};
      case 'Page.navigate': {
        const targetId = sessionId ? attached.get(sessionId) : undefined;
        const t = targets.find((x) => x.targetId === targetId);
        if (t) t.url = String(params.url);
        return { frameId: 'frame-1' };
      }
      case 'Page.captureScreenshot':
        return { data: 'ZmFrZS1wbmc=' };
      case 'Runtime.evaluate':
        return { result: { type: 'string', value: `evaluated:${String(params.expression).slice(0, 24)}` } };
      case 'Input.dispatchMouseEvent':
      case 'Input.insertText':
        return {};
      case 'Browser.close':
        // 真 Chromium 收到这条会落盘并退出;替身也照做,否则 shutdown 会白等
        // 满优雅退出超时(而且测不出「等到了才 SIGKILL」这条路径)
        queueMicrotask(() => {
          if (killed) return;
          killed = true;
          exitCb?.(0);
        });
        return {};
      default:
        return {};
    }
  }

  let onMessage: ((data: string) => void) | null = null;
  let onClose: ((reason: string) => void) | null = null;
  const transport: CdpTransport = {
    send: (data) => {
      if (killed) throw new Error('chromium is dead');
      const msg = JSON.parse(data) as {
        id: number;
        method: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      calls.push({
        method: msg.method,
        params: msg.params ?? {},
        ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
      });
      const result = respond(msg.method, msg.params ?? {}, msg.sessionId);
      // 异步应答(真实 CDP 不会同步回),用微任务即可,不引计时器
      void Promise.resolve().then(() => {
        if (result instanceof Error) {
          onMessage?.(JSON.stringify({ id: msg.id, error: { message: result.message } }));
        } else {
          onMessage?.(JSON.stringify({ id: msg.id, result }));
        }
      });
    },
    close: () => onClose?.('closed'),
    onMessage: (cb) => { onMessage = cb; },
    onClose: (cb) => { onClose = cb; },
  };

  return {
    proc,
    targets,
    calls,
    /** attach 过的 CDP session id(按发放顺序;预览测试要拿它做事件路由) */
    get attachedSessions() {
      return [...attached.keys()];
    },
    get killed() {
      return killed;
    },
    /** 主动推一条 CDP 事件(screencastFrame 一类) */
    event: (
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ) => {
      onMessage?.(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }));
    },
    /** 模拟 Chromium 打印 DevTools endpoint(browserService 靠它拿连接地址) */
    announce: (endpoint = 'ws://127.0.0.1:9999/devtools/browser/fake') => {
      stderrCb?.(`DevTools listening on ${endpoint}\n`);
    },
    /** 模拟进程死亡(OOM kill / crash) */
    die: (code: number | null = 137) => {
      killed = true;
      exitCb?.(code);
      onClose?.('chromium died');
    },
    /** 模拟「打印一行错误后立刻退出」(撞 profile 锁、缺 so 依赖一类的启动失败) */
    stderrExit: (code: number, message: string) => {
      stderrCb?.(`${message}\n`);
      killed = true;
      exitCb?.(code);
    },
    /** 传给 BrowserService 的 launch seam */
    launch: () => {
      if (opts.announceEndpoint !== false) {
        // 进程刚 spawn 就宣告(真实 Chromium 也是启动后很快打印)
        void Promise.resolve().then(() =>
          stderrCb?.('DevTools listening on ws://127.0.0.1:9999/devtools/browser/fake\n'),
        );
      }
      return proc;
    },
    /** 传给 BrowserService 的 connect seam */
    connect: () => CdpConnection.open('ws://fake', { transportFactory: async () => transport }),
  };
}
