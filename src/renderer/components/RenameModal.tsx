import './RenameModal.css';
import { useRef, useState } from 'react';
import { t } from '../../shared/i18n';

interface RenameModalProps {
  title: string;
  initialValue: string;
  placeholder?: string;
  /** true 时允许保存空值(由调用方解释,如「清除自定义名」) */
  allowEmpty?: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
}

/** 通用重命名弹层:Enter 保存,Esc / 点遮罩 / 取消 关闭 */
export function RenameModal({
  title,
  initialValue,
  placeholder,
  allowEmpty = false,
  onSave,
  onClose,
}: RenameModalProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSave() {
    const trimmed = value.trim();
    if (trimmed || allowEmpty) onSave(trimmed);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="rename-modal-backdrop"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onMouseDown={handleBackdropClick}
    >
      <div
        className="rename-modal-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="rename-modal-title">{title}</div>
        <input
          ref={inputRef}
          className="rename-modal-input"
          value={value}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={handleKeyDown}
        />
        <div className="rename-modal-actions">
          <button className="rename-modal-cancel" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="rename-modal-save" onClick={handleSave}>
            {t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
