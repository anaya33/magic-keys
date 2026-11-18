import { defineConfig } from 'vite';

export default defineConfig({
  // Where the app is served from: "/" locally, "/magic-keys/" on GitHub Pages
  // (the deploy workflow sets BASE_PATH). Every asset path in the app follows this.
  base: process.env.BASE_PATH ?? '/',
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
