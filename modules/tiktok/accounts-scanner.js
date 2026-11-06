// Quét tài khoản TikTok đang đăng nhập
(async function() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalizeUsername = value => String(value || '').trim().replace(/^@|\/$/g, '');
  const validUsername = value => {
    const username = normalizeUsername(value);
    return /^[a-zA-Z0-9_.-]{2,24}$/.test(username);
  };

  let username = '';
  let displayName = '';

  try {
    await sleep(2500);

    // Share the actor resolver with the reply runner. Never infer login from a
    // random video's author uniqueId in page HTML.
    for (let attempt = 0; attempt < 30 && !username; attempt++) {
      document.dispatchEvent(new Event('mut-tiktok-reply-inspect'));
      try {
        const context = JSON.parse(document.documentElement.getAttribute('data-mut-tiktok-reply-context') || '{}');
        if (validUsername(context.actor)) username = normalizeUsername(context.actor);
      } catch {}
      if (!username) await sleep(500);
    }

    let followersCount = null;
    function parseMetricNumber(str) {
      if (!str) return null;
      const clean = String(str).trim().toLowerCase().replace(/\s/g, '');
      const m = clean.match(/([\d.,]+)([kmb])?/);
      if (!m) return null;
      const raw = m[1].includes(',') && !m[1].includes('.') ? m[1].replace(/,/g, '') : m[1].replace(/,/g, '.');
      let val = parseFloat(raw);
      if (isNaN(val)) return null;
      const unit = m[2];
      if (unit === 'k') val *= 1000;
      else if (unit === 'm') val *= 1000000;
      else if (unit === 'b') val *= 1000000000;
      return Math.round(val);
    }

    // Fetch trang cá nhân để lấy đúng follower count
    if (username) {
      try {
        const res = await fetch(`https://www.tiktok.com/@${username}`, { credentials: 'include' });
        if (res.ok) {
          const html = await res.text();
          // Extract title (usually contains name)
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) {
            const t = titleMatch[1].split('|')[0].trim();
            if (t && t.length < 50 && !/TikTok/i.test(t)) displayName = t;
          }
          // Extract followers count from meta description or script
          const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
          if (descMatch) {
            const desc = descMatch[1];
            const fol = desc.match(/([\d.,]+\s*[kKmMbB]?)\s*Followers/i);
            if (fol) followersCount = parseMetricNumber(fol[1]);
          }
          if (followersCount == null) {
            const folMatch = html.match(/"followerCount":(\d+)/);
            if (folMatch) followersCount = parseInt(folMatch[1], 10);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch TikTok profile metrics:', e);
      }
    }
    
    if (followersCount == null) {
      const followersEl = document.querySelector('[data-e2e="followers-count"]');
      if (followersEl) {
        followersCount = parseMetricNumber(followersEl.textContent || '');
      } else {
        const match = (document.body ? document.body.innerText : '').match(/([\d.,]+\s*[kKmM]?)\s*(?:followers|người theo dõi|Follower)/i);
        if (match) followersCount = parseMetricNumber(match[1]);
      }
    }

    if (!username) {
      throw new Error(`Không nhận diện được username TikTok. Hãy kiểm tra tài khoản đã đăng nhập.`);
    }

    chrome.runtime.sendMessage({
      action: 'socialAccountsScannerResult',
      accounts: [{
        platform: 'tiktok',
        social_uid: username,
        social_username: username,
        social_name: displayName || username,
        followers_count: followersCount
      }]
    });
  } catch (error) {
    console.error('[Moigioi] TikTok account scan failed:', error);
    chrome.runtime.sendMessage({
      action: 'socialAccountsScannerResult',
      accounts: [],
      error: error?.message || 'Không quét được tài khoản TikTok'
    });
  }
})();
