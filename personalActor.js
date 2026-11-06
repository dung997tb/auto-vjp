// personalActor.js — đảm bảo Facebook đang hoạt động bằng TRANG CÁ NHÂN.
//
// Mọi tính năng ngoài tab "Nuôi Page" đều thao tác bằng trang cá nhân. Chúng chỉ
// bấm nút trên trang nên Facebook ghi nhận theo danh tính đang hoạt động: vừa
// chạy Nuôi Page xong mà chạy tiếp tính năng khác thì hành động rơi vào Page
// (đã xác minh thực tế: nhóm 301175154183273 vào danh sách Page thay vì trang
// cá nhân). Đặt ở một file dùng chung để 6 content script còn lại không phải
// nhân bản logic rồi phân kỳ.
//
// Cấu trúc bộ chọn danh tính đã khảo sát trực tiếp trên DOM thật:
//   nút mở    : [aria-haspopup="dialog"][aria-label="Trang cá nhân của bạn"]
//   hộp thoại : [role="dialog"] cùng nhãn đó
//   dòng đầu  : tên danh tính ĐANG dùng
//   nút đổi   : div[role="button"][aria-label="Chuyển sang <Tên>"]
// Khi hộp thoại đóng, Facebook KHÔNG để lại dấu hiệu đáng tin nào về danh tính
// (chuông chỉ ghi "Thông báo, N chưa đọc"), nên phải mở ra đọc mới chắc chắn.
(() => {
  // A programmatic recovery injection may run after a partial content-script
  // load. Only skip when both the actor implementation and its message bridge
  // are known to be installed.
  if (window.__fbPersonalActorReady && window.__fbPersonalActorMessageReady) return;
  window.__fbPersonalActorReady = true;
  // Dọn cờ chuyển danh tính còn sót quá lâu (popup đã chết trước khi đọc).
  try {
    chrome.storage.local.get("personalActorSwitching").then(s => {
      const fl = s.personalActorSwitching;
      if (fl && Date.now() - (fl.at || 0) > 120000) chrome.storage.local.remove("personalActorSwitching");
    }).catch(() => { });
  } catch (_) { }

  // Facebook bản mới dùng nút "Account, your profile" nhưng hộp thoại vẫn
  // giữ aria-label tiếng Việt. Phải nhận cả hai để không bỏ qua actor Page.
  const PICKER_LABEL = /^(?:trang cá nhân của bạn|your profile|account,?\s*(?:your\s+)?profile|tài khoản,?\s*(?:trang cá nhân của bạn)?)/i;
  const SWITCH_PREFIX = /^(?:chuyển sang|switch to)\s+/i;
  const clean = value => String(value || "").replace(/[​-‍⁠﻿]/g, "").replace(/\s+/g, " ").trim();
  const nap = ms => new Promise(r => setTimeout(r, ms));
  const seen = el => {
    if (!el?.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const sameActor = (a, b) => {
    const x = clean(a).toLocaleLowerCase("vi"), y = clean(b).toLocaleLowerCase("vi");
    return !!x && !!y && x.includes(y);
  };

  // Facebook Chrome thường đôi khi mount bộ chọn tài khoản như một container
  // thường (không có role="dialog"), dù accessibility tree vẫn hiển thị
  // "Trang cá nhân của bạn". Chỉ dựa vào role dialog làm actor probe trả rỗng
  // và popup báo sai "Không xác minh được nick cá nhân". Nhận thêm container
  // có marker tài khoản cá nhân hoặc nút chuyển Page; không nhận opener vì
  // opener không chứa hàng actor bên trong.
  const pickerDialog = () => [...document.querySelectorAll('[role="dialog"],[role="menu"],[aria-label]')]
    .filter(seen).find(el => {
      const label = clean(el.getAttribute("aria-label"));
      if (!PICKER_LABEL.test(label)) return false;
      return el.matches('[role="dialog"]') || el.matches('[role="menu"]')
        || !!el.querySelector('a[href*="/me/"],[role="button"][aria-label]');
    }) || null;
  const pickerOpener = () => [...document.querySelectorAll('[aria-haspopup="dialog"],[aria-haspopup="menu"]')]
    .filter(seen).find(el => PICKER_LABEL.test(clean(el.getAttribute("aria-label")))) || null;
  const activeName = dialog => String(dialog?.innerText || "")
    .split("\n").map(line => line.trim()).filter(Boolean)[0] || "";

  async function click(el) {
    if (!seen(el)) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (_) { }
    await nap(220);
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
    // Click theo toạ độ trúng phần tử trên cùng tại điểm đó; chỉ gửi khi điểm
    // giữa thật sự thuộc về chính element, tránh bấm nhầm mục khác trong menu.
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit) || hit.contains(el))) {
      try { const res = await chrome.runtime.sendMessage({ action: "trustedMouse", kind: "click", x, y }); if (res?.ok) return true; } catch (_) { }
    }
    try { el.click(); return true; } catch (_) { return false; }
  }

  async function openPicker() {
    let dialog = pickerDialog();
    if (dialog) return dialog;
    const opener = pickerOpener();
    if (!opener) return null;
    await click(opener);
    for (let i = 0; i < 12 && !dialog; i++) { await nap(300); dialog = pickerDialog(); }
    return dialog;
  }

  async function closePicker() {
    for (let i = 0; i < 5; i++) {
      if (!pickerDialog()) return;
      try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); } catch (_) { }
      await nap(250);
      if (!pickerDialog()) return;
      try { pickerOpener()?.click(); } catch (_) { }
      await nap(300);
    }
  }

  async function managedPages() {
    try { const list = (await chrome.storage.local.get("managedPages")).managedPages; return Array.isArray(list) ? list : []; }
    catch (_) { return []; }
  }
  const isPageName = (name, pages) => pages.some(page => sameActor(name, page?.name));

  function switchTargets(dialog) {
    return [...dialog.querySelectorAll('[role="button"][aria-label]')].filter(seen)
      .map(el => ({ el, aria: clean(el.getAttribute("aria-label")) }))
      .filter(item => SWITCH_PREFIX.test(item.aria))
      .map(item => ({ el: item.el, name: item.aria.replace(SWITCH_PREFIX, "") }));
  }

  // {ok:true}                -> đang đúng trang cá nhân
  // {ok:true, switched:true} -> vừa đổi; trang đang render theo danh tính cũ,
  //                             người gọi phải tải lại/điều hướng trước khi thao tác
  // {ok:false, page:"<tên>"} -> đang ở Page và không tự đổi về được
  async function ensurePersonalActor() {
    const pages = await managedPages();
    // Không có Page đã lưu thì không có danh tính Page nào để đối chiếu; giữ
    // hành vi cũ nhưng báo rõ đã xác minh theo phạm vi hiện có.
    if (!pages.length) return { ok: true, verified: true, actorName: "" };
    let remembered = "";
    try { remembered = clean((await chrome.storage.local.get("personalActorName")).personalActorName || ""); } catch (_) { }

    for (let attempt = 0; attempt < 3; attempt++) {
      const dialog = await openPicker();
      // Không đọc được bộ chọn danh tính thì tuyệt đối không được coi là đang
      // ở nick cá nhân: scheduler có thể đang đứng dưới Page nhưng content
      // script cũ/chưa mount. Gọi lại vài lần rồi fail-closed.
      if (!dialog) {
        if (attempt < 2) { await nap(700); continue; }
        // Opener không tìm thấy sau 3 lần — Facebook có thể đã đổi UI.
        // Fallback: nếu tên nick đã lưu từ lần trước không phải Page, tin vào đó.
        try {
          const saved = clean((await chrome.storage.local.get("personalActorName")).personalActorName || "");
          if (saved && !isPageName(saved, pages)) return { ok: true, verified: false, actorName: saved };
        } catch (_) { }
        return { ok: false, code: "ACTOR_UNVERIFIED", page: "" };
      }
      const active = clean(activeName(dialog));
      if (!isPageName(active, pages)) {
        // Danh tính không nằm trong danh sách Page => đây là trang cá nhân.
        if (active) chrome.storage.local.set({ personalActorName: active });
        await closePicker();
        return { ok: true, verified: true, actorName: active };
      }
      const targets = switchTargets(dialog);
      const target = (remembered && targets.find(item => sameActor(item.name, remembered)))
        || targets.find(item => !isPageName(item.name, pages));
      if (!target) { await closePicker(); return { ok: false, page: active }; }
      // Ghi cờ TRƯỚC khi bấm: Facebook reload trang ngay khi đổi danh tính
      // thật, giết content script cùng kênh trả lời — popup đọc cờ này để
      // vẫn biết đã chuyển và chờ trang ổn định thay vì thao tác mù.
      try { await chrome.storage.local.set({ personalActorSwitching: { to: clean(target.name), at: Date.now() } }); } catch (_) { }
      if (!(await click(target.el))) { await closePicker(); continue; }
      chrome.storage.local.set({ personalActorName: clean(target.name) });
      for (let i = 0; i < 20; i++) { await nap(500); if (!pickerDialog()) break; }
      await nap(1200);
      return { ok: true, switched: true, verified: false, actorName: clean(target.name) };
    }
    const dialog = pickerDialog();
    const active = dialog ? clean(activeName(dialog)) : "";
    await closePicker();
    return { ok: false, page: active };
  }

  window.ensurePersonalActor = ensurePersonalActor;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action !== "ensurePersonalActor") return;
    // Không được nuốt lỗi thành {ok:true}: popup sẽ coi đó là phản hồi hợp lệ
    // nhưng thiếu verified rồi báo sai chung chung. Trả mã lỗi rõ ràng để
    // caller fail-closed và có thể phân biệt probe lỗi với Page đang hoạt động.
    ensurePersonalActor().then(sendResponse).catch(error => {
      const detail = clean(error?.message || error || "unknown");
      try {
        chrome.storage.local.set({ personalActorDebug: {
          at: Date.now(), code: "ACTOR_PROBE_ERROR", detail
        } });
      } catch (_) { }
      sendResponse({ ok: false, code: "ACTOR_PROBE_ERROR", detail });
    });
    return true;
  });
  window.__fbPersonalActorMessageReady = true;
})();
