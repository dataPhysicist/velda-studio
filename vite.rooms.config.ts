import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Rooms: the photo-first page. A third, light bundle (dist/rooms.js and dist/rooms.css) built after
// the Studio and the share viewer. It shares the Studio's model, plan checks and Toolbelt bridge, and
// none of its 3D, so it stays small enough for a phone.
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const STUDIO_DB = process.env.STUDIO_DB ?? 'velda_studio.duckdb'

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    __STUDIO_VERSION__: JSON.stringify(pkg.version),
    __STUDIO_DB__: JSON.stringify(STUDIO_DB),
  },
  build: {
    outDir: process.env.ROOMS_OUT ?? 'dist',
    emptyOutDir: false,
    target: 'es2022',
    reportCompressedSize: false,
    rollupOptions: {
      input: 'src/rooms/main.tsx',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'rooms.js',
        assetFileNames: (a) => (a.names?.some((n) => n.endsWith('.css')) ? 'rooms.css' : 'files/[name]-[hash][extname]'),
      },
    },
  },
})
