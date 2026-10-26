import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.VITE_INDUSTRIAL_API_TARGET || 'http://localhost:3200';

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    tailwindcss(),
  ],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/events': { target: API, changeOrigin: true },
      '/tiles': { target: API, changeOrigin: true },
      '/3dtiles': { target: API, changeOrigin: true },
      '/previews': { target: API, changeOrigin: true },
      '/thumbs': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
