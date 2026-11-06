// ─── YouTube Automator (Studio Video/Shorts & Community Posts) ───
(function () {
  if (window.__mut_yt_automator_injected) return;
  window.__mut_yt_automator_injected = true;

  console.log('[MUT-YT-Automator] Injected on', location.href);

  const logs = [];
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function log(msg, extra) {
    const text = extra ? `${msg} ${extra}` : msg;
    console.log('[MUT-YT-Automator]', text);
    
    // Lưu vào extension log (bảng Đang xử lý)
    try {
      chrome.storage.local.set({ lastStatus: text });
    } catch(e) {}
    
    // Ghi ra màn hình
    const timeStr = new Date().toLocaleTimeString('vi-VN', {hour12:false});
    logs.push(`[${timeStr}] ${text}`);
    
    let el = document.getElementById('mut-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mut-status';
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
      <div style="font-weight:700;color:#ff0000;margin-bottom:10px;border-bottom:1px solid #334155;padding-bottom:5px;">
        ▶️ YouTube Automator
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
        ${logs.slice(-8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      </div>
    `;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Deep Shadow DOM Piercing Helpers ───
  function queryShadow(selector, root = document) {
    if (!root) return null;
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch (_) {}

    const allEls = root.querySelectorAll('*');
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
      const direct = root.querySelectorAll(selector);
      direct.forEach(el => results.push(el));
    } catch (_) {}

    const allEls = root.querySelectorAll('*');
    for (const el of allEls) {
      if (el.shadowRoot) {
        queryShadowAll(selector, el.shadowRoot, results);
      }
    }
    return results;
  }

  async function waitForShadowElement(selector, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = queryShadow(selector);
      if (el) return el;
      await sleep(500);
    }
    return null;
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

  function dataURLtoFile(dataurl, filename, fileType) {
    let arr = dataurl.split(','), mime = fileType || arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){ u8arr[n] = bstr.charCodeAt(n); }
    return new File([u8arr], filename, {type: mime});
  }

  function doClick(el) {
    if (!el) return;
    try {
      const target = el.querySelector('button') || el;
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      target.focus?.();
      const pointerOptions = { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      target.dispatchEvent(new PointerEvent('pointerdown', pointerOptions));
      target.dispatchEvent(new MouseEvent('mousedown', pointerOptions));
      target.dispatchEvent(new PointerEvent('pointerup', pointerOptions));
      target.dispatchEvent(new MouseEvent('mouseup', pointerOptions));
      target.click();
    } catch(e) {
      el.click();
    }
  }

  // ─── Video & Shorts Upload Automator (YouTube Studio) ───
  async function handleStudioVideoUpload(task) {
    log('Bắt đầu quy trình upload video YouTube Studio cho task:', task.id);

    // 1. Tìm hoặc mở dialog upload
    let fileInput = queryShadow('input[type="file"][name="Filedata"]') || queryShadow('ytcp-upload-dialog input[type="file"]') || queryShadow('input[type="file"]');
    if (!fileInput) {
      const createBtn = queryShadow('#create-icon') || queryShadow('ytcp-button#create-button') || queryShadow('button[aria-label*="Create"]') || queryShadow('button[aria-label*="Tạo"]');
      if (createBtn) {
        createBtn.click();
        await sleep(1500);
      }
      const uploadItem = queryShadow('#text-item-0') || queryShadow('ytcp-text-menu-item[test-id="upload-video"]');
      if (uploadItem) {
        uploadItem.click();
        await sleep(2000);
      }
      fileInput = await waitForShadowElement('input[type="file"]', 15000);
    }

    if (!fileInput) {
      throw new Error('Không tìm thấy nút upload tệp trên YouTube Studio');
    }

    // 2. Tải tệp media và inject
    const mediaUrls = Array.isArray(task.images) ? task.images : (typeof task.images === 'string' ? JSON.parse(task.images || '[]') : []);
    const videoUrl = mediaUrls.length > 0 ? mediaUrls[0] : null;
    if (!videoUrl) {
      throw new Error('Không tìm thấy URL video để đăng lên YouTube Studio');
    }

    log('Đang tải tệp video từ URL qua background...', videoUrl);
    const blobRes = await fetchImageViaBackground(videoUrl);
    if (!blobRes || !blobRes.success) throw new Error('Không thể tải tệp video từ server (có thể do lỗi mạng hoặc kích thước quá lớn).');
    const blob = dataURLtoFile(blobRes.dataUrl, `youtube_upload_${Date.now()}.${blobRes.type.includes('mp4') ? 'mp4' : 'mov'}`);

    const isShorts = (blob.size < 50 * 1024 * 1024); // Short video format
    const fileName = `youtube_upload_${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'mov'}`;
    const file = new File([blob], fileName, { type: blob.type || 'video/mp4' });

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    log('Đã nạp tệp video vào YouTube Studio, chờ giao diện khởi tạo...');
    await sleep(5000);

    // 3. Điền Tiêu đề
    const titleContainer = await waitForShadowElement('#textbox[aria-label*="title"], #textbox[aria-label*="tiêu đề"], ytcp-social-suggestions-textbox[label*="Title"] #textbox', 25000);
    if (titleContainer) {
      titleContainer.focus();
      const rawText = task.post_content || task.content || 'Video mới';
      const lines = rawText.split('\n').filter(Boolean);
      let title = lines[0] || 'Video mới';

      if (isShorts && !title.toLowerCase().includes('#shorts')) {
        title = `${title.slice(0, 80)} #Shorts`;
      }
      titleContainer.textContent = title;
      titleContainer.dispatchEvent(new Event('input', { bubbles: true }));
      log('Đã điền tiêu đề:', title);
    }

    // 4. Điền Mô tả
    await sleep(1500);
    const textboxes = queryShadowAll('#textbox');
    if (textboxes.length > 1) {
      const descInput = textboxes[1];
      descInput.focus();
      descInput.textContent = task.post_content || task.content || '';
      descInput.dispatchEvent(new Event('input', { bubbles: true }));
      log('Đã điền mô tả video');
    }

    // 5. Chọn "Không dành cho trẻ em"
    await sleep(2000);
    const notForKidsRadio = queryShadow('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]') || queryShadow('#made-for-kids-group tp-yt-paper-radio-button:nth-child(2)');
    if (notForKidsRadio) {
      notForKidsRadio.click();
      log('Đã chọn tùy chọn: Không dành cho trẻ em');
    }

    // 6. Bấm Tiếp tục qua các bước (Details -> Elements -> Checks -> Visibility)
    for (let step = 0; step < 3; step++) {
      await sleep(2500);
      const nextBtn = queryShadow('#next-button') || queryShadow('ytcp-button#next-button') || queryShadow('button[aria-label*="Next"]') || queryShadow('button[aria-label*="Tiếp"]');
      if (nextBtn && !nextBtn.hasAttribute('disabled')) {
        nextBtn.click();
        log(`Đã chuyển bước ${step + 1}`);
      }
    }

    // 7. Chọn chế độ hiển thị: Công khai (Public)
    await sleep(2500);
    const publicRadio = queryShadow('tp-yt-paper-radio-button[name="PUBLIC"]');
    if (publicRadio) {
      publicRadio.click();
      log('Đã chọn chế độ hiển thị: Công khai (Public)');
    }

    // 8. Chờ YouTube xử lý tải lên
    log('Đang chờ YouTube hoàn tất tải lên...');
    const maxWaitSec = 600;
    let waitedSec = 0;
    while (waitedSec < maxWaitSec) {
      const bodyText = document.body.innerText;
      if (bodyText.includes('Checks complete') || bodyText.includes('Upload complete') || bodyText.includes('Đã hoàn tất tải lên') || bodyText.includes('Hoàn tất xử lý')) {
        log('YouTube đã xác nhận video sẵn sàng!');
        break;
      }
      await sleep(5000);
      waitedSec += 5;
    }

    // 9. Bấm nút Xuất bản (Publish / Save)
    await sleep(2000);
    const doneBtn = queryShadow('#done-button') || queryShadow('ytcp-button#done-button') || queryShadow('button[aria-label*="Publish"]') || queryShadow('button[aria-label*="Xuất bản"]');
    if (doneBtn) {
      doneBtn.click();
      log('Đã bấm nút Xuất bản video YouTube!');
      await sleep(5000);
    }

    // 10. Thu thập Permalink và báo hoàn thành
    const shareLink = queryShadow('a[href*="youtu.be"]') || queryShadow('a.style-scope.ytcp-video-info');
    const permalink = shareLink ? shareLink.href : location.href;

    chrome.runtime.sendMessage({
      action: 'postCompleted',
      postId: task.id,
      resultUrl: permalink
    });
  }

  // ─── Community Post Automator (Bài viết Cộng đồng YouTube) ───
  // Đường đăng từ 2.6.0: tab Community của CHÍNH kênh đang đăng nhập —
  // https://www.youtube.com/@<handle>/community (bằng chứng live
  // 2026-11-05: kênh có khung soạn "Bạn đang nghĩ gì?" + nút Đăng ở đó;
  // contract startUrl post đã trỏ thẳng /community khi task có
  // social_username). Vào tab community mà không thấy ô soạn sau 15s ->
  // failed rõ ràng 'community_composer_not_found', không treo.
  //
  // ĐÍNH CHÍNH 2.6.1 (an toàn danh tính — bằng chứng probe DOM live
  // 2026-11-05): danh tính YouTube trong profile công nhân là tài khoản
  // Google "Linh Vu" CHƯA CÓ kênh (menu tài khoản không có
  // #channel-handle, chỉ có nút "Tạo kênh"). Bản 2.6.0 suy handle bằng
  // các lớp yếu (link /@ tự do, /feed/you + vanityChannelUrl) đã vớ
  // phải @baonhandanmedia — kênh của Báo Nhân Dân mà nick này chỉ ĐĂNG
  // KÝ XEM — tức có thể điều hướng/gõ bài vào kênh lạ. Từ 2.6.1 handle
  // CHỈ được chấp nhận từ 2 nguồn có thẩm quyền sở hữu:
  //   (a) task.social_username do người dùng cấp;
  //   (b) #channel-handle trong ytd-active-account-header-renderer
  //       (header menu tài khoản, mở qua #avatar-btn) — phần tử này chỉ
  //       tồn tại khi tài khoản ĐÃ CÓ kênh.
  // Không có #channel-handle -> fail 'no_youtube_channel', không
  // điều hướng sang kênh nào khác, không gõ vào bất kỳ ô nào. Từ
  // 2.6.3 kết luận "không có" chỉ được chốt sau khi ytResolveOwnHandle
  // đã chờ masthead + menu render đủ (xem §10 MODULE.md) — tránh fail
  // oan khi trang chưa sẵn sàng lúc inject.
  // Cache key đổi hậu tố ':v2' để vô hiệu cache có thể đã nhiễm handle
  // kênh lạ từ các phiên chạy bản 2.6.0 trong cùng tab.
  const YT_HANDLE_CACHE_KEY = 'avjpYtOwnHandle:v2';
  const ytNavKey = taskId => `avjpYtCommunityNav:${taskId}`;

  function ytHandleFromPath() {
    const m = /^\/@([A-Za-z0-9._-]+)\/community/.exec(location.pathname);
    return m ? m[1] : null;
  }
  function ytHandleInDom() {
    // Nguồn có thẩm quyền DUY NHẤT trong DOM: #channel-handle nằm trong
    // header menu tài khoản. #channel-handle chỉ xuất hiện ở đúng phần
    // tử đó trên toàn trang YouTube; neo scoped đặt trước, neo trần là
    // cùng một phần tử. TUYỆT ĐỐI không lấy handle từ link /@ tự do
    // hay dữ liệu nhúng trong trang (đã gỡ ở 2.6.1 — xem ghi chú trên).
    const handleEl = queryShadow('ytd-active-account-header-renderer #channel-handle')
      || queryShadow('#channel-handle');
    const ht = handleEl ? String(handleEl.textContent || '').trim() : '';
    if (/^@[A-Za-z0-9._-]+$/.test(ht)) return ht.slice(1);
    return null;
  }
  async function ytResolveOwnHandle(task, waitFor) {
    const fromTask = String(task.social_username || '').trim().replace(/^@/, '');
    if (fromTask && !/^UC[\w-]{22}$/.test(fromTask)) return fromTask;
    try {
      const cached = sessionStorage.getItem(YT_HANDLE_CACHE_KEY);
      if (cached) return cached;
    } catch (_) {}
    let handle = ytHandleInDom();
    if (!handle) {
      // Mở menu tài khoản bằng nút avatar rồi đọc #channel-handle trong
      // header của menu. Menu không có #channel-handle = tài khoản chưa
      // có kênh -> trả null, caller fail 'no_youtube_channel'.
      // Vá 2.6.3: KHÔNG được kết luận "chưa có kênh" từ một lần thử
      // ngay lúc inject — bằng chứng live: kênh @LinhVu-t2g đã tồn tại
      // (mở menu tay thì #channel-handle hiện sau ~1s) nhưng task post
      // không kèm social_username vẫn fail no_youtube_channel, receipt
      // về sau ~4s kể từ enqueue: tại thời điểm inject masthead chưa
      // render xong nên query avatar trả null (hoặc click rơi trước
      // khi YouTube gắn handler) -> không mở menu -> fail oan. Nay:
      // (1) poll chờ nút avatar XUẤT HIỆN tối đa 10s rồi mới bấm;
      // (2) sau khi bấm, poll #channel-handle tối đa 10s — ~4s đầu mà
      // header menu (ytd-active-account-header-renderer) vẫn chưa xuất
      // hiện thì bấm avatar thêm 1 lần nữa rồi poll nốt phần còn lại
      // (header đã hiện mà thiếu handle thì KHÔNG bấm lại — bấm nữa sẽ
      // đóng menu; trường hợp đó là chưa có kênh thật). Chỉ sau khi đã
      // chờ đủ các bước trên mới trả null.
      const avatar = await waitFor(() => queryShadow('#avatar-btn, button#avatar-btn'), 10000);
      if (avatar) {
        doClick(avatar);
        handle = await waitFor(() => ytHandleInDom(), 4000);
        if (!handle) {
          if (!queryShadow('ytd-active-account-header-renderer')) {
            const avatarRetry = queryShadow('#avatar-btn, button#avatar-btn');
            if (avatarRetry) doClick(avatarRetry);
          }
          handle = await waitFor(() => ytHandleInDom(), 6000);
        }
      }
    }
    if (handle) {
      try { sessionStorage.setItem(YT_HANDLE_CACHE_KEY, handle); } catch (_) {}
    }
    return handle;
  }

  async function handleYouTubeCommunityPost(task) {
    log('Bắt đầu đăng Bài viết Cộng đồng YouTube', task.id);
    const activeTask = async () => {
      const stored = await chrome.storage.local.get(['currentProcessingPost', 'isPaused']);
      if (stored.isPaused || String(stored.currentProcessingPost?.id) !== String(task.id)) {
        throw new Error('Tác vụ YouTube đã dừng hoặc thay đổi.');
      }
    };
    const waitFor = async (check, timeoutMs = 30000) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        await activeTask();
        const value = check();
        if (value) return value;
        await sleep(300);
      }
      return null;
    };
    await activeTask();
    const expectedChannel = String(task.social_uid || '').trim();
    const actualChannel = document.querySelector('a[href*="studio.youtube.com/channel/"]')?.href.match(/\/channel\/(UC[\w-]+)/)?.[1];
    if (/^UC[\w-]{22}$/.test(expectedChannel) && actualChannel && actualChannel !== expectedChannel) {
      throw new Error('Kênh YouTube đang mở không khớp tài khoản của bài đăng.');
    }

    // --- Đưa tab về đúng tab Community của kênh (điều hướng = return,
    // bản inject ở trang mới tự chạy tiếp nhờ auto-start) ---
    const onCommunityOf = ytHandleFromPath();
    const taskHandle = String(task.social_username || '').trim().replace(/^@/, '');
    if (!onCommunityOf || (taskHandle && onCommunityOf.toLowerCase() !== taskHandle.toLowerCase())) {
      const handle = await ytResolveOwnHandle(task, waitFor);
      if (!handle) throw new Error('no_youtube_channel: Tài khoản YouTube chưa có kênh, không đăng Community được.');
      if (!onCommunityOf || onCommunityOf.toLowerCase() !== handle.toLowerCase()) {
        let navCount = 0;
        try {
          navCount = Number(sessionStorage.getItem(ytNavKey(task.id)) || 0);
          sessionStorage.setItem(ytNavKey(task.id), String(navCount + 1));
        } catch (_) {}
        if (navCount >= 4) throw new Error('community_composer_not_found: đã điều hướng về tab Community nhiều lần mà vẫn chưa tới được trang soạn bài.');
        log('Điều hướng tới tab Community của kênh @' + handle);
        location.href = `https://www.youtube.com/@${handle}/community`;
        await sleep(60000); // chờ trang mới thay thế — bản inject mới chạy tiếp
        return;
      }
    }

    // --- Tìm ô soạn trên tab Community: editor đã mở sẵn, hoặc phần tử
    // mở hộp soạn (placeholder / #post-button / shelf "Bạn đang nghĩ gì?").
    // Quá 15s không thấy -> failed 'community_composer_not_found'. ---
    const findComposer = () => {
      const ed = queryShadow('ytd-backstage-post-dialog-renderer #contenteditable-root[contenteditable="true"]');
      if (ed) return { editor: ed };
      const direct = queryShadow('ytd-backstage-post-dialog-renderer #commentbox-placeholder')
        || queryShadow('#commentbox-placeholder')
        || queryShadow('#post-button');
      if (direct) return { opener: direct };
      const shelf = queryShadow('ytd-backstage-post-shelf-renderer');
      if (shelf) {
        const t = [...shelf.querySelectorAll('*')].find(el =>
          /bạn đang nghĩ gì|what's on your mind/i.test(el.textContent || '') && el.children.length <= 2);
        if (t) return { opener: t };
      }
      return null;
    };
    const composer = await waitFor(findComposer, 15000);
    if (!composer) {
      throw new Error('community_composer_not_found: vào tab Community nhưng không thấy ô soạn bài sau 15s (kênh có thể chưa đủ điều kiện mở Community post).');
    }
    if (composer.opener) doClick(composer.opener);
    const inputDiv = await waitFor(() => queryShadow('ytd-backstage-post-dialog-renderer #contenteditable-root[contenteditable="true"]'), 10000);
    if (inputDiv) {
      inputDiv.focus();
      inputDiv.textContent = task.post_content || task.content || '';
      inputDiv.dispatchEvent(new Event('input', { bubbles: true }));
      if (inputDiv.textContent !== String(task.post_content || task.content || '')) throw new Error('Nội dung bài viết YouTube chưa được điền đúng.');
      log('Đã điền nội dung bài viết cộng đồng');
    } else {
      throw new Error('Không tìm thấy ô nhập nội dung bài viết.');
    }

    const mediaUrls = Array.isArray(task.images) ? task.images : (typeof task.images === 'string' ? JSON.parse(task.images || '[]') : []);
    if (mediaUrls.length > 10) throw new Error('YouTube chỉ cho phép tối đa 10 ảnh trong một bài Cộng đồng.');
    if (mediaUrls.length) {
      const imgBtn = queryShadow('ytd-backstage-post-dialog-renderer #image-button button');
      if (!imgBtn) throw new Error('Không tìm thấy nút đính kèm Hình ảnh.');
      doClick(imgBtn);
      const fileInput = await waitFor(() => queryShadow('ytd-backstage-multi-image-select-renderer #dropzone input[type="file"][name="Filedata"][multiple]'), 10000);
      if (!fileInput) throw new Error('Không tìm thấy input tải ảnh của bài Cộng đồng.');

      const files = new DataTransfer();
      for (let i = 0; i < mediaUrls.length; i++) {
        log(`Đang tải ảnh ${i + 1}/${mediaUrls.length} từ máy chủ...`);
        const image = await fetchImageViaBackground(mediaUrls[i]);
        const declaredType = String(image?.type || '').split(';')[0].toLowerCase();
        const header = image?.dataUrl ? atob(image.dataUrl.split(',')[1].slice(0, 32)) : '';
        const detectedType = header.startsWith('\xff\xd8') ? 'image/jpeg'
          : header.startsWith('\x89PNG') ? 'image/png'
            : header.startsWith('GIF8') ? 'image/gif'
              : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP' ? 'image/webp' : '';
        const imageType = detectedType || declaredType;
        if (!image?.success || !/^image\/(?:jpeg|png|webp|gif)$/.test(imageType)) {
          throw new Error(`Không tải được ảnh ${i + 1} hoặc định dạng ảnh không được YouTube hỗ trợ.`);
        }
        const extension = imageType === 'image/jpeg' ? 'jpg' : imageType.split('/')[1];
        files.items.add(dataURLtoFile(image.dataUrl, `community_${Date.now()}_${i + 1}.${extension}`, imageType));
      }
      fileInput.files = files.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      const preview = await waitFor(() => {
        const picker = queryShadow('ytd-backstage-multi-image-select-renderer');
        const error = picker?.querySelector('#error-message');
        if (error && !error.hidden && error.textContent.trim()) throw new Error(`YouTube từ chối ảnh: ${error.textContent.trim()}`);
        const container = picker?.querySelector('#multi-image-container');
        const button = queryShadow('ytd-backstage-post-dialog-renderer #submit-button button');
        return container && !container.hidden && container.querySelector('img[src]') && button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
      }, 60000);
      if (!preview) throw new Error('YouTube chưa xác nhận ảnh đã tải xong; chưa bấm Đăng.');
    }

    const postBtn = await waitFor(() => {
      const button = queryShadow('ytd-backstage-post-dialog-renderer #submit-button button');
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    }, 15000);
    if (!postBtn) throw new Error('Nút Đăng chưa sẵn sàng; chưa gửi bài lên YouTube.');
    // Proof (2.6.0): nội dung bài xuất hiện trong danh sách bài đăng của
    // tab Community trong tối đa 20s. Chụp snapshot các PHẦN TỬ bài đăng
    // trước khi bấm Đăng (trang render qua web components lồng nhau nên
    // phải quét cả shadow DOM bằng queryShadowAll như các helper trên);
    // sau khi bấm, một phần tử bài MỚI chứa chữ ký nội dung = proof.
    const postSignature = String(task.post_content || task.content || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const communityPostEls = () => queryShadowAll('ytd-backstage-post-renderer, ytd-backstage-post-thread-renderer');
    const knownEls = new Set(communityPostEls());
    await activeTask();
    doClick(postBtn);
    log('Đã bấm Đăng; đang chờ bài mới xuất hiện ở đầu danh sách...');
    const newPostEl = await waitFor(() => {
      if (!postSignature) return null;
      for (const el of communityPostEls()) {
        if (knownEls.has(el)) continue;
        const text = String(el.querySelector('#content-text')?.textContent || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.includes(postSignature)) return el;
      }
      return null;
    }, 20000);
    if (!newPostEl) {
      throw new Error('community_post_unconfirmed: đã bấm Đăng nhưng nội dung bài chưa xuất hiện trong danh sách sau 20s.');
    }
    // Permalink: link /post/... bên trong chính bài vừa đăng (link mốc
    // thời gian); không lấy được thì dùng URL trang Community hiện tại.
    const permalinkEl = newPostEl.querySelector('a[href*="/post/"]');
    const resultUrl = permalinkEl ? String(permalinkEl.href || permalinkEl.getAttribute('href')) : location.href;

    chrome.runtime.sendMessage({
      action: 'postCompleted',
      postId: task.id,
      resultUrl
    });
  }

  // ─── Lắng nghe lệnh từ Background ───
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_YOUTUBE_POST') {
      const task = request.task || {};
      const isStudio = location.hostname.includes('studio.youtube.com');
      const runner = isStudio ? handleStudioVideoUpload(task) : handleYouTubeCommunityPost(task);

      runner
        .then(() => sendResponse({ success: true }))
        .catch(err => {
          console.error('[MUT-YT-Automator] Lỗi đăng bài YouTube:', err);
          chrome.runtime.sendMessage({
            action: 'postFailed',
            postId: task.id,
            error: err.message || String(err)
          });
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
  });

  // Tự động kích hoạt khi tab Studio / YouTube load xong
  chrome.storage.local.get('currentProcessingPost', stored => {
    const post = stored.currentProcessingPost;
    if (post && (post.platform === 'youtube' || post.account_platform === 'youtube')) {
      const isStudio = location.hostname.includes('studio.youtube.com');
      const runner = isStudio ? handleStudioVideoUpload(post) : handleYouTubeCommunityPost(post);
      runner.catch(err => {
        const errMsg = err.message || String(err);
        console.warn('[MUT-YT-Automator] Auto-start YouTube task failed:', err);
        log('❌ LỖI:', errMsg);
        chrome.runtime.sendMessage({
          action: 'postFailed',
          postId: post.id,
          error: errMsg
        });
      });
    }
  });
})();
