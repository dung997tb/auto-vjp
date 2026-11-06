/* Auto vjp — modules/nurture-core/nurture-core.js (2.2.0, viết mới).
 * LÕI NUÔI DÙNG CHUNG cho mọi nền tảng (instagram/threads/x/youtube...), xây
 * theo đúng cơ chế quản lý + đồng bộ dữ liệu của bản gốc FB Auto Tool
 * (friendReengage.js / friendWarm.js — xem README.md cạnh file này):
 *
 *   - Cấu hình user nằm ở chrome.storage.SYNC theo họ key `<prefix><Field>`
 *     (vd instagramNurtureLikePerDay) — sync tự đồng bộ giữa các máy/trình duyệt.
 *   - State run + history + counters + dead nằm ở chrome.storage.LOCAL theo
 *     họ trường của gốc: <prefix>Active/RunId/OwnerTabId/Config/TaskId/Index/
 *     Cursor/Cycle/DoneLike/DoneComment/DoneSave/DoneFollow/Skipped/Status/
 *     LikeHistory/CommentHistory/SaveHistory/FollowHistory/Dead/Counters/
 *     Journal/NextAllowedAt.
 *   - Kỷ luật gốc: persist run TRƯỚC khi điều hướng; mọi vòng chờ dài poll
 *     stop-flag (Active) + RunId; click != success — chỉ ghi history SAU proof;
 *     không proof = uncertain, không đếm vào Done*, không làm lại mù.
 *   - Đường comment AI dùng chung: prompt có {postText} → AI (kernel aitab qua
 *     message getNurtureAiComment) → chữ ký nháp chống trùng → adapter gửi →
 *     waitForProof chờ nội dung hiện thật.
 *
 * Core KHÔNG chứa selector của bất kỳ nền tảng nào — adapter truyền hooks vào.
 * Phơi global: AVJP.nurture = { createStore, DEFAULT_PROMPT, util }.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  if (globalThis.AVJP.nurture) return;

  const LS = chrome.storage.local;
  const SYNC = chrome.storage.sync;
  const DAY = 86400000;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * Math.max(0, b - a);
  const now = () => Date.now();
  const clampInt = (v, def, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  function todayStr() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (_) { return new Date().toISOString().slice(0, 10); }
  }
  // Chuẩn hoá text làm chữ ký chống trùng (gốc feed.js: commentProofSig):
  // thường hoá, bỏ dấu câu/emoji, gộp khoảng trắng.
  function normalizeText(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function commentSignature(s) { return normalizeText(s).slice(0, 200); }
  // Gần trùng kiểu gốc (feed.js: câu AI trùng gần nguyên văn comment đã có thì bỏ):
  // so độ giống Jaccard trên tập từ; >= 0.8 coi là trùng.
  function isNearDuplicate(text, existingTexts) {
    const sig = commentSignature(text);
    if (!sig) return true;
    const words = new Set(sig.split(' '));
    for (const other of existingTexts || []) {
      const o = commentSignature(other);
      if (!o) continue;
      if (o === sig || o.includes(sig) || sig.includes(o)) return true;
      const ow = new Set(o.split(' '));
      let inter = 0;
      for (const w of words) if (ow.has(w)) inter++;
      const union = words.size + ow.size - inter;
      if (union > 0 && inter / union >= 0.8) return true;
    }
    return false;
  }

  // Prompt mặc định — phỏng prompt gốc friendWarm/friendReengage: ngắn, nhắc 1
  // chi tiết cụ thể, cấm bịa tên người/địa danh/số liệu không có trong bài.
  const DEFAULT_PROMPT = 'Đọc bài viết công khai sau và viết 1 bình luận ngắn (<20 từ) bằng tiếng Việt, lịch sự và trung tính như người mới biết, nhắc 1 chi tiết cụ thể trong bài. Không thân mật quá, không bán hàng, không link, không hashtag, không sao chép nguyên văn. Tuyệt đối không nhắc tên người, địa danh hay số liệu không có trong bài viết. CHỈ xuất ra đúng câu bình luận sẽ đăng, không giải thích, không phân tích, không mô tả lại bài viết, không mở đầu bằng "Bài viết" hay "Bài này".\n\nBài viết: {postText}';

  // Cấu hình mặc định của lõi (adapter ghi đè theo nền tảng; thứ tự thắng:
  // DEFAULTS <- storage.sync <- snapshot task). Đơn vị delay: GIÂY.
  const CORE_DEFAULTS = {
    likePerDay: 25, commentPerDay: 10, savePerDay: 20, followPerDay: 5,
    likePerTarget: 2, commentPerTarget: 1, savePerTarget: 1, followPerTarget: 1,
    likePct: 60, savePct: 25, followPct: 10, commentPct: 40,
    delayMin: 8, delayMax: 20,        // giữa 2 đích
    postMin: 3, postMax: 8,           // giữa 2 hành động trên cùng 1 đích
    dwellMin: 3, dwellMax: 7,         // nán đọc 1 đích trước khi tương tác (giây)
    commentGapMin: 45, commentGapMax: 120, // aiNextAllowedAt giữa 2 comment
    deadDays: 30,
    prompt: DEFAULT_PROMPT
  };

  const ACTIONS = ['like', 'comment', 'save', 'follow'];
  const capField = a => a + 'PerDay';
  const perTargetField = a => a + 'PerTarget';
  const historyField = a => a[0].toUpperCase() + a.slice(1) + 'History';
  const doneField = a => 'Done' + a[0].toUpperCase() + a.slice(1);

  function createStore(opts) {
    const prefix = String(opts && opts.prefix || '');
    if (!prefix) throw new Error('nurture-core: thiếu prefix');
    const defaults = { ...CORE_DEFAULTS, ...((opts && opts.defaults) || {}) };
    const K = f => prefix + f;
    const STATE_KEYS = ['Active', 'RunId', 'OwnerTabId', 'Config', 'TaskId', 'Index', 'Cursor', 'Cycle',
      'DoneLike', 'DoneComment', 'DoneSave', 'DoneFollow', 'DoneUncertain', 'Skipped',
      'LikeHistory', 'CommentHistory', 'SaveHistory', 'FollowHistory',
      'Dead', 'Counters', 'Journal', 'Status', 'NextAllowedAt']
      .map(K);

    const getLocal = keys => new Promise(res => {
      try { LS.get(keys, r => res(r || {})); } catch (_) { res({}); }
    });
    const setLocal = obj => new Promise(res => {
      try { LS.set(obj, () => res(true)); } catch (_) { res(false); }
    });
    const getSyncAll = () => new Promise(res => {
      try { SYNC.get(null, r => res(r || {})); } catch (_) { res({}); }
    });

    // --- Cấu hình: DEFAULTS <- sync `<prefix><Field>` (kiểu getSyncCfg của gốc)
    async function getSyncConfig() {
      const s = await getSyncAll();
      const cfg = {};
      for (const k of Object.keys(defaults)) {
        const key = K(k[0].toUpperCase() + k.slice(1));
        cfg[k] = s[key] !== undefined ? s[key] : defaults[k];
      }
      for (const a of ACTIONS) {
        cfg[capField(a)] = clampInt(cfg[capField(a)], defaults[capField(a)], 0, 100000);
        cfg[perTargetField(a)] = clampInt(cfg[perTargetField(a)], defaults[perTargetField(a)], 0, 1000);
      }
      if (typeof cfg.prompt !== 'string' || !cfg.prompt.trim()) cfg.prompt = defaults.prompt;
      return cfg;
    }

    // --- State (kiểu getState/setStatus/alive/waitCancellable của gốc) ---
    async function getState() { return getLocal(STATE_KEYS); }
    async function setState(patch) {
      const obj = {};
      for (const [k, v] of Object.entries(patch || {})) obj[K(k)] = v;
      await setLocal(obj);
    }
    async function setStatus(text) { await setLocal({ [K('Status')]: String(text || '') }); }
    async function alive(runId) {
      const s = await getState();
      if (!s[K('Active')]) return false;
      if (runId && s[K('RunId')] && s[K('RunId')] !== runId) return false;
      return true;
    }
    async function waitCancellable(ms, runId) {
      const end = now() + ms;
      while (now() < end) {
        if (!(await alive(runId))) return false;
        await sleep(Math.min(1000, end - now()));
      }
      return true;
    }
    // Gửi message về kernel có race timeout + poll stop/runId từng giây (gốc:
    // sendCancellable) — chờ AI không bao giờ treo run vĩnh viễn.
    async function sendCancellable(msg, runId, ms) {
      let done = false, outcome = null;
      try {
        chrome.runtime.sendMessage(msg).then(
          r => { outcome = { ok: true, r }; done = true; },
          e => { outcome = { ok: false, err: e }; done = true; }
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

    // --- Vòng đời run: persist TRƯỚC khi điều hướng (luật gốc friendWarm) ---
    async function startRun({ runId, taskId, config }) {
      await setState({
        Active: true, RunId: runId, TaskId: String(taskId || ''),
        Config: config, Index: 0,
        DoneLike: 0, DoneComment: 0, DoneSave: 0, DoneFollow: 0, DoneUncertain: 0,
        Skipped: 0, NextAllowedAt: 0,
        Status: 'Đang chạy phiên nuôi'
      });
      await bumpCounters({ sessions: 1 });
    }
    async function finishRun(statusText) {
      await setState({ Active: false, Status: String(statusText || 'Đã kết thúc phiên') });
    }
    async function claimOwner(runId) {
      const res = await sendCancellable({ action: 'nurtureOwnerPing' }, runId, 10000);
      if (res.ok && res.r && res.r.tabId != null) await setState({ OwnerTabId: res.r.tabId });
      return res.ok && res.r ? res.r.tabId : null;
    }

    // --- Counters theo ngày (nguồn cho trần ngày + nurtureProgress) ---
    async function getCounters() {
      const s = await getLocal([K('Counters')]);
      return (s[K('Counters')] && typeof s[K('Counters')] === 'object') ? s[K('Counters')] : {};
    }
    async function todayCounters() {
      const all = await getCounters();
      return all[todayStr()] || { like: 0, comment: 0, save: 0, follow: 0, uncertain: 0, sessions: 0 };
    }
    async function bumpCounters(delta) {
      const all = await getCounters();
      const t = todayStr();
      const cur = all[t] || { like: 0, comment: 0, save: 0, follow: 0, uncertain: 0, sessions: 0 };
      for (const [k, v] of Object.entries(delta || {})) cur[k] = (Number(cur[k]) || 0) + (Number(v) || 0);
      all[t] = cur;
      // Giữ tối đa 62 ngày gần nhất cho nhẹ storage.
      const days = Object.keys(all).sort();
      while (days.length > 62) delete all[days.shift()];
      await setLocal({ [K('Counters')]: all });
      return cur;
    }

    // --- History vĩnh viễn + trần (chỉ ghi SAU proof — luật gốc) ---
    async function getHistory(action) {
      const s = await getLocal([K(historyField(action))]);
      const h = s[K(historyField(action))];
      return Array.isArray(h) ? h : [];
    }
    function dayOf(at) {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at || 0));
      } catch (_) { return ''; }
    }
    function targetCountToday(history, targetKey) {
      const t = todayStr();
      return history.filter(e => e && e.id === targetKey && (e.day === t || (!e.day && dayOf(e.at) === t))).length;
    }
    async function hasHistory(action, targetKey) {
      const h = await getHistory(action);
      return h.some(e => e && e.id === targetKey);
    }
    // Trần ngày (counters) + trần/đích hôm nay (history) + trần/đích trọn đời
    // cho comment (gốc: commentPerFriend là trần cứng theo history).
    async function canDo(action, targetKey, cfg) {
      const today = await todayCounters();
      if ((Number(today[action]) || 0) >= (Number(cfg[capField(action)]) || 0)) {
        return { ok: false, reason: 'day_cap_' + action };
      }
      const h = await getHistory(action);
      if (targetCountToday(h, targetKey) >= (Number(cfg[perTargetField(action)]) || 0)) {
        return { ok: false, reason: 'target_day_cap_' + action };
      }
      if (action === 'comment' && h.some(e => e && e.id === targetKey)) {
        return { ok: false, reason: 'already_commented' };
      }
      return { ok: true };
    }
    async function recordProof(action, entry) {
      const h = await getHistory(action);
      h.push({ id: entry.id, url: entry.url || '', at: now(), day: todayStr(), runId: entry.runId || '', note: entry.note || '' });
      await setLocal({ [K(historyField(action))]: h.slice(-5000) });
      const s = await getState();
      await setState({ [doneField(action)]: (Number(s[K(doneField(action))]) || 0) + 1 });
      await bumpCounters({ [action]: 1 });
    }
    async function recordUncertain() {
      const s = await getState();
      await setState({ DoneUncertain: (Number(s[K('DoneUncertain')]) || 0) + 1 });
      await bumpCounters({ uncertain: 1 });
    }
    async function recordSkipped() {
      const s = await getState();
      await setState({ Skipped: (Number(s[K('Skipped')]) || 0) + 1 });
    }

    // --- Dead-target có TTL (gốc: DeadWalls/Dead + deadDays) ---
    async function getDead() {
      const s = await getLocal([K('Dead')]);
      const d = s[K('Dead')];
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    }
    async function isDead(targetKey) {
      const d = await getDead();
      const e = d[targetKey];
      if (!e) return false;
      if (e.expiresAt && e.expiresAt < now()) return false;
      return true;
    }
    async function markDead(targetKey, reason, ttlDays) {
      const d = await getDead();
      const ttl = Number(ttlDays) > 0 ? Number(ttlDays) * DAY : 0;
      d[targetKey] = { reason: String(reason || 'dead'), at: now(), expiresAt: ttl ? now() + ttl : 0 };
      // Dọn entry hết hạn khi ghi mới.
      for (const [k, v] of Object.entries(d)) if (v && v.expiresAt && v.expiresAt < now()) delete d[k];
      await setLocal({ [K('Dead')]: d });
    }

    // --- Journal: MỘT định dạng cho mọi nền tảng (trang quản lý đọc đồng nhất)
    // entry: {at, runId, platform, action, target, url, status, note, content?, source?}
    async function journal(entry) {
      const s = await getLocal([K('Journal')]);
      const arr = Array.isArray(s[K('Journal')]) ? s[K('Journal')] : [];
      arr.push({ at: now(), ...entry });
      await setLocal({ [K('Journal')]: arr.slice(-300) });
    }
    async function getJournal(runId) {
      const s = await getLocal([K('Journal')]);
      const arr = Array.isArray(s[K('Journal')]) ? s[K('Journal')] : [];
      return runId ? arr.filter(e => e && e.runId === runId) : arr;
    }

    // --- Pacing: mốc NextAllowedAt giữa 2 comment (gốc feed.js aiNextAllowedAt)
    async function waitNextAllowed(runId) {
      const s = await getState();
      const t = Number(s[K('NextAllowedAt')]) || 0;
      if (t > now()) return waitCancellable(t - now(), runId);
      return alive(runId);
    }
    async function setNextAllowed(cfg) {
      const gap = rnd(Number(cfg.commentGapMin) || 45, Number(cfg.commentGapMax) || 120) * 1000;
      await setState({ NextAllowedAt: now() + gap });
    }

    // --- Đường AI comment dùng chung ---
    function buildPrompt(template, postText) {
      const t = String(template || DEFAULT_PROMPT);
      const body = String(postText || '').slice(0, 1500);
      return t.includes('{postText}') ? t.replace('{postText}', body) : t + '\n\nBài viết: ' + body;
    }
    // Xin AI viết comment qua kernel aitab. Trả {text} hoặc {error|stopped|timeout}.
    async function requestAiComment({ postText, cfg, runId, provider }) {
      const prompt = buildPrompt(cfg.prompt, postText);
      const res = await sendCancellable(
        { action: 'getNurtureAiComment', prompt, provider: provider || undefined },
        runId, 100000
      );
      if (res.stopped) return { stopped: true };
      if (res.timeout) return { error: 'ai_timeout' };
      if (!res.ok || !res.r || !res.r.success || !res.r.text) {
        return { error: (res.r && res.r.error) || (res.err && res.err.message) || 'ai_empty' };
      }
      // AI đôi khi bọc ngoặc kép/câu dẫn — cắt gọn về 1 câu comment.
      let text = String(res.r.text).trim().replace(/^["“”']+|["“”']+$/g, '').split('\n')[0].trim();
      if (!text) return { error: 'ai_empty' };
      return { text: text.slice(0, 300) };
    }

    // --- Proof: chờ điều kiện thành thật (poll + cancellable). checkFn trả
    // truthy = có proof. Hết giờ -> null (adapter ghi uncertain, KHÔNG làm lại).
    async function waitForProof(checkFn, { timeoutMs = 10000, intervalMs = 400, runId } = {}) {
      const end = now() + timeoutMs;
      while (now() < end) {
        if (runId && !(await alive(runId))) return null;
        try { const v = await checkFn(); if (v) return v; } catch (_) {}
        await sleep(intervalMs);
      }
      try { return (await checkFn()) || null; } catch (_) { return null; }
    }

    return {
      prefix, defaults, K, STATE_KEYS,
      getSyncConfig, getState, setState, setStatus, alive, waitCancellable, sendCancellable,
      startRun, finishRun, claimOwner,
      getCounters, todayCounters, bumpCounters,
      getHistory, hasHistory, canDo, recordProof, recordUncertain, recordSkipped,
      isDead, markDead, journal, getJournal,
      waitNextAllowed, setNextAllowed,
      buildPrompt, requestAiComment, waitForProof
    };
  }

  globalThis.AVJP.nurture = {
    createStore,
    DEFAULT_PROMPT,
    CORE_DEFAULTS,
    util: { sleep, rnd, now, clampInt, todayStr, normalizeText, commentSignature, isNearDuplicate }
  };
})();
