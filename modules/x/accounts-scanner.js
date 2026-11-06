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

    // Lớp 0 (2.11.11): API phiên đăng nhập của chính X — settings.json trả
    // screen_name của tài khoản đang đăng nhập, ổn định hơn dò DOM (bản cũ
    // chỉ dò DOM nên giao diện X đổi là ra 0 nick). Lỗi/timeout thì rơi
    // xuống các lớp DOM bên dưới như cũ.
    try {
      const res = await fetch('https://x.com/i/api/1.1/account/settings.json', {
        credentials: 'include',
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json.screen_name === 'string' && json.screen_name) {
          username = json.screen_name;
          name = clean(json.name || '');
        }
      }
    } catch (_) { /* API lỗi -> dò DOM như cũ */ }

    for (let attempt = 0; attempt < 10 && !username; attempt++) {
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

    // Lớp 0 có username nhưng chưa có tên hiển thị: thử AccountSwitcher 1 lần.
    if (username && !name) {
      const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      if (switcher) {
        const lines = (switcher.innerText || '').split('\n').map(clean).filter(Boolean);
        const candidate = lines.find(l => !l.startsWith('@') && l.toLowerCase() !== username.toLowerCase());
        if (candidate) name = candidate;
      }
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
  // (2.11.11) Kết thúc rỗng PHẢI kèm error: bản cũ gửi accounts rỗng không
  // error khiến kernel ghi success "Quét được 0 tài khoản" gây hiểu nhầm.
  // Mọi đường thoát đều gửi đúng 1 lần qua sendDiscovery kèm context.
  if (accounts.length) {
    scanUtils.sendDiscovery(scanContext, { action: 'socialAccountsScannerResult', type: 'discovery', accounts: accounts });
  } else {
    scanUtils.sendDiscovery(scanContext, { action: 'socialAccountsScannerResult', type: 'discovery', accounts: [], error: 'Không nhận diện được tài khoản X (chưa đăng nhập hoặc giao diện X đã đổi)' });
  }
})();
