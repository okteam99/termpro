// 项目内 HTML 预览:<webview> 指向 preview server(preview.ensure 起的静态服务),
// 相对资源经该 server 解析(见 host/previewServer.ts)。默认预览模式与 markdown 对齐
// (阶段4 · 用户指令:点 html 文件默认预览)。
//
// 预览根三级回退(resolvePreviewRoot):payload.previewRoot(FilePanel 已知
// workspaceRoot/effectiveRoot 时传入)→ git.info(cwd=文件所在目录) 的 toplevel →
// 文件所在目录本身。选错根不会越权(host 侧 preview.ensure 起的 server 只服务该 root
// 子树),但会让相对资源(assets/ 等)404——三级回退尽量够到工程根以覆盖这类引用。
//
// 远程时序红线:isRemote(hostId) 时必须先 browserNet.hold([hostId]) 再设 webview src——
// 该 hostId 的出口未进 main 的在用集合时,对应分区只挂了黑洞代理,首帧必败且现象跟
// 错误文案对不上号,难从表象倒推根因(preload browserNet.hold 头注同一红线)。
//
// 🔴 hold 走 exitHoldCounter(评审 P1-1),不直接调 window.okwork.browserNet.hold:
// 同一查看器窗口(同 webContents)可能同时开多个远程 html 预览 tab,hold() 对 main 是
// 【整集覆盖】语义——若各 tab 直接 hold([hostId])/hold([]),后卸载的 tab 会用空集把
// 前一个仍在用的 hostId 也覆盖掉,拆掉其它 tab 的 SOCKS 代理。exitHoldCounter 按
// hostId 记引用计数,每次变更后上报全集,同窗多 tab 互不拆台。

import { useEffect, useRef, useState } from 'react';
import { hostClient } from '../../services/hostClient';
import { buildPreviewUrl } from '../../services/previewUrl';
import { browserPartition, DEFAULT_PROFILE_ID } from '../../../shared/browserProfile';
import { isRemoteHost } from './viewerHost';
import { acquire, release } from './exitHoldCounter';
import { t } from '../../../shared/i18n';

// webview 是 Electron 专属标签;@types/react 内置的全局 HTMLWebViewElement 是空壳,
// 这里用声明合并补上用到的方法(与 BrowserPanel.tsx 同名同签名的合并,互不冲突)。
declare global {
  interface HTMLWebViewElement {
    reload(): void;
  }
}

type WebviewElement = HTMLWebViewElement;

interface Props {
  /** 绝对路径(所连 host 上) */
  path: string;
  /** 缺省/'local' = 本机;远程 = configId */
  hostId?: string;
  previewRoot?: string;
  /** 变化(非首帧)→ webview.reload()(server 端 no-store,拿新盘内容) */
  reloadSeq: number;
  /** 未保存修改 → 顶部提示条 */
  dirty: boolean;
  onRequestSave(): void;
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; url: string };

/** 路径的父目录(host 侧路径恒为 POSIX 语义,远程 Linux/本机 macOS 同形)。 */
export function dirnameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return trimmed.slice(0, idx);
}

/**
 * 预览根三级回退,纯函数(可单测):payload 携带的 previewRoot → git.info 拿到的仓库
 * toplevel → 文件所在目录。三者依次判空,不猜、不做存在性校验(host 侧 preview.ensure
 * 对 root 的合法性另有把关)。
 */
export function resolvePreviewRoot(args: {
  previewRoot: string | null | undefined;
  gitToplevel: string | null | undefined;
  path: string;
}): string {
  if (args.previewRoot) return args.previewRoot;
  if (args.gitToplevel) return args.gitToplevel;
  return dirnameOf(args.path);
}

export function HtmlPreview({
  path,
  hostId,
  previewRoot,
  reloadSeq,
  dirty,
  onRequestSave,
}: Props) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [retrySeq, setRetrySeq] = useState(0);
  const webviewRef = useRef<WebviewElement | null>(null);
  // 上次已记账的 reloadSeq;null = 尚未记过账(真正的首帧)。🔴 评审 P2-7:此前用一个
  // 「skipNextReload」布尔位,且在 retry(preview.ensure 重跑,不改 reloadSeq)时也重置为
  // true——retry 成功后 webview 已是全新 src(自带最新内容),但下一次 reloadSeq 变化
  // (保存触发)会被误判成「首帧」而跳过 reload,导致 retry 后的第一次保存不刷新。改成
  // 记基线:reloadSeq effect 只在「与上次记账值不同」时才触发 reload,retry 不碰这个基线。
  const lastHandledSeqRef = useRef<number | null>(null);

  const remote = isRemoteHost(hostId);
  const partition = browserPartition(DEFAULT_PROFILE_ID, hostId ?? 'local');

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });

    async function resolveRoot(): Promise<string> {
      if (previewRoot) return previewRoot;
      let gitToplevel: string | null = null;
      try {
        const info = await hostClient.rpc('git.info', { cwd: dirnameOf(path) });
        gitToplevel = info.toplevel;
      } catch {
        gitToplevel = null; // git.info 失败不算致命——退化到文件所在目录
      }
      if (cancelled) return dirnameOf(path);
      return resolvePreviewRoot({ previewRoot, gitToplevel, path });
    }

    async function run() {
      try {
        // 🔴 远程时序红线:出口必须先进 main 的在用集合,SOCKS 代理才会真的转发这个
        // 分区的流量——否则首帧对着黑洞代理必败,且现象跟错误文案对不上号。
        if (remote && hostId) {
          await acquire(hostId);
          if (cancelled) return;
        }
        const root = await resolveRoot();
        if (cancelled) return;
        const info = await hostClient.rpc('preview.ensure', { root });
        if (cancelled) return;
        const url = buildPreviewUrl(info, path);
        if (!url) {
          setState({ phase: 'error', message: t('Failed to build the preview URL') });
          return;
        }
        setState({ phase: 'ready', url });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({
          phase: 'error',
          message: msg.includes('unknown rpc method')
            ? t("This machine's host is too old for preview — upgrade it")
            : t('Failed to start the preview server: {error}', { error: msg }),
        });
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (remote && hostId) void release(hostId);
    };
    // previewRoot/hostId 随 tab 固定不变,随 path 一起判定是否需要重跑；retrySeq 是
    // 「重试」按钮的重跑信号。
  }, [path, hostId, previewRoot, retrySeq, remote]);

  // reloadSeq 变化 → 显式 reload,但首次记账(lastHandled 尚为 null)不算变化,不 reload
  // (webview 首帧本就是最新内容)。<webview> dom-ready 之前调用会 throw(真实 Electron
  // 语义),jsdom 下则压根没有该方法——一律存在性判断 + try/catch。
  useEffect(() => {
    const last = lastHandledSeqRef.current;
    lastHandledSeqRef.current = reloadSeq;
    if (last === null || last === reloadSeq) return;
    const el = webviewRef.current;
    if (!el) return;
    try {
      if (typeof el.reload === 'function') el.reload();
    } catch {
      // dom-ready 之前:忽略
    }
  }, [reloadSeq]);

  return (
    <div className="html-preview">
      {dirty && (
        <div className="html-preview__banner">
          <span className="html-preview__banner-text">
            {t('Preview shows the saved file — save to refresh')}
          </span>
          <button className="viewer-btn" onClick={onRequestSave}>
            {t('Save & refresh')}
          </button>
        </div>
      )}
      <div className="html-preview__stage">
        {state.phase === 'loading' && <div className="viewer-message">{t('Loading…')}</div>}
        {state.phase === 'error' && (
          <div className="viewer-message viewer-message--column">
            <div>{state.message}</div>
            <button className="viewer-btn" onClick={() => setRetrySeq((n) => n + 1)}>
              {t('Retry')}
            </button>
          </div>
        )}
        {state.phase === 'ready' && (
          <webview
            key={partition}
            ref={webviewRef}
            src={state.url}
            partition={partition}
            // 🔴 与 BrowserPanel 同款 cast:webview 对 React 是未知元素,布尔 true 会被
            // 丢弃(不落 DOM),必须传字符串。弹窗走查看窗口的 external 策略
            // (main.ts wireBrowserWebviewPolicies({popup:'external'})),这里不用另处理。
            allowpopups={'true' as unknown as boolean}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        )}
      </div>
    </div>
  );
}
