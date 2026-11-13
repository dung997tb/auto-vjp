// Auto vjp — TỰ CHỮA SELECTOR, phía trang (2.9.0).
// Namespace `AVJP.heal` cho content script. Thiết kế 3 lớp đã duyệt
// (plan-dang-story-reels-shorts.md, bổ sung 12:45):
//   locate() thử theo thứ tự: (a) selector ĐÃ HỌC (SW lưu trong
//   autovjp.learnedSelectors, chỉ chứa spec đã qua PROOF hành động
//   thật), (b) builtins của module, (c) xin AI gợi ý ứng viên từ
//   snapshot DOM hiện tại (action healSuggest ở SW) rồi thử từng ứng
//   viên — chỉ nhận phần tử HIỂN THỊ + KHÔNG disabled.
//   markProven() chỉ được module gọi SAU KHI hành động dùng phần tử
//   (tìm qua AI) đã đạt proof thật của chính module đó; spec đoán mò
//   chưa proof không bao giờ được lưu (SW còn validate lại format).
//
// Spec thống nhất: {by:'aria'|'text'|'svgTitle'|'css', value, tag?}.
// 'css' bị giới hạn: tối đa 120 ký tự, cấm :has() và xpath.
//
// File này được kernel nạp TRƯỚC module trong contract (scripts()),
// chỉ phơi window.AVJP.heal — module nào không thấy AVJP.heal (inject
// cũ/thiếu file) phải tự rơi về finder gốc của nó.
(() => {
  window.AVJP = window.AVJP || {};
  if (window.AVJP.heal) return;

  const LOCATE_BUDGET_MS = 45000;      // trần tổng cho 1 lần locate()
  const SW_FAST_MS = 5000;             // trần chờ healGetLearned
  const MAX_SNAPSHOT_ITEMS = 120;      // tối đa phần tử tương tác trong snapshot
  const MAX_SNAPSHOT_BYTES = 12 * 1024;
  const MAX_VALUE_LEN = 120;

  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isUsable(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.disabled === true) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    try {
      const style = window.getComputedStyle ? getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    } catch (_) { /* không đọc được style thì tin rect */ }
    return true;
  }

  // ── Spec: validate + dịch spec -> phần tử ──
  function validateSpec(spec) {
    if (!spec || typeof spec !== 'object') return false;
    if (!['aria', 'text', 'svgTitle', 'css'].includes(spec.by)) return false;
    if (typeof spec.value !== 'string' || !spec.value.trim() || spec.value.length > MAX_VALUE_LEN) return false;
    if (spec.by === 'css') {
      const v = spec.value;
      if (/:has\s*\(/i.test(v) || /xpath/i.test(v) || v.trim().startsWith('/')) return false;
    }
    if (spec.tag != null && (typeof spec.tag !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(spec.tag) || spec.tag.length > 30)) return false;
    return true;
  }

  const CLICKABLE = 'a, button, [role="button"], [role="menuitem"], [role="tab"], input, textarea, select, [contenteditable="true"], [tabindex]';
  const tagOk = (el, spec) => !spec.tag || (el.tagName || '').toLowerCase() === spec.tag.toLowerCase();

  function resolveSpec(spec, root) {
    if (!validateSpec(spec)) return null;
    const scope = root || document;
    const value = norm(spec.value);
    try {
      if (spec.by === 'css') {
        const hits = scope.querySelectorAll(spec.value);
        for (const el of hits) if (tagOk(el, spec)) return el;
        return null;
      }
      if (spec.by === 'aria') {
        const hits = scope.querySelectorAll('[aria-label]');
        for (const el of hits) {
          if (norm(el.getAttribute('aria-label')) !== value) continue;
          if ((el.tagName || '').toLowerCase() === 'svg') {
            const host = el.closest('a, button, [role="button"], [role="menuitem"]');
            if (host) { if (tagOk(host, spec) || !spec.tag) return host; }
            return el;
          }
          if (tagOk(el, spec)) return el;
        }
        return null;
      }
      if (spec.by === 'svgTitle') {
        const svgs = scope.querySelectorAll('svg');
        for (const svg of svgs) {
          const title = svg.querySelector('title');
          const label = norm(title?.textContent || svg.getAttribute('aria-label') || '');
          if (label !== value) continue;
          const host = svg.closest('a, button, [role="button"], [role="menuitem"]') || svg;
          if (tagOk(host, spec) || !spec.tag) return host;
          return host;
        }
        return null;
      }
      // by 'text': khớp chính xác sau chuẩn hoá; ưu tiên phần tử nhỏ
      // nhất (sâu nhất) để tránh trúng container. Dự phòng: bắt đầu
      // bằng value (value >= 3 ký tự).
      const hosts = scope.querySelectorAll(CLICKABLE + ', span, div');
      let prefixHit = null;
      for (const el of hosts) {
        if (!tagOk(el, spec)) continue;
        const ownText = norm(el.innerText || el.textContent || '');
        if (!ownText) continue;
        if (ownText === value) {
          // Chỉ nhận nếu không có con nào cũng khớp (tránh container).
          const childMatch = [...el.children].some(c => norm(c.innerText || c.textContent || '') === value);
          if (!childMatch) return el;
        }
        if (!prefixHit && value.length >= 3 && ownText.startsWith(value)) prefixHit = el;
      }
      return prefixHit;
    } catch (_) {
      return null; // selector css hỏng -> coi như không trúng, không throw
    }
  }

  // ── Snapshot DOM gọn cho AI ──
  function captureSnapshot(root) {
    const scope = root || document.body || document;
    const selector = 'a, button, input, textarea, select, [role="button"], [role="menuitem"], [role="tab"], [role="textbox"], [contenteditable="true"], [tabindex], svg[aria-label], [data-e2e]';
    let nodes = [];
    try { nodes = [...scope.querySelectorAll(selector)]; } catch (_) { nodes = []; }
    const items = [];
    const seen = new Set();
    for (const el of nodes) {
      if (items.length >= MAX_SNAPSHOT_ITEMS) break;
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      const item = { tag: (el.tagName || '').toLowerCase() };
      const role = el.getAttribute && el.getAttribute('role');
      if (role) item.role = role.slice(0, 30);
      const aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria) item.aria = aria.replace(/\s+/g, ' ').trim().slice(0, 60);
      const e2e = el.getAttribute && el.getAttribute('data-e2e');
      if (e2e) item.e2e = e2e.slice(0, 40);
      if (el.id && el.id.length <= 40) item.id = el.id;
      const svg = (el.tagName || '').toLowerCase() === 'svg' ? el : (el.querySelector ? el.querySelector('svg') : null);
      const svgTitle = svg ? (svg.querySelector('title')?.textContent || svg.getAttribute('aria-label') || '') : '';
      if (svgTitle) item.svg = svgTitle.replace(/\s+/g, ' ').trim().slice(0, 40);
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && !(item.aria && text === item.aria)) item.text = text.slice(0, 60);
      if (rect.width <= 0 || rect.height <= 0) item.hidden = 1;
      const fingerprint = JSON.stringify(item);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      items.push(item);
    }
    // Cắt dần tới khi vừa 12KB (JSON).
    while (items.length > 10 && JSON.stringify(items).length > MAX_SNAPSHOT_BYTES) {
      items.splice(Math.floor(items.length / 2), 10);
    }
    let json = JSON.stringify(items);
    if (json.length > MAX_SNAPSHOT_BYTES) json = json.slice(0, MAX_SNAPSHOT_BYTES);
    return json;
  }

  // ── Cầu message tới SW có deadline riêng (không treo module) ──
  function sendHeal(payload, timeoutMs) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        chrome.runtime.sendMessage(payload, response => {
          if (chrome.runtime.lastError) { finish(null); return; }
          finish(response || null);
        });
      } catch (_) { finish(null); }
    });
  }

  // ── locate(): learned -> builtin -> AI ──
  // args: {platform, key, intent, builtins:[spec], root?, timeoutMs?}
  // Trả {el, spec, via:'learned'|'builtin'|'ai'} hoặc null.
  async function locate(args) {
    const platform = String(args?.platform || '');
    const key = String(args?.key || '');
    const root = args?.root || null;
    const builtins = Array.isArray(args?.builtins) ? args.builtins.filter(validateSpec) : [];
    const budget = Math.min(Number(args?.timeoutMs) || LOCATE_BUDGET_MS, LOCATE_BUDGET_MS);
    const deadline = Date.now() + budget;
    if (!platform || !key) return null;

    // (a) Đã học
    const learnedRes = await sendHeal({ action: 'healGetLearned', platform, key }, Math.min(SW_FAST_MS, Math.max(500, deadline - Date.now())));
    if (learnedRes?.success && learnedRes.spec && validateSpec(learnedRes.spec)) {
      const el = resolveSpec(learnedRes.spec, root);
      if (el && isUsable(el)) return { el, spec: learnedRes.spec, via: 'learned' };
    }

    // (b) Builtins của module
    for (const spec of builtins) {
      const el = resolveSpec(spec, root);
      if (el && isUsable(el)) return { el, spec, via: 'builtin' };
    }
    if (Date.now() >= deadline) return null;

    // (c) AI gợi ý từ snapshot hiện tại
    const snapshot = captureSnapshot(root);
    const remain = Math.max(1000, deadline - Date.now());
    const suggestRes = await sendHeal(
      { action: 'healSuggest', platform, key, intent: String(args?.intent || ''), snapshot },
      remain
    );
    if (suggestRes?.success && Array.isArray(suggestRes.specs)) {
      for (const spec of suggestRes.specs) {
        if (!validateSpec(spec)) continue;
        const el = resolveSpec(spec, root);
        if (el && isUsable(el)) return { el, spec, via: 'ai' };
      }
    }
    return null;
  }

  // ── markProven(): module gọi SAU proof thật. Fire-and-forget. ──
  function markProven(args) {
    try {
      const platform = String(args?.platform || '');
      const key = String(args?.key || '');
      const spec = args?.spec || null;
      if (!platform || !key || !validateSpec(spec)) return;
      chrome.runtime.sendMessage({ action: 'healMarkProven', platform, key, spec }, () => void chrome.runtime.lastError);
    } catch (_) { /* tự chữa là phụ trợ — không bao giờ làm hỏng module */ }
  }

  window.AVJP.heal = { locate, markProven, captureSnapshot, resolveSpec, validateSpec, isUsable };
})();
