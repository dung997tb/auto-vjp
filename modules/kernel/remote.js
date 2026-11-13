/* Auto vjp — kernel remote (2.12.0): NGUỒN VIỆC TỪ XA + báo kết quả về máy chủ (hub).
 *
 * Extension luôn là bên GỌI RA; hub không gọi vào extension. Mặc định TẮT:
 * chưa có địa chỉ hub thì file này không gửi gì đi đâu cả.
 *
 * Vòng đời:
 *   1) ensureProfileId — lần đầu sinh ID ngẫu nhiên cho profile, lưu bền.
 *   2) register — báo danh lên hub; hub cấp token riêng, profile ở trạng thái
 *      `pending` cho tới khi được duyệt trên web.
 *   3) sync (lúc khởi động + mỗi nhịp alarm 1 phút) — báo sống, và khi đã được
 *      duyệt thì nhận việc đến hạn. Việc nhận về đi qua ĐÚNG source.enqueue như
 *      việc tạo tại chỗ (cùng validate, cùng hàng đợi), mang nhãn origin:'remote'.
 *   4) onReceipt — mọi receipt (kể cả việc tại chỗ) được xếp vào hàng báo cáo
 *      bền rồi gửi về hub; mất mạng thì giữ lại gửi sau.
 *
 * Quyền của máy tại chỗ cao hơn hub: `accept:false` = vẫn báo sống nhưng không
 * nhận việc; disconnect() = xoá token + địa chỉ, dừng hẳn.
 *
 * Dữ liệu KHÔNG BAO GIỜ gửi lên hub: API key AI, cookie/phiên đăng nhập, nội
 * dung storage của lõi FB. Chỉ gửi: ID profile, phiên bản, danh sách tài khoản
 * đã quét (tên/username/nền tảng), trạng thái bận/rảnh và receipt.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;

  // Địa chỉ hub ghi sẵn (tuỳ chọn). Điền vào đây thì cài extension vào profile
  // nào profile đó tự báo danh, khỏi nhập tay. Để trống = hỏi trong trang quản lý.
  const DEFAULT_HUB_URL = '';

  const KEY_ID = 'autovjp.profileId';
  const KEY_CFG = 'autovjp.remote';          // {url, token, status, accept, nonce, lastSyncAt, lastError, name}
  const KEY_REPORTS = 'autovjp.remoteReports'; // [receipt] chờ gửi về hub
  const KEY_SEEN = 'autovjp.remoteSeen';       // [remote_task_id] đã nhận, chống enqueue trùng

  const MIN_SYNC_GAP_MS = 45 * 1000;
  const FETCH_TIMEOUT_MS = 20 * 1000;
  const MAX_REPORTS = 300;
  const MAX_SEEN = 500;
  const MAX_CLAIM = 3;               // số việc từ xa tối đa giữ trong hàng đợi local
  const MAX_RECEIPT_BYTES = 60 * 1000;

  function normalizeUrl(input) {
    const raw = String(input || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    let u;
    try { u = new URL(raw); } catch (_) { throw new Error('Địa chỉ máy chủ không hợp lệ'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Địa chỉ máy chủ phải bắt đầu bằng https:// hoặc http://');
    if (u.username || u.password) throw new Error('Không đặt tài khoản/mật khẩu trong địa chỉ máy chủ');
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }

  function randomId(prefix, bytes) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return prefix + Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function ensureProfileId() {
    return S.withLock(async () => {
      let id = await S.get(KEY_ID);
      if (!id || typeof id !== 'string') {
        id = randomId('pf_', 12);
        await S.set({ [KEY_ID]: id });
      }
      return id;
    });
  }

  async function getCfg() {
    const cfg = (await S.get(KEY_CFG)) || {};
    // Người dùng đã bấm "Ngắt kết nối" thì địa chỉ ghi sẵn cũng không tự nối lại.
    if (cfg.disconnected) return { ...cfg, url: '', token: '', status: 'off', accept: true };
    if (!cfg.url && DEFAULT_HUB_URL) {
      try { cfg.url = normalizeUrl(DEFAULT_HUB_URL); } catch (_) { /* địa chỉ ghi sẵn hỏng -> coi như chưa cấu hình */ }
    }
    if (typeof cfg.accept !== 'boolean') cfg.accept = true;
    if (!cfg.status) cfg.status = cfg.url ? 'unregistered' : 'off';
    return cfg;
  }

  async function patchCfg(patch) {
    return S.withLock(async () => {
      const next = { ...(await getCfg()), ...patch };
      await S.set({ [KEY_CFG]: next });
      return next;
    });
  }

  function extVersion() {
    try { return chrome.runtime.getManifest().version; } catch (_) { return ''; }
  }

  // Chỉ các trường nhận diện tài khoản — không gửi nguyên bản ghi quét.
  async function accountSummary() {
    const stored = (await S.get(S.KEYS.ACCOUNTS)) || {};
    const out = [];
    for (const platform of Object.keys(stored)) {
      for (const acc of (Array.isArray(stored[platform]) ? stored[platform] : [])) {
        if (!acc) continue;
        out.push({
          platform,
          username: String(acc.social_username || acc.username || '').slice(0, 80),
          name: String(acc.social_name || acc.display_name || acc.name || '').slice(0, 80)
        });
        if (out.length >= 60) return out;
      }
    }
    return out;
  }

  async function call(cfg, path, body, token) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(cfg.url + path, {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: ctrl.signal, cache: 'no-store', credentials: 'omit'
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      return { ok: res.ok, status: res.status, data: data || {} };
    } finally {
      clearTimeout(timer);
    }
  }

  async function register(cfg, profileId) {
    const res = await call(cfg, '/api/agent/register', {
      profile_id: profileId, version: extVersion(), accounts: await accountSummary()
    });
    if (res.status === 409) {
      // Hub đã có ID này nhưng máy này không giữ token (vd dữ liệu bị xoá một
      // phần) — không tự nhận là profile cũ được. Người dùng phải "Đăng ký lại".
      return patchCfg({ status: 'id_conflict', lastError: 'ID này đã có trên máy chủ. Bấm "Đăng ký lại" để sinh ID mới.' });
    }
    if (!res.ok || !res.data.token) throw new Error(res.data.error || ('Máy chủ trả HTTP ' + res.status));
    return patchCfg({ token: res.data.token, status: res.data.status || 'pending', nonce: null, lastError: '' });
  }

  async function remoteQueued() {
    const queue = (await S.get(S.KEYS.QUEUE)) || [];
    return queue.filter(t => t && t.origin === 'remote').length;
  }

  async function acceptTasks(tasks) {
    const rejected = [];
    for (const item of tasks) {
      const remoteId = String((item && item.id) || '');
      if (!remoteId || !item.payload || typeof item.payload !== 'object') continue;
      const seen = (await S.get(KEY_SEEN)) || [];
      if (seen.includes(remoteId)) continue;
      // Ghi "đã nhận" TRƯỚC khi enqueue: thà mất một việc (hub hiện "đã giao,
      // chưa có kết quả" để người dùng giao lại) còn hơn chạy trùng hai lần.
      await S.set({ [KEY_SEEN]: seen.concat(remoteId).slice(-MAX_SEEN) });
      try {
        await globalThis.AVJP.source.enqueue({ ...item.payload, origin: 'remote', remote_task_id: remoteId });
      } catch (err) {
        rejected.push({
          receipt_id: randomId('rcpt_rej_', 6), remote_task_id: remoteId, origin: 'remote',
          type: String(item.payload.type || ''), platform: String(item.payload.platform || ''),
          status: 'failed', failure_code: 'rejected',
          message: 'Extension từ chối việc: ' + (err && err.message ? err.message : String(err)),
          received_at: Date.now()
        });
      }
    }
    if (rejected.length) await queueReports(rejected);
  }

  function trimReceipt(receipt) {
    const r = { ...receipt };
    if (JSON.stringify(r).length > MAX_RECEIPT_BYTES) {
      r.items = undefined;
      r.details = null;
      r.truncated = true;
    }
    return r;
  }

  async function queueReports(receipts) {
    await S.withLock(async () => {
      const pending = (await S.get(KEY_REPORTS)) || [];
      await S.set({ [KEY_REPORTS]: pending.concat(receipts.map(trimReceipt)).slice(-MAX_REPORTS) });
    });
  }

  // Outbox gọi sau khi receipt đã ghi xong. Không cấu hình hub thì bỏ qua,
  // không tích trữ gì.
  async function onReceipt(receipt) {
    if (!receipt) return;
    const cfg = await getCfg();
    if (!cfg.url || !cfg.token) return;
    await queueReports([receipt]);
    flushReports().catch(() => {});
  }

  let flushing = null;
  function flushReports() {
    if (flushing) return flushing;
    flushing = (async () => {
      const cfg = await getCfg();
      if (!cfg.url || !cfg.token || cfg.status !== 'approved') return 0;
      const pending = (await S.get(KEY_REPORTS)) || [];
      if (!pending.length) return 0;
      const batch = pending.slice(0, 25);
      const res = await call(cfg, '/api/agent/results', { profile_id: await ensureProfileId(), results: batch }, cfg.token);
      if (!res.ok) throw new Error(res.data.error || ('Máy chủ trả HTTP ' + res.status));
      const sent = new Set(batch.map(r => r.receipt_id));
      await S.withLock(async () => {
        const now = (await S.get(KEY_REPORTS)) || [];
        await S.set({ [KEY_REPORTS]: now.filter(r => !sent.has(r.receipt_id)) });
      });
      return batch.length;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  let syncing = null;
  let lastAttemptAt = 0;

  // sync({force}) — báo sống + nhận việc + đẩy báo cáo. An toàn khi gọi dồn:
  // chỉ một lượt chạy tại một thời điểm, và không dày hơn 45 giây trừ khi force.
  function sync(opts) {
    const force = Boolean(opts && opts.force);
    if (syncing) return syncing;
    if (!force && Date.now() - lastAttemptAt < MIN_SYNC_GAP_MS) return Promise.resolve(null);
    lastAttemptAt = Date.now();
    syncing = doSync().finally(() => { syncing = null; });
    return syncing;
  }

  async function doSync() {
    let cfg = await getCfg();
    if (!cfg.url) return null;
    if (cfg.status === 'revoked' || cfg.status === 'id_conflict') return cfg;
    try {
      const profileId = await ensureProfileId();
      if (!cfg.token) {
        cfg = await register(cfg, profileId);
        if (!cfg.token) return cfg;
      }
      const run = await S.getRun();
      const queuedRemote = await remoteQueued();
      const res = await call(cfg, '/api/agent/sync', {
        profile_id: profileId,
        version: extVersion(),
        busy: Boolean(run),
        accept: Boolean(cfg.accept),
        capacity: cfg.accept ? Math.max(0, MAX_CLAIM - queuedRemote) : 0,
        nonce: cfg.nonce || null,
        accounts: await accountSummary()
      }, cfg.token);

      if (res.status === 401 || res.status === 403) {
        // Token bị thu hồi / profile bị xoá trên hub: dừng hẳn, không tự đăng ký lại.
        return patchCfg({ status: 'revoked', lastError: res.data.error || 'Máy chủ đã thu hồi quyền của profile này.' });
      }
      if (!res.ok) throw new Error(res.data.error || ('Máy chủ trả HTTP ' + res.status));

      cfg = await patchCfg({
        status: res.data.status || cfg.status,
        nonce: res.data.nonce || cfg.nonce || null,
        name: res.data.name || cfg.name || '',
        lastSyncAt: Date.now(),
        lastError: ''
      });
      if (cfg.status === 'approved') {
        if (cfg.accept && Array.isArray(res.data.tasks) && res.data.tasks.length) await acceptTasks(res.data.tasks);
        await flushReports().catch(err => console.debug('[Auto vjp][remote] gửi báo cáo lỗi, sẽ thử lại:', err));
      }
      return cfg;
    } catch (err) {
      const message = err && err.name === 'AbortError' ? 'Máy chủ không phản hồi (quá 20 giây)' : (err && err.message ? err.message : String(err));
      return patchCfg({ lastError: message, lastErrorAt: Date.now() });
    }
  }

  // ---- Lệnh từ trang quản lý ----
  async function configure(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) throw new Error('Chưa nhập địa chỉ máy chủ');
    const current = await getCfg();
    if (current.url !== normalized) {
      // Đổi máy chủ: token cũ không còn ý nghĩa, báo cáo tồn cũng không gửi sang máy chủ mới.
      await S.set({ [KEY_CFG]: { url: normalized, token: '', status: 'unregistered', accept: true, nonce: null, lastError: '' }, [KEY_REPORTS]: [] });
    }
    await sync({ force: true });
    return state();
  }

  async function setAccept(accept) {
    await patchCfg({ accept: Boolean(accept) });
    sync({ force: true }).catch(() => {});
    return state();
  }

  async function disconnect() {
    await S.set({ [KEY_CFG]: { url: '', token: '', status: 'off', accept: true, disconnected: true }, [KEY_REPORTS]: [] });
    return state();
  }

  // Sinh ID mới rồi báo danh lại như profile mới (dùng khi ID bị trùng do sao
  // chép thư mục profile, hoặc sau khi bị thu hồi).
  async function reRegister() {
    const cfg = await getCfg();
    await S.set({
      [KEY_ID]: randomId('pf_', 12),
      [KEY_CFG]: { url: cfg.url || '', token: '', status: cfg.url ? 'unregistered' : 'off', accept: true, nonce: null, lastError: '' },
      [KEY_REPORTS]: [], [KEY_SEEN]: []
    });
    await sync({ force: true });
    return state();
  }

  async function state() {
    const stored = (await S.get(KEY_CFG)) || {};
    const cfg = await getCfg();
    return {
      profileId: await ensureProfileId(),
      url: cfg.url || '',
      urlBuiltIn: Boolean(DEFAULT_HUB_URL) && !stored.url && !stored.disconnected,
      status: cfg.status,
      accept: Boolean(cfg.accept),
      name: cfg.name || '',
      lastSyncAt: cfg.lastSyncAt || null,
      lastError: cfg.lastError || '',
      pendingReports: ((await S.get(KEY_REPORTS)) || []).length
    };
  }

  globalThis.AVJP.remote = {
    ensureProfileId, sync, onReceipt, flushReports,
    configure, setAccept, disconnect, reRegister, state, normalizeUrl
  };
})();
