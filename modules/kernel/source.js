/* Auto vjp — kernel source: NGUỒN VIỆC LOCAL thay kênh claim-next của server MUT.
 * Vòng đời: schedules (đến hạn) -> task queue -> claim (1 run duy nhất, singleton như MUT)
 *           -> canonical `currentAutomationRun` -> runner mở tab thi hành -> outbox ghi receipt -> claim tiếp.
 * Scheduler adapter = chrome.alarms 'autovjp.tick' mỗi 1 phút + kick() tức thời sau mỗi sự kiện.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;
  const C = () => globalThis.AVJP.contract;
  const K = S.KEYS;
  const ALARM = 'autovjp.tick';

  function validateTask(input) {
    if (!input || typeof input !== 'object') throw new Error('task phải là object');
    const platform = String(input.platform || '').toLowerCase();
    const type = String(input.type || 'post').toLowerCase();
    if (!C().platformNames.includes(platform)) throw new Error(`platform không thuộc tầng module: ${platform}`);
    if (!C().TASK_TYPES.includes(type)) throw new Error(`type không hỗ trợ: ${type}`);
    if (platform !== 'probe' && !C().PLATFORMS[platform].scripts({ type })) {
      throw new Error(`Module ${platform} chưa hỗ trợ loại task ${type}`);
    }
    // YouTube scope hẹp (plan §6-S7): upload video bị cắt khỏi v1 — không nhận task video YouTube.
    if (platform === 'youtube' && type === 'post' && C().isVideoPost(input)) {
      throw new Error('YouTube upload video ngoài scope v1 (chỉ Community post/comment).');
    }
    return { platform, type };
  }

  // enqueue(input) -> task đã chuẩn hoá (payload của task nằm phẳng ở top-level,
  // khớp cách automator MUT đọc task: content/images/source_url/reply_templates/...)
  async function enqueue(input) {
    const { platform, type } = validateTask(input);
    const task = {
      ...input,
      id: S.newId('task'),
      platform,
      type,
      status: 'queued',
      created_at: Date.now()
    };
    await S.withLock(async () => {
      const queue = (await S.get(K.QUEUE)) || [];
      queue.push(task);
      await S.set({ [K.QUEUE]: queue });
    });
    kick().catch(() => {});
    return task;
  }

  async function buildRun(task) {
    const now = Date.now();
    return {
      ...task,
      type: task.type,
      platform: task.platform,
      task_id: String(task.id),
      run_id: S.newId('run'),
      delivery_id: S.newId('dlv'),
      phase: 'claimed',
      tabId: null,
      startedAt: now,
      lastActiveAt: now,
      updatedAt: now,
      timeout_ms: Number(task.timeout_ms) || C().defaultTimeoutMs(task.type)
    };
  }

  async function processSchedules() {
    const now = Date.now();
    const schedules = (await S.get(K.SCHEDULES)) || [];
    if (!schedules.length) return;
    const due = schedules.filter(sch => Number(sch.run_at) <= now);
    if (!due.length) return;
    const remaining = [];
    for (const sch of schedules) {
      if (Number(sch.run_at) <= now) {
        try { await enqueue({ ...sch.template, schedule_id: sch.id }); } catch (err) {
          console.error('[Auto vjp][source] schedule enqueue failed', sch.id, err);
        }
        if (sch.repeat === 'daily') remaining.push({ ...sch, run_at: Number(sch.run_at) + 24 * 3600 * 1000 });
      } else remaining.push(sch);
    }
    await S.set({ [K.SCHEDULES]: remaining });
  }

  async function claimNext() {
    return S.withLock(async () => {
      if (await S.get(K.PAUSED)) return false;
      const existing = await S.getRun();
      if (existing) return false; // singleton: 1 run tại 1 thời điểm (như MUT)
      const queue = (await S.get(K.QUEUE)) || [];
      const next = queue.find(t => t.status === 'queued');
      if (!next) return false;
      await S.set({ [K.QUEUE]: queue.filter(t => t.id !== next.id) });
      const run = await buildRun(next);
      await S.setRun(run);
      return run;
    }).then(async run => {
      if (!run) return false;
      try {
        await globalThis.AVJP.runner.start(run);
      } catch (err) {
        await globalThis.AVJP.outbox.deliver({
          type: run.type, taskId: run.task_id, platform: run.platform,
          status: 'failed', failure_code: 'execution_error',
          resultMessage: err?.message || 'Không khởi chạy được task'
        });
      }
      return true;
    });
  }

  async function kick() {
    await processSchedules().catch(err => console.error('[Auto vjp][source] schedules', err));
    await globalThis.AVJP.runner.watchdog().catch(() => {});
    return claimNext();
  }

  // Probe end-to-end: tạo task probe -> claim -> receipt. Dùng cho kiểm chứng S2 trong lab.
  async function probe(echo) {
    const task = await enqueue({ platform: 'probe', type: 'probe', payload_echo: echo ?? 'hello-autovjp' });
    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      const receipts = (await S.get(K.RECEIPTS)) || [];
      const found = receipts.find(r => r.task_id === task.id);
      if (found) return { success: true, task_id: task.id, receipt: found };
      await new Promise(r => setTimeout(r, 150));
    }
    return { success: false, task_id: task.id, error: 'probe timeout — chưa thấy receipt' };
  }

  function setup() {
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === ALARM) kick().catch(() => {});
    });
    chrome.runtime.onStartup.addListener(() => kick().catch(() => {}));
    kick().catch(() => {});
  }

  globalThis.AVJP.source = { enqueue, claimNext, kick, probe, setup, validateTask };
})();
