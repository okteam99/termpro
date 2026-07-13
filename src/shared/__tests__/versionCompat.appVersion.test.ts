// 用户规则 2026-07-13:连接时服务端应用版本必须 ≥ 客户端,否则先升级服务端。
// isHostAppOutdated 是 residency 认领门闸的版本判定源(纯函数,穷举边界)。
import { describe, it, expect } from 'vitest';
import { compareAppVersions, isHostAppOutdated } from '../versionCompat';

describe('compareAppVersions(点分数值比较)', () => {
  it('大小与相等', () => {
    expect(compareAppVersions('0.3.55', '0.3.56')).toBe(-1);
    expect(compareAppVersions('0.3.56', '0.3.55')).toBe(1);
    expect(compareAppVersions('0.3.55', '0.3.55')).toBe(0);
  });

  it('数值比较而非字典序(0.3.9 < 0.3.10)', () => {
    expect(compareAppVersions('0.3.9', '0.3.10')).toBe(-1);
    expect(compareAppVersions('0.10.0', '0.9.9')).toBe(1);
  });

  it('段数不等按缺段=0(1.0 == 1.0.0;1.0.1 > 1.0)', () => {
    expect(compareAppVersions('1.0', '1.0.0')).toBe(0);
    expect(compareAppVersions('1.0.1', '1.0')).toBe(1);
  });

  it('不可解析(非纯数字段/空串)→ null', () => {
    expect(compareAppVersions('1.0.0-beta', '1.0.0')).toBeNull();
    expect(compareAppVersions('', '1.0.0')).toBeNull();
    expect(compareAppVersions('abc', '1.0.0')).toBeNull();
  });
});

describe('isHostAppOutdated(认领版本门闸)', () => {
  it('host < client → 过旧(连接时升级服务端)', () => {
    expect(isHostAppOutdated('0.3.55', '0.3.56')).toBe(true);
  });

  it('host == client → 不过旧(收养)', () => {
    expect(isHostAppOutdated('0.3.56', '0.3.56')).toBe(false);
  });

  it('host > client → 不过旧(只升不降:防多设备新旧客户端互相替换服务端)', () => {
    expect(isHostAppOutdated('0.4.0', '0.3.56')).toBe(false);
  });

  it('host 未上报 appVersion(现网旧版 host)→ 过旧', () => {
    expect(isHostAppOutdated(undefined, '0.3.56')).toBe(true);
    expect(isHostAppOutdated('', '0.3.56')).toBe(true);
  });

  it('版本不可解析 → 过旧(fail-to-upgrade,宁升级不滞留)', () => {
    expect(isHostAppOutdated('dev-build', '0.3.56')).toBe(true);
  });
});
