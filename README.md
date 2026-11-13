# Auto vjp

Extension Chrome (Manifest V3) tự động hoá thao tác mạng xã hội, chạy hoàn toàn trên máy người dùng.

- **Facebook** (lõi): kết bạn có lọc, đăng và share bài vào nhóm bằng AI, Story, Reels, Bản tin, Trend, bán hàng.
- **Tầng module** (`modules/`): Instagram, Threads, TikTok, X, YouTube — đăng bài, trả lời bình luận, bình luận affiliate, nuôi tài khoản, upload video, quét tài khoản, quét sức khoẻ selector.
- **AI**: dùng API key của chính bạn (OpenAI, Gemini, Claude, Groq, OpenRouter, DeepSeek, Mistral) hoặc tab ChatGPT/Gemini đang đăng nhập.

## Cài đặt

1. Tải mã nguồn về một thư mục cố định (git clone hoặc giải nén zip).
2. Mở `chrome://extensions`, bật **Chế độ dành cho nhà phát triển**.
3. Bấm **Tải tiện ích đã giải nén** và chọn thư mục vừa tải.

Yêu cầu Chrome 111 trở lên. Extension không có bước build.

## Cập nhật

Trang quản lý (`manage.html`, mở từ popup) có nút **Cập nhật**: chọn thư mục extension một lần, công cụ tải bản mới từ GitHub theo đúng một commit, kiểm tra toàn vẹn file zip, rồi hiện bản tóm tắt (commit, file thêm/đổi/xoá, quyền mới nếu có) để bạn xác nhận trước khi ghi. Ghi xong, mở `chrome://extensions` bấm ⟳ ở thẻ Auto vjp.

Bước xác nhận không thay được chữ ký số: hãy đọc kỹ bản tóm tắt, nhất là khi bản mới xin thêm quyền.

## Quản lý nhiều profile từ xa (tuỳ chọn)

Mặc định extension chạy độc lập và không gửi gì ra ngoài. Nếu bạn chạy [Auto vjp Hub](hub/README.md) trên máy chủ của mình, mỗi profile có thể nối vào hub ở thẻ **Kết nối máy chủ** trong trang quản lý: profile tự báo danh bằng một ID riêng, bạn duyệt một lần trên hub, sau đó profile mở lên là tự nhận việc đến hạn và gửi kết quả về.

- Extension luôn là bên gọi ra; hub không gọi vào extension.
- API key AI và phiên đăng nhập không được gửi lên hub. Hub chỉ nhận ID profile, phiên bản, tên các tài khoản đã quét và kết quả từng việc.
- Tại máy luôn có quyền cao hơn: tắt "Nhận việc từ máy chủ" hoặc bấm "Ngắt kết nối" bất cứ lúc nào.
- Hub giao được việc của Instagram, Threads, TikTok, X, YouTube và 23 tính năng Facebook của lõi (đăng nhóm, share, kết bạn, tương tác…). Với Facebook, hub dùng lại cấu hình bạn đã tạo trong tab Lịch của popup trên profile đó.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `manifest.json` | Khai báo extension |
| `background.js` | Service worker của lõi Facebook, gọi AI, nạp tầng module ở cuối file |
| `popup.html`, `popup.js` | Giao diện chính |
| `manage.html`, `manage.js`, `manage-updater.js` | Trang quản lý tầng module và bộ tự cập nhật |
| `content.js`, `feed.js`, `page.js`, `group.js`, … | Content script chạy trên facebook.com |
| `modules/kernel/` | Hàng đợi, lịch, runner, outbox/receipt, tự chữa selector |
| `modules/<nền tảng>/` | Module từng nền tảng, mỗi module có `MODULE.md` |
| `modules/shared/` | Tiện ích dùng chung cho module |
| `hub/` | Máy chủ điều phối (tuỳ chọn): duyệt profile, giao việc từ xa, xem kết quả — xem [`hub/README.md`](hub/README.md) |
| `launcher/` | Đầu nối GemLogin (tuỳ chọn): chạy trên máy có GemLogin, tự mở profile khi có việc và đóng khi xong — xem [`launcher/README.md`](launcher/README.md) |
| `i18n.js` | Từ điển Việt/Anh |
| `tests/`, `tools/` | Test và công cụ kiểm tra |

Tài liệu thiết kế: [`modules/MODULE-CONTRACT.md`](modules/MODULE-CONTRACT.md) (hợp đồng giữa lõi và module) và [`modules/shared/HEALER.md`](modules/shared/HEALER.md) (tự chữa selector).

## Phát triển

Cần Node.js 22.13 trở lên (hub dùng SQLite có sẵn trong Node), không phải cài gói nào.

```bash
npm run check          # chạy cả ba bước dưới
npm run check:syntax   # cú pháp mọi file .js + file manifest tham chiếu
npm run check:i18n     # từ điển vi/en: khoá trùng, khoá lệch
npm test               # test kernel, bộ cập nhật, hub, launcher, phân tích số liệu
npm run hub            # chạy hub tại chỗ (cần đặt HUB_ADMIN_PASSWORD)
```

GitHub Actions chạy đúng ba bước này cho mỗi lần push và pull request.

Khi phát hành: tăng `version` ở cả `manifest.json` và `package.json` (bước kiểm tra cú pháp báo lỗi nếu lệch).

Lỗi bị bỏ qua có chủ đích được ghi bằng `console.debug` với tiền tố `[Auto vjp][<tên file>]`. Muốn xem, bật mức **Verbose** trong DevTools của trang, popup hoặc service worker.

## Lưu ý khi dùng

- Tự động hoá tài khoản trái điều khoản sử dụng của hầu hết các nền tảng; tài khoản có thể bị hạn chế hoặc khoá. Hãy tự cân nhắc tần suất và giới hạn.
- Gặp trang đăng nhập, checkpoint hoặc captcha, task dừng và báo thất bại; công cụ không tìm cách vượt qua.
- API key AI lưu trong bộ nhớ extension của Chrome (một phần cấu hình AI dùng `chrome.storage.sync`, nên có thể đồng bộ theo tài khoản Google nếu bạn bật đồng bộ Chrome).
