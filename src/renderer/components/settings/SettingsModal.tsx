// 设置弹层的共用骨架(用户指令 2026-07-20):Settings 菜单里的设置项不再行内展开,
// 一律点开独立 modal。本文件出骨架 + 单选行,具体弹层(浏览器设置 / 语言)只写选项。
//
// 交互对齐既有 AboutModal / RemoteHostsPage:backdrop + card + Esc/遮罩/× 关闭;
// 焦点归还由挂载方(SettingsEntry)负责。选项即时生效,无保存按钮。

import { useEffect, useId, type ReactNode } from 'react';
import './SettingsModal.css';
import { t } from '../../../shared/i18n';

interface SettingsModalProps {
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
}

export function SettingsModal({ title, subtitle, onClose, children }: SettingsModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="settings-modal__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-modal__card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-modal__header">
          <div>
            <div className="settings-modal__title">{title}</div>
            {subtitle && <div className="settings-modal__subtitle">{subtitle}</div>}
          </div>
          <button className="settings-modal__close" onClick={onClose} title={t('Close')}>
            ×
          </button>
        </div>
        <div className="settings-modal__body">{children}</div>
      </div>
    </div>
  );
}

/** 一个设置项 = 一组单选;标题经 useId 关联 radiogroup(读屏能报出组名) */
export function SettingsOptionGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="settings-modal__group">
      <div className="settings-modal__group-title" id={titleId}>
        {title}
      </div>
      <div className="settings-modal__opts" role="radiogroup" aria-labelledby={titleId}>
        {children}
      </div>
    </div>
  );
}

export function SettingsOptionRow({
  selected,
  label,
  desc,
  onSelect,
}: {
  selected: boolean;
  label: string;
  desc?: string;
  onSelect(): void;
}) {
  return (
    <button
      className={`settings-modal__opt${selected ? ' settings-modal__opt--selected' : ''}`}
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className="settings-modal__opt-check" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
      <span className="settings-modal__opt-text">
        <span className="settings-modal__opt-label">{label}</span>
        {desc && <span className="settings-modal__opt-desc">{desc}</span>}
      </span>
    </button>
  );
}
