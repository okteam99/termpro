// PTY 输出的轻量 VT 扫描器:只观察、不修改流。
// 必须 VT 感知:BEL 既是铃声也是 OSC 终止符;DCS/APC 等字符串里的
// BEL 是数据。状态跨 feed() 调用保持(序列可能被 chunk 切开)。

import { isRestorableDecMode } from '../shared/protocol';

export interface ScannerSink {
  onBell?(): void;
  onOsc?(code: number, payload: string): void;
  onAltScreen?(on: boolean): void;
  onBracketedPaste?(on: boolean): void;
  /** 鼠标/焦点上报模式翻转(白名单内的 DEC 私有模式;收养回放据此恢复) */
  onMouseMode?(mode: number, on: boolean): void;
}

const MAX_OSC = 4096;
const MAX_CSI = 64;

type State =
  | 'ground'
  | 'esc'
  | 'csi'
  | 'osc'
  | 'oscEsc'
  | 'str' // DCS/SOS/PM/APC:内容忽略,直到 ST
  | 'strEsc';

export class OutputScanner {
  private state: State = 'ground';
  private osc = '';
  private csi = '';
  private oscOverflow = false;

  constructor(private sink: ScannerSink) {}

  feed(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const ch = data.charCodeAt(i);
      switch (this.state) {
        case 'ground':
          if (ch === 0x07) this.sink.onBell?.();
          else if (ch === 0x1b) this.state = 'esc';
          break;

        case 'esc':
          if (ch === 0x5d) {
            // ]
            this.state = 'osc';
            this.osc = '';
            this.oscOverflow = false;
          } else if (ch === 0x5b) {
            // [
            this.state = 'csi';
            this.csi = '';
          } else if (
            ch === 0x50 || // P → DCS
            ch === 0x58 || // X → SOS
            ch === 0x5e || // ^ → PM
            ch === 0x5f // _ → APC
          ) {
            this.state = 'str';
          } else {
            this.state = 'ground';
          }
          break;

        case 'csi':
          if (ch >= 0x40 && ch <= 0x7e) {
            this.dispatchCsi(String.fromCharCode(ch));
            this.state = 'ground';
          } else if (this.csi.length < MAX_CSI) {
            this.csi += String.fromCharCode(ch);
          }
          break;

        case 'osc':
          if (ch === 0x07) {
            this.dispatchOsc();
            this.state = 'ground';
          } else if (ch === 0x1b) {
            this.state = 'oscEsc';
          } else if (this.osc.length < MAX_OSC) {
            this.osc += String.fromCharCode(ch);
          } else {
            this.oscOverflow = true;
          }
          break;

        case 'oscEsc':
          if (ch === 0x5c) {
            // ESC \ = ST
            this.dispatchOsc();
            this.state = 'ground';
          } else {
            // 非 ST:OSC 被新 ESC 序列截断,丢弃并重新按 esc 处理当前字符
            this.osc = '';
            this.oscOverflow = false;
            this.state = 'esc';
            i--;
          }
          break;

        case 'str':
          if (ch === 0x1b) this.state = 'strEsc';
          break;

        case 'strEsc':
          if (ch === 0x5c) this.state = 'ground';
          else if (ch !== 0x1b) this.state = 'str';
          break;
      }
    }
  }

  private dispatchCsi(final: string): void {
    if ((final === 'h' || final === 'l') && this.csi.startsWith('?')) {
      const params = this.csi.slice(1).split(';');
      if (
        params.includes('1049') ||
        params.includes('1047') ||
        params.includes('47')
      ) {
        this.sink.onAltScreen?.(final === 'h');
      }
      if (params.includes('2004')) {
        this.sink.onBracketedPaste?.(final === 'h');
      }
      // 鼠标/焦点上报模式(可多个参数一条 CSI 里设,如 `?1002;1006h`):逐个上报,
      // tracker 存成集合进快照 —— 断线重连回放时据此把 xterm 的模式补回来。
      for (const raw of params) {
        const mode = Number.parseInt(raw, 10);
        if (Number.isFinite(mode) && isRestorableDecMode(mode)) {
          this.sink.onMouseMode?.(mode, final === 'h');
        }
      }
    }
    this.csi = '';
  }

  private dispatchOsc(): void {
    if (!this.oscOverflow) {
      const idx = this.osc.indexOf(';');
      const codeStr = idx === -1 ? this.osc : this.osc.slice(0, idx);
      const payload = idx === -1 ? '' : this.osc.slice(idx + 1);
      const code = Number.parseInt(codeStr, 10);
      if (Number.isFinite(code)) this.sink.onOsc?.(code, payload);
    }
    this.osc = '';
    this.oscOverflow = false;
  }
}
