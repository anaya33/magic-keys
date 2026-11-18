import { defineConfig } from 'vite';

export default defineConfig({
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
