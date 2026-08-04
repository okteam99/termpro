// 远程文件传输 · 上传路径(fsService.createUploadRegistry):begin/chunk/end 全流程 +
// 校验/并发/幂等边界。真实 tmpdir 文件(不 mock fs),仿现有 fsService.test.ts 风格。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUploadRegistry, UploadRegistry } from '../fsService';
import { TRANSFER } from '../../shared/protocol';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function makeTemp(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'okwork-upload-'));
  return tempDir;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function partFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((n) => n.startsWith('.okwork-upload-') && n.endsWith('.part'));
}

describe('UploadRegistry.begin', () => {
  it('成功:destDir 内建 .part 文件,返回 16 hex transferId', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'a.txt', size: 5 });
    expect(transferId).toMatch(/^[0-9a-f]{16}$/);
    const parts = await partFiles(dir);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(`.okwork-upload-${transferId}.part`);
  });

  it('拒绝非绝对路径的 destDir', async () => {
    const reg = createUploadRegistry();
    await expect(
      reg.begin({ destDir: 'relative/dir', name: 'a.txt', size: 1 }),
    ).rejects.toThrow(/absolute/i);
  });

  it('拒绝 destDir 非目录(是文件)', async () => {
    const dir = await makeTemp();
    const filePath = join(dir, 'notadir.txt');
    await writeFile(filePath, 'x');
    const reg = createUploadRegistry();
    await expect(reg.begin({ destDir: filePath, name: 'a.txt', size: 1 })).rejects.toThrow();
  });

  it('拒绝 destDir 不存在', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    await expect(
      reg.begin({ destDir: join(dir, 'missing'), name: 'a.txt', size: 1 }),
    ).rejects.toThrow();
  });

  describe('文件名非法段全用例', () => {
    const dir_cases: Array<[string, string]> = [
      ['含 /', 'a/b.txt'],
      ['含 \\', 'a\\b.txt'],
      ['含 NUL', 'a\0b.txt'],
      ['为 .', '.'],
      ['为 ..', '..'],
      ['为空', ''],
    ];
    for (const [label, name] of dir_cases) {
      it(`拒绝:${label}`, async () => {
        const dir = await makeTemp();
        const reg = createUploadRegistry();
        await expect(reg.begin({ destDir: dir, name, size: 1 })).rejects.toThrow();
      });
    }
  });

  it('拒绝负数/非整数 size(0 是合法的空文件上传)', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    await expect(reg.begin({ destDir: dir, name: 'b.txt', size: -1 })).rejects.toThrow();
    await expect(reg.begin({ destDir: dir, name: 'c.txt', size: 1.5 })).rejects.toThrow();
  });

  it('接受 size=0(空文件):begin 成功建 .part', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'empty.txt', size: 0 });
    expect(await exists(join(dir, `.okwork-upload-${transferId}.part`))).toBe(true);
  });

  it('拒绝超过 TRANSFER.maxFileBytes 的 size', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    await expect(
      reg.begin({ destDir: dir, name: 'a.txt', size: TRANSFER.maxFileBytes + 1 }),
    ).rejects.toThrow();
  });

  it('并发上限:第 5 个 begin 在前 4 个未 end 时抛错', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    for (let i = 0; i < TRANSFER.maxConcurrentUploads; i++) {
      await reg.begin({ destDir: dir, name: `f${i}.txt`, size: 1 });
    }
    await expect(
      reg.begin({ destDir: dir, name: 'overflow.txt', size: 1 }),
    ).rejects.toThrow(/too many/i);
  });

  it('并发上限穿越:Promise.all 发起 max+1 个 begin,恰 max 个成功、其余拒绝', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const attempts = TRANSFER.maxConcurrentUploads + 1;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        reg.begin({ destDir: dir, name: `race${i}.txt`, size: 1 }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(TRANSFER.maxConcurrentUploads);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/too many/i);
  });

  it('sweep:只删过期(mtime>24h)的 .part,不动新鲜 .part 或其他文件', async () => {
    const dir = await makeTemp();
    const staleName = '.okwork-upload-aaaaaaaaaaaaaaaa.part';
    const stalePath = join(dir, staleName);
    await writeFile(stalePath, 'stale');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(stalePath, old, old);

    const unrelated = join(dir, 'keep-me.txt');
    await writeFile(unrelated, 'keep');

    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'new.txt', size: 1 });
    // sweep 不再阻塞 begin(P2-9,fire-and-forget),给它一次机会跑完再断言。
    await new Promise((r) => setTimeout(r, 50));

    expect(await exists(stalePath)).toBe(false); // 过期的被清
    expect(await exists(unrelated)).toBe(true); // 无关文件不动
    expect(await exists(join(dir, `.okwork-upload-${transferId}.part`))).toBe(true); // 本次新建的还在
  });

  it('sweep:mtime 未过期的 .part 不删', async () => {
    const dir = await makeTemp();
    const freshName = '.okwork-upload-bbbbbbbbbbbbbbbb.part';
    const freshPath = join(dir, freshName);
    await writeFile(freshPath, 'fresh');

    const reg = createUploadRegistry();
    await reg.begin({ destDir: dir, name: 'new.txt', size: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(await exists(freshPath)).toBe(true);
  });

  it('sweep 跳过在册在途 .part:即便 mtime 已「过期」,只要仍在登记表中就不删', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'stalled.txt', size: 10 });
    const partPath = join(dir, `.okwork-upload-${transferId}.part`);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(partPath, old, old);

    // 另一次 begin 触发 sweep;等它跑完再断言
    await reg.begin({ destDir: dir, name: 'other.txt', size: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(await exists(partPath)).toBe(true); // 在册的,哪怕 mtime 过期也不被自己的下一次 begin 删掉
  });
});

describe('UploadRegistry.chunk', () => {
  async function begun(
    dir: string,
    size: number,
    name = 'out.txt',
  ): Promise<{ reg: UploadRegistry; transferId: string }> {
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name, size });
    return { reg, transferId };
  }

  it('未知 transferId 抛错', async () => {
    const reg = createUploadRegistry();
    await expect(reg.chunk('deadbeefdeadbeef', 0, 'aGk=')).rejects.toThrow(/unknown/i);
  });

  it('offset 与已接收字节数不符(乱序)→ 抛错且不写入', async () => {
    const dir = await makeTemp();
    const { reg, transferId } = await begun(dir, 10);
    const b64 = Buffer.from('hi').toString('base64');
    await reg.chunk(transferId, 0, b64); // received -> 2
    await expect(reg.chunk(transferId, 5, b64)).rejects.toThrow(/offset/i);

    const partPath = join(dir, `.okwork-upload-${transferId}.part`);
    const content = await readFile(partPath);
    expect(content.length).toBe(2); // 第二次乱序写没有落盘
  });

  it('重复 offset(重传已写过的块)→ 抛错且不重写', async () => {
    const dir = await makeTemp();
    const { reg, transferId } = await begun(dir, 10);
    const b64 = Buffer.from('hi').toString('base64');
    await reg.chunk(transferId, 0, b64); // received -> 2
    await expect(reg.chunk(transferId, 0, b64)).rejects.toThrow(/offset/i);
  });

  it('累计超过声明 size → 抛错', async () => {
    const dir = await makeTemp();
    const { reg, transferId } = await begun(dir, 3);
    const tooBig = Buffer.from('abcdef').toString('base64'); // 6 bytes > size=3
    await expect(reg.chunk(transferId, 0, tooBig)).rejects.toThrow(/exceeds/i);
  });

  it('并发 chunk 交错:同 transferId 同时发两个 offset=0(Promise.all)→ 恰一个成功一个抛,.part 内容和 received 正确', async () => {
    const dir = await makeTemp();
    const { reg, transferId } = await begun(dir, 10, 'race.txt');
    const b64a = Buffer.from('hello').toString('base64');
    const b64b = Buffer.from('WORLD').toString('base64');

    const results = await Promise.allSettled([
      reg.chunk(transferId, 0, b64a),
      reg.chunk(transferId, 0, b64b),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ received: number }> => r.status === 'fulfilled',
    );
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0].value.received).toBe(5);

    // .part 内容恰好是其中一块的完整内容,不是两块交错写出的脏数据
    const partPath = join(dir, `.okwork-upload-${transferId}.part`);
    const content = await readFile(partPath);
    expect(content.length).toBe(5);
    expect(['hello', 'WORLD']).toContain(content.toString('utf8'));
  });

  it('正常顺序写入多块,received 累加,最终落盘内容正确', async () => {
    const dir = await makeTemp();
    const { reg, transferId } = await begun(dir, 10);
    const r1 = await reg.chunk(transferId, 0, Buffer.from('hello').toString('base64'));
    expect(r1.received).toBe(5);
    const r2 = await reg.chunk(transferId, 5, Buffer.from('world').toString('base64'));
    expect(r2.received).toBe(10);

    const partPath = join(dir, `.okwork-upload-${transferId}.part`);
    expect((await readFile(partPath)).toString('utf8')).toBe('helloworld');
  });
});

describe('UploadRegistry.end', () => {
  it('commit=true:.part 消失,内容原子落地到 destDir/name', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'result.txt', size: 5 });
    await reg.chunk(transferId, 0, Buffer.from('abcde').toString('base64'));

    const { path } = await reg.end(transferId, true);
    expect(path).toBe(join(dir, 'result.txt'));
    expect((await readFile(path as string)).toString('utf8')).toBe('abcde');
    expect(await exists(join(dir, `.okwork-upload-${transferId}.part`))).toBe(false);
  });

  it('commit=true 重名 → 加「 (2)」后缀,不覆盖已有文件', async () => {
    const dir = await makeTemp();
    await writeFile(join(dir, 'dup.txt'), 'existing');

    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'dup.txt', size: 3 });
    await reg.chunk(transferId, 0, Buffer.from('new').toString('base64'));

    const { path } = await reg.end(transferId, true);
    expect(path).toBe(join(dir, 'dup (2).txt'));
    expect((await readFile(join(dir, 'dup.txt'))).toString('utf8')).toBe('existing');
    expect((await readFile(path as string)).toString('utf8')).toBe('new');
  });

  it('commit=false(abort):删 .part,不落地目标文件', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'aborted.txt', size: 5 });
    await reg.chunk(transferId, 0, Buffer.from('abc').toString('base64'));

    const { path } = await reg.end(transferId, false);
    expect(path).toBeNull();
    expect(await exists(join(dir, `.okwork-upload-${transferId}.part`))).toBe(false);
    expect(await exists(join(dir, 'aborted.txt'))).toBe(false);
  });

  it('commit=true 但 received < size(少发块)→ 抛 upload incomplete 且 .part 被清理', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'incomplete.txt', size: 10 });
    await reg.chunk(transferId, 0, Buffer.from('hello').toString('base64')); // received=5 < size=10

    await expect(reg.end(transferId, true)).rejects.toThrow(/incomplete/i);
    expect(await exists(join(dir, `.okwork-upload-${transferId}.part`))).toBe(false);
    expect(await exists(join(dir, 'incomplete.txt'))).toBe(false);
  });

  it('0 字节上传全流程:begin(size=0) → end(commit=true) → 目标文件存在且为空', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'empty.txt', size: 0 });
    const { path } = await reg.end(transferId, true);
    expect(path).toBe(join(dir, 'empty.txt'));
    const content = await readFile(path as string);
    expect(content.length).toBe(0);
    expect(await exists(join(dir, `.okwork-upload-${transferId}.part`))).toBe(false);
  });

  it('commit 失败不留孤儿:link 失败 → 抛错,且 fd 已关、.part 已清理', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'orphan.txt', size: 5 });
    await reg.chunk(transferId, 0, Buffer.from('abcde').toString('base64'));
    const partPath = join(dir, `.okwork-upload-${transferId}.part`);

    // 用 mock 让 fs.link 失败(平台无关、确定性触发提交路径的失败分支)。
    // fsService 对 'node:fs' 的 import { promises as fs } 与本测试导入的 fsPromises 是
    // 同一个模块单例对象,spyOn 覆盖其方法对 fsService 内部调用同样生效。
    const linkSpy = vi
      .spyOn(fsPromises, 'link')
      .mockRejectedValueOnce(Object.assign(new Error('mocked link failure'), { code: 'EPERM' }));

    try {
      await expect(reg.end(transferId, true)).rejects.toThrow(/mocked link failure/);
    } finally {
      linkSpy.mockRestore();
    }

    // .part 不留孤儿(commit 失败路径清理过)
    expect(await exists(partPath)).toBe(false);
    // fd 已关的近似断言:transferId 已从登记表移除(uploads.delete 在 end 开头就执行),
    // 再次 end(commit=false) 走「未知 transfer」的幂等分支而不是重复操作同一个 entry/fd。
    await expect(reg.end(transferId, false)).resolves.toEqual({ path: null });
  });

  it('未知 transferId + commit=false → 幂等返回 path=null,不抛错', async () => {
    const reg = createUploadRegistry();
    await expect(reg.end('deadbeefdeadbeef', false)).resolves.toEqual({ path: null });
  });

  it('未知 transferId + commit=true → 抛错', async () => {
    const reg = createUploadRegistry();
    await expect(reg.end('deadbeefdeadbeef', true)).rejects.toThrow(/unknown/i);
  });

  it('end 后并发名额被释放:可以立即开始新的 begin', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const ids: string[] = [];
    for (let i = 0; i < TRANSFER.maxConcurrentUploads; i++) {
      const { transferId } = await reg.begin({ destDir: dir, name: `f${i}.txt`, size: 1 });
      ids.push(transferId);
    }
    await reg.end(ids[0], false);
    await expect(
      reg.begin({ destDir: dir, name: 'newcomer.txt', size: 1 }),
    ).resolves.toBeDefined();
  });
});

describe('UploadRegistry.disposeAll', () => {
  it('清全部在途上传:关 fd + 删全部 .part', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId: t1 } = await reg.begin({ destDir: dir, name: 'a.txt', size: 5 });
    const { transferId: t2 } = await reg.begin({ destDir: dir, name: 'b.txt', size: 5 });
    await reg.chunk(t1, 0, Buffer.from('ab').toString('base64'));

    await reg.disposeAll();

    expect(await exists(join(dir, `.okwork-upload-${t1}.part`))).toBe(false);
    expect(await exists(join(dir, `.okwork-upload-${t2}.part`))).toBe(false);
  });

  it('disposeAll 后再 chunk/end 视为未知 transferId', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: dir, name: 'a.txt', size: 5 });
    await reg.disposeAll();

    await expect(
      reg.chunk(transferId, 0, Buffer.from('a').toString('base64')),
    ).rejects.toThrow(/unknown/i);
    await expect(reg.end(transferId, false)).resolves.toEqual({ path: null });
  });

  it('disposeAll 空登记表不抛错', async () => {
    const reg = createUploadRegistry();
    await expect(reg.disposeAll()).resolves.toBeUndefined();
  });
});

describe('UploadRegistry:大目录用例(可选校验:目标目录须已存在)', () => {
  it('destDir 为多层不存在路径 → 抛错(不静默创建)', async () => {
    const dir = await makeTemp();
    const reg = createUploadRegistry();
    await expect(
      reg.begin({ destDir: join(dir, 'a', 'b', 'c'), name: 'x.txt', size: 1 }),
    ).rejects.toThrow();
  });
});

describe('UploadRegistry:与 mkdir 交互(destDir 是嵌套已存在目录)', () => {
  it('嵌套已存在目录可正常 begin/chunk/end', async () => {
    const dir = await makeTemp();
    const nested = join(dir, 'a', 'b');
    await mkdir(nested, { recursive: true });
    const reg = createUploadRegistry();
    const { transferId } = await reg.begin({ destDir: nested, name: 'deep.txt', size: 3 });
    await reg.chunk(transferId, 0, Buffer.from('xyz').toString('base64'));
    const { path } = await reg.end(transferId, true);
    expect(path).toBe(join(nested, 'deep.txt'));
  });
});
