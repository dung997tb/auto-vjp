// Discover the signed-in profile from navigation, then read its own profile.
(async function() {
  const context = globalThis.__accountScanContext;
  const utils = globalThis.accountScanUtils;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const validName = value => value && !/^(trang chủ|home|for you|dành cho bạn|threads|đang tải\.*|loading\.*|trang cá nhân|profile)$/i.test(value);
  let username = '';
  try {
    for (let attempt = 0; attempt < 20 && !username; attempt++) {
      for (const link of document.querySelectorAll('nav a[href*="/@"], [role="navigation"] a[href*="/@"]')) {
        const match = (link.getAttribute('href') || '').match(/^\/@([A-Za-z0-9._]+)\/?$/);
        const hint = `${link.getAttribute('aria-label') || ''} ${link.textContent || ''} ${link.querySelector('svg')?.getAttribute('aria-label') || ''}`;
        if (match && /trang cá nhân|profile|hồ sơ/i.test(hint)) { username = match[1]; break; }
      }
      if (!username) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!username) throw new Error('Không nhận diện được hồ sơ Threads đang đăng nhập.');
    let name = username;
    // Home headings and follower counts can belong to the feed. Never read them.
    try {
      const target = `https://www.threads.com/@${encodeURIComponent(username)}`;
      const response = await fetch(target, { credentials: 'include', signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const canonical = doc.querySelector('link[rel="canonical"]')?.href || doc.querySelector('meta[property="og:url"]')?.content;
        if (utils.profileKey(canonical) === utils.profileKey(target)) {
          const title = doc.querySelector('meta[property="og:title"]')?.content || '';
          const candidate = clean(title.replace(/\s*\(@[^)]+\).*$/, '').replace(/\s*[|•–-]\s*Threads.*$/i, ''));
          if (validName(candidate)) name = candidate;
        }
      }
    } catch (_) { /* The known username remains a valid identity without metrics. */ }
    await utils.sendDiscovery(context, { accounts: [{ platform: 'threads', social_uid: username, social_username: username, social_name: name }] });
  } catch (error) {
    await utils.sendDiscovery(context, { accounts: [], error: error.message });
  }
})();
