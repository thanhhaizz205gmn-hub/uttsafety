# UTT AI Safety Monitoring - PWA Version 🛡️

Hệ thống giám sát an toàn lao động dựa trên trí tuệ nhân tạo (AI), được tối ưu hóa dưới dạng Ứng dụng Web Luỹ tiến (PWA) để chạy mượt mà trên iPhone và iPad.

## ✨ Tính năng nổi bật
- **Giao diện hiện đại**: Thiết kế Glassmorphism chuyên nghiệp, tối ưu cho màn hình di động.
- **Standalone Mode**: Chạy toàn màn hình, không hiện thanh địa chỉ trình duyệt (giống ứng dụng gốc).
- **Giám sát thời gian thực**: Theo dõi vi phạm thiết bị bảo hộ (PPE) và xâm nhập vùng cấm (ROI).
- **Hỗ trợ iOS**: Tối ưu hóa các thẻ meta Apple và biểu ngữ hướng dẫn cài đặt dành riêng cho iPhone.
- **Offline Caching**: Sử dụng Service Worker để lưu bộ nhớ đệm các tài nguyên tĩnh, giúp ứng dụng khởi động tức thì.

## 📱 Hướng dẫn cài đặt trên iPhone (iOS)

Để có trải nghiệm tốt nhất như một ứng dụng thực thụ, hãy làm theo các bước sau:

1. Mở trình duyệt **Safari** trên iPhone của bạn.
2. Truy cập vào đường dẫn: `https://uttsafety.vercel.app` (Hoặc domain GitHub Pages của bạn).
3. Nhấn vào biểu tượng **Chia sẻ (Share)** (hình vuông có mũi tên trỏ lên) ở thanh công cụ dưới cùng.
4. Cuộn xuống và chọn **"Thêm vào màn hình chính" (Add to Home Screen)**.
5. Nhấn **Thêm (Add)** ở góc trên bên phải.
6. Quay lại màn hình chính và mở ứng dụng **UTT Safety** vừa xuất hiện.

## 🛠️ Cấu trúc thư mục
- `index.html`: Điểm truy cập chính của ứng dụng.
- `manifest.json`: Cấu hình PWA và biểu tượng ứng dụng.
- `sw.js`: Service Worker quản lý cache và hiệu năng.
- `/assets`: Hình ảnh, icons và âm thanh cảnh báo.
- `/css`: Stylesheet chính (`style.css`).
- `/src`: Logic JavaScript (`script.js`).

## 🚀 Triển khai trên Vercel
Dự án này đã được cấu hình sẵn để triển khai ngay lập tức trên Vercel:
1. Kết nối Repository này với tài khoản Vercel của bạn.
2. Vercel sẽ tự động nhận diện `index.html` ở thư mục gốc.
3. Nhấn **Deploy** và tận hưởng kết quả.

---
**Phát triển bởi Đội ngũ UTT AI Safety**
