/* Auto vjp — kernel fbtask (2.13.0): CẦU NỐI hàng đợi kernel -> bộ hẹn giờ của lõi Facebook.
 *
 * Lõi FB (background.js) đã có sẵn bộ máy chạy 23 tính năng từ nền
 * (normalizeScheduledTask / launchScheduledTask / completion evidence của
 * chuỗi). File này KHÔNG viết lại tính năng nào: nó nhận task
 * {platform:'facebook', type:'fb_feature', feature, config} từ hàng đợi kernel,
 * nhờ lõi khởi chạy, rồi theo dõi cờ "đang chạy" + bằng chứng hoàn tất của lõi
 * để ra receipt. Nhờ đó việc Facebook đi chung hàng đợi, chung nhật ký và chung
 * kênh báo về hub với 5 nền tảng còn lại.
 *
 * NGOẠI LỆ HỢP ĐỒNG (ghi ở MODULE-CONTRACT §1): đây là file kernel DUY NHẤT
 * được gọi hàm của lõi FB và ĐỌC key storage của lõi (cờ active, bộ đếm, dòng
 * trạng thái, danh sách lịch). Nó không ghi key nào của lõi.
 *
 * Theo dõi theo nhịp (runner.watchdog gọi tick() mỗi phút) nên sống qua việc
 * service worker bị tắt: mọi trạng thái nằm trong canonical run (phase,
 * fb_tab_id, fb_launch_at).
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;

  const WAIT_BUSY_MAX_MS = 60 * 60 * 1000;   // chờ tính năng khác của lõi chạy xong tối đa 60 phút
  const LAUNCH_GRACE_MS = 4 * 60 * 1000;     // lõi khởi chạy (mở tab, đổi actor, gửi lệnh) tối đa ~4 phút
  const TEMPLATE_MAX = 20;
  const TEMPLATE_BYTES = 150 * 1000;

  /* global normalizeScheduledTask, launchScheduledTask, hasActiveFeature, scheduleChainCompletionEvidence,
     SCHEDULE_CHAIN_STATE_KEYS, scheduledActiveKey, scheduleChainStatusKey, scheduleChainStopAction,
     sendScheduledTabMessage, scheduledTasks */
  function available() {
    return typeof normalizeScheduledTask === 'function' && typeof launchScheduledTask === 'function'
      && typeof scheduledActiveKey === 'function';
  }

  // validate(input) -> {feature, label, config} đã qua bộ chuẩn hoá của lõi. Ném lỗi tiếng Việt của lõi.
  function validate(input) {
    if (!available()) throw new Error('Lõi Facebook không khả dụng trong phiên này');
    if (!input || typeof input !== 'object') throw new Error('task phải là object');
    if (input.kind === 'chain') throw new Error('Chưa hỗ trợ giao chuỗi Facebook từ hàng đợi; hãy giao từng bước');
    const config = input.config && typeof input.config === 'object' ? input.config : {};
    // runAt chỉ để qua bước kiểm "phải sau hiện tại" của lõi — việc được khởi chạy ngay, không đặt alarm.
    const task = normalizeScheduledTask({ feature: input.feature, label: input.label, config, runAt: Date.now() + 60000 });
    return { feature: task.feature, label: task.label || task.feature, config: task.config || {} };
  }

  function coreTask(run) {
    const t = validate(run);
    return { id: 'kernel:' + run.task_id, feature: t.feature, label: t.label, config: t.config, runAt: Date.now() };
  }

  async function deliver(run, status, message, extra) {
    watching = false;
    return globalThis.AVJP.outbox.deliver({
      type: run.type, taskId: run.task_id, platform: 'facebook', forceCleanup: true,
      status, resultMessage: message, ...(extra || {})
    });
  }

  let launching = false;
  let watching = false;

  async function launch(run) {
    if (launching) return;
    launching = true;
    try {
      let task;
      try { task = coreTask(run); } catch (err) {
        return await deliver(run, 'failed', 'Cấu hình việc Facebook không hợp lệ: ' + (err?.message || err), { failure_code: 'fb_invalid_config' });
      }
      if (await hasActiveFeature()) {
        await S.touchRun({ phase: 'fb_waiting', lastActiveAt: Date.now() });
        return;
      }
      await S.touchRun({ phase: 'fb_launching', fb_launch_at: Date.now(), lastActiveAt: Date.now() });
      try {
        const started = await launchScheduledTask(task);
        const fresh = await S.getRun();
        if (!fresh || String(fresh.task_id) !== String(run.task_id)) return; // bị huỷ trong lúc khởi chạy
        watching = true;
        await S.touchRun({ phase: 'fb_running', fb_tab_id: started?.tabId || null, fb_run_id: started?.runId || null, lastActiveAt: Date.now() });
      } catch (err) {
        const fresh = await S.getRun();
        if (!fresh || String(fresh.task_id) !== String(run.task_id)) return;
        await deliver(run, 'failed', 'Không khởi chạy được tính năng Facebook: ' + (err?.message || err), { failure_code: 'fb_launch_failed' });
      }
    } finally {
      launching = false;
    }
  }

  // start(run): runner gọi khi claim. Không chờ — khởi chạy mất tới vài phút.
  function start(run) {
    launch(run).catch(err => console.error('[Auto vjp][fbtask] launch', err));
  }

  async function readCoreState(task) {
    const activeKey = scheduledActiveKey(task);
    const statusKey = typeof scheduleChainStatusKey === 'function' ? scheduleChainStatusKey(task) : null;
    const keys = (typeof SCHEDULE_CHAIN_STATE_KEYS !== 'undefined' ? SCHEDULE_CHAIN_STATE_KEYS : []).concat([activeKey, statusKey].filter(Boolean));
    const state = await chrome.storage.local.get([...new Set(keys)]);
    const counters = {};
    for (const [key, value] of Object.entries(state)) {
      if (typeof value === 'number' && value > 0) counters[key] = value;
    }
    return { state, active: Boolean(state[activeKey]), statusText: statusKey ? String(state[statusKey] || '').slice(0, 500) : '', counters };
  }

  // Chuỗi ngắn cho nhật ký: tên tính năng + các bộ đếm khác 0 của lõi.
  function detailText(task, core) {
    const parts = Object.entries(core.counters).slice(0, 12).map(([k, v]) => `${k}=${v}`);
    return [task.feature].concat(parts).join(' · ');
  }

  async function stop(run) {
    try {
      const task = coreTask(run);
      const action = typeof scheduleChainStopAction === 'function' ? scheduleChainStopAction(task) : null;
      if (action && run.fb_tab_id) {
        await sendScheduledTabMessage(run.fb_tab_id, { action, ...(task.feature === 'feed' ? { source: task.config?.source || 'friends' } : {}) });
      }
    } catch (err) {
      console.debug('[Auto vjp][fbtask] gửi lệnh dừng lỗi:', err);
    }
  }

  let ticking = false;
  // tick(run): gọi mỗi phút từ runner.watchdog cho run facebook (và ngay khi cờ active của lõi tắt).
  async function tick(run) {
    if (ticking || launching) return;
    ticking = true;
    try {
      const now = Date.now();
      const phase = run.phase || 'claimed';
      const startedAt = Number(run.startedAt || now);

      if (phase === 'claimed' || phase === 'fb_waiting') {
        if (now - startedAt > WAIT_BUSY_MAX_MS) {
          return await deliver(run, 'failed', 'Đang có một tính năng Facebook khác chạy quá 60 phút — chưa khởi chạy việc này.', { failure_code: 'fb_busy' });
        }
        ticking = false; // launch() tự giữ khoá riêng
        return await launch(run);
      }

      let task;
      try { task = coreTask(run); } catch (err) {
        return await deliver(run, 'uncertain', 'Không đọc lại được cấu hình việc Facebook: ' + (err?.message || err));
      }
      const core = await readCoreState(task);

      if (phase === 'fb_launching') {
        if (core.active) { watching = true; await S.touchRun({ phase: 'fb_running', lastActiveAt: now }); return; }
        if (now - Number(run.fb_launch_at || startedAt) < LAUNCH_GRACE_MS) { await S.touchRun({ lastActiveAt: now }); return; }
        return await deliver(run, 'uncertain', 'Khởi chạy tính năng Facebook bị gián đoạn (trình duyệt/extension khởi động lại?). Kiểm tra tay trước khi giao lại.');
      }

      // fb_running
      if (core.active) {
        const timeout = Number(run.timeout_ms) || globalThis.AVJP.contract.defaultTimeoutMs(run.type);
        if (now - startedAt > timeout) {
          await stop(run);
          return await deliver(run, 'uncertain', 'Quá thời hạn của việc — đã gửi lệnh dừng. ' + core.statusText, { failure_code: 'task_timeout', details: detailText(task, core) });
        }
        if (run.fb_tab_id) {
          let tab = null;
          try { tab = await chrome.tabs.get(run.fb_tab_id); } catch (_) { tab = null; }
          if (!tab) return await deliver(run, 'uncertain', 'Tab Facebook chạy việc này đã bị đóng giữa chừng. ' + core.statusText, { details: detailText(task, core) });
        }
        watching = true;
        await S.touchRun({ lastActiveAt: now });
        return;
      }
      const done = Boolean(scheduleChainCompletionEvidence(task, core.state));
      const label = task.label || task.feature;
      return await deliver(run, done ? 'success' : 'uncertain',
        done ? `${label}: xong. ${core.statusText}`.trim()
          : `${label}: đã dừng nhưng chưa đủ bằng chứng hoàn tất (có thể làm được một phần). ${core.statusText}`.trim(),
        { details: detailText(task, core) });
    } finally {
      ticking = false;
    }
  }

  // Cờ active của lõi vừa tắt -> chốt kết quả ngay, không chờ nhịp 1 phút.
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (!watching || area !== 'local') return;
      const flipped = Object.keys(changes).some(key => /(Active|isRunning|isScraping|isFeedInteracting|isAICommenting|Joining)$/.test(key) && changes[key].newValue === false);
      if (!flipped) return;
      setTimeout(async () => {
        const run = await S.getRun();
        if (run && run.platform === 'facebook') tick(run).catch(() => {});
      }, 1500);
    });
  } catch (err) {
    console.debug('[Auto vjp][fbtask] không gắn được storage.onChanged:', err);
  }

  // Mẫu cấu hình: các lịch người dùng đã tạo trong popup (kể cả từng bước của chuỗi).
  // Hub dùng để giao lại đúng cấu hình đó mà không phải gõ JSON.
  async function templates() {
    if (typeof scheduledTasks !== 'function') return [];
    let list = [];
    try { list = await scheduledTasks(); } catch (_) { return []; }
    const flat = [];
    for (const item of (Array.isArray(list) ? list : []).slice().reverse()) {
      if (!item) continue;
      if (item.kind === 'chain') {
        for (const step of (item.steps || [])) flat.push({ feature: step.feature, label: step.label || item.label, config: step.config });
      } else flat.push({ feature: item.feature, label: item.label, config: item.config });
    }
    const out = [];
    const seen = new Set();
    let bytes = 0;
    for (const t of flat) {
      if (!t.feature || !t.config) continue;
      const key = t.feature + '|' + (t.label || '');
      if (seen.has(key)) continue;
      const entry = { feature: String(t.feature), label: String(t.label || t.feature).slice(0, 120), config: t.config };
      const size = JSON.stringify(entry).length;
      if (bytes + size > TEMPLATE_BYTES) continue;
      seen.add(key);
      bytes += size;
      out.push(entry);
      if (out.length >= TEMPLATE_MAX) break;
    }
    return out;
  }

  globalThis.AVJP.fbtask = { available, validate, start, tick, stop, templates };
})();
