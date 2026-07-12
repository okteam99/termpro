// 多设备同屏 TECH §A.1/A.4:hostTag 派生纯函数 + 编排入口 resolveHostTag。
// 验收断言(设计 §4 Phase 1):确定性 / fp 敏感 / username 敏感 / 隔离退化 / 指纹缺失兜底。
import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import { deriveHostTag, resolveHostTag } from '../hostIdentity';

const fpA = crypto.createHash('sha256').update('host-key-A').digest();
const fpB = crypto.createHash('sha256').update('host-key-B').digest();

describe('deriveHostTag(纯函数)', () => {
  it('确定性:同(fp, username)恒同 tag;跨设备收敛的根基', () => {
    expect(deriveHostTag(fpA, 'liam')).toBe(deriveHostTag(fpA, 'liam'));
  });

  it('格式:id- 前缀 + 26 字符 base64url(与遗留 configId 命名空间隔离)', () => {
    const tag = deriveHostTag(fpA, 'liam');
    expect(tag).toMatch(/^id-[A-Za-z0-9_-]{26}$/);
  });

  it('fp 敏感:不同服务器(host key)→ 不同 tag', () => {
    expect(deriveHostTag(fpA, 'liam')).not.toBe(deriveHostTag(fpB, 'liam'));
  });

  it('username 敏感:同服务器不同 SSH 账号 → 不同 tag(账号即隔离边界)', () => {
    expect(deriveHostTag(fpA, 'liam')).not.toBe(deriveHostTag(fpA, 'root'));
  });

  it('非 ASCII 用户名可派生(utf8 编码入 hash)', () => {
    expect(deriveHostTag(fpA, '用户名')).toMatch(/^id-/);
  });

  it('fpDigest 非 32 字节 → fail-fast 抛错(拼接单射前提)', () => {
    expect(() => deriveHostTag(Buffer.from('short'), 'liam')).toThrow(/32 bytes/);
  });
});

describe('resolveHostTag(编排入口)', () => {
  const base = { configId: 'cfg-rand12', username: 'liam' };

  it('isolate=true → 恒退化 configId(现状行为,Phase 1 占位默认)', () => {
    expect(resolveHostTag({ ...base, isolate: true, fpDigest: fpA })).toBe('cfg-rand12');
  });

  it('isolate=false + 指纹在 → 派生收敛 tag', () => {
    expect(resolveHostTag({ ...base, isolate: false, fpDigest: fpA })).toBe(
      deriveHostTag(fpA, 'liam'),
    );
  });

  it('指纹缺失(null)→ fail-safe 退隔离,不炸', () => {
    expect(resolveHostTag({ ...base, isolate: false, fpDigest: null })).toBe('cfg-rand12');
  });

  it('指纹长度异常 → 同样退隔离(绝不半派生)', () => {
    expect(
      resolveHostTag({ ...base, isolate: false, fpDigest: Buffer.alloc(16) }),
    ).toBe('cfg-rand12');
  });
});
