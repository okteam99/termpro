// ExitHoldLedger(阶段3):主窗声明式集合 ∪ 各非主窗(查看器)hold 集合 → 并集,
// 喂给 browserNetwork.syncExits。纯逻辑,零 Electron,main.ts 按 webContents.id 记账。
import { describe, expect, it } from 'vitest';
import { ExitHoldLedger, filterHoldRequest } from '../exitHolds';

describe('filterHoldRequest(评审 P2-6 · 评审盲区1:hold 请求闸的纯逻辑部分)', () => {
  it('ownHostId 非空 → 只保留等于它的元素(⊆ {ownHostId})', () => {
    expect(filterHoldRequest(['cfg-a', 'cfg-b'], 'cfg-a')).toEqual(['cfg-a']);
    expect(filterHoldRequest(['cfg-a', 'cfg-a'], 'cfg-a')).toEqual(['cfg-a', 'cfg-a']); // 去重是上游 setHold/effective 的事,这里只做闸
  });

  it('ownHostId 为 null(sender 不是已知查看器窗口)→ 恒返回空', () => {
    expect(filterHoldRequest(['cfg-a'], null)).toEqual([]);
    expect(filterHoldRequest([], null)).toEqual([]);
  });

  it('请求列表不含 ownHostId → 全部丢弃', () => {
    expect(filterHoldRequest(['cfg-b', 'cfg-c'], 'cfg-a')).toEqual([]);
  });

  it('非法元素(非字符串/空串)被过滤', () => {
    expect(
      filterHoldRequest(
        ['cfg-a', '', null as unknown as string, 42 as unknown as string],
        'cfg-a',
      ),
    ).toEqual(['cfg-a']);
  });

  it('空请求列表 → 空结果', () => {
    expect(filterHoldRequest([], 'cfg-a')).toEqual([]);
  });
});

describe('ExitHoldLedger', () => {
  it('effective:并集,去重,排序', () => {
    const l = new ExitHoldLedger();
    l.setMain(['b', 'a']);
    l.setHold(1, ['a', 'c']);
    expect(l.effective()).toEqual(['a', 'b', 'c']);
  });

  it('setHold 覆盖旧值(同 key 再次 setHold 整体替换,不是追加)', () => {
    const l = new ExitHoldLedger();
    l.setHold(1, ['x', 'y']);
    expect(l.effective()).toEqual(['x', 'y']);
    l.setHold(1, ['z']);
    expect(l.effective()).toEqual(['z']);
  });

  it('setHold 空数组等价清除', () => {
    const l = new ExitHoldLedger();
    l.setMain(['m']);
    l.setHold(1, ['a']);
    expect(l.effective()).toEqual(['a', 'm']);
    l.setHold(1, []);
    expect(l.effective()).toEqual(['m']);
  });

  it('dropHold 后收敛(该 key 不再贡献任何 hostId)', () => {
    const l = new ExitHoldLedger();
    l.setHold(1, ['a', 'b']);
    l.setHold(2, ['b', 'c']);
    expect(l.effective()).toEqual(['a', 'b', 'c']);
    l.dropHold(1);
    expect(l.effective()).toEqual(['b', 'c']); // 'b' 仍由 key 2 贡献,不因 key1 消失而丢
    l.dropHold(2);
    expect(l.effective()).toEqual([]);
  });

  it('dropHold 对不存在的 key 是无害 no-op', () => {
    const l = new ExitHoldLedger();
    l.setMain(['m']);
    l.dropHold(999);
    expect(l.effective()).toEqual(['m']);
  });

  it('主窗集合与 hold 互不吞并:各自独立覆盖,互不清空对方', () => {
    const l = new ExitHoldLedger();
    l.setMain(['a']);
    l.setHold(1, ['b']);
    expect(l.effective()).toEqual(['a', 'b']);

    // 主窗重新声明(集合缩减为空)不影响 hold 集合
    l.setMain([]);
    expect(l.effective()).toEqual(['b']);

    // 反向:hold 清除不影响主窗集合
    l.setMain(['a']);
    l.dropHold(1);
    expect(l.effective()).toEqual(['a']);
  });

  it('多 key 独立记账,互不覆盖', () => {
    const l = new ExitHoldLedger();
    l.setHold(1, ['a']);
    l.setHold(2, ['b']);
    l.setHold(3, ['c']);
    expect(l.effective()).toEqual(['a', 'b', 'c']);

    l.setHold(2, ['d']); // 只改 key 2
    expect(l.effective()).toEqual(['a', 'c', 'd']);

    l.dropHold(3);
    expect(l.effective()).toEqual(['a', 'd']);
  });

  it('effective 不含重复项:同一 hostId 被 main 与多个 hold 同时持有仍只出现一次', () => {
    const l = new ExitHoldLedger();
    l.setMain(['x']);
    l.setHold(1, ['x']);
    l.setHold(2, ['x']);
    expect(l.effective()).toEqual(['x']);
  });

  describe('purge(评审 P2-5:远程机被删除)', () => {
    it('从主窗集合摘除该 hostId,其余不动', () => {
      const l = new ExitHoldLedger();
      l.setMain(['a', 'b']);
      l.purge('a');
      expect(l.effective()).toEqual(['b']);
    });

    it('从所有非主窗 hold 集合摘除该 hostId(多 key 同时持有也一并清)', () => {
      const l = new ExitHoldLedger();
      l.setHold(1, ['a', 'b']);
      l.setHold(2, ['a', 'c']);
      l.purge('a');
      expect(l.effective()).toEqual(['b', 'c']);
    });

    it('某 key 的 hold 集合因 purge 变空 → 该 key 整体摘除(与 setHold 空数组同效)', () => {
      const l = new ExitHoldLedger();
      l.setHold(1, ['a']);
      l.setHold(2, ['b']);
      l.purge('a');
      expect(l.effective()).toEqual(['b']);
      // key 1 已整体清除:再对它 setHold 空数组是 no-op,不应报错
      l.setHold(1, []);
      expect(l.effective()).toEqual(['b']);
    });

    it('main 与 hold 都持有同一 hostId → 一次 purge 两处都清', () => {
      const l = new ExitHoldLedger();
      l.setMain(['a']);
      l.setHold(1, ['a', 'b']);
      l.purge('a');
      expect(l.effective()).toEqual(['b']);
    });

    it('对不存在的 hostId 是无害 no-op', () => {
      const l = new ExitHoldLedger();
      l.setMain(['a']);
      l.setHold(1, ['b']);
      l.purge('nope');
      expect(l.effective()).toEqual(['a', 'b']);
    });
  });
});
