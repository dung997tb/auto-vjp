// Auto vjp — Threads micro actions (task type 'micro_action', 2.11.16).
// Hành động nhỏ test LẺ: lướt feed, like bài đầu, mở thông báo (trang
// Hoạt động /activity), mở hồ sơ của mình.
// Task: {platform:'threads', type:'micro_action', payload:{action, seconds?}}.
// Đọc canonical run trực tiếp, báo kết quả bằng action 'microActionDone'
// (results.js deliver type 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found'.
// Bộ chọn theo threads/interaction.js (svg aria-label Like/Thích —
// Unlike/Bỏ thích) + threads-nurture/adapter.js (khung bài
// [data-pressable-container], link permalink /@user). Thông báo Threads
// là route /activity (icon tim ở nav); hồ sơ là link /@<handle> ở nav.
// Phase storage (avjpMicroPhase_threads) lo chạy tiếp sau điều hướng;
// click ưu tiên AVJP.human.clickEl, vắng -> click thường.
if (window.top !== window.self) {
  // Chỉ chạy ở frame chính.
} else {
(async () => {
  const PLATFORM = 'threads';
  const PHASE_KEY = 'avjpMicroPhase_threads';
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

  // ── Bộ chọn riêng Threads ──
  const LIKE_SVG = 'svg[aria-label="Like"], svg[aria-label="Thích"]';
  const UNLIKE_SVG = 'svg[aria-label="Unlike"], svg[aria-label="Bỏ thích"]';
  // Bài đầu: khung bài [data-pressable-container] đầu tiên; không có thì
  // lấy theo thứ tự tài liệu như interaction.js vẫn làm.
  function firstPostScope() {
    return document.querySelector('[data-pressable-container]') || document;
  }
  function ownProfileLink() {
    const navs = document.querySelectorAll('header a[href^="/@"], nav a[href^="/@"], [role="navigation"] a[href^="/@"]');
    for (const a of navs) {
      const h = a.getAttribute('href') || '';
      if (/^\/@[A-Za-z0-9._]+\/?$/.test(h) && visible(a)) return { el: a, username: h.replace(/^\//, '').replace(/\/$/, '') };
    }
    return null;
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

  async function actLikeFirst() {
    // Chờ tới khi bài đầu THẬT SỰ có nút like (hoặc đã ở trạng thái unlike):
    // firstPostScope luôn trả về ít nhất document nên không chờ theo scope.
    const ready = await waitFor(() => {
      const scope = firstPostScope();
      if (scope.querySelector(UNLIKE_SVG)) return { already: true };
      const svg = scope.querySelector(LIKE_SVG) ||
        (scope === document ? null : document.querySelector(LIKE_SVG));
      return svg ? { svg } : null;
    }, 15000);
    if (!ready) return failSelector('first_post_like_button');
    if (ready.already) return done({ liked: true, already: true }, 'Bài đầu đã được thích sẵn');
    const btn = ready.svg.closest('button, [role="button"]') || ready.svg;
    await setPhase({});
    await humanClick(btn);
    const verified = await waitFor(() => document.querySelector(UNLIKE_SVG) ? true : null, 3000);
    done({ liked: true, verified: Boolean(verified) }, verified ? 'Đã thích bài đầu (đã xác minh)' : 'Đã bấm thích bài đầu (chưa thấy trạng thái xác minh)');
  }

  async function actOpenNotifications() {
    await setPhase({});
    const link = await waitFor(() => {
      const a = document.querySelector('a[href="/activity"], a[href^="/activity?"]');
      if (a && visible(a)) return a;
      const svg = document.querySelector('svg[aria-label="Activity"], svg[aria-label="Hoạt động"]');
      return svg ? (svg.closest('a, button, [role="button"]') || null) : null;
    }, 10000);
    if (link) await humanClick(link);
    else location.assign('https://www.threads.net/activity');
    const ok = await waitFor(() => location.pathname.startsWith('/activity') ? true : null, 6000);
    if (!ok) return failSelector('activity_page', { clicked: Boolean(link) });
    done({ opened: true }, 'Đã mở trang thông báo (Hoạt động)');
  }

  async function actOpenProfile() {
    const found = await waitFor(() => ownProfileLink(), 12000);
    if (!found) return failSelector('own_profile_link');
    await setPhase({ username: found.username });
    await humanClick(found.el);
    const ok = await waitFor(() => {
      const p = location.pathname.replace(/\/$/, '');
      return p === `/${found.username}` ? true : null;
    }, 6000);
    if (!ok) return failSelector('profile_page', { clicked: true, username: found.username });
    done({ opened: true, username: found.username }, `Đã mở hồ sơ ${found.username}`);
  }

  // ── Chạy tiếp sau điều hướng ──
  async function resume(phase) {
    switch (action) {
      case 'scroll_feed':
        return done({ resumed: true }, 'Đã lướt feed (lượt chạy tiếp sau điều hướng)');
      case 'like_first': {
        const scope = firstPostScope();
        if (scope && scope.querySelector && scope.querySelector(UNLIKE_SVG)) {
          return done({ liked: true, already: true, resumed: true }, 'Bài đầu đã được thích (xác minh ở lượt tiếp)');
        }
        return actLikeFirst();
      }
      case 'open_notifications': {
        if (location.pathname.startsWith('/activity')) return done({ opened: true, resumed: true }, 'Đã tới trang thông báo (lượt tiếp)');
        return failSelector('activity_page', { resumed: true });
      }
      case 'open_profile': {
        const seg = /^\/@[A-Za-z0-9._]+\/?$/.test(location.pathname);
        if (seg) return done({ opened: true, resumed: true, username: location.pathname.replace(/\//g, '') }, 'Đã tới hồ sơ (lượt tiếp)');
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
          `Threads micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `Threads micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
