# Tự chữa selector — HEALER (2.9.0)

Cơ chế dùng chung cho tầng module khi DOM của nền tảng thay đổi làm
selector gốc gãy (yêu cầu của Dũng 2026-11-05 12:45, plan
`plan-dang-story-reels-shorts.md` mục "Bổ sung 12:45"). Ba lớp:

1. **Finder đa ứng viên** — mỗi điểm neo có 1 key + danh sách builtins
   xếp hạng; thử lần lượt, không chết vì 1 selector.
2. **Chụp DOM khi fail** — builtins bó tay thì `AVJP.heal` tự chụp
   snapshot DOM rút gọn của trang hiện tại và gửi cho AI.
3. **AI sửa + HỌC selector** — AI gợi ý spec mới → module thử ngay
   trong phiên → hành động dùng phần tử đó đạt **proof thật** của
   module → mới `markProven` để lưu vào
   `autovjp.learnedSelectors`; lần sau spec đã học được thử **trước**
   builtins. Đoán chưa proof **không bao giờ** được lưu.

## Thành phần

| Phần | File | Vai trò |
|---|---|---|
| Helper phía trang | `modules/shared/healer.js` | `AVJP.heal.locate()` / `markProven()` / `captureSnapshot()` — contract nạp TRƯỚC module ở các spec liên quan |
| Lõi SW | `modules/kernel/heal.js` | `AVJP.healCore`: lưu/đọc/xoá selector đã học + `healSuggest` (prompt → AI → parse spec) |
| Đăng ký action | `modules/kernel/results.js` | `healGetLearned` / `healSuggest` / `healMarkProven` (exec), `healthscanCompleted` / `healthscanFailed` (exec), `autovjp.healForget` / `autovjp.healForgetAll` (manage), `listState` trả kèm `learnedSelectors` |
| Lưu trữ | `modules/kernel/store.js` | key `autovjp.learnedSelectors` = `{"<platform>:<key>": {spec, at, hits}}` |
| Quét sức khoẻ | `modules/shared/healthscan.js` | task type `healthscan` — chỉ locate các neo mẫu, không tương tác thật |
| Giao diện | `manage.html` / `manage.js` | nút "Quét sức khoẻ selector (task mẫu)" + mục "Selector đã học" (xem/xoá từng mục/xoá hết) |

## Spec format (thống nhất 2 phía, validate cả trang lẫn SW)

```json
{"by": "aria" | "text" | "svgTitle" | "css", "value": "…", "tag": "button?"}
```

- `aria`: khớp `aria-label` sau chuẩn hoá (trim, gộp khoảng trắng, thường hoá). Nếu phần tử khớp là `<svg>` thì lấy tổ tiên bấm được gần nhất (`a, button, [role=button], [role=menuitem]`).
- `text`: khớp chính xác text hiển thị sau chuẩn hoá (ưu tiên phần tử sâu nhất không có con cùng khớp); dự phòng khớp tiền tố khi value ≥ 3 ký tự.
- `svgTitle`: text trong `<title>` của svg (hoặc aria-label của svg) — lấy tổ tiên bấm được gần nhất.
- `css`: `querySelectorAll` trực tiếp. **Giới hạn**: value ≤ 120 ký tự, cấm `:has(`, cấm xpath (kể cả chuỗi bắt đầu bằng `/`).
- `tag` (tuỳ chọn): `^[a-z][a-z0-9-]*$`, ≤ 30 ký tự — lọc theo tagName.
- Phần tử chỉ được nhận khi **hiển thị** (rect > 0, display/visibility ổn) và **không disabled** (`disabled` / `aria-disabled="true"`).

## API phía trang — `AVJP.heal`

```js
const found = await AVJP.heal.locate({
  platform: 'instagram',          // bắt buộc — namespace của selector đã học
  key: 'ig.post.createBtn',       // bắt buộc — định danh điểm neo
  intent: 'Nút Tạo bài viết mới…',// mô tả cho AI khi phải gợi ý
  builtins: [ {by:'aria', value:'New post'}, … ],
  root: dialogEl,                 // tuỳ chọn — giới hạn phạm vi tìm (mặc định document)
  timeoutMs: 30000                // tuỳ chọn — trần tổng, tối đa 45000
});
// found = { el, spec, via: 'learned' | 'builtin' | 'ai' } | null
```

Thứ tự thử: **learned → builtins → AI**. AI stage: chụp snapshot
(tối đa ~120 phần tử tương tác: tag/role/aria/text rút gọn/svg
title/data-e2e/id, tổng ≤ 12KB) → SW `healSuggest` dựng prompt chặt
(chỉ trả JSON mảng spec, tối đa 5 ứng viên) → gọi AI qua đúng đường
`getNurtureAiComment` đang dùng (API lõi `getPageAiConfig` +
`callConfiguredText`, dự phòng aitab), deadline 70s, parse phòng thủ
(bóc fence, cắt mảng JSON đầu tiên, validate từng spec). AI
lỗi/sai format → mảng rỗng → `locate` trả null, module fail như cũ.
Toàn bộ `locate` có deadline tổng ≤ 45s (tham số `timeoutMs` bị kẹp
về trần này) — heal không bao giờ treo module.

```js
AVJP.heal.markProven({ platform, key, spec });
```

Module gọi **sau khi proof thật đạt** (story hiện trên profile,
comment hiện trong danh sách, bài đăng hoàn tất…). Chỉ spec
`via === 'ai'` mới cần lưu; SW validate lại format trước khi ghi và
tăng `hits` nếu cùng spec được proof lần nữa.

## Cách 1 module được đấu mẫu (instagram/story.js)

1. Contract cộng `modules/shared/healer.js` vào files TRƯỚC module:
   `instagram/story → [CANONICAL, HEALER, story.js]`.
2. Module giữ nguyên finder gốc; khi finder gốc trả null mới gọi
   `healLocate({key, intent, builtins, root?, timeoutMs?})`.
3. Ứng viên qua AI được gom vào `healPendingProven`; `complete()`
   (điểm proof thật) flush bằng `AVJP.heal.markProven(...)`. Story
   persist danh sách chờ này qua phase `proving` vì proof chạy ở
   document mới sau điều hướng.
4. **Chốt an toàn riêng của story giữ nguyên và chạy trước AI**: bề
   mặt editor bài viết (`isPostComposerSurface`) → huỷ ngay
   `story_create_not_found`; gợi ý AI cho hàng nút chia sẻ bị giới
   hạn `root` = dialog story đã xác minh. Heal định vị được nút Tạo
   cũng không thể biến task story thành đăng bài.

Các điểm đã đấu ở 2.9.0:

| Key | Module | Điểm neo |
|---|---|---|
| `ig.story.createEntry` | instagram/story.js | Nút Tạo mở trình tạo (sau finder gốc) |
| `ig.story.shareRow` | instagram/story.js | Nút "Tin của bạn" trong editor story (sau 10s mù, root = dialog story) |
| `ig.story.textTool` | instagram/story.js | Công cụ text Aa (ghi proven khi chèn thành công + story proof) |
| `ig.post.createBtn` | instagram/automator.js | Nút Tạo luồng post/reels |
| `ig.post.shareBtn` | instagram/automator.js | Nút Share bước cuối (thử heal 1 lần khi vào giai đoạn share mà finder gốc mù) |
| `yt.reply.commentBox` | youtube/interaction.js | Ô soạn comment (sau vòng chờ 30s; proven sau proof chữ ký comment) |
| `th.feed.likeBtn`, `tt.fyp.likeBtn` | shared/healthscan.js | Chỉ dùng cho healthscan |

## Healthscan (task type `healthscan`)

- Nền tảng: instagram / youtube / threads / tiktok (x = null).
  `startUrl`: IG trang chủ · YouTube 1 trang watch mẫu
  (`watch?v=aqz-KE-bpKQ`) · Threads trang chủ · TikTok `/foryou`.
- Neo mẫu: IG nút Tạo (`ig.post.createBtn`) · YouTube ô comment
  (`yt.reply.commentBox`, có bước cuộn tức thời tới #comments như
  interaction 2.6.2) · Threads nút Like bài đầu (`th.feed.likeBtn`) ·
  TikTok nút like FYP (`tt.fyp.likeBtn`).
- **Chỉ locate, không bấm/không tương tác.** Receipt type
  `healthscan`, `items`: `{key, found_via, spec}` từng neo.
- Healthscan **không** markProven: locate trần không phải proof hành
  động; spec AI tìm được chỉ nằm trong receipt để người xem. Muốn
  thành selector đã học, module thật phải dùng nó và đạt proof.

## Giới hạn an toàn

- AI chỉ được gợi ý **spec định vị** theo format trên — không sinh
  code, không có đường thực thi nào từ output của AI ngoài
  `querySelectorAll`/khớp text trong trang.
- Snapshot cắt cứng (≤120 phần tử, ≤12KB, text/aria cắt 60 ký tự) —
  không gửi HTML thô/cả trang.
- `markProven` là cổng duy nhất ghi `autovjp.learnedSelectors`, và
  SW validate lại spec (type/value/tag/độ dài/cấm `:has`+xpath).
- Mọi chặng có deadline: locate ≤ 45s tổng, healSuggest ≤ 70s phía
  SW (trang tự bỏ cuộc theo ngân sách locate của nó), healGetLearned
  ≤ 5s. Heal tắt/vắng (không nạp được file, SW không trả lời) →
  module chạy đúng hành vi cũ.
