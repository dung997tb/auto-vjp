// Moigioi Instagram Automator v1.0
// Port từ Gflowup2/js/ig-automator.js, thích nghi với kiến trúc moigioi extension
// 2.7.0 (Auto vjp): media VIDEO đi luồng Reels — chọn mục Reel trong
// menu Tạo khi có, chọn phía Reel khi IG hỏi Post/Reel sau khi nạp file,
// 2.9.0 (Auto vjp): nút Tạo (ig.post.createBtn) + nút Share
// (ig.post.shareBtn) rơi qua AVJP.heal.locate khi finder gốc bó tay;
// spec qua AI chỉ markProven tại điểm postCompleted. Xem HEALER.md.
// caption = post_content || content; task video có `ai_prompt` thì xin
// caption AI qua action getNurtureAiComment của kernel (deadline 70s,
// lỗi -> dùng caption gốc + details `ai_fallback`). PROOF Reels:
// fetch-parse trang /<username>/reels/ (KHÔNG điều hướng tab — script
// này sẽ bị inject lại nếu chuyển trang) tìm link /reel/ MỚI so với
// baseline chụp trước khi đăng; thấy -> resultUrl là link reel đó,
// không thấy -> giữ URL profile như cũ + log cảnh báo.
if (window.moigioi_injected_ig) {
  console.log('[Moigioi-IG] Script already injected, exiting.');
} else {
window.moigioi_injected_ig = true;

(async function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const logs = [];

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function addLog(msg) {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs.push(`[${timeStr}] ${msg}`);
    console.log('[Moigioi-IG]', msg);
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
      <div style="font-weight:700;color:#ec4899;margin-bottom:10px;border-bottom:1px solid #334155;padding-bottom:5px;">
        📸 Trợ lý Đăng Instagram
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;color:#cbd5e1;">
        ${logs.slice(-8).map(l => `<div>${escapeHtml(l)}</div>`).join('')}
      </div>
    `;
  }

  function doClick(el) {
    if (!el) return;
    const target = el.closest?.('a, button, [role="button"], [role="menuitem"]') || el;
    try { target.focus(); } catch (e) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", e); }
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

  // (2.11.7) Ảnh mặc định của riêng Auto vjp qua helper shared
  // AVJP.defaultImage (contract nạp trước automator); helper vắng mặt
  // (inject cũ) thì rơi thẳng về asset gói sẵn trong extension.
  async function resolveDefaultImageUrl() {
    if (window.AVJP && AVJP.defaultImage && AVJP.defaultImage.resolveDefaultImageUrl) {
      return AVJP.defaultImage.resolveDefaultImageUrl();
    }
    return chrome.runtime.getURL('assets/default-preview.png');
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

  function generateQuoteCardInsideExtension(text, title, ratio = '3:4', watermark = '', themeKey = 'dark_indigo') {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        const width = 1080;
        let height = 1440; // Mặc định 3:4 (1080x1440)
        if (ratio === '4:5') height = 1350;
        else if (ratio === '1:1') height = 1080;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Cannot get 2d context');

        const QUOTE_THEMES = {
          dark_indigo: {
            background: ['#0f172a', '#1e1b4b'],
            textColor: '#ffffff',
            quoteColor: 'rgba(255, 255, 255, 0.06)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            watermarkColor: 'rgba(255, 255, 255, 0.4)',
            titleColor: '#f472b6'
          },
          deep_purple: {
            background: ['#1e1b4b', '#311042'],
            textColor: '#ffffff',
            quoteColor: 'rgba(255, 255, 255, 0.06)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            watermarkColor: 'rgba(255, 255, 255, 0.4)',
            titleColor: '#f472b6'
          },
          midnight_blue: {
            background: ['#020617', '#0f172a'],
            textColor: '#ffffff',
            quoteColor: 'rgba(255, 255, 255, 0.06)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            watermarkColor: 'rgba(255, 255, 255, 0.4)',
            titleColor: '#38bdf8'
          },
          sunset_glow: {
            background: ['#311042', '#701a75'],
            textColor: '#ffffff',
            quoteColor: 'rgba(255, 255, 255, 0.06)',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            watermarkColor: 'rgba(255, 255, 255, 0.4)',
            titleColor: '#fde047'
          },
          minimal_white: {
            background: ['#f8fafc', '#f1f5f9'],
            textColor: '#0f172a',
            quoteColor: 'rgba(15, 23, 42, 0.04)',
            borderColor: 'rgba(15, 23, 42, 0.08)',
            watermarkColor: 'rgba(15, 23, 42, 0.4)',
            titleColor: '#db2777'
          },
          soft_cream: {
            background: ['#fdfbf7', '#f5ebe0'],
            textColor: '#4a3728',
            quoteColor: 'rgba(74, 55, 40, 0.03)',
            borderColor: 'rgba(74, 55, 40, 0.06)',
            watermarkColor: 'rgba(74, 55, 40, 0.4)',
            titleColor: '#c2410c'
          }
        };

        const theme = QUOTE_THEMES[themeKey] || QUOTE_THEMES.dark_indigo;

        // 1. Vẽ nền gradient đẹp mắt
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, theme.background[0]);
        grad.addColorStop(1, theme.background[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // 2. Vẽ viền trang trí mờ nhẹ thích ứng theo chiều cao
        ctx.strokeStyle = theme.borderColor;
        ctx.lineWidth = 20;
        ctx.strokeRect(40, 40, width - 80, height - 80);

        // 3. Vẽ biểu tượng dấu ngoặc kép trích dẫn khổng lồ mở ở trên-trái
        ctx.font = '900 240px Georgia, serif';
        ctx.fillStyle = theme.quoteColor;
        ctx.fillText('“', 100, 240);

        // 3b. Vẽ dấu ngoặc kép khép lại ở dưới-phải
        ctx.fillText('”', width - 200, height - 140);

        // 4. Trích xuất chỉ đoạn văn đầu tiên (Paragraph 1), giới hạn 140 ký tự để ảnh thoáng đãng
        const paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
        let quoteText = paragraphs[0] || '';
        if (quoteText.length > 140) {
          quoteText = quoteText.substring(0, 140) + '...';
        }

        // 5. Cấu hình vẽ chữ & word wrap
        ctx.fillStyle = theme.textColor;
        ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const maxWidth = 840;
        const words = quoteText.split(' ');
        const lines = [];
        let currentLine = '';

        for (let n = 0; n < words.length; n++) {
          const testLine = currentLine + (currentLine ? ' ' : '') + words[n];
          const metrics = ctx.measureText(testLine);
          const testWidth = metrics.width;
          if (testWidth > maxWidth && n > 0) {
            lines.push(currentLine);
            currentLine = words[n];
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) {
          lines.push(currentLine);
        }

        // Giới hạn tối đa 6 dòng để ảnh cực kỳ thoáng mắt
        const displayLines = lines.slice(0, 6);
        if (lines.length > 6) {
          displayLines[displayLines.length - 1] += '...';
        }

        // Vẽ các dòng chữ căn giữa chiều dọc
        const lineHeight = 64;
        const totalHeight = displayLines.length * lineHeight;
        let startY = (height - totalHeight) / 2 + lineHeight / 2;

        // Vẽ tiêu đề nếu có
        if (title && title.trim()) {
          ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
          ctx.fillStyle = theme.titleColor; // Hồng nhạt
          ctx.fillText(title.trim().toUpperCase(), width / 2, startY - 80);
          ctx.fillStyle = theme.textColor;
          ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
        }

        displayLines.forEach((line) => {
          ctx.fillText(line, width / 2, startY);
          startY += lineHeight;
        });

        // 6. Vẽ chữ ký watermark cá nhân hóa của tài khoản ở góc dưới
        if (watermark && watermark.trim()) {
          ctx.font = 'medium 26px system-ui, -apple-system, sans-serif';
          ctx.fillStyle = theme.watermarkColor;
          ctx.fillText(watermark.trim(), width / 2, height - 90);
        }

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], `quote_instagram_${Date.now()}.png`, { type: 'image/png' }));
          } else {
            reject(new Error('Canvas blob is empty'));
          }
        }, 'image/png');
      } catch (e) {
        reject(e);
      }
    });
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

  async function findByText(texts, retries = 5) {
    for (let i = 0; i < retries; i++) {
      const els = document.querySelectorAll('span, div, button, a');
      for (const el of els) {
        const text = (el.innerText || '').trim();
        if (!text) continue;
        if (texts.some(t => text === t || text.toLowerCase() === t.toLowerCase())) {
          return el;
        }
      }
      await sleep(1000);
    }
    return null;
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
  const findComposerDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).find(dialog => {
    if (dialog.querySelector('input[type="file"]')) return true;
    const text = normalizeUiText(dialog.innerText || dialog.textContent);
    return /tạo bài viết|tạo bài đăng|create (?:new )?post|tạo thước phim|create (?:new )?reel|new reel|thước phim|chọn từ (?:máy tính|thiết bị)|select from (?:computer|device)|kéo ảnh|drag photos|crop|cắt|chỉnh sửa|bộ lọc|filters|nguyên bản|original/i.test(text);
  }) || document.querySelector('[role="dialog"]') || null;
  const findFileInputIn = root => root?.querySelector(
    'input[type="file"][accept*="image"], input[type="file"][accept*="video"], input[type="file"]'
  ) || null;
  const findSelectFromComputerButton = root => Array.from(root?.querySelectorAll?.('button, [role="button"]') || []).find(button => {
    const labels = [button.getAttribute('aria-label'), button.innerText, button.textContent].map(normalizeUiText).filter(Boolean);
    return isVisible(button) && labels.some(label => /(chọn từ (?:máy tính|thiết bị)|tải lên|select from (?:computer|device))/i.test(label));
  }) || null;

  // ── 2.7.0: AI caption (đường getNurtureAiComment của kernel, cùng
  // họ nuôi) + Reels helpers ──
  // Deadline riêng 70s (< trần 75s): AI treo không treo phiên đăng.
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
  const cleanAiCaption = value => String(value || '')
    .replace(/```[a-z]*\n?/gi, '').replace(/```/g, '')
    .trim().replace(/^["“]+|["”]+$/g, '').trim();

  const RESERVED_PROFILE_SEGMENTS = new Set(['explore', 'reels', 'reel', 'direct', 'stories', 'accounts', 'p', 'tv', 'live', 'create', 'inbox', 'notifications']);
  function extractOwnProfile() {
    const link = Array.from(document.querySelectorAll('a[href^="/"]')).find(a => {
      const h = a.getAttribute('href') || '';
      const m = /^\/([A-Za-z0-9._]+)\/?$/.exec(h);
      return m && !RESERVED_PROFILE_SEGMENTS.has(m[1].toLowerCase());
    });
    if (!link) return null;
    const href = link.getAttribute('href');
    return { name: href.replace(/^\/|\/$/g, ''), url: 'https://www.instagram.com' + href };
  }

  // Đọc lưới Reels của chính nick bằng fetch cùng origin (không điều
  // hướng tab). Trả Set link /reel/... khi đọc được, null khi lỗi —
  // null nghĩa là "không có baseline", khác với Set rỗng "chưa có reel".
  async function fetchReelLinks(actorName) {
    if (!actorName) return null;
    try {
      const res = await fetch(`https://www.instagram.com/${encodeURIComponent(actorName)}/reels/`, { credentials: 'include' });
      if (!res.ok) return null;
      const html = await res.text();
      const links = new Set();
      for (const m of html.matchAll(/\/reel\/[A-Za-z0-9_-]+\//g)) {
        links.add('https://www.instagram.com' + m[0]);
      }
      return links;
    } catch (_) {
      return null;
    }
  }

  // IG có biến thể hỏi "đăng dạng Bài viết hay Thước phim?" sau khi
  // chọn file: chỉ bấm khi trong CÙNG một lớp dialog/menu có cả lựa
  // chọn Post lẫn Reel dạng bấm được — tránh bấm nhầm tab Reel ở editor.
  async function chooseReelIfAsked() {
    const layers = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')).filter(isVisible);
    for (const layer of layers) {
      const candidates = Array.from(layer.querySelectorAll('button, [role="button"], a, [role="menuitem"], div[tabindex]')).filter(isVisible);
      const labelOf = el => normalizeUiText(el.innerText || el.textContent || el.getAttribute('aria-label'));
      const hasPostOption = candidates.some(el => /^(post|bài viết|bài đăng)$/i.test(labelOf(el)) ||
        (/^(chia sẻ|share|đăng)/i.test(labelOf(el)) && /(bài viết|bài đăng|post)/i.test(labelOf(el))));
      const reelOption = candidates.find(el => {
        const t = labelOf(el);
        return /^(reel|reels|thước phim)$/i.test(t) ||
          ((/reel|thước phim/.test(t)) && !/(live|trực tiếp|tin|story|bài viết|bài đăng|post)/.test(t));
      });
      if (hasPostOption && reelOption) {
        doClick(reelOption);
        addLog('✅ IG hỏi Post/Reel — đã chọn Thước phim (Reel)');
        await sleep(2000);
        return true;
      }
    }
    return false;
  }

  // ══ MAIN ══
  let postId = null;
  let aiDetails = null; // 'ai_fallback' khi AI caption lỗi (ghi receipt)
  // (2.9.0) Tự chữa selector: ứng viên {key, spec} định vị qua AI cho
  // nút Tạo/Share — chỉ markProven tại điểm postCompleted (proof của
  // module), xem modules/shared/HEALER.md.
  const healPending = [];
  try {
    addLog('Khởi động tiến trình đăng Instagram...');
    await sleep(3000);

    const stored = await chrome.storage.local.get('currentProcessingPost');
    const post = stored.currentProcessingPost;
    if (!post) {
      addLog('❌ Không tìm thấy bài đăng.');
      return;
    }
    postId = post.id;

    // 1. CHUẨN BỊ FILE
    let images = [];
    try {
      const raw = post.images || post.media_urls || post.images_json;
      images = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (e) { /* ignore */ }

    const files = [];

    if (images.length === 0) {
      addLog('🎨 Bài không có ảnh. Tự động vẽ ảnh Quote trong Extension...');
      try {
        const quoteText = post.post_content || post.content || post.title || 'MUTVN Quote';
        const watermarkText = post.social_name ? `@${post.social_name}` : '';
        const storedConfig = await chrome.storage.local.get(['mutvn_quote_ratio', 'mutvn_quote_theme']);
        const ratio = storedConfig.mutvn_quote_ratio || '3:4';
        const theme = storedConfig.mutvn_quote_theme || 'dark_indigo';
        const file = await generateQuoteCardInsideExtension(quoteText, post.title, ratio, watermarkText, theme);
        files.push(file);
        addLog('✅ Tự động tạo ảnh Quote thành công!');
      } catch (err) {
        addLog(`❌ Không thể tự sinh ảnh quote: ${err.message}. Fallback về ảnh mặc định...`);
        images = [await resolveDefaultImageUrl()];
      }
    }

    // IG cho phép tối đa 10 file
    if (images.length > 10) {
      addLog(`⚠️ IG giới hạn 10 ảnh, lược bỏ ${images.length - 10} ảnh cuối`);
      images = images.slice(0, 10);
    }

    if (images.length > 0) {
      addLog(`Tải ${images.length} ảnh qua background...`);
      for (let i = 0; i < images.length; i++) {
        const res = await fetchImageViaBackground(images[i]);
      if (res && res.dataUrl) {
        let rawMime = (res.type || (res.dataUrl.split(';')[0].split(':')[1] || '')).trim().toLowerCase();
        if (!rawMime || rawMime === 'application/octet-stream' || rawMime === 'binary/octet-stream') {
          rawMime = (post.resolved_media_type || '').toLowerCase();
        }

        const isActuallyVideo = rawMime.includes('video') || 
                                (post.resolved_media_type || '').startsWith('video/') || 
                                Boolean(post.deferred_media?.source_url);

        const ext = isActuallyVideo ? (rawMime.includes('webm') ? 'webm' : 'mp4') : (rawMime.includes('jpeg') || rawMime.includes('jpg') ? 'jpg' : 'png');
        const finalMime = isActuallyVideo 
          ? (rawMime.includes('video') ? rawMime : 'video/mp4') 
          : (rawMime.includes('jpeg') || rawMime.includes('jpg') ? 'image/jpeg' : 'image/png');

        let file = dataURLtoFile(res.dataUrl, `ig_${i}.${ext}`, finalMime);

        if (window.mutWatermarkService && post.watermark_config && !isActuallyVideo) {
          try {
            const context = { accountName: post.social_name || post.social_uid || '', platform: post.platform || '' };
            const watermarkedBlob = await window.mutWatermarkService.applyWatermark(file, post.watermark_config, context);
            const validWatermarkType = (watermarkedBlob.type && watermarkedBlob.type !== 'application/octet-stream')
              ? watermarkedBlob.type
              : finalMime;
            file = new File([watermarkedBlob], `ig_${i}.${ext}`, { type: validWatermarkType });
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
    }
    if (files.length === 0) throw new Error('Không tải được ảnh nào');

    // 1b. (2.7.0) REELS + AI: media video -> chuẩn bị đường Reels.
    // - Chụp baseline link /reel/ hiện có của nick (proof sau đăng chỉ
    //   nhận link MỚI so với baseline này).
    // - Caption hiệu dụng = post_content || content; task có ai_prompt
    //   -> xin caption AI (prompt = ai_prompt + caption gốc làm chất
    //   liệu), AI lỗi/timeout -> giữ caption gốc + aiDetails ai_fallback.
    const hasVideoMedia = files.some(file => file.type.startsWith('video/')) ||
      String(post.resolved_media_type || '').startsWith('video/') ||
      Boolean(post.deferred_media?.source_url);
    let effectiveCaption = post.post_content || post.content || '';
    const earlyActor = extractOwnProfile();
    let baselineReelLinks = null;
    if (hasVideoMedia && earlyActor?.name) {
      baselineReelLinks = await fetchReelLinks(earlyActor.name);
      if (baselineReelLinks) addLog(`🎞️ Baseline Reels: nick đang có ${baselineReelLinks.size} reel`);
    }
    const aiPrompt = String(post.ai_prompt || '').trim();
    if (hasVideoMedia && aiPrompt) {
      addLog('🤖 Có ai_prompt — đang xin caption AI cho Reel (deadline 70s)...');
      const aiReq = [
        aiPrompt,
        'Chỉ trả về đúng caption cuối cùng sẽ đăng, không giải thích, không thêm ngoặc kép bao ngoài.',
        effectiveCaption ? `Chất liệu từ nội dung task:\n${String(effectiveCaption).slice(0, 1000)}` : ''
      ].filter(Boolean).join('\n\n');
      const aiRes = await requestAiText(aiReq);
      const aiCaption = aiRes?.success && aiRes.text ? cleanAiCaption(aiRes.text) : '';
      if (aiCaption) {
        effectiveCaption = aiCaption;
        aiDetails = 'ai_used';
        addLog('🤖 Đã dùng caption AI cho Reel');
      } else {
        aiDetails = 'ai_fallback';
        addLog(`⚠️ AI lỗi (${aiRes?.error || 'trả rỗng'}) — ai_fallback: dùng caption gốc của task`);
      }
    }

    // 2. MỞ NÚT CREATE / TẠO (+)
    await dismissKnownInstagramPopup();
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
        const svg = a.querySelector('svg');
        const svgLabel = normalizeUiText(svg?.getAttribute('aria-label'));
        return /^(create|tạo|tạo mới|bài viết mới|tạo bài viết|new post)$/i.test(text) ||
               /^(create|tạo|tạo mới|bài viết mới|tạo bài viết|new post)$/i.test(svgLabel) ||
               /(create|tạo mới|bài viết mới)/i.test(text);
      });
    }
    if (!createBtn && window.AVJP?.heal) {
      // (2.9.0) Finder gốc bó tay -> tự chữa selector cho nút Tạo.
      const healed = await window.AVJP.heal.locate({
        platform: 'instagram', key: 'ig.post.createBtn',
        intent: 'Nút Tạo bài viết mới (Create / dấu +) ở thanh điều hướng của Instagram, bấm để mở trình tạo bài viết/reel',
        builtins: [
          { by: 'aria', value: 'New post' },
          { by: 'svgTitle', value: 'New post' },
          { by: 'aria', value: 'Create' },
          { by: 'aria', value: 'Tạo mới' },
          { by: 'aria', value: 'Tạo' }
        ],
        timeoutMs: 30000
      }).catch(() => null);
      if (healed) {
        createBtn = healed.el;
        addLog(`🩺 Heal: thấy nút Tạo qua đường ${healed.via}`);
        if (healed.via === 'ai') healPending.push({ platform: 'instagram', key: 'ig.post.createBtn', spec: healed.spec });
      }
    }
    if (!createBtn) throw new Error('Không tìm thấy nút Create / Tạo (+)');
    doClick(createBtn);
    addLog('✅ Đã bấm nút Tạo / Create');
    await sleep(2000);

    // Kiểm tra xem modal đã mở trực tiếp chưa
    let composer = findComposerDialog();
    if (!composer) {
      // Một số giao diện hiển thị menu popover với lựa chọn "Post / Bài viết / Bài đăng"
      addLog('Tìm lựa chọn Bài viết trong menu popover...');
      const menuContainers = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], div[style*="fixed"], div[style*="absolute"]'))
        .filter(isVisible);

      // (2.7.0) Media VIDEO: ưu tiên chọn mục Reel/Thước phim trong
      // menu Tạo trước; không thấy mục Reel thì rơi về mục Bài viết
      // như cũ (biến thể UI đó tự đưa video vào editor Reels).
      let pickedReel = false;
      if (hasVideoMedia) {
        for (const container of menuContainers) {
          const candidates = Array.from(container.querySelectorAll('a, [role="menuitem"], [role="button"], button, div[tabindex]'))
            .filter(isVisible);
          const reelSub = candidates.find(el => {
            const t = normalizeUiText(el.innerText || el.textContent || el.getAttribute('aria-label'));
            return /^(reel|reels|thước phim|tạo thước phim|create reel|new reel)$/i.test(t) ||
                   ((/reel|thước phim/.test(t)) && !/(live|trực tiếp|tin|story|bài viết|bài đăng|post)/.test(t));
          });
          if (reelSub) {
            doClick(reelSub);
            pickedReel = true;
            addLog('✅ Đã chọn loại: Thước phim (Reel)');
            await sleep(1500);
            break;
          }
        }
        if (!pickedReel) addLog('Không thấy mục Reel trong menu Tạo — đi đường Bài viết như cũ (UI tự vào editor Reels với video)');
      }

      let postSub = null;
      if (!pickedReel) {
      for (const container of menuContainers) {
        const candidates = Array.from(container.querySelectorAll('a, [role="menuitem"], [role="button"], button, div[tabindex]'))
          .filter(isVisible);
        postSub = candidates.find(el => {
          const t = normalizeUiText(el.innerText || el.textContent || el.getAttribute('aria-label'));
          return /^(bài viết|bài đăng|tạo bài viết|tạo bài đăng|post|new post)$/i.test(t) ||
                 (/(bài viết|bài đăng|post)/i.test(t) && !/(trực tiếp|live|thước phim|reel|tin|story)/i.test(t));
        });
        if (postSub) break;
      }

      if (!postSub) {
        const allCandidates = Array.from(document.querySelectorAll('a[role="link"], [role="menuitem"], div[role="button"], button'))
          .filter(el => {
            if (!isVisible(el)) return false;
            // Bỏ qua các tab trên profile page hoặc feed header
            if (el.closest('header, main, [role="main"]')) {
              const inDialog = el.closest('[role="dialog"], [role="menu"]');
              if (!inDialog) return false;
            }
            const t = normalizeUiText(el.innerText || el.textContent || el.getAttribute('aria-label'));
            return /^(bài viết|bài đăng|tạo bài viết|tạo bài đăng|post|new post)$/i.test(t) ||
                   (/(bài viết|bài đăng|post)/i.test(t) && !/(trực tiếp|live|thước phim|reel|tin|story)/i.test(t));
          });
        if (allCandidates.length > 0) {
          postSub = allCandidates[allCandidates.length - 1];
        }
      }
      }

      if (postSub) {
        doClick(postSub);
        addLog('✅ Đã chọn loại: Bài viết (Post)');
        await sleep(1500);
      }
    }

    // 3. NẠP FILE
    addLog('Chờ modal tạo bài và input file...');
    for (let i = 0; i < 30 && !composer; i++) {
      await dismissKnownInstagramPopup();
      composer = findComposerDialog();
      if (!composer) await sleep(500);
    }
    if (!composer) throw new Error('Instagram chưa mở modal tạo bài viết');

    // File input luôn bị ẩn (width=0), không dùng waitForElement (yêu cầu width>0)
    let fileInput = findFileInputIn(composer);
    if (!fileInput) {
      const selectFromComputer = findSelectFromComputerButton(composer);
      if (selectFromComputer) {
        doClick(selectFromComputer);
        addLog('✅ Đã bấm Chọn từ máy tính');
      }
    }
    for (let i = 0; i < 20 && !fileInput; i++) {
      composer = findComposerDialog() || composer;
      fileInput = findFileInputIn(composer);
      if (fileInput) break;
      await sleep(500);
    }
    if (!fileInput) throw new Error('Không tìm thấy input file trong modal tạo bài Instagram');

    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files); else fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    const hasVideoFile = files.some(file => file.type.startsWith('video/')) ||
      String(post.resolved_media_type || '').startsWith('video/') ||
      Boolean(post.deferred_media?.source_url);
    addLog(`📦 Đã nạp ${files.length} media, đợi Instagram xử lý${hasVideoFile ? ' video' : ''}...`);
    await sleep(hasVideoFile ? 8000 : 4000);

    // (2.7.0) Nếu IG hỏi Post/Reel ngay sau khi chọn file -> chọn Reel.
    // Cờ Done chống bấm lặp: sau khi chọn xong không hỏi lại nữa.
    let reelChoiceDone = false;
    if (hasVideoFile) {
      reelChoiceDone = await chooseReelIfAsked();
      if (reelChoiceDone) await sleep(2500);
    }

    // 4. CHỌN TỶ LỆ NGUYÊN BẢN (Original)
    const cropLabels = ['Select crop', 'Chọn tỷ lệ cắt', 'Crop', 'Tỷ lệ', 'Adjust crop', 'Chọn kích thước cắt', 'Cắt', 'Tỷ lệ khung hình'];
    let cropBtn = null;
    for (const label of cropLabels) {
      cropBtn = document.querySelector(`svg[aria-label="${label}"]`)?.closest('button') ||
                document.querySelector(`button[aria-label="${label}"]`);
      if (cropBtn) break;
    }
    // Fallback: nút nằm ở góc dưới-trái của preview, thường là nút đầu tiên trong toolbar
    if (!cropBtn) {
      const toolbarBtns = document.querySelectorAll('div[role="dialog"] button, div[class*="Carousel"] button');
      cropBtn = Array.from(toolbarBtns).find(b => {
        const svg = b.querySelector('svg');
        return svg && (b.getAttribute('aria-label') || '').match(/crop|tỷ lệ/i);
      });
    }

    if (cropBtn) {
      doClick(cropBtn);
      addLog('📐 Mở chọn tỷ lệ...');
      await sleep(2000);

      // Tìm nút Original — thử text, aria-label, và title
      let originalBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).find(b => {
        if (!isVisible(b)) return false;
        const text = normalizeUiText(b.getAttribute('aria-label') || b.innerText || b.textContent || b.title);
        return /^(original|nguyên bản|gốc|tỷ lệ gốc|ảnh gốc)$/i.test(text) || /(nguyên bản|original)/i.test(text);
      });
      if (originalBtn) {
        doClick(originalBtn);
        addLog('✅ Đã chọn tỷ lệ Nguyên bản');
        await sleep(1500);
      } else {
        addLog('⚠️ Không tìm thấy nút Original, bỏ qua chọn tỷ lệ');
      }
    } else {
      addLog('⚠️ Không tìm thấy nút crop, bỏ qua bước này');
    }

    await sleep(3000); // Để IG xử lý

    // 5. NEXT → NEXT → SHARE (Tiếp → Tiếp → Chia sẻ)
    let clicks = 0;
    let posted = false;
    let captionFilled = false;
    const maxClicks = 10;
    // (2.9.0) Heal cho nút Share: thử tối đa 1 lần trong cả vòng lặp.
    let shareHealTried = false;
    let shareHealFound = null;
    let shareHealEl = null;

    while (clicks < maxClicks && !posted) {
      // (2.7.0) Câu hỏi Post/Reel cũng có thể chỉ hiện ở bước sau của
      // editor — kiểm tra 1 lần cho tới khi đã chọn được Reel.
      if (hasVideoFile && !reelChoiceDone) {
        const chose = await chooseReelIfAsked();
        if (chose) {
          reelChoiceDone = true;
          await sleep(2500);
          continue;
        }
      }
      // Scope tìm kiếm trong modal dialog tạo bài
      const dialog = findComposerDialog();
      const searchRoot = dialog || document;

      // Kiểm tra xem hiện tại đã đến bước cuối (có ô nhập caption)
      const captionBox = searchRoot.querySelector(
        'div[aria-label*="caption" i], div[aria-label*="chú thích" i], div[aria-label*="nội dung" i], div[contenteditable="true"]'
      );

      // Nếu đã có ô caption nhưng chưa nạp nội dung
      if (captionBox && !captionFilled) {
        addLog('✍️ Đã tới bước nhập nội dung, nạp caption...');
        captionBox.click();
        await sleep(800);
        captionBox.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, effectiveCaption);
        captionBox.dispatchEvent(new Event('input', { bubbles: true }));
        captionBox.dispatchEvent(new Event('change', { bubbles: true }));
        captionFilled = true;
        addLog('✅ Nạp caption xong, chờ 3s trước khi chia sẻ...');
        await sleep(3000);
      }

      const isAtShareStage = Boolean(captionBox) && captionFilled;

      // Tìm các ứng viên nút điều hướng TRONG MODAL DIALOG
      const buttonCandidates = Array.from(searchRoot.querySelectorAll('button, div[role="button"]'))
        .filter(b => isVisible(b) && b.getAttribute('aria-disabled') !== 'true' && !b.disabled);

      let targetBtn = null;

      if (!isAtShareStage) {
        // Giai đoạn Crop hoặc Edit: BẮT BUỘC chỉ tìm nút Next / Tiếp (tuyệt đối không bấm Share)
        targetBtn = buttonCandidates.find(b => {
          const text = normalizeUiText(b.innerText || b.textContent);
          return /^(next|tiếp|tiếp theo|kế tiếp)$/i.test(text);
        });
      } else {
        // Giai đoạn cuối (đã nạp caption): Tìm nút Share / Chia sẻ / Đăng
        targetBtn = buttonCandidates.find(b => {
          const text = normalizeUiText(b.innerText || b.textContent);
          return /^(share|chia sẻ|đăng)$/i.test(text);
        });
        // Fallback nếu nút vẫn ghi Next
        if (!targetBtn) {
          targetBtn = buttonCandidates.find(b => {
            const text = normalizeUiText(b.innerText || b.textContent);
            return /^(next|tiếp|tiếp theo|kế tiếp)$/i.test(text);
          });
        }
      }

      // (2.9.0) Ở giai đoạn Share mà finder gốc không thấy nút ->
      // tự chữa 1 lần qua AVJP.heal (key ig.post.shareBtn), tìm
      // trong dialog composer. Phần tử heal trả về được tin là nút
      // Share dù nhãn text khác khuôn regex cũ.
      if (!targetBtn && isAtShareStage && !shareHealTried && window.AVJP?.heal) {
        shareHealTried = true;
        addLog('🩺 Không thấy nút Share — thử tự chữa selector (heal)...');
        shareHealFound = await window.AVJP.heal.locate({
          platform: 'instagram', key: 'ig.post.shareBtn',
          intent: 'Nút Share / Chia sẻ ở bước cuối (bước nhập chú thích) của trình tạo bài viết Instagram, bấm để đăng bài/reel lên trang cá nhân',
          builtins: [
            { by: 'text', value: 'Share' },
            { by: 'text', value: 'Chia sẻ' },
            { by: 'text', value: 'Đăng' }
          ],
          root: dialog || null,
          timeoutMs: 25000
        }).catch(() => null);
        if (shareHealFound) {
          targetBtn = shareHealFound.el;
          shareHealEl = shareHealFound.el;
          addLog(`🩺 Heal: thấy nút Share qua đường ${shareHealFound.via}`);
        }
      }

      if (!targetBtn) {
        addLog(`Đang đợi chuyển bước (lần ${clicks + 1}/${maxClicks})...`);
        await sleep(hasVideoFile ? 4000 : 2500);
        clicks++;
        continue;
      }

      const btnDisplay = (targetBtn.innerText || targetBtn.textContent || '').trim();
      const btnNormalized = normalizeUiText(btnDisplay);

      addLog(`👉 Bấm "${btnDisplay || btnNormalized}"`);
      doClick(targetBtn);

      const isShareClick = isAtShareStage &&
        (/^(share|chia sẻ|đăng)$/i.test(btnNormalized) || (shareHealEl && targetBtn === shareHealEl));
      if (isShareClick) {
        if (shareHealFound && shareHealFound.via === 'ai' && targetBtn === shareHealEl) {
          healPending.push({ platform: 'instagram', key: 'ig.post.shareBtn', spec: shareHealFound.spec });
        }
        posted = true;
        break;
      }

      await sleep(hasVideoFile ? 6000 : 3500);
      clicks++;
    }

    if (!posted) throw new Error('Không hoàn tất chuỗi Next → Next → Share');

    // 6. LẤY THÔNG TIN ACTOR
    let actorUrl = null;
    let actorName = null;
    try {
      const profileLink = Array.from(document.querySelectorAll('a[href^="/"]'))
        .find(a => {
          const h = a.getAttribute('href') || '';
          return /^\/[a-zA-Z0-9._]+\/?$/.test(h) && !h.includes('explore') && !h.includes('reels') && !h.includes('direct');
        });
      if (profileLink) {
        actorUrl = 'https://www.instagram.com' + profileLink.getAttribute('href');
        actorName = profileLink.getAttribute('href').replace(/^\/|\/$/g, '');
      }
    } catch (e) { /* ignore */ }
    if (!actorUrl && earlyActor) {
      actorUrl = earlyActor.url;
      actorName = earlyActor.name;
    }
    let resultUrl = actorUrl || window.location.href;

    if (hasVideoFile) {
      addLog(`⏳ Đã bấm Chia sẻ video, chờ Instagram xác nhận hoàn tất (tối đa 10 phút)...`);
      const startedWaiting = Date.now();
      let confirmed = false;
      while (Date.now() - startedWaiting < 10 * 60 * 1000) {
        const dialog = document.querySelector('div[role="dialog"]');
        const pageText = (document.body.innerText || '').toLowerCase();
        if (/bài viết của bạn đã được chia sẻ|your post has been shared|đã chia sẻ bài viết|post shared|your reel has been shared|reel shared|thước phim của bạn đã được chia sẻ|đã chia sẻ thước phim|bài đăng của bạn đã được chia sẻ|đã chia sẻ bài đăng|bài viết đã được chia sẻ/i.test(pageText)) {
          addLog('✅ Instagram đã xác nhận Reel/Bài viết được chia sẻ.');
          confirmed = true;
          break;
        }
        if (/không thể chia sẻ|couldn't share|could not share|đã xảy ra lỗi|something went wrong/.test(pageText)) {
          throw new Error('Instagram báo không thể xử lý hoặc chia sẻ video.');
        }
        // Instagram có thể tự đóng composer sau khi upload thành công mà không hiện toast lâu.
        // Chỉ chấp nhận trạng thái này sau tối thiểu 20 giây, không đóng tab ngay sau khi bấm Share.
        if (!dialog && Date.now() - startedWaiting >= 20000) {
          confirmed = true;
          break;
        }
        await sleep(2000);
      }
      if (!confirmed) {
        addLog('⚠️ Instagram chưa hiển thị xác nhận sau thời gian chờ nhưng video đã bấm Chia sẻ. Ghi nhận hoàn tất.');
        confirmed = true;
      }

      // (2.7.0) PROOF Reels: poll fetch-parse lưới /<nick>/reels/ tối
      // đa ~60s tìm link /reel/ MỚI so với baseline trước đăng (không
      // có baseline thì nhận link đầu tiên đọc được). Không thấy ->
      // giữ resultUrl = profile như hành vi cũ + log cảnh báo rõ.
      if (actorName) {
        addLog('🔎 Kiểm chứng Reels trên lưới profile (fetch, không chuyển trang)...');
        const baseline = (earlyActor && earlyActor.name === actorName) ? baselineReelLinks : null;
        let foundReelUrl = null;
        for (let i = 0; i < 6 && !foundReelUrl; i++) {
          const links = await fetchReelLinks(actorName);
          if (links && links.size) {
            foundReelUrl = [...links].find(u => !baseline || !baseline.has(u)) || null;
          }
          if (!foundReelUrl && i < 5) await sleep(10000);
        }
        if (foundReelUrl) {
          resultUrl = foundReelUrl;
          addLog(`✅ Proof Reels: thấy reel mới ${foundReelUrl}`);
        } else {
          addLog('⚠️ Chưa đọc được link reel mới trên lưới profile — resultUrl giữ URL profile (proof yếu, cần kiểm chứng tay)');
        }
      }
    } else {
      addLog(`⏳ Giữ tab mở thêm một khoảng ngẫu nhiên (3-10s) để chống quét...`);
      await sleep(3000 + Math.floor(Math.random() * 7000));
    }

    addLog(`🏁 HOÀN TẤT! Báo server và kết thúc.`);
    // (2.9.0) Module đã tới điểm hoàn tất (proof của automator) ->
    // cho phép lưu các selector học qua AI đã dùng trong phiên.
    for (const p of healPending) {
      try { window.AVJP?.heal?.markProven(p); } catch (_) { console.debug("[Auto vjp][automator] bỏ qua lỗi:", _); }
    }
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'postCompleted',
        postId: post.id,
        resultUrl,
        actorUrl,
        actorName,
        details: aiDetails
      }, response => resolve(response));
    });
    

  } catch (error) {
    console.error('[Moigioi-IG] Error:', error);
    addLog(`❌ Lỗi: ${error.message}`);
    if (postId) chrome.runtime.sendMessage({ action: 'postFailed', postId, error: error.message, details: aiDetails });
  }
})();
}
