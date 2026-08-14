// @vitest-environment jsdom
// 密码胶囊(用户指令 2026-08-14:地址栏下方那一叠常驻横幅太多太乱)。
// 要点:平时只有一枚 🔑(状态=颜色点),详情点开才看;需要动手的状态点亮胶囊;
// 🔴 横幅撤了但播报不能撤——状态仍进 live region(danger 用 assertive)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PasswordChip, chipTone, continuityRow } from '../PasswordChip';

afterEach(cleanup);

const openChip = () =>
  fireEvent.click(screen.getByRole('button', { name: /Password storage|filled|Sign-in failed|unavailable|disabled|selected|updated|confirm/i }));

describe('chipTone', () => {
  const s = (tone: 'positive' | 'warning' | 'danger') => ({
    icon: '!',
    title: 't',
    detail: 'd',
    tone,
  });
  it('密码状态优先决定色调', () => {
    expect(chipTone(s('danger'), { tone: 'warning' })).toBe('danger');
    expect(chipTone(s('positive'), null)).toBe('positive');
  });
  it('无密码状态时:只有需要注意的连续性才点亮,成功/进行中不点', () => {
    expect(chipTone(null, { tone: 'warning' })).toBe('warning');
    expect(chipTone(null, { tone: 'danger' })).toBe('danger');
    expect(chipTone(null, { tone: 'positive' })).toBe('neutral');
    expect(chipTone(null, { tone: 'neutral' })).toBe('neutral');
    expect(chipTone(null, null)).toBe('neutral');
  });
});

describe('continuityRow', () => {
  it('not_available / undefined → 不出行', () => {
    expect(continuityRow(undefined)).toBeNull();
    expect(continuityRow('not_available')).toBeNull();
  });
  it('需要动手的状态 → warning;成功/进行中 → 不点亮的信息态', () => {
    expect(continuityRow('paused')?.tone).toBe('warning');
    expect(continuityRow('moved')?.tone).toBe('warning');
    expect(continuityRow('host_upgrade')?.tone).toBe('warning');
    expect(continuityRow('attention')?.tone).toBe('warning');
    expect(continuityRow('synced')?.tone).toBe('positive');
    expect(continuityRow('hydrating')?.tone).toBe('neutral');
    expect(continuityRow('syncing')?.tone).toBe('neutral');
  });
});

describe('PasswordChip · 平时不占地方', () => {
  it('idle:只有一枚按钮,详情文案不在页面上', () => {
    render(<PasswordChip status={{ kind: 'idle' }} storageLabel="This device" />);
    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.queryByText(/Password storage: This device/)).toBeNull();
    expect(document.querySelector('.password-chip__popover')).toBeNull();
    // 中性态不挂状态点
    expect(document.querySelector('.password-chip__dot')).toBeNull();
  });

  it('点开 → 弹层给出状态 + 保险箱位置;再点外部关闭', () => {
    render(
      <PasswordChip
        status={{ kind: 'auth_failed' }}
        storageLabel="This device"
      />,
    );
    openChip();
    expect(screen.getByText('Sign-in failed · saved password unchanged')).toBeTruthy();
    expect(screen.getByText(/Password storage: This device/)).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.password-chip__popover')).toBeNull();
  });

  it('Esc 关闭弹层', () => {
    render(<PasswordChip status={{ kind: 'idle' }} />);
    openChip();
    expect(document.querySelector('.password-chip__popover')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.password-chip__popover')).toBeNull();
  });
});

describe('PasswordChip · 状态表达与播报', () => {
  it('登录失败 → 红点 + assertive 播报(横幅没了,读屏不能也没了)', () => {
    render(<PasswordChip status={{ kind: 'auth_failed' }} />);
    expect(document.querySelector('.password-chip__dot--danger')).toBeTruthy();
    const live = document.querySelector('.password-chip__live');
    expect(live?.getAttribute('aria-live')).toBe('assertive');
    expect(live?.textContent).toContain('Sign-in failed');
  });

  it('填充成功 → 正向点 + polite 播报', () => {
    render(
      <PasswordChip
        status={{ kind: 'filled', selectedUsername: 'liam' }}
        profileName="Default"
      />,
    );
    expect(document.querySelector('.password-chip__dot--positive')).toBeTruthy();
    expect(
      document.querySelector('.password-chip__live')?.getAttribute('aria-live'),
    ).toBe('polite');
  });

  it('连续性需要注意(无密码状态)→ 胶囊点亮 warning,文案在弹层里', () => {
    render(
      <PasswordChip
        status={{ kind: 'idle' }}
        continuity={continuityRow('paused')}
      />,
    );
    expect(document.querySelector('.password-chip__dot--warning')).toBeTruthy();
    expect(screen.queryByText('Login continuity is paused')).toBeNull();
    openChip();
    expect(screen.getByText('Login continuity is paused')).toBeTruthy();
  });

  it('多账号 → 弹层给「切换账号」,点了即收起并回调', () => {
    const onChooseAccount = vi.fn();
    render(
      <PasswordChip
        status={{ kind: 'multiple', usernames: ['a', 'b'], selectedUsername: 'a' }}
        onChooseAccount={onChooseAccount}
      />,
    );
    openChip();
    fireEvent.click(screen.getByText('Switch account'));
    expect(onChooseAccount).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.password-chip__popover')).toBeNull();
  });
});
