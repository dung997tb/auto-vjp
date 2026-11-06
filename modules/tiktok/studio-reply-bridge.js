// Observe only the reply request initiated by the Studio runner on this tab.
(() => {
  if (window.__mutTikTokStudioReplyBridge) return;
  window.__mutTikTokStudioReplyBridge = true;
  const root = document.documentElement;
  const requestKey = 'data-mut-studio-reply-request';
  const resultKey = 'data-mut-studio-reply-result';
  const bodyText = body => {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return Array.from(body.values()).filter(value => typeof value === 'string').join(' ');
    return '';
  };
  const matching = (url, method, body) => {
    const request = root.getAttribute(requestKey);
    if (!request) return null;
    let expected;
    try { expected = JSON.parse(request); } catch { return null; }
    let path;
    try { path = new URL(url, location.href).pathname; } catch { return null; }
    if (String(method || 'GET').toUpperCase() !== 'POST' || !/comment|reply/i.test(path)) return null;
    const content = bodyText(body);
    let decoded = content;
    try { decoded = decodeURIComponent(content.replace(/\+/g, ' ')); } catch {}
    if (!content || !content.includes(expected.text) && !decoded.includes(expected.text)) return null;
    return expected.nonce;
  };
  const record = (nonce, status, data) => {
    let success = false;
    if (status >= 200 && status < 300 && data && typeof data === 'object') {
      success = data.status_code === 0 || data.code === 0 || data.success === true;
    }
    root.setAttribute(resultKey, JSON.stringify({ nonce, success, status }));
  };
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const nonce = matching(input?.url || input, init?.method || input?.method, body);
    const response = await originalFetch.apply(this, arguments);
    if (nonce) response.clone().json().then(data => record(nonce, response.status, data)).catch(() => {});
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    requests.set(this, { method, url });
    return originalOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const request = requests.get(this);
    const nonce = matching(request?.url, request?.method, body);
    if (nonce) this.addEventListener('load', () => {
      try { record(nonce, this.status, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, { once: true });
    return originalSend.apply(this, arguments);
  };
})();
