import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    // The totals rule lives in ../src/orders-total.js and is shared with the
    // CLI. Vite's root is client/, so dev-serving a file above it must be
    // allowed explicitly; the production build resolves it without this.
    fs: { allow: ['..'] },
    // The project lives on a Windows drive mounted at /mnt/c, which delivers
    // no inotify events to WSL — chokidar's default watcher sees nothing and
    // Vite goes on serving the module it first read, so an edit appears to do
    // nothing. Polling is the only thing that observes those writes. It costs
    // a steady trickle of CPU, hence the interval rather than the default 100ms.
    watch: { usePolling: true, interval: 400 },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
