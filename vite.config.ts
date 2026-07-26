import { defineConfig } from 'vite';

// GitHub Pages project sites serve from /<repo>/
const base = process.env.GITHUB_PAGES === 'true' ? '/bonsai-en/' : '/';

export default defineConfig({
  base,
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
