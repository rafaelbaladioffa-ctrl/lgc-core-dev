import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:3200', changeOrigin: true },
      // Login e refresh do Core pelo mesmo endereço em desenvolvimento: dispensa liberar a 5175 no CORS do Core.
      '/core-api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (path) => path.replace(/^\/core-api/, '') },
    },
  },
  test: { globals: true, include: ['src/**/*.test.ts'] },
});
