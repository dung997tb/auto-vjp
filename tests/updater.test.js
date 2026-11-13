// Test bộ tự cập nhật (manage-updater.js) bằng zip dựng tay, thư mục FSA giả
// trong RAM và fetch giả — không chạm mạng, không chạm đĩa.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const updater = require('../manage-updater.js');

const SHA = 'a'.repeat(40);
const enc = s => new TextEncoder().encode(s);

// Dựng file ZIP: entries = [{name, data(Uint8Array), deflate?, badCrc?}]
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data);
    const comp = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const crc = e.badCrc ? 123 : updater.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(e.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

// Thư mục FSA giả: tree = { 'a.js': Uint8Array, 'sub': { ... } }
function dirHandle(tree, log) {
  return {
    kind: 'directory',
    async getFileHandle(name, opts) {
      if (!(name in tree)) {
        if (!opts || !opts.create) throw new Error('NotFound ' + name);
        tree[name] = new Uint8Array(0);
      }
      return {
        kind: 'file', name,
        async getFile() {
          const bytes = tree[name];
          return { async text() { return new TextDecoder().decode(bytes); }, async arrayBuffer() { return bytes.slice().buffer; } };
        },
        async createWritable() {
          let buf = null;
          return { async write(b) { buf = new Uint8Array(b); }, async close() { if (buf) { tree[name] = buf; log.push('write:' + name); } } };
        }
      };
    },
    async getDirectoryHandle(name, opts) {
      if (!(name in tree)) {
        if (!opts || !opts.create) throw new Error('NotFound ' + name);
        tree[name] = {};
      }
      return Object.assign(dirHandle(tree[name], log), { name });
    },
    async removeEntry(name) { delete tree[name]; log.push('remove:' + name); },
    async *values() {
      for (const name of Object.keys(tree)) {
        yield tree[name] instanceof Uint8Array ? { kind: 'file', name } : Object.assign(dirHandle(tree[name], log), { name });
      }
    }
  };
}

const manifest = (version, extra) => JSON.stringify({ name: 'Auto vjp', version, permissions: ['storage'], ...extra });

// Bản phát hành giả: > 50 file để qua ngưỡng kiểm chứng.
function release(version, extra) {
  const files = { 'manifest.json': manifest(version, extra), 'background.js': 'bg ' + version, 'modules/kernel/store.js': 'store' };
  for (let i = 0; i < 55; i++) files['lib/f' + i + '.js'] = 'file ' + i;
  return files;
}
function zipOf(files, mutate) {
  const entries = Object.entries(files).map(([name, text], i) => ({ name: 'auto-vjp-' + SHA + '/' + name, data: enc(text), deflate: i % 2 === 0 }));
  if (mutate) mutate(entries);
  return makeZip(entries);
}
function installFetch(files, { sha = SHA, zip } = {}) {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    const ok = body => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body), arrayBuffer: async () => body });
    if (url.includes('api.github.com')) return sha ? ok(sha) : { ok: false, status: 403 };
    if (url.includes('raw.githubusercontent.com')) return ok(files['manifest.json']);
    if (url.includes('/archive/')) return ok((zip || zipOf(files)).buffer);
    return { ok: false, status: 404 };
  };
  return calls;
}
function localTree(version) {
  return {
    'manifest.json': enc(manifest(version)), 'background.js': enc('bg ' + version),
    'old.js': enc('thừa'), '.git': { HEAD: enc('ref') },
    modules: { kernel: { 'store.js': enc('store') } }
  };
}

test('cmpVersion / isSafePath / addedGrants', () => {
  assert.equal(updater.cmpVersion('2.11.20', '2.11.9'), 1);
  assert.equal(updater.cmpVersion('2.11', '2.11.0'), 0);
  assert.equal(updater.cmpVersion('1.9', '1.10'), -1);
  for (const bad of ['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a\\b', 'C:/x', './a']) assert.equal(updater.isSafePath(bad), false, bad);
  assert.equal(updater.isSafePath('modules/kernel/store.js'), true);
  assert.deepEqual(
    updater.addedGrants({ permissions: ['storage'] }, { permissions: ['storage', 'cookies'], host_permissions: ['https://a.b/*'] }),
    ['permission: cookies', 'host: https://a.b/*']
  );
});

test('unzipZip: đọc stored + deflate, bóc thư mục gốc; từ chối CRC sai và đường dẫn nguy hiểm', async () => {
  const map = await updater.unzipZip(makeZip([
    { name: 'root/', data: enc('') },
    { name: 'root/a.txt', data: enc('xin chào') },
    { name: 'root/sub/b.txt', data: enc('b'.repeat(500)), deflate: true }
  ]));
  assert.deepEqual([...map.keys()], ['a.txt', 'sub/b.txt']);
  assert.equal(new TextDecoder().decode(map.get('a.txt')), 'xin chào');
  assert.equal(map.get('sub/b.txt').length, 500);
  await assert.rejects(updater.unzipZip(makeZip([{ name: 'root/a.txt', data: enc('x'), badCrc: true }])), /CRC32/);
  await assert.rejects(updater.unzipZip(makeZip([{ name: 'root/../../evil.js', data: enc('x') }])), /không an toàn/);
});

test('runUpdate: tải theo SHA đã ghim, chỉ ghi file đổi, manifest ghi cuối, xoá file thừa, giữ .git', async () => {
  const files = release('2.0.1');
  const calls = installFetch(files);
  const tree = localTree('2.0.0'), log = [];
  let summary = null;
  const res = await updater.runUpdate({ dirHandle: dirHandle(tree, log), expectedName: 'Auto vjp', confirm: s => { summary = s; return true; } });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'updated');
  assert.equal(res.commit, SHA);
  assert.ok(calls.some(u => u.endsWith('/' + SHA + '/manifest.json')));
  assert.ok(calls.some(u => u.endsWith('/archive/' + SHA + '.zip')));
  assert.equal(summary.pinned, true);
  assert.deepEqual(summary.changed.sort(), ['background.js', 'manifest.json']);
  assert.equal(summary.added.length, 55);
  assert.deepEqual(summary.deleted, ['old.js']);
  assert.deepEqual(summary.newGrants, []);
  const writes = log.filter(l => l.startsWith('write:'));
  assert.equal(writes.length, 57, 'store.js không đổi nên không ghi lại');
  assert.equal(writes[writes.length - 1], 'write:manifest.json');
  assert.equal(new TextDecoder().decode(tree['background.js']), 'bg 2.0.1');
  assert.ok(!('old.js' in tree));
  assert.ok('.git' in tree && 'HEAD' in tree['.git']);
});

test('runUpdate: người dùng từ chối xác nhận → không ghi gì', async () => {
  installFetch(release('2.0.1'));
  const tree = localTree('2.0.0'), log = [];
  const res = await updater.runUpdate({ dirHandle: dirHandle(tree, log), expectedName: 'Auto vjp', confirm: () => false });
  assert.equal(res.error, 'cancelled');
  assert.deepEqual(log, []);
});

test('runUpdate: bản mới xin thêm quyền — báo trong tóm tắt; không có bước xác nhận thì từ chối', async () => {
  installFetch(release('2.0.1', { permissions: ['storage', 'cookies'] }));
  const log = [];
  const res = await updater.runUpdate({ dirHandle: dirHandle(localTree('2.0.0'), log), expectedName: 'Auto vjp' });
  assert.equal(res.error, 'permissions-changed');
  assert.deepEqual(res.newGrants, ['permission: cookies']);
  assert.deepEqual(log, []);
  let seen = null;
  await updater.runUpdate({ dirHandle: dirHandle(localTree('2.0.0'), []), expectedName: 'Auto vjp', confirm: s => { seen = s.newGrants; return false; } });
  assert.deepEqual(seen, ['permission: cookies']);
});

test('runUpdate: cùng bản / bản từ xa cũ hơn / sai thư mục / zip hỏng đều không ghi', async () => {
  const run = async (localVersion, files, opts, name) => {
    installFetch(files, opts);
    const log = [];
    const tree = localTree(localVersion);
    if (name) tree['manifest.json'] = enc(JSON.stringify({ name, version: localVersion }));
    const res = await updater.runUpdate({ dirHandle: dirHandle(tree, log), expectedName: 'Auto vjp', confirm: () => true });
    assert.deepEqual(log, []);
    return res;
  };
  assert.equal((await run('2.0.1', release('2.0.1'))).status, 'up-to-date');
  assert.equal((await run('2.0.2', release('2.0.1'))).error, 'remote-older');
  assert.equal((await run('2.0.0', release('2.0.1'), {}, 'Extension khác')).error, 'wrong-directory');
  const files = release('2.0.1');
  assert.equal((await run('2.0.0', files, { zip: zipOf(files, es => { es[1].badCrc = true; }) })).error, 'unzip-failed');
  assert.equal((await run('2.0.0', files, { zip: zipOf({ 'manifest.json': files['manifest.json'] }) })).error, 'verify-failed');
});

test('runUpdate: không lấy được SHA thì lùi về nhánh main và báo chưa ghim', async () => {
  const calls = installFetch(release('2.0.1'), { sha: null });
  let summary = null;
  const res = await updater.runUpdate({ dirHandle: dirHandle(localTree('2.0.0'), []), expectedName: 'Auto vjp', confirm: s => { summary = s; return true; } });
  assert.equal(res.ok, true);
  assert.equal(summary.pinned, false);
  assert.ok(calls.some(u => u.endsWith('/archive/refs/heads/main.zip')));
});
