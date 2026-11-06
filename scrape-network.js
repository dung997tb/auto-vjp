// scrape-network.js - read-only page-world observer for scraped video sources.
// It only watches PerformanceResourceTiming entries and visible <video> src —
// it never touches fetch/XHR payloads, cookies, tokens or GraphQL bodies. Video
// URLs found are forwarded to the isolated scrape.js via window.postMessage so
// the user can download them later from the data library.
(() => {
  const INSTALL_KEY = "__fbAutoScrapeNetworkInstalled";
  const SOURCE = "fb-auto-scrape-network";
  if (window[INSTALL_KEY]) return;
  try { Object.defineProperty(window, INSTALL_KEY, { value: true, configurable: false }); } catch (_) { return; }

  const seen = new Set();
  const publish = payload => { try { window.postMessage({ source: SOURCE, ...payload }, "*"); } catch (_) {} };

  const maybeVideoUrl = name => {
    if (!name || typeof name !== "string") return "";
    const clean = String(name).split("#")[0];
    if (!/^https?:\/\//i.test(clean)) return "";
    // Ảnh scontent cũng có dạng fbcdn.../t39...+oe/oh nên phải loại trước,
    // không thì kho "video" toàn ảnh (đã từng xảy ra: 158 dòng video, 0 mp4).
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test(clean)) return "";
    if (/\.(mp4|m4v|webm)(\?|$)/i.test(clean)) return clean;
    if (/fbcdn\.net\/[^?]*\/t\d+/i.test(clean) && /[?&](oe|oh|_nc_ht)=/i.test(clean)) return clean;
    return "";
  };

  const push = name => {
    const url = maybeVideoUrl(name);
    if (!url || seen.has(url)) return;
    seen.add(url);
    publish({ kind: "video-url", url, at: Date.now() });
  };

  try {
    if (typeof PerformanceObserver === "function") {
      const observer = new PerformanceObserver(list => {
        try { list.getEntries().forEach(entry => push(entry.name)); } catch (_) {}
      });
      observer.observe({ type: "resource", buffered: true });
      try { performance.getEntriesByType("resource").forEach(entry => push(entry.name)); } catch (_) {}
    }
  } catch (_) {}

  const scanDom = () => {
    try {
      document.querySelectorAll("video[src], video source[src]").forEach(v => push(v.src || v.getAttribute("src") || ""));
    } catch (_) {}
  };
  setInterval(scanDom, 3000);
})();
