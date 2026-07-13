import { describe, expect, it } from 'vitest';
import { OutputScanner, ScannerSink } from '../outputScanner';

function collect() {
  const events: string[] = [];
  const sink: ScannerSink = {
    onBell: () => events.push('bell'),
    onOsc: (code, payload) => events.push(`osc:${code}:${payload}`),
    onAltScreen: (on) => events.push(`alt:${on}`),
    onBracketedPaste: (on) => events.push(`paste:${on}`),
  };
  return { events, scanner: new OutputScanner(sink) };
}

describe('OutputScanner', () => {
  it('裸 BEL 触发铃声', () => {
    const { events, scanner } = collect();
    scanner.feed('hello\x07world');
    expect(events).toEqual(['bell']);
  });

  it('BEL 作为 OSC 终止符不算铃声', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b]133;A\x07');
    expect(events).toEqual(['osc:133:A']);
  });

  it('OSC 以 ST(ESC \\)终止', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b]7;file://host/Users/liam\x1b\\');
    expect(events).toEqual(['osc:7:file://host/Users/liam']);
  });

  it('OSC 跨 chunk 切分仍正确解析', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b]13');
    scanner.feed('3;D;');
    scanner.feed('0\x07after\x07');
    expect(events).toEqual(['osc:133:D;0', 'bell']);
  });

  it('ESC 在 chunk 末尾', () => {
    const { events, scanner } = collect();
    scanner.feed('text\x1b');
    scanner.feed(']9;done\x07');
    expect(events).toEqual(['osc:9:done']);
  });

  it('备用屏开关:?1049 / ?1047 / ?47,含多参数', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b[?1049h\x1b[?1049l\x1b[?1047h\x1b[?25;47h');
    expect(events).toEqual(['alt:true', 'alt:false', 'alt:true', 'alt:true']);
  });

  it('bracketed paste 开关:?2004h/l,含跨 chunk 与多参数', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b[?2004h');
    scanner.feed('\x1b[?20');
    scanner.feed('04l');
    scanner.feed('\x1b[?1049;2004h'); // 同一 CSI 混参:alt 与 paste 各自派发
    expect(events).toEqual(['paste:true', 'paste:false', 'alt:true', 'paste:true']);
  });

  it('普通 CSI 不误报', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b[2J\x1b[1;31mred\x1b[0m\x1b[?25h');
    expect(events).toEqual([]);
  });

  it('DCS 字符串里的 BEL 是数据,不触发铃声', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1bPdata\x07more\x1b\\\x07');
    expect(events).toEqual(['bell']); // 仅最后一个裸 BEL
  });

  it('OSC 被新 ESC 序列截断时丢弃,不误派发', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b]133;A\x1b[2J\x07');
    // OSC 因 ESC[ 截断被丢弃;后续 \x07 是裸铃声
    expect(events).toEqual(['bell']);
  });

  it('超长 OSC 溢出后不派发', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b]9;' + 'x'.repeat(5000) + '\x07\x1b]9;ok\x07');
    expect(events).toEqual(['osc:9:ok']);
  });

  it('OSC 777 notify 透传', () => {
    const { events, scanner } = collect();
    scanner.feed('\x1b]777;notify;Title;Body text\x1b\\');
    expect(events).toEqual(['osc:777:notify;Title;Body text']);
  });
});
