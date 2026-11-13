/* Auto vjp — manage-updater.js (2.11.20)
 * Nút tự cập nhật trên trang quản lý: tải bản mới nhất từ GitHub (zip),
 * giải nén bằng bộ đọc ZIP tự viết, kiểm chứng rồi ghi mirror vào thư mục
 * extension người dùng đã chọn qua File System Access API.
 *
 * File gồm 2 phần:
 *  - LÕI thuần: AVJP.updater.runUpdate / unzipZip / cmpVersion. Lõi chỉ dùng
 *    đúng FSA subset đã cam kết trên handle (getFileHandle,
 *    getDirectoryHandle, createWritable write/close, getFile,
 *    values(), removeEntry) để test được bằng handle giả in-memory.
 *  - UI: gắn vào các phần tử #upd* trong manage.html, lưu handle thư mục
 *    vào IndexedDB để chỉ phải chọn thư mục 1 lần.
 *
 * 2.11.20 — siết an toàn cập nhật:
 *  - Ghim commit: hỏi GitHub SHA của nhánh main rồi tải manifest + zip theo
 *    ĐÚNG SHA đó (một ảnh chụp nhất quán, không lệch giữa 2 lần tải).
 *  - Zip: kiểm CRC32 từng file, từ chối đường dẫn nguy hiểm (.., tuyệt đối, \).
 *  - So với thư mục hiện tại: chỉ ghi file thật sự đổi, và đưa bản tóm tắt
 *    (commit, file thêm/đổi/xoá, quyền mới trong manifest) cho người dùng
 *    XÁC NHẬN trước khi ghi. Bản mới xin thêm quyền mà không có bước xác
 *    nhận thì từ chối.
 *  Lưu ý: đây KHÔNG phải chữ ký số — ai chiếm được repo vẫn phát hành được
 *  bản độc; bước xác nhận chỉ giúp người dùng thấy rõ mình sắp cài gì.
 */
(function () {
  'use strict';
  globalThis.AVJP = globalThis.AVJP || {};

  var REPO = 'dung997tb/auto-vjp';
  var BRANCH = 'main';
  var REMOTE_SHA_URL = 'https://api.github.com/repos/' + REPO + '/commits/' + BRANCH;
  function remoteManifestUrl(ref) { return 'https://raw.githubusercontent.com/' + REPO + '/' + ref + '/manifest.json'; }
  function remoteZipUrl(sha) {
    return sha
      ? 'https://github.com/' + REPO + '/archive/' + sha + '.zip'
      : 'https://github.com/' + REPO + '/archive/refs/heads/' + BRANCH + '.zip';
  }

  /* ---------- CRC32 (bảng tra, chuẩn ZIP) ---------- */
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- Đường dẫn an toàn trong zip ---------- */
  function isSafePath(path) {
    if (!path || typeof path !== 'string') return false;
    if (path.charAt(0) === '/' || path.indexOf('\\') >= 0 || path.indexOf(':') >= 0 || path.indexOf('\0') >= 0) return false;
    var segs = path.split('/');
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i] === '.' || segs[i] === '..') return false;
    }
    return true;
  }

  /* ---------- Quyền bản mới xin thêm so với bản đang cài ---------- */
  function manifestGrants(mf) {
    var out = [];
    if (!mf || typeof mf !== 'object') return out;
    (mf.permissions || []).forEach(function (x) { out.push('permission: ' + x); });
    (mf.optional_permissions || []).forEach(function (x) { out.push('permission: ' + x); });
    (mf.host_permissions || []).forEach(function (x) { out.push('host: ' + x); });
    (mf.optional_host_permissions || []).forEach(function (x) { out.push('host: ' + x); });
    (mf.content_scripts || []).forEach(function (cs) {
      ((cs && cs.matches) || []).forEach(function (x) { out.push('content script: ' + x); });
    });
    return out;
  }
  function addedGrants(oldMf, newMf) {
    var have = new Set(manifestGrants(oldMf));
    var seen = new Set();
    return manifestGrants(newMf).filter(function (x) {
      if (have.has(x) || seen.has(x)) return false;
      seen.add(x);
      return true;
    });
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function emit(onStatus, stage, data) {
    if (typeof onStatus !== 'function') return;
    try { onStatus(stage, data); } catch (_) { /* onStatus lỗi không được làm hỏng luồng */ }
  }

  /* ---------- So sánh version theo từng đoạn số ---------- */
  function cmpVersion(a, b) {
    var pa = String(a == null ? '' : a).split('.');
    var pb = String(b == null ? '' : b).split('.');
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var na = parseInt(pa[i], 10);
      var nb = parseInt(pb[i], 10);
      if (Number.isNaN(na)) na = 0;
      if (Number.isNaN(nb)) nb = 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  /* ---------- Giải nén ZIP (tự viết, không thư viện) ---------- */
  async function inflateRaw(compBytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream không khả dụng trong trình duyệt này');
    }
    var ds = new DecompressionStream('deflate-raw');
    var writer = ds.writable.getWriter();
    var reader = ds.readable.getReader();
    var writeDone = (async function () {
      await writer.write(compBytes);
      await writer.close();
    })();
    // Tránh unhandled rejection nếu phía đọc đã ném lỗi trước.
    writeDone.catch(function () {});
    var chunks = [];
    var total = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      if (step.value) {
        chunks.push(step.value);
        total += step.value.length;
      }
    }
    await writeDone;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var i = 0; i < chunks.length; i++) {
      out.set(chunks[i], pos);
      pos += chunks[i].length;
    }
    return out;
  }

  async function unzipZip(buf) {
    var bytes;
    if (buf instanceof Uint8Array) bytes = buf;
    else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf);
    else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(buf)) {
      bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } else {
      throw new Error('unzipZip: dữ liệu vào phải là ArrayBuffer/Uint8Array');
    }
    if (bytes.length < 22) throw new Error('unzipZip: file quá ngắn, không phải ZIP');

    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Tìm End Of Central Directory: quét ngược tìm chữ ký 0x06054b50.
    var eocd = -1;
    var minPos = Math.max(0, bytes.length - 22 - 65536);
    for (var i = bytes.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('unzipZip: không tìm thấy End Of Central Directory');

    var totalEntries = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);

    var decoder = new TextDecoder('utf-8');
    var map = new Map();
    var offset = cdOffset;

    for (var e = 0; e < totalEntries; e++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('unzipZip: central directory hỏng tại entry ' + e);
      }
      var method = view.getUint16(offset + 10, true);
      var wantCrc = view.getUint32(offset + 16, true);
      var compSize = view.getUint32(offset + 20, true);
      var rawSize = view.getUint32(offset + 24, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      offset += 46 + nameLen + extraLen + commentLen;

      // Bóc tiền tố thư mục gốc: "auto-vjp-main/<path>" -> "<path>".
      var slash = name.indexOf('/');
      var stripped = slash >= 0 ? name.slice(slash + 1) : name;
      if (!stripped) continue;
      if (name.endsWith('/') || stripped.endsWith('/')) continue; // entry thư mục
      if (!isSafePath(stripped)) throw new Error('unzipZip: đường dẫn không an toàn trong zip: ' + name);

      // Tại local header, đọc lại độ dài tên + extra để tìm offset data thật.
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error('unzipZip: local header hỏng cho ' + name);
      }
      var localNameLen = view.getUint16(localOffset + 26, true);
      var localExtraLen = view.getUint16(localOffset + 28, true);
      var dataOffset = localOffset + 30 + localNameLen + localExtraLen;
      var compData = bytes.subarray(dataOffset, dataOffset + compSize);

      var data;
      if (method === 0) {
        data = new Uint8Array(compData);
      } else if (method === 8) {
        data = await inflateRaw(new Uint8Array(compData));
      } else {
        throw new Error('unzipZip: method nén không hỗ trợ ' + method + ' cho ' + name);
      }
      if (data.length !== rawSize) throw new Error('unzipZip: sai kích thước sau giải nén cho ' + name);
      if (crc32(data) !== wantCrc) throw new Error('unzipZip: sai CRC32 cho ' + name);
      map.set(stripped, data);
    }
    return map;
  }

  /* ---------- Liệt kê đệ quy thư mục local (bỏ qua .git) ---------- */
  async function listLocal(dirHandle, prefix, outFiles, outDirs) {
    for await (var entry of dirHandle.values()) {
      if (!entry || !entry.name) continue;
      if (entry.name === '.git') continue;
      var path = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.kind === 'directory') {
        outDirs.push(path);
        await listLocal(entry, path, outFiles, outDirs);
      } else {
        // kind === 'file' (hoặc handle giả không khai kind -> coi là file).
        outFiles.push(path);
      }
    }
  }

  async function parentHandleOf(root, path) {
    var parts = path.split('/');
    var cur = root;
    for (var i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i]);
    }
    return { parent: cur, name: parts[parts.length - 1] };
  }

  /* ---------- LÕI: runUpdate ---------- */
  async function runUpdate(opts) {
    var options = opts || {};
    var dirHandle = options.dirHandle;
    var onStatus = options.onStatus;
    var expectedName = options.expectedName;
    if (!expectedName) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
          expectedName = chrome.runtime.getManifest().name;
        }
      } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
    }
    if (!dirHandle) {
      emit(onStatus, 'error', { error: 'no-dir-handle' });
      return { ok: false, status: 'error', error: 'no-dir-handle' };
    }

    // 1) Kiểm tra thư mục: đọc manifest.json tại chỗ.
    emit(onStatus, 'check-dir', {});
    var dirManifest;
    try {
      var mfHandle = await dirHandle.getFileHandle('manifest.json');
      var mfFile = await mfHandle.getFile();
      var mfText = await mfFile.text();
      dirManifest = JSON.parse(mfText);
    } catch (err) {
      emit(onStatus, 'error', { error: 'wrong-directory' });
      return { ok: false, status: 'error', error: 'wrong-directory', dirName: undefined };
    }
    var dirName = dirManifest && dirManifest.name;
    if (!dirManifest || dirManifest.name !== expectedName) {
      emit(onStatus, 'error', { error: 'wrong-directory', dirName: dirName });
      return { ok: false, status: 'error', error: 'wrong-directory', dirName: dirName };
    }
    var dirVersion = dirManifest.version;

    // 2) Kiểm tra bản mới trên GitHub.
    emit(onStatus, 'fetch-version', { fromVersion: dirVersion });
    // Ghim commit: lấy SHA của nhánh rồi tải mọi thứ theo SHA đó. Không lấy
    // được SHA (API giới hạn lượt / lỗi mạng) thì lùi về tải theo nhánh và
    // báo rõ "chưa ghim" trong bản tóm tắt xác nhận.
    var commit = null;
    try {
      var shaResp = await fetch(REMOTE_SHA_URL, { headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-store' });
      if (shaResp && shaResp.ok) {
        var shaText = String(await shaResp.text()).trim();
        if (/^[0-9a-f]{40}$/.test(shaText)) commit = shaText;
      }
    } catch (err) {
      console.debug('[Auto vjp][updater] không lấy được SHA, lùi về tải theo nhánh', err);
    }
    var remoteManifest;
    try {
      var mfResp = await fetch(remoteManifestUrl(commit || BRANCH), { cache: 'no-store' });
      if (!mfResp || !mfResp.ok) throw new Error('HTTP ' + (mfResp ? mfResp.status : 'no-response'));
      remoteManifest = await mfResp.json();
    } catch (err) {
      emit(onStatus, 'error', { error: 'fetch-version-failed', detail: String((err && err.message) || err) });
      return { ok: false, status: 'error', error: 'fetch-version-failed', detail: String((err && err.message) || err) };
    }
    var remoteVersion = remoteManifest && remoteManifest.version;
    if (!remoteVersion) {
      emit(onStatus, 'error', { error: 'fetch-version-failed', detail: 'manifest từ xa không có version' });
      return { ok: false, status: 'error', error: 'fetch-version-failed', detail: 'manifest từ xa không có version' };
    }
    var cmp = cmpVersion(remoteVersion, dirVersion);
    if (cmp < 0) {
      emit(onStatus, 'error', { error: 'remote-older', fromVersion: dirVersion, toVersion: remoteVersion });
      return { ok: false, status: 'error', error: 'remote-older', fromVersion: dirVersion, toVersion: remoteVersion };
    }
    if (cmp === 0) {
      emit(onStatus, 'up-to-date', { fromVersion: dirVersion, toVersion: remoteVersion });
      return { ok: true, status: 'up-to-date', fromVersion: dirVersion, toVersion: remoteVersion, filesWritten: 0, filesDeleted: 0 };
    }

    // 3) Tải zip.
    emit(onStatus, 'download', { fromVersion: dirVersion, toVersion: remoteVersion });
    var zipBuf;
    try {
      var zipResp = await fetch(remoteZipUrl(commit), { cache: 'no-store' });
      if (!zipResp || !zipResp.ok) throw new Error('HTTP ' + (zipResp ? zipResp.status : 'no-response'));
      zipBuf = await zipResp.arrayBuffer();
    } catch (err) {
      emit(onStatus, 'error', { error: 'download-failed', detail: String((err && err.message) || err) });
      return { ok: false, status: 'error', error: 'download-failed', detail: String((err && err.message) || err) };
    }

    // 4) Giải nén.
    emit(onStatus, 'unzip', { toVersion: remoteVersion });
    var filesMap;
    try {
      filesMap = await unzipZip(zipBuf);
    } catch (err) {
      emit(onStatus, 'error', { error: 'unzip-failed', detail: String((err && err.message) || err) });
      return { ok: false, status: 'error', error: 'unzip-failed', detail: String((err && err.message) || err) };
    }

    // 5) Kiểm chứng TRƯỚC khi ghi.
    emit(onStatus, 'verify', { files: filesMap.size, toVersion: remoteVersion });
    var verifyDetail = null;
    var newManifest = null;
    if (!filesMap.has('manifest.json')) {
      verifyDetail = 'bản tải về thiếu manifest.json';
    } else if (filesMap.size <= 50) {
      verifyDetail = 'bản tải về chỉ có ' + filesMap.size + ' file (kỳ vọng > 50)';
    } else {
      try {
        newManifest = JSON.parse(new TextDecoder('utf-8').decode(filesMap.get('manifest.json')));
        if (newManifest.name !== expectedName) verifyDetail = 'manifest mới có name "' + newManifest.name + '", kỳ vọng "' + expectedName + '"';
        else if (newManifest.version !== remoteVersion) verifyDetail = 'manifest mới có version "' + newManifest.version + '", kỳ vọng "' + remoteVersion + '"';
      } catch (err) {
        verifyDetail = 'manifest.json trong bản tải về không parse được: ' + String((err && err.message) || err);
      }
    }
    if (verifyDetail) {
      emit(onStatus, 'error', { error: 'verify-failed', detail: verifyDetail });
      return { ok: false, status: 'error', error: 'verify-failed', detail: verifyDetail };
    }

    // 6) Ghi mirror.
    // Liệt kê local TRƯỚC khi ghi (bỏ qua .git ở mọi độ sâu).
    var localFiles = [];
    var localDirs = [];
    try {
      await listLocal(dirHandle, '', localFiles, localDirs);
    } catch (err) {
      emit(onStatus, 'error', { error: 'list-failed', detail: String((err && err.message) || err) });
      return { ok: false, status: 'error', error: 'list-failed', detail: String((err && err.message) || err) };
    }

    // So với thư mục hiện tại: chỉ ghi file mới hoặc thật sự đổi nội dung.
    var localSet = new Set(localFiles);
    var added = [];
    var changed = [];
    var pathsToCheck = [];
    filesMap.forEach(function (_bytes, path) { pathsToCheck.push(path); });
    for (var ci = 0; ci < pathsToCheck.length; ci++) {
      var cPath = pathsToCheck[ci];
      if (!localSet.has(cPath)) { added.push(cPath); continue; }
      var same = false;
      try {
        var cLoc = await parentHandleOf(dirHandle, cPath);
        var cFile = await (await cLoc.parent.getFileHandle(cLoc.name)).getFile();
        same = sameBytes(new Uint8Array(await cFile.arrayBuffer()), filesMap.get(cPath));
      } catch (err) {
        same = false; // không đọc được file local -> coi như phải ghi lại
      }
      if (!same) changed.push(cPath);
    }
    var deleted = localFiles.filter(function (lp) { return !filesMap.has(lp); });
    var newGrants = addedGrants(dirManifest, newManifest);

    // Xác nhận của người dùng TRƯỚC khi ghi bất cứ thứ gì.
    var summary = {
      fromVersion: dirVersion, toVersion: remoteVersion,
      commit: commit, pinned: !!commit,
      added: added, changed: changed, deleted: deleted, newGrants: newGrants
    };
    if (typeof options.confirm === 'function') {
      emit(onStatus, 'confirm', summary);
      var accepted = false;
      try { accepted = await options.confirm(summary); } catch (err) { accepted = false; }
      if (!accepted) {
        emit(onStatus, 'error', { error: 'cancelled' });
        return { ok: false, status: 'error', error: 'cancelled', fromVersion: dirVersion, toVersion: remoteVersion };
      }
    } else if (newGrants.length) {
      emit(onStatus, 'error', { error: 'permissions-changed', newGrants: newGrants });
      return { ok: false, status: 'error', error: 'permissions-changed', newGrants: newGrants };
    }

    var toWrite = new Set(added.concat(changed));
    toWrite.add('manifest.json'); // luôn ghi lại manifest, và ghi CUỐI CÙNG
    var writeOrder = [];
    toWrite.forEach(function (path) { if (path !== 'manifest.json') writeOrder.push(path); });
    writeOrder.push('manifest.json');
    var total = writeOrder.length;
    var filesWritten = 0;

    for (var wi = 0; wi < writeOrder.length; wi++) {
      var wPath = writeOrder[wi];
      var wBytes = filesMap.get(wPath);
      try {
        var parts = wPath.split('/');
        var cur = dirHandle;
        for (var di = 0; di < parts.length - 1; di++) {
          cur = await cur.getDirectoryHandle(parts[di], { create: true });
        }
        var fh = await cur.getFileHandle(parts[parts.length - 1], { create: true });
        var writable = await fh.createWritable();
        try {
          await writable.write(wBytes);
          await writable.close();
        } catch (writeErr) {
          try { await writable.close(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
          throw writeErr;
        }
      } catch (err) {
        emit(onStatus, 'error', { error: 'write-failed', failedFile: wPath, filesWritten: filesWritten });
        return { ok: false, status: 'error', error: 'write-failed', failedFile: wPath, filesWritten: filesWritten };
      }
      filesWritten++;
      emit(onStatus, 'write', { done: filesWritten, total: total, file: wPath });
    }

    // Xoá file thừa (local có, bộ mới không có).
    var filesDeleted = 0;
    for (var fi = 0; fi < localFiles.length; fi++) {
      var lPath = localFiles[fi];
      if (filesMap.has(lPath)) continue;
      try {
        var loc = await parentHandleOf(dirHandle, lPath);
        await loc.parent.removeEntry(loc.name);
        filesDeleted++;
      } catch (_) { /* file thừa xoá không được thì bỏ qua, không chặn cập nhật */ }
    }

    // Xoá thư mục local không còn trong bộ mới (sâu nhất trước, trừ .git).
    var newDirs = new Set();
    filesMap.forEach(function (_bytes, path) {
      var segs = path.split('/');
      var acc = '';
      for (var si = 0; si < segs.length - 1; si++) {
        acc = acc ? acc + '/' + segs[si] : segs[si];
        newDirs.add(acc);
      }
    });
    var dirsDeepFirst = localDirs.slice().sort(function (a, b) {
      return b.split('/').length - a.split('/').length || b.length - a.length;
    });
    for (var dIdx = 0; dIdx < dirsDeepFirst.length; dIdx++) {
      var dPath = dirsDeepFirst[dIdx];
      if (newDirs.has(dPath)) continue;
      if (dPath === '.git' || dPath.split('/').indexOf('.git') >= 0) continue;
      try {
        var dLoc = await parentHandleOf(dirHandle, dPath);
        await dLoc.parent.removeEntry(dLoc.name, { recursive: true });
      } catch (_) { /* thư mục có thể đã bị xoá theo thư mục cha */ }
    }
    emit(onStatus, 'clean', { deleted: filesDeleted });

    // 7) Xong.
    var result = { ok: true, status: 'updated', fromVersion: dirVersion, toVersion: remoteVersion, commit: commit, filesWritten: filesWritten, filesDeleted: filesDeleted };
    emit(onStatus, 'done', result);
    return result;
  }

  globalThis.AVJP.updater = {
    runUpdate: runUpdate,
    unzipZip: unzipZip,
    cmpVersion: cmpVersion,
    crc32: crc32,
    isSafePath: isSafePath,
    addedGrants: addedGrants
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.AVJP.updater;

  /* ================= UI ================= */

  var IDB_NAME = 'autovjp-updater';
  var IDB_STORE = 'handles';
  var IDB_KEY = 'extDir';

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function idbLoadHandle() {
    var db = await idbOpen();
    try {
      return await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    } finally {
      try { db.close(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
    }
  }

  async function idbSaveHandle(handle) {
    var db = await idbOpen();
    try {
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    } finally {
      try { db.close(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
    }
  }

  async function idbDeleteHandle() {
    var db = await idbOpen();
    try {
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(IDB_KEY);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    } finally {
      try { db.close(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
    }
  }

  function initUpdaterUI() {
    if (typeof document === 'undefined') return;
    var versionEl = document.getElementById('updCurrentVersion');
    var btn = document.getElementById('updBtn');
    var statusEl = document.getElementById('updStatus');
    var openExtBtn = document.getElementById('updOpenExt');
    var reselectBtn = document.getElementById('updReselect');
    if (!btn || !statusEl) return;

    function setStatus(text) {
      statusEl.textContent = text || '';
    }

    var runningManifest = null;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        runningManifest = chrome.runtime.getManifest();
      }
    } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
    if (versionEl && runningManifest && runningManifest.version) {
      versionEl.textContent = runningManifest.version;
    }

    function stageToStatus(stage, data) {
      data = data || {};
      switch (stage) {
        case 'check-dir': setStatus('Đang kiểm tra thư mục…'); break;
        case 'fetch-version': setStatus('Đang kiểm tra bản mới…'); break;
        case 'download': setStatus('Đang tải bản ' + (data.toVersion || '') + '…'); break;
        case 'unzip': setStatus('Đang giải nén bản ' + (data.toVersion || '') + '…'); break;
        case 'confirm': setStatus('Chờ xác nhận cập nhật…'); break;
        case 'verify': setStatus('Đang kiểm chứng bản mới' + (data.files ? ' (' + data.files + ' file)' : '') + '…'); break;
        case 'write': setStatus('Đang ghi file ' + (data.done || 0) + '/' + (data.total || 0) + '…'); break;
        case 'clean': setStatus('Đang dọn file thừa (' + (data.deleted || 0) + ' file)…'); break;
        default: break;
      }
    }

    function listSome(title, arr) {
      if (!arr || !arr.length) return '';
      var shown = arr.slice(0, 12).join('\n  ');
      return '\n\n' + title + ' (' + arr.length + '):\n  ' + shown + (arr.length > 12 ? '\n  … và ' + (arr.length - 12) + ' mục nữa' : '');
    }
    function askConfirm(summary) {
      var text = 'Cập nhật Auto vjp ' + summary.fromVersion + ' → ' + summary.toVersion
        + '\nCommit: ' + (summary.pinned ? summary.commit.slice(0, 12) : 'CHƯA GHIM (không lấy được SHA, tải theo nhánh main)')
        + listSome('File mới', summary.added)
        + listSome('File thay đổi', summary.changed)
        + listSome('File sẽ bị xoá', summary.deleted)
        + (summary.newGrants.length
          ? '\n\n⚠ BẢN MỚI XIN THÊM QUYỀN:\n  ' + summary.newGrants.join('\n  ')
          : '\n\nKhông xin thêm quyền nào.')
        + '\n\nGhi vào thư mục extension?';
      return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : false;
    }

    var running = false;

    btn.addEventListener('click', async function () {
      if (running) return;
      running = true;
      btn.disabled = true;
      try {
        var handle = null;
        try { handle = await idbLoadHandle(); } catch (_) { handle = null; }

        if (handle) {
          var perm = 'granted';
          try {
            if (typeof handle.queryPermission === 'function') {
              perm = await handle.queryPermission({ mode: 'readwrite' });
            }
          } catch (_) { perm = 'prompt'; }
          if (perm !== 'granted') {
            try {
              if (typeof handle.requestPermission === 'function') {
                perm = await handle.requestPermission({ mode: 'readwrite' });
              }
            } catch (_) { perm = 'denied'; }
          }
          if (perm !== 'granted') {
            try { await idbDeleteHandle(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
            setStatus('Chưa được cấp quyền ghi vào thư mục đã chọn. Bấm Cập nhật lại để chọn thư mục.');
            return;
          }
        } else {
          if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
            setStatus('Trình duyệt không hỗ trợ chọn thư mục (File System Access API).');
            return;
          }
          try {
            handle = await window.showDirectoryPicker();
          } catch (err) {
            if (err && err.name === 'AbortError') setStatus('Đã huỷ chọn thư mục');
            else setStatus('Không chọn được thư mục: ' + String((err && err.message) || err));
            return;
          }
          if (!handle) return;
          try { await idbSaveHandle(handle); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
        }

        var expectedName = runningManifest && runningManifest.name;
        var result = await runUpdate({ dirHandle: handle, expectedName: expectedName, onStatus: stageToStatus, confirm: askConfirm });

        if (result && result.status === 'updated') {
          if (openExtBtn) openExtBtn.hidden = false;
          setStatus('Đã ghi bản ' + result.toVersion + (result.commit ? ' (commit ' + result.commit.slice(0, 12) + ')' : '') + ' — mở chrome://extensions bấm ⟳ (Làm mới) ở thẻ Auto vjp để nạp bản mới');
        } else if (result && result.status === 'up-to-date') {
          setStatus('Đang ở bản mới nhất ' + result.toVersion);
        } else if (result && result.error === 'wrong-directory') {
          try { await idbDeleteHandle(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
          setStatus('Đã chọn sai thư mục — thư mục đã chọn là "' + (result.dirName || 'không đọc được tên') + '", không phải thư mục của Auto vjp. Bấm Cập nhật để chọn lại đúng thư mục extension.');
        } else if (result && result.error === 'write-failed') {
          setStatus('Ghi thất bại ở file ' + result.failedFile + ' (đã ghi ' + (result.filesWritten || 0) + ' file). Thư mục dạng git clone có thể chữa bằng lệnh git pull trong thư mục extension.');
        } else if (result && result.error === 'cancelled') {
          setStatus('Đã huỷ cập nhật — chưa ghi gì vào thư mục.');
        } else if (result && result.error === 'remote-older') {
          setStatus('Bản trên GitHub (' + result.toVersion + ') cũ hơn bản trong thư mục (' + result.fromVersion + ') — không cập nhật.');
        } else if (result && result.error === 'verify-failed') {
          setStatus('Kiểm chứng bản mới thất bại, chưa ghi gì: ' + (result.detail || 'không rõ lý do'));
        } else if (result && !result.ok) {
          setStatus('Cập nhật thất bại: ' + (result.error || 'lỗi không rõ') + (result.detail ? ' — ' + result.detail : ''));
        }
      } catch (err) {
        setStatus('Cập nhật thất bại: ' + String((err && err.message) || err));
      } finally {
        running = false;
        btn.disabled = false;
      }
    });

    if (reselectBtn) {
      reselectBtn.addEventListener('click', async function () {
        try { await idbDeleteHandle(); } catch (_) { console.debug("[Auto vjp][manage-updater] bỏ qua lỗi:", _); }
        setStatus('Đã quên thư mục đã chọn — bấm Cập nhật để chọn lại.');
      });
    }

    if (openExtBtn) {
      openExtBtn.addEventListener('click', function () {
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url: 'chrome://extensions/' });
          }
        } catch (_) { /* giữ nguyên dòng hướng dẫn ở trạng thái */ }
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUpdaterUI);
    } else {
      initUpdaterUI();
    }
  }
})();
