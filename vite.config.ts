import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // GitHub Pages serves the app from /sketch-cas/; the Docker/nginx image
  // serves it from the domain root. Set VITE_BASE=/ for the latter.
  base: process.env['VITE_BASE'] ?? '/sketch-cas/',
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
