import { describe, expect, it } from 'vitest';
import {
  isInternalDevServerNavigation,
  isSystemBrowserUrl,
} from '../externalUrl';

describe('external URL policy helpers', () => {
  it('recognizes only http and https URLs for the system browser', () => {
    expect(isSystemBrowserUrl('https://example.com/path')).toBe(true);
    expect(isSystemBrowserUrl('HTTP://example.com/path')).toBe(true);
    expect(isSystemBrowserUrl('ftp://example.com/file')).toBe(false);
    expect(isSystemBrowserUrl('file:///tmp/a.html')).toBe(false);
    expect(isSystemBrowserUrl('javascript:alert(1)')).toBe(false);
    expect(isSystemBrowserUrl('not a url')).toBe(false);
  });

  it('allows only same-origin dev server navigations internally', () => {
    const devServer = 'http://localhost:5173/';
    expect(
      isInternalDevServerNavigation(
        'http://localhost:5173/?viewer=%7B%7D',
        devServer,
      ),
    ).toBe(true);
    expect(
      isInternalDevServerNavigation('http://127.0.0.1:5173/', devServer),
    ).toBe(false);
    expect(
      isInternalDevServerNavigation('https://example.com/', devServer),
    ).toBe(false);
    expect(isInternalDevServerNavigation('https://example.com/', undefined)).toBe(
      false,
    );
  });
});
