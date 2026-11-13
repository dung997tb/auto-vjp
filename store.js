/* store.js — Mọi dữ liệu extension về máy (chrome.storage.local), độc lập từng
 * Chrome profile, còn nguyên sau cài/update cùng thư mục.
 *
 * File này patch 1 lần duy nhất mỗi execution context (popup / background /
 * content scripts): mọi lệnh gọi chrome.storage.sync.* được chuyển sang local,
 * đọc thiếu thì rớt về sync cũ và migrate lặng lẽ sang local. Không còn dữ liệu
 * nào roam sang máy khác qua tài khoản Google, không còn dính quota sync 8KB.
 *
 * Tải ĐẦU TIÊN (manifest content_scripts / popup.html / importScripts) để patch
 * có hiệu lực trước mọi code khác. Bọc try/catch: patch lỗi thì giữ nguyên hành
 * vi sync cũ, không crash.
 *
 * Logic gộp tách hàm thuần (mergeStoreValues/keysOfArg) để unit-test được.
 *
 * (2.11.10) Chỉ mục key `__appStoreKeyIndex` (lưu ở local thật): S.set ghi nhớ
 * mọi key đã ghi qua đường patch này. Nhờ đó S.get(null) liệt kê được cả key
 * CHỈ sống ở local (chưa từng có trong sync thật) — trước đây các key đó vô
 * hình với get(null) nên backup dùng sync.get(null) bỏ sót chúng. S.remove
 * cũng xoá cả bản sao ở sync thật + gỡ khỏi chỉ mục, tránh key đã xoá "hồi
 * sinh" qua đường migrate ở lần get sau.
 */
function storeKeysOfArg(keys) {
  if (keys == null) return null;
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys.slice();
  if (typeof keys === "object") return Object.keys(keys);
  return [];
}
// Gộp local (thắng) + sync (dự phòng) + defaults của chrome.storage.get.
function mergeStoreValues(names, localVals, syncVals, defaults) {
  const out = {};
  const l = localVals || {}, s = syncVals || {}, d = defaults || {};
  for (const k of names || []) {
    if (l[k] !== undefined) out[k] = l[k];
    else if (s[k] !== undefined) out[k] = s[k];
    else if (d[k] !== undefined) out[k] = d[k];
  }
  return out;
}
// Helper thuần (2.11.10): hợp nhất nhiều danh sách key thành 1 danh sách
// không trùng, giữ thứ tự xuất hiện đầu tiên, bỏ key rỗng/không phải chuỗi.
function mergeStoreKeyNames() {
  const out = [];
  const seen = new Set();
  for (const list of arguments) {
    if (!Array.isArray(list)) continue;
    for (const k of list) {
      if (typeof k !== "string" || !k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

(function () {
  try {
    const g = typeof globalThis !== "undefined" ? globalThis : this;
    if (g.__appStorePatched) return;
    if (!chrome || !chrome.storage || !chrome.storage.sync || !chrome.storage.local) return;
    const rawGet = chrome.storage.sync.get.bind(chrome.storage.sync);
    const rawRemove = chrome.storage.sync.remove.bind(chrome.storage.sync);
    const L = chrome.storage.local, S = chrome.storage.sync;
    const INDEX_KEY = "__appStoreKeyIndex";
    const withCb = (promise, cb) => {
      if (typeof cb === "function") promise.then(
        (v) => { try { cb(v); } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); } },
        () => { try { cb(); } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); } }
      );
      return promise;
    };
    // ── Chỉ mục key (2.11.10): mảng tên key đã ghi qua S.set, lưu ở local
    // thật dưới INDEX_KEY. Mọi thao tác chỉ mục đều nuốt lỗi — chỉ mục hỏng
    // thì hành vi quay về như trước, không được làm hỏng luồng chính.
    async function readIndex() {
      try {
        const o = await L.get(INDEX_KEY);
        const v = o && o[INDEX_KEY];
        return Array.isArray(v) ? mergeStoreKeyNames(v) : [];
      } catch (_) { return []; }
    }
    async function addToIndex(keys) {
      const add = mergeStoreKeyNames(keys).filter((k) => k !== INDEX_KEY);
      if (!add.length) return;
      try {
        const cur = await readIndex();
        const next = mergeStoreKeyNames(cur, add);
        if (next.length !== cur.length) await L.set({ [INDEX_KEY]: next });
      } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); }
    }
    async function removeFromIndex(keys) {
      const drop = new Set(mergeStoreKeyNames(keys));
      if (!drop.size) return;
      try {
        const cur = await readIndex();
        const next = cur.filter((k) => !drop.has(k));
        if (next.length !== cur.length) await L.set({ [INDEX_KEY]: next });
      } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); }
    }
    S.get = function (keys, cb) {
      const p = (async () => {
        if (keys == null) {
          // get(null): gộp theo HỢP key đã biết = key bên sync thật ∪ chỉ
          // mục key từng ghi qua S.set (2.11.10 — key chỉ sống ở local cũng
          // phải xuất hiện, nếu không backup sẽ bỏ sót). Vẫn chỉ đọc local
          // theo đúng danh sách tên đó (TRÁNH local.get(null) vì local chứa
          // blob ảnh/media nặng — đọc hết mỗi lần get config là treo).
          let s = {};
          try { s = (await rawGet(null)) || {}; } catch (_) { s = {}; }
          const idx = await readIndex();
          const names = mergeStoreKeyNames(Object.keys(s), idx).filter((k) => k !== INDEX_KEY);
          if (!names.length) return {};
          let l = {};
          try { l = (await L.get(names)) || {}; } catch (_) { l = {}; }
          const out = mergeStoreValues(names, l, s, null);
          const missing = {};
          for (const k of names) { if (l[k] === undefined && s[k] !== undefined) missing[k] = s[k]; }
          if (Object.keys(missing).length) { try { await L.set(missing); } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); } }
          // Dọn chỉ mục: key trong chỉ mục mà cả local lẫn sync đều không
          // còn giá trị thì loại khỏi chỉ mục để chỉ mục không phình mãi.
          const dead = idx.filter((k) => l[k] === undefined && s[k] === undefined);
          if (dead.length) await removeFromIndex(dead);
          return out;
        }
        const isObj = keys !== null && typeof keys === "object" && !Array.isArray(keys);
        const names = storeKeysOfArg(keys);
        const defaults = isObj ? keys : null;
        let l = {}, s = {};
        try { l = (await L.get(names)) || {}; } catch (_) { l = {}; }
        // Chỉ rớt về sync khi local thiếu (migrate 1 lần rồi thôi).
        const needSync = names.filter((k) => l[k] === undefined);
        if (needSync.length) { try { s = (await rawGet(needSync)) || {}; } catch (_) { s = {}; } }
        const out = mergeStoreValues(names, l, s, defaults);
        const missing = {};
        for (const k of needSync) { if (s[k] !== undefined) missing[k] = s[k]; }
        if (Object.keys(missing).length) { try { await L.set(missing); } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); } }
        return out;
      })();
      return withCb(p, cb);
    };
    S.set = function (obj, cb) {
      const data = obj || {};
      let p;
      try {
        // Ghi local xong mới cập nhật chỉ mục (2.11.10); addToIndex tự nuốt
        // lỗi nên không làm hỏng kết quả của lệnh ghi chính.
        p = Promise.resolve(L.set(data)).then(() => addToIndex(Object.keys(data)));
      } catch (e) { p = Promise.reject(e); }
      return withCb(p, cb);
    };
    S.remove = function (keys, cb) {
      const names = storeKeysOfArg(keys) || [];
      let p;
      try {
        p = (async () => {
          await L.remove(keys);
          // (2.11.10) Xoá cả bản sao ở sync thật: chỉ xoá local thì lần get
          // sau key cũ lại được migrate "hồi sinh" từ sync. Lỗi phía sync
          // thật thì nuốt — luồng chính (xoá local + gỡ chỉ mục) vẫn xong.
          try { await rawRemove(keys); } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); }
          await removeFromIndex(names);
        })();
      } catch (e) { p = Promise.reject(e); }
      return withCb(p, cb);
    };
    g.__appStorePatched = true;
  } catch (_) { console.debug("[Auto vjp][store] bỏ qua lỗi:", _); }
})();
