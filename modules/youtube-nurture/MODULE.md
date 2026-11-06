# MODULE — youtube-nurture (Auto vjp 2.6.0)

_Adapter nuôi YouTube của tầng module Auto vjp — lát 4 (lát cuối) của plan
nuôi đa nền tảng (`jobs/fb-auto-tool/plan-nuoi-da-nen-tang.md` §3). Mọi cơ
chế quản lý/đồng bộ/pacing/proof nằm ở **lõi dùng chung**
`modules/nurture-core/` (xem `modules/nurture-core/README.md` — bản đồ cơ
chế ↔ bản gốc FB Auto Tool); file này chỉ ghi phần riêng của YouTube.
Khuôn theo `threads-nurture` (lát 2) + `x-nurture` (lát 3)._

## 1. File & đường inject

| File | Vai trò |
|---|---|
| `adapter.js` (viết mới) | Toàn bộ adapter: đọc canonical task → cấu hình → vòng lặp trang chủ → /watch: xem thật → like/subscribe/comment AI qua lõi → `nurtureProgress`/`nurtureDone` |

Inject (khai ở `kernel/contract.js`, platform youtube / type `nurture`,
`frameTopOnly: true`):
`canonical-task-storage.js → nurture-core.js → adapter.js`.
Tab mở ở `https://www.youtube.com` (`contract.startUrl` — nhánh nurture
của youtube). YouTube **chưa có type `reply` trong contract** — lát này
không thêm, chỉ `nurture`.

Khác các lát trước ở điều hướng: phiên đi qua nhiều trang (trang chủ →
/watch → video gợi ý tiếp). Runner của kernel tự inject lại adapter sau
mỗi lần tab tải xong trang mới (`chrome.tabs.onUpdated`), nên adapter
chịu được cả chuyển trang SPA lẫn reload đầy đủ:

- **Vá kernel 2.6.0 — gốc rễ "điểm câm" của các phiên live 2.5.x**:
  `modules/kernel/runner.js` giữ một `Set injected` khóa theo
  `${tabId}|${run.run_id}|${tab.url}` (khai báo ở đầu file, kiểm tra +
  ghi ở listener `tabs.onUpdated`) và **không bao giờ inject lại** khi
  key đã có. Adapter này lại điều hướng FULL về **cùng một URL** nhiều
  lần trong một phiên (về trang chủ `https://www.youtube.com` sau mỗi
  video ở `goNextFromWatch`/`watchShortsBriefly`, và khi xoay nguồn) —
  trang tải lại cùng URL bị guard chặn, adapter không chạy tiếp, phiên
  câm tới khi watchdog đóng `uncertain` dù adapter không hề lỗi. Từ
  2.6.0: runner **bỏ qua guard cho riêng type `nurture`** (mọi adapter
  nuôi đều tự chống trùng bằng cờ trong document + resume theo run_id),
  các type post/reply/scan/affiliate giữ nguyên guard. Đây là lý do các
  vá phía adapter ở 2.5.2 (deadline/heartbeat) không chữa được điểm câm:
  code adapter khi đó thậm chí không được nạp lại để chạy.

- Session (số like/comment/subscribe/uncertain, số video đã xem, tập
  video đã xử lý) được **dựng lại từ `youtubeNurtureJournal` theo runId**
  ở mỗi lần inject — không tin biến trong trang.
- Deadline của phiên lưu ở key `youtubeNurtureDeadline` (cùng họ state
  của lõi, kiểu key phụ như `TaskId`/`Journal` ở các lát trước) để reload
  không gia hạn phiên. Các giới hạn cứng còn lại (watch_count,
  max_actions, trần ngày/đích của lõi, timeout_ms của kernel) đều bền
  qua reload.
- Cursor xoay nguồn lưu ở key phụ `youtubeNurtureSource` cạnh đó
  (2.5.1, cơ chế ở §3): index của nguồn hiện tại trong danh sách
  trang chủ → subscriptions → tìm kiếm, ghi xuống TRƯỚC mỗi lần điều
  hướng xoay để bản inject mới không quay lại nguồn đã cạn.
- Phân loại LIVE (2.5.2): id video có badge live trên thẻ được nhớ
  tạm trong `sessionStorage` của tab (key
  `avjpYoutubeNurtureLiveIds`, tối đa 100 id gần nhất) để bản inject
  trên trang `/watch` cùng tab nhận lại ngay; lớp chắc chắn chính vẫn
  là `detectLiveVideo()` trên trang watch (§3), không phụ thuộc vào
  bộ nhớ tạm này.

## 2. Payload task

```json
{ "platform": "youtube", "type": "nurture",
  "watch_count": 3,
  "like_enabled": true, "subscribe_enabled": false, "comment_enabled": true,
  "like_pct": 80, "comment_pct": 60, "subscribe_pct": 10,
  "watch_min_seconds": 30, "watch_max_seconds": 90,
  "max_actions": 8, "max_minutes": 12, "timeout_ms": 1800000,
  "comment_templates": ["Bài chia sẻ hay quá, cảm ơn bạn nhiều nhé!", "..."],
  "prompt": "...", "ai_provider": "gemini",
  "comment_gap_min": 45, "comment_gap_max": 120,
  "search_query": "tin tức hôm nay", "source_url": "" }
```

- `search_query` / `source_url` (2.5.1): chỉ dùng cho **nguồn tìm kiếm**
  khi xoay nguồn (§3). Có `source_url` thì dùng thẳng làm URL nguồn tìm
  kiếm; không có thì dựng `/results?search_query=` +
  `encodeURIComponent(search_query)`, `search_query` trống nữa thì mặc
  định `"tin tức hôm nay"`.

- Mặc định khi task không ghi: like BẬT, comment BẬT, subscribe TẮT,
  `watch_count` 5, xem mỗi video ngẫu nhiên 30–90s (video ngắn hơn thì
  xem tới hết).
- subscribe chấp nhận cả field riêng (`subscribe_enabled`/`subscribe_pct`)
  lẫn field của lõi (`follow_enabled`/`follow_pct`) — như X chấp nhận
  `bookmark_*`/`save_*`.
- Tỉ lệ `*_pct` + `prompt` + `comment_gap_*` trong task thắng cấu hình
  sync (`youtubeNurture<Field>`); xem nurture-core README §1.
- Nút "Nuôi YouTube (phiên mẫu)" ở manage.html dùng đúng payload mẫu
  trên: xem 3 video, subscribe TẮT, `max_minutes` 12, `timeout_ms` 30
  phút, KÈM `comment_templates` (bộ mẫu dùng chung `NURTURE_COMMENT_TEMPLATES`
  trong manage.js): khi AI chưa sẵn, comment vẫn gửi bằng mẫu và kiểm
  chứng được bằng proof; journal ghi rõ `source: 'ai' | 'template'`.
  Từ 2.5.1 nút mẫu kèm thêm `search_query: 'tin tức hôm nay'` cho nguồn
  tìm kiếm dự phòng khi xoay nguồn.

## 3. Hành vi phiên

1. Đọc canonical run; không đúng platform/type → thoát im lặng (inject
   nhầm an toàn).
2. `startRun` persist state (họ key `youtubeNurture*`) TRƯỚC khi đụng
   trang; bị inject lại với cùng RunId + Active → resume, không reset
   Done*. `claimOwner` ghi `youtubeNurtureOwnerTabId` qua
   `nurtureOwnerPing`.
3. Kiểm cổng: URL ServiceLogin/accounts.google.com, iframe recaptcha /
   trang /sorry, hộp thoại đăng nhập bật giữa phiên, hoặc masthead chỉ
   có nút Sign in (không có avatar) → `nurtureDone failed /
   session_expired` ngay, không lách, không tự giải captcha.
4. Vòng lặp tới khi đủ `watch_count` video, đủ `max_actions` (like +
   comment + subscribe), hết `max_minutes` (deadline bền qua reload),
   bị dừng (Active=false hoặc RunId đổi → `failed / user_cancelled`):
   - **Bề mặt nguồn (trang chủ / subscriptions / tìm kiếm / kênh)**:
     quét thẻ `ytd-rich-item-renderer` / `ytd-video-renderer`; bỏ thẻ
     quảng cáo (`ytd-ad-slot-renderer` / `ytd-in-feed-ad-layout-renderer`),
     bỏ Shorts (link `/shorts/`, shelf Shorts), bỏ video chết (Dead) và
     video đã like+comment (history lõi). Bấm thumbnail (dự phòng: link
     tiêu đề `a#video-title` trên trang kết quả) → chờ URL sang `/watch`;
     bấm không chuyển trang thì điều hướng thẳng theo href `/watch`
     (reload — bản inject mới resume và xử lý tiếp).
     - **Xoay nguồn (2.5.1)**: nguồn theo thứ tự cố định
       (a) trang chủ `https://www.youtube.com`,
       (b) `https://www.youtube.com/feed/subscriptions`,
       (c) tìm kiếm (`task.source_url`, hoặc
       `/results?search_query=<task.search_query | "tin tức hôm nay">`).
       Bề mặt hiện tại quét xong vòng đầu + 1 lần cuộn mà vẫn 0 ứng viên
       hợp lệ và phiên chưa đạt `watch_count` → ghi cursor
       `youtubeNurtureSource` = nguồn kế tiếp, journal 1 dòng `watch /
       skipped` ghi rõ "xoay nguồn: X trống -> Y", rồi điều hướng sang
       nguồn kế (bản inject mới resume từ journal + cursor, không quay
       lại nguồn đã cạn). Nhận diện nguồn hiện tại bằng URL
       (`/` → 0, `/feed/subscriptions` → 1, `/results` → 2; bề mặt lạ
       như trang kênh thì theo cursor). Đang ở nguồn cuối mà vẫn trống
       → giữ nhịp cũ (cuộn thêm 1 vòng) rồi kết phiên —
       `failed / no_eligible_target` như trước, không đổi kết cục.
       *Bằng chứng live (profile công nhân, 2026-11-05)*: nick YouTube
       đã đăng nhập (UI tiếng Việt) nhưng chưa có lịch sử xem → trang
       chủ hiện khung "Hãy bắt đầu xem video để giúp chúng tôi tạo
       trang đề xuất" với `ytd-rich-item-renderer` = 0, feed
       subscriptions cũng 0 video; trong khi trang tìm kiếm có
       `ytd-video-renderer` = 19 (38 link `/watch`). Phiên live đầu của
       2.5.0 fail `no_eligible_target`, xem 0 — adapter không sai,
       nguồn trống; xoay nguồn là để phiên tự tìm được bề mặt có video.
   - **Trang /watch**: chờ player sẵn (tối đa 14s; video lỗi/không khả
     dụng/gate tuổi → ghi Dead theo TTL cấu hình rồi đi tiếp):
     - **Xem thật**: thời lượng đích ngẫu nhiên `watch_min_seconds..
       watch_max_seconds` (video ngắn hơn thì xem tới hết). Đo bằng
       `video.currentTime`: chỉ cộng delta dương <5s (tua/seek không
       tính), video bị pause thì `play()` lại, **thời gian quảng cáo
       không tính** (phát hiện `ad-showing`; bấm nút Skip khi có, kẹt
       quảng cáo >60s thì chốt phần đã xem). Live: không có duration
       hữu hạn → xem đủ thời lượng đích. Đạt ≥80% thời lượng cần (hoặc
       video ended) mới tính 1 lượt xem (ánh xạ counters xem §4).
     - **Phân loại LIVE (2.5.2)**: ngay từ thẻ — badge "LIVE"/"TRỰC
       TIẾP" trong overlay thumbnail (`ytd-thumbnail-overlay-...` /
       `badge-shape` của view-model mới) — và/hoặc trên trang watch:
       `ytd-watch-flexy[is-live-video]`, class/badge `.ytp-live-badge`
       của player đang hiện, hoặc live chat đang mở kèm `duration` vô
       hạn. Video live vẫn **xem thật + like/subscribe như thường**,
       nhưng **comment bị chặn tại vị trí pha comment**: journal
       `comment / skipped` với note đúng `"video live — bỏ qua
       comment"`, rồi chuyển video kế. Không cuộn xuống `#comments`,
       không mở/không chờ khung comment thường trên trang live trong
       bất kỳ trường hợp nào (trang live chỉ có live chat); `doComment`
       còn một chốt chặn riêng trả `live_skipped` nếu dấu hiệu live
       chỉ lộ sau khi xem.
     - Tung tỉ lệ theo thứ tự **like → subscribe → comment** (comment
       cuối vì phải cuộn khỏi player); giữa 2 hành động cùng video
       nghỉ `PostMin..PostMax`. Trước mỗi hành động kiểm tra autoplay
       chưa đổi video (`currentVideoId()` khớp) — đã đổi thì bỏ hành
       động còn lại, không tương tác nhầm.
     - Đi tiếp: bấm video gợi ý đầu tiên hợp lệ trong `#related`
       (`ytd-compact-video-renderer`); không có thì quay về trang chủ.
   - **Trang /shorts/...** (lạc vào): chỉ xem 8–15s, ghi journal watch
     "shorts — chỉ xem", KHÔNG like/comment/subscribe, rồi về trang chủ.
   - **Đi tiếp từ /watch (bổ sung 2.6.0)**: ngoài
     `ytd-compact-video-renderer`, `goNextFromWatch` còn dự phòng
     `yt-lockup-view-model` ở cột gợi ý (markup thế hệ mới của YouTube):
     bắt `a[href*="/watch?v="]` bên trong lockup, cùng luồng bấm → chờ
     URL /watch như renderer cũ; cả hai đều không có/không chuyển trang
     mới về trang chủ. Đồng thời lời gọi `v.play()` trong vòng đo xem
     được bọc `Promise.race` với timeout 1500ms — promise play() treo
     (autoplay policy/trạng thái player lạ) không còn giết được phiên,
     vòng đo tự quay lại ở nhịp kế tiếp.
5. Proof từng hành động (không proof = uncertain, KHÔNG làm lại):
   - like: nút toggle trong cụm `segmented-like-dislike-button-view-model`
     / `ytd-segmented-like-dislike-button-renderer` (dự phòng: nút
     `aria-pressed` đầu tiên trong `ytd-watch-metadata`, hoặc aria-label
     "like this video..."/"Thích video..."). Đã `aria-pressed="true"`
     → `already`. Proof = `aria-pressed` lật `true` trong 3s (re-query
     mỗi vòng vì YouTube render lại cụm nút).
   - subscribe: `ytd-subscribe-button-renderer` /
     `subscribe-button-view-model` trong `#owner`. Proof đa tín hiệu
     trong 3s: renderer mang thuộc tính `subscribed`, text nút lật
     "Subscribed"/"Đã đăng ký", hoặc aria-label đổi. Key đích = kênh
     (`@handle` hoặc id `UC...` từ link kênh trong `#owner`).
   - comment (chỉ video thường — live đã bị chặn ở trên): cuộn tới
     `#comments` và **chờ nó render thật tối đa 15s** (trong
     `#comments` có simplebox / item-section / header; video tắt bình
     luận → ghi Dead + bỏ qua). Quá 15s không render → journal
     `comment / skipped`, **chốt luôn trên video này, không sang vòng
     chờ ô comment thứ hai**. Render rồi mới xin AI (ngữ cảnh tiêu đề
     + tên kênh + mô tả; lỗi → mẫu trong task, đánh dấu `source`), rồi
     chờ ô comment tối đa 15s nữa; ô không xuất hiện → `skipped`, cũng
     không chờ lại trên cùng video. **Ngoại lệ reload (2.6.4)**: chờ
     ô quá nửa ngân sách (7,5s) mà simplebox vẫn chưa xuất hiện thì
     adapter ghi cờ `youtubeNurtureCommentReload` = video id rồi
     `location.reload()` đúng 1 lần cho video đó (điều kiện: không
     phải live, video chưa từng reload, phiên còn > 90s) — bản inject
     mới trên trang tải đầy đủ gặp cờ ở vòng lặp chính và chạy lại
     `doComment` cho đúng video đó (xem/like đã có journal, không làm
     lại), rồi đi tiếp như thường; sau reload ô vẫn không có thì chờ
     nốt nửa ngân sách và chốt `skipped` như cũ. Bấm `#simplebox-placeholder` → chờ
     `#contenteditable-root` → gõ (execCommand insertText, dự phòng gõ
     từng ký tự / sự kiện input) → bấm `#submit-button`; gần trùng
     comment đã có/nội dung video → bỏ theo kỷ luật gốc. **Proof
     trong 15s** (YouTube render chậm): chữ ký comment xuất hiện ở
     `#content-text` trong `#comments`. Không thấy = uncertain, KHÔNG
     gửi lại. Sau mỗi lần gửi (cả uncertain) đều đặt `NextAllowedAt`.
6. `nurtureProgress` mỗi 30s + sau mỗi proof/watch; kết phiên:
   `nurtureDone` kèm items từ `youtubeNurtureJournal` của phiên (watch
   không vào items — như các lát trước, watch thể hiện ở câu tổng kết).
   **Rà vòng chờ (2.5.2)** — mọi chờ/poll của adapter đều có deadline
   cứng + poll `alive`/RunId qua `waitCancellable`/`waitForProof` của
   lõi: chờ player 14s (heartbeat 5s), xem video `target + 120s`
   (heartbeat 15s), chờ mốc comment theo đoạn 5s (deadline phụ 10
   phút), chờ `#comments` render 15s, chờ ô comment 15s, chờ editor
   5s, chờ proof like/subscribe 3s, chờ proof comment 15s, chờ URL
   watch 12s (heartbeat 5s), các nghỉ giữa hành động/đích đều qua
   `waitCancellable`. Riêng các chờ proof/render dài của pha comment
   đi qua `waitProofWithProgress`: chia đoạn tối đa 5s, giữa các đoạn
   gửi `nurtureProgress` — tổng vẫn bị deadline của chính vòng chờ đó
   chặn, không cộng dồn thành chờ vô hạn.
   Map trạng thái: có ≥1 video đã xem hoặc ≥1 proof → `success`; 0
   nhưng có uncertain → `uncertain`; 0 tất cả → `failed /
   no_eligible_target`.

## 4. Key storage + ánh xạ counters (điểm trung thực của lát này)

Toàn bộ qua nurture-core với prefix **`youtubeNurture`**:
sync: `youtubeNurtureLikePerDay/CommentPerDay/FollowPerDay/LikePerTarget/.../
LikePct/CommentPct/FollowPct/DelayMin/DelayMax/PostMin/PostMax/DwellMin/
DwellMax/CommentGapMin/CommentGapMax/DeadDays/Prompt`.
local: `youtubeNurtureActive/RunId/OwnerTabId/Config/TaskId/Index/Cursor/
Cycle/DoneLike/DoneComment/DoneSave/DoneFollow/DoneUncertain/Skipped/
LikeHistory/CommentHistory/SaveHistory/FollowHistory/Dead/Counters/Journal/
Status/NextAllowedAt` + key phụ `youtubeNurtureDeadline`,
`youtubeNurtureSource` (cursor xoay nguồn 2.5.1, xem §1 + §3) và
`youtubeNurtureCommentReload` (cờ reload-1-lần của pha comment
2.6.4: giá trị là video id đang chờ resume pha comment sau reload,
rỗng = không có; reset khi mở run mới, gỡ ngay khi nhánh resume
nhận, xoá khi phiên kết thúc).
Không đụng key kernel (`autovjp.*`), key lõi FB, key `*Nurture*` của nền
tảng khác, hay key `tf_*` của TikTok.

Ánh xạ hành động YouTube → kênh của lõi (`ACTIONS = like|comment|save|follow`):

| Hành động YouTube | Kênh lõi | History/Done/counters | Key đích |
|---|---|---|---|
| Like video | `like` | LikeHistory / DoneLike / counters.like | video id |
| Comment | `comment` | CommentHistory / DoneComment / counters.comment (core chặn comment lại cùng video trọn đời) | video id |
| Subscribe | `follow` | FollowHistory / DoneFollow / counters.follow (trần mặc định 5/ngày khớp plan "follow/subscribe 5") | kênh (`@handle`/`UC...`) |
| **Xem video** | **không có kênh** | **Journal action `watch` + `counters.watch` qua `bumpCounters({watch:1})`** | video id |
| Save | không dùng | DoneSave/counters.save giữ 0 cho đồng nhất định dạng | — |

Về **watch**: lõi không có kênh `watch` (ACTIONS cố định 4 hành động;
`canDo('watch')` sẽ luôn chặn vì không tồn tại `watchPerDay`, và
`recordProof('watch')` sẽ ghi `DoneWatch` không nằm trong STATE_KEYS —
đọc lại không tích luỹ được). Vì vậy adapter **không** gọi
canDo/recordProof cho watch và **tuyệt đối không** map watch sang `like`
để khỏi làm sai lệch counters.like/LikeHistory. Lượt xem chỉ được tính
sau khi đo thật bằng `currentTime` (§3), ghi journal `watch` (định dạng
chung mọi nền tảng) + tăng `counters.watch` bằng API công khai
`bumpCounters` (chấp nhận key tự do). Hệ quả: trần ngày cho riêng hành
động xem không qua `canDo` — giới hạn xem nằm ở `watch_count` của task
+ deadline phiên + `timeout_ms` của kernel. **Không sửa nurture-core ở
lát này**; nếu sau này cần trần ngày cho watch thì cộng kênh `watch` vào
ACTIONS của lõi trong một lát riêng (phải đối chiếu hồi quy cả 4
adapter còn lại).

## 5. Rủi ro selector/DOM (chưa có bằng chứng live ở lát build)

1. **DOM YouTube đổi liên tục**: cụm like đã qua ít nhất 2 thế hệ markup
   (`ytd-segmented-like-dislike-button-renderer` →
   `segmented-like-dislike-button-view-model` + `like-button-view-model`).
   Adapter khớp cả hai + dự phòng aria-label, và proof dựa vào thuộc
   tính `aria-pressed` (ít đổi hơn text). Nếu YouTube bỏ `aria-pressed`
   khỏi nút like, like rơi uncertain (an toàn, không đếm bừa) — điểm cần
   soi đầu tiên khi test live.
2. **Subscribe view-model**: biến thể `subscribe-button-view-model` có
   thể không mang thuộc tính `subscribed` trên renderer; proof còn text
   nút + aria-label gánh. Nhãn VI "Đã đăng ký" đã có trong bảng nhãn
   nhưng chưa kiểm chứng trên UI tiếng Việt thật.
3. **Comment render chậm + đổi cấu trúc**: comment mới có thể render
   trong `ytd-comment-view-model` thay vì `ytd-comment-renderer` — proof
   quét mọi `#content-text` trong `#comments` nên phủ cả hai, nhưng nếu
   YouTube trì hoãn hiển thị comment của chính mình quá 15s (kiểm duyệt
   giữ lại) thì comment rơi uncertain dù đã đăng thật — đúng kỷ luật
   "không proof = không đếm", chấp nhận ở lát này.
4. **Ô comment**: `#contenteditable-root` và `#submit-button` là neo
   hiện tại của `ytd-comment-simplebox-renderer`; YouTube từng thử
   nghiệm nhiều biến thể commentbox (có bản phải bấm placeholder 2 lần).
   Mở không được editor → `not_found` + ghi Dead ngắn (1 ngày) theo
   khuôn các lát trước, không kẹt phiên.
5. **Player/ads**: phát hiện quảng cáo dựa vào class `ad-showing` +
   overlay `.ytp-ad-player-overlay`; quảng cáo không skippable dài
   >60s làm lượt xem bị chốt sớm (journal ghi rõ số giây đã xem). Video
   nhúng player khác (music/premium thử nghiệm) có thể lệch `#movie_player`.
6. **Autoplay**: YouTube tự chuyển video khi hết — adapter kiểm tra
   `currentVideoId()` trước mỗi hành động và bỏ phần còn lại nếu đã
   đổi, nhưng khoảng giữa lần kiểm tra cuối và cú bấm vẫn có khe hở rất
   nhỏ; proof theo video id trong journal giúp phát hiện khi đối chiếu.
7. **Trang chủ cá nhân hoá**: thẻ đầu tiên có thể là video đã xem ngoài
   automation (không có trong history lõi) — adapter vẫn xử lý như
   video mới; thuật toán gợi ý của YouTube quyết định phần lớn nội dung
   phiên, adapter chỉ lọc ad/shorts/dead/trùng.
8. **Scanner YouTube từng timeout** (ghi nhận từ các lát trước, ở module
   `youtube/accounts-scanner.js`): không liên quan đường nurture (không
   dùng chung code), chỉ ghi nhận để tránh nhầm khi test tổng thể —
   nurture không gọi scanner.
9. **Livestream (sự cố live 2.5.1 → vá 2.5.2)**: phiên live ngày
   2026-11-05 xoay nguồn đúng, mở được video đầu tiên là một
   livestream (`watch?v=aOJttexL32A`): xem thật 31s ✓, like proof
   `aria-pressed` ✓ — rồi adapter câm ~5 phút ở pha sau like, kernel
   đóng phiên `uncertain` vì inactivity timeout, journal dừng ở entry
   like. Trang livestream đang phát **không có khung comment thường**
   (chỉ có live chat) nên mọi chờ đợi render comment trên đó đều là
   bế tắc. Từ 2.5.2: live được phân loại ở thẻ và/hoặc trên trang
   watch (§3) và comment bị bỏ qua tại chỗ bằng journal `skipped`;
   kể cả khi phân loại trượt, các vòng chờ comment giờ đều có
   deadline cứng + heartbeat (§3.6) và chốt `skipped` sau tối đa 15s
   ở bước render — không còn đường nào để một video làm câm cả phiên.
   Rủi ro còn lại: replay của livestream đã kết thúc (VOD có cả
   comment thường lẫn chat replay) có thể vẫn mang vài dấu hiệu live
   trên thẻ — nếu bị phân loại nhầm thành live thì chỉ mất comment
   trên video đó (like/xem giữ nguyên), chiều ngược lại (live đang
   phát mà mọi tín hiệu đều trượt) thì backstop 15s ở trên gánh.
10. **Nguồn tìm kiếm (2.5.1)**: đã có bằng chứng live là bề mặt đầy video
   (`ytd-video-renderer` = 19) và `findCards` quét được renderer này từ
   2.5.0; đường mở video trên trang kết quả đi cùng luồng trang chủ
   (bấm thumbnail → chờ `/watch`, kẹt thì điều hướng thẳng theo href —
   cộng thêm neo dự phòng `a#video-title` trong `cardVideoLink`). Rủi
   ro còn lại: kết quả tìm kiếm phụ thuộc `search_query` mặc định
   ("tin tức hôm nay") — nội dung phiên khi phải xoay tới nguồn này là
   tin tức đại chúng, không phải gu của nick; muốn nuôi theo chủ đề thì
   đặt `search_query`/`source_url` trong task. Trang kết quả cũng có
   thẻ Shorts/quảng cáo lẫn vào — bộ lọc ad/Shorts hiện có áp như cũ.

11. **Điểm câm sau chuyển trang (sự cố live 2.5.x → vá kernel 2.6.0)**:
    hai phiên live sau 2.5.1/2.5.2 đều chết cùng một kiểu — xử lý xong
    1 video là câm, kernel đóng `uncertain` sau 5 phút không hoạt
    động. Nguyên nhân gốc KHÔNG nằm ở adapter: `runner.js` chặn inject
    lại theo key `tabId|run_id|url` nên lần tải lại cùng URL (adapter
    về trang chủ sau mỗi video) không được nạp script nữa (chi tiết ở
    §1). Vá 2.6.0 ở phía kernel (bỏ guard cho type `nurture`) + hai vá
    nhỏ phía adapter: dự phòng `yt-lockup-view-model` cho cột gợi ý và
    `Promise.race` 1.5s cho `play()`. Hiệu quả thật của cả cụm vá chờ
    vòng test live của điều phối — nếu phiên vẫn câm sau 2.6.0 thì điểm
    nghi tiếp theo là cơ chế resume (journal/owner) chứ không còn là
    đường inject.

12. **Ô comment không nạp trên trang watch kiểu SPA (sự cố live
    2.6.3 → vá 2.6.4)**: phiên 2.6.3 receipt success (xem 3, like 2)
    nhưng journal comment trên video `ugZMQUnfqss` vẫn "#comments
    đã render nhưng ô comment không xuất hiện sau 15s — chốt
    skipped", trong khi task comment độc lập (interaction.js, cùng
    bộ selector ô soạn) ĐÃ đăng thành công trên Big Buck Bunny
    (verify độc lập thấy comment của @LinhVu-t2g). Khác biệt lớn
    nhất giữa 2 đường: độc lập mở video bằng TẢI TRANG ĐẦY ĐỦ
    (điều hướng thẳng tới /watch), nuôi tới video bằng chuyển SPA
    (bấm gợi ý/kết quả) — trên trang watch SPA, cụm #comments/
    simplebox nạp không đáng tin cậy ở bản headless dù cuộn lặp tức
    thời (2.6.2) đã gánh phần lazy-load theo viewport. Vá 2.6.4 =
    reload đầy đủ 1 lần/video ở giữa vòng chờ ô soạn (cờ
    `youtubeNurtureCommentReload`, nhánh resume riêng trong vòng
    lặp chính đặt trước nhánh `processedIds` — vì video đã có
    journal watch success nên nếu không có nhánh này, bản inject
    mới sẽ lướt qua video đó và pha comment mất hẳn). Rủi ro còn
    lại: (a) cửa sổ rất hẹp giữa `location.reload()` và lúc
    document bị huỷ — code chờ 30s qua `waitCancellable` để không
    chạy tiếp trong trang đang chết, nhưng nếu storage vẫn kịp ghi
    thì có thể thừa 1 journal `skipped` trước entry kết quả thật
    của lần chạy lại (chỉ nhiễu items của receipt, counters đếm
    theo success nên không sai số); (b) reload tốn thêm ~30–45s
    ngân sách phiên (tải trang + chờ render + xin AI lại + chờ ô +
    proof) — đã chặn bằng điều kiện phiên còn > 90s; phiên ngắn
    (max_minutes nhỏ) sẽ ít khi reload; (c) nếu cả trang tải đầy đủ
    cũng không nạp simplebox (YouTube đổi cơ chế nạp comment) thì
    kết cục vẫn `skipped` như cũ — khi đó phải soi DOM live lại
    thay vì tăng số lần reload.

## 6. Ngoài phạm vi lát 4

Upload video, community post (việc riêng theo plan), comment trên
Shorts, like/comment hàng loạt ngoài phiên nuôi, subscribe hàng loạt
không trần, xem playlist/chế độ xem theo danh sách kênh chỉ định (nguồn
reengage riêng nếu Dũng yêu cầu), dislike (không bao giờ — nuôi nick
không dislike).
