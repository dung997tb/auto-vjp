// Auto vjp — TikTok micro actions (task type 'micro_action', 2.11.17).
// Hành động nhỏ test LẺ. 2.11.16 có 5 key: scroll_feed, watch_first,
// like_first, open_notifications, open_profile (GIỮ NGUYÊN key + hành vi).
// 2.11.17 bổ sung 72 key: 36 hành động nền tảng (composer Studio / trình
// phát / Studio trả lời bình luận / comment-replier thường) + 36 step
// Farmer tf_* chạy lẻ 1 step qua engine TF thật (modules/tiktok-nurture).
// Task: {platform:'tiktok', type:'micro_action', payload:{action, ...}}.
// Báo kết quả bằng action 'microActionDone' (results.js deliver type
// 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found';
// tiền tố (prefix) fail -> failed 'prefix_failed' + details.failed_step;
// đọc/thu thập -> dữ liệu thật vào details; KHÔNG bịa success.
// Phase storage (avjpMicroPhase_tiktok) lo chạy tiếp sau điều hướng:
// - phase.chain: chuỗi [..prefix, action] của hành động nền tảng;
// - phase.tf: phiên chạy lẻ 1 step Farmer (đối soát journal tf_runstate_v1);
// - phase thường (không chain/tf): lượt tiếp của 5 key cũ.
// Click mới ưu tiên AVJP.human.clickEl theo luật Farmer: human có mặt mà
// trả false thì KHÔNG bấm lại (tránh bấm trùng thành unlike/bỏ lưu);
// human vắng mặt mới rơi về click DOM thường. 5 key cũ giữ humanClick cũ.
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
  // Payload dùng chung cho 72 key mới (đọc 1 chỗ, handler chỉ lấy ra dùng).
  const pContent = String(payload.content ?? payload.text ?? '').trim();
  const pQuery = String(payload.query ?? payload.keyword ?? '').trim();
  const pTargetUrl = String(payload.target_url ?? payload.targetUrl ?? payload.url ?? '').trim();
  const pMediaUrl = String(payload.media_url ?? payload.media ?? payload.file_url ??
    (Array.isArray(payload.media_urls) ? payload.media_urls[0] : '') ?? '').trim();

  // ── PAGE-SIDE CANCEL (2.11.18, Lane P) ──
  // Kernel ghi cờ huỷ vào chrome.storage.local['autovjp.cancelFlags']
  // = { <taskId>: <timestamp> } khi user bấm Dừng. Script phía trang tự
  // thấy cờ thì NGỪNG ngay: báo failed/'user_cancelled' qua report() sẵn
  // có của file (kernel có thể đã chốt receipt trước - kết quả đến muộn
  // bị kernel bỏ qua, vô hại) rồi unwind bằng ngoại lệ để không bấm/cuộn
  // thêm nữa. Định danh task dùng ở đây: taskId = String(run.task_id ||
  // run.id) - cùng khoá mà phase storage (PHASE_KEY) của file gắn vào.
  async function avjpCancelRequested() {
    try {
      const s = await chrome.storage.local.get('autovjp.cancelFlags');
      const m = s && s['autovjp.cancelFlags'];
      return !!(m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, taskId));
    } catch (_) { return false; }
  }
  async function avjpSleepCancellable(ms) {
    const end = Date.now() + Math.max(0, Number(ms) || 0);
    for (;;) {
      const rem = end - Date.now();
      if (rem <= 0) return true;
      await sleep(Math.min(800, rem));
      if (await avjpCancelRequested()) return false;
      if (Date.now() >= end) return true;
    }
  }
  function avjpCancelledError() {
    const e = new Error('user_cancelled');
    e.avjpCancelled = true;
    e.failure_code = 'user_cancelled';
    e.failureCode = 'user_cancelled';
    return e;
  }
  function avjpAbortCancelled(extra = {}) {
    try {
      report('failed', { action, cancelled: true, ...extra }, 'user_cancelled',
        'Đã dừng theo yêu cầu người dùng (user_cancelled)');
    } catch (_) {}
    throw avjpCancelledError();
  }

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
  const failExec = (details, msg) => report('failed', { action, ...details }, 'execution_error', msg);

  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  async function waitFor(fn, timeoutMs = 15000, stepMs = 300) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (_) {}
      if (v) return v;
      if (Date.now() >= end) return null;
      if (!(await avjpSleepCancellable(stepMs))) avjpAbortCancelled({ phase: 'waitFor' });
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
  // Hành vi CŨ (5 key 2.11.16): human trả false -> rơi về click thường.
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
  // Luật MỚI (72 key 2.11.17, khớp tfHumanClick của Farmer): AVJP.human
  // có mặt -> dùng đúng kết quả của nó (nó tự fallback el.click() bên
  // trong khi SW không làm được); trả false là KHÔNG bấm lại. Chỉ khi
  // human VẮNG mặt mới dùng click DOM thường.
  async function humanClickStrict(el) {
    if (!el) return false;
    const human = globalThis.AVJP?.human;
    if (human && typeof human.clickEl === 'function') {
      try { return Boolean(await human.clickEl(el)); } catch (_) { return false; }
    }
    return plainClick(el);
  }
  // TF (tiktok-nurture selectors.js, nạp qua contract nhánh micro tiktok):
  // TF.q/TF.qa là finder THẬT của Farmer — ưu tiên dùng cho 72 key mới.
  const TFQ = key => { try { return globalThis.TF?.q ? TF.q(key) : null; } catch (_) { return null; } };
  const TFQA = key => { try { return globalThis.TF?.qa ? TF.qa(key) : []; } catch (_) { return []; } };
  const tfqWait = (key, timeoutMs = 12000) => waitFor(() => TFQ(key), timeoutMs, 250);
  const findVisibleByText = (selector, re, scope) =>
    Array.from((scope || document).querySelectorAll(selector)).find(el => visible(el) && re.test(textOf(el))) || null;

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

  // ── 5 hành động CŨ (2.11.16) — giữ nguyên ──
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
      if (!(await avjpSleepCancellable(Math.min(rand(1600, 3200), Math.max(0, end - Date.now()))))) avjpAbortCancelled({ step: 'scroll_feed', ticks });
    }
    done({ seconds: secs, ticks });
  }

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
    if (!(await avjpSleepCancellable(secs * 1000))) avjpAbortCancelled({ step: 'watch_first' });
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

  // ── Chạy tiếp sau điều hướng cho 5 key cũ ──
  async function resumeLegacy(phase) {
    switch (action) {
      case 'scroll_feed':
        return done({ resumed: true }, 'Đã lướt feed (lượt chạy tiếp sau điều hướng)');
      case 'watch_first': {
        const v = await waitFor(firstVideo, 8000);
        if (v && await ensurePlaying(v, 5000)) {
          if (!(await avjpSleepCancellable(secondsOr(20) * 1000))) avjpAbortCancelled({ step: 'watch_first', resumed: true });
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

  // ══════════ PHẦN A — 36 HÀNH ĐỘNG NỀN TẢNG (2.11.17) ══════════
  // Kết quả handler: {ok:true, data} | {ok:false, failure_code, target,
  // message, details} | {nav:true} (đã lưu phase verify + đang điều hướng).
  const ok = (data = {}) => ({ ok: true, data });
  const bad = (failure_code, target, message, details = {}) => ({ ok: false, failure_code, target, message, details });
  const badSel = (target, details = {}) => bad('selector_not_found', target, `Không tìm thấy phần tử đích: ${target}`, details);
  const badExec = (message, details = {}) => bad('execution_error', null, message, details);

  const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video';
  const CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content';
  const STUDIO_COMMENTS_URL = 'https://www.tiktok.com/tiktokstudio/comment';
  const onUploadPage = () => location.pathname.startsWith('/tiktokstudio/upload');
  const onContentPage = () => location.pathname.startsWith('/tiktokstudio/content');
  const onStudioComments = () => location.pathname === '/tiktokstudio/comment';
  const onVideoPage = () => /\/(video|photo)\/\d+/.test(location.pathname);

  function saveChain(state) {
    return setPhase({ chain: state.chain, idx: state.idx, data: state.data, verify: state.verify || null });
  }
  async function navTo(state, step, url) {
    state.verify = step;
    await saveChain(state);
    location.assign(url);
    return { nav: true };
  }

  // ── Composer / đăng bài (luồng automator.js) ──
  const uploadReady = () => Boolean(TFQ('uploadFileInput') ||
    document.querySelector('[data-e2e="select_video_container"], [data-e2e="select_video_button"], [data-e2e="upload_status_container"], [data-e2e="caption_container"]'));

  async function hOpenUploadPage(state) {
    if (onUploadPage()) {
      const ready = await waitFor(() => uploadReady() ? true : null, 12000);
      if (!ready) return badSel('upload_page');
      return ok({ opened: true, already: true });
    }
    return navTo(state, 'open_upload_page', UPLOAD_URL);
  }
  async function vOpenUploadPage() {
    if (!onUploadPage()) return badExec('Chưa tới được trang tải lên TikTok Studio', { resumed: true });
    const ready = await waitFor(() => uploadReady() ? true : null, 12000);
    if (!ready) return badSel('upload_page', { resumed: true });
    return ok({ opened: true, resumed: true });
  }

  function fetchMediaFile(url) {
    // Đúng đường automator.js dùng: background 'fetchImage' tải media về
    // dạng dataUrl rồi mới gắn vào input file qua DataTransfer.
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'fetchImage', url }, res => {
          if (chrome.runtime.lastError || !res || !res.success || !res.dataUrl) return resolve(null);
          try {
            const arr = String(res.dataUrl).split(',');
            const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'video/mp4';
            const bstr = atob(arr[1]);
            const u8 = new Uint8Array(bstr.length);
            for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
            let filename = String(url).split('/').pop().split('?')[0] || 'video.mp4';
            if (!filename.includes('.')) filename = 'video.mp4';
            resolve(new File([u8], filename, { type: mime }));
          } catch (_) { resolve(null); }
        });
      } catch (_) { resolve(null); }
    });
  }

  async function hSetVideoFile() {
    if (!pMediaUrl) return badExec('Thiếu media trong payload (media_url/media/media_urls) để nạp file video', { missing: 'media_url' });
    const input = await tfqWait('uploadFileInput', 15000) ||
      await waitFor(() => document.querySelector('input[type="file"][accept*="video"], input[type="file"]'), 5000);
    if (!input) return badSel('upload_file_input');
    const file = await fetchMediaFile(pMediaUrl);
    if (!file) return bad('network_error', 'media_fetch', `Không tải được media: ${pMediaUrl}`, { media_url: pMediaUrl });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
      if (setter) setter.call(input, dt.files); else input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      return badExec(`Gắn file vào ô tải lên thất bại: ${e?.message || e}`);
    }
    const appeared = await waitFor(() => {
      const st = TFQ('uploadStatus');
      if (st && textOf(st)) return true;
      if (TFQ('uploadCaption')) return true;
      return (document.body.innerText || '').includes(file.name) ? true : null;
    }, 15000);
    return ok({ attached: true, filename: file.name, media_url: pMediaUrl, upload_ui_seen: Boolean(appeared) });
  }

  async function typeIntoEditor(editor, content) {
    // automator.js: TUYỆT ĐỐI không execCommand insertText trên caption
    // Studio (crash Draft.js) — nạp qua ClipboardEvent 'paste'. Đường phụ
    // (module dang_video_duyet): execCommand insertText + đọc lại kiểm chứng.
    try { editor.focus(); } catch (_) {}
    await sleep(300);
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', content);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) {}
    await sleep(500);
    if ((editor.textContent || '').includes(content.slice(0, 12))) return true;
    try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, content); } catch (_) {}
    await sleep(500);
    return (editor.textContent || '').includes(content.slice(0, 12));
  }

  async function hTypeCaption() {
    if (!pContent) return badExec('Thiếu payload.content để gõ caption', { missing: 'content' });
    const editor = await tfqWait('uploadCaption', 15000) ||
      await waitFor(() => document.querySelector('.public-DraftEditor-content, [contenteditable="true"]'), 8000);
    if (!editor) return badSel('caption_editor');
    const typed = await typeIntoEditor(editor, pContent);
    if (!typed) return badExec('Không nạp được caption vào ô soạn (đọc lại không khớp)', { caption_insert_failed: true });
    return ok({ typed: true, caption_preview: pContent.slice(0, 80) });
  }

  function findStudioToggle(labelRes, e2eHints) {
    for (const h of e2eHints) {
      const el = document.querySelector(`[role="switch"][data-e2e*="${h}"], input[type="checkbox"][data-e2e*="${h}"]`);
      if (el) return { control: el, label: h };
    }
    const label = Array.from(document.querySelectorAll('div, span, p, label'))
      .find(el => visible(el) && textOf(el).length > 0 && textOf(el).length < 60 && labelRes.some(re => re.test(textOf(el))));
    if (!label) return null;
    let row = label;
    for (let i = 0; i < 6 && row; i++) {
      const c = row.querySelector?.('input[type="checkbox"], [role="switch"]');
      if (c) return { control: c, label: textOf(label) };
      row = row.parentElement;
    }
    return null;
  }
  const toggleState = c => (c.tagName === 'INPUT' ? Boolean(c.checked) : c.getAttribute('aria-checked') === 'true');
  async function toggleStudioSetting(kind) {
    const CONF = {
      comments: { res: [/allow comments/i, /cho phép bình luận/i, /bình luận/i], hints: ['comment'], target: 'comment_toggle' },
      duet: { res: [/^duet$/i, /duet/i], hints: ['duet'], target: 'duet_toggle' },
      stitch: { res: [/^stitch$/i, /stitch/i, /ghép nối/i], hints: ['stitch'], target: 'stitch_toggle' }
    }[kind];
    const found = await waitFor(() => findStudioToggle(CONF.res, CONF.hints), 12000);
    if (!found) return badSel(CONF.target);
    const before = toggleState(found.control);
    await humanClickStrict(found.control);
    await sleep(700);
    const afterEl = findStudioToggle(CONF.res, CONF.hints);
    const after = afterEl ? toggleState(afterEl.control) : before;
    return ok({ setting: kind, label: found.label, before, after, toggled: before !== after });
  }

  function findPostButton() {
    const byTf = TFQ('uploadPostBtn');
    if (byTf && !byTf.disabled && byTf.getAttribute('aria-disabled') !== 'true') return byTf;
    // automator.js: quét button/[role=button]/div.btn, khớp text nguyên văn.
    const all = Array.from(document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"]')).reverse();
    return all.find(b => {
      if (!visible(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      const t = textOf(b).toLowerCase();
      return t === 'post' || t === 'đăng' || t === 'đăng bài' || t === 'post now';
    }) || null;
  }

  async function hClickPostVideo() {
    const btn = await waitFor(findPostButton, 30000, 500);
    if (!btn) return badSel('post_button');
    await humanClickStrict(btn);
    await sleep(1500);
    // automator.js: bảng xác nhận phụ (bản quyền/chưa kiểm tra xong) -> 'Post now'.
    const confirm = findVisibleByText('button, [role="button"]', /^(post now|đăng ngay|continue to post|tiếp tục đăng|vẫn đăng)$/i);
    let confirmed = false;
    if (confirm) { await humanClickStrict(confirm); confirmed = true; await sleep(800); }
    return ok({ clicked: true, confirm_clicked: confirmed });
  }

  async function hWaitUploadComplete() {
    // automator.js: chờ text xác nhận tải lên (tối đa ~90s).
    const doneHit = await waitFor(() => {
      const t = (document.body.innerText || '').toLowerCase();
      if (/uploaded\s*\(/.test(t) || t.includes('đã tải lên') || t.includes('upload successful') ||
          t.includes('tải lên thành công') || t.includes('tải lên hoàn tất')) return true;
      const st = TFQ('uploadStatus');
      if (st && /uploaded/i.test(textOf(st)) && TFQ('uploadCaption')) return true;
      return null;
    }, 90000, 1000);
    if (!doneHit) return bad('upload_timeout', 'upload_complete', 'Quá 90 giây chưa thấy xác nhận tải lên hoàn tất');
    return ok({ upload_done: true });
  }

  async function checkContentPage() {
    const items = document.querySelectorAll('[data-e2e="content-item"], [class*="DivContentItem"], [class*="content-item"]');
    const links = document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]');
    const probe = pContent ? (document.body.innerText || '').includes(pContent.slice(0, 30)) : null;
    if (probe === false && !items.length && !links.length) {
      return badExec('Đã tới trang nội dung nhưng không thấy video/caption vừa đăng', { probe_found: false, items: 0 });
    }
    return ok({ on_content_page: true, items: Math.max(items.length, links.length), probe_found: probe });
  }
  async function hVerifyContentPage(state) {
    if (onContentPage()) return checkContentPage();
    return navTo(state, 'verify_content_page', CONTENT_URL);
  }
  async function vVerifyContentPage() {
    if (!onContentPage()) return badExec('Chưa tới được trang nội dung TikTok Studio', { resumed: true });
    await sleep(1500);
    const r = await checkContentPage();
    return r.ok ? { ...r, data: { ...r.data, resumed: true } } : r;
  }

  // ── Trình phát / tương tác video (finder TF của Farmer: videoEl,
  // likeBtn, commentBtn, saveBtn, shareBtn, progressSlider, commentInput,
  // commentSubmit, commentItem — selectors.js) ──
  async function hOpenFirstVideo(state) {
    const existing = TFQ('videoEl') || firstVideo();
    if (existing && onVideoPage()) {
      const playing = await ensurePlaying(existing, 6000);
      return ok({ opened: true, mode: 'detail', playing });
    }
    const v = await waitFor(() => TFQ('videoEl') || firstVideo(), 15000);
    if (!v) return badSel('first_video');
    const item = v.closest('[data-e2e="recommend-list-item-container"], [data-e2e="feed-video"], article') || v;
    try { item.scrollIntoView({ block: 'center' }); } catch (_) {}
    await sleep(400);
    // Bấm mở chi tiết có thể điều hướng -> lưu verify TRƯỚC khi bấm.
    state.verify = 'open_first_video';
    await saveChain(state);
    const link = item.querySelector?.('a[href*="/video/"], a[href*="/photo/"]');
    await humanClickStrict(link || item);
    const inPage = await waitFor(() => {
      if (onVideoPage()) return true;
      const vv = TFQ('videoEl') || firstVideo();
      return vv && !vv.paused ? true : null;
    }, 3500);
    if (inPage) {
      state.verify = null;
      const vv = TFQ('videoEl') || firstVideo();
      const playing = vv ? await ensurePlaying(vv, 5000) : false;
      return ok({ opened: true, mode: onVideoPage() ? 'detail' : 'feed', playing });
    }
    const playing = await ensurePlaying(TFQ('videoEl') || firstVideo() || v, 5000);
    state.verify = null;
    return ok({ opened: true, mode: 'feed', playing });
  }
  async function vOpenFirstVideo() {
    const v = await waitFor(() => TFQ('videoEl') || firstVideo(), 10000);
    if (!v) return badSel('first_video', { resumed: true });
    const playing = await ensurePlaying(v, 6000);
    return ok({ opened: true, mode: onVideoPage() ? 'detail' : 'feed', playing, resumed: true });
  }

  const currentVideo = async () => (await tfqWait('videoEl', 8000)) || firstVideo();

  async function hPlayPauseVideo() {
    const v = await currentVideo();
    if (!v) return badSel('video_element');
    const wasPaused = v.paused;
    if (wasPaused) { try { await v.play(); } catch (_) {} }
    else { try { v.pause(); } catch (_) {} }
    await sleep(500);
    if (v.paused === wasPaused) {
      // Trình phát TikTok nuốt play/pause qua click lên chính video.
      await humanClickStrict(v);
      await sleep(500);
    }
    return ok({ was_paused: wasPaused, now_paused: v.paused, toggled: v.paused !== wasPaused });
  }

  async function hSeekVideo() {
    const v = await currentVideo();
    if (!v) return badSel('video_element');
    let ratio = Number(payload.seek_ratio ?? payload.seekRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) ratio = 0.5;
    const ready = await waitFor(() => (Number.isFinite(v.duration) && v.duration > 0) ? true : null, 8000);
    if (!ready) {
      const slider = TFQ('progressSlider');
      if (!slider) return badSel('progress_slider');
      return badExec('Video chưa có duration để tua theo tỉ lệ', { seek_ratio: ratio, slider_found: true });
    }
    const target = v.duration * ratio;
    try { v.currentTime = target; } catch (e) { return badExec(`Tua video thất bại: ${e?.message || e}`); }
    await sleep(600);
    const delta = Math.abs((v.currentTime || 0) - target);
    return ok({ seek_ratio: ratio, duration: Math.round(v.duration * 10) / 10, target_time: Math.round(target * 10) / 10, current_time: Math.round((v.currentTime || 0) * 10) / 10, verified: delta < 3 });
  }

  async function hToggleMute() {
    const v = await currentVideo();
    if (!v) return badSel('video_element');
    const before = Boolean(v.muted);
    const btn = document.querySelector('[data-e2e="mute-icon"], [data-e2e="volume-icon"], button[aria-label*="mute" i], button[aria-label*="tiếng" i], button[aria-label*="âm lượng" i]');
    if (btn) await humanClickStrict(btn); else v.muted = !before;
    await sleep(400);
    if (v.muted === before && !btn) v.muted = !before;
    return ok({ was_muted: before, now_muted: Boolean(v.muted), toggled: Boolean(v.muted) !== before, via_button: Boolean(btn) });
  }

  const commentPanelOpen = () => Boolean(TFQ('commentInput') || TFQA('commentItem').length ||
    document.querySelector('[data-e2e="comment-list"], [class*="DivCommentList"]'));

  async function hOpenCommentsPanel() {
    if (commentPanelOpen()) return ok({ opened: true, already: true });
    const btn = await tfqWait('commentBtn', 10000);
    if (!btn) return badSel('comment_button');
    await humanClickStrict(btn);
    const panel = await waitFor(() => commentPanelOpen() ? true : null, 6000);
    if (!panel) return badSel('comments_panel', { clicked: true });
    return ok({ opened: true });
  }

  async function hReadCommentCount() {
    const btn = await tfqWait('commentBtn', 10000);
    if (!btn) return badSel('comment_button');
    const raw = btn.getAttribute('aria-label') || textOf(btn) || '';
    const m = /([\d.,]+)\s*(k|m|nghìn|triệu)?/i.exec(raw.replace(/[^0-9.,kKmM]/g, ' ').trim()) || /([\d.,]+)/.exec(raw);
    let count = null;
    if (m) {
      count = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'k' || unit === 'nghìn') count = Math.round(count * 1000);
      if (unit === 'm' || unit === 'triệu') count = Math.round(count * 1000000);
      if (!Number.isFinite(count)) count = null;
    }
    return ok({ comment_count_text: raw, comment_count: count });
  }

  const countCommentText = content => TFQA('commentItem').filter(it => (it.innerText || it.textContent || '').includes(content)).length;

  async function typeCommentAndSubmit(content) {
    // Pipeline soạn thảo THẬT của module comment_duyet (Farmer): mở panel
    // kiên nhẫn, gõ qua execCommand insertText, chặn nút gửi disabled,
    // kiểm chứng comment của mình XUẤT HIỆN (số item chứa text tăng).
    let input = TFQ('commentInput');
    if (!input) {
      let lastClick = 0;
      for (let i = 0; i < 10 && !input; i++) {
        if (Date.now() - lastClick >= 3000) {
          const b = TFQ('commentBtn');
          if (b) { await humanClickStrict(b); lastClick = Date.now(); }
        }
        if (!(await avjpSleepCancellable(800))) avjpAbortCancelled({ step: 'post_comment_open_panel' });
        input = TFQ('commentInput');
      }
    }
    if (!input) return badSel('comment_input');
    try { input.focus(); } catch (_) {}
    let typed = false;
    if (input.getAttribute('contenteditable') === 'true' || input.isContentEditable) {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        typed = document.execCommand('insertText', false, content) && (input.textContent || '').includes(content);
      } catch (_) {}
      if (!typed) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', content);
          input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch (_) {}
        typed = (input.textContent || '').includes(content);
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, content); else input.value = content;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      typed = input.value === content;
    }
    if (!typed) return badExec('Không gõ được nội dung bình luận (đọc lại không khớp)');
    await sleep(700);
    let submit = TFQ('commentSubmit');
    if (!submit) return badSel('comment_submit_button');
    if (submit.disabled === true || submit.getAttribute('aria-disabled') === 'true') {
      try { input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content })); } catch (_) {}
      await sleep(800);
      submit = TFQ('commentSubmit') || submit;
      if (submit.disabled === true) return badExec('Nút gửi bình luận vẫn bị vô hiệu (editor chưa nhận chữ)', { comment_submit_disabled: true });
    }
    const before = countCommentText(content);
    await humanClickStrict(submit);
    let verified = false;
    for (let i = 0; i < 10 && !verified; i++) {
      if (!(await avjpSleepCancellable(1000))) avjpAbortCancelled({ step: 'post_comment_verify' });
      if (countCommentText(content) > before) verified = true;
    }
    if (!verified) return badExec('Đã bấm gửi nhưng không thấy bình luận xuất hiện (comment_unverified)', { comment_unverified: true });
    return ok({ posted: true, verified: true, comment_preview: content.slice(0, 80) });
  }

  async function hPostComment() {
    if (!pContent) return badExec('Thiếu payload.content để đăng bình luận', { missing: 'content' });
    return typeCommentAndSubmit(pContent);
  }

  async function hLikeVideoButton() {
    const btn = await tfqWait('likeBtn', 10000);
    if (!btn) return badSel('like_button');
    if (btn.getAttribute('aria-pressed') === 'true') return ok({ liked: true, already: true });
    await humanClickStrict(btn);
    const verified = await waitFor(() => TFQ('likeBtn')?.getAttribute('aria-pressed') === 'true' ? true : null, 3000);
    return ok({ liked: true, verified: Boolean(verified) });
  }

  async function hSaveVideoButton() {
    // Kiểm chứng của module save_video (Farmer): số lượt trong aria-label
    // "N added to Favorites" phải tăng đúng 1; không đọc được số -> fallback
    // aria-pressed; ngoài ra là save_unverified — báo FAILED rõ, không tô hồng.
    const btn = await tfqWait('saveBtn', 10000);
    if (!btn) return badSel('save_button');
    if (btn.getAttribute('aria-pressed') === 'true') return ok({ saved: true, already: true });
    const favCount = el => {
      const m = (el?.getAttribute('aria-label') || '').match(/([\d,]+)\s+added to Favorites/i);
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    };
    const before = favCount(btn);
    await humanClickStrict(btn);
    await sleep(1200);
    const btn2 = TFQ('saveBtn');
    const after = favCount(btn2);
    if (before != null && after != null) {
      if (after === before + 1) return ok({ saved: true, verified: true });
      if (after === before - 1) { await humanClickStrict(btn2); return ok({ saved: true, already: true, restored: true }); }
      return badExec('Đã bấm lưu nhưng không kiểm chứng được (save_unverified)', { saved: false, verified: false, unverified: true, save_unverified: true });
    }
    if (btn2 && btn2.getAttribute('aria-pressed') === 'true') return ok({ saved: true, verified: true });
    return badExec('Đã bấm lưu nhưng không kiểm chứng được (save_unverified)', { saved: false, verified: false, unverified: true, save_unverified: true });
  }

  async function hShareVideo() {
    const btn = await tfqWait('shareBtn', 10000);
    if (!btn) return badSel('share_button');
    await humanClickStrict(btn);
    const menu = await waitFor(() => document.querySelector('[data-e2e="share-dialog"], [role="dialog"] [data-e2e*="share"], [class*="ShareMenu"], [class*="share-menu"]') ||
      findVisibleByText('[role="dialog"] *, [role="menu"] *', /^(share|chia sẻ|gửi cho bạn bè|send to friends|sao chép liên kết|copy link)$/i) ? true : null, 5000);
    if (!menu) return badSel('share_menu', { clicked: true });
    return ok({ menu_opened: true });
  }

  // ── Studio trả lời bình luận (finder THẬT từ studio-comment-replier.js:
  // rows [data-tt="components_MessageCell_FlexRow_3"], filter
  // [data-tt="components_FilterButton_TUXText"], option
  // [data-tt="components_Select_TUXText"], editor #comment-input, nút gửi
  // [data-tt="components_CommentInputEditor_TUXButton"]) ──
  const ROW_SEL = '[data-tt="components_MessageCell_FlexRow_3"]';
  const studioRows = () => Array.from(document.querySelectorAll(ROW_SEL)).filter(visible);
  const filterButtons = () => Array.from(document.querySelectorAll('[data-tt="components_FilterButton_TUXText"]')).filter(visible);
  const selectOptions = () => Array.from(document.querySelectorAll('[data-tt="components_Select_TUXText"]')).filter(visible);
  const STATUS_RE = /^(tất cả bình luận|all comments|đã trả lời|replied|chưa trả lời|chưa phản hồi|not replied|unreplied|unanswered)$/i;
  const UNREPLIED_RE = /^(chưa trả lời|chưa phản hồi|not replied|unreplied|unanswered)$/i;
  const statusFilterBtn = () => filterButtons().find(el => STATUS_RE.test(textOf(el))) || null;
  const videoFilterBtn = () => filterButtons().find(el => !STATUS_RE.test(textOf(el)) &&
    !/^(newest|oldest|mới nhất|cũ nhất|sắp xếp|sort)/i.test(textOf(el))) || null;
  const sortBtn = () => filterButtons().find(el => /sort|sắp xếp|newest|oldest|mới nhất|cũ nhất/i.test(textOf(el))) ||
    findVisibleByText('button, [role="button"], div, span', /^(sắp xếp|sort|mới nhất|newest)/i) || null;

  async function hStudioOpenComments(state) {
    if (onStudioComments()) {
      const ready = await waitFor(() => (studioRows().length || filterButtons().length) ? true : null, 12000);
      if (!ready) return badSel('studio_comment_rows');
      return ok({ opened: true, already: true, rows: studioRows().length });
    }
    return navTo(state, 'studio_open_comments', STUDIO_COMMENTS_URL);
  }
  async function vStudioOpenComments() {
    if (!onStudioComments()) return badExec('Chưa tới được trang bình luận TikTok Studio', { resumed: true });
    const ready = await waitFor(() => (studioRows().length || filterButtons().length) ? true : null, 12000);
    if (!ready) return badSel('studio_comment_rows', { resumed: true });
    return ok({ opened: true, resumed: true, rows: studioRows().length });
  }

  async function hStudioReadRows() {
    const rows = await waitFor(() => studioRows().length ? studioRows() : null, 12000);
    if (!rows) return badSel('studio_comment_rows');
    return ok({ count: rows.length, sample: rows.slice(0, 3).map(r => textOf(r).slice(0, 160)) });
  }

  async function hStudioFilterUnreplied() {
    // Nguyên văn ensureTikTokUnrepliedFilter của studio-comment-replier.js.
    const trigger = await waitFor(statusFilterBtn, 12000);
    if (!trigger) return badSel('studio_status_filter');
    if (UNREPLIED_RE.test(textOf(trigger))) return ok({ filtered: true, already: true, filter: textOf(trigger) });
    await humanClickStrict(trigger);
    const option = await waitFor(() => selectOptions().find(el => UNREPLIED_RE.test(textOf(el))) || null, 8000);
    if (!option) return badSel('studio_unreplied_option');
    await humanClickStrict(option);
    const confirmed = await waitFor(() => { const t = statusFilterBtn(); return t && UNREPLIED_RE.test(textOf(t)) ? true : null; }, 6000);
    if (!confirmed) return badExec('Đã chọn bộ lọc Chưa trả lời nhưng Studio chưa xác nhận', { filter_not_confirmed: true });
    return ok({ filtered: true, filter: 'unreplied', rows: studioRows().length });
  }

  async function hStudioOpenVideoFilterList() {
    const btn = await waitFor(videoFilterBtn, 12000);
    if (!btn) return badSel('studio_video_filter');
    await humanClickStrict(btn);
    const opts = await waitFor(() => selectOptions().length ? selectOptions() : null, 8000);
    if (!opts) return badSel('studio_video_filter_options', { clicked: true });
    return ok({ opened: true, options: opts.length, filter_label: textOf(btn) });
  }

  async function hStudioFilterByVideo() {
    const btn = await waitFor(videoFilterBtn, 12000);
    if (!btn) return badSel('studio_video_filter');
    await humanClickStrict(btn);
    const option = await waitFor(() => selectOptions()[0] || null, 8000);
    if (!option) return badSel('studio_video_filter_options', { clicked: true });
    const label = textOf(option);
    await humanClickStrict(option);
    await sleep(1200);
    return ok({ filtered: true, video_option: label, rows: studioRows().length });
  }

  async function hStudioReadVideoOptions() {
    const opts = selectOptions();
    if (!opts.length) return badSel('studio_video_filter_options');
    return ok({ count: opts.length, options: opts.slice(0, 20).map(el => textOf(el).slice(0, 120)) });
  }

  async function hStudioChooseSort() {
    const btn = await waitFor(sortBtn, 12000);
    if (!btn) return badSel('studio_sort_control');
    if (/mới nhất|newest/i.test(textOf(btn))) return ok({ sorted: true, already: true, sort: textOf(btn) });
    await humanClickStrict(btn);
    const option = await waitFor(() => selectOptions().find(el => /mới nhất|newest/i.test(textOf(el))) || null, 8000);
    if (!option) return badSel('studio_sort_option', { clicked: true });
    const label = textOf(option);
    await humanClickStrict(option);
    await sleep(800);
    return ok({ sorted: true, sort: label });
  }

  function replyScopeOf(row) {
    let scope = row;
    for (let i = 0; i < 3 && scope && !scope.querySelector('#comment-input'); i++) scope = scope.parentElement;
    return scope;
  }
  async function hStudioOpenReply() {
    const rows = await waitFor(() => studioRows().length ? studioRows() : null, 12000);
    if (!rows) return badSel('studio_comment_rows');
    for (const row of rows) {
      const replyEl = Array.from(row.querySelectorAll('[data-tt="components_MessageCell_TUXText"]'))
        .find(el => /^(trả lời|reply)$/i.test(textOf(el)) && visible(el));
      if (!replyEl) continue;
      await humanClickStrict(replyEl);
      const scope = replyScopeOf(row);
      const editor = await waitFor(() => scope?.querySelector('#comment-input') || null, 8000);
      if (!editor || !visible(editor)) return badSel('studio_reply_editor', { clicked: true });
      return ok({ opened: true, row_preview: textOf(row).slice(0, 160) });
    }
    return badSel('studio_reply_button');
  }

  const studioEditor = () => document.querySelector('#comment-input');

  async function hStudioTypeReply() {
    if (!pContent) return badExec('Thiếu payload.content để gõ trả lời', { missing: 'content' });
    const editor = await waitFor(() => { const e = studioEditor(); return e && visible(e) ? e : null; }, 8000);
    if (!editor) return badSel('studio_reply_editor');
    if (editor.maxLength > 0 && pContent.length > editor.maxLength) {
      return badExec(`Nội dung vượt giới hạn ${editor.maxLength} ký tự của TikTok Studio`, { too_long: true });
    }
    try { editor.focus(); } catch (_) {}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(editor, pContent); else editor.value = pContent;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    if (editor.value !== pContent) return badExec('Nội dung trong ô trả lời không khớp sau khi gõ', { type_mismatch: true });
    return ok({ typed: true, reply_preview: pContent.slice(0, 80) });
  }

  async function hStudioSubmitReply() {
    const editor = studioEditor();
    if (!editor) return badSel('studio_reply_editor');
    let scope = editor;
    for (let i = 0; i < 4 && scope && !scope.querySelector('[data-tt="components_CommentInputEditor_TUXButton"]'); i++) scope = scope.parentElement;
    const send = await waitFor(() => Array.from((scope || document).querySelectorAll('[data-tt="components_CommentInputEditor_TUXButton"]'))
      .find(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') || null, 6000);
    if (!send) return badSel('studio_reply_send_button');
    await humanClickStrict(send);
    await sleep(1000);
    // KHÔNG tự nhận đã xác minh — kiểm chứng là việc của studio_verify_reply
    // (luồng gốc cần bridge main-world để nghe phản hồi publish của TikTok).
    return ok({ submitted: true, verified: false, note: 'submitted_unverified_use_studio_verify_reply' });
  }

  async function hStudioCloseReply() {
    const editor = studioEditor();
    if (!editor) return ok({ closed: true, already: true });
    let scope = editor;
    for (let i = 0; i < 4 && scope; i++) {
      const cancel = Array.from(scope.querySelectorAll?.('button, [role="button"], [data-tt*="TUXButton"]') || [])
        .find(el => visible(el) && /^(hủy|cancel|đóng|close)$/i.test(textOf(el)));
      if (cancel) { await humanClickStrict(cancel); break; }
      scope = scope.parentElement;
    }
    await sleep(600);
    const still = studioEditor();
    if (still && visible(still)) {
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
      await sleep(500);
    }
    const gone = !studioEditor() || !visible(studioEditor());
    if (!gone) return badExec('Đã thử đóng nhưng ô trả lời vẫn còn hiện', { close_unverified: true });
    return ok({ closed: true });
  }

  async function hStudioNextPage() {
    const before = studioRows()[0] ? textOf(studioRows()[0]) : '';
    const btn = await waitFor(() => {
      const cands = Array.from(document.querySelectorAll('button, [role="button"], [data-e2e*="pagination"]'));
      return cands.find(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
        (/next|tiếp|trang sau/i.test(el.getAttribute('aria-label') || '') || /^(next|tiếp|›|»)$/i.test(textOf(el)))) || null;
    }, 10000);
    if (!btn) return badSel('studio_next_page_button');
    await humanClickStrict(btn);
    const changed = await waitFor(() => {
      const first = studioRows()[0];
      return first && textOf(first) !== before ? true : null;
    }, 8000);
    if (!changed) return badExec('Đã bấm trang kế nhưng danh sách bình luận không đổi', { page_not_changed: true });
    return ok({ paged: true, rows: studioRows().length });
  }

  async function hStudioSearchComments() {
    if (!pQuery) return badExec('Thiếu payload.query để tìm bình luận', { missing: 'query' });
    const input = await waitFor(() => document.querySelector(
      'input[data-tt*="Search" i], input[type="search"], input[placeholder*="Tìm kiếm"], input[placeholder*="Search" i], input[aria-label*="Tìm kiếm"], input[aria-label*="Search" i]'), 10000);
    if (!input) return badSel('studio_search_input');
    try { input.focus(); } catch (_) {}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, pQuery); else input.value = pQuery;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(2000);
    return ok({ searched: true, query: pQuery, rows: studioRows().length });
  }

  async function hStudioVerifyReply(state) {
    const needle = pContent || String(state.data.replyText || '');
    if (!needle) return badExec('Thiếu nội dung cần kiểm chứng (payload.content hoặc studio_type_reply trước đó)', { missing: 'content' });
    const hit = await waitFor(() => studioRows().some(r => textOf(r).includes(needle.slice(0, 40))) ? true : null, 8000);
    if (!hit) return badExec('Không thấy trả lời vừa gửi trong danh sách bình luận Studio', { reply_not_visible: true });
    return ok({ verified: true, reply_preview: needle.slice(0, 80) });
  }

  // ── Comment-replier thường (luồng comment-replier.js: mở đúng video
  // đích, bảo đảm panel qua tab Comments cột phải / nút comment, đăng
  // bình luận gốc — khác #16 post_comment ở file nguồn + cách mở panel) ──
  async function hReplierOpenTarget(state) {
    if (!pTargetUrl) return badExec('Thiếu payload.target_url để mở video đích', { missing: 'target_url' });
    let targetId = null;
    try { targetId = (new URL(pTargetUrl, location.href).pathname.match(/\/(?:video|photo)\/(\d+)/) || [])[1] || null; } catch (_) {}
    const curId = (location.pathname.match(/\/(?:video|photo)\/(\d+)/) || [])[1] || null;
    if (targetId && curId === targetId) return ok({ opened: true, already: true, video_id: targetId });
    if (!targetId && location.href === pTargetUrl) return ok({ opened: true, already: true });
    return navTo(state, 'replier_open_target', pTargetUrl);
  }
  async function vReplierOpenTarget() {
    if (!onVideoPage()) return badExec('Chưa tới được video đích của comment-replier', { resumed: true });
    return ok({ opened: true, resumed: true, video_id: (location.pathname.match(/\/(?:video|photo)\/(\d+)/) || [])[1] || null });
  }

  async function hReplierVerifyPanel() {
    const panel = await waitFor(() => (TFQ('commentInput') || TFQA('commentItem').length ||
      document.querySelector('[data-e2e="comment-list"], [class*="DivCommentList"], [data-mut-tiktok-comment]')) ? true : null, 10000);
    if (!panel) return badSel('comment_panel');
    return ok({ panel: true, items: TFQA('commentItem').length });
  }

  async function hReplierPostComment() {
    if (!pContent) return badExec('Thiếu payload.content để đăng bình luận', { missing: 'content' });
    // ensureCommentsTabOpen của comment-replier.js: ưu tiên tab Comments ở
    // cột phải (nửa trên màn hình), sau đó mới tới nút icon comment.
    if (!commentPanelOpen()) {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"], div, span, p, a')).filter(el => {
        if (!visible(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.left < window.innerWidth * 0.35 || r.top > 350 || r.width < 10 || r.height < 10) return false;
        const t = textOf(el).toLowerCase();
        return t === 'comments' || t === 'bình luận' || /^comments?\s*\(\d+\)$/i.test(t) || /^bình luận\s*\(\d+\)$/i.test(t);
      });
      for (const tab of tabs) {
        await humanClickStrict(tab);
        await sleep(600);
        if (commentPanelOpen()) break;
      }
    }
    return typeCommentAndSubmit(pContent);
  }

  // ── Bảng dispatch + tiền tố (đúng brief Phần A) ──
  const PLATFORM_HANDLERS = {
    open_upload_page: hOpenUploadPage,
    set_video_file: hSetVideoFile,
    type_caption: hTypeCaption,
    toggle_comments: () => toggleStudioSetting('comments'),
    toggle_duet: () => toggleStudioSetting('duet'),
    toggle_stitch: () => toggleStudioSetting('stitch'),
    click_post_video: hClickPostVideo,
    wait_upload_complete: hWaitUploadComplete,
    verify_content_page: hVerifyContentPage,
    play_pause_video: hPlayPauseVideo,
    seek_video: hSeekVideo,
    toggle_mute: hToggleMute,
    open_first_video: hOpenFirstVideo,
    open_comments_panel: hOpenCommentsPanel,
    read_comment_count: hReadCommentCount,
    post_comment: hPostComment,
    like_video_button: hLikeVideoButton,
    save_video_button: hSaveVideoButton,
    share_video: hShareVideo,
    studio_open_comments: hStudioOpenComments,
    studio_read_rows: hStudioReadRows,
    studio_filter_unreplied: hStudioFilterUnreplied,
    studio_filter_by_video: hStudioFilterByVideo,
    studio_open_video_filter_list: hStudioOpenVideoFilterList,
    studio_read_video_options: hStudioReadVideoOptions,
    studio_choose_sort: hStudioChooseSort,
    studio_open_reply: hStudioOpenReply,
    studio_type_reply: hStudioTypeReply,
    studio_submit_reply: hStudioSubmitReply,
    studio_close_reply: hStudioCloseReply,
    studio_next_page: hStudioNextPage,
    studio_search_comments: hStudioSearchComments,
    studio_verify_reply: hStudioVerifyReply,
    replier_open_target: hReplierOpenTarget,
    replier_verify_panel: hReplierVerifyPanel,
    replier_post_comment: hReplierPostComment
  };
  const VERIFY_HANDLERS = {
    open_upload_page: vOpenUploadPage,
    open_first_video: vOpenFirstVideo,
    studio_open_comments: vStudioOpenComments,
    replier_open_target: vReplierOpenTarget,
    verify_content_page: vVerifyContentPage
  };
  const PREFIX = {
    set_video_file: ['open_upload_page'],
    type_caption: ['open_upload_page'],
    toggle_comments: ['open_upload_page'],
    toggle_duet: ['open_upload_page'],
    toggle_stitch: ['open_upload_page'],
    click_post_video: ['open_upload_page', 'set_video_file'],
    wait_upload_complete: ['open_upload_page', 'set_video_file'],
    verify_content_page: ['open_upload_page', 'set_video_file', 'click_post_video'],
    play_pause_video: ['open_first_video'],
    seek_video: ['open_first_video'],
    toggle_mute: ['open_first_video'],
    open_comments_panel: ['open_first_video'],
    read_comment_count: ['open_first_video'],
    post_comment: ['open_first_video', 'open_comments_panel'],
    like_video_button: ['open_first_video'],
    save_video_button: ['open_first_video'],
    share_video: ['open_first_video'],
    studio_filter_unreplied: ['studio_open_comments'],
    studio_filter_by_video: ['studio_open_comments'],
    studio_open_video_filter_list: ['studio_open_comments'],
    studio_read_video_options: ['studio_open_comments', 'studio_open_video_filter_list'],
    studio_choose_sort: ['studio_open_comments'],
    studio_open_reply: ['studio_open_comments'],
    studio_type_reply: ['studio_open_comments', 'studio_open_reply'],
    studio_submit_reply: ['studio_open_comments', 'studio_open_reply', 'studio_type_reply'],
    studio_close_reply: ['studio_open_comments', 'studio_open_reply'],
    studio_next_page: ['studio_open_comments'],
    studio_search_comments: ['studio_open_comments'],
    studio_verify_reply: ['studio_open_comments'],
    replier_verify_panel: ['replier_open_target'],
    replier_post_comment: ['replier_open_target']
  };

  function failStep(state, step, r) {
    const isPrefix = state.idx < state.chain.length - 1;
    if (isPrefix) {
      return report('failed',
        { action, prefix_failed: true, failed_step: step, target: r.target || null, ...(r.details || {}) },
        'prefix_failed', `Tiền tố ${step} thất bại: ${r.message || ''}`);
    }
    return report('failed',
      { action, target: r.target || null, ...(r.details || {}) },
      r.failure_code || 'execution_error', r.message || `Hành động ${step} thất bại`);
  }

  async function executeChain(state) {
    while (state.idx < state.chain.length) {
      const step = state.chain[state.idx];
      if (await avjpCancelRequested()) avjpAbortCancelled({ step });
      if (state.verify === step) {
        const vf = VERIFY_HANDLERS[step];
        const vr = vf ? await vf(state) : ok({});
        if (!vr.ok) return failStep(state, step, vr);
        state.verify = null;
        state.data = { ...state.data, ...(vr.data || {}) };
        state.idx++;
        await saveChain(state);
        continue;
      }
      const fn = PLATFORM_HANDLERS[step];
      if (!fn) return failExec({ unknown_step: step }, `Không có handler cho bước: ${step}`);
      const r = await fn(state);
      if (r && r.nav) return; // trang đang chuyển — lượt inject sau chạy tiếp qua phase.verify
      if (!r || !r.ok) return failStep(state, step, r || badExec(`Bước ${step} không trả kết quả`));
      state.data = { ...state.data, ...(r.data || {}) };
      if (step === 'studio_type_reply' && pContent) state.data.replyText = pContent;
      state.idx++;
      await saveChain(state);
    }
    return done({ ...state.data, steps: state.chain },
      `Đã xong hành động: ${action} (chuỗi: ${state.chain.join(' → ')})`);
  }

  async function startChain(act) {
    const chain = [...(PREFIX[act] || []), act];
    const state = { chain, idx: 0, data: {}, verify: null };
    await saveChain(state);
    return executeChain(state);
  }
  async function resumeChain(phase) {
    const state = {
      chain: phase.chain, idx: phase.idx || 0,
      data: phase.data || {}, verify: phase.verify || null
    };
    return executeChain(state);
  }

  // ══════════ PHẦN B — 36 STEP FARMER tf_* (2.11.17) ══════════
  // Cơ chế: contract nhánh micro tiktok nạp sẵn selectors -> modules ->
  // engine -> content (đúng thứ tự nurture), nên window.TF có đủ
  // TF.MODULES + TF.engine (content.js dựng sẵn với hooks ghi storage
  // tf_logs/tf_runstate/tf_counters qua __AVJP_TF_LISTENER). Micro dựng
  // 1 workflow 1 bước {kind:'module', moduleId} + config/stage tối thiểu
  // THẬT rồi gọi TF.engine.start() — engine tự tạo ctx
  // {video:{}, counters:{}, vars:{}}, journal + checkpoint như phiên đầy
  // đủ; micro chỉ CHẠY ĐÚNG 1 STEP đó và đối soát kết quả qua TF_STOPPED
  // (listener) / journal dự phòng. Stage firstSeenDate xa xưa + caps cao:
  // phiên test lẻ 1 step do người dùng ra lệnh trực tiếp — không để trần
  // ngày của Supervisor (vốn cắt like/save/follow ở ngày 1-3) chặn oan.
  // LƯU Ý ÁNH XẠ: 36 key tf_* của brief KHÔNG trùng tên 36 module id thật
  // của Farmer (mo_fyp, xem_video, ...) — bảng dưới map từng key sang
  // module thật gần nhất; 5 key không có module tương ứng (tf_xem_story,
  // tf_mo_url_trong_tab_moi, tf_thuc_hien_script, tf_doi_tab,
  // tf_dong_tab) trỏ thẳng moduleId cùng tên để ENGINE tự trả
  // module_not_found thật, micro không giả lập kết quả.
  const TF_STUB_KEYS = new Set([
    'tf_chon_video_hang_doi', 'tf_goi_workflow', 'tf_lap_lai', 'tf_neu_thi', 'tf_theo_xac_suat',
    'tf_cho_dieu_kien' // dùng chung module neu_thi (stub handled_by_engine)
  ]);
  const TF_STEP_MAP = {
    tf_khoi_tao: { moduleId: 'kiem_login' },
    tf_trang_chu: { moduleId: 'mo_fyp' },
    tf_xem_video: { moduleId: 'xem_video' },
    tf_luot_next: { moduleId: 'luot_next' },
    tf_like: { moduleId: 'like_video' },
    tf_save: { moduleId: 'save_video' },
    tf_follow: { moduleId: 'follow_creator' },
    tf_follow_back: { moduleId: 'follow_danh_sach' },
    tf_binh_luan: { moduleId: 'comment_duyet' },
    tf_doc_binh_luan: { moduleId: 'doc_comment' },
    tf_sang_trang_ca_nhan: { moduleId: 'mo_profile_creator' },
    tf_xem_story: { moduleId: 'xem_story' },
    tf_xem_live: { moduleId: 'xem_live' },
    tf_tim_kiem: { moduleId: 'tim_keyword' },
    tf_theo_doi_live: { moduleId: 'xem_live' },
    tf_tuong_tac_live: { moduleId: 'like_video' },
    tf_doi_video_live: { moduleId: 'luot_next' },
    tf_check_tuong_tac: { moduleId: 'kiem_tran_ngay' },
    tf_khong_lam_gi: { moduleId: 'nghi_vi_mo' },
    tf_mo_thong_bao: { moduleId: 'mo_thong_bao' },
    tf_doc_thong_bao: { moduleId: 'mo_thong_bao' },
    tf_luot_thong_bao: { moduleId: 'mo_thong_bao' },
    tf_dieu_huong_url: { moduleId: 'mo_video_cu_the' },
    tf_mo_url_trong_tab_moi: { moduleId: 'mo_url_trong_tab_moi' },
    tf_thuc_hien_script: { moduleId: 'thuc_hien_script' },
    tf_cho_video: { moduleId: 'xem_video' },
    tf_cho_dieu_kien: { moduleId: 'neu_thi' },
    tf_doi_tab: { moduleId: 'doi_tab' },
    tf_dong_tab: { moduleId: 'dong_tab' },
    tf_cuoi_phien: { moduleId: 'ghi_log' },
    tf_chon_video_hang_doi: { moduleId: 'chon_video_hang_doi' },
    tf_goi_workflow: { moduleId: 'goi_workflow' },
    tf_lap_lai: { moduleId: 'lap_lai' },
    tf_neu_thi: { moduleId: 'neu_thi' },
    tf_theo_xac_suat: { moduleId: 'theo_xac_suat' },
    tf_khao_sat_tai_khoan: { moduleId: 'kiem_login' }
  };

  function buildTfParams(key) {
    const base = (payload.params && typeof payload.params === 'object') ? { ...payload.params } : {};
    const secs = Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.min(120, Math.round(rawSeconds)) : 20;
    const username = String(payload.username ?? payload.target_username ?? base.username ?? '').trim();
    switch (key) {
      case 'tf_xem_video': return { ...base, maxSeconds: secs, minWatchPct: 60, maxWatchPct: 100 };
      case 'tf_cho_video': return { ...base, maxSeconds: secs, minWatchPct: 20, maxWatchPct: 40 };
      case 'tf_doc_binh_luan': return { ...base, readSec: Math.min(30, Math.max(5, secs)) };
      case 'tf_xem_live': case 'tf_theo_doi_live': return { ...base, durationMin: Math.max(0.2, secs / 60) };
      case 'tf_khong_lam_gi': { const s = Math.min(60, Math.max(10, secs)); return { ...base, minSec: s, maxSec: s }; }
      case 'tf_tim_kiem': return { ...base, keyword: pQuery || base.keyword || '' };
      case 'tf_follow_back': return { ...base, username };
      case 'tf_sang_trang_ca_nhan': return { ...base, username };
      case 'tf_binh_luan': return {
        ...base,
        approvalId: String(payload.approval_id ?? payload.approvalId ?? base.approvalId ?? ''),
        text: pContent || base.text || '',
        approved: payload.approved === true || base.approved === true
      };
      case 'tf_dieu_huong_url': return { ...base, url: pTargetUrl || base.url || '' };
      case 'tf_cuoi_phien': return { ...base, text: pContent || base.text || 'Kết thúc phiên (micro tf_cuoi_phien)' };
      case 'tf_check_tuong_tac': return { ...base, capKey: String(payload.cap_key ?? base.capKey ?? 'minutes') };
      case 'tf_goi_workflow': return { ...base, wfId: String(payload.wf_id ?? payload.wfId ?? base.wfId ?? '') };
      case 'tf_lap_lai': return { ...base, times: Number(payload.times ?? base.times ?? 1), maxMinutes: 1 };
      case 'tf_neu_thi': case 'tf_cho_dieu_kien': return {
        ...base,
        ctxKey: String(payload.ctx_key ?? base.ctxKey ?? 'video.isNiche'),
        op: String(payload.op ?? base.op ?? 'truthy'),
        value: payload.value ?? base.value ?? ''
      };
      case 'tf_theo_xac_suat': return { ...base, pct: Number(payload.pct ?? base.pct ?? 50) };
      default: return base;
    }
  }

  function tfOutcomeReport(key, moduleId, engineStatus, note, extra = {}) {
    const stub = TF_STUB_KEYS.has(key) ? { stub: true } : {};
    const details = { action, tf_key: key, module: moduleId, engine_status: engineStatus, note: note || '', ...stub, ...extra };
    if (engineStatus === 'success') {
      return report('success', details, null, `Step Farmer ${key} (module ${moduleId}) xong: ${note || 'ok'}${stub.stub ? ' [stub]' : ''}`);
    }
    if (engineStatus === 'skipped') {
      return report('failed', details, 'execution_error', `Step Farmer ${key} bị Supervisor bỏ qua (skipped): ${note || ''}`);
    }
    const isNotFound = /^not_found:/.test(note || '') || /^module_not_found:/.test(note || '');
    return report('failed', details, isNotFound ? 'selector_not_found' : 'execution_error',
      `Step Farmer ${key} (module ${moduleId}) thất bại: ${note || engineStatus}`);
  }

  async function runTfStep(key) {
    const spec = TF_STEP_MAP[key];
    const moduleId = spec.moduleId;
    const TFg = globalThis.TF;
    if (!TFg || !TFg.MODULES || !TFg.engine || typeof TFg.engine.start !== 'function') {
      return failExec({ tf_key: key, module: moduleId, error: 'tf_engine_unavailable' },
        'Chưa nạp được engine TikTok Farmer (TF) — kiểm tra files list của contract nhánh micro tiktok');
    }
    const params = buildTfParams(key);
    const runId = `micro_${taskId}_${Date.now().toString(36)}`;
    await setPhase({ tf: true, tfKey: key, moduleId, runId, startUrl: location.href, stub: TF_STUB_KEYS.has(key) });
    const config = {
      nickLabel: 'micro-tf', tz: 'Asia/Tokyo',
      niche: { keywords: [], hashtags: [], creators: [], blacklist: [] },
      caps: { maxWatchMinPerDay: 9999, maxLikePerDay: 9999, maxFollowPerDay: 9999, maxSavePerDay: 9999, maxCommentPerDay: 9999, maxMinPerSession: 240 },
      ratios: { likePct: 100, savePct: 100, followPct: 100 },
      cooldownMin: 0, stepTimeoutSec: 120,
      activeHours: { from: '00:00', to: '23:59' },
      followEnabled: true, disabledModules: []
    };
    const wf = {
      id: 'wf_avjp_micro_tf', name: 'Auto vjp — Micro TF 1 step', version: 1,
      triggers: { manual: true, schedule: null, randomWindow: null },
      steps: [{ kind: 'module', moduleId, params }],
      onSuccess: { callWfId: null, delayMin: 0 },
      onFail: { callWfId: null, delayMin: 0 },
      onFinish: { callWfId: null, delayMin: 0 },
      maxRuntimeMin: 5
    };
    const outcome = await new Promise(resolve => {
      let settled = false;
      const finish = v => { if (!settled) { settled = true; resolve(v); } };
      const prevListener = window.__AVJP_TF_LISTENER;
      window.__AVJP_TF_LISTENER = msg => {
        try { if (typeof prevListener === 'function') prevListener(msg); } catch (_) {}
        if (msg && msg.type === 'TF_STOPPED' && msg.runId === runId) finish({ stopped: msg });
      };
      let startRes = null;
      try {
        startRes = TFg.engine.start({
          wf, allWorkflows: [wf], config,
          stage: { firstSeenDate: '2020-01-01' },
          countersToday: {}, runId
        });
      } catch (e) { finish({ error: e }); return; }
      if (startRes && startRes.queued) { finish({ busy: true }); return; }
      const iv = setInterval(() => {
        avjpCancelRequested().then(cancelled => {
          if (!cancelled) return;
          clearInterval(iv);
          try { TFg.engine.stopAll('user_cancelled'); } catch (_) {}
          finish({ cancelled: true });
        }).catch(() => {});
        try {
          if (!TFg.engine.running) {
            clearInterval(iv);
            finish({ stopped: null, journal: Array.isArray(TFg.engine.journal) ? TFg.engine.journal : [] });
          }
        } catch (_) {}
      }, 800);
      setTimeout(() => { clearInterval(iv); finish({ timeout: true }); }, 150000);
      // Nếu module điều hướng (gotoUrl), trang chết tại đây và promise
      // không bao giờ resolve — lượt inject sau đối soát qua resumeTf().
    });
    if (outcome.cancelled) {
      return report('failed', { action, tf_key: key, module: moduleId, cancelled: true }, 'user_cancelled',
        'Đã dừng step Farmer theo yêu cầu người dùng (user_cancelled)');
    }
    if (outcome.busy) {
      return failExec({ tf_key: key, module: moduleId, error: 'engine_busy' },
        'Engine Farmer đang bận chạy phiên khác — không chạy lẻ được step lúc này');
    }
    if (outcome.error) {
      return failExec({ tf_key: key, module: moduleId, error: String(outcome.error?.message || outcome.error) },
        `Engine Farmer lỗi khi start: ${outcome.error?.message || outcome.error}`);
    }
    if (outcome.timeout) {
      try { TFg.engine.stopAll('micro_timeout'); } catch (_) {}
      return tfOutcomeReport(key, moduleId, 'unknown', 'tf_step_timeout_150s');
    }
    const journal = outcome.stopped?.journal || outcome.journal || [];
    const entry = journal.find(e => e && e.moduleId === moduleId && e.endedAt);
    const moduleExists = Boolean(TFg.MODULES[moduleId]);
    if (entry) return tfOutcomeReport(key, moduleId, entry.status, entry.note || '');
    if (!moduleExists) return tfOutcomeReport(key, moduleId, 'failed', `module_not_found:${moduleId}`);
    if (outcome.stopped) {
      const s = outcome.stopped.outcome === 'success' ? 'success' : (outcome.stopped.reason === 'captcha' ? 'captcha' : 'failed');
      return tfOutcomeReport(key, moduleId, s, outcome.stopped.reason || '');
    }
    return tfOutcomeReport(key, moduleId, 'unknown', 'no_journal_entry');
  }

  async function resumeTf(phase) {
    const key = phase.tfKey || action;
    const moduleId = phase.moduleId;
    const stub = phase.stub ? { stub: true } : {};
    let entry = null;
    try {
      const rs = (await chrome.storage.local.get('tf_runstate_v1')).tf_runstate_v1 || {};
      if (rs.journalRunId === phase.runId && Array.isArray(rs.journal)) {
        entry = rs.journal.find(e => e && e.moduleId === moduleId && e.endedAt) || null;
      }
    } catch (_) {}
    if (entry) {
      if (entry.status === 'success') {
        return report('success', { action, tf_key: key, module: moduleId, engine_status: 'success', note: entry.note || '', resumed: true, ...stub },
          null, `Step Farmer ${key} xong (lượt tiếp sau điều hướng): ${entry.note || 'ok'}`);
      }
      return tfOutcomeReport(key, moduleId, entry.status, entry.note || '');
    }
    if (location.href !== phase.startUrl) {
      // Module đã hoàn thành việc của nó BẰNG cú điều hướng (gotoUrl của
      // engine không bao giờ resolve ở trang cũ) — đúng ngữ nghĩa các
      // module điều hướng của Farmer (vd mo_fyp note 'navigated_to_fyp').
      return report('success', { action, tf_key: key, module: moduleId, engine_status: 'navigated', navigated: true, resumed: true, ...stub },
        null, `Step Farmer ${key} (module ${moduleId}) đã điều hướng tới trang đích`);
    }
    return failExec({ tf_key: key, module: moduleId, resumed: true, error: 'tf_interrupted' },
      'Phiên Farmer bị gián đoạn giữa chừng, không có bằng chứng hoàn thành trong journal');
  }

  // ── Dispatch chính ──
  const OLD_ACTIONS = new Set(['scroll_feed', 'watch_first', 'like_first', 'open_notifications', 'open_profile']);
  try {
    const phase = await getPhase();
    if (phase && Array.isArray(phase.chain)) return await resumeChain(phase);
    if (phase && phase.tf) return await resumeTf(phase);
    if (phase) return await resumeLegacy(phase);
    if (OLD_ACTIONS.has(action)) {
      switch (action) {
        case 'scroll_feed': return await actScrollFeed();
        case 'watch_first': return await actWatchFirst();
        case 'like_first': return await actLikeFirst();
        case 'open_notifications': return await actOpenNotifications();
        case 'open_profile': return await actOpenProfile();
      }
    }
    if (TF_STEP_MAP[action]) return await runTfStep(action);
    if (PLATFORM_HANDLERS[action]) return await startChain(action);
    return report('failed', { action, error: 'unknown_action' }, 'execution_error',
      `TikTok micro: hành động không hỗ trợ: ${action || '(trống)'}`);
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `TikTok micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
