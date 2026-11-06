// scrapeStore.js - persistent Scrape data in the extension origin.
// Running state stays in chrome.storage.local (isScraping, scrapeTarget, ...);
// collected datasets/posts live in IndexedDB so the popup, the content script
// (via the service worker) and the style-learning flow can reuse them offline
// without bloating chrome.storage.local. Follows the same pattern as pageStore.js.
(() => {
  const DB_NAME = "fbAutoScrape";
  const DB_VERSION = 2;
  const STORES = ["datasets", "posts", "media", "analyses"];
  let opening = null;

  function openDb() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("datasets")) {
          db.createObjectStore("datasets", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("posts")) {
          const posts = db.createObjectStore("posts", { keyPath: "id" });
          posts.createIndex("datasetId", "datasetId", { unique: false });
        }
        if (!db.objectStoreNames.contains("media")) {
          const media = db.createObjectStore("media", { keyPath: "id" });
          media.createIndex("datasetId", "datasetId", { unique: false });
        }
        if (!db.objectStoreNames.contains("analyses")) {
          db.createObjectStore("analyses", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      // Tab khac dang giu ket noi cu chan version-upgrade -> that bai nhanh thay vi
      // treo mai promise "opening" o cap module cho toan bo vong doi service worker.
      request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    }).catch(error => {
      opening = null;
      throw error;
    });
    return opening;
  }

  function validStore(name) {
    if (!STORES.includes(name)) throw new Error(`Invalid Scrape store: ${name}`);
    return name;
  }

  async function runTx(store, mode, fn) {
    validStore(store);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB tx failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB tx aborted"));
    });
  }

  async function put(store, value) {
    return runTx(store, "readwrite", os => {
      const record = { ...(value || {}) };
      if (!record.id) throw new Error("Scrape record needs an id");
      os.put(record);
      return record;
    });
  }

  async function get(store, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(validStore(store), "readonly").objectStore(validStore(store)).get(String(id || ""));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
    });
  }

  async function list(store, limit = 500) {
    validStore(store);
    const db = await openDb();
    const max = Math.max(1, Math.min(5000, parseInt(limit) || 500));
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = db.transaction(validStore(store), "readonly").objectStore(validStore(store)).openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= max) return resolve(rows);
        rows.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB list failed"));
    });
  }

  async function remove(store, id) {
    return runTx(store, "readwrite", os => { os.delete(String(id || "")); return true; });
  }

  async function clear(store) {
    return runTx(store, "readwrite", os => { os.clear(); return true; });
  }

  // store = "posts" only; values carry {datasetId, ...} and id is assigned.
  async function putMany(store, values) {
    validStore(store);
    const rows = (Array.isArray(values) ? values : []).filter(v => v && typeof v === "object");
    if (!rows.length) return 0;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      rows.forEach(v => os.put(v));
      let count = 0;
      tx.oncomplete = () => resolve(count = rows.length);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB putMany failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB putMany aborted"));
    });
  }

  async function listByDataset(store, datasetId, limit = 5000) {
    validStore(store);
    const db = await openDb();
    const max = Math.max(1, Math.min(20000, parseInt(limit) || 5000));
    return new Promise((resolve, reject) => {
      const rows = [];
      const objectStore = db.transaction(store, "readonly").objectStore(store);
      const index = objectStore.index("datasetId");
      const key = String(datasetId || "");
      const request = index.openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= max) return resolve(rows);
        rows.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB listByDataset failed"));
    });
  }

  async function removeByDataset(store, datasetId) {
    validStore(store);
    const db = await openDb();
    const key = String(datasetId || "");
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const index = tx.objectStore(store).index("datasetId");
      const request = index.openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          const delReq = cursor.delete();
          delReq.onsuccess = () => cursor.continue();
          delReq.onerror = () => reject(delReq.error || new Error("IndexedDB cursor delete failed"));
        } catch (error) {
          // cursor.delete() nem loi dong bo (vd transaction da abort) - phai reject
          // o day, neu khong promise se treo mai vi khong onsuccess/onerror nao chay.
          reject(error);
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB removeByDataset failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB removeByDataset aborted"));
    });
  }

  async function listPosts(datasetId, limit = 5000) { return listByDataset("posts", datasetId, limit); }
  async function removePosts(datasetId) { return removeByDataset("posts", datasetId); }
  async function listMedia(datasetId, limit = 5000) { return listByDataset("media", datasetId, limit); }
  async function removeMedia(datasetId) { return removeByDataset("media", datasetId); }

  // Upsert một dataset (kèm đếm theo contentClass) và ghi toàn bộ bài của nó.
  async function saveRun(dataset, posts) {
    const meta = { ...(dataset || {}), postCount: (Array.isArray(posts) ? posts.length : 0), contentClassCounts: contentClassCounts(posts) };
    await put("datasets", meta);
    const rows = (Array.isArray(posts) ? posts : []).map(p => {
      // postKey giữ id gốc (chưa gắn tiền tố dataset) vì media (ảnh/poster/video)
      // được lưu bằng đúng key này từ scrape.js::captureRunMedia — nếu chỉ giữ
      // `id` đã gắn tiền tố, library.js sẽ không khớp lại được media đã tải.
      const postId = String(p?.id || "").slice(0, 120);
      return { ...p, postKey: postId, id: `${meta.id}::${postId}`, datasetId: meta.id };
    });
    if (rows.length) await putMany("posts", rows);
    return meta;
  }

  function contentClassCounts(posts) {
    const counts = { text: 0, textBg: 0, photo: 0, video: 0, other: 0 };
    (Array.isArray(posts) ? posts : []).forEach(p => {
      const c = String(p?.contentClass || "other");
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }

  globalThis.ScrapeStore = { put, get, list, remove, clear, putMany, listPosts, removePosts, listMedia, removeMedia, saveRun, contentClassCounts };
})();