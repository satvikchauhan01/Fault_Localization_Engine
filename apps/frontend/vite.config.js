import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        // IPv4 on purpose: Node resolves "localhost" to ::1 first, and on Windows a
        // WSL relay can hold [::1]:3000 while Docker publishes the backend on IPv4.
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
