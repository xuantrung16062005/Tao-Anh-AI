# Tạo ảnh AI — Verdant Studio

Ứng dụng web một file (`index.html`) giúp quản lý nhân vật, kịch bản/phân cảnh và tạo ảnh minh hoạ đồng nhất nhân vật bằng model Gemini "Nano Banana" (`gemini-3.1-flash-image`).

## Cách dùng

1. Tải file `index.html` về máy (hoặc bật GitHub Pages cho repo này ở Settings → Pages → Source: branch `main`, thư mục `/root`, rồi mở link được cấp).
2. Mở bằng Chrome/Cốc Cốc (double-click hoặc kéo vào trình duyệt).
3. Vào tab **Nhân vật**: thêm nhân vật, upload 1–5 ảnh mẫu, mô tả đặc điểm cần đồng nhất, chọn 1 nhân vật mặc định (nút ★).
4. Bấm nút 🔑 ở góc trên bên phải để nhập API key Gemini của bạn (lấy tại [Google AI Studio](https://aistudio.google.com/apikey)).
5. Vào tab **Kịch bản & Prompt**: nhập tay từng phân đoạn hoặc bấm "📥 Nhập từ Excel" để nhập hàng loạt (cột A=Scene, B=Ngôn ngữ 1, C=Tiếng Việt, D=Tên Prompt, E=Mô tả bối cảnh — hàng đầu là tiêu đề sẽ được bỏ qua).
6. Chọn nhân vật cho từng phân cảnh (Scene có chữ "C" tự động chọn nhân vật mặc định), bấm 🎨 để tạo ảnh từng cảnh hoặc "✨ Tạo ảnh hàng loạt" để chạy tuần tự.
7. Xem ảnh cỡ lớn, tinh chỉnh lại, tải từng ảnh hoặc tải toàn bộ dưới dạng file `.zip` (tên file theo đúng giá trị cột Scene).

## Tính năng đã hoạt động thật

- Quản lý nhân vật (upload/xoá ảnh, đặt mặc định)
- Lưu/Mở dự án ra file `.json` thật trên máy (Ctrl+S / Ctrl+O)
- Hoàn tác / Làm lại nhiều bước (Ctrl+Z / Ctrl+Shift+Z)
- Nhập kịch bản từ file Excel (.xlsx/.xls)
- Gọi API Gemini thật để tạo ảnh, giữ đồng nhất ngoại hình nhân vật qua ảnh tham chiếu
- Zoom giao diện bằng Ctrl+cuộn chuột

## Chưa hoạt động (còn là bản demo/giao diện mẫu)

- Tab **Giọng nói**: chưa nối API tạo giọng đọc thật
- Tab **Tạo ảnh** (riêng, ngoài bảng phân cảnh): chỉ minh hoạ bố cục nút bấm

Cần API key Gemini của riêng bạn để dùng chức năng tạo ảnh — key chỉ lưu trên trình duyệt của bạn, không gửi cho ai khác ngoài Google.
