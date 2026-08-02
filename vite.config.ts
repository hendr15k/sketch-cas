import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/sketch-cas/',
  root: '.',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          'cas-algebrite': ['algebrite'],
          'cas-nerdamer': ['nerdamer'],
          'cas-mathjs': ['mathjs'],
        },
      },
    },
  },
  server: {
    port: 5180,
    open: false,
    proxy: {
      '/api': 'http://localhost:3141',
    },
  },
});
