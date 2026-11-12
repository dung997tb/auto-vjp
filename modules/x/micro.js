// Auto vjp — X (Twitter) micro actions (task type 'micro_action', 2.11.16).
// Hành động nhỏ test LẺ: lướt dòng thời gian, like bài đầu, mở thông báo
// (/notifications), mở hồ sơ của mình.
// Task: {platform:'x', type:'micro_action', payload:{action, seconds?}}.
// startUrl của kernel mở https://x.com/home.
// Đọc canonical run trực tiếp, báo kết quả bằng action 'microActionDone'
// (results.js deliver type 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found'.
// Bộ chọn theo x/interaction.js (nút [data-testid="like"] / "unlike"
// trong article) + x/automator.js:353 / accounts-scanner.js:43 (link hồ
// sơ a[data-testid="AppTabBar_Profile_Link"], đoạn path dành riêng).
// Phase storage (avjpMicroPhase_x) lo chạy tiếp sau điều hướng; click
// ưu tiên AVJP.human.clickEl, vắng -> click thường.
if (window.top !== window.self) {
  // Chỉ chạy ở frame chính.
} else {
(async () => {
  const PLATFORM = 'x';
  const PHASE_KEY = 'avjpMicroPhase_x';
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
  async function humanScrollBy(dy) {
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.scrollBy === 'function') { await human.scrollBy(dy); return true; }
    } catch (_) {}
    window.scrollBy(0, dy);
    return false;
  }

  // ── Bộ chọn riêng X ──
  const RESERVED_SEGMENTS = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'bookmarks', 'lists', 'communities']);
  const firstArticle = () => document.querySelector('article[data-testid="tweet"], article');

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

  async function actLikeFirst() {
    const article = await waitFor(firstArticle, 15000);
    if (!article) return failSelector('first_tweet_article');
    if (article.querySelector('[data-testid="unlike"]')) return done({ liked: true, already: true }, 'Bài đầu đã được thích sẵn');
    const likeBtn = await waitFor(() => article.querySelector('[data-testid="like"]'), 8000);
    if (!likeBtn) return failSelector('first_tweet_like_button');
    await setPhase({});
    await humanClick(likeBtn);
    const verified = await waitFor(() => article.querySelector('[data-testid="unlike"]') ? true : null, 3000);
    done({ liked: true, verified: Boolean(verified) }, verified ? 'Đã thích bài đầu (đã xác minh)' : 'Đã bấm thích bài đầu (chưa thấy trạng thái xác minh)');
  }

  async function actOpenNotifications() {
    await setPhase({});
    const link = await waitFor(() => {
      const a = document.querySelector('header a[href="/notifications"], nav a[href="/notifications"], a[href="/notifications"]');
      return a && visible(a) ? a : null;
    }, 10000);
    if (link) await humanClick(link);
    else location.assign('https://x.com/notifications');
    const ok = await waitFor(() => location.pathname.startsWith('/notifications') ? true : null, 6000);
    if (!ok) return failSelector('notifications_page', { clicked: Boolean(link) });
    done({ opened: true }, 'Đã mở trang thông báo');
  }

  async function actOpenProfile() {
    const link = await waitFor(() => {
      const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      return a && visible(a) ? a : null;
    }, 12000);
    if (!link) return failSelector('own_profile_link');
    const href = link.getAttribute('href') || '';
    const handle = href.replace(/^\//, '').replace(/\/$/, '');
    await setPhase({ username: handle || null });
    await humanClick(link);
    const ok = await waitFor(() => {
      const seg = /^\/([A-Za-z0-9_]+)\/?$/.exec(location.pathname);
      return seg && !RESERVED_SEGMENTS.has(seg[1].toLowerCase()) ? true : null;
    }, 6000);
    if (!ok) return failSelector('profile_page', { clicked: true });
    done({ opened: true, username: location.pathname.replace(/\//g, '') }, `Đã mở hồ sơ ${location.pathname}`);
  }

  // ── Chạy tiếp sau điều hướng ──
  async function resume(phase) {
    switch (action) {
      case 'scroll_feed':
        return done({ resumed: true }, 'Đã lướt feed (lượt chạy tiếp sau điều hướng)');
      case 'like_first': {
        const article = await waitFor(firstArticle, 8000);
        if (article && article.querySelector('[data-testid="unlike"]')) {
          return done({ liked: true, already: true, resumed: true }, 'Bài đầu đã được thích (xác minh ở lượt tiếp)');
        }
        return actLikeFirst();
      }
      case 'open_notifications': {
        if (location.pathname.startsWith('/notifications')) return done({ opened: true, resumed: true }, 'Đã tới trang thông báo (lượt tiếp)');
        return failSelector('notifications_page', { resumed: true });
      }
      case 'open_profile': {
        const seg = /^\/([A-Za-z0-9_]+)\/?$/.exec(location.pathname);
        if (seg && !RESERVED_SEGMENTS.has(seg[1].toLowerCase())) {
          return done({ opened: true, resumed: true, username: seg[1] }, 'Đã tới hồ sơ (lượt tiếp)');
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
      case 'like_first': return await actLikeFirst();
      case 'open_notifications': return await actOpenNotifications();
      case 'open_profile': return await actOpenProfile();
      default:
        return report('failed', { action, error: 'unknown_action' }, 'execution_error',
          `X micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `X micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
