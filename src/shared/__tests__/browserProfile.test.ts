// 浏览器 Profile 分区方案:命名/解析往返、旧分区名兼容(零迁移前提)、形状歧义防御。
// 🔴 解析只做形状,不做存在性——白名单双确认在 main(browserPartitionPolicy)。

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_ID,
  PROFILE_ID_RE,
  browserPartition,
  isReservedNetHostId,
  parseBrowserPartition,
} from '../browserProfile';
import { partitionOf } from '../remoteHost';
import {
  continuityCookieIdentityKey,
  normalizeContinuityCookieIdentity,
} from '../profileContinuity';

const PID = 'a'.repeat(32); // 合法 32 位 hex
const CFG = 'k7_x-9Qz4AbC'; // base64url 形状(可含 - _)

describe('browserPartition', () => {
  it('默认 profile 映射现有分区名(零迁移:与 partitionOf 逐字一致)', () => {
    expect(browserPartition(DEFAULT_PROFILE_ID, 'local')).toBe('persist:browser');
    expect(browserPartition(DEFAULT_PROFILE_ID, CFG)).toBe(`persist:browser-${CFG}`);
    for (const host of ['local', CFG, 'prof-weird']) {
      expect(browserPartition(DEFAULT_PROFILE_ID, host)).toBe(partitionOf(host));
    }
  });

  it('自定义 profile:本机与远程组合分区', () => {
    expect(browserPartition(PID, 'local')).toBe(`persist:browser-prof-${PID}`);
    expect(browserPartition(PID, CFG)).toBe(`persist:browser-prof-${PID}-${CFG}`);
  });
});

describe('parseBrowserPartition', () => {
  it('四种形态往返', () => {
    const cases: Array<[string, string]> = [
      [DEFAULT_PROFILE_ID, 'local'],
      [DEFAULT_PROFILE_ID, CFG],
      [PID, 'local'],
      [PID, CFG],
    ];
    for (const [profileId, netHostId] of cases) {
      expect(parseBrowserPartition(browserPartition(profileId, netHostId))).toEqual({
        profileId,
        netHostId,
      });
    }
  });

  it('configId 含 - 时远程段完整保留(尾段贪婪)', () => {
    const parsed = parseBrowserPartition(`persist:browser-prof-${PID}-a-b-c`);
    expect(parsed).toEqual({ profileId: PID, netHostId: 'a-b-c' });
  });

  it('rest 形似 prof- 但非 32 位 hex → 按旧形态解析(configId 原样)', () => {
    expect(parseBrowserPartition('persist:browser-prof-nothex')).toEqual({
      profileId: DEFAULT_PROFILE_ID,
      netHostId: 'prof-nothex',
    });
    // 大写 hex 不合形状 → 同样落旧形态
    const upper = 'A'.repeat(32);
    expect(parseBrowserPartition(`persist:browser-prof-${upper}`)).toEqual({
      profileId: DEFAULT_PROFILE_ID,
      netHostId: `prof-${upper}`,
    });
  });

  it('非浏览器分区体系 → null', () => {
    expect(parseBrowserPartition('')).toBeNull();
    expect(parseBrowserPartition('persist:other')).toBeNull();
    expect(parseBrowserPartition('persist:browser-')).toBeNull();
    expect(parseBrowserPartition('browser')).toBeNull();
    expect(parseBrowserPartition('persist:browserX')).toBeNull();
  });

  it('PROFILE_ID_RE 与解析器形状一致', () => {
    expect(PROFILE_ID_RE.test(PID)).toBe(true);
    expect(PROFILE_ID_RE.test('A'.repeat(32))).toBe(false);
    expect(PROFILE_ID_RE.test('a'.repeat(31))).toBe(false);
    expect(PROFILE_ID_RE.test(DEFAULT_PROFILE_ID)).toBe(false); // 'default' 永不撞自定义形状
  });
});

describe('isReservedNetHostId(评审 P2-A 命名空间守卫)', () => {
  it('侵入 profile 命名空间的 configId 一律保留(拒绝)', () => {
    expect(isReservedNetHostId(`prof-${PID}`)).toBe(true); // 撞 profile-X 本机分区
    expect(isReservedNetHostId(`prof-${PID}-extra`)).toBe(true); // 撞 profile-X 远程分区
  });

  it('正常 configId(base64url 短串)与形似但非法 hex 不保留', () => {
    expect(isReservedNetHostId(CFG)).toBe(false);
    expect(isReservedNetHostId('k7_x-9Qz4AbC')).toBe(false);
    expect(isReservedNetHostId('prof-nothex')).toBe(false); // 非 32hex → 旧形态 default
    expect(isReservedNetHostId(`prof-${'A'.repeat(32)}`)).toBe(false); // 大写非法形状
    expect(isReservedNetHostId('local')).toBe(false);
  });
});

describe('Profile-level Cookie identity', () => {
  it('test_AC2_cookie_identity_is_stable_across_profile_partitions', () => {
    const fromLocalPartition = normalizeContinuityCookieIdentity({
      domain: '.Example.Test',
      hostOnly: false,
      path: '/account',
      name: 'session-id',
    });
    const fromRemotePartition = normalizeContinuityCookieIdentity({
      domain: 'example.test',
      hostOnly: false,
      path: '/account',
      name: 'session-id',
    });

    expect(continuityCookieIdentityKey(fromLocalPartition)).toBe(
      continuityCookieIdentityKey(fromRemotePartition),
    );
    expect(
      continuityCookieIdentityKey({
        ...fromRemotePartition,
        hostOnly: true,
      }),
    ).not.toBe(continuityCookieIdentityKey(fromRemotePartition));
    expect(
      continuityCookieIdentityKey({ ...fromRemotePartition, path: '/' }),
    ).not.toBe(continuityCookieIdentityKey(fromRemotePartition));
    expect(
      continuityCookieIdentityKey({ ...fromRemotePartition, name: 'other' }),
    ).not.toBe(continuityCookieIdentityKey(fromRemotePartition));
  });
});
