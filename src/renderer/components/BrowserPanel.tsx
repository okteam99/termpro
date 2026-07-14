import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveBrowserTabNet, useAppStore, selectActiveWorkspace } from '../state/store';
import type { BrowserTabState } from '../state/store';
import { t } from '../../shared/i18n';
import { partitionOf } from '../../shared/remoteHost';
import type {
  BrowserNetworkSnapshot,
  RemoteHostConfig,
  RemoteStage,
} from '../../shared/remoteHost';
import './BrowserPanel.css';

// webview 是 Electron 专属标签;@types/react 已内置 JSX.IntrinsicElements.webview
// (src/partition 等属性)与全局 HTMLWebViewElement,但该接口是空壳——这里用声明合并补上
// 实际用到的 webview 方法,不重新声明 IntrinsicElements(会与内置声明类型冲突,TS2717)。
declare global {
  interface HTMLWebViewElement {
    loadURL(url: string): Promise<void>;
    getURL(): string;
    reload(): void;
    stop(): void;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    /** 🔴 attach + dom-ready 之前调用会 throw(Electron 语义),调用方必须 try/catch */
    getWebContentsId(): number;
  }
}

type WebviewElement = HTMLWebViewElement;

/** canGoBack/canGoForward 安全读取:jsdom 里 <webview> 只是惰性自定义元素,不带这些方法
 *  (真实 Electron 里恒有);🔴 真实 Electron 里 dom-ready 之前调用会 throw
 *  (冷启动恢复持久化标签时首帧必经此态)——一律兜底「不可导航」,不让读取崩组件。 */
function readNavAvailability(el: WebviewElement): { canGoBack: boolean; canGoForward: boolean } {
  try {
    return {
      canGoBack: typeof el.canGoBack === 'function' && el.canGoBack(),
      canGoForward: typeof el.canGoForward === 'function' && el.canGoForward(),
    };
  } catch {
    return { canGoBack: false, canGoForward: false };
  }
}

/** 单个标签的导航态(nav bar 依据活跃标签展示,由 webview 事件驱动) */
interface NavState {
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 主帧加载失败的 Chromium 错误描述(视图态;新导航开始即清) */
  errorText?: string;
}

const DEFAULT_NAV_STATE: NavState = { loading: false, canGoBack: false, canGoForward: false };

/** 地址栏提交时的 URL 规整:http(s) 原样;其它 scheme 一律拒绝(评审 P2-2:
 *  file:/javascript:/chrome: 等不进 webview);像域名/localhost → 补 https://;其余当搜索词 */
function normalizeUrlInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const looksLikeHost =
    !/\s/.test(trimmed) && (trimmed.includes('.') || trimmed.startsWith('localhost'));
  if (looksLikeHost) return `https://${trimmed}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
}

/** 标签标题兜底:url 解析失败(空标签/非法值)→ null,由调用方再兜底默认名 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

interface BrowserWebviewProps {
  tabId: string;
  /** 该浏览器标签所属的终端 tab id;事件回写(did-navigate 等)据此定位 store 里的窗格,
   *  因为保活渲染时事件可能来自非活跃终端 tab 的后台 webview。 */
  ownerTerminalTabId: string;
  /** 该标签的 session 分区(partitionOf(netHostId));创建后不可变——调用方换出口时
   *  必须换 React key 重挂本组件(该标签重载,分区即网络出口+登录态边界)。 */
  partition: string;
  url: string;
  active: boolean;
  onWebviewRef: (id: string, el: WebviewElement | null) => void;
  onNavChange: (id: string, patch: Partial<NavState>) => void;
  onUrlChange: (ownerTerminalTabId: string, id: string, url: string) => void;
  onTitleChange: (ownerTerminalTabId: string, id: string, title: string) => void;
}

/** 常驻挂载的单标签 webview:src 只设一次(锁定首个非空 url),store 后续 url 更新
 *  (did-navigate 写回)绝不反向绑定回 src,否则会循环 reload。
 *  🔴 保活关键:调用方(BrowserPanel)必须对所有终端 tab 的所有浏览器标签都渲染本组件,
 *  不能只渲染活跃终端 tab 的——<webview> 一旦被 reparent/卸载重挂就会整页重新加载。 */
function BrowserWebview({
  tabId,
  ownerTerminalTabId,
  partition,
  url,
  active,
  onWebviewRef,
  onNavChange,
  onUrlChange,
  onTitleChange,
}: BrowserWebviewProps) {
  const srcRef = useRef(url);
  if (!srcRef.current && url) srcRef.current = url;

  // 用 state(而非纯 ref)持有 webview 元素:ref 变化不触发重渲染,下面的事件绑定
  // effect 需要在元素真正挂载后才跑一次,靠 state 变化驱动。
  const [el, setEl] = useState<WebviewElement | null>(null);
  const setRef = useCallback(
    (node: WebviewElement | null) => {
      setEl(node);
      onWebviewRef(tabId, node);
    },
    [tabId, onWebviewRef],
  );

  useEffect(() => {
    if (!el) return;

    function handleDidNavigate(e: Event) {
      const navigatedUrl = (e as Event & { url?: string }).url;
      if (typeof navigatedUrl === 'string') onUrlChange(ownerTerminalTabId, tabId, navigatedUrl);
      onNavChange(tabId, readNavAvailability(el!));
    }
    function handleDidNavigateInPage(e: Event) {
      const ev = e as Event & { url?: string; isMainFrame?: boolean };
      if (!ev.isMainFrame || typeof ev.url !== 'string') return;
      onUrlChange(ownerTerminalTabId, tabId, ev.url);
      onNavChange(tabId, readNavAvailability(el!));
    }
    function handleTitleUpdated(e: Event) {
      const title = (e as Event & { title?: string }).title;
      if (typeof title === 'string') onTitleChange(ownerTerminalTabId, tabId, title);
    }
    function handleStartLoading() {
      // 新一轮导航开始即清上一轮的失败态(错误条只描述当前页)
      onNavChange(tabId, { loading: true, errorText: undefined });
    }
    function handleStopLoading() {
      onNavChange(tabId, { loading: false });
    }
    function handleDidFailLoad(e: Event) {
      const ev = e as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      // 子帧失败不算页面失败;-3 = ERR_ABORTED(用户中断/被新导航顶替)是正常噪声
      if (!ev.isMainFrame || ev.errorCode === -3) return;
      // 空白页必须能自解释(用户报告 2026-07-14「没反应也没报错」):webview 主帧
      // 加载失败默认就是白屏,把 Chromium 错误码亮到面板错误条上。
      onNavChange(tabId, {
        loading: false,
        errorText: `${ev.errorDescription || 'LOAD_FAILED'} (${ev.errorCode ?? '?'})`,
      });
    }

    el.addEventListener('did-navigate', handleDidNavigate);
    el.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    el.addEventListener('page-title-updated', handleTitleUpdated);
    el.addEventListener('did-start-loading', handleStartLoading);
    el.addEventListener('did-stop-loading', handleStopLoading);
    el.addEventListener('did-fail-load', handleDidFailLoad);
    return () => {
      el.removeEventListener('did-navigate', handleDidNavigate);
      el.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
      el.removeEventListener('page-title-updated', handleTitleUpdated);
      el.removeEventListener('did-start-loading', handleStartLoading);
      el.removeEventListener('did-stop-loading', handleStopLoading);
      el.removeEventListener('did-fail-load', handleDidFailLoad);
    };
  }, [el, tabId, ownerTerminalTabId, onNavChange, onUrlChange, onTitleChange]);

  if (!srcRef.current) return null;

  return (
    <webview
      ref={setRef}
      src={srcRef.current}
      partition={partition}
      // 🔴 无 allowpopups 时 target=_blank/window.open 在 guest 层被直接吞掉,
      // 主进程 setWindowOpenHandler 收不到请求;开了它,请求才会到达拦截器——
      // 拦截器恒 deny 原生新窗,把 http(s) URL 转成面板新标签(main.ts did-attach-webview)。
      // 🔴 webview 对 React 是「未知元素」,布尔 true 会被丢弃(不落 DOM)——必须传字符串,
      // 类型声明(@types/react)却是 boolean,故 cast(React 会警告 string 值但照写 DOM)
      allowpopups={'true' as unknown as boolean}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // webview 不支持 display:none(会丢内部状态/停止渲染进程),非活跃标签用 visibility 隐藏
        visibility: active ? 'visible' : 'hidden',
      }}
    />
  );
}

function BackIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="7.5,2.5 3.5,6 7.5,9.5" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4.5,2.5 8.5,6 4.5,9.5" />
    </svg>
  );
}

/** 弹出独立窗口:方框 + 右上出箭头 */
function PopoutIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 2.5 H2.5 V9.5 H9.5 V7" />
      <path d="M7 2.5 H9.5 V5" />
      <path d="M9.5 2.5 L5.8 6.2" />
    </svg>
  );
}

/** 网络出口候选项:'local' 恒在首位,其后是 ready 状态的远程机(configId + alias)。 */
interface NetOption {
  hostId: string;
  alias?: string;
}

/**
 * 内置浏览器「网络出口」选择器(标签级 · 2026-07):显示并修改【当前活跃浏览器标签】
 * 的 netHostId(决定其 webview 分区;换出口=该标签重挂重载,登录态随分区)。
 * 出口健康态(down/alias)单源在 main 快照(browserNet.get/onChanged),不本地臆测。
 */
function BrowserNetSelector({
  terminalTabId,
  tab,
  ownerHostId,
}: {
  terminalTabId: string | null;
  tab: BrowserTabState | null;
  ownerHostId: string;
}) {
  const [snapshot, setSnapshot] = useState<BrowserNetworkSnapshot>({ exits: [] });
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<NetOption[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const setBrowserTabNet = useAppStore((s) => s.setBrowserTabNet);

  // 拉权威快照对齐 + 订阅变更(断线标 down/重连恢复);window.okwork 可能不存在(测试态)
  useEffect(() => {
    let cancelled = false;
    window.okwork?.browserNet
      ?.get?.()
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      });
    const unsubscribe = window.okwork?.browserNet?.onChanged?.((s) => setSnapshot(s));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // 打开期间:外部点击关闭(mousedown,复刻 WorktreeDropdown 的惯例)
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // 每次打开都重新拉阶段快照 + 配置列表(远程机可能刚就绪/刚断线,不用陈旧候选)
  const openMenu = useCallback(() => {
    setOpen(true);
    const stagesP =
      window.okwork?.remoteHost?.stages?.() ?? Promise.resolve({} as Record<string, RemoteStage>);
    const listP = window.okwork?.remoteHost?.list?.() ?? Promise.resolve([] as RemoteHostConfig[]);
    Promise.all([stagesP, listP]).then(([stages, list]) => {
      const ready = list.filter((cfg) => stages[cfg.id] === 'ready');
      setCandidates(ready.map((cfg) => ({ hostId: cfg.id, alias: cfg.alias })));
    });
  }, []);

  // 改的是【当前标签】的出口:store 即时生效 → webview 按新分区重挂,
  // exitsSync 上报 main 建/收代理。换出口=重载该标签(分区即登录态边界)。
  const handleSelect = useCallback(
    (hostId: string) => {
      if (terminalTabId && tab) setBrowserTabNet(terminalTabId, tab.id, hostId);
      setOpen(false);
    },
    [terminalTabId, tab, setBrowserTabNet],
  );

  const current = tab ? resolveBrowserTabNet(tab, ownerHostId) : 'local';
  const isRemote = current !== 'local';
  const exit = snapshot.exits.find((e) => e.hostId === current);
  // down = 该出口断线中(fail-closed:main 不落直连,请求快速失败;重连自动恢复)
  const down = exit?.down === true;
  const label = isRemote
    ? `${exit?.alias ?? current}${down ? ` · ${t('Reconnecting…')}` : ''}`
    : t('Local network');

  return (
    <div className="browser-panel__net">
      <button
        type="button"
        ref={triggerRef}
        className={`browser-panel__nav-btn browser-panel__net-btn${
          isRemote ? ' browser-panel__net-btn--active' : ''
        }`}
        disabled={!tab}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={t('Browser network exit: {name}', { name: label })}
      >
        {isRemote && (
          <span
            className={`browser-panel__net-dot${down ? ' browser-panel__net-dot--down' : ''}`}
          />
        )}
        <span className="browser-panel__net-icon">🌐</span>
        <span className="browser-panel__net-label">{label}</span>
      </button>

      {open && (
        <div className="browser-panel__net-menu" ref={menuRef}>
          <div
            className={`browser-panel__net-item${
              !isRemote ? ' browser-panel__net-item--selected' : ''
            }`}
            onClick={() => handleSelect('local')}
          >
            <span className="browser-panel__net-check">{!isRemote ? '✓' : ''}</span>
            <span className="browser-panel__net-item-label">{t('Local network')}</span>
          </div>
          {candidates.map((c) => {
            const selected = current === c.hostId;
            return (
              <div
                key={c.hostId}
                className={`browser-panel__net-item${
                  selected ? ' browser-panel__net-item--selected' : ''
                }`}
                onClick={() => handleSelect(c.hostId)}
              >
                <span className="browser-panel__net-check">{selected ? '✓' : ''}</span>
                <span className="browser-panel__net-item-label">{c.alias ?? c.hostId}</span>
              </div>
            );
          })}
          {candidates.length === 0 && (
            <div className="browser-panel__net-empty">{t('No connected remote machines')}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** shell=true:运行在浏览器窗格壳窗内(BrowserPaneShellWindow)——壳窗自带头部条,
 *  隐藏本组件头部/弹出入口;壳窗 store 里窗格不带 poppedOut,占位逻辑天然不触发。 */
export function BrowserPanel({ shell = false }: { shell?: boolean } = {}) {
  // 保活渲染需要「所有」workspace 的所有终端 tab(而不止活跃 workspace 的),
  // 因为切 workspace 也不该 reparent/卸载已开过的浏览器 webview。
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspace = useAppStore(selectActiveWorkspace);
  const browserPanelOpen = useAppStore((s) => s.browserPanelOpen);
  const addBrowserTab = useAppStore((s) => s.addBrowserTab);
  const closeBrowserTab = useAppStore((s) => s.closeBrowserTab);
  const setBrowserActiveTab = useAppStore((s) => s.setBrowserActiveTab);
  const updateBrowserTab = useAppStore((s) => s.updateBrowserTab);
  const popOutBrowserPane = useAppStore((s) => s.popOutBrowserPane);

  // 浏览器窗格绑定当前活跃终端 tab(像 FilePanel 绑定 activeTab 一样);nav 栏/标签条
  // 都反映它,切终端 tab 面板跟着换一组标签。
  const activeTermTab =
    activeWorkspace?.tabs.find((tb) => tb.id === activeWorkspace.activeTabId) ?? null;
  const activeTermTabId = activeTermTab?.id ?? null;
  const pane = activeTermTab?.browser ?? null;
  // 活跃窗格已弹出为独立窗口:主窗只渲染占位(聚焦入口),内容归壳窗所有
  const activePopped = !shell && pane?.poppedOut === true;
  const tabs = pane?.tabs ?? [];
  const activeTabId = pane?.activeTabId ?? null;
  const activeTab = tabs.find((tb) => tb.id === activeTabId) ?? null;

  const webviewRefs = useRef(new Map<string, WebviewElement>());
  const [navStates, setNavStates] = useState<Record<string, NavState>>({});
  // 地址栏编辑态:聚焦进入(draft=当前 url),Enter 提交/Esc 放弃后失焦退出
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const addressInputRef = useRef<HTMLInputElement>(null);

  // 新开标签订阅(webview 内 target=_blank/window.open 经主进程回传);测试环境
  // window.okwork 可能不存在,可选链防御。
  // 严格按来源落位:main 附带来源 guest 的 webContents id,这里经 webviewRefs 反查
  // 来源浏览器标签 → 其所属终端 tab,把新标签落回该 tab 的窗格(后台 tab 的弹窗不落
  // 错地方,也不打扰当前面板显示——面板只展示活跃终端 tab 的窗格)。
  // 反查不中(来源 dom-ready 前拿不到 id / 来源标签恰被关)→ 回退当前活跃终端 tab。
  useEffect(() => {
    const unsubscribe = window.okwork?.onBrowserOpenUrl?.((url, sourceWebContentsId) => {
      const s = useAppStore.getState();
      let ownerTabId: string | null = null;
      if (typeof sourceWebContentsId === 'number') {
        let sourceBrowserTabId: string | null = null;
        for (const [btId, el] of webviewRefs.current) {
          try {
            if (el.getWebContentsId() === sourceWebContentsId) {
              sourceBrowserTabId = btId;
              break;
            }
          } catch {
            // attach/dom-ready 前调用会 throw——该 webview 尚无 guest,必非来源,跳过
          }
        }
        if (sourceBrowserTabId) {
          for (const w of s.workspaces) {
            const owner = w.tabs.find((tb) =>
              tb.browser?.tabs.some((b) => b.id === sourceBrowserTabId),
            );
            if (owner) {
              ownerTabId = owner.id;
              break;
            }
          }
        }
      }
      if (!ownerTabId) {
        const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
        ownerTabId = ws?.tabs.find((tb) => tb.id === ws.activeTabId)?.id ?? null;
      }
      if (ownerTabId) s.addBrowserTab(ownerTabId, url);
    });
    return () => unsubscribe?.();
  }, []);

  // 切换活跃终端 tab 或其浏览器标签 → 退出地址栏编辑态
  useEffect(() => {
    setEditing(false);
  }, [activeTermTabId, activeTabId]);

  // 面板打开、但当前活跃终端 tab 尚无浏览器窗格(或窗格已空)→ 种一个空标签。
  // 覆盖两种情形:刚打开面板(toggleBrowserPanel 本身也会种,这里幂等)、以及面板已开着时
  // 切到一个从没开过浏览器的终端 tab(那次切换不经过 toggleBrowserPanel,靠本 effect 跟随)。
  useEffect(() => {
    if (!browserPanelOpen || !activeTermTabId) return;
    if (activePopped) return; // 已弹出:内容归壳窗,主窗绝不往镜像里种标签
    if (tabs.length > 0) return;
    addBrowserTab(activeTermTabId);
  }, [browserPanelOpen, activeTermTabId, tabs.length, addBrowserTab, activePopped]);

  // 收敛 navStates:只保留仍存在于任意 workspace/终端 tab 的浏览器标签 id
  // (id 是 uuid 不复用,长会话反复开关防无界增长;评审 P2-4)
  useEffect(() => {
    const liveIds = new Set<string>();
    for (const w of workspaces) {
      for (const tb of w.tabs) {
        for (const bt of tb.browser?.tabs ?? []) liveIds.add(bt.id);
      }
    }
    setNavStates((prev) => {
      const kept = Object.entries(prev).filter(([id]) => liveIds.has(id));
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
    });
  }, [workspaces]);

  // 空标签(未导航)自动聚焦地址栏。🔴 推迟到下一帧:首开面板时终端/webview 的
  // 焦点竞争可能在同一轮 effect 后又把焦点抢走,rAF 保证我们是最后落焦的一方
  useEffect(() => {
    if (!(activeTab && activeTab.url === '')) return;
    const raf = requestAnimationFrame(() => addressInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [activeTab?.id, activeTab?.url]);

  // 切换活跃标签时,后退/前进可用态从对应 webview 即时刷新一次(补首帧,事件到达前的窗口)
  useEffect(() => {
    if (!activeTabId) return;
    const el = webviewRefs.current.get(activeTabId);
    if (!el) return;
    setNavStates((prev) => ({
      ...prev,
      [activeTabId]: { ...(prev[activeTabId] ?? DEFAULT_NAV_STATE), ...readNavAvailability(el) },
    }));
  }, [activeTabId]);

  const handleWebviewRef = useCallback((id: string, node: WebviewElement | null) => {
    if (node) webviewRefs.current.set(id, node);
    else webviewRefs.current.delete(id);
  }, []);

  const handleUrlChange = useCallback(
    (ownerTerminalTabId: string, id: string, url: string) => {
      updateBrowserTab(ownerTerminalTabId, id, { url });
    },
    [updateBrowserTab],
  );

  const handleTitleChange = useCallback(
    (ownerTerminalTabId: string, id: string, title: string) => {
      updateBrowserTab(ownerTerminalTabId, id, { title });
    },
    [updateBrowserTab],
  );

  const handleNavChange = useCallback((id: string, patch: Partial<NavState>) => {
    setNavStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? DEFAULT_NAV_STATE), ...patch } }));
  }, []);

  const activeUrl = activeTab?.url ?? '';
  const isEmptyTab = !activeTab || activeUrl === '';
  const activeNav = (activeTabId && navStates[activeTabId]) || DEFAULT_NAV_STATE;

  function handleNavigate(raw: string) {
    if (!activeTermTabId || !activeTab) return;
    const url = normalizeUrlInput(raw);
    if (!url) return;
    const el = webviewRefs.current.get(activeTab.id);
    if (el) {
      // 已有 webview:直接导航,store 由 did-navigate 回写(避免 src 反向绑定循环 reload)
      void el.loadURL(url);
    } else {
      // 空标签:写 store 触发 webview 首次渲染(src 锁定为这个 url)
      updateBrowserTab(activeTermTabId, activeTab.id, { url });
    }
  }

  function handleAddressKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleNavigate(draft);
      setEditing(false);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setEditing(false);
      e.currentTarget.blur();
    }
  }

  function handlePopout() {
    // 弹出 = 整个窗格独立成窗(用户语义:当前 session 对应的 OkBrowser 独立出去):
    // 壳窗以完整窗格快照起步并接管所有权,主窗收面板 + 标记 poppedOut。
    if (!activeTermTabId || !pane || pane.tabs.length === 0) return;
    window.okwork?.browserPane?.popout?.({
      terminalTabId: activeTermTabId,
      tabName: activeTermTab?.customName ?? activeTermTab?.title ?? 'Tab',
      ownerHostId: activeWorkspace?.hostId ?? 'local',
      pane: { tabs: pane.tabs, activeTabId: pane.activeTabId },
    });
    popOutBrowserPane(activeTermTabId);
  }

  return (
    <div className="browser-panel">
      {/* 品牌标题行:与终端 tab 视觉区隔(用户指令),兼作窗口拖拽区;
          右上角=弹出整个窗格为独立窗口(壳窗自带头部,shell 模式不再渲染) */}
      {!shell && (
        <div className="browser-panel__header">
          OkBrowser
          <button
            className="browser-panel__header-popout"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            disabled={activePopped || !pane || pane.tabs.length === 0}
            onClick={handlePopout}
            title={t('Move this browser to a separate window')}
          >
            <PopoutIcon />
          </button>
        </div>
      )}
      {activePopped && (
        <div className="browser-panel__popped" role="note">
          <div className="browser-panel__popped-text">
            {t('This browser is open in a separate window')}
          </div>
          <button
            className="browser-panel__popped-focus"
            onClick={() =>
              activeTermTabId && window.okwork?.browserPane?.focus?.(activeTermTabId)
            }
          >
            {t('Focus window')}
          </button>
        </div>
      )}
      {!activePopped && (
      <>
      <div className="browser-panel__tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const label = tab.title ?? hostOf(tab.url) ?? t('New Tab');
          return (
            <div
              key={tab.id}
              className={`browser-panel__tab${isActive ? ' browser-panel__tab--active' : ''}`}
              onClick={() => activeTermTabId && setBrowserActiveTab(activeTermTabId, tab.id)}
              title={label}
            >
              <span className="browser-panel__tab-title">{label}</span>
              <button
                className="browser-panel__tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeTermTabId) closeBrowserTab(activeTermTabId, tab.id);
                }}
                title={t('Close tab')}
              >
                &times;
              </button>
            </div>
          );
        })}
        <button
          className="browser-panel__tab-add"
          onClick={() => activeTermTabId && addBrowserTab(activeTermTabId)}
          title={t('New tab')}
        >
          +
        </button>
      </div>

      <div className="browser-panel__nav">
        <button
          className="browser-panel__nav-btn"
          disabled={isEmptyTab || !activeNav.canGoBack}
          onClick={() => activeTab && webviewRefs.current.get(activeTab.id)?.goBack()}
          title={t('Back')}
        >
          <BackIcon />
        </button>
        <button
          className="browser-panel__nav-btn"
          disabled={isEmptyTab || !activeNav.canGoForward}
          onClick={() => activeTab && webviewRefs.current.get(activeTab.id)?.goForward()}
          title={t('Forward')}
        >
          <ForwardIcon />
        </button>
        <button
          className="browser-panel__nav-btn"
          disabled={isEmptyTab}
          onClick={() => {
            if (!activeTab) return;
            const el = webviewRefs.current.get(activeTab.id);
            if (!el) return;
            if (activeNav.loading) el.stop();
            else el.reload();
          }}
          title={activeNav.loading ? t('Stop') : t('Refresh')}
        >
          {activeNav.loading ? '✕' : '⟳'}
        </button>
        <input
          ref={addressInputRef}
          className="browser-panel__address-input"
          type="text"
          value={editing ? draft : activeUrl}
          // 🔴 Electron webview 持焦时,宿主页输入框的原生点击聚焦可能失效——
          // mousedown 先摘掉 webview 焦点,原生聚焦流程才可靠
          onMouseDown={() => {
            if (activeTab) webviewRefs.current.get(activeTab.id)?.blur();
          }}
          onFocus={() => {
            setEditing(true);
            setDraft(activeUrl);
          }}
          onChange={(e) => {
            // 🔴 自愈:任何竞态把 editing 留在 false(受控值钉死在 activeUrl,表现为
            // 「打不进字」)时,首次按键即恢复编辑态,以 DOM 实际值为准
            if (!editing) setEditing(true);
            setDraft(e.target.value);
          }}
          onKeyDown={handleAddressKeyDown}
          onBlur={() => setEditing(false)}
          spellCheck={false}
        />
        <button
          className="browser-panel__nav-btn"
          disabled={!activeUrl}
          onClick={() => activeTab && window.okwork.openExternal(activeTab.url)}
          title={t('Open in system browser')}
        >
          ↗
        </button>
        <BrowserNetSelector
          terminalTabId={activeTermTabId}
          tab={activeTab}
          ownerHostId={activeWorkspace?.hostId ?? 'local'}
        />
      </div>

      {/* 主帧加载失败错误条(空白页必须自解释):显示 Chromium 错误码,重试=地址栏 ⏎ */}
      {activeNav.errorText && (
        <div className="browser-panel__load-error" role="alert">
          {t('Page failed to load: {error}', { error: activeNav.errorText })}
        </div>
      )}

      <div className="browser-panel__views">
        {/* 🔴 保活:遍历所有 workspace 的所有终端 tab 的浏览器窗格(不止活跃终端 tab),
            为每个浏览器标签渲染一个常驻 webview,可见性用 CSS visibility 切换——绝不能
            只挂载活跃 tab 的 webview,否则切终端 tab/切 workspace 时旧标签会被卸载重挂,
            <webview> reparent/remount 必重新加载页面。
            已弹出窗格(poppedOut)跳过:其 webview 活在壳窗,主窗渲染=同页双载。 */}
        {workspaces.flatMap((w) =>
          w.tabs.flatMap((tb) =>
            (tb.browser?.poppedOut ? [] : (tb.browser?.tabs ?? [])).map((bt) => {
              // 分区 = 该标签出口(标签级网络);掺进 key——换出口即重挂重载该标签
              // (webview partition 创建后不可变,Chromium 语义)
              const partition = partitionOf(resolveBrowserTabNet(bt, w.hostId));
              return (
                <BrowserWebview
                  key={`${bt.id}:${partition}`}
                  tabId={bt.id}
                  ownerTerminalTabId={tb.id}
                  partition={partition}
                  url={bt.url}
                  active={
                    tb.id === activeTermTabId && bt.id === (tb.browser?.activeTabId ?? null)
                  }
                  onWebviewRef={handleWebviewRef}
                  onNavChange={handleNavChange}
                  onUrlChange={handleUrlChange}
                  onTitleChange={handleTitleChange}
                />
              );
            }),
          ),
        )}
        {isEmptyTab && (
          <div className="browser-panel__empty">
            {t('Enter a URL or search to get started')}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
