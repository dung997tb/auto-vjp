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
  /* PURE-START: parseSwitcherChannelsFromHtml */
  // Hàm thuần (harness test riêng được): trích danh sách kênh từ HTML trang
  // channel_switcher — tìm mọi "channelId":"UC..." (thường nằm trong
  // ytInitialData) rồi lấy tên kênh (accountName/title) + handle
  // (accountBylineText) trong cửa sổ ±700 ký tự quanh đó. Khử trùng theo
  // channelId; mục không tìm được tên thì bỏ (không bịa ID từ tên hiển thị).
  function parseSwitcherChannelsFromHtml(html) {
    const found = new Map();
    const src = String(html || '');
    const idRe = /"channelId"\s*:\s*"(UC[\w-]{22})"/g;
    const unquote = raw => { try { return JSON.parse(`"${raw}"`); } catch (_) { return raw; } };
    const handleOfRaw = value => {
      const h = String(value || '').trim();
      return /^@[^\s/@]+$/.test(h) ? h.slice(1) : '';
    };
    let m;
    while ((m = idRe.exec(src)) !== null) {
      const id = m[1];
      if (found.has(id)) continue;
      const win = src.slice(Math.max(0, m.index - 700), m.index + 700);
      const nameMatch = win.match(/"accountName"\s*:\s*\{\s*"simpleText"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        || win.match(/"title"\s*:\s*\{\s*"simpleText"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        || win.match(/"title"\s*:\s*\{\s*"runs"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        || win.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const name = nameMatch ? String(unquote(nameMatch[1]) || '').trim() : '';
      if (!name || /removed|bị xóa|bị khóa|disabled|suspended/i.test(name)) continue;
      let handle = '';
      const bylineMatch = win.match(/"accountBylineText"\s*:\s*\{\s*"simpleText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (bylineMatch) handle = handleOfRaw(String(unquote(bylineMatch[1]) || '').split(/[•·]/)[0]);
      if (!handle) {
        const rawHandle = win.match(/"(@[\w.-]{2,30})"/);
        if (rawHandle) handle = handleOfRaw(rawHandle[1]);
      }
      found.set(id, { platform: 'youtube', social_uid: id, social_username: handle || null,
        social_name: name, followers_count: null, subscribers_count: null });
    }
    return [...found.values()];
  }
  /* PURE-END */
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
  // Dự phòng (2.11.11): DOM không cho kết quả (không ở đúng trang switcher
  // hoặc UI đổi) -> fetch thẳng trang channel_switcher bằng phiên đăng nhập
  // và parse ytInitialData trong HTML. Bị đá sang accounts.google.com =
  // chưa đăng nhập, báo error riêng để phân biệt với tài khoản chưa có kênh.
  let fallbackError = '';
  if (!accounts.length) {
    try {
      const res = await fetch('https://www.youtube.com/channel_switcher', { credentials: 'include' });
      if (/accounts\.google\.com/.test(res.url || '')) {
        fallbackError = 'Chưa đăng nhập YouTube (trang quét bị chuyển sang đăng nhập Google).';
      } else if (res.ok) {
        accounts = parseSwitcherChannelsFromHtml(await res.text());
      }
    } catch (_) { /* fetch lỗi -> giữ error mặc định bên dưới */ }
  }
  await utils.sendDiscovery(context, { accounts, ...(!accounts.length ? { error: fallbackError || 'Tài khoản YouTube chưa có kênh.' } : {}) });
})();
