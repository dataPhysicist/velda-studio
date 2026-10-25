import { defineConfig } from 'vite'

// The share viewer (08 section 2): a second, small bundle, dist/viewer.js. three.js is not bundled; the
// share page maps "three" to jsDelivr with an import map. Built after the studio (which empties dist/).
export default defineConfig({
  build: {
    outDir: process.env.VIEWER_OUT ?? 'dist',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    lib: { entry: 'src/viewer/main.ts', formats: ['es'], fileName: () => 'viewer.js' },
    rollupOptions: { external: [/^three($|\/)/] },
  },
})
