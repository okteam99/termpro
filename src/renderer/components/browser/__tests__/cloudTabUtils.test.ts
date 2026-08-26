import { describe, expect, it } from 'vitest';
import { isBlankCloudUrl } from '../cloudTabUtils';

describe('isBlankCloudUrl', () => {
  it('空串 / about:blank / chrome 新标签页前缀 → true', () => {
    expect(isBlankCloudUrl('')).toBe(true);
    expect(isBlankCloudUrl('about:blank')).toBe(true);
    expect(isBlankCloudUrl('chrome://newtab')).toBe(true);
    expect(isBlankCloudUrl('chrome://newtab/')).toBe(true);
    expect(isBlankCloudUrl('chrome://new-tab-page')).toBe(true);
    expect(isBlankCloudUrl('chrome://new-tab-page/')).toBe(true);
  });

  it('真实页面 → false', () => {
    expect(isBlankCloudUrl('https://github.com/x')).toBe(false);
    expect(isBlankCloudUrl('https://example.com')).toBe(false);
  });
});
