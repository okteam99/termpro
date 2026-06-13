import { describe, expect, it } from 'vitest';
import {
  isInsideOrEqual,
  matchEntry,
  normalizeDisplayPath,
  relativeParts,
  trustedContainment,
} from '../pathContainment';

describe('pathContainment', () => {
  it('uses separator-aware containment', () => {
    expect(isInsideOrEqual('/repo/src/App.tsx', '/repo')).toBe(true);
    expect(isInsideOrEqual('/repo2/src/App.tsx', '/repo')).toBe(false);
    expect(isInsideOrEqual('/repo/src/App.tsx', '/')).toBe(true);
    expect(normalizeDisplayPath('/repo/./src/../src/App.tsx')).toBe('/repo/src/App.tsx');
    expect(relativeParts('/repo/src/App.tsx', '/')).toEqual(['repo', 'src', 'App.tsx']);
  });

  it('rejects null and escaping realpaths', () => {
    expect(trustedContainment('/repo/src/App.tsx', '/repo', {
      root: null,
      target: '/repo/src/App.tsx',
    }).ok).toBe(false);
    expect(trustedContainment('/repo/link/file.ts', '/repo', {
      root: '/repo',
      target: '/private/tmp/file.ts',
    })).toMatchObject({ ok: false, reason: 'realpath-outside-root' });
  });

  it('matches entries with NFC and trusted case folding', () => {
    expect(matchEntry([{ name: 'Cafe\u0301.tsx', kind: 'file' }], 'Café.tsx')?.name).toBe('Cafe\u0301.tsx');
    expect(matchEntry([{ name: 'src', kind: 'dir' }], 'SRC', { darwinTrusted: true })?.name).toBe('src');
    expect(matchEntry([{ name: 'src', kind: 'dir' }], 'SRC')).toBeNull();
  });
});
