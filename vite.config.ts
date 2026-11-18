import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Development only: lets tools/sheet-previews.html save the ready-made pictures of
 * each built-in song's opening bars into public/sheet-previews/ (see ui/sheet.ts).
 */
function sheetPreviewSaver(): Plugin {
  return {
    name: 'sheet-preview-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-sheet-preview', (req, res) => {
        const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
        if (req.method !== 'POST' || !/^[a-z0-9-]+$/.test(id)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const dir = resolve(__dirname, 'public/sheet-previews');
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${id}.svg`), body);
          res.end('saved');
        });
      });
    },
  };
}

export default defineConfig({
  // Where the app is served from: "/" locally, "/magic-keys/" on GitHub Pages
  // (the deploy workflow sets BASE_PATH). Every asset path in the app follows this.
  base: process.env.BASE_PATH ?? '/',
  plugins: [sheetPreviewSaver()],
  optimizeDeps: {
    // Pre-bundle these together in development so Basic Pitch and our code share a
    // single TensorFlow.js instance (and its GPU backend), instead of two copies.
    include: ['@spotify/basic-pitch', '@tensorflow/tfjs', 'opensheetmusicdisplay', 'tone', 'fflate'],
  },
  build: {
    // Sheet music (OpenSheetMusicDisplay) and Listen mode (TensorFlow.js) are large,
    // but each is loaded lazily, only when first needed, so the piano itself stays small.
    chunkSizeWarningLimit: 2000,
  },
});
