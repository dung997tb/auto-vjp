# MODULE CONTRACT — Auto vjp module layer (S2)

_Tài liệu hợp đồng giữa **lõi FB** (FB Auto Tool fork) và **tầng module đa nền tảng** (`modules/`).
Chốt 2026-11-04 theo plan v2.1 §4.4 + §6-S2. Luật bao trùm: **everything is module** (plan §3-8) —
mỗi nền tảng = 1 module độc lập trong `modules/<platform>/`, chỉ giao tiếp qua hợp đồng này;
thêm module mới không sửa module cũ; contract chỉ thêm, không phá._

## 1. Ai sở hữu cái gì

| Vùng | Chủ sở hữu | Ghi chú |
|---|---|---|
| `background.js`, `popup.*`, content script FB, storage key của FB | Lõi FB | Tầng module KHÔNG đọc/ghi key của lõi (ngoại trừ `lastStatus` hiển thị chung, theo tiền lệ MUT) |
| `modules/kernel/*` | Kernel dùng chung | contract-data, contract (registry), store, outbox, source, runner, results, media, aitab |
| `modules/<platform>/*` | Module nền tảng đó | Content script thi hành port từ client MUT, giữ nguyên khối |
| `modules/shared/*` | Dùng chung cho module | canonical-task-storage, dom-utils, account-scan-utils (port từ MUT) |
| `modules/aitab/ai-bridge.js` | Kernel aitab | Cầu nối ChatGPT/Gemini trong trang web AI |
| Key canonical `currentAutomationRun` | Kernel (qua AVJP.store) | Hợp đồng với content script MUT — giữ nguyên tên + hình dạng |
| Key `autovjp.*` | Kernel | queue/schedules/receipts/outbox/accounts/managedTabs/paused |

**Điểm chạm vào lõi FB: đúng 2 chỗ** — (1) cuối `background.js`: `importScripts('modules/bridge.js')`
bọc try/catch (bridge lỗi thì lõi vẫn chạy); (2) `popup.html`/`popup.js`: 1 nút mở `manage.html`.
Mọi điểm chạm ghi trong `FORK-CHANGES.md`.

## 2. Vòng đời task (nguồn việc local — thay claim-next của server MUT)

```
manage.html ──autovjp.createTask──▶ source.enqueue ─▶ autovjp.taskQueue
schedules ──đến hạn──▶ enqueue                      (chrome.alarms 'autovjp.tick' 1 phút + kick tức thời)
claim: singleton — chỉ 1 canonical run tại 1 thời điểm (như MUT), các task còn lại xếp hàng
run ──▶ runner mở tab managed ──▶ tabs.onUpdated(complete) ──▶ inject script theo registry
content script thi hành (đọc task qua canonical-task-storage) ──▶ message kết quả
results listener ──▶ outbox.deliver: OUTBOX (bền) ─▶ RECEIPT local (= ACK) ─▶ xoá canonical + đóng tab ─▶ claim tiếp
quá deadline / 5 phút không hoạt động ─▶ receipt `uncertain` — KHÔNG BAO GIỜ tự chạy lại
tab đóng sớm ─▶ receipt `failed`; trang login/checkpoint/captcha ─▶ receipt `failed` (session_expired), dừng, không lách
```

## 3. Hình dạng task / canonical run

- Task do quản lý tạo: payload **phẳng ở top-level** (khớp cách automator MUT đọc):
  `{platform, type, content?, images?|media_urls?, source_url?, target_url?, social_username?,
    reply_templates?, reply_icons?, smart_reply_enabled?, prevent_duplicates?, timeout_ms?, ...}`
- Kernel chuẩn hoá khi enqueue: thêm `id` (`task_...`), `status:'queued'`, `created_at`.
- Khi claim, kernel dựng canonical run (port hình dạng MUT worker-lease `setCurrentAutomationTask`):
  `{...task, task_id: String(id), run_id, delivery_id, type, platform, tabId, phase,
    startedAt, lastActiveAt, updatedAt, timeout_ms}` và ghi vào `currentAutomationRun`.
- `type` thuộc CONTRACT_VERSION 2 (MUT): tầng module nhận `post`, `reply`, `affiliate`,
  `scan_account` + `probe` (nội bộ, kiểm tra vòng đời). Facebook KHÔNG qua tầng module (lõi lo).
- Bổ sung 2.1.0 (chỉ cộng thêm, không phá): type `nurture` — hiện chỉ TikTok hỗ trợ
  (module `modules/tiktok-nurture/`, engine TikTok Farmer port nguyên khối). Payload phẳng:
  `{platform:'tiktok', type:'nurture', watch_count?, like_enabled?, save_enabled?,
  follow_enabled?, max_minutes?, timeout_ms?}`. Content script báo tiến độ/kết quả qua 2 action
  riêng `nurtureProgress` / `nurtureDone` (xem §5a). Worker chỉ thi hành — giới hạn lịch
  (giờ hoạt động...) thuộc tầng điều phối giao việc, KHÔNG kiểm tra trong worker.
- YouTube scope hẹp: task `post` YouTube có media video bị **từ chối ngay khi enqueue**
  (upload video ngoài v1); chỉ Community post/comment.
- Bổ sung 2.9.0 (chỉ cộng thêm): type `healthscan` — instagram/youtube/threads/tiktok
  (x: chưa hỗ trợ). Script dùng chung `modules/shared/healthscan.js` (sau CANONICAL +
  `modules/shared/healer.js`): mở bề mặt mẫu theo `startUrl`, chỉ **định vị** các neo
  mẫu qua `AVJP.heal.locate`, KHÔNG tương tác thật; báo `healthscanCompleted/Failed`,
  receipt `items` = `{key, found_via, spec}` từng neo. Healthscan không markProven —
  xem `modules/shared/HEALER.md`.

## 4. Registry nền tảng (kernel/contract.js — nguồn sự thật duy nhất)

| platform | post | reply | affiliate | scan_account |
|---|---|---|---|---|
| instagram | automator.js | interaction.js | affiliate-commenter.js | accounts-scanner.js |
| threads | automator.js | interaction.js | affiliate-commenter.js | accounts-scanner.js |
| tiktok | automator.js | comment-replier.js / studio-comment-replier.js (theo `source_type='comments_manager'`; inject bridge MAIN-world trước) | — | accounts-scanner.js |
| tiktok (`nurture`) | — | — | — | — | bộ engine Farmer trong `modules/tiktok-nurture/`: selectors.js → modules.js → engine.js → content.js → adapter.js (sau CANONICAL, frame top) |
| x | automator.js (thư mục modules/x/) | interaction.js | affiliate-commenter.js | accounts-scanner.js |
| youtube | automator.js (Community post; tự khởi động từ storage + nhận `EXECUTE_YOUTUBE_POST`) | — | — | accounts-scanner.js |
| probe | không mở tab — runner tự ghi receipt success (chứng minh vòng đời) | | | |

Mọi lần inject đều nạp `modules/shared/canonical-task-storage.js` TRƯỚC script nền tảng
(trừ scan: nạp `account-scan-utils.js` + đặt `globalThis.__accountScanContext = {scanId, stepId, platform}` trước).
**Không inject watermark-service** (khác MUT có chủ đích — luật fork §3-4; automator chỉ dùng nó
khi task có `watermark_config`, task local không bao giờ set).

## 5. Message contract

### 5a. Content script → kernel (giữ nguyên action của MUT)
`postCompleted` / `postFailed` / `postResultUnknown` / `updatePostStatus` (kèm postId, resultUrl...),
`postSubmitStarted` / `postUploadStarted` / `postSubmitAwaitingResult` (chỉ cập nhật trạng thái),
`affiliateCommentDone` / `affiliateCommentProgress` (campaignId, items...),
`commentReplyDone` / `commentReplyProgress`, `tiktokReplyCheckpoint`,
`mediaFetchStart {url}` → `{success,id,size,type}` · `mediaFetchChunk {id,offset,length}` → `{success,data,nextOffset}` ·
`mediaFetchEnd {id}`, `fetchImage {url}` → `{success,dataUrl}`,
`getSmartCommentReply {campaignId, commentText, commentAuthor}` → `{data:{reply_text}}` hoặc `null`
(kernel trả lời bằng web-tab AI; lỗi → `null` để script rơi về `reply_templates`),
`socialAccountsScannerResult {scanId, stepId, accounts[], error?}` → kernel lưu vào `autovjp.accounts` (local, KHÔNG sync đi đâu).
`nurtureProgress {taskId, counters}` (chỉ tiktok-nurture) → kernel chạm run (giữ sống trước watchdog) + lưu `nurture_counters`.
`nurtureDone {taskId, status, failure_code?, resultMessage?, items?}` → outbox ghi receipt type `nurture` (items = proofs từng video/hành động).
`storyCompleted` / `storyFailed {postId, resultUrl?, details?}` → receipt type `story`; `uploadCompleted` / `uploadFailed` → type `upload` (2.7.0/2.8.0).
`healGetLearned {platform, key}` → `{success, spec?}` · `healSuggest {platform, key, intent, snapshot}` → `{success, specs[]}` ·
`healMarkProven {platform, key, spec}` → `{success}` — tự chữa selector 2.9.0, xem `modules/shared/HEALER.md`.
`healthscanCompleted` / `healthscanFailed {postId, items?}` → receipt type `healthscan` (2.9.0).

Action lạ: listener của kernel **không trả lời** — để lõi FB xử lý action của nó.

### 5b. Trang quản lý → kernel (tiền tố `autovjp.`)
`autovjp.createTask {task}` · `autovjp.createSchedule {template, run_at, repeat?}` ·
`autovjp.deleteSchedule {id}` · `autovjp.cancelTask {taskId}` · `autovjp.setPaused {paused}` ·
`autovjp.listState` → `{queue, schedules, receipts, outbox, accounts, paused, currentRun, learnedSelectors, platforms}` ·
`autovjp.probe {echo?}` → chạy task probe xuyên vòng đời, trả receipt · `autovjp.clearReceipts` ·
`autovjp.healForget {id}` / `autovjp.healForgetAll` → xoá selector đã học (2.9.0).

## 6. Receipt (biên lai local — thay server ACK)

`{receipt_id, task_id, run_id, delivery_id, type, platform, status, result_url, result_url_type,
actor_url, actor_name, target_name, items?, items_count?, message, failure_code, source_url,
started_at, received_at, duration_ms}` — lưu ở `autovjp.receipts` (tối đa 200), chống trùng bằng
receipt key (type|taskId|platform|runId|sourceKey) ở `autovjp.receiptKeys`.

## 7. Ranh giới an toàn

- Không action nào của tầng module nhận lệnh từ trang web (không `externally_connectable`, không bridge kiểu MUT).
- Kernel chỉ mở tab tới host của 5 nền tảng + chatgpt.com/gemini.google.com (AI tab, chỉ khi có yêu cầu caption/reply thông minh).
- Mọi task chạy trên phiên đăng nhập sẵn của user trong tab managed — DOM-only, không cookie/token/DTSG.
