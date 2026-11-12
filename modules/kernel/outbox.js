/* Auto vjp — kernel outbox: nơi DUY NHẤT biến kết quả thi hành thành receipt local.
 * Thay cho MUT result-reporter (POST /v2/tasks/result chờ server ACK):
 *   kết quả -> vào OUTBOX (bền) -> ghi RECEIPT local -> đó là "ACK" -> mới dọn canonical run + đóng tab.
 * Kỷ luật giữ nguyên của MUT: uncertain không tự chạy lại; receipt trùng bị chặn bằng receipt key.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;
  const K = S.KEYS;

  function receiptKeyOf(r) {
    return JSON.stringify([r.type, String(r.taskId || ''), r.platform || '', r.runId || '', r.sourceKey || '']);
  }

  function finalStatus(r) {
    if (r.status) return r.status;
    const items = Array.isArray(r.items) ? r.items : null;
    if (r.type === 'affiliate' && r.exhausted && !r.error && (!items || items.length === 0)) return 'skipped';
    if (r.error) return items && items.length ? 'success' : 'failed';
    return 'success';
  }

  // deliver(result) -> Promise<boolean confirmed>
  // result: {type, taskId, platform, status?, error?, resultMessage?, details?, resultUrl?, resultUrlType?,
  //          items?, sourceUrl?, sourceKey?, runId?, deliveryId?, tabId?, exhausted?, forceCleanup?}
  async function deliver(result) {
    if (!result || !result.type) return false;
    return S.withLock(async () => {
      const stored = await S.getMany([K.OUTBOX, K.RECEIPTS, K.RECEIPT_KEYS, K.CANONICAL, K.MANAGED_TABS, K.TEST_STATE, K.CANCEL_FLAGS]);
      const run = stored[K.CANONICAL] || null;

      // Chỉ nhận kết quả thuộc run đang giữ (hoặc task scan không qua canonical) — chống kết quả lạc.
      const taskId = String(result.taskId || '');
      if (run && taskId && String(run.task_id) !== taskId && String(run.id) !== taskId) {
        console.warn('[Auto vjp][outbox] Bỏ kết quả không khớp run hiện tại', { taskId, runTask: run.task_id });
        return false;
      }

      // (2.11.10) Chốt tab: kết quả phải đến từ đúng tab của run. Callback
      // cũ/sai phiên gửi từ tab lạ dù khớp taskId cũng bị bỏ — KHÔNG ghi
      // receipt. Ngoại lệ scan_account: quét ngoài canonical, tab không
      // ràng buộc với run. Thiếu tabId ở một trong hai phía thì cho qua
      // (tương thích các đường deliver cũ không mang tab).
      if (result.type !== 'scan_account' && run?.tabId && result.tabId && String(run.tabId) !== String(result.tabId)) {
        console.warn('[Auto vjp][outbox] Bỏ kết quả sai tab của run', { taskId, runTab: run.tabId, resultTab: result.tabId });
        return false;
      }

      const key = receiptKeyOf({ ...result, runId: result.runId || run?.run_id || '' });
      const seenKeys = Array.isArray(stored[K.RECEIPT_KEYS]) ? stored[K.RECEIPT_KEYS] : [];
      if (seenKeys.includes(key)) return true; // đã ghi receipt rồi — coi như đã ACK

      const now = Date.now();
      const receipt = {
        receipt_id: S.newId('rcpt'),
        task_id: taskId || String(run?.task_id || run?.id || ''),
        run_id: result.runId || run?.run_id || null,
        delivery_id: result.deliveryId || run?.delivery_id || null,
        type: result.type,
        platform: result.platform || run?.platform || 'facebook',
        status: finalStatus(result),
        result_url: result.resultUrl || null,
        result_url_type: result.resultUrlType || null,
        actor_url: result.actorUrl || null,
        actor_name: result.actorName || null,
        target_name: result.targetName || null,
        items: Array.isArray(result.items) ? result.items : undefined,
        items_count: Array.isArray(result.items) ? result.items.length : undefined,
        message: result.resultMessage || result.error || '',
        details: result.details || null,
        failure_code: result.failure_code || null,
        source_url: result.sourceUrl || null,
        started_at: run?.startedAt || null,
        received_at: now,
        duration_ms: run?.startedAt ? now - run.startedAt : null
      };

      // 1) Vào outbox trước (bền) — nếu SW chết giữa chừng, receipt vẫn truy được từ outbox ở lần khởi động sau.
      const outbox = Array.isArray(stored[K.OUTBOX]) ? stored[K.OUTBOX] : [];
      outbox.push(receipt);
      await S.set({ [K.OUTBOX]: outbox });

      // 2) Ghi receipt = ACK local -> dọn outbox mục này, lưu receipt + key chống trùng.
      const receipts = (Array.isArray(stored[K.RECEIPTS]) ? stored[K.RECEIPTS] : []).concat(receipt).slice(-200);
      const nextKeys = seenKeys.concat(key).slice(-200);
      const remainingOutbox = outbox.filter(item => item.receipt_id !== receipt.receipt_id);
      await S.set({ [K.RECEIPTS]: receipts, [K.RECEIPT_KEYS]: nextKeys, [K.OUTBOX]: remainingOutbox });

      // (2.11.18) Hook testState: receipt chung cuộc (không phải 'retrying')
      // của run có meta.testKey -> chốt testState theo receipt + xoá cờ huỷ
      // của task này. Gói try/catch riêng: lỗi ở hook TUYỆT ĐỐI không được
      // làm deliver fail. Các đường return sớm (dedupe / không khớp run /
      // sai tab) nằm TRƯỚC điểm này nên tự nhiên bỏ qua hook như thiết kế.
      try {
        if (receipt.status !== 'retrying' && run
          && (String(run.task_id) === taskId || String(run.id) === taskId)
          && run.meta?.testKey) {
          const testState = (stored[K.TEST_STATE] && typeof stored[K.TEST_STATE] === 'object')
            ? stored[K.TEST_STATE] : {};
          testState[run.meta.testKey] = {
            status: receipt.status, at: now, message: receipt.message || '', task_id: receipt.task_id
          };
          const updates = { [K.TEST_STATE]: testState };
          const cancelFlags = (stored[K.CANCEL_FLAGS] && typeof stored[K.CANCEL_FLAGS] === 'object')
            ? stored[K.CANCEL_FLAGS] : null;
          if (cancelFlags && Object.prototype.hasOwnProperty.call(cancelFlags, taskId)) {
            delete cancelFlags[taskId];
            updates[K.CANCEL_FLAGS] = cancelFlags;
          }
          await S.set(updates);
        }
      } catch (hookErr) {
        console.warn('[Auto vjp][outbox] hook testState lỗi — bỏ qua, deliver vẫn tiếp tục', hookErr);
      }

      // 3) Dọn canonical run nếu là run của task này + đóng tab managed.
      const tabId = result.tabId || run?.tabId || null;
      if (run && (!taskId || String(run.task_id) === taskId || String(run.id) === taskId)) {
        await S.clearRun();
      }
      const managed = Array.isArray(stored[K.MANAGED_TABS]) ? stored[K.MANAGED_TABS] : [];
      if (tabId && managed.includes(tabId)) {
        await S.set({ [K.MANAGED_TABS]: managed.filter(id => id !== tabId) });
        chrome.tabs.remove(tabId).catch(() => {});
      }
      await S.set({ [K.LAST_STATUS]: `Auto vjp: ${receipt.type}/${receipt.platform} -> ${receipt.status}` });
      return true;
    }).then(confirmed => {
      // Sau khi dọn xong mới claim việc tiếp theo (ngoài lock để tránh deadlock).
      if (confirmed && globalThis.AVJP.source) globalThis.AVJP.source.kick().catch(() => {});
      return confirmed;
    }).catch(err => {
      console.error('[Auto vjp][outbox] deliver error', err);
      return false;
    });
  }

  // replayPending() -> Promise<số receipt đã khôi phục> (2.11.10)
  // deliver() ghi OUTBOX trước rồi mới ghi RECEIPT — SW chết giữa hai lần
  // ghi là receipt mất nhưng mục outbox còn nằm lại. Lúc khởi động, quét
  // outbox: mục nào chưa có trong RECEIPTS (theo receipt_id hoặc key
  // chống trùng) thì bổ sung vào RECEIPTS + thêm key, rồi dọn khỏi
  // OUTBOX. Mục đã có receipt thì chỉ dọn khỏi outbox (đừng để tồn mãi).
  // KHÔNG đụng canonical run — phiên chạy dở để watchdog xử như cũ.
  // Chạy lại nhiều lần an toàn: lần sau outbox đã sạch, không trùng.
  async function replayPending() {
    return S.withLock(async () => {
      const stored = await S.getMany([K.OUTBOX, K.RECEIPTS, K.RECEIPT_KEYS]);
      const pending = Array.isArray(stored[K.OUTBOX]) ? stored[K.OUTBOX] : [];
      if (!pending.length) return 0;
      const receipts = (Array.isArray(stored[K.RECEIPTS]) ? stored[K.RECEIPTS] : []).slice();
      const seenKeys = (Array.isArray(stored[K.RECEIPT_KEYS]) ? stored[K.RECEIPT_KEYS] : []).slice();
      let restored = 0;
      for (const item of pending) {
        // Mục outbox lưu ở dạng receipt (task_id/run_id snake_case) — dựng
        // lại key theo các trường đó. Receipt không lưu sourceKey nên key
        // dựng lại thiếu thành phần này; bù bằng chốt receipt_id bên dưới.
        const key = receiptKeyOf({
          type: item.type, taskId: item.task_id || '', platform: item.platform || '',
          runId: item.run_id || '', sourceKey: ''
        });
        const already = receipts.some(r => r.receipt_id && r.receipt_id === item.receipt_id) || seenKeys.includes(key);
        if (!already) {
          receipts.push(item);
          seenKeys.push(key);
          restored++;
        }
      }
      await S.set({
        [K.RECEIPTS]: receipts.slice(-200),
        [K.RECEIPT_KEYS]: seenKeys.slice(-200),
        [K.OUTBOX]: []
      });
      if (restored) console.warn(`[Auto vjp][outbox] replayPending: khôi phục ${restored} receipt từ outbox tồn`);
      return restored;
    }).catch(err => {
      console.error('[Auto vjp][outbox] replayPending error', err);
      return 0;
    });
  }

  globalThis.AVJP.outbox = { deliver, receiptKeyOf, replayPending };
})();
