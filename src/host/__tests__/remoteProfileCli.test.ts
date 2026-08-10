import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RemoteProfileRpcResponse } from '../../shared/remoteProfileStore';
import {
  ensureHostBundle,
  spawnHost,
  type SpawnedHost,
} from './hostSubprocessHarness';

const PROFILE_ID = 'e'.repeat(32);
const CLIENT_ID = randomBytes(32).toString('base64url');

let bundlePath: string;
const spawned: SpawnedHost[] = [];
const tmpDirs: string[] = [];

beforeAll(async () => {
  bundlePath = await ensureHostBundle();
}, 60_000);

afterEach(() => {
  for (const child of spawned.splice(0)) child.kill();
  for (const directory of tmpDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function rpc(
  dataDir: string,
  request: unknown,
  expectedError?: string,
): Promise<RemoteProfileRpcResponse> {
  const child = spawnHost(
    bundlePath,
    ['--profile-store-rpc'],
    {
      OKWORK_HOST_DATA_DIR: dataDir,
      // Worktrees keep dependencies in the parent checkout; override the
      // harness's worktree-local NODE_PATH so the real bundle can load the
      // externally bundled native module just like packaged Host does.
      NODE_PATH: path.dirname(
        path.dirname(require.resolve('node-pty/package.json')),
      ),
    },
    JSON.stringify(request),
  );
  spawned.push(child);
  const exitCode = await child.waitForExit(5_000);
  expect(
    exitCode,
    `stdout=${child.getStdout()} stderr=${child.getStderr()}`,
  ).toBe(0);
  if (expectedError) {
    expect(child.getStderr()).toBe(`[profile-store-rpc] ${expectedError}\n`);
  } else {
    expect(child.getStderr()).toBe('');
  }
  return JSON.parse(child.getStdout()) as RemoteProfileRpcResponse;
}

describe('host --profile-store-rpc', () => {
  it('handles one stdin/stdout request per process without starting generic HostCore', async () => {
    const dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'okwork-profile-cli-'),
    );
    tmpDirs.push(dataDir);

    const described = await rpc(dataDir, {
      version: 1,
      requestId: randomUUID(),
      op: 'describe',
    });
    expect(described).toMatchObject({
      ok: true,
      data: { protocolVersion: 1, encryption: 'aes-256-gcm' },
    });

    const granted = await rpc(dataDir, {
      version: 1,
      requestId: randomUUID(),
      op: 'grant',
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'cli-generation',
    });
    expect(granted.ok).toBe(true);
    if (!granted.ok) throw new Error('grant unexpectedly failed');
    const capability = (granted.data as { capability: string }).capability;

    const auth = {
      clientId: CLIENT_ID,
      profileId: PROFILE_ID,
      generation: 'cli-generation',
      capability,
    };
    const profile = { id: PROFILE_ID, name: 'CLI profile', createdAt: 42 };
    expect(
      await rpc(dataDir, {
        version: 1,
        requestId: randomUUID(),
        op: 'profile.save',
        ...auth,
        payload: { profile },
      }),
    ).toMatchObject({ ok: true, data: profile });
    expect(
      await rpc(dataDir, {
        version: 1,
        requestId: randomUUID(),
        op: 'profile.get',
        ...auth,
      }),
    ).toMatchObject({ ok: true, data: profile });

    const secret = 'never-print-this-password';
    const forbidden = await rpc(
      dataDir,
      {
        version: 1,
        requestId: randomUUID(),
        op: 'vault.upsert',
        ...auth,
        capability: 'wrong-capability',
        payload: {
          origin: 'https://example.test',
          username: 'secret-user',
          password: secret,
        },
      },
      'PROFILE_RPC_FORBIDDEN',
    );
    expect(forbidden).toMatchObject({
      ok: false,
      code: 'PROFILE_RPC_FORBIDDEN',
    });
    expect(JSON.stringify(forbidden)).not.toContain(secret);

    const profileCiphertext = fs.readFileSync(
      path.join(dataDir, 'profile-store', 'profiles', `${PROFILE_ID}.json`),
      'utf8',
    );
    expect(profileCiphertext).not.toContain('CLI profile');
  }, 30_000);

  it('keeps the existing --listen entry operational after the pre-core branch', async () => {
    const dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'okwork-profile-listen-'),
    );
    tmpDirs.push(dataDir);
    const child = spawnHost(bundlePath, ['--listen', '127.0.0.1:0'], {
      OKWORK_HOST_TOKEN: 'listen-regression-token',
      NODE_PATH: path.dirname(
        path.dirname(require.resolve('node-pty/package.json')),
      ),
    });
    spawned.push(child);
    const match = await child.waitForStdout(
      /\[host\] listening ws:\/\/127\.0\.0\.1:(\d+) protocol=v\d+/,
      5_000,
    );
    expect(Number(match[1])).toBeGreaterThan(0);
    expect(child.getStderr()).toBe('');
  }, 15_000);
});
