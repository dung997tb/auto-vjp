// Moigioi Facebook Personal Automator v5.1 (Fix parallel execution & button finding)
if (window.moigioi_injected_personal) {
  console.log('[Moigioi] Script already injected, exiting.');
} else {
window.moigioi_injected_personal = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', {hour12:false});
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Moigioi]', msg);
    chrome.storage.local.set({ lastStatus: msg });
    
    let el = document.getElementById('moigioi-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'moigioi-status';
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
    el.innerHTML = `
      <div style="font-weight:700;color:#38bdf8;margin-bottom:10px;border-bottom:1px solid #334155;padding-bottom:5px;">
        🤖 Trợ lý Đăng Bài Cá Nhân
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
        ${logs.slice(-8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      </div>
    `;
  }

  function doClick(el) {
    el.focus();
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();
  }

  function fetchImageViaBackground(url) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'fetchImage', url }, res => {
        if (res && res.success) resolve(res);
        else resolve(null);
      });
    });
  }

  // (2.11.7) Ảnh mặc định của riêng Auto vjp qua helper shared
  // AVJP.defaultImage (contract nạp trước automator); helper vắng mặt
  // (inject cũ) thì rơi thẳng về asset gói sẵn trong extension.
  async function resolveDefaultImageUrl() {
    if (window.AVJP && AVJP.defaultImage && AVJP.defaultImage.resolveDefaultImageUrl) {
      return AVJP.defaultImage.resolveDefaultImageUrl();
    }
    return chrome.runtime.getURL('assets/default-preview.png');
  }

  function dataURLtoFile(dataurl, filename) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){ u8arr[n] = bstr.charCodeAt(n); }
    return new File([u8arr], filename, {type: mime});
  }

  function splitTextIntoChunks(text, maxLength) {
    const paragraphs = text.split('\n\n');
    const chunks = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if ((currentChunk + (currentChunk ? '\n\n' : '') + paragraph).length > maxLength) {
        if (paragraph.length > maxLength) {
          const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+(\s|$)/g) || [paragraph];
          for (const sentence of sentences) {
            if ((currentChunk + (currentChunk ? ' ' : '') + sentence).length > maxLength) {
              if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
              }
              if (sentence.length > maxLength) {
                let temp = sentence;
                while (temp.length > maxLength) {
                  chunks.push(temp.substring(0, maxLength).trim());
                  temp = temp.substring(maxLength);
                }
                currentChunk = temp;
              } else {
                currentChunk = sentence;
              }
            } else {
              currentChunk = (currentChunk ? currentChunk + ' ' : '') + sentence;
            }
          }
        } else {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = paragraph;
        }
      } else {
        currentChunk = (currentChunk ? currentChunk + '\n\n' : '') + paragraph;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
    return chunks;
  }

  function findAddThreadButton(container) {
    return Array.from(container.querySelectorAll('div[role="button"], span, button'))
      .find(el => {
        const text = (el.innerText || el.textContent || '').trim().toLowerCase();
        return text === 'add to thread' || text === 'thêm vào thread' || text === 'thêm vào thread...';
      });
  }

  function snapshotPostIds() {
    const links = document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
    const set = new Set();
    for (let a of links) {
      const m = a.href.match(/\/(?:posts|permalink)\/(\d+)/);
      if (m && m[1]) set.add(m[1]);
    }
    return set;
  }

  async function findSmartElement(keywords, retries = 5, allowSubstring = false, container = document) {
    for (let i = 0; i < retries; i++) {
      const targets = container.querySelectorAll('div[role="button"], div[aria-label], span, button');
      for (const el of targets) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue; 

        const label = (el.getAttribute('aria-label') || "").trim().toLowerCase();
        const text = (el.innerText || "").trim().toLowerCase();
        if (!label && !text) continue;

        const isMatch = keywords.some(kw => {
          const k = kw.toLowerCase();
          return allowSubstring ? (label.includes(k) || text.includes(k)) : (label === k || text === k);
        });

        if (isMatch && el.getAttribute('aria-disabled') !== 'true') return el;
      }
      await sleep(1000);
    }
    return null;
  }

  async function getNewPostUrl(oldIds, maxWait = 12000) {
    await sleep(3000);
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const toastLinks = document.querySelectorAll('div[role="alert"] a');
      for (const a of toastLinks) {
        if (a.href && (a.href.includes('/posts/') || a.href.includes('/permalink/'))) return a.href.split('?')[0];
      }
      const links = document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
      for (let a of links) {
        if (!a.href || a.href.includes('comment_id')) continue;
        const m = a.href.match(/\/(?:posts|permalink)\/(\d+)/);
        if (m && m[1] && !oldIds.has(m[1])) {
          return a.href.split('?')[0];
        }
      }
      await sleep(1000);
    }
    return window.location.href.split('?')[0]; // Fallback personal profile
  }

  // Auto-like 1-5 thread mới nhất sau khi đăng xong
  async function autoLikeFeedThreads() {
    const targetCount = Math.floor(Math.random() * 5) + 1;
    addLog(`👍 Auto-like ${targetCount} thread...`);
    // Threads thường ở "/" - về home
    try {
      if (!window.location.pathname.match(/^\/$|^\/home/)) {
        window.location.assign('/');
        await sleep(4500);
      }
    } catch (e) {/* */}
    window.scrollTo(0, 0);
    await sleep(2000);
    window.scrollBy(0, 500);
    await sleep(1500);

    const articles = Array.from(document.querySelectorAll('div[role="article"], div[data-testid*="post"]'));
    if (articles.length === 0) { addLog(`⚠️ Không thấy thread`); return; }
    let liked = 0;
    for (let i = 0; i < Math.min(articles.length, targetCount * 2) && liked < targetCount; i++) {
      const art = articles[i];
      // Threads: nút Like có aria-label "Like" hoặc "Thích"
      const candidates = art.querySelectorAll('div[role="button"][aria-label], svg[aria-label]');
      let likeBtn = null;
      for (const b of candidates) {
        const lbl = (b.getAttribute('aria-label') || '').toLowerCase().trim();
        // Threads: nút liked có SVG fill màu đỏ/hồng
        const svgEl = b.tagName.toLowerCase() === 'svg' ? b : b.querySelector('svg');
        const svgFill = svgEl ? (window.getComputedStyle(svgEl).fill || svgEl.getAttribute('fill') || '') : '';
        const alreadyLiked = b.getAttribute('aria-pressed') === 'true' || svgFill.includes('rgb(255,') || svgFill.includes('#ff') || lbl.includes('unlike') || lbl.includes('bỏ thích');
        if ((lbl === 'like' || lbl === 'thích') && !alreadyLiked) {
          const target = b.tagName.toLowerCase() === 'svg' ? b.closest('div[role="button"]') || b.parentElement : b;
          const rect = (target || b).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) { likeBtn = target || b; break; }
        }
      }
      if (!likeBtn) continue;
      try {
        art.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await sleep(1000);
        doClick(likeBtn);
        liked++;
        addLog(`✅ Like ${liked}/${targetCount}`);
        await sleep(3000 + Math.floor(Math.random() * 4000));
      } catch (e) { /* skip */ }
    }
    addLog(`Auto-like xong (${liked} thread)`);
  }

  // ══ MAIN FLOW ══
  try {
    addLog('Khởi động tiến trình tự động (Cá nhân)...');
    await sleep(2000);

    const stored = await chrome.storage.local.get('currentProcessingPost');
    const post = stored.currentProcessingPost;
    if (!post) {
      addLog('❌ Không tìm thấy dữ liệu bài đăng.');
      return;
    }
    
    const oldIdsSnapshot = snapshotPostIds();

    // 1. TẢI ẢNH (Bao gồm ảnh mặc định)
    let images = [];
    try {
      const raw = post.images || post.media_urls || post.images_json;
      images = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch(e) {}
    
    if (images.length === 0) {
      addLog("⚠️ Bài không có ảnh. Áp dụng ảnh mặc định...");
      images = [await resolveDefaultImageUrl()];
    }

    addLog(`Chuẩn bị nạp ${images.length} ảnh vào Extension...`);
    const dt = new DataTransfer();
    for (let i = 0; i < images.length; i++) {
      try {
        const shortUrl = images[i].length > 30 ? images[i].substring(0, 30) + '...' : images[i];
        addLog(`Nạp ảnh [${i+1}]: ${shortUrl}`);
        const res = await fetchImageViaBackground(images[i]);
        if (res && res.dataUrl) {
          const mime = res.dataUrl.split(';')[0].split(':')[1] || 'image/png';
          const ext = mime.includes('video') ? (mime.includes('webm') ? 'webm' : 'mp4') : 'png';
          let file = dataURLtoFile(res.dataUrl, `img_${i}.${ext}`);
          
          if (window.mutWatermarkService && post.watermark_config && !mime.includes('video')) {
            try {
              const context = { accountName: post.social_name || post.social_uid || '', platform: post.platform || '' };
              const watermarkedBlob = await window.mutWatermarkService.applyWatermark(file, post.watermark_config, context);
              file = new File([watermarkedBlob], `img_${i}.${ext}`, { type: watermarkedBlob.type });
            } catch (wErr) {
              addLog(`⚠️ Lỗi đóng dấu watermark ảnh [${i+1}]: ${wErr.message}`);
            }
          }

          dt.items.add(file);
          addLog(`✅ Nạp thành công ảnh [${i+1}]`);
        } else {
          addLog(`❌ Tải lỗi ảnh [${i+1}]`);
        }
      } catch(e) { 
        addLog(`❌ Bị chặn tải ảnh [${i+1}]`); 
      }
    }

    if (dt.files.length === 0) {
      throw new Error("Không thể nạp được bất kỳ ảnh nào.");
    }

    // 2. MỞ MODAL ĐĂNG BÀI BẰNG CÁCH CLICK "START A THREAD"
    addLog(`Đang tìm vị trí tạo bài viết (Start a thread)...`);
    const fakeInputs = document.querySelectorAll('div[role="button"], a[role="link"], span');
    for (const el of fakeInputs) {
      const txt = (el.innerText || "").trim().toLowerCase();
      if (txt.includes('có gì mới') || txt.includes('what\'s new') || txt === 'start a thread' || txt === 'bắt đầu thread' || txt === 'bắt đầu thread...' || txt === 'start a thread...' || txt.includes('start a thread') || txt.includes('bắt đầu thread')) {
        doClick(el);
        addLog(`✅ Đã bấm mở bảng Đăng bài Threads!`);
        await sleep(2000);
        break;
      }
    }

    // Nếu không tìm thấy chữ, thử tìm nút SVG tạo bài (hình cây bút) trên menu
    let activeModal = document.querySelector('div[aria-modal="true"][role="dialog"]') || document;
    let fileInput = activeModal.querySelector('input[type="file"][accept*="image"], input[type="file"][accept*="video"]');
    
    if (!fileInput) {
      addLog(`Thử bấm các icon Tạo bài viết trên menu...`);
      // Thử tìm nút có aria-label="New thread", "Tạo thread"
      const menuBtns = document.querySelectorAll('[aria-label*="New thread"], [aria-label*="Tạo thread"], [aria-label*="Create"], [aria-label*="Tạo"]');
      if (menuBtns.length > 0) {
        doClick(menuBtns[0]);
        await sleep(1500);
      }
      activeModal = document.querySelector('div[aria-modal="true"][role="dialog"]') || document;
      fileInput = activeModal.querySelector('input[type="file"][accept*="image"], input[type="file"][accept*="video"]');
    }

    // 3. TÌM VÀ ĐẨY ẢNH VÀO FILE INPUT
    addLog(`Đang tìm khay chứa ảnh ẩn (Input File)...`);
    if (!fileInput) {
      addLog(`Không tìm thấy thẻ ẩn, thử bấm "Ảnh/video"...`);
      const photoBtn = await findSmartElement(["Ảnh/video", "Photo/video", "Add Media", "Thêm file phương tiện", "Đính kèm", "Attach"], 3, true, activeModal);
      if (photoBtn) {
        doClick(photoBtn);
        await sleep(1500);
      }
      activeModal = document.querySelector('div[aria-modal="true"][role="dialog"]') || document;
      fileInput = activeModal.querySelector('input[type="file"][accept*="image"], input[type="file"][accept*="video"]');
    }

    if (!fileInput) {
      throw new Error("Không thể tìm thấy vị trí chèn ảnh trên Threads.");
    }

    addLog(`Đẩy ${dt.files.length} ảnh vào khay để ép mở bảng đăng bài...`);
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    if (nativeSetter) {
      nativeSetter.call(fileInput, dt.files);
    } else {
      fileInput.files = dt.files;
    }
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    addLog(`⏳ Đợi Modal tự bật và render ảnh (5s)...`);
    await sleep(5000);

    // 4. ĐIỀN TEXT
    addLog(`Đang tìm ô soạn chữ trong Modal...`);
    let editor = null;
    let editorModal = null;
    for(let i=0; i<8; i++){
      editorModal = document.querySelector('div[aria-modal="true"][role="dialog"]') || document;
      editor = editorModal.querySelector('[data-lexical-editor="true"], div[role="textbox"]');
      if (editor) break;
      await sleep(500);
    }

    if (!editor) throw new Error("Bảng đăng bài không tự bật lên.");

    addLog(`Đang Nạp Text nội dung vào ô...`);
    editor.focus();
    await sleep(500);
    document.execCommand('selectAll', false, null);
    
    let contentStr = post.post_content || '';
    contentStr = contentStr.replace(/\n/g, '\n\n');

    // Chia văn bản thành các đoạn tối đa 470 ký tự cho Threads
    const chunks = splitTextIntoChunks(contentStr, 470);

    addLog(`Đẩy phần 1 vào editor 0 (độ dài: ${chunks[0]?.length || 0})...`);
    const textDt = new DataTransfer();
    textDt.setData('text/plain', chunks[0] || '');
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: textDt, bubbles: true, cancelable: true }));
    await sleep(800);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Điền các phần tiếp theo dưới dạng chuỗi thread
    for (let i = 1; i < chunks.length; i++) {
      addLog(`➕ Bấm nút thêm Thread cho phần ${i + 1}/${chunks.length}...`);
      const addBtn = findAddThreadButton(editorModal);
      if (!addBtn) {
        addLog('⚠️ Không tìm thấy nút thêm Thread, dừng tạo thread.');
        break;
      }
      doClick(addBtn);
      await sleep(1500);

      // Đợi editor thứ i xuất hiện
      let nextEditor = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const currentEditors = Array.from(editorModal.querySelectorAll('[data-lexical-editor="true"], div[role="textbox"]'));
        if (currentEditors[i]) {
          nextEditor = currentEditors[i];
          break;
        }
        await sleep(500);
      }

      if (!nextEditor) {
        addLog(`⚠️ Không tìm thấy editor phần ${i + 1}, dừng tạo thread.`);
        break;
      }

      addLog(`Đẩy phần ${i + 1} vào editor ${i} (độ dài: ${chunks[i].length})...`);
      nextEditor.focus();
      await sleep(500);
      document.execCommand('selectAll', false, null);

      const chunkDt = new DataTransfer();
      chunkDt.setData('text/plain', chunks[i]);
      nextEditor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: chunkDt, bubbles: true, cancelable: true }));
      await sleep(800);
      nextEditor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    addLog(`✅ Đã nạp xong tất cả văn bản.`);
    await sleep(2000); // Đợi Threads kiểm tra nội dung

    // 5. CLICK ĐĂNG
    addLog(`Bắt đầu dò tìm nút Đăng...`);
    
    const finalKeywords = ["Đăng", "Post", "Chia sẻ"];
    
    let steps = 0;
    let clickedPost = false;
    
    while (steps < 4 && !clickedPost) {
      addLog(`[Dò bước ${steps + 1}] Tìm nút Đăng...`);
      const activeModal = document.querySelector('div[aria-modal="true"][role="dialog"]') || document;
      
      // 1. Strict match Post
      let btn = await findSmartElement(finalKeywords, 2, false, activeModal);
      if (btn) {
        addLog(`✅ Đã tìm thấy nút ĐĂNG chính xác! Bấm ngay!`);
        btn.click();
        clickedPost = true;
        break;
      }
      
      // 2. Loose match
      addLog(`Thử tìm lỏng lẻo...`);
      btn = await findSmartElement(finalKeywords, 2, true, activeModal);
      if (btn) {
        addLog(`✅ Tìm thấy nút Đăng (lỏng lẻo). Bấm ngay!`);
        doClick(btn);
        clickedPost = true;
        break;
      }

      addLog(`⚠️ Bế tắc: Không tìm thấy cả nút Tiếp hay Đăng!`);
      break;
    }

    if (!clickedPost) throw new Error("Không thể hoàn thành chu trình bấm nút Đăng.");

    // Extract actor info
    let actorUrl = null;
    let actorName = null;
    try {
      const profileLink = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') && a.getAttribute('href').startsWith('/@'));
      if (profileLink) {
        actorUrl = "https://www.threads.net" + profileLink.getAttribute('href');
        actorName = profileLink.getAttribute('href').replace('/@', '');
      }
    } catch (e) {}

    // 5. TRẢ KẾT QUẢ VÀ ĐÓNG TAB NGAY
    addLog(`✅ Bấm Đăng thành công! Trả kết quả và đóng tab.`);
    const resultUrl = actorUrl || window.location.href;

    // Auto-like TRƯỚC khi báo postCompleted — tránh bị navigate tab giữa chừng
    try { await autoLikeFeedThreads(); } catch (e) { addLog(`⚠️ Auto-like skip: ${e.message}`); }

    const hasVideo = Array.from(dt.files).some(file => file.type.startsWith('video/')) ||
      String(post.resolved_media_type || '').startsWith('video/') || Boolean(post.deferred_media?.source_url);
    if (hasVideo) {
      const videoWaitMs = post?.execution_config?.delays?.video_upload_wait_ms || 300000;
      addLog(`⏳ Phát hiện có Video, giữ tab mở ${Math.round(videoWaitMs / 1000)}s để chờ tải lên...`);
      await sleep(videoWaitMs);
    } else {
      addLog(`⏳ Giữ tab mở thêm một khoảng ngẫu nhiên (3-10s) để chống quét...`);
      await sleep(3000 + Math.floor(Math.random() * 7000));
    }

    addLog(`🏁 HOÀN TẤT! Báo server và kết thúc.`);
    await chrome.storage.local.remove('currentProcessingPost');
    chrome.runtime.sendMessage({ action: 'postCompleted', postId: post.id, resultUrl, actorUrl, actorName });
    
  } catch (error) {
    console.error('[Moigioi] Error:', error);
    addLog(`❌ Lỗi: ${error.message}`);
    const stored = await chrome.storage.local.get('currentProcessingPost');
    const postId = stored.currentProcessingPost?.id;
    await chrome.storage.local.remove('currentProcessingPost');
    chrome.runtime.sendMessage({ action: 'postFailed', postId: postId, error: error.message });
  }
})();
}
