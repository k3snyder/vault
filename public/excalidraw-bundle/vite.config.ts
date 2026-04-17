import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

function copyHtmlPlugin() {
  return {
    name: 'copy-html',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'src/index.html'),
        resolve(__dirname, '../excalidraw/index.html')
      );
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), copyHtmlPlugin()],
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
