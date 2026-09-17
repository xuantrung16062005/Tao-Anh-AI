import { defineConfig } from 'vite';

export default defineConfig({
  // Verdant Studio là 1 trang tĩnh (không router), Vite chỉ dùng để build/minify + có server dev cho local.
  build: {
    outDir: 'dist'
  },
  server: {
    // Khi chạy "npm run dev", các request /api/* sẽ được Vercel CLI (vercel dev) xử lý riêng —
    // xem README để chạy thử cả frontend lẫn backend cùng lúc trên máy.
    port: 5173
  }
});
