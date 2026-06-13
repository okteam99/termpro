import type { DirEntry } from '../../shared/protocol';

export interface RealpathPair {
  root: string | null;
  target: string | null;
}

export interface ContainmentResult {
  ok: boolean;
  relativeParts: string[];
  reason?: string;
}

function trimTrailingSlash(path: string): string {
  if (path === '/') return path;
  return path.replace(/\/+$/, '');
}

export function normalizeDisplayPath(path: string): string {
  const parts: string[] = [];
  const absolute = path.startsWith('/');
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}` || (absolute ? '/' : '.');
}

export function isInsideOrEqual(target: string, root: string): boolean {
  const t = trimTrailingSlash(normalizeDisplayPath(target));
  const r = trimTrailingSlash(normalizeDisplayPath(root));
  if (r === '/') return t.startsWith('/');
  return t === r || t.startsWith(`${r}/`);
}

export function relativeParts(target: string, root: string): string[] {
  const t = trimTrailingSlash(normalizeDisplayPath(target));
  const r = trimTrailingSlash(normalizeDisplayPath(root));
  if (t === r) return [];
  if (r === '/') return t.slice(1).split('/').filter(Boolean);
  return t.slice(r.length + 1).split('/').filter(Boolean);
}

export function trustedContainment(
  target: string,
  root: string,
  realpaths: RealpathPair,
): ContainmentResult {
  if (!isInsideOrEqual(target, root)) {
    return { ok: false, relativeParts: [], reason: 'display-outside-root' };
  }
  if (realpaths.root === null || realpaths.target === null) {
    return { ok: false, relativeParts: [], reason: 'realpath-null' };
  }
  if (!isInsideOrEqual(realpaths.target, realpaths.root)) {
    return { ok: false, relativeParts: [], reason: 'realpath-outside-root' };
  }
  return { ok: true, relativeParts: relativeParts(target, root) };
}

export function matchEntry(
  entries: DirEntry[],
  segment: string,
  options: { darwinTrusted?: boolean } = {},
): DirEntry | null {
  const exact = entries.find((entry) => entry.name === segment);
  if (exact) return exact;

  const normalized = segment.normalize('NFC');
  const nfc = entries.find((entry) => entry.name.normalize('NFC') === normalized);
  if (nfc) return nfc;

  if (options.darwinTrusted) {
    const folded = normalized.toLocaleLowerCase('en-US');
    return entries.find((entry) => entry.name.normalize('NFC').toLocaleLowerCase('en-US') === folded) ?? null;
  }

  return null;
}
