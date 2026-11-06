// Moigioi X.com (Twitter) Automator v1.0
// Port từ Gflowup2/js/x-automator.js, thích nghi với kiến trúc moigioi extension
if (window.moigioi_injected_x) {
  console.log('[Moigioi-X] Script already injected, exiting.');
} else {
window.moigioi_injected_x = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Moigioi-X]', msg);
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
      <div style="font-weight:700;color:#e2e8f0;margin-bottom:10px;border-bottom:1px solid #334155;padding-bottom:5px;">
        𝕏 Trợ lý Đăng X (Twitter)
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
        ${logs.slice(-8).map(l => `<div>${l}</div>`).join('')}
      </div>
    `;
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
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
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

  function waitForElement(sel, timeout = 15000) {
    return new Promise(resolve => {
      const start = Date.now();
      const iv = setInterval(() => {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect && el.getBoundingClientRect().width > 0) {
          clearInterval(iv);
          resolve(el);
        } else if (Date.now() - start > timeout) {
          clearInterval(iv);
          resolve(null);
        }
      }, 500);
    });
  }

  function triggerReactClick(el) {
    // Tìm __reactProps trên el hoặc leo lên tối đa 5 cấp
    let node = el;
    for (let i = 0; i < 5; i++) {
      if (!node) break;
      const key = Object.keys(node).find(k => k.startsWith('__reactProps'));
      if (key) {
        const props = node[key];
        if (typeof props.onClick === 'function') {
          addLog(`React onClick tìm thấy ở cấp ${i}`);
          props.onClick({ type: 'click', preventDefault: () => {}, stopPropagation: () => {}, target: el, currentTarget: node, nativeEvent: {} });
          return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  }

  function doClick(el) {
    if (triggerReactClick(el)) return;
    // Fallback: PointerEvent + MouseEvent sequence
    el.focus();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  // ══ MAIN ══
  let postId = null;
  try {
    addLog('Khởi động tiến trình đăng X.com...');
    await sleep(2500);

    const stored = await chrome.storage.local.get('currentProcessingPost');
    const post = stored.currentProcessingPost;
    if (!post) {
      addLog('❌ Không tìm thấy bài đăng.');
      return;
    }
    postId = post.id;

    // 1. CHUẨN BỊ FILE — X giới hạn tối đa 4 ảnh
    let images = [];
    try {
      const raw = post.images || post.media_urls || post.images_json;
      images = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (e) { /* ignore */ }

    if (images.length === 0) {
      addLog('⚠️ Bài không có ảnh. Dùng ảnh mặc định...');
      images = [await resolveDefaultImageUrl()];
    }
    if (images.length > 4) {
      addLog(`⚠️ X giới hạn 4 ảnh, lược bỏ ${images.length - 4} ảnh cuối`);
      images = images.slice(0, 4);
    }

    addLog(`Tải ${images.length} ảnh qua background...`);
    const files = [];
    for (let i = 0; i < images.length; i++) {
      const res = await fetchImageViaBackground(images[i]);
      if (res && res.dataUrl) {
        const mime = res.type || res.dataUrl.split(';')[0].split(':')[1] || '';
        const ext = mime.includes('video') ? (mime.includes('webm') ? 'webm' : 'mp4') : 'png';
        let file = dataURLtoFile(res.dataUrl, `x_${i}.${ext}`);
        
        if (window.mutWatermarkService && post.watermark_config && !mime.includes('video')) {
          try {
            const context = { accountName: post.social_name || post.social_uid || '', platform: post.platform || '' };
            const watermarkedBlob = await window.mutWatermarkService.applyWatermark(file, post.watermark_config, context);
            file = new File([watermarkedBlob], `x_${i}.${ext}`, { type: watermarkedBlob.type });
          } catch (wErr) {
            addLog(`⚠️ Lỗi đóng dấu watermark ảnh [${i+1}]: ${wErr.message}`);
          }
        }
        
        files.push(file);
        addLog(`✅ Nạp ảnh [${i + 1}]`);
      } else {
        addLog(`❌ Lỗi tải ảnh [${i + 1}]`);
      }
    }
    if (files.length === 0) throw new Error('Không tải được ảnh nào');

    // 2. ĐIỀN TEXT
    addLog('Tìm ô soạn tweet...');
    const composer = await waitForElement('div[data-testid="tweetTextarea_0"]', 12000);
    if (!composer) throw new Error('Không tìm thấy composer của X.com');

    composer.focus();
    await sleep(500);
    document.execCommand('selectAll', false, null);

    let contentStr = post.post_content || '';
    contentStr = contentStr.replace(/\n/g, '\n\n');

    // Chia văn bản thành các đoạn tối đa 260 ký tự
    const chunks = splitTextIntoChunks(contentStr, 260);

    addLog(`Đẩy phần 1 vào composer 0 (độ dài: ${chunks[0]?.length || 0})...`);
    const textDt = new DataTransfer();
    textDt.setData('text/plain', chunks[0] || '');
    composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: textDt, bubbles: true, cancelable: true }));
    try { document.execCommand('insertText', false, chunks[0] || ''); } catch (e) { /* ignore */ }
    await sleep(1000);

    // Điền các phần tiếp theo dưới dạng chuỗi thread
    for (let i = 1; i < chunks.length; i++) {
      addLog(`➕ Bấm nút thêm Tweet cho phần ${i + 1}/${chunks.length}...`);
      const addButton = document.querySelector('[data-testid="addButton"]');
      if (!addButton) {
        addLog('⚠️ Không tìm thấy nút addButton, dừng tạo thread.');
        break;
      }
      doClick(addButton);
      await sleep(1500);

      const nextComposer = await waitForElement(`div[data-testid="tweetTextarea_${i}"]`, 10000);
      if (!nextComposer) {
        addLog(`⚠️ Không tìm thấy composer_${i}, dừng tạo thread.`);
        break;
      }

      addLog(`Đẩy phần ${i + 1} vào composer ${i} (độ dài: ${chunks[i].length})...`);
      nextComposer.focus();
      await sleep(500);
      document.execCommand('selectAll', false, null);

      const chunkDt = new DataTransfer();
      chunkDt.setData('text/plain', chunks[i]);
      nextComposer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: chunkDt, bubbles: true, cancelable: true }));
      try { document.execCommand('insertText', false, chunks[i]); } catch (e) { /* ignore */ }
      await sleep(1000);
    }

    addLog('✅ Đã nạp xong tất cả văn bản.');
    await sleep(1500);

    // 3. NẠP FILE
    const fileInput = document.querySelector('input[data-testid="fileInput"]') ||
                      document.querySelector('input[type="file"][accept*="image"]');
    if (!fileInput) throw new Error('Không tìm thấy input file');

    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    addLog(`📦 Đã nạp ${files.length} ảnh, đợi X xử lý...`);

    // X cần thời gian xử lý mỗi ảnh ~6s
    const waitMs = Math.max(5000, files.length * 6000);
    await sleep(waitMs);

    // 4. BẤM NÚT POST
    addLog('Tìm nút Post...');
    let postBtn = document.querySelector('[data-testid="tweetButtonInline"]') ||
                  document.querySelector('[data-testid="tweetButton"]');

    const isDisabled = (btn) => !btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled === true || btn.hasAttribute('disabled');
    let attempts = 0;
    while (attempts < 6 && isDisabled(postBtn)) {
      addLog('⏳ Nút Post chưa sẵn sàng, đợi 4s...');
      await sleep(4000);
      postBtn = document.querySelector('[data-testid="tweetButtonInline"]') ||
                document.querySelector('[data-testid="tweetButton"]');
      attempts++;
    }
    if (postBtn && isDisabled(postBtn)) {
      addLog('⚠️ Nút Post vẫn disabled sau 6 lần thử, thử bấm thẳng...');
    }
    if (!postBtn) throw new Error('Không tìm thấy nút Post');

    // Thử 1: React props click (trực tiếp nhất)
    addLog('🚀 Thử React onClick...');
    const reactOk = triggerReactClick(postBtn);
    addLog(reactOk ? '✅ React onClick gọi xong' : '⚠️ Không tìm thấy React onClick');
    await sleep(1500);

    // Kiểm tra xem đã submit chưa
    let stillOpen = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');

    // Thử 2: Ctrl+Enter trên contenteditable bên trong composer
    if (stillOpen) {
      addLog('Thử Ctrl+Enter...');
      const editable = composer.querySelector('[contenteditable="true"]') || composer;
      editable.focus();
      await sleep(300);
      for (const type of ['keydown', 'keypress', 'keyup']) {
        editable.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          ctrlKey: true, metaKey: true, bubbles: true, cancelable: true
        }));
      }
      await sleep(1500);
      stillOpen = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
    }

    // Thử 3: PointerEvent sequence trực tiếp lên button
    if (stillOpen) {
      addLog('Thử PointerEvent trực tiếp...');
      doClick(postBtn);
      await sleep(1500);
    }

    addLog('🚀 Đã gửi lệnh post, đợi X xác nhận...');
    await sleep(8000);

    // 5. LẤY ACTOR INFO
    let actorUrl = null;
    let actorName = null;
    try {
      const sideAccount = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') ||
                          document.querySelector('a[aria-label*="rofile"]');
      if (sideAccount) {
        const href = sideAccount.getAttribute('href') || '';
        actorUrl = 'https://x.com' + href;
        actorName = href.replace(/^\/|\/$/g, '');
      }
    } catch (e) { /* ignore */ }

    const hasVideo = files.some(file => file.type.startsWith('video/')) ||
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
    chrome.runtime.sendMessage({
      action: 'postCompleted',
      postId: post.id,
      resultUrl: actorUrl || window.location.href,
      actorUrl,
      actorName
    });
    

  } catch (error) {
    console.error('[Moigioi-X] Error:', error);
    addLog(`❌ Lỗi: ${error.message}`);
    if (postId) chrome.runtime.sendMessage({ action: 'postFailed', postId, error: error.message });
  }
})();
}
