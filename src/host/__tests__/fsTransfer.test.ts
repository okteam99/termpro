// 远程文件传输 · 下载路径(fsService.readFileRange):offset/length 边界、越界读、
// length 钳制、非普通文件抛错、size/mtimeMs 与实际读取同一 fd(TOCTOU 强一致)。
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileRange } from '../fsService';
import { TRANSFER } from '../../shared/protocol';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function makeTemp(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'okwork-readrange-'));
  return tempDir;
}

describe('fsService.readFileRange', () => {
  it('读取起始分块:offset=0 返回内容 + size/mtimeMs,eof 按是否读满文件判定', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'a.txt');
    const content = 'hello world';
    await writeFile(file, content);
    const st = await stat(file);

    const res = await readFileRange(file, 0, content.length);
    expect(Buffer.from(res.base64, 'base64').toString('utf8')).toBe(content);
    expect(res.bytes).toBe(content.length);
    expect(res.eof).toBe(true);
    expect(res.size).toBe(st.size);
    expect(res.mtimeMs).toBe(st.mtimeMs);
  });

  it('中间分块:length 小于剩余字节 → eof=false,读取的是精确的窗口', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'b.txt');
    const content = '0123456789';
    await writeFile(file, content);

    const res = await readFileRange(file, 2, 3);
    expect(Buffer.from(res.base64, 'base64').toString('utf8')).toBe('234');
    expect(res.bytes).toBe(3);
    expect(res.eof).toBe(false);
    expect(res.size).toBe(content.length);
  });

  it('最后一个分块:offset+length 恰好越过 size → eof=true,bytes 截断到实际剩余', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'c.txt');
    const content = '0123456789';
    await writeFile(file, content);

    const res = await readFileRange(file, 8, 100);
    expect(Buffer.from(res.base64, 'base64').toString('utf8')).toBe('89');
    expect(res.bytes).toBe(2);
    expect(res.eof).toBe(true);
  });

  it('越界读:offset === size → bytes=0,eof=true,不抛错', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'd.txt');
    await writeFile(file, 'abc');

    const res = await readFileRange(file, 3, 10);
    expect(res.bytes).toBe(0);
    expect(res.eof).toBe(true);
    expect(res.base64).toBe('');
    expect(res.size).toBe(3);
  });

  it('越界读:offset 远超 size → bytes=0,eof=true', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'e.txt');
    await writeFile(file, 'abc');

    const res = await readFileRange(file, 999, 10);
    expect(res.bytes).toBe(0);
    expect(res.eof).toBe(true);
  });

  it('length 钳制:超过 TRANSFER.maxChunkBytes 被钳到上限,不抛错', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'f.txt');
    const content = 'x'.repeat(10);
    await writeFile(file, content);

    // length 请求远超上限,但文件本身很小:实际读取仍受文件剩余字节约束
    const res = await readFileRange(file, 0, TRANSFER.maxChunkBytes + 1024);
    expect(res.bytes).toBe(content.length);
    expect(res.eof).toBe(true);
  });

  it('length 钳制:0 或负数被钳到最小值 1', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'g.txt');
    await writeFile(file, 'abcdef');

    const zero = await readFileRange(file, 0, 0);
    expect(zero.bytes).toBe(1);
    expect(Buffer.from(zero.base64, 'base64').toString('utf8')).toBe('a');

    const negative = await readFileRange(file, 0, -5);
    expect(negative.bytes).toBe(1);
  });

  it('offset 非法(负数)抛错', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'h.txt');
    await writeFile(file, 'abc');

    await expect(readFileRange(file, -1, 10)).rejects.toThrow(/offset/i);
  });

  it('offset 非法(非整数)抛错', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'i.txt');
    await writeFile(file, 'abc');

    await expect(readFileRange(file, 1.5, 10)).rejects.toThrow(/offset/i);
  });

  it('offset 非法(NaN/Infinity)抛错', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'j.txt');
    await writeFile(file, 'abc');

    await expect(readFileRange(file, NaN, 10)).rejects.toThrow(/offset/i);
    await expect(readFileRange(file, Infinity, 10)).rejects.toThrow(/offset/i);
  });

  it('非普通文件(目录)抛错,口径同 readBinaryFile', async () => {
    const dir = await makeTemp();
    const sub = join(dir, 'sub');
    await mkdir(sub);

    await expect(readFileRange(sub, 0, 10)).rejects.toThrow(/not a regular file/);
  });

  it('不存在的文件抛错(open 失败)', async () => {
    const dir = await makeTemp();
    await expect(readFileRange(join(dir, 'missing.txt'), 0, 10)).rejects.toThrow();
  });

  it('size/mtimeMs 取自读取时同一 fd(与并发写入的最终状态一致)', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'k.txt');
    await writeFile(file, 'v1-content');
    const before = await stat(file);

    const res = await readFileRange(file, 0, 2);
    expect(res.size).toBe(before.size);
    expect(res.mtimeMs).toBe(before.mtimeMs);
  });
});
