import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev, /api é repassado para o backend (http://localhost:4000): mesmo "site" para o navegador,
// então o cookie de sessão funciona sem configurar nada. Em produção use VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: true,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'] } } },
  },
});
