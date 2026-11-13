// Test cầu nối Facebook (modules/kernel/fbtask.js): hàng đợi kernel -> bộ hẹn
// giờ của lõi FB. Lõi FB được thay bằng các hàm giả CÙNG TÊN trên global (như
// khi bridge.js được nạp ở cuối background.js); kernel là file thật.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createChromeMock } = require('./helpers/chrome-mock.js');

const mock = createChromeMock();
globalThis.chrome = mock.chrome;
const openTabs = new Set();
mock.chrome.tabs.get = async id => { if (!openTabs.has(id)) throw new Error('No tab'); return { id }; };

// ---- Lõi FB giả ----
const core = { launched: [], stopped: [], launchError: null, busy: false, schedules: [] };
globalThis.normalizeScheduledTask = raw => {
  if (!['groupPost', 'share'].includes(raw.feature)) throw new Error('Tính năng hẹn giờ chưa được hỗ trợ');
  if (!Array.isArray(raw.config.groups) || !raw.config.groups.length) throw new Error('Cần chọn ít nhất 1 nhóm');
  return { id: 'sch_x', feature: raw.feature, label: raw.label || raw.feature, runAt: raw.runAt, config: { groups: raw.config.groups, content: String(raw.config.content || '') }, status: 'scheduled' };
};
globalThis.hasActiveFeature = async () => core.busy;
globalThis.scheduledActiveKey = task => ({ groupPost: 'groupPostActive', share: 'groupShareActive' }[task.feature]);
globalThis.scheduleChainStatusKey = task => ({ groupPost: 'groupPostStatus', share: 'groupShareStatus' }[task.feature]);
globalThis.scheduleChainStopAction = task => ({ groupPost: 'stopGroupPost', share: 'stopGroupShare' }[task.feature]);
globalThis.SCHEDULE_CHAIN_STATE_KEYS = ['groupPostIndex', 'groupPostDone', 'groupPostSkipped', 'groupPostActive'];
globalThis.scheduleChainCompletionEvidence = (task, state) => (state.groupPostDone || 0) + (state.groupPostSkipped || 0) >= task.config.groups.length;
globalThis.sendScheduledTabMessage = async (tabId, message) => { core.stopped.push({ tabId, message }); };
globalThis.scheduledTasks = async () => core.schedules;
globalThis.launchScheduledTask = async task => {
  if (core.launchError) throw new Error(core.launchError);
  core.launched.push(task);
  openTabs.add(42);
  await chrome.storage.local.set({ groupPostActive: true, groupPostDone: 0, groupPostStatus: 'Đang đăng…' });
  return { tabId: 42, runId: 'schedule-x' };
};

globalThis.AVJP = {};
for (const f of ['contract-data', 'contract', 'store', 'outbox', 'fbtask', 'runner', 'source']) {
  require(path.join('..', 'modules', 'kernel', f + '.js'));
}
const { store: S, source, runner, fbtask, contract } = globalThis.AVJP;
const K = S.KEYS;
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const FB = { platform: 'facebook', type: 'fb_feature', feature: 'groupPost', config: { groups: ['g1', 'g2'], content: 'xin chào', rac: 'bị loại' } };
const receipts = async () => (await S.get(K.RECEIPTS)) || [];
const quiet = async fn => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};

test.beforeEach(async () => {
  await settle();
  mock.reset(); openTabs.clear();
  Object.assign(core, { launched: [], stopped: [], launchError: null, busy: false, schedules: [] });
});

test('FB_FEATURES trong contract khớp SCHEDULE_FEATURES của lõi', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const m = /const SCHEDULE_FEATURES=new Set\(\[([^\]]+)\]\)/.exec(src);
  assert.ok(m, 'tìm thấy SCHEDULE_FEATURES trong background.js');
  assert.deepEqual([...contract.FB_FEATURES].sort(), JSON.parse('[' + m[1] + ']').sort());
});

test('các hàm lõi mà fbtask gọi đều còn tồn tại trong background.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  for (const name of ['normalizeScheduledTask', 'launchScheduledTask', 'hasActiveFeature', 'scheduleChainCompletionEvidence', 'scheduledActiveKey', 'sendScheduledTabMessage', 'scheduledTasks']) {
    assert.match(src, new RegExp('function ' + name + '\\('), name);
  }
  for (const name of ['SCHEDULE_CHAIN_STATE_KEYS', 'scheduleChainStatusKey', 'scheduleChainStopAction']) {
    assert.match(src, new RegExp('const ' + name + '='), name);
  }
});

test('nhận việc: cấu hình sai bị từ chối ngay lúc enqueue bằng lỗi của lõi', async () => {
  await assert.rejects(source.enqueue({ ...FB, feature: 'khong_co' }), /chưa được hỗ trợ/);
  await assert.rejects(source.enqueue({ ...FB, config: {} }), /ít nhất 1 nhóm/);
  await assert.rejects(source.enqueue({ ...FB, kind: 'chain' }), /chuỗi/);
  await assert.rejects(source.enqueue({ platform: 'facebook', type: 'post', content: 'x' }), /chưa hỗ trợ/);
});

test('chạy trọn: enqueue → lõi khởi chạy → cờ active tắt + đủ bằng chứng → receipt success', async () => {
  const task = await source.enqueue(FB);
  await settle();
  assert.equal(core.launched.length, 1);
  assert.deepEqual(core.launched[0].config, { groups: ['g1', 'g2'], content: 'xin chào' }, 'cấu hình đã qua chuẩn hoá của lõi');
  let run = await S.getRun();
  assert.equal(run.phase, 'fb_running');
  assert.equal(run.fb_tab_id, 42);
  assert.equal(run.tabId, null, 'không gán tab managed — outbox không được đóng tab Facebook của người dùng');

  await runner.watchdog();
  assert.equal((await receipts()).length, 0, 'đang chạy thì chưa có receipt');

  await chrome.storage.local.set({ groupPostActive: false, groupPostDone: 2, groupPostStatus: 'Đã đăng 2/2 nhóm' });
  await runner.watchdog();
  const [r] = await receipts();
  assert.equal(r.status, 'success');
  assert.equal(r.platform, 'facebook');
  assert.equal(r.task_id, task.id);
  assert.match(r.message, /Đã đăng 2\/2 nhóm/);
  assert.equal(r.details.counters.groupPostDone, 2);
  assert.equal(await S.getRun(), null);
  assert.deepEqual(mock.removedTabs, []);
});

test('dừng giữa chừng (chưa đủ bằng chứng) → uncertain, không bị lớp retry chạy lại', async () => {
  await source.enqueue(FB);
  await settle();
  await chrome.storage.local.set({ groupPostActive: false, groupPostDone: 1, groupPostStatus: 'Đã dừng' });
  await runner.watchdog();
  await settle();
  const list = await receipts();
  assert.deepEqual(list.map(r => r.status), ['uncertain']);
  assert.match(list[0].message, /một phần/);
  assert.equal(((await S.get(K.QUEUE)) || []).length, 0);
});

test('lõi không khởi chạy được → failed kèm lý do, không tự chạy lại', async () => {
  core.launchError = 'Tab Facebook chưa tải đúng trang của lịch';
  await quiet(() => source.enqueue(FB).then(() => settle()));
  const list = await receipts();
  assert.deepEqual(list.map(r => r.status), ['failed']);
  assert.match(list[0].message, /chưa tải đúng trang/);
  assert.equal(((await S.get(K.QUEUE)) || []).length, 0);
});

test('lõi đang bận tính năng khác → chờ, tới lượt thì chạy; chờ quá 60 phút thì failed', async () => {
  core.busy = true;
  await source.enqueue(FB);
  await settle();
  assert.equal(core.launched.length, 0);
  assert.equal((await S.getRun()).phase, 'fb_waiting');
  core.busy = false;
  await runner.watchdog();
  assert.equal(core.launched.length, 1);
  assert.equal((await S.getRun()).phase, 'fb_running');
  // việc thứ hai chờ quá lâu
  await chrome.storage.local.set({ groupPostActive: false, groupPostDone: 2 });
  await runner.watchdog();
  core.busy = true;
  await source.enqueue(FB);
  await settle();
  await S.touchRun({ startedAt: Date.now() - 61 * 60 * 1000 });
  await runner.watchdog();
  assert.deepEqual((await receipts()).map(r => r.status), ['success', 'failed']);
  assert.equal(core.launched.length, 1);
});

test('tab Facebook bị đóng giữa chừng → uncertain; quá thời hạn → gửi lệnh dừng + uncertain', async () => {
  await source.enqueue(FB);
  await settle();
  openTabs.delete(42);
  await runner.watchdog();
  assert.match((await receipts())[0].message, /đã bị đóng/);

  await chrome.storage.local.set({ groupPostActive: false });
  await source.enqueue({ ...FB, timeout_ms: 1000 });
  await settle();
  await S.touchRun({ startedAt: Date.now() - 5000 });
  await runner.watchdog();
  const list = await receipts();
  assert.equal(list[1].status, 'uncertain');
  assert.equal(list[1].failure_code, 'task_timeout');
  assert.deepEqual(core.stopped, [{ tabId: 42, message: { action: 'stopGroupPost' } }]);
});

test('khởi chạy bị gián đoạn (SW chết lúc đang launch) → hết thời gian chờ thì uncertain', async () => {
  await S.set({ [K.PAUSED]: true });
  const task = await source.enqueue(FB);
  await S.set({ [K.QUEUE]: [] });
  await S.setRun({ ...task, task_id: task.id, run_id: 'r', phase: 'fb_launching', fb_launch_at: Date.now() - 60 * 1000, startedAt: Date.now() - 60 * 1000 });
  await runner.watchdog();
  assert.equal((await receipts()).length, 0, 'còn trong thời gian chờ');
  await S.touchRun({ fb_launch_at: Date.now() - 5 * 60 * 1000 });
  await runner.watchdog();
  assert.deepEqual((await receipts()).map(r => r.status), ['uncertain']);
});

test('huỷ từ trang quản lý: gửi lệnh dừng cho tính năng lõi rồi ghi receipt', async () => {
  await source.enqueue(FB);
  await settle();
  assert.equal(await runner.cancelCurrent('thử huỷ'), true);
  assert.deepEqual(core.stopped.map(s => s.message.action), ['stopGroupPost']);
  assert.equal((await receipts())[0].failure_code, 'user_cancelled');
});

test('templates: lấy từ lịch đã tạo trong popup (kể cả bước của chuỗi), bỏ trùng, mới nhất trước', async () => {
  core.schedules = [
    { id: 'a', feature: 'groupPost', label: 'Đăng nhóm sáng', config: { groups: ['g1'] } },
    { id: 'b', kind: 'chain', label: 'Chuỗi đêm', steps: [{ id: 's1', feature: 'share', label: 'Share tối', config: { groups: ['g2'] } }] },
    { id: 'c', feature: 'groupPost', label: 'Đăng nhóm sáng', config: { groups: ['g1', 'g3'] } }
  ];
  assert.deepEqual(await fbtask.templates(), [
    { feature: 'groupPost', label: 'Đăng nhóm sáng', config: { groups: ['g1', 'g3'] } },
    { feature: 'share', label: 'Share tối', config: { groups: ['g2'] } }
  ]);
});
