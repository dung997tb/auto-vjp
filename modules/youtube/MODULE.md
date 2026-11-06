# Module YouTube — Auto vjp (Slice 7, port từ MUT, scope hẹp)

- Nguồn (chỉ đọc): `~/workspace/app-remake-team/jobs/auto-post-mut/work/content-scripts/youtube/`
- Đích: `~/workspace/auto-vjp/modules/youtube/`
- Cách port: `cp` nguyên khối, KHÔNG sửa nội dung 3 file.
- Ngày kiểm: 2026-11-04.
- **Scope hẹp của fork (khác MUT gốc):** fork CHỈ dùng Community post/comment của `automator.js`. Upload video qua `studio.youtube.com` bị cắt khỏi v1 ở tầng kernel — kernel không bao giờ mở Studio cho task `post`. `automator.js` vẫn copy nguyên khối (nó tự phân nhánh theo hostname, xem §5) — KHÔNG sửa, KHÔNG cắt code Studio trong file này.

## 0. Trạng thái copy

| File | Dòng | Bytes | MD5 (nguồn = đích) | SHA-256 |
|---|---|---|---|---|
| `automator.js` | 425 | 18,999 | `9027d9d3fcff78129f1bfe4772e22fa9` | `41255c0f5be2c79e3c64959ac927a4363ae3f1e90328a102fa47b131df4bde15` |
| `accounts-scanner.js` | 414 | 17,530 | `867b21de4861c6badd139fc0f38abdb7` | `31f24218cb254e542027b6e4963a4dc0365df6fd2f3a4965449fc869ed25a740` |
| `discovery.js` | 61 | 3,568 | `70ecfa3f1c8cd2369f6803503be16214` | `bfb30e8e3ca05b2a77723c28b7d3d15a64e15808fddabe95c953062c1ee54009` |

MD5 của cả 3 file đích khớp 100% file nguồn — copy nguyên vẹn.

## 1. `node --check`

| File | Kết quả |
|---|---|
| `automator.js` | ✅ OK |
| `accounts-scanner.js` | ✅ OK |
| `discovery.js` | ✅ OK |

3/3 pass, không lỗi cú pháp. Lưu ý: `node --check` chỉ kiểm tra cú pháp, không kiểm tra dependency runtime (xem §4 — `discovery.js` cần 2 global do bên inject cấp).

## 2. Chuỗi cấm — kết quả grep + phân loại

Các chuỗi đã grep (exact) trên cả 3 file: `mut.vn`, `claim-next`, `api_token`, `api_base`, `MUT_SEND_TOKEN`, `mut-bridge`, `clients2.google`, `14.225`

**Kết quả: 0 hit cho cả 8 chuỗi, trên cả 3 file.**

| Chuỗi cấm | Hit |
|---|---|
| `mut.vn` | — không có |
| `claim-next` | — không có |
| `api_token` | — không có |
| `api_base` | — không có |
| `MUT_SEND_TOKEN` | — không có |
| `mut-bridge` | — không có |
| `clients2.google` | — không có |
| `14.225` | — không có |

### Phân loại

- **(a) URL/endpoint/token server thật = vấn đề: KHÔNG CÓ.** Không file nào trong module chứa URL/endpoint/token của server MUT, không có `claim-next`, không có bridge token.
- **(b) Tên key storage local tiền tố `mutvn` = vô hại: KHÔNG CÓ.** Grep `mutvn` (exact) = 0 hit trong cả 3 file. Các key storage thật của module xem §4 — không key nào mang tiền tố `mutvn`.

### Hit gần giống (grep mở rộng `-i mut`) — không thuộc danh sách cấm, ghi để minh bạch

Đây KHÔNG phải chuỗi cấm ở trên; đều là định danh local trong trang, giữ nguyên, không sửa:

| File:dòng | Nội dung | Phân loại |
|---|---|---|
| `automator.js:3-4` | Cờ chống inject trùng `window.__mut_yt_automator_injected` | (b) Vô hại — biến local trên `window` |
| `automator.js:6,11,395,415` | Tiền tố log `[MUT-YT-Automator]` | (b) Vô hại — chỉ là nhãn `console.log`/`console.error`/`console.warn` |
| `automator.js:22,25` | Element overlay trạng thái `document.getElementById('mut-status')` / `el.id = 'mut-status'` | (b) Vô hại — id DOM local |
| `accounts-scanner.js:239,341` | Tiền tố log `[MUT-YT-Scanner]` trong `console.warn` | (b) Vô hại — chỉ là nhãn log |

## 3. `getURL` / `chrome.runtime.getURL`

**Không có hit nào** trong cả 3 file — grep `getURL` và `chrome.runtime.getURL` đều 0 hit.

→ Module này không tự nạp tài nguyên/bridge qua `getURL`; không cần khai báo thêm `web_accessible_resources` cho cơ chế đó từ phía module.

## 4. Giao diện của module (interface)

### 4.1 Storage keys (`chrome.storage.local`)

Chỉ `automator.js` dùng `chrome.storage`. `accounts-scanner.js` và `discovery.js` không đụng `chrome.storage` (grep = 0 hit ở 2 file đó).

Đọc (get):

| Key | File:dòng | Ghi chú |
|---|---|---|
| `currentProcessingPost` | `automator.js:279` (cùng lệnh get với `isPaused`); `automator.js:408` | Task đang xử lý. Ở :279 dùng để guard `activeTask()` trong Community post: nếu `isPaused` hoặc `currentProcessingPost.id` khác `task.id` thì ném lỗi dừng. Ở :408 dùng cho auto-start khi load trang (xem §4.3). |
| `isPaused` | `automator.js:279` | Cờ tạm dừng toàn cục; `true` → Community runner dừng. |

Ghi (set):

| Key | File:dòng | Ghi chú |
|---|---|---|
| `lastStatus` | `automator.js:15` | `chrome.storage.local.set({ lastStatus: text })` trong hàm `log()` — ghi đè mỗi lần log, dùng cho bảng "Đang xử lý" hiển thị chung (đúng tiền lệ contract: `lastStatus` là key hiển thị chung duy nhất tầng module được chạm). |

### 4.2 Message actions

#### Nhận vào (`chrome.runtime.onMessage`) — chỉ `automator.js`

| Action nhận | File:dòng | Hành vi |
|---|---|---|
| `EXECUTE_YOUTUBE_POST` | `automator.js:386-387` — `chrome.runtime.onMessage.addListener((request, sender, sendResponse) => { if (request.action === 'EXECUTE_YOUTUBE_POST') { … } })` | **Xác nhận: CÓ.** Nhận `request.task`. Phân nhánh theo hostname ở `automator.js:389`: `location.hostname.includes('studio.youtube.com')` → `handleStudioVideoUpload(task)`, ngược lại → `handleYouTubeCommunityPost(task)`. Trả `sendResponse({ success: true })` khi runner xong; khi lỗi thì gửi thêm `postFailed` (xem dưới) rồi `sendResponse({ success: false, error })`. Listener `return true` (giữ kênh async). |

`accounts-scanner.js` và `discovery.js`: không có `onMessage` listener (grep `onMessage` = 0 hit ở 2 file đó) — chúng là script chạy ngay khi được inject (IIFE), không chờ lệnh message.

#### Gửi đi (`chrome.runtime.sendMessage`)

`automator.js`:

| Action | File:dòng | Ý nghĩa |
|---|---|---|
| `mediaFetchStart` | `automator.js:98` (qua helper `send()` định nghĩa ở `automator.js:96`) | Nhờ background/kernel tải media theo chunk; đi cùng `mediaFetchChunk` / `mediaFetchEnd` |
| `mediaFetchChunk` | `automator.js:103` (qua `send()`) | Lấy chunk 480 KB tiếp theo (`id`, `offset`, `length`) |
| `mediaFetchEnd` | `automator.js:110` (qua `send()`) | Kết thúc phiên tải media |
| `postCompleted` | `automator.js:268` (Studio runner, kèm `postId: task.id`, `resultUrl: permalink`); `automator.js:378` (Community runner, kèm `postId: task.id`, `resultUrl`) | Báo đăng bài xong |
| `postFailed` | `automator.js:396` (từ catch của nhánh `EXECUTE_YOUTUBE_POST`, kèm `postId`, `error`); `automator.js:417` (từ catch của auto-start, kèm `postId`, `error`) | Báo đăng bài lỗi |

`accounts-scanner.js`:

| Action | File:dòng | Ý nghĩa |
|---|---|---|
| `socialAccountsScannerResult` | `accounts-scanner.js:396` (có `accounts` khi quét được); `accounts-scanner.js:401` (`accounts: []` + `error` khi không tìm thấy kênh); `accounts-scanner.js:408` (`accounts: []` + `error` khi exception) | Báo kết quả quét tài khoản về background/kernel — IIFE tự chạy sau `sleep(500)` rồi gửi, không chờ message kích hoạt |

`discovery.js`: không gọi `chrome.runtime.sendMessage` trực tiếp — nó báo kết quả qua `utils.sendDiscovery(context, …)` (xem §4.4).

### 4.3 Auto-start từ `currentProcessingPost` — xác nhận

**Xác nhận: CÓ, ở cuối `automator.js:408-424`.**

- Ngay khi script được inject/load xong, nó chạy `chrome.storage.local.get('currentProcessingPost', …)` (`automator.js:408`).
- Nếu `post` tồn tại và `post.platform === 'youtube' || post.account_platform === 'youtube'` (`automator.js:410`) thì tự khởi động runner mà không cần message `EXECUTE_YOUTUBE_POST`.
- Phân nhánh giống hệt nhánh message (`automator.js:411-412`): hostname chứa `studio.youtube.com` → `handleStudioVideoUpload(post)`, ngược lại → `handleYouTubeCommunityPost(post)`.
- Lỗi ở đường auto-start → gửi `postFailed` (`automator.js:417`).

Hệ quả cho kernel: chỉ cần ghi đúng `currentProcessingPost` (platform youtube) + inject `automator.js` vào tab YouTube (không phải Studio, theo scope hẹp) là Community post tự chạy; đường message `EXECUTE_YOUTUBE_POST` là đường kích hoạt thứ hai cho cùng 2 runner.

### 4.4 `discovery.js` — dùng để làm gì, ai gọi nó

**Dùng để làm gì:**

- Là script **discovery của pha quét tài khoản (scan_account)** cho YouTube, chuyên cho trang channel switcher (`https://www.youtube.com/channel_switcher` theo registry của MUT gốc). Header comment `discovery.js:1-2`: channel switcher nạp các dòng tài khoản sau `ytInitialData`; script quan sát cả các dòng đó lẫn dữ liệu nhúng, và không bao giờ bịa ID từ tên hiển thị.
- Cách đọc: duyệt đệ quy `ytInitialData` trong các `<script>` của trang tìm `accountItemRenderer` (bỏ qua item `isDisabled`/`isSuspended` và byline chứa removed/bị xóa/bị khóa/disabled/suspended), đồng thời đọc DOM `ytd-account-item-renderer` (`#channel-title`, các `yt-formatted-string`, link `/channel/UC…`). Chỉ chấp nhận `channelId` khớp `^UC[\w-]{22}$` hoặc handle khớp `^@…`; parse số subscriber (kể cả "no subscribers / không có người đăng ký" → 0) qua `utils.parseMetric`.
- Vòng ổn định: lặp tối đa 40 lần, mỗi lần cách 500 ms, dừng khi danh sách tài khoản không đổi trong 3 lần liên tiếp (`stable >= 3`).
- Kết quả mỗi tài khoản: `{ platform: 'youtube', social_uid, social_username, social_name, followers_count, subscribers_count }`.
- Báo kết quả ở dòng cuối (`discovery.js:60`): `await utils.sendDiscovery(context, { accounts, ...(error nếu rỗng: 'Không tìm thấy kênh YouTube đang đăng nhập trong danh sách chuyển kênh.') })`.

**Phụ thuộc bắt buộc (không tự chạy độc lập được):**

- `discovery.js:4` — `const context = globalThis.__accountScanContext;`
- `discovery.js:5` — `const utils = globalThis.accountScanUtils;` (dùng `utils.parseMetric` và `utils.sendDiscovery`)
- Kernel/bên inject phải đặt 2 global này TRƯỚC khi inject `discovery.js` (đúng contract §4: nạp `account-scan-utils.js` + đặt `globalThis.__accountScanContext = { scanId, stepId, platform }` trước script scan). Thiếu 2 global này thì script lỗi ngay, không có fallback.

**Ai gọi nó:**

- Trong cả 3 file của module: **không file nào gọi `discovery.js`** — grep `discovery` trong `automator.js` + `accounts-scanner.js` + chính `discovery.js` = 0 hit (ngoài lời gọi `sendDiscovery` là tên hàm của utils, không phải tên file).
- Bên gọi là **tầng ngoài module (kernel / scanner service)**: ở MUT gốc, `services/social-scanner-service.js:21` khai registry `youtube: { url: 'https://www.youtube.com/channel_switcher', discovery: 'content-scripts/youtube/discovery.js' }` và service đó mở tab tới URL trên rồi inject file discovery theo phase `discovery`. Ở fork Auto vjp, vai tương đương thuộc kernel (registry ở `modules/kernel/contract.js`) — file này chờ kernel inject, tự nó không được `automator.js`/`accounts-scanner.js` nạp.
- Phân biệt với `accounts-scanner.js`: `accounts-scanner.js` là scanner độc lập kiểu cũ (tự quét DOM trang hiện tại / chuyển tài khoản qua avatar, tự gửi `socialAccountsScannerResult`, không cần `__accountScanContext`/`accountScanUtils`), còn `discovery.js` là scanner theo cơ chế context+utils của scanner service. Cả hai cùng phục vụ `scan_account` nhưng ở hai đường inject khác nhau — entry point chính thức của fork là `accounts-scanner.js` (xem §5).

## 5. Entry point

| Loại task | Entry point | Ghi chú |
|---|---|---|
| `post` (Community) | `automator.js` | Hai đường kích hoạt: (1) message `EXECUTE_YOUTUBE_POST` (`automator.js:386`), (2) auto-start từ `currentProcessingPost` khi load trang (`automator.js:408`). Trong file, runner Community là `handleYouTubeCommunityPost(task)` (`automator.js:276`); runner Studio là `handleStudioVideoUpload(task)` (`automator.js:142`) — chỉ được chọn khi hostname là `studio.youtube.com` (`automator.js:389,411`). **Theo scope hẹp của fork, kernel không mở Studio cho task `post` nên ở v1 chỉ nhánh Community chạy trên thực tế; code Studio giữ nguyên khối trong file, không sửa.** |
| `scan_account` | `accounts-scanner.js` | IIFE tự chạy khi inject, gửi `socialAccountsScannerResult`. `discovery.js` là script discovery phụ trợ cho cùng pha scan trên trang channel_switcher, do kernel/scanner-service inject kèm 2 global `__accountScanContext` + `accountScanUtils` (xem §4.4) — không phải entry point độc lập thay thế `accounts-scanner.js`. **Từ 2.6.0 entry point chính thức đổi sang `discovery.js` — xem §7.** |
| `reply` / `affiliate` | — | Module YouTube không có file cho 2 loại này (khớp registry contract: youtube chỉ có `post` + `scan_account`). **`reply` có từ 2.6.0 — xem §7.** |

## 6. Không làm (theo lệnh lát)

- Không sửa `manifest.json`, `background.js`, `popup.*` của fork.
- Không sửa nội dung 3 file đã copy.
- Không đụng thư mục khác ngoài `modules/youtube/`.

## 7. Thay đổi 2.6.0 (vòng YouTube riêng, 2026-11-05)

Mục này thay thế trạng thái ở §0/§5 cho các phần liên quan: từ 2.6.0
module KHÔNG còn là "copy nguyên khối không sửa" đối với `automator.js`.

### 7.1 Scan: entry point đổi sang `discovery.js` — nguyên nhân gốc của scan timeout

- Triệu chứng: task `scan_account` YouTube luôn treo tới timeout.
- Nguyên nhân gốc (file:dòng): kernel chỉ chốt receipt scan khi
  `modules/kernel/results.js` (nhánh `socialAccountsScannerResult`)
  thấy `message.scanId === run.task_id` của run đang chạy.
  `accounts-scanner.js` (bản cũ được contract tham chiếu) gửi
  `socialAccountsScannerResult` **không kèm `scanId`** nên không bao
  giờ khớp — tài khoản quét được vẫn lưu vào kho nhưng receipt không
  chốt, task chết bằng timeout. `discovery.js` thì báo qua
  `utils.sendDiscovery(context, …)` trong `account-scan-utils.js`, hàm
  này tự gắn `scanId: context.scanId` + `stepId` — khớp điều kiện.
- Vá (ở `modules/kernel/contract.js`): nhánh youtube/scan_account đổi
  files sang `[SCAN_UTILS, 'modules/youtube/discovery.js']` (giữ cờ
  `scan: true` để runner đặt `__accountScanContext` trước khi inject)
  và cộng `scanHome: 'https://www.youtube.com/channel_switcher'` cho
  youtube — `startUrl` của scan lấy `scanHome` nên tab mở thẳng trang
  chuyển kênh mà discovery.js được viết cho nó. `accounts-scanner.js`
  **giữ nguyên trong module, chỉ hết được tham chiếu**.

### 7.2 Post: đi đường tab Community `/@<handle>/community`

- Bằng chứng live (2026-11-05, soi trên profile công nhân): kênh
  @baonhandanmedia CÓ khung soạn ở
  `https://www.youtube.com/@<handle>/community` (ô "Bạn đang nghĩ gì?"
  + nút Đăng); đường cũ mở `/@<handle>/posts` (startUrl cũ) không phải
  bề mặt soạn bài thật.
- Vá: `contract.js` startUrl post youtube đổi `/posts` →
  `/@<handle>/community`; `automator.js` viết lại riêng luồng Community
  (`handleYouTubeCommunityPost`, nhánh Studio không đụng):
  - Task thiếu `social_username` → tự suy handle kênh đang đăng nhập
    từ DOM: `#channel-handle`/link `/@…` trong menu tài khoản → bấm
    `#avatar-btn` mở menu rồi đọc lại → dự phòng điều hướng
    `/feed/you` + `vanityChannelUrl` (chỉ tin trên `/feed/*` và trang
    kênh). Handle cache ở `sessionStorage` của tab; số lần điều hướng
    cho 1 task bị chốt (key `avjpYtCommunityNav:<taskId>`, tối đa 4)
    chống vòng lặp vô hạn.
  - Tìm ô soạn: editor đã mở sẵn trong
    `ytd-backstage-post-dialog-renderer`, hoặc phần tử mở hộp soạn
    (`#commentbox-placeholder`, `#post-button`, placeholder trong
    `ytd-backstage-post-shelf-renderer`). Quá 15s không thấy → throw
    `community_composer_not_found` (→ `postFailed`), không treo.
  - Điền nội dung + đính ảnh: giữ nguyên cơ chế cũ trong dialog.
  - Proof mới (thay chờ URL `/post/` mới tối đa 90s của bản cũ): chụp
    snapshot các phần tử `ytd-backstage-post-renderer` /
    `ytd-backstage-post-thread-renderer` trước khi bấm Đăng; bài MỚI
    chứa chữ ký nội dung (40 ký tự đầu đã chuẩn hoá) xuất hiện trong
    tối đa 20s = proof. Không proof → throw
    `community_post_unconfirmed`. `result_url` = permalink
    `a[href*="/post/"]` bên trong bài vừa đăng; không lấy được thì URL
    trang Community hiện tại.

### 7.3 Reply: MỚI — `interaction.js` (task comment độc lập)

- File mới `modules/youtube/interaction.js`; contract cộng nhánh
  youtube/`reply` → `[CANONICAL, 'modules/youtube/interaction.js']`,
  `startUrl` dùng logic reply sẵn có (= `task.source_url`).
- Khuôn: đọc task qua canonical (`currentCommentReplyTask_youtube`),
  báo kết quả bằng `commentReplyDone` như interaction của Threads/IG;
  primitives comment lấy từ adapter nuôi (simplebox, insertText,
  proof chữ ký trong `#comments`).
- Hành vi: không phải trang watch mà có `source_url` → điều hướng
  thẳng tới video; trang live/chat → failed `live_chat_not_comments`;
  chờ `#comments` render ≤15s (không render →
  `comments_not_rendered`); video tắt bình luận → `comments_disabled`;
  nội dung = `task.content`, thiếu + `smart_reply_enabled` → sinh AI
  qua action `getNurtureAiComment` (đường API lõi của kernel, cùng
  đường adapter nuôi dùng), AI không có → `reply_templates[0]`; proof
  chữ ký hiện trong danh sách ≤15s → done (item `target_url` = URL
  video), không proof → `comment_proof_timeout`, không gửi lại.
  Timeout mặc định theo `defaultTimeoutMs('reply')` của contract.
- Manage có nút "Comment YouTube (task mẫu)" (video mẫu + content mẫu
  tiếng Việt) cạnh các nút nuôi.

## 8. Đính chính 2.6.1 (2026-11-05) — danh tính chưa có kênh + gỡ lớp suy handle

### 8.1 Sự thật danh tính (probe DOM live trên profile công nhân)

- Tài khoản Google đang đăng nhập YouTube là **"Linh Vu"**
  (vulinh224488@gmail.com). Menu tài khoản hiện `#account-name`
  "Linh Vu", **không có `#channel-handle`**, và có nút **"Tạo kênh"**
  → tài khoản này **chưa có kênh YouTube**.
- `@baonhandanmedia` là kênh của Báo Nhân Dân (báo nhà nước) mà tài
  khoản này chỉ **đăng ký xem**. Handle này lọt vào kết quả soi trước
  từ link `/@…` trên trang `/feed/you` — KHÔNG phải kênh sở hữu.

### 8.2 Ba hệ quả

1. **Đăng Community post là không thể** với danh tính này — không có
   kênh thì không có tab Community của chính mình để đăng.
2. **Comment cũng bị chặn**: YouTube bắt tạo kênh trước — bấm ô
   comment thì hộp thoại tạo kênh hiện thay cho editor.
3. **Cơ chế suy handle của 2.6.0 là nguy hiểm**: các lớp yếu có thể vớ
   handle của kênh lạ (đã xảy ra với @baonhandanmedia) → nguy cơ điều
   hướng/gõ bài vào kênh không thuộc sở hữu. Phải gỡ tận gốc, không
   chỉ sửa selector.

### 8.3 Vá 2.6.1

- **`automator.js` (poster)**: handle CHỈ được chấp nhận từ 2 nguồn
  có thẩm quyền sở hữu: (a) `task.social_username` người dùng cấp;
  (b) `#channel-handle` trong `ytd-active-account-header-renderer`
  (header menu tài khoản, mở qua `#avatar-btn`). **Đã gỡ**: lớp link
  `/@…` tự do trong menu/popup/masthead, lớp `/feed/you` +
  `vanityChannelUrl` (gồm cả điều hướng dự phòng sang `/feed/you`).
  Cache handle đổi key sang `avjpYtOwnHandle:v2` để vô hiệu cache có
  thể đã nhiễm handle kênh lạ từ phiên 2.6.0. Không có
  `#channel-handle` → throw ngay `no_youtube_channel` ("Tài khoản
  YouTube chưa có kênh, không đăng Community được."), không điều
  hướng sang kênh nào khác, không gõ vào bất kỳ ô nào. Có handle hợp
  lệ → giữ nguyên luồng `/community` + proof của 2.6.0.
- **`discovery.js` (scan)**: cộng nguồn danh tính hiện tại — mở menu
  avatar (bấm `#avatar-btn` một lần nếu header chưa render), đọc
  `ytd-active-account-header-renderer`: có `#channel-handle` thì
  `add()` tài khoản hiện tại (tên từ `#account-name`, handle từ
  `#channel-handle`); không có thì giữ kết quả từ các hàng switcher
  như cũ. Tổng vẫn 0 → error đổi thành **"Tài khoản YouTube chưa có
  kênh."** Các hàng "Không có kênh" tiếp tục bị loại tự nhiên (không
  uid) như trước.
- **`interaction.js` (reply) + `youtube-nurture/adapter.js`
  (doComment)**: phát hiện hộp thoại tạo kênh (dialog đang hiện chứa
  nút/link "Tạo kênh"/"Create channel") ngay trong các vòng chờ ô
  comment/editor → kết luận sạch, không chờ treo, không thử lại:
  - interaction: fail `channel_required` ("cần tạo kênh YouTube mới
    bình luận được");
  - nurture: journal comment `skipped` note `channel_required`, đặt
    cờ `youtubeNurtureNoChannel` (cạnh `…Deadline`/`…Source`) tắt
    comment cho phần còn lại của phiên; phiên vẫn xem/like bình
    thường.

## 9. Bài học 2.6.2 — phải cuộn LẶP LẠI TỨC THỜI trong lúc chờ comment

- Triệu chứng: kênh đã tạo xong (@LinhVu-t2g) nhưng task reply vẫn
  fail `comment_box_not_found`, dù selector ô soạn là đúng.
- Bằng chứng probe giữa lúc module chạy: **scrollY = 0** (trang không
  hề cuộn), 0 simplebox trong DOM, `#comments` ở top=2232px chưa vào
  viewport → YouTube **không lazy-load** nội dung comment khi section
  chưa từng vào viewport.
- Nguyên nhân: code cũ chỉ `scrollIntoView({behavior:'smooth'})`
  đúng 1 lần ở đầu rồi chờ thụ động — cuộn mượt bị trang SPA
  nuốt/reset. Chờ bao lâu cũng vô ích vì điều kiện nạp (vào viewport)
  không bao giờ xảy ra.
- Probe tay đối chứng: chờ trang ổn định + `scrollIntoView` TỨC
  THỜI → simplebox + `#simplebox-placeholder` hiện đầy đủ. Kết luận:
  selector đúng, lỗi nằm ở cơ chế cuộn/chờ, không sửa selector.
- Quy tắc từ 2.6.2 (áp cho cả `interaction.js` lẫn pha doComment của
  `youtube-nurture/adapter.js`): trong MỌI vòng poll của các vòng chờ
  liên quan tới comment (render section, chờ ô soạn), phải cuộn TỨC
  THỜI (không smooth, cộng `window.scrollBy` dự phòng khi anchor vẫn
  ngoài viewport) lại tới anchor `#comments`. Chờ thụ động sau 1 lần
  cuộn là sai trên YouTube SPA.
- Kèm theo ở `interaction.js`: điều kiện "section đã render" phải
  siết — `#header` rỗng có sẵn trong vỏ `ytd-comments` không tính;
  render thật = có `ytd-comment-simplebox-renderer` hoặc có ít nhất
  1 `ytd-comment-thread-renderer`. Nếu không, vòng chờ báo 'ready'
  giả và fail sai mã (`comment_box_not_found` thay vì
  `comments_not_rendered`).

## 10. Bài học 2.6.3 — chờ masthead render rồi mới suy handle, đừng bấm avatar 1 lần lúc inject

- Triệu chứng: kênh đã tạo xong (@LinhVu-t2g, mở menu tay thì
  `#channel-handle` hiện sau ~1s) nhưng task post KHÔNG kèm
  `social_username` vẫn fail `no_youtube_channel`. Receipt về sau
  ~4s kể từ enqueue — quá nhanh cho một vòng chờ 5s đầy đủ.
- Nguyên nhân: `ytResolveOwnHandle` bản cũ query `#avatar-btn`
  đúng 1 lần ngay tại thời điểm inject → masthead chưa render xong
  nên trả null (bỏ cuộc luôn), hoặc click rơi trước khi YouTube
  gắn handler mở menu → menu không mở → `#channel-handle` không
  bao giờ xuất hiện → kết luận "chưa có kênh" oan. Mẫu lỗi giống hệt
  vụ comment 2.6.2: thao tác 1 lần trên trang chưa sẵn sàng, không
  poll điều kiện tiên quyết.
- Vá 2.6.3 (chỉ `automator.js`, hàm `ytResolveOwnHandle`): poll chờ
  nút avatar XUẤT HIỆN tối đa 10s mới bấm; sau khi bấm poll
  `#channel-handle` tối đa 10s, ~4s mà header menu
  (`ytd-active-account-header-renderer`) vẫn chưa xuất hiện thì bấm
  avatar thêm 1 lần rồi poll nốt (header đã hiện mà thiếu handle thì
  không bấm lại — bấm nữa sẽ đóng menu, và đó là chưa có kênh thật).
- Quy tắc: kết luận "không có kênh" (`no_youtube_channel`) chỉ hợp
  lệ sau khi đã chờ đủ — chờ nút xuất hiện, chờ menu mở, có bấm lại
  khi menu chưa mở. Nguồn handle giữ nguyên 2.6.1 (chỉ
  `task.social_username` hoặc `#channel-handle` trong header menu),
  cache `avjpYtOwnHandle:v2` giữ nguyên.

## 11. Upload FULL — `upload.js` (2.8.0, lát 5 plan Story/Reels/Shorts)

Từ 2.8.0 youtube có thêm type `upload` — tải video lên qua YouTube
Studio (video thường dài + Shorts dọc/ngắn đi CHUNG một luồng upload,
YouTube tự phân loại). Đây là thay đổi scope do Dũng chốt 12:16
2026-11-05 ("YouTube có uploaded full đi"), đảo lại scope hẹp ở đầu
tài liệu này đối với đường upload — NHƯNG chỉ qua đúng module mới:
type `post` vẫn là Community poster, chặn enqueue post+video ở
`modules/kernel/source.js` vẫn nguyên, đoạn Studio legacy trong
`automator.js` (`handleStudioVideoUpload`) vẫn không được contract
tham chiếu và không bị sửa.

### 11.1 Entry point + hợp đồng

| Hạng mục | Giá trị |
|---|---|
| Task type | `upload` (MỚI, chỉ youtube — platform khác trả spec null) |
| Contract | `modules/kernel/contract.js`: youtube/upload → `[CANONICAL, modules/youtube/upload.js]`; `startUrl` upload = `https://studio.youtube.com`; `AVJP.contract.TASK_TYPES` cộng `'upload'` |
| Contract data | `TASK_TYPES.UPLOAD = 'upload'`; `TASK_METADATA.upload.default_timeout_ms = 1.800.000` (30 phút — upload video chậm) |
| Báo kết quả | action `uploadCompleted` / `uploadFailed` (`modules/kernel/results.js`, deliver type `'upload'`, mang `details` như story) |
| Phase storage | `avjpYtUploadPhase` (taskId, phase uploading/proving/done, title, description, details, isShort, channelId, provingStartedAt, proofReloadTried) — mẫu phase của `modules/instagram/story.js` |
| Media | qua background `mediaFetchStart/Chunk/End` như mọi poster; chỉ 1 video/task (file đầu nếu task có nhiều) |
| Chạm hoạt động | action `postUploadStarted` mỗi ~45s trong các vòng chờ dài (watchdog inactivity 5 phút không đóng oan phiên đang tải) |

Field task dùng: `images`/`media_urls` (URL video), `content` (chất
liệu: dòng 1 = tiêu đề, còn lại = mô tả), `title` (ưu tiên hơn dòng
đầu content khi không có AI), `ai_prompt` (tuỳ chọn), `visibility`
(`public` mặc định | `unlisted`).

### 11.2 Luồng (Studio)

1. Mở `studio.youtube.com`; vòng chờ 90s phân biệt 3 kết cục: nút
   Create/dialog đã sẵn sàng / bề mặt đăng nhập / dấu hiệu "chưa có
   kênh" (nút "Tạo kênh" hiện ≥5s mà không có Create). Bước trung
   gian ĐÃ VERIFY BẰNG PROBE LIVE (FORK-CHANGES #88): trong Chrome
   headless, Studio dừng ở trang chặn "trình duyệt không được hỗ
   trợ" — module bấm link "Chuyển thẳng đến YouTube Studio"
   (`a[href*="approve_browser_access=true"]`, tối đa 2 lần qua mọi
   lần inject, đếm trong phase `studioSkipTries`; bấm là full
   navigation sang `/channel/<id>`), gia hạn chờ +60s mỗi lần bấm,
   và dọn dialog chào mừng ("Chào mừng bạn đến với YouTube Studio"
   → `#dismiss-button`) + banner "Bỏ qua phần hướng dẫn" trong lúc
   chờ. Nút Create thật (đã verify): ytcp-button text "Tạo"/"Create"
   với button con `aria-label="Tạo"` — không có `#create-button`;
   menu Create = `tp-yt-paper-item#text-item-0` "Tải video lên";
   `ytcp-uploads-dialog` chứa đúng 1 `input[type="file"]`.
2. Bấm Create → mục "Upload videos/Tải video lên" → chờ input file
   trong `ytcp-uploads-dialog` → nạp File bằng DataTransfer + native
   setter (khuôn story.js). Restart-tolerant: dialog đã ở bước chi
   tiết (có ô tiêu đề) thì bỏ qua bước nạp.
3. Chờ bước chi tiết ≤120s (ô tiêu đề `ytcp-social-suggestions-
   textbox` hiện). YouTube báo định dạng không hợp lệ/tải thất bại →
   `media_load_failed`.
4. Điền tiêu đề + mô tả (contenteditable: focus → selectAll →
   insertText, dự phòng textContent + sự kiện input; đọc lại kiểm
   chứng; ô tiêu đề mang sẵn tên file mặc định nên luôn ghi đè trừ
   khi đã đúng).
5. Chọn radio đối tượng `VIDEO_MADE_FOR_KIDS_NOT_MFK` ("Không dành
   cho trẻ em") — bắt buộc mới đi tiếp; bấm không ăn thì bấm lớp
   radio trong, vẫn không ghi nhận → `studio_not_ready`.
6. Bấm `#next-button` qua các bước (tối đa 4 nhịp) tới bước Hiển
   thị. Cảnh báo ở bước Kiểm tra (bản quyền...) KHÔNG chặn — chỉ
   cổng xác minh mới chặn (xem 11.5).
7. Chọn radio hiển thị theo `task.visibility` (`PUBLIC`/`UNLISTED`)
   → chờ `#done-button` bật tối đa 10 phút → bấm Đăng/Xong.

### 11.3 Tiêu đề/mô tả + AI (khuôn 12:21)

- Có `ai_prompt`: gọi action `getNurtureAiComment` (cùng đường
  story.js/họ nuôi: API lõi fork + dự phòng aitab) với deadline
  riêng 70s, chạy SONG SONG với tải file/mở dialog. Prompt = ai_prompt
  + yêu cầu định dạng (dòng 1 = tiêu đề ≤100 ký tự, phần còn lại =
  mô tả) + `content` làm chất liệu. Parse: dòng đầu khác rỗng = tiêu
  đề (bóc ngoặc kép, cắt 100), phần còn lại = mô tả. Thành công →
  details `ai_used`.
- AI lỗi/timeout/trả rỗng, hoặc không có ai_prompt: tiêu đề =
  `task.title` || dòng đầu `content`; mô tả = phần content còn lại
  (nếu tiêu đề lấy từ `task.title` thì mô tả = toàn bộ content).
  Có ai_prompt mà phải rơi về đường này → details `ai_fallback`.
- `is_short`: đo metadata file TRƯỚC khi tải (object URL + phần tử
  video): dọc (height > width) và duration ≤60s → details cộng
  `is_short=true`; đo được mà không đạt → `is_short=false`; không
  đo được → bỏ qua trường này.

### 11.4 Proof

Không tin nút Đăng. Sau khi bấm Đăng: ghi phase `proving` (kèm
tiêu đề + details + mốc thời gian) rồi điều hướng sang trang Nội
dung của Studio — ưu tiên bấm mục "Nội dung/Content" ở thanh điều
hướng trái, dự phòng URL `https://studio.youtube.com/channel/<id>/videos`
(channel id lấy từ URL/link trong trang; không lấy được thì mở
trang chủ Studio chờ nó tự chuyển hướng sang `/channel/<id>/`).
Bản inject mới ở phase `proving`: nếu chưa ở `/videos` thì tự điều
hướng về đúng trang trước, rồi poll các hàng `ytcp-video-row` tối
đa 90s tìm hàng có tiêu đề khớp tiêu đề vừa đặt (khớp nguyên văn
sau chuẩn hoá, hoặc bắt đầu bằng 40 ký tự đầu — danh sách có thể
cắt tiêu đề dài), tải lại trang 1 lần ở mốc 45s. Thấy → lấy video
id từ link `/video/<id>/edit` trong hàng → `uploadCompleted` với
`result_url = https://www.youtube.com/watch?v=<id>`. Hết 90s không
thấy → `uploadFailed` `upload_proof_failed`.

### 11.5 Lỗi + cổng xác minh

| Mã (prefix message) | Khi nào |
|---|---|
| `session_expired` | Bị đẩy về accounts.google.com, hoặc Studio hiện bề mặt/nút Sign in |
| `no_youtube_channel` | Studio hiện lời mời tạo kênh, không có nút Create (tài khoản chưa có kênh) |
| `youtube_verification_required` | Dialog/trang chứa yêu cầu xác minh số điện thoại/danh tính (quét ở lúc mở Studio, sau nạp file, giữa các bước, trước Đăng) — fail tại chỗ, TUYỆT ĐỐI không lách. Kênh mới có thể vấp cổng này với video dài/tính năng nâng cao; Dũng xử lý tay trong Studio nếu gặp |
| `studio_not_ready` | Studio không sẵn sàng sau 90s (đã gồm cả xử lý trang chặn trình duyệt + dialog chào mừng); dialog upload không mở/không có input file; nạp file xong 120s không sang bước chi tiết; mất ô tiêu đề; không điền được tiêu đề; radio đối tượng không thấy/không ghi nhận; nút Tiếp kẹt >30s; không tới được bước hiển thị; nút Đăng không bật sau 10 phút |
| `media_load_failed` | Task không có media; tải media qua background lỗi; YouTube từ chối định dạng file |
| `upload_proof_failed` | Đã Đăng nhưng không thấy video đúng tiêu đề trong danh sách nội dung sau 90s; hoặc không xác định được channel id để mở trang nội dung |

### 11.6 Trạng thái kiểm chứng (lát build)

- `node --check` PASS cho upload.js + contract.js + contract-data.js
  + results.js + manage.js; harness contract 39/39 PASS; lab load
  2.8.0 (xem báo cáo build).
- Test live đầu FAIL `studio_not_ready` sau 48,6s — gốc rễ là trang
  chặn trình duyệt của Studio trong headless (xem #88), KHÔNG phải
  selector Create/dialog lệch. Vá #88: bấm xuyên trang chặn + dọn
  dialog chào mừng + ngân sách chờ 90s. Selector đã có bằng chứng
  DOM live qua probe #88: nút Create, menu "Tải video lên",
  `ytcp-uploads-dialog` + `input[type="file"]`. Vẫn CHƯA verify
  live: ô `ytcp-social-suggestions-textbox`, radio audience/
  visibility, nút `#next-button`/`#done-button` (probe dừng trước
  khi chọn file theo kỷ luật) — rủi ro chính của vòng test live kế.
- Manage: nút "Upload video YouTube (task mẫu)" (video mẫu
  ForBiggerEscapes.mp4 của gtv-videos-bucket, content 2 dòng,
  visibility public, ai_prompt mẫu để dạng comment tắt kèm ghi chú
  cách bật).

## 12. Tự chữa selector (2.9.0, FORK-CHANGES #87)

- Contract cộng `modules/shared/healer.js` (HEALER) vào spec `reply`:
  `[CANONICAL, HEALER, modules/youtube/interaction.js]`. Kiến trúc +
  spec format + giới hạn an toàn: `modules/shared/HEALER.md`.
- Điểm đấu: `interaction.js` — key `yt.reply.commentBox`. Vòng chờ
  hợp nhất 30s giữ nguyên; khi #comments đã render mà ô soạn vẫn
  không hiện (nhánh sắp fail `comment_box_not_found`) thì gọi
  `AVJP.heal.locate` (đã học → builtin css `#simplebox-placeholder`
  → AI từ snapshot, root = section #comments, ngân sách 30s). Định vị
  được → bấm mở editor (vẫn rà dialog tạo kênh → `channel_required`)
  → chờ editor như thường. Spec qua AI chỉ `markProven` **sau proof
  chữ ký comment**; heal vắng/fail → fail `comment_box_not_found`
  như cũ.
- Healthscan YouTube dùng chung key `yt.reply.commentBox` trên trang
  watch mẫu (`watch?v=aqz-KE-bpKQ`), có bước cuộn tức thời tới
  #comments trước khi locate — chỉ định vị, không bấm (xem HEALER.md).
