// 远程出口加载失败文案(用户报障 2026-08-14「服务器连着但报 ERR_SOCKS_CONNECTION_FAILED」)。
// 判据来自实测(Electron 42 · 假 SOCKS server 打桩,见 navErrorText.ts 头注):
//   -130 = 连不上本机 SOCKS 口(出口隧道不可用) · -120 = 握手过了但代理拒绝(远端开不了)
import { describe, expect, it } from 'vitest';
import {
  ERR_PROXY_CONNECTION_FAILED,
  ERR_SOCKS_CONNECTION_FAILED,
  describeNavError,
  targetOf,
} from '../navErrorText';

const base = {
  raw: 'ERR_SOCKS_CONNECTION_FAILED (-120)',
  url: 'http://127.0.0.1:42663/run/orders',
  errorCode: ERR_SOCKS_CONNECTION_FAILED,
};

describe('targetOf', () => {
  it('取 host:port;无显式端口只取 host;解析不了原样回', () => {
    expect(targetOf('http://127.0.0.1:42663/run/orders')).toBe('127.0.0.1:42663');
    expect(targetOf('https://example.com/a')).toBe('example.com');
    expect(targetOf('not a url')).toBe('not a url');
  });
});

describe('describeNavError', () => {
  it('远程出口 + -120 → 指向「远端没人监听」,并说明隧道正常', () => {
    const text = describeNavError({ ...base, exitHostId: 'cfg1', exitAlias: 'liam' });
    expect(text).toContain('127.0.0.1:42663');
    expect(text).toContain('liam');
    expect(text).toMatch(/Nothing is listening/);
    // 原始码恒保留(报障检索键)
    expect(text).toContain('ERR_SOCKS_CONNECTION_FAILED (-120)');
  });

  it('远程出口 + -130 → 指向「隧道不可用」,并声明不回落本机', () => {
    const text = describeNavError({
      ...base,
      errorCode: ERR_PROXY_CONNECTION_FAILED,
      raw: 'ERR_PROXY_CONNECTION_FAILED (-130)',
      exitHostId: 'cfg1',
      exitAlias: 'liam',
    });
    expect(text).toMatch(/Tunnel to exit/);
    expect(text).toMatch(/never falls back/);
    expect(text).toContain('ERR_PROXY_CONNECTION_FAILED (-130)');
  });

  it('别名缺失 → 回落 configId,不显示空引号', () => {
    const text = describeNavError({ ...base, exitHostId: 'cfg1' });
    expect(text).toContain('cfg1');
  });

  it('本机出口(local/缺省)一律原样——不给本机标签编远程故事', () => {
    expect(describeNavError({ ...base, exitHostId: 'local' })).toBe(base.raw);
    expect(describeNavError({ ...base })).toBe(base.raw);
  });

  it('其它错误码原样(不认识的错误不硬编故事)', () => {
    const raw = 'ERR_NAME_NOT_RESOLVED (-105)';
    expect(
      describeNavError({ ...base, errorCode: -105, raw, exitHostId: 'cfg1' }),
    ).toBe(raw);
  });
});
