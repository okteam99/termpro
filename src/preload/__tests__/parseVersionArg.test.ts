import { describe, expect, it } from 'vitest';
import { parseVersionArg } from '../parseVersionArg';

describe('parseVersionArg', () => {
  it('parseVersionArg_extracts_version_from_arg', () => {
    expect(parseVersionArg(['--termpro-version=0.3.12'])).toBe('0.3.12');
    // Extra args around it should not matter
    expect(parseVersionArg(['--foo', '--termpro-version=1.2.3', '--bar'])).toBe('1.2.3');
    // Takes the FIRST match
    expect(
      parseVersionArg(['--termpro-version=0.1.0', '--termpro-version=0.2.0']),
    ).toBe('0.1.0');
  });

  it('parseVersionArg_returns_empty_on_all_failure_modes', () => {
    // value is empty string after `=`
    expect(parseVersionArg(['--termpro-version='])).toBe('');
    // arg has no `=` (no prefix match with `--termpro-version=`)
    expect(parseVersionArg(['--termpro-version'])).toBe('');
    // completely absent
    expect(parseVersionArg([])).toBe('');
    expect(parseVersionArg(['--some-other-flag=1.0'])).toBe('');
    // value is pure whitespace → trim → empty
    expect(parseVersionArg(['--termpro-version=   '])).toBe('');
    // never throws on weird input
    expect(() => parseVersionArg(['not-a-flag', ''])).not.toThrow();
  });
});
