// 远端 node 运行时解析(探测命令 + 候选解析纯函数)。
//
// 🔴 背景:SSH exec 通道起的是【非交互 · 非登录】shell——nvm/fnm 初始化在
// .bashrc 尾部(Debian 系开头即非交互 return)/ .zshrc(zsh -c 不读)里,
// Homebrew shellenv 在 .zprofile(login-only)里,裸 `node -v` 全都看不见,
// 「装了 node 却报缺失」是真机首连的头号误报。
//
// 方案:一条 `sh -c` 包裹的 POSIX 脚本,一次性收集三类候选(exec PATH →
// $SHELL login shell → 常见安装位置 glob),每个候选输出一行 `<version> <abs-path>`;
// 版本比较/选优留在 TS 侧(pickBestNode,可单测)。选出的绝对路径同时供
// buildStartCommand 使用——启动 host 与探测看到的是同一个 node,不再依赖 PATH。
//
// 兼容性约束(勿破坏):
//   ① 整条命令 sh -c 单引号包裹且【内部无单引号】——外层是用户登录 shell,
//      可能是 fish/csh,任何裸 POSIX 复合语法(if/for/$())都不能暴露在外层;
//   ② 脚本恒 exit 0——「没找到」是合法结果(空输出),不是传输失败;
//   ③ glob 未命中时保持字面量,emit 的 `[ -x ]` 守卫会滤掉。

/** 常见安装位置(顺序即并列候选,选优看版本不看顺序;$HOME 由远端 sh 展开)。 */
const CANDIDATE_PATHS =
  '/opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node /snap/bin/node ' +
  '"$HOME/.volta/bin/node" ' +
  '"$HOME/.nvm/versions/node"/*/bin/node ' +
  '"$HOME/.local/share/fnm/node-versions"/*/installation/bin/node ' +
  '"$HOME/.fnm/node-versions"/*/installation/bin/node';

export const NODE_PROBE_COMMAND =
  `sh -c '` +
  `emit() { [ -x "$1" ] && printf "%s %s\\n" "$("$1" -v 2>/dev/null)" "$1"; }; ` +
  `p=$(command -v node 2>/dev/null); [ -n "$p" ] && emit "$p"; ` +
  `q=""; [ -n "$SHELL" ] && q=$("$SHELL" -l -c "command -v node" 2>/dev/null); ` +
  `[ -n "$q" ] && emit "$q"; ` +
  `for c in ${CANDIDATE_PATHS}; do emit "$c"; done; exit 0'`;

export interface NodeCandidate {
  /** 归一化版本串(恒带 v 前缀,如 v20.11.0)。 */
  version: string;
  major: number;
  /** 远端绝对路径(供 buildStartCommand 直接引用,不依赖 PATH)。 */
  path: string;
}

/**
 * 探测输出 → 最优候选。逐行匹配 `<version> <abs-path>`,按路径去重(PATH 与
 * login shell 常报同一个),取 major 最高者;同 major 取先出现者(即 PATH 优先)。
 * 🔴 选优必须比 major,不能拿 glob 字典序末位——nvm 目录下 v9.x 字典序排在
 * v20.x 之后,字典序会选错。无任何合法行 → null(nodeMissing)。
 */
export function pickBestNode(stdout: string): NodeCandidate | null {
  const seen = new Set<string>();
  let best: NodeCandidate | null = null;
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^v?(\d+)(\.\S*)?\s+(\/\S.*)$/);
    if (!m) continue;
    const path = m[3].trim();
    if (seen.has(path)) continue;
    seen.add(path);
    const major = Number(m[1]);
    if (best === null || major > best.major) {
      best = { version: `v${m[1]}${m[2] ?? ''}`, major, path };
    }
  }
  return best;
}
