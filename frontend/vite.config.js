import { defineConfig } from 'vite';

const proxy = { '/api': { target: 'http://127.0.0.1:8000', rewrite: (url) => url.replace(/^\/api/, '') } };
export default defineConfig({
  server: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: { target: 'es2022' },
});
