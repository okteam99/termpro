import './OkworkSkillBanner.css';
import { useEffect, useRef, useState } from 'react';
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
  // 当前生效 hostId(异步回调落地前比对,防跨机 setState 串味 · 评审 P3)
  const currentHost = useRef<string | null>(hostId);
  currentHost.current = hostId;

  useEffect(() => {
    setError(null);
    setBusy(false);
    setAction(null);
    if (!hostId) return;
    setSnoozed(isSkillPromptSnoozed(hostId));
    // 🔴 forHostId(定向路由,未命中→null 绝不兜底 local):探测/安装都必须打到【本机器】,
    // 不能像读展示那样 miss 回落 local(否则把本地状态当远程报、甚至把技能装错机器 · 评审 P2)
    const client = hostRegistry.forHostId(hostId);
    if (!client) return; // 该机器未连/断线 → 不显示(不臆测)
    let cancelled = false;
    void client
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
    const myHost = hostId;
    const client = hostRegistry.forHostId(myHost);
    if (!client) {
      setError(t('Target machine is not connected'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await client.rpc('skill.install', {
        name: OKWORK_SKILL_NAME,
        content: OKWORK_SKILL_MD,
      });
      if (currentHost.current !== myHost) return; // 期间切走了机器,别把结果写到别人横条
      setAction(computeSkillPromptAction(s, OKWORK_SKILL_VERSION));
      // 已跑的 agent 不会中途重扫 skills 目录——提示重启才生效(下次 agent 启动即见)
      useAppStore
        .getState()
        .setTransientNotice(t('okwork skill installed · restart the agent (or start a new one) to use it'));
    } catch (e) {
      if (currentHost.current === myHost) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (currentHost.current === myHost) setBusy(false);
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
