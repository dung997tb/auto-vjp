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

## Giao nhanh

Mục mặc định của hub. Một lần giao chỉ có ba câu hỏi, không phải chọn nền tảng hay loại việc:

- **Làm gì**: Nuôi nick hoặc Quét nick.
- **Cho ai**: tất cả profile, một nhóm, hoặc một profile. Nhóm đặt bằng nút **Nhóm** trên thẻ profile.
- **Khi nào**: ngay, hằng ngày từ một giờ nhất định, hoặc hẹn một lần. Với hai lựa chọn sau, việc được rải ngẫu nhiên trong số phút bạn đặt.

Hub tự suy ra phần còn lại từ bảng Nick: profile có nick ở nền tảng nào thì nhận việc nuôi ở nền tảng đó, đúng kiểu của nền tảng (Facebook là tương tác bảng tin, chỉ thả cảm xúc). Profile chưa có nick bị bỏ qua và được báo lại. Muốn giới hạn thì mở **Thu hẹp nền tảng**.

**Mức độ** thay cho các con số:

| | Nhẹ | Vừa | Mạnh |
|---|---|---|---|
| Số hành động tối đa | 4 | 8 | 15 |
| Thời lượng tối đa (phút) | 6 | 10 | 20 |
| Video xem (TikTok, YouTube) | 3 | 5 | 10 |
| Tỉ lệ thích | 60% | 80% | 90% |
| Bình luận | tắt | 60% | 70% |
| Lưu (Instagram, TikTok) | tắt | bật | bật |
| Bài tương tác trên Facebook | 8 | 20 | 40 |

Theo dõi và đăng ký kênh luôn tắt ở cả ba mức. Các mức hiện cố định trong mã (`LEVELS` trong `hub/server.js`), chưa chỉnh được trên giao diện.

**Các lần giao**: mỗi lần giao là một dòng với số việc xong, đang chờ, lỗi. Mở ra để xem chi tiết **theo nick** (mỗi nick một dòng) hoặc **theo profile Chrome** (mỗi profile một dòng, trạng thái từng nền tảng nằm cạnh nhau). Có nút giao lại phần lỗi và huỷ phần chưa chạy; với lần giao lặp hằng ngày, huỷ cũng dừng việc lặp.

Các việc của cùng một profile trong một lần giao được xếp chạy liền nhau, nên profile chỉ phải mở một lần; các profile khác nhau chạy lệch giờ nhau.

## Nick

Mục **Nick** liệt kê mọi nick trên các profile: nền tảng, tên và username, thuộc profile nào, số người theo dõi, lần quét cuối (đánh dấu "cũ" nếu quá 3 ngày) và kết quả việc gần nhất của profile trên nền tảng đó. Lọc theo nền tảng hoặc tìm theo tên.

- Profile tự quét khi vừa được duyệt (đủ 5 nền tảng, mỗi lượt đồng bộ một nền tảng, chỉ khi rảnh). Sau đó nền tảng đã có nick được quét lại mỗi ngày, nền tảng chưa có nick được thử lại mỗi tuần. Tắt được ở thẻ Kết nối máy chủ trong extension.
- Nút **Quét nick** trên thẻ profile giao ngay 5 việc quét.
- Nick và Page Facebook lấy từ những gì lõi Facebook đang nhớ: tên nick cá nhân (có sau khi chạy một tính năng Facebook) và danh sách Page đã quét trong popup. Chưa có số người theo dõi và chưa tự quét lại.
- Nick đã đăng xuất hoặc bị khoá không tự biến mất khỏi danh sách; cột "Quét lúc" cho biết dữ liệu cũ tới đâu.
- "Việc gần nhất" tính theo profile và nền tảng. Nếu một profile đăng nhập nhiều nick cùng nền tảng, các nick đó hiện chung một kết quả.

## Giao việc

Mục **Việc (nâng cao)** dùng khi cần giao một loại việc cụ thể với tham số riêng. Form đổi theo từng loại, không phải gõ JSON:

- **Giao cho**: tích một hoặc nhiều profile; mỗi profile nhận một việc riêng.
- **Nuôi nick**: số hành động, thời lượng, bật tắt thích / lưu / theo dõi / bình luận, tỉ lệ từng loại, mẫu bình luận dự phòng. Các trường đổi theo nền tảng (TikTok và YouTube có thêm số video xem, YouTube có từ khoá tìm video).
- **Đăng bài, Story, bình luận, gắn link, tải video**: nội dung, ảnh hoặc video theo URL, URL bài đích, mẫu trả lời.
- **Lệch ngẫu nhiên tối đa (phút)**: mỗi profile chạy trễ một khoảng ngẫu nhiên sau giờ hẹn, để các nick không bắt đầu cùng phút. Với việc lặp hằng ngày, mỗi ngày lệch một khoảng khác, tính từ giờ hẹn gốc.
- **Trường khác (JSON, nâng cao)**: cho loại việc chưa có form (ví dụ `micro_action`) hoặc trường hiếm dùng.

Ví dụ nuôi 20 nick Instagram mỗi ngày: chọn tất cả, nền tảng Instagram, loại Nuôi nick, chạy lúc 09:00, lệch tối đa 180 phút, tích lặp hằng ngày. Kết hợp với launcher GemLogin, mỗi nick tự được mở vào một lúc khác nhau trong khoảng 09:00–12:00, nuôi xong tự đóng.

## Giao việc Facebook

Cấu hình của tính năng Facebook (danh sách nhóm, nội dung, giới hạn…) khá dài, nên hub không bắt gõ tay:

1. Trên profile, mở popup, cấu hình tính năng như bình thường rồi bấm hẹn lịch một lần (hẹn giờ nào cũng được, huỷ sau cũng được).
2. Lần đồng bộ kế tiếp, profile báo cấu hình đó lên hub làm **mẫu**.
3. Trên hub, mục **Việc**: chọn profile, nền tảng `facebook`, chọn mẫu. Ô cấu hình được điền sẵn, sửa được trước khi giao; tích "Lặp lại hằng ngày" nếu muốn.

Payload gửi cho extension có dạng `{platform: "facebook", type: "fb_feature", feature, label, config}`. Extension kiểm lại `config` bằng bộ chuẩn hoá của lõi; sai thì từ chối và báo lý do về hub.

## Tự mở profile bằng GemLogin

Nếu profile chạy trong GemLogin, hub có thể tự mở profile khi có việc đến hạn và đóng khi xong, qua chương trình launcher đặt trên máy có GemLogin. Cách cài và cách hub quyết định mở/đóng: xem [`launcher/README.md`](../launcher/README.md).

Launcher gọi `POST /api/launcher/sync` (Bearer token của máy chạy) với `gem_profiles`, `running`, `idle_close_ms`, `error`; hub trả `{start: [{gem_id, name, reason}], stop: [{gem_id, name, reason}]}`.

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
| `/api/agent/sync` | `profile_id`, `version`, `busy`, `accept`, `capacity`, `nonce`, `accounts` (mỗi mục: `platform`, `kind`, `username`, `name`, `followers`, `scanned_at`) | `status`, `name`, `nonce`, `tasks: [{id, payload}]` |
| `/api/agent/results` | `profile_id`, `results: [receipt]` | `accepted: [receipt_id]` |

- `sync` chỉ trả việc khi profile đã được duyệt, `accept` là true và `capacity` lớn hơn 0. Việc trả về chuyển sang trạng thái "đã giao".
- `payload` là task phẳng đúng như trang quản lý của extension tạo (`platform`, `type`, `content`, …); hub kiểm tra bằng chính bảng hợp đồng của extension (`modules/kernel/contract.js`).
- Receipt có `remote_task_id` thì cập nhật trạng thái việc tương ứng; receipt của việc chạy tay tại máy cũng được lưu để thống kê.

## Giới hạn hiện tại

- Việc Facebook chạy bằng bộ hẹn giờ của lõi extension, nên chỉ chạy được một tính năng Facebook tại một thời điểm trên mỗi profile; việc đến sau sẽ chờ (tối đa 60 phút).
- Chưa giao được cả một chuỗi Facebook trong một việc; giao từng bước.
- Tính năng Facebook dừng giữa chừng được ghi là "Không chắc" (có thể đã làm một phần). Kiểm tra trước khi bấm **Giao lại** để tránh đăng trùng.
- Việc đã giao mà profile tắt giữa chừng sẽ nằm ở "Đã giao, đang làm"; hub không tự giao lại để tránh chạy trùng, bạn bấm **Giao lại** khi cần.
- Chưa có giới hạn số phiên mỗi ngày theo nick ở phía hub; mỗi việc là một phiên, bạn tự quyết số việc giao.
- Hub chưa có màn hình tạo thêm người dùng; dữ liệu đã gắn chủ sở hữu sẵn cho việc đó.
- Giới hạn số lần đăng nhập sai dựa vào địa chỉ IP; sau reverse proxy cần proxy gửi đúng `X-Forwarded-For`.
