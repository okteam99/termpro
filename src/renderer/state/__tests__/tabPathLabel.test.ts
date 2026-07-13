import { describe, expect, it } from 'vitest';
import { tabPathLabel } from '../pathLabel';

const ROOT = '/Users/liam/apps/okok/OkWork';
const HOME = '/Users/liam';

describe('tabPathLabel', () => {
  it('工作区根 → 文件夹名', () => {
    expect(tabPathLabel(ROOT, ROOT)).toBe('OkWork');
    expect(tabPathLabel(ROOT, `${ROOT}/`)).toBe('OkWork');
  });

  it('根内子目录 → 相对路径(随 cd 联动)', () => {
    expect(tabPathLabel(ROOT, `${ROOT}/src/host`)).toBe('src/host');
  });

  it('worktree 兄弟目录 → ../xx', () => {
    expect(tabPathLabel(ROOT, '/Users/liam/apps/okok/okwork-w2')).toBe(
      '../okwork-w2',
    );
    expect(tabPathLabel(ROOT, '/Users/liam/apps/other/x')).toBe('../../other/x');
  });

  it('上溯到祖先目录本身 → ../..(无残余段)', () => {
    expect(tabPathLabel(ROOT, '/Users/liam/apps/okok')).toBe('..');
    expect(tabPathLabel(ROOT, '/Users/liam/apps')).toBe('../..');
  });

  it('相距过远 → ~ 缩写绝对路径', () => {
    expect(tabPathLabel(ROOT, '/tmp/x', HOME)).toBe('/tmp/x');
    expect(tabPathLabel(ROOT, '/Users/liam/Downloads', HOME)).toBe(
      '~/Downloads',
    );
  });
});
