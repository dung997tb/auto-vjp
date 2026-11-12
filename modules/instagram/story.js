// Auto vjp — Instagram Story qua giao diện MOBILE web (task type
// 'story', viết lại 2.11.16). Thay bản desktop 2.7.0: IG web desktop
// KHÔNG có trình tạo story (probe live 2026-11-05 — nút Tạo chỉ mở
// dialog đăng BÀI), nên đường desktop là ngõ cụt. Đường mobile đã
// được spike kiểm chứng SỐNG 2026-11-12 trên nuc (nick
// @langlehoaanhdao): runner gắn giả lập thiết bị (metrics Pixel 8 +
// touch + UA mobile, xem contract cờ emulation:'mobile' và runner.js)
// TRƯỚC khi điều hướng, trang instagram.com trả feed mobile có khay
// tin; feed có sẵn input file chỉ accept ẢNH; nạp ảnh -> trang tự
// chuyển /create/story/ (editor có canvas) -> nút "Chia sẻ tin".
//
// GIỚI HẠN V1 (cố ý, đừng tự mở rộng):
//   - CHỈ ẢNH. Payload video bị từ chối NGAY bằng failure_code
//     'media_type_unsupported' trước khi tải/nạp — input của route
//     này không nhận video.
//   - KHÔNG chèn chữ/AI overlay lên story (bản desktop có mục này;
//     V1 mobile bỏ hẳn cho luồng ngắn và chắc).
//
// Neo bề mặt (theo spike — class IG là hash obfuscated, cấm neo):
//   - Ô tạo tin: phần tử lá chứa text node đúng "Tin của bạn" (dự
//     phòng "Your story"), leo lên phần tử role=button gần nhất.
//   - Editor: URL /create/story/ + có <canvas>.
//   - Nút đăng: text node chứa "Chia sẻ tin" (dự phòng "Share to
//     story"), leo lên role=button.
//   - Proof: link /stories/<nick của mình>/ ở khay.
//
// Kỷ luật chống đăng trùng: mốc phase lưu ở storage
// (`avjpIgStoryMobilePhase`). Trước khi bấm đăng ghi 'sharing'. Bản
// inject mới (trang tải lại giữa chừng) thấy phase sharing/shared
// của đúng task thì CHỈ chạy proof, tuyệt đối không bấm đăng lại.
//
// BẢN VÁ 2.11.16 (chẩn đoán Lane E, 2026-11-12): bản cũ gộp cả
// 'file_set' vào nhóm "chỉ proof" — SAI GỐC RỄ của ca uncertain
// "editor không đóng sau 45s": nạp file xong trang CHUYỂN SANG
// document mới /create/story/ (instance ở feed chết), kernel inject
// bản mới vào editor, bản mới thấy phase file_set -> chạy proof chờ
// editor đóng 45s trong khi KHÔNG AI bấm "Chia sẻ tin" cả (biên lai
// uncertain tới từ chính nhánh proof đó; kiểm chứng: story không hề
// lên nick, editor còn nguyên trạng thái chưa bấm). Nay: phase
// 'file_set' + đang ở trang editor -> TIẾP TỤC luồng ở bước editor
// (bấm đăng); 'file_set' + đang ở feed -> chạy lại luồng chính từ
// đầu (chưa từng bấm đăng nên không thể trùng). Cơ chế bấm đã kiểm
// chứng sống cả 3 đường (chuột CDP, DOM click, chạm) — lỗi không nằm
// ở cú bấm. Proof có thêm tín hiệu toast "Đã thêm tin của bạn".
// Đã bấm đăng mà không xác minh được -> action
// postResultUnknown (status 'uncertain' — cơ chế sẵn có của kernel,
// không tự chạy lại), không bịa success. Lưu ý đã biết: results.js
// chốt type 'post' cho action postResultUnknown nên receipt của ca
// này hiện type 'post' dù là task story (task_id vẫn đúng).
//
// failure_code: mọi fail đều mang mã rõ ràng trên receipt. Nhóm mã
// chuẩn kernel (session_expired...) được tầng retry phân loại như
// thường; các mã riêng của luồng này (emulation_missing,
// media_type_unsupported, media_load_failed, story_create_not_found,
// story_editor_not_ready, story_share_not_found) CHƯA có trong
// FAILURE_CODES của contract-data nên không bao giờ tự retry — đúng
// ý: lỗi bề mặt story phải có người xem, không đăng thử lại mù.
if (window.__avjpIgStoryInjected) {
  console.log('[Auto vjp][IG-Story] Script already injected, exiting.');
} else {
window.__avjpIgStoryInjected = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Auto vjp][IG-Story]', msg);
    try { chrome.storage.local.set({ lastStatus: msg }); } catch (_) {}
    let el = document.getElementById('avjp-story-status');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'avjp-story-status';
      el.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;padding:12px 14px;border-radius:12px;color:#fff;background:rgba(15,23,42,0.95);font-size:13px;font-family:monospace;max-width:340px;white-space:pre-wrap;';
      document.body.appendChild(el);
    }
    if (el) el.textContent = logs.slice(-8).join('\n');
  }

  async function pollUntil(fn, timeoutMs, stepMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let v = null;
      try { v = await fn(); } catch (_) {}
      if (v) return v;
      await sleep(stepMs);
    }
    return null;
  }

  // ── Đọc run + phase ──
  const PHASE_KEY = 'avjpIgStoryMobilePhase';
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
  const setPhase = async (phase) => {
    await chrome.storage.local.set({ [PHASE_KEY]: { taskId, phase, at: Date.now() } });
  };
  const phase0 = await getPhase();
  if (phase0?.phase === 'done') return;
  // Phân nhánh resume theo phase + TRANG hiện tại (bản vá Lane E —
  // xem comment đầu file):
  //  - sharing/shared: đã bấm đăng (hoặc đang bấm) -> chỉ proof.
  //  - file_set + đang ở editor: instance cũ chết khi chuyển trang,
  //    bản inject này phải bấm đăng thay -> tiếp tục ở bước editor.
  //  - file_set + đang ở feed: chưa bấm đăng lần nào -> chạy luồng
  //    chính từ đầu là an toàn (không thể đăng trùng).
  const onEditorPage = location.pathname.startsWith('/create/story');
  const resumeProofOnly = !!phase0 && ['sharing', 'shared'].includes(phase0.phase);
  const resumeAtEditor = !!phase0 && phase0.phase === 'file_set' && onEditorPage;

  // ── Báo kết quả ──
  let reported = false;
  async function fail(code, message) {
    if (reported) return;
    reported = true;
    addLog(`❌ ${code}: ${message}`);
    await setPhase('done').catch(() => {});
    chrome.runtime.sendMessage(
      { action: 'storyFailed', postId: taskId, error: `${code}: ${message}`, failure_code: code },
      () => void chrome.runtime.lastError
    );
  }
  async function complete(actor, proofVia) {
    if (reported) return;
    reported = true;
    addLog(`🏁 HOÀN TẤT — proof_via=${proofVia}`);
    await setPhase('done').catch(() => {});
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'storyCompleted',
        postId: taskId,
        resultUrl: actor?.url || window.location.href,
        actorUrl: actor?.url || null,
        actorName: actor?.name || null,
        details: { proof_via: proofVia }
      }, response => resolve(response));
    });
  }
  async function unknown(message) {
    if (reported) return;
    reported = true;
    addLog(`❓ ${message}`);
    await setPhase('done').catch(() => {});
    chrome.runtime.sendMessage(
      { action: 'postResultUnknown', postId: taskId, error: message, details: { proof_via: 'unknown', task_type: 'story' } },
      () => void chrome.runtime.lastError
    );
  }

  // ── Helpers bề mặt ──
  function isLoginWall() {
    return /\/accounts\/login|\/login(\/|$|\?)/.test(location.pathname + location.search)
      || !!document.querySelector('input[type="password"]');
  }

  // Tìm phần tử bấm được theo TEXT NODE trực tiếp (khuôn spike): quét
  // các phần tử lá có childNode type 3 khớp mẫu (bằng đúng hoặc chứa),
  // lấy phần tử khớp CUỐI cùng rồi leo tối đa 5 tầng lên phần tử
  // BUTTON/A/role=button gần nhất.
  function findClickableByText(patterns, contains = false) {
    const all = document.querySelectorAll('div, span, button, a, [role="button"]');
    let hit = null;
    for (const el of all) {
      if (!el.childNodes || !el.childNodes.length) continue;
      for (const node of el.childNodes) {
        if (node.nodeType !== 3) continue;
        const text = (node.textContent || '').trim();
        if (!text) continue;
        if (patterns.some(p => contains ? text.includes(p) : text === p)) { hit = el; break; }
      }
    }
    if (!hit) return null;
    let target = hit;
    for (let i = 0; i < 5 && target.parentElement; i++) {
      if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.getAttribute('role') === 'button') break;
      target = target.parentElement;
    }
    return target;
  }

  // Input file của route story: trên feed mobile đã có sẵn 1 input ẩn
  // accept chỉ ảnh. Ưu tiên input accept có 'image'; fallback input
  // đầu tiên không khai accept video.
  function findStoryFileInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    if (!inputs.length) return null;
    const imageInput = inputs.find(inp => (inp.getAttribute('accept') || '').toLowerCase().includes('image'));
    if (imageInput) return imageInput;
    return inputs.find(inp => !(inp.getAttribute('accept') || '').toLowerCase().includes('video')) || null;
  }

  function doClick(el) {
    if (!el) return;
    const target = el.closest?.('a, button, [role="button"]') || el;
    try { target.focus(); } catch (_) {}
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  // Ưu tiên chuột người AVJP.human (nạp trước qua contract) — clickEl
  // tự fallback el.click() khi SW không bấm hộ được; human vắng mặt
  // (inject lệch spec) thì dùng doClick thường.
  async function humanClick(el) {
    if (!el) return;
    const human = window.AVJP?.human;
    if (human && typeof human.clickEl === 'function') { await human.clickEl(el); return; }
    doClick(el);
  }

  // Actor (nick đang đăng nhập) từ link profile — cùng heuristic bản
  // cũ/automator: href 1 segment, loại các segment dành riêng.
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

  function findOwnStoryLink(username) {
    if (!username) return null;
    return document.querySelector(`a[href^="/stories/${username}/"]`);
  }

  // ── Nạp media qua background (khuôn automator IG) ──
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
    if (!mime) {
      const match = arr[0] ? arr[0].match(/:(.*?);/) : null;
      mime = match ? match[1] : 'image/png';
    }
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  let shareClicked = false;

  // ── PROOF (dùng cho cả luồng chính lẫn đường resume sau tải lại) ──
  async function runProof() {
    // Chờ editor đóng (rời URL /create/story/) — tối đa ~45s.
    const leftEditor = await pollUntil(
      () => !location.pathname.startsWith('/create/story') ? true : null, 45000, 800);
    if (!leftEditor) {
      await unknown('Đã bấm "Chia sẻ tin" nhưng editor không đóng sau 45s — không xác minh được, đóng dấu uncertain để kiểm tra tay (không đăng lại).');
      return;
    }
    // Tín hiệu nhanh + mạnh ngay khi vừa rời editor: toast xác nhận
    // của chính IG ("Đã thêm tin của bạn vào Instagram" — quan sát
    // thật ở các ca tái hiện 2026-11-12). Toast sống ngắn nên soi
    // TRƯỚC giấc ngủ chờ khay; không thấy thì rơi xuống proof khay/
    // viewer như cũ (không kết luận vội).
    const toastSeen = await pollUntil(() => {
      const t = document.body?.innerText || '';
      return (t.includes('Đã thêm tin của bạn') || t.includes('Your story has been added')) ? true : null;
    }, 4000, 400);
    if (toastSeen) {
      await complete(findOwnProfile(), 'toast');
      return;
    }
    await sleep(2500); // chờ feed dựng lại khay story
    const actor = findOwnProfile();
    if (actor?.name) {
      // Cấp mạnh nhất: mở viewer story của chính mình, thấy media.
      const ownLink = await pollUntil(() => findOwnStoryLink(actor.name), 15000, 700);
      if (ownLink) {
        await humanClick(ownLink);
        const inViewer = await pollUntil(() => {
          if (!location.pathname.startsWith(`/stories/${actor.name}/`)) return null;
          const hasMedia = Array.from(document.querySelectorAll('video, img')).some(m => {
            const r = m.getBoundingClientRect();
            return r.width > 100 && r.height > 100;
          });
          return hasMedia ? true : null;
        }, 12000, 600);
        if (inViewer) {
          try { history.back(); } catch (_) {}
          await sleep(800);
          await complete(actor, 'own_story_viewer');
          return;
        }
        if (location.pathname.startsWith('/stories/')) { try { history.back(); } catch (_) {} await sleep(1200); }
      }
      // Cấp khay: link story của mình tồn tại ở feed = có tin đang sống.
      if (findOwnStoryLink(actor.name)) {
        await complete(actor, 'story_ring');
        return;
      }
    }
    await unknown('Đã bấm "Chia sẻ tin", editor đã đóng nhưng không thấy story của mình ở khay — đóng dấu uncertain để kiểm tra tay (không đăng lại).');
  }

  // ── Bước editor: chờ editor sẵn sàng -> ghi 'sharing' -> bấm
  // "Chia sẻ tin" -> proof. Dùng cho cả luồng chính (sau khi nạp
  // file, nếu instance feed còn sống) lẫn đường resume file_set ở
  // trang editor (instance feed đã chết khi chuyển document). ──
  async function shareFromEditor() {
    const editorReady = await pollUntil(() => {
      return location.pathname.startsWith('/create/story') && document.querySelector('canvas') ? true : null;
    }, 30000, 600);
    if (!editorReady) {
      await fail('story_editor_not_ready', 'Nạp file xong 30s mà editor story không sẵn sàng (URL chưa sang /create/story/ hoặc thiếu canvas).');
      return;
    }
    addLog('✅ Editor story đã mở');
    const shareBtn = await pollUntil(() => findClickableByText(['Chia sẻ tin', 'Share to story'], true), 15000, 500);
    if (!shareBtn) {
      await fail('story_share_not_found', 'Editor đã mở nhưng không thấy nút "Chia sẻ tin" sau 15s.');
      return;
    }
    // Ghi 'sharing' TRƯỚC cú bấm: mọi sự cố sau điểm này (kể cả bản
    // inject khác chen vào) đều rơi về proof/uncertain, không bấm lại.
    await setPhase('sharing');
    shareClicked = true;
    await humanClick(shareBtn);
    await setPhase('shared');
    addLog('👉 Đã bấm "Chia sẻ tin" — chuyển sang kiểm chứng');
    await runProof();
  }

  // ── Luồng chính ──
  try {
    addLog('Khởi động đăng Story Instagram (giao diện mobile)...');

    if (resumeProofOnly) {
      addLog('♻️ Bản inject mới thấy phase đã qua mốc đăng — chỉ chạy proof, không đăng lại.');
      await runProof();
      return;
    }

    if (resumeAtEditor) {
      addLog('♻️ Bản inject ở trang editor thấy phase file_set — tiếp tục ở bước editor (bấm đăng), không nạp lại file.');
      await shareFromEditor();
      return;
    }

    if (isLoginWall()) {
      await fail('session_expired', 'Instagram chưa đăng nhập (trang login) — dừng task, không lách.');
      return;
    }

    // 1. Chờ feed mobile ổn định: ô "Tin của bạn" là neo chắc nhất.
    // Sau ~20s vẫn không có -> trang đang ở layout desktop, tức giả
    // lập thiết bị không có hiệu lực trên tab này.
    const storyEntry = await pollUntil(() => findClickableByText(['Tin của bạn', 'Your story']), 20000, 600);
    if (!storyEntry) {
      if (isLoginWall()) {
        await fail('session_expired', 'Instagram chưa đăng nhập (trang login) — dừng task, không lách.');
        return;
      }
      await fail('emulation_missing', 'Sau 20s vẫn không thấy ô "Tin của bạn" — trang không ở giao diện mobile (giả lập thiết bị chưa có hiệu lực trên tab).');
      return;
    }
    addLog('✅ Thấy ô "Tin của bạn" — giao diện mobile OK');

    // 2. Media: bám quy ước task IG khác (images/media_urls/
    // images_json; phần tử là URL hoặc {url|src}). CHỈ ẢNH.
    let rawMedia = [];
    try {
      const raw = run.images || run.media_urls || run.images_json;
      rawMedia = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (_) { /* media rỗng sẽ bị chặn ở dưới */ }
    const mediaUrls = rawMedia.map(u => typeof u === 'string' ? u : (u && (u.url || u.src))).filter(Boolean);
    if (!mediaUrls.length) {
      await fail('media_load_failed', 'task story không có media (images/media_urls rỗng)');
      return;
    }
    if (mediaUrls.length > 1) addLog(`⚠️ Story chỉ đăng 1 ảnh/lần — dùng file đầu trong ${mediaUrls.length} file`);
    const mediaUrl = mediaUrls[0];
    const looksVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(mediaUrl)
      || String(run.resolved_media_type || '').toLowerCase().startsWith('video/');
    if (looksVideo) {
      await fail('media_type_unsupported', 'Luồng story mobile chỉ nhận ẢNH (input file của IG mobile chỉ accept ảnh) — payload là video, từ chối ngay trước khi tải.');
      return;
    }
    addLog('Tải ảnh qua background...');
    const res = await fetchImageViaBackground(mediaUrl);
    if (!res?.dataUrl) {
      await fail('media_load_failed', `không tải được ảnh story (${mediaUrl})`);
      return;
    }
    let mime = String(res.type || (res.dataUrl.split(';')[0].split(':')[1] || '')).trim().toLowerCase();
    if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
      mime = String(run.resolved_media_type || '').toLowerCase();
    }
    if (mime.startsWith('video/')) {
      await fail('media_type_unsupported', `media tải về là video (${mime}) — route story mobile chỉ đăng ảnh, dừng trước khi nạp.`);
      return;
    }
    if (!mime.startsWith('image/')) {
      await fail('media_type_unsupported', `media không phải ảnh (mime: ${mime || 'không rõ'}) — route story mobile chỉ đăng ảnh.`);
      return;
    }
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : (mime.includes('avif') ? 'avif' : 'png');
    const file = dataURLtoFile(res.dataUrl, `ig_story_0.${ext}`, mime);
    addLog(`✅ Đã có file ảnh story (${mime}, ${Math.round(file.size / 1024)} KB)`);

    // 3. Nạp file vào input ẩn của feed. Input thường có sẵn; chưa
    // có thì bấm ô "Tin của bạn" (sau tap DOM có thêm input) rồi chờ.
    let fileInput = findStoryFileInput();
    if (!fileInput) {
      await humanClick(storyEntry);
      fileInput = await pollUntil(() => findStoryFileInput(), 15000, 500);
    }
    if (!fileInput) {
      await fail('story_create_not_found', 'Không tìm thấy input file ảnh trên feed mobile, kể cả sau khi bấm ô "Tin của bạn".');
      return;
    }
    await setPhase('file_set');
    const dt = new DataTransfer();
    dt.items.add(file);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    addLog('📦 Đã nạp ảnh vào input — chờ editor /create/story/...');

    // 4-6. Editor -> bấm đăng -> proof. LƯU Ý: nạp file xong trang
    // thường CHUYỂN DOCUMENT sang /create/story/ — instance này có
    // thể chết ngay tại đây (không lỗi, không log). Bản inject mới ở
    // trang editor sẽ tiếp quản qua nhánh resumeAtEditor. Nếu còn
    // sống (điều hướng SPA) thì shareFromEditor chạy tiếp tại đây.
    await shareFromEditor();
  } catch (error) {
    console.error('[Auto vjp][IG-Story] Error:', error);
    if (shareClicked) {
      await unknown(`Lỗi sau khi đã bấm đăng: ${error?.message || String(error)}`);
    } else {
      await fail('execution_error', String(error?.message || error));
    }
  }
})();
}
