// @vitest-environment jsdom
// OKWORK-F260805033051 review round 1: machine 级连接编排缺陷回归测试
// 锁住 F1(排队期间闸门)/F2(握手去重)/F5(settling 态接替)三个核心缺陷。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISCONNECT_QUEUE_TIMEOUT_MS,
  __resetRemoteHostOrchestrationForTest,
  endHandshake,
  requestConnect,
  trackDisconnect,
  tryBeginHandshake,
  useRemoteHostRuntimeStore,
} from '../remoteHostStore';

beforeEach(() => {
  useRemoteHostRuntimeStore.setState({
    runtime: {},
    reconnecting: {},
    rtt: {},
    abandoned: {},
    settling: {},
  });
  __resetRemoteHostOrchestrationForTest();
});

afterEach(() => {
  // T-038h 里 spy 了 console.warn(reject 路径会打日志)。不 restore 会泄漏到后续用例,
  // 把它们真实的告警一并吞掉 —— 那种污染表现为「别的用例本该报警却静默通过」。
  vi.restoreAllMocks();
});

describe('连接编排闸门与排队逻辑(remoteHostStore abandon/resume)', () => {
  describe('T-038a｜排队期间闸门必须保持关闭', () => {
    it('排队期间 isAbandoned 为真,兑现后变假(F1 BLOCKER)', async () => {
      const c1 = 'c1';
      let resolveDisconnect: (() => void) | undefined;
      const disconnectPromise = new Promise<void>((r) => {
        resolveDisconnect = r;
      });

      // 1. 进入排队态
      useRemoteHostRuntimeStore.getState().abandon(c1);
      trackDisconnect(c1, disconnectPromise);

      // 2. 表达连接意图
      const fire = vi.fn();
      requestConnect(c1, fire);

      // 3. 排队期间：fire 未被调用，且 isAbandoned 仍为真(排队中不许开闸)
      expect(fire).not.toHaveBeenCalled();
      expect(useRemoteHostRuntimeStore.getState().isAbandoned(c1)).toBe(true);

      // 4. resolve 断开
      resolveDisconnect!();

      // 5. 轮询等待 fire 被调用（微任务链深度不固定，不能硬数 await 次数）
      await vi.waitFor(() => {
        expect(fire).toHaveBeenCalledTimes(1);
      });
      expect(useRemoteHostRuntimeStore.getState().isAbandoned(c1)).toBe(false);
    });
  });

  describe('T-038b｜排队中被撤销的连接意图不得兑现', () => {
    it('排队中再次 abandon,resolve 后 fire 不被调用', async () => {
      const c1 = 'c1';
      let resolveDisconnect: (() => void) | undefined;
      const disconnectPromise = new Promise<void>((r) => {
        resolveDisconnect = r;
      });

      // 1. 进入排队态
      useRemoteHostRuntimeStore.getState().abandon(c1);
      trackDisconnect(c1, disconnectPromise);

      // 2. 表达连接意图 → 排队中
      const fire = vi.fn();
      requestConnect(c1, fire);

      // 3. resolve 之前再次 abandon(用户改主意点了断开)
      useRemoteHostRuntimeStore.getState().abandon(c1);

      // 4. resolve 断开，flush 微任务
      resolveDisconnect!();
      await Promise.resolve();

      // 5. fire 未被调用，isAbandoned 仍为真
      expect(fire).not.toHaveBeenCalled();
      expect(useRemoteHostRuntimeStore.getState().isAbandoned(c1)).toBe(true);
    });
  });

  describe('T-038c｜无断开在途时立即兑现', () => {
    it('不 trackDisconnect,直接 abandon 后 requestConnect 同步调用 fire', () => {
      const c1 = 'c1';
      useRemoteHostRuntimeStore.getState().abandon(c1);

      const fire = vi.fn();
      requestConnect(c1, fire);

      // 无排队，fire 同步被调用1次
      expect(fire).toHaveBeenCalledTimes(1);
      // isAbandoned 已被 resume 清掉
      expect(useRemoteHostRuntimeStore.getState().isAbandoned(c1)).toBe(false);
    });
  });

  describe('T-038d｜8秒上界(断开永不 resolve 也要放行)', () => {
    it('排队 8秒后强制放行(DISCONNECT_QUEUE_TIMEOUT_MS)', async () => {
      const c1 = 'c1';
      vi.useFakeTimers();
      try {
        // 模拟主进程异常悬挂:disconnectAwait 永不 resolve
        const neverResolves = new Promise<void>(() => {
          /* 故意不 resolve —— 8 秒上界就是为这种情况兜底的 */
        });
        useRemoteHostRuntimeStore.getState().abandon(c1);
        trackDisconnect(c1, neverResolves);

        const fire = vi.fn();
        requestConnect(c1, fire);

        // 上界到点前不许放行(否则这条用例测不出上界,只测了"迟早会发")
        vi.advanceTimersByTime(DISCONNECT_QUEUE_TIMEOUT_MS - 1);
        await Promise.resolve();
        expect(fire).not.toHaveBeenCalled();

        // 跨过上界 → 放行(pending 仍未 resolve)
        vi.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(fire).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('T-038e｜握手去重槽随 abandon 作废', () => {
    it('tryBeginHandshake 去重生效,abandon 后能重新握手,endHandshake 后也能重新握手', () => {
      const c1 = 'c1';

      // 1. 第一次握手成功
      const result1 = tryBeginHandshake(c1);
      expect(result1).toBe(true);

      // 2. 第二次握手被去重挡住 → false
      const result2 = tryBeginHandshake(c1);
      expect(result2).toBe(false);

      // 3. abandon → 槽位被清掉
      useRemoteHostRuntimeStore.getState().abandon(c1);

      // 4. 现在能重新握手 → true (灵魂断言:槽位必须被清掉)
      const result3 = tryBeginHandshake(c1);
      expect(result3).toBe(true);

      // 5. endHandshake 后也能重新握手
      endHandshake(c1);
      const result4 = tryBeginHandshake(c1);
      expect(result4).toBe(true);
    });
  });

  describe('T-038f｜第二次断开在途时,前一次的 finally 不得清掉忙碌态', () => {
    it('两条 trackDisconnect 在途,resolve 第一条时 settling 仍为真(被第二条接替)', async () => {
      const c1 = 'c1';
      let resolveP1: (() => void) | undefined;
      let resolveP2: (() => void) | undefined;
      const p1 = new Promise<void>((r) => {
        resolveP1 = r;
      });
      const p2 = new Promise<void>((r) => {
        resolveP2 = r;
      });

      // 1. 第一条断开在途
      trackDisconnect(c1, p1);
      expect(useRemoteHostRuntimeStore.getState().settling[c1]).toBe(true);

      // 2. 第二条断开在途(p2 取代 p1)
      trackDisconnect(c1, p2);
      expect(useRemoteHostRuntimeStore.getState().settling[c1]).toBe(true);

      // 3. resolve p1 → p1 的 finally 检查 `pendingDisconnects.get(c1) !== p1` 返回真,早退不清忙碌态
      resolveP1!();
      await Promise.resolve();
      await Promise.resolve();
      // 断言 settling 仍为真(p1 已被 p2 取代,不许动它的态)
      expect(useRemoteHostRuntimeStore.getState().settling[c1]).toBe(true);

      // 4. resolve p2 → p2 的 finally 发现 `pendingDisconnects.get(c1) === p2`,清忙碌态
      resolveP2!();
      await vi.waitFor(() => {
        expect(useRemoteHostRuntimeStore.getState().settling[c1]).toBeUndefined();
      });
    });
  });

  describe('T-038g｜forget 销毁全部痕迹', () => {
    it('forget 清空 5 张表 + 握手槽位', () => {
      const c1 = 'c1';

      // 1. 造出 5 张表都有 c1 的状态
      useRemoteHostRuntimeStore.setState({
        runtime: { [c1]: { configId: c1, stage: 'ready' } },
        rtt: { [c1]: 100 },
        reconnecting: { [c1]: true },
        settling: { [c1]: true },
        abandoned: { [c1]: true },
      });

      // 2. 握手槽位被占
      const canBegin = tryBeginHandshake(c1);
      expect(canBegin).toBe(true); // 槽位已占

      // 3. forget(c1) → 销毁全部痕迹
      useRemoteHostRuntimeStore.getState().forget(c1);

      // 4. 5 张表都没有 c1
      const state = useRemoteHostRuntimeStore.getState();
      expect(c1 in state.runtime).toBe(false);
      expect(c1 in state.rtt).toBe(false);
      expect(c1 in state.reconnecting).toBe(false);
      expect(c1 in state.settling).toBe(false);
      expect(c1 in state.abandoned).toBe(false);

      // 5. 握手槽位被清掉,能重新握手
      const canBeginAgain = tryBeginHandshake(c1);
      expect(canBeginAgain).toBe(true);
    });
  });

  describe('T-038h｜disconnectAwait 拒绝时,排队的连接仍须兑现(NF-1)', () => {
    it('断开 reject 时,fire 仍被调用 + settling 被清 + resumed', async () => {
      const c1 = 'c1';
      let rejectIt: (e: unknown) => void = () => {
        /* 由 Promise 构造器同步赋真值 */
      };
      const disconnectPromise = new Promise<void>((_, r) => {
        rejectIt = r;
      });

      // 静音 trackDisconnect 内的 console.warn,避免测试日志污染(reject 被正确处理,只是日志会打)
      vi.spyOn(console, 'warn').mockImplementation(() => {
        /* 静音:reject 路径本就该打这条 warn,不是失败信号 */
      });

      // 1. 进入排队态
      useRemoteHostRuntimeStore.getState().abandon(c1);
      trackDisconnect(c1, disconnectPromise);
      expect(useRemoteHostRuntimeStore.getState().settling[c1]).toBe(true);

      // 2. 表达连接意图
      const fire = vi.fn();
      requestConnect(c1, fire);

      // 3. 排队期间：fire 未被调用
      expect(fire).not.toHaveBeenCalled();

      // 4. 拒绝断开 promise
      rejectIt(new Error('boom'));

      // 5. 轮询等待 fire 被调用（微任务链：p reject → .catch → .finally → settled resolve → race resolve → .then → fulfill）
      await vi.waitFor(() => {
        expect(fire).toHaveBeenCalledTimes(1);
      });

      // 6. isAbandoned 被 resume 清掉
      expect(useRemoteHostRuntimeStore.getState().isAbandoned(c1)).toBe(false);

      // 7. settling 被 finally 清掉
      expect(useRemoteHostRuntimeStore.getState().settling[c1]).toBeUndefined();
    });
  });

  describe('T-037｜setReconnecting 写入闸:只挡置真·清假恒放行', () => {
    it('弃用后 setReconnecting(id, true) 被挡，setReconnecting(id, false) 恒放行', () => {
      const c1 = 'c1';

      // 1. 首先 abandon 该机
      useRemoteHostRuntimeStore.getState().abandon(c1);
      expect(useRemoteHostRuntimeStore.getState().isAbandoned(c1)).toBe(true);

      // 2. 尝试置真 → 被闸挡住
      useRemoteHostRuntimeStore.getState().setReconnecting(c1, true);
      expect(useRemoteHostRuntimeStore.getState().isReconnecting(c1)).toBe(false);

      // 3. 清假恒放行（即便已弃用，也能清掉 reconnecting 标记）
      // 构造一个"清理前"的既有状态：直接写入 reconnecting 表（不经由 setReconnecting）
      useRemoteHostRuntimeStore.setState({
        reconnecting: { [c1]: true },
      });
      expect(useRemoteHostRuntimeStore.getState().isReconnecting(c1)).toBe(true);

      // 现在清假 → 应该成功清掉
      useRemoteHostRuntimeStore.getState().setReconnecting(c1, false);
      expect(useRemoteHostRuntimeStore.getState().isReconnecting(c1)).toBe(false);
    });
  });
});
