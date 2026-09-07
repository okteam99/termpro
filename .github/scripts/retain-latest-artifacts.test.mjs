import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  assertHostArtifactName,
  newestArtifactFirst,
  retainLatestArtifact,
} from './retain-latest-artifacts.mjs';

test('只允许清理已知的 Host Artifact 名称', () => {
  assert.doesNotThrow(() => assertHostArtifactName('host-bundle-darwin-arm64'));
  assert.doesNotThrow(() => assertHostArtifactName('okwork-host-linux-x64'));
  assert.throws(() => assertHostArtifactName('okwork-darwin-arm64'), /非 Host Artifact/);
});

test('创建时间相同时以较大的 Artifact ID 作为最新版本', () => {
  const artifacts = [
    { id: 10, created_at: '2026-08-26T08:00:00Z' },
    { id: 11, created_at: '2026-08-26T08:00:00Z' },
    { id: 9, created_at: '2026-08-25T08:00:00Z' },
  ];

  assert.deepEqual(artifacts.sort(newestArtifactFirst).map(({ id }) => id), [11, 10, 9]);
});

test('保留最新版本，删除已完成或属于当前运行的旧版本，跳过其他运行中版本', async () => {
  const deleted = [];
  const messages = [];
  const client = {
    async listArtifacts() {
      return [
        {
          id: 40,
          created_at: '2026-08-26T10:00:00Z',
          workflow_run: { id: 400 },
        },
        {
          id: 30,
          created_at: '2026-08-26T09:00:00Z',
          workflow_run: { id: 300 },
        },
        {
          id: 20,
          created_at: '2026-08-26T08:00:00Z',
          workflow_run: { id: 200 },
        },
        {
          id: 10,
          created_at: '2026-08-26T07:00:00Z',
          workflow_run: { id: 100 },
        },
      ];
    },
    async getWorkflowRunStatus(runId) {
      return runId === 300 ? 'in_progress' : 'completed';
    },
    async deleteArtifact(artifactId) {
      deleted.push(artifactId);
    },
  };
  const log = {
    log(message) { messages.push(message); },
    warn(message) { messages.push(message); },
  };

  const result = await retainLatestArtifact({
    artifactName: 'okwork-host-linux-x64',
    currentRunId: 200,
    client,
    log,
  });

  assert.equal(result.kept, 40);
  assert.deepEqual(result.deleted, [20, 10]);
  assert.deepEqual(result.skipped, [30]);
  assert.deepEqual(deleted, [20, 10]);
  assert.match(messages.at(-1), /保留 40，删除 2 个，跳过 1 个/);
});
