import { describe, expect, it } from 'vitest';
import { type BarRegion, computeBarRegion } from '../bottomBarPin';

/** 断言非空并窄化(避免 non-null 断言警告) */
function nn(r: BarRegion | null): BarRegion {
  if (r === null) throw new Error('expected non-null region');
  return r;
}

// 约定:rows=24。liveTop=baseY,liveBottom=baseY+rows-1=baseY+23。
// MIN_ROWS=4, MAX_ROWS=12, PAD_ABOVE_CURSOR=3(与实现常量一致)。
describe('computeBarRegion', () => {
  it('在底部时返回 null(viewportY === baseY)', () => {
    expect(
      computeBarRegion({ baseY: 100, cursorY: 23, rows: 24, viewportY: 100 }),
    ).toBeNull();
  });

  it('内容不足一屏(baseY=0, 未滚动)返回 null', () => {
    expect(
      computeBarRegion({ baseY: 0, cursorY: 5, rows: 24, viewportY: 0 }),
    ).toBeNull();
  });

  it('光标在最底行:固定最小 MIN_ROWS=4 行', () => {
    // cursorAbs=123, liveBottom=123。min(123-3, 123-3)=120 → 4 行
    const r = nn(computeBarRegion({ baseY: 100, cursorY: 23, rows: 24, viewportY: 50 }));
    expect(r).toEqual({ top: 120, bottom: 123 });
    expect(r.bottom - r.top + 1).toBe(4);
  });

  it('光标抬高(多行输入):面板随光标长高', () => {
    // cursorY=18 → cursorAbs=118, cursorAbs-3=115; liveBottom-(MIN-1)=120 → min=115 → 9 行
    const r = nn(computeBarRegion({ baseY: 100, cursorY: 18, rows: 24, viewportY: 50 }));
    expect(r).toEqual({ top: 115, bottom: 123 });
    expect(r.bottom - r.top + 1).toBe(9);
  });

  it('光标很靠上:以 MAX_ROWS=12 封顶', () => {
    // cursorY=2 → cursorAbs=102, -3=99; 但封顶 liveBottom-(MAX-1)=123-11=112
    const r = nn(computeBarRegion({ baseY: 100, cursorY: 2, rows: 24, viewportY: 50 }));
    expect(r).toEqual({ top: 112, bottom: 123 });
    expect(r.bottom - r.top + 1).toBe(12);
  });

  it('不越过 live 区域上沿(小终端)', () => {
    // rows=5, baseY=10 → liveBottom=14, liveTop=10。cursorY=0 → cursorAbs=10,-3=7
    // min(14-3=11, 7)=7 → max(7, 14-11=3)=7 → max(7, liveTop=10)=10
    const r = nn(computeBarRegion({ baseY: 10, cursorY: 0, rows: 5, viewportY: 2 }));
    expect(r).toEqual({ top: 10, bottom: 14 });
    expect(r.top).toBeGreaterThanOrEqual(10);
  });
});
