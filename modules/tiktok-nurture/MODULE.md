# MODULE — tiktok-nurture (Auto vjp 2.1.0)

_Module nuôi TikTok: port engine **TikTok Farmer v1.2.10** (code của chính Dũng, đã kiểm chứng
live trên nuc) thành module của tầng module Auto vjp. Nguồn chỉ-đọc khi port:
`~/workspace/app-remake-team/jobs/fb-auto-tool/farmer-src/tiktok-farmer/`.
Đặc tả: `jobs/fb-auto-tool/plan-nuoi-tiktok.md`. Hợp đồng chung: `modules/MODULE-CONTRACT.md`._

## 1. Bản đồ port

| File trong module | Từ Farmer gốc | Mức độ |
|---|---|---|
| `selectors.js` | `selectors.js` (551 dòng) | **Nguyên bản 100%** — chỉ thêm 1 dòng comment đầu file |
| `engine.js` | `engine.js` (583 dòng) | **Nguyên bản 100%** — chỉ thêm 1 dòng comment đầu file |
| `modules.js` | `modules.js` (1.467 dòng) | Gần nguyên bản — 1 lệch duy nhất, xem §2 |
| `content.js` | `content.js` (123 dòng) | Viết lại phần nối — `TF.getLoginState` + dựng `TF.Engine` giữ nguyên bản, phần còn lại thay, xem §2 |
| `adapter.js` | Không có ở gốc | **Viết mới hoàn toàn** — thay vai trò background.js/UI của Farmer |
| — | `background.js` (501 dòng) | **Không port nguyên**: vai trò của nó tách làm 2 — (a) chủ storage `tf_*`: tái tạo trong `content.js` (sink trong trang); (b) scheduler/UI/approvals: bỏ (kernel Auto vjp + manage.html thay thế) |
| — | `defaults.js` | Không port file: hằng `TF_DEFAULT_CONFIG` được sao vào `adapter.js`; mảng WF mẫu `TF_DEFAULT_WORKFLOWS` bỏ (chỉ phục vụ UI Farmer, và có WF gọi `doc_comment` — ngoài phạm vi đợt 1) |
| — | `options.html/js`, `popup.html/js` (~2.400 dòng UI) | Không port — manage.html của Auto vjp thay thế |

Thứ tự inject (khớp manifest gốc của Farmer + canonical trước + adapter cuối), khai ở
`kernel/contract.js` mục tiktok/`nurture`, `frameTopOnly: true`:
`canonical-task-storage.js → selectors.js → modules.js → engine.js → content.js → adapter.js`.
Tab mở ở `https://www.tiktok.com/foryou` (`contract.startUrl`).

## 2. Mọi chỗ lệch khỏi Farmer gốc và vì sao

1. **modules.js — note của `xem_video` thêm hậu tố `_skip<N>`** (2 dòng return, cả nhánh
   video thường và post ảnh): engine gốc không xuất số post quảng cáo/LIVE đã lướt qua
   ra ngoài module (chỉ giữ ở `ctx.skippedNonVideo` trong trang). Adapter cần con số này
   cho biên lai kernel nên ghi vào note — journal/proofs đọc lại đúng note đó, không đổi
   hành vi xem/lướt chút nào.
2. **content.js — `send()` đi vào sink trong trang thay vì `chrome.runtime.sendMessage`
   về background**: Auto vjp không có background Farmer. Sink (`tfHandleMessage`)
   tái tạo đúng ngữ nghĩa ghi storage của background gốc cho 8 loại message từ content
   (TF_LOG, TF_JOURNAL, TF_COUNTER, TF_PROGRESS, TF_NAV_RESUME, TF_NAV_ABORT,
   TF_CAPTCHA, TF_STOPPED), nối tiếp bằng promise chain như `enqueueStore` của gốc.
   Hai khác biệt có chủ đích: (a) không có **tab affinity** — kernel chỉ chạy 1 tab
   managed tại 1 thời điểm nên không cần; (b) **không chain workflow** sau TF_STOPPED —
   workflow adapter dựng không khai chain nào (onSuccess/onFail/onFinish đều null).
3. **content.js — bỏ listener `TF_CMD_*` và bỏ khối tự-resume `tryResumeNav`**:
   không còn ai gửi lệnh TF_CMD; việc start/resume do adapter quyết theo canonical task.
4. **adapter.js — `TF.getLoginState` chờ tối đa 15–20s** trước khi kết luận chưa đăng
   nhập (bản gốc kết luận tức thì ở đường start; bản gốc cũng đã phải thêm retry tương
   tự cho đường resume sau bài học 1.0.3 — adapter áp cho cả hai đường).

## 3. Adapter dịch payload thế nào

Task (phẳng, theo contract): `{platform:'tiktok', type:'nurture', watch_count,
like_enabled, save_enabled, follow_enabled, max_minutes, timeout_ms?}`.

- **Cấu hình engine**: `TF_DEFAULT_CONFIG` (sao trong adapter) ← merge `tf_config_v1`
  đã lưu (chuẩn hoá string→object + bù caps/activeHours thiếu, đúng bài học Farmer
  v1.2.3) ← payload thắng: `caps.maxMinPerSession = max_minutes`,
  `caps.maxCommentPerDay = 0` (chặn comment ở cả tầng cap), `followEnabled = follow_enabled`.
- **Workflow dựng mới** (id `wf_avjp_nurture`, `maxRuntimeMin = max_minutes + 10`):
  `kiem_login → mo_fyp → loop(times=watch_count, maxMinutes=max_minutes)[ xem_video →
  prob(likePct)% like_video? → prob(savePct)% save_video? → prob(followPct)% follow_creator?
  → luot_next ] → ghi_log`. Dấu `?` = chỉ có khi cờ tương ứng trong payload bật; tỉ lệ lấy
  từ `config.ratios` (mặc định 12/3/3 như Farmer). Các bước tương tác để **`optional: true`**:
  1 lần verify hụt (vd `save_unverified`) chỉ bị bỏ qua, không giết cả phiên.
- **Trần ngày + giai đoạn (stage) của Farmer giữ nguyên**: `tf_stage_v1` (tạo mới với
  `firstSeenDate` = hôm nay nếu chưa có) — ngày 1–3 engine tự khoá like/save/follow ở
  tầng Supervisor dù payload bật. Đây là kỷ luật thi hành của Farmer, không phải lịch.
- **Tiến độ**: listener nhận TF_COUNTER/TF_PROGRESS từ engine → gửi
  `{action:'nurtureProgress'}` mỗi ≥15s + interval 30s → kernel chạm `lastActiveAt`
  (watchdog 5 phút không hoạt động không cắt oan phiên dài) và lưu `nurture_counters`.
  `timeout_ms` của task do nơi tạo task đặt (nút mẫu ở manage đặt 25 phút cho phiên
  10 phút); metadata mặc định của type `nurture` ở kernel là 60 phút.
- **Kết quả**: khi engine báo TF_STOPPED, adapter đọc journal + counters authoritative
  từ `tf_runstate_v1`, tính counters **của riêng phiên** (trừ mốc `startCounters` đã
  lưu trong link lúc start — counters của engine là tổng ngày) rồi gửi
  `{action:'nurtureDone', status, failure_code, resultMessage, items: proofs}`:
  - proofs = từng entry journal module đã chốt: `watch` (kèm note `watched_Xs_skipN`),
    `like`, `save`, `follow`; tổng skip ads/live cộng từ hậu tố `_skip<N>`.
  - outcome `success` → receipt `success`; `unknown` → `uncertain` (không đoán,
    không chạy lại — đúng kỷ luật gốc); `captcha` hoặc journal có `kiem_login` fail
    → `failed`/`session_expired`; `deadline_exceeded` → `failed`/`task_timeout`;
    còn lại → `failed`/`execution_error`.
  - Chưa đăng nhập / thấy captcha ngay lúc mở phiên → `nurtureDone` failed
    `session_expired` ngay, không start engine.

## 4. Resume sau điều hướng

Engine tự điều hướng (vd `mo_fyp` khi chưa ở /foryou) → trang cũ chết, kernel inject
lại cả bộ ở trang mới → adapter nhận ra phiên của mình qua key liên kết
`tf_avjp_link_v1` `{taskId, kernelRunId, engineRunId, wallStart, startCounters, done}`:

- Checkpoint điều hướng (`status:'navigating'`, `checkpoint.navResume`) còn tươi
  <10 phút → start tiếp với `resumeFromStep = checkpoint.stepIndex` + `resumeStack`
  nguyên khối (đúng cơ chế gốc).
- Chỉ có checkpoint tiến độ (`status:'running'`, checkpoint của progress) và phiên
  <2 giờ → resume từ `stepIndex + 1` (checkpoint tiến độ là bước VỪA XONG, khác
  checkpoint điều hướng là bước KẾ TIẾP — lệch 1 này là chủ đích).
- Checkpoint điều hướng quá 10 phút → failed `execution_error` (`nav_resume_stale`),
  không treo chờ watchdog.
- `link.done = true` được ghi trước khi gửi `nurtureDone` — inject lại sau khi xong
  không chạy lại phiên (kernel cũng đã xoá canonical run khi ghi receipt).

## 5. Kỷ luật giữ nguyên (không được nới khi sửa module này)

- Phân loại post của bản 1.2.10 nằm ngay trong `xem_video`: đủ 4 nút (like + comment +
  favorite + share trên rail) = video thường; `live-like-icon`/khung LIVE = live;
  rail thiếu nút = quảng cáo. Gặp quảng cáo/LIVE thì tự lướt qua có kiểm chứng post
  đổi thật, tối đa 5 lần rồi fail rõ lý do `only_ads_or_live_skipped_5`. Trang chi
  tiết và bề mặt lạ không lọc.
- Xem: video ≤10s xem hết; video dài xem theo % nhưng trần **90s**; post ảnh xem 3–6s.
- `luot_next`: chỉ báo thành công khi **chữ ký post thật sự đổi** (nút next →
  ArrowDown → wheel, kiểm chứng từng cách); không đổi → `next_no_change`.
- Verify-by-proof: **save** chỉ tính khi số lượt Favorites tăng đúng 1 (nếu click làm
  giảm = vốn đã lưu, click lại khôi phục); like kiểm tra `aria-pressed` trước khi bấm
  để không bấm oan thành bỏ like. (Đối soát: bản 1.2.10 gốc, like chưa verify bằng số
  đếm — giữ đúng như gốc, không tự nâng cấp trong đợt port này.)
- Captcha: engine quét mỗi 1s + trước mỗi bước — thấy captcha là `stopAll('captcha')`
  ngay, adapter map sang receipt failed `session_expired`; **không bao giờ tự giải**.
- Click: chỉ sự kiện pointer/mouse **tổng hợp trên phần tử DOM** (`TF.clickEl`) —
  tọa độ sự kiện lấy từ khung của chính phần tử, **tuyệt đối không click theo tọa độ
  màn hình/cửa sổ**.
- Trần Supervisor theo ngày + theo giai đoạn tuổi nick (stage) như gốc.

## 6. LOẠI hẳn khỏi đường chạy đợt 1

Registry `TF.MODULES` vẫn chứa đủ module như gốc (port nguyên khối), nhưng **workflow
adapter dựng không bao giờ tham chiếu** các module sau — không có đường chạy nào tới
được chúng trong đợt 1:

- `comment_duyet` — comment trên phiên web nuc đang bị gắn cờ captcha (chốt của Dũng);
  kèm theo `caps.maxCommentPerDay = 0` ở tầng cấu hình để Supervisor cũng chặn.
- `xem_live` — lỗi treo đã biết của Farmer (vào LIVE không kết thúc được).
- `doc_comment` — chỉ đọc comment, để đợt sau (cũng là module mà WF mẫu gốc
  `wf_train_ngach` gọi — WF mẫu không được port nên không có đường gọi lén).

Ngoài ra không dùng trong đợt 1 (không cấm, chỉ chưa dùng): `dang_video_duyet`,
`chon_video_hang_doi`, `unfollow_duyet`, `follow_danh_sach`, các module tìm kiếm/
điều hướng phụ (`tim_keyword`, `mo_following`...).

## 7. Giới hạn lịch thuộc tầng điều phối — worker KHÔNG tự chặn giờ

Theo điều chỉnh đặc tả của Dũng (2026-11-04, ghi đè plan): **adapter/worker không
kiểm tra giờ hoạt động** — không có check 08:00–23:00, không có receipt
`outside_active_hours`. Bản công nhân chỉ nhận việc được claim và thi hành; giờ
hoạt động (và về sau là các trần theo lịch) là quyết định của **tầng điều phối giao
việc** (trang điều hướng job, làm ở giai đoạn sau). Trường `activeHours` vẫn tồn tại
trong cấu hình vì engine/cấu hình Farmer mang theo, nhưng **không cổng nào trong
module đọc nó để chặn chạy**. Các chặn còn lại trong worker đều là an toàn THI HÀNH
(captcha, trần tác động theo ngày của Supervisor, deadline phiên do chính task đặt)
— không phải lịch.

## 8. Key storage module dùng

Toàn bộ giữ tiền tố của Farmer (không đụng key của kernel `autovjp.*` / `lastStatus`
ngoài contract, không đụng key lõi FB):

| Key | Vai trò |
|---|---|
| `tf_runstate_v1` | Trạng thái phiên engine: status, wfStack, checkpoint (tiến độ + điều hướng), journal (≤300 entry), journalHistory, countersToday, startedAt |
| `tf_counters_v1` | Bộ đếm theo ngày `{yyyy-mm-dd: {watch, like, save, follow, comment, minutes, sessions, captchaHits}}` — nguồn cho trần Supervisor |
| `tf_logs_v1` | Log engine (≤500 dòng) |
| `tf_config_v1` | Cấu hình Farmer nếu đã có từ thời extension độc lập — adapter đọc + chuẩn hoá, không ghi đè |
| `tf_stage_v1` | Giai đoạn tuổi nick `{firstSeenDate, overrideDay}` — adapter tạo nếu chưa có |
| `tf_approvals_v1` | Chỉ các module duyệt (không dùng đợt 1) đọc qua `TF.storeGet` |
| `tf_avjp_link_v1` | **Key mới của adapter**: liên kết task kernel ↔ phiên engine + mốc counters đầu phiên + cờ `done` |

## 9. Rủi ro còn lại

- Chưa chạy runtime trong đợt build này (theo phân công — điều phối kiểm chứng ở
  lab/nuc): selector DOM TikTok hiện tại có thể đã lệch so với bản 1.2.10.
- `chrome.storage.local` trong content script bị canonical-task-storage bọc: các key
  `tf_*` không thuộc legacy descriptor nên đi thẳng native — đã đối chiếu code, vẫn
  cần xác nhận ở vòng lab (đặc biệt promise/callback hai dạng đều được dùng).
- Phiên nuôi dài chạy trong tab managed: tab bị Chrome discard/`onRemoved` giữa
  chừng → kernel ghi receipt failed theo vòng đời chung (không resume ngang) —
  hành vi đúng contract, nhưng phiên dài nên giữ tab active (runner đã đặt
  `autoDiscardable: false`).
- Counters phiên tính bằng hiệu số tổng ngày: nếu một phiên Farmer-ngoài (không
  còn tồn tại sau khi bản độc lập nghỉ hưu) hoặc phiên nurture khác ghi counter
  giữa chừng thì số của phiên bị nhiễu — kernel chạy singleton 1 task nên thực tế
  không xảy ra trong Auto vjp.
