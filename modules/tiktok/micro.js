// Auto vjp — TikTok micro actions (task type 'micro_action', 2.11.16).
// Hành động nhỏ test LẺ: lướt feed (For You), xem video đầu, like video
// đầu, mở thông báo (inbox), mở hồ sơ của mình.
// Task: {platform:'tiktok', type:'micro_action', payload:{action, seconds?}}.
// startUrl của kernel mở /foryou (trang gốc headless render rỗng).
// Đọc canonical run trực tiếp, báo kết quả bằng action 'microActionDone'
// (results.js deliver type 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found'.
// Bộ chọn lấy từ tiktok-nurture/selectors.js + modules.js (bằng chứng
// trong repo): like = [data-e2e="like-icon"]..., đã-like = aria-pressed
// "true" (modules.js), inbox = [data-e2e="inbox-icon"], hồ sơ =
// a[data-e2e="nav-profile"].
// Phase storage (avjpMicroPhase_tiktok) lo chạy tiếp sau điều hướng như
// các micro khác; click ưu tiên AVJP.human.clickEl, vắng -> click thường.
if (window.top !== window.self) {
  // Chỉ chạy ở frame chính.
} else {
(async () => {
  const PLATFORM = 'tiktok';
  const PHASE_KEY = 'avjpMicroPhase_tiktok';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  const stored = await chrome.storage.local.get('currentAutomationRun');
  const run = stored.currentAutomationRun;
  if (!run || run.platform !== PLATFORM || run.type !== 'micro_action') return;
  const taskId = String(run.task_id || run.id || '');
  if (!taskId) return;
  if (window.__avjpMicroRunId === run.run_id) return;
  window.__avjpMicroRunId = run.run_id;

  const payload = (run.payload && typeof run.payload === 'object') ? run.payload : {};
  const action = String(payload.action || run.action || '');
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

  // ── Bộ chọn riêng TikTok (từ tiktok-nurture/selectors.js) ──
  const VIDEO_SELECTORS = [
    'div[data-e2e="recommend-list-item-container"] video',
    'div[data-e2e="feed-video"] video',
    'div[data-e2e="browse-video"] video',
    'article video', 'main video', 'video'
  ];
  const LIKE_SELECTORS = [
    'button[data-e2e="like-icon"]',
    'button[data-e2e="feed-like-icon"]',
    'button[data-e2e="browse-like-icon"]',
    'button[aria-label*="Thích video"]',
    'button[aria-label*="Like video"]',
    '[data-e2e="like-icon"]',
    '[data-e2e="feed-like-icon"]'
  ];
  const firstMatch = list => {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && visible(el)) return el;
    }
    return null;
  };
  const firstVideo = () => firstMatch(VIDEO_SELECTORS);
  const likeButton = () => firstMatch(LIKE_SELECTORS);
  const isLiked = btn => btn && btn.getAttribute('aria-pressed') === 'true';

  // ── Các hành động ──
  // Feed TikTok không cuộn bằng window.scrollBy (danh sách snap theo
  // video) — "lướt" ở đây là bắn sự kiện wheel lên khung video như
  // Farmer vẫn làm để chuyển video, từng nhịp có nghỉ ngẫu nhiên.
  async function actScrollFeed() {
    const secs = secondsOr(30);
    const anchor = await waitFor(() => firstVideo() ||
      document.querySelector('[data-e2e="recommend-list-item-container"], main'), 12000);
    if (!anchor) return failSelector('feed_container');
    const end = Date.now() + secs * 1000;
    let ticks = 0;
    while (Date.now() < end) {
      const target = firstVideo() || anchor;
      const dy = Math.round(rand(500, 900));
      try { target.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true, view: window })); } catch (_) {}
      try { window.scrollBy(0, dy); } catch (_) {}
      ticks++;
      await sleep(Math.min(rand(1600, 3200), Math.max(0, end - Date.now())));
    }
    done({ seconds: secs, ticks });
  }

  // Chờ video THẬT SỰ phát: currentTime phải nhích — bằng chứng phát,
  // không chỉ "có thẻ video trong DOM".
  async function ensurePlaying(v, timeoutMs = 9000) {
    if (!v) return false;
    if (v.paused) {
      try { await v.play(); } catch (_) {}
      if (v.paused) await humanClick(v);
    }
    const t0 = v.currentTime || 0;
    return Boolean(await waitFor(() => (v.currentTime || 0) > t0 + 0.4 ? true : null, timeoutMs, 250));
  }

  async function actWatchFirst() {
    const secs = secondsOr(20);
    const v = await waitFor(firstVideo, 15000);
    if (!v) return failSelector('first_video');
    await setPhase({});
    const playing = await ensurePlaying(v);
    if (!playing) {
      return report('failed', { action, found: true, target: 'first_video_playback' }, 'execution_error',
        'Có video đầu nhưng không phát được (không thấy currentTime chạy)');
    }
    await sleep(secs * 1000);
    done({ watched_seconds: secs }, `Đã xem video đầu ${secs} giây`);
  }

  async function actLikeFirst() {
    const btn = await waitFor(likeButton, 15000);
    if (!btn) return failSelector('first_video_like_button');
    if (isLiked(btn)) return done({ liked: true, already: true }, 'Video đầu đã được thích sẵn');
    await setPhase({});
    await humanClick(btn);
    const verified = await waitFor(() => isLiked(likeButton()) ? true : null, 3000);
    done({ liked: true, verified: Boolean(verified) }, verified ? 'Đã thích video đầu (đã xác minh)' : 'Đã bấm thích video đầu (chưa thấy trạng thái xác minh)');
  }

  async function actOpenNotifications() {
    const btn = await waitFor(() =>
      firstMatch(['[data-e2e="inbox-icon"]', '[data-e2e="nav-inbox"]', 'a[href*="/messages"]']), 12000);
    if (!btn) return failSelector('inbox_button');
    await setPhase({});
    await humanClick(btn);
    const panel = await waitFor(() => {
      if (/\/(inbox|messages)/.test(location.pathname)) return true;
      return firstMatch(['div[data-e2e="notification-item"]', 'div[data-e2e="inbox-item"]', 'li[data-e2e="inbox-list-item"]']) ? true : null;
    }, 5000);
    if (!panel) return failSelector('notifications_panel', { clicked: true });
    done({ opened: true }, 'Đã mở thông báo / hộp thư TikTok');
  }

  async function actOpenProfile() {
    const link = await waitFor(() => document.querySelector('a[data-e2e="nav-profile"]'), 12000);
    if (!link) return failSelector('nav_profile_link');
    const href = link.getAttribute('href') || '';
    const m = /\/(@[A-Za-z0-9._]+)/.exec(href);
    await setPhase({ username: m ? m[1] : null });
    await humanClick(link);
    const ok = await waitFor(() => /^\/@/.test(location.pathname) ? true : null, 6000);
    if (!ok) return failSelector('profile_page', { clicked: true });
    done({ opened: true, username: location.pathname.slice(1) }, `Đã mở hồ sơ ${location.pathname.slice(1)}`);
  }

  // ── Chạy tiếp sau điều hướng ──
  async function resume(phase) {
    switch (action) {
      case 'scroll_feed':
        return done({ resumed: true }, 'Đã lướt feed (lượt chạy tiếp sau điều hướng)');
      case 'watch_first': {
        const v = await waitFor(firstVideo, 8000);
        if (v && await ensurePlaying(v, 5000)) {
          await sleep(secondsOr(20) * 1000);
          return done({ watched_seconds: secondsOr(20), resumed: true }, 'Đã xem video đầu (lượt tiếp)');
        }
        return report('failed', { action, resumed: true, found: false, target: 'first_video_playback' },
          'execution_error', 'Mất phiên giữa chừng, video đầu không phát ở lượt tiếp');
      }
      case 'like_first': {
        const btn = await waitFor(likeButton, 8000);
        if (btn && isLiked(btn)) return done({ liked: true, already: true, resumed: true }, 'Video đầu đã được thích (xác minh ở lượt tiếp)');
        return actLikeFirst();
      }
      case 'open_notifications': {
        const hit = /\/(inbox|messages)/.test(location.pathname) ||
          firstMatch(['div[data-e2e="notification-item"]', 'div[data-e2e="inbox-item"]', 'li[data-e2e="inbox-list-item"]']);
        if (hit) return done({ opened: true, resumed: true }, 'Đã tới thông báo / hộp thư (lượt tiếp)');
        return failSelector('notifications_panel', { resumed: true });
      }
      case 'open_profile': {
        if (/^\/@/.test(location.pathname)) {
          return done({ opened: true, resumed: true, username: location.pathname.slice(1) }, 'Đã tới hồ sơ (lượt tiếp)');
        }
        return failSelector('profile_page', { resumed: true });
      }
      default:
        return report('failed', { action, resumed: true }, 'execution_error', `Không khôi phục được hành động: ${action}`);
    }
  }

  try {
    const phase = await getPhase();
    if (phase) return await resume(phase);
    switch (action) {
      case 'scroll_feed': return await actScrollFeed();
      case 'watch_first': return await actWatchFirst();
      case 'like_first': return await actLikeFirst();
      case 'open_notifications': return await actOpenNotifications();
      case 'open_profile': return await actOpenProfile();
      default:
        return report('failed', { action, error: 'unknown_action' }, 'execution_error',
          `TikTok micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `TikTok micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
