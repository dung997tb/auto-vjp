/* Auto vjp — modules/instagram-nurture/adapter.js (2.2.0, viết mới).
 * Adapter nuôi Instagram: bề mặt (selector/phân loại/proof) cắm vào lõi nuôi
 * dùng chung modules/nurture-core (cơ chế quản lý + đồng bộ dữ liệu phỏng bản
 * gốc FB Auto Tool friendReengage/friendWarm — storage.sync cho cấu hình,
 * storage.local họ <prefix>Active/RunId/History/Dead/Status... cho state).
 *
 * Luồng: canonical task {platform:'instagram', type:'nurture'} -> cấu hình
 * (sync + payload) -> persist run TRƯỚC khi cuộn/nắn -> lướt feed/reels:
 * dwell -> like/save/follow (proof = trạng thái nút lật) -> comment AI qua
 * lõi (proof = comment hiện thật trong bài; không proof = uncertain, KHÔNG
 * gửi lại) -> nurtureProgress/nurtureDone về kernel.
 *
 * Kỷ luật: checkpoint/challenge/chưa đăng nhập -> dừng failed session_expired
 * ngay, không lách, không tự giải. Click chỉ bằng .click() trên phần tử DOM
 * (không tọa độ). Worker không kiểm tra giờ hoạt động (tầng điều phối lo).
 */
(() => {
  if (window.__avjpIgNurtureLoaded) return;
  window.__avjpIgNurtureLoaded = true;

  const CANONICAL_KEY = 'currentAutomationRun';
  const PLATFORM = 'instagram';
  const PREFIX = 'instagramNurture';
  const { sleep, rnd, clampInt, normalizeText, commentSignature, isNearDuplicate } =
    globalThis.AVJP.nurture.util;

  // ---- Selector/nhãn IG (song ngữ EN/VI). ĐIỂM RỦI RO SỐ 1: IG đổi DOM/nhãn
  // theo đợt A/B — khi test thật lệch thì sửa đúng object này. ----
  const L = {
    like: ['Like', 'Thích'], unlike: ['Unlike', 'Bỏ thích'],
    save: ['Save', 'Lưu'], unsave: ['Remove', 'Đã lưu', 'Bỏ lưu'],
    comment: ['Comment', 'Bình luận'],
    follow: ['Follow', 'Theo dõi'], following: ['Following', 'Đang theo dõi'],
    post: ['Post', 'Đăng'],
    sponsored: ['Sponsored', 'Được tài trợ'],
    commentBoxAria: ['Add a comment', 'Thêm bình luận']
  };
  const svgByLabel = (root, labels) => {
    for (const lab of labels) {
      const el = root.querySelector(`svg[aria-label="${lab}"]`);
      if (el) return el;
    }
    return null;
  };
  const clickableOf = el => {
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      if (n.tagName === 'BUTTON' || n.getAttribute?.('role') === 'button') return n;
      n = n.parentElement;
    }
    return el.closest?.('div') || el;
  };
  const visible = el => Boolean(el && el.offsetParent !== null && el.getBoundingClientRect().height > 0);
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();

  function detectBlock() {
    const url = location.href;
    if (/\/challenge|\/checkpoint|suspended/i.test(url)) return 'Trang xác minh/checkpoint của Instagram';
    if (/\/accounts\/login/i.test(url) || (document.querySelector('input[name="username"]') && document.querySelector('input[name="password"]'))) {
      return 'Chưa đăng nhập Instagram (trang login)';
    }
    const head = (document.body?.innerText || '').slice(0, 2500);
    if (/help us confirm|confirm it'?s you|unusual activity|suspicious login|xác minh danh tính|hoạt động bất thường/i.test(head)) {
      return 'Instagram yêu cầu xác minh danh tính (challenge)';
    }
    return null;
  }

  // ---- Đơn vị tương tác: bài feed (<article>) hoặc reel (khối chứa <video>) ----
  function unitKey(root) {
    const a = root.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    if (a) {
      const m = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/.exec(a.getAttribute('href') || '');
      if (m) return m[1];
    }
    const author = root.querySelector('header a[href^="/"], a[role="link"][href^="/"]');
    const time = root.querySelector('time')?.getAttribute('datetime') || '';
    const sig = normalizeText((author?.getAttribute('href') || '') + '|' + time + '|' + textOf(root).slice(0, 80));
    return 'h_' + sig.replace(/\s+/g, '_').slice(0, 60);
  }
  function unitUrl(root) {
    const a = root.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    return a ? a.href : location.href;
  }
  function isSponsored(root) {
    const head = textOf(root).slice(0, 600);
    return L.sponsored.some(s => head.includes(s));
  }
  function findUnits() {
    const units = [];
    const seen = new Set();
    const push = (el, kind) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      units.push({ el, kind, key: unitKey(el), url: unitUrl(el) });
    };
    document.querySelectorAll('article').forEach(a => { if (visible(a)) push(a, 'post'); });
    if (!units.length && /\/reels?\//.test(location.pathname)) {
      document.querySelectorAll('video').forEach(v => {
        let box = v.parentElement;
        for (let i = 0; i < 5 && box && !svgByLabel(box, L.like); i++) box = box.parentElement;
        if (box && visible(box)) push(box, 'reel');
      });
    }
    return units;
  }

  function postText(root) {
    const raw = textOf(root)
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !/^(like|comment|share|save|liked by|others?|view all|theo dõi|follow|đang theo dõi|following)$/i.test(s))
      .join(' ');
    return raw.slice(0, 1200);
  }
  function existingCommentTexts(root) {
    const out = [];
    root.querySelectorAll('li span[dir="auto"], li div[dir="auto"]').forEach(el => {
      const t = textOf(el);
      if (t.length > 1) out.push(t);
    });
    return out.slice(0, 20);
  }
  function commentProof(root, text) {
    const frag = commentSignature(text).slice(0, 60);
    if (!frag) return null;
    const nodes = root.querySelectorAll('li span, li div, ul span, ul div');
    for (const el of nodes) {
      if (el.querySelector('svg')) continue;
      const t = normalizeText(el.textContent || '');
      if (t && t.includes(frag) && (el.children?.length || 0) <= 2) return el;
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
        console.error('[Auto vjp][instagram-nurture] Không gửi được nurtureDone', err);
      }
    }

    // --- Cấu hình: core defaults <- storage.sync <- payload task (task thắng)
    const cfg = await store.getSyncConfig();
    const flag = (v, def) => (v === undefined ? def : Boolean(v));
    const enabled = {
      like: flag(run.like_enabled, true),
      save: flag(run.save_enabled, false),
      follow: flag(run.follow_enabled, false),
      comment: flag(run.comment_enabled, true)
    };
    for (const a of ['like', 'save', 'follow', 'comment']) {
      const pct = Number(run[a + '_pct']);
      if (Number.isFinite(pct)) cfg[a + 'Pct'] = clampInt(pct, cfg[a + 'Pct'], 0, 100);
    }
    if (run.prompt) cfg.prompt = String(run.prompt);
    if (Number(run.comment_gap_min) > 0) cfg.commentGapMin = Number(run.comment_gap_min);
    if (Number(run.comment_gap_max) > 0) cfg.commentGapMax = Math.max(Number(run.comment_gap_max), cfg.commentGapMin);
    const maxMinutes = clampInt(run.max_minutes, 10, 1, 120);
    const maxActions = clampInt(run.max_actions, 8, 1, 100);
    const deadline = Date.now() + maxMinutes * 60 * 1000;
    const templates = (Array.isArray(run.comment_templates) ? run.comment_templates
      : Array.isArray(run.reply_templates) ? run.reply_templates : [])
      .map(s => String(s || '').trim()).filter(Boolean);

    // --- Mở phiên: nếu đúng run này đã Active (inject lại sau điều hướng) thì
    // resume, không reset Done*; ngược lại persist run TRƯỚC khi nắn trang. ---
    const prev = await store.getState();
    const resuming = prev[store.K('Active')] && prev[store.K('RunId')] === runId;
    if (!resuming) await store.startRun({ runId, taskId, config: { ...cfg, enabled, maxMinutes, maxActions } });
    await store.claimOwner(runId).catch(() => {});
    await store.setStatus(resuming ? 'Resume phiên nuôi Instagram' : 'Đang nuôi Instagram (feed)');
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
      if (svgByLabel(u.el, L.unlike)) return 'already';
      const svg = svgByLabel(u.el, L.like);
      if (!svg) return 'not_found';
      clickableOf(svg).click();
      const proof = await store.waitForProof(
        () => svgByLabel(u.el, L.unlike) || null,
        { timeoutMs: 3000, intervalMs: 300, runId });
      if (proof) {
        await store.recordProof('like', { id: u.key, url: u.url, runId });
        session.like++;
        await store.journal({ runId, platform: PLATFORM, action: 'like', target: u.key, url: u.url, status: 'success', note: 'proof: nút lật Unlike' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'like', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Like nhưng nút không lật trạng thái' });
      return 'uncertain';
    }

    async function doSave(u) {
      if (svgByLabel(u.el, L.unsave)) return 'already';
      const svg = svgByLabel(u.el, L.save);
      if (!svg) return 'not_found';
      clickableOf(svg).click();
      const proof = await store.waitForProof(
        () => svgByLabel(u.el, L.unsave) || null,
        { timeoutMs: 3000, intervalMs: 300, runId });
      if (proof) {
        await store.recordProof('save', { id: u.key, url: u.url, runId });
        session.save++;
        await store.journal({ runId, platform: PLATFORM, action: 'save', target: u.key, url: u.url, status: 'success', note: 'proof: nút lật đã lưu' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'save', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Save nhưng nút không lật trạng thái' });
      return 'uncertain';
    }

    async function doFollow(u) {
      const btns = [...u.el.querySelectorAll('button, [role="button"]')]
        .filter(b => visible(b) && L.follow.includes(textOf(b)));
      const btn = btns[0];
      if (!btn) return 'not_found';
      btn.click();
      const proof = await store.waitForProof(
        () => [...u.el.querySelectorAll('button, [role="button"]')]
          .some(b => L.following.includes(textOf(b))) || null,
        { timeoutMs: 3000, intervalMs: 300, runId });
      if (proof) {
        await store.recordProof('follow', { id: u.key, url: u.url, runId });
        session.follow++;
        await store.journal({ runId, platform: PLATFORM, action: 'follow', target: u.key, url: u.url, status: 'success', note: 'proof: nút lật Following' });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'follow', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Follow nhưng nút không lật trạng thái' });
      return 'uncertain';
    }

    function findCommentBox(u) {
      const tas = [...u.el.querySelectorAll('textarea')];
      return tas.find(t => {
        const hint = (t.getAttribute('aria-label') || '') + ' ' + (t.getAttribute('placeholder') || '');
        return L.commentBoxAria.some(a => hint.toLowerCase().includes(a.toLowerCase())) || /comment|bình luận/i.test(hint);
      }) || tas[0] || null;
    }
    async function typeComment(ta, text) {
      ta.focus();
      await sleep(300);
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
      if (!ok || !ta.value.includes(text.slice(0, 20))) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(ta, text); else ta.value = text;
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      await sleep(400);
    }
    async function submitComment(u, ta) {
      const postBtn = [...u.el.querySelectorAll('button, [role="button"]')]
        .find(b => visible(b) && L.post.includes(textOf(b)));
      if (postBtn) { postBtn.click(); return; }
      for (const type of ['keydown', 'keypress', 'keyup']) {
        ta.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }

    async function doComment(u) {
      if (u.kind === 'reel') return 'not_found'; // comment reel mở panel riêng — để lát sau
      if (!(await store.waitNextAllowed(runId))) return 'stopped';
      const body = postText(u.el);
      if (body.length < 10) return 'not_found';
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
      if (isNearDuplicate(text, existingCommentTexts(u.el)) || isNearDuplicate(text, [body])) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'câu comment gần trùng nội dung đã có — bỏ theo kỷ luật gốc', content: text, source });
        return 'skipped';
      }
      let box = findCommentBox(u.el);
      if (!box) {
        const cSvg = svgByLabel(u.el, L.comment);
        if (cSvg) { clickableOf(cSvg).click(); await sleep(900); box = findCommentBox(u.el); }
      }
      if (!box) return 'not_found';
      await typeComment(box, text);
      if (!(await store.alive(runId))) return 'stopped';
      await submitComment(u.el, box);
      const proof = await store.waitForProof(
        () => commentProof(u.el, text),
        { timeoutMs: 10000, intervalMs: 500, runId });
      if (proof) {
        await store.recordProof('comment', { id: u.key, url: u.url, runId, note: 'source:' + source });
        session.comment++;
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'success', note: 'proof: comment hiện trong bài', content: text, source });
        await store.setNextAllowed(cfg);
        return 'success';
      }
      // Không proof: uncertain — KHÔNG gửi lại (luật gốc).
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'uncertain', note: 'đã gửi nhưng comment không hiện sau 10s', content: text, source });
      await store.setNextAllowed(cfg);
      return 'uncertain';
    }

    async function processUnit(u) {
      if (isSponsored(u.el)) {
        session.skipped++;
        await store.recordSkipped();
        await store.journal({ runId, platform: PLATFORM, action: 'watch', target: u.key, url: u.url, status: 'skipped', note: 'bài sponsored/ads' });
        return 'skipped';
      }
      if (await store.isDead(u.key)) { session.skipped++; return 'skipped'; }
      u.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const dwell = rnd(cfg.dwellMin, cfg.dwellMax) * 1000;
      if (!(await store.waitCancellable(dwell, runId))) return 'stopped';
      session.watched++;

      let acted = false;
      const plan = [];
      if (enabled.like && roll(cfg.likePct)) plan.push('like');
      if (enabled.save && roll(cfg.savePct)) plan.push('save');
      if (enabled.comment && roll(cfg.commentPct)) plan.push('comment');
      if (enabled.follow && roll(cfg.followPct)) plan.push('follow');
      for (const action of plan) {
        if (totalActions() >= maxActions || Date.now() >= deadline) break;
        const gate = await store.canDo(action, u.key, cfg);
        if (!gate.ok) {
          await store.journal({ runId, platform: PLATFORM, action, target: u.key, url: u.url, status: 'skipped', note: 'trần: ' + gate.reason });
          continue;
        }
        let r = 'not_found';
        if (action === 'like') r = await doLike(u);
        else if (action === 'save') r = await doSave(u);
        else if (action === 'follow') r = await doFollow(u);
        else if (action === 'comment') r = await doComment(u);
        if (r === 'stopped') return 'stopped';
        if (r === 'success' || r === 'uncertain') {
          acted = true;
          await sendProgress();
          if (!(await store.waitCancellable(rnd(cfg.postMin, cfg.postMax) * 1000, runId))) return 'stopped';
        } else if (r === 'not_found' && action !== 'follow') {
          // Không thấy nút cho hành động chính trên 1 bài bình thường: ghi nhớ
          // ngắn hạn để khỏi quay lại bài này trong các phiên gần.
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

    const summary = `like ${session.like}, comment ${session.comment}, save ${session.save}, follow ${session.follow}, uncertain ${session.uncertain}, bỏ qua ${session.skipped}, đã xem ${session.watched}`;
    if (blocked) {
      await finish('failed', 'session_expired', blocked + ' — dừng phiên. (' + summary + ')');
    } else if (stopped) {
      await finish('failed', 'user_cancelled', 'Phiên bị dừng giữa chừng (cờ dừng/runId đổi). (' + summary + ')');
    } else if (totalActions() > 0) {
      await finish('success', null, 'Nuôi Instagram xong phiên: ' + summary);
    } else if (session.uncertain > 0) {
      await finish('uncertain', null, 'Không hành động nào có proof: ' + summary);
    } else {
      await finish('failed', 'no_eligible_target', 'Không tìm thấy bài hợp lệ để tương tác: ' + summary);
    }
  })().catch(async err => {
    console.error('[Auto vjp][instagram-nurture]', err);
    if (!errTaskId) return; // chưa xác định được task thì không gửi receipt rác
    try {
      await chrome.runtime.sendMessage({
        action: 'nurtureDone', taskId: errTaskId, platform: PLATFORM,
        status: 'failed', failure_code: 'execution_error',
        resultMessage: 'instagram-nurture lỗi: ' + (err?.message || String(err)), items: []
      });
    } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
  });
})();
