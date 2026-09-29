import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The control room is a static bundle served by nginx in the Compose topology and
// by `vite preview` in CI. Nothing here requires a Python server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    // Deterministic, reviewable chunking. Three.js and ECharts are the two heavy
    // vendors; they are split so the shell and command centre stay small.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          echarts: ['echarts'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand'],
        },
      },
    },
    chunkSizeWarningLimit: 1400,
  },
});
