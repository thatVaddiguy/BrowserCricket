import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'preserve-classic-fallback',
      apply: 'build',
      closeBundle() { copyFileSync('classic.html', 'dist/classic.html'); },
    },
  ],
  base: './',
  // Docker bind mounts on Windows/macOS hosts do not deliver file events; poll instead.
  server: process.env.VITE_USE_POLLING ? { watch: { usePolling: true, interval: 300 } } : {},
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
        },
      },
    },
  },
});
