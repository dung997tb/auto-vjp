/* Auto vjp — kernel runner: vòng đời tab automation của tầng module.
 * Port hành vi từ MUT tab-automation-runner + tab-manager (chỉ phần 5 nền tảng module;
 * Facebook để lõi gốc lo). Khác biệt có chủ đích so với MUT:
 *  - Không inject watermark-service (luật fork: không watermark ép buộc).
 *  - Tab đóng sớm -> receipt failed ngay (MUT có mở lại tab nhờ server lease; local không có lease server nên không mở lại).
 *  - Quá deadline/inactivity -> receipt `uncertain`, KHÔNG chạy lại (kỷ luật MUT giữ nguyên).
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

  globalThis.AVJP.runner = { start, watchdog, cancelCurrent, openTab };
})();
