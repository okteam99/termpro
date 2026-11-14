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

// ── ~/.local/bin 入 PATH(2026-11-14)──
// pty.spawn 起的是登录 shell(bash -l),只读 /etc/profile 与 ~/.bash_profile →
// ~/.bash_login → ~/.profile 中首个存在者,**不读 ~/.bashrc**。容器里那条链一断
// (存在 ~/.bash_profile / ~/.profile 缺失),用户写进 .bashrc 的 PATH 就只在手动
// source 过的 tab 生效 → 新 tab `claude: command not found`(native installer、pipx、
// uv 等都装在 ~/.local/bin)。/etc/profile.d 是登录 shell 必读处,不依赖用户 dotfiles。

export const OKWORK_LOCAL_BIN_PROFILE_PATH = '/etc/profile.d/30-okwork-local-bin.sh';

// 与 docker/okwork-node/Dockerfile 写入的逐字一致
const LOCAL_BIN = `# okwork-node: user-local bins (Claude Code native installer, pipx, uv, ...) on PATH
# for login shells, which do not read ~/.bashrc.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) [ -d "$HOME/.local/bin" ] && PATH="$HOME/.local/bin:$PATH" ;;
esac
export PATH
`;

/**
 * okwork-node 容器(以 10-okwork-workspace.sh 存在为标记)缺该脚本则补写。
 * 已存在一律不动(含用户改过的);非 okwork-node 环境不往别人机器的 /etc 写东西。
 * written=已补写 · ok=已存在 · absent=非 okwork-node 环境 · failed=无写权限等。
 */
export function ensureLocalBinProfile(
  path = OKWORK_LOCAL_BIN_PROFILE_PATH,
  markerPath = OKWORK_PROFILE_PATH,
): 'written' | 'ok' | 'absent' | 'failed' {
  if (!fs.existsSync(markerPath)) return 'absent';
  if (fs.existsSync(path)) return 'ok';
  try {
    fs.writeFileSync(path, LOCAL_BIN, { mode: 0o644 });
    return 'written';
  } catch (err) {
    console.warn(
      '[host] local-bin profile write failed:',
      err instanceof Error ? err.message : String(err),
    );
    return 'failed';
  }
}
