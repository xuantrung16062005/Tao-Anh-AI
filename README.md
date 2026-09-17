# Verdant Studio

Ứng dụng web quản lý nhân vật, kịch bản/phân cảnh, tạo ảnh minh hoạ đồng nhất nhân vật bằng Gemini ("Nano Banana"), AI tự viết prompt bối cảnh, và chuyển văn bản thành giọng đọc bằng Gemini TTS.

Đây là bản đã chuyển sang kiến trúc dự án đầy đủ (Vite + Vercel Serverless Functions), giống với cách app YHCT của bạn đang chạy: có build step, có backend API riêng (`/api`), đẩy code lên GitHub là Vercel tự động build & deploy.

## Vì sao chuyển sang kiến trúc này

Bản trước là 1 file `index.html` tĩnh, mở trực tiếp bằng Chrome — không cần cài gì nhưng API key Gemini phải nằm ở trình duyệt (mỗi người dùng tự nhập key riêng). Bản này:

- Có **backend** (`/api/generate-image.js`, `/api/generate-text.js`, `/api/tts.js`) đóng vai trò proxy gọi Gemini — API key Gemini được cấu hình 1 lần trên server (biến môi trường `GEMINI_API_KEY`), không còn lộ ra ngoài trình duyệt.
- Có **build step** (Vite) — code được đóng gói/tối ưu trước khi deploy, giống cấu trúc `vite.config.js` trong app YHCT.
- Có **URL web thật** để chia sẻ, và **tự động deploy** mỗi khi bạn đẩy code lên GitHub (qua Vercel), giống hệt flow bạn đang dùng cho YHCT.
- Người dùng vẫn có thể tự nhập API key riêng ở nút 🔑 nếu muốn override key server (tuỳ chọn, không bắt buộc).

Toàn bộ tính năng và giao diện giữ nguyên như bản trước (nhân vật, kịch bản, AI viết prompt, tạo ảnh Gemini/Pollinations, giọng nói, autosave, hoàn tác/làm lại…) — chỉ khác cách app gọi ra Gemini.

## Cấu trúc thư mục

```
verdant-studio/
├── api/                    # Vercel Serverless Functions (backend)
│   ├── generate-image.js   # Proxy tạo ảnh Gemini (Nano Banana)
│   ├── generate-text.js    # Proxy Gemini text — AI viết prompt "Mô tả bối cảnh"
│   └── tts.js               # Proxy Gemini TTS — chuyển văn bản thành giọng đọc
├── src/
│   ├── main.js              # Toàn bộ logic frontend (JS thuần, không framework)
│   └── style.css            # Toàn bộ CSS
├── index.html                # Trang chính (entry point cho Vite)
├── vite.config.js
├── vercel.json
├── package.json
└── .gitignore
```

## Chạy thử trên máy (local)

Cần cài [Node.js](https://nodejs.org) (bản 18 trở lên) và [Vercel CLI](https://vercel.com/docs/cli) để chạy được cả frontend lẫn backend `/api` cùng lúc:

```bash
npm install
npm install -g vercel     # nếu chưa có Vercel CLI
vercel dev                # chạy cả frontend + /api trên http://localhost:3000
```

Nếu chỉ muốn xem giao diện (không test được các nút gọi AI vì thiếu `/api`), dùng `npm run dev` (Vite dev server, cổng 5173).

## Đưa lên GitHub + deploy bằng Vercel (giống flow app YHCT)

1. Tạo repo GitHub mới (trống), ví dụ `verdant-studio-app`.
2. Trong thư mục dự án này, chạy:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<ten-user-github>/verdant-studio-app.git
   git push -u origin main
   ```
3. Vào [vercel.com](https://vercel.com) → **Add New Project** → chọn import repo `verdant-studio-app` vừa tạo.
4. Ở bước cấu hình project, vào **Environment Variables**, thêm:
   - `GEMINI_API_KEY` = API key Gemini của bạn (lấy tại [Google AI Studio](https://aistudio.google.com/apikey))
   - (tuỳ chọn) `GEMINI_IMAGE_MODEL`, `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL` nếu muốn đổi model mặc định.
5. Bấm **Deploy**. Vercel tự nhận diện `vercel.json` + `package.json`, chạy `npm run build`, deploy cả frontend lẫn 3 hàm `/api`.
6. Từ lần sau, mỗi khi bạn `git push` lên nhánh `main`, Vercel tự động build & deploy bản mới — y hệt cách app YHCT của bạn đang hoạt động (mục **Deployments** trên GitHub/Vercel sẽ tăng dần).

Sau khi deploy xong, bạn (và bất kỳ ai bạn chia sẻ URL) có thể dùng ngay toàn bộ tính năng tạo ảnh/giọng nói mà **không cần tự nhập API key** — vì key đã nằm sẵn trên server.

## Tính năng đã hoạt động thật

- Quản lý nhân vật (upload/xoá ảnh, đặt mặc định)
- Lưu/Mở dự án ra file `.json` thật trên máy (Ctrl+S / Ctrl+O), tự động lưu tạm vào trình duyệt (autosave)
- Hoàn tác / Làm lại nhiều bước (Ctrl+Z / Ctrl+Shift+Z)
- Nhập kịch bản từ file Excel (.xlsx/.xls)
- AI (Gemini) tự viết prompt "Mô tả bối cảnh" cho từng phân cảnh hoặc hàng loạt, dựa vào nội dung/thoại và nhân vật đã chọn
- Gọi API Gemini thật để tạo ảnh (tab Kịch bản & Prompt), giữ đồng nhất ngoại hình nhân vật qua ảnh tham chiếu — hoặc dùng nguồn ảnh miễn phí Pollinations song song
- Tab **Tạo ảnh** riêng: tạo ảnh tự do từ mô tả bất kỳ, xem full/tạo lại/tải từng ảnh và tải toàn bộ dạng `.zip`
- Tab **Giọng nói**: chuyển văn bản thành giọng đọc thật của Gemini (10 giọng có sẵn), tự động đợi & thử lại khi bị giới hạn hạn mức, tải file `.wav`
- Zoom giao diện bằng Ctrl+cuộn chuột

## Lưu ý về hạn mức (quota)

Gemini TTS ở gói miễn phí có hạn mức thấp (khoảng 10 lần/phút). App tự động đợi và thử lại 1 lần khi gặp lỗi "vượt hạn mức" ngắn hạn; nếu vẫn lỗi, đợi khoảng 1 phút rồi thử lại, hoặc nâng cấp gói trả phí ở Google AI Studio để bỏ giới hạn này.
