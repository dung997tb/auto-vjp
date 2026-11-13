// TikTok Studio Automator
if (window.moigioi_injected_tiktok) {
  console.log('[Moigioi-TikTok] Script already injected, exiting.');
} else {
window.moigioi_injected_tiktok = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Moigioi-TikTok]', msg);
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
        🎵 Trợ lý Đăng TikTok
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
        ${logs.slice(-8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      </div>
    `;
  }

  const waitForElement = async (selector, timeout = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(500);
    }
    throw new Error(`Timeout waiting for element: ${selector}`);
  };

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
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
  }

  // ─── TikTok Post Commenting Automator ───
  async function handleTikTokCommentTask(task) {
    const campaignId = task.id;
    addLog(`💬 Bắt đầu bình luận bài viết TikTok...`);
    await sleep(3500);

    // 1. Tìm ô nhập bình luận trên giao diện TikTok (Photo hoặc Video detail page)
    let commentInput = null;
    const commentSelectors = [
      'div[data-e2e="comment-input"] div[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="bình luận"]',
      'div[contenteditable="true"][aria-label*="comment"]',
      'div[contenteditable="true"][placeholder*="bình luận"]',
      'div[contenteditable="true"][placeholder*="comment"]',
      'div[data-e2e="comment-input"] input',
      'div[contenteditable="true"]'
    ];

    for (const sel of commentSelectors) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
        commentInput = el;
        break;
      }
    }

    if (!commentInput) {
      const commentIcon = document.querySelector('div[data-e2e="comment-icon"], button[aria-label*="comment"], svg[class*="IconComment"]');
      if (commentIcon) {
        addLog('Đang mở phần bình luận...');
        try { commentIcon.click(); } catch(e) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", e); }
        await sleep(2500);
        for (const sel of commentSelectors) {
          const el = document.querySelector(sel);
          if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
            commentInput = el;
            break;
          }
        }
      }
    }

    if (!commentInput) {
      throw new Error('Không tìm thấy ô nhập bình luận trên trang TikTok');
    }

    // 2. Nhập nội dung bình luận
    commentInput.focus();
    await sleep(500);

    const commentText = task.comment_text || task.content || task.action_content || task.reply_text || 'Bài viết rất hay!';
    
    if (commentInput.tagName === 'INPUT' || commentInput.tagName === 'TEXTAREA') {
      commentInput.value = commentText;
      commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      try {
        document.execCommand('insertText', false, commentText);
      } catch (_) {
        commentInput.innerText = commentText;
      }
      commentInput.dispatchEvent(new Event('input', { bubbles: true }));
      commentInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    addLog(`Đã nhập nội dung bình luận: "${commentText.slice(0, 35)}..."`);
    await sleep(1500);

    // 3. Bấm nút gửi bình luận (nút mũi tên màu đỏ bên phải ô nhập)
    const submitSelectors = [
      'div[data-e2e="comment-post"]',
      'button[data-e2e="comment-post"]',
      'div[class*="DivPostButton"]',
      'div[class*="PostButton"]',
      'svg[class*="IconPost"]',
      'button[type="submit"]'
    ];

    let submitBtn = null;
    for (const sel of submitSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        submitBtn = btn;
        break;
      }
    }

    if (submitBtn) {
      try { submitBtn.click(); } catch(_) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", _); }
      submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } else {
      commentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    addLog('✅ Đã đăng bình luận TikTok thành công!');
    await sleep(3000);

    const isAffiliate = task.type === 'affiliate' || task.campaign_kind || task.source_group_url;
    if (isAffiliate) {
      chrome.runtime.sendMessage({
        action: 'affiliateCommentDone',
        campaignId: campaignId,
        items: [{
          post_url: location.href,
          comment_text: commentText,
          status: 'success'
        }]
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'commentReplyDone',
        campaignId: campaignId,
        items: [{
          post_url: location.href,
          comment_text: commentText,
          status: 'success'
        }]
      });
    }
  }

  try {
    const stored = await chrome.storage.local.get(['currentProcessingPost', 'currentAffiliateCommentTask_tiktok', 'currentCommentReplyTask_tiktok']);
    const post = stored.currentProcessingPost;
    const affTask = stored.currentAffiliateCommentTask_tiktok;
    const replyTask = stored.currentCommentReplyTask_tiktok;

    if (replyTask) {
      addLog('Tác vụ trả lời được xử lý bởi tiktok-comment-replier.js.');
      return;
    }
    if (affTask) {
      await handleTikTokCommentTask(affTask);
      return;
    }

    if (!post || post.platform !== 'tiktok') {
      addLog('❌ Không tìm thấy thông tin bài đăng hoặc tác vụ TikTok trong storage.');
      return;
    }
    const postId = post.id;

    addLog('🚀 Bắt đầu quá trình đăng bài TikTok...');
    await sleep(3000);

    let images = [];
    const rawUrls = post.images || post.media_urls || [];
    try {
      images = typeof rawUrls === 'string' ? JSON.parse(rawUrls) : rawUrls;
      if (!Array.isArray(images)) images = [];
    } catch (e) {
      images = [];
    }

    const isVideoUrl = (url) => {
      const u = typeof url === 'string' ? url.toLowerCase() : '';
      return u.match(/\.(mp4|webm|mov)$/i) || u.includes('douyin') || u.includes('tiktok') || u.includes('aweme') || u.includes('snssdk') || u.includes('twimg');
    };
    
    const isVideo = images.some(isVideoUrl) || Boolean(post.deferred_media?.source_url) || (post.external_media_source && post.external_media_source !== 'none') || String(post.resolved_media_type || '').startsWith('video/');
    
    // Filter logic for target URLs
    const targetMediaUrls = isVideo ? images.filter(isVideoUrl) : images;
    if (targetMediaUrls.length === 0 && images.length > 0) {
      targetMediaUrls.push(...images); // fallback
    }

    if (targetMediaUrls.length === 0) {
      throw new Error('Không có hình ảnh hoặc video nào để đăng.');
    }

    addLog('Đang tải media về trình duyệt...');
    function convertToJpeg(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => reject(new Error('Image decode error'));
        img.src = dataUrl;
      });
    }

    const dt = new DataTransfer();
    for (let i = 0; i < targetMediaUrls.length; i++) {
      const url = targetMediaUrls[i];
      addLog(`⬇️ Đang tải media ${i + 1}/${targetMediaUrls.length}...`);
      const res = await fetchImageViaBackground(url);
      if (!res) throw new Error(`Không thể tải media: ${url}`);
      
      let filename = url.split('/').pop().split('?')[0];
      if (!filename || !filename.includes('.')) {
        filename = isVideo ? 'video.mp4' : `image_${i}.jpg`;
      }
      
      let finalDataUrl = res.dataUrl;
      if (!isVideo && finalDataUrl && (finalDataUrl.includes('image/webp') || finalDataUrl.includes('image/avif') || !filename.match(/\.(jpg|jpeg|png)$/i))) {
        addLog(`Chuyển đổi định dạng ảnh...`);
        try {
          finalDataUrl = await convertToJpeg(finalDataUrl);
          filename = filename.split('.')[0] + '.jpg';
        } catch(e) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", e); }
      }
      
      let file = dataURLtoFile(finalDataUrl, filename);
      
      if (window.mutWatermarkService && post.watermark_config && !isVideo) {
        try {
          const context = { accountName: post.social_name || post.social_uid || '', platform: post.platform || '' };
          const watermarkedBlob = await window.mutWatermarkService.applyWatermark(file, post.watermark_config, context);
          file = new File([watermarkedBlob], filename, { type: watermarkedBlob.type });
        } catch (wErr) {
          addLog(`⚠️ Lỗi đóng dấu watermark ảnh: ${wErr.message}`);
        }
      }
      
      dt.items.add(file);
    }

    addLog('Đang đưa media vào giao diện TikTok Studio...');
    const fileInput = await waitForElement('input[type="file"][accept*="video"], input[type="file"][accept*="image"], input[type="file"]', 15000);
    if (!fileInput) throw new Error('Không tìm thấy ô chọn file tải lên');
    
    // Xóa Drop Event giả lập vì có nguy cơ làm React crash khi đọc DataTransfer bị mock
    
    await sleep(500);

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    if (nativeSetter) {
      nativeSetter.call(fileInput, dt.files);
    } else {
      fileInput.files = dt.files;
    }
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    addLog('Đang chờ video tải lên hoàn tất...');
    let uploadDone = false;
    for (let i = 0; i < 45; i++) {
      const pageText = (document.body.innerText || '').toLowerCase();
      if (pageText.match(/uploaded\s*\(/) || pageText.includes('đã tải lên') || pageText.includes('upload successful') || pageText.includes('tải lên thành công') || pageText.includes('tải lên hoàn tất')) {
        uploadDone = true;
        break;
      }
      if (i % 5 === 0) addLog(`Đang đợi video tải lên hoàn tất... (${i * 2}s/90s)`);
      await sleep(2000);
    }
    
    if (!uploadDone) {
      addLog('⚠️ Không tìm thấy chữ xác nhận tải lên, nhưng vẫn tiếp tục thử...');
    } else {
      addLog('✅ Video đã tải lên xong!');
    }
    
    // Giãn cách thời gian lên 10 giây để kiểm tra xem lỗi do Ảnh hay do Caption
    addLog('Đang chờ thêm 10 giây để TikTok xử lý ảnh và giao diện...');
    for (let i = 0; i < 5; i++) {
      await sleep(2000);
      addLog(`Chờ giãn cách... (${(i + 1) * 2}s/10s)`);
    }

    const editor = await waitForElement('.public-DraftEditor-content, [contenteditable="true"]', 60000);
    
    addLog('Đang điền nội dung (caption)...');
    editor.focus();
    await sleep(500);

    const contentStr = post.post_content || '';
    
    if (contentStr) {
      try {
        // TUYỆT ĐỐI KHÔNG DÙNG document.execCommand('insertText') VÌ SẼ LÀM CRASH VIRTUAL DOM (removeChild error)
        // Dùng chuẩn ClipboardEvent để editor (Draft.js/Lexical) tự quản lý việc chèn DOM
        const textDt = new DataTransfer();
        textDt.setData('text/plain', contentStr);
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: textDt, bubbles: true, cancelable: true }));
        addLog('Đã nạp nội dung qua sự kiện Paste...');
      } catch (e) {
        addLog('Lỗi nạp chữ: ' + e.message);
      }
    }
    
    await sleep(1500);
    
    addLog('Bắt đầu dò tìm nút Đăng bài...');
    let postBtn = null;
    for (let i = 0; i < 45; i++) {
      // Tìm rộng hơn thay vì chỉ thẻ button
      const allElements = Array.from(document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"]')).reverse();
      postBtn = allElements.find(b => {
        if (!b.innerText) return false;
        const t = b.innerText.toLowerCase().trim();
        return t === 'post' || t === 'đăng' || t === 'đăng bài' || t === 'post now';
      });
      
      const isDisabled = postBtn && (postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true' || (postBtn.className && typeof postBtn.className === 'string' && postBtn.className.includes('disabled')));
      
      if (postBtn && !isDisabled) {
        break;
      }
      
      if (i % 3 === 0) addLog(`Đợi nút Đăng sẵn sàng (có thể video đang xử lý)... (${i}/45)`);
      postBtn = null;
      await sleep(2000);
    }
    
    if (!postBtn) throw new Error('Không tìm thấy nút Đăng bài hoặc nút bị mờ quá lâu (video lỗi?)');

    addLog('Đang click nút Đăng bài...');
    postBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
    
    try { postBtn.click(); } catch(e) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", e); }
    
    // Click dự phòng qua Event nếu React chặn click thường
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    postBtn.dispatchEvent(clickEvent);
    
    addLog('Đã bấm Đăng, chờ TikTok xử lý (tối đa 60s)...');
    
    let isSuccess = false;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      
      // Tự động bấm xác nhận nếu hiện bảng cảnh báo bản quyền / chưa check xong
      const confirmBtns = Array.from(document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="button"]')).reverse();
      const postNowBtn = confirmBtns.find(b => {
        if (!b.innerText) return false;
        const t = b.innerText.toLowerCase().trim();
        return t === 'post now' || t === 'đăng ngay' || t === 'continue to post' || t === 'tiếp tục đăng' || t === 'vẫn đăng';
      });
      if (postNowBtn && postNowBtn.offsetParent !== null) {
        addLog('Phát hiện bảng xác nhận phụ, đang bấm Đăng ngay...');
        try { postNowBtn.click(); } catch(e) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", e); }
        postNowBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await sleep(1000);
      }
      
      // Thành công nếu đổi URL sang trang quản lý bài viết
      if (window.location.href.includes('/tiktokstudio/content')) {
        isSuccess = true;
        break;
      }
      
      // Hoặc hiện modal báo thành công
      const pageText = (document.body.innerText || '').toLowerCase();
      if (pageText.includes('manage your posts') || pageText.includes('view profile') || pageText.includes('đăng thành công') || pageText.includes('uploaded successfully')) {
        isSuccess = true;
        break;
      }
    }

    if (!isSuccess) {
      addLog('⚠️ Hết thời gian chờ nhưng chưa thấy dấu hiệu thành công rõ ràng. Vẫn báo hoàn tất.');
    } else {
      addLog('✅ Đăng bài TikTok thành công!');
    }
    
    chrome.runtime.sendMessage({ action: 'postCompleted', postId: postId });

  } catch (error) {
    addLog(`❌ Lỗi: ${error.message}`);
    const stored = await chrome.storage.local.get('currentProcessingPost');
    if (stored.currentProcessingPost) {
      chrome.runtime.sendMessage({ action: 'postFailed', postId: stored.currentProcessingPost.id, error: error.message });
    }
  }

})();
}
