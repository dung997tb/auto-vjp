// Auto vjp — Threads micro actions (task type 'micro_action', 2.11.17).
// Hành động nhỏ test LẺ: đủ 22 hành động nguyên tử Threads — 4 key cũ
// (scroll_feed, like_first, open_notifications, open_profile, GIỮ NGUYÊN
// hành vi) + 18 key mới chạy qua step-runner theo chuỗi tiền tố (prefix):
// tiền tố fail -> failed 'prefix_failed' + details.failed_step ghi bước
// nào; bước cuối fail -> failed với failure_code của chính bước đó.
// Task: {platform:'threads', type:'micro_action',
//        payload:{action, seconds?, target_url?, content?, query?, media_url?}}.
// Đọc canonical run trực tiếp, báo kết quả bằng action 'microActionDone'
// (results.js deliver type 'micro_action', có details + failure_code).
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found';
// thiếu đầu vào payload -> failed rõ lý do (details.error:
// missing_target_url / missing_content / missing_query / missing_media_url).
//
// NGUỒN BỘ CHỌN/LOGIC (port nguyên bộ chọn, không bịa mới):
// - automator.js: mở composer (text "Start a thread"/"What's new" +
//   nút menu New thread/Create), editor [data-lexical-editor="true"],
//   nạp text bằng ClipboardEvent paste, đính media qua fetchImage +
//   input[type="file"] + DataTransfer, nút Đăng qua findSmartElement
//   (["Đăng","Post","Chia sẻ"], khớp chặt rồi khớp lỏng), snapshotPostIds
//   + getNewPostUrl để kiểm chứng bài đã đăng.
// - interaction.js: findMainCommentBox/allEditors/editorHint, nút mở
//   bình luận (svg title/aria/text Reply), setText, submitEditor (tìm
//   nút gửi cùng khung composer, dự phòng Enter), findPostLike
//   (svg Like/Unlike).
// - affiliate-commenter.js: setText bản Lexical (click+focus -> paste ->
//   dự phòng execCommand insertText), findCommentBox.
// - threads-nurture/adapter.js: đơn vị bài [data-pressable-container]
//   + permalink /post/<code>, nhãn Follow/Following song ngữ, nhịp cuộn
//   nuôi scrollBy 0.85 * chiều cao màn hình.
// LƯU Ý KỸ THUẬT: cả 4 file nguồn đều là IIFE khép kín tự chạy theo
// storage key của task riêng (post/reply/affiliate/nurture) và KHÔNG
// export hàm nào ra global — không thể "gọi hàm thật" từ micro.js mà
// không sửa file nguồn (ngoài phạm vi lane này). Vì vậy handler ở đây
// port ĐÚNG bộ chọn/logic của file nguồn như 4 key cũ vẫn làm, và
// contract KHÔNG nạp kèm file nguồn vào nhánh micro_action (nạp vào là
// chúng tự chạy luồng task riêng, tranh chấp tab).
// Phase storage (avjpMicroPhase_threads) lo chạy tiếp sau điều hướng:
// runner ghi completed[] TRƯỚC từng bước; bước điều hướng (open_home,
// open_post_from_url, nurture_search...) ghi phase TRƯỚC location.assign
// rồi chờ đích bằng waitFor có giới hạn ngay trong bước: document sống
// (SPA/không reload) thì xác minh tại chỗ, document chết vì reload thì
// document mới resume chạy lại bước — bản thân bước tự nhận biết "đã tới
// đích" nên chạy lại là an toàn (idempotent); quá hạn không tới đích thì
// bước trả fail rõ lý do. Mọi ngả đều kết thúc bằng report(...) đúng 1
// lần, không treo câm, không báo "navigated" khi chưa xác minh đích.
// SHAPE STEPS (sửa 2.11.17): mỗi entry của STEPS là HÀM async trần
// (method shorthand) — runner gọi qua resolveStep(key)(ctx), KHÔNG có
// thuộc tính .exec (bản cũ gọi STEPS[key].exec -> TypeError mọi bước).
// Mọi cú bấm qua AVJP.human.clickEl; clickEl trả false nghĩa là nó đã
// tự fallback el.click() (xem humanmouse.js) -> nơi gọi KHÔNG bấm lại.
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
    } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
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
  const clearPhase = async () => { try { await chrome.storage.local.remove(PHASE_KEY); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); } };

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
      try { v = fn(); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
      if (v) return v;
      if (Date.now() >= end) return null;
      if (!(await avjpSleepCancellable(stepMs))) avjpAbortCancelled({ phase: 'waitFor' });
    }
  }
  function plainClick(el) {
    if (!el) return false;
    const target = el.closest?.('a, button, [role="button"]') || el;
    try { target.scrollIntoView({ block: 'center' }); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
    try { target.focus(); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
    for (const type of ['mouseover', 'mousedown', 'mouseup']) {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
    }
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  // Quy ước humanmouse (2.11.17, siết lại theo brief): AVJP.human có mặt
  // -> clickEl tự lo fallback el.click() khi SW không bấm hộ được và trả
  // false; nơi gọi KHÔNG bấm lại (bấm trùng = unlike/bỏ theo dõi). Chỉ
  // khi human VẮNG mặt mới dùng plainClick.
  async function humanClick(el) {
    if (!el) return false;
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.clickEl === 'function') {
        await human.clickEl(el);
        return true;
      }
    } catch (_) { /* human ném lỗi lạ -> rơi xuống click thường 1 lần */ }
    return plainClick(el);
  }
  async function humanScrollBy(dy) {
    try {
      const human = globalThis.AVJP?.human;
      if (human && typeof human.scrollBy === 'function') { await human.scrollBy(dy); return true; }
    } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
    window.scrollBy(0, dy);
    return false;
  }

  // ── Helpers dùng chung cho các bước mới (port từ file nguồn) ──
  const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
  const labelOf = el => norm(`${el?.getAttribute?.('aria-label') || ''} ${el?.textContent || ''}`).toLowerCase();
  const editorText = el => norm(el?.value || el?.innerText || el?.textContent || '');
  const dialogRoot = () => document.querySelector('div[aria-modal="true"][role="dialog"]') || document;
  // automator.js §4: editor trong modal [data-lexical-editor="true"]
  // hoặc div[role="textbox"].
  function findPostEditor() {
    const root = dialogRoot();
    return root.querySelector('[data-lexical-editor="true"], div[role="textbox"]')
      || document.querySelector('[data-lexical-editor="true"]');
  }
  // interaction.js: allEditors + editorHint + findMainCommentBox.
  const allEditors = () => Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
    .filter(el => visible(el) && !el.closest('[aria-hidden="true"]'));
  const editorHint = el => norm(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`).toLowerCase();
  function findCommentBox() {
    const editors = allEditors();
    const matched = editors.find(el => {
      const hint = editorHint(el);
      const parentText = (el.parentElement?.innerText || '').toLowerCase();
      return /reply|trả lời|bình luận|comment|compose|type to compose|soạn/i.test(hint)
        || /reply to|trả lời/i.test(parentText);
    });
    if (matched) return matched;
    if (/\/@[^/]+\/post\//i.test(location.pathname) && editors.length > 0) return editors[0];
    return editors.find(el => el.closest('main, article, div[role="dialog"]')) || editors[0] || null;
  }
  // affiliate-commenter.js setText (Lexical): click+focus -> paste
  // ClipboardEvent -> dự phòng selectAll + execCommand insertText.
  // Trả true khi editor đã nhận nội dung (so đoạn đầu đã chuẩn hoá).
  async function setEditorText(el, text) {
    try { el.scrollIntoView({ block: 'center' }); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
    await humanClick(el);
    try { el.focus(); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
    await sleep(250);
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
      await sleep(200);
      if (!editorText(el).includes(norm(text).slice(0, 10))) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    await sleep(300);
    return editorText(el).includes(norm(text).slice(0, 10));
  }
  // automator.js findSmartElement: quét div[role="button"]/span/button
  // trong container, khớp aria-label/text theo từ khoá (chặt hoặc lỏng).
  async function findSmartBtn(keywords, retries, allowSubstring, container) {
    for (let i = 0; i < retries; i++) {
      const targets = container.querySelectorAll('div[role="button"], div[aria-label], span, button');
      for (const el of targets) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const lab = (el.getAttribute('aria-label') || '').trim().toLowerCase();
        const txt = (el.innerText || '').trim().toLowerCase();
        if (!lab && !txt) continue;
        const isMatch = keywords.some(kw => {
          const k = kw.toLowerCase();
          return allowSubstring ? (lab.includes(k) || txt.includes(k)) : (lab === k || txt === k);
        });
        if (isMatch && el.getAttribute('aria-disabled') !== 'true') return el;
      }
      await sleep(700);
    }
    return null;
  }
  // automator.js: fetchImage qua background + dataURLtoFile.
  function fetchImageViaBackground(url) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'fetchImage', url }, res => {
        if (res && res.success) resolve(res);
        else resolve(null);
      });
    });
  }
  function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) { u8arr[n] = bstr.charCodeAt(n); }
    return new File([u8arr], filename, { type: mime });
  }
  // automator.js snapshotPostIds (kiểm chứng bài mới sau khi đăng).
  function snapshotPostIds() {
    const links = document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
    const set = new Set();
    for (const a of links) {
      const m = a.href.match(/\/(?:posts|permalink)\/(\d+)/);
      if (m && m[1]) set.add(m[1]);
    }
    return set;
  }
  const pressEnter = el => {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
  };
  // interaction.js submitEditor: tìm nút gửi cùng khung composer (khớp
  // title svg/aria/text + vị trí), không có -> Enter. Bấm qua humanClick.
  async function submitEditorHuman(box) {
    const boxRect = box.getBoundingClientRect();
    let submit = null;
    let p = box.parentElement;
    while (p && p !== document.body) {
      const candidates = Array.from(p.querySelectorAll('button, [role="button"]')).filter(visible);
      submit = candidates.find(b => {
        const r = b.getBoundingClientRect();
        const svg = b.querySelector('svg');
        const title = (svg?.querySelector('title')?.textContent || svg?.getAttribute('aria-label') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.innerText || '').trim().toLowerCase();
        const isMatch = /^(reply|post|trả lời|đăng|send|gửi)$/i.test(title)
          || /^(reply|post|trả lời|đăng|send|gửi)$/i.test(aria)
          || /^(reply|post|trả lời|đăng|send|gửi)$/i.test(text);
        const isNotOther = aria !== 'expand composer' && aria !== 'attach media';
        const isPositionValid = r.top >= boxRect.top - 20 && r.left > boxRect.left;
        return isMatch && isNotOther && isPositionValid;
      });
      if (submit) break;
      p = p.parentElement;
    }
    if (!submit) {
      const scope = box.closest('form, article, div[role="dialog"]') || document;
      submit = Array.from(scope.querySelectorAll('button, [role="button"]'))
        .find(b => visible(b) && (/(?:^|\s)(post|đăng|send|gửi)(?:\s|$)/i.test(labelOf(b))
          || /(post reply|đăng trả lời|gửi bình luận)/i.test(labelOf(b))));
    }
    if (submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true') {
      await humanClick(submit);
      await sleep(1200);
      return 'button';
    }
    pressEnter(box);
    await sleep(1200);
    return 'enter';
  }
  // interaction.js: nút mở bình luận của bài (svg title/aria/text Reply).
  function findReplyOpenButton() {
    return Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
      if (!visible(b)) return false;
      const svg = b.querySelector('svg');
      const title = (svg?.querySelector('title')?.textContent || svg?.getAttribute('aria-label') || '').toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const txt = (b.innerText || '').trim().toLowerCase();
      return /reply|trả lời|comment|bình luận/i.test(title)
        || /reply|trả lời|comment|bình luận/i.test(aria)
        || /^(reply|trả lời)\d*$/i.test(txt);
    }) || null;
  }
  // threads-nurture/adapter.js findUnits (bản gọn): khối
  // [data-pressable-container="true"] có permalink /post/<code>.
  function nurtureUnits() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('[data-pressable-container="true"]').forEach(el => {
      if (!visible(el)) return;
      const a = el.querySelector('a[href*="/post/"]');
      if (!a) return;
      const code = (a.getAttribute('href') || '').match(/\/post\/([A-Za-z0-9_-]+)/)?.[1];
      if (!code || seen.has(code)) return;
      seen.add(code);
      out.push({ el, code, url: a.href, link: a });
    });
    return out;
  }

  // ── Bộ chọn riêng Threads (4 key cũ) ──
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

  // ── 4 hành động cũ (giữ nguyên) ──
  async function actScrollFeed() {
    const secs = secondsOr(30);
    const end = Date.now() + secs * 1000;
    let ticks = 0, totalPx = 0;
    while (Date.now() < end) {
      const dy = Math.round(rand(300, 750));
      await humanScrollBy(dy);
      totalPx += dy; ticks++;
      if (!(await avjpSleepCancellable(Math.min(rand(700, 2000), Math.max(0, end - Date.now()))))) avjpAbortCancelled({ step: 'scroll_feed', ticks });
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

  // ── Step-runner cho 18 hành động mới ──
  // Mỗi bước: hàm async (ctx) -> {ok:true, details, message?} |
  // {ok:false, code, error?, target?, message?, details?}.
  // ctx.acc = details tích luỹ của các bước trước (đọc lại sau điều hướng).
  const failStep = (target, extra = {}) => ({
    ok: false, code: 'selector_not_found', target,
    message: `Không tìm thấy phần tử đích: ${target}`, details: extra
  });
  const okStep = (details, message) => ({ ok: true, details: details || {}, message });

  const STEPS = {
    // automator.js run(): về trang chủ + chờ timeline dựng.
    async open_home() {
      const HOME_RE = /^\/(home)?\/?$/;
      const hasFeed = () => !!document.querySelector('[data-pressable-container]');
      const arrived = () => HOME_RE.test(location.pathname) && hasFeed();
      if (arrived()) return okStep({ opened: true, already: true });
      if (!HOME_RE.test(location.pathname)) {
        // Phase đã được runner ghi trước bước; ghi thêm navPending TRƯỚC
        // assign để document mới (sau reload) resume đúng bước này.
        await setPhase({ current: 'open_home', navPending: 'open_home' });
        location.assign('https://www.threads.net/');
        // Document còn sống -> chờ đích tại chỗ; document chết vì reload
        // -> lượt resume chạy lại bước này và nhánh arrived() xác minh.
        const ok = await waitFor(() => arrived() ? true : null, 15000);
        if (!ok) return failStep('home_timeline', { navigated: true });
        return okStep({ opened: true, navigated: true });
      }
      const feed = await waitFor(() => hasFeed() ? true : null, 12000);
      if (!feed) return failStep('home_timeline');
      return okStep({ opened: true });
    },
    // Mở bài theo URL đích (automator/affiliate mở bài qua permalink).
    async open_post_from_url() {
      const target = String(payload.target_url || payload.targetUrl || payload.url || run.source_url || '').trim();
      if (!target) return { ok: false, code: 'execution_error', error: 'missing_target_url', message: 'Thiếu payload.target_url để mở bài' };
      let tUrl;
      try { tUrl = new URL(target, location.origin); } catch (_) {
        return { ok: false, code: 'execution_error', error: 'invalid_target_url', message: 'payload.target_url không phải URL hợp lệ' };
      }
      const samePath = location.pathname.replace(/\/$/, '') === tUrl.pathname.replace(/\/$/, '');
      const postReady = () => /\/@[^/]+\/post\//i.test(location.pathname)
        && !!document.querySelector('[data-pressable-container], article, main');
      if (samePath && postReady()) return okStep({ opened: true, already: true, url: location.href });
      if (!samePath) {
        await setPhase({ current: 'open_post_from_url', navPending: 'open_post_from_url' });
        location.assign(tUrl.href);
        // Như open_home: chờ đích tại chỗ nếu document còn sống; chết vì
        // reload thì lượt resume chạy lại bước này (nhánh already ở trên).
        const ok = await waitFor(() => {
          const sp = location.pathname.replace(/\/$/, '') === tUrl.pathname.replace(/\/$/, '');
          return sp && postReady() ? true : null;
        }, 15000);
        if (!ok) return failStep('target_post_page', { url: tUrl.href, navigated: true });
        return okStep({ opened: true, navigated: true, url: location.href });
      }
      const ready = await waitFor(() => postReady() ? true : null, 12000);
      if (!ready) return failStep('target_post_page', { url: tUrl.href });
      return okStep({ opened: true, url: location.href });
    },
    // automator.js §2: bấm "Start a thread"/"What's new", dự phòng nút
    // menu New thread/Create, chờ editor trong dialog.
    async open_composer() {
      if (findPostEditor() && document.querySelector('div[aria-modal="true"][role="dialog"]')) {
        return okStep({ opened: true, already: true });
      }
      let trigger = null;
      const fakeInputs = document.querySelectorAll('div[role="button"], a[role="link"], span');
      for (const el of fakeInputs) {
        const txt = (el.innerText || '').trim().toLowerCase();
        if (txt.includes('có gì mới') || txt.includes("what's new") || txt.includes('start a thread') || txt.includes('bắt đầu thread')) { trigger = el; break; }
      }
      if (trigger) { await humanClick(trigger); await sleep(1500); }
      let ed = await waitFor(() => findPostEditor(), 4000);
      if (!ed) {
        const menuBtn = document.querySelector('[aria-label*="New thread"], [aria-label*="Tạo thread"], [aria-label*="Create"], [aria-label*="Tạo"]');
        if (menuBtn) { await humanClick(menuBtn); await sleep(1500); ed = await waitFor(() => findPostEditor(), 8000); }
      }
      if (!ed) return failStep(trigger ? 'composer_editor' : 'composer_trigger');
      return okStep({ opened: true });
    },
    // automator.js §4: chờ + focus editor trong modal.
    async focus_editor() {
      const ed = await waitFor(() => findPostEditor(), 10000);
      if (!ed) return failStep('post_editor');
      await humanClick(ed);
      try { ed.focus(); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
      await sleep(300);
      return okStep({ focused: document.activeElement === ed });
    },
    // automator.js §4: nạp text (payload.content hoặc text mẫu).
    async type_post_text(ctx) {
      const text = String(payload.content || payload.text || run.content || '').trim()
        || 'Bài viết kiểm tra từ Auto vjp — hành động nhỏ type_post_text.';
      const ed = await waitFor(() => findPostEditor(), 8000);
      if (!ed) return failStep('post_editor');
      const inserted = await setEditorText(ed, text);
      if (!inserted) return { ok: false, code: 'execution_error', error: 'text_insert_failed', message: 'Editor không nhận nội dung gõ vào' };
      ctx.postText = text;
      return okStep({ inserted: true, chars: text.length, preview: text.slice(0, 60) });
    },
    // automator.js §1+§3: tải media theo URL qua background, đẩy vào
    // input file của dialog (mở khay qua nút Ảnh/video nếu chưa có).
    async attach_media_url() {
      const mediaUrl = String(payload.media_url || payload.mediaUrl || payload.image_url || '').trim();
      if (!mediaUrl) return { ok: false, code: 'execution_error', error: 'missing_media_url', message: 'Thiếu payload.media_url để đính kèm media' };
      const res = await fetchImageViaBackground(mediaUrl);
      if (!res || !res.dataUrl) return { ok: false, code: 'execution_error', error: 'media_fetch_failed', message: `Không tải được media qua background: ${mediaUrl}` };
      const fileSel = 'input[type="file"][accept*="image"], input[type="file"][accept*="video"]';
      let fileInput = dialogRoot().querySelector(fileSel) || document.querySelector('input[type="file"]');
      if (!fileInput) {
        const photoBtn = await findSmartBtn(['Ảnh/video', 'Photo/video', 'Add Media', 'Thêm file phương tiện', 'Đính kèm', 'Attach'], 3, true, dialogRoot());
        if (photoBtn) { await humanClick(photoBtn); await sleep(1200); }
        fileInput = dialogRoot().querySelector(fileSel) || document.querySelector('input[type="file"]');
      }
      if (!fileInput) return failStep('media_file_input');
      const mime = (res.dataUrl.split(';')[0].split(':')[1] || 'image/png').toLowerCase();
      const ext = mime.includes('video') ? (mime.includes('webm') ? 'webm' : 'mp4')
        : (mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png');
      const file = dataURLtoFile(res.dataUrl, `micro_media.${ext}`);
      const dt = new DataTransfer();
      dt.items.add(file);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
      if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (!(await avjpSleepCancellable(3000))) avjpAbortCancelled({ step: 'attach_media_url' });
      const previewSeen = !!dialogRoot().querySelector('img[src^="blob:"], video[src^="blob:"], video');
      return okStep({
        attached: true, mime, size: file.size, media_url: mediaUrl,
        input_files: fileInput.files ? fileInput.files.length : 0, preview_seen: previewSeen
      });
    },
    // automator.js §5: dò nút Đăng (chặt rồi lỏng) trong modal + chụp
    // snapshotPostIds TRƯỚC cú bấm cho bước verify_post đối chiếu.
    async click_post() {
      const oldIds = [...snapshotPostIds()].slice(0, 200);
      const root = dialogRoot();
      let btn = await findSmartBtn(['Đăng', 'Post', 'Chia sẻ'], 2, false, root);
      if (!btn) btn = await findSmartBtn(['Đăng', 'Post', 'Chia sẻ'], 2, true, root);
      if (!btn) return failStep('post_button', { old_post_ids: oldIds });
      await humanClick(btn);
      await sleep(2500);
      const composerClosed = !document.querySelector('div[aria-modal="true"][role="dialog"]') || !findPostEditor();
      return okStep({ clicked: true, composer_closed: composerClosed, old_post_ids: oldIds });
    },
    // automator.js getNewPostUrl: link toast / link bài MỚI so với
    // snapshot, hoặc nội dung hiện trên trang hồ sơ của mình.
    async verify_post(ctx) {
      const content = String(payload.content || payload.text || '').trim();
      const snippet = norm(content).slice(0, 40);
      const oldIds = new Set((ctx.acc.click_post && ctx.acc.click_post.old_post_ids) || []);
      const found = await waitFor(() => {
        const toastLinks = document.querySelectorAll('div[role="alert"] a');
        for (const a of toastLinks) {
          if (a.href && (a.href.includes('/posts/') || a.href.includes('/permalink/'))) {
            return { url: a.href.split('?')[0], via: 'toast_link' };
          }
        }
        const links = document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
        for (const a of links) {
          if (!a.href || a.href.includes('comment_id')) continue;
          const m = a.href.match(/\/(?:posts|permalink)\/(\d+)/);
          if (m && m[1] && !oldIds.has(m[1])) return { url: a.href.split('?')[0], via: 'new_post_link' };
        }
        if (snippet && (document.body?.innerText || '').includes(snippet)
          && /^\/@[A-Za-z0-9._]+\/?$/.test(location.pathname)) {
          return { url: location.href, via: 'profile_text' };
        }
        return null;
      }, 12000);
      if (!found) return failStep('posted_thread', { verified: false });
      return okStep({ verified: true, post_url: found.url, via: found.via });
    },
    // interaction.js: bấm nút Reply của bài để mở khu bình luận.
    async open_comments() {
      const btn = await waitFor(() => findReplyOpenButton(), 8000);
      if (!btn) return failStep('reply_button');
      await humanClick(btn);
      await sleep(800);
      const box = await waitFor(() => findCommentBox(), 6000);
      if (!box) return failStep('comment_box', { clicked: true });
      return okStep({ opened: true, comment_box_found: true });
    },
    // interaction.js findMainCommentBox + focus.
    async focus_comment_box() {
      const box = await waitFor(() => findCommentBox(), 8000);
      if (!box) return failStep('comment_box');
      await humanClick(box);
      try { box.focus(); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
      await sleep(300);
      return okStep({ focused: document.activeElement === box });
    },
    // interaction.js setText vào ô trả lời (nội dung từ payload.content).
    async type_reply() {
      const content = String(payload.content || payload.text || '').trim();
      if (!content) return { ok: false, code: 'execution_error', error: 'missing_content', message: 'Thiếu payload.content cho trả lời' };
      const box = await waitFor(() => findCommentBox(), 8000);
      if (!box) return failStep('comment_box');
      const inserted = await setEditorText(box, content);
      if (!inserted) return { ok: false, code: 'execution_error', error: 'reply_text_not_inserted', message: 'Ô trả lời không nhận nội dung gõ vào' };
      return okStep({ inserted: true, chars: content.length, preview: content.slice(0, 60) });
    },
    // interaction.js submitEditor + kiểm chứng ô đã trống/nội dung đã đi.
    async submit_reply() {
      const content = String(payload.content || payload.text || '').trim();
      const snippet = norm(content).slice(0, 30);
      const box = await waitFor(() => findCommentBox(), 6000);
      if (!box) return failStep('comment_box');
      const via = await submitEditorHuman(box);
      const verified = await waitFor(() => {
        if (!box.isConnected) return 'box_detached';
        if (snippet && !editorText(box).includes(snippet)) return 'box_cleared';
        return null;
      }, 6000);
      if (!verified) {
        return {
          ok: false, code: 'execution_error', error: 'reply_submit_unconfirmed',
          message: 'Đã bấm gửi nhưng ô trả lời vẫn còn nguyên nội dung sau 6 giây', details: { via }
        };
      }
      return okStep({ submitted: true, via, verified: true, proof: String(verified) });
    },
    // interaction.js findPostLike: Like -> bấm -> xác minh lật Unlike.
    async like_post() {
      if (document.querySelector(UNLIKE_SVG)) return okStep({ liked: true, already: true });
      const svg = await waitFor(() => document.querySelector(LIKE_SVG), 8000);
      if (!svg) return failStep('post_like_button');
      const btn = svg.closest('button, [role="button"]') || svg;
      await humanClick(btn);
      const verified = await waitFor(() => document.querySelector(UNLIKE_SVG) ? true : null, 3000);
      return okStep({ liked: true, verified: Boolean(verified) });
    },
    // threads-nurture/adapter.js findActionBtn('follow'): nhãn Follow/
    // Theo dõi/Follow back; proof = nút lật Following/Đang theo dõi.
    async follow_author() {
      const FOLLOW = ['Follow', 'Theo dõi', 'Follow back', 'Theo dõi lại'];
      const FOLLOWING = ['Following', 'Đang theo dõi'];
      const findBtn = labels => {
        const scopes = [document.querySelector('article, [data-pressable-container]'), document];
        for (const scope of scopes) {
          if (!scope) continue;
          const hit = Array.from(scope.querySelectorAll('button, [role="button"]'))
            .find(b => {
              if (!visible(b)) return false;
              const txt = norm(b.innerText || b.textContent || '');
              const aria = norm(b.getAttribute('aria-label') || '');
              return labels.includes(txt) || labels.includes(aria);
            });
          if (hit) return hit;
        }
        return null;
      };
      if (findBtn(FOLLOWING) && !findBtn(FOLLOW)) return okStep({ followed: true, already: true });
      const btn = await waitFor(() => findBtn(FOLLOW), 8000);
      if (!btn) return failStep('follow_button');
      await humanClick(btn);
      const verified = await waitFor(() => findBtn(FOLLOWING) ? true : null, 3000);
      return okStep({ followed: true, verified: Boolean(verified) });
    },
    // threads-nurture/adapter.js vòng nuôi: cuộn 0.85 * chiều cao màn
    // hình, nán 1.2-2.2s/vòng, đếm đơn vị bài thấy được. KHÁC
    // scroll_feed cũ (cuộn bằng chuột người theo giây + tổng px).
    async nurture_feed_scroll() {
      const secs = secondsOr(20);
      let rounds = 0, maxUnits = nurtureUnits().length;
      const end = Date.now() + secs * 1000;
      while (Date.now() < end) {
        window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'smooth' });
        rounds++;
        if (!(await avjpSleepCancellable(Math.min(rand(1200, 2200), Math.max(0, end - Date.now()))))) avjpAbortCancelled({ step: 'nurture_feed_scroll', rounds });
        maxUnits = Math.max(maxUnits, nurtureUnits().length);
      }
      if (maxUnits === 0) return failStep('nurture_feed_units', { rounds });
      return okStep({ seconds: secs, rounds, units_seen: maxUnits, behavior: 'adapter_scroll_0.85_viewport' });
    },
    // Tìm kiếm nuôi: adapter Threads không có bước search riêng (nuôi
    // trên feed) — dùng route tìm kiếm chính thức /search?q= của
    // Threads + cùng bộ đếm đơn vị bài của adapter để kiểm chứng.
    async nurture_search() {
      const query = String(payload.query || payload.keyword || '').trim();
      if (!query) return { ok: false, code: 'execution_error', error: 'missing_query', message: 'Thiếu payload.query để tìm kiếm' };
      const countResults = () => document.querySelectorAll('[data-pressable-container="true"], a[href*="/post/"]').length;
      const curQ = new URLSearchParams(location.search).get('q');
      if (location.pathname.startsWith('/search') && curQ === query) {
        const n = await waitFor(() => countResults() || null, 10000);
        if (!n) return failStep('search_results', { query });
        return okStep({ query, results_seen: n, already: true });
      }
      await setPhase({ current: 'nurture_search', navPending: 'nurture_search' });
      location.assign(`https://www.threads.net/search?q=${encodeURIComponent(query)}`);
      // Như open_home: chờ kết quả tại chỗ nếu document còn sống; chết
      // vì reload thì lượt resume chạy lại bước này (nhánh already ở
      // trên); quá hạn không có kết quả -> fail rõ lý do, không treo.
      const n = await waitFor(() => {
        const q = new URLSearchParams(location.search).get('q');
        if (!location.pathname.startsWith('/search') || q !== query) return null;
        return countResults() || null;
      }, 12000);
      if (!n) return failStep('search_results', { query, navigated: true });
      return okStep({ query, results_seen: n, navigated: true });
    },
    // threads-nurture/adapter.js: mở đơn vị bài đầu (permalink của nó).
    async nurture_open_post() {
      const units = await waitFor(() => {
        const u = nurtureUnits();
        return u.length ? u : null;
      }, 12000);
      if (!units) return failStep('nurture_post_unit');
      const u = units[0];
      try { u.el.scrollIntoView({ block: 'center' }); } catch (_) { console.debug("[Auto vjp][micro] bỏ qua lỗi:", _); }
      await sleep(300);
      await humanClick(u.link);
      const opened = await waitFor(() => /\/@[^/]+\/post\//i.test(location.pathname)
        || document.querySelector('div[role="dialog"] [data-pressable-container]') ? true : null, 8000);
      if (!opened) return failStep('nurture_post_page', { clicked: true, post_url: u.url });
      return okStep({ opened: true, post_url: /\/post\//.test(location.href) ? location.href : u.url, code: u.code });
    },
    // Kiểm chứng 1 bài đang hiển thị trong luồng nuôi (trang bài hoặc
    // dialog bài): có URL /post/<code> + khối bài có nội dung.
    async nurture_verify_post() {
      const isPostUrl = /\/@[^/]+\/post\//i.test(location.pathname);
      const inDialog = !!document.querySelector('div[role="dialog"] [data-pressable-container]');
      if (!isPostUrl && !inDialog) return failStep('nurture_post_display');
      const root = document.querySelector('[data-pressable-container="true"], article, main');
      const txt = root ? norm(root.innerText || root.textContent || '').slice(0, 120) : '';
      if (!root || txt.length < 2) return failStep('nurture_post_content');
      const authorLink = document.querySelector('a[href^="/@"]');
      return okStep({
        verified: true, post_url: location.href,
        code: (location.pathname.match(/\/post\/([A-Za-z0-9_-]+)/) || [])[1] || null,
        author: authorLink ? authorLink.getAttribute('href') : null,
        text_preview: txt
      });
    }
  };

  // Chuỗi bước cho từng hành động mới: tiền tố (context) + chính nó.
  const CHAINS = {
    open_home: ['open_home'],
    open_post_from_url: ['open_post_from_url'],
    open_composer: ['open_composer'],
    focus_editor: ['open_composer', 'focus_editor'],
    type_post_text: ['open_composer', 'focus_editor', 'type_post_text'],
    attach_media_url: ['open_composer', 'focus_editor', 'type_post_text', 'attach_media_url'],
    click_post: ['open_composer', 'focus_editor', 'type_post_text', 'click_post'],
    verify_post: ['open_composer', 'focus_editor', 'type_post_text', 'click_post', 'verify_post'],
    open_comments: ['open_post_from_url', 'open_comments'],
    focus_comment_box: ['open_post_from_url', 'open_comments', 'focus_comment_box'],
    type_reply: ['open_post_from_url', 'open_comments', 'focus_comment_box', 'type_reply'],
    submit_reply: ['open_post_from_url', 'open_comments', 'focus_comment_box', 'type_reply', 'submit_reply'],
    like_post: ['open_post_from_url', 'like_post'],
    follow_author: ['open_post_from_url', 'follow_author'],
    nurture_feed_scroll: ['nurture_feed_scroll'],
    nurture_search: ['nurture_search'],
    nurture_open_post: ['nurture_open_post'],
    nurture_verify_post: ['nurture_verify_post']
  };

  // Resolve 1 bước thành hàm gọi được. Shape thật của STEPS: mỗi entry
  // là hàm async trần (method shorthand trong object literal) — bản cũ
  // gọi STEPS[key].exec(ctx) trong khi entry KHÔNG có thuộc tính exec
  // -> "STEPS[key].exec is not a function" ở MỌI bước chain (đây là gốc
  // lỗi prefix_failed của focus_editor và lỗi dispatch của open_home).
  // Chấp nhận thêm shape {exec} cho an toàn; không resolve được -> null
  // để runChain báo failed rõ lý do thay vì TypeError khó hiểu.
  const resolveStep = key => {
    const s = STEPS[key];
    if (typeof s === 'function') return s;
    if (s && typeof s.exec === 'function') return s.exec;
    return null;
  };

  async function runChain(chainKeys) {
    const phase = await getPhase();
    let acc = (phase && phase.acc && typeof phase.acc === 'object') ? phase.acc : {};
    let startIdx = 0;
    if (phase && Array.isArray(phase.completed)) {
      const comp = phase.completed.filter((k, i) => chainKeys[i] === k);
      startIdx = comp.length;
      if (startIdx >= chainKeys.length) {
        return done({ steps: acc, resumed: true }, `Đã xong hành động nhỏ: ${action} (lượt tiếp sau điều hướng)`);
      }
    }
    const ctx = { acc };
    let lastMessage = '';
    for (let i = startIdx; i < chainKeys.length; i++) {
      const key = chainKeys[i];
      const isFinal = i === chainKeys.length - 1;
      if (await avjpCancelRequested()) avjpAbortCancelled({ step: key });
      await setPhase({ completed: chainKeys.slice(0, i), acc, current: key });
      const stepFn = resolveStep(key);
      let res;
      if (!stepFn) {
        res = {
          ok: false, code: 'execution_error', error: 'step_not_callable',
          message: `Bước ${key} không resolve được hàm chạy trong STEPS (shape không hợp lệ)`
        };
      } else {
        try { res = await stepFn(ctx); }
        catch (err) {
          res = { ok: false, code: 'execution_error', error: String(err?.message || err), message: `Bước ${key} lỗi: ${err?.message || err}` };
        }
      }
      if (!res || !res.ok) {
        const r = res || {};
        if (!isFinal) {
          return report('failed', {
            action, failed_step: key, completed_steps: chainKeys.slice(0, i),
            found: r.code === 'selector_not_found' ? false : undefined,
            target: r.target || null, error: r.error || r.code || 'prefix_step_failed',
            ...(r.details || {})
          }, 'prefix_failed', `Bước tiền tố thất bại: ${key} — ${r.message || r.error || ''}`);
        }
        return report('failed', {
          action, step: key,
          found: r.code === 'selector_not_found' ? false : undefined,
          target: r.target || null, error: r.error || null,
          ...(r.details || {})
        }, r.code || 'execution_error', r.message || `Bước ${key} thất bại`);
      }
      acc = { ...acc, [key]: res.details || {} };
      ctx.acc = acc;
      lastMessage = res.message || lastMessage;
      await setPhase({ completed: chainKeys.slice(0, i + 1), acc });
    }
    return done({ steps: acc, ...(acc[action] || {}) }, lastMessage || `Đã xong hành động nhỏ: ${action}`);
  }

  // ── Chạy tiếp sau điều hướng (4 key cũ, giữ nguyên) ──
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

  const LEGACY_ACTIONS = ['scroll_feed', 'like_first', 'open_notifications', 'open_profile'];
  try {
    const phase = await getPhase();
    if (phase) {
      if (LEGACY_ACTIONS.includes(action)) return await resume(phase);
      if (CHAINS[action]) return await runChain(CHAINS[action]);
      return report('failed', { action, resumed: true }, 'execution_error', `Không khôi phục được hành động: ${action}`);
    }
    switch (action) {
      case 'scroll_feed': return await actScrollFeed();
      case 'like_first': return await actLikeFirst();
      case 'open_notifications': return await actOpenNotifications();
      case 'open_profile': return await actOpenProfile();
      default:
        if (CHAINS[action]) return await runChain(CHAINS[action]);
        return report('failed', { action, error: 'unknown_action' }, 'execution_error',
          `Threads micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `Threads micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
