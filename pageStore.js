// pageStore.js - persistent Page Care data in the extension origin.
// Running state stays in chrome.storage.local; larger Page/group/cache data
// lives in IndexedDB so popup and the service worker can reuse it safely.
(() => {
  const DB_NAME = "fbAutoPageCare";
  const DB_VERSION = 1;
  const STORES = ["pageProfiles", "groupProfiles", "followedPages", "contentCache", "usage"];
  let opening = null;

  function openDb() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    }).catch(error => {
      opening = null;
      throw error;
    });
    return opening;
  }

  function validStore(name) {
    if (!STORES.includes(name)) throw new Error(`Invalid Page Care store: ${name}`);
    return name;
  }

  async function put(store, value) {
    validStore(store);
    const record = { ...(value || {}) };
    if (!record.id) throw new Error("Page Care record needs an id");
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    });
  }

  async function get(store, id) {
    validStore(store);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).get(String(id || ""));
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
      const request = db.transaction(store, "readonly").objectStore(store).openCursor(null, "prev");
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
    validStore(store);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(String(id || ""));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
    });
  }

  async function clear(store) {
    validStore(store);
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB clear failed"));
    });
  }

  globalThis.PageStore = { put, get, list, remove, clear };
})();
