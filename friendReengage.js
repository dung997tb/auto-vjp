/* friendReengage.js — Tab Lấy Lại Tương Tác (nick cá nhân).
 * State machine RIÊNG, không dùng chung logic feed.js/content.js.
 * - local:  friendReengageActive/RunId/OwnerTabId/Config/Index/DoneLike/DoneComment/DoneStory/Skipped/
 *           LikeHistory/CommentHistory/StoryHistory/DeadWalls/Cursor/Cycle/Status
 * - sync:   friendReengage*Config (mọi thông số chỉnh tay)
 * - Quy tắc: click != success (chỉ đếm sau proof FB), poll stop flag + runId,
 *   không sờ Messenger/chat, chỉ comment cấp cao, bỏ qua sponsored/reel.
 */
(function () {
  if (globalThis.__friendReengageLoaded) return;
  globalThis.__friendReengageLoaded = true;

  const LS = chrome.storage.local;
  const SYNC = chrome.storage.sync;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * Math.max(0, b - a);
  const now = () => Date.now();
  const DAY = 86400000;

  const DEFAULTS = {
    mode: "like", // like | comment | both | story
    likePerDay: 25, likePerFriend: 2,
    commentPerDay: 12, commentPerFriend: 1,
    likeSource: "new", commentSource: "liked", // new | liked | commented | both
    recentDays: 14, deadDays: 90,
    likeCooldownDays: 30, commentCooldownDays: 30,
    likeToCommentGapDays: 3, commentToLikeGapDays: 3,
    delayFriendMin: 3, delayFriendMax: 8, // phút
    delayPostMin: 30, delayPostMax: 60, // giây
    endMode: "stop", restDays: 10,
    prompt: "Đọc bài viết sau của bạn tôi và viết 1 bình luận ngắn (<25 từ) bằng tiếng Việt, nhắc chi tiết cụ thể trong bài + 1 câu hỏi mở thân thiện. Không bán hàng, không link, không hashtag, không sao chép nguyên văn. Tuyệt đối không nhắc tên người, địa danh hay số liệu không có trong bài viết.\n\nBài viết: {postText}",
    storyEnabled: true, storyPerDay: 20, storyViewSec: 5,
    storyReaction: "random", storyHours: 24,
    storyDelayMin: 20, storyDelayMax: 45,
    avatarOnly: false, skipLinkPost: true, skipReelPost: true, preferNew7d: true,
  };

  async function getSyncCfg() {
    let s = {};
    try { s = await SYNC.get(null); } catch (_) {}
    const cfg = {};
    for (const k of Object.keys(DEFAULTS)) {
      const key = "friendReengage" + k[0].toUpperCase() + k.slice(1);
      cfg[k] = s[key] !== undefined ? s[key] : DEFAULTS[k];
    }
    cfg.likePerDay = Math.min(100000, Math.max(1, Number(cfg.likePerDay) || 25));
    cfg.commentPerDay = Math.min(100000, Math.max(1, Number(cfg.commentPerDay) || 12));
    return cfg;
  }

  async function getState() {
    try {
      return await LS.get(["friendReengageActive", "friendReengageRunId", "friendReengageOwnerTabId",
        "friendReengageConfig", "friendReengageIndex", "friendReengageDoneLike", "friendReengageDoneComment",
        "friendReengageDoneStory", "friendReengageSkipped", "friendReengageLikeHistory",
        "friendReengageCommentHistory", "friendReengageStoryHistory", "friendReengageDeadWalls",
        "friendReengageCursor", "friendReengageCycle", "friendReengageStatus"]);
    } catch (_) { return {}; }
  }
  async function setStatus(text) {
    try { await LS.set({ friendReengageStatus: String(text || "") }); } catch (_) {}
  }
  async function alive(runId) {
    const s = await getState();
    if (!s.friendReengageActive) return false;
    if (runId && s.friendReengageRunId && s.friendReengageRunId !== runId) return false;
    return true;
  }
  // Chờ có kiểm tra stop flag + runId (mọi vòng chờ dài đều qua đây).
  async function waitCancellable(ms, runId) {
    const end = now() + ms;
    while (now() < end) {
      if (!(await alive(runId))) return false;
      await sleep(Math.min(1000, end - now()));
    }
    return true;
  }
  // Mọi chrome.runtime.sendMessage trong run đều qua đây: race với timeout +
  // poll stop/runId từng giây. Cổng message mất (SW restart giữa fetch AI) hay
  // provider treo đều không bao giờ treo run vĩnh viễn với Active=true; bấm
  // Dừng giữa lúc chờ AI cũng có tác dụng ngay. Trả về {stopped:true} |
  // {timeout:true} | {ok:true,r} | {ok:false,err}.
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
  function myTabId() { return (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) ? true : true; }

  // ---------- Nhận diện ----------
  function isSponsored(el) {
    const t = (el.innerText || "").slice(0, 400);
    return /Được tài trợ|Sponsored/i.test(t);
  }
  function actionLabel(el) {
    // Dùng textContent (không force layout) thay vì innerText — quét hàng nghìn nút
    // bằng innerText treo run nhiều phút vì mỗi lần đọc là một reflow (test live).
    return (((el.getAttribute && el.getAttribute("aria-label")) || el.textContent || "").trim().toLowerCase());
  }
  function isMainCommentLabel(label) {
    if (!label) return false;
    // Loại comment con ("Bình luận dưới tên..."), menu, và nút đính kèm trong composer
    // ("bình luận bằng nhãn dán/gif", sticker/emoji — bấm vào mở picker, không phải ô comment).
    if (/^(bình luận|comment)\s+(dưới|vào|của|by|on|to)\b/i.test(label)) return false;
    if (/(bằng|bởi|with|via|gif|nhãn dán|sticker|emoji|biểu tượng cảm xúc)/i.test(label)) return false;
    if (/^(viết\s+)?bình luận[\s.…]*$/i.test(label)) return true;
    if (/^(write a\s+)?comment[\s.…]*$/i.test(label)) return true;
    if (/^(viết|đăng)\s+bình luận/i.test(label)) return true;
    return false;
  }
  function isLikeLabel(label) {
    if (!label) return false;
    if (/[:\d]/.test(label)) return false; // "Thích: 8 người" là nút xem danh sách, không phải nút Like.
    return /^(thích|like)[\s.…]*$/i.test(label);
  }
  function isUnlikeSignal(label) {
    return /^(gỡ thích|bỏ thích|unlike| unlike)/i.test(label || "");
  }
  function isReplyComposer(box) {
    const label = ((box.getAttribute && box.getAttribute("aria-label")) || "") + " " + (box.placeholder || "");
    // GIỮ NGUYÊN matcher cũ: "Bình luận dưới tên X" là nhãn ô comment CHÍNH sau
    // khi bấm nút Bình luận (live cycle 15: loại nó gây nobox 6/6 tường). Ô reply
    // con đã bị loại ở tầng nút bởi isMainCommentLabel + guard thread postBarOf.
    return /Trả lời .*với vai trò|Reply as|Reply to/i.test(label);
  }
  // Từ thường hay viết hoa giữa câu — miễn kiểm tra tên bịa (chỉ miễn, không kết tội).
  // Key viết thường có dấu, khớp với raw.toLowerCase().
  const REENGAGE_COMMON_WORDS = { "bạn": 1, "mình": 1, "tôi": 1, "tao": 1, "tớ": 1, "ta": 1, "chúng": 1, "anh": 1, "chị": 1, "em": 1, "cô": 1, "chú": 1, "bác": 1, "ông": 1, "bà": 1, "thầy": 1, "cậu": 1, "mợ": 1, "dì": 1, "con": 1, "cháu": 1, "hôm": 1, "nay": 1, "mai": 1, "bài": 1, "viết": 1, "thật": 1, "quá": 1, "rất": 1, "hay": 1, "đẹp": 1, "tuyệt": 1, "chúc": 1, "mừng": 1, "cảm": 1, "ơn": 1, "xin": 1, "chào": 1, "ơi": 1, "nhé": 1, "nha": 1, "nè": 1, "đó": 1, "đây": 1, "vậy": 1, "thế": 1, "sao": 1, "gì": 1, "nào": 1, "mấy": 1, "mỗi": 1, "mọi": 1, "các": 1, "những": 1, "một": 1, "tết": 1, "xuân": 1, "việt": 1, "nam": 1, "quê": 1, "nhà": 1, "thích": 1, "yêu": 1, "nhớ": 1, "biết": 1, "thấy": 1, "chơi": 1, "làm": 1, "đi": 1 };
  // AI đôi khi bịa tên riêng không có trong bài (live: bài case 1660s mà comment
  // viết "góc chia sẻ về anh Tuân") — chặn trước khi bấm Đăng. Trả về từ vi phạm
  // hoặc chuỗi rỗng nếu sạch. Chỉ bỏ comment (an toàn), không bao giờ đăng bừa.
  function commentHasForeignName(cmt, postText, friendName) {
    const text = String(cmt || "").trim();
    if (!text) return "";
    const post = String(postText || "").toLowerCase();
    const friendTokens = {};
    String(friendName || "").toLowerCase().split(/[^a-zà-ỹ0-9]+/i).forEach(function (w) { if (w) friendTokens[w] = 1; });
    // 1) Cụm xưng hô + tên ("anh Tuân", "chị Lan"): tên phải có trong bài hoặc tên bạn.
    // Dùng \p{Lu}\p{Ll}+ thay vì range A-ZÀ-Ỹ: endpoint "Ỹ" (U+1EF8) nuốt luôn chữ
    // thường ơ/ư (U+01A1/U+01B0) khiến "bạn ơi" bị tưởng là tên riêng (bắt live).
    const addrRe = /(anh|chị|em|bạn|cô|chú|bác|ông|bà|thầy|cậu|mợ|dì|Anh|Chị|Em|Bạn|Cô|Chú|Bác|Ông|Bà|Thầy|Cậu|ANH|CHỊ|EM|BẠN)\s+(\p{Lu}\p{Ll}+)/g;
    let m = null;
    while ((m = addrRe.exec(text)) !== null) {
      const nm = m[2].toLowerCase();
      if (!friendTokens[nm] && post.indexOf(nm) < 0) return m[2];
    }
    // 2) Từ viết hoa giữa câu: bỏ từ đầu câu, còn lại phải có trong bài/tên bạn/từ thường.
    const parts = text.split(/[.?!…\n]+/);
    for (let s = 0; s < parts.length; s++) {
      const words = parts[s].split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const raw = words[i].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
        if (i === 0 || !/^[\p{Lu}][\p{L}]+$/u.test(raw)) continue;
        const low = raw.toLowerCase();
        if (REENGAGE_COMMON_WORDS[low]) continue;
        if (friendTokens[low]) continue;
        if (post.indexOf(low) >= 0) continue;
        return raw;
      }
    }
    return "";
  }
  // Stopword riêng cho kiểm tra bám sát: chỉ giữ từ chức năng + đại từ + thán từ.
  // (Không tái dùng REENGAGE_COMMON_WORDS vì bảng đó cố tình chứa cả tính từ
  // nội dung như "đẹp"/"hay"/"thích" để miễn kiểm tra tên bịa.)
  const REENGAGE_MATCH_STOP = { "bạn": 1, "mình": 1, "tôi": 1, "tao": 1, "tớ": 1, "ta": 1, "chúng": 1, "anh": 1, "chị": 1, "em": 1, "cô": 1, "chú": 1, "bác": 1, "ông": 1, "bà": 1, "thầy": 1, "cậu": 1, "mợ": 1, "dì": 1, "con": 1, "cháu": 1, "người": 1, "cái": 1, "những": 1, "các": 1, "một": 1, "như": 1, "với": 1, "và": 1, "là": 1, "của": 1, "cho": 1, "trong": 1, "trên": 1, "này": 1, "kia": 1, "đây": 1, "đó": 1, "hôm": 1, "nay": 1, "cũng": 1, "vậy": 1, "thế": 1, "sao": 1, "gì": 1, "nào": 1, "mấy": 1, "mỗi": 1, "mọi": 1, "khi": 1, "nếu": 1, "vì": 1, "để": 1, "rồi": 1, "sẽ": 1, "đã": 1, "đang": 1, "được": 1, "có": 1, "không": 1, "chưa": 1, "từ": 1, "đến": 1, "về": 1, "ơi": 1, "nhé": 1, "nha": 1, "nè": 1, "ạ": 1, "thật": 1, "quá": 1, "rất": 1, "lắm": 1 };
  // Tách token nội dung: chữ thường hóa, giữ từ dài >=3 ngoài stopword + số >=2 chữ số.
  function commentTokensForMatch(text) {
    const out = [];
    const seen = {};
    const words = String(text || "").toLowerCase().split(/[^a-zà-ỹ0-9]+/i);
    for (let i = 0; i < words.length; i++) {
      let w = words[i];
      if (!w || seen[w]) continue;
      // Mã lẫn số-chữ ("1660s", "71độ" gộp) quy về đầu số để "1660" khớp "1660s".
      const digits = /^(\d+)[a-zà-ỹ]+$/.exec(w);
      if (digits) w = digits[1];
      if (seen[w]) continue;
      if (/^\d+$/.test(w)) {
        if (w.length >= 2) { seen[w] = 1; out.push(w); }
        continue;
      }
      if (w.length < 3 || REENGAGE_MATCH_STOP[w]) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
  }
  // Comment phải chung ít nhất 1 token nội dung với bài viết, không thì coi là
  // chung chung/không bám bài → bỏ qua chứ không đăng bừa. Bài không trích được
  // token nào thì cho qua (không kết luận được, để guard tên bịa lo).
  function commentMatchesPost(cmt, postText) {
    const post = {};
    const pt = commentTokensForMatch(postText);
    for (let i = 0; i < pt.length; i++) post[pt[i]] = 1;
    if (!pt.length) return true;
    const ct = commentTokensForMatch(cmt);
    for (let i = 0; i < ct.length; i++) if (post[ct[i]]) return true;
    return false;
  }
  function isFacebookHost(url) {
    try {
      const h = new URL(String(url || ""), location.origin).hostname.toLowerCase();
      return h === "facebook.com" || h.endsWith(".facebook.com");
    } catch (_) { return false; }
  }
  function canonicalFriendKey(href) {
    if (!href) return "";
    try {
      const u = new URL(href, location.origin);
      // Chỉ nhận link nội bộ Facebook — link ngoài (youtube...) từng lọt vào queue
      // rồi kéo cả run ra khỏi Facebook và treo vô thời hạn (test live).
      const host = u.hostname.toLowerCase();
      if (!(host === "facebook.com" || host.endsWith(".facebook.com"))) return "";
      // Bọc outbound l.facebook.com/l.php?u=<link ngoài> — từng kéo run ra YouTube.
      if (u.pathname.toLowerCase().startsWith("/l.php")) return "";
      if (u.searchParams.has("u") && /l\.php/i.test(u.pathname)) return "";
      // Link bài viết/share (nhiều segment hoặc query post) không phải profile — loại ngay
      // để run không bao giờ điều hướng vào permalink rồi kẹt (đúng lỗi test live).
      const q = (u.search || "").toLowerCase();
      if (/comment_id|story_fbid|fbid/i.test(q)) return "";
      if (/\/(posts|permalink|photos|videos|reel|watch|stories|groups|events|marketplace|gaming)(\/|$)/i.test(u.pathname)) return "";
      const m = u.searchParams.get("id");
      if (u.pathname.includes("profile.php") && m) return "id:" + m;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length !== 1) return "";
      if (!parts.length) return "";
      if (["friends", "groups", "pages", "watch", "reel", "stories", "photo", "video"].includes(parts[0].toLowerCase())) return "";
      return "u:" + decodeURIComponent(parts[0]).toLowerCase();
    } catch (_) { return ""; }
  }
  function isProfileUrl(url) {
    if (!isFacebookHost(url)) return false;
    try {
      const u = new URL(String(url || ""), location.origin);
      if (u.pathname.toLowerCase().startsWith("/l.php")) return false;
      if (u.searchParams.has("u")) return false;
      if (u.pathname.includes("profile.php")) return !!u.searchParams.get("id");
      return u.pathname.split("/").filter(Boolean).length === 1;
    } catch (_) { return false; }
  }
  // Tìm khung cuộn thật của list bạn bè bằng HÀNH VI (chứa nhiều link bạn nhất trong
  // các div cuộn được), không phụ thuộc chuỗi tổ tiên của 1 card — vì walk theo
  // anchor từng trả về document trong run thật dù probe tay vẫn thấy DIV.
  function reengageListScroller() {
    let best = null, bestLinks = -1;
    let divs = [];
    try { divs = document.querySelectorAll("div"); } catch (_) { return document.scrollingElement || document.documentElement; }
    for (const el of divs) {
      try {
        if (el.clientHeight < 200) continue;
        if (el.scrollHeight <= el.clientHeight + 200) continue;
        const st = getComputedStyle(el);
        if (!/(auto|scroll)/i.test(st.overflowY || "")) continue;
        const links = el.querySelectorAll('a[href^="/"], a[href*="facebook.com/"]').length;
        if (links > bestLinks) { bestLinks = links; best = el; }
      } catch (_) {}
    }
    return best || document.scrollingElement || document.documentElement;
  }
  function reengageLastCard() {
    const anchors = Array.from(document.querySelectorAll('a[href*="facebook.com/"], a[href^="/"]')).filter((a) => {
      if (!a.isConnected) return false;
      const r = a.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      const t = (a.textContent || "").trim();
      if (t.length < 2 || t.length > 80) return false;
      return !!canonicalFriendKey(a.getAttribute("href"));
    });
    return anchors.length ? anchors[anchors.length - 1] : null;
  }
  // Cuộn trusted-wheel qua background debugger để kích Facebook lazy-load
  // (scrollIntoView/DOM-scroll thường không đủ — đúng bài học của scanner Bảng feed).
  async function reengageTrustedWheel(x, y, deltaY, runId) {
    try {
      const out = await sendCancellable({ action: "trustedMouse", kind: "wheel", x, y, deltaX: 0, deltaY }, runId, 15000);
      return !!(out && out.ok && out.r && out.r.ok);
    } catch (_) { return false; }
  }
  async function reengageScrollOnce(runId) {
    try {
      const scroller = reengageListScroller();
      const last = reengageLastCard();
      if (last && last.scrollIntoView) last.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
      const dist = Math.max(650, (scroller && scroller.clientHeight ? scroller.clientHeight : window.innerHeight) * 0.85);
      if (scroller && scroller !== document.documentElement && scroller !== document.body) {
        scroller.scrollBy({ top: dist, behavior: "auto" });
      }
      else window.scrollBy({ top: dist, behavior: "auto" });
      // Trusted wheel vào giữa khung list để Facebook chịu nhả batch tiếp theo.
      try {
        const r = (scroller && scroller.getBoundingClientRect) ? scroller.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + Math.min(r.height - 100, r.height * 0.7));
        await reengageTrustedWheel(x, y, 700, runId);
      } catch (_) {}
    } catch (_) {}
  }
  // Một lượt quét list: cuộn tới khi 3 vòng liên tiếp không tăng (tối đa rounds).
  // Trả về số bạn tối đa thấy được, -1 khi bị dừng giữa chừng.
  // Một lượt quét list: cuộn rồi CHỜ HYDRATION (href của hàng mới được React gắn
  // muộn hơn text 10-60s). Nghỉ khi 2 vòng liền không tăng số key hợp lệ.
  async function reengageScrollPass(runId, rounds) {
    let best = collectFriendLinks(400).length, flat = 0;
    for (let i = 0; i < (rounds || 8); i++) {
      if (!(await alive(runId))) return -1;
      await reengageScrollOnce(runId);
      if (!(await waitCancellable(5000, runId))) return -1;
      const n = collectFriendLinks(400).length;
      try { await LS.set({ friendReengageDbg: "pass i=" + i + " before=" + best + " after=" + n }); } catch (_) {}
      if (n > best) { best = n; flat = 0; }
      else { flat++; if (flat >= 2) break; }
    }
    return best;
  }
  // Quét link bạn bè trên trang /friends/list (chỉ đọc, không click).
  function collectFriendLinks(limit) {
    const out = [];
    const seen = new Set();
    const anchors = document.querySelectorAll('a[href*="facebook.com/"], a[href^="/"]');
    for (const a of anchors) {
      if (out.length >= (limit || 200)) break;
      if (!a.isConnected) continue;
      const r = a.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      const key = canonicalFriendKey(a.getAttribute("href"));
      if (!key || seen.has(key)) continue;
      const txt = (a.textContent || "").trim();
      if (txt.length < 2 || txt.length > 80) continue;
      if (/^Xem thêm|^See more|Kết bạn|Add friend|Nhắn tin|Message/i.test(txt)) continue;
      seen.add(key);
      out.push({ key, url: new URL(a.getAttribute("href"), location.origin).href, name: txt });
    }
    return out;
  }
  // Neo theo HÀNG nút cấp bài trong phạm vi HẸP (≤3 tầng từ nút Like): hàng hợp lệ
  // phải có đủ Like + Comment chính + Share và KHÔNG có Trả lời/báo cáo/giảm bậc.
  // (Leo xa hơn sẽ lọt vào comment lồng nhau của chính bài đó và nhận nhầm nút
  // Thích của comment con — đúng lỗi vừa bắt được khi test live.)
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
  function collectProfilePosts(maxN, cfg) {
    const out = [];
    const seenBars = new Set();
    const tStart = Date.now();
    const likeBtns = Array.from(document.querySelectorAll('[role="button"]')).filter((b) => b.offsetParent && isLikeLabel(actionLabel(b))).slice(0, 80);
    for (const lb of likeBtns) {
      if (out.length >= (maxN || 6)) break;
      if (Date.now() - tStart > 8000) break; // trần DOM-work: trang permalink khổng lồ không được treo run.
      try {
        const found = postBarOf(lb);
        if (!found || seenBars.has(found.bar)) continue;
        seenBars.add(found.bar);
        // Container bài để đọc text/link và xác minh proof: leo tối đa 6 tầng tìm permalink.
        let cont = found.bar;
        for (let d = 0; d < 6 && cont && cont.parentElement; d++) {
          if (cont.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')) break;
          cont = cont.parentElement;
        }
        if (!cont || isSponsored(cont)) continue;
        const link = cont.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
        // Thân bài thật cho AI: ưu tiên node story_message; nếu không có thì
        // clone container và stripping thread con/reply/composer (KHÔNG đụng
        // DOM live) để AI khỏi bình luận nhầm vào comment của người lạ —
        // bắt live: text đưa cho AI toàn số like + comment người khác, 0 chữ
        // thân bài (cont gốc vẫn dùng cho proof như cũ).
        let bodyText = "";
        try {
          const storyMsg = cont.querySelector('[data-ad-rendering-role="story_message"]');
          if (storyMsg) bodyText = (storyMsg.innerText || "").trim();
        } catch (_) {}
        if (!bodyText) {
          try {
            const clone = cont.cloneNode(true);
            clone.querySelectorAll('[role="article"], [role="dialog"], [contenteditable="true"], [role="textbox"]').forEach(n => { try { n.remove(); } catch (_) {} });
            // Rác còn lại sau stripping: đếm số (167…), nhãn nút/bộ lọc bằng cả
            // 2 ngôn ngữ UI. innerText lúc có lúc không xuống dòng (layout gộp
            // dính kiểu "1674332Xem thêm bình luận…") nên lọc 2 lớp: từng dòng
            // + quét blob nhiều-từ (không đụng từ đơn trong văn xuôi). Tường
            // ảnh-only về rỗng → SKIP-short trước khi gọi AI (đỡ tốn quota,
            // không comment bừa vào caption ảnh).
            const UI_NOISE_LINE = /^(?:[\d\s.,▪·•|×x+]+|xem thêm bình luận|see more comments?|xem .* câu trả lời|view .* repl(?:y|ies)|trả lời|reply|thích|like|chia sẻ|share|gửi nội dung này.*|bình luận( dưới tên.*)?|comments?( as.*)?|viết bình luận|write (a )?comment|phù hợp nhất|mới nhất|mới|relevant|newest|all comments?|tất cả bình luận)$/i;
            const UI_NOISE_BLOB = /xem thêm bình luận|see more comments?|xem \d+ câu trả lời|view \d+ repl(?:y|ies)|bình luận dưới tên[^.!?]*|comment as[^.!?]*|viết bình luận|write a comment|gửi nội dung này[^.!?]*|phù hợp nhất|tất cả bình luận|all comments?/gi;
            const rawClone = String(clone.innerText || "");
            const kept = rawClone.split(/\r?\n/).map(s => s.trim()).filter(s => s && !UI_NOISE_LINE.test(s));
            bodyText = kept.join("\n").replace(UI_NOISE_BLOB, " ").replace(/\s+/g, " ").trim();
            if (/^[\d\s.,▪·•|×+]+$/.test(bodyText)) bodyText = "";
          } catch (_) { bodyText = ""; }
        }
        const text = bodyText.slice(0, 2000);
        const href = link ? link.href : "";
        if (cfg.skipReelPost && /\/(reel|watch)\//i.test(href)) continue;
        if (text.length < 2 && !cont.querySelector("img,video")) continue;
        const alreadyLiked = Array.from(found.bar.querySelectorAll('[role="button"]')).some((b) => isUnlikeSignal(actionLabel(b)));
        out.push({ art: cont, text, href, likeBtn: found.like, commentBtn: found.cmt, alreadyLiked });
      } catch (_) {}
    }
    return out;
  }
  function findCommentButton(art) {
    if (!art || !art.isConnected) return null;
    const btns = Array.from(art.querySelectorAll('[role="button"]')).filter((b) => b.offsetParent && !b.closest("ul"));
    const hit = btns.find((b) => isMainCommentLabel(actionLabel(b)));
    if (hit) return hit;
    // Fallback: node text thuần ("Bình luận", "Viết bình luận").
    const spans = Array.from(art.querySelectorAll("div, span, a")).filter((el) => el.offsetParent && el.children.length <= 2);
    return spans.find((el) => /^(viết\s+)?bình luận$|^comment$/i.test(((el.innerText || el.textContent) || "").trim())) || null;
  }
  function findTopComposer(scopeEl) {
    const boxes = Array.from((scopeEl || document).querySelectorAll('[contenteditable="true"], [role="textbox"]'));
    for (const b of boxes) {
      if (!b.isConnected || !b.offsetParent) continue;
      const label = (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("placeholder") || "");
      if (/Nhắn tin|Message|Messenger|Tìm kiếm|Search/i.test(label)) continue;
      // Ô "Hãy viết gì đó cho X..." là ô ĐĂNG BÀI lên tường người khác — tuyệt đối không gõ vào.
      if (/hãy viết gì đó|write something|viết gì đó cho|tạo bài|create post/i.test(label)) continue;
      if (isReplyComposer(b)) continue; // chỉ comment cấp cao
      if (/Bình luận|Comment|Viết/i.test(label)) return b;
    }
    return boxes.find((b) => {
      if (!b.isConnected || !b.offsetParent || isReplyComposer(b)) return false;
      const label = (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("placeholder") || "");
      return !/Nhắn tin|Message|Messenger|Tìm kiếm|Search|hãy viết gì đó|write something|tạo bài|create post/i.test(label);
    }) || null;
  }

  // ---------- Proof ----------
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
        if (!likeBtn.isConnected) return true; // FB re-render sau like = đã nhận
        if (likeBtn.getAttribute("aria-pressed") === "true" && before !== "true") return true;
      }
      // Dự phòng: một số tường không dùng aria-pressed mà đổi nhãn hàng nút
      // sang "Bỏ thích/Gỡ thích" sau khi nhận like — vẫn là proof của Facebook.
      try {
        let node = likeBtn.parentElement;
        for (let d = 0; d < 3 && node; d++, node = node.parentElement) {
          const btns = node.querySelectorAll('[role="button"]');
          for (const b of btns) {
            if (isUnlikeSignal(actionLabel(b))) return true;
          }
        }
      } catch (_) {}
      // Nhìn lại 1 lần: nếu đã true từ trước thì coi như đã like rồi (không đếm trùng ở caller).
      return likeBtn.getAttribute("aria-pressed") === "true";
    } catch (_) { return false; }
  }
  async function commentWithProof(cont, text, runId) {
    try {
      const art = cont.art || cont;
      const btn = cont.commentBtn || findCommentButton(art);
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
      const rRes = await UC.sendProofDwell({
        box, commentScope: scope, text, proof: needle,
        tagEntity: null, tagConfig: null,
        alive: () => alive(runId),
        onEvent: () => {},
        clearDraft: () => { try { box.blur(); } catch (_) {} },
        findSend: () => Array.from(scope.querySelectorAll("[aria-label]"))
          .find((b) => /^(Đăng|Gửi|Post)$/i.test((b.getAttribute("aria-label") || "").trim()) && b.isConnected) || null,
        sendEnter: () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); return true; },
        proofExists: (root) => {
          if (!needle) return false;
          const hay = ((root === document ? document.body.innerText : root.innerText) || "").replace(/\s+/g, " ");
          return hay.includes(needle);
        },
        proofRoots: () => [art.isConnected ? art : document, document],
        scrollIntoView: () => { try { art.scrollIntoView({ block: "center" }); } catch (_) {} },
        onCounted: () => true,
      });
      if (rRes === true) return "ok";
      if (rRes === "stopped") return "stopped";
      return "noproof";
    } catch (_) { return "error"; }
  }

  // ---------- Story: chỉ xem + thả tim trong đúng viewer, tuyệt đối không rep ----------
  function storyVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== "hidden";
    } catch (_) { return false; }
  }
  function findStoryViewer() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(storyVisible);
    for (let i = dialogs.length - 1; i >= 0; i--) {
      const dialog = dialogs[i];
      const close = Array.from(dialog.querySelectorAll('[aria-label]')).some((el) => {
        const label = (el.getAttribute("aria-label") || "").trim();
        return storyVisible(el) && /^(đóng|close)(\s+(story|câu chuyện))?$/i.test(label);
      });
      const media = Array.from(dialog.querySelectorAll("img,video,canvas")).some((el) => {
        if (!storyVisible(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 80;
      });
      // Viewer Story live có close + media; ô trả lời Messenger không được dùng
      // làm bằng chứng Story hay đích nhập liệu.
      if (close && media) return dialog;
    }
    return null;
  }
  function closeStoryViewer() {
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (_) {}
  }
  async function storyInteract(runId, cfg) {
    try {
      if (!cfg.storyEnabled) return "off";
      if (!isProfileUrl(location.href)) return "wrong-route";
      const main = document.querySelector('[role="main"]') || document.querySelector("main") || document;
      const storyLink = Array.from(main.querySelectorAll('a[href*="/stories/"]')).find(storyVisible);
      if (!storyLink) return "nostory";
      storyLink.scrollIntoView({ block: "center" });
      if (!(await waitCancellable(600, runId))) return "stopped";
      storyLink.click();

      // Chỉ công nhận đã xem nếu Facebook thực sự mở viewer có nội dung, không
      // chỉ vì đã click link hoặc chờ đủ giây trên một trang rỗng.
      let dialog = null;
      const loadUntil = now() + 7000;
      while (now() < loadUntil) {
        if (!(await alive(runId))) return "stopped";
        dialog = findStoryViewer();
        if (dialog) break;
        await sleep(250);
      }
      if (!dialog) return "no-viewer";

      const viewMs = Math.max(3000, Number(cfg.storyViewSec) * 1000 || 5000);
      const viewUntil = now() + viewMs;
      while (now() < viewUntil) {
        if (!(await alive(runId))) return "stopped";
        if (!findStoryViewer()) return "viewer-closed";
        await sleep(Math.min(500, viewUntil - now()));
      }
      dialog = findStoryViewer();
      if (!dialog) return "viewer-closed";

      if (!cfg.storyReaction || cfg.storyReaction === "none") {
        closeStoryViewer();
        return "viewed";
      }

      // Chỉ tìm Reaction bên trong viewer Story. Không bao giờ lấy nút Like của
      // bài nền hoặc nút trả lời/Messenger ở phía dưới viewer.
      const labels = cfg.storyReaction === "like"
        ? /^(thích|like)$/i
        : /^(thích|like|yêu thích|love|thương thương|haha|wow|buồn|phẫn nộ)$/i;
      const buttons = Array.from(dialog.querySelectorAll('button,[role="button"],[aria-label]')).filter(storyVisible);
      const choices = buttons.filter((el) => labels.test((el.getAttribute("aria-label") || el.textContent || "").trim()));
      const reaction = cfg.storyReaction === "random" && choices.length
        ? choices[Math.floor(Math.random() * choices.length)]
        : choices[0];
      if (!reaction) {
        closeStoryViewer();
        return "viewed"; // xem được nhưng viewer không có reaction an toàn, không click ngoài viewer
      }
      const beforePressed = reaction.getAttribute("aria-pressed");
      if (beforePressed === "true" || isUnlikeSignal(actionLabel(reaction))) {
        closeStoryViewer();
        return "ok"; // Facebook đã thể hiện reaction đang bật
      }
      reaction.click();
      for (let i = 0; i < 20; i++) {
        if (!(await alive(runId))) return "stopped";
        await sleep(500);
        const current = findStoryViewer();
        if (!current) { closeStoryViewer(); return "viewed"; }
        const currentButtons = Array.from(current.querySelectorAll('button,[role="button"],[aria-label]')).filter(storyVisible);
        const confirmed = currentButtons.some((el) =>
          el.getAttribute("aria-pressed") === "true" || isUnlikeSignal(actionLabel(el))
        );
        if (confirmed) { closeStoryViewer(); return "ok"; }
      }
      closeStoryViewer();
      return "viewed"; // đã xem, nhưng không có proof reaction nên không ghi là đã thả tim
    } catch (_) { return "error"; }
  }

  function successfulHistory(history, key) {
    const h = history && history[key];
    return h && !h.skip && !h.attempted && Number(h.at) > 0 ? h : null;
  }
  function withinDays(history, days) {
    const n = Number(days) || 0;
    return !!history && n > 0 && (now() - Number(history.at || 0)) < n * DAY;
  }
  function sourceAllows(action, key, cfg, likeHist, cmtHist, runId) {
    const liked = successfulHistory(likeHist, key);
    const commented = successfulHistory(cmtHist, key);
    if (cfg.mode === "both") {
      // Combined mode is an atomic fresh pair. It may resume the second action
      // only when the first success belongs to this same run; prior recent
      // history blocks the friend to avoid repeating just one half of the pair.
      const recentLike = withinDays(liked, cfg.likeCooldownDays) && liked.runId !== runId;
      const recentComment = withinDays(commented, cfg.commentCooldownDays) && commented.runId !== runId;
      return !recentLike && !recentComment;
    }
    if (action === "like") {
      const source = cfg.likeSource || "new";
      const inSource = source === "commented" ? !!commented : source === "both" ? true : !liked;
      if (!inSource || withinDays(liked, cfg.likeCooldownDays)) return false;
      if (withinDays(commented, cfg.commentToLikeGapDays)) return false;
      return true;
    }
    const source = cfg.commentSource || "new";
    const inSource = source === "liked" ? !!liked : source === "both" ? true : !commented;
    if (!inSource || withinDays(commented, cfg.commentCooldownDays)) return false;
    if (withinDays(liked, cfg.likeToCommentGapDays)) return false;
    return true;
  }
  function sourcePriority(action, key, cfg, likeHist, cmtHist) {
    if (cfg.mode === "both") return 0;
    if (action === "like" && cfg.likeSource === "both") return successfulHistory(cmtHist, key) ? 0 : 1;
    if (action === "comment" && cfg.commentSource === "both") return successfulHistory(likeHist, key) ? 0 : 1;
    return 0;
  }

  // ---------- Tường chết (dead-wall): nhớ tường đã quét để lần sau bỏ qua ngay trên list ----------
  // Vấn đề: skip (no-post/nobox/...) trước đây chỉ ghi marker `:d<cycle>` nên sang lần Start
  // mới (cycle tăng) tool lại vào từng tường quét lại từ đầu: navigate + hydrate ~15s + delay
  // hàng phút cho mỗi bạn đã biết là chết. DeadWalls là map riêng
  // `{friendKey: {at, reason, strikes, runId}}`, tách khỏi history success để không làm sai
  // cooldown/gap/DS hiển thị (base success không bao giờ bị ghi đè bằng skip).
  // - reason xác định ("no-post": tường trắng sau 5 lượt hydrate; "bad-profile": URL không
  //   phải profile) → bỏ qua ngay trong TTL.
  // - reason tạm thời (nobox/noproof/noai/...) → cần >= 2 strikes mới bỏ qua (trừ hao 1 lần load lỗi).
  // - TTL = ô "Bỏ nick chết" (deadDays, 0 = tắt = luôn thử lại); Story xoay theo ngày nên TTL
  //   Story bị chặn trần 7 ngày.
  // - Tương tác success (Like/Comment có proof) xóa entry (tường đã chứng minh còn sống).
  const DEAD_WALL_CERTAIN = { "no-post": 1, "bad-profile": 1 };
  const DEAD_WALL_STORY_TTL_CAP = 7;
  function deadWallEntry(map, key) {
    const e = map && map[key];
    return e && Number(e.at) > 0 ? e : null;
  }
  function deadWallTtlDays(cfg, forStory) {
    const t = Number(cfg && cfg.deadDays) || 0;
    if (t <= 0) return 0;
    return forStory ? Math.min(t, DEAD_WALL_STORY_TTL_CAP) : t;
  }
  function isDeadWall(map, key, forStory, cfg) {
    const e = deadWallEntry(map, key);
    if (!e) return false;
    const ttl = deadWallTtlDays(cfg, forStory);
    if (ttl <= 0) return false;
    if (now() - Number(e.at) >= ttl * DAY) return false;
    if (DEAD_WALL_CERTAIN[e.reason]) return true;
    return (Number(e.strikes) || 0) >= 2;
  }
  function isDeadWallAny(map, key, cfg) {
    return isDeadWall(map, key, false, cfg) || isDeadWall(map, key, true, cfg);
  }
  function nextDeadWallEntry(map, key, reason, runId, nowMs) {
    const prev = deadWallEntry(map, key);
    return { at: nowMs, reason: String(reason || "skip"), strikes: (prev ? Number(prev.strikes) || 0 : 0) + 1, runId: runId || "" };
  }
  // Gom mọi điều kiện "còn việc để làm với nick này" vào một chỗ để nhánh list,
  // nhánh cursor cũ và nhánh vừa-vào-tường dùng chung một logic đối chiếu.
  function reengageWants(key, ctx) {
    const cfg = (ctx && ctx.cfg) || {};
    const mode = String(cfg.mode || "like");
    const modeHasLike = mode === "like" || mode === "both";
    const modeHasComment = mode === "comment" || mode === "both";
    const storyOn = (mode === "story" || !!cfg.storyEnabled) && !!cfg.storyEnabled;
    const cycleKey = key + ":d" + ctx.cycle;
    const wLike = modeHasLike && ctx.doneLike < ctx.likeTarget && !ctx.likeHist[cycleKey] && sourceAllows("like", key, cfg, ctx.likeHist, ctx.cmtHist, ctx.runId) && !isDeadWall(ctx.deadWalls, key, false, cfg);
    const wCmt = modeHasComment && ctx.doneCmt < ctx.cmtTarget && !ctx.cmtHist[cycleKey] && sourceAllows("comment", key, cfg, ctx.likeHist, ctx.cmtHist, ctx.runId) && !isDeadWall(ctx.deadWalls, key, false, cfg);
    const wStory = storyOn && ctx.doneStory < ctx.storyTarget && !ctx.storyHist[cycleKey] && !isDeadWall(ctx.deadWalls, key, true, cfg);
    return [wLike, wCmt, wStory];
  }

  // Chống 2 vòng lặp cùng runId chạy song song trong 1 tab (resume-timer +
  // start-message đến gần nhau sau điều hướng). Context mới sau reload có cờ riêng.
  let activeLoopKey = "";
  async function runLoop(runId) {
    if (activeLoopKey === runId) return;
    activeLoopKey = runId;
    try {
    await runLoopInner(runId);
    } finally {
      if (activeLoopKey === runId) activeLoopKey = "";
    }
  }
  async function runLoopInner(runId) {
    const traceKey = "friendReengageTrace";
    const trace = async (msg) => { try { const s = await LS.get(traceKey); const arr = Array.isArray(s[traceKey]) ? s[traceKey] : []; arr.push(Date.now() + " " + msg); await LS.set({ [traceKey]: arr.slice(-40) }); } catch (_) {} };
    await trace("ENTER " + runId + " @ " + location.href.slice(0, 60));
    const st0 = await getState();
    if (st0.friendReengageOwnerTabId && st0.friendReengageOwnerTabId !== 0) {
      // Chỉ owner tab được chạy (reload-resume đúng tab). Timeout thì cho chạy
      // tiếp (guard chống double-run chỉ là best-effort; kẹt ở đây còn tệ hơn).
      try {
        const tabOk = await sendCancellable({ action: "friendReengageAmIOwner", runId }, runId, 10000);
        if (tabOk && tabOk.stopped) return;
        if (tabOk && tabOk.ok && tabOk.r && tabOk.r.ok === false) return;
      } catch (_) {}
    }
    let cfg = (await getState()).friendReengageConfig || await getSyncCfg();
    let s = await getState();
    let likeHist = s.friendReengageLikeHistory || {};
    let cmtHist = s.friendReengageCommentHistory || {};
    let storyHist = s.friendReengageStoryHistory || {};
    let deadWalls = s.friendReengageDeadWalls || {};
    let idx = Number(s.friendReengageIndex) || 0;
    let doneLike = Number(s.friendReengageDoneLike) || 0;
    let doneCmt = Number(s.friendReengageDoneComment) || 0;
    let doneStory = Number(s.friendReengageDoneStory) || 0;
    let skipped = Number(s.friendReengageSkipped) || 0;
    let cursor = s.friendReengageCursor || "";
    const cycle = Number(s.friendReengageCycle) || 1;

    const modeHasLike = cfg.mode === "like" || cfg.mode === "both";
    const modeHasComment = cfg.mode === "comment" || cfg.mode === "both";
    const modeHasStory = cfg.mode === "story";
    const likeTarget = modeHasLike ? Number(cfg.likePerDay) || 0 : 0;
    const cmtTarget = modeHasComment ? Number(cfg.commentPerDay) || 0 : 0;
    const storyTarget = cfg.storyEnabled ? Number(cfg.storyPerDay) || 0 : 0;

    // Context tươi cho reengageWants (done/counters đọc tại thời điểm gọi).
    function wantsCtx() {
      return {
        cfg, runId, cycle, doneLike, likeTarget, doneCmt, cmtTarget,
        doneStory, storyTarget, likeHist, cmtHist, storyHist, deadWalls,
      };
    }
    async function persistDeadWalls() { try { await LS.set({ friendReengageDeadWalls: deadWalls }); } catch (_) {} }
    async function noteDeadWall(key, reason) {
      if (!key) return;
      deadWalls[key] = nextDeadWallEntry(deadWalls, key, reason, runId, now());
      // Dọn entry hết hạn để map không phình vô hạn.
      try {
        const maxTtl = Math.max(Number(cfg.deadDays) || 0, DEAD_WALL_STORY_TTL_CAP + 1) * DAY;
        const t = now();
        for (const k of Object.keys(deadWalls)) {
          const e = deadWalls[k];
          if (!e || !Number(e.at) || (t - Number(e.at)) >= maxTtl) delete deadWalls[k];
        }
      } catch (_) {}
      await persistDeadWalls();
    }
    async function clearDeadWall(key) {
      if (key && deadWalls[key]) { delete deadWalls[key]; await persistDeadWalls(); }
    }
    // Nhật ký AI I/O gần nhất (1 bản ghi, ghi đè) để chẩn đoán "comment chưa sát
    // bài": xem AI đã thấy postText gì và trả về comment gì. Chỉ text, không key.
    async function logAiExchange(postText, comment, verdict) {
      try { await LS.set({ friendReengageLastAi: { at: now(), runId, verdict: String(verdict || ""), post: String(postText || "").slice(0, 300), comment: String(comment || "").slice(0, 300) } }); } catch (_) {}
    }

    const onFriendsList = /\/friends(\/list)?\/?(\?|$)/.test(location.pathname);
    // Nếu chưa ở danh sách bạn bè và chưa có cursor công việc -> về list để quét tới đâu làm tới đó.
    if (!onFriendsList && !cursor && !(doneLike || doneCmt)) {
      await setStatus("Đang mở danh sách bạn bè…");
      location.href = "https://www.facebook.com/friends/list/";
      return;
    }

    let emptyRounds = 0;
    let deadPasses = 0;
    try { await LS.set({ friendReengageDbgLoop: "loop@ " + location.href.slice(0, 80) + " a=" + document.querySelectorAll("a").length + " t=" + Date.now() }); } catch (_) {}
    const trace2 = async (m) => { try { const s = await LS.get(traceKey); const a = Array.isArray(s[traceKey]) ? s[traceKey] : []; a.push(Date.now() + " " + m); await LS.set({ [traceKey]: a.slice(-40) }); } catch (_) {} };
    // Lưới an toàn ngoài cùng: lỗi bất ngờ (DOM Facebook đổi, exception lẻ)
    // thì dừng sạch với trạng thái rõ ràng — không bao giờ treo Active=true
    // vĩnh viễn như trước.
    try {
    while (await alive(runId)) {
      if (doneLike >= likeTarget && doneCmt >= cmtTarget && doneStory >= storyTarget) { await trace2("DONE-CHECK-HIT"); await finishRun(runId, "done"); return; }
      // 1) Thu thập ứng viên trên trang hiện tại (friends list) hoặc tiếp tục cursor profile.
      let candidates = [];
      await trace2("PASS path=" + location.pathname.slice(0, 40) + " cursor=" + String(cursor || "").slice(0, 40));
      if (/\/friends(\/list)?\/?(\?|$)/.test(location.pathname)) {
        // Trang vừa tải (đặc biệt sau restart lạnh) list chưa dựng hàng nào — vừa
        // đợi vừa huých nhẹ (wheel + cuộn) tới 60s để batch đầu tiên xuất hiện.
        // (KHÔNG khai báo lại candidates ở đây — từng shadow biến ngoài làm rỗng
        // kết quả quét và run chết yểu dù quét được 300+ bạn.)
        const settleT0 = Date.now();
        for (let w = 0; w < 20; w++) {
          candidates = collectFriendLinks(400);
          if (candidates.length) break;
          await reengageScrollOnce(runId);
          const w0 = Date.now();
          const wok = await waitCancellable(3000, runId);
          await trace("settle w=" + w + " cands=" + candidates.length + " waitMs=" + (Date.now() - w0) + " wok=" + wok);
          if (!wok) return;
        }
        try { await LS.set({ friendReengageDbgLoop: "SETTLE doneMs=" + (Date.now() - settleT0) + " cands=" + candidates.length }); } catch (_) {}
        // Quét top-down tới đâu làm tới đó (KHÔNG cuộn sâu gom hết list trước —
        // Facebook tái chế các hàng đã cuộn qua làm mất href, cuộn sâu xong quay
        // lại thì còn 0 link hợp lệ). Chỉ cuộn thêm khi trong view <15 bạn HOẶC
        // toàn bộ view đã chạm vòng này / đã có trong DS tương tác (kể cả tường chết).
        if (candidates.length < 15 || candidates.every((f) => { const w = reengageWants(f.key, wantsCtx()); return !w[0] && !w[1] && !w[2]; })) {
          const seen = await reengageScrollPass(runId, 4);
          if (seen < 0) return;
          candidates = collectFriendLinks(400);
        }
        await LS.set({ friendReengageStatus: "Đã quét " + candidates.length + " bạn." });
      } else if (cursor && cursor.startsWith("http")) {
        if (!isProfileUrl(cursor)) {
          await LS.set({ friendReengageCursor: "" });
          location.href = "https://www.facebook.com/friends/list/";
          return;
        }
        const cursorKey = canonicalFriendKey(cursor) || cursor;
        // Đủ target rồi thì kết thúc ngay, khỏi tốn 1 lượt điều hướng về list.
        if (doneLike >= likeTarget && doneCmt >= cmtTarget && doneStory >= storyTarget) { await finishRun(runId, "done"); return; }
        {
          // Cursor cũ (hôm qua/reload) trỏ nick đã tương tác → xóa cursor, về list
          // lướt tiếp, không vào tường.
          const cw = reengageWants(cursorKey, wantsCtx());
          if (!cw[0] && !cw[1] && !cw[2]) {
            await LS.set({ friendReengageCursor: "" });
            location.href = "https://www.facebook.com/friends/list/";
            return;
          }
        }
        candidates = [{ key: cursorKey, url: cursor, name: "" }];
      } else {
        await setStatus("Mở danh sách bạn bè để tiếp tục (cursor hôm qua)…");
        location.href = "https://www.facebook.com/friends/list/";
        return; // reload-resume ở owner tab sau điều hướng
      }
      if (!candidates.length) {
        emptyRounds++;
        try { await LS.set({ friendReengageDbgLoop: "EMPTY#" + emptyRounds + "@ " + location.href.slice(0, 80) + " a=" + document.querySelectorAll("a").length + " t=" + Date.now() }); } catch (_) {}
        await trace2("EMPTY#" + emptyRounds);
        if (emptyRounds >= 5) { await finishRun(runId, "empty"); return; }
        await setStatus("Chưa thấy bạn nào, chờ Facebook tải…");
        if (!(await waitCancellable(4000, runId))) return;
        continue;
      }
      // Chế độ "Cả 2" xử lý từng bạn mới thành một cặp. Ở chế độ đơn, lựa chọn
      // "Cả 2 (ưu tiên ...)" đưa tập lịch sử tương ứng lên trước nhưng vẫn giữ
      // nguyên thứ tự bạn bè trong mỗi nhóm.
      if (cfg.mode === "like" && cfg.likeSource === "both") {
        candidates.sort((a, b) => sourcePriority("like", a.key, cfg, likeHist, cmtHist) - sourcePriority("like", b.key, cfg, likeHist, cmtHist));
      } else if (cfg.mode === "comment" && cfg.commentSource === "both") {
        candidates.sort((a, b) => sourcePriority("comment", a.key, cfg, likeHist, cmtHist) - sourcePriority("comment", b.key, cfg, likeHist, cmtHist));
      }
      // 2) Lọc theo DS riêng + cooldown (like/comment/story độc lập).
      let progressed = false;
      let nFiltered = 0, nWant = 0;
      for (const f of candidates) {
        if (!(await alive(runId))) return;
        if (doneLike >= likeTarget && doneCmt >= cmtTarget && doneStory >= storyTarget) { await finishRun(runId, "done"); return; }
        const cycleKey = f.key + ":d" + cycle;
        // Đối chiếu DS đã tương tác NGAY trên list: nick đã success còn cooldown,
        // tường đã biết chết còn TTL, hoặc đã chạm vòng này → bỏ qua luôn, không
        // vào tường, không hydrate, không delay — chỉ lướt tiếp.
        const [wantLike, wantCmt, wantStory] = reengageWants(f.key, wantsCtx());
        // Chặn lặp trong vòng: đã chạm vòng này thì bỏ qua.
        if (!wantLike && !wantCmt && !wantStory) { nFiltered++; continue; }
        nWant++;
        // 3) Vào tường bạn (điều hướng thật, resume sau load).
        deadPasses = 0; // thấy bạn mới = list còn sống, reset bộ đếm hết vòng.
        if (!isProfileUrl(f.url)) {
          skipped++;
          const at = now();
          if (wantLike) likeHist[cycleKey] = { at, skip: 1, reason: "bad-profile", runId };
          if (wantCmt) cmtHist[cycleKey] = { at, skip: 1, reason: "bad-profile", runId };
          if (wantStory) storyHist[cycleKey] = { at, skip: 1, reason: "bad-profile", runId };
          await noteDeadWall(f.key, "bad-profile");
          await LS.set({ friendReengageLikeHistory: likeHist, friendReengageCommentHistory: cmtHist, friendReengageStoryHistory: storyHist, friendReengageSkipped: skipped });
          if (/\/friends(\/list)?\/?(\?|$)/.test(location.pathname)) continue;
          location.href = "https://www.facebook.com/friends/list/";
          return;
        }
        await LS.set({ friendReengageCursor: f.url, friendReengageStatus: "Đang xử lý: " + (f.name || f.key) });
        if (new URL(location.href).href !== new URL(f.url).href) {
          location.href = f.url;
          return; // tiếp tục sau reload ở owner tab
        }
        // Vừa vào tường đã đối chiếu lại DS tương tác bằng nick của URL: nếu không
        // còn việc gì (success còn cooldown / tường đã biết chết / đã chạm vòng này)
        // thì thoát NGAY về list, không hydrate/cuộn quét bài tốn 15-20s, không delay
        // bạn. Không tăng skipped (đây là lọc, không phải lần thử).
        {
          const ew = reengageWants(f.key, wantsCtx());
          if (!ew[0] && !ew[1] && !ew[2]) {
            const at = now();
            if (modeHasLike && doneLike < likeTarget && !likeHist[cycleKey]) { likeHist[cycleKey] = { at, skip: 1, reason: "already-known", runId }; }
            if (modeHasComment && doneCmt < cmtTarget && !cmtHist[cycleKey]) { cmtHist[cycleKey] = { at, skip: 1, reason: "already-known", runId }; }
            if ((modeHasStory || cfg.storyEnabled) && cfg.storyEnabled && doneStory < storyTarget && !storyHist[cycleKey]) { storyHist[cycleKey] = { at, skip: 1, reason: "already-known", runId }; }
            try { await LS.set({ friendReengageLikeHistory: likeHist, friendReengageCommentHistory: cmtHist, friendReengageStoryHistory: storyHist }); } catch (_) {}
            idx++;
            try { await LS.set({ friendReengageIndex: idx }); } catch (_) {}
            location.href = "https://www.facebook.com/friends/list/";
            return;
          }
        }
        if (!(await waitCancellable(3000, runId))) return;
        // Chỉ cần bài khi đang chạy Like/Comment; Story-only không phụ thuộc feed.
        let posts = [];
        if (wantLike || wantCmt) {
          // Chờ tường hydrate: nút Like/Comment render muộn — quét lại tối đa 5 lượt,
          // mỗi lượt cuộn nhẹ kích render. Vẫn trắng mới kết luận không có bài.
          for (let h = 0; h < 5; h++) {
            posts = collectProfilePosts(6, cfg);
            if (posts.length) break;
            try { window.scrollBy(0, 600); } catch (_) {}
            if (!(await waitCancellable(3000, runId))) return;
          }
        }
        if ((wantLike || wantCmt) && !posts.length) {
          skipped++;
          const at = now();
          if (wantLike) likeHist[cycleKey] = { at, skip: 1, reason: "no-post", runId };
          if (wantCmt) cmtHist[cycleKey] = { at, skip: 1, reason: "no-post", runId };
          // Tường trắng sau 5 lượt hydrate: nhớ để các lần sau bỏ qua ngay trên list.
          await noteDeadWall(f.key, "no-post");
          await LS.set({ friendReengageLikeHistory: likeHist, friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
        }
        // Story trước (rẻ, không AI).
        if (wantStory) {
          const sr = await storyInteract(runId, cfg);
          if (sr === "stopped") return;
          if (sr === "ok" || sr === "viewed") {
            doneStory++;
            const record = { at: now(), runId, reacted: sr === "ok" };
            storyHist[cycleKey] = record;
            storyHist[f.key] = record;
            await LS.set({ friendReengageStoryHistory: storyHist, friendReengageDoneStory: doneStory });
            if (!(await waitCancellable(rnd(cfg.storyDelayMin, cfg.storyDelayMax) * 1000, runId))) return;
          } else {
            storyHist[cycleKey] = { at: now(), skip: 1, reason: sr, runId };
            skipped++;
            if (sr !== "wrong-route") await noteDeadWall(f.key, sr);
            await LS.set({ friendReengageStoryHistory: storyHist, friendReengageSkipped: skipped });
          }
        }
        // Like 1-2 bài mới (proof mới đếm; bài đã Like rồi thì bỏ qua, không bấm lại).
        if (wantLike && posts.length) {
          let liked = 0;
          for (const p of posts.slice(0, Number(cfg.likePerFriend) || 1)) {
            if (!(await alive(runId))) return;
            if (p.alreadyLiked) continue;
            if (p.likeBtn && p.likeBtn.getAttribute("aria-pressed") === "true") continue;
            const ok = await likeWithProof(p.likeBtn, runId);
            if (ok === false && !(await alive(runId))) return;
            if (ok) { liked++; doneLike++; }
            if (!(await waitCancellable(rnd(cfg.delayPostMin, cfg.delayPostMax) * 1000, runId))) return;
          }
          if (liked > 0) {
            const record = { at: now(), runId };
            likeHist[cycleKey] = record;
            likeHist[f.key] = record;
            await clearDeadWall(f.key); // tường đã chứng minh còn sống
            await LS.set({ friendReengageLikeHistory: likeHist, friendReengageDoneLike: doneLike });
          } else {
            // Không like được bài nào (đã like hết/proof trượt) vẫn đánh dấu đã
            // chạm vòng này — nếu không lần quét list sau sẽ nhặt lại đúng bạn
            // này và kẹt vòng lặp vô hạn (bắt live: 1 bạn vào ra 5 lần, idx
            // tăng mà like/skip đứng yên). Chỉ khóa :d<cycle>, KHÔNG khóa base
            // để vòng sau/cooldown vẫn xét lại bình thường.
            likeHist[cycleKey] = { at: now(), attempted: 1, liked: 0, reason: "unconfirmed", runId };
            skipped++;
            await noteDeadWall(f.key, "unconfirmed");
            await LS.set({ friendReengageLikeHistory: likeHist, friendReengageSkipped: skipped });
          }
        }
        // Comment AI 1 bài (gọi background aiGenerateComment, proof mới đếm).
        // target.text đã là thân bài làm sạch (story_message hoặc clone đã
        // stripping thread); dưới 20 ký tự thì bỏ qua luôn khỏi tốn quota AI.
        if (wantCmt && posts.length) {
          const target = posts[0];
          if (target && target.text.length >= 20) {
            let cmt = "";
            let aiTimedOut = false;
            try {
              // Dặn cứng chống bịa tên riêng (live: bài không có "Tuân" mà AI viết
              // "anh Tuân") — ghép lúc gửi để không đụng prompt người dùng đã lưu.
              // Chờ AI qua sendCancellable (150s): cổng message mất hay provider
              // treo đều thành skip "ai-timeout" rồi đi tiếp, không treo run
              // vĩnh viễn với Active=true (đúng lỗi kẹt 12h ở u:tankietsago).
              // Ép sát bài: chỉ bình luận về NỘI DUNG BÀI VIẾT; mơ hồ thì EMPTY.
              const noNameClause = "\n\nTuyệt đối không nhắc tên người, địa danh hay số liệu không có trong bài viết. Chỉ bình luận về NỘI DUNG BÀI VIẾT dưới đây; nếu không có nội dung rõ ràng (chỉ là số lượng, tên nút bấm hoặc bình luận của người khác) thì chỉ trả về đúng: EMPTY";
              const aiOut = await sendCancellable({ action: "aiGenerateComment", postText: target.text.slice(0, 1500), prompt: String(cfg.prompt || "") + noNameClause, aiProfileId: cfg.profileId || "" }, runId, 150000);
              if (aiOut && aiOut.stopped) return;
              if (aiOut && aiOut.timeout) aiTimedOut = true;
              else if (aiOut && aiOut.ok && aiOut.r && aiOut.r.ok) cmt = String(aiOut.r.comment || "").trim();
            } catch (_) { aiTimedOut = true; }
            // Dừng giữa lúc chờ AI → thoát trước khi gõ/đăng (trước đây vẫn gõ
            // và bấm Đăng tiếp dù user đã bấm Dừng).
            if (!(await alive(runId))) return;
            if (aiTimedOut && !cmt) {
              cmtHist[cycleKey] = { at: now(), skip: 1, reason: "ai-timeout", runId };
              skipped++;
              await noteDeadWall(f.key, "ai-timeout");
              await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
            } else
            if (cmt.trim().toUpperCase() === "EMPTY") {
              // AI xác nhận bài không có nội dung rõ ràng → bỏ qua, không đăng,
              // không ghi tường chết (lỗi nội dung, không phải tường hỏng).
              cmtHist[cycleKey] = { at: now(), skip: 1, reason: "vague", runId };
              skipped++;
              await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
            } else
            if (cmt) {
              // Kiểm output trước khi Đăng: tên viết hoa giữa câu mà không có trong
              // bài viết và không phải tên bạn bè → AI bịa → bỏ, không đăng.
              const wallName = ((document.querySelector("h1") || {}).innerText || "").trim();
              const bad = commentHasForeignName(cmt, target.text, (f.name || "") + " " + wallName);
              if (bad) {
                cmtHist[cycleKey] = { at: now(), skip: 1, reason: "badname", runId };
                skipped++;
                await logAiExchange(target.text, cmt, "badname:" + bad);
                await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
              } else if (!commentMatchesPost(cmt, target.text)) {
                // Comment không chung từ nội dung nào với bài → chung chung/không
                // bám bài → bỏ, không đăng. Không ghi tường chết (lỗi AI, bài sau
                // của tường có thể vẫn comment được).
                cmtHist[cycleKey] = { at: now(), skip: 1, reason: "offtopic", runId };
                skipped++;
                await logAiExchange(target.text, cmt, "offtopic");
                await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
              } else {
                const r = await commentWithProof(target, cmt, runId);
                if (r === "stopped") return;
                if (r === "ok") {
                  doneCmt++;
                  const record = { at: now(), runId };
                  cmtHist[cycleKey] = record;
                  cmtHist[f.key] = record;
                  await clearDeadWall(f.key); // tường đã chứng minh còn sống
                  await logAiExchange(target.text, cmt, "posted");
                  await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageDoneComment: doneCmt });
                } else {
                  // Comment thất bại (nobox/short/noproof/error) cũng khóa :d vòng
                  // này để không nhặt lại bạn này vô hạn như nhánh Like (lỗi stall
                  // đã bắt live). Chỉ khóa :d<cycle>, không khóa base.
                  cmtHist[cycleKey] = { at: now(), skip: 1, reason: r, runId };
                  skipped++;
                  await noteDeadWall(f.key, r);
                  await logAiExchange(target.text, cmt, r);
                  await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
                }
              }
            } else {
              cmtHist[cycleKey] = { at: now(), skip: 1, reason: "noai", runId };
              skipped++;
              await noteDeadWall(f.key, "noai");
              await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
            }
          } else {
            cmtHist[cycleKey] = { at: now(), skip: 1, reason: "short", runId };
            skipped++;
            await noteDeadWall(f.key, "short");
            await LS.set({ friendReengageCommentHistory: cmtHist, friendReengageSkipped: skipped });
          }
        }
        progressed = true;
        idx++;
        await LS.set({ friendReengageIndex: idx });
        // Nghỉ giữa 2 bạn (random phút, poll stop từng giây).
        if (!(await waitCancellable(rnd(cfg.delayFriendMin, cfg.delayFriendMax) * 60000, runId))) return;
        // Quay về list để lấy bạn tiếp theo (tránh kẹt ở tường).
        location.href = "https://www.facebook.com/friends/list/";
        return;
      }
      if (!progressed) {
        // Trang list vừa tải có thể chưa render hết card — quét lại tối đa 5 lượt
        // trước khi kết luận hết vòng, tránh chết yểu như test live.
        deadPasses++;
        try { await LS.set({ friendReengageDbgLoop: "DEAD#" + deadPasses + " cands=" + candidates.length + " filt=" + nFiltered + " want=" + nWant + "@ " + location.href.slice(0, 60) }); } catch (_) {}
        if (deadPasses < 5) {
          await setStatus("Đã quét " + candidates.length + " bạn, bỏ qua " + nFiltered + " đã tương tác (" + deadPasses + "/5)…");
          const seen = await reengageScrollPass(runId, 4);
          if (seen < 0) return;
          candidates = collectFriendLinks(400);
          await trace2("DEAD#" + deadPasses + " rescanned=" + candidates.length);
          if (!(await waitCancellable(8000, runId))) return;
          continue;
        }
        // Hết vòng (toàn bộ card hiện tại đã chạm) -> theo endMode.
        await finishRun(runId, "cycle");
        return;
      }
    }
    } catch (e) {
      try { await trace2("FATAL " + String((e && e.message) || e).slice(0, 120)); } catch (_) {}
      try {
        const s = await getState();
        if (!s.friendReengageRunId || s.friendReengageRunId === runId) {
          await LS.set({ friendReengageActive: false, friendReengageStatus: "Lỗi không mong đợi, đã dừng an toàn: " + String((e && e.message) || e).slice(0, 160) });
        }
      } catch (_) {}
      return;
    }
  }

  async function finishRun(runId, reason) {
    const s = await getState();
    if (s.friendReengageRunId && s.friendReengageRunId !== runId) return;
    const cfg = s.friendReengageConfig || {};
    let msg = "Xong vòng " + (s.friendReengageCycle || 1) + ": Like " + (s.friendReengageDoneLike || 0) + " • Comment " + (s.friendReengageDoneComment || 0) + " • Story " + (s.friendReengageDoneStory || 0);
    if (reason === "empty") msg = "Không còn bạn mới để xử lý. " + msg;
    await LS.set({ friendReengageActive: false, friendReengageStatus: msg });
  }

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m.action === "startFriendReengage") {
      (async () => {
        const runId = m.runId || ("fr" + now());
        await LS.set({
          friendReengageActive: true, friendReengageRunId: runId,
          friendReengageOwnerTabId: m.ownerTabId || 0, friendReengageConfig: m.config || await getSyncCfg(),
          friendReengageIndex: 0, friendReengageDoneLike: 0, friendReengageDoneComment: 0,
          friendReengageDoneStory: 0, friendReengageSkipped: 0, friendReengageCycle: (await getState()).friendReengageCycle || 1,
          friendReengageStatus: "Bắt đầu…",
        });
        runLoop(runId);
        send({ ok: true, runId });
      })();
      return true;
    }
    if (m.action === "resumeFriendReengage") { (async () => { const s = await getState(); if (s.friendReengageActive) runLoop(s.friendReengageRunId); send({ ok: true }); })(); return true; }
    if (m.action === "stopFriendReengage") { (async () => { await LS.set({ friendReengageActive: false, friendReengageStatus: "Đã dừng." }); send({ ok: true }); })(); return true; }
    if (m.action === "resetFriendReengage") {
      (async () => {
        const keep = m.keepHistory ? {} : { friendReengageLikeHistory: {}, friendReengageCommentHistory: {}, friendReengageStoryHistory: {}, friendReengageDeadWalls: {} };
        await LS.set(Object.assign({ friendReengageActive: false, friendReengageRunId: "", friendReengageOwnerTabId: 0, friendReengageIndex: 0, friendReengageDoneLike: 0, friendReengageDoneComment: 0, friendReengageDoneStory: 0, friendReengageSkipped: 0, friendReengageCursor: "", friendReengageStatus: "Đã reset." }, keep));
        send({ ok: true });
      })();
      return true;
    }
  });

  // Reload-resume: chỉ owner tab chạy tiếp.
  setTimeout(async () => {
    try {
      const s = await getState();
      if (!s.friendReengageActive) return;
      let owner = s.friendReengageOwnerTabId || 0;
      if (!owner) return;
      const me = await sendCancellable({ action: "friendReengageAmIOwner", runId: s.friendReengageRunId }, s.friendReengageRunId, 10000);
      if (me && me.ok && me.r && me.r.ok) runLoop(s.friendReengageRunId);
    } catch (_) {}
  }, 1200);

  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && ch.friendReengageActive && ch.friendReengageActive.newValue === false) { /* dừng vòng lặp qua alive() */ }
    });
  } catch (_) {}
})();
