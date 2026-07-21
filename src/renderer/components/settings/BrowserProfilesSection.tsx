// 浏览器 Profile 管理区块(BrowserSettingsPage 追加区块 · 用户指令 2026-07-21):
// 展示内置默认 profile(虚拟实体,恒在列表首行,无编辑/删除)+ 自定义 profile 列表,
// 支持增/改/删。列表数据来自 store 镜像(profilesSync 服务已订阅 main 的
// browserProfile:changed 推送,增删改后自动刷新,本组件无需手动 list()/refresh)。

import { useState, type KeyboardEvent } from 'react';
import './BrowserProfilesSection.css';
import { t } from '../../../shared/i18n';
import { useAppStore } from '../../state/store';
import { randomUserAgent } from './randomUserAgent';
import type { BrowserProfile } from '../../../shared/browserProfile';

interface FormValues {
  name: string;
  userAgent: string;
}

const EMPTY_FORM: FormValues = { name: '', userAgent: '' };

export function BrowserProfilesSection() {
  const profiles = useAppStore((s) => s.browserProfiles);

  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  // save IPC 失败的表单内呈现(不关表单,对齐 RemoteHostsPage 的既有约定)
  const [formError, setFormError] = useState<string | null>(null);

  function openAddForm() {
    setFormMode('add');
    setFormId(null);
    setFormValues(EMPTY_FORM);
    setFormError(null);
  }

  function openEditForm(profile: BrowserProfile) {
    setFormMode('edit');
    setFormId(profile.id);
    setFormValues({ name: profile.name, userAgent: profile.userAgent ?? '' });
    setFormError(null);
  }

  function cancelForm() {
    setFormMode(null);
    setFormId(null);
    setFormError(null);
  }

  async function saveForm() {
    const name = formValues.name.trim();
    if (!name) return;
    try {
      await window.okwork?.browserProfile?.save?.({
        id: formId ?? undefined,
        name,
        userAgent: formValues.userAgent.trim() || undefined,
      });
    } catch (err) {
      setFormError(String((err as { message?: unknown } | undefined)?.message ?? err));
      return;
    }
    setFormMode(null);
    setFormId(null);
    setFormError(null);
  }

  async function handleDelete(profile: BrowserProfile) {
    const ok = window.confirm(
      t('Delete profile "{name}"? Its cookies, logins and cache on this device will be cleared.', {
        name: profile.name,
      }),
    );
    if (!ok) return;
    await window.okwork?.browserProfile?.delete?.({ id: profile.id });
  }

  // Esc 只关本表单——SettingsModal 骨架在 document 上监听 Escape 关整个弹层,
  // stopPropagation 拦住冒泡即可(React 17+ 事件委托挂在根容器,原生 stopPropagation
  // 会在冒泡抵达 document 前截停)。
  function onFormKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancelForm();
    } else if (e.key === 'Enter') {
      saveForm();
    }
  }

  return (
    <div className="browser-profiles">
      <div className="browser-profiles__title">{t('Browser profiles')}</div>
      <div className="browser-profiles__desc">
        {t(
          'Each profile has isolated cookies, storage and an optional custom User-Agent. Workspaces choose a profile in their edit dialog.',
        )}
      </div>

      <div className="browser-profiles__list">
        <div className="browser-profiles__row">
          <span className="browser-profiles__name">{t('OkWork (built-in)')}</span>
          <span className="browser-profiles__badge">{t('Built-in')}</span>
          <span className="browser-profiles__row-desc">
            {t('Shared default storage · system User-Agent')}
          </span>
        </div>
        {profiles.map((profile) => (
          <div key={profile.id} className="browser-profiles__row">
            <span className="browser-profiles__name">{profile.name}</span>
            <span className="browser-profiles__row-desc">
              {profile.userAgent || t('System default User-Agent')}
            </span>
            <span className="browser-profiles__row-actions">
              <button
                className="browser-profiles__action"
                onClick={() => openEditForm(profile)}
              >
                {t('Edit')}
              </button>
              <button
                className="browser-profiles__action browser-profiles__action--danger"
                onClick={() => handleDelete(profile)}
              >
                {t('Delete')}
              </button>
            </span>
          </div>
        ))}
      </div>

      {formMode ? (
        <div className="browser-profiles__form" onKeyDown={onFormKeyDown}>
          <label className="browser-profiles__field">
            <input
              autoFocus
              value={formValues.name}
              onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
              placeholder={t('Profile name')}
            />
          </label>
          <label className="browser-profiles__field">
            <span className="browser-profiles__ua-row">
              <input
                value={formValues.userAgent}
                onChange={(e) => setFormValues({ ...formValues, userAgent: e.target.value })}
                placeholder={t('System default User-Agent')}
              />
              <button
                type="button"
                className="browser-profiles__btn"
                title={t('Generate a random User-Agent')}
                onClick={() =>
                  setFormValues({ ...formValues, userAgent: randomUserAgent() })
                }
              >
                🎲 {t('Random')}
              </button>
            </span>
          </label>
          {formError && (
            <div className="browser-profiles__form-error" role="alert">
              ✗ {formError}
            </div>
          )}
          <div className="browser-profiles__form-actions">
            <button className="browser-profiles__btn" onClick={cancelForm}>
              {t('Cancel')}
            </button>
            <button
              className="browser-profiles__btn browser-profiles__btn--primary"
              disabled={!formValues.name.trim()}
              onClick={saveForm}
            >
              {t('Save')}
            </button>
          </div>
        </div>
      ) : (
        <button className="browser-profiles__add-btn" onClick={openAddForm}>
          + {t('New profile')}
        </button>
      )}
    </div>
  );
}

export default BrowserProfilesSection;
