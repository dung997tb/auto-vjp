// Auto vjp — Instagram micro actions (task type 'micro_action', 2.11.17).
// Hành động nhỏ test LẺ từng module từ bảng "Test hành động".
// 2.11.16: 5 key đầu (scroll_feed, like_first, view_first_story,
// open_notifications, open_profile) — giữ nguyên key + hành vi.
// 2.11.17: mở đủ 33 hành động nguyên tử IG. Các key mới chạy qua
// STEP-RUNNER THEO CHUỖI (chain): entry có prefix thì chạy lần lượt
// handler của các key tiền tố trước, handler của key đích sau cùng;
// tiền tố fail -> failed 'prefix_failed' + details.failed_step.
// Phase lưu ở storage (key avjpMicroPhase_instagram, gắn taskId) ghi
// {chain, idx, data, pendingVerify} để chạy tiếp sau điều hướng làm
// trang tải lại (đúng tiền lệ micro.js 2.11.16 + story.js): handler
// sắp điều hướng thì set pendingVerify TRƯỚC, chết giữa chừng thì lượt
// inject mới chỉ xác minh đã tới đích (bảng ARRIVE) rồi chạy LẠI
// handler đó — mọi handler đều idempotent tại đích (tới nơi rồi thì
// hoàn tất tại chỗ, không bấm lại từ đầu).
//
// Về "hàm nguồn": interaction.js / affiliate-commenter.js /
// accounts-scanner.js / instagram-nurture/adapter.js / automator.js
// đều là script tự chạy khép kín (IIFE đọc storage key riêng, KHÔNG
// export hàm ra global) nên micro không gọi trực tiếp được và cũng
// KHÔNG nạp kèm trong contract (scanner tự fetch + quét ngay khi nạp,
// adapter văng lỗi khi thiếu nurture-core, interaction/affiliate có
// thể chạy theo task cũ còn sót key). Thay vào đó mỗi handler dưới
// đây dùng ĐÚNG selector/thuật toán của file nguồn, ghi rõ nguồn tại
// từng handler — cùng cách 5 key 2.11.16 đã làm (neo interaction.js).
//
// Task: {platform:'instagram', type:'micro_action',
//        payload:{action, seconds?, target_url?, content?, query?}}.
// Đọc canonical run `currentAutomationRun` trực tiếp (như story.js),
// báo kết quả bằng action DUY NHẤT 'microActionDone' (results.js
// deliver type 'micro_action', mang details + failure_code).
//
// Kỷ luật trung thực: không tìm thấy phần tử đích -> failed
// 'selector_not_found', KHÔNG bịa success. Thiếu đầu vào bắt buộc
// (target_url/content/query) -> failed với failure_code rõ lý do
// ('missing_target_url' / 'missing_content' / 'missing_query').
// Click ưu tiên AVJP.human.clickEl (humanmouse.js nạp trước theo
// contract); human vắng mặt/trả false -> rơi về click DOM thường, và
// nơi gọi KHÔNG bấm lại khi clickEl đã xử lý (humanClick gói trọn).
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
  // Đầu vào của các handler mới (brief: đọc từ payload của task;
  // chấp thêm field ngang hàng trên run cho các đường tạo task khác).
  const targetUrl = () => String(payload.target_url || payload.url || run.target_url || run.source_url || '').trim();
  const commentContent = () => String(payload.content || payload.text || payload.comment || '').trim();
  const searchQuery = () => String(payload.query || payload.username || payload.search || '').trim();

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
  const SAVE_SVG = 'svg[aria-label="Save"], svg[aria-label="Lưu"]';
  // unsave theo adapter nurture (L.unsave): Remove / Đã lưu / Bỏ lưu.
  const UNSAVE_SVG = 'svg[aria-label="Remove"], svg[aria-label="Đã lưu"], svg[aria-label="Bỏ lưu"]';
  const COMMENT_SVG = 'svg[aria-label="Comment"], svg[aria-label="Bình luận"]';
  const RESERVED_SEGMENTS = new Set(['explore', 'reels', 'reel', 'direct', 'stories', 'accounts',
    'p', 'tv', 'inbox', 'notifications', 'saved', 'tagged', 'followers', 'following', 'about',
    'legal', 'privacy', 'terms', 'create', 'live', 'igtv', 'lite', 'web', 'api', 'home']);
  function firstArticle() {
    return document.querySelector('main article') || document.querySelector('article');
  }
  // Phạm vi bài đang mở: dialog (bài mở dạng popup) -> article -> main.
  function postScope() {
    return document.querySelector('div[role="dialog"]') || firstArticle() || document.querySelector('main') || document;
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

  // ── Helpers dùng chung cho handler mới — port nguyên văn thuật toán
  // từ file nguồn (ghi nguồn tại từng hàm) ──
  const normText = value => String(value || '').replace(/\s+/g, ' ').trim();
  // interaction.js: label()
  const labelOf = el => normText(`${el?.getAttribute?.('aria-label') || ''} ${el?.textContent || ''}`).toLowerCase();
  // interaction.js + affiliate-commenter.js: findMainCommentBox()
  function findMainCommentBox(root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]'))
      .find(el => visible(el) && /add a comment|thêm bình luận|bình luận/i.test(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')) || null;
  }
  // interaction.js: setText()
  function setTextEl(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }
  // interaction.js: editorText()
  const editorText = el => normText(el?.value || el?.innerText || el?.textContent || '');
  // interaction.js: submitEditor() — khác bản gốc ở cú bấm Post đi qua
  // humanClick (quy ước micro: mọi cú bấm qua AVJP.human).
  async function submitEditorEl(el) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    await sleep(700);
    const scope = el.closest('form, article, div[role="dialog"]') || document;
    const submit = Array.from(scope.querySelectorAll('button, [role="button"]'))
      .find(b => visible(b) && [/^post$/i, /^đăng$/i, /^send$/i, /^gửi$/i].some(p => p.test(labelOf(b))));
    if (submit && !submit.disabled) await humanClick(submit);
    await sleep(900);
  }
  // Lưới bài trên hồ sơ / Explore: link /p/ + /reel/ trong <main>,
  // khử trùng theo href (cùng tinh thần readGridPosts của scanner).
  function gridLinks() {
    const scope = document.querySelector('main') || document;
    const seen = new Map();
    scope.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach(a => {
      if (a.href && !seen.has(a.href)) seen.set(a.href, a);
    });
    return [...seen.values()];
  }
  // Đếm kiểu "1.2K / 3,4M" -> số (bản rút gọn của AVJP.metrics —
  // metrics.js không nằm trong bộ script nhánh micro nên port tại chỗ).
  function parseMetric(raw) {
    const m = /([\d.,]+)\s*([kKmM])?/.exec(String(raw || ''));
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    if ((m[2] || '').toLowerCase() === 'k') n *= 1000;
    if ((m[2] || '').toLowerCase() === 'm') n *= 1000000;
    return Math.round(n);
  }
  // Caption của bài đang mở: trên IG web caption là h1 trong dialog
  // bài, hoặc đoạn span[dir=auto] đầu tiên của vùng bình luận (chính
  // chủ bài) — đường trích xuất của automator/affiliate.
  function extractCaptionText() {
    const scope = postScope();
    const h1 = scope.querySelector?.('h1');
    const h1Text = normText(h1?.textContent || '');
    if (h1Text.length >= 2) return h1Text;
    const nodes = Array.from(scope.querySelectorAll?.('span[dir="auto"], div[dir="auto"]') || []);
    for (const el of nodes) {
      const t = normText(el.textContent);
      if (t.length >= 10 && !/^(like|comment|share|save|post|follow|following|view all|liked by)/i.test(t)) return t;
    }
    return '';
  }
  // Nút Follow theo text chính xác (adapter nurture doFollow: textOf
  // khớp L.follow) — ưu tiên vùng header của phạm vi trước.
  function findFollowButton(root) {
    const scope = root || document;
    const pick = base => Array.from(base.querySelectorAll('button, [role="button"]'))
      .find(b => visible(b) && /^(follow|theo dõi)$/i.test(normText(b.textContent))) || null;
    const header = scope.querySelector?.('header');
    return (header && pick(header)) || pick(scope);
  }
  function isFollowing(root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('button, [role="button"]'))
      .some(b => /^(following|đang theo dõi|requested|đã gửi yêu cầu)$/i.test(normText(b.textContent)));
  }
  const profileSegment = () => {
    const m = /^\/([A-Za-z0-9._]+)\/?$/.exec(location.pathname);
    return m && !RESERVED_SEGMENTS.has(m[1].toLowerCase()) ? m[1] : null;
  };
  const postCodeOf = u => {
    try { return new URL(u, location.origin).pathname.match(/\/(?:p|reel|reels)\/([^/]+)/)?.[1] || ''; }
    catch (_) { return ''; }
  };

  // ── 5 hành động cũ (2.11.16) — giữ nguyên hành vi ──
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

  // ══ 2.11.17 — STEP-RUNNER THEO CHUỖI cho 28 key mới ══
  // Handler trả về một trong:
  //   {details?, message?, data?}  — bước xong tại document này
  //   {fail:{code, message, details?}} — bước hỏng (runner quyết định
  //        bọc thành 'prefix_failed' nếu đây chưa phải bước cuối)
  //   {nav:true} — đã set pendingVerify + điều hướng, chờ inject lại
  // ctx = {data, setData(patch)}: data sống qua các bước + điều hướng
  // nhờ phase storage (commentText, targetUrl, storyUser...).
  const F = {
    sel: (target, extra = {}) => ({ fail: { code: 'selector_not_found', message: `Không tìm thấy phần tử đích: ${target}`, details: { found: false, target, ...extra } } }),
    err: (code, message, extra = {}) => ({ fail: { code, message, details: { ...extra } } })
  };
  // Kiểm chứng "đã tới đích" sau điều hướng cho từng key biết điều hướng.
  const ARRIVE = {
    open_home_feed: () => location.pathname === '/',
    open_post_from_url: ctx => {
      const code = postCodeOf(ctx.data.targetUrl || targetUrl());
      return code ? location.pathname.includes('/' + code) : /\/(p|reel|reels)\/[^/]+/.test(location.pathname);
    },
    open_reels_tab: () => /\/reels?\//.test(location.pathname),
    open_story_ring: () => location.pathname.startsWith('/stories/'),
    open_explore: () => location.pathname.startsWith('/explore'),
    open_first_explore_post: () => /\/(p|reel)\//.test(location.pathname) || !!document.querySelector('div[role="dialog"]'),
    open_own_profile: () => !!profileSegment(),
    scroll_reels: () => /\/reels?\//.test(location.pathname),
    follow_from_search: () => !!profileSegment(),
    scan_highlight_reel: () => /\/reels?\//.test(location.pathname) || !!document.querySelector('video'),
    scan_profile_media: () => !!profileSegment(),
    scan_reels_metrics: () => /^\/[^/]+\/reels\/?$/.test(location.pathname)
  };
  // Set pendingVerify TRƯỚC khi điều hướng; chờ tới đích ngay tại
  // document này (điều hướng SPA không giết script): tới -> 'arrived'
  // (handler tự hoàn tất nốt), không tới -> 'gone' (chờ inject lại).
  async function navStep(key, doNav, ctx) {
    await setPhase({ pendingVerify: key });
    await doNav();
    const arriveFn = ARRIVE[key];
    const arrived = arriveFn ? await waitFor(() => { try { return arriveFn(ctx) ? true : null; } catch (_) { return null; } }, 7000) : null;
    if (arrived) { await setPhase({ pendingVerify: null }); return 'arrived'; }
    return 'gone';
  }

  // 1. open_home_feed — nguồn: automator.js run() nhánh điều hướng về
  // trang chủ instagram.com rồi chờ bề mặt feed dựng.
  async function hOpenHomeFeed(ctx) {
    if (location.pathname !== '/') {
      const r = await navStep('open_home_feed', async () => { location.assign('https://www.instagram.com/'); }, ctx);
      if (r === 'gone') return { nav: true };
    }
    const feed = await waitFor(() => firstArticle() || document.querySelector('a[href^="/stories/"]'), 12000);
    if (!feed) return F.sel('home_feed');
    return { details: { opened: true, url: location.href }, message: 'Đã mở feed nhà Instagram' };
  }

  // 2. open_post_from_url — nguồn: automator/interaction mở bài đích
  // theo URL (điều hướng thẳng + chờ bề mặt bài: dialog/article/ô comment).
  async function hOpenPostFromUrl(ctx) {
    const url = targetUrl();
    if (!url) return F.err('missing_target_url', 'Thiếu target_url trong payload — không biết mở bài nào', { error: 'missing_target_url' });
    const code = postCodeOf(url);
    const onTarget = code ? location.pathname.includes('/' + code) : location.href === url;
    if (!onTarget) {
      await ctx.setData({ targetUrl: url });
      const r = await navStep('open_post_from_url', async () => { location.assign(url); }, ctx);
      if (r === 'gone') return { nav: true };
    }
    const surface = await waitFor(() => document.querySelector('div[role="dialog"]') || firstArticle() || findMainCommentBox(), 12000);
    if (!surface) return F.sel('post_surface', { url });
    return { details: { opened: true, url: location.href, code: code || null }, message: 'Đã mở bài đích theo URL' };
  }

  // 3. open_reels_tab — nguồn: accounts-scanner openSection('reels'):
  // bấm mục Reels ở nav (svg aria-label "Reels").
  async function hOpenReelsTab(ctx) {
    if (/\/reels?\//.test(location.pathname)) {
      const v = await waitFor(() => document.querySelector('video'), 8000);
      return { details: { opened: true, url: location.href, has_video: !!v }, message: 'Đã ở tab Reels' };
    }
    const svg = document.querySelector('svg[aria-label="Reels"]');
    const link = svg ? (svg.closest('a, [role="link"], button, [role="button"]') || svg)
      : document.querySelector('a[href*="/reels/"], a[href="/reels"]');
    if (!link) return F.sel('reels_tab_link');
    const r = await navStep('open_reels_tab', async () => { await humanClick(link); }, ctx);
    if (r === 'gone') return { nav: true };
    return { details: { opened: true, url: location.href }, message: 'Đã mở tab Reels' };
  }

  // 4. open_profile_grid — nguồn: accounts-scanner readGridPosts (đọc
  // lưới bài trên hồ sơ hiện tại, đếm + lấy mẫu link).
  async function hOpenProfileGrid(ctx) {
    const links = await waitFor(() => { const l = gridLinks(); return l.length ? l : null; }, 12000);
    if (!links) return F.sel('profile_grid');
    try { links[0].scrollIntoView({ block: 'center' }); } catch (_) {}
    return {
      details: { opened: true, posts: links.length, sample: links.slice(0, 3).map(a => a.href) },
      message: `Đã mở lưới bài trên hồ sơ (${links.length} ô)`
    };
  }

  // 5. like_button_state — nguồn: interaction.js detectLikeState
  // (svg Unlike có mặt = liked, svg Like = chưa). CHỈ ĐỌC, không bấm.
  async function hLikeButtonState(ctx) {
    const state = await waitFor(() => {
      const s = postScope();
      if (s.querySelector?.(UNLIKE_SVG)) return 'liked';
      if (s.querySelector?.(LIKE_SVG)) return 'not_liked';
      return null;
    }, 10000);
    if (!state) return F.sel('like_button');
    return {
      details: { state, liked: state === 'liked', read_only: true },
      message: state === 'liked' ? 'Bài đang mở: đã thích (chỉ đọc)' : 'Bài đang mở: chưa thích (chỉ đọc)'
    };
  }

  // 6. open_comments — nguồn: interaction.js openCommentBox (bấm svg
  // Comment của bài; hộp bình luận hiện sẵn trên trang bài = đã mở).
  async function hOpenComments(ctx) {
    if (findMainCommentBox()) return { details: { opened: true, already: true }, message: 'Hộp bình luận đã hiển thị sẵn' };
    const btn = await waitFor(() => {
      const svg = postScope().querySelector?.(COMMENT_SVG);
      return svg ? (svg.closest('button, [role="button"]') || svg) : null;
    }, 10000);
    if (!btn) return F.sel('comment_button');
    await humanClick(btn);
    const box = await waitFor(() => findMainCommentBox() || document.querySelector('ul li span[dir="auto"]'), 6000);
    if (!box) return F.sel('comment_box', { clicked: true });
    return { details: { opened: true, clicked: true }, message: 'Đã mở hộp bình luận' };
  }

  // 7. focus_comment_input — nguồn: interaction readCommentInput
  // (findMainCommentBox + focus vào ô).
  async function hFocusCommentInput(ctx) {
    const box = await waitFor(() => findMainCommentBox(), 10000);
    if (!box) return F.sel('comment_input');
    try { box.scrollIntoView({ block: 'center' }); } catch (_) {}
    box.focus();
    try { box.click(); } catch (_) {}
    await sleep(300);
    const focused = document.activeElement === box || !!box.contains?.(document.activeElement);
    return { details: { focused }, message: focused ? 'Đã focus ô nhập bình luận' : 'Đã bấm vào ô bình luận (chưa xác minh được focus)' };
  }

  // 8. type_comment — nguồn: interaction typeComment (setText của
  // interaction.js). Nội dung: payload.content, thiếu thì text mẫu.
  async function hTypeComment(ctx) {
    const content = commentContent() || 'Bài viết rất hay!';
    const box = await waitFor(() => findMainCommentBox(), 10000);
    if (!box) return F.sel('comment_input');
    setTextEl(box, content);
    await sleep(500);
    const typed = editorText(box);
    if (!typed.includes(content.slice(0, Math.min(20, content.length)))) {
      return F.err('execution_error', 'Gõ xong nhưng ô bình luận không chứa nội dung vừa gõ', { content });
    }
    return { data: { commentText: content }, details: { typed: true, content }, message: 'Đã gõ nội dung vào ô bình luận' };
  }

  // 9. post_comment — nguồn: interaction clickPostButton
  // (submitEditor: Enter + nút Post/Đăng trong phạm vi ô).
  async function hPostComment(ctx) {
    const content = ctx.data.commentText || commentContent() || '';
    const box = await waitFor(() => findMainCommentBox(), 8000);
    if (!box) return F.sel('comment_input');
    await submitEditorEl(box);
    await sleep(1500);
    const remaining = editorText(box);
    const cleared = !content || !remaining.includes(content.slice(0, Math.min(20, content.length)));
    return {
      details: { posted: true, verified: cleared },
      message: cleared ? 'Đã bấm Post gửi bình luận (ô đã trống)' : 'Đã bấm Post gửi bình luận (chưa xác minh ô trống)'
    };
  }

  // 10. verify_comment — nguồn: interaction verifyCommentPresent:
  // đếm số nút khớp nội dung bình luận trong vùng bình luận
  // (gestureCount > 0 = đạt).
  async function hVerifyComment(ctx) {
    const content = ctx.data.commentText || commentContent();
    if (!content) return F.err('missing_content', 'Không có nội dung bình luận để kiểm chứng', { error: 'missing_content' });
    const frag = content.slice(0, 40);
    const count = await waitFor(() => {
      let n = 0;
      document.querySelectorAll('li span, li div, ul span, ul div, span[dir="auto"]').forEach(el => {
        if ((el.children?.length || 0) <= 2 && normText(el.textContent).includes(frag)) n++;
      });
      return n > 0 ? n : null;
    }, 8000);
    if (!count) return F.sel('posted_comment', { content });
    return { details: { found: true, count, content }, message: `Đã kiểm chứng: bình luận xuất hiện (${count} khớp)` };
  }

  // 11. like_post — nguồn: interaction.js runInteraction nhánh like
  // (findPostLike: Unlike có sẵn = đã like; bấm Like rồi xác minh lật).
  async function hLikePost(ctx) {
    if (postScope().querySelector?.(UNLIKE_SVG)) {
      return { details: { liked: true, already: true }, message: 'Bài đã được thích sẵn' };
    }
    const btn = await waitFor(() => {
      const svg = postScope().querySelector?.(LIKE_SVG);
      return svg ? (svg.closest('button, [role="button"]') || svg) : null;
    }, 10000);
    if (!btn) return F.sel('post_like_button');
    await humanClick(btn);
    const verified = await waitFor(() => postScope().querySelector?.(UNLIKE_SVG) ? true : null, 4000);
    return {
      details: { liked: true, verified: !!verified },
      message: verified ? 'Đã thả tim bài (đã xác minh nút lật Unlike)' : 'Đã bấm thả tim bài (chưa thấy xác minh)'
    };
  }

  // 12. follow_author — nguồn: interaction runInteraction nhánh follow
  // + adapter doFollow (nút text Follow/Theo dõi, proof = lật Following).
  async function hFollowAuthor(ctx) {
    if (isFollowing(postScope())) {
      return { details: { followed: true, already: true }, message: 'Đã theo dõi tác giả sẵn' };
    }
    const btn = await waitFor(() => findFollowButton(postScope()), 10000);
    if (!btn) return F.sel('follow_button');
    await humanClick(btn);
    const verified = await waitFor(() => isFollowing(postScope()) ? true : null, 4000);
    return {
      details: { followed: true, verified: !!verified },
      message: verified ? 'Đã Follow tác giả (đã xác minh nút lật Following)' : 'Đã bấm Follow tác giả (chưa thấy xác minh)'
    };
  }

  // 13. save_post — nguồn: interaction runInteraction nhánh save +
  // adapter doSave (svg Save/Lưu, proof = lật Remove/Đã lưu).
  async function hSavePost(ctx) {
    if (postScope().querySelector?.(UNSAVE_SVG)) {
      return { details: { saved: true, already: true }, message: 'Bài đã được lưu sẵn' };
    }
    const btn = await waitFor(() => {
      const svg = postScope().querySelector?.(SAVE_SVG);
      return svg ? (svg.closest('button, [role="button"]') || svg) : null;
    }, 10000);
    if (!btn) return F.sel('save_button');
    await humanClick(btn);
    const verified = await waitFor(() => postScope().querySelector?.(UNSAVE_SVG) ? true : null, 4000);
    return {
      details: { saved: true, verified: !!verified },
      message: verified ? 'Đã lưu bài (đã xác minh nút lật)' : 'Đã bấm Lưu bài (chưa thấy xác minh)'
    };
  }

  // 14. follow_from_search — nguồn: instagram-nurture/adapter.js
  // followFromSearch: mở tìm kiếm -> gõ tên -> mở hồ sơ kết quả ->
  // Follow tại header hồ sơ. Hai giai đoạn nối bằng ctx.data.searchStage
  // để sống qua điều hướng SPA/full-load.
  async function hFollowFromSearch(ctx) {
    const query = searchQuery();
    if (!query) return F.err('missing_query', 'Thiếu payload.query — không biết tìm user nào', { error: 'missing_query' });
    if (ctx.data.searchStage === 'profile') {
      const user = ctx.data.searchedUser || query.replace(/^@/, '');
      if (isFollowing(document)) {
        return { details: { followed: true, already: true, user }, message: `Đã theo dõi @${user} sẵn` };
      }
      const btn = await waitFor(() => findFollowButton(document.querySelector('main') || document), 10000);
      if (!btn) return F.sel('follow_button', { user });
      await humanClick(btn);
      const verified = await waitFor(() => isFollowing(document) ? true : null, 4000);
      return {
        details: { followed: true, verified: !!verified, user },
        message: verified ? `Đã Follow @${user} từ tìm kiếm (đã xác minh)` : `Đã bấm Follow @${user} từ tìm kiếm (chưa thấy xác minh)`
      };
    }
    const inputSel = 'input[placeholder*="Search" i], input[placeholder*="Tìm kiếm" i], input[aria-label*="Search" i], input[aria-label*="Tìm kiếm" i]';
    if (!document.querySelector(inputSel)) {
      const svg = document.querySelector('svg[aria-label="Search"], svg[aria-label="Tìm kiếm"]');
      const btn = svg ? (svg.closest('a, button, [role="button"]') || svg) : null;
      if (!btn) return F.sel('search_button');
      await humanClick(btn);
    }
    const input = await waitFor(() => document.querySelector(inputSel), 10000);
    if (!input) return F.sel('search_input');
    setTextEl(input, query);
    await sleep(1200);
    const q = query.replace(/^@/, '').toLowerCase();
    const result = await waitFor(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/"]')).filter(visible);
      const segOf = a => /^\/([A-Za-z0-9._]+)\/?$/.exec(a.getAttribute('href') || '')?.[1] || '';
      const exact = links.find(a => segOf(a).toLowerCase() === q);
      if (exact) return exact;
      return links.find(a => {
        const seg = segOf(a);
        if (!seg || RESERVED_SEGMENTS.has(seg.toLowerCase())) return false;
        // Kết quả tìm kiếm: link hồ sơ trong panel kết quả, thường bọc avatar.
        return !!a.closest('[role="dialog"], [role="listbox"], [role="list"]') || !!a.querySelector('img');
      }) || null;
    }, 10000);
    if (!result) return F.sel('search_result', { query });
    const user = (/^\/([A-Za-z0-9._]+)\/?$/.exec(result.getAttribute('href') || '') || [])[1] || query.replace(/^@/, '');
    await ctx.setData({ searchStage: 'profile', searchedUser: user });
    const r = await navStep('follow_from_search', async () => { await humanClick(result); }, ctx);
    if (r === 'gone') return { nav: true };
    return await hFollowFromSearch(ctx); // đã tới hồ sơ trong cùng document -> làm nốt giai đoạn Follow
  }

  // 20. scroll_reels — nguồn: adapter nurture scrollReels (vào bề mặt
  // Reels, phát video + cuộn qua từng reel theo chiều cao khung hình).
  async function hScrollReels(ctx) {
    if (!/\/reels?\//.test(location.pathname)) {
      const r = await navStep('scroll_reels', async () => { location.assign('https://www.instagram.com/reels/'); }, ctx);
      if (r === 'gone') return { nav: true };
    }
    const firstVideo = await waitFor(() => document.querySelector('video'), 12000);
    if (!firstVideo) return F.sel('reel_video');
    const count = Math.min(10, Math.max(1, Number(payload.count || payload.reels || 3) || 3));
    const seenSrc = new Set();
    let viewed = 0;
    for (let i = 0; i < count; i++) {
      const v = document.querySelector('video');
      if (v) {
        seenSrc.add(v.currentSrc || v.src || `reel_${i}`);
        try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
      }
      viewed++;
      if (i < count - 1) {
        await sleep(rand(1800, 3200));
        await humanScrollBy(window.innerHeight);
        await sleep(1200);
      }
    }
    return {
      details: { viewed, distinct_sources: seenSrc.size, url: location.href },
      message: `Đã xem/lướt ${viewed} reel`
    };
  }

  // 21. open_story_ring — nguồn: adapter openFirstStory (bấm vòng story
  // đầu tiên ở khay để mở trình xem).
  async function hOpenStoryRing(ctx) {
    if (location.pathname.startsWith('/stories/')) {
      const m = /^\/stories\/([A-Za-z0-9._]+)\//.exec(location.pathname);
      return { details: { opened: true, already: true, user: m ? m[1] : (ctx.data.storyUser || null) }, message: 'Trình xem story đang mở sẵn' };
    }
    const link = await waitFor(() => Array.from(document.querySelectorAll('a[href^="/stories/"]')).filter(visible)[0] || null, 12000);
    if (!link) return F.sel('story_ring');
    const user = (/^\/stories\/([A-Za-z0-9._]+)\//.exec(link.getAttribute('href') || '') || [])[1] || null;
    await ctx.setData({ storyUser: user });
    const r = await navStep('open_story_ring', async () => { await humanClick(link); }, ctx);
    if (r === 'gone') return { nav: true };
    return { details: { opened: true, user }, message: `Đã mở story của @${user || '?'}` };
  }

  // 22. story_advance — nguồn: adapter story advance (nút Next hoặc
  // bấm vùng phải của trình xem / phím ArrowRight).
  async function hStoryAdvance(ctx) {
    if (!location.pathname.startsWith('/stories/')) return F.sel('story_viewer');
    const before = location.href;
    const nextSvg = document.querySelector('svg[aria-label="Next"], svg[aria-label="Tiếp"]');
    const nextBtn = nextSvg ? (nextSvg.closest('button, [role="button"]') || nextSvg) : null;
    if (nextBtn) await humanClick(nextBtn);
    else {
      const el = document.elementFromPoint(Math.floor(window.innerWidth * 0.85), Math.floor(window.innerHeight / 2));
      if (el) await humanClick(el);
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
    }
    const changed = await waitFor(() => location.href !== before ? true : null, 4000);
    return {
      details: { advanced: true, verified: !!changed, from: before, to: location.href },
      message: changed ? 'Đã chuyển sang story kế tiếp' : 'Đã bấm chuyển story (chưa xác minh đổi đoạn)'
    };
  }

  // 23. story_exit — nguồn: adapter story exit (nút đóng / phím Escape).
  async function hStoryExit(ctx) {
    if (!location.pathname.startsWith('/stories/')) {
      return { details: { exited: true, already: true }, message: 'Không ở trong trình xem story (đã thoát sẵn)' };
    }
    const closeSvg = document.querySelector('svg[aria-label="Close"], svg[aria-label="Đóng"]');
    const closeBtn = closeSvg ? (closeSvg.closest('button, [role="button"]') || closeSvg) : null;
    if (closeBtn) await humanClick(closeBtn);
    pressEscape();
    const out = await waitFor(() => !location.pathname.startsWith('/stories/') ? true : null, 5000);
    if (!out) return F.err('execution_error', 'Đã bấm đóng/Escape nhưng vẫn ở trong trình xem story', { still: location.href });
    return { details: { exited: true }, message: 'Đã thoát trình xem story' };
  }

  // 24. open_explore — nguồn: adapter openExploreGrid (mở /explore +
  // chờ lưới bài dựng).
  async function hOpenExplore(ctx) {
    if (!location.pathname.startsWith('/explore')) {
      const r = await navStep('open_explore', async () => { location.assign('https://www.instagram.com/explore/'); }, ctx);
      if (r === 'gone') return { nav: true };
    }
    const links = await waitFor(() => { const l = gridLinks(); return l.length ? l : null; }, 12000);
    if (!links) return F.sel('explore_grid');
    return { details: { opened: true, posts: links.length, url: location.href }, message: `Đã mở Explore (${links.length} ô)` };
  }

  // 25. open_first_explore_post — nguồn: adapter openExplorePost (bấm
  // ô đầu tiên của lưới Explore, chờ dialog/trang bài mở).
  async function hOpenFirstExplorePost(ctx) {
    if (/\/(p|reel)\//.test(location.pathname) || document.querySelector('div[role="dialog"] article, div[role="dialog"] video')) {
      return { details: { opened: true, already: true, url: location.href }, message: 'Bài Explore đã mở sẵn' };
    }
    const link = await waitFor(() => { const l = gridLinks(); return l.length ? l[0] : null; }, 10000);
    if (!link) return F.sel('explore_first_post');
    const url = link.href;
    await ctx.setData({ explorePostUrl: url });
    const r = await navStep('open_first_explore_post', async () => { await humanClick(link); }, ctx);
    if (r === 'gone') return { nav: true };
    return { details: { opened: true, url }, message: 'Đã mở bài đầu tiên trong Explore' };
  }

  // 26. open_own_profile — nguồn: adapter openOwnProfile /
  // accounts-scanner (link hồ sơ của chính nick ở nav).
  async function hOpenOwnProfile(ctx) {
    const found = findOwnProfileLink();
    const seg = profileSegment();
    if (found && seg && seg.toLowerCase() === found.username.toLowerCase()) {
      return { details: { opened: true, already: true, username: found.username }, message: `Đang ở hồ sơ của mình @${found.username}` };
    }
    if (!found) {
      if (seg) return { details: { opened: true, username: seg, via: 'current_page' }, message: `Đang ở trang hồ sơ @${seg}` };
      return F.sel('own_profile_link');
    }
    await ctx.setData({ ownUsername: found.username });
    const r = await navStep('open_own_profile', async () => { await humanClick(found.el); }, ctx);
    if (r === 'gone') return { nav: true };
    return { details: { opened: true, username: found.username }, message: `Đã mở hồ sơ của mình @${found.username}` };
  }

  // 27. verify_own_username — nguồn: adapter verifyProfileUsername
  // (username hiển thị trên header hồ sơ đối chiếu nick kỳ vọng:
  // payload.username -> run.social_username/social_uid -> link nav).
  async function hVerifyOwnUsername(ctx) {
    const candidates = Array.from(document.querySelectorAll('main h2, main header span, header h2'))
      .map(el => normText(el.textContent)).filter(t => /^[A-Za-z0-9._]{1,30}$/.test(t));
    const displayed = candidates[0] || profileSegment() || ctx.data.ownUsername || '';
    if (!displayed) return F.sel('profile_username');
    const expected = String(payload.username || payload.expected_username || run.social_username || run.social_uid || ctx.data.ownUsername || '').replace(/^@/, '');
    if (!expected) {
      return { details: { username: displayed, matches: null }, message: `Username hiển thị: @${displayed} (không có nick kỳ vọng để đối chiếu)` };
    }
    if (displayed.toLowerCase() !== expected.toLowerCase()) {
      return F.err('account_mismatch', `Username hiển thị @${displayed} không khớp nick kỳ vọng @${expected}`, { username: displayed, expected, matches: false });
    }
    return { details: { username: displayed, expected, matches: true }, message: `Username hiển thị khớp nick: @${displayed}` };
  }

  // 28. scan_highlight_reel — nguồn: accounts-scanner kiểu quét reel
  // (thu thập số liệu của ĐÚNG 1 mục tiêu reel: URL, tác giả, lượt xem).
  async function hScanHighlightReel(ctx) {
    let link = document.querySelector('a[href*="/reel/"]');
    if (!link && !/\/reels?\//.test(location.pathname)) {
      const r = await navStep('scan_highlight_reel', async () => { location.assign('https://www.instagram.com/reels/'); }, ctx);
      if (r === 'gone') return { nav: true };
      link = document.querySelector('a[href*="/reel/"]');
    }
    const target = await waitFor(() => document.querySelector('video') || document.querySelector('a[href*="/reel/"]'), 10000);
    if (!target) return F.sel('reel_target');
    const reelUrl = (document.querySelector('a[href*="/reel/"]') || link)?.href || location.href;
    const bodyText = normText(document.body?.innerText || '');
    const viewsM = /([\d.,]+\s*[kKmM]?)\s*(views|plays|view|lượt xem)/i.exec(bodyText);
    const authorA = Array.from(document.querySelectorAll('a[href^="/"]'))
      .find(a => { const s = (/^\/([A-Za-z0-9._]+)\/?$/.exec(a.getAttribute('href') || '') || [])[1]; return s && !RESERVED_SEGMENTS.has(s.toLowerCase()); });
    return {
      details: {
        scanned: true, kind: 'reel', url: reelUrl,
        has_video: !!document.querySelector('video'),
        views: viewsM ? parseMetric(viewsM[1]) : null,
        views_raw: viewsM ? viewsM[1].trim() : null,
        author: authorA ? authorA.getAttribute('href').replace(/\//g, '') : null
      },
      message: 'Đã quét số liệu 1 mục tiêu reel'
    };
  }

  // 29. scan_profile_media — nguồn: accounts-scanner readGridPosts
  // (quét truyền thông hồ sơ: lưới tối đa 12 ô đầu).
  async function hScanProfileMedia(ctx) {
    if (!profileSegment()) {
      const own = findOwnProfileLink();
      if (!own) return F.sel('own_profile_link');
      await ctx.setData({ ownUsername: own.username });
      const r = await navStep('scan_profile_media', async () => { await humanClick(own.el); }, ctx);
      if (r === 'gone') return { nav: true };
    }
    const links = await waitFor(() => { const l = gridLinks(); return l.length ? l : null; }, 12000);
    if (!links) return F.sel('profile_grid');
    const items = links.slice(0, 12).map(a => ({ url: a.href, kind: a.href.includes('/reel') ? 'reel' : 'post' }));
    return {
      details: { scanned: true, username: profileSegment(), count: items.length, total_found: links.length, items },
      message: `Đã quét truyền thông hồ sơ: ${items.length} mục (tổng thấy ${links.length})`
    };
  }

  // 30. scan_reels_metrics — nguồn: accounts-scanner reels scan (mở
  // tab Reels của hồ sơ, đọc lượt phát từng reel trong lưới).
  async function hScanReelsMetrics(ctx) {
    const user = profileSegment() || findOwnProfileLink()?.username || ctx.data.ownUsername || '';
    if (!user) return F.sel('own_username');
    if (!/^\/[^/]+\/reels\/?$/.test(location.pathname)) {
      const url = `https://www.instagram.com/${user}/reels/`;
      const r = await navStep('scan_reels_metrics', async () => { location.assign(url); }, ctx);
      if (r === 'gone') return { nav: true };
    }
    const links = await waitFor(() => {
      const l = Array.from(document.querySelectorAll('a[href*="/reel/"]')).filter(a => a.href);
      return l.length ? l : null;
    }, 12000);
    if (!links) return F.sel('reels_grid', { user });
    const seen = new Map();
    links.forEach(a => {
      if (seen.has(a.href)) return;
      const t = normText(a.innerText || a.textContent || '');
      const vm = /([\d.,]+\s*[kKmM]?)/.exec(t);
      seen.set(a.href, { url: a.href, views: vm ? parseMetric(vm[1]) : null, views_raw: vm ? vm[1].trim() : null });
    });
    const items = [...seen.values()].slice(0, 30);
    return {
      details: { scanned: true, username: user, count: items.length, items },
      message: `Đã quét số liệu ${items.length} reel của @${user}`
    };
  }

  // 31. extract_post_caption — nguồn: automator/affiliate extractCaption
  // (đọc caption của bài đang mở, trả vào details).
  async function hExtractPostCaption(ctx) {
    const caption = await waitFor(() => { const c = extractCaptionText(); return c ? c : null; }, 8000);
    if (!caption) return F.sel('post_caption');
    return {
      details: { caption: caption.slice(0, 500), length: caption.length },
      message: 'Đã trích xuất caption của bài đang mở'
    };
  }

  // 32. like_comment — nguồn: affiliate-commenter runCommentBatch
  // nhánh like + interaction.js like_comments: thả tim bình luận đầu
  // tiên tìm được (nút Like riêng trong hàng <li> của bình luận);
  // không thấy bình luận/nút -> failed selector_not_found thật.
  async function hLikeComment(ctx) {
    const findRow = () => {
      const items = Array.from(document.querySelectorAll('li')).filter(visible);
      for (const li of items) {
        if (li.querySelector(UNLIKE_SVG)) return { already: true, li };
        const svg = li.querySelector(LIKE_SVG);
        if (svg) return { btn: svg.closest('button, [role="button"]') || svg, li };
        const b = Array.from(li.querySelectorAll('button, [role="button"]')).find(x => /^(like|thích)$/i.test(labelOf(x)));
        if (b) return { btn: b, li };
      }
      return null;
    };
    const found = await waitFor(findRow, 10000);
    if (!found) return F.sel('comment_like_button');
    if (found.already) return { details: { liked: true, already: true }, message: 'Bình luận đầu tiên đã được thích sẵn' };
    await humanClick(found.btn);
    const verified = await waitFor(() => found.li.querySelector(UNLIKE_SVG) ? true : null, 4000);
    return {
      details: { liked: true, verified: !!verified, comment_text: normText(found.li.innerText || '').slice(0, 200) },
      message: verified ? 'Đã thả tim bình luận (đã xác minh)' : 'Đã bấm thả tim bình luận (chưa thấy xác minh)'
    };
  }

  // 33. comment_on_post — nguồn: affiliate-commenter.js runCommentBatch
  // (đọc caption -> gõ nội dung -> gửi -> xác minh). AI tắt trong micro
  // test: dùng thẳng payload.content, thiếu -> failed missing_content.
  async function hCommentOnPost(ctx) {
    const content = commentContent();
    if (!content) return F.err('missing_content', 'Thiếu payload.content — luồng affiliate cần nội dung bình luận', { error: 'missing_content' });
    const caption = extractCaptionText();
    const box = await waitFor(() => findMainCommentBox(), 10000);
    if (!box) return F.sel('comment_box');
    setTextEl(box, content);
    await sleep(600);
    await submitEditorEl(box);
    await sleep(2000);
    const frag = content.slice(0, 40);
    let present = 0;
    document.querySelectorAll('li span, li div, span[dir="auto"]').forEach(el => {
      if ((el.children?.length || 0) <= 2 && normText(el.textContent).includes(frag)) present++;
    });
    const stillThere = editorText(box).includes(content.slice(0, Math.min(20, content.length)));
    const verified = present > 0 || !stillThere;
    return {
      details: { commented: true, verified, present_count: present, content, caption: caption ? caption.slice(0, 200) : null },
      message: verified ? 'Đã bình luận bằng luồng affiliate (đã xác minh)' : 'Đã gửi bình luận affiliate (chưa xác minh được)'
    };
  }

  // ── Bảng handler + prefix (đúng danh sách 33 của brief 2.11.17) ──
  const STEP = {
    open_home_feed: hOpenHomeFeed,
    open_post_from_url: hOpenPostFromUrl,
    open_reels_tab: hOpenReelsTab,
    open_profile_grid: hOpenProfileGrid,
    like_button_state: hLikeButtonState,
    open_comments: hOpenComments,
    focus_comment_input: hFocusCommentInput,
    type_comment: hTypeComment,
    post_comment: hPostComment,
    verify_comment: hVerifyComment,
    like_post: hLikePost,
    follow_author: hFollowAuthor,
    save_post: hSavePost,
    follow_from_search: hFollowFromSearch,
    scroll_reels: hScrollReels,
    open_story_ring: hOpenStoryRing,
    story_advance: hStoryAdvance,
    story_exit: hStoryExit,
    open_explore: hOpenExplore,
    open_first_explore_post: hOpenFirstExplorePost,
    open_own_profile: hOpenOwnProfile,
    verify_own_username: hVerifyOwnUsername,
    scan_highlight_reel: hScanHighlightReel,
    scan_profile_media: hScanProfileMedia,
    scan_reels_metrics: hScanReelsMetrics,
    extract_post_caption: hExtractPostCaption,
    like_comment: hLikeComment,
    comment_on_post: hCommentOnPost
  };
  const PREFIXES = {
    open_comments: ['open_post_from_url'],
    focus_comment_input: ['open_post_from_url', 'open_comments'],
    type_comment: ['open_post_from_url', 'open_comments', 'focus_comment_input'],
    post_comment: ['open_post_from_url', 'open_comments', 'focus_comment_input', 'type_comment'],
    verify_comment: ['open_post_from_url', 'open_comments', 'focus_comment_input', 'type_comment', 'post_comment'],
    like_post: ['open_post_from_url'],
    follow_author: ['open_post_from_url'],
    save_post: ['open_post_from_url'],
    story_advance: ['open_story_ring'],
    story_exit: ['open_story_ring'],
    open_first_explore_post: ['open_explore'],
    verify_own_username: ['open_own_profile'],
    extract_post_caption: ['open_post_from_url'],
    like_comment: ['open_post_from_url', 'open_comments'],
    comment_on_post: ['open_post_from_url']
  };

  // ── Chain runner: chạy/bắt đầu một chuỗi, hoặc chạy tiếp từ phase ──
  async function runChain(phase) {
    const chain = phase.chain;
    let data = (phase.data && typeof phase.data === 'object') ? phase.data : {};
    const ctx = {
      get data() { return data; },
      setData: async patch => { data = { ...data, ...patch }; await setPhase({ data }); }
    };
    // Lượt inject lại sau điều hướng: bước pendingVerify phải đã tới đích.
    if (phase.pendingVerify) {
      const key = phase.pendingVerify;
      const arriveFn = ARRIVE[key];
      const arrived = arriveFn
        ? await waitFor(() => { try { return arriveFn(ctx) ? true : null; } catch (_) { return null; } }, 10000)
        : true;
      if (!arrived) {
        const idxOf = chain.indexOf(key);
        if (idxOf >= 0 && idxOf < chain.length - 1) {
          return report('failed', { action, failed_step: key, stage: 'verify', found: false }, 'prefix_failed',
            `Bước tiền tố ${key} không tới được đích sau điều hướng`);
        }
        return report('failed', { action, failed_step: key, stage: 'verify', found: false, target: key }, 'selector_not_found',
          `Không tới được đích của ${key} sau điều hướng`);
      }
      await setPhase({ pendingVerify: null });
    }
    let idx = Number.isInteger(phase.idx) ? phase.idx : 0;
    while (idx < chain.length) {
      const key = chain[idx];
      const isFinal = idx === chain.length - 1;
      const handler = STEP[key];
      if (!handler) {
        return report('failed', { action, failed_step: key }, 'execution_error', `Chưa có handler cho bước: ${key}`);
      }
      let res = null;
      try { res = await handler(ctx); }
      catch (err) { res = { fail: { code: 'execution_error', message: String(err?.message || err) } }; }
      if (res && res.nav) return; // chờ inject lại; pendingVerify đã nằm trong phase
      if (res && res.fail) {
        if (!isFinal) {
          return report('failed', { action, failed_step: key, ...(res.fail.details || {}) }, 'prefix_failed',
            res.fail.message || `Bước tiền tố ${key} thất bại`);
        }
        return report('failed', { action, ...(res.fail.details || {}) }, res.fail.code || 'execution_error',
          res.fail.message || `Hành động ${key} thất bại`);
      }
      if (res && res.data) await ctx.setData(res.data);
      idx++;
      await setPhase({ idx, pendingVerify: null });
      if (isFinal) {
        const details = { ...(res?.details || {}) };
        if (chain.length > 1) details.steps = chain;
        return done(details, res?.message);
      }
    }
    return report('failed', { action, error: 'chain_state_lost' }, 'execution_error', 'Mất trạng thái chuỗi hành động giữa chừng');
  }

  // ── Chạy tiếp sau điều hướng cho 5 key cũ (phase không có chain) ──
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
    if (phase && Array.isArray(phase.chain)) return await runChain(phase);
    if (phase) return await resume(phase);
    if (STEP[action]) {
      const chain = [...(PREFIXES[action] || []), action];
      await setPhase({ chain, idx: 0, data: {} });
      return await runChain(await getPhase());
    }
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
