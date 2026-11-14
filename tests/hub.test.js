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
  await S.set({ [S.KEYS.ACCOUNTS]: { threads: [{ social_username: 'nick_a', social_name: 'Nick A', followers_count: 1200, scanned_at: 1700000000000, cookie: 'BI-MAT' }] } });
  const st = await remote.configure(base + '/');
  await remote.setAutoScan(false); // các test dưới kiểm luồng giao việc; tự quét có test riêng ở cuối
  profileId = st.profileId;
  assert.match(profileId, /^pf_[a-f0-9]{24}$/);
  assert.equal(st.status, 'pending');
  assert.equal(st.url, base);
  const { profiles } = (await admin('state')).data;
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, profileId);
  assert.equal(profiles[0].status, 'pending');
  assert.deepEqual(profiles[0].accounts, [{ platform: 'threads', kind: 'nick', username: 'nick_a', name: 'Nick A', followers: 1200, scanned_at: 1700000000000 }]);
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
  const created = await admin('createTask', { profile_id: profileId, payload: { platform: 'threads', type: 'post', content: 'xin chào', origin: 'local', id: 'gia-mao',
    images: ['hub://media/m_ab12/cd34/anh.jpg', 'https://cdn.example.com/b.jpg'] } });
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
  assert.deepEqual(run.images, [base + '/media/m_ab12/cd34/anh.jpg', 'https://cdn.example.com/b.jpg'], 'tệp trong kho hub được đổi thành địa chỉ thật');

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

test('giao một việc cho nhiều profile + lệch giờ ngẫu nhiên; lặp hằng ngày giữ giờ gốc', async () => {
  const agent = (name, body, token) => fetch(`${base}/api/agent/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
  }).then(r => r.json());
  const ids = ['c1', 'c2', 'c3'].map(x => 'pf_' + x.repeat(12));
  const tokens = [];
  for (const [i, id] of ids.entries()) {
    tokens.push((await agent('register', { profile_id: id })).token);
    if (i < 2) await admin('approve', { id, name: 'Nuôi ' + i });
  }
  const payload = { platform: 'tiktok', type: 'nurture', watch_count: 5, like_enabled: true, max_minutes: 10 };
  const baseAt = Date.now() - 60 * 60 * 1000;
  // một profile chưa duyệt -> không tạo việc nào
  assert.equal((await admin('createTask', { profile_ids: ids, payload, run_at: baseAt })).status, 400);
  assert.equal((await admin('createTask', { profile_ids: [], payload })).status, 400);
  const before = (await admin('state')).data.tasks.length;
  const res = await admin('createTask', { profile_ids: [ids[0], ids[1], ids[0]], payload, run_at: baseAt, repeat: 'daily', jitter_minutes: 30 });
  assert.equal(res.status, 200);
  assert.equal(res.data.ids.length, 2, 'profile trùng chỉ tính một lần');
  const tasks = (await admin('state')).data.tasks.filter(t => res.data.ids.includes(t.id));
  assert.equal((await admin('state')).data.tasks.length, before + 2);
  for (const t of tasks) assert.ok(t.run_at >= baseAt && t.run_at <= baseAt + 30 * 60 * 1000, 'lệch trong 0–30 phút sau giờ gốc');
  // nhận việc -> lần kế tiếp tính từ GIỜ GỐC + 24h (không cộng dồn độ lệch), vẫn lệch trong 30 phút
  const got = await agent('sync', { profile_id: ids[0], capacity: 3 }, tokens[0]);
  assert.deepEqual(got.tasks.map(t => t.payload), [payload]);
  const next = (await admin('state')).data.tasks.find(t => t.profile_id === ids[0] && t.status === 'queued');
  const nextBase = baseAt + 24 * 3600 * 1000;
  assert.ok(next.run_at >= nextBase && next.run_at <= nextBase + 30 * 60 * 1000);
});

test('tự quét nick: chỉ khi đã duyệt và rảnh; mỗi lượt một nền tảng; có nick thì 1 ngày, chưa có thì 1 tuần', async () => {
  await settle(100);
  mock.reset(); started.length = 0;
  await S.set({ [S.KEYS.ACCOUNTS]: { threads: [{ social_username: 'nick_a' }] } });
  const st = await remote.configure(base);
  assert.equal(st.autoScan, true);
  await remote.sync({ force: true });
  await settle();
  assert.equal(started.length, 0, 'chưa duyệt thì chưa quét');
  await admin('approve', { id: st.profileId, name: 'Máy quét' });

  const scanned = [];
  for (let i = 0; i < 7; i++) {
    await remote.sync({ force: true });
    await settle();
    const run = await S.getRun();
    if (!run) break;
    assert.equal(run.type, 'scan_account');
    assert.equal(run.origin, 'local');
    scanned.push(run.platform);
    await outbox.deliver({ type: 'scan_account', taskId: run.task_id, platform: run.platform });
    await settle(150);
  }
  assert.deepEqual(scanned.sort(), ['instagram', 'threads', 'tiktok', 'x', 'youtube'], 'lần đầu quét đủ 5 nền tảng, mỗi lượt một cái');

  // tua 2 ngày: chỉ threads (đã có nick) tới hạn quét lại
  const cfg = await S.get('autovjp.remote');
  const twoDays = Date.now() - 2 * 24 * 3600 * 1000;
  await S.set({ 'autovjp.remote': { ...cfg, scanAt: Object.fromEntries(Object.keys(cfg.scanAt).map(k => [k, twoDays])) } });
  const again = [];
  for (let i = 0; i < 3; i++) {
    await remote.sync({ force: true });
    await settle();
    const run = await S.getRun();
    if (!run) break;
    again.push(run.platform);
    await outbox.deliver({ type: 'scan_account', taskId: run.task_id, platform: run.platform });
    await settle(150);
  }
  assert.deepEqual(again, ['threads']);

  // tắt tự quét thì thôi
  await remote.setAutoScan(false);
  await S.set({ 'autovjp.remote': { ...(await S.get('autovjp.remote')), scanAt: {} } });
  await remote.sync({ force: true });
  await settle();
  assert.equal(await S.getRun(), null);
});

test('hub: nút quét nick giao 5 việc quét; bảng Nick có kết quả gần nhất theo nền tảng (không tính việc quét)', async () => {
  const st = await remote.state();
  const res = await admin('scanProfile', { id: st.profileId });
  assert.equal(res.status, 200);
  assert.equal(res.data.ids.length, 5);
  const state = (await admin('state')).data;
  assert.ok(Array.isArray(state.last_results));
  assert.ok(state.last_results.every(r => r.type !== 'scan_account'));
  const mine = state.last_results.filter(r => r.platform === 'threads');
  assert.ok(mine.length >= 1 && mine.every(r => r.received_at > 0 && r.status));
});

test('giao nhanh: hub tự suy ra nền tảng từ nick của từng profile; gom thành một lần giao', async () => {
  const agent = (name, body, token) => fetch(`${base}/api/agent/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
  }).then(r => r.json());
  const mk = async (key, name, accounts, extra) => {
    const id = 'pf_' + key.repeat(12);
    const token = (await agent('register', { profile_id: id })).token;
    await admin('approve', { id, name });
    await agent('sync', { profile_id: id, capacity: 0, accounts, ...extra }, token);
    return { id, token };
  };
  const nick = (platform, username) => ({ platform, kind: 'nick', username, name: username });
  const A = await mk('d1', 'Nhanh A', [nick('instagram', 'a_ig'), nick('tiktok', 'a_tt'), nick('facebook', 'A'), { platform: 'facebook', kind: 'page', name: 'Page A' }], { fb_available: true });
  const B = await mk('d2', 'Nhanh B', [nick('threads', 'b_th'), nick('facebook', 'B')], { fb_available: false });
  const C = await mk('d3', 'Nhanh C', []);
  assert.equal((await admin('setTags', { id: A.id, tags: ['nuôi mới', ' nuôi mới ', ''] })).data.tags.length, 1);
  await admin('setTags', { id: B.id, tags: ['nuôi mới'] });
  await admin('setTags', { id: C.id, tags: ['nuôi mới'] });
  assert.deepEqual((await admin('state')).data.profiles.find(p => p.id === A.id).tags, ['nuôi mới']);

  assert.equal((await admin('dispatch', { intent: 'dang_bai', target: { all: true } })).status, 400);
  assert.equal((await admin('dispatch', { intent: 'nurture', target: { tag: 'không có nhóm này' } })).status, 400);
  assert.equal((await admin('dispatch', { intent: 'nurture', target: { profile_ids: [C.id] } })).status, 400, 'profile chưa có nick thì không có gì để nuôi');

  const res = await admin('dispatch', { intent: 'nurture', target: { tag: 'nuôi mới' }, level: 'light' });
  assert.equal(res.status, 200);
  // A: instagram + tiktok + facebook (có lõi FB); B: threads (facebook bị bỏ vì chưa có lõi FB); C: không có nick
  assert.equal(res.data.tasks, 4);
  assert.equal(res.data.profiles, 2);
  assert.deepEqual(res.data.skipped, ['Nhanh C']);
  const batch = (await admin('state')).data.batches.find(b => b.id === res.data.batch_id);
  assert.match(batch.label, /Nuôi \(Nhẹ\).*nuôi mới/);
  assert.deepEqual(batch.items.map(i => i.profile_id === A.id ? 'A:' + i.platform : 'B:' + i.platform).sort(), ['A:facebook', 'A:instagram', 'A:tiktok', 'B:threads']);

  // profile nhận đúng việc theo nền tảng, tham số theo mức Nhẹ
  const got = (await agent('sync', { profile_id: A.id, capacity: 5 }, A.token)).tasks.map(t => t.payload);
  const ig = got.find(p => p.platform === 'instagram');
  assert.equal(ig.type, 'nurture');
  assert.equal(ig.max_actions, 4);
  assert.equal(ig.comment_enabled, false);
  assert.equal(got.find(p => p.platform === 'tiktok').watch_count, 3);
  const fb = got.find(p => p.platform === 'facebook');
  assert.deepEqual([fb.type, fb.feature, fb.config.actionMode, fb.config.target], ['fb_feature', 'feed', 'like', 8]);

  // thu hẹp nền tảng + giao lại phần lỗi + huỷ phần chưa chạy
  const only = await admin('dispatch', { intent: 'nurture', target: { tag: 'nuôi mới' }, platforms: ['threads'], run_at: Date.now() + 3600e3, repeat: 'daily', jitter_minutes: 60 });
  assert.equal(only.data.tasks, 1);
  assert.equal((await admin('cancelBatch', { id: only.data.batch_id })).data.cancelled, 1);
  const first = (await agent('sync', { profile_id: B.id, capacity: 5 }, B.token)).tasks[0];
  await agent('results', { profile_id: B.id, results: [{ receipt_id: 'qd1', remote_task_id: first.id, origin: 'remote', platform: 'threads', type: 'nurture', status: 'failed', message: 'hỏng' }] }, B.token);
  assert.equal((await admin('retryBatch', { id: res.data.batch_id })).data.retried, 1);
  const after = (await admin('state')).data.batches.find(b => b.id === res.data.batch_id);
  assert.equal(after.items.find(i => i.profile_id === B.id).status, 'queued', 'mục của B hiện việc mới nhất');

  // quét: mọi nền tảng quét được, không cần có nick trước
  const scan = await admin('dispatch', { intent: 'scan', target: { profile_ids: [C.id] } });
  assert.equal(scan.data.tasks, 5);
});

test('lệch giờ: các việc cùng profile cùng giờ gốc chạy liền nhau; profile khác thì khác giờ', async () => {
  const state = (await admin('state')).data;
  const approved = state.profiles.filter(p => p.status === 'approved' && p.accounts.some(a => a.kind === 'nick' && a.platform !== 'facebook')).slice(0, 2);
  assert.equal(approved.length, 2);
  const baseAt = Date.now() + 5 * 3600e3;
  const res = await admin('dispatch', { intent: 'scan', target: { profile_ids: approved.map(p => p.id) }, run_at: baseAt, jitter_minutes: 600 });
  const items = (await admin('state')).data.batches.find(b => b.id === res.data.batch_id).items;
  const times = id => [...new Set(items.filter(i => i.profile_id === id).map(i => i.run_at))];
  assert.equal(times(approved[0].id).length, 1, 'cùng profile: một thời điểm');
  assert.equal(times(approved[1].id).length, 1);
  assert.notEqual(times(approved[0].id)[0], times(approved[1].id)[0], 'khác profile: khác thời điểm');
  assert.ok(items.every(i => i.run_at >= baseAt && i.run_at <= baseAt + 600 * 60000));
  await admin('cancelBatch', { id: res.data.batch_id });
});

test('kho tệp + Đăng: tải lên, hub tự chọn kiểu đăng từng nền tảng, extension nhận địa chỉ thật', async () => {
  const fs = require('node:fs'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avjp-media-'));
  const h = createHub({ adminPassword: PASSWORD, dbPath: ':memory:', mediaDir: dir, maxUploadMb: 1,
    fetch: async url => String(url).includes('ok') ? new Response(Buffer.from('ảnh từ url'), { headers: { 'content-type': 'image/png' } }) : new Response('x', { status: 404 }) });
  const srv = http.createServer(h.handle);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  let ck = '';
  const adm = async (name, body) => {
    const res = await fetch(`${b2}/api/admin/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify(body || {}) });
    const set = res.headers.get('set-cookie'); if (set) ck = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  const upload = (name, type, bytes, headers) => fetch(`${b2}/api/admin/upload`, { method: 'POST', body: bytes,
    headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name), 'X-Hub-Upload': '1', Cookie: ck, ...headers } }).then(async r => ({ status: r.status, data: await r.json() }));
  const ag = (name, body, token) => fetch(`${b2}/api/agent/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    assert.equal((await upload('a.mp4', 'video/mp4', Buffer.from('x'))).status, 401, 'chưa đăng nhập');
    await adm('login', { username: 'admin', password: PASSWORD });
    assert.equal((await upload('a.mp4', 'video/mp4', Buffer.from('x'), { 'X-Hub-Upload': '' })).status, 400, 'thiếu header chống CSRF');
    assert.equal((await upload('virus.exe', 'application/octet-stream', Buffer.from('x'))).status, 415);
    assert.equal((await upload('to.mp4', 'video/mp4', Buffer.alloc(1024 * 1024 + 10))).status, 413);
    assert.deepEqual(fs.readdirSync(dir), [], 'tệp bị từ chối không để lại rác');

    const video = Buffer.from('nội dung video giả');
    const up = await upload('../../Mẹo phối đồ.MP4', 'video/mp4', video);
    assert.equal(up.status, 200);
    assert.equal(up.data.media.kind, 'video');
    assert.match(up.data.media.ref, /^hub:\/\/media\/m_[a-f0-9]+\/[a-f0-9]{32}\/[\w.\-]+\.mp4$/, 'tên tệp được làm sạch, đuôi viết thường');
    const img = (await adm('importMedia', { url: 'https://cdn.example.com/ok/anh' })).data.media;
    assert.equal(img.kind, 'image');
    assert.match(img.ref, /\.png$/, 'đuôi suy từ content-type');
    assert.equal((await adm('importMedia', { url: 'https://cdn.example.com/missing.png' })).status, 502);
    assert.equal((await adm('importMedia', { url: 'file:///etc/passwd' })).status, 400);

    // extension tải được bằng token, sai token thì không
    const httpUrl = up.data.media.ref.replace('hub://', b2 + '/');
    const got = await fetch(httpUrl);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), video);
    assert.equal((await fetch(httpUrl.replace(/\/[a-f0-9]{32}\//, '/' + '0'.repeat(32) + '/'))).status, 404);

    const nick = (platform, username) => ({ platform, kind: 'nick', username, name: username });
    const id = 'pf_' + 'e1'.repeat(12);
    const token = (await ag('register', { profile_id: id })).token;
    await adm('approve', { id, name: 'Đăng A' });
    await ag('sync', { profile_id: id, capacity: 0, fb_available: true, accounts: ['instagram', 'tiktok', 'youtube', 'threads', 'x', 'facebook'].map(p => nick(p, 'n_' + p)) }, token);

    const content = { title: 'Mẹo phối đồ mùa đông', text: 'Ba cách phối áo khoác. '.repeat(20).trim(), media: [up.data.media.ref] };
    assert.equal((await adm('dispatch', { intent: 'post', target: { all: true }, content: { media: [up.data.media.ref, img.ref] } })).status, 400, 'không trộn video với ảnh');
    assert.equal((await adm('dispatch', { intent: 'post', target: { all: true }, content: {} })).status, 400);
    assert.equal((await adm('dispatch', { intent: 'post', target: { all: true }, content: { text: 'x', media: ['hub://media/m_00/aa/x.mp4'] } })).status, 400);
    const res = await adm('dispatch', { intent: 'post', target: { all: true }, content: { ...content, overrides: { tiktok: 'Caption riêng cho TikTok' } } });
    assert.equal(res.status, 200);
    assert.equal(res.data.tasks, 6);
    const tasks = (await ag('sync', { profile_id: id, capacity: 5 }, token)).tasks.concat((await ag('sync', { profile_id: id, capacity: 5 }, token)).tasks);
    const by = Object.fromEntries(tasks.map(t => [t.payload.platform, t.payload]));
    assert.equal(by.youtube.type, 'upload');
    assert.equal(by.youtube.content.split('\n')[0], 'Mẹo phối đồ mùa đông', 'YouTube: dòng đầu là tiêu đề');
    assert.deepEqual([by.instagram.type, by.threads.type, by.x.type, by.tiktok.type], ['post', 'post', 'post', 'post']);
    assert.deepEqual(by.instagram.images, [up.data.media.ref]);
    assert.ok(by.x.content.length <= 280 && by.x.content.endsWith('…'), 'X bị cắt theo giới hạn');
    assert.ok(by.threads.content.length <= 500);
    assert.equal(by.tiktok.content, 'Caption riêng cho TikTok');
    assert.deepEqual([by.facebook.type, by.facebook.feature, by.facebook.config.videoUrl], ['fb_feature', 'fbReels', up.data.media.ref]);
    assert.match((await adm('state')).data.batches[0].label, /^Đăng video: Mẹo phối đồ/);

    // ảnh: Facebook bỏ qua; chữ: thêm Instagram + TikTok bỏ qua
    assert.equal((await adm('dispatch', { intent: 'post', target: { all: true }, content: { text: 'ảnh đẹp', media: [img.ref] } })).data.tasks, 5);
    assert.equal((await adm('dispatch', { intent: 'post', target: { all: true }, content: { text: 'chỉ có chữ' } })).data.tasks, 3);

    assert.equal((await adm('deleteMedia', { id: up.data.media.id })).status, 200);
    assert.equal((await fetch(httpUrl)).status, 404);
    assert.equal(fs.readdirSync(dir).length, 1);
  } finally {
    await new Promise(r => srv.close(r));
    h.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extension: đổi hub://media thành địa chỉ hub đang nối, và tin host của hub khi tải tệp', async () => {
  require(path.join('..', 'modules', 'kernel', 'media.js'));
  const blocked = globalThis.AVJP.mediaHostBlocked;
  assert.equal(blocked('192.168.1.20'), true);
  assert.equal(blocked('100.101.102.103'), true, 'địa chỉ Tailscale mặc định bị chặn');
  await S.set({ 'autovjp.remote': { url: 'https://100.101.102.103/hub', token: 't', status: 'approved', accept: true } });
  await remote.state(); // đọc cấu hình -> đăng ký host tin cậy
  assert.equal(blocked('100.101.102.103'), false, 'host của hub được phép');
  assert.equal(blocked('100.101.102.104'), true, 'host nội bộ khác vẫn bị chặn');
  assert.equal(blocked('192.168.1.20'), true);
  await remote.disconnect();
  assert.equal(blocked('100.101.102.103'), true, 'ngắt kết nối thì thôi tin');
});
