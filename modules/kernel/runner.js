/* Auto vjp — kernel runner: vòng đời tab automation của tầng module.
 * Port hành vi từ MUT tab-automation-runner + tab-manager (chỉ phần 5 nền tảng module;
 * Facebook để lõi gốc lo). Khác biệt có chủ đích so với MUT:
 *  - Không inject watermark-service (luật fork: không watermark ép buộc).
 *  - Tab đóng sớm -> receipt failed ngay (MUT có mở lại tab nhờ server lease; local không có lease server nên không mở lại).
 *  - Quá deadline/inactivity -> receipt `uncertain`, KHÔNG chạy lại (kỷ luật MUT giữ nguyên).
 *  - (2.11.9, mục 4 theo review) Fail được isFailureRetryable xếp loại thử-lại-được
 *    thì TỰ THỬ LẠI tối đa 2 lần với backoff ~60s/~300s — xem mục Retry ở cuối file.
 *    Captcha/checkpoint/chưa đăng nhập/user huỷ thì KHÔNG BAO GIỜ thử lại.
 *  - (2.11.11) scan_account quét NGẦM tầng 1: dùng lại tab platform user đang
 *    mở sẵn (không điều hướng, không đóng tab của user); không có thì mở tab
 *    nền active:false trong cửa sổ đang focus — hết cảnh mỗi lần quét bật
 *    cửa sổ mới giật focus. Các type khác giữ nguyên hành vi mở tab.
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

  // opts.active mặc định true (hành vi cũ); opts.windowId có thì ghim tab
  // vào đúng cửa sổ đó (đường quét ngầm 2.11.11 truyền active:false +
  // windowId của cửa sổ đang focus).
  async function openTab(url, opts = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const createOpts = { url, active: opts.active !== false, pinned: false };
        if (opts.windowId) createOpts.windowId = opts.windowId;
        const tab = await chrome.tabs.create(createOpts);
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

  // (2.11.10) Khớp host theo hostname thật (parse URL) — KHÔNG dùng
  // url.includes(h): 'instagram.com.attacker.example' chứa chuỗi
  // 'instagram.com' vẫn phải bị từ chối. Đúng khi hostname bằng host
  // hoặc là subdomain của host.
  function hostMatches(url, hosts) {
    try {
      const hostname = new URL(url || '').hostname.toLowerCase();
      if (!hostname) return false;
      return (hosts || []).some(h => {
        const host = String(h || '').toLowerCase();
        return host && (hostname === host || hostname.endsWith('.' + host));
      });
    } catch (_) { return false; }
  }

  function isAuthOrCheckpoint(url) {
    return url.includes('/login') || url.includes('/checkpoint') || url.includes('accounts/login')
      || url.includes('accounts.google.com/signin') || url.includes('facebook.com/recover')
      || url.includes('/challenge') || url.includes('captcha');
  }

  // (2.11.11) Tìm tab DÙNG LẠI được cho scan_account: tab user đang mở sẵn
  // thuộc đúng platform (khớp hostname), KHÔNG phải tab automation
  // (MANAGED_TABS) và không phải trang extension. Trả null nếu không có —
  // lỗi đọc tab cũng coi như không có để rơi xuống đường mở tab nền.
  async function findReusableScanTab(run) {
    try {
      const hosts = C().PLATFORMS[run.platform]?.hosts || [];
      if (!hosts.length) return null;
      const managed = await S.get(S.KEYS.MANAGED_TABS);
      const managedSet = new Set(Array.isArray(managed) ? managed.map(Number) : []);
      const tabs = await chrome.tabs.query({});
      return tabs.find(t => {
        if (!t?.id || managedSet.has(t.id)) return false;
        const tabUrl = t.url || t.pendingUrl || '';
        if (!tabUrl || tabUrl.startsWith('chrome-extension://')) return false;
        return hostMatches(tabUrl, hosts);
      }) || null;
    } catch (_) { return null; }
  }

  // (2.11.11) Mở tab quét NỀN: active:false + ghim vào cửa sổ normal đang
  // focus gần nhất. Không lấy được cửa sổ (lỗi/không có) thì fallback
  // create mặc định như openTab thường — vẫn active:false.
  async function openScanTab(url) {
    let windowId = null;
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win?.id) windowId = win.id;
    } catch (_) { /* không có cửa sổ normal -> create mặc định */ }
    return openTab(url, { active: false, windowId });
  }

  // start(run): mở tab cho canonical run đã ghi trong storage. Trả về tabId.
  async function start(run) {
    if (run.platform === 'probe') { handleProbe(run); return null; }
    const url = C().startUrl(run);
    if (!url) throw new Error(`Không có URL khởi chạy cho ${run.platform}/${run.type}`);
    // (2.11.11) scan_account — quét ngầm tầng 1: dùng lại tab platform user
    // đang mở sẵn nếu có. Tab dùng lại KHÔNG vào MANAGED_TABS nên outbox
    // không đóng tab của user khi quét xong; cũng KHÔNG điều hướng nó —
    // trang đang đứng ở đâu quét ở đó. Tab chưa load xong thì để nhánh
    // onUpdated inject khi complete như thường.
    if (run.type === 'scan_account') {
      const reuse = await findReusableScanTab(run);
      if (reuse) {
        await S.touchRun({ tabId: reuse.id, phase: 'acting' });
        if (reuse.status === 'complete') {
          // Ghi key guard TRƯỚC như nhánh onUpdated vẫn làm cho type khác
          // nurture, tránh onUpdated bắn sau đó inject trùng cùng tab/run.
          const key = `${reuse.id}|${run.run_id}|${reuse.url}`;
          if (!injected.has(key)) {
            injected.add(key);
            await injectForRun(reuse.id, run, reuse.url);
          }
        }
        // Tab lúc chụp snapshot còn 'loading' mà complete ngay trước khi
        // touchRun ghi tabId thì onUpdated vẫn trượt — driveInject canh nốt.
        driveInject(reuse.id, run).catch(() => {});
        return reuse.id;
      }
      const tab = await openScanTab(url);
      await S.touchRun({ tabId: tab.id, phase: 'acting' });
      driveInject(tab.id, run).catch(() => {});
      return tab.id;
    }
    // (2.11.16) Spec khai emulation 'mobile' (hiện chỉ IG story): mở
    // tab TRẮNG, gắn giả lập thiết bị xong MỚI điều hướng sang
    // startUrl — gắn sau khi trang đã tải là quá muộn, IG chốt layout
    // desktop cho cả phiên. Gắn không được -> deliver failed
    // 'emulation_missing' ngay thay vì để tầng module chết vô ích
    // trên giao diện desktop (mã này không thuộc nhóm retryable nên
    // fail là chung cuộc, xem planRetry).
    const spec0 = C().PLATFORMS[run.platform]?.scripts(run);
    if (spec0 && spec0.emulation === 'mobile') {
      const tab = await openTab('about:blank');
      await S.touchRun({ tabId: tab.id, phase: 'acting' });
      if (!await applyMobileEmulation(tab.id)) {
        await globalThis.AVJP.outbox.deliver({
          type: run.type, taskId: run.task_id, platform: run.platform, tabId: tab.id,
          status: 'failed', failure_code: 'emulation_missing', forceCleanup: true,
          resultMessage: 'Không gắn được giả lập thiết bị mobile qua chrome.debugger — huỷ task thay vì chạy trên giao diện desktop.'
        });
        return tab.id;
      }
      await chrome.tabs.update(tab.id, { url });
      driveInject(tab.id, run).catch(() => {});
      return tab.id;
    }
    const tab = await openTab(url);
    await S.touchRun({ tabId: tab.id, phase: 'acting' });
    driveInject(tab.id, run).catch(() => {});
    return tab.id;
  }

  /* ===== Giả lập thiết bị mobile theo task (2.11.16) =====
   * Bộ thông số lấy NGUYÊN từ spike sống 2026-11-12 trên nuc (nick
   * @langlehoaanhdao, Chrome 156, verdict: đi trọn luồng tới nút
   * đăng): Pixel 8 / Android 14 — metrics 412x915 KÈM
   * screenOrientation portrait (thiếu orientation thì editor chặn
   * bằng màn hình bắt xoay thiết bị), touch 5 điểm, UA mobile kèm
   * userAgentMetadata (thiếu UA mobile thì IG trả feed dạng reels,
   * không có khay tin). Thiếu một món là giao diện mobile không ra
   * đúng, nên gắn thiếu thì coi như gắn hỏng.
   * Gỡ giả lập ở MỌI ngả kết thúc run: bọc AVJP.outbox.deliver (điểm
   * chảy chung của mọi kết quả thi hành — cùng điểm chạm wrap retry
   * dùng ở cuối file): clear metrics + tắt touch + khôi phục UA +
   * detach CHỈ khi phiên do runner attach. Mẫu attach chịu lỗi
   * "already attached" bê từ handler humanMouse trong background.js:
   * phiên debugger đã có của extension/lõi FB thì vẫn gửi lệnh được
   * nhưng KHÔNG detach của người ta.
   * Giới hạn đã biết: map trạng thái sống trong SW — SW khởi động lại
   * giữa run thì mất dấu attach; khi đó deliver chung cuộc vẫn đóng
   * tab managed nên giả lập chết theo tab, không rò sang tab khác
   * (mọi override CDP là theo từng target).
   */
  const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';
  const emulatedTabs = new Map(); // tabId -> { attachedByUs: boolean }

  function dbgAttach(tabId) {
    return new Promise((resolve, reject) => {
      try {
        chrome.debugger.attach({ tabId }, '1.3', () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message || String(err))); else resolve();
        });
      } catch (e) { reject(e); }
    });
  }

  function dbgDetach(tabId) {
    return new Promise(resolve => {
      try { chrome.debugger.detach({ tabId }, () => resolve()); } catch (_) { resolve(); }
    });
  }

  async function dbgSend(tabId, method, params) {
    return chrome.debugger.sendCommand({ tabId }, method, params || {});
  }

  // Gắn đủ 3 lệnh Emulation. Thành công mới ghi dấu vào map; hỏng
  // giữa chừng thì tự gỡ phần đã gắn rồi trả false.
  async function applyMobileEmulation(tabId) {
    let attachedByUs = false;
    try {
      await dbgAttach(tabId);
      attachedByUs = true;
    } catch (e) {
      if (!/already attached/i.test(String(e?.message || e))) return false;
      // Phiên debugger đã có sẵn — gửi lệnh được, detach không thuộc mình.
    }
    try {
      await dbgSend(tabId, 'Emulation.setDeviceMetricsOverride', {
        width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true,
        screenWidth: 412, screenHeight: 915,
        screenOrientation: { type: 'portraitPrimary', angle: 0 }
      });
      await dbgSend(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await dbgSend(tabId, 'Emulation.setUserAgentOverride', {
        userAgent: MOBILE_UA,
        acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
        userAgentMetadata: {
          brands: [
            { brand: 'Chromium', version: '156' },
            { brand: 'Google Chrome', version: '156' },
            { brand: 'Not-A.Brand', version: '99' }
          ],
          fullVersionList: [{ brand: 'Chromium', version: '156.0.8078.80' }],
          platform: 'Android', platformVersion: '14', architecture: '',
          model: 'Pixel 8', mobile: true
        }
      });
    } catch (e) {
      await clearMobileEmulation(tabId, { attachedByUs }).catch(() => {});
      return false;
    }
    emulatedTabs.set(tabId, { attachedByUs });
    return true;
  }

  // Gỡ giả lập: từng lệnh nuốt lỗi riêng (tab có thể đã đóng giữa
  // chừng) để một lệnh hỏng không chặn các lệnh sau; luôn xoá dấu.
  // `known` cho phép gỡ khi chưa kịp ghi map (đường gắn dở ở trên).
  async function clearMobileEmulation(tabId, known) {
    const state = known || emulatedTabs.get(tabId);
    emulatedTabs.delete(tabId);
    if (!state) return;
    try { await dbgSend(tabId, 'Emulation.clearDeviceMetricsOverride', {}); } catch (_) {}
    try { await dbgSend(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }); } catch (_) {}
    try { await dbgSend(tabId, 'Emulation.setUserAgentOverride', { userAgent: '' }); } catch (_) {}
    if (state.attachedByUs) await dbgDetach(tabId);
  }

  // Bọc deliver: gỡ giả lập TRƯỚC khi deliver gốc chạy, vì outbox
  // đóng tab managed ngay trong deliver — lệnh CDP phải đi khi tab
  // còn sống. Kết quả không mang tab đang giả lập thì cho qua nguyên.
  function wrapDeliverWithEmulationCleanup() {
    const box = globalThis.AVJP.outbox;
    if (!box || typeof box.deliver !== 'function' || box.deliver.__avjpEmuCleanup) return;
    const original = box.deliver;
    const wrapped = async result => {
      try {
        const tabId = result?.tabId || null;
        if (tabId && emulatedTabs.has(tabId)) await clearMobileEmulation(tabId);
      } catch (err) {
        console.error('[Auto vjp][runner] gỡ giả lập lỗi — vẫn deliver như thường', err);
      }
      return original(result);
    };
    wrapped.__avjpEmuCleanup = true;
    box.deliver = wrapped;
  }

  // Tab bị đóng: override + phiên debugger tự chết theo target, chỉ
  // cần xoá dấu để map không rò.
  chrome.tabs.onRemoved.addListener(tabId => { emulatedTabs.delete(tabId); });

  // (2.11.11) Tự lái inject sau start — vá 2 kiểu treo đã tái hiện trong
  // lab: (a) "cuộc đua complete" — tab tải xong TRƯỚC khi touchRun kịp ghi
  // tabId thì onUpdated 'complete' bị bỏ qua (run.tabId chưa khớp) và trang
  // SPA không sinh thêm sự kiện nào → run treo tới watchdog; (b) trang nặng
  // (TikTok) giữ status 'loading' cả phút dù DOM đã dùng được — chờ
  // 'complete' là chờ vô ích. Vòng này (fire-and-forget, start() không chờ)
  // tự canh tab trong 90s: run còn sống thì còn canh; URL đúng host +
  // complete → inject qua injectForRun như thường; URL đúng host + vẫn
  // loading nhưng ổn định ≥6s → inject THỬ kiểu quiet (lỗi do redirect
  // giữa chừng thì nuốt, canh tiếp — không deliver failed oan); URL đổi
  // sang địa chỉ đúng host khác chưa inject → inject tiếp (redirect sau
  // inject sớm). Mọi inject đều qua key guard chung với onUpdated nên
  // không trùng; trang đăng nhập/checkpoint ở trạng thái complete thì
  // deliver failed như nhánh onUpdated.
  async function driveInject(tabId, run) {
    const hosts = C().PLATFORMS[run.platform]?.hosts || [];
    const deadline = Date.now() + 90000;
    let stableUrl = '';
    let stablePolls = 0;
    while (Date.now() < deadline) {
      const fresh = await S.getRun();
      if (!fresh || String(fresh.task_id) !== String(run.task_id)) return;
      let tab = null;
      try { tab = await chrome.tabs.get(tabId); } catch (_) { return; }
      if (!tab) return;
      const url = tab.url || '';
      if (url && url === stableUrl) stablePolls++; else { stableUrl = url; stablePolls = 0; }
      if (url && tab.status === 'complete' && isAuthOrCheckpoint(url)) {
        await globalThis.AVJP.outbox.deliver({
          type: run.type, taskId: run.task_id, platform: run.platform, tabId,
          status: 'failed', failure_code: 'session_expired', forceCleanup: true,
          resultMessage: 'Trang đăng nhập / checkpoint / captcha — dừng task, không lách (luật fork §3-6).'
        });
        return;
      }
      if (url && hostMatches(url, hosts)) {
        const key = `${tabId}|${run.run_id}|${url}`;
        const already = run.type !== 'nurture' && injected.has(key);
        if (!already) {
          if (tab.status === 'complete') {
            if (run.type !== 'nurture') injected.add(key);
            await injectForRun(tabId, run, url);
            // injectForRun lỗi chung cuộc đã tự deliver failed + dọn run;
            // vòng lặp sẽ tự thoát ở vòng sau khi run biến mất.
          } else if (stablePolls >= 12) {
            if (run.type !== 'nurture') injected.add(key);
            const okQuiet = await injectForRun(tabId, run, url, { quiet: true });
            // Inject thử hỏng (trang vừa redirect...) → nhả key guard để
            // khi tab complete/ổn định ở URL này còn inject lại được.
            if (!okQuiet && run.type !== 'nurture') injected.delete(key);
          }
        }
      }
      await sleep(500);
    }
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

  async function injectForRun(tabId, run, tabUrl, opts = {}) {
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
      // (2.11.11) quiet: lần inject THỬ của driveInject khi tab còn loading
      // — lỗi thường do trang redirect giữa chừng, nuốt để vòng canh thử
      // lại ở URL ổn định sau; KHÔNG deliver failed oan.
      if (opts.quiet) return false;
      const fresh = await S.getRun();
      if (fresh && String(fresh.task_id) === String(run.task_id)) {
        await globalThis.AVJP.outbox.deliver({
          type: run.type, taskId: run.task_id, platform: run.platform, tabId,
          status: 'failed', failure_code: 'execution_error', forceCleanup: true,
          resultMessage: lastErr?.message || 'Không nạp được script thi hành'
        });
      }
    }
    return !lastErr;
  }

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    try {
      if (changeInfo.status !== 'complete' || !tab?.url) return;
      const run = await S.getRun();
      if (!run || run.tabId !== tabId || run.platform === 'probe') return;
      const hosts = C().PLATFORMS[run.platform]?.hosts || [];
      if (!hostMatches(tab.url, hosts)) return;

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
    // (2.11.18) Ghi cờ huỷ TRƯỚC khi deliver: các đường thi hành đang
    // chạy có thể tra CANCEL_FLAGS theo task_id để tự dừng sớm. Nuốt lỗi
    // — ghi cờ hỏng không được chặn việc huỷ.
    try {
      const flags = (await S.get(S.KEYS.CANCEL_FLAGS)) || {};
      flags[String(run.task_id)] = Date.now();
      await S.set({ [S.KEYS.CANCEL_FLAGS]: flags });
    } catch (_) {}
    await globalThis.AVJP.outbox.deliver({
      type: run.type, taskId: run.task_id, platform: run.platform, tabId: run.tabId || null,
      status: 'failed', failure_code: 'user_cancelled', forceCleanup: true,
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
  // (2.11.16) Bọc thêm lớp gỡ giả lập thiết bị mobile — gắn SAU lớp
  // retry để nó ở ngoài cùng: mọi deliver (kể cả bản trung gian
  // 'retrying' do lớp retry sinh) đều qua tay gỡ giả lập trước.
  wrapDeliverWithEmulationCleanup();
  try { chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 }); } catch (_) {}
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm && (alarm.name === RETRY_ALARM || alarm.name === 'autovjp.tick')) promoteDueRetries().catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => { promoteDueRetries().catch(() => {}); });

  globalThis.AVJP.runner = { start, watchdog, cancelCurrent, openTab, promoteDueRetries };
})();
