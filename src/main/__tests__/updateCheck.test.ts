import { describe, expect, it } from 'vitest';
import {
  isNewer,
  parseLatestRelease,
  parseUpdateFeed,
  pickDarwinZip,
} from '../updateCheck';

describe('isNewer', () => {
  it('compares semver numerically, not lexically', () => {
    expect(isNewer('0.3.98', '0.3.97')).toBe(true);
    expect(isNewer('0.3.100', '0.3.99')).toBe(true);
    expect(isNewer('0.4.0', '0.3.99')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('rejects same or older versions', () => {
    expect(isNewer('0.3.97', '0.3.97')).toBe(false);
    expect(isNewer('0.3.96', '0.3.97')).toBe(false);
    expect(isNewer('0.2.99', '0.3.0')).toBe(false);
  });
});

describe('pickDarwinZip', () => {
  const assets = [
    { name: 'OkWork-0.3.98-arm64.dmg', browser_download_url: 'https://x/dmg' },
    {
      name: 'OkWork-darwin-arm64-0.3.98.zip',
      browser_download_url: 'https://x/arm64.zip',
    },
    {
      name: 'OkWork-darwin-x64-0.3.98.zip',
      browser_download_url: 'https://x/x64.zip',
    },
  ];

  it('picks the zip matching platform and arch', () => {
    expect(pickDarwinZip(assets, 'arm64')).toBe('https://x/arm64.zip');
    expect(pickDarwinZip(assets, 'x64')).toBe('https://x/x64.zip');
  });

  it('returns undefined when nothing matches', () => {
    expect(pickDarwinZip(assets, 'ia32')).toBeUndefined();
    expect(pickDarwinZip(undefined, 'arm64')).toBeUndefined();
    expect(pickDarwinZip([{ name: 'a.zip' }], 'arm64')).toBeUndefined();
  });
});

describe('parseLatestRelease', () => {
  it('strips v prefix and picks the matching asset', () => {
    expect(
      parseLatestRelease(
        {
          tag_name: 'v0.3.98',
          html_url: 'https://github.com/okteam99/termpro/releases/tag/v0.3.98',
          assets: [
            {
              name: 'OkWork-darwin-arm64-0.3.98.zip',
              browser_download_url: 'https://x/arm64.zip',
            },
          ],
        },
        'arm64',
      ),
    ).toEqual({
      version: '0.3.98',
      htmlUrl: 'https://github.com/okteam99/termpro/releases/tag/v0.3.98',
      zipUrl: 'https://x/arm64.zip',
    });
  });

  it('rejects prereleases and missing tag', () => {
    expect(
      parseLatestRelease({ tag_name: 'v0.4.0', prerelease: true }, 'arm64'),
    ).toBeNull();
    expect(parseLatestRelease({}, 'arm64')).toBeNull();
  });
});

describe('parseUpdateFeed', () => {
  it('parses version from v-prefixed name and keeps zip url', () => {
    expect(
      parseUpdateFeed({ name: 'v0.3.98', url: 'https://x/arm64.zip' }),
    ).toEqual({ version: '0.3.98', zipUrl: 'https://x/arm64.zip' });
  });

  it('tolerates missing url (detection still works, download falls back)', () => {
    expect(parseUpdateFeed({ name: 'v0.3.98' })).toEqual({
      version: '0.3.98',
      zipUrl: undefined,
    });
  });

  it('rejects empty feed payload', () => {
    expect(parseUpdateFeed({})).toBeNull();
    expect(parseUpdateFeed({ name: '' })).toBeNull();
  });
});
