import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 桌面应用用：不带 PWA 的普通构建，输出到 dist-app
export default defineConfig({ base: './', plugins: [react()], build: { outDir: 'dist-app' } });
