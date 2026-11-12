// Auto vjp — YouTube micro actions (task type 'micro_action', 2.11.16).
// Hành động nhỏ test LẺ: lướt trang chủ, xem video đầu, mở chuông thông
// báo, mở kênh của mình (qua menu avatar).
// Task: {platform:'youtube', type:'micro_action', payload:{action, seconds?}}.
// Đọc canonical run trực tiếp, báo kết quả bằng action 'microActionDone'
// (results.js deliver type 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found';
// video không phát thật (currentTime không chạy) -> failed, không bịa.
// Bộ chọn theo youtube-nurture/adapter.js (link video đầu:
// a#thumbnail[href*="/watch?v="] / a#video-title) + youtube/automator.js
// (nút avatar #avatar-btn phải xuyên shadow DOM kiểu queryShadow; kênh
// của mình chỉ tin link /channel/ hoặc /@ trong menu tài khoản).
// Xem video đầu bấm thumbnail -> chuyển trang /watch: phase storage
// (avjpMicroPhase_youtube) giúp bản inject ở trang watch CHỈ chờ phát +
// đủ giây rồi báo, không bấm lại. Click ưu tiên AVJP.human.clickEl.
if (window.top !== window.self) {
  // Chỉ chạy ở frame chính.
} else {
(async () => {
  const PLATFORM = 'youtube';
  const PHASE_KEY = 'avjpMicroPhase_youtube';
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
  async function humanScrollBy(dy) {
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.scrollBy === 'function') { await human.scrollBy(dy); return true; }
    } catch (_) {}
    window.scrollBy(0, dy);
    return false;
  }

  // ── Các hành động ──
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

  // ── Chạy tiếp sau điều hướng ──
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

  try {
    const phase = await getPhase();
    if (phase) return await resume(phase);
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
