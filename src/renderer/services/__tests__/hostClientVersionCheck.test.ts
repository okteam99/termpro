// AC-2 版本区间校验(客户端单方判定 · 闭区间含等号)。
// 纯逻辑测试,直接验证 shared/versionCompat 的判定函数与四数矩阵(TC-A01/TC-A02)。
import { describe, it, expect } from 'vitest';
import {
  buildIncompatibleDetail,
  checkHostInfoCompatible,
  isProtocolCompatible,
  resolveHostMinCompatible,
} from '../../../shared/versionCompat';
import type { HostInfo } from '../../../shared/protocol';

function info(protocolVersion: number, minCompatible?: number): HostInfo {
  return {
    hostId: 'local',
    protocolVersion,
    minCompatible,
    platform: 'darwin',
    homedir: '/home/x',
    shell: '/bin/zsh',
  };
}

describe('AC-2 版本区间闭区间边界值矩阵 (TC-A01)', () => {
  // 表列: c_ver, c_min, h_ver, h_min, expected
  const cases: Array<[string, number, number, number, number, boolean]> = [
    ['T-001 v1/v3 双端相等', 3, 3, 3, 3, true],
    ['T-002 客户端超前(2,1)vs(1,1) 版本不等仍兼容', 3, 1, 2, 1, true],
    ['T-003 c_ver 恰等于 h_min(闭区间下界含等号)', 2, 1, 3, 2, true],
    ['T-004 c_ver = h_min - 1 不兼容', 1, 1, 3, 2, false],
    ['T-005 h_ver 恰等于 c_min(闭区间下界含等号)', 3, 2, 2, 1, true],
    ['T-006 h_ver = c_min - 1 不兼容', 3, 3, 2, 1, false],
  ];

  for (const [name, cv, cm, hv, hm, expected] of cases) {
    it(`${name} → ${expected ? '兼容' : '不兼容'}`, () => {
      expect(isProtocolCompatible(cv, cm, hv, hm)).toBe(expected);
    });
  }

  it('test_AC2_versions_exactly_equal_connects (T-001)', () => {
    expect(isProtocolCompatible(3, 3, 3, 3)).toBe(true);
  });

  it('test_AC2_versions_unequal_but_in_interval_connects (T-002)', () => {
    expect(isProtocolCompatible(3, 1, 2, 1)).toBe(true);
  });

  it('test_AC2_boundary_client_version_equals_host_minCompatible (T-003)', () => {
    expect(isProtocolCompatible(2, 1, 3, 2)).toBe(true);
  });

  it('test_AC2_boundary_client_version_below_host_minCompatible_rejects (T-004)', () => {
    expect(isProtocolCompatible(1, 1, 3, 2)).toBe(false);
  });

  it('test_AC2_boundary_host_version_equals_client_minCompatible (T-005)', () => {
    expect(isProtocolCompatible(3, 2, 2, 1)).toBe(true);
  });

  it('test_AC2_boundary_host_version_below_client_minCompatible_rejects (T-006)', () => {
    expect(isProtocolCompatible(3, 3, 2, 1)).toBe(false);
  });
});

describe('AC-2 缺省 minCompatible 语义 (TC-A02 / T-007)', () => {
  it('test_AC2_missing_minCompatible_defaults_to_protocolVersion', () => {
    const missing = info(2); // 无 minCompatible
    const explicit = info(2, 2); // 显式 = protocolVersion
    expect(resolveHostMinCompatible(missing)).toBe(2);
    expect(resolveHostMinCompatible(explicit)).toBe(2);
    // 缺省与显式同值,区间计算结果必须一致
    expect(checkHostInfoCompatible(missing).compatible).toBe(
      checkHostInfoCompatible(explicit).compatible,
    );
  });
});

describe('AC-2 不兼容错误含双方四数 (versionCompat.incompatibleError)', () => {
  it('结构化 detail 携带 client/host 各自的 (v, min)', () => {
    const detail = buildIncompatibleDetail(1, 1, 3, 2);
    expect(detail).toEqual({
      code: 'PROTOCOL_INCOMPATIBLE',
      client: { v: 1, min: 1 },
      host: { v: 3, min: 2 },
    });
  });
});
