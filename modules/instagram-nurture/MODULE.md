# MODULE — instagram-nurture (Auto vjp 2.2.0)

_Adapter nuôi Instagram của tầng module Auto vjp — lát 1 của plan nuôi đa nền
tảng (`jobs/fb-auto-tool/plan-nuoi-da-nen-tang.md` §3). Mọi cơ chế quản lý/
đồng bộ/pacing/proof nằm ở **lõi dùng chung** `modules/nurture-core/`
(xem `modules/nurture-core/README.md` — bản đồ cơ chế ↔ bản gốc FB Auto Tool);
file này chỉ ghi phần riêng của Instagram._

## 1. File & đường inject

| File | Vai trò |
|---|---|
| `adapter.js` (viết mới) | Toàn bộ adapter: đọc canonical task → cấu hình → vòng lặp feed/reels → like/save/follow/comment AI qua lõi → `nurtureProgress`/`nurtureDone` |

Inject (khai ở `kernel/contract.js`, platform instagram / type `nurture`,
`frameTopOnly: true`):
`canonical-task-storage.js → nurture-core.js → adapter.js`.
Tab mở ở `https://www.instagram.com` (`contract.startUrl`).

## 2. Payload task

```json
{ "platform": "instagram", "type": "nurture",
  "like_enabled": true, "save_enabled": true, "follow_enabled": false, "comment_enabled": true,
  "like_pct": 80, "save_pct": 50, "comment_pct": 60, "follow_pct": 10,
  "max_actions": 8, "max_minutes": 10, "timeout_ms": 1500000,
  "comment_templates": ["..."], "prompt": "...", "ai_provider": "gemini",
  "comment_gap_min": 45, "comment_gap_max": 120 }
```

- Mặc định khi task không ghi: like BẬT, comment BẬT, save/follow TẮT.
- Tỉ lệ `*_pct` + `prompt` + `comment_gap_*` trong task thắng cấu hình sync
  (`instagramNurture<Field>`); xem nurture-core README §1.
- Nút "Nuôi Instagram (phiên mẫu)" ở manage.html dùng đúng payload mẫu trên
  (follow tắt — trần chặt, bật tay khi cần).

## 3. Hành vi phiên

1. Đọc canonical run; không đúng platform/type → thoát im lặng (inject nhầm an toàn).
2. `startRun` persist state (họ key `instagramNurture*`) TRƯỚC khi đụng trang;
   nếu bị inject lại với cùng RunId + Active → resume, không reset Done*.
   `claimOwner` ghi `instagramNurtureOwnerTabId` qua `nurtureOwnerPing`.
3. Kiểm cổng: URL/text challenge/checkpoint/suspended hoặc trang login →
   `nurtureDone failed / session_expired` ngay, không lách.
4. Vòng lặp tới khi hết `max_minutes`, đủ `max_actions`, bị dừng (Active=false
   hoặc RunId đổi → `failed / user_cancelled`), hoặc 3 vòng cuộn không có
   hành động nào mới:
   - Đơn vị = `<article>` đang hiện (feed); ở `/reels/` mà không có article thì
     lấy khối chứa `<video>` + thanh like (best-effort, xem §5).
   - key đích = shortcode trong link `/p/`/`/reel/`; thiếu thì hash tác giả+time+nội dung.
   - Bỏ qua: sponsored ("Sponsored"/"Được tài trợ" ở đầu bài), đích trong `Dead`,
     đích đã chạm trần (core `canDo` theo ngày + theo đích + history comment).
   - Dwell 3–7s (cấu hình) sau khi scrollIntoView, rồi tung tỉ lệ cho từng
     hành động theo thứ tự like → save → comment → follow; giữa 2 hành động
     cùng bài nghỉ `PostMin..PostMax`; giữa 2 bài nghỉ `DelayMin..DelayMax`.
5. Proof từng hành động (không proof = uncertain, KHÔNG làm lại):
   - like: svg `aria-label` lật `Like`→`Unlike` (VI: Thích→Bỏ thích) trong 3s.
   - save: svg lật `Save`→`Remove` (Lưu→Đã lưu/Bỏ lưu) trong 3s.
   - follow: nút `Follow`/`Theo dõi` lật `Following`/`Đang theo dõi` trong 3s.
   - comment: lõi xin AI (prompt + nội dung bài; lỗi → mẫu trong task, đánh dấu
     `source: 'template'`; gần trùng comment đã có/caption → bỏ) → gõ vào
     textarea (execCommand insertText, fallback native setter) → Enter hoặc nút
     `Post`/`Đăng` → chờ 10s thấy comment chứa chữ ký của mình trong bài.
     Sau mỗi lần gửi comment (cả uncertain) đều đặt `NextAllowedAt`.
6. `nurtureProgress` mỗi 30s + sau mỗi proof; kết phiên: `nurtureDone` kèm
   items lấy từ `instagramNurtureJournal` của phiên (action/target/status/note/
   content/source). Map trạng thái: có ≥1 proof → `success`; 0 proof nhưng có
   uncertain → `uncertain`; 0 tất cả → `failed / no_eligible_target`.

## 4. Key storage adapter dùng

Toàn bộ qua nurture-core với prefix **`instagramNurture`**:
sync: `instagramNurtureLikePerDay/CommentPerDay/SavePerDay/FollowPerDay/
LikePerTarget/.../LikePct/.../DelayMin/DelayMax/PostMin/PostMax/DwellMin/
DwellMax/CommentGapMin/CommentGapMax/DeadDays/Prompt`.
local: `instagramNurtureActive/RunId/OwnerTabId/Config/TaskId/Index/Cursor/
Cycle/DoneLike/DoneComment/DoneSave/DoneFollow/DoneUncertain/Skipped/
LikeHistory/CommentHistory/SaveHistory/FollowHistory/Dead/Counters/Journal/
Status/NextAllowedAt`.
Không đụng key kernel (`autovjp.*`), key lõi FB, hay key `tf_*` của TikTok.

## 5. Rủi ro selector (cần soi khi test thật — CHƯA chạy live trong lát build)

1. **Nhãn aria-label của svg** (`Like/Unlike/Save/Remove/Comment`, bản VI tương
   ứng) là neo proof chính — IG hay đổi nhãn theo locale/đợt A/B; lệch là mọi
   hành động rơi uncertain (an toàn nhưng vô dụng). Toàn bộ nhãn nằm ở object
   `L` đầu adapter.js — sửa đúng chỗ đó.
2. **`clickableOf`**: nút bấm thật là tổ tiên có `role="button"` của svg (leo
   tối đa 6 tầng) — nếu IG bọc thêm lớp, click có thể trúng div không có handler.
3. **Ô comment**: feed dùng `<textarea>` (aria/placeholder "Add a comment…" /
   "Thêm bình luận…"); một số biến thể IG dùng contenteditable — adapter hiện
   chỉ xử lý textarea, không thấy là `not_found` (bỏ qua, không lỗi phiên).
   Gõ bằng `execCommand('insertText')` — nếu React nuốt, fallback native
   setter + InputEvent; gửi bằng Enter (dispatch KeyboardEvent) hoặc nút Post.
4. **commentProof**: tìm phần tử lá trong `li/ul` chứa 60 ký tự đầu của chữ ký —
   comment của mình thường hiện ngay trong bài; nếu IG lazy-render ở panel
   riêng (đặc biệt bài mở dạng modal) sẽ uncertain oan.
5. **Reels**: DOM reels khác hẳn feed (không `<article>`); nhánh reels là
   best-effort (like/save/follow theo cùng nhãn svg; **comment trên reel bị bỏ**
   vì mở panel riêng). Cần 1 vòng soi DOM reels thật trước khi tin số liệu.
6. **key đích khi thiếu permalink**: hash theo tác giả+thời gian+nội dung —
   bài bị IG tái render có thể đổi hash nhẹ; history chống trùng khi đó yếu đi
   (chấp nhận ở lát 1, permalink là đường chính).
7. Virtualized feed: bài ngoài viewport bị IG huỷ DOM — adapter chỉ xử lý bài
   đang render + cuộn dần; `processed` là Set trong trang, inject lại sẽ quét
   lại từ đầu nhưng history/dead của core chặn tương tác trùng.

## 6. Ngoài phạm vi lát 1

Story (xem/tương tác), DM/chat (không bao giờ sờ — theo gốc), follow hàng loạt,
comment trên reel, trang profile người khác theo danh sách (nguồn reengage
kiểu friendReengage sẽ là lát riêng nếu Dũng yêu cầu).
