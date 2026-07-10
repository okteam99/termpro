// BL-004 覆盖门禁（Q1 · blueprint E1 R-1 首要防线）：无非豁免文件裸 import hostClient 单例。
// 权威口径 = TECH.md「覆盖门禁」的 perl -0777 语义正则（多行感知 + 大小写敏感 + 花括号作用域）：
//   import\s+(?:type\s+)?\{[^}]*\bhostClient\b[^}]*\}
// 一次免疫五坑：① 折行使用(App.tsx:76 独占行) ② 注释(无 import specifier)
//   ③ type-import 假阳(HostClient 大写·大小写敏感放行) ④ 路径段假阳(花括号排除 from '.../hostClient')
//   ⑤ 多行 import(整文件文本匹配·非行级)。
// 残留裸 hostClient.x 而未 import 由 tsc 「cannot find name」背靠（本测只守 import 集这一面）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RENDERER_ROOT = join(__dirname, '../..'); // src/renderer
// 唯一合法 importer（豁免集 · 与 TECH 门禁脚本同一份常量）
const EXEMPT = [
  'services/hostClient.ts', // 定义本身
  'services/hostRegistry.ts', // seed 'local' 单例
];
const EXEMPT_DIRS = ['components/viewer/', '__tests__/']; // D-7 出范围 / 测试桩

// 单例 specifier 正则：花括号内含小写单例 hostClient · type? 可选 · 大小写敏感 · 多行(文件整文本 + m/s 无关·靠 [^}] 跨行)
const SINGLETON_IMPORT = /import\s+(?:type\s+)?\{[^}]*\bhostClient\b[^}]*\}/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

function isExempt(rel: string): boolean {
  if (EXEMPT.includes(rel)) return true;
  return EXEMPT_DIRS.some((d) => rel.includes(d));
}

describe('BL004-U-grepgate · hostClient 单例 import 覆盖门禁', () => {
  it('无非豁免文件 import { hostClient } 单例（全部经 hostRegistry）', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER_ROOT)) {
      const rel = relative(RENDERER_ROOT, file);
      if (isExempt(rel)) continue;
      const text = readFileSync(file, 'utf8');
      if (SINGLETON_IMPORT.test(text)) offenders.push(rel);
    }
    expect(offenders, `残留裸 import { hostClient } 单例(应全经 hostRegistry.forWorkspace/local):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('正则区分单例 import(违规) vs HostClient type-import(放行) vs 注释(放行)', () => {
    // 守门元测试：确保正则本身不退化（防未来「顺手简化」回使用点 grep 的五坑）
    expect(SINGLETON_IMPORT.test("import { hostClient } from '../services/hostClient';")).toBe(true);
    expect(SINGLETON_IMPORT.test("import {\n  hostClient,\n} from '../services/hostClient';")).toBe(true); // 多行
    expect(SINGLETON_IMPORT.test("import { HostRegistry, hostClient } from '../x';")).toBe(true); // 混合
    expect(SINGLETON_IMPORT.test("import type { HostClient } from '../services/hostClient';")).toBe(false); // type 大写放行
    expect(SINGLETON_IMPORT.test('// legacy hostClient reference in comment')).toBe(false); // 注释放行
    expect(SINGLETON_IMPORT.test("import { forWorkspace } from '../services/hostClient';")).toBe(false); // 路径段不假阳
  });
});
