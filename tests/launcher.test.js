// Test đầu nối GemLogin + launcher: GemLogin giả (HTTP thật, đúng đường dẫn
// theo tài liệu) <-> launcher thật <-> hub thật (SQLite trong RAM).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createGemLogin } = require('../launcher/gemlogin.js');
const { createLauncher } = require('../launcher/launcher.js');
const { createHub } = require('../hub/server.js');

const PASSWORD = 'mat-khau-thu-nghiem';
const MIN = 60 * 1000;
const gemState = { profiles: [], open: new Set(), calls: [], down: false };
let gemServer, gemUrl, hub, hubServer, hubUrl, cookie = '';

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve([server, `http://127.0.0.1:${server.address().port}`]));
  });
}
// GemLogin giả: đường dẫn + tham số như tài liệu, có phân trang.
function gemHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  gemState.calls.push(req.method + ' ' + url.pathname + url.search);
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (gemState.down) return send(500, { success: false, message: 'down' });
  let m;
  if (url.pathname === '/api/profiles') {
    const page = Number(url.searchParams.get('page') || 1), per = Number(url.searchParams.get('per_page') || 50);
    return send(200, { success: true, message: 'OK', data: gemState.profiles.slice((page - 1) * per, page * per) });
  }
  if ((m = /^\/api\/profiles\/start\/(.+)$/.exec(url.pathname))) {
    if (!gemState.profiles.some(p => String(p.id) === m[1])) return send(200, { success: false, message: 'Profile không tồn tại' });
    gemState.open.add(m[1]);
    return send(200, { success: true, message: 'OK', data: { profile_id: m[1], remote_debugging_address: '127.0.0.1:52345', browser_location: 'C:\\gem\\chrome.exe', driver_path: 'C:\\gem\\chromedriver.exe' } });
  }
  if ((m = /^\/api\/profiles\/close\/(.+)$/.exec(url.pathname))) { gemState.open.delete(m[1]); return send(200, { success: true, message: 'OK' }); }
  return send(404, { success: false, message: 'not found' });
}
async function admin(name, body) {
  const res = await fetch(`${hubUrl}/api/admin/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body || {}) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}
const agent = (name, body, token) => fetch(`${hubUrl}/api/agent/${name}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
}).then(r => r.json());
const sql = (text, ...args) => hub.db.prepare(text).run(...args);
const profileRow = id => hub.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);

test.before(async () => {
  [gemServer, gemUrl] = await listen(gemHandler);
  hub = createHub({ adminPassword: PASSWORD, dbPath: ':memory:' });
  [hubServer, hubUrl] = await listen(hub.handle);
  await admin('login', { username: 'admin', password: PASSWORD });
});
test.after(async () => {
  await new Promise(r => gemServer.close(r));
  await new Promise(r => hubServer.close(r));
  hub.close();
});

test('đầu nối GemLogin: lật trang danh sách, mở với tham số cửa sổ, đóng, báo lỗi dễ hiểu', async () => {
  gemState.profiles = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: 'Nick ' + (i + 1), group_name: 'Nuôi' }));
  const gem = createGemLogin({ baseUrl: gemUrl + '/' });
  const list = await gem.listProfiles({ perPage: 2 });
  assert.deepEqual(list.map(p => [p.id, p.name, p.group]), [1, 2, 3, 4, 5].map(i => [String(i), 'Nick ' + i, 'Nuôi']));
  gemState.calls.length = 0;
  const started = await gem.startProfile('3', { winSize: '1280,800', winPos: '0,0', winScale: '0.8', args: '--lang=vi' });
  assert.equal(started.debugAddress, '127.0.0.1:52345');
  assert.match(started.browserPath, /chrome\.exe$/);
  assert.equal(gemState.calls[0], 'GET /api/profiles/start/3?addination_args=--lang%3Dvi&win_pos=0%2C0&win_size=1280%2C800&win_scale=0.8');
  assert.ok(gemState.open.has('3'));
  await gem.closeProfile('3');
  assert.ok(!gemState.open.has('3'));
  await assert.rejects(gem.startProfile('99'), /từ chối.*Profile không tồn tại/);
  await assert.rejects(createGemLogin({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2000 }).listProfiles(), /GemLogin đã mở chưa/);
});

let launcher, launcherId, launcherToken, pfA, tokenA;
test('hub: tạo máy chạy, launcher báo danh sách profile GemLogin; token sai bị từ chối', async () => {
  gemState.profiles = [{ id: 'g1', name: 'Nick bán hàng' }, { id: 'g2', name: 'Nick phụ' }];
  const created = await admin('createLauncher', { name: 'Máy Windows' });
  assert.equal(created.status, 200);
  launcherId = created.data.id;
  launcherToken = created.data.token;
  const config = { hubUrl, token: created.data.token, gemUrl, maxParallel: 1, idleCloseMs: 3 * MIN, pollMs: 1000, start: {}, stateFile: null };
  launcher = createLauncher(config, { log() {}, now: () => Date.now() - 5 * MIN }); // coi như mọi lần mở đều từ 5 phút trước
  const plan = await launcher.tick();
  assert.deepEqual(plan, { start: [], stop: [] });
  const l = (await admin('state')).data.launchers[0];
  assert.equal(l.online, true);
  assert.equal(l.gem_ok, true);
  assert.deepEqual(l.gem_profiles.map(g => g.id), ['g1', 'g2']);
  await assert.rejects(createLauncher({ ...config, token: 'sai' }, { log() {} }).tick(), /401/);
});

test('ghép tay profile với GemLogin; có việc đến hạn + profile đang tắt → launcher mở', async () => {
  pfA = 'pf_' + 'a1'.repeat(12);
  tokenA = (await agent('register', { profile_id: pfA, version: '2.14.0' })).token;
  await admin('approve', { id: pfA, name: 'Máy 2' });
  assert.equal((await admin('mapProfile', { id: pfA, launcher_id: launcherId, gem_id: 'khong-co' })).status, 400);
  assert.equal((await admin('mapProfile', { id: pfA, launcher_id: launcherId, gem_id: 'g1' })).status, 200);
  sql('UPDATE profiles SET last_seen_at = ? WHERE id = ?', Date.now() - 10 * MIN, pfA); // đang tắt

  assert.deepEqual((await launcher.tick()).start, [], 'không có việc thì không mở');
  await admin('createTask', { profile_id: pfA, payload: { platform: 'threads', type: 'post', content: 'mai' }, run_at: Date.now() + 60 * MIN });
  assert.deepEqual((await launcher.tick()).start, [], 'việc chưa đến hạn thì không mở');
  await admin('createTask', { profile_id: pfA, payload: { platform: 'threads', type: 'post', content: 'giờ' } });
  const plan = await launcher.tick();
  assert.deepEqual(plan.start, [{ gem_id: 'g1', name: 'Nick bán hàng', reason: '1 việc đến hạn' }]);
  assert.ok(gemState.open.has('g1'));
  assert.deepEqual(Object.keys(launcher.running), ['g1']);
  assert.deepEqual((await launcher.tick()).start, [], 'đang mở rồi thì không mở lại');
});

test('profile đang làm việc thì giữ; hết việc và rảnh đủ lâu thì đóng', async () => {
  const sync = await agent('sync', { profile_id: pfA, capacity: 3, busy: true }, tokenA); // extension báo sống + nhận việc
  assert.equal(sync.tasks.length, 1);
  assert.deepEqual((await launcher.tick()).stop, [], 'đang bận');
  await agent('results', { profile_id: pfA, results: [{ receipt_id: 'r1', remote_task_id: sync.tasks[0].id, origin: 'remote', status: 'success', platform: 'threads', type: 'post' }] }, tokenA);
  await agent('sync', { profile_id: pfA, capacity: 3, busy: false }, tokenA);
  assert.deepEqual((await launcher.tick()).stop, [], 'vừa xong, chưa rảnh đủ 3 phút');
  const past = Date.now() - 4 * MIN; // tua: mọi hoạt động lùi về 4 phút trước
  sql('UPDATE tasks SET claimed_at = ?, finished_at = ? WHERE claimed_at IS NOT NULL', past, past);
  sql('UPDATE results SET received_at = ?', past);
  const plan = await launcher.tick();
  assert.deepEqual(plan.stop, [{ gem_id: 'g1', name: 'Nick bán hàng', reason: 'hết việc' }]);
  assert.ok(!gemState.open.has('g1'));
  assert.deepEqual(launcher.running, {});
});

test('launcher không đóng profile nó không mở; tắt "tự mở" thì không mở', async () => {
  gemState.open.add('g1'); // người dùng tự mở tay trong GemLogin
  await agent('sync', { profile_id: pfA, capacity: 0 }, tokenA);
  const plan = await launcher.tick();
  assert.deepEqual(plan.stop, []);
  assert.ok(gemState.open.has('g1'));
  gemState.open.clear();

  sql('UPDATE profiles SET last_seen_at = ? WHERE id = ?', Date.now() - 10 * MIN, pfA);
  await admin('createTask', { profile_id: pfA, payload: { platform: 'x', type: 'post', content: 'thêm' } });
  await admin('mapProfile', { id: pfA, auto_start: false });
  assert.deepEqual((await launcher.tick()).start, []);
  await admin('mapProfile', { id: pfA, auto_start: true });
});

test('mở rồi mà extension không báo sống quá 10 phút → đóng, ghi lỗi, 60 phút sau mới thử lại', async () => {
  assert.equal((await launcher.tick()).start.length, 1);
  assert.deepEqual((await launcher.tick()).stop, [], 'mới 5 phút, còn chờ');
  // gọi thẳng hub với mốc mở từ 11 phút trước
  const res = await fetch(hubUrl + '/api/launcher/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + launcherToken },
    body: JSON.stringify({ gem_profiles: gemState.profiles, running: [{ gem_id: 'g1', started_at: Date.now() - 11 * MIN }] }) }).then(r => r.json());
  assert.deepEqual(res.stop, [{ gem_id: 'g1', name: 'Nick bán hàng', reason: 'mở rồi nhưng extension không báo sống' }]);
  assert.ok(profileRow(pfA).launch_fail_at > 0);
  const after = await fetch(hubUrl + '/api/launcher/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + launcherToken },
    body: JSON.stringify({ gem_profiles: gemState.profiles, running: [] }) }).then(r => r.json());
  assert.deepEqual(after.start, [], 'đang trong thời gian chờ thử lại');
  sql('UPDATE profiles SET launch_fail_at = ? WHERE id = ?', Date.now() - 61 * MIN, pfA);
  await launcher.tick(); // launcher thật vẫn đang giữ g1 -> nhận lệnh đóng trước
  sql('UPDATE profiles SET launch_fail_at = ? WHERE id = ?', Date.now() - 61 * MIN, pfA);
  gemState.open.clear();
});

test('GemLogin không phản hồi: launcher báo lỗi lên hub, hub giữ danh sách profile cũ', async () => {
  gemState.down = true;
  await launcher.tick();
  const l = (await admin('state')).data.launchers[0];
  assert.equal(l.gem_ok, false);
  assert.match(l.last_error, /GemLogin/);
  assert.equal(l.gem_profiles.length, 2);
  gemState.down = false;
  await launcher.tick();
  assert.equal((await admin('state')).data.launchers[0].gem_ok, true);
});

test('dò ghép: mở từng profile GemLogin chưa ghép, profile Auto vjp nào báo sống thì ghép + lấy tên', async () => {
  // dọn: bỏ việc chờ của pfA để launcher không bận mở nó
  sql("UPDATE tasks SET status = 'cancelled' WHERE status = 'queued'");
  const sync = body => fetch(hubUrl + '/api/launcher/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + launcherToken },
    body: JSON.stringify({ gem_profiles: gemState.profiles, running: [], ...body }) }).then(r => r.json());
  await sync({});
  await admin('discover', { id: launcherId });
  const first = await sync({});
  assert.deepEqual(first.start, [{ gem_id: 'g2', name: 'Nick phụ', reason: 'dò ghép' }], 'g1 đã ghép nên bỏ qua');
  const startedAt = Date.now() - 30 * 1000;
  sql('UPDATE launchers SET discover_json = ? WHERE id = ?', JSON.stringify({ active: true, current: { gem_id: 'g2', started_at: startedAt, baseline: [] }, done: [] }), launcherId);
  // extension trong profile g2 báo danh (profile mới, chờ duyệt)
  const pfB = 'pf_' + 'b2'.repeat(12);
  await agent('register', { profile_id: pfB, version: '2.14.0' });
  const second = await sync({ running: [{ gem_id: 'g2', started_at: startedAt }] });
  assert.deepEqual(second.stop, [{ gem_id: 'g2', name: 'Nick phụ', reason: 'dò ghép xong' }]);
  const row = profileRow(pfB);
  assert.equal(row.launcher_id, launcherId);
  assert.equal(row.gem_id, 'g2');
  assert.equal(row.name, 'Nick phụ', 'điền sẵn tên theo GemLogin');
  assert.equal(row.status, 'pending', 'vẫn phải duyệt tay');
  await sync({});
  const l = (await admin('state')).data.launchers[0];
  assert.equal(l.discover.active, false);
  assert.deepEqual(l.discover.done, [{ gem_id: 'g2', ok: true, note: 'đã ghép' }]);
});

test('dò ghép: quá thời gian không thấy extension → ghi chú, không ghép bừa', async () => {
  gemState.profiles.push({ id: 'g3', name: 'Nick chưa cài' });
  const sync = body => fetch(hubUrl + '/api/launcher/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + launcherToken },
    body: JSON.stringify({ gem_profiles: gemState.profiles, running: [], ...body }) }).then(r => r.json());
  await admin('discover', { id: launcherId });
  assert.equal((await sync({})).start[0].gem_id, 'g3');
  const startedAt = Date.now() - 3 * MIN;
  sql('UPDATE launchers SET discover_json = ? WHERE id = ?', JSON.stringify({ active: true, current: { gem_id: 'g3', started_at: startedAt, baseline: [] }, done: [] }), launcherId);
  const res = await sync({ running: [{ gem_id: 'g3', started_at: startedAt }] });
  assert.equal(res.stop[0].gem_id, 'g3');
  const l = (await admin('state')).data.launchers[0];
  assert.equal(l.discover.done[0].ok, false);
  assert.match(l.discover.done[0].note, /không thấy extension/);
});

test('xoá máy chạy thì bỏ ghép các profile của nó', async () => {
  assert.equal((await admin('removeLauncher', { id: launcherId })).status, 200);
  assert.equal(profileRow(pfA).launcher_id, null);
  assert.equal((await admin('state')).data.launchers.length, 0);
});
