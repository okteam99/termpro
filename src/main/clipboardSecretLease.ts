import { createHash, timingSafeEqual } from 'node:crypto';
import {
  MAX_PASSWORD_LENGTH,
  PASSWORD_CLIPBOARD_LEASE_MS,
} from '../shared/passwordVault';

export interface SecretClipboard {
  writeText(text: string): void;
  readText(): string;
  clear(): void;
}

export interface ClipboardSecretLeaseLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface ClipboardSecretLeaseDeps {
  clipboard: SecretClipboard;
  leaseMs?: number;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  logger?: ClipboardSecretLeaseLogger;
}

export type ClipboardSecretLeaseErrorCode =
  | 'CLIPBOARD_INVALID_SECRET'
  | 'CLIPBOARD_WRITE_FAILED'
  | 'CLIPBOARD_TIMER_FAILED';

export class ClipboardSecretLeaseError extends Error {
  readonly code: ClipboardSecretLeaseErrorCode;

  constructor(code: ClipboardSecretLeaseErrorCode) {
    const message =
      code === 'CLIPBOARD_INVALID_SECRET'
        ? 'Clipboard secret is invalid'
        : code === 'CLIPBOARD_WRITE_FAILED'
          ? 'Clipboard write failed'
          : 'Clipboard expiry timer failed';
    super(message);
    this.name = 'ClipboardSecretLeaseError';
    this.code = code;
  }
}

interface ActiveLease {
  generation: number;
  digest: Buffer;
  timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_LOGGER: ClipboardSecretLeaseLogger = {
  warn: (message, context) => console.warn(`[clipboardSecretLease] ${message}`, context),
  error: (message, context) => console.error(`[clipboardSecretLease] ${message}`, context),
};

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Owns at most one password clipboard lease. The retained state contains only
 * a SHA-256 digest and generation; timer closures never capture plaintext.
 */
export class ClipboardSecretLease {
  private readonly leaseMs: number;
  private readonly now: () => number;
  private readonly schedule: typeof setTimeout;
  private readonly cancel: typeof clearTimeout;
  private readonly logger: ClipboardSecretLeaseLogger;
  private generation = 0;
  private active?: ActiveLease;

  constructor(private readonly deps: ClipboardSecretLeaseDeps) {
    this.leaseMs = deps.leaseMs ?? PASSWORD_CLIPBOARD_LEASE_MS;
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? setTimeout;
    this.cancel = deps.cancel ?? clearTimeout;
    this.logger = deps.logger ?? DEFAULT_LOGGER;
  }

  copy(secret: string): { expiresAt: number } {
    if (
      typeof secret !== 'string' ||
      secret.length === 0 ||
      secret.length > MAX_PASSWORD_LENGTH
    ) {
      this.logger.warn('invalid clipboard secret rejected', {
        code: 'CLIPBOARD_INVALID_SECRET',
      });
      throw new ClipboardSecretLeaseError('CLIPBOARD_INVALID_SECRET');
    }
    if (!Number.isFinite(this.leaseMs) || this.leaseMs <= 0) {
      this.logger.error('clipboard lease duration is invalid', {
        code: 'CLIPBOARD_TIMER_FAILED',
      });
      throw new ClipboardSecretLeaseError('CLIPBOARD_TIMER_FAILED');
    }
    let startedAt: number;
    try {
      startedAt = this.now();
    } catch {
      this.logger.error('clipboard lease clock failed', {
        code: 'CLIPBOARD_TIMER_FAILED',
      });
      throw new ClipboardSecretLeaseError('CLIPBOARD_TIMER_FAILED');
    }
    if (!Number.isFinite(startedAt)) {
      this.logger.error('clipboard lease clock is invalid', {
        code: 'CLIPBOARD_TIMER_FAILED',
      });
      throw new ClipboardSecretLeaseError('CLIPBOARD_TIMER_FAILED');
    }

    try {
      this.deps.clipboard.writeText(secret);
    } catch {
      this.logger.error('clipboard write failed', { code: 'CLIPBOARD_WRITE_FAILED' });
      throw new ClipboardSecretLeaseError('CLIPBOARD_WRITE_FAILED');
    }

    const generation = ++this.generation;
    const expiresAt = startedAt + this.leaseMs;
    const next: ActiveLease = { generation, digest: digest(secret) };
    this.cancelActiveTimer();
    this.releaseActiveDigest();
    this.active = next;

    try {
      next.timer = this.schedule(() => this.expire(generation), this.leaseMs);
    } catch {
      this.logger.error('clipboard expiry timer creation failed', {
        code: 'CLIPBOARD_TIMER_FAILED',
        generation,
      });
      this.clearGenerationIfUnchanged(generation);
      throw new ClipboardSecretLeaseError('CLIPBOARD_TIMER_FAILED');
    }
    return { expiresAt };
  }

  /** Immediately apply the same conditional-clear rule to the active lease. */
  clearIfUnchanged(): boolean {
    const generation = this.active?.generation;
    return generation === undefined ? false : this.clearGenerationIfUnchanged(generation);
  }

  /** App-exit hook: cancel the timer, then clear only our unchanged value. */
  clearOnExit(): boolean {
    this.cancelActiveTimer();
    return this.clearIfUnchanged();
  }

  dispose(): boolean {
    return this.clearOnExit();
  }

  private expire(generation: number): void {
    if (this.active?.generation !== generation) return;
    this.active.timer = undefined;
    this.clearGenerationIfUnchanged(generation);
  }

  private clearGenerationIfUnchanged(generation: number): boolean {
    const active = this.active;
    if (!active || active.generation !== generation) return false;

    let currentDigest: Buffer;
    try {
      currentDigest = digest(this.deps.clipboard.readText());
    } catch {
      this.logger.warn('clipboard read failed during conditional clear', {
        code: 'CLIPBOARD_READ_FAILED',
        generation,
      });
      return false;
    }

    if (!timingSafeEqual(currentDigest, active.digest)) {
      this.cancelActiveTimer();
      this.releaseActiveDigest();
      return false;
    }

    try {
      this.deps.clipboard.clear();
    } catch {
      this.logger.warn('clipboard clear failed', {
        code: 'CLIPBOARD_CLEAR_FAILED',
        generation,
      });
      return false;
    }
    this.cancelActiveTimer();
    this.releaseActiveDigest();
    return true;
  }

  private cancelActiveTimer(): void {
    const timer = this.active?.timer;
    if (timer === undefined) return;
    try {
      this.cancel(timer);
    } catch {
      this.logger.warn('clipboard timer cancellation failed', {
        code: 'CLIPBOARD_TIMER_CANCEL_FAILED',
        generation: this.active?.generation,
      });
    }
    if (this.active) this.active.timer = undefined;
  }

  private releaseActiveDigest(): void {
    if (!this.active) return;
    this.active.digest.fill(0);
    this.active = undefined;
  }
}
