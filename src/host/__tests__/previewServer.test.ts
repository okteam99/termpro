// 项目内 HTML 预览(阶段 1):真实 http.Server(createPreviewRegistry)+ node:http 客户端
// + tmpdir。覆盖设计定稿的全部场景:生命周期幂等/并发去重/LRU、请求流水线(方法/
// loopback/鉴权/containment/目录/FIFO)、Referer 回退、根删除自清理,以及四个纯函数
// 的表驱动测试。不碰 ws/hostCore —— previewServer.ts 本身零第三方依赖,直测最贴近设计。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  createPreviewRegistry,
  parsePreviewUrlPath,
  mimeFor,
  isLoopbackHostHeader,
  tokenFromReferer,
  PreviewRegistry,
} from '../previewServer';

let tmp = '';
let registry: PreviewRegistry | null = null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-preview-'));
});

afterEach(async () => {
  if (registry) {
    await registry.stopAll();
    registry = null;
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function mkRegistry(opts?: Parameters<typeof createPreviewRegistry>[0]): PreviewRegistry {
  registry = createPreviewRegistry(opts);
  return registry;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** 极简裸 http 客户端:不跟随重定向,不解析 body,原样回收 status/headers/body。 */
function request(
  port: number,
  urlPath: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: opts.method ?? 'GET',
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await delay(stepMs);
  }
  if (!cond()) throw new Error('waitFor timed out');
}

// ---- 1. ensure 幂等 / 并发去重 / 不同 root 不同实例 ------------------------

describe('ensure: 幂等 / 并发去重', () => {
  it('同 root 复用同 {port,token},刷新态不影响相等性;不同 root 得不同实例', async () => {
    const reg = mkRegistry();
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-preview-b-'));
    try {
      const i1 = await reg.ensure(tmp);
      const i2 = await reg.ensure(tmp);
      expect(i2).toEqual(i1);
      const i3 = await reg.ensure(rootB);
      expect(i3.port).not.toBe(i1.port);
      expect(i3.token).not.toBe(i1.token);
      expect(reg.list().length).toBe(2);
    } finally {
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('并发 ensure(同 root) 只起一个 server:token 只生成一次', async () => {
    let calls = 0;
    const reg = mkRegistry({
      makeToken: () => {
        calls++;
        return `tok-${calls}`;
      },
    });
    const [a, b, c] = await Promise.all([reg.ensure(tmp), reg.ensure(tmp), reg.ensure(tmp)]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(calls).toBe(1);
    expect(reg.list().length).toBe(1);
  });

  it('root 非目录(文件)→ reject;root 不存在 → reject', async () => {
    const reg = mkRegistry();
    const filePath = path.join(tmp, 'notadir.txt');
    fs.writeFileSync(filePath, 'x');
    await expect(reg.ensure(filePath)).rejects.toThrow(/not a directory/);
    await expect(reg.ensure(path.join(tmp, 'does-not-exist'))).rejects.toThrow();
  });
});

// ---- 2. 正常取文件 -----------------------------------------------------

describe('正常取文件', () => {
  it('200 + 正确 MIME + no-store + 三安全头 + 字节一致', async () => {
    const reg = mkRegistry();
    const content = 'body{color:red}';
    fs.writeFileSync(path.join(tmp, 'a.css'), content);
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/a.css`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['accept-ranges']).toBe('none');
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(content)));
    expect(res.body.toString('utf8')).toBe(content);
  });

  it('HEAD 与 GET 头一致但无 body', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/a.txt`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body.length).toBe(0);
  });
});

// ---- 3. token 缺失/错误/长度不同 → 404 ------------------------------------

describe('鉴权失败 → 404 空体', () => {
  it('token 缺失 / 错误(同长)/ 长度不同,一律 404 空体', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hi');
    const info = await reg.ensure(tmp);

    const missing = await request(info.port, '/nope-a-file.txt');
    expect(missing.status).toBe(404);
    expect(missing.body.length).toBe(0);

    const sameLenWrong =
      info.token.slice(0, -1) + (info.token.at(-1) === 'A' ? 'B' : 'A');
    const wrongSameLen = await request(info.port, `/${sameLenWrong}/a.txt`);
    expect(wrongSameLen.status).toBe(404);
    expect(wrongSameLen.body.length).toBe(0);

    const wrongDiffLen = await request(info.port, `/short/a.txt`);
    expect(wrongDiffLen.status).toBe(404);
    expect(wrongDiffLen.body.length).toBe(0);
  });
});

// ---- 4. 路径穿越 --------------------------------------------------------

describe('路径穿越:拒绝且不读 root 外', () => {
  it('/T/../../etc/passwd → 404(traversal 被拦,不冒充别的 token)', async () => {
    const reg = mkRegistry();
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/../../etc/passwd`);
    expect([403, 404]).toContain(res.status);
    expect(res.body.length).toBe(0);
  });

  it('%2e%2e%2f(编码 ../)→ 404', async () => {
    const reg = mkRegistry();
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/%2e%2e%2f`);
    expect([403, 404]).toContain(res.status);
  });

  it('/T//etc/passwd(中间空段)→ 404', async () => {
    const reg = mkRegistry();
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}//etc/passwd`);
    expect([403, 404]).toContain(res.status);
  });

  it('含 NUL 段(%00)→ 404', async () => {
    const reg = mkRegistry();
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/%00`);
    expect([403, 404]).toContain(res.status);
  });
});

// ---- 5. 软链逃逸 --------------------------------------------------------

describe('软链逃逸', () => {
  it('root 内软链指向 tmpdir 外 → 403', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-preview-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    fs.symlinkSync(outside, path.join(tmp, 'escape'));
    const reg = mkRegistry();
    const info = await reg.ensure(tmp);
    try {
      const res = await request(info.port, `/${info.token}/escape/secret.txt`);
      expect(res.status).toBe(403);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ---- 6. 目录:重定向 / index.html / 永不列目录 -----------------------------

describe('目录处理', () => {
  it('无尾斜杠 301;有 index.html 200;无 index.html 404 且体内不含条目名', async () => {
    const reg = mkRegistry();
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'index.html'), '<h1>hi</h1>');
    fs.mkdirSync(path.join(tmp, 'empty'));
    fs.writeFileSync(path.join(tmp, 'empty', 'secret-entry-name.txt'), 'x');
    const info = await reg.ensure(tmp);

    const noSlash = await request(info.port, `/${info.token}/sub`);
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.location).toBe(`/${info.token}/sub/`);

    const withIndex = await request(info.port, `/${info.token}/sub/`);
    expect(withIndex.status).toBe(200);
    expect(withIndex.body.toString('utf8')).toBe('<h1>hi</h1>');

    const noIndex = await request(info.port, `/${info.token}/empty/`);
    expect(noIndex.status).toBe(404);
    expect(noIndex.body.toString('utf8')).not.toContain('secret-entry-name.txt');
  });

  it('root 自身(无尾斜杠)→ 301;root 自身(尾斜杠 + index.html)→ 200', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'index.html'), 'ROOT');
    const info = await reg.ensure(tmp);
    const noSlash = await request(info.port, `/${info.token}`);
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.location).toBe(`/${info.token}/`);
    const withSlash = await request(info.port, `/${info.token}/`);
    expect(withSlash.status).toBe(200);
    expect(withSlash.body.toString('utf8')).toBe('ROOT');
  });
});

// ---- 7. Referer 回退 -----------------------------------------------------

describe('Referer 回退(根绝对引用)', () => {
  it('同源合法 Referer → 200;跨源/无 Referer → 404', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'a.css'), 'x{}');
    const info = await reg.ensure(tmp);
    const selfOrigin = `http://127.0.0.1:${info.port}`;

    const ok = await request(info.port, '/a.css', {
      headers: { Referer: `${selfOrigin}/${info.token}/index.html` },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.toString('utf8')).toBe('x{}');

    const crossOrigin = await request(info.port, '/a.css', {
      headers: { Referer: `http://127.0.0.1:9/${info.token}/index.html` },
    });
    expect(crossOrigin.status).toBe(404);

    const noReferer = await request(info.port, '/a.css');
    expect(noReferer.status).toBe(404);

    const wrongTokenReferer = await request(info.port, '/a.css', {
      headers: { Referer: `${selfOrigin}/not-the-token/index.html` },
    });
    expect(wrongTokenReferer.status).toBe(404);
  });
});

// ---- 8. 方法 / Host 头 ----------------------------------------------------

describe('方法与 Host 头守卫', () => {
  it('POST → 405 + Allow: GET, HEAD', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hi');
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/a.txt`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  it('Host: evil.com → 403', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hi');
    const info = await reg.ensure(tmp);
    const res = await request(info.port, `/${info.token}/a.txt`, {
      headers: { Host: 'evil.com' },
    });
    expect(res.status).toBe(403);
  });
});

// ---- 9. FIFO 不挂起 -------------------------------------------------------

const hasMkfifo = (() => {
  try {
    const probe = path.join(os.tmpdir(), `tp-preview-mkfifo-probe-${process.pid}`);
    execFileSync('mkfifo', [probe]);
    fs.rmSync(probe);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasMkfifo)('FIFO 请求不挂死', () => {
  it('FIFO → 404(带超时,证明未阻塞在 open)', async () => {
    const reg = mkRegistry();
    const fifoPath = path.join(tmp, 'pipe');
    execFileSync('mkfifo', [fifoPath]);
    const info = await reg.ensure(tmp);
    const res = await Promise.race([
      request(info.port, `/${info.token}/pipe`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('preview request timed out (FIFO hang?)')), 3000),
      ),
    ]);
    expect(res.status).toBe(404);
  });
});

// ---- 10. stop 后端口拒连;再 ensure → 新端口新 token ------------------------

describe('stop / 重新 ensure', () => {
  it('stop 后端口拒连;再 ensure → 新端口新 token', async () => {
    const reg = mkRegistry();
    const info1 = await reg.ensure(tmp);
    const stopped = await reg.stop(tmp);
    expect(stopped).toBe(true);
    await expect(request(info1.port, `/${info1.token}/`)).rejects.toThrow();

    const info2 = await reg.ensure(tmp);
    expect(info2.port).not.toBe(info1.port);
    expect(info2.token).not.toBe(info1.token);
  });

  it('stop 不存在的 root → false', async () => {
    const reg = mkRegistry();
    expect(await reg.stop(tmp)).toBe(false);
  });
});

// ---- 11. maxServers LRU --------------------------------------------------

describe('maxServers LRU', () => {
  it('maxServers=2:第 3 个 ensure 淘汰最旧', async () => {
    const reg = mkRegistry({ maxServers: 2 });
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-preview-b-'));
    const rootC = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-preview-c-'));
    try {
      const infoA = await reg.ensure(tmp);
      await delay(5);
      await reg.ensure(rootB);
      await delay(5);
      await reg.ensure(rootC); // 触发淘汰:A 是 lastUsedAt 最旧的

      const list = reg.list();
      expect(list.length).toBe(2);
      expect(list.some((i) => i.root === infoA.root)).toBe(false);

      // A 的端口已被关闭(evictLru await 到底,ensure() 返回时保证已摘除)
      await expect(request(infoA.port, `/${infoA.token}/`)).rejects.toThrow();
    } finally {
      fs.rmSync(rootB, { recursive: true, force: true });
      fs.rmSync(rootC, { recursive: true, force: true });
    }
  });
});

// ---- 12. root 删除后自清理 -------------------------------------------------

describe('root 删除后自清理', () => {
  it('请求 404 且 list() 不再含该实例', async () => {
    const reg = mkRegistry();
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hi');
    const info = await reg.ensure(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });

    const res = await request(info.port, `/${info.token}/a.txt`);
    expect(res.status).toBe(404);
    await waitFor(() => reg.list().length === 0);
  });
});

// ---- 13. 纯函数表驱动 ------------------------------------------------------

describe('parsePreviewUrlPath(表驱动)', () => {
  it.each([
    ['/T/a.html', { ok: true, token: 'T', segments: ['a.html'] }],
    ['/T/sub/a.html', { ok: true, token: 'T', segments: ['sub', 'a.html'] }],
    ['/T/', { ok: true, token: 'T', segments: [] }],
    ['/T', { ok: true, token: 'T', segments: [] }],
    ['/', { ok: false, reason: 'empty' }],
    ['', { ok: false, reason: 'empty' }],
    ['/T/../a', { ok: false, reason: 'traversal' }],
    ['/T/./a', { ok: false, reason: 'traversal' }],
    ['/T//a', { ok: false, reason: 'traversal' }],
    ['/T/a%2Fb', { ok: false, reason: 'traversal' }], // 解码后含 /
    ['/T/a%5Cb', { ok: false, reason: 'traversal' }], // 解码后含 \
    ['/T/%00', { ok: false, reason: 'traversal' }],
    ['/T/%zz', { ok: false, reason: 'bad-encoding' }],
    [
      '/%e4%bd%a0%e5%a5%bd/a.html',
      { ok: true, token: '你好', segments: ['a.html'] },
    ],
  ])('parsePreviewUrlPath(%j) -> %j', (input, expected) => {
    expect(parsePreviewUrlPath(input)).toEqual(expected);
  });
});

describe('mimeFor(表驱动)', () => {
  it.each([
    ['a.html', 'text/html; charset=utf-8'],
    ['a.HTML', 'text/html; charset=utf-8'],
    ['a.htm', 'text/html; charset=utf-8'],
    ['a.css', 'text/css; charset=utf-8'],
    ['a.js', 'text/javascript; charset=utf-8'],
    ['a.mjs', 'text/javascript; charset=utf-8'],
    ['a.json', 'application/json; charset=utf-8'],
    ['a.map', 'application/json; charset=utf-8'],
    ['a.svg', 'image/svg+xml'],
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.webp', 'image/webp'],
    ['a.avif', 'image/avif'],
    ['a.ico', 'image/x-icon'],
    ['a.bmp', 'image/bmp'],
    ['a.woff', 'font/woff'],
    ['a.woff2', 'font/woff2'],
    ['a.ttf', 'font/ttf'],
    ['a.otf', 'font/otf'],
    ['a.wasm', 'application/wasm'],
    ['a.txt', 'text/plain; charset=utf-8'],
    ['a.md', 'text/plain; charset=utf-8'],
    ['a.xml', 'application/xml'],
    ['a.csv', 'text/csv'],
    ['a.pdf', 'application/pdf'],
    ['a.mp4', 'video/mp4'],
    ['a.webm', 'video/webm'],
    ['a.mp3', 'audio/mpeg'],
    ['a.wav', 'audio/wav'],
    ['a.ogg', 'audio/ogg'],
    ['a.unknownext', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('mimeFor(%s) === %s', (name, expected) => {
    expect(mimeFor(name)).toBe(expected);
  });
});

describe('isLoopbackHostHeader(表驱动)', () => {
  it.each<[string | undefined, number, boolean]>([
    ['127.0.0.1:1234', 1234, true],
    ['localhost:1234', 1234, true],
    ['LOCALHOST:1234', 1234, true],
    ['[::1]:1234', 1234, true],
    ['127.0.0.1:1234', 5678, false],
    ['evil.com:1234', 1234, false],
    ['127.0.0.1', 1234, false],
    [undefined, 1234, false],
    ['[::1]', 1234, false],
    ['', 1234, false],
  ])('isLoopbackHostHeader(%j, %i) === %s', (h, port, expected) => {
    expect(isLoopbackHostHeader(h, port)).toBe(expected);
  });
});

describe('tokenFromReferer(表驱动)', () => {
  const self = 'http://127.0.0.1:5000';
  it.each<[string | undefined, string, string | null]>([
    ['http://127.0.0.1:5000/TOK/a.html', self, 'TOK'],
    ['http://127.0.0.1:5000/TOK/', self, 'TOK'],
    ['http://127.0.0.1:9999/TOK/a.html', self, null], // 跨源(端口不同)
    ['https://127.0.0.1:5000/TOK/a.html', self, null], // 跨源(协议不同)
    [undefined, self, null],
    ['not a url', self, null],
    ['http://127.0.0.1:5000/', self, null], // 空路径
  ])('tokenFromReferer(%j, self) === %j', (referer, selfOrigin, expected) => {
    expect(tokenFromReferer(referer, selfOrigin)).toBe(expected);
  });
});
