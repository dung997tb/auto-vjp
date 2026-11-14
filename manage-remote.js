/* Auto vjp — manage-remote.js (2.12.0)
 * Thẻ "Kết nối máy chủ" trên trang quản lý: nhập địa chỉ hub, xem trạng thái
 * ghép nối, bật/tắt nhận việc từ xa, ngắt kết nối. Toàn bộ logic nằm ở kernel
 * (modules/kernel/remote.js); file này chỉ gọi các lệnh autovjp.remote*.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  function send(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(response || { success: false, error: 'Không nhận được phản hồi từ kernel' });
        });
      } catch (err) {
        resolve({ success: false, error: String((err && err.message) || err) });
      }
    });
  }

  var STATUS_TEXT = {
    off: 'Chưa kết nối',
    unregistered: 'Đang báo danh…',
    pending: 'Chờ duyệt trên web',
    approved: 'Đã kết nối',
    revoked: 'Đã bị thu hồi',
    id_conflict: 'Trùng ID'
  };

  function init() {
    var el = function (id) { return document.getElementById(id); };
    var urlInput = el('remoteUrl');
    if (!urlInput) return;
    var statusEl = el('remoteStatus');
    var busy = false;

    function ago(ts) {
      if (!ts) return 'chưa lần nào';
      var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 60) return s + ' giây trước';
      if (s < 3600) return Math.round(s / 60) + ' phút trước';
      return Math.round(s / 3600) + ' giờ trước';
    }

    function render(r) {
      if (!r) return;
      el('remoteProfileId').textContent = r.profileId || '…';
      el('remoteName').textContent = r.name ? '— tên trên máy chủ: ' + r.name : '';
      el('remoteBadge').textContent = STATUS_TEXT[r.status] || r.status;
      el('remoteAccept').checked = Boolean(r.accept);
      el('remoteAutoScan').checked = r.autoScan !== false;
      el('remoteAutoScan').disabled = r.status === 'off';
      if (document.activeElement !== urlInput) urlInput.value = r.url || '';
      var connected = r.status !== 'off';
      el('remoteSync').disabled = !connected;
      el('remoteDisconnect').disabled = !connected;
      el('remoteAccept').disabled = !connected;
      var pill = el('remotePillText');
      if (pill) {
        pill.textContent = r.status === 'approved'
          ? (r.accept ? 'Đang nhận việc từ máy chủ' : 'Máy chủ: tạm dừng nhận việc')
          : (connected ? 'Máy chủ: ' + (STATUS_TEXT[r.status] || r.status).toLowerCase() : 'Không dùng máy chủ');
      }
      var lines = [];
      if (r.status === 'pending') lines.push('Profile đã báo danh. Mở web quản lý, vào mục Profile và bấm Duyệt.');
      if (r.status === 'revoked') lines.push('Máy chủ đã thu hồi quyền của profile này. Bấm "Đăng ký lại" nếu muốn nối lại như profile mới.');
      if (connected) lines.push('Lần đồng bộ gần nhất: ' + ago(r.lastSyncAt) + (r.pendingReports ? ' · ' + r.pendingReports + ' kết quả chờ gửi' : ''));
      if (r.lastError) lines.push('Lỗi: ' + r.lastError);
      if (r.url && /^http:\/\//i.test(r.url)) lines.push('Đang dùng http:// (không mã hoá). Nên dùng https://.');
      statusEl.textContent = lines.join(' — ');
    }

    async function act(message, confirmText) {
      if (busy) return;
      if (confirmText && !window.confirm(confirmText)) return;
      busy = true;
      statusEl.textContent = 'Đang xử lý…';
      try {
        var res = await send(message);
        if (res && res.success) render(res.remote);
        else statusEl.textContent = 'Lỗi: ' + ((res && res.error) || 'không rõ');
      } finally {
        busy = false;
      }
    }

    el('remoteConnect').addEventListener('click', function () {
      act({ action: 'autovjp.remoteConfigure', url: urlInput.value });
    });
    el('remoteSync').addEventListener('click', function () { act({ action: 'autovjp.remoteSyncNow' }); });
    el('remoteAccept').addEventListener('change', function () {
      act({ action: 'autovjp.remoteSetAccept', accept: el('remoteAccept').checked });
    });
    el('remoteAutoScan').addEventListener('change', function () {
      act({ action: 'autovjp.remoteSetAutoScan', enabled: el('remoteAutoScan').checked });
    });
    el('remoteDisconnect').addEventListener('click', function () {
      act({ action: 'autovjp.remoteDisconnect' }, 'Ngắt kết nối máy chủ? Profile sẽ ngừng nhận việc từ xa và ngừng gửi kết quả. Việc đang trong hàng đợi vẫn chạy.');
    });
    el('remoteReRegister').addEventListener('click', function () {
      act({ action: 'autovjp.remoteReRegister' }, 'Sinh ID mới và báo danh lại? Trên web, profile này sẽ hiện như một profile mới chờ duyệt.');
    });

    async function refresh() {
      if (busy) return;
      var res = await send({ action: 'autovjp.remoteState' });
      if (res && res.success) render(res.remote);
    }
    refresh();
    setInterval(refresh, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
