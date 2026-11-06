# Module: X (Twitter) — Auto vjp

- Nguồn (chỉ đọc): `~/workspace/app-remake-team/jobs/auto-post-mut/work/content-scripts/x-twitter/`
- Đích: `~/workspace/auto-vjp/modules/x/`
- Cách port: `cp` nguyên khối, không sửa nội dung 4 file.
- Kiểm chứng copy: MD5 nguồn = đích cho cả 4 file:
  - `accounts-scanner.js` — `d9044e0d5176ca249280b6ac0f5c806f`
  - `affiliate-commenter.js` — `7c9b19ddf19927a84e5c7cafa899a057`
  - `automator.js` — `8c93b7c80fe1ccee6343d1957d8d2618`
  - `interaction.js` — `7da97a9c98a27e644666f695c3eb5484`

## 1. node --check

| File | Dòng | Kết quả |
|---|---|---|
| automator.js | 376 | OK |
| interaction.js | 117 | OK |
| affiliate-commenter.js | 280 | OK |
| accounts-scanner.js | 93 | OK |

## 2. Chuỗi cấm — grep

Lệnh: `grep -n -E 'mut\.vn|claim-next|api_token|api_base|MUT_SEND_TOKEN|mut-bridge|clients2\.google|14\.225' *.js`

Kết quả: **0 hit** cho cả 8 mẫu.

Phân loại:

- (a) URL/endpoint/token server thật = vấn đề: **không có hit nào.**
- (b) Tên key storage local tiền tố `mutvn` = vô hại: **không có hit nào** (không có key nào mang tiền tố `mutvn` trong 4 file này).

Ghi chú bổ sung (ngoài danh sách cấm, từ grep mở rộng `-i 'mut'` — không tự sửa):

- `interaction.js:1-3,11-13` — comment `Auto Post MUT` + biến guard trên window `window.mutXInteractionInjected` / `mutXInteractionTaskId` / `mutXInteractionStartedAt`: định danh local trong trang, không phải URL/token server.
- `affiliate-commenter.js:1-3,70,74-75,275` — comment `Auto Post MUT` + `window.mutXAffiliateCommenterInjected` / `mutXAffiliateCommenterTaskId` / `mutXAffiliateCommenterStartedAt` + nhãn log `[MUT-X-Affiliate]`: định danh local trong trang, không phải URL/token server.
- `automator.js:193,196` — `window.mutWatermarkService` (`applyWatermark(file, post.watermark_config, context)`): tham chiếu service toàn cục trong trang (tuỳ chọn, chỉ chạy khi có `post.watermark_config`), không phải endpoint/token trong danh sách cấm.

## 3. getURL / chrome.runtime.getURL

Lệnh: `grep -n -E 'getURL|chrome\.runtime\.getURL' *.js`

Kết quả: **không có hit nào** trong cả 4 file.

## 4. Giao diện của module

### 4.1. Storage keys (chrome.storage.local)

Đọc:

- `automator.js:160` — `chrome.storage.local.get('currentProcessingPost')` → `stored.currentProcessingPost`
- `interaction.js:9` — `chrome.storage.local.get('currentCommentReplyTask_x')` → `stored.currentCommentReplyTask_x` (chỉ chạy tiếp nếu `task.platform` thuộc `['x','twitter']`)
- `affiliate-commenter.js:64` — `chrome.storage.local.get(['currentAffiliateCommentTask_x', 'currentAutomationRun'])` → ưu tiên `currentAutomationRun` khi `type === 'affiliate'` và platform thuộc `['x','twitter']`, ngược lại dùng `currentAffiliateCommentTask_x`

Ghi / xoá:

- `automator.js:16` — `chrome.storage.local.set({ lastStatus: msg })`
- `automator.js:360` — `chrome.storage.local.remove('currentProcessingPost')` (khi hoàn tất)

`accounts-scanner.js`: không dùng `chrome.storage` — nhận context qua biến toàn cục (xem 4.3).

Không có dùng `localStorage` / `sessionStorage` trong 4 file.

### 4.2. Message gửi đi (chrome.runtime.sendMessage, trường `action:`)

`automator.js`:

- `automator.js:45` — `{ action: 'fetchImage', url }` (kèm callback nhận `res.success`)
- `automator.js:361-362` — `{ action: 'postCompleted', postId, resultUrl, actorUrl, actorName }`
- `automator.js:373` — `{ action: 'postFailed', postId, error }`

`interaction.js`:

- `interaction.js:17` — `{ action: 'commentReplyDone', campaignId: task.id, items, error, sourceUrl }`
- `interaction.js:18` — `{ action: 'commentReplyProgress', campaignId: task.id, current, total, message }`

`affiliate-commenter.js`:

- `affiliate-commenter.js:78-79` — `{ action: 'affiliateCommentProgress', campaignId: task.id, current, total: limit, message }`
- `affiliate-commenter.js:82-83` — `{ action: 'automationLog', event: { level, platform: 'x', job: 'Bình luận X', campaign: task.name, taskId: task.id, step, message, details } }`
- `affiliate-commenter.js:86-87` — `{ action: 'affiliateCommentDone', campaignId: task.id, items, error, sourceGroupUrl, sourceKey }`

Không có `chrome.runtime.onMessage.addListener` trong 4 file — các file tự chạy (IIFE / inject-once guard) sau khi được inject, đọc task từ storage rồi báo kết quả ngược qua `sendMessage`.

### 4.3. accounts-scanner.js — kênh riêng (không qua sendMessage trực tiếp)

- Đầu vào: `globalThis.__accountScanContext` và `globalThis.accountScanUtils` (`accounts-scanner.js:3-4`)
- Đầu ra: `accounts-scanner.js:92` — `scanUtils.sendDiscovery(scanContext, { action: 'socialAccountsScannerResult', type: 'discovery', accounts })`, mỗi account gồm `{ platform: 'x', social_uid, social_username, social_name, followers_count }`

## 5. Entry point theo loại task

| Loại task | File |
|---|---|
| post | `automator.js` |
| reply | `interaction.js` |
| affiliate | `affiliate-commenter.js` |
| scan_account | `accounts-scanner.js` |
