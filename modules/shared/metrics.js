/* Auto vjp — metrics dùng chung: đọc số chỉ số (followers…) từ text hiển thị.
 * Namespace `AVJP.metrics` cho content script (Node test qua module.exports).
 * (2.11.15) Thay 3 bản sao parseMetricNumber từng nằm riêng trong
 * accounts-scanner của Instagram/TikTok/X: bản cũ chỉ hiểu hậu tố kmb kiểu
 * Anh và đọc sai định dạng Việt (1,2K → 12000 thay vì 1200, 2,5 Tr → 25,
 * 1.234 → 1). Bản này hiểu cả nghìn/ngàn/tr/triệu/tỷ/tỉ + dấu ngăn nghìn.
 * Nạp TRƯỚC accounts-scanner qua contract (chỉ task scan_account của
 * instagram/tiktok/x). Test: tests/metrics.test.js.
 * dropEmptyChunks: khử đoạn rỗng cho splitTextIntoChunks (threads/x
 * automator hiện tự lọc ngay trong hàm — giữ helper ở đây cho test). */
(function (root) {
  const UNITS = [
    ['nghìn', 1e3], ['ngàn', 1e3], ['triệu', 1e6], ['tỷ', 1e9], ['tỉ', 1e9],
    ['tr', 1e6], ['k', 1e3], ['m', 1e6], ['b', 1e9], ['n', 1e3]
  ];
  const RE = new RegExp('(\\d[\\d.,]*)\\s*(' + UNITS.map(u => u[0]).join('|') + ')?(?![\\p{L}])', 'u');

  function parseMetricNumber(input) {
    if (input == null) return null;
    const s = String(input).trim().toLowerCase().replace(/ /g, ' ');
    const m = s.match(RE);
    if (!m) return null;
    const digits = m[1].replace(/[.,]+$/, '');
    const unit = m[2] ? UNITS.find(u => u[0] === m[2])[1] : 1;
    let n;
    const seps = digits.match(/[.,]/g) || [];
    if (!seps.length) n = Number(digits);
    else if (!m[2] && /^\d{1,3}([.,]\d{3})+$/.test(digits)) n = Number(digits.replace(/[.,]/g, ''));   // 1.234 / 1,234,567
    else if (seps.includes('.') && seps.includes(',')) {                                              // 1.234,5
      const dec = digits.lastIndexOf('.') > digits.lastIndexOf(',') ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      n = Number(digits.split(thou).join('').replace(dec, '.'));
    } else if (seps.length > 1) n = Number(digits.replace(/[.,]/g, ''));                              // 1.234.567
    else n = Number(digits.replace(',', '.'));                                                        // 1,2 / 12.5
    if (!Number.isFinite(n)) return null;
    return Math.round(n * unit);
  }

  // Bọc ngoài splitTextIntoChunks gốc: bỏ đoạn rỗng (fix 1 dòng ngay trong hàm gốc: `return chunks.filter(c => c.trim())`).
  function dropEmptyChunks(chunks) { return chunks.map(c => c.trim()).filter(Boolean); }

  const api = { parseMetricNumber, dropEmptyChunks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.AVJP = root.AVJP || {}).metrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
