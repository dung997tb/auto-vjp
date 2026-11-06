# MODULE — threads-nurture (Auto vjp 2.3.1)

_Adapter nuôi Threads của tầng module Auto vjp — lát 2 của plan nuôi đa nền
tảng (`jobs/fb-auto-tool/plan-nuoi-da-nen-tang.md` §3). Mọi cơ chế quản lý/
đồng bộ/pacing/proof nằm ở **lõi dùng chung** `modules/nurture-core/`
(xem `modules/nurture-core/README.md` — bản đồ cơ chế ↔ bản gốc FB Auto Tool);
file này chỉ ghi phần riêng của Threads. Khuôn theo `instagram-nurture` (lát 1)._

## 1. File & đường inject

| File | Vai trò |
|---|---|
| `adapter.js` (viết mới) | Toàn bộ adapter: đọc canonical task → cấu hình → vòng lặp FEED → like/follow/reply AI qua lõi → `nurtureProgress`/`nurtureDone` |

Inject (khai ở `kernel/contract.js`, platform threads / type `nurture`,
`frameTopOnly: true`):
`canonical-task-storage.js → nurture-core.js → adapter.js`.
Tab mở ở `https://www.threads.net` (`contract.startUrl` — nhánh nurture của
threads; các spec nurture của instagram/tiktok giữ nguyên).

Khác lát 1 ở bề mặt: adapter chạy **trên feed** (For You/Following ở trang
chủ threads.net), KHÔNG điều hướng vào trang bài đơn — đây là chủ đích sau
khi module reply cũ của MUT fail trên trang bài thật (xem §5.1).

## 2. Payload task

```json
{ "platform": "threads", "type": "nurture",
  "like_enabled": true, "follow_enabled": false, "comment_enabled": true,
  "like_pct": 80, "comment_pct": 60, "follow_pct": 10,
  "max_actions": 8, "max_minutes": 10, "timeout_ms": 1500000,
  "comment_templates": ["Bài chia sẻ hay quá, cảm ơn bạn nhiều nhé!", "..."],
  "prompt": "...", "ai_provider": "gemini",
  "comment_gap_min": 45, "comment_gap_max": 120 }
```

- Mặc định khi task không ghi: like BẬT, comment(reply) BẬT, follow TẮT.
  Threads không có hành động save — counters/journal vẫn giữ trường save=0
  cho đồng nhất định dạng với các nền tảng khác.
- Tỉ lệ `*_pct` + `prompt` + `comment_gap_*` trong task thắng cấu hình sync
  (`threadsNurture<Field>`); xem nurture-core README §1.
- Nút "Nuôi Threads (phiên mẫu)" ở manage.html dùng đúng payload mẫu trên
  KÈM `comment_templates` (3 mẫu tiếng Việt trung tính dùng chung với nút
  Instagram trong manage.js — `NURTURE_COMMENT_TEMPLATES`): khi AI tab chưa
  sẵn, reply vẫn gửi bằng mẫu và kiểm chứng được bằng proof; journal ghi rõ
  `source: 'ai' | 'template'`.

## 3. Hành vi phiên

1. Đọc canonical run; không đúng platform/type → thoát im lặng (inject nhầm an toàn).
2. `startRun` persist state (họ key `threadsNurture*`) TRƯỚC khi đụng trang;
   bị inject lại với cùng RunId + Active → resume, không reset Done*.
   `claimOwner` ghi `threadsNurtureOwnerTabId` qua `nurtureOwnerPing`.
3. Kiểm cổng: URL login/checkpoint/challenge, form login, hoặc text xác
   minh/suspended → `nurtureDone failed / session_expired` ngay, không lách.
4. Vòng lặp tới khi hết `max_minutes`, đủ `max_actions`, bị dừng (Active=false
   hoặc RunId đổi → `failed / user_cancelled`), hoặc 3 vòng cuộn không có
   hành động nào mới:
   - Đơn vị = 1 bài trong feed: khối `[data-pressable-container="true"]` có
     chứa link permalink `/@user/post/<code>` VÀ có nút Like của chính bài
     theo finder mới (§3, mục proof); dự phòng: leo từ link `/post/` lên
     khối chứa nút Like (tối đa 8 tầng). Bài không có nút Like hợp lệ thì
     không được đưa vào phiên.
   - key đích = post code trong permalink; thiếu permalink thì hash tác
     giả+time+nội dung (đường yếu, như IG).
   - Bỏ qua: sponsored ("Sponsored"/"Được tài trợ" — quét cả phần tử lá đứng
     riêng), đích trong `Dead`, đích đã chạm trần (core `canDo` theo ngày +
     theo đích + history comment trọn đời).
   - Dwell 3–7s (cấu hình dwellMin/dwellMax của core) sau scrollIntoView,
     rồi tung tỉ lệ like → comment → follow; giữa 2 hành động cùng bài nghỉ
     `PostMin..PostMax`; giữa 2 bài nghỉ `DelayMin..DelayMax`.
   - Nút của **bài lồng** (quote/repost kèm bài khác) bị loại khỏi đường
     like/reply của bài chính (`inNestedBlock`) để khỏi tương tác nhầm bài.
5. Finder nút hành động + proof từng hành động (không proof = uncertain,
   KHÔNG làm lại):
   - Finder dùng chung `findActionBtn(container, kind)` cho like/unlike/
     reply/repost/share/follow/following, khớp theo thứ tự: (a) svg
     descendant có `<title>` đúng tên hành động (`Like`/`Reply`/`Repost`/
     `Share`), (b) `aria-label` khớp tuyệt đối, (c) textContent của nút bắt
     đầu bằng tên hành động (dạng `Like753`, `Reply7` trên DOM live). Mọi
     đường đều loại nút thuộc khối quote lồng trong bài chính
     (`inNestedBlock`).
   - like: chụp chữ ký TRƯỚC khi bấm (biến `--x-color` trong style của svg,
     tiền tố path `d`, số đếm exact nếu đọc được — chỉ số nguyên, dạng rút
     gọn K/M không tính exact). Trong tối đa 3s sau bấm, THÀNH CÔNG nếu bất
     kỳ tín hiệu nào đổi: nút lật `Unlike`, `aria-pressed="true"`, màu
     `--x-color` rời khỏi charcoal, path svg đổi, hoặc số đếm exact tăng
     đúng 1. Chốt an toàn: nút đã mang màu khác charcoal/`aria-pressed`
     từ trước thì coi là đã like, không bấm (tránh unlike nhầm).
   - follow: bấm nút `Follow` qua finder mới; proof = nút lật
     `Following`/`Đang theo dõi` trong 3s. Task mẫu vẫn mặc định TẮT follow.
   - reply: lõi xin AI (prompt + nội dung bài; lỗi → mẫu trong task, đánh
     dấu `source: 'template'`; gần trùng reply đã có/caption → bỏ) → bấm nút
     Reply qua finder mới ngay trên feed → chờ ô soạn thảo (dialog hoặc
     inline, `contenteditable [role="textbox"]`) → gõ (execCommand
     insertText, dự phòng gõ từng ký tự cho editor Lexical) → nút
     `Post`/`Đăng` (dự phòng Ctrl+Enter) → **proof trong 10s**: chữ ký reply
     xuất hiện ở phần tử lá ngoài ô soạn thảo (trong khối bài hoặc toàn
     trang), HOẶC composer dạng dialog đã đóng + số reply của bài tăng.
     Sau mỗi lần gửi (cả uncertain) đều đặt `NextAllowedAt`.
6. `nurtureProgress` mỗi 30s + sau mỗi proof; kết phiên: `nurtureDone` kèm
   items từ `threadsNurtureJournal` của phiên. Map trạng thái như IG: ≥1
   proof → `success`; 0 proof nhưng có uncertain → `uncertain`; 0 tất cả →
   `failed / no_eligible_target`.

## 4. Key storage adapter dùng

Toàn bộ qua nurture-core với prefix **`threadsNurture`**:
sync: `threadsNurtureLikePerDay/CommentPerDay/FollowPerDay/LikePerTarget/.../
LikePct/CommentPct/FollowPct/DelayMin/DelayMax/PostMin/PostMax/DwellMin/
DwellMax/CommentGapMin/CommentGapMax/DeadDays/Prompt`.
local: `threadsNurtureActive/RunId/OwnerTabId/Config/TaskId/Index/Cursor/
Cycle/DoneLike/DoneComment/DoneSave/DoneFollow/DoneUncertain/Skipped/
LikeHistory/CommentHistory/SaveHistory/FollowHistory/Dead/Counters/Journal/
Status/NextAllowedAt`.
Không đụng key kernel (`autovjp.*`), key lõi FB, key `instagramNurture*`,
hay key `tf_*` của TikTok.

## 5. Selector theo bằng chứng DOM live (threads.com, UI tiếng Anh, 2026-11-05) + rủi ro còn lại

Bằng chứng đã soi trên profile công nhân trước bản vá 2.3.1:

- Khối bài = `[data-pressable-container]`, có link `/post/` — đúng neo
  adapter đang dùng.
- Nút hành động **không có** `aria-label` Like/Reply. Nhận diện chắc nhất:
  svg trong nút có `<title>Like</title>` / `<title>Reply</title>`..., và
  textContent của nút dạng `Like753`, `Reply7`, `Repost17`, `Share`,
  `Follow`, `More`.
- Nút Like chưa bấm: svg `fill="currentColor"`, style chứa
  `--x-color: var(--barcelona-charcoal-icon)`, path bắt đầu
  `M16.5 2c-1.666 0-3.278.707-4.5 1.937...`. Không có `aria-pressed`.
- Bài có quote lồng mang 2 bộ nút (bài ngoài + bài quote) trong cùng 1
  container — `inNestedBlock` áp cho cả finder mới.
- Phiên live đầu (finder aria-label cũ): xem 7, bỏ qua 7, like 0 — finder
  không thấy nút Like nên mọi bài bị coi là không hợp lệ. Đó là lý do vá
  2.3.1: finder theo title svg + proof Like đa tín hiệu (§3).

Rủi ro còn lại:

1. **Title svg là neo chính nhưng vẫn là quy ước của bản web hiện tại**: nếu
   Threads bỏ `<title>` trong svg hoặc đổi tên hành động, finder rơi về
   aria-label/text — hai đường này trên DOM live hiện tại yếu hơn (aria
   không có, text dính số đếm đã xử lý nhưng dễ nhiễu hơn).
2. **Proof màu `--x-color`**: tên biến/giá trị charcoal là đặc thù bản
   Barcelona hiện tại; nếu Threads đổi biến màu, proof còn path + số đếm
   exact + nút lật Unlike gánh — mất cả ba thì like rơi uncertain (an
   toàn, không đếm bừa).
3. **Số đếm exact**: chỉ khi nút hiện số nguyên thật. Bài hiện dạng rút
   gọn (K/M) hoặc ẩn số thì tín hiệu này vô hiệu — chủ đích, vì số rút gọn
   không chứng minh được +1.
4. **Path svg**: adapter so 80 ký tự đầu của path đầu tiên; nếu Threads
   chèn path trang trí lên trước icon tim ở một biến thể khác, tín hiệu
   này có thể nhiễu — khi đó còn màu/số đếm gánh.
5. **Composer reply**: phần composer/proof reply giữ nguyên từ 2.3.0 —
   chưa chắc bấm Reply trên feed mở dialog hay nở inline ở bản web hiện
   tại; editor Lexical nuốt insertText thì reply rơi
   `not_found`/uncertain. Điểm cần soi khi test live tiếp.
6. **Nút gửi `Post`/`Đăng`**: nếu composer đổi nhãn nút hoặc disable theo
   điều kiện chưa rõ, đường dự phòng Ctrl+Enter có thể không được chấp
   nhận → uncertain.
7. **key đích khi thiếu permalink**: hash theo tác giả+thời gian+nội
   dung — bài render lại có thể đổi hash nhẹ; history chống trùng khi đó
   yếu đi (chấp nhận như lát 1, permalink là đường chính).
8. Virtualized feed: bài ngoài viewport bị huỷ DOM — adapter chỉ xử lý
   bài đang render + cuộn dần; `processed` là Set trong trang, inject lại
   sẽ quét lại từ đầu nhưng history/dead của core chặn tương tác trùng.

## 6. Ngoài phạm vi lát 2

Repost/quote (plan §3 để lát sau), tương tác trên trang bài đơn và trang
profile theo danh sách (nguồn reengage riêng nếu Dũng yêu cầu), story,
follow hàng loạt, share.
