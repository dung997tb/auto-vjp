// content.js — [Auto vjp port] bootstrap trong trang TikTok: nối engine <-> tầng lưu trữ.
// Port từ TikTok Farmer v1.2.10 content.js. Các điểm LỆCH so với gốc (bắt buộc vì
// Auto vjp không có background riêng cho Farmer — xem MODULE.md):
//  1) send() KHÔNG gửi chrome.runtime.sendMessage về background Farmer nữa.
//     Thay bằng tfHandleMessage(): vai "chủ storage" của background.js gốc được
//     tái tạo ngay trong trang — ghi thẳng các key tf_* vào chrome.storage.local
//     (nối tiếp bằng promise chain như enqueueStore của gốc để tránh ghi đè).
//     Đồng thời báo cho adapter qua window.__AVJP_TF_LISTENER (nếu adapter đã nạp).
//  2) BỎ listener TF_CMD_* (không còn popup/background Farmer ra lệnh) và BỎ
//     khối tự-resume tryResumeNav — adapter.js là nơi duy nhất start/resume
//     engine, theo canonical task của kernel Auto vjp.
//  3) TF.getLoginState + cách dựng TF.Engine giữ NGUYÊN BẢN.
window.TF = window.TF || {};
(function () {
  'use strict';
  if (window.__tfLoaded) return;
  window.__tfLoaded = true;

  // ---------- Lớp storage thay background (chỉ xử lý message TỪ content) ----------
  var storeChain = Promise.resolve();
  function enqueueStore(fn) {
    var run = storeChain.then(fn, fn);
    storeChain = run.then(function () {}, function () {});
    return run;
  }
  function sGet(keys) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(keys, function (r) { resolve(r || {}); }); }
      catch (e) { resolve({}); }
    });
  }
  function sSet(obj) {
    return new Promise(function (resolve) {
      try { chrome.storage.local.set(obj, function () { resolve(true); }); }
      catch (e) { resolve(false); }
    });
  }
  function todayStrIn(tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  var EMPTY_DAY = { watch: 0, like: 0, save: 0, follow: 0, comment: 0, minutes: 0, sessions: 0, captchaHits: 0 };

  // Khớp từng case "từ content" trong background.js gốc (TF_LOG / TF_JOURNAL /
  // TF_COUNTER / TF_PROGRESS / TF_NAV_RESUME / TF_NAV_ABORT / TF_CAPTCHA /
  // TF_STOPPED). Khác biệt có chủ đích: không có tab affinity (kernel chạy đúng
  // 1 tab managed) và không chain workflow sau TF_STOPPED (workflow của adapter
  // không khai chain — xem MODULE.md).
  function tfHandleMessage(msg) {
    if (!msg || !msg.type) return Promise.resolve();
    switch (msg.type) {
      case 'TF_LOG':
        return enqueueStore(function () {
          return sGet(['tf_logs_v1']).then(function (cur) {
            var logs = cur.tf_logs_v1 || [];
            logs.push(msg.entry); if (logs.length > 500) logs = logs.slice(-500);
            return sSet({ tf_logs_v1: logs });
          });
        });
      case 'TF_JOURNAL':
        return enqueueStore(function () {
          return sGet(['tf_runstate_v1']).then(function (cur) {
            var je = msg.entry || {};
            if (!je.runId) return null;
            var rs = Object.assign({}, cur.tf_runstate_v1 || {});
            var arr = rs.journalRunId === je.runId && Array.isArray(rs.journal) ? rs.journal.slice() : [];
            var found = -1;
            for (var i = 0; i < arr.length; i++) if (arr[i].seq === je.seq) { found = i; break; }
            if (found >= 0) arr[found] = je; else arr.push(je);
            if (arr.length > 300) arr = arr.slice(arr.length - 300);
            rs.journal = arr; rs.journalRunId = je.runId;
            return sSet({ tf_runstate_v1: rs });
          });
        });
      case 'TF_COUNTER':
        return enqueueStore(function () {
          return sGet(['tf_counters_v1']).then(function (cur) {
            var all = cur.tf_counters_v1 || {}, day = Object.assign({}, EMPTY_DAY, all[msg.dateKey] || {});
            var amt = (msg.by == null ? 1 : msg.by);
            day[msg.key] = Math.round(((day[msg.key] || 0) + amt) * 100) / 100; all[msg.dateKey] = day;
            return sSet({ tf_counters_v1: all });
          });
        });
      case 'TF_PROGRESS':
        return enqueueStore(function () {
          return sGet(['tf_runstate_v1']).then(function (cur) {
            var rs = Object.assign({}, cur.tf_runstate_v1 || {}, msg.runstate);
            if (msg.runstate.checkpoint) rs.checkpoint = msg.runstate.checkpoint;
            return sSet({ tf_runstate_v1: rs });
          });
        });
      case 'TF_NAV_RESUME':
        return enqueueStore(function () {
          return sGet(['tf_runstate_v1']).then(function (cur) {
            var prev = cur.tf_runstate_v1 || {};
            var rs = Object.assign({}, prev, {
              status: 'navigating',
              checkpoint: { wfId: msg.wfId, stepIndex: msg.stepIndex, runId: msg.runId || null, resumeStack: msg.resumeStack || null, navResume: true, ts: Date.now() },
              countersToday: msg.countersToday || prev.countersToday || {},
              startedAt: msg.startedAt || prev.startedAt || null,
              currentModule: ''
            });
            return sSet({ tf_runstate_v1: rs });
          });
        });
      case 'TF_NAV_ABORT':
        return enqueueStore(function () {
          return sGet(['tf_runstate_v1']).then(function (cur) {
            var prev = cur.tf_runstate_v1 || {};
            if (prev.status !== 'navigating') return null;
            return sSet({ tf_runstate_v1: Object.assign({}, prev, { status: 'interrupted' }) });
          });
        });
      case 'TF_CAPTCHA':
        return enqueueStore(function () {
          return sGet(['tf_config_v1', 'tf_counters_v1', 'tf_runstate_v1']).then(function (cur) {
            var dayKey = todayStrIn((cur.tf_config_v1 || {}).tz);
            var all = cur.tf_counters_v1 || {}, day = Object.assign({}, EMPTY_DAY, all[dayKey] || {});
            day.captchaHits = (day.captchaHits || 0) + 1; all[dayKey] = day;
            var rs = Object.assign({}, cur.tf_runstate_v1 || {}, { status: 'idle', lastStopReason: 'captcha', lastSessionEnd: Date.now() });
            return sSet({ tf_counters_v1: all, tf_runstate_v1: rs });
          });
        });
      case 'TF_STOPPED':
        return enqueueStore(function () {
          return sGet(['tf_runstate_v1']).then(function (cur) {
            var prev = cur.tf_runstate_v1 || {};
            var hist = (prev.journalHistory || []).slice();
            hist.push({ runId: msg.runId || prev.journalRunId || '', wfId: msg.wfId, outcome: msg.outcome, reason: msg.reason, endedAt: Date.now(), steps: Array.isArray(prev.journal) ? prev.journal.length : 0 });
            var rs = Object.assign({}, prev, { status: 'idle', lastStopReason: msg.reason, lastSessionEnd: Date.now(), wfStack: [], journalHistory: hist.slice(-5) });
            return sSet({ tf_runstate_v1: rs });
          });
        });
      default:
        return Promise.resolve();
    }
  }

  function send(type, extra) {
    var m = Object.assign({ type: type }, extra || {});
    try {
      if (typeof window.__AVJP_TF_LISTENER === 'function') window.__AVJP_TF_LISTENER(m);
    } catch (e) {}
    return tfHandleMessage(m);
  }

  TF.getLoginState = function () {
    // QUAN TRỌNG (bắt lỗi thật 2026-10-30 trên lab): nav-profile tồn tại cả khi CHƯA login,
    // nên hễ còn nút Đăng nhập (top-login-button) là coi như chưa login — kiểm tra này phải đứng trước.
    var loginBtn = TF.q('loginBtn');
    if (loginBtn) return { loggedIn: false, username: null };
    var profileLink = TF.q('profileLink');
    var username = null;
    if (profileLink) {
      var href = profileLink.getAttribute('href') || '';
      var mm = href.match(/\/@([^/?#]+)/);
      if (mm) username = mm[1];
    }
    if (!username) {
      var av = document.querySelector('a[href^="/@"]');
      if (av) { var m2 = (av.getAttribute('href') || '').match(/\/@([^/?#]+)/); if (m2) username = m2[1]; }
    }
    var loggedIn = !!username || !!document.querySelector('[data-e2e="upload-icon"], [data-e2e="nav-upload"]');
    // v1.0.2 — TikTok Studio dùng header khác hẳn giao diện thường (không có
    // nav-profile/loginBtn theo selector cũ) nên bản cũ báo NHẦM chưa đăng nhập
    // và chặn mọi WF trên trang Studio. Trang Studio chỉ render khu vực soạn/
    // quản lý nội dung cho tài khoản ĐÃ đăng nhập (chưa login bị đá sang trang
    // đăng nhập) — thấy các khối này là coi như đã đăng nhập.
    if (!loggedIn && typeof location !== 'undefined' && (location.pathname || '').indexOf('/tiktokstudio') === 0 &&
        document.querySelector('[data-e2e="upload_status_container"], [data-e2e="caption_container"], [data-e2e="content_container"], [data-e2e="select_video_container"], [data-e2e="select_video_button"], [data-e2e="local_draft_container"], [class*="DivSideBar"], [data-e2e="studio-nav"]')) {
      // (select_video_* / local_draft_container là vùng chọn file ở trang
      // Studio Upload TRỐNG — bổ sung sau khi đo thật 31/10: trước đó trang
      // upload trống không có tín hiệu nào trong danh sách, resume bị hủy oan.)
      loggedIn = true;
    }
    return { loggedIn: loggedIn, username: username };
  };

  var engine = new TF.Engine({
    sendLog: function (entry) { send('TF_LOG', { entry: entry }); },
    sendProgress: function (runstate) { send('TF_PROGRESS', { runstate: runstate }); },
    sendStopped: function (info) { send('TF_STOPPED', info); },
    sendCaptcha: function (info) { send('TF_CAPTCHA', info); },
    sendCounter: function (key, dateKey, by) { send('TF_COUNTER', { key: key, dateKey: dateKey, by: by }); },
    sendJournal: function (entry) { send('TF_JOURNAL', { entry: entry }); },
    sendNavResume: function (info) { return send('TF_NAV_RESUME', info || {}); }
  });
  TF.engine = engine;
})();
