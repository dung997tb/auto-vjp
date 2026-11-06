// overnight.js — cầu heartbeat độc lập cho giám sát "Chạy xuyên đêm".
// Chỉ báo hiệu tab Facebook này còn sống (document còn tồn tại, extension
// context còn hợp lệ). Không đọc/ghi state, counter hay proof của bất kỳ
// feature nào — background.js tự quyết định có dùng tín hiệu này hay không
// (chỉ áp dụng cho tab đang là ownerTabId của một chuỗi đang "running").
(function () {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;
  const HEARTBEAT_MS = 15000;
  function beat() {
    try {
      chrome.runtime.sendMessage({ action: "overnightHeartbeat" }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) { }
  }
  beat();
  setInterval(beat, HEARTBEAT_MS);
})();
