// 壳窗(弹出的浏览器窗格窗口)关闭决策(用户指令 2026-07-23):红灯钮 = 直接关闭
// 浏览器(主窗镜像清空,不回落开面板);多标签先弹确认框。回落只走「收回面板」按钮
// 的显式路径(browserPane:dock)。纯函数模块(零 Electron import),main.ts 的
// close/closed 事件据此分支。

import { t } from '../shared/i18n';

/** 壳窗种子里的窗格快照 → 标签数(负载来自 renderer 上报,防御性收窄) */
export function paneTabCount(pane: unknown): number {
  const tabs = (pane as { tabs?: unknown } | null | undefined)?.tabs;
  return Array.isArray(tabs) ? tabs.length : 0;
}

export type PaneCloseAction =
  /** 放行关闭(closed 里按 dockRequested 路由通知) */
  | 'proceed'
  /** 拦下,弹「关闭所有标签」确认框 */
  | 'confirm'
  /** 拦下且不再弹(确认框已在挂,防重复弹框) */
  | 'ignore';

export function decidePaneClose(opts: {
  /** app 正在退出:不拦不清(镜像已持久化,重启后按面板形态还原) */
  quitting: boolean;
  /** 冒烟/无头:永不弹框 */
  bypass: boolean;
  /** 本次关闭由回落发起(browserPane:dock)——保留标签,无需确认 */
  dockRequested: boolean;
  /** 确认框已点「全部关闭」,二次 close() 放行 */
  confirmed: boolean;
  /** 确认框正在挂 */
  confirming: boolean;
  tabCount: number;
}): PaneCloseAction {
  if (opts.quitting || opts.bypass || opts.dockRequested || opts.confirmed) {
    return 'proceed';
  }
  if (opts.confirming) return 'ignore';
  return opts.tabCount > 1 ? 'confirm' : 'proceed';
}

/** closed 后给主窗的通知:回落 = docked(保留镜像、开面板);直接关 = closed(清空
 *  窗格);退出中 = null(不通知——镜像要原样持久化,清了重启就丢标签) */
export function paneClosedNotice(opts: {
  dockRequested: boolean;
  quitting: boolean;
}): 'browserPane:docked' | 'browserPane:closed' | null {
  if (opts.quitting) return null;
  return opts.dockRequested ? 'browserPane:docked' : 'browserPane:closed';
}

export interface PaneCloseConfirmationOptions {
  type: 'warning';
  title: string;
  message: string;
  buttons: [string, string];
  defaultId: 0;
  cancelId: 0;
  noLink: true;
}

/** buttons 里「全部关闭」的下标(showMessageBox response 与之比对) */
export const PANE_CLOSE_CONFIRM_INDEX = 1;

export function buildPaneCloseConfirmationOptions(
  tabCount: number,
): PaneCloseConfirmationOptions {
  return {
    type: 'warning',
    title: t('Close all browser tabs?'),
    message: t(
      'This window has {count} browser tabs open. Closing it closes them all — use "Dock back" to keep them in the panel.',
      { count: tabCount },
    ),
    buttons: [t('Cancel'), t('Close All')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}
