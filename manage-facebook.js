/* Auto vjp — manage-facebook.js (2.13.0)
 * View "Facebook" trên trang quản lý: chọn một mẫu cấu hình (lịch đã tạo trong
 * popup), sửa nếu cần, rồi đưa vào hàng đợi kernel dưới dạng task fb_feature.
 * Thi hành do modules/kernel/fbtask.js chuyển cho lõi Facebook.
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

  function init() {
    var templateSel = document.getElementById('fbTemplate');
    var featureSel = document.getElementById('fbFeature');
    var configBox = document.getElementById('fbConfig');
    var runBtn = document.getElementById('fbRun');
    var reloadBtn = document.getElementById('fbReload');
    var messageEl = document.getElementById('fbMessage');
    if (!templateSel || !featureSel || !configBox || !runBtn) return;
    var templates = [];

    function option(value, text) {
      var o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    }

    async function load() {
      var res = await send({ action: 'autovjp.fbTemplates' });
      if (!res || !res.success) { messageEl.textContent = 'Lỗi: ' + ((res && res.error) || 'không tải được mẫu'); return; }
      templates = res.templates || [];
      var keepFeature = featureSel.value;
      templateSel.textContent = '';
      templateSel.appendChild(option('', templates.length ? '— chọn mẫu —' : '(chưa có mẫu nào)'));
      templates.forEach(function (t, i) { templateSel.appendChild(option(String(i), t.label + ' (' + t.feature + ')')); });
      featureSel.textContent = '';
      (res.features || []).forEach(function (f) { featureSel.appendChild(option(f, f)); });
      if (keepFeature) featureSel.value = keepFeature;
      runBtn.disabled = !res.available;
      messageEl.textContent = res.available ? '' : 'Lõi Facebook không khả dụng trong phiên này.';
    }

    templateSel.addEventListener('change', function () {
      var t = templates[Number(templateSel.value)];
      if (templateSel.value === '' || !t) return;
      featureSel.value = t.feature;
      configBox.value = JSON.stringify(t.config, null, 2);
    });

    runBtn.addEventListener('click', async function () {
      var config;
      try { config = JSON.parse(configBox.value || '{}'); } catch (err) { messageEl.textContent = 'Cấu hình không phải JSON hợp lệ.'; return; }
      if (!config || typeof config !== 'object' || Array.isArray(config)) { messageEl.textContent = 'Cấu hình phải là một object JSON.'; return; }
      var chosen = templates[Number(templateSel.value)];
      var label = templateSel.value !== '' && chosen ? chosen.label : featureSel.value;
      runBtn.disabled = true;
      messageEl.textContent = 'Đang đưa vào hàng đợi…';
      var res = await send({ action: 'autovjp.createTask', task: { platform: 'facebook', type: 'fb_feature', feature: featureSel.value, label: label, config: config } });
      runBtn.disabled = false;
      messageEl.textContent = res && res.success
        ? 'Đã đưa "' + label + '" vào hàng đợi. Nếu đang có tính năng Facebook khác chạy, việc này sẽ chờ tới lượt.'
        : 'Bị từ chối: ' + ((res && res.error) || 'lỗi không rõ');
    });
    if (reloadBtn) reloadBtn.addEventListener('click', load);
    // Tải khi mở view (và một lần lúc nạp trang).
    document.querySelectorAll('[data-nav-target="facebook"]').forEach(function (btn) { btn.addEventListener('click', load); });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
