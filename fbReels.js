// fbReels.js — Đăng Reels Facebook cho nick cá nhân. State machine RIÊNG
// (fbReels*), không dùng chung selector/counter/proof của news.js, feed.js hay sales.js.
// Tự chứa utils để không coupling chéo file (theo tiền lệ news.js/page.js).
(() => {
  const FLAG = "fbReelsActive";
  const CONFIG_KEY = "fbReelsConfig";
  const RUN_KEY = "fbReelsRunId";
  const DONE_KEY = "fbReelsDone";
  const SKIPPED_KEY = "fbReelsSkipped";
  const STATUS_KEY = "fbReelsStatus";
  const PHASE_KEY = "fbReelsPhase";
  const OWNER_KEY = "fbReelsOwnerTabId";
  const CROSS_KEY = "fbReelsCrossIg";
  const DOORS_KEY = "fbReelsDoorsTried";
  const DOOR_ACTIVE_KEY = "fbReelsDoorActive";
  const SURFACE_SINCE_KEY = "fbReelsSurfaceSince";

  let active = false;
  let runId = "";
  let config = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = v => String(v || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const visible = el => {
    if (!el?.isConnected) return false;
    try {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") return false;
    } catch (_) {}
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelOf = el => clean(el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title") || el?.value || "");

  async function live(id) {
    if (!active || (id && runId && id !== runId)) return false;
    try {
      const s = await chrome.storage.local.get([FLAG, RUN_KEY]);
      return !!s[FLAG] && (!id || !s[RUN_KEY] || s[RUN_KEY] === id);
    } catch (_) { return false; }
  }

  async function setStatus(text, extra = {}) {
    try { await chrome.storage.local.set({ [STATUS_KEY]: String(text || ""), ...extra }); } catch (_) {}
  }

  function sendMsg(msg) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(msg, res => resolve(chrome.runtime.lastError ? null : res));
      } catch (_) { resolve(null); }
    });
  }

  async function trustedClick(el) {
    if (!el || !visible(el)) return false;
    try { el.scrollIntoView({ block: "nearest" }); } catch (_) {}
    try { el.scrollIntoView({ block: "center" }); } catch (_) {}
    await sleep(300);
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    const res = await sendMsg({
      action: "trustedMouse",
      kind: "click",
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2)
    });
    if (res?.ok) return true;
    try { el.click(); return true; } catch (_) { return false; }
  }

  function isSessionExpired() {
    if (/\/login(?:\.php)?/i.test(location.pathname)) return true;
    if (document.querySelector('input[name="email"], #login_form, a[href*="/login/"]')) {
      const isHome = location.pathname === "/" || location.pathname === "/home.php";
      if (!isHome || !document.querySelector('[role="feed"], [role="main"], [aria-label*="Facebook"]')) {
        return true;
      }
    }
    return false;
  }

  async function fetchVideoFile(url, defaultName = "reel-video.mp4") {
    const raw = String(url || "").trim();
    if (!raw) return null;
    if (raw.startsWith("data:")) {
      try {
        const match = raw.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
        if (!match) return null;
        const mime = match[1] || "video/mp4";
        const binary = atob(match[2] || "");
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new File([bytes], defaultName, { type: mime, lastModified: Date.now() });
      } catch (_) { return null; }
    }
    // Dùng background SW fetch để tránh CORS và hỗ trợ file video lớn tới 100MB
    const res = await sendMsg({ action: "fbFetchMedia", url: raw, isReels: true, maxBytes: 100 * 1024 * 1024, timeoutMs: 90000 });
    if (res?.ok && res.dataUrl) {
      try {
        const blob = await (await fetch(res.dataUrl)).blob();
        return new File([blob], `reel-${Date.now()}.mp4`, { type: res.mime || blob.type || "video/mp4", lastModified: Date.now() });
      } catch (_) {}
    }
    // Fallback fetch trực tiếp
    try {
      const res2 = await fetch(raw);
      if (res2.ok) {
        const blob2 = await res2.blob();
        return new File([blob2], defaultName, { type: blob2.type || "video/mp4", lastModified: Date.now() });
      }
    } catch (_) {}
    return null;
  }

  function findReelFileInput(scope = document) {
    const inputs = [...scope.querySelectorAll('input[type="file"]')].filter(el => el?.isConnected);
    return inputs.find(el => /video/i.test(el.accept || "")) || inputs[0] || null;
  }

  function findCreateReelOpener() {
    const cands = [...document.querySelectorAll('a, [role="button"], button')].filter(visible);
    return cands.find(el => {
      const l = labelOf(el);
      const aria = clean(el.getAttribute("aria-label"));
      const href = el.getAttribute("href") || "";
      if (/\/reel\/create|\/reels\/create/i.test(href)) return true;
      return /^(?:tạo thước phim|tạo reel|create reel|tạo video ngắn)$/i.test(l) || /tạo thước phim|tạo reel|create reel/i.test(aria);
    }) || null;
  }

  function findReelCaptionInput(scope = document) {
    const cands = [...scope.querySelectorAll('div[contenteditable="true"], [role="textbox"], textarea, input[type="text"]')].filter(visible);
    return cands.find(el => {
      const ph = clean(el.getAttribute("placeholder") || el.getAttribute("aria-label") || "");
      return /mô tả|caption|describe|thước phim|reel/i.test(ph);
    }) || cands[0] || null;
  }

  function findNextStepButton(scope = document) {
    const btns = [...scope.querySelectorAll('[role="button"], button')].filter(visible);
    return btns.find(b => {
      if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
      const l = labelOf(b);
      return /^(?:tiếp|tiếp tục|next)$/i.test(l);
    }) || null;
  }

  function findReelPublishButton(scope = document) {
    const btns = [...scope.querySelectorAll('[role="button"], button')].filter(visible);
    return btns.find(b => {
      const l = labelOf(b);
      if (/^(?:đăng|chia sẻ|chia sẻ thước phim|publish|share|share reel)$/i.test(l)) return true;
      // Business Suite: nút đăng cuối của editor ghi "Chia sẻ ngay /
      // Share now" — chỉ nhận trên host business.facebook.com để không
      // nhầm với nút chia sẻ thường ở nơi khác.
      if (isBizSuite() && /^(?:chia sẻ ngay|share now)$/i.test(l)) return true;
      return false;
    }) || null;
  }

  // ── MỞ MÀN TẠO REEL (2.11.1): bộ DÒ CỬA đa ứng viên ─────────────────
  // Vì sao: URL /reel/create đã CHẾT cho nick cá nhân chuyên nghiệp —
  // bằng chứng live trên DOM thật 2026-11-05: trang báo "Trang này không
  // hiển thị / liên kết đã hỏng hoặc bị gỡ", còn /reels/ chỉ là feed xem
  // reel của người khác (không nút tạo, không input file). Code lõi gốc
  // của fork cũng KHÔNG có đường tạo Reel nào để kế thừa (feed.js /
  // sales.js / news.js / share.js chỉ né reel khi tương tác). Thay bước
  // mở màn cũ bằng bộ dò cửa thử lần lượt, cửa nào cho ra input nạp
  // video VỚI ngữ cảnh reel thật mới được dùng:
  //   1. create_menu   — nút Tạo (+) trên thanh điều hướng trang chủ ->
  //      mục Thước phim/Reel (Meta có ghi nhận cửa "Create > Reel").
  //   2. composer      — hộp thoại đăng bài trang chủ, CHỈ khi có tuỳ
  //      chọn Reel/Thước phim tường minh; tuyệt đối không nạp video vào
  //      composer bài viết thường (sẽ đăng nhầm dạng bài video).
  //   3. profile_reels — mục Reels trên trang cá nhân -> Tạo thước phim
  //      (hướng dẫn desktop của Meta: profile > Reels > Create reel).
  //   4. bizsuite      — Meta Business Suite (business.facebook.com):
  //      Create reel -> Add video; đường tạo reel desktop Meta chính
  //      thức hoá sau khi Creator Studio bị đóng.
  // Mục/nút nào trỏ thẳng về /reel/create thì bỏ qua ngay (đích đã chết).
  // Trạng thái dò (cửa đã thử, cửa đang mở dở, mốc bắt đầu pha) lưu
  // storage.local để sống qua điều hướng trang; resume (đã nới cho mọi
  // subdomain facebook.com) gọi lại postReel và bộ dò đi tiếp.
  const SURFACE_BUDGET_MS = 240000; // tổng ngân sách pha mở màn, >> mức tối thiểu 60s vì headless nạp chậm
  const REEL_WORD = /thước phim|reel/i;
  const DEAD_PAGE = /trang này không hiển thị|trang này hiện không khả dụng|liên kết[^.]{0,40}(?:hỏng|bị gỡ)|content isn't available|this page isn't available|this content isn't available/i;

  const isBizSuite = () => /(^|\.)business\.facebook\.com$/i.test(location.hostname);
  const onHome = () => !isBizSuite() && (location.pathname === "/" || location.pathname === "/home.php");
  const isDeadReelHref = el => /\/reel\/create(?:[/?#]|$)/i.test(el?.getAttribute?.("href") || "");

  function isDeadPage() {
    try { return DEAD_PAGE.test(clean(document.body?.innerText || "").slice(0, 2500)); } catch (_) { return false; }
  }

  async function getDoorState() {
    try {
      const s = await chrome.storage.local.get([DOORS_KEY, DOOR_ACTIVE_KEY, SURFACE_SINCE_KEY]);
      return {
        tried: Array.isArray(s[DOORS_KEY]) ? s[DOORS_KEY] : [],
        activeDoor: String(s[DOOR_ACTIVE_KEY] || ""),
        since: Number(s[SURFACE_SINCE_KEY]) || 0
      };
    } catch (_) { return { tried: [], activeDoor: "", since: 0 }; }
  }

  async function markDoorTried(door) {
    const cur = await getDoorState();
    try {
      await chrome.storage.local.set({
        [DOORS_KEY]: [...new Set([...cur.tried, door])],
        [DOOR_ACTIVE_KEY]: ""
      });
    } catch (_) {}
  }

  // Input nạp video chỉ được tin khi có ngữ cảnh Reel thật: đang đứng ở
  // cửa đã chủ động mở (activeDoor), host Business Suite (editor của
  // chính Suite), URL chứa reel, hoặc dialog/tổ tiên của input nhắc tới
  // thước phim/reel. Chặn nhận nhầm input Ảnh/video của composer thường.
  function reelContextOk(input, doorActive) {
    if (!input) return false;
    if (doorActive) return true;
    if (isBizSuite()) return true;
    if (/reel/i.test(location.pathname)) return true;
    let node = input;
    for (let depth = 0; depth < 7 && node; depth++) {
      const txt = clean(node.innerText || node.textContent || "");
      if (txt && txt.length <= 4000 && REEL_WORD.test(txt)) return true;
      node = node.parentElement;
    }
    const dlg = input.closest?.('[role="dialog"]');
    if (dlg && REEL_WORD.test(clean(dlg.innerText || ""))) return true;
    return false;
  }

  function findReelSurfaceInput(doorActive) {
    const input = findReelFileInput();
    return reelContextOk(input, doorActive) ? input : null;
  }

  // Nút "mời nạp video" trong editor (Business Suite / dialog tạo reel):
  // vài editor chỉ mount input sau cú bấm này (input thường đã có sẵn
  // trong DOM dạng ẩn — findReelFileInput vẫn thấy, đây là dự phòng).
  function findUploadInviteButton(scope = document) {
    const btns = [...scope.querySelectorAll('[role="button"], button')].filter(visible);
    return btns.find(b => /^(?:thêm video|add video|tải video lên|upload video|chọn video|select video|tải lên|upload)$/i.test(labelOf(b))) || null;
  }

  // Chờ bề mặt tạo reel ngay trong trang hiện tại. Trang chết -> dừng sớm.
  async function waitSurfaceInPage(id, doorActive, budgetMs) {
    const end = Date.now() + budgetMs;
    let inviteClicked = false;
    while (Date.now() < end) {
      if (!(await live(id))) return { stopped: true };
      if (isDeadPage()) return { dead: true };
      const input = findReelSurfaceInput(doorActive);
      if (input) return { input };
      if (!inviteClicked) {
        const invite = findUploadInviteButton();
        if (invite) { inviteClicked = true; await trustedClick(invite); await sleep(1200); continue; }
      }
      await sleep(600);
    }
    return {};
  }

  function findNavCreateButton() {
    const cands = [...document.querySelectorAll('[role="button"], button, a')].filter(visible);
    return cands.find(el => {
      if (!el.hasAttribute("aria-haspopup")) return false;
      return /^(?:tạo|create)$/i.test(clean(el.getAttribute("aria-label") || ""));
    }) || null;
  }

  // Mục nhắc tới Reel CHỈ trong menu/dialog vừa mở (tránh bắt nhầm lối
  // tắt "Reels" ở cột trái trang chủ — lối đó dẫn vào feed xem).
  function findMenuReelItem() {
    const scopes = [...document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')].filter(visible);
    for (const scope of scopes) {
      const item = [...scope.querySelectorAll('a, [role="button"], [role="menuitem"], button')].filter(visible)
        .find(el => REEL_WORD.test(labelOf(el)) || REEL_WORD.test(clean(el.getAttribute("aria-label") || "")));
      if (item) return item;
    }
    return null;
  }

  async function stageCreateMenu(id) {
    try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: "create_menu" }); } catch (_) {}
    await setStatus("Đang mở menu Tạo để tìm mục Thước phim...");
    const opener = findNavCreateButton();
    if (!opener) return {};
    await trustedClick(opener);
    await sleep(1400);
    if (!(await live(id))) return { stopped: true };
    const item = findMenuReelItem();
    if (!item) {
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); } catch (_) {}
      return {};
    }
    if (isDeadReelHref(item)) return {}; // mục trỏ thẳng /reel/create (đã chết) — không bấm
    await trustedClick(item);
    await sleep(1500);
    const r = await waitSurfaceInPage(id, "create_menu", 25000);
    if (r.input) return { input: r.input };
    if (r.stopped) return { stopped: true };
    if (r.dead) { await markDoorTried("create_menu"); location.href = "https://www.facebook.com/"; return { navigated: true }; }
    return {};
  }

  function findComposerOpener() {
    const cands = [...document.querySelectorAll('[role="button"], div[role="textbox"]')].filter(visible);
    return cands.find(el => /bạn đang nghĩ gì|what's on your mind/i.test(labelOf(el))) || null;
  }

  function findComposerDialog() {
    return [...document.querySelectorAll('[role="dialog"]')].filter(visible)
      .find(d => d.querySelector('[contenteditable="true"], [role="textbox"]')) || null;
  }

  function findReelOptionIn(scope) {
    const cands = [...scope.querySelectorAll('[role="button"], button, a, [role="menuitem"], li')].filter(visible);
    return cands.find(el => REEL_WORD.test(labelOf(el)) || REEL_WORD.test(clean(el.getAttribute("aria-label") || ""))) || null;
  }

  async function stageComposer(id) {
    try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: "composer" }); } catch (_) {}
    await setStatus("Đang mở hộp thoại đăng bài để tìm tuỳ chọn Thước phim...");
    const opener = findComposerOpener();
    if (!opener) return {};
    await trustedClick(opener);
    await sleep(1600);
    let dlg = null;
    for (let i = 0; i < 10 && !dlg; i++) {
      if (!(await live(id))) return { stopped: true };
      dlg = findComposerDialog();
      if (!dlg) await sleep(600);
    }
    if (!dlg) return {};
    let opt = findReelOptionIn(dlg);
    if (!opt) {
      // Mở rộng hàng "Thêm vào bài viết" nếu tuỳ chọn đang thu gọn
      const more = [...dlg.querySelectorAll('[role="button"], button')].filter(visible)
        .find(el => /thêm vào bài viết|add to your post/i.test(labelOf(el)) || /thêm vào bài viết|add to your post/i.test(clean(el.getAttribute("aria-label") || "")));
      if (more) { await trustedClick(more); await sleep(1000); opt = findReelOptionIn(dlg); }
    }
    if (!opt || isDeadReelHref(opt)) { await closeTopPanel(); return {}; }
    await trustedClick(opt);
    await sleep(1500);
    const r = await waitSurfaceInPage(id, "composer", 25000);
    if (r.input) return { input: r.input };
    if (r.stopped) return { stopped: true };
    if (r.dead) { await markDoorTried("composer"); location.href = "https://www.facebook.com/"; return { navigated: true }; }
    return {};
  }

  function findProfileCreateTile() {
    const cands = [...document.querySelectorAll('a, [role="button"], button, [role="link"]')].filter(visible);
    return cands.find(el => {
      const l = labelOf(el);
      const aria = clean(el.getAttribute("aria-label") || "");
      return /tạo thước phim|tạo reel|create reel/i.test(l) || /tạo thước phim|tạo reel|create reel/i.test(aria)
        || /\/reels?\/create/i.test(el.getAttribute("href") || "");
    }) || null;
  }

  async function stageProfileReels(id) {
    try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: "profile_reels" }); } catch (_) {}
    await setStatus("Đang tìm nút Tạo thước phim trong mục Reels của trang cá nhân...");
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      if (!(await live(id))) return { stopped: true };
      if (isDeadPage()) { await markDoorTried("profile_reels"); location.href = "https://www.facebook.com/"; return { navigated: true }; }
      const input = findReelSurfaceInput("profile_reels");
      if (input) return { input };
      const opener = findCreateReelOpener() || findProfileCreateTile();
      if (opener) {
        if (isDeadReelHref(opener)) return {}; // chỉ có lối trỏ /reel/create (đã chết)
        await trustedClick(opener);
        await sleep(1500);
        const r = await waitSurfaceInPage(id, "profile_reels", 20000);
        if (r.input) return { input: r.input };
        if (r.stopped) return { stopped: true };
        if (r.dead) { await markDoorTried("profile_reels"); location.href = "https://www.facebook.com/"; return { navigated: true }; }
        return {};
      }
      await sleep(700);
    }
    return {};
  }

  function findBizCreateReel() {
    const cands = [...document.querySelectorAll('[role="button"], button, a, [role="menuitem"]')].filter(visible);
    const direct = cands.find(el => /tạo thước phim|create reel/i.test(labelOf(el)) || /tạo thước phim|create reel/i.test(clean(el.getAttribute("aria-label") || "")));
    if (direct) return { el: direct, direct: true };
    const create = cands.find(el => /^(?:tạo|create)$/i.test(labelOf(el)));
    return create ? { el: create, direct: false } : null;
  }

  // Màn chọn tài sản của Business Suite: chỉ tự chọn khi thẻ ghi đúng
  // tên nick cá nhân đã lưu (personalActorName) — không đoán mò.
  async function pickBizSuiteAsset() {
    try {
      const s = await chrome.storage.local.get(["personalActorName"]);
      const me = clean(s.personalActorName || "");
      if (!me) return null;
      const cards = [...document.querySelectorAll('[role="button"], button, a, li')].filter(visible);
      return cards.find(el => {
        const t = clean(el.innerText || el.textContent || "");
        return t && t.length <= 80 && t.toLowerCase().includes(me.toLowerCase());
      }) || null;
    } catch (_) { return null; }
  }

  // Chặn đăng nhầm Page: nếu mục "Đăng lên / Post to" của editor Suite
  // đọc được và trỏ vào một Page đã biết (managedPages) mà không phải
  // nick cá nhân đã lưu thì cửa này coi như hỏng.
  async function bizSuiteTargetLooksWrong() {
    try {
      const s = await chrome.storage.local.get(["managedPages", "personalActorName"]);
      const pages = Array.isArray(s.managedPages) ? s.managedPages : [];
      if (!pages.length) return false;
      const me = clean(s.personalActorName || "");
      const bodyTxt = clean(document.body?.innerText || "").slice(0, 6000);
      const m = bodyTxt.match(/(?:đăng lên|post to|share to|chia sẻ lên)\s*[:\-]?\s*([^\n]{2,60})/i);
      if (!m) return false;
      const target = clean(m[1]).toLowerCase();
      if (me && target.includes(me.toLowerCase())) return false;
      return pages.some(p => { const n = clean(p?.name || "").toLowerCase(); return !!n && target.includes(n); });
    } catch (_) { return false; }
  }

  async function stageBizSuite(id) {
    try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: "bizsuite" }); } catch (_) {}
    await setStatus("Đang tạo Reel qua Meta Business Suite (business.facebook.com)...");
    // Chờ khung Suite nạp (headless chậm) tối đa ~40s
    const shellEnd = Date.now() + 40000;
    let entry = null;
    while (Date.now() < shellEnd) {
      if (!(await live(id))) return { stopped: true };
      if (isDeadPage()) return {};
      entry = findBizCreateReel();
      if (entry) break;
      const assetCard = await pickBizSuiteAsset();
      if (assetCard) { await trustedClick(assetCard); await sleep(2500); continue; }
      await sleep(800);
    }
    if (!entry) return {};
    if (await bizSuiteTargetLooksWrong()) {
      await setStatus("Business Suite đang trỏ vào Page khác nick cá nhân — bỏ qua cửa này để tránh đăng nhầm");
      return {};
    }
    await trustedClick(entry.el);
    await sleep(1800);
    if (!entry.direct) {
      const item = findMenuReelItem();
      if (!item || isDeadReelHref(item)) return {};
      await trustedClick(item);
      await sleep(1800);
    }
    if (!(await live(id))) return { stopped: true };
    const r = await waitSurfaceInPage(id, "bizsuite", 60000);
    if (r.input) return { input: r.input };
    if (r.stopped) return { stopped: true };
    return {};
  }

  // Điều phối dò cửa. Trả { input } khi có bề mặt tạo reel dùng được;
  // { navigated } khi vừa điều hướng (resume sẽ gọi lại postReel);
  // { stopped } khi bị dừng; { fail } khi hết cửa / hết ngân sách.
  async function ensureReelCreateSurface(id) {
    let st = await getDoorState();
    if (!st.since) {
      st.since = Date.now();
      try { await chrome.storage.local.set({ [SURFACE_SINCE_KEY]: st.since }); } catch (_) {}
    }
    const stageDeadline = st.since + SURFACE_BUDGET_MS;

    // (0) Đã có sẵn bề mặt (vừa điều hướng thẳng vào editor)
    let input = findReelSurfaceInput(st.activeDoor);
    if (input) return { input };

    // (1) Trang chết: ghi nhận cửa vừa thử là hỏng, quay về trang chủ dò tiếp
    if (isDeadPage()) {
      const bad = st.activeDoor || (/\/reel\/create/i.test(location.pathname) ? "legacy" : "");
      if (bad) await markDoorTried(bad);
      await setStatus(`Cửa tạo Reel "${bad || "?"}" là trang chết — chuyển cửa khác...`);
      if (!onHome() && !isBizSuite()) { location.href = "https://www.facebook.com/"; return { navigated: true }; }
      st = await getDoorState();
    }

    // (2) Host Business Suite chỉ phục vụ cửa bizsuite
    if (isBizSuite()) {
      if (isDeadPage()) return { fail: true };
      const r = await stageBizSuite(id);
      if (r.input || r.navigated || r.stopped) return r;
      await markDoorTried("bizsuite");
      return { fail: true };
    }

    // (3) Chuỗi cửa trên www.facebook.com
    const order = ["create_menu", "composer", "profile_reels", "bizsuite"];
    for (const door of order) {
      if (Date.now() > stageDeadline) break;
      if (!(await live(id))) return { stopped: true };
      const cur = await getDoorState();
      if (cur.tried.includes(door)) continue;

      if (door === "create_menu" || door === "composer") {
        if (!onHome()) {
          try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: door }); } catch (_) {}
          location.href = "https://www.facebook.com/";
          return { navigated: true };
        }
        const r = door === "create_menu" ? await stageCreateMenu(id) : await stageComposer(id);
        if (r.input || r.navigated || r.stopped) return r;
        await markDoorTried(door);
        continue; // thử cửa tiếp theo ngay trong trang chủ
      }

      if (door === "profile_reels") {
        const onProfileReels = /\/reels\/?$/i.test(location.pathname);
        if (!onProfileReels) {
          try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: door }); } catch (_) {}
          await setStatus("Đang mở mục Reels trên trang cá nhân để tìm nút Tạo thước phim...");
          location.href = "https://www.facebook.com/me/reels";
          return { navigated: true };
        }
        const r = await stageProfileReels(id);
        if (r.input || r.navigated || r.stopped) return r;
        await markDoorTried(door);
        continue;
      }

      if (door === "bizsuite") {
        if (cur.activeDoor === "bizsuite") { await markDoorTried("bizsuite"); continue; } // vừa bị Suite đẩy về www — đừng vòng lại
        try { await chrome.storage.local.set({ [DOOR_ACTIVE_KEY]: door }); } catch (_) {}
        await setStatus("Đang mở Meta Business Suite để tạo Reel...");
        location.href = "https://business.facebook.com/";
        return { navigated: true };
      }
    }
    return { fail: true };
  }

  // ── ĐĂNG CHÉO SANG INSTAGRAM (tuỳ chọn crossIg, 2.11.0) ─────────────
  // Chỉ chạy khi config.crossIg bật. Tìm điều khiển đăng chéo của CHÍNH
  // Facebook trong editor / bước chia sẻ cuối (mục đối tượng & chia sẻ):
  // công tắc (switch/checkbox) hoặc hàng/nút chọn Instagram; nếu chưa
  // thấy thì mở thử cài đặt (bánh răng) 1 lần rồi quét lại. Kết cục:
  //   "enabled"       — đã bật VÀ xác minh được trạng thái bật
  //   "not_available" — không thấy điều khiển chéo (2 nick thường chưa
  //                     liên kết Accounts Center) -> vẫn đăng FB như thường
  //   "failed"        — thấy điều khiển nhưng bật/xác minh không được
  const CROSS_IG_WORD = /instagram/i;

  function crossIgContextText(el) {
    const own = clean(el?.getAttribute?.("aria-label") || "");
    if (CROSS_IG_WORD.test(own)) return own;
    if (el?.tagName === "INPUT" && el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) {
        const txt = clean(lab.innerText || lab.textContent || "");
        if (CROSS_IG_WORD.test(txt)) return txt;
      }
    }
    const wrapLabel = el?.closest?.("label");
    if (wrapLabel) {
      const txt = clean(wrapLabel.innerText || wrapLabel.textContent || "");
      if (CROSS_IG_WORD.test(txt)) return txt;
    }
    let node = el;
    for (let depth = 0; depth < 4 && node; depth++) {
      const txt = clean(node.innerText || node.textContent || "");
      if (txt && txt.length <= 220 && CROSS_IG_WORD.test(txt)) return txt;
      node = node.parentElement;
    }
    return "";
  }

  function toggleIsOn(el) {
    if (!el) return false;
    if (el.getAttribute?.("aria-checked") === "true") return true;
    if (el.getAttribute?.("aria-pressed") === "true") return true;
    if (el.tagName === "INPUT" && el.type === "checkbox") return !!el.checked;
    const innerBox = el.querySelector?.('input[type="checkbox"]');
    if (innerBox) return !!innerBox.checked;
    const innerSwitch = el.querySelector?.('[role="switch"]');
    if (innerSwitch && innerSwitch !== el) return toggleIsOn(innerSwitch);
    return false;
  }

  function findCrossIgControl() {
    // 1) Công tắc role=switch có ngữ cảnh nhắc tới Instagram
    const switches = [...document.querySelectorAll('[role="switch"]')].filter(el => el?.isConnected);
    for (const sw of switches) {
      if (crossIgContextText(sw)) return { el: sw, kind: "toggle" };
    }
    // 2) Checkbox nhắc tới Instagram (checkbox có thể ẩn -> bấm qua label)
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].filter(el => el?.isConnected);
    for (const box of boxes) {
      if (!crossIgContextText(box)) continue;
      let clickEl = box;
      if (!visible(box)) {
        const lab = (box.id && document.querySelector(`label[for="${CSS.escape(box.id)}"]`)) || box.closest("label");
        if (lab && visible(lab)) clickEl = lab;
      }
      return { el: box, clickEl, kind: "toggle" };
    }
    // 3) Hàng / nút chọn Instagram trong menu, panel cài đặt, mục chia sẻ
    const rows = [...document.querySelectorAll('[role="menuitem"], [role="option"], [role="button"], button, [role="listitem"], li')].filter(visible);
    for (const row of rows) {
      const l = labelOf(row);
      if (!l || l.length > 120 || !CROSS_IG_WORD.test(l)) continue;
      const href = row.getAttribute?.("href") || "";
      if (/instagram\.com/i.test(href)) continue; // link điều hướng thuần, không phải điều khiển chéo
      const innerToggle = row.querySelector('[role="switch"], input[type="checkbox"]');
      if (innerToggle) return { el: innerToggle, kind: "toggle" };
      return { el: row, kind: "button" };
    }
    return null;
  }

  function findShareSettingsButton() {
    const cands = [...document.querySelectorAll('[role="button"], button')].filter(visible);
    return cands.find(el => {
      const aria = clean(el.getAttribute("aria-label") || "");
      const l = labelOf(el);
      return /cài đặt tin|story settings|cài đặt thước phim|reel settings/i.test(aria)
        || /^(?:cài đặt|settings|tuỳ chọn|tùy chọn|tuỳ chọn khác|tùy chọn khác|more options|options)$/i.test(aria)
        || /^(?:cài đặt|settings)$/i.test(l);
    }) || null;
  }

  async function closeTopPanel() {
    const closer = [...document.querySelectorAll('[role="button"], button')].filter(visible)
      .find(el => /^(?:đóng|close)$/i.test(clean(el.getAttribute("aria-label") || "")) || /^(?:đóng|close)$/i.test(labelOf(el)));
    if (closer) { await trustedClick(closer); await sleep(500); return; }
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); } catch (_) {}
    await sleep(400);
  }

  async function tryEnableCrossIg(id) {
    const end = Date.now() + 20000; // chờ tối đa 20s theo yêu cầu
    let sawControl = false;
    let settingsTried = false;
    let openedSettings = false;
    const clickedButtons = new WeakSet();
    while (Date.now() < end) {
      if (!(await live(id))) return "failed";
      const ctrl = findCrossIgControl();
      if (ctrl) {
        sawControl = true;
        if (ctrl.kind === "toggle") {
          if (toggleIsOn(ctrl.el)) { if (openedSettings) await closeTopPanel(); return "enabled"; }
          await trustedClick(ctrl.clickEl || ctrl.el);
          await sleep(900);
          if (toggleIsOn(ctrl.el)) { if (openedSettings) await closeTopPanel(); return "enabled"; }
          if (!(await live(id))) return "failed";
          await trustedClick(ctrl.clickEl || ctrl.el);
          await sleep(900);
          if (toggleIsOn(ctrl.el)) { if (openedSettings) await closeTopPanel(); return "enabled"; }
          if (openedSettings) await closeTopPanel();
          return "failed";
        }
        // kind === "button": bấm chọn 1 lần duy nhất cho mỗi nút, rồi xác minh
        if (!clickedButtons.has(ctrl.el)) {
          clickedButtons.add(ctrl.el);
          await trustedClick(ctrl.el);
          await sleep(1000);
          if (toggleIsOn(ctrl.el)) { if (openedSettings) await closeTopPanel(); return "enabled"; }
          const after = findCrossIgControl();
          if (after && after.kind === "toggle") {
            if (toggleIsOn(after.el)) { if (openedSettings) await closeTopPanel(); return "enabled"; }
            await trustedClick(after.clickEl || after.el);
            await sleep(900);
            if (toggleIsOn(after.el)) { if (openedSettings) await closeTopPanel(); return "enabled"; }
            if (openedSettings) await closeTopPanel();
            return "failed";
          }
        }
        // Đã bấm mà chưa xác minh được trạng thái -> chờ quét tiếp tới hết giờ
      } else if (!settingsTried) {
        settingsTried = true;
        const gear = findShareSettingsButton();
        if (gear) {
          openedSettings = true;
          await trustedClick(gear);
          await sleep(1000);
          continue;
        }
      }
      await sleep(700);
    }
    if (openedSettings) await closeTopPanel();
    return sawControl ? "failed" : "not_available";
  }

  // PROOF: reel xuất hiện ở mục Reels/Video của profile (mở trang profile → tab Reels, tìm video mới nhất khớp thời gian)
  // trả URL reel nếu lấy được; không thấy sau 90s → fail fb_reels_proof_failed.
  async function proofReelPublished(id, deadlineMs = 90000) {
    const end = Date.now() + deadlineMs;
    await setStatus("Đang chờ xác minh Reel xuất hiện trên trang cá nhân...");

    // 1. Chờ modal tạo reel đóng
    for (let i = 0; i < 20; i++) {
      if (!(await live(id))) return { ok: false, error: "stopped" };
      if (!findReelPublishButton() && !location.pathname.startsWith("/reel/create")) break;
      await sleep(600);
    }

    // 2. Điều hướng tới tab Reels của trang cá nhân
    const reelsUrl = "https://www.facebook.com/me/reels";
    if (!location.pathname.includes("/reels")) {
      await setStatus("Đang mở trang cá nhân mục Reels để kiểm tra...");
      location.href = reelsUrl;
      await sleep(2500);
    }

    while (Date.now() < end) {
      if (!(await live(id))) return { ok: false, error: "stopped" };

      // Tìm các link reel trên trang profile
      const reelLinks = [...document.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]')].filter(visible);
      if (reelLinks.length) {
        // Xét video đầu tiên (mới nhất trên lưới/danh sách)
        const firstReel = reelLinks[0];
        const href = firstReel.getAttribute("href") || "";
        const m = href.match(/\/reel\/([0-9a-zA-Z_-]+)/i);
        const reelUrl = m ? `https://www.facebook.com/reel/${m[1]}` : (href.startsWith("http") ? href : `https://www.facebook.com${href}`);

        // Đọc text xung quanh hoặc trong thẻ container của reel để kiểm tra thời gian
        const container = firstReel.closest('[role="article"], div[data-pagelet*="Reel"], div') || firstReel;
        const cText = labelOf(container);
        const hasRecentTime = /\b(?:vừa xong|just now|1\s*(?:phút|min|m)|2\s*(?:phút|min|m)|3\s*(?:phút|min|m)|mới đây)\b/i.test(cText);

        // Nếu có dấu hiệu thời gian mới hoặc tìm thấy link reel hợp lệ trong danh sách mới
        if (hasRecentTime || reelUrl) {
          return { ok: true, url: reelUrl, at: Date.now() };
        }
      }

      await sleep(2000);
    }
    return { ok: false, error: "fb_reels_proof_failed" };
  }

  async function postReel(id) {
    const cfg = config || {};
    const videoUrl = String(cfg.videoUrl || cfg.url || "").trim();
    if (!videoUrl) {
      return { ok: false, code: "media_load_failed", message: "Thiếu URL video Reel (media_load_failed)" };
    }

    // 1. Kiểm tra session đăng nhập
    if (isSessionExpired()) {
      return { ok: false, code: "session_expired", message: "Chưa đăng nhập Facebook (session_expired)" };
    }

    // 2. Đảm bảo danh tính cá nhân qua personalActor — chỉ trên
    // www.facebook.com (bộ chọn danh tính sống ở đó). Ở Business Suite
    // danh tính do chính Suite quản qua mục Đăng lên; cửa bizsuite tự
    // kiểm tra đích đăng (bizSuiteTargetLooksWrong).
    try {
      if (!isBizSuite() && window.ensurePersonalActor) {
        const actor = await window.ensurePersonalActor();
        if (!actor.ok) {
          return { ok: false, code: "actor_not_personal", message: "Facebook đang dùng Page, không đăng Reel nick cá nhân" };
        }
        if (actor.switched) {
          location.replace("https://www.facebook.com/");
          return { ok: false, code: "navigated" };
        }
      }
    } catch (_) {}

    if (!(await live(id))) return { ok: false, code: "stopped" };

    // 3+4. Mở màn tạo Reel bằng bộ dò cửa đa ứng viên (2.11.1) và lấy
    // input nạp video từ bề mặt đã xác minh ngữ cảnh reel.
    await setStatus("Đang mở màn hình tạo Reel...");
    const surface = await ensureReelCreateSurface(id);
    if (surface.stopped) return { ok: false, code: "stopped" };
    if (surface.navigated) return { ok: false, code: "navigated" };
    if (!surface.input) {
      const st = await getDoorState().catch(() => ({ tried: [] }));
      return {
        ok: false, code: "reel_create_not_found",
        message: `Không mở được màn tạo Reel — đã thử các cửa: ${(st.tried || []).join(", ") || "—"} (reel_create_not_found)`
      };
    }
    const fileInput = surface.input;

    // 5. Tải video từ URL config
    await setStatus("Đang tải file video Reels từ URL...");
    const videoFile = await fetchVideoFile(videoUrl);
    if (!videoFile) {
      return { ok: false, code: "media_load_failed", message: `Không tải được file video từ URL: ${videoUrl} (media_load_failed)` };
    }
    if (!(await live(id))) return { ok: false, code: "stopped" };

    // 6. Nạp video vào input qua DataTransfer
    try {
      const dt = new DataTransfer();
      dt.items.add(videoFile);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) {
      return { ok: false, code: "media_load_failed", message: `Lỗi nạp video vào trình tạo Reel: ${e?.message || e} (media_load_failed)` };
    }

    // 7. Chờ video nạp và nút Tiếp / editor sẵn sàng
    await setStatus("Đang nạp video vào trình tạo Reel...");
    let nextBtn = null, captionEd = null;
    const waitEditorEnd = Date.now() + 45000;
    while (Date.now() < waitEditorEnd) {
      if (!(await live(id))) return { ok: false, code: "stopped" };
      nextBtn = findNextStepButton();
      captionEd = findReelCaptionInput();
      if (nextBtn || captionEd) break;
      await sleep(600);
    }
    if (!nextBtn && !captionEd) {
      return { ok: false, code: "reel_editor_not_ready", message: "Trình tạo Reel không sẵn sàng sau khi nạp video (reel_editor_not_ready)" };
    }

    // 8. Chuẩn bị Caption (với AI nếu bật)
    let captionText = clean(cfg.content || cfg.caption || "");
    if (cfg.aiEnabled) {
      await setStatus("AI đang viết caption cho Reel từ prompt và chất liệu...");
      try {
        const aiRes = await sendMsg({
          action: "aiGenerateReelsCaption",
          prompt: cfg.aiPrompt || "",
          content: captionText,
          aiConfig: cfg.aiConfig || {}
        });
        if (aiRes?.ok && aiRes.caption) {
          captionText = clean(aiRes.caption);
        }
      } catch (_) {}
    }

    // 9. Đi qua các bước wizard (Tải lên -> Chỉnh sửa -> Mô tả & Đăng)
    for (let step = 0; step < 4; step++) {
      if (!(await live(id))) return { ok: false, code: "stopped" };
      captionEd = findReelCaptionInput();
      if (captionEd) break;
      nextBtn = findNextStepButton();
      if (nextBtn) {
        await setStatus(`Đang chuyển bước trình tạo Reel (bước ${step + 1})...`);
        await trustedClick(nextBtn);
        await sleep(1200);
      } else {
        break;
      }
    }

    // 10. Điền caption vào ô mô tả
    captionEd = findReelCaptionInput();
    if (captionEd && captionText) {
      await setStatus("Đang nhập mô tả / caption cho Reel...");
      try {
        captionEd.focus();
        await sleep(250);
        const typed = await sendMsg({ action: "trustedInput", text: captionText, pressEnter: false });
        if (!typed?.ok) {
          document.execCommand("insertText", false, captionText);
          captionEd.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await sleep(600);
      } catch (_) {}
    }
    if (!(await live(id))) return { ok: false, code: "stopped" };

    // 11. Tìm và bấm nút Chia sẻ / Đăng Reel
    let publishBtn = null;
    const waitPublishEnd = Date.now() + 120000; // Có thể cần chờ video render/upload xong
    while (Date.now() < waitPublishEnd) {
      if (!(await live(id))) return { ok: false, code: "stopped" };
      publishBtn = findReelPublishButton();
      if (publishBtn && !publishBtn.disabled && publishBtn.getAttribute("aria-disabled") !== "true") break;
      // Nếu còn nút Tiếp ở bước cuối, bấm tiếp
      const furtherNext = findNextStepButton();
      if (furtherNext) {
        await trustedClick(furtherNext);
        await sleep(1000);
      } else {
        await setStatus("Đang chờ video Reels tải lên hoàn tất...");
        await sleep(1500);
      }
    }

    publishBtn = findReelPublishButton();
    if (!publishBtn || publishBtn.disabled || publishBtn.getAttribute("aria-disabled") === "true") {
      return { ok: false, code: "reel_publish_button_disabled", message: "Nút Đăng Reel không khả dụng sau thời gian chờ tải lên" };
    }

    // 11b. Đăng chéo sang Instagram (chỉ khi config.crossIg bật): tìm
    // điều khiển chéo của chính Facebook ở bước chia sẻ cuối TRƯỚC cú
    // bấm Đăng. Không có điều khiển (nick chưa liên kết Accounts Center)
    // thì vẫn đăng FB bình thường — đúng nghĩa "nếu có".
    let crossIg = "";
    if (cfg.crossIg) {
      await setStatus("Đang tìm tuỳ chọn đăng chéo sang Instagram...");
      crossIg = await tryEnableCrossIg(id);
      try { await chrome.storage.local.set({ [CROSS_KEY]: crossIg }); } catch (_) {}
      if (crossIg === "enabled") {
        await setStatus("Đã bật đăng chéo sang Instagram (cross_ig: enabled)");
      } else if (crossIg === "not_available") {
        await setStatus("Không thấy tuỳ chọn đăng chéo IG — 2 nick có thể chưa liên kết Accounts Center (cross_ig: not_available), vẫn đăng FB bình thường");
      } else {
        await setStatus("Không bật được đăng chéo IG (cross_ig: failed), vẫn đăng FB bình thường");
      }
      if (!(await live(id))) return { ok: false, code: "stopped" };
      // Panel cài đặt (nếu vừa mở) có thể đã che/thay nút Đăng — tìm lại nút
      publishBtn = findReelPublishButton();
      if (!publishBtn || publishBtn.disabled || publishBtn.getAttribute("aria-disabled") === "true") {
        return { ok: false, code: "reel_publish_button_disabled", message: "Nút Đăng Reel không khả dụng sau bước đăng chéo" };
      }
    }

    await setStatus("Đang bấm Chia sẻ Reel...");
    if (!(await trustedClick(publishBtn))) {
      return { ok: false, code: "reel_publish_click_failed", message: "Không bấm được nút Chia sẻ Reel" };
    }

    // Ghi phase sang proof trước khi trang có thể chuyển đổi
    try {
      await chrome.storage.local.set({ [PHASE_KEY]: "proving", fbReelsProvingAt: Date.now() });
    } catch (_) {}

    // 12. PROOF thật: mở trang cá nhân tab Reels, tìm video mới nhất khớp thời gian
    const proofRes = await proofReelPublished(id, 90000);
    try { await chrome.storage.local.remove([PHASE_KEY]); } catch (_) {}
    if (!proofRes.ok) {
      return { ok: false, code: proofRes.error || "fb_reels_proof_failed", message: "Không thấy Reel xuất hiện trên trang cá nhân sau 90s (fb_reels_proof_failed)" };
    }

    return { ok: true, url: proofRes.url || "", at: proofRes.at || Date.now(), crossIg };
  }

  async function finalizeReelsRun(res) {
    if (res.ok) {
      await chrome.storage.local.set({
        [DONE_KEY]: 1,
        [SKIPPED_KEY]: 0,
        fbReelsLastUrl: res.url || "",
        fbReelsLastAt: Date.now()
      });
      const crossNote = res.crossIg === "enabled" ? " (đã bật chéo IG)" : res.crossIg ? ` (cross_ig: ${res.crossIg})` : "";
      await setStatus(`Đã đăng Reels thành công: ${res.url || "mới nhất"}${crossNote} (${new Date().toLocaleTimeString("vi-VN")})`);
    } else {
      await chrome.storage.local.set({ [DONE_KEY]: 0, [SKIPPED_KEY]: 1 });
      await setStatus(`Thất bại: ${res.message || res.code}`);
    }
    active = false;
    await chrome.storage.local.set({ [FLAG]: false });
  }

  async function fbReelsLoop(id) {
    try {
      if (!(await live(id))) return;
      const res = await postReel(id);

      if (res.code === "navigated") return; // Sẽ resume sau khi reload
      if (res.code === "stopped" || !(await live(id))) return;

      await finalizeReelsRun(res);
    } catch (e) {
      console.warn("[fbReels]", e);
      active = false;
      try {
        await chrome.storage.local.set({ [FLAG]: false, [STATUS_KEY]: `Lỗi Reels: ${String(e?.message || e || "").slice(0, 150)}` });
      } catch (_) {}
    } finally {
      active = false;
    }
  }

  // Storage listener for stop flag
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[FLAG]?.newValue === false) {
      active = false;
      config = null;
    }
  });

  // Message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startFbReels") {
      if (active) {
        sendResponse({ ok: false, error: "Đang chạy đăng Reels" });
        return true;
      }
      config = { ...(message.config || {}) };
      runId = String(message.runId || config.runId || `fbreels-${Date.now()}`);
      active = true;
      chrome.storage.local.set({
        [FLAG]: true,
        [RUN_KEY]: runId,
        [OWNER_KEY]: message.ownerTabId || sender.tab?.id || 0,
        [CONFIG_KEY]: config,
        [DONE_KEY]: 0,
        [SKIPPED_KEY]: 0,
        [CROSS_KEY]: "",
        [DOORS_KEY]: [],
        [DOOR_ACTIVE_KEY]: "",
        [SURFACE_SINCE_KEY]: 0,
        [STATUS_KEY]: "Đang chuẩn bị đăng Reels..."
      }).then(() => fbReelsLoop(runId));
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === "stopFbReels") {
      active = false;
      config = null;
      chrome.storage.local.set({ [FLAG]: false, [STATUS_KEY]: "Đã dừng đăng Reels" });
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === "resetFbReels") {
      active = false;
      config = null;
      chrome.storage.local.set({ [FLAG]: false, [DONE_KEY]: 0, [SKIPPED_KEY]: 0, [STATUS_KEY]: "Đã reset đăng Reels" });
      chrome.storage.local.remove([CONFIG_KEY, PHASE_KEY, DOORS_KEY, DOOR_ACTIVE_KEY, SURFACE_SINCE_KEY]).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  // Resume khi reload — 2.11.1: nới cho MỌI subdomain facebook.com và
  // mọi đường dẫn (bản 2.10.0 chỉ khớp đúng trang gốc facebook.com/ nên
  // resume không bao giờ kích hoạt sau khi điều hướng sang trang tạo /
  // Business Suite / tab Reels của profile — luồng chết lặng ở đó).
  (async () => {
    try {
      if (!/^https:\/\/([^/]+\.)?facebook\.com\//i.test(location.href)) return;
      const s = await chrome.storage.local.get([FLAG, RUN_KEY, CONFIG_KEY, OWNER_KEY, PHASE_KEY]);
      if (!s[FLAG] || !s[CONFIG_KEY]) return;

      let ownerOk = true;
      try {
        const r = await new Promise(res => {
          try { chrome.runtime.sendMessage({ action: "getSenderTabId" }, x => res(chrome.runtime.lastError ? null : x)); }
          catch (_) { res(null); }
        });
        if (r?.tabId && s[OWNER_KEY] && r.tabId !== s[OWNER_KEY]) {
          // Business Suite có thể mở editor sang tab mới: chỉ riêng cửa
          // bizsuite (đang mở dở) được nhận tab hiện tại làm owner mới.
          const doorSt = await getDoorState();
          if (isBizSuite() && doorSt.activeDoor === "bizsuite") {
            try { await chrome.storage.local.set({ [OWNER_KEY]: r.tabId }); } catch (_) {}
          } else ownerOk = false;
        }
      } catch (_) {}
      if (!ownerOk) return;

      config = { ...s[CONFIG_KEY] };
      runId = String(s[RUN_KEY] || config.runId || `fbreels-${Date.now()}`);
      active = true;
      await sleep(1500);
      if (!active) return;

      // Đang ở pha proof mà trang vừa điều hướng (sang tab Reels của
      // profile / trong Business Suite) thì chạy tiếp proof, không đăng lại.
      if (s[PHASE_KEY] === "proving") {
        const proofRes = await proofReelPublished(runId, 90000);
        try { await chrome.storage.local.remove([PHASE_KEY]); } catch (_) {}
        if (proofRes.ok) {
          let crossIg = "";
          try { crossIg = String((await chrome.storage.local.get([CROSS_KEY]))[CROSS_KEY] || ""); } catch (_) {}
          await finalizeReelsRun({ ok: true, url: proofRes.url || "", at: proofRes.at || Date.now(), crossIg });
        } else if (proofRes.error === "stopped") {
          active = false;
        } else {
          await finalizeReelsRun({ ok: false, code: proofRes.error || "fb_reels_proof_failed", message: "Không thấy Reel xuất hiện trên trang cá nhân sau 90s (fb_reels_proof_failed)" });
        }
        return;
      }

      fbReelsLoop(runId);
    } catch (_) {}
  })();

  console.log("[fbReels] fbReels.js loaded");
})();
