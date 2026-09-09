import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@aichat/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
});
