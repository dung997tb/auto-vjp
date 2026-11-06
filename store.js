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

(function () {
  try {
    const g = typeof globalThis !== "undefined" ? globalThis : this;
    if (g.__appStorePatched) return;
    if (!chrome || !chrome.storage || !chrome.storage.sync || !chrome.storage.local) return;
    const rawGet = chrome.storage.sync.get.bind(chrome.storage.sync);
    const L = chrome.storage.local, S = chrome.storage.sync;
    const withCb = (promise, cb) => {
      if (typeof cb === "function") promise.then(
        (v) => { try { cb(v); } catch (_) {} },
        () => { try { cb(); } catch (_) {} }
      );
      return promise;
    };
    S.get = function (keys, cb) {
      const p = (async () => {
        if (keys == null) {
          // get(null): chỉ gộp theo key đã biết bên sync (TRÁNH local.get(null)
          // vì local chứa blob ảnh/media nặng — đọc hết mỗi lần get config là treo).
          let s = {};
          try { s = (await rawGet(null)) || {}; } catch (_) { s = {}; }
          const names = Object.keys(s);
          if (!names.length) return {};
          let l = {};
          try { l = (await L.get(names)) || {}; } catch (_) { l = {}; }
          const out = mergeStoreValues(names, l, s, null);
          const missing = {};
          for (const k of names) { if (l[k] === undefined && s[k] !== undefined) missing[k] = s[k]; }
          if (Object.keys(missing).length) { try { await L.set(missing); } catch (_) {} }
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
        if (Object.keys(missing).length) { try { await L.set(missing); } catch (_) {} }
        return out;
      })();
      return withCb(p, cb);
    };
    S.set = function (obj, cb) {
      let p;
      try { p = L.set(obj || {}); } catch (e) { p = Promise.reject(e); }
      return withCb(p, cb);
    };
    S.remove = function (keys, cb) {
      let p;
      try { p = L.remove(keys); } catch (e) { p = Promise.reject(e); }
      return withCb(p, cb);
    };
    g.__appStorePatched = true;
  } catch (_) {}
})();
