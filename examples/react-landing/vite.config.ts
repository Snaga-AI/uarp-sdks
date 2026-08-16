import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { handleUarp } from './server/handlers.js';
import { writeReferenceIfChanged } from './scripts/gen-reference.ts';
import { writeWireIfChanged } from './scripts/gen-wire.ts';

/**
 * The proxy runs inside the dev server, so `npm run dev` is the whole setup.
 *
 * In production you would deploy `server/handlers.ts` as an API route or an
 * edge function instead — the browser half is unchanged, because it only ever
 * talks to `/api/uarp/*`.
 *
 * `uarp-reference` regenerates `public/reference.json` from the generated TS
 * sources at the start of every dev server and every build, so the reference
 * pages are always in step with the SDK the package actually ships. It writes
 * only on change, so it does not churn the dev server.
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
    {
      name: 'uarp-reference',
      buildStart() {
        if (writeReferenceIfChanged()) {
          console.log('[uarp-reference] wrote public/reference.json');
        }
      },
    },
    {
      name: 'uarp-wire',
      buildStart() {
        writeWireIfChanged();
      },
    },
  ],
});