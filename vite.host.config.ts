import { defineConfig } from 'vite';

// Host process build: pure Node target. node-pty is a native module and
// must stay external (resolved from node_modules at runtime).
// bufferutil / utf-8-validate are optional native accelerators lazily
// required by ws inside try/catch; bundling them turns the optional
// require into a hard build error, so they stay external too.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-pty', 'bufferutil', 'utf-8-validate'],
    },
  },
});
