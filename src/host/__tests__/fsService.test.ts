import { promises as nodeFs } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyInto,
  listDir,
  moveInto,
  realPath,
  writeTempPng,
} from '../fsService';

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

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

describe('fsService.copyInto / moveInto', () => {
  it('copyInto: 复制文件进目录,源仍在,内容一致', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-cp-'));
    const src = join(tempDir, 'a.txt');
    const dstDir = join(tempDir, 'sub');
    await writeFile(src, 'hello');
    await mkdir(dstDir);

    const { dst } = await copyInto(src, dstDir);
    expect(dst).toBe(join(dstDir, 'a.txt'));
    expect(await exists(src)).toBe(true); // 复制保留源
    expect(await readFile(dst, 'utf8')).toBe('hello');
  });

  it('copyInto: 重名自动加「 (2)」后缀,不覆盖', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-cp-'));
    const src = join(tempDir, 'a.txt');
    const dstDir = join(tempDir, 'sub');
    await writeFile(src, 'new');
    await mkdir(dstDir);
    await writeFile(join(dstDir, 'a.txt'), 'old');

    const { dst } = await copyInto(src, dstDir);
    expect(dst).toBe(join(dstDir, 'a (2).txt'));
    expect(await readFile(join(dstDir, 'a.txt'), 'utf8')).toBe('old'); // 原文件不动
    expect(await readFile(dst, 'utf8')).toBe('new');
  });

  it('copyInto: 递归复制目录', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-cp-'));
    const srcDir = join(tempDir, 'src');
    const dstDir = join(tempDir, 'dst');
    await mkdir(join(srcDir, 'nested'), { recursive: true });
    await writeFile(join(srcDir, 'nested', 'deep.txt'), 'x');
    await mkdir(dstDir);

    const { dst } = await copyInto(srcDir, dstDir);
    expect(dst).toBe(join(dstDir, 'src'));
    expect(await readFile(join(dst, 'nested', 'deep.txt'), 'utf8')).toBe('x');
    expect(await exists(srcDir)).toBe(true);
  });

  it('moveInto: 移动文件,源消失', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-mv-'));
    const src = join(tempDir, 'a.txt');
    const dstDir = join(tempDir, 'sub');
    await writeFile(src, 'move me');
    await mkdir(dstDir);

    const { dst } = await moveInto(src, dstDir);
    expect(dst).toBe(join(dstDir, 'a.txt'));
    expect(await exists(src)).toBe(false); // 移动删除源
    expect(await readFile(dst, 'utf8')).toBe('move me');
  });

  it('moveInto: 原地移动(目标=当前目录)忽略,不改名', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-mv-'));
    const src = join(tempDir, 'a.txt');
    await writeFile(src, 'stay');

    const { dst } = await moveInto(src, tempDir);
    expect(dst).toBe(src);
    expect(await readFile(src, 'utf8')).toBe('stay');
  });

  it('moveInto: 重名加后缀,不覆盖目标已有', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-mv-'));
    const src = join(tempDir, 'a.txt');
    const dstDir = join(tempDir, 'sub');
    await writeFile(src, 'src');
    await mkdir(dstDir);
    await writeFile(join(dstDir, 'a.txt'), 'existing');

    const { dst } = await moveInto(src, dstDir);
    expect(dst).toBe(join(dstDir, 'a (2).txt'));
    expect(await readFile(join(dstDir, 'a.txt'), 'utf8')).toBe('existing');
  });

  it('禁止把目录移进自身子孙', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-mv-'));
    const dir = join(tempDir, 'd');
    const child = join(dir, 'child');
    await mkdir(child, { recursive: true });

    await expect(moveInto(dir, child)).rejects.toThrow(/into itself/);
    await expect(copyInto(dir, dir)).rejects.toThrow(/into itself/);
  });

  it('禁止大小写变体的自身子孙(APFS 大小写不敏感)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-mv-'));
    const dir = join(tempDir, 'Foo');
    await mkdir(dir);
    // 目标用小写 foo/bar,词法大小写归一后应判为子孙
    await expect(moveInto(dir, join(tempDir, 'foo', 'bar'))).rejects.toThrow(
      /into itself/,
    );
  });

  it('moveInto: 跨设备(EXDEV)回退 = 复制后校验落地再删源', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-mv-'));
    const src = join(tempDir, 'a.txt');
    const dstDir = join(tempDir, 'sub');
    await writeFile(src, 'xdev');
    await mkdir(dstDir);

    // 强制 rename 抛 EXDEV 一次 → 走 cp + lstat 校验 + rm 源
    const spy = vi
      .spyOn(nodeFs, 'rename')
      .mockRejectedValueOnce(
        Object.assign(new Error('cross-device'), { code: 'EXDEV' }),
      );
    try {
      const { dst } = await moveInto(src, dstDir);
      expect(dst).toBe(join(dstDir, 'a.txt'));
      expect(await readFile(dst, 'utf8')).toBe('xdev');
      expect(await exists(src)).toBe(false); // 校验目标落地后才删源
    } finally {
      spy.mockRestore();
    }
  });
});

describe('fsService.writeTempPng', () => {
  it('在指定临时根创建 0600 PNG,返回远端可粘贴的绝对路径', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-temp-png-test-'));
    // 1x1 transparent PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );

    const result = await writeTempPng(png.toString('base64'), tempDir);

    expect(relative(tempDir, result.path).startsWith('..')).toBe(false);
    expect(result.path.endsWith('/image.png')).toBe(true);
    expect(await readFile(result.path)).toEqual(png);
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(result.path))).mode & 0o777).toBe(0o700);
  });

  it('拒绝空内容与伪装成 PNG 的任意二进制', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-temp-png-test-'));
    await expect(writeTempPng('', tempDir)).rejects.toThrow(/empty/i);
    await expect(
      writeTempPng(Buffer.from('not png').toString('base64'), tempDir),
    ).rejects.toThrow(/PNG/i);
    await expect(writeTempPng('not-base64!', tempDir)).rejects.toThrow(/base64/i);
  });

  it('在 base64 解码分配/写盘前按 raw bytes 拒绝超限 PNG', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-temp-png-test-'));
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await expect(
      writeTempPng(png.toString('base64'), tempDir, png.length - 1),
    ).rejects.toThrow(/exceeds/i);
  });

  it('每次写入分配独立目录,不覆盖上一张截图', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-temp-png-test-'));
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const a = await writeTempPng(png, tempDir);
    const b = await writeTempPng(png, tempDir);
    expect(a.path).not.toBe(b.path);
  });

  it('TTL 清理失败被吞掉,不形成 Host 未处理 rejection', async () => {
    vi.useFakeTimers();
    tempDir = await mkdtemp(join(tmpdir(), 'termpro-temp-png-test-'));
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await writeTempPng(png, tempDir);
    const rmSpy = vi.spyOn(nodeFs, 'rm').mockRejectedValueOnce(new Error('EACCES'));
    try {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(rmSpy).toHaveBeenCalled();
    } finally {
      rmSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
