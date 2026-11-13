// [Auto vjp — modules/tiktok-nurture] Port NGUYÊN BẢN từ TikTok Farmer v1.2.10, không sửa dòng nào.
// engine.js — Workflow engine + Safety Supervisor phía content. Theo CONTRACT.md v1.0.
// Chạy trong content script (cần DOM). Dùng global window.TF, không import/export.
window.TF = window.TF || {};
(function () {
  'use strict';

  // ---------- Validate + cycle detection (thuần, test được bằng node) ----------
  function buildGraph(wfs) {
    var g = {};
    (wfs || []).forEach(function (w) {
      var edges = [];
      (function walk(steps) {
        (steps || []).forEach(function (s) {
          if (s.kind === 'call' && s.wfId) edges.push(s.wfId);
          if (s.steps) walk(s.steps);
          if (s.elseSteps) walk(s.elseSteps);
        });
      })(w.steps);
      ['onSuccess', 'onFail', 'onFinish'].forEach(function (k) {
        if (w[k] && w[k].callWfId) edges.push(w[k].callWfId);
      });
      g[w.id] = edges;
    });
    return g;
  }
  function findCycle(wfs) {
    var g = buildGraph(wfs), state = {}, stack = [];
    function dfs(id) {
      state[id] = 1; stack.push(id);
      var edges = g[id] || [];
      for (var i = 0; i < edges.length; i++) {
        var n = edges[i];
        if (!(n in g)) continue;
        if (state[n] === 1) return stack.slice(stack.indexOf(n)).concat([n]);
        if (!state[n]) { var r = dfs(n); if (r) return r; }
      }
      stack.pop(); state[id] = 2; return null;
    }
    var ids = Object.keys(g);
    for (var i = 0; i < ids.length; i++) {
      if (!state[ids[i]]) { var c = dfs(ids[i]); if (c) return c; }
    }
    return null;
  }
  function maxCallDepth(wf, wfsById, seen) {
    var d = 0; seen = seen || {};
    (function walk(steps, cur) {
      (steps || []).forEach(function (s) {
        if (s.kind === 'call' && s.wfId && wfsById[s.wfId] && !seen[s.wfId]) {
          seen[s.wfId] = 1;
          if (cur + 1 > d) d = cur + 1;
          walk(wfsById[s.wfId].steps, cur + 1);
          delete seen[s.wfId];
        }
        if (s.steps) walk(s.steps, cur);
        if (s.elseSteps) walk(s.elseSteps, cur);
      });
    })(wf.steps, 0);
    return d;
  }
  function validateWorkflows(wfs, moduleIds) {
    var errors = [];
    if (!Array.isArray(wfs)) return { ok: false, errors: ['workflows không phải mảng'] };
    var byId = {};
    wfs.forEach(function (w) {
      if (!w.id) errors.push('WF thiếu id');
      if (byId[w.id]) errors.push('Trùng id WF: ' + w.id);
      byId[w.id] = w;
    });
    var cyc = findCycle(wfs);
    if (cyc) errors.push('Vòng lặp WF: ' + cyc.join(' → '));
    wfs.forEach(function (w) {
      var dep = maxCallDepth(w, byId, {});
      if (dep > 3) errors.push('WF ' + w.id + ': sâu gọi WF con = ' + dep + ' > 3');
      (function walk(steps, path) {
        (steps || []).forEach(function (s, i) {
          var p = path + '[' + i + ']';
          if (!s.kind) { errors.push(w.id + p + ': step thiếu kind'); return; }
          if (s.kind === 'module') {
            if (!s.moduleId) errors.push(w.id + p + ': module step thiếu moduleId');
            else if (moduleIds && moduleIds.indexOf(s.moduleId) < 0) errors.push(w.id + p + ': module không tồn tại: ' + s.moduleId);
          } else if (s.kind === 'call') {
            if (!s.wfId || !byId[s.wfId]) errors.push(w.id + p + ': call tới WF không tồn tại: ' + s.wfId);
          } else if (['wait', 'prob', 'loop', 'if'].indexOf(s.kind) < 0) {
            errors.push(w.id + p + ': kind lạ: ' + s.kind);
          }
          if (s.steps) walk(s.steps, p + '.steps');
          if (s.elseSteps) walk(s.elseSteps, p + '.elseSteps');
        });
      })(w.steps, '.steps');
    });
    return { ok: errors.length === 0, errors: errors };
  }

  // ---------- Stage / effective caps (Supervisor) ----------
  // P1 lát 3 — Ngày theo múi giờ IANA cấu hình (mặc định Asia/Tokyo): bản cũ
  // dùng UTC nên ngày lật lúc 09:00 JST, lệch mọi bộ đếm/cap theo ngày.
  function todayStrIn(tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function stageDay(stage, todayStr) {
    if (!stage) return 1;
    if (stage.overrideDay) return stage.overrideDay;
    if (!stage.firstSeenDate) return 1;
    var a = new Date(stage.firstSeenDate + 'T00:00:00'), b = new Date((todayStr || todayStrIn('Asia/Tokyo')) + 'T00:00:00');
    return Math.max(1, Math.floor((b - a) / 86400000) + 1);
  }
  function effectiveCaps(config, stage, todayStr) {
    var caps = JSON.parse(JSON.stringify((config && config.caps) || {}));
    var d = stageDay(stage, todayStr);
    if (d <= 3) { caps.maxLikePerDay = 0; caps.maxSavePerDay = 0; caps.maxFollowPerDay = 0; caps.maxCommentPerDay = 0; }
    else if (d <= 7) { caps.maxLikePerDay = Math.min(caps.maxLikePerDay || 0, 10); caps.maxSavePerDay = Math.min(caps.maxSavePerDay || 0, 3); caps.maxFollowPerDay = 0; }
    else if (d <= 14) { caps.maxFollowPerDay = Math.min(caps.maxFollowPerDay || 0, 3); }
    if (config && !config.followEnabled) caps.maxFollowPerDay = 0;
    return { day: d, caps: caps };
  }
  var CAP_KEY = { like: 'maxLikePerDay', follow: 'maxFollowPerDay', save: 'maxSavePerDay', comment: 'maxCommentPerDay', minutes: 'maxWatchMinPerDay' };

  TF.validateWorkflows = validateWorkflows;
  TF.findCycle = findCycle;
  TF.stageDay = stageDay;
  TF.effectiveCaps = effectiveCaps;

  // ---------- Engine ----------
  // P1 (v1.2) — Kết quả có kiểu cho mọi bước/WF: success | skipped | failed |
  // unknown | cancelled. Module cũ trả {ok, note} vẫn chạy: ok -> success,
  // {skip:true} -> skipped, còn lại -> failed. Module timeout -> unknown
  // (kết quả không rõ, KHÔNG đoán là success — xem plan-v2 mục đối soát).
  function R(status, note) { return { status: status, note: note || '' }; }

  function Engine(hooks) {
    this.hooks = hooks; // {sendLog, sendProgress, sendStopped, sendCaptcha, sendCounter, sendJournal}
    this.running = false; this.paused = false; this.stopFlag = false; this.stopReason = null;
    this.config = null; this.stage = null; this.wfsById = {};
    this.ctx = null; this.stack = []; this.queue = [];
    this.countersToday = {}; this.sessionStart = 0; this.sessionMinutesBase = 0; this.sessionMinutesCounted = 0;
    this.captchaTimer = null; this.currentPath = '';
    this.rootStepIndex = 0; this.rootWfId = null; this.resumeFromStep = 0;
    this.runId = ''; this.journal = []; this.journalSeq = 0;
    // P1 lát 2 — frameStack: ảnh chụp trực tiếp cây thực thi (wf/steps/loop/
    // branch) để checkpoint điều hướng lưu được TOÀN BỘ stack lồng nhau;
    // deadlineAt: hạn chót toàn phiên (start + maxRuntimeMin), cắt giữa chừng.
    this.frameStack = []; this.deadlineAt = 0;
  }
  // Execution journal: mỗi bước module/call ghi 1 entry (attempted -> kết quả
  // cuối), stream về background qua hooks.sendJournal để không mất khi trang
  // điều hướng. sideEffectState chỉ theo dõi module khai sideEffect:true.
  Engine.prototype.journalStart = function (fields) {
    var entry = { runId: this.runId || '', seq: ++this.journalSeq, ts: Date.now(),
      wfId: fields.wfId || '', path: fields.path || '', kind: fields.kind || '', moduleId: fields.moduleId || '',
      status: 'attempted', note: '', sideEffectState: fields.sideEffect ? 'attempted' : 'na' };
    this.journal.push(entry);
    if (this.hooks.sendJournal) { try { this.hooks.sendJournal(JSON.parse(JSON.stringify(entry))); } catch (e) { console.debug("[Auto vjp][engine] bỏ qua lỗi:", e); } }
    return entry;
  };
  Engine.prototype.journalEnd = function (entry, status, note) {
    if (!entry) return;
    entry.status = status; entry.note = note || ''; entry.endedAt = Date.now();
    if (entry.sideEffectState === 'attempted') entry.sideEffectState = status === 'success' ? 'confirmed' : (status === 'unknown' ? 'unknown' : 'failed');
    if (this.hooks.sendJournal) { try { this.hooks.sendJournal(JSON.parse(JSON.stringify(entry))); } catch (e) { console.debug("[Auto vjp][engine] bỏ qua lỗi:", e); } }
  };
  // P1 lát 2 — Bọc một đoạn thực thi con trong một frame của frameStack (loop/
  // branch) để checkpoint điều hướng chụp được vị trí lồng nhau hiện tại.
  Engine.prototype.withFrame = function (frameObj, fn) {
    var self = this;
    this.frameStack.push(frameObj);
    var done = function (res) {
      var i = self.frameStack.indexOf(frameObj);
      if (i >= 0) self.frameStack.splice(i, 1);
      return res;
    };
    try { return Promise.resolve(fn()).then(done, function (e) { done(null); throw e; }); }
    catch (e) { done(null); throw e; }
  };
  Engine.prototype.todayStr = function () { return todayStrIn(this.config && this.config.tz); };
  Engine.prototype.log = function (level, text, moduleId) {
    this.hooks.sendLog({ ts: Date.now(), level: level || 'info', wfName: this.stack.length ? this.stack[this.stack.length - 1].name : '', stepPath: this.currentPath, moduleId: moduleId || '', text: text });
  };
  Engine.prototype.progress = function (checkpoint) {
    this.foldMinutes();
    this.hooks.sendProgress({
      status: this.stopFlag ? 'stopping' : (this.paused ? 'paused' : (this.running ? 'running' : 'idle')),
      wfStack: this.stack.map(function (s) { return { wfId: s.wfId, name: s.name, stepIndex: s.stepIndex }; }),
      queue: this.queue.slice(), currentModule: this.currentModule || '', currentPath: this.currentPath,
      countersToday: this.countersToday, checkpoint: checkpoint || null, startedAt: this.sessionStart || null
    });
  };
  Engine.prototype.supervisorCan = function (capKey) {
    if (!capKey) return true;
    var eff = effectiveCaps(this.config, this.stage, this.todayStr());
    var capName = CAP_KEY[capKey]; if (!capName) return true;
    var cap = eff.caps[capName];
    if (capKey === 'minutes') {
      var live = this.sessionStart ? Math.max(0, (Date.now() - this.sessionStart) / 60000 - (this.sessionMinutesCounted || 0)) : 0;
      return ((this.countersToday.minutes || 0) + live) < cap;
    }
    var usedKey = capKey === 'minutes' ? 'minutes' : capKey;
    return (this.countersToday[usedKey] || 0) < cap;
  };
  Engine.prototype.bumpCounter = function (key, by) {
    var amt = (by == null ? 1 : by);
    var v = (this.countersToday[key] || 0) + amt;
    this.countersToday[key] = key === 'minutes' ? Math.round(v * 100) / 100 : v;
    this.hooks.sendCounter(key, this.todayStr(), amt);
    this.progress(null);
  };
  Engine.prototype.foldMinutes = function (force) {
    if (!this.sessionStart) return;
    if (!this.running && !force) return;
    var elapsed = (Date.now() - this.sessionStart) / 60000;
    var delta = elapsed - (this.sessionMinutesCounted || 0);
    if (delta >= 0.05) {
      this.sessionMinutesCounted = elapsed;
      this.bumpCounter('minutes', Math.round(delta * 100) / 100);
    }
  };
  Engine.prototype.sleep = function (ms) {
    var self = this, end = Date.now() + ms;
    return new Promise(function (resolve) {
      (function tick() {
        if (self.stopFlag) return resolve();
        // P1 lát 2 — Deadline toàn phiên cũng đánh thức sleep sớm để bước chờ
        // dài không nuốt mất hạn chót (bước wait tự kết luận deadline_exceeded).
        if (self.deadlineAt && Date.now() >= self.deadlineAt) return resolve();
        if (self.paused) return setTimeout(tick, 250);
        if (Date.now() >= end) return resolve();
        setTimeout(tick, Math.min(250, end - Date.now()));
      })();
    });
  };
  Engine.prototype.makeApi = function () {
    var self = this;
    return {
      sleep: function (ms) { return self.sleep(ms); },
      rand: function (a, b) { return a + Math.random() * (b - a); },
      randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
      log: function (t) { self.log('info', t); },
      checkStop: function () { return self.stopFlag; },
      supervisorCan: function (k) { return self.supervisorCan(k); },
      bumpCounter: function (k, by) { self.bumpCounter(k, by); },
      gotoUrl: function (url, opts) {
        // v1.0.2 — Điều hướng CÓ CHẠY TIẾP: trước khi đổi trang, báo background ghi
        // checkpoint {wfId, stepIndex = bước gốc KẾ TIẾP, navResume} vào runstate
        // (status 'navigating') và CHỜ ghi xong mới chuyển trang. Content script ở
        // trang mới đọc checkpoint và tự start tiếp WF từ bước đó. (Bản cũ trả về
        // Promise không bao giờ resolve mà không lưu gì -> WF treo vĩnh viễn.)
        // v1.1.0 — opts.repeat = true: chạy tiếp bằng cách LẶP LẠI chính bước hiện
        // tại ở trang mới (cho module 2 pha: pha A điều hướng, pha B — vẫn là
        // module đó — xử lý tiếp trên trang đích, vd đăng video ở TikTok Studio).
        var resumeIdx = (self.rootStepIndex || 0) + (opts && opts.repeat ? 0 : 1);
        // P1 lát 2 — Chụp toàn bộ frameStack (+ frame module ở trong cùng) để
        // trang đích chạy tiếp đúng vị trí lồng nhau, không chỉ bước gốc.
        var stackSnap = [];
        try { stackSnap = JSON.parse(JSON.stringify(self.frameStack || [])); } catch (e) { console.debug("[Auto vjp][engine] bỏ qua lỗi:", e); }
        stackSnap.push({ t: 'module', repeat: !!(opts && opts.repeat) });
        var info = {
          wfId: self.rootWfId, stepIndex: resumeIdx, runId: self.runId || null,
          resumeStack: stackSnap,
          countersToday: self.countersToday, startedAt: self.sessionStart || null
        };
        self.log('info', 'Điều hướng sang ' + url + ' — sẽ chạy tiếp từ bước ' + resumeIdx, '');
        var ack = Promise.resolve();
        if (self.hooks && typeof self.hooks.sendNavResume === 'function') {
          try { ack = Promise.resolve(self.hooks.sendNavResume(info)); } catch (e) { console.debug("[Auto vjp][engine] bỏ qua lỗi:", e); }
        }
        var waited = Promise.race([ack, self.sleep(900)]);
        return waited.then(function () {
          try { location.href = url; } catch (e) { console.debug("[Auto vjp][engine] bỏ qua lỗi:", e); }
          return new Promise(function () {}); // trang cũ chết tại đây — bình thường
        });
      },
      ctx: function () { return self.ctx; },
      config: function () { return self.config; }
    };
  };
  Engine.prototype.checkCaptcha = function () {
    if (window.TF.isCaptchaVisible && TF.isCaptchaVisible()) {
      this.log('captcha', 'Phát hiện captcha — DỪNG toàn bộ', 'phat_hien_captcha');
      this.hooks.sendCaptcha({ ts: Date.now() });
      this.stopAll('captcha');
      return true;
    }
    return false;
  };
  Engine.prototype.evalCond = function (cond) {
    if (!cond) return false;
    var v = cond.ctxKey.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, this.ctx);
    switch (cond.op) {
      case 'truthy': return !!v;
      case 'falsy': return !v;
      case 'eq': return v === cond.value;
      case 'ne': return v !== cond.value;
      case 'gte': return Number(v) >= Number(cond.value);
      case 'lte': return Number(v) <= Number(cond.value);
      default: return false;
    }
  };
  Engine.prototype.execSteps = function (steps, wfCtx, pathPrefix, isRoot, baseIdx, resume) {
    var self = this;
    // P1 lát 2 — resume: mảng frame cho tầng này [{t:'steps',idx}, ...frame con].
    // Bỏ qua các bước trước idx; bước tại idx nhận phần frame còn lại để chui
    // tiếp xuống loop/call/branch/module đúng vị trí trước điều hướng.
    var startAt = 0, childResume = null;
    if (resume && resume.length && resume[0].t === 'steps') { startAt = resume[0].idx || 0; childResume = resume.slice(1); }
    var frame = { t: 'steps', idx: startAt };
    this.frameStack.push(frame);
    var chain = Promise.resolve(R('success'));
    var base = baseIdx || 0;
    (steps || []).forEach(function (step, idx) {
      chain = chain.then(function (agg) {
        // P1 (v1.2) — Lan truyền kết quả có kiểu: bước bắt buộc failed/unknown/
        // cancelled thì các bước sau KHÔNG chạy nữa và WF mang đúng kết quả đó
        // (bản cũ nuốt fail thành success ở mọi tầng). Bước khai optional:true
        // thì fail của nó chỉ ghi log cảnh báo, WF đi tiếp.
        if (agg.status !== 'success') return agg;
        if (self.stopFlag) return R('cancelled', self.stopReason || 'stopped');
        var realIdx = base + idx;
        if (realIdx < startAt) return agg; // phần đã chạy trước điều hướng — bỏ qua khi resume
        if (self.deadlineAt && Date.now() > self.deadlineAt) return R('failed', 'deadline_exceeded');
        frame.idx = realIdx;
        wfCtx.stepIndex = realIdx;
        if (isRoot) self.rootStepIndex = realIdx;
        self.currentPath = pathPrefix + '[' + realIdx + ']';
        var stepResume = realIdx === startAt ? childResume : null;
        return self.execStep(step, wfCtx, pathPrefix + '[' + realIdx + ']', stepResume).then(function (res) {
          self.progress({ wfId: wfCtx.wfId, stepIndex: realIdx });
          if (res.status === 'failed' && step.optional) {
            self.log('warn', 'Bước tuỳ chọn fail — bỏ qua, WF đi tiếp: ' + (step.moduleId || step.kind) + ' (' + (res.note || '') + ')', step.moduleId || '');
            return R('success');
          }
          if (res.status === 'success' || res.status === 'skipped') return agg;
          return res;
        });
      });
    });
    return chain.then(function (res) {
      var i = self.frameStack.indexOf(frame);
      if (i >= 0) self.frameStack.splice(i, 1);
      return res;
    });
  };
  Engine.prototype.execStep = function (step, wfCtx, path, resume) {
    var self = this, api = this.makeApi();
    if (this.stopFlag) return Promise.resolve(R('cancelled', this.stopReason || 'stopped'));
    if (this.checkCaptcha()) return Promise.resolve(R('cancelled', 'captcha'));
    switch (step.kind) {
      case 'wait': {
        var ms = 0;
        if (step.mode === 'fixed') ms = (step.minutes == null ? 1 : step.minutes) * 60000;
        else if (step.mode === 'random') ms = api.rand(step.min == null ? 1 : step.min, step.max == null ? 5 : step.max) * 60000;
        else if (step.mode === 'untilTime' && step.time) {
          var now = new Date(), parts = step.time.split(':');
          var target = new Date(now); target.setHours(+parts[0], +parts[1], 0, 0);
          ms = Math.max(0, target - now);
        }
        this.log('info', 'Chờ ' + Math.round(ms / 1000) + 's', 'cho');
        return this.sleep(ms).then(function () {
          if (self.deadlineAt && Date.now() > self.deadlineAt) return R('failed', 'deadline_exceeded');
          return self.stopFlag ? R('cancelled', self.stopReason || 'stopped') : R('success');
        });
      }
      case 'prob': {
        // Resume: nhánh đã được chọn trước điều hướng — chạy tiếp trong nhánh,
        // KHÔNG tung lại xác suất.
        if (resume && resume.length) {
          return this.withFrame({ t: 'branch', which: 'steps' }, function () {
            return self.execSteps(step.steps, wfCtx, path + '.prob', false, 0, resume);
          });
        }
        var roll = Math.random() * 100;
        if (roll < (step.pct || 0)) {
          return this.withFrame({ t: 'branch', which: 'steps' }, function () {
            return self.execSteps(step.steps, wfCtx, path + '.prob');
          });
        }
        this.log('info', 'Xác suất ' + step.pct + '% — bỏ qua (roll ' + roll.toFixed(0) + ')', 'theo_xac_suat');
        return Promise.resolve(R('success'));
      }
      case 'loop': {
        var times = step.times || 1, start = Date.now(), maxMs = (step.maxMinutes || 9999) * 60000, self2 = this;
        // Resume: nhảy vào đúng vòng lặp đang dở (frame loop) — các vòng trước
        // coi như đã xong; vòng dở nhận phần frame còn lại cho thân vòng.
        var i = 0, firstResume = null;
        if (resume && resume.length && resume[0].t === 'loop') { i = Math.max(0, (resume[0].iter || 1) - 1); firstResume = resume.slice(1); }
        var iterate = function () {
          if (self2.stopFlag) return Promise.resolve(R('cancelled', self2.stopReason || 'stopped'));
          if (i >= times || Date.now() - start > maxMs) return Promise.resolve(R('success'));
          i++;
          var bodyResume = i - 1 === (resume && resume.length ? (resume[0].iter || 1) - 1 : -1) ? firstResume : null;
          return self2.withFrame({ t: 'loop', iter: i }, function () {
            return self2.execSteps(step.steps, wfCtx, path + '.loop' + i, false, 0, bodyResume);
          }).then(function (res) {
            if (res.status !== 'success') return res; // fail/unknown trong vòng lặp dừng vòng lặp và lan lên
            return iterate();
          });
        };
        return iterate();
      }
      case 'if': {
        if (resume && resume.length && resume[0].t === 'branch') {
          var rWhich = resume[0].which === 'else' ? 'else' : 'steps';
          var rBranch = rWhich === 'else' ? step.elseSteps : step.steps;
          return this.withFrame({ t: 'branch', which: rWhich }, function () {
            return self.execSteps(rBranch || [], wfCtx, path + '.if', false, 0, resume.slice(1));
          });
        }
        var which = this.evalCond(step.cond) ? 'steps' : 'else';
        var branch = which === 'steps' ? step.steps : step.elseSteps;
        return this.withFrame({ t: 'branch', which: which }, function () {
          return self.execSteps(branch || [], wfCtx, path + '.if');
        });
      }
      case 'call': {
        if (this.stack.length > 3) { this.log('error', 'Gọi WF quá sâu (>3): ' + step.wfId, 'goi_workflow'); return Promise.resolve(R('failed', 'call_too_deep')); }
        var sub = this.wfsById[step.wfId];
        if (!sub) { this.log('error', 'Không thấy WF con: ' + step.wfId, 'goi_workflow'); return Promise.resolve(R('failed', 'sub_not_found:' + step.wfId)); }
        this.log('info', '→ Gọi WF con: ' + sub.name, 'goi_workflow');
        var entry = this.journalStart({ kind: 'call', wfId: wfCtx.wfId, path: path, sideEffect: false });
        return this.runWorkflow(sub, this.stack.length, resume || null).then(function (res) {
          self.log('info', '← WF con xong: ' + sub.name + ' (' + res.status + ')', 'goi_workflow');
          self.journalEnd(entry, res.status, res.note || '');
          return res; // P1: kết quả WF con lan lên WF cha (bản cũ nuốt thành công); cha muốn bao dung thì đặt optional:true ở bước call
        });
      }
      case 'module': {
        // Resume tại chính module đã điều hướng: repeat=true -> chạy lại module
        // (pha B trên trang mới); repeat=false -> module đã xong việc bằng cú
        // điều hướng, coi như success và đi tiếp, KHÔNG chạy lại.
        if (resume && resume.length && resume[0].t === 'module' && !resume[0].repeat) {
          var navEntry = this.journalStart({ kind: 'module', moduleId: step.moduleId, wfId: wfCtx.wfId, path: path, sideEffect: false });
          this.journalEnd(navEntry, 'success', 'resumed_after_nav');
          return Promise.resolve(R('success', 'resumed_after_nav'));
        }
        var mod = (TF.MODULES || {})[step.moduleId];
        if (!mod) { this.log('error', 'Module không tồn tại: ' + step.moduleId, step.moduleId); return Promise.resolve(R('failed', 'module_not_found:' + step.moduleId)); }
        if ((this.config.disabledModules || []).indexOf(step.moduleId) >= 0 && !mod.core) {
          this.log('info', 'Module đang tắt: ' + step.moduleId, step.moduleId); return Promise.resolve(R('skipped', 'module_disabled'));
        }
        if (mod.capsUsed) {
          for (var ci = 0; ci < mod.capsUsed.length; ci++) {
            if (!this.supervisorCan(mod.capsUsed[ci])) {
              this.log('warn', 'Supervisor chặn module ' + step.moduleId + ' — hết trần ' + mod.capsUsed[ci], step.moduleId);
              return Promise.resolve(R('skipped', 'cap_' + mod.capsUsed[ci]));
            }
          }
        }
        this.currentModule = step.moduleId;
        var params = Object.assign({}, step.params || {});
        this.log('info', 'Chạy module ' + step.moduleId, step.moduleId);
        var self3 = this;
        var jEntry = this.journalStart({ kind: 'module', moduleId: step.moduleId, wfId: wfCtx.wfId, path: path, sideEffect: !!mod.sideEffect });
        // Timeout cứng từng bước module (mặc định 90s, config.stepTimeoutSec).
        // P1: timeout = kết quả UNKNOWN (module có thể đã kịp gây side effect —
        // không được đoán success hay fail; journal ghi unknown để đối soát).
        var timeoutSec = (this.config && this.config.stepTimeoutSec) || 90;
        var timedOut = false;
        var runP = Promise.resolve().then(function () { return mod.run(self3.ctx, params, api); });
        var timeoutP = new Promise(function (resolve) {
          var t = setTimeout(function () { timedOut = true; resolve({ ok: false, note: 'step_timeout_' + timeoutSec + 's' }); }, timeoutSec * 1000);
          if (t && typeof t.unref === 'function') t.unref(); // Node test env: đừng giữ tiến trình sống vì timer này
        });
        return Promise.race([runP, timeoutP])
          .then(function (res) {
            res = res || { ok: true };
            var out;
            if (timedOut) out = R('unknown', res.note || 'step_timeout');
            else if (res.ok) out = R('success', res.note || '');
            else if (res.skip) out = R('skipped', res.note || '');
            else out = R('failed', res.note || 'fail');
            if (out.status === 'failed' || out.status === 'unknown') self3.log('warn', 'Module ' + step.moduleId + ': ' + (out.note || out.status), step.moduleId);
            else if (out.note) self3.log('info', step.moduleId + ': ' + out.note, step.moduleId);
            self3.journalEnd(jEntry, out.status, out.note);
            // (2.11.16) Sau bước module thành công, ~25% khả năng xen 1
            // đợt di chuột vô định (AVJP.human.wander — chuột thật qua
            // CDP) cho nhịp hành động giống người. Module humanmouse
            // vắng mặt thì bỏ qua êm; wander lỗi cũng không được làm
            // hỏng kết quả bước vừa chạy.
            if (out.status === 'success' && Math.random() < 0.25) {
              var H = (typeof window !== 'undefined' && window.AVJP && window.AVJP.human) || null;
              if (H && typeof H.wander === 'function') {
                return Promise.resolve(H.wander()).catch(function () {}).then(function () { return out; });
              }
            }
            return out;
          })
          .catch(function (e) { self3.log('error', 'Module ' + step.moduleId + ' lỗi: ' + (e && e.message), step.moduleId); self3.journalEnd(jEntry, 'failed', 'throw:' + (e && e.message)); return R('failed', 'throw:' + (e && e.message)); });
      }
      default:
        this.log('error', 'Kind lạ: ' + step.kind, '');
        return Promise.resolve(R('failed', 'unknown_kind:' + step.kind));
    }
  };
  Engine.prototype.runWorkflow = function (wf, depth, resumeChain) {
    var self = this;
    var wfCtx = { wfId: wf.id, stepIndex: 0 };
    this.stack.push({ wfId: wf.id, name: wf.name, stepIndex: 0 });
    var start = Date.now();
    var maxMs = (wf.maxRuntimeMin || 60) * 60000;
    this.progress(null);
    // P1 lát 2 — Resume full-stack: resumeChain bắt đầu bằng frame wf của
    // chính WF này; phần còn lại đưa xuống execSteps để chui tiếp vào các
    // tầng loop/call/branch. Không có resumeChain thì dùng đường cũ
    // (resumeFromStep, chỉ tầng gốc) cho checkpoint đời trước.
    var stepsToRun = wf.steps, baseIdx = 0, chain = null;
    if (resumeChain && resumeChain.length && resumeChain[0].t === 'wf' && resumeChain[0].wfId === wf.id) {
      chain = resumeChain.slice(1);
    } else if (depth === 0 && this.resumeFromStep > 0) {
      baseIdx = Math.min(this.resumeFromStep, (wf.steps || []).length);
      stepsToRun = (wf.steps || []).slice(baseIdx);
      this.resumeFromStep = 0;
    }
    var wfFrame = { t: 'wf', wfId: wf.id };
    this.frameStack.push(wfFrame);
    var popFrame = function () {
      var i = self.frameStack.indexOf(wfFrame);
      if (i >= 0) self.frameStack.splice(i, 1);
    };
    return this.execSteps(stepsToRun, wfCtx, wf.id + '.steps', depth === 0, baseIdx, chain)
      .then(function (res) {
        self.stack.pop(); popFrame();
        if (Date.now() - start > maxMs) self.log('warn', 'WF ' + wf.name + ' vượt maxRuntime', '');
        if (self.stopFlag) return R('cancelled', self.stopReason || 'stopped');
        return res;
      })
      .catch(function (e) { self.stack.pop(); popFrame(); self.log('error', 'WF lỗi: ' + (e && e.message), ''); return R('failed', 'throw:' + (e && e.message)); });
  };
  Engine.prototype.start = function (payload) {
    if (this.running) { this.queue.push(payload.wf.id); this.progress(null); return { queued: true }; }
    this.config = payload.config; this.stage = payload.stage;
    this.wfsById = {}; (payload.allWorkflows || []).forEach(function (w) { this.wfsById[w.id] = w; }, this);
    this.countersToday = payload.countersToday || {};
    this.ctx = { video: {}, counters: {}, vars: {} };
    this.running = true; this.paused = false; this.stopFlag = false; this.stopReason = null;
    // v1.0.2 — Khởi động kiểu resume (sau điều hướng): giữ nguyên mốc phiên +
    // KHÔNG bump sessions lần nữa (vẫn là cùng 1 phiên chạy).
    this.rootWfId = payload.wf.id;
    // P1: runId xuyên suốt cả phiên (kể cả qua điều hướng — payload.runId từ
    // checkpoint), journal ghi theo runId này.
    this.runId = payload.runId || ('run_' + Date.now().toString(36) + '_' + Math.floor(1000 + Math.random() * 9000));
    this.journal = []; this.journalSeq = 0;
    this.resumeFromStep = payload.resumeFromStep || 0;
    // P1 lát 2 — resume full-stack (resumeStack) cũng là resume, kể cả khi
    // bước gốc là 0 (module repeat ở bước đầu): không bump sessions lần nữa.
    var isResume = this.resumeFromStep > 0 || !!(payload.resumeStack && payload.resumeStack.length);
    this.sessionStart = isResume && payload.startedAt ? payload.startedAt : Date.now();
    // Resume: coi toàn bộ thời gian trước điều hướng là ĐÃ cộng vào minutes rồi
    // (số đã lưu trong countersToday) để foldMinutes không cộng trùng.
    this.sessionMinutesCounted = isResume ? Math.max(0, (Date.now() - this.sessionStart) / 60000) : 0;
    var wf = payload.wf;
    var self = this;
    // P1 lát 2 — Deadline toàn phiên tính từ sessionStart (resume giữ nguyên
    // mốc phiên nên deadline không bị gia hạn qua điều hướng).
    this.deadlineAt = this.sessionStart + ((wf.maxRuntimeMin || 60) * 60000);
    this.frameStack = [];
    if (this.captchaTimer) clearInterval(this.captchaTimer);
    this.captchaTimer = setInterval(function () { if (self.running) self.checkCaptcha(); }, 1000);
    this.log('info', isResume ? ('Chạy tiếp WF: ' + wf.name + ' (từ bước ' + this.resumeFromStep + ')') : ('Bắt đầu WF: ' + wf.name), '');
    if (!isResume) this.bumpCounter('sessions');
    this.progress(null);
    this.runWorkflow(wf, 0, payload.resumeStack || null).then(function (res) {
      self.running = false;
      if (self.captchaTimer) clearInterval(self.captchaTimer);
      // P1: outcome suy từ kết quả có kiểu — success chỉ khi mọi bước bắt buộc
      // đều success/skipped; unknown giữ nguyên unknown (không ép thành fail
      // hay success) để tầng trên đối soát.
      var status = (self.stopFlag && self.stopReason) ? 'cancelled' : res.status;
      var reason, outcome;
      if (self.stopReason === 'captcha') { reason = 'captcha'; outcome = 'captcha'; }
      else if (status === 'success') { reason = 'completed'; outcome = 'success'; }
      else if (status === 'unknown') { reason = 'unknown'; outcome = 'unknown'; }
      else if (status === 'cancelled') { reason = self.stopReason || 'user_stop'; outcome = 'fail'; }
      else { reason = self.stopReason || (res.note === 'deadline_exceeded' ? 'deadline_exceeded' : 'failed'); outcome = 'fail'; }
      self.foldMinutes(true);
      self.sessionStart = 0;
      self.hooks.sendStopped({ wfId: wf.id, reason: reason, outcome: outcome, runId: self.runId, journal: self.journal });
      self.progress(null);
      if (self.queue.length && reason === 'completed') {
        var nextId = self.queue.shift(), nw = self.wfsById[nextId];
        if (nw) self.start({ wf: nw, allWorkflows: payload.allWorkflows, config: self.config, stage: self.stage, countersToday: self.countersToday });
      }
    });
    return { started: true };
  };
  Engine.prototype.pause = function () { this.paused = true; this.progress(null); };
  Engine.prototype.resume = function () { this.paused = false; this.progress(null); };
  Engine.prototype.stopAll = function (reason) {
    this.stopFlag = true; this.stopReason = reason || 'user_stop'; this.queue = [];
    this.progress(null);
  };

  TF.Engine = Engine;
})();
