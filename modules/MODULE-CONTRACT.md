# MODULE CONTRACT — Auto vjp module layer (S2)

_Tài liệu hợp đồng giữa **lõi FB** và **tầng module đa nền tảng** (`modules/`).
Chốt 2026-11-04 theo plan v2.1 §4.4 + §6-S2. Luật bao trùm: **everything is module** (plan §3-8) —
mỗi nền tảng = 1 module độc lập trong `modules/<platform>/`, chỉ giao tiếp qua hợp đồng này;
thêm module mới không sửa module cũ; contract chỉ thêm, không phá._

**`CONTRACT_VERSION` trong code = 2** (`modules/kernel/contract-data.js`, giữ nguyên từ bản port
MUT tới nay). Các type cộng thêm về sau — `nurture` (2.1.0), `story` (2.7.0), `upload` (2.8.0),
`healthscan` (2.9.0) — đều là cộng thêm theo luật trên nên **không tăng CONTRACT_VERSION**; ghi rõ
điểm này để không hiểu nhầm tài liệu/code bị lệch. Đồng bộ lại registry §3–§4 + dọn type chết ở
contract-data: **2.11.9** (xem §3).

## 1. Ai sở hữu cái gì

| Vùng | Chủ sở hữu | Ghi chú |
|---|---|---|
| `background.js`, `popup.*`, content script FB, storage key của FB | Lõi FB | Tầng module KHÔNG đọc/ghi key của lõi (ngoại trừ `lastStatus` hiển thị chung, theo tiền lệ MUT) |
| `modules/kernel/*` | Kernel dùng chung | contract-data, contract (registry), store, outbox, source, runner, results, media, aitab |
| `modules/<platform>/*` | Module nền tảng đó | Content script thi hành port từ client MUT, giữ nguyên khối |
| `modules/shared/*` | Dùng chung cho module | canonical-task-storage, dom-utils, account-scan-utils (port từ MUT) |
| `modules/aitab/ai-bridge.js` | Kernel aitab | Cầu nối ChatGPT/Gemini trong trang web AI |
| Key canonical `currentAutomationRun` | Kernel (qua AVJP.store) | Hợp đồng với content script MUT — giữ nguyên tên + hình dạng |
| `modules/kernel/fbtask.js` | Kernel — **ngoại lệ có chủ đích** (2.13.0) | File kernel duy nhất được gọi hàm của lõi FB và ĐỌC key của lõi (cờ active, bộ đếm, dòng trạng thái, `scheduledTasks`); không ghi key nào của lõi. Xem §5a "Việc Facebook" |
| Key `autovjp.*` | Kernel | queue/schedules/receipts/outbox/accounts/managedTabs/paused |

**Điểm chạm vào lõi FB: đúng 2 chỗ** — (1) cuối `background.js`: `importScripts('modules/bridge.js')`
bọc try/catch (bridge lỗi thì lõi vẫn chạy); (2) `popup.html`/`popup.js`: 1 nút mở `manage.html`.

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
- `type` thuộc CONTRACT_VERSION 2: tập type kernel route được (nguồn sự thật =
  `AVJP.contract.TASK_TYPES` trong `kernel/contract.js`, cổng qua `validateTask` ở
  `kernel/source.js`) hiện gồm: `post`, `reply`, `affiliate`, `scan_account`, `probe`
  (nội bộ, kiểm tra vòng đời) + các bổ sung cộng thêm: `nurture` (2.1.0), `story` (2.7.0),
  `upload` (2.8.0), `healthscan` (2.9.0), `fb_feature` (2.13.0). Facebook KHÔNG chạy bằng script của tầng module: task `fb_feature` chỉ là vỏ chuyển việc cho lõi FB (xem §5a "Việc Facebook").
  Tên type ở tầng kernel là tên "transport"; riêng `affiliate` có tên canonical trong
  contract-data là `affiliate_comment` — hai phía nối nhau bằng `LEGACY_TASK_TYPE_MAP` /
  `LEGACY_TRANSPORT_TASK_TYPE`, và metadata (timeout/retryable) của task affiliate được
  tra qua canonical đó. `probe` chỉ sống ở tầng kernel: không khai trong contract-data
  (không có TASK_METADATA — `defaultTimeoutMs` dùng nhánh fallback), runner tự ghi receipt.
- Bổ sung 2.1.0 (chỉ cộng thêm, không phá): type `nurture` — TikTok dùng engine TikTok
  Farmer port nguyên khối (module `modules/tiktok-nurture/`). Payload phẳng:
  `{platform:'tiktok', type:'nurture', watch_count?, like_enabled?, save_enabled?,
  follow_enabled?, max_minutes?, timeout_ms?}`. Content script báo tiến độ/kết quả qua 2 action
  riêng `nurtureProgress` / `nurtureDone` (xem §5a). Worker chỉ thi hành — giới hạn lịch
  (giờ hoạt động...) thuộc tầng điều phối giao việc, KHÔNG kiểm tra trong worker.
  Bổ sung 2.2.0–2.5.0: `nurture` mở rộng sang instagram (2.2.0), threads (2.3.0), x (2.4.0),
  youtube (2.5.0) qua lõi dùng chung `modules/nurture-core/` + adapter riêng từng nền tảng
  (payload theo nurture-core, xem `modules/nurture-core/README.md`).
- Bổ sung 2.7.0: type `story` — hiện chỉ instagram (`modules/instagram/story.js`), báo
  `storyCompleted` / `storyFailed` (xem §5a).
- YouTube: task `post` có media video bị **từ chối ngay khi enqueue** — `post` chỉ là
  Community post/comment; video đi qua type `upload` riêng (bổ sung 2.8.0,
  `modules/youtube/upload.js`, tải qua YouTube Studio — video thường + Shorts chung 1 luồng),
  báo `uploadCompleted` / `uploadFailed`.
- Bổ sung 2.6.0: `reply` cho youtube (`modules/youtube/interaction.js` — task comment độc
  lập trên 1 video); scan youtube đổi sang `modules/youtube/discovery.js` chạy ở
  `channel_switcher` (xem §4).
- Bổ sung 2.9.0 (chỉ cộng thêm): type `healthscan` — instagram/youtube/threads/tiktok
  (x: chưa hỗ trợ). Script dùng chung `modules/shared/healthscan.js` (sau CANONICAL +
  `modules/shared/healer.js`): mở bề mặt mẫu theo `startUrl`, chỉ **định vị** các neo
  mẫu qua `AVJP.heal.locate`, KHÔNG tương tác thật; báo `healthscanCompleted/Failed`,
  receipt `items` = `{key, found_via, spec}` từng neo. Healthscan không markProven —
  xem `modules/shared/HEALER.md`.
- Dọn dẹp 2.11.9: contract-data bỏ 9 type thừa hưởng từ MUT **không bao giờ route được**
  trong kernel local — `comment`, `like`, `own_post_comment`, `auto_connect`, `join_group`,
  `scan_group`, `scan_shopee`, `media_enrichment`, `ai_caption` (không nằm trong
  `AVJP.contract.TASK_TYPES` nên `validateTask` luôn từ chối; không platform nào có nhánh
  `scripts()` cho chúng; trang quản lý không tạo được). Đã bỏ cả TASK_METADATA và alias
  legacy trỏ riêng vào chúng (`post_comment`, `friend`). CONTRACT_VERSION giữ nguyên 2.

## 4. Registry nền tảng (kernel/contract.js — nguồn sự thật duy nhất)

Script thi hành theo (type × platform) — tên file nằm trong `modules/<platform>/` trừ khi ghi khác:

| type | instagram | threads | tiktok | x | youtube |
|---|---|---|---|---|---|
| post | automator.js (+ HEALER, DEFAULT_IMAGE) | automator.js (+ DEFAULT_IMAGE) | automator.js (frame top) | automator.js (+ DEFAULT_IMAGE) | automator.js (Community post; tự khởi động từ storage + nhận `EXECUTE_YOUTUBE_POST`) |
| reply | interaction.js | interaction.js | comment-replier.js / studio-comment-replier.js (theo `source_type='comments_manager'`; inject bridge MAIN-world `reply-bridge.js` / `studio-reply-bridge.js` trước; frame top) | interaction.js | interaction.js (+ HEALER) |
| affiliate | affiliate-commenter.js | affiliate-commenter.js | — | affiliate-commenter.js | — |
| scan_account | accounts-scanner.js | accounts-scanner.js | accounts-scanner.js | accounts-scanner.js | **discovery.js** (chạy ở `channel_switcher`; accounts-scanner.js cũ không còn được tham chiếu — nó báo thiếu scanId nên kernel không khớp được run) |
| nurture | nurture-core + `modules/instagram-nurture/adapter.js` (frame top) | nurture-core + `modules/threads-nurture/adapter.js` (frame top) | bộ engine Farmer trong `modules/tiktok-nurture/`: selectors.js → modules.js → engine.js → content.js → adapter.js (sau CANONICAL, frame top) | nurture-core + `modules/x-nurture/adapter.js` (frame top) | nurture-core + `modules/youtube-nurture/adapter.js` (frame top) |
| story | story.js (+ HEALER) | — | — | — | — |
| upload | — | — | — | — | upload.js (YouTube Studio) |
| healthscan | `modules/shared/healthscan.js` (+ HEALER) | `modules/shared/healthscan.js` (+ HEALER) | `modules/shared/healthscan.js` (+ HEALER, frame top) | — | `modules/shared/healthscan.js` (+ HEALER) |
| probe | không mở tab — runner tự ghi receipt success (chứng minh vòng đời) | | | | |

`DEFAULT_IMAGE` = `modules/shared/default-image.js` (2.11.7, ảnh mặc định của riêng Auto vjp —
xem §3); `HEALER` = `modules/shared/healer.js` (2.9.0).

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
`nurtureProgress {taskId, counters}` (mọi module nuôi — tiktok-nurture + nurture-core của
instagram/threads/x/youtube) → kernel chạm run (giữ sống trước watchdog) + lưu `nurture_counters`.
`nurtureOwnerPing` → `{success, tabId}`: module nuôi hỏi id của chính tab gửi để ghi owner-tab vào state run.
`nurtureDone {taskId, status, failure_code?, resultMessage?, items?}` → outbox ghi receipt type `nurture` (items = proofs từng video/hành động).
`getNurtureAiComment {prompt, provider?}` → `{success, text, via}` — đường AI comment dùng chung của họ nuôi:
ưu tiên API của lõi (provider đã cấu hình, vd 9router), lỗi thì rơi về aitab; lỗi cả hai → `{success:false}`
để adapter dùng mẫu comment trong task.
`storyCompleted` / `storyFailed {postId, resultUrl?, details?}` → receipt type `story`; `uploadCompleted` / `uploadFailed` → type `upload` (2.7.0/2.8.0).
`healGetLearned {platform, key}` → `{success, spec?}` · `healSuggest {platform, key, intent, snapshot}` → `{success, specs[]}` ·
`healMarkProven {platform, key, spec}` → `{success}` — tự chữa selector 2.9.0, xem `modules/shared/HEALER.md`.
`healthscanCompleted` / `healthscanFailed {postId, items?}` → receipt type `healthscan` (2.9.0).
`microActionDone {taskId, status, failure_code?, resultMessage?, details?}` → receipt type `micro_action` (2.11.16) — hành động nhỏ test lẻ (scroll_feed/like_first/watch_first/view_first_story/open_notifications/open_profile) qua `modules/<platform>/micro.js`; payload task `{action, seconds?}`.

#### Registry hành động nhỏ — `MICRO_ACTIONS` (2.11.17)

Nguồn sự thật duy nhất cho tập hành động nhỏ: `AVJP.contractData.MICRO_ACTIONS` trong `modules/kernel/contract-data.js` — map `platform → entry[]`. Trang quản lý (manage.js) render bảng "Hành động nhỏ" từ registry này (không còn danh sách cứng); results.js gắn `details.label` từ registry vào biên lai `micro_action`.

Entry: `{key, label, needs, prefix?, note?}`

- `key`: khoá hành động — chính là `payload.action` của task `micro_action`; handler sống trong `modules/<platform>/micro.js`. Key + hành vi của 22 khoá 2.11.16 giữ nguyên.
- `label`: nhãn tiếng Việt hiển thị trên bảng + biên lai.
- `needs`: `'standalone'` (chạy lẻ được) | `'context'` (cần ngữ cảnh do chuỗi tiền tố dựng).
- `prefix`: chỉ khi `needs:'context'` — mảng key chạy lần lượt TRƯỚC hành động đích trong cùng task (step-runner theo phase trong micro.js, phase lưu storage chống inject lại sau điều hướng). Tiền tố fail → task `failed` với `failure_code:'prefix_failed'` + `details` ghi rõ bước tiền tố nào fail; không chạy bước đích.
- `note?`: ghi chú hiển thị (đầu vào cần thiết, tính phá huỷ, stub…).

Quy ước khoá đặc biệt:

- `tf_<tên step>` (chỉ tiktok): step TikTok Farmer chạy lẻ đúng 1 step qua `TF.engine` (kind module, workflow 1 bước, ctx/checkpoint như phiên nuôi). 5 step khung (`tf_chon_video_hang_doi`, `tf_goi_workflow`, `tf_lap_lai`, `tf_neu_thi`, `tf_theo_xac_suat`) có label hậu tố `· khung` và kết quả mang `details.stub: true`.
- `healthscan_<anchor>` (instagram/youtube/threads/tiktok — đặt ở nền tảng của neo): định vị neo selector mẫu của healthscan (`ig.post.createBtn`, `yt.reply.commentBox`, `th.feed.likeBtn`, `tt.fyp.likeBtn`) qua handler dùng chung `modules/shared/healthscan-micro.js` + `AVJP.heal.locate` — chỉ định vị, không bấm, không markProven.

Tổng 2.11.17: **216 hàng** (instagram 34, threads 23, tiktok 78, x 32, youtube 49) = 207 hành động nguyên tử đã kiểm kê + 4 healthscan + 5 khoá micro tiktok cũ là hành động riêng không trùng 36 hành động nền tảng tiktok.
#### Dừng hành động, `testState` và Log test (2.11.18)

- **Huỷ task (`user_cancelled`)**: 3 lớp phối hợp. (1) Kernel: `autovjp.cancelTask {taskId}` ghi cờ vào `autovjp.cancelFlags` (`{taskId: timestamp}`, store.js) rồi — nếu task là run hiện tại — `runner.cancelCurrent` chốt ngay receipt **`failed` / `failure_code:'user_cancelled'`** + `forceCleanup` (đóng tab managed); task còn queued thì bị xoá khỏi queue (kèm ghi testState `cancelled` nếu có `meta.testKey`). Kết quả đến muộn của task đã chốt bị outbox bỏ (không khớp run hiện tại / trùng receipt key). `user_cancelled` thuộc nhóm KHÔNG BAO GIỜ retry. (2) Trang: mọi file `modules/<platform>/micro.js` có `avjpSleepCancellable(ms)` (ngủ từng đoạn ≤800ms + kiểm tra cờ `autovjp.cancelFlags` theo `task_id` của phase) nối vào `waitFor` trung tâm + biên mỗi bước + các handler ngủ dài (`scroll_feed`, `watch_first`…) — thấy cờ thì ngừng hành động và báo `failed/user_cancelled` qua đường `microActionDone` sẵn có. (3) Giao diện: mỗi hàng bảng test có task đang chạy/đang chờ thì hiện nút **Dừng** tại hàng; nút **Dừng tất cả đang chạy** (`autovjp.cancelAll` → huỷ run hiện tại + xoá toàn bộ queue) ở đầu khu vực test.
- **`autovjp.testState`** (store key `autovjp.testState`): rollup trạng thái test lẻ theo hàng, khóa `<platform>:<type>:<actionKey|''>`, giá trị đúng 4 trường `{status, at, message, task_id}`. Task từ bảng test mang `meta.testKey`; kernel ghi `running` ngay trong `autovjp.createTask`, và ghi trạng thái cuối tại điểm chốt receipt trong `outbox.deliver` (bỏ qua receipt trung gian `retrying`). `listState` trả kèm `testState`. Manage backfill 1 lần khi mở trang qua `autovjp.backfillTestState {entries}` (chỉ ghi khóa chưa có) từ các receipt cũ chưa có testKey. Chip trên hàng: `success→PASS`, `failed→FAIL`, `uncertain→Treo`, `cancelled→Đã dừng`, `running` mà task không còn trong run/queue → **Gián đoạn** (trình duyệt/máy tắt giữa chừng).
- **Panel "Log test"** (manage.html, ngay dưới các bảng test): render theo nhịp poll `listState` sẵn có từ `receipts` — 40 biên lai gần nhất, mỗi dòng giờ + tên hành động + trạng thái + message rút gọn; nút "Xoá khung xem" chỉ ẩn dòng cũ phía hiển thị (biến cục bộ theo mốc thời gian), không xoá dữ liệu. Mục "Nhật ký hoạt động" + nút sao chép toàn bộ log giữ nguyên.

#### Tự cập nhật từ trang quản lý — `manage-updater.js` (2.11.19, siết an toàn 2.11.20)

- **Vị trí**: thẻ "Cập nhật extension" trong view "Cài đặt & kết nối" của trang quản lý (`manage.html` section `#updateSection` trong `data-view="settings"`, cùng thẻ "Kết nối máy chủ"; từ 2.13.0 — trước đó nằm cố định ở đầu mọi view). Logic nằm trọn ở file gốc `manage-updater.js`, expose `AVJP.updater = { runUpdate, unzipZip, cmpVersion }`; manage.js không tham gia.
- **Lõi `runUpdate({dirHandle, expectedName, onStatus})`** — thuần, chỉ dùng FSA subset (`getFileHandle`, `getDirectoryHandle(name,{create})`, `createWritable` write/close, `getFile().text()`, `values()`, `removeEntry(name,{recursive})`) để test được bằng handle giả. Luồng: đọc `manifest.json` trong thư mục được cấp → lệch `name` với manifest đang chạy thì `error:'wrong-directory'`, không ghi gì; fetch `manifest.json` trên nhánh `main` của repo GitHub → so version với version TRONG THƯ MỤC (thư mục chính là nơi extension đang nạp nên trùng version đang chạy ở môi trường thật): thấp hơn → `error:'remote-older'`, bằng → `{status:'up-to-date'}` no-op; cao hơn → tải zip `archive/refs/heads/main.zip`, giải nén bằng bộ đọc ZIP tự viết (central directory; stored + deflate qua `DecompressionStream('deflate-raw')`; bóc tiền tố `auto-vjp-main/`), KIỂM CHỨNG trước khi ghi (manifest mới parse được, name khớp, version khớp bản đã fetch, >50 file) rồi ghi mirror: ghi đè/tạo mọi file (**`manifest.json` ghi cuối cùng**), lỗi ghi dừng ngay tại file đó (`error:'write-failed'` + `failedFile`, không chạy bước xoá); sau đó xoá file/thư mục local không có trong bộ mới — **bỏ qua hoàn toàn `.git/` ở mọi độ sâu**. Kết quả: `{ok, status:'updated'|'up-to-date'|'error', fromVersion, toVersion, filesWritten, filesDeleted}`; tiến trình qua `onStatus(stage, data)`.
- **Siết an toàn (2.11.20)**: (1) ghim commit — hỏi `api.github.com/repos/.../commits/main` lấy SHA rồi tải `manifest.json` + zip theo đúng SHA (không lấy được thì lùi về tải theo nhánh, bản tóm tắt ghi "CHƯA GHIM"); (2) zip — kiểm CRC32 + kích thước từng file, từ chối đường dẫn `..`/tuyệt đối/`\`/`:`; (3) so nội dung với thư mục hiện tại, **chỉ ghi file mới/đổi** (manifest vẫn ghi cuối); (4) tham số `confirm(summary)` — `summary = {fromVersion, toVersion, commit, pinned, added, changed, deleted, newGrants}`; trả false → `error:'cancelled'`, chưa ghi gì. Không truyền `confirm` mà bản mới xin thêm quyền (`newGrants` khác rỗng) → `error:'permissions-changed'`. UI dùng `window.confirm` hiện bản tóm tắt. Đây không phải chữ ký số: không chống được việc repo bị chiếm. Test: `tests/updater.test.js`.
- **UI/handle**: toàn bộ luồng quyền nằm trong handler click nút "Cập nhật" — handle thư mục lưu IndexedDB (`autovjp-updater`/`handles`/`'extDir'`); có sẵn thì `queryPermission` → chưa granted thì `requestPermission` ngay trong click; chưa có thì `showDirectoryPicker()`. Sai thư mục → xoá handle đã lưu để lần sau chọn lại; nút "Chọn lại thư mục" xoá handle thủ công. Xong cập nhật → hướng dẫn mở chrome://extensions bấm ⟳ (nút mở trang qua `chrome.tabs.create`, degrade thành hướng dẫn chữ nếu bị chặn). Cập nhật KHÔNG tự nạp lại extension — người dùng bấm ⟳ là bước cuối có chủ đích.

`humanMouse {kind: click|scroll|move, x, y, dy?}` (content → background.js, KHÔNG qua results.js) → `{ok}` — chuột thật qua chrome.debugger cho `AVJP.human` (modules/shared/humanmouse.js, 2.11.16); lỗi/tắt công tắc → `{ok:false}`, content tự fallback click DOM.

Action lạ: listener của kernel **không trả lời** — để lõi FB xử lý action của nó.

#### Việc Facebook qua hàng đợi kernel — `modules/kernel/fbtask.js` (2.13.0)

- **Hình dạng**: `{platform:'facebook', type:'fb_feature', feature, label?, config, timeout_ms?}`. `feature` ∈ `AVJP.contract.FB_FEATURES` (= `SCHEDULE_FEATURES` của lõi; `tests/fbtask.test.js` canh hai bên khớp). `config` đúng dạng `task.config` của lệnh `scheduleCreate` trong lõi. `validateTask` gọi `fbtask.validate` → `normalizeScheduledTask` của lõi, sai thì ném lỗi ngay lúc enqueue. Chưa nhận `kind:'chain'`.
- **Thi hành**: `runner.start` không mở tab managed, không inject — gọi `fbtask.start(run)` → `launchScheduledTask(task)` của lõi (lõi tự mở/tìm tab Facebook, đổi actor, gửi lệnh Start). Task KHÔNG được ghi vào `scheduledTasks` và không đặt alarm của lõi.
- **Phase trên canonical run**: `claimed` → (`fb_waiting` nếu `hasActiveFeature()` đang true, thử lại mỗi nhịp, quá 60 phút → `failed`/`fb_busy`) → `fb_launching` (tối đa ~4 phút) → `fb_running` (`fb_tab_id`, `fb_run_id`; `tabId` của run để null nên outbox không đóng tab Facebook của người dùng).
- **Theo dõi**: `runner.watchdog` chuyển run facebook cho `fbtask.tick` mỗi phút (và ngay khi cờ active của lõi tắt, qua `storage.onChanged`). Cờ active tắt + `scheduleChainCompletionEvidence` đúng → `success`; cờ tắt mà thiếu bằng chứng → `uncertain` (có thể đã làm một phần — không tự chạy lại); tab Facebook bị đóng → `uncertain`; quá `timeout_ms` (mặc định 4 giờ) → gửi lệnh dừng của lõi rồi `uncertain`/`task_timeout`; lõi ném lỗi khi khởi chạy → `failed`/`fb_launch_failed`. Không mã nào trong số này nằm trong danh sách retry.
- **Huỷ**: `runner.cancelCurrent` gửi lệnh dừng của tính năng (`scheduleChainStopAction`) trước khi ghi receipt.
- **Mẫu cấu hình**: `fbtask.templates()` đọc `scheduledTasks` của lõi (kể cả từng bước của chuỗi), bỏ trùng theo `feature+label`, tối đa 20 mẫu/150KB; `remote.sync` gửi kèm khi nội dung đổi để hub giao lại đúng cấu hình đó.
- Trang quản lý: view "Facebook" (`manage-facebook.js`) lấy mẫu qua `autovjp.fbTemplates` → `{available, features, templates}` rồi tạo task bằng `autovjp.createTask` như mọi task khác. `listState.platforms` không gồm `facebook` (các màn soạn bài/quét của module không áp dụng); receipt facebook vẫn hiện trong nhật ký.

#### Nguồn việc từ xa — `modules/kernel/remote.js` + `hub/` (2.12.0)

- **Mặc định tắt.** Chưa có địa chỉ hub (`autovjp.remote.url` trống và `DEFAULT_HUB_URL` trống) thì không có request nào đi ra. Extension luôn là bên gọi; không có `externally_connectable`/`onMessageExternal`.
- **Định danh**: `autovjp.profileId` = `pf_` + 24 hex, sinh một lần. `register` → hub cấp token (lưu trong `autovjp.remote.token`), profile `pending` tới khi được duyệt trên hub.
- **Nhịp**: `source.kick()` gọi `AVJP.remote.sync()` không chờ (tối đa 1 lượt/45 giây, 1 lượt tại một thời điểm) — tức lúc nạp SW, lúc khởi động trình duyệt và mỗi nhịp alarm 1 phút. `sync` báo `busy/accept/capacity` + tên tài khoản đã quét, nhận `tasks:[{id,payload}]`.
- **Việc từ xa đi đúng đường việc tại chỗ**: `source.enqueue({...payload, origin:'remote', remote_task_id})` — cùng `validateTask`, cùng hàng đợi singleton. Task/run/receipt có thêm `origin` (`local`|`remote`) và `remote_task_id`. Chống nhận trùng bằng `autovjp.remoteSeen` (ghi TRƯỚC khi enqueue: thà hụt một việc để người dùng giao lại còn hơn chạy hai lần). Giữ tối đa 3 việc từ xa trong hàng đợi local, phần còn lại nằm ở hub.
- **Báo kết quả**: `outbox.deliver` sau khi ghi receipt gọi `AVJP.remote.onReceipt(receipt)` (ngoài khoá, lỗi không ảnh hưởng deliver) → hàng `autovjp.remoteReports` (bền, tối đa 300) → `POST /api/agent/results`. Receipt của việc tại chỗ cũng được báo (để hub thống kê), receipt quá 60KB bị cắt `items/details`.
- **Quyền tại chỗ**: `accept:false` = vẫn báo sống, không nhận việc; `disconnect()` xoá địa chỉ + token (địa chỉ ghi sẵn cũng không tự nối lại); hub trả 401/403 → trạng thái `revoked`, dừng hẳn, không tự đăng ký lại; `reRegister()` sinh ID mới.
- **Không gửi lên hub**: API key AI, cookie/phiên, storage của lõi FB, bản ghi quét tài khoản đầy đủ.
- **Lệnh trang quản lý**: `autovjp.remoteState` · `autovjp.remoteConfigure {url}` · `autovjp.remoteSetAccept {accept}` · `autovjp.remoteSyncNow` · `autovjp.remoteReRegister` · `autovjp.remoteDisconnect` — đều trả `{success, remote}`. UI: `manage-remote.js` (thẻ "Kết nối máy chủ").
- Đặc tả API phía hub: `hub/README.md`. Test trọn luồng: `tests/hub.test.js`.

### 5b. Trang quản lý → kernel (tiền tố `autovjp.`)
`autovjp.createTask {task}` · `autovjp.createSchedule {template, run_at, repeat?}` ·
`autovjp.deleteSchedule {id}` · `autovjp.cancelTask {taskId}` · `autovjp.cancelAll` (2.11.18) ·
`autovjp.backfillTestState {entries}` (2.11.18) · `autovjp.setPaused {paused}` ·
`autovjp.listState` → `{queue, schedules, receipts, outbox, accounts, paused, currentRun, learnedSelectors, platforms, testState}` ·
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
