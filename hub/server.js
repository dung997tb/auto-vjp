#!/usr/bin/env node
/* Auto vjp Hub — máy chủ điều phối cho các profile chạy extension Auto vjp.
 *
 * Không phụ thuộc gói ngoài: node:http + node:sqlite (Node >= 22.13).
 *
 * Hai nhóm API:
 *   /api/agent/*  — extension gọi (Bearer token riêng từng profile, có CORS)
 *       POST register  báo danh, nhận token; profile ở trạng thái pending
 *       POST sync      báo sống + nhận việc đến hạn (chỉ khi đã duyệt)
 *       POST results   gửi receipt
 *   /api/launcher/sync — chương trình launcher trên máy có GemLogin gọi (Bearer
 *       token riêng từng máy): báo danh sách profile GemLogin + cái đang mở,
 *       nhận lệnh mở/đóng
 *   /api/admin/*  — trang quản lý gọi (cookie phiên đăng nhập)
 *
 * Biến môi trường:
 *   HUB_ADMIN_PASSWORD  bắt buộc, >= 10 ký tự — mật khẩu tài khoản "admin"
 *   HUB_PORT            mặc định 8787
 *   HUB_DATA            thư mục chứa hub.db, mặc định ./data
 *   HUB_BASE_PATH       tiền tố đường dẫn khi đặt sau reverse proxy, vd /hub
 *   HUB_SECURE_COOKIE   "1" = cookie chỉ gửi qua HTTPS (bật khi có HTTPS)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MAX_BODY = 1024 * 1024;
const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const NEVER_ONLINE_MS = 10 * 60 * 1000;   // launcher mở profile mà quá lâu extension không báo sống
const LAUNCH_BACKOFF_MS = 60 * 60 * 1000;  // sau lần mở hỏng, chờ bấy lâu mới thử lại
const WORKING_WINDOW_MS = 4 * 3600 * 1000; // việc "đã giao" trong khoảng này coi như còn đang làm
const DISCOVER_MIN_MS = 20 * 1000;
const DISCOVER_MAX_MS = 150 * 1000;
const FINAL_STATUSES = new Set(['success', 'failed', 'uncertain', 'skipped', 'cancelled']);

/* ---------- Hợp đồng task: dùng lại đúng file của extension ---------- */
function loadContract() {
  const candidates = [
    process.env.HUB_CONTRACT_DIR,
    path.join(__dirname, 'contract'),
    path.join(__dirname, '..', 'modules', 'kernel')
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'contract.js'))) {
      require(path.join(dir, 'contract-data.js'));
      require(path.join(dir, 'contract.js'));
      return globalThis.AVJP.contract;
    }
  }
  throw new Error('Không tìm thấy contract.js (đặt HUB_CONTRACT_DIR hoặc chạy trong repo auto-vjp)');
}

function supportedTypes(contract) {
  const out = {};
  for (const platform of contract.platformNames) {
    if (platform === 'probe') continue;
    out[platform] = contract.TASK_TYPES.filter(type => {
      if (type === 'probe') return false;
      try { return Boolean(contract.PLATFORMS[platform].scripts({ type })); } catch (_) { return false; }
    });
  }
  return out;
}

/* ---------- Tiện ích ---------- */
const now = () => Date.now();
const rid = (prefix, bytes = 12) => prefix + crypto.randomBytes(bytes).toString('hex');
const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function checkPassword(password, stored) {
  const [salt] = String(stored || '').split(':');
  return Boolean(salt) && safeEqual(hashPassword(password, salt), stored);
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const parseJson = (text, fallback) => { try { return JSON.parse(text); } catch (_) { return fallback; } };

function createHub(options = {}) {
  const adminPassword = options.adminPassword ?? process.env.HUB_ADMIN_PASSWORD ?? '';
  if (String(adminPassword).length < 10) {
    throw new Error('Thiếu HUB_ADMIN_PASSWORD (tối thiểu 10 ký tự).');
  }
  const basePath = String(options.basePath ?? process.env.HUB_BASE_PATH ?? '').replace(/\/+$/, '');
  const secureCookie = options.secureCookie ?? process.env.HUB_SECURE_COOKIE === '1';
  const contract = options.contract || loadContract();
  const types = supportedTypes(contract);

  let dbPath = options.dbPath;
  if (!dbPath) {
    const dataDir = options.dataDir || process.env.HUB_DATA || path.join(__dirname, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    dbPath = path.join(dataDir, 'hub.db');
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', token_hash TEXT NOT NULL,
      nonce TEXT, conflict_at INTEGER, version TEXT, accounts_json TEXT,
      busy INTEGER NOT NULL DEFAULT 0, accept INTEGER NOT NULL DEFAULT 1,
      last_seen_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      payload_json TEXT NOT NULL, run_at INTEGER NOT NULL, repeat TEXT,
      status TEXT NOT NULL DEFAULT 'queued', message TEXT, result_json TEXT,
      created_at INTEGER NOT NULL, claimed_at INTEGER, finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tasks_due ON tasks (profile_id, status, run_at);
    CREATE TABLE IF NOT EXISTS results (
      receipt_id TEXT NOT NULL, profile_id TEXT NOT NULL, task_id TEXT,
      origin TEXT, platform TEXT, type TEXT, status TEXT, message TEXT,
      receipt_json TEXT NOT NULL, received_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, receipt_id)
    );
  `);
  const q = sql => db.prepare(sql);
  // Nâng cấp lược đồ cho DB tạo từ bản trước.
  const profileCols = new Set(q('PRAGMA table_info(profiles)').all().map(c => c.name));
  if (!profileCols.has('fb_templates_json')) db.exec('ALTER TABLE profiles ADD COLUMN fb_templates_json TEXT');
  if (!profileCols.has('fb_available')) db.exec('ALTER TABLE profiles ADD COLUMN fb_available INTEGER NOT NULL DEFAULT 0');
  // (2.14.0) Ghép profile với GemLogin qua launcher.
  if (!profileCols.has('launcher_id')) {
    db.exec('ALTER TABLE profiles ADD COLUMN launcher_id TEXT');
    db.exec('ALTER TABLE profiles ADD COLUMN gem_id TEXT');
    db.exec('ALTER TABLE profiles ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 1');
    db.exec('ALTER TABLE profiles ADD COLUMN launch_fail_at INTEGER');
  }
  // (2.15.0) Lệch giờ ngẫu nhiên: base_at = giờ hẹn gốc, run_at = base_at + phần lệch.
  const taskCols = new Set(q('PRAGMA table_info(tasks)').all().map(c => c.name));
  if (!taskCols.has('base_at')) {
    db.exec('ALTER TABLE tasks ADD COLUMN base_at INTEGER');
    db.exec('ALTER TABLE tasks ADD COLUMN jitter_ms INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS launchers (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL,
    gem_profiles_json TEXT, running_json TEXT, gem_ok INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    discover_json TEXT, last_seen_at INTEGER, created_at INTEGER NOT NULL
  )`);

  // Tài khoản đầu tiên: "admin", mật khẩu lấy từ môi trường (đổi biến môi
  // trường rồi khởi động lại là đổi mật khẩu).
  const admin = q('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    q('INSERT INTO users (id, username, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(rid('u_', 8), 'admin', hashPassword(adminPassword), 'owner', now());
  } else if (!checkPassword(adminPassword, admin.pass_hash)) {
    q('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(adminPassword), admin.id);
    q('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
  }

  /* ---------- Phiên đăng nhập ---------- */
  const loginFails = new Map(); // ip -> {count, resetAt}
  function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  }
  function login(req, body) {
    const ip = clientIp(req);
    const entry = loginFails.get(ip);
    if (entry && entry.resetAt > now() && entry.count >= 8) throw new HttpError(429, 'Sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.');
    const user = q('SELECT * FROM users WHERE username = ?').get(String(body.username || 'admin'));
    if (!user || !checkPassword(body.password || '', user.pass_hash)) {
      const fresh = entry && entry.resetAt > now() ? entry : { count: 0, resetAt: now() + 15 * 60 * 1000 };
      fresh.count++;
      loginFails.set(ip, fresh);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu.');
    }
    loginFails.delete(ip);
    const sid = rid('', 32);
    q('DELETE FROM sessions WHERE expires_at < ?').run(now());
    q('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(sid), user.id, now() + SESSION_TTL_MS);
    return { sid, user };
  }
  function sessionCookie(value, maxAgeSec) {
    return `hub_session=${value}; HttpOnly; SameSite=Strict; Path=${basePath || '/'}; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`;
  }
  function currentUser(req) {
    const match = /(?:^|;\s*)hub_session=([a-f0-9]{64})/.exec(String(req.headers.cookie || ''));
    if (!match) return null;
    const row = q('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?')
      .get(sha256(match[1]), now());
    return row ? { ...row, sid: match[1] } : null;
  }

  /* ---------- Task ---------- */
  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'payload phải là object');
    const platform = String(payload.platform || '').toLowerCase();
    const type = String(payload.type || 'post').toLowerCase();
    if (!types[platform]) throw new HttpError(400, `Nền tảng không hỗ trợ: ${platform || '(trống)'}`);
    if (!types[platform].includes(type)) throw new HttpError(400, `${platform} không hỗ trợ loại việc "${type}"`);
    if (platform === 'youtube' && type === 'post' && contract.isVideoPost(payload)) {
      throw new HttpError(400, 'YouTube: video phải dùng loại việc "upload", không phải "post".');
    }
    if (platform === 'facebook') {
      if (!(contract.FB_FEATURES || []).includes(String(payload.feature || ''))) {
        throw new HttpError(400, `Tính năng Facebook không hỗ trợ: ${payload.feature || '(trống)'}`);
      }
      if (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
        throw new HttpError(400, 'Việc Facebook cần trường "config" (object). Chọn một mẫu từ profile hoặc tự điền.');
      }
    }
    const clean = { ...payload, platform, type };
    // Các trường do extension tự gắn — không cho web ghi đè.
    for (const key of ['id', 'status', 'origin', 'remote_task_id', 'run_id', 'delivery_id', 'task_id', 'tabId', 'meta']) delete clean[key];
    if (JSON.stringify(clean).length > 200 * 1000) throw new HttpError(400, 'payload quá lớn (tối đa 200KB)');
    return clean;
  }
  // baseAt = giờ hẹn gốc; giờ chạy thật lệch ngẫu nhiên 0..jitterMs sau đó (mỗi
  // việc, mỗi ngày một độ lệch riêng) để các profile không chạy đúng cùng phút.
  function insertTask(ownerId, profileId, payload, baseAt, repeat, jitterMs = 0) {
    const id = rid('t_', 10);
    const jitter = Math.max(0, Math.min(12 * 3600 * 1000, Number(jitterMs) || 0));
    const runAt = baseAt + (jitter ? crypto.randomInt(0, jitter + 1) : 0);
    q('INSERT INTO tasks (id, owner_id, profile_id, payload_json, run_at, base_at, jitter_ms, repeat, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ownerId, profileId, JSON.stringify(payload), runAt, baseAt, jitter, repeat || null, 'queued', now());
    return id;
  }

  /* ---------- API cho extension ---------- */
  function agentProfile(req, body) {
    const profileId = String(body.profile_id || '');
    const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    const profile = profileId ? q('SELECT * FROM profiles WHERE id = ?').get(profileId) : null;
    if (!profile || !token || !safeEqual(sha256(token[1]), profile.token_hash)) throw new HttpError(401, 'Profile chưa đăng ký hoặc token sai.');
    if (profile.status === 'revoked') throw new HttpError(403, 'Profile đã bị thu hồi quyền.');
    return profile;
  }
  const numOrNull = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const cleanAccounts = list => JSON.stringify((Array.isArray(list) ? list : []).slice(0, 100).map(a => ({
    platform: String((a && a.platform) || '').slice(0, 30),
    kind: a && a.kind === 'page' ? 'page' : 'nick',
    username: String((a && a.username) || '').slice(0, 80),
    name: String((a && a.name) || '').slice(0, 80),
    followers: numOrNull(a && a.followers),
    scanned_at: numOrNull(a && a.scanned_at)
  })));

  const agent = {
    register(req, body) {
      const profileId = String(body.profile_id || '');
      if (!/^pf_[a-f0-9]{16,64}$/.test(profileId)) throw new HttpError(400, 'profile_id không hợp lệ');
      if (q('SELECT 1 AS x FROM profiles WHERE id = ?').get(profileId)) {
        throw new HttpError(409, 'ID này đã được đăng ký.');
      }
      const pending = q("SELECT COUNT(*) AS n FROM profiles WHERE status = 'pending'").get().n;
      if (pending >= 200) throw new HttpError(429, 'Quá nhiều profile đang chờ duyệt.');
      const token = rid('', 32);
      q('INSERT INTO profiles (id, token_hash, version, accounts_json, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(profileId, sha256(token), String(body.version || '').slice(0, 20), cleanAccounts(body.accounts), now(), now());
      return { status: 'pending', token };
    },

    sync(req, body) {
      const profile = agentProfile(req, body);
      // Phát hiện hai nơi cùng dùng một ID (thư mục profile bị sao chép): mỗi
      // lượt sync hub phát một nonce mới, lượt sau phải gửi lại đúng nonce đó.
      const conflict = profile.nonce && body.nonce && body.nonce !== profile.nonce ? now() : profile.conflict_at;
      const nonce = rid('', 8);
      if (Array.isArray(body.fb_templates)) {
        const templates = body.fb_templates.slice(0, 20).filter(t => t && (contract.FB_FEATURES || []).includes(t.feature)
          && t.config && typeof t.config === 'object').map(t => ({ feature: t.feature, label: String(t.label || t.feature).slice(0, 120), config: t.config }));
        const json = JSON.stringify(templates);
        if (json.length <= 200 * 1000) q('UPDATE profiles SET fb_templates_json = ? WHERE id = ?').run(json, profile.id);
      }
      q('UPDATE profiles SET fb_available = ? WHERE id = ?').run(body.fb_available ? 1 : 0, profile.id);
      q('UPDATE profiles SET nonce = ?, conflict_at = ?, version = ?, accounts_json = ?, busy = ?, accept = ?, last_seen_at = ? WHERE id = ?')
        .run(nonce, conflict || null,
          body.version ? String(body.version).slice(0, 20) : profile.version,
          Array.isArray(body.accounts) ? cleanAccounts(body.accounts) : profile.accounts_json,
          body.busy ? 1 : 0, body.accept === false ? 0 : 1, now(), profile.id);
      const tasks = [];
      if (profile.status === 'approved' && body.accept !== false) {
        const capacity = Math.max(0, Math.min(5, Number(body.capacity) || 0));
        if (capacity > 0) {
          const due = q("SELECT * FROM tasks WHERE profile_id = ? AND status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT ?")
            .all(profile.id, now(), capacity);
          for (const task of due) {
            q("UPDATE tasks SET status = 'claimed', claimed_at = ? WHERE id = ?").run(now(), task.id);
            if (task.repeat === 'daily') {
              let next = (task.base_at || task.run_at) + 24 * 3600 * 1000;
              while (next <= now()) next += 24 * 3600 * 1000; // profile tắt nhiều ngày: không dồn việc bù
              insertTask(task.owner_id, task.profile_id, parseJson(task.payload_json, {}), next, 'daily', task.jitter_ms);
            }
            tasks.push({ id: task.id, payload: parseJson(task.payload_json, {}) });
          }
        }
      }
      return { status: profile.status, name: profile.name, nonce, tasks };
    },

    results(req, body) {
      const profile = agentProfile(req, body);
      if (profile.status !== 'approved') throw new HttpError(403, 'Profile chưa được duyệt.');
      const accepted = [];
      for (const r of (Array.isArray(body.results) ? body.results : []).slice(0, 50)) {
        if (!r || !r.receipt_id) continue;
        const receiptId = String(r.receipt_id).slice(0, 80);
        const status = String(r.status || '').slice(0, 20);
        const message = String(r.message || '').slice(0, 2000);
        let taskId = null;
        if (r.remote_task_id) {
          const task = q('SELECT id FROM tasks WHERE id = ? AND profile_id = ?').get(String(r.remote_task_id), profile.id);
          if (task) {
            taskId = task.id;
            if (FINAL_STATUSES.has(status)) {
              q('UPDATE tasks SET status = ?, message = ?, result_json = ?, finished_at = ? WHERE id = ?')
                .run(status, message, JSON.stringify(r).slice(0, 100 * 1000), now(), task.id);
            } else {
              q('UPDATE tasks SET message = ? WHERE id = ?').run(message, task.id);
            }
          }
        }
        q(`INSERT OR IGNORE INTO results (receipt_id, profile_id, task_id, origin, platform, type, status, message, receipt_json, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(receiptId, profile.id, taskId, r.origin === 'remote' ? 'remote' : 'local', String(r.platform || '').slice(0, 30),
            String(r.type || '').slice(0, 30), status, message, JSON.stringify(r).slice(0, 100 * 1000), now());
        accepted.push(receiptId);
      }
      return { ok: true, accepted };
    }
  };

  /* ---------- API cho launcher (máy có GemLogin) ---------- */
  function launcherSync(req, body) {
    const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    const launcher = token ? q('SELECT * FROM launchers WHERE token_hash = ?').get(sha256(token[1])) : null;
    if (!launcher) throw new HttpError(401, 'Token launcher không hợp lệ.');
    const t = now();
    const gemProfiles = Array.isArray(body.gem_profiles)
      ? body.gem_profiles.slice(0, 2000).filter(p => p && p.id).map(p => ({ id: String(p.id).slice(0, 80), name: String(p.name || '').slice(0, 120), group: String(p.group || '').slice(0, 80) }))
      : parseJson(launcher.gem_profiles_json, []);
    const running = (Array.isArray(body.running) ? body.running : []).slice(0, 200)
      .filter(r => r && r.gem_id).map(r => ({ gem_id: String(r.gem_id), started_at: Number(r.started_at) || t }));
    const runningAt = new Map(running.map(r => [r.gem_id, r.started_at]));
    const gemName = new Map(gemProfiles.map(p => [p.id, p.name]));
    const idleCloseMs = Math.max(60 * 1000, Math.min(60 * 60 * 1000, Number(body.idle_close_ms) || 3 * 60 * 1000));
    const online = p => Boolean(p.last_seen_at && t - p.last_seen_at < ONLINE_WINDOW_MS);
    const start = [];
    const stop = [];

    const mapped = q('SELECT * FROM profiles WHERE launcher_id = ? AND gem_id IS NOT NULL').all(launcher.id);
    for (const p of mapped) {
      const canWork = p.status === 'approved' && Boolean(p.accept);
      const dueRow = canWork ? q("SELECT COUNT(*) AS n, MIN(run_at) AS first FROM tasks WHERE profile_id = ? AND status = 'queued' AND run_at <= ?").get(p.id, t) : { n: 0, first: null };
      const startedAt = runningAt.get(p.gem_id);
      const name = gemName.get(p.gem_id) || p.name || p.gem_id;
      if (startedAt === undefined) {
        const backingOff = p.launch_fail_at && t - p.launch_fail_at < LAUNCH_BACKOFF_MS;
        if (p.auto_start && dueRow.n > 0 && !online(p) && !backingOff && gemName.has(p.gem_id)) {
          start.push({ gem_id: p.gem_id, name, reason: `${dueRow.n} việc đến hạn`, due_at: dueRow.first });
        }
        continue;
      }
      if (!online(p)) {
        if (t - startedAt > NEVER_ONLINE_MS) {
          q('UPDATE profiles SET launch_fail_at = ? WHERE id = ?').run(t, p.id);
          stop.push({ gem_id: p.gem_id, name, reason: 'mở rồi nhưng extension không báo sống' });
        }
        continue;
      }
      if (p.launch_fail_at) q('UPDATE profiles SET launch_fail_at = NULL WHERE id = ?').run(p.id);
      const working = q("SELECT COUNT(*) AS n FROM tasks WHERE profile_id = ? AND status = 'claimed' AND claimed_at > ?").get(p.id, t - WORKING_WINDOW_MS).n;
      if (p.busy || dueRow.n > 0 || working > 0) continue;
      const lastTask = q('SELECT MAX(MAX(COALESCE(claimed_at, 0)), MAX(COALESCE(finished_at, 0))) AS at FROM tasks WHERE profile_id = ?').get(p.id).at || 0;
      const lastResult = q('SELECT MAX(received_at) AS at FROM results WHERE profile_id = ?').get(p.id).at || 0;
      if (t - Math.max(startedAt, lastTask, lastResult) > idleCloseMs) stop.push({ gem_id: p.gem_id, name, reason: 'hết việc' });
    }
    start.sort((a, b) => (a.due_at || 0) - (b.due_at || 0));

    // Dò ghép: mở lần lượt từng profile GemLogin chưa ghép, xem profile Auto vjp
    // nào (đang tắt lúc bắt đầu) báo sống thì ghép hai bên với nhau.
    let discover = parseJson(launcher.discover_json, null);
    if (discover && discover.active) {
      start.length = 0; // trong lúc dò chỉ mở từng cái một để không nhầm
      const mappedGem = new Set(mapped.map(p => p.gem_id));
      const cur = discover.current;
      if (cur) {
        const elapsed = t - cur.started_at;
        const baseline = new Set(cur.baseline || []);
        const candidates = q('SELECT * FROM profiles WHERE launcher_id IS NULL AND (owner_id = ? OR owner_id IS NULL) AND last_seen_at >= ?')
          .all(launcher.owner_id, cur.started_at).filter(p => !baseline.has(p.id) && p.status !== 'revoked');
        let finished = null;
        if (candidates.length === 1 && elapsed >= DISCOVER_MIN_MS) {
          const p = candidates[0];
          q('UPDATE profiles SET launcher_id = ?, gem_id = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?')
            .run(launcher.id, cur.gem_id, gemName.get(cur.gem_id) || '', p.id);
          finished = { gem_id: cur.gem_id, ok: true, note: 'đã ghép' };
        } else if (elapsed >= DISCOVER_MAX_MS) {
          finished = { gem_id: cur.gem_id, ok: false, note: candidates.length > 1 ? 'nhiều profile cùng báo sống, không chắc cái nào' : 'không thấy extension báo danh (đã cài Auto vjp và nhập địa chỉ hub chưa?)' };
        }
        if (finished) {
          discover.done.push(finished);
          discover.current = null;
          if (runningAt.has(cur.gem_id) && !stop.some(s => s.gem_id === cur.gem_id)) stop.push({ gem_id: cur.gem_id, name: gemName.get(cur.gem_id), reason: 'dò ghép xong' });
        }
      }
      if (!discover.current) {
        const doneIds = new Set(discover.done.map(d => d.gem_id));
        const stopping = new Set(stop.map(s => s.gem_id));
        const others = running.filter(r => !stopping.has(r.gem_id)).length;
        const next = gemProfiles.find(g => !mappedGem.has(g.id) && !doneIds.has(g.id) && !runningAt.has(g.id));
        if (!next) discover.active = false;
        else if (others === 0) {
          discover.current = {
            gem_id: next.id, started_at: t,
            baseline: q('SELECT id FROM profiles WHERE last_seen_at >= ?').all(t - ONLINE_WINDOW_MS).map(r => r.id)
          };
          start.push({ gem_id: next.id, name: next.name, reason: 'dò ghép' });
        }
      }
    }

    q('UPDATE launchers SET gem_profiles_json = ?, running_json = ?, gem_ok = ?, last_error = ?, discover_json = ?, last_seen_at = ? WHERE id = ?')
      .run(JSON.stringify(gemProfiles), JSON.stringify(running), body.gem_ok === false ? 0 : 1, String(body.error || '').slice(0, 500),
        discover ? JSON.stringify(discover) : null, t, launcher.id);
    return { start: start.map(({ due_at, ...rest }) => rest), stop };
  }
  function ownedLauncher(user, id) {
    const launcher = q('SELECT * FROM launchers WHERE id = ? AND owner_id = ?').get(String(id || ''), user.id);
    if (!launcher) throw new HttpError(404, 'Không tìm thấy máy chạy.');
    return launcher;
  }

  /* ---------- API cho trang quản lý ---------- */
  function ownedProfile(user, id) {
    const profile = q('SELECT * FROM profiles WHERE id = ?').get(String(id || ''));
    if (!profile || (profile.owner_id && profile.owner_id !== user.id)) throw new HttpError(404, 'Không tìm thấy profile.');
    return profile;
  }
  function ownedTask(user, id) {
    const task = q('SELECT * FROM tasks WHERE id = ? AND owner_id = ?').get(String(id || ''), user.id);
    if (!task) throw new HttpError(404, 'Không tìm thấy việc.');
    return task;
  }

  const adminApi = {
    state(user) {
      const profiles = q('SELECT * FROM profiles WHERE owner_id = ? OR owner_id IS NULL ORDER BY created_at').all(user.id).map(p => ({
        id: p.id, name: p.name, status: p.status, version: p.version,
        accounts: parseJson(p.accounts_json, []), busy: Boolean(p.busy), accept: Boolean(p.accept),
        online: Boolean(p.last_seen_at && now() - p.last_seen_at < ONLINE_WINDOW_MS),
        last_seen_at: p.last_seen_at, created_at: p.created_at, conflict_at: p.conflict_at,
        fb_available: Boolean(p.fb_available), fb_templates: parseJson(p.fb_templates_json, []),
        launcher_id: p.launcher_id, gem_id: p.gem_id, auto_start: Boolean(p.auto_start), launch_fail_at: p.launch_fail_at
      }));
      const launchers = q('SELECT * FROM launchers WHERE owner_id = ? ORDER BY created_at').all(user.id).map(l => ({
        id: l.id, name: l.name, gem_ok: Boolean(l.gem_ok), last_error: l.last_error || '',
        online: Boolean(l.last_seen_at && now() - l.last_seen_at < ONLINE_WINDOW_MS), last_seen_at: l.last_seen_at,
        gem_profiles: parseJson(l.gem_profiles_json, []), running: parseJson(l.running_json, []),
        discover: parseJson(l.discover_json, null)
      }));
      const tasks = q('SELECT * FROM tasks WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200').all(user.id).map(t => ({
        id: t.id, profile_id: t.profile_id, payload: parseJson(t.payload_json, {}), run_at: t.run_at, repeat: t.repeat,
        status: t.status, message: t.message, created_at: t.created_at, claimed_at: t.claimed_at, finished_at: t.finished_at
      }));
      const ids = profiles.filter(p => p.status !== 'pending').map(p => p.id);
      const results = ids.length
        ? q(`SELECT receipt_id, profile_id, task_id, origin, platform, type, status, message, received_at FROM results
             WHERE profile_id IN (${ids.map(() => '?').join(',')}) ORDER BY received_at DESC LIMIT 100`).all(...ids)
        : [];
      // Kết quả gần nhất theo (profile, nền tảng) — cho bảng Nick.
      const lastResults = ids.length
        ? q(`SELECT profile_id, platform, type, status, MAX(received_at) AS received_at FROM results
             WHERE profile_id IN (${ids.map(() => '?').join(',')}) AND type != 'scan_account' GROUP BY profile_id, platform`).all(...ids)
        : [];
      return { user: { username: user.username, role: user.role }, now: now(), types, last_results: lastResults, fb_features: contract.FB_FEATURES || [], profiles, launchers, tasks, results };
    },
    approve(user, body) {
      const profile = ownedProfile(user, body.id);
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) throw new HttpError(400, 'Hãy đặt tên cho profile.');
      // Gắn lại vào profile cũ (vd extension bị gỡ rồi cài lại): chuyển việc
      // đang chờ + lịch sử sang ID mới rồi xoá bản cũ.
      if (body.replace_id) {
        const old = ownedProfile(user, body.replace_id);
        if (old.id !== profile.id) {
          q("UPDATE tasks SET profile_id = ? WHERE profile_id = ?").run(profile.id, old.id);
          q('UPDATE OR IGNORE results SET profile_id = ? WHERE profile_id = ?').run(profile.id, old.id);
          q('DELETE FROM results WHERE profile_id = ?').run(old.id);
          q('DELETE FROM profiles WHERE id = ?').run(old.id);
        }
      }
      q("UPDATE profiles SET status = 'approved', owner_id = ?, name = ?, conflict_at = NULL WHERE id = ?").run(user.id, name, profile.id);
      return { ok: true };
    },
    rename(user, body) {
      const profile = ownedProfile(user, body.id);
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) throw new HttpError(400, 'Tên không được trống.');
      q('UPDATE profiles SET name = ?, conflict_at = NULL WHERE id = ?').run(name, profile.id);
      return { ok: true };
    },
    revoke(user, body) {
      const profile = ownedProfile(user, body.id);
      q("UPDATE profiles SET status = 'revoked' WHERE id = ?").run(profile.id);
      q("UPDATE tasks SET status = 'cancelled', finished_at = ? WHERE profile_id = ? AND status = 'queued'").run(now(), profile.id);
      return { ok: true };
    },
    // ---- Máy chạy (launcher + GemLogin) ----
    createLauncher(user, body) {
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) throw new HttpError(400, 'Hãy đặt tên cho máy chạy.');
      const id = rid('l_', 8);
      const token = rid('', 32);
      q('INSERT INTO launchers (id, owner_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.id, name, sha256(token), now());
      return { ok: true, id, token }; // token chỉ trả đúng một lần
    },
    removeLauncher(user, body) {
      const launcher = ownedLauncher(user, body.id);
      q('UPDATE profiles SET launcher_id = NULL, gem_id = NULL WHERE launcher_id = ?').run(launcher.id);
      q('DELETE FROM launchers WHERE id = ?').run(launcher.id);
      return { ok: true };
    },
    discover(user, body) {
      const launcher = ownedLauncher(user, body.id);
      q('UPDATE launchers SET discover_json = ? WHERE id = ?')
        .run(body.active === false ? null : JSON.stringify({ active: true, current: null, done: [] }), launcher.id);
      return { ok: true };
    },
    // Ghép / bỏ ghép profile Auto vjp với một profile GemLogin, bật tắt tự mở.
    mapProfile(user, body) {
      const profile = ownedProfile(user, body.id);
      if (body.launcher_id && body.gem_id) {
        const launcher = ownedLauncher(user, body.launcher_id);
        const gemId = String(body.gem_id);
        if (!parseJson(launcher.gem_profiles_json, []).some(g => g.id === gemId)) throw new HttpError(400, 'Máy chạy này không có profile GemLogin đó.');
        const taken = q('SELECT id FROM profiles WHERE launcher_id = ? AND gem_id = ? AND id != ?').get(launcher.id, gemId, profile.id);
        if (taken) throw new HttpError(400, 'Profile GemLogin này đã ghép với profile khác.');
        q('UPDATE profiles SET launcher_id = ?, gem_id = ?, launch_fail_at = NULL WHERE id = ?').run(launcher.id, gemId, profile.id);
      } else if (body.launcher_id === null || body.gem_id === null) {
        q('UPDATE profiles SET launcher_id = NULL, gem_id = NULL, launch_fail_at = NULL WHERE id = ?').run(profile.id);
      }
      if (typeof body.auto_start === 'boolean') q('UPDATE profiles SET auto_start = ?, launch_fail_at = NULL WHERE id = ?').run(body.auto_start ? 1 : 0, profile.id);
      return { ok: true };
    },
    remove(user, body) {
      const profile = ownedProfile(user, body.id);
      q('DELETE FROM tasks WHERE profile_id = ?').run(profile.id);
      q('DELETE FROM results WHERE profile_id = ?').run(profile.id);
      q('DELETE FROM profiles WHERE id = ?').run(profile.id);
      return { ok: true };
    },
    // Giao việc "Quét tài khoản" cho mọi nền tảng của một profile.
    scanProfile(user, body) {
      const profile = ownedProfile(user, body.id);
      if (profile.status !== 'approved') throw new HttpError(400, 'Profile chưa được duyệt.');
      const created = Object.keys(types).filter(p => types[p].includes('scan_account'))
        .map(platform => insertTask(user.id, profile.id, { platform, type: 'scan_account' }, now(), null));
      return { ok: true, ids: created };
    },
    // Giao một việc cho một hoặc nhiều profile (profile_ids). Kiểm tra hết rồi
    // mới ghi: sai một profile thì không tạo việc nào.
    createTask(user, body) {
      const ids = Array.isArray(body.profile_ids) ? [...new Set(body.profile_ids.map(String))] : [String(body.profile_id || '')];
      if (!ids.length) throw new HttpError(400, 'Chưa chọn profile nào.');
      if (ids.length > 500) throw new HttpError(400, 'Tối đa 500 profile mỗi lần giao.');
      const profiles = ids.map(id => ownedProfile(user, id));
      const notReady = profiles.find(p => p.status !== 'approved');
      if (notReady) throw new HttpError(400, `Profile "${notReady.name || notReady.id}" chưa được duyệt.`);
      const payload = validatePayload(body.payload);
      const runAt = Number(body.run_at) > 0 ? Number(body.run_at) : now();
      const repeat = body.repeat === 'daily' ? 'daily' : null;
      const jitterMs = Math.max(0, Number(body.jitter_minutes) || 0) * 60 * 1000;
      const created = profiles.map(p => insertTask(user.id, p.id, payload, runAt, repeat, jitterMs));
      return { ok: true, id: created[0], ids: created };
    },
    cancelTask(user, body) {
      const task = ownedTask(user, body.id);
      if (task.status !== 'queued') throw new HttpError(400, 'Chỉ huỷ được việc chưa giao. Việc đã giao phải dừng trên máy của profile.');
      q("UPDATE tasks SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), task.id);
      return { ok: true };
    },
    // Giao lại = tạo việc MỚI từ nội dung cũ (extension chống trùng theo mã
    // việc, nên không tái dùng mã cũ).
    requeueTask(user, body) {
      const task = ownedTask(user, body.id);
      if (task.status === 'queued') throw new HttpError(400, 'Việc này vẫn đang chờ giao.');
      return { ok: true, id: insertTask(user.id, task.profile_id, parseJson(task.payload_json, {}), now(), null) };
    }
  };

  /* ---------- HTTP ---------- */
  const publicDir = path.join(__dirname, 'public');
  const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' };
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Dữ liệu gửi lên quá lớn.')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve({});
        const data = parseJson(text, null);
        if (!data || typeof data !== 'object') return reject(new HttpError(400, 'Dữ liệu gửi lên không phải JSON hợp lệ.'));
        resolve(data);
      });
      req.on('error', reject);
    });
  }
  function sendJson(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
  }

  async function handle(req, res) {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://hub.local').pathname;
      if (basePath) {
        if (pathname === basePath) { res.writeHead(302, { Location: basePath + '/' }); return res.end(); }
        if (!pathname.startsWith(basePath + '/')) throw new HttpError(404, 'Không tìm thấy.');
        pathname = pathname.slice(basePath.length);
      }

      if (pathname.startsWith('/api/agent/')) {
        const cors = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '600'
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
        const fn = agent[pathname.slice('/api/agent/'.length)];
        if (req.method !== 'POST' || !fn) return sendJson(res, 404, { error: 'Không tìm thấy.' }, cors);
        try {
          return sendJson(res, 200, fn(req, await readBody(req)), cors);
        } catch (err) {
          if (!(err instanceof HttpError)) console.error('[hub] agent error', err);
          return sendJson(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Lỗi máy chủ.' }, cors);
        }
      }

      if (pathname === '/api/launcher/sync') {
        if (req.method !== 'POST') throw new HttpError(405, 'Chỉ nhận POST.');
        return sendJson(res, 200, launcherSync(req, await readBody(req)));
      }

      if (pathname.startsWith('/api/admin/')) {
        const name = pathname.slice('/api/admin/'.length);
        if (req.method !== 'POST') throw new HttpError(405, 'Chỉ nhận POST.');
        // Chống CSRF: cookie SameSite=Strict + bắt buộc JSON + Origin (nếu có) phải trùng Host.
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Cần Content-Type: application/json.');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origin không hợp lệ.');
        const body = await readBody(req);
        if (name === 'login') {
          const { sid, user } = login(req, body);
          return sendJson(res, 200, { ok: true, username: user.username }, { 'Set-Cookie': sessionCookie(sid, SESSION_TTL_MS / 1000) });
        }
        const user = currentUser(req);
        if (!user) throw new HttpError(401, 'Chưa đăng nhập.');
        if (name === 'logout') {
          q('DELETE FROM sessions WHERE id_hash = ?').run(sha256(user.sid));
          return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
        }
        if (!Object.prototype.hasOwnProperty.call(adminApi, name)) throw new HttpError(404, 'Không tìm thấy.');
        return sendJson(res, 200, adminApi[name](user, body));
      }

      if (req.method === 'GET' && STATIC[pathname]) {
        const file = path.join(publicDir, STATIC[pathname]);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)],
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        });
        return res.end(fs.readFileSync(file));
      }
      if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true });
      throw new HttpError(404, 'Không tìm thấy.');
    } catch (err) {
      if (!(err instanceof HttpError)) console.error('[hub] error', pathname, err);
      if (res.headersSent) return res.end();
      return sendJson(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Lỗi máy chủ.' });
    }
  }

  return { handle, close: () => db.close(), db };
}

module.exports = { createHub };

if (require.main === module) {
  let hub;
  try {
    hub = createHub();
  } catch (err) {
    console.error('[hub] ' + err.message);
    process.exit(1);
  }
  const port = Number(process.env.HUB_PORT) || 8787;
  const server = http.createServer(hub.handle);
  server.listen(port, () => console.log(`[hub] Auto vjp Hub đang chạy ở cổng ${port}${process.env.HUB_BASE_PATH || ''}`));
  const stop = () => server.close(() => { hub.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
