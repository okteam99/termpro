// zsh shell integration 自动注入(VS Code 同款 ZDOTDIR 包装机制):
// 包装目录里的启动文件先转 source 用户原配置,再挂 precmd/preexec 钩子,
// 让任意 zsh 会话发出 OSC 133(命令边界)与 OSC 7(cwd 上报)。
// 注入是尽力而为:失败回退为不注入,终端照常可用。
// 退出口:OKWORK_NO_SHELL_INTEGRATION=1。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 包装脚本版本:内容变更时递增,目录按版本命名避免旧缓存
const INTEGRATION_VERSION = 1;

const ZSHENV = `# OkWork shell integration wrapper (.zshenv)
OKWORK_WRAP_ZDOTDIR="$ZDOTDIR"
if [[ -n "$OKWORK_USER_ZDOTDIR" ]]; then
  ZDOTDIR="$OKWORK_USER_ZDOTDIR"
else
  ZDOTDIR="$HOME"
fi
[[ -f "$ZDOTDIR/.zshenv" ]] && builtin source "$ZDOTDIR/.zshenv"
# 用户 .zshenv 可能自行改写 ZDOTDIR;记录最终用户目录后恢复包装目录
OKWORK_FINAL_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$OKWORK_WRAP_ZDOTDIR"
unset OKWORK_WRAP_ZDOTDIR
`;

const ZPROFILE = `# OkWork shell integration wrapper (.zprofile)
[[ -f "$OKWORK_FINAL_ZDOTDIR/.zprofile" ]] && builtin source "$OKWORK_FINAL_ZDOTDIR/.zprofile"
`;

const ZLOGIN = `# OkWork shell integration wrapper (.zlogin)
[[ -f "$OKWORK_FINAL_ZDOTDIR/.zlogin" ]] && builtin source "$OKWORK_FINAL_ZDOTDIR/.zlogin"
`;

const ZSHRC = `# OkWork shell integration wrapper (.zshrc)
[[ -f "$OKWORK_FINAL_ZDOTDIR/.zshrc" ]] && builtin source "$OKWORK_FINAL_ZDOTDIR/.zshrc"

# ---- OkWork hooks:OSC 133 命令边界 + OSC 7 cwd 上报 ----
autoload -Uz add-zsh-hook 2>/dev/null

__okwork_osc7() {
  printf '\\033]7;file://%s%s\\033\\\\' "\${HOST:-localhost}" "$PWD"
}
__okwork_precmd() {
  local __ec=$?
  printf '\\033]133;D;%d\\007' "$__ec"
  printf '\\033]133;A\\007'
  __okwork_osc7
}
__okwork_preexec() {
  printf '\\033]133;C\\007'
}
if (( $+functions[add-zsh-hook] )); then
  add-zsh-hook precmd __okwork_precmd
  add-zsh-hook preexec __okwork_preexec
fi
# 首个提示符前先报一次位置与提示符状态
printf '\\033]133;A\\007'
__okwork_osc7
`;

let cachedDir: string | null | undefined;

/** 生成(或复用)包装目录;失败返回 null(放弃注入) */
export function ensureIntegrationDir(): string | null {
  if (cachedDir !== undefined) return cachedDir;
  try {
    const dir = path.join(
      os.tmpdir(),
      `okwork-zdotdir-v${INTEGRATION_VERSION}`,
    );
    fs.mkdirSync(dir, { recursive: true });
    const files: Array<[string, string]> = [
      ['.zshenv', ZSHENV],
      ['.zprofile', ZPROFILE],
      ['.zshrc', ZSHRC],
      ['.zlogin', ZLOGIN],
    ];
    for (const [name, content] of files) {
      const p = path.join(dir, name);
      // 每次启动覆写,保证内容与当前版本一致
      fs.writeFileSync(p, content);
    }
    cachedDir = dir;
  } catch (err) {
    console.error('[host] shell integration setup failed:', err);
    cachedDir = null;
  }
  return cachedDir;
}

/** 为 zsh 会话计算注入环境变量;非 zsh / 关闭注入 / 生成失败 → null */
export function integrationEnv(
  shell: string,
  baseEnv: Record<string, string | undefined>,
): Record<string, string> | null {
  if (baseEnv.OKWORK_NO_SHELL_INTEGRATION) return null;
  const name = shell.split('/').pop();
  if (name !== 'zsh') return null;
  const dir = ensureIntegrationDir();
  if (!dir) return null;
  const env: Record<string, string> = { ZDOTDIR: dir };
  if (baseEnv.ZDOTDIR) env.OKWORK_USER_ZDOTDIR = baseEnv.ZDOTDIR;
  return env;
}
