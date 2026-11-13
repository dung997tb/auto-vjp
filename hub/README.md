# Auto vjp Hub

Máy chủ điều phối nhỏ cho các profile Chrome chạy extension Auto vjp: profile tự báo danh, bạn duyệt một lần, rồi giao việc theo từng profile và xem kết quả.

Hub không cần gói ngoài: chỉ Node.js (22.13 trở lên) và SQLite có sẵn trong Node.

## Chạy bằng Docker

```bash
cd hub
cp docker-compose.example.yml docker-compose.yml
# sửa HUB_ADMIN_PASSWORD trong docker-compose.yml
docker compose up -d --build
```

Mở `http://127.0.0.1:8787` trên máy chủ, đăng nhập bằng `admin` và mật khẩu vừa đặt. Dữ liệu nằm trong volume `auto-vjp-hub-data` (một file `hub.db`).

Chạy thử không cần Docker, từ thư mục gốc của repo:

```bash
HUB_ADMIN_PASSWORD='mat-khau-dai-hon-10' node hub/server.js
```

## Cho extension ở máy khác gọi tới

Extension chỉ được cấp quyền gọi địa chỉ `https://`, nên hub cần có HTTPS. Cách gọn nhất với một máy chủ tại nhà là Tailscale:

```bash
sudo tailscale serve --bg 8787
```

Lệnh này cho địa chỉ dạng `https://ten-may.ten-mang.ts.net`, chỉ các máy trong mạng Tailscale của bạn vào được. Khi đó bật `HUB_SECURE_COOKIE: "1"`.

Nếu đặt sau reverse proxy đang có ở một đường dẫn con (ví dụ `/hub`), bật `HUB_BASE_PATH: "/hub"` và chuyển tiếp nguyên đường dẫn (không cắt tiền tố).

## Ghép nối một profile

1. Trong extension, mở trang quản lý, tới thẻ **Kết nối máy chủ**, nhập địa chỉ hub và bấm **Kết nối**.
2. Trên hub, vào mục **Profile**: profile mới hiện ở **Chờ duyệt** kèm ID và các nick đã quét. Đặt tên rồi bấm **Duyệt**.
3. Từ đó profile tự báo sống mỗi phút khi đang mở, nhận việc đến hạn và gửi kết quả về.

Muốn khỏi nhập địa chỉ trên từng profile: điền `DEFAULT_HUB_URL` ở đầu `modules/kernel/remote.js` rồi phát hành bản extension đó.

## Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `HUB_ADMIN_PASSWORD` | Bắt buộc, tối thiểu 10 ký tự. Đổi rồi khởi động lại là đổi mật khẩu `admin` |
| `HUB_PORT` | Cổng lắng nghe, mặc định `8787` |
| `HUB_DATA` | Thư mục chứa `hub.db`, mặc định `./data` (trong Docker là `/data`) |
| `HUB_BASE_PATH` | Tiền tố đường dẫn khi đặt sau reverse proxy, ví dụ `/hub` |
| `HUB_SECURE_COOKIE` | `1` = cookie đăng nhập chỉ gửi qua HTTPS |

## API cho extension

Mọi lệnh là `POST` với JSON. Sau khi báo danh, extension gửi kèm `Authorization: Bearer <token>`.

| Đường dẫn | Gửi | Nhận |
|---|---|---|
| `/api/agent/register` | `profile_id`, `version`, `accounts` | `status: "pending"`, `token` (chỉ trả một lần) |
| `/api/agent/sync` | `profile_id`, `version`, `busy`, `accept`, `capacity`, `nonce`, `accounts` | `status`, `name`, `nonce`, `tasks: [{id, payload}]` |
| `/api/agent/results` | `profile_id`, `results: [receipt]` | `accepted: [receipt_id]` |

- `sync` chỉ trả việc khi profile đã được duyệt, `accept` là true và `capacity` lớn hơn 0. Việc trả về chuyển sang trạng thái "đã giao".
- `payload` là task phẳng đúng như trang quản lý của extension tạo (`platform`, `type`, `content`, …); hub kiểm tra bằng chính bảng hợp đồng của extension (`modules/kernel/contract.js`).
- Receipt có `remote_task_id` thì cập nhật trạng thái việc tương ứng; receipt của việc chạy tay tại máy cũng được lưu để thống kê.

## Giới hạn hiện tại

- Chỉ giao được việc của tầng module (Instagram, Threads, TikTok, X, YouTube). Tính năng Facebook chưa đi qua hàng đợi này.
- Việc đã giao mà profile tắt giữa chừng sẽ nằm ở "Đã giao, đang làm"; hub không tự giao lại để tránh chạy trùng, bạn bấm **Giao lại** khi cần.
- Hub chưa có màn hình tạo thêm người dùng; dữ liệu đã gắn chủ sở hữu sẵn cho việc đó.
- Giới hạn số lần đăng nhập sai dựa vào địa chỉ IP; sau reverse proxy cần proxy gửi đúng `X-Forwarded-For`.
