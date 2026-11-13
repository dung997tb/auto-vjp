#!/usr/bin/env node
/* Auto vjp Launcher (2.14.0) — chạy trên MÁY CÓ GEMLOGIN.
 *
 * Việc của nó: hỏi hub "profile nào có việc đến hạn mà đang tắt", nhờ GemLogin
 * mở profile đó; extension Auto vjp bên trong tự nhận việc và làm; khi profile
 * rảnh thì đóng lại. Launcher chỉ đóng những profile do CHÍNH NÓ mở.
 *
 * Cấu hình bằng biến môi trường (hoặc file launcher.config.json cạnh file này):
 *   HUB_URL              địa chỉ hub, vd https://nuc.ten-mang.ts.net
 *   LAUNCHER_TOKEN       token tạo ở hub, mục "Máy chạy"
 *   GEMLOGIN_URL         mặc định http://127.0.0.1:1010
 *   MAX_PARALLEL         số profile mở cùng lúc tối đa, mặc định 2
 *   IDLE_CLOSE_MINUTES   rảnh bao lâu thì đóng, mặc định 3
 *   POLL_SECONDS         nhịp hỏi hub, mặc định 30
 *   WIN_SIZE / WIN_POS / WIN_SCALE / START_ARGS   tham số mở cửa sổ (tuỳ chọn)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createGemLogin } = require('./gemlogin.js');

function loadConfig(env = process.env, dir = __dirname) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(dir, 'launcher.config.json'), 'utf8')); } catch (_) { file = {}; }
  const pick = key => env[key] ?? file[key];
  const num = (key, fallback, min) => Math.max(min, Number(pick(key)) || fallback);
  return {
    hubUrl: String(pick('HUB_URL') || '').replace(/\/+$/, ''),
    token: String(pick('LAUNCHER_TOKEN') || ''),
    gemUrl: String(pick('GEMLOGIN_URL') || 'http://127.0.0.1:1010'),
    maxParallel: num('MAX_PARALLEL', 2, 1),
    idleCloseMs: num('IDLE_CLOSE_MINUTES', 3, 1) * 60 * 1000,
    pollMs: num('POLL_SECONDS', 30, 5) * 1000,
    start: { winSize: pick('WIN_SIZE'), winPos: pick('WIN_POS'), winScale: pick('WIN_SCALE'), args: pick('START_ARGS') },
    stateFile: pick('STATE_FILE') || path.join(dir, 'launcher-state.json')
  };
}

function createLauncher(config, deps = {}) {
  const gem = deps.gem || createGemLogin({ baseUrl: config.gemUrl });
  const doFetch = deps.fetch || globalThis.fetch;
  const log = deps.log || ((...a) => console.log(new Date().toISOString(), ...a));
  const now = deps.now || Date.now;

  // running: {gemId: startedAt} — những profile launcher này đã mở. Lưu ra file
  // để khởi động lại vẫn nhớ mà đóng.
  let running = {};
  function loadState() {
    if (!config.stateFile) return;
    try { running = JSON.parse(fs.readFileSync(config.stateFile, 'utf8')).running || {}; } catch (_) { running = {}; }
  }
  function saveState() {
    if (!config.stateFile) return;
    try { fs.writeFileSync(config.stateFile, JSON.stringify({ running }, null, 2)); } catch (err) { log('Không ghi được file trạng thái:', err.message); }
  }
  loadState();

  async function hubSync(payload) {
    const res = await doFetch(config.hubUrl + '/api/launcher/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Hub trả HTTP ${res.status}: ${data.error || ''}`);
    return data;
  }

  let lastError = '';
  // Một nhịp: báo danh sách profile GemLogin + những cái đang mở, nhận lệnh mở/đóng.
  async function tick() {
    let gemProfiles = null;
    try {
      gemProfiles = (await gem.listProfiles()).map(p => ({ id: p.id, name: p.name, group: p.group }));
      if (lastError.startsWith('GemLogin')) lastError = '';
    } catch (err) {
      lastError = 'GemLogin: ' + err.message;
      log(lastError);
    }
    const plan = await hubSync({
      gem_profiles: gemProfiles,                 // null = không đọc được, hub giữ danh sách cũ
      gem_ok: gemProfiles !== null,
      running: Object.entries(running).map(([gem_id, started_at]) => ({ gem_id, started_at })),
      idle_close_ms: config.idleCloseMs,
      error: lastError
    });

    for (const item of plan.stop || []) {
      if (!(item.gem_id in running)) continue; // không đóng thứ mình không mở
      try {
        await gem.closeProfile(item.gem_id);
        log(`Đã đóng ${item.name || item.gem_id} (${item.reason || 'theo lệnh hub'})`);
      } catch (err) {
        // Đóng lỗi thường là profile đã bị đóng tay — vẫn bỏ khỏi danh sách.
        log(`Đóng ${item.name || item.gem_id} lỗi: ${err.message}`);
      }
      delete running[item.gem_id];
      saveState();
    }

    for (const item of plan.start || []) {
      if (item.gem_id in running) continue;
      if (Object.keys(running).length >= config.maxParallel) break;
      try {
        await gem.startProfile(item.gem_id, config.start);
        running[item.gem_id] = now();
        saveState();
        log(`Đã mở ${item.name || item.gem_id} (${item.reason || 'có việc đến hạn'})`);
        lastError = '';
      } catch (err) {
        lastError = `Mở ${item.name || item.gem_id} lỗi: ${err.message}`;
        log(lastError);
      }
    }
    return plan;
  }

  let timer = null;
  let stopped = false;
  async function loop() {
    if (stopped) return;
    try { await tick(); } catch (err) { log('Lỗi nhịp:', err.message); }
    if (!stopped) timer = setTimeout(loop, config.pollMs);
  }

  return {
    tick,
    start() { stopped = false; loop(); },
    stop() { stopped = true; clearTimeout(timer); },
    get running() { return { ...running }; }
  };
}

module.exports = { createLauncher, loadConfig };

if (require.main === module) {
  const config = loadConfig();
  if (!config.hubUrl || !config.token) {
    console.error('Thiếu HUB_URL hoặc LAUNCHER_TOKEN. Tạo token ở hub, mục "Máy chạy", rồi đặt hai biến này (hoặc ghi vào launcher.config.json).');
    process.exit(1);
  }
  const launcher = createLauncher(config);
  console.log(`Auto vjp Launcher: hub ${config.hubUrl} · GemLogin ${config.gemUrl} · tối đa ${config.maxParallel} profile cùng lúc`);
  launcher.start();
  const stop = () => { launcher.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
