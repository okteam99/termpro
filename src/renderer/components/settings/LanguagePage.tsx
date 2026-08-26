// 语言设置弹层(用户指令 2026-07-20):原本是 Settings 菜单里的行内三选,
// 与浏览器设置一起统一改为独立 modal。骨架/单选行见 SettingsModal.tsx。
//
// 语言名以本族语显示,有意不译;选中即时换语言(store.setLocalePref 顺带通知 main
// 切原生菜单/dialog),弹层不关——让用户当场看到界面文案变化。

import { t } from '../../../shared/i18n';
import type { LocalePref } from '../../../shared/i18n';
import { useAppStore } from '../../state/store';
import { SettingsModal, SettingsOptionGroup, SettingsOptionRow } from './SettingsModal';

const LOCALE_OPTIONS: { pref: LocalePref; label(): string; desc?(): string }[] = [
  { pref: 'system', label: () => t('System'), desc: () => t('Follow the system language.') },
  { pref: 'en', label: () => 'English' },
  { pref: 'zh-CN', label: () => '简体中文' },
];

export function LanguagePage({
  onClose,
  embedded = false,
}: {
  onClose(): void;
  embedded?: boolean;
}) {
  const localePref = useAppStore((s) => s.localePref);
  const setLocalePref = useAppStore((s) => s.setLocalePref);

  return (
    <SettingsModal title={t('Language')} onClose={onClose} embedded={embedded}>
      <SettingsOptionGroup title={t('Interface language')}>
        {LOCALE_OPTIONS.map((o) => (
          <SettingsOptionRow
            key={o.pref}
            selected={o.pref === localePref}
            label={o.label()}
            desc={o.desc?.()}
            onSelect={() => setLocalePref(o.pref)}
          />
        ))}
      </SettingsOptionGroup>
    </SettingsModal>
  );
}

export default LanguagePage;
