/* friendWarm.js — Làm ấm trước khi kết bạn (chỉ cho mode Theo bạn của bạn).
 * State machine RIÊNG, không dùng chung state/selector/counter/proof của
 * content.js (FoF send/scan) hay friendReengage.js (Lấy Lại Tương Tác).
 * - local:  friendWarmActive/RunId/OwnerTabId/Config/Source/ListUrl/Phase/
 *           DoneLike/DoneComment/Skipped/History/Dead/Touched/Status (+scroll state)
 * - sync:   friendWarmMode/Target/MinMutual/DelayMin/DelayMax/PostMin/PostMax/Prompt
 * - Nguồn: stream trực tiếp danh sách bạn của nguồn (link hoặc nguồn đã chọn),
 *   không phụ thuộc friendFoFCandidates (FoF hiện gửi trực tiếp, không còn preview).
 * - Quy tắc: click != success (chỉ ghi history sau proof Facebook), persist run
 *   TRƯỚC khi điều hướng, mọi vòng chờ poll stop flag + runId, chỉ ownerTabId
 *   resume sau reload, không giữ DOM cũ qua navigation. Thành công ghi vĩnh viễn.
 */
(function () {
  if (globalThis.__friendWarmLoaded) return;
  globalThis.__friendWarmLoaded = true;

  const LS = chrome.storage.local;
  const SYNC = chrome.storage.sync;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * Math.max(0, b - a);
  const now = () => Date.now();
  const DAY = 86400000;
  // Tường không có bài public / đã là bạn / lỗi tạm: nhớ nội bộ để lần Start sau
  // bỏ qua ngay, khỏi tốn navigate + hydrate. Hằng số nội bộ, không phải trần user.
  const WARM_DEAD_TTL_DAYS = 30;
  const WARM_DEAD_CERTAIN = { "no-post": 1, "bad-profile": 1, "known": 1 };
  const WARM_MAX_SCROLL_ROUNDS = 320;
  const WARM_END_CONFIRMATIONS = 2;
  const WARM_NO_PROGRESS_TIMEOUT_MS = 120000;
  const WARM_LIST_WAIT_MS = 60000;
  const WARM_SOURCE_WAIT_MS = 45000;
  const WARM_SCROLL_PROGRESS_WAIT_MS = 7000;
  const WARM_SCROLL_POLL_MS = 500;
  const WARM_RESERVED_PATHS = new Set([
    "about", "ads", "bookmarks", "events", "friends", "gaming", "groups", "help", "home.php",
    "marketplace", "messages", "notifications", "pages", "photo", "privacy", "profile.php", "reel",
    "search", "settings", "stories", "watch",
  ]);

  const DEFAULTS = {
    mode: "like", // like | comment | both
    target: 20,
    minMutual: 0,
    likePerPerson: 1, commentPerPerson: 1, // số bài Like/Comment cho MỖI bạn (KHÔNG trần)
    delayMin: 3, delayMax: 8, // phút giữa 2 người (KHÔNG kẹp trần — chỉ gợi ý ở UI)
    postMin: 30, postMax: 60, // giây giữa 2 hành động trên cùng tường
    prompt: "Đọc bài viết công khai sau và viết 1 bình luận ngắn (<20 từ) bằng tiếng Việt, lịch sự và trung tính như người mới biết, nhắc 1 chi tiết cụ thể trong bài. Không thân mật quá, không bán hàng, không link, không hashtag, không sao chép nguyên văn. Tuyệt đối không nhắc tên người, địa danh hay số liệu không có trong bài viết.\n\nBài viết: {postText}",
  };

  async function getSyncCfg() {
    let s = {};
    try { s = await SYNC.get(null); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    const num = (key, fb, lo) => {
      const v = Number(s[key]);
      if (!Number.isFinite(v)) return fb;
      return Math.max(lo, v); // chỉ chặn sàn, KHÔNG chặn trần (user tự chịu trách nhiệm)
    };
    return {
      mode: ["like", "comment", "both"].includes(s.friendWarmMode) ? s.friendWarmMode : DEFAULTS.mode,
      target: num("friendWarmTarget", DEFAULTS.target, 1),
      minMutual: num("friendWarmMinMutual", DEFAULTS.minMutual, 0),
      likePerPerson: num("friendWarmLikePerPerson", DEFAULTS.likePerPerson, 1),
      commentPerPerson: num("friendWarmCommentPerPerson", DEFAULTS.commentPerPerson, 1),
      delayMin: num("friendWarmDelayMin", DEFAULTS.delayMin, 0),
      delayMax: Math.max(num("friendWarmDelayMax", DEFAULTS.delayMax, 0), num("friendWarmDelayMin", DEFAULTS.delayMin, 0)),
      postMin: num("friendWarmPostMin", DEFAULTS.postMin, 0),
      postMax: Math.max(num("friendWarmPostMax", DEFAULTS.postMax, 0), num("friendWarmPostMin", DEFAULTS.postMin, 0)),
      prompt: typeof s.friendWarmPrompt === "string" && s.friendWarmPrompt.trim() ? s.friendWarmPrompt : DEFAULTS.prompt,
    };
  }

  const WARM_STATE_KEYS = ["friendWarmActive", "friendWarmRunId", "friendWarmOwnerTabId",
    "friendWarmConfig", "friendWarmSource", "friendWarmListUrl", "friendWarmPhase",
    "friendWarmQueue", "friendWarmQIndex",
    "friendWarmDoneLike", "friendWarmDoneComment", "friendWarmSkipped",
    "friendWarmHistory", "friendWarmDead", "friendWarmTouched", "friendWarmStatus",
    "friendWarmScrollRounds", "friendWarmEndConfirmations", "friendWarmLastDomProgressAt",
    "friendWarmWaitStartedAt", "friendWarmNextAllowedAt", "friendWarmLastShownSecond"];
  async function trace(msg) {
    try {
      const stored = await LS.get("friendWarmTrace");
      const arr = Array.isArray(stored.friendWarmTrace) ? stored.friendWarmTrace : [];
      arr.push(now() + " [" + location.pathname.slice(0, 40) + "] " + msg);
      await LS.set({ friendWarmTrace: arr.slice(-30) });
    } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
  }
  async function getState() {
    try { return await LS.get(WARM_STATE_KEYS); } catch (_) { return {}; }
  }
  async function setStatus(text) {
    try { await LS.set({ friendWarmStatus: String(text || "") }); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
  }
  async function alive(runId) {
    const s = await getState();
    if (!s.friendWarmActive) return false;
    if (runId && s.friendWarmRunId && s.friendWarmRunId !== runId) return false;
    return true;
  }
  async function readRunState(runId) {
    const s = await getState();
    if (!s.friendWarmActive || (runId && s.friendWarmRunId !== runId)) return null;
    return s;
  }
  // Owner check có retry: SW vừa wake sau reload có thể chưa đáp ngay lần đầu.
  // "unknown" sau retry không được bỏ qua thầm (từng làm run mồ côi Active=true):
  // đếm lỗi, quá 5 lần thì dừng sạch với lý do rõ, chưa tới thì hẹn giờ thử lại.
  async function checkOwner(runId, tries) {
    for (let i = 0; i < (tries || 3); i++) {
      try {
        const chk = await sendCancellable({ action: "friendWarmAmIOwner", runId }, runId, 10000);
        if (chk && chk.stopped) return "stopped";
        if (chk && chk.ok && chk.r && chk.r.ok) return "owner";
        if (chk && chk.ok && chk.r && chk.r.ok === false) return "not-owner";
      } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      await sleep(2000);
    }
    return "unknown";
  }
  async function ownerUnreachable(runId) {
    let fails = 0;
    try { fails = Number((await LS.get("friendWarmOwnerFails")).friendWarmOwnerFails) || 0; } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    fails++;
    try { await LS.set({ friendWarmOwnerFails: fails }); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    await trace("owner-unreachable x" + fails);
    if (fails >= 5) {
      try { await LS.set({ friendWarmOwnerFails: 0 }); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      await finishRun(runId, "Không liên lạc được tiến trình nền sau nhiều lần thử — đã dừng an toàn, hãy Start lại.");
      return;
    }
    scheduleResume(runId, 8000);
  }
  async function waitCancellable(ms, runId) {
    const end = now() + Math.max(0, ms);
    while (now() < end) {
      if (!(await alive(runId))) return false;
      await sleep(Math.min(1000, end - now()));
    }
    return true;
  }
  // Race sendMessage với timeout + poll stop từng giây: provider treo hay SW
  // restart giữa fetch cũng không treo run với Active=true.
  async function sendCancellable(msg, runId, ms) {
    let done = false, outcome = null;
    try {
      chrome.runtime.sendMessage(msg).then(
        (r) => { outcome = { ok: true, r }; done = true; },
        (e) => { outcome = { ok: false, err: e }; done = true; }
      );
    } catch (e) { return { ok: false, err: e }; }
    const end = now() + Math.max(1000, Number(ms) || 15000);
    while (!done && now() < end) {
      if (!(await alive(runId))) return { stopped: true };
      await sleep(Math.min(1000, end - now()));
    }
    if (!done) return { timeout: true };
    return outcome;
  }

  // ---------- Nhận diện danh sách bạn của nguồn (bản riêng cho warm) ----------
  // Key format GIỮ NGUYÊN `id:`/`user:` như FoF để đối chiếu chéo friendFoFHistory.
  function cleanText(v) {
    return String(v || "").replace(/[̀-ͯ‧﻿]/g, "").replace(/\s+/g, " ").trim();
  }
  function lower(v) { return cleanText(v).toLocaleLowerCase("vi"); }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      const st = getComputedStyle(el);
      return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) > 0;
    } catch (_) { return false; }
  }
  function warmProfileKeyFromHref(href) {
    let url;
    try { url = new URL(href, location.origin); } catch { return ""; }
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return "";
    const id = url.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return `id:${id}`;
    const groupUser = url.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)/i);
    if (groupUser) return `id:${groupUser[1]}`;
    const peopleMatch = url.pathname.match(/^\/people\/[^/]+\/(\d+)/i) || url.pathname.match(/^\/people\/(\d+)/i);
    if (peopleMatch) return `id:${peopleMatch[1]}`;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1) {
      const username = decodeURIComponent(parts[0]).toLocaleLowerCase("vi");
      if (!username || WARM_RESERVED_PATHS.has(username)) return "";
      if (!/^[\p{L}\p{N}._-]{2,100}$/u.test(username)) return "";
      return `user:${username}`;
    }
    return "";
  }
  function warmKeyFromFriendsUrl(href) {
    let url;
    try { url = new URL(href, location.origin); } catch { return ""; }
    const id = url.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return `id:${id}`;
    const parts = url.pathname.split("/").filter(Boolean);
    const fi = parts.findIndex((p) => p.toLowerCase() === "friends");
    if (fi <= 0) return "";
    return warmProfileKeyFromHref(`${url.origin}/${parts.slice(0, fi).join("/")}`);
  }
  function warmCurrentProfileKey() {
    return warmProfileKeyFromHref(location.href) || warmKeyFromFriendsUrl(location.href);
  }
  function warmNormalizeUrl(value) {
    let url;
    try { url = new URL(String(value || ""), location.origin); } catch { return ""; }
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return "";
    url.hash = "";
    ["ref", "refid", "__tn__", "__cft__", "mibextid", "locale"].forEach((k) => url.searchParams.delete(k));
    return url.toString().replace(/\/$/, "");
  }
  function warmNormalizeSource(input) {
    const url = warmNormalizeUrl(input && input.url);
    if (!url) return null;
    const key = warmProfileKeyFromHref(url);
    if (!key) return null;
    return { key, url, name: cleanText((input && input.name) || "").slice(0, 120) };
  }
  function warmProfileLinks(root) {
    if (!root) return [];
    return [...root.querySelectorAll("a[href]")].filter((link) => {
      const href = link.href || "";
      if (/mutual|friends_mutual|\/friends\/(?:suggestions|requests)/i.test(href)) return false;
      const label = lower(link.getAttribute("aria-label") || "");
      if (/(?:bạn chung|mutual friend|common friend)/i.test(label)) return false;
      return !!warmProfileKeyFromHref(href);
    });
  }
  function warmNameFromLink(link, card) {
    const label = cleanText(link?.getAttribute("aria-label") || link?.innerText || link?.textContent);
    if (label) return label.slice(0, 120);
    const alt = cleanText(link?.querySelector("img")?.alt);
    if (alt) return alt.slice(0, 120);
    return cleanText(card?.innerText || card?.textContent).split(" ").slice(0, 8).join(" ").slice(0, 120);
  }
  function warmCollectProfiles(root, source) {
    const map = new Map();
    for (const link of warmProfileLinks(root)) {
      const key = warmProfileKeyFromHref(link.href || "");
      const url = warmNormalizeUrl(link.href || "");
      if (!key || !url || key === source.key || map.has(key)) continue;
      let card = link.parentElement;
      for (let depth = 0; card && card !== root && depth < 8; depth++, card = card.parentElement) {
        if (warmProfileLinks(card).length > 1) break;
      }
      let mutualCount = null;
      try {
        const m = cleanText(card?.innerText || card?.textContent || "").match(/(\d{1,4})\s+(?:bạn chung|mutual friends?)/i);
        if (m) mutualCount = parseInt(m[1]);
      } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      map.set(key, { key, name: warmNameFromLink(link, card), url, mutualCount, card });
      if (map.size >= 2000) break;
    }
    return [...map.values()];
  }
  // Card đã thể hiện quan hệ Bạn bè / Đã gửi lời mời → làm ấm vô ích, bỏ qua.
  // Quy tắc KHỚP hệt luồng FoF (content.js): pending nhận theo tiền tố + hậu tố
  // ("Đã gửi lời mời", "Hủy yêu cầu ..."), bạn bè khớp chính xác. Bắt live thiếu:
  // bản cũ đòi đủ cụm "đã gửi lời mời kết bạn" nên nhãn ngắn "Đã gửi lời mời"
  // lọt qua và vẫn vào tường làm ấm người đã gửi rồi.
  function warmIsRelationshipLabel(label) {
    const v = String(label || "").trim().toLocaleLowerCase("vi").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ");
    if (/^(?:đã gửi|đã gửi lời mời|hủy lời mời|hủy yêu cầu|request sent|cancel request)(?:\s+.*)?$/.test(v)) return true;
    // Bạn bè khớp chính xác (không cho hậu tố — tránh nuốt nhầm nút "Bạn bè chung").
    if (/^(?:bạn bè|đã là bạn bè|already friends?|friends)$/.test(v)) return true;
    return false;
  }
  function warmCardRelationship(card) {
    if (!card) return false;
    return [...card.querySelectorAll('button,[role="button"],a[role="link"]')].some((b) => (
      warmIsRelationshipLabel(b.getAttribute("aria-label") || b.innerText || b.textContent)
    ));
  }
  function warmFriendsViewRestricted() {
    const main = document.querySelector('div[role="main"],main');
    if (!main) return false;
    const restricted = /^(?:bạn chung|mutual friends?|common friends?|người theo dõi|người theo dõi chung|followers?|following|mutual followers?)$/i;
    return [...main.querySelectorAll('[role="tab"][aria-selected="true"],[role="tab"][data-state="active"]')]
      .some((tab) => restricted.test(cleanText(tab.getAttribute("aria-label") || tab.innerText || tab.textContent)));
  }
  function warmIsOwnFriendsRoute() {
    const path = location.pathname.replace(/\/+$/g, "").toLowerCase() || "/";
    return path === "/friends/list";
  }
  function warmFriendsListRoot() {
    const main = document.querySelector('div[role="main"],main');
    const ownRoute = warmIsOwnFriendsRoute();
    if (!ownRoute && !main) return null;
    const scope = ownRoute ? document : main;
    const headings = [...scope.querySelectorAll('[role="heading"],h1,h2,h3,h4')].filter((el) => {
      if (!isVisible(el)) return false;
      const text = lower(el.getAttribute("aria-label") || el.innerText || el.textContent).replace(/\s*\(\d+\)\s*$/g, "");
      return /^(?:(?:tất cả|all)\s+)?(?:bạn bè|friends)$/.test(text);
    });
    let fallback = null;
    for (const heading of headings) {
      const boundary = ownRoute ? (heading.closest('[role="navigation"]') || document.body) : main;
      let node = heading.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 14; depth++, node = node.parentElement) {
        if (node === boundary) break;
        const count = warmProfileLinks(node).length;
        if (count >= 2) return node;
        if (count === 1 && !fallback) fallback = node;
      }
    }
    if (fallback) return fallback;
    let best = null, bestCount = 0;
    const fs = ownRoute ? (headings[0]?.closest('[role="navigation"]') || document.body) : main;
    for (const node of fs.querySelectorAll('[role="grid"],[role="list"]')) {
      const count = warmProfileLinks(node).length;
      if (count > bestCount) { best = node; bestCount = count; }
    }
    return bestCount ? best : null;
  }
  function warmFindScrollContainer(anchor) {
    let node = anchor?.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 28; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 80 && /(?:auto|scroll|overlay)/i.test(style.overflowY || "")) return node;
    }
    return document.scrollingElement || document.documentElement;
  }
  function warmListLoading(root) {
    if (!root) return true;
    return [...root.querySelectorAll('[role="status"],[aria-busy="true"]')].some((el) => {
      if (!isVisible(el)) return false;
      const value = lower(el.getAttribute("aria-label") || el.innerText || el.textContent);
      return el.getAttribute("aria-busy") === "true" || /^(?:đang tải|loading)(?:\.{0,3})?$/.test(value);
    });
  }
  function warmListSnapshot(root, knownScroller) {
    if (!root?.isConnected) return null;
    const links = warmProfileLinks(root);
    const keys = [];
    const seen = new Set();
    for (const link of links) {
      const key = warmProfileKeyFromHref(link.href || "");
      if (!key || seen.has(key)) continue;
      seen.add(key); keys.push(key);
    }
    const anchor = links[links.length - 1] || root;
    const scroller = knownScroller?.isConnected ? knownScroller : warmFindScrollContainer(anchor);
    const doc = document.scrollingElement || document.documentElement;
    const isDoc = !scroller || scroller === doc || scroller === document.documentElement || scroller === document.body;
    const scrollTop = Math.max(0, Number(isDoc ? (doc?.scrollTop || window.scrollY) : scroller.scrollTop) || 0);
    const scrollHeight = Math.max(0, Number(isDoc ? Math.max(doc?.scrollHeight || 0, document.body?.scrollHeight || 0) : scroller.scrollHeight) || 0);
    const clientHeight = Math.max(1, Number(isDoc ? (window.innerHeight || doc?.clientHeight) : scroller.clientHeight) || 1);
    return {
      profileCount: keys.length,
      tailKey: keys.slice(-5).join("|"),
      loading: warmListLoading(root),
      scrollTop, scrollHeight, clientHeight,
      atBottom: Math.max(0, scrollHeight - clientHeight - scrollTop) <= Math.max(80, Math.min(240, clientHeight * 0.18)),
    };
  }
  function warmListAdvanced(before, after) {
    if (!before || !after) return false;
    return after.profileCount > before.profileCount ||
      (!!after.tailKey && after.tailKey !== before.tailKey) ||
      after.scrollHeight > before.scrollHeight + 24 ||
      after.scrollTop > before.scrollTop + 24;
  }
  // Tăng trưởng THẬT của DS (số người/tailkey) — KHÔNG tính scrollTop/scrollHeight
  // (bắt live: mỗi vòng đều cuộn nên scrollTop luôn đổi → tiến triển giả, timeout
  // không bao giờ nổ, kẹt hàng trăm vòng ở list đã hết).
  function warmScanGrew(before, after) {
    if (!before || !after) return false;
    return after.profileCount > before.profileCount ||
      (!!after.tailKey && after.tailKey !== before.tailKey);
  }
  function warmScrollList(root) {
    if (!root?.isConnected) root = warmFriendsListRoot();
    if (!root) return null;
    const links = warmProfileLinks(root);
    const anchor = links[links.length - 1];
    const scroller = warmFindScrollContainer(anchor || root);
    const before = warmListSnapshot(root, scroller);
    if (anchor?.scrollIntoView) anchor.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
    const distance = Math.max(650, (scroller?.clientHeight || innerHeight) * 0.85);
    if (scroller && scroller !== document.documentElement && scroller !== document.body) {
      scroller.scrollBy({ top: distance, behavior: "auto" });
      return before;
    }
    window.scrollBy({ top: distance, behavior: "auto" });
    return before;
  }
  async function warmWaitListProgress(runId, before) {
    const t0 = Date.now();
    let latest = before, progressed = false;
    while (Date.now() - t0 < WARM_SCROLL_PROGRESS_WAIT_MS) {
      await sleep(WARM_SCROLL_POLL_MS);
      if (!(await alive(runId))) return { stopped: true, progressed: false, snapshot: latest };
      const root = warmFriendsListRoot();
      if (root) {
        latest = warmListSnapshot(root);
        if (warmListAdvanced(before, latest)) progressed = true;
      }
      if (progressed && Date.now() - t0 >= 1800) break;
    }
    return { stopped: false, progressed, snapshot: latest };
  }
  function warmFindFriendsLink(sourceKey) {
    const main = document.querySelector('div[role="main"],main');
    if (!main) return null;
    const links = [...main.querySelectorAll("a[href]")].filter((link) => {
      if (!isVisible(link)) return false;
      const label = lower(link.getAttribute("aria-label") || link.innerText || link.textContent);
      const href = link.href || "";
      if (/^https?:\/\/[^/]+\/friends(?:\/|\?|$)/i.test(href) || /\/friends\/(?:suggestions|requests)/i.test(href)) return false;
      return /^(?:bạn bè|friends)(?:\s*\(\d+\))?$/.test(label) || /\/friends(?:\/|\?|$)/i.test(href) || /[?&]sk=friends\b/i.test(href);
    });
    let best = null, bestScore = -1;
    for (const link of links) {
      const href = link.href || "";
      const linkKey = warmKeyFromFriendsUrl(href);
      let score = 1;
      if (linkKey && linkKey === sourceKey) score += 8;
      if (/^[^?]*\/friends(?:\/|\?|$)/i.test(href)) score += 2;
      if (/^(?:bạn bè|friends)/i.test(lower(link.getAttribute("aria-label") || link.innerText || link.textContent))) score += 2;
      if (score > bestScore) { bestScore = score; best = link; }
    }
    return best;
  }
  function warmSourceProfileEvidence(sourceKey) {
    if (!sourceKey) return false;
    if (warmCurrentProfileKey() === sourceKey) return true;
    const main = document.querySelector('div[role="main"],main');
    return !!main && warmProfileLinks(main).some((link) => warmProfileKeyFromHref(link.href || "") === sourceKey);
  }
  function warmOnSourceFriendsPage(state) {
    if (state.listUrl && warmNormalizeUrl(state.listUrl) === warmNormalizeUrl(location.href)) return true;
    if (!/\/friends(?:\/|$)/i.test(location.pathname) || /\/friends\/(?:suggestions|requests|list)(?:\/|$)/i.test(location.pathname)) return false;
    if (warmKeyFromFriendsUrl(location.href) === state.source?.key) return true;
    return warmSourceProfileEvidence(state.source?.key || "");
  }

  // ---------- Bài trên tường + proof (bản riêng cho warm) ----------
  function actionLabel(el) {
    return (((el.getAttribute && el.getAttribute("aria-label")) || el.textContent || "").trim().toLowerCase());
  }
  function isMainCommentLabel(label) {
    if (!label) return false;
    if (/^(bình luận|comment)\s+(dưới|vào|của|by|on|to)\b/i.test(label)) return false;
    if (/(bằng|bởi|with|via|gif|nhãn dán|sticker|emoji|biểu tượng cảm xúc)/i.test(label)) return false;
    if (/^(viết\s+)?bình luận[\s.…]*$/i.test(label)) return true;
    if (/^(write a\s+)?comment[\s.…]*$/i.test(label)) return true;
    if (/^(viết|đăng)\s+bình luận/i.test(label)) return true;
    return false;
  }
  function isLikeLabel(label) {
    if (!label) return false;
    if (/[:\d]/.test(label)) return false;
    return /^(thích|like)[\s.…]*$/i.test(label);
  }
  function isUnlikeSignal(label) {
    return /^(gỡ thích|bỏ thích|unlike| unlike)/i.test(label || "");
  }
  function isReplyComposer(box) {
    const label = ((box.getAttribute && box.getAttribute("aria-label")) || "") + " " + (box.placeholder || "");
    return /Trả lời .*với vai trò|Reply as|Reply to/i.test(label);
  }
  function isSponsored(el) {
    const t = (el.innerText || "").slice(0, 400);
    return /Được tài trợ|Sponsored/i.test(t);
  }
  function isProfileUrl(url) {
    try {
      const u = new URL(String(url || ""), location.origin);
      const host = u.hostname.toLowerCase();
      if (!(host === "facebook.com" || host.endsWith(".facebook.com"))) return false;
      if (u.pathname.toLowerCase().startsWith("/l.php")) return false;
      if (u.pathname.includes("profile.php")) return !!u.searchParams.get("id");
      return u.pathname.split("/").filter(Boolean).length === 1;
    } catch (_) { return false; }
  }
  function warmRestriction() {
    if (/checkpoint|login|recover/i.test(location.pathname)) return "Facebook yêu cầu đăng nhập/xác minh — đã dừng để không vượt hạn chế.";
    const text = [...document.querySelectorAll('[role="alert"],[role="status"],[role="dialog"]')]
      .filter(isVisible).map((el) => lower(el.innerText || el.textContent)).join(" ");
    if (/tạm thời bị chặn|temporarily blocked|verify your identity|xác minh tài khoản|không thể (thực hiện|bình luận|thích)/.test(text))
      return "Facebook báo bị chặn tạm thời — đã dừng, hãy nghỉ rồi chạy tiếp.";
    return "";
  }
  // Neo theo hàng nút Like (≤3 tầng phải đủ Like + Comment chính + Share,
  // không có Trả lời/báo cáo) để không Like nhầm comment con.
  function postBarOf(likeBtn) {
    let node = likeBtn.parentElement;
    for (let d = 0; d < 3 && node; d++, node = node.parentElement) {
      let btns = [];
      try { btns = Array.from(node.querySelectorAll(':scope [role="button"]')).filter((b) => b.offsetParent); }
      catch (_) { btns = Array.from(node.querySelectorAll('[role="button"]')).filter((b) => b.offsetParent); }
      const ls = btns.map(actionLabel);
      const hasC = ls.some(isMainCommentLabel);
      const hasS = ls.some((l) => /^(chia sẻ|share|gửi nội dung này)/i.test(l));
      const hasThread = ls.some((l) => /^(trả lời|reply)(\s|$)/i.test(l) || /báo cáo bình luận|report.*comment|giảm bậc|downvote/i.test(l));
      if (hasC && hasS && !hasThread) {
        const like = btns.find((b) => isLikeLabel(actionLabel(b)));
        const cmt = btns.find((b) => !b.closest("ul") && isMainCommentLabel(actionLabel(b)));
        if (like && cmt) return { bar: node, like, cmt };
      }
    }
    return null;
  }
  function collectWallPosts(maxN) {
    const out = [];
    const seenBars = new Set();
    const tStart = Date.now();
    const likeBtns = Array.from(document.querySelectorAll('[role="button"]'))
      .filter((b) => b.offsetParent && isLikeLabel(actionLabel(b))).slice(0, 80);
    for (const lb of likeBtns) {
      if (out.length >= (maxN || 4)) break;
      if (Date.now() - tStart > 8000) break;
      try {
        const found = postBarOf(lb);
        if (!found || seenBars.has(found.bar)) continue;
        seenBars.add(found.bar);
        let cont = found.bar;
        for (let d = 0; d < 6 && cont && cont.parentElement; d++) {
          if (cont.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')) break;
          cont = cont.parentElement;
        }
        if (!cont || isSponsored(cont)) continue;
        const link = cont.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
        const href = link ? link.href : "";
        if (/\/(reel|watch)\//i.test(href)) continue;
        let bodyText = "";
        try {
          const storyMsg = cont.querySelector('[data-ad-rendering-role="story_message"]');
          if (storyMsg) bodyText = (storyMsg.innerText || "").trim();
        } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
        if (!bodyText) {
          try {
            const clone = cont.cloneNode(true);
            clone.querySelectorAll('[role="article"], [role="dialog"], [contenteditable="true"], [role="textbox"]').forEach((n) => { try { n.remove(); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); } });
            const NOISE_LINE = /^(?:[\d\s.,▪·•|×x+]+|xem thêm bình luận|see more comments?|xem .* câu trả lời|view .* repl(?:y|ies)|trả lời|reply|thích|like|chia sẻ|share|gửi nội dung này.*|bình luận( dưới tên.*)?|comments?( as.*)?|viết bình luận|write (a )?comment|phù hợp nhất|mới nhất|mới|relevant|newest|all comments?|tất cả bình luận)$/i;
            const raw = String(clone.innerText || "");
            bodyText = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !NOISE_LINE.test(s)).join("\n").replace(/\s+/g, " ").trim();
            if (/^[\d\s.,▪·•|×+]+$/.test(bodyText)) bodyText = "";
          } catch (_) { bodyText = ""; }
        }
        const text = bodyText.slice(0, 2000);
        if (text.length < 2 && !cont.querySelector("img,video")) continue;
        const alreadyLiked = Array.from(found.bar.querySelectorAll('[role="button"]')).some((b) => isUnlikeSignal(actionLabel(b)));
        out.push({ art: cont, text, href, likeBtn: found.like, commentBtn: found.cmt, alreadyLiked });
      } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    }
    return out;
  }
  function findTopComposer(scopeEl) {
    const boxes = Array.from((scopeEl || document).querySelectorAll('[contenteditable="true"], [role="textbox"]'));
    for (const b of boxes) {
      if (!b.isConnected || !b.offsetParent) continue;
      const label = (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("placeholder") || "");
      if (/Nhắn tin|Message|Messenger|Tìm kiếm|Search/i.test(label)) continue;
      if (/hãy viết gì đó|write something|viết gì đó cho|tạo bài|create post/i.test(label)) continue;
      if (isReplyComposer(b)) continue;
      if (/Bình luận|Comment|Viết/i.test(label)) return b;
    }
    return null;
  }
  async function likeWithProof(likeBtn, runId) {
    try {
      if (!likeBtn.isConnected) return false;
      const before = likeBtn.getAttribute("aria-pressed");
      likeBtn.scrollIntoView({ block: "center" });
      if (!(await waitCancellable(600, runId))) return false;
      likeBtn.click();
      for (let i = 0; i < 10; i++) {
        if (!(await alive(runId))) return false;
        await sleep(500);
        if (!likeBtn.isConnected) return true;
        if (likeBtn.getAttribute("aria-pressed") === "true" && before !== "true") return true;
      }
      try {
        let node = likeBtn.parentElement;
        for (let d = 0; d < 3 && node; d++, node = node.parentElement) {
          const btns = node.querySelectorAll('[role="button"]');
          for (const b of btns) {
            if (isUnlikeSignal(actionLabel(b))) return true;
          }
        }
      } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      return likeBtn.getAttribute("aria-pressed") === "true";
    } catch (_) { return false; }
  }
  async function commentWithProof(cont, text, runId) {
    try {
      const art = cont.art || cont;
      const btn = cont.commentBtn;
      if (btn && btn.isConnected) {
        btn.scrollIntoView({ block: "center" });
        if (!(await waitCancellable(500, runId))) return "stopped";
        btn.click();
        if (!(await waitCancellable(1500, runId))) return "stopped";
      }
      const box = findTopComposer(art.isConnected ? art : document);
      if (!box) return "nobox";
      box.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      if (!(await waitCancellable(1200, runId))) return "stopped";
      const cur = (box.innerText || "").replace(/\s+/g, " ").trim();
      if (cur.length < Math.min(text.length, 10) * 0.7) return "short";
      // Gửi + proof + nán qua lõi chung (cùng cơ chế Bản tin & AI); giữ cách
      // gõ execCommand đặc thù tường bạn bè ở trên.
      const UC = globalThis.UnifiedComment;
      if (!UC?.sendProofDwell) return "noproof";
      const scope = art.isConnected ? art : document;
      const needle = text.slice(0, 24).replace(/\s+/g, " ").trim();
      const wRes = await UC.sendProofDwell({
        box, commentScope: scope, text, proof: needle,
        tagEntity: null, tagConfig: null,
        alive: () => alive(runId),
        onEvent: () => {},
        clearDraft: () => { try { box.blur(); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); } },
        findSend: () => Array.from(scope.querySelectorAll("[aria-label]"))
          .find((b) => /^(Đăng|Gửi|Post)$/i.test((b.getAttribute("aria-label") || "").trim()) && b.isConnected) || null,
        sendEnter: () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); return true; },
        proofExists: (root) => {
          if (!needle) return false;
          const hay = ((root === document ? document.body.innerText : root.innerText) || "").replace(/\s+/g, " ");
          return hay.includes(needle);
        },
        proofRoots: () => [art.isConnected ? art : document, document],
        scrollIntoView: () => { try { art.scrollIntoView({ block: "center" }); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); } },
        onCounted: () => true,
      });
      if (wRes === true) return "ok";
      if (wRes === "stopped") return "stopped";
      return "noproof";
    } catch (_) { return "error"; }
  }

  // ---------- Guard AI: chống bịa tên + comment chung chung (luồng warm riêng) ----------
  const WARM_COMMON_WORDS = { "bạn": 1, "mình": 1, "tôi": 1, "tớ": 1, "anh": 1, "chị": 1, "em": 1, "cô": 1, "chú": 1, "bác": 1, "ông": 1, "bà": 1, "bài": 1, "viết": 1, "thật": 1, "quá": 1, "rất": 1, "hay": 1, "đẹp": 1, "tuyệt": 1, "chúc": 1, "mừng": 1, "cảm": 1, "ơn": 1, "chào": 1, "ơi": 1, "nhé": 1, "nha": 1, "đó": 1, "đây": 1, "vậy": 1, "nào": 1, "một": 1, "việt": 1, "nam": 1, "thích": 1, "yêu": 1, "biết": 1, "thấy": 1 };
  function warmHasForeignName(cmt, postText, personName) {
    const text = String(cmt || "").trim();
    if (!text) return "";
    const post = String(postText || "").toLowerCase();
    const nameTokens = {};
    String(personName || "").toLowerCase().split(/[^a-zà-ỹ0-9]+/i).forEach((w) => { if (w) nameTokens[w] = 1; });
    const addrRe = /(anh|chị|em|bạn|cô|chú|bác|ông|bà|thầy|cậu|Anh|Chị|Em|Bạn|Cô|Chú|Bác|Ông|Bà|Thầy|Cậu|ANH|CHỊ|EM|BẠN)\s+(\p{Lu}\p{Ll}+)/g;
    let m = null;
    while ((m = addrRe.exec(text)) !== null) {
      const nm = m[2].toLowerCase();
      if (!nameTokens[nm] && post.indexOf(nm) < 0) return m[2];
    }
    const parts = text.split(/[.?!…\n]+/);
    for (let s = 0; s < parts.length; s++) {
      const words = parts[s].split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const raw = words[i].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
        if (i === 0 || !/^[\p{Lu}][\p{L}]+$/u.test(raw)) continue;
        const low = raw.toLowerCase();
        if (WARM_COMMON_WORDS[low] || nameTokens[low] || post.indexOf(low) >= 0) continue;
        return raw;
      }
    }
    return "";
  }
  const WARM_MATCH_STOP = { "bạn": 1, "mình": 1, "tôi": 1, "anh": 1, "chị": 1, "em": 1, "người": 1, "cái": 1, "những": 1, "các": 1, "một": 1, "như": 1, "với": 1, "và": 1, "là": 1, "của": 1, "cho": 1, "trong": 1, "trên": 1, "này": 1, "đây": 1, "đó": 1, "cũng": 1, "vậy": 1, "sao": 1, "gì": 1, "nào": 1, "mỗi": 1, "khi": 1, "nếu": 1, "vì": 1, "để": 1, "rồi": 1, "sẽ": 1, "đã": 1, "đang": 1, "được": 1, "có": 1, "không": 1, "chưa": 1, "về": 1, "ơi": 1, "nhé": 1, "ạ": 1, "thật": 1, "quá": 1, "rất": 1, "lắm": 1 };
  function warmTokens(text) {
    const out = [];
    const seen = {};
    const words = String(text || "").toLowerCase().split(/[^a-zà-ỹ0-9]+/i);
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (!w || seen[w]) continue;
      const digits = /^(\d+)[a-zà-ỹ]+$/.exec(w);
      if (digits) w = digits[1];
      if (seen[w]) continue;
      if (/^\d+$/.test(w)) { if (w.length >= 2) { seen[w] = 1; out.push(w); } continue; }
      if (w.length < 3 || WARM_MATCH_STOP[w]) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
  }
  function warmMatchesPost(cmt, postText) {
    const post = {};
    const pt = warmTokens(postText);
    for (let i = 0; i < pt.length; i++) post[pt[i]] = 1;
    if (!pt.length) return true;
    const ct = warmTokens(cmt);
    for (let i = 0; i < ct.length; i++) if (post[ct[i]]) return true;
    return false;
  }

  // ---------- Vòng lặp stream: nguồn → DS bạn → từng tường → quay lại DS ----------
  let activeLoopKey = "";
  let resumeTimer = 0;
  async function runLoop(runId) {
    if (activeLoopKey === runId) return;
    activeLoopKey = runId;
    try { await runLoopInner(runId); }
    finally { if (activeLoopKey === runId) activeLoopKey = ""; }
  }
  function scheduleResume(runId, delay) {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(async () => {
      resumeTimer = 0;
      try {
        const s = await readRunState(runId);
        if (!s) return;
        if (activeLoopKey) { scheduleResume(runId, 500); return; }
        runLoop(runId);
      } catch (e) { console.error("[FriendWarmResume]", e); }
    }, Math.max(0, delay || 1600));
  }
  function personDone(entry, mode) {
    if (!entry) return false;
    if (mode === "like") return !!entry.like;
    if (mode === "comment") return !!entry.comment;
    return !!entry.like && !!entry.comment;
  }
  function targetReached(cfg, doneLike, doneComment) {
    if (cfg.mode === "like") return doneLike >= cfg.target;
    if (cfg.mode === "comment") return doneComment >= cfg.target;
    return doneLike >= cfg.target && doneComment >= cfg.target;
  }
  async function publishStatus(patch, message) {
    patch.updatedAt = now();
    if (message) patch.status = message;
    await LS.set({
      friendWarmDoneLike: patch.doneLike || 0, friendWarmDoneComment: patch.doneComment || 0,
      friendWarmSkipped: patch.skipped || 0, friendWarmStatus: patch.status || "",
      friendWarmTouched: [...patch.touched].slice(-3000), friendWarmDead: patch.dead,
      friendWarmHistory: patch.history, friendWarmListUrl: patch.listUrl || "",
      friendWarmPhase: patch.phase || "source-profile",
      friendWarmQueue: Array.isArray(patch.queue) ? patch.queue.slice(-5000) : [],
      friendWarmQIndex: patch.qIndex || 0,
      friendWarmScrollRounds: patch.scrollRounds || 0,
      friendWarmEndConfirmations: patch.endConfirmations || 0,
      friendWarmLastDomProgressAt: patch.lastDomProgressAt || now(),
      friendWarmWaitStartedAt: patch.waitStartedAt || now(),
      friendWarmNextAllowedAt: patch.nextAllowedAt || 0,
      friendWarmLastShownSecond: patch.lastShownSecond || 0,
    });
  }
  async function finishRun(runId, msg) {
    const s = await getState();
    if (s.friendWarmRunId && s.friendWarmRunId !== runId) return;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
    await LS.set({ friendWarmActive: false, friendWarmNextAllowedAt: 0, friendWarmStatus: msg });
  }
  function isDead(dead, key) {
    const e = dead[key];
    if (!e || !Number(e.at)) return false;
    if (now() - Number(e.at) >= WARM_DEAD_TTL_DAYS * DAY) return false;
    if (WARM_DEAD_CERTAIN[e.reason]) return true;
    return (Number(e.strikes) || 0) >= 2;
  }
  async function waitSchedule(p, runId) {
    while (true) {
      const aliveNow = await alive(runId);
      if (!aliveNow) return false;
      const remain = (Number(p.nextAllowedAt) || 0) - now();
      if (remain <= 0) return true;
      const seconds = Math.max(1, Math.ceil(remain / 1000));
      if (p.lastShownSecond !== seconds) {
        p.lastShownSecond = seconds;
        await publishStatus(p, `Nghỉ ${seconds}s trước người tiếp theo (Like ${p.doneLike} • Comment ${p.doneComment})`);
      }
      await sleep(Math.min(500, remain));
    }
  }
  async function runLoopInner(runId) {
    // Chỉ owner tab chạy tiếp sau reload/điều hướng (background so sender.tab).
    await trace("ENTER phase=" + ((await getState()).friendWarmPhase || "?"));
    const st0 = await getState();
    if (st0.friendWarmOwnerTabId) {
      const verdict = await checkOwner(runId, 3);
      await trace("owner:" + verdict);
      if (verdict === "stopped" || verdict === "not-owner") return;
      if (verdict !== "owner") { await ownerUnreachable(runId); return; }
    }
    let s = await readRunState(runId);
    if (!s) return;
    const cfg = s.friendWarmConfig || await getSyncCfg();
    const source = s.friendWarmSource;
    if (!source || !source.key || !source.url) { await finishRun(runId, "Nguồn làm ấm không hợp lệ."); return; }
    const modeHasLike = cfg.mode === "like" || cfg.mode === "both";
    const modeHasComment = cfg.mode === "comment" || cfg.mode === "both";
    let fofHistory = {};
    try {
      const stored = await LS.get("friendFoFHistory");
      fofHistory = stored.friendFoFHistory && typeof stored.friendFoFHistory === "object" ? stored.friendFoFHistory : {};
    } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    const p = {
      phase: s.friendWarmPhase || "source-profile", listUrl: s.friendWarmListUrl || "",
      queue: Array.isArray(s.friendWarmQueue) ? s.friendWarmQueue : [],
      qIndex: Number(s.friendWarmQIndex) || 0,
      doneLike: Number(s.friendWarmDoneLike) || 0, doneComment: Number(s.friendWarmDoneComment) || 0,
      skipped: Number(s.friendWarmSkipped) || 0,
      history: s.friendWarmHistory && typeof s.friendWarmHistory === "object" ? s.friendWarmHistory : {},
      dead: s.friendWarmDead && typeof s.friendWarmDead === "object" ? s.friendWarmDead : {},
      touched: new Set(Array.isArray(s.friendWarmTouched) ? s.friendWarmTouched : []),
      status: s.friendWarmStatus || "", scrollRounds: Number(s.friendWarmScrollRounds) || 0,
      endConfirmations: Number(s.friendWarmEndConfirmations) || 0,
      lastDomProgressAt: Number(s.friendWarmLastDomProgressAt) || now(),
      waitStartedAt: Number(s.friendWarmWaitStartedAt) || now(),
      nextAllowedAt: Number(s.friendWarmNextAllowedAt) || 0,
      lastShownSecond: Number(s.friendWarmLastShownSecond) || 0,
    };
    function noteDead(key, reason) {
      if (!key) return;
      const prev = p.dead[key];
      p.dead[key] = { at: now(), reason: String(reason || "skip"), strikes: (prev ? Number(prev.strikes) || 0 : 0) + 1, runId };
    }

    try {
      // Pha 1: về profile nguồn rồi tìm link DS bạn bè (vòng lặp, không đệ quy).
      while (p.phase === "source-profile") {
        if (!(await alive(runId))) return;
        const curKey = warmCurrentProfileKey();
        if (curKey !== source.key) {
          await publishStatus(p, `Đang mở profile nguồn ${source.name || source.key}…`);
          await trace("src-profile mismatch cur=" + (curKey || "?"));
          if (!(await alive(runId))) return;
          scheduleResume(runId);
          location.assign(source.url);
          return;
        }
        await trace("src-profile matched, finding friends link");
        const link = warmFindFriendsLink(source.key);
        if (link) {
          p.listUrl = warmNormalizeUrl(link.href || "") || link.href;
          p.phase = "scan-list"; p.waitStartedAt = now(); p.scrollRounds = 0; p.endConfirmations = 0;
          p.lastDomProgressAt = now();
          await publishStatus(p, `Đang mở DS bạn bè của ${source.name || source.key} để quét 1 lượt…`);
          if (!(await alive(runId))) return;
          scheduleResume(runId);
          location.assign(p.listUrl);
          return;
        }
        if (now() - p.waitStartedAt > WARM_SOURCE_WAIT_MS) { await finishRun(runId, "Nguồn không hiển thị link DS bạn bè; không cố mở DS bị ẩn."); return; }
        await publishStatus(p, "Đang chờ link DS bạn bè của nguồn…");
        if (!(await waitCancellable(1800, runId))) return;
      }
      // Pha 2: QUÉT DS 1 LẦN DUY NHẤT rồi đi tường-thẳng-tường, không bao giờ tải
      // lại DS hay cuộn lại từ đầu sau mỗi người (user phàn nàn mất công).
      if (p.phase === "scan-list") {
        if (!warmOnSourceFriendsPage({ listUrl: p.listUrl, source })) {
          await publishStatus(p, "Đang mở DS bạn bè của nguồn để quét 1 lượt…");
          if (!(await alive(runId))) return;
          scheduleResume(runId);
          location.assign(p.listUrl);
          return;
        }
        if (warmFriendsViewRestricted()) { await finishRun(runId, "Facebook chỉ hiển thị Bạn chung/người theo dõi của nguồn; không coi là DS đầy đủ."); return; }
        const seen = new Map();
        p.scrollRounds = 0; p.endConfirmations = 0; p.lastDomProgressAt = now();
        let scannedRounds = 0, flatRounds = 0;
        // Dừng quét sớm khi đã đủ người cho target còn lại (+25 dự phòng loại):
        // target nhỏ không phải trả giá quét cả nghìn người.
        const scanNeed = () => {
          const rem = cfg.mode === "like" ? cfg.target - p.doneLike
            : cfg.mode === "comment" ? cfg.target - p.doneComment
            : Math.max(cfg.target - p.doneLike, cfg.target - p.doneComment);
          return Math.max(0, rem) + 25;
        };
        while (await alive(runId)) {
          const root = warmFriendsListRoot();
          if (root) {
            for (const prof of warmCollectProfiles(root, source)) {
              if (seen.has(prof.key)) continue;
              // Lọc cần DOM thẻ ngay lúc quét (quan hệ, bạn chung): qua thì vào
              // queue, không thì đánh dấu + bỏ qua, KHÔNG vào tường.
              if (p.touched.has(prof.key) || personDone(p.history[prof.key], cfg.mode) || fofHistory[prof.key] || isDead(p.dead, prof.key)) {
                p.touched.add(prof.key);
                continue;
              }
              if (Number(cfg.minMutual) > 0 && (prof.mutualCount == null || prof.mutualCount < Number(cfg.minMutual))) {
                p.touched.add(prof.key); p.skipped++; continue;
              }
              if (warmCardRelationship(prof.card)) {
                noteDead(prof.key, "known");
                p.touched.add(prof.key); p.skipped++;
                continue;
              }
              seen.set(prof.key, { key: prof.key, name: prof.name, url: prof.url, mutualCount: prof.mutualCount });
            }
          }
          await publishStatus(p, `Đang quét DS bạn của ${source.name || source.key}: ${seen.size} người (vòng ${scannedRounds})`);
          const before = warmScrollList(warmFriendsListRoot() || root);
          const outcome = await warmWaitListProgress(runId, before);
          if (!outcome) return;
          if (outcome.stopped) return;
          scannedRounds++;
          p.scrollRounds = scannedRounds;
          // Chỉ số người/tailkey tăng mới là tiến triển (không tính cuộn trang).
          // Hết tăng N vòng liên tiếp (= hết list thật, kể cả khi atBottom/loading
          // của Facebook báo sai) thì chốt quét — không kẹt vô hạn.
          if (outcome.snapshot && warmScanGrew(before, outcome.snapshot)) {
            p.lastDomProgressAt = now(); p.endConfirmations = 0; flatRounds = 0;
          } else {
            flatRounds++;
            if (outcome.snapshot && outcome.snapshot.atBottom && !outcome.snapshot.loading) p.endConfirmations++;
            else p.endConfirmations = 0;
          }
          if (seen.size >= scanNeed() && seen.size > 0) break;
          if (flatRounds >= 6 || p.endConfirmations >= WARM_END_CONFIRMATIONS) break;
          if (scannedRounds >= WARM_MAX_SCROLL_ROUNDS || now() - p.lastDomProgressAt >= WARM_NO_PROGRESS_TIMEOUT_MS) break;
        }
        if (!(await alive(runId))) return;
        p.queue = [...seen.values()];
        p.qIndex = 0;
        p.phase = "warm-walls";
        await publishStatus(p, `Quét xong: ${p.queue.length} người cần làm ấm (bỏ qua ${p.skipped}). Bắt đầu đi từng tường…`);
        if (!p.queue.length) {
          await finishRun(runId, `DS nguồn không còn ai cần làm ấm (bỏ qua ${p.skipped}).`);
          return;
        }
        // Rơi xuống pha tường ngay trong lượt này (đang ở DS, đi thẳng tường đầu).
      }
      // Pha 3: đi thẳng tường-này sang tường-khác theo queue, KHÔNG về lại DS.
      // Lọc nhẹ không cần DOM (touched/history/fofHistory/dead) ngay tại chỗ,
      // qua người bị loại mà không tốn navigation nào.
      while (await alive(runId)) {
        const restriction = warmRestriction();
        if (restriction) { await finishRun(runId, restriction); return; }
        if (targetReached(cfg, p.doneLike, p.doneComment)) {
          await finishRun(runId, `Đã đủ target: Like ${p.doneLike} • Comment ${p.doneComment} • Bỏ qua ${p.skipped}.`);
          return;
        }
        if (p.qIndex >= p.queue.length) {
          await finishRun(runId, `Hết DS đã quét (${p.queue.length} người): Like ${p.doneLike} • Comment ${p.doneComment} • Bỏ qua ${p.skipped}. Quét lại để làm tiếp người mới.`);
          return;
        }
        const person = p.queue[p.qIndex];
        if (!person || !person.key || !person.url ||
          p.touched.has(person.key) || personDone(p.history[person.key], cfg.mode) ||
          fofHistory[person.key] || isDead(p.dead, person.key)) {
          if (person && person.key) p.touched.add(person.key);
          p.qIndex++;
          await publishStatus(p);
          continue;
        }
        if (!(await waitSchedule(p, runId))) return;
        // Ghi attempted TRƯỚC khi rời tường hiện tại (write-ahead, sống qua Stop/reload).
        p.touched.add(person.key);
        await publishStatus(p, `Đang làm ấm (${p.qIndex + 1}/${p.queue.length}): ${person.name || person.key}`);
        if (!(await alive(runId))) return;
        scheduleResume(runId);
        // Phần tường chạy sau resume (không giữ DOM cũ).
        await LS.set({ friendWarmPendingWall: { key: person.key, name: person.name || person.key, url: person.url } });
        location.assign(person.url);
        return;
      }
    } catch (e) {
      try {
        const s2 = await getState();
        if (!s2.friendWarmRunId || s2.friendWarmRunId === runId) {
          await LS.set({ friendWarmActive: false, friendWarmStatus: "Lỗi không mong đợi, đã dừng an toàn: " + String((e && e.message) || e).slice(0, 160) });
        }
      } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    }
  }

  // Phần tường: chạy khi resume thấy friendWarmPendingWall (sau điều hướng tới wall).
  async function runWallPart(runId) {
    let pending = null;
    try { pending = (await LS.get("friendWarmPendingWall")).friendWarmPendingWall; } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    if (!pending || !pending.key || !pending.url) return false;
    // Lạc route (không ở đúng wall) → xóa pending, về DS.
    if (new URL(location.href).href !== new URL(pending.url).href) return false;
    const s = await readRunState(runId);
    if (!s) return true;
    const cfg = s.friendWarmConfig || await getSyncCfg();
    const modeHasLike = cfg.mode === "like" || cfg.mode === "both";
    const modeHasComment = cfg.mode === "comment" || cfg.mode === "both";
    let history = s.friendWarmHistory && typeof s.friendWarmHistory === "object" ? s.friendWarmHistory : {};
    let dead = s.friendWarmDead && typeof s.friendWarmDead === "object" ? s.friendWarmDead : {};
    let doneLike = Number(s.friendWarmDoneLike) || 0;
    let doneComment = Number(s.friendWarmDoneComment) || 0;
    let skipped = Number(s.friendWarmSkipped) || 0;
    let touched = new Set(Array.isArray(s.friendWarmTouched) ? s.friendWarmTouched : []);
    function noteDead(key, reason) {
      const prev = dead[key];
      dead[key] = { at: now(), reason: String(reason || "skip"), strikes: (prev ? Number(prev.strikes) || 0 : 0) + 1, runId };
    }
    async function persist() {
      await LS.set({
        friendWarmDoneLike: doneLike, friendWarmDoneComment: doneComment, friendWarmSkipped: skipped,
        friendWarmHistory: history, friendWarmDead: dead, friendWarmTouched: [...touched].slice(-3000),
      });
    }
    const key = pending.key;
    try {
      await setStatus(`Đang làm ấm: ${pending.name} (tường)`);
      if (!(await waitCancellable(3000, runId))) return true;
      // Chờ tường hydrate: quét lại tối đa 5 lượt mới kết luận không có bài.
      // Lấy dư bài (tối đa 10) để đủ cho quota mỗi bạn >1.
      let posts = [];
      for (let h = 0; h < 5; h++) {
        if (!(await alive(runId))) return true;
        posts = collectWallPosts(10);
        if (posts.length) break;
        try { window.scrollBy(0, 600); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
        if (!(await waitCancellable(3000, runId))) return true;
      }
      if (!posts.length) {
        noteDead(key, "no-post");
        skipped++;
        await LS.set({ friendWarmPendingWall: null });
        await persist();
        await setStatus(`Bỏ qua (tường không có bài public): ${pending.name}`);
        return true;
      }
      let likedOk = !!(history[key] && history[key].like);
      let commentedOk = !!(history[key] && history[key].comment);
      // doneLike/doneComment đếm NGƯỜI (khớp target "số bạn"), không đếm bài —
      // chụp trạng thái đầu tường, cuối lượt ai chuyển false→true mới +1.
      const hadLike = likedOk, hadCmt = commentedOk;
      const likeQuota = Math.max(1, Number(cfg.likePerPerson) || 1);
      const cmtQuota = Math.max(1, Number(cfg.commentPerPerson) || 1);
      async function postPause() {
        const w = rnd(Number(cfg.postMin) || 0, Number(cfg.postMax) || 0) * 1000;
        if (w > 0) return waitCancellable(w, runId);
        return alive(runId);
      }
      // Like tối đa likePerPerson bài public chưa Like (proof mới đếm).
      if (modeHasLike && !likedOk) {
        let n = 0;
        for (const target of posts) {
          if (n >= likeQuota) break;
          if (!(await alive(runId))) return true;
          if (target.alreadyLiked || !target.likeBtn || target.likeBtn.getAttribute("aria-pressed") === "true") continue;
          const ok = await likeWithProof(target.likeBtn, runId);
          if (!(await alive(runId))) return true;
          if (ok) {
            n++;
            likedOk = true;
            history[key] = Object.assign(history[key] || { at: now(), name: pending.name }, { at: now(), like: true });
            if (dead[key]) delete dead[key];
            if (!(await postPause())) return true;
          }
        }
      }
      // Comment AI tối đa commentPerPerson bài có nội dung rõ ràng (mỗi bài sinh
      // riêng 1 câu, guard bịa tên + bám bài từng câu, proof mới đếm).
      if (modeHasComment && !commentedOk) {
        let n = 0;
        for (const target of posts) {
          if (n >= cmtQuota) break;
          if (!(await alive(runId))) return true;
          if (!target.text || target.text.length < 20) continue;
          let cmt = "";
          let timedOut = false;
          try {
            const noNameClause = "\n\nTuyệt đối không nhắc tên người, địa danh hay số liệu không có trong bài viết. Chỉ bình luận về NỘI DUNG BÀI VIẾT dưới đây; nếu không có nội dung rõ ràng thì chỉ trả về đúng: EMPTY";
            const aiOut = await sendCancellable({
              action: "aiGenerateComment",
              postText: target.text.slice(0, 1500),
              prompt: String(cfg.prompt || "") + noNameClause,
              aiProfileId: cfg.profileId || "",
            }, runId, 150000);
            if (aiOut && aiOut.stopped) return true;
            if (aiOut && aiOut.timeout) timedOut = true;
            else if (aiOut && aiOut.ok && aiOut.r && aiOut.r.ok) cmt = String(aiOut.r.comment || "").trim();
          } catch (_) { timedOut = true; }
          if (!(await alive(runId))) return true;
          if (timedOut) { noteDead(key, "ai-timeout"); continue; }
          if (!cmt || cmt.trim().toUpperCase() === "EMPTY") { noteDead(key, "vague"); continue; }
          const wallName = (((document.querySelector("h1") || {}).innerText) || "").trim();
          const bad = warmHasForeignName(cmt, target.text, (pending.name || "") + " " + wallName);
          if (bad || !warmMatchesPost(cmt, target.text)) { noteDead(key, bad ? "badname" : "offtopic"); continue; }
          const r = await commentWithProof(target, cmt, runId);
          if (r === "stopped") return true;
          if (r === "ok") {
            n++;
            commentedOk = true;
            history[key] = Object.assign(history[key] || { at: now(), name: pending.name }, { at: now(), comment: true });
            if (dead[key]) delete dead[key];
            if (!(await postPause())) return true;
          } else {
            noteDead(key, r);
          }
        }
      }
      // Đếm NGƯỜI (khớp target "số bạn"): ai chuyển false→true trong lượt này mới +1.
      if (likedOk && !hadLike) doneLike++;
      if (commentedOk && !hadCmt) doneComment++;
      const needLike = modeHasLike && !likedOk;
      const needCmt = modeHasComment && !commentedOk;
      if (needLike && needCmt) {
        if (cfg.mode === "both" && (likedOk || commentedOk)) touched.delete(key);
        else skipped++;
      } else if (cfg.mode === "both" && (needLike || needCmt)) {
        touched.delete(key); // được 1/2: lần sau vào lại làm nốt
      }
      await LS.set({ friendWarmPendingWall: null });
      await persist();
      await setStatus(`Đã làm ấm ${pending.name}: Like ${doneLike} • Comment ${doneComment} • Bỏ qua ${skipped}`);
    } catch (e) {
      try { await LS.set({ friendWarmPendingWall: null }); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
    }
    return true;
  }

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m.action === "startFriendWarm") {
      (async () => {
        // Chặn chạy chồng với mọi luồng Facebook khác.
        const busy = await LS.get(["friendFoFActive", "friendFoFScanActive", "isRunning", "friendConfirmActive",
          "isFeedInteracting", "isAICommenting", "isGroupJoining", "isDiscoverJoining",
          "groupInteractActive", "groupCommentActive", "groupPostActive", "groupShareActive",
          "salesPostActive", "trendLearnActive", "trendPostActive"]);
        if (Object.values(busy).some(Boolean)) { send({ ok: false, error: "Hãy dừng luồng Facebook khác trước khi chạy Làm ấm." }); return; }
        const source = warmNormalizeSource((m.config && m.config.source) || {});
        if (!source) { send({ ok: false, error: "Hãy nhập link profile bạn nguồn (ô Link FoF ở trên) hoặc chọn nguồn trong DS bạn bè rồi Start lại." }); return; }
        const base = await getSyncCfg();
        const over = (m.config && typeof m.config === "object") ? m.config : {};
        const cfg = Object.assign(base, {
          mode: ["like", "comment", "both"].includes(over.mode) ? over.mode : base.mode,
          target: Number.isFinite(Number(over.target)) ? Math.max(1, Number(over.target)) : base.target,
          minMutual: Number.isFinite(Number(over.minMutual)) ? Math.max(0, Number(over.minMutual)) : base.minMutual,
          likePerPerson: Number.isFinite(Number(over.likePerPerson)) ? Math.max(1, Number(over.likePerPerson)) : base.likePerPerson,
          commentPerPerson: Number.isFinite(Number(over.commentPerPerson)) ? Math.max(1, Number(over.commentPerPerson)) : base.commentPerPerson,
          profileId: typeof over.profileId === "string" ? over.profileId : (base.profileId || ""),
          prompt: typeof over.prompt === "string" && over.prompt ? over.prompt : base.prompt,
        });
        const runId = m.runId || ("fw" + now());
        // Persist run TRƯỚC khi điều hướng (luật Start chung): reload/resume tự tiếp tục.
        if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
        await LS.set({
          friendWarmActive: true, friendWarmRunId: runId, friendWarmOwnerTabId: m.ownerTabId || 0,
          friendWarmConfig: cfg, friendWarmSource: source, friendWarmListUrl: "",
          friendWarmPhase: "source-profile", friendWarmQueue: [], friendWarmQIndex: 0,
          friendWarmDoneLike: 0, friendWarmDoneComment: 0, friendWarmSkipped: 0,
          friendWarmHistory: ((await getState()).friendWarmHistory) || {},
          friendWarmDead: ((await getState()).friendWarmDead) || {},
          friendWarmTouched: [], friendWarmPendingWall: null,
          friendWarmScrollRounds: 0, friendWarmEndConfirmations: 0,
          friendWarmLastDomProgressAt: now(), friendWarmWaitStartedAt: now(),
          friendWarmNextAllowedAt: 0, friendWarmLastShownSecond: 0,
          friendWarmOwnerFails: 0,
          friendWarmStatus: `Bắt đầu làm ấm từ nguồn ${source.name || source.key}…`,
        });
        runLoop(runId);
        send({ ok: true, runId });
      })();
      return true;
    }
    if (m.action === "resumeFriendWarm") {
      (async () => { const s = await getState(); if (s.friendWarmActive) runLoop(s.friendWarmRunId); send({ ok: true }); })();
      return true;
    }
    if (m.action === "stopFriendWarm") {
      (async () => {
        if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
        await LS.set({ friendWarmActive: false, friendWarmNextAllowedAt: 0, friendWarmPendingWall: null, friendWarmOwnerFails: 0, friendWarmStatus: "Đã dừng." });
        send({ ok: true });
      })();
      return true;
    }
    if (m.action === "resetFriendWarm") {
      (async () => {
        if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
        const keep = (m.keepHistory || m.keep === true) ? {} : { friendWarmHistory: {}, friendWarmDead: {} };
        await LS.set(Object.assign({
          friendWarmActive: false, friendWarmRunId: "", friendWarmOwnerTabId: 0,
          friendWarmSource: null, friendWarmListUrl: "", friendWarmPhase: "source-profile",
          friendWarmQueue: [], friendWarmQIndex: 0,
          friendWarmDoneLike: 0, friendWarmDoneComment: 0, friendWarmSkipped: 0,
          friendWarmTouched: [], friendWarmPendingWall: null,
          friendWarmScrollRounds: 0, friendWarmEndConfirmations: 0,
          friendWarmNextAllowedAt: 0, friendWarmLastShownSecond: 0,
          friendWarmStatus: "Đã reset.",
        }, keep));
        send({ ok: true });
      })();
      return true;
    }
  });

  // Entry sau mỗi lần load trang: wall pending trước, rồi resume vòng stream.
  // Chỉ owner tab chạy (background xác minh qua sender.tab).
  setTimeout(async () => {
    try {
      const s = await getState();
      if (!s.friendWarmActive || !s.friendWarmRunId) return;
      await trace("entry-timer");
      const verdict = await checkOwner(s.friendWarmRunId, 5);
      await trace("entry-owner:" + verdict);
      if (verdict === "stopped" || verdict === "not-owner") return;
      if (verdict !== "owner") { await ownerUnreachable(s.friendWarmRunId); return; }
      try { await LS.set({ friendWarmOwnerFails: 0 }); } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      if (activeLoopKey) return;
      // Đang ở wall của pending → xử lý tường rồi quay về DS.
      let pending = null;
      try { pending = (await LS.get("friendWarmPendingWall")).friendWarmPendingWall; } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      if (pending && pending.url) {
        try {
          if (new URL(location.href).href === new URL(pending.url).href) {
            const cfg0 = s.friendWarmConfig || {};
            const mm = Math.max(0, Number(cfg0.delayMin) || 0), mx = Math.max(mm, Number(cfg0.delayMax) || 0);
            await runWallPart(s.friendWarmRunId);
            const s2 = await readRunState(s.friendWarmRunId);
            if (!s2) return;
            // Xong 1 tường → sang tường kế trong queue, KHÔNG về lại DS.
            const qi = (Number(s2.friendWarmQIndex) || 0) + 1;
            await LS.set({
              friendWarmQIndex: qi,
              friendWarmNextAllowedAt: now() + rnd(mm, mx) * 60000,
              friendWarmStatus: `Đã làm ấm ${pending.name || pending.key} — sang tường tiếp theo…`,
            });
            runLoop(s.friendWarmRunId);
            return;
          }
        } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
        // Pending mà không ở đúng wall (redirect/lạc route) → bỏ pending, qua người kế.
        try {
          const s3 = await readRunState(s.friendWarmRunId);
          await LS.set({
            friendWarmPendingWall: null,
            friendWarmQIndex: (s3 ? Number(s3.friendWarmQIndex) || 0 : 0) + 1,
          });
        } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
      }
      runLoop(s.friendWarmRunId);
    } catch (_) { console.debug("[Auto vjp][friendWarm] bỏ qua lỗi:", _); }
  }, 1500);
})();
