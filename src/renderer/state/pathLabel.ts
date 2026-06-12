// 路径展示纯函数(零依赖,可单测;store 转发导出供 UI 使用)

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

/** 把 home 前缀缩写为 ~(展示用) */
export function tildify(p: string, homedir: string | undefined): string {
  if (homedir && p.startsWith(homedir)) return `~${p.slice(homedir.length)}`;
  return p;
}

/** Tab 默认名:cwd 相对工作区根的路径。
 *  根本身 → 文件夹名;根内 → 相对路径;近邻(≤2 级上溯,worktree 兄弟
 *  目录典型)→ ../xx;更远 → ~ 缩写的绝对路径 */
export function tabPathLabel(
  root: string,
  cwd: string,
  homedir?: string,
): string {
  const r = root.replace(/\/+$/, '') || '/';
  const c = cwd.replace(/\/+$/, '') || '/';
  if (c === r) return basename(r);
  if (c.startsWith(`${r}/`)) return c.slice(r.length + 1);
  const rs = r.split('/').filter(Boolean);
  const cs = c.split('/').filter(Boolean);
  let i = 0;
  while (i < rs.length && i < cs.length && rs[i] === cs[i]) i++;
  const ups = rs.length - i;
  if (ups <= 2) {
    const rest = cs.slice(i).join('/');
    return rest ? '../'.repeat(ups) + rest : '../'.repeat(ups).slice(0, -1);
  }
  return tildify(c, homedir);
}
