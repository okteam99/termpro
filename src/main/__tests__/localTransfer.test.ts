// 远程文件传输 · 阶段2:本机盘票据通道(main/localTransfer.ts)。真实 tmpdir 文件
// (不 mock fs),注入 now 测 TTL,仿 host/__tests__/uploadRegistry.test.ts 风格。
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalTransferRegistry, collectReadTickets, sanitizeSuggestedName } from '../localTransfer';
import { TRANSFER } from '../../shared/protocol';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function makeTemp(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'okwork-localtransfer-'));
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
  return entries.filter((n) => n.includes('.okwork-part-'));
}

// ---------------------------------------------------------------------------
describe('sanitizeSuggestedName', () => {
  it('目录穿越:取最后一段(basename 语义)', () => {
    expect(sanitizeSuggestedName('../../etc/passwd')).toBe('passwd');
  });

  it('空字符串 → download', () => {
    expect(sanitizeSuggestedName('')).toBe('download');
  });

  it('非字符串(undefined/number/null) → download', () => {
    expect(sanitizeSuggestedName(undefined)).toBe('download');
    expect(sanitizeSuggestedName(null)).toBe('download');
    expect(sanitizeSuggestedName(123)).toBe('download');
  });

  it('控制字符剥离', () => {
    expect(sanitizeSuggestedName('foo\x00\x1fbar\x7f.txt')).toBe('foobar.txt');
  });

  it('反斜杠当路径分隔符(取最后一段)', () => {
    expect(sanitizeSuggestedName('a\\b\\c.txt')).toBe('c.txt');
  });

  it('单独 "." 或 ".." → download', () => {
    expect(sanitizeSuggestedName('.')).toBe('download');
    expect(sanitizeSuggestedName('..')).toBe('download');
  });

  it('正常文件名原样通过', () => {
    expect(sanitizeSuggestedName('report (final).pdf')).toBe('report (final).pdf');
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry.createWrite', () => {
  it('同目录建 .<name>.okwork-part-<16hex> 文件(点前缀,Finder 默认不可见),ticket 为 16 hex', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const finalPath = join(dir, 'out.bin');
    const { ticket, name } = await reg.createWrite(finalPath, 1);
    expect(ticket).toMatch(/^[0-9a-f]{16}$/);
    expect(name).toBe('out.bin');
    const parts = await partFiles(dir);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(`.out.bin.okwork-part-${ticket}`);
    expect(parts[0].startsWith('.')).toBe(true);
    expect(await exists(finalPath)).toBe(false); // 目标文件在 commit 前不存在
    await reg.finish(1, ticket, false);
  });

  it('拒绝相对路径', async () => {
    const reg = new LocalTransferRegistry();
    await expect(reg.createWrite('relative.bin', 1)).rejects.toThrow();
  });

  it('配额:第 9 张票拒绝(默认 maxTickets=8)', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const tickets: string[] = [];
    for (let i = 0; i < 8; i++) {
      tickets.push((await reg.createWrite(join(dir, `f${i}.bin`), 1)).ticket);
    }
    expect(reg.size).toBe(8);
    await expect(reg.createWrite(join(dir, 'overflow.bin'), 1)).rejects.toThrow(/too many/i);
    await Promise.all(tickets.map((t) => reg.finish(1, t, false)));
  });
});

describe('LocalTransferRegistry.createRead', () => {
  it('打开成功记录 size,原样回传 path', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'src.txt');
    await writeFile(file, 'hello');
    const reg = new LocalTransferRegistry();
    const info = await reg.createRead(file, 1);
    expect(info.ticket).toMatch(/^[0-9a-f]{16}$/);
    expect(info.name).toBe('src.txt');
    expect(info.size).toBe(5);
    expect(info.path).toBe(file);
    await reg.finish(1, info.ticket, false);
  });

  it('目录传入 → 抛错且不留占用 fd', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    await expect(reg.createRead(dir, 1)).rejects.toThrow();
    expect(reg.size).toBe(0); // 失败的 createRead 不占配额(fd 已回收)
  });

  it('配额:读写合计第 9 张票拒绝', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const file = join(dir, 'src.txt');
    await writeFile(file, 'x');
    const tickets: string[] = [];
    for (let i = 0; i < 4; i++) {
      tickets.push((await reg.createWrite(join(dir, `w${i}.bin`), 1)).ticket);
      tickets.push((await reg.createRead(file, 1)).ticket);
    }
    expect(reg.size).toBe(8);
    await expect(reg.createRead(file, 1)).rejects.toThrow(/too many/i);
    await Promise.all(tickets.map((t) => reg.finish(1, t, false)));
  });
});

// ---------------------------------------------------------------------------
describe('sender 归属校验(write/read/finish 三处)', () => {
  it('write:sender 不符拒,owner 仍可正常写', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    const b64 = Buffer.from('x').toString('base64');
    await expect(reg.write(2, ticket, 0, b64)).rejects.toThrow();
    await expect(reg.write(1, ticket, 0, b64)).resolves.toEqual({ written: 1 });
    await reg.finish(1, ticket, false);
  });

  it('read:sender 不符拒,owner 仍可正常读', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createRead(file, 1);
    await expect(reg.read(2, ticket, 0, 5)).rejects.toThrow();
    await expect(reg.read(1, ticket, 0, 5)).resolves.toMatchObject({ bytes: 5, eof: true });
    await reg.finish(1, ticket, false);
  });

  it('finish:sender 不符拒(票据不因此消失,owner 后续仍可 finish)', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const finalPath = join(dir, 'a.bin');
    const { ticket } = await reg.createWrite(finalPath, 1);
    await reg.write(1, ticket, 0, Buffer.from('hi').toString('base64'));

    await expect(reg.finish(2, ticket, false)).rejects.toThrow();
    await expect(reg.finish(2, ticket, true)).rejects.toThrow();

    const { path } = await reg.finish(1, ticket, true);
    expect(path).toBe(finalPath);
    expect((await readFile(finalPath)).toString('utf8')).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry.write', () => {
  it('乱序写按 offset 落位,最终内容逐字节正确', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const finalPath = join(dir, 'shuffled.bin');
    const { ticket } = await reg.createWrite(finalPath, 1);

    // 故意乱序:先写后半段,再写前半段
    await reg.write(1, ticket, 5, Buffer.from('world').toString('base64'));
    await reg.write(1, ticket, 0, Buffer.from('hello').toString('base64'));

    const { path } = await reg.finish(1, ticket, true);
    expect((await readFile(path as string)).toString('utf8')).toBe('helloworld');
  });

  it('非法 base64 拒:字符集非法', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    await expect(reg.write(1, ticket, 0, '!!!not-base64!!!')).rejects.toThrow();
    await reg.finish(1, ticket, false);
  });

  it('非法 base64 拒:长度不是 4 的倍数', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    await expect(reg.write(1, ticket, 0, 'abcde')).rejects.toThrow();
    await reg.finish(1, ticket, false);
  });

  it('非法 base64 拒:空字符串', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    await expect(reg.write(1, ticket, 0, '')).rejects.toThrow();
    await reg.finish(1, ticket, false);
  });

  it('超过 maxChunkBytes 的块拒绝', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry({ maxChunkBytes: 4 });
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    const tooBig = Buffer.from('abcdef').toString('base64'); // 6 bytes > 4
    await expect(reg.write(1, ticket, 0, tooBig)).rejects.toThrow();
    await reg.finish(1, ticket, false);
  });

  it('未知 ticket 拒', async () => {
    const reg = new LocalTransferRegistry();
    await expect(reg.write(1, 'deadbeefdeadbeef', 0, 'aGk=')).rejects.toThrow();
  });

  it('对读票调用 write 拒(kind 不符)', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hi');
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createRead(file, 1);
    await expect(reg.write(1, ticket, 0, 'aGk=')).rejects.toThrow();
    await reg.finish(1, ticket, false);
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry.read', () => {
  it('越界读:offset === size → bytes=0,eof=true,不抛错', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'abc');
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createRead(file, 1);
    const res = await reg.read(1, ticket, 3, 10);
    expect(res.bytes).toBe(0);
    expect(res.eof).toBe(true);
    expect(res.base64).toBe('');
    await reg.finish(1, ticket, false);
  });

  it('越界读:offset 远超 size → bytes=0,eof=true', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'abc');
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createRead(file, 1);
    const res = await reg.read(1, ticket, 999, 10);
    expect(res.bytes).toBe(0);
    expect(res.eof).toBe(true);
    await reg.finish(1, ticket, false);
  });

  it('中间分块:length 小于剩余字节 → eof=false,窗口精确', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'b.txt');
    await writeFile(file, '0123456789');
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createRead(file, 1);
    const res = await reg.read(1, ticket, 2, 3);
    expect(Buffer.from(res.base64, 'base64').toString('utf8')).toBe('234');
    expect(res.bytes).toBe(3);
    expect(res.eof).toBe(false);
    await reg.finish(1, ticket, false);
  });

  it('文件被改写后读取 → 返回新 mtimeMs 与新 size', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'c.txt');
    await writeFile(file, 'short');
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createRead(file, 1);
    const first = await reg.read(1, ticket, 0, 5);

    // 等待一个 tick 再改写,确保 mtimeMs 有机会变化(部分文件系统 mtime 精度较粗,
    // 用显式 utimes 会更稳,这里改写内容 + 轮询直到 mtimeMs 变化或超时)。
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(file, 'a much longer replacement content');

    const second = await reg.read(1, ticket, 0, 100);
    expect(second.size).toBe(Buffer.byteLength('a much longer replacement content'));
    expect(second.size).not.toBe(first.size);
    expect(second.mtimeMs).not.toBe(first.mtimeMs);
    await reg.finish(1, ticket, false);
  });

  it('未知 ticket 拒', async () => {
    const reg = new LocalTransferRegistry();
    await expect(reg.read(1, 'deadbeefdeadbeef', 0, 10)).rejects.toThrow();
  });

  it('对写票调用 read 拒(kind 不符)', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    await expect(reg.read(1, ticket, 0, 10)).rejects.toThrow();
    await reg.finish(1, ticket, false);
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry.finish', () => {
  it('写票 commit=true:目标此前不存在,commit 后存在且 part 消失,内容正确', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const finalPath = join(dir, 'result.bin');
    const { ticket } = await reg.createWrite(finalPath, 1);
    expect(await exists(finalPath)).toBe(false);

    await reg.write(1, ticket, 0, Buffer.from('abcde').toString('base64'));
    const { path } = await reg.finish(1, ticket, true);

    expect(path).toBe(finalPath);
    expect(await exists(finalPath)).toBe(true);
    expect((await readFile(finalPath)).toString('utf8')).toBe('abcde');
    expect(await partFiles(dir)).toHaveLength(0);
  });

  it('覆盖语义:finalPath 已存在时 commit 后被覆盖(本机保存对话框已确认覆盖)', async () => {
    const dir = await makeTemp();
    const finalPath = join(dir, 'dup.bin');
    await writeFile(finalPath, 'old content');

    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(finalPath, 1);
    await reg.write(1, ticket, 0, Buffer.from('new').toString('base64'));
    const { path } = await reg.finish(1, ticket, true);

    expect(path).toBe(finalPath);
    expect((await readFile(finalPath)).toString('utf8')).toBe('new');
  });

  it('写票 commit=false:删 part,不落地目标文件', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const finalPath = join(dir, 'aborted.bin');
    const { ticket } = await reg.createWrite(finalPath, 1);
    await reg.write(1, ticket, 0, Buffer.from('abc').toString('base64'));

    const { path } = await reg.finish(1, ticket, false);
    expect(path).toBeNull();
    expect(await exists(finalPath)).toBe(false);
    expect(await partFiles(dir)).toHaveLength(0);
  });

  it('读票:finish 只 close,忽略 commit 值,不产出 path', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'hello');
    const reg = new LocalTransferRegistry();

    const { ticket: t1 } = await reg.createRead(file, 1);
    const r1 = await reg.finish(1, t1, true);
    expect(r1.path).toBeNull();

    const { ticket: t2 } = await reg.createRead(file, 1);
    const r2 = await reg.finish(1, t2, false);
    expect(r2.path).toBeNull();

    // 读票 finish 绝不删源文件
    expect(await exists(file)).toBe(true);
    expect((await readFile(file)).toString('utf8')).toBe('hello');
  });

  it('finish 后释放配额:可立即开新票', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    await reg.finish(1, ticket, false);
    expect(reg.size).toBe(0);
    const second = await reg.createWrite(join(dir, 'b.bin'), 1);
    expect(second).toBeDefined();
    await reg.finish(1, second.ticket, false);
  });

  it('未知 ticket + commit=false → 幂等返回 path=null,不抛错', async () => {
    const reg = new LocalTransferRegistry();
    await expect(reg.finish(1, 'deadbeefdeadbeef', false)).resolves.toEqual({ path: null });
  });

  it('未知 ticket + commit=true → 抛错', async () => {
    const reg = new LocalTransferRegistry();
    await expect(reg.finish(1, 'deadbeefdeadbeef', true)).rejects.toThrow();
  });

  it('commit 提交失败(rename 目标已被同名目录占着)→ part 被清理,不留孤儿件,原始错误向外抛', async () => {
    const dir = await makeTemp();
    const finalPath = join(dir, 'blocked.bin');
    await mkdir(finalPath); // 目标路径已存在且是目录,文件 rename 到此处必然失败(EISDIR)
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(finalPath, 1);
    await reg.write(1, ticket, 0, Buffer.from('data').toString('base64'));

    await expect(reg.finish(1, ticket, true)).rejects.toThrow();

    // 票据已从注册表摘除(finish 一开始就 delete),但此前的 bug 是:提交失败后
    // part 临时文件永久残留、sweepIdle 也追踪不到——这里断言 part 已被清理。
    expect(await partFiles(dir)).toHaveLength(0);
    expect(await exists(finalPath)).toBe(true); // 目标目录原样保留,未被误删/误改
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry.abortBySender', () => {
  it('清该 sender 全部票(含删 part),且不动他人票据', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket: mine1 } = await reg.createWrite(join(dir, 'a.bin'), 1);
    const { ticket: mine2 } = await reg.createWrite(join(dir, 'b.bin'), 1);
    const otherFile = join(dir, 'c.bin');
    const { ticket: other } = await reg.createWrite(otherFile, 2);
    await reg.write(2, other, 0, Buffer.from('keep').toString('base64'));

    await reg.abortBySender(1);

    expect(reg.size).toBe(1);
    // 点前缀命名(P2-2):part 文件是 `.a.bin.okwork-part-*`,不是 `a.bin.okwork-part-*`。
    expect(await exists(join(dir, `.a.bin.okwork-part-${mine1}`))).toBe(false);
    expect(await exists(join(dir, `.b.bin.okwork-part-${mine2}`))).toBe(false);
    // 别人的票据/part 原样保留
    const { path } = await reg.finish(2, other, true);
    expect(path).toBe(otherFile);
    expect((await readFile(otherFile)).toString('utf8')).toBe('keep');
  });

  it('清理对象含读票(只关 fd,不删源文件)', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'src.txt');
    await writeFile(file, 'hello');
    const reg = new LocalTransferRegistry();
    await reg.createRead(file, 1);
    expect(reg.size).toBe(1);

    await reg.abortBySender(1);

    expect(reg.size).toBe(0);
    expect(await exists(file)).toBe(true);
    expect((await readFile(file)).toString('utf8')).toBe('hello');
  });

  it('无匹配 sender 时空操作,不抛错', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    await expect(reg.abortBySender(999)).resolves.toBeUndefined();
    expect(reg.size).toBe(1);
    await reg.finish(1, ticket, false);
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry.sweepIdle', () => {
  it('只清过期票据,未过期的原样保留', async () => {
    const dir = await makeTemp();
    let now = 1_000_000;
    const reg = new LocalTransferRegistry({ idleTtlMs: 1000, now: () => now });

    const { ticket: stale } = await reg.createWrite(join(dir, 'stale.bin'), 1);
    now += 500;
    const { ticket: fresh } = await reg.createWrite(join(dir, 'fresh.bin'), 1);

    // 推进到:stale 创建时刻起已过 1000ms(过期),fresh 创建时刻起仅过 500ms(未过期)
    now += 600;
    await reg.sweepIdle();

    expect(reg.size).toBe(1);
    await expect(reg.write(1, stale, 0, 'aGk=')).rejects.toThrow(); // 已被清
    await expect(reg.write(1, fresh, 0, 'aGk=')).resolves.toEqual({ written: 2 }); // 仍在

    expect(await partFiles(dir)).toHaveLength(1);
    expect((await partFiles(dir))[0]).toContain(fresh);
    await reg.finish(1, fresh, false);
  });

  it('touch:操作会刷新 lastUsedAt,阻止其被 TTL 清理', async () => {
    const dir = await makeTemp();
    let now = 0;
    const reg = new LocalTransferRegistry({ idleTtlMs: 1000, now: () => now });
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);

    now += 900;
    await reg.write(1, ticket, 0, Buffer.from('x').toString('base64')); // touch lastUsedAt=900

    now += 900; // 距创建 1800ms(会被旧 lastUsedAt 判过期),但距 touch 仅 900ms
    await reg.sweepIdle();

    expect(reg.size).toBe(1); // 因为 touch 刷新过,未被清
    await reg.finish(1, ticket, false);
  });

  it('空登记表 sweep 不抛错', async () => {
    const reg = new LocalTransferRegistry();
    await expect(reg.sweepIdle()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('LocalTransferRegistry 默认参数与 TRANSFER 常量对齐', () => {
  it('maxChunkBytes 默认取自 TRANSFER.maxChunkBytes', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();
    const { ticket } = await reg.createWrite(join(dir, 'a.bin'), 1);
    // 精确等于上限的块应被接受(不抛)
    const exact = Buffer.alloc(TRANSFER.maxChunkBytes, 1).toString('base64');
    await expect(reg.write(1, ticket, 0, exact)).resolves.toBeDefined();
    await reg.finish(1, ticket, false);
  });
});

// ---------------------------------------------------------------------------
// 🔴 并发安全(check-then-act):assertQuota 读 tickets.size 与登记进 tickets 之间跨越
// 至少一次 await(fsp.open/handle.stat),并发调用曾经能在这个窗口里一起穿过配额闸门。
describe('LocalTransferRegistry: 配额 check-then-act 并发安全', () => {
  it('并发 createWrite 超限:恰好 maxTickets 张成功,其余按配额拒绝(非 TOCTOU 穿关)', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry({ maxTickets: 4 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => reg.createWrite(join(dir, `f${i}.bin`), 1)),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ ticket: string; name: string }> => r.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(4);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(6);
    for (const r of rejected) expect(String(r.reason)).toMatch(/too many/i);
    expect(reg.size).toBe(4); // 不多不少,恰好 maxTickets 张真正登记进注册表

    // 收尾:释放本测试开的票据(避免 FileHandle 未 close,GC 期触发 Node 的告警/报错)。
    await Promise.all(fulfilled.map((r) => reg.finish(1, r.value.ticket, false)));
  });

  it('并发 createWrite + createRead 混合超限:配额是读写合计的单一预算,恰好 maxTickets 张成功', async () => {
    const dir = await makeTemp();
    const file = join(dir, 'src.txt');
    await writeFile(file, 'hi');
    const reg = new LocalTransferRegistry({ maxTickets: 4 });

    const results = await Promise.allSettled([
      reg.createWrite(join(dir, 'w0.bin'), 1),
      reg.createRead(file, 1),
      reg.createWrite(join(dir, 'w1.bin'), 1),
      reg.createRead(file, 1),
      reg.createWrite(join(dir, 'w2.bin'), 1), // 第 5 个,应被拒
      reg.createRead(file, 1), // 第 6 个,应被拒
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<
      PromiseFulfilledResult<{ ticket: string }>
    >;
    expect(fulfilled).toHaveLength(4);
    expect(reg.size).toBe(4);

    await Promise.all(fulfilled.map((r) => reg.finish(1, r.value.ticket, false)));
  });
});

// ---------------------------------------------------------------------------
describe('collectReadTickets(transfer:begin-open 编排:批量开票 + 中途失败回滚)', () => {
  it('全部成功:按输入顺序返回全部票据', async () => {
    const dir = await makeTemp();
    const f1 = join(dir, 'a.txt');
    await writeFile(f1, 'a');
    const f2 = join(dir, 'b.txt');
    await writeFile(f2, 'b');
    const reg = new LocalTransferRegistry();

    const tickets = await collectReadTickets(reg, [f1, f2], 1);

    expect(tickets.map((t) => t.name)).toEqual(['a.txt', 'b.txt']);
    expect(reg.size).toBe(2);

    await Promise.all(tickets.map((t) => reg.finish(1, t.ticket, false)));
  });

  it('中途失败(第 3 个超配额)→ 已建的前两张票全部回滚,注册表不留孤儿,原始错误向外抛', async () => {
    const dir = await makeTemp();
    const f1 = join(dir, 'a.txt');
    await writeFile(f1, 'a');
    const f2 = join(dir, 'b.txt');
    await writeFile(f2, 'b');
    const f3 = join(dir, 'c.txt');
    await writeFile(f3, 'c');
    const reg = new LocalTransferRegistry({ maxTickets: 2 });

    await expect(collectReadTickets(reg, [f1, f2, f3], 1)).rejects.toThrow(/too many/i);

    expect(reg.size).toBe(0); // 前两张票已回滚,配额没有被半成功的一批永久占住
  });

  it('第一个文件就失败(路径是目录)→ 零票据已建,直接抛错,无需回滚', async () => {
    const dir = await makeTemp();
    const reg = new LocalTransferRegistry();

    await expect(collectReadTickets(reg, [dir], 1)).rejects.toThrow();

    expect(reg.size).toBe(0);
  });
});
