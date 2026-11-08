import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.VC_PORT || process.env.PORT || '4811';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/socket.io': { target: `http://localhost:${API_PORT}`, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
