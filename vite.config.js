import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mee Stock — Vite config
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
  build: { outDir: 'dist', sourcemap: false },
});
