import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClipboardSecretLease,
  ClipboardSecretLeaseError,
  type ClipboardSecretLeaseLogger,
  type SecretClipboard,
} from '../clipboardSecretLease';

const SECRET = 'BL006-clipboard-secret-sentinel';

class TestClipboard implements SecretClipboard {
  value = '';
  clearCalls = 0;
  throwOnWrite = false;
  throwOnRead = false;
  throwOnClear = false;

  writeText(text: string): void {
    if (this.throwOnWrite) throw new Error('test write failure');
    this.value = text;
  }

  readText(): string {
    if (this.throwOnRead) throw new Error('test read failure');
    return this.value;
  }

  clear(): void {
    if (this.throwOnClear) throw new Error('test clear failure');
    this.clearCalls += 1;
    this.value = '';
  }
}

let clipboard: TestClipboard;
let logger: ClipboardSecretLeaseLogger;
let warn: ReturnType<typeof vi.fn>;
let error: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
  clipboard = new TestClipboard();
  warn = vi.fn();
  error = vi.fn();
  logger = { warn, error };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClipboardSecretLease', () => {
  it('clears the copied secret after 60 seconds only when unchanged', async () => {
    const lease = new ClipboardSecretLease({ clipboard, logger, now: () => Date.now() });
    expect(lease.copy(SECRET)).toEqual({ expiresAt: Date.now() + 60_000 });
    expect(clipboard.value).toBe(SECRET);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(clipboard.value).toBe(SECRET);
    await vi.advanceTimersByTimeAsync(1);
    expect(clipboard.value).toBe('');
    expect(clipboard.clearCalls).toBe(1);
  });

  it('preserves content written by the user after the secret copy', async () => {
    const lease = new ClipboardSecretLease({ clipboard, logger });
    lease.copy(SECRET);
    clipboard.value = 'user copied this later';

    await vi.advanceTimersByTimeAsync(60_000);
    expect(clipboard.value).toBe('user copied this later');
    expect(clipboard.clearCalls).toBe(0);
    expect(lease.clearIfUnchanged()).toBe(false);
  });

  it('uses generation to reset the full lease when another secret is copied', async () => {
    const lease = new ClipboardSecretLease({ clipboard, logger });
    lease.copy('first secret');
    await vi.advanceTimersByTimeAsync(30_000);
    lease.copy('second secret');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(clipboard.value).toBe('second secret');
    expect(clipboard.clearCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clipboard.value).toBe('');
    expect(clipboard.clearCalls).toBe(1);
  });

  it('applies the same unchanged-content guard during app exit', () => {
    const matching = new ClipboardSecretLease({ clipboard, logger });
    matching.copy(SECRET);
    expect(matching.clearOnExit()).toBe(true);
    expect(clipboard.value).toBe('');

    const changed = new ClipboardSecretLease({ clipboard, logger });
    changed.copy(SECRET);
    clipboard.value = 'new user content';
    expect(changed.dispose()).toBe(false);
    expect(clipboard.value).toBe('new user content');
  });

  it('fails with fixed codes and never puts secret material in errors or logs', async () => {
    clipboard.throwOnWrite = true;
    const lease = new ClipboardSecretLease({ clipboard, logger });
    let caught: unknown;
    try {
      lease.copy(SECRET);
    } catch (errorValue) {
      caught = errorValue;
    }
    expect(caught).toBeInstanceOf(ClipboardSecretLeaseError);
    expect((caught as ClipboardSecretLeaseError).code).toBe('CLIPBOARD_WRITE_FAILED');
    expect(String(caught)).not.toContain(SECRET);

    clipboard.throwOnWrite = false;
    lease.copy(SECRET);
    clipboard.throwOnRead = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clipboard.value).toBe(SECRET);
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain(SECRET);
  });

  it('fails closed by clearing an unchanged secret if timer creation fails', () => {
    const schedule = ((() => {
      throw new Error('test timer failure');
    }) as unknown) as typeof setTimeout;
    const lease = new ClipboardSecretLease({ clipboard, logger, schedule });

    expect(() => lease.copy(SECRET)).toThrowError(ClipboardSecretLeaseError);
    expect(clipboard.value).toBe('');
    expect(clipboard.clearCalls).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(SECRET);
  });
});
