# Module: Instagram (Slice 3 — port từ Auto Post MUT)

- Nguồn (chỉ đọc): `~/workspace/app-remake-team/jobs/auto-post-mut/work/content-scripts/instagram/`
- Đích: `~/workspace/auto-vjp/modules/instagram/`
- Cách port: `cp` nguyên khối, KHÔNG sửa nội dung 4 file.
- Ngày kiểm tra: 2026-11-04

## 1. Trạng thái copy

| File | Dòng | Kích thước | MD5 (nguồn = đích) |
|---|---|---|---|
| `automator.js` | 722 | 31,863 B | `d95b043f8808eaf033439b18590b4811` |
| `interaction.js` | 257 | 14,898 B | `e42cf63705db89fdbd3a2eb854d7356f` |
| `affiliate-commenter.js` | 187 | 9,787 B | `44725386fa19b91e7560df78f59a97a0` |
| `accounts-scanner.js` | 134 | 5,740 B | `0e7848050c9738e1b85b902e69d0d2c0` |

MD5 của bản copy khớp 100% với nguồn cho cả 4 file — copy nguyên vẹn.

## 2. `node --check`

| File | Kết quả |
|---|---|
| `automator.js` | OK |
| `interaction.js` | OK |
| `affiliate-commenter.js` | OK |
| `accounts-scanner.js` | OK |

Cả 4 file pass cú pháp. Lưu ý: `node --check` chỉ kiểm tra cú pháp, không kiểm tra dependency runtime (xem mục 6).

## 3. Chuỗi cấm — kết quả grep + phân loại

Các chuỗi đã grep (exact): `mut.vn`, `claim-next`, `api_token`, `api_base`, `MUT_SEND_TOKEN`, `mut-bridge`, `clients2.google`, `14.225`

**Kết quả: 0 hit cho cả 8 chuỗi, trên cả 4 file.**

| Chuỗi cấm | Hit |
|---|---|
| `mut.vn` | — không có |
| `claim-next` | — không có |
| `api_token` | — không có |
| `api_base` | — không có |
| `MUT_SEND_TOKEN` | — không có |
| `mut-bridge` | — không có |
| `clients2.google` | — không có |
| `14.225` | — không có |

### Hit gần giống (grep mở rộng `mutvn` / `MUT`, case-insensitive) — phân loại (b) VÔ HẠI

Đây KHÔNG phải các chuỗi cấm ở trên; liệt kê để minh bạch vì có tiền tố `mutvn`:

| # | File:dòng | Nội dung | Phân loại |
|---|---|---|---|
| 1 | `automator.js:360` | `const quoteText = post.post_content \|\| post.content \|\| post.title \|\| 'MUTVN Quote';` | (b) Vô hại — chỉ là text fallback cho quote image, không phải URL/endpoint/token. Giữ nguyên. |
| 2 | `automator.js:362` | `await chrome.storage.local.get(['mutvn_quote_ratio', 'mutvn_quote_theme'])` | (b) Vô hại — tên key `chrome.storage.local` local có tiền tố `mutvn`. Giữ nguyên. |
| 3 | `automator.js:363` | `storedConfig.mutvn_quote_ratio \|\| '3:4'` | (b) Vô hại — đọc key local ở dòng 362. Giữ nguyên. |
| 4 | `automator.js:364` | `storedConfig.mutvn_quote_theme \|\| 'dark_indigo'` | (b) Vô hại — đọc key local ở dòng 362. Giữ nguyên. |

**Phân loại (a) — URL/endpoint/token server thật: KHÔNG CÓ hit nào thuộc loại này.**

Ghi chú bổ sung (không thuộc danh sách cấm, không tự sửa): các biến cờ chống inject trùng mang tiền tố `mut` trên `window` — `window.mutInstagramInteractionInjected` (`interaction.js:2-3,117,120-121`), `window.mutIgAffiliateCommenterInjected` / `...TaskId` / `...StartedAt` (`affiliate-commenter.js:2-3,9,14-15`) — đều là biến local trong trang, không phải server/token. Vô hại, giữ nguyên.

## 4. `getURL` / `chrome.runtime.getURL`

**Không có hit nào** trong cả 4 file.

→ Module này không cần khai báo thêm `web_accessible_resources` cho tài nguyên tự load qua `getURL`.

## 5. Giao diện của module (interface)

### 5.1 Entry point theo loại task

| Loại task | Entry point |
|---|---|
| `post` | `automator.js` (media VIDEO = luồng Reels — xem §7.2) |
| `story` | `story.js` (MỚI 2.7.0 — xem §7.1) |
| `reply` | `interaction.js` |
| `affiliate` | `affiliate-commenter.js` |
| `scan_account` | `accounts-scanner.js` |

Cả 4 file đều là script chạy ngay khi được inject (IIFE / top-level), không có `chrome.runtime.onMessage` listener nào (grep `onMessage`: 0 hit). Cơ chế chống inject trùng:

- `automator.js:3-6` — cờ `window.moigioi_injected_ig`
- `interaction.js:2-3` — cờ `window.mutInstagramInteractionInjected`
- `affiliate-commenter.js:2-3` — cờ `window.mutIgAffiliateCommenterInjected`
- `accounts-scanner.js` — không có cờ; IIFE chạy 1 lần mỗi lần inject.

### 5.2 Storage keys (`chrome.storage.local`)

Đọc (get):

| Key | File:dòng | Ghi chú |
|---|---|---|
| `currentProcessingPost` | `automator.js:340` | Bài đang xử lý cho task `post`; không có → script dừng. |
| `mutvn_quote_ratio` | `automator.js:362` (dùng ở :363) | Mặc định `'3:4'` nếu thiếu. Key local, xem phân loại (b) ở mục 3. |
| `mutvn_quote_theme` | `automator.js:362` (dùng ở :364) | Mặc định `'dark_indigo'` nếu thiếu. Key local, xem phân loại (b) ở mục 3. |
| `currentCommentReplyTask_instagram` | `interaction.js:114` | Task reply; script kiểm tra thêm `task.platform === 'instagram'`. |
| `currentAffiliateCommentTask_instagram` | `affiliate-commenter.js:6` | Task affiliate; script kiểm tra thêm `task.platform === 'instagram'`. |

Ghi (set):

| Key | File:dòng | Ghi chú |
|---|---|---|
| `lastStatus` | `automator.js:16` | `chrome.storage.local.set({ lastStatus: msg })` trong hàm log/trạng thái. |

`accounts-scanner.js` không dùng `chrome.storage` — nó đọc context từ global (xem mục 6).

### 5.3 Message actions gửi đi (`chrome.runtime.sendMessage`)

`automator.js`:

| Action | File:dòng |
|---|---|
| `mediaFetchStart` | `automator.js:60` (qua helper `send()` định nghĩa ở :58) |
| `mediaFetchChunk` | `automator.js:65` |
| `mediaFetchEnd` | `automator.js:72` |
| `postCompleted` | `automator.js:706-707` |
| `postFailed` | `automator.js:719` |

`interaction.js`:

| Action | File:dòng |
|---|---|
| `commentReplyProgress` | `interaction.js:111` |
| `commentReplyDone` | `interaction.js:112` |
| `automationLog` | `interaction.js:123-124` (event: `platform: 'instagram'`, job `'Tương tác'`) |

`affiliate-commenter.js`:

| Action | File:dòng |
|---|---|
| `automationLog` | `affiliate-commenter.js:16-17` (event: `platform: 'instagram'`, job `'Gắn link'`) |
| `affiliateCommentProgress` | `affiliate-commenter.js:20-21` |
| `affiliateCommentDone` | `affiliate-commenter.js:25-26` |

`accounts-scanner.js` — KHÔNG gửi trực tiếp qua `chrome.runtime.sendMessage`:

| Action | File:dòng | Cách gửi |
|---|---|---|
| `socialAccountsScannerResult` | `accounts-scanner.js:115` (thành công), `:128` (lỗi) | Qua `scanUtils.sendDiscovery(scanContext, { action: 'socialAccountsScannerResult', type: 'discovery', accounts: [...] })` — xem phụ thuộc lạ ở mục 6. |

## 6. Phụ thuộc lạ / cần lưu ý khi ghép lõi (chỉ báo cáo, chưa sửa code)

1. **`accounts-scanner.js` phụ thuộc global do bên inject cung cấp** — `accounts-scanner.js:3-4`:
   ```js
   const scanContext = globalThis.__accountScanContext;
   const scanUtils = globalThis.accountScanUtils;
   ```
   File này không tự chứa `accountScanUtils`/`sendDiscovery`. Nếu inject độc lập mà không có script lõi MUT đặt sẵn 2 global này, bước gửi kết quả (`scanUtils.sendDiscovery(...)` ở :115/:128) sẽ lỗi. Đây là phụ thuộc lạ quan trọng nhất của lát này — bên ghép lõi (Slice 2 contract) phải cung cấp hoặc thay thế 2 global này.
2. **`automator.js` cần handler phía background cho media fetch** — các action `mediaFetchStart` / `mediaFetchChunk` / `mediaFetchEnd` (`automator.js:60,65,72`) giả định background có listener tương ứng để tải media theo chunk (480 KB/chunk) rồi ghép thành data URL. Background của fork phải implement/route 3 action này, nếu không tính năng tải media của task `post` sẽ trả `null`.
3. **Ảnh fallback từ domain ngoài (không nằm trong danh sách cấm)** — `automator.js:370`: `images = ['https://moigioi.pages.dev/default-preview.png'];` Chỉ là ảnh preview mặc định khi bài không có ảnh; không phải endpoint server MUT, không kèm token. Ghi nhận để cân nhắc khi đóng gói nội bộ.
4. **`accounts-scanner.js` gọi API nội bộ của chính Instagram** — `accounts-scanner.js:25`: `fetch('/api/v1/accounts/edit/web_form_data/', { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } })` — fetch cùng origin trên instagram.com để lấy username đang đăng nhập, không phải server tác giả.
5. Không file nào đọc cookie, `fb_dtsg`, token đăng nhập, hay gửi dữ liệu ra server ngoài (ngoài 2 điểm 3–4 ở trên).

## 7. Bổ sung 2.7.0 — Story + Reels + AI (`ai_prompt`)

### 7.1 Story — `story.js` (type MỚI `story`)

- Contract: `instagram/story` → `[CANONICAL, modules/instagram/story.js]`, startUrl = `https://www.instagram.com`, timeout mặc định = post (1.200.000 ms qua `TASK_METADATA.story`). Script tự chứa, đọc canonical run trực tiếp (canonical chỉ map legacy key cho post/reply/affiliate), báo kết quả bằng 2 action riêng `storyCompleted`/`storyFailed` (kernel results deliver type `story`).
- Luồng: kiểm tra đăng nhập → nạp 1 media đầu của task (ảnh hoặc video, qua `mediaFetch*` của kernel như automator) → mở trình tạo story qua 3 đường (ô "Tin của bạn"/"Your story" ở khay story — chỉ bấm khi nhãn khớp chính xác → route `/stories/create/` — cờ `triedStoryRoute` trong phase chặn lặp sau tải lại → menu Tạo (+) → mục Tin/Story), đường nào cũng phải cho ra **dialog story đã xác minh** (có tín hiệu story, không mang dấu hiệu đăng bài — xem §7.4) → nạp file bằng DataTransfer + native setter vào input file **chỉ nằm trong dialog story đó** → editor sẵn sàng khi hàng nút chia sẻ xuất hiện (neo: nút "Bạn thân"/"Close friends" chỉ có ở editor story) → bấm **"Tin của bạn"/"Your story"** (không bấm Bạn thân — sai khán giả) → ghi phase `proving` vào storage key `avjpIgStoryPhase` rồi điều hướng sang profile; bản inject mới trên profile chỉ chạy proof (cờ `window.__avjpIgStoryInjected` chống chạy trùng trong cùng document, phase chống chạy lại sau điều hướng).
- PROOF: trên profile, bấm avatar mở story viewer → thấy item story (quét timestamp tối đa 5 item: item mới ≤59 phút = đạt; chỉ toàn item cũ ≥1 giờ = fail) → `result_url` = URL profile. Dự phòng yếu: viewer không mở được nhưng avatar có vòng story (canvas ring / nhãn story) → vẫn chốt success với ghi chú proof trong log.
- Lỗi (prefix trong message): `session_expired` (trang login), `story_create_not_found` (không mở được trình tạo story THẬT ở bất kỳ đường nào / bề mặt hoá ra là editor bài viết — huỷ ngay để tránh đăng nhầm / không thấy input file trong dialog story), `media_load_failed` (thiếu media hoặc tải lỗi), `story_editor_not_ready` (editor story thật đã mở nhưng hàng nút chia sẻ không hiện hoặc nút bị khoá quá lâu), `story_proof_failed`. Mọi vòng chờ đều có deadline; timeout tổng theo `defaultTimeoutMs('post')`.

### 7.2 Reels — tận dụng `automator.js`, KHÔNG viết module mới

Bản port sẵn đã có khung đăng video: nạp file → Next → caption → Share → chờ xác nhận, và text xác nhận đã gồm "your reel has been shared / thước phim của bạn đã được chia sẻ" — tức biến thể UI tự vào editor Reels vốn đã chạy được. 2.7.0 chỉ cộng phần còn thiếu cho task `post` có media VIDEO:

- Chọn Reel tường minh: trong menu Tạo, ưu tiên mục Reel/Thước phim trước mục Bài viết (không thấy mục Reel thì đi đường Bài viết như cũ); sau khi nạp file và ở đầu mỗi vòng Next/Share, `chooseReelIfAsked()` bấm phía Reel **chỉ khi** cùng một dialog/menu có cả lựa chọn Post lẫn Reel dạng bấm được (tránh bấm nhầm tab ở editor), có cờ chống bấm lặp.
- Caption hiệu dụng = `post_content || content` (trước đây chỉ `post_content`).
- PROOF: trước khi mở composer, chụp baseline tập link `/reel/` trên lưới profile bằng `fetch` cùng origin tới `/<username>/reels/` (credentials include); sau khi IG xác nhận đã chia sẻ, poll fetch-parse tối đa ~60s tìm link `/reel/` **mới** so với baseline → `result_url` = link reel đó. Không đọc được link mới → giữ `result_url` = URL profile như hành vi cũ + log cảnh báo "proof yếu". **Không điều hướng tab sang /reels/** để proof: automator là bản port nguyên khối, chuyển trang sẽ bị inject lại và có nguy cơ đăng trùng.

### 7.3 AI — field tuỳ chọn `ai_prompt` (cả Story lẫn Reels)

- Chỉ kích hoạt khi task có `ai_prompt`; không có → hành vi y như trước, không gọi AI.
- Đường gọi: content script gửi action `getNurtureAiComment` (kernel results.js) — cùng cơ chế họ nuôi: ưu tiên API lõi `getPageAiConfig` + `callConfiguredText` (cấu hình 9router, model `boss` đã đấu sẵn), dự phòng aitab. Prompt gửi đi = `ai_prompt` + nội dung task (`content`/`post_content`, cắt 1000 ký tự) làm chất liệu + câu lệnh định dạng đầu ra.
- Deadline riêng cho lời gọi AI: **70 giây** (dưới trần 75s) bằng `Promise.race` phía content script — AI treo/lỗi không treo phiên đăng.
- Reels: text AI trả về (đã làm sạch markdown/ngoặc kép bao ngoài) trở thành **caption đăng**, thay caption gốc. AI lỗi/timeout/trả rỗng → dùng caption gốc + receipt `details = ai_fallback`.
- Story: text AI phải là **1 câu ngắn ≤60 ký tự** (prompt ép định dạng + code cắt cứng 60 ký tự, lấy dòng đầu). Trước khi bấm chia sẻ, module chèn câu này lên story bằng công cụ text (Aa) của editor: tìm nút công cụ theo nhãn EN/VI/"Aa" → ô nhập (textarea/input/contenteditable lớn nhất) → gõ → bấm Xong/Done → chờ hàng nút chia sẻ quay lại. Chèn fail ở bất kỳ bước nào → **vẫn đăng story trơn**, receipt `details` cộng `ai_overlay_failed`, không fail phiên. AI lỗi → chữ chèn = content gốc cắt 60 ký tự (nếu có) + `details = ai_fallback` (có thể đồng thời gặp `ai_overlay_failed`).
- Ghi details end-to-end: content script gửi `details` trong `storyCompleted`/`postCompleted` → `results.js` chuyển vào outbox → receipt có trường `details` → manage (Nhật ký) hiển thị trong cột chi tiết. Mã có thể gặp: `ai_used`, `ai_fallback`, `ai_overlay_failed`.
- Manage: 2 nút mẫu "Đăng Story Instagram (task mẫu)" / "Đăng Reels Instagram (task mẫu)" đều để sẵn `ai_prompt` mẫu; form Viết bài + Lịch trình có ô "Prompt AI (tuỳ chọn)" và type `story` (chỉ Instagram).

### 7.4 Bằng chứng DOM live — vòng vá selector 1 (2026-11-05)

Probe DOM live trên nuc (profile công nhân `langlehoaanhdao`, IG web desktop, UI **EN**) — kết quả ÂM TÍNH cho trình tạo story, và đây là selector thật đã verify:

- **Nút Tạo** ở rail trái: `svg[aria-label="New post"]` trong thẻ `<a>` (text "New postCreate"). Bấm vào mở **thẳng dialog đăng bài**: `[role="dialog"]` với `aria-label="Create new post"`, text "Drag photos and videos here / Select from computer", 1 input file `accept="image/avif,image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime"`. **Không có menu chọn loại, không có mục Story.** Sau khi nạp file: dialog `aria-label="Crop"` + nút "Next"; bước tiếp là trang `/create/style/` với tiêu đề "New Photo Post" (bộ lọc ảnh Gingham/Juno/Lark/Ludwig/Moon/Normal/Perpetua/Reyes/Slumber, nút Expand/Rotate, tab Filter/Edit, nút Next). → Mọi bề mặt "Crop"/"Edit"/"Create new post"/"New Photo Post" = editor BÀI VIẾT, phải tránh xa (đây là gốc rễ fail `story_editor_not_ready` của vòng live 2.7.0: bản cũ khớp nhầm dialog bài viết vì nó có input file).
- **Khay story** đầu feed: các ô là `<a href="/<username>/">` avatar 92×92 của người khác; **không có ô "Your story"/"Tin của bạn"** của nick mình, không canvas ring, không nút "+". Bấm ô = sang profile người đó.
- **Route**: `/stories/create/` → redirect về `/create/` (profile của user tên "create"); `/stories/` → trang lỗi "Go back to Instagram.".
- **Profile của mình**: avatar là `<button>` 120×120 (img `alt="Add a profile photo"` — nick chưa đặt ảnh đại diện; click không mở dialog), trên trang có 2 input file ẩn `accept="image/jpeg"` và `accept="image/jpeg,image/png"` = input **đổi ảnh đại diện** (nạp file vào là đổi avatar / bị kéo vào editor bài viết). Ô "New" có svg "Plus icon" là tạo **Highlight**. Không có nút thêm story.
- Hệ quả đã áp vào `story.js` (#85): dialog story phải có tín hiệu story dương tính (`create story|your story|tin của bạn|close friends|bạn thân` trong aria/text) và không mang dấu hiệu đăng bài; input file chỉ lấy trong dialog story đã xác minh (xoá fallback toàn trang); vòng chờ editor rà bề mặt đăng bài mỗi vòng và huỷ ngay `story_create_not_found` (đã bỏ bấm Next trung gian — editor story thật không có Next). Trên bề mặt hiện tại task story sẽ fail nhanh + đúng mã `story_create_not_found`; editor story thật (hàng nút "Tin của bạn"/"Bạn thân", công cụ text Aa, ô nhập chữ) **vẫn chưa từng xuất hiện** nên các selector đó vẫn là suy đoán — chỉ kích hoạt được khi IG mở trình tạo story cho tài khoản/layout khác. Đăng story IG thật cần đường ngoài DOM desktop (vd giả lập mobile) — ngoài phạm vi vòng vá.
- Reels: điểm chưa chắc chắn là biến thể IG hỏi Post/Reel (có/không, hiện ở bước nào) và HTML của trang `/<username>/reels/` khi fetch-parse (nội dung render phía client có thể không chứa link reel trong HTML thô — khi đó proof rơi về URL profile như cũ, không fail oan).

### 7.5 Tự chữa selector (2.9.0)

- Contract cộng `modules/shared/healer.js` (HEALER) vào trước module ở spec `post` và `story`: `[CANONICAL, HEALER, automator.js]` / `[CANONICAL, HEALER, story.js]`. Kiến trúc + spec format + giới hạn: `modules/shared/HEALER.md`.
- Điểm đấu: story.js — `ig.story.createEntry` (nút Tạo, sau finder gốc; chốt âm tính `isPostComposerSurface` giữ nguyên và chạy trước khi file được nạp), `ig.story.shareRow` (nút "Tin của bạn" — sau 10s finder gốc mù thì heal 1 lần, `root` = dialog story đã xác minh), `ig.story.textTool` (công cụ Aa). automator.js — `ig.post.createBtn`, `ig.post.shareBtn` (heal 1 lần khi vào giai đoạn share mà finder gốc mù; phần tử heal được tin là nút Share dù nhãn khác regex cũ).
- Kỷ luật học: ứng viên qua AI gom vào `healPendingProven`, chỉ flush `markProven` tại điểm proof thật của module (`complete()` của story — persist qua phase `proving`; điểm `postCompleted` của automator). Heal vắng/fail → hành vi y như trước.
- Healthscan Instagram dùng chung key `ig.post.createBtn` (neo nút Tạo) — xem HEALER.md.
