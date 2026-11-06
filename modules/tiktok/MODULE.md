# Module TikTok — Auto vjp (Slice 5, port từ MUT)

- Nguồn (chỉ đọc): `~/workspace/app-remake-team/jobs/auto-post-mut/work/content-scripts/tiktok/`
- Đích: `~/workspace/auto-vjp/modules/tiktok/`
- Cách port: `cp` nguyên khối, KHÔNG sửa nội dung 8 file. Kiểm chứng SHA-256: cả 8 file đích khớp 100% file nguồn (mỗi file 2 hash trùng nhau khi so cặp nguồn/đích).
- Ngày kiểm: 2026-11-04.

## 0. Trạng thái copy

| File | Dòng | SHA-256 (rút gọn) | Trạng thái |
|---|---|---|---|
| automator.js | 446 | 233348b0…129513 | ✅ copy nguyên khối |
| comment-replier.js | 409 | dafe4a20…563300 | ✅ copy nguyên khối |
| studio-comment-replier.js | 146 | 60e4c64c…c90f18 | ✅ copy nguyên khối |
| reply-bridge.js | 62 | a07f779f…08d4de | ✅ copy nguyên khối |
| studio-reply-bridge.js | 58 | f99860d5…98ceb | ✅ copy nguyên khối |
| accounts-scanner.js | 104 | 36b3f7f4…88920 | ✅ copy nguyên khối |
| discovery.js | 59 | 7d5d2bea…28bd9e | ✅ copy nguyên khối |
| enricher.js | 69 | 6553851a…8d87adf157* | ✅ copy nguyên khối |

*enricher.js full: `6553851a890bc6d030aa5acccaf02618b25e09636222e3e92c331d5d87adf157`.

## 1. `node --check`

| File | Kết quả |
|---|---|
| accounts-scanner.js | ✅ OK |
| automator.js | ✅ OK |
| comment-replier.js | ✅ OK |
| discovery.js | ✅ OK |
| enricher.js | ✅ OK |
| reply-bridge.js | ✅ OK |
| studio-comment-replier.js | ✅ OK |
| studio-reply-bridge.js | ✅ OK |

8/8 pass, không lỗi cú pháp.

## 2. Chuỗi cấm — kết quả + phân loại

Grep trên cả 8 file cho: `mut.vn`, `claim-next`, `api_token`, `api_base`, `MUT_SEND_TOKEN`, `mut-bridge`, `clients2.google`, `14.225`

**Kết quả: 0 hit cho cả 8 mẫu.** Không có URL/endpoint/token của server MUT trong module TikTok này.

- (a) URL/endpoint/token server thật = vấn đề: **KHÔNG CÓ.**
- URL ngoài duy nhất trong cả module là chính TikTok: `accounts-scanner.js:46` — `fetch('https://www.tiktok.com/@${username}', { credentials: 'include' })` để lấy follower count. Đây là request tới nền tảng đích, không phải server tác giả.
- (b) Tiền tố `mut` vô hại (không thuộc danh sách cấm ở trên nhưng có xuất hiện khi grep `-i mut`, ghi rõ để tránh hiểu nhầm ở các lát sau):
  - Tên event DOM: `mut-tiktok-reply-inspect` — `reply-bridge.js:55`, `comment-replier.js:23`, `accounts-scanner.js:19`, `discovery.js:19`.
  - Tên attribute DOM làm kênh dữ liệu: `data-mut-tiktok-reply-context` (`reply-bridge.js:60`, `comment-replier.js:24`, `accounts-scanner.js:21`, `discovery.js:21`), `data-mut-tiktok-comment` (`reply-bridge.js:58`, `comment-replier.js:55,57,228,243`), `data-mut-studio-reply-request` / `data-mut-studio-reply-result` (`studio-reply-bridge.js:6,7`, `studio-comment-replier.js:100,101,106,127,144`).
  - Cờ window chống chạy trùng: `window.__mutTikTokReplyBridge` (`reply-bridge.js:4,5`), `window.__mutTikTokStudioReplyBridge` (`studio-reply-bridge.js:3,4`), `window.mutTikTokReplyRunning/TaskId/StartedAt` (`comment-replier.js:9–12,407`), `window.mutTikTokStudioRunning` (`studio-comment-replier.js:21,22`).
  - Tiền tố log: `[MUT TikTok reply]` — `comment-replier.js:404,405`.
  - Phụ thuộc optional: `window.mutWatermarkService` — `automator.js:284,287`. Chỉ gọi khi `post.watermark_config` tồn tại và service đã có sẵn trên window; service này KHÔNG nằm trong 8 file của module — kernel/fork nếu không cung cấp thì tính năng watermark tự bỏ qua, không lỗi.
  - Key storage tiền tố `mutvn`: **không có** trong module này (grep `mutvn` = 0 hit). Các key storage thật xem §5.

## 3. `getURL` / `chrome.runtime.getURL`

**0 hit trong cả 8 file.** Không file nào tự nạp tài nguyên/bridge bằng `chrome.runtime.getURL`. Hệ quả trực tiếp cho §4: bridge không được tự inject từ bất kỳ file nào trong module.

## 4. reply-bridge.js + studio-reply-bridge.js — vai trò + cách inject + world

### Kết luận (chắc, có bằng chứng)

1. **Cả 2 bridge PHẢI chạy ở MAIN world.** Kernel/background phải inject chúng riêng, với `world: "MAIN"` (qua `chrome.scripting.executeScript({ world: 'MAIN', files: [...] })` hoặc khai báo `content_scripts` với `"world": "MAIN"` trong manifest — việc sửa manifest thuộc lát kernel, không thuộc lát này).
2. **Không file nào trong 8 file tự inject bridge**: grep `getURL` = 0 hit (§3); grep `createElement` chỉ có `automator.js:19` (tạo `div` overlay trạng thái) và `automator.js:247` (tạo `canvas` convert ảnh) — không có tạo `<script>`, không có gán `script.src`, không có `executeScript` trong bất kỳ file nào. Nếu kernel không inject bridge ở MAIN world, các runner vẫn chạy nhưng mất dữ liệu bridge (actor/confirmations/comment metadata) và sẽ dừng theo đường lỗi ở §6 — không tự fallback sang inject.
3. Kênh giao tiếp bridge ↔ runner KHÔNG dùng `window.postMessage` (grep `postMessage` = 0 hit), KHÔNG dùng `exportFunction`. Kênh dùng chung là **DOM dùng chung giữa 2 world**: Custom Event trên `document` + attribute trên `document.documentElement` / trên row comment. Đây là lý do cặp này tách world được: ISOLATED runner dispatch event/đặt attribute, MAIN bridge nghe event/đọc attribute và ghi kết quả trở lại attribute.

### reply-bridge.js (cho feed reply)

- Tự khai MAIN world ngay dòng đầu: `reply-bridge.js:1` — `// MAIN-world adapter: read only TikTok's logged-in context and comment metadata.`
- Vá mạng của trang (chỉ có tác dụng nếu ở MAIN world): `reply-bridge.js:14,15` ghi đè `window.fetch`; `reply-bridge.js:20–24` ghi đè `XMLHttpRequest.prototype.open/send`. Mục đích: bắt response của đúng endpoint `/api/comment/publish/` để ghi nhận confirmation thật (cid/reply_id/aweme_id/text/author).
- Đọc state nội bộ của trang (cũng chỉ có ở MAIN world): `reply-bridge.js:31` đọc `#__UNIVERSAL_DATA_FOR_REHYDRATION__` lấy actor đang đăng nhập; `reply-bridge.js:42` duyệt React fiber qua key `__reactFiber$…` để lấy metadata comment (cid/text/user).
- Nhận lệnh qua: `reply-bridge.js:55` — `document.addEventListener('mut-tiktok-reply-inspect', …)`; ghi kết quả ra `data-mut-tiktok-comment` trên từng row (`reply-bridge.js:58`) và `data-mut-tiktok-reply-context` = `{ actor, confirmations }` trên `documentElement` (`reply-bridge.js:60`).
- Phía tiêu thụ (ISOLATED): `comment-replier.js:23,24` dispatch event + đọc attribute context; `comment-replier.js:55,57` đọc `[data-mut-tiktok-comment]`. `accounts-scanner.js:19,21` và `discovery.js:19,21` dùng cùng cơ chế để lấy `actor`.
- Guard chống nạp đôi: `reply-bridge.js:4,5` (`window.__mutTikTokReplyBridge`).
- Bridge này chỉ đọc/ghi nhận, không tự gọi API đăng bài (theo comment `reply-bridge.js:1,2` và code thực tế: ngoài việc wrap fetch/XHR để quan sát, nó không phát request riêng).

### studio-reply-bridge.js (cho Studio comments_manager reply)

- Không có comment khai world ở đầu file, nhưng cơ chế bắt buộc MAIN world giống hệt: `studio-reply-bridge.js:35,36` ghi đè `window.fetch`; `studio-reply-bridge.js:43–50` ghi đè `XMLHttpRequest.prototype.open/send`. Nếu chạy ISOLATED, việc vá này chỉ tác dụng lên bản sao cô lập, không bao giờ thấy request thật của trang Studio → không bao giờ có kết quả xác nhận.
- Luồng: runner (ISOLATED) đặt request tại `studio-comment-replier.js:101` — `data-mut-studio-reply-request` = `{ nonce, text }` trên `documentElement` (xoá result cũ ở dòng 100). Bridge đọc request đó (`studio-reply-bridge.js:15`), chỉ khớp khi: method POST + path khớp `/comment|reply/i` + body chứa đúng `expected.text`; khi response về, bridge ghi `data-mut-studio-reply-result` = `{ nonce, success, status }` (`studio-reply-bridge.js:33`), trong đó `success` chỉ đúng khi HTTP 2xx và `status_code === 0 || code === 0 || success === true`.
- Phía tiêu thụ: `studio-comment-replier.js:106` poll attribute result theo `nonce`; `studio-comment-replier.js:127,144` dọn attribute request khi xong/finally.
- Guard chống nạp đôi: `studio-reply-bridge.js:3,4` (`window.__mutTikTokStudioReplyBridge`).

## 5. Storage keys + message actions

### Storage (`chrome.storage.local`)

| File:dòng | Thao tác | Key |
|---|---|---|
| automator.js:15 | set (ghi đè mỗi log) | `lastStatus` |
| automator.js:193 | get | `currentProcessingPost`, `currentAffiliateCommentTask_tiktok`, `currentCommentReplyTask_tiktok` |
| automator.js:439 | get | `currentProcessingPost` |
| comment-replier.js:5 | get | `currentCommentReplyTask_tiktok` (hằng `key`, dòng 4) |
| comment-replier.js:27 | get | `currentCommentReplyTask_tiktok`, `isPaused` |
| comment-replier.js:98 | set | ghi lại `currentCommentReplyTask_tiktok` với `source_url/source_type/source_key` đã chuẩn hoá khi task là nguồn feed |
| studio-comment-replier.js:18 | get | `currentCommentReplyTask_tiktok` (cùng key với feed replier; phân biệt bằng `task.source_type === 'comments_manager'`, dòng 19) |
| studio-comment-replier.js:30 | get | `currentCommentReplyTask_tiktok`, `isPaused` |
| accounts-scanner.js / discovery.js / enricher.js / 2 bridge | — | không đụng `chrome.storage` |

Lưu ý cho kernel: checkpoint bền của reply KHÔNG nằm ở storage local trong các file này — runner gửi checkpoint về background qua message `tiktokReplyCheckpoint` (xem dưới) và nhận lại qua `task.tiktok_checkpoint` ở lần nạp sau (`comment-replier.js:16`, `studio-comment-replier.js:26`).

### Message gửi đi (`chrome.runtime.sendMessage`)

| Action | File:dòng | Ý nghĩa |
|---|---|---|
| `fetchImage` | automator.js:54 | Nhờ background tải media, nhận `{ success, dataUrl }` |
| `affiliateCommentDone` | automator.js:170 | Báo xong task comment affiliate |
| `commentReplyDone` | automator.js:180; comment-replier.js:50,103; studio-comment-replier.js:44 | Báo kết thúc reply (kèm `items`, `error`) |
| `postCompleted` | automator.js:435 | Báo đăng bài xong (`postId`) |
| `postFailed` | automator.js:441 | Báo đăng bài lỗi (`postId`, `error`) |
| `tiktokReplyCheckpoint` | comment-replier.js:35; studio-comment-replier.js:41 | Lưu checkpoint reply; runner yêu cầu `response.success`, không có là dừng |
| `commentReplyProgress` | comment-replier.js:384 | Báo tiến độ reply đã xác nhận |
| `getSmartCommentReply` | comment-replier.js:200; studio-comment-replier.js:75 | Xin AI soạn reply (`suggestion.data.reply_text`) khi `task.smart_reply_enabled` |
| `socialAccountsScannerResult` | accounts-scanner.js:86,98; discovery.js:41,53 (qua `scanUtils.sendDiscovery`); enricher.js:63 (qua `utils.send`, type `enrichment`) | Báo kết quả quét tài khoản / làm giàu profile |

Phụ thuộc injection ngoài module (kernel phải cấp trước khi chạy): `discovery.js:3,4` đọc `globalThis.__accountScanContext` + `globalThis.accountScanUtils`; `enricher.js:3,4` đọc `globalThis.__accountScanContext` + `globalThis.accountScanUtils`. Hai file này không tự chạy độc lập được nếu thiếu 2 global đó.

## 6. Captcha / checkpoint bảo mật — ghi nhận

**Kết quả grep `captcha` (case-insensitive): 0 hit trong cả 8 file.** Mở rộng grep `challenge|verify|robot|blocked|suspicious|puzzle|slider|secsdk`: cũng không có detector captcha/challenge nào (các hit của `verifying` chỉ là phase của checkpoint reply, xem dưới).

- **Không file nào có logic phát hiện captcha/checkpoint bảo mật của TikTok, và không file nào tìm cách giải/vượt captcha.** Về mặt này module tuân thủ luật fork (không giải captcha) — nhưng cũng có nghĩa: nếu TikTok hiện captcha giữa chừng, code sẽ KHÔNG nhận diện được đó là captcha. Hành vi thực tế khi bị chặn kiểu đó: các bước chờ phần tử/nút bấm timeout → `throw Error` generic → đi vào đường báo lỗi/dừng ở dưới, với message lỗi không nhắc tới captcha. Kernel/background cần tự phát hiện captcha ở tầng ngoài nếu muốn báo đúng nhãn "captcha" cho người dùng.
- Chữ "checkpoint" trong code là **checkpoint tác vụ** (chống gửi trùng), không phải checkpoint bảo mật: action `tiktokReplyCheckpoint` (`comment-replier.js:35`, `studio-comment-replier.js:41`), field `task.tiktok_checkpoint`, các phase `actor_check → acting/composing → submitting → verifying → finished`.
- Cách dừng + báo khi gặp sự cố (áp dụng cho mọi lỗi, gồm cả trường hợp bị TikTok chặn ngầm):
  - `automator.js`: toàn bộ luồng nằm trong try/catch; catch ở cuối ghi log lỗi và gửi `postFailed` với `error.message` (automator.js:441, chỉ khi còn `currentProcessingPost`); thành công gửi `postCompleted` (automator.js:435). Không retry đăng lại.
  - `comment-replier.js`: `guard()` (dòng 27–31) ném lỗi và dừng ngay khi task bị huỷ/thay đổi, `isPaused` bật, hoặc tab rời khỏi bài cần reply; kiểm tra actor ở dòng 109,110 — không khớp/không xác định được tài khoản yêu cầu thì dừng; giữa chừng đổi tài khoản thì dừng (dòng 197); nếu lần chạy trước kẹt ở phase `submitting/verifying` thì ném lỗi "không tự gửi lại" (dòng 106,107); không nhận được confirmation thật từ bridge trong 20s thì ném lỗi, không gửi lại (dòng 379,380). Mọi lỗi cuối cùng đều qua `done(error)` (dòng 48–50): lưu checkpoint `finished` + gửi `commentReplyDone` kèm `error`; catch ngoài cùng ở dòng 402–405 gọi `done('TikTok: ' + error.message)`.
  - `studio-comment-replier.js`: cơ chế tương tự — `guard()` dòng 30–33 (huỷ/tạm dừng/rời `/tiktokstudio/comment` là dừng), sai tài khoản Studio thì dừng (dòng 53,54), phase trước là `submitting/verifying` thì từ chối chạy lại (dòng 47), TikTok trả lỗi HTTP thì ném lỗi "không tự gửi lại" (dòng 112), không xác nhận được thì dừng (dòng 128). Kết thúc/lỗi đều qua `done(error)` dòng 44 → `commentReplyDone`.
  - `accounts-scanner.js`: không nhận diện được username sau 30 lần thử (dòng 19–25) → throw "Không nhận diện được username TikTok. Hãy kiểm tra tài khoản đã đăng nhập." → catch gửi `socialAccountsScannerResult` với `accounts: []` + `error` (dòng 98). `discovery.js:41,53` cùng mẫu qua `sendDiscovery`.

## 7. Entry point theo loại task

| Loại task | Entry point | Điều kiện kích hoạt / ghi chú |
|---|---|---|
| `post` (đăng bài) | **automator.js** | Đọc `currentProcessingPost` từ storage (automator.js:193); chỉ chạy khi `post.platform === 'tiktok'` (automator.js:207). Nếu thấy `currentCommentReplyTask_tiktok` thì nhường cho comment-replier và return (automator.js:198); nếu thấy `currentAffiliateCommentTask_tiktok` thì automator tự xử lý nhánh comment affiliate qua `handleTikTokCommentTask` (automator.js:72,202,203). |
| `reply` (feed / trên bài) | **comment-replier.js** | Đọc `currentCommentReplyTask_tiktok` (comment-replier.js:4,5); yêu cầu `task.platform === 'tiktok'` (dòng 7). Cần reply-bridge.js đã inject MAIN world trước đó (§4). |
| `reply` (comments_manager / TikTok Studio) | **studio-comment-replier.js** | Cùng key `currentCommentReplyTask_tiktok` (studio-comment-replier.js:18) nhưng chỉ chạy khi `task.source_type === 'comments_manager'` (dòng 19) và tab ở `/tiktokstudio/comment`. Cần studio-reply-bridge.js đã inject MAIN world trước đó (§4). |
| `scan_account` | **accounts-scanner.js** | Bản quét độc lập: tự dispatch `mut-tiktok-reply-inspect` nên vẫn cần reply-bridge.js ở MAIN world để lấy `actor`; gửi kết quả bằng `socialAccountsScannerResult` (accounts-scanner.js:86). Cặp `discovery.js` (phase 1) + `enricher.js` (phase 2) là biến thể quét 2 pha, phụ thuộc global do kernel inject (§5), cùng gửi `socialAccountsScannerResult`. |
