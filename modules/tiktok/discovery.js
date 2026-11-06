// Kịch bản quét tài khoản TikTok - Phase 1 (Discovery)
(async function() {
  const scanContext = globalThis.__accountScanContext;
  const scanUtils = globalThis.accountScanUtils;
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

    for (let attempt = 0; attempt < 30 && !username; attempt++) {
      document.dispatchEvent(new Event('mut-tiktok-reply-inspect'));
      try {
        const context = JSON.parse(document.documentElement.getAttribute('data-mut-tiktok-reply-context') || '{}');
        if (validUsername(context.actor)) username = normalizeUsername(context.actor);
      } catch {}
      if (!username) {
        // Fallback: check DOM elements that might contain the username
        const profileLink = document.querySelector('a[href^="/@"]');
        if (profileLink) {
           const href = profileLink.getAttribute('href');
           const match = href.match(/^\/@([a-zA-Z0-9_.-]+)/);
           if (match && validUsername(match[1])) username = normalizeUsername(match[1]);
        }
      }
      if (!username) await sleep(500);
    }

    if (!username) {
      throw new Error(`Không nhận diện được username TikTok. Hãy kiểm tra tài khoản đã đăng nhập.`);
    }

    scanUtils.sendDiscovery(scanContext, {
      action: 'socialAccountsScannerResult',
      type: 'discovery',
      accounts: [{
        platform: 'tiktok',
        social_uid: username,
        social_username: username,
        social_name: username
      }]
    });
  } catch (error) {
    console.error('[Moigioi] TikTok account scan failed:', error);
    scanUtils.sendDiscovery(scanContext, {
      action: 'socialAccountsScannerResult',
      type: 'discovery',
      accounts: [],
      error: error?.message || 'Không quét được tài khoản TikTok'
    });
  }
})();
