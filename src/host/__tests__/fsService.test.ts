import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { listDir, realPath } from '../fsService';

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

  it('classifies symlinks to directories as expandable directories', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-realpath-'));
    const realDir = join(tempDir, 'real');
    const linkDir = join(tempDir, 'link');
    await mkdir(realDir);
    await symlink(realDir, linkDir);

    await expect(listDir(tempDir)).resolves.toEqual({
      entries: [
        { name: 'link', kind: 'dir' },
        { name: 'real', kind: 'dir' },
      ],
    });
  });

  it('classifies symlinks to files as files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-realpath-'));
    const realFile = join(tempDir, 'real.txt');
    const linkFile = join(tempDir, 'link.txt');
    await writeFile(realFile, 'ok');
    await symlink(realFile, linkFile);

    await expect(listDir(tempDir)).resolves.toEqual({
      entries: [
        { name: 'link.txt', kind: 'file' },
        { name: 'real.txt', kind: 'file' },
      ],
    });
  });

  it('keeps broken symlinks as symlinks', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-realpath-'));
    await symlink(join(tempDir, 'missing'), join(tempDir, 'broken'));

    await expect(listDir(tempDir)).resolves.toEqual({
      entries: [{ name: 'broken', kind: 'symlink' }],
    });
  });
});
