// React hook:本 commit 仅编译通过,尚未接线到 FilePanel.tsx(Commit 2 完成)。
// StrictMode 安全模式:构造函数纯,无订阅;生命周期 effect 管 start/dispose。

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAppStore } from '../state/store';
import { FilePanelController } from './controller';
import { makeHostDeps } from './deps';
import type { FilePanelInputs, FilePanelView } from './types';

export interface UseFilePanelResult {
  view: FilePanelView;
  toggleDir(absPath: string): void;
  refresh(): void;
}

export function useFilePanel(inputs: FilePanelInputs): UseFilePanelResult {
  // inputs ref:避免 stale closure
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  // Controller ref(懒创建,render 期 new 是安全的——构造函数纯,无订阅)
  const ctrlRef = useRef<FilePanelController | null>(null);

  function ensure(): FilePanelController {
    if (ctrlRef.current === null || ctrlRef.current.isDisposed()) {
      ctrlRef.current = new FilePanelController({
        deps: makeHostDeps(),
        // lockRoot 经 getState() 取活函数,绕开渲染闭包
        lockRoot: (tabId, rootPath) => {
          useAppStore.getState().updateTabFilePanel(tabId, { rootPath });
        },
        // 展开态持久化:写回本 tab 的 filePanel.expanded
        persistExpanded: (tabId, expanded) => {
          useAppStore.getState().updateTabFilePanel(tabId, { expanded });
        },
      });
    }
    return ctrlRef.current;
  }

  // 生命周期 effect(声明在 inputs effect 之前,StrictMode 下保证顺序)
  useEffect(() => {
    const c = ensure();
    c.start();
    c.setInputs(inputsRef.current);
    return () => c.dispose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // inputs effect:依赖各字段而非对象引用,避免无意义重推
  useEffect(() => {
    ensure().setInputs(inputs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.tabId, inputs.mode, inputs.rootPath, inputs.worktreePath, inputs.fallbackCwd]);

  // useSyncExternalStore:subscribe/getSnapshot 包装函数引用稳定,内部经 ref 取活实例
  const view = useSyncExternalStore(
    useCallback((cb) => ensure().subscribe(cb), []),
    useCallback(() => ensure().getSnapshot(), []),
  );

  return {
    view,
    toggleDir: useCallback((p) => ensure().toggleDir(p), []),
    refresh: useCallback(() => ensure().refresh(), []),
  };
}
