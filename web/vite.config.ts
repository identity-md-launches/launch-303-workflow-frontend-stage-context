import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'deployment-config-for-development',
    configureServer(server) {
      server.middlewares.use('/imd-deployment.json', async (_request, response) => {
        try {
          const bytes = await readFile(new URL('../dist/imd-deployment.json', import.meta.url));
          response.setHeader('Content-Type', 'application/json');
          response.end(bytes);
        } catch {
          response.statusCode = 503;
          response.end('Run npm run build to generate the validated deployment configuration.');
        }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
