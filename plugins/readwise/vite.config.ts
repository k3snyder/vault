import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'VaultReadwisePlugin',
      fileName: 'plugin',
      formats: ['es']
    },
    rollupOptions: {
      external: ['@vault/plugin-api'],
      output: {
        globals: {
          '@vault/plugin-api': 'VaultPluginAPI'
        }
      }
    },
    target: 'es2020',
    sourcemap: true,
    minify: false
  },
  resolve: {
    alias: {
      '@vault/plugin-api': resolve(__dirname, '../../src-tauri/src/plugin_runtime/typescript/types')
    }
  }
});