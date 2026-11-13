// Auto Post MUT - X (Twitter) Affiliate & Seeding Commenter
if (!window.mutXAffiliateCommenterInjected) {
window.mutXAffiliateCommenterInjected = true;

(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => Boolean(element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
  const random = values => values[Math.floor(Math.random() * values.length)];

  const click = element => {
    if (!element) return false;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.click();
    return true;
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

  const waitFor = async (finder, timeout = 10000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = finder();
      if (found) return found;
      await sleep(300);
    }
    return null;
  };

  const closeDialog = async () => {
    const closeBtn = document.querySelector('[data-testid="app-bar-close"], [aria-label="Close"], [aria-label="Đóng"]');
    if (closeBtn && visible(closeBtn)) {
      click(closeBtn);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    await sleep(500);
  };

  const parseMetric = str => {
    if (!str) return 0;
    const match = String(str).match(/([\d.,]+)\s*([kKmMbB]?)/);
    if (!match) return 0;
    let num = parseFloat(match[1].replace(/,/g, ''));
    const unit = (match[2] || '').toUpperCase();
    if (unit === 'K') num *= 1000;
    else if (unit === 'M') num *= 1000000;
    else if (unit === 'B') num *= 1000000000;
    return isNaN(num) ? 0 : Math.round(num);
  };

  const stored = await chrome.storage.local.get(['currentAffiliateCommentTask_x', 'currentAutomationRun']);
  const task = (stored.currentAutomationRun?.type === 'affiliate' && ['x', 'twitter'].includes(stored.currentAutomationRun.platform))
    ? stored.currentAutomationRun
    : stored.currentAffiliateCommentTask_x;

  if (!task || !['x', 'twitter'].includes(task.platform)) {
    window.mutXAffiliateCommenterInjected = false;
    return;
  }

  window.mutXAffiliateCommenterTaskId = task.id;
  window.mutXAffiliateCommenterStartedAt = Date.now();
  const limit = Math.max(1, Math.min(10, Number(task.post_limit) || 1));

  const progress = (current, message) => chrome.runtime.sendMessage({
    action: 'affiliateCommentProgress', campaignId: task.id, current, total: limit, message
  });

  const log = (message, step = 'acting', level = 'INFO', details = null) => chrome.runtime.sendMessage({
    action: 'automationLog', event: { level, platform: 'x', job: 'Bình luận X', campaign: task.name || '', taskId: task.id, step, message, details }
  });

  const finish = (items, error = '') => chrome.runtime.sendMessage({
    action: 'affiliateCommentDone', campaignId: task.id, items, error,
    sourceGroupUrl: task.source_key || task.source_url || location.href,
    sourceKey: task.source_key || ''
  });

  const results = [];
  try {
    log('Đã nhận nhiệm vụ, đang tải trang X (Twitter)', 'received');
    progress(0, 'Đang chờ X tải nội dung...');
    await sleep(2500);

    const isDirectStatus = /\/status\/\d+/i.test(location.pathname);
    const links = Array.isArray(task.affiliate_links) ? task.affiliate_links.filter(Boolean) : [];
    const richTemplates = Array.isArray(task.rich_comment_templates) ? task.rich_comment_templates.filter(item => item?.text) : [];
    const textTemplates = Array.isArray(task.comment_templates) ? task.comment_templates.filter(Boolean) : [];
    if (!links.length && !richTemplates.length && !textTemplates.length) {
      throw new Error('Không còn link hoặc mẫu bình luận hợp lệ');
    }
    const placeholder = /\{\{\s*(?:affiliate_link|link)\s*\}\}|\{\s*(?:affiliate_link|link)\s*\}/gi;

    // Quality filter settings if defined
    let qualityFilter = null;
    try {
      qualityFilter = typeof task.quality_filter === 'string' ? JSON.parse(task.quality_filter) : task.quality_filter;
    } catch (e) { console.debug("[Auto vjp][affiliate-commenter] bỏ qua lỗi:", e); }

    // Scan for articles
    let candidateArticles = [];
    for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).filter(visible);
      if (articles.length) {
        candidateArticles = articles;
        if (isDirectStatus || candidateArticles.length >= limit) break;
      }
      window.scrollBy({ top: 500, behavior: 'smooth' });
      await sleep(1500);
    }

    if (!candidateArticles.length) {
      throw new Error('Không tìm thấy bài viết tweet nào trên trang X');
    }

    // Filter articles based on quality filter if enabled
    if (qualityFilter && (qualityFilter.minViews || qualityFilter.minLikes || qualityFilter.minShares || qualityFilter.maxComments)) {
      const minViews = Number(qualityFilter.minViews) || 0;
      const minLikes = Number(qualityFilter.minLikes) || 0;
      const minShares = Number(qualityFilter.minShares) || 0;
      const maxComments = Number(qualityFilter.maxComments) || Infinity;
      const logicAnd = qualityFilter.logic === 'AND';

      candidateArticles = candidateArticles.filter(art => {
        const textContent = art.innerText || '';
        const likeEl = art.querySelector('[data-testid="like"], [data-testid="unlike"]');
        const retweetEl = art.querySelector('[data-testid="retweet"], [data-testid="unretweet"]');
        const replyEl = art.querySelector('[data-testid="reply"]');
        const viewsEl = art.querySelector('a[href*="/analytics"]');

        const likes = parseMetric(likeEl?.innerText || likeEl?.getAttribute('aria-label'));
        const shares = parseMetric(retweetEl?.innerText || retweetEl?.getAttribute('aria-label'));
        const replies = parseMetric(replyEl?.innerText || replyEl?.getAttribute('aria-label'));
        const views = parseMetric(viewsEl?.innerText || viewsEl?.getAttribute('aria-label'));

        const matchViews = minViews <= 0 || views >= minViews;
        const matchLikes = minLikes <= 0 || likes >= minLikes;
        const matchShares = minShares <= 0 || shares >= minShares;
        const matchComments = maxComments <= 0 || replies <= maxComments;

        return logicAnd
          ? (matchViews && matchLikes && matchShares && matchComments)
          : (matchViews || matchLikes || matchShares);
      });

      if (!candidateArticles.length) {
        throw new Error('Không có bài viết nào thỏa mãn bộ lọc chất lượng (View, Like, Repost)');
      }
    }

    const processedKeys = new Set(task.processed_keys || []);
    let commentIndex = 0;

    for (const article of candidateArticles) {
      if (results.length >= limit) break;

      const tweetLink = Array.from(article.querySelectorAll('a[href*="/status/"]')).find(visible)?.href || location.href;
      const statusId = tweetLink.match(/\/status\/(\d+)/)?.[1] || tweetLink;
      if (task.prevent_duplicates && processedKeys.has(statusId)) continue;

      progress(results.length, `Đang chuẩn bị bình luận tweet (${results.length + 1}/${limit})`);

      // 1. Click Reply button on tweet
      const replyBtn = article.querySelector('[data-testid="reply"]');
      if (!replyBtn) continue;
      click(replyBtn);
      await sleep(1000);

      // 2. Wait for editor box
      const editor = await waitFor(() => Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"][contenteditable="true"], div[role="textbox"][contenteditable="true"]')).find(visible), 6000);
      if (!editor) {
        await closeDialog();
        continue;
      }

      // 3. Prepare comment content
      const affiliateLink = links.length
        ? (task.link_distribution === 'round_robin' ? links[commentIndex % links.length] : random(links))
        : '';
      const selectedTpl = richTemplates.length ? random(richTemplates)
        : { text: textTemplates.length ? random(textTemplates) : '{link}' };
      const template = String(selectedTpl.text || '');
      const hasPlaceholder = placeholder.test(template);
      placeholder.lastIndex = 0;

  const fitTextToLimit = (text, maxLength = 275, link = '') => {
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

      const rawCommentText = affiliateLink
        ? (hasPlaceholder ? template.replace(placeholder, affiliateLink) : `${template}${template ? '\n' : ''}${affiliateLink}`)
        : template.replace(placeholder, '').trim();

      if (!rawCommentText) {
        await closeDialog();
        continue;
      }

      const commentText = fitTextToLimit(rawCommentText, 275, affiliateLink);
      if (commentText.length < rawCommentText.length) {
        log(`Đã tự động rút gọn bình luận (${rawCommentText.length} ➜ ${commentText.length} ký tự) để vừa giới hạn 280 ký tự của X`, 'trimmed_content');
      }

      // 4. Fill text and submit
      progress(results.length, `Đang gõ nội dung bình luận vào bài tweet...`);
      setEditor(editor, commentText);
      await sleep(600 + Math.floor(Math.random() * 500));

      const sendBtn = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')).find(b => visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (!sendBtn) {
        await closeDialog();
        continue;
      }

      click(sendBtn);
      await sleep(2000);

      // Confirm dialog closed or editor emptied
      processedKeys.add(statusId);
      commentIndex++;
      results.push({
        facebook_post_url: tweetLink,
        affiliate_link: affiliateLink,
        comment_text: commentText,
        status: 'success'
      });

      progress(results.length, `Đã bình luận thành công trên X ${results.length}/${limit}`);
      log(`Đã gửi bình luận thành công vào bài viết X: ${tweetLink}`, 'confirmed');

      // Random delay before next comment
      if (results.length < limit) {
        const min = Math.max(5, Number(task.delay_min_seconds) || 30);
        const max = Math.max(min, Number(task.delay_max_seconds) || 60);
        const waitMs = (min + Math.floor(Math.random() * (max - min + 1))) * 1000;
        progress(results.length, `Đang giãn cách an toàn ${Math.round(waitMs / 1000)}s trước tweet tiếp theo...`);
        await sleep(waitMs);
      }
    }

    finish(results, results.length ? '' : 'Không tìm thấy hoặc không bình luận được bài tweet nào');
  } catch (err) {
    console.error('[MUT-X-Affiliate] Lỗi thực thi bình luận X:', err);
    log(err?.message || 'Lỗi bình luận trên X', 'failed', 'ERROR');
    finish(results, err?.message || 'Lỗi bình luận trên X');
  }
})();
}
