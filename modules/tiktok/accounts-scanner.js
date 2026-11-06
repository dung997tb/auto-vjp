// Quét tài khoản TikTok đang đăng nhập
// (2.11.11) Vá 2 lớp hỏng của bản cũ: (a) gửi kết quả bằng sendMessage THÔ
// không kèm scanId -> kernel bỏ kết quả, run treo tới timeout; nay báo qua
// accountScanUtils.sendDiscovery(context, ...) như IG/Threads. (b) Nhận diện
// username chỉ dựa vào sự kiện reply-inspect của reply-bridge — bridge không
// được inject trong task quét nên vòng lặp 30 lần đó vô ích; nay nhận diện đa
// nguồn: reply-inspect (thử ngắn, phòng khi bridge có mặt) -> anchor hồ sơ
// của chính mình trong nav/header/sidebar -> dữ liệu rehydration. Mọi đường
// thoát đều gửi đúng 1 lần, kể cả khi lỗi — không treo im lặng.
(async function() {
  const context = globalThis.__accountScanContext;
  const utils = globalThis.accountScanUtils;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalizeUsername = value => String(value || '').trim().replace(/^@|\/$/g, '');
  const validUsername = value => {
    const username = normalizeUsername(value);
    return /^[a-zA-Z0-9_.-]{2,24}$/.test(username);
  };

  /* PURE-START: rankProfileCandidates */
  // Hàm thuần (harness test riêng được): xếp hạng ứng viên username từ danh
  // sách mô tả anchor {username, inNav, hasAvatar, e2eHit}. Điểm: nằm trong
  // vùng nav/header/sidebar +5, data-e2e nhắc tới profile/avatar/user +4, có
  // img avatar +3. Hoà điểm thì ưu tiên ứng viên trong nav, rồi thứ tự gặp.
  function rankProfileCandidates(candidates) {
    const reserved = new Set(['foryou', 'explore', 'live', 'following', 'friends', 'messages', 'setting', 'settings', 'search', 'discover', 'upload', 'tiktokstudio']);
    let best = null;
    for (const c of candidates || []) {
      const username = String(c?.username || '').trim().replace(/^@/, '');
      if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(username)) continue;
      if (reserved.has(username.toLowerCase())) continue;
      const score = (c.inNav ? 5 : 0) + (c.e2eHit ? 4 : 0) + (c.hasAvatar ? 3 : 0);
      if (!best || score > best.score || (score === best.score && c.inNav && !best.inNav)) {
        best = { username, score, inNav: Boolean(c.inNav) };
      }
    }
    return best ? best.username : '';
  }
  /* PURE-END */

  // Nguồn 1: reply-inspect — chỉ còn là đường phụ thử ngắn (bridge thường
  // không có mặt trong task quét), tối đa 4 lần cách 400ms như thiết kế mới.
  async function usernameFromReplyInspect() {
    for (let attempt = 0; attempt < 4; attempt++) {
      document.dispatchEvent(new Event('mut-tiktok-reply-inspect'));
      try {
        const ctx = JSON.parse(document.documentElement.getAttribute('data-mut-tiktok-reply-context') || '{}');
        if (validUsername(ctx.actor)) return normalizeUsername(ctx.actor);
      } catch (_) {}
      if (attempt < 3) await sleep(400);
    }
    return '';
  }

  // Nguồn 2: anchor /@username trong DOM — chấm điểm để phân biệt liên kết
  // "Trang cá nhân" của chính mình (trong nav/sidebar) với tác giả video
  // trên feed (cũng là /@username nhưng không nằm trong vùng điều hướng).
  function collectAnchorCandidates() {
    const out = [];
    for (const anchor of document.querySelectorAll('a[href^="/@"]')) {
      const href = String(anchor.getAttribute('href') || '').split(/[?#]/)[0];
      const match = href.match(/^\/@([A-Za-z0-9_.-]{2,24})\/?$/);
      if (!match) continue;
      const e2eOwner = anchor.hasAttribute('data-e2e') ? anchor : anchor.querySelector('[data-e2e]');
      const e2eText = `${anchor.getAttribute('data-e2e') || ''} ${e2eOwner?.getAttribute('data-e2e') || ''}`;
      out.push({
        username: match[1],
        inNav: Boolean(anchor.closest('nav, header, aside, [class*="idebar"], [data-e2e="nav-bar"]')),
        hasAvatar: Boolean(anchor.querySelector('img')),
        e2eHit: /profile|avatar|user/i.test(e2eText)
      });
    }
    return out;
  }

  // Nguồn 3: script#__UNIVERSAL_DATA_FOR_REHYDRATION__ — chỉ nhận uniqueId
  // nằm trong nhánh appContext hoặc dưới key user/userInfo, và chỉ khi toàn
  // bộ các nhánh đó cho đúng 1 uniqueId (khác nhau = mơ hồ, bỏ nguồn này).
  // Không lấy uniqueId của tác giả video ở các nhánh nội dung khác.
  function usernameFromRehydration() {
    const el = document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el?.textContent) return '';
    let data;
    try { data = JSON.parse(el.textContent); } catch (_) { return ''; }
    const found = new Set();
    const walk = (node, path, depth) => {
      if (!node || typeof node !== 'object' || depth > 12) return;
      if (typeof node.uniqueId === 'string') {
        const inScope = path.some(key => {
          const norm = String(key).toLowerCase().replace(/[-_]/g, '');
          return norm.includes('appcontext') || key === 'user' || key === 'userInfo';
        });
        if (inScope && validUsername(node.uniqueId)) found.add(normalizeUsername(node.uniqueId));
      }
      for (const [key, child] of Object.entries(node)) walk(child, [...path, key], depth + 1);
    };
    walk(data, [], 0);
    return found.size === 1 ? [...found][0] : '';
  }

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

  let reported = false;
  const report = payload => {
    if (reported) return;
    reported = true;
    return utils.sendDiscovery(context, payload);
  };

  try {
    await sleep(1500);

    let username = await usernameFromReplyInspect();
    if (!username) {
      // Nguồn 2 + 3 chạy trong cửa sổ chờ còn lại (tổng nhận diện ~20 giây
      // kể cả nguồn 1) — trang SPA cần thời gian render sidebar.
      const deadline = Date.now() + 14000;
      while (!username && Date.now() < deadline) {
        username = rankProfileCandidates(collectAnchorCandidates());
        if (!username) username = usernameFromRehydration();
        if (!username) await sleep(700);
      }
    }

    if (!username) {
      report({ accounts: [], error: 'Không nhận diện được username TikTok (chưa đăng nhập hoặc giao diện TikTok đã đổi)' });
      return;
    }

    let displayName = '';
    let followersCount = null;

    // Fetch trang cá nhân để lấy đúng follower count (giữ nguyên bản cũ)
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

    if (followersCount == null) {
      const followersEl = document.querySelector('[data-e2e="followers-count"]');
      if (followersEl) {
        followersCount = parseMetricNumber(followersEl.textContent || '');
      } else {
        const match = (document.body ? document.body.innerText : '').match(/([\d.,]+\s*[kKmM]?)\s*(?:followers|người theo dõi|Follower)/i);
        if (match) followersCount = parseMetricNumber(match[1]);
      }
    }

    report({
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
    report({ accounts: [], error: error?.message || 'Không quét được tài khoản TikTok' });
  }
})();
