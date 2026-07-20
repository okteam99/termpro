// healWorkspaceProfile(2026-07-20):存量 okwork-node 容器的旧 profile.d 无条件
// `cd /workspace` 会把远程新终端从项目目录拽回挂载根;host 启动时原位改写为守卫版
//($PWD == $HOME 才 cd)。幂等、不碰用户自定义脚本、非 okwork-node 环境零影响。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { healWorkspaceProfile } from '../profileHeal';

const OLD = `# okwork-node: login shells start in /workspace (mount a host folder there).
[ -d /workspace ] && cd /workspace
`;

let dir: string;
const file = (name: string, content?: string): string => {
  const p = path.join(dir, name);
  if (content !== undefined) fs.writeFileSync(p, content);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okwork-heal-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('healWorkspaceProfile', () => {
  it('旧无条件 cd /workspace → 改写为 $PWD 守卫版', () => {
    const p = file('old.sh', OLD);
    expect(healWorkspaceProfile(p)).toBe('healed');
    const healed = fs.readFileSync(p, 'utf8');
    expect(healed).toContain('[ "$PWD" = "$HOME" ] && [ -d /workspace ] && cd /workspace');
  });

  it('幂等:守卫版再跑 → ok 且内容不变', () => {
    const p = file('old.sh'); // 上一用例已治愈
    const before = fs.readFileSync(p, 'utf8');
    expect(healWorkspaceProfile(p)).toBe('ok');
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('用户自定义脚本(无 cd /workspace)→ ok 不动', () => {
    const custom = 'export FOO=bar\n';
    const p = file('custom.sh', custom);
    expect(healWorkspaceProfile(p)).toBe('ok');
    expect(fs.readFileSync(p, 'utf8')).toBe(custom);
  });

  it('文件不存在(本机/非 okwork-node 容器)→ absent', () => {
    expect(healWorkspaceProfile(path.join(dir, 'nope.sh'))).toBe('absent');
  });
});
