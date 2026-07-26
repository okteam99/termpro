// @vitest-environment jsdom
// OSC 52:远端程序 → 本机剪贴板。xterm.js 不内建该序列,此前只注册了 OSC 7,
// 远端发来的 OSC 52 全进黑洞(用户实测:agent 提示 "sent 23 chars via OSC 52",剪贴板没动)。
import { describe, expect, it } from 'vitest';
import { OSC52_MAX_BYTES, parseOsc52 } from '../osc52';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('parseOsc52 写入路径', () => {
  it('标准 `c;<base64>` → 解出原文', () => {
    expect(parseOsc52(`c;${b64('supply_internal_account')}`)).toBe(
      'supply_internal_account',
    );
  });

  it('UTF-8 多字节原样还原(不按 latin1 截断)', () => {
    const text = '你好,世界 🌍 — em dash';
    expect(parseOsc52(`c;${b64(text)}`)).toBe(text);
  });

  it('Pc 为空(规范默认)也接受', () => {
    expect(parseOsc52(`;${b64('hi')}`)).toBe('hi');
  });

  it('多目标 / primary / cut buffer 形状都接受', () => {
    for (const pc of ['p', 's', 'q', '0', '7', 'cp', 's0']) {
      expect(parseOsc52(`${pc};${b64('x')}`)).toBe('x');
    }
  });

  it('空载荷 = 清空剪贴板(规范行为,不是丢弃)', () => {
    expect(parseOsc52('c;')).toBe('');
  });

  it('缺 padding 的 base64 也能解(部分发送方省略)', () => {
    const raw = b64('abcde').replace(/=+$/, '');
    expect(parseOsc52(`c;${raw}`)).toBe('abcde');
  });

  it('base64 内含换行(按行折断的实现)→ 去空白后解', () => {
    const raw = b64('a'.repeat(120));
    const wrapped = `${raw.slice(0, 40)}\n${raw.slice(40)}`;
    expect(parseOsc52(`c;${wrapped}`)).toBe('a'.repeat(120));
  });
});

describe('parseOsc52 安全边界', () => {
  it('🔴 读请求 `?` 一律拒绝(那是把本机剪贴板外泄给远端进程)', () => {
    expect(parseOsc52('c;?')).toBeNull();
    expect(parseOsc52(';?')).toBeNull();
    expect(parseOsc52('p;?')).toBeNull();
  });

  it('超上限丢弃(一条序列灌爆剪贴板)', () => {
    const big = 'A'.repeat(Math.ceil((OSC52_MAX_BYTES + 1024) / 3) * 4);
    expect(parseOsc52(`c;${big}`)).toBeNull();
  });

  it('自定义上限生效', () => {
    expect(parseOsc52(`c;${b64('abcdefghij')}`, 4)).toBeNull();
    expect(parseOsc52(`c;${b64('abc')}`, 4)).toBe('abc');
  });

  it('非法 base64 字符 → 丢弃(不把垃圾塞进剪贴板)', () => {
    expect(parseOsc52('c;not base64!!')).toBeNull();
    expect(parseOsc52('c;<script>')).toBeNull();
  });

  it('不可能的 base64 长度(%4==1)→ 丢弃', () => {
    expect(parseOsc52('c;QUJDRQ')).not.toBeNull(); // 长度 6,合法
    expect(parseOsc52('c;A')).toBeNull();
  });

  it('无分号(没有 Pd 字段)→ 丢弃', () => {
    expect(parseOsc52('c')).toBeNull();
    expect(parseOsc52('')).toBeNull();
  });

  it('Pc 含非法字符 → 丢弃(不猜发送方意图)', () => {
    expect(parseOsc52(`x;${b64('hi')}`)).toBeNull();
    expect(parseOsc52(`c!;${b64('hi')}`)).toBeNull();
  });
});
