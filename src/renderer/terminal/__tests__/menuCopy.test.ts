// @vitest-environment jsdom
// ⌘C 复制终端选区(修「选中终端内容无法复制」)。
// 背景:role:'copy' → webContents.copy() 只认 DOM 选区,而 xterm 选区画在 canvas 上,
// Chromium 判 CanCopy() 为假、连 copy 事件都不派发 → 终端 ⌘C 全程静默失败。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMenuCopy, hasDomSelection, type MenuCopyDeps } from '../menuCopy';

function mkDeps(over: Partial<MenuCopyDeps> = {}): {
  deps: MenuCopyDeps;
  writeClipboard: ReturnType<typeof vi.fn>;
  nativeCopy: ReturnType<typeof vi.fn>;
} {
  const writeClipboard = vi.fn();
  const nativeCopy = vi.fn();
  return {
    writeClipboard,
    nativeCopy,
    deps: {
      terminalSelection: () => '',
      hasDomSelection: () => false,
      writeClipboard,
      nativeCopy,
      ...over,
    },
  };
}

describe('handleMenuCopy 决策顺序', () => {
  it('终端有选区、DOM 无 → 经 clipboard 桥写终端选区(核心回归)', () => {
    const { deps, writeClipboard, nativeCopy } = mkDeps({
      terminalSelection: () => 'supply_internal_account',
    });
    expect(handleMenuCopy(deps)).toBe(true);
    expect(writeClipboard).toHaveBeenCalledWith('supply_internal_account');
    expect(nativeCopy).not.toHaveBeenCalled();
  });

  it('DOM 有选区 → 交回原生 copy,不抢输入框/文件面板的 ⌘C', () => {
    const { deps, writeClipboard, nativeCopy } = mkDeps({
      hasDomSelection: () => true,
      terminalSelection: () => '终端里也有旧选区',
    });
    expect(handleMenuCopy(deps)).toBe(false);
    expect(nativeCopy).toHaveBeenCalledTimes(1);
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('两处都无选区 → 仍交回原生 copy(不吞事件)', () => {
    const { deps, writeClipboard, nativeCopy } = mkDeps();
    expect(handleMenuCopy(deps)).toBe(false);
    expect(nativeCopy).toHaveBeenCalledTimes(1);
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('终端选区为空串不写剪贴板(不清掉用户已有剪贴板内容)', () => {
    const { deps, writeClipboard } = mkDeps({ terminalSelection: () => '' });
    handleMenuCopy(deps);
    expect(writeClipboard).not.toHaveBeenCalled();
  });
});

describe('hasDomSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  it('无选区 → false', () => {
    expect(hasDomSelection(document)).toBe(false);
  });

  it('普通 DOM 文本选区 → true', () => {
    const p = document.createElement('p');
    p.textContent = 'hello world';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection()?.addRange(range);
    expect(hasDomSelection(document)).toBe(true);
  });

  it('input 内部选区 → true(不出现在 window.getSelection 里,必须单独看)', () => {
    const input = document.createElement('input');
    input.value = 'abcdef';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(1, 4);
    expect(hasDomSelection(document)).toBe(true);
  });

  it('textarea 内部选区 → true', () => {
    const ta = document.createElement('textarea');
    ta.value = 'abcdef';
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, 6);
    expect(hasDomSelection(document)).toBe(true);
  });

  it('input 聚焦但光标折叠(未选中)→ false,⌘C 该归终端选区', () => {
    const input = document.createElement('input');
    input.value = 'abcdef';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(3, 3);
    expect(hasDomSelection(document)).toBe(false);
  });
});
