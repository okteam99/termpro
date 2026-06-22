import { useEffect, useRef } from 'react';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  TermCallbacks,
  TermInstance,
  ensureSession,
  getOrCreateTerminal,
} from './terminalRegistry';
import { wireWebglAtlasResync } from './webglAtlasResync';
import '@xterm/xterm/css/xterm.css';

// 创建并挂载 WebGL 渲染器到实例。图集分页合并会让 GPU 纹理页因 version 门控碰撞而漏传,
// 导致 CJK 串字乱码(机制详见 webglAtlasResync.ts 顶注)。clearTextureAtlas 救不了——它
// 不重置纹理 version;唯一可靠的是让纹理全量重传。这里在合并(删页)事件时重建整个
// WebglAddon:全新 GlyphRenderer 的纹理 version 全为 -1,下一帧必然全量重传,version
// 碰撞从物理上不可能发生(等价于整窗 resize 的恢复效果,但无需用户手动)。
function mountWebgl(inst: TermInstance): void {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      webgl.dispose();
      if (inst.webgl === webgl) inst.webgl = null;
    });
    inst.term.loadAddon(webgl);
    inst.webgl = webgl;
    // 删页(合并)→ 微任务去抖 → 重建 WebGL。仅当事件来自当前活跃 addon 时才重建,
    // 避免被替换掉的旧 addon 残留微任务误触发二次重建。
    wireWebglAtlasResync(webgl, () => {
      if (inst.webgl === webgl) remountWebgl(inst);
    });
  } catch (err) {
    console.warn('[terminal] WebGL unavailable, falling back to DOM', err);
  }
}

// 重建:dispose 旧 addon(renderer.dispose 会 removeTerminalFromCache)→ 同步新建挂载。
// 全程在同一微任务内完成,renderService 原子换渲染器,不经 DOM 回退、无闪屏。
function remountWebgl(inst: TermInstance): void {
  inst.webgl?.dispose();
  inst.webgl = null;
  mountWebgl(inst);
}

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
      // 底部输入栏固定面板:挂在 .xterm 内,随终端元素跨 tab 搬运存活
      inst.barPin.mount();
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
      mountWebgl(inst);
    }
    inst.fit.fit();
    inst.term.focus();

    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) inst.fit.fit();
    });
    ro.observe(el);
    // DPR 变化(窗口跨 retina/非-retina 屏拖拽、改显示缩放)会让 WebGL 字形图集按旧
    // 像素比烘焙、取字坐标却按新比算 → 错位乱码。重建 WebGL 让图集按新 DPR 重烘焙、
    // 纹理全量重传,并重新 fit。
    const stopDpr = watchDevicePixelRatio(() => {
      if (inst.webgl) remountWebgl(inst);
      if (el.offsetWidth > 0 && el.offsetHeight > 0) inst.fit.fit();
      // DPR 变致 cell 尺寸改变但行列数未变时不发 onResize,手动刷新固定面板度量
      inst.barPin.refresh();
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
