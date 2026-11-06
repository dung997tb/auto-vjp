/* Auto vjp — kernel store: lớp storage duy nhất của tầng module.
 * Mọi key của tầng module đều có tiền tố `autovjp.` — trừ key canonical
 * `currentAutomationRun` (hợp đồng với content-script đã port từ MUT, giữ nguyên tên).
 * Không module nào được đọc/ghi key nội bộ của lõi FB; lõi FB cũng không đọc key autovjp.*.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const local = chrome.storage.local;

  const KEYS = {
    QUEUE: 'autovjp.taskQueue',          // [{task}] chờ claim
    SCHEDULES: 'autovjp.schedules',      // [{id, template, run_at, repeat}]
    RECEIPTS: 'autovjp.receipts',        // [receipt] tối đa 200, mới nhất cuối
    RECEIPT_KEYS: 'autovjp.receiptKeys', // [key] chống trùng receipt, tối đa 200
    OUTBOX: 'autovjp.outbox',            // kết quả đã vào hộp chờ ghi receipt (thường rỗng vì ghi tức thì)
    ACCOUNTS: 'autovjp.accounts',        // {platform: [account]} từ scanner, local only
    MANAGED_TABS: 'autovjp.managedTabs', // [tabId] tab do tầng module mở
    PAUSED: 'autovjp.paused',            // bool
    LEARNED: 'autovjp.learnedSelectors', // (2.9.0) {"platform:key": {spec, at, hits}} — selector tự chữa đã qua proof, xem modules/kernel/heal.js + modules/shared/HEALER.md
    CANONICAL: 'currentAutomationRun',   // canonical run đang chạy (hợp đồng MUT)
    LAST_STATUS: 'lastStatus'            // dùng chung với MUT/lõi để hiển thị trạng thái gần nhất
  };

  // Mutex nối tiếp mọi thao tác ghi của kernel (tránh race giữa alarm/kick/receipt).
  let chain = Promise.resolve();
  function withLock(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }

  async function get(key) {
    const out = await local.get(key);
    return out[key];
  }
  async function getMany(keys) { return local.get(keys); }
  async function set(obj) { return local.set(obj); }
  async function remove(keys) { return local.remove(keys); }

  async function getRun() { return (await get(KEYS.CANONICAL)) || null; }
  async function setRun(run) { return set({ [KEYS.CANONICAL]: run }); }
  async function clearRun() { return remove(KEYS.CANONICAL); }

  async function touchRun(patch) {
    return withLock(async () => {
      const run = await getRun();
      if (!run) return null;
      const next = { ...run, ...patch, updatedAt: Date.now() };
      await setRun(next);
      return next;
    });
  }

  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  globalThis.AVJP.store = { KEYS, withLock, get, getMany, set, remove, getRun, setRun, clearRun, touchRun, newId };
})();
