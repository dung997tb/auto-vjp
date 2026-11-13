// page.js - Nuôi Page: chọn Page đang quản trị và tham gia nhóm
// theo từ khóa / nhóm đề xuất. Luồng này cố ý tách khỏi group.js:
// state, selector, actor verification, counter và success proof đều riêng.
(() => {
  const FLAG = "pageGroupJoinActive";
  const STATE_KEY = "pageGroupJoinRunState";
  const CONFIG_KEY = "pageGroupJoinConfig";
  const PAGE_MANAGER_URL = "https://www.facebook.com/pages/?category=your_pages";
  const DISCOVER_URL = "https://www.facebook.com/groups/discover";

  let active = false;
  let currentRunId = "";
  let commentActorVerifiedRun = null; // runId đã verify actor cho Comment Page — reset khi reload/Stop
  let currentConfig = null;
  let joined = 0;
  let skipped = 0;
  let nextAllowedAt = 0;
  let attempted = new Set();
  // Hàng đợi nhiều từ khóa chạy nối tiếp 1 lượt: keywords=[{keyword,target}].
  // keywordIndex = từ khóa đang chạy; keywordDone[i] = số nhóm đã join ở từ
  // khóa i. Chế độ discover và config cũ (1 từ khóa) đi đường list 1 phần tử.
  let keywordIndex = 0;
  let keywordDone = [];
  let actorFailureStreak = 0;
  let actorSwitchPerformed = false;
  let actorVerifiedForRun = null; // runId of last successful actor verify — skip re-check if unchanged

  // Page Care feature state is intentionally separate from pageGroupJoin*.
  const PAGE_POST_FLAG = "pageGroupPostActive";
  const PAGE_COMMENT_FLAG = "pageCommentActive";
  const PAGE_GROUP_COMMENT_FLAG = "pageGroupCommentActive";
  let pagePostRunId = "", pageCommentRunId = "", pageGroupCommentRunId = "";
  let pagePostConfig = null, pageCommentConfig = null, pageGroupCommentConfig = null;
  // Đếm bỏ qua hiển thị (không phải proof): feed khô toàn bài đã chặn thì
  // status đứng yên ở done 0 trông như treo (bắt live: 15 phút im lặng mà loop
  // vẫn quét đều). Chỉ để hiển thị, proof vẫn chỉ cộng khi xác minh.
  let pageCommentSkippedShown = 0;
  let pageCommentConsecSkips = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Log tag nội bộ page.js (không phụ thuộc feed.js đã load xong hay chưa).
  async function pageTagLog(msg){
    try{
      const {activityLog}=await chrome.storage.local.get("activityLog");
      const log=Array.isArray(activityLog)?activityLog:[];
      log.push({t:Date.now(),feature:"tag",msg:String(msg||"").slice(0,300)});
      if(log.length>500)log.splice(0,log.length-500);
      await chrome.storage.local.set({activityLog:log});
    }catch(_){ console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
  }
  const clean = value => String(value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  // Lột placeholder {tagName} khỏi prompt thường khi lượt này KHÔNG tag.
  // Nếu để lọt, AI copy nguyên "{tagName}" vào câu rồi tool đăng công khai
  // (bắt live pgc 29/10: 21 comment toàn ent=null nhưng dính placeholder).
  // Chỉ dọn khi prompt thật sự chứa placeholder để không đụng prompt thường.
  function pageStripTagPlaceholder(prompt){
    let p = String(prompt || "");
    if (!p.includes("{tagName}")) return p;
    p = p.replace(/\{tagName\}/g, "").replace(/""/g, "");
    p = p.split(/(?<=[.!?…])\s+/).filter(s => {
      const t = String(s || "").trim();
      if (!t) return false;
      return !/lồng ghép|nhắc đến|đề cập|mention|weave|gắn tag|chèn tag|đặt tên ở|^tag\b/i.test(t);
    }).join(" ").replace(/\s{2,}/g, " ").trim();
    return p;
  }
  const visible = el => {
    if (!el?.isConnected) return false;
    // Facebook renders the fixed header actor button with offsetParent=null
    // even while it is visible and clickable. Use computed visibility plus
    // the viewport rect so fixed/sticky controls are not discarded.
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const labelOf = el => clean(el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title"));
  const facebookUrl = value => {
    try {
      const url = new URL(String(value || ""), location.origin);
      const host = url.hostname.toLowerCase();
      if (!(host === "facebook.com" || host.endsWith(".facebook.com"))) return null;
      url.hash = "";
      ["ref", "refid", "__tn__", "__cft__", "mibextid", "locale"].forEach(key => url.searchParams.delete(key));
      return url;
    } catch (_) { return null; }
  };
  const canonicalUrl = value => {
    const url = facebookUrl(value);
    return url ? url.toString().replace(/\/$/, "") : "";
  };
  const pageKey = page => {
    const url = facebookUrl(page?.url || page);
    if (!url) return clean(page?.id || page?.name).toLowerCase();
    const id = url.searchParams.get("id");
    if (id) return `id:${id}`;
    return url.pathname.replace(/\/+$/, "").toLowerCase() || canonicalUrl(url);
  };
  const groupKey = href => {
    const url = facebookUrl(href);
    if (!url) return "";
    const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
    return match ? `/groups/${String(match[1]).toLowerCase()}` : "";
  };
  const groupUrlFromKey = key => `https://www.facebook.com${String(key || "")}/`;
  // Khóa cache scan theo Page (cùng thuật toán background.js):
  // pageJoinedGroups_<pageKey đã sanitize>.
  function pageScanCacheKey(page) {
    const safe = String(pageKey(page) || "").replace(/^\/+/, "").replace(/[^a-zA-Z0-9_\-]/g, "_");
    return safe ? `pageJoinedGroups_${safe}` : "";
  }
  // Registry nhóm đã lưu theo Page: { [pageKey]: [{key,url,name,at,source}] }.
  // Mỗi lần tham gia/scan thành công gộp thêm (dedupe theo groupKey). Mỗi Page
  // có danh sách riêng, dùng chung cho Đăng bài, Comment nhóm, Đăng bán.
  function savedGroupsPageKey(page) {
    return String(pageKey(page) || "").toLowerCase();
  }
  async function savePageJoinedGroup(page, group, source) {
    const pk = savedGroupsPageKey(page);
    const gk = String(group?.key || "").toLowerCase();
    if (!pk || !gk) return;
    const stored = await chrome.storage.local.get("pageSavedGroups");
    const all = stored.pageSavedGroups && typeof stored.pageSavedGroups === "object" ? stored.pageSavedGroups : {};
    const rows = Array.isArray(all[pk]) ? all[pk] : [];
    const at = Date.now();
    const ix = rows.findIndex(r => String(r?.key || "").toLowerCase() === gk);
    const row = { key: gk, url: group.url || groupUrlFromKey(gk), name: group.name || "", at, source: source || "join", keyword: group.keyword || "" };
    // Không ghi đè tên đã có bằng rỗng (card lượt sau thiếu tên sẽ làm mất tên đã lưu).
    if (ix >= 0) rows[ix] = { ...rows[ix], ...row, name: row.name || rows[ix].name || "" };
    else rows.push(row);
    all[pk] = rows.slice(-500);
    await chrome.storage.local.set({ pageSavedGroups: all });
  }
  async function readPageSavedGroups(page) {
    const pk = savedGroupsPageKey(page);
    if (!pk) return [];
    const stored = await chrome.storage.local.get("pageSavedGroups");
    const rows = stored.pageSavedGroups?.[pk];
    return Array.isArray(rows) ? rows : [];
  }
  // Migrate một lần: gộp lịch sử join confirmed + cache scan cũ vào registry.
  async function migratePageSavedGroups(page) {
    const pk = savedGroupsPageKey(page);
    if (!pk) return [];
    const stored = await chrome.storage.local.get(["pageSavedGroups", "pageGroupJoinHistory", pageScanCacheKey(page)]);
    let all = stored.pageSavedGroups && typeof stored.pageSavedGroups === "object" ? stored.pageSavedGroups : {};
    if (Array.isArray(all[pk]) && all[pk].length) return all[pk];
    const rows = [];
    const push = (g, source) => {
      const gk = String(g?.key || g?.groupKey || "").toLowerCase();
      if (!gk || rows.some(r => r.key === gk)) return;
      rows.push({ key: gk, url: g.url || groupUrlFromKey(gk), name: g.name || "", at: g.at || 0, source, keyword: g.keyword || "" });
    };
    (Array.isArray(stored.pageGroupJoinHistory) ? stored.pageGroupJoinHistory : [])
      .filter(h => h.status === "confirmed" && String(h.pageKey || "").toLowerCase() === pk)
      .forEach(h => push({ ...h, key: h.groupKey, keyword: h.keyword || "" }, "join"));
    const cacheKey = pageScanCacheKey(page);
    const cached = cacheKey ? stored[cacheKey] : null;
    (Array.isArray(cached) ? cached : []).forEach(g => push({ key: groupKey(g.url || "") || g.key, url: g.url, name: g.name, at: 0 }, "scan"));
    if (rows.length) {
      all = { ...all, [pk]: rows.slice(-500) };
      await chrome.storage.local.set({ pageSavedGroups: all });
    }
    return rows;
  }
  // Backfill keyword từ pageGroupJoinHistory vào pageSavedGroups cho nhóm thiếu keyword.
  async function backfillPageGroupKeywords() {
    const stored = await chrome.storage.local.get(["pageSavedGroups", "pageGroupJoinHistory", "pageGroupKeywordBackfillDone"]);
    if (stored.pageGroupKeywordBackfillDone) return;
    const hist = Array.isArray(stored.pageGroupJoinHistory) ? stored.pageGroupJoinHistory : [];
    if (!hist.length) { await chrome.storage.local.set({ pageGroupKeywordBackfillDone: true }); return; }
    // Build map: groupKey -> keyword từ history (lấy keyword gần nhất có giá trị)
    const kwMap = {};
    hist.forEach(h => { if (h.groupKey && h.keyword) kwMap[String(h.groupKey).toLowerCase()] = h.keyword; });
    const all = stored.pageSavedGroups && typeof stored.pageSavedGroups === "object" ? stored.pageSavedGroups : {};
    let changed = false;
    for (const pk of Object.keys(all)) {
      if (!Array.isArray(all[pk])) continue;
      all[pk] = all[pk].map(g => {
        if (g.keyword) return g;
        const kw = kwMap[String(g.key || "").toLowerCase()];
        if (!kw) return g;
        changed = true;
        return { ...g, keyword: kw };
      });
    }
    await chrome.storage.local.set({ pageSavedGroups: all, pageGroupKeywordBackfillDone: true });
  }

  const routeUrl = config => config?.mode === "discover"
    ? DISCOVER_URL
    : `https://www.facebook.com/search/groups/?q=${encodeURIComponent(String(config?.keyword || "").trim())}`;
  const routeMatches = config => {
    const current = facebookUrl(location.href);
    if (!current) return false;
    if (config?.mode === "discover") return /^\/groups\/discover(?:\/|$)/i.test(current.pathname);
    return /^\/search\/groups(?:\/|$)/i.test(current.pathname) && current.searchParams.get("q") === String(config?.keyword || "").trim();
  };
  // Chuẩn hóa danh sách từ khóa của config: mảng rỗng/hỏng thì về 1 từ khóa
  // legacy (giữ tương thích lịch cũ + lượt chạy cũ).
  function normalizeJoinKeywords(config) {
    const out = [];
    if (config?.mode !== "discover" && Array.isArray(config?.keywords)) {
      for (const entry of config.keywords) {
        const kw = String(entry?.keyword ?? entry ?? "").trim();
        const tg = Math.max(1, Math.min(100000, parseInt(entry?.target) || 0));
        if (kw && tg > 0) out.push({ keyword: kw.slice(0, 120), target: tg });
        if (out.length >= 1000) break;
      }
    }
    if (!out.length && config?.mode !== "discover") {
      const kw = String(config?.keyword || "").trim();
      if (kw) out.push({ keyword: kw.slice(0, 120), target: Math.max(1, Math.min(100000, parseInt(config?.target) || 10)) });
    }
    return out;
  }
  function keywordEntries(config) {
    const list = normalizeJoinKeywords(config);
    return list.length ? list : [{ keyword: "", target: 0 }];
  }
  // Đồng bộ config.keyword/target theo entry đang chạy để mọi đường cũ
  // (route, progress, history, proof) chạy nguyên không đổi.
  function syncEntryToConfig(config, index) {
    const list = keywordEntries(config);
    const ix = Math.min(Math.max(0, index || 0), list.length - 1);
    config.keywordIndex = ix;
    if (config.mode !== "discover") {
      config.keyword = list[ix].keyword;
      config.target = list[ix].target;
    }
    if (!Array.isArray(config.keywordDone) || config.keywordDone.length !== list.length) {
      const prev = Array.isArray(config.keywordDone) ? config.keywordDone : [];
      config.keywordDone = list.map((_, i) => Math.max(0, parseInt(prev[i]) || 0));
    }
    return { entry: list[ix], index: ix, list };
  }
  function kwStatusPrefix(config) {
    const list = keywordEntries(config);
    if (config?.mode === "discover" || list.length < 2) return "";
    const ix = Math.min(Math.max(0, config?.keywordIndex || 0), list.length - 1);
    return t("pg.kwPrefix", { i: ix + 1, n: list.length, kw: list[ix].keyword });
  }
  const successLabel = /(truy cập(?: vào nhóm)?|đã tham gia|đã gửi yêu cầu|hủy yêu cầu|đang chờ|request sent|joined|pending|visit group|cancel request|membership request is pending|yêu cầu đang chờ|đang chờ duyệt|đang chờ xét duyệt)/i;
  const joinLabel = /^(?:tham gia(?: nhóm)?|yêu cầu tham gia|join(?: group)?|request to join|join as|tham gia với tư cách)/i;
  const questionDialogLabel = /trả lời (?:các )?câu hỏi|câu hỏi dành cho người tham gia|yêu cầu tham gia của bạn đang chờ|membership questions|answer (?:the )?questions|review (?:your )?(?:membership|join)|xem xét quyền tham gia|quy tắc nhóm|group rules|điều khoản(?:\s+tham gia)?|chào mừng bạn đến với nhóm|welcome to the group|trước khi tham gia|before you join|nội quy nhóm|community guidelines|yêu cầu thành viên/i;

  async function owns(runId, ownerTabId) {
    if (!runId || !ownerTabId) return true;
    try {
      const result = await chrome.runtime.sendMessage({ action: "getSenderTabId" });
      return !result?.tabId || result.tabId === ownerTabId;
    } catch (_) { return true; }
  }

  async function live(runId = currentRunId) {
    if (!active || (runId && currentRunId && runId !== currentRunId)) return false;
    try {
      const stored = await chrome.storage.local.get([FLAG, STATE_KEY]);
      return !!stored[FLAG] && (!runId || !stored[STATE_KEY]?.runId || stored[STATE_KEY].runId === runId);
    } catch (_) { return false; }
  }

  async function liveAiConfig() {
    const runtime = currentConfig?.aiConfig || {};
    if (runtime.key) return runtime;
    try {
      const [sync, local] = await Promise.all([
        chrome.storage.sync.get(["aiProvider", "aiApiKey", "aiModel", "aiCustomUrl", "aiKeys"]),
        chrome.storage.local.get("unifiedAiProfiles")
      ]);
      const provider = runtime.provider || sync.aiProvider || "gemini";
      const saved = sync.aiKeys?.[provider] || local.unifiedAiProfiles?.[provider] || {};
      return {
        provider,
        key: saved.key || (provider === sync.aiProvider ? sync.aiApiKey : "") || "",
        model: runtime.model || saved.model || (provider === sync.aiProvider ? sync.aiModel : "") || "",
        url: runtime.url || saved.url || (provider === sync.aiProvider ? sync.aiCustomUrl : "") || ""
      };
    } catch (_) { return runtime; }
  }

  async function writeState(patch = {}) {
    const state = {
      active,
      runId: currentRunId,
      ownerTabId: currentConfig?.ownerTabId || 0,
      config: currentConfig ? { ...currentConfig, aiConfig: currentConfig.aiConfig ? { ...currentConfig.aiConfig, key: undefined } : undefined } : null,
      joined,
      skipped,
      keywordIndex,
      keywordDone: [...keywordDone],
      nextAllowedAt,
      attemptedKeys: [...attempted],
      status: patch.status || "",
      ...patch
    };
    if (state.config?.aiConfig) delete state.config.aiConfig.key;
    // writeState() được gọi từ nhiều loop khác nhau — bọc try/catch tại đây
    // để một lỗi storage (vd. context bị invalidate) không văng lên caller.
    try {
      await chrome.storage.local.set({
        [FLAG]: active,
        [STATE_KEY]: state,
        pageGroupJoinJoined: joined,
        pageGroupJoinSkipped: skipped,
        pageGroupJoinKeywordIndex: keywordIndex,
        pageGroupJoinKeywordDone: [...keywordDone],
        pageGroupJoinStatus: state.status || "",
        pageGroupJoinNextAt: nextAllowedAt,
        pageGroupJoinAttemptedKeys: [...attempted]
      });
    } catch (error) {
      console.warn("[PageGroupJoin] writeState", error);
    }
  }

  function pageNameInText(text, name) {
    const haystack = clean(text).toLocaleLowerCase("vi");
    const needle = clean(name).toLocaleLowerCase("vi");
    return !!needle && haystack.includes(needle);
  }

  const pageActorMenuLabel = /trang cá nhân của bạn|your profile|your account|xem tất cả trang cá nhân|see all profiles|chuyển (?:sang|đổi) (?:trang|hồ sơ|tài khoản)|switch profile|switch account|đổi tài khoản|switch/i;
  const pageActorAllProfilesLabel = /xem tất cả trang cá nhân|see all profiles/i;
  const pageActorMoreProfilesLabel = /xem thêm trang|see more pages|see more profiles|load more pages|load more profiles/i;
  const pageActorSearchLabel = /tìm kiếm trang cá nhân và trang|search (?:for )?(?:profiles?|pages?)|search profiles? and pages?/i;
  const pageActorSelectedText = /đang dùng|đang chọn|được chọn|acting as|selected|currently using|current profile|active profile/i;
  const pageActorSelectedAttr = /(?:aria-checked|aria-selected|aria-pressed|aria-current|data-selected|data-active)\s*=\s*["']?(?:true|page|active|selected)/i;
  // Đã xác nhận thực tế: hộp thoại chuyển đổi danh tính hiện tại của Facebook
  // có aria-label CHỈ là "Trang cá nhân của bạn" / "Your profile" (không có
  // tiền tố "Trang & " như regex cũ giả định) — thiếu khớp này khiến
  // actorMenuRoots() không bao giờ nhận ra hộp thoại đang mở, kéo theo
  // openPageActorMenu/closePageActorMenu coi như menu chưa mở và bấm lặp lại,
  // treo cả luồng chuyển Page dù menu đang hiển thị đúng trên màn hình.
  const pageActorMenuRootLabel = /^(?:trang cá nhân của bạn|your profile|your account)$|trang\s*(?:&|và)\s*trang cá nhân của bạn|pages?\s*(?:&|and)\s*profiles?|xem tất cả trang cá nhân|see all profiles|xem thêm trang|see more pages|see more profiles|chọn trang cá nhân|chọn tài khoản|select (?:profile|account)|choose (?:profile|account)|switch (?:profile|account)/i;

  function actorNodeIsSelected(node) {
    if (pageActorSelectedText.test(labelOf(node))) return true;
    for (let current = node, level = 0; current && level < 4; level++, current = current.parentElement) {
      const attrs = [...current.attributes].map(attr => `${attr.name}=${attr.value}`).join(" ");
      if (pageActorSelectedAttr.test(attrs)) return true;
    }
    return false;
  }

  function actorMenuCandidates(root = document) {
    const isDialogRoot = root !== document;
    // Khi tìm trong actor-picker dialog, bổ sung thêm DIV (Facebook dùng DIV
    // có React click handler cho các mục actor — không phải button/a chuẩn).
    const selector = isDialogRoot
      ? '[role="menuitem"],a,button,[role="button"],div[tabindex],div[data-focusable]'
      : '[role="menuitem"],a,button,[role="button"]';
    return [...root.querySelectorAll(selector)].filter(visible);
  }

  function actorMenuRoots() {
    return [...document.querySelectorAll('[role="dialog"],[role="menu"],[aria-modal="true"],[data-pagelet*="profile" i],[data-testid*="profile" i]')]
      .filter(visible)
      .filter(menu => pageActorMenuRootLabel.test(labelOf(menu)) || actorMenuCandidates(menu).some(item => pageActorSelectedText.test(labelOf(item))));
  }

  function actorEvidence(page) {
    if (!page?.name) return false;
    const name = clean(page.name);
    // Bằng chứng mạnh: notification bell có aria-label "Quản lý cài đặt thông báo của <Page>"
    // hoặc tương đương tiếng Anh — chỉ xuất hiện khi đang dùng đúng Page đó.
    const notifBell = [...document.querySelectorAll('[aria-label*="thông báo" i],[aria-label*="notification" i]')]
      .filter(visible)
      .find(el => {
        const aria = clean(el.getAttribute("aria-label"));
        return pageNameInText(aria, name) && /(?:quản lý|manage|cài đặt|setting)/i.test(aria);
      });
    if (notifBell) return true;
    // Bằng chứng từ comment box: aria-label "Bình luận dưới tên <Page>" /
    // "Comment as <Page>" — xuất hiện ngay khi actor đã chuyển thành công,
    // kể cả khi không có notification bell riêng tên Page (trường hợp phổ biến
    // trên groups feed khi đang dùng Page actor).
    // Chỉ kiểm tra [role="textbox"]/[contenteditable] — tránh nhầm với các
    // article/bình luận của người khác cũng có cùng cấu trúc aria-label.
    const commentBox = [...document.querySelectorAll('[role="textbox"],[contenteditable="true"]')]
      .filter(visible)
      .find(el => {
        const aria = clean(el.getAttribute("aria-label"));
        return /(?:bình luận dưới tên|comment as|viết bình luận dưới tên)/i.test(aria) && pageNameInText(aria, name);
      });
    if (commentBox) return true;
    // Bằng chứng từ ô tạo bài: khi dùng Page, placeholder đổi thành
    // "<Tên Page> ơi, bạn đang nghĩ gì thế?" (đã xác minh live trên feed).
    // Đây là dấu hiệu duy nhất hoạt động trên mọi route có composer, kể cả
    // khi không có ô comment nào đang mở và chuông không nêu tên Page.
    // Chỉ xét control giống composer (có mẫu nghĩ/viết, không phải ô reply)
    // để nội dung bài người khác nhắc tên Page không gây nhầm.
    const composerHint = [...document.querySelectorAll('[role="button"],[role="textbox"],[contenteditable="true"]')]
      .filter(visible)
      .find(el => {
        const text = clean(el.getAttribute?.("aria-label") || el.innerText || el.textContent);
        return pageNameInText(text, name)
          && /(nghĩ|viết).{0,15}(gì|bài|đi)/i.test(text)
          && !/(bình luận|comment|trả lời|reply)/i.test(text);
      });
    if (composerHint) return true;
    // Còn nút "Chuyển sang <Page>" ở đâu đó => Page CHƯA phải danh tính hiện
    // hành. Phải soi aria-label vì innerText của hàng này chỉ là tên trơn.
    if (pageActorSwitchControl(null, name)) return false;
    const nodes = [...document.querySelectorAll('[aria-label],button,[role="button"],[role="menuitem"],a')].filter(visible);
    return nodes.some(node => {
      const text = labelOf(node);
      if (!pageNameInText(text, name) || /(?:chuyển sang|switch to|xem tất cả|see all|xem thêm|see more)/i.test(text)) return false;
      return actorNodeIsSelected(node);
    });
  }

  function visiblePageActorMenu() {
    const roots = actorMenuRoots();
    if (!roots.length) return null;
    // Sau khi click "Xem tất cả trang cá nhân", FB mở thêm dialog modal "Chọn trang cá nhân"
    // mà KHÔNG đóng dropdown gốc. Phải ưu tiên dialog (role="dialog"/aria-modal) vì nó
    // mới chứa đầy đủ các page ẩn — nếu luôn lấy [0] sẽ vào dropdown gốc rỗng.
    return roots.find(r => r.getAttribute("role") === "dialog" || r.getAttribute("aria-modal") === "true") || roots[0];
  }
  function visiblePageActorOption(page) {
    const roots = actorMenuRoots();
    if (!roots.length) return null; // chỉ tìm option khi menu đang mở
    // Tìm trong TẤT CẢ actor roots — sau khi click "Xem tất cả" cả dialog gốc
    // lẫn dialog mở rộng đều có role="dialog" nên không thể dùng 1 root cố định.
    for (const root of roots) {
      // Ưu tiên đúng nút "Chuyển sang <Page>" theo aria-label
      const switcher = pageActorSwitchControl(root, page?.name);
      if (switcher) return switcher;
      const match = actorMenuCandidates(root)
        .find(item => pageNameInText(labelOf(item), page.name) && !/nhóm|group/i.test(labelOf(item)));
      if (match) return match;
    }
    return null;
  }
  function visiblePageActorAllProfiles() {
    return [...document.querySelectorAll('[role="menuitem"],a,button,[role="button"]')]
      .filter(visible)
      .find(item => pageActorAllProfilesLabel.test(labelOf(item)));
  }
  function visiblePageActorMoreProfiles() {
    return [...document.querySelectorAll('[role="menuitem"],a,button,[role="button"]')]
      .filter(visible)
      .find(item => pageActorMoreProfilesLabel.test(labelOf(item)));
  }
  function visiblePageActorSearch() {
    const root = visiblePageActorMenu() || document;
    return [...root.querySelectorAll('input,textarea,[role="textbox"]')]
      .filter(visible)
      .find(input => pageActorSearchLabel.test(labelOf(input)));
  }
  async function searchPageInActorMenu(page, alive) {
    const input = visiblePageActorSearch();
    if (!input || !(await alive())) return false;
    const query = clean(page?.name);
    if (!query) return false;
    try {
      input.scrollIntoView({ block: "center" });
      input.focus();
      document.execCommand("selectAll", false, null);
      await chrome.runtime.sendMessage({ action: "trustedInput", text: query, pressEnter: false });
      await sleep(1000);
      return pageNameInText(input.value || input.innerText || input.textContent, query);
    } catch (_) { return false; }
  }
  async function closePageActorMenu() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const root = visiblePageActorMenu();
      const dialog = root || [...document.querySelectorAll('div[role="dialog"],[aria-modal="true"]')]
        .find(d => visible(d) && /trang cá nhân|your profile/i.test(d.getAttribute("aria-label") || ""));
      if (!dialog) return;
      const close = actorMenuCandidates(dialog).find(item => /^(?:đóng|close)$/i.test(labelOf(item)));
      if (close) {
        try { close.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await sleep(350);
        if (!visible(dialog)) return;
        continue;
      }
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(200);
      if (!visible(dialog)) return;
      // Click vào vùng trống ngoài dialog (góc trên bên trái, xa menu)
      try {
        const rect = dialog.getBoundingClientRect();
        const safeX = Math.max(0, rect.left - 50);
        const safeY = Math.max(0, rect.top - 50);
        if (safeX > 0 || safeY > 0) {
          document.elementFromPoint(safeX, safeY)?.click();
        } else {
          document.body.click();
        }
      } catch (_) { try { document.body.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } }
      await sleep(300);
    }
  }
  async function openPageActorMenu(button, click, alive) {
    if (visiblePageActorMenu() || visiblePageActorAllProfiles() || visiblePageActorMoreProfiles()) return true;
    if (!(await click(button))) return false;
    await sleep(450);
    if (visiblePageActorMenu() || visiblePageActorAllProfiles() || visiblePageActorMoreProfiles()) return true;
    // CDP can report a successful dispatch even when Facebook drops the
    // synthetic coordinate event during a header rerender. Retry once with
    // Facebook's own DOM click, but only after verifying the menu stayed shut.
    if (!(await alive())) return false;
    try { button.click(); } catch (_) { return false; }
    await sleep(450);
    return !!(visiblePageActorMenu() || visiblePageActorAllProfiles() || visiblePageActorMoreProfiles());
  }
  // Khi Page cấu hình ĐÃ là danh tính đang hoạt động, Facebook không hiện nút
  // "Chuyển sang <Page>" nữa — chỉ còn dòng tên Page ở đầu bộ chọn (không có
  // nhãn "Chuyển sang"/"switch to"), còn actorEvidence() lại cần một dấu hiệu
  // "đang chọn" mà dòng tên này không có (đã xác nhận thực tế: DOM chỉ có
  // <a>Tên Page</a> trơn, không aria-selected/aria-current) khiến resolver cứ
  // đi tìm nút chuyển đổi không tồn tại rồi báo "không tìm thấy Page" dù đang
  // dùng đúng Page. Phát hiện đúng tình huống này: tên Page xuất hiện trong bộ
  // chọn nhưng KHÔNG có nhãn "Chuyển sang <Page>" nào đi kèm.
  function pageActorAlreadyActive(page) {
    const name = clean(page?.name);
    if (!name) return false;
    const root = visiblePageActorMenu();
    if (!root) return false;
    // BẮT BUỘC đọc aria-label, KHÔNG dùng labelOf(): hàng chuyển đổi của
    // Facebook là <div role="button" aria-label="Chuyển sang <Tên>"> nhưng
    // innerText của nó chỉ là "<Tên>" trơn. labelOf() ưu tiên innerText nên
    // chuỗi "Chuyển sang" biến mất, khiến code tưởng Page đã active rồi đóng
    // bộ chọn và thao tác bằng NICK CÁ NHÂN (đã xác minh thực tế: 3 nhóm bị
    // tham gia bằng tài khoản cá nhân thay vì Page).
    if (pageActorSwitchControl(root, name)) return false;
    // Không có nút "Chuyển sang <Page>" => Page này chính là danh tính đang
    // hoạt động (Facebook chỉ hiện tên trơn cho actor hiện tại).
    return pageNameInText(clean(root.innerText || root.textContent), name);
  }

  // Nút "Chuyển sang <Tên>" của bộ chọn danh tính, tìm theo aria-label thật.
  function pageActorSwitchControl(root, name) {
    const scope = root || document;
    const switchLabel = /(?:chuyển sang|switch to)/i;
    return [...scope.querySelectorAll("[aria-label]")]
      .filter(visible)
      .find(el => {
        const aria = clean(el.getAttribute("aria-label"));
        return switchLabel.test(aria) && pageNameInText(aria, name);
      }) || null;
  }

  async function choosePageFromActorMenu(page, click, alive) {
    if (pageActorAlreadyActive(page)) { await closePageActorMenu(); return true; }
    let searched = false;
    let dialogScrolled = false;
    let expandedAll = false; // đã click "Xem tất cả trang cá nhân" rồi → không click lại
    for (let pass = 0; pass < 12; pass++) {
      const option = visiblePageActorOption(page);
      if (option) {
        if (!(await click(option))) return actorEvidence(page);
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          if (!(await alive())) return false;
          if (actorEvidence(page)) return true;
          await sleep(500);
        }
        if (actorEvidence(page)) return true;
        // Facebook closes the picker after a Page click. Reopen it once and
        // verify the selected marker instead of treating the click itself as proof.
        const controls = [...document.querySelectorAll('button,[role="button"],[aria-haspopup="menu"]')]
          .filter(visible)
          .filter(control => { const lbl = labelOf(control); return lbl.length <= 40 && pageActorMenuLabel.test(lbl); });
        for (const control of controls) {
          if (!(await openPageActorMenu(control, element => click(element), alive))) continue;
          if (actorEvidence(page)) { await closePageActorMenu(); return true; }
        }
        await closePageActorMenu();
        return false;
      }
      // Sau khi đã expand ("Xem tất cả trang cá nhân"), không click lại nó nữa
      // vì dropdown gốc vẫn visible trong DOM phía sau dialog mở rộng, gây loop.
      // Chỉ click "Xem thêm trang" (loadMore) để load thêm page ẩn trong dialog.
      const expandAll = !expandedAll ? visiblePageActorAllProfiles() : null;
      const loadMore = visiblePageActorMoreProfiles();
      const expand = expandAll || loadMore;
      if (expand) {
        if (expandAll) expandedAll = true;
        if (!(await click(expand))) break;
        await sleep(800);
        continue;
      }
      // Scroll trong dialog để load thêm Page ẩn (dialog dùng virtual scroll)
      if (!dialogScrolled || pass % 2 === 0) {
        const dialogs = [...document.querySelectorAll('[role="dialog"],[role="menu"]')].filter(visible);
        const dialog = dialogs.find(d => d.scrollHeight > d.clientHeight + 20) || dialogs[0];
        if (dialog) {
          const prevTop = dialog.scrollTop;
          dialog.scrollTop += 350;
          await sleep(600);
          dialogScrolled = true;
          if (dialog.scrollTop > prevTop) continue; // có scroll = còn item mới
        }
      }
      if (!searched && await searchPageInActorMenu(page, alive)) {
        searched = true;
        await sleep(900);
        continue;
      }
      break;
    }
    const verified = actorEvidence(page);
    if (!verified) await closePageActorMenu();
    return verified;
  }

  function managedPageLinks() {
    const managerRoute = /\/pages(?:\/|$)/i.test(location.pathname);
    // Chỉ chặn đúng những route điều hướng/chrome của Facebook mà màn "Pages
    // you manage" hay chèn vào cùng danh sách (đã xác nhận thực tế: Bảng điều
    // khiển, Quảng cáo, Hộp thư, Thông tin chi tiết...) — không đoán mò.
    const excluded = /^(?:home|friends|groups|watch|reels?|marketplace|events|messages|notifications|settings|search|login|privacy|help|photo|video|stories|story|permalink|share|professional_dashboard|ad_center|latest|profile\.php\?ref)$/i;
    // Ảnh đại diện của Page cũng là 1 link cùng URL với link tên Page, nhưng
    // aria-label của nó là "Ảnh đại diện của X" — nếu gặp link ảnh trước
    // (thường đứng trước trong DOM), tên bị lấy nhầm thành chuỗi đó. Giữ theo
    // key URL nhưng ưu tiên thay bằng tên "sạch" hơn nếu gặp sau.
    const AVATAR_ALT = /^(?:ảnh đại diện của|profile picture of|photo of)\s+/i;
    const results = [];
    const seen = new Map();
    for (const link of document.querySelectorAll('a[href]')) {
      if (!visible(link)) continue;
      const url = facebookUrl(link.href);
      if (!url) continue;
      const parts = url.pathname.split("/").filter(Boolean);
      // "/pages/" trơ trọi (chỉ có query như ?category=top/liked/invites) là
      // link điều hướng của mục Pages (Khám phá/Đã theo dõi/Lời mời), KHÔNG
      // phải một Page cụ thể — Page thật luôn có thêm đoạn path/id sau "/pages/".
      const isPagesDirectoryLink = /^\/pages\/?$/i.test(url.pathname);
      const isPagePath = !isPagesDirectoryLink && (/^\/pages\/./i.test(url.pathname) || (managerRoute && parts.length === 1 && !excluded.test(parts[0])));
      if (!isPagePath) continue;
      // Bỏ qua link có ?modal= (nút "Tạo bài viết" trong trang quản lý Page)
      if (url.searchParams.has("modal")) continue;
      const card = link.closest('[role="article"],li,[data-pagelet],div[role="listitem"]') || link.parentElement;
      const cardText = clean(card?.innerText || link.innerText || link.getAttribute("aria-label"));
      if (!managerRoute && !/quản lý|manage|trang của bạn|your pages/i.test(cardText)) continue;
      const heading = card?.querySelector?.('h1,h2,h3,h4,[role="heading"]');
      let name = clean(link.getAttribute("aria-label") || link.innerText || heading?.innerText || link.textContent || cardText.split("\n")[0]);
      if (!name || name.length < 2 || name.length > 140 || /^(?:xem|see|quản lý|manage|trang|pages?|tạo|create|tin nhắn|message|thông báo|notif)$/i.test(name)) continue;
      const isAvatarName = AVATAR_ALT.test(name);
      if (isAvatarName) name = name.replace(AVATAR_ALT, "").trim() || name;
      // Chuẩn hóa profile.php?id=X → /X để dedup với link dạng /X
      const numId = url.searchParams.get("id");
      const normalizedUrl = numId && /^\/profile\.php/i.test(url.pathname) ? `https://www.facebook.com/${numId}` : canonicalUrl(url);
      const item = { id: numId || parts[parts.length - 1] || name, name, url: normalizedUrl };
      const key = pageKey(item);
      if (!key) continue;
      const existing = seen.get(key);
      if (existing) {
        // Đã có bản ghi cho Page này (thường từ link ảnh đại diện gặp trước) —
        // chỉ thay tên nếu bản ghi cũ vẫn còn dính alt ảnh và tên mới sạch hơn.
        if (existing.isAvatarName && !isAvatarName) { existing.item.name = name; existing.isAvatarName = false; }
        continue;
      }
      seen.set(key, { item, isAvatarName });
      results.push(item);
    }
    return results.slice(0, 100);
  }

  function groupCardForLink(link) {
    const candidates = [
      link.closest('[role="article"]'),
      link.closest('li'),
      link.closest('[data-pagelet]'),
      link.closest('div[role="listitem"]'),
      link.parentElement?.parentElement,
      link.parentElement
    ].filter(Boolean);
    const withJoin = candidates.filter(node => [...node.querySelectorAll('button,[role="button"],a')].some(control => joinLabel.test(labelOf(control))));
    return withJoin.sort((a, b) => {
      const aLinks = a.querySelectorAll('a[href*="/groups/"]').length;
      const bLinks = b.querySelectorAll('a[href*="/groups/"]').length;
      return (aLinks - bLinks) || (a.innerText.length - b.innerText.length);
    })[0] || candidates[0] || null;
  }

  function findJoinControl(card) {
    if (!card) return null;
    const controls = [...card.querySelectorAll('button,[role="button"],a')].filter(visible);
    const candidate = controls.find(control => {
      const text = labelOf(control);
      if (!text || !joinLabel.test(text)) return false;
      if (/mời|invite|rời|leave|hủy|cancel|đã tham gia|joined|đang chờ|pending|truy cập|visit/i.test(text)) return false;
      return true;
    });
    return candidate || null;
  }

  function findGroupCards() {
    // Link ảnh đại diện nhóm thường đứng TRƯỚC link tên nhóm trong thẻ kết quả
    // tìm kiếm, không có innerText nên rơi về aria-label "Ảnh đại diện của
    // <tên nhóm>" — nếu link đó được xử lý trước, cả card bị gán nhầm tên này
    // (seen theo key nên link tên thật tới sau bị bỏ qua). Ưu tiên thay bằng
    // tên sạch nếu gặp sau, giống cách đã sửa cho managedPageLinks().
    const AVATAR_ALT = /^(?:ảnh đại diện của|profile picture of|photo of)\s+/i;
    // Link điều hướng của mục Nhóm, không phải một nhóm cụ thể.
    const RESERVED = /^\/groups\/(?:feed|discover|joins|create|your_groups)$/i;
    const seen = new Map();
    const cards = [];
    for (const link of document.querySelectorAll('a[href*="/groups/"]')) {
      const key = groupKey(link.href);
      if (!key || RESERVED.test(key)) continue;
      const card = groupCardForLink(link);
      if (!card || !visible(card)) continue;
      // clean() gộp cả xuống dòng thành dấu cách, nên phải tách dòng trên chuỗi
      // GỐC. Nếu tách sau khi clean thì split("\n") trả về nguyên cả thẻ và tên
      // nhóm bị dính "6,3K thành viên • 10+ bài viết/ngày..." (thấy rõ ở trang
      // Khám phá, nơi link ảnh không có innerText nên luôn rơi vào nhánh này).
      const rawText = String(card.innerText || card.textContent || "");
      const text = clean(rawText);
      if (!text || /được tài trợ|sponsored|messenger|tin nhắn/i.test(text)) continue;
      const button = findJoinControl(card);
      if (!button) continue;
      const firstLine = rawText.split("\n").map(line => line.trim()).filter(Boolean)[0] || "";
      let name = clean(link.innerText || link.getAttribute("aria-label") || firstLine);
      if (!name) continue;
      const isAvatarName = AVATAR_ALT.test(name);
      if (isAvatarName) name = name.replace(AVATAR_ALT, "").trim() || name;
      const existing = seen.get(key);
      if (existing) {
        if (existing.isAvatarName && !isAvatarName) { existing.entry.name = name; existing.isAvatarName = false; }
        continue;
      }
      const members = parseGroupMembers(text);
      const postsPerDay = parseGroupPostsPerDay(text);
      const entry = { key, url: canonicalUrl(link.href) || groupUrlFromKey(key), name, card, button, members, postsPerDay };
      seen.set(key, { entry, isAvatarName });
      cards.push(entry);
    }
    return cards;
  }

  // Parse số thành viên từ text thẻ nhóm (giống group.js parseNumber).
  function parseGroupMembers(text) {
    const m = (text || "").match(/([\d.,]+[KkMm]?)\s*(?:thành viên|members?)/i);
    if (!m) return null;
    let str = m[1].toLowerCase().replace(/,/g, ".");
    const num = parseFloat(str.match(/([\d.]+)/)?.[1] || "0");
    const unit = str.slice(-1);
    if (unit === "k") return Math.round(num * 1000);
    if (unit === "m") return Math.round(num * 1000000);
    return Math.round(num);
  }

  // Parse số bài viết/ngày từ text thẻ nhóm (giống group.js).
  function parseGroupPostsPerDay(text) {
    let m = (text || "").match(/(\d+)\+?\s*bài viết\/?\s*(?:ngày|một ngày|day)/i);
    if (m) return parseInt(m[1]);
    m = (text || "").match(/(\d+)\+?\s*posts?\s*(?:a day|per day|\/day)/i);
    if (m) return parseInt(m[1]);
    const alt = (text || "").match(/(\d+)\s*bài viết/i);
    if (alt) return parseInt(alt[1]) > 50 ? 10 : parseInt(alt[1]);
    return null;
  }

  // Không bao giờ được bấm trúng các mục này: bộ chọn danh tính của Facebook
  // xếp "Đăng xuất" ngay dưới danh sách Page, một cú click lệch toạ độ là đăng
  // xuất cả tài khoản người dùng (đã xảy ra thật khi overlay che nút Tham gia).
  const dangerousLabel = /^(?:đăng xuất|log ?out|sign ?out|xóa|delete|xoá tài khoản|vô hiệu hóa|deactivate)\b/i;

  async function controlledClick(element, runId) {
    if (!element || !visible(element) || !(await live(runId))) return false;
    if (dangerousLabel.test(labelOf(element))) return false;
    // inline:"center" là BẮT BUỘC: trang Khám phá nhóm xếp thẻ trong băng
    // chuyền NGANG, nút Tham gia nằm ở x=1764..3300 trong khi viewport chỉ
    // rộng 1647 — chỉ cuộn dọc thì nút không bao giờ vào tầm, guard toạ độ
    // chặn lại và cú click rơi về element.click() mà Facebook bỏ qua.
    // Băng chuyền có thể trượt lại sau khi cuộn, nên lặp cuộn–đo–kiểm tra thay
    // vì đo một lần rồi bấm mù.
    let x = 0;
    let y = 0;
    let aimed = false;
    for (let attempt = 0; attempt < 3 && !aimed; attempt++) {
      try { element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" }); }
      catch (_) { try { element.scrollIntoView({ block: "center", inline: "center" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } }
      await sleep(attempt === 0 ? 320 : 500);
      if (!(await live(runId))) return false;
      if (!element.isConnected || !visible(element)) return false;
      const rect = element.getBoundingClientRect();
      // Nếu element bị che bởi header cố định (y quá nhỏ), cuộn thêm xuống
      const NAV_H = 70;
      if (rect.top < NAV_H) {
        try { window.scrollBy({ top: -(rect.top - NAV_H - 20), behavior: "instant" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await sleep(120);
      }
      const r2 = element.getBoundingClientRect();
      x = Math.round(r2.left + r2.width / 2);
      y = Math.round(r2.top + r2.height / 2);
      aimed = elementOwnsPoint(element, x, y);
    }
    // Cửa sổ Chrome bị thu nhỏ/che khuất => visibilityState="hidden", Chrome
    // ngừng compositing nên Input.dispatchMouseEvent vẫn "gửi thành công" mà
    // KHÔNG trúng phần tử nào. Đã xác minh thực tế: mọi nhóm bị bỏ qua với lý
    // do "chưa xác minh" dù nút Tham gia chưa hề đổi trạng thái. Trong trạng
    // thái này chỉ click thẳng trên element mới có tác dụng.
    if (document.hidden) {
      try { element.click(); return true; } catch (_) { return false; }
    }
    // AN TOÀN: click theo toạ độ sẽ trúng phần tử NẰM TRÊN CÙNG tại điểm đó.
    // Nếu một overlay (bộ chọn danh tính, bảng thông báo...) đang che element,
    // cú click sẽ rơi vào menu item bên dưới con trỏ — đã ghi nhận thực tế làm
    // đổi nhầm danh tính và bấm trúng "Đăng xuất". Chỉ gửi trusted click khi
    // điểm giữa element thật sự thuộc về chính element đó.
    // Không đưa được element vào đúng tầm ngắm sau 3 lần cuộn: báo thất bại
    // NGAY thay vì bấm mù rồi để caller chờ xác minh 30 giây vô ích.
    if (!aimed) return false;
    try {
      const trusted = await chrome.runtime.sendMessage({ action: "trustedMouse", kind: "click", x, y });
      if (trusted?.ok) return true;
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    try { element.click(); return true; } catch (_) { return false; }
  }

  function elementOwnsPoint(element, x, y) {
    if (!element) return false;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    let hit = null;
    try { hit = document.elementFromPoint(x, y); } catch (_) { return false; }
    if (!hit) return false;
    return hit === element || element.contains(hit) || hit.contains(element);
  }

  function visibleQuestionDialog() {
    const dialogs = [...document.querySelectorAll('div[role="dialog"],[aria-modal="true"]')].filter(visible);
    // Ưu tiên dialog khớp label rõ ràng
    const byLabel = dialogs.find(d => questionDialogLabel.test(clean(d.innerText?.slice(0, 600) || "") || clean(d.getAttribute("aria-label") || "")));
    if (byLabel) return byLabel;
    // Fallback: dialog bất kỳ có checkbox + nút Gửi/Tiếp/Tham gia (dialog câu hỏi nhóm nhưng text lạ)
    return dialogs.find(d => {
      const hasCheckOrText = d.querySelector('input[type="checkbox"],[role="checkbox"],textarea,input[type="text"],[role="textbox"],[contenteditable="true"]');
      if (!hasCheckOrText) return false;
      const hasSubmit = [...d.querySelectorAll('button,[role="button"]')].some(b => visible(b) && /gửi|send|tiếp|next|tham gia|join|submit|hoàn tất|done|xác nhận|confirm/i.test(labelOf(b)));
      return hasSubmit;
    });
  }

  // Dialog đang hiển thị BÀI VIẾT thật (lightbox "Bài viết của...") không phải
  // overlay rác — Escape nó sẽ đóng luôn khung bài đang cần comment (tái hiện
  // live: ô comment biến mất ngay sau dismiss). Nhận diện bằng article dài.
  function overlayHasRealPost(d) {
    try {
      return [...d.querySelectorAll('[role="article"],article')].some(a => clean(a.innerText || a.textContent).length >= 100);
    } catch (_) { return false; }
  }
  async function dismissPageOverlays() {
    // Đóng notification panel, actor picker leftover, tooltips...
    // bất kỳ overlay nào có thể che nút Tham gia trước khi click.
    for (let attempt = 0; attempt < 4; attempt++) {
      const overlays = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[data-pagelet="Notifications"]')]
        .filter(d => visible(d) && !overlayHasRealPost(d) && !questionDialogLabel.test(clean(d.innerText || d.getAttribute("aria-label") || "")));
      if (!overlays.length) return;
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(180);
      const stillOpen = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[data-pagelet="Notifications"]')]
        .filter(d => visible(d) && !overlayHasRealPost(d) && !questionDialogLabel.test(clean(d.innerText || d.getAttribute("aria-label") || "")));
      if (!stillOpen.length) return;
      try { document.body.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(250);
    }
  }
  // Dialog câu hỏi của card TRƯỚC còn sót (vd. kẹt ở trạng thái "chờ xét duyệt"
  // sau khi đã gửi) sẽ che nút Tham gia của card sau → click fail dây chuyền
  // (bắt live: 11 skip:click liên tiếp). Dọn nó ở ĐẦU mỗi card mới — lúc này
  // không còn flow trả lời nào đang chạy nên an toàn. Chỉ bấm nút Đóng tường
  // minh (không đụng form đang nhập vì không có flow nào đang nhập lúc này);
  // đóng dialog đã gửi không rút lại yêu cầu đã gửi cho Facebook.
  async function closeLeftoverQuestionDialog(runId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await live(runId))) return;
      const dialog = visibleQuestionDialog();
      if (!dialog) return;
      const close = [...dialog.querySelectorAll('button,[role="button"]')].filter(visible)
        .find(b => /^(?:đóng|close|quay lại|back|hoàn tất|done)$/i.test(labelOf(b)));
      try {
        if (close) close.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(500);
    }
  }
  async function dismissPageStraysOnly(anchorEl) {    // Dọn overlay lạ (notification panel, menu xổ...) mà KHÔNG BAO GIỜ chạm
    // vào dialog: Escape/body.click toàn cục có thể đóng luôn composer đang mở
    // (đã tái hiện live: dialog biến mất ngay sau dismiss, editor detached,
    // các vòng sau gõ nhầm vào ô reply trong feed).
    // Chỉ bấm nút Đóng của chính panel/menu lạ, tối đa 2 lượt.
    const anchorDialog = anchorEl?.closest?.('[role="dialog"],[aria-modal="true"]') || null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const strays = [...document.querySelectorAll('[data-pagelet="Notifications"],[role="menu"]')]
        .filter(d => visible(d) && d !== anchorDialog && !(anchorDialog && anchorDialog.contains(d)));
      if (!strays.length) return;
      for (const stray of strays) {
        const close = [...stray.querySelectorAll('button,[role="button"],[aria-label]')].filter(visible).find(b => /^(?:đóng|close)$/i.test(labelOf(b)));
        if (close) { try { close.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } }
      }
      await sleep(250);
    }
  }

  function inputQuestion(input, index) {
    const labelled = clean(input.getAttribute("aria-label") || input.getAttribute("placeholder"));
    // Ưu tiên nhãn thật trên ô nhập (tin nhất). Chỉ loại đúng placeholder chung
    // chung ("Viết câu trả lời..."), không loại cả câu hỏi chứa chữ "trả lời"
    // như code cũ (vd. "Trả lời câu hỏi 1: Bạn bao nhiêu tuổi?" bị bỏ qua oan
    // rồi đi nhặt text sibling sai → AI trả lời nhầm câu).
    if (labelled && labelled.length > 5 && !/^(viết câu trả lời|write (an |your )?answer|trả lời|answer)[\s.…]*$/i.test(labelled)) return labelled;
    // Bỏ qua mirror div của FB (có text trùng với giá trị đang nhập)
    const currentVal = clean(input.value || input.innerText || input.textContent || "");
    let node = input;
    for (let level = 0; level < 12 && node; level++, node = node.parentElement) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        const text = clean(sibling.innerText || sibling.textContent);
        if (text.length > 5 && text.length < 500
          && !/viết câu trả lời|write an answer/i.test(text)
          && text !== currentVal)
          return text;
        sibling = sibling.previousElementSibling;
      }
    }
    return t("pgq.questionFallback", { n: index + 1 });
  }

  function consentQuestion(question) {
    return /đồng ý|chấp nhận|cam kết|tuân thủ|quy tắc|nội quy|quy định|không quảng cáo|không spam|không bán hàng|tôn trọng thành viên|group rules|agree|follow the rules/i.test(clean(question));
  }

  function pageCannedAnswer(question, index) {
    const answers = Array.isArray(currentConfig?.answers) && currentConfig.answers.length ? currentConfig.answers : t("pg.answersDefault").split("\n");
    if (consentQuestion(question)) return answers[0] || t("pg.answersDefault").split("\n")[0];
    if (/mục đích|lý do|tham gia để|mong muốn|đóng góp|why|purpose/i.test(question)) return answers[1] || answers[0];
    // Câu hỏi mở không khớp mẫu nào (vd. tuổi, khu vực): dùng câu mục đích
    // chung thay vì xoay vòng theo vị trí — xoay vòng có thể gán nhầm câu
    // (vd. hỏi tuổi mà trả lời "tuân thủ nội quy"), admin đọc là loại.
    void index;
    return answers[1] || answers[0];
  }

  const PAGE_JOIN_AI_TIMEOUT_MS = 30000;
  async function requestPageJoinAi(groupName, questions, runId) {
    let settled = false;
    let response = null;
    try {
      chrome.runtime.sendMessage({
        action: "aiAnswerJoinQuestions",
        groupName,
        questions,
        prompt: currentConfig.aiPrompt,
        aiConfig: await liveAiConfig()
      }).then(result => { settled = true; response = result; }).catch(() => { settled = true; response = null; });
    } catch (_) {
      return { ok: false, code: "send-failed" };
    }
    const deadline = Date.now() + PAGE_JOIN_AI_TIMEOUT_MS;
    while (!settled && Date.now() < deadline) {
      if (!(await live(runId))) return { ok: false, code: "stopped" };
      await sleep(400);
    }
    return settled ? response : { ok: false, code: "timeout" };
  }

  function checkboxChecked(box) {
    if (box.matches?.('input[type="checkbox"]')) return !!box.checked;
    return String(box.getAttribute("aria-checked") || box.getAttribute("data-checked") || box.getAttribute("aria-pressed") || "").toLowerCase() === "true";
  }

  // Facebook render checkbox nội quy bằng div[role="checkbox"] — React chỉ
  // lắng nghe synthetic event, không phải DOM click thông thường. Gửi cả
  // mousedown+mouseup+click lẫn dispatchEvent để phòng các phiên bản FB khác.
  async function tickCheckbox(box, runId) {
    if (!visible(box) || !(await live(runId))) return false;
    if (box.matches?.('input[type="checkbox"]')) {
      const label = box.closest("label") || box;
      // Thử CDP trustedMouse trước, fallback .click() nếu không aimed được
      const ok = await controlledClick(label, runId);
      if (ok) return true;
      try { label.click(); return true; } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      try { box.click(); return true; } catch (_) { return false; }
    }
    // div[role="checkbox"]: thử controlledClick trước, fallback sang dispatchEvent
    const clicked = await controlledClick(box, runId);
    if (clicked) return true;
    try {
      ["mousedown","mouseup","click"].forEach(type =>
        box.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      );
      box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      box.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      return true;
    } catch (_) { return false; }
  }

  function checkboxLabel(box) {
    // Lấy text của checkbox: aria-label, label cha, hoặc sibling text
    const ariaLabel = box.getAttribute("aria-label") || "";
    if (ariaLabel) return clean(ariaLabel);
    const label = box.closest("label");
    if (label) return clean(label.innerText || label.textContent);
    let node = box.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
      const text = clean(node.innerText || node.textContent);
      if (text.length > 2 && text.length < 200) return text;
    }
    return "";
  }

  function isAgreeCheckbox(box) {
    // Chỉ tick checkbox "đồng ý/agree", bỏ qua "không đồng ý/disagree/decline"
    const label = checkboxLabel(box).toLowerCase();
    if (!label) return true; // không xác định được → tick để an toàn
    const disagree = /không đồng ý|không chấp nhận|từ chối|không tham gia|không tuân thủ|disagree|decline|reject|no i don't|không muốn/i;
    if (disagree.test(label)) return false;
    return true;
  }

  function isConsentCheckbox(box) {
    // Checkbox cam kết nội quy (câu khẳng định tuân thủ) → tick hết.
    // Khác với option lựa chọn ("Nhà tuyển dụng"/"Ứng viên") chỉ được tick 1.
    return consentQuestion(checkboxLabel(box));
  }

  // Gom các option cùng một câu hỏi: leo từ box lên tới container chung gần
  // nhất chứa ≥2 checkbox. Mỗi option leo tới đúng khối của nó.
  function optionBlockOf(box, boxes) {
    let node = box.parentElement;
    for (let level = 0; level < 6 && node && node !== document.body; level++, node = node.parentElement) {
      try {
        if (boxes.filter(o => node.contains(o)).length >= 2) return node;
      } catch (_) { break; }
    }
    return box.parentElement || box;
  }

  function pickSingleOption(group) {
    // Mỗi nhóm option chỉ tick ĐÚNG 1 ô (tick cả "Nhà tuyển dụng" + "Ứng viên"
    // là câu trả lời mâu thuẫn, admin nhìn là loại). Ưu tiên tư cách thành viên.
    const score = box => {
      const t = checkboxLabel(box).toLowerCase();
      if (/ứng viên|ung vien|member|thành viên|thanh vien|người tham gia|nguoi tham gia/i.test(t)) return 0;
      if (/^(có|yes|dong y|đồng ý|ok|chấp nhận|xác nhận)[\s.!]*$/i.test(t)) return 1;
      return 2;
    };
    return [...group].sort((a, b) => score(a) - score(b))[0];
  }

  async function selectDialogCheckboxes(dialog, runId) {
    for (let pass = 0; pass < 8; pass++) {
      if (!(await live(runId))) return false;
      const current = visibleQuestionDialog() || dialog;
      const boxes = [...current.querySelectorAll('input[type="checkbox"],[role="checkbox"]')];
      // Cam kết nội quy → tick từng ô; option lựa chọn → mỗi khối 1 ô.
      const toCheck = [];
      const optionGroups = new Map();
      for (const box of boxes) {
        if (!isAgreeCheckbox(box) || checkboxChecked(box)) continue;
        if (isConsentCheckbox(box)) { toCheck.push(box); continue; }
        const key = optionBlockOf(box, boxes);
        if (!optionGroups.has(key)) optionGroups.set(key, []);
        optionGroups.get(key).push(box);
      }
      for (const group of optionGroups.values()) {
        if (group.some(checkboxChecked)) continue; // khối đã có ô tick rồi
        const pick = pickSingleOption(group);
        if (pick && !checkboxChecked(pick)) toCheck.push(pick);
      }
      if (!toCheck.length) return true; // tất cả đã tick hoặc không có checkbox
      for (const box of toCheck) {
        await tickCheckbox(box, runId);
        await sleep(350);
      }
      await sleep(500); // chờ React re-render + state cập nhật
    }
    const current = visibleQuestionDialog() || dialog;
    const boxes = [...current.querySelectorAll('input[type="checkbox"],[role="checkbox"]')];
    if (!boxes.every(b => !isAgreeCheckbox(b) || checkboxChecked(b))) return false;
    // Mỗi khối option phải có ít nhất 1 ô được tick.
    const optionGroups = new Map();
    for (const box of boxes.filter(b => isAgreeCheckbox(b) && !isConsentCheckbox(b))) {
      const key = optionBlockOf(box, boxes);
      if (!optionGroups.has(key)) optionGroups.set(key, []);
      optionGroups.get(key).push(box);
    }
    return [...optionGroups.values()].every(group => group.some(checkboxChecked));
  }

  async function answerPageQuestions(groupName, runId) {
    // Facebook có thể dựng dialog chậm hoặc dựng lại dialog sau checkbox.
    // Không giữ node cũ qua các lượt render.
    for (let pass = 0; pass < 20; pass++) {
      if (!(await live(runId))) return { ok: false, hadDialog: true };
      const dialog = visibleQuestionDialog();
      if (!dialog) {
        if (pass >= 8) return { ok: true, hadDialog: false }; // chờ tối đa 8×800ms = 6.4s
        await sleep(800);
        continue;
      }
      try { await chrome.storage.local.set({ pageGroupJoinStatus: t("pgq.reviewing", { name: groupName }) }); } catch (error) { console.warn("[PageGroupJoin] answerPageQuestions", error); }
      if (!(await selectDialogCheckboxes(dialog, runId))) return { ok: false, hadDialog: true };
      const current = visibleQuestionDialog() || dialog;
      const inputs = [...current.querySelectorAll('textarea,input[type="text"],[role="textbox"],[contenteditable="true"]')]
        .filter(input => visible(input) && !input.disabled && input.getAttribute("aria-disabled") !== "true");
      const questions = inputs.map(inputQuestion);
      const answers = Array(inputs.length).fill("");
      const aiIndexes = questions.map((question, index) => consentQuestion(question) ? -1 : index).filter(index => index >= 0);
      if (currentConfig?.aiEnabled && aiIndexes.length) {
        try { await chrome.storage.local.set({ pageGroupJoinStatus: t("pgq.aiThinking", { n: aiIndexes.length, name: groupName }) }); } catch (error) { console.warn("[PageGroupJoin] answerPageQuestions", error); }
        const response = await requestPageJoinAi(groupName, aiIndexes.map(index => questions[index]), runId);
        if (response?.code === "timeout") { try { await chrome.storage.local.set({ pageGroupJoinStatus: t("pgq.aiTimeout", { name: groupName }) }); } catch (error) { console.warn("[PageGroupJoin] answerPageQuestions", error); } }
        if (response?.code === "stopped") return { ok: false, hadDialog: true };
        // AI điền được → dùng; AI lỗi → fallback sang câu mẫu (không thoát sớm)
        if (response?.ok) (response.answers || []).slice(0, aiIndexes.length).forEach((answer, index) => { answers[aiIndexes[index]] = clean(answer); });
      }
      let filled = 0;
      for (let index = 0; index < inputs.length; index++) {
        if (!(await live(runId))) return { ok: false, hadDialog: true };
        const input = inputs[index];
        const answer = answers[index] || pageCannedAnswer(questions[index], index);
        // Gõ hụt (ô trống) mà bỏ qua ngay thì gửi thiếu câu bắt buộc → bị loại.
        // Thử lại đúng 1 lần (xóa + gõ lại) rồi mới chịu thua ô này.
        let typedOk = false;
        for (let typeTry = 0; typeTry < 2 && !typedOk; typeTry++) {
          try {
            input.scrollIntoView({ block: "center" });
            input.click();
            input.focus();
            document.execCommand("selectAll", false, null);
            const typed = await chrome.runtime.sendMessage({
              action: "trustedInput", text: answer, pressEnter: false,
              typingConfig: currentConfig?.typingConfig || null
            });
            const actual = clean(input.value || input.innerText || input.textContent);
            typedOk = !!typed?.ok && actual.length >= 2;
            if (!typedOk) await sleep(400);
          } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        }
        if (typedOk) filled++;
      }
      // Chỉ fail nếu có input nhưng không gõ được bất kỳ câu nào
      if (filled === 0 && inputs.length > 0) return { ok: false, hadDialog: true };
      let submit = null;
      // Nút Gửi có thể enable trễ vài giây (Facebook bắt đọc nội quy trước).
      // Chờ tới ~12s thay vì 4s rồi mới kết luận dialog liệt.
      for (let attempt = 0; attempt < 34 && !submit; attempt++) {
        const liveDialog = visibleQuestionDialog() || dialog;
        submit = [...liveDialog.querySelectorAll('button,[role="button"],div[role="button"]')]
          .find(button => visible(button) && /^(?:gửi|gửi yêu cầu|send|submit|hoàn tất|done|tiếp|tiếp tục|continue|next|tham gia nhóm|join group|xác nhận|confirm)$/i.test(labelOf(button)) && button.getAttribute("aria-disabled") !== "true" && !button.disabled);
        if (!submit) await sleep(350);
      }
      if (!submit || !(await controlledClick(submit, runId))) return { ok: false, hadDialog: true };
      // Facebook xử lý chậm sau khi bấm Gửi: chờ tới 15s thay vì 9s để khỏi
      // kết luận fail oan trong khi yêu cầu thật ra đã đi.
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        if (!(await live(runId))) return { ok: false, hadDialog: true };
        if (!visibleQuestionDialog()) return { ok: true, hadDialog: true };
        await sleep(450);
      }
      return { ok: false, hadDialog: true };
    }
    return { ok: false, hadDialog: true };
  }

  // Kiểm tra DỨT KHOÁT danh tính đang hoạt động: mở bộ chọn và đọc aria-label.
  // Khi bộ chọn đóng, Facebook KHÔNG để lại dấu hiệu nào đáng tin trên trang
  // tìm nhóm (chuông chỉ ghi "Thông báo, N chưa đọc", không kèm tên) — suy đoán
  // từ các dấu hiệu gián tiếp đã cho dương tính giả và dẫn tới tham gia nhóm
  // bằng tài khoản cá nhân. Bằng chứng duy nhất tin được: trong bộ chọn không
  // còn nút "Chuyển sang <Page>" và tên Page có mặt.
  // ---- Bộ chọn danh tính Facebook (đã khảo sát trực tiếp trên DOM thật) ----
  //   nút mở    : [aria-haspopup="dialog"][aria-label="Trang cá nhân của bạn"]
  //   hộp thoại : [role="dialog"][aria-label="Trang cá nhân của bạn"]
  //   dòng đầu  : tên danh tính ĐANG dùng
  //   nút đổi   : div[role="button"][aria-label="Chuyển sang <Tên>"]
  // Khi hộp thoại ĐÓNG, Facebook không để lại dấu hiệu nào đáng tin về danh
  // tính đang dùng (chuông chỉ ghi "Thông báo, N chưa đọc"). Vì vậy nguồn sự
  // thật duy nhất là mở hộp thoại ra đọc — mọi suy đoán gián tiếp trước đây
  // đều cho dương tính giả và dẫn tới thao tác bằng tài khoản cá nhân.
  const actorPickerLabel = /^(?:trang cá nhân của bạn|your profile)/i;
  const actorSwitchAria = /^(?:chuyển sang|switch to)\s+/i;

  function actorPickerOpener() {
    return [...document.querySelectorAll('[aria-haspopup="dialog"]')]
      .filter(visible)
      .find(el => actorPickerLabel.test(clean(el.getAttribute("aria-label")))) || null;
  }

  function actorPickerDialog() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter(visible)
      .find(el => actorPickerLabel.test(clean(el.getAttribute("aria-label")))) || null;
  }

  function actorPickerActiveName(dialog) {
    const lines = String(dialog?.innerText || "").split("\n").map(line => line.trim()).filter(Boolean);
    return lines[0] || "";
  }

  function actorPickerSwitchButton(dialog, name) {
    const wanted = clean(name);
    if (!dialog || !wanted) return null;
    return [...dialog.querySelectorAll('[role="button"][aria-label]')]
      .filter(visible)
      .find(el => {
        const aria = clean(el.getAttribute("aria-label"));
        return actorSwitchAria.test(aria) && pageNameInText(aria.replace(actorSwitchAria, ""), wanted);
      }) || null;
  }

  async function openActorPicker(runId) {
    const already = actorPickerDialog();
    if (already) return already;
    const opener = actorPickerOpener();
    if (!opener) return null;
    await controlledClick(opener, runId);
    for (let wait = 0; wait < 12; wait++) {
      await sleep(300);
      if (!(await live(runId))) return null;
      const dialog = actorPickerDialog();
      if (dialog) return dialog;
    }
    return null;
  }

  async function closeActorPicker() {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (!actorPickerDialog()) return true;
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(250);
      if (!actorPickerDialog()) return true;
      const opener = actorPickerOpener();
      if (opener) { try { opener.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } }
      await sleep(300);
    }
    return !actorPickerDialog();
  }

  async function verifyPageActorStrict(page, runId) {
    const name = clean(page?.name);
    if (!name) return false;
    // Kiểm tra DOM trước — không mở picker nếu đã có bằng chứng rõ ràng.
    if (actorEvidence(page)) return true;
    // Không có bằng chứng DOM → mở picker để xác minh chắc chắn.
    const dialog = await openActorPicker(runId);
    if (!dialog) return false;
    const activeName = actorPickerActiveName(dialog);
    const stillOffersSwitch = !!actorPickerSwitchButton(dialog, name);
    await closeActorPicker();
    return !stillOffersSwitch && pageNameInText(activeName, name);
  }

  async function switchToSelectedPage(page, runId) {
    const name = clean(page?.name);
    if (!name) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await live(runId))) return false;
      const dialog = await openActorPicker(runId);
      if (!dialog) return false;
      const switchButton = actorPickerSwitchButton(dialog, name);
      if (!switchButton) {
        // Không còn nút "Chuyển sang <Page>" => hoặc Page đang dùng, hoặc bộ
        // chọn không liệt kê Page này. Dòng đầu quyết định.
        const activeName = actorPickerActiveName(dialog);
        await closeActorPicker();
        return pageNameInText(activeName, name);
      }
      // Có nút đổi => chắc chắn đang KHÔNG dùng Page. Trang hiện tại vẫn render
      // theo danh tính cũ nên joinLoop phải tải lại nguồn sau khi đổi xong.
      actorSwitchPerformed = true;
      if (!(await controlledClick(switchButton, runId))) { await closeActorPicker(); continue; }
      for (let wait = 0; wait < 20; wait++) {
        await sleep(500);
        if (!(await live(runId))) return false;
        if (!actorPickerDialog()) break;
      }
      await sleep(1200);
      if (await verifyPageActorStrict(page, runId)) return true;
    }
    return false;
  }

  async function waitJoinProof(item, initialLabel, runId) {
    const deadline = Date.now() + 30000;
    let sawDialog = false;
    while (Date.now() < deadline) {
      if (!(await live(runId))) return false;
      if (visibleQuestionDialog()) { sawDialog = true; await sleep(500); continue; }
      // Facebook có thể thay toàn bộ card sau cú click. Tìm lại theo group
      // key mỗi vòng, không giữ DOM node cũ làm bằng chứng thành công.
      const liveLink = [...document.querySelectorAll('a[href*="/groups/"]')]
        .find(link => groupKey(link.href) === item.key);
      const liveCard = liveLink ? groupCardForLink(liveLink) : null;
      const liveControls = [
        ...(item.button?.isConnected ? [item.button] : []),
        ...(liveCard ? [...liveCard.querySelectorAll('button,[role="button"],a')] : [])
      ].filter(visible);
      const buttonText = liveControls.map(labelOf).find(text => successLabel.test(text) && text !== initialLabel) || "";
      if (buttonText) return true;
      const cardText = liveCard ? clean(liveCard.innerText || liveCard.textContent) : (item.card?.isConnected ? clean(item.card.innerText || item.card.textContent) : "");
      if (cardText && successLabel.test(cardText) && pageNameInText(cardText, item.name)) return true;
      const bodyText = clean(document.body?.innerText || "");
      if (sawDialog && successLabel.test(bodyText) && pageNameInText(bodyText, item.name)) return true;
      // Khi URL đã chuyển sang group page (navigate after join), coi như thành công
      if (!routeMatches(currentConfig) && /\/groups\//.test(location.pathname)) return true;
      await sleep(700);
    }
    return false;
  }

  async function waitUntilAllowed(runId) {
    while (Date.now() < nextAllowedAt) {
      if (!(await live(runId))) return false;
      await sleep(Math.min(800, Math.max(100, nextAllowedAt - Date.now())));
    }
    return live(runId);
  }

  function randomDelay() {
    const min = Math.max(5, parseInt(currentConfig?.minDelay) || 15) * 1000;
    const max = Math.max(min, (parseInt(currentConfig?.maxDelay) || 30) * 1000);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  async function recordPageJoinSkip(item, code, status, stop = false) {
    skipped++;
    nextAllowedAt = Date.now() + randomDelay();
    if (stop) active = false;
    await writeState({
      active,
      status,
      skipped,
      lastSkipCode: code,
      lastSkipGroup: item?.name || "",
      lastSkipAt: Date.now()
    });
    // Ghi lịch sử để tra được từng nhóm rớt ở bước nào (trước đây skip không
    // để lại dấu vết, chỉ có confirmed mới vào history).
    try {
      const stored = await chrome.storage.local.get("pageGroupJoinHistory");
      const rows = Array.isArray(stored.pageGroupJoinHistory) ? stored.pageGroupJoinHistory : [];
      rows.push({ pageKey: pageKey(currentConfig?.page), groupKey: item?.key || "", groupName: item?.name || "", keyword: currentConfig?.keyword || "", status: "skipped:" + code, reason: String(status || "").slice(0, 160), at: Date.now() });
      await chrome.storage.local.set({ pageGroupJoinHistory: rows.slice(-500) });
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    return false;
  }

  async function returnToSource(runId) {
    if (!(await live(runId)) || routeMatches(currentConfig)) return true;
    location.replace(routeUrl(currentConfig));
    return false;
  }
  async function persistJoinConfig() {
    try {
      const { aiConfig, ...rest } = currentConfig || {};
      await chrome.storage.local.set({
        [CONFIG_KEY]: { ...rest, aiConfig: aiConfig ? { provider: aiConfig.provider, model: aiConfig.model, url: aiConfig.url, profileId: aiConfig.profileId || "" } : undefined },
        pageGroupJoinKeywordIndex: keywordIndex,
        pageGroupJoinKeywordDone: [...keywordDone]
      });
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
  }
  // Chuyển sang từ khóa kế tiếp trong cùng 1 lượt chạy: đồng bộ route mới,
  // lưu config để resume/popup bám theo, rồi điều hướng (reload sẽ resume).
  // Hết danh sách thì trả false để caller dừng run.
  async function advanceKeyword(runId) {
    const list = keywordEntries(currentConfig);
    if (currentConfig?.mode === "discover") return false;
    const next = keywordIndex + 1;
    if (next >= list.length) return false;
    keywordIndex = next;
    if (keywordDone.length !== list.length) keywordDone = list.map((_, i) => Math.max(0, parseInt(keywordDone[i]) || 0));
    syncEntryToConfig(currentConfig, keywordIndex);
    currentConfig.keywordDone = [...keywordDone];
    actorVerifiedForRun = null;
    await persistJoinConfig();
    await writeState({ status: kwStatusPrefix(currentConfig) + t("pg.reloadingSource", { name: currentConfig.page.name }) });
    if (!(await live(runId))) return true;
    location.replace(routeUrl(currentConfig));
    return true;
  }

  async function processCard(item, runId) {
    if (attempted.has(item.key)) return false;
    // Cửa sổ bị che/thu nhỏ: thao tác chuột không tới được Facebook, mọi nhóm
    // sẽ bị bỏ qua oan. Chờ tới khi hiện lại thay vì đốt sạch danh sách nhóm.
    if (document.hidden) {
      await writeState({ status: t("pg.windowHidden") });
      while (document.hidden) {
        if (!(await live(runId))) return false;
        await sleep(1500);
      }
    }
    attempted.add(item.key);
    await writeState({ status: t("pg.processing", { name: item.name }) });
    if (!(await waitUntilAllowed(runId))) return false;
    // Dọn dialog sót của card trước (nếu có) trước khi động vào card này.
    await closeLeftoverQuestionDialog(runId);
    if (!(await live(runId))) return false;
    const directPageControl = pageNameInText(labelOf(item.button), currentConfig.page.name);
    if (!directPageControl) {
      // Chỉ switch + verify lần đầu mỗi run. Từ card thứ 2 trở đi: bỏ qua
      // hoàn toàn — actor không thể tự thay đổi giữa các card trong cùng run.
      // Nếu trang reload (URL thay đổi) thì actorVerifiedForRun reset về null
      // và vòng lặp ngoài sẽ verify lại trước khi gọi processCard.
      if (actorVerifiedForRun !== runId) {
        const switched = await pageSwitchActor(currentConfig.page, FLAG, runId);
        if (!switched && !actorEvidence(currentConfig.page)) {
          actorFailureStreak++;
          return recordPageJoinSkip(item, "actor", actorFailureStreak >= 2
            ? t("pg.actorUnavailable", { name: currentConfig.page.name })
            : t("pg.noPageActor", { name: currentConfig.page.name }), actorFailureStreak >= 2);
        }
        actorVerifiedForRun = runId;
      }
    }
    actorFailureStreak = 0;
    await dismissPageOverlays();
    const button = item.button?.isConnected ? item.button : findJoinControl(item.card);
    if (!button || successLabel.test(labelOf(button))) {
      // Nút đã báo tham gia/chờ duyệt (nhóm join từ lượt trước hoặc nick khác
      // bấm rồi) — KHÔNG phải lỗi trả lời câu hỏi, ghi đúng mã để khỏi nhầm.
      return recordPageJoinSkip(item, "already", t("pg.alreadyJoined", { name: item.name }));
    }
    const initialLabel = labelOf(button);
    if (!(await controlledClick(button, runId))) {
      return recordPageJoinSkip(item, "click", t("pg.unconfirmed", { name: item.name }));
    }
    const answered = await answerPageQuestions(item.name, runId);
    if (!answered.ok) {
      return recordPageJoinSkip(item, "question", t("pg.questionFailed", { name: item.name }));
    }
    const proof = await waitJoinProof(item, initialLabel, runId);
    if (!proof) {
      return recordPageJoinSkip(item, "proof", t("pg.unconfirmed", { name: item.name }));
    }
    joined++;
    nextAllowedAt = Date.now() + randomDelay();
    const history = await chrome.storage.local.get("pageGroupJoinHistory");
    const rows = Array.isArray(history.pageGroupJoinHistory) ? history.pageGroupJoinHistory : [];
    rows.push({ pageKey: pageKey(currentConfig.page), groupKey: item.key, groupName: item.name || "", keyword: currentConfig.keyword||"", status: "confirmed", at: Date.now() });
    await chrome.storage.local.set({ pageGroupJoinHistory: rows.slice(-500) });
    // Ghi thêm vào registry nhóm đã lưu của Page (dùng chung cho Đăng bài,
    // Comment nhóm, Đăng bán): mỗi Page một danh sách riêng, cộng dồn.
    try {
      await savePageJoinedGroup(currentConfig.page, { key: item.key, url: item.url || groupUrlFromKey(item.key), name: item.name || "", keyword: currentConfig.keyword||"" }, "join");
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    // Đếm tổng cộng dồn qua các phiên (đếm phiên reset mỗi Start nên không
    // phản ánh đúng số nhóm Page đã tham gia — đã được báo).
    try {
      const life = await chrome.storage.local.get("pageGroupJoinLifetimeJoined");
      await chrome.storage.local.set({ pageGroupJoinLifetimeJoined: (Number(life.pageGroupJoinLifetimeJoined) || 0) + 1 });
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    await writeState({ status: t("pg.confirmed", { name: item.name }), joined, skipped });
    return true;
  }

  async function joinLoop(runId, resume = false) {
    // Bọc toàn bộ loop: một lỗi bất ngờ (vd. context bị invalidate) trước đây
    // sẽ văng khỏi hàm mà không tắt cờ pageGroupJoinActive, khiến popup hiển
    // thị "đang chạy" mãi dù không còn gì thực sự chạy.
    try {
      if (!(await live(runId))) return;
      if (!routeMatches(currentConfig)) { await returnToSource(runId); return; }
      let emptyRounds = 0;
      while (await live(runId)) {
        // Từ khóa đang chạy (discover: 1 entry ảo, giữ hành vi cũ).
        const kwList = keywordEntries(currentConfig);
        const kwIx = Math.min(Math.max(0, keywordIndex), kwList.length - 1);
        keywordIndex = kwIx;
        const kwEntry = kwList[kwIx];
        const kwJoined = keywordDone[kwIx] || 0;
        const kwTotal = kwList.reduce((sum, entry) => sum + (entry.target || 0), 0);
        if (currentConfig.mode !== "discover" && joined >= Math.max(1, kwTotal)) {
          active = false;
          await writeState({ active: false, status: t("pg.done", { joined }) });
          return;
        }
        if (currentConfig.mode !== "discover" && kwJoined >= kwEntry.target) {
          // Đủ quota từ khóa này → sang từ khóa kế (hết thì dừng).
          if (await advanceKeyword(runId)) return;
          active = false;
          await writeState({ active: false, status: t("pg.done", { joined }) });
          return;
        }
        if (currentConfig.mode === "discover" && joined >= Math.max(1, parseInt(currentConfig.target) || 1)) {
          active = false;
          await writeState({ active: false, status: t("pg.done", { joined }) });
          return;
        }
        if (!routeMatches(currentConfig)) { await returnToSource(runId); return; }
        // Bảo đảm ĐÚNG Page là danh tính hoạt động TRƯỚC khi quét thẻ nhóm.
        // Facebook render danh sách nhóm theo danh tính đang dùng; nếu đổi Page
        // sau khi trang đã render bằng nick cá nhân thì cú bấm Tham gia vẫn vào
        // nick cá nhân (đã xác minh thực tế). Sau khi đổi phải tải lại nguồn.
        // Bỏ qua verify lại nếu đã xác minh thành công trong run này (tránh mở
        // actor picker liên tục gây UI flash mỗi vòng lặp).
        if (actorVerifiedForRun !== runId && !(actorEvidence(currentConfig.page))) {
          actorSwitchPerformed = false;
          await writeState({ status: t("pg.switchingActor", { name: currentConfig.page.name }) });
          const ok = await pageSwitchActor(currentConfig.page, FLAG, runId);
          if (!(await live(runId))) return;
          if (!ok && !(actorEvidence(currentConfig.page))) {
            active = false;
            await writeState({ active: false, status: t("pg.actorUnavailable", { name: currentConfig.page.name }) });
            return;
          }
          if (actorSwitchPerformed) {
            await writeState({ status: t("pg.reloadingSource", { name: currentConfig.page.name }) });
            location.replace(routeUrl(currentConfig));
            return;
          }
        }
        actorVerifiedForRun = runId;
        const cards = findGroupCards();
        const minMembers = parseInt(currentConfig?.minMembers) || 0;
        const minPostsPerDay = parseInt(currentConfig?.minPostsPerDay) || 0;
        const available = cards.filter(card => {
          if (attempted.has(card.key)) return false;
          if (minMembers > 0 && card.members !== null && card.members < minMembers) return false;
          // postsPerDay===null nghĩa là không đọc được → cho qua (giống group.js)
          if (minPostsPerDay > 0 && card.postsPerDay !== null && card.postsPerDay < minPostsPerDay) return false;
          return true;
        });
        if (!available.length) {
          emptyRounds++;
          if (emptyRounds >= 4) {
            // Hết nhóm ở từ khóa này nhưng còn từ khóa sau → sang tiếp thay vì
            // dừng cả lượt (chỉ dừng khi đã là từ khóa cuối).
            if (currentConfig.mode !== "discover" && keywordIndex + 1 < keywordEntries(currentConfig).length) {
              emptyRounds = 0;
              if (await advanceKeyword(runId)) return;
            }
            active = false;
            await writeState({ active: false, status: t("pg.noMore", { joined, skipped }) });
            return;
          }
          window.scrollBy({ top: Math.max(420, Math.floor(window.innerHeight * 0.8)), behavior: "smooth" });
          await sleep(1400);
          continue;
        }
        emptyRounds = 0;
        for (const item of available) {
          const kwNow = keywordEntries(currentConfig)[Math.min(Math.max(0, keywordIndex), keywordEntries(currentConfig).length - 1)];
          const kwDoneNow = keywordDone[keywordIndex] || 0;
          if (!(await live(runId))) break;
          if (currentConfig.mode !== "discover" && kwDoneNow >= kwNow.target) break;
          if (currentConfig.mode === "discover" && joined >= Math.max(1, parseInt(currentConfig.target) || 1)) break;
          // Một nhóm lỗi bất ngờ không được giết cả vòng lặp — bắt riêng để bỏ
          // qua đúng nhóm đó rồi tiếp tục nhóm kế tiếp.
          let processed = false;
          try {
            processed = await processCard(item, runId);
          } catch (error) {
            console.warn("[PageGroupJoin] processCard", error);
            skipped++;
          }
          if (processed) {
            keywordDone[keywordIndex] = (keywordDone[keywordIndex] || 0) + 1;
            const kwListNow = keywordEntries(currentConfig);
            const kwIxNow = Math.min(Math.max(0, keywordIndex), kwListNow.length - 1);
            await writeState({ joined, skipped, keywordIndex, keywordDone: [...keywordDone], status: kwStatusPrefix(currentConfig) + t("pg.progress", { joined: keywordDone[kwIxNow] || 0, target: kwListNow[kwIxNow].target, skipped }) });
          }
          if (!(await live(runId))) return;
        }
        window.scrollBy({ top: Math.max(420, Math.floor(window.innerHeight * 0.8)), behavior: "smooth" });
        await sleep(1200);
      }
    } catch (error) {
      console.warn("[PageGroupJoin]", error);
      active = false;
      await writeState({ active: false, status: "Lỗi: " + String(error?.message || error || "") });
    } finally {
      active = false;
    }
  }

  // -----------------------------------------------------------------------
  // Page group posts. This is a separate state machine from feed.js Group
  // Post: it verifies the Page actor, owns its composer, and has its own proof.
  // -----------------------------------------------------------------------
  async function pageFeatureLive(flag, runId) {
    if (!runId) return false;
    try {
      const stored = await chrome.storage.local.get([flag, `${flag}RunId`]);
      return !!stored[flag] && (!stored[`${flag}RunId`] || stored[`${flag}RunId`] === runId);
    } catch (_) { return false; }
  }

  async function pageFeatureClick(element, flag, runId) {
    if (!element || !visible(element) || !(await pageFeatureLive(flag, runId))) return false;
    try { element.scrollIntoView({ behavior: "instant", block: "center" }); } catch (_) { try { element.scrollIntoView({ block: "center" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } }
    await sleep(180);
    if (!(await pageFeatureLive(flag, runId))) return false;
    const rect = element.getBoundingClientRect();
    try {
      const trusted = await chrome.runtime.sendMessage({ action: "trustedMouse", kind: "click", x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
      if (trusted?.ok) return true;
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    try { element.click(); return true; } catch (_) { return false; }
  }

  async function pageSwitchActor(page, flag, runId) {
    if (actorEvidence(page)) return true;
    const deadline = Date.now() + 30000;
    const clickFn = element => pageFeatureClick(element, flag, runId);
    const aliveFn = () => pageFeatureLive(flag, runId) && Date.now() < deadline;
    if (await choosePageFromActorMenu(page, clickFn, aliveFn)) return true;
    if (Date.now() >= deadline) return actorEvidence(page);
    // Tìm nút actor menu trên toàn trang (bao gồm top-nav "Trang cá nhân của bạn")
    // Lọc ra các nút có nhãn quá dài (share buttons có 60+ ký tự, nút actor thật ngắn ≤40)
    const controls = [...document.querySelectorAll('button,[role="button"],[aria-haspopup="menu"]')]
      .filter(visible)
      .filter(button => {
        const lbl = labelOf(button);
        return lbl.length <= 40 && pageActorMenuLabel.test(lbl);
      });
    for (const control of controls) {
      if (Date.now() >= deadline) break;
      if (!(await openPageActorMenu(control, clickFn, aliveFn))) continue;
      if (await choosePageFromActorMenu(page, clickFn, aliveFn)) return true;
    }
    return actorEvidence(page);
  }

  // Kiểm tra tab đang ở group feed (không phải subpage như /user/, /media/, /members/...)
  function pageOnGroupFeed() {
    const url = facebookUrl(location.href);
    if (!url) return false;
    // Chỉ cho phép /groups/ID hoặc /groups/ID/ — loại trừ /groups/ID/user/... v.v.
    return /^\/groups\/[^/?#]+\/?$/i.test(url.pathname);
  }

  function pageGroupRoute() {
    return /^\/groups\/[^/]+/i.test(facebookUrl(location.href)?.pathname || "");
  }
  function pageCurrentGroupKey() { return groupKey(location.href); }
  function pageCurrentGroupName() {
    const heading = [...document.querySelectorAll('h1,h2,[role="heading"]')].filter(visible)
      .map(labelOf).find(text => text && text.length >= 2 && text.length <= 180);
    return heading || clean(document.title).replace(/\s*[|·].*$/, "").slice(0, 180);
  }
  function pageRecentGroupPosts() {
    const rows = [];
    const seen = new Set();
    for (const node of [...document.querySelectorAll('[role="article"],article,[data-pagelet^="FeedUnit_"]')]) {
      if (!visible(node) || node.closest('[role="dialog"]')) continue;
      const text = clean(node.innerText || node.textContent);
      if (text.length < 30 || /được tài trợ|sponsored|tin nhắn|messenger/i.test(text)) continue;
      const key = text.slice(0, 180).toLocaleLowerCase("vi");
      if (seen.has(key)) continue;
      seen.add(key); rows.push(text.slice(0, 900));
      if (rows.length >= 8) break;
    }
    return rows;
  }
  function pageGroupPostOpener() {
    const labels = /^(?:bạn\s+(?:đang\s+)?(?:viết|nghĩ)\s+gì(?:\s+đi)?(?:\s+thế)?\s*[?…\.]{0,3}|viết gì đó[\.…]?|tạo bài viết|write something|create post)$/i;
    return [...document.querySelectorAll('[role="main"] [role="button"],[role="main"] button,[role="main"] [tabindex],button,[role="button"]')]
      .filter(visible).filter(control => !control.closest('[role="dialog"]')).find(control => labels.test(labelOf(control))) || null;
  }
  // Chọn màu nền cho bài đăng trong nhóm. Trả về true nếu thành công, false nếu không.
  async function pageSelectGroupPostBackground(dialog, bgConfig, flag, runId) {
    const PAGE_POST_BG_COLORS = { pink:"#e91e63",green:"#2e7d32",red:"#d32f2f",orange:"#ef6c00",yellow:"#f9a825",blue:"#1976d2",purple:"#7b1fa2",burgundy:"#8e244d",beige:"#b9a07e",brown:"#6d4c41",gray:"#78909c",black:"#263238" };
    // Khớp tên màu trong label nút — label có thể là "Hồng", "Phông nền màu hồng", "Pink background", v.v.
    // Không yêu cầu phải có "phông nền" vì FB đôi khi chỉ ghi tên màu hoặc "Hồng" đơn thuần.
    function bgMatchColor(color, label) {
      const t = String(label || "").toLowerCase();
      if (!t) return false;
      // Loại gradient/illustration
      if (/gradient|chuyển\s*sắc|nền\s*chuyển\s*màu|hình\s*minh\s*họa|illustration/.test(t)) return false;
      if (color === "pink") return /màu hồng|hồng\b|pink/.test(t) && !/đỏ/.test(t);
      if (color === "green") return /xanh lá cây|xanh lá|green/.test(t);
      if (color === "red") return /(?:màu )?đỏ(?:[,\s]|$)|red/.test(t) && !/hồng|sẫm|thẫm|điều|burgundy/.test(t);
      if (color === "orange") return /màu cam|cam\b|orange/.test(t);
      if (color === "yellow") return /màu vàng(?:[,\s]|$)|yellow/.test(t);
      if (color === "blue") return /xanh da trời|xanh dương|xanh bạc|blue/.test(t);
      if (color === "purple") return /màu tím(?:[,\s]|$)|tím đậm|tím sẫm|tím thẫm|purple/.test(t) && !/hồng/.test(t);
      if (color === "burgundy") return /đỏ sẫm|đỏ thẫm|đỏ điều|đỏ đậm|burgundy/.test(t);
      if (color === "beige") return /màu be(?:[,\s]|$)|beige/.test(t);
      if (color === "brown") return /màu nâu|brown/.test(t);
      if (color === "gray") return /màu xám|xám nhạt|gray|grey/.test(t);
      if (color === "black") return /đen|màu đen|black/.test(t);
      return false;
    }
    // Chọn màu từ config
    const allowed = Object.keys(PAGE_POST_BG_COLORS);
    let targetColor;
    if (bgConfig.mode === "fixed") {
      targetColor = allowed.includes(bgConfig.fixedColor) ? bgConfig.fixedColor : "pink";
    } else {
      const pool = (bgConfig.colors || []).filter(c => allowed.includes(c));
      const valid = pool.length ? pool : allowed;
      targetColor = valid[Math.floor(Math.random() * valid.length)];
    }
    // Mở palette nếu chưa mở — tìm cả trong dialog lẫn document (toolbar có thể nằm ngoài dialog)
    const showBgBtn = [...document.querySelectorAll('[role="button"],button')].filter(visible)
      .find(b => {
        const lbl = labelOf(b);
        return /hiển thị.*phông nền|show.*background|^aa$/i.test(lbl) && !/^ẩn/i.test(lbl) && b.closest('[role="dialog"],[aria-modal="true"]');
      });
    const diagShr = (extra = {}) => { try { window.__pageBgDiag = Object.assign({ at: Date.now() }, extra); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } };
    if (showBgBtn) {
      try { showBgBtn.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(900);
    } else {
      diagShr({ stage: "no-palette-btn" });
    }
    // Tìm nút màu khớp — thử trong dialog trước, fallback toàn document
    const scope = [...document.querySelectorAll('[role="dialog"] [role="button"],[aria-modal="true"] [role="button"]')];
    let colorBtns = scope.filter(visible).filter(b => bgMatchColor(targetColor, labelOf(b)));
    // Fallback: nếu targetColor không có trong palette hiện tại, thử màu bất kỳ khả dụng
    if (!colorBtns.length) {
      const anyColor = scope.filter(visible).filter(b => {
        const lbl = labelOf(b);
        return allowed.some(c => bgMatchColor(c, lbl));
      });
      if (!anyColor.length) {
        diagShr({ stage: "no-colors", paletteOpened: !!showBgBtn, scopeBtns: scope.filter(visible).map(b => labelOf(b).slice(0, 30)).slice(0, 12) });
        return false;
      }
      colorBtns = anyColor;
    }
    const btn = colorBtns[0];
    const btnLabel = labelOf(btn).slice(0, 40);
    // Detect nền màu đã lên: kiểm tra màu chính xác theo danh sách 12 màu biết trước,
    // quét cả document (không chỉ dialog) vì FB đôi khi render preview ngoài dialog.
    // Cũng kiểm tra aria-checked/pressed trên nút màu — FB có thể đã thêm lại attribute.
    // Fallback cuối: nếu button đã click thành công + palette đã mở → tin là đã áp.
    const hexToRgbStr = hex => {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgb(${r}, ${g}, ${b})`;
    };
    const knownRgb = new Set(Object.values(PAGE_POST_BG_COLORS).map(hexToRgbStr));
    // Bỏ qua màu nền mặc định của FB (tối/sáng) — chỉ quan tâm màu "lạ" xuất hiện mới
    const defaultBg = new Set(['rgba(0, 0, 0, 0)', 'transparent', 'rgb(255, 255, 255)',
      'rgb(24, 25, 26)', 'rgb(36, 37, 38)', 'rgb(58, 59, 60)', 'rgb(18, 18, 18)',
      'rgb(255, 255, 254)', 'rgb(0, 0, 0)']);
    const snapBgColors = () => {
      const found = new Set();
      const debugAll = [];
      // Pass 1: element lớn toàn document (>80x50, relaxed)
      for (const el of document.querySelectorAll("*")) {
        if (!visible(el)) continue;
        try {
          const r = el.getBoundingClientRect();
          if (r.width < 80 || r.height < 50) continue;
          const bc = getComputedStyle(el).backgroundColor;
          if (knownRgb.has(bc)) found.add(bc);
        } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      }
      // Pass 2: màu lạ trong dialog — chỉ phần tử đủ lớn (>60x60) để bỏ qua
      // các nút palette nhỏ (~36px) vốn luôn hiện sẵn trước khi click nền màu.
      for (const el of document.querySelectorAll('[role="dialog"] *,[aria-modal="true"] *')) {
        try {
          const r2 = el.getBoundingClientRect();
          if (r2.width < 60 || r2.height < 60) continue;
          const bc = getComputedStyle(el).backgroundColor;
          if (!bc || defaultBg.has(bc)) continue;
          found.add(bc); // chấp nhận bất kỳ màu mới nào — so sánh before/after
          debugAll.push(bc);
        } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      }
      // Pass 3: inline style + ancestor của editor
      const editor = document.querySelector('[role="dialog"] [contenteditable],[aria-modal="true"] [contenteditable]');
      if (editor) {
        let cur = editor;
        for (let d = 0; d < 8 && cur; d++, cur = cur.parentElement) {
          try {
            const bc = getComputedStyle(cur).backgroundColor;
            if (bc && !defaultBg.has(bc)) found.add(bc);
            const inlineBc = cur.style?.backgroundColor;
            if (inlineBc && !defaultBg.has(inlineBc)) found.add(inlineBc);
          } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        }
      }
      try { window.__snapDebug = [...new Set(debugAll)].slice(0, 15); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      return found;
    };
    const btnChecked = () => {
      const attr = btn.getAttribute("aria-checked") || btn.getAttribute("aria-pressed") || btn.getAttribute("aria-selected") || "";
      return attr.toLowerCase() === "true";
    };
    const bgBefore = snapBgColors();
    await dismissPageStraysOnly(btn);
    if (!(await pageFeatureClick(btn, flag, runId))) {
      try { btn.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    }
    await sleep(1200);
    const bgAfter = snapBgColors();
    // Áp dụng: (a) có màu mới xuất hiện, (b) nút được đánh dấu checked.
    const newColors = [...bgAfter].filter(c => !bgBefore.has(c));
    const applied = newColors.length > 0 || btnChecked();
    const snapDbg = (() => { try { return window.__snapDebug || []; } catch (_) { return []; } })();
    diagShr({ stage: applied ? "applied" : "style-unchanged", color: btnLabel, bgBefore: [...bgBefore], bgAfter: [...bgAfter], newColors, btnChecked: btnChecked(), snapDbg });
    return applied;
  }
  function pageGroupPostEditor(dialog) {
    return [...(dialog || document).querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"]')]
      .find(box => visible(box) && !/bình luận|comment/i.test(box.getAttribute("aria-label") || "")) || null;
  }
  function pageGroupPostDialog() {
    return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(visible).find(dialog => {
      if (!pageGroupPostEditor(dialog)) return false;
      const text = clean(dialog.innerText || dialog.getAttribute("aria-label"));
      return /tạo bài viết|create post|bài viết|post/i.test(text);
    }) || null;
  }
  function pageGroupPostButton(dialog) {
    return [...(dialog || document).querySelectorAll('button,[role="button"],div[role="button"]')]
      .filter(visible).find(button => /^(?:đăng|post|publish|gửi|send)$/i.test(labelOf(button)) && !button.disabled && button.getAttribute("aria-disabled") !== "true") || null;
  }
  async function waitPageGroupComposer(flag, runId, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!(await pageFeatureLive(flag, runId))) return null;
      const dialog = pageGroupPostDialog(), editor = dialog && pageGroupPostEditor(dialog);
      if (dialog && editor) return { dialog, editor };
      await sleep(350);
    }
    return null;
  }
  async function pageClearGroupDraft(editor, flag, runId) {
    const current = clean(editor?.innerText || editor?.textContent || editor?.value);
    if (!current) return true;
    // Focus chắc chắn bằng trusted click giữa editor: DOM click/focus thường
    // không đủ để Lexical nhận phím thật, khiến Ctrl+A+Backspace rơi vào body
    // (đã tái hiện: bản nháp còn nguyên sau khi "xóa", phiên sau kẹt draftBusy).
    try { await pageFeatureClick(editor, flag, runId); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    try { editor.focus(); editor.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    // Approach 1: trustedKey Ctrl+A + Backspace (lặp 2 lần cho đoạn rỗng còn sót của Lexical)
    const mod = /Mac|iPhone|iPad/i.test(navigator.platform || "") ? 4 : 2;
    for (let round = 0; round < 2; round++) {
      try { await chrome.runtime.sendMessage({ action: "trustedKey", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: mod, abortStorageKey: flag, abortRunId: runId }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      try { await chrome.runtime.sendMessage({ action: "trustedKey", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, abortStorageKey: flag, abortRunId: runId }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(250);
      if (!clean(editor.innerText || editor.textContent || editor.value)) return true;
      if (!(await pageFeatureLive(flag, runId))) return false;
    }
    // Approach 2: Selection API + execCommand fallback
    try {
      editor.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("delete");
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    await sleep(200);
    if (!clean(editor.innerText || editor.textContent || editor.value)) return true;
    // Approach 3: Close and reopen the dialog (FB sometimes restores draft on open)
    try {
      const closeBtn = [...document.querySelectorAll('[role="dialog"] [aria-label],[aria-modal="true"] [aria-label]')]
        .find(b => /đóng|close/i.test(labelOf(b)));
      if (closeBtn) { closeBtn.click(); await sleep(800); }
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    return false;
  }
  function pageGroupPostVisible(content) {
    const expected = clean(content).slice(0, 80).toLocaleLowerCase("vi");
    if (expected.length < 10) return false;
    const root = document.querySelector('[role="main"]') || document.body;
    return [...root.querySelectorAll('[role="article"],article,[data-pagelet]')]
      .filter(visible)
      .filter(node => !node.closest('[role="dialog"],[aria-modal="true"]'))
      .some(card => {
        const textNodes = [...card.querySelectorAll('span,p,div')]
          .filter(node => visible(node) && !node.querySelector('[contenteditable="true"],[role="textbox"]'))
          .filter(node => !node.closest('[contenteditable="true"],[role="textbox"],[role="dialog"],[aria-modal="true"]'));
        return textNodes.some(node => {
          const text = clean(node.innerText || node.textContent).toLocaleLowerCase("vi");
          return text.length < 1500 && text.includes(expected);
        });
      });
  }
  // Banner "Bài viết đang chờ phê duyệt" của Facebook (nằm trong main, không
  // phải role=status/alert): bằng chứng submit thành công ở nhóm bật duyệt bài.
  function pageGroupPendingSignal(){
    try{
      const t=clean(((document.querySelector('[role="main"]')||document.body).innerText||""));
      return /bài viết.{0,120}(đang chờ|chờ.+phê duyệt|phê duyệt)|đang chờ quản trị viên|pending.{0,60}review|awaiting.+approval|submitted for review/i.test(t);
    }catch{return false;}
  }
  async function pageSubmitGroupPost(composer, content, flag, runId, groupName) {
    if (!(await pageFeatureLive(flag, runId))) return false;
    const expectedContent = clean(content);
    const liveBefore = pageGroupPostDialog(), editorBefore = liveBefore && pageGroupPostEditor(liveBefore);
    const actualBefore = clean(editorBefore?.innerText || editorBefore?.textContent || editorBefore?.value || "");
    if (actualBefore !== expectedContent) {
      try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "content-mismatch-before-submit", expectedLen: expectedContent.length, actualLen: actualBefore.length } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      return false;
    }
    await chrome.storage.local.set({ pageGroupPostStage: "submit-armed", pageGroupPostStatus: t("pgp.submitting", { name: groupName }) });
    if (!(await pageFeatureLive(flag, runId))) return false;
    // Đợi nút Đăng KHẢ DỤNG trong dialog hiện tại (tìm tươi mỗi vòng): sau khi
    // gõ, Facebook bật/tắt + re-render nút nhiều lần — nút tìm được quá sớm
    // hoặc từ dialog cũ đều không bấm được (đã tái hiện: stage kẹt submit-armed,
    // không có diag vì return trước cả vòng re-find cũ).
    let button = null;
    const btnDeadline = Date.now() + 30000;
    while (Date.now() < btnDeadline) {
      if (!(await pageFeatureLive(flag, runId))) return false;
      const dlg = pageGroupPostDialog();
      const candidate = dlg && pageGroupPostButton(dlg);
      if (candidate && visible(candidate) && !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true") { button = candidate; break; }
      await sleep(500);
    }
    if (!button) {
      try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "button-gone", dialogOpen: !!pageGroupPostDialog() } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      return false;
    }
    // Re-find nút Đăng ngay trước cú bấm: dialog React của Facebook re-render
    // sau khi gõ xong (đổi trạng thái enable) khiến node tìm trước đó rời DOM;
    // click vào node detached không có tác dụng nhưng cũng không báo lỗi
    // (đã tái hiện live 3 lần liên tiếp: proof-fail ở stage submit-armed).
    // QUAN TRỌNG: dismissPageStraysOnly phải dùng anchor TƯƠI — anchor cũ trỏ
    // dialog đã chết, khiến dialog đang sống bị coi là "stray" và bị Escape/
    // body.click đóng mất (tái hiện: dialog biến mất, diag button-gone).
    // dismiss đã được DỜI lên ngay sau waitComposer (dialog còn tươi): chạy
    // dismiss ở đây, sau khi gõ, sẽ làm chính dialog đang sống bị đóng vì
    // anchor đã cũ (rect [0,0] / button-gone đã tái hiện).
    // Snapshot + click back-to-back ngay sau vòng đợi trên (không sleep/
    // dismiss ở giữa) để nút không kịp rời DOM lần nữa. Dùng luôn `button`
    // vừa tìm được, không tìm lại lần hai.
    const freshBtn = button;
    // Snapshot + click back-to-back (không sleep/dismiss ở giữa) để nút
    // không kịp rời DOM lần nữa.
    // Ghi lại trạng thái nút/điểm bấm để chẩn đoán khi proof thất bại
    // (đã tái hiện: dialog còn mở sau cú bấm mà không có manh mối nào).
    let clickDetail = null;
    try {
      const r = freshBtn.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      clickDetail = { label: labelOf(freshBtn).slice(0, 40), disabled: !!(freshBtn.disabled || freshBtn.getAttribute("aria-disabled") === "true"), point: [x, y], top: top ? String(top.getAttribute?.("aria-label") || top.innerText || top.tagName || "").slice(0, 60) : "none" };
    } catch (_) { clickDetail = null; }
    // Chụp tín hiệu chờ-duyệt TRƯỚC cú bấm: banner chờ duyệt xuất hiện sau
    // submit mới là bằng chứng của lượt này (banner cũ của bài trước đó không
    // được tính — bắt live: bài đã gửi nhưng dialog kẹt "Đang tải", proof cũ
    // trượt hết dù banner chờ duyệt hiện rõ trong main).
    const hadPending = pageGroupPendingSignal();
    let pendingProof = false;
    if (!(await pageFeatureClick(freshBtn, flag, runId))) {
      try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "click-failed", click: clickDetail, dialogOpen: !!pageGroupPostDialog() } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      return false;
    }
    await chrome.storage.local.set({ pageGroupPostStage: "submit-dispatched", pageGroupPostSubmitAt: Date.now() });
    // Theo dõi đúng dialog ĐANG SỐNG chứa nút vừa bấm (freshBtn), không phải
    // composer.dialog cũ — node cũ rời DOM sau re-render sẽ khiến proof tưởng
    // dialog đã đóng và cộng bộ đếm oan.
    const dialogEl = freshBtn.closest?.('[role="dialog"],[aria-modal="true"]') || composer.dialog;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (!(await pageFeatureLive(flag, runId))) return false;
      // Dialog đóng = bài đã được submit (kể cả khi nhóm cần duyệt / pending moderation)
      if (!document.contains(dialogEl) || !visible(dialogEl)) return true;
      const statusText = clean([...document.querySelectorAll('[role="status"],[role="alert"]')].filter(visible).map(labelOf).join(" "));
      if (pageGroupPostVisible(content) || /bài viết.{0,80}(?:đã đăng|đang chờ|phê duyệt)|post.{0,80}(?:published|pending|review)/i.test(statusText)) return true;
      // Nhóm bật duyệt bài: dialog có thể kẹt "Đang tải" trong khi banner chờ
      // duyệt đã hiện trong main — tính là đã gửi (chờ duyệt), không phải lỗi.
      if (!hadPending && pageGroupPendingSignal()) return "pending";
      await sleep(500);
    }
    // Hết giờ mà dialog vẫn mở: lưu chẩn đoán để lần sau biết vì sao.
    try {
      const statusText = clean([...document.querySelectorAll('[role="status"],[role="alert"]')].filter(visible).map(labelOf).join(" "));
      const ed = dialogEl?.querySelector?.('[contenteditable="true"]');
      await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, click: clickDetail, alerts: String(statusText || "").slice(0, 300), editorLen: ed ? (ed.innerText || "").length : -1, dialogOpen: !!(dialogEl && document.contains(dialogEl) && visible(dialogEl)) } });
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    return false;
  }
  function pagePostSkipCount() {
    pagePostConfig.skipped = (pagePostConfig.skipped || 0) + 1;
    return pagePostConfig.skipped;
  }
  async function closePageGroupComposer() {
    // Đóng tối đa 3 lượt, tìm tươi nút Đóng mỗi lượt (node cũ rời DOM sau
    // re-render khiến click câm). Kèm hộp thoại xác nhận bỏ bản nháp.
    for (let attempt = 0; attempt < 3; attempt++) {
      const dialog = pageGroupPostDialog();
      if (!dialog) return true;
      const close = [...dialog.querySelectorAll('button,[role="button"]')].filter(visible).find(button => /^(?:đóng|close)$/i.test(labelOf(button)));
      if (close) { try { close.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } await sleep(400); }
      const discard = [...document.querySelectorAll('button,[role="button"]')].filter(visible).find(button => /^(?:bỏ|bỏ bài viết|xóa(?: bài viết)?|hủy(?: bỏ)?|discard(?: post)?|delete(?: post)?)$/i.test(labelOf(button)));
      if (discard) { try { discard.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } await sleep(400); }
      if (!pageGroupPostDialog()) return true;
      await sleep(300);
    }
    return !pageGroupPostDialog();
  }
  async function pageGroupPostOne(group, runId, index) {
    if (!(await pageFeatureLive(PAGE_POST_FLAG, runId))) return false;
    // Phải ở đúng group FEED (không phải subpage /user/, /media/...) để có nút đăng bài
    if (!pageOnGroupFeed() || pageCurrentGroupKey() !== group.key) { location.replace(group.url); return false; }
    // Thử lại 1 lần các lỗi TRƯỚC-submit (actor/member/opener/composer): chúng
    // thường do trang tải dở ngay sau điều hướng (bắt live: skip oan rồi chạy
    // lại ăn ngay). An toàn vì chưa có gì được đăng; chặn retry sau submit
    // bằng cờ dispatched + marker theo index (sống qua reload).
    async function retryPreSubmitOnce() {
      try {
        // Chỉ các điểm gọi TRƯỚC-submit mới dùng helper này nên không thể đã
        // dispatch; marker theo index (sống qua reload) chặn thử lần 3.
        const s = await chrome.storage.local.get(["pageGroupPostRetriedIdx"]);
        if (Number(s.pageGroupPostRetriedIdx) === Number(index)) return false;
        await closePageGroupComposer();
        await chrome.storage.local.set({ pageGroupPostRetriedIdx: index, pageGroupPostStatus: t("pgp.retrying", { name: group?.name || group?.key || "" }) });
        if (group?.url) location.replace(group.url);
        return true;
      } catch (_) { return false; }
    }
    if (!(await pageSwitchActor(pagePostConfig.page, PAGE_POST_FLAG, runId))) {
      if (await retryPreSubmitOnce()) return "reloading";
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.noPageActor", { name: pagePostConfig.page.name }) });
      return false;
    }
    // Đóng actor menu nếu còn mở sau khi switch actor xong, để nút composer visible
    await closePageActorMenu();
    await sleep(400);
    const groupName = pageCurrentGroupName() || group.name || group.key;
    const recentPosts = pageRecentGroupPosts();
    // Dùng đúng hồ sơ AI đã gán cho Page đăng bài (pagePostConfig.aiConfig);
    // liveAiConfig() đọc currentConfig của luồng JOIN nên nhóm này từng chạy
    // bằng Gemini dù user đã chọn Meta AI cho Đăng bài (user báo live).
    const ai = (pagePostConfig?.aiConfig && pagePostConfig.aiConfig.provider)
      ? pagePostConfig.aiConfig
      : await liveAiConfig();
    const profile = pagePostConfig.styleProfile || pagePostConfig.pageProfile || null;
    const bgCfgForAi = pagePostConfig.bgConfig;
    const maxCharsHint = bgCfgForAi?.enabled ? (bgCfgForAi.maxChars || 130) : null;
    await chrome.storage.local.set({ pageGroupPostStatus: t("pgp.aiCalling", { name: groupName, provider: ai.provider || "AI" }) });
    const generated = await chrome.runtime.sendMessage({ action: "aiGeneratePageGroupPost", groupName, pageName: pagePostConfig.page.name, recentPosts, prompt: pagePostConfig.prompt, pageProfile: profile, aiConfig: ai, maxChars: maxCharsHint }).catch(() => null);
    if (!generated?.ok || !generated.content) {
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: generated?.error || t("pgp.aiFailed", { name: groupName }) });
      return false;
    }
    // Kiểm tra Page có phải thành viên nhóm chưa (nếu thấy "Tham gia nhóm" thì Page chưa join)
    const joinGroupBtn = [...document.querySelectorAll('[role="main"] [role="button"],[role="main"] button')]
      .filter(visible).find(b => /^(?:tham gia nhóm|join group)$/i.test(labelOf(b)));
    if (joinGroupBtn) {
      if (await retryPreSubmitOnce()) return "reloading";
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.pageNotMember", { page: pagePostConfig.page.name, name: groupName }) });
      return false;
    }
    // Dọn overlay/dialog lạc trước khi bấm mở composer — pageFeatureClick chỉ
    // bấm theo toạ độ, một dialog che ngay điểm bấm sẽ nuốt mất cú click.
    await dismissPageOverlays();
    const opener = pageGroupPostOpener();
    if (!opener || !(await pageFeatureClick(opener, PAGE_POST_FLAG, runId))) {
      if (await retryPreSubmitOnce()) return "reloading";
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.noComposer", { name: groupName }) });
      return false;
    }
    let composer = await waitPageGroupComposer(PAGE_POST_FLAG, runId);
    if (composer) {
      // Dọn overlay lạ NGAY khi dialog còn tươi (editor vừa tìm thấy): chạy dismiss
      // ở đây thay vì ngay trước cú bấm Đăng — vì sau khi gõ, dialog re-render,
      // anchor cũ sẽ khiến dialog đang sống bị coi là "stray" và bị đóng mất
      // (tái hiện: diag button-gone, dialogOpen:false).
      await dismissPageStraysOnly(composer.editor);
    }
    if (composer && !(await pageClearGroupDraft(composer.editor, PAGE_POST_FLAG, runId))) {
      // Draft không xóa được — thử đóng rồi mở lại composer
      await closePageGroupComposer(); await sleep(600);
      await dismissPageOverlays();
      const opener2 = pageGroupPostOpener();
      if (opener2 && (await pageFeatureClick(opener2, PAGE_POST_FLAG, runId))) {
        composer = await waitPageGroupComposer(PAGE_POST_FLAG, runId);
        if (composer && !(await pageClearGroupDraft(composer.editor, PAGE_POST_FLAG, runId))) {
          composer = null; // vẫn còn draft → skip
        }
      } else {
        composer = null;
      }
    }
    if (!composer) {
      // Opener đã bấm nhưng dialog chưa dựng (render race) — thử tải lại 1 lần
      // trước khi kết luận draft kẹt.
      if (await retryPreSubmitOnce()) return "reloading";
      await closePageGroupComposer();
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.draftBusy", { name: groupName }) });
      return false;
    }
    // Áp dụng nền màu nếu được bật và nội dung đủ ngắn
    const bgCfg = pagePostConfig.bgConfig;
    if (bgCfg?.enabled && [...generated.content].length <= (bgCfg.maxChars || 130)) {
      const bgOk = await pageSelectGroupPostBackground(composer.dialog, bgCfg, PAGE_POST_FLAG, runId);
      if (!bgOk && bgCfg.fallback === "skip") {
        await closePageGroupComposer();
        let bgWhy = null;
        try { bgWhy = window.__pageBgDiag || null; window.__pageBgDiag = null; } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "bg-select-fail", bg: bgWhy } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.bgFailed", { name: groupName }) });
        return false;
      }
      if (bgOk) {
        // Lưu proof nền đã được Facebook áp vào composer để hậu kiểm live;
        // không dùng metadata này thay cho proof submit/hiển thị bài.
        try {
          const proof = window.__pageBgDiag || {};
          await chrome.storage.local.set({ pageGroupPostLastBackground: { at: Date.now(), group: groupName, ...proof } });
          window.__pageBgDiag = null;
        } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      }
      // Sau khi chọn nền, editor element có thể thay đổi → lấy lại
      const freshEditor = pageGroupPostEditor(composer.dialog);
      if (freshEditor) composer = { dialog: composer.dialog, editor: freshEditor };
    }
    composer.editor.focus(); composer.editor.click();
    const tc = pagePostConfig.typingConfig || {};
    const wantText = clean(generated.content);
    const wantPrefix = wantText.slice(0, 35);
    // Kiểm tra phím có rơi nhầm ô khác không (đã tái hiện live: cả bài AI nằm
    // trong ô reply của người khác trong feed). Quét mọi editor đang hiển thị
    // NGOÀI dialog composer; nếu ô nào chứa prefix thì dừng ngay, không submit.
    const misplacedPrefix = () => {
      const dlg = pageGroupPostDialog();
      return [...document.querySelectorAll('[contenteditable="true"],[role="textbox"],textarea')]
        .filter(el => visible(el) && (!dlg || !dlg.contains(el)))
        .some(el => clean(el.innerText || el.textContent || el.value).includes(wantPrefix));
    };
    const describeNode = (el) => {
      try {
        if (!el) return "none";
        const path = [];
        let cur = el;
        for (let i = 0; i < 4 && cur && cur !== document.body; i++, cur = cur.parentElement) {
          path.push(`${cur.tagName || "?"}#${cur.getAttribute?.("role") || ""}.${String(cur.className || "").split(" ").slice(0, 2).join(".")}`);
        }
        return `${el.tagName}#${el.getAttribute?.("role") || ""}[aria=${clean(el.getAttribute?.("aria-label") || "").slice(0, 40)}] << ${path.join(" < ")}`;
      } catch (_) { return "err"; }
    };
    const misplacedNode = () => {
      const dlg = pageGroupPostDialog();
      return [...document.querySelectorAll('[contenteditable="true"],[role="textbox"],textarea')]
        .filter(el => visible(el) && (!dlg || !dlg.contains(el)))
        .find(el => clean(el.innerText || el.textContent || el.value).includes(wantPrefix)) || null;
    };
    let typedOk = false, misplaced = false;
    const typeDiag = [];
    // Gõ lại tối đa 3 lần: dialog re-render giữa chừng khiến phím rơi vào node
    // cũ (đã tái hiện live: lúc gõ được lúc không giữa các phiên).
    for (let typeAttempt = 0; typeAttempt < 3 && !typedOk && !misplaced; typeAttempt++) {
      const round = { attempt: typeAttempt };
      if (!(await pageFeatureLive(PAGE_POST_FLAG, runId))) return false;
      // Dialog phải còn sống trước mỗi lượt gõ: nếu đã mất (FB đóng/rerender
      // sau dismiss...), mở lại từ opener thay vì gõ vào node chết rồi verify
      // oan (đã tái hiện: editorAlive=false, focus kẹt ở nút opener).
      let liveDlg = pageGroupPostDialog();
      if (!liveDlg) {
        await closePageGroupComposer(); await sleep(500);
        await dismissPageOverlays();
        const op = pageGroupPostOpener();
        if (op && await pageFeatureClick(op, PAGE_POST_FLAG, runId)) {
          composer = await waitPageGroupComposer(PAGE_POST_FLAG, runId);
        } else { composer = null; }
        if (!composer) { round.dialogGone = true; typeDiag.push(round); await sleep(600); continue; }
        liveDlg = pageGroupPostDialog();
      }
      if (liveDlg) composer = { dialog: liveDlg, editor: pageGroupPostEditor(liveDlg) || composer.editor };
      if (typeAttempt > 0) {
        // Dọn phần gõ hụt trước khi gõ lại để không nhân đôi nội dung
        if (!(await pageClearGroupDraft(composer.editor, PAGE_POST_FLAG, runId))) {
          await closePageGroupComposer(); await sleep(600);
          composer = await waitPageGroupComposer(PAGE_POST_FLAG, runId);
          if (!composer) break;
        }
        const fresh = pageGroupPostEditor(pageGroupPostDialog());
        if (fresh) composer = { dialog: composer.dialog, editor: fresh };
      }
      // Focus chắc chắn vào đúng editor và xác minh activeElement trước khi gõ
      let focused = false, activeDesc = "";
      for (let f = 0; f < 3 && !focused; f++) {
        try { await pageFeatureClick(composer.editor, PAGE_POST_FLAG, runId); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        try { composer.editor.focus(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await sleep(200);
        try {
          const ae = document.activeElement;
          activeDesc = ae ? String(ae.tagName + "#" + (ae.getAttribute?.("role") || "") + ":" + clean(ae.getAttribute?.("aria-label") || ae.innerText || "").slice(0, 40)) : "none";
          focused = !!(composer.editor.contains?.(ae) || composer.editor === ae);
        } catch (_) { focused = false; }
      }
      round.focused = focused; round.active = activeDesc;
      round.editorAlive = !!(composer.editor?.isConnected);
      if (!focused) {
        typeDiag.push(round);
        try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "type-focus-fail", rounds: [...typeDiag] } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await sleep(600); continue;
      }
      // Gõ nguyên tử trong MỘT evaluate đồng bộ (focus → selectAll →
      // execCommand insertText → input event): không có khe async để
      // re-render xen vào giữa chừng như khi gõ từng phím qua debugger
      // (đã tái hiện: phím rơi vào ô reply / node chết giữa chừng).
      // Fallback về trustedInput từng phím nếu insertText thất bại.
      let typed = null;
      let okAtomic = false, gotAfterAtomic = "";
      try {
        okAtomic = (() => {
          composer.editor.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(composer.editor);
          sel.removeAllRanges();
          sel.addRange(range);
          const ok = document.execCommand("insertText", false, generated.content);
          composer.editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
          return !!ok;
        })();
        gotAfterAtomic = clean(composer.editor.innerText || composer.editor.textContent || composer.editor.value);
      } catch (_) { okAtomic = false; }
      round.atomic = okAtomic; round.atomicGotLen = gotAfterAtomic.length;
      // execCommand trả true "vacuously" khi tab Facebook không focus (đã tái
      // hiện live: okAtomic=true nhưng editor trống). Chỉ tin khi verify đủ.
      // Lexical áp dụng insert BẤT ĐỒNG BỘ (đọc ngay sau insert luôn trống) nên
      // phải chờ ~800ms rồi đọc lại trước khi kết luận — nếu không sẽ gọi thêm
      // trustedInput và nhân đôi nội dung (đã tái hiện: gotLen gấp đôi wantLen).
      if (okAtomic && !gotAfterAtomic.includes(wantPrefix)) {
        await sleep(800);
        gotAfterAtomic = clean(composer.editor.innerText || composer.editor.textContent || composer.editor.value);
        round.atomicGotLen = gotAfterAtomic.length;
      }
      if (okAtomic && gotAfterAtomic === wantText) {
        typed = { ok: true };
      } else {
        typed = await chrome.runtime.sendMessage({ action: "trustedInput", text: generated.content, pressEnter: false, typingMinDelay: tc.minDelay ?? 18, typingMaxDelay: tc.maxDelay ?? 35, abortStorageKey: PAGE_POST_FLAG, abortRunId: runId, abortRunIdKey: "pageGroupPostRunId" }).catch(() => null);
      }
      round.typedOk = !!typed?.ok;
      // Đọc lại editor TƯƠI trong dialog đang sống (không đọc node cũ đã rời DOM)
      const liveDialog = pageGroupPostDialog();
      const liveEditor = (liveDialog && pageGroupPostEditor(liveDialog)) || composer.editor;
      if (liveEditor && liveEditor !== composer.editor) composer = { dialog: liveDialog || composer.dialog, editor: liveEditor };
      const gotText = clean(composer.editor.innerText || composer.editor.textContent || composer.editor.value);
      round.gotLen = gotText.length; round.wantLen = wantText.length;
      const badNode = misplacedNode();
      round.misplaced = !!badNode;
      round.misplacedDesc = badNode ? describeNode(badNode) : "";
      round.dialogDesc = (() => { const d = pageGroupPostDialog(); return d ? clean(d.getAttribute?.("aria-label") || "").slice(0, 40) + "|" + clean(d.innerText || "").slice(0, 80) : "NO_DIALOG"; })();
      round.editorDesc = describeNode(composer.editor);
      if (round.misplaced) { misplaced = true; break; }
      typedOk = !!typed?.ok && gotText === wantText;
      round.typedOk = typedOk;
      typeDiag.push(round);
      try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "type-round", rounds: [...typeDiag] } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      if (!typedOk) await sleep(600);
    }
    if (misplaced) {
      await closePageGroupComposer();
      try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "typed-misplaced", rounds: typeDiag } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.typeFailed", { name: groupName }) });
      return false;
    }
    if (!typedOk) {
      await closePageGroupComposer();
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.typeFailed", { name: groupName }) });
      return false;
    }
    // Nền màu yêu cầu nội dung THỰC TẾ trong editor ≤ giới hạn (Facebook tự gỡ
    // nền khi bài dài). Kiểm tra lại sau khi gõ vì nháp cũ có thể đội thêm
    // (đã tái hiện: bài dài đăng không nền dù AI viết đúng giới hạn).
    const bgCfgAfter = pagePostConfig.bgConfig;
    if (bgCfgAfter?.enabled) {
      const liveEd = pageGroupPostEditor(pageGroupPostDialog()) || composer.editor;
      const liveLen = [...clean(liveEd?.innerText || liveEd?.textContent || liveEd?.value || "")].length;
      if (liveLen > (bgCfgAfter.maxChars || 130)) {
        await closePageGroupComposer();
        try { await chrome.storage.local.set({ pageGroupPostLastDiag: { at: Date.now(), group: groupName, phase: "bg-too-long", editorLen: liveLen, max: bgCfgAfter.maxChars || 130 } }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.bgFailed", { name: groupName }) });
        return false;
      }
    }
    const posted = await pageSubmitGroupPost(composer, generated.content, PAGE_POST_FLAG, runId, groupName);
    if (!posted) {
      // Dọn composer kể cả khi submit thất bại: nếu không, bản nháp còn lại
      // làm mọi phiên sau kẹt ở draftBusy (đã tái hiện live).
      await closePageGroupComposer();
      await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: t("pgp.unconfirmed", { name: groupName }) });
      return false;
    }
    const done = (pagePostConfig.done || 0) + 1;
    pagePostConfig.done = done;
    await chrome.storage.local.set({ pageGroupPostDone: done, pageGroupPostStatus: posted === "pending" ? t("pgp.pending", { name: groupName }) : t("pgp.confirmed", { name: groupName }), pageGroupPostLastContent: generated.content.slice(0, 500) });
    await chrome.runtime.sendMessage({ action: "pageStore", op: "put", store: "contentCache", value: { id: `group-post:${pageKey(pagePostConfig.page)}:${group.key}:${Date.now()}`, source: "page-group-post", groupKey: group.key, content: generated.content, at: Date.now() } }).catch(() => {});
    return true;
  }
  async function pageGroupPostLoop(runId) {
    // Bọc toàn bộ loop: một lỗi bất ngờ trước đây sẽ văng khỏi hàm mà không
    // tắt cờ pageGroupPostActive, khiến tính năng không bao giờ chạy lại được.
    try {
      const groups = Array.isArray(pagePostConfig?.groups) ? pagePostConfig.groups : [];
      const target = Math.min(groups.length, Math.max(1, parseInt(pagePostConfig?.target) || groups.length));
      let startIndex = Math.max(0, parseInt(pagePostConfig?.index) || 0);
      // Recovery: xử lý submit-dispatched còn sót từ phiên trước (tab bị tải lại sau khi bấm Đăng)
      try {
        const prev = await chrome.storage.local.get(["pageGroupPostStage","pageGroupPostSubmitAt","pageGroupPostLastContent"]);
        if (prev.pageGroupPostStage === "submit-dispatched" && startIndex < groups.length) {
          const age = Date.now() - (Number(prev.pageGroupPostSubmitAt) || 0);
          const content = String(prev.pageGroupPostLastContent || "");
          const groupName = groups[startIndex]?.name || groups[startIndex]?.key || "";
          if (age > 120000) {
            // Bài submit > 2 phút trước — kiểm tra xem có xuất hiện trên trang không
            const visibleHit = content && pageGroupPostVisible(content);
            const pendingHit = !visibleHit && !!content && pageGroupPendingSignal();
            if (visibleHit || pendingHit) {
              // Bài đã đăng thành công nhưng xác nhận bị mất do reload
              const done = (pagePostConfig.done || 0) + 1;
              pagePostConfig.done = done;
              await chrome.storage.local.set({ pageGroupPostDone: done, pageGroupPostStage: "", pageGroupPostStatus: pendingHit ? t("pgp.pending", { name: groupName }) : t("pgp.confirmed", { name: groupName }) });
            } else {
              // Không xác nhận được — skip nhóm này, không đăng lại để tránh duplicate
              await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStage: "", pageGroupPostStatus: t("pgp.unconfirmed", { name: groupName }) });
            }
            startIndex++;
            pagePostConfig.index = startIndex;
            await chrome.storage.local.set({ pageGroupPostIndex: startIndex });
          } else {
            // Submit rất gần đây (< 2 phút) — xóa stage cũ, vòng lặp sẽ retry bình thường
            await chrome.storage.local.set({ pageGroupPostStage: "" });
          }
        }
      } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      for (let index = startIndex; index < target; index++) {
        if (!(await pageFeatureLive(PAGE_POST_FLAG, runId))) return;
        // chrome.storage.onChanged có thể null hoá pagePostConfig ngay giữa 2
        // await ở trên (Stop bấm đúng lúc) — chặn deref null trước khi dùng.
        if (!pagePostConfig) return;
        const group = groups[index];
        pagePostConfig.index = index;
        await chrome.storage.local.set({ pageGroupPostIndex: index, pageGroupPostStatus: t("pgp.progress", { done: pagePostConfig.done || 0, target, name: group.name || group.key }) });
        if (!pageOnGroupFeed() || pageCurrentGroupKey() !== group.key) { location.replace(group.url); return; }
        // Một nhóm lỗi bất ngờ không được giết cả vòng lặp — bắt riêng để bỏ
        // qua đúng nhóm đó rồi tiếp tục nhóm kế tiếp.
        try {
          const oneResult = await pageGroupPostOne(group, runId, index);
          // "reloading": One đang tải lại trang để thử lần 2 (lỗi trước-submit
          // thoáng qua) — thoát vòng lặp ngay, resume sau reload chạy tiếp
          // đúng index này (marker pageGroupPostRetriedIdx chặn thử lần 3).
          if (oneResult === "reloading") return;
        } catch (error) {
          console.warn("[PageGroupPost] pageGroupPostOne", error);
          if (pagePostConfig) await chrome.storage.local.set({ pageGroupPostSkipped: pagePostSkipCount(), pageGroupPostStatus: "Lỗi: " + String(error?.message || error || "") });
        }
        if (!(await pageFeatureLive(PAGE_POST_FLAG, runId))) return;
        if (!pagePostConfig) return;
        if (!pageOnGroupFeed() || pageCurrentGroupKey() !== group.key) return;
        const min = Math.max(5, parseInt(pagePostConfig.minDelay) || 15), max = Math.max(min, parseInt(pagePostConfig.maxDelay) || 30);
        const wait = min * 1000 + Math.floor(Math.random() * Math.max(1, (max - min) * 1000));
        const until = Date.now() + wait;
        while (Date.now() < until) { if (!(await pageFeatureLive(PAGE_POST_FLAG, runId))) return; await sleep(Math.min(800, until - Date.now())); }
      }
      if (!pagePostConfig) return;
      await chrome.storage.local.set({ [PAGE_POST_FLAG]: false, pageGroupPostStatus: t("pgp.done", { done: pagePostConfig.done || 0, skipped: pagePostConfig.skipped || 0 }) });
    } catch (error) {
      console.warn("[PageGroupPost]", error);
      await chrome.storage.local.set({ [PAGE_POST_FLAG]: false, pageGroupPostStatus: "Lỗi: " + String(error?.message || error || "") });
    } finally {
      pagePostConfig = null;
    }
  }

  // -----------------------------------------------------------------------
  // Page wall news posts. This is deliberately separate from pageGroupPost:
  // it reads X/RSS/news sources, posts on the selected Page wall, and only
  // counts after the Page actor and the published post are both verified.
  // -----------------------------------------------------------------------
  const PAGE_NEWS_FLAG = "pageNewsWallActive";
  const PAGE_NEWS_USED_KEY = "pageNewsUsedUrls";
  const PAGE_NEWS_USED_CAP = 500;
  let pageNewsRunId = "", pageNewsConfig = null;

  async function pageNewsLive(runId) {
    if (!runId) return false;
    try {
      const s = await chrome.storage.local.get([PAGE_NEWS_FLAG, "pageNewsWallActiveRunId"]);
      return !!s[PAGE_NEWS_FLAG] && (!s.pageNewsWallActiveRunId || s.pageNewsWallActiveRunId === runId);
    } catch (_) { return false; }
  }
  function pageNewsRouteMatches(page) {
    try {
      const target = facebookUrl(page?.url), current = facebookUrl(location.href);
      if (!target || !current) return false;
      const tid = target.searchParams.get("id"), cid = current.searchParams.get("id");
      if (tid) return tid === cid;
      return target.pathname.replace(/\/+$/, "").toLowerCase() === current.pathname.replace(/\/+$/, "").toLowerCase();
    } catch (_) { return false; }
  }
  function pageNewsWallOpener() {
    const re = /^(?:.+?ơi,\s*)?(?:bạn\s+(?:đang\s+)?(?:viết|nghĩ)\s+gì(?:\s+đi)?(?:\s+thế)?\s*[?….]{0,3}|viết gì đó[.…]?|tạo bài viết|write something|create post)$/i;
    return [...document.querySelectorAll('[role="main"] [role="button"],[role="main"] button,button,[role="button"]')]
      .filter(visible).filter(control => !control.closest('[role="dialog"]')).find(control => re.test(labelOf(control))) || null;
  }
  async function pageNewsUsedUrls() {
    try {
      const s = await chrome.storage.local.get(PAGE_NEWS_USED_KEY);
      return Array.isArray(s[PAGE_NEWS_USED_KEY]) ? s[PAGE_NEWS_USED_KEY] : [];
    } catch (_) { return []; }
  }
  async function pageNewsMarkUsed(url) {
    if (!url) return;
    const list = await pageNewsUsedUrls();
    if (!list.includes(url)) await chrome.storage.local.set({ [PAGE_NEWS_USED_KEY]: [...list, url].slice(-PAGE_NEWS_USED_CAP) });
  }
  async function pageNewsAttachImage(dialog, item, runId) {
    let dataUrl = "", shotCredit = "";
    if (pageNewsConfig?.source?.type === "xread" && !item.image && item.link) {
      const shot = await chrome.runtime.sendMessage({ action: "xShotPost", url: item.link }).catch(() => null);
      if (shot?.ok && shot.dataUrl) { dataUrl = shot.dataUrl; shotCredit = shot.credit || ""; }
    } else if (item.image) {
      const fetched = await chrome.runtime.sendMessage({ action: "newsFetchImage", url: item.image }).catch(() => null);
      if (fetched?.ok && fetched.dataUrl) dataUrl = fetched.dataUrl;
    }
    if (!dataUrl || !(await pageNewsLive(runId))) return false;
    let input = pageSalesFileInput(dialog);
    if (!input) {
      const add = [...(dialog || document).querySelectorAll('[role="button"],button')].filter(visible)
        .find(el => /ảnh|photo|thêm ảnh|add photo|media/i.test(labelOf(el)));
      if (add) await pageFeatureClick(add, PAGE_NEWS_FLAG, runId);
    }
    const deadline = Date.now() + 20000;
    while (!input && Date.now() < deadline) {
      if (!(await pageNewsLive(runId))) return false;
      await sleep(500); input = pageSalesFileInput(pageGroupPostDialog() || dialog);
    }
    if (!input) return false;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `page-news-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
      if (shotCredit) await chrome.storage.local.set({ pageNewsLastImageCredit: shotCredit.slice(0, 120) });
    } catch (_) { return false; }
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      if (!(await pageNewsLive(runId))) return false;
      const img = [...(dialog || document).querySelectorAll("img")].find(el => visible(el) && (/^blob:|^data:/i.test(el.currentSrc || el.src || "")) && (el.naturalWidth || 0) >= 160);
      if (img) return true;
      await sleep(700);
    }
    return false;
  }
  async function pageNewsTypeContent(composer, content, runId) {
    const want = clean(content), prefix = want.slice(0, 35), tc = pageNewsConfig?.typingConfig || {};
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await pageNewsLive(runId))) return null;
      const dialog = pageGroupPostDialog() || composer?.dialog, editor = dialog && pageGroupPostEditor(dialog);
      if (!editor) { await sleep(700); continue; }
      try { await pageFeatureClick(editor, PAGE_NEWS_FLAG, runId); editor.focus(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      const typed = await chrome.runtime.sendMessage({ action: "trustedInput", text: content, pressEnter: false, typingMinDelay: tc.minDelay ?? 18, typingMaxDelay: tc.maxDelay ?? 35, abortStorageKey: PAGE_NEWS_FLAG, abortRunId: runId, abortRunIdKey: "pageNewsWallActiveRunId" }).catch(() => null);
      await sleep(700);
      const freshDialog = pageGroupPostDialog() || dialog, freshEditor = freshDialog && pageGroupPostEditor(freshDialog);
      const got = clean(freshEditor?.innerText || freshEditor?.textContent || freshEditor?.value);
      if (typed?.ok && got.includes(prefix) && got.length >= want.length * 0.6 && got.length <= want.length + 60) return { dialog: freshDialog, editor: freshEditor };
      await pageClearGroupDraft(freshEditor || editor, PAGE_NEWS_FLAG, runId).catch(() => {});
      await sleep(600);
    }
    return null;
  }
  async function pageNewsPostOne(item, content, runId) {
    const page = pageNewsConfig?.page;
    if (!pageNewsRouteMatches(page)) { if (page?.url) location.replace(page.url); return "navigated"; }
    if (!(await pageSwitchActor(page, PAGE_NEWS_FLAG, runId))) {
      await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.noPageActor", { name: page?.name || "Page" }) });
      return "skip";
    }
    await closePageActorMenu(); await dismissPageOverlays();
    let opener = pageNewsWallOpener();
    if (!opener) { await sleep(1500); opener = pageNewsWallOpener(); }
    if (!opener || !(await pageFeatureClick(opener, PAGE_NEWS_FLAG, runId))) {
      await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.noComposer") }); return "skip";
    }
    const composer = await waitPageGroupComposer(PAGE_NEWS_FLAG, runId, 25000);
    if (!composer) { await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.noComposer") }); return "skip"; }
    const typed = await pageNewsTypeContent(composer, content, runId);
    if (!typed) { await closePageGroupComposer(); await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.typeFailed") }); return "skip"; }
    if (pageNewsConfig?.withImage) await pageNewsAttachImage(typed.dialog, item, runId);
    if (!(await pageNewsLive(runId))) return "stopped";
    const button = pageGroupPostButton(typed.dialog || pageGroupPostDialog());
    if (!button || !(await pageFeatureClick(button, PAGE_NEWS_FLAG, runId))) { await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.submitFailed") }); return "skip"; }
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (!(await pageNewsLive(runId))) return "stopped";
      const dialog = pageGroupPostDialog();
      if (!dialog) break;
      await sleep(500);
    }
    if (pageGroupPostDialog() || !pageGroupPostVisible(content)) {
      await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.unconfirmed") }); return "skip";
    }
    await pageNewsMarkUsed(item.link);
    return "done";
  }
  async function pageNewsWallLoop(runId) {
    try {
      const cfg = pageNewsConfig || {}, source = cfg.source || {};
      const count = Math.max(1, Math.min(100000, parseInt(cfg.count) || 1));
      await chrome.storage.local.set({ pageNewsWallStatus: t("pgn.fetching") });
      const fetched = await chrome.runtime.sendMessage({ action: "newsFetch", source, count: Math.max(3, count * 3) }).catch(() => null);
      if (!(await pageNewsLive(runId))) return;
      if (!fetched?.ok) { await chrome.storage.local.set({ [PAGE_NEWS_FLAG]: false, pageNewsWallStatus: fetched?.error || t("pgn.fetchFailed") }); return; }
      const used = await pageNewsUsedUrls(), jobs = (fetched.items || []).filter(item => item?.link && !used.includes(item.link)).slice(0, count);
      if (!jobs.length) { await chrome.storage.local.set({ [PAGE_NEWS_FLAG]: false, pageNewsWallStatus: t("pgn.noFresh") }); return; }
      let done = 0, skipped = 0;
      for (let i = 0; i < jobs.length; i++) {
        if (!(await pageNewsLive(runId))) return;
        const item = jobs[i];
        await chrome.storage.local.set({ pageNewsWallIndex: i, pageNewsWallStatus: t("pgn.aiCalling", { n: i + 1, total: jobs.length }) });
        const gen = await chrome.runtime.sendMessage({
          action: "aiGenerateNewsPost", news: item, topic: cfg.topic || "", mode: "long", kind: cfg.withImage ? "photo" : "text", maxChars: 0,
          prompt: cfg.prompt || "", sourceMode: source.type === "xread" ? "x" : "web", metaFeature: "page-news-wall", styleProfileId: cfg.styleProfileId || "", aiConfig: cfg.aiConfig || {}
        }).catch(() => null);
        if (!gen?.ok || !gen.content) { skipped++; await chrome.storage.local.set({ pageNewsWallSkipped: skipped, pageNewsWallStatus: gen?.error || t("pgn.aiFailed") }); continue; }
        const result = await pageNewsPostOne(item, gen.content, runId);
        if (result === "stopped" || result === "navigated") return;
        if (result === "done") { done++; await chrome.storage.local.set({ pageNewsWallDone: done, pageNewsWallStatus: t("pgn.confirmed", { done, total: jobs.length }) }); }
        else { skipped++; await chrome.storage.local.set({ pageNewsWallSkipped: skipped }); }
        const gap = Math.max(0, parseInt(cfg.interDelay) || 0) * 1000;
        const until = Date.now() + gap;
        while (Date.now() < until) { if (!(await pageNewsLive(runId))) return; await sleep(Math.min(800, until - Date.now())); }
      }
      await chrome.storage.local.set({ [PAGE_NEWS_FLAG]: false, pageNewsWallStatus: t("pgn.done", { done, skipped }) });
    } catch (error) {
      await chrome.storage.local.set({ [PAGE_NEWS_FLAG]: false, pageNewsWallStatus: "Lỗi: " + String(error?.message || error || "").slice(0, 160) });
    } finally { pageNewsConfig = null; }
  }

  // -----------------------------------------------------------------------
  // Đăng bán bằng Page: dùng chung salesProducts với nick (popup truyền sẵn),
  // đăng lần lượt từng sản phẩm vào từng nhóm của Page. Tái dùng opener/
  // editor/dialog/button, gõ cứng, submit+proof của đăng bài Page.
  // -----------------------------------------------------------------------
  const PAGE_SALES_FLAG = "pageSalesPostActive";
  let pageSalesRunId = "", pageSalesConfig = null;
  function pageSalesLive(runId) {
    return pageFeatureLive(PAGE_SALES_FLAG, runId);
  }
  async function pageSalesGetMedia(productId) {
    const mediaKey = pageSalesConfig?.mediaKey || "";
    const res = await chrome.runtime.sendMessage({ action: "salesGetProductMedia", productId, mediaKey }).catch(() => null);
    return Array.isArray(res?.media) ? res.media : [];
  }
  function pageSalesFileInput(scope) {
    // KHÔNG lọc visible: ô file của Facebook thường ẩn (display:none) nhưng
    // vẫn nhận files qua DataTransfer (giống sales.js) — lọc visible là miss.
    const inputs = [...(scope || document).querySelectorAll('input[type="file"]')].filter(el => el?.isConnected);
    return inputs.find(el => /video|image|photo|media/i.test(el.accept || "")) || inputs[0] || null;
  }
  async function pageSalesAttachMedia(composerRoot, product, runId) {
    if (product?.media?.skip) return { ok: true, attached: false };
    if (!product?.media?.enabled || !product.media.count) return { ok: true, attached: false };
    const records = await pageSalesGetMedia(product.id);
    const files = records.map(item => {
      try {
        const match = String(item.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return null;
        const raw = atob(match[2]), buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        return new File([buf], String(item.name || "media"), { type: match[1], lastModified: Date.now() });
      } catch (_) { return null; }
    }).filter(Boolean);
    const mode = String(product.media?.mode || "random");
    const wantCount = mode === "random"
      ? Math.max(1, Math.min(files.length || 1, 20, Number(product.media?.perGroup) || Number(product.media?.mediaCount) || 1))
      : files.length;
    const shuffled = [...files];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const picked = mode === "all" ? files : shuffled.slice(0, wantCount);
    if (!picked.length) return { ok: true, attached: false };
    let input = pageSalesFileInput(composerRoot);
    if (!input) {
      const mediaBtn = [...(composerRoot || document).querySelectorAll('[role="button"],button')].filter(visible)
        .find(el => /ảnh|video|photo|thêm ảnh|add photo|add media/i.test(labelOf(el)));
      if (mediaBtn) await pageFeatureClick(mediaBtn, PAGE_SALES_FLAG, runId);
    }
    // Ô file của Facebook hiện ra TRỄ sau khi bấm nút ảnh (đã tái hiện: tìm
    // ngay chỉ thấy khi may mắn) — polling tối đa 30s như sales.js.
    const inputDeadline = Date.now() + 30000;
    while (!input && Date.now() < inputDeadline) {
      if (!(await pageSalesLive(runId))) throw new Error("Đã dừng");
      await sleep(700);
      const scope = pageGroupPostDialog() || composerRoot;
      input = pageSalesFileInput(scope);
      if (!input && scope !== composerRoot) input = pageSalesFileInput(composerRoot);
    }
    if (!input) throw new Error("Facebook chưa có ô tải ảnh/video");
    try { input.multiple = true; } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    const transfer = new DataTransfer();
    picked.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (!(await pageSalesLive(runId))) throw new Error("Đã dừng");
      const previews = [...(composerRoot || document).querySelectorAll("img")].filter(visible).length;
      if (previews >= picked.length) break;
      await sleep(700);
    }
    await sleep(1200);
    return { ok: true, attached: true, count: picked.length };
  }
  async function pageSalesTypeContent(composer, content, runId) {
    const wantText = clean(content), wantPrefix = wantText.slice(0, 35);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await pageSalesLive(runId))) return false;
      let liveDlg = pageGroupPostDialog();
      if (!liveDlg) {
        await closePageGroupComposer(); await sleep(500);
        await dismissPageOverlays();
        const op = pageGroupPostOpener();
        if (op && await pageFeatureClick(op, PAGE_SALES_FLAG, runId)) {
          const c = await waitPageGroupComposer(PAGE_SALES_FLAG, runId);
          if (c) composer = c;
        } else { composer = null; }
        if (!composer) { await sleep(600); continue; }
      } else {
        composer = { dialog: liveDlg, editor: pageGroupPostEditor(liveDlg) || composer.editor };
      }
      let focused = false;
      for (let f = 0; f < 3 && !focused; f++) {
        try { await pageFeatureClick(composer.editor, PAGE_SALES_FLAG, runId); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        try { composer.editor.focus(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        await sleep(200);
        try { focused = !!(composer.editor.contains?.(document.activeElement) || composer.editor === document.activeElement); } catch (_) { focused = false; }
      }
      if (!focused) { await sleep(600); continue; }
      const tc = pageSalesConfig?.typingConfig || {};
      const typed = await chrome.runtime.sendMessage({ action: "trustedInput", text: content, pressEnter: false, typingMinDelay: tc.minDelay ?? 18, typingMaxDelay: tc.maxDelay ?? 35, abortStorageKey: PAGE_SALES_FLAG, abortRunId: runId, abortRunIdKey: "pageSalesPostRunId" }).catch(() => null);
      await sleep(800);
      const liveDialog = pageGroupPostDialog();
      const liveEditor = (liveDialog && pageGroupPostEditor(liveDialog)) || composer.editor;
      if (liveEditor && liveEditor !== composer.editor) composer = { dialog: liveDialog || composer.dialog, editor: liveEditor };
      const gotText = clean(composer.editor.innerText || composer.editor.textContent || composer.editor.value);
      if (gotText.includes(wantPrefix) && gotText.length >= wantText.length * 0.6 && gotText.length <= wantText.length + 60) return composer;
      await pageClearGroupDraft(composer.editor, PAGE_SALES_FLAG, runId).catch(() => {});
      await sleep(600);
    }
    return null;
  }
  async function pageSalesOneProduct(group, product, variant, runId) {
    const label = product.name || product.sourceText?.slice(0, 25) || "SP";
    await chrome.storage.local.set({ pageSalesPostStatus: `AI đang viết bài "${label}" tại: ${group.name}` });
    const ai = pageSalesConfig.aiConfig || {};
    const response = await chrome.runtime.sendMessage({ action: "aiGenerateSalesPost", groupName: group.name, sourceText: product.sourceText || "", productInfo: product.productInfo || "", prompt: product.prompt, aiConfig: { provider: ai.provider, model: ai.model, url: ai.url }, styleProfileId: "", variant }).catch(() => null);
    if (!response?.ok || !response.content) {
      await chrome.storage.local.set({ pageSalesPostStatus: response?.error || `AI không tạo được bài "${label}"` });
      return false;
    }
    await chrome.storage.local.set({ pageSalesPostStatus: `Đang mở ô đăng bài tại: ${group.name} (${label})` });
    let composer = await waitPageGroupComposer(PAGE_SALES_FLAG, runId, 30000);
    if (!composer) {
      // Tab lạnh/nhóm nặng: composer dựng chậm — bấm opener thêm 1 lần rồi chờ tiếp
      await dismissPageOverlays();
      const opener = pageGroupPostOpener();
      if (!opener || !(await pageFeatureClick(opener, PAGE_SALES_FLAG, runId))) {
        await chrome.storage.local.set({ pageSalesPostStatus: `Không mở được ô đăng bài tại ${group.name}` });
        return false;
      }
      composer = await waitPageGroupComposer(PAGE_SALES_FLAG, runId, 30000);
      if (!composer) {
        await chrome.storage.local.set({ pageSalesPostStatus: `Facebook chưa dựng ô đăng bài tại ${group.name}` });
        return false;
      }
    }
    if (product.media?.enabled && !product.media?.skip) {
      try {
        const media = await pageSalesAttachMedia(composer.dialog, product, runId);
        if (!media.attached && (product.media.count || 0) > 0) throw new Error("Chưa đính kèm đủ media");
      } catch (error) {
        await closePageGroupComposer();
        await chrome.storage.local.set({ pageSalesPostStatus: `Lỗi media "${label}": ${error.message}` });
        return false;
      }
      const fresh = pageGroupPostEditor(pageGroupPostDialog());
      if (fresh) composer = { dialog: composer.dialog, editor: fresh };
    }
    composer = await pageSalesTypeContent(composer, response.content, runId);
    if (!composer) {
      await closePageGroupComposer();
      await chrome.storage.local.set({ pageSalesPostStatus: `Nhập chưa đủ nội dung "${label}"` });
      return false;
    }
    if (!(await pageSalesLive(runId))) return false;
    const posted = await pageSubmitGroupPost(composer, response.content, PAGE_SALES_FLAG, runId, group.name);
    if (!posted) {
      await closePageGroupComposer();
      return false;
    }
    return true;
  }
  async function pageSalesLoop(runId) {
    try {
      if (!(await pageSalesLive(runId))) return;
      const products = Array.isArray(pageSalesConfig?.products) ? pageSalesConfig.products : [];
      const groups = Array.isArray(pageSalesConfig?.groups) ? pageSalesConfig.groups : [];
      const total = groups.length * products.length;
      let index = Math.max(0, parseInt(pageSalesConfig?.index) || 0);
      let done = Math.max(0, parseInt(pageSalesConfig?.done) || 0);
      let skipped = Math.max(0, parseInt(pageSalesConfig?.skipped) || 0);
      const minDelay = Math.min(604800, Math.max(5, Number(pageSalesConfig?.minDelay) || 30));
      const maxDelay = Math.min(604800, Math.max(minDelay, Number(pageSalesConfig?.maxDelay) || 60));
      for (; index < groups.length; index++) {
        if (!(await pageSalesLive(runId))) return;
        const group = groups[index];
        const key = String(group.key || "").toLowerCase();
        const onFeed = /^\/groups\/[^/?#]+\/?$/i.test(facebookUrl(location.href)?.pathname || "") && pageCurrentGroupName() && key && currentGroupKeyForSales() === key;
        if (!onFeed) {
          await chrome.storage.local.set({ pageSalesPostIndex: index, pageSalesPostStatus: `Đang mở nhóm ${index + 1}/${groups.length}: ${group.name}` });
          location.assign(group.url);
          return;
        }
        if (!(await pageSwitchActor(pageSalesConfig.page, PAGE_SALES_FLAG, runId))) {
          skipped++;
          await chrome.storage.local.set({ pageSalesPostSkipped: skipped, pageSalesPostIndex: index + 1, pageSalesPostStatus: `Không xác minh được Page ${pageSalesConfig.page.name} — bỏ qua ${group.name}` });
          continue;
        }
        await closePageActorMenu();
        await sleep(400);
        let postedCount = 0;
        for (let pIdx = 0; pIdx < products.length; pIdx++) {
          if (!(await pageSalesLive(runId))) return;
          const ok = await pageSalesOneProduct(group, products[pIdx], index * products.length + pIdx + 1, runId).catch(() => false);
          if (ok) {
            postedCount++; done++;
            await chrome.storage.local.set({ pageSalesPostDone: done, pageSalesPostStatus: `Đã đăng ${done}/${total} bài (nhóm ${index + 1}/${groups.length}): ${products[pIdx].name} — ${group.name}` });
            try {
              const life = await chrome.storage.local.get("pageSalesPostLifetimeDone");
              await chrome.storage.local.set({ pageSalesPostLifetimeDone: (Number(life.pageSalesPostLifetimeDone) || 0) + 1 });
            } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
          }
          if (pIdx < products.length - 1 && await pageSalesLive(runId)) await sleep(3000);
        }
        if (!postedCount) {
          skipped++;
          await chrome.storage.local.set({ pageSalesPostSkipped: skipped, pageSalesPostStatus: `Bỏ qua nhóm ${group.name}; đã đăng ${done}/${total}` });
        }
        await chrome.storage.local.set({ pageSalesPostIndex: index + 1 });
        if (index + 1 < groups.length && await pageSalesLive(runId)) {
          const delay = Math.round(minDelay + Math.random() * Math.max(0, maxDelay - minDelay));
          await chrome.storage.local.set({ pageSalesPostStatus: `Đã xong nhóm ${group.name}; chờ ${delay}s trước khi sang ${groups[index + 1].name}` });
          await sleep(delay * 1000);
          if (!(await pageSalesLive(runId))) return;
          location.assign(groups[index + 1].url);
          return;
        }
      }
      await chrome.storage.local.set({ [PAGE_SALES_FLAG]: false, pageSalesPostIndex: index, pageSalesPostStatus: `Hoàn tất đăng bán Page: ${done}/${total} bài, bỏ qua ${skipped} nhóm` });
    } catch (error) {
      console.warn("[PageSalesPost]", error);
      await chrome.storage.local.set({ [PAGE_SALES_FLAG]: false, pageSalesPostStatus: "Lỗi đăng bán Page: " + String(error?.message || error || "") });
    } finally {
      pageSalesConfig = null;
    }
  }
  function currentGroupKeyForSales() {
    try {
      const m = facebookUrl(location.href)?.pathname.match(/^\/groups\/([^/?#]+)/i);
      return m ? `/groups/${String(m[1]).toLowerCase()}` : "";
    } catch (_) { return ""; }
  }

  // -----------------------------------------------------------------------
  function pageGroupCommentPostText(article) {
    if (!article) return "";
    // Chỉ lấy vùng nội dung bài do Facebook đánh dấu. innerText của cả card /
    // dialog có thể chứa header, comment thread và hàng chục chữ "Facebook",
    // khiến prompt AI sai nội dung như đã tái hiện live.
    const selectors = [
      '[data-ad-rendering-role="story_message"]',
      '[data-ad-comet-preview="message"]',
      '[data-ad-preview="message"]'
    ];
    const parts = [];
    for (const selector of selectors) {
      for (const node of article.querySelectorAll(selector)) {
        if (!visible(node)) continue;
        const text = clean(node.innerText || node.textContent);
        if (text.length >= 15 && !parts.includes(text)) parts.push(text);
      }
      if (parts.length) break;
    }
    const extracted = clean(parts.join("\n")).slice(0, 2600);
    if (extracted.length >= 15) return extracted;

    // Fallback cho layout chưa gắn data-ad-* chỉ được dùng khi card đủ sạch.
    // Nếu có dấu hiệu ôm cả UI/thread thì fail-closed và bỏ bài, không gửi rác
    // sang AI rồi đăng một comment không liên quan.
    const fallback = pageArticleText(article);
    const facebookRepeats = (fallback.match(/\bfacebook\b/gi) || []).length;
    if (facebookRepeats >= 4 || /sắp xếp bảng feed|sort group feed|bình luận dưới tên|commenting as/i.test(fallback)) return "";
    return fallback;
  }

  // Comment AI trong nhóm bằng Page: duyệt từng nhóm đã lưu, với mỗi nhóm
  // tìm perGroup bài, dùng AI tạo comment rồi gửi. Tái dùng các helper
  // comment (pageCommentButton, pageCommentBox, pageCommentSendButton,
  // pageCommentProof, closePageCommentView, dismissPageOverlays) từ
  // pageCommentLoop.
  // -----------------------------------------------------------------------
  // Tìm comment box trên toàn document — ưu tiên "bình luận" chính, rồi "trả lời", không lấy
  // post-composer ("Bạn đang nghĩ gì?") hay search box.
  function findDocCommentBox() {
    const isExcluded = b => /tìm kiếm|search|tin nhắn|message/i.test(labelOf(b)) || b.closest('form[role="search"]');
    const boxes = [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible).filter(b => !isExcluded(b));
    const lbl = b => `${b.getAttribute('aria-label') || ''} ${b.getAttribute('placeholder') || ''}`;
    const isMain = b => /bình luận|comment/i.test(lbl(b)) && !/trả lời|reply/i.test(lbl(b));
    const isReply = b => /trả lời|reply/i.test(lbl(b));
    // Layout permalink mới có thể render ô comment Page trống, không aria-label
    // và đặt trong table/dialog của thread. Chỉ nhận fallback hẹp này trên URL
    // bài viết; không nhận composer đăng bài hoặc ô trống ở feed chung.
    const isUnlabeledPermalinkBox = b => pageLooksLikePostUrl(location.href)
      && !clean(lbl(b))
      && !!b.closest('table,[role="dialog"]')
      && !/bạn viết gì|đang nghĩ gì|what(?:'s| is) on your mind/i.test(clean(b.closest('table,[role="dialog"]')?.innerText || ''));
    return boxes.find(isMain) || boxes.find(isReply) || boxes.find(isUnlabeledPermalinkBox) || null;
  }
  async function waitPageGroupCommentBox(article, previousBoxes, runId) {
    const end = Date.now() + 60000;
    const originHref = location.href;
    while (Date.now() < end) {
      if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return null;
      const inline = pageCommentBox(article?.isConnected ? article : null);
      if (inline) return { box: inline, scope: article };
      const urlChanged = location.href !== originHref;
      if (urlChanged) {
        // Cross-post SPA navigation: tìm comment box thật (label "bình luận/comment"),
        // không lấy post-composer ("Bạn đang nghĩ gì?") hay ô không label.
        const box = findDocCommentBox();
        if (box) return { box, scope: box.closest('[role="dialog"]') || document.body };
      } else {
        const opened = [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible).find(b => !previousBoxes.has(b) && !/tìm kiếm|search|tin nhắn|message/i.test(labelOf(b)));
        if (opened) return { box: opened, scope: opened.closest('[role="dialog"]') || article || document.body };
      }
      await sleep(500);
    }
    return null;
  }
  async function postPageGroupComment(item, text, runId, tagEntity) {
    await pageTagLog("[pgc] submit-step: api=" + (!!globalThis.FbTagMention) + " cfg=" + (!!pageGroupCommentConfig?.tagConfig) + " ent=" + (tagEntity ? String(tagEntity.name).slice(0, 30) : "null") + " box=" + (!!item?.article?.isConnected));
    const postScope = item?.article || item;
    await dismissPageOverlays();
    // Dùng luôn ô inline nếu bài đã mở sẵn (nhóm không render nút Bình luận
    // cấp bài) — chỉ bấm nút khi chưa có ô nào. Trên trang chi tiết, ô có thể
    // nằm ngoài scope bài (khung comment riêng) → tìm thêm ở cấp document,
    // ưu tiên ô "Bình luận" chính, không lấy ô "Trả lời" hay tìm kiếm.
    const docMainBox = () => {
      // Tìm document-wide (ô comment trang chi tiết có thể nằm ngoài main,
      // vd. layer lightbox) — chỉ dùng ở trang chi tiết nên không sợ nhầm bài.
      const main = document;
      const boxes = [...main.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible).filter(box => {
        const label = `${box.getAttribute("aria-label") || ""} ${box.getAttribute("placeholder") || ""}`;
        return !/tìm kiếm|search|tin nhắn|message/i.test(label) && !box.closest("form[role=search]");
      });
      const isMain = b => /bình luận|comment/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("placeholder") || ""}`) && !/trả lời|reply/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("placeholder") || ""}`);
      // Khi đóng vai Page, FB có thể ẩn ô comment chính mà chỉ chừa ô Trả lời
      // (đã tái hiện live) — trả lời vẫn là một comment trong nhóm, tốt hơn bỏ qua.
      const isReply = b => /trả lời|reply/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("placeholder") || ""}`);
      const isUnlabeledPermalinkBox = b => pageLooksLikePostUrl(location.href)
        && !clean(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("placeholder") || ""}`)
        && !!b.closest('table,[role="dialog"]')
        && !/bạn viết gì|đang nghĩ gì|what(?:'s| is) on your mind/i.test(clean(b.closest('table,[role="dialog"]')?.innerText || ''));
      return boxes.find(isMain) || boxes.find(isReply) || boxes.find(isUnlabeledPermalinkBox) || null;
    };
    let alreadyOpen = pageCommentBox(postScope);
    if (!alreadyOpen && pageLooksLikePostUrl(location.href)) alreadyOpen = docMainBox();
    // Permalink: scroll xuống để trigger lazy-load comment section rồi thử lại.
    if (!alreadyOpen && pageLooksLikePostUrl(location.href)) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(1800);
      alreadyOpen = pageCommentBox(postScope) || docMainBox();
    }
    let composer = alreadyOpen ? { box: alreadyOpen, scope: postScope } : null;
    if (!composer && pageLooksLikePostUrl(location.href)) {
      // Debug: log all boxes/btns before trying to click button.
      const allB = [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')];
      const visB = allB.filter(visible);
      chrome.storage.local.set({ pageGroupCommentDiag: { stage: "pre-btn", visBoxes: visB.length, allBoxes: allB.length, visLabels: visB.slice(0,3).map(b=>(b.getAttribute('aria-label')||b.getAttribute('placeholder')||'').slice(0,40)), url: location.href.slice(0,80) } });
    }
    if (!composer) {
      const findCommentBtn = (scope) => [...(scope || document).querySelectorAll('button,[role="button"],a')].filter(visible).find(ctrl => {
        if (ctrl.getAttribute("role") === "menuitem") return false;
        const txt = labelOf(ctrl);
        if (!/^(?:viết\s+)?(?:bình luận|comments?)\b/i.test(txt)) return false;
        if (/trả lời|reply|Ẩn|ẩn|báo cáo|report|thêm|more/i.test(txt)) return false;
        if (ctrl.closest("ul")) return false;
        return true;
      }) || null;
      let button = item?.button?.isConnected ? item.button : pageCommentButton(postScope);
      // Permalink: tìm rộng hơn (không exclude [role="dialog"]) sau khi đã scroll.
      if (!button && pageLooksLikePostUrl(location.href)) button = findCommentBtn(document);
      if (!button || !(await pageFeatureClick(button, PAGE_GROUP_COMMENT_FLAG, runId))) {
        const allBoxes = [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')];
        const visBoxes = allBoxes.filter(visible);
        const allBtns = [...document.querySelectorAll('button,[role="button"],a')].filter(b => /bình luận|comment/i.test(labelOf(b)));
        const visBtns = allBtns.filter(visible);
        chrome.storage.local.set({ pageGroupCommentDiag: { stage: "no-button", url: location.href.slice(0, 80), boxes: allBoxes.length, visBoxes: visBoxes.length, btns: allBtns.length, visBtns: visBtns.length, btnLabels: visBtns.slice(0, 3).map(b => labelOf(b).slice(0, 30)) } });
        return "unconfirmed-skip";
      }
      const hrefBeforeClick = location.href;
      const previousBoxes = new Set([...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible));
      composer = await waitPageGroupCommentBox(postScope, previousBoxes, runId);
      // Nếu button là link cross-post, click sẽ navigate sang URL khác.
      // waitPageGroupCommentBox có thể miss vì scope cũ — thử tìm lại.
      if (!composer && location.href !== hrefBeforeClick && pageLooksLikePostUrl(location.href)) {
        // Cross-post: button là link navigate sang permalink khác — tìm comment box trên trang mới.
        await sleep(1200);
        const box = findDocCommentBox();
        if (box) composer = { box, scope: box.closest('[role="dialog"]') || document.body };
      }
      if (!composer) {
        const allB2 = [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')];
        const visB2 = allB2.filter(visible);
        chrome.storage.local.set({ pageGroupCommentDiag: { stage: "no-box-after-click", url: location.href.slice(0, 80), visBoxes: visB2.length, allBoxes: allB2.length, visLabels: visB2.slice(0,3).map(b=>(b.getAttribute('aria-label')||b.getAttribute('placeholder')||'').slice(0,40)), urlChanged: location.href !== hrefBeforeClick } });
        return "unconfirmed-skip";
      }
    }
    const box = composer.box;
    const wantComment = clean(text), wantPrefix = wantComment.slice(0, 35);
    let focused = false;
    for (let f = 0; f < 3 && !focused; f++) {
      try { await pageFeatureClick(box, PAGE_GROUP_COMMENT_FLAG, runId); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      try { box.focus(); box.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(200);
      try { focused = !!(box.contains?.(document.activeElement) || box === document.activeElement); } catch (_) { focused = false; }
    }
    if (!focused) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "no-focus", url: location.href.slice(0, 80) } }); await closePageCommentView(composer.scope); return "unconfirmed-skip"; }
    try {
      box.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
      if (document.execCommand("selectAll", false, null)) document.execCommand("delete");
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    await sleep(200);
    const tc = pageGroupCommentConfig?.typingConfig || {};
    const doType = () => chrome.runtime.sendMessage({ action: "trustedInput", text, pressEnter: false, typingMinDelay: tc.minDelay ?? 20, typingMaxDelay: tc.maxDelay ?? 45, abortStorageKey: PAGE_GROUP_COMMENT_FLAG, abortRunId: runId, abortRunIdKey: "pageGroupCommentRunId" }).catch(() => null);
    const readBox = () => clean(box.isConnected ? (box.innerText || box.textContent || box.value) : "");
    let typed = await doType();
    let gotComment = readBox();
    if ((!typed?.ok || !gotComment.includes(wantPrefix) || gotComment.length < wantComment.length * 0.6) && await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId)) {
      try { box.focus(); const sel = window.getSelection(), range = document.createRange(); range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range); if (document.execCommand("selectAll", false, null)) document.execCommand("delete"); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(300);
      typed = await doType();
      gotComment = readBox();
    }
    if (!gotComment.includes(wantPrefix) || gotComment.length < wantComment.length * 0.6) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "type-fail", gotLen: gotComment.length, wantLen: wantComment.length, prefix: wantPrefix.slice(0,20), url: location.href.slice(0, 80) } }); await closePageCommentView(composer.scope); return "unconfirmed-skip"; }
    const liveCheck = await chrome.storage.local.get(PAGE_GROUP_COMMENT_FLAG);
    if (!liveCheck[PAGE_GROUP_COMMENT_FLAG] || !(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return "stopped";
    // Gửi + proof + nán qua lõi chung (cùng cơ chế Bản tin & AI).
    const UC = globalThis.UnifiedComment;
    if (!UC?.sendProofDwell) return "unconfirmed-skip";
    const pgcRes = await UC.sendProofDwell({
      box, commentScope: composer.scope, text, proof: clean(text).slice(0, 60),
      tagEntity, tagConfig: pageGroupCommentConfig.tagConfig,
      alive: () => pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId),
      onEvent: (name) => {
        if (name === "unconfirmed") chrome.storage.local.set({ pageGroupCommentDiag: { stage: "proof-timeout", url: location.href.slice(0, 80), scopeLen: clean((composer.scope?.innerText || "")).length } });
      },
      clearDraft: () => closePageCommentView(composer.scope),
      findSend: async () => { const s = pageCommentSendButton(box); if (s) await dismissPageStraysOnly(s); return s; },
      doSend: (btn) => pageFeatureClick(btn, PAGE_GROUP_COMMENT_FLAG, runId),
      proofExists: (root, pr) => pageCommentProof(root, text),
      proofRoots: () => [composer.scope, postScope, ...(pageLooksLikePostUrl(location.href) ? [document] : [])],
      scrollIntoView: () => { try { (composer.scope?.isConnected ? composer.scope : postScope)?.scrollIntoView?.({ behavior: "smooth", block: "center" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } },
      onCounted: async () => {
        await closePageCommentView(composer.scope);
        if (postScope?.isConnected) postScope.dataset.pgcDone = "1";
        return true;
      },
    });
    if (pgcRes === true) return true;
    if (pgcRes === "stopped") return "stopped";
    await closePageCommentView(composer.scope);
    if (pgcRes === "unconfirmed-skip") {
      chrome.storage.local.set({ pageGroupCommentDiag: { stage: "proof-timeout", url: location.href.slice(0, 80), scopeLen: clean((composer.scope?.innerText || "")).length } });
    }
    return "unconfirmed-skip";
  }
  async function waitGroupFeedForComments(runId, timeout) {
    const until = Date.now() + (timeout || 25000);
    while (Date.now() < until) {
      if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return false;
      const hasReal = [...document.querySelectorAll('[role="article"],article,[data-pagelet^="FeedUnit_"]')]
        .some(a => visible(a) && !a.closest('[role="dialog"]') && clean(a.innerText || a.textContent).length > 100);
      if (hasReal || pageFeedArticles().length) return true;
      window.scrollBy({ top: Math.max(300, Math.floor(window.innerHeight * 0.7)), behavior: "smooth" });
      await sleep(2000);
    }
    return false;
  }
  // Nhánh permalink cho Comment nhóm: nhiều layout nhóm không render nút
  // Bình luận cấp bài (chỉ còn thread/skeleton) nên feed không bao giờ có
  // candidate. Fallback: thu permalink bài cùng nhóm, mở từng bài, comment
  // ngay trên trang chi tiết rồi quay về feed. Queue nằm trong
  // pageGroupCommentConfig nên resume sau reload vẫn tiếp tục được.
  function pageGroupCommentPostLinks(groupKey) {
    const rows = [], seen = new Set();
    const gk = String(groupKey || "").toLowerCase();
    const gid = gk.replace(/^\/groups\//, "").replace(/[^a-z0-9]/g, "");
    const escId = gid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const gseg = (gk.split("/")[2] || "").toLowerCase();
    const groupPostRe = new RegExp(`^/groups/[^/?#]+/(?:posts|permalink)/`, "i");
    for (const a of document.querySelectorAll('a[href]')) {
      const url = facebookUrl(a.href);
      if (!url) continue;
      const vanity = (url.searchParams.get("idorvanity") || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const seg = (url.pathname.split("/")[2] || "").toLowerCase();
      const sameGroupPath = groupPostRe.test(url.pathname) && !!gseg && seg === gseg;
      if (!sameGroupPath && !(vanity && gid && vanity === gid)) continue;
      // Skip photo/video/reel — headless không render lightbox, comment box không load được.
      if (/\/photo[/?]|\/video[/?]|\/reel[/?]/i.test(url.pathname + url.search)) continue;
      const key = pagePlinkKey(url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // Strip query params (đặc biệt ?comment_id=) để FB không redirect về home.
      rows.push(`${url.origin}${url.pathname}`);
      if (rows.length >= 8) break;
    }
    return rows;
  }
  function pageLooksLikePostUrl(href) {
    const url = facebookUrl(href);
    if (!url) return false;
    return /\/posts\/|\/permalink\/|story_fbid=|\/photo|\/video|\/reel/i.test(url.pathname + url.search);
  }
  // Identity link theo pathname (bỏ query): cùng bài nhưng ?comment_id khác
  // nhau vẫn là một. So canonical cả query từng gây lặp vô hạn cùng link.
  function pagePlinkKey(href) {
    try {
      const url = new URL(String(href || ""), location.origin);
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch (_) { return String(href || "").split(/[?#]/)[0].toLowerCase(); }
  }
  async function pageGroupCommentPersistQueue(patch) {
    try {
      const cfg = { ...(pageGroupCommentConfig || {}), ...(patch || {}) };
      pageGroupCommentConfig = cfg;
      const slim = { ...cfg };
      if (slim.aiConfig) slim.aiConfig = { provider: slim.aiConfig.provider, model: slim.aiConfig.model, url: slim.aiConfig.url };
      await chrome.storage.local.set({ pageGroupCommentConfig: slim });
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
  }
  async function pageGroupCommentDropPlink(groupKey) {
    // Ưu tiên drop theo groupKey (tránh trường hợp trang đã redirect về home trước khi hàm chạy).
    const here = pagePlinkKey(location.href);
    const q = Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : [];
    const doneArr = Array.isArray(pageGroupCommentConfig?.plinkDone) ? pageGroupCommentConfig.plinkDone : [];
    const toDrop = groupKey
      ? q.find(it => it.groupKey === groupKey)
      : q.find(it => pagePlinkKey(it.url) === here);
    const dropKey = toDrop ? pagePlinkKey(toDrop.url) : here;
    const next = toDrop ? q.filter(it => it !== toDrop) : q.filter(it => pagePlinkKey(it.url) !== here);
    if (dropKey && !doneArr.includes(dropKey)) doneArr.push(dropKey);
    await pageGroupCommentPersistQueue({ plinkQueue: next, plinkDone: doneArr.slice(-200) });
  }
  // Dùng chung cho feed + permalink: tạo comment AI cho một bài. Trả
  // {comment, tagEntity}, null (bỏ qua bài), hoặc "stopped".
  async function pageGroupCommentBuildComment(postText, runId) {
    const tagApi = globalThis.FbTagMention || null;
    // tagConfig từ popup chỉ có {entities,mode,rate} (UI pgc không có ô prompt
    // riêng) — nếu không fallback prompt mặc định có {tagName} thì tagEntity luôn
    // null và tag không bao giờ chạy dù user đã bật.
    const tagPromptRaw = String(pageGroupCommentConfig?.tagConfig?.tagPrompt || pageGroupCommentConfig?.tagPrompt || (pageGroupCommentConfig?.tagConfig ? t("fd.aiTagPromptDefault") : ""));
    const tagEntity = (tagApi && pageGroupCommentConfig?.tagConfig && tagPromptRaw.includes("{tagName}"))
      ? tagApi.decideTagForPost(pageGroupCommentConfig.tagConfig) : null;
    await pageTagLog("[pgc] decide: api=" + (!!tagApi) + " cfg=" + (!!pageGroupCommentConfig?.tagConfig) + " hasTagName=" + tagPromptRaw.includes("{tagName}") + " ent=" + (tagEntity ? tagEntity.name.slice(0, 30) : "null"));
    const prompt = tagEntity
      ? (tagApi.buildTagPrompt?tagApi.buildTagPrompt(tagPromptRaw,tagEntity.name):tagPromptRaw.replaceAll("{tagName}", tagEntity.name))
      : pageStripTagPlaceholder(pageGroupCommentConfig.prompt);
    const resp = await chrome.runtime.sendMessage({ action: "aiGeneratePageComment", postText, pageName: pageGroupCommentConfig.page.name, source: "groups", prompt, maxLines: tagEntity?2:1, aiConfig: pageGroupCommentConfig.aiConfig }).catch(() => null);
    if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId)) || !pageGroupCommentConfig) return "stopped";
    // Background aiGeneratePageComment trả {comment} (không phải {content}
    // như aiGeneratePageGroupPost/Sales) — đọc nhầm khiến mọi bài skip im lặng.
    const comment = resp?.comment?.trim();
    if (!comment) return null;
    // Lưới cuối: AI vẫn nhả "{tagName}" thì bỏ bài, không đăng placeholder
    // công khai (fail-closed thay vì đăng bậy như ca 29/10).
    if (/\{tagName\}/.test(comment)) { await pageTagLog("@tag chặn (pgc: output còn {tagName}, bỏ bài)"); return null; }
    return { comment, tagEntity };
  }
  async function pageGroupCommentOnPermalink(group, runId) {
    // Đang ở trang chi tiết bài: chờ nội dung render (tới 20s + cuộn, vì FB
    // dựng bài trễ), tìm bài chính, bỏ qua nếu Page đã comment (tránh đăng
    // trùng khi resume), rồi AI + gửi + proof như feed.
    let root = null;
    // Bài chi tiết nằm ở ĐẦU trang: về top và chờ hydrate trước, chỉ cuộn khi
    // vẫn chưa thấy. Bỏ qua skeleton "Đang tải..." (có text nhưng là shimmer;
    // cuộn ngay sẽ đẩy bài thật ra khỏi vùng render trước khi nó kịp hiện).
    const isLoadingShell = a => !!a.querySelector('[data-visualcompletion="loading-state"]');
    // Fallback khi trang không dùng article role: container text lớn nhất
    // trong main (đã tái hiện live: body 5702 ký tự mà 0 article).
    // Với /photo/ page Facebook không render vào [role="main"] mà render ra ngoài
    // → khi main rỗng mở rộng scope ra toàn document để vẫn tìm được container.
    const largestTextContainer = () => {
      const mainEl = document.querySelector('[role="main"]');
      const scope = (mainEl && clean(mainEl.innerText || "").length > 50) ? mainEl : document;
      let best = null, bestLen = Infinity;
      for (const el of scope.querySelectorAll("div")) {
        if (el.closest('[role="dialog"],[role="menu"],header,nav,[role="navigation"],[role="banner"],[role="complementary"]')) continue;
        if (isLoadingShell(el)) continue;
        const len = clean(el.innerText || "").length;
        // Container GỌN nhất đủ dài (node con cụ thể thay vì ôm cả main).
        if (len >= 150 && len < bestLen) { best = el; bestLen = len; }
      }
      return best;
    };
    // Khi URL là /photo/ và không tìm được article, dùng meta description làm nội dung bài.
    const metaPostText = () => {
      const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      return clean(desc).length >= 30 ? clean(desc) : "";
    };
    const findRoot = () => {
      const arts = [...document.querySelectorAll('[role="article"],article,[data-pagelet^="FeedUnit_"]')]
        .filter(a => visible(a) && !a.closest('[role="dialog"]') && !isLoadingShell(a))
        .sort((a, b) => clean(b.innerText || "").length - clean(a.innerText || "").length);
      if (arts.length && clean(arts[0].innerText || "").length >= 50) return arts[0];
      const fallback = largestTextContainer();
      if (fallback && clean(fallback.innerText || "").length >= 150) return fallback;
      return null;
    };
    try { window.scrollTo(0, 0); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    await sleep(4000);
    root = findRoot();
    // Điều hướng SPA tới permalink đôi khi chỉ dựng skeleton mà không hydrate
    // (tải lại tay luôn render đủ) — reload đúng 1 lần rồi chờ tiếp. Tab nền
    // hydrate chậm (tái hiện 40s) nên chờ tổng tới ~60s.
    if (!root) {
      const hk = pagePlinkKey(location.href);
      const qq = Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : [];
      const hit = qq.find(it => it.groupKey && pagePlinkKey(it.url) === hk);
      if (hit && !hit.rl) {
        hit.rl = 1;
        await pageGroupCommentPersistQueue({ plinkQueue: qq });
        location.reload();
        return "reloading";
      }
    }
    const plDeadline = Date.now() + 55000;
    while (!root && Date.now() < plDeadline) {
      if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return "stopped";
      root = findRoot();
      if (root) break;
      window.scrollBy({ top: 400, behavior: "smooth" });
      await sleep(2500);
    }
    // /photo/ page: [role="main"] rỗng, nội dung render bên ngoài — khi findRoot
    // vẫn null sau deadline, thử tạo pseudo-root từ comment section + meta desc.
    let postTextOverride = "";
    if (!root) {
      const metaText = metaPostText();
      if (metaText && /\/photo[/?]/i.test(location.pathname + location.search)) {
        postTextOverride = metaText;
        // Dùng comment section làm root để tìm comment box.
        root = document.querySelector('[role="main"]') || document.body;
      }
    }
    if (!root || (!postTextOverride && clean(root.innerText || "").length < 15)) {
      await chrome.storage.local.set({ pageGroupCommentStatus: `Bài chi tiết không tải được nội dung — bỏ link` });
      return "skip";
    }
    if (pageHasOwnComment(root)) {
      await chrome.storage.local.set({ pageGroupCommentStatus: `Page đã comment bài này rồi — bỏ qua` });
      return "own";
    }
    const postText = postTextOverride || pageGroupCommentPostText(root);
    if (!postText || postText.length < 15) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "no-posttext", len: postText?.length || 0, url: location.href.slice(0, 80) } }); return "skip"; }
    const built = await pageGroupCommentBuildComment(postText, runId);
    if (built === "stopped") return "stopped";
    if (!built) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "ai-fail", url: location.href.slice(0, 80) } }); return "skip"; }
    const item = { article: root, button: pageCommentButton(root) };
    try {
      const result = await postPageGroupComment(item, built.comment, runId, built.tagEntity);
      if (result === true) {
        try { await globalThis.FbTagMention?.markPostSig?.(postText); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        return true;
      }
      return result === "stopped" ? "stopped" : "skip";
    } catch (err) { console.warn("[PageGroupComment]", err); return "skip"; }
  }
  async function pageGroupCommentLoop(runId) {
    try {
      if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return;
      const groups = Array.isArray(pageGroupCommentConfig?.groups) ? pageGroupCommentConfig.groups : [];
      const perGroup = Math.max(1, Math.min(100000, parseInt(pageGroupCommentConfig?.perGroup) || 3));
      let index = Math.max(0, parseInt(pageGroupCommentConfig?.index) || 0);
      let done = Math.max(0, parseInt(pageGroupCommentConfig?.done) || 0);
      let skipped = Math.max(0, parseInt(pageGroupCommentConfig?.skipped) || 0);
      const minDelay = Math.min(604800, Math.max(5, Number(pageGroupCommentConfig?.minDelay) || 20));
      const maxDelay = Math.min(604800, Math.max(minDelay, Number(pageGroupCommentConfig?.maxDelay) || 45));
      for (; index < groups.length; index++) {
        if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId)) || !pageGroupCommentConfig) return;
        const group = groups[index];
        // Chuẩn hóa key (bỏ / cuối) để so khớp route: key thừa slash từng gây
        // vòng reload vô hạn ở bước "Đang mở nhóm" (bắt live 29/10).
        const groupKey = String(group.key || "").toLowerCase().replace(/\/+$/, "");
        if (!pageOnGroupFeed() || pageCurrentGroupKey() !== groupKey) {
          // Đang ở trang chi tiết bài của đúng nhóm này (nhánh permalink):
          // comment ngay tại đây rồi quay về feed, thay vì giật về feed khi chưa làm gì.
          const pq = Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : [];
          if (pq.some(it => it.groupKey === groupKey) && pageLooksLikePostUrl(location.href)) {
            if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId)) || !pageGroupCommentConfig) return;
            // Đủ quota nhóm rồi (vd. resume sau reload) → bỏ queue, sang nhóm kế.
            {
              const gd = Math.max(0, parseInt((await chrome.storage.local.get("pageGroupCommentGroupDone")).pageGroupCommentGroupDone) || 0);
              if (gd >= perGroup) {
                await pageGroupCommentPersistQueue({ plinkQueue: pq.filter(it => it.groupKey !== groupKey) });
                await chrome.storage.local.set({ pageGroupCommentIndex: index + 1, pageGroupCommentGroupDone: 0 });
                if (index + 1 < groups.length) { location.assign(groups[index + 1].url); return; }
                await chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentGroupDone: 0, pageGroupCommentStatus: `Hoàn tất: ${done} comment, bỏ qua ${skipped} nhóm` });
                return;
              }
            }
            // Chống lặp cùng link: redirect/FB thêm param khiến so khớp cũ trượt.
            // Mỗi link tối đa 2 lượt thử.
            {
              const hk = pagePlinkKey(location.href);
              const qq = Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : [];
              const hit = qq.find(it => it.groupKey === groupKey && pagePlinkKey(it.url) === hk);
              const tries = (hit?.tries || 0) + 1;
              if (hit) hit.tries = tries;
              await pageGroupCommentPersistQueue({ plinkQueue: qq });
              if (tries > 2) {
                await chrome.storage.local.set({ pageGroupCommentStatus: `Bài này thử 2 lần chưa xong — bỏ qua` });
                await pageGroupCommentDropPlink(groupKey);
                location.assign(group.url);
                return;
              }
            }
            await chrome.storage.local.set({ pageGroupCommentStatus: `Đang comment bài chi tiết — nhóm ${group.name}` });
            // Trên permalink KHÔNG gọi pageSwitchActor — hàm này tìm "Trang cá nhân
            // của bạn" trong top-nav và click vào, gây SPA-navigate về home.
            // Actor đã được switch đúng khi còn ở group feed (bước trước).
            await sleep(500);
            const pr = await pageGroupCommentOnPermalink(group, runId);
            if (pr === "stopped" || pr === "reloading") return;
            if (pr === true) {
              done++;
              let gdNow = 1;
              try {
                const g = await chrome.storage.local.get("pageGroupCommentGroupDone");
                gdNow = Math.max(0, parseInt(g.pageGroupCommentGroupDone) || 0) + 1;
              } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
              await chrome.storage.local.set({ pageGroupCommentDone: done, pageGroupCommentGroupDone: gdNow, pageGroupCommentStatus: `Đã comment ${done} bài (nhóm ${index + 1}/${groups.length}): ${group.name}` });
            }
            await pageGroupCommentDropPlink(groupKey);
            location.assign(group.url);
            return;
          }
          // Có plink trong queue nhưng đang ở trang không phải permalink cũng không phải group feed
          // (ví dụ FB redirect về home sau khi navigate tới plink bị lỗi) → drop plink đó + thêm plinkDone.
          await pageGroupCommentDropPlink(groupKey);
          await chrome.storage.local.set({ pageGroupCommentIndex: index, pageGroupCommentStatus: `Đang mở nhóm ${index + 1}/${groups.length}: ${group.name}` });
          location.replace(group.url);
          return;
        }
        if (!(await pageSwitchActor(pageGroupCommentConfig.page, PAGE_GROUP_COMMENT_FLAG, runId))) {
          // Menu chọn Page chỉ xuất hiện bên trong post composer — thử mở composer,
          // switch actor, rồi đóng lại (không đăng bài) để Page trở thành active actor.
          const opener = pageGroupPostOpener();
          if (opener && (await pageFeatureClick(opener, PAGE_GROUP_COMMENT_FLAG, runId))) {
            const composer = await waitPageGroupComposer(PAGE_GROUP_COMMENT_FLAG, runId, 12000);
            if (composer) {
              await chrome.storage.local.set({ pageGroupCommentStatus: `Đang chuyển sang Page trong nhóm: ${group.name}` });
              await pageSwitchActor(pageGroupCommentConfig.page, PAGE_GROUP_COMMENT_FLAG, runId);
              await closePageGroupComposer();
              await sleep(800);
            }
          }
          if (!actorEvidence(pageGroupCommentConfig.page)) {
            skipped++;
            await chrome.storage.local.set({ pageGroupCommentSkipped: skipped, pageGroupCommentIndex: index + 1, pageGroupCommentStatus: `Không xác minh được Page — bỏ qua ${group.name}` });
            // Nhóm cuối mà return trần sẽ treo cờ active mãi (đã tái hiện live) —
            // hết nhóm thì chốt phiên như cuối vòng lặp.
            if (index + 1 < groups.length && (await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) { location.assign(groups[index + 1].url); return; }
            await chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentGroupDone: 0, pageGroupCommentStatus: `Hoàn tất: ${done} comment, bỏ qua ${skipped} nhóm` });
            return;
          }
        }
        await closePageActorMenu();
        await sleep(800);
        const feedOk = await waitGroupFeedForComments(runId, 25000);
        if (!feedOk) {
          skipped++;
          await chrome.storage.local.set({ pageGroupCommentSkipped: skipped, pageGroupCommentIndex: index + 1, pageGroupCommentStatus: `Không tải được feed — bỏ qua ${group.name}` });
          if (index + 1 < groups.length && (await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) { location.assign(groups[index + 1].url); return; }
          await chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentGroupDone: 0, pageGroupCommentStatus: `Hoàn tất: ${done} comment, bỏ qua ${skipped} nhóm` });
          return;
        }
        let groupDone = 0, emptyRounds = 0;
        // Khôi phục quota nhóm sau reload (permalink điều hướng nhiều lần
        // trong một nhóm; groupDone cục bộ mất sau mỗi lần tải lại trang).
        try {
          const gd = await chrome.storage.local.get("pageGroupCommentGroupDone");
          groupDone = Math.max(0, parseInt(gd.pageGroupCommentGroupDone) || 0);
          if (groupDone >= perGroup) {
            await pageGroupCommentPersistQueue({ plinkQueue: (Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : []).filter(it => it.groupKey !== groupKey) });
            await chrome.storage.local.set({ pageGroupCommentIndex: index + 1, pageGroupCommentGroupDone: 0 });
            if (index + 1 < groups.length && (await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) { location.assign(groups[index + 1].url); return; }
            await chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentGroupDone: 0, pageGroupCommentStatus: `Hoàn tất: ${done} comment, bỏ qua ${skipped} nhóm` });
            return;
          }
        } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        // Còn link permalink chờ xử lý của nhóm này (sau khi quay về từ bài
        // chi tiết) → mở link kế tiếp thay vì cào lại feed.
        {
          const qq = Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : [];
          const nxt = qq.find(it => it.groupKey === groupKey);
          if (nxt && groupDone < perGroup) {
            await chrome.storage.local.set({ pageGroupCommentStatus: `Mở bài chi tiết để comment — nhóm ${group.name}` });
            location.assign(nxt.url);
            return;
          }
        }
        // Chặn treo đã tái hiện live: kẹt ở "AI đang tạo comment bài 1/1" hơn
        // 15 phút không tiến triển (feed vô hạn + proof trượt liên tục). Giới
        // hạn thời gian và số bài xử lý cho mỗi nhóm để luôn sang nhóm kế tiếp.
        const groupStartAt = Date.now();
        const GROUP_DEADLINE_MS = 10 * 60 * 1000;
        let processedInGroup = 0;
        const MAX_CANDIDATES_PER_GROUP = 20;
        let groupTimedOut = false;
        while (groupDone < perGroup && (await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId)) && pageGroupCommentConfig) {
          if (Date.now() - groupStartAt > GROUP_DEADLINE_MS) { groupTimedOut = true; break; }
          if (processedInGroup >= MAX_CANDIDATES_PER_GROUP) {
            await chrome.storage.local.set({ pageGroupCommentStatus: `Đã xét tối đa ${MAX_CANDIDATES_PER_GROUP} bài mà chưa comment được — bỏ qua ${group.name || group.key}` });
            break;
          }
          const candidates = pageFeedArticles().filter(it => !it.article.dataset.pgcDone);
          if (!candidates.length) {
            emptyRounds++;
            if (emptyRounds >= 4) {
              // Feed không có bài comment được (layout chỉ còn thread/skeleton):
              // thu permalink cùng nhóm rồi mở từng bài thay vì bỏ nhóm ngay.
              const visited = new Set([
                ...(Array.isArray(pageGroupCommentConfig?.plinkDone) ? pageGroupCommentConfig.plinkDone : []),
                ...((Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : [])
                  .filter(it => it.groupKey === groupKey).map(it => pagePlinkKey(it.url)))
              ]);
              const fresh = pageGroupCommentPostLinks(groupKey).filter(u => !visited.has(pagePlinkKey(u)));
              if (fresh.length && groupDone < perGroup) {
                const take = fresh.slice(0, Math.min(6, Math.max(1, (perGroup - groupDone) * 2)));
                await pageGroupCommentPersistQueue({
                  plinkQueue: [
                    ...(Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : []).filter(it => it.groupKey !== groupKey),
                    ...take.map(url => ({ groupKey, url }))
                  ]
                });
                await chrome.storage.local.set({ pageGroupCommentStatus: `Mở từng bài để comment (${take.length} bài) — nhóm ${group.name}` });
                location.assign(take[0]);
                return;
              }
              await chrome.storage.local.set({ pageGroupCommentStatus: `Không tìm được bài phù hợp — bỏ qua ${group.name || group.key}` });
              break;
            }
            window.scrollBy({ top: Math.max(450, Math.floor(window.innerHeight * .8)), behavior: "smooth" });
            await sleep(1500); continue;
          }
          emptyRounds = 0;
          for (const item of candidates) {
            if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId)) || !pageGroupCommentConfig || groupDone >= perGroup || processedInGroup >= MAX_CANDIDATES_PER_GROUP) break;
            if (Date.now() - groupStartAt > GROUP_DEADLINE_MS) { groupTimedOut = true; break; }
            item.article.dataset.pgcDone = "processing";
            processedInGroup++;
            const postText = pageGroupCommentPostText(item.article);
            if (!postText || postText.length < 15) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "feed-skip-notext", len: postText.length, processed: processedInGroup, group: group.name?.slice(0, 30) } }); item.article.dataset.pgcDone = "skip"; continue; }
            // Page đã comment bài này từ lượt trước (resume mất marker dataset)
            // thì bỏ qua, tránh đăng trùng.
            if (pageHasOwnComment(item.article)) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "feed-skip-own", processed: processedInGroup, group: group.name?.slice(0, 30) } }); item.article.dataset.pgcDone = "skip"; continue; }
            // Sổ cái chữ ký (feed.js): chặn đăng trùng chéo phiên/tag-không-tag.
            try { if (await globalThis.FbTagMention?.postSigMarked?.(postText)) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "feed-skip-sig", processed: processedInGroup, group: group.name?.slice(0, 30) } }); item.article.dataset.pgcDone = "skip"; continue; } } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
            await chrome.storage.local.set({ pageGroupCommentStatus: `AI đang tạo comment bài ${groupDone + 1}/${perGroup} — nhóm ${group.name}` });
            const built = await pageGroupCommentBuildComment(postText, runId);
            if (built === "stopped") return;
            if (!built) { chrome.storage.local.set({ pageGroupCommentDiag: { stage: "feed-skip-aifail", processed: processedInGroup, group: group.name?.slice(0, 30) } }); item.article.dataset.pgcDone = "skip"; continue; }
            const { comment, tagEntity } = built;
            let result = "skip";
            try { result = await postPageGroupComment(item, comment, runId, tagEntity); } catch (err) { console.warn("[PageGroupComment]", err); result = "skip"; }
            if (result === "stopped") return;
            item.article.dataset.pgcDone = "1";
            if (result === true) {
              groupDone++; done++;
              try { await globalThis.FbTagMention?.markPostSig?.(postText); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
              await chrome.storage.local.set({ pageGroupCommentDone: done, pageGroupCommentGroupDone: groupDone, pageGroupCommentStatus: `Đã comment ${done} bài (nhóm ${index + 1}/${groups.length}): ${group.name}` });
            }
            if (groupDone < perGroup && (await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) {
              const w = minDelay * 1000 + Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay) * 1000));
              const waitUntil = Date.now() + w;
              while (Date.now() < waitUntil) { if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return; await sleep(Math.min(800, waitUntil - Date.now())); }
            }
          }
          window.scrollBy({ top: Math.max(450, Math.floor(window.innerHeight * .8)), behavior: "smooth" });
          await sleep(1000);
        }
        if (!groupDone) skipped++;
        // Dọn queue permalink của nhóm vừa xong để không lẫn sang nhóm khác.
        await pageGroupCommentPersistQueue({ plinkQueue: (Array.isArray(pageGroupCommentConfig?.plinkQueue) ? pageGroupCommentConfig.plinkQueue : []).filter(it => it.groupKey !== groupKey) });
        await chrome.storage.local.set({ pageGroupCommentIndex: index + 1, pageGroupCommentSkipped: skipped, pageGroupCommentGroupDone: 0, ...(groupTimedOut ? { pageGroupCommentStatus: `Quá 10 phút không xong nhóm ${group.name || group.key} — bỏ qua` } : {}) });
        if (index + 1 < groups.length && (await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) {
          const delay = Math.round(minDelay + Math.random() * Math.max(0, maxDelay - minDelay));
          await chrome.storage.local.set({ pageGroupCommentStatus: `Xong nhóm ${group.name}; chờ ${delay}s...` });
          const waitUntil = Date.now() + delay * 1000;
          while (Date.now() < waitUntil) { if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return; await sleep(Math.min(800, waitUntil - Date.now())); }
          if (!(await pageFeatureLive(PAGE_GROUP_COMMENT_FLAG, runId))) return;
          location.assign(groups[index + 1].url);
          return;
        }
      }
      if (!pageGroupCommentConfig) return;
      await chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentGroupDone: 0, pageGroupCommentStatus: `Hoàn tất: ${done} comment, bỏ qua ${skipped} nhóm` });
    } catch (error) {
      console.warn("[PageGroupComment]", error);
      await chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentStatus: "Lỗi: " + String(error?.message || error || "") });
    } finally {
      pageGroupCommentConfig = null;
    }
  }

  // -----------------------------------------------------------------------
  // Page Comment AI. It deliberately mirrors the simple personal-feed flow:
  // read the exact post, ask the configured AI for one comment, submit once,
  // then require visible proof. No extra topic-classification AI is used.
  // -----------------------------------------------------------------------
  function pageMainFeedRoute() {
    const url = facebookUrl(location.href);
    return !!url && (url.pathname === "/" || url.pathname === "/home.php");
  }
  function pageCommentSourceId() {
    const s = String(pageCommentConfig?.source || "feed").toLowerCase();
    return ["feed", "groups", "pages"].includes(s) ? s : "feed";
  }
  function pageCommentSourceUrl() {
    const s = pageCommentSourceId();
    if (s === "groups" && Array.isArray(pageCommentConfig?.groups) && pageCommentConfig.groups.length) {
      const index = Math.max(0, Math.min(pageCommentConfig.groups.length - 1, parseInt(pageCommentConfig.pageIndex) || 0));
      return pageCommentConfig.groups[index]?.url || `https://www.facebook.com${pageCommentConfig.groups[index]?.key || ""}/`;
    }
    return s === "feed" ? "https://www.facebook.com/" : `https://www.facebook.com/?filter=${s}&sk=h_chr`;
  }
  function pageCommentSourceLabel() {
    const s = pageCommentSourceId();
    return t(s === "feed" ? "fd.sourceBantin" : `fd.source${s[0].toUpperCase()}${s.slice(1)}`) || s;
  }
  function pageCommentTargetRoute() {
    // Chạy đúng filter nguồn như Bảng tin nick cá nhân (feed/friends/groups/pages).
    const url = facebookUrl(location.href);
    if (!url) return false;
    const s = pageCommentSourceId();
    if (s === "groups" && Array.isArray(pageCommentConfig?.groups) && pageCommentConfig.groups.length) {
      const index = Math.max(0, Math.min(pageCommentConfig.groups.length - 1, parseInt(pageCommentConfig.pageIndex) || 0));
      const wanted = facebookUrl(pageCommentConfig.groups[index]?.url || `https://www.facebook.com${pageCommentConfig.groups[index]?.key || ""}/`);
      return !!wanted && url.pathname.replace(/\/$/, "").toLowerCase() === wanted.pathname.replace(/\/$/, "").toLowerCase();
    }
    if (url.pathname !== "/" && url.pathname !== "/home.php") return false;
    if (s === "feed") {
      const f = (url.searchParams.get("filter") || "all").toLowerCase();
      return f === "all";
    }
    return (url.searchParams.get("filter") || "all").toLowerCase() === s;
  }
  async function pageCommentAdvanceSelectedGroup(runId) {
    if (pageCommentSourceId() !== "groups" || !Array.isArray(pageCommentConfig?.groups)) return false;
    const next = (Math.max(0, parseInt(pageCommentConfig.pageIndex) || 0) + 1);
    if (next >= pageCommentConfig.groups.length || !(await pageFeatureLive(PAGE_COMMENT_FLAG, runId))) return false;
    pageCommentConfig.pageIndex = next;
    pageCommentConsecSkips = 0;
    pageCommentSkippedShown = 0;
    await chrome.storage.local.set({ pageCommentConfig, pageCommentPageIndex: next, pageCommentStatus: t("pgc.running") });
    location.assign(pageCommentSourceUrl());
    return true;
  }
  function pageArticleText(article) {
    return clean(article?.innerText || article?.textContent).slice(0, 2600);
  }
  function pagePostKey(article) {
    const link = [...(article || document).querySelectorAll('a[href]')].map(a => facebookUrl(a.href)).find(url => url && (/\/posts\/|\/permalink\/|story_fbid=|\/photo/i.test(url.pathname + url.search)));
    if (link) return link.toString().replace(/\/$/, "");
    const text = pageArticleText(article).slice(0, 500).toLocaleLowerCase("vi");
    let hash = 2166136261;
    for (const ch of text) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return `text:${(hash >>> 0).toString(36)}`;
  }
  function pageCommentButton(article) {
    return [...(article || document).querySelectorAll('button,[role="button"],a')].filter(visible).find(control => {
      // Không bao giờ bấm item trong menu (menuitem/"Ẩn hoặc báo cáo bình luận
      // này") hay nút "Xem thêm bình luận" — đã tái hiện live: matcher cũ chứa
      // "bình luận" là nhận, click mở menu thay vì ô comment nên box luôn false.
      if (control.getAttribute("role") === "menuitem" || control.closest('[role="menu"],[role="dialog"]')) return false;
      const text = labelOf(control);
      // Markup mới dùng "Viết bình luận" thay vì "Bình luận" — chấp nhận cả hai.
      if (!/^(?:viết\s+)?(?:bình luận|comments?)\b/i.test(text)) return false;
      if (/trả lời|reply|comment on this|Ẩn|ẩn|báo cáo|report|thêm|more/i.test(text)) return false;
      if (control.closest("ul") || control.closest('[aria-label*="Bình luận"],[aria-label*="Comment"]')?.closest("ul")) return false;
      return true;
    }) || null;
  }
  function pageCommentBox(scope) {
    return [...(scope || document).querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible).find(box => {
      const label = `${box.getAttribute("aria-label") || ""} ${box.getAttribute("placeholder") || ""}`;
      return !/tìm kiếm|search|tin nhắn|message/i.test(label) && !box.closest("form[role=search]");
    }) || null;
  }
  function pageCommentSendButton(box) {
    let node = box;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const button = [...node.querySelectorAll('button,[role="button"],div[role="button"]')].filter(visible).find(control => /^(?:đăng bình luận|comment|bình luận|gửi|send|post)$/i.test(labelOf(control)) && !control.disabled && control.getAttribute("aria-disabled") !== "true");
      if (button) return button;
    }
    return [...document.querySelectorAll('button,[role="button"]')].filter(visible).find(control => /^(?:đăng bình luận|comment|bình luận|gửi|send)$/i.test(labelOf(control)) && !control.disabled) || null;
  }
  function pageCommentProof(scope, expected) {
    const needle = clean(expected).slice(0, 70).toLocaleLowerCase("vi");
    if (needle.length < 5) return false;
    return [...(scope || document).querySelectorAll("div,span,p")].filter(visible).some(node => {
      if (node.matches('[contenteditable="true"],[role="textbox"]') || node.closest('[contenteditable="true"],[role="textbox"]')) return false;
      const text = clean(node.innerText || node.textContent).toLocaleLowerCase("vi");
      return text.includes(needle) && text.length < 500;
    });
  }
  // Facebook đặt aria-label "Chỉnh sửa hoặc xóa bình luận này" lên đúng
  // comment của tài khoản đang dùng — tín hiệu ổn định hơn dò theo tên Page.
  function pageHasOwnComment(scope) {
    if (!scope) return false;
    return [...scope.querySelectorAll('[aria-label]')].some(el => /chỉnh sửa hoặc xóa bình luận này|edit or delete this comment/i.test(el.getAttribute("aria-label") || ""));
  }
  function pageExistingCommentTexts(scope) {
    if (!scope) return [];
    const nodes = [...scope.querySelectorAll('[role="article"], [aria-label*="bình luận" i], [aria-label*="comment" i]')]
      .filter(node => node !== scope)
      .filter(node => !node.matches('[contenteditable="true"],[role="textbox"]') && !node.closest('[contenteditable="true"],[role="textbox"]'))
      .filter(node => {
        const label = (node.getAttribute("aria-label") || "").toLocaleLowerCase("vi");
        return label.includes("bình luận") || label.includes("comment") || !!node.closest("ul");
      });
    const texts = [];
    for (const node of nodes) {
      const text = clean(node.innerText || node.textContent).toLocaleLowerCase("vi");
      if (text.length >= 20) texts.push(text);
    }
    return [...new Set(texts)].slice(0, 60);
  }
  function pageCommentDuplicatesExisting(scope, commentText) {
    const mine = clean(commentText).toLocaleLowerCase("vi");
    if (mine.length < 25) return false;
    // Câu AI trùng gần nguyên văn comment đã có: hoặc toàn bộ câu AI đã được
    // người khác nói, hoặc câu AI ôm trọn một comment dài của người khác. Cả
    // hai đều là đăng chồng — phải bỏ qua, không được gửi.
    return pageExistingCommentTexts(scope).some(existing => {
      if (existing.includes(mine)) return true;
      return existing.length >= 30 && mine.includes(existing);
    });
  }
  function pageArticleCardForMessage(messageEl) {
    // Feed chính không còn gắn role="article" lên khung bài thật (chỉ còn
    // skeleton "Đang tải...") — đã tái hiện live: quét cũ trả về 2 skeleton
    // rỗng dù feed đầy bài. Neo theo mốc nội dung story_message (có ở mọi
    // dạng bài) rồi đi lên tới tổ tiên nhỏ nhất sở hữu nút Bình luận của
    // chính bài đó (cách làm của Top Comment).
    for (let node = messageEl?.parentElement, depth = 0; node && depth < 26; depth++, node = node.parentElement) {
      if (pageCommentButton(node)) return node;
    }
    return null;
  }
  // Fallback khi feed không còn role="article"/FeedUnit (markup mới: card là
  // div thường, không permalink — đã tái hiện live trên feed Page: bài đầy đủ
  // nhưng query cũ chỉ thấy skeleton). Neo từ nút Bình luận cấp bài đi lên tới
  // tổ tiên NGOÀI CÙNG chứa cả action bar lẫn nội dung (dừng khi gặp node gộp
  // nhiều bài). Chỉ dùng khi classic candidates cho 0 kết quả để tránh trùng bài.
  function pageFeedFallbackCards() {
    const isPostCommentButton = (control) => {
      if (!control || control.getAttribute("role") === "menuitem" || control.closest?.('[role="menu"],[role="dialog"]')) return false;
      const text = labelOf(control);
      if (!/^(?:viết\s+)?(?:bình luận|comments?)\b/i.test(text)) return false;
      if (/trả lời|reply|comment on this|Ẩn|ẩn|báo cáo|report|thêm|more/i.test(text)) return false;
      if (control.closest("ul")) return false;
      return true;
    };
    const cards = [], seen = new Set();
    const buttons = [...document.querySelectorAll('button,[role="button"],a')].filter(visible).filter(isPostCommentButton);
    for (const button of buttons) {
      let best = null;
      for (let node = button.parentElement, depth = 0; node && depth < 18 && node !== document.body; depth++, node = node.parentElement) {
        if (!visible(node)) continue;
        const w = node.getBoundingClientRect?.().width || 0;
        if (w > 0 && (w < 400 || w > 950)) continue;
        const text = clean(node.innerText || node.textContent);
        if (text.length < 120) continue;
        // Node gộp nhiều bài (chứa từ 2 nút comment cấp bài trở lên) → dừng,
        // giữ tổ tiên nhỏ hơn gần nhất đã khớp.
        const nested = [...node.querySelectorAll('button,[role="button"],a')].filter(el => el !== button && visible(el) && isPostCommentButton(el));
        if (nested.length) break;
        best = node;
      }
      if (!best || seen.has(best)) continue;
      seen.add(best); cards.push(best);
      if (cards.length >= 50) break;
    }
    return cards;
  }
  function pageFeedArticles() {
    const rows = [], seen = new Set();
    const collect = (candidates) => {
      for (const article of candidates) {
        if (!visible(article) || article.closest('[role="dialog"]')) continue;
        if (article.dataset.pageCommentDone === "1") continue;
        const text = pageArticleText(article);
        const _rawTc = (article.textContent||'').replace(/[\u00AD\u034F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g,'');
        if (text.length < 15 || /được tài trợ|sponsored/i.test(text) || /được tài trợ|sponsored/i.test(_rawTc) || article.querySelector('a[href*="/adchoices"],a[href*="/ads/about"],a[href*="/adpreferences"],a[href*="/privacy_sandbox/browsing_topics"]')) continue;
        const button = pageCommentButton(article);
        // Nhiều layout nhóm không có nút Bình luận cấp bài (chỉ còn thread + ô
        // inline mở sẵn) — chấp nhận bài đã có ô comment, khâu gửi sẽ dùng luôn.
        const preBox = !button ? pageCommentBox(article) : null;
        if (!button && !preBox) continue;
        const key = pagePostKey(article);
        if (!key || seen.has(key)) continue;
        seen.add(key); rows.push({ article, key, text, button });
        if (rows.length >= 50) break;
      }
    };
    const candidates = new Set(document.querySelectorAll('[role="article"],article,[data-pagelet^="FeedUnit_"]'));
    for (const message of document.querySelectorAll('[data-ad-rendering-role="story_message"],[data-ad-comet-preview="message"],[data-ad-preview="message"]')) {
      const card = pageArticleCardForMessage(message);
      if (card) candidates.add(card);
    }
    collect(candidates);
    if (!rows.length) collect(pageFeedFallbackCards());
    return rows;
  }
  async function waitPageCommentBox(article, previousBoxes, runId) {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (!(await pageFeatureLive(PAGE_COMMENT_FLAG, runId))) return null;
      const inline = pageCommentBox(article);
      if (inline) return { box: inline, scope: article };
      const opened = [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible).find(box => !previousBoxes.has(box) && !/tìm kiếm|search|tin nhắn|message/i.test(labelOf(box)));
      if (opened) return { box: opened, scope: opened.closest('[role="dialog"]') || article || document.body };
      await sleep(500);
    }
    return null;
  }
  async function closePageCommentView(scope) {
    if (!scope || scope === document.body || scope === document) return true;
    const close = [...scope.querySelectorAll('button,[role="button"]')].filter(visible).find(control => /^(?:đóng|close|quay lại|back)$/i.test(labelOf(control)));
    if (close) { try { close.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } await sleep(400); }
    return true;
  }
  async function postPageComment(article, text, key, runId, tagEntity = null) {
    await pageTagLog("[pageComment] submit-step: api=" + (!!globalThis.FbTagMention) + " cfg=" + (!!pageCommentConfig?.tagConfig) + " ent=" + (tagEntity ? String(tagEntity.name).slice(0, 30) : "null"));
    const postScope = article?.article || article;
    const tagLog = (msg) => { pageTagLog(msg); };
    // Dọn overlay/dialog lạc trước khi bấm mở khung bình luận — pageFeatureClick
    // bấm theo toạ độ, một dialog che ngay điểm bấm sẽ nuốt mất cú click.
    await dismissPageOverlays();
    const button = article?.button?.isConnected ? article.button : pageCommentButton(postScope);
    if (!button || !(await pageFeatureClick(button, PAGE_COMMENT_FLAG, runId))) { tagLog("@tag bỏ qua (pageComment: no-comment-button)"); return "unconfirmed-skip"; }
    const previousBoxes = new Set([...document.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible));
    const composer = await waitPageCommentBox(postScope, previousBoxes, runId);
    if (!composer) { tagLog("@tag bỏ qua (pageComment: no-composer-60s)"); return "unconfirmed-skip"; }
    const box = composer.box;
    const wantComment = clean(text), wantCommentPrefix = wantComment.slice(0, 35);
    // Chặn gõ nhầm ô khác (học từ đăng bài Page: phím rơi vào ô reply trong
    // feed). Nếu prefix đã nằm ở ô ngoài scope composer thì dừng, không gửi.
    const commentMisplaced = () => [...document.querySelectorAll('div[contenteditable="true"],[role="textbox"],textarea')]
      .filter(el => visible(el) && el !== box && !box.contains(el) && !(composer.scope && composer.scope !== document.body && composer.scope.contains(el)))
      .some(el => clean(el.innerText || el.textContent || el.value).includes(wantCommentPrefix));
    // Focus chắc chắn + dọn nháp cũ trong ô trước khi gõ để không nối đuôi.
    let focused = false;
    for (let f = 0; f < 3 && !focused; f++) {
      try { await pageFeatureClick(box, PAGE_COMMENT_FLAG, runId); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      try { box.focus(); box.click(); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(200);
      try { focused = !!(box.contains?.(document.activeElement) || box === document.activeElement); } catch (_) { focused = false; }
    }
    if (!focused) { await closePageCommentView(composer.scope); tagLog("@tag bỏ qua (pageComment: focus-fail)"); return "unconfirmed-skip"; }
    try {
      box.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
      if (document.execCommand("selectAll", false, null)) document.execCommand("delete");
    } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    await sleep(200);
    const tc = pageCommentConfig?.typingConfig || {};
    const typeIt = (content) => chrome.runtime.sendMessage({ action: "trustedInput", text: content, pressEnter: false, typingMinDelay: tc.minDelay ?? 20, typingMaxDelay: tc.maxDelay ?? 45, abortStorageKey: PAGE_COMMENT_FLAG, abortRunId: runId, abortRunIdKey: "pageCommentRunId" }).catch(() => null);
    const readBox = () => clean(box.isConnected ? (box.innerText || box.textContent || box.value) : "");
    let typed = await typeIt(text);
    let gotComment = readBox();
    // Gõ lại 1 lần nếu hụt (re-render đổi node giữa chừng): dọn rồi gõ lại.
    if ((!typed?.ok || !gotComment.includes(wantCommentPrefix) || gotComment.length < wantComment.length * 0.6) && await pageFeatureLive(PAGE_COMMENT_FLAG, runId)) {
      try {
        box.focus();
        const sel = window.getSelection(), range = document.createRange();
        range.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(range);
        if (document.execCommand("selectAll", false, null)) document.execCommand("delete");
      } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      await sleep(300);
      typed = await typeIt(text);
      gotComment = readBox();
    }
    if (commentMisplaced()) { await closePageCommentView(composer.scope); tagLog("@tag bỏ qua (pageComment: misplaced)"); return "unconfirmed-skip"; }
    if (!typed?.ok || !gotComment.includes(wantCommentPrefix) || gotComment.length < wantComment.length * 0.6 || gotComment.length > wantComment.length + 60) { await closePageCommentView(composer.scope); tagLog("@tag bỏ qua (pageComment: type-fail)"); return "unconfirmed-skip"; }
    // Tag do lõi chung gắn (unifiedSendProofDwell) — không gắn ở đây để khỏi mention 2 lần.
    const liveBeforeSubmit = await chrome.storage.local.get(PAGE_COMMENT_FLAG);
    if (!(await pageFeatureLive(PAGE_COMMENT_FLAG, runId)) || liveBeforeSubmit[PAGE_COMMENT_FLAG] === false) return "stopped";
    // Chặn trùng lần cuối ngay trước khi gửi: nếu trong lúc gõ đã có comment
    // khác xuất hiện trùng gần nguyên văn, bỏ qua thay vì đăng chồng.
    if (pageCommentDuplicatesExisting(postScope, text)) { await closePageCommentView(composer.scope); tagLog("@tag bỏ qua (pageComment: duplicate)"); return "unconfirmed-skip"; }
    // Gửi + proof + nán qua lõi chung (cùng cơ chế Bản tin & AI).
    const UC2 = globalThis.UnifiedComment;
    if (!UC2?.sendProofDwell) return "unconfirmed-skip";
    const pcRes = await UC2.sendProofDwell({
      box, commentScope: composer.scope, text, proof: clean(text).slice(0, 60),
      tagEntity, tagConfig: pageCommentConfig.tagConfig,
      alive: () => pageFeatureLive(PAGE_COMMENT_FLAG, runId),
      onEvent: () => {},
      clearDraft: () => closePageCommentView(composer.scope),
      findSend: async () => { const s = pageCommentSendButton(box); if (s) await dismissPageStraysOnly(s); return s; },
      doSend: (btn) => pageFeatureClick(btn, PAGE_COMMENT_FLAG, runId),
      proofExists: (root, pr) => pageCommentProof(root, text),
      proofRoots: () => [composer.scope, postScope],
      scrollIntoView: () => { try { (composer.scope?.isConnected ? composer.scope : postScope)?.scrollIntoView?.({ behavior: "smooth", block: "center" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); } },
      onCounted: async () => {
        await closePageCommentView(composer.scope);
        if (postScope?.isConnected) postScope.dataset.pageCommentDone = "1";
        return true;
      },
    });
    if (pcRes === true) return true;
    if (pcRes === "stopped") return "stopped";
    await closePageCommentView(composer.scope);
    if (pcRes === "unconfirmed-skip") tagLog("@tag bỏ qua (pageComment: proof-timeout-30s)");
    return "unconfirmed-skip";
  }
  async function pageCommentOne(item, runId) {
    // Actor không tự đổi giữa các bài trong cùng phiên (không điều hướng giữa
    // chừng như đăng bài nhóm) nên chỉ verify đúng 1 lần đầu phiên; các bài
    // sau bỏ qua để không mở picker liên tục.
    if (commentActorVerifiedRun !== runId) {
      if (!(await pageSwitchActor(pageCommentConfig.page, PAGE_COMMENT_FLAG, runId))) { await pageTagLog("@tag bỏ qua (pageComment: no-actor)"); return "skip"; }
      commentActorVerifiedRun = runId;
    }
    // Đã có comment hiển thị của chính tài khoản trên bài này → bỏ qua ngay, không
    // tốn lượt gọi AI để rồi vẫn phải bỏ vì đăng chồng.
    if (pageHasOwnComment(item?.article)) { await pageTagLog("@tag bỏ qua (pageComment: own-comment)"); return "skip"; }
    // Sổ cái chữ ký (feed.js): chặn đăng trùng chéo phiên/tag-không-tag.
    try { if (await globalThis.FbTagMention?.postSigMarked?.(item.text)) { await pageTagLog("@tag bỏ qua (pageComment: sig-seen)"); return "skip"; } } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
    // Dùng đúng hồ sơ AI của Comment Page (pageCommentConfig.aiConfig), không
    // dùng liveAiConfig() của luồng Join (cùng lỗi như Page đăng bài nhóm).
    const ai = (pageCommentConfig?.aiConfig && pageCommentConfig.aiConfig.provider)
      ? pageCommentConfig.aiConfig
      : await liveAiConfig();
    // Quyết định tag TRƯỚC khi chọn prompt (giống feed nick cá nhân): chỉ bài
    // trúng tỉ lệ mới dùng prompt tag (có {tagName}); bài còn lại dùng prompt
    // thường để không dính tên Page thô trong câu.
    const tagApi = globalThis.FbTagMention || null;
    const tagPromptRaw = String(pageCommentConfig.tagPrompt || "");
    const tagEntity = (tagApi && pageCommentConfig.tagConfig && tagPromptRaw.includes("{tagName}"))
      ? tagApi.decideTagForPost(pageCommentConfig.tagConfig)
      : null;
    await pageTagLog("[pageComment] decide: api=" + (!!tagApi) + " cfg=" + (!!pageCommentConfig.tagConfig) + " hasTagName=" + tagPromptRaw.includes("{tagName}") + " ent=" + (tagEntity ? tagEntity.name.slice(0, 30) : "null"));
    const prompt = tagEntity
      ? (tagApi.buildTagPrompt?tagApi.buildTagPrompt(tagPromptRaw,tagEntity.name):tagPromptRaw.replaceAll("{tagName}", tagEntity.name))
      : pageStripTagPlaceholder(pageCommentConfig.prompt);
    const response = await chrome.runtime.sendMessage({ action: "aiGeneratePageComment", postText: item.text, pageName: pageCommentConfig.page.name, source: pageCommentSourceLabel(), prompt, maxLines: tagEntity?2:1, pageProfile: pageCommentConfig.pageProfile, aiConfig: ai }).catch(() => null);
    if (!response?.ok || !response.comment) {
      await chrome.storage.local.set({ pageCommentStatus: response?.error || t("pgc.aiFailed") });
      await pageTagLog("@tag bỏ qua (pageComment: ai-fail: " + String(response?.error || "empty").slice(0, 80) + ")");
      return "skip";
    }
    if (/\{tagName\}/.test(String(response.comment))) { await pageTagLog("@tag chặn (pageComment: output còn {tagName}, bỏ bài)"); return "skip"; }
    return postPageComment(item, response.comment, item.key, runId, tagEntity);
  }
  async function pageCommentLoop(runId) {
    // Bọc toàn bộ loop: một lỗi bất ngờ trước đây sẽ văng khỏi hàm mà không
    // tắt cờ pageCommentActive, khiến tính năng không bao giờ chạy lại được.
    try {
      await chrome.storage.local.set({ pageCommentPhase: "loop-start", pageCommentPhaseAt: Date.now() });
      if (!(await pageFeatureLive(PAGE_COMMENT_FLAG, runId))) {
        const stale = await chrome.storage.local.get([PAGE_COMMENT_FLAG, "pageCommentRunId"]);
        if (stale[PAGE_COMMENT_FLAG] && (!stale.pageCommentRunId || stale.pageCommentRunId === runId)) {
          await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.stopped"), pageCommentPhase: "not-live" });
        }
        return;
      }
      if (!pageCommentTargetRoute()) {
        await chrome.storage.local.set({ pageCommentPhase: "routing", pageCommentPhaseAt: Date.now() });
        location.replace(pageCommentSourceUrl());
        return;
      }
      await chrome.storage.local.set({ pageCommentPhase: "route-ok", pageCommentPhaseAt: Date.now() });
      // Đổi actor có thể làm Facebook reload toàn trang trước khi promise
      // kịp trả về. Nếu reload lặp lại, content script mới sẽ resume theo cờ
      // cũ và trước đây khiến Page Comment chạy vô hạn với active=true. Ghi
      // marker trước mỗi lần thử, giới hạn hai lần cho cùng run; actor xác
      // minh được thì xoá marker ngay.
      const actorAttemptKey = "pageCommentActorAttempt";
      const actorAttemptStore = await chrome.storage.local.get(actorAttemptKey);
      const actorAttempt = actorAttemptStore[actorAttemptKey];
      const actorAttemptCount = actorAttempt?.runId === runId ? (Number(actorAttempt.count) || 0) : 0;
      if (actorAttemptCount >= 2) {
        await chrome.storage.local.remove(actorAttemptKey);
        await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.noPageActor", { name: pageCommentConfig.page.name }) });
        return;
      }
      await chrome.storage.local.set({ [actorAttemptKey]: { runId, count: actorAttemptCount + 1, time: Date.now() } });
      const switched = await Promise.race([
        pageSwitchActor(pageCommentConfig.page, PAGE_COMMENT_FLAG, runId),
        sleep(45000).then(() => false)
      ]);
      if (!switched) {
        // Actor không xác minh được phải kết thúc phiên fail-closed. Trước đây
        // chỉ cập nhật status rồi return, để pageCommentActive=true sống dai
        // và popup không thể Start lại sau một ca Page bị thiếu actor/feed.
        await chrome.storage.local.remove(actorAttemptKey);
        await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.noPageActor", { name: pageCommentConfig.page.name }), pageCommentPhase: "actor-failed", pageCommentPhaseAt: Date.now() });
        return;
      }
      await chrome.storage.local.remove(actorAttemptKey);
      await chrome.storage.local.set({ pageCommentPhase: "actor-ok", pageCommentPhaseAt: Date.now() });
      commentActorVerifiedRun = runId;
      const historyStore = await chrome.storage.local.get("pageCommentHistory");
      const history = historyStore.pageCommentHistory && typeof historyStore.pageCommentHistory === "object" ? historyStore.pageCommentHistory : {};
      // Lịch sử unconfirmed giữ mãi làm feed cạn kiệt (bắt live: 68/93 keys
      // unconfirmed từ 29/9, feed chỉ còn bài đã chặn → run nào cũng 0 bài).
      // confirmed giữ vĩnh viễn chống trùng; còn lại hết hạn sau 30 ngày.
      try {
        const now = Date.now();
        for (const k of Object.keys(history)) {
          const e = history[k];
          if (e && e.state !== "confirmed" && now - (Number(e.time) || 0) > 30 * 86400000) delete history[k];
        }
      } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
      // Tab lạnh/lazy-load: feed ban đầu chỉ có skeleton rỗng. Đợi tối đa ~40s
      // cho bài thật (article có text) thay vì đốt 4 vòng rỗng rồi kết thúc
      // 0 bài (đã tái hiện live: 2 skeleton, withCommentBtn 0).
      const feedReadyUntil = Date.now() + 40000;
      let feedReady = false;
      while (Date.now() < feedReadyUntil) {
        if (!(await pageFeatureLive(PAGE_COMMENT_FLAG, runId)) || !pageCommentConfig) return;
        const hasReal = [...document.querySelectorAll('[role="article"],article,[data-pagelet^="FeedUnit_"]')]
          .some(a => visible(a) && !a.closest('[role="dialog"]') && clean(a.innerText || a.textContent).length > 100);
        if (hasReal || pageFeedArticles().length) { feedReady = true; break; }
        await chrome.storage.local.set({ pageCommentStatus: t("pgc.waitingFeed") });
        window.scrollBy({ top: Math.max(420, Math.floor(window.innerHeight * 0.8)), behavior: "smooth" });
        await sleep(2500);
      }
      if (!feedReady) {
        await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.noFeed"), pageCommentPhase: "no-feed", pageCommentPhaseAt: Date.now() });
        return;
      }
      let emptyRounds = 0;
      // chrome.storage.onChanged có thể null hoá pageCommentConfig ngay giữa 2
      // await (Stop bấm đúng lúc) — thêm "pageCommentConfig &&" để chặn deref null.
      while (await pageFeatureLive(PAGE_COMMENT_FLAG, runId) && pageCommentConfig && (pageCommentConfig.done || 0) < Math.max(1, parseInt(pageCommentConfig.target) || 1)) {
        // Một entry "submitting" còn sót từ run trước (crash/reload giữa
        // chừng, không phải Facebook thực sự từ chối) không được coi là đã xử
        // lý — chỉ entry của CHÍNH run đang chạy mới chặn xử lý lại bài đó.
        // Unconfirmed (proof trượt oan) được thử lại sau 7 ngày thay vì chặn
        // vĩnh viễn — nếu không feed toàn bài đã chặn, run nào cũng 0 bài.
        // Confirmed không bao giờ thử lại (chống đăng trùng).
        const UNCONFIRMED_RETRY_MS = 7 * 86400000;
        const posts = pageFeedArticles().filter(item => {
          const entry = history[item.key];
          if (!entry) return true;
          if (entry.state === "submitting" && entry.runId !== runId) return true;
          if (entry.state !== "confirmed" && Date.now() - (Number(entry.time) || 0) > UNCONFIRMED_RETRY_MS) return true;
          return false;
        });
        if (!posts.length) {
          emptyRounds++;
          if (emptyRounds >= 4) {
            if (await pageCommentAdvanceSelectedGroup(runId)) return;
            break;
          }
          window.scrollBy({ top: Math.max(450, Math.floor(window.innerHeight * .8)), behavior: "smooth" });
          await sleep(1200); continue;
        }
        emptyRounds = 0;
        for (const item of posts) {
          if (!(await pageFeatureLive(PAGE_COMMENT_FLAG, runId)) || !pageCommentConfig || (pageCommentConfig.done || 0) >= Math.max(1, parseInt(pageCommentConfig.target) || 1)) break;
          history[item.key] = { time: Date.now(), source: pageCommentConfig.source, state: "submitting", runId };
          await chrome.storage.local.set({ pageCommentHistory: history, pageCommentStatus: t("pgc.processing", { n: (pageCommentConfig.done || 0) + 1 }) });
          // Một bài lỗi bất ngờ không được giết cả vòng lặp — bắt riêng để bỏ
          // qua đúng bài đó rồi tiếp tục bài kế tiếp.
          let result = "skip";
          try {
            result = await pageCommentOne(item, runId);
          } catch (error) {
            console.warn("[PageComment] pageCommentOne", error);
            result = "skip";
          }
          if (result === "stopped") {
            // Chưa chắc đã thật sự bấm gửi — không để lại dấu "submitting"
            // vĩnh viễn chặn bài này ở lần chạy sau.
            delete history[item.key];
            await chrome.storage.local.set({ pageCommentHistory: history });
            return;
          }
          if (!pageCommentConfig) return;
          if (result === true) {
            pageCommentConfig.done = (pageCommentConfig.done || 0) + 1; history[item.key] = { time: Date.now(), source: pageCommentConfig.source, state: "confirmed" };
            try { await globalThis.FbTagMention?.markPostSig?.(item.text); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
          }
          else history[item.key] = { time: Date.now(), source: pageCommentConfig.source, state: "unconfirmed" };
          if (result !== true) pageCommentSkippedShown++;
          await chrome.storage.local.set({ pageCommentDone: pageCommentConfig.done || 0, pageCommentHistory: history, pageCommentStatus: t("pgc.progress", { done: pageCommentConfig.done || 0, target: pageCommentConfig.target }) + (pageCommentSkippedShown > 0 ? ` · bỏ qua ${pageCommentSkippedShown}` : "") });
          // Ngắt mạch bỏ qua liên tiếp: feed còn bài nhưng toàn bài đã chặn
          // (sổ cái chống trùng) thì quét mãi không tiến triển — dừng sạch sau
          // 25 skip liên tiếp thay vì đốt thời gian vô hạn (bắt live: 21+ skip,
          // mỗi vòng ~30s delay). Đếm reset khi có 1 bài đăng được.
          if (result === true) pageCommentConsecSkips = 0;
          else {
            pageCommentConsecSkips++;
            if (pageCommentConsecSkips >= 25) {
              if (await pageCommentAdvanceSelectedGroup(runId)) return;
              await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.done", { done: pageCommentConfig.done || 0 }) + (pageCommentSkippedShown > 0 ? ` · bỏ qua ${pageCommentSkippedShown}` : "") + t("pgc.dryStop") });
              return;
            }
          }
          const min = Math.max(5, parseInt(pageCommentConfig.minDelay) || 15), max = Math.max(min, parseInt(pageCommentConfig.maxDelay) || 30), until = Date.now() + min * 1000 + Math.floor(Math.random() * Math.max(1, (max - min) * 1000));
          while (Date.now() < until) { if (!(await pageFeatureLive(PAGE_COMMENT_FLAG, runId))) return; await sleep(Math.min(800, until - Date.now())); }
        }
        window.scrollBy({ top: Math.max(450, Math.floor(window.innerHeight * .8)), behavior: "smooth" });
        await sleep(1000);
      }
      if (!pageCommentConfig) return;
      await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.done", { done: pageCommentConfig.done || 0 }) + (pageCommentSkippedShown > 0 ? ` · bỏ qua ${pageCommentSkippedShown}` : ""), pageCommentPhase: "done", pageCommentPhaseAt: Date.now() });
    } catch (error) {
      console.warn("[PageComment]", error);
      await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: "Lỗi: " + String(error?.message || error || ""), pageCommentPhase: "error", pageCommentPhaseAt: Date.now() });
    } finally {
      pageCommentConfig = null;
    }
  }

  // Ngay sau khi popup điều hướng tới trang quản lý Page, Facebook thường vẫn
  // đang tải danh sách (GraphQL) nên querySelectorAll chưa thấy gì — quét 1 lần
  // duy nhất dễ trả về mảng rỗng dù trang đã mở đúng chỗ, khiến người dùng
  // phải mở lại popup và bấm lần nữa mới ăn (lúc đó tab đã "ấm", tải nhanh
  // hơn). Thử lại vài lần trong lúc chờ DOM thay vì trả rỗng ngay từ lượt đầu.
  async function scanManagedPages() {
    const onPagesRoute = /\/pages(?:[/?]|$)/i.test(location.pathname);
    let pages = managedPageLinks();
    // Chờ DOM load nếu chưa có gì
    for (let attempt = 0; attempt < 10 && pages.length === 0; attempt++) {
      await sleep(800);
      pages = managedPageLinks();
    }
    // Nếu đang ở trang quản lý Page, scroll để lazy-load thêm Page
    if (onPagesRoute) {
      let stuckCount = 0;
      for (let i = 0; i < 15; i++) {
        const prev = pages.length;
        // Scroll trang chính + thử scroll các container riêng (sidebar, list)
        window.scrollTo(0, document.body.scrollHeight);
        const scrollables = [...document.querySelectorAll('[role="main"] [style*="overflow"],[role="main"] [class*="scroll"]')]
          .filter(el => el.scrollHeight > el.clientHeight + 50);
        for (const el of scrollables) el.scrollTop = el.scrollHeight;
        await sleep(1200);
        pages = managedPageLinks();
        if (pages.length === prev) {
          stuckCount++;
          if (stuckCount >= 3) break; // Không tải thêm sau 3 lần liên tiếp
        } else {
          stuckCount = 0;
        }
      }
      window.scrollTo(0, 0);
    }
    return { ok: true, pages };
  }

  function applyConfig(config) {
    currentConfig = { ...(config || {}), page: config?.page || null, aiConfig: config?.aiConfig || {} };
    currentRunId = String(config?.runId || currentRunId || "");
    keywordIndex = Math.max(0, parseInt(config?.keywordIndex) || 0);
    keywordDone = Array.isArray(config?.keywordDone) ? config.keywordDone.map(v => Math.max(0, parseInt(v) || 0)) : [];
    const synced = syncEntryToConfig(currentConfig, keywordIndex);
    keywordIndex = synced.index;
    keywordDone = [...currentConfig.keywordDone];
    // Giữ config.keywordDone đồng bộ với bộ nhớ để mọi spread/persist sau
    // này (advance/resume) không lan truyền bản stale.
    currentConfig.keywordDone = [...keywordDone];
    actorFailureStreak = 0;
    active = true;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[FLAG]?.newValue === false) active = false;
    if (changes[PAGE_POST_FLAG]?.newValue === false) pagePostConfig = null;
    if (changes[PAGE_NEWS_FLAG]?.newValue === false) pageNewsConfig = null;
    if (changes[PAGE_COMMENT_FLAG]?.newValue === false) { pageCommentConfig = null; commentActorVerifiedRun = null; }
    if (changes[PAGE_SALES_FLAG]?.newValue === false) pageSalesConfig = null;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startPageGroupPost") {
      if (pagePostConfig) { sendResponse({ ok: false, code: "page-post-busy", error: t("pgp.busy") }); return true; }
      pagePostRunId = String(message.runId || message.config?.runId || `page-post-${Date.now()}`);
      pagePostConfig = { ...(message.config || {}), runId: pagePostRunId, ownerTabId: message.ownerTabId || message.config?.ownerTabId || sender.tab?.id || 0, done: Math.max(0, parseInt(message.done) || 0), skipped: Math.max(0, parseInt(message.skipped) || 0), index: Math.max(0, parseInt(message.index) || 0) };
      chrome.storage.local.set({ [PAGE_POST_FLAG]: true, pageGroupPostRunId: pagePostRunId, pageGroupPostOwnerTabId: pagePostConfig.ownerTabId, pageGroupPostConfig: { ...pagePostConfig, aiConfig: pagePostConfig.aiConfig ? { provider: pagePostConfig.aiConfig.provider, model: pagePostConfig.aiConfig.model, url: pagePostConfig.aiConfig.url, profileId: pagePostConfig.aiConfig.profileId||"" } : undefined }, pageGroupPostDone: pagePostConfig.done, pageGroupPostSkipped: pagePostConfig.skipped, pageGroupPostIndex: pagePostConfig.index, pageGroupPostRetriedIdx: -1, pageGroupPostStatus: t("pgp.running") }).then(() => pageGroupPostLoop(pagePostRunId));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopPageGroupPost") {
      pagePostConfig = null;
      chrome.storage.local.set({ [PAGE_POST_FLAG]: false, pageGroupPostStatus: t("pgp.stopped") });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetPageGroupPost") {
      pagePostConfig = null;
      chrome.storage.local.set({ [PAGE_POST_FLAG]: false, pageGroupPostDone: 0, pageGroupPostSkipped: 0, pageGroupPostIndex: 0, pageGroupPostStatus: t("pgp.reset") });
      chrome.storage.local.remove("pageGroupPostConfig");
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "startPageNewsWall") {
      if (pageNewsConfig) { sendResponse({ ok: false, code: "page-news-busy", error: t("pgn.busy") }); return true; }
      pageNewsRunId = String(message.runId || message.config?.runId || `page-news-${Date.now()}`);
      pageNewsConfig = { ...(message.config || {}), runId: pageNewsRunId, ownerTabId: message.ownerTabId || message.config?.ownerTabId || sender.tab?.id || 0, done: Math.max(0, parseInt(message.done) || 0), skipped: Math.max(0, parseInt(message.skipped) || 0), index: Math.max(0, parseInt(message.index) || 0) };
      const safeAi = pageNewsConfig.aiConfig ? { provider: pageNewsConfig.aiConfig.provider, model: pageNewsConfig.aiConfig.model, url: pageNewsConfig.aiConfig.url, profileId: pageNewsConfig.aiConfig.profileId || "" } : undefined;
      chrome.storage.local.set({ [PAGE_NEWS_FLAG]: true, pageNewsWallActiveRunId: pageNewsRunId, pageNewsWallOwnerTabId: pageNewsConfig.ownerTabId, pageNewsWallConfig: { ...pageNewsConfig, aiConfig: safeAi }, pageNewsWallDone: pageNewsConfig.done, pageNewsWallSkipped: pageNewsConfig.skipped, pageNewsWallIndex: pageNewsConfig.index, pageNewsWallStatus: t("pgn.running") }).then(() => pageNewsWallLoop(pageNewsRunId));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopPageNewsWall") {
      pageNewsConfig = null;
      chrome.storage.local.set({ [PAGE_NEWS_FLAG]: false, pageNewsWallStatus: t("pgn.stopped") });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetPageNewsWall") {
      pageNewsConfig = null;
      chrome.storage.local.set({ [PAGE_NEWS_FLAG]: false, pageNewsWallDone: 0, pageNewsWallSkipped: 0, pageNewsWallIndex: 0, pageNewsWallStatus: t("pgn.resetStatus") });
      chrome.storage.local.remove("pageNewsWallConfig");
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "startPageComment") {
      if (pageCommentConfig) { sendResponse({ ok: false, code: "page-comment-busy", error: t("pgc.busy") }); return true; }
      pageCommentRunId = String(message.runId || message.config?.runId || `page-comment-${Date.now()}`);
      pageCommentSkippedShown = 0;
      pageCommentConsecSkips = 0;
      pageCommentConfig = { ...(message.config || {}), runId: pageCommentRunId, ownerTabId: message.ownerTabId || message.config?.ownerTabId || sender.tab?.id || 0, done: Math.max(0, parseInt(message.done) || 0), pageIndex: Math.max(0, parseInt(message.pageIndex) || 0) };
      const startAt = Date.now();
      chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: true, pageCommentRunId, pageCommentOwnerTabId: pageCommentConfig.ownerTabId, pageCommentConfig: { ...pageCommentConfig, aiConfig: pageCommentConfig.aiConfig ? { provider: pageCommentConfig.aiConfig.provider, model: pageCommentConfig.aiConfig.model, url: pageCommentConfig.aiConfig.url, profileId: pageCommentConfig.aiConfig.profileId||"" } : undefined }, pageCommentDone: pageCommentConfig.done, pageCommentPageIndex: pageCommentConfig.pageIndex, pageCommentStatus: t("pgc.running"), pageCommentPhase: "starting", pageCommentPhaseAt: startAt }).then(() => {
        pageCommentLoop(pageCommentRunId).catch(error => chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: "Lỗi: " + String(error?.message || error || ""), pageCommentPhase: "launch-error", pageCommentPhaseAt: Date.now() }));
        // Nếu callback launch bị mất khi Facebook vừa thay document, không để
        // cờ chạy sống vô hạn. Content script mới sẽ resume theo runId; còn
        // nếu không có script nào resume được thì watchdog này đóng run sạch.
        setTimeout(async () => {
          try {
            const s = await chrome.storage.local.get([PAGE_COMMENT_FLAG, "pageCommentRunId", "pageCommentPhase", "pageCommentPhaseAt"]);
            if (s[PAGE_COMMENT_FLAG] && s.pageCommentRunId === pageCommentRunId && s.pageCommentPhase === "starting" && Date.now() - (Number(s.pageCommentPhaseAt) || startAt) >= 45000) {
              await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: "Lỗi: Page Comment không khởi động được", pageCommentPhase: "start-timeout", pageCommentPhaseAt: Date.now() });
            }
          } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        }, 45000);
      }).catch(error => chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: "Lỗi: " + String(error?.message || error || ""), pageCommentPhase: "persist-error", pageCommentPhaseAt: Date.now() }));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopPageComment") {
      pageCommentConfig = null;
      chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.stopped") });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetPageComment") {
      pageCommentConfig = null;
      chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentDone: 0, pageCommentStatus: t("pgc.reset") });
      chrome.storage.local.remove("pageCommentConfig");
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "startPageSalesPost") {
      if (pageSalesConfig) { sendResponse({ ok: false, code: "page-sales-busy", error: t("pgs.busy") }); return true; }
      pageSalesRunId = String(message.runId || message.config?.runId || `page-sales-${Date.now()}`);
      pageSalesConfig = { ...(message.config || {}), runId: pageSalesRunId, ownerTabId: message.ownerTabId || message.config?.ownerTabId || sender.tab?.id || 0, done: Math.max(0, parseInt(message.done) || 0), skipped: Math.max(0, parseInt(message.skipped) || 0), index: Math.max(0, parseInt(message.index) || 0) };
      chrome.storage.local.set({ [PAGE_SALES_FLAG]: true, pageSalesPostRunId: pageSalesRunId, pageSalesPostOwnerTabId: pageSalesConfig.ownerTabId, pageSalesPostConfig: { ...pageSalesConfig, aiConfig: pageSalesConfig.aiConfig ? { provider: pageSalesConfig.aiConfig.provider, model: pageSalesConfig.aiConfig.model, url: pageSalesConfig.aiConfig.url, profileId: pageSalesConfig.aiConfig.profileId||"" } : undefined }, pageSalesPostDone: pageSalesConfig.done, pageSalesPostSkipped: pageSalesConfig.skipped, pageSalesPostIndex: pageSalesConfig.index, pageSalesPostTotal: (pageSalesConfig.groups || []).length * (pageSalesConfig.products || []).length, pageSalesPostStatus: t("pgs.running") }).then(() => pageSalesLoop(pageSalesRunId));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopPageSalesPost") {
      pageSalesConfig = null;
      chrome.storage.local.set({ [PAGE_SALES_FLAG]: false, pageSalesPostStatus: t("pgs.stopped") });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetPageSalesPost") {
      pageSalesConfig = null;
      chrome.storage.local.set({ [PAGE_SALES_FLAG]: false, pageSalesPostDone: 0, pageSalesPostSkipped: 0, pageSalesPostIndex: 0, pageSalesPostTotal: 0, pageSalesPostStatus: t("pgs.resetStatus") });
      chrome.storage.local.remove("pageSalesPostConfig");
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "startPageGroupComment") {
      if (pageGroupCommentConfig) { sendResponse({ ok: false, code: "pggc-busy", error: t("pggc.busy") }); return true; }
      pageGroupCommentRunId = String(message.runId || message.config?.runId || `page-gcomment-${Date.now()}`);
      pageGroupCommentConfig = { ...(message.config || {}), runId: pageGroupCommentRunId, ownerTabId: message.ownerTabId || message.config?.ownerTabId || sender.tab?.id || 0, done: Math.max(0, parseInt(message.done) || 0), skipped: Math.max(0, parseInt(message.skipped) || 0), index: Math.max(0, parseInt(message.index) || 0) };
      chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: true, pageGroupCommentRunId, pageGroupCommentOwnerTabId: pageGroupCommentConfig.ownerTabId, pageGroupCommentConfig: { ...pageGroupCommentConfig, aiConfig: pageGroupCommentConfig.aiConfig ? { provider: pageGroupCommentConfig.aiConfig.provider, model: pageGroupCommentConfig.aiConfig.model, url: pageGroupCommentConfig.aiConfig.url, profileId: pageGroupCommentConfig.aiConfig.profileId||"" } : undefined }, pageGroupCommentDone: pageGroupCommentConfig.done, pageGroupCommentSkipped: pageGroupCommentConfig.skipped, pageGroupCommentIndex: pageGroupCommentConfig.index, pageGroupCommentStatus: t("pggc.running") }).then(() => pageGroupCommentLoop(pageGroupCommentRunId));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopPageGroupComment") {
      pageGroupCommentConfig = null;
      chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentStatus: t("pggc.stopped") });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetPageGroupComment") {
      pageGroupCommentConfig = null;
      chrome.storage.local.set({ [PAGE_GROUP_COMMENT_FLAG]: false, pageGroupCommentDone: 0, pageGroupCommentSkipped: 0, pageGroupCommentIndex: 0, pageGroupCommentStatus: t("pggc.resetStatus") });
      chrome.storage.local.remove("pageGroupCommentConfig");
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "scanManagedPages") {
      scanManagedPages().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message.action === "startPageGroupJoin") {
      if (active) { sendResponse({ ok: false, code: "page-join-busy", error: t("pg.busy") }); return true; }
      const config = message.config || message;
      applyConfig({ ...config, ownerTabId: message.ownerTabId || config.ownerTabId || 0 });
      joined = Math.max(0, parseInt(message.joined) || 0);
      skipped = Math.max(0, parseInt(message.skipped) || 0);
      nextAllowedAt = Math.max(0, parseInt(message.nextAllowedAt) || 0);
      attempted = new Set(Array.isArray(message.attemptedKeys) ? message.attemptedKeys : []);
      // Start mới luôn bắt đầu từ từ khóa đầu, tiến triển rỗng — ghi ngay để
      // resume sau reload không bao giờ vớ số sót của lượt cũ.
      keywordIndex = 0;
      keywordDone = [];
      chrome.storage.local.set({ [FLAG]: true, [CONFIG_KEY]: { ...config, aiConfig: config.aiConfig ? { ...config.aiConfig, key: undefined } : undefined }, pageGroupJoinKeywordIndex: 0, pageGroupJoinKeywordDone: [] });
      joinLoop(currentRunId, false);
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopPageGroupJoin") {
      active = false;
      chrome.storage.local.set({ [FLAG]: false, pageGroupJoinStatus: t("pg.stopped") });
      chrome.storage.local.remove([CONFIG_KEY, STATE_KEY, "pageGroupJoinAttemptedKeys"]);
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetPageGroupJoin") {
      active = false;
      joined = 0;
      skipped = 0;
      attempted = new Set();
      nextAllowedAt = 0;
      keywordIndex = 0;
      keywordDone = [];
      chrome.storage.local.set({ [FLAG]: false, pageGroupJoinJoined: 0, pageGroupJoinSkipped: 0, pageGroupJoinKeywordIndex: 0, pageGroupJoinKeywordDone: [], pageGroupJoinStatus: t("pg.reset"), pageGroupJoinNextAt: 0, pageGroupJoinLifetimeJoined: 0 });
      chrome.storage.local.remove([CONFIG_KEY, STATE_KEY, "pageGroupJoinAttemptedKeys"]);
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "getPageGroupJoinStatus") {
      sendResponse({ active, joined, skipped, runId: currentRunId });
      return true;
    }
    if (message.action === "switchPageActor") {
      const page = message.page;
      if (!page) { sendResponse({ ok: false, error: "no page" }); return true; }
      // One-shot switch cho scan danh sách nhóm của Page: không có run
      // flag nào đang bật nên pageFeatureLive("pageGroupScan","scan") luôn false,
      // khiến mọi click trong menu bị chặn và switch không bao giờ thành công
      // (trừ khi đã đúng actor từ trước). Dựng flag tạm cho đúng một lần switch.
      // BẮT BUỘC await set xong mới gọi pageSwitchActor: set không await sẽ đua
      // với get bên trong pageFeatureLive và vẫn đọc giá trị cũ (đã tái hiện:
      // menu không bao giờ mở, switch chết lặng, không báo lỗi).
      (async () => {
        try { await chrome.storage.local.set({ pageGroupScan: true, pageGroupScanRunId: "scan" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        let ok = false;
        try { ok = await pageSwitchActor(page, "pageGroupScan", "scan"); } catch (_) { ok = false; }
        try { await chrome.storage.local.set({ pageGroupScan: false, pageGroupScanRunId: "" }); } catch (_) { console.debug("[Auto vjp][page] bỏ qua lỗi:", _); }
        sendResponse({ ok: !!ok });
      })();
      return true;
    }
    return false;
  });

  backfillPageGroupKeywords().catch(() => {});

  (async () => {
    const stored = await chrome.storage.local.get([FLAG, STATE_KEY, CONFIG_KEY, "pageGroupJoinJoined", "pageGroupJoinSkipped", "pageGroupJoinKeywordIndex", "pageGroupJoinKeywordDone", "pageGroupJoinNextAt", "pageGroupJoinAttemptedKeys"]);
    const state = stored[STATE_KEY];
    const config = stored[CONFIG_KEY] || state?.config;
    if (!stored[FLAG] || !config || !config.page || !(await owns(state?.runId, state?.ownerTabId))) return;
    if (config.keywordIndex === undefined && stored.pageGroupJoinKeywordIndex !== undefined) config.keywordIndex = stored.pageGroupJoinKeywordIndex;
    // Thứ tự tin cậy: STATE (ghi mỗi tiến triển) > mảng của chính config >
    // key riêng (chỉ dùng khi cả hai trên đều thiếu — key riêng có thể là số
    // sót của lượt cũ nếu bên gọi Start quên reset).
    if (Array.isArray(state?.keywordDone)) config.keywordDone = state.keywordDone;
    else if (!Array.isArray(config.keywordDone)) config.keywordDone = Array.isArray(stored.pageGroupJoinKeywordDone) ? stored.pageGroupJoinKeywordDone : [];
    if (typeof config.keywordIndex !== "number" && typeof stored.pageGroupJoinKeywordIndex === "number") config.keywordIndex = stored.pageGroupJoinKeywordIndex;
    applyConfig(config);
    currentRunId = String(state?.runId || config.runId || "");
    joined = Math.max(0, parseInt(stored.pageGroupJoinJoined ?? state?.joined) || 0);
    skipped = Math.max(0, parseInt(stored.pageGroupJoinSkipped ?? state?.skipped) || 0);
    nextAllowedAt = Math.max(0, parseInt(stored.pageGroupJoinNextAt ?? state?.nextAllowedAt) || 0);
    attempted = new Set(Array.isArray(stored.pageGroupJoinAttemptedKeys || state?.attemptedKeys) ? (stored.pageGroupJoinAttemptedKeys || state.attemptedKeys) : []);
    await sleep(1500);
    if (!routeMatches(currentConfig)) { location.replace(routeUrl(currentConfig)); return; }
    joinLoop(currentRunId, true);
  })();

  (async () => {
    try {
      const stored = await chrome.storage.local.get([
        PAGE_POST_FLAG, "pageGroupPostConfig", "pageGroupPostRunId", "pageGroupPostDone", "pageGroupPostSkipped", "pageGroupPostIndex",
        PAGE_NEWS_FLAG, "pageNewsWallConfig", "pageNewsWallActiveRunId", "pageNewsWallDone", "pageNewsWallSkipped", "pageNewsWallIndex",
        PAGE_COMMENT_FLAG, "pageCommentConfig", "pageCommentRunId", "pageCommentDone", "pageCommentPageIndex",
        PAGE_SALES_FLAG, "pageSalesPostConfig", "pageSalesPostRunId", "pageSalesPostDone", "pageSalesPostSkipped", "pageSalesPostIndex",
        PAGE_GROUP_COMMENT_FLAG, "pageGroupCommentConfig", "pageGroupCommentRunId", "pageGroupCommentDone", "pageGroupCommentSkipped", "pageGroupCommentIndex"
      ]);
      if (stored[PAGE_POST_FLAG] && stored.pageGroupPostConfig && await owns(stored.pageGroupPostRunId, stored.pageGroupPostConfig.ownerTabId)) {
        pagePostRunId = String(stored.pageGroupPostRunId || stored.pageGroupPostConfig.runId || "");
        pagePostConfig = { ...stored.pageGroupPostConfig, done: stored.pageGroupPostDone || 0, skipped: stored.pageGroupPostSkipped || 0, index: stored.pageGroupPostIndex || 0 };
        await sleep(1200); pageGroupPostLoop(pagePostRunId);
        return;
      }
      if (stored[PAGE_NEWS_FLAG] && stored.pageNewsWallConfig && await owns(stored.pageNewsWallActiveRunId, stored.pageNewsWallConfig.ownerTabId)) {
        pageNewsRunId = String(stored.pageNewsWallActiveRunId || stored.pageNewsWallConfig.runId || "");
        pageNewsConfig = { ...stored.pageNewsWallConfig, done: stored.pageNewsWallDone || 0, skipped: stored.pageNewsWallSkipped || 0, index: stored.pageNewsWallIndex || 0 };
        await sleep(1200);
        if (!pageNewsRouteMatches(pageNewsConfig.page)) { if (pageNewsConfig.page?.url) location.replace(pageNewsConfig.page.url); return; }
        pageNewsWallLoop(pageNewsRunId);
        return;
      }
      if (stored[PAGE_COMMENT_FLAG] && stored.pageCommentConfig) {
        if (await owns(stored.pageCommentRunId, stored.pageCommentConfig.ownerTabId)) {
          pageCommentRunId = String(stored.pageCommentRunId || stored.pageCommentConfig.runId || "");
          pageCommentConfig = { ...stored.pageCommentConfig, done: stored.pageCommentDone || 0, pageIndex: stored.pageCommentPageIndex || 0 };
          await sleep(1200); pageCommentLoop(pageCommentRunId);
          return;
        }
        // Không giữ cờ chạy vô hạn nếu run cũ thuộc tab đã mất/reload sang
        // tab khác. Popup phải có thể Start lại ngay, thay vì báo "đang chạy"
        // nhưng không còn content script nào sở hữu run.
        await chrome.storage.local.set({ [PAGE_COMMENT_FLAG]: false, pageCommentStatus: t("pgc.stopped") });
      }
      if (stored[PAGE_SALES_FLAG] && stored.pageSalesPostConfig && await owns(stored.pageSalesPostRunId, stored.pageSalesPostConfig.ownerTabId)) {
        pageSalesRunId = String(stored.pageSalesPostRunId || stored.pageSalesPostConfig.runId || "");
        pageSalesConfig = { ...stored.pageSalesPostConfig, done: stored.pageSalesPostDone || 0, skipped: stored.pageSalesPostSkipped || 0, index: stored.pageSalesPostIndex || 0 };
        await sleep(1200); pageSalesLoop(pageSalesRunId);
        return;
      }
      if (stored[PAGE_GROUP_COMMENT_FLAG] && stored.pageGroupCommentConfig && await owns(stored.pageGroupCommentRunId, stored.pageGroupCommentConfig.ownerTabId)) {
        pageGroupCommentRunId = String(stored.pageGroupCommentRunId || stored.pageGroupCommentConfig.runId || "");
        pageGroupCommentConfig = { ...stored.pageGroupCommentConfig, done: stored.pageGroupCommentDone || 0, skipped: stored.pageGroupCommentSkipped || 0, index: stored.pageGroupCommentIndex || 0 };
        await sleep(1200); pageGroupCommentLoop(pageGroupCommentRunId);
      }
    } catch (error) { console.warn("[Page] resume feature failed", error); }
  })();

  console.log("[Page] page.js loaded");
})();
