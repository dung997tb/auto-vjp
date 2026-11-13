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
  function insertTask(ownerId, profileId, payload, runAt, repeat) {
    const id = rid('t_', 10);
    q('INSERT INTO tasks (id, owner_id, profile_id, payload_json, run_at, repeat, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ownerId, profileId, JSON.stringify(payload), runAt, repeat || null, 'queued', now());
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
  const cleanAccounts = list => JSON.stringify((Array.isArray(list) ? list : []).slice(0, 60).map(a => ({
    platform: String((a && a.platform) || '').slice(0, 30),
    username: String((a && a.username) || '').slice(0, 80),
    name: String((a && a.name) || '').slice(0, 80)
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
              let next = task.run_at + 24 * 3600 * 1000;
              while (next <= now()) next += 24 * 3600 * 1000; // profile tắt nhiều ngày: không dồn việc bù
              insertTask(task.owner_id, task.profile_id, parseJson(task.payload_json, {}), next, 'daily');
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
        fb_available: Boolean(p.fb_available), fb_templates: parseJson(p.fb_templates_json, [])
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
      return { user: { username: user.username, role: user.role }, now: now(), types, fb_features: contract.FB_FEATURES || [], profiles, tasks, results };
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
    remove(user, body) {
      const profile = ownedProfile(user, body.id);
      q('DELETE FROM tasks WHERE profile_id = ?').run(profile.id);
      q('DELETE FROM results WHERE profile_id = ?').run(profile.id);
      q('DELETE FROM profiles WHERE id = ?').run(profile.id);
      return { ok: true };
    },
    createTask(user, body) {
      const profile = ownedProfile(user, body.profile_id);
      if (profile.status !== 'approved') throw new HttpError(400, 'Profile chưa được duyệt.');
      const payload = validatePayload(body.payload);
      const runAt = Number(body.run_at) > 0 ? Number(body.run_at) : now();
      const repeat = body.repeat === 'daily' ? 'daily' : null;
      return { ok: true, id: insertTask(user.id, profile.id, payload, runAt, repeat) };
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
