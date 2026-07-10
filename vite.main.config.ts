import { defineConfig } from 'vite';

// Main process build.
//
// 'ssh2' (BL-003 SSH-5): 加入 dependencies 后随打包器解析——但它的加速依赖
// cpu-features/nan 走 optional native require,交给打包器处理会被误当成硬
// 依赖强行 bundle 导致构建期报错;external 后运行时从 node_modules 原样加载
// (随 forge.config.ts EXTERNAL_MODULES 递归搬运,同 node-pty 既有范式)。
//
// 'ws'(R2-3): probeHostInfo 在 main 侧首次 import——它已在 host 侧 external
// (vite.host.config.ts),这里补齐 main 侧同口径,避免打包器处理其
// bufferutil/utf-8-validate 可选加速依赖。
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['ssh2', 'ws', 'bufferutil', 'utf-8-validate'],
    },
  },
});
