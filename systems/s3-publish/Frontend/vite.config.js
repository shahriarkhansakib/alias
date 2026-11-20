import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served behind the Alias gateway at http://localhost:3000/publish (see apps/web/next.config.ts).
const BASE_PATH = process.env.VITE_BASE_PATH || '/publish/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
    },
  },
});
