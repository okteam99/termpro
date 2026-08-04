import './WorkspaceEditModal.css';
import { useState } from 'react';
import { t } from '../../shared/i18n';
import { useAppStore } from '../state/store';
import { relayProfileToPoppedPanes } from '../services/browserPaneRelay';
import { DEFAULT_PROFILE_ID } from '../../shared/browserProfile';

interface WorkspaceEditModalProps {
  workspace: { id: string; name: string; browserProfileId?: string };
  onClose: () => void;
  /** 覆盖保存行为(壳窗:本地立即换分区 + IPC 转主窗权威 store);缺省走本窗 store */
  onSave?: (result: { name: string; profileId: string }) => void;
}

/** 工作区编辑弹层:改名 + 选择浏览器 profile。Enter 保存,Esc / 点遮罩 / 取消 关闭。
 *  保存逻辑内聚于此(RenameModal 只管改名,本弹层多一个字段,不复用它)。 */
export function WorkspaceEditModal({ workspace, onClose, onSave }: WorkspaceEditModalProps) {
  const profiles = useAppStore((s) => s.browserProfiles);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const setWorkspaceBrowserProfile = useAppStore((s) => s.setWorkspaceBrowserProfile);

  const [name, setName] = useState(workspace.name);
  const [profileId, setProfileId] = useState<string>(() => {
    const wanted = workspace.browserProfileId ?? DEFAULT_PROFILE_ID;
    // 竞态兜底:绑定的 profile 已被删(store 对账通常已剥离,这里双保险)→ 按内置显示
    if (wanted !== DEFAULT_PROFILE_ID && !profiles.some((p) => p.id === wanted)) {
      return DEFAULT_PROFILE_ID;
    }
    return wanted;
  });

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (onSave) {
      onSave({ name: trimmed, profileId });
      onClose();
      return;
    }
    if (trimmed !== workspace.name) {
      void renameWorkspace(workspace.id, trimmed);
    }
    const currentProfileId = workspace.browserProfileId ?? DEFAULT_PROFILE_ID;
    if (profileId !== currentProfileId) {
      setWorkspaceBrowserProfile(workspace.id, profileId);
      // 该 ws 已弹出的壳窗同步换绑(壳窗 store 独立,不推就一直用旧分区浏览)
      relayProfileToPoppedPanes(workspace.id, profileId);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
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
      className="workspace-edit-modal__backdrop"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onMouseDown={handleBackdropClick}
    >
      <div
        className="workspace-edit-modal__card"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="workspace-edit-modal__title">{t('Edit Project')}</div>

        <div className="workspace-edit-modal__field">
          <label className="workspace-edit-modal__label" htmlFor="workspace-edit-modal-name">
            {t('Name')}
          </label>
          <input
            id="workspace-edit-modal-name"
            className="workspace-edit-modal__input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </div>

        <div className="workspace-edit-modal__field">
          <label className="workspace-edit-modal__label" htmlFor="workspace-edit-modal-profile">
            {t('Browser profile')}
          </label>
          <select
            id="workspace-edit-modal-profile"
            className="workspace-edit-modal__select"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value={DEFAULT_PROFILE_ID}>{t('OkWork (built-in)')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <span className="workspace-edit-modal__hint">
            {t(
              'Profiles have isolated cookies and storage. Switching reloads this project’s browser tabs.',
            )}
          </span>
        </div>

        <div className="workspace-edit-modal__actions">
          <button className="workspace-edit-modal__cancel" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="workspace-edit-modal__save"
            disabled={!name.trim()}
            onClick={handleSave}
          >
            {t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
