import { pathToFileURL } from 'node:url';

const HOST_ARTIFACT_NAME = /^(?:host-bundle|okwork-host)-(?:darwin-arm64|linux-(?:x64|arm64))$/;

export function assertHostArtifactName(name) {
  if (!HOST_ARTIFACT_NAME.test(name)) {
    throw new Error(`拒绝清理非 Host Artifact: ${name}`);
  }
}

export function newestArtifactFirst(left, right) {
  const createdAtDifference = Date.parse(right.created_at) - Date.parse(left.created_at);
  return createdAtDifference || Number(right.id) - Number(left.id);
}

export async function retainLatestArtifact({
  artifactName,
  currentRunId,
  client,
  log = console,
}) {
  assertHostArtifactName(artifactName);

  const artifacts = (await client.listArtifacts(artifactName)).sort(newestArtifactFirst);
  const [latest, ...olderArtifacts] = artifacts;

  if (!latest) {
    log.log(`[artifact-retention] ${artifactName}: 没有可清理的 Artifact`);
    return { kept: null, deleted: [], skipped: [] };
  }

  const deleted = [];
  const skipped = [];

  for (const artifact of olderArtifacts) {
    const artifactRunId = artifact.workflow_run?.id;

    // 当前工作流调用清理步骤时，调用方已确保产物不再被后续 job 消费。
    // 其他运行中的工作流仍可能需要自己的产物，因此先跳过，待它结束时再清。
    if (String(artifactRunId) !== String(currentRunId)) {
      if (!artifactRunId) {
        skipped.push(artifact.id);
        log.warn(`[artifact-retention] ${artifactName}: 跳过来源未知的 Artifact ${artifact.id}`);
        continue;
      }

      const runStatus = await client.getWorkflowRunStatus(artifactRunId);
      if (runStatus !== 'completed') {
        skipped.push(artifact.id);
        log.log(
          `[artifact-retention] ${artifactName}: 跳过仍在运行的 Artifact ${artifact.id} (run ${artifactRunId})`,
        );
        continue;
      }
    }

    await client.deleteArtifact(artifact.id);
    deleted.push(artifact.id);
  }

  log.log(
    `[artifact-retention] ${artifactName}: 保留 ${latest.id}，删除 ${deleted.length} 个，跳过 ${skipped.length} 个`,
  );
  return { kept: latest.id, deleted, skipped };
}

export function createGitHubActionsClient({ apiUrl, owner, repo, token }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function request(path, init = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${init.method ?? 'GET'} ${path} 失败: ${response.status} ${body}`);
    }

    return response.status === 204 ? null : response.json();
  }

  return {
    async listArtifacts(name) {
      const artifacts = [];

      for (let page = 1; ; page += 1) {
        const query = new URLSearchParams({ name, per_page: '100', page: String(page) });
        const result = await request(`/repos/${owner}/${repo}/actions/artifacts?${query}`);
        artifacts.push(...result.artifacts);
        if (result.artifacts.length < 100) break;
      }

      return artifacts;
    },

    async getWorkflowRunStatus(runId) {
      const run = await request(`/repos/${owner}/${repo}/actions/runs/${runId}`);
      return run.status;
    },

    async deleteArtifact(artifactId) {
      await request(`/repos/${owner}/${repo}/actions/artifacts/${artifactId}`, {
        method: 'DELETE',
      });
    },
  };
}

async function main() {
  const artifactNames = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const currentRunId = process.env.GITHUB_RUN_ID;
  const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';

  if (artifactNames.length === 0) throw new Error('至少需要一个 Artifact 名称');
  if (!repository || !repository.includes('/')) throw new Error('缺少有效的 GITHUB_REPOSITORY');
  if (!token) throw new Error('缺少 GITHUB_TOKEN');
  if (!currentRunId) throw new Error('缺少 GITHUB_RUN_ID');

  const [owner, repo] = repository.split('/');
  const client = createGitHubActionsClient({ apiUrl, owner, repo, token });

  for (const artifactName of artifactNames) {
    await retainLatestArtifact({ artifactName, currentRunId, client });
  }
}

const isCommandLineEntry = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCommandLineEntry) {
  main().catch((error) => {
    console.error(`[artifact-retention] ${error.message}`);
    process.exitCode = 1;
  });
}
