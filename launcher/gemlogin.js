/* Auto vjp — đầu nối GemLogin (2.14.0)
 *
 * Client mỏng cho Local API của GemLogin (mặc định http://127.0.0.1:1010, chỉ
 * hoạt động khi ứng dụng GemLogin đang mở). Không phụ thuộc gói ngoài; cần
 * Node >= 18 (fetch có sẵn).
 *
 * Endpoint theo tài liệu GemLogin (mục "Tài liệu API"):
 *   GET  /api/profiles?group_id&page&per_page&sort      danh sách profile
 *   GET  /api/profile/{id}                              một profile
 *   POST /api/profiles/create                           tạo
 *   POST /api/profiles/update/{id}                      sửa
 *   GET  /api/profiles/delete/{id}                      xoá
 *   GET  /api/profiles/start/{id}?addination_args&win_pos&win_size&win_scale   mở
 *   GET  /api/profiles/close/{id}                       đóng
 *   GET  /api/profiles/changeFingerprint?profileIds=    đổi fingerprint
 *   GET  /api/browser_versions                          phiên bản trình duyệt
 *   GET  /api/groups                                    nhóm
 *   GET  /api/scripts · /api/scripts/execute/{id} · /api/scripts/check-status/{id} · /api/scripts/kill-execute/{id}
 *
 * Hình dạng JSON trả về có thể khác nhau giữa các bản GemLogin, nên phần đọc
 * kết quả ở đây viết phòng thủ: chấp nhận mảng nằm ở data / data.profiles /
 * data.data / profiles, và id ở id / profile_id.
 */
'use strict';

function createGemLogin(options = {}) {
  const base = String(options.baseUrl || 'http://127.0.0.1:1010').replace(/\/+$/, '');
  const timeoutMs = Number(options.timeoutMs) || 60000;
  const doFetch = options.fetch || globalThis.fetch;

  async function request(method, path, { query, body } = {}) {
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, text;
    try {
      res = await doFetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      text = await res.text();
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? `quá ${Math.round(timeoutMs / 1000)} giây không phản hồi` : (err && (err.cause?.code || err.message)) || String(err);
      throw new Error(`Không gọi được GemLogin tại ${base} (${reason}). Ứng dụng GemLogin đã mở chưa?`);
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) throw new Error(`GemLogin trả HTTP ${res.status} cho ${path}: ${(json && json.message) || text.slice(0, 200)}`);
    if (json && json.success === false) throw new Error(`GemLogin từ chối ${path}: ${json.message || 'không rõ lý do'}`);
    return json;
  }

  function unwrapList(json) {
    const candidates = [json, json?.data, json?.data?.profiles, json?.data?.data, json?.data?.items, json?.profiles, json?.data?.scripts, json?.data?.groups];
    return candidates.find(Array.isArray) || [];
  }
  const unwrapObject = json => (json && typeof json.data === 'object' && json.data && !Array.isArray(json.data) ? json.data : json) || {};
  function normalizeProfile(p) {
    return {
      id: String(p.id ?? p.profile_id ?? p.uuid ?? ''),
      name: String(p.name ?? p.profile_name ?? ''),
      group: String(p.group_name ?? p.group?.name ?? p.group_id ?? ''),
      raw: p
    };
  }

  return {
    baseUrl: base,
    request,

    // Mọi profile (tự lật trang). sort: 0 mới nhất, 1 cũ nhất, 2 A-Z, 3 Z-A.
    async listProfiles({ groupId, sort, perPage = 100, maxPages = 50 } = {}) {
      const out = [];
      const seen = new Set();
      for (let page = 1; page <= maxPages; page++) {
        const list = unwrapList(await request('GET', '/api/profiles', { query: { group_id: groupId, page, per_page: perPage, sort } }));
        let added = 0;
        for (const item of list) {
          const profile = normalizeProfile(item);
          if (!profile.id || seen.has(profile.id)) continue;
          seen.add(profile.id);
          out.push(profile);
          added++;
        }
        // Dừng khi trang chưa đầy, hoặc bản GemLogin bỏ qua tham số page (trả lại đúng trang cũ).
        if (list.length < perPage || added === 0) break;
      }
      return out;
    },
    async getProfile(id) { return normalizeProfile(unwrapObject(await request('GET', `/api/profile/${encodeURIComponent(id)}`))); },
    async createProfile(fields) { return unwrapObject(await request('POST', '/api/profiles/create', { body: fields })); },
    async updateProfile(id, fields) { return unwrapObject(await request('POST', `/api/profiles/update/${encodeURIComponent(id)}`, { body: fields })); },
    async deleteProfile(id) { return request('GET', `/api/profiles/delete/${encodeURIComponent(id)}`); },

    // Mở profile. Trả {debugAddress, browserPath, driverPath, raw}; debugAddress
    // (vd "127.0.0.1:52345") dùng được để nối Puppeteer/Playwright qua CDP.
    async startProfile(id, { args, winPos, winSize, winScale } = {}) {
      const data = unwrapObject(await request('GET', `/api/profiles/start/${encodeURIComponent(id)}`, {
        // "addination_args" là đúng chính tả của GemLogin, không phải lỗi gõ ở đây.
        query: { addination_args: args, win_pos: winPos, win_size: winSize, win_scale: winScale }
      }));
      return {
        debugAddress: String(data.remote_debugging_address ?? data.remoteDebuggingAddress ?? ''),
        browserPath: String(data.browser_location ?? data.browserLocation ?? ''),
        driverPath: String(data.driver_path ?? data.driverPath ?? ''),
        raw: data
      };
    },
    async closeProfile(id) { return request('GET', `/api/profiles/close/${encodeURIComponent(id)}`); },
    async changeFingerprint(ids) { return request('GET', '/api/profiles/changeFingerprint', { query: { profileIds: [].concat(ids).join(',') } }); },
    async browserVersions() { return unwrapList(await request('GET', '/api/browser_versions')); },
    async listGroups() { return unwrapList(await request('GET', '/api/groups')); },

    // Kịch bản automation của GemLogin (tuỳ chọn — Auto vjp không cần tới).
    async listScripts() { return unwrapList(await request('GET', '/api/scripts')); },
    async executeScript(id, body) { return unwrapObject(await request('POST', `/api/scripts/execute/${encodeURIComponent(id)}`, { body: body || {} })); },
    async scriptStatus(id) { return unwrapObject(await request('GET', `/api/scripts/check-status/${encodeURIComponent(id)}`)); },
    async killScript(id) { return request('GET', `/api/scripts/kill-execute/${encodeURIComponent(id)}`); }
  };
}

module.exports = { createGemLogin };
