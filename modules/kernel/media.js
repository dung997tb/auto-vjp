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

  // 2.11.10 — Lớp chặn SSRF TỰ CHỨA trong file này (không phụ thuộc thứ tự
  // nạp file): URL media do task/nội dung web đưa vào nên không cho fetch
  // đích nội bộ. Tiêu chí đồng bộ helper mediaHostBlocked/
  // assertPublicMediaUrl ở background.js (2.11.9): chỉ http/https, chặn
  // localhost/*.localhost/*.local, IPv4 127/8, 10/8, 172.16/12, 192.168/16,
  // 169.254/16, 0/8 (kể cả dạng số nguyên thập phân/hex), IPv6 ::1, ::,
  // fe80::/10, fc00::/7 và IPv4-mapped ::ffff:. Kiểm URL đầu vào ở mọi hàm
  // fetch, và kiểm thêm URL cuối sau redirect trước khi đọc body.
  // (2.11.15) Bịt các lỗ review 5.2 đã kiểm chứng lọt: CGNAT 100.64/10,
  // 192.0.0/24, benchmark 198.18/15, IPv6 NAT64 64:ff9b::/96, 6to4
  // 2002::/16, IPv4-compatible ::/96, hostname một nhãn và hậu tố
  // .internal/.lan/.home.arpa. Đây là BẢN DUY NHẤT của hàm này trong
  // repo: background.js dùng chung qua AVJP.mediaHostBlocked.
  // (2.18.0) Máy chủ quản lý (hub) do chính người dùng nhập địa chỉ là đích tin
  // cậy DUY NHẤT được miễn luật chặn host nội bộ — hub thường nằm trong mạng
  // riêng (LAN / Tailscale 100.64/10) và là nơi chứa video/ảnh cần đăng.
  // kernel/remote.js gọi setTrustedHost mỗi khi đọc cấu hình kết nối.
  let trustedHost = '';
  function setTrustedHost(hostname) {
    trustedHost = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  }

  function mediaHostBlocked(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (trustedHost && host === trustedHost) return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
    if (host.includes(':')) {
      // IPv6: loopback ::1, unspecified ::, link-local fe80::/10, unique-local fc00::/7
      if (host === '::1' || host === '::') return true;
      if (/^fe[89ab]/.test(host)) return true;
      if (/^f[cd]/.test(host)) return true;
      const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped) return mediaHostBlocked(mapped[1]);
      // URL parser chuẩn hoá IPv4-mapped về dạng hex ::ffff:7f00:1 (= 127.0.0.1)
      const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
        return mediaHostBlocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      // (2.11.15) Dạng IPv6 nhúng IPv4 mà parser chuẩn hoá về hex (NAT64,
      // 6to4, compatible — vd ::7f00:1 = 127.0.0.1): giãn đủ 8 hextet rồi
      // áp luật IPv4 cho phần nhúng.
      const hx = expandIPv6(host);
      if (hx) {
        const dotted = (x, y) => `${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`;
        // NAT64 well-known 64:ff9b::/96 — IPv4 nhúng ở 32 bit cuối
        if (hx[0] === 0x64 && hx[1] === 0xff9b && !hx[2] && !hx[3] && !hx[4] && !hx[5]) return mediaHostBlocked(dotted(hx[6], hx[7]));
        // 6to4 2002::/16 — IPv4 nhúng ở bit 16-48
        if (hx[0] === 0x2002) return mediaHostBlocked(dotted(hx[1], hx[2]));
        // IPv4-compatible ::/96 (:: và ::1 đã chặn phía trên)
        if (!hx[0] && !hx[1] && !hx[2] && !hx[3] && !hx[4] && !hx[5]) return mediaHostBlocked(dotted(hx[6], hx[7]));
      }
      return false;
    }
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a === 127 || a === 10 || a === 0) return true;      // loopback / private A / "this host"
      if (a === 172 && b >= 16 && b <= 31) return true;      // private B
      if (a === 192 && b === 168) return true;               // private C
      if (a === 169 && b === 254) return true;               // link-local (metadata)
      if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64/10 (100.100.100.200 = metadata Alibaba)
      if (a === 192 && b === 0 && +m[3] === 0) return true;  // đúng 192.0.0/24 đặc biệt IETF (gồm 192.0.0.192)
      if (a === 198 && (b === 18 || b === 19)) return true;  // benchmark 198.18/15
      return false;
    }
    // IPv4 dạng số nguyên thập phân (2130706433) hoặc hex (0x7f000001):
    // parser URL thường tự chuẩn hoá về dạng chấm thập phân, nhưng tự
    // chuyển ở đây để không phụ thuộc hành vi của parser.
    let intVal = null;
    if (/^\d+$/.test(host)) intVal = Number(host);
    else if (/^0x[0-9a-f]+$/i.test(host)) intVal = parseInt(host, 16);
    if (intVal !== null && Number.isFinite(intVal)) {
      const v = intVal >>> 0;
      return mediaHostBlocked(`${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`);
    }
    // Hostname một nhãn (không dấu chấm): tên máy nội bộ kiểu metadata/
    // intranet/nas — tên public thật luôn có TLD nên chặn.
    if (!host.includes('.')) return true;
    return false;
  }

  // Giãn IPv6 dạng nén (::) thành mảng 8 hextet số; null nếu không hợp lệ.
  // Đầu vào tới đây không còn IPv4 chấm thập phân nhúng (mapped đã xử lý).
  function expandIPv6(host) {
    const halves = host.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if (halves.length === 1) {
      if (head.length !== 8) return null;
      const nums = head.map(x => parseInt(x, 16));
      return nums.some(Number.isNaN) ? null : nums;
    }
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    const nums = [...head, ...Array(missing).fill('0'), ...tail].map(x => parseInt(x, 16));
    return nums.some(Number.isNaN) ? null : nums;
  }

  function assertMediaUrl(urlStr) {
    let u = null;
    try { u = new URL(String(urlStr || '')); } catch (_) { throw new Error('mediaFetch: invalid URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('mediaFetch: blocked non-http(s) URL');
    if (mediaHostBlocked(u.hostname)) throw new Error('mediaFetch: blocked internal host');
  }

  async function start(url) {
    assertMediaUrl(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`);
    if (res.url && res.url !== url) assertMediaUrl(res.url);
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
    assertMediaUrl(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
    if (res.url && res.url !== url) assertMediaUrl(res.url);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) throw new Error('image too large');
    const type = res.headers.get('content-type') || 'image/jpeg';
    return { success: true, dataUrl: `data:${type};base64,${toBase64(buf, 0, buf.byteLength)}`, type };
  }

  globalThis.AVJP.media = { start, chunk, end, fetchImage, setTrustedHost };

  // (2.11.15) Phơi hàm chặn host dùng chung — background.js gọi
  // AVJP.mediaHostBlocked(hostname) thay cho bản sao riêng đã xoá.
  globalThis.AVJP.mediaHostBlocked = mediaHostBlocked;
})();
