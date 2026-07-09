// AC-3 token 闸:熵/常量时间/信道白名单/生命周期/env 读后即抹/失败告警不阻断。
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  generateToken,
  resolveToken,
  verifyToken,
  TOKEN_ENV,
} from '../token';
import { startWsServer } from '../wsServer';
import { createHostCore } from '../hostCore';
import { startTestHost, TestClient, TestHost, waitFor, delay } from './wsTestHarness';

let host: TestHost | null = null;
const clients: TestClient[] = [];
const tmpFiles: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env[TOKEN_ENV];
  for (const c of clients.splice(0)) c.close();
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
  if (host) {
    await host.close();
    host = null;
  }
});

function track(c: TestClient): TestClient {
  clients.push(c);
  return c;
}

// ---------------------------------------------------------------- 单元:token.ts

describe('AC-3 token 熵与常量时间 (单元)', () => {
  it('T-014 自动生成 token 具备 128-bit 熵', () => {
    const t = generateToken();
    expect(Buffer.from(t, 'base64url').length).toBe(16); // 16 字节 = 128 bit
    // 单行、无空白(供 stdout 单行捕获)
    expect(t).not.toMatch(/\s/);
  });

  it('T-015 token 比较使用常量时间原语 timingSafeEqual(结构审查)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'token.ts'),
      'utf8',
    );
    // 实现引用 timingSafeEqual,且不以 === / 字符串逐字比较 token
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).not.toMatch(/provided\s*===\s*expected/);
    // 行为:正确→true,错误→false,不同长度错误 token 不抛错
    expect(verifyToken('abc', 'abc')).toBe(true);
    expect(verifyToken('abc', 'abd')).toBe(false);
    expect(verifyToken('short', 'a-much-longer-token-value')).toBe(false);
    expect(verifyToken(undefined, 'abc')).toBe(false);
  });
});

describe('AC-3 token 信道白名单 (单元)', () => {
  it('T-024 argv 明文 --token 被拒绝(抛错)', () => {
    expect(() =>
      resolveToken(['--listen', '127.0.0.1:0', '--token', 'plaintext']),
    ).toThrow(/--token/);
  });

  it('T-025 env 通道接受,且读后立即从 process.env 抹除(TC-T4 顺序断言)', () => {
    process.env[TOKEN_ENV] = 'env-secret-token';
    const { token, source } = resolveToken(['--listen', '127.0.0.1:0'], process.env);
    expect(source).toBe('env');
    expect(token).toBe('env-secret-token');
    // 关键:读后 process.env 已 delete —— 置于任何 pool.spawn 之前
    expect(process.env[TOKEN_ENV]).toBeUndefined();
  });

  it('T-026 stdin 通道接受(读 fd 0)', () => {
    const readFds: number[] = [];
    const { token, source } = resolveToken(
      ['--listen', '127.0.0.1:0', '--token-stdin'],
      {},
      {
        readFd: (fd) => {
          readFds.push(fd);
          return 'stdin-token\n';
        },
      },
    );
    expect(source).toBe('stdin');
    expect(token).toBe('stdin-token'); // trim 掉换行
    expect(readFds).toEqual([0]); // 读的是 fd 0
  });

  it('T-027 继承 fd 通道接受', () => {
    const f = path.join(os.tmpdir(), `tp-tok-fd-${Date.now()}`);
    tmpFiles.push(f);
    fs.writeFileSync(f, 'fd-token\n');
    const fd = fs.openSync(f, 'r');
    try {
      const { token, source } = resolveToken(
        ['--listen', '127.0.0.1:0', '--token-fd', String(fd)],
        {},
      );
      expect(source).toBe('fd');
      expect(token).toBe('fd-token');
    } finally {
      fs.closeSync(fd);
    }
  });

  it('T-028 0600 文件接受,权限弱于 0600(0644)拒绝', () => {
    const f = path.join(os.tmpdir(), `tp-tok-file-${Date.now()}`);
    tmpFiles.push(f);
    fs.writeFileSync(f, 'file-token\n', { mode: 0o600 });
    fs.chmodSync(f, 0o600);
    const ok = resolveToken(['--listen', '127.0.0.1:0', '--token-file', f], {});
    expect(ok.source).toBe('file');
    expect(ok.token).toBe('file-token');
    // 放宽到 0644 → 拒绝
    fs.chmodSync(f, 0o644);
    expect(() =>
      resolveToken(['--listen', '127.0.0.1:0', '--token-file', f], {}),
    ).toThrow(/0600/);
  });

  it('T-023 未显式传入时自动生成(单行,可 stdout 捕获)', () => {
    const { token, source } = resolveToken(['--listen', '127.0.0.1:0'], {});
    expect(source).toBe('generated');
    expect(token.includes('\n')).toBe(false);
    // host.ts 入口以 `[host] token=%s` 单行打印;此处验证 token 本身单行
    expect(`[host] token=${token}`.split('\n').length).toBe(1);
  });
});

// ---------------------------------------------------------- 集成:loopback + 闸

describe('AC-3 token 闸 (集成:真实 ws)', () => {
  it('T-016/T-017/T-018 缺失与错误 token 都立即断开、零信息且不可区分', async () => {
    host = await startTestHost({ token: 'the-right-token' });
    const missing = track(new TestClient(host.url(null)));
    const wrong = track(new TestClient(host.url('the-WRONG-token')));
    const missingErr = await missing.waitOpen().then(
      () => 'opened',
      () => 'rejected',
    );
    const wrongErr = await wrong.waitOpen().then(
      () => 'opened',
      () => 'rejected',
    );
    // 两者都进不来
    expect(missingErr).toBe('rejected');
    expect(wrongErr).toBe('rejected');
    // 都没有拿到 WS 层的正常关闭码(socket 被 destroy,无差异化 reason)
    expect(missing.ws.readyState).not.toBe(1); // 非 OPEN
    expect(wrong.ws.readyState).not.toBe(1);
    // 无任何 rpc:res 泄露
    expect(missing.messages.length).toBe(0);
    expect(wrong.messages.length).toBe(0);
  });

  it('T-019 正确 token → 正常连接并进入握手', async () => {
    host = await startTestHost({ token: 'the-right-token' });
    const c = track(new TestClient(host.url()));
    const info = await c.handshake();
    expect(info.hostId).toBe('local');
  });

  it('T-020/T-021 失败告警:窗内≥10 次失败 emit WARN 但不阻断后续合法连接', async () => {
    host = await startTestHost({ token: 'right' });
    // 12 次错误 token 连接(每个是不同 ws = 不同源端口,共享同一计数器)
    for (let i = 0; i < 12; i++) {
      const bad = track(new TestClient(host.url(`wrong-${i}`)));
      await bad.waitOpen().catch(() => {});
    }
    await waitFor(() => host!.authAlerts.length > 0, 2000);
    // 告警已触发(计数按尝试累加,不按源地址分桶)
    expect(host.authAlerts[host.authAlerts.length - 1]).toBeGreaterThanOrEqual(10);
    expect(host.logs.some((l) => l.includes('repeated ws auth failures'))).toBe(
      true,
    );
    // 关键:不阻断 —— 阈值后合法连接仍成功(external CR-3 告警 only)
    const good = track(new TestClient(host.url()));
    const info = await good.handshake();
    expect(info.protocolVersion).toBe(1);
  });

  it('T-022 host 只绑定 loopback,拒绝 0.0.0.0', async () => {
    const core = createHostCore();
    await expect(
      startWsServer({
        host: '0.0.0.0',
        port: 0,
        token: 'x',
        attachClient: (p) => core.attachClient(p),
      }),
    ).rejects.toThrow(/loopback/);
    // 正例:127.0.0.1 绑定成功且地址为 loopback
    host = await startTestHost();
    expect(host.handle.address).toBe('127.0.0.1');
  });

  it('T-029 token 进程存活期内固定:多次连接复用同一 token', async () => {
    host = await startTestHost({ token: 'stable-token' });
    for (let i = 0; i < 3; i++) {
      const c = track(new TestClient(host.url()));
      const info = await c.handshake();
      expect(info.protocolVersion).toBe(1);
      c.close();
      await delay(20);
    }
  });

  it('T-030 env token 不泄露进 spawned PTY 环境', async () => {
    process.env[TOKEN_ENV] = 'super-secret-leak-check';
    // 模拟 host 入口:先 resolveToken(删 env),再起 host/spawn
    const { token } = resolveToken(['--listen', '127.0.0.1:0'], process.env);
    expect(process.env[TOKEN_ENV]).toBeUndefined(); // 顺序:spawn 前已抹
    host = await startTestHost({ token });
    const c = track(new TestClient(host.url()));
    await c.handshake();
    const { sessionId } = (await c.rpc('pty.spawn', {
      cwd: process.cwd(),
      shell: '/bin/sh',
      cols: 80,
      rows: 24,
    })) as { sessionId: string };
    // 在 PTY 内打印该变量:应为空(未继承)。
    // 关键:sentinel 用 shell 拼接构造(LEAK[ + $VAR + ]END),使字面量 `LEAK[]END`
    // 只出现在**命令输出**里,绝不出现在终端回显的输入行(输入行含引号与 $VAR),
    // 从而 waitFor 不会被输入回显提前触发(PTY 测试竞态防护)。
    c.send({
      t: 'pty:input',
      sessionId,
      data: 'echo "LEAK["""$TERMPRO_HOST_TOKEN"""]END"\n',
    });
    await waitFor(
      () => (c.ptyData.get(sessionId) ?? '').includes('LEAK[]END'),
      10000,
    );
    const out = c.ptyData.get(sessionId) ?? '';
    expect(out).toContain('LEAK[]END');
    expect(out).not.toContain('super-secret-leak-check');
    c.send({ t: 'rpc:req', id: 999, method: 'pty.kill', params: { sessionId } });
  });
});
