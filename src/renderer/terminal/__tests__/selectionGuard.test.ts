// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSelectionGuard } from '../selectionGuard';

/**
 * 这些用例只验证守卫「何时向 document 合成 mouseup」的决策,不依赖真实 xterm。
 * 合成的 mouseup 派发在 document 上(bubbles:true),故 document 级监听只会收到
 * 守卫合成的那一发;测试事件统一派发在 window 上,不会污染计数。
 */
describe('selectionGuard', () => {
  let dispose: () => void;
  let synthetic: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    synthetic = vi.fn();
    document.addEventListener('mouseup', synthetic);
    dispose = installSelectionGuard(window);
  });

  afterEach(() => {
    dispose();
    document.removeEventListener('mouseup', synthetic);
  });

  const down = (button: number) =>
    window.dispatchEvent(new MouseEvent('mousedown', { button }));
  const move = (buttons: number) =>
    window.dispatchEvent(new MouseEvent('mousemove', { buttons }));
  const up = () => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  const blur = () => window.dispatchEvent(new Event('blur'));

  it('左键按下后丢失 mouseup,再无按键移动 → 合成一发 mouseup 收尾', () => {
    down(0);
    move(0); // 松开事件丢了:仍在拖拽态却无按键
    expect(synthetic).toHaveBeenCalledTimes(1);
  });

  it('正常拖拽中(按键仍按住)不合成', () => {
    down(0);
    move(1);
    move(1);
    expect(synthetic).not.toHaveBeenCalled();
  });

  it('正常松开后移动不合成(已退出拖拽态)', () => {
    down(0);
    move(1);
    up();
    move(0);
    move(0);
    expect(synthetic).not.toHaveBeenCalled();
  });

  it('拖拽中途窗口失焦 → 立即合成收尾', () => {
    down(0);
    blur();
    expect(synthetic).toHaveBeenCalledTimes(1);
  });

  it('非拖拽态失焦不合成', () => {
    blur();
    expect(synthetic).not.toHaveBeenCalled();
  });

  it('右键按下不进入拖拽态,后续无按键移动不合成', () => {
    down(2);
    move(0);
    expect(synthetic).not.toHaveBeenCalled();
  });

  it('收尾后只发一发,后续无按键移动不再重复合成', () => {
    down(0);
    move(0); // 第一发
    move(0); // 已退出拖拽态,不再合成
    move(0);
    expect(synthetic).toHaveBeenCalledTimes(1);
  });
});
