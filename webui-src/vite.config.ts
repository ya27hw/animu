import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { mockApi } from './dev/mock-plugin';

const mock = !!process.env.MOCK;

// The build is committed to ../webui so production (a plain git checkout with
// no Node) serves it directly. Filenames are content-hashed, so the server can
// cache /assets/* forever and only index.html needs revalidation.
export default defineConfig({
  plugins: [svelte(), ...(mock ? [mockApi()] : [])],
  build: {
    outDir: '../webui',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 120,
  },
  server: {
    port: 5173,
    proxy: mock ? undefined : { '/api': 'http://localhost:3210' },
  },
});
