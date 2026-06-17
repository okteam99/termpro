import { useEffect, useRef } from 'react';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  TermCallbacks,
  ensureSession,
  getOrCreateTerminal,
} from './terminalRegistry';
import { wireWebglAtlasResync } from './webglAtlasResync';
import '@xterm/xterm/css/xterm.css';

interface Props {
  tabId: string;
  cwd: string;
  active: boolean;
  callbacks?: TermCallbacks;
}

export default function TerminalView({ tabId, cwd, active, callbacks }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 回调随渲染刷新(store action 引用可能变化)
  useEffect(() => {
    getOrCreateTerminal(tabId).callbacks = callbacks ?? {};
  });

  // 挂载/重挂:把(可能已存在的)终端元素放进容器,并确保会话已 spawn
  useEffect(() => {
    const inst = getOrCreateTerminal(tabId);
    const el = containerRef.current;
    if (!el) return;
    if (!inst.opened) {
      inst.term.open(el);
      inst.opened = true;
    } else if (inst.term.element && inst.term.element.parentElement !== el) {
      el.appendChild(inst.term.element);
    }
    void ensureSession(tabId, cwd);
  }, [tabId, cwd]);

  // 激活态:WebGL 渲染器只挂可见终端(每页 WebGL context 数量有限,
  // 后台 tab 退回 DOM 渲染照常写入 buffer)
  useEffect(() => {
    const inst = getOrCreateTerminal(tabId);
    if (!active) {
      inst.webgl?.dispose();
      inst.webgl = null;
      return;
    }
    if (!inst.webgl) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          if (inst.webgl === webgl) inst.webgl = null;
        });
        inst.term.loadAddon(webgl);
        inst.webgl = webgl;
        // 图集分页合并/换图集会重排字形索引,需 clearTextureAtlas 清空图集+模型+顶点
        // 缓冲并整屏重绘,否则大量 CJK 字形撑满图集后出现错位/串字乱码
        // (BUG-TERMPRO-B260615152207-001)。监听随 webgl.dispose() 自动释放,无需手动清理。
        wireWebglAtlasResync(webgl);
      } catch (err) {
        console.warn('[terminal] WebGL unavailable, falling back to DOM', err);
      }
    }
    inst.fit.fit();
    inst.term.focus();

    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) inst.fit.fit();
    });
    ro.observe(el);
    // DPR 变化(窗口跨 retina/非-retina 屏拖拽、改显示缩放)会让 WebGL 字形
    // 图集按旧像素比烘焙、取字坐标却按新比算 → 错位乱码。变化时清空图集
    // (按需重建,开销很小)并重新 fit。
    const stopDpr = watchDevicePixelRatio(() => {
      inst.webgl?.clearTextureAtlas();
      if (el.offsetWidth > 0 && el.offsetHeight > 0) inst.fit.fit();
    });
    return () => {
      ro.disconnect();
      stopDpr();
    };
  }, [active, tabId]);

  // 右键菜单:复制/粘贴/全选/清屏(原生菜单,粘贴走 term.paste
  // 以正确处理 bracketed paste)
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const inst = getOrCreateTerminal(tabId);
    const selection = inst.term.getSelection();
    const action = await window.termpro.showTerminalContextMenu({
      hasSelection: selection.length > 0,
    });
    switch (action) {
      case 'copy':
        if (selection) window.termpro.clipboardWriteText(selection);
        break;
      case 'paste': {
        const text = await window.termpro.clipboardReadText();
        if (text) inst.term.paste(text);
        inst.term.focus();
        break;
      }
      case 'selectAll':
        inst.term.selectAll();
        break;
      case 'clear':
        inst.term.clear();
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      className="terminal-host"
      style={{ display: active ? 'block' : 'none' }}
      onContextMenu={(e) => void handleContextMenu(e)}
    />
  );
}

/**
 * 监听 devicePixelRatio 变化并回调。matchMedia 的分辨率查询在 DPR 改变后即
 * 失效(查询条件不再匹配),故每次触发后须按新 DPR 重新注册一条 once 监听。
 * 返回停止函数,供 effect 清理。
 */
function watchDevicePixelRatio(onChange: () => void): () => void {
  let mql: MediaQueryList | null = null;
  let stopped = false;
  const register = () => {
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener('change', handle, { once: true });
  };
  const handle = () => {
    if (stopped) return;
    onChange();
    register();
  };
  register();
  return () => {
    stopped = true;
    mql?.removeEventListener('change', handle);
  };
}
