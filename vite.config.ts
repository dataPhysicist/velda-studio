import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// Two build targets:
//  - default: assets resolve relative to the page (local dev / preview; ./assets is the public dir)
//  - STUDIO_CDN=1: code and assets are served by jsDelivr from this repo.
//    Assets are pinned to STUDIO_ASSET_REF: a commit SHA (or tag) that contains ./assets.
//    The Toolbelt page is a tiny index.html that loads dist/studio.js at the commit that contains the build.
const REPO = process.env.STUDIO_REPO ?? 'dataPhysicist/velda-studio'
const cdn = process.env.STUDIO_CDN === '1'
const ASSET_REF = process.env.STUDIO_ASSET_REF ?? `v${pkg.version}`
const ASSET_BASE = cdn ? `https://cdn.jsdelivr.net/gh/${REPO}@${ASSET_REF}/assets` : '.'

// Pascal references its static assets with root-absolute paths ("/icons/wall.webp").
// The app is not served from a domain root, so point those at ASSET_BASE instead.
const assetPaths: Plugin = {
  name: 'studio-asset-paths',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0]
    if (!/@pascal-app|src\/host/.test(file) || !/\.(tsx?|jsx?)$/.test(file)) return null
    const out = code.replace(/(['"`])\/(icons|audios)\//g, `$1${ASSET_BASE}/$2/`)
    return out === code ? null : { code: out, map: null }
  },
}

// Generated 3D models load from blob: URLs; Pascal's resolver would prefix them with the asset base.
const blobUrls: Plugin = {
  name: 'studio-blob-urls',
  enforce: 'pre',
  transform(code, id) {
    if (!/viewer\/dist\/lib\/asset-url\.js$/.test(id.split('?')[0])) return null
    const out = code.replaceAll("url.startsWith('http://') || url.startsWith('https://')", "url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')")
    return out === code ? null : { code: out, map: null }
  },
}

export default defineConfig({
  base: './',
  publicDir: cdn ? false : 'assets',
  plugins: [assetPaths, blobUrls, react(), tailwindcss()],
  resolve: {
    alias: {
      'next/image': path.resolve('shims/image.tsx'),
      'next/link': path.resolve('shims/link.tsx'),
      '@': path.resolve('src/host'),
    },
    dedupe: ['react', 'react-dom', 'three', 'zustand', '@react-three/fiber', '@react-three/drei'],
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify(ASSET_BASE),
    'process.env': '{}',
    __STUDIO_ASSET_BASE__: JSON.stringify(ASSET_BASE),
    __STUDIO_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 30000,
    reportCompressedSize: false,
    // One code file on purpose. jsDelivr fetches each file of a GitHub ref on first request, and a
    // cold release split into ~290 chunks loads slowly and intermittently fails; one file does not.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'studio.js',
        assetFileNames: (a) => (a.names?.some((n) => n.endsWith('.css')) ? 'studio.css' : 'files/[name]-[hash][extname]'),
      },
    },
  },
})
