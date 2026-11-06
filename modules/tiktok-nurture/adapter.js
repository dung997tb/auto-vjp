/* Auto vjp — modules/tiktok-nurture/adapter.js (VIẾT MỚI, không có ở Farmer gốc).
 * Cầu nối kernel Auto vjp <-> engine TikTok Farmer đã port:
 *   canonical task {platform:'tiktok', type:'nurture', watch_count, like_enabled,
 *   save_enabled, follow_enabled, max_minutes} -> cấu hình + workflow Farmer ->
 *   TF.engine.start() -> progress định kỳ về kernel (action nurtureProgress) ->
 *   kết quả cuối kèm counters + proofs (action nurtureDone) -> kernel ghi receipt.
 *
 * NGUYÊN TẮC PHẠM VI (Dũng chốt 2026-11-04): worker CHỈ thi hành việc được giao.
 * Giới hạn lịch (giờ hoạt động, trần theo lịch...) thuộc TẦNG ĐIỀU PHỐI giao việc,
 * KHÔNG nằm ở worker — adapter này KHÔNG kiểm tra giờ, có task là chạy.
 * Kỷ luật an toàn THI HÀNH vẫn giữ nguyên của Farmer: captcha/checkpoint -> dừng
 * ngay + failed; phân loại post thường/quảng cáo/LIVE; trần xem 90s; verify-by-proof.
 * Workflow đợt 1 loại hẳn 3 module khỏi đường chạy (comment / xem LIVE / đọc
 * comment — danh sách cụ thể ở MODULE.md §6).
 */
(() => {
  if (window.__avjpNurtureAdapter) return;
  window.__avjpNurtureAdapter = true;

  const CANONICAL_KEY = 'currentAutomationRun';
  const LINK_KEY = 'tf_avjp_link_v1'; // liên kết task kernel <-> phiên engine (module tự quản)
  const PROGRESS_MS = 30 * 1000;

  // Mặc định cấu hình Farmer (bản sao TF_DEFAULT_CONFIG của defaults.js gốc —
  // defaults.js không được port vì chứa cả WF mẫu của UI Farmer; xem MODULE.md).
  const DEFAULT_CONFIG = {
    nickLabel: 'tiktok-01',
    tz: 'Asia/Tokyo',
    niche: { keywords: [], hashtags: [], creators: [], blacklist: [] },
    caps: { maxWatchMinPerDay: 60, maxLikePerDay: 20, maxFollowPerDay: 5, maxSavePerDay: 10, maxCommentPerDay: 0, maxMinPerSession: 40 },
    ratios: { likePct: 12, savePct: 3, followPct: 3 },
    cooldownMin: 0,
    stepTimeoutSec: 90,
    activeHours: { from: '08:00', to: '23:00' },
    followEnabled: false,
    disabledModules: [],
    proxy: { enabled: false, config: { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', host: '', port: 0 } } } }
  };

  const sGet = keys => new Promise(resolve => {
    try { chrome.storage.local.get(keys, r => resolve(r || {})); } catch (_) { resolve({}); }
  });
  const sSet = obj => new Promise(resolve => {
    try { chrome.storage.local.set(obj, () => resolve(true)); } catch (_) { resolve(false); }
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clampInt = (v, def, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  function todayStrIn(tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (_) { return new Date().toISOString().slice(0, 10); }
  }
  // Bài học Farmer v1.2.3: config lưu trong storage có thể là JSON string hoặc
  // thiếu caps/activeHours — luôn chuẩn hoá trước khi dùng.
  function buildConfig(stored, task) {
    let cfg = stored;
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (_) { cfg = null; } }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
    const merged = { ...structuredCloneSafe(DEFAULT_CONFIG), ...cfg };
    merged.caps = { ...DEFAULT_CONFIG.caps, ...(cfg.caps || {}) };
    merged.ratios = { ...DEFAULT_CONFIG.ratios, ...(cfg.ratios || {}) };
    merged.niche = { ...DEFAULT_CONFIG.niche, ...(cfg.niche || {}) };
    merged.activeHours = { ...DEFAULT_CONFIG.activeHours, ...(cfg.activeHours || {}) };
    // Payload của task thắng cấu hình lưu:
    const maxMinutes = clampInt(task.max_minutes, 10, 1, 240);
    merged.caps.maxMinPerSession = maxMinutes;
    merged.caps.maxCommentPerDay = 0; // đợt 1 không comment — chặn ở cả tầng cap
    merged.followEnabled = Boolean(task.follow_enabled);
    return merged;
  }
  function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }

  // Workflow nuôi đợt 1 — dịch payload thành bước Farmer. Tương tác để optional:
  // 1 lần verify hụt (vd save_unverified) chỉ bỏ qua bước đó, không giết cả phiên
  // (engine gốc: bước optional fail -> log cảnh báo, WF đi tiếp).
  function buildWorkflow(task, config) {
    const watchCount = clampInt(task.watch_count, 5, 1, 100);
    const maxMinutes = clampInt(task.max_minutes, 10, 1, 240);
    const ratios = config.ratios || DEFAULT_CONFIG.ratios;
    const loopSteps = [{ kind: 'module', moduleId: 'xem_video', params: {} }];
    if (task.like_enabled) {
      loopSteps.push({ kind: 'prob', pct: ratios.likePct, steps: [{ kind: 'module', moduleId: 'like_video', params: {}, optional: true }] });
    }
    if (task.save_enabled) {
      loopSteps.push({ kind: 'prob', pct: ratios.savePct, steps: [{ kind: 'module', moduleId: 'save_video', params: {}, optional: true }] });
    }
    if (task.follow_enabled) {
      loopSteps.push({ kind: 'prob', pct: ratios.followPct, steps: [{ kind: 'module', moduleId: 'follow_creator', params: {}, optional: true }] });
    }
    loopSteps.push({ kind: 'module', moduleId: 'luot_next', params: {} });
    return {
      id: 'wf_avjp_nurture',
      name: 'Auto vjp — Nuôi TikTok',
      version: 1,
      triggers: { manual: true, schedule: null, randomWindow: null },
      steps: [
        { kind: 'module', moduleId: 'kiem_login', params: {} },
        { kind: 'module', moduleId: 'mo_fyp', params: {} },
        { kind: 'loop', times: watchCount, maxMinutes, steps: loopSteps },
        { kind: 'module', moduleId: 'ghi_log', params: { text: 'Hoàn thành phiên nuôi Auto vjp' } }
      ],
      onSuccess: { callWfId: null, delayMin: 0 },
      onFail: { callWfId: null, delayMin: 0 },
      onFinish: { callWfId: null, delayMin: 0 },
      maxRuntimeMin: maxMinutes + 10
    };
  }

  // ---- Trạng thái phía adapter (sống theo trang; phần bền nằm ở tf_runstate_v1) ----
  const state = {
    task: null, link: null, finished: false,
    counters: { watch: 0, like: 0, save: 0, follow: 0, minutes: 0, sessions: 0 },
    captchaSeen: false, progressTimer: null, lastProgressAt: 0
  };

  function proofsFromJournal(journal) {
    const proofs = [];
    let skips = 0;
    for (const e of Array.isArray(journal) ? journal : []) {
      if (!e || e.kind !== 'module' || !e.endedAt) continue;
      const note = String(e.note || '');
      if (e.moduleId === 'xem_video') {
        const m = note.match(/_skip(\d+)/);
        if (m) skips += Number(m[1]);
        if (e.status === 'success') proofs.push({ kind: 'watch', module: e.moduleId, note, path: e.path || '' });
      } else if (e.status === 'success' && e.moduleId === 'like_video') {
        proofs.push({ kind: 'like', module: e.moduleId, note, path: e.path || '' });
      } else if (e.status === 'success' && e.moduleId === 'save_video') {
        proofs.push({ kind: 'save', module: e.moduleId, note, path: e.path || '' });
      } else if (e.status === 'success' && e.moduleId === 'follow_creator') {
        proofs.push({ kind: 'follow', module: e.moduleId, note, path: e.path || '' });
      }
    }
    return { proofs, skips };
  }

  function sendProgress(force) {
    if (state.finished || !state.task) return;
    const now = Date.now();
    if (!force && now - state.lastProgressAt < 15000) return;
    state.lastProgressAt = now;
    try {
      chrome.runtime.sendMessage({
        action: 'nurtureProgress', taskId: state.task.task_id,
        counters: { ...state.counters }
      }).catch(() => {});
    } catch (_) {}
  }

  async function finalize(info) {
    if (state.finished || !state.task) return;
    state.finished = true;
    if (state.progressTimer) clearInterval(state.progressTimer);
    // Chờ sink (content.js) xả xong hàng ghi storage của phiên rồi mới đọc
    // journal/counters authoritative từ tf_runstate_v1.
    let rs = {};
    for (let i = 0; i < 10; i++) {
      await sleep(400);
      const stored = await sGet(['tf_runstate_v1']);
      rs = stored.tf_runstate_v1 || {};
      const hist = Array.isArray(rs.journalHistory) ? rs.journalHistory : [];
      if (hist.length && hist[hist.length - 1].runId === info.runId) break;
    }
    // Counters của engine là TỔNG NGÀY (khởi tạo từ tf_counters_v1) — biên lai
    // chỉ tính phần của PHIÊN này: trừ mốc bắt đầu đã lưu trong link lúc start.
    const endCounters = { ...state.counters, ...pickCounters(rs.countersToday) };
    const startCounters = (state.link && state.link.startCounters) || {};
    const counters = {};
    for (const k of ['watch', 'like', 'save', 'follow', 'minutes', 'sessions']) {
      counters[k] = Math.max(0, Math.round(((endCounters[k] || 0) - (startCounters[k] || 0)) * 100) / 100);
    }
    const { proofs, skips } = proofsFromJournal(rs.journal);
    const journal = Array.isArray(rs.journal) ? rs.journal : [];
    const loginFailed = journal.some(e => e && e.moduleId === 'kiem_login' && e.status === 'failed');

    let status, failure_code, reasonText;
    if (state.captchaSeen || info.reason === 'captcha' || info.outcome === 'captcha') {
      status = 'failed'; failure_code = 'session_expired'; reasonText = 'captcha/checkpoint — dừng ngay theo kỷ luật an toàn';
    } else if (loginFailed) {
      status = 'failed'; failure_code = 'session_expired'; reasonText = 'not_logged_in — tài khoản chưa đăng nhập TikTok';
    } else if (info.outcome === 'success') {
      status = 'success'; failure_code = null; reasonText = 'hoàn thành phiên';
    } else if (info.outcome === 'unknown') {
      status = 'uncertain'; failure_code = 'execution_error'; reasonText = 'kết quả không rõ (unknown) — không đoán, không chạy lại';
    } else if (info.reason === 'deadline_exceeded') {
      status = 'failed'; failure_code = 'task_timeout'; reasonText = 'quá hạn phiên (deadline_exceeded)';
    } else {
      status = 'failed'; failure_code = 'execution_error'; reasonText = String(info.reason || 'failed');
    }
    const message = `Nuôi TikTok: xem ${counters.watch || 0} video (bỏ qua ads/live ${skips}), like ${counters.like || 0}, save ${counters.save || 0}, follow ${counters.follow || 0}, ${Math.round((counters.minutes || 0) * 10) / 10} phút — ${reasonText}`;

    if (state.link) await sSet({ [LINK_KEY]: { ...state.link, done: true, finishedAt: Date.now(), status } });
    try {
      await chrome.runtime.sendMessage({
        action: 'nurtureDone', taskId: state.task.task_id, platform: 'tiktok',
        status, failure_code, resultMessage: message,
        items: proofs, counters, skipped_ads_live: skips
      });
    } catch (err) {
      console.error('[Auto vjp][tiktok-nurture] Không gửi được nurtureDone', err);
    }
  }
  function pickCounters(c) {
    if (!c || typeof c !== 'object') return {};
    const out = {};
    for (const k of ['watch', 'like', 'save', 'follow', 'minutes', 'sessions']) {
      if (Number.isFinite(Number(c[k]))) out[k] = Number(c[k]);
    }
    return out;
  }

  // Listener nhận mọi message TF_* từ engine (do content.js chuyển tiếp) —
  // chỉ để adapter theo dõi tiến độ/kết thúc; việc ghi storage do sink lo.
  window.__AVJP_TF_LISTENER = msg => {
    if (!msg || !msg.type) return;
    if (msg.type === 'TF_COUNTER' && msg.key in state.counters) {
      state.counters[msg.key] = Math.round(((state.counters[msg.key] || 0) + (msg.by == null ? 1 : msg.by)) * 100) / 100;
      sendProgress(false);
    } else if (msg.type === 'TF_CAPTCHA') {
      state.captchaSeen = true;
    } else if (msg.type === 'TF_STOPPED') {
      finalize(msg).catch(err => console.error('[Auto vjp][tiktok-nurture] finalize lỗi', err));
    }
  };

  async function waitLoginState(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const login = TF.getLoginState();
      if (login && login.loggedIn) return 'in';
      if (document.querySelector('button[data-e2e="top-login-button"], button[data-e2e="login-button"]')) return 'out';
      await sleep(1500);
    }
    const login = TF.getLoginState();
    return login && login.loggedIn ? 'in' : 'unknown';
  }

  async function failBeforeStart(failure_code, resultMessage) {
    state.finished = true;
    if (state.link) await sSet({ [LINK_KEY]: { ...state.link, done: true, finishedAt: Date.now(), status: 'failed' } });
    try {
      await chrome.runtime.sendMessage({
        action: 'nurtureDone', taskId: state.task.task_id, platform: 'tiktok',
        status: 'failed', failure_code, resultMessage, items: [], counters: { ...state.counters }, skipped_ads_live: 0
      });
    } catch (_) {}
  }

  async function main() {
    const stored = await sGet([CANONICAL_KEY, LINK_KEY, 'tf_runstate_v1', 'tf_config_v1', 'tf_stage_v1', 'tf_counters_v1']);
    const run = stored[CANONICAL_KEY];
    if (!run || run.type !== 'nurture' || run.platform !== 'tiktok') return;
    if (!window.TF || !TF.engine || !TF.MODULES) return;
    if (TF.engine.running) return;

    state.task = run;
    const task = {
      watch_count: run.watch_count, like_enabled: run.like_enabled,
      save_enabled: run.save_enabled, follow_enabled: run.follow_enabled,
      max_minutes: run.max_minutes
    };
    const link = stored[LINK_KEY];
    const rs = stored.tf_runstate_v1 || {};
    const isMine = link && String(link.taskId) === String(run.task_id);
    if (isMine && link.done) return; // đã báo kết quả cho task này rồi
    state.link = isMine ? link : {
      taskId: String(run.task_id), kernelRunId: run.run_id || null,
      engineRunId: 'avjprun_' + String(run.task_id), wallStart: Date.now(), done: false
    };

    const config = buildConfig(stored.tf_config_v1, task);
    let stage = stored.tf_stage_v1;
    if (!stage || typeof stage !== 'object') {
      stage = { firstSeenDate: todayStrIn(config.tz), overrideDay: null };
      await sSet({ tf_stage_v1: stage });
    }
    const wf = buildWorkflow(task, config);

    // --- Nhánh resume sau điều hướng (thay tryResumeNav của Farmer gốc) ---
    const cp = rs.checkpoint || {};
    const sessionAge = Date.now() - Number(rs.startedAt || state.link.wallStart || Date.now());
    const navFresh = cp.navResume && cp.ts && Date.now() - cp.ts < 10 * 60000;
    const progressFresh = isMine && !cp.navResume && cp.stepIndex != null && sessionAge < 2 * 3600 * 1000;
    if (isMine && (rs.status === 'navigating' || rs.status === 'running') && (navFresh || progressFresh)) {
      if (cp.navResume && !navFresh) {
        await failBeforeStart('execution_error', 'Phiên nuôi gián đoạn: checkpoint điều hướng quá 10 phút (nav_resume_stale).');
        return;
      }
      const loginState = await waitLoginState(20000);
      if (loginState !== 'in') {
        await failBeforeStart('session_expired', loginState === 'out' ? 'not_logged_in — chưa đăng nhập TikTok (resume).' : 'Không xác định được trạng thái đăng nhập sau 20s (resume).');
        return;
      }
      state.counters = { ...state.counters, ...pickCounters(rs.countersToday) };
      TF.engine.start({
        wf, allWorkflows: [wf], config, stage,
        countersToday: rs.countersToday || {},
        resumeFromStep: cp.navResume ? (cp.stepIndex || 0) : (Number(cp.stepIndex) || 0) + 1,
        startedAt: rs.startedAt || state.link.wallStart,
        runId: cp.runId || state.link.engineRunId,
        resumeStack: cp.navResume ? (cp.resumeStack || null) : null
      });
      state.progressTimer = setInterval(() => sendProgress(true), PROGRESS_MS);
      sendProgress(true);
      return;
    }

    // --- Nhánh chạy mới ---
    if (TF.isCaptchaVisible && TF.isCaptchaVisible()) {
      await failBeforeStart('session_expired', 'captcha — thấy lớp phủ captcha ngay khi bắt đầu phiên, dừng không chạy.');
      return;
    }
    const loginState = await waitLoginState(15000);
    if (loginState !== 'in') {
      await failBeforeStart('session_expired', loginState === 'out' ? 'not_logged_in — chưa đăng nhập TikTok.' : 'Không xác định được trạng thái đăng nhập sau 15s.');
      return;
    }
    const countersToday = (stored.tf_counters_v1 || {})[todayStrIn(config.tz)] || {};
    state.counters = { ...state.counters, ...pickCounters(countersToday) };
    state.link = { ...state.link, startCounters: pickCounters(countersToday) };
    await sSet({ [LINK_KEY]: state.link });
    TF.engine.start({
      wf, allWorkflows: [wf], config, stage,
      countersToday, runId: state.link.engineRunId
    });
    state.progressTimer = setInterval(() => sendProgress(true), PROGRESS_MS);
    sendProgress(true);
  }

  main().catch(err => console.error('[Auto vjp][tiktok-nurture] adapter lỗi', err));
})();
