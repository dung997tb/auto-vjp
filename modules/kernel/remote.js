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

  function quickHash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + text.length;
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
    if (cfg.disconnected) {
      globalThis.AVJP.media?.setTrustedHost?.('');
      return { ...cfg, url: '', token: '', status: 'off', accept: true };
    }
    if (!cfg.url && DEFAULT_HUB_URL) {
      try { cfg.url = normalizeUrl(DEFAULT_HUB_URL); } catch (_) { /* địa chỉ ghi sẵn hỏng -> coi như chưa cấu hình */ }
    }
    // (2.18.0) Cho phép tải video/ảnh từ chính hub này dù nó nằm trong mạng riêng.
    try { globalThis.AVJP.media?.setTrustedHost?.(cfg.url ? new URL(cfg.url).hostname : ''); } catch (_) { /* url hỏng -> không tin host nào */ }
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

  // Chỉ các trường nhận diện + số liệu công khai của tài khoản — không gửi
  // nguyên bản ghi quét. (2.16.0) thêm số người theo dõi, thời điểm quét, và
  // nick/Page Facebook mà lõi đang nhớ.
  async function accountSummary() {
    const stored = (await S.get(S.KEYS.ACCOUNTS)) || {};
    const out = [];
    const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
    for (const platform of Object.keys(stored)) {
      for (const acc of (Array.isArray(stored[platform]) ? stored[platform] : [])) {
        if (!acc) continue;
        out.push({
          platform,
          kind: 'nick',
          username: String(acc.social_username || acc.username || '').slice(0, 80),
          name: String(acc.social_name || acc.display_name || acc.name || '').slice(0, 80),
          followers: num(acc.followers_count ?? acc.subscribers_count ?? acc.friends_count),
          scanned_at: num(acc.scanned_at)
        });
        if (out.length >= 60) break;
      }
    }
    if (globalThis.AVJP.fbtask && globalThis.AVJP.fbtask.identity) {
      for (const acc of await globalThis.AVJP.fbtask.identity()) out.push({ ...acc, followers: null, scanned_at: null });
    }
    return out.slice(0, 100);
  }

  // (2.16.0) Tự quét nick: lần đầu quét mọi nền tảng; sau đó nền tảng đã có
  // nick thì mỗi ngày một lần, chưa có thì mỗi tuần một lần. Chỉ khi profile
  // đang rảnh, mỗi lượt đồng bộ tối đa một nền tảng.
  const SCAN_DAILY_MS = 24 * 3600 * 1000;
  const SCAN_WEEKLY_MS = 7 * SCAN_DAILY_MS;
  async function maybeAutoScan(cfg) {
    if (cfg.autoScan === false) return null;
    if (await S.getRun()) return null;
    if (((await S.get(S.KEYS.QUEUE)) || []).length) return null;
    const contract = globalThis.AVJP.contract;
    const stored = (await S.get(S.KEYS.ACCOUNTS)) || {};
    const scanAt = cfg.scanAt && typeof cfg.scanAt === 'object' ? cfg.scanAt : {};
    const t = Date.now();
    for (const platform of contract.platformNames) {
      if (platform === 'probe' || platform === 'facebook') continue;
      let supported = false;
      try { supported = Boolean(contract.PLATFORMS[platform].scripts({ type: 'scan_account' })); } catch (_) { supported = false; }
      if (!supported) continue;
      const known = Array.isArray(stored[platform]) && stored[platform].length > 0;
      const last = Number(scanAt[platform] || 0);
      if (last && t - last < (known ? SCAN_DAILY_MS : SCAN_WEEKLY_MS)) continue;
      await patchCfg({ scanAt: { ...scanAt, [platform]: t } });
      await globalThis.AVJP.source.enqueue({ platform, type: 'scan_account', auto_scan: true });
      return platform;
    }
    return null;
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

  // (2.18.0) Tệp trong kho của hub được ghi trong task dạng "hub://media/…";
  // đổi thành địa chỉ thật theo hub mà profile này đang nối.
  function resolveHubRefs(value, hubUrl) {
    if (typeof value === 'string') return value.startsWith('hub://media/') ? hubUrl + '/media/' + value.slice('hub://media/'.length) : value;
    if (Array.isArray(value)) return value.map(v => resolveHubRefs(v, hubUrl));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = resolveHubRefs(v, hubUrl);
      return out;
    }
    return value;
  }

  async function acceptTasks(tasks) {
    const hubUrl = (await getCfg()).url;
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
        await globalThis.AVJP.source.enqueue({ ...resolveHubRefs(item.payload, hubUrl), origin: 'remote', remote_task_id: remoteId });
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
      // (2.13.0) Mẫu cấu hình Facebook (các lịch đã tạo trong popup): chỉ gửi khi đổi.
      const fbTemplates = globalThis.AVJP.fbtask ? await globalThis.AVJP.fbtask.templates() : [];
      const fbHash = quickHash(JSON.stringify(fbTemplates));
      const res = await call(cfg, '/api/agent/sync', {
        profile_id: profileId,
        version: extVersion(),
        busy: Boolean(run),
        accept: Boolean(cfg.accept),
        capacity: cfg.accept ? Math.max(0, MAX_CLAIM - queuedRemote) : 0,
        nonce: cfg.nonce || null,
        accounts: await accountSummary(),
        fb_available: Boolean(globalThis.AVJP.fbtask && globalThis.AVJP.fbtask.available()),
        fb_templates_hash: fbHash,
        ...(fbHash !== cfg.fbHash ? { fb_templates: fbTemplates } : {})
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
        fbHash,
        lastError: ''
      });
      if (cfg.status === 'approved') {
        if (cfg.accept && Array.isArray(res.data.tasks) && res.data.tasks.length) await acceptTasks(res.data.tasks);
        await flushReports().catch(err => console.debug('[Auto vjp][remote] gửi báo cáo lỗi, sẽ thử lại:', err));
        await maybeAutoScan(cfg).catch(err => console.debug('[Auto vjp][remote] tự quét nick lỗi:', err));
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

  async function setAutoScan(enabled) {
    await patchCfg({ autoScan: Boolean(enabled) });
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
      autoScan: cfg.autoScan !== false,
      name: cfg.name || '',
      lastSyncAt: cfg.lastSyncAt || null,
      lastError: cfg.lastError || '',
      pendingReports: ((await S.get(KEY_REPORTS)) || []).length
    };
  }

  // Nạp cấu hình một lần lúc khởi động service worker để media.js biết host của
  // hub trước khi task nào kịp tải tệp.
  getCfg().catch(() => {});

  globalThis.AVJP.remote = {
    ensureProfileId, sync, onReceipt, flushReports,
    configure, setAccept, setAutoScan, disconnect, reRegister, state, normalizeUrl
  };
})();
