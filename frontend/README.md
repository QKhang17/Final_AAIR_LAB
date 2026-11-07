# AAIR Frontend Guide

Thư mục này quản lý toàn bộ các công cụ đóng gói (bundling), kiểm thử (testing) và môi trường phát triển giao diện của hệ thống AAIR.

## 1. Cấu trúc thư mục

- `../main/`: Chứa mã nguồn Production Multi-Page Application (HTML, CSS, Vanilla JS) đang được phục vụ trực tiếp.
- `src/`: Chứa mã nguồn React 19 + TypeScript prototype (dự án chuyển đổi SPA dài hạn).
- `tests/`: Bộ kiểm thử tự động với Node.js test runner (`main-integration.test.mjs`, `api-client.test.mjs`, v.v.).
- `vite.config.js`: Cấu hình Vite chính để chạy và build ứng dụng Production MPA từ `../main/`.
- `vite.react.config.js`: Cấu hình Vite riêng biệt để chạy và thử nghiệm React SPA prototype.

## 2. Các lệnh npm

### Luồng Production (Multi-Page Application)
```bash
# Khởi chạy server phát triển MPA trên cổng 5173
npm run dev

# Đóng gói toàn bộ 34 trang MPA ra thư mục dist/
npm run build

# Xem thử bản build production
npm run preview
```

### Luồng Thử nghiệm React Prototype (SPA)
```bash
# Khởi chạy ứng dụng React SPA prototype trên cổng 5174
npm run dev:react-prototype

# Đóng gói ứng dụng React ra thư mục dist-react/
npm run build:react-prototype

# Kiểm tra kiểu TypeScript
npm run typecheck
```

### Kiểm thử Tự động
```bash
# Chạy toàn bộ test suites của hệ thống
npm test
```
