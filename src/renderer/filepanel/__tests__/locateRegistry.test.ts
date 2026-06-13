import { describe, expect, it, vi } from 'vitest';
import {
  registerFilePanelLocateHandler,
  tryLocateInFilePanel,
} from '../locateRegistry';

const target = {
  id: 1,
  path: '/repo/src/App.tsx',
  kind: 'file' as const,
  sourceTabId: 't1',
};

describe('locateRegistry', () => {
  it('routes to the registered handler for a tab', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const unregister = registerFilePanelLocateHandler('t1', handler);
    await expect(tryLocateInFilePanel('t1', target)).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith(target);
    unregister();
  });

  it('returns false for missing handlers and rejected handlers', async () => {
    await expect(tryLocateInFilePanel('missing', target)).resolves.toBe(false);
    const unregister = registerFilePanelLocateHandler('t1', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(tryLocateInFilePanel('t1', target)).resolves.toBe(false);
    unregister();
  });
});
