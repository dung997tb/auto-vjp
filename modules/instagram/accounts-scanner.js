// Quét tài khoản Instagram đang đăng nhập — hỗ trợ giao diện Việt/Anh và UI mới.
(async function() {
  const scanContext = globalThis.__accountScanContext;
  const scanUtils = globalThis.accountScanUtils;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalizeUsername = value => String(value || '').trim().replace(/^@|\/$/g, '');
  const blockedRoutes = new Set([
    'accounts', 'direct', 'explore', 'reels', 'reel', 'p', 'stories', 'about',
    'developer', 'legal', 'privacy', 'web', 'challenge', 'emails'
  ]);
  const validUsername = value => {
    const username = normalizeUsername(value);
    return /^[a-zA-Z0-9._]{1,30}$/.test(username) && !blockedRoutes.has(username.toLowerCase());
  };

  let username = '';
  let displayName = '';
  let diagnostic = '';

  try {
    await sleep(2500);

    // Lớp 1: endpoint cùng origin ổn định hơn selector giao diện.
    try {
      const response = await fetch('/api/v1/accounts/edit/web_form_data/', {
        credentials: 'include',
        headers: { 'X-IG-App-ID': '936619743392459' }
      });
      if (response.ok) {
        const json = await response.json();
        const form = json?.form_data || json?.data || json || {};
        if (validUsername(form.username)) {
          username = normalizeUsername(form.username);
          displayName = String(form.first_name || form.full_name || '').trim();
        }
      } else {
        diagnostic = `API ${response.status}`;
      }
    } catch (error) {
      diagnostic = `API: ${error?.message || 'không đọc được'}`;
    }

    // Lớp 2: nút Trang cá nhân/Profile trong thanh điều hướng.
    if (!username) {
      const anchors = Array.from(document.querySelectorAll('a[href^="/"]'));
      const scored = anchors.map(anchor => {
        const match = (anchor.getAttribute('href') || '').match(/^\/([a-zA-Z0-9._]+)\/?(?:[?#].*)?$/);
        const candidate = match?.[1] || '';
        if (!validUsername(candidate)) return null;
        const descriptor = [
          anchor.getAttribute('aria-label'), anchor.getAttribute('title'), anchor.innerText,
          ...Array.from(anchor.querySelectorAll('img')).map(img => img.getAttribute('alt')),
          ...Array.from(anchor.querySelectorAll('svg')).map(svg => svg.getAttribute('aria-label'))
        ].filter(Boolean).join(' ').toLowerCase();
        let score = 0;
        if (/trang cá nhân|profile|hồ sơ/.test(descriptor)) score += 10;
        if (/ảnh đại diện|profile picture|avatar/.test(descriptor)) score += 8;
        if (anchor.querySelector('img')) score += 3;
        if (anchor.closest('nav')) score += 2;
        return { candidate, descriptor, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score);

      if (scored[0]?.score >= 3) {
        username = normalizeUsername(scored[0].candidate);
        const text = scored[0].descriptor.replace(/trang cá nhân|profile|hồ sơ|ảnh đại diện|profile picture|avatar/gi, '').trim();
        if (text && text.length <= 100) displayName = text;
      }
    }

    // Lớp 3: dữ liệu bootstrap của chính tài khoản đăng nhập.
    if (!username) {
      const html = document.documentElement.innerHTML;
      const patterns = [
        /"viewer"\s*:\s*\{[^{}]{0,3000}?"username"\s*:\s*"([a-zA-Z0-9._]+)"/,
        /"current_user"\s*:\s*\{[^{}]{0,3000}?"username"\s*:\s*"([a-zA-Z0-9._]+)"/,
        /"username"\s*:\s*"([a-zA-Z0-9._]+)"[^{}]{0,1000}?"is_business_account"/
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && validUsername(match[1])) { username = normalizeUsername(match[1]); break; }
      }
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

    const metaDesc = document.querySelector('meta[property="og:description"]');
    if (metaDesc) {
      const match = (metaDesc.getAttribute('content') || '').match(/([\d.,]+\s*[kKmM]?)\s*(?:Followers|Follower|người theo dõi)/i);
      if (match) followersCount = parseMetricNumber(match[1]);
    }
    if (!followersCount) {
      const match = (document.body ? document.body.innerText : '').match(/([\d.,]+\s*[kKmM]?)\s*(?:followers|người theo dõi|Follower)/i);
      if (match) followersCount = parseMetricNumber(match[1]);
    }

    if (!username) {
      throw new Error(`Không nhận diện được username Instagram${diagnostic ? ` (${diagnostic})` : ''}. Hãy kiểm tra tài khoản đã đăng nhập.`);
    }

    scanUtils.sendDiscovery(scanContext, {
      action: 'socialAccountsScannerResult',
      type: 'discovery',
      accounts: [{
        platform: 'instagram',
        social_uid: username,
        social_username: username,
        social_name: displayName || username,
        followers_count: followersCount
      }]
    });
  } catch (error) {
    console.error('[Moigioi] Instagram account scan failed:', error);
    scanUtils.sendDiscovery(scanContext, {
      action: 'socialAccountsScannerResult',
      type: 'discovery',
      accounts: [],
      error: error?.message || 'Không quét được tài khoản Instagram'
    });
  }
})();
