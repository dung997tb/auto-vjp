/* Auto vjp — modules/youtube-nurture/adapter.js (2.6.0: goNextFromWatch
 * thêm dự phòng yt-lockup-view-model; play() bọc Promise.race 1.5s —
 * cộng vá phía kernel: runner không còn chặn inject lại với task
 * nurture nên các điều hướng full về cùng URL của adapter được inject
 * lại như thiết kế; xem MODULE.md §1/§5.11).
 * Adapter nuôi YouTube: bề mặt (selector/phân loại/proof) cắm vào lõi nuôi
 * dùng chung modules/nurture-core (cơ chế quản lý + đồng bộ dữ liệu phỏng bản
 * gốc FB Auto Tool friendReengage/friendWarm — storage.sync cho cấu hình,
 * storage.local họ <prefix>Active/RunId/History/Dead/Status... cho state).
 * Khuôn theo modules/threads-nurture/adapter.js (lát 2) + x-nurture (lát 3).
 *
 * Luồng: canonical task {platform:'youtube', type:'nurture'} -> cấu hình
 * (sync + payload) -> persist run TRƯỚC khi đụng trang -> từ trang chủ mở
 * từng video -> XEM THẬT (đo bằng video.currentTime của player, không giả
 * lập; thời gian quảng cáo không tính) -> like (proof aria-pressed lật) ->
 * subscribe (proof nút đổi trạng thái; kênh 'follow' của lõi, key = kênh) ->
 * comment AI qua lõi (proof = comment hiện trong danh sách với chữ ký trong
 * 15s; không proof = uncertain, KHÔNG gửi lại) -> nurtureProgress/
 * nurtureDone về kernel.
 *
 * Điều hướng: runner của kernel tự inject lại adapter sau mỗi lần tab tải
 * xong trang mới (tabs.onUpdated), nên adapter chịu được cả chuyển trang
 * SPA lẫn reload đầy đủ: session (đếm hành động + video đã xem) được dựng
 * lại từ Journal của lõi theo runId, deadline của phiên lưu ở key
 * <prefix>Deadline cùng họ state. Trong 1 phiên trang, vòng lặp tự đi tiếp
 * bằng cách bấm video gợi ý (up next) / thẻ video ở trang chủ.
 *
 * Xoay nguồn (2.5.1 — bằng chứng live 2026-11-05: nick mới chưa có lịch
 * sử xem thì TRANG CHỦ và /feed/subscriptions TRỐNG recommendations,
 * phiên đầu fail no_eligible_target oan): bề mặt hiện tại quét vòng đầu +
 * 1 lần cuộn vẫn 0 ứng viên và chưa đạt mục tiêu xem -> chuyển nguồn kế
 * tiếp theo thứ tự trang chủ -> subscriptions -> tìm kiếm
 * (task.source_url, hoặc /results?search_query=task.search_query mặc
 * định "tin tức hôm nay"). Cursor nguồn lưu ở key <prefix>Source cạnh
 * <prefix>Deadline để bản inject mới sau điều hướng không quay lại nguồn
 * đã cạn. Hết mọi nguồn vẫn 0 -> giữ nguyên failed no_eligible_target.
 *
 * Vá live (2.5.2 — cùng phiên live trên bắt được video LIVESTREAM: xem
 * thật + like proof xong thì pha comment đứng câm tới khi kernel đóng
 * uncertain vì inactivity): video live được phân loại từ badge trên thẻ
 * và/hoặc dấu hiệu live trên trang /watch; live chỉ xem + like/subscribe
 * như thường, comment bị bỏ qua tại chỗ (journal skipped) và TUYỆT ĐỐI
 * không mở/chờ khung comment thường — trang live chỉ có live chat. Mọi
 * vòng chờ dài trong adapter đều có deadline cứng, poll huỷ theo lõi và
 * phát nurtureProgress định kỳ trong lúc chờ để kernel phân biệt được
 * "đang chờ thật" với treo.
 *
 * Đính chính 2.6.1 (danh tính chưa có kênh — bằng chứng probe live:
 * tài khoản Google trong profile công nhân chưa có kênh YouTube):
 * bấm ô comment thì YouTube bật hộp thoại bắt tạo kênh thay cho
 * editor. Adapter phát hiện dialog đó (nút/link "Tạo kênh"/"Create
 * channel" trong dialog đang hiện) ở cả hai vòng chờ của pha comment
 * -> journal comment skipped note channel_required, đặt cờ
 * <prefix>NoChannel (cạnh <prefix>Deadline/<prefix>Source) để tắt
 * comment cho phần còn lại của phiên; xem/like chạy tiếp bình thường.
 *
 * Vá live (2.6.2 — bằng chứng probe: giữa lúc module chạy scrollY = 0,
 * #comments ở top=2232px chưa vào viewport -> YouTube không lazy-load
 * nội dung comment, simplebox không bao giờ xuất hiện): cuộn smooth 1
 * lần ở đầu pha comment bị trang SPA nuốt/reset. Hai vòng chờ của
 * doComment (render #comments + chờ ô comment) giờ cuộn TỨC THỜI
 * (không smooth, scrollBy dự phòng) lại tới anchor trong MỖI vòng
 * poll qua helper scrollCommentsIntoView — selector không đổi.
 *
 * Vá live (2.6.4 — bằng chứng live phiên 2.6.3: receipt success
 * xem 3 like 2 nhưng journal comment trên video ugZMQUnfqss vẫn
 * "#comments đã render nhưng ô comment không xuất hiện sau 15s"):
 * khác biệt với task comment độc lập (interaction.js, cùng bộ
 * selector ô soạn) ĐÃ đăng thành công trên Big Buck Bunny là đường
 * đi tới video — độc lập TẢI TRANG ĐẦY ĐỦ tới /watch, còn nuôi tới
 * bằng chuyển SPA (bấm video gợi ý/kết quả), và trên trang watch
 * kiểu SPA cụm #comments/simplebox nạp không đáng tin cậy ở bản
 * headless dù đã cuộn lặp tức thời (2.6.2). Từ 2.6.4: pha doComment
 * chờ ô soạn nửa ngân sách (7,5s) mà simplebox chưa xuất hiện thì
 * TẢI LẠI TRANG ĐẦY ĐỦ đúng 1 lần cho video đó — ghi cờ
 * <prefix>CommentReload = video id (key phụ cạnh <prefix>Deadline/
 * <prefix>Source/<prefix>NoChannel) rồi location.reload(); bản
 * inject mới gặp cờ ở vòng lặp chính thì chạy lại doComment cho
 * đúng video đó (xem/like đã có journal nên không làm lại, nhánh
 * resume đặt TRƯỚC nhánh processedIds), gỡ cờ storage ngay khi
 * nhận để không resume lặp, cờ local giữ tới khi chạy xong để
 * doComment không reload lần 2. Không reload khi: video live,
 * video đã reload 1 lần, hoặc phiên còn <= 90s (không kịp vòng
 * resume trong max_minutes) — các trường hợp đó chờ nốt nửa ngân
 * sách rồi giữ kết cục skipped như cũ.
 *
 * Ánh xạ hành động vào lõi (xem MODULE.md §4): like -> 'like', comment ->
 * 'comment', subscribe -> 'follow' (theo tiền lệ X: bookmark -> 'save');
 * WATCH không có kênh trong ACTIONS của lõi nên ghi Journal action 'watch'
 * + counters.watch qua bumpCounters — TUYỆT ĐỐI không map sang 'like'.
 *
 * Kỷ luật: chưa đăng nhập / captcha -> dừng failed session_expired ngay,
 * không lách, không tự giải. Click chỉ bằng .click() trên phần tử DOM
 * (không tọa độ). Worker không kiểm tra giờ hoạt động (tầng điều phối lo).
 * Shorts: chỉ xem khi lạc vào, KHÔNG tương tác. Không upload, không
 * community post (việc riêng — plan §3 lát 4).
 *
 * LƯU Ý SELECTOR: DOM/player YouTube đổi thường xuyên (view-model mới thay
 * renderer cũ liên tục). Mọi neo selector gom ở các hàm finder bên dưới,
 * khớp đa biến thể (renderer cũ + view-model mới, nhãn EN/VI); proof luôn
 * dựa trên THUỘC TÍNH trạng thái (aria-pressed / [subscribed] / chữ ký
 * comment) chứ không dựa vào text hiển thị khi tránh được. Chi tiết + rủi
 * ro ở MODULE.md §5.
 */
(() => {
  if (window.__avjpYoutubeNurtureLoaded) return;
  window.__avjpYoutubeNurtureLoaded = true;

  const CANONICAL_KEY = 'currentAutomationRun';
  const PLATFORM = 'youtube';
  const PREFIX = 'youtubeNurture';
  const { sleep, rnd, clampInt, normalizeText, commentSignature, isNearDuplicate } =
    globalThis.AVJP.nurture.util;

  // ---- Nhãn/pattern YouTube (song ngữ EN/VI). ĐIỂM RỦI RO: YouTube đổi
  // DOM/nhãn liên tục — lệch thì sửa đúng các bảng này + finder bên dưới. ----
  const L = {
    subscribedText: ['Subscribed', 'Đã đăng ký'],
    subscribeText: ['Subscribe', 'Đăng ký'],
    commentsOff: ['Comments are turned off', 'Đã tắt tính năng bình luận', 'tính năng bình luận đã bị tắt'],
    unavailable: ['Video unavailable', 'This video is unavailable', 'This video is private',
      'Video không còn hoạt động', 'Video riêng tư', 'video đã bị xóa', 'This video has been removed'],
    ageGate: ['Sign in to confirm your age', 'confirm your age', 'xác nhận tuổi của bạn', 'đăng nhập để xác nhận tuổi']
  };

  const visible = el => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();

  const sGet = keys => new Promise(res => {
    try { chrome.storage.local.get(keys, r => res(r || {})); } catch (_) { res({}); }
  });
  const sSet = obj => new Promise(res => {
    try { chrome.storage.local.set(obj, () => res(true)); } catch (_) { res(false); }
  });

  // ---- Định danh video/kênh ----
  function videoIdFromUrl(u) {
    const m = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(String(u || ''));
    return m ? m[1] : null;
  }
  function currentVideoId() { return videoIdFromUrl(location.href); }
  function isWatchPage() { return /^\/watch/.test(location.pathname); }
  function isShortsPage() { return /^\/shorts\//.test(location.pathname); }
  // Nhớ các video đã phân loại LIVE từ thẻ trong cùng tab: điều hướng SPA
  // giữ nguyên sessionStorage, còn phân loại lại trên /watch là lớp chắc
  // chắn thứ hai (detectLiveVideo bên dưới).
  const LIVE_IDS_KEY = 'avjpYoutubeNurtureLiveIds';
  function rememberLiveId(id) {
    if (!id) return;
    try {
      const arr = JSON.parse(sessionStorage.getItem(LIVE_IDS_KEY) || '[]');
      if (Array.isArray(arr) && !arr.includes(id)) {
        arr.push(id);
        sessionStorage.setItem(LIVE_IDS_KEY, JSON.stringify(arr.slice(-100)));
      }
    } catch (_) {}
  }
  function rememberedLiveId(id) {
    if (!id) return false;
    try {
      const arr = JSON.parse(sessionStorage.getItem(LIVE_IDS_KEY) || '[]');
      return Array.isArray(arr) && arr.includes(id);
    } catch (_) { return false; }
  }
  function channelKeyFromHref(href) {
    try {
      const p = new URL(href, location.origin).pathname;
      if (p.startsWith('/@')) return p.slice(1).split('/')[0]; // '@handle'
      const m = /^\/channel\/([A-Za-z0-9_-]+)/.exec(p);
      if (m) return m[1]; // UC...
      return null;
    } catch (_) { return null; }
  }

  // ---- Cổng an toàn: chưa đăng nhập / captcha -> dừng ngay ----
  function signinDialogOpen() {
    const dlg = document.querySelector('ytd-popup-container tp-yt-paper-dialog, tp-yt-paper-dialog[open]');
    return Boolean(dlg && dlg.querySelector('a[href*="ServiceLogin"], a[href*="accounts.google.com"]'));
  }
  function detectBlock() {
    const url = location.href;
    if (/ServiceLogin|accounts\.google\.com/i.test(url)) return 'Trang đăng nhập Google/YouTube';
    if (document.querySelector('iframe[src*="recaptcha"], #captcha, form[action*="/sorry/"]')) {
      return 'YouTube hiện captcha (trang /sorry hoặc recaptcha)';
    }
    if (signinDialogOpen()) return 'YouTube bật hộp thoại đăng nhập (chưa đăng nhập)';
    // Chưa đăng nhập: masthead có link ServiceLogin và KHÔNG có nút avatar.
    const mast = document.querySelector('ytd-masthead, #masthead');
    if (mast) {
      const signin = mast.querySelector('a[href*="ServiceLogin"]');
      const avatar = mast.querySelector('#avatar-btn, button#avatar-btn');
      if (signin && !avatar) return 'Chưa đăng nhập YouTube (masthead chỉ có nút Sign in)';
    }
    return null;
  }

  // ---- Thẻ video ở trang chủ / subscriptions / kênh ----
  // Ad: renderer quảng cáo riêng hoặc nằm trong slot quảng cáo; Shorts:
  // link /shorts/ hoặc shelf Shorts. Video hợp lệ = có link /watch?v=.
  function cardVideoLink(card) {
    // Neo chính: thumbnail. Neo cuối a#video-title là dự phòng cho trang
    // kết quả tìm kiếm (ytd-video-renderer có biến thể thumbnail không
    // khớp #thumbnail nhưng link tiêu đề vẫn trỏ thẳng /watch?v=); cả hai
    // đều dẫn tới cùng 1 video. Bấm mà SPA không chuyển trang thì vòng
    // lặp đã có dự phòng điều hướng thẳng theo href (xem nhánh bề mặt).
    const a = card.querySelector('a#thumbnail[href*="/watch?v="], a[href^="/watch?v="], a[href*="youtube.com/watch?v="], a#video-title[href*="/watch?v="]');
    return a || null;
  }
  function isAdCard(card) {
    if (card.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) return true;
    if (card.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) return true;
    return false;
  }
  function isShortsCard(card, link) {
    const href = link?.getAttribute('href') || '';
    if (href.startsWith('/shorts/')) return true;
    if (card.closest('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer')) return true;
    return false;
  }
  // LIVE trên thẻ: badge nằm trong overlay thumbnail (renderer cũ) hoặc
  // badge-shape của view-model mới. Chỉ đọc đúng vùng badge/overlay —
  // không quét text toàn thẻ (tiêu đề có chữ "live" không phải livestream).
  function isLiveCard(card) {
    if (!card) return false;
    if (card.querySelector(
      'ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"], ' +
      'ytd-thumbnail-overlay-live-status-renderer, ' +
      'badge-shape[class*="live" i], [class*="yt-badge-shape--thumbnail-live"], ' +
      '[class*="thumbnail-live" i]')) return true;
    const badges = card.querySelectorAll(
      'ytd-thumbnail-overlay-time-status-renderer #text, ' +
      'ytd-thumbnail-overlay-time-status-renderer, badge-shape, ' +
      '.badge-shape__text, .yt-thumbnail-overlay-badge-view-model__label');
    for (const el of badges) {
      const t = normalizeText(textOf(el)).toUpperCase();
      if (t === 'LIVE' || t === 'TRỰC TIẾP') return true;
      const label = String(el.getAttribute?.('aria-label') || '').trim().toUpperCase();
      if (label === 'LIVE' || label === 'TRỰC TIẾP') return true;
    }
    return false;
  }
  function findCards() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer').forEach(card => {
      const link = cardVideoLink(card);
      if (!link) return;
      const id = videoIdFromUrl(link.href);
      if (!id || seen.has(id)) return;
      if (isAdCard(card)) return;
      if (isShortsCard(card, link)) return;
      seen.add(id);
      out.push({ el: card, link, id, url: 'https://www.youtube.com/watch?v=' + id, live: isLiveCard(card) });
    });
    return out;
  }

  // ---- Player + xem thật ----
  const playerEl = () => document.querySelector('#movie_player');
  const videoEl = () => document.querySelector('#movie_player video, video.html5-main-video');
  function adShowing() {
    const p = playerEl();
    if (p && p.classList.contains('ad-showing')) return true;
    return Boolean(document.querySelector('.ytp-ad-player-overlay, .ytp-ad-module .ytp-ad-text'));
  }
  function clickSkipAd() {
    const btn = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button-modern');
    if (btn) { try { btn.click(); return true; } catch (_) {} }
    return false;
  }
  function playerErrorKind() {
    const err = document.querySelector('ytd-player-error-message-renderer, #player-error-message, yt-player-error-message-renderer');
    const scope = err ? textOf(err) : '';
    const head = scope || textOf(document.querySelector('ytd-watch-flexy')).slice(0, 1200);
    if (L.ageGate.some(s => head.includes(s))) return 'age_gate';
    if (L.unavailable.some(s => head.includes(s))) return 'unavailable';
    return null;
  }
  // Phân loại LIVE trên trang /watch — đa tín hiệu, chỉ tín hiệu cấu trúc/
  // player mới tính (không đoán theo tiêu đề): thuộc tính is-live-video
  // của ytd-watch-flexy, class/badge live của player, hoặc live chat đang
  // mở kèm duration vô hạn (đang phát trực tiếp thật).
  function detectLiveVideo() {
    if (!isWatchPage()) return false;
    if (rememberedLiveId(currentVideoId())) return true;
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy) {
      if (flexy.hasAttribute('is-live-video') || flexy.getAttribute('is-live-video') === 'true') return true;
      try { if (flexy.isLiveVideo === true) return true; } catch (_) {}
    }
    const p = playerEl();
    if (p) {
      if (p.classList.contains('ytp-live') || p.classList.contains('live-video')) return true;
      const badge = p.querySelector('.ytp-live-badge');
      if (badge && visible(badge)) return true;
    }
    const badge = document.querySelector('.ytp-live-badge');
    if (badge && visible(badge)) return true;
    const v = videoEl();
    const chat = document.querySelector('ytd-live-chat-frame, #chat-frame, ytd-live-chat-renderer');
    if (v && !Number.isFinite(v.duration) && v.readyState >= 1 && chat && visible(chat)) return true;
    return false;
  }
  // Chờ player sẵn sàng: có <video> + biết duration (hoặc live). Trả
  // {video, duration} hoặc {error}.
  async function waitPlayer(runId, store, timeoutMs = 14000, onProgress) {
    const end = Date.now() + timeoutMs;
    let lastPing = 0;
    while (Date.now() < end) {
      if (!(await store.alive(runId))) return { stopped: true };
      if (onProgress && Date.now() - lastPing >= 5000) {
        lastPing = Date.now();
        await onProgress();
      }
      const err = playerErrorKind();
      if (err) return { error: err };
      const v = videoEl();
      if (v && (Number.isFinite(v.duration) || v.readyState >= 1)) return { video: v };
      if (!(await store.waitCancellable(600, runId))) return { stopped: true };
    }
    const err = playerErrorKind();
    if (err) return { error: err };
    return { error: 'player_timeout' };
  }
  // Xem thật: tích luỹ giây xem từ currentTime (chỉ cộng delta dương nhỏ —
  // tua/seek không tính), thời gian quảng cáo KHÔNG tính. Trả {watched,
  // duration, ended, live}.
  async function watchVideo(store, runId, targetSec, onProgress) {
    let watched = 0, last = null, adWait = 0;
    let duration = NaN, live = false;
    let lastPing = 0;
    const hardEnd = Date.now() + (targetSec + 120) * 1000;
    while (Date.now() < hardEnd) {
      if (!(await store.alive(runId))) return { stopped: true, watched, duration };
      if (onProgress && Date.now() - lastPing >= 15000) {
        lastPing = Date.now();
        await onProgress();
      }
      const v = videoEl();
      if (!v) {
        if (!(await store.waitCancellable(800, runId))) return { stopped: true, watched, duration };
        continue;
      }
      if (Number.isFinite(v.duration) && v.duration > 0) duration = v.duration;
      live = detectLiveVideo() || !Number.isFinite(v.duration);
      if (adShowing()) {
        clickSkipAd();
        adWait += 1;
        last = null;
        if (adWait > 60) break; // quảng cáo kẹt quá lâu — chốt phần đã xem
        await store.waitCancellable(1000, runId);
        continue;
      }
      adWait = 0;
      // Promise.race + timeout 1.5s (2.6.0): play() có thể treo không
      // resolve/reject (autoplay policy/trạng thái player lạ) — không để
      // một lời gọi play() treo giết cả phiên; quá hạn thì vòng đo xem
      // tự quay lại ở nhịp kế tiếp.
      if (v.paused && !v.ended) {
        try { await Promise.race([v.play(), sleep(1500)]); } catch (_) {}
      }
      const ct = Number(v.currentTime) || 0;
      if (last != null) {
        const d = ct - last;
        if (d > 0 && d < 5) watched += d;
      }
      last = ct;
      if (v.ended) break;
      if (watched >= targetSec) break;
      if (!(await store.waitCancellable(1000, runId))) return { stopped: true, watched, duration };
    }
    const v = videoEl();
    return { watched, duration, ended: Boolean(v && v.ended), live };
  }

  // ---- Metadata video hiện tại (cho AI + journal + key kênh) ----
  function videoMeta() {
    const title = textOf(document.querySelector('ytd-watch-metadata h1, #title h1, h1.ytd-watch-metadata'))
      || document.title.replace(/ - YouTube$/, '');
    const chLink = document.querySelector('#owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a, #channel-name a');
    const channelUrl = chLink ? chLink.href : '';
    const channelKey = channelKeyFromHref(channelUrl);
    const channelName = textOf(chLink);
    const desc = textOf(document.querySelector('#description-inline-expander, ytd-text-inline-expander#description, #description')).slice(0, 600);
    return { title: title.slice(0, 300), channelKey, channelUrl, channelName, desc };
  }

  // ---- Like: neo = nút toggle trong cụm segmented like/dislike ----
  function likeButton() {
    const scope = document.querySelector('ytd-watch-metadata');
    if (!scope) return null;
    const seg = scope.querySelector('segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer');
    if (seg) {
      const inLike = seg.querySelector('like-button-view-model button, toggle-button-view-model button');
      if (inLike) return inLike;
      const first = seg.querySelector('button[aria-pressed]');
      if (first) return first;
    }
    // Dự phòng: nút aria-pressed đầu tiên trong vùng hành động, hoặc nút có
    // aria-label mở đầu bằng mẫu like EN/VI.
    const pressed = scope.querySelector('#top-level-buttons-computed button[aria-pressed]');
    if (pressed) return pressed;
    return [...scope.querySelectorAll('button')].find(b =>
      /^(like this video|thích video)/i.test(String(b.getAttribute('aria-label') || ''))) || null;
  }

  // ---- Subscribe: neo = renderer/view-model trong #owner ----
  function subscribeParts() {
    const scope = document.querySelector('ytd-watch-metadata #owner, #owner, ytd-video-owner-renderer');
    if (!scope) return null;
    const renderer = scope.querySelector('ytd-subscribe-button-renderer, subscribe-button-view-model, #subscribe-button');
    if (!renderer) return null;
    const btn = renderer.querySelector('button') || (renderer.tagName === 'BUTTON' ? renderer : null);
    if (!btn) return null;
    return { renderer, btn };
  }
  function isSubscribed(parts) {
    if (!parts) return false;
    if (parts.renderer.hasAttribute && parts.renderer.hasAttribute('subscribed')) return true;
    const label = String(parts.btn.getAttribute('aria-label') || '');
    const txt = textOf(parts.btn);
    return L.subscribedText.some(s => txt === s || label.startsWith(s))
      || /^(subscribed|đã đăng ký)/i.test(label);
  }

  // ---- Comment: ô soạn trong ytd-comment-simplebox-renderer ----
  function commentBoxParts() {
    const box = document.querySelector('ytd-comment-simplebox-renderer');
    if (!box) return null;
    const editable = box.querySelector('#contenteditable-root[contenteditable="true"], div[contenteditable="true"]');
    const placeholder = box.querySelector('#simplebox-placeholder');
    const submitWrap = box.querySelector('#submit-button');
    const submitBtn = submitWrap ? (submitWrap.querySelector('button') || submitWrap) : null;
    return { box, editable, placeholder, submitBtn };
  }
  function existingCommentTexts() {
    const out = [];
    document.querySelectorAll('#comments #content-text').forEach(el => {
      const t = textOf(el);
      if (t) out.push(t);
    });
    return out.slice(0, 20);
  }
  function signatureInComments(text) {
    const frag = commentSignature(text).slice(0, 60);
    if (!frag) return null;
    const nodes = document.querySelectorAll('#comments #content-text');
    for (const el of nodes) {
      if (normalizeText(el.textContent || '').includes(frag)) return el;
    }
    return null;
  }
  function commentsOff() {
    const c = document.querySelector('ytd-comments, #comments');
    if (!c) return false;
    const t = c.textContent || '';
    return L.commentsOff.some(s => t.includes(s));
  }
  // #comments coi là đã render khi trong nó có ít nhất một cấu trúc thật
  // (simplebox / item-section / header) — thẻ ytd-comments rỗng hoặc chưa
  // được YouTube điền nội dung thì chưa tính, để vòng chờ 15s chốt skip.
  function commentsSectionRendered() {
    const c = document.querySelector('ytd-comments, #comments');
    if (!c) return false;
    if (commentsOff()) return true;
    return Boolean(c.querySelector(
      'ytd-comment-simplebox-renderer, ytd-item-section-renderer, ' +
      'ytd-comments-header-renderer, #header'));
  }
  // Hộp thoại bắt tạo kênh (2.6.1 — bằng chứng live: tài khoản trong
  // profile công nhân CHƯA CÓ kênh YouTube): bấm ô comment thì YouTube
  // hiện dialog tạo kênh (nút/link "Tạo kênh" / "Create channel") thay
  // cho editor. Quét các dialog ĐANG HIỆN — thấy nút tạo kênh bên trong
  // là kết luận channel_required: journal skipped + tắt comment cho
  // phần còn lại của phiên, KHÔNG chờ treo, KHÔNG thử lại.
  function channelCreationDialog() {
    const dialogs = document.querySelectorAll(
      'ytd-modal-with-title-and-button-renderer, tp-yt-paper-dialog, [role="dialog"]');
    for (const d of dialogs) {
      if (!visible(d)) continue;
      const hit = [...d.querySelectorAll('button, a')]
        .find(el => /tạo kênh|create channel/i.test(textOf(el)));
      if (hit) return d;
    }
    return null;
  }

  let errTaskId = '';
  (async () => {
    const stored = await sGet(CANONICAL_KEY);
    const run = stored[CANONICAL_KEY];
    if (!run || run.platform !== PLATFORM || run.type !== 'nurture') return;
    const taskId = String(run.task_id || run.id || '');
    const runId = String(run.run_id || taskId);
    if (!taskId) return;
    errTaskId = taskId;

    const store = globalThis.AVJP.nurture.createStore({ prefix: PREFIX });

    // --- Session dựng lại từ Journal của run này: adapter bị inject lại
    // sau mỗi lần tải trang (runner onUpdated) và sau reload, journal là
    // nguồn sự thật duy nhất cho số đếm phiên — không tin biến trong trang.
    const session = { like: 0, comment: 0, save: 0, follow: 0, uncertain: 0, skipped: 0, watched: 0 };
    const processedIds = new Set();
    async function rebuildSession() {
      const j = await store.getJournal(runId);
      session.like = 0; session.comment = 0; session.follow = 0;
      session.uncertain = 0; session.watched = 0; processedIds.clear();
      for (const e of j) {
        if (e.status === 'success' && ['like', 'comment', 'follow'].includes(e.action)) session[e.action]++;
        if (e.action === 'watch' && e.status === 'success') { session.watched++; if (e.target) processedIds.add(e.target); }
        if (e.status === 'uncertain') session.uncertain++;
        if (e.target && ['like', 'comment', 'follow'].includes(e.action) && e.status === 'success') processedIds.add(e.target);
      }
    }
    await rebuildSession();

    let doneSent = false;
    async function sendProgress() {
      try {
        const today = await store.todayCounters();
        chrome.runtime.sendMessage({
          action: 'nurtureProgress', taskId, platform: PLATFORM,
          counters: { today, session: { ...session } }
        }).catch(() => {});
      } catch (_) {}
    }
    // Chờ proof theo từng đoạn tối đa 5s + nurtureProgress giữa các đoạn:
    // tổng thời gian vẫn bị deadline cứng timeoutMs chặn, poll vẫn qua
    // waitForProof/alive của lõi, nhưng kernel nhận heartbeat đều trong
    // lúc chờ dài (render comment/proof comment) thay vì im lặng cả pha.
    async function waitProofWithProgress(checkFn, timeoutMs, intervalMs = 600) {
      let remaining = Math.max(0, Number(timeoutMs) || 0);
      while (remaining > 0) {
        const chunk = Math.min(5000, remaining);
        const v = await store.waitForProof(checkFn, { timeoutMs: chunk, intervalMs, runId });
        if (v) return v;
        remaining -= chunk;
        if (remaining > 0) {
          if (!(await store.alive(runId))) return null;
          await sendProgress();
        }
      }
      return null;
    }
    // Chờ mốc NextAllowedAt theo đoạn 5s + heartbeat (thay cho 1 lần
    // waitNextAllowed dài im lặng của lõi — cùng deadline/mốc, cùng huỷ).
    async function waitCommentGap() {
      // Deadline cứng phụ 10 phút: NextAllowedAt bình thường chỉ cách
      // 45–120s; mốc bất thường xa hơn thế thì không để pha comment treo
      // vô hạn — hết cap thì quay lại kiểm tra alive và đi tiếp.
      const hardEnd = Date.now() + 10 * 60 * 1000;
      while (Date.now() < hardEnd) {
        const s = await store.getState();
        const until = Number(s[store.K('NextAllowedAt')]) || 0;
        const remain = until - Date.now();
        if (remain <= 0) return store.alive(runId);
        if (!(await store.waitCancellable(Math.min(5000, remain), runId))) return false;
        await sendProgress();
      }
      return store.alive(runId);
    }
    async function sendDone(status, failureCode, message) {
      if (doneSent) return;
      doneSent = true;
      const journal = await store.getJournal(runId);
      const items = journal
        .filter(e => ['like', 'comment', 'save', 'follow'].includes(e.action))
        .map(e => ({
          action: e.action, target_url: e.url || '', status: e.status,
          note: e.note || '', ...(e.content ? { content: e.content, source: e.source || '' } : {})
        }));
      try {
        await chrome.runtime.sendMessage({
          action: 'nurtureDone', taskId, platform: PLATFORM,
          status, failure_code: failureCode || null,
          resultMessage: message, items
        });
      } catch (err) {
        console.error('[Auto vjp][youtube-nurture] Không gửi được nurtureDone', err);
      }
    }

    // --- Cấu hình: core defaults <- storage.sync <- payload task (task thắng)
    const cfg = await store.getSyncConfig();
    const flag = (v, def) => (v === undefined ? def : Boolean(v));
    const enabled = {
      like: flag(run.like_enabled, true),
      // subscribe của YouTube dùng kênh follow của lõi (như X: bookmark->save);
      // chấp nhận cả subscribe_enabled/subscribe_pct lẫn follow_*.
      follow: flag(run.subscribe_enabled, flag(run.follow_enabled, false)),
      comment: flag(run.comment_enabled, true)
    };
    const pctOf = (own, base) => {
      const n = Number(run[own]);
      if (Number.isFinite(n)) return clampInt(n, cfg[base], 0, 100);
      const m = Number(run[base.toLowerCase() + '_pct']);
      return Number.isFinite(m) ? clampInt(m, cfg[base], 0, 100) : cfg[base];
    };
    cfg.likePct = pctOf('like_pct', 'likePct');
    cfg.commentPct = pctOf('comment_pct', 'commentPct');
    cfg.followPct = (() => {
      const s = Number(run.subscribe_pct);
      if (Number.isFinite(s)) return clampInt(s, cfg.followPct, 0, 100);
      const f = Number(run.follow_pct);
      return Number.isFinite(f) ? clampInt(f, cfg.followPct, 0, 100) : cfg.followPct;
    })();
    if (run.prompt) cfg.prompt = String(run.prompt);
    if (Number(run.comment_gap_min) > 0) cfg.commentGapMin = Number(run.comment_gap_min);
    if (Number(run.comment_gap_max) > 0) cfg.commentGapMax = Math.max(Number(run.comment_gap_max), cfg.commentGapMin);
    const maxMinutes = clampInt(run.max_minutes, 10, 1, 120);
    const maxActions = clampInt(run.max_actions, 8, 1, 100);
    const watchTarget = clampInt(run.watch_count, 5, 1, 50);
    const watchMinSec = clampInt(run.watch_min_seconds, 30, 10, 600);
    const watchMaxSec = clampInt(run.watch_max_seconds, 90, watchMinSec, 900);
    const templates = (Array.isArray(run.comment_templates) ? run.comment_templates
      : Array.isArray(run.reply_templates) ? run.reply_templates : [])
      .map(s => String(s || '').trim()).filter(Boolean);

    // --- Xoay nguồn (2.5.1): thứ tự cố định trang chủ -> subscriptions ->
    // tìm kiếm. Nguồn tìm kiếm = task.source_url nếu task có; không thì
    // /results?search_query=<task.search_query, mặc định "tin tức hôm nay">.
    // Nhận diện nguồn hiện tại bằng URL; bề mặt không thuộc 3 nguồn (vd
    // trang kênh) thì lấy theo cursor đã lưu.
    const SOURCES = [
      { name: 'trang chủ', url: 'https://www.youtube.com' },
      { name: 'subscriptions', url: 'https://www.youtube.com/feed/subscriptions' },
      { name: 'tìm kiếm', url: (() => {
          if (run.source_url) return String(run.source_url);
          const q = String(run.search_query || 'tin tức hôm nay');
          return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
        })() }
    ];
    function sourceIndexByUrl() {
      const p = location.pathname;
      if (p === '/feed/subscriptions') return 1;
      if (p === '/results') return 2;
      if (p === '/' || p === '') return 0;
      return -1;
    }
    async function currentSourceIdx() {
      const byUrl = sourceIndexByUrl();
      if (byUrl >= 0) return byUrl;
      const s = await sGet(store.K('Source'));
      const n = Number(s[store.K('Source')]);
      return Number.isFinite(n) ? clampInt(n, 0, 0, SOURCES.length - 1) : 0;
    }

    // --- Mở phiên: đúng run này đã Active (inject lại) -> resume, không
    // reset Done*; ngược lại persist run TRƯỚC khi đụng trang. Deadline lưu
    // ở key <prefix>Deadline (cùng họ state) để reload không gia hạn phiên.
    // Cursor nguồn lưu ở key <prefix>Source cạnh đó (2.5.1).
    const prev = await store.getState();
    const resuming = prev[store.K('Active')] && prev[store.K('RunId')] === runId;
    let deadline;
    // Cờ channel_required (2.6.1): tài khoản chưa có kênh -> comment bị
    // tắt cho phần còn lại của phiên. Cờ lưu ở key <prefix>NoChannel
    // cạnh Deadline/Source để bản inject mới sau điều hướng vẫn nhớ.
    let noChannel = false;
    const markNoChannel = async () => {
      noChannel = true;
      await sSet({ [store.K('NoChannel')]: true });
    };
    // Cờ reload-pha-comment (2.6.4): video id mà doComment đã xin
    // reload 1 lần để thoát trang watch kiểu SPA (ô soạn không nạp).
    // Lưu ở key <prefix>CommentReload cạnh Deadline/Source/NoChannel
    // để bản inject mới sau reload biết phải chạy lại doComment cho
    // đúng video đó; reset khi mở run mới, xoá khi phiên kết thúc.
    let commentReloadId = '';
    if (!resuming) {
      await store.startRun({ runId, taskId, config: { ...cfg, enabled, maxMinutes, maxActions, watchTarget, watchMinSec, watchMaxSec } });
      deadline = Date.now() + maxMinutes * 60 * 1000;
      await sSet({ [store.K('Deadline')]: deadline, [store.K('Source')]: Math.max(0, sourceIndexByUrl()), [store.K('NoChannel')]: false, [store.K('CommentReload')]: '' });
    } else {
      const d = await sGet([store.K('Deadline'), store.K('Source'), store.K('NoChannel'), store.K('CommentReload')]);
      deadline = Number(d[store.K('Deadline')]) || (Date.now() + maxMinutes * 60 * 1000);
      noChannel = d[store.K('NoChannel')] === true;
      commentReloadId = String(d[store.K('CommentReload')] || '');
      if (d[store.K('Source')] === undefined) {
        await sSet({ [store.K('Source')]: Math.max(0, sourceIndexByUrl()) });
      }
    }
    await store.claimOwner(runId).catch(() => {});
    await store.setStatus(resuming ? 'Resume phiên nuôi YouTube' : 'Đang nuôi YouTube (trang chủ/video)');
    const progressTimer = setInterval(sendProgress, 30000);

    const finish = async (status, code, msg) => {
      clearInterval(progressTimer);
      await sSet({ [store.K('CommentReload')]: '' });
      await store.finishRun(msg);
      await sendDone(status, code, msg);
    };

    const block0 = detectBlock();
    if (block0) {
      await finish('failed', 'session_expired', block0 + ' — dừng phiên, không tự giải.');
      return;
    }

    const roll = pct => Math.random() * 100 < pct;
    const totalActions = () => session.like + session.comment + session.follow;

    // ---------- Hành động trên 1 video ----------
    async function doLike(id, url) {
      const btn = likeButton();
      if (!btn) return 'not_found';
      if (btn.getAttribute('aria-pressed') === 'true') return 'already';
      btn.click();
      // Proof: aria-pressed lật sang true trong tối đa 3s (re-query mỗi
      // vòng vì YouTube render lại cụm nút sau khi bấm).
      const proof = await store.waitForProof(
        () => {
          const b = likeButton();
          return b && b.getAttribute('aria-pressed') === 'true' ? b : null;
        },
        { timeoutMs: 3000, intervalMs: 300, runId });
      if (signinDialogOpen()) return 'blocked';
      if (proof) {
        await store.recordProof('like', { id, url, runId });
        session.like++;
        await store.journal({ runId, platform: PLATFORM, action: 'like', target: id, url, status: 'success', note: 'proof: aria-pressed lật true' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'like', target: id, url, status: 'uncertain', note: 'bấm Like nhưng aria-pressed không lật true sau 3s' });
      return 'uncertain';
    }

    async function doSubscribe(meta, url) {
      const key = meta.channelKey;
      if (!key) return 'not_found';
      const parts = subscribeParts();
      if (!parts) return 'not_found';
      if (isSubscribed(parts)) return 'already';
      parts.btn.click();
      // Proof đa tín hiệu trong 3s: renderer mang [subscribed] / text nút
      // lật Subscribed / aria-label đổi.
      const proof = await store.waitForProof(
        () => {
          const p2 = subscribeParts();
          return p2 && isSubscribed(p2) ? p2 : null;
        },
        { timeoutMs: 3000, intervalMs: 300, runId });
      if (signinDialogOpen()) return 'blocked';
      if (proof) {
        // subscribe -> kênh 'follow' của lõi, key đích = kênh (như plan:
        // trần follow/subscribe 5/ngày, mỗi kênh 1 lần).
        await store.recordProof('follow', { id: key, url: meta.channelUrl || url, runId, note: 'subscribe' });
        session.follow++;
        await store.journal({ runId, platform: PLATFORM, action: 'follow', target: key, url: meta.channelUrl || url, status: 'success', note: 'proof subscribe: nút lật trạng thái Subscribed' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'follow', target: key, url: meta.channelUrl || url, status: 'uncertain', note: 'bấm Subscribe nhưng trạng thái không đổi sau 3s' });
      return 'uncertain';
    }

    async function doComment(id, url, meta) {
      // Chốt chặn cuối cho video live: processWatchUnit đã loại comment
      // khỏi kế hoạch, nhưng nếu live chỉ lộ dấu hiệu sau khi xem thì
      // doComment cũng tự dừng tại đây — không cuộn xuống #comments,
      // không chờ khung comment thường trên trang chỉ có live chat.
      if (detectLiveVideo() || rememberedLiveId(id)) return 'live_skipped';
      // Backstop 2.6.1: cờ channel_required đã bật ở video trước -> vòng
      // hành động đã journal skipped; lạc vào đây thì dừng êm, không mở ô.
      if (noChannel) return 'skipped';
      if (!(await waitCommentGap())) return 'stopped';
      const body = [meta.title, meta.channelName ? 'Kênh: ' + meta.channelName : '', meta.desc]
        .filter(Boolean).join('\n').slice(0, 1200);
      if (body.length < 10) return 'not_found';
      // Cuộn tới vùng comment và chờ #comments RENDER THẬT tối đa 15s
      // trước khi tốn lượt AI: quá hạn thì chốt skipped ngay trên video
      // này, không bước sang vòng chờ ô comment thứ hai.
      // Cuộn TỨC THỜI (không smooth) và LẶP LẠI trong mỗi vòng poll
      // (2.6.2 — bằng chứng live: cuộn smooth 1 lần ở đầu pha bị trang
      // SPA nuốt/reset, probe giữa lúc module chạy thấy scrollY = 0,
      // #comments chưa vào viewport nên YouTube không lazy-load nội
      // dung comment; probe tay với cuộn tức thời thì simplebox hiện
      // đầy đủ — selector không đổi).
      const scrollCommentsIntoView = () => {
        const a = document.querySelector('ytd-comments, #comments');
        if (!a) { window.scrollBy(0, Math.floor(window.innerHeight * 1.2)); return; }
        a.scrollIntoView({ block: 'start' });
        const r = a.getBoundingClientRect();
        if (r.top > window.innerHeight || r.top < -200) window.scrollBy(0, r.top - 80);
      };
      scrollCommentsIntoView();
      const sectionReady = await waitProofWithProgress(
        () => {
          scrollCommentsIntoView();
          if (commentsOff()) return 'off';
          return commentsSectionRendered() ? 'section' : null;
        },
        15000, 600);
      if (sectionReady === 'off') {
        await store.markDead(id, 'comments_off', cfg.deadDays);
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'video tắt bình luận' });
        return 'skipped';
      }
      if (!sectionReady) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: '#comments không render sau 15s — chốt skipped, không chờ lại trên cùng video' });
        return 'skipped';
      }
      let text = null, source = 'ai';
      await sendProgress();
      const ai = await store.requestAiComment({ postText: body, cfg, runId, provider: run.ai_provider });
      await sendProgress();
      if (ai.stopped) return 'stopped';
      if (ai.text) text = ai.text;
      if (!text && templates.length) {
        text = templates[Math.floor(Math.random() * templates.length)];
        source = 'template';
      }
      if (!text) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'AI lỗi (' + (ai.error || '?') + ') và không có mẫu dự phòng' });
        return 'skipped';
      }
      // #comments đã render ở bước trên; giờ chỉ chờ Ô COMMENT xuất hiện,
      // vẫn deadline cứng 15s + heartbeat. Không thấy -> skipped (không
      // markDead như lỗi selector, không chờ lại trên cùng video).
      // Vòng này cũng cuộn tức thời lại mỗi vòng poll (2.6.2, cùng lý
      // do ở vòng chờ render phía trên): trang có thể đã bị đẩy về đầu
      // trong lúc xin AI, #comments rời viewport là simplebox bị gỡ.
      const boxCheck = () => {
        scrollCommentsIntoView();
        if (commentsOff()) return 'off';
        if (channelCreationDialog()) return 'channel';
        const p = commentBoxParts();
        return p && (p.placeholder || p.editable) ? p : null;
      };
      // Nửa đầu ngân sách 15s (7,5s): chờ trong trang hiện tại như cũ.
      let boxReady = await waitProofWithProgress(boxCheck, 7500, 600);
      if (!boxReady) {
        // Vá 2.6.4: quá nửa ngân sách mà simplebox vẫn chưa xuất hiện
        // trên trang watch tới bằng chuyển SPA -> thử lại bằng TẢI
        // TRANG ĐẦY ĐỦ đúng 1 lần cho video này (cơ chế + điều kiện ở
        // comment đầu file). Ghi cờ TRƯỚC khi reload; bản inject mới
        // resume ở vòng lặp chính, doComment chạy lại từ đầu trên
        // trang tải đầy đủ (chờ render + cuộn lặp 2.6.2 như thường).
        const enoughTime = deadline - Date.now() > 90000;
        if (enoughTime && commentReloadId !== id
          && !detectLiveVideo() && !rememberedLiveId(id)) {
          commentReloadId = id;
          await sSet({ [store.K('CommentReload')]: id });
          await store.setStatus('Nuôi YouTube: tải lại trang để mở ô comment');
          location.reload();
          // Document sắp bị huỷ — chờ dài để điều hướng thật sự xảy
          // ra, không chạy tiếp logic trong trang đang chết. Nếu
          // reload không xảy ra (hiếm) thì rơi xuống chờ nốt nửa
          // ngân sách bên dưới như chưa từng reload.
          await store.waitCancellable(30000, runId);
        }
        if (!boxReady) boxReady = await waitProofWithProgress(boxCheck, 7500, 600);
      }
      if (boxReady === 'off') {
        await store.markDead(id, 'comments_off', cfg.deadDays);
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'video tắt bình luận' });
        return 'skipped';
      }
      if (boxReady === 'channel') {
        // Tài khoản chưa có kênh: YouTube bắt tạo kênh mới cho comment.
        // Tắt comment cho phần còn lại của phiên (cờ NoChannel), phiên
        // vẫn xem/like bình thường — không chờ, không thử lại.
        await markNoChannel();
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'channel_required: tài khoản chưa có kênh YouTube — tắt comment cho phần còn lại của phiên', content: text, source });
        return 'skipped';
      }
      if (!boxReady) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: '#comments đã render nhưng ô comment không xuất hiện sau 15s — chốt skipped, không chờ lại trên cùng video', content: text, source });
        return 'skipped';
      }
      if (isNearDuplicate(text, existingCommentTexts()) || isNearDuplicate(text, [body])) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'câu comment gần trùng nội dung đã có — bỏ theo kỷ luật gốc', content: text, source });
        return 'skipped';
      }
      let parts = boxReady;
      if (!parts.editable && parts.placeholder) {
        parts.placeholder.click();
        // Bấm placeholder là thời điểm dialog tạo kênh bật lên (nếu tài
        // khoản chưa có kênh) — checkFn poll cả dialog trong lúc chờ.
        const opened = await waitProofWithProgress(
          () => {
            if (channelCreationDialog()) return 'channel';
            const p = commentBoxParts();
            return p && p.editable ? p : null;
          },
          5000, 300);
        if (opened === 'channel') {
          await markNoChannel();
          await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'channel_required: tài khoản chưa có kênh YouTube — tắt comment cho phần còn lại của phiên', content: text, source });
          return 'skipped';
        }
        if (!opened) {
          await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'bấm ô comment nhưng editor không mở', content: text, source });
          return 'not_found';
        }
        parts = opened;
      }
      // Gõ: insertText trước; editor của YouTube nuốt cả cục thì gõ từng ký tự.
      const ed = parts.editable;
      ed.focus();
      try { ed.click(); } catch (_) {}
      if (!(await store.waitCancellable(300, runId))) return 'stopped';
      try { document.execCommand('insertText', false, text); } catch (_) {}
      if (!normalizeText(ed.textContent).includes(normalizeText(text).slice(0, 20))) {
        for (const ch of text) {
          try { document.execCommand('insertText', false, ch); } catch (_) { break; }
        }
      }
      if (!normalizeText(ed.textContent).includes(normalizeText(text).slice(0, 20))) {
        ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      if (!(await store.waitCancellable(500, runId))) return 'stopped';
      const fresh = commentBoxParts();
      const submitBtn = (fresh && fresh.submitBtn) || parts.submitBtn;
      if (!submitBtn) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'không thấy nút gửi comment', content: text, source });
        return 'not_found';
      }
      submitBtn.click();
      // Proof: chữ ký comment hiện trong danh sách (YouTube render chậm —
      // tối đa 15s). Không thấy = uncertain, KHÔNG gửi lại (luật gốc).
      const proof = await waitProofWithProgress(
        () => signatureInComments(text),
        15000, 700);
      if (signinDialogOpen() && !proof) return 'blocked';
      if (proof) {
        await store.recordProof('comment', { id, url, runId, note: 'source:' + source });
        session.comment++;
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'success', note: 'proof: comment hiện trong danh sách (chữ ký)', content: text, source });
        await store.setNextAllowed(cfg);
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'uncertain', note: 'đã gửi nhưng comment không hiện sau 15s', content: text, source });
      await store.setNextAllowed(cfg);
      return 'uncertain';
    }

    // ---------- Xử lý 1 video trên trang /watch ----------
    async function processWatchUnit(id) {
      const url = 'https://www.youtube.com/watch?v=' + id;
      if (processedIds.has(id)) return 'skipped';
      if (await store.isDead(id)) { session.skipped++; return 'skipped'; }
      // Đã comment trọn đời (core chặn) + đã like -> coi như đã nuôi xong.
      if ((await store.hasHistory('comment', id)) && (await store.hasHistory('like', id))) {
        session.skipped++;
        return 'skipped';
      }
      const ready = await waitPlayer(runId, store, 14000, sendProgress);
      if (ready.stopped) return 'stopped';
      if (ready.error) {
        await store.markDead(id, 'player_' + ready.error, cfg.deadDays);
        await store.journal({ runId, platform: PLATFORM, action: 'watch', target: id, url, status: 'skipped', note: 'player: ' + ready.error });
        session.skipped++;
        return 'skipped';
      }
      const meta = videoMeta();
      // Thời lượng xem: ngẫu nhiên watchMin..watchMax giây; video ngắn hơn
      // thì xem tới hết (target = duration khi duration < max).
      let target = rnd(watchMinSec, watchMaxSec);
      const dur = ready.video ? ready.video.duration : NaN;
      if (Number.isFinite(dur) && dur > 0 && dur < target) target = Math.max(10, Math.floor(dur));
      const w = await watchVideo(store, runId, target, sendProgress);
      if (w.stopped) return 'stopped';
      const need = Math.min(target, Math.max(10, (Number.isFinite(w.duration) ? w.duration : target)));
      const watchOk = w.ended || w.watched >= need * 0.8;
      if (!watchOk) {
        await store.journal({ runId, platform: PLATFORM, action: 'watch', target: id, url, status: 'skipped', note: `xem dở ${Math.round(w.watched)}s/${Math.round(need)}s — không tính` });
        session.skipped++;
        processedIds.add(id);
        return 'skipped';
      }
      // Phân loại live chốt lại SAU khi xem (badge/player/chat chỉ rõ
      // khi player đã chạy): nhớ lại id để các lớp sau không phân loại lại.
      const liveVideo = Boolean(w.live || detectLiveVideo() || rememberedLiveId(id));
      if (liveVideo) rememberLiveId(id);
      // WATCH không có kênh trong ACTIONS của lõi: ghi journal 'watch' +
      // counters.watch qua bumpCounters (KHÔNG map sang like — xem MODULE.md).
      await store.journal({ runId, platform: PLATFORM, action: 'watch', target: id, url, status: 'success', note: `xem thật ${Math.round(w.watched)}s${Number.isFinite(w.duration) ? '/' + Math.round(w.duration) + 's' : ''}${liveVideo ? ' (live)' : ''}` });
      await store.bumpCounters({ watch: 1 });
      session.watched++;
      processedIds.add(id);
      await sendProgress();

      // Hành động sau xem — comment để CUỐI (phải cuộn khỏi player).
      const plan = [];
      if (enabled.like && roll(cfg.likePct)) plan.push('like');
      if (enabled.follow && roll(cfg.followPct)) plan.push('follow');
      // Live: vẫn xếp 'comment' vào cuối kế hoạch khi comment đang bật
      // để vòng hành động ghi journal skipped đúng vị trí pha comment —
      // nhưng khi tới lượt sẽ bị chặn tại chỗ, không gọi doComment.
      if (enabled.comment && (liveVideo || roll(cfg.commentPct))) plan.push('comment');
      let acted = false;
      for (const action of plan) {
        if (totalActions() >= maxActions || Date.now() >= deadline) break;
        // Autoplay có thể đã đổi video — không tương tác nhầm video khác.
        if (currentVideoId() !== id) {
          await store.journal({ runId, platform: PLATFORM, action, target: id, url, status: 'skipped', note: 'autoplay đã chuyển video — bỏ hành động còn lại' });
          break;
        }
        if (action === 'comment' && (liveVideo || detectLiveVideo() || rememberedLiveId(id))) {
          // Trang live không có khung comment thường (chỉ live chat):
          // bỏ qua tại chỗ, không cuộn/không chờ #comments trên video này.
          await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'video live — bỏ qua comment' });
          continue;
        }
        if (action === 'comment' && noChannel) {
          // Tài khoản chưa có kênh (2.6.1): comment đã bị tắt từ video
          // trước trong cùng phiên — bỏ qua tại chỗ, không mở ô comment.
          await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'channel_required: tài khoản chưa có kênh YouTube — comment đã tắt cho phần còn lại của phiên' });
          continue;
        }
        let gateKey = id;
        if (action === 'follow') {
          if (!meta.channelKey) continue;
          gateKey = meta.channelKey;
        }
        const gate = await store.canDo(action, gateKey, cfg);
        if (!gate.ok) {
          await store.journal({ runId, platform: PLATFORM, action, target: gateKey, url, status: 'skipped', note: 'trần: ' + gate.reason });
          continue;
        }
        let r = 'not_found';
        if (action === 'like') r = await doLike(id, url);
        else if (action === 'follow') r = await doSubscribe(meta, url);
        else if (action === 'comment') r = await doComment(id, url, meta);
        if (r === 'stopped') return 'stopped';
        if (r === 'blocked') return 'blocked';
        if (r === 'success' || r === 'uncertain') {
          acted = true;
          await sendProgress();
          if (!(await store.waitCancellable(rnd(cfg.postMin, cfg.postMax) * 1000, runId))) return 'stopped';
        } else if (r === 'not_found' && action !== 'follow') {
          await store.markDead(id, 'selector_not_found:' + action, 1);
        }
      }
      return acted ? 'acted' : 'watched';
    }

    // ---------- Điều hướng ----------
    // Chờ URL chuyển sang /watch có video khác (SPA hoặc reload đều được —
    // reload thì trang này chết, bản inject mới resume từ journal).
    async function waitWatchUrl(prevId, timeoutMs = 12000) {
      const end = Date.now() + timeoutMs;
      let lastPing = 0;
      while (Date.now() < end) {
        if (!(await store.alive(runId))) return 'stopped';
        const id = currentVideoId();
        if (isWatchPage() && id && id !== prevId && videoEl()) return id;
        if (Date.now() - lastPing >= 5000) {
          lastPing = Date.now();
          await sendProgress();
        }
        if (!(await store.waitCancellable(500, runId))) return 'stopped';
      }
      return null;
    }
    async function goNextFromWatch(currentId) {
      const rel = document.querySelectorAll('#related ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer');
      for (const r of rel) {
        const link = r.querySelector('a#thumbnail[href*="/watch?v="], a[href^="/watch?v="]');
        if (!link) continue;
        const nid = videoIdFromUrl(link.href);
        if (!nid || nid === currentId || processedIds.has(nid)) continue;
        if (await store.isDead(nid)) continue;
        link.click();
        const got = await waitWatchUrl(currentId);
        if (got === 'stopped') return 'stopped';
        if (got) return 'ok';
        break; // bấm mà không chuyển trang -> xuống dự phòng lockup
      }
      // Dự phòng (2.6.0): cột gợi ý thế hệ markup mới dùng
      // yt-lockup-view-model thay ytd-compact-video-renderer — bắt link
      // /watch?v= bên trong lockup và đi cùng luồng bấm -> chờ URL.
      const lockups = document.querySelectorAll('#related yt-lockup-view-model, ytd-watch-next-secondary-results-renderer yt-lockup-view-model');
      for (const lk of lockups) {
        const link = lk.querySelector('a[href*="/watch?v="]');
        if (!link) continue;
        const nid = videoIdFromUrl(link.href);
        if (!nid || nid === currentId || processedIds.has(nid)) continue;
        if (await store.isDead(nid)) continue;
        link.click();
        const got = await waitWatchUrl(currentId);
        if (got === 'stopped') return 'stopped';
        if (got) return 'ok';
        break; // bấm mà không chuyển trang -> về trang chủ cho chắc
      }
      location.href = 'https://www.youtube.com';
      return 'home';
    }
    async function watchShortsBriefly(id) {
      // Shorts lạc vào: chỉ xem ngắn, không tương tác (lát này).
      const wait = rnd(8, 15) * 1000;
      if (!(await store.waitCancellable(wait, runId))) return 'stopped';
      await store.journal({ runId, platform: PLATFORM, action: 'watch', target: id, url: location.href, status: 'success', note: 'shorts — chỉ xem, không tương tác' });
      await store.bumpCounters({ watch: 1 });
      session.watched++;
      processedIds.add(id);
      location.href = 'https://www.youtube.com';
      return 'ok';
    }

    // --- Vòng lặp phiên ---
    let stopped = false, blocked = null, emptyRounds = 0;
    while (Date.now() < deadline && session.watched < watchTarget && totalActions() < maxActions) {
      if (!(await store.alive(runId))) { stopped = true; break; }
      blocked = detectBlock();
      if (blocked) break;
      await rebuildSession();
      if (session.watched >= watchTarget || totalActions() >= maxActions) break;

      if (isShortsPage()) {
        const sid = location.pathname.split('/')[2] || 'shorts';
        if (!processedIds.has(sid)) {
          const r = await watchShortsBriefly(sid);
          if (r === 'stopped') { stopped = true; break; }
        } else {
          location.href = 'https://www.youtube.com';
          await store.waitCancellable(1500, runId);
        }
        continue;
      }

      if (isWatchPage()) {
        const id = currentVideoId();
        if (!id) { location.href = 'https://www.youtube.com'; await store.waitCancellable(1500, runId); continue; }
        if (commentReloadId && commentReloadId === id) {
          // Resume pha comment sau reload (2.6.4): video này đã xem +
          // journal watch success nên id nằm trong processedIds, nhưng
          // doComment của bản inject trước đã ghi cờ rồi reload vì ô
          // soạn không nạp trên trang SPA. Gỡ cờ STORAGE ngay (một lần
          // duy nhất — bản inject sau không resume lặp); cờ LOCAL giữ
          // nguyên === id trong lúc chạy lại doComment để chính
          // doComment không reload lần 2 cho cùng video, chạy xong
          // mới xoá local. Xem/like không làm lại (đã có journal).
          await sSet({ [store.K('CommentReload')]: '' });
          const url = 'https://www.youtube.com/watch?v=' + id;
          let rr = null;
          if (enabled.comment && !noChannel && Date.now() < deadline && totalActions() < maxActions) {
            const gate = await store.canDo('comment', id, cfg);
            if (!gate.ok) {
              await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'trần: ' + gate.reason });
            } else {
              rr = await doComment(id, url, videoMeta());
              if (rr === 'live_skipped') {
                await store.journal({ runId, platform: PLATFORM, action: 'comment', target: id, url, status: 'skipped', note: 'video live — bỏ qua comment' });
              } else if (rr === 'not_found') {
                await store.markDead(id, 'selector_not_found:comment', 1);
              }
            }
          }
          commentReloadId = '';
          if (rr === 'stopped') { stopped = true; break; }
          if (rr === 'blocked') { blocked = 'YouTube bật hộp thoại đăng nhập giữa phiên (chưa đăng nhập)'; break; }
          if (session.watched >= watchTarget || totalActions() >= maxActions) break;
          if (!(await store.waitCancellable(rnd(cfg.delayMin, cfg.delayMax) * 1000, runId))) { stopped = true; break; }
          const g = await goNextFromWatch(id);
          if (g === 'stopped') { stopped = true; break; }
          continue;
        }
        if (processedIds.has(id)) {
          const g = await goNextFromWatch(id);
          if (g === 'stopped') { stopped = true; break; }
          continue;
        }
        const r = await processWatchUnit(id);
        if (r === 'stopped') { stopped = true; break; }
        if (r === 'blocked') { blocked = 'YouTube bật hộp thoại đăng nhập giữa phiên (chưa đăng nhập)'; break; }
        if (session.watched >= watchTarget || totalActions() >= maxActions) break;
        if (!(await store.waitCancellable(rnd(cfg.delayMin, cfg.delayMax) * 1000, runId))) { stopped = true; break; }
        const g = await goNextFromWatch(id);
        if (g === 'stopped') { stopped = true; break; }
        continue;
      }

      // Bề mặt nguồn (trang chủ / subscriptions / tìm kiếm / kênh): chọn thẻ
      // video hợp lệ đầu tiên; bề mặt trống -> xoay nguồn (khối !picked).
      const cards = findCards();
      let picked = null;
      for (const c of cards) {
        if (processedIds.has(c.id)) continue;
        if (await store.isDead(c.id)) continue;
        if ((await store.hasHistory('comment', c.id)) && (await store.hasHistory('like', c.id))) continue;
        picked = c;
        break;
      }
      if (!picked) {
        emptyRounds++;
        // Xoay nguồn (2.5.1): đã quét vòng đầu + 1 lần cuộn (emptyRounds=2)
        // mà vẫn 0 ứng viên và chưa đạt mục tiêu xem -> chuyển nguồn kế
        // tiếp thay vì ngồi cuộn tiếp trên bề mặt trống. Cursor ghi xuống
        // TRƯỚC khi điều hướng để bản inject mới resume đúng nguồn mới,
        // không quay lại nguồn đã cạn. Hết nguồn -> giữ nhịp cũ: cuộn
        // thêm 1 vòng rồi kết phiên (failed no_eligible_target ở tổng kết).
        if (emptyRounds === 2 && session.watched < watchTarget) {
          const curIdx = await currentSourceIdx();
          if (curIdx < SOURCES.length - 1) {
            const next = SOURCES[curIdx + 1];
            await sSet({ [store.K('Source')]: curIdx + 1 });
            await store.journal({ runId, platform: PLATFORM, action: 'watch', target: '', url: next.url, status: 'skipped', note: `xoay nguồn: ${SOURCES[curIdx].name} trống (quét + 1 lần cuộn, 0 ứng viên) -> ${next.name}` });
            await store.setStatus('Xoay nguồn nuôi YouTube: ' + next.name);
            emptyRounds = 0;
            location.href = next.url;
            if (!(await store.waitCancellable(2500, runId))) { stopped = true; break; }
            continue;
          }
        }
        if (emptyRounds >= 3) break;
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.9), behavior: 'smooth' });
        if (!(await store.waitCancellable(1800, runId))) { stopped = true; break; }
        continue;
      }
      emptyRounds = 0;
      if (picked.live) rememberLiveId(picked.id);
      picked.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (!(await store.waitCancellable(rnd(1, 2) * 1000, runId))) { stopped = true; break; }
      picked.link.click();
      const got = await waitWatchUrl(null);
      if (got === 'stopped') { stopped = true; break; }
      if (!got) {
        // Bấm không qua được trang xem (SPA lỗi) -> điều hướng thẳng (reload,
        // bản inject mới sẽ resume và xử lý video này trên trang /watch).
        location.href = picked.url;
        await store.waitCancellable(2000, runId);
      }
    }

    const summary = `xem ${session.watched} video, like ${session.like}, comment ${session.comment}, subscribe ${session.follow}, uncertain ${session.uncertain}, bỏ qua ${session.skipped}`;
    if (blocked) {
      await finish('failed', 'session_expired', blocked + ' — dừng phiên. (' + summary + ')');
    } else if (stopped) {
      await finish('failed', 'user_cancelled', 'Phiên bị dừng giữa chừng (cờ dừng/runId đổi). (' + summary + ')');
    } else if (session.watched > 0 || totalActions() > 0) {
      await finish('success', null, 'Nuôi YouTube xong phiên: ' + summary);
    } else if (session.uncertain > 0) {
      await finish('uncertain', null, 'Không hành động nào có proof: ' + summary);
    } else {
      await finish('failed', 'no_eligible_target', 'Không tìm thấy video hợp lệ để xem/tương tác: ' + summary);
    }
  })().catch(async err => {
    console.error('[Auto vjp][youtube-nurture]', err);
    if (!errTaskId) return; // chưa xác định được task thì không gửi receipt rác
    try {
      await chrome.runtime.sendMessage({
        action: 'nurtureDone', taskId: errTaskId, platform: PLATFORM,
        status: 'failed', failure_code: 'execution_error',
        resultMessage: 'youtube-nurture lỗi: ' + (err?.message || String(err)), items: []
      });
    } catch (_) {}
  });
})();
