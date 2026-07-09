import './TransientToast.css';
import { useEffect } from 'react';
import { useAppStore } from '../state/store';

/**
 * 极简一次性轻量提示(D-1 / AC-4):读 store.transientNotice 渲染横幅,
 * setTimeout 自动消失。刻意无 NotificationItem 语义 —— 无 id/tabId/read/历史/点击导航,
 * 语义 = workspace 级瞬时事件(CRUD 失败 / 迁移连续失败),装不进 tab 作用域通知模型。
 */
const AUTO_DISMISS_MS = 5000;

export function TransientToast() {
  const notice = useAppStore((s) => s.transientNotice);
  const setTransientNotice = useAppStore((s) => s.setTransientNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setTransientNotice(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [notice, setTransientNotice]);

  if (!notice) return null;
  return (
    <div className="transient-toast" role="status" aria-live="polite">
      {notice}
    </div>
  );
}
