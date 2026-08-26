import { configDefaults, defineConfig } from 'vitest/config';

// Vitest 根配置。此前项目无显式配置(走内置默认)。新增仅为放宽超时:
// host WS 集成测(真实 ws + 真实 node-pty 登录 shell)在并行 worker 下 shell
// 启动有抖动,默认 5s testTimeout 会误杀。其余保持 vitest 默认(不引入插件,
// 不改 transform —— 既有 .tsx 测试仍走 esbuild 默认 JSX 处理)。
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // 并行 session 的 git worktree 落在仓库目录里,其中的测试副本会被根目录的
    // vitest 重复跑一遍(同名套件 ×N,门禁信噪比直接掉光);worktree 内各自跑
    // 自己的 vitest 用的是自己那份配置,不受这里影响。
    exclude: [...configDefaults.exclude, '.worktree/**', '.claude/worktrees/**'],
  },
});
