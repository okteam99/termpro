// ExitHoldLedger(阶段3):主窗声明式集合 ∪ 各非主窗(查看器)hold 集合 → 并集,
// 喂给 browserNetwork.syncExits。纯逻辑,零 Electron,main.ts 按 webContents.id 记账。
import { describe, expect, it } from 'vitest';
import { ExitHoldLedger } from '../exitHolds';

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
});
