// Gắn link affiliate vào bài trên Instagram cá nhân.
if (!window.mutIgAffiliateCommenterInjected) {
  window.mutIgAffiliateCommenterInjected = true;
  (async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const stored = await chrome.storage.local.get('currentAffiliateCommentTask_instagram');
    const task = stored.currentAffiliateCommentTask_instagram;
    if (!task || task.platform !== 'instagram') {
      window.mutIgAffiliateCommenterInjected = false;
      return;
    }

    const taskId = String(task.id || 'unknown');
    window.mutIgAffiliateCommenterTaskId = taskId;
    window.mutIgAffiliateCommenterStartedAt = Date.now();
    const log = (message, step = 'acting', level = 'INFO', details = null) => chrome.runtime.sendMessage({
      action: 'automationLog', event: { level, platform: 'instagram', job: 'Gắn link', campaign: task.name || '', taskId: task.id, step, message, details }
    });

    const progress = (current, total, message) => chrome.runtime.sendMessage({
      action: 'affiliateCommentProgress', campaignId: task.id,
      current, total, message
    });
    
    const finish = (items, error = '') => chrome.runtime.sendMessage({
      action: 'affiliateCommentDone', campaignId: task.id, items, error,
      sourceGroupUrl: task.source_key || task.source_url || location.href,
      sourceKey: task.source_key || ''
    });

    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = element => Boolean(element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
    
    const click = element => {
      if (!element) return false;
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      element.click();
      return true;
    };

    const setText = (element, text) => {
      element.focus();
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
        if (setter) setter.call(element, text); else element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    };

    const pressEnter = element => {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        element.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    };

    const submitEditor = async element => {
      pressEnter(element);
      await sleep(700);
      const scope = element.closest('form, article, div[role="dialog"]') || document;
      const submitBtn = Array.from(scope.querySelectorAll('button, [role="button"]'))
        .find(button => visible(button) && [/^post$/i, /^đăng$/i, /^send$/i, /^gửi$/i].some(pattern => pattern.test(normalize(`${button?.getAttribute?.('aria-label') || ''} ${button?.textContent || ''}`).toLowerCase())));
      if (submitBtn && !submitBtn.disabled) click(submitBtn);
      await sleep(900);
    };

    const findMainCommentBox = () => Array.from(document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]'))
      .find(element => visible(element) && /add a comment|thêm bình luận|bình luận/i.test(element.getAttribute('aria-label') || element.getAttribute('placeholder') || ''));

    const waitFor = async (finder, timeout = 10000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const found = finder();
        if (found) return found;
        await sleep(300);
      }
      return null;
    };

    const postKey = () => location.pathname.match(/\/(?:p|reel)\/([^/]+)/i)?.[1] || location.href;

    const closePostDialog = async () => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return;
      const closeButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(element => {
        if (!visible(element)) return false;
        const label = normalize(`${element.getAttribute?.('aria-label') || ''} ${element.textContent || ''}`).toLowerCase();
        return /^(close|đóng)$/.test(label) || /close|đóng/.test(label);
      });
      if (closeButton) click(closeButton);
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await sleep(1200);
    };

    try {
      log('Đã nhận nhiệm vụ, đang tải trang Instagram', 'received');
      progress(0, 1, 'Đang chờ Instagram tải...');
      await sleep(3500 + Math.floor(Math.random() * 1500));
      
      const limit = Math.max(1, Math.min(5, Number(task.post_limit) || 1));
      const isDirectPost = /\/(p|reel)\//i.test(location.pathname);
      const candidateUrls = isDirectPost
        ? [location.href]
        : Array.from(new Set(Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))
            .filter(visible).map(element => element.href))).slice(0, limit);
      if (!candidateUrls.length) {
        finish([], 'Không tìm thấy bài Instagram mới nhất');
        return;
      }

      progress(0, limit, 'Đang chuẩn bị nội dung bình luận...');
      const links = Array.isArray(task.affiliate_links) ? task.affiliate_links.filter(Boolean) : [];
      const richTemplates = Array.isArray(task.rich_comment_templates) ? task.rich_comment_templates.filter(item => item?.text) : [];
      const textTemplates = Array.isArray(task.comment_templates) ? task.comment_templates.filter(Boolean) : [];
      if (!links.length && !richTemplates.length && !textTemplates.length) {
        finish([], 'Chiến dịch không còn link affiliate hợp lệ và cũng không có mẫu bình luận.');
        return;
      }
      const placeholder = /\{\{\s*(?:affiliate_link|link)\s*\}\}|\{\s*(?:affiliate_link|link)\s*\}/gi;
      const results = [];
      for (let index = 0; index < candidateUrls.length && results.length < limit; index++) {
        const foundPostUrl = candidateUrls[index];
        if (!isDirectPost) {
          progress(results.length, limit, `Đang mở bài mới nhất ${index + 1}/${limit} trên Instagram...`);
          const targetPost = Array.from(document.querySelectorAll('a[href]')).find(element => element.href === foundPostUrl);
          if (!targetPost) continue;
          click(targetPost);
          const dialog = await waitFor(() => document.querySelector('div[role="dialog"]'), 10000);
          if (!dialog) continue;
          await sleep(1200);
        }
        const affiliateLink = links.length
          ? (task.link_distribution === 'round_robin' ? links[index % links.length] : links[Math.floor(Math.random() * links.length)])
          : '';
        const selectedTemplate = richTemplates.length
          ? richTemplates[Math.floor(Math.random() * richTemplates.length)]
          : { text: textTemplates.length ? textTemplates[Math.floor(Math.random() * textTemplates.length)] : '{affiliate_link}' };
        const templateText = String(selectedTemplate.text || '');
        const hasPlaceholder = placeholder.test(templateText);
        placeholder.lastIndex = 0;
        const commentText = affiliateLink
          ? (hasPlaceholder ? templateText.replace(placeholder, affiliateLink) : `${templateText}${templateText ? '\n' : ''}${affiliateLink}`)
          : templateText.replace(placeholder, '').trim();
        if (!commentText) continue;

        progress(results.length, limit, `Đang bình luận bài ${index + 1}/${limit}...`);
        const box = await waitFor(findMainCommentBox, 5000);
        if (!box) {
          if (!isDirectPost) await closePostDialog();
          continue;
        }
        setText(box, commentText);
        await sleep(700 + Math.floor(Math.random() * 1000));
        await submitEditor(box);
        await sleep(3000);
        const remaining = normalize(box.value || box.textContent || '');
        if (!remaining.includes(normalize(commentText))) {
          results.push({
            facebook_post_url: foundPostUrl,
            affiliate_link: affiliateLink,
            comment_text: commentText,
            status: 'success'
          });
          progress(results.length, limit, `Instagram đã bình luận thành công ${results.length}/${limit}`);
          log(`Instagram đã xác nhận bình luận thành công bài ${results.length}/${limit}`, 'confirmed');
        }
        if (!isDirectPost) await closePostDialog();
        if (results.length < limit && index < candidateUrls.length - 1) {
          const waitMs = Math.max(1000, Number(task.delay_min_seconds || 2) * 1000)
            + Math.random() * Math.max(0, (Number(task.delay_max_seconds || 7) - Number(task.delay_min_seconds || 2)) * 1000);
          progress(results.length, limit, `Đang chờ ${Math.round(waitMs / 1000)} giây trước bài tiếp theo`);
          await sleep(waitMs);
        }
      }
      finish(results, results.length ? '' : 'Không tìm thấy hoặc không bình luận được bài Instagram nào');
    } catch (error) {
      console.error('[MUT IG Affiliate Comment]', error);
      log(error?.message || 'Lỗi không xác định trong quá trình tự động', 'failed', 'ERROR');
      finish([], error?.message || 'Lỗi không xác định trong quá trình tự động');
    }
  })();
}
