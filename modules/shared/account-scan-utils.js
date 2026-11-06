// Shared by profile enrichers. Never treat a feed/login redirect as a profile.
globalThis.accountScanUtils = {
  // Resolve once data exists; DOM load completion alone does not cover SPA rendering.
  waitForMetrics(read, timeoutMs = 20000) {
    return new Promise(resolve => {
      let settled = false;
      let timer;
      let scheduled;
      let last = {};
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(scheduled);
        resolve(last);
      };
      const check = () => {
        if (settled) return;
        try { last = read() || {}; } catch (_) { last = {}; }
        if (['followers_count', 'friends_count', 'subscribers_count'].some(key => Number.isFinite(last[key]))) finish();
      };
      const observer = new MutationObserver(() => {
        // Coalesce bursts from React without delaying the deadline.
        if (!scheduled) scheduled = setTimeout(() => { scheduled = null; check(); }, 100);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      timer = setTimeout(() => { check(); finish(); }, timeoutMs);
      check();
    });
  },
  profileKey(value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace('threads.net', 'threads.com');
      const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
      if (!['facebook.com', 'x.com', 'instagram.com', 'threads.com', 'tiktok.com', 'youtube.com'].includes(host)) return null;
      if (!path || /^\/(me|home|login|accounts|feed|explore|reels|watch|checkpoint)(\/|$)/.test(path)) return null;
      return `${host}${path}${path === '/profile.php' ? '?id=' + url.searchParams.get('id') : ''}`;
    } catch (_) { return null; }
  },
  parseMetric(value) {
    const match = String(value ?? '').toLowerCase().replace(/\s/g, '').match(/([\d.,]+)(k|m|b|nghìn|ngàn|triệu|tỷ)?/);
    if (!match) return null;
    let raw = match[1];
    if (match[2]) {
      if (raw.includes(',') && raw.includes('.')) raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
      else raw = raw.replace(',', '.');
    } else raw = raw.replace(/[.,]/g, '');
    const multiplier = { k: 1e3, nghìn: 1e3, ngàn: 1e3, m: 1e6, triệu: 1e6, b: 1e9, tỷ: 1e9 }[match[2]] || 1;
    const result = Number(raw) * multiplier;
    return Number.isFinite(result) && result >= 0 ? Math.round(result) : null;
  },
  sendDiscovery(context, message) {
    if (!context?.scanId || !context?.stepId) return;
    return chrome.runtime.sendMessage({ ...message, action: 'socialAccountsScannerResult', scanId: context.scanId, stepId: context.stepId });
  },
  send(context, message) {
    if (!context?.stepId) return;
    const expected = this.profileKey(context.targetUrl);
    const actual = this.profileKey(location.href);
    const canonical = this.profileKey(document.querySelector('link[rel="canonical"]')?.href || document.querySelector('meta[property="og:url"]')?.content || '');
    const account = context.account;
    const username = String(account.social_username || '').replace(/^@/, '').toLowerCase();
    const isFacebook = ['facebook', 'facebook_page'].includes(account.platform);
    const facebookAlias = isFacebook && (
      (username && actual === `facebook.com/${username}`) ||
      (message.data?.social_username && actual === `facebook.com/${String(message.data.social_username).toLowerCase()}`) ||
      (message.data?.social_uid === account.social_uid) ||
      (document.documentElement?.innerHTML && account.social_uid && document.documentElement.innerHTML.includes(account.social_uid))
    );
    const youtubeChannel = account.platform === 'youtube' && message.data?.social_uid === account.social_uid && actual?.startsWith('youtube.com/@');
    if (!expected || !actual || (actual !== expected && canonical !== expected && !facebookAlias && !youtubeChannel)) message = { error: 'Trang đã chuyển hướng hoặc không xác minh được đúng hồ sơ. Không cập nhật dữ liệu.' };
    const foundUid = message.data?.social_uid;
    if (foundUid && /^(\d+|UC[\w-]+)$/.test(account.social_uid) && String(foundUid) !== account.social_uid) message = { error: 'UID hồ sơ không khớp tài khoản yêu cầu.' };
    if (!message.error && !['followers_count', 'friends_count', 'subscribers_count'].some(key => Number.isFinite(message.data?.[key]))) message = { error: 'Hết thời gian chờ số liệu hồ sơ (20 giây). Trang có thể chưa tải xong, yêu cầu đăng nhập/CAPTCHA hoặc không hiển thị số liệu; giữ nguyên dữ liệu hiện có.' };
    return chrome.runtime.sendMessage({ ...message, action: 'socialAccountsScannerResult', type: 'enrichment', scanId: context.scanId, stepId: context.stepId });
  }
};
