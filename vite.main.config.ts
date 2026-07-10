import { defineConfig } from 'vite';

// Main process build.
//
// 'ssh2' (BL-003 SSH-5): 加入 dependencies 后随打包器解析——但它的加速依赖
// cpu-features/nan 走 optional native require,交给打包器处理会被误当成硬
// 依赖强行 bundle 导致构建期报错;external 后运行时从 node_modules 原样加载
// (随 forge.config.ts EXTERNAL_MODULES 递归搬运,同 node-pty 既有范式)。
//
// 'ws'(R2-3): probeHostInfo 在 main 侧首次 import。external 后运行时从
// node_modules 加载,故必须列入 forge.config.ts EXTERNAL_MODULES 随包搬运
// (host 侧不同:vite.host.config.ts 未 external ws,直接 bundle 进 host.js)。
// bufferutil/utf-8-validate 是 ws 的可选加速件,保持 external 免被误 bundle。
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['ssh2', 'ws', 'bufferutil', 'utf-8-validate'],
    },
  },
});
