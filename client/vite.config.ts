import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 1234,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
