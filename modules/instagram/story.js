// Auto vjp — Instagram Story (task type 'story', 2.7.0).
// Script tự chứa theo khuôn modules/instagram/automator.js (post) và
// modules/youtube/interaction.js (reply): đọc canonical run
// `currentAutomationRun` trực tiếp (không qua legacy key — canonical chỉ
// map type post/reply/affiliate), nạp media qua background
// (mediaFetchStart/Chunk/End như automator), báo kết quả bằng 2 action
// riêng storyCompleted/storyFailed (results.js deliver type 'story').
//
// Luồng: trang chủ IG -> mở trình tạo story qua 3 đường (ô "Tin của
// bạn"/"Your story" ở khay story -> route /stories/create/ -> menu Tạo
// (+) -> mục Tin/Story), đường nào cũng phải qua cổng XÁC MINH dialog
// mang tín hiệu story (xem nhận diện bề mặt ở mục 2 — probe live
// 2026-11-05: IG web trên profile công nhân KHÔNG có trình tạo story,
// nút Tạo mở thẳng dialog đăng BÀI) -> nạp file vào input file của
// dialog story đã xác minh -> editor: bấm "Tin của bạn"/"Your story"
// (KHÔNG bấm "Bạn thân"/Close friends — sai khán giả) -> PROOF: điều
// hướng sang profile, bấm avatar mở story viewer, thấy item story (ưu
// tiên khớp timestamp mới) hoặc vòng story trên avatar profile.
// Điều hướng sang profile làm trang tải lại -> bản inject mới đọc phase
// lưu ở storage (`avjpIgStoryPhase`) và chỉ chạy phần proof.
//
// AI tuỳ chọn (2.7.0): task có `ai_prompt` -> xin 1 câu ngắn (<=60 ký
// tự) qua action `getNurtureAiComment` của kernel (cùng đường họ nuôi:
// getPageAiConfig + callConfiguredText, cấu hình 9router/boss) với
// deadline riêng 70s. AI lỗi/timeout -> dùng content gốc làm chữ chèn
// + details `ai_fallback`. Chèn chữ bằng công cụ text (Aa) của editor
// story; chèn fail -> VẪN đăng story trơn + details `ai_overlay_failed`,
// không fail phiên. Không có ai_prompt -> không gọi AI, không chèn chữ.
//
// Tự chữa selector (2.9.0): finder nút Tạo (ig.story.createEntry),
// hàng nút chia sẻ (ig.story.shareRow) và công cụ text
// (ig.story.textTool) rơi qua AVJP.heal.locate khi finder gốc bó tay;
// spec qua AI chỉ được markProven sau proof story thật (complete()).
// Chốt âm tính chống đăng bài (isPostComposerSurface) giữ nguyên và
// luôn chạy trước khi bất kỳ gợi ý AI nào được dùng để nạp file.
//
// Lỗi (prefix trong message, cùng kiểu các module YouTube):
//   session_expired        — chưa đăng nhập / trang login
//   story_create_not_found — không mở được trình tạo story THẬT (kể cả
//                            trường hợp IG web chỉ có dialog đăng bài:
//                            huỷ ngay, không nạp file vào editor bài
//                            viết — tránh đăng nhầm story thành bài)
//   media_load_failed      — task thiếu media hoặc tải media lỗi
//   story_editor_not_ready — nạp file xong nhưng editor không sẵn sàng
//   story_share_not_found  — editor mở nhưng không thấy nút chia sẻ lên tin
//   story_proof_failed     — đã bấm chia sẻ nhưng không thấy story ở profile
if (window.__avjpIgStoryInjected) {
  console.log('[Auto vjp][IG-Story] Script already injected, exiting.');
} else {
window.__avjpIgStoryInjected = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Auto vjp][IG-Story]', msg);
    try { chrome.storage.local.set({ lastStatus: msg }); } catch (_) {}
    let el = document.getElementById('avjp-story-status');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'avjp-story-status';
      el.style.cssText = `
        position:fixed;top:10px;right:10px;
        z-index:2147483647;padding:16px;border-radius:12px;
        color:#fff;background:rgba(15,23,42,0.95);font-size:13px;
        font-family:-apple-system,BlinkMacSystemFont,monospace;
        box-shadow:0 10px 25px rgba(0,0,0,0.6);
        width:320px;line-height:1.6;pointer-events:none;
        border:1px solid #334155;
      `;
      document.body.appendChild(el);
    }
    if (el) {
      el.innerHTML = `
        <div style="font-weight:700;color:#f472b6;margin-bottom:10px;border-bottom:1px solid #334155;padding-bottom:5px;">
          📸 Auto vjp — Đăng Story Instagram
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
          ${logs.slice(-8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
        </div>
      `;
    }
  }

  // ── Helpers (bản rút gọn từ automator.js, giữ nguyên hành vi) ──
  function doClick(el) {
    if (!el) return;
    const target = el.closest?.('a, button, [role="button"], [role="menuitem"]') || el;
    try { target.focus(); } catch (e) {}
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    if (typeof target.click === 'function') {
      target.click();
    } else {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  }

  function fetchImageViaBackground(url) {
    const send = payload => new Promise(resolve => chrome.runtime.sendMessage(payload, response => resolve(chrome.runtime.lastError ? null : response)));
    return (async () => {
      const start = await send({ action: 'mediaFetchStart', url });
      if (!start?.success) return null;
      const parts = [];
      try {
        for (let offset = 0; offset < start.size;) {
          const chunk = await send({ action: 'mediaFetchChunk', id: start.id, offset, length: 480 * 1024 });
          if (!chunk?.success || chunk.nextOffset <= offset) return null;
          parts.push(chunk.data);
          offset = chunk.nextOffset;
        }
        return { success: true, dataUrl: `data:${start.type};base64,${parts.join('')}`, type: start.type };
      } finally {
        await send({ action: 'mediaFetchEnd', id: start.id });
      }
    })();
  }

  function dataURLtoFile(dataurl, filename, forceMime = null) {
    const arr = dataurl.split(',');
    let mime = forceMime;
    if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
      const match = arr[0] ? arr[0].match(/:(.*?);/) : null;
      mime = match ? match[1] : '';
    }
    if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
      if (filename.endsWith('.mp4') || filename.endsWith('.webm') || filename.endsWith('.mov')) {
        mime = 'video/mp4';
      } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
        mime = 'image/jpeg';
      } else {
        mime = 'image/png';
      }
    }
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  const normalizeUiText = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isVisible = element => {
    if (!element?.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  async function dismissKnownInstagramPopup() {
    const popupPatterns = [/bật thông báo/, /turn on notifications/, /lưu thông tin đăng nhập/, /save (?:your )?login info/];
    const dismissPatterns = [/^để sau$/, /^lúc khác$/, /^not now$/, /^cancel$/, /^hủy$/];
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).reverse();
    for (const dialog of dialogs) {
      const text = normalizeUiText(dialog.innerText || dialog.textContent);
      if (!popupPatterns.some(pattern => pattern.test(text))) continue;
      const dismiss = Array.from(dialog.querySelectorAll('button, [role="button"]')).find(button => {
        const labels = [button.getAttribute('aria-label'), button.innerText, button.textContent].map(normalizeUiText).filter(Boolean);
        return isVisible(button) && labels.some(label => dismissPatterns.some(pattern => pattern.test(label)));
      });
      if (!dismiss) return false;
      doClick(dismiss);
      addLog('✅ Đã đóng popup Instagram không liên quan');
      await sleep(500);
      return true;
    }
    return false;
  }

  // Poll có deadline cứng — kỷ luật chung của fork: không vòng chờ vô hạn.
  async function pollUntil(fn, timeoutMs, intervalMs = 500) {
    const start = Date.now();
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() - start >= timeoutMs) return null;
      await sleep(intervalMs);
    }
  }

  // ── AI (dùng chung đường họ nuôi qua SW) ──
  // Deadline RIÊNG cho lời gọi AI: tối đa 70s (< trần 75s yêu cầu) —
  // AI treo không được treo phiên đăng.
  const AI_CALL_TIMEOUT_MS = 70000;
  function requestAiText(prompt) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish({ success: false, error: 'ai_timeout' }), AI_CALL_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage({ action: 'getNurtureAiComment', prompt }, response => {
          if (chrome.runtime.lastError) {
            finish({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          finish(response || { success: false, error: 'AI không trả phản hồi' });
        });
      } catch (err) {
        finish({ success: false, error: err?.message || String(err) });
      }
    });
  }
  // Chữ chèn story: đúng 1 dòng/câu, bỏ ngoặc kép bao ngoài, CẮT CỨNG
  // 60 ký tự theo yêu cầu kể cả khi AI trả dài hơn.
  const cleanStoryOverlayText = value => {
    const firstLine = String(value || '').split('\n').map(s => s.trim()).find(Boolean) || '';
    return firstLine.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim().slice(0, 60).trim();
  };

  // ── Đọc run + phase ──
  const PHASE_KEY = 'avjpIgStoryPhase';
  const stored = await chrome.storage.local.get('currentAutomationRun');
  const run = stored.currentAutomationRun;
  if (!run || run.platform !== 'instagram' || run.type !== 'story') return;
  const taskId = String(run.task_id || run.id || '');
  if (!taskId) return;

  const getPhase = async () => {
    const s = await chrome.storage.local.get(PHASE_KEY);
    const p = s[PHASE_KEY];
    return p && String(p.taskId) === taskId ? p : null;
  };
  const setPhase = async (phase, extra = {}) => {
    const prev = (await getPhase()) || {};
    await chrome.storage.local.set({ [PHASE_KEY]: { ...prev, ...extra, taskId, phase } });
  };

  // Mã chi tiết AI ghi vào receipt (trường details): ai_fallback /
  // ai_overlay_failed. Mảng này được persist qua phase khi điều hướng
  // sang profile proof (xem setPhase('proving', { details })).
  const aiDetailCodes = [];
  const aiDetailsValue = () => aiDetailCodes.length ? [...new Set(aiDetailCodes)].join('; ') : null;

  // ── Tự chữa selector (2.9.0): các finder hay gãy đi qua AVJP.heal
  // (nạp trước từ contract). healPendingProven gom {key, spec} tìm
  // được qua AI; CHỈ khi phiên đạt proof thật (complete()) mới gọi
  // markProven để SW lưu. Persist qua phase 'proving' vì proof chạy ở
  // document mới sau điều hướng profile. AVJP.heal vắng (inject cũ)
  // -> mọi finder rơi về hành vi gốc, không lỗi.
  const healPendingProven = [];
  const healLocate = (args) => {
    const heal = window.AVJP?.heal;
    if (!heal) return Promise.resolve(null);
    return heal.locate({ platform: 'instagram', ...args }).catch(() => null);
  };
  const noteHealCandidate = (key, found) => {
    if (found && found.via === 'ai' && found.spec) {
      healPendingProven.push({ platform: 'instagram', key, spec: found.spec });
      addLog(`🩺 Heal: "${key}" định vị qua AI — chờ proof thật mới lưu selector`);
    }
  };

  let reported = false;
  async function fail(message) {
    if (reported) return;
    reported = true;
    addLog(`❌ ${message}`);
    await setPhase('done').catch(() => {});
    chrome.runtime.sendMessage({ action: 'storyFailed', postId: taskId, error: message }, () => void chrome.runtime.lastError);
  }
  async function complete(resultUrl, actorUrl, actorName, proofNote) {
    if (reported) return;
    reported = true;
    // Proof thật đã đạt -> giờ mới cho phép lưu selector học qua AI.
    for (const p of healPendingProven) {
      try { window.AVJP?.heal?.markProven(p); } catch (_) {}
    }
    addLog(`🏁 HOÀN TẤT — proof: ${proofNote}`);
    await setPhase('done').catch(() => {});
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'storyCompleted',
        postId: taskId,
        resultUrl: resultUrl || actorUrl || window.location.href,
        actorUrl: actorUrl || null,
        actorName: actorName || null,
        details: aiDetailsValue()
      }, response => resolve(response));
    });
  }

  // Actor (nick đang đăng nhập) từ link profile ở nav — cùng heuristic
  // automator §6, cộng danh sách segment dành riêng bị loại.
  const RESERVED_SEGMENTS = new Set(['explore', 'reels', 'reel', 'direct', 'stories', 'accounts',
    'p', 'tv', 'inbox', 'notifications', 'saved', 'tagged', 'followers', 'following', 'about',
    'legal', 'privacy', 'terms', 'create', 'live', 'igtv', 'lite', 'web', 'api']);
  function findOwnProfile() {
    const links = Array.from(document.querySelectorAll('a[href^="/"]'));
    for (const a of links) {
      const h = a.getAttribute('href') || '';
      const m = /^\/([A-Za-z0-9._]+)\/?$/.exec(h);
      if (!m || RESERVED_SEGMENTS.has(m[1].toLowerCase())) continue;
      return { name: m[1], url: 'https://www.instagram.com/' + m[1] + '/' };
    }
    return null;
  }

  function isLoginWall() {
    if (/\/accounts\/login/.test(location.pathname)) return true;
    const userInput = document.querySelector('input[name="username"]');
    const passInput = document.querySelector('input[name="password"], input[type="password"]');
    return Boolean(userInput && passInput && isVisible(passInput));
  }

  // ── PROOF: chạy trên trang profile sau điều hướng (phase 'proving') ──
  async function runProof(actor) {
    addLog('🔎 Đang kiểm chứng story trên profile...');
    const actorName = actor?.name || null;
    const actorUrl = actor?.url || (actorName ? `https://www.instagram.com/${actorName}/` : 'https://www.instagram.com/');

    // Chờ header profile + avatar.
    const avatarImg = await pollUntil(() => {
      const img = document.querySelector('header img[alt*="profile picture" i], header img[alt*="ảnh đại diện" i], header section img, main header img');
      return img && isVisible(img) ? img : null;
    }, 20000);
    if (!avatarImg) {
      await fail('story_proof_failed: vào profile nhưng không thấy avatar để mở story viewer');
      return;
    }

    const avatarClickTarget = avatarImg.closest('button, a, [role="button"]') || avatarImg.parentElement || avatarImg;

    // Dự phòng: vòng story trên avatar (canvas ring / nút có nhãn story)
    // — chỉ dùng khi không mở được viewer.
    const hasRingFallback = () => {
      const scope = avatarImg.closest('div, span, button, a') || avatarImg.parentElement;
      if (!scope) return false;
      if (scope.querySelector('canvas')) return true;
      const label = normalizeUiText(avatarClickTarget.getAttribute?.('aria-label') || '');
      return /(story|tin)/i.test(label) && !/(thêm|add|tạo|create)/i.test(label);
    };

    doClick(avatarClickTarget);
    addLog('👉 Đã bấm avatar profile, chờ story viewer...');

    const viewerOpened = await pollUntil(() => {
      if (location.pathname.startsWith('/stories/')) return 'url';
      const layer = Array.from(document.querySelectorAll('[role="dialog"], section')).filter(isVisible)
        .find(el => el.querySelector('video, img') && el.getBoundingClientRect().width >= window.innerWidth * 0.5);
      return layer ? 'layer' : null;
    }, 15000, 400);
    if (!viewerOpened) {
      if (hasRingFallback()) {
        await complete(actorUrl, actorUrl, actorName, 'vòng story trên avatar profile (không mở được viewer)');
        return;
      }
      await fail('story_proof_failed: đã bấm chia sẻ nhưng avatar profile không mở được story nào');
      return;
    }

    // Trong viewer: đọc timestamp của item đang hiện; item cũ (>1 giờ)
    // thì chạm sang item kế (tối đa 4 lần) tìm item mới. Không đọc được
    // timestamp nào thì chấp nhận sự hiện diện của viewer (nick test
    // thường chưa có story cũ nào ngoài story vừa đăng).
    const readViewerTimeText = () => {
      const scope = document.querySelector('[role="dialog"]') || document.body;
      const text = normalizeUiText(scope.innerText || '');
      const m = /(vừa xong|mới đây|just now|\d+\s*(?:giây|phút|giờ|seconds?|minutes?|hours?|s|m|h)\s*(?:trước|ago)?)/i.exec(text);
      return m ? m[1] : null;
    };
    const isFresh = (t) => {
      if (!t) return false;
      if (/(vừa xong|mới đây|just now)/i.test(t)) return true;
      const m = /(\d+)\s*(giây|phút|seconds?|minutes?|s|m)\b/i.exec(t);
      if (m) return Number(m[1]) <= 59;
      return false;
    };
    const isOld = (t) => Boolean(t) && /(\d+)\s*(giờ|hours?|h)\b/i.test(t) && Number(/(\d+)/.exec(t)[1]) >= 1;

    let sawAnyTime = false;
    let fresh = false;
    for (let i = 0; i < 5 && !fresh; i++) {
      await sleep(900);
      const t = readViewerTimeText();
      if (t) {
        sawAnyTime = true;
        addLog(`🕐 Story đang xem: "${t}"`);
        if (isFresh(t)) { fresh = true; break; }
        if (!isOld(t)) { fresh = true; break; } // timestamp mơ hồ -> không chặn
      }
      if (i < 4) {
        // Chạm nửa phải viewer để sang item kế.
        const layer = document.querySelector('[role="dialog"]') || document.body;
        const rect = (layer.getBoundingClientRect ? layer.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
        const x = rect.left + rect.width * 0.8;
        const y = rect.top + rect.height * 0.5;
        document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      }
    }
    if (sawAnyTime && !fresh) {
      await fail('story_proof_failed: viewer mở nhưng chỉ thấy story cũ (>1 giờ), không thấy story vừa đăng');
      return;
    }
    await complete(actorUrl, actorUrl, actorName, fresh ? 'story viewer có item timestamp mới' : 'story viewer mở được từ avatar profile');
  }

  // ── MAIN ──
  try {
    const phase = await getPhase();
    if (phase?.phase === 'done') return;
    if (phase?.phase === 'proving') {
      // Khôi phục mã details AI từ phase tạo (trang đã tải lại).
      String(phase.details || '').split(';').map(s => s.trim()).filter(Boolean)
        .forEach(code => aiDetailCodes.push(code));
      // Khôi phục ứng viên selector-AI chờ proof (2.9.0).
      if (Array.isArray(phase.healPending)) {
        phase.healPending.forEach(p => { if (p && p.spec) healPendingProven.push(p); });
      }
      await runProof({ name: phase.actorName || null, url: phase.actorUrl || null });
      return;
    }

    addLog('Khởi động tiến trình đăng Story Instagram...');
    await sleep(2500);
    await dismissKnownInstagramPopup();

    if (isLoginWall()) {
      await fail('session_expired: Instagram chưa đăng nhập (trang login) — dừng task, không lách.');
      return;
    }

    // 1. CHUẨN BỊ FILE (chỉ 1 media — editor story nhận 1 file/lần đăng)
    let rawMedia = [];
    try {
      const raw = run.images || run.media_urls || run.images_json;
      rawMedia = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (e) { /* ignore */ }
    const mediaUrls = rawMedia.map(u => typeof u === 'string' ? u : (u && (u.url || u.src))).filter(Boolean);
    if (!mediaUrls.length) {
      await fail('media_load_failed: task story không có media (images/media_urls rỗng)');
      return;
    }
    if (mediaUrls.length > 1) addLog(`⚠️ Story chỉ đăng 1 media/lần — dùng file đầu trong ${mediaUrls.length} file`);
    addLog('Tải media qua background...');
    const res = await fetchImageViaBackground(mediaUrls[0]);
    if (!res || !res.dataUrl) {
      await fail(`media_load_failed: không tải được media story (${mediaUrls[0]})`);
      return;
    }
    let rawMime = (res.type || (res.dataUrl.split(';')[0].split(':')[1] || '')).trim().toLowerCase();
    if (!rawMime || rawMime === 'application/octet-stream' || rawMime === 'binary/octet-stream') {
      rawMime = String(run.resolved_media_type || '').toLowerCase();
    }
    const isVideo = rawMime.includes('video') || String(run.resolved_media_type || '').startsWith('video/') ||
      /\.(mp4|webm|mov)(\?|#|$)/i.test(mediaUrls[0]);
    const ext = isVideo ? (rawMime.includes('webm') ? 'webm' : 'mp4') : (rawMime.includes('jpeg') || rawMime.includes('jpg') ? 'jpg' : 'png');
    const finalMime = isVideo ? (rawMime.includes('video') ? rawMime : 'video/mp4')
      : (rawMime.includes('jpeg') || rawMime.includes('jpg') ? 'image/jpeg' : 'image/png');
    const file = dataURLtoFile(res.dataUrl, `ig_story_0.${ext}`, finalMime);
    addLog(`✅ Đã nạp media story (${isVideo ? 'video' : 'ảnh'}, ${Math.round(file.size / 1024)} KB)`);

    const actor = findOwnProfile();

    // 1b. AI (tuỳ chọn): có ai_prompt -> xin 1 câu ngắn làm chữ chèn
    // lên story. Prompt = ai_prompt + content task làm chất liệu; yêu
    // cầu cứng: đúng 1 câu, <=60 ký tự, chỉ xuất câu chữ. AI lỗi/
    // timeout/trả rỗng -> ai_fallback: dùng content gốc (cắt 60 ký tự)
    // làm chữ chèn; không có content thì đăng story trơn.
    const aiPrompt = String(run.ai_prompt || '').trim();
    const sourceContent = String(run.content || run.post_content || '').trim();
    let storyOverlayText = '';
    if (aiPrompt) {
      addLog('🤖 Có ai_prompt — đang xin chữ AI cho story (deadline 70s)...');
      const aiReq = [
        aiPrompt,
        'Yêu cầu bắt buộc: chỉ trả về đúng 1 câu ngắn, tối đa 60 ký tự — là chính xác câu chữ sẽ chèn lên story. Không giải thích, không thêm dấu ngoặc kép, không xuống dòng.',
        sourceContent ? `Chất liệu từ nội dung task:\n${sourceContent.slice(0, 1000)}` : ''
      ].filter(Boolean).join('\n\n');
      const aiRes = await requestAiText(aiReq);
      if (aiRes?.success && aiRes.text) storyOverlayText = cleanStoryOverlayText(aiRes.text);
      if (storyOverlayText) {
        addLog(`🤖 AI trả chữ story: "${storyOverlayText}"`);
      } else {
        aiDetailCodes.push('ai_fallback');
        storyOverlayText = cleanStoryOverlayText(sourceContent);
        addLog(aiRes?.error
          ? `⚠️ AI lỗi (${aiRes.error}) — ai_fallback: dùng content gốc làm chữ chèn`
          : '⚠️ AI không trả chữ dùng được — ai_fallback: dùng content gốc làm chữ chèn');
      }
    }

    // 2. MỞ TRÌNH TẠO STORY
    // ── Nhận diện bề mặt — BẰNG CHỨNG PROBE LIVE 2026-11-05 (vòng vá 1) ──
    // Trên profile công nhân (IG web desktop, UI EN) KHÔNG tồn tại trình
    // tạo story ở bất kỳ đường nào đã soi:
    //  (a) nút Tạo (+) mở THẲNG dialog đăng bài "Create new post" (kéo
    //      thả / "Select from computer") — không menu chọn loại, không
    //      mục Story; nạp file vào đó là editor BÀI VIẾT (dialog "Crop",
    //      nút Next) — đây là gốc rễ fail story_editor_not_ready ở vòng
    //      live 2.7.0: bản cũ nhận nhầm dialog bài viết (vì có input
    //      file) là dialog story rồi đốt hết deadline chờ nút chia sẻ.
    //  (b) khay story đầu feed KHÔNG có ô "Your story" của mình — chỉ
    //      có story người khác dạng link profile (/langlehoaanhdao/ là
    //      nick công nhân; các ô là nick lạ).
    //  (c) /stories/create/ bị redirect về /create/ (profile của user
    //      tên "create"); /stories/ là trang lỗi "Go back to Instagram.".
    //  (d) trang profile của mình: avatar = nút đổi ảnh đại diện (2
    //      input ẩn accept image/jpeg[,image/png] — nạp file vào là đổi
    //      avatar!), ô "New" là tạo Highlight, không có nút thêm story.
    // Hệ quả bắt buộc: (1) dialog chỉ được nhận là dialog story khi có
    // TÍN HIỆU STORY dương tính và không mang dấu hiệu đăng bài; (2)
    // input file chỉ lấy TRONG dialog story đã xác minh — cấm fallback
    // input toàn trang; (3) hễ bề mặt hoá ra là editor bài viết thì huỷ
    // ngay bằng story_create_not_found, không bấm Next, không nạp file.
    const STORY_SIGNAL_RE = /create (?:a )?story|add to story|your story|tin của bạn|tạo tin|thêm vào tin|close friends|bạn thân/i;
    const POST_COMPOSER_RE = /create new post|tạo bài viết mới|new photo post/i;
    function isPostComposerSurface() {
      if (/\/create\/(style|details|confirm)/.test(location.pathname)) return true;
      if (POST_COMPOSER_RE.test(document.title || '')) return true;
      return Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).some(d => {
        const aria = (d.getAttribute('aria-label') || '').trim();
        if (/^(crop|edit|create new post)$/i.test(aria)) return true;
        const t = normalizeUiText(d.innerText || d.textContent);
        return POST_COMPOSER_RE.test(t) && !STORY_SIGNAL_RE.test(t);
      });
    }
    const findStoryDialog = () => {
      const hit = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).find(d => {
        const aria = d.getAttribute('aria-label') || '';
        const t = normalizeUiText(d.innerText || d.textContent);
        if (POST_COMPOSER_RE.test(aria) || (POST_COMPOSER_RE.test(t) && !STORY_SIGNAL_RE.test(t))) return false;
        if (/^(crop|edit)$/i.test(aria.trim())) return false;
        if (STORY_SIGNAL_RE.test(aria) || STORY_SIGNAL_RE.test(t)) return true;
        // Dialog không nhãn: chỉ nhận khi có input file VÀ toàn trang
        // không phải bề mặt đăng bài.
        return Boolean(d.querySelector('input[type="file"]')) && !isPostComposerSurface();
      });
      if (hit) return hit;
      // Composer story dạng TRANG (không phải dialog) ở /stories/create/:
      // chỉ nhận khi đúng route + có tín hiệu story + có input file +
      // không phải bề mặt đăng bài. Trả document.body làm pseudo-dialog.
      if (location.pathname.startsWith('/stories/create') && !isPostComposerSurface()
        && document.querySelector('input[type="file"]')
        && STORY_SIGNAL_RE.test(normalizeUiText(document.body?.innerText || '').slice(0, 2000))) {
        return document.body;
      }
      return null;
    };
    // Input file CHỈ trong dialog story đã xác minh (xem (d) ở trên).
    const findStoryFileInput = () => findStoryDialog()?.querySelector('input[type="file"]') || null;
    const dismissPostComposer = () => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible);
      for (const d of dialogs) {
        const aria = (d.getAttribute('aria-label') || '').trim();
        const t = normalizeUiText(d.innerText || d.textContent);
        if (!POST_COMPOSER_RE.test(t) && !/^(crop|edit|create new post)$/i.test(aria)) continue;
        const closeBtn = Array.from(d.querySelectorAll('button, [role="button"]')).find(b =>
          /^(close|đóng)$/i.test(normalizeUiText(b.getAttribute('aria-label') || b.querySelector('svg')?.getAttribute('aria-label') || '')));
        if (closeBtn) { doClick(closeBtn); return true; }
      }
      try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
      return false;
    };

    const storyItemPattern = (t) => /^(tin|story)$/i.test(t)
      || /^(tạo|thêm) (tin|story)/i.test(t)
      || /^create (a )?story$/i.test(t)
      || (/^(tin|story) /i.test(t) && !/(trực tiếp|live)/i.test(t));
    const findMenuStoryItem = () => {
      const containers = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], div[style*="fixed"], div[style*="absolute"]')).filter(isVisible);
      for (const container of containers) {
        const hit = Array.from(container.querySelectorAll('a, [role="menuitem"], [role="button"], button, div[tabindex]')).filter(isVisible)
          .find(el => storyItemPattern(normalizeUiText(el.innerText || el.textContent || el.getAttribute('aria-label'))));
        if (hit) return hit;
      }
      return null;
    };

    // Đường 0: trình tạo story đã mở sẵn (vd trang vừa điều hướng tới).
    let storyDialog = findStoryDialog();
    if (!storyDialog) {
      // Đường 1: ô "Tin của bạn"/"Your story" ở khay story — CHỈ bấm khi
      // nhãn khớp chính xác (probe (b): khay chỉ có story người khác
      // dạng link profile, bấm nhầm là rời sang profile lạ).
      addLog('Tìm ô Tin của bạn / Your story ở khay story...');
      const trayCell = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex]')).filter(isVisible)
        .find(el => /^(tin của bạn|your story)$/i.test(normalizeUiText(
          el.innerText || el.textContent || el.getAttribute('aria-label') || '')));
      if (trayCell) {
        doClick(trayCell);
        addLog('👉 Đã bấm ô Tin của bạn ở khay story');
        storyDialog = await pollUntil(() => findStoryDialog(), 8000, 400);
        if (!storyDialog && location.pathname.startsWith('/stories/')) {
          // Ô khay mở viewer (nick đang có story) thay vì trình tạo.
          history.back();
          await sleep(1500);
        }
      }
    }
    if (!storyDialog && !phase?.triedStoryRoute && !isPostComposerSurface()) {
      // Đường 2: route thẳng /stories/create/. Điều hướng làm document
      // bị huỷ — bản inject mới rà lại từ đầu; cờ triedStoryRoute trong
      // phase chặn lặp route. Probe (c): profile công nhân bị redirect
      // về /create/ (không composer) — đường này dành cho tài khoản/
      // layout mà IG có mở composer ở route này.
      await setPhase('creating', { triedStoryRoute: true });
      addLog('Thử route /stories/create/...');
      location.href = 'https://www.instagram.com/stories/create/';
      await sleep(30000);
      await fail('story_create_not_found: điều hướng /stories/create/ không xảy ra');
      return;
    }
    if (!storyDialog) {
      // Đường 3: nút Tạo (+) -> menu -> mục Tin/Story (cùng finder nút
      // Create với automator post). Probe (a): trên profile công nhân
      // nút này mở THẲNG dialog đăng bài — gặp bề mặt đăng bài thì đóng
      // dialog và bỏ đường này, không nạp file.
      addLog('Tìm nút Create / Tạo (+)...');
      const createLabels = ['New post', 'Tạo mới', 'Tạo', 'Create', 'Bài viết mới', 'Tạo bài viết', 'Tạo bài đăng'];
      let createBtn = null;
      for (const label of createLabels) {
        const el = document.querySelector(`svg[aria-label="${label}"]`)?.closest('a, div[role="button"], button') ||
                   document.querySelector(`a[aria-label="${label}"], div[role="button"][aria-label="${label}"], button[aria-label="${label}"]`);
        if (el && isVisible(el)) { createBtn = el; break; }
      }
      if (!createBtn) {
        const candidates = Array.from(document.querySelectorAll('a, div[role="button"], [role="link"], button')).filter(isVisible);
        createBtn = candidates.find(a => {
          const text = normalizeUiText(a.getAttribute('aria-label') || a.innerText || a.textContent);
          const svgLabel = normalizeUiText(a.querySelector('svg')?.getAttribute('aria-label'));
          return /^(create|tạo|tạo mới|new post)$/i.test(text) || /^(create|tạo|tạo mới|new post)$/i.test(svgLabel);
        });
      }
      if (!createBtn) {
        // (2.9.0) Finder gốc bó tay -> tự chữa selector. LƯU Ý: heal
        // chỉ ĐỊNH VỊ nút Tạo; chốt âm tính chống đăng bài ở vòng poll
        // ngay sau (menuHit === 'post' -> đóng dialog, bỏ đường) vẫn
        // chạy nguyên vẹn TRƯỚC khi bất kỳ file nào được nạp — heal
        // không thể "chữa" thành bấm nhầm vào editor bài viết.
        const healed = await healLocate({
          key: 'ig.story.createEntry',
          intent: 'Nút Tạo (+) của Instagram để mở trình tạo nội dung mới (bài viết / reel / story) ở thanh điều hướng',
          builtins: [
            { by: 'aria', value: 'New post' },
            { by: 'svgTitle', value: 'New post' },
            { by: 'aria', value: 'Create' },
            { by: 'aria', value: 'Tạo mới' },
            { by: 'aria', value: 'Tạo' }
          ],
          timeoutMs: 30000
        });
        if (healed) {
          createBtn = healed.el;
          noteHealCandidate('ig.story.createEntry', healed);
          addLog(`🩺 Heal: thấy nút Tạo qua đường ${healed.via}`);
        }
      }
      if (createBtn) {
        doClick(createBtn);
        addLog('✅ Đã bấm nút Tạo / Create');
        const menuHit = await pollUntil(() => {
          const item = findMenuStoryItem();
          if (item) return item;
          if (findStoryDialog()) return 'dialog';
          if (isPostComposerSurface()) return 'post';
          return null;
        }, 10000, 400);
        if (menuHit && menuHit !== 'dialog' && menuHit !== 'post') {
          doClick(menuHit);
          addLog('✅ Đã chọn loại: Tin (Story)');
          storyDialog = await pollUntil(() => findStoryDialog(), 10000, 400);
        } else if (menuHit === 'dialog') {
          storyDialog = findStoryDialog();
        } else if (menuHit === 'post') {
          addLog('⚠️ Nút Tạo mở thẳng dialog đăng BÀI (không có mục Story) — đóng dialog, bỏ đường này');
          dismissPostComposer();
          await sleep(800);
        }
      }
    }
    if (!storyDialog) {
      await fail('story_create_not_found: IG web không mở được trình tạo story (đã thử ô Tin của bạn ở khay, route /stories/create/, menu Tạo — không đường nào cho dialog story đã xác minh)');
      return;
    }
    addLog('✅ Đã mở trình tạo story (đã xác minh tín hiệu story)');

    // 3. NẠP FILE (cùng cơ chế DataTransfer với automator) — input chỉ
    // nằm trong dialog story đã xác minh ở mục 2 (findStoryFileInput).
    let fileInput = await pollUntil(() => findStoryFileInput(), 15000, 400);
    if (!fileInput) {
      const dialog = findStoryDialog();
      const selectBtn = dialog && Array.from(dialog.querySelectorAll('button, [role="button"]')).find(b => {
        const labels = [b.getAttribute('aria-label'), b.innerText, b.textContent].map(normalizeUiText).filter(Boolean);
        return isVisible(b) && labels.some(l => /(chọn từ (?:máy tính|thiết bị)|tải lên|select from (?:computer|device))/i.test(l));
      });
      if (selectBtn) {
        doClick(selectBtn);
        addLog('✅ Đã bấm Chọn từ máy tính');
        fileInput = await pollUntil(() => findStoryFileInput(), 8000, 400);
      }
    }
    if (!fileInput) {
      await fail('story_create_not_found: trình tạo story mở nhưng không thấy input file để nạp media');
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    addLog('📦 Đã nạp file vào editor story, chờ editor sẵn sàng...');

    // 4. EDITOR -> BẤM "TIN CỦA BẠN" (share)
    // Dấu hiệu editor sẵn sàng: hàng nút chia sẻ của editor story — nút
    // "Bạn thân"/"Close friends" CHỈ tồn tại trong editor story, dùng
    // làm neo; nút bấm là "Tin của bạn"/"Your story" cùng hàng.
    const findShareRow = () => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(isVisible);
      const shareBtn = buttons.find(b => /^(tin của bạn|your story)$/i.test(normalizeUiText(b.innerText || b.textContent)));
      const closeFriends = buttons.find(b => /^(bạn thân|close friends)$/i.test(normalizeUiText(b.innerText || b.textContent)));
      return shareBtn ? { shareBtn, closeFriends: closeFriends || null } : null;
    };

    // ── Chèn chữ lên story bằng công cụ text (Aa) của editor ──
    // Selector theo nhãn EN/VI + nhãn "Aa" kinh điển của IG; CHƯA có
    // bằng chứng DOM live (lát build) — mọi bước đều có deadline và
    // fail ở đây chỉ làm mất chữ chèn, KHÔNG fail phiên đăng.
    const uiLabelOf = el => normalizeUiText(
      el.getAttribute('aria-label') ||
      el.querySelector('svg')?.getAttribute('aria-label') ||
      el.querySelector('svg title')?.textContent ||
      el.innerText || el.textContent || ''
    );
    const findStoryTextTool = () => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div[tabindex], span[role="button"]'))
        .filter(isVisible)
        .map(el => ({ el, label: uiLabelOf(el) }))
        .filter(({ label }) => label && label.length <= 50 &&
          !/(tin của bạn|your story|bạn thân|close friends|chia sẻ|share)/i.test(label) &&
          (/^aa$/i.test(label) || /^(text|văn bản|chữ)$/i.test(label) ||
            /(add text|thêm văn bản|text tool|công cụ văn bản)/i.test(label)));
      // Ưu tiên nút có aria-label tường minh, sau đó tới nút ở cao/phải
      // (toolbar editor story nằm phía trên).
      candidates.sort((a, b) => {
        const aAria = a.el.getAttribute('aria-label') ? 0 : 1;
        const bAria = b.el.getAttribute('aria-label') ? 0 : 1;
        if (aAria !== bAria) return aAria - bAria;
        const ra = a.el.getBoundingClientRect();
        const rb = b.el.getBoundingClientRect();
        return (ra.top - rb.top) || (rb.right - ra.right);
      });
      return candidates[0]?.el || null;
    };
    const findStoryTextEditable = () => {
      const editables = Array.from(document.querySelectorAll(
        'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]'
      )).filter(el => isVisible(el) && el.getAttribute('type') !== 'file');
      editables.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });
      return editables[0] || null;
    };
    const findStoryTextDone = () => Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .find(el => /^(done|xong|hoàn tất|hoàn thành)$/i.test(uiLabelOf(el))) || null;

    async function insertStoryTextOverlay(text) {
      try {
        let tool = findStoryTextTool();
        let toolHealFound = null;
        if (!tool) {
          // (2.9.0) Tự chữa cho công cụ text — chỉ ghi ứng viên AI
          // vào healPending khi chèn chữ THÀNH CÔNG và story đạt
          // proof ở bước cuối (như các key khác).
          toolHealFound = await healLocate({
            key: 'ig.story.textTool',
            intent: 'Công cụ thêm chữ (biểu tượng Aa / Text) trong thanh công cụ của editor story Instagram, bấm vào để gõ chữ lên story',
            builtins: [
              { by: 'text', value: 'Aa' },
              { by: 'aria', value: 'Text' },
              { by: 'aria', value: 'Add text' },
              { by: 'aria', value: 'Văn bản' }
            ],
            timeoutMs: 30000
          });
          if (toolHealFound) {
            tool = toolHealFound.el;
            addLog(`🩺 Heal: thấy công cụ text qua đường ${toolHealFound.via}`);
          }
        }
        if (!tool) { addLog('⚠️ Không thấy công cụ text (Aa) trong editor story'); return false; }
        doClick(tool);
        addLog('👉 Đã mở công cụ text của editor story');
        const editable = await pollUntil(() => findStoryTextEditable(), 10000, 300);
        if (!editable) { addLog('⚠️ Công cụ text mở nhưng không thấy ô nhập chữ'); return false; }
        try { editable.focus(); } catch (_) {}
        doClick(editable);
        await sleep(300);
        let wrote = false;
        if (editable.tagName === 'TEXTAREA' || editable.tagName === 'INPUT') {
          const proto = editable.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(editable, text); else editable.value = text;
          editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          editable.dispatchEvent(new Event('change', { bubbles: true }));
          wrote = String(editable.value || '').includes(text.slice(0, 10));
        } else {
          try { document.execCommand('selectAll', false, null); } catch (_) {}
          wrote = (() => { try { return document.execCommand('insertText', false, text); } catch (_) { return false; } })();
          if (!wrote) {
            editable.textContent = text;
            editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            wrote = String(editable.textContent || '').includes(text.slice(0, 10));
          }
        }
        if (!wrote) { addLog('⚠️ Không ghi được chữ vào ô text của editor'); return false; }
        await sleep(600);
        const doneBtn = findStoryTextDone();
        if (doneBtn) {
          doClick(doneBtn);
          addLog('👉 Đã bấm Xong/Done cho lớp chữ');
        } else {
          try { editable.blur(); } catch (_) {}
        }
        // Chỉ tính là chèn xong khi hàng nút chia sẻ xuất hiện lại —
        // tức editor đã rời chế độ sửa chữ và sẵn sàng để bấm share.
        const row = await pollUntil(() => findShareRow(), 12000, 400);
        if (!row) { addLog('⚠️ Đã gõ chữ nhưng hàng nút chia sẻ không quay lại'); return false; }
        addLog(`✅ Đã chèn chữ lên story: "${text}"`);
        if (toolHealFound) noteHealCandidate('ig.story.textTool', toolHealFound);
        return true;
      } catch (err) {
        addLog(`⚠️ Chèn chữ story lỗi: ${err?.message || err}`);
        return false;
      }
    }
    let shareRow = null;
    let shareHealTried = false;
    const editorStart = Date.now();
    const editorDeadline = editorStart + (isVideo ? 90000 : 45000);
    while (Date.now() < editorDeadline && !shareRow) {
      shareRow = findShareRow();
      if (shareRow) break;
      // CHỐT AN TOÀN (probe vòng vá 1): bề mặt hoá ra là editor BÀI
      // VIẾT thì huỷ NGAY bằng story_create_not_found. Bản cũ bấm
      // Next 2 lần trong editor bài viết rồi đốt deadline 45s và báo
      // sai story_editor_not_ready; bấm Next ở đó còn có nguy cơ đẩy
      // story thành bài viết thật. Editor story thật không có bước
      // Next — hàng nút "Tin của bạn"/"Bạn thân" hiện trực tiếp.
      if (isPostComposerSurface()) {
        dismissPostComposer();
        await fail('story_create_not_found: IG web không mở trình tạo story — file đã chệch vào editor bài viết (Create new post/Crop), đã huỷ để tránh đăng nhầm thành bài viết');
        return;
      }
      // (2.9.0) Sau 10s finder gốc vẫn mù -> thử tự chữa 1 lần, giới
      // hạn trong dialog story ĐÃ XÁC MINH (root) để AI không định vị
      // nhầm phần tử ngoài editor. Chốt âm tính ở trên đã chạy trước.
      if (!shareHealTried && Date.now() - editorStart > 10000 && window.AVJP?.heal) {
        shareHealTried = true;
        addLog('🩺 Hàng nút chia sẻ chưa hiện — thử tự chữa selector (heal) trong dialog story...');
        const healed = await healLocate({
          key: 'ig.story.shareRow',
          intent: 'Nút "Tin của bạn" / "Your story" ở hàng nút dưới cùng của editor story Instagram, bấm để chia sẻ story cho mọi người (không phải nút "Bạn thân" / "Close friends")',
          builtins: [
            { by: 'text', value: 'Tin của bạn' },
            { by: 'text', value: 'Your story' },
            { by: 'aria', value: 'Your story' }
          ],
          root: findStoryDialog(),
          timeoutMs: Math.max(5000, Math.min(30000, editorDeadline - Date.now()))
        });
        if (healed) {
          shareRow = { shareBtn: healed.el, closeFriends: findShareRow()?.closeFriends || null };
          noteHealCandidate('ig.story.shareRow', healed);
          addLog(`🩺 Heal: thấy nút chia sẻ story qua đường ${healed.via}`);
          break;
        }
      }
      await sleep(1200);
    }
    if (!shareRow) {
      await fail('story_editor_not_ready: đã nạp file nhưng hàng nút chia sẻ của editor story không xuất hiện');
      return;
    }
    if (shareRow.shareBtn.getAttribute('aria-disabled') === 'true' || shareRow.shareBtn.disabled) {
      const enabled = await pollUntil(() => {
        const row = findShareRow();
        return row && row.shareBtn.getAttribute('aria-disabled') !== 'true' && !row.shareBtn.disabled ? row : null;
      }, 30000, 600);
      if (!enabled) {
        await fail('story_editor_not_ready: nút "Tin của bạn" bị khoá quá lâu (media chưa xử lý xong)');
        return;
      }
      shareRow = enabled;
    }
    // Chèn chữ AI/fallback (nếu có) TRƯỚC khi bấm chia sẻ. Chèn fail
    // -> ghi ai_overlay_failed rồi VẪN đăng story trơn như brief.
    if (storyOverlayText) {
      const inserted = await insertStoryTextOverlay(storyOverlayText);
      if (!inserted) {
        aiDetailCodes.push('ai_overlay_failed');
        addLog('⚠️ ai_overlay_failed — vẫn đăng story trơn (không chữ)');
        const rowBack = await pollUntil(() => findShareRow(), 10000, 400);
        if (!rowBack) {
          await fail('story_editor_not_ready: sau khi thử chèn chữ, hàng nút chia sẻ của editor không còn');
          return;
        }
        shareRow = rowBack;
      } else {
        shareRow = findShareRow() || shareRow;
      }
    }
    doClick(shareRow.shareBtn);
    addLog('👉 Đã bấm "Tin của bạn" — chia sẻ story');
    await sleep(isVideo ? 8000 : 4000);

    // 5. PROOF trên profile (điều hướng = trang tải lại, bản inject mới
    // tiếp tục ở runProof nhờ phase đã ghi).
    const freshActor = findOwnProfile() || actor;
    if (!freshActor?.url) {
      await fail('story_proof_failed: không xác định được profile của nick để kiểm chứng story');
      return;
    }
    await setPhase('proving', { actorName: freshActor.name, actorUrl: freshActor.url, details: aiDetailsValue(), healPending: healPendingProven });
    addLog('Điều hướng sang profile để kiểm chứng story...');
    location.href = freshActor.url;
    // Document sắp bị huỷ; chờ đủ lâu để bản inject mới nhận việc.
    await sleep(30000);
  } catch (error) {
    console.error('[Auto vjp][IG-Story] Error:', error);
    await fail(error?.message || String(error));
  }
})();
}
