/**
 * OSC 52 —— 远端程序把内容写进【本机】剪贴板(`ESC ] 52 ; Pc ; Pd BEL`)。
 *
 * 为什么需要:远程会话里程序看不到本机剪贴板,OSC 52 是终端协议里唯一的「程序 → 用户
 * 剪贴板」通道(tmux/vim/agent CLI 都用它)。xterm.js **不内建**该序列,本仓库此前也只注册
 * 了 OSC 7,于是远端发来的 OSC 52 全进黑洞(用户实测:agent 提示 "sent 23 chars via
 * OSC 52",本机剪贴板纹丝不动)。
 *
 * 安全边界(这条序列的经典风险:`cat` 一个恶意文件就能静默改写剪贴板,用户随后粘进 shell):
 *  🔴 **拒绝读取**(`Pd == '?'`)。那是反方向——把本机剪贴板回传给远端进程,等于外泄通道。
 *     xterm/iTerm2 默认同样关闭读。写入是用户要的功能,读取不是。
 *  · 载荷上限:超限直接丢弃,不给「一条序列灌爆剪贴板/内存」的余地。
 *  · 严格校验 base64 字符集,解码失败即丢弃(不把垃圾塞进剪贴板)。
 *  · 只认剪贴板类目标(c/p/q/s/0-7,含空=按规范默认),其余形状丢弃。
 */

/** 解码后文本的字节上限(1 MiB):够贴大段 diff,又不至于让一条序列灌爆剪贴板。 */
export const OSC52_MAX_BYTES = 1024 * 1024;

/** Pc 允许的目标字符:c=clipboard p=primary q=secondary s=select 0-7=cut buffer。 */
const TARGET_RE = /^[cpqs0-7]*$/;
const BASE64_RE = /^[A-Za-z0-9+/]*$/;

/**
 * 解析 OSC 52 载荷(xterm 传入的是 `52;` 之后的部分,即 `Pc;Pd`)。
 * @returns 应写入剪贴板的文本;不该处理(读请求/越界/非法)→ null。
 */
export function parseOsc52(
  payload: string,
  maxBytes: number = OSC52_MAX_BYTES,
): string | null {
  const sep = payload.indexOf(';');
  if (sep < 0) return null; // 无 Pd 字段:不是合法写入
  const targets = payload.slice(0, sep);
  const data = payload.slice(sep + 1);

  if (!TARGET_RE.test(targets)) return null;
  // 🔴 读请求:拒绝(见文件头安全边界)。规范里 '?' 要求终端回传剪贴板内容给程序。
  if (data === '?') return null;

  // 去掉传输中可能混入的空白(部分实现按行折断 base64)
  const b64 = data.replace(/\s+/g, '');
  if (b64 === '') return ''; // 空载荷 = 清空剪贴板(规范行为)
  if (!BASE64_RE.test(b64.replace(/=+$/, ''))) return null;
  // base64 每 4 字符出 3 字节:先按上限拦掉,再解码(不为超限载荷分配内存)
  if (Math.floor(b64.length / 4) * 3 > maxBytes) return null;

  const bytes = decodeBase64(b64);
  if (!bytes || bytes.length > maxBytes) return null;
  // fatal:false —— 远端可能发非 UTF-8 字节;替换成 U+FFFD 也好过整条丢弃
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** base64 → 字节;补齐缺失的 padding(部分发送方省略),失败返回 null。 */
function decodeBase64(b64: string): Uint8Array | null {
  const stripped = b64.replace(/=+$/, '');
  const padded = stripped + '='.repeat((4 - (stripped.length % 4)) % 4);
  if (stripped.length % 4 === 1) return null; // 不可能的长度
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
