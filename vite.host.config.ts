import { defineConfig } from 'vite';

// Host process build: pure Node target. node-pty is a native module and
// must stay external (resolved from node_modules at runtime).
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-pty'],
    },
  },
});
