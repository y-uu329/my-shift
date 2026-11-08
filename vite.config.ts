import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' にして、GitHub Pages のどのURL（例：https://<ユーザー名>.github.io/my-shift/）に置いても動くようにする
// SINGLE_FILE=1 のときは、試用版用に1つのファイルにまとめる（あとから読み込む部品も分けない）
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { inlineDynamicImports: process.env.SINGLE_FILE === '1' } },
  },
});
