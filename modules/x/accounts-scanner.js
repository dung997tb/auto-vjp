// Kịch bản quét Profile X (Twitter)
(async function() {
  const scanContext = globalThis.__accountScanContext;
  const scanUtils = globalThis.accountScanUtils;
  let accounts = [];
  try {
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

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    let username = '';
    let name = '';
    let followersCount = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      // 1. Kiểm tra nếu đang mở trang cá nhân của mình
      const pathMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (pathMatch && !['home', 'explore', 'notifications', 'messages', 'i', 'settings'].includes(pathMatch[1].toLowerCase())) {
        username = pathMatch[1];
      }

      // 2. Tìm link Profile ở sidebar navigation
      if (!username) {
        const sideAccount = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        if (sideAccount) {
          const href = sideAccount.getAttribute('href') || '';
          username = href.replace('/', '').split('?')[0];
        }
      }

      // 3. Tìm username trong AccountSwitcher
      if (!username) {
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (switcher) {
          const text = switcher.innerText || '';
          const m = text.match(/@([A-Za-z0-9_]{1,15})/);
          if (m) username = m[1];
        }
      }

      if (username) {
        // Tìm tên hiển thị
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (switcher) {
          const lines = (switcher.innerText || '').split('\n').map(clean).filter(Boolean);
          const candidate = lines.find(l => !l.startsWith('@') && l.toLowerCase() !== username.toLowerCase());
          if (candidate) name = candidate;
        }

        if (!name && document.title) {
          const titleName = document.title
            .replace(/^\(\d+\+?\)\s*/, '')
            .replace(/\s*\(@[A-Za-z0-9_]+\).*$/i, '')
            .replace(/\s*\/.*$/i, '')
            .trim();
          if (titleName && !/^(x|twitter)$/i.test(titleName)) name = titleName;
        }

        const pageText = document.body ? document.body.innerText : '';
        const xMatch = pageText.match(/([\d.,]+\s*[kKmM]?)\s*(?:followers|người theo dõi|Follower)/i);
        if (xMatch) followersCount = parseMetricNumber(xMatch[1]);
        break;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    if (username) {
      accounts.push({
        platform: 'x',
        social_uid: username,
        social_username: username,
        social_name: (name || username) + ' (X)',
        followers_count: followersCount
      });
    }
  } catch(e) {
    console.warn('[X Scanner] Lỗi quét profile:', e);
  }
  scanUtils.sendDiscovery(scanContext, { action: 'socialAccountsScannerResult', type: 'discovery', accounts: accounts });
})();
