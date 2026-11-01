import { defineConfig } from 'vitest/config';

// Cada arquivo sobe um app Nest com pool Prisma próprio; limitar workers e conexões evita estourar o
// max_connections do Postgres quando a suíte e2e roda toda em paralelo.
const url = process.env.DATABASE_URL;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    maxWorkers: 4,
    ...(url && { env: { DATABASE_URL: url.includes('connection_limit') ? url : `${url}${url.includes('?') ? '&' : '?'}connection_limit=5` } }),
  },
});
