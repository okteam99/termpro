// 浏览器设置弹层(用户指令 2026-07-20):把原来挂在 Settings 菜单里的「链接打开方式」
// 提出来,和新增的「内置浏览器默认打开方式」一起放进独立 modal——设置项会继续长,
// 左下角菜单不再承担设置面板的职责。骨架/单选行见 SettingsModal.tsx。

import { t } from '../../../shared/i18n';
import { useAppStore } from '../../state/store';
import type { BuiltinBrowserSurface, LinkBrowserMode } from '../../state/store';
import { SettingsModal, SettingsOptionGroup, SettingsOptionRow } from './SettingsModal';

// label/desc 用函数:t() 须在 render 期取词,模块级常量会被冻结在导入期语言
const LINK_MODE_OPTIONS: {
  mode: LinkBrowserMode;
  label(): string;
  desc(): string;
}[] = [
  {
    mode: 'builtin',
    label: () => t('Built-in browser'),
    desc: () => t('Terminal links open in OkWork’s own browser.'),
  },
  {
    mode: 'system',
    label: () => t('System browser'),
    desc: () => t('Terminal links open in your default browser.'),
  },
  {
    mode: 'builtinForRemote',
    label: () => t('Built-in for remote terminals only'),
    desc: () =>
      t(
        'Remote terminals use the built-in browser (localhost URLs are only reachable through it); local terminals use the system browser.',
      ),
  },
];

const SURFACE_OPTIONS: {
  surface: BuiltinBrowserSurface;
  label(): string;
  desc(): string;
}[] = [
  {
    surface: 'window',
    label: () => t('Separate window'),
    desc: () => t('The built-in browser opens as its own OkBrowser window.'),
  },
  {
    surface: 'pane',
    label: () => t('In the app panel'),
    desc: () => t('The built-in browser opens in the panel on the right of the main window.'),
  },
];

export function BrowserSettingsPage({ onClose }: { onClose(): void }) {
  const linkBrowserMode = useAppStore((s) => s.linkBrowserMode);
  const setLinkBrowserMode = useAppStore((s) => s.setLinkBrowserMode);
  const builtinBrowserSurface = useAppStore((s) => s.builtinBrowserSurface);
  const setBuiltinBrowserSurface = useAppStore((s) => s.setBuiltinBrowserSurface);

  return (
    <SettingsModal
      title={t('Browser Settings')}
      subtitle={t('⌘/Ctrl+click a terminal link always opens the system browser.')}
      onClose={onClose}
    >
      <SettingsOptionGroup title={t('Open links in')}>
        {LINK_MODE_OPTIONS.map((o) => (
          <SettingsOptionRow
            key={o.mode}
            selected={o.mode === linkBrowserMode}
            label={o.label()}
            desc={o.desc()}
            onSelect={() => setLinkBrowserMode(o.mode)}
          />
        ))}
      </SettingsOptionGroup>

      <SettingsOptionGroup title={t('Open the built-in browser in')}>
        {SURFACE_OPTIONS.map((o) => (
          <SettingsOptionRow
            key={o.surface}
            selected={o.surface === builtinBrowserSurface}
            label={o.label()}
            desc={o.desc()}
            onSelect={() => setBuiltinBrowserSurface(o.surface)}
          />
        ))}
      </SettingsOptionGroup>
    </SettingsModal>
  );
}

export default BrowserSettingsPage;
