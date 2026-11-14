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
      var who = a.name && a.username && a.name !== a.username ? a.name + ' (@' + a.username + ')' : (a.name || a.username || '?');
      return el('li', { text: (PLATFORM_LABEL[a.platform] || a.platform) + (a.kind === 'page' ? ' Page' : '') + ': ' + who + (a.followers !== null && a.followers !== undefined ? ' · ' + fmtCount(a.followers) : '') });
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
      (p.tags || []).length ? el('p', { class: 'muted', text: 'Nhóm: ' + p.tags.join(', ') }) : null,
      p.status === 'approved' ? gemControls(p) : null,
      el('div', { class: 'actions' }, [
        p.status === 'approved' ? el('button', { text: 'Quét nick', onclick: function () {
          act('scanProfile', { id: p.id }, 'Đã giao việc quét nick cho "' + (p.name || p.id) + '". Kết quả hiện sau khi profile chạy xong.');
        } }) : null,
        el('button', { text: 'Nhóm', onclick: function () {
          var value = prompt('Nhóm của profile này (cách nhau bằng dấu phẩy), dùng để giao việc theo nhóm:', (p.tags || []).join(', '));
          if (value !== null) act('setTags', { id: p.id, tags: value.split(',') });
        } }),
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

  /* ---------- Giao nhanh ---------- */
  var openBatches = {};
  function radio(name) {
    var el0 = document.querySelector('input[name=' + name + ']:checked');
    return el0 ? el0.value : '';
  }
  function approvedProfiles() { return state.profiles.filter(function (p) { return p.status === 'approved'; }); }
  function nickPlatformsOf(p) {
    var out = [];
    (p.accounts || []).forEach(function (a) { if (a.kind !== 'page' && out.indexOf(a.platform) < 0) out.push(a.platform); });
    return out;
  }
  function quickTargetProfiles() {
    var value = $('quickForm').target.value;
    var list = approvedProfiles();
    if (value.indexOf('tag:') === 0) return list.filter(function (p) { return (p.tags || []).indexOf(value.slice(4)) >= 0; });
    if (value.indexOf('one:') === 0) return list.filter(function (p) { return p.id === value.slice(4); });
    return list;
  }
  function quickPlatformFilter() {
    var boxes = $('quickPlatforms').querySelectorAll('input');
    var picked = Array.prototype.filter.call(boxes, function (i) { return i.checked; }).map(function (i) { return i.value; });
    return picked.length === boxes.length ? null : picked;
  }
  function syncQuick() {
    var form = $('quickForm');
    var approved = approvedProfiles();
    var tags = [];
    approved.forEach(function (p) { (p.tags || []).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); }); });
    tags.sort();
    fillSelect(form.target, [['all', 'Tất cả (' + approved.length + ' profile)']]
      .concat(tags.map(function (t) { return ['tag:' + t, 'Nhóm: ' + t]; }))
      .concat(approved.map(function (p) { return ['one:' + p.id, 'Chỉ: ' + (p.name || p.id)]; })), true);
    fillSelect(form.level, Object.keys(state.levels || {}).map(function (k) { return [k, state.levels[k]]; }), true);
    if (!form.level.dataset.init && state.levels && state.levels.medium) { form.level.value = 'medium'; form.level.dataset.init = '1'; }
    var platforms = Object.keys(state.types);
    var box = $('quickPlatforms');
    if (box.getAttribute('data-sig') !== platforms.join('|')) {
      box.setAttribute('data-sig', platforms.join('|'));
      box.replaceChildren.apply(box, platforms.map(function (p) {
        var input = el('input', { type: 'checkbox', value: p });
        input.checked = true;
        return el('label', {}, [input, document.createTextNode(PLATFORM_LABEL[p] || p)]);
      }));
    }
    var intent = radio('intent'), when = radio('when');
    $('quickLevelWrap').hidden = intent !== 'nurture';
    $('quickTimeRow').hidden = when === 'now';
    $('quickDailyWrap').hidden = when !== 'daily';
    $('quickOnceWrap').hidden = when !== 'once';
    // Xem trước: sẽ giao bao nhiêu việc cho bao nhiêu nick.
    var only = quickPlatformFilter();
    var targets = quickTargetProfiles();
    var tasks = 0, profiles = 0, noNick = 0;
    targets.forEach(function (p) {
      var list = intent === 'scan'
        ? platforms.filter(function (pl) { return state.types[pl].indexOf('scan_account') >= 0; })
        : nickPlatformsOf(p).filter(function (pl) { return pl === 'facebook' ? p.fb_available : (state.types[pl] || []).indexOf('nurture') >= 0; });
      if (only) list = list.filter(function (pl) { return only.indexOf(pl) >= 0; });
      if (list.length) { tasks += list.length; profiles++; } else noNick++;
    });
    $('quickPreview').textContent = !targets.length ? 'Chưa có profile nào đã duyệt.'
      : intent === 'scan' ? 'Sẽ quét ' + tasks + ' lượt trên ' + profiles + ' profile.'
      : 'Sẽ nuôi ' + tasks + ' nick trên ' + profiles + ' profile.' + (noNick ? ' ' + noNick + ' profile chưa có nick (quét trước).' : '');
  }
  function countChips(items) {
    var counts = {};
    items.forEach(function (i) { counts[i.status] = (counts[i.status] || 0) + 1; });
    return ['success', 'claimed', 'queued', 'failed', 'uncertain', 'skipped', 'cancelled'].filter(function (s) { return counts[s]; }).map(function (s) {
      var meta = STATUS[s] || [s, ''];
      return el('span', { class: 'chip ' + meta[1], text: counts[s] + ' ' + meta[0].toLowerCase() });
    });
  }
  function nickNameFor(profile, platform) {
    var names = (profile ? profile.accounts || [] : []).filter(function (a) { return a.platform === platform && a.kind !== 'page'; })
      .map(function (a) { return a.username ? '@' + a.username : a.name; });
    return names.length ? names.join(', ') : '(chưa quét)';
  }
  function batchDetail(b) {
    var byId = {};
    state.profiles.forEach(function (p) { byId[p.id] = p; });
    var items = b.items.slice().sort(function (x, y) {
      return String((byId[x.profile_id] || {}).name).localeCompare(String((byId[y.profile_id] || {}).name)) || x.platform.localeCompare(y.platform);
    });
    if (radio('groupby') === 'profile') {
      var groups = {}, order = [];
      items.forEach(function (i) { if (!groups[i.profile_id]) { groups[i.profile_id] = []; order.push(i.profile_id); } groups[i.profile_id].push(i); });
      return el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Profile Chrome' }), el('th', { text: 'Từng nền tảng' }), el('th', { text: 'Chạy lúc' })])]),
        el('tbody', {}, order.map(function (pid) {
          var p = byId[pid];
          return el('tr', {}, [
            el('td', {}, [el('div', { text: p ? (p.name || p.id) : pid }), el('div', { class: 'muted', text: p ? (p.online ? 'đang mở' : 'đang tắt') : '' })]),
            el('td', {}, [el('div', { class: 'plat-chips' }, groups[pid].map(function (i) {
              var meta = STATUS[i.status] || [i.status, ''];
              var c = el('span', { class: 'chip ' + meta[1], text: (PLATFORM_LABEL[i.platform] || i.platform) + ': ' + meta[0].toLowerCase() });
              if (i.message) c.title = i.message;
              return c;
            }))]),
            el('td', { class: 'nowrap', text: fmtTime(groups[pid][0].run_at) })
          ]);
        }))
      ]);
    }
    return el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Nick' }), el('th', { text: 'Nền tảng' }), el('th', { text: 'Profile Chrome' }), el('th', { text: 'Chạy lúc' }), el('th', { text: 'Trạng thái' }), el('th', { text: 'Ghi chú' })])]),
      el('tbody', {}, items.map(function (i) {
        var p = byId[i.profile_id];
        return el('tr', {}, [
          el('td', { text: i.type === 'scan_account' ? '—' : nickNameFor(p, i.platform) }),
          el('td', { text: PLATFORM_LABEL[i.platform] || i.platform }),
          el('td', { text: p ? (p.name || p.id) : i.profile_id }),
          el('td', { class: 'nowrap', text: fmtTime(i.run_at) }),
          el('td', {}, [chip(i.status)]),
          el('td', { class: 'note', text: i.message || '' })
        ]);
      }))
    ]);
  }
  function batchCard(b) {
    var failed = b.items.filter(function (i) { return i.status === 'failed'; }).length;
    var queued = b.items.filter(function (i) { return i.status === 'queued'; }).length;
    var d = el('details', { class: 'card batch' }, [
      el('summary', {}, [el('strong', { text: b.label }), el('span', { class: 'muted', text: fmtTime(b.created_at) + ' · ' + b.items.length + ' việc' })].concat(countChips(b.items))),
      el('div', { class: 'body' }, [
        el('div', { class: 'row' }, [
          failed ? el('button', { text: 'Giao lại ' + failed + ' việc lỗi', onclick: function () { act('retryBatch', { id: b.id }, 'Đã giao lại phần lỗi.'); } }) : null,
          queued ? el('button', { class: 'danger', text: 'Huỷ ' + queued + ' việc chưa chạy' + (b.params && b.params.repeat ? ' (dừng lặp)' : ''), onclick: function () {
            if (confirm('Huỷ các việc chưa chạy của lần giao này?')) act('cancelBatch', { id: b.id }, 'Đã huỷ phần chưa chạy.');
          } }) : null
        ]),
        batchDetail(b)
      ])
    ]);
    d.open = Boolean(openBatches[b.id]);
    d.addEventListener('toggle', function () { openBatches[b.id] = d.open; });
    return d;
  }
  function renderBatches() {
    var list = state.batches || [];
    $('batchesEmpty').hidden = list.length > 0;
    $('batchList').replaceChildren.apply($('batchList'), list.map(batchCard));
  }

  /* ---------- Nick ---------- */
  function fmtCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '').replace('.', ',') + ' tr';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return String(n);
  }
  function allNicks() {
    var rows = [];
    state.profiles.forEach(function (p) {
      if (p.status === 'pending') return;
      (p.accounts || []).forEach(function (a) { rows.push({ profile: p, acc: a }); });
    });
    return rows;
  }
  function renderNicks() {
    var rows = allNicks();
    var platforms = [];
    rows.forEach(function (r) { if (platforms.indexOf(r.acc.platform) < 0) platforms.push(r.acc.platform); });
    platforms.sort();
    fillSelect($('nickPlatform'), [['', 'Tất cả']].concat(platforms.map(function (p) { return [p, PLATFORM_LABEL[p] || p]; })), true);
    $('nickSummary').replaceChildren.apply($('nickSummary'), platforms.map(function (p) {
      var n = rows.filter(function (r) { return r.acc.platform === p; }).length;
      return el('span', { text: (PLATFORM_LABEL[p] || p) + ': ' + n });
    }));
    var platform = $('nickPlatform').value;
    var query = $('nickSearch').value.trim().toLowerCase();
    var last = {};
    (state.last_results || []).forEach(function (r) { last[r.profile_id + '|' + r.platform] = r; });
    var shown = rows.filter(function (r) {
      if (platform && r.acc.platform !== platform) return false;
      if (!query) return true;
      return [r.acc.name, r.acc.username, r.profile.name, r.profile.id].join(' ').toLowerCase().indexOf(query) >= 0;
    });
    shown.sort(function (a, b) {
      return a.acc.platform.localeCompare(b.acc.platform) || String(a.profile.name).localeCompare(String(b.profile.name));
    });
    var tbody = $('nickTable').tBodies[0];
    tbody.replaceChildren.apply(tbody, shown.map(function (r) {
      var a = r.acc, lr = last[r.profile.id + '|' + a.platform];
      var stale = a.scanned_at && state.now - a.scanned_at > 3 * 86400 * 1000;
      return el('tr', {}, [
        el('td', { text: PLATFORM_LABEL[a.platform] || a.platform }),
        el('td', {}, [el('div', { text: a.name || a.username || '?' }), a.username && a.username !== a.name ? el('div', { class: 'muted', text: (a.kind === 'page' ? '' : '@') + a.username }) : null]),
        el('td', { text: a.kind === 'page' ? 'Page' : 'Nick' }),
        el('td', {}, [el('div', { text: r.profile.name || r.profile.id }),
          el('div', { class: 'muted', text: r.profile.status === 'revoked' ? 'đã thu hồi' : r.profile.online ? 'đang mở' : 'đang tắt' })]),
        el('td', { text: a.followers === null || a.followers === undefined ? '—' : fmtCount(a.followers) }),
        el('td', { class: 'nowrap' }, [document.createTextNode(a.scanned_at ? ago(a.scanned_at) : '—'), stale ? el('span', { class: 'chip warn', text: 'cũ' }) : null]),
        el('td', {}, lr ? [chip(lr.status), el('div', { class: 'muted', text: (TYPE_LABEL[lr.type] || lr.type) + ' · ' + ago(lr.received_at) })] : [document.createTextNode('—')])
      ]);
    }));
    $('nickTable').hidden = !shown.length;
    $('nicksEmpty').hidden = rows.length > 0;
  }

  /* ---------- GemLogin ---------- */
  // Chọn profile GemLogin tương ứng + bật tắt tự mở, ngay trên thẻ profile.
  function gemControls(p) {
    var launchers = state.launchers || [];
    if (!launchers.length) return null;
    var taken = {};
    state.profiles.forEach(function (x) { if (x.gem_id && x.id !== p.id) taken[x.launcher_id + '|' + x.gem_id] = true; });
    var select = el('select', { 'aria-label': 'Profile GemLogin' }, [el('option', { value: '', text: 'Chưa ghép GemLogin' })]);
    launchers.forEach(function (l) {
      l.gem_profiles.forEach(function (g) {
        var key = l.id + '|' + g.id;
        if (taken[key]) return;
        var o = el('option', { value: key, text: l.name + ' / ' + (g.name || g.id) });
        if (p.launcher_id === l.id && p.gem_id === g.id) o.selected = true;
        select.appendChild(o);
      });
    });
    select.addEventListener('change', function () {
      var parts = select.value.split('|');
      act('mapProfile', select.value ? { id: p.id, launcher_id: parts[0], gem_id: parts.slice(1).join('|') } : { id: p.id, launcher_id: null, gem_id: null },
        select.value ? 'Đã ghép với GemLogin.' : 'Đã bỏ ghép.');
    });
    var auto = el('input', { type: 'checkbox', 'aria-label': 'Tự mở khi có việc' });
    auto.checked = p.auto_start;
    auto.disabled = !p.gem_id;
    auto.addEventListener('change', function () { act('mapProfile', { id: p.id, auto_start: auto.checked }); });
    return el('div', {}, [
      el('div', { class: 'actions' }, [select, el('label', { class: 'check' }, [auto, document.createTextNode('Tự mở khi có việc')])]),
      p.launch_fail_at ? el('p', { class: 'error', text: 'Lần mở gần nhất (' + ago(p.launch_fail_at) + '): GemLogin đã mở profile nhưng extension không báo sống. Kiểm tra Auto vjp đã cài và nối hub trong profile này chưa. Hub sẽ thử lại sau 60 phút.' }) : null
    ]);
  }
  function launcherCard(l) {
    var mapped = state.profiles.filter(function (p) { return p.launcher_id === l.id; }).length;
    var d = l.discover;
    var notes = d && d.done ? d.done.map(function (x) {
      var g = l.gem_profiles.filter(function (y) { return y.id === x.gem_id; })[0];
      return el('li', { text: ((g && g.name) || x.gem_id) + ': ' + x.note });
    }) : [];
    return el('div', { class: 'card profile' }, [
      el('h3', {}, [document.createTextNode(l.name),
        el('span', { class: 'chip ' + (l.online ? 'ok' : ''), text: l.online ? 'Đang chạy' : 'Không thấy' }),
        l.online && !l.gem_ok ? el('span', { class: 'chip bad', text: 'GemLogin không phản hồi' }) : null]),
      el('p', { class: 'muted', text: 'Lần cuối thấy: ' + ago(l.last_seen_at) + ' · ' + l.gem_profiles.length + ' profile GemLogin · ' + mapped + ' đã ghép · ' + l.running.length + ' đang mở' }),
      l.last_error ? el('p', { class: 'error', text: l.last_error }) : null,
      d && d.active ? el('p', { text: 'Đang dò ghép' + (d.current ? ': đang mở thử một profile…' : '…') + ' (' + d.done.length + ' xong)' }) : null,
      notes.length ? el('ul', { class: 'accounts' }, notes) : null,
      el('div', { class: 'actions' }, [
        d && d.active
          ? el('button', { text: 'Dừng dò ghép', onclick: function () { act('discover', { id: l.id, active: false }); } })
          : el('button', { class: 'primary', text: 'Dò ghép tự động', onclick: function () {
              if (confirm('Launcher sẽ lần lượt mở từng profile GemLogin chưa ghép (mỗi cái tối đa khoảng 2,5 phút) để xem profile Auto vjp nào báo sống, rồi ghép hai bên. Trong lúc dò, không tự mở profile để làm việc. Bắt đầu?')) act('discover', { id: l.id }, 'Đã bắt đầu dò ghép.');
            } }),
        el('button', { class: 'danger', text: 'Xoá', onclick: function () {
          if (confirm('Xoá máy chạy "' + l.name + '"? Các profile đã ghép với nó sẽ bị bỏ ghép.')) act('removeLauncher', { id: l.id }, 'Đã xoá.');
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
  var TYPE_LABEL = {
    post: 'Đăng bài', story: 'Đăng Story', reply: 'Bình luận / trả lời', affiliate: 'Bình luận gắn link',
    nurture: 'Nuôi nick', upload: 'Tải video lên', scan_account: 'Quét tài khoản', healthscan: 'Quét sức khoẻ selector',
    micro_action: 'Hành động nhỏ', fb_feature: 'Tính năng Facebook'
  };
  var PLATFORM_LABEL = { instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', x: 'X (Twitter)', youtube: 'YouTube', facebook: 'Facebook' };

  // Trường nhập theo loại việc. kind: text | lines (mỗi dòng một mục -> mảng) | url | number | check | select.
  var F = {
    content: { key: 'content', label: 'Nội dung', kind: 'text', rows: 4 },
    comment: { key: 'content', label: 'Nội dung bình luận', kind: 'text', rows: 3 },
    images: { key: 'images', label: 'Ảnh theo URL (mỗi dòng một URL)', kind: 'lines' },
    video: { key: 'images', label: 'URL video (mỗi dòng một URL)', kind: 'lines' },
    source: { key: 'source_url', label: 'URL bài viết đích', kind: 'url', required: true },
    templates: { key: 'reply_templates', label: 'Mẫu trả lời (mỗi dòng một mẫu, chọn ngẫu nhiên)', kind: 'lines' },
    smart: { key: 'smart_reply_enabled', label: 'Trả lời thông minh bằng AI', kind: 'check' },
    aiPrompt: { key: 'ai_prompt', label: 'Prompt AI (tuỳ chọn)', kind: 'text', rows: 2 },
    visibility: { key: 'visibility', label: 'Chế độ hiển thị', kind: 'select', options: [['public', 'Công khai'], ['unlisted', 'Không công khai'], ['private', 'Riêng tư']] },
    watch: { key: 'watch_count', label: 'Số video xem', kind: 'number', value: 5, min: 1, max: 50 },
    maxActions: { key: 'max_actions', label: 'Số hành động tối đa', kind: 'number', value: 8, min: 1, max: 60 },
    maxMinutes: { key: 'max_minutes', label: 'Thời lượng tối đa (phút)', kind: 'number', value: 10, min: 2, max: 120 },
    likePct: { key: 'like_pct', label: 'Tỉ lệ thích (%)', kind: 'number', value: 80, min: 0, max: 100 },
    savePct: { key: 'save_pct', label: 'Tỉ lệ lưu (%)', kind: 'number', value: 50, min: 0, max: 100 },
    commentPct: { key: 'comment_pct', label: 'Tỉ lệ bình luận (%)', kind: 'number', value: 60, min: 0, max: 100 },
    query: { key: 'search_query', label: 'Từ khoá tìm video', kind: 'url', placeholder: 'vd: tin tức hôm nay' },
    cTemplates: { key: 'comment_templates', label: 'Mẫu bình luận dự phòng (mỗi dòng một mẫu)', kind: 'lines',
      value: 'Bài chia sẻ hay quá, cảm ơn bạn nhiều nhé!\nNội dung hữu ích, mình lưu lại để xem thêm.\nCảm ơn bạn đã chia sẻ!' }
  };
  function toggles(list) { return { kind: 'toggles', items: list }; }
  var T = {
    like: ['like_enabled', 'Thích', true], save: ['save_enabled', 'Lưu', true], follow: ['follow_enabled', 'Theo dõi', false],
    comment: ['comment_enabled', 'Bình luận', true], bookmark: ['bookmark_enabled', 'Đánh dấu', false], subscribe: ['subscribe_enabled', 'Đăng ký kênh', false]
  };
  var NURTURE = {
    tiktok: [F.watch, F.maxMinutes, toggles([T.like, T.save, T.follow])],
    instagram: [F.maxActions, F.maxMinutes, toggles([T.like, T.save, T.follow, T.comment]), F.likePct, F.savePct, F.commentPct, F.cTemplates],
    threads: [F.maxActions, F.maxMinutes, toggles([T.like, T.follow, T.comment]), F.likePct, F.commentPct, F.cTemplates],
    x: [F.maxActions, F.maxMinutes, toggles([T.like, T.bookmark, T.follow, T.comment]), F.likePct, F.commentPct, F.cTemplates],
    youtube: [F.watch, F.maxActions, F.maxMinutes, F.query, toggles([T.like, T.subscribe, T.comment]), F.likePct, F.commentPct, F.cTemplates]
  };
  function fieldsFor(platform, type) {
    if (platform === 'facebook') return [];
    switch (type) {
      case 'post': return [F.content, F.images];
      case 'story': return [F.images, F.content, F.aiPrompt];
      case 'reply': return [F.source, F.comment, F.templates, F.smart];
      case 'affiliate': return [F.source, F.comment];
      case 'upload': return [F.video, F.content, F.visibility, F.aiPrompt];
      case 'nurture': return NURTURE[platform] || [];
      default: return [];
    }
  }
  var HINT = {
    upload: 'Dòng đầu của nội dung là tiêu đề video, phần còn lại là mô tả.',
    nurture: 'Mỗi phiên nuôi lướt, xem và tương tác theo tỉ lệ đã chọn rồi tự dừng khi hết số hành động hoặc hết thời lượng.',
    scan_account: 'Không cần nhập gì: quét tài khoản đang đăng nhập trong profile.',
    healthscan: 'Không cần nhập gì: kiểm tra các nút của nền tảng còn tìm thấy được không.',
    micro_action: 'Loại việc này cần điền tay ở "Trường khác (JSON)".'
  };
  var renderedKey = '';
  function renderTypeFields() {
    var form = $('taskForm');
    var key = form.platform.value + '|' + form.type.value;
    if (key === renderedKey) return; // giữ nguyên những gì đang gõ khi trang tự làm mới
    renderedKey = key;
    var box = $('typeFields');
    box.textContent = '';
    var numbers = [];
    fieldsFor(form.platform.value, form.type.value).forEach(function (f) {
      if (f.kind === 'toggles') {
        box.appendChild(el('div', { class: 'toggles' }, f.items.map(function (t) {
          var input = el('input', { type: 'checkbox', 'data-key': t[0], 'data-kind': 'check' });
          input.checked = t[2];
          return el('label', {}, [input, document.createTextNode(t[1])]);
        })));
        return;
      }
      var input;
      if (f.kind === 'text' || f.kind === 'lines') { input = el('textarea', { rows: String(f.rows || 3) }); input.value = f.value || ''; }
      else if (f.kind === 'select') input = el('select', {}, f.options.map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
      else if (f.kind === 'check') input = el('input', { type: 'checkbox' });
      else if (f.kind === 'number') input = el('input', { type: 'number', min: String(f.min), max: String(f.max), value: String(f.value) });
      else input = el('input', { type: f.key === 'source_url' ? 'url' : 'text', placeholder: f.placeholder || '' });
      input.setAttribute('data-key', f.key);
      input.setAttribute('data-kind', f.kind);
      if (f.required) input.required = true;
      var label = f.kind === 'check'
        ? el('label', { class: 'check' }, [input, document.createTextNode(f.label)])
        : el('label', {}, [document.createTextNode(f.label), input]);
      if (f.kind === 'number') numbers.push(label); else { flushNumbers(); box.appendChild(label); }
    });
    flushNumbers();
    function flushNumbers() {
      if (!numbers.length) return;
      box.appendChild(el('div', { class: 'row' }, numbers));
      numbers = [];
    }
    var hint = HINT[form.type.value] || '';
    $('typeHint').textContent = hint;
    $('typeHint').hidden = !hint || form.platform.value === 'facebook';
  }
  function collectTypeFields() {
    var out = {};
    $('typeFields').querySelectorAll('[data-key]').forEach(function (input) {
      var kind = input.getAttribute('data-kind'), key = input.getAttribute('data-key');
      if (kind === 'check') out[key] = input.checked;
      else if (kind === 'number') { if (input.value !== '') out[key] = Number(input.value); }
      else if (kind === 'lines') {
        var lines = input.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        if (lines.length) out[key] = lines;
      } else if (input.value.trim()) out[key] = input.value.trim();
    });
    return out;
  }

  function pickedProfiles() {
    return Array.prototype.map.call($('profilePick').querySelectorAll('input:checked'), function (i) { return i.value; });
  }
  function updatePickCount() {
    var n = pickedProfiles().length;
    $('pickCount').textContent = n ? 'Đã chọn ' + n + ' profile' : 'Chưa chọn profile nào';
  }
  function syncProfilePick() {
    var approved = state.profiles.filter(function (p) { return p.status === 'approved'; });
    var box = $('profilePick');
    var signature = approved.map(function (p) { return p.id + ':' + p.name; }).join('|');
    if (box.getAttribute('data-sig') === signature) return;
    var keep = {};
    pickedProfiles().forEach(function (id) { keep[id] = true; });
    box.setAttribute('data-sig', signature);
    box.textContent = '';
    if (!approved.length) box.appendChild(el('span', { class: 'muted', text: 'Chưa có profile nào được duyệt.' }));
    approved.forEach(function (p) {
      var input = el('input', { type: 'checkbox', value: p.id });
      input.checked = Boolean(keep[p.id]) || approved.length === 1;
      box.appendChild(el('label', {}, [input, document.createTextNode(p.name || p.id)]));
    });
    updatePickCount();
  }
  function syncTaskForm() {
    var form = $('taskForm');
    syncProfilePick();
    fillSelect(form.platform, Object.keys(state.types).map(function (p) { return [p, PLATFORM_LABEL[p] || p]; }), true);
    fillSelect(form.type, (state.types[form.platform.value] || []).map(function (t) { return [t, TYPE_LABEL[t] || t]; }), true);
    renderTypeFields();
    syncFacebook();
  }
  // Việc Facebook: chọn mẫu cấu hình mà profile đã báo lên (lịch tạo trong popup),
  // ô JSON khi đó là "config" của tính năng.
  function fbTemplates() {
    var form = $('taskForm');
    var first = pickedProfiles()[0];
    var p = state.profiles.filter(function (x) { return x.id === first; })[0];
    return { profile: p, list: (p && p.fb_templates) || [] };
  }
  function syncFacebook() {
    var form = $('taskForm');
    var isFb = form.platform.value === 'facebook';
    $('fbRow').hidden = !isFb;
    $('fbHint').hidden = !isFb;
    form.extra.rows = isFb ? 10 : 3;
    if (isFb) $('extraBox').open = true;
    $('extraLabel').textContent = isFb
      ? 'Cấu hình tính năng (JSON "config" — chọn mẫu ở trên để điền sẵn, sửa được trước khi giao)'
      : 'Trường khác (JSON, nâng cao)';
    if (!isFb) return;
    var t = fbTemplates();
    fillSelect(form.fb_template, [['', t.list.length ? '— chọn mẫu —' : '(profile này chưa có mẫu)']].concat(
      t.list.map(function (item, i) { return [String(i), item.label + ' (' + item.feature + ')']; })), true);
    fillSelect(form.fb_feature, (state.fb_features || []).map(function (f) { return [f, f]; }), true);
    $('fbHint').textContent = !t.profile ? ''
      : !t.profile.fb_available ? 'Profile này chưa báo có lõi Facebook (extension bản cũ?).'
      : t.list.length ? 'Mẫu lấy từ các lịch đã tạo trong tab Lịch của popup trên profile "' + (t.profile.name || t.profile.id) + '" (profile đầu tiên được chọn). Giao cho nhiều profile thì cùng dùng một cấu hình.'
      : 'Để có mẫu: trên profile đó, mở popup, cấu hình tính năng rồi bấm hẹn lịch một lần. Mẫu sẽ hiện ở đây sau lần đồng bộ kế tiếp.';
  }
  function taskRow(t) {
    var buttons = [];
    if (t.status === 'queued') buttons.push(el('button', { text: 'Huỷ', onclick: function () { act('cancelTask', { id: t.id }); } }));
    else buttons.push(el('button', { text: 'Giao lại', onclick: function () {
      if (confirm('Tạo một việc mới giống việc này và giao ngay?')) act('requeueTask', { id: t.id }, 'Đã giao lại.');
    } }));
    var label = (PLATFORM_LABEL[t.payload.platform] || t.payload.platform) + ' · ' + (TYPE_LABEL[t.payload.type] || t.payload.type) + (t.repeat === 'daily' ? ' (hằng ngày)' : '');
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
      el('td', { text: (PLATFORM_LABEL[r.platform] || r.platform) + ' · ' + (TYPE_LABEL[r.type] || r.type) }),
      el('td', { text: r.origin === 'remote' ? 'Từ hub' : 'Tại chỗ' }),
      el('td', {}, [chip(r.status)]),
      el('td', { class: 'note', text: r.message || '' })
    ]);
  }

  // Đang gõ/chọn trong vùng này thì chưa vẽ lại (kẻo mất chữ đang gõ). Nút bấm
  // còn giữ focus sau khi bấm thì vẫn vẽ lại như thường.
  function typingIn(box) {
    var a = document.activeElement;
    return Boolean(a && box.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
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
    if (!typingIn($('pendingList'))) {
      $('pendingList').replaceChildren.apply($('pendingList'), pending.map(function (p) { return pendingCard(p, approved); }));
    }
    if (!typingIn($('profileList'))) {
      $('profileList').replaceChildren.apply($('profileList'), mine.map(profileCard));
    }
    renderNicks();
    if (!typingIn($('quickForm'))) syncQuick();
    renderBatches();
    var launchers = state.launchers || [];
    $('launchersEmpty').hidden = launchers.length > 0;
    $('launcherList').replaceChildren.apply($('launcherList'), launchers.map(launcherCard));
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
  $('quickForm').addEventListener('change', syncQuick);
  $('groupBy').addEventListener('change', renderBatches);
  $('quickForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target;
    var value = form.target.value;
    var target = value.indexOf('tag:') === 0 ? { tag: value.slice(4) } : value.indexOf('one:') === 0 ? { profile_ids: [value.slice(4)] } : { all: true };
    var when = radio('when');
    var body = { intent: radio('intent'), target: target, level: form.level.value, platforms: quickPlatformFilter() };
    if (when !== 'now') body.jitter_minutes = Number(form.jitter.value) || 0;
    if (when === 'daily') {
      var parts = (form.daily_time.value || '09:00').split(':');
      var at = new Date(); at.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
      // Giờ bắt đầu hôm nay đã qua thì bắt đầu từ ngày mai.
      if (at.getTime() + body.jitter_minutes * 60000 < Date.now()) at.setDate(at.getDate() + 1);
      body.run_at = at.getTime();
      body.repeat = 'daily';
    } else if (when === 'once') {
      if (!form.once_at.value) return flash('Hãy chọn thời điểm chạy.', true);
      body.run_at = new Date(form.once_at.value).getTime();
    }
    api('dispatch', body).then(function (data) {
      openBatches[data.batch_id] = true;
      flash('Đã giao ' + data.tasks + ' việc cho ' + data.profiles + ' profile.' + (data.skipped.length ? ' Bỏ qua ' + data.skipped.length + ' profile chưa có nick.' : ''));
      return refresh();
    }).catch(function (err) { flash(err.message, true); });
  });
  $('nickPlatform').addEventListener('change', renderNicks);
  $('nickSearch').addEventListener('input', renderNicks);
  $('launcherForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var form = event.target;
    api('createLauncher', { name: form.name.value }).then(function (data) {
      form.name.value = '';
      $('launcherTokenText').textContent = JSON.stringify({ HUB_URL: location.origin + location.pathname.replace(/\/$/, ''), LAUNCHER_TOKEN: data.token, MAX_PARALLEL: 2, IDLE_CLOSE_MINUTES: 3 }, null, 2);
      $('launcherToken').hidden = false;
      return refresh();
    }).catch(function (err) { flash(err.message, true); });
  });
  $('taskForm').platform.addEventListener('change', syncTaskForm);
  $('taskForm').type.addEventListener('change', renderTypeFields);
  $('profilePick').addEventListener('change', function () { updatePickCount(); syncFacebook(); });
  $('pickAll').addEventListener('click', function () { $('profilePick').querySelectorAll('input').forEach(function (i) { i.checked = true; }); updatePickCount(); syncFacebook(); });
  $('pickNone').addEventListener('click', function () { $('profilePick').querySelectorAll('input').forEach(function (i) { i.checked = false; }); updatePickCount(); syncFacebook(); });
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
    var ids = pickedProfiles();
    if (!ids.length) return flash('Hãy chọn ít nhất một profile.', true);
    if (form.platform.value === 'facebook') {
      var chosen = fbTemplates().list[Number(form.fb_template.value)];
      payload = { feature: form.fb_feature.value, config: payload, label: chosen && form.fb_template.value !== '' ? chosen.label : form.fb_feature.value };
    } else {
      var fields = collectTypeFields();
      Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
      if (form.type.value === 'nurture' && payload.max_minutes && !payload.timeout_ms) payload.timeout_ms = (payload.max_minutes + 15) * 60 * 1000;
    }
    payload.platform = form.platform.value;
    payload.type = form.type.value;
    var runAt = form.run_at.value ? new Date(form.run_at.value).getTime() : 0;
    api('createTask', { profile_ids: ids, payload: payload, run_at: runAt, repeat: form.daily.checked ? 'daily' : null, jitter_minutes: Number(form.jitter.value) || 0 })
      .then(function (data) {
        var content = $('typeFields').querySelector('[data-key=content]');
        if (content) content.value = '';
        flash('Đã giao ' + data.ids.length + ' việc.');
        return refresh();
      })
      .catch(function (err) { flash(err.message, true); });
  });

  refresh();
  setInterval(function () { if (!$('appView').hidden && !document.hidden) refresh(); }, 10000);
})();
