// Test kernel tầng module: source (hàng đợi/claim/lịch) + outbox (receipt).
// Nạp file kernel THẬT lên globalThis với chrome giả; runner được thay bằng
// bản giả ghi lại các run đã start (không mở tab).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createChromeMock } = require('./helpers/chrome-mock.js');

const mock = createChromeMock();
globalThis.chrome = mock.chrome;
const started = [];
globalThis.AVJP = {
  runner: {
    async start(run) { started.push(run); return null; },
    async watchdog() {}
  }
};
for (const f of ['contract-data', 'contract', 'store', 'outbox', 'source']) {
  require(path.join('..', 'modules', 'kernel', f + '.js'));
}
const { store: S, source, outbox } = globalThis.AVJP;
const K = S.KEYS;
const settle = () => new Promise(r => setTimeout(r, 30));
const quiet = async fn => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; }
};

test.beforeEach(async () => { await settle(); mock.reset(); started.length = 0; });

const POST = { platform: 'threads', type: 'post', content: 'xin chào' };

test('validateTask: từ chối platform/type lạ và video post YouTube', () => {
  assert.throws(() => source.validateTask(null), /object/);
  assert.throws(() => source.validateTask({ platform: 'zalo', type: 'post' }), /platform/);
  assert.throws(() => source.validateTask({ platform: 'facebook', type: 'post' }), /chưa hỗ trợ/);
  assert.throws(() => source.validateTask({ platform: 'threads', type: 'khong_co' }), /type/);
  assert.throws(() => source.validateTask({ platform: 'youtube', type: 'post', images: ['https://a.b/c.mp4'] }), /YouTube/);
  assert.deepEqual(source.validateTask({ platform: 'Threads', type: 'POST' }), { platform: 'threads', type: 'post' });
});

test('enqueue + claim: singleton — chỉ 1 run, task sau nằm lại hàng đợi', async () => {
  const a = await source.enqueue(POST);
  await settle();
  const b = await source.enqueue({ ...POST, content: 'bài 2' });
  await settle();
  assert.equal(started.length, 1);
  const run = await S.getRun();
  assert.equal(run.task_id, a.id);
  assert.equal(run.phase, 'claimed');
  assert.ok(run.run_id && run.delivery_id && run.timeout_ms > 0);
  const queue = await S.get(K.QUEUE);
  assert.deepEqual(queue.map(t => t.id), [b.id]);
});

test('paused: không claim khi đang tạm dừng', async () => {
  await S.set({ [K.PAUSED]: true });
  await source.enqueue(POST);
  await settle();
  assert.equal(started.length, 0);
  assert.equal(await S.getRun(), null);
  assert.equal((await S.get(K.QUEUE)).length, 1);
});

test('deliver: ghi receipt, dọn run, đóng tab managed, rồi claim task kế', async () => {
  const a = await source.enqueue(POST);
  await settle();
  const b = await source.enqueue({ ...POST, content: 'bài 2' });
  await S.touchRun({ tabId: 77 });
  await S.set({ [K.MANAGED_TABS]: [77] });
  const ok = await outbox.deliver({ type: 'post', taskId: a.id, platform: 'threads', tabId: 77, resultUrl: 'https://threads.net/p/1' });
  assert.equal(ok, true);
  await settle();
  const receipts = await S.get(K.RECEIPTS);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, 'success');
  assert.equal(receipts[0].task_id, a.id);
  assert.equal(receipts[0].result_url, 'https://threads.net/p/1');
  assert.deepEqual(mock.removedTabs, [77]);
  assert.deepEqual(await S.get(K.OUTBOX), []);
  assert.equal((await S.getRun()).task_id, b.id, 'task kế được claim sau receipt');
});

test('deliver: receipt trùng không ghi lần hai', async () => {
  await S.set({ [K.PAUSED]: true });
  const result = { type: 'scan_account', taskId: 't1', platform: 'x', runId: 'r1' };
  assert.equal(await outbox.deliver(result), true);
  assert.equal(await outbox.deliver(result), true);
  assert.equal((await S.get(K.RECEIPTS)).length, 1);
});

test('deliver: bỏ kết quả lạc — sai task hoặc sai tab của run', async () => {
  const a = await source.enqueue(POST);
  await settle();
  await S.touchRun({ tabId: 5 });
  await quiet(async () => {
    assert.equal(await outbox.deliver({ type: 'post', taskId: 'task_khac', platform: 'threads' }), false);
    assert.equal(await outbox.deliver({ type: 'post', taskId: a.id, platform: 'threads', tabId: 6 }), false);
  });
  assert.equal(await S.get(K.RECEIPTS), undefined);
  assert.equal((await S.getRun()).task_id, a.id, 'run vẫn còn nguyên');
});

test('deliver: trạng thái chung cuộc suy từ error/items', async () => {
  await S.set({ [K.PAUSED]: true });
  await quiet(async () => {
    await outbox.deliver({ type: 'post', taskId: 'e1', platform: 'x', error: 'hỏng' });
    await outbox.deliver({ type: 'affiliate', taskId: 'e2', platform: 'x', error: 'hỏng giữa chừng', items: [{}] });
    await outbox.deliver({ type: 'affiliate', taskId: 'e3', platform: 'x', exhausted: true, items: [] });
  });
  assert.deepEqual((await S.get(K.RECEIPTS)).map(r => r.status), ['failed', 'success', 'skipped']);
});

test('lịch: đến hạn thì tạo đúng 1 task; daily dời 24h, lịch một lần bị xoá', async () => {
  await S.set({ [K.PAUSED]: true });
  const past = Date.now() - 1000;
  const future = Date.now() + 3600e3;
  await S.set({ [K.SCHEDULES]: [
    { id: 's_once', template: POST, run_at: past },
    { id: 's_daily', template: POST, run_at: past, repeat: 'daily' },
    { id: 's_future', template: POST, run_at: future }
  ] });
  await Promise.all([source.kick(), source.kick()]); // hai kick chồng nhau không được bắn trùng
  const queue = await S.get(K.QUEUE);
  assert.deepEqual(queue.map(t => t.schedule_id).sort(), ['s_daily', 's_once']);
  const schedules = await S.get(K.SCHEDULES);
  assert.deepEqual(schedules.map(s => s.id).sort(), ['s_daily', 's_future']);
  assert.equal(schedules.find(s => s.id === 's_daily').run_at, past + 24 * 3600e3);
});

test('replayPending: khôi phục receipt còn tồn trong outbox, chạy lại không trùng', async () => {
  const item = { receipt_id: 'rcpt_x', task_id: 't9', run_id: 'r9', type: 'post', platform: 'x', status: 'success' };
  await S.set({ [K.OUTBOX]: [item] });
  assert.equal(await quiet(() => outbox.replayPending()), 1);
  assert.equal(await outbox.replayPending(), 0);
  assert.deepEqual((await S.get(K.RECEIPTS)).map(r => r.receipt_id), ['rcpt_x']);
  assert.deepEqual(await S.get(K.OUTBOX), []);
});

test('probe: đi trọn vòng source → run → outbox → receipt (runner thật xử lý probe bằng deliver)', async () => {
  const realStart = globalThis.AVJP.runner.start;
  globalThis.AVJP.runner.start = async run => {
    setTimeout(() => outbox.deliver({ type: 'probe', taskId: run.task_id, platform: 'probe', status: 'success', items: [{ echo: run.payload_echo }] }), 10);
    return null;
  };
  try {
    const res = await source.probe('ping');
    assert.equal(res.success, true);
    assert.equal(res.receipt.items[0].echo, 'ping');
  } finally { globalThis.AVJP.runner.start = realStart; }
});
