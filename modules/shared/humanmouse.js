// Auto vjp — CHUỘT NGƯỜI, phía trang (2.11.16).
// Namespace `AVJP.human` cho content script.
//
// Lý do tồn tại: automator bấm bằng el.click()/dispatchEvent là sự kiện
// GIẢ (isTrusted=false, không có đường chuột) — nền tảng rất dễ nhận diện
// máy. Module này nhờ service worker phát SỰ KIỆN CHUỘT THẬT qua
// chrome.debugger (CDP Input.dispatchMouseEvent, isTrusted=true) kèm
// đường đi cong Bezier + vọt-quá-đích (xem handler 'humanMouse' trong
// background.js). Phía trang chỉ tính ĐIỂM ĐÍCH (luôn nằm TRONG khung
// phần tử, lệch ngẫu nhiên quanh tâm ±35% kích thước) rồi gửi tọa độ.
//
// Kỷ luật fallback — không bao giờ tệ hơn cách cũ:
// - Công tắc TẮT (storage.local 'autovjp.humanMouse' === false) ->
//   clickEl đi thẳng el.click(), scrollBy đi thẳng window.scrollBy.
// - SW báo lỗi / treo quá 6 giây / debugger bị lõi FB giữ độc quyền ->
//   rơi về el.click() / window.scrollBy và trả false.
// Mặc định BẬT khi chưa có key trong storage.
//
// File này do kernel nạp TRƯỚC module qua contract (scripts()) — lane
// contract lo việc nạp. Module nào không thấy AVJP.human (inject cũ)
// phải tự dùng đường bấm cũ của nó, đừng chờ.
(() => {
  window.AVJP = window.AVJP || {};
  if (window.AVJP.human) return;

  const STORE_KEY = 'autovjp.humanMouse';
  const SW_TIMEOUT_MS = 6000;          // trần chờ SW cho 1 lệnh chuột
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  // Công tắc: đọc 1 lần rồi nhớ; storage.onChanged cập nhật nóng để
  // tắt/bật có hiệu lực ngay không cần nạp lại trang.
  let enabledCache = null;
  async function isEnabled() {
    if (enabledCache !== null) return enabledCache;
    try {
      const got = await chrome.storage.local.get(STORE_KEY);
      enabledCache = !got || got[STORE_KEY] !== false;
    } catch (_) { enabledCache = true; }
    return enabledCache;
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && STORE_KEY in changes) enabledCache = changes[STORE_KEY].newValue !== false;
    });
  } catch (_) { /* môi trường không có storage.onChanged thì đọc lại mỗi phiên */ }

  // Gửi 1 lệnh sang SW; true chỉ khi SW trả {ok:true} trong hạn 6 giây.
  function sendToSw(payload) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish(false), SW_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage(payload, res => {
          clearTimeout(timer);
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) return finish(false);
          finish(!!(res && res.ok));
        });
      } catch (_) { clearTimeout(timer); finish(false); }
    });
  }

  // Điểm đích cho 1 cú click: tâm phần tử + lệch ngẫu nhiên ±35% kích
  // thước mỗi chiều -> điểm luôn nằm trong khung (cách mép >= 15%).
  // Phơi ra (_pickPoint) để harness node kiểm tính chất này.
  function pickPoint(r) {
    const dx = (Math.random() * 2 - 1) * 0.35 * r.width;
    const dy = (Math.random() * 2 - 1) * 0.35 * r.height;
    return {
      x: Math.round(r.left + r.width / 2 + dx),
      y: Math.round(r.top + r.height / 2 + dy)
    };
  }

  // Bấm 1 phần tử bằng chuột thật. Trả true nếu SW đã bấm hộ; false nếu
  // phải fallback el.click() (SW lỗi/tắt công tắc) — nơi gọi KHÔNG được
  // bấm lại lần nữa khi thấy false vì cú fallback đã xảy ra rồi (bấm
  // trùng sẽ thành unlike/bỏ lưu với các nút dạng công tắc).
  async function clickEl(el) {
    if (!el) return false;
    try {
      if (!(await isEnabled())) { el.click(); return false; }
      let r = el.getBoundingClientRect();
      const inView = r.width > 0 && r.height > 0 &&
        r.top >= 0 && r.left >= 0 &&
        r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      if (!inView) {
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) { console.debug("[Auto vjp][humanmouse] bỏ qua lỗi:", _); }
        await sleep(rand(150, 400));
        r = el.getBoundingClientRect();
      }
      if (!r || !(r.width > 0) || !(r.height > 0)) { el.click(); return false; }
      const p = pickPoint(r);
      const ok = await sendToSw({ action: 'humanMouse', kind: 'click', x: p.x, y: p.y });
      if (ok) return true;
      el.click();
      return false;
    } catch (_) {
      try { el.click(); } catch (_) { console.debug("[Auto vjp][humanmouse] bỏ qua lỗi:", _); }
      return false;
    }
  }

  // Cuộn trang bằng bánh xe chuột thật tại giữa viewport (lệch nhẹ
  // ngẫu nhiên). Fallback window.scrollBy khi SW không làm được.
  async function scrollBy(dy) {
    const total = Math.round(Number(dy) || 0);
    try {
      if (!(await isEnabled())) { window.scrollBy(0, total); return false; }
      const x = Math.round(window.innerWidth / 2 + rand(-40, 40));
      const y = Math.round(window.innerHeight / 2 + rand(-40, 40));
      const ok = await sendToSw({ action: 'humanMouse', kind: 'scroll', x, y, dy: total });
      if (ok) return true;
      window.scrollBy(0, total);
      return false;
    } catch (_) {
      try { window.scrollBy(0, total); } catch (_) { console.debug("[Auto vjp][humanmouse] bỏ qua lỗi:", _); }
      return false;
    }
  }

  // Di chuột vô định 1-3 đoạn ngắn trong viewport (chỉ di chuyển,
  // không bấm) — chèn giữa các hành động khi nuôi cho giống người đang
  // rê chuột đọc trang. SW tự vẽ đường cong cho từng đoạn.
  async function wander() {
    try {
      if (!(await isEnabled())) return false;
      const segs = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < segs; i++) {
        const x = Math.round(rand(window.innerWidth * 0.15, window.innerWidth * 0.85));
        const y = Math.round(rand(window.innerHeight * 0.15, window.innerHeight * 0.85));
        const ok = await sendToSw({ action: 'humanMouse', kind: 'move', x, y });
        if (!ok) return false;
        await sleep(rand(80, 260));
      }
      return true;
    } catch (_) { return false; }
  }

  window.AVJP.human = { clickEl, scrollBy, wander, _pickPoint: pickPoint };
})();
