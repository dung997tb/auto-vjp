// Kịch bản làm giàu dữ liệu TikTok - Phase 2 (Enrichment)
(async function() {
  const context = globalThis.__accountScanContext;
  const utils = globalThis.accountScanUtils;
  const sendScanResult = message => utils.send(context, message);
  
  const parseMetricNumber = value => utils.parseMetric(value);

  try {
    function readProfile() {
    
    let displayName = '';
    let followersCount = null;
    let socialUid = null;
    const username = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, '');

    const profileHeading = document.querySelector('[data-e2e="user-title"], h1');
    displayName = String(profileHeading?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!displayName) {
      const titleMatch = document.title.split('|')[0].replace(/\s*\(@[^)]+\)\s*$/i, '').trim();
      if (titleMatch && titleMatch.length < 80 && !/^TikTok$/i.test(titleMatch)) displayName = titleMatch;
    }
    
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl) {
      const desc = descEl.getAttribute('content') || '';
      const fol = desc.match(/([\d.,]+\s*[kKmMbB]?)\s*Followers/i);
      if (fol) followersCount = parseMetricNumber(fol[1]);
    }
    
    if (followersCount == null) {
      const followersEl = document.querySelector('[data-e2e="followers-count"]');
      if (followersEl) {
        followersCount = parseMetricNumber(followersEl.textContent || '');
      }
    }

    if (username) {
      const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`"id":"(\\d+)"[^{}]{0,1500}"uniqueId":"${escaped}"`, 'i'),
        new RegExp(`"uniqueId":"${escaped}"[^{}]{0,1500}"id":"(\\d+)"`, 'i')
      ];
      const html = document.documentElement.innerHTML;
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) { socialUid = match[1]; break; }
      }
    }

    return {
      social_uid: socialUid || undefined,
      social_username: username || undefined,
      social_name: displayName,
      followers_count: followersCount
    };
    }
    const data = await utils.waitForMetrics(readProfile);
    sendScanResult({ data });
  } catch (error) {
    console.error('[Moigioi] TikTok account enrichment failed:', error);
    sendScanResult({
      action: 'socialAccountsScannerResult',
      type: 'enrichment',
      data: {},
      error: error?.message || 'Không quét được profile TikTok'
    });
  }
})();
