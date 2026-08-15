import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { handleUarp } from './server/handlers.js';

/**
 * The proxy runs inside the dev server, so `npm run dev` is the whole setup.
 *
 * In production you would deploy `server/handlers.ts` as an API route or an
 * edge function instead — the browser half is unchanged, because it only ever
 * talks to `/api/uarp/*`.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    {
      name: 'uarp-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!(await handleUarp(req, res))) next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!(await handleUarp(req, res))) next();
        });
      },
    },
  ],
});
