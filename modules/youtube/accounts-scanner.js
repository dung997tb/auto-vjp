// ─── YouTube Account Scanner ───
(async function () {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function parseMetricNumber(str) {
    if (str === null || str === undefined) return null;
    const clean = String(str).trim().toLowerCase().replace(/\s/g, '');
    if (/no subscribers|không có người đăng ký|0 subscriber|0 người đăng ký|no subscriber/i.test(clean)) return 0;
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

  function dispatchSimulatedClick(el) {
    if (!el) return;
    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', opts));
    } catch (e) {
      if (typeof el.click === 'function') el.click();
    }
  }

  function querySelectorDeep(selector, root = document.body || document) {
    if (!root) return null;
    let el = root.querySelector ? root.querySelector(selector) : null;
    if (el) return el;
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const element of elements) {
      if (element.shadowRoot) {
        el = querySelectorDeep(selector, element.shadowRoot);
        if (el) return el;
      }
    }
    return null;
  }

  function querySelectorAllDeep(selector, root = document.body || document, results = []) {
    if (!root) return results;
    if (root.querySelectorAll) {
      try {
        root.querySelectorAll(selector).forEach(el => results.push(el));
      } catch (_) {}
    }
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const element of elements) {
      if (element.shadowRoot) {
        querySelectorAllDeep(selector, element.shadowRoot, results);
      }
    }
    return results;
  }

  function getAllTextDeep(root = document.body || document) {
    let text = '';
    if (!root) return text;
    if (root.innerText) text += root.innerText + ' ';
    else if (root.textContent) text += root.textContent + ' ';
    const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const element of elements) {
      if (element.shadowRoot) {
        text += getAllTextDeep(element.shadowRoot) + ' ';
      }
    }
    return text;
  }

  // Strategy 1: Parse ytInitialData or channel_switcher DOM directly on current page
  function getAccountsFromYtInitialData() {
    const accounts = [];
    const seenUids = new Set();

    let data = window.ytInitialData;
    if (!data) {
      try {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const txt = s.textContent || '';
          if (txt.includes('ytInitialData')) {
            const match = txt.match(/ytInitialData\s*=\s*({[\s\S]*?});/) || txt.match(/window\["ytInitialData"\]\s*=\s*({[\s\S]*?});/);
            if (match && match[1]) {
              data = JSON.parse(match[1]);
              break;
            }
          }
        }
      } catch (e) {}
    }

    if (data) {
      function traverse(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.accountItemRenderer) {
          const item = obj.accountItemRenderer;
          const byline = JSON.stringify(item.accountBylineText || {}).toLowerCase();
          const nameObj = JSON.stringify(item.accountName || {}).toLowerCase();
          const isDisabled = Boolean(item.isDisabled || item.isSuspended);
          const isRemoved = isDisabled || 
                            byline.includes('removed') || byline.includes('bị xóa') || 
                            byline.includes('bị khóa') || byline.includes('disabled') || 
                            byline.includes('suspended') || nameObj.includes('channel removed');
          
          if (!isRemoved) {
            const name = item.accountName?.simpleText || item.accountName?.runs?.[0]?.text || '';
            let channelId = item.navigationEndpoint?.browseEndpoint?.browseId || item.channelId || '';
            const handle = item.accountBylineText?.simpleText || item.accountBylineText?.runs?.[0]?.text || '';
            
            if (!channelId && handle && handle.startsWith('@')) {
              channelId = handle.replace(/^@/, '');
            }

            const avatar = item.accountPhoto?.thumbnails?.[0]?.url || '';
            const subText = item.subscriberCountText?.simpleText || item.subscriberCountText?.runs?.[0]?.text || '';
            
            let subCount = null;
            if (subText) {
              subCount = parseMetricNumber(subText);
            } else if (/no subscriber|không có người đăng ký/i.test(byline)) {
              subCount = 0;
            }

            if (!name || name.trim() === '' || name === channelId) return; // Bỏ qua nếu ko có tên hoặc tên bị trùng với ID
            const cleanHandle = handle ? handle.replace(/^@/, '') : '';
            let uid = channelId || cleanHandle || name.toLowerCase().replace(/\s+/g, '_');
            // If it is an email address, extract username
            if (uid.includes('@gmail.com')) uid = uid.split('@')[0];
            if (uid && !seenUids.has(uid.toLowerCase())) {
              seenUids.add(uid.toLowerCase());
              accounts.push({
                platform: 'youtube',
                social_uid: uid,
                social_username: cleanHandle || null,
                social_name: name || uid,
                avatar: avatar,
                subscribers_count: subCount
              });
            }
          }
        }
        for (const key of Object.keys(obj)) {
          traverse(obj[key]);
        }
      }
      traverse(data);
    }

    return accounts;
  }

  // Strategy 2: UI Automation via Avatar & Switch Account menu
  async function scanViaAvatarSwitchAccount() {
    const accounts = [];
    const seenUids = new Set();

    try {
      const avatarBtn = querySelectorDeep('button#avatar-btn, ytcp-header #profile-icon, ytcp-header-profile-menu button, #avatar-btn, ytd-topbar-menu-button-renderer button, ytd-user-avatar-button, #profile-icon', document.body);
      if (avatarBtn) {
        dispatchSimulatedClick(avatarBtn);
        await sleep(500);

        const allItems = querySelectorAllDeep('ytd-compact-link-renderer, tp-yt-paper-item, ytcp-ve, a, div[role="button"], span', document.body);
        let switchBtn = null;
        for (const item of allItems) {
          const txt = (item.textContent || '').trim();
          if (/chuyển đổi tài khoản|switch account/i.test(txt)) {
            switchBtn = item;
            break;
          }
        }

        if (switchBtn) {
          dispatchSimulatedClick(switchBtn);
          await sleep(600);

          // Only account cards are valid here. Generic links/menus create false
          // channels such as playlist and settings URLs.
          const accountElements = querySelectorAllDeep('ytd-account-item-renderer, ytcp-account-item-renderer', document.body);
          
          accountElements.forEach(el => {
            const fullText = (el.textContent || '').trim();
            if (!fullText) return;

            if (/channel removed|kênh đã bị xóa|kênh bị khóa|disabled|account suspended/i.test(fullText)) {
              return;
            }

            const titleEl = querySelectorDeep('#channel-title, .channel-title, #title, #account-name', el) || el;
            let nameMatch = (titleEl.textContent || fullText).split('\n')[0].trim();
            if (nameMatch.startsWith('@')) nameMatch = '';

            const handleMatch = fullText.match(/@([a-zA-Z0-9_.-]+)/);
            const handle = handleMatch ? handleMatch[1] : '';

            let subCount = null;
            const subMatch = fullText.match(/([\d.,]+\s*[kKmMbB]?)\s*(subscribers|người đăng ký)/i);
            if (subMatch) {
              subCount = parseMetricNumber(subMatch[1]);
            } else if (/no subscribers|không có người đăng ký|0 subscriber|0 người đăng ký/i.test(fullText)) {
              subCount = 0;
            } else {
              // Extract the last line as a fallback since YouTube usually puts subs on the last line
              const lines = fullText.split('\n');
              const lastLine = lines[lines.length - 1];
              subCount = parseMetricNumber(lastLine);
            }

            const avatarImg = querySelectorDeep('img', el);
            const avatar = avatarImg ? avatarImg.src : '';

            const uid = handle || '';
            if (uid && nameMatch && !seenUids.has(uid.toLowerCase())) {
              seenUids.add(uid.toLowerCase());
              accounts.push({
                platform: 'youtube',
                social_uid: uid,
                social_name: nameMatch || handle || uid,
                avatar: avatar,
                subscribers_count: subCount
              });
            }
          });

          if (document.body) document.body.click();
        }
      }
    } catch (e) {
      console.warn('[MUT-YT-Scanner] Error in scanViaAvatarSwitchAccount:', e);
    }

    return accounts;
  }

  // Strategy 3: Single channel DOM fallback
  async function scanCurrentPageDOM() {
    let channelName = '';
    let avatarUrl = '';
    let channelId = '';
    let subscribersCount = null;

    try {
      const isStudio = location.hostname.includes('studio.youtube.com');
      const isYouTube = location.hostname.includes('youtube.com');
      if (!isStudio && !isYouTube) return null;

      for (let attempt = 0; attempt < 8; attempt++) {
        if (isStudio) {
          const nameEl = querySelectorDeep('#entity-name, #channel-title, .channel-name, ytcp-entity-page-header .title, .ytcp-navigation-drawer-header-title, ytcp-navigation-drawer #entity-name', document.body);
          if (nameEl && nameEl.textContent.trim()) {
            channelName = nameEl.textContent.trim();
          }

          const imgEl = querySelectorDeep('#avatar-img, ytcp-entity-page-header img, img.ytcp-img-with-fallback, ytcp-navigation-drawer img', document.body);
          if (imgEl && imgEl.src) avatarUrl = imgEl.src;

          const urlMatch = location.pathname.match(/\/(?:channel|c)\/([^\/]+)/) || location.search.match(/c=([^\&]+)/);
          if (urlMatch) channelId = urlMatch[1];

          const subEl = querySelectorDeep('.subscriber-count-val, #subscriber-count-val, ytcp-sub-count, ytcp-channel-analytics-card .metric-value-big', document.body);
          if (subEl && subEl.textContent) {
            subscribersCount = parseMetricNumber(subEl.textContent);
          }

          if (subscribersCount == null) {
            const deepText = getAllTextDeep(document.body);
            const match = deepText.match(/(?:Số người đăng ký hiện tại|Current subscribers|Subscribers)\s*[\n\r:]*\s*([\d.,]+\s*[kKmMbB]?)/i) ||
                          deepText.match(/([\d.,]+\s*[kKmMbB]?)\s*(?:người đăng ký|subscribers)/i);
            if (match) subscribersCount = parseMetricNumber(match[1]);
          }

          if (!channelName) {
            const titleMatch = document.title.match(/^(.*?)\s*-\s*YouTube Studio/i);
            if (titleMatch && titleMatch[1] && !/dashboard|kênh|analytics|content/i.test(titleMatch[1])) {
              channelName = titleMatch[1].trim();
            }
          }
        } else {
          const avatarImg = querySelectorDeep('yt-img-shadow#avatar img, button#avatar-btn img, ytd-topbar-menu-button-renderer img, ytd-channel-avatar-entity-header-renderer img', document.body);
          if (avatarImg && avatarImg.src) avatarUrl = avatarImg.src;

          const handleEl = querySelectorDeep('#channel-name #text, ytd-channel-name #text, #header #text, #channel-header #text, ytd-channel-tagline-renderer #text', document.body);
          if (handleEl && handleEl.textContent.trim()) {
            channelName = handleEl.textContent.trim();
          }

          const channelLink = querySelectorDeep('a[href*="/channel/"], a[href*="/@"]', document.body);
          if (channelLink) {
            const href = channelLink.getAttribute('href') || '';
            if (href.includes('/channel/')) {
              channelId = href.split('/channel/')[1].split('/')[0];
            } else if (href.includes('/@')) {
              channelId = href.split('/@')[1].split('/')[0];
            }
          }

          const subEl = querySelectorDeep('#subscriber-count, yt-formatted-string#subscriber-count, #subscribers-count', document.body);
          if (subEl && subEl.textContent) {
            subscribersCount = parseMetricNumber(subEl.textContent);
          }

          if (subscribersCount == null) {
            const deepText = getAllTextDeep(document.body);
            const match = deepText.match(/([\d.,]+\s*[kKmMbB]?)\s*(?:người đăng ký|subscribers)/i);
            if (match) subscribersCount = parseMetricNumber(match[1]);
          }

          if (!channelName) {
            const titleMatch = document.title.match(/^(.*?)\s*-\s*YouTube/i);
            if (titleMatch && titleMatch[1] && titleMatch[1] !== 'YouTube') channelName = titleMatch[1].trim();
          }
        }

        const validName = channelName && channelName !== channelId;
        if (validName && (channelId || subscribersCount != null)) break;
        await sleep(300);
      }

      if (channelName || channelId) {
        const finalName = (channelName && channelName !== channelId) ? channelName : (channelId || 'YouTube Channel');
        return {
          platform: 'youtube',
          social_uid: channelId || finalName.toLowerCase().replace(/\s+/g, '_'),
          social_username: channelId && !channelId.startsWith('UC') ? channelId : null,
          social_name: finalName,
          avatar: avatarUrl || '',
          subscribers_count: subscribersCount
        };
      }
    } catch (e) {
      console.warn('[MUT-YT-Scanner] Lỗi quét DOM trang hiện tại:', e);
    }
    // YouTube's /account page renders the channel card as plain text and may
    // not expose a channel link or ytInitialData renderer. Parse that card as
    // a safe fallback so a logged-in channel is still discoverable.
    try {
      const bodyText = String(document.body?.innerText || '');
      const match = bodyText.match(/(?:Tất cả các kênh|All channels)[\s\S]*?\n([^\n]+)\n@([A-Za-z0-9._-]+)\n([^\n]+)/i);
      if (match) {
        const name = match[1].trim();
        const handle = match[2].trim();
        const metric = parseMetricNumber(match[3]);
        if (name && handle && !/^(tạo kênh|create channel)$/i.test(name)) {
          return { platform: 'youtube', social_uid: handle, social_username: handle, social_name: name, avatar: '', subscribers_count: metric };
        }
      }
    } catch (_) {}
    return null;
  }

  async function scanYouTubeAccount() {
    const accountMap = new Map();

    // 1. Quét từ ytInitialData (đặc biệt khi mở trang youtube.com/channel_switcher)
    const dataAccounts = getAccountsFromYtInitialData();
    for (const acc of dataAccounts) {
      accountMap.set(acc.social_uid.toLowerCase(), acc);
    }

    // 2. Nếu chưa có kênh nào, tự động click Avatar -> Switch account
    if (accountMap.size === 0) {
      const uiAccounts = await scanViaAvatarSwitchAccount();
      for (const acc of uiAccounts) {
        accountMap.set(acc.social_uid.toLowerCase(), acc);
      }
    }

    // 3. Nếu vẫn chưa có kênh nào, fallback về kênh active của trang hiện tại
    if (accountMap.size === 0) {
      const singleAccount = await scanCurrentPageDOM();
      if (singleAccount) accountMap.set(singleAccount.social_uid.toLowerCase(), singleAccount);
    }

    return Array.from(accountMap.values()).filter(acc => {
      // Loại bỏ tài khoản rác nếu tên hiển thị trùng với ID kênh (UC... dài 24 ký tự)
      if (acc.social_name && acc.social_name.startsWith('UC') && acc.social_name.length === 24) return false;
      if (acc.social_uid && acc.social_uid.startsWith('UC') && acc.social_uid.length === 24 && (!acc.social_name || acc.social_name === acc.social_uid)) return false;
      return true;
    });
  }

  try {
    await sleep(500);
    const accounts = await scanYouTubeAccount();
    if (accounts && accounts.length > 0) {
      chrome.runtime.sendMessage({
        action: 'socialAccountsScannerResult',
        accounts: accounts
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'socialAccountsScannerResult',
        accounts: [],
        error: 'Không tìm thấy thông tin kênh YouTube. Hãy kiểm tra đã đăng nhập YouTube.'
      });
    }
  } catch (err) {
    chrome.runtime.sendMessage({
      action: 'socialAccountsScannerResult',
      accounts: [],
      error: err?.message || 'Lỗi quét tài khoản YouTube'
    });
  }
})();
