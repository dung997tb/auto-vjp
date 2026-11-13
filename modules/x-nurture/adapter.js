/* Auto vjp — modules/x-nurture/adapter.js (2.4.0, viết mới).
 * Adapter nuôi X (Twitter): bề mặt (selector/phân loại/proof) cắm vào lõi
 * nuôi dùng chung modules/nurture-core (cơ chế quản lý + đồng bộ dữ liệu
 * phỏng bản gốc FB Auto Tool friendReengage/friendWarm — storage.sync cho
 * cấu hình, storage.local họ <prefix>Active/RunId/History/Dead/Status...
 * cho state). Khuôn theo modules/threads-nurture/adapter.js (lát 2).
 *
 * Luồng: canonical task {platform:'x', type:'nurture'} -> cấu hình
 * (sync + payload) -> persist run TRƯỚC khi cuộn/nắn -> lướt HOME timeline
 * (https://x.com/home): dwell -> like/bookmark/follow (proof = data-testid
 * hoặc trạng thái nút lật) -> reply AI qua lõi (composer của X; proof =
 * reply/chữ ký hiện thật, hoặc dialog đóng + số reply tăng; không proof =
 * uncertain, KHÔNG gửi lại) -> nurtureProgress/nurtureDone về kernel.
 *
 * Ánh xạ hành động vào lõi dùng chung: bookmark của X dùng kênh `save`
 * (SaveHistory/DoneSave/counters.save) vì bookmark chính là lưu bài; journal
 * ghi rõ note bookmark để trang quản lý về sau diễn giải đúng.
 *
 * Kỷ luật: login wall/onboarding/checkpoint/captcha -> dừng failed
 * session_expired ngay, không lách, không tự giải, không bấm mù. Profile
 * công nhân hiện CHƯA đăng nhập X nên hành vi kỳ vọng khi test lần đầu là
 * failed sạch bằng cổng này. Click chỉ bằng .click() trên phần tử DOM
 * (không tọa độ). Worker không kiểm tra giờ hoạt động (tầng điều phối lo).
 *
 * ĐIỂM RỦI RO SELECTOR: X dùng data-testid tương đối ổn định cho action bar
 * (like/unlike/reply/retweet/bookmark/removeBookmark) nhưng vẫn đổi DOM/
 * testid theo đợt rollout — chi tiết + rủi ro còn lại ở MODULE.md §5.
 */
(() => {
  if (window.__avjpXNurtureLoaded) return;
  window.__avjpXNurtureLoaded = true;

  const CANONICAL_KEY = 'currentAutomationRun';
  const PLATFORM = 'x';
  const PREFIX = 'xNurture';
  const { sleep, rnd, clampInt, normalizeText, commentSignature, isNearDuplicate } =
    globalThis.AVJP.nurture.util;

  // ---- Nhãn X (song ngữ EN/VI) cho các đường dự phòng ngoài data-testid.
  // data-testid là neo chính; object này chỉ gánh promoted/follow/composer
  // khi testid thiếu hoặc bị đổi tên. ----
  const L = {
    promoted: ['Promoted', 'Quảng cáo', 'Được quảng bá', 'Ad'],
    follow: ['Follow', 'Theo dõi'], following: ['Following', 'Đang theo dõi'],
    yourPostSent: ['Your post was sent', 'Bài đăng của bạn đã được gửi', 'Your reply was sent']
  };
  const TWEET_SEL = 'article[data-testid="tweet"]';

  // visible() đo rect + computed style (kiểu Threads): offsetParent mù với
  // dialog position:fixed của composer X nên không dùng được ở đây.
  const visible = el => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();
  const byTestId = (root, id) => root
    ? root.querySelector(`button[data-testid="${id}"], [role="button"][data-testid="${id}"]`)
    : null;

  function detectBlock() {
    const url = location.href;
    if (/\/i\/flow\/(login|signup)|\/i\/jf\/onboarding|\/login(\b|\/|\?)/i.test(url)) {
      return 'Chưa đăng nhập X (trang login/onboarding)';
    }
    if (/\/account\/access/i.test(url)) return 'Tài khoản X bị khoá/tạm dừng (account access)';
    if (document.querySelector('iframe[src*="arkoselabs"], iframe[src*="recaptcha"], [data-testid="arkose-container"]')) {
      return 'X hiện captcha/Arkose — dừng phiên, không tự giải';
    }
    if (document.querySelector('input[type="password"]')
      && document.querySelector('input[autocomplete="username"], input[name="text"][autocomplete="username"]')) {
      return 'Chưa đăng nhập X (form login)';
    }
    const head = (document.body?.innerText || '').slice(0, 3000);
    if (/your account has been locked|account.*temporarily locked|verify your identity|confirm your identity|unusual activity|suspicious activity|tài khoản.*(bị khoá|tạm khoá)|xác minh danh tính|hoạt động bất thường/i.test(head)) {
      return 'X yêu cầu xác minh danh tính hoặc tài khoản bị khoá';
    }
    // Màn hình marketing khi chưa đăng nhập: có lời mời đăng nhập và không
    // có bất kỳ tweet nào để nuôi.
    if (!document.querySelector(TWEET_SEL)
      && /happening now|join today|sign in to x|log in to x|đang diễn ra|tham gia ngay|đăng nhập vào x/i.test(head)) {
      return 'Chưa đăng nhập X (màn hình giới thiệu)';
    }
    return null;
  }

  // ---- Đơn vị tương tác: 1 tweet trên Home timeline. Neo:
  // article[data-testid="tweet"]; key = status id trong link timestamp
  // (link chứa <time> là link trạng thái của chính tweet, tránh link của
  // tweet được quote). Thiếu status id thì hash tác giả+time+nội dung. ----
  function statusLink(root) {
    const links = [...root.querySelectorAll('a[href*="/status/"]')];
    return links.find(a => a.querySelector('time')) || links[0] || null;
  }
  function statusIdOf(root) {
    const a = statusLink(root);
    const m = /\/status\/(\d+)/.exec(a?.getAttribute('href') || '');
    return m ? m[1] : null;
  }
  function unitKey(root) {
    const id = statusIdOf(root);
    if (id) return id;
    const author = textOf(root.querySelector('[data-testid="User-Name"]')).slice(0, 60);
    const time = root.querySelector('time')?.getAttribute('datetime') || '';
    const body = textOf(root.querySelector('[data-testid="tweetText"]')).slice(0, 80);
    const sig = normalizeText(author + '|' + time + '|' + body);
    return 'h_' + sig.replace(/\s+/g, '_').slice(0, 60);
  }
  function unitUrl(root) {
    const a = statusLink(root);
    if (a && /\/status\/\d+/.test(a.getAttribute('href') || '')) return a.href.split('?')[0];
    return location.href;
  }
  function locateArticle(key) {
    if (!key) return null;
    const arts = document.querySelectorAll(TWEET_SEL);
    for (const a of arts) if (unitKey(a) === key) return a;
    return null;
  }
  // React của X hay thay node article sau khi bấm — luôn ưu tiên node đang
  // còn trong DOM, mất thì tìm lại theo key trước khi đọc proof.
  function currentArticle(u) {
    if (u.el && document.contains(u.el)) return u.el;
    const found = locateArticle(u.key);
    if (found) u.el = found;
    return found || u.el;
  }
  function findUnits() {
    const units = [];
    const seenEl = new Set();
    const seenKey = new Set();
    document.querySelectorAll(TWEET_SEL).forEach(el => {
      if (!visible(el) || seenEl.has(el)) return;
      // Bài hợp lệ = có ít nhất nút Like hoặc Reply của action bar.
      if (!byTestId(el, 'like') && !byTestId(el, 'unlike') && !byTestId(el, 'reply')) return;
      const key = unitKey(el);
      if (seenKey.has(key)) return;
      seenEl.add(el); seenKey.add(key);
      units.push({ el, key, url: unitUrl(el) });
    });
    return units;
  }

  function isSponsored(root) {
    // Nhãn promoted của X là 1 phần tử lá nhỏ ("Promoted"/"Ad"/"Quảng cáo")
    // trong thân bài; quét phần tử lá để tránh khớp nhầm nội dung tweet.
    const leaves = root.querySelectorAll('span, div, a');
    for (const el of leaves) {
      if (el.children.length === 0 && L.promoted.includes(textOf(el))) return true;
    }
    const head = textOf(root).slice(0, 300);
    return /(^|\s)(Promoted|Quảng cáo|Được quảng bá)(\s|$)/.test(head);
  }
  function postText(root) {
    const el = root.querySelector('[data-testid="tweetText"]');
    const raw = el ? textOf(el) : textOf(root);
    return raw.replace(/\s+/g, ' ').slice(0, 1200);
  }
  function existingReplyTexts(root) {
    // Trên Home không thấy được các reply có sẵn — chỉ chống AI lặp lại
    // chính nội dung tweet (lõi còn chặn gần-trùng với thân bài ở doComment).
    const out = [];
    root.querySelectorAll('[data-testid="tweetText"]').forEach(el => {
      const t = textOf(el);
      if (t.length > 1) out.push(t);
    });
    return out.slice(0, 5);
  }
  // Số đếm trên nút action của X: aria-label ("12 Replies. Reply") hoặc
  // text dính trong nút. Trả {value, exact} — dạng rút gọn K/M/B thì
  // exact=false, proof reply chỉ tin khi ít nhất 1 phía exact.
  function countInfo(btn) {
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
  function signatureInFeed(text, excludeBox) {
    const frag = commentSignature(text).slice(0, 60);
    if (!frag) return null;
    const nodes = document.querySelectorAll('[data-testid="tweetText"]');
    for (const el of nodes) {
      if (excludeBox && (el === excludeBox || excludeBox.contains(el))) continue;
      if (normalizeText(el.textContent || '').includes(frag)) return el;
    }
    return null;
  }

  const sGet = keys => new Promise(res => {
    try { chrome.storage.local.get(keys, r => res(r || {})); } catch (_) { res({}); }
  });

  let errTaskId = '';
  (async () => {
    const stored = await sGet(CANONICAL_KEY);
    const run = stored[CANONICAL_KEY];
    if (!run || run.platform !== PLATFORM || run.type !== 'nurture') return;
    const taskId = String(run.task_id || run.id || '');
    const runId = String(run.run_id || taskId);
    if (!taskId) return;
    errTaskId = taskId;

    const store = globalThis.AVJP.nurture.createStore({ prefix: PREFIX });
    const session = { like: 0, comment: 0, save: 0, follow: 0, uncertain: 0, skipped: 0, watched: 0 };
    let doneSent = false;

    async function sendProgress() {
      try {
        const today = await store.todayCounters();
        chrome.runtime.sendMessage({
          action: 'nurtureProgress', taskId, platform: PLATFORM,
          counters: { today, session: { ...session } }
        }).catch(() => {});
      } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
    }
    async function sendDone(status, failureCode, message) {
      if (doneSent) return;
      doneSent = true;
      const journal = await store.getJournal(runId);
      const items = journal
        .filter(e => ['like', 'comment', 'save', 'follow'].includes(e.action))
        .map(e => ({
          action: e.action, target_url: e.url || '', status: e.status,
          note: e.note || '', ...(e.content ? { content: e.content, source: e.source || '' } : {})
        }));
      try {
        await chrome.runtime.sendMessage({
          action: 'nurtureDone', taskId, platform: PLATFORM,
          status, failure_code: failureCode || null,
          resultMessage: message, items
        });
      } catch (err) {
        console.error('[Auto vjp][x-nurture] Không gửi được nurtureDone', err);
      }
    }

    // --- Cấu hình: core defaults <- storage.sync <- payload task (task thắng).
    // Bookmark chấp nhận cả field riêng (bookmark_enabled/bookmark_pct) lẫn
    // field save_* của lõi dùng chung. ---
    const cfg = await store.getSyncConfig();
    const flag = (v, def) => (v === undefined ? def : Boolean(v));
    const enabled = {
      like: flag(run.like_enabled, true),
      save: flag(run.bookmark_enabled, flag(run.save_enabled, false)),
      follow: flag(run.follow_enabled, false),
      comment: flag(run.comment_enabled, true)
    };
    for (const a of ['like', 'save', 'follow', 'comment']) {
      const pct = Number(run[a + '_pct']);
      if (Number.isFinite(pct)) cfg[a + 'Pct'] = clampInt(pct, cfg[a + 'Pct'], 0, 100);
    }
    const bookmarkPct = Number(run.bookmark_pct);
    if (Number.isFinite(bookmarkPct)) cfg.savePct = clampInt(bookmarkPct, cfg.savePct, 0, 100);
    if (run.prompt) cfg.prompt = String(run.prompt);
    if (Number(run.comment_gap_min) > 0) cfg.commentGapMin = Number(run.comment_gap_min);
    if (Number(run.comment_gap_max) > 0) cfg.commentGapMax = Math.max(Number(run.comment_gap_max), cfg.commentGapMin);
    const maxMinutes = clampInt(run.max_minutes, 10, 1, 120);
    const maxActions = clampInt(run.max_actions, 8, 1, 100);
    const deadline = Date.now() + maxMinutes * 60 * 1000;
    const templates = (Array.isArray(run.comment_templates) ? run.comment_templates
      : Array.isArray(run.reply_templates) ? run.reply_templates : [])
      .map(s => String(s || '').trim()).filter(Boolean);

    // --- Mở phiên: đúng run này đã Active (inject lại) -> resume, không
    // reset Done*; ngược lại persist run TRƯỚC khi nắn trang. ---
    const prev = await store.getState();
    const resuming = prev[store.K('Active')] && prev[store.K('RunId')] === runId;
    if (!resuming) await store.startRun({ runId, taskId, config: { ...cfg, enabled, maxMinutes, maxActions } });
    await store.claimOwner(runId).catch(() => {});
    await store.setStatus(resuming ? 'Resume phiên nuôi X' : 'Đang nuôi X (home)');
    const progressTimer = setInterval(sendProgress, 30000);

    const finish = async (status, code, msg) => {
      clearInterval(progressTimer);
      await store.finishRun(msg);
      await sendDone(status, code, msg);
    };

    const block0 = detectBlock();
    if (block0) {
      await finish('failed', 'session_expired', block0 + ' — dừng phiên, không tự giải.');
      return;
    }

    const roll = pct => Math.random() * 100 < pct;
    const totalActions = () => session.like + session.comment + session.save + session.follow;

    async function doLike(u) {
      const root = currentArticle(u);
      if (!root) return 'not_found';
      if (byTestId(root, 'unlike')) return 'already';
      const btn = byTestId(root, 'like');
      if (!btn) return 'not_found';
      btn.click();
      // Proof theo đúng testid: nút lật like -> unlike trong tối đa 3s.
      const proof = await store.waitForProof(
        () => { const r = currentArticle(u); return r ? byTestId(r, 'unlike') : null; },
        { timeoutMs: 3000, intervalMs: 250, runId });
      if (proof) {
        await store.recordProof('like', { id: u.key, url: u.url, runId });
        session.like++;
        await store.journal({ runId, platform: PLATFORM, action: 'like', target: u.key, url: u.url, status: 'success', note: 'proof: data-testid lật like→unlike' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'like', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Like nhưng testid không lật sang unlike sau 3s' });
      return 'uncertain';
    }

    async function doBookmark(u) {
      const root = currentArticle(u);
      if (!root) return 'not_found';
      if (byTestId(root, 'removeBookmark')) return 'already';
      const btn = byTestId(root, 'bookmark');
      if (!btn) return 'not_found';
      btn.click();
      // Proof: testid lật bookmark -> removeBookmark trong tối đa 3s.
      // Ghi vào kênh save của lõi (bookmark = lưu bài).
      const proof = await store.waitForProof(
        () => { const r = currentArticle(u); return r ? byTestId(r, 'removeBookmark') : null; },
        { timeoutMs: 3000, intervalMs: 250, runId });
      if (proof) {
        await store.recordProof('save', { id: u.key, url: u.url, runId, note: 'bookmark' });
        session.save++;
        await store.journal({ runId, platform: PLATFORM, action: 'save', target: u.key, url: u.url, status: 'success', note: 'proof bookmark: data-testid lật bookmark→removeBookmark' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'save', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Bookmark nhưng testid không lật sang removeBookmark sau 3s' });
      return 'uncertain';
    }

    // Nút follow của tác giả trên Home không phải lúc nào cũng có trong
    // article (thường chỉ ở profile/hover card/Who-to-follow). Tìm theo
    // testid `<userId>-follow`/`-unfollow` trước, dự phòng text/aria-label.
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
        if (L.following.some(f => t === f) || /^(Following|Đang theo dõi)\s+@/i.test(label)) return { state: 'following', el };
        if (L.follow.some(f => t === f) || /^(Follow|Theo dõi)\s+@/i.test(label)) return { state: 'not_following', el };
      }
      return { state: 'none', el: null };
    }
    async function doFollow(u) {
      const root = currentArticle(u);
      if (!root) return 'not_found';
      const st = followState(root);
      if (st.state === 'following') return 'already';
      if (st.state !== 'not_following' || !st.el) return 'not_found';
      st.el.click();
      // Proof: trạng thái lật sang following (testid -unfollow hoặc nhãn
      // Following) trong tối đa 3s.
      const proof = await store.waitForProof(
        () => { const s = followState(currentArticle(u)); return s.state === 'following' ? s.el : null; },
        { timeoutMs: 3000, intervalMs: 250, runId });
      if (proof) {
        await store.recordProof('follow', { id: u.key, url: u.url, runId });
        session.follow++;
        await store.journal({ runId, platform: PLATFORM, action: 'follow', target: u.key, url: u.url, status: 'success', note: 'proof: nút Follow lật trạng thái Following' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'follow', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Follow nhưng nút không lật trạng thái' });
      return 'uncertain';
    }

    // Composer reply của X: bấm Reply trên Home mở DIALOG soạn thảo; ở
    // trang chi tiết thì là ô inline. Ô gõ mang data-testid tweetTextarea_*.
    function findComposer() {
      const isBox = el => el && visible(el)
        && /^tweetTextarea_/.test(el.getAttribute('data-testid') || '')
        && el.getAttribute('contenteditable') === 'true';
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
      for (const dlg of dialogs) {
        const box = [...dlg.querySelectorAll('[data-testid^="tweetTextarea_"]')].find(isBox);
        if (box) return { box, scope: dlg, dialog: true };
      }
      const any = [...document.querySelectorAll('[data-testid^="tweetTextarea_"]')].find(isBox);
      if (any) return { box: any, scope: any.closest('[role="dialog"]') || document.body, dialog: Boolean(any.closest('[role="dialog"]')) };
      return null;
    }
    async function typeReply(box, text) {
      box.focus();
      try { box.click(); } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
      await sleep(300);
      const present = () => normalizeText(box.textContent).includes(normalizeText(text).slice(0, 20));
      try { document.execCommand('insertText', false, text); } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
      if (!present()) {
        // Dự phòng cho editor DraftJS: dán qua ClipboardEvent, rồi gõ từng
        // ký tự bằng insertText như các adapter trước.
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
      }
      if (!present()) {
        for (const ch of text) {
          try { document.execCommand('insertText', false, ch); } catch (_) { break; }
          if (present()) break;
        }
      }
      if (!present()) {
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      await sleep(400);
    }
    function findSendButton(scope) {
      const scopes = [scope, document].filter(Boolean);
      for (const sc of scopes) {
        const btn = [...sc.querySelectorAll('button[data-testid="tweetButton"], button[data-testid="tweetButtonInline"]')]
          .find(b => visible(b) && b.getAttribute('aria-disabled') !== 'true' && !b.disabled);
        if (btn) return btn;
      }
      return null;
    }

    async function doComment(u) {
      if (!(await store.waitNextAllowed(runId))) return 'stopped';
      const root0 = currentArticle(u);
      if (!root0) return 'not_found';
      const body = postText(root0);
      if (body.length < 3) return 'not_found';
      let text = null, source = 'ai';
      const ai = await store.requestAiComment({ postText: body, cfg, runId, provider: run.ai_provider });
      if (ai.stopped) return 'stopped';
      if (ai.text) text = ai.text;
      if (!text && templates.length) {
        text = templates[Math.floor(Math.random() * templates.length)];
        source = 'template';
      }
      if (!text) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'AI lỗi (' + (ai.error || '?') + ') và không có mẫu dự phòng' });
        return 'skipped';
      }
      if (isNearDuplicate(text, existingReplyTexts(root0)) || isNearDuplicate(text, [body])) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'câu reply gần trùng nội dung đã có — bỏ theo kỷ luật gốc', content: text, source });
        return 'skipped';
      }
      const root = currentArticle(u);
      const replyBtn = root ? byTestId(root, 'reply') : null;
      if (!replyBtn) return 'not_found';
      const countBefore = countInfo(replyBtn);
      const urlBefore = location.href;
      replyBtn.click();
      await sleep(1100);
      let comp = findComposer();
      if (!comp) { await sleep(900); comp = findComposer(); }
      if (!comp) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'bấm Reply nhưng không thấy ô soạn thảo tweetTextarea_* (selector composer lệch)', content: text, source });
        return 'not_found';
      }
      await typeReply(comp.box, text);
      if (!(await store.alive(runId))) return 'stopped';
      const sendBtn = findSendButton(comp.scope);
      if (!sendBtn) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'không thấy nút gửi tweetButton/tweetButtonInline đang bật', content: text, source });
        return 'not_found';
      }
      sendBtn.click();
      // Proof (luật gốc: chờ nội dung hiện thật, tối đa 10s):
      //  1) chữ ký reply xuất hiện trong 1 tweetText đã render trên trang
      //     (trang chi tiết sau khi gửi, hoặc URL chuyển sang /status/ kèm
      //     chữ ký);
      //  2) composer dạng dialog đã đóng VÀ số reply exact của tweet gốc
      //     tăng so với trước khi gửi.
      // Chỉ dialog đóng hoặc chỉ URL đổi thì KHÔNG tính — tránh đếm bừa.
      const proof = await store.waitForProof(
        () => {
          const hit = signatureInFeed(text, comp.box);
          if (hit) return hit;
          if (comp.dialog && (!document.contains(comp.box) || !visible(comp.box))) {
            const r = currentArticle(u);
            const nowBtn = r ? byTestId(r, 'reply') : null;
            const after = nowBtn ? countInfo(nowBtn) : null;
            if (countBefore && after && after.value > countBefore.value && (countBefore.exact || after.exact)) return true;
            if (location.href !== urlBefore && /\/status\/\d+/.test(location.href) && signatureInFeed(text, null)) return true;
          }
          return null;
        },
        { timeoutMs: 10000, intervalMs: 500, runId });
      if (proof) {
        await store.recordProof('comment', { id: u.key, url: u.url, runId, note: 'source:' + source });
        session.comment++;
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'success', note: 'proof: reply hiện trên trang / dialog đóng + số reply tăng', content: text, source });
        await store.setNextAllowed(cfg);
        return 'success';
      }
      // Không proof: uncertain — KHÔNG gửi lại (luật gốc).
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'uncertain', note: 'đã gửi nhưng không thấy proof reply sau 10s', content: text, source });
      await store.setNextAllowed(cfg);
      return 'uncertain';
    }

    async function processUnit(u) {
      const root = currentArticle(u);
      if (!root) { session.skipped++; return 'skipped'; }
      if (isSponsored(root)) {
        session.skipped++;
        await store.recordSkipped();
        await store.journal({ runId, platform: PLATFORM, action: 'watch', target: u.key, url: u.url, status: 'skipped', note: 'bài promoted/ads' });
        return 'skipped';
      }
      if (await store.isDead(u.key)) { session.skipped++; return 'skipped'; }
      root.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const dwell = rnd(cfg.dwellMin, cfg.dwellMax) * 1000;
      if (!(await store.waitCancellable(dwell, runId))) return 'stopped';
      session.watched++;

      let acted = false;
      const plan = [];
      if (enabled.like && roll(cfg.likePct)) plan.push('like');
      if (enabled.save && roll(cfg.savePct)) plan.push('save');
      if (enabled.follow && roll(cfg.followPct)) plan.push('follow');
      // Reply để CUỐI: mở dialog/điều hướng có thể xáo trộn DOM của bài,
      // tránh làm hỏng các hành động còn lại trên cùng tweet.
      if (enabled.comment && roll(cfg.commentPct)) plan.push('comment');
      for (const action of plan) {
        if (totalActions() >= maxActions || Date.now() >= deadline) break;
        const gate = await store.canDo(action, u.key, cfg);
        if (!gate.ok) {
          await store.journal({ runId, platform: PLATFORM, action, target: u.key, url: u.url, status: 'skipped', note: 'trần: ' + gate.reason });
          continue;
        }
        let r = 'not_found';
        if (action === 'like') r = await doLike(u);
        else if (action === 'save') r = await doBookmark(u);
        else if (action === 'follow') r = await doFollow(u);
        else if (action === 'comment') r = await doComment(u);
        if (r === 'stopped') return 'stopped';
        if (r === 'success' || r === 'uncertain') {
          acted = true;
          await sendProgress();
          if (!(await store.waitCancellable(rnd(cfg.postMin, cfg.postMax) * 1000, runId))) return 'stopped';
        } else if (r === 'not_found' && action !== 'follow') {
          await store.markDead(u.key, 'selector_not_found:' + action, 1);
        }
      }
      if (!acted) session.skipped++;
      return acted ? 'acted' : 'skipped';
    }

    // --- Vòng lặp phiên ---
    const processed = new Set();
    let emptyRounds = 0, stopped = false, blocked = null;
    while (Date.now() < deadline && totalActions() < maxActions) {
      if (!(await store.alive(runId))) { stopped = true; break; }
      blocked = detectBlock();
      if (blocked) break;
      const units = findUnits();
      let actedThisRound = false;
      for (const u of units) {
        if (Date.now() >= deadline || totalActions() >= maxActions) break;
        if (processed.has(u.key)) continue;
        processed.add(u.key);
        const r = await processUnit(u);
        if (r === 'stopped') { stopped = true; break; }
        if (r === 'acted') actedThisRound = true;
        if (!(await store.waitCancellable(rnd(cfg.delayMin, cfg.delayMax) * 1000, runId))) { stopped = true; break; }
      }
      if (stopped) break;
      blocked = detectBlock();
      if (blocked) break;
      if (!actedThisRound) { emptyRounds++; if (emptyRounds >= 3) break; } else emptyRounds = 0;
      window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'smooth' });
      if (!(await store.waitCancellable(1600, runId))) { stopped = true; break; }
    }

    const summary = `like ${session.like}, reply ${session.comment}, bookmark ${session.save}, follow ${session.follow}, uncertain ${session.uncertain}, bỏ qua ${session.skipped}, đã xem ${session.watched}`;
    if (blocked) {
      await finish('failed', 'session_expired', blocked + ' — dừng phiên. (' + summary + ')');
    } else if (stopped) {
      await finish('failed', 'user_cancelled', 'Phiên bị dừng giữa chừng (cờ dừng/runId đổi). (' + summary + ')');
    } else if (totalActions() > 0) {
      await finish('success', null, 'Nuôi X xong phiên: ' + summary);
    } else if (session.uncertain > 0) {
      await finish('uncertain', null, 'Không hành động nào có proof: ' + summary);
    } else {
      await finish('failed', 'no_eligible_target', 'Không tìm thấy bài hợp lệ để tương tác: ' + summary);
    }
  })().catch(async err => {
    console.error('[Auto vjp][x-nurture]', err);
    if (!errTaskId) return; // chưa xác định được task thì không gửi receipt rác
    try {
      await chrome.runtime.sendMessage({
        action: 'nurtureDone', taskId: errTaskId, platform: PLATFORM,
        status: 'failed', failure_code: 'execution_error',
        resultMessage: 'x-nurture lỗi: ' + (err?.message || String(err)), items: []
      });
    } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
  });
})();
