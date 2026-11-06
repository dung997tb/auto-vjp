/* Auto vjp — kernel heal: phía SW của cơ chế TỰ CHỮA SELECTOR (2.9.0).
 * Xem modules/shared/HEALER.md. Ba việc:
 *  - Lưu selector đã học: storage.local `autovjp.learnedSelectors`
 *    dạng {"platform:key": {spec, at, hits}}. CHỈ ghi qua
 *    healMarkProven — tức module đã dùng phần tử (do AI gợi ý) đạt
 *    PROOF thật mới gọi. Đoán chưa proof không bao giờ được lưu.
 *  - healSuggest: dựng prompt chặt từ intent + snapshot DOM của trang,
 *    gọi AI qua ĐÚNG đường getNurtureAiComment đang dùng (API lõi
 *    getPageAiConfig/callConfiguredText, dự phòng aitab), parse JSON
 *    phòng thủ, validate từng spec. AI lỗi/sai format -> mảng rỗng,
 *    module fail như cũ — không treo, không đoán bừa.
 *  - healGetLearned / healMarkProven / healForget / healForgetAll.
 * results.js là nơi đăng ký action vào listener duy nhất; file này
 * chỉ phơi AVJP.healCore.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;
  const K = S.KEYS;
  const SUGGEST_DEADLINE_MS = 70000;   // deadline riêng cho healSuggest (< trần module)
  const MAX_SPECS = 5;
  const MAX_VALUE_LEN = 120;

  // ── Validate spec (gương của bản phía trang trong healer.js) ──
  function validateSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
    if (!['aria', 'text', 'svgTitle', 'css'].includes(spec.by)) return false;
    if (typeof spec.value !== 'string' || !spec.value.trim() || spec.value.length > MAX_VALUE_LEN) return false;
    if (spec.by === 'css') {
      const v = spec.value;
      if (/:has\s*\(/i.test(v) || /xpath/i.test(v) || v.trim().startsWith('/')) return false;
    }
    if (spec.tag != null && (typeof spec.tag !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(spec.tag) || spec.tag.length > 30)) return false;
    return true;
  }
  const cleanSpec = spec => {
    const out = { by: spec.by, value: String(spec.value).trim() };
    if (spec.tag) out.tag = String(spec.tag).toLowerCase();
    return out;
  };
  const storeKeyOf = (platform, key) => `${String(platform || '')}:${String(key || '')}`;

  async function readAll() {
    const all = await S.get(K.LEARNED);
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  }

  async function getLearned(platform, key) {
    const all = await readAll();
    const entry = all[storeKeyOf(platform, key)];
    return entry && validateSpec(entry.spec) ? entry : null;
  }

  // Ghi selector đã qua proof. Cùng spec -> hits+1; spec khác -> thay
  // mới với hits=1. Validate cứng ở đây — phía trang nói gì cũng kiểm.
  async function markProven(platform, key, spec) {
    if (!platform || !key || !validateSpec(spec)) return false;
    const cleaned = cleanSpec(spec);
    return S.withLock(async () => {
      const all = await readAll();
      const id = storeKeyOf(platform, key);
      const prev = all[id];
      const same = prev && prev.spec && prev.spec.by === cleaned.by && prev.spec.value === cleaned.value && (prev.spec.tag || '') === (cleaned.tag || '');
      all[id] = { spec: cleaned, at: Date.now(), hits: same ? (Number(prev.hits) || 0) + 1 : 1 };
      await S.set({ [K.LEARNED]: all });
      return true;
    });
  }

  async function forget(id) {
    return S.withLock(async () => {
      const all = await readAll();
      if (!(id in all)) return false;
      delete all[id];
      await S.set({ [K.LEARNED]: all });
      return true;
    });
  }

  async function forgetAll() {
    await S.set({ [K.LEARNED]: {} });
    return true;
  }

  // ── AI gợi ý ──
  function buildPrompt({ platform, key, intent, snapshot }) {
    return [
      'Bạn là bộ định vị phần tử giao diện (UI locator) cho công cụ tự động hoá trình duyệt.',
      `Nền tảng: ${platform}. Điểm neo cần tìm (key): ${key}.`,
      `Mục đích của phần tử: ${intent || '(không mô tả)'}`,
      'Dưới đây là snapshot DOM rút gọn của trang hiện tại (mảng JSON các phần tử tương tác: tag/role/aria/text/svg/e2e/id).',
      'Hãy chọn tối đa 5 ứng viên có khả năng nhất là phần tử cần tìm, theo thứ tự ưu tiên giảm dần.',
      'Mỗi ứng viên là 1 object spec: {"by":"aria"|"text"|"svgTitle"|"css","value":"...","tag":"...(tuỳ chọn)"}.',
      '- by=aria: value là aria-label chính xác của phần tử.',
      '- by=text: value là đúng đoạn text hiển thị ngắn của phần tử (không phải cả câu dài).',
      '- by=svgTitle: value là text trong <title> của svg icon hoặc aria-label của svg.',
      '- by=css: value là CSS selector ngắn, ổn định (ưu tiên #id hoặc [data-e2e="..."]); cấm :has(), cấm xpath.',
      'value tối đa 120 ký tự. Chỉ dùng thông tin có trong snapshot, không bịa aria-label/text không tồn tại.',
      'CHỈ trả về đúng 1 mảng JSON các spec, không giải thích, không markdown, không text nào khác.',
      '',
      'SNAPSHOT:',
      String(snapshot || '[]').slice(0, 12 * 1024)
    ].join('\n');
  }

  // Parse phòng thủ: bóc fence, cắt mảng JSON đầu tiên, parse, lọc spec hợp lệ.
  function parseSpecs(raw) {
    if (!raw) return [];
    let text = String(raw).trim();
    text = text.replace(/```(?:json)?/gi, '').trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    let arr = null;
    try { arr = JSON.parse(text.slice(start, end + 1)); } catch (_) { return []; }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const item of arr) {
      if (out.length >= MAX_SPECS) break;
      if (validateSpec(item)) out.push(cleanSpec(item));
    }
    return out;
  }

  async function callAi(prompt) {
    const g = globalThis;
    if (typeof g.getPageAiConfig === 'function' && typeof g.callConfiguredText === 'function') {
      const ai = await g.getPageAiConfig({});
      if (ai && (ai.provider === 'meta-free' || ai.key)) {
        const raw = await g.callConfiguredText(ai.provider, ai.key, ai.model, ai.url, '', prompt, null, 'heal-suggest');
        if (raw) return String(raw);
      }
    }
    // Dự phòng aitab (tab ChatGPT/Gemini) — cùng đường getNurtureAiComment.
    const text = await globalThis.AVJP.aitab.generateCaption(prompt);
    return text ? String(text) : '';
  }

  async function suggest(input) {
    const prompt = buildPrompt(input || {});
    let timer = null;
    try {
      const raw = await Promise.race([
        callAi(prompt),
        new Promise(resolve => { timer = setTimeout(() => resolve(''), SUGGEST_DEADLINE_MS); })
      ]);
      return parseSpecs(raw);
    } catch (_) {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  globalThis.AVJP.healCore = { validateSpec, getLearned, markProven, forget, forgetAll, readAll, suggest, parseSpecs };
})();
