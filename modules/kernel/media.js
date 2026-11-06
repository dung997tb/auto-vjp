/* Auto vjp — kernel media: phục vụ mediaFetchStart/Chunk/End + fetchImage cho automator đã port.
 * Giữ nguyên giao thức MUT message-router: automator xin ảnh theo chunk base64 480KB qua background
 * (content script không tự fetch cross-origin được). Cache chỉ trong RAM của service worker.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const cache = new Map(); // id -> {buf:ArrayBuffer, type}
  let seq = 0;

  function toBase64(buf, offset, length) {
    const bytes = new Uint8Array(buf, offset, length);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  async function start(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const id = `mf_${Date.now().toString(36)}_${++seq}`;
    cache.set(id, { buf, type: res.headers.get('content-type') || 'application/octet-stream' });
    if (cache.size > 6) cache.delete(cache.keys().next().value);
    return { success: true, id, size: buf.byteLength, type: cache.get(id).type };
  }

  function chunk(id, offset, length) {
    const entry = cache.get(id);
    if (!entry) return { success: false, error: 'media cache miss' };
    const off = Math.max(0, Number(offset) || 0);
    const len = Math.min(Number(length) || 480 * 1024, entry.buf.byteLength - off);
    if (len <= 0) return { success: false, error: 'offset out of range' };
    return { success: true, data: toBase64(entry.buf, off, len), nextOffset: off + len };
  }

  function end(id) {
    cache.delete(id);
    return { success: true };
  }

  async function fetchImage(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) throw new Error('image too large');
    const type = res.headers.get('content-type') || 'image/jpeg';
    return { success: true, dataUrl: `data:${type};base64,${toBase64(buf, 0, buf.byteLength)}`, type };
  }

  globalThis.AVJP.media = { start, chunk, end, fetchImage };
})();
