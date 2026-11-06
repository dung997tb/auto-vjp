/* Auto vjp — kernel runner: vòng đời tab automation của tầng module.
 * Port hành vi từ MUT tab-automation-runner + tab-manager (chỉ phần 5 nền tảng module;
 * Facebook để lõi gốc lo). Khác biệt có chủ đích so với MUT:
 *  - Không inject watermark-service (luật fork: không watermark ép buộc).
 *  - Tab đóng sớm -> receipt failed ngay (MUT có mở lại tab nhờ server lease; local không có lease server nên không mở lại).
 *  - Quá deadline/inactivity -> receipt `uncertain`, KHÔNG chạy lại (kỷ luật MUT giữ nguyên).
 *  - (2.11.9, mục 4 theo review) Fail được isFailureRetryable xếp loại thử-lại-được
 *    thì TỰ THỬ LẠI tối đa 2 lần với backoff ~60s/~300s — xem mục Retry ở cuối file.
 *    Captcha/checkpoint/chưa đăng nhập/user huỷ thì KHÔNG BAO GIỜ thử lại.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;
  const C = () => globalThis.AVJP.contract;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const injected = new Set(); // `${tabId}|${run_id}|${url}`

  async function rememberManaged(tabId) {
    const stored = await S.get(S.KEYS.MANAGED_TABS);
    const list = Array.isArray(stored) ? stored : [];
    if (!list.includes(tabId)) await S.set({ [S.KEYS.MANAGED_TABS]: list.concat(tabId) });
  }

  async function openTab(url) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tab = await chrome.tabs.create({ url, active: true, pinned: false });
        if (tab?.id) {
          await rememberManaged(tab.id);
          chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
          return tab;
        }
      } catch (err) {
        lastErr = err;
        const dragging = /dragging a tab|Tabs cannot be edited/i.test(err?.message || '');
        if (!dragging) break;
        await sleep(600);
      }
    }
    throw lastErr || new Error('Không mở được tab automation');
  }

  function isAuthOrCheckpoint(url) {
    return url.includes('/login') || url.includes('/checkpoint') || url.includes('accounts/login')
      || url.includes('accounts.google.com/signin') || url.includes('facebook.com/recover')
      || url.includes('/challenge') || url.includes('captcha');
  }

  // start(run): mở tab cho canonical run đã ghi trong storage. Trả về tabId.
  async function start(run) {
    if (run.platform === 'probe') { handleProbe(run); return null; }
    const url = C().startUrl(run);
    if (!url) throw new Error(`Không có URL khởi chạy cho ${run.platform}/${run.type}`);
    const tab = await openTab(url);
    await S.touchRun({ tabId: tab.id, phase: 'acting' });
    return tab.id;
  }

  // Probe: task kiểm tra vòng đời, không mở tab — đi xuyên source -> canonical -> outbox -> receipt.
  function handleProbe(run) {
    setTimeout(() => {
      globalThis.AVJP.outbox.deliver({
        type: 'probe', taskId: run.task_id, platform: 'probe',
        status: 'success', tabId: null,
        resultMessage: 'probe ok', items: [{ echo: run.payload_echo ?? run.content ?? null }]
      }).catch(() => {});
    }, 300);
  }

  async function injectForRun(tabId, run, tabUrl) {
    const spec = C().PLATFORMS[run.platform]?.scripts(run);
    if (!spec) {
      await globalThis.AVJP.outbox.deliver({
        type: run.type, taskId: run.task_id, platform: run.platform, tabId,
        status: 'failed', failure_code: 'execution_error',
        resultMessage: `Module ${run.platform} chưa hỗ trợ loại task ${run.type}`
      });
      return;
    }
    const target = spec.frameTopOnly ? { tabId, frameIds: [0] } : { tabId };
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const live = await chrome.tabs.get(tabId);
        if (live?.discarded) throw new Error('Tab automation đã bị Chrome discard');
        if (spec.scan) {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: context => { globalThis.__accountScanContext = context; },
            args: [{ scanId: run.task_id, stepId: run.run_id, platform: run.platform }]
          });
        }
        if (spec.mainWorldBefore) {
          await chrome.scripting.executeScript({ target, world: 'MAIN', files: spec.mainWorldBefore });
        }
        if (spec.frameTopOnly) await sleep(900);
        await chrome.scripting.executeScript({ target, files: spec.files });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (/No tab|not found/i.test(err?.message || '')) break;
        await sleep(1000);
      }
    }
    if (lastErr) {
      const fresh = await S.getRun();
      if (fresh && String(fresh.task_id) === String(run.task_id)) {
        await globalThis.AVJP.outbox.deliver({
          type: run.type, taskId: run.task_id, platform: run.platform, tabId,
          status: 'failed', failure_code: 'execution_error', forceCleanup: true,
          resultMessage: lastErr?.message || 'Không nạp được script thi hành'
        });
      }
    }
  }

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      if (changeInfo.status !== 'complete' || !tab?.url) return;
      const run = await S.getRun();
      if (!run || run.tabId !== tabId || run.platform === 'probe') return;
      const hosts = C().PLATFORMS[run.platform]?.hosts || [];
      if (!hosts.some(h => tab.url.includes(h))) return;

      if (isAuthOrCheckpoint(tab.url)) {
        await globalThis.AVJP.outbox.deliver({
          type: run.type, taskId: run.task_id, platform: run.platform, tabId,
          status: 'failed', failure_code: 'session_expired', forceCleanup: true,
          resultMessage: 'Trang đăng nhập / checkpoint / captcha — dừng task, không lách (luật fork §3-6).'
        });
        return;
      }
      const key = `${tabId}|${run.run_id}|${tab.url}`;
      // Task nurture: KHÔNG chặn inject lại theo key (vá 2.6.0 — gốc rễ
      // "điểm câm" của phiên nuôi YouTube). Adapter nuôi tự điều hướng FULL
      // về cùng một URL (vd adapter YouTube quay về trang chủ sau mỗi
      // video, hoặc xoay nguồn về lại bề mặt đã thăm): trang tải lại cùng
      // URL vẫn phải được inject lại, nếu không adapter không bao giờ chạy
      // tiếp và phiên câm tới khi watchdog đóng `uncertain`. Adapter tự
      // chống trùng bằng cờ trong document + resume theo run_id nên inject
      // lại là an toàn. Các type khác (post/reply/scan/affiliate) giữ
      // nguyên guard chống inject trùng dưới đây.
      if (run.type !== 'nurture') {
        if (injected.has(key)) return;
        injected.add(key);
      }
      await injectForRun(tabId, run, tab.url);
    } catch (err) {
      console.error('[Auto vjp][runner] onUpdated error', err);
    }
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    try {
      const run = await S.getRun();
      if (!run || run.tabId !== tabId) return;
      // Cho outbox một nhịp: nếu receipt vừa ghi thì run đã bị xoá, không tới đây.
      await sleep(400);
      const fresh = await S.getRun();
      if (!fresh || String(fresh.task_id) !== String(run.task_id)) return;
      await globalThis.AVJP.outbox.deliver({
        type: fresh.type, taskId: fresh.task_id, platform: fresh.platform, tabId,
        status: 'failed', forceCleanup: true,
        resultMessage: 'Tab automation bị đóng trước khi hoàn tất.'
      });
    } catch (err) {
      console.error('[Auto vjp][runner] onRemoved error', err);
    }
  });

  // Watchdog: gọi từ alarm tick của source (1 phút/lần).
  async function watchdog() {
    const run = await S.getRun();
    if (!run || run.platform === 'probe') return;
    const now = Date.now();
    const timeout = Number(run.timeout_ms) || C().defaultTimeoutMs(run.type);
    const lastActive = Number(run.lastActiveAt || run.startedAt || now);
    if (now - Number(run.startedAt || now) > timeout || now - lastActive > C().INACTIVITY_TIMEOUT_MS) {
      await globalThis.AVJP.outbox.deliver({
        type: run.type, taskId: run.task_id, platform: run.platform, tabId: run.tabId || null,
        status: 'uncertain', failure_code: 'task_timeout', forceCleanup: true,
        resultMessage: 'Quá deadline hoặc 5 phút không hoạt động — đóng dấu uncertain, không chạy lại.'
      });
    }
  }

  async function cancelCurrent(reason) {
    const run = await S.getRun();
    if (!run) return false;
    await globalThis.AVJP.outbox.deliver({
      type: run.type, taskId: run.task_id, platform: run.platform, tabId: run.tabId || null,
      status: 'cancelled', failure_code: 'user_cancelled', forceCleanup: true,
      resultMessage: reason || 'User huỷ từ trang quản lý.'
    });
    return true;
  }

  /* ===== Retry/backoff cho task fail (2.11.9, mục 4 theo review) =====
   * Điểm chạm duy nhất: bọc AVJP.outbox.deliver — MỌI kết quả thi hành
   * (runner/source/results) đều chảy qua deliver và tra cứu động lúc gọi,
   * nên bọc ở đây là phủ hết mà không sửa file kernel nào khác.
   * Cơ chế: fail + isFailureRetryable(type,'failed',code) = true + còn
   * lượt (tối đa RETRY_MAX) -> (1) dựng lại task gốc từ canonical run,
   * ghi vào QUEUE với status 'awaiting_retry' + retry_attempt +
   * retry_at (nằm trong storage nên sống qua reload SW); (2) deliver
   * receipt TRUNG GIAN status 'retrying' (không phải fail chung cuộc) —
   * outbox vẫn dọn run/đóng tab như thường. Alarm 1 phút gọi
   * promoteDueRetries(): task tới hạn retry_at được nâng về 'queued'
   * để source claim lại như task mới (buildRun mang retry_attempt từ
   * task sang run, nên đếm lượt xuyên suốt các lần chạy).
   * KHÔNG BAO GIỜ thử lại (xét TRƯỚC, thắng isFailureRetryable):
   * captcha / checkpoint / session_expired (chưa đăng nhập), user_cancelled,
   * status cancelled / uncertain — kỷ luật "gặp rào thì dừng, không lách".
   * Người dùng dừng hàng đợi: PAUSED đóng băng cả promote (claimNext vốn
   * cũng chặn khi PAUSED); task bị xoá khỏi QUEUE ở trang quản lý thì
   * promote không còn thấy nó nữa — cả hai đường đều huỷ được retry.
   */
  const RETRY_MAX = 2;
  const RETRY_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000]; // lần 1 ~60s, lần 2 ~300s
  const RETRY_ALARM = 'autovjp.retryTick';
  const NEVER_RETRY_CODES = new Set(['session_expired', 'user_cancelled']);

  // Khớp outbox.finalStatus — chỉ để biết kết quả này có phải fail chung cuộc không.
  function effectiveStatus(result) {
    if (result.status) return String(result.status).toLowerCase();
    const items = Array.isArray(result.items) ? result.items : null;
    if (result.type === 'affiliate' && result.exhausted && !result.error && (!items || items.length === 0)) return 'skipped';
    if (result.error) return items && items.length ? 'success' : 'failed';
    return 'success';
  }

  function neverRetry(result) {
    const status = String(result.status || '').toLowerCase();
    const code = String(result.failure_code || '').toLowerCase();
    if (status === 'cancelled' || status === 'uncertain') return true;
    if (NEVER_RETRY_CODES.has(code)) return true;
    const text = `${result.resultMessage || ''} ${result.error || ''}`.toLowerCase();
    return /captcha|checkpoint|session_expired|user_cancelled|chưa đăng nhập|not logged in/.test(text);
  }

  // planRetry(result) -> {task, nextAttempt, backoffMs, retryAt, code} | null
  async function planRetry(result) {
    if (!result || effectiveStatus(result) !== 'failed') return null;
    if (neverRetry(result)) return null;
    const run = await S.getRun();
    if (!run) return null; // không có canonical run -> không dựng lại được task gốc (vd scan ngoài canonical)
    const taskId = String(result.taskId || run.task_id || run.id || '');
    if (!taskId || (String(run.task_id) !== taskId && String(run.id) !== taskId)) return null;
    const D = globalThis.AVJP.contractData;
    if (!D || typeof D.isFailureRetryable !== 'function') return null;
    const code = typeof D.normalizeLegacyFailureCode === 'function'
      ? D.normalizeLegacyFailureCode(result.failure_code) : result.failure_code;
    if (!code) return null; // không mã lỗi -> không phân loại được -> fail chung cuộc như cũ
    const type = run.type || result.type;
    if (!D.isFailureRetryable(type, 'failed', code)) return null;
    const attempts = Number(run.retry_attempt || 0);
    if (!Number.isFinite(attempts) || attempts >= RETRY_MAX) return null;
    const nextAttempt = attempts + 1;
    const backoffMs = RETRY_BACKOFF_MS[nextAttempt - 1] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    const retryAt = Date.now() + backoffMs;
    // Dựng lại task từ run: bỏ các trường vòng đời của run, giữ payload gốc.
    const task = { ...run };
    delete task.task_id; delete task.run_id; delete task.delivery_id;
    delete task.phase; delete task.tabId; delete task.startedAt;
    delete task.lastActiveAt; delete task.updatedAt;
    delete task.nurture_counters; delete task.nurture_progress_at;
    if (type === 'affiliate') delete task.items; // items trên run của affiliate là tiến độ dở, không phải payload
    task.id = taskId;
    task.status = 'awaiting_retry';
    task.retry_attempt = nextAttempt;
    task.retry_at = retryAt;
    task.retry_last_failure_code = code;
    task.retry_last_message = result.resultMessage || result.error || '';
    return { task, nextAttempt, backoffMs, retryAt, code };
  }

  async function requeueForRetry(task) {
    return S.withLock(async () => {
      const queue = (await S.get(S.KEYS.QUEUE)) || [];
      if (queue.some(t => t && String(t.id) === String(task.id))) return false; // đã có bản chờ — chống trùng
      queue.push(task);
      await S.set({ [S.KEYS.QUEUE]: queue });
      return true;
    });
  }

  function wrapDeliverWithRetry() {
    const box = globalThis.AVJP.outbox;
    if (!box || typeof box.deliver !== 'function' || box.deliver.__avjpRetry) return;
    const original = box.deliver;
    const wrapped = async result => {
      try {
        const plan = await planRetry(result);
        if (plan && await requeueForRetry(plan.task)) {
          const secs = Math.round(plan.backoffMs / 1000);
          const info = {
            retry_scheduled: true, retry_attempt: plan.nextAttempt,
            retry_max: RETRY_MAX, retry_next_at: plan.retryAt, retry_of_failure_code: plan.code
          };
          const details = result.details && typeof result.details === 'object' && !Array.isArray(result.details)
            ? { ...result.details, ...info }
            : (typeof result.details === 'string' && result.details
              ? `${result.details} [retry ${plan.nextAttempt}/${RETRY_MAX} @ ${new Date(plan.retryAt).toISOString()}]`
              : info);
          return original({
            ...result,
            status: 'retrying',
            resultMessage: `${result.resultMessage || result.error || 'Task thất bại'} [Sẽ tự thử lại lần ${plan.nextAttempt}/${RETRY_MAX} sau ~${secs} giây]`,
            details
          });
        }
      } catch (err) {
        console.error('[Auto vjp][runner] retry plan error — giữ nguyên kết quả fail', err);
      }
      return original(result);
    };
    wrapped.__avjpRetry = true;
    box.deliver = wrapped;
  }

  // Nâng task 'awaiting_retry' đã tới hạn retry_at về 'queued' cho source claim.
  async function promoteDueRetries() {
    let promoted = 0;
    await S.withLock(async () => {
      if (await S.get(S.KEYS.PAUSED)) return; // user dừng hàng đợi: đóng băng cả retry đang chờ
      const queue = (await S.get(S.KEYS.QUEUE)) || [];
      const now = Date.now();
      let changed = false;
      const next = queue.map(t => {
        if (t && t.status === 'awaiting_retry' && Number(t.retry_at || 0) <= now) {
          changed = true; promoted++;
          return { ...t, status: 'queued' };
        }
        return t;
      });
      if (changed) await S.set({ [S.KEYS.QUEUE]: next });
    });
    if (promoted > 0 && globalThis.AVJP.source) globalThis.AVJP.source.kick().catch(() => {});
    return promoted;
  }

  wrapDeliverWithRetry();
  try { chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }); } catch (_) {}
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm && (alarm.name === RETRY_ALARM || alarm.name === 'autovjp.tick')) promoteDueRetries().catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => { promoteDueRetries().catch(() => {}); });

  globalThis.AVJP.runner = { start, watchdog, cancelCurrent, openTab, promoteDueRetries };
})();
