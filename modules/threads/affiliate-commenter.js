// Gắn link affiliate vào các bài mới nhất trên Threads.
if (!window.mutThreadsAffiliateCommenterInjected) {
window.mutThreadsAffiliateCommenterInjected = true;

(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => Boolean(element && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
  const random = values => values[Math.floor(Math.random() * values.length)];
  const click = element => {
    if (!element) return false;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.click();
    return true;
  };
  const label = element => normalize(`${element?.getAttribute?.('aria-label') || ''} ${element?.textContent || ''}`).toLowerCase();

  const setText = async (element, text) => {
    // 1. Kích hoạt ô nhập bằng click + focus
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.click();
    element.focus();
    await sleep(250);

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      if (setter) setter.call(element, text); else element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // 2. Phương pháp 1: Dùng ClipboardEvent paste (tương thích Lexical editor trên Threads)
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        element.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        }));
      } catch (_) { console.debug("[Auto vjp][affiliate-commenter] bỏ qua lỗi:", _); }

      await sleep(200);

      // 3. Phương pháp 2: Fallback nếu phương pháp 1 chưa vào text
      if (!editorText(element).includes(normalize(text).slice(0, 10))) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
    await sleep(300);
  };

  const editorText = element => normalize(element?.value || element?.innerText || element?.textContent || '');

  const allEditors = () => Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
    .filter(element => visible(element) && !element.closest('[aria-hidden="true"]'));

  const findCommentBox = () => {
    const editors = allEditors();
    // 1. Tìm editor có aria-label, placeholder hoặc text gợi ý xung quanh
    const matched = editors.find(element => {
      const aria = (element.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
      const parentText = (element.parentElement?.innerText || '').toLowerCase();
      return /reply|trả lời|bình luận|comment|compose|type to compose|soạn/i.test(aria) ||
             /reply|trả lời|bình luận|comment/i.test(placeholder) ||
             /reply to|trả lời/i.test(parentText);
    });
    if (matched) return matched;

    // 2. Nếu đang ở trang chi tiết bài viết (URL chứa /post/), editor nhìn thấy chính là ô bình luận
    if (/\/@[^/]+\/post\//i.test(location.pathname) && editors.length > 0) {
      return editors[0];
    }

    return editors.find(element => element.closest('main, article, div[role="dialog"]')) || editors[0] || null;
  };

  const waitFor = async (finder, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = finder();
      if (found) return found;
      await sleep(300);
    }
    return null;
  };

  const findReplyButton = (scope = document) => {
    const allBtns = Array.from(scope.querySelectorAll('button, [role="button"]')).filter(visible);
    return allBtns.find(b => {
      const svg = b.querySelector('svg');
      const title = (svg?.querySelector('title')?.textContent || svg?.getAttribute('aria-label') || '').toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.innerText || '').trim().toLowerCase();
      return /reply|trả lời|comment|bình luận/i.test(title) ||
             /reply|trả lời|comment|bình luận/i.test(aria) ||
             /^(reply|trả lời)\d*$/i.test(text);
    }) || null;
  };

  const submitEditor = async element => {
    const boxRect = element.getBoundingClientRect();
    let submit = null;

    // 1. Tìm nút gửi cùng khung/hàng ngang với composer
    let p = element.parentElement;
    while (p && p !== document.body) {
      const candidates = Array.from(p.querySelectorAll('button, [role="button"]')).filter(visible);
      submit = candidates.find(b => {
        const r = b.getBoundingClientRect();
        const svg = b.querySelector('svg');
        const title = (svg?.querySelector('title')?.textContent || svg?.getAttribute('aria-label') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.innerText || '').trim().toLowerCase();
        const isMatch = /^(reply|post|trả lời|đăng|send|gửi)$/i.test(title) ||
                        /^(reply|post|trả lời|đăng|send|gửi)$/i.test(aria) ||
                        /^(reply|post|trả lời|đăng|send|gửi)$/i.test(text);
        const isNotOther = aria !== 'expand composer' && aria !== 'attach media';
        const isPositionValid = r.top >= boxRect.top - 20 && r.left > boxRect.left;
        return isMatch && isNotOther && isPositionValid;
      });
      if (submit) break;
      p = p.parentElement;
    }

    // 2. Fallback tìm nút Submit trên toàn phạm vi
    if (!submit) {
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
      submit = allButtons.find(b => {
        const r = b.getBoundingClientRect();
        const svg = b.querySelector('svg');
        const title = (svg?.querySelector('title')?.textContent || svg?.getAttribute('aria-label') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.innerText || '').trim().toLowerCase();
        return (/^(post|đăng|send|gửi)$/i.test(text) || title === 'reply') &&
               aria !== 'expand composer' && aria !== 'attach media' &&
               r.top >= boxRect.top - 20;
      });
    }

    if (submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true') {
      click(submit);
    } else {
      for (const type of ['keydown', 'keypress', 'keyup']) {
        element.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    }
    await sleep(1500);
  };

  const verifySubmitted = async (box, commentText, maxWaitMs = 5000) => {
    const started = Date.now();
    const norm = normalize(commentText);
    const snippet = norm.slice(0, 25);
    while (Date.now() - started < maxWaitMs) {
      await sleep(400);
      if (!editorText(box).includes(snippet) && editorText(box).length === 0) return true;
      if (document.body.innerText.includes(snippet)) return true;
      if (!box.isConnected) return true;
    }
    return !editorText(box).includes(norm);
  };

  const findVisiblePostLinks = () => Array.from(
    document.querySelectorAll('a[href*="/post/"], div[data-pressable-container="true"] a[href*="/post/"], [role="article"] a[href*="/post/"], article a[href*="/post/"]')
  ).filter(visible);

  const waitForPostLinks = async (timeout = 15000) => {
    const started = Date.now();
    let lastScroll = 0;
    while (Date.now() - started < timeout) {
      const links = findVisiblePostLinks();
      if (links.length) return links;
      if (Date.now() - started >= 2500 && Date.now() - lastScroll >= 2500) {
        window.scrollBy({ top: Math.max(350, Math.floor(window.innerHeight * 0.5)), behavior: 'smooth' });
        lastScroll = Date.now();
      }
      await sleep(350);
    }
    return [];
  };

  const closePost = async () => {
    const close = document.querySelector('svg[aria-label="Close"], svg[aria-label="Đóng"]')?.closest('button, [role="button"]')
      || Array.from(document.querySelectorAll('button, [role="button"]')).find(element => visible(element) && /^(close|đóng)$/i.test(label(element)));
    if (close) click(close); else history.back();
    await sleep(1200);
  };

  const fitTextToLimit = (text, maxLength = 490, link = '') => {
    if (!text || text.length <= maxLength) return text;
    if (link && text.includes(link)) {
      const linkLen = link.length;
      const reserved = linkLen + 5;
      const maxProse = maxLength - reserved;
      if (maxProse > 20) {
        const parts = text.split(link);
        const prefix = parts[0].trim();
        if (prefix.length > maxProse) {
          let trimmed = prefix.slice(0, maxProse);
          const lastSpace = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\n'), trimmed.lastIndexOf(','), trimmed.lastIndexOf('.'));
          if (lastSpace > maxProse * 0.6) trimmed = trimmed.slice(0, lastSpace);
          return `${trimmed.trim()}...\n${link}`.trim();
        }
      }
    }
    let trimmed = text.slice(0, maxLength - 3);
    const lastSpace = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\n'));
    if (lastSpace > (maxLength - 3) * 0.6) trimmed = trimmed.slice(0, lastSpace);
    return `${trimmed.trim()}...`;
  };

  const stored = await chrome.storage.local.get('currentAffiliateCommentTask_threads');
  const task = stored.currentAffiliateCommentTask_threads;
  if (!task || task.platform !== 'threads') {
    window.mutThreadsAffiliateCommenterInjected = false;
    return;
  }
  window.mutThreadsAffiliateCommenterTaskId = task.id;
  window.mutThreadsAffiliateCommenterStartedAt = Date.now();
  const limit = Math.max(1, Math.min(5, Number(task.post_limit) || 1));
  const progress = (current, message) => chrome.runtime.sendMessage({
    action: 'affiliateCommentProgress', campaignId: task.id, current, total: limit, message
  });
  const log = (message, step = 'acting', level = 'INFO', details = null) => chrome.runtime.sendMessage({
    action: 'automationLog', event: { level, platform: 'threads', job: 'Gắn link', campaign: task.name || '', taskId: task.id, step, message, details }
  });
  const finish = (items, error = '') => chrome.runtime.sendMessage({
    action: 'affiliateCommentDone', campaignId: task.id, items, error,
    sourceGroupUrl: task.source_key || task.source_url || location.href,
    sourceKey: task.source_key || ''
  });

  const results = [];
  try {
    log('Đã nhận nhiệm vụ, đang tải trang Threads', 'received');
    progress(0, 'Đang chờ Threads tải...');
    const isDirectPost = /\/@[^/]+\/post\//i.test(location.pathname);
    const postLinks = isDirectPost ? [] : await waitForPostLinks(15000);
    const candidateUrls = isDirectPost ? [location.href] : Array.from(new Set(
      postLinks.map(link => link.href)
    )).slice(0, limit);
    if (!candidateUrls.length) throw new Error('Không tìm thấy bài Threads mới nhất');

    const links = Array.isArray(task.affiliate_links) ? task.affiliate_links.filter(Boolean) : [];
    const richTemplates = Array.isArray(task.rich_comment_templates) ? task.rich_comment_templates.filter(item => item?.text) : [];
    const textTemplates = Array.isArray(task.comment_templates) ? task.comment_templates.filter(Boolean) : [];
    if (!links.length && !richTemplates.length && !textTemplates.length) throw new Error('Không còn link hoặc mẫu bình luận hợp lệ');
    const placeholder = /\{\{\s*(?:affiliate_link|link)\s*\}\}|\{\s*(?:affiliate_link|link)\s*\}/gi;

    for (let index = 0; index < candidateUrls.length && results.length < limit; index++) {
      const postUrl = candidateUrls[index];
      if (!isDirectPost) {
        progress(results.length, `Đang mở bài Threads ${index + 1}/${limit}`);
        const target = Array.from(document.querySelectorAll('a[href]')).find(element => element.href === postUrl);
        if (!target) continue;
        click(target);
        const opened = await waitFor(() => /\/@[^/]+\/post\//i.test(location.pathname) || document.querySelector('div[role="dialog"]'), 7000);
        if (!opened) continue;
        await sleep(1000);
      }

      // Kích hoạt ô trả lời: bấm nút Reply nếu có
      const replyButton = findReplyButton();
      if (replyButton) {
        click(replyButton);
        await sleep(700);
      }

      log(`Đang tìm ô nhập bình luận bài ${index + 1}/${limit}...`, 'finding_box');
      const box = await waitFor(findCommentBox, 6000);
      if (!box) {
        log(`Không tìm thấy ô nhập bình luận cho bài ${index + 1}`, 'box_not_found', 'WARN');
        if (!isDirectPost) await closePost();
        continue;
      }

      const affiliateLink = links.length
        ? (task.link_distribution === 'round_robin' ? links[index % links.length] : random(links)) : '';
      const selected = richTemplates.length ? random(richTemplates)
        : { text: textTemplates.length ? random(textTemplates) : '{link}' };
      const template = String(selected.text || '');
      const hasPlaceholder = placeholder.test(template); placeholder.lastIndex = 0;
      const rawCommentText = affiliateLink
        ? (hasPlaceholder ? template.replace(placeholder, affiliateLink) : `${template}${template ? '\n' : ''}${affiliateLink}`)
        : template.replace(placeholder, '').trim();
      if (!rawCommentText) continue;

      const commentText = fitTextToLimit(rawCommentText, 490, affiliateLink);
      if (commentText.length < rawCommentText.length) {
        log(`Đã tự động rút gọn bình luận bài ${index + 1} (${rawCommentText.length} ➜ ${commentText.length} ký tự) để vừa giới hạn 500 ký tự của Threads`, 'trimmed_content');
      }

      progress(results.length, `Đang bình luận bài Threads ${index + 1}/${limit}`);
      log(`Đang điền nội dung vào ô bình luận bài ${index + 1}...`, 'filling_text');
      await setText(box, commentText);
      await sleep(600 + Math.floor(Math.random() * 500));

      log(`Đang bấm gửi bình luận bài ${index + 1}...`, 'submitting');
      await submitEditor(box);

      const success = await verifySubmitted(box, commentText, 5000);
      if (success) {
        results.push({ facebook_post_url: postUrl, affiliate_link: affiliateLink, comment_text: commentText, status: 'success' });
        progress(results.length, `Threads đã bình luận thành công ${results.length}/${limit}`);
        log(`Threads đã xác nhận bình luận thành công bài ${results.length}/${limit}`, 'confirmed');
      } else {
        log(`Chưa thể xác nhận bình luận bài ${index + 1}`, 'unconfirmed', 'WARN');
      }

      if (!isDirectPost) await closePost();
      if (results.length < limit && index < candidateUrls.length - 1) {
        const min = Math.max(1, Number(task.delay_min_seconds) || 2);
        const max = Math.max(min, Number(task.delay_max_seconds) || 7);
        const waitMs = (min + Math.floor(Math.random() * (max - min + 1))) * 1000;
        progress(results.length, `Đang chờ ${Math.round(waitMs / 1000)} giây trước bài tiếp theo`);
        await sleep(waitMs);
      }
    }
    finish(results, results.length ? '' : 'Không tìm thấy hoặc không bình luận được bài Threads nào');
  } catch (error) {
    log(error?.message || 'Lỗi gắn link Threads', 'failed', 'ERROR');
    finish(results, error?.message || 'Lỗi gắn link Threads');
  }
})();
}
