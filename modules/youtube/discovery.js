// The channel switcher loads account rows after ytInitialData. Observe those
// rows as well as embedded data; never manufacture an ID from a display name.
// 2.6.1: also read the CURRENT identity from the account-menu header
// (ytd-active-account-header-renderer). Its #channel-handle exists only when
// the signed-in Google account actually owns a YouTube channel — an account
// without a channel shows a "Create channel" button instead, and must not be
// reported as a YouTube account.
(async function() {
  const context = globalThis.__accountScanContext;
  const utils = globalThis.accountScanUtils;
  const clean = value => String(value || '').trim();
  const text = value => value?.simpleText || value?.runs?.map(run => run.text || '').join('') || '';
  const handleOf = value => /^@[^\s/@]+$/u.test(clean(value)) ? clean(value).slice(1) : '';
  const channelId = value => /^UC[\w-]{22}$/.test(value || '') ? value : '';
  const metric = value => /không có người đăng ký|no subscribers?/i.test(value) ? 0 : utils.parseMetric(value);
  // Open the account menu once so the header renderer (with #channel-handle)
  // exists in the DOM for read() to pick up; skip if it is already rendered.
  if (!document.querySelector('ytd-active-account-header-renderer #channel-handle')) {
    try { document.querySelector('#avatar-btn, button#avatar-btn')?.click(); } catch (_) {}
  }
  function read() {
    const accounts = new Map();
    const add = (name, id, handle, count) => {
      const uid = channelId(id) || handle;
      if (!uid || !name) return;
      const key = (handle || uid).toLowerCase();
      const existing = accounts.get(key);
      accounts.set(key, { platform: 'youtube', social_uid: channelId(existing?.social_uid) || uid,
        social_username: handle || existing?.social_username || null, social_name: name,
        followers_count: count ?? existing?.followers_count ?? null,
        subscribers_count: count ?? existing?.subscribers_count ?? null });
    };
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      const item = value.accountItemRenderer;
      if (item && !item.isDisabled && !item.isSuspended) {
        const byline = text(item.accountBylineText);
        if (!/removed|bị xóa|bị khóa|disabled|suspended/i.test(byline)) {
          add(text(item.accountName), item.channelId || item.navigationEndpoint?.browseEndpoint?.browseId,
            handleOf(byline), metric(text(item.subscriberCountText) || (/no subscribers?|không có người đăng ký/i.test(byline) ? byline : '')));
        }
      }
      for (const child of Object.values(value)) visit(child);
    }
    for (const script of document.scripts) {
      const match = script.textContent.match(/(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (match) { try { visit(JSON.parse(match[1])); } catch (_) {} }
    }
    // Current identity (2.6.1): the account-menu header is authoritative for
    // the signed-in account — name from #account-name, owned channel handle
    // from #channel-handle. No #channel-handle = account has no channel, so
    // nothing is added for the current identity (switcher rows still apply).
    const header = document.querySelector('ytd-active-account-header-renderer');
    if (header) {
      const curName = clean(header.querySelector('#account-name')?.textContent);
      const curHandle = handleOf(clean(header.querySelector('#channel-handle')?.textContent));
      if (curName && curHandle) add(curName, '', curHandle, null);
    }
    for (const row of document.querySelectorAll('ytd-account-item-renderer')) {
      if (row.querySelector('[aria-disabled="true"]')) continue;
      const name = clean(row.querySelector('#channel-title')?.textContent);
      const lines = [...row.querySelectorAll('yt-formatted-string')].map(el => clean(el.textContent));
      if (lines.some(line => /removed|bị xóa|bị khóa|disabled|suspended/i.test(line))) continue;
      const handle = lines.map(handleOf).find(Boolean) || '';
      const id = row.querySelector('a[href*="/channel/"]')?.getAttribute('href')?.match(/\/channel\/(UC[\w-]+)/)?.[1];
      const countText = lines.find(line => /subscribers?|người đăng ký/i.test(line)) || '';
      add(name, id, handle, metric(countText));
    }
    return [...accounts.values()];
  }
  let accounts = [], previous = '', stable = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    accounts = read();
    const key = JSON.stringify(accounts);
    stable = accounts.length && key === previous ? stable + 1 : 0;
    if (stable >= 3) break;
    previous = key;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await utils.sendDiscovery(context, { accounts, ...(!accounts.length ? { error: 'Tài khoản YouTube chưa có kênh.' } : {}) });
})();
