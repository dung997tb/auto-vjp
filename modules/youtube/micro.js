// Auto vjp — YouTube micro actions (task type 'micro_action', 2.11.17).
// 2.11.17: mở rộng từ 4 lên 48 hành động nhỏ test LẺ (discovery, trình
// phát, tương tác theo URL, adapter nuôi, Community, Upload Studio).
// Task: {platform:'youtube', type:'micro_action', payload:{action, ...}}.
// Đọc canonical run trực tiếp, báo kết quả bằng action 'microActionDone'
// (results.js deliver type 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found';
// hành động đọc -> dữ liệu thật vào details; không bịa kết quả.
//
// NGUỒN LOGIC (đọc kỹ trước khi sửa): các file nguồn của YouTube KHÔNG
// phải thư viện export hàm — discovery.js (quét tài khoản), interaction.js
// (task reply), automator.js (Community/Studio), upload.js (task upload)
// và youtube-nurture/adapter.js đều là script monolith tự chạy theo task
// riêng, không để lộ hàm ra global (adapter còn cần AVJP.nurture của lõi
// nuôi). Vì vậy micro.js PORT selector + logic thật từ các file đó (đúng
// tiền lệ bản 2.11.16: bộ chọn theo adapter/automator), KHÔNG inject kèm
// các file nguồn vào nhánh micro_action — inject automator/upload/
// discovery vào trang micro sẽ tự chạy theo task của chúng hoặc chết vì
// thiếu global (__accountScanContext, AVJP.nurture...). Ánh xạ nguồn:
// - Thẻ video/feed/tìm kiếm/kênh + like/subscribe/comment/meta:
//   youtube-nurture/adapter.js (findCards, likeButton, subscribeParts,
//   commentBoxParts, videoMeta, watchVideo).
// - Comment độc lập + proof chữ ký + dialog bắt tạo kênh:
//   youtube/interaction.js.
// - Community (handle có thẩm quyền #channel-handle, findComposer, nút
//   Đăng, proof bài mới): youtube/automator.js.
// - Upload Studio (queryShadow xuyên Polymer, findCreateBtn,
//   findTitleBox/findDescBox, fillTextbox, radio kids/visibility,
//   #next-button/#done-button, fetch media qua background):
//   youtube/upload.js.
//
// STEP-RUNNER (hành động 'context'): chạy lần lượt prefix -> hành động
// chính; mỗi bước xong ghi phase storage (avjpMicroPhase_youtube, v:2)
// nên bản inject sau điều hướng chạy tiếp đúng bước dở. Tiền tố fail ->
// failed 'prefix_failed' + details.prefix_step. Bước điều hướng (mở
// video, mở tab Community, mở Studio...) tự gán location rồi trả 'nav';
// runner lưu phase, bản inject ở trang đích chạy lại bước đó (hàm bước
// idempotent: đã ở đúng bề mặt thì làm phần việc trong trang).
// Mọi cú bấm của handler MỚI đi qua AVJP.human.clickEl (hc bên dưới):
// clickEl trả false = KHÔNG bấm lại bằng click thường. 4 handler cũ giữ
// nguyên hành vi (humanClick cũ có fallback click thường).
if (window.top !== window.self) {
  // Chỉ chạy ở frame chính.
} else {
(async () => {
  const PLATFORM = 'youtube';
  const PHASE_KEY = 'avjpMicroPhase_youtube';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();

  const stored = await chrome.storage.local.get('currentAutomationRun');
  const run = stored.currentAutomationRun;
  if (!run || run.platform !== PLATFORM || run.type !== 'micro_action') return;
  const taskId = String(run.task_id || run.id || '');
  if (!taskId) return;
  if (window.__avjpMicroRunId === run.run_id) return;
  window.__avjpMicroRunId = run.run_id;

  const payload = (run.payload && typeof run.payload === 'object') ? run.payload : {};
  const action = String(payload.action || run.action || '');
  // (2.11.17) healthscan_<anchor>: uỷ quyền handler dùng chung ở
  // modules/shared/healthscan-micro.js (contract nạp trước micro.js) —
  // chỉ định vị neo selector mẫu qua AVJP.heal.locate, không bấm thật.
  if (action.indexOf('healthscan_') === 0 && globalThis.AVJP && AVJP.healthscanMicro) {
    await AVJP.healthscanMicro.run({ action, report });
    return;
  }
  const rawSeconds = Number(payload.seconds ?? run.seconds);
  const secondsOr = dflt => {
    const s = Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.round(rawSeconds) : dflt;
    return Math.min(120, Math.max(1, s));
  };

  const getPhase = async () => {
    const s = await chrome.storage.local.get(PHASE_KEY);
    const p = s[PHASE_KEY];
    return p && String(p.taskId) === taskId ? p : null;
  };
  const setPhase = async extra => {
    const prev = (await getPhase()) || {};
    await chrome.storage.local.set({ [PHASE_KEY]: { ...prev, ...extra, taskId, action } });
  };
  const clearPhase = async () => { try { await chrome.storage.local.remove(PHASE_KEY); } catch (_) {} };

  let reported = false;
  function report(status, details, failureCode, resultMessage) {
    if (reported) return;
    reported = true;
    clearPhase().catch(() => {});
    chrome.runtime.sendMessage({
      action: 'microActionDone', taskId,
      status, failure_code: failureCode || null,
      details: details || null, resultMessage: resultMessage || '',
      resultUrl: location.href
    }, () => void chrome.runtime.lastError);
  }
  const failSelector = (target, extra = {}) =>
    report('failed', { action, found: false, target, ...extra }, 'selector_not_found',
      `Không tìm thấy phần tử đích: ${target}`);
  const done = (details, msg) => report('success', { action, ...details }, null, msg || `Đã xong hành động nhỏ: ${action}`);

  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  async function waitFor(fn, timeoutMs = 15000, stepMs = 300) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (_) {}
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(stepMs);
    }
  }
  // queryShadow rút gọn (kiểu automator.js): querySelector thường trước,
  // không thấy thì xuyên shadowRoot của mọi phần tử (nút avatar/chuông
  // của YouTube nằm trong shadow DOM của masthead).
  function queryDeep(selector) {
    const direct = document.querySelector(selector);
    if (direct) return direct;
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const hit = el.shadowRoot.querySelector(selector);
        if (hit) return hit;
      }
    }
    return null;
  }
  // queryShadow ĐỆ QUY (port nguyên từ automator.js/upload.js) — cần cho
  // Polymer của Studio và dialog Community lồng nhiều tầng shadow.
  function queryShadowRec(selector, root = document) {
    if (!root) return null;
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch (_) {}
    let allEls;
    try { allEls = root.querySelectorAll('*'); } catch (_) { return null; }
    for (const el of allEls) {
      if (el.shadowRoot) {
        const found = queryShadowRec(selector, el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }
  function queryShadowAllRec(selector, root = document, results = []) {
    if (!root) return results;
    try { root.querySelectorAll(selector).forEach(el => results.push(el)); } catch (_) {}
    let allEls;
    try { allEls = root.querySelectorAll('*'); } catch (_) { return results; }
    for (const el of allEls) {
      if (el.shadowRoot) queryShadowAllRec(selector, el.shadowRoot, results);
    }
    return results;
  }
  function plainClick(el) {
    if (!el) return false;
    const target = el.closest?.('a, button, [role="button"]') || el;
    try { target.scrollIntoView({ block: 'center' }); } catch (_) {}
    try { target.focus(); } catch (_) {}
    for (const type of ['mouseover', 'mousedown', 'mouseup']) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    }
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  async function humanClick(el) {
    if (!el) return false;
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.clickEl === 'function') {
        const ok = await human.clickEl(el);
        if (ok) return true;
      }
    } catch (_) {}
    return plainClick(el);
  }
  // hc — click cho handler MỚI theo luật 2.11.17: qua AVJP.human.clickEl;
  // clickEl trả false thì KHÔNG bấm lại. Chỉ khi AVJP.human vắng mặt hẳn
  // mới rơi về click thường (như các micro khác vẫn làm).
  async function hc(el) {
    if (!el) return false;
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.clickEl === 'function') {
        return Boolean(await human.clickEl(el));
      }
    } catch (_) { return false; }
    return plainClick(el);
  }
  async function humanScrollBy(dy) {
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.scrollBy === 'function') { await human.scrollBy(dy); return true; }
    } catch (_) {}
    window.scrollBy(0, dy);
    return false;
  }

  // ── Media qua background (port từ upload.js: mediaFetchStart/Chunk/End
  // + dataURLtoFile) — dùng cho set_upload_file. ──
  function fetchMediaViaBackground(url) {
    const send = p => new Promise(resolve => chrome.runtime.sendMessage(p, response => resolve(chrome.runtime.lastError ? null : response)));
    return (async () => {
      const start = await send({ action: 'mediaFetchStart', url });
      if (!start?.success) return null;
      const parts = [];
      try {
        for (let offset = 0; offset < start.size;) {
          const chunk = await send({ action: 'mediaFetchChunk', id: start.id, offset, length: 480 * 1024 });
          if (!chunk?.success || chunk.nextOffset <= offset) return null;
          parts.push(chunk.data);
          offset = chunk.nextOffset;
        }
        return { success: true, dataUrl: `data:${start.type};base64,${parts.join('')}`, type: start.type };
      } finally {
        await send({ action: 'mediaFetchEnd', id: start.id });
      }
    })();
  }
  function dataURLtoFile(dataurl, filename, forceMime = null) {
    const arr = dataurl.split(',');
    let mime = forceMime;
    if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
      const match = arr[0] ? arr[0].match(/:(.*?);/) : null;
      mime = match ? match[1] : '';
    }
    if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
      mime = filename.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    }
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  // ═══ 4 HÀNH ĐỘNG CŨ (giữ nguyên) ═══
  async function actScrollFeed() {
    const secs = secondsOr(30);
    const end = Date.now() + secs * 1000;
    let ticks = 0, totalPx = 0;
    while (Date.now() < end) {
      const dy = Math.round(rand(300, 750));
      await humanScrollBy(dy);
      totalPx += dy; ticks++;
      await sleep(Math.min(rand(700, 2000), Math.max(0, end - Date.now())));
    }
    done({ seconds: secs, ticks, scrolled_px: totalPx });
  }

  // Chờ video ở trang /watch PHÁT THẬT (currentTime nhích) rồi xem đủ
  // giây. Dùng cho cả lượt đầu (sau khi SPA chuyển trang, cùng document)
  // lẫn lượt tiếp (document mới ở /watch).
  async function watchWaitAndDone(extra = {}) {
    const secs = secondsOr(20);
    const v = await waitFor(() => document.querySelector('video.html5-main-video, #movie_player video, video'), 12000);
    if (!v) return failSelector('watch_video_element', extra);
    if (v.paused) {
      try { await v.play(); } catch (_) {}
      if (v.paused) await humanClick(v);
    }
    const t0 = v.currentTime || 0;
    const playing = await waitFor(() => (v.currentTime || 0) > t0 + 0.4 ? true : null, 9000, 250);
    if (!playing) {
      return report('failed', { action, found: true, target: 'watch_playback', ...extra }, 'execution_error',
        'Đã vào trang xem nhưng video không phát (currentTime không chạy)');
    }
    await sleep(secs * 1000);
    done({ watched_seconds: secs, ...extra }, `Đã xem video đầu ${secs} giây`);
  }

  async function actWatchFirst() {
    if (location.pathname === '/watch') return watchWaitAndDone();
    const link = await waitFor(() => {
      const a = document.querySelector(
        'ytd-rich-item-renderer a#thumbnail[href*="/watch?v="], ' +
        'ytd-rich-item-renderer a[href^="/watch?v="], ' +
        'a#thumbnail[href*="/watch?v="], a#video-title[href*="/watch?v="], a#video-title-link[href*="/watch"]');
      return a && visible(a) ? a : null;
    }, 15000);
    if (!link) return failSelector('first_video_link');
    await setPhase({ videoHref: link.getAttribute('href') || null });
    await humanClick(link);
    const onWatch = await waitFor(() => location.pathname === '/watch' ? true : null, 8000);
    if (!onWatch) return failSelector('watch_page', { clicked: true });
    return watchWaitAndDone();
  }

  async function actOpenNotifications() {
    const bell = await waitFor(() =>
      queryDeep('ytd-notification-topbar-button-renderer button, ytd-notification-topbar-button-renderer #notification-button, button#notification-button'), 12000);
    if (!bell) return failSelector('notification_bell');
    await setPhase({});
    await humanClick(bell);
    const panel = await waitFor(() => {
      const menu = document.querySelector('ytd-multi-page-menu-renderer');
      if (menu && visible(menu)) return true;
      return document.querySelector('ytd-notification-renderer') ? true : null;
    }, 5000);
    if (!panel) return failSelector('notifications_panel', { clicked: true });
    done({ opened: true }, 'Đã mở panel thông báo');
  }

  async function actOpenProfile() {
    // Kênh của mình: avatar -> menu tài khoản -> link kênh (/channel/
    // hoặc /@) TRONG menu. Tuyệt đối không lấy link /@ tự do ngoài menu
    // (bài học 2.6.1: từng vớ phải kênh lạ chỉ đăng ký xem).
    const avatar = await waitFor(() => queryDeep('#avatar-btn, button#avatar-btn'), 10000);
    if (!avatar) return failSelector('avatar_button');
    await setPhase({ step: 'menu' });
    await humanClick(avatar);
    const channelLink = await waitFor(() => {
      const scope = document.querySelector('ytd-multi-page-menu-renderer, ytd-popup-container, #menu-container');
      if (!scope) return null;
      const a = scope.querySelector('a[href^="/channel/"], a[href^="/@"]');
      return a || null;
    }, 6000);
    if (!channelLink) return failSelector('channel_link_in_account_menu', { clicked: true });
    const href = channelLink.getAttribute('href') || '';
    await setPhase({ step: 'channel', channelHref: href });
    await humanClick(channelLink);
    const ok = await waitFor(() =>
      (location.pathname.startsWith('/channel/') || /^\/@/.test(location.pathname)) ? true : null, 6000);
    if (!ok) return failSelector('channel_page', { clicked: true });
    done({ opened: true, channel: location.pathname }, `Đã mở kênh của mình: ${location.pathname}`);
  }

  // ── Chạy tiếp sau điều hướng (4 hành động cũ) ──
  async function resume(phase) {
    switch (action) {
      case 'scroll_feed':
        return done({ resumed: true }, 'Đã lướt trang chủ (lượt chạy tiếp sau điều hướng)');
      case 'watch_first': {
        if (location.pathname === '/watch') return watchWaitAndDone({ resumed: true });
        return actWatchFirst(); // chưa tới trang xem (SPA lỗi nhịp) -> thử lại luồng bấm
      }
      case 'open_notifications': {
        const menu = document.querySelector('ytd-multi-page-menu-renderer');
        if ((menu && visible(menu)) || document.querySelector('ytd-notification-renderer')) {
          return done({ opened: true, resumed: true }, 'Panel thông báo đã mở (lượt tiếp)');
        }
        return failSelector('notifications_panel', { resumed: true });
      }
      case 'open_profile': {
        if (location.pathname.startsWith('/channel/') || /^\/@/.test(location.pathname)) {
          return done({ opened: true, resumed: true, channel: location.pathname }, 'Đã tới kênh của mình (lượt tiếp)');
        }
        return failSelector('channel_page', { resumed: true });
      }
      default:
        return report('failed', { action, resumed: true }, 'execution_error', `Không khôi phục được hành động: ${action}`);
    }
  }

  // ═══ PRIMITIVES DÙNG CHUNG (port từ youtube-nurture/adapter.js +
  // youtube/interaction.js — xem ghi chú nguồn ở đầu file) ═══
  // Kết quả 1 bước: {ok:true, details} | {ok:false, code, target?,
  // message, details?} | {nav:true, data?} (đã gán location, chờ trang mới).
  const ok = (details = {}) => ({ ok: true, details });
  const fail = (code, message, details = {}) => ({ ok: false, code, message, details });
  const failSel = (target, message) => ({ ok: false, code: 'selector_not_found', target, message: message || `Không tìm thấy phần tử đích: ${target}`, details: { found: false, target } });
  const nav = (data = {}) => ({ nav: true, data });

  const videoIdFromUrl = u => {
    const m = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(String(u || ''));
    if (m) return m[1];
    const s = /\/shorts\/([A-Za-z0-9_-]{6,})/.exec(String(u || ''));
    return s ? s[1] : null;
  };
  const isWatchPage = () => /^\/watch/.test(location.pathname);
  const playerEl = () => document.querySelector('#movie_player');
  const videoEl = () => document.querySelector('#movie_player video, video.html5-main-video, video');

  // — Thẻ video (adapter findCards + isAdCard/isShortsCard/isLiveCard) —
  function cardVideoLink(card) {
    return card.querySelector('a#thumbnail[href*="/watch?v="], a[href^="/watch?v="], a[href*="youtube.com/watch?v="], a#video-title[href*="/watch?v="]');
  }
  function isAdCard(card) {
    if (card.closest('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer')) return true;
    return Boolean(card.querySelector('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer'));
  }
  function isShortsCard(card, link) {
    const href = link?.getAttribute('href') || '';
    if (href.startsWith('/shorts/')) return true;
    return Boolean(card.closest('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer'));
  }
  function isLiveCard(card) {
    if (card.querySelector('ytd-thumbnail-overlay-time-status-renderer[overlay-style="LIVE"], ytd-thumbnail-overlay-live-status-renderer, badge-shape[class*="live" i], [class*="yt-badge-shape--thumbnail-live"]')) return true;
    const badges = card.querySelectorAll('ytd-thumbnail-overlay-time-status-renderer #text, ytd-thumbnail-overlay-time-status-renderer, badge-shape, .badge-shape__text');
    for (const el of badges) {
      const t = normalize(textOf(el)).toUpperCase();
      if (t === 'LIVE' || t === 'TRỰC TIẾP') return true;
    }
    return false;
  }
  function collectCards(limit = 20) {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer').forEach(card => {
      if (out.length >= limit) return;
      const link = cardVideoLink(card);
      if (!link) return;
      const id = videoIdFromUrl(link.href);
      if (!id || seen.has(id)) return;
      if (isAdCard(card) || isShortsCard(card, link)) return;
      seen.add(id);
      const titleEl = card.querySelector('#video-title, a#video-title, yt-formatted-string#video-title');
      const chEl = card.querySelector('#channel-name a, ytd-channel-name a, #text.ytd-channel-name a');
      out.push({
        el: card, link, id,
        url: 'https://www.youtube.com/watch?v=' + id,
        title: normalize(titleEl?.textContent || link.getAttribute('title') || '').slice(0, 200),
        channel: normalize(chEl?.textContent || '').slice(0, 100),
        live: isLiveCard(card)
      });
    });
    return out;
  }
  const waitCards = (timeoutMs = 15000) => waitFor(() => {
    const c = collectCards(20);
    return c.length ? c : null;
  }, timeoutMs, 400);

  // — Like / Dislike / Subscribe (adapter likeButton/subscribeParts) —
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
    const pressed = scope.querySelector('#top-level-buttons-computed button[aria-pressed]');
    if (pressed) return pressed;
    return [...scope.querySelectorAll('button')].find(b =>
      /^(like this video|thích video)/i.test(String(b.getAttribute('aria-label') || ''))) || null;
  }
  function dislikeButton() {
    const scope = document.querySelector('ytd-watch-metadata');
    if (!scope) return null;
    const seg = scope.querySelector('segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer');
    if (seg) {
      const d = seg.querySelector('dislike-button-view-model button');
      if (d) return d;
      const pressed = seg.querySelectorAll('button[aria-pressed]');
      if (pressed.length > 1) return pressed[1];
    }
    return [...scope.querySelectorAll('button')].find(b =>
      /^(dislike this video|không thích video)/i.test(String(b.getAttribute('aria-label') || ''))) || null;
  }
  async function doLike() {
    const btn = await waitFor(likeButton, 10000);
    if (!btn) return failSel('like_button');
    if (btn.getAttribute('aria-pressed') === 'true') return ok({ liked: true, already: true });
    const clicked = await hc(btn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Like — không bấm lại', { liked: false });
    const proof = await waitFor(() => {
      const b = likeButton();
      return b && b.getAttribute('aria-pressed') === 'true' ? true : null;
    }, 3000, 300);
    if (!proof) return fail('execution_error', 'Đã bấm Like nhưng aria-pressed không lật true sau 3s', { liked: false, proof: false });
    return ok({ liked: true, verified: true });
  }
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
    return ['Subscribed', 'Đã đăng ký'].some(s => txt === s || label.startsWith(s))
      || /^(subscribed|đã đăng ký)/i.test(label);
  }
  async function doSubscribe() {
    const parts = await waitFor(subscribeParts, 10000);
    if (!parts) return failSel('subscribe_button');
    if (isSubscribed(parts)) return ok({ subscribed: true, already: true });
    const clicked = await hc(parts.btn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Đăng ký — không bấm lại', { subscribed: false });
    const proof = await waitFor(() => {
      const p2 = subscribeParts();
      return p2 && isSubscribed(p2) ? true : null;
    }, 3000, 300);
    if (!proof) return fail('execution_error', 'Đã bấm Đăng ký nhưng trạng thái không đổi sau 3s', { subscribed: false, proof: false });
    return ok({ subscribed: true, verified: true });
  }

  // — Comment (interaction.js: cuộn TỨC THỜI lặp + simplebox + proof) —
  const commentsOff = () => {
    const c = document.querySelector('ytd-comments, #comments');
    if (!c) return false;
    const t = c.textContent || '';
    return ['Comments are turned off', 'Đã tắt tính năng bình luận', 'tính năng bình luận đã bị tắt'].some(s => t.includes(s));
  };
  const commentsSectionRendered = () => {
    const c = document.querySelector('ytd-comments, #comments');
    if (!c) return false;
    if (commentsOff()) return true;
    if (c.querySelector('ytd-comment-simplebox-renderer')) return true;
    return c.querySelectorAll('ytd-comment-thread-renderer').length > 0;
  };
  const commentBoxParts = () => {
    const box = document.querySelector('ytd-comment-simplebox-renderer');
    if (!box) return null;
    const editable = box.querySelector('#contenteditable-root[contenteditable="true"], div[contenteditable="true"]');
    const placeholder = box.querySelector('#simplebox-placeholder');
    const submitWrap = box.querySelector('#submit-button');
    const submitBtn = submitWrap ? (submitWrap.querySelector('button') || submitWrap) : null;
    return { box, editable, placeholder, submitBtn };
  };
  const channelCreationPrompt = () => {
    const dialogs = document.querySelectorAll('ytd-modal-with-title-and-button-renderer, tp-yt-paper-dialog, [role="dialog"]');
    for (const d of dialogs) {
      if (!visible(d)) continue;
      const hit = [...d.querySelectorAll('button, a')].find(el => /tạo kênh|create channel/i.test(textOf(el)));
      if (hit) return d;
    }
    return null;
  };
  const isLiveWatch = () => {
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy && (flexy.hasAttribute('is-live-video') || flexy.getAttribute('is-live-video') === 'true')) return true;
    const badge = document.querySelector('.ytp-live-badge');
    return Boolean(badge && visible(badge));
  };
  const scrollToCommentsNow = () => {
    const a = document.querySelector('ytd-comments, #comments');
    if (!a) { window.scrollBy(0, Math.floor(window.innerHeight * 1.2)); return; }
    a.scrollIntoView({ block: 'start' });
    const r = a.getBoundingClientRect();
    if (r.top > window.innerHeight || r.top < -200) window.scrollBy(0, r.top - 80);
  };
  // Mở section comment + editor; trả {parts} hoặc fail-result.
  async function openCommentEditor(timeoutMs = 20000) {
    if (isLiveWatch()) return fail('execution_error', 'live_chat_not_comments: video trực tiếp chỉ có live chat, không có khung bình luận');
    if (commentsOff()) return fail('execution_error', 'comments_disabled: video đã tắt tính năng bình luận');
    let parts = null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !parts) {
      scrollToCommentsNow();
      if (channelCreationPrompt()) return fail('execution_error', 'channel_required: cần tạo kênh YouTube mới bình luận được');
      if (commentsOff()) return fail('execution_error', 'comments_disabled: video đã tắt tính năng bình luận');
      const p = commentBoxParts();
      if (p && (p.placeholder || p.editable)) parts = p;
      else await sleep(400);
    }
    if (!parts) {
      return commentsSectionRendered()
        ? failSel('comment_box', '#comments đã render nhưng ô soạn không xuất hiện')
        : failSel('comments_section', '#comments không render trong thời gian chờ');
    }
    if (!parts.editable && parts.placeholder) {
      const clicked = await hc(parts.placeholder);
      if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm ô bình luận — không bấm lại');
      let opened = null;
      const openStart = Date.now();
      while (Date.now() - openStart < 5000 && !opened) {
        if (channelCreationPrompt()) return fail('execution_error', 'channel_required: cần tạo kênh YouTube mới bình luận được');
        const p = commentBoxParts();
        if (p && p.editable) opened = p;
        else await sleep(300);
      }
      if (!opened) return fail('execution_error', 'comment_editor_not_opened: bấm ô soạn nhưng editor không mở');
      parts = opened;
    }
    return { parts };
  }
  function typeIntoEditor(ed, text) {
    try { ed.focus(); } catch (_) {}
    try { ed.click(); } catch (_) {}
    try { document.execCommand('insertText', false, text); } catch (_) {}
    if (!normalize(ed.textContent).includes(normalize(text).slice(0, 20))) {
      for (const ch of text) {
        try { document.execCommand('insertText', false, ch); } catch (_) { break; }
      }
    }
    if (!normalize(ed.textContent).includes(normalize(text).slice(0, 20))) {
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return normalize(ed.textContent).includes(normalize(text).slice(0, 20));
  }
  const signatureInComments = text => {
    const frag = normalize(text).toLowerCase().slice(0, 60);
    if (!frag) return null;
    for (const el of document.querySelectorAll('#comments #content-text')) {
      if (normalize(el.textContent || '').toLowerCase().includes(frag)) return el;
    }
    return null;
  };
  async function submitCommentAndProof(text) {
    const fresh = commentBoxParts();
    const submitBtn = fresh?.submitBtn;
    if (!submitBtn) return failSel('comment_submit_button');
    const clicked = await hc(submitBtn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm gửi bình luận — không bấm lại');
    const proof = await waitFor(() => signatureInComments(text), 15000, 700);
    if (!proof) return fail('execution_error', 'comment_proof_timeout: đã bấm gửi nhưng comment không hiện trong danh sách sau 15s — không gửi lại', { proof: false });
    return ok({ commented: true, proof: true });
  }
  async function doPostComment(content) {
    const opened = await openCommentEditor();
    if (!opened.parts) return opened;
    const ed = opened.parts.editable;
    if (!typeIntoEditor(ed, content)) {
      return fail('execution_error', 'comment_text_not_entered: editor không nhận nội dung comment');
    }
    await sleep(500);
    return submitCommentAndProof(content);
  }

  // — Metadata video (adapter videoMeta + lượt xem) —
  function readMeta() {
    const title = textOf(document.querySelector('ytd-watch-metadata h1, #title h1, h1.ytd-watch-metadata'))
      || document.title.replace(/ - YouTube$/, '');
    const chLink = document.querySelector('#owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a, #channel-name a');
    const viewsEl = document.querySelector('ytd-watch-info-text #info span, #info-container #info span, .view-count, ytd-video-view-count-renderer span');
    return {
      title: title.slice(0, 300),
      channel_name: textOf(chLink).slice(0, 120),
      channel_url: chLink ? chLink.href : '',
      view_count_text: normalize(viewsEl?.textContent || '').slice(0, 80),
      video_id: videoIdFromUrl(location.href),
      url: location.href
    };
  }

  // ═══ DISCOVERY (thẻ video — adapter findCards) ═══
  async function stepDiscoverFeed() {
    if (!['/', ''].includes(location.pathname)) {
      location.href = 'https://www.youtube.com';
      return nav({});
    }
    let cards = await waitCards(15000);
    if (!cards) return failSel('feed_video_cards');
    for (let i = 0; i < 2; i++) { await humanScrollBy(Math.round(rand(500, 900))); await sleep(900); }
    cards = collectCards(30);
    const sample = cards.slice(0, 8).map(c => ({ id: c.id, title: c.title, channel: c.channel, url: c.url, live: c.live }));
    return ok({ count: cards.length, videos: sample, source: 'feed' });
  }
  async function stepDiscoverSearch(S) {
    const q = String(payload.query || '').trim();
    if (!q) return fail('execution_error', 'missing_query: discover_search cần payload.query', { reason: 'missing_query' });
    const cur = new URLSearchParams(location.search).get('search_query');
    if (!(location.pathname === '/results' && cur === q)) {
      location.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
      return nav({ query: q });
    }
    const cards = await waitCards(15000);
    if (!cards) return failSel('search_result_cards');
    const sample = cards.slice(0, 8).map(c => ({ id: c.id, title: c.title, channel: c.channel, url: c.url, live: c.live }));
    return ok({ count: cards.length, videos: sample, source: 'search', query: q });
  }
  async function stepDiscoverChannel(S) {
    const rawUrl = String(payload.channel_url || payload.target_url || '').trim();
    if (!rawUrl) return fail('execution_error', 'missing_channel_url: discover_channel cần payload.channel_url hoặc target_url', { reason: 'missing_channel_url' });
    let target;
    try { target = new URL(rawUrl, location.origin); } catch (_) {
      return fail('execution_error', `channel_url không hợp lệ: ${rawUrl}`, { reason: 'invalid_channel_url' });
    }
    const base = target.pathname.split('/').filter(Boolean).slice(0, target.pathname.startsWith('/channel/') ? 2 : 1).join('/');
    const curBase = location.pathname.split('/').filter(Boolean).slice(0, location.pathname.startsWith('/channel/') ? 2 : 1).join('/');
    if (curBase !== base) {
      location.href = target.href;
      return nav({ channel_url: target.href });
    }
    let cards = await waitCards(12000);
    if ((!cards || !cards.length) && !/\/videos\/?$/.test(location.pathname) && !S.acc.channelVideosNav) {
      location.href = target.origin + '/' + base + '/videos';
      return nav({ channel_url: target.href, channelVideosNav: true });
    }
    if (!cards || !cards.length) return failSel('channel_video_cards');
    const sample = cards.slice(0, 8).map(c => ({ id: c.id, title: c.title, channel: c.channel, url: c.url, live: c.live }));
    return ok({ count: cards.length, videos: sample, source: 'channel', channel_url: target.href });
  }

  // ═══ TRÌNH PHÁT + TƯƠNG TÁC TRÊN TRANG WATCH ═══
  async function stepOpenFirstVideo() {
    if (isWatchPage()) return ok({ on_watch: true, video_id: videoIdFromUrl(location.href) });
    if (location.pathname.startsWith('/shorts/') || location.pathname.startsWith('/live/')) {
      location.href = 'https://www.youtube.com';
      return nav({});
    }
    const cards = await waitCards(15000);
    if (!cards) {
      if (!['/', ''].includes(location.pathname)) { location.href = 'https://www.youtube.com'; return nav({}); }
      return failSel('first_video_link');
    }
    const first = cards[0];
    const clicked = await hc(first.link);
    if (clicked) {
      const onWatch = await waitFor(() => isWatchPage() ? true : null, 8000);
      if (onWatch) return ok({ on_watch: true, video_id: videoIdFromUrl(location.href), href: first.url });
    }
    location.href = first.url;
    return nav({ videoHref: first.url });
  }
  const needPlayer = async () => {
    const v = await waitFor(() => videoEl(), 10000);
    return v || null;
  };
  async function stepPlayerPlayPause() {
    const v = await needPlayer();
    if (!v) return failSel('player_video_element');
    const p = playerEl();
    const wasPaused = v.paused;
    if (wasPaused) {
      try { if (p && typeof p.playVideo === 'function') p.playVideo(); else await v.play(); } catch (_) {}
      if (v.paused) await hc(v);
    } else {
      try { if (p && typeof p.pauseVideo === 'function') p.pauseVideo(); else v.pause(); } catch (_) {}
    }
    const flipped = await waitFor(() => (v.paused !== wasPaused) ? true : null, 3000, 200);
    if (!flipped) return fail('execution_error', `Trình phát không đổi trạng thái (vẫn ${wasPaused ? 'tạm dừng' : 'đang phát'})`, { paused: v.paused });
    return ok({ was_paused: wasPaused, paused_now: v.paused });
  }
  async function stepPlayerSeek() {
    const v = await needPlayer();
    if (!v) return failSel('player_video_element');
    const ratioRaw = Number(payload.seek_ratio);
    const ratio = Number.isFinite(ratioRaw) ? ratioRaw : 0.5;
    if (ratio < 0 || ratio > 1) return fail('execution_error', `seek_ratio ngoài khoảng 0..1: ${payload.seek_ratio}`, { reason: 'invalid_seek_ratio' });
    if (!Number.isFinite(v.duration) || v.duration <= 0) {
      return fail('execution_error', 'Không tua được: thời lượng video không xác định (live hoặc chưa nạp)', { reason: 'seek_unavailable' });
    }
    const target = v.duration * ratio;
    const p = playerEl();
    try { if (p && typeof p.seekTo === 'function') p.seekTo(target, true); else v.currentTime = target; } catch (_) { try { v.currentTime = target; } catch (_) {} }
    await sleep(900);
    const now = v.currentTime || 0;
    if (Math.abs(now - target) > 8 && now < target - 8) {
      return fail('execution_error', `Tua tới ${Math.round(target)}s nhưng vị trí hiện tại là ${Math.round(now)}s`, { target_seconds: Math.round(target), current_seconds: Math.round(now) });
    }
    return ok({ seek_ratio: ratio, target_seconds: Math.round(target), current_seconds: Math.round(now), duration_seconds: Math.round(v.duration) });
  }
  async function stepPlayerSetSpeed() {
    const v = await needPlayer();
    if (!v) return failSel('player_video_element');
    const rateRaw = Number(payload.rate);
    const rate = Number.isFinite(rateRaw) ? rateRaw : 1.5;
    if (rate < 0.25 || rate > 2) return fail('execution_error', `rate ngoài khoảng 0.25..2: ${payload.rate}`, { reason: 'invalid_rate' });
    const p = playerEl();
    try { if (p && typeof p.setPlaybackRate === 'function') p.setPlaybackRate(rate); } catch (_) {}
    try { v.playbackRate = rate; } catch (_) {}
    await sleep(400);
    if (Math.abs((v.playbackRate || 1) - rate) > 0.01) {
      return fail('execution_error', `Đặt tốc độ ${rate}x nhưng trình phát báo ${v.playbackRate}x`, { rate, actual: v.playbackRate });
    }
    return ok({ rate, actual: v.playbackRate });
  }
  async function stepPlayerToggleMute() {
    const v = await needPlayer();
    if (!v) return failSel('player_video_element');
    const p = playerEl();
    const wasMuted = (p && typeof p.isMuted === 'function') ? Boolean(p.isMuted()) : Boolean(v.muted);
    try {
      if (p && typeof p.mute === 'function' && typeof p.unMute === 'function') { if (wasMuted) p.unMute(); else p.mute(); }
      else v.muted = !wasMuted;
    } catch (_) { try { v.muted = !wasMuted; } catch (_) {} }
    await sleep(400);
    const nowMuted = (p && typeof p.isMuted === 'function') ? Boolean(p.isMuted()) : Boolean(v.muted);
    if (nowMuted === wasMuted) return fail('execution_error', 'Bật/tắt tiếng không đổi trạng thái', { muted: nowMuted });
    return ok({ was_muted: wasMuted, muted_now: nowMuted });
  }
  async function stepPlayerToggleFullscreen() {
    const v = await needPlayer();
    if (!v) return failSel('player_video_element');
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (_) {}
      await sleep(400);
      return ok({ toggled: 'exit', fullscreen_now: Boolean(document.fullscreenElement) });
    }
    const p = playerEl();
    let entered = false;
    try { if (p && typeof p.requestFullscreen === 'function') { await p.requestFullscreen(); } } catch (_) {}
    if (!document.fullscreenElement) {
      try { const wrap = document.querySelector('ytd-player, #player-container, .html5-video-player'); if (wrap?.requestFullscreen) await wrap.requestFullscreen(); } catch (_) {}
    }
    entered = Boolean(document.fullscreenElement);
    if (!entered) return fail('execution_error', 'Không vào được chế độ toàn màn hình', { fullscreen: false });
    // Luật brief: đã bật fullscreen thì phải THOÁT trước khi kết thúc
    // handler để không kẹt trạng thái cho hành động sau.
    await sleep(600);
    try { await document.exitFullscreen(); } catch (_) {}
    await sleep(400);
    return ok({ entered: true, exited: !document.fullscreenElement, fullscreen_now: Boolean(document.fullscreenElement) });
  }
  async function stepPlayerOpenSettings() {
    const btn = await waitFor(() => document.querySelector('#movie_player .ytp-settings-button, .ytp-settings-button'), 10000);
    if (!btn) return failSel('player_settings_button');
    const clicked = await hc(btn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm nút cài đặt — không bấm lại');
    const menu = await waitFor(() => {
      const m = document.querySelector('.ytp-settings-menu');
      if (m && visible(m)) return true;
      return btn.getAttribute('aria-expanded') === 'true' ? true : null;
    }, 4000);
    if (!menu) return fail('execution_error', 'Đã bấm nút cài đặt nhưng menu cài đặt không mở', { clicked: true });
    return ok({ settings_open: true });
  }
  async function stepLikeVideo() { return doLike(); }
  async function stepDislikeVideo() {
    const btn = await waitFor(dislikeButton, 10000);
    if (!btn) return failSel('dislike_button');
    if (btn.getAttribute('aria-pressed') === 'true') return ok({ disliked: true, already: true });
    const clicked = await hc(btn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Không thích — không bấm lại', { disliked: false });
    const proof = await waitFor(() => {
      const b = dislikeButton();
      return b && b.getAttribute('aria-pressed') === 'true' ? true : null;
    }, 3000, 300);
    if (!proof) return fail('execution_error', 'Đã bấm Không thích nhưng aria-pressed không lật true sau 3s', { disliked: false, proof: false });
    return ok({ disliked: true, verified: true });
  }
  async function stepSubscribeChannel() { return doSubscribe(); }
  async function stepOpenCommentsSection() {
    if (isLiveWatch()) return fail('execution_error', 'live_chat_not_comments: video trực tiếp chỉ có live chat');
    if (commentsOff()) return ok({ comments_disabled: true, rendered: true });
    const rendered = await waitFor(() => {
      scrollToCommentsNow();
      return commentsSectionRendered() ? true : null;
    }, 15000, 400);
    if (!rendered) return failSel('comments_section');
    const count = document.querySelectorAll('ytd-comment-thread-renderer').length;
    return ok({ comments_open: true, thread_count: count });
  }
  async function stepPostComment() {
    const content = String(payload.content || '').trim();
    if (!content) return fail('execution_error', 'missing_content: post_comment cần payload.content', { reason: 'missing_content' });
    return doPostComment(content);
  }
  function shareButton() {
    const scope = document.querySelector('ytd-watch-metadata');
    if (!scope) return null;
    return [...scope.querySelectorAll('button')].find(b =>
      /^(share|chia sẻ)/i.test(String(b.getAttribute('aria-label') || ''))) || null;
  }
  const shareDialogEl = () => document.querySelector('ytd-share-target-renderer, ytd-unified-share-panel-renderer, tp-yt-paper-dialog #share-panel, ytd-share-panel-renderer');
  async function stepOpenShareDialog() {
    if (shareDialogEl() && visible(shareDialogEl())) return ok({ share_open: true, already: true });
    const btn = await waitFor(shareButton, 10000);
    if (!btn) return failSel('share_button');
    const clicked = await hc(btn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Chia sẻ — không bấm lại');
    const dlg = await waitFor(() => {
      const d = shareDialogEl();
      if (d && visible(d)) return d;
      return document.querySelector('input#share-url, input[value*="youtu.be"]') ? true : null;
    }, 6000);
    if (!dlg) return fail('execution_error', 'Đã bấm Chia sẻ nhưng hộp chia sẻ không mở', { clicked: true });
    return ok({ share_open: true });
  }
  async function stepCopyShareLink() {
    const input = document.querySelector('ytd-share-target-renderer input#share-url, input#share-url, input[value*="youtu.be"], input[value*="youtube.com/watch"]');
    if (!input) return failSel('share_url_input');
    const link = String(input.value || input.getAttribute('value') || '').trim();
    const copyBtn = document.querySelector('ytd-share-target-renderer #copy-button button, #copy-button button, button[aria-label*="Copy" i], button[aria-label*="Sao chép" i]');
    let copied = false;
    if (copyBtn) copied = await hc(copyBtn);
    return ok({ share_url: link || null, copied_clicked: copied });
  }
  async function stepSaveToWatchLater() {
    const scope = document.querySelector('ytd-watch-metadata ytd-menu-renderer, ytd-watch-metadata');
    if (!scope) return failSel('watch_menu_renderer');
    const moreBtn = [...scope.querySelectorAll('button')].find(b =>
      /more actions|hành động khác/i.test(String(b.getAttribute('aria-label') || '')))
      || scope.querySelector('ytd-menu-renderer button#button, ytd-menu-renderer yt-icon-button');
    if (!moreBtn) return failSel('more_actions_button');
    const clicked = await hc(moreBtn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm menu 3 chấm — không bấm lại');
    const item = await waitFor(() => {
      const items = document.querySelectorAll('ytd-menu-popup-renderer ytd-menu-service-item-renderer, tp-yt-paper-listbox ytd-menu-service-item-renderer, ytd-menu-service-item-renderer');
      return [...items].find(el => /save to watch later|lưu vào xem sau|watch later|xem sau/i.test(textOf(el))) || null;
    }, 5000);
    if (!item) return failSel('save_to_watch_later_item', { clicked: true });
    const clickedItem = await hc(item);
    if (!clickedItem) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Lưu vào Xem sau — không bấm lại');
    // Panel "Lưu vào danh sách": tick hàng Xem sau nếu chưa tick.
    const row = await waitFor(() => {
      const panel = document.querySelector('ytd-add-to-playlist-renderer');
      if (!panel) return null;
      return [...panel.querySelectorAll('ytd-playlist-add-to-option-renderer')].find(el =>
        /watch later|xem sau/i.test(textOf(el))) || 'no-row';
    }, 3000);
    if (row && row !== 'no-row') {
      const checkbox = row.querySelector('tp-yt-paper-checkbox, [role="checkbox"]');
      const checked = checkbox && (checkbox.hasAttribute('checked') || checkbox.getAttribute('aria-checked') === 'true');
      if (!checked) {
        await hc(row);
        await sleep(600);
        const cb2 = row.querySelector('tp-yt-paper-checkbox, [role="checkbox"]');
        const nowChecked = cb2 && (cb2.hasAttribute('checked') || cb2.getAttribute('aria-checked') === 'true');
        return ok({ saved: Boolean(nowChecked), via: 'playlist_panel', verified: Boolean(nowChecked) });
      }
      return ok({ saved: true, already: true, via: 'playlist_panel' });
    }
    return ok({ saved: true, via: 'menu_item' });
  }
  async function stepOpenChannelPage(S) {
    if ((location.pathname.startsWith('/channel/') || /^\/@/.test(location.pathname)) && S.acc.channelNav) {
      return ok({ opened: true, channel: location.pathname });
    }
    const link = await waitFor(() => document.querySelector('#owner ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a, #channel-name a'), 10000);
    if (!link) return failSel('channel_link_from_video');
    const href = link.href || link.getAttribute('href');
    const clicked = await hc(link);
    if (clicked) {
      const arrived = await waitFor(() =>
        (location.pathname.startsWith('/channel/') || /^\/@/.test(location.pathname)) ? true : null, 7000);
      if (arrived) return ok({ opened: true, channel: location.pathname });
    }
    location.href = href;
    return nav({ channelNav: href });
  }
  async function stepReadVideoMeta() {
    const meta = await waitFor(() => {
      const m = readMeta();
      return m.title ? m : null;
    }, 10000);
    if (!meta) return failSel('video_title');
    return ok({ ...meta });
  }

  // ═══ TƯƠNG TÁC THEO URL ═══
  function targetVideoUrl() {
    return String(payload.target_url || payload.url || '').trim();
  }
  async function stepOpenVideoFromUrl() {
    const url = targetVideoUrl();
    if (!url) return fail('execution_error', 'missing_target_url: cần payload.target_url', { reason: 'missing_target_url' });
    if (!/(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/.test(url)) {
      return fail('execution_error', `target_url không phải URL video YouTube: ${url}`, { reason: 'invalid_target_url' });
    }
    const wantId = videoIdFromUrl(url);
    if (isWatchPage() && wantId && videoIdFromUrl(location.href) === wantId) {
      return ok({ on_watch: true, video_id: wantId, already: true });
    }
    if (location.href === url) return ok({ on_watch: isWatchPage(), video_id: wantId });
    location.href = url;
    return nav({ target_url: url });
  }
  async function stepCommentByUrl() {
    const content = String(payload.content || '').trim();
    if (!content) return fail('execution_error', 'missing_content: comment_by_url cần payload.content', { reason: 'missing_content' });
    return doPostComment(content);
  }

  // ═══ NURTURE ADAPTER (primitive của adapter, chạy độc lập) ═══
  async function ensureWatchViaFirstVideo() {
    if (isWatchPage()) return ok({ on_watch: true, video_id: videoIdFromUrl(location.href) });
    const cards = await waitCards(12000);
    if (!cards) return failSel('nurture_first_video_card');
    const first = cards[0];
    const clicked = await hc(first.link);
    if (clicked) {
      const onWatch = await waitFor(() => isWatchPage() ? true : null, 8000);
      if (onWatch) return ok({ on_watch: true, video_id: videoIdFromUrl(location.href), href: first.url });
    }
    location.href = first.url;
    return nav({ videoHref: first.url });
  }
  async function stepNurtureOpenHome() {
    if (['/', ''].includes(location.pathname) && location.hostname.includes('youtube.com') && !location.hostname.includes('studio')) {
      return ok({ on_home: true, already: true });
    }
    location.href = 'https://www.youtube.com';
    return nav({});
  }
  async function stepNurtureWatchVideo() {
    const ensured = await ensureWatchViaFirstVideo();
    if (!ensured.ok) return ensured;
    const secs = secondsOr(20);
    const v = await waitFor(() => videoEl(), 14000);
    if (!v) return failSel('nurture_player_video');
    // Đo giây xem THẬT kiểu adapter watchVideo: chỉ cộng delta dương
    // nhỏ của currentTime, quảng cáo không tính.
    let watched = 0, last = null;
    const hardEnd = Date.now() + (secs + 120) * 1000;
    while (Date.now() < hardEnd && watched < secs) {
      const p = playerEl();
      if (p && p.classList.contains('ad-showing')) {
        const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button-modern');
        if (skip) { try { skip.click(); } catch (_) {} }
        last = null;
        await sleep(1000);
        continue;
      }
      if (v.paused && !v.ended) { try { await Promise.race([v.play(), sleep(1500)]); } catch (_) {} }
      const ct = Number(v.currentTime) || 0;
      if (last != null) { const d = ct - last; if (d > 0 && d < 5) watched += d; }
      last = ct;
      if (v.ended) break;
      await sleep(1000);
    }
    if (watched < Math.min(secs, 10) * 0.5 && !v.ended) {
      return fail('execution_error', `Xem nuôi: chỉ tích lũy được ${Math.round(watched)}s xem thật`, { watched_seconds: Math.round(watched) });
    }
    return ok({ watched_seconds: Math.round(watched), video_id: videoIdFromUrl(location.href), duration_seconds: Number.isFinite(v.duration) ? Math.round(v.duration) : null, ended: Boolean(v.ended) });
  }
  async function stepNurturePerformLike() {
    const ensured = await ensureWatchViaFirstVideo();
    if (!ensured.ok) return ensured;
    const r = await doLike();
    if (!r.ok) return r;
    return ok({ ...r.details, video_id: videoIdFromUrl(location.href), via: 'nurture_adapter' });
  }
  async function stepNurturePerformSubscribe() {
    const ensured = await ensureWatchViaFirstVideo();
    if (!ensured.ok) return ensured;
    const r = await doSubscribe();
    if (!r.ok) return r;
    const meta = readMeta();
    return ok({ ...r.details, channel_name: meta.channel_name, channel_url: meta.channel_url, via: 'nurture_adapter' });
  }
  async function stepNurtureTypeComment() {
    const content = String(payload.content || '').trim();
    if (!content) return fail('execution_error', 'missing_content: nurture_type_comment cần payload.content', { reason: 'missing_content' });
    const ensured = await ensureWatchViaFirstVideo();
    if (!ensured.ok) return ensured;
    const opened = await openCommentEditor();
    if (!opened.parts) return opened;
    if (!typeIntoEditor(opened.parts.editable, content)) {
      return fail('execution_error', 'comment_text_not_entered: editor không nhận nội dung comment');
    }
    return ok({ typed: true, length: content.length, submitted: false });
  }
  async function stepNurtureSubmitComment() {
    const ensured = await ensureWatchViaFirstVideo();
    if (!ensured.ok) return ensured;
    // Editor đang mở sẵn và đã có chữ (vd vừa type trong cùng trang) ->
    // gửi đúng nội dung đó. Không có -> dùng payload.content qua luồng
    // gõ + gửi đầy đủ; thiếu cả hai -> failed rõ lý do.
    const parts = commentBoxParts();
    const existing = parts?.editable ? normalize(parts.editable.textContent) : '';
    if (existing) {
      const r = await submitCommentAndProof(existing);
      if (!r.ok) return r;
      return ok({ ...r.details, via: 'existing_editor_text' });
    }
    const content = String(payload.content || '').trim();
    if (!content) return fail('execution_error', 'missing_content: editor trống và payload.content không có — không có gì để gửi', { reason: 'missing_content' });
    return doPostComment(content);
  }
  async function stepNurtureBuildContext() {
    if (isWatchPage()) {
      const meta = readMeta();
      const desc = textOf(document.querySelector('#description-inline-expander, ytd-text-inline-expander#description, #description')).slice(0, 600);
      return ok({ ...meta, description_excerpt: desc, context_source: 'watch_page' });
    }
    const cards = await waitCards(10000);
    if (!cards) return failSel('nurture_context_card');
    const c = cards[0];
    return ok({ video_id: c.id, title: c.title, channel_name: c.channel, url: c.url, live: c.live, context_source: 'feed_card' });
  }

  // ═══ COMMUNITY (port từ automator.js handleYouTubeCommunityPost) ═══
  const ytHandleFromPath = () => {
    const m = /^\/@([A-Za-z0-9._-]+)\/community/.exec(location.pathname);
    return m ? m[1] : null;
  };
  const ytHandleInDom = () => {
    // Nguồn có thẩm quyền DUY NHẤT: #channel-handle trong header menu
    // tài khoản (bài học 2.6.1 — không lấy handle từ link /@ tự do).
    const handleEl = queryShadowRec('ytd-active-account-header-renderer #channel-handle')
      || queryShadowRec('#channel-handle');
    const ht = handleEl ? String(handleEl.textContent || '').trim() : '';
    return /^@[A-Za-z0-9._-]+$/.test(ht) ? ht.slice(1) : null;
  };
  async function resolveOwnHandle() {
    const fromPath = ytHandleFromPath();
    if (fromPath) return fromPath;
    let handle = ytHandleInDom();
    if (handle) return handle;
    const avatar = await waitFor(() => queryShadowRec('#avatar-btn, button#avatar-btn'), 10000);
    if (!avatar) return null;
    await hc(avatar);
    handle = await waitFor(() => ytHandleInDom(), 4000);
    if (!handle && !queryShadowRec('ytd-active-account-header-renderer')) {
      const retry = queryShadowRec('#avatar-btn, button#avatar-btn');
      if (retry) { await hc(retry); handle = await waitFor(() => ytHandleInDom(), 6000); }
    }
    return handle;
  }
  async function stepOpenCommunityTab(S) {
    const onPath = ytHandleFromPath();
    if (onPath) return ok({ on_community: true, handle: onPath });
    const handle = S.acc.handle || await resolveOwnHandle();
    if (!handle) {
      return fail('execution_error', 'no_youtube_channel: tài khoản YouTube chưa có kênh (menu tài khoản không có #channel-handle)', { reason: 'no_youtube_channel' });
    }
    location.href = `https://www.youtube.com/@${handle}/community`;
    return nav({ handle });
  }
  const findCommunityEditor = () =>
    queryShadowRec('ytd-backstage-post-dialog-renderer #contenteditable-root[contenteditable="true"]');
  function findComposerTrigger() {
    const direct = queryShadowRec('ytd-backstage-post-dialog-renderer #commentbox-placeholder')
      || queryShadowRec('#commentbox-placeholder')
      || queryShadowRec('#post-button');
    if (direct) return direct;
    const shelf = queryShadowRec('ytd-backstage-post-shelf-renderer');
    if (shelf) {
      const t = [...shelf.querySelectorAll('*')].find(el =>
        /bạn đang nghĩ gì|what's on your mind/i.test(el.textContent || '') && el.children.length <= 2);
      if (t) return t;
    }
    return null;
  }
  async function stepOpenComposer() {
    if (findCommunityEditor()) return ok({ composer_open: true, already: true });
    const trigger = await waitFor(findComposerTrigger, 15000);
    if (!trigger) return failSel('community_composer_trigger');
    const clicked = await hc(trigger);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm mở hộp soạn — không bấm lại');
    const ed = await waitFor(findCommunityEditor, 10000);
    if (!ed) return failSel('community_editor', { clicked: true });
    return ok({ composer_open: true });
  }
  async function stepTypeCommunityText() {
    const content = String(payload.content || '').trim();
    if (!content) return fail('execution_error', 'missing_content: type_community_text cần payload.content', { reason: 'missing_content' });
    const ed = findCommunityEditor();
    if (!ed) return failSel('community_editor');
    try { ed.focus(); } catch (_) {}
    // Cách điền của automator.js: gán textContent + bắn sự kiện input,
    // rồi đọc lại đối chiếu.
    try { ed.textContent = content; } catch (_) {}
    try { ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content })); } catch (_) {
      try { ed.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
    await sleep(400);
    if (!normalize(ed.textContent).includes(normalize(content).slice(0, 30))) {
      return fail('execution_error', 'Nội dung bài cộng đồng chưa được điền đúng khi đọc lại', { typed: false });
    }
    return ok({ typed: true, length: content.length });
  }
  const communityPostEls = () => queryShadowAllRec('ytd-backstage-post-renderer, ytd-backstage-post-thread-renderer');
  const communitySignature = () => {
    const fromPayload = normalize(payload.content || '');
    if (fromPayload) return fromPayload.slice(0, 40);
    const ed = findCommunityEditor();
    return normalize(ed?.textContent || '').slice(0, 40);
  };
  async function stepSubmitCommunityPost() {
    const signature = communitySignature();
    const postBtn = await waitFor(() => {
      const b = queryShadowRec('ytd-backstage-post-dialog-renderer #submit-button button');
      return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
    }, 15000);
    if (!postBtn) return failSel('community_submit_button');
    if (!signature) return fail('execution_error', 'missing_content: không có chữ ký nội dung để kiểm chứng bài (payload.content trống, editor trống)', { reason: 'missing_content' });
    const knownEls = new Set(communityPostEls());
    const clicked = await hc(postBtn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Đăng bài — không bấm lại');
    const newPost = await waitFor(() => {
      for (const el of communityPostEls()) {
        if (knownEls.has(el)) continue;
        const text = normalize(el.querySelector('#content-text')?.textContent || el.textContent || '');
        if (text.includes(signature)) return el;
      }
      return null;
    }, 20000, 500);
    if (!newPost) {
      return fail('execution_error', 'community_post_unconfirmed: đã bấm Đăng nhưng nội dung bài chưa xuất hiện trong danh sách sau 20s', { proof: false });
    }
    const permalinkEl = newPost.querySelector('a[href*="/post/"]');
    return ok({ posted: true, proof: true, result_url: permalinkEl ? String(permalinkEl.href || permalinkEl.getAttribute('href')) : location.href });
  }
  async function stepVerifyCommunityPost() {
    const signature = normalize(payload.content || '').slice(0, 40);
    if (!signature) return fail('execution_error', 'missing_content: verify_community_post cần payload.content làm chữ ký đối chiếu', { reason: 'missing_content' });
    const hit = communityPostEls().find(el =>
      normalize(el.querySelector('#content-text')?.textContent || el.textContent || '').includes(signature));
    if (!hit) {
      return fail('execution_error', 'community_post_not_found: không thấy bài cộng đồng chứa nội dung đối chiếu trong danh sách', { found: false, reason: 'community_post_not_found' });
    }
    const permalinkEl = hit.querySelector('a[href*="/post/"]');
    return ok({ found: true, result_url: permalinkEl ? String(permalinkEl.href || permalinkEl.getAttribute('href')) : location.href });
  }

  // ═══ UPLOAD STUDIO (port từ upload.js) ═══
  const isStudio = () => location.hostname.includes('studio.youtube.com');
  const findFileInput = () => queryShadowRec('ytcp-uploads-dialog input[type="file"], input[type="file"][name="Filedata"], ytcp-upload-dialog input[type="file"]');
  const findCreateBtn = () => queryShadowRec('#create-icon, ytcp-button#create-button, button[aria-label*="Create" i], button[aria-label*="Tạo" i], [aria-label="Create" i]')
    || queryShadowAllRec('ytcp-button, button').find(el => visible(el) && /^(create|tạo)$/i.test(normalize(el.textContent || '')))
    || null;
  const findBrowserSkipLink = () => {
    const byHref = queryShadowRec('a[href*="approve_browser_access=true"]');
    if (byHref && visible(byHref)) return byHref;
    return queryShadowAllRec('a, button').find(el => visible(el)
      && /chuyển thẳng đến youtube studio|skip straight to youtube studio/i.test(normalize(el.textContent || ''))) || null;
  };
  function findTitleBox() {
    const boxes = queryShadowAllRec('ytcp-social-suggestions-textbox');
    for (const box of boxes) {
      const tb = box.querySelector('#textbox') || queryShadowRec('#textbox', box);
      if (!tb) continue;
      const aria = normalize(tb.getAttribute('aria-label') || '').toLowerCase();
      const label = normalize(box.getAttribute('label') || '').toLowerCase();
      let anc = '';
      let p = box;
      for (let i = 0; i < 4 && p; i++) { anc += ' ' + (p.id || ''); p = p.parentElement; }
      if (/title|tiêu đề/.test(aria) || /title|tiêu đề/.test(label) || /title/.test(anc)) return tb;
      if (/add a title|thêm tiêu đề/.test(aria)) return tb;
    }
    return null;
  }
  function findDescBox() {
    const boxes = queryShadowAllRec('ytcp-social-suggestions-textbox');
    const titleBox = findTitleBox();
    for (const box of boxes) {
      const tb = box.querySelector('#textbox') || queryShadowRec('#textbox', box);
      if (!tb || tb === titleBox) continue;
      const aria = normalize(tb.getAttribute('aria-label') || '').toLowerCase();
      const label = normalize(box.getAttribute('label') || '').toLowerCase();
      let anc = '';
      let p = box;
      for (let i = 0; i < 4 && p; i++) { anc += ' ' + (p.id || ''); p = p.parentElement; }
      if (/description|mô tả/.test(aria) || /description|mô tả/.test(label) || /description/.test(anc)) return tb;
      if (/tell viewers|giới thiệu về video/.test(aria)) return tb;
    }
    const all = boxes.map(b => b.querySelector('#textbox') || queryShadowRec('#textbox', b)).filter(Boolean);
    return all.find(tb => tb !== titleBox) || null;
  }
  async function fillTextbox(box, value) {
    if (!box) return false;
    try { box.focus(); } catch (_) {}
    await hc(box);
    await sleep(250);
    try { document.execCommand('selectAll', false, null); } catch (_) {}
    let wrote = false;
    try { wrote = document.execCommand('insertText', false, value); } catch (_) { wrote = false; }
    if (!wrote || !normalize(box.textContent).startsWith(normalize(value).slice(0, 15))) {
      box.textContent = value;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(400);
    return normalize(box.textContent).startsWith(normalize(value).slice(0, Math.min(20, normalize(value).length || 1)))
      || normalize(box.textContent).toLowerCase().includes(normalize(value).toLowerCase().slice(0, 25));
  }
  const radioChecked = el => Boolean(el) && (el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true' || el.checked === true);
  const findKidsRadio = () => queryShadowRec('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
  const findNextBtn = () => queryShadowRec('#next-button, ytcp-button#next-button');
  const findDoneBtn = () => queryShadowRec('#done-button, ytcp-button#done-button');
  const btnEnabled = el => Boolean(el) && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
  const visibilityRadio = name => queryShadowRec(`tp-yt-paper-radio-button[name="${name}"]`);
  const anyVisibilityRadio = () => visibilityRadio('PUBLIC') || visibilityRadio('UNLISTED') || visibilityRadio('PRIVATE');
  async function ensureKidsRadio() {
    const radio = findKidsRadio();
    if (!radio) return 'absent';
    if (radioChecked(radio)) return 'checked';
    await hc(radio);
    const confirmed = await waitFor(() => radioChecked(findKidsRadio()) ? true : null, 5000, 400);
    return confirmed ? 'checked' : 'unconfirmed';
  }
  // Tiến wizard tới khi thấy radio hiển thị hoặc nút Đăng/Xong.
  async function advanceWizardCore(maxSteps = 4) {
    let steps = 0;
    for (let i = 0; i < maxSteps; i++) {
      if (anyVisibilityRadio() || btnEnabled(findDoneBtn())) return { steps, at_end: true };
      const kids = await ensureKidsRadio();
      if (kids === 'unconfirmed') return { steps, at_end: false, blocked: 'kids_radio_unconfirmed' };
      const nextBtn = await waitFor(() => {
        const b = findNextBtn();
        return btnEnabled(b) ? b : null;
      }, 15000, 500);
      if (!nextBtn) return { steps, at_end: Boolean(anyVisibilityRadio()) };
      const clicked = await hc(nextBtn);
      if (!clicked) return { steps, at_end: false, blocked: 'next_click_failed' };
      steps++;
      await sleep(1800);
    }
    return { steps, at_end: Boolean(anyVisibilityRadio() || btnEnabled(findDoneBtn())) };
  }
  async function stepOpenUploadDialog() {
    if (!isStudio()) {
      location.href = 'https://studio.youtube.com';
      return nav({});
    }
    if (findFileInput() || findTitleBox()) return ok({ dialog_open: true, already: true });
    // Tường chặn trình duyệt của Studio (bằng chứng live ở upload.js):
    // bấm link đi thẳng, trang tự điều hướng — bước này chạy lại ở bản mới.
    const skipLink = findBrowserSkipLink();
    if (skipLink) {
      await hc(skipLink);
      await sleep(2500);
      if (findFileInput() || findTitleBox()) return ok({ dialog_open: true });
      return nav({ wall_clicked: true });
    }
    const loginMarker = queryShadowRec('a[href*="ServiceLogin"]');
    if (loginMarker && !findCreateBtn()) {
      return fail('execution_error', 'session_expired: YouTube Studio chưa đăng nhập (hiện nút Sign in)', { reason: 'session_expired' });
    }
    const createBtn = await waitFor(findCreateBtn, 30000);
    if (!createBtn) {
      const noChannel = queryShadowAllRec('button, a, ytcp-button')
        .some(el => visible(el) && /(tạo kênh|create (a )?channel)/i.test(normalize(el.textContent || '')));
      if (noChannel) return fail('execution_error', 'no_youtube_channel: Studio bắt tạo kênh mới tải video được', { reason: 'no_youtube_channel' });
      return failSel('studio_create_button');
    }
    const clickedCreate = await hc(createBtn);
    if (!clickedCreate) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm nút Create của Studio — không bấm lại');
    await sleep(1200);
    const uploadItem = await waitFor(() => {
      const items = queryShadowAllRec('ytcp-text-menu-item, tp-yt-paper-item, [role="menuitem"]');
      return items.find(el => /upload videos|tải video lên/i.test(normalize(el.textContent || '')))
        || queryShadowRec('ytcp-text-menu-item[test-id="upload-video"], #text-item-0');
    }, 10000);
    if (uploadItem) await hc(uploadItem);
    const input = await waitFor(() => findFileInput() || findTitleBox(), 20000, 500);
    if (!input) return failSel('upload_file_input', { clicked: true });
    return ok({ dialog_open: true });
  }
  function mediaUrlFromTask() {
    const fromPayload = String(payload.target_url || payload.media_url || payload.url || '').trim();
    if (fromPayload) return fromPayload;
    let raw = run.images || run.media_urls || run.images_json || payload.images || payload.media_urls;
    try { if (typeof raw === 'string') raw = JSON.parse(raw); } catch (_) { raw = raw ? [raw] : []; }
    const arr = Array.isArray(raw) ? raw : [];
    const first = arr.map(u => typeof u === 'string' ? u : (u && (u.url || u.src))).filter(Boolean)[0];
    return first || '';
  }
  async function stepSetUploadFile() {
    const mediaUrl = mediaUrlFromTask();
    if (!mediaUrl) return fail('execution_error', 'missing_media_url: set_upload_file cần URL media (payload.target_url/media_url hoặc images/media_urls của task)', { reason: 'missing_media_url' });
    const fileInput = findFileInput();
    if (!fileInput) return failSel('upload_file_input');
    const res = await fetchMediaViaBackground(mediaUrl);
    if (!res || !res.dataUrl) return fail('execution_error', `media_load_failed: không tải được video qua background (${mediaUrl})`, { reason: 'media_load_failed' });
    const urlBase = (() => { try { return decodeURIComponent(new URL(mediaUrl).pathname.split('/').pop() || ''); } catch (_) { return ''; } })();
    const fileName = /\.(mp4|webm|mov|m4v|mkv)$/i.test(urlBase) ? urlBase : `youtube_upload_${Date.now()}.mp4`;
    const file = dataURLtoFile(res.dataUrl, fileName, (res.type || '').startsWith('video/') ? res.type : 'video/mp4');
    const dt = new DataTransfer();
    dt.items.add(file);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    const ready = await waitFor(() => findTitleBox() ? true : null, 120000, 1000);
    if (!ready) return fail('execution_error', 'Đã nạp file nhưng dialog không chuyển sang bước chi tiết (không thấy ô tiêu đề) sau 120s', { file_name: fileName });
    return ok({ file_set: true, file_name: fileName, size_kb: Math.round(file.size / 1024) });
  }
  async function stepFillTitle() {
    const value = String(payload.title || payload.content || '').trim();
    if (!value) return fail('execution_error', 'missing_title: fill_title cần payload.title (hoặc content)', { reason: 'missing_title' });
    const box = await waitFor(findTitleBox, 15000);
    if (!box) return failSel('upload_title_box');
    const filled = await fillTextbox(box, value.slice(0, 100));
    if (!filled) return fail('execution_error', 'Không điền được tiêu đề vào dialog upload (đọc lại không khớp)', { filled: false });
    return ok({ title: value.slice(0, 100) });
  }
  async function stepFillDescription() {
    const value = String(payload.description ?? payload.content ?? '').trim();
    if (!value) return fail('execution_error', 'missing_description: fill_description cần payload.description (hoặc content)', { reason: 'missing_description' });
    const box = await waitFor(findDescBox, 15000);
    if (!box) return failSel('upload_description_box');
    const filled = await fillTextbox(box, value);
    if (!filled) return fail('execution_error', 'Không điền được mô tả vào dialog upload (đọc lại không khớp)', { filled: false });
    return ok({ description_length: value.length });
  }
  async function stepSetVisibility() {
    const vis = String(payload.visibility || 'public').trim().toLowerCase();
    const map = { public: 'PUBLIC', unlisted: 'UNLISTED', private: 'PRIVATE' };
    const name = map[vis];
    if (!name) return fail('execution_error', `visibility không hợp lệ: ${payload.visibility} (chỉ public|unlisted|private)`, { reason: 'invalid_visibility' });
    let radio = visibilityRadio(name);
    if (!radio) {
      // Radio hiển thị chỉ tồn tại ở bước cuối của wizard nên phải tiến
      // qua các bước mới chạm được (upload.js cũng đặt hiển thị SAU khi
      // đi hết bước) — tự tiến wizard rồi mới đặt.
      const adv = await advanceWizardCore(4);
      radio = visibilityRadio(name);
      if (!radio) return failSel('visibility_radio', { advanced_steps: adv.steps });
    }
    if (radioChecked(radio)) return ok({ visibility: vis, already: true });
    const clicked = await hc(radio);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi chọn chế độ hiển thị — không bấm lại');
    const confirmed = await waitFor(() => radioChecked(visibilityRadio(name)) ? true : null, 5000, 400);
    if (!confirmed) return fail('execution_error', `Đã bấm radio ${name} nhưng lựa chọn không được ghi nhận`, { visibility: vis });
    return ok({ visibility: vis });
  }
  async function stepAdvanceWizard() {
    const adv = await advanceWizardCore(4);
    if (adv.blocked === 'kids_radio_unconfirmed') {
      return fail('execution_error', 'Bấm "Không dành cho trẻ em" nhưng lựa chọn không được ghi nhận — không đi tiếp được');
    }
    if (!adv.at_end) return failSel('wizard_next_button', { steps: adv.steps });
    return ok({ steps: adv.steps, at_visibility: Boolean(anyVisibilityRadio()), done_ready: btnEnabled(findDoneBtn()) });
  }
  async function stepClickPublish() {
    const doneBtn = await waitFor(() => {
      const b = findDoneBtn();
      return btnEnabled(b) ? b : null;
    }, 120000, 1000);
    if (!doneBtn) return fail('execution_error', 'Nút Đăng/Xong không bật sau 120s (upload/xử lý chưa xong?) — dùng wait_processing trước', { reason: 'publish_not_ready' });
    const clicked = await hc(doneBtn);
    if (!clicked) return fail('execution_error', 'AVJP.human.clickEl trả false khi bấm Đăng/Xong — không bấm lại');
    await sleep(4000);
    const shareLink = queryShadowRec('a[href*="youtu.be"], ytcp-video-info a[href*="youtube.com/watch"]');
    const dialogText = normalize(queryShadowRec('ytcp-uploads-dialog')?.textContent || '');
    const confirmed = Boolean(shareLink) || /video published|đã xuất bản|đã đăng video|your video is live/i.test(dialogText);
    if (!confirmed && queryShadowRec('ytcp-uploads-dialog')) {
      return fail('execution_error', 'Đã bấm Đăng/Xong nhưng không thấy tín hiệu xác nhận xuất bản (link chia sẻ/dialog xác nhận)', { proof: false });
    }
    return ok({ published: true, proof: confirmed, permalink: shareLink ? String(shareLink.href || shareLink.getAttribute('href')) : null });
  }
  async function stepWaitProcessing() {
    const maxMs = Math.min(240, Math.max(30, secondsOr(120))) * 1000;
    const start = Date.now();
    let lastText = '';
    while (Date.now() - start < maxMs) {
      const dialog = queryShadowRec('ytcp-uploads-dialog');
      const bodyText = dialog ? (dialog.textContent || '') : (document.body?.innerText || '');
      lastText = normalize(bodyText).slice(0, 200);
      if (/checks complete|upload complete|đã hoàn tất tải lên|hoàn tất xử lý|processing complete/i.test(bodyText) || btnEnabled(findDoneBtn())) {
        return ok({ processing: 'complete', waited_seconds: Math.round((Date.now() - start) / 1000) });
      }
      await sleep(5000);
    }
    return fail('execution_error', `Chờ xử lý/tải lên quá ${Math.round(maxMs / 1000)}s mà chưa xong`, { reason: 'processing_timeout', last_status: lastText });
  }
  async function stepReadUploadStatus() {
    const dialog = queryShadowRec('ytcp-uploads-dialog');
    if (!dialog && !findFileInput() && !findCreateBtn()) return failSel('upload_dialog');
    const titleBox = findTitleBox();
    const checkedVis = ['PUBLIC', 'UNLISTED', 'PRIVATE'].find(n => radioChecked(visibilityRadio(n))) || null;
    return ok({
      dialog_open: Boolean(dialog || findFileInput()),
      title: titleBox ? normalize(titleBox.textContent).slice(0, 120) : null,
      has_file_input: Boolean(findFileInput()),
      next_enabled: btnEnabled(findNextBtn()),
      done_enabled: btnEnabled(findDoneBtn()),
      visibility_checked: checkedVis ? checkedVis.toLowerCase() : null,
      status_text: dialog ? normalize(dialog.textContent || '').slice(0, 240) : null
    });
  }

  // ═══ REGISTRY 48 HÀNH ĐỘNG + STEP-RUNNER ═══
  const REGISTRY = {
    discover_feed: { needs: 'standalone', fn: stepDiscoverFeed },
    discover_search: { needs: 'standalone', fn: stepDiscoverSearch },
    discover_channel: { needs: 'standalone', fn: stepDiscoverChannel },
    open_first_video: { needs: 'standalone', fn: stepOpenFirstVideo },
    player_play_pause: { needs: 'context', prefix: ['open_first_video'], fn: stepPlayerPlayPause },
    player_seek: { needs: 'context', prefix: ['open_first_video'], fn: stepPlayerSeek },
    player_set_speed: { needs: 'context', prefix: ['open_first_video'], fn: stepPlayerSetSpeed },
    player_toggle_mute: { needs: 'context', prefix: ['open_first_video'], fn: stepPlayerToggleMute },
    player_toggle_fullscreen: { needs: 'context', prefix: ['open_first_video'], fn: stepPlayerToggleFullscreen },
    player_open_settings: { needs: 'context', prefix: ['open_first_video'], fn: stepPlayerOpenSettings },
    like_video: { needs: 'context', prefix: ['open_first_video'], fn: stepLikeVideo },
    dislike_video: { needs: 'context', prefix: ['open_first_video'], fn: stepDislikeVideo },
    subscribe_channel: { needs: 'context', prefix: ['open_first_video'], fn: stepSubscribeChannel },
    open_comments_section: { needs: 'context', prefix: ['open_first_video'], fn: stepOpenCommentsSection },
    post_comment: { needs: 'context', prefix: ['open_first_video', 'open_comments_section'], fn: stepPostComment },
    open_share_dialog: { needs: 'context', prefix: ['open_first_video'], fn: stepOpenShareDialog },
    copy_share_link: { needs: 'context', prefix: ['open_first_video', 'open_share_dialog'], fn: stepCopyShareLink },
    save_to_watch_later: { needs: 'context', prefix: ['open_first_video'], fn: stepSaveToWatchLater },
    open_channel_page: { needs: 'context', prefix: ['open_first_video'], fn: stepOpenChannelPage },
    read_video_meta: { needs: 'context', prefix: ['open_first_video'], fn: stepReadVideoMeta },
    open_video_from_url: { needs: 'standalone', fn: stepOpenVideoFromUrl },
    like_video_by_url: { needs: 'context', prefix: ['open_video_from_url'], fn: stepLikeVideo },
    comment_by_url: { needs: 'context', prefix: ['open_video_from_url'], fn: stepCommentByUrl },
    nurture_open_home: { needs: 'standalone', fn: stepNurtureOpenHome },
    nurture_watch_video: { needs: 'standalone', fn: stepNurtureWatchVideo },
    nurture_perform_like: { needs: 'standalone', fn: stepNurturePerformLike },
    nurture_perform_subscribe: { needs: 'standalone', fn: stepNurturePerformSubscribe },
    nurture_type_comment: { needs: 'standalone', fn: stepNurtureTypeComment },
    nurture_submit_comment: { needs: 'standalone', fn: stepNurtureSubmitComment },
    nurture_build_context: { needs: 'standalone', fn: stepNurtureBuildContext },
    open_community_tab: { needs: 'standalone', fn: stepOpenCommunityTab },
    open_composer: { needs: 'context', prefix: ['open_community_tab'], fn: stepOpenComposer },
    type_community_text: { needs: 'context', prefix: ['open_community_tab', 'open_composer'], fn: stepTypeCommunityText },
    submit_community_post: { needs: 'context', prefix: ['open_community_tab', 'open_composer', 'type_community_text'], fn: stepSubmitCommunityPost },
    verify_community_post: { needs: 'context', prefix: ['open_community_tab', 'open_composer', 'type_community_text', 'submit_community_post'], fn: stepVerifyCommunityPost },
    open_upload_dialog: { needs: 'standalone', fn: stepOpenUploadDialog },
    set_upload_file: { needs: 'context', prefix: ['open_upload_dialog'], fn: stepSetUploadFile },
    fill_title: { needs: 'context', prefix: ['open_upload_dialog', 'set_upload_file'], fn: stepFillTitle },
    fill_description: { needs: 'context', prefix: ['open_upload_dialog', 'set_upload_file'], fn: stepFillDescription },
    set_visibility: { needs: 'context', prefix: ['open_upload_dialog', 'set_upload_file'], fn: stepSetVisibility },
    advance_wizard: { needs: 'context', prefix: ['open_upload_dialog', 'set_upload_file'], fn: stepAdvanceWizard },
    click_publish: { needs: 'context', prefix: ['open_upload_dialog', 'set_upload_file', 'fill_title', 'set_visibility', 'advance_wizard'], fn: stepClickPublish },
    wait_processing: { needs: 'context', prefix: ['open_upload_dialog', 'set_upload_file'], fn: stepWaitProcessing },
    read_upload_status: { needs: 'context', prefix: ['open_upload_dialog'], fn: stepReadUploadStatus }
  };

  async function runChain() {
    const def = REGISTRY[action];
    const chain = [...(def.prefix || []), action];
    const phase = await getPhase();
    const resumed = Boolean(phase && phase.v === 2 && phase.action === action);
    let doneSteps = resumed ? [...(phase.doneSteps || [])] : [];
    let acc = resumed ? { ...(phase.data || {}) } : {};
    const navCounts = resumed ? { ...(phase.navCounts || {}) } : {};
    const persist = async pendingStep => {
      await chrome.storage.local.set({ [PHASE_KEY]: {
        v: 2, taskId, action, doneSteps, data: acc, navCounts,
        pendingStep: pendingStep || null
      } });
    };
    for (const stepKey of chain) {
      if (doneSteps.includes(stepKey)) continue;
      const isMain = stepKey === action;
      const stepDef = REGISTRY[stepKey];
      let res;
      try {
        res = await stepDef.fn({ acc, payload });
      } catch (err) {
        res = fail('execution_error', `Bước ${stepKey} lỗi: ${err?.message || err}`);
      }
      if (res && res.nav) {
        navCounts[stepKey] = (navCounts[stepKey] || 0) + 1;
        if (navCounts[stepKey] > 2) {
          const details = { action, step: stepKey, nav_attempts: navCounts[stepKey] };
          if (isMain) return report('failed', details, 'execution_error',
            `Bước ${stepKey} điều hướng quá 2 lần mà chưa tới đích`);
          return report('failed', { ...details, prefix_step: stepKey }, 'prefix_failed',
            `Tiền tố ${stepKey} điều hướng quá 2 lần mà chưa tới đích`);
        }
        acc = { ...acc, ...(res.data || {}) };
        await persist(stepKey);
        // Trang đích sẽ thay document này; chờ đủ lâu để điều hướng
        // thật sự xảy ra. Document còn sống sau 15s = điều hướng bị nuốt.
        await sleep(15000);
        if (!reported) {
          const details = { action, step: stepKey, navigation: 'timeout' };
          if (isMain) return report('failed', details, 'execution_error',
            `Bước ${stepKey} đã gán điều hướng nhưng trang không chuyển sau 15s`);
          return report('failed', { ...details, prefix_step: stepKey }, 'prefix_failed',
            `Tiền tố ${stepKey} đã gán điều hướng nhưng trang không chuyển sau 15s`);
        }
        return;
      }
      if (!res || !res.ok) {
        const code = res?.code || 'execution_error';
        const message = res?.message || `Bước ${stepKey} thất bại`;
        if (isMain) {
          return report('failed', { action, ...(res?.details || {}), ...(res?.target ? { target: res.target } : {}) },
            code, message);
        }
        return report('failed', {
          action, prefix_step: stepKey,
          prefix_reason: res?.target || code,
          ...(res?.details || {})
        }, 'prefix_failed', `Tiền tố ${stepKey} thất bại: ${message}`);
      }
      acc = { ...acc, ...(res.details || {}) };
      doneSteps.push(stepKey);
      await persist(null);
    }
    return done(acc, `Đã xong hành động nhỏ: ${action}`);
  }

  try {
    const phase = await getPhase();
    if (phase && phase.v === 2 && REGISTRY[action]) return await runChain();
    if (phase) return await resume(phase);
    if (REGISTRY[action]) return await runChain();
    switch (action) {
      case 'scroll_feed': return await actScrollFeed();
      case 'watch_first': return await actWatchFirst();
      case 'open_notifications': return await actOpenNotifications();
      case 'open_profile': return await actOpenProfile();
      default:
        return report('failed', { action, error: 'unknown_action' }, 'execution_error',
          `YouTube micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `YouTube micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
