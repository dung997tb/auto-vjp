// Quét tài khoản TikTok đang đăng nhập
// (2.11.11) Vá 2 lớp hỏng của bản cũ: (a) gửi kết quả bằng sendMessage THÔ
// không kèm scanId -> kernel bỏ kết quả, run treo tới timeout; nay báo qua
// accountScanUtils.sendDiscovery(context, ...) như IG/Threads. (b) Nhận diện
// username chỉ dựa vào sự kiện reply-inspect của reply-bridge — bridge không
// được inject trong task quét nên vòng lặp 30 lần đó vô ích; nay nhận diện đa
// nguồn: reply-inspect (thử ngắn, phòng khi bridge có mặt) -> dữ liệu
// rehydration (nguồn định danh chắc nhất, thử trước) -> anchor hồ sơ của
// chính mình trong nav/header/sidebar (dự phòng). Mọi đường thoát đều gửi
// đúng 1 lần, kể cả khi lỗi — không treo im lặng.
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
  // sách mô tả anchor {username, inNav, hasAvatar, e2eHit, e2e}. Điểm: nằm
  // trong vùng nav/header/sidebar +5, data-e2e chứa 'nav' (vd nav-profile)
  // +5 — tín hiệu ngang inNav vì selector vùng nav của TikTok không phải lúc
  // nào cũng khớp container sidebar thật, data-e2e nhắc tới profile/avatar/
  // user +4, có img avatar +3. LOẠI HẲN ứng viên mà e2e (anchor hoặc tổ tiên
  // gần [data-e2e]) chứa 'video-author', 'cinema-creator' hoặc 'inbox': đó
  // là tác giả video trên feed / người nhắn tin, không bao giờ là mình — bản
  // cũ cho video-author-avatar +4 (chứa 'avatar') +3 (img) = 7, ngang điểm
  // anchor hồ sơ thật nên có rủi ro nhận nhầm tác giả video. Hoà điểm thì
  // ưu tiên ứng viên trong nav, rồi thứ tự gặp.
  function rankProfileCandidates(candidates) {
    const reserved = new Set(['foryou', 'explore', 'live', 'following', 'friends', 'messages', 'setting', 'settings', 'search', 'discover', 'upload', 'tiktokstudio']);
    let best = null;
    for (const c of candidates || []) {
      const username = String(c?.username || '').trim().replace(/^@/, '');
      if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(username)) continue;
      if (reserved.has(username.toLowerCase())) continue;
      // e2e gộp: ưu tiên trường e2e/e2eText mới, tương thích ngược e2eHit cũ.
      const e2eText = String(c.e2e || c.e2eText || '').toLowerCase();
      if (e2eText.includes('video-author') || e2eText.includes('cinema-creator') || e2eText.includes('inbox')) continue;
      const navHit = e2eText.includes('nav');
      const e2eHit = Boolean(c.e2eHit) || /profile|avatar|user/.test(e2eText);
      const score = (c.inNav ? 5 : 0) + (navHit ? 5 : 0) + (e2eHit ? 4 : 0) + (c.hasAvatar ? 3 : 0);
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
      } catch (_) { console.debug("[Auto vjp][accounts-scanner] bỏ qua lỗi:", _); }
      if (attempt < 3) await sleep(400);
    }
    return '';
  }

  // Nguồn 2: anchor /@username trong DOM — chấm điểm để phân biệt liên kết
  // "Trang cá nhân" của chính mình (trong nav/sidebar) với tác giả video
  // trên feed (cũng là /@username nhưng không nằm trong vùng điều hướng).
  // e2e gộp đủ 3 chỗ: chính anchor, phần tử con mang [data-e2e], và tổ tiên
  // gần nhất mang [data-e2e] qua closest('[data-e2e]') — để hàm chấm điểm
  // thấy cả 'nav-profile' lẫn các mẫu cần loại ('video-author'...).
  function collectAnchorCandidates() {
    const out = [];
    for (const anchor of document.querySelectorAll('a[href^="/@"]')) {
      const href = String(anchor.getAttribute('href') || '').split(/[?#]/)[0];
      const match = href.match(/^\/@([A-Za-z0-9_.-]{2,24})\/?$/);
      if (!match) continue;
      const e2eOwner = anchor.hasAttribute('data-e2e') ? anchor : anchor.querySelector('[data-e2e]');
      const e2eAncestor = anchor.closest('[data-e2e]');
      const e2eText = `${anchor.getAttribute('data-e2e') || ''} ${e2eOwner?.getAttribute('data-e2e') || ''} ${e2eAncestor?.getAttribute('data-e2e') || ''}`;
      out.push({
        username: match[1],
        inNav: Boolean(anchor.closest('nav, header, aside, [class*="idebar"], [data-e2e="nav-bar"]')),
        hasAvatar: Boolean(anchor.querySelector('img')),
        e2eHit: /profile|avatar|user/i.test(e2eText),
        e2e: e2eText
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

  // (2.11.15) parseMetricNumber dùng chung AVJP.metrics
  // (modules/shared/metrics.js, contract nạp trước scanner này) — bản sao
  // cục bộ ở đây đọc sai định dạng Việt nên đã xoá.

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
      // Chốt chặn tự cứu: nếu đang ở trang gốc '/' mà tài liệu trông RỖNG
      // (không anchor hồ sơ, không script rehydration, body gần như không
      // có chữ) thì đây là trang gốc headless không render app — quét tiếp
      // chỉ fail oan. Tự chuyển sang /foryou rồi KẾT THÚC instance này
      // KHÔNG gửi báo cáo: kernel sẽ inject instance mới trên URL mới vì
      // key guard inject gắn theo URL, instance mới quét và báo cáo như
      // thường. Rủi ro đã cân: nếu inject lại không xảy ra, run sẽ kết
      // thúc uncertain bởi watchdog thay vì failed — chấp nhận được so
      // với fail oan trên trang rỗng. Chỉ áp dụng đúng 1 lần cho
      // pathname '/' — đang ở /foryou hay trang khác thì giữ nguyên luồng.
      const looksEmpty = !document.querySelector('a[href^="/@"]')
        && !document.querySelector('script#__UNIVERSAL_DATA_FOR_REHYDRATION__')
        && (document.body?.innerText || '').trim().length < 50;
      if (looksEmpty && location.pathname === '/') {
        location.replace('https://www.tiktok.com/foryou');
        return;
      }
      // Nguồn 3 (rehydration) thử TRƯỚC, nguồn 2 (anchor) dự phòng sau:
      // rehydration ở nhánh app-context > user là tín hiệu định danh chắc
      // nhất (đúng 1 uniqueId của chính mình), anchor chỉ là heuristic DOM
      // có thể nhầm tác giả video. Ngân sách 30 giây (trước 14 giây) vì
      // trang lạnh render sidebar/rehydration chậm — lần quét lạnh trên nuc
      // đã fail oan dù đăng nhập sẵn. Reply-inspect ở trên giữ nguyên ngắn.
      const deadline = Date.now() + 30000;
      while (!username && Date.now() < deadline) {
        username = usernameFromRehydration();
        if (!username) username = rankProfileCandidates(collectAnchorCandidates());
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
          if (fol) followersCount = AVJP.metrics.parseMetricNumber(fol[1]);
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
        followersCount = AVJP.metrics.parseMetricNumber(followersEl.textContent || '');
      } else {
        const match = (document.body ? document.body.innerText : '').match(/([\d.,]+\s*[kKmM]?)\s*(?:followers|người theo dõi|Follower)/i);
        if (match) followersCount = AVJP.metrics.parseMetricNumber(match[1]);
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
