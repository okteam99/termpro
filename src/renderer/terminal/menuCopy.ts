/**
 * ⌘C 复制终端选区(修 2026-07「选中终端内容无法复制」)。
 *
 * 为什么非得自己接:应用菜单用的是 Electron `role: 'editMenu'`,其 Copy 项 = `role: 'copy'`
 * = `webContents.copy()` = Chromium 的 Copy 编辑命令,**只认 DOM 选区**。而 xterm 的选区
 * 画在 canvas 上(mousedown 被 preventDefault,压根不产生 DOM 选区),Chromium 判
 * `CanCopy()` 为假 → 命令不执行 → 连 `copy` DOM 事件都不派发,xterm 自己那个「copy 事件里
 * 用 getSelection 填 clipboardData」的兜底也就永远轮不到。于是终端选区 ⌘C 全程静默失败,
 * 只有右键菜单能复制(它直接读 term.getSelection())。与本地/远程无关——复制路径上没有
 * 任何 host 分支,远程只是用户碰上它的地方。
 *
 * 决策顺序(DOM 优先,终端兜第二,原生兜底):
 *  ① DOM 里有选区(文件面板文本 / 设置输入框 / 地址栏)→ 交回原生 copy,保持系统行为;
 *  ② 否则活动 tab 的终端有选区 → 经 clipboard 桥直接写;
 *  ③ 都没有 → 仍交回原生 copy(不吞事件,让浏览器决定什么都不做)。
 */

export interface MenuCopyDeps {
  /** 活动 tab 的终端选区文本(无则 ''),见 terminalRegistry.getTerminalSelection */
  terminalSelection(): string;
  /** 写系统剪贴板(经 preload → main 的 clipboard 桥) */
  writeClipboard(text: string): void;
  /** 交回 Chromium 原生 Copy 编辑命令(webContents.copy) */
  nativeCopy(): void;
  /** 当前 DOM 是否存在非空文本选区(含 input/textarea 内部选区) */
  hasDomSelection(): boolean;
}

/** 处理一次菜单 copy 动作;返回是否由终端选区满足(便于测试与埋点)。 */
export function handleMenuCopy(deps: MenuCopyDeps): boolean {
  if (deps.hasDomSelection()) {
    deps.nativeCopy();
    return false;
  }
  const text = deps.terminalSelection();
  if (text) {
    deps.writeClipboard(text);
    return true;
  }
  deps.nativeCopy();
  return false;
}

/**
 * DOM 是否有非空文本选区。
 * 🔴 必须单独看 input/textarea:它们内部的选区不出现在 window.getSelection() 里
 * (Chromium 对 text control 的选区独立记账),漏判会把输入框里的 ⌘C 抢给终端选区。
 */
export function hasDomSelection(doc: Document = document): boolean {
  const el = doc.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd } = el;
    if (
      selectionStart !== null &&
      selectionEnd !== null &&
      selectionEnd > selectionStart
    ) {
      return true;
    }
  }
  return (doc.defaultView?.getSelection()?.toString() ?? '') !== '';
}
