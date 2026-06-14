import { describe, expect, it } from 'vitest';
import { buildAdditionalArguments } from '../buildAdditionalArguments';

describe('buildAdditionalArguments', () => {
  it('buildAdditionalArguments_includes_version_flag', () => {
    // version non-empty → includes --termpro-version=<v>
    const args = buildAdditionalArguments({ version: '0.3.12', smoke: false, dev: false });
    expect(args).toContain('--termpro-version=0.3.12');
  });

  it('does not include version flag when version is empty', () => {
    const args = buildAdditionalArguments({ version: '', smoke: false, dev: false });
    expect(args.some((a) => a.startsWith('--termpro-version='))).toBe(false);
  });

  it('includes --termpro-smoke only when smoke is true', () => {
    expect(buildAdditionalArguments({ version: '', smoke: true, dev: false })).toContain(
      '--termpro-smoke',
    );
    expect(buildAdditionalArguments({ version: '', smoke: false, dev: false })).not.toContain(
      '--termpro-smoke',
    );
  });

  it('includes --termpro-dev only when dev is true', () => {
    expect(buildAdditionalArguments({ version: '', smoke: false, dev: true })).toContain(
      '--termpro-dev',
    );
    expect(buildAdditionalArguments({ version: '', smoke: false, dev: false })).not.toContain(
      '--termpro-dev',
    );
  });

  it('can combine all three flags', () => {
    const args = buildAdditionalArguments({ version: '1.0.0', smoke: true, dev: true });
    expect(args).toContain('--termpro-version=1.0.0');
    expect(args).toContain('--termpro-smoke');
    expect(args).toContain('--termpro-dev');
  });

  it('returns empty array when all flags are off and version is empty', () => {
    expect(buildAdditionalArguments({ version: '', smoke: false, dev: false })).toEqual([]);
  });
});
