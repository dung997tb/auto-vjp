// TikTok reply runner. One durable checkpoint per source/run; never resubmit an
// uncertain submission after navigation or MV3 recovery.
(async () => {
  const key = 'currentCommentReplyTask_tiktok';
  const initial = await chrome.storage.local.get(key);
  const task = initial[key];
  if (!task || task.platform !== 'tiktok') return;
  const identity = `${task.id}:${task.run_id || ''}:${task.source_key || ''}`;
  if (window.mutTikTokReplyRunning === identity) return;
  window.mutTikTokReplyRunning = identity;
  window.mutTikTokReplyTaskId = task.id;
  window.mutTikTokReplyStartedAt = Date.now();
  const visible = el => Boolean(el?.isConnected && el.getClientRects().length);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const checkpoint = task.tiktok_checkpoint?.identity === identity ? task.tiktok_checkpoint : { identity, phase: 'actor_check', items: [], attempted: [] };
  const items = checkpoint.items || [];
  const attempted = new Set(checkpoint.attempted || []);
  const processed = new Set(task.processed_keys || []);
  const postId = location.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1];
  const expected = String(task.social_uid || '').replace(/^@/, '').toLowerCase();
  const inspect = () => {
    document.dispatchEvent(new Event('mut-tiktok-reply-inspect'));
    try { return JSON.parse(document.documentElement.getAttribute('data-mut-tiktok-reply-context') || '{}'); } catch { return {}; }
  };
  const guard = async () => {
    const stored = await chrome.storage.local.get([key, 'isPaused']);
    const current = stored[key];
    if (!current || `${current.id}:${current.run_id || ''}:${current.source_key || ''}` !== identity) throw new Error('Tác vụ đã bị hủy hoặc thay đổi');
    if (stored.isPaused) throw new Error('Đã tạm dừng trước thao tác tiếp theo');
    if (location.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] !== postId) throw new Error('Tab không còn ở bài TikTok cần trả lời');
  };
  const save = async (phase, extra = {}) => {
    Object.assign(checkpoint, extra, { identity, phase, items, attempted: [...attempted] });
    const response = await chrome.runtime.sendMessage({ action: 'tiktokReplyCheckpoint', campaignId: task.id, runId: task.run_id, sourceKey: task.source_key, checkpoint });
    if (!response?.success) throw new Error('Không lưu được trạng thái reply; đã dừng để tránh gửi trùng');
  };
  const wait = async (condition, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await guard();
      const result = await condition();
      if (result) return result;
      await pause(300);
    }
    return null;
  };
  const done = async error => {
    await save('finished', { error: error || '' });
    await chrome.runtime.sendMessage({ action: 'commentReplyDone', campaignId: task.id, sourceUrl: task.source_url, items, error: error || '' });
  };
  function candidates() {
    inspect();
    const seen = new Set();
    return Array.from(document.querySelectorAll('[data-mut-tiktok-comment]')).flatMap(row => {
      try {
        const comment = JSON.parse(row.getAttribute('data-mut-tiktok-comment'));
        let reply = row.querySelector('[data-e2e="comment-reply-1"], [data-e2e="comment-reply-2"], button[class*="Reply"], [class*="ReplyButton"], [data-e2e*="reply"]');
        if (!reply || !visible(reply)) {
          reply = Array.from(row.querySelectorAll('button, span, div, p')).find(el => visible(el) && /^(?:reply|trả lời)$/i.test(normalize(el.textContent)));
        }
        if (!comment.id || seen.has(comment.id)) return [];
        seen.add(comment.id);
        return [{ row, reply: reply || row, ...comment }];
      } catch { return []; }
    });
  }
  try {
    if (!postId) {
      const findFirstPost = () => {
        const selectors = [
          'a[href*="/@"][href*="/video/"]',
          'a[href*="/@"][href*="/photo/"]',
          'a[href*="/video/"]',
          'a[href*="/photo/"]',
          '[data-e2e="user-post-item"] a',
          '[data-e2e="user-post-item-list"] a'
        ];
        for (const sel of selectors) {
          const found = Array.from(document.querySelectorAll(sel)).find(el => {
            const h = el.getAttribute('href') || el.href || '';
            return visible(el) && (h.includes('/video/') || h.includes('/photo/'));
          });
          if (found) return found;
        }
        return null;
      };

      const startWait = Date.now();
      let firstPost = findFirstPost();
      while (!firstPost && Date.now() - startWait < 12000) {
        await pause(500);
        firstPost = findFirstPost();
      }

      if (!firstPost) throw new Error('TikTok: Không tìm thấy bài TikTok trong nguồn đã chọn');
      const href = firstPost.href;
      await chrome.storage.local.set({ [key]: { ...task, source_url: href, source_type: 'post_url', source_key: `${task.source_key || 'tiktok'}:${href}` } });
      location.assign(href);
      return;
    }
    if (checkpoint.phase === 'finished') {
      await chrome.runtime.sendMessage({ action: 'commentReplyDone', campaignId: task.id, sourceUrl: task.source_url, items, error: checkpoint.error || '' });
      return;
    }
    if (['submitting', 'verifying'].includes(checkpoint.phase)) {
      throw new Error('Lần gửi trước chưa xác minh được; không tự gửi lại để tránh trùng. Hãy kiểm tra comment trên TikTok.');
    }
    const actor = await wait(() => inspect().actor);
    if (!expected || !actor || actor.toLowerCase() !== expected) throw new Error(`Không xác nhận được tài khoản TikTok: yêu cầu @${expected}, hiện tại ${actor ? '@' + actor : 'chưa xác định'}`);
    const ensureCommentsTabOpen = async () => {
      if (candidates().length > 0) return true;

      const clickElement = (el) => {
        if (!el) return;
        el.scrollIntoView({ block: 'nearest' });
        const rect = el.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const eventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          screenX: clientX,
          screenY: clientY,
          pointerId: 1,
          isPrimary: true
        };

        const target = el.closest('[role="tab"], button, div[class*="TabItem"], div[class*="tab"]') || el;
        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
          try { target.dispatchEvent(new MouseEvent(evt, eventInit)); } catch (_) {}
        });
        if (typeof target.click === 'function') target.click();
      };

      // 1. Tìm tab Comments ở nửa trên bên phải màn hình (cột sidebar bên phải)
      const allEls = Array.from(document.querySelectorAll('button, [role="tab"], div, span, p, h2, h3, a'));
      const rightColumnTabs = allEls.filter(el => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.35 || rect.top > 350 || rect.width < 10 || rect.height < 10) return false;
        const fullText = normalize(el.textContent).toLowerCase();
        return (
          fullText === 'comments' ||
          fullText === 'bình luận' ||
          /^comments?\s*\(\d+\)$/i.test(fullText) ||
          /^bình luận\s*\(\d+\)$/i.test(fullText) ||
          (fullText.includes('comment') && !fullText.includes('you may like') && fullText.length < 25)
        );
      });

      rightColumnTabs.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        return (rA.width * rA.height) - (rB.width * rB.height);
      });

      for (const tabEl of rightColumnTabs) {
        clickElement(tabEl);
        await pause(600);
        if (candidates().length > 0) return true;
      }

      // 2. Thử click nút icon comment ở thanh công cụ bên hông nếu danh sách comment chưa mở
      const commentActionButtons = Array.from(document.querySelectorAll(
        '[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"], button[aria-label*="comment" i], button[aria-label*="bình luận" i], [data-e2e="video-comment-icon"], [class*="CommentIcon"], [class*="comment-icon"]'
      )).filter(visible);

      for (const btn of commentActionButtons) {
        clickElement(btn);
        await pause(600);
        if (candidates().length > 0) return true;
      }
      return false;
    };

    await save('acting');
    await ensureCommentsTabOpen();
    await wait(async () => {
      const list = candidates();
      if (list.length) return list;
      await ensureCommentsTabOpen();
      return null;
    }, 20000);
    let completed = items.filter(item => item.status === 'success').length;
    const limit = Math.max(1, Math.min(20, Number(task.reply_limit) || 1));
    for (let scan = 0; scan < 8 && completed < limit; scan++) {
      await ensureCommentsTabOpen();
      const rows = candidates();
      for (const comment of rows) {
        const parentKey = `tiktok:${postId}:${comment.id}:reply`;
        if (attempted.has(parentKey) || (task.prevent_duplicates && processed.has(parentKey)) || comment.author.toLowerCase() === expected) continue;
        await guard();
        if (inspect().actor?.toLowerCase() !== expected) throw new Error('Tài khoản TikTok đã thay đổi; dừng trả lời');
        let content = '';
        if (task.smart_reply_enabled) {
          const suggestion = await chrome.runtime.sendMessage({ action: 'getSmartCommentReply', campaignId: task.id, commentText: comment.text, commentAuthor: comment.author });
          content = suggestion?.data?.reply_text || '';
        }
        const templates = (task.reply_templates || []).filter(text => normalize(text));
        content = normalize(content || templates[completed % templates.length] || (task.reply_icons || [])[0]);
        if (!content) throw new Error('Chưa có nội dung trả lời; hãy chọn mẫu hoặc bật phản hồi thông minh');
        if (typeof comment.reply.scrollIntoView === 'function') comment.reply.scrollIntoView({ block: 'center' });
        if (typeof comment.reply.click === 'function') comment.reply.click();
        await pause(600);

        const authorClean = String(comment.author || '').replace(/^@/, '').toLowerCase();
        const nameClean = String(comment.displayName || '').toLowerCase();
        const matchesAuthor = text => {
          const t = normalize(text).toLowerCase();
          return (authorClean && t.includes(authorClean)) || (nameClean && t.includes(nameClean)) || t.includes('reply') || t.includes('trả lời');
        };

        // Tìm kiếm indicator nếu có (không throw blocker nếu TikTok thay đổi cấu trúc tag)
        await wait(() => Array.from(document.querySelectorAll(
          '[data-e2e="comment-input"] [class*="Reply"], [data-e2e="comment-input"] [data-e2e*="reply"], [class*="DivReplyContainer"], [class*="ReplyContainer"], [class*="ReplyingTo"]'
        )).find(el => visible(el) && matchesAuthor(el.textContent)), 1000).catch(() => null);

        const isEditable = el => {
          if (!el || el === comment.reply) return false;
          if (el.isContentEditable) return true;
          const ce = el.getAttribute?.('contenteditable');
          if (ce === 'true' || ce === '') return true;
          if (el.getAttribute?.('role') === 'textbox') return true;
          return !el.click || (typeof el.focus === 'function' && !el.getAttribute?.('data-mut-tiktok-comment'));
        };

        const findEditor = () => {
          // 1. Kiểm tra phần tử đang active (TikTok tự động focus vào inline editor sau khi bấm Reply)
          if (isEditable(document.activeElement) && visible(document.activeElement)) {
            return document.activeElement;
          }

          // 2. Tìm trong comment.row hoặc container lân cận của comment đó
          if (comment.row) {
            let ed = comment.row.querySelector?.('[contenteditable="true"]');
            if (isEditable(ed) && visible(ed)) return ed;

            let sibling = comment.row.nextElementSibling;
            while (sibling && !sibling.hasAttribute?.('data-mut-tiktok-comment') && !sibling.querySelector?.('[data-mut-tiktok-comment]')) {
              ed = sibling.querySelector?.('[contenteditable="true"]') || (isEditable(sibling) ? sibling : null);
              if (isEditable(ed) && visible(ed)) return ed;
              sibling = sibling.nextElementSibling;
            }

            const parentList = comment.row.closest?.('[class*="CommentList"], [class*="CommentItem"], [data-e2e*="comment"]') || comment.row.parentElement;
            if (parentList) {
              const inList = Array.from(parentList.querySelectorAll?.('[contenteditable="true"]') || []).filter(visible);
              const notBottom = inList.find(el => isEditable(el) && !el.closest?.('[data-e2e="comment-input"]'));
              if (notBottom) return notBottom;
            }
          }

          // 3. Tìm tất cả contenteditable đang hiển thị
          const allEditors = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(el => isEditable(el) && visible(el));

          // Ưu tiên editor có placeholder hoặc label chứa reply / trả lời
          const replySpecific = allEditors.find(el => {
            const ph = (el.getAttribute?.('placeholder') || el.getAttribute?.('data-placeholder') || el.getAttribute?.('aria-placeholder') || el.parentElement?.textContent || '').toLowerCase();
            return ph.includes('reply') || ph.includes('trả lời');
          });
          if (replySpecific) return replySpecific;

          // Ưu tiên editor không phải là ô bottom input nếu có nhiều hơn 1 editor
          const inlineCandidate = allEditors.find(el => !el.closest?.('[data-e2e="comment-input"]'));
          if (inlineCandidate) return inlineCandidate;

          // 4. Fallback về bottom input hoặc editor đầu tiên
          const bottomEditor = document.querySelector('[data-e2e="comment-input"] [contenteditable="true"], [data-e2e="comment-input"][contenteditable="true"]');
          if (isEditable(bottomEditor) && visible(bottomEditor)) return bottomEditor;

          return allEditors[0] || null;
        };

        const findSubmitButton = currentEditor => {
          if (!currentEditor) return null;

          // 1. Tìm nút submit trong container chứa currentEditor (ưu tiên nút inline trong container)
          let container = currentEditor.parentElement;
          for (let i = 0; i < 4 && container && container !== document.body; i++) {
            const candidates = Array.from(container.querySelectorAll?.('button, [role="button"], div[tabindex="0"]') || []).filter(visible);
            const submitBtn = candidates.find(b => {
              if (b.disabled || b.getAttribute?.('aria-disabled') === 'true') return false;
              const aria = (b.getAttribute?.('aria-label') || '').toLowerCase();
              const title = (b.getAttribute?.('title') || '').toLowerCase();
              const cls = (b.className || '').toLowerCase();
              if (aria.includes('close') || aria.includes('cancel') || aria.includes('đóng') || aria.includes('hủy') ||
                  aria.includes('emoji') || aria.includes('biểu tượng') ||
                  aria.includes('mention') || aria.includes('nhắc') ||
                  title.includes('close') || title.includes('emoji') || cls.includes('close')) {
                return false;
              }
              if (b.getAttribute?.('data-e2e') === 'comment-post') return true;
              if (b.querySelector?.('svg')) return true;
              const text = (b.textContent || '').trim().toLowerCase();
              return text === 'post' || text === 'đăng' || text === 'gửi';
            });
            if (submitBtn) return submitBtn;
            container = container.parentElement;
          }

          // 2. Selector chuẩn toàn cục: [data-e2e="comment-post"]
          const standardPost = Array.from(document.querySelectorAll('[data-e2e="comment-post"]')).find(el => visible(el) && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true');
          if (standardPost) return standardPost;

          // 3. Fallback nút Post / Submit
          return Array.from(document.querySelectorAll('button[class*="Post"], button[class*="Submit"], [class*="PostButton"]')).find(el => visible(el) && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true') || null;
        };

        let editor = await wait(() => findEditor(), 4000);
        if (!editor) throw new Error('Không tìm thấy ô nhập trả lời TikTok');
        await save('composing');
        if (typeof editor.focus === 'function') editor.focus();
        await pause(150);

        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        } catch (_) {}

        try {
          editor.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: content
          }));
        } catch (_) {}

        try {
          document.execCommand('insertText', false, content);
        } catch (_) {}

        if (typeof editor.dispatchEvent === 'function') {
          try {
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }));
          } catch (_) {
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        if (normalize(editor.textContent) !== content) {
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', content);
            editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          } catch (_) {}
        }

        if (normalize(editor.textContent) !== content) {
          let leaf = editor;
          while (leaf.firstElementChild) leaf = leaf.firstElementChild;
          if (leaf && leaf !== editor) {
            leaf.textContent = content;
          } else {
            editor.textContent = content;
          }
          try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
        }

        if (normalize(editor.textContent) !== content) throw new Error('Nội dung thực tế trong ô trả lời không khớp mẫu');
        let button = await wait(() => findSubmitButton(editor), 4000);
        if (!button) throw new Error('Nút gửi trả lời chưa sẵn sàng');
        await guard();
        const priorConfirmations = new Set((inspect().confirmations || []).map(result => result.id));
        attempted.add(parentKey);
        await save('submitting');
        // Exactly one submit. Success requires TikTok's publish response for this
        // parent, video, text and actor, not an emptied editor or elapsed time.
        button.click();
        await save('verifying');
        const confirmation = await wait(() => inspect().confirmations?.find(result => !priorConfirmations.has(result.id) && result.parent === comment.id && result.post === postId && normalize(result.text) === content && result.author.toLowerCase() === expected), 20000);
        if (!confirmation) throw new Error('TikTok chưa xác nhận gửi thành công; không tự gửi lại để tránh trùng');
        items.push({ parent_comment_key: parentKey, parent_author: comment.author, parent_comment_text: comment.text, action_type: 'reply_comment', action_content: content, target_url: task.source_url, reply_id: confirmation.id, status: 'success', progress_credit: 1 });
        completed++;
        await save('acting');
        await chrome.runtime.sendMessage({ action: 'commentReplyProgress', campaignId: task.id, current: (Number(task.progress_offset) || 0) + completed, total: task.campaign_total, message: `TikTok: đã xác nhận ${completed}/${limit} phản hồi` });
        if (completed >= limit) break;
        const min = Math.max(10, Number(task.delay_min_seconds) || 30);
        const max = Math.max(min, Number(task.delay_max_seconds) || min);
        const end = Date.now() + (min + Math.random() * (max - min)) * 1000;
        let lastHeartbeat = Date.now();
        while (Date.now() < end) {
          await guard();
          if (Date.now() - lastHeartbeat >= 30000) { await save('acting'); lastHeartbeat = Date.now(); }
          await pause(Math.min(1000, end - Date.now()));
        }
      }
      if (completed >= limit) break;
      const last = rows.at(-1)?.row;
      if (!last) break;
      last.scrollIntoView({ block: 'start' });
      await pause(800);
    }
    await done(items.length ? '' : 'Không tìm thấy comment mới có định danh và nút Reply; có thể đã trả lời hết hoặc giao diện TikTok chưa được hỗ trợ');
  } catch (error) {
    console.error('[MUT TikTok reply]', error);
    try { await done('TikTok: ' + (error.message || String(error))); } catch (reportError) { console.error('[MUT TikTok reply] Chưa báo được kết quả', reportError); }
  } finally {
    if (window.mutTikTokReplyRunning === identity) window.mutTikTokReplyRunning = '';
  }
})();
