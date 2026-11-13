# Auto vjp Launcher — đầu nối GemLogin

Chương trình nhỏ chạy trên **máy có GemLogin**. Nó nối ba thứ lại với nhau:

```
Hub (NUC)  ⇄  Launcher (máy có GemLogin)  ⇄  GemLogin Local API (localhost:1010)
                                                   │ mở / đóng profile
                                                   ▼
                                   Profile Chrome có extension Auto vjp
                                   (tự báo danh, nhận việc, gửi kết quả về hub)
```

Launcher không điều khiển trang web nào. Việc trong profile vẫn do extension Auto vjp làm; launcher chỉ lo **mở profile khi có việc và đóng khi xong**.

## GemLogin cho phép gì qua API

GemLogin mở một Local API tại `http://localhost:1010` khi ứng dụng đang chạy, không cần token. Các lệnh theo tài liệu của GemLogin:

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Danh sách profile | `GET /api/profiles` | lọc `group_id`, phân trang `page`/`per_page`, `sort` (0 mới nhất, 1 cũ nhất, 2 A–Z, 3 Z–A) |
| Một profile | `GET /api/profile/{id}` | |
| Tạo / sửa | `POST /api/profiles/create`, `POST /api/profiles/update/{id}` | body JSON: tên, nhóm, proxy, hệ điều hành, user agent, múi giờ, quốc gia… |
| Xoá | `GET /api/profiles/delete/{id}` | |
| **Mở** | `GET /api/profiles/start/{id}` | tuỳ chọn `addination_args`, `win_pos`, `win_size`, `win_scale`; trả `remote_debugging_address` (nối được Puppeteer/Playwright), `browser_location`, `driver_path` |
| **Đóng** | `GET /api/profiles/close/{id}` | |
| Đổi fingerprint | `GET /api/profiles/changeFingerprint?profileIds=…` | |
| Phiên bản trình duyệt, nhóm | `GET /api/browser_versions`, `GET /api/groups` | |
| Kịch bản của GemLogin | `GET /api/scripts`, `/api/scripts/execute/{id}`, `/api/scripts/check-status/{id}`, `/api/scripts/kill-execute/{id}` | Auto vjp không dùng tới |

`gemlogin.js` bọc toàn bộ các lệnh trên; launcher chỉ dùng ba lệnh: danh sách, mở, đóng.

**Lưu ý về độ chắc chắn:** tôi viết theo tài liệu công khai của GemLogin, chưa chạy với ứng dụng GemLogin thật. Đường dẫn và tham số lấy đúng theo tài liệu; hình dạng JSON trả về được đọc phòng thủ vì có thể khác giữa các bản. Trong GemLogin, bấm nút **API** để xem danh sách lệnh đúng với bản bạn đang cài. Một số bài viết nhắc tới `api.gemlogin.io` kèm Bearer token; đó không phải Local API này.

## Chuẩn bị

1. Máy có GemLogin cần Node.js 18 trở lên.
2. Mỗi profile GemLogin phải cài extension Auto vjp (mục quản lý extension của GemLogin) và đã nối hub. Gọn nhất là điền `DEFAULT_HUB_URL` trong `modules/kernel/remote.js` trước khi cài, để profile nào mở lên cũng tự báo danh.
3. Hub phải truy cập được từ máy này qua HTTPS (ví dụ Tailscale).

## Cài và chạy

1. Trên hub, mục **Máy chạy**, bấm **Thêm máy chạy**. Hub hiện một đoạn cấu hình có token (chỉ hiện một lần).
2. Trên máy có GemLogin, chép thư mục `launcher/` về, tạo file `launcher.config.json` cạnh `launcher.js` với đoạn cấu hình đó:

   ```json
   {
     "HUB_URL": "https://nuc.ten-mang.ts.net",
     "LAUNCHER_TOKEN": "…",
     "MAX_PARALLEL": 2,
     "IDLE_CLOSE_MINUTES": 3
   }
   ```

3. Mở GemLogin, rồi chạy:

   ```bash
   node launcher.js
   ```

4. Trên hub, thẻ máy chạy chuyển sang **Đang chạy** và hiện số profile GemLogin đọc được.

Để chạy nền trên Windows: tạo một tác vụ trong Task Scheduler chạy `node launcher.js` lúc đăng nhập.

| Cấu hình | Mặc định | Ý nghĩa |
|---|---|---|
| `HUB_URL`, `LAUNCHER_TOKEN` | — | bắt buộc |
| `GEMLOGIN_URL` | `http://127.0.0.1:1010` | địa chỉ Local API |
| `MAX_PARALLEL` | 2 | số profile launcher mở cùng lúc |
| `IDLE_CLOSE_MINUTES` | 3 | profile rảnh bao lâu thì đóng |
| `POLL_SECONDS` | 30 | nhịp hỏi hub |
| `WIN_SIZE`, `WIN_POS`, `WIN_SCALE`, `START_ARGS` | — | tham số mở cửa sổ, chuyển nguyên cho GemLogin |

Mọi mục đều đặt được bằng biến môi trường cùng tên.

## Ghép profile GemLogin với profile Auto vjp

Hub cần biết profile Auto vjp nào (ID `pf_…`) nằm trong profile GemLogin nào. Có hai cách:

- **Dò ghép tự động**: trên thẻ máy chạy, bấm **Dò ghép tự động**. Launcher lần lượt mở từng profile GemLogin chưa ghép; profile Auto vjp nào đang tắt mà báo sống ngay sau đó thì hub ghép hai bên và điền sẵn tên theo GemLogin. Mỗi profile mất tối đa khoảng 2,5 phút. Profile mới vẫn phải bấm **Duyệt** như thường.
- **Ghép tay**: trên thẻ từng profile ở mục **Profile**, chọn profile GemLogin tương ứng.

## Hub quyết định mở và đóng thế nào

- **Mở** khi profile đã ghép, bật "Tự mở khi có việc", đang nhận việc, có việc đến hạn, và đang tắt.
- **Giữ** khi profile đang bận, còn việc đến hạn, hoặc có việc đã giao chưa báo kết quả (tối đa 4 giờ).
- **Đóng** khi hết việc và đã rảnh quá `IDLE_CLOSE_MINUTES`.
- **Mở hỏng**: mở rồi mà 10 phút extension không báo sống thì đóng, hiện cảnh báo trên thẻ profile, 60 phút sau mới thử lại.
- Launcher **chỉ đóng profile do chính nó mở**; profile bạn mở tay trong GemLogin không bị đụng tới. Danh sách này lưu trong `launcher-state.json` nên khởi động lại launcher vẫn nhớ.

## Dùng `gemlogin.js` riêng

```js
const { createGemLogin } = require('./gemlogin.js');
const gem = createGemLogin();                       // http://127.0.0.1:1010
const profiles = await gem.listProfiles();          // [{id, name, group, raw}]
const { debugAddress } = await gem.startProfile(profiles[0].id, { winSize: '1280,800' });
await gem.closeProfile(profiles[0].id);
```
