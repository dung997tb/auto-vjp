# MODULE — x-nurture (Auto vjp 2.4.0)

_Adapter nuôi X (Twitter) của tầng module Auto vjp — lát 3 của plan nuôi đa
nền tảng (`jobs/fb-auto-tool/plan-nuoi-da-nen-tang.md` §3). Mọi cơ chế quản
lý/đồng bộ/pacing/proof nằm ở **lõi dùng chung** `modules/nurture-core/`
(xem `modules/nurture-core/README.md` — bản đồ cơ chế ↔ bản gốc FB Auto
Tool); file này chỉ ghi phần riêng của X. Khuôn theo `threads-nurture`
(lát 2, đã vá selector theo DOM live ở 2.3.1)._

## 1. File & đường inject

| File | Vai trò |
|---|---|
| `adapter.js` (viết mới) | Toàn bộ adapter: đọc canonical task → cấu hình → vòng lặp HOME timeline → like/bookmark/follow/reply AI qua lõi → `nurtureProgress`/`nurtureDone` |

Inject (khai ở `kernel/contract.js`, platform x / type `nurture`,
`frameTopOnly: true`):
`canonical-task-storage.js → nurture-core.js → adapter.js`.
Tab mở ở `https://x.com/home` (`contract.startUrl` — nhánh nurture của x;
các spec nurture của instagram/threads/tiktok giữ nguyên).

## 2. Payload task

```json
{ "platform": "x", "type": "nurture",
  "like_enabled": true, "bookmark_enabled": false,
  "follow_enabled": false, "comment_enabled": true,
  "like_pct": 80, "comment_pct": 60,
  "max_actions": 8, "max_minutes": 10, "timeout_ms": 1500000,
  "comment_templates": ["Bài chia sẻ hay quá, cảm ơn bạn nhiều nhé!", "..."],
  "prompt": "...", "ai_provider": "gemini",
  "comment_gap_min": 45, "comment_gap_max": 120 }
```

- Mặc định khi task không ghi: like BẬT, reply (kênh `comment` của lõi)
  BẬT, bookmark + follow TẮT.
- **Ánh xạ bookmark → `save` của lõi**: bookmark là hành động lưu bài nên
  dùng chung trần/history/counters của `save` (`SaveHistory`, `DoneSave`,
  counters `save`). Adapter chấp nhận cả field riêng của X
  (`bookmark_enabled`, `bookmark_pct`) lẫn field lõi (`save_enabled`,
  `save_pct`); journal ghi action `save` kèm note `proof bookmark: ...` để
  không lẫn với một hành động save khác.
- Tỉ lệ `*_pct` + `prompt` + `comment_gap_*` trong task thắng cấu hình sync
  (`xNurture<Field>`); xem nurture-core README §1. Prompt mặc định dùng
  nguyên của lõi (đã siết ở #74, adapter không chép/sửa prompt).
- Nút "Nuôi X (phiên mẫu)" ở manage.html dùng đúng payload mẫu trên KÈM
  `comment_templates` (3 mẫu tiếng Việt trung tính dùng chung với IG/Threads
  trong manage.js — `NURTURE_COMMENT_TEMPLATES`): khi AI chưa sẵn, reply
  vẫn gửi bằng mẫu và kiểm chứng được bằng proof; journal ghi rõ
  `source: 'ai' | 'template'`.

## 3. Hành vi phiên

1. Đọc canonical run; không đúng platform/type → thoát im lặng (inject
   nhầm an toàn).
2. `startRun` persist state (họ key `xNurture*`) TRƯỚC khi đụng trang; bị
   inject lại với cùng RunId + Active → resume, không reset Done*.
   `claimOwner` ghi `xNurtureOwnerTabId` qua `nurtureOwnerPing`.
3. Kiểm cổng ngay đầu phiên và trong vòng lặp: URL login/onboarding/
   account-access, form login, captcha/Arkose/reCAPTCHA, text khoá tài
   khoản/xác minh, hoặc màn hình giới thiệu chưa đăng nhập → `nurtureDone
   failed / session_expired` ngay, không lách, không bấm mù.
   **Kỳ vọng lần test thật đầu tiên: `session_expired` sạch** — profile
   công nhân hiện chưa đăng nhập X (Dũng tự đăng nhập, trợ lý không nhập
   mật khẩu). Đó là hành vi đúng của cổng, không phải lỗi adapter.
4. Vòng lặp tới khi hết `max_minutes`, đủ `max_actions`, bị dừng
   (Active=false hoặc RunId đổi → `failed / user_cancelled`), hoặc 3 vòng
   cuộn không có hành động nào mới:
   - Đơn vị = 1 tweet: `article[data-testid="tweet"]` đang render và có
     nút `like`/`unlike`/`reply`. key đích = status id lấy từ link trạng
     thái chứa `<time>` (link của chính tweet, tránh link tweet quote);
     thiếu status id thì hash tác giả+time+nội dung (đường yếu).
   - Bỏ qua: promoted/ads (nhãn lá `Promoted`/`Quảng cáo`/`Được quảng
     bá`/`Ad`), đích trong `Dead`, đích đã chạm trần (core `canDo` theo
     ngày + theo đích + history comment trọn đời).
   - Dwell 3–7s (dwellMin/dwellMax của core) sau scrollIntoView, rồi tung
     tỉ lệ like → bookmark → follow → **reply để cuối** (mở dialog/điều
     hướng có thể xáo trộn DOM của bài). Giữa 2 hành động cùng bài nghỉ
     `PostMin..PostMax`; giữa 2 bài nghỉ `DelayMin..DelayMax`.
   - React của X hay thay node article sau khi bấm: mọi lần đọc proof đều
     tìm lại article theo status id (`currentArticle`) thay vì tin node cũ.
5. Proof từng hành động (không proof = uncertain, KHÔNG làm lại):
   - like: bấm `button[data-testid="like"]`; proof = testid lật sang
     `unlike` trong tối đa 3s. Đã có `unlike` từ đầu → `already`.
   - bookmark: bấm `button[data-testid="bookmark"]`; proof = testid lật
     sang `removeBookmark` trong tối đa 3s. Đã có `removeBookmark` →
     `already`. Ghi proof vào kênh `save` của lõi.
   - follow: tìm nút theo testid `<userId>-follow`/`-unfollow` trước, dự
     phòng text/aria-label `Follow @...`/`Following @...`; proof = trạng
     thái lật sang following trong tối đa 3s. Trên Home, nút follow
     thường KHÔNG nằm trong article (chỉ có ở profile/hover card) nên
     `not_found` là kết quả bình thường — không ghi Dead cho follow.
   - reply: lõi xin AI (prompt + nội dung `[data-testid="tweetText"]`;
     lỗi → mẫu trong task, đánh dấu `source: 'template'`; gần trùng thân
     bài → bỏ) → bấm `button[data-testid="reply"]` → chờ composer
     (`[data-testid^="tweetTextarea_"]`, dialog hoặc inline) → gõ
     (execCommand insertText; dự phòng dán qua ClipboardEvent rồi gõ từng
     ký tự cho editor DraftJS) → nút `tweetButton`/`tweetButtonInline`
     → **proof trong 10s**: chữ ký reply xuất hiện trong một
     `[data-testid="tweetText"]` đã render, HOẶC composer dạng dialog đã
     đóng + số reply của tweet gốc tăng (chỉ tin khi số đếm ít nhất một
     phía là exact — dạng rút gọn K/M/B không làm bằng chứng một mình).
     Chỉ dialog đóng hoặc chỉ URL đổi thì không tính proof.
   Sau mỗi lần gửi reply (cả uncertain) đều đặt `NextAllowedAt`.
6. `nurtureProgress` mỗi 30s + sau mỗi proof; kết phiên: `nurtureDone`
   kèm items từ `xNurtureJournal` của phiên. Map trạng thái như các lát
   trước: ≥1 proof → `success`; 0 proof nhưng có uncertain →
   `uncertain`; bị chặn đăng nhập → `failed / session_expired`; 0 tất cả
   → `failed / no_eligible_target`.

## 4. Key storage adapter dùng

Toàn bộ qua nurture-core với prefix **`xNurture`**:
sync: `xNurtureLikePerDay/CommentPerDay/SavePerDay/FollowPerDay/
LikePerTarget/.../LikePct/SavePct/CommentPct/FollowPct/DelayMin/DelayMax/
PostMin/PostMax/DwellMin/DwellMax/CommentGapMin/CommentGapMax/DeadDays/
Prompt`.
local: `xNurtureActive/RunId/OwnerTabId/Config/TaskId/Index/Cursor/Cycle/
DoneLike/DoneComment/DoneSave/DoneFollow/DoneUncertain/Skipped/
LikeHistory/CommentHistory/SaveHistory/FollowHistory/Dead/Counters/
Journal/Status/NextAllowedAt`.
Không đụng key kernel (`autovjp.*`), key lõi FB, key `instagramNurture*`/
`threadsNurture*`, hay key `tf_*` của TikTok.

## 5. Selector & rủi ro (chưa có bằng chứng DOM live của X trong lát build này)

Adapter bám `data-testid` — bề mặt định danh ổn định nhất của X ở thời
điểm viết (`article[data-testid="tweet"]`, action bar `reply`/`retweet`/
`like`/`unlike`/`bookmark`/`removeBookmark`, composer `tweetTextarea_*`,
nút gửi `tweetButton`/`tweetButtonInline`). Lát build này **không deploy,
không chạy live**; các điểm dưới đây là rủi ro phải soi ở lần test thật
đầu tiên sau khi X được đăng nhập:

1. **X đổi DOM/testid theo đợt rollout là rủi ro chính**: nếu action bar
   hoặc composer đổi testid, adapter rơi `not_found`/uncertain (an toàn,
   không bấm mù) — sửa đúng các hàm `byTestId`/`findComposer`/
   `findSendButton` ở đầu adapter.
2. **Timeline ảo hoá**: article ngoài viewport bị huỷ/tái sử dụng node;
   adapter chỉ xử lý bài đang render, cuộn dần, và tìm lại article theo
   status id khi đọc proof. Nếu X tái sử dụng node cho tweet khác giữa
   chừng, key/status id là lớp bảo vệ chính.
3. **Tweet quote lồng**: link `<time>` được ưu tiên để lấy status id của
   tweet ngoài, nhưng một biến thể quote không có time link ở tweet ngoài
   có thể làm key rơi về link quote hoặc hash dự phòng — history chống
   trùng khi đó yếu hơn.
4. **Số reply rút gọn**: X hay hiện số dạng K/M hoặc ẩn số. Proof reply
   bằng số đếm chỉ nhận khi ít nhất một phía exact; các trường hợp còn
   lại phải dựa vào chữ ký reply render ra — trên Home, reply vừa gửi thường
   không render ngay dưới tweet gốc, nên reply có thể rơi `uncertain`
   dù đã gửi thật. Đây là đánh đổi có chủ đích của kỷ luật proof (thà
   uncertain còn hơn đếm bừa/gửi lại trùng).
5. **Composer DraftJS**: execCommand/paste/gõ từng ký tự là 3 lớp dự
   phòng; nếu bản editor hiện tại không nhận cả ba, nút gửi không bật và
   adapter ghi `not_found` ở bước soạn — điểm cần soi DOM live đầu tiên
   khi reply fail.
6. **Follow trên Home**: như §3, nút follow tác giả thường không có
   trong article; follow chỉ thật sự có đất ở profile/hover card —
   nguồn follow riêng (nếu cần) là việc của lát sau, không nới selector
   mò trong lát này.
7. **Nhãn promoted**: quét phần tử lá theo 4 nhãn EN/VI; một bài có nội
   dung chứa đúng một phần tử lá ghi "Ad" có thể bị bỏ oan — thà bỏ oan
   còn hơn tương tác nhầm quảng cáo.
8. **Login wall biến thể mới**: cổng chặn dựa trên URL/form/text đã
   biết; nếu X đổi luồng onboarding, dấu hiệu dự phòng là "không có
   tweet nào + text mời đăng nhập". Ngược lại, feed rỗng tạm thời khi
   mạng chậm có thể bị đọc thành chưa đăng nhập nếu text marketing khớp
   — kiểm chứng ở lần test đầu bằng receipt + ảnh chụp.

## 6. Ngoài phạm vi lát 3

Repost/quote, share, xem media/video dài, follow từ profile/danh sách
(theo nguồn reengage riêng), reply trong trang chi tiết theo link đích
(họ reply cũ của module x phụ trách), đăng bài (module x/automator phụ
trách). Không deploy nuc, không chạy live trong lát build này.
