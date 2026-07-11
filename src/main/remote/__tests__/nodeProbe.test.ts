// 远端 node 解析:探测命令形状约束 + pickBestNode 选优纯函数。
// 🔴 背景:裸 `node -v` 在 SSH exec 通道(非交互 shell)下看不见 nvm/fnm/Homebrew
// 装的 node,「装了却报缺失」是真机首连头号误报——探测改为收集多候选行,TS 侧选优。
import { describe, it, expect } from 'vitest';
import { NODE_PROBE_COMMAND, pickBestNode } from '../nodeProbe';

describe('NODE_PROBE_COMMAND 形状约束', () => {
  it("sh -c 单引号包裹,体内无单引号(外层登录 shell 可能是 fish/csh,不能暴露 POSIX 语法)", () => {
    expect(NODE_PROBE_COMMAND.startsWith("sh -c '")).toBe(true);
    expect(NODE_PROBE_COMMAND.endsWith("'")).toBe(true);
    expect(NODE_PROBE_COMMAND.slice("sh -c '".length, -1)).not.toContain("'");
  });

  it('覆盖三类候选源:exec PATH、$SHELL login shell、常见安装位置(nvm/fnm/Homebrew/volta)', () => {
    expect(NODE_PROBE_COMMAND).toContain('command -v node');
    expect(NODE_PROBE_COMMAND).toContain('"$SHELL" -l -c');
    expect(NODE_PROBE_COMMAND).toContain('.nvm/versions/node');
    expect(NODE_PROBE_COMMAND).toContain('fnm/node-versions');
    expect(NODE_PROBE_COMMAND).toContain('/opt/homebrew/bin/node');
    expect(NODE_PROBE_COMMAND).toContain('.volta/bin/node');
  });

  it('恒 exit 0(「没找到」是合法空输出,不是传输失败)', () => {
    expect(NODE_PROBE_COMMAND).toContain('exit 0');
  });
});

describe('pickBestNode 选优', () => {
  it('单候选', () => {
    expect(pickBestNode('v20.11.0 /usr/bin/node\n')).toEqual({
      version: 'v20.11.0',
      major: 20,
      path: '/usr/bin/node',
    });
  });

  it('多候选取最高 major;同 major 取先出现者(PATH 优先)', () => {
    const out =
      'v18.19.0 /usr/bin/node\n' +
      'v26.5.0 /opt/homebrew/bin/node\n' +
      'v26.1.0 /home/u/.nvm/versions/node/v26.1.0/bin/node\n';
    expect(pickBestNode(out)?.path).toBe('/opt/homebrew/bin/node');
  });

  it('🔴 nvm 字典序陷阱:v9 与 v20 同现必须选 v20(比 major,不比字典序)', () => {
    const out =
      'v20.11.0 /home/u/.nvm/versions/node/v20.11.0/bin/node\n' +
      'v9.11.2 /home/u/.nvm/versions/node/v9.11.2/bin/node\n';
    expect(pickBestNode(out)?.major).toBe(20);
  });

  it('同路径去重(PATH 与 login shell 常报同一个 node)', () => {
    const out = 'v25.8.2 /opt/homebrew/bin/node\nv25.8.2 /opt/homebrew/bin/node\n';
    expect(pickBestNode(out)).toEqual({
      version: 'v25.8.2',
      major: 25,
      path: '/opt/homebrew/bin/node',
    });
  });

  it('空输出 / 纯垃圾行 → null(nodeMissing)', () => {
    expect(pickBestNode('')).toBeNull();
    expect(pickBestNode('command not found\nzsh: no such\n')).toBeNull();
  });

  it('版本残缺行(node -v 失败产生的「空版本 + 路径」)被忽略,不产出 NaN 候选', () => {
    expect(pickBestNode(' /usr/bin/node\n')).toBeNull();
    // 混合场景:残缺行不干扰合法行
    expect(pickBestNode(' /broken/node\nv20.0.0 /usr/bin/node\n')?.major).toBe(20);
  });

  it('路径含空格仍完整保留(match 到行尾)', () => {
    expect(pickBestNode('v22.1.0 /Users/a b/.volta/bin/node\n')?.path).toBe(
      '/Users/a b/.volta/bin/node',
    );
  });
});
