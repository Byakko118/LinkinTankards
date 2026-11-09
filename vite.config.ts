import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pvc: resolve(__dirname, 'pvc.html'),
        tester: resolve(__dirname, 'tester.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
  // Prebundle CJS wasmoon so named/default interop works in the browser.
  optimizeDeps: {
    include: ['wasmoon'],
  },
  assetsInclude: ['**/*.wasm'],
});
