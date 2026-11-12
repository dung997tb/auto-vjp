/* Auto vjp — module contract data (ported from MUT client task-contract, exports stripped). */
(()=>{
// Ported from MUT core/task-contract.js (CONTRACT_VERSION 2) — see MODULE-CONTRACT.md
// Dọn dẹp 2.11.9: đã bỏ các type thừa hưởng từ MUT mà kernel local không bao giờ
// route được (không nằm trong AVJP.contract.TASK_TYPES nên validateTask ở
// source.js luôn từ chối, không platform nào có nhánh scripts()): comment, like,
// own_post_comment, auto_connect, join_group, scan_group, scan_shopee,
// media_enrichment, ai_caption — kèm metadata + alias legacy trỏ riêng vào chúng.
// CONTRACT_VERSION giữ nguyên 2 (chỉ bỏ phần chết, không đổi hợp đồng type còn sống).
const CONTRACT_VERSION = 2;
const TASK_TYPES = Object.freeze({
  "POST": "post",
  "REPLY": "reply",
  "AFFILIATE_COMMENT": "affiliate_comment",
  "SCAN_ACCOUNT": "scan_account",
  "NURTURE": "nurture",
  "STORY": "story",
  "UPLOAD": "upload",
  "HEALTHSCAN": "healthscan",
  "MICRO_ACTION": "micro_action"
});
const TASK_STATUS = Object.freeze({
  "PENDING": "pending",
  "PROCESSING": "processing",
  "SUCCESS": "success",
  "FAILED": "failed",
  "CANCELLED": "cancelled",
  "SKIPPED": "skipped",
  "UNCERTAIN": "uncertain"
});
const DELIVERY_STATUS = Object.freeze({
  "CLAIMING": "claiming",
  "READY": "ready",
  "RUNNING": "running",
  "REPORTING": "reporting",
  "COMPLETED": "completed",
  "EXPIRED": "expired",
  "CANCELLED": "cancelled"
});
const FAILURE_CODES = Object.freeze({
  "RATE_LIMITED": "rate_limited",
  "SELECTOR_NOT_FOUND": "selector_not_found",
  "ACCOUNT_MISMATCH": "account_mismatch",
  "UPLOAD_TIMEOUT": "upload_timeout",
  "NETWORK_ERROR": "network_error",
  "TASK_TIMEOUT": "task_timeout",
  "EXECUTION_ERROR": "execution_error",
  "SESSION_EXPIRED": "session_expired",
  "NO_ELIGIBLE_TARGET": "no_eligible_target",
  "USER_CANCELLED": "user_cancelled",
  "EMULATION_MISSING": "emulation_missing",
  "MEDIA_TYPE_UNSUPPORTED": "media_type_unsupported"
});
const TASK_METADATA = Object.freeze({
  "post": {
    "default_timeout_ms": 1200000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "reply": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "affiliate_comment": {
    "default_timeout_ms": 900000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "scan_account": {
    "default_timeout_ms": 300000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "nurture": {
    "default_timeout_ms": 3600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "story": {
    "default_timeout_ms": 1200000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "upload": {
    "default_timeout_ms": 1800000,
    "retryable_failure_codes": [
      "selector_not_found",
      "upload_timeout",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "healthscan": {
    "default_timeout_ms": 600000,
    "retryable_failure_codes": [
      "selector_not_found",
      "network_error",
      "task_timeout",
      "execution_error"
    ]
  },
  "micro_action": {
    "default_timeout_ms": 300000,
    "retryable_failure_codes": [
      "selector_not_found",
      "network_error",
      "execution_error"
    ]
  }
});
const TERMINAL_TASK_STATUSES = Object.freeze([
  "success",
  "failed",
  "cancelled",
  "skipped",
  "uncertain"
]);
const LEGACY_STATUS_MAP = Object.freeze({
  "completed": "success",
  "published": "success",
  "completed_with_errors": "success",
  "error": "failed",
  "unknown": "uncertain"
});
const LEGACY_FAILURE_CODE_MAP = Object.freeze({
  "post_error": "execution_error",
  "reply_error": "execution_error",
  "affiliate_error": "execution_error",
  "own_post_comment_error": "execution_error",
  "execution_failed": "execution_error",
  "timeout": "task_timeout",
  "session_expired": "session_expired"
});
const LEGACY_TASK_TYPE_MAP = Object.freeze({
  "affiliate": "affiliate_comment",
  "interaction": "reply",
  "replies": "reply",
  "post_tasks": "post"
});
const LEGACY_TRANSPORT_TASK_TYPE = Object.freeze({
  "affiliate_comment": "affiliate"
});
const taskTypes = new Set(Object.values(TASK_TYPES));
const statuses = new Set(Object.values(TASK_STATUS));
const failureCodes = new Set(Object.values(FAILURE_CODES));
const terminalTaskStatuses = new Set(TERMINAL_TASK_STATUSES);
function normalizeTaskType(value) {
  const raw = String(value || '').trim().toLowerCase();
  return taskTypes.has(raw) ? raw : LEGACY_TASK_TYPE_MAP[raw] || null;
}
function normalizeTaskStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  return statuses.has(raw) ? raw : LEGACY_STATUS_MAP[raw] || null;
}
function normalizeFailureCode(value) {
  if (value == null || value === '') return '';
  const raw = String(value).trim().toLowerCase();
  return failureCodes.has(raw) ? raw : null;
}
function normalizeLegacyFailureCode(value) {
  const normalized = normalizeFailureCode(value);
  if (normalized !== null) return normalized;
  return LEGACY_FAILURE_CODE_MAP[String(value || '').trim().toLowerCase()] || null;
}
function isTerminalTaskStatus(value) {
  return terminalTaskStatuses.has(String(value || '').trim().toLowerCase());
}
function getTaskMetadata(value) {
  const type = normalizeTaskType(value);
  return type ? TASK_METADATA[type] : null;
}
function isFailureRetryable(taskType, status, failureCode) {
  const normalizedStatus = normalizeTaskStatus(status);
  const normalizedFailure = normalizeFailureCode(failureCode);
  const metadata = getTaskMetadata(taskType);
  if (normalizedStatus !== TASK_STATUS.FAILED || !normalizedFailure || !metadata) return false;
  return metadata.retryable_failure_codes.includes(normalizedFailure);
}
function toLegacyTransportTaskType(value) {
  const canonical = normalizeTaskType(value);
  return canonical ? LEGACY_TRANSPORT_TASK_TYPE[canonical] || canonical : null;
}


// ── MICRO_ACTIONS (2.11.17): registry hành động nhỏ — NGUỒN SỰ THẬT
// DUY NHẤT cho bảng "Hành động nhỏ" ở trang quản lý (manage.js render
// từ đây, không còn danh sách cứng). Mỗi entry: {key, label, needs
// ('standalone' chạy lẻ được | 'context' cần chạy chuỗi prefix trước),
// prefix: [key...] (chỉ khi context), note?}. Handler sống trong
// modules/<platform>/micro.js (step-runner theo phase, tiền tố fail ->
// failed 'prefix_failed'). Key tf_* (tiktok) = step Farmer chạy lẻ qua
// TF.engine; 5 step khung có label hậu tố '· khung' + details.stub.
// Key healthscan_<anchor> = định vị neo selector mẫu qua AVJP.heal
// (modules/shared/healthscan-micro.js), chỉ định vị không bấm.
// Tổng: 216 hàng (IG 34, Threads 23, TikTok 78, X 32, YouTube 49) —
// gồm 207 hành động kiểm kê + 4 healthscan + 5 key micro TikTok cũ
// (scroll_feed/watch_first/like_first/open_notifications/open_profile)
// là hành động riêng, không trùng 36 hành động nền tảng TikTok.
const MICRO_ACTIONS = Object.freeze({
  instagram: Object.freeze([
    { key: "open_home_feed", label: "Mở feed nhà", needs: "standalone" },
    { key: "open_post_from_url", label: "Mở bài theo URL", needs: "standalone", note: "cần payload.target_url" },
    { key: "open_reels_tab", label: "Mở tab Reels", needs: "standalone" },
    { key: "open_profile_grid", label: "Mở lưới bài hồ sơ", needs: "standalone" },
    { key: "like_button_state", label: "Đọc trạng thái nút Like", needs: "standalone", note: "chỉ đọc, không bấm" },
    { key: "open_comments", label: "Mở hộp bình luận", needs: "context", prefix: ["open_post_from_url"] },
    { key: "focus_comment_input", label: "Focus ô bình luận", needs: "context", prefix: ["open_post_from_url", "open_comments"] },
    { key: "type_comment", label: "Gõ nội dung bình luận", needs: "context", prefix: ["open_post_from_url", "open_comments", "focus_comment_input"], note: "payload.content, thiếu thì dùng text mẫu" },
    { key: "post_comment", label: "Đăng bình luận (nút Post)", needs: "context", prefix: ["open_post_from_url", "open_comments", "focus_comment_input", "type_comment"] },
    { key: "verify_comment", label: "Kiểm chứng bình luận đã đăng", needs: "context", prefix: ["open_post_from_url", "open_comments", "focus_comment_input", "type_comment", "post_comment"] },
    { key: "like_post", label: "Thả tim bài đang mở", needs: "context", prefix: ["open_post_from_url"] },
    { key: "follow_author", label: "Follow tác giả bài", needs: "context", prefix: ["open_post_from_url"] },
    { key: "save_post", label: "Lưu bài đang mở", needs: "context", prefix: ["open_post_from_url"] },
    { key: "follow_from_search", label: "Tìm user và Follow", needs: "standalone", note: "cần payload.query" },
    { key: "scroll_feed", label: "Lướt feed 30 giây", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "like_first", label: "Thả tim bài đầu", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "view_first_story", label: "Xem story đầu tiên", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "open_notifications", label: "Mở thông báo", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "open_profile", label: "Mở hồ sơ của mình", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "scroll_reels", label: "Lướt/xem Reels", needs: "standalone", note: "payload.count = số reel, mặc định 3" },
    { key: "open_story_ring", label: "Mở vòng story đầu tiên", needs: "standalone" },
    { key: "story_advance", label: "Chuyển story kế tiếp", needs: "context", prefix: ["open_story_ring"] },
    { key: "story_exit", label: "Thoát trình xem story", needs: "context", prefix: ["open_story_ring"] },
    { key: "open_explore", label: "Mở trang Explore", needs: "standalone" },
    { key: "open_first_explore_post", label: "Mở bài đầu trong Explore", needs: "context", prefix: ["open_explore"] },
    { key: "open_own_profile", label: "Mở hồ sơ của chính nick", needs: "standalone" },
    { key: "verify_own_username", label: "Kiểm chứng username hồ sơ", needs: "context", prefix: ["open_own_profile"] },
    { key: "scan_highlight_reel", label: "Quét số liệu 1 reel", needs: "standalone" },
    { key: "scan_profile_media", label: "Quét truyền thông hồ sơ (12 ô)", needs: "standalone" },
    { key: "scan_reels_metrics", label: "Quét số liệu Reels của hồ sơ", needs: "standalone" },
    { key: "extract_post_caption", label: "Trích xuất caption bài", needs: "context", prefix: ["open_post_from_url"] },
    { key: "like_comment", label: "Thả tim bình luận", needs: "context", prefix: ["open_post_from_url", "open_comments"] },
    { key: "comment_on_post", label: "Bình luận (luồng affiliate)", needs: "context", prefix: ["open_post_from_url"], note: "bắt buộc payload.content; AI tắt" },
    { key: "healthscan_ig_post_createbtn", label: "Quét selector: nút Tạo bài mới", needs: "standalone", note: "neo ig.post.createBtn — chỉ định vị, không bấm" }
  ]),
  threads: Object.freeze([
    { key: "open_home", label: "Về trang chủ Threads", needs: "standalone" },
    { key: "open_post_from_url", label: "Mở bài theo URL", needs: "standalone" },
    { key: "open_composer", label: "Mở hộp soạn bài mới", needs: "standalone" },
    { key: "focus_editor", label: "Focus ô soạn bài", needs: "context", prefix: ["open_composer"] },
    { key: "type_post_text", label: "Gõ nội dung bài", needs: "context", prefix: ["open_composer", "focus_editor"] },
    { key: "attach_media_url", label: "Đính kèm media theo URL", needs: "context", prefix: ["open_composer", "focus_editor", "type_post_text"], note: "payload.media_url; tải qua background fetchImage như automator" },
    { key: "click_post", label: "Bấm nút Đăng bài", needs: "context", prefix: ["open_composer", "focus_editor", "type_post_text"] },
    { key: "verify_post", label: "Kiểm chứng bài vừa đăng", needs: "context", prefix: ["open_composer", "focus_editor", "type_post_text", "click_post"] },
    { key: "open_comments", label: "Mở khu bình luận của bài", needs: "context", prefix: ["open_post_from_url"] },
    { key: "focus_comment_box", label: "Focus ô trả lời", needs: "context", prefix: ["open_post_from_url", "open_comments"] },
    { key: "type_reply", label: "Gõ trả lời", needs: "context", prefix: ["open_post_from_url", "open_comments", "focus_comment_box"], note: "bắt buộc payload.content, thiếu -> missing_content" },
    { key: "submit_reply", label: "Gửi trả lời", needs: "context", prefix: ["open_post_from_url", "open_comments", "focus_comment_box", "type_reply"], note: "kiểm chứng ô trống sau gửi" },
    { key: "like_post", label: "Thả tim bài đang mở", needs: "context", prefix: ["open_post_from_url"] },
    { key: "follow_author", label: "Theo dõi tác giả bài", needs: "context", prefix: ["open_post_from_url"] },
    { key: "scroll_feed", label: "Lướt feed 30 giây", needs: "standalone", note: "key cũ, giữ nguyên" },
    { key: "like_first", label: "Thả tim bài đầu", needs: "standalone", note: "key cũ, giữ nguyên" },
    { key: "open_notifications", label: "Mở thông báo", needs: "standalone", note: "key cũ, giữ nguyên" },
    { key: "open_profile", label: "Mở hồ sơ của mình", needs: "standalone", note: "key cũ, giữ nguyên" },
    { key: "nurture_feed_scroll", label: "Cuộn feed kiểu nuôi", needs: "standalone", note: "scrollBy 0.85×viewport + đếm đơn vị bài; khác scroll_feed" },
    { key: "nurture_search", label: "Tìm kiếm theo từ khoá (nuôi)", needs: "standalone", note: "payload.query; route tìm kiếm chính thức của Threads (adapter nuôi không có bước search)" },
    { key: "nurture_open_post", label: "Mở 1 bài trong luồng nuôi", needs: "standalone" },
    { key: "nurture_verify_post", label: "Kiểm chứng bài hiển thị (nuôi)", needs: "standalone" },
    { key: "healthscan_th_feed_likebtn", label: "Quét selector: nút Like bài đầu Threads", needs: "standalone", note: "neo th.feed.likeBtn — chỉ định vị, không bấm" }
  ]),
  tiktok: Object.freeze([
    { key: "open_upload_page", label: "Mở trang tải lên TikTok Studio", needs: "standalone" },
    { key: "set_video_file", label: "Nạp file video vào ô tải lên", needs: "context", prefix: ["open_upload_page"], note: "media từ payload.media_url qua background fetchImage + DataTransfer như automator.js" },
    { key: "type_caption", label: "Gõ caption vào ô soạn Studio", needs: "context", prefix: ["open_upload_page"], note: "payload.content; nạp qua ClipboardEvent paste như automator.js" },
    { key: "toggle_comments", label: "Bật/tắt cho phép bình luận (Studio)", needs: "context", prefix: ["open_upload_page"] },
    { key: "toggle_duet", label: "Bật/tắt Duet (Studio)", needs: "context", prefix: ["open_upload_page"] },
    { key: "toggle_stitch", label: "Bật/tắt Stitch (Studio)", needs: "context", prefix: ["open_upload_page"] },
    { key: "click_post_video", label: "Bấm nút Đăng video", needs: "context", prefix: ["open_upload_page", "set_video_file"] },
    { key: "wait_upload_complete", label: "Chờ tải video lên hoàn tất", needs: "context", prefix: ["open_upload_page", "set_video_file"], note: "tối đa 90s, quá hạn failed upload_timeout" },
    { key: "verify_content_page", label: "Kiểm chứng video trên trang nội dung Studio", needs: "context", prefix: ["open_upload_page", "set_video_file", "click_post_video"] },
    { key: "open_first_video", label: "Mở/phát video đầu tiên của feed", needs: "standalone", note: "key tiền tố của nhóm trình phát" },
    { key: "play_pause_video", label: "Phát/tạm dừng video hiện tại", needs: "context", prefix: ["open_first_video"] },
    { key: "seek_video", label: "Tua video theo tỉ lệ", needs: "context", prefix: ["open_first_video"], note: "payload.seek_ratio, mặc định 0.5" },
    { key: "toggle_mute", label: "Bật/tắt tiếng video", needs: "context", prefix: ["open_first_video"] },
    { key: "open_comments_panel", label: "Mở panel bình luận của video", needs: "context", prefix: ["open_first_video"] },
    { key: "read_comment_count", label: "Đọc số bình luận hiển thị", needs: "context", prefix: ["open_first_video"], note: "chỉ đọc, details.comment_count + comment_count_text" },
    { key: "post_comment", label: "Đăng bình luận vào video", needs: "context", prefix: ["open_first_video", "open_comments_panel"], note: "kiểm chứng comment xuất hiện, unverified = failed" },
    { key: "like_video_button", label: "Thả tim qua nút Like của trình phát", needs: "context", prefix: ["open_first_video"], note: "khác like_first cũ (luồng micro feed)" },
    { key: "save_video_button", label: "Lưu video qua nút bookmark của trình phát", needs: "context", prefix: ["open_first_video"], note: "save_unverified -> failed, details.unverified=true" },
    { key: "share_video", label: "Mở menu chia sẻ video", needs: "context", prefix: ["open_first_video"], note: "chỉ mở menu, không gửi đi đâu" },
    { key: "studio_open_comments", label: "Mở trang bình luận TikTok Studio", needs: "standalone" },
    { key: "studio_read_rows", label: "Đọc các dòng bình luận Studio", needs: "standalone", note: "chỉ đọc, details.count + sample" },
    { key: "studio_filter_unreplied", label: "Lọc bình luận Studio chưa trả lời", needs: "context", prefix: ["studio_open_comments"] },
    { key: "studio_filter_by_video", label: "Lọc bình luận Studio theo video", needs: "context", prefix: ["studio_open_comments"] },
    { key: "studio_open_video_filter_list", label: "Mở danh sách chọn video để lọc (Studio)", needs: "context", prefix: ["studio_open_comments"] },
    { key: "studio_read_video_options", label: "Đọc các tuỳ chọn video để lọc (Studio)", needs: "context", prefix: ["studio_open_comments", "studio_open_video_filter_list"], note: "chỉ đọc" },
    { key: "studio_choose_sort", label: "Chọn sắp xếp bình luận Studio (mới nhất)", needs: "context", prefix: ["studio_open_comments"] },
    { key: "studio_open_reply", label: "Mở ô trả lời một bình luận Studio", needs: "context", prefix: ["studio_open_comments"] },
    { key: "studio_type_reply", label: "Gõ nội dung trả lời (Studio)", needs: "context", prefix: ["studio_open_comments", "studio_open_reply"], note: "payload.content" },
    { key: "studio_submit_reply", label: "Gửi trả lời bình luận (Studio)", needs: "context", prefix: ["studio_open_comments", "studio_open_reply", "studio_type_reply"], note: "details.verified=false — kiểm chứng bằng studio_verify_reply" },
    { key: "studio_close_reply", label: "Đóng ô trả lời (Studio)", needs: "context", prefix: ["studio_open_comments", "studio_open_reply"] },
    { key: "studio_next_page", label: "Chuyển trang bình luận kế (Studio)", needs: "context", prefix: ["studio_open_comments"] },
    { key: "studio_search_comments", label: "Tìm bình luận Studio theo từ khoá", needs: "context", prefix: ["studio_open_comments"], note: "payload.query" },
    { key: "studio_verify_reply", label: "Kiểm chứng trả lời đã hiện (Studio)", needs: "context", prefix: ["studio_open_comments"] },
    { key: "replier_open_target", label: "Mở video đích cho comment-replier", needs: "standalone", note: "payload.target_url" },
    { key: "replier_verify_panel", label: "Kiểm chứng panel bình luận (comment-replier)", needs: "context", prefix: ["replier_open_target"], note: "chỉ kiểm chứng" },
    { key: "replier_post_comment", label: "Đăng bình luận qua comment-replier", needs: "context", prefix: ["replier_open_target"], note: "luồng comment-replier.js, khác post_comment" },
    { key: "scroll_feed", label: "Lướt feed 30 giây", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "watch_first", label: "Xem video đầu 20 giây", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "like_first", label: "Thả tim bài đầu", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "open_notifications", label: "Mở thông báo", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "open_profile", label: "Mở hồ sơ của mình", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "tf_khoi_tao", label: "Farmer: Khởi tạo / kiểm tra đăng nhập", needs: "standalone", note: "module kiem_login" },
    { key: "tf_trang_chu", label: "Farmer: Về trang chủ For You", needs: "standalone", note: "module mo_fyp" },
    { key: "tf_xem_video", label: "Farmer: Xem video", needs: "standalone", note: "module xem_video" },
    { key: "tf_luot_next", label: "Farmer: Lướt sang video tiếp theo", needs: "standalone", note: "module luot_next" },
    { key: "tf_like", label: "Farmer: Thích video", needs: "standalone", note: "module like_video" },
    { key: "tf_save", label: "Farmer: Lưu video", needs: "standalone", note: "module save_video" },
    { key: "tf_follow", label: "Farmer: Follow creator", needs: "standalone", note: "module follow_creator" },
    { key: "tf_follow_back", label: "Farmer: Follow lại theo username", needs: "standalone", note: "module follow_danh_sach, cần payload.username" },
    { key: "tf_binh_luan", label: "Farmer: Bình luận (đã duyệt)", needs: "standalone", note: "module comment_duyet — cần payload approval_id + approved=true, thiếu là fail not_approved thật" },
    { key: "tf_doc_binh_luan", label: "Farmer: Đọc bình luận", needs: "standalone", note: "module doc_comment" },
    { key: "tf_sang_trang_ca_nhan", label: "Farmer: Sang trang cá nhân creator", needs: "standalone", note: "module mo_profile_creator" },
    { key: "tf_xem_story", label: "Farmer: Xem story", needs: "standalone", note: "KHÔNG có module Farmer — engine trả module_not_found thật" },
    { key: "tf_xem_live", label: "Farmer: Xem LIVE", needs: "standalone", note: "module xem_live" },
    { key: "tf_tim_kiem", label: "Farmer: Tìm kiếm theo từ khoá", needs: "standalone", note: "module tim_keyword, payload.query" },
    { key: "tf_theo_doi_live", label: "Farmer: Vào phòng LIVE", needs: "standalone", note: "module xem_live — Farmer không có module follow-live riêng" },
    { key: "tf_tuong_tac_live", label: "Farmer: Tương tác trong LIVE (thả tim)", needs: "standalone", note: "module like_video — không có module tương tác live riêng" },
    { key: "tf_doi_video_live", label: "Farmer: Đổi video/phòng tiếp theo", needs: "standalone", note: "module luot_next" },
    { key: "tf_check_tuong_tac", label: "Farmer: Kiểm tra trần tương tác ngày", needs: "standalone", note: "module kiem_tran_ngay" },
    { key: "tf_khong_lam_gi", label: "Farmer: Không làm gì (nghỉ tại chỗ)", needs: "standalone", note: "module nghi_vi_mo, giây từ payload.seconds" },
    { key: "tf_mo_thong_bao", label: "Farmer: Mở thông báo", needs: "standalone", note: "module mo_thong_bao" },
    { key: "tf_doc_thong_bao", label: "Farmer: Đọc thông báo", needs: "standalone", note: "module mo_thong_bao (mở inbox để đọc) — không có module đọc riêng" },
    { key: "tf_luot_thong_bao", label: "Farmer: Lướt thông báo", needs: "standalone", note: "module mo_thong_bao — không có module lướt thông báo riêng" },
    { key: "tf_dieu_huong_url", label: "Farmer: Điều hướng tới URL", needs: "standalone", note: "module mo_video_cu_the, payload.target_url" },
    { key: "tf_mo_url_trong_tab_moi", label: "Farmer: Mở URL trong tab mới", needs: "standalone", note: "KHÔNG có module Farmer — engine trả module_not_found thật" },
    { key: "tf_thuc_hien_script", label: "Farmer: Thực hiện script", needs: "standalone", note: "KHÔNG có module Farmer (không thực thi script tuỳ ý) — engine trả module_not_found thật" },
    { key: "tf_cho_video", label: "Farmer: Chờ video", needs: "standalone", note: "module xem_video (chờ + xem ngắn)" },
    { key: "tf_cho_dieu_kien", label: "Farmer: Chờ điều kiện", needs: "standalone", note: "module neu_thi (stub handled_by_engine), details.stub=true" },
    { key: "tf_doi_tab", label: "Farmer: Đổi tab", needs: "standalone", note: "KHÔNG có module Farmer — engine trả module_not_found thật" },
    { key: "tf_dong_tab", label: "Farmer: Đóng tab", needs: "standalone", note: "KHÔNG có module Farmer — engine trả module_not_found thật" },
    { key: "tf_cuoi_phien", label: "Farmer: Cuối phiên (ghi nhật ký)", needs: "standalone", note: "module ghi_log" },
    { key: "tf_chon_video_hang_doi", label: "Farmer: Chọn video hàng đợi · khung", needs: "standalone", note: "module chon_video_hang_doi (stub), details.stub=true" },
    { key: "tf_goi_workflow", label: "Farmer: Gọi workflow con · khung", needs: "standalone", note: "module goi_workflow (stub handled_by_engine), details.stub=true" },
    { key: "tf_lap_lai", label: "Farmer: Lặp lại · khung", needs: "standalone", note: "module lap_lai (stub handled_by_engine), details.stub=true" },
    { key: "tf_neu_thi", label: "Farmer: Nếu–thì · khung", needs: "standalone", note: "module neu_thi (stub handled_by_engine), details.stub=true" },
    { key: "tf_theo_xac_suat", label: "Farmer: Theo xác suất · khung", needs: "standalone", note: "module theo_xac_suat (stub handled_by_engine), details.stub=true" },
    { key: "tf_khao_sat_tai_khoan", label: "Farmer: Khảo sát tài khoản (trạng thái đăng nhập)", needs: "standalone", note: "module kiem_login" },
    { key: "healthscan_tt_fyp_likebtn", label: "Quét selector: nút Like video For You", needs: "standalone", note: "neo tt.fyp.likeBtn — chỉ định vị, không bấm" }
  ]),
  x: Object.freeze([
    { key: "open_home", label: "Mở trang chủ X", needs: "standalone" },
    { key: "open_composer", label: "Mở hộp soạn bài", needs: "standalone" },
    { key: "focus_editor", label: "Focus ô soạn", needs: "context", prefix: ["open_composer"] },
    { key: "type_post_text", label: "Gõ nội dung bài đăng", needs: "context", prefix: ["open_composer", "focus_editor"] },
    { key: "click_post_button", label: "Bấm nút Đăng bài", needs: "context", prefix: ["open_composer", "focus_editor", "type_post_text"] },
    { key: "verify_post_appears", label: "Kiểm chứng bài đã đăng", needs: "context", prefix: ["open_composer", "focus_editor", "type_post_text", "click_post_button"], note: "automator không có verify/clipboard; kiểm chứng = text bài xuất hiện trong timeline" },
    { key: "open_post_from_url", label: "Mở bài theo URL", needs: "standalone" },
    { key: "open_reply_box", label: "Mở ô trả lời", needs: "context", prefix: ["open_post_from_url"] },
    { key: "type_reply_text", label: "Gõ nội dung trả lời", needs: "context", prefix: ["open_post_from_url", "open_reply_box"] },
    { key: "submit_reply", label: "Gửi trả lời", needs: "context", prefix: ["open_post_from_url", "open_reply_box", "type_reply_text"] },
    { key: "verify_reply", label: "Kiểm chứng trả lời đã hiện", needs: "context", prefix: ["open_post_from_url", "open_reply_box", "type_reply_text", "submit_reply"] },
    { key: "like_post", label: "Thả tim bài viết", needs: "context", prefix: ["open_post_from_url"] },
    { key: "follow_author", label: "Theo dõi tác giả", needs: "context", prefix: ["open_post_from_url"] },
    { key: "read_post_text", label: "Đọc nội dung bài viết", needs: "context", prefix: ["open_post_from_url"], note: "chỉ đọc, trả text vào details" },
    { key: "affiliate_collect_links", label: "Thu thập link bài (affiliate)", needs: "standalone", note: "trả count+links vào details" },
    { key: "affiliate_open_link", label: "Mở 1 link bài affiliate", needs: "standalone", note: "mở payload.target_url" },
    { key: "affiliate_like_comment_target", label: "Thả tim bài đích affiliate", needs: "context", prefix: ["open_post_from_url"] },
    { key: "affiliate_extract_text", label: "Trích text bài (affiliate)", needs: "context", prefix: ["open_post_from_url"], note: "chỉ đọc" },
    { key: "affiliate_type_comment", label: "Gõ bình luận affiliate", needs: "context", prefix: ["open_post_from_url", "open_reply_box"] },
    { key: "affiliate_submit_comment", label: "Gửi bình luận affiliate", needs: "context", prefix: ["open_post_from_url", "open_reply_box", "affiliate_type_comment"] },
    { key: "scroll_feed", label: "Lướt dòng thời gian", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "like_first", label: "Thả tim bài đầu tiên", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "open_notifications", label: "Mở thông báo", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "open_profile", label: "Mở hồ sơ của mình", needs: "standalone", note: "key cũ 2.11.16, giữ nguyên" },
    { key: "nurture_open_home", label: "Nuôi: mở trang chủ", needs: "standalone" },
    { key: "nurture_read_timeline", label: "Nuôi: đọc timeline", needs: "standalone", note: "trả count+sample vào details" },
    { key: "nurture_open_first_post", label: "Nuôi: mở bài đầu tiên", needs: "standalone" },
    { key: "nurture_perform_like", label: "Nuôi: thả tim bài đầu", needs: "standalone" },
    { key: "nurture_perform_follow", label: "Nuôi: theo dõi tác giả bài đầu", needs: "standalone" },
    { key: "nurture_verify_post_text", label: "Nuôi: kiểm chứng text bài", needs: "standalone" },
    { key: "nurture_build_context", label: "Nuôi: dựng ngữ cảnh bài", needs: "standalone", note: "chỉ đọc, trả context_summary vào details" },
    { key: "nurture_interact_first", label: "Nuôi: tương tác bài đầu tiên", needs: "standalone" }
  ]),
  youtube: Object.freeze([
    { key: "discover_feed", label: "Thu thập video từ feed trang chủ", needs: "standalone" },
    { key: "discover_search", label: "Thu thập video từ tìm kiếm", needs: "standalone", note: "payload.query bắt buộc" },
    { key: "discover_channel", label: "Thu thập video từ trang kênh", needs: "standalone", note: "payload.channel_url hoặc target_url bắt buộc" },
    { key: "open_first_video", label: "Mở video đầu tiên ở trang chủ", needs: "standalone" },
    { key: "player_play_pause", label: "Phát / tạm dừng video", needs: "context", prefix: ["open_first_video"] },
    { key: "player_seek", label: "Tua video tới vị trí", needs: "context", prefix: ["open_first_video"], note: "payload.seek_ratio mặc định 0.5" },
    { key: "player_set_speed", label: "Đặt tốc độ phát", needs: "context", prefix: ["open_first_video"], note: "payload.rate mặc định 1.5" },
    { key: "player_toggle_mute", label: "Bật / tắt tiếng video", needs: "context", prefix: ["open_first_video"] },
    { key: "player_toggle_fullscreen", label: "Bật toàn màn hình (tự thoát khi xong)", needs: "context", prefix: ["open_first_video"] },
    { key: "player_open_settings", label: "Mở menu cài đặt trình phát", needs: "context", prefix: ["open_first_video"] },
    { key: "like_video", label: "Thả tim video", needs: "context", prefix: ["open_first_video"] },
    { key: "dislike_video", label: "Bấm Không thích video", needs: "context", prefix: ["open_first_video"] },
    { key: "subscribe_channel", label: "Đăng ký kênh của video", needs: "context", prefix: ["open_first_video"] },
    { key: "open_comments_section", label: "Mở / cuộn tới khu bình luận", needs: "context", prefix: ["open_first_video"] },
    { key: "post_comment", label: "Đăng bình luận lên video", needs: "context", prefix: ["open_first_video", "open_comments_section"], note: "payload.content bắt buộc" },
    { key: "open_share_dialog", label: "Mở hộp chia sẻ", needs: "context", prefix: ["open_first_video"] },
    { key: "copy_share_link", label: "Sao chép link chia sẻ", needs: "context", prefix: ["open_first_video", "open_share_dialog"], note: "link trả vào details.share_url" },
    { key: "save_to_watch_later", label: "Lưu video vào Xem sau", needs: "context", prefix: ["open_first_video"] },
    { key: "open_channel_page", label: "Mở trang kênh từ video", needs: "context", prefix: ["open_first_video"] },
    { key: "read_video_meta", label: "Đọc tiêu đề / kênh / lượt xem video", needs: "context", prefix: ["open_first_video"], note: "chỉ đọc" },
    { key: "open_video_from_url", label: "Mở video theo URL", needs: "standalone", note: "payload.target_url bắt buộc" },
    { key: "like_video_by_url", label: "Thả tim video theo URL", needs: "context", prefix: ["open_video_from_url"] },
    { key: "comment_by_url", label: "Bình luận trên video theo URL", needs: "context", prefix: ["open_video_from_url"], note: "payload.content bắt buộc" },
    { key: "nurture_open_home", label: "Nuôi: mở trang chủ", needs: "standalone" },
    { key: "nurture_watch_video", label: "Nuôi: xem 1 video (đo giây xem thật)", needs: "standalone" },
    { key: "nurture_perform_like", label: "Nuôi: thực thi thích video", needs: "standalone", note: "tự mở video đầu nếu chưa ở trang xem" },
    { key: "nurture_perform_subscribe", label: "Nuôi: thực thi đăng ký kênh", needs: "standalone", note: "tự mở video đầu nếu chưa ở trang xem" },
    { key: "nurture_type_comment", label: "Nuôi: gõ bình luận (không gửi)", needs: "standalone", note: "payload.content bắt buộc" },
    { key: "nurture_submit_comment", label: "Nuôi: gửi bình luận", needs: "standalone", note: "gửi text sẵn trong editor, hoặc payload.content" },
    { key: "nurture_build_context", label: "Nuôi: dựng ngữ cảnh video", needs: "standalone", note: "chỉ đọc" },
    { key: "scroll_feed", label: "Lướt trang chủ", needs: "standalone", note: "đã có từ 2.11.16" },
    { key: "watch_first", label: "Xem video đầu tiên", needs: "standalone", note: "đã có từ 2.11.16" },
    { key: "open_notifications", label: "Mở thông báo", needs: "standalone", note: "đã có từ 2.11.16" },
    { key: "open_profile", label: "Mở kênh của mình", needs: "standalone", note: "đã có từ 2.11.16" },
    { key: "open_community_tab", label: "Mở tab Cộng đồng của kênh mình", needs: "standalone", note: "chưa có kênh -> failed no_youtube_channel" },
    { key: "open_composer", label: "Mở hộp soạn bài cộng đồng", needs: "context", prefix: ["open_community_tab"] },
    { key: "type_community_text", label: "Gõ nội dung bài cộng đồng", needs: "context", prefix: ["open_community_tab", "open_composer"], note: "payload.content bắt buộc" },
    { key: "submit_community_post", label: "Đăng bài cộng đồng", needs: "context", prefix: ["open_community_tab", "open_composer", "type_community_text"] },
    { key: "verify_community_post", label: "Kiểm chứng bài cộng đồng đã xuất hiện", needs: "context", prefix: ["open_community_tab", "open_composer", "type_community_text", "submit_community_post"], note: "payload.content làm chữ ký đối chiếu" },
    { key: "open_upload_dialog", label: "Mở hộp thoại tải lên (Studio)", needs: "standalone", note: "tự điều hướng sang studio.youtube.com" },
    { key: "set_upload_file", label: "Nạp file video vào Studio", needs: "context", prefix: ["open_upload_dialog"], note: "URL media: payload.target_url/media_url hoặc images/media_urls của task" },
    { key: "fill_title", label: "Điền tiêu đề video (Studio)", needs: "context", prefix: ["open_upload_dialog", "set_upload_file"], note: "payload.title hoặc content" },
    { key: "fill_description", label: "Điền mô tả video (Studio)", needs: "context", prefix: ["open_upload_dialog", "set_upload_file"], note: "payload.description hoặc content" },
    { key: "set_visibility", label: "Đặt chế độ hiển thị video", needs: "context", prefix: ["open_upload_dialog", "set_upload_file"], note: "payload.visibility mặc định public" },
    { key: "advance_wizard", label: "Tiến qua các bước wizard tải lên", needs: "context", prefix: ["open_upload_dialog", "set_upload_file"] },
    { key: "click_publish", label: "Bấm Xuất bản video", needs: "context", prefix: ["open_upload_dialog", "set_upload_file", "fill_title", "set_visibility", "advance_wizard"] },
    { key: "wait_processing", label: "Chờ tải lên / xử lý xong", needs: "context", prefix: ["open_upload_dialog", "set_upload_file"], note: "trần chờ theo payload.seconds, tối đa 240s" },
    { key: "read_upload_status", label: "Đọc trạng thái tải lên hiện tại", needs: "context", prefix: ["open_upload_dialog"], note: "chỉ đọc" },
    { key: "healthscan_yt_reply_commentbox", label: "Quét selector: ô bình luận YouTube", needs: "standalone", note: "neo yt.reply.commentBox — chỉ định vị, không bấm" }
  ]),
});

globalThis.AVJP = globalThis.AVJP || {};
globalThis.AVJP.contractData = { CONTRACT_VERSION, MICRO_ACTIONS, TASK_TYPES, TASK_STATUS, DELIVERY_STATUS, FAILURE_CODES, TASK_METADATA, TERMINAL_TASK_STATUSES, LEGACY_STATUS_MAP, LEGACY_FAILURE_CODE_MAP, LEGACY_TASK_TYPE_MAP, LEGACY_TRANSPORT_TASK_TYPE, normalizeTaskType, normalizeTaskStatus, normalizeFailureCode, normalizeLegacyFailureCode, isTerminalTaskStatus, getTaskMetadata, isFailureRetryable, toLegacyTransportTaskType };
})();
