// Auto vjp — X (Twitter) micro actions (task type 'micro_action', 2.11.17).
// 32 hành động nguyên tử: composer đăng bài, tương tác, affiliate-commenter,
// 4 micro cũ (giữ nguyên key) và adapter nuôi X. Task:
// {platform:'x', type:'micro_action', payload:{action, content?, target_url?, seconds?}}.
// startUrl của kernel mở https://x.com/home. Đọc canonical run trực tiếp,
// báo kết quả bằng action 'microActionDone' (results.js deliver type
// 'micro_action', có details + failure_code).
//
// NGUỒN SỰ THẬT (đã đọc file thật): các file nguồn X KHÔNG export hàm —
// automator.js / interaction.js / affiliate-commenter.js / x-nurture/
// adapter.js đều là script tự chạy theo task-key riêng của chúng. Vì vậy
// handler dưới đây bám ĐÚNG selector + kỹ thuật của từng file nguồn (ghi
// rõ nguồn tại từng bước), không bịa selector mới; hàm dùng chung gọi
// được thật duy nhất là AVJP.nurture.util (nurture-core, contract nạp
// trước micro ở nhánh micro_action của x) — dùng cho normalizeText/
// commentSignature ở các bước verify/nurture. Tên hàm trong brief
// (findReplyAnchor, typeIntoEditor, verifyReplyAppears, collectPostLinks,
// openHome/readTimeline...) KHÔNG tồn tại trong file nguồn X; ánh xạ
// tương đương thật được ghi ở từng handler.
//
// Step-runner: hành động 'context' chạy lần lượt các bước prefix rồi mới
// chạy bước chính; bước prefix hỏng -> failed 'prefix_failed' + details
// .failed_step. Phase lưu storage (avjpMicroPhase_x, {runner:true,
// completed:[...], pendingStep}) chống inject lại sau điều hướng: bước
// gây điều hướng ghi pendingStep TRƯỚC, lượt inject sau chỉ XÁC MINH
// đích (VERIFY) rồi chạy tiếp, không làm lại từ đầu.
// Kỷ luật trung thực: thiếu phần tử đích -> failed 'selector_not_found';
// thiếu payload -> failed 'execution_error' nêu rõ field.
// Mọi cú bấm qua AVJP.human.clickEl (humanmouse.js nạp trước theo
// contract): clickEl trả false thì KHÔNG bấm lại; human vắng mặt mới
// rơi về click DOM thường.
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
  const contentOf = () => {
    const v = payload.content ?? payload.comment_text ?? payload.text ?? run.content ?? '';
    return String(v || '');
  };
  const targetUrlOf = () => {
    let v = String(payload.target_url ?? payload.url ?? run.target_url ?? payload.source_url ?? '');
    if (!v) return '';
    if (v.startsWith('/')) v = 'https://x.com' + v;
    else if (!/^https?:\/\//i.test(v) && /(^|\.)(x\.com|twitter\.com)\//i.test(v)) v = 'https://' + v;
    return v;
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

  // ── Lỗi có mã, mang theo target để runner phân loại ──
  function F(failureCode, target, message) {
    const e = new Error(message || target);
    e.failureCode = failureCode;
    e.target = target;
    return e;
  }
  const selFail = target => F('selector_not_found', target, `Không tìm thấy phần tử đích: ${target}`);

  // ── Helpers dùng chung ──
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();
  // Chuẩn hoá chữ ký: ưu tiên hàm THẬT AVJP.nurture.util.normalizeText /
  // commentSignature (nurture-core); vắng mặt mới dùng bản rút gọn tại chỗ.
  const nurtureUtil = () => (globalThis.AVJP && globalThis.AVJP.nurture && globalThis.AVJP.nurture.util) || null;
  const normalize = s => {
    const u = nurtureUtil();
    if (u && typeof u.normalizeText === 'function') return u.normalizeText(s);
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  };
  const signature = s => {
    const u = nurtureUtil();
    if (u && typeof u.commentSignature === 'function') return u.commentSignature(s);
    return normalize(s).slice(0, 200);
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
  // Luật 2.11.17: có AVJP.human thì tin kết quả clickEl — trả false là
  // KHÔNG bấm lại. Chỉ khi human vắng mặt mới dùng click DOM thường.
  async function humanClick(el) {
    if (!el) return false;
    let human = null;
    try { human = globalThis.AVJP?.human; } catch (_) {}
    if (human && typeof human.clickEl === 'function') {
      try { return Boolean(await human.clickEl(el)); } catch (_) { return false; }
    }
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
  async function clickOrThrow(el, target) {
    const ok = await humanClick(el);
    if (!ok) throw F('execution_error', target, `AVJP.human.clickEl trả false ở đích ${target} — không bấm lại theo luật`);
    return true;
  }

  // ── Bộ chọn riêng X (bám file nguồn) ──
  const RESERVED_SEGMENTS = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'bookmarks', 'lists', 'communities']);
  const TWEET_SEL = 'article[data-testid="tweet"]';
  function firstArticle() { return document.querySelector(TWEET_SEL + ', article'); }
  function statusLinkOf(root) {
    // x-nurture/adapter.js statusLink(): ưu tiên link chứa <time>.
    const links = [...root.querySelectorAll('a[href*="/status/"]')];
    return links.find(a => a.querySelector('time')) || links[0] || null;
  }
  function statusUrlOf(root) {
    const a = statusLinkOf(root);
    if (a && /\/status\/\d+/.test(a.getAttribute('href') || '')) return a.href.split('?')[0];
    return location.href;
  }
  function postTextOf(root) {
    // x-nurture/adapter.js postText(): [data-testid="tweetText"], dự
    // phòng toàn thân bài; gộp khoảng trắng, cắt 1200 ký tự.
    const el = root.querySelector('[data-testid="tweetText"]');
    const raw = el ? textOf(el) : textOf(root);
    return raw.replace(/\s+/g, ' ').slice(0, 1200);
  }
  // Ô soạn/gõ: automator.js neo div[data-testid="tweetTextarea_0"];
  // interaction.js + affiliate-commenter.js neo chính phần tử đó ở dạng
  // [contenteditable="true"] hoặc div[role="textbox"][contenteditable].
  function findAnyEditor() {
    const els = [...document.querySelectorAll('[data-testid^="tweetTextarea_"][contenteditable="true"], div[role="textbox"][contenteditable="true"]')];
    return els.find(visible) || els[0] || document.querySelector('div[data-testid="tweetTextarea_0"]') || null;
  }
  function findComposerBox() {
    return document.querySelector('div[data-testid="tweetTextarea_0"]') || findAnyEditor();
  }
  function findPostButton() {
    // automator.js: tweetButtonInline trước, tweetButton sau.
    const all = [...document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]')];
    return all.find(visible) || all[0] || null;
  }
  function findSubmitButton() {
    // interaction.js submitReply() + affiliate-commenter.js bước gửi:
    // tweetButton/tweetButtonInline đang hiện, không disabled.
    return [...document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')]
      .find(b => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true') || null;
  }
  const isDisabledBtn = btn => !btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled === true || btn.hasAttribute('disabled');
  // Gõ kiểu automator.js: focus + selectAll + ClipboardEvent 'paste' +
  // execCommand('insertText') dự phòng.
  function typeViaAutomator(box, text) {
    try { box.focus(); } catch (_) {}
    try { document.execCommand('selectAll', false, null); } catch (_) {}
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (_) {}
    try { document.execCommand('insertText', false, text); } catch (_) {}
  }
  // Gõ kiểu interaction.js/affiliate-commenter.js setEditor(): focus,
  // selectNodeContents, selectAll, insertText, InputEvent 'input'.
  function setEditorReal(editor, value) {
    editor.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch (_) {}
    try { document.execCommand('selectAll', false); } catch (_) {}
    try { document.execCommand('insertText', false, value); } catch (_) {}
    try { editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); } catch (_) {}
  }
  // x-nurture/adapter.js signatureInFeed(): tìm chữ ký trong tweetText.
  function signatureInFeed(text, excludeBox) {
    const frag = signature(text).slice(0, 60);
    if (!frag) return null;
    for (const el of document.querySelectorAll('[data-testid="tweetText"]')) {
      if (excludeBox && (el === excludeBox || excludeBox.contains(el))) continue;
      if (normalize(el.textContent || '').includes(frag)) return el;
    }
    return null;
  }
  // x-nurture/adapter.js followState(): testid `<userId>-follow` /
  // `-unfollow`, dự phòng nhãn Follow/Following EN/VI + aria-label.
  const FOLLOW_LABELS = ['Follow', 'Theo dõi'];
  const FOLLOWING_LABELS = ['Following', 'Đang theo dõi'];
  function followState(root) {
    if (!root) return { state: 'none', el: null };
    const specific = [...root.querySelectorAll('button[data-testid$="-follow"], button[data-testid$="-unfollow"]')];
    for (const el of specific) {
      const id = el.getAttribute('data-testid') || '';
      if (/-unfollow$/.test(id)) return { state: 'following', el };
      if (/-follow$/.test(id)) return { state: 'not_following', el };
    }
    const btns = [...root.querySelectorAll('button, [role="button"]')].filter(visible);
    for (const el of btns) {
      const label = (el.getAttribute('aria-label') || '').trim();
      const t = textOf(el);
      if (FOLLOWING_LABELS.some(f => t === f) || /^(Following|Đang theo dõi)\s+@/i.test(label)) return { state: 'following', el };
      if (FOLLOW_LABELS.some(f => t === f) || /^(Follow|Theo dõi)\s+@/i.test(label)) return { state: 'not_following', el };
    }
    return { state: 'none', el: null };
  }
  function byTestId(root, id) {
    // x-nurture/adapter.js byTestId().
    return root ? root.querySelector(`button[data-testid="${id}"], [role="button"][data-testid="${id}"]`) : null;
  }
  function countInfo(btn) {
    // x-nurture/adapter.js countInfo(): đếm trên aria-label/text của nút.
    if (!btn) return null;
    const src = (btn.getAttribute('aria-label') || '') + ' ' + textOf(btn);
    const m = /(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([KMB])?/i.exec(src.replace(/\s+/g, ' '));
    if (!m) return { value: 0, exact: true };
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(v)) return null;
    let exact = !m[2] && !/\.\d/.test(m[1]);
    if (m[2]) {
      const mul = { K: 1000, M: 1000000, B: 1000000000 }[m[2].toUpperCase()] || 1;
      v = Math.round(v * mul);
      exact = false;
    }
    return { value: v, exact };
  }
  function unitKeyOf(root) {
    // x-nurture/adapter.js unitKey(): status id, dự phòng hash tác giả.
    const a = statusLinkOf(root);
    const m = /\/status\/(\d+)/.exec(a?.getAttribute('href') || '');
    if (m) return m[1];
    const author = textOf(root.querySelector('[data-testid="User-Name"]')).slice(0, 60);
    const time = root.querySelector('time')?.getAttribute('datetime') || '';
    const body = textOf(root.querySelector('[data-testid="tweetText"]')).slice(0, 80);
    return 'h_' + normalize(author + '|' + time + '|' + body).replace(/\s+/g, '_').slice(0, 60);
  }
  function findUnits() {
    // x-nurture/adapter.js findUnits(): article hiện + có nút
    // like/unlike/reply, khử trùng theo key.
    const units = [];
    const seenEl = new Set();
    const seenKey = new Set();
    document.querySelectorAll(TWEET_SEL).forEach(el => {
      if (!visible(el) || seenEl.has(el)) return;
      if (!byTestId(el, 'like') && !byTestId(el, 'unlike') && !byTestId(el, 'reply')) return;
      const key = unitKeyOf(el);
      if (seenKey.has(key)) return;
      seenEl.add(el); seenKey.add(key);
      units.push({ el, key, url: statusUrlOf(el) });
    });
    return units;
  }
  function existingReplyTexts(root) {
    // x-nurture/adapter.js existingReplyTexts().
    const out = [];
    root.querySelectorAll('[data-testid="tweetText"]').forEach(el => {
      const t = textOf(el);
      if (t.length > 1) out.push(t);
    });
    return out.slice(0, 5);
  }
  // Like trên 1 article — selector interaction.js (nút like trong
  // article) + proof lật unlike của x-nurture/adapter.js doLike().
  async function likeArticle(article, targetName) {
    if (!article) throw selFail(targetName || 'post_article');
    if (article.querySelector('[data-testid="unlike"]')) return { liked: true, already: true };
    const btn = article.querySelector('[data-testid="like"]');
    if (!btn) throw selFail('like_button');
    await clickOrThrow(btn, 'like_button');
    const verified = await waitFor(() => {
      const cur = document.contains(article) ? article : firstArticle();
      return cur && cur.querySelector('[data-testid="unlike"]') ? true : null;
    }, 3000);
    return { liked: true, verified: Boolean(verified) };
  }
  // Mở bài theo URL đích (dùng chung open_post_from_url /
  // affiliate_open_link — affiliate-commenter.js mở bài đích rồi thao
  // tác trên article của nó; hàm openPostFromLink không tồn tại).
  async function openTargetPost(ctx, stepKey) {
    const url = targetUrlOf();
    if (!url) throw F('execution_error', 'payload.target_url', 'Thiếu payload.target_url');
    let parsed = null;
    try { parsed = new URL(url); } catch (_) { throw F('execution_error', 'payload.target_url', 'payload.target_url không phải URL hợp lệ'); }
    if (!/(^|\.)(x\.com|twitter\.com)$/i.test(parsed.hostname)) {
      throw F('execution_error', 'payload.target_url', 'payload.target_url không thuộc x.com/twitter.com');
    }
    if (location.pathname === parsed.pathname) {
      const a = await waitFor(firstArticle, 12000);
      if (a) return { opened: true, already: true, url: location.href };
      throw selFail('post_article');
    }
    await ctx.savePhase(stepKey);
    try { location.assign(parsed.href); } catch (_) {}
    const a = await waitFor(() => location.pathname === parsed.pathname ? firstArticle() : null, 10000);
    if (!a) throw selFail('post_article');
    return { opened: true, url: location.href };
  }
  async function openHomeStep(ctx, stepKey) {
    // automator/adapter nuôi đều neo trang chủ https://x.com/home.
    if (location.pathname === '/home') {
      const a = await waitFor(firstArticle, 12000);
      if (a) return { opened: true, already: true, url: location.href };
      throw selFail('home_timeline');
    }
    await ctx.savePhase(stepKey);
    try { location.assign('https://x.com/home'); } catch (_) {}
    const a = await waitFor(() => location.pathname === '/home' ? firstArticle() : null, 10000);
    if (!a) throw selFail('home_timeline');
    return { opened: true, url: location.href };
  }

  // ── Ngữ cảnh chạy bước ──
  function makeCtx(completedArr) {
    const completed = new Set(completedArr || []);
    return {
      completed,
      content: contentOf,
      targetUrl: targetUrlOf,
      savePhase: async pendingStep => {
        await setPhase({ runner: true, completed: [...completed], pendingStep: pendingStep || null });
      }
    };
  }

  // ══ STEPS — 32 hành động nguyên tử ══
  const STEPS = {
    // ── Composer (nguồn automator.js) ──
    async open_home(ctx) { return openHomeStep(ctx, 'open_home'); },

    async open_composer(ctx) {
      // automator.js chạy ở /compose/post và neo tweetTextarea_0; trên
      // /home ô soạn nằm sẵn ở đầu timeline, nút soạn là
      // SideNav_NewTweet_Button / link /compose/post.
      const ed = findAnyEditor();
      if (ed) return { composer: true, already: true };
      const btn = document.querySelector('[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]');
      if (btn) {
        await ctx.savePhase('open_composer');
        await clickOrThrow(btn, 'composer_button');
        const got = await waitFor(findAnyEditor, 8000);
        if (got) return { composer: true, clicked: true };
      }
      await ctx.savePhase('open_composer');
      try { location.assign('https://x.com/compose/post'); } catch (_) {}
      const got2 = await waitFor(findAnyEditor, 10000);
      if (!got2) throw selFail('composer_textarea');
      return { composer: true, navigated: true };
    },

    async focus_editor() {
      // automator.js: composer.focus() trước khi gõ.
      const ed = await waitFor(findAnyEditor, 10000);
      if (!ed) throw selFail('composer_editor');
      try { ed.focus(); } catch (_) {}
      await sleep(300);
      const active = document.activeElement;
      return { focused: true, active: Boolean(active && (active === ed || ed.contains(active))) };
    },

    async type_post_text(ctx) {
      const content = ctx.content();
      if (!content) throw F('execution_error', 'payload.content', 'Thiếu payload.content để gõ nội dung bài');
      const box = await waitFor(findComposerBox, 10000);
      if (!box) throw selFail('composer_textarea');
      try { box.focus(); } catch (_) {}
      await sleep(400);
      typeViaAutomator(box, content);
      await sleep(900);
      const cur = normalize(textOf(box));
      if (!cur.includes(normalize(content).slice(0, 20))) {
        throw F('execution_error', 'composer_text', 'Đã gõ nhưng nội dung không xuất hiện trong ô soạn');
      }
      return { typed: true, length: content.length };
    },

    async click_post_button() {
      // automator.js bước 4: chờ nút Post hết disabled (tối đa vài vòng)
      // rồi bấm tweetButtonInline/tweetButton.
      let btn = await waitFor(findPostButton, 10000);
      if (!btn) throw selFail('post_button');
      let tries = 0;
      while (isDisabledBtn(btn) && tries < 4) {
        await sleep(2000);
        btn = findPostButton() || btn;
        tries++;
      }
      await clickOrThrow(btn, 'post_button');
      await sleep(1500);
      return { clicked: true, waited_enable_rounds: tries };
    },

    async verify_post_appears(ctx) {
      // automator.js KHÔNG có hàm verify riêng: nó chờ 8s rồi lấy actor
      // từ AppTabBar_Profile_Link. Kiểm chứng ở đây = bài (theo nội
      // dung) xuất hiện trong timeline, dự phòng: ô soạn đã trống +
      // link hồ sơ actor tồn tại (đúng dấu vết automator để lại).
      const content = ctx.content();
      const needle = content ? normalize(content).slice(0, 40) : '';
      if (needle) {
        const found = await waitFor(() => {
          for (const a of document.querySelectorAll(TWEET_SEL)) {
            const t = a.querySelector('[data-testid="tweetText"]');
            if (t && normalize(t.textContent || '').includes(needle)) return a;
          }
          return null;
        }, 9000);
        if (found) return { verified: true, method: 'timeline_text', post_url: statusUrlOf(found) };
      }
      const ed = findAnyEditor();
      const empty = Boolean(ed) && normalize(textOf(ed)).length === 0;
      const actor = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (empty && actor) {
        return { verified: true, method: 'composer_cleared', actor: actor.getAttribute('href') || '' };
      }
      throw selFail('posted_tweet');
    },

    async open_post_from_url(ctx) { return openTargetPost(ctx, 'open_post_from_url'); },

    async open_reply_box() {
      // interaction.js/affiliate-commenter.js: bấm [data-testid="reply"]
      // trong article rồi chờ editor. Ở trang /status/ ô trả lời inline
      // đã hiện sẵn thì coi như đã mở. (findReplyAnchor không tồn tại.)
      const art = await waitFor(firstArticle, 10000);
      if (!art) throw selFail('post_article');
      const ed0 = findAnyEditor();
      if (ed0) return { reply_box: true, already: true };
      const btn = art.querySelector('[data-testid="reply"]');
      if (!btn) throw selFail('reply_button');
      await clickOrThrow(btn, 'reply_button');
      const ed = await waitFor(findAnyEditor, 8000);
      if (!ed) throw selFail('reply_editor');
      return { reply_box: true, clicked: true };
    },

    async type_reply_text(ctx) {
      // interaction.js setEditor() (typeIntoEditor không tồn tại).
      const content = ctx.content();
      if (!content) throw F('execution_error', 'payload.content', 'Thiếu payload.content để gõ trả lời');
      const ed = await waitFor(findAnyEditor, 10000);
      if (!ed) throw selFail('reply_editor');
      setEditorReal(ed, content);
      await sleep(600);
      if (!normalize(textOf(ed)).includes(normalize(content).slice(0, 20))) {
        throw F('execution_error', 'reply_text', 'Đã gõ nhưng nội dung không có trong ô trả lời');
      }
      return { typed: true, length: content.length };
    },

    async submit_reply() {
      // interaction.js submitReply(): findSubmitButton + bấm + chờ,
      // ở đây kèm xác minh editor đã trống/đóng.
      const btn = await waitFor(findSubmitButton, 10000);
      if (!btn) throw selFail('reply_submit_button');
      await clickOrThrow(btn, 'reply_submit_button');
      await sleep(1200);
      const ed = findAnyEditor();
      const cleared = !ed || normalize(textOf(ed)).length === 0;
      return { submitted: true, verified: cleared };
    },

    async verify_reply(ctx) {
      // verifyReplyAppears không tồn tại; tương đương thật là
      // x-nurture/adapter.js signatureInFeed() trên tweetText.
      const content = ctx.content();
      if (!content) throw F('execution_error', 'payload.content', 'Thiếu payload.content để kiểm chứng trả lời');
      const hit = await waitFor(() => signatureInFeed(content, null), 10000);
      if (!hit) throw selFail('reply_text');
      return { verified: true, text: textOf(hit).slice(0, 300) };
    },

    // ── Tương tác (nguồn interaction.js) ──
    async like_post() {
      const art = await waitFor(firstArticle, 12000);
      if (!art) throw selFail('post_article');
      return likeArticle(art, 'post_article');
    },

    async follow_author() {
      // interaction.js KHÔNG có follow; logic follow thật nằm ở
      // x-nurture/adapter.js followState()/doFollow() — dùng đúng nó.
      const art = await waitFor(firstArticle, 12000);
      if (!art) throw selFail('post_article');
      const st = followState(art);
      if (st.state === 'following') return { followed: true, already: true };
      if (st.state !== 'not_following' || !st.el) throw selFail('follow_button');
      await clickOrThrow(st.el, 'follow_button');
      const proof = await waitFor(() => {
        const cur = document.contains(art) ? art : firstArticle();
        return cur && followState(cur).state === 'following' ? true : null;
      }, 3000);
      return { followed: true, verified: Boolean(proof) };
    },

    async read_post_text() {
      // findPostText không tồn tại; tương đương thật: adapter postText().
      const art = await waitFor(firstArticle, 12000);
      if (!art) throw selFail('post_article');
      const t = postTextOf(art);
      if (!t) throw selFail('post_text');
      return { text: t, length: t.length, url: statusUrlOf(art) };
    },

    // ── Affiliate-commenter (nguồn affiliate-commenter.js) ──
    async affiliate_collect_links(ctx) {
      // collectPostLinks không tồn tại; affiliate-commenter.js thật
      // quét article[data-testid="tweet"] hiện + a[href*="/status/"],
      // cuộn tối đa 5 lượt x 500px. payload.profile_url/search_url/
      // source_url (hoặc run.source_url) là nguồn thu thập nếu có.
      const src = String(payload.profile_url || payload.search_url || payload.source_url || run.source_url || '');
      if (src) {
        try {
          const u = new URL(src, location.href);
          if (u.pathname !== location.pathname) {
            await ctx.savePhase('affiliate_collect_links');
            location.assign(u.href);
            await waitFor(firstArticle, 10000);
          }
        } catch (_) {}
      }
      const limit = Math.min(50, Math.max(1, Number(payload.limit) || 10));
      const links = new Set();
      for (let attempt = 0; attempt < 5; attempt++) {
        document.querySelectorAll(TWEET_SEL).forEach(a => {
          if (!visible(a)) return;
          const l = [...a.querySelectorAll('a[href*="/status/"]')].find(visible);
          if (l) links.add(l.href.split('?')[0]);
        });
        if (links.size >= limit) break;
        window.scrollBy({ top: 500 });
        await sleep(1500);
      }
      if (!links.size) throw selFail('affiliate_post_links');
      return { count: links.size, links: [...links].slice(0, 50) };
    },

    async affiliate_open_link(ctx) { return openTargetPost(ctx, 'affiliate_open_link'); },

    async affiliate_like_comment_target() {
      // affiliate-commenter.js không tự like; đích like trong luồng
      // affiliate dùng đúng selector like của interaction.js trên
      // article đích (ghi rõ lệch nguồn ở báo cáo lane).
      const art = await waitFor(firstArticle, 12000);
      if (!art) throw selFail('post_article');
      const r = await likeArticle(art, 'post_article');
      return { ...r, affiliate: true };
    },

    async affiliate_extract_text() {
      // extractPostText không tồn tại; affiliate-commenter.js đọc
      // art.innerText, adapter postText() đọc tweetText — dùng cả hai
      // theo thứ tự adapter trước, innerText dự phòng.
      const art = await waitFor(firstArticle, 12000);
      if (!art) throw selFail('post_article');
      const t = postTextOf(art);
      if (!t) throw selFail('post_text');
      return { text: t, length: t.length, url: statusUrlOf(art), affiliate: true };
    },

    async affiliate_type_comment(ctx) {
      // affiliate-commenter.js bước 4: setEditor(editor, commentText)
      // vào editor trả lời. Nội dung: payload.content/comment_text.
      const content = ctx.content();
      if (!content) throw F('execution_error', 'payload.content', 'Thiếu payload.content/comment_text để gõ bình luận affiliate');
      const ed = await waitFor(findAnyEditor, 10000);
      if (!ed) throw selFail('reply_editor');
      setEditorReal(ed, content);
      await sleep(600);
      if (!normalize(textOf(ed)).includes(normalize(content).slice(0, 20))) {
        throw F('execution_error', 'comment_text', 'Đã gõ nhưng bình luận không có trong ô trả lời');
      }
      return { typed: true, length: content.length, affiliate: true };
    },

    async affiliate_submit_comment() {
      // affiliate-commenter.js bước 4: find sendBtn
      // (tweetButton/tweetButtonInline, hiện + enabled) -> bấm -> chờ
      // 2s -> xác minh editor trống/dialog đóng.
      const btn = await waitFor(findSubmitButton, 10000);
      if (!btn) throw selFail('comment_submit_button');
      await clickOrThrow(btn, 'comment_submit_button');
      await sleep(2000);
      const ed = findAnyEditor();
      const cleared = !ed || normalize(textOf(ed)).length === 0;
      return { submitted: true, verified: cleared, affiliate: true };
    },

    // ── Micro cũ (giữ nguyên 4 key + hành vi 2.11.16) ──
    async scroll_feed() {
      const secs = secondsOr(30);
      const end = Date.now() + secs * 1000;
      let ticks = 0, totalPx = 0;
      while (Date.now() < end) {
        const dy = Math.round(rand(300, 750));
        await humanScrollBy(dy);
        totalPx += dy; ticks++;
        await sleep(Math.min(rand(700, 2000), Math.max(0, end - Date.now())));
      }
      return { seconds: secs, ticks, scrolled_px: totalPx };
    },

    async like_first() {
      const article = await waitFor(firstArticle, 15000);
      if (!article) throw selFail('first_tweet_article');
      if (article.querySelector('[data-testid="unlike"]')) return { liked: true, already: true };
      const likeBtn = await waitFor(() => article.querySelector('[data-testid="like"]'), 8000);
      if (!likeBtn) throw selFail('first_tweet_like_button');
      await clickOrThrow(likeBtn, 'first_tweet_like_button');
      const verified = await waitFor(() => article.querySelector('[data-testid="unlike"]') ? true : null, 3000);
      return { liked: true, verified: Boolean(verified) };
    },

    async open_notifications(ctx) {
      await ctx.savePhase('open_notifications');
      const link = await waitFor(() => {
        const a = document.querySelector('header a[href="/notifications"], nav a[href="/notifications"], a[href="/notifications"]');
        return a && visible(a) ? a : null;
      }, 10000);
      if (link) await humanClick(link);
      else location.assign('https://x.com/notifications');
      const ok = await waitFor(() => location.pathname.startsWith('/notifications') ? true : null, 6000);
      if (!ok) throw selFail('notifications_page');
      return { opened: true };
    },

    async open_profile(ctx) {
      const link = await waitFor(() => {
        const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        return a && visible(a) ? a : null;
      }, 12000);
      if (!link) throw selFail('own_profile_link');
      const href = link.getAttribute('href') || '';
      const handle = href.replace(/^\//, '').replace(/\/$/, '');
      await ctx.savePhase('open_profile');
      await humanClick(link);
      const ok = await waitFor(() => {
        const seg = /^\/([A-Za-z0-9_]+)\/?$/.exec(location.pathname);
        return seg && !RESERVED_SEGMENTS.has(seg[1].toLowerCase()) ? true : null;
      }, 6000);
      if (!ok) throw selFail('profile_page');
      return { opened: true, username: location.pathname.replace(/\//g, ''), handle_hint: handle || null };
    },

    // ── Nurture adapter (nguồn modules/x-nurture/adapter.js) ──
    async nurture_open_home(ctx) {
      const r = await openHomeStep(ctx, 'nurture_open_home');
      return { ...r, nurture: true };
    },

    async nurture_read_timeline() {
      // adapter readTimeline không tồn tại; tương đương thật là
      // findUnits() + postText() — CHỈ ĐỌC.
      const units = findUnits();
      if (!units.length) throw selFail('timeline_units');
      return {
        nurture: true, count: units.length,
        sample: units.slice(0, 3).map(u => ({ key: u.key, url: u.url, text: postTextOf(u.el).slice(0, 200) }))
      };
    },

    async nurture_open_first_post(ctx) {
      // adapter không mở bài (nuôi ngay trên Home); bước nguyên tử này
      // bấm statusLink (link chứa <time>) của unit đầu — selector thật
      // của adapter statusLink().
      const units = findUnits();
      if (!units.length) throw selFail('timeline_first_post');
      const u = units[0];
      const link = statusLinkOf(u.el);
      if (!link) throw selFail('first_post_link');
      await ctx.savePhase('nurture_open_first_post');
      await clickOrThrow(link, 'first_post_link');
      const ok = await waitFor(() => /\/status\/\d+/.test(location.pathname) ? firstArticle() : null, 8000);
      if (!ok) throw selFail('first_post_page');
      return { nurture: true, opened: true, url: location.href, key: u.key };
    },

    async nurture_perform_like() {
      // adapter doLike() trên unit đầu (proof lật like->unlike).
      const units = findUnits();
      if (!units.length) throw selFail('timeline_first_post');
      const r = await likeArticle(units[0].el, 'timeline_first_post');
      return { ...r, nurture: true, key: units[0].key, url: units[0].url };
    },

    async nurture_perform_follow() {
      // adapter doFollow(): unit đầu tiên có nút Follow chưa theo dõi.
      const units = findUnits();
      if (!units.length) throw selFail('timeline_units');
      for (const u of units) {
        const st = followState(u.el);
        if (st.state === 'following') return { nurture: true, followed: true, already: true, key: u.key, url: u.url };
        if (st.state === 'not_following' && st.el) {
          await clickOrThrow(st.el, 'nurture_follow_button');
          const proof = await waitFor(() => followState(u.el).state === 'following' ? true : null, 3000);
          return { nurture: true, followed: true, verified: Boolean(proof), key: u.key, url: u.url };
        }
      }
      throw selFail('nurture_follow_button');
    },

    async nurture_verify_post_text(ctx) {
      // verifyText không tồn tại; tương đương: adapter postText() trên
      // unit đầu + so khớp payload.content/expected_text nếu có.
      const units = findUnits();
      const art = units.length ? units[0].el : await waitFor(firstArticle, 10000);
      if (!art) throw selFail('nurture_post_article');
      const t = postTextOf(art);
      if (!t) throw selFail('nurture_post_text');
      const expect = String(payload.expected_text || '') || ctx.content();
      if (expect) {
        const match = normalize(t).includes(normalize(expect).slice(0, 30));
        if (!match) {
          throw F('execution_error', 'nurture_post_text', 'Text bài không khớp nội dung kỳ vọng');
        }
        return { nurture: true, text: t, verified: true };
      }
      return { nurture: true, text: t, verified: true };
    },

    async nurture_build_context() {
      // buildPostContext không tồn tại; ngữ cảnh dựng từ đúng các
      // thành phần adapter có: postText, existingReplyTexts, unitKey,
      // unitUrl, User-Name, time, countInfo — CHỈ ĐỌC.
      const units = findUnits();
      if (!units.length) throw selFail('timeline_units');
      const u = units[0];
      const root = u.el;
      const t = postTextOf(root);
      const author = textOf(root.querySelector('[data-testid="User-Name"]')).slice(0, 120);
      const time = root.querySelector('time')?.getAttribute('datetime') || null;
      return {
        nurture: true, key: u.key, url: u.url, author, time,
        text: t, existing_replies: existingReplyTexts(root),
        counts: {
          reply: countInfo(byTestId(root, 'reply')),
          like: countInfo(byTestId(root, 'like') || byTestId(root, 'unlike'))
        },
        context_summary: `Bài ${u.key} của ${author || '?'}: ${t.slice(0, 120)}`
      };
    },

    async nurture_interact_first() {
      // interactWithFirstPost không tồn tại; tương đương thật là
      // processUnit() rút gọn cho unit đầu: scroll tới + dwell ngắn +
      // doLike() (bản micro chạy xác định bằng like, không tung xúc
      // xắc phần trăm như phiên nuôi).
      const units = findUnits();
      if (!units.length) throw selFail('timeline_first_post');
      const u = units[0];
      try { u.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      await sleep(1200);
      const r = await likeArticle(u.el, 'timeline_first_post');
      return { nurture: true, interacted: 'like', ...r, key: u.key, url: u.url };
    }
  };

  // ══ REGISTRY — 32 hành động ══
  const REGISTRY = {
    open_home: { needs: 'standalone', label: 'Mở trang chủ X' },
    open_composer: { needs: 'standalone', label: 'Mở hộp soạn bài' },
    focus_editor: { needs: 'context', prefix: ['open_composer'], label: 'Focus ô soạn' },
    type_post_text: { needs: 'context', prefix: ['open_composer', 'focus_editor'], label: 'Gõ nội dung bài đăng' },
    click_post_button: { needs: 'context', prefix: ['open_composer', 'focus_editor', 'type_post_text'], label: 'Bấm nút Đăng bài' },
    verify_post_appears: { needs: 'context', prefix: ['open_composer', 'focus_editor', 'type_post_text', 'click_post_button'], label: 'Kiểm chứng bài đã đăng' },
    open_post_from_url: { needs: 'standalone', label: 'Mở bài theo URL' },
    open_reply_box: { needs: 'context', prefix: ['open_post_from_url'], label: 'Mở ô trả lời' },
    type_reply_text: { needs: 'context', prefix: ['open_post_from_url', 'open_reply_box'], label: 'Gõ nội dung trả lời' },
    submit_reply: { needs: 'context', prefix: ['open_post_from_url', 'open_reply_box', 'type_reply_text'], label: 'Gửi trả lời' },
    verify_reply: { needs: 'context', prefix: ['open_post_from_url', 'open_reply_box', 'type_reply_text', 'submit_reply'], label: 'Kiểm chứng trả lời đã hiện' },
    like_post: { needs: 'context', prefix: ['open_post_from_url'], label: 'Thả tim bài viết' },
    follow_author: { needs: 'context', prefix: ['open_post_from_url'], label: 'Theo dõi tác giả' },
    read_post_text: { needs: 'context', prefix: ['open_post_from_url'], label: 'Đọc nội dung bài viết' },
    affiliate_collect_links: { needs: 'standalone', label: 'Thu thập link bài (affiliate)' },
    affiliate_open_link: { needs: 'standalone', label: 'Mở 1 link bài affiliate' },
    affiliate_like_comment_target: { needs: 'context', prefix: ['open_post_from_url'], label: 'Thả tim bài đích affiliate' },
    affiliate_extract_text: { needs: 'context', prefix: ['open_post_from_url'], label: 'Trích text bài (affiliate)' },
    affiliate_type_comment: { needs: 'context', prefix: ['open_post_from_url', 'open_reply_box'], label: 'Gõ bình luận affiliate' },
    affiliate_submit_comment: { needs: 'context', prefix: ['open_post_from_url', 'open_reply_box', 'affiliate_type_comment'], label: 'Gửi bình luận affiliate' },
    scroll_feed: { needs: 'standalone', label: 'Lướt dòng thời gian' },
    like_first: { needs: 'standalone', label: 'Thả tim bài đầu tiên' },
    open_notifications: { needs: 'standalone', label: 'Mở thông báo' },
    open_profile: { needs: 'standalone', label: 'Mở hồ sơ của mình' },
    nurture_open_home: { needs: 'standalone', label: 'Nuôi: mở trang chủ' },
    nurture_read_timeline: { needs: 'standalone', label: 'Nuôi: đọc timeline' },
    nurture_open_first_post: { needs: 'standalone', label: 'Nuôi: mở bài đầu tiên' },
    nurture_perform_like: { needs: 'standalone', label: 'Nuôi: thả tim bài đầu' },
    nurture_perform_follow: { needs: 'standalone', label: 'Nuôi: theo dõi tác giả bài đầu' },
    nurture_verify_post_text: { needs: 'standalone', label: 'Nuôi: kiểm chứng text bài' },
    nurture_build_context: { needs: 'standalone', label: 'Nuôi: dựng ngữ cảnh bài' },
    nurture_interact_first: { needs: 'standalone', label: 'Nuôi: tương tác bài đầu tiên' }
  };

  // ── Xác minh đích sau điều hướng (chỉ cho bước có pendingStep) ──
  const VERIFY = {
    open_home: async () => Boolean(await waitFor(() => location.pathname === '/home' ? firstArticle() : null, 6000)),
    nurture_open_home: async () => Boolean(await waitFor(() => location.pathname === '/home' ? firstArticle() : null, 6000)),
    open_composer: async () => Boolean(await waitFor(findAnyEditor, 6000)),
    open_post_from_url: async () => {
      const u = targetUrlOf();
      if (!u) return false;
      try { return new URL(u).pathname === location.pathname && Boolean(await waitFor(firstArticle, 6000)); }
      catch (_) { return false; }
    },
    affiliate_open_link: async () => VERIFY.open_post_from_url(),
    affiliate_collect_links: async () => Boolean(await waitFor(firstArticle, 6000)),
    nurture_open_first_post: async () => Boolean(await waitFor(() => /\/status\/\d+/.test(location.pathname) ? firstArticle() : null, 6000)),
    open_notifications: async () => location.pathname.startsWith('/notifications'),
    open_profile: async () => {
      const seg = /^\/([A-Za-z0-9_]+)\/?$/.exec(location.pathname);
      return Boolean(seg && !RESERVED_SEGMENTS.has(seg[1].toLowerCase()));
    }
  };

  // ── Step-runner: prefix lần lượt -> bước chính; prefix hỏng =
  // 'prefix_failed' + failed_step. ──
  async function executeAction(startCompleted, seedDetails) {
    const def = REGISTRY[action];
    if (!def || typeof STEPS[action] !== 'function') {
      return report('failed', { action, error: 'unknown_action' }, 'execution_error',
        `X micro: hành động không hỗ trợ: ${action || '(trống)'}`);
    }
    const ctx = makeCtx(startCompleted);
    const steps = [...(def.prefix || []), action];
    let merged = { ...(seedDetails || {}) };
    for (const stepKey of steps) {
      if (ctx.completed.has(stepKey)) continue;
      const isPrefix = stepKey !== action;
      try {
        const d = await STEPS[stepKey](ctx);
        merged = { ...merged, ...(d || {}) };
        ctx.completed.add(stepKey);
        await setPhase({ runner: true, completed: [...ctx.completed], pendingStep: null });
      } catch (e) {
        if (isPrefix) {
          return report('failed',
            { action, failed_step: stepKey, completed: [...ctx.completed], target: e?.target || stepKey, error: String(e?.message || e) },
            'prefix_failed',
            `Bước tiền tố '${stepKey}' thất bại: ${e?.message || e}`);
        }
        return report('failed',
          { action, target: e?.target || stepKey, error: String(e?.message || e), ...merged },
          e?.failureCode || 'execution_error',
          e?.message || `Hành động ${action} thất bại`);
      }
    }
    return done(merged);
  }

  // ── Chạy tiếp kiểu cũ (phase 2.11.16 của 4 key cũ, không có cờ
  // runner): chỉ xác minh đích, không bấm lại. ──
  const OLD_KEYS = ['scroll_feed', 'like_first', 'open_notifications', 'open_profile'];
  async function resumeLegacy() {
    const ctx = makeCtx([]);
    try {
      switch (action) {
        case 'scroll_feed':
          return done({ resumed: true }, 'Đã lướt feed (lượt chạy tiếp sau điều hướng)');
        case 'like_first': {
          const article = await waitFor(firstArticle, 8000);
          if (article && article.querySelector('[data-testid="unlike"]')) {
            return done({ liked: true, already: true, resumed: true }, 'Bài đầu đã được thích (xác minh ở lượt tiếp)');
          }
          const d = await STEPS.like_first(ctx);
          return done({ ...d, resumed: true });
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
    } catch (e) {
      return failSelector(e?.target || action, { resumed: true });
    }
  }

  try {
    const phase = await getPhase();
    if (phase && phase.runner) {
      const completed = Array.isArray(phase.completed) ? [...phase.completed] : [];
      const pending = phase.pendingStep || null;
      if (pending && !completed.includes(pending)) {
        let ok = false;
        try { ok = VERIFY[pending] ? await VERIFY[pending]() : false; } catch (_) {}
        if (ok) {
          completed.push(pending);
        } else if (pending === action) {
          return report('failed', { action, target: pending, resumed: true }, 'selector_not_found',
            `Không tới được đích sau điều hướng: ${pending}`);
        } else {
          return report('failed', { action, failed_step: pending, completed, resumed: true }, 'prefix_failed',
            `Bước tiền tố '${pending}' không hoàn tất sau điều hướng`);
        }
      }
      return await executeAction(completed, { resumed: true });
    }
    if (phase && OLD_KEYS.includes(action)) return await resumeLegacy();
    return await executeAction([], {});
  } catch (err) {
    report('failed', { action, error: String(err?.message || err) }, 'execution_error',
      `X micro lỗi: ${err?.message || err}`);
  }
})().catch(() => {});
}
