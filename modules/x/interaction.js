// Auto Post MUT - X interaction automator
if (!window.mutXInteractionInjected) {
window.mutXInteractionInjected = true;
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => Boolean(el && el.getBoundingClientRect().width && el.getBoundingClientRect().height);
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const click = el => { if (!visible(el)) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; };
  const stored = await chrome.storage.local.get('currentCommentReplyTask_x');
  const task = stored.currentCommentReplyTask_x;
  if (!task || !['x', 'twitter'].includes(task.platform)) { window.mutXInteractionInjected = false; return; }
  window.mutXInteractionTaskId = task.id;
  window.mutXInteractionStartedAt = Date.now();
  const items = [];
  const processed = new Set(task.processed_keys || []);
  const random = values => values[Math.floor(Math.random() * values.length)];
  const finish = error => chrome.runtime.sendMessage({ action: 'commentReplyDone', campaignId: task.id, items, error, sourceUrl: task.source_url || location.href });
  const progress = current => chrome.runtime.sendMessage({ action: 'commentReplyProgress', campaignId: task.id, current: task.progress_offset + current, total: task.campaign_total, message: `X: đã xử lý ${task.progress_offset + current}/${task.campaign_total}` });
  const closeDialog = async () => {
    const closeBtn = document.querySelector('[data-testid="app-bar-close"], [aria-label="Close"], [aria-label="Đóng"]');
    if (closeBtn && visible(closeBtn)) {
      click(closeBtn);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    await sleep(500);
  };
  const setEditor = (editor, value) => {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, value);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  };
  const submitReply = async content => {
    const editor = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"], div[role="textbox"][contenteditable="true"]')).find(visible);
    if (!editor) return false;
    setEditor(editor, content);
    await sleep(400);
    const send = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')).find(button => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    if (!send) return false;
    click(send);
    await sleep(1000);
    return true;
  };
  const statusUrl = article => Array.from(article.querySelectorAll('a[href*="/status/"]')).find(visible)?.href || location.href;
  const actionItem = (article, key, type, content, credit = 1) => ({
    target_url: statusUrl(article), parent_comment_key: key, parent_comment_text: text(article).slice(0, 300),
    action_type: type, action_content: content, status: 'success', progress_credit: credit
  });
  try {
    await sleep(2500);
    let completed = 0;
    for (let scan = 0; scan < 8 && completed < task.reply_limit; scan++) {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).filter(visible);
      for (const article of articles) {
        if (completed >= task.reply_limit) break;
        const targetUrl = statusUrl(article);
        const statusId = targetUrl.match(/\/status\/(\d+)/)?.[1] || text(article).slice(0, 100);
        const key = `x:${statusId}`;
        if (task.prevent_duplicates && processed.has(key)) continue;
        let acted = false;
        const isReply = /\/status\//.test(location.pathname) && article !== articles[0];
        if ((isReply ? task.like_comments : task.like_posts)) {
          const like = article.querySelector('[data-testid="like"]');
          if (click(like)) {
            items.push(actionItem(article, `${key}:like`, isReply ? 'like_comment' : 'like_post', isReply ? 'Đã thích phản hồi' : 'Đã thích bài viết'));
            acted = true;
            await sleep(600);
          }
        }
        const shouldReply = isReply && task.smart_reply_enabled;
        const shouldComment = !isReply && task.comment_posts;
        if (shouldReply || shouldComment) {
          const commentTemplates = (task.post_comment_templates && task.post_comment_templates.length)
            ? task.post_comment_templates
            : (task.comment_templates || []);
          let content = shouldReply
            ? random((task.reply_templates || []).length ? task.reply_templates : (task.reply_icons || ['❤️']))
            : random(commentTemplates);
          if (content && content.length > 275) {
            let trimmed = content.slice(0, 272);
            const lastSpace = Math.max(trimmed.lastIndexOf(' '), trimmed.lastIndexOf('\n'));
            if (lastSpace > 160) trimmed = trimmed.slice(0, lastSpace);
            content = `${trimmed.trim()}...`;
          }
          if (content && click(article.querySelector('[data-testid="reply"]'))) {
            await sleep(700);
            if (await submitReply(content)) {
              items.push(actionItem(article, `${key}:${shouldReply ? 'reply' : 'comment'}`, shouldReply ? 'reply_comment' : 'comment_post', content, acted ? 0 : 1));
              acted = true;
            } else {
              await closeDialog();
            }
          }
        }
        if (acted) {
          processed.add(key);
          completed++;
          await progress(completed);
          const min = Number(task.delay_min_seconds) || 30;
          const max = Math.max(min, Number(task.delay_max_seconds) || min);
          await sleep((min + Math.floor(Math.random() * (max - min + 1))) * 1000);
        }
      }
      if (completed >= task.reply_limit) break;
      window.scrollBy({ top: Math.round(innerHeight * 0.8), behavior: 'smooth' });
      await sleep(1600);
    }
    finish(items.length ? '' : 'Không tìm thấy nội dung X có thể tương tác');
  } catch (error) { finish(error?.message || 'Lỗi tương tác X'); }
})();
}
