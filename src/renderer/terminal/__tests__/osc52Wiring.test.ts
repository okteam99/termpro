// @vitest-environment jsdom
// 接线验证:真 xterm 解析器确实把 OSC 52 派发给 registerOscHandler(52),且载荷形状
// 就是 `Pc;Pd`(即 "52;" 之后的部分)—— parseOsc52 的入参契约建立在这个假设上。
// 单测 parseOsc52 只证解析对,不证「序列真的到得了手里」,这个文件补上后半截。
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { parseOsc52 } from '../osc52';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** headless 写入(不 open):解析器不依赖渲染层。 */
function writeSync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe('xterm OSC 52 派发', () => {
  it('BEL 收尾的 OSC 52 → handler 收到 `Pc;Pd`', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const seen: string[] = [];
    term.parser.registerOscHandler(52, (d) => {
      seen.push(d);
      return true;
    });

    await writeSync(term, `\x1b]52;c;${b64('hello')}\x07`);
    expect(seen).toEqual([`c;${b64('hello')}`]);
    expect(parseOsc52(seen[0])).toBe('hello');
    term.dispose();
  });

  it('ST(ESC \\)收尾同样派发', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const seen: string[] = [];
    term.parser.registerOscHandler(52, (d) => {
      seen.push(d);
      return true;
    });

    await writeSync(term, `\x1b]52;c;${b64('via ST')}\x1b\\`);
    expect(seen.length).toBe(1);
    expect(parseOsc52(seen[0])).toBe('via ST');
    term.dispose();
  });

  it('序列被 chunk 切断 → 解析器重组后只派发一次完整载荷', async () => {
    const term = new Terminal({ allowProposedApi: true });
    const seen: string[] = [];
    term.parser.registerOscHandler(52, (d) => {
      seen.push(d);
      return true;
    });

    const seq = `\x1b]52;c;${b64('split across chunks')}\x07`;
    for (let i = 0; i < seq.length; i += 5) {
      await writeSync(term, seq.slice(i, i + 5));
    }
    expect(seen.length).toBe(1);
    expect(parseOsc52(seen[0])).toBe('split across chunks');
    term.dispose();
  });

  it('OSC 52 不会被当正文写进屏幕缓冲(handler 返 true = 已处置)', async () => {
    const term = new Terminal({ allowProposedApi: true, cols: 80, rows: 5 });
    term.parser.registerOscHandler(52, () => true);
    await writeSync(term, `A\x1b]52;c;${b64('secret')}\x07B`);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('AB');
    term.dispose();
  });
});
