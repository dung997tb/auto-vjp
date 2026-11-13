// news.js — Đăng tường nick cá nhân từ Tin tức. State machine RIÊNG
// (newsWall*), không dùng chung selector/counter/proof của group.js (join),
// feed.js (đăng nhóm/comment) hay sales.js (bán hàng). Tự chứa utils để
// không coupling chéo file (theo tiền lệ page.js/sales.js).
(() => {
  const FLAG = "newsWallActive";
  const CONFIG_KEY = "newsWallConfig";
  const RUN_KEY = "newsWallRunId";
  const USED_KEY = "newsUsedUrls";
  const USED_CAP = 500;

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
    } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelOf = el => clean(el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || el?.getAttribute?.("title"));
  const fbUrl = v => {
    try {
      const u = new URL(String(v || ""), location.origin);
      const h = u.hostname.toLowerCase();
      if (!(h === "facebook.com" || h.endsWith(".facebook.com"))) return null;
      u.hash = "";
      return u;
    } catch (_) { return null; }
  };
  const onHomeFeed = () => {
    const u = fbUrl(location.href);
    return !!u && (u.pathname === "/" || u.pathname === "/home.php");
  };

  async function live(id) {
    if (!active || (id && runId && id !== runId)) return false;
    try {
      const s = await chrome.storage.local.get([FLAG, RUN_KEY]);
      return !!s[FLAG] && (!id || !s[RUN_KEY] || s[RUN_KEY] === id);
    } catch (_) { return false; }
  }
  async function setStatus(text, extra = {}) {
    try { await chrome.storage.local.set({ newsWallStatus: String(text || ""), ...extra }); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
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
    // Scroll + đo lại tọa độ NGAY trước khi dispatch: layout FB animation
    // làm tọa độ cũ lệch, click rơi ra ngoài (bắt live: bấm màu không ăn).
    try { el.scrollIntoView({ block: "nearest" }); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    try { el.scrollIntoView({ block: "center" }); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    await sleep(350);
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    const res = await sendMsg({ action: "trustedMouse", kind: "click", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    if (res?.ok) return true;
    try { el.click(); return true; } catch (_) { return false; }
  }

  // ---- Sổ tin đã dùng (chống đăng lại) ----
  async function usedUrls() {
    try {
      const s = await chrome.storage.local.get([USED_KEY]);
      return Array.isArray(s[USED_KEY]) ? s[USED_KEY] : [];
    } catch (_) { return []; }
  }
  async function markUrlUsed(url) {
    if (!url) return;
    try {
      const list = await usedUrls();
      if (!list.includes(url)) {
        list.push(url);
        await chrome.storage.local.set({ [USED_KEY]: list.slice(-USED_CAP) });
      }
    } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
  }
  async function markUrlsUsed(links) {
    for (const u of (Array.isArray(links) ? links : [links])) await markUrlUsed(u);
  }

  // ---- Sổ lý do bỏ bài (giữ từng bài, không chỉ câu mới nhất) ----
  const SKIPLOG_KEY = "newsWallSkipLog";
  const SKIPLOG_CAP = 50;
  async function logNewsSkip(reason, title) {
    try {
      const s = await chrome.storage.local.get([SKIPLOG_KEY]);
      const list = Array.isArray(s[SKIPLOG_KEY]) ? s[SKIPLOG_KEY] : [];
      list.push({ at: Date.now(), reason: String(reason || "").slice(0, 160), title: String(title || "").slice(0, 80) });
      await chrome.storage.local.set({ [SKIPLOG_KEY]: list.slice(-SKIPLOG_CAP) });
    } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
  }
  async function recentSkipReasons(n = 3) {
    try {
      const s = await chrome.storage.local.get([SKIPLOG_KEY]);
      const list = Array.isArray(s[SKIPLOG_KEY]) ? s[SKIPLOG_KEY] : [];
      return list.slice(-n).map(e => e.reason).filter(Boolean);
    } catch (_) { return []; }
  }

  // ---- Composer tường nhà ----
  // Nút mở composer tường có thể kèm tên ("Tuân ơi, bạn đang nghĩ gì thế?") —
  // regex cũ neo ^bạn nên trượt (bắt live). Cho phép tiền tố tên.
  const OPENER_RE = /^(?:.+?ơi,\s*)?(?:bạn\s+đang\s+nghĩ\s+gì|what.s on your mind|bạn\s+viết\s+gì)/i;
  function findWallOpener() {
    const cands = [...document.querySelectorAll('[role="main"] [role="button"],[role="main"] button,button,[role="button"]')].filter(visible)
      .filter(el => !el.closest('[role="dialog"]'));
    return cands.find(el => OPENER_RE.test(labelOf(el))) || null;
  }
  function findDialog() {
    const ds = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(visible);
    return ds[0] || null;
  }
  function findEditor(scope) {
    const root = scope || document;
    const eds = [...root.querySelectorAll('div[contenteditable="true"],[role="textbox"]')].filter(visible)
      .filter(el => !/tìm kiếm|search|tin nhắn|message|bình luận|comment/i.test(`${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""}`));
    return eds[0] || null;
  }
  function editorText(ed) { return clean(ed?.innerText || ed?.textContent || ed?.value || ""); }
  async function waitEditor(id, timeout = 20000) {
    const end = Date.now() + timeout;
    let dlg = null, ed = null, stableAt = 0;
    while (Date.now() < end) {
      if (!(await live(id))) return null;
      dlg = findDialog();
      ed = dlg ? findEditor(dlg) : null;
      if (dlg && ed) {
        if (Date.now() - stableAt >= 800 && stableAt > 0) return { dlg, ed };
        if (!stableAt) stableAt = Date.now();
      } else stableAt = 0;
      await sleep(300);
    }
    return null;
  }
  // Nền màu đặc: label thật của Facebook dạng "Tím thẫm, phông nền",
  // "Đỏ đậm, màu nền", "Gradient, ..." (bắt live DOM). Chỉ màu đặc —
  // gradient/chuyển sắc/minh họa và "Không có phông nền" luôn loại.
  const BG_COLORS = {
    pink: ["hồng", "pink"],
    green: ["xanh lá", "green"],
    red: ["đỏ", "red"],
    orange: ["cam", "orange"],
    yellow: ["vàng", "yellow"],
    blue: ["xanh dương", "xanh da trời", "xanh lam", "blue"],
    purple: ["tím", "purple"],
    burgundy: ["đỏ sẫm", "đỏ thẫm", "burgundy"],
    beige: ["màu be", "beige"],
    brown: ["nâu", "brown"],
    gray: ["xám", "gray", "grey"],
    black: ["đen", "black"]
  };
  function bgLabelHit(color, label) {
    const t = String(label || "").toLowerCase();
    if (!t) return false;
    if (/gradient|chuyển\s*sắc|minh\s*họa|illustration/i.test(t)) return false;
    if (/không có/i.test(t)) return false;
    // burgundy check trước red ("đỏ sẫm" chứa "đỏ" nhưng là màu khác)
    if (color === "burgundy") return /đỏ sẫm|đỏ thẫm|burgundy/i.test(t);
    if (color === "red" && /đỏ sẫm|đỏ thẫm|burgundy|đỏ đô|điều/i.test(t)) return false;
    if (color === "pink" && /đỏ/i.test(t)) return false;
    if (color === "purple" && /hồng/i.test(t)) return false;
    return (BG_COLORS[color] || []).some(k => t.includes(k));
  }
  function composerHasBg(dlg) {
    // Nền supposed NẰM Ở KHUNG XEM TRƯỚC (preview pane), không phải ancestor
    // của ô soạn — bản cũ leo ancestor nên không bao giờ thấy (bắt live: tím
    // gắn đúng mà verify báo trượt). Quét toàn dialog tìm khối lớn có màu.
    try {
      const root = (dlg && dlg.isConnected ? dlg : document);
      const els = [...root.querySelectorAll("*")];
      for (const el of els) {
        let r;
        try { r = el.getBoundingClientRect(); } catch (_) { continue; }
        if (r.width < 150 || r.height < 80) continue;
        let cs;
        try { cs = getComputedStyle(el); } catch (_) { continue; }
        if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
        const m = String(cs.backgroundColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) continue;
        if (m[4] !== undefined && parseFloat(m[4]) < 0.9) continue;
        const [R, G, B] = [+m[1], +m[2], +m[3]];
        if (R > 235 && G > 235 && B > 235) continue; // trắng
        const spread = Math.max(R, G, B) - Math.min(R, G, B);
        if (spread < 25 && Math.min(R, G, B) >= 40 && Math.max(R, G, B) <= 215) continue; // xám trung tính UI
        return true;
      }
    } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    return false;
  }
  function offeredBgColors(dlg) {
    const scope = dlg
      ? [...dlg.querySelectorAll('[role="button"],button,[role="option"],li')]
      : [...document.querySelectorAll('[role="dialog"] [role="button"],[aria-modal="true"] [role="button"]')];
    const out = [], seen = new Set();
    for (const b of scope.filter(visible)) {
      const label = labelOf(b);
      for (const color of Object.keys(BG_COLORS)) {
        if (!seen.has(color) && bgLabelHit(color, label)) { seen.add(color); out.push({ color, el: b }); break; }
      }
    }
    return out;
  }
  async function trustedKey(key, code, keyCode) {
    const res = await sendMsg({ action: "trustedKey", key, code, windowsVirtualKeyCode: keyCode });
    return !!res?.ok;
  }
  async function verifyBg(id, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!(await live(id))) return false;
      if (composerHasBg(findDialog())) return true;
      await sleep(700);
    }
    return composerHasBg(findDialog());
  }
  async function pickBackground(id, colorWanted) {
    // colorWanted="random": chọn ngẫu nhiên trong số màu Facebook đang bày
    // (mỗi lần mở palette có thể khác nhau) thay vì đòi 1 màu cố định.
    for (let round = 0; round < 2; round++) {
      if (!(await live(id))) return { ok: false };
      const dlg = findDialog();
      if (!dlg) return { ok: false };
      const btns = [...dlg.querySelectorAll('[role="button"],button')].filter(visible);
      const opened = btns.some(b => /^ẩn/i.test(labelOf(b)) && /phông nền/i.test(labelOf(b)));
      if (!opened) {
        const show = btns.find(b => /phông nền|background|^aa$/i.test(labelOf(b)));
        if (!show) return { ok: false, stage: "no-palette-btn" };
        if (!(await trustedClick(show))) return { ok: false, stage: "show-click-fail" };
        await sleep(1500);
        continue;
      }
      let offered = offeredBgColors(dlg);
      if (!offered.length) { await sleep(2000); offered = offeredBgColors(findDialog()); }
      if (!offered.length) return { ok: false, stage: "no-colors" };
      let pick = null, pickIdx = 0;
      if (colorWanted && colorWanted !== "random") {
        pickIdx = offered.findIndex(o => o.color === colorWanted);
        if (pickIdx < 0) return { ok: false, stage: "color-missing", offered: offered.map(o => o.color).join(",") };
        pick = offered[pickIdx];
      } else {
        pickIdx = Math.floor(Math.random() * offered.length);
        pick = offered[pickIdx];
      }
      // Cách 1: click chuột. Cách 2 (dự phòng, pattern đã chứng minh ở chọn
      // mention): focus option + Enter qua phím trusted — click chuột đôi khi
      // không kích hoạt được handler React của palette.
      if (await trustedClick(pick.el)) {
        if (await verifyBg(id, 4000)) return { ok: true, color: pick.color };
      } else {
        return { ok: false, stage: "color-click-fail" };
      }
      try {
        pick.el.focus();
        await sleep(200);
        await trustedKey("Enter", "Enter", 13);
        if (await verifyBg(id, 3000)) return { ok: true, color: pick.color, via: "keyboard" };
        const first = offered[0];
        if (first && first.el !== pick.el) {
          try { first.el.focus(); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
          await sleep(200);
          for (let k = 0; k < pickIdx; k++) {
            await trustedKey("ArrowDown", "ArrowDown", 40);
            await sleep(150);
            if (!(await live(id))) return { ok: false };
          }
          await trustedKey("Enter", "Enter", 13);
          if (await verifyBg(id, 3000)) return { ok: true, color: pick.color, via: "keyboard-arrows" };
        }
      } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    }
    return composerHasBg(findDialog()) ? { ok: true } : { ok: false, stage: "unverified" };
  }
  // Đính ảnh: tải qua background (CORS-safe) rồi gán vào input file composer.
  // credit (vd "vnexpress.net") → đóng dấu nhỏ góc dưới-phải bằng canvas để
  // ghi nguồn, giảm rủi ro bản quyền. Ảnh hẹp < 320px thì bỏ (đăng chữ) vì
  // thumbnail nhỏ đăng lên tường bị vỡ, xấu.
  const hostOf = u => {
    try { return new URL(String(u || "")).hostname.replace(/^www\./i, ""); } catch (_) { return ""; }
  };
  function loadStampImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("img-load"));
      img.src = url;
    });
  }
  async function stampImageCredit(blob, credit) {
    const MIN_W = 320;
    let objUrl = "";
    try {
      objUrl = URL.createObjectURL(blob);
      const img = await loadStampImage(objUrl);
      const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
      if (!w || !h) return null;
      if (w < MIN_W) return { tooSmall: true };
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const cx = cv.getContext("2d");
      if (!cx) return null;
      cx.drawImage(img, 0, 0, w, h);
      const text = `Nguồn: ${credit}`;
      const fs = Math.max(13, Math.round(w * 0.032));
      cx.font = `600 ${fs}px Arial, sans-serif`;
      const padX = Math.round(fs * 0.7), padY = Math.round(fs * 0.45);
      const bw = Math.ceil(cx.measureText(text).width + padX * 2), bh = Math.ceil(fs + padY * 2);
      const m = Math.round(fs * 0.6);
      const bx = Math.max(0, w - bw - m), by = Math.max(0, h - bh - m);
      const r = Math.min(bh / 2, Math.round(fs * 0.5));
      cx.fillStyle = "rgba(0,0,0,0.55)";
      cx.beginPath();
      cx.moveTo(bx + r, by);
      cx.arcTo(bx + bw, by, bx + bw, by + bh, r);
      cx.arcTo(bx + bw, by + bh, bx, by + bh, r);
      cx.arcTo(bx, by + bh, bx, by, r);
      cx.arcTo(bx, by, bx + bw, by, r);
      cx.closePath(); cx.fill();
      cx.fillStyle = "#fff";
      cx.textBaseline = "middle";
      cx.fillText(text, bx + padX, by + bh / 2 + 1);
      const out = await new Promise(res => { try { cv.toBlob(res, "image/jpeg", 0.92); } catch (_) { res(null); } });
      if (!out) return null;
      return { blob: out };
    } catch (_) { return null; }
    finally { if (objUrl) try { URL.revokeObjectURL(objUrl); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); } }
  }
  async function imageWidthOf(blob) {
    let objUrl = "";
    try {
      objUrl = URL.createObjectURL(blob);
      const img = await loadStampImage(objUrl);
      return img.naturalWidth || img.width || 0;
    } catch (_) { return 0; }
    finally { if (objUrl) try { URL.revokeObjectURL(objUrl); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); } }
  }
  async function attachPhoto(id, imageUrl, dlg, credit, dataUrlDirect) {
    let dataUrl = dataUrlDirect || "";
    if (!dataUrl) {
      const res = await sendMsg({ action: "newsFetchImage", url: imageUrl });
      if (!res?.ok || !res.dataUrl) return { ok: false, error: res?.error || "no-image" };
      dataUrl = res.dataUrl;
    }
    if (!(await live(id))) return { ok: false, error: "stopped" };
    try {
      let blob = await (await fetch(dataUrl)).blob();
      if (credit) {
        const stamped = await stampImageCredit(blob, credit);
        if (stamped?.tooSmall) return { ok: false, error: "too-small" };
        if (stamped?.blob) blob = stamped.blob;
      } else if (dataUrlDirect) {
        // Ảnh chụp màn hình bài X đã có tên tác giả nên không đóng dấu thêm;
        // chỉ loại ảnh quá nhỏ (đăng lên vỡ).
        const w = await imageWidthOf(blob);
        if (w && w < 320) return { ok: false, error: "too-small" };
      }
      const name = `news-${Date.now()}.jpg`;
      const file = new File([blob], name, { type: blob.type || "image/jpeg" });
      const inputs = [...(dlg || document).querySelectorAll('input[type="file"]'), ...document.querySelectorAll('input[type="file"]')]
        .filter(el => el?.isConnected);
      const input = inputs.find(el => /image|photo|media/i.test(el.accept || "")) || inputs[0];
      if (!input) return { ok: false, error: "no-input" };
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 80) }; }
    const end = Date.now() + 25000;
    // Proof ảnh: không chỉ cần thẻ <img> blob mà ảnh phải GIẢI MÃ được
    // (naturalWidth ≥ 200) và ỔN ĐỊNH qua 2 lần quét liên tiếp — bắt live:
    // file lỗi/upload dở hiện khung trắng nhưng vẫn có thẻ img nên proof cũ
    // lọt, bài hẹn lịch trắng ảnh. Không đạt → no-thumb → đăng chữ.
    let stableW = 0;
    while (Date.now() < end) {
      if (!(await live(id))) return { ok: false, error: "stopped" };
      const scope = dlg?.isConnected ? dlg : document;
      const vids = [...scope.querySelectorAll("video")].filter(el => visible(el));
      const shots = [...scope.querySelectorAll("img")].filter(el => {
        if (!visible(el)) return false;
        const src = String(el.currentSrc || el.src || "");
        if (!(/^blob:|^data:/i.test(src))) return false;
        try { if (!el.complete) return false; } catch (_) { return false; }
        return (el.naturalWidth || 0) >= 200;
      });
      if (vids.length) return { ok: true };
      if (shots.length) {
        const w = Math.max(...shots.map(e => e.naturalWidth || 0));
        if (w > 0 && w === stableW) return { ok: true };
        stableW = w;
      } else stableW = 0;
      await sleep(700);
    }
    return { ok: false, error: "no-thumb" };
  }
  function findPostButton(dlg) {
    const scope = dlg?.isConnected ? dlg : document;
    const btns = [...scope.querySelectorAll('[role="button"],button')].filter(visible);
    return btns.find(b => /^(đăng|post|chia sẻ|share)$/i.test(labelOf(b)) && !b.disabled && b.getAttribute("aria-disabled") !== "true") || null;
  }

  // ---- Lên lịch bằng dialog gốc của Facebook (thay nút Đăng) ----
  // Dò live trên composer tường: nút "Lên lịch" MỞ PANEL INLINE trong chính
  // composer (không phải dialog riêng — bản đầu tìm dialog riêng nên trượt
  // "no-date-btn"). Panel gồm: nút ngày aria "Mở công cụ chọn ngày, Đã chọn:
  // ..." + combobox ngày ("13 Tháng 10, 2026"), combobox giờ ("23:19", bấm mở
  // list khung 5 phút), nút xác nhận "Lên lịch đăng sau". Proof: composer đóng.
  // Lỗi bước nào cũng fail-closed (skip, KHÔNG đăng ngay thay thế).
  const VI_MONTHS = ["giêng", "hai", "ba", "tư", "năm", "sáu", "bảy", "tám", "chín", "mười", "mười một", "mười hai"];
  const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const docBtns = () => [...document.querySelectorAll('[role="button"],button')].filter(visible);
  function schedConfirmBtn() {
    // Nút xác nhận đổi nhãn theo trạng thái: "Lên lịch đăng sau" (mới mở
    // panel) → "Lên lịch đăng bài" (đã chọn ngày+giò, bắt live). Chấp nhận cả 2.
    return docBtns().find(b => /lên lịch đăng (sau|bài)|schedule( post)?$/i.test(labelOf(b)) || /^schedule$/i.test(labelOf(b))) || null;
  }
  async function waitSchedPanel(id, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (!(await live(id))) return null;
      const c = schedConfirmBtn();
      if (c) return c;
      await sleep(400);
    }
    return schedConfirmBtn();
  }
  async function scheduleNativeFB(id, comp, targetMs) {
    const t = new Date(Number(targetMs) || 0);
    if (isNaN(t.getTime())) return { ok: false, stage: "bad-target" };
    const tY = t.getFullYear(), tM = t.getMonth(), tD = t.getDate(), tHM = t.getHours() * 60 + t.getMinutes();
    const composer = comp?.dlg?.isConnected ? comp.dlg : findDialog();
    if (!composer) return { ok: false, stage: "no-composer" };
    // 1. Nút "Lên lịch" trong composer (loại nút xác nhận "đăng sau").
    // Panel inline nên nếu nút xác nhận đã hiện thì khỏi bấm mở.
    if (!schedConfirmBtn()) {
      const opener = [...composer.querySelectorAll('[role="button"],button')].filter(visible)
        .find(b => (/lên lịch/i.test(labelOf(b)) && !/đăng sau/i.test(labelOf(b))) || /^schedule$/i.test(labelOf(b)));
      if (!opener) return { ok: false, stage: "no-sched-btn" };
      if (!(await trustedClick(opener))) return { ok: false, stage: "sched-click-fail" };
      await sleep(1000);
    }
    // 2. Đợi panel inline (nút xác nhận xuất hiện).
    if (!(await waitSchedPanel(id))) return { ok: false, stage: "no-sched-panel" };
    if (!(await live(id))) return { ok: false, stage: "stopped" };
    // 3. Mở calendar ngày qua nút "Mở công cụ chọn ngày..." (aria-label).
    let dateBtn = docBtns().find(b => /mở công cụ chọn ngày|chọn ngày|open.*date|date.*picker/i.test(`${b.getAttribute?.("aria-label") || ""} ${labelOf(b)}`));
    if (!dateBtn) return { ok: false, stage: "no-date-btn" };
    if (!(await trustedClick(dateBtn))) return { ok: false, stage: "date-click-fail" };
    await sleep(1200);
    if (!(await live(id))) return { ok: false, stage: "stopped" };
    // 4. Điều hướng calendar tới tháng/năm mục tiêu (nút ◀ ▶ kề header
    // "Tháng X năm YYYY"). Quét toàn document vì calendar có thể là popover.
    let pickedDay = false;
    for (let nav = 0; nav < 30; nav++) {
      if (!(await live(id))) return { ok: false, stage: "stopped" };
      const header = [...document.querySelectorAll("*")].filter(visible)
        .find(e => /tháng\s*\d{1,2}\s*năm\s*\d{4}/i.test(labelOf(e)) && labelOf(e).length < 40);
      if (!header) { await sleep(800); continue; }
      const hm = labelOf(header).match(/tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i);
      const curY = hm ? +hm[2] : tY, curM = hm ? (+hm[1] - 1) : tM;
      if (curY === tY && curM === tM) break;
      const box = header.parentElement;
      const navBtns = box ? [...box.querySelectorAll('[role="button"],button')].filter(visible) : [];
      const goPrev = (curY > tY) || (curY === tY && curM > tM);
      const navBtn = navBtns.length >= 2 ? (goPrev ? navBtns[0] : navBtns[navBtns.length - 1]) : navBtns[0];
      if (!navBtn) return { ok: false, stage: "no-month-nav" };
      if (!(await trustedClick(navBtn))) return { ok: false, stage: "month-nav-fail" };
      await sleep(900);
      if (nav === 29) return { ok: false, stage: "month-nav-loop" };
    }
    // 5. Bấm ô ngày mục tiêu (aria-label chứa ngày+tháng+năm, không disabled).
    {
      const dayBtns = [...document.querySelectorAll('[role="button"],button,[role="gridcell"],[role="option"]')].filter(visible)
        .filter(b => b.disabled !== true && b.getAttribute?.("aria-disabled") !== "true");
      const want = dayBtns.find(b => {
        const l = String(b.getAttribute?.("aria-label") || labelOf(b) || "").toLowerCase();
        if (!l || !new RegExp(`(^|\\D)${tD}(\\D|$)`).test(l)) return false;
        return l.includes(`tháng ${tM + 1}`) || l.includes(String(tY)) ||
          l.includes(EN_MONTHS[tM]) || (VI_MONTHS[tM] && l.includes(VI_MONTHS[tM]));
      });
      if (!want) return { ok: false, stage: "no-day-cell" };
      if (!(await trustedClick(want))) return { ok: false, stage: "day-click-fail" };
      pickedDay = true;
      await sleep(1200);
    }
    if (!pickedDay) return { ok: false, stage: "no-day-cell" };
    if (!(await live(id))) return { ok: false, stage: "stopped" };
    // 6. Chọn giờ: combobox HH:MM → bấm mở list khung 5 phút (list có thể
    // render ngoài dialog nên quét toàn document), lấy khung đầu tiên ≥ giờ
    // hẹn, hết thì khung cuối.
    let pickedSlot = "";
    {
      const timeBox = [...document.querySelectorAll('[role="combobox"],input')].filter(visible)
        .find(b => /^\d{1,2}:\d{2}$/.test(clean(b.value ?? b.textContent ?? labelOf(b))));
      if (!timeBox) return { ok: false, stage: "no-time-btn" };
      if (!(await trustedClick(timeBox))) return { ok: false, stage: "time-click-fail" };
      await sleep(1200);
      let opts = [];
      for (let k = 0; k < 6 && !opts.length; k++) {
        if (!(await live(id))) return { ok: false, stage: "stopped" };
        opts = [...document.querySelectorAll('[role="option"],[role="menuitem"],li,[role="button"],button')].filter(visible)
          .filter(o => o !== timeBox && !o.contains?.(timeBox) && !/lên lịch đăng sau|schedule/i.test(labelOf(o)))
          .map(o => ({ o, m: labelOf(o).match(/^(\d{1,2}):(\d{2})$/) }))
          .filter(x => x.m)
          .map(x => ({ o: x.o, hm: (+x.m[1]) * 60 + (+x.m[2]), label: x.m[0] }))
          .sort((a, b) => a.hm - b.hm);
        if (!opts.length) {
          // Dự phòng: focus + phím (pattern đã chứng minh ở palette nền).
          try {
            timeBox.focus();
            await sleep(250);
            await trustedKey("ArrowDown", "ArrowDown", 40);
            await sleep(900);
          } catch (_) { await sleep(900); }
        }
      }
      if (!opts.length) return { ok: false, stage: "no-time-opts" };
      const pick = opts.find(x => x.hm >= tHM) || opts[opts.length - 1];
      if (!(await trustedClick(pick.o))) return { ok: false, stage: "time-pick-fail" };
      pickedSlot = pick.label;
      await sleep(800);
    }
    if (!(await live(id))) return { ok: false, stage: "stopped" };
    // 7. Xác nhận + proof composer đóng. Nút re-render đổi nhãn/vị trí giữa
    // chừng (đăng sau → đăng bài) nên query tươi + bấm tối đa 2 lần.
    for (let att = 0; att < 2; att++) {
      if (!(await live(id))) return { ok: false, stage: "stopped" };
      const btn = schedConfirmBtn();
      if (!btn) break; // nút đã mất = submit đã ăn, chờ proof dưới
      if (!(await trustedClick(btn))) return { ok: false, stage: "confirm-click-fail" };
      await sleep(3500);
      if (!schedConfirmBtn()) break;
    }
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      if (!(await live(id))) return { ok: false, stage: "stopped" };
      if (!schedConfirmBtn() && !findDialog()) break;
      await sleep(700);
    }
    if (schedConfirmBtn() || findDialog()) return { ok: false, stage: "unverified" };
    const [ph, pm] = pickedSlot.split(":").map(Number);
    const actual = new Date(tY, tM, tD, ph || 0, pm || 0, 0, 0).getTime();
    return { ok: true, actualMs: actual, slot: pickedSlot };
  }

  async function postOneWall(item, content, id, schedAt, extraLinks) {
    const cfg = config || {};
    // 1. Về Bảng tin + đúng nick cá nhân
    if (!onHomeFeed()) { location.href = "https://www.facebook.com/"; return "navigated"; }
    try {
      if (window.ensurePersonalActor) {
        const actor = await window.ensurePersonalActor();
        if (!actor.ok) { await setStatus("Facebook đang dùng Page, không đăng tường nick"); return "skip"; }
        if (actor.switched) { location.replace("https://www.facebook.com/"); return "navigated"; }
      }
    } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    if (!(await live(id))) return "stopped";
    // 2. Mở composer
    const opener = findWallOpener();
    if (!opener) { await setStatus("Không mở được ô đăng tường"); return "skip"; }
    if (!(await trustedClick(opener))) { await setStatus("Không bấm được ô đăng tường"); return "skip"; }
    const comp = await waitEditor(id);
    if (!comp) { await setStatus("Ô soạn không hiện"); return "skip"; }
    // 3. Gõ nội dung (exact verify trước submit — click không phải success).
    // Gõ lại tối đa 3 lần (tiền lệ feed/group): debugger insertText đi theo
    // focus, node editor có thể bị React thay giữa chừng (đọc node cũ luôn
    // lệch) — mỗi lần lấy node tươi, focus lại. Ô soạn PHẢI trống đã verify
    // trước khi gõ (bắt live: tồn chữ cũ + lệnh xóa mù selectAll không ăn trên
    // Lexical → chữ đội lên ~3x, diag lan3-go2819/1038-lech9); dọn không sạch
    // thì đóng mở composer mới. Diag ghi đủ 3 lần, không ghi nội dung.
    const norm = s => clean(s).replace(/\s+/g, " ");
    const want = norm(content);
    const wantLen = [...content].length;
    const readPair = () => {
      const d = findDialog();
      const e = d ? findEditor(d) : null;
      return d && e ? { dlg: d, ed: e } : null;
    };
    const diffOf = (got, wantStr) => {
      let diffAt = -1;
      const lim = Math.min(got.length, wantStr.length);
      for (let k = 0; k < lim; k++) { if (got[k] !== wantStr[k]) { diffAt = k; break; } }
      if (diffAt < 0 && got.length !== wantStr.length) diffAt = lim;
      return diffAt;
    };
    async function clearEditorVerified(pair) {
      for (let c = 0; c < 2; c++) {
        if (!(await live(id))) return false;
        try { pair.ed.focus(); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
        await sleep(400);
        if (!norm(editorText(pair.ed))) return true;
      }
      return !norm(editorText(pair.ed));
    }
    async function reopenComposer() {
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
      await sleep(1200);
      if (!(await live(id))) return null;
      const opener = findWallOpener();
      if (!opener || !(await trustedClick(opener))) return null;
      return await waitEditor(id);
    }
    const diags = [];
    let typedOk = false;
    for (let ta = 0; ta < 3; ta++) {
      if (!(await live(id))) return "stopped";
      let pair = readPair();
      if (!pair) { diags.push(`lan${ta + 1}-mat-o-soan`); await sleep(800); continue; }
      if (norm(editorText(pair.ed))) {
        if (!(await clearEditorVerified(pair))) {
          const nc = await reopenComposer();
          if (!nc) { diags.push(`lan${ta + 1}-mo-lai-that-bai`); await sleep(800); continue; }
          comp.dlg = nc.dlg; comp.ed = nc.ed;
          const re = readPair();
          if (!re || norm(editorText(re.ed))) { diags.push(`lan${ta + 1}-composer-moi-van-ban`); continue; }
          pair = re;
        }
        comp.dlg = pair.dlg; comp.ed = pair.ed;
      } else { comp.dlg = pair.dlg; comp.ed = pair.ed; }
      try { pair.ed.focus(); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
      await sleep(250);
      const typed = await sendMsg({ action: "trustedInput", text: content, pressEnter: false, typingConfig: cfg.typingConfig || null });
      // Lexical có thể thay node editor ngay sau khi debugger insertText hoàn
      // tất. Không đọc lại node cũ: lấy cặp dialog/editor tươi và chờ DOM ổn
      // định ngắn trước khi kết luận nội dung bị lệch.
      let fresh = null, gotRaw = "";
      for (let wait = 0; wait < 8; wait++) {
        await sleep(250);
        fresh = readPair();
        gotRaw = fresh?.ed ? editorText(fresh.ed) : "";
        if (fresh?.ed && norm(gotRaw) === want) break;
      }
      if (fresh?.dlg && fresh?.ed) { comp.dlg = fresh.dlg; comp.ed = fresh.ed; }
      const got = norm(gotRaw);
      if (typed?.ok && got === want) { typedOk = true; break; }
      const diffAt = diffOf(got, want);
      diags.push(`lan${ta + 1}-go${gotRaw ? [...gotRaw].length : 0}/${wantLen}${typed?.ok ? "" : "-loi-go"}${diffAt >= 0 ? `-lech${diffAt}` : ""}${pair.ed.isConnected ? "" : "-node-cu"}`);
    }
    if (!typedOk) {
      const reason = `Nội dung trong ô không khớp bài đã duyệt (${diags.join("; ") || "?"}) — không đăng`;
      await setStatus(reason);
      await logNewsSkip(reason, item.title);
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
      return "skip";
    }
    if (!(await live(id))) return "stopped";
    // 4. Nền hoặc ảnh (nền FB không cho kèm ảnh — 2 mode loại trừ nhau)
    if (cfg.mode === "bg") {
      const colors = Object.keys(BG_COLORS);
      const want = cfg.bgMode === "fixed" && colors.includes(cfg.fixedColor) ? cfg.fixedColor : "random";
      await setStatus(`Đang chọn nền ${want === "random" ? "ngẫu nhiên" : want}...`);
      const bgRes = await pickBackground(id, want);
      if (!(await live(id))) return "stopped";
      // Chế độ nền mà không gắn được nền thì BỎ (đăng chữ trơn là sai yêu cầu,
      // bắt live: bài lên tường trắng trơn dù status báo đã chọn nền).
      if (!bgRes?.ok) {
        await setStatus(`Không gắn được nền${want !== "random" ? " " + want : ""} (${bgRes?.stage || "?"}) — bỏ bài này`);
        return "skip";
      }
      if (bgRes.color) await setStatus(`Đã chọn nền ${bgRes.color}...`);
    } else if (cfg.withImage && (item.imageDataUrl || item.image || (cfg.source?.type === "xread" && item.link))) {
      // Nguồn X không có ảnh RSS riêng → chụp màn hình bài gốc đính kèm
      // (ảnh đã có sẵn tên tác giả nên không đóng dấu thêm).
      const isXShot = cfg.source?.type === "xread" && !item.image && !!item.link;
      await setStatus(isXShot ? "Đang chụp màn hình bài X..." : "Đang đính ảnh tin...");
      let at;
      if (isXShot) {
        const shot = await sendMsg({ action: "xShotPost", url: item.link });
        if (!(await live(id))) return "stopped";
        if (!shot?.ok || !shot.dataUrl) {
          await setStatus(`Không chụp được bài X (${shot?.error || "?"}) — đăng chữ`);
          at = { ok: false, error: "shot-fail-soft" };
        } else {
          // Ảnh chụp màn hình đã có tên tác giả (không đóng dấu); poster của
          // video live thì đóng dấu @tác giả vì ảnh tĩnh không có tên.
          at = await attachPhoto(id, "", comp.dlg, shot.credit || "", shot.dataUrl);
        }
      } else {
        const credit = (cfg.stampSource === false || cfg.source?.type === "fb") ? "" : hostOf(item.link);
        at = item.imageDataUrl
          ? await attachPhoto(id, "", comp.dlg, credit, item.imageDataUrl)
          : await attachPhoto(id, item.image, comp.dlg, credit);
      }
      if (!at.ok) {
        if (at.error === "stopped") return "stopped";
        if (at.error !== "shot-fail-soft") await setStatus(`Không đính được ảnh (${at.error}) — đăng chữ`);
      }
      if (!(await live(id))) return "stopped";
    }
    // 5. Đăng ngay, hoặc hẹn lịch bằng dialog gốc Facebook (không bao giờ
    // đăng ngay thay thế khi hẹn lịch lỗi — fail-closed).
    if (cfg.publishMode === "fbSchedule" && cfg.fbScheduleAt) {
      // Nhiều bài: bài thứ i hẹn giờ đầu + i*gap (gap truyền từ loop).
      const myAt = Number(schedAt) > Date.now() ? Number(schedAt) : Number(cfg.fbScheduleAt) || 0;
      if (!myAt) { await setStatus("Thiếu giờ hẹn lịch — không hẹn lịch"); return "skip"; }
      if (myAt < Date.now() + 5 * 60000) { await setStatus("Giờ hẹn đã qua (chạy lịch trễ) — bỏ bài này, đặt giờ mới rồi chạy lại"); return "skip"; }
      {
        const reDlg = findDialog();
        const reEd = reDlg ? findEditor(reDlg) : null;
        if (!reEd || norm(editorText(reEd)) !== want) {
          const reason = "Nội dung đổi sau re-render — không hẹn lịch";
          await setStatus(reason);
          await logNewsSkip(reason, item.title);
          return "skip";
        }
        comp.dlg = reDlg; comp.ed = reEd;
      }
      const minD = Math.max(0, parseInt(cfg.minDelay) || 0) * 1000;
      if (minD > 0) {
        const until = Date.now() + minD;
        while (Date.now() < until) { if (!(await live(id))) return "stopped"; await sleep(500); }
      }
      if (!(await live(id))) return "stopped";
      await setStatus(`Đang hẹn lịch ${new Date(myAt).toLocaleString("vi-VN")} bằng Facebook...`);
      const sch = await scheduleNativeFB(id, comp, myAt);
      if (!(await live(id))) return "stopped";
      if (!sch?.ok) {
        await setStatus(`Không hẹn được lịch Facebook (${sch?.stage || "?"}) — bỏ bài này`);
        try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
        return "skip";
      }
      await markUrlsUsed([item.link, ...(extraLinks || [])]);
      try { await chrome.storage.local.set({ newsWallLastContent: String(content || "").slice(0, 2000), newsWallLastMode: cfg.mode || "", newsWallLastAt: Date.now(), newsWallLastScheduledAt: sch.actualMs || myAt }); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
      await setStatus(`Đã hẹn lịch Facebook ${sch.slot || ""} ngày ${new Date(sch.actualMs).toLocaleString("vi-VN")}`);
      return "done";
    }
    const postBtn = findPostButton(comp.dlg);
    if (!postBtn) { await setStatus("Không thấy nút Đăng"); return "skip"; }
    // Verify lại exact ngay trước click (re-render có thể đổi text)
    {
      const reDlg = findDialog();
      const reEd = reDlg ? findEditor(reDlg) : null;
      if (!reEd || norm(editorText(reEd)) !== want) {
        const reason = "Nội dung đổi sau re-render — không đăng";
        await setStatus(reason);
        await logNewsSkip(reason, item.title);
        return "skip";
      }
      comp.dlg = reDlg; comp.ed = reEd;
    }
    const minD = Math.max(0, parseInt(cfg.minDelay) || 0) * 1000;
    if (minD > 0) {
      const until = Date.now() + minD;
      while (Date.now() < until) { if (!(await live(id))) return "stopped"; await sleep(500); }
    }
    if (!(await trustedClick(postBtn))) { await setStatus("Không bấm được nút Đăng"); return "skip"; }
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      if (!(await live(id))) return "stopped";
      const stillOpen = findDialog();
      if (!stillOpen) break;
      await sleep(700);
    }
    if (findDialog()) { await setStatus("Chưa xác minh bài đã đăng"); return "skip"; }
    await markUrlUsed(item.link);
    try { await chrome.storage.local.set({ newsWallLastContent: String(content || "").slice(0, 2000), newsWallLastMode: cfg.mode || "", newsWallLastAt: Date.now() }); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    return "done";
  }

  async function newsWallLoop(id) {
    try {
      if (!(await live(id))) return;
      const cfg0 = config || {};
      // Lấy tin mới (trừ URL đã dùng)
      await setStatus("Đang lấy tin mới...");
      const wantFetch = cfg0.source?.type === "sites"
        ? Math.max(9, (parseInt(cfg0.count) || 1) * 4)
        : Math.max(3, (parseInt(cfg0.count) || 1) * 3);
      const fres = await sendMsg({ action: "newsFetch", source: cfg0.source || {}, count: wantFetch });
      if (!(await live(id))) return;
      if (!fres?.ok) {
        active = false;
        await chrome.storage.local.set({ [FLAG]: false, newsWallStatus: `Không lấy được tin: ${fres?.error || "?"}` });
        return;
      }
      const used = await usedUrls();
      const fresh = fres.items.filter(it => it.link && !used.includes(it.link));
      if (!fresh.length) {
        active = false;
        await chrome.storage.local.set({ [FLAG]: false, newsWallStatus: "Hết tin mới (tin nào cũng đã dùng) — đổi chủ đề hoặc chạy lại sau" });
        return;
      }
      const total = Math.max(1, Math.min(100000, parseInt(cfg0.count) || 1));
      const gapMs = Math.max(5, parseInt(cfg0.fbScheduleGap) || 30) * 60000;
      // Web của tôi: gom tin thành bundle tối đa 3 tin cùng từ khóa → AI tổng
      // hợp nhiều nguồn vào 1 bài (trung thực hơn); nguồn đơn giữ như cũ.
      // Nhiều từ khóa: gom cùng topic trong 1 bundle để bài mạch lạc (mới
      // nhất trước trong từng topic).
      const BUNDLE = cfg0.source?.type === "sites" ? 3 : 1;
      const jobs = [];
      {
        const rest = [...fresh];
        while (rest.length && jobs.length < total) {
          const t0 = rest[0].topic || "";
          const b = [];
          for (let i = rest.length - 1; i >= 0 && b.length < BUNDLE; i--) {
            if ((rest[i].topic || "") === t0) b.unshift(rest.splice(i, 1)[0]);
          }
          if (!b.length) b.push(rest.shift());
          jobs.push(b);
        }
      }
      let done = 0, skipped = 0, lastSkipReason = "";
      for (const [idx, bundle] of jobs.entries()) {
        const item = bundle[0];
        if (!(await live(id))) return;
        // Nguồn Page/Profile Facebook: chuẩn bị ảnh TRƯỚC khi gọi AI để AI có
        // thể đọc ảnh (vision) và để postOneWall dùng lại đúng dataUrl đó.
        if (cfg0.source?.type === "fb") {
          const fbMode = cfg0.source?.mode || "rewrite";
          item.sourceMode = fbMode;
          await setStatus(fbMode === "opinion_screenshot" ? "Đang chụp màn hình bài gốc..." : "Đang tải ảnh bài gốc...");
          let okImg = false;
          if (fbMode === "opinion_screenshot") {
            // newsFetch đã lọc mode này chỉ còn bài textBg. Giữ thêm guard ở
            // đây để một draft/pool cũ không bao giờ biến bài thường thành
            // ảnh chụp dọc dài.
            if (item.hasBackground === true || item.contentClass === "textBg") {
              const shot = await sendMsg({ action: "fbShotPost", url: item.link, includeComment: cfg0.source?.includeComment !== false });
              if (shot?.ok && shot.dataUrl) { item.imageDataUrl = shot.dataUrl; okImg = true; }
            }
          } else if (item.image) {
            const im = await sendMsg({ action: "newsFetchImage", url: item.image });
            if (im?.ok && im.dataUrl) { item.imageDataUrl = im.dataUrl; okImg = true; }
          }
          // Ảnh trực tiếp bị CDN chặn → chỉ fallback chụp nếu bài có nền màu.
          if (!okImg && fbMode !== "opinion_screenshot" && item.link && (item.hasBackground === true || item.contentClass === "textBg")) {
            const shot = await sendMsg({ action: "fbShotPost", url: item.link, includeComment: false });
            if (shot?.ok && shot.dataUrl) { item.imageDataUrl = shot.dataUrl; okImg = true; }
          }
          if (!(await live(id))) return;
          if (!okImg && fbMode === "opinion_screenshot") {
            skipped++;
            lastSkipReason = `Bỏ qua: bài Facebook không có nền màu hoặc không chụp được screenshot: ${item.title.slice(0, 50)}`;
            await setStatus(lastSkipReason);
            await logNewsSkip(lastSkipReason, item.title);
            await chrome.storage.local.set({ newsWallDone: done, newsWallSkipped: skipped });
            continue;
          }
        }
        await setStatus(bundle.length > 1 ? `AI đang tổng hợp ${bundle.length} nguồn về: ${item.title.slice(0, 55)}...` : `AI đang viết từ tin: ${item.title.slice(0, 60)}...`);
        // Meta chậm/treo (>140s là SW bỏ lượt để khỏi kẹt dây chuyền): chờ
        // 45s thử lại tối đa 3 lần trước khi bỏ bài (bắt live: 2 skip
        // "waiting-send" liên tiếp trong 1 phiên). Tuân stop flag khi chờ.
        let gen = null, genErr = "";
        for (let ga = 0; ga < 3; ga++) {
          if (!(await live(id))) return;
          if (ga > 0) {
            await setStatus(`AI chưa trả lời, thử lại lần ${ga + 1}/3: ${item.title.slice(0, 50)}...`);
            const until = Date.now() + 45000;
            let alive = true;
            while (Date.now() < until) { if (!(await live(id))) { alive = false; break; } await sleep(800); }
            if (!alive) return;
          }
          gen = await sendMsg({
            action: "aiGenerateNewsPost", news: item, topic: bundle[0]?.topic || cfg0.topic || "",
            mode: cfg0.mode === "bg" ? "bg" : "long",
            kind: ["bg", "photo", "text"].includes(cfg0.kind) ? cfg0.kind : (cfg0.mode === "bg" ? "bg" : cfg0.mode === "photo" ? "photo" : "text"),
            maxChars: cfg0.mode === "bg" ? Math.max(40, Math.min(500, parseInt(cfg0.bgMaxChars) || 130)) : 0,
            prompt: cfg0.prompt || "", styleProfileId: cfg0.styleProfile || "",
            // Gắn đúng biến thể cho cả nguồn X/Web của nick cá nhân. Trước đây
            // chỉ FB có sourceMode nên prompt X có thể bị xử lý như bài tin
            // chung, đặc biệt nguy hiểm khi Meta trả lại nguyên văn nguồn.
            sourceMode: cfg0.source?.type === "fb"
              ? (cfg0.source?.mode || "rewrite")
              : cfg0.source?.type === "xread" ? "x"
              : (cfg0.source?.type === "sites" || cfg0.source?.type === "url" || cfg0.source?.type === "google") ? "web" : "",
            metaFeature: "news-wall",
            imageDataUrl: (cfg0.mode === "bg" || cfg0.source?.mode === "opinion_screenshot") ? "" : (item.imageDataUrl || ""),
            multiSources: bundle.length > 1 ? bundle : undefined,
            aiConfig: cfg0.aiConfig || {}
          });
          if (gen?.ok) break;
          genErr = String(gen?.error || "?");
          if (!/quá chậm|treo|timeout|bận câu trước|busy|quá tải|trống|empty|thử lại sau|waiting-send|không trả lời|chậm/i.test(genErr)) break;
        }
        if (!(await live(id))) return;
        if (!gen?.ok) {
          skipped++;
          lastSkipReason = `AI không viết được (${genErr || "?"}): ${item.title.slice(0, 50)}`;
          await setStatus(lastSkipReason);
          await logNewsSkip(lastSkipReason, item.title);
          await chrome.storage.local.set({ newsWallDone: done, newsWallSkipped: skipped });
          continue;
        }
        const myAt = (Number(cfg0.fbScheduleAt) || 0) + idx * gapMs;
        const res = await postOneWall(item, gen.content, id, myAt, bundle.slice(1).map(b => b.link));
        if (res === "stopped" || !(await live(id))) return;
        if (res === "navigated") return; // reload sẽ resume (config đã persist)
        if (res === "done") {
          done++;
          await chrome.storage.local.set({ newsWallDone: done, newsWallSkipped: skipped });
          await setStatus(`Đã đăng ${done}/${total}: ${item.title.slice(0, 50)}`);
        } else {
          skipped++;
          try {
            const cur = await chrome.storage.local.get(["newsWallStatus"]);
            if (cur.newsWallStatus) lastSkipReason = String(cur.newsWallStatus).slice(0, 120);
          } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
          if (lastSkipReason) await logNewsSkip(lastSkipReason, item.title);
          await chrome.storage.local.set({ newsWallDone: done, newsWallSkipped: skipped });
        }
        if (done >= total) break;
        const gap = Math.max(0, parseInt(cfg0.interDelay) || 0) * 1000;
        if (gap > 0 && done < total) {
          const until = Date.now() + gap;
          await setStatus(`Đã đăng ${done}/${total}, chờ giãn cách...`);
          while (Date.now() < until) { if (!(await live(id))) return; await sleep(800); }
        }
      }
      active = false;
      const reasons = await recentSkipReasons(3);
      await chrome.storage.local.set({ [FLAG]: false, newsWallStatus: `Hoàn tất đăng tường: ${done} bài, bỏ qua ${skipped}${reasons.length ? ` (${reasons.join(" | ").slice(0, 300)})` : (lastSkipReason ? ` (mới nhất: ${lastSkipReason})` : "")}` });
    } catch (e) {
      console.warn("[NewsWall]", e);
      active = false;
      try { await chrome.storage.local.set({ [FLAG]: false, newsWallStatus: "Lỗi: " + String(e?.message || e || "").slice(0, 150) }); } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
    } finally { active = false; }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[FLAG]?.newValue === false) { active = false; config = null; }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startNewsWallPost") {
      if (active) { sendResponse({ ok: false, error: "Đang chạy đăng tường" }); return true; }
      config = { ...(message.config || {}) };
      runId = String(message.runId || config.runId || `newswall-${Date.now()}`);
      active = true;
      chrome.storage.local.set({ [FLAG]: true, [RUN_KEY]: runId, newsWallOwnerTabId: message.ownerTabId || sender.tab?.id || 0, [CONFIG_KEY]: { ...config, aiConfig: config.aiConfig ? { provider: config.aiConfig.provider, model: config.aiConfig.model, url: config.aiConfig.url, profileId: config.aiConfig.profileId || "" } : undefined }, newsWallDone: 0, newsWallSkipped: 0, newsWallStatus: "Đang chuẩn bị đăng tường..." }).then(() => newsWallLoop(runId));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopNewsWallPost") {
      active = false; config = null;
      chrome.storage.local.set({ [FLAG]: false, newsWallStatus: "Đã dừng đăng tường" });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetNewsWallPost") {
      active = false; config = null;
      chrome.storage.local.set({ [FLAG]: false, newsWallDone: 0, newsWallSkipped: 0, newsWallStatus: "Đã reset đăng tường" });
      chrome.storage.local.remove([CONFIG_KEY]).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // Resume khi reload: chỉ owner tab, chỉ khi cờ còn bật.
  (async () => {
    try {
      // Chỉ resume trên tab Bảng tin của nick. Tab nguồn Page/Profile (do
      // background mở để đọc bài) cũng chạy content script này — nếu resume
      // ở đó sẽ tự gọi newsFetch và mở thêm tab nguồn vô hạn.
      if (!/^https:\/\/(?:www\.)?facebook\.com\/?(?:[?#]|$)/i.test(location.href)) return;
      const s = await chrome.storage.local.get([FLAG, RUN_KEY, CONFIG_KEY, "newsWallOwnerTabId"]);
      if (!s[FLAG] || !s[CONFIG_KEY]) return;
      let ownerOk = true;
      try {
        const r = await new Promise(res => {
          try { chrome.runtime.sendMessage({ action: "getSenderTabId" }, x => res(chrome.runtime.lastError ? null : x)); }
          catch (_) { res(null); }
        });
        if (r?.tabId && s.newsWallOwnerTabId && r.tabId !== s.newsWallOwnerTabId) ownerOk = false;
      } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
      if (!ownerOk) return;
      config = { ...s[CONFIG_KEY] };
      runId = String(s[RUN_KEY] || config.runId || `newswall-${Date.now()}`);
      active = true;
      await sleep(1500);
      if (active) newsWallLoop(runId);
    } catch (_) { console.debug("[Auto vjp][news] bỏ qua lỗi:", _); }
  })();

  console.log("[News] news.js loaded");
})();
