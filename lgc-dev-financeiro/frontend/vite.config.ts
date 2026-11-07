import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, proxy: { '/api': { target: 'http://localhost:3200', changeOrigin: true } } },
  test: { globals: true, include: ['src/**/*.test.ts'] },
});
