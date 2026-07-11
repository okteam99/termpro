// T-031 · AC-4 ssh localhost 真机兜底:探测本机 sshd 可达(BatchMode 免密)才跑真实
// SshConnection.connect + forwardOut + sftp 往返,验证打包环境三能力(A0 spike 的自动化
// 回归)。不可达 → it.skipIf 降级,skip 原因写进测试名(如实标注,不伪绿)——编排逻辑
// 已由 DI 桩集成测(orchestrator.test.ts / deploy.test.ts / residency.test.ts)覆盖。
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { SshConnection } from '../ssh';

function checkLocalSshdReachable(): boolean {
  try {
    execSync(
      'ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=2 localhost true',
      { stdio: 'ignore', timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

const REACHABLE = checkLocalSshdReachable();
const SKIP_NAME =
  'T-031 ssh localhost connect+forwardOut+sftp 往返 ' +
  (REACHABLE
    ? ''
    : '(skip: no passwordless local sshd reachable; 编排逻辑已由 DI 桩集成测 ' +
      'T-005/T-008/T-010/... 覆盖)');

let conn: SshConnection | null = null;
let echoServer: net.Server | null = null;

afterEach(() => {
  conn?.close();
  conn = null;
  echoServer?.close();
  echoServer = null;
});

describe('AC-4 真机 ssh localhost 兜底', () => {
  it.skipIf(!REACHABLE)(SKIP_NAME, async () => {
    conn = await SshConnection.connect({
      host: 'localhost',
      port: 22,
      auth: { username: os.userInfo().username },
      readyTimeoutMs: 5000,
    });

    // exec 往返
    const echoRes = await conn.exec('echo hello-termpro');
    expect(echoRes.code).toBe(0);
    expect(echoRes.stdout.trim()).toBe('hello-termpro');

    // sftp 往返:本地建一个小目录,上传后读回比对
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termpro-sftp-src-'));
    const remoteBase = fs.mkdtempSync(path.join(os.tmpdir(), 'termpro-sftp-dst-'));
    const remoteDir = path.join(remoteBase, 'uploaded');
    fs.writeFileSync(path.join(localDir, 'hello.txt'), 'hello sftp roundtrip');
    fs.mkdirSync(path.join(localDir, 'sub'));
    fs.writeFileSync(path.join(localDir, 'sub', 'nested.txt'), 'nested content');
    // 🔴 执行位真机回归(posix_spawnp failed):模拟 spawn-helper 的 0o755 必须在
    // SFTP 上传后原样保留,否则 darwin 远端 posix_spawn 直接 EACCES。
    fs.writeFileSync(path.join(localDir, 'spawn-helper'), '#!/bin/sh\n');
    fs.chmodSync(path.join(localDir, 'spawn-helper'), 0o755);

    const progressSamples: number[] = [];
    await conn.sftpWriteDir(localDir, remoteDir, (pct) => progressSamples.push(pct));
    expect(progressSamples.at(-1)).toBe(100);

    const readBack = await conn.sftpReadFile(path.join(remoteDir, 'hello.txt'));
    expect(readBack?.toString('utf8')).toBe('hello sftp roundtrip');
    const nestedBack = await conn.sftpReadFile(path.join(remoteDir, 'sub', 'nested.txt'));
    expect(nestedBack?.toString('utf8')).toBe('nested content');

    const missing = await conn.sftpReadFile(path.join(remoteDir, 'does-not-exist.txt'));
    expect(missing).toBeNull();

    // 上传后的 spawn-helper 仍可执行(localhost 的「远端」就是本机 fs,直接 stat)
    const helperMode = fs.statSync(path.join(remoteDir, 'spawn-helper')).mode & 0o777;
    expect(helperMode).toBe(0o755);

    // forwardOut 往返:本地起一个 echo TCP 服务当「远端服务」,经隧道转发验证收发
    await new Promise<void>((resolve, reject) => {
      echoServer = net.createServer((socket) => {
        socket.on('data', (d) => socket.write(d));
      });
      echoServer.once('error', reject);
      echoServer.listen(0, '127.0.0.1', () => resolve());
    });
    const remotePort = (echoServer!.address() as net.AddressInfo).port;

    const forwardServer = conn.forwardOut(0, remotePort);
    await new Promise<void>((resolve, reject) => {
      forwardServer.once('listening', () => resolve());
      forwardServer.once('error', reject);
    });
    const localPort = (forwardServer.address() as net.AddressInfo).port;

    const echoed = await new Promise<string>((resolve, reject) => {
      const client = net.createConnection({ host: '127.0.0.1', port: localPort });
      let buf = '';
      client.on('data', (d) => {
        buf += d.toString('utf8');
        if (buf.includes('ping-through-tunnel')) {
          client.end();
          resolve(buf);
        }
      });
      client.on('error', reject);
      client.on('connect', () => client.write('ping-through-tunnel'));
    });
    expect(echoed).toBe('ping-through-tunnel');
    forwardServer.close();

    fs.rmSync(localDir, { recursive: true, force: true });
    fs.rmSync(remoteBase, { recursive: true, force: true });
  }, 20_000);
});
