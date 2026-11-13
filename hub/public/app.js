/* Auto vjp Hub — trang quản lý. Mọi dữ liệu hiển thị đều đi qua textContent. */
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var flashTimer = null;

  function api(name, body) {
    return fetch('api/admin/' + name, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && name !== 'login') { showLogin(); throw new Error('Phiên đăng nhập đã hết.'); }
        if (!res.ok) throw new Error(data.error || ('Lỗi HTTP ' + res.status));
        return data;
      });
    });
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'class') node.className = props[key];
      else if (key === 'text') node.textContent = props[key];
      else if (key === 'onclick') node.addEventListener('click', props[key]);
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }
  function flash(text, bad) {
    var box = $('flash');
    box.textContent = text;
    box.className = 'flash' + (bad ? ' bad' : '');
    box.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { box.hidden = true; }, 6000);
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function ago(ts) {
    if (!ts) return 'chưa lần nào';
    var s = Math.max(0, Math.round((state.now - ts) / 1000));
    if (s < 90) return 'vừa xong';
    if (s < 3600) return Math.round(s / 60) + ' phút trước';
    if (s < 86400) return Math.round(s / 3600) + ' giờ trước';
    return Math.round(s / 86400) + ' ngày trước';
  }
  var STATUS = {
    queued: ['Chờ giao', ''], claimed: ['Đã giao, đang làm', 'warn'], success: ['Xong', 'ok'],
    failed: ['Thất bại', 'bad'], uncertain: ['Không chắc', 'warn'], skipped: ['Bỏ qua', ''],
    cancelled: ['Đã huỷ', ''], retrying: ['Đang thử lại', 'warn']
  };
  function chip(status) {
    var meta = STATUS[status] || [status || '—', ''];
    return el('span', { class: 'chip ' + meta[1], text: meta[0] });
  }
  function profileName(id) {
    var p = (state.profiles || []).filter(function (x) { return x.id === id; })[0];
    return p ? (p.name || p.id) : id;
  }
  function act(name, body, okText) {
    return api(name, body).then(function () { if (okText) flash(okText); return refresh(); })
      .catch(function (err) { flash(err.message, true); });
  }

  /* ---------- Profile ---------- */
  function accountList(accounts) {
    if (!accounts || !accounts.length) return el('p', { class: 'muted', text: 'Chưa quét được tài khoản nào trong profile này.' });
    return el('ul', { class: 'accounts' }, accounts.map(function (a) {
      return el('li', { text: a.platform + ': ' + (a.username || a.name || '?') });
    }));
  }
  function pendingCard(p, approved) {
    var nameInput = el('input', { placeholder: 'Đặt tên, vd "Máy 2 – nick bán hàng"', 'aria-label': 'Tên profile' });
    var replace = el('select', { 'aria-label': 'Thay cho profile cũ' }, [el('option', { value: '', text: 'Là profile mới' })].concat(
      approved.map(function (old) { return el('option', { value: old.id, text: 'Thay cho: ' + (old.name || old.id) }); })));
    return el('div', { class: 'card profile' }, [
      el('h3', {}, [document.createTextNode('Profile mới'), el('span', { class: 'chip warn', text: 'Chờ duyệt' })]),
      el('code', { text: p.id }),
      el('p', { class: 'muted', text: 'Báo danh ' + ago(p.created_at) + ' · bản ' + (p.version || '?') }),
      accountList(p.accounts),
      el('div', { class: 'actions' }, [nameInput, approved.length ? replace : null]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'primary', text: 'Duyệt', onclick: function () {
          act('approve', { id: p.id, name: nameInput.value, replace_id: replace.value || undefined }, 'Đã duyệt profile.');
        } }),
        el('button', { class: 'danger', text: 'Xoá', onclick: function () {
          if (confirm('Xoá yêu cầu báo danh này?')) act('remove', { id: p.id });
        } })
      ])
    ]);
  }
  function profileCard(p) {
    var queued = state.tasks.filter(function (t) { return t.profile_id === p.id && t.status === 'queued'; }).length;
    var live = p.status === 'revoked' ? el('span', { class: 'chip bad', text: 'Đã thu hồi' })
      : p.online ? el('span', { class: 'chip ok', text: p.busy ? 'Đang chạy việc' : 'Đang mở' })
      : el('span', { class: 'chip', text: 'Đang tắt' });
    return el('div', { class: 'card profile' }, [
      el('h3', {}, [document.createTextNode(p.name || '(chưa đặt tên)'), live,
        p.accept || p.status === 'revoked' ? null : el('span', { class: 'chip warn', text: 'Tạm dừng nhận việc' })]),
      el('code', { text: p.id }),
      el('p', { class: 'muted', text: 'Lần cuối thấy: ' + ago(p.last_seen_at) + ' · bản ' + (p.version || '?') + ' · ' + queued + ' việc chờ' }),
      p.conflict_at ? el('p', { class: 'error', text: 'Cảnh báo: có vẻ hai nơi đang dùng chung ID này (thư mục profile bị sao chép?). Trên bản sao, bấm "Đăng ký lại" trong extension. Đổi tên profile để tắt cảnh báo.' }) : null,
      accountList(p.accounts),
      el('div', { class: 'actions' }, [
        el('button', { text: 'Đổi tên', onclick: function () {
          var name = prompt('Tên mới cho profile:', p.name || '');
          if (name) act('rename', { id: p.id, name: name });
        } }),
        p.status === 'approved' ? el('button', { class: 'danger', text: 'Thu hồi quyền', onclick: function () {
          if (confirm('Thu hồi quyền của "' + (p.name || p.id) + '"? Profile sẽ ngừng nhận việc; việc đang chờ bị huỷ.')) act('revoke', { id: p.id }, 'Đã thu hồi.');
        } }) : null,
        el('button', { class: 'danger', text: 'Xoá', onclick: function () {
          if (confirm('Xoá hẳn "' + (p.name || p.id) + '" cùng toàn bộ việc và kết quả của nó?')) act('remove', { id: p.id }, 'Đã xoá.');
        } })
      ])
    ]);
  }

  /* ---------- Việc ---------- */
  function fillSelect(select, options, keep) {
    var current = keep ? select.value : '';
    select.textContent = '';
    options.forEach(function (o) { select.appendChild(el('option', { value: o[0], text: o[1] })); });
    if (current && options.some(function (o) { return o[0] === current; })) select.value = current;
  }
  function syncTaskForm() {
    var form = $('taskForm');
    var approved = state.profiles.filter(function (p) { return p.status === 'approved'; });
    fillSelect(form.profile, approved.map(function (p) { return [p.id, p.name || p.id]; }), true);
    fillSelect(form.platform, Object.keys(state.types).map(function (p) { return [p, p]; }), true);
    fillSelect(form.type, (state.types[form.platform.value] || []).map(function (t) { return [t, t]; }), true);
    syncFacebook();
  }
  // Việc Facebook: chọn mẫu cấu hình mà profile đã báo lên (lịch tạo trong popup),
  // ô JSON khi đó là "config" của tính năng.
  function fbTemplates() {
    var form = $('taskForm');
    var p = state.profiles.filter(function (x) { return x.id === form.profile.value; })[0];
    return { profile: p, list: (p && p.fb_templates) || [] };
  }
  function syncFacebook() {
    var form = $('taskForm');
    var isFb = form.platform.value === 'facebook';
    $('fbRow').hidden = !isFb;
    $('fbHint').hidden = !isFb;
    $('contentLabel').hidden = isFb;
    form.extra.rows = isFb ? 10 : 3;
    $('extraLabel').textContent = isFb
      ? 'Cấu hình tính năng (JSON "config" — chọn mẫu ở trên để điền sẵn, sửa được trước khi giao)'
      : 'Trường khác (JSON, tuỳ loại việc — xem modules/MODULE-CONTRACT.md)';
    if (!isFb) return;
    var t = fbTemplates();
    fillSelect(form.fb_template, [['', t.list.length ? '— chọn mẫu —' : '(profile này chưa có mẫu)']].concat(
      t.list.map(function (item, i) { return [String(i), item.label + ' (' + item.feature + ')']; })), true);
    fillSelect(form.fb_feature, (state.fb_features || []).map(function (f) { return [f, f]; }), true);
    $('fbHint').textContent = !t.profile ? ''
      : !t.profile.fb_available ? 'Profile này chưa báo có lõi Facebook (extension bản cũ?).'
      : t.list.length ? 'Mẫu lấy từ các lịch bạn đã tạo trong tab Lịch của popup trên profile này.'
      : 'Để có mẫu: trên profile đó, mở popup, cấu hình tính năng rồi bấm hẹn lịch một lần. Mẫu sẽ hiện ở đây sau lần đồng bộ kế tiếp.';
  }
  function taskRow(t) {
    var buttons = [];
    if (t.status === 'queued') buttons.push(el('button', { text: 'Huỷ', onclick: function () { act('cancelTask', { id: t.id }); } }));
    else buttons.push(el('button', { text: 'Giao lại', onclick: function () {
      if (confirm('Tạo một việc mới giống việc này và giao ngay?')) act('requeueTask', { id: t.id }, 'Đã giao lại.');
    } }));
    var label = t.payload.platform + ' / ' + t.payload.type + (t.repeat === 'daily' ? ' (hằng ngày)' : '');
    var summary = String(t.payload.label || t.payload.feature || t.payload.content || t.payload.target_url || t.payload.source_url || '').slice(0, 80);
    return el('tr', {}, [
      el('td', { class: 'nowrap', text: fmtTime(t.run_at) }),
      el('td', { text: profileName(t.profile_id) }),
      el('td', {}, [el('div', { text: label }), summary ? el('div', { class: 'muted', text: summary }) : null]),
      el('td', {}, [chip(t.status)]),
      el('td', { class: 'note', text: t.message || '' }),
      el('td', { class: 'nowrap' }, buttons)
    ]);
  }
  function resultRow(r) {
    return el('tr', {}, [
      el('td', { class: 'nowrap', text: fmtTime(r.received_at) }),
      el('td', { text: profileName(r.profile_id) }),
      el('td', { text: r.platform + ' / ' + r.type }),
      el('td', { text: r.origin === 'remote' ? 'Từ hub' : 'Tại chỗ' }),
      el('td', {}, [chip(r.status)]),
      el('td', { class: 'note', text: r.message || '' })
    ]);
  }

  function render() {
    $('who').textContent = state.user.username;
    var pending = state.profiles.filter(function (p) { return p.status === 'pending'; });
    var mine = state.profiles.filter(function (p) { return p.status !== 'pending'; });
    var approved = mine.filter(function (p) { return p.status === 'approved'; });
    $('pendingCount').hidden = !pending.length;
    $('pendingCount').textContent = pending.length;
    $('pendingEmpty').hidden = pending.length > 0;
    $('profilesEmpty').hidden = mine.length > 0;
    // Không vẽ lại thẻ chờ duyệt khi người dùng đang gõ tên.
    if (!$('pendingList').contains(document.activeElement)) {
      $('pendingList').replaceChildren.apply($('pendingList'), pending.map(function (p) { return pendingCard(p, approved); }));
    }
    $('profileList').replaceChildren.apply($('profileList'), mine.map(profileCard));
    syncTaskForm();
    var tbody = $('taskTable').tBodies[0];
    tbody.replaceChildren.apply(tbody, state.tasks.map(taskRow));
    $('taskTable').hidden = !state.tasks.length;
    $('tasksEmpty').hidden = state.tasks.length > 0;
    var rbody = $('resultTable').tBodies[0];
    rbody.replaceChildren.apply(rbody, state.results.map(resultRow));
    $('resultTable').hidden = !state.results.length;
    $('resultsEmpty').hidden = state.results.length > 0;
  }

  function refresh() {
    return api('state').then(function (data) {
      state = data;
      $('loginView').hidden = true;
      $('appView').hidden = false;
      render();
    }).catch(function (err) {
      // 401 đã chuyển về màn hình đăng nhập; lỗi khác lúc mới mở trang cũng về đó.
      if (!state) { showLogin(); $('loginError').textContent = /Phiên/.test(err.message) ? '' : err.message; }
    });
  }
  function showLogin() {
    $('appView').hidden = true;
    $('loginView').hidden = false;
  }

  $('loginForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target;
    $('loginError').textContent = '';
    api('login', { username: form.username.value, password: form.password.value })
      .then(function () { form.password.value = ''; return refresh(); })
      .catch(function (err) { $('loginError').textContent = err.message; });
  });
  $('logout').addEventListener('click', function () { api('logout').then(showLogin, showLogin); });
  $('tabs').addEventListener('click', function (event) {
    var tab = event.target.closest('button[data-tab]');
    if (!tab) return;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b === tab); });
    document.querySelectorAll('main > section').forEach(function (s) { s.hidden = s.dataset.view !== tab.dataset.tab; });
  });
  $('taskForm').platform.addEventListener('change', syncTaskForm);
  $('taskForm').profile.addEventListener('change', syncFacebook);
  $('taskForm').fb_template.addEventListener('change', function () {
    var form = $('taskForm');
    var item = fbTemplates().list[Number(form.fb_template.value)];
    if (!item || form.fb_template.value === '') return;
    form.fb_feature.value = item.feature;
    form.extra.value = JSON.stringify(item.config, null, 2);
  });
  $('taskForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target;
    var payload = {};
    if (form.extra.value.trim()) {
      try { payload = JSON.parse(form.extra.value); } catch (err) { return flash('Ô "Trường khác" không phải JSON hợp lệ.', true); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return flash('Ô "Trường khác" phải là một object JSON.', true);
    }
    if (form.platform.value === 'facebook') {
      var chosen = fbTemplates().list[Number(form.fb_template.value)];
      payload = { feature: form.fb_feature.value, config: payload, label: chosen && form.fb_template.value !== '' ? chosen.label : form.fb_feature.value };
    } else if (form.content.value.trim()) payload.content = form.content.value;
    payload.platform = form.platform.value;
    payload.type = form.type.value;
    var runAt = form.run_at.value ? new Date(form.run_at.value).getTime() : 0;
    api('createTask', { profile_id: form.profile.value, payload: payload, run_at: runAt, repeat: form.daily.checked ? 'daily' : null })
      .then(function () { form.content.value = ''; flash('Đã giao việc.'); return refresh(); })
      .catch(function (err) { flash(err.message, true); });
  });

  refresh();
  setInterval(function () { if (!$('appView').hidden && !document.hidden) refresh(); }, 10000);
})();
