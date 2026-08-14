// 内置浏览器主帧加载失败 → 面向用户的一句话(用户报告 2026-08-14:
// 「服务器连着,但还是报 ERR_SOCKS_CONNECTION_FAILED」)。
//
// 走远程出口的标签,Chromium 的原始错误码把两件完全不同的事说成了差不多的话,
// 而两者的处置动作正相反。实测(Electron 42 · 假 SOCKS server 打桩):
//
//   本机 SOCKS 端口没人监听(出口断了 / 黑洞死端口)  → ERR_PROXY_CONNECTION_FAILED (-130)
//   SOCKS 握手成功但代理回失败 REP(0x01 与 0x05 无差) → ERR_SOCKS_CONNECTION_FAILED (-120)
//
// 于是 -120 恰恰证明**隧道是好的**:Chromium 连上了本机 SOCKS 口、握手也过了,失败
// 发生在远端 —— ssh 的 direct-tcpip 开不了,即远程机上那个 host:port 没人监听/被拒。
// (改 socksProxy 的 REP 码没用:Chromium 把 0x01/0x05 都收敛成 -120,故修在这一层。)
//
// 纯函数(零 React/DOM),BrowserPanel 渲染错误条时调用。

import { t } from '../../shared/i18n';

/** Chromium 错误码:本机代理端口连不上(出口隧道不可用) */
export const ERR_PROXY_CONNECTION_FAILED = -130;
/** Chromium 错误码:SOCKS 握手过了但代理拒绝(远端开不了目标连接) */
export const ERR_SOCKS_CONNECTION_FAILED = -120;

export interface NavErrorContext {
  errorCode: number;
  /** 原始文案「描述 (码)」——认不出的错误原样用它,认得出的附在人话后面 */
  raw: string;
  /** 失败的目标 URL(取 host:port 进文案) */
  url: string;
  /** 该标签的出口:'local'/缺省 = 本机直连,其余 = 远程 configId */
  exitHostId?: string;
  /** 出口别名(UI 名字;缺省回落 configId) */
  exitAlias?: string;
}

function isRemoteExit(exitHostId?: string): boolean {
  return !!exitHostId && exitHostId !== 'local';
}

/** URL → "host:port"(端口显式给出才带;解析不了就原样回) */
export function targetOf(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

/**
 * 错误条文案。远程出口的两个 SOCKS 相关码翻成人话 + 指明处置方向;
 * 其余(含本机标签)保持原样「描述 (码)」——别把不认识的错误硬编故事。
 * 原始码恒附在末尾:用户报障时那串码仍是最有用的检索键。
 */
export function describeNavError(ctx: NavErrorContext): string {
  const raw = ctx.raw;
  if (!isRemoteExit(ctx.exitHostId)) return raw;
  const exit = ctx.exitAlias || ctx.exitHostId || '';
  if (ctx.errorCode === ERR_SOCKS_CONNECTION_FAILED) {
    return `${t('Nothing is listening on {target} on remote machine "{exit}" (the tunnel itself is fine)', { target: targetOf(ctx.url), exit })} · ${raw}`;
  }
  if (ctx.errorCode === ERR_PROXY_CONNECTION_FAILED) {
    return `${t('Tunnel to exit "{exit}" is unavailable (disconnected or reconnecting); traffic never falls back to this machine', { exit })} · ${raw}`;
  }
  return raw;
}
