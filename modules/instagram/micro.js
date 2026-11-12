// Auto vjp — Instagram micro actions (task type 'micro_action', 2.11.16).
// Hành động nhỏ test LẺ từng module từ bảng "Test hành động": lướt feed,
// like bài đầu, xem story đầu, mở thông báo, mở hồ sơ của mình.
// Task: {platform:'instagram', type:'micro_action', payload:{action, seconds?}}.
// Đọc canonical run `currentAutomationRun` trực tiếp (như story.js), báo
// kết quả bằng action DUY NHẤT 'microActionDone' (results.js deliver type
// 'micro_action', mang details + failure_code như mọi type).
//
// Kỷ luật trung thực: không tìm thấy phần tử đích -> failed
// 'selector_not_found', KHÔNG bịa success. Bài đầu đã like -> success
// với details {already:true}.
//
// Điều hướng làm trang tải lại (mở hồ sơ...) giết bản inject hiện tại —
// runner inject lại ở document mới theo URL mới; phase lưu ở storage
// (key avjpMicroPhase_instagram, gắn taskId) cho biết đây là lượt chạy
// TIẾP TỤC: chỉ XÁC MINH đích đã tới, không bấm lại từ đầu (tránh vòng lặp).
// Click ưu tiên AVJP.human.clickEl (humanmouse.js nạp trước theo
// contract); human vắng mặt/trả false -> rơi về click DOM thường.
if (window.top !== window.self) {
  // Frame con: micro chỉ chạy ở frame chính (contract đã frameTopOnly,
  // chốt này là lớp dự phòng khi inject cả frame).
} else {
(async () => {
  const PLATFORM = 'instagram';
  const PHASE_KEY = 'avjpMicroPhase_instagram';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  const stored = await chrome.storage.local.get('currentAutomationRun');
  const run = stored.currentAutomationRun;
  if (!run || run.platform !== PLATFORM || run.type !== 'micro_action') return;
  const taskId = String(run.task_id || run.id || '');
  if (!taskId) return;
  // Chống inject trùng trong CÙNG document (runner đã có key guard theo
  // URL; đây là lớp chặn riêng theo run).
  if (window.__avjpMicroRunId === run.run_id) return;
  window.__avjpMicroRunId = run.run_id;

  const payload = (run.payload && typeof run.payload === 'object') ? run.payload : {};
  const action = String(payload.action || run.action || '');
  const rawSeconds = Number(payload.seconds ?? run.seconds);
  const secondsOr = dflt => {
    const s = Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.round(rawSeconds) : dflt;
    return Math.min(120, Math.max(1, s));
  };

  // ── Phase (chạy tiếp sau điều hướng) ──
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

  // ── Helpers ──
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
  // Click kiểu story.js (chuỗi sự kiện chuột đầy đủ) — đường dự phòng.
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
  // Ưu tiên chuột người AVJP.human.clickEl; không có/trả false -> click thường.
  async function humanClick(el) {
    if (!el) return false;
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.clickEl === 'function') {
        const ok = await human.clickEl(el);
        if (ok) return true;
      }
    } catch (_) { /* human lỗi -> rơi xuống click thường */ }
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
  function pressEscape() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    try { document.dispatchEvent(new KeyboardEvent('keydown', opts)); } catch (_) {}
    try { document.dispatchEvent(new KeyboardEvent('keyup', opts)); } catch (_) {}
  }

  // ── Bộ chọn riêng Instagram (bằng chứng: interaction.js:71-73 cho
  // like/unlike; story.js cho khay story + heuristic link hồ sơ) ──
  const LIKE_SVG = 'svg[aria-label="Like"], svg[aria-label="Thích"]';
  const UNLIKE_SVG = 'svg[aria-label="Unlike"], svg[aria-label="Bỏ thích"]';
  const RESERVED_SEGMENTS = new Set(['explore', 'reels', 'reel', 'direct', 'stories', 'accounts',
    'p', 'tv', 'inbox', 'notifications', 'saved', 'tagged', 'followers', 'following', 'about',
    'legal', 'privacy', 'terms', 'create', 'live', 'igtv', 'lite', 'web', 'api', 'home']);
  function firstArticle() {
    return document.querySelector('main article') || document.querySelector('article');
  }
  function findOwnProfileLink() {
    const links = Array.from(document.querySelectorAll('header a[href^="/"], nav a[href^="/"], a[href^="/"]'));
    for (const a of links) {
      const h = a.getAttribute('href') || '';
      const m = /^\/([A-Za-z0-9._]+)\/?$/.exec(h);
      if (!m || RESERVED_SEGMENTS.has(m[1].toLowerCase())) continue;
      // Link hồ sơ ở nav thường bọc ảnh avatar; link bài viết dạng /p/ đã
      // bị RESERVED loại. Ưu tiên phần tử có img hoặc nằm trong nav/header.
      if (a.querySelector('img') || a.closest('header, nav, [role="navigation"]')) return { el: a, username: m[1] };
    }
    return null;
  }
  function notificationsButton() {
    const svg = document.querySelector('svg[aria-label="Notifications"], svg[aria-label="Thông báo"]');
    return svg ? (svg.closest('a, button, [role="button"]') || svg) : null;
  }
  // Panel thông báo IG KHÔNG có role="dialog"/"menu" (bằng chứng DOM thật
  // trên nuc 2026-11-12, IG @langlehoaanhdao, bản 2.11.16): sau khi bấm nút
  // chuông, thứ xuất hiện là một <div> thường rộng ~430-460px chứa tiêu đề
  // "Notifications" và các mục của panel ("All / People you follow /
  // Comments / Follows / Tags & mentions / Verified", "This month", ...).
  // Tiêu chí xác minh: thấy tiêu đề panel (nút text trực tiếp, tìm bằng
  // XPath cho rẻ) VÀ một khung tổ tiên gần (<=5 cấp, rộng 280-680px) chứa
  // dấu hiệu riêng của panel (nhãn mục lọc / tiêu đề nhóm thời gian) —
  // nhãn "Notifications" ở thanh điều hướng không có các dấu hiệu này nên
  // không nhận nhầm.
  const NOTIF_SECTION = /(this month|this week|earlier|yesterday|people you follow|tags & mentions|tháng này|trước đó|hôm qua|người bạn theo dõi|thẻ.*lượt nhắc)/i;
  function findNotificationsPanel() {
    let nodes = [];
    try {
      const xp = document.evaluate(
        "//*[text()[normalize-space()='Notifications' or normalize-space()='Thông báo']]",
        document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < xp.snapshotLength; i++) nodes.push(xp.snapshotItem(i));
    } catch (_) {}
    if (!nodes.length) {
      nodes = Array.from(document.querySelectorAll('h1, h2, h3, span'))
        .filter(el => /^(Notifications|Thông báo)$/.test((el.innerText || '').trim()));
    }
    for (const head of nodes) {
      if (!visible(head)) continue;
      let el = head;
      for (let depth = 0; depth < 5 && el; depth++) {
        const r = el.getBoundingClientRect();
        if (r.width >= 280 && r.width <= 680 && NOTIF_SECTION.test(el.innerText || '')) return el;
        el = el.parentElement;
      }
    }
    return null;
  }
  function notificationsPanelVisible() {
    return findNotificationsPanel() !== null;
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
    const article = await waitFor(firstArticle, 15000);
    if (!article) return failSelector('first_post_article');
    if (article.querySelector(UNLIKE_SVG)) return done({ liked: true, already: true }, 'Bài đầu đã được thích sẵn');
    const likeSvg = await waitFor(() => article.querySelector(LIKE_SVG), 8000);
    const btn = likeSvg ? (likeSvg.closest('button, [role="button"]') || likeSvg) : null;
    if (!btn) return failSelector('first_post_like_button');
    await setPhase({});
    await humanClick(btn);
    const verified = await waitFor(() => article.querySelector(UNLIKE_SVG) ? true : null, 3000);
    done({ liked: true, verified: Boolean(verified) }, verified ? 'Đã thích bài đầu (đã xác minh)' : 'Đã bấm thích bài đầu (chưa thấy trạng thái xác minh)');
  }

  async function actViewFirstStory() {
    const own = findOwnProfileLink();
    const pickStoryLink = () => {
      const links = Array.from(document.querySelectorAll('a[href^="/stories/"]')).filter(visible);
      for (const a of links) {
        const label = `${a.getAttribute('aria-label') || ''} ${a.textContent || ''}`;
        if (/tin của bạn|your story/i.test(label)) continue; // ô tạo story của mình
        const m = /^\/stories\/([A-Za-z0-9._]+)\//.exec(a.getAttribute('href') || '');
        if (!m) continue;
        if (own && m[1].toLowerCase() === own.username.toLowerCase()) continue; // story của mình
        return { el: a, user: m[1] };
      }
      return null;
    };
    const found = await waitFor(pickStoryLink, 15000);
    if (!found) return failSelector('first_story_tray_item');
    await setPhase({ storyUser: found.user });
    await humanClick(found.el);
    const opened = await waitFor(() => location.pathname.startsWith('/stories/') ||
      document.querySelector('[role="dialog"] video, [role="dialog"] img') ? true : null, 6000);
    if (!opened) return failSelector('story_viewer', { clicked: true });
    await sleep(rand(3000, 5000));
    pressEscape();
    await sleep(400);
    done({ viewed: true, user: found.user }, `Đã xem story đầu của @${found.user}`);
  }

  async function actOpenNotifications() {
    const btn = await waitFor(() => notificationsButton(), 12000);
    if (!btn) return failSelector('notifications_button');
    await setPhase({});
    await humanClick(btn);
    const panel = await waitFor(() => findNotificationsPanel(), 4000);
    if (!panel) return failSelector('notifications_panel', { clicked: true });
    const marker = ((panel.innerText || '').match(NOTIF_SECTION) || [])[0] || null;
    done({ opened: true, marker }, 'Đã mở panel thông báo');
  }

  async function actOpenProfile() {
    const found = await waitFor(() => findOwnProfileLink(), 12000);
    if (!found) return failSelector('own_profile_link');
    await setPhase({ username: found.username });
    await humanClick(found.el);
    const ok = await waitFor(() => {
      const p = location.pathname.replace(/\/$/, '');
      return p === `/${found.username}` ? true : null;
    }, 6000);
    if (!ok) return failSelector('profile_page', { clicked: true, username: found.username });
    done({ opened: true, username: found.username }, `Đã mở hồ sơ @${found.username}`);
  }

  // ── Chạy tiếp sau điều hướng (phase còn từ lượt trước) ──
  async function resume(phase) {
    switch (action) {
      case 'scroll_feed':
        return done({ resumed: true }, 'Đã lướt feed (lượt chạy tiếp sau điều hướng)');
      case 'like_first': {
        const article = await waitFor(firstArticle, 8000);
        if (article && article.querySelector(UNLIKE_SVG)) {
          return done({ liked: true, already: true, resumed: true }, 'Bài đầu đã được thích (xác minh ở lượt tiếp)');
        }
        return actLikeFirst(); // lượt trước chết trước khi bấm -> làm lại (đã có chốt already ở trên)
      }
      case 'view_first_story': {
        if (location.pathname.startsWith('/stories/')) {
          await sleep(rand(2500, 4000));
          pressEscape();
          return done({ viewed: true, resumed: true, user: phase.storyUser || null }, 'Đã xem story đầu (lượt tiếp)');
        }
        return report('failed', { action, resumed: true, found: false, target: 'story_viewer' },
          'execution_error', 'Mất phiên giữa chừng, không tới được trình xem story');
      }
      case 'open_notifications': {
        const panel = await waitFor(() => notificationsPanelVisible() ? true : null, 3000);
        if (panel) return done({ opened: true, resumed: true }, 'Panel thông báo đã mở (lượt tiếp)');
        return failSelector('notifications_panel', { resumed: true });
      }
      case 'open_profile': {
        const seg = /^\/([A-Za-z0-9._]+)\/?$/.exec(location.pathname);
        if (seg && !RESERVED_SEGMENTS.has(seg[1].toLowerCase())) {
          return done({ opened: true, resumed: true, username: seg[1] }, `Đã tới hồ sơ @${seg[1]} (lượt tiếp)`);
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
      case 'view_first_story': return await actViewFirstStory();
      case 'open_notifications': return await actOpenNotifications();
      case 'open_profile': return await actOpenProfile();
      default:
        return report('failed', { action, error: 'unknown_action' }, 'execution_error',
          `Instagram micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `Instagram micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
