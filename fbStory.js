// fbStory.js — Đăng Story Facebook cho nick cá nhân. State machine RIÊNG
// (fbStory*), không dùng chung selector/counter/proof của news.js, feed.js hay sales.js.
// Tự chứa utils để không coupling chéo file (theo tiền lệ news.js/page.js).
(() => {
  const FLAG = "fbStoryActive";
  const CONFIG_KEY = "fbStoryConfig";
  const RUN_KEY = "fbStoryRunId";
  const DONE_KEY = "fbStoryDone";
  const SKIPPED_KEY = "fbStorySkipped";
  const STATUS_KEY = "fbStoryStatus";
  const PHASE_KEY = "fbStoryPhase";
  const OWNER_KEY = "fbStoryOwnerTabId";
  const CROSS_KEY = "fbStoryCrossIg";
  const BASELINE_KEY = "fbStoryTrayBaseline";

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
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
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
    try { await chrome.storage.local.set({ [STATUS_KEY]: String(text || ""), ...extra }); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
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
    try { el.scrollIntoView({ block: "nearest" }); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
    try { el.scrollIntoView({ block: "center" }); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
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

  function parseMediaUrls(raw) {
    if (Array.isArray(raw)) return raw.map(u => String(u || "").trim()).filter(Boolean);
    return String(raw || "")
      .split(/[\r\n,]+/)
      .map(u => u.trim())
      .filter(Boolean);
  }

  async function fetchMediaFile(url, defaultName = "story-media.jpg") {
    const raw = String(url || "").trim();
    if (!raw) return null;
    if (raw.startsWith("data:")) {
      try {
        const match = raw.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
        if (!match) return null;
        const mime = match[1] || "image/jpeg";
        const binary = atob(match[2] || "");
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new File([bytes], defaultName, { type: mime, lastModified: Date.now() });
      } catch (_) { return null; }
    }
    // Dùng background SW fetch để không bị CORS trên domain facebook.com
    const res = await sendMsg({ action: "fbFetchMedia", url: raw, maxBytes: 50 * 1024 * 1024 });
    if (res?.ok && res.dataUrl) {
      try {
        const blob = await (await fetch(res.dataUrl)).blob();
        const ext = (res.mime || "").includes("video") ? "mp4" : "jpg";
        return new File([blob], `story-${Date.now()}.${ext}`, { type: res.mime || blob.type || "image/jpeg", lastModified: Date.now() });
      } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
    }
    // Fallback thử fetch trực tiếp phía content script
    try {
      const res2 = await fetch(raw);
      if (res2.ok) {
        const blob2 = await res2.blob();
        return new File([blob2], defaultName, { type: blob2.type || "image/jpeg", lastModified: Date.now() });
      }
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
    return null;
  }

  function findStoryFileInput(scope = document) {
    const inputs = [...scope.querySelectorAll('input[type="file"]')].filter(el => el?.isConnected);
    return inputs.find(el => /image|video|photo|media/i.test(el.accept || "")) || inputs[0] || null;
  }

  function findPhotoStoryCard() {
    const cands = [...document.querySelectorAll('[role="button"], button, div')].filter(visible);
    return cands.find(el => /^(?:tạo tin dạng ảnh|tạo tin ảnh|tạo tin|create a photo story|photo story)$/i.test(labelOf(el))) || null;
  }

  function findStoryTextTool() {
    const cands = [...document.querySelectorAll('[role="button"], button')].filter(visible);
    return cands.find(el => {
      const l = labelOf(el);
      const aria = clean(el.getAttribute("aria-label"));
      return /^(?:thêm văn bản|thêm chữ|add text|chữ|aa)$/i.test(l) || /thêm văn bản|add text|văn bản/i.test(aria);
    }) || null;
  }

  function findStoryShareButton() {
    const cands = [...document.querySelectorAll('[role="button"], button')].filter(visible);
    return cands.find(b => {
      if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
      const l = labelOf(b);
      return /^(?:chia sẻ lên tin|chia sẻ|share to story|share|đăng|post)$/i.test(l);
    }) || null;
  }

  // ── ĐĂNG CHÉO SANG INSTAGRAM (tuỳ chọn crossIg, 2.11.0) ─────────────
  // Chỉ chạy khi config.crossIg bật. Tìm điều khiển đăng chéo của CHÍNH
  // Facebook trong editor / màn chia sẻ: công tắc (switch/checkbox) hoặc
  // hàng/nút chọn Instagram; nếu chưa thấy thì mở thử cài đặt (bánh răng)
  // 1 lần rồi quét lại. Kết cục:
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
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
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

  // Chèn chữ vào editor story (best effort)
  async function insertStoryText(text, id) {
    if (!text) return true;
    const textTool = findStoryTextTool();
    if (!textTool) {
      await setStatus("Không tìm thấy công cụ Text story — tiếp tục đăng story trơn");
      return false;
    }
    if (!(await trustedClick(textTool))) {
      await setStatus("Không bấm được công cụ Text story — tiếp tục đăng story trơn");
      return false;
    }
    await sleep(600);
    // Tìm ô nhập văn bản story
    const end = Date.now() + 6000;
    let ed = null;
    while (Date.now() < end) {
      if (!(await live(id))) return false;
      ed = [...document.querySelectorAll('div[contenteditable="true"], [role="textbox"], textarea, input[type="text"]')].filter(visible)[0] || null;
      if (ed) break;
      await sleep(300);
    }
    if (!ed) {
      await setStatus("Ô nhập text story không xuất hiện — tiếp tục đăng story trơn");
      return false;
    }
    try {
      ed.focus();
      await sleep(200);
      const typed = await sendMsg({ action: "trustedInput", text, pressEnter: false });
      if (!typed?.ok) {
        document.execCommand("insertText", false, text);
        ed.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await sleep(500);
      // Bấm ra ngoài hoặc phím Escape để hoàn tất nhập chữ
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
      return true;
    } catch (_) {
      await setStatus("Lỗi khi nhập chữ story — tiếp tục đăng story trơn");
      return false;
    }
  }

  // ── BASELINE khay story (vá proof 2.11.2, #93) ───────────────────
  // Gốc rễ lỗi live 2.11.1: story ĐÃ đăng thật (màn "Đã đăng tin",
  // khay hiện "Tin của My Heart: 2 thẻ mới · 1 phút") nhưng proof cũ
  // timeout 60s — nó mở viewer rồi khớp chuỗi thời gian tươi, mà nick
  // đã có sẵn story trước đó trong ngày nên tổng là 2 thẻ và đường
  // viewer/thời gian không khớp. Cách vá: chụp BASELINE mục story
  // của chính actor trong khay TRƯỚC khi đăng (số thẻ "N thẻ mới" +
  // thời gian), lưu vào BASELINE_KEY theo runId. Proof đạt khi:
  //   (a) số thẻ của actor TĂNG so với baseline; hoặc
  //   (b) baseline không có mục của actor, sau đăng xuất hiện mục
  //       của actor với thời gian tươi (<= thời lượng phiên + 1 phút
  //       đệm); hoặc
  //   (c) đường viewer cũ khớp (giữ làm 1 ứng viên).
  // Không có thay đổi nào so với baseline -> proof FAIL thật, không
  // báo khống. Sau mỗi story proof xong, baseline được cập nhật sang
  // trạng thái vừa quan sát để story kế tiếp so đúng mốc mới.
  //
  // (2.11.3, #94) Test live 2.11.2: baseline chụp ở TRANG CHỦ thất
  // bại (captured:false) vì khay trang chủ render khác/nạp muộn; còn
  // cấu trúc ĐÃ CHỨNG MINH đọc được là TRANG DANH SÁCH TIN
  // (facebook.com/stories): các mẩu text rời "Tin của My Heart" /
  // "3 thẻ mới" / "· 1 phút". Cách vá:
  //   - captureTrayBaseline ĐIỀU HƯỚNG tới trang danh sách tin
  //     (href khay tin trên trang hiện tại, fallback /stories) chụp
  //     mốc ở đó TRƯỚC khi mở màn tạo story; điều hướng đi/về theo
  //     đúng khuôn resume-by-storage của module (guard resume đã
  //     nới cho mọi trang *.facebook.com như fbReels #92) nên quay
  //     lại đúng tab tính năng, không phá luồng tạo story.
  //   - readOwnStoryListItem: đọc innerText toàn trang danh sách,
  //     tìm đề mục của actor rồi trích số thẻ + tuổi trong cửa sổ
  //     ~80 ký tự ngay sau đề mục.
  //   - Baseline vẫn không chụp được (captured:false) thì proof
  //     chạy ĐƯỜNG ĐỘC LẬP-BASELINE trên trang danh sách: đạt khi
  //     mục của actor có tuổi <= thời lượng phiên + 2 phút (2.11.2
  //     thiếu đường này trên trang danh sách — check cũ trả null
  //     ngay khi pathname bắt đầu /stories/).
  function parseStoryAgeMinutes(text) {
    const t = String(text || "").toLowerCase();
    if (/\bvừa xong\b|\bjust now\b|\bmới đây\b/.test(t)) return 0;
    let m = /(\d+)\s*(?:phút|\bmin(?:ute)?s?\b)/.exec(t);
    if (m) return parseInt(m[1], 10);
    m = /(\d+)\s*(?:giờ|\bhours?\b)/.exec(t);
    if (m) return parseInt(m[1], 10) * 60;
    return null;
  }

  // Đọc mục story CỦA CHÍNH actor trong khay/danh sách tin đang hiển
  // thị. Nhận diện: text/aria bắt đầu bằng "Tin của <tên actor>" (tên
  // lấy từ personalActorName do ensurePersonalActor lưu) hoặc "Tin
  // của bạn" / "Your story". Lấy phần tử khớp có text NGẮN nhất (cụ
  // thể nhất, tránh container chứa cả khay). Trả null nếu không thấy.
  function readOwnStoryTrayItem(actorName) {
    const name = clean(actorName || "").toLowerCase();
    const els = [...document.querySelectorAll('[role="button"], a[href*="/stories/"], [role="link"]')].filter(visible);
    let best = null;
    for (const el of els) {
      const texts = [clean(el.getAttribute("aria-label") || ""), labelOf(el)];
      for (const t of texts) {
        if (!t || t.length > 200) continue;
        const low = t.toLowerCase();
        let own = false;
        if (/\byour story\b/.test(low)) own = true;
        else if (/^tin của\s+/.test(low)) {
          const rest = low.replace(/^tin của\s+/, "");
          if (rest.startsWith("bạn")) own = true;
          else if (name && rest.startsWith(name)) own = true;
        }
        if (!own) continue;
        if (!best || t.length < best.raw.length) best = { raw: t };
      }
    }
    if (!best) return null;
    const countM = /(\d+)\s*(?:thẻ mới|thẻ|new)\b/i.exec(best.raw);
    return {
      present: true,
      count: countM ? parseInt(countM[1], 10) : null,
      minutes: parseStoryAgeMinutes(best.raw),
      raw: best.raw.slice(0, 160)
    };
  }

  // ── TRANG DANH SÁCH TIN (#94): cấu trúc đã chứng minh đọc được ──
  // Trang danh sách là facebook.com/stories (pathname đúng /stories,
  // phân biệt với viewer /stories/<id>/... và editor /stories/create).
  function isStoriesListPage() {
    return /^\/stories\/?$/.test(location.pathname);
  }

  // URL trang danh sách tin: ưu tiên href khay tin tìm thấy trên
  // trang hiện tại (link trỏ đúng /stories), fallback URL chuẩn.
  function storiesListUrl() {
    const a = [...document.querySelectorAll('a[href*="/stories"]')]
      .find(el => {
        try { return /^\/stories\/?$/.test(new URL(el.href).pathname); }
        catch (_) { return false; }
      });
    return a ? a.href : "https://www.facebook.com/stories";
  }

  // Trang danh sách đã render chưa: có đề mục "Tin của ..." hoặc
  // mục "Tất cả tin" (All stories).
  function storiesListRendered() {
    const t = clean(document.body?.innerText || "").toLowerCase();
    return t.includes("tất cả tin") || t.includes("all stories") || /\btin của\s/.test(t);
  }

  // Đọc mục story của CHÍNH actor trên TRANG DANH SÁCH TIN bằng
  // innerText toàn trang: các mẩu text rời nhau ("Tin của My Heart"
  // / "3 thẻ mới" / "· 1 phút") nên element-reader của khay trang
  // chủ không bắt được. Tìm đề mục của actor (personalActorName,
  // hoặc "Tin của bạn" / "Your story"), rồi trong cửa sổ ~80 ký tự
  // ngay sau đề mục trích "N thẻ mới" + tuổi ("vừa xong" = 0,
  // "· N phút", "N giờ"). null khi không thấy đề mục của actor.
  function readOwnStoryListItem(actorName) {
    const text = clean(document.body?.innerText || "");
    if (!text) return null;
    const low = text.toLowerCase();
    const name = clean(actorName || "").toLowerCase();
    const headers = [];
    if (name) headers.push(`tin của ${name}`);
    headers.push("tin của bạn", "your story");
    let idx = -1;
    let hLen = 0;
    for (const h of headers) {
      const i = low.indexOf(h);
      if (i >= 0) { idx = i; hLen = h.length; break; }
    }
    if (idx < 0) return null;
    const win = text.slice(idx + hLen, idx + hLen + 80);
    const countM = /(\d+)\s*thẻ mới/i.exec(win);
    let minutes = null;
    if (/\bvừa xong\b|\bjust now\b/i.test(win)) minutes = 0;
    else {
      const minM = /(\d+)\s*phút/.exec(win);
      const hrM = /(\d+)\s*giờ/.exec(win);
      if (minM) minutes = parseInt(minM[1], 10);
      else if (hrM) minutes = parseInt(hrM[1], 10) * 60;
    }
    return {
      present: true,
      count: countM ? parseInt(countM[1], 10) : null,
      minutes,
      raw: clean(text.slice(idx, idx + hLen + 80)).slice(0, 160),
      via: "list"
    };
  }

  // Chụp baseline (idempotent theo runId) TRÊN TRANG DANH SÁCH TIN
  // (#94): mốc so proof phải lấy ở cấu trúc đã chứng minh đọc được,
  // không lấy ở khay trang chủ (2.11.2 chụp ở trang chủ -> captured:
  // false vì khay render khác/nạp muộn).
  //   - Chưa ở trang danh sách: điều hướng tới đó (href khay tin
  //     trên trang hiện tại, fallback /stories) và trả navStarted —
  //     caller dừng vòng hiện tại, resume (guard đã nới cho mọi
  //     trang *.facebook.com) vào lại đúng tab tính năng rồi chụp
  //     tiếp. Chụp xong caller mới sang /stories/create như cũ —
  //     luồng tạo story không đổi.
  //   - Đang ở trang danh sách: chờ tối đa 20s cho mục của actor
  //     xuất hiện (readOwnStoryListItem); danh sách đã render mà
  //     không có mục -> baseline absent (present:false). Hết 20s
  //     vẫn không đọc được -> giữ captured:false; proof còn đường
  //     độc lập-baseline, không kẹt ở bước này.
  async function captureTrayBaseline(id) {
    try {
      const s = await chrome.storage.local.get([BASELINE_KEY, "personalActorName"]);
      let rec = s[BASELINE_KEY];
      if (!rec || rec.runId !== id) {
        rec = { runId: id, startedAt: Date.now(), captured: false, stale: false };
      }
      if (rec.captured && !rec.stale) {
        await chrome.storage.local.set({ [BASELINE_KEY]: rec });
        return rec;
      }
      if (!isStoriesListPage()) {
        rec.navStarted = true;
        await chrome.storage.local.set({ [BASELINE_KEY]: rec });
        await setStatus("Đang mở trang danh sách tin để ghi mốc story hiện tại...");
        location.href = storiesListUrl();
        await sleep(3000); // chờ trang mới thay thế — resume chạy tiếp
        return rec;
      }
      delete rec.navStarted;
      const actorName = clean(s.personalActorName || "");
      const waitEnd = Date.now() + 20000;
      while (Date.now() < waitEnd) {
        if (!(await live(id))) break;
        const item = readOwnStoryListItem(actorName);
        if (item) {
          rec.captured = true;
          rec.stale = false;
          rec.present = true;
          rec.count = item.count;
          rec.minutes = item.minutes;
          rec.raw = item.raw;
          rec.capturedAt = Date.now();
          await chrome.storage.local.set({ [BASELINE_KEY]: rec });
          return rec;
        }
        if (storiesListRendered()) {
          rec.captured = true;
          rec.stale = false;
          rec.present = false;
          rec.count = 0;
          rec.minutes = null;
          rec.raw = "";
          rec.capturedAt = Date.now();
          await chrome.storage.local.set({ [BASELINE_KEY]: rec });
          return rec;
        }
        await sleep(1000);
      }
      await chrome.storage.local.set({ [BASELINE_KEY]: rec });
      return rec;
    } catch (_) { return null; }
  }

  // So mục story của actor với baseline — đường proof chính
  // (#93 + #94). Đọc ở trang đang đứng: TRANG DANH SÁCH TIN thì
  // dùng list-reader (innerText), các trang có khay (trang chủ)
  // thì dùng element-reader cũ; đang ở VIEWER story thì trả null
  // (nhánh viewer trong proof xử lý riêng). Trả { ok:true,
  // observed } khi đạt (a)/(b)/(độc lập); { observed } khi đọc
  // được mục nhưng chưa đạt; null khi không đọc được mục.
  // Baseline stale/chưa chụp được (captured:false — chỗ 2.11.2 bỏ
  // cuộc): ĐƯỜNG ĐỘC LẬP-BASELINE — đạt khi mục của actor có tuổi
  // <= thời lượng phiên + 2 phút. Story có từ trước phiên luôn già
  // hơn phiên nên không thể khớp khống.
  async function checkTrayAgainstBaseline(id) {
    if (location.pathname.startsWith("/stories/") && !isStoriesListPage()) return null;
    let rec = null;
    let actorName = "";
    try {
      const s = await chrome.storage.local.get([BASELINE_KEY, "personalActorName"]);
      rec = s[BASELINE_KEY];
      actorName = clean(s.personalActorName || "");
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
    const item = isStoriesListPage()
      ? readOwnStoryListItem(actorName)
      : readOwnStoryTrayItem(actorName);
    if (!item) return null;
    const startedAt = rec?.runId === id ? Number(rec.startedAt) || 0 : 0;
    const elapsedMin = startedAt
      ? Math.max(1, Math.ceil((Date.now() - startedAt) / 60000))
      : 1;
    const baseOk = !!(rec && rec.runId === id && rec.captured && !rec.stale);
    if (baseOk) {
      // (a) số thẻ TĂNG so với baseline
      if (rec.present && rec.count != null && item.count != null && item.count > rec.count) {
        return { ok: true, at: Date.now(), observed: item };
      }
      // (b) baseline không có mục của actor -> nay xuất hiện, thời gian tươi
      if (!rec.present && item.minutes != null && item.minutes <= elapsedMin + 1) {
        return { ok: true, at: Date.now(), observed: item };
      }
      return { observed: item };
    }
    // Độc lập-baseline (#94): không có mốc tin cậy thì xét tuổi
    // tuyệt đối của mục trên trang danh sách/khay hiện tại.
    if (item.minutes != null && item.minutes <= elapsedMin + 2) {
      return { ok: true, at: Date.now(), observed: item };
    }
    return { observed: item };
  }

  // Cập nhật baseline sau 1 story proof xong: có observed (đọc được
  // khay) thì mốc mới = observed; không có (proof qua viewer) thì
  // đánh dấu stale để story sau chụp lại thay vì so mốc cũ.
  async function refreshBaselineAfterProof(id, observed) {
    try {
      const s = await chrome.storage.local.get([BASELINE_KEY]);
      const rec = s[BASELINE_KEY];
      if (!rec || rec.runId !== id) return;
      if (observed) {
        rec.captured = true;
        rec.stale = false;
        rec.present = true;
        rec.count = observed.count;
        rec.minutes = observed.minutes;
        rec.raw = observed.raw;
        rec.capturedAt = Date.now();
      } else {
        rec.stale = true;
      }
      await chrome.storage.local.set({ [BASELINE_KEY]: rec });
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
  }

  // PROOF: so mục story với BASELINE chụp trước khi đăng trên
  // TRANG DANH SÁCH TIN (đường chính, kiểm tra mỗi ~5s, không phụ
  // thuộc mở viewer); baseline không chụp được thì đường độc lập-
  // baseline cũng trên trang danh sách (#94) + đường viewer cũ làm
  // ứng viên dự phòng. Ngân sách 60s.
  async function proofStoryPublished(id, deadlineMs = 60000) {
    const end = Date.now() + deadlineMs;
    await setStatus("Đang chờ xác minh story xuất hiện trong khay...");
    // 1. Nếu đang ở /stories/create, chờ editor đóng hoặc quay về trang chủ
    for (let i = 0; i < 20; i++) {
      if (!(await live(id))) return { ok: false, error: "stopped" };
      if (!findStoryShareButton() && !location.pathname.startsWith("/stories/create")) break;
      await sleep(500);
    }
    if (location.pathname.startsWith("/stories/create")) {
      // (#94) Về TRANG DANH SÁCH TIN thay vì trang chủ: đó là cấu
      // trúc proof đọc được đã chứng minh; khay trang chủ chỉ là
      // đường phụ khi FB tự đưa về đó.
      location.href = storiesListUrl();
      await sleep(2000);
    }

    let openedViewer = false;
    let lastTrayCheck = 0;
    let lastObserved = null;
    let listNavTried = false;
    const proofStart = Date.now();
    while (Date.now() < end) {
      if (!(await live(id))) return { ok: false, error: "stopped" };

      // (MỚI #93) Đường chính: so khay với baseline mỗi ~5s — đạt
      // (a)/(b) thì xong ngay, không phụ thuộc mở viewer thành công.
      if (Date.now() - lastTrayCheck >= 5000) {
        lastTrayCheck = Date.now();
        const trayRes = await checkTrayAgainstBaseline(id);
        if (trayRes?.observed) lastObserved = trayRes.observed;
        if (trayRes?.ok) {
          return { ok: true, at: trayRes.at || Date.now(), observed: trayRes.observed || lastObserved };
        }
      }

      // (#94) Quá 20s mà chưa đọc được mục nào và chưa ở trang danh
      // sách -> vào trang danh sách 1 lần để chạy đường độc lập-
      // baseline ở đó (kể cả khi baseline captured:false). Nếu điều
      // hướng là full reload thì phase "proving" đã lưu giúp vòng
      // lặp chính resume chạy tiếp proof thay vì đăng lại.
      if (!listNavTried && !lastObserved && !isStoriesListPage()
        && !location.pathname.startsWith("/stories/")
        && Date.now() - proofStart >= 20000) {
        listNavTried = true;
        location.href = storiesListUrl();
        await sleep(2000);
        continue;
      }

      // A. Nếu viewer story đang mở (/stories/... nhưng không phải
      // trang danh sách)
      if (location.pathname.startsWith("/stories/") && !isStoriesListPage()) {
        const viewerTexts = [...document.querySelectorAll('[role="dialog"], [role="main"], div')]
          .filter(visible)
          .map(el => labelOf(el))
          .filter(Boolean);
        const hasRecentTime = viewerTexts.some(t =>
          /\b(?:vừa xong|just now|1\s*(?:phút|min|m)|2\s*(?:phút|min|m)|3\s*(?:phút|min|m)|mới đây)\b/i.test(t)
        );
        const hasMedia = !!document.querySelector('[role="main"] img, [role="main"] video, [data-pagelet*="Story"] img, [data-pagelet*="Story"] video');
        if (hasRecentTime || (hasMedia && openedViewer)) {
          return { ok: true, at: Date.now(), observed: lastObserved };
        }
      }

      // B. Nếu đang ở trang chủ, tìm khay story của chính mình
      const storyCards = [...document.querySelectorAll('[role="button"], a[href*="/stories/"], div')]
        .filter(visible)
        .filter(el => {
          const l = labelOf(el).toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          return l.includes("tin của bạn") || l.includes("your story") || aria.includes("tin của bạn") || aria.includes("your story");
        });

      if (storyCards.length && !openedViewer) {
        const myCard = storyCards[0];
        // Kiểm tra xem thẻ story của mình có hiển thị thời gian mới hay không
        const cardText = labelOf(myCard);
        if (/\b(?:vừa xong|just now|1\s*(?:phút|min|m)|2\s*(?:phút|min|m)|mới đây)\b/i.test(cardText)) {
          return { ok: true, at: Date.now(), observed: lastObserved };
        }
        // Thử click vào thẻ story của mình để mở viewer
        await trustedClick(myCard);
        openedViewer = true;
        await sleep(1500);
        continue;
      }

      // C. Dự phòng: tìm avatar có viền story ở thanh điều hướng hoặc góc trái
      const selfAvatarStory = [...document.querySelectorAll('a[href*="/me/"], [aria-label*="Trang cá nhân của bạn"], [aria-label*="Your profile"]')].filter(visible)[0];
      if (selfAvatarStory && !openedViewer) {
        const ring = selfAvatarStory.querySelector('circle, svg, [style*="border"], [class*="ring"]');
        if (ring) {
          await trustedClick(selfAvatarStory);
          openedViewer = true;
          await sleep(1500);
          continue;
        }
      }

      await sleep(1500);
    }
    return { ok: false, error: "fb_story_proof_failed" };
  }

  async function postOneStory(mediaUrl, id, index, total) {
    const cfg = config || {};
    await setStatus(`[${index + 1}/${total}] Đang chuẩn bị đăng story...`);

    // 1. Kiểm tra session đăng nhập
    if (isSessionExpired()) {
      return { ok: false, code: "session_expired", message: "Chưa đăng nhập Facebook (session_expired)" };
    }

    // 2. Đảm bảo danh tính cá nhân qua personalActor
    try {
      if (window.ensurePersonalActor) {
        const actor = await window.ensurePersonalActor();
        if (!actor.ok) {
          return { ok: false, code: "actor_not_personal", message: "Facebook đang dùng Page, không đăng Story nick cá nhân" };
        }
        if (actor.switched) {
          location.replace("https://www.facebook.com/stories/create");
          return { ok: false, code: "navigated" };
        }
      }
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }

    if (!(await live(id))) return { ok: false, code: "stopped" };

    // 2b. Chụp BASELINE story TRƯỚC khi đăng (#93 + #94): mốc lấy
    // trên TRANG DANH SÁCH TIN và danh tính đã chốt ở bước 2 nên
    // personalActorName đã có trong storage. capture có thể điều
    // hướng sang trang danh sách -> dừng lượt này, resume chạy tiếp.
    const baseRec = await captureTrayBaseline(id);
    if (baseRec?.navStarted) return { ok: false, code: "navigated" };

    // 3. Mở màn tạo tin (stories/create)
    if (!location.pathname.startsWith("/stories/create")) {
      await setStatus(`[${index + 1}/${total}] Đang điều hướng tới màn Tạo tin...`);
      location.href = "https://www.facebook.com/stories/create";
      return { ok: false, code: "navigated" };
    }

    // 4. Chờ màn tạo tin sẵn sàng
    let fileInput = null;
    const waitCreateEnd = Date.now() + 30000;
    while (Date.now() < waitCreateEnd) {
      if (!(await live(id))) return { ok: false, code: "stopped" };
      fileInput = findStoryFileInput();
      if (fileInput) break;
      const photoCard = findPhotoStoryCard();
      if (photoCard) {
        await trustedClick(photoCard);
        await sleep(1000);
        fileInput = findStoryFileInput();
        if (fileInput) break;
      }
      await sleep(400);
    }
    if (!fileInput) {
      return { ok: false, code: "story_create_not_found", message: "Không tìm thấy màn tạo tin Facebook (story_create_not_found)" };
    }

    // 5. Tải file media từ URL config
    await setStatus(`[${index + 1}/${total}] Đang tải file media từ URL...`);
    const file = await fetchMediaFile(mediaUrl);
    if (!file) {
      return { ok: false, code: "media_load_failed", message: `Không tải được file media từ URL: ${mediaUrl} (media_load_failed)` };
    }
    if (!(await live(id))) return { ok: false, code: "stopped" };

    // 6. Nạp file vào input qua DataTransfer
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) {
      return { ok: false, code: "media_load_failed", message: `Lỗi nạp file vào editor: ${e?.message || e} (media_load_failed)` };
    }

    // 7. Chờ editor story nạp file thành công
    await setStatus(`[${index + 1}/${total}] Đang nạp media vào Story editor...`);
    let shareBtn = null;
    const waitEditorEnd = Date.now() + 30000;
    while (Date.now() < waitEditorEnd) {
      if (!(await live(id))) return { ok: false, code: "stopped" };
      shareBtn = findStoryShareButton();
      if (shareBtn) break;
      await sleep(500);
    }
    if (!shareBtn) {
      return { ok: false, code: "story_editor_not_ready", message: "Story editor không sẵn sàng sau khi nạp file (story_editor_not_ready)" };
    }

    // 8. Chèn chữ / AI text nếu có cấu hình (best-effort)
    let storyText = clean(cfg.text || "");
    if (cfg.aiEnabled) {
      await setStatus(`[${index + 1}/${total}] AI đang viết chữ chèn story (≤ 80 ký tự)...`);
      try {
        const aiRes = await sendMsg({
          action: "aiGenerateStoryText",
          prompt: cfg.aiPrompt || "",
          text: storyText,
          aiConfig: cfg.aiConfig || {}
        });
        if (aiRes?.ok && aiRes.text) {
          storyText = clean(aiRes.text).slice(0, 80);
        }
      } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
    }
    if (storyText) {
      await setStatus(`[${index + 1}/${total}] Đang chèn chữ vào story: "${storyText.slice(0, 30)}..."`);
      await insertStoryText(storyText, id);
    }
    if (!(await live(id))) return { ok: false, code: "stopped" };

    // 8b. Đăng chéo sang Instagram (chỉ khi config.crossIg bật): tìm điều
    // khiển chéo của chính Facebook TRƯỚC cú bấm Chia sẻ cuối. Không có
    // điều khiển (nick chưa liên kết Accounts Center) thì vẫn đăng FB
    // bình thường — đúng nghĩa "nếu có".
    let crossIg = "";
    if (cfg.crossIg) {
      await setStatus(`[${index + 1}/${total}] Đang tìm tuỳ chọn đăng chéo sang Instagram...`);
      crossIg = await tryEnableCrossIg(id);
      try { await chrome.storage.local.set({ [CROSS_KEY]: crossIg }); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
      if (crossIg === "enabled") {
        await setStatus(`[${index + 1}/${total}] Đã bật đăng chéo sang Instagram (cross_ig: enabled)`);
      } else if (crossIg === "not_available") {
        await setStatus(`[${index + 1}/${total}] Không thấy tuỳ chọn đăng chéo IG — 2 nick có thể chưa liên kết Accounts Center (cross_ig: not_available), vẫn đăng FB bình thường`);
      } else {
        await setStatus(`[${index + 1}/${total}] Không bật được đăng chéo IG (cross_ig: failed), vẫn đăng FB bình thường`);
      }
      if (!(await live(id))) return { ok: false, code: "stopped" };
    }

    // 9. Bấm nút Chia sẻ lên tin
    shareBtn = findStoryShareButton();
    if (!shareBtn) {
      return { ok: false, code: "story_share_not_found", message: "Không tìm thấy nút Chia sẻ lên tin (story_share_not_found)" };
    }
    await setStatus(`[${index + 1}/${total}] Đang bấm Chia sẻ lên tin...`);
    if (!(await trustedClick(shareBtn))) {
      return { ok: false, code: "story_share_click_failed", message: "Không bấm được nút Chia sẻ lên tin" };
    }

    // Ghi phase sang proof trước khi trang có thể chuyển đổi
    try {
      await chrome.storage.local.set({ [PHASE_KEY]: "proving", fbStoryProvingUrl: mediaUrl, fbStoryProvingAt: Date.now() });
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }

    // 10. PROOF thật: khay story thay đổi so với baseline chụp trước
    // khi đăng (hoặc đường viewer cũ khớp) trong 60s.
    const proofRes = await proofStoryPublished(id, 60000);
    try { await chrome.storage.local.remove([PHASE_KEY]); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
    if (!proofRes.ok) {
      return { ok: false, code: proofRes.error || "fb_story_proof_failed", message: "Không thấy story trong khay sau 60s (fb_story_proof_failed)" };
    }
    // Cập nhật baseline sang trạng thái vừa quan sát để story kế
    // tiếp trong cùng phiên so đúng mốc mới (#93).
    await refreshBaselineAfterProof(id, proofRes.observed || null);

    return { ok: true, at: proofRes.at || Date.now(), crossIg };
  }

  async function fbStoryLoop(id) {
    try {
      if (!(await live(id))) return;
      const cfg = config || {};
      const urls = parseMediaUrls(cfg.mediaUrls || cfg.mediaUrl);
      if (!urls.length) {
        active = false;
        await chrome.storage.local.set({ [FLAG]: false, [STATUS_KEY]: "Lỗi: Không có URL media nào để đăng story" });
        return;
      }

      // Resume GIỮA PHA PROOF (#94): trang bị full reload lúc đang
      // proof (vd điều hướng sang trang danh sách tin) thì phase
      // "proving" còn lưu — chạy tiếp proof cho đúng URL đó thay
      // vì đăng lại từ đầu (tránh đăng trùng). Đọc phase TRƯỚC khi
      // chụp baseline: đang resume proof mà chụp mốc lúc này sẽ
      // ghi trạng thái SAU khi story đã đăng làm baseline (mốc
      // bẩn) và làm hỏng phép so — nên bỏ qua capture khi proving.
      let provingUrl = "";
      try {
        const ps = await chrome.storage.local.get([PHASE_KEY, "fbStoryProvingUrl"]);
        if (ps[PHASE_KEY] === "proving") provingUrl = String(ps.fbStoryProvingUrl || "");
      } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }

      if (!provingUrl) {
        // Chụp BASELINE story ngay đầu phiên (trước story đầu
        // tiên) — mốc so proof #93, lấy trên trang danh sách tin
        // (#94). postOneStory cũng chụp lại trước từng story nếu
        // mốc chưa có/stale. capture điều hướng sang trang danh
        // sách thì dừng vòng này — resume vào lại đúng tab và
        // chạy tiếp.
        const baseRec = await captureTrayBaseline(id);
        if (baseRec?.navStarted) return;
      }

      const total = urls.length;
      let done = 0, skipped = 0;
      let lastCrossIg = "";
      const delaySec = Math.max(0, parseInt(cfg.delay) || 30);

      for (let i = 0; i < total; i++) {
        if (!(await live(id))) return;
        const mediaUrl = urls[i];
        let res;
        if (provingUrl && mediaUrl === provingUrl) {
          // Đang resume giữa pha proof của chính URL này: chỉ chạy
          // tiếp proof, TUYỆT ĐỐI không đăng lại.
          provingUrl = "";
          const proofRes = await proofStoryPublished(id, 60000);
          try { await chrome.storage.local.remove([PHASE_KEY]); } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
          if (proofRes.ok) {
            await refreshBaselineAfterProof(id, proofRes.observed || null);
            res = { ok: true, at: proofRes.at || Date.now(), crossIg: "" };
          } else {
            res = { ok: false, code: proofRes.error || "fb_story_proof_failed", message: "Không thấy story trong khay sau 60s (fb_story_proof_failed)" };
          }
        } else {
          res = await postOneStory(mediaUrl, id, i, total);
        }

        if (res.code === "navigated") return; // Sẽ resume sau khi reload
        if (res.code === "stopped" || !(await live(id))) return;

        if (res.ok) {
          done++;
          if (res.crossIg) lastCrossIg = res.crossIg;
          const crossNote = res.crossIg === "enabled" ? " (đã bật chéo IG)" : res.crossIg ? ` (cross_ig: ${res.crossIg})` : "";
          await chrome.storage.local.set({ [DONE_KEY]: done, [SKIPPED_KEY]: skipped, fbStoryLastAt: Date.now() });
          await setStatus(`Đã đăng Story thành công [${done}/${total}]${crossNote} (${new Date().toLocaleTimeString("vi-VN")})`);
        } else {
          skipped++;
          await chrome.storage.local.set({ [DONE_KEY]: done, [SKIPPED_KEY]: skipped });
          await setStatus(`Bỏ qua story [${i + 1}/${total}]: ${res.message || res.code}`);
        }

        if (i < total - 1 && done + skipped < total) {
          if (delaySec > 0) {
            await setStatus(`Đã xong story [${i + 1}/${total}], chờ ${delaySec}s trước story tiếp theo...`);
            const until = Date.now() + delaySec * 1000;
            while (Date.now() < until) {
              if (!(await live(id))) return;
              await sleep(600);
            }
          }
        }
      }

      const crossSuffix = lastCrossIg === "enabled" ? " (đã bật chéo IG)" : lastCrossIg ? ` (cross_ig: ${lastCrossIg})` : "";
      active = false;
      await chrome.storage.local.set({
        [FLAG]: false,
        [STATUS_KEY]: `Hoàn tất đăng Story: thành công ${done}/${total}, bỏ qua ${skipped}${crossSuffix}`
      });
    } catch (e) {
      console.warn("[fbStory]", e);
      active = false;
      try {
        await chrome.storage.local.set({ [FLAG]: false, [STATUS_KEY]: `Lỗi Story: ${String(e?.message || e || "").slice(0, 150)}` });
      } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
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
    if (message.action === "startFbStory") {
      if (active) {
        sendResponse({ ok: false, error: "Đang chạy đăng Story" });
        return true;
      }
      config = { ...(message.config || {}) };
      runId = String(message.runId || config.runId || `fbstory-${Date.now()}`);
      active = true;
      chrome.storage.local.remove([BASELINE_KEY]).catch(() => {});
      chrome.storage.local.set({
        [FLAG]: true,
        [RUN_KEY]: runId,
        [OWNER_KEY]: message.ownerTabId || sender.tab?.id || 0,
        [CONFIG_KEY]: config,
        [DONE_KEY]: 0,
        [SKIPPED_KEY]: 0,
        [CROSS_KEY]: "",
        [STATUS_KEY]: "Đang chuẩn bị đăng Story..."
      }).then(() => fbStoryLoop(runId));
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === "stopFbStory") {
      active = false;
      config = null;
      chrome.storage.local.set({ [FLAG]: false, [STATUS_KEY]: "Đã dừng đăng Story" });
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === "resetFbStory") {
      active = false;
      config = null;
      chrome.storage.local.set({ [FLAG]: false, [DONE_KEY]: 0, [SKIPPED_KEY]: 0, [STATUS_KEY]: "Đã reset đăng Story" });
      chrome.storage.local.remove([CONFIG_KEY, PHASE_KEY, BASELINE_KEY]).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  // Resume khi reload
  (async () => {
    try {
      // (#94) Nới guard cho MỌI trang *.facebook.com (cùng cách vá
      // fbReels ở #92): luồng story nay điều hướng qua trang danh
      // sách tin để chụp baseline + proof — guard cũ chỉ khớp đúng
      // trang gốc nên resume không kích hoạt sau các điều hướng đó.
      if (!/^https:\/\/([^/]+\.)?facebook\.com\//i.test(location.href)) return;
      const s = await chrome.storage.local.get([FLAG, RUN_KEY, CONFIG_KEY, OWNER_KEY, PHASE_KEY]);
      if (!s[FLAG] || !s[CONFIG_KEY]) return;

      let ownerOk = true;
      try {
        const r = await new Promise(res => {
          try { chrome.runtime.sendMessage({ action: "getSenderTabId" }, x => res(chrome.runtime.lastError ? null : x)); }
          catch (_) { res(null); }
        });
        if (r?.tabId && s[OWNER_KEY] && r.tabId !== s[OWNER_KEY]) ownerOk = false;
      } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
      if (!ownerOk) return;

      config = { ...s[CONFIG_KEY] };
      runId = String(s[RUN_KEY] || config.runId || `fbstory-${Date.now()}`);
      active = true;
      await sleep(1500);
      if (active) fbStoryLoop(runId);
    } catch (_) { console.debug("[Auto vjp][fbStory] bỏ qua lỗi:", _); }
  })();

  console.log("[fbStory] fbStory.js loaded");
})();
