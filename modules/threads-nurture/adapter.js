/* Auto vjp — modules/threads-nurture/adapter.js (2.3.1, vá selector theo DOM live).
 * Adapter nuôi Threads: bề mặt (selector/phân loại/proof) cắm vào lõi nuôi
 * dùng chung modules/nurture-core (cơ chế quản lý + đồng bộ dữ liệu phỏng bản
 * gốc FB Auto Tool friendReengage/friendWarm — storage.sync cho cấu hình,
 * storage.local họ <prefix>Active/RunId/History/Dead/Status... cho state).
 * Khuôn theo đúng modules/instagram-nurture/adapter.js (lát 1).
 *
 * Luồng: canonical task {platform:'threads', type:'nurture'} -> cấu hình
 * (sync + payload) -> persist run TRƯỚC khi cuộn/nắn -> lướt FEED Threads
 * (threads.net, KHÔNG vào trang bài đơn): dwell -> like/follow (proof =
 * trạng thái nút lật) -> reply AI qua lõi (mở composer ngay trên feed; proof
 * = reply hiện thật trong luồng bài trong 10s; không proof = uncertain,
 * KHÔNG gửi lại) -> nurtureProgress/nurtureDone về kernel.
 *
 * Kỷ luật: checkpoint/login wall -> dừng failed session_expired ngay, không
 * lách, không tự giải. Click chỉ bằng .click() trên phần tử DOM (không tọa
 * độ). Worker không kiểm tra giờ hoạt động (tầng điều phối lo).
 *
 * LƯU Ý SELECTOR: DOM Threads biến động mạnh và module reply cũ của MUT vừa
 * fail trên trang bài thật 2026-11-05 ("Không tìm thấy mục Threads có thể
 * tương tác"). Bằng chứng DOM live cùng ngày cho thấy nút hành động trên
 * threads.com KHÔNG mang aria-label Like/Reply: tín hiệu chắc nhất là <title>
 * trong svg ("Like"/"Reply"...), kèm textContent kiểu "Like753"/"Reply7".
 * Finder vì vậy khớp lần lượt theo title svg -> aria-label -> text nút, luôn
 * loại nút thuộc khối quote lồng; proof Like dùng đa tín hiệu (màu --x-color,
 * path svg, số đếm exact). Chi tiết + rủi ro còn lại ở MODULE.md §5.
 */
(() => {
  if (window.__avjpThreadsNurtureLoaded) return;
  window.__avjpThreadsNurtureLoaded = true;

  const CANONICAL_KEY = 'currentAutomationRun';
  const PLATFORM = 'threads';
  const PREFIX = 'threadsNurture';
  const { sleep, rnd, clampInt, normalizeText, commentSignature, isNearDuplicate } =
    globalThis.AVJP.nurture.util;

  // ---- Selector/nhãn Threads (song ngữ EN/VI). ĐIỂM RỦI RO SỐ 1: Threads
  // đổi DOM/nhãn liên tục — khi test thật lệch thì sửa đúng object này. ----
  const L = {
    like: ['Like', 'Thích'], unlike: ['Unlike', 'Bỏ thích'],
    reply: ['Reply', 'Trả lời'],
    repost: ['Repost', 'Đăng lại'], share: ['Share', 'Chia sẻ'],
    follow: ['Follow', 'Theo dõi'], following: ['Following', 'Đang theo dõi'],
    post: ['Post', 'Đăng'],
    sponsored: ['Sponsored', 'Được tài trợ']
  };
  // Bản đồ finder theo loại hành động: title svg là tín hiệu chắc nhất trên
  // DOM live (chỉ có tên EN), aria-label + text nút là đường dự phòng EN/VI.
  const ACTION_DEFS = {
    like: { titles: ['Like'], labels: L.like },
    unlike: { titles: ['Unlike'], labels: L.unlike },
    reply: { titles: ['Reply'], labels: L.reply },
    repost: { titles: ['Repost'], labels: L.repost },
    share: { titles: ['Share'], labels: L.share },
    follow: { titles: [], labels: L.follow },
    following: { titles: [], labels: L.following }
  };
  // visible() kiểu IG (offsetParent) mù với dialog position:fixed — bản này
  // đo rect + computed style cho chắc cả 2 trường hợp.
  const visible = el => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();
  // el nằm trong khối pressable LỒNG trong root (bài trích dẫn/repost kèm) —
  // nút của bài lồng không phải của bài chính, phải tránh.
  const inNestedBlock = (root, el) => {
    let n = el.parentElement;
    while (n && n !== root) {
      if (n.hasAttribute && n.hasAttribute('data-pressable-container')) return true;
      n = n.parentElement;
    }
    return false;
  };
  // Text nút trên DOM live dính liền số đếm ("Like753", "Reply7"). Chỉ coi
  // là khớp khi nhãn đứng đầu và ký tự ngay sau nhãn không phải chữ cái —
  // nhờ vậy "Follow" không nuốt nhầm "Following".
  const startsWithActionText = (value, labels) => {
    const t = String(value || '').replace(/\s+/g, ' ').trim();
    return labels.some(label => {
      const lab = String(label || '').replace(/\s+/g, ' ').trim();
      if (!lab || !t.toLowerCase().startsWith(lab.toLowerCase())) return false;
      if (t.length === lab.length) return true;
      return !/[A-Za-zÀ-ỹ]/i.test(t.charAt(lab.length));
    });
  };
  // Từ phần tử mang tín hiệu (svg/aria) leo lên cụm nút chứa cả icon + số
  // đếm, không vượt ra ngoài root và không leo qua khối quote lồng.
  const actionControl = (root, source, def) => {
    if (!source) return null;
    if (source.tagName === 'BUTTON' || source.getAttribute?.('role') === 'button') return source;
    let best = source;
    let n = source.parentElement;
    while (n && root.contains(n)) {
      if (inNestedBlock(root, n)) break;
      if (n.tagName === 'BUTTON' || n.getAttribute?.('role') === 'button') return n;
      const compact = textOf(n).replace(/\s+/g, '');
      if (startsWithActionText(compact, def.labels) && compact.length <= 80) best = n;
      if (n === root) break;
      n = n.parentElement;
    }
    return best;
  };
  // Finder nút hành động DUY NHẤT cho like/unlike/reply/repost/share/
  // follow/following: (a) svg descendant có <title> đúng tên hành động,
  // (b) aria-label khớp tuyệt đối, (c) textContent của nút bắt đầu bằng tên
  // hành động. Mọi đường đều loại nút thuộc khối quote lồng trong root.
  const findActionBtn = (root, kind) => {
    const def = ACTION_DEFS[kind];
    if (!root || !def) return null;
    for (const svg of root.querySelectorAll('svg')) {
      const title = String(svg.querySelector('title')?.textContent || '').trim();
      if (title && def.titles.includes(title) && !inNestedBlock(root, svg)) {
        return actionControl(root, svg, def);
      }
    }
    for (const el of root.querySelectorAll('[aria-label]')) {
      const lab = String(el.getAttribute('aria-label') || '').trim();
      if (def.labels.includes(lab) && !inNestedBlock(root, el)) {
        return actionControl(root, el, def);
      }
    }
    for (const el of root.querySelectorAll('button, [role="button"], a')) {
      if (visible(el) && startsWithActionText(textOf(el), def.labels) && !inNestedBlock(root, el)) {
        return el;
      }
    }
    return null;
  };
  const countOf = el => {
    const t = textOf(el).replace(/\s+/g, '');
    const m = /(\d+(?:[.,]\d+)?)([kKmM])?/.exec(t);
    if (!m) return null;
    let v = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    if (m[2] && /k/i.test(m[2])) v *= 1000;
    if (m[2] && /m/i.test(m[2])) v *= 1000000;
    return Math.round(v);
  };
  // Số đếm EXACT cho proof: chỉ nhận số nguyên đứng yên ("753", "1,234"
  // kiểu phân tách nghìn) sau khi bóc nhãn hành động. Dạng rút gọn "1.2K"
  // không exact -> null, không bao giờ dùng làm bằng chứng tăng đúng 1.
  const exactActionCount = (el, labels) => {
    let t = textOf(el).replace(/\s+/g, ' ').trim();
    const sorted = [...labels].sort((a, b) => b.length - a.length);
    for (const lab of sorted) {
      if (t.toLowerCase().startsWith(lab.toLowerCase())) { t = t.slice(lab.length).trim(); break; }
    }
    t = t.replace(/\s+/g, '');
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (/^\d{1,3}(?:,\d{3})+$/.test(t)) return parseInt(t.replace(/,/g, ''), 10);
    return null;
  };
  // Chữ ký Like trước khi bấm (bằng chứng DOM live 2026-11-05): biến
  // --x-color trong style của svg (chưa like = var(--barcelona-charcoal-
  // icon)), tiền tố path d của icon tim, số đếm exact nếu đọc được.
  const likeSignature = btn => {
    const svg = btn ? (btn.matches?.('svg') ? btn : btn.querySelector?.('svg')) : null;
    let color = '';
    if (svg) {
      const styleText = String(svg.getAttribute('style') || '');
      const m = /--x-color\s*:\s*([^;]+)/.exec(styleText);
      color = String((m ? m[1] : '') || svg.style?.getPropertyValue('--x-color') || '').trim();
    }
    const path = String(svg?.querySelector('path')?.getAttribute('d') || '').slice(0, 80);
    return {
      color,
      path,
      count: btn ? exactActionCount(btn, L.like) : null,
      pressed: btn?.getAttribute?.('aria-pressed') === 'true'
    };
  };

  function detectBlock() {
    const url = location.href;
    if (/\/login|\/checkpoint|\/challenge/i.test(url)) return 'Trang login/checkpoint của Threads';
    if (document.querySelector('input[name="username"]') && document.querySelector('input[type="password"]')) {
      return 'Chưa đăng nhập Threads (form login)';
    }
    const head = (document.body?.innerText || '').slice(0, 2500);
    if (/help us confirm|confirm it'?s you|unusual activity|suspicious login|we detected unusual|xác minh danh tính|hoạt động bất thường|tài khoản.*(đình chỉ|suspended)/i.test(head)) {
      return 'Threads yêu cầu xác minh danh tính (challenge)';
    }
    return null;
  }

  // ---- Đơn vị tương tác: 1 bài trong feed. Neo chính = khối
  // [data-pressable-container] chứa link permalink /@user/post/<code>;
  // dự phòng: leo từ link /post/ lên khối chứa nút Like. ----
  const POST_LINK_SEL = 'a[href*="/post/"]';
  function postCode(href) {
    const m = /\/post\/([A-Za-z0-9_-]+)/.exec(String(href || ''));
    return m ? m[1] : null;
  }
  function permalinkOf(root) {
    const a = root.querySelector(POST_LINK_SEL);
    if (!a) return null;
    const code = postCode(a.getAttribute('href'));
    return code ? { code, url: a.href } : null;
  }
  function findUnits() {
    const units = [];
    const seenEl = new Set();
    const seenKey = new Set();
    const push = el => {
      if (!el || seenEl.has(el) || !visible(el)) return;
      const link = permalinkOf(el);
      let key, url;
      if (link) { key = link.code; url = link.url; }
      else {
        const author = el.querySelector('a[href^="/@"]')?.getAttribute('href') || '';
        const time = el.querySelector('time')?.getAttribute('datetime') || '';
        const sig = normalizeText(author + '|' + time + '|' + textOf(el).slice(0, 80));
        key = 'h_' + sig.replace(/\s+/g, '_').slice(0, 60);
        url = location.href;
      }
      if (seenKey.has(key)) return;
      seenEl.add(el); seenKey.add(key);
      units.push({ el, key, url });
    };
    document.querySelectorAll('[data-pressable-container="true"]').forEach(el => {
      // Bài hợp lệ = có permalink VÀ có nút Like theo finder mới (title svg/
      // aria/text) của chính bài — nút của khối quote lồng không tính.
      if (el.querySelector(POST_LINK_SEL)
        && (findActionBtn(el, 'like') || findActionBtn(el, 'unlike'))) push(el);
    });
    if (!units.length) {
      document.querySelectorAll(POST_LINK_SEL).forEach(a => {
        let box = a.parentElement;
        for (let i = 0; i < 8 && box; i++) {
          if (findActionBtn(box, 'like') || findActionBtn(box, 'unlike')) break;
          box = box.parentElement;
        }
        if (box && (findActionBtn(box, 'like') || findActionBtn(box, 'unlike'))) push(box);
      });
    }
    return units;
  }

  function isSponsored(root) {
    const head = textOf(root).slice(0, 500);
    if (L.sponsored.some(s => head.includes(s))) return true;
    // Nhãn quảng cáo thường là 1 phần tử lá đứng riêng gần đầu bài.
    const leaves = root.querySelectorAll('span, div');
    for (const el of leaves) {
      if (el.children.length === 0 && L.sponsored.includes(textOf(el))) return true;
    }
    return false;
  }
  function postText(root) {
    const raw = textOf(root)
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !/^(like|reply|repost|share|follow|following|thích|trả lời|đăng lại|chia sẻ|theo dõi|đang theo dõi|\d+)$/i.test(s))
      .join(' ');
    return raw.slice(0, 1200);
  }
  function existingReplyTexts(root) {
    const out = [];
    root.querySelectorAll('span[dir="auto"], div[dir="auto"]').forEach(el => {
      if (el.querySelector('[aria-label]')) return;
      const t = textOf(el);
      if (t.length > 1 && (el.children?.length || 0) <= 1) out.push(t);
    });
    return out.slice(0, 20);
  }
  // Proof chữ ký: phần tử lá chứa 60 ký tự đầu của chữ ký, NGOÀI ô soạn thảo
  // (tránh tự khớp chính text đang gõ trong composer chưa gửi).
  function signatureProof(scope, text, excludeEl) {
    const frag = commentSignature(text).slice(0, 60);
    if (!frag) return null;
    const nodes = scope.querySelectorAll('span, div, p');
    for (const el of nodes) {
      if (excludeEl && (el === excludeEl || excludeEl.contains(el) || el.contains(excludeEl))) continue;
      if (el.closest && el.closest('[contenteditable="true"]')) continue;
      if (el.querySelector && el.querySelector('[contenteditable="true"]')) continue;
      if ((el.children?.length || 0) > 2) continue;
      const t = normalizeText(el.textContent || '');
      if (t && t.includes(frag)) return el;
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
        console.error('[Auto vjp][threads-nurture] Không gửi được nurtureDone', err);
      }
    }

    // --- Cấu hình: core defaults <- storage.sync <- payload task (task thắng)
    const cfg = await store.getSyncConfig();
    const flag = (v, def) => (v === undefined ? def : Boolean(v));
    const enabled = {
      like: flag(run.like_enabled, true),
      follow: flag(run.follow_enabled, false),
      comment: flag(run.comment_enabled, true)
    };
    for (const a of ['like', 'follow', 'comment']) {
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

    // --- Mở phiên: đúng run này đã Active (inject lại) -> resume, không
    // reset Done*; ngược lại persist run TRƯỚC khi nắn trang. ---
    const prev = await store.getState();
    const resuming = prev[store.K('Active')] && prev[store.K('RunId')] === runId;
    if (!resuming) await store.startRun({ runId, taskId, config: { ...cfg, enabled, maxMinutes, maxActions } });
    await store.claimOwner(runId).catch(() => {});
    await store.setStatus(resuming ? 'Resume phiên nuôi Threads' : 'Đang nuôi Threads (feed)');
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
    const totalActions = () => session.like + session.comment + session.follow;

    async function doLike(u) {
      if (findActionBtn(u.el, 'unlike')) return 'already';
      const btn = findActionBtn(u.el, 'like');
      if (!btn) return 'not_found';
      // Chụp chữ ký TRƯỚC khi bấm — proof đa tín hiệu so đúng chữ ký này.
      const before = likeSignature(btn);
      // Chốt an toàn: trạng thái chưa like có --x-color là charcoal (bằng
      // chứng live). Nếu nút đã mang màu khác/aria-pressed thì bài đã like
      // rồi — không bấm nữa, tránh unlike nhầm khi title svg vẫn ghi "Like".
      if (before.pressed || (before.color && !/charcoal/i.test(before.color))) return 'already';
      btn.click();
      // Proof đa tín hiệu trong tối đa 3s — THÀNH CÔNG nếu BẤT KỲ tín hiệu
      // nào đổi: nút lật Unlike / aria-pressed=true (đường cũ), màu
      // --x-color rời khỏi charcoal, tiền tố path svg đổi, hoặc số đếm
      // exact tăng đúng 1. Không tín hiệu nào đổi = uncertain như cũ.
      let proofSignal = '';
      const proof = await store.waitForProof(
        () => {
          const un = findActionBtn(u.el, 'unlike');
          if (un) { proofSignal = 'nút lật Unlike'; return un; }
          const now = findActionBtn(u.el, 'like') || findActionBtn(u.el, 'unlike');
          if (!now) return null;
          const sig = likeSignature(now);
          if (sig.pressed) { proofSignal = 'aria-pressed=true'; return now; }
          if (sig.color && sig.color !== before.color && !/charcoal/i.test(sig.color)) {
            proofSignal = '--x-color rời charcoal'; return now;
          }
          if (before.path && sig.path && sig.path !== before.path) {
            proofSignal = 'path svg đổi'; return now;
          }
          if (before.count != null && sig.count === before.count + 1) {
            proofSignal = 'số đếm exact +1'; return now;
          }
          return null;
        },
        { timeoutMs: 3000, intervalMs: 300, runId });
      if (proof) {
        await store.recordProof('like', { id: u.key, url: u.url, runId });
        session.like++;
        await store.journal({ runId, platform: PLATFORM, action: 'like', target: u.key, url: u.url, status: 'success', note: 'proof đa tín hiệu: ' + (proofSignal || 'trạng thái nút đổi') });
        return 'success';
      }
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'like', target: u.key, url: u.url, status: 'uncertain', note: 'bấm Like nhưng không tín hiệu nào đổi (màu/path/số đếm/nút lật)' });
      return 'uncertain';
    }

    async function doFollow(u) {
      const btn = findActionBtn(u.el, 'follow');
      if (!btn) return 'not_found';
      btn.click();
      // Proof: finder thấy nút Following (text/aria lật Follow -> Following).
      const proof = await store.waitForProof(
        () => findActionBtn(u.el, 'following')
          || [...u.el.querySelectorAll('button, [role="button"]')]
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

    // Ô reply trên feed Threads: bấm Reply thì hoặc mở DIALOG soạn thảo
    // (biến thể phổ biến) hoặc nở ô inline ngay dưới bài. Tìm theo thứ tự:
    // dialog hiện hữu -> trong bài -> toàn trang.
    function findComposer(u) {
      const isBox = el => el && el.getAttribute('contenteditable') === 'true'
        && el.getAttribute('role') === 'textbox' && visible(el);
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find(d => visible(d));
      if (dlg) {
        const box = [...dlg.querySelectorAll('[contenteditable="true"]')].find(isBox);
        if (box) return { box, scope: dlg, dialog: true };
      }
      const inline = [...u.el.querySelectorAll('[contenteditable="true"]')].find(isBox);
      if (inline) return { box: inline, scope: u.el, dialog: false };
      const any = [...document.querySelectorAll('[contenteditable="true"]')].find(isBox);
      if (any) return { box: any, scope: any.closest('[role="dialog"]') || document.body, dialog: Boolean(any.closest('[role="dialog"]')) };
      return null;
    }
    async function typeReply(box, text) {
      box.focus();
      try { box.click(); } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
      await sleep(300);
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
      if (!normalizeText(box.textContent).includes(normalizeText(text).slice(0, 20))) {
        // Dự phòng cho editor Lexical nuốt insertText cả cục: gõ từng ký tự.
        for (const ch of text) {
          try { document.execCommand('insertText', false, ch); } catch (_) { break; }
        }
      }
      if (!normalizeText(box.textContent).includes(normalizeText(text).slice(0, 20))) {
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      await sleep(400);
    }
    function findPostButton(scope) {
      return [...scope.querySelectorAll('button, [role="button"]')]
        .find(b => visible(b) && L.post.includes(textOf(b)) && b.getAttribute('aria-disabled') !== 'true') || null;
    }
    async function submitReply(comp) {
      const btn = findPostButton(comp.scope) || findPostButton(document.body);
      if (btn) { btn.click(); return 'button'; }
      // Dự phòng: Ctrl+Enter (vài biến thể composer chấp nhận).
      for (const type of ['keydown', 'keyup']) {
        comp.box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, ctrlKey: true }));
      }
      return 'ctrl_enter';
    }

    async function doComment(u) {
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
      if (isNearDuplicate(text, existingReplyTexts(u.el)) || isNearDuplicate(text, [body])) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'câu reply gần trùng nội dung đã có — bỏ theo kỷ luật gốc', content: text, source });
        return 'skipped';
      }
      const replyBtn = findActionBtn(u.el, 'reply');
      if (!replyBtn) return 'not_found';
      const countBefore = countOf(replyBtn);
      replyBtn.click();
      await sleep(1100);
      let comp = findComposer(u);
      if (!comp) { await sleep(900); comp = findComposer(u); }
      if (!comp) {
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'skipped', note: 'bấm Reply nhưng không thấy ô soạn thảo (selector composer lệch)', content: text, source });
        return 'not_found';
      }
      await typeReply(comp.box, text);
      if (!(await store.alive(runId))) return 'stopped';
      await submitReply(comp);
      // Proof (luật gốc: chờ nội dung hiện thật, tối đa 10s):
      //  1) chữ ký reply xuất hiện trong luồng bài / trên trang (ngoài ô soạn);
      //  2) dự phòng khi composer là dialog: dialog đã đóng VÀ số reply tăng.
      const proof = await store.waitForProof(
        () => {
          const hit = signatureProof(u.el, text, comp.box) || signatureProof(document.body, text, comp.box);
          if (hit) return hit;
          if (comp.dialog && !document.contains(comp.box) && countBefore != null) {
            const nowBtn = findActionBtn(u.el, 'reply');
            const after = nowBtn ? countOf(nowBtn) : null;
            if (after != null && after > countBefore) return true;
          }
          return null;
        },
        { timeoutMs: 10000, intervalMs: 500, runId });
      if (proof) {
        await store.recordProof('comment', { id: u.key, url: u.url, runId, note: 'source:' + source });
        session.comment++;
        await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'success', note: 'proof: reply hiện trong luồng bài / số reply tăng', content: text, source });
        await store.setNextAllowed(cfg);
        return 'success';
      }
      // Không proof: uncertain — KHÔNG gửi lại (luật gốc).
      session.uncertain++;
      await store.recordUncertain();
      await store.journal({ runId, platform: PLATFORM, action: 'comment', target: u.key, url: u.url, status: 'uncertain', note: 'đã gửi nhưng reply không hiện sau 10s', content: text, source });
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

    const summary = `like ${session.like}, reply ${session.comment}, follow ${session.follow}, uncertain ${session.uncertain}, bỏ qua ${session.skipped}, đã xem ${session.watched}`;
    if (blocked) {
      await finish('failed', 'session_expired', blocked + ' — dừng phiên. (' + summary + ')');
    } else if (stopped) {
      await finish('failed', 'user_cancelled', 'Phiên bị dừng giữa chừng (cờ dừng/runId đổi). (' + summary + ')');
    } else if (totalActions() > 0) {
      await finish('success', null, 'Nuôi Threads xong phiên: ' + summary);
    } else if (session.uncertain > 0) {
      await finish('uncertain', null, 'Không hành động nào có proof: ' + summary);
    } else {
      await finish('failed', 'no_eligible_target', 'Không tìm thấy bài hợp lệ để tương tác: ' + summary);
    }
  })().catch(async err => {
    console.error('[Auto vjp][threads-nurture]', err);
    if (!errTaskId) return; // chưa xác định được task thì không gửi receipt rác
    try {
      await chrome.runtime.sendMessage({
        action: 'nurtureDone', taskId: errTaskId, platform: PLATFORM,
        status: 'failed', failure_code: 'execution_error',
        resultMessage: 'threads-nurture lỗi: ' + (err?.message || String(err)), items: []
      });
    } catch (_) { console.debug("[Auto vjp][adapter] bỏ qua lỗi:", _); }
  });
})();
