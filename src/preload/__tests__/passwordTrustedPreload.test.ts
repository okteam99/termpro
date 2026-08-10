// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let exposed: Record<string, unknown> | undefined;
const invoke = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn((_name: string, value: Record<string, unknown>) => { exposed = value; }) },
  ipcRenderer: { invoke },
}));

beforeEach(async () => {
  exposed = undefined;
  invoke.mockReset();
  vi.resetModules();
  document.body.replaceChildren();
  await import('../passwordTrustedPreload');
});

describe('trusted password preload action gate', () => {
  it('does not expose delete and refuses direct renderer reveal/copy invokes without a trusted click', async () => {
    const bridge = exposed as {
      reveal(): Promise<unknown>;
      copy(): Promise<unknown>;
      deleteEntry?: unknown;
    };
    expect(bridge.deleteEntry).toBeUndefined();
    await expect(bridge.reveal()).resolves.toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    await expect(bridge.copy()).resolves.toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not mistake a renderer-created data-password-action click for a user gesture', async () => {
    const bridge = exposed as { reveal(): Promise<unknown> };
    const button = document.createElement('button');
    button.dataset.passwordAction = 'reveal';
    document.body.append(button);
    button.click(); // jsdom, like a renderer-dispatched Event, is not trusted.

    await expect(bridge.reveal()).resolves.toEqual({ ok: false, code: 'VAULT_FORBIDDEN' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
