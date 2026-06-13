import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { realPath } from '../fsService';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('fsService.realPath', () => {
  it('returns the real path for existing files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-realpath-'));
    const file = join(tempDir, 'file.txt');
    await writeFile(file, 'ok');
    await expect(realPath(file)).resolves.toEqual({ path: await realpath(file) });
  });

  it('returns null for missing paths', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-realpath-'));
    await expect(realPath(join(tempDir, 'missing.txt'))).resolves.toEqual({ path: null });
  });
});
