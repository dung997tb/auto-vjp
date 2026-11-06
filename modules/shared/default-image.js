// Auto vjp — ẢNH MẶC ĐỊNH của riêng Auto vjp cho bài không có ảnh
// (2.11.7, FORK-CHANGES #98). Namespace `AVJP.defaultImage` cho content
// script, nạp TRƯỚC automator trong contract (scripts() type 'post' của
// instagram/threads/x). Thay fallback cũ trỏ tới host bên thứ ba
// (moigioi.pages.dev — asset sót từ code gốc): từ nay ảnh mặc định là
// asset gói sẵn trong extension, không gọi ra ngoài.
//
// resolveDefaultImageUrl():
//   (a) storage sync có key `autovjpDefaultImageUrl` khác rỗng (tuỳ chọn
//       người dùng tự đặt ở trang quản lý — thẻ "Vận hành local") -> URL đó;
//   (b) không có -> chrome.runtime.getURL('assets/default-preview.png').
// URL trả về đi vào đúng pipeline nạp ảnh hiện tại của automator
// (fetchImage/mediaFetch qua service worker -> blob/File). Asset gói sẵn
// được khai trong manifest web_accessible_resources để trang MXH cũng
// fetch trực tiếp được khi cần.
// Module không thấy AVJP.defaultImage (inject cũ/thiếu file) phải tự rơi
// về chrome.runtime.getURL('assets/default-preview.png').
(() => {
  window.AVJP = window.AVJP || {};
  if (window.AVJP.defaultImage) return;

  const STORAGE_KEY = 'autovjpDefaultImageUrl';
  const BUILTIN_PATH = 'assets/default-preview.png';

  async function resolveDefaultImageUrl() {
    try {
      const s = await chrome.storage.sync.get([STORAGE_KEY]);
      const custom = String((s && s[STORAGE_KEY]) || '').trim();
      if (custom) return custom;
    } catch (e) { /* storage chưa sẵn sàng -> dùng ảnh gói sẵn */ }
    return chrome.runtime.getURL(BUILTIN_PATH);
  }

  window.AVJP.defaultImage = { resolveDefaultImageUrl, STORAGE_KEY, BUILTIN_PATH };
})();
