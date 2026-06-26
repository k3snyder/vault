import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, cpSync, readFileSync, writeFileSync } from 'fs';

function removeExcalidrawRemoteFontFallback() {
  const bundlePath = resolve(__dirname, '../excalidraw/excalidraw-bundle.js');
  const bundle = readFileSync(bundlePath, 'utf8');
  const remoteFallbackAppendPattern =
    /return ([A-Za-z_$][\w$]*)\.push\(new URL\(([A-Za-z_$][\w$]*),[A-Za-z_$][\w$]*\.ASSETS_FALLBACK_URL\)\),\1/;
  const patched = bundle.replace(remoteFallbackAppendPattern, 'return $1');

  if (patched === bundle) {
    throw new Error('Failed to remove Excalidraw remote font fallback from generated bundle');
  }

  writeFileSync(bundlePath, patched);
}

function copyExcalidrawHostAssetsPlugin() {
  return {
    name: 'copy-excalidraw-host-assets',
    closeBundle() {
      removeExcalidrawRemoteFontFallback();
      copyFileSync(
        resolve(__dirname, 'src/index.html'),
        resolve(__dirname, '../excalidraw/index.html')
      );
      copyFileSync(
        resolve(__dirname, 'src/excalidraw-config.js'),
        resolve(__dirname, '../excalidraw/excalidraw-config.js')
      );
      cpSync(
        resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),
        resolve(__dirname, '../excalidraw/fonts'),
        { recursive: true, force: true }
      );
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), copyExcalidrawHostAssetsPlugin()],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/entry.tsx'),
      formats: ['iife'],
      name: 'ExcalidrawBridge',
      fileName: () => 'excalidraw-bundle.js'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: '[name][extname]'
      }
    },
    target: ['safari15', 'chrome100'],
    minify: 'esbuild',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    outDir: '../excalidraw',
    emptyOutDir: true
  }
});
