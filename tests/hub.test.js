// Test trọn luồng extension <-> hub: kernel thật của extension (chrome giả)
// nói chuyện qua HTTP thật với hub thật (SQLite trong RAM).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createChromeMock } = require('./helpers/chrome-mock.js');

const mock = createChromeMock();
globalThis.chrome = mock.chrome;
const started = [];
globalThis.AVJP = { runner: { async start(run) { started.push(run); return null; }, async watchdog() {} } };
for (const f of ['contract-data', 'contract', 'store', 'outbox', 'remote', 'source']) {
  require(path.join('..', 'modules', 'kernel', f + '.js'));
}
const { store: S, source, outbox, remote } = globalThis.AVJP;
const { createHub } = require('../hub/server.js');

const PASSWORD = 'mat-khau-thu-nghiem';
let hub, server, base, cookie = '';
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));
const quiet = async fn => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};

async function admin(name, body) {
  const res = await fetch(`${base}/api/admin/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body || {})
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

test.before(async () => {
  hub = createHub({ adminPassword: PASSWORD, dbPath: ':memory:' });
  server = http.createServer(hub.handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await settle();
  await new Promise(r => server.close(r));
  hub.close();
});

test('hub: phải đăng nhập mới dùng được API quản lý; sai mật khẩu bị từ chối', async () => {
  assert.equal((await admin('state')).status, 401);
  assert.equal((await quiet(() => admin('login', { username: 'admin', password: 'sai-mat-khau' }))).status, 401);
  assert.equal((await admin('login', { username: 'admin', password: PASSWORD })).status, 200);
  const state = await admin('state');
  assert.equal(state.status, 200);
  assert.ok(state.data.types.threads.includes('post'));
  assert.ok(!('probe' in state.data.types));
});

test('extension chưa cấu hình máy chủ thì không gửi gì', async () => {
  assert.equal(await remote.sync({ force: true }), null);
  assert.equal((await remote.state()).status, 'off');
  assert.equal((await admin('state')).data.profiles.length, 0);
});

let profileId;
test('báo danh: profile tự sinh ID, hiện ở hub dạng chờ duyệt và chưa nhận việc', async () => {
  await S.set({ [S.KEYS.ACCOUNTS]: { threads: [{ social_username: 'nick_a', social_name: 'Nick A', cookie: 'BI-MAT' }] } });
  const st = await remote.configure(base + '/');
  profileId = st.profileId;
  assert.match(profileId, /^pf_[a-f0-9]{24}$/);
  assert.equal(st.status, 'pending');
  assert.equal(st.url, base);
  const { profiles } = (await admin('state')).data;
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, profileId);
  assert.equal(profiles[0].status, 'pending');
  assert.deepEqual(profiles[0].accounts, [{ platform: 'threads', username: 'nick_a', name: 'Nick A' }]);
  assert.ok(!JSON.stringify(profiles).includes('BI-MAT'), 'chỉ gửi trường nhận diện tài khoản');
  assert.equal((await admin('createTask', { profile_id: profileId, payload: { platform: 'threads', type: 'post' } })).status, 400);
});

test('hub từ chối việc sai hợp đồng', async () => {
  assert.equal((await admin('approve', { id: profileId, name: '' })).status, 400);
  assert.equal((await admin('approve', { id: profileId, name: 'Máy 2' })).status, 200);
  const bad = async payload => (await admin('createTask', { profile_id: profileId, payload })).status;
  assert.equal(await bad({ platform: 'facebook', type: 'post' }), 400);
  assert.equal(await bad({ platform: 'threads', type: 'khong_co' }), 400);
  assert.equal(await bad({ platform: 'youtube', type: 'post', images: ['https://a.b/c.mp4'] }), 400);
});

test('giao việc → profile nhận, chạy, báo kết quả → hub ghi nhận xong', async () => {
  const created = await admin('createTask', { profile_id: profileId, payload: { platform: 'threads', type: 'post', content: 'xin chào', origin: 'local', id: 'gia-mao' } });
  assert.equal(created.status, 200);
  const future = await admin('createTask', { profile_id: profileId, payload: { platform: 'x', type: 'post', content: 'mai' }, run_at: Date.now() + 3600e3 });

  const st = await remote.sync({ force: true });
  assert.equal(st.status, 'approved');
  assert.equal(st.name, 'Máy 2');
  await settle();
  assert.equal(started.length, 1, 'chỉ việc đến hạn được nhận');
  const run = await S.getRun();
  assert.equal(run.origin, 'remote');
  assert.equal(run.remote_task_id, created.data.id);
  assert.notEqual(run.id, 'gia-mao');
  assert.equal(run.content, 'xin chào');

  let tasks = (await admin('state')).data.tasks;
  assert.equal(tasks.find(t => t.id === created.data.id).status, 'claimed');
  assert.equal(tasks.find(t => t.id === future.data.id).status, 'queued');

  // Đồng bộ lần nữa không được giao trùng việc đang chạy.
  await remote.sync({ force: true });
  await settle();
  assert.equal(started.length, 1);

  assert.equal(await outbox.deliver({ type: 'post', taskId: run.task_id, platform: 'threads', resultUrl: 'https://threads.net/p/1', resultMessage: 'đã đăng' }), true);
  await settle(200);
  const state = (await admin('state')).data;
  const done = state.tasks.find(t => t.id === created.data.id);
  assert.equal(done.status, 'success');
  assert.equal(done.message, 'đã đăng');
  assert.equal(state.results.length, 1);
  assert.equal(state.results[0].origin, 'remote');
  assert.equal((await remote.state()).pendingReports, 0);
});

test('việc chạy tay tại máy cũng được báo về hub với nguồn "tại chỗ"', async () => {
  const task = await source.enqueue({ platform: 'threads', type: 'post', content: 'tại chỗ' });
  await settle();
  await outbox.deliver({ type: 'post', taskId: task.id, platform: 'threads' });
  await settle(200);
  const { results } = (await admin('state')).data;
  assert.equal(results.length, 2);
  assert.ok(results.some(r => r.origin === 'local' && r.task_id === null));
});

test('tắt "nhận việc từ máy chủ": vẫn báo sống nhưng không nhận việc', async () => {
  const before = started.length;
  const created = await admin('createTask', { profile_id: profileId, payload: { platform: 'x', type: 'post', content: 'chờ' } });
  await remote.setAccept(false);
  await remote.sync({ force: true });
  await settle();
  assert.equal(started.length, before);
  let state = (await admin('state')).data;
  assert.equal(state.profiles[0].accept, false);
  assert.equal(state.profiles[0].online, true);
  assert.equal(state.tasks.find(t => t.id === created.data.id).status, 'queued');
  await remote.setAccept(true);
  await remote.sync({ force: true });
  await settle();
  assert.equal(started.length, before + 1);
  await outbox.deliver({ type: 'post', taskId: (await S.getRun()).task_id, platform: 'x', error: 'hỏng' });
  await settle(200);
  state = (await admin('state')).data;
  assert.equal(state.tasks.find(t => t.id === created.data.id).status, 'failed');
});

test('việc lặp hằng ngày: nhận xong hub tự tạo lần kế tiếp; giao lại tạo mã việc mới', async () => {
  const runAt = Date.now() - 1000;
  const daily = await admin('createTask', { profile_id: profileId, payload: { platform: 'threads', type: 'post', content: 'mỗi ngày' }, run_at: runAt, repeat: 'daily' });
  await remote.sync({ force: true });
  await settle();
  let tasks = (await admin('state')).data.tasks;
  const next = tasks.find(t => t.repeat === 'daily' && t.status === 'queued');
  assert.equal(next.run_at, runAt + 24 * 3600e3);
  await outbox.deliver({ type: 'post', taskId: (await S.getRun()).task_id, platform: 'threads' });
  await settle(200);
  const again = await admin('requeueTask', { id: daily.data.id });
  assert.equal(again.status, 200);
  assert.notEqual(again.data.id, daily.data.id);
  assert.equal((await admin('cancelTask', { id: again.data.id })).status, 200);
});

test('token sai bị từ chối; thu hồi quyền thì extension dừng hẳn, không tự đăng ký lại', async () => {
  const call = (name, body, token) => fetch(`${base}/api/agent/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body)
  });
  assert.equal((await call('sync', { profile_id: profileId }, 'a'.repeat(64))).status, 401);
  assert.equal((await call('register', { profile_id: profileId }, '')).status, 409);
  assert.equal((await call('register', { profile_id: '../../etc' }, '')).status, 400);

  await admin('revoke', { id: profileId });
  const st = await remote.sync({ force: true });
  assert.equal(st.status, 'revoked');
  const seenBefore = (await admin('state')).data.profiles[0].last_seen_at;
  await remote.sync({ force: true });
  assert.equal((await admin('state')).data.profiles[0].last_seen_at, seenBefore, 'không gọi máy chủ nữa');
});

test('đăng ký lại sinh ID mới; duyệt kèm "thay cho profile cũ" chuyển lịch sử sang', async () => {
  const st = await remote.reRegister();
  assert.notEqual(st.profileId, profileId);
  assert.equal(st.status, 'pending');
  assert.equal((await admin('approve', { id: st.profileId, name: 'Máy 2 (mới)', replace_id: profileId })).status, 200);
  const state = (await admin('state')).data;
  assert.deepEqual(state.profiles.map(p => p.id), [st.profileId]);
  assert.ok(state.results.length >= 3 && state.results.every(r => r.profile_id === st.profileId));
  assert.ok(state.tasks.every(t => t.profile_id === st.profileId));
});

test('ngắt kết nối: xoá địa chỉ + token, không gửi gì nữa', async () => {
  const st = await remote.disconnect();
  assert.equal(st.status, 'off');
  assert.equal(st.url, '');
  assert.equal(await remote.sync({ force: true }), null);
});

test('normalizeUrl: chỉ nhận http(s), bỏ dấu / cuối, cấm nhúng mật khẩu', () => {
  assert.equal(remote.normalizeUrl(' https://a.ts.net/hub/ '), 'https://a.ts.net/hub');
  assert.throws(() => remote.normalizeUrl('ftp://a'));
  assert.throws(() => remote.normalizeUrl('https://u:p@a.b'));
  assert.throws(() => remote.normalizeUrl('không phải url'));
});

test('Facebook: profile báo mẫu cấu hình; hub chỉ nhận tính năng hợp lệ có config và giao đúng nguyên dạng', async () => {
  const agent = (name, body, token) => fetch(`${base}/api/agent/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
  }).then(r => r.json());
  const id = 'pf_' + 'fb01'.repeat(6);
  const { token } = await agent('register', { profile_id: id, version: '2.13.0' });
  await admin('approve', { id, name: 'Máy FB' });
  const templates = [
    { feature: 'groupPost', label: 'Đăng nhóm sáng', config: { groups: [{ url: 'https://facebook.com/groups/1' }], content: 'chào' } },
    { feature: 'tinh_nang_la', label: 'bị loại', config: {} }
  ];
  await agent('sync', { profile_id: id, capacity: 0, fb_available: true, fb_templates: templates }, token);
  await agent('sync', { profile_id: id, capacity: 0, fb_available: true }, token); // không gửi lại mẫu -> giữ nguyên
  const state = (await admin('state')).data;
  const profile = state.profiles.find(p => p.id === id);
  assert.equal(profile.fb_available, true);
  assert.deepEqual(profile.fb_templates, [templates[0]]);
  assert.deepEqual(state.types.facebook, ['fb_feature']);
  assert.ok(state.fb_features.includes('groupPost') && !state.types.threads.includes('fb_feature'));

  const create = payload => admin('createTask', { profile_id: id, payload });
  assert.equal((await create({ platform: 'facebook', type: 'fb_feature', feature: 'tinh_nang_la', config: {} })).status, 400);
  assert.equal((await create({ platform: 'facebook', type: 'fb_feature', feature: 'groupPost' })).status, 400);
  assert.equal((await create({ platform: 'facebook', type: 'post', content: 'x' })).status, 400);
  const ok = await create({ platform: 'facebook', type: 'fb_feature', feature: 'groupPost', label: 'Đăng nhóm sáng', config: templates[0].config });
  assert.equal(ok.status, 200);
  const { tasks } = await agent('sync', { profile_id: id, capacity: 3 }, token);
  assert.deepEqual(tasks, [{ id: ok.data.id, payload: { platform: 'facebook', type: 'fb_feature', feature: 'groupPost', label: 'Đăng nhóm sáng', config: templates[0].config } }]);
});
