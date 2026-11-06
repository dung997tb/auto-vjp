// MAIN-world adapter: read only TikTok's logged-in context and comment metadata.
// Never exports cookies, tokens, arbitrary page state, or makes API requests.
(() => {
  if (window.__mutTikTokReplyBridge) return;
  window.__mutTikTokReplyBridge = true;
  const confirmations = [];
  const record = data => {
    const comment = data?.comment;
    if (Number(data?.status_code) !== 0 || !comment?.cid || !comment?.reply_id) return;
    confirmations.push({ id: String(comment.cid), parent: String(comment.reply_to_reply_id && comment.reply_to_reply_id !== '0' ? comment.reply_to_reply_id : comment.reply_id), post: String(comment.aweme_id || ''), text: String(comment.text || ''), author: String(comment.user?.unique_id || comment.user?.uniqueId || '') });
    if (confirmations.length > 40) confirmations.shift();
  };
  const publish = url => { try { const u = new URL(url, location.href); return u.origin === location.origin && u.pathname === '/api/comment/publish/'; } catch { return false; } };
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    if (publish(args[0]?.url || args[0])) response.clone().json().then(record).catch(() => {});
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...args) { urls.set(this, url); return originalOpen.call(this, method, url, ...args); };
  XMLHttpRequest.prototype.send = function(...args) {
    if (publish(urls.get(this))) this.addEventListener('load', () => { try { record(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {} }, { once: true });
    return originalSend.apply(this, args);
  };
  const username = user => String(user?.uniqueId || user?.unique_id || '').replace(/^@/, '');
  function actor() {
    try {
      const data = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '{}');
      const context = data.__DEFAULT_SCOPE__?.['webapp.app-context'];
      const user = context?.user;
      if (context?.isLogin === true && username(user)) return username(user);
    } catch {}
    // The navigation profile belongs to the logged-in actor; post author links do not.
    const link = document.querySelector('a[data-e2e="nav-profile"], [data-e2e="nav-profile"] a[href*="/@"]');
    return link?.getAttribute('href')?.match(/\/@([\w.-]+)\/?$/)?.[1] || '';
  }
  function commentFor(element) {
    for (const candidate of [element, ...Array.from(element.querySelectorAll('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"], [data-e2e="comment-reply-1"], [data-e2e="comment-reply-2"]'))]) {
      const key = Object.keys(candidate).find(k => k.startsWith('__reactFiber$'));
      let fiber = key && candidate[key];
      for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        for (const value of [props?.comment, props?.commentItem, props?.item, props?.data]) {
          if (value?.cid && typeof value.text === 'string' && username(value.user)) {
            return { id: String(value.cid), author: username(value.user), displayName: String(value.user.nickname || username(value.user)), text: value.text };
          }
        }
      }
    }
    return null;
  }
  document.addEventListener('mut-tiktok-reply-inspect', () => {
    for (const row of document.querySelectorAll('[data-e2e="comment-item"], [class*="DivCommentItemContainer"], [class*="DivCommentItemWrapper"]')) {
      const comment = commentFor(row);
      if (comment) row.setAttribute('data-mut-tiktok-comment', JSON.stringify(comment));
    }
    document.documentElement.setAttribute('data-mut-tiktok-reply-context', JSON.stringify({ actor: actor(), confirmations }));
  });
})();
