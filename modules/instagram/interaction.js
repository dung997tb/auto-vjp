// Auto Post MUT - Instagram interaction automator v1.0
if (!window.mutInstagramInteractionInjected) {
window.mutInstagramInteractionInjected = true;

(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => Boolean(element && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
  const random = values => values[Math.floor(Math.random() * values.length)];
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
  const editorText = element => normalize(element?.value || element?.innerText || element?.textContent || '');
  const appendReplyText = async (element, text) => {
    element.focus();
    const current = editorText(element);
    const separator = current && !/\s$/.test(current) ? ' ' : '';
    const addition = `${separator}${text}`;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      const nextValue = `${element.value || ''}${addition}`;
      if (setter) setter.call(element, nextValue); else element.value = nextValue;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }));
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('insertText', false, addition);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }));
    }
    await sleep(500);
    return editorText(element).includes(text);
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
    const submit = Array.from(scope.querySelectorAll('button, [role="button"]'))
      .find(button => visible(button) && [/^post$/i, /^đăng$/i, /^send$/i, /^gửi$/i].some(pattern => pattern.test(label(button))));
    if (submit && !submit.disabled) click(submit);
    await sleep(900);
  };
  const label = element => normalize(`${element?.getAttribute?.('aria-label') || ''} ${element?.textContent || ''}`).toLowerCase();
  const findButton = patterns => Array.from(document.querySelectorAll('button, [role="button"]')).find(element => visible(element) && patterns.some(pattern => pattern.test(label(element))));
  const findPostLike = () => {
    const unlike = document.querySelector('svg[aria-label="Unlike"], svg[aria-label="Bỏ thích"]');
    if (unlike) return null;
    return document.querySelector('svg[aria-label="Like"], svg[aria-label="Thích"]')?.closest('button, [role="button"]') || null;
  };
  const findMainCommentBox = () => Array.from(document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]'))
    .find(element => visible(element) && /add a comment|thêm bình luận|bình luận/i.test(element.getAttribute('aria-label') || element.getAttribute('placeholder') || ''));
  const waitFor = async (finder, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = finder();
      if (found) return found;
      await sleep(300);
    }
    return null;
  };
  const postKey = () => location.pathname.match(/\/(?:p|reel)\/([^/]+)/i)?.[1] || location.href;
  const normalizeUsername = value => String(value || '').trim().replace(/^@/, '').toLowerCase();
  const commentContext = replyButton => {
    let node = replyButton.parentElement;
    for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const profileLinks = Array.from(node.querySelectorAll('a[href]')).filter(link => {
        try {
          const path = new URL(link.href, location.origin).pathname;
          return /^\/[A-Za-z0-9._]+\/?$/.test(path);
        } catch (_) { return false; }
      });
      if (profileLinks.length && rect.height >= 28 && rect.height <= 420) {
        const authorLink = profileLinks[0];
        const author = normalizeUsername(new URL(authorLink.href, location.origin).pathname.split('/').filter(Boolean)[0]);
        return { row: node, author };
      }
    }
    return { row: replyButton.parentElement?.parentElement, author: '' };
  };
  const closePost = async () => {
    const close = document.querySelector('svg[aria-label="Close"], svg[aria-label="Đóng"]')?.closest('button, [role="button"]') || findButton([/^close$/i, /^đóng$/i]);
    if (close) { click(close); await sleep(1200); return; }
    history.back(); await sleep(1500);
  };
  const reportProgress = (task, current, message) => chrome.runtime.sendMessage({ action: 'commentReplyProgress', campaignId: task.id, current: task.progress_offset + current, total: task.campaign_total, message });
  const finish = (task, items, error = '') => chrome.runtime.sendMessage({ action: 'commentReplyDone', campaignId: task.id, items, error, sourceUrl: task.source_url || location.href });

  const stored = await chrome.storage.local.get('currentCommentReplyTask_instagram');
  const task = stored.currentCommentReplyTask_instagram;
  if (!task || task.platform !== 'instagram') {
    window.mutInstagramInteractionInjected = false;
    return;
  }
  window.mutInstagramInteractionTaskId = task.id;
  window.mutInstagramInteractionStartedAt = Date.now();
  const ownUsername = normalizeUsername(task.social_uid);
  const log = (message, step = 'acting', level = 'INFO', details = null) => chrome.runtime.sendMessage({
    action: 'automationLog', event: { level, platform: 'instagram', job: 'Tương tác', campaign: task.name || '', taskId: task.id, step, message, details }
  });

  const items = [];
  const processed = new Set(task.processed_comment_keys || []);
  const handledAuthors = new Set();
  let completed = 0;
  try {
    log('Đã nhận nhiệm vụ, đang tìm nội dung để tương tác', 'received');
    await reportProgress(task, 0, `Instagram: đã nhận lệnh, đang tìm nội dung để xử lý`);
    await sleep(2500);
    const isDirectPost = /\/(p|reel)\//i.test(location.pathname);
    const links = isDirectPost ? [] : Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'))
      .filter(visible)
      .filter((link, index, array) => array.findIndex(item => item.href === link.href) === index);
    const targets = isDirectPost ? [null] : links.slice(0, Math.max(task.reply_limit * 3, 6));
    if (!targets.length) throw new Error('Không tìm thấy bài viết hoặc Reel Instagram');

    for (const target of targets) {
      if (completed >= task.reply_limit) break;
      if (target) {
        click(target);
        const opened = await waitFor(() => /\/(p|reel)\//i.test(location.pathname) || document.querySelector('div[role="dialog"]'), 7000);
        if (!opened) continue;
        await sleep(1200);
      }
      const key = `ig-post:${postKey()}`;
      if (task.prevent_duplicates && processed.has(key)) {
        if (target) await closePost();
        continue;
      }
      let postActed = false;
      const postItems = [];
      if (task.like_posts) {
        const likeButton = findPostLike();
        if (likeButton) {
          click(likeButton); postActed = true;
          postItems.push({ target_url: location.href, parent_comment_key: `${key}:like`, parent_comment_text: 'Bài viết Instagram', action_type: 'like_post', action_content: 'Đã thích bài viết', status: 'success' });
          await sleep(700);
        }
      }
      if (task.comment_posts && task.post_comment_templates?.length) {
        const box = await waitFor(findMainCommentBox, 5000);
        if (box) {
          const content = random(task.post_comment_templates);
          setText(box, content); await sleep(400); await submitEditor(box); postActed = true;
          postItems.push({ target_url: location.href, parent_comment_key: `${key}:comment`, parent_comment_text: 'Bài viết Instagram', action_type: 'comment_post', action_content: content, status: 'success' });
          await sleep(1200);
        }
      }
      if (postActed && completed < task.reply_limit) {
        postItems.forEach((item, index) => items.push({ ...item, progress_credit: index === 0 ? 1 : 0 }));
        completed++;
        log(`Đã xử lý ${task.progress_offset + completed}/${task.campaign_total} mục`, 'progress', 'INFO', { completed, total: task.campaign_total });
        await reportProgress(task, completed, `Instagram: đã xử lý ${task.progress_offset + completed}/${task.campaign_total}`);
      }

      const replyButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(element => visible(element) && /^(reply|trả lời)$/i.test(normalize(element.textContent)));
      for (const replyButton of replyButtons) {
        if (completed >= task.reply_limit) break;
        const context = commentContext(replyButton);
        const row = context.row;
        const author = context.author;
        const rowText = normalize(row?.innerText).slice(0, 300);
        const authorKey = `${postKey()}:${author || rowText}`;
        const runAuthorKey = author || authorKey;
        const commentKey = `ig-comment:${authorKey}`;
        const alreadyProcessed = processed.has(commentKey)
          || processed.has(`${commentKey}:reply`)
          || processed.has(`${commentKey}:like`);
        if (author && author === ownUsername) continue;
        if (handledAuthors.has(runAuthorKey)) continue;
        if (!rowText || (task.prevent_duplicates && alreadyProcessed)) continue;
        handledAuthors.add(runAuthorKey);
        let commentActed = false;
        const commentItems = [];
        if (task.like_comments) {
          const likeComment = Array.from(row?.querySelectorAll?.('button, [role="button"]') || []).find(element => /^(like|thích)$/i.test(label(element)));
          if (likeComment) {
            click(likeComment); commentActed = true;
            commentItems.push({ target_url: location.href, parent_comment_key: `${commentKey}:like`, parent_author: author, parent_comment_text: rowText, action_type: 'like_comment', action_content: 'Đã thích comment', status: 'success' });
            await sleep(500);
          }
        }
        if (task.smart_reply_enabled) {
          const editorsBefore = new Set(document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]'));
          click(replyButton);
          const replyBox = await waitFor(() => Array.from(document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]')).find(element => {
            if (!visible(element)) return false;
            const hint = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('placeholder') || ''}`;
            const currentValue = element.value || element.textContent || '';
            const isReplyEditor = /reply|trả lời/i.test(hint) || /^@/.test(normalize(currentValue));
            return isReplyEditor && (document.activeElement === element || !editorsBefore.has(element));
          }), 5000);
          if (replyBox) {
            const content = random([...(task.reply_templates || []), ...(task.reply_icons || [])].filter(Boolean));
            if (content) {
              const inserted = await appendReplyText(replyBox, content);
              if (!inserted) {
                commentItems.push({ target_url: location.href, parent_comment_key: `${commentKey}:reply`, parent_author: author, parent_comment_text: rowText, action_type: 'reply_comment', action_content: content, status: 'failed', error: 'Instagram chưa nhận nội dung phản hồi' });
              } else {
                const replyContent = editorText(replyBox);
                await submitEditor(replyBox);
                if (editorText(replyBox).includes(content)) {
                  commentItems.push({ target_url: location.href, parent_comment_key: `${commentKey}:reply`, parent_author: author, parent_comment_text: rowText, action_type: 'reply_comment', action_content: replyContent, status: 'failed', error: 'Instagram chưa gửi nội dung phản hồi' });
                } else {
                  commentActed = true;
                  commentItems.push({ target_url: location.href, parent_comment_key: `${commentKey}:reply`, parent_author: author, parent_comment_text: rowText, action_type: 'reply_comment', action_content: replyContent, status: 'success' });
                }
              }
            }
          }
        }
        if (commentItems.length) {
          const firstSuccess = commentItems.findIndex(item => item.status === 'success');
          commentItems.forEach((item, index) => items.push({ ...item, progress_credit: index === firstSuccess ? 1 : 0 }));
        }
        if (commentActed) {
          completed++;
          await reportProgress(task, completed, `Instagram: đã xử lý ${task.progress_offset + completed}/${task.campaign_total}`);
          const delay = (task.delay_min_seconds + Math.floor(Math.random() * (task.delay_max_seconds - task.delay_min_seconds + 1))) * 1000;
          await sleep(delay);
        }
      }
      if (target) await closePost();
    }
    finish(task, items, items.length ? '' : 'Không tìm thấy mục Instagram có thể tương tác');
  } catch (error) {
    log(error?.message || 'Instagram không thể hoàn tất tương tác', 'failed', 'ERROR');
    finish(task, items, error?.message || 'Lỗi tương tác Instagram');
  }
})();
}
