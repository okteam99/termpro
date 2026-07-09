import { defineConfig } from 'vitest/config';

// Vitest 根配置。此前项目无显式配置(走内置默认)。新增仅为放宽超时:
// host WS 集成测(真实 ws + 真实 node-pty 登录 shell)在并行 worker 下 shell
// 启动有抖动,默认 5s testTimeout 会误杀。其余保持 vitest 默认(不引入插件,
// 不改 transform —— 既有 .tsx 测试仍走 esbuild 默认 JSX 处理)。
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
