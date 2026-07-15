import './OkworkSkillBanner.css';
import { useEffect, useState } from 'react';
import { selectActiveWorkspace, useAppStore } from '../state/store';
import { hostRegistry } from '../services/hostRegistry';
import { t } from '../../shared/i18n';
import {
  OKWORK_SKILL_MD,
  OKWORK_SKILL_NAME,
  OKWORK_SKILL_VERSION,
} from '../../shared/okworkSkill';
import {
  computeSkillPromptAction,
  isSkillPromptSnoozed,
  snoozeSkillPrompt,
} from '../services/okworkSkillPrompt';

/**
 * OkWork 会话内技能横条(阶段3):探测当前机器 agent 是否装了 okwork 技能,未装/可更新时
 * 在终端区顶部显示一条可关闭横条,点一下安装/更新;× 关闭按机器 snooze 24h。
 * 旧 host(无 skill.status RPC)探测失败 → 静默不显示(该远程更新 host bundle 后自然出现)。
 */
export function OkworkSkillBanner() {
  const activeWs = useAppStore(selectActiveWorkspace);
  const hostId = activeWs?.hostId ?? null;
  const [action, setAction] = useState<'install' | 'update' | null>(null);
  const [snoozed, setSnoozed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setBusy(false);
    if (!hostId) {
      setAction(null);
      return;
    }
    setSnoozed(isSkillPromptSnoozed(hostId));
    let cancelled = false;
    void hostRegistry
      .forWorkspace({ hostId })
      .rpc('skill.status', { name: OKWORK_SKILL_NAME })
      .then((s) => {
        if (!cancelled) setAction(computeSkillPromptAction(s, OKWORK_SKILL_VERSION));
      })
      .catch(() => {
        if (!cancelled) setAction(null); // 旧 host 无此 RPC / 断线 → 不打扰
      });
    return () => {
      cancelled = true;
    };
  }, [hostId]);

  if (!hostId || !action || snoozed) return null;

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await hostRegistry
        .forWorkspace({ hostId })
        .rpc('skill.install', { name: OKWORK_SKILL_NAME, content: OKWORK_SKILL_MD });
      setAction(computeSkillPromptAction(s, OKWORK_SKILL_VERSION));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    snoozeSkillPrompt(hostId);
    setSnoozed(true);
  };

  const label =
    action === 'install'
      ? t('Install the okwork skill to let the AI operate the built-in browser')
      : t('An update to the okwork skill is available');
  const btn = action === 'install' ? t('Install') : t('Update');

  return (
    <div className="okwork-skill-banner" role="status" aria-live="polite">
      <span className="okwork-skill-banner__icon" aria-hidden="true">
        ✨
      </span>
      <span className="okwork-skill-banner__text">{error ?? label}</span>
      <button
        className="okwork-skill-banner__action"
        onClick={install}
        disabled={busy}
      >
        {busy ? t('Installing…') : error ? t('Retry') : btn}
      </button>
      <button
        className="okwork-skill-banner__close"
        onClick={dismiss}
        aria-label={t('Dismiss')}
        title={t('Hide for 24 hours')}
      >
        ×
      </button>
    </div>
  );
}
