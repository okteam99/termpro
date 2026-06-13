export interface FilePanelLocateTarget {
  id: number;
  path: string;
  kind: 'file' | 'dir';
  sourceTabId: string;
}

type LocateHandler = (target: FilePanelLocateTarget) => Promise<boolean>;

const handlers = new Map<string, LocateHandler>();

export function registerFilePanelLocateHandler(
  tabId: string,
  handler: LocateHandler,
): () => void {
  handlers.set(tabId, handler);
  return () => {
    if (handlers.get(tabId) === handler) handlers.delete(tabId);
  };
}

export async function tryLocateInFilePanel(
  tabId: string,
  target: FilePanelLocateTarget,
): Promise<boolean> {
  const handler = handlers.get(tabId);
  if (!handler) return false;
  try {
    return await handler(target);
  } catch {
    return false;
  }
}
