// Auto vjp — modules/youtube/upload.js (2.8.0, MỚI).
// Task UPLOAD FULL cho YouTube (type MỚI 'upload', CHỈ youtube): tải
// video lên qua YouTube Studio — video thường (dài) và Shorts (dọc,
// <=60s) đi CHUNG một luồng upload, YouTube tự phân loại. Type 'post'
// của youtube giữ nguyên là Community poster (automator.js); chặn
// enqueue post+video ở source.js giữ nguyên — video chỉ được phép đi
// qua đúng uploader này.
//
// Khuôn: script tự chứa như modules/instagram/story.js — đọc canonical
// run `currentAutomationRun` trực tiếp, nạp media qua background
// (mediaFetchStart/Chunk/End như các poster khác), báo kết quả bằng 2
// action riêng uploadCompleted/uploadFailed (results.js deliver type
// 'upload'). Studio là app Polymer (ytcp-*) nên cần helper xuyên
// shadow DOM — port từ automator.js (queryShadow/queryShadowAll).
// Điều hướng sang trang nội dung Studio để proof làm trang tải lại ->
// bản inject mới đọc phase lưu ở storage (`avjpYtUploadPhase`) và chỉ
// chạy phần proof, đúng mẫu phase của story.js.
//
// TIÊU ĐỀ/MÔ TẢ + AI (khuôn 12:21, cùng đường story.js):
// - Có `ai_prompt` -> xin AI qua action `getNurtureAiComment` (đường
//   API lõi của kernel: getPageAiConfig + callConfiguredText, cấu hình
//   9router/boss; dự phòng aitab) với deadline riêng 70s. Prompt yêu
//   cầu: dòng 1 = tiêu đề (<=100 ký tự), phần còn lại = mô tả;
//   `content` của task là chất liệu. AI ổn -> details `ai_used`.
// - AI lỗi/timeout/trả rỗng -> fallback nội dung gốc + details
//   `ai_fallback`. Không có ai_prompt: tiêu đề = task.title || dòng
//   đầu content; mô tả = phần content còn lại.
// - details cộng `is_short=true/false` khi đo được metadata của file
//   (dọc + <=60s = true) trước khi tải; không đo được thì bỏ qua.
//
// PROOF (không tin nút Đăng): sau khi bấm Đăng/Xong, điều hướng sang
// trang Nội dung của Studio (danh sách video), poll tối đa 150s tìm
// video có ĐÚNG tiêu đề vừa đặt -> lấy video id từ link /video/<id>/
// edit trong hàng -> result_url = https://www.youtube.com/watch?v=<id>.
// Không thấy sau 150s -> failed 'upload_proof_failed'.
//
// Lỗi (prefix trong message, cùng kiểu các module YouTube):
//   session_expired             — chưa đăng nhập YouTube/Studio
//   no_youtube_channel          — tài khoản chưa có kênh (Studio bắt tạo kênh)
//   youtube_verification_required — YouTube đòi xác minh số điện thoại/
//                                 danh tính cho kênh mới: fail tại chỗ,
//                                 TUYỆT ĐỐI không lách
//   studio_not_ready            — Studio/dialog tải không mở được, hoặc
//                                 dialog không về đúng trạng thái kỳ vọng
//   media_load_failed           — task thiếu media / tải media lỗi /
//                                 YouTube từ chối định dạng file
//   upload_proof_failed         — đã Đăng nhưng không thấy video trong
//                                 danh sách nội dung của Studio sau 150s
// Mọi vòng chờ đều có deadline; chờ dài (upload/xử lý) chạm hoạt động
// của run định kỳ qua action postUploadStarted để watchdog inactivity
// 5 phút không đóng oan phiên đang tải thật.
if (window.__avjpYtUploadInjected) {
  console.log('[Auto vjp][YT-Upload] Script already injected, exiting.');
} else {
window.__avjpYtUploadInjected = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Auto vjp][YT-Upload]', msg);
    try { chrome.storage.local.set({ lastStatus: msg }); } catch (_) {}
    let el = document.getElementById('avjp-yt-upload-status');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'avjp-yt-upload-status';
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
        <div style="font-weight:700;color:#ff0000;margin-bottom:10px;border-bottom:1px solid #334155;padding-bottom:5px;">
          ⬆️ Auto vjp — Upload video YouTube
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
          ${logs.slice(-8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
        </div>
      `;
    }
  }

  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeUiText = value => normalize(value).toLowerCase();
  const isVisible = element => {
    if (!element?.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // ── Xuyên shadow DOM (port từ automator.js) ──
  function queryShadow(selector, root = document) {
    if (!root) return null;
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch (_) {}
    let allEls;
    try { allEls = root.querySelectorAll('*'); } catch (_) { return null; }
    for (const el of allEls) {
      if (el.shadowRoot) {
        const found = queryShadow(selector, el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }
  function queryShadowAll(selector, root = document, results = []) {
    if (!root) return results;
    try {
      root.querySelectorAll(selector).forEach(el => results.push(el));
    } catch (_) {}
    let allEls;
    try { allEls = root.querySelectorAll('*'); } catch (_) { return results; }
    for (const el of allEls) {
      if (el.shadowRoot) queryShadowAll(selector, el.shadowRoot, results);
    }
    return results;
  }

  // Bấm kiểu automator (pointer events + click) — nút Polymer của
  // Studio đáp ứng tốt hơn click() trần.
  function doClick(el) {
    if (!el) return;
    try {
      const target = el.querySelector('button') || el;
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      try { target.focus?.(); } catch (_) {}
      const pointerOptions = { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      target.dispatchEvent(new PointerEvent('pointerdown', pointerOptions));
      target.dispatchEvent(new MouseEvent('mousedown', pointerOptions));
      target.dispatchEvent(new PointerEvent('pointerup', pointerOptions));
      target.dispatchEvent(new MouseEvent('mouseup', pointerOptions));
      target.click();
    } catch (e) {
      try { el.click(); } catch (_) {}
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

  // Bản từ story.js (có forceMime + đoán mime theo đuôi file).
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

  // Chạm hoạt động của run (results.js touchActive cho mọi exec
  // action) để watchdog inactivity 5 phút không đóng oan phiên đang
  // chờ upload/xử lý dài.
  let lastTouch = 0;
  function touchActivity() {
    const now = Date.now();
    if (now - lastTouch < 45000) return;
    lastTouch = now;
    try { chrome.runtime.sendMessage({ action: 'postUploadStarted', postId: taskId }, () => void chrome.runtime.lastError); } catch (_) {}
  }

  // ── AI (dùng chung đường họ nuôi qua SW — bản từ story.js) ──
  // Deadline RIÊNG cho lời gọi AI: tối đa 70s — AI treo không được
  // treo phiên upload.
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
  const cleanAiTitle = value => String(value || '').split('\n').map(s => s.trim()).find(Boolean)?.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim().slice(0, 100) || '';

  // ── Đọc run + phase ──
  const PHASE_KEY = 'avjpYtUploadPhase';
  const stored = await chrome.storage.local.get('currentAutomationRun');
  const run = stored.currentAutomationRun;
  if (!run || run.platform !== 'youtube' || run.type !== 'upload') return;
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

  // Mã chi tiết ghi vào receipt (trường details, cùng quy ước story):
  // ai_used / ai_fallback / is_short=true|false. Persist qua phase khi
  // điều hướng sang trang nội dung proof.
  const detailCodes = [];
  const detailsValue = () => detailCodes.length ? [...new Set(detailCodes)].join('; ') : null;
  const restoreDetails = (text) => {
    String(text || '').split(';').map(s => s.trim()).filter(Boolean)
      .forEach(code => { if (!detailCodes.includes(code)) detailCodes.push(code); });
  };

  let reported = false;
  async function fail(message) {
    if (reported) return;
    reported = true;
    addLog(`❌ ${message}`);
    await setPhase('done').catch(() => {});
    chrome.runtime.sendMessage({ action: 'uploadFailed', postId: taskId, error: message, details: detailsValue() }, () => void chrome.runtime.lastError);
  }
  async function complete(resultUrl, proofNote) {
    if (reported) return;
    reported = true;
    addLog(`🏁 HOÀN TẤT — proof: ${proofNote}`);
    await setPhase('done').catch(() => {});
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'uploadCompleted',
        postId: taskId,
        resultUrl,
        details: detailsValue()
      }, response => resolve(response));
    });
  }

  // ── Phát hiện cổng xác minh (kênh mới) ──
  // YouTube bắt xác minh số điện thoại/danh tính ở vài thời điểm (mở
  // tính năng, video dài...). Gặp là fail ngay youtube_verification_
  // required — không bấm tiếp, không lách.
  const VERIFY_RE = /(verify|verification|xác minh).{0,60}(phone|số điện thoại|identity|danh tính)|(phone|số điện thoại).{0,40}(verify|verification|xác minh)/i;
  function verificationPromptVisible() {
    if (/verify|verification/i.test(location.href)) return true;
    const dialogs = queryShadowAll('ytcp-dialog, tp-yt-paper-dialog, [role="dialog"], ytcp-uploads-dialog');
    for (const d of dialogs) {
      if (!isVisible(d)) continue;
      if (VERIFY_RE.test(normalize(d.innerText || d.textContent))) return true;
    }
    return false;
  }

  // ── Ô tiêu đề / mô tả trong dialog upload ──
  // Studio bọc 2 ô trong ytcp-social-suggestions-textbox; phân biệt
  // bằng aria-label/label của ô và id của tổ tiên (title/description),
  // dự phòng theo vị trí (ô đầu = tiêu đề, ô sau = mô tả).
  function findTitleBox() {
    const boxes = queryShadowAll('ytcp-social-suggestions-textbox');
    for (const box of boxes) {
      const tb = box.querySelector('#textbox') || queryShadow('#textbox', box);
      if (!tb) continue;
      const aria = normalizeUiText(tb.getAttribute('aria-label') || '');
      const label = normalizeUiText(box.getAttribute('label') || '');
      let anc = '';
      let p = box;
      for (let i = 0; i < 4 && p; i++) { anc += ' ' + (p.id || ''); p = p.parentElement; }
      if (/title|tiêu đề/.test(aria) || /title|tiêu đề/.test(label) || /title/.test(anc)) return tb;
      if (/add a title|thêm tiêu đề/.test(aria)) return tb;
    }
    return null;
  }
  function findDescBox() {
    const boxes = queryShadowAll('ytcp-social-suggestions-textbox');
    const titleBox = findTitleBox();
    for (const box of boxes) {
      const tb = box.querySelector('#textbox') || queryShadow('#textbox', box);
      if (!tb || tb === titleBox) continue;
      const aria = normalizeUiText(tb.getAttribute('aria-label') || '');
      const label = normalizeUiText(box.getAttribute('label') || '');
      let anc = '';
      let p = box;
      for (let i = 0; i < 4 && p; i++) { anc += ' ' + (p.id || ''); p = p.parentElement; }
      if (/description|mô tả/.test(aria) || /description|mô tả/.test(label) || /description/.test(anc)) return tb;
      if (/tell viewers|giới thiệu về video/.test(aria)) return tb;
    }
    // Dự phòng theo vị trí: ô khác ô tiêu đề.
    const all = boxes.map(b => b.querySelector('#textbox') || queryShadow('#textbox', b)).filter(Boolean);
    return all.find(tb => tb !== titleBox) || null;
  }

  // Channel id của kênh đang mở Studio — phục vụ URL trang nội dung.
  function channelIdFromPage() {
    const fromUrl = /\/channel\/(UC[\w-]{20,})/.exec(location.href);
    if (fromUrl) return fromUrl[1];
    const link = queryShadow('a[href*="/channel/UC"]');
    const href = link ? String(link.getAttribute('href') || '') : '';
    const m = /\/channel\/(UC[\w-]{20,})/.exec(href);
    return m ? m[1] : null;
  }

  // (2.11.4, #95) Trang ĐÍCH của proof: trang Nội dung Studio là
  // /channel/<id>/videos (kết thúc path). Matcher bản cũ /\/videos/
  // khớp cả /channel/<id>/videos/upload (URL của dialog upload) ->
  // proof chạy nhầm trên mặt dialog (test live 2.11.3). Chỉ nhìn
  // pathname nên các biến thể query (?approve_browser_access=true,
  // ?autovjp_proof=<ts> do chính module cộng khi làm mới trang)
  // không ảnh hưởng.
  const CONTENT_VIDEOS_PATH_RE = /\/channel\/[^/]+\/videos(\/upload)?\/?$/;
  const isContentVideosPage = () => CONTENT_VIDEOS_PATH_RE.test(location.pathname);

  // ── PROOF: chạy trên trang nội dung Studio sau điều hướng ──
  async function runProof(phase) {
    const title = String(phase.title || '');
    if (!title) {
      await fail('upload_proof_failed: thiếu tiêu đề đã lưu trong phase, không kiểm chứng được video');
      return;
    }
    restoreDetails(phase.details);
    addLog(`🔎 Đang tìm video "${title.slice(0, 60)}" trong danh sách nội dung Studio...`);
    const startedAt = Number(phase.provingStartedAt) || Date.now();
    const titleNorm = normalizeUiText(title);
    const titleFrag = titleNorm.slice(0, Math.min(40, titleNorm.length));

    const findRow = () => {
      const rows = queryShadowAll('ytcp-video-row');
      for (const row of rows) {
        const titleEl = row.querySelector('#video-title, a#video-title-link, [id="video-title"]');
        const rowTitle = normalizeUiText(titleEl ? (titleEl.textContent || titleEl.getAttribute('aria-label')) : '');
        if (!rowTitle) continue;
        if (rowTitle !== titleNorm && !rowTitle.startsWith(titleFrag)) continue;
        const link = row.querySelector('a[href*="/video/"]');
        const href = link ? String(link.getAttribute('href') || link.href || '') : '';
        const m = /\/video\/([A-Za-z0-9_-]{11})/.exec(href);
        if (m) return { videoId: m[1], rowTitle };
      }
      return null;
    };

    // (2.9.2, vòng vá proof) Trang nội dung cũng có thể dừng ở trang
    // chặn trình duyệt như trang Studio lúc mở — bản vá 2.9.1 mới xử
    // lý tường ở pha sẵn sàng. Bằng chứng live 2026-11-05: video ĐÃ
    // đăng công khai thành công nhưng proof fail vì trang nội dung
    // kẹt tường, không dòng nào render trong 90s. Nên vòng poll ở đây
    // cũng phải tự bấm xuyên tường (tối đa 2 lần, đếm trong phase) và
    // đóng dialog hướng dẫn che danh sách.
    // (2.11.2, #93) Test live 2.11.1: biến thể tường ở trang Nội dung
    // KHÔNG khớp selector cũ `a[href*="approve_browser_access=true"]`
    // (href khác giá trị / nút không phải thẻ a), hoặc click() không
    // kích hoạt điều hướng trong headless -> poll 150s vẫn mù. Mở
    // rộng ứng viên: href chứa "approve_browser_access" (bất kỳ giá
    // trị) HOẶC text hiển thị "Chuyển thẳng đến YouTube Studio" /
    // "Continue to YouTube Studio"; bấm xong chờ 3s, nếu vẫn kẹt
    // tường và phần tử là thẻ a có href https hợp lệ chứa
    // approve_browser_access thì điều hướng thẳng location.href.
    // (2.11.4, #95) Test live 2.11.3: video công khai thật
    // (fOW7Lqe4N5U) nhưng receipt vẫn upload_proof_failed. Một gốc
    // rễ: đường dự phòng của findWallTarget khớp chữ của BANNER
    // HƯỚNG DẪN ("bỏ qua phần hướng dẫn / tiếp tục / skip /
    // continue / dismiss") khiến trang nội dung THẬT bị nhận nhầm
    // là còn tường, và guard của findByPageText (`if
    // (findWallTarget()) return null`) vô hiệu hoá luôn đường
    // proof theo text. Từ 2.11.4: findWallTarget CHỈ còn 2 tín
    // hiệu tường thật (href chứa approve_browser_access / chữ
    // hành động của chính tường); toàn bộ chữ skip/dismiss CHỈ
    // thuộc về dismissTutorial ở dưới; guard dùng isBrowserWall()
    // chặt ngay sau đây.
    let wallTries = Number(phase.proofWallTries) || 0;
    const findWallTarget = () => {
      const pool = queryShadowAll('a, button, [role="button"]');
      const byHref = pool.find(el => isVisible(el)
        && String(el.getAttribute?.('href') || '').includes('approve_browser_access'));
      if (byHref) return byHref;
      return pool.find(el => isVisible(el)
        && /chuyển thẳng đến youtube studio|continue to youtube studio/i
          .test(normalize(el.textContent || ''))) || null;
    };
    // TƯỜNG THẬT hay không — dùng cho guard của findByPageText và
    // hậu kiểm sau khi bấm xuyên tường. Ngoài ứng viên bấm được ở
    // trên, chỉ tính là tường khi toàn văn trang mang tiêu đề đặc
    // trưng của trang chặn ("Cải thiện trải nghiệm của bạn" /
    // "unsupported browser" / "không được hỗ trợ") VÀ app Studio
    // chưa hề nạp (không hàng video, không marker của app). Banner
    // hướng dẫn trên trang nội dung thật không bao giờ thỏa cả
    // hai vế.
    const WALL_HEADING_RE = /cải thiện trải nghiệm của bạn|unsupported browser|browser (is )?not supported|không được hỗ trợ/i;
    const isBrowserWall = () => {
      if (findWallTarget()) return true;
      if (queryShadowAll('ytcp-video-row').length > 0) return false;
      if (queryShadow('ytcp-app, ytcp-navigation-drawer, #create-icon, ytcp-button#create-button')) return false;
      return WALL_HEADING_RE.test(normalize(document.body?.innerText || ''));
    };
    const clearWall = async () => {
      const target = findWallTarget();
      if (!target) return false;
      doClick(target);
      await sleep(3000);
      // Sau 3s vẫn kẹt tường (kiểm tra tường chặt + danh sách chưa
      // render) và phần tử khớp là thẻ a có href hợp lệ -> đi thẳng.
      const stillWalled = isBrowserWall()
        && queryShadowAll('ytcp-video-row').length === 0;
      if (stillWalled && target.tagName === 'A') {
        const href = String(target.getAttribute?.('href') || target.href || '');
        if (/^https:\/\//i.test(href) && href.includes('approve_browser_access')) {
          addLog('↪ Bấm không qua được tường — điều hướng thẳng theo link approve_browser_access');
          location.href = href;
          await sleep(3000);
        }
      }
      return true;
    };

    // (2.11.3, #94) Test live 2.11.2: clearWall ĐÃ xuyên được tường
    // trình duyệt, nhưng sau tường còn 1 lớp nữa — banner hướng dẫn
    // Studio (onboarding) che danh sách + SPA nạp chậm, khiến
    // findRow (chỉ dựa vào ytcp-video-row + selector tiêu đề trong
    // hàng) không thấy video trong 150s dù video đã công khai thật.
    // Hai đường vá, chạy MỖI vòng poll:
    // (a) thấy nút đóng banner hướng dẫn thì bấm 1 lần cho mỗi banner
    //     khác nhau (chữ ký theo text/aria; tối đa 3 lần/phiên proof
    //     để tránh bấm lặp vô hạn);
    // (b) đường proof dự phòng theo TOÀN VĂN trang: trang đã qua
    //     tường (không còn ứng viên tường) + không còn dialog upload
    //     mở + innerText chứa đúng tiêu đề cần tìm -> coi như thấy,
    //     ghi details proof_via=text. Cố trích id video từ anchor
    //     /video/<id> nằm trong vùng chứa tiêu đề; không trích được
    //     thì complete không kèm result_url.
    const dismissedTutorials = new Set();
    let tutorialDismissCount = 0;
    const TUTORIAL_TEXT_RE = /bỏ qua( phần)? hướng dẫn|skip( tutorial)?|để sau|later/i;
    const findTutorialDismiss = () => {
      const pool = queryShadowAll('a, button, ytcp-button, [role="button"]');
      const byText = pool.find(el => {
        if (!isVisible(el)) return false;
        const t = normalize(el.textContent || '');
        return t.length > 0 && t.length <= 80 && TUTORIAL_TEXT_RE.test(t);
      });
      if (byText) {
        return { el: byText, sig: `text:${normalize(byText.textContent || '').slice(0, 40)}` };
      }
      const byAria = pool.find(el => {
        if (!isVisible(el)) return false;
        if (!/^(đóng|close)$/i.test(normalize(el.getAttribute?.('aria-label') || ''))) return false;
        let p = el;
        for (let i = 0; i < 6 && p; i++) {
          const tag = String(p.tagName || '').toLowerCase();
          const cls = typeof p.className === 'string' ? p.className.toLowerCase() : '';
          if (tag.includes('banner') || tag.includes('onboarding') || cls.includes('banner')) return true;
          p = p.parentElement;
        }
        return false;
      });
      if (byAria) return { el: byAria, sig: 'aria:close-banner' };
      return null;
    };
    const dismissTutorial = async () => {
      if (tutorialDismissCount >= 3) return false;
      const found = findTutorialDismiss();
      if (!found || dismissedTutorials.has(found.sig)) return false;
      dismissedTutorials.add(found.sig);
      tutorialDismissCount += 1;
      addLog('🧭 Đóng banner/hướng dẫn Studio đang che danh sách nội dung...');
      doClick(found.el);
      await sleep(1500);
      return true;
    };

    const findByPageText = () => {
      // Chưa qua tường THẬT -> toàn văn là trang chặn, không tin
      // được. (2.11.4, #95) Guard dùng isBrowserWall() chặt thay
      // cho findWallTarget() cũ — bản cũ dính đường dự phòng chữ
      // banner hướng dẫn nên đường này bị tắt oan trên trang nội
      // dung thật (test live 2.11.3).
      if (isBrowserWall()) return null;
      // Dialog upload còn mở thì tiêu đề nằm trong ô nhập của dialog
      // chứ không phải trong danh sách — không dùng đường này.
      const dialog = queryShadowAll('ytcp-uploads-dialog');
      if (dialog.some(d => isVisible(d))) return null;
      const pageText = normalizeUiText(document.body?.innerText || '');
      if (pageText.length < 200) return null;
      if (!pageText.includes(titleNorm)) return null;
      let videoId = null;
      for (const a of queryShadowAll('a[href*="/video/"]')) {
        const href = String(a.getAttribute('href') || a.href || '');
        const m = /\/video\/([A-Za-z0-9_-]{11})/.exec(href);
        if (!m) continue;
        const holder = a.closest('ytcp-video-row, tr') || a.parentElement;
        const near = normalizeUiText(holder ? (holder.textContent || '') : (a.textContent || ''));
        if (near.includes(titleFrag)) { videoId = m[1]; break; }
      }
      return { videoId };
    };

    let reloaded = Boolean(phase.proofReloadTried);
    for (;;) {
      // (2.11.5, #96) Heartbeat MỖI vòng poll: chạm updatedAt +
      // lastPollAt vào phase và touchActivity cho kernel — proof
      // đang chạy thật thì để lại dấu vết sống liên tục, không
      // phiên nào bị đóng dấu uncertain oan. (Test live 2.11.4
      // chết ở khâu CHUYỂN TRANG trước khi vào vòng này; nay
      // chuyển trang bằng URL trực tiếp + resume chắc, vòng này
      // là nơi proof sống thật.)
      await setPhase('proving', { updatedAt: Date.now(), lastPollAt: Date.now() }).catch(() => {});
      touchActivity();
      // (#94a) Đóng banner hướng dẫn che danh sách trước khi tìm.
      await dismissTutorial();
      const hit = findRow();
      if (hit) {
        await complete(`https://www.youtube.com/watch?v=${hit.videoId}`,
          `video "${hit.rowTitle.slice(0, 60)}" hiện trong danh sách nội dung Studio (id ${hit.videoId})`);
        return;
      }
      // (#94b) Dự phòng: hàng không render dạng ytcp-video-row khớp
      // selector nhưng tiêu đề đã có trong toàn văn trang (đã qua
      // tường) -> video thật sự đã lên danh sách.
      const textHit = findByPageText();
      if (textHit) {
        if (!detailCodes.includes('proof_via=text')) detailCodes.push('proof_via=text');
        await complete(
          textHit.videoId ? `https://www.youtube.com/watch?v=${textHit.videoId}` : null,
          `tiêu đề "${title.slice(0, 60)}" có trong toàn văn trang nội dung Studio (proof_via=text${textHit.videoId ? `, id ${textHit.videoId}` : ', không trích được id video'})`);
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 150000) break;
      // Chưa có dòng nào render + còn lượt xuyên tường: bấm xuyên qua
      // (full navigation — bản inject mới tự vào lại vòng này, ngân
      // sách tính tiếp từ provingStartedAt đã lưu).
      if (wallTries < 2 && queryShadowAll('ytcp-video-row').length === 0 && await clearWall()) {
        wallTries += 1;
        await setPhase('proving', { proofWallTries: wallTries });
        addLog('↻ Trang nội dung kẹt tường trình duyệt — đã bấm xuyên qua, chờ bản mới...');
        await sleep(10000);
        return;
      }
      // Quá nửa ngân sách mà chưa thấy: làm mới trang nội dung đúng
      // 1 lần (danh sách Studio cache mạnh, video mới đăng có thể
      // chưa kịp vào bản đang hiển thị).
      if (!reloaded && elapsed >= 60000) {
        reloaded = true;
        await setPhase('proving', { proofReloadTried: true });
        addLog('↻ Chưa thấy video sau 60s — làm mới trang nội dung 1 lần...');
        // (2.11.4, #95) KHÔNG location.reload(): runner lọc trùng
        // inject theo URL nên reload CÙNG URL không nạp lại content
        // script -> pha proof resume chết (test live 2.11.3). Thay
        // bằng location.assign tới cùng URL cộng tham số vô hại
        // autovjp_proof=<ts>: URL khác hẳn -> runner inject bản
        // mới; matcher trang đích chỉ nhìn pathname nên vẫn khớp
        // /channel/<id>/videos; ngân sách proof tính tiếp từ
        // provingStartedAt đã lưu trong phase. Poll trong cùng
        // document vẫn là đường chính — assign chỉ là dự phòng
        // như reload trước đây.
        try {
          const u = new URL(location.href);
          u.searchParams.set('autovjp_proof', String(Date.now()));
          location.assign(u.href);
        } catch (_) {
          location.reload();
        }
        await sleep(30000); // chờ trang mới thay thế — bản inject mới chạy tiếp
        return;
      }
      touchActivity();
      await sleep(3000);
    }
    await fail(`upload_proof_failed: đã bấm Đăng nhưng không thấy video "${title.slice(0, 60)}" trong danh sách nội dung Studio sau 150s`);
  }

  // ── MAIN ──
  try {
    const phase = await getPhase();
    if (phase?.phase === 'done') return;
    if (phase?.phase === 'proving') {
      // (2.11.5, #96) RESUME: điều kiện duy nhất là phase 'proving'
      // của đúng task này — getPhase() đã khớp taskId trong phase
      // với taskId của run hiện tại (điều kiện owner), không dựa
      // thêm cờ phụ nào dễ mất. Hai chỗ gãy của bản cũ:
      // (a) lạc trang thì nó gán URL TRẦN .../videos (không có
      //     autovjp_proof) — đúng bẫy lọc-trùng-inject-theo-URL mà
      //     #95 đã vá trong runProof nhưng sót ở đây: URL đã từng
      //     thăm có thể không được inject bản mới, nên sau điều
      //     hướng không bản nào kích hoạt resume.
      // (b) không có channel id thì rơi thẳng xuống runProof ngay
      //     trên trang lạ (trang chủ Studio / mặt dialog
      //     /videos/upload): đốt oan ngân sách 150s ở nơi không
      //     bao giờ có danh sách video.
      // Nay: đã ở đúng trang đích (isContentVideosPage, matcher
      // pathname của #95) -> chạy tiếp runProof ngay; lạc trang +
      // có channel id -> assign URL kèm autovjp_proof rồi rút, bàn
      // giao cho bản inject ở trang đích; lạc trang + chưa có
      // channel id -> chạm lastPollAt để lại dấu vết (điểm 3) rồi
      // rút, KHÔNG chạy runProof sai bề mặt.
      if (!isContentVideosPage()) {
        const cid = phase.channelId || channelIdFromPage();
        if (cid) {
          await setPhase('proving', { channelId: cid, lastPollAt: Date.now() });
          location.assign(`https://studio.youtube.com/channel/${cid}/videos?autovjp_proof=${Date.now()}`);
          await sleep(30000); // chờ trang mới thay thế — bản inject mới resume
        } else {
          await setPhase('proving', { lastPollAt: Date.now() }).catch(() => {});
        }
        return;
      }
      const freshPhase = (await getPhase()) || phase;
      await runProof(freshPhase);
      return;
    }

    addLog('Khởi động tiến trình upload video YouTube Studio...');
    await sleep(2500);

    // Chưa đăng nhập: runner đã chặn trang auth trước khi inject,
    // nhưng Studio SPA vẫn có thể đẩy về đăng nhập sau đó.
    if (location.hostname.includes('accounts.google.com')) {
      await fail('session_expired: YouTube đẩy về trang đăng nhập Google — dừng task, không lách.');
      return;
    }

    // 1. CHUẨN BỊ FILE (chỉ 1 video — dialog upload nhận 1 file/lần)
    let rawMedia = [];
    try {
      const raw = run.images || run.media_urls || run.images_json;
      rawMedia = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (e) { /* ignore */ }
    const mediaUrls = rawMedia.map(u => typeof u === 'string' ? u : (u && (u.url || u.src))).filter(Boolean);
    if (!mediaUrls.length) {
      await fail('media_load_failed: task upload không có media (images/media_urls rỗng)');
      return;
    }
    if (mediaUrls.length > 1) addLog(`⚠️ Upload chỉ đăng 1 video/lần — dùng file đầu trong ${mediaUrls.length} file`);
    const videoUrl = mediaUrls[0];

    // Tiêu đề/mô tả đã chốt ở lần chạy trước (trang tải lại giữa
    // chừng) thì dùng lại, không gọi AI lại.
    let title = String(phase?.title || '');
    let description = phase?.description != null ? String(phase.description) : null;
    if (phase?.details) restoreDetails(phase.details);
    let isShort = phase?.isShort != null ? phase.isShort : null;

    // Bắt đầu xin AI SỚM (không await) để lời gọi 70s chạy song song
    // với việc tải file + mở dialog; chỉ await khi tới bước điền.
    const aiPrompt = String(run.ai_prompt || '').trim();
    const sourceContent = String(run.content || run.post_content || '').trim();
    let aiPromise = null;
    if (aiPrompt && !title) {
      addLog('🤖 Có ai_prompt — đang xin AI viết tiêu đề + mô tả (deadline 70s, chạy song song)...');
      const aiReq = [
        aiPrompt,
        'Yêu cầu định dạng bắt buộc cho video YouTube: dòng đầu tiên là TIÊU ĐỀ video (tối đa 100 ký tự, không dấu ngoặc kép). Từ dòng thứ hai trở đi là MÔ TẢ video. Chỉ xuất đúng tiêu đề và mô tả, không giải thích, không phân tích.',
        sourceContent ? `Chất liệu từ nội dung task:\n${sourceContent.slice(0, 1500)}` : ''
      ].filter(Boolean).join('\n\n');
      aiPromise = requestAiText(aiReq);
    }

    addLog('Tải video qua background...');
    const res = await fetchImageViaBackground(videoUrl);
    if (!res || !res.dataUrl) {
      await fail(`media_load_failed: không tải được video (${videoUrl})`);
      return;
    }
    const urlBase = (() => {
      try { return decodeURIComponent(new URL(videoUrl).pathname.split('/').pop() || ''); } catch (_) { return ''; }
    })();
    const fileName = /\.(mp4|webm|mov|m4v|mkv)$/i.test(urlBase) ? urlBase : `youtube_upload_${Date.now()}.mp4`;
    let rawMime = (res.type || (res.dataUrl.split(';')[0].split(':')[1] || '')).trim().toLowerCase();
    if (!rawMime || rawMime === 'application/octet-stream' || rawMime === 'binary/octet-stream') {
      rawMime = String(run.resolved_media_type || '').toLowerCase();
    }
    const finalMime = rawMime.startsWith('video/') ? rawMime : 'video/mp4';
    const file = dataURLtoFile(res.dataUrl, fileName, finalMime);
    addLog(`✅ Đã nạp video (${Math.round(file.size / 1024)} KB, ${fileName})`);

    // Đo metadata (dọc + <=60s = Shorts) TRƯỚC khi tải — phục vụ
    // details is_short. Đo không được thì bỏ qua trường này.
    if (isShort === null) {
      const meta = await new Promise(resolve => {
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        try {
          const objUrl = URL.createObjectURL(file);
          const v = document.createElement('video');
          v.preload = 'metadata';
          v.muted = true;
          const timer = setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch (_) {} finish(null); }, 15000);
          v.onloadedmetadata = () => {
            clearTimeout(timer);
            const m = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
            try { URL.revokeObjectURL(objUrl); } catch (_) {}
            finish(m);
          };
          v.onerror = () => { clearTimeout(timer); try { URL.revokeObjectURL(objUrl); } catch (_) {} finish(null); };
          v.src = objUrl;
        } catch (_) { finish(null); }
      });
      if (meta && meta.width > 0 && meta.height > 0 && Number.isFinite(meta.duration)) {
        isShort = meta.height > meta.width && meta.duration <= 60;
        addLog(`🎞 Metadata: ${meta.width}x${meta.height}, ${Math.round(meta.duration)}s -> is_short=${isShort}`);
      }
    }
    if (isShort !== null && !detailCodes.some(c => c.startsWith('is_short='))) {
      detailCodes.push(`is_short=${isShort}`);
    }

    await setPhase('uploading', { isShort });

    // 2. CHỜ STUDIO SẴN SÀNG + rà soát đăng nhập/kênh
    // Nút Create là tín hiệu Studio đã sẵn sàng cho tài khoản có kênh.
    // Song song: thấy dấu hiệu "chưa có kênh" (Studio hiện lời mời tạo
    // kênh) mà không có nút Create -> no_youtube_channel; thấy bề mặt
    // đăng nhập -> session_expired.
    // BẰNG CHỨNG LIVE (probe 2026-11-05, FORK-CHANGES #88): trong
    // Chrome headless công nhân, studio.youtube.com KHÔNG vào thẳng
    // dashboard — nó dừng ở trang chặn "trình duyệt không được hỗ
    // trợ" (title "YouTube Creator Studio", chỉ có link các trình
    // duyệt + link đi thẳng). Phải bấm link "Chuyển thẳng đến YouTube
    // Studio" (href chứa approve_browser_access=true) thì mới điều
    // hướng (full navigation) sang /channel/<id> và dashboard hiện
    // ra: nút Create là ytcp-button text "Tạo" với button con mang
    // aria-label "Tạo" (bản EN: "Create") — không có #create-button/
    // #create-icon. Kèm theo có dialog chào mừng "Chào mừng bạn đến
    // với YouTube Studio" (tp-yt-paper-dialog, nút #dismiss-button
    // "Tiếp tục") và banner "Bỏ qua phần hướng dẫn" cần dọn trước.
    const findCreateBtn = () => queryShadow('#create-icon, ytcp-button#create-button, button[aria-label*="Create" i], button[aria-label*="Tạo" i], [aria-label="Create" i]')
      || queryShadowAll('ytcp-button, button').find(el => isVisible(el) && /^(create|tạo)$/i.test(normalize(el.textContent || '')))
      || null;
    const findFileInput = () => queryShadow('ytcp-uploads-dialog input[type="file"], input[type="file"][name="Filedata"]');
    const findBrowserSkipLink = () => {
      const byHref = queryShadow('a[href*="approve_browser_access=true"]');
      if (byHref && isVisible(byHref)) return byHref;
      return queryShadowAll('a, button').find(el => isVisible(el)
        && /chuyển thẳng đến youtube studio|skip straight to youtube studio/i.test(normalize(el.textContent || ''))) || null;
    };
    let lastDismissAt = 0;
    const dismissOnboarding = () => {
      const now = Date.now();
      if (now - lastDismissAt < 3000) return;
      const skipGuide = queryShadowAll('ytcp-button, button').find(el => isVisible(el)
        && /^(bỏ qua phần hướng dẫn|skip guide|skip the guide)$/i.test(normalize(el.textContent || '')));
      if (skipGuide) {
        lastDismissAt = now;
        doClick(skipGuide);
        addLog('👉 Đã bỏ qua banner hướng dẫn của Studio');
        return;
      }
      const dialogs = queryShadowAll('tp-yt-paper-dialog, ytcp-dialog');
      for (const d of dialogs) {
        if (!isVisible(d)) continue;
        if (!/chào mừng bạn đến với youtube studio|welcome to youtube studio/i.test(normalize(d.textContent || ''))) continue;
        const btn = d.querySelector('#dismiss-button')
          || [...d.querySelectorAll('button, ytcp-button')].find(el => /^(tiếp tục|continue|đóng|close|ok)$/i.test(normalize(el.textContent || '')));
        if (btn) {
          lastDismissAt = now;
          doClick(btn);
          addLog('👉 Đã đóng dialog chào mừng của Studio');
          return;
        }
      }
    };
    const noChannelMarker = () => {
      const els = queryShadowAll('button, a, ytcp-button');
      return els.some(el => isVisible(el) && /(tạo kênh|create (a )?channel)/i.test(normalize(el.textContent || '')));
    };
    const loginMarker = () => Boolean(queryShadow('a[href*="ServiceLogin"], tp-yt-paper-button[aria-label*="Sign in" i]'))
      || /\/signin|\/login/.test(location.pathname);

    let studioReady = null;
    {
      // Ngân sách 90s (Studio SPA nạp chậm trong headless); bấm link
      // đi thẳng qua trang chặn thì gia hạn thêm 60s cho dashboard
      // kịp hiện. Số lần bấm link chặn lưu trong phase (tối đa 2 lần
      // qua mọi lần inject) để tránh vòng lặp điều hướng vô hạn.
      let deadline = Date.now() + 90000;
      let markerSince = 0;
      const ph0 = await getPhase();
      let skipTries = Number(ph0?.studioSkipTries || 0);
      let skipClickedAt = 0;
      while (Date.now() < deadline && !studioReady) {
        if (loginMarker()) { studioReady = 'login'; break; }
        if (findCreateBtn() || findFileInput() || findTitleBox()) { studioReady = 'ok'; break; }
        const skipLink = findBrowserSkipLink();
        if (skipLink && skipTries < 2 && Date.now() - skipClickedAt > 4000) {
          skipTries += 1;
          skipClickedAt = Date.now();
          await setPhase('uploading', { studioSkipTries: skipTries });
          addLog(`👉 Studio đang ở trang chặn trình duyệt — bấm "Chuyển thẳng đến YouTube Studio" (lần ${skipTries})`);
          doClick(skipLink);
          deadline = Math.max(deadline, Date.now() + 60000);
          await sleep(2500);
          continue;
        }
        dismissOnboarding();
        if (noChannelMarker()) {
          if (!markerSince) markerSince = Date.now();
          if (Date.now() - markerSince >= 5000) { studioReady = 'nochannel'; break; }
        }
        touchActivity();
        await sleep(700);
      }
    }
    if (studioReady === 'login') {
      await fail('session_expired: YouTube Studio chưa đăng nhập (hiện nút Sign in) — dừng task, không lách.');
      return;
    }
    if (studioReady === 'nochannel') {
      await fail('no_youtube_channel: Tài khoản YouTube chưa có kênh — Studio bắt tạo kênh mới tải video được.');
      return;
    }
    if (studioReady !== 'ok') {
      await fail('studio_not_ready: Studio không sẵn sàng sau 90s (không thấy nút Create/dialog upload)');
      return;
    }
    if (verificationPromptVisible()) {
      await fail('youtube_verification_required: YouTube đòi xác minh số điện thoại/danh tính — dừng, không lách.');
      return;
    }

    // 3. MỞ DIALOG UPLOAD + NẠP FILE (restart-tolerant: nếu dialog đã
    // ở bước chi tiết — có ô tiêu đề — thì file đã được nạp ở lần chạy
    // trước, bỏ qua toàn bộ mục này). findTitleBox/findDescBox ở phần
    // helper phía trên.
    if (!findTitleBox()) {
      let fileInput = findFileInput();
      if (!fileInput) {
        const createBtn = findCreateBtn();
        if (createBtn) {
          doClick(createBtn);
          addLog('👉 Đã bấm nút Create/Tạo của Studio');
          await sleep(1200);
        }
        const uploadItem = await pollUntil(() => {
          const items = queryShadowAll('ytcp-text-menu-item, tp-yt-paper-item, [role="menuitem"]');
          return items.find(el => /upload videos|tải video lên/i.test(normalize(el.textContent || '')))
            || queryShadow('ytcp-text-menu-item[test-id="upload-video"], #text-item-0');
        }, 10000, 400);
        if (uploadItem) {
          doClick(uploadItem);
          addLog('👉 Đã chọn "Upload videos / Tải video lên"');
        }
        fileInput = await pollUntil(() => findFileInput(), 20000, 500);
      }
      if (!fileInput) {
        await fail('studio_not_ready: không mở được dialog tải video (không thấy input file trong ytcp-uploads-dialog)');
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(file);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
      if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      addLog('📦 Đã nạp file vào dialog upload, chờ bước chi tiết...');

      const detailsReady = await pollUntil(() => {
        if (verificationPromptVisible()) return 'verify';
        const errText = normalize(queryShadow('ytcp-uploads-dialog')?.textContent || '');
        if (/không tải lên được|định dạng tệp không hợp lệ|invalid file|upload failed/i.test(errText) && !findTitleBox()) return 'rejected';
        return findTitleBox() ? 'ok' : null;
      }, 120000, 800);
      if (detailsReady === 'verify') {
        await fail('youtube_verification_required: YouTube đòi xác minh số điện thoại/danh tính khi tải video — dừng, không lách.');
        return;
      }
      if (detailsReady === 'rejected') {
        await fail('media_load_failed: YouTube từ chối file video (định dạng không hợp lệ hoặc tải lên thất bại)');
        return;
      }
      if (detailsReady !== 'ok') {
        await fail('studio_not_ready: đã nạp file nhưng dialog không chuyển sang bước chi tiết (không thấy ô tiêu đề) sau 120s');
        return;
      }
    }
    addLog('✅ Dialog upload đã ở bước chi tiết');

    // 4. CHỐT TIÊU ĐỀ + MÔ TẢ (AI hoặc nội dung gốc)
    if (!title) {
      if (aiPromise) {
        const aiRes = await aiPromise;
        if (aiRes?.success && aiRes.text) {
          const aiLines = String(aiRes.text).split('\n').map(s => s.trim());
          const firstIdx = aiLines.findIndex(s => s);
          if (firstIdx >= 0) {
            title = cleanAiTitle(aiLines[firstIdx]);
            description = aiLines.slice(firstIdx + 1).join('\n').trim();
          }
        }
        if (title) {
          detailCodes.push('ai_used');
          addLog(`🤖 AI viết tiêu đề: "${title}"`);
        } else {
          detailCodes.push('ai_fallback');
          addLog(`⚠️ AI lỗi/không dùng được (${aiRes?.error || 'rỗng'}) — ai_fallback: dùng nội dung gốc`);
        }
      }
      if (!title) {
        const contentLines = sourceContent.split('\n').map(s => s.trim());
        const firstIdx = contentLines.findIndex(s => s);
        const taskTitle = String(run.title || '').trim();
        if (taskTitle) {
          title = taskTitle.slice(0, 100);
          description = sourceContent;
        } else if (firstIdx >= 0) {
          title = contentLines[firstIdx].slice(0, 100);
          description = contentLines.slice(firstIdx + 1).join('\n').trim();
        } else {
          title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 100) || 'Video mới';
          description = '';
        }
      }
      await setPhase('uploading', { title, description, details: detailsValue(), isShort });
    }

    // Điền 1 ô contenteditable của Studio: focus -> selectAll ->
    // insertText (đường Polymer đáp ứng tốt nhất), dự phòng gán
    // textContent + sự kiện input. Kiểm chứng bằng nội dung đọc lại.
    async function fillTextbox(box, value, label) {
      if (!box) return false;
      try { box.focus(); } catch (_) {}
      doClick(box);
      await sleep(250);
      try { document.execCommand('selectAll', false, null); } catch (_) {}
      let wrote = false;
      try { wrote = document.execCommand('insertText', false, value); } catch (_) { wrote = false; }
      if (!wrote || !normalize(box.textContent).startsWith(normalize(value).slice(0, 15))) {
        box.textContent = value;
        box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await sleep(400);
      const ok = normalize(box.textContent).startsWith(normalize(value).slice(0, Math.min(20, normalize(value).length || 1)))
        || normalizeUiText(box.textContent).includes(normalizeUiText(value).slice(0, 25));
      addLog(ok ? `✍️ Đã điền ${label}: "${normalize(value).slice(0, 60)}"` : `⚠️ Điền ${label} chưa khớp khi đọc lại`);
      return ok;
    }

    const titleBox = findTitleBox();
    if (!titleBox) {
      await fail('studio_not_ready: mất ô tiêu đề ở bước chi tiết trước khi điền');
      return;
    }
    // Ô tiêu đề có thể đã mang tên file mặc định — luôn ghi đè bằng
    // tiêu đề đã chốt; chỉ bỏ qua khi đọc lại đã đúng (restart).
    if (!normalizeUiText(titleBox.textContent).startsWith(normalizeUiText(title).slice(0, 30))) {
      const filled = await fillTextbox(titleBox, title, 'tiêu đề');
      if (!filled) {
        await fail('studio_not_ready: không điền được tiêu đề vào dialog upload');
        return;
      }
    }
    const descBox = findDescBox();
    if (descBox && description) {
      if (!normalizeUiText(descBox.textContent).startsWith(normalizeUiText(description).slice(0, 30))) {
        await fillTextbox(descBox, description, 'mô tả'); // mô tả fail không chặn đăng
      }
    }

    // 5. ĐỐI TƯỢNG NGƯỜI XEM: chọn "Không dành cho trẻ em" (bắt buộc
    // mới đi tiếp được các bước sau).
    const findKidsRadio = () => queryShadow('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
    const radioChecked = el => Boolean(el) && (el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true' || el.checked === true);
    let kidsRadio = await pollUntil(() => findKidsRadio(), 20000, 500);
    if (!kidsRadio) {
      await fail('studio_not_ready: không thấy lựa chọn đối tượng người xem (radio "Không dành cho trẻ em") trong dialog');
      return;
    }
    if (!radioChecked(kidsRadio)) {
      doClick(kidsRadio);
      const confirmed = await pollUntil(() => radioChecked(findKidsRadio()) ? true : null, 6000, 400);
      if (!confirmed) {
        // Bấm lại vào phần tử radio con (#radioContainer/#ink) — vài
        // bản Studio chỉ nhận click ở lớp trong.
        const inner = kidsRadio.querySelector('#radioContainer, #offRadio, #onRadio') || kidsRadio.shadowRoot?.querySelector('#radioContainer');
        if (inner) doClick(inner);
        const confirmed2 = await pollUntil(() => radioChecked(findKidsRadio()) ? true : null, 6000, 400);
        if (!confirmed2) {
          await fail('studio_not_ready: bấm "Không dành cho trẻ em" nhưng lựa chọn không được ghi nhận');
          return;
        }
      }
    }
    addLog('✅ Đã chọn đối tượng: Không dành cho trẻ em');

    // 6. ĐI QUA CÁC BƯỚC (Chi tiết -> Thành phần -> Kiểm tra -> Hiển
    // thị). Cảnh báo ở bước Kiểm tra (vd bản quyền) KHÔNG chặn nếu nút
    // vẫn đi tiếp được — chỉ cổng xác minh mới chặn.
    const findNextBtn = () => queryShadow('#next-button, ytcp-button#next-button');
    const findDoneBtn = () => queryShadow('#done-button, ytcp-button#done-button');
    const btnEnabled = el => Boolean(el) && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
    const visibilityVisible = () => Boolean(queryShadow('tp-yt-paper-radio-button[name="PUBLIC"], tp-yt-paper-radio-button[name="UNLISTED"]'));

    for (let step = 0; step < 4; step++) {
      if (visibilityVisible() && findDoneBtn()) break;
      if (verificationPromptVisible()) {
        await fail('youtube_verification_required: YouTube đòi xác minh số điện thoại/danh tính ở bước giữa — dừng, không lách.');
        return;
      }
      const nextBtn = await pollUntil(() => {
        touchActivity();
        const b = findNextBtn();
        if (visibilityVisible() && findDoneBtn()) return 'done-step';
        return btnEnabled(b) ? b : null;
      }, 30000, 600);
      if (nextBtn === 'done-step') break;
      if (!nextBtn) {
        if (visibilityVisible()) break;
        await fail(`studio_not_ready: nút Tiếp không sẵn sàng ở bước ${step + 1} sau 30s`);
        return;
      }
      doClick(nextBtn);
      addLog(`👉 Đã bấm Tiếp (bước ${step + 1})`);
      await sleep(1800);
    }
    if (verificationPromptVisible()) {
      await fail('youtube_verification_required: YouTube đòi xác minh số điện thoại/danh tính ở bước hiển thị — dừng, không lách.');
      return;
    }

    // 7. CHẾ ĐỘ HIỂN THỊ + chờ nút Đăng sẵn sàng
    const wantUnlisted = normalizeUiText(run.visibility || 'public') === 'unlisted';
    const visName = wantUnlisted ? 'UNLISTED' : 'PUBLIC';
    const visRadio = await pollUntil(() => queryShadow(`tp-yt-paper-radio-button[name="${visName}"]`), 30000, 600);
    if (!visRadio) {
      await fail('studio_not_ready: không tới được bước chế độ hiển thị (không thấy radio Public/Unlisted)');
      return;
    }
    if (!radioChecked(visRadio)) {
      doClick(visRadio);
      await pollUntil(() => radioChecked(queryShadow(`tp-yt-paper-radio-button[name="${visName}"]`)) ? true : null, 6000, 400);
    }
    addLog(`✅ Đã chọn hiển thị: ${wantUnlisted ? 'Không công khai (unlisted)' : 'Công khai (public)'}`);

    // Nút Đăng/Xong chỉ bật khi upload + kiểm tra đủ điều kiện. Chờ
    // tối đa 10 phút (video dài tải chậm), chạm hoạt động định kỳ.
    const doneReady = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 600000) {
        if (verificationPromptVisible()) return 'verify';
        const b = findDoneBtn();
        if (btnEnabled(b)) return b;
        touchActivity();
        await sleep(3000);
      }
      return null;
    })();
    if (doneReady === 'verify') {
      await fail('youtube_verification_required: YouTube đòi xác minh số điện thoại/danh tính trước khi đăng — dừng, không lách.');
      return;
    }
    if (!doneReady) {
      await fail('studio_not_ready: nút Đăng/Xong không bật sau 10 phút chờ upload/xử lý');
      return;
    }
    doClick(doneReady);
    addLog('👉 Đã bấm Đăng/Xong — chờ xác nhận rồi đi kiểm chứng');
    await sleep(4000);

    // 8. PROOF: chuyển sang trang Nội dung của Studio bằng ĐIỀU
    // HƯỚNG URL TRỰC TIẾP. (2.11.5, #96) BỎ hẳn đường bấm mục "Nội
    // dung/Content" ở drawer trái: test live 2.11.4 — video đăng
    // công khai thật (kênh tăng 4 -> 5 video) nhưng script chết ở
    // chính nhánh đó. Bấm drawer là điều hướng SPA (không tải lại
    // trang -> không inject mới); nhánh cũ bấm xong sleep 30s rồi
    // CHỈ chạy runProof khi URL tình cờ đáp đúng
    // /channel/<id>/videos, mọi trường hợp còn lại `return` lặng —
    // phase kẹt 'proving', không ai chạy tiếp, kernel đóng dấu
    // uncertain sau 5 phút không hoạt động. Nay: lưu phase (kèm
    // dấu vết provingEnteredAt/lastPollAt — điểm 3 của #96) rồi
    // location.assign thẳng tới URL trang nội dung cộng tham số
    // autovjp_proof (URL khác -> runner inject bản mới; bản đó
    // resume runProof từ phase — nhánh resume ở MAIN).
    let channelId = channelIdFromPage();
    const provingEnteredAt = Date.now();
    await setPhase('proving', {
      title, description, details: detailsValue(), isShort,
      provingStartedAt: provingEnteredAt, provingEnteredAt,
      lastPollAt: provingEnteredAt, channelId: channelId || null
    });
    if (!channelId) {
      // Chưa thấy channel id trên trang dialog: đi qua trang chủ
      // Studio (nó tự chuyển hướng sang /channel/<id>/...) — bản
      // inject ở trang đích đọc phase 'proving', tự lấy channel id
      // tại đó rồi đi tiếp (nhánh resume ở MAIN). Code sau assign
      // trong document này không chạy nữa — đúng ý đồ: công việc
      // bàn giao qua phase, không qua document cũ.
      location.assign('https://studio.youtube.com');
      await sleep(30000); // chờ trang mới thay thế — bản inject mới resume proof
      return;
    }
    addLog('Điều hướng sang trang nội dung Studio để kiểm chứng...');
    location.assign(`https://studio.youtube.com/channel/${channelId}/videos?autovjp_proof=${provingEnteredAt}`);
    await sleep(30000); // chờ trang mới thay thế — bản inject mới chạy runProof
    // Nếu assign không rời khỏi document này (điều hướng bị nuốt)
    // mà ta đã ở đúng trang đích: tự chạy proof tại chỗ thay vì
    // chết lặng như nhánh drawer cũ.
    if (!reported && isContentVideosPage()) {
      const p2 = await getPhase();
      if (p2?.phase === 'proving') await runProof(p2);
    }
  } catch (error) {
    console.error('[Auto vjp][YT-Upload] Error:', error);
    await fail(error?.message || String(error));
  }
})();
}
