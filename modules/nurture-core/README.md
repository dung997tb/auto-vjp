# nurture-core — lõi nuôi dùng chung (Auto vjp 2.2.0)

_Lõi thi hành nuôi nick cho mọi nền tảng (hiện: instagram; tiếp theo: threads/x/youtube),
xây theo đúng **cơ chế quản lý + đồng bộ dữ liệu của bản gốc FB Auto Tool**
(`friendReengage.js` / `friendWarm.js` trong job `fb-auto-tool`). Đặc tả:
`jobs/fb-auto-tool/plan-nuoi-da-nen-tang.md`. Hợp đồng chung: `modules/MODULE-CONTRACT.md`._

File duy nhất: `nurture-core.js` — phơi `globalThis.AVJP.nurture`:
`createStore({prefix, defaults})`, `DEFAULT_PROMPT`, `CORE_DEFAULTS`, `util`
(sleep/rnd/clampInt/todayStr/normalizeText/commentSignature/isNearDuplicate).
Core **không chứa selector của nền tảng nào** — adapter truyền hooks/DOM vào.

## 1. Bản đồ cơ chế ↔ bản gốc

| Cơ chế | Bản gốc FB Auto Tool | nurture-core |
|---|---|---|
| Cấu hình user | `chrome.storage.sync`, key `friendReengage<Field>` / `friendWarm<Field>`, đọc bằng `getSyncCfg()` merge DEFAULTS | Giống hệt: sync key `<prefix><Field>` (vd `instagramNurtureLikePerDay`), `store.getSyncConfig()` merge `CORE_DEFAULTS` ← sync ← payload task (task thắng) |
| State run | local `friendReengageActive/RunId/OwnerTabId/Config/Index/DoneLike/DoneComment/DoneStory/Skipped/LikeHistory/CommentHistory/StoryHistory/DeadWalls/Cursor/Cycle/Status` | Cùng họ trường theo `<prefix>`: `Active/RunId/OwnerTabId/Config/TaskId/Index/Cursor/Cycle/DoneLike/DoneComment/DoneSave/DoneFollow/Skipped/LikeHistory/CommentHistory/SaveHistory/FollowHistory/Dead/Status` + `Counters/Journal/NextAllowedAt/DoneUncertain` (xem §3) |
| Persist trước điều hướng | friendWarm: "persist run TRƯỚC khi điều hướng, chỉ ownerTabId resume sau reload" | `store.startRun()` ghi Active/RunId/Config/TaskId + reset Done* + Status trước khi adapter đụng vào trang; adapter nhận ra phiên của mình qua RunId khi bị inject lại |
| Stop flag + runId | `alive(runId)` + `waitCancellable(ms, runId)` poll từng giây | Sao nguyên: `alive`, `waitCancellable` — mọi vòng chờ dài của adapter đều qua đây |
| Message không treo run | `sendCancellable(msg, runId, ms)`: race timeout + poll stop (chờ AI cũng dừng được) | Sao nguyên: `sendCancellable` — đường AI comment dùng nó (timeout 100s) |
| Owner tab | `friendWarmAmIOwner` hỏi background tab id của chính mình | Action kernel mới `nurtureOwnerPing` → `store.claimOwner()` ghi `<prefix>OwnerTabId` |
| Click ≠ success | Chỉ ghi history SAU proof FB; không proof = không đếm | `recordProof()` là đường DUY NHẤT ghi history + Done* + counters. Không proof → `recordUncertain()` (chỉ vào DoneUncertain/counters.uncertain), adapter **không gửi lại** |
| Trần ngày + trần/đích | like 25/ngày ≤2/bạn; comment 12/ngày ≤1/bạn (friendReengage DEFAULTS) | `canDo(action, targetKey, cfg)`: trần ngày từ Counters, trần/đích-hôm-nay + trần comment trọn đời từ History. Mặc định plan: like 25, comment **10** (plan §2, gốc là 12), save 20, follow 5 /ngày |
| History vĩnh viễn | LikeHistory/CommentHistory ghi vĩnh viễn, không tương tác trùng | History theo hành động, entry `{id, url, at, day, runId, note}`, giữ 5000 entry/hành động |
| Đích chết | DeadWalls (reengage, deadDays 90) / Dead + TTL 30 ngày (warm) | `Dead` dạng map `key -> {reason, at, expiresAt}`, `markDead/isDead`, TTL mặc định 30 ngày |
| Nhịp comment | feed.js: `aiNextAllowedAt` chặn comment liên tiếp | `NextAllowedAt` + `waitNextAllowed/setNextAllowed` (gap mặc định 45–120s) |
| Comment AI | Đọc bài → prompt `{postText}` → AI → nháp có chữ ký (`commentProofSig`), trùng gần nguyên văn comment đã có thì bỏ → gửi → chờ proof hiện thật (`UnifiedComment.sendProofDwell`) | `buildPrompt` (prompt mặc định phỏng friendWarm: <20 từ, nhắc 1 chi tiết cụ thể, cấm bịa tên/số liệu) → `requestAiComment` (message `getNurtureAiComment` → kernel aitab ChatGPT/Gemini) → `isNearDuplicate` (Jaccard ≥0.8 hoặc chứa nhau) → adapter gửi → `waitForProof(checkFn, {timeoutMs})` |
| Journal/status đồng nhất | Mỗi tính năng gốc có Status riêng | Thêm `<prefix>Journal` — MỘT định dạng cho mọi nền tảng: `{at, runId, platform, action, target, url, status, note, content?, source?}`, giữ 300 entry — trang quản lý về sau đọc đồng nhất (yêu cầu chốt 08:02 của Dũng) |
| Receipt về kernel | (gốc báo server) | Adapter gửi `nurtureProgress {taskId, platform, counters}` / `nurtureDone {taskId, platform, status, failure_code, resultMessage, items}` — kernel results.js xử lý chung, không gắn cứng nền tảng |

## 2. API của store (theo prefix)

```
getSyncConfig() -> cfg                startRun({runId, taskId, config})
getState() / setState(patch)          finishRun(statusText)
setStatus(text)                       claimOwner(runId) -> tabId|null
alive(runId) -> bool                  getCounters() / todayCounters() / bumpCounters(delta)
waitCancellable(ms, runId) -> bool    getHistory(action) / hasHistory(action, key)
sendCancellable(msg, runId, ms)       canDo(action, key, cfg) -> {ok, reason}
recordProof(action, {id,url,runId,note})   recordUncertain() / recordSkipped()
isDead(key) / markDead(key, reason, ttlDays)
journal(entry) / getJournal(runId)
waitNextAllowed(runId) / setNextAllowed(cfg)
buildPrompt(template, postText)
requestAiComment({postText, cfg, runId, provider}) -> {text}|{error}|{stopped}|{timeout}
waitForProof(checkFn, {timeoutMs=10000, intervalMs=400, runId}) -> value|null
```

Hành động chuẩn: `like | comment | save | follow` (map sang trường
`<Action>PerDay`, `<Action>PerTarget`, `<Action>History`, `Done<Action>`).

## 3. Chỗ lệch khỏi bản gốc (có chủ đích)

1. **Counters theo ngày** (`<prefix>Counters` = map `yyyy-mm-dd -> {like, comment, save, follow, uncertain, sessions}`):
   bản gốc suy đếm ngày từ history; lõi này giữ CẢ HAI — history vẫn là hồ sơ
   vĩnh viễn (nguồn cho trần/đích), counters là bộ đếm ngày O(1) cho trần ngày
   + `nurtureProgress`. Kiểu map theo ngày học từ `tf_counters_v1` của Farmer.
2. **commentPerDay mặc định 10** thay vì 12 của friendReengage — theo plan §2 đã duyệt.
3. **`<prefix>TaskId`** và **`<prefix>DoneUncertain`**: key phụ thêm để nối kernel
   (task ↔ run) và để báo cáo kỷ luật proof; họ key của gốc vốn cũng có key phụ
   theo tính năng (Source/ListUrl/Phase...), không phá quy ước.
4. **Đơn vị delay là giây** ở mọi trường (gốc trộn phút/giây theo ngữ cảnh);
   tên trường giữ nguyên (`DelayMin/DelayMax` giữa 2 đích, `PostMin/PostMax`
   giữa 2 hành động cùng đích).
5. Không có stage theo tuổi nick kiểu Farmer trong lõi này — trần ngày + trần
   phiên của task là cổng thi hành; giới hạn lịch thuộc tầng điều phối.

## 4. Ràng buộc khi viết adapter mới

- Chỉ dùng `recordProof` sau khi proof thật; uncertain không được "thử lại cho chắc".
- Mọi `sleep` dài phải là `waitCancellable` (trừ nhịp <2s trong thao tác DOM).
- Checkpoint/captcha/challenge → dừng phiên + `nurtureDone failed/session_expired`.
- Không tự kiểm tra giờ hoạt động trong worker (tầng điều phối lo — luật đã chốt).
