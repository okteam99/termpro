// @vitest-environment jsdom
// OKWORK-F260805033051: Sidebar CSS invariants for connection controls
// Verifies that focus-visible and auto-margin rules are properly defined

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function readCssFile(): string {
  // 相对于此测试文件,向上找 Sidebar.css
  const cssPath = join(__dirname, '..', 'Sidebar.css');
  return readFileSync(cssPath, 'utf-8');
}

describe('Sidebar CSS Invariants', () => {
  describe('T-026｜focus-visible 规则 for connection icons', () => {
    it('应存在命中 .sidebar-machine-ctl 的 :focus-visible 规则且声明 outline', () => {
      const css = readCssFile();

      // 查找 .sidebar-machine-ctl:focus-visible 的选择器块
      const focusVisibleRegex = /\.sidebar-machine-ctl:focus-visible\s*{([^}]*)}/;
      const match = css.match(focusVisibleRegex);

      expect(match).toBeTruthy();

      // 确认规则块内包含 outline 声明
      const ruleBlock = match?.[1] ?? '';
      expect(ruleBlock).toMatch(/outline\s*:/);
    });
  });

  describe('T-036｜connected 态三元素 auto-margin 判据', () => {
    it('RTT 和 ctl 应被纳入右推组(margin-left: auto)', () => {
      const css = readCssFile();

      // 查找右推组规则（应包含 .sidebar-machine-rtt 和 .sidebar-machine-ctl）
      // 现有规则可能是:
      // .sidebar-machine-header > .sidebar-machine-rtt,
      // .sidebar-machine-header > .sidebar-machine-ctl { margin-left: auto; }
      // 或其它等价形式
      const autoMarginRegex = /\.sidebar-machine-header\s*>\s*\.sidebar-machine-rtt[^{]*{[^}]*margin-left\s*:\s*auto/;

      expect(css).toMatch(autoMarginRegex);
    });

    it('应存在覆盖规则防止 RTT/ctl/+ 之间的双重 auto-margin', () => {
      const css = readCssFile();

      // 查找 margin-left: 0 的覆盖规则
      // 期望形如:
      // .sidebar-machine-header > :is(.sidebar-machine-rtt,.sidebar-machine-status,.sidebar-machine-connecting,.sidebar-machine-ctl) ~ :is(.sidebar-machine-ctl,.sidebar-machine-add) { margin-left: 0; }
      // 或类似的选择器组合
      const overrideRegex = /\.sidebar-machine-header\s*>\s*:is\([^)]*\.sidebar-machine-ctl[^)]*\)\s*~[^{]*{[^}]*margin-left\s*:\s*0/;

      expect(css).toMatch(overrideRegex);
    });
  });
});
