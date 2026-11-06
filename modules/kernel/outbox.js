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
      const stored = await S.getMany([K.OUTBOX, K.RECEIPTS, K.RECEIPT_KEYS, K.CANONICAL, K.MANAGED_TABS]);
      const run = stored[K.CANONICAL] || null;

      // Chỉ nhận kết quả thuộc run đang giữ (hoặc task scan không qua canonical) — chống kết quả lạc.
      const taskId = String(result.taskId || '');
      if (run && taskId && String(run.task_id) !== taskId && String(run.id) !== taskId) {
        console.warn('[Auto vjp][outbox] Bỏ kết quả không khớp run hiện tại', { taskId, runTask: run.task_id });
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

  globalThis.AVJP.outbox = { deliver, receiptKeyOf };
})();
