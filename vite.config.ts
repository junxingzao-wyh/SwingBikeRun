import { cp, copyFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'redistribution-notices',
    async closeBundle() {
      await cp(new URL('licenses/', import.meta.url), new URL('dist/licenses/', import.meta.url), { recursive: true });
      await copyFile(new URL('LICENSE', import.meta.url), new URL('dist/LICENSE', import.meta.url));
    },
  }],
  build: { chunkSizeWarningLimit: 2500 },
  server: { port: Number(process.env.PORT) || 5193, host: '0.0.0.0', allowedHosts: true, strictPort: true },
  preview: { port: Number(process.env.PORT) || 5194, host: '0.0.0.0', allowedHosts: true, strictPort: true },
});
