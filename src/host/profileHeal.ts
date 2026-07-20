// okwork-node 存量容器 profile.d 自愈(2026-07-20):旧镜像的
// /etc/profile.d/10-okwork-workspace.sh 是无条件 `cd /workspace`,登录 shell(bash -l)
// source 后把 pty.spawn 的显式 cwd(项目目录)拽回挂载根 → 远程新终端根目录不是项目目录。
// 镜像已改守卫版($PWD == $HOME 才 cd · af2c4d3),但存量容器不随 host 升级重建,
// 旧脚本常驻。standalone host 启动在容器内、随发版自动升级重启,是唯一能触达所有
// 存量机器的原位修复点。只动本产品自有文件、幂等、失败(非 root 等)降级为告警。

import * as fs from 'node:fs';

export const OKWORK_PROFILE_PATH = '/etc/profile.d/10-okwork-workspace.sh';

// 与 docker/okwork-node/Dockerfile 写入的守卫版逐字一致
const GUARDED = `# okwork-node: fresh login shells (landing in $HOME) start in /workspace;
# an explicit cwd (OkWork per-tab spawn, docker exec -w, etc.) is preserved.
[ "$PWD" = "$HOME" ] && [ -d /workspace ] && cd /workspace
`;

/**
 * 旧无条件版(有 `cd /workspace` 且无 $PWD 守卫)→ 原位改写为守卫版。
 * 返回值供启动日志:healed=已改写 · ok=已是守卫版/用户自定义 · absent=非
 * okwork-node 环境(本机/新容器外的宿主)· failed=无写权限等。
 */
export function healWorkspaceProfile(
  path = OKWORK_PROFILE_PATH,
): 'healed' | 'ok' | 'absent' | 'failed' {
  let content: string;
  try {
    content = fs.readFileSync(path, 'utf8');
  } catch {
    return 'absent';
  }
  if (!content.includes('cd /workspace') || content.includes('$PWD')) return 'ok';
  try {
    fs.writeFileSync(path, GUARDED);
    return 'healed';
  } catch (err) {
    console.warn(
      '[host] workspace profile heal failed:',
      err instanceof Error ? err.message : String(err),
    );
    return 'failed';
  }
}
