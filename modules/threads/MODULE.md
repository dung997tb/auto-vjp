# Module: threads — Auto vjp (Slice 4)

Port nguyên khối từ MUT client:
`~/workspace/app-remake-team/jobs/auto-post-mut/work/content-scripts/threads/`
→ `~/workspace/auto-vjp/modules/threads/`

**Trạng thái copy: XONG, nguyên khối, không sửa nội dung 4 file.** SHA-256 đích khớp SHA-256 nguồn cho cả 4 file (kiểm chứng 2026-11-04):

| File | Dòng | SHA-256 (nguồn = đích) |
|---|---|---|
| automator.js | 494 | `7c6ef90826197e0774869715fed305f0276df4a44ff9df9a3431d832c661366b` |
| interaction.js | 351 | `82cfbd4ae6957a4e6445e00e02bc92a7c2553c7e9786d0cb0686bd7b3243cce5` |
| affiliate-commenter.js | 336 | `b017cc538083ebf6eb63b3c40db13a7101f7b8e6cd2ccc28aa13080ed621c889` |
| accounts-scanner.js | 37 | `ebbab279c6d0d3cebfd8fb791a55c361ec78cb02fbc3683f47adf0fcd6002fff` |

## 1. node --check

| File | Kết quả |
|---|---|
| automator.js | ✅ OK |
| interaction.js | ✅ OK |
| affiliate-commenter.js | ✅ OK |
| accounts-scanner.js | ✅ OK |

Cả 4 file parse sạch, không lỗi cú pháp.

## 2. Chuỗi cấm — grep `mut.vn`, `claim-next`, `api_token`, `api_base`, `MUT_SEND_TOKEN`, `mut-bridge`, `clients2.google`, `14.225`

**0 hit trên cả 4 file.**

- Phân loại (a) URL/endpoint/token server thật: **KHÔNG CÓ** — không file nào chứa endpoint server MUT, token API, bridge hay IP tác giả trong danh sách cấm.
- Phân loại (b) key storage local có tiền tố `mutvn`: **KHÔNG CÓ** — không key storage nào trong module này mang tiền tố `mutvn` (các key thực tế xem mục 4).

Ghi chú ngoài danh sách cấm (grep mở rộng `-i mut`, không phải chuỗi cấm, không sửa code): còn sót các **định danh global trên `window`** mang tiền tố `mut` — chỉ là cờ chống inject trùng + biến trạng thái task + 1 service tuỳ chọn, không phải URL/token/server:

- `affiliate-commenter.js:2,3,226` — `window.mutThreadsAffiliateCommenterInjected` (cờ đã-inject)
- `affiliate-commenter.js:229,230` — `window.mutThreadsAffiliateCommenterTaskId`, `window.mutThreadsAffiliateCommenterStartedAt`
- `interaction.js:2,3,167` — `window.mutThreadsInteractionInjected` (dòng 1 là comment `// Auto Post MUT - Threads interaction automator v1.0`)
- `interaction.js:170,171` — `window.mutThreadsInteractionTaskId`, `window.mutThreadsInteractionStartedAt`
- `automator.js:260,263` — `window.mutWatermarkService` (tuỳ chọn: chỉ dùng khi `post.watermark_config` có mặt và file không phải video; vắng service này thì bỏ qua watermark, không lỗi)

## 3. getURL / chrome.runtime.getURL

**0 hit** trên cả 4 file. Module không tự resolve URL tài nguyên extension — không có phụ thuộc đường dẫn nội bộ cần remap khi ghép vào fork.

## 4. Giao diện của module (storage keys + message actions)

### 4.1. Storage — `chrome.storage.local`

| File:dòng | Thao tác | Key | Ghi chú |
|---|---|---|---|
| automator.js:227 | `get` | `currentProcessingPost` | Đầu vào task đăng bài (đọc object `post`). Key **không** có hậu tố `_threads` — key dùng chung, bên ghép lõi cần lưu ý va chạm với module Facebook dùng cùng tên key. |
| automator.js:488 | `get` | `currentProcessingPost` | Đọc lại trong nhánh lỗi để lấy `postId` |
| automator.js:482, 490 | `remove` | `currentProcessingPost` | Xoá sau khi hoàn tất / khi lỗi |
| automator.js:15 | `set` | `lastStatus` | Ghi trạng thái/log mới nhất (`{ lastStatus: msg }`) trong `addLog()` |
| interaction.js:164 | `get` | `currentCommentReplyTask_threads` | Đầu vào task reply; script tự thoát nếu `!task \|\| task.platform !== 'threads'` |
| affiliate-commenter.js:223 | `get` | `currentAffiliateCommentTask_threads` | Đầu vào task affiliate; script tự thoát nếu `!task \|\| task.platform !== 'threads'` |
| accounts-scanner.js | — | — | **Không dùng `chrome.storage` chút nào** (xem mục 5) |

### 4.2. Messages — `chrome.runtime.sendMessage`

**automator.js**

| Dòng | action | Payload |
|---|---|---|
| 52 | `fetchImage` | `{ action, url }` — gửi kèm callback, mong response `{ success, ... }` để lấy ảnh qua background |
| 483 | `postCompleted` | `{ action, postId: post.id, resultUrl, actorUrl, actorName }` |
| 491 | `postFailed` | `{ action, postId, error: error.message }` |

**interaction.js**

| Dòng | action | Payload |
|---|---|---|
| 161 | `commentReplyProgress` | `{ action, campaignId: task.id, current: task.progress_offset + current, total: task.campaign_total, message }` |
| 162 | `commentReplyDone` | `{ action, campaignId: task.id, items, error, sourceUrl: task.source_url \|\| location.href }` |

**affiliate-commenter.js**

| Dòng | action | Payload |
|---|---|---|
| 232–234 | `affiliateCommentProgress` | `{ action, campaignId: task.id, current, total: limit, message }` (`limit` = `task.post_limit` kẹp 1–5) |
| 235–237 | `automationLog` | `{ action, event: { level, platform: 'threads', job: 'Gắn link', campaign: task.name \|\| '', taskId: task.id, step, message, details } }` |
| 238–242 | `affiliateCommentDone` | `{ action, campaignId: task.id, items, error, sourceGroupUrl: task.source_key \|\| task.source_url \|\| location.href, sourceKey: task.source_key \|\| '' }` |

**accounts-scanner.js**: không có `sendMessage` nào — xem mục 5.

### 4.3. Listener chiều vào

Cả 4 file **không** đăng ký `chrome.runtime.onMessage` listener. Chiều vào duy nhất là storage (3 file đầu) và global (scanner, mục 5). Hai file interaction/affiliate tự chạy ngay khi inject (IIFE + cờ `window.mut*Injected`), automator cũng tự chạy ngay khi inject (cờ `window.moigioi_injected_personal`).

## 5. accounts-scanner.js (37 dòng) — cơ chế báo kết quả quét

Đọc kỹ toàn bộ file. Cơ chế **khác hẳn** 3 file còn lại: không storage, không `chrome.runtime.sendMessage`. Nó phụ thuộc hoàn toàn vào **2 global do bên inject (host/runner) phải đặt sẵn trước khi inject**:

- `accounts-scanner.js:3` — `const context = globalThis.__accountScanContext;` (context phiên quét, truyền opaque vào lúc báo kết quả)
- `accounts-scanner.js:4` — `const utils = globalThis.accountScanUtils;` (bộ tiện ích của host; dùng 2 hàm: `utils.profileKey(url)` và `utils.sendDiscovery(context, payload)`)

Luồng:

1. Tự chạy dạng IIFE async ngay khi inject.
2. Tìm username đang đăng nhập: poll tối đa 20 lần × 500 ms các link `nav a[href*="/@"], [role="navigation"] a[href*="/@"]`, chỉ nhận link có hint `trang cá nhân|profile|hồ sơ` (aria-label/text/SVG label) và href khớp `^/@([A-Za-z0-9._]+)/?$`. Không tìm được sau ~10 s → throw `Không nhận diện được hồ sơ Threads đang đăng nhập.`
3. Lấy tên hiển thị: `fetch('https://www.threads.com/@<username>', { credentials: 'include', signal: AbortSignal.timeout(8000) })`, parse HTML bằng `DOMParser`, chỉ tin `og:title` khi `utils.profileKey(canonical/og:url) === utils.profileKey(target)`; tên lấy từ `og:title` sau khi cắt `(@...)` và hậu tố Threads. Lỗi bước này bị nuốt (`catch (_)`) — giữ username làm tên, **không** đọc follower count (comment trong code: số liệu ở home có thể thuộc feed).
4. **Báo kết quả — kênh duy nhất:** `await utils.sendDiscovery(context, payload)`:
   - Thành công (`accounts-scanner.js:33`): `{ accounts: [{ platform: 'threads', social_uid: username, social_username: username, social_name: name }] }`
   - Thất bại (`accounts-scanner.js:35`, trong `catch` ngoài cùng): `{ accounts: [], error: error.message }`

Hệ quả cho bên ghép lõi (S2/local task source): muốn dùng `scan_account` cho Threads thì runner phải (a) gán `globalThis.__accountScanContext` + `globalThis.accountScanUtils` (đủ `profileKey` + `sendDiscovery`) vào page context **trước** khi inject file này, và (b) nhận kết quả qua chính `sendDiscovery` đó — không có message/storage nào khác để đón. Nếu `accountScanUtils` vắng mặt, cả nhánh lỗi cũng không báo được (chính lời gọi `sendDiscovery` trong `catch` sẽ throw tiếp).

## 6. Entry point theo loại task

| Loại task | Entry point |
|---|---|
| `post` | `automator.js` (đọc storage `currentProcessingPost`) |
| `reply` | `interaction.js` (đọc storage `currentCommentReplyTask_threads`) |
| `affiliate` | `affiliate-commenter.js` (đọc storage `currentAffiliateCommentTask_threads`) |
| `scan_account` | `accounts-scanner.js` (global `__accountScanContext` + `accountScanUtils.sendDiscovery`) |

## Phạm vi đã giữ

- Không sửa `manifest.json`, `background.js`, `popup.*` của fork.
- Không sửa nội dung 4 file đã copy (SHA khớp nguồn — mục đầu).
- Không đụng thư mục nào khác; file duy nhất ghi thêm là `MODULE.md` này.
