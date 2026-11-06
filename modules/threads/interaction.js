// Auto Post MUT - Threads interaction automator v1.0
if (!window.mutThreadsInteractionInjected) {
window.mutThreadsInteractionInjected = true;

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
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
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
    const boxRect = element.getBoundingClientRect();
    let submit = null;

    // 1. Tìm nút gửi cùng khung composer
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

    if (!submit) {
      const scope = element.closest('form, article, div[role="dialog"]') || document;
      submit = Array.from(scope.querySelectorAll('button, [role="button"]'))
        .find(button => visible(button) && (
          /(?:^|\s)(post|đăng|send|gửi)(?:\s|$)/i.test(label(button)) ||
          /(post reply|đăng trả lời|gửi bình luận)/i.test(label(button))
        ));
    }

    if (submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true') {
      click(submit);
    } else {
      pressEnter(element);
    }
    await sleep(1200);
  };
  const label = element => normalize(`${element?.getAttribute?.('aria-label') || ''} ${element?.textContent || ''}`).toLowerCase();
  const findButton = patterns => Array.from(document.querySelectorAll('button, [role="button"]')).find(element => visible(element) && patterns.some(pattern => pattern.test(label(element))));
  const findPostLike = () => {
    const unlike = document.querySelector('svg[aria-label="Unlike"], svg[aria-label="Bỏ thích"]');
    if (unlike) return null;
    return document.querySelector('svg[aria-label="Like"], svg[aria-label="Thích"]')?.closest('button, [role="button"]') || null;
  };
  const allEditors = () => Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'))
    .filter(element => visible(element) && !element.closest('[aria-hidden="true"]'));
  const editorHint = element => normalize(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('placeholder') || ''}`).toLowerCase();
  const findMainCommentBox = () => {
    const editors = allEditors();
    const matched = editors.find(element => {
      const hint = editorHint(element);
      const parentText = (element.parentElement?.innerText || '').toLowerCase();
      return /reply|trả lời|bình luận|comment|compose|type to compose|soạn/i.test(hint) ||
             /reply to|trả lời/i.test(parentText);
    });
    if (matched) return matched;
    if (/\/@[^/]+\/post\//i.test(location.pathname) && editors.length > 0) return editors[0];
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
  const postKey = () => location.pathname.match(/\/@[^/]+\/post\/([^/]+)/i)?.[1] || location.href;
  const normalizeUsername = value => String(value || '').trim().replace(/^@/, '').toLowerCase();
  const commentContext = replyButton => {
    let node = replyButton.parentElement;
    for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      const profileLinks = Array.from(node.querySelectorAll('a[href]')).filter(link => {
        try {
          const path = new URL(link.href, location.origin).pathname;
          return /^\/@[A-Za-z0-9._]+\/?$/.test(path);
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

  const stored = await chrome.storage.local.get('currentCommentReplyTask_threads');
  const task = stored.currentCommentReplyTask_threads;
  if (!task || task.platform !== 'threads') {
    window.mutThreadsInteractionInjected = false;
    return;
  }
  window.mutThreadsInteractionTaskId = task.id;
  window.mutThreadsInteractionStartedAt = Date.now();
  const ownUsername = normalizeUsername(task.social_uid);

  const items = [];
  const processed = new Set(task.processed_keys || task.processed_comment_keys || []);
  const handledAuthors = new Set();
  let completed = 0;
  try {
    await sleep(2500);
    const isDirectPost = /\/@[^/]+\/post\//i.test(location.pathname);
    const links = isDirectPost ? [] : Array.from(document.querySelectorAll('a[href*="/post/"]'))
      .filter(visible)
      .filter((link, index, array) => array.findIndex(item => item.href === link.href) === index);
    const targets = isDirectPost ? [null] : links.slice(0, Math.max(task.reply_limit * 3, 6));
    
    // 1. TỐI ƯU LUỒNG CHỈ THẢ TIM (FAST LIKE-ONLY MODE)
    const isLikeOnly = task.like_posts && !task.comment_posts && !task.like_comments && !task.smart_reply_enabled;
    if (isLikeOnly && !isDirectPost) {
      let likeButtons = Array.from(document.querySelectorAll('svg[aria-label="Like"], svg[aria-label="Thích"]')).map(svg => svg.closest('button, [role="button"]')).filter(visible);
      for (const btn of likeButtons) {
        if (completed >= task.reply_limit) break;
        const postLink = btn.closest('div[data-pressable-container="true"], article, div')?.querySelector('a[href*="/post/"]');
        const url = postLink ? new URL(postLink.href, location.origin).href : location.href;
        const pKey = url.match(/\/@[^/]+\/post\/([^/]+)/i)?.[1] || url;
        const key = `threads-post:${pKey}`;
        if (task.prevent_duplicates && processed.has(key)) continue;
        
        click(btn);
        items.push({ target_url: url, parent_comment_key: `${key}:like`, parent_comment_text: 'Bài viết Threads', action_type: 'like_post', action_content: 'Đã thích bài viết', status: 'success', progress_credit: 1 });
        processed.add(key);
        completed++;
        await reportProgress(task, completed, `Threads: đã thả tim ${task.progress_offset + completed}/${task.campaign_total} (Fast Mode)`);
        
        const delay = (task.delay_min_seconds + Math.floor(Math.random() * (task.delay_max_seconds - task.delay_min_seconds + 1))) * 1000;
        await sleep(delay);
      }
      finish(task, items);
      return;
    }

    if (!targets.length && !isDirectPost) throw new Error('Không tìm thấy bài viết Threads');

    for (const target of targets) {
      if (completed >= task.reply_limit) break;
      if (target) {
        click(target);
        const opened = await waitFor(() => /\/@[^/]+\/post\//i.test(location.pathname) || document.querySelector('div[role="dialog"]'), 7000);
        if (!opened) continue;
        await sleep(1200);
      }
      const key = `threads-post:${postKey()}`;
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
          postItems.push({ target_url: location.href, parent_comment_key: `${key}:like`, parent_comment_text: 'Bài viết Threads', action_type: 'like_post', action_content: 'Đã thích bài viết', status: 'success' });
          await sleep(700);
        }
      }
      const commentTemplates = (task.post_comment_templates && task.post_comment_templates.length) ? task.post_comment_templates : (task.comment_templates || []);
      if (task.comment_posts && commentTemplates.length) {
        // 2. XỬ LÝ TRIỆT ĐỂ LUỒNG BÌNH LUẬN (Click icon Reply trước để mở khung chat)
        const postReplyBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
          if (!visible(b)) return false;
          const svg = b.querySelector('svg');
          const title = (svg?.querySelector('title')?.textContent || svg?.getAttribute('aria-label') || '').toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const txt = (b.innerText || '').trim().toLowerCase();
          return /reply|trả lời|comment|bình luận/i.test(title) ||
                 /reply|trả lời|comment|bình luận/i.test(aria) ||
                 /^(reply|trả lời)\d*$/i.test(txt);
        });
        if (postReplyBtn) {
          click(postReplyBtn);
          await sleep(800);
        }
        
        const box = await waitFor(findMainCommentBox, 5000);
        if (box) {
          const rawContent = random(commentTemplates);
          // Rút gọn an toàn dưới 500 ký tự của Threads
          let content = rawContent;
          if (content && content.length > 490) {
            let trimmed = content.slice(0, 487);
            const lastSpace = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\n'));
            if (lastSpace > 300) trimmed = trimmed.slice(0, lastSpace);
            content = `${trimmed.trim()}...`;
          }
          setText(box, content); await sleep(400); await submitEditor(box); postActed = true;
          postItems.push({ target_url: location.href, parent_comment_key: `${key}:comment`, parent_comment_text: 'Bài viết Threads', action_type: 'comment_post', action_content: content, status: 'success' });
          await sleep(1200);
        }
      }
      if (postActed && completed < task.reply_limit) {
        postItems.forEach((item, index) => items.push({ ...item, progress_credit: index === 0 ? 1 : 0 }));
        completed++;
        await reportProgress(task, completed, `Threads: đã xử lý ${task.progress_offset + completed}/${task.campaign_total}`);
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
        const commentKey = `threads-comment:${authorKey}`;
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
          const editorsBefore = new Set(allEditors());
          click(replyButton);
          const replyBox = await waitFor(() => allEditors().find(element => {
            if (!visible(element)) return false;
            const hint = editorHint(element);
            const currentValue = element.value || element.textContent || '';
            const isReplyEditor = /reply|trả lời/i.test(hint) || /^@/.test(normalize(currentValue));
            return (isReplyEditor || document.activeElement === element) && (document.activeElement === element || !editorsBefore.has(element));
          }), 5000);
          if (replyBox) {
            const content = random([...(task.reply_templates || []), ...(task.reply_icons || [])].filter(Boolean));
            if (content) {
              const inserted = await appendReplyText(replyBox, content);
              if (!inserted) {
                commentItems.push({ target_url: location.href, parent_comment_key: `${commentKey}:reply`, parent_author: author, parent_comment_text: rowText, action_type: 'reply_comment', action_content: content, status: 'failed', error: 'Threads chưa nhận nội dung phản hồi' });
              } else {
                const replyContent = editorText(replyBox);
                await submitEditor(replyBox);
                if (editorText(replyBox).includes(content)) {
                  commentItems.push({ target_url: location.href, parent_comment_key: `${commentKey}:reply`, parent_author: author, parent_comment_text: rowText, action_type: 'reply_comment', action_content: replyContent, status: 'failed', error: 'Threads chưa gửi nội dung phản hồi' });
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
          await reportProgress(task, completed, `Threads: đã xử lý ${task.progress_offset + completed}/${task.campaign_total}`);
          const delay = (task.delay_min_seconds + Math.floor(Math.random() * (task.delay_max_seconds - task.delay_min_seconds + 1))) * 1000;
          await sleep(delay);
        }
      }
      if (target) await closePost();
    }
    finish(task, items, items.length ? '' : 'Không tìm thấy mục Threads có thể tương tác');
  } catch (error) {
    finish(task, items, error?.message || 'Lỗi tương tác Threads');
  }
})();
}
