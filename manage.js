/* Auto vjp — manage.html logic.
 * Chỉ nói chuyện với kernel qua action autovjp.* (MODULE-CONTRACT §5b).
 * Không tạo API mới, không đọc/ghi trực tiếp key storage của tầng module.
 */
const $ = id => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PLATFORM_META = {
  instagram: { label: 'Instagram', className: 'instagram' },
  threads: { label: 'Threads', className: 'threads' },
  tiktok: { label: 'TikTok', className: 'tiktok' },
  x: { label: 'X (Twitter)', className: 'x' },
  youtube: { label: 'YouTube', className: 'youtube' },
  probe: { label: 'Probe', className: 'probe' }
};
const TYPE_LABELS = {
  post: 'Đăng bài',
  story: 'Đăng Story',
  upload: 'Tải video lên',
  healthscan: 'Quét sức khoẻ selector',
  reply: 'Trả lời / tương tác',
  affiliate: 'Gắn link',
  scan_account: 'Quét tài khoản',
  nurture: 'Nuôi nick',
  probe: 'Kiểm tra vòng đời'
};
const STATUS_LABELS = {
  queued: 'Đang chờ',
  running: 'Đang chạy',
  success: 'Thành công',
  failed: 'Thất bại',
  uncertain: 'Chưa chắc chắn',
  skipped: 'Đã bỏ qua'
};
const PAGE_META = {
  dashboard: ['Trang chủ', 'Tổng quan hàng đợi, lịch trình và kết quả thi hành trên thiết bị này.'],
  schedule: ['Lịch trình', 'Tạo và theo dõi các lịch local sẽ tự chuyển thành task khi đến hạn.'],
  library: ['Kho nội dung', 'Hàng đợi, phiên đang chạy và kết quả đã hoàn tất trong cùng một nơi.'],
  compose: ['Viết bài mới', 'Tạo task bằng contract local hiện có, đăng ngay hoặc lên lịch.'],
  activity: ['Nhật ký hoạt động', 'Biên lai local ghi lại kết quả và lỗi của từng lần thi hành.'],
  accounts: ['Tài khoản MXH', 'Tài khoản đã quét và lưu hoàn toàn trong trình duyệt này.']
};

let currentState = {
  success: false,
  queue: [],
  schedules: [],
  receipts: [],
  outbox: [],
  accounts: {},
  paused: false,
  currentRun: null,
  learnedSelectors: {},
  platforms: Object.keys(PLATFORM_META).filter(p => p !== 'probe')
};
let activeView = 'dashboard';
let refreshing = false;

const send = message => new Promise(resolve => {
  chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
    else resolve(response || { success: false, error: 'Không nhận được phản hồi từ kernel' });
  });
});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) { return ''; }
};
const fmtTime = ts => ts ? new Date(Number(ts)).toLocaleString('vi-VN', { hour12: false }) : '—';
const fmtDate = ts => ts ? new Date(Number(ts)).toLocaleDateString('vi-VN') : '—';
const truncate = (value, length = 110) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};
const platformLabel = value => PLATFORM_META[value]?.label || String(value || 'Không rõ');
const typeLabel = value => TYPE_LABELS[value] || String(value || 'Task');
const statusLabel = value => STATUS_LABELS[value] || String(value || 'Không rõ');
const statusBadge = status => `<span class="badge badge-${esc(status || 'neutral')}">${esc(statusLabel(status))}</span>`;
const platformChip = platform => `<span class="platform-chip platform-${esc(PLATFORM_META[platform]?.className || 'unknown')}">${esc(platformLabel(platform))}</span>`;
const isToday = ts => {
  if (!ts) return false;
  const d = new Date(Number(ts));
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};
const compactNumber = value => {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
};
function emptyState(title, text, icon = '◇') {
  return `<div class="empty-state"><div class="empty-icon">${esc(icon)}</div><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
}
function setMessage(el, text, kind = '') {
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('is-error', 'is-success');
  if (kind) el.classList.add(`is-${kind}`);
}
function splitLines(value) {
  return String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/* ---------- Điều hướng ---------- */
function showView(name, updateHash = true) {
  if (!PAGE_META[name]) name = 'dashboard';
  activeView = name;
  $$('.view').forEach(view => view.classList.toggle('is-active', view.dataset.view === name));
  $$('[data-nav-target]').forEach(btn => {
    if (btn.classList.contains('nav-item')) btn.classList.toggle('is-active', btn.dataset.navTarget === name);
  });
  $('pageTitle').textContent = PAGE_META[name][0];
  $('pageSubtitle').textContent = PAGE_META[name][1];
  if (updateHash && location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  if (name === 'library') renderLibrary();
  if (name === 'activity') renderActivity();
  if (name === 'accounts') renderAccounts();
}

function bindNavigation() {
  $$('[data-nav-target]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.navTarget)));
  window.addEventListener('hashchange', () => showView(location.hash.replace('#', '') || 'dashboard', false));
}

/* ---------- Đọc & render trạng thái ---------- */
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await send({ action: 'autovjp.listState' });
    if (!state.success) {
      $('runStatus').textContent = `Lỗi đọc trạng thái: ${state.error || 'không rõ'}`;
      $('engineStatus').textContent = 'Không đọc được kernel';
      $('engineDot').className = 'status-dot is-paused';
      return;
    }
    currentState = state;
    populatePlatformFilters();
    renderAll();
  } finally {
    refreshing = false;
  }
}

function renderAll() {
  renderSidebarState();
  renderDashboard();
  renderSchedules();
  renderLibrary();
  renderActivity();
  renderAccounts();
  renderComposeAccounts();
  updateComposeSummary();
  renderLearned();
}

/* ---------- Selector đã học (tự chữa 2.9.0) ---------- */
function renderLearned() {
  const box = $('learnedList');
  if (!box) return;
  const learned = currentState.learnedSelectors || {};
  const ids = Object.keys(learned).sort();
  if (!ids.length) {
    box.innerHTML = emptyState('Chưa học selector nào', 'Selector do AI gợi ý chỉ được lưu sau khi module dùng nó đạt proof thật.', '🩺');
    return;
  }
  box.innerHTML = ids.map(id => {
    const entry = learned[id] || {};
    const spec = entry.spec || {};
    const specText = `${spec.by || '?'}: ${spec.value || ''}${spec.tag ? ` <${spec.tag}>` : ''}`;
    return `<div class="learned-item">
      <div class="learned-main"><strong>${esc(id)}</strong><span>${esc(specText)}</span></div>
      <div class="learned-meta"><span>${esc(fmtTime(entry.at))}</span><span>· ${esc(compactNumber(entry.hits || 0))} lần proof</span></div>
      <button class="text-button" type="button" data-heal-forget="${esc(id)}">Xoá</button>
    </div>`;
  }).join('');
}

function renderSidebarState() {
  const state = currentState;
  $('pausedToggle').checked = Boolean(state.paused);
  $('engineDot').className = `status-dot${state.paused ? ' is-paused' : ' is-live'}`;
  $('engineStatus').textContent = state.paused ? 'Đang tạm dừng nhận việc' : 'Sẵn sàng nhận việc';
  const run = state.currentRun;
  $('runStatus').textContent = run
    ? `Đang chạy ${typeLabel(run.type)} trên ${platformLabel(run.platform)} · task ${run.task_id} · từ ${fmtTime(run.startedAt)}`
    : 'Không có task nào đang chạy. Hàng đợi và lịch vẫn được kernel kiểm tra mỗi phút.';
  $('dashboardPauseNotice').hidden = !state.paused;
}

function receiptTitle(receipt) {
  if (receipt.type === 'probe') return 'Kiểm tra vòng đời hệ thống';
  const target = receipt.target_name || receipt.actor_name;
  return `${typeLabel(receipt.type)}${target ? ` · ${target}` : ''}`;
}
function taskTitle(task) {
  const content = truncate(task.content, 86);
  if (content) return content;
  if (task.source_url) return `${typeLabel(task.type)} · ${truncate(task.source_url, 72)}`;
  return `${typeLabel(task.type)} trên ${platformLabel(task.platform)}`;
}
function taskDetail(task) {
  const bits = [];
  if (task.type === 'nurture') {
    bits.push(`Xem ${task.watch_count ?? '?'} video · tối đa ${task.max_minutes ?? '?'} phút`);
    const acts = [task.like_enabled ? 'like' : '', task.save_enabled ? 'save' : '', task.follow_enabled ? 'follow' : ''].filter(Boolean);
    if (acts.length) bits.push(`Bật: ${acts.join(', ')}`);
  }
  if (task.social_username) bits.push(`@${String(task.social_username).replace(/^@/, '')}`);
  const mediaCount = Array.isArray(task.images) ? task.images.length : (Array.isArray(task.media_urls) ? task.media_urls.length : 0);
  if (mediaCount) bits.push(`${mediaCount} media`);
  if (task.source_url) bits.push(truncate(task.source_url, 76));
  if (task.schedule_id) bits.push('Từ lịch trình');
  return bits.join(' · ') || 'Không có chi tiết bổ sung';
}

function renderDashboard() {
  const state = currentState;
  const queue = state.queue || [];
  const schedules = state.schedules || [];
  const receipts = state.receipts || [];
  const run = state.currentRun;
  const todayCount = receipts.filter(r => isToday(r.received_at)).length
    + queue.filter(t => isToday(t.created_at)).length
    + (run && isToday(run.startedAt) ? 1 : 0);
  $('statToday').textContent = todayCount;
  $('statTotal').textContent = queue.length + schedules.length + receipts.length + (run ? 1 : 0);
  $('statPending').textContent = queue.length;
  $('statRunning').textContent = run ? 1 : 0;

  $('dashboardRecentList').innerHTML = receipts.length
    ? receipts.slice(0, 6).map(r => `
      <div class="timeline-item">
        <span class="timeline-dot ${esc(r.status)}"></span>
        <div class="timeline-content"><strong>${esc(receiptTitle(r))}</strong><p>${esc(truncate(r.message || platformLabel(r.platform), 120))}</p></div>
        <span class="timeline-meta">${esc(fmtTime(r.received_at))}</span>
      </div>`).join('')
    : emptyState('Chưa có kết quả nào', 'Biên lai sẽ xuất hiện sau khi một task hoàn tất hoặc gặp lỗi.', '✓');

  const upcomingSchedules = [...schedules].sort((a, b) => Number(a.run_at) - Number(b.run_at)).map(s => ({
    kind: 'schedule', at: s.run_at, title: taskTitle(s.template || {}), detail: `${taskDetail(s.template || {})}${s.repeat ? ' · Lặp hằng ngày' : ''}`, platform: s.template?.platform
  }));
  const queued = [...queue].sort((a, b) => Number(a.created_at) - Number(b.created_at)).map(t => ({
    kind: 'queued', at: t.created_at, title: taskTitle(t), detail: taskDetail(t), platform: t.platform
  }));
  const upcoming = [...upcomingSchedules, ...queued].slice(0, 7);
  $('dashboardUpcomingList').innerHTML = upcoming.length
    ? upcoming.map(item => `
      <div class="timeline-item">
        <span class="timeline-dot ${item.kind === 'schedule' ? 'running' : 'queued'}"></span>
        <div class="timeline-content"><strong>${esc(item.title)}</strong><p>${esc(platformLabel(item.platform))} · ${esc(item.detail)}</p></div>
        <span class="timeline-meta">${item.kind === 'schedule' ? esc(fmtTime(item.at)) : 'Đang chờ'}</span>
      </div>`).join('')
    : emptyState('Chưa có việc sắp tới', 'Tạo task hoặc đặt lịch để bắt đầu điều phối.', '◷');

  const counts = new Map();
  [...queue, ...receipts, ...(run ? [run] : [])].forEach(item => {
    const key = item.platform || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const max = Math.max(1, ...counts.values());
  const platforms = (state.platforms || []).filter(p => p !== 'probe');
  $('dashboardPlatformList').innerHTML = platforms.map(p => {
    const count = counts.get(p) || 0;
    return `<div class="platform-row"><span>${esc(platformLabel(p))}</span><span class="platform-track"><span class="platform-fill" style="width:${Math.round(count / max * 100)}%"></span></span><strong>${count}</strong></div>`;
  }).join('');

  $('dashboardRunBadge').textContent = run ? 'Đang chạy' : 'Không chạy';
  $('dashboardRunBadge').className = `badge ${run ? 'badge-running' : 'badge-neutral'}`;
  $('dashboardRunDetail').innerHTML = run
    ? `<strong>${esc(typeLabel(run.type))} · ${esc(platformLabel(run.platform))}</strong><br>Task: <code>${esc(run.task_id)}</code><br>Bắt đầu: ${esc(fmtTime(run.startedAt))}<br>${esc(truncate(run.content || run.source_url || 'Task đang được thi hành trong tab managed.', 150))}`
    : 'Kernel đang rảnh. Khi có task đến lượt, thông tin phiên chạy và task hiện tại sẽ xuất hiện tại đây.';
}

function renderSchedules() {
  const schedules = [...(currentState.schedules || [])].sort((a, b) => Number(a.run_at) - Number(b.run_at));
  $('scheduleCountLabel').textContent = `${schedules.length} lịch đang lưu`;
  $('scheduleList').innerHTML = schedules.length
    ? schedules.map(s => {
        const d = new Date(Number(s.run_at));
        const task = s.template || {};
        return `<div class="schedule-item">
          <div class="schedule-date"><div><strong>${d.getDate()}</strong><span>${esc(d.toLocaleDateString('vi-VN', { month: 'short' }))}</span></div></div>
          <div class="schedule-item-main">
            <strong>${esc(taskTitle(task))}</strong>
            <p>${esc(fmtTime(s.run_at))} · ${esc(platformLabel(task.platform))} · ${esc(typeLabel(task.type))}${s.repeat ? ' · Lặp hằng ngày' : ''}</p>
            <p>${esc(taskDetail(task))}</p>
          </div>
          ${statusBadge('queued')}
          <button class="mini-button danger" type="button" data-delsch="${esc(s.id)}">Xoá</button>
        </div>`;
      }).join('')
    : emptyState('Chưa có lịch nào', 'Dùng form bên trái để đặt lịch đăng hoặc quét tài khoản.', '▦');
}

/* ---------- Kho nội dung ---------- */
function libraryEntries() {
  const entries = [];
  if (currentState.currentRun) {
    const run = currentState.currentRun;
    entries.push({ kind: 'run', id: run.task_id, task: run, platform: run.platform, type: run.type, status: 'running', created_at: run.startedAt, title: taskTitle(run), detail: taskDetail(run) });
  }
  (currentState.queue || []).forEach(task => entries.push({
    kind: 'queue', id: task.id, task, platform: task.platform, type: task.type,
    status: task.status || 'queued', created_at: task.created_at, title: taskTitle(task), detail: taskDetail(task)
  }));
  (currentState.receipts || []).forEach(r => entries.push({
    kind: 'receipt', id: r.task_id, receipt: r, platform: r.platform, type: r.type,
    status: r.status, created_at: r.received_at,
    title: receiptTitle(r), detail: r.message || r.result_url || 'Đã có biên lai local'
  }));
  return entries.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
}

function renderLibrary() {
  const query = ($('librarySearch').value || '').toLowerCase();
  const platform = $('libraryPlatformFilter').value;
  const status = $('libraryStatusFilter').value;
  const entries = libraryEntries().filter(entry => {
    if (platform && entry.platform !== platform) return false;
    if (status && entry.status !== status) return false;
    if (!query) return true;
    return [entry.title, entry.detail, entry.platform, entry.type, entry.status, platformLabel(entry.platform), typeLabel(entry.type), statusLabel(entry.status)]
      .join(' ').toLowerCase().includes(query);
  });
  $('libraryCountLabel').textContent = `${entries.length} mục`;
  $('libraryTableBody').innerHTML = entries.length
    ? entries.map(entry => `
      <tr>
        <td class="content-cell"><strong>${esc(entry.title)}</strong><span>${esc(truncate(entry.detail, 150))}</span></td>
        <td>${platformChip(entry.platform)}</td>
        <td>${statusBadge(entry.status)}</td>
        <td>${esc(fmtTime(entry.created_at))}</td>
        <td class="align-right"><div class="row-actions">
          ${entry.kind === 'queue' || entry.kind === 'run' ? `<button class="mini-button danger" type="button" data-cancel="${esc(entry.id)}">Huỷ</button>` : ''}
          ${entry.kind === 'receipt' && safeUrl(entry.receipt.result_url) ? `<a class="mini-button" href="${esc(safeUrl(entry.receipt.result_url))}" target="_blank" rel="noreferrer">Xem kết quả</a>` : ''}
          ${entry.kind === 'receipt' && !safeUrl(entry.receipt.result_url) ? '<span class="muted">Đã lưu</span>' : ''}
        </div></td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="empty-table-cell">${emptyState('Không tìm thấy mục phù hợp', 'Thử thay đổi bộ lọc hoặc tạo một task mới.', '⌕')}</td></tr>`;
}

/* ---------- Nhật ký ---------- */
function renderActivity() {
  const query = ($('activitySearch').value || '').toLowerCase();
  const platform = $('activityPlatformFilter').value;
  const status = $('activityStatusFilter').value;
  const receipts = (currentState.receipts || []).filter(r => {
    if (platform && r.platform !== platform) return false;
    if (status && r.status !== status) return false;
    if (!query) return true;
    return [receiptTitle(r), r.message, r.platform, r.type, r.status, r.actor_name, r.target_name, r.failure_code]
      .join(' ').toLowerCase().includes(query);
  });
  $('activityCountLabel').textContent = `${receipts.length} biên lai`;
  $('receiptList').innerHTML = receipts.length
    ? receipts.map(r => {
        const result = safeUrl(r.result_url);
        const details = [
          r.message,
          r.type === 'healthscan' && Array.isArray(r.items) && r.items.length
            ? `Neo: ${r.items.map(it => `${it.key} → ${it.found_via || 'none'}${it.spec ? ` (${it.spec.by}: ${it.spec.value})` : ''}`).join('; ')}`
            : '',
          r.details ? `Chi tiết: ${r.details}` : '',
          r.actor_name ? `Tài khoản: ${r.actor_name}` : '',
          r.target_name ? `Đích: ${r.target_name}` : '',
          r.failure_code ? `Mã lỗi: ${r.failure_code}` : '',
          r.duration_ms ? `Thời lượng: ${Math.round(Number(r.duration_ms) / 1000)} giây` : ''
        ].filter(Boolean).join(' · ');
        return `<tr>
          <td>${esc(fmtTime(r.received_at))}</td>
          <td class="content-cell"><strong>${esc(receiptTitle(r))}</strong><span>${esc(typeLabel(r.type))} · ${esc(r.task_id || '')}</span></td>
          <td>${platformChip(r.platform)}</td>
          <td>${statusBadge(r.status)}</td>
          <td class="detail-cell">${esc(truncate(details || 'Không có chi tiết bổ sung', 220))}${result ? `<br><a href="${esc(result)}" target="_blank" rel="noreferrer">Mở kết quả</a>` : ''}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5" class="empty-table-cell">${emptyState('Chưa có biên lai phù hợp', 'Kết quả thi hành sẽ được ghi tại đây.', '☰')}</td></tr>`;
}

/* ---------- Tài khoản ---------- */
function flattenedAccounts() {
  const out = [];
  Object.entries(currentState.accounts || {}).forEach(([platform, list]) => {
    (Array.isArray(list) ? list : []).forEach(account => out.push({ ...account, platform: account.platform || platform }));
  });
  return out.sort((a, b) => Number(b.scanned_at || 0) - Number(a.scanned_at || 0));
}
function accountDisplayName(account) {
  return account.social_name || account.social_username || account.social_uid || 'Tài khoản chưa đặt tên';
}
function accountUsername(account) {
  const username = account.social_username || account.social_uid || '';
  return username ? `@${String(username).replace(/^@/, '')}` : 'Chưa có username';
}
function accountInitials(account) {
  const text = String(accountDisplayName(account)).trim();
  return text.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'MX';
}
function renderAccounts() {
  const query = ($('accountSearch').value || '').toLowerCase();
  const platform = $('accountPlatformFilter').value;
  const all = flattenedAccounts();
  const accounts = all.filter(account => {
    if (platform && account.platform !== platform) return false;
    if (!query) return true;
    return [accountDisplayName(account), accountUsername(account), account.platform, account.social_uid].join(' ').toLowerCase().includes(query);
  });
  $('accountTotalLabel').textContent = `${all.length} tài khoản`;
  $('accountCountLabel').textContent = `${accounts.length} tài khoản`;
  $('accountTableBody').innerHTML = accounts.length
    ? accounts.map(account => {
        const metric = account.platform === 'youtube'
          ? (account.subscribers_count ?? account.followers_count)
          : (account.followers_count ?? account.subscribers_count);
        const metricText = metric !== null && metric !== undefined && metric !== '' ? ` · ${compactNumber(metric)} ${account.platform === 'youtube' ? 'người đăng ký' : 'người theo dõi'}` : '';
        return `<tr>
          <td><div class="account-cell"><span class="account-avatar">${esc(accountInitials(account))}</span><span><strong>${esc(accountDisplayName(account))}</strong><span>${esc(accountUsername(account))}${esc(metricText)}</span></span></div></td>
          <td>${platformChip(account.platform)}</td>
          <td>${account.platform === 'youtube' ? 'Kênh' : 'Tài khoản'}</td>
          <td>${statusBadge('success')}</td>
          <td>${esc(fmtDate(account.scanned_at))}<br><span class="muted">${esc(fmtTime(account.scanned_at))}</span></td>
          <td class="align-right"><button class="mini-button" type="button" data-use-account="${esc(account.platform)}" data-account-username="${esc(String(account.social_username || account.social_uid || '').replace(/^@/, ''))}">Dùng để tạo task</button></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" class="empty-table-cell">${emptyState('Chưa có tài khoản phù hợp', 'Chạy quét ở phần trên hoặc thay đổi bộ lọc.', '◎')}</td></tr>`;
}

/* ---------- Bộ lọc ---------- */
function populatePlatformFilters() {
  const platforms = (currentState.platforms && currentState.platforms.length)
    ? currentState.platforms.filter(p => p !== 'probe')
    : Object.keys(PLATFORM_META).filter(p => p !== 'probe');
  [['libraryPlatformFilter'], ['activityPlatformFilter'], ['accountPlatformFilter']].forEach(([id]) => {
    const select = $(id);
    const current = select.value;
    select.innerHTML = '<option value="">Tất cả</option>' + platforms.map(p => `<option value="${esc(p)}">${esc(platformLabel(p))}</option>`).join('');
    select.value = platforms.includes(current) ? current : '';
  });
}

/* ---------- Form & contract ---------- */
function buildTask(prefix) {
  return {
    platform: $(`${prefix}Platform`).value,
    type: $(`${prefix}Type`).value,
    content: $(`${prefix}Content`).value.trim(),
    images: splitLines($(`${prefix}Media`).value),
    source_url: $(`${prefix}SourceUrl`).value.trim(),
    social_username: $(`${prefix}Username`).value.trim().replace(/^@/, ''),
    reply_templates: splitLines($(`${prefix}Templates`).value),
    smart_reply_enabled: $(`${prefix}SmartReply`).checked,
    ai_prompt: $(`${prefix}AiPrompt`).value.trim()
  };
}
function localDateTimeValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function nextHourValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return localDateTimeValue(d);
}

function renderComposeAccounts() {
  const platform = $('fPlatform').value;
  const list = Array.isArray(currentState.accounts?.[platform]) ? currentState.accounts[platform] : [];
  const select = $('fAccountSelect');
  const previous = select.value;
  select.innerHTML = '<option value="">Nhập thủ công bên dưới</option>' + list.map(account => {
    const username = String(account.social_username || account.social_uid || '').replace(/^@/, '');
    return username ? `<option value="${esc(username)}">${esc(accountDisplayName(account))} (${esc(`@${username}`)})</option>` : '';
  }).join('');
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  else if ([...select.options].some(option => option.value === $('fUsername').value.trim().replace(/^@/, ''))) select.value = $('fUsername').value.trim().replace(/^@/, '');
}

function updateComposeSummary() {
  $('summaryPlatform').textContent = platformLabel($('fPlatform').value);
  $('summaryType').textContent = typeLabel($('fType').value);
  const media = splitLines($('fMedia').value);
  $('summaryMedia').textContent = `${media.length} URL`;
  $('contentCounter').textContent = $('fContent').value.length;
  $('mediaPreview').innerHTML = media.slice(0, 8).map(url => `<span class="media-token" title="${esc(url)}">${esc(url)}</span>`).join('');
}

function updatePublishMode() {
  const mode = document.querySelector('input[name="publishMode"]:checked')?.value || 'now';
  $$('.publish-option').forEach(option => {
    const input = option.querySelector('input');
    option.classList.toggle('is-selected', input.checked);
  });
  $('scheduleFields').hidden = mode !== 'schedule';
  $('composeSubmitBtn').textContent = mode === 'schedule' ? 'Thêm vào lịch trình' : 'Thêm task ngay';
  if (mode === 'schedule' && !$('fWhen').value) $('fWhen').value = nextHourValue();
}

async function runProbe() {
  const buttons = [ $('probeBtn'), ...$$('.js-probe') ];
  buttons.forEach(btn => { btn.disabled = true; });
  setMessage($('probeResult'), 'Đang chạy probe…');
  const res = await send({ action: 'autovjp.probe', echo: 'probe-from-manage' });
  setMessage(
    $('probeResult'),
    res.success ? `Probe OK — receipt ${res.receipt.status} cho task ${res.task_id}` : `Probe lỗi: ${res.error || 'không rõ'}`,
    res.success ? 'success' : 'error'
  );
  buttons.forEach(btn => { btn.disabled = false; });
  refresh();
}

function bindEvents() {
  $('taskForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const task = buildTask('f');
    const mode = document.querySelector('input[name="publishMode"]:checked')?.value || 'now';
    let res;
    if (mode === 'schedule') {
      const when = $('fWhen').value ? new Date($('fWhen').value).getTime() : 0;
      if (!when || when <= Date.now()) {
        setMessage($('formMsg'), 'Thời điểm lên lịch phải nằm trong tương lai.', 'error');
        return;
      }
      res = await send({ action: 'autovjp.createSchedule', template: task, run_at: when, repeat: $('fRepeat').value || null });
    } else {
      res = await send({ action: 'autovjp.createTask', task });
    }
    setMessage($('formMsg'), res.success ? (mode === 'schedule' ? 'Đã thêm vào lịch trình.' : 'Đã thêm task vào hàng đợi.') : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    if (res.success) {
      $('taskForm').reset();
      document.querySelector('input[name="publishMode"][value="now"]').checked = true;
      updatePublishMode();
      updateComposeSummary();
      renderComposeAccounts();
    }
    refresh();
  });

  $('scheduleForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const when = $('sRunAt').value ? new Date($('sRunAt').value).getTime() : 0;
    if (!when || when <= Date.now()) {
      setMessage($('scheduleFormMsg'), 'Thời điểm chạy phải nằm trong tương lai.', 'error');
      return;
    }
    const res = await send({ action: 'autovjp.createSchedule', template: buildTask('s'), run_at: when, repeat: $('sRepeat').value || null });
    setMessage($('scheduleFormMsg'), res.success ? 'Đã thêm lịch trình.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    if (res.success) {
      $('scheduleForm').reset();
      $('sRunAt').value = nextHourValue();
    }
    refresh();
  });

  $('nurtureBtn').addEventListener('click', async () => {
    const btn = $('nurtureBtn');
    btn.disabled = true;
    setMessage($('nurtureResult'), 'Đang thêm phiên nuôi mẫu…');
    // Phiên mẫu nhỏ theo plan nuôi TikTok: xem 5 video, like/save bật, tối đa 10 phút.
    // timeout_ms nới hơn thời lượng phiên để watchdog kernel không cắt giữa chừng.
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'tiktok', type: 'nurture',
        watch_count: 5, like_enabled: true, save_enabled: true, follow_enabled: false,
        max_minutes: 10, timeout_ms: 25 * 60 * 1000
      }
    });
    setMessage($('nurtureResult'), res.success ? 'Đã thêm phiên nuôi TikTok vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  // Mẫu comment dự phòng cho phiên nuôi: ngắn, trung tính, không bịa chi
  // tiết — khi AI tab chưa sẵn, adapter vẫn gửi mẫu này (journal ghi rõ
  // source:'template') nên hành vi comment vẫn kiểm chứng được bằng proof.
  const NURTURE_COMMENT_TEMPLATES = [
    'Bài chia sẻ hay quá, cảm ơn bạn nhiều nhé!',
    'Đọc xong thấy rất đồng cảm luôn á.',
    'Nội dung rất hữu ích, mình lưu lại để xem tiếp.'
  ];

  $('nurtureIgBtn').addEventListener('click', async () => {
    const btn = $('nurtureIgBtn');
    btn.disabled = true;
    setMessage($('nurtureIgResult'), 'Đang thêm phiên nuôi mẫu…');
    // Phiên mẫu nhỏ theo plan nuôi đa nền tảng lát 1: tối đa 10 phút / 8 hành
    // động, like + save + comment AI bật, follow TẮT (trần chặt, bật tay sau).
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'instagram', type: 'nurture',
        like_enabled: true, save_enabled: true, follow_enabled: false, comment_enabled: true,
        like_pct: 80, save_pct: 50, comment_pct: 60,
        comment_templates: NURTURE_COMMENT_TEMPLATES,
        max_actions: 8, max_minutes: 10, timeout_ms: 25 * 60 * 1000
      }
    });
    setMessage($('nurtureIgResult'), res.success ? 'Đã thêm phiên nuôi Instagram vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('nurtureThreadsBtn').addEventListener('click', async () => {
    const btn = $('nurtureThreadsBtn');
    btn.disabled = true;
    setMessage($('nurtureThreadsResult'), 'Đang thêm phiên nuôi mẫu…');
    // Phiên mẫu nhỏ theo plan nuôi đa nền tảng lát 2: tối đa 10 phút / 8 hành
    // động, like + reply AI bật, follow TẮT (trần chặt, bật tay sau), kèm
    // comment_templates để reply vẫn kiểm chứng được khi AI tab chưa sẵn.
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'threads', type: 'nurture',
        like_enabled: true, follow_enabled: false, comment_enabled: true,
        like_pct: 80, comment_pct: 60,
        comment_templates: NURTURE_COMMENT_TEMPLATES,
        max_actions: 8, max_minutes: 10, timeout_ms: 25 * 60 * 1000
      }
    });
    setMessage($('nurtureThreadsResult'), res.success ? 'Đã thêm phiên nuôi Threads vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('nurtureXBtn').addEventListener('click', async () => {
    const btn = $('nurtureXBtn');
    btn.disabled = true;
    setMessage($('nurtureXResult'), 'Đang thêm phiên nuôi mẫu…');
    // Phiên mẫu nhỏ theo plan nuôi đa nền tảng lát 3: tối đa 10 phút / 8 hành
    // động, like + reply AI bật, bookmark + follow TẮT (trần chặt, bật tay
    // sau), kèm comment_templates để reply vẫn kiểm chứng được khi AI chưa sẵn.
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'x', type: 'nurture',
        like_enabled: true, bookmark_enabled: false, follow_enabled: false, comment_enabled: true,
        like_pct: 80, comment_pct: 60,
        comment_templates: NURTURE_COMMENT_TEMPLATES,
        max_actions: 8, max_minutes: 10, timeout_ms: 25 * 60 * 1000
      }
    });
    setMessage($('nurtureXResult'), res.success ? 'Đã thêm phiên nuôi X vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('nurtureYtBtn').addEventListener('click', async () => {
    const btn = $('nurtureYtBtn');
    btn.disabled = true;
    setMessage($('nurtureYtResult'), 'Đang thêm phiên nuôi mẫu…');
    // Phiên mẫu nhỏ theo plan nuôi đa nền tảng lát 4: xem 3 video (mỗi video
    // xem thật 30–90s), like + comment AI bật kèm comment_templates,
    // subscribe TẮT (trần chặt, bật tay sau), tối đa 12 phút.
    // search_query: nguồn tìm kiếm dự phòng của adapter (2.5.1) — khi trang
    // chủ + subscriptions đều trống (nick mới chưa có lịch sử xem), adapter
    // tự xoay sang /results?search_query=<mẫu này> để có video mà nuôi.
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'youtube', type: 'nurture',
        watch_count: 3,
        like_enabled: true, subscribe_enabled: false, comment_enabled: true,
        like_pct: 80, comment_pct: 60,
        comment_templates: NURTURE_COMMENT_TEMPLATES,
        search_query: 'tin tức hôm nay',
        max_actions: 8, max_minutes: 12, timeout_ms: 30 * 60 * 1000
      }
    });
    setMessage($('nurtureYtResult'), res.success ? 'Đã thêm phiên nuôi YouTube vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('ytCommentBtn').addEventListener('click', async () => {
    const btn = $('ytCommentBtn');
    btn.disabled = true;
    setMessage($('ytCommentResult'), 'Đang thêm task comment mẫu…');
    // Task comment độc lập (type 'reply', 2.6.0): mở đúng 1 video qua
    // source_url và đăng 1 comment có proof. Video mẫu là clip công khai
    // ổn định (Big Buck Bunny) để kiểm chứng luồng; content mẫu tiếng
    // Việt trung tính. Muốn comment video khác thì tạo task ở form Viết
    // bài mới: platform YouTube + type "Trả lời / tương tác" + source_url
    // là link video + content.
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'youtube', type: 'reply',
        source_url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
        content: 'Video hay và dễ hiểu quá, cảm ơn kênh đã chia sẻ nhé!'
      }
    });
    setMessage($('ytCommentResult'), res.success ? 'Đã thêm task comment YouTube vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('ytUploadBtn').addEventListener('click', async () => {
    const btn = $('ytUploadBtn');
    btn.disabled = true;
    setMessage($('ytUploadResult'), 'Đang thêm task upload mẫu…');
    // Task upload video YouTube (type MỚI 'upload', chỉ youtube,
    // 2.8.0): tải video FULL qua YouTube Studio — video thường và
    // Shorts (dọc <=60s) đi chung 1 luồng, YouTube tự phân loại.
    // content 2 phần: dòng 1 = tiêu đề, các dòng sau = mô tả (module
    // tách theo đúng khuôn đó). Video mẫu ForBiggerEscapes.mp4 là clip
    // công khai ổn định của Google (gtv-videos-bucket).
    // ai_prompt: mẫu dưới đây CỐ Ý comment tắt để test đường thẳng
    // trước (tiêu đề/mô tả lấy nguyên từ content). Muốn bật AI viết
    // tiêu đề + mô tả thì bỏ comment dòng ai_prompt — module sẽ xin AI
    // của lõi qua ai_prompt + content làm chất liệu (AI lỗi thì tự rơi
    // về content gốc, details ai_fallback).
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'youtube', type: 'upload',
        content: 'For Bigger Escapes — video mẫu kiểm chứng Auto vjp\nVideo mẫu công khai của Google (gtv-videos-bucket), dùng để kiểm chứng luồng upload YouTube Studio: tiêu đề lấy từ dòng đầu, phần còn lại là mô tả.',
        images: ['https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'],
        visibility: 'public'
        // ai_prompt: 'Viết tiêu đề hấp dẫn (tối đa 100 ký tự) và mô tả ngắn cho video mẫu này'
      }
    });
    setMessage($('ytUploadResult'), res.success ? 'Đã thêm task upload YouTube vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('igStoryBtn').addEventListener('click', async () => {
    const btn = $('igStoryBtn');
    btn.disabled = true;
    setMessage($('igStoryResult'), 'Đang thêm task story mẫu…');
    // Task Story Instagram (type 'story', 2.7.0): ảnh mẫu 9:16 qua URL.
    // ai_prompt mẫu: module xin AI 1 câu ngắn (<=60 ký tự) chèn lên
    // story; AI lỗi thì dùng content làm chữ chèn (details ai_fallback),
    // chèn chữ fail vẫn đăng story trơn (details ai_overlay_failed).
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'instagram', type: 'story',
        content: 'Chào ngày mới!',
        images: ['https://picsum.photos/seed/autovjp/1080/1920'],
        ai_prompt: 'Viết 1 câu chào ngày mới thật ngắn gọn, vui vẻ để chèn lên story'
      }
    });
    setMessage($('igStoryResult'), res.success ? 'Đã thêm task Story Instagram vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('igReelBtn').addEventListener('click', async () => {
    const btn = $('igReelBtn');
    btn.disabled = true;
    setMessage($('igReelResult'), 'Đang thêm task reels mẫu…');
    // Task Reels Instagram (type 'post' + media VIDEO, 2.7.0): video
    // mẫu công khai ổn định; ai_prompt mẫu -> caption do AI viết (AI
    // lỗi thì dùng content gốc, details ai_fallback). Proof = link
    // /reel/ mới trên lưới profile.
    const res = await send({
      action: 'autovjp.createTask',
      task: {
        platform: 'instagram', type: 'post',
        content: 'Video mẫu từ Auto vjp',
        images: ['https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'],
        ai_prompt: 'Viết caption ngắn vui vẻ cho video này, thêm 3 hashtag'
      }
    });
    setMessage($('igReelResult'), res.success ? 'Đã thêm task Reels Instagram vào hàng đợi.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });
  $('healthscanBtn').addEventListener('click', async () => {
    const btn = $('healthscanBtn');
    btn.disabled = true;
    setMessage($('healthscanResult'), 'Đang thêm 4 task quét sức khoẻ…');
    // Healthscan (2.9.0): 1 task cho mỗi nền tảng có neo mẫu — chỉ
    // định vị qua AVJP.heal, không bấm/tương tác thật. Kết quả về ở
    // Nhật ký (receipt type healthscan, items từng neo found_via).
    const platforms = ['instagram', 'youtube', 'threads', 'tiktok'];
    let okCount = 0;
    let lastError = '';
    for (const platform of platforms) {
      const res = await send({ action: 'autovjp.createTask', task: { platform, type: 'healthscan' } });
      if (res.success) okCount++; else lastError = res.error || 'không rõ';
    }
    setMessage($('healthscanResult'),
      okCount === platforms.length
        ? 'Đã thêm 4 task quét sức khoẻ vào hàng đợi.'
        : `Thêm được ${okCount}/4 task quét${lastError ? ` — lỗi: ${lastError}` : ''}`,
      okCount === platforms.length ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('healForgetAllBtn').addEventListener('click', async () => {
    const btn = $('healForgetAllBtn');
    btn.disabled = true;
    const res = await send({ action: 'autovjp.healForgetAll' });
    setMessage($('healForgetResult'), res.success ? 'Đã xoá hết selector đã học.' : `Lỗi: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  $('pausedToggle').addEventListener('change', async () => {
    await send({ action: 'autovjp.setPaused', paused: $('pausedToggle').checked });
    refresh();
  });
  $('probeBtn').addEventListener('click', runProbe);
  $$('.js-probe').forEach(btn => btn.addEventListener('click', runProbe));
  $('refreshBtn').addEventListener('click', refresh);
  $$('.js-refresh').forEach(btn => btn.addEventListener('click', refresh));
  $('clearReceipts').addEventListener('click', async () => {
    await send({ action: 'autovjp.clearReceipts' });
    refresh();
  });

  ['librarySearch', 'libraryPlatformFilter', 'libraryStatusFilter'].forEach(id => $(id).addEventListener('input', renderLibrary));
  ['activitySearch', 'activityPlatformFilter', 'activityStatusFilter'].forEach(id => $(id).addEventListener('input', renderActivity));
  ['accountSearch', 'accountPlatformFilter'].forEach(id => $(id).addEventListener('input', renderAccounts));

  $('globalSearch').addEventListener('input', () => {
    const value = $('globalSearch').value;
    if (activeView === 'library') { $('librarySearch').value = value; renderLibrary(); }
    if (activeView === 'activity') { $('activitySearch').value = value; renderActivity(); }
    if (activeView === 'accounts') { $('accountSearch').value = value; renderAccounts(); }
  });
  $('globalSearch').addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const value = $('globalSearch').value;
    showView('library');
    $('librarySearch').value = value;
    renderLibrary();
  });

  ['fPlatform', 'fType', 'fContent', 'fMedia'].forEach(id => $(id).addEventListener('input', updateComposeSummary));
  $('fPlatform').addEventListener('change', renderComposeAccounts);
  $('fAccountSelect').addEventListener('change', () => {
    if ($('fAccountSelect').value) $('fUsername').value = $('fAccountSelect').value;
  });
  $$('input[name="publishMode"]').forEach(input => input.addEventListener('change', updatePublishMode));

  $('scanButtons').addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-scan-platform]');
    if (!btn || btn.disabled) return;
    const platform = btn.dataset.scanPlatform;
    btn.disabled = true;
    setMessage($('scanMessage'), `Đang thêm task quét ${platformLabel(platform)}…`);
    const res = await send({ action: 'autovjp.createTask', task: { platform, type: 'scan_account' } });
    setMessage($('scanMessage'), res.success ? `Đã thêm task quét ${platformLabel(platform)}. Kernel sẽ mở tab managed khi task được claim.` : `Lỗi quét ${platformLabel(platform)}: ${res.error || 'không rõ'}`, res.success ? 'success' : 'error');
    btn.disabled = false;
    refresh();
  });

  document.addEventListener('click', async ev => {
    const cancelBtn = ev.target.closest('[data-cancel]');
    if (cancelBtn) {
      cancelBtn.disabled = true;
      await send({ action: 'autovjp.cancelTask', taskId: cancelBtn.dataset.cancel });
      refresh();
      return;
    }
    const deleteScheduleBtn = ev.target.closest('[data-delsch]');
    if (deleteScheduleBtn) {
      deleteScheduleBtn.disabled = true;
      await send({ action: 'autovjp.deleteSchedule', id: deleteScheduleBtn.dataset.delsch });
      refresh();
      return;
    }
    const healForgetBtn = ev.target.closest('[data-heal-forget]');
    if (healForgetBtn) {
      healForgetBtn.disabled = true;
      await send({ action: 'autovjp.healForget', id: healForgetBtn.dataset.healForget });
      refresh();
      return;
    }
    const useAccountBtn = ev.target.closest('[data-use-account]');
    if (useAccountBtn) {
      $('fPlatform').value = useAccountBtn.dataset.useAccount;
      renderComposeAccounts();
      $('fAccountSelect').value = useAccountBtn.dataset.accountUsername || '';
      $('fUsername').value = useAccountBtn.dataset.accountUsername || '';
      updateComposeSummary();
      showView('compose');
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(k => k.startsWith('autovjp.') || k === 'currentAutomationRun')) refresh();
  });
}

/* ---------- Khởi tạo ---------- */
populatePlatformFilters();
bindNavigation();
bindEvents();
$('sRunAt').value = nextHourValue();
updatePublishMode();
updateComposeSummary();
showView(location.hash.replace('#', '') || 'dashboard', false);
refresh();
