// readywall.js — Đăng tường nick cá nhân từ nội dung soạn sẵn (text + file
// ảnh/video tự chuẩn bị), hẹn giờ bằng lịch gốc Facebook. State machine RIÊNG
// (readyWall*), không dùng chung selector/counter/proof của news.js hay
// group.js — chỉ mượn *pattern* đã kiểm chứng (không coupling chéo file).
(() => {
  try { window.__readyWallVer = "1.9.496-submit-now"; } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
  const FLAG = "readyWallActive";
  const CONFIG_KEY = "readyWallConfig";
  const RUN_KEY = "readyWallRunId";

  let active = false;
  let runId = "";
  let config = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = v => String(v || "").replace(/[\u0300-\u036f\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const visible = el => {
    if (!el?.isConnected) return false;
    try {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") return false;
    } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
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
    try { await chrome.storage.local.set({ readyWallStatus: String(text || ""), ...extra }); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
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
    try { el.scrollIntoView({ block: "nearest" }); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    try { el.scrollIntoView({ block: "center" }); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    await sleep(350);
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    const res = await sendMsg({ action: "trustedMouse", kind: "click", x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    if (res?.ok) return true;
    try { el.click(); return true; } catch (_) { return false; }
  }
  async function trustedKey(key, code, keyCode) {
    const res = await sendMsg({ action: "trustedKey", key, code, windowsVirtualKeyCode: keyCode });
    return !!res?.ok;
  }

  // ---- Composer tường nhà (giống news.js, tự chứa) ----
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

  // ---- Đính file ảnh/video đã soạn (dataUrl lưu trong draft) ----
  async function attachReadyFiles(files, dlg, id) {
    if (!files?.length) return { ok: true, skipped: true };
    if (!(await live(id))) return { ok: false, error: "stopped" };
    try {
      const dt = new DataTransfer();
      for (const f of files) {
        if (!f?.dataUrl) continue;
        const blob = await (await fetch(f.dataUrl)).blob();
        if (!blob?.size) continue;
        dt.items.add(new File([blob], String(f.name || `rw-${Date.now()}`), { type: f.type || blob.type || "image/jpeg" }));
      }
      if (!dt.items.length) return { ok: false, error: "no-file" };
      const inputs = [...(dlg || document).querySelectorAll('input[type="file"]'), ...document.querySelectorAll('input[type="file"]')]
        .filter(el => el?.isConnected);
      const input = inputs.find(el => /image|photo|media|video/i.test(el.accept || "")) || inputs[0];
      if (!input) return { ok: false, error: "no-input" };
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 80) }; }
    let stableN = -1;
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (!(await live(id))) return { ok: false, error: "stopped" };
      const scope = dlg?.isConnected ? dlg : document;
      const vids = [...scope.querySelectorAll("video")].filter(el => visible(el));
      const shots = [...scope.querySelectorAll("img")].filter(el => {
        if (!visible(el)) return false;
        const src = String(el.currentSrc || el.src || "");
        if (!(/^blob:|^data:/i.test(src))) return false;
        try { if (!el.complete) return false; } catch (_) { return false; }
        return (el.naturalWidth || 0) >= 100;
      });
      const n = vids.length + shots.length;
      if (n > 0 && n === stableN) return { ok: true };
      stableN = n;
      await sleep(700);
    }
    return { ok: false, error: "no-thumb" };
  }

  // ---- Lên lịch bằng dialog gốc của Facebook (copy flow đã kiểm chứng) ----
  const VI_MONTHS = ["giêng", "hai", "ba", "tư", "năm", "sáu", "bảy", "tám", "chín", "mười", "mười một", "mười hai"];
  const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const docBtns = () => [...document.querySelectorAll('[role="button"],button')].filter(visible);
  function schedConfirmBtn() {
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
    if (!schedConfirmBtn()) {
      const opener = [...composer.querySelectorAll('[role="button"],button')].filter(visible)
        .find(b => (/lên lịch/i.test(labelOf(b)) && !/đăng sau/i.test(labelOf(b))) || /^schedule$/i.test(labelOf(b)));
      if (!opener) return { ok: false, stage: "no-sched-btn" };
      if (!(await trustedClick(opener))) return { ok: false, stage: "sched-click-fail" };
      await sleep(1000);
    }
    if (!(await waitSchedPanel(id))) return { ok: false, stage: "no-sched-panel" };
    if (!(await live(id))) return { ok: false, stage: "stopped" };
    let dateBtn = docBtns().find(b => /mở công cụ chọn ngày|chọn ngày|open.*date|date.*picker/i.test(`${b.getAttribute?.("aria-label") || ""} ${labelOf(b)}`));
    if (!dateBtn) return { ok: false, stage: "no-date-btn" };
    if (!(await trustedClick(dateBtn))) return { ok: false, stage: "date-click-fail" };
    await sleep(1200);
    if (!(await live(id))) return { ok: false, stage: "stopped" };
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
    for (let att = 0; att < 2; att++) {
      if (!(await live(id))) return { ok: false, stage: "stopped" };
      const btn = schedConfirmBtn();
      if (!btn) break;
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

  async function postOneReady(item, id) {
    const cfg = config || {};
    if (!onHomeFeed()) { location.href = "https://www.facebook.com/"; return "navigated"; }
    try {
      if (window.ensurePersonalActor) {
        const actor = await window.ensurePersonalActor();
        if (!actor.ok) { await setStatus("Facebook đang dùng Page, không đăng tường nick"); return "skip"; }
        if (actor.switched) { location.replace("https://www.facebook.com/"); return "navigated"; }
      }
    } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    if (!(await live(id))) return "stopped";
    // Nội dung: AI viết lại hoặc giữ nguyên.
    let content = String(item.text || "");
    if (cfg.mode === "ai") {
      await setStatus("AI đang viết lại bài...");
      const gen = await sendMsg({ action: "aiGenerateNewsPost", news: { title: content.slice(0, 200), desc: content.slice(0, 900) }, topic: "", mode: "long", kind: (item.files || []).length ? "photo" : "text", maxChars: 0, prompt: cfg.prompt || "", aiConfig: cfg.aiConfig || {} });
      if (!(await live(id))) return "stopped";
      if (!gen?.ok) { await setStatus(`AI không viết được (${gen?.error || "?"}) — bỏ bài này`); return "skip"; }
      content = String(gen.content || "");
    }
    if (!content.trim()) { await setStatus("Bài trống — bỏ qua"); return "skip"; }
    if (!(await live(id))) return "stopped";
    // Mở composer + gõ + verify (gõ lại tối đa 3 lần, dọn ô có verify).
    const opener = findWallOpener();
    if (!opener) { await setStatus("Không mở được ô đăng tường"); return "skip"; }
    if (!(await trustedClick(opener))) { await setStatus("Không bấm được ô đăng tường"); return "skip"; }
    const comp0 = await waitEditor(id);
    if (!comp0) { await setStatus("Ô soạn không hiện"); return "skip"; }
    let comp = comp0;
    const norm = s => clean(s).replace(/\s+/g, " ");
    const want = norm(content);
    const wantLen = [...content].length;
    let ok = false, diag = "";
    for (let ta = 0; ta < 3 && !ok; ta++) {
      if (!(await live(id))) return "stopped";
      let pair = (() => { const d = findDialog(); const e = d ? findEditor(d) : null; return d && e ? { dlg: d, ed: e } : null; })();
      if (!pair) { diag = `lan${ta + 1}-mat-o-soan`; await sleep(800); continue; }
      if (norm(editorText(pair.ed))) {
        let cleared = false;
        for (let c = 0; c < 2 && !cleared; c++) {
          try { pair.ed.focus(); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
          await sleep(400);
          cleared = !norm(editorText(pair.ed));
        }
        if (!cleared) {
          try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
          await sleep(1200);
          const op2 = findWallOpener();
          if (!op2 || !(await trustedClick(op2))) { diag = `lan${ta + 1}-mo-lai-that-bai`; continue; }
          const nc = await waitEditor(id);
          if (!nc || norm(editorText(nc.ed))) { diag = `lan${ta + 1}-composer-ban`; continue; }
          comp = nc; pair = { dlg: nc.dlg, ed: nc.ed };
        } else { comp.dlg = pair.dlg; comp.ed = pair.ed; }
      } else { comp.dlg = pair.dlg; comp.ed = pair.ed; }
      try { pair.ed.focus(); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
      await sleep(250);
      const typed = await sendMsg({ action: "trustedInput", text: content, pressEnter: false, typingConfig: cfg.typingConfig || null });
      await sleep(600);
      const gotRaw = editorText(comp.ed);
      const got = norm(gotRaw);
      if (typed?.ok && got === want) { ok = true; break; }
      let diffAt = -1;
      const lim = Math.min(got.length, want.length);
      for (let k = 0; k < lim; k++) { if (got[k] !== want[k]) { diffAt = k; break; } }
      if (diffAt < 0 && got.length !== want.length) diffAt = lim;
      diag = `lan${ta + 1}-go${gotRaw ? [...gotRaw].length : 0}/${wantLen}${typed?.ok ? "" : "-loi-go"}${diffAt >= 0 ? `-lech${diffAt}` : ""}`;
    }
    if (!ok) {
      await setStatus(`Nội dung trong ô không khớp (${diag || "?"}) — không đăng`);
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
      return "skip";
    }
    if (!(await live(id))) return "stopped";
    // Đính file (nếu có).
    if ((item.files || []).length) {
      await setStatus("Đang đính ảnh/video...");
      const at = await attachReadyFiles(item.files, comp.dlg, id);
      if (at.error === "stopped") return "stopped";
      if (!at.ok) await setStatus(`Không đính được file (${at.error}) — đăng chữ`);
      if (!(await live(id))) return "stopped";
    }
    // Hẹn giờ bằng lịch Facebook (fail-closed, không đăng ngay).
    let myAt = Number(item.at) || 0;
    if (myAt && myAt < Date.now() + 2 * 60000) {
      myAt = Date.now() + 6 * 60000;
      // Giờ cũ đã qua — dời +6p và ghi lại vào config để resume không dời tiếp.
      try {
        const s0 = await chrome.storage.local.get([CONFIG_KEY]);
        const cur0 = s0[CONFIG_KEY] || {};
        const arr0 = Array.isArray(cur0.items) ? cur0.items : [];
        const ix0 = arr0.findIndex(x => x && x.id === item.id);
        if (ix0 >= 0) { arr0[ix0] = { ...arr0[ix0], at: myAt }; await chrome.storage.local.set({ [CONFIG_KEY]: { ...cur0, items: arr0 } }); }
      } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
      try { item.at = myAt; } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    }
    if (!myAt) { await setStatus("Thiếu giờ hẹn — bỏ bài này"); return "skip"; }
    if (norm(editorText(comp.ed)) !== want) { await setStatus("Nội dung đổi sau re-render — không hẹn lịch"); return "skip"; }
    await setStatus(`Đang hẹn lịch ${new Date(myAt).toLocaleString("vi-VN")} bằng Facebook...`);
    const sch = await scheduleNativeFB(id, comp, myAt);
    if (!sch?.ok) {
      if (!(await live(id))) return "stopped";
      await setStatus(`Không hẹn được lịch Facebook (${sch?.stage || "?"}) — bỏ bài này`);
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
      return "skip";
    }
    // FB đã nhận lịch (có proof composer đóng) — chốt done NGAY trước khi kiểm
    // tra stop flag, để bấm Dừng đúng lúc này không gây nộp trùng lần sau.
    try {
      const s1 = await chrome.storage.local.get([CONFIG_KEY]);
      const cur1 = s1[CONFIG_KEY] || {};
      const arr1 = Array.isArray(cur1.items) ? cur1.items : [];
      const ix1 = arr1.findIndex(x => x && x.id === item.id);
      if (ix1 >= 0) { arr1[ix1] = { ...arr1[ix1], done: true, skipped: false }; await chrome.storage.local.set({ [CONFIG_KEY]: { ...cur1, items: arr1 } }); }
    } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    try { await chrome.storage.local.set({ readyWallLastAt: Date.now(), readyWallLastScheduledAt: sch.actualMs || myAt }); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    await setStatus(`Đã hẹn lịch Facebook ${sch.slot || ""} ngày ${new Date(sch.actualMs).toLocaleString("vi-VN")}`);
    return "done";
  }

  async function logReadySkip(reason, title) {
    try {
      const s = await chrome.storage.local.get(["readyWallSkipLog"]);
      const list = Array.isArray(s.readyWallSkipLog) ? s.readyWallSkipLog : [];
      list.push({ at: Date.now(), reason: String(reason || "").slice(0, 160), title: String(title || "").slice(0, 80) });
      await chrome.storage.local.set({ readyWallSkipLog: list.slice(-50) });
    } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
  }
  async function readyWallLoop(id) {
    try {
      if (!(await live(id))) return;
      const cfg0 = config || {};
      const items = Array.isArray(cfg0.items) ? cfg0.items.filter(it => it && !it.done && !it.skipped) : [];
      if (!items.length) {
        active = false;
        await chrome.storage.local.set({ [FLAG]: false, readyWallStatus: "Hết bài trong hàng chờ — thêm bài rồi chạy lại" });
        return;
      }
      // Đợi tới giờ hẹn bài đầu (giữ tab, poll stop flag).
      // Nộp dồn lên lịch FB ngay trong phiên này (mỗi bài giữ đúng giờ đã
      // hẹn) thay vì chờ tới giờ mới làm — xong là tắt máy được, không treo
      // tab hàng tuần. Giữa các bài nghỉ theo gap để không dồn Facebook.
      let done = 0, skipped = 0;
      const gapMs = Math.max(15000, Number(cfg0.gapMs) || 180000);
      for (const item of items) {
        if (!(await live(id))) return;
        const res = await postOneReady(item, id);
        if (res === "stopped" || !(await live(id))) return;
        if (res === "navigated") return; // reload sẽ resume (config đã persist)
        try {
          const s = await chrome.storage.local.get([CONFIG_KEY]);
          const cur = s[CONFIG_KEY] || {};
          const arr = Array.isArray(cur.items) ? cur.items : [];
          const ix = arr.findIndex(x => x && x.id === item.id);
          if (ix >= 0) {
            arr[ix] = { ...arr[ix], done: res === "done", skipped: res !== "done" };
            await chrome.storage.local.set({ [CONFIG_KEY]: { ...cur, items: arr } });
          }
        } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
        if (res === "done") {
          done++;
          await chrome.storage.local.set({ readyWallDone: done, readyWallSkipped: skipped });
          await setStatus(`Đã hẹn lịch ${done}/${items.length}: ${String(item.text || "").slice(0, 50)}`);
        } else {
          skipped++;
          try {
            const cur = await chrome.storage.local.get(["readyWallStatus"]);
            if (cur.readyWallStatus) await logReadySkip(cur.readyWallStatus, item.text);
          } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
          await chrome.storage.local.set({ readyWallDone: done, readyWallSkipped: skipped });
        }
        const more = items.indexOf(item) < items.length - 1;
        if (more) {
          await setStatus(`Đã xong ${done + skipped}/${items.length} — nghỉ ${Math.round(gapMs / 1000)}s trước bài tiếp theo...`);
          const until = Date.now() + gapMs;
          while (Date.now() < until) { if (!(await live(id))) return; await sleep(1000); }
        }
      }
      active = false;
      await chrome.storage.local.set({ [FLAG]: false, readyWallStatus: `Hoàn tất đăng tường hẹn giờ: ${done} bài, bỏ qua ${skipped}` });
    } catch (e) {
      console.warn("[ReadyWall]", e);
      active = false;
      try { await chrome.storage.local.set({ [FLAG]: false, readyWallStatus: "Lỗi: " + String(e?.message || e || "").slice(0, 150) }); } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
    } finally { active = false; }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[FLAG]?.newValue === false) { active = false; config = null; }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startReadyWallPost") {
      if (active) { sendResponse({ ok: false, error: "Đang chạy đăng tường" }); return true; }
      config = { ...(message.config || {}) };
      runId = String(message.runId || config.runId || `readywall-${Date.now()}`);
      active = true;
      chrome.storage.local.set({ [FLAG]: true, [RUN_KEY]: runId, readyWallOwnerTabId: message.ownerTabId || sender.tab?.id || 0, [CONFIG_KEY]: { ...config, aiConfig: config.aiConfig ? { provider: config.aiConfig.provider, model: config.aiConfig.model, url: config.aiConfig.url, profileId: config.aiConfig.profileId || "" } : undefined }, readyWallDone: 0, readyWallSkipped: 0, readyWallNextAt: 0, readyWallSkipLog: [], readyWallStatus: "Đang chuẩn bị đăng tường..." }).then(() => readyWallLoop(runId));
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "stopReadyWallPost") {
      active = false; config = null;
      chrome.storage.local.set({ [FLAG]: false, readyWallStatus: "Đã dừng đăng tường" });
      sendResponse({ ok: true });
      return true;
    }
    if (message.action === "resetReadyWallPost") {
      active = false; config = null;
      chrome.storage.local.set({ [FLAG]: false, readyWallDone: 0, readyWallSkipped: 0, readyWallNextAt: 0, readyWallSkipLog: [], readyWallStatus: "Đã reset đăng tường" });
      chrome.storage.local.remove([CONFIG_KEY]).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // Resume khi reload: chỉ owner tab, chỉ khi cờ còn bật.
  (async () => {
    try {
      const s = await chrome.storage.local.get([FLAG, RUN_KEY, CONFIG_KEY, "readyWallOwnerTabId"]);
      if (!s[FLAG] || !s[CONFIG_KEY]) return;
      let ownerOk = true;
      try {
        const r = await new Promise(res => {
          try { chrome.runtime.sendMessage({ action: "getSenderTabId" }, x => res(chrome.runtime.lastError ? null : x)); }
          catch (_) { res(null); }
        });
        if (r?.tabId && s.readyWallOwnerTabId && r.tabId !== s.readyWallOwnerTabId) ownerOk = false;
      } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
      if (!ownerOk) return;
      config = { ...s[CONFIG_KEY] };
      runId = String(s[RUN_KEY] || config.runId || `readywall-${Date.now()}`);
      active = true;
      await sleep(1500);
      if (active) readyWallLoop(runId);
    } catch (_) { console.debug("[Auto vjp][readywall] bỏ qua lỗi:", _); }
  })();

  console.log("[Ready] readywall.js loaded");
})();
