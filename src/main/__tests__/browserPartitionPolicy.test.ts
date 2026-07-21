// 浏览器分区策略:白名单双确认(形状 + profile/config 存在性)、本机直连集合、
// 组合分区枚举。全 DI 桩。

import { describe, expect, it } from 'vitest';
import { createBrowserPartitionPolicy } from '../browserPartitionPolicy';

const PID = 'a'.repeat(32);
const PID2 = 'b'.repeat(32);

function makePolicy(profiles: string[] = [PID], configs: string[] = ['cfg-1']) {
  return createBrowserPartitionPolicy({
    hasProfile: (id) => profiles.includes(id),
    hasRemoteConfig: (id) => configs.includes(id),
    listProfileIds: () => profiles,
  });
}

describe('isKnown(will-attach 白名单)', () => {
  const policy = makePolicy();

  it('放行:旧两形态 + 自定义 profile 的本机/远程组合', () => {
    expect(policy.isKnown('persist:browser')).toBe(true);
    expect(policy.isKnown('persist:browser-cfg-1')).toBe(true);
    expect(policy.isKnown(`persist:browser-prof-${PID}`)).toBe(true);
    expect(policy.isKnown(`persist:browser-prof-${PID}-cfg-1`)).toBe(true);
  });

  it('拒绝:未知 config / 未知 profile / 形状非法 / undefined', () => {
    expect(policy.isKnown('persist:browser-cfg-unknown')).toBe(false);
    expect(policy.isKnown(`persist:browser-prof-${PID2}`)).toBe(false);
    expect(policy.isKnown(`persist:browser-prof-${PID2}-cfg-1`)).toBe(false);
    expect(policy.isKnown(`persist:browser-prof-${PID}-cfg-unknown`)).toBe(false);
    expect(policy.isKnown('persist:evil')).toBe(false);
    expect(policy.isKnown('persist:browser-')).toBe(false);
    expect(policy.isKnown(undefined)).toBe(false);
  });

  it('拒绝:profile 已删除(存在性调用期判定,不缓存)', () => {
    const profiles: string[] = [PID];
    const p = createBrowserPartitionPolicy({
      hasProfile: (id) => profiles.includes(id),
      hasRemoteConfig: () => false,
      listProfileIds: () => profiles,
    });
    expect(p.isKnown(`persist:browser-prof-${PID}`)).toBe(true);
    profiles.length = 0; // 删除
    expect(p.isKnown(`persist:browser-prof-${PID}`)).toBe(false);
  });
});

describe('分区集合枚举', () => {
  it('localDirectPartitions:默认 + 每个自定义 profile 的 local 分区', () => {
    expect(makePolicy([PID, PID2]).localDirectPartitions()).toEqual([
      'persist:browser',
      `persist:browser-prof-${PID}`,
      `persist:browser-prof-${PID2}`,
    ]);
    expect(makePolicy([]).localDirectPartitions()).toEqual(['persist:browser']);
  });

  it('partitionsOfExit:默认 + 每个自定义 profile 的组合分区', () => {
    expect(makePolicy([PID, PID2]).partitionsOfExit('cfg-1')).toEqual([
      'persist:browser-cfg-1',
      `persist:browser-prof-${PID}-cfg-1`,
      `persist:browser-prof-${PID2}-cfg-1`,
    ]);
  });

  it('partitionsOfProfile:本机 + 给定各远程出口(不查 profile 存在性——删除后仍可枚举清盘)', () => {
    expect(makePolicy([]).partitionsOfProfile(PID, ['cfg-1', 'cfg-2'])).toEqual([
      `persist:browser-prof-${PID}`,
      `persist:browser-prof-${PID}-cfg-1`,
      `persist:browser-prof-${PID}-cfg-2`,
    ]);
  });
});
