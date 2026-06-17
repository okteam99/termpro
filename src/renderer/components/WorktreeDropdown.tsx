import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorktreeInfo } from '../../shared/protocol';
import { worktreeLabel } from '../filepanel/core';
import './WorktreeDropdown.css';

/** 触发器右侧的折叠箭头 */
function ChevronIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/** 选中标记 / 复制成功标记 */
function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5l3.4 3.4L13 4.3" />
    </svg>
  );
}

/** 复制按钮图标(双层卡片) */
function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" />
      <path d="M3.5 10.5H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5" />
    </svg>
  );
}

/** 工作区分支展示:detached 显式标注短 SHA(触发器与列表统一口径) */
function branchText(wt: WorktreeInfo): string {
  return wt.branch ?? `detached · ${wt.head}`;
}

interface MenuPos {
  left: number;
  width: number;
  maxHeight: number;
  /** 二选一:向下展开用 top,向上展开用 bottom(均为 fixed 视口坐标) */
  top?: number;
  bottom?: number;
}

interface Props {
  worktrees: WorktreeInfo[];
  /** 当前选中的工作区路径(可能为空/未命中,内部回退到首项) */
  selectedPath: string;
  /** 主工作区路径,用于计算相对 label */
  mainPath: string;
  disabled?: boolean;
  onSelect(path: string): void;
}

/**
 * 自定义工作区下拉:替代原生 <select>。
 * - 触发器显示「label · branch」单行省略
 * - 列表用 portal 渲染到 body + position:fixed,避开 .file-panel 的 overflow:hidden 裁剪;
 *   空间不足时自动向上翻转,maxHeight 取可用高度,内部滚动
 * - 每项两行(工作区路径 + 分支),选中项带勾选 + accent 高亮
 * - 每项右侧常驻复制按钮,复制该工作区**绝对路径**到剪贴板(带 1.2s 成功反馈)
 * - 键盘:↑/↓ 移动高亮、Home/End 跳首尾、Enter 选中、Esc 关闭
 */
export function WorktreeDropdown({ worktrees, selectedPath, mainPath, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | null>(null);

  // 有效选中项(未命中回退首项 = 主工作区),决定勾选位置
  const selectedIndex = Math.max(
    0,
    worktrees.findIndex((wt) => wt.path === selectedPath),
  );
  const selected: WorktreeInfo | undefined = worktrees[selectedIndex];

  // 依据触发器位置计算浮层定位(下方空间不足则向上翻转)
  const computePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 6;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, Math.max(120, openUp ? spaceAbove : spaceBelow));
    setPos({
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, []);

  const closeMenu = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => {
    computePos();
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [computePos, selectedIndex]);

  // 打开期间:外部点击 / Esc / 方向键 / Enter / 视口变化
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          setOpen(false);
          triggerRef.current?.focus();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex(Math.min(worktrees.length - 1, activeIndex + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex(Math.max(0, activeIndex - 1));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(worktrees.length - 1);
          break;
        case 'Enter': {
          e.preventDefault();
          const wt = worktrees[activeIndex];
          if (wt) {
            onSelect(wt.path);
            setOpen(false);
          }
          break;
        }
      }
    }
    function onViewportChange() {
      computePos();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open, worktrees, onSelect, computePos, activeIndex]);

  // 高亮项滚动进视野(menu 直接子节点即条目)
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = menuRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // 卸载时清理复制反馈计时器
  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopy = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    window.termpro.clipboardWriteText(path);
    setCopiedPath(path);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedPath(null), 1200);
  }, []);

  const handlePick = useCallback(
    (path: string) => {
      onSelect(path);
      setOpen(false);
    },
    [onSelect],
  );

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        openMenu();
      }
    },
    [open, openMenu],
  );

  // not a git repo / 空列表:静态占位,不可交互
  if (disabled || worktrees.length === 0 || !selected) {
    return (
      <div className="wt-dd wt-dd--disabled">
        <div className="wt-dd__trigger wt-dd__trigger--disabled">
          <span className="wt-dd__trigger-text">not a git repo</span>
        </div>
      </div>
    );
  }

  return (
    <div className="wt-dd">
      <button
        type="button"
        ref={triggerRef}
        className={`wt-dd__trigger${open ? ' wt-dd__trigger--open' : ''}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected.path}
      >
        <span className="wt-dd__trigger-text">
          <span className="wt-dd__trigger-label">{worktreeLabel(selected, mainPath)}</span>
          <span className="wt-dd__trigger-sep"> · </span>
          <span className="wt-dd__trigger-branch">{branchText(selected)}</span>
        </span>
        <span className="wt-dd__chevron">
          <ChevronIcon />
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            className="wt-dd__menu"
            role="listbox"
            ref={menuRef}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              top: pos.top,
              bottom: pos.bottom,
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            {worktrees.map((wt, i) => {
              const isSel = i === selectedIndex;
              const isActive = i === activeIndex;
              const copied = copiedPath === wt.path;
              return (
                <div
                  key={wt.path}
                  role="option"
                  aria-selected={isSel}
                  className={
                    'wt-dd__item' +
                    (isSel ? ' wt-dd__item--selected' : '') +
                    (isActive ? ' wt-dd__item--active' : '')
                  }
                  onClick={() => handlePick(wt.path)}
                  onMouseEnter={() => setActiveIndex(i)}
                  title={wt.path}
                >
                  <span className="wt-dd__check">{isSel ? <CheckIcon /> : null}</span>
                  <span className="wt-dd__item-text">
                    <span className="wt-dd__item-label">{worktreeLabel(wt, mainPath)}</span>
                    <span className="wt-dd__item-branch">{branchText(wt)}</span>
                  </span>
                  <button
                    type="button"
                    className={`wt-dd__copy${copied ? ' wt-dd__copy--done' : ''}`}
                    onClick={(e) => handleCopy(wt.path, e)}
                    title={copied ? '已复制路径' : '复制工作区路径'}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
