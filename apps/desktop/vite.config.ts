import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const contracts = fileURLToPath(new URL('../../runtime/contracts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@contracts': contracts } },
  clearScreen: false,
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] } },
  build: { target: 'safari15', chunkSizeWarningLimit: 700 },
});
