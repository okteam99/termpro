import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  build: {
    // 🔴 不可改回 Vite 默认 esbuild minify（2026-07 两次终端冻死）：
    // @xterm/xterm 发布物已经预打包/压缩，esbuild 再压一次会把 InputHandler.
    // requestMode 的局部 const enum 作用域破坏，生产包中变成未定义变量；
    // TUI 发 DECRQM 即从 parser 内抛错、永久停掉 WriteBuffer。Terser 对同一
    // xterm bundle 的二次压缩已做生产产物对比，保留了该作用域。
    minify: 'terser',
  },
});
