// [Auto vjp — modules/tiktok-nurture] Port từ TikTok Farmer v1.2.10, gần nguyên bản.
// Lệch DUY NHẤT so với gốc: note kết quả của module xem_video có thêm hậu tố
// '_skip<N>' (số post quảng cáo/LIVE đã tự lướt qua trong lượt xem đó) để
// adapter tổng hợp được counter skip vào biên lai kernel — xem MODULE.md.
// modules.js — Module registry theo CONTRACT.md v1.0
// Global window.TF, classic script, không dùng import/export/eval.
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.TF = root.TF || {};
  var TF = root.TF;

  // ===== v1.2.7 — Nhận diện post đang active + kiểm chứng chuyển post =====
  // Bài học 2026-11-01 chiều (phiên cửa sổ RDP trên nuc): nút next thật ở
  // layout này là button[data-e2e="feed-navigation-next"] mà danh sách
  // selector cũ không có -> luot_next rơi về ArrowDown + scrollBy, cả hai
  // đều vô hiệu với khung feed của TikTok, post không đổi mà module vẫn
  // báo 'scrolled_next' láo. Post ẢNH còn tự chạy slideshow chuyển ảnh
  // nên nhìn như extension đang "lướt ảnh trong 1 post". Từ nay:
  // - tfActiveItem(): item feed đang nằm giữa viewport (qua elementFromPoint).
  // - tfPostSignature(): "chữ ký" post hiện tại — id video/photo trong URL
  //   trang chi tiết, hoặc link post / tác giả+caption trong item active.
  // - luot_next chỉ báo thành công khi chữ ký THẬT SỰ đổi; không đổi thì
  //   trả lỗi thật 'next_no_change'. xem_video nhận diện post ảnh để xem
  //   ngắn rồi qua thay vì giả vờ xem video.
  function tfActiveItem() {
    try {
      if (typeof document === 'undefined' || typeof window === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
      var el = document.elementFromPoint(Math.floor((window.innerWidth || 0) / 2), Math.floor((window.innerHeight || 0) / 2));
      if (!el || typeof el.closest !== 'function') return null;
      return el.closest('[data-e2e="recommend-list-item-container"]') || el.closest('[data-e2e="feed-item"]') || el.closest('article') || null;
    } catch (e) { return null; }
  }

  function tfPostSignature() {
    try {
      if (typeof location !== 'undefined' && location.pathname) {
        var m = location.pathname.match(/\/(video|photo)\/(\d+)/);
        if (m) return m[1] + ':' + m[2];
      }
      var item = tfActiveItem();
      var scope = item || (typeof document !== 'undefined' ? document : null);
      if (!scope || typeof scope.querySelectorAll !== 'function') return null;
      var links = scope.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]');
      for (var i = 0; i < links.length; i++) {
        var mm = ((links[i].getAttribute && links[i].getAttribute('href')) || '').match(/\/(video|photo)\/(\d+)/);
        if (mm) return mm[1] + ':' + mm[2];
      }
      // v1.2.8 — Post ẢNH ở layout anchoring: item active KHÔNG chứa link
      // post, tác giả hay caption (đo thật trên nuc 2026-11-01: anchors
      // rỗng, author/caption đều null -> chữ ký bản 1.2.7 trả null và
      // luot_next chỉ báo được 'unverified'). Dự phòng bằng chữ ký MEDIA
      // trong chính item: src của <video>/<img> đầu tiên — mỗi post một
      // URL media riêng; carousel giữ các slide thành node DOM riêng nên
      // phần tử đầu ổn định trong cùng 1 post. CHỈ áp dụng khi scope là
      // item thật (không dùng document — tránh vớ phải media tĩnh).
      if (item && typeof item.querySelector === 'function') {
        try {
          var media = item.querySelector('video') || item.querySelector('img');
          var mSrc = media ? (media.currentSrc || media.src || (media.getAttribute && media.getAttribute('src')) || '') : '';
          if (mSrc) return 'media:' + String(mSrc).slice(0, 120);
        } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
      }
      var a = TF.q('authorLink', scope);
      var c = TF.q('captionText', scope);
      var sig = ((a && a.getAttribute && a.getAttribute('href')) || '') + '|' + ((c && (c.textContent || '').slice(0, 60)) || '');
      return sig.length > 1 ? 'weak:' + sig : null;
    } catch (e) { return null; }
  }

  // (2.11.16) Bấm bằng CHUỘT NGƯỜI cho các điểm bấm chính (like / save /
  // follow / mở video): khi module shared/humanmouse.js đã được nạp
  // (window.AVJP.human do contract nạp trước), nhờ SW phát sự kiện chuột
  // THẬT qua CDP thay cho chuỗi sự kiện tổng hợp của TF.clickEl.
  // - AVJP.human vắng mặt (inject cũ/thiếu file): giữ nguyên TF.clickEl.
  // - AVJP.human có mặt: nó TỰ fallback el.click() khi SW không làm
  //   được và trả false — nơi gọi KHÔNG bấm lại lần nữa, tránh bấm trùng
  //   thành unlike/bỏ lưu ở các nút dạng công tắc.
  async function tfHumanClick(el) {
    var H = (typeof window !== 'undefined' && window.AVJP && window.AVJP.human) ||
            (typeof AVJP !== 'undefined' ? AVJP.human : null);
    if (H && typeof H.clickEl === 'function') return H.clickEl(el);
    return TF.clickEl(el);
  }

  // Chờ chữ ký post đổi (tối đa maxTries lần x 400ms). Không có chữ ký gốc
  // thì không kiểm chứng được -> false ngay, nơi gọi tự xử lý.
  async function tfWaitSigChange(sig0, api, maxTries) {
    if (!sig0) return false;
    for (var i = 0; i < (maxTries || 7); i++) {
      await api.sleep(400);
      var s = tfPostSignature();
      if (s && s !== sig0) return true;
    }
    return false;
  }

  // ===== v1.2.9 — PHÂN LOẠI POST theo luật 4 nút (Dũng chốt 2026-11-01
  // 18:41, kèm ảnh chụp feed của chính anh ấy): post có ĐỦ 4 nút tương tác
  // (thích + bình luận + yêu thích/lưu + chia sẻ) trên thanh engagement là
  // VIDEO THƯỜNG; thiếu nút thì là QUẢNG CÁO hoặc LIVE — không tương tác,
  // bỏ qua êm thay vì chết 'not_found' giữa workflow.
  // Bằng chứng đo thật trên nuc cùng ngày:
  // - Post thường: rail [data-e2e="anchoring-engagement-vertical"] chứa đủ
  //   like-icon + comment-icon + favorite-icon + share-icon.
  // - Post LIVE: rail dùng live-like-icon (không có like-icon), kèm khung
  //   [data-e2e="anchoring-live-frame"].
  // - Post quảng cáo: rail chỉ có like/comment/share, KHÔNG có
  //   favorite-icon (đây chính là post khiến save_video chết
  //   'not_found:saveBtn' trong buổi sweep FULL 2026-11-01).
  // Phạm vi đọc: rail anchoring nếu có (layout này rail nằm NGOÀI item
  // feed — đo thật: bên trong item không chứa nút nào), rơi về item active
  // rồi document. Trang chi tiết /(video|photo)/<id> trả 'detail' = không
  // áp dụng (comment_duyet hoạt động ở đó, đừng chặn oan).
  function tfRailScope() {
    try {
      if (typeof document === 'undefined') return null;
      var rail = document.querySelector('[data-e2e="anchoring-engagement-vertical"]');
      if (rail) return rail;
      return tfActiveItem() || document;
    } catch (e) { return null; }
  }

  function tfPostKind() {
    try {
      if (typeof document === 'undefined' || typeof location === 'undefined') return 'unknown';
      if (/\/(video|photo)\/\d+/.test(location.pathname || '')) return 'detail';
      var scope = tfRailScope();
      if (!scope || typeof scope.querySelector !== 'function') return 'unknown';
      var hasE2e = function (e2e) { return !!scope.querySelector('[data-e2e="' + e2e + '"]'); };
      if (hasE2e('live-like-icon')) return 'live';
      if (typeof document.querySelector === 'function' && document.querySelector('[data-e2e="anchoring-live-frame"]')) return 'live';
      var like = !!TF.q('likeBtn', scope);
      var com = !!TF.q('commentBtn', scope);
      var fav = !!TF.q('saveBtn', scope);
      var shr = !!TF.q('shareBtn', scope);
      if (like && com && fav && shr) return 'normal';
      // Chỉ kết luận 'ad' khi scope chính là RAIL anchoring (layout đã đo
      // thật: rail luôn dựng đủ nút cho post thường) mà vẫn thiếu nút.
      // Scope rơi về item/document = layout lạ, nút có thể nằm ở overlay
      // khác -> 'unknown' để xem_video không lọc oan.
      if (scope.getAttribute && scope.getAttribute('data-e2e') === 'anchoring-engagement-vertical') return 'ad';
      return 'unknown';
    } catch (e) { return 'unknown'; }
  }
  TF.postKind = tfPostKind;

  // (v1.2.10 — Dũng chốt lại 2026-11-01 19:06: cơ chế bỏ qua KHÔNG để
  // riêng ở các module tương tác nữa; nó nằm ngay trong xem_video —
  // xem_video mặc định chỉ xem video thường, gặp quảng cáo/LIVE thì tự
  // lướt qua luôn. tfPostKind ở trên chỉ còn là hàm nhận diện dùng chung.)

  // Chuyển sang post tiếp theo CÓ kiểm chứng (thân của luot_next từ
  // v1.2.7, tách ra để xem_video dùng lại khi tự lướt qua quảng cáo/LIVE):
  // thử nút next -> ArrowDown -> wheel trên item active; sau mỗi cách chờ
  // chữ ký post đổi. Không đổi -> 'next_no_change'. Không lấy được chữ ký
  // (DOM lạ) -> 'scrolled_next_unverified'.
  async function tfAdvanceNext(api) {
    var sig0 = tfPostSignature();
    var nextBtn = TF.q('nextBtn');
    if (nextBtn) {
      TF.clickEl(nextBtn);
      if (!sig0) { await api.sleep(api.rand(800, 1500)); return { ok: true, note: 'scrolled_next_unverified' }; }
      if (await tfWaitSigChange(sig0, api, 7)) return { ok: true, note: 'scrolled_next' };
    }
    var evt = (typeof KeyboardEvent === 'function') ? new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      code: 'ArrowDown',
      keyCode: 40,
      which: 40,
      bubbles: true
    }) : null;
    if (evt && typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(evt);
    }
    if (await tfWaitSigChange(sig0, api, 5)) return { ok: true, note: 'scrolled_next' };
    try {
      var item = tfActiveItem();
      if (item && typeof WheelEvent === 'function' && typeof item.dispatchEvent === 'function') {
        item.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: ((typeof window !== 'undefined' && window.innerHeight) || 600) * 0.9, deltaMode: 0 }));
      }
    } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
    if (await tfWaitSigChange(sig0, api, 5)) return { ok: true, note: 'scrolled_next' };
    if (!sig0) {
      if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
        window.scrollBy({ top: (window.innerHeight || 600) * 0.8, behavior: 'smooth' });
      }
      await api.sleep(api.rand(800, 1500));
      return { ok: true, note: 'scrolled_next_unverified' };
    }
    return { ok: false, note: 'next_no_change' };
  }

  TF.MODULES = {
    // ==========================================
    // NHÓM 1: ĐIỀU HƯỚNG (nav)
    // ==========================================
    mo_fyp: {
      id: 'mo_fyp',
      name: 'Mở FYP (Dành cho bạn)',
      icon: '🏠',
      group: 'nav',
      desc: 'Điều hướng tới bảng tin Dành cho bạn (For You Page)',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        if (typeof window !== 'undefined' && location.pathname !== '/foryou' && location.pathname !== '/') {
          await api.gotoUrl('https://www.tiktok.com/foryou');
          return { ok: true, note: 'navigated_to_fyp' };
        }
        var fypLink = (typeof document !== 'undefined') ? document.querySelector('a[href*="/foryou"], [data-e2e="nav-foryou"]') : null;
        if (fypLink) {
          TF.clickEl(fypLink);
          await api.sleep(api.rand(500, 1000));
        }
        return { ok: true, note: 'opened_fyp' };
      }
    },

    mo_following: {
      id: 'mo_following',
      name: 'Mở Following (Đang follow)',
      icon: '👥',
      group: 'nav',
      desc: 'Điều hướng tới bảng tin người đang theo dõi',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        if (typeof window !== 'undefined' && location.pathname !== '/following') {
          await api.gotoUrl('https://www.tiktok.com/following');
          return { ok: true, note: 'navigated_to_following' };
        }
        var folLink = (typeof document !== 'undefined') ? document.querySelector('a[href*="/following"], [data-e2e="nav-following"]') : null;
        if (folLink) {
          TF.clickEl(folLink);
          await api.sleep(api.rand(500, 1000));
        }
        return { ok: true, note: 'opened_following' };
      }
    },

    tim_keyword: {
      id: 'tim_keyword',
      name: 'Tìm theo từ khóa',
      icon: '🔎',
      group: 'nav',
      desc: 'Tìm kiếm video theo từ khóa (ngách) trên TikTok',
      params: [
        { key: 'keyword', label: 'Từ khóa tìm kiếm (để trống lấy từ ngách)', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var kw = (params && params.keyword ? params.keyword : '').trim();
        if (!kw && api.config) {
          var cfg = api.config();
          var kws = (cfg && cfg.niche && cfg.niche.keywords) || [];
          if (kws.length > 0) {
            kw = kws[Math.floor(Math.random() * kws.length)];
          }
        }
        if (!kw) {
          return { ok: true, note: 'no_keyword_provided' };
        }
        await api.gotoUrl('https://www.tiktok.com/search?q=' + encodeURIComponent(kw));
        return { ok: true, note: 'searched_keyword:' + kw };
      }
    },

    tim_hashtag: {
      id: 'tim_hashtag',
      name: 'Tìm theo hashtag',
      icon: '#️⃣',
      group: 'nav',
      desc: 'Tìm kiếm video theo hashtag trong ngách',
      params: [
        { key: 'hashtag', label: 'Hashtag (để trống lấy từ ngách)', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var tag = (params && params.hashtag ? params.hashtag : '').trim();
        if (!tag && api.config) {
          var cfg = api.config();
          var tags = (cfg && cfg.niche && cfg.niche.hashtags) || [];
          if (tags.length > 0) {
            tag = tags[Math.floor(Math.random() * tags.length)];
          }
        }
        if (!tag) {
          return { ok: true, note: 'no_hashtag_provided' };
        }
        tag = tag.replace(/^#/, '');
        await api.gotoUrl('https://www.tiktok.com/tag/' + encodeURIComponent(tag));
        return { ok: true, note: 'searched_hashtag:' + tag };
      }
    },

    mo_profile_creator: {
      id: 'mo_profile_creator',
      name: 'Mở profile creator',
      icon: '👤',
      group: 'nav',
      desc: 'Mở trang cá nhân của creator video hiện tại hoặc theo username',
      params: [
        { key: 'username', label: 'Username (để trống lấy từ video hiện tại)', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var user = (params && params.username ? params.username : '').trim().replace(/^@/, '');
        if (user) {
          await api.gotoUrl('https://www.tiktok.com/@' + user);
          return { ok: true, note: 'opened_profile:' + user };
        }
        var authorLink = TF.q('authorLink');
        if (!authorLink) return { ok: false, note: 'not_found:authorLink' };
        var href = authorLink.getAttribute('href') || '';
        if (href) {
          await api.gotoUrl(href.indexOf('http') === 0 ? href : ('https://www.tiktok.com' + href));
          return { ok: true, note: 'opened_author_profile' };
        }
        TF.clickEl(authorLink);
        await api.sleep(api.rand(800, 1500));
        return { ok: true, note: 'opened_author_profile' };
      }
    },

    mo_thong_bao: {
      id: 'mo_thong_bao',
      name: 'Mở thông báo',
      icon: '🔔',
      group: 'nav',
      desc: 'Mở mục thông báo / hộp thư đến',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var notifBtn = (typeof document !== 'undefined') ? document.querySelector('[data-e2e="inbox-icon"], [data-e2e="nav-inbox"], a[href*="/messages"]') : null;
        if (notifBtn) {
          TF.clickEl(notifBtn);
          await api.sleep(api.rand(1000, 2000));
          return { ok: true, note: 'opened_inbox' };
        }
        await api.gotoUrl('https://www.tiktok.com/messages');
        return { ok: true, note: 'navigated_to_messages' };
      }
    },

    mo_kham_pha: {
      id: 'mo_kham_pha',
      name: 'Mở Khám phá (Explore)',
      icon: '🧭',
      group: 'nav',
      desc: 'Điều hướng tới trang Khám phá trên TikTok',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        if (typeof window !== 'undefined' && location.pathname !== '/explore') {
          await api.gotoUrl('https://www.tiktok.com/explore');
          return { ok: true, note: 'navigated_to_explore' };
        }
        var expLink = (typeof document !== 'undefined') ? document.querySelector('a[href*="/explore"], [data-e2e="nav-explore"]') : null;
        if (expLink) {
          TF.clickEl(expLink);
          await api.sleep(api.rand(500, 1000));
        }
        return { ok: true, note: 'opened_explore' };
      }
    },

    xem_live: {
      id: 'xem_live',
      name: 'Xem LIVE',
      icon: '🔴',
      group: 'nav',
      desc: 'Vào xem một phiên LIVE trong 1-3 phút (tín hiệu tài khoản thật)',
      params: [
        { key: 'durationMin', label: 'Thời gian xem LIVE (phút)', type: 'number', def: 2, min: 1, max: 5 }
      ],
      capsUsed: ['minutes'],
      run: async function (ctx, params, api) {
        if (!api.supervisorCan('minutes')) return { ok: false, skip: true, note: 'capped:minutes' };
        var liveCard = TF.q('liveCard');
        if (liveCard) {
          TF.clickEl(liveCard);
        } else if (typeof window !== 'undefined' && location.pathname.indexOf('/live') < 0) {
          await api.gotoUrl('https://www.tiktok.com/live');
        }
        var watchMs = Math.round(((params && params.durationMin) ? params.durationMin : 2) * 60000);
        await api.sleep(watchMs);
        return { ok: true, note: 'watched_live_' + Math.round(watchMs / 60000) + 'm' };
      }
    },

    // ==========================================
    // NHÓM 2: XEM (watch)
    // ==========================================
    xem_video: {
      id: 'xem_video',
      name: 'Xem video',
      icon: '▶',
      group: 'watch',
      desc: 'Xem 60-100% video hiện tại, trích xuất thông tin tác giả/caption vào ctx.video',
      params: [
        { key: 'minWatchPct', label: '% xem tối thiểu', type: 'number', def: 60, min: 20, max: 100 },
        { key: 'maxWatchPct', label: '% xem tối đa', type: 'number', def: 100, min: 40, max: 100 },
        { key: 'maxSeconds', label: 'Trần thời gian xem (giây)', type: 'number', def: 90, min: 10, max: 300 }
      ],
      capsUsed: ['minutes'],
      run: async function (ctx, params, api) {
        if (!api.supervisorCan('minutes')) return { ok: false, skip: true, note: 'capped:minutes' };
        // v1.2.10 — LỌC NGAY TRONG XEM_VIDEO (Dũng chốt 2026-11-01 19:06,
        // thay cho cơ chế chặn riêng ở module tương tác của v1.2.9):
        // xem_video mặc định CHỈ xem video thường (đủ 4 nút). Gặp quảng
        // cáo/LIVE trên feed thì TỰ LƯỚT QUA LUÔN (tối đa 5 lần, mỗi lần
        // kiểm chứng post đã đổi thật) rồi mới xem; hết 5 lần vẫn không
        // gặp video thường -> fail rõ lý do, không giả vờ đã xem. Trang
        // chi tiết ('detail') và bề mặt lạ ('unknown') không lọc — video
        // được mở đích danh thì cứ xem như cũ.
        var skippedKinds = 0;
        while (true) {
          var kindNow = tfPostKind();
          if (kindNow !== 'live' && kindNow !== 'ad') break;
          if (skippedKinds >= 5) return { ok: false, note: 'only_ads_or_live_skipped_5' };
          var adv = await tfAdvanceNext(api);
          // (Vá Lane F 2026-11-12) Kẹt KHÔNG lướt qua được post quảng cáo/
          // LIVE là tình trạng feed thoáng qua (nút next/ArrowDown/wheel
          // đều không làm đổi chữ ký post), KHÔNG phải lỗi phiên: trả
          // skip:true (đúng idiom capped:like/save trong cùng file) để
          // engine ghi 'skipped' và phiên đi tiếp — luot_next cuối vòng
          // còn một cơ hội lướt nữa. Trước đây trả ok:false thường khiến
          // bước bắt buộc fail -> loop abort -> cả phiên chết
          // execution_error (bằng chứng: journal nuc 2026-11-05 và
          // 2026-11-12 đều gãy đúng note 'skip_stuck_next_no_change' ở
          // vòng lặp 2). 'only_ads_or_live_skipped_5' ở dưới vẫn là fail
          // thật (feed hỏng hẳn sau 5 lần lướt thành công).
          if (!adv.ok) return { ok: false, skip: true, note: 'skip_stuck_' + adv.note };
          skippedKinds++;
          await api.sleep(api.rand(400, 900));
        }
        ctx.skippedNonVideo = skippedKinds;
        // v1.2.7 — POST ẢNH: item active không có <video> nhưng có ảnh
        // (carousel), hoặc đang ở trang /photo/<id> -> xem ngắn 3-6s rồi
        // qua, thay vì chết 'not_found:videoEl' oan / giả vờ xem 90s.
        // (Post ảnh tự chạy slideshow nên trước đây trông như extension
        // "lướt ảnh" mãi trong 1 post.)
        var activeItem = tfActiveItem();
        var isPhotoPost = false;
        if (activeItem && typeof activeItem.querySelector === 'function') {
          try { isPhotoPost = !activeItem.querySelector('video') && !!activeItem.querySelector('img'); } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
        }
        if (!isPhotoPost && typeof location !== 'undefined' && /\/photo\/\d+/.test(location.pathname || '')) isPhotoPost = true;
        if (isPhotoPost) {
          var dwellSec = api.rand(3, 6);
          await api.sleep(dwellSec * 1000);
          api.bumpCounter('watch');
          ctx.video = { creator: '', caption: '', hashtags: [], durationSec: 0, isNiche: false, isPhoto: true, kind: tfPostKind() };
          return { ok: true, note: 'photo_post_watched_' + dwellSec + 's_skip' + skippedKinds };
        }
        var videoEl = await TF.qWait('videoEl', 4000);
        if (!videoEl) return { ok: false, note: 'not_found:videoEl' };

        var duration = (videoEl && !isNaN(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : 20;
        var authorLink = TF.q('authorLink');
        var creator = '';
        if (authorLink) {
          var href = authorLink.getAttribute('href') || '';
          var m = href.match(/\/@([^/?#]+)/);
          creator = m ? m[1] : (authorLink.innerText || '').trim();
        }
        var captionEl = TF.q('captionText');
        var caption = captionEl ? (captionEl.innerText || captionEl.textContent || '').trim() : '';
        var hashtags = (caption.match(/#[\w\u00C0-\u1EF9]+/g) || []).map(function (h) { return h.toLowerCase(); });

        var cfg = api.config ? api.config() : null;
        var isNiche = false;
        if (cfg && cfg.niche) {
          var kws = cfg.niche.keywords || [];
          var tags = cfg.niche.hashtags || [];
          var authors = cfg.niche.creators || [];
          var bl = cfg.niche.blacklist || [];
          var capLow = caption.toLowerCase();
          var userLow = creator.toLowerCase();

          var blacklisted = bl.some(function (b) {
            var bLow = b.toLowerCase();
            return capLow.indexOf(bLow) >= 0 || userLow.indexOf(bLow) >= 0;
          });

          if (blacklisted) {
            isNiche = false;
            ctx.isBlacklist = true;
          } else {
            isNiche = kws.some(function (k) { return capLow.indexOf(k.toLowerCase()) >= 0; }) ||
                      tags.some(function (t) { return hashtags.indexOf(t.toLowerCase()) >= 0 || capLow.indexOf(t.toLowerCase()) >= 0; }) ||
                      authors.some(function (a) { return userLow.indexOf(a.toLowerCase().replace(/^@/, '')) >= 0; });
          }
        }

        ctx.video = {
          creator: creator,
          caption: caption,
          hashtags: hashtags,
          durationSec: duration,
          isNiche: isNiche,
          kind: tfPostKind()
        };

        var minPct = (params && params.minWatchPct != null) ? params.minWatchPct : 60;
        var maxPct = (params && params.maxWatchPct != null) ? params.maxWatchPct : 100;
        var maxSec = (params && params.maxSeconds != null) ? params.maxSeconds : 90;
        var targetPct = api.rand(minPct, maxPct) / 100;
        var watchTimeSec = Math.min(duration * targetPct, maxSec);
        watchTimeSec = Math.max(watchTimeSec, 3);

        await api.sleep(Math.round(watchTimeSec * 1000));
        api.bumpCounter('watch');
        return { ok: true, note: 'watched_' + Math.round(watchTimeSec) + 's_skip' + skippedKinds };
      }
    },

    luot_next: {
      id: 'luot_next',
      name: 'Lướt sang video tiếp theo',
      icon: '⬇',
      group: 'watch',
      desc: 'Chuyển sang post tiếp theo (nút next / ArrowDown / wheel) và kiểm chứng post đã đổi thật',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        // v1.2.7 — KIỂM CHỨNG CHUYỂN POST (xem tfAdvanceNext ở trên; bản
        // cũ báo 'scrolled_next' vô điều kiện). v1.2.10: thân tách thành
        // hàm dùng chung, luot_next chỉ còn là vỏ gọi lại.
        // (Vá Lane F 2026-11-12) Cùng cơ chế chết phiên như nhánh
        // skip_stuck của xem_video: feed không chuyển post được
        // ('next_no_change') là tình trạng thoáng qua -> skip:true để
        // vòng lặp đi tiếp (vòng sau xem_video tự xử lý lại post hiện
        // tại), thay vì ok:false làm chết cả phiên execution_error.
        var r = await tfAdvanceNext(api);
        if (!r.ok) return { ok: false, skip: true, note: r.note };
        return r;
      }
    },

    luot_nhanh_ngoai_ngach: {
      id: 'luot_nhanh_ngoai_ngach',
      name: 'Lướt nhanh video ngoài ngách',
      icon: '⏭',
      group: 'watch',
      desc: 'Xem 2-5 giây rồi lướt để báo hiệu thuật toán bỏ qua chủ đề này',
      params: [
        { key: 'quickWatchSec', label: 'Giây xem lướt', type: 'number', def: 3, min: 2, max: 6 }
      ],
      capsUsed: ['minutes'],
      run: async function (ctx, params, api) {
        var sec = (params && params.quickWatchSec) ? params.quickWatchSec : api.rand(2, 4);
        await api.sleep(Math.round(sec * 1000));

        var nextBtn = TF.q('nextBtn');
        if (nextBtn) {
          TF.clickEl(nextBtn);
        } else {
          var evt = (typeof KeyboardEvent === 'function') ? new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            which: 40,
            bubbles: true
          }) : null;
          if (evt && typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
            document.dispatchEvent(evt);
          }
        }
        await api.sleep(api.rand(600, 1000));
        return { ok: true, note: 'skipped_off_niche' };
      }
    },

    tam_dung: {
      id: 'tam_dung',
      name: 'Tạm dừng video',
      icon: '⏸',
      group: 'watch',
      desc: 'Tạm dừng video 3-15 giây giả lập người dùng dừng xem',
      params: [
        { key: 'pauseSec', label: 'Giây tạm dừng', type: 'number', def: 5, min: 3, max: 15 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var videoEl = TF.q('videoEl');
        if (videoEl && typeof videoEl.pause === 'function') {
          try { videoEl.pause(); } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
        }
        var sec = (params && params.pauseSec) ? params.pauseSec : 5;
        await api.sleep(sec * 1000);
        if (videoEl && typeof videoEl.play === 'function') {
          try { videoEl.play().catch(function () {}); } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
        }
        return { ok: true, note: 'paused_' + sec + 's' };
      }
    },

    doc_comment: {
      id: 'doc_comment',
      name: 'Mở đọc bình luận',
      icon: '💬',
      group: 'watch',
      desc: 'Mở khu vực comment, đọc 5-20 giây rồi đóng',
      params: [
        { key: 'readSec', label: 'Thời gian đọc bình luận (giây)', type: 'number', def: 10, min: 5, max: 30 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var commentBtn = TF.q('commentBtn');
        if (!commentBtn) return { ok: false, note: 'not_found:commentBtn' };
        TF.clickEl(commentBtn);
        var readSec = (params && params.readSec) ? params.readSec : 10;
        await api.sleep(readSec * 1000);

        var closeBtn = (typeof document !== 'undefined') ? document.querySelector('[data-e2e="comment-close-icon"], button[aria-label*="Đóng"], button[aria-label*="Close"]') : null;
        if (closeBtn) TF.clickEl(closeBtn);
        else TF.clickEl(commentBtn);

        await api.sleep(api.rand(500, 1000));
        return { ok: true, note: 'read_comments_' + readSec + 's' };
      }
    },

    xem_profile_creator: {
      id: 'xem_profile_creator',
      name: 'Xem trang profile của creator',
      icon: '🔍',
      group: 'watch',
      desc: 'Vào xem trang cá nhân creator của video hiện tại trong 5-15 giây',
      params: [
        { key: 'staySec', label: 'Thời gian ở lại (giây)', type: 'number', def: 8, min: 5, max: 20 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var authorLink = TF.q('authorLink');
        if (!authorLink) return { ok: false, note: 'not_found:authorLink' };
        TF.clickEl(authorLink);
        var staySec = (params && params.staySec) ? params.staySec : 8;
        await api.sleep(staySec * 1000);
        return { ok: true, note: 'viewed_creator_profile' };
      }
    },

    // ==========================================
    // NHÓM 3: TƯƠNG TÁC (interact)
    // ==========================================
    like_video: {
      id: 'like_video',
      name: 'Thích video',
      icon: '❤',
      group: 'interact',
      desc: 'Bấm thích video nếu chưa like và chưa vượt trần an toàn',
      params: [],
      capsUsed: ['like'],
      run: async function (ctx, params, api) {
        if (!api.supervisorCan('like')) return { ok: false, skip: true, note: 'capped:like' };
        var likeBtn = await TF.qWait('likeBtn', 3000);
        if (!likeBtn) return { ok: false, note: 'not_found:likeBtn' };

        var isPressed = likeBtn.getAttribute('aria-pressed') === 'true' ||
                        likeBtn.getAttribute('aria-selected') === 'true' ||
                        likeBtn.classList.contains('active');
        if (isPressed) {
          return { ok: true, note: 'already_liked' };
        }
        await tfHumanClick(likeBtn);
        api.bumpCounter('like');
        if (ctx.video) ctx.video.liked = true;
        ctx.daLike = true;
        await api.sleep(api.rand(500, 1000));
        return { ok: true, note: 'liked' };
      }
    },

    save_video: {
      id: 'save_video',
      name: 'Yêu thích / Lưu video',
      icon: '⭐',
      group: 'interact',
      desc: 'Thêm video vào mục Yêu thích nếu chưa lưu và chưa vượt trần',
      params: [],
      capsUsed: ['save'],
      run: async function (ctx, params, api) {
        if (!api.supervisorCan('save')) return { ok: false, skip: true, note: 'capped:save' };
        var saveBtn = await TF.qWait('saveBtn', 3000);
        if (!saveBtn) return { ok: false, note: 'not_found:saveBtn' };

        // SỰ THẬT đo trên trang thật 2026-10-31: nút Lưu của TikTok web KHÔNG đổi
        // aria-pressed, KHÔNG đổi tiền tố nhãn khi đã lưu ("Add to Favorites. N added
        // to Favorites" cả trước và sau lưu) — dấu hiệu duy nhất đáng tin là SỐ LƯỢT
        // trong nhãn tăng đúng 1 sau click. (Bản cũ match substring 'added' nên tưởng
        // video nào cũng đã lưu -> không bao giờ click.)
        function favCount(el) {
          if (!el) return null;
          var m = (el.getAttribute('aria-label') || '').match(/([\d,]+)\s+added to Favorites/i);
          return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
        }
        if (saveBtn.getAttribute('aria-pressed') === 'true') {
          return { ok: true, note: 'already_saved' };
        }
        var before = favCount(saveBtn);
        await tfHumanClick(saveBtn);
        await api.sleep(api.rand(900, 1300));
        var btn2 = TF.q('saveBtn');
        var after = favCount(btn2);
        if (before != null && after != null) {
          if (after === before + 1) {
            api.bumpCounter('save');
            if (ctx.video) ctx.video.saved = true;
            ctx.daSave = true;
            return { ok: true, note: 'saved' };
          }
          if (after === before - 1) {
            // Video vốn đã lưu, click vừa rồi là BỎ lưu -> click lại để khôi phục.
            await tfHumanClick(btn2);
            return { ok: true, note: 'already_saved' };
          }
          return { ok: false, note: 'save_unverified' };
        }
        // Không đọc được số lượt (UI khác) -> fallback aria-pressed.
        if (btn2 && btn2.getAttribute('aria-pressed') === 'true') {
          api.bumpCounter('save');
          if (ctx.video) ctx.video.saved = true;
          ctx.daSave = true;
          return { ok: true, note: 'saved' };
        }
        return { ok: false, note: 'save_unverified' };
      }
    },

    follow_creator: {
      id: 'follow_creator',
      name: 'Follow creator',
      icon: '➕',
      group: 'interact',
      desc: 'Theo dõi creator của video hiện tại (mặc định tắt)',
      params: [],
      capsUsed: ['follow'],
      run: async function (ctx, params, api) {
        if (!api.supervisorCan('follow')) return { ok: false, skip: true, note: 'capped:follow' };
        var followBtn = TF.q('followBtn');
        if (!followBtn) return { ok: false, note: 'not_found:followBtn' };

        var txt = (followBtn.innerText || followBtn.textContent || '').trim().toLowerCase();
        var aria = (followBtn.getAttribute('aria-label') || '').toLowerCase();
        var isFollowing = txt.indexOf('đang follow') >= 0 || txt.indexOf('following') >= 0 ||
                          txt.indexOf('bạn bè') >= 0 || txt.indexOf('friends') >= 0 ||
                          aria.indexOf('đang follow') >= 0 || aria.indexOf('following') >= 0;
        if (isFollowing) {
          return { ok: true, note: 'already_following' };
        }
        await tfHumanClick(followBtn);
        api.bumpCounter('follow');
        await api.sleep(api.rand(800, 1500));
        return { ok: true, note: 'followed' };
      }
    },

    follow_danh_sach: {
      id: 'follow_danh_sach',
      name: 'Follow theo danh sách',
      icon: '📋',
      group: 'interact',
      desc: 'Theo dõi tài khoản từ danh sách đích cấu hình',
      params: [
        { key: 'username', label: 'Username cần theo dõi', type: 'text', def: '' }
      ],
      capsUsed: ['follow'],
      run: async function (ctx, params, api) {
        if (!api.supervisorCan('follow')) return { ok: false, skip: true, note: 'capped:follow' };
        var user = (params && params.username ? params.username : '').trim().replace(/^@/, '');
        if (!user) return { ok: false, note: 'missing_username' };

        var curPath = (typeof location !== 'undefined') ? location.pathname : '';
        if (curPath.indexOf('/@' + user) < 0) {
          await api.gotoUrl('https://www.tiktok.com/@' + user);
          return { ok: true, note: 'navigated_to_user:' + user };
        }
        var followBtn = TF.q('followBtn');
        if (!followBtn) return { ok: false, note: 'not_found:followBtn' };

        var txt = (followBtn.innerText || followBtn.textContent || '').trim().toLowerCase();
        if (txt.indexOf('đang follow') >= 0 || txt.indexOf('following') >= 0 || txt.indexOf('bạn bè') >= 0) {
          return { ok: true, note: 'already_following' };
        }
        await tfHumanClick(followBtn);
        api.bumpCounter('follow');
        await api.sleep(api.rand(800, 1500));
        return { ok: true, note: 'followed:' + user };
      }
    },

    unfollow_duyet: {
      id: 'unfollow_duyet',
      name: 'Unfollow theo danh sách duyệt',
      icon: '➖',
      group: 'interact',
      desc: 'Hủy follow tài khoản theo danh sách đã duyệt',
      params: [
        { key: 'username', label: 'Username cần hủy follow', type: 'text', def: '' },
        { key: 'approvalId', label: 'ID phê duyệt', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var user = (params && params.username ? params.username : '').trim().replace(/^@/, '');
        if (!user) return { ok: false, note: 'missing_username' };

        // P1 lát 3 — Module này trước đây KHÔNG có cổng duyệt nào dù tên là
        // "_duyet" và có sẵn param approvalId. Nay bắt buộc bản ghi duyệt thật
        // trong hàng đợi 'unfollows': status approved, chưa hết hạn, username
        // khớp bản ghi; tiêu thụ (done) khi đạt trạng thái đích.
        var ufApprovalId = (params.approvalId || '').trim();
        if (!ufApprovalId) return { ok: false, note: 'missing_approval_id' };
        if (typeof TF.storeGet !== 'function') return { ok: false, note: 'approval_store_unavailable' };
        var ufAll = await TF.storeGet('tf_approvals_v1');
        var ufList = (ufAll && ufAll.unfollows) || [];
        var ufItem = null;
        for (var ui = 0; ui < ufList.length; ui++) if (ufList[ui].id === ufApprovalId) { ufItem = ufList[ui]; break; }
        if (!ufItem) return { ok: false, note: 'approval_not_found' };
        if (ufItem.status !== 'approved') return { ok: false, note: 'not_approved' };
        if (ufItem.expiresAt && Date.now() > ufItem.expiresAt) return { ok: false, note: 'approval_expired' };
        if (ufItem.username && ufItem.username.replace(/^@/, '').toLowerCase() !== user.toLowerCase()) return { ok: false, note: 'approval_target_mismatch' };
        async function ufConsume() {
          try { ufItem.status = 'done'; ufItem.doneAt = Date.now(); await TF.storeSet({ tf_approvals_v1: ufAll }); } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
        }

        var curPath = (typeof location !== 'undefined') ? location.pathname : '';
        if (curPath.indexOf('/@' + user) < 0) {
          await api.gotoUrl('https://www.tiktok.com/@' + user);
          return { ok: true, note: 'navigated_to_user:' + user };
        }
        var followBtn = TF.q('followBtn');
        if (!followBtn) return { ok: false, note: 'not_found:followBtn' };

        var txt = (followBtn.innerText || followBtn.textContent || '').trim().toLowerCase();
        var aria = (followBtn.getAttribute('aria-label') || '').toLowerCase();
        var isFollowing = txt.indexOf('đang follow') >= 0 || txt.indexOf('following') >= 0 ||
                          txt.indexOf('bạn bè') >= 0 || aria.indexOf('following') >= 0;
        if (!isFollowing) {
          await ufConsume();
          return { ok: true, note: 'already_unfollowed' };
        }
        TF.clickEl(followBtn);
        await api.sleep(api.rand(800, 1500));

        var confirmBtn = (typeof document !== 'undefined') ? document.querySelector('button[data-e2e="confirm-popup-button"], [role="dialog"] button:last-child') : null;
        if (confirmBtn) {
          TF.clickEl(confirmBtn);
          await api.sleep(api.rand(500, 1000));
        }
        await ufConsume();
        return { ok: true, note: 'unfollowed:' + user };
      }
    },

    // ==========================================
    // NHÓM 4: ĐĂNG BÀI (post)
    // ==========================================
    comment_duyet: {
      id: 'comment_duyet',
      name: 'Bình luận (đã duyệt)',
      icon: '✍',
      group: 'post',
      desc: 'Gửi bình luận đã được phê duyệt trước bởi người dùng',
      params: [
        { key: 'approvalId', label: 'Mã bình luận đã duyệt', type: 'text', def: '' },
        { key: 'text', label: 'Nội dung bình luận', type: 'text', def: '' },
        { key: 'approved', label: 'Đã duyệt phê duyệt', type: 'boolean', def: false }
      ],
      capsUsed: ['comment'],
      run: async function (ctx, params, api) {
        if (!params || !params.approved) {
          return { ok: false, note: 'not_approved' };
        }
        // P1 lát 3 — Cổng bản ghi duyệt THẬT (bản cũ chỉ nhìn cờ boolean trong
        // params, ai sửa WF cũng tự "duyệt" được): phải có bản ghi trong hàng
        // đợi, status 'approved', chưa hết hạn; nội dung bị ràng buộc vào bản
        // ghi — params.text khác bản ghi thì từ chối; dùng xong đánh dấu 'done'
        // (mỗi bản ghi chỉ dùng 1 lần).
        var approvalId = (params.approvalId || '').trim();
        if (!approvalId) return { ok: false, note: 'missing_approval_id' };
        if (typeof TF.storeGet !== 'function') return { ok: false, note: 'approval_store_unavailable' };
        var apAll = await TF.storeGet('tf_approvals_v1');
        var cList = (apAll && apAll.comments) || [];
        var cItem = null;
        for (var ci = 0; ci < cList.length; ci++) if (cList[ci].id === approvalId) { cItem = cList[ci]; break; }
        if (!cItem) return { ok: false, note: 'approval_not_found' };
        if (cItem.status !== 'approved') return { ok: false, note: 'not_approved' };
        if (cItem.expiresAt && Date.now() > cItem.expiresAt) return { ok: false, note: 'approval_expired' };
        var text = (cItem.text || '').trim();
        if (!text) text = (params.text || '').trim();
        else if (params.text && params.text.trim() !== text) return { ok: false, note: 'approval_text_mismatch' };
        if (!text) return { ok: false, note: 'missing_comment_text' };
        if (!api.supervisorCan('comment')) return { ok: false, skip: true, note: 'capped:comment' };

        // v1.2.5 — MỞ PANEL KIÊN NHẪN + GÕ QUA PIPELINE SOẠN THẢO THẬT.
        // Bài học 2026-11-01 (Chrome cửa sổ trong phiên remote của Dũng):
        // (1) Sau khi bấm icon comment, ô nhập mount chậm hơn headless nhiều
        // — bản cũ chỉ chờ 600–1000ms một lần rồi bỏ cuộc
        // ('not_found:commentInput' oan). Nay thăm dò tới ~8s.
        // (2) Gán thẳng textContent = phá cấu trúc DOM nội bộ của editor
        // rich-text: chữ hiện trong ô nhưng mô hình editor vẫn rỗng -> nút
        // Post giữ disabled -> TF.clickEl bấm vào nút chết, chữ nằm lại
        // trong ô, kiểm chứng báo 'comment_unverified'. Nay gõ bằng
        // execCommand selectAll/delete/insertText (đi qua đúng pipeline
        // soạn thảo của trình duyệt, editor nhận chữ thật); chỉ khi môi
        // trường không có execCommand mới quay về cách gán cũ.
        // (3) Sau khi gõ mà nút Post vẫn disabled = editor chưa nhận chữ:
        // nudge thêm 1 sự kiện input + chờ ngắn, vẫn disabled thì fail
        // 'comment_submit_disabled' rõ lý do — không bấm bừa, không đếm.
        // v1.2.6 — VÒNG MỞ PANEL: thăm dò + bấm lặp có nhịp tới ~14s.
        // Bài học 2026-11-01 chiều (bản 1.2.5 chạy thật): module vẫn chết
        // 'not_found:commentInput' — vì bản cũ (và 1.2.5) chỉ tìm icon
        // comment ĐÚNG MỘT LẦN ngay khi module bắt đầu; lúc đó SPA còn chưa
        // dựng xong rail icon (trang video vừa điều hướng trong phiên cửa
        // sổ bị throttle) -> không bấm được -> ô nhập không bao giờ tự mở
        // mà module chỉ ngồi chờ ô. Kiểm chứng tay trên đúng trang đó:
        // icon là thẻ DIV [data-e2e="comment-icon"], bấm vào là panel
        // Comments mở và ô nhập hiện trong ~3.5s. Nay: mỗi giây kiểm tra
        // ô nhập; chưa có thì tìm icon và bấm (cách nhau >= 3s, tránh bấm
        // liên tục làm đóng/mở panel), tối đa ~14s.
        var commentInput = TF.q('commentInput');
        if (!commentInput) {
          var lastClickAt = 0;
          for (var pw = 0; pw < 14 && !commentInput; pw++) {
            var nowMs = Date.now();
            if (nowMs - lastClickAt >= 3000) {
              var commentBtn = TF.q('commentBtn');
              if (commentBtn) { TF.clickEl(commentBtn); lastClickAt = nowMs; }
            }
            await api.sleep(1000);
            commentInput = TF.q('commentInput');
          }
        }
        if (!commentInput) return { ok: false, note: 'not_found:commentInput' };

        commentInput.focus();
        var isEditable = commentInput.getAttribute('contenteditable') === 'true';
        if (isEditable) {
          var typedOk = false;
          var edDoc = commentInput.ownerDocument || (typeof document !== 'undefined' ? document : null);
          if (edDoc && typeof edDoc.execCommand === 'function') {
            try {
              edDoc.execCommand('selectAll', false, null);
              edDoc.execCommand('delete', false, null);
              typedOk = edDoc.execCommand('insertText', false, text) &&
                (commentInput.textContent || '').indexOf(text) >= 0;
            } catch (e) { typedOk = false; }
          }
          if (!typedOk) {
            commentInput.textContent = text;
            if (typeof commentInput.dispatchEvent === 'function' && typeof InputEvent === 'function') {
              commentInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            }
          }
        } else {
          commentInput.value = text;
          if (typeof commentInput.dispatchEvent === 'function' && typeof Event === 'function') {
            commentInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        await api.sleep(api.rand(600, 1000));

        var commentSubmit = TF.q('commentSubmit');
        if (!commentSubmit) return { ok: false, note: 'not_found:commentSubmit' };
        if (commentSubmit.disabled === true) {
          if (typeof commentInput.dispatchEvent === 'function' && typeof InputEvent === 'function') {
            try { commentInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
          }
          await api.sleep(800);
          commentSubmit = TF.q('commentSubmit') || commentSubmit;
          if (commentSubmit.disabled === true) return { ok: false, note: 'comment_submit_disabled' };
        }

        // v1.2.4 — KIỂM CHỨNG SAU KHI BẤM ĐĂNG. Bài học đắt giá 2026-11-01:
        // 4 comment bị ghi 'comment_posted' giả — bản cũ bấm Post xong là đếm
        // + tiêu thụ bản ghi + báo ok ngay, trong khi TikTok hủy submit tại
        // thời điểm captcha bật lên nên comment không hề lên server (kiểm
        // chứng tận nơi: cả 4 video đều 0 comment). Từ nay chỉ tính là đã
        // đăng khi THẤY comment của mình xuất hiện thật trong danh sách:
        // số item chứa đúng text phải TĂNG so với trước khi bấm (tránh khớp
        // nhầm comment cũ trùng nội dung). Không thấy -> fail thẳng, KHÔNG
        // đếm counter, KHÔNG tiêu thụ bản ghi duyệt (để còn nguyên chạy lại).
        var countMine = function () {
          var n = 0;
          try {
            var items = (typeof TF.qa === 'function') ? TF.qa('commentItem') : [];
            for (var ii = 0; ii < items.length; ii++) {
              var itx = (items[ii].innerText || items[ii].textContent || '');
              if (itx.indexOf(text) >= 0) n++;
            }
          } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
          return n;
        };
        var beforeCount = countMine();
        TF.clickEl(commentSubmit);
        var verified = false;
        var blockedByCaptcha = false;
        for (var attempt = 0; attempt < 10 && !verified; attempt++) {
          await api.sleep(1000);
          if (typeof TF.isCaptchaVisible === 'function' && TF.isCaptchaVisible()) { blockedByCaptcha = true; break; }
          if (countMine() > beforeCount) verified = true;
        }
        if (!verified) {
          return { ok: false, note: blockedByCaptcha ? 'comment_blocked_captcha' : 'comment_unverified' };
        }
        api.bumpCounter('comment');
        // P1 lát 3 — Tiêu thụ bản ghi duyệt: đánh dấu 'done' để không dùng lại.
        // (v1.2.4: chỉ tiêu thụ SAU khi đã kiểm chứng comment hiện thật.)
        try {
          cItem.status = 'done'; cItem.doneAt = Date.now();
          await TF.storeSet({ tf_approvals_v1: apAll });
        } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
        return { ok: true, note: 'comment_posted' };
      }
    },

    mo_video_cu_the: {
      id: 'mo_video_cu_the',
      name: 'Mở video cụ thể (theo link)',
      icon: '🎯',
      group: 'nav',
      desc: 'Mở đúng 1 video theo link hoặc @user + mã video — cho seeding 1 video (2 pha qua điều hướng)',
      params: [
        { key: 'url', label: 'Link video TikTok', type: 'text', def: '' },
        { key: 'username', label: 'Username (nếu không dùng link)', type: 'text', def: '' },
        { key: 'videoId', label: 'Mã video (nếu không dùng link)', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var target = ((params && params.url) || '').trim();
        if (!target && params && params.username && params.videoId) {
          target = 'https://www.tiktok.com/@' + String(params.username).replace(/^@/, '') + '/video/' + String(params.videoId).trim();
        }
        if (!target) return { ok: false, note: 'missing_target' };
        var m = target.match(/\/video\/(\d+)/);
        var targetId = m ? m[1] : null;
        var path = (typeof location !== 'undefined' ? location.pathname : '') || '';
        var pm = path.match(/\/(?:video|photo)\/(\d+)/);
        var curId = pm ? pm[1] : null;
        async function verifyHere(idForCtx) {
          var v = await TF.qWait('videoEl', 12000);
          if (!v) return { ok: false, note: 'video_not_loaded' };
          ctx.video = ctx.video || {};
          ctx.video.id = idForCtx || curId;
          ctx.video.url = target;
          return { ok: true, note: 'opened_video_' + (idForCtx || curId) };
        }
        if (targetId && curId === targetId) return verifyHere(targetId);
        // Link rút gọn (không có sẵn mã video): đã điều hướng 1 lần và đang đứng
        // ở trang video/photo thì chấp nhận luôn, tránh lặp điều hướng vô hạn.
        var pendingV = await TF.storeGet('tf_pending_video_v1');
        if (pendingV && pendingV.url === target && curId) {
          await TF.storeSet({ tf_pending_video_v1: null });
          return verifyHere(curId);
        }
        await TF.storeSet({ tf_pending_video_v1: { url: target, ts: Date.now() } });
        await api.gotoUrl(target, { repeat: true });
        return { ok: true, note: 'navigating_to_video' };
      }
    },

    mo_video_profile: {
      id: 'mo_video_profile',
      name: 'Mở video trên profile',
      icon: '👤',
      group: 'watch',
      desc: 'Bấm vào 1 video trong lưới bài đăng của trang profile đang mở (theo số thứ tự) — cho seeding 1 người',
      params: [
        { key: 'index', label: 'Số thứ tự video (0 = đầu tiên)', type: 'number', def: 0, min: 0, max: 99 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var idx = (params && params.index) ? +params.index : 0;
        var items = null;
        var deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          if (api.checkStop()) return { ok: false, note: 'stopped' };
          // Lưới trống có thể vì captcha chắn (gặp thật 31/10: modal puzzle che
          // lưới profile) — báo đúng nguyên nhân thay vì not_found chung chung.
          if (typeof TF.isCaptchaVisible === 'function' && TF.isCaptchaVisible()) {
            return { ok: false, note: 'captcha_present' };
          }
          items = TF.qa('profilePostItem');
          if (items && items.length > idx) break;
          await api.sleep(600);
        }
        if (!items || !items.length) {
          // v1.2.1 — Lưới profile có thể chết phía TikTok ("Something went
          // wrong" thay cho lưới, gặp thật trên nuc 31/10): báo đúng nguyên
          // nhân thay vì not_found chung chung để khỏi nghi oan selector.
          var pageText = '';
          try { pageText = (typeof document !== 'undefined' && document.body && document.body.innerText) || ''; } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
          if (/something went wrong/i.test(pageText)) return { ok: false, note: 'grid_load_failed' };
          return { ok: false, note: 'not_found:profilePostItem' };
        }
        if (idx >= items.length) return { ok: false, note: 'index_out_of_range:' + items.length };
        await tfHumanClick(items[idx]);
        var v = await TF.qWait('videoEl', 12000);
        if (!v) return { ok: false, note: 'video_not_opened' };
        await api.sleep(800);
        var pm = ((typeof location !== 'undefined' ? location.pathname : '') || '').match(/\/(?:video|photo)\/(\d+)/);
        ctx.video = ctx.video || {};
        if (pm) ctx.video.id = pm[1];
        return { ok: true, note: 'opened_profile_video_' + idx };
      }
    },

    dang_video_duyet: {
      id: 'dang_video_duyet',
      name: 'Đăng video (đã duyệt)',
      icon: '🎬',
      group: 'post',
      desc: 'Đăng video lên TikTok Studio từ mục duyệt có đính kèm file (2 pha: mở Studio → gắn file, điền caption, bấm Đăng)',
      params: [
        { key: 'approvalId', label: 'ID video đã duyệt (trong Hàng đợi duyệt)', type: 'text', def: '' },
        { key: 'approved', label: 'Đã duyệt bấm Đăng', type: 'boolean', def: false }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        // v1.1.0 — Viết lại cho TikTok Studio. Bản cũ chỉ điền caption và giả
        // định người dùng đã chọn file bằng tay nên không bao giờ tự đăng được.
        // Bản này lấy FILE THẬT từ mục duyệt (fileData đính kèm khi thêm mục ở
        // trang Options):
        //   Pha A (chưa ở Studio Upload): kiểm cổng duyệt → lưu pending →
        //     điều hướng Studio, resume LẶP LẠI chính bước này.
        //   Pha B (đang ở Studio Upload): gắn file vào input (DataTransfer),
        //     chờ tải lên xong, điền caption (execCommand insertText — hợp với
        //     trình soạn Draft.js của Studio), bấm Post bằng TF.clickEl, chờ
        //     xác nhận rồi đánh dấu mục duyệt = done.
        var STUDIO_UPLOAD = 'https://www.tiktok.com/tiktokstudio/upload';
        var onStudio = typeof location !== 'undefined' && ((location.pathname || '').indexOf('/tiktokstudio/upload') === 0);

        async function loadItem(approvalId) {
          var ap = await TF.storeGet('tf_approvals_v1');
          var list = (ap && ap.uploads) || [];
          for (var i = 0; i < list.length; i++) if (list[i].id === approvalId) return list[i];
          return null;
        }

        var pending = await TF.storeGet('tf_pending_upload_v1');
        var approvalId = (pending && pending.approvalId) || (params && params.approvalId) || '';

        if (!onStudio) {
          // ----- Pha A: kiểm cổng trước khi điều hướng -----
          if (!params || !params.approved) return { ok: false, note: 'not_approved' };
          if (!approvalId) return { ok: false, note: 'missing_approval_id' };
          var itemA = await loadItem(approvalId);
          if (!itemA) return { ok: false, note: 'approval_not_found' };
          if (itemA.status !== 'approved') return { ok: false, note: 'not_approved' };
          if (itemA.expiresAt && Date.now() > itemA.expiresAt) return { ok: false, note: 'approval_expired' };
          if (!itemA.fileData) return { ok: false, note: 'no_file_attached' };
          await TF.storeSet({ tf_pending_upload_v1: { approvalId: approvalId, ts: Date.now() } });
          await api.gotoUrl(STUDIO_UPLOAD, { repeat: true });
          return { ok: true, note: 'navigating_to_studio' };
        }

        // ----- Pha B: đang ở Studio Upload -----
        if (!approvalId) return { ok: false, note: 'missing_approval_id' };
        var item = await loadItem(approvalId);
        if (!item) return { ok: false, note: 'approval_not_found' };
        if (item.status !== 'approved') return { ok: false, note: 'not_approved' };
        if (item.expiresAt && Date.now() > item.expiresAt) return { ok: false, note: 'approval_expired' };
        if (!item.fileData) return { ok: false, note: 'no_file_attached' };

        var input = await TF.qWait('uploadFileInput', 20000);
        if (!input) return { ok: false, note: 'not_found:uploadFileInput' };
        try {
          // Giải mã data URL thủ công (không dùng fetch — giữ luật "module không
          // fetch" của CONTRACT; đây là dữ liệu nội bộ, không phải mạng).
          var comma = item.fileData.indexOf(',');
          var mimeM = (item.fileData.slice(0, comma).match(/:(.*?);/) || [])[1];
          var bin = atob(item.fileData.slice(comma + 1));
          var bytes = new Uint8Array(bin.length);
          for (var bi = 0; bi < bin.length; bi++) bytes[bi] = bin.charCodeAt(bi);
          var blob = new Blob([bytes], { type: mimeM || 'video/mp4' });
          var file = new File([blob], item.fileName || 'video.mp4', { type: blob.type || 'video/mp4' });
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
          return { ok: false, note: 'attach_file_failed:' + (e && e.message) };
        }

        // Chờ tải lên xong: ô caption xuất hiện + trạng thái báo Uploaded/tên file
        var captionEl = null;
        var deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
          if (api.checkStop()) return { ok: false, note: 'stopped' };
          captionEl = TF.q('uploadCaption');
          var stEl = TF.q('uploadStatus');
          var stTxt = stEl ? (stEl.textContent || '') : '';
          if (captionEl && (stTxt.indexOf('Uploaded') >= 0 || (item.fileName && stTxt.indexOf(item.fileName) >= 0))) break;
          await api.sleep(1000);
        }
        if (!captionEl) return { ok: false, note: 'upload_timeout' };

        var fullCaption = ((item.caption || '') + ' ' + (item.hashtags || '')).trim();
        if (fullCaption) {
          // v1.1.2 — Điền caption có ĐỌC LẠI xác minh: lần đăng thật đầu tiên bằng
          // module, caption không vào được editor (TikTok lấy tên file làm tiêu
          // đề thay thế). Thử tối đa 3 cách, đọc lại text sau mỗi cách; không
          // cách nào ăn thì DỪNG với caption_insert_failed, TUYỆT ĐỐI không bấm
          // Đăng với nội dung sai.
          await api.sleep(1200);
          var capOk = false;
          var probe = fullCaption.slice(0, 12);
          for (var attempt = 0; attempt < 3 && !capOk; attempt++) {
            captionEl = TF.q('uploadCaption') || captionEl;
            if (attempt === 1) TF.clickEl(captionEl); else captionEl.focus();
            await api.sleep(300);
            try {
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, fullCaption);
            } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
            await api.sleep(500);
            if ((captionEl.textContent || '').indexOf(probe) >= 0) { capOk = true; break; }
            if (attempt === 2) {
              captionEl.textContent = fullCaption;
              try { captionEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: fullCaption })); } catch (e) { console.debug("[Auto vjp][modules] bỏ qua lỗi:", e); }
              await api.sleep(500);
              if ((captionEl.textContent || '').indexOf(probe) >= 0) capOk = true;
            }
          }
          if (!capOk) return { ok: false, note: 'caption_insert_failed' };
        }

        var postBtn = await TF.qWait('uploadPostBtn', 15000);
        if (!postBtn) return { ok: false, note: 'not_found:uploadPostBtn' };
        if (postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true') {
          await api.sleep(3000);
          postBtn = TF.q('uploadPostBtn') || postBtn;
          if (postBtn.disabled) return { ok: false, note: 'post_button_disabled' };
        }
        TF.clickEl(postBtn);

        // Chờ xác nhận: chuyển sang trang quản lý nội dung hoặc báo published
        var okDeadline = Date.now() + 45000;
        var posted = false;
        while (Date.now() < okDeadline) {
          await api.sleep(1500);
          var p = (typeof location !== 'undefined' ? location.pathname : '') || '';
          var bodyTxt = (typeof document !== 'undefined' && document.body && document.body.textContent) || '';
          if (p.indexOf('/tiktokstudio/content') >= 0 || bodyTxt.indexOf('Video published') >= 0) { posted = true; break; }
        }
        if (!posted) return { ok: false, note: 'post_unconfirmed' };

        var ap2 = await TF.storeGet('tf_approvals_v1');
        if (ap2 && ap2.uploads) {
          ap2.uploads.forEach(function (u) { if (u.id === approvalId) u.status = 'done'; });
          await TF.storeSet({ tf_approvals_v1: ap2 });
        }
        await TF.storeSet({ tf_pending_upload_v1: null });
        return { ok: true, note: 'video_posted' };
      }
    },

    chon_video_hang_doi: {
      id: 'chon_video_hang_doi',
      name: 'Chọn video hàng đợi',
      icon: '🗂',
      group: 'post',
      desc: 'Chọn video tiếp theo trong hàng đợi phê duyệt để chuẩn bị đăng',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        return { ok: true, note: 'queue_video_selected' };
      }
    },

    // ==========================================
    // NHÓM 5: HỆ THỐNG (system) — core = true
    // ==========================================
    kiem_login: {
      id: 'kiem_login',
      name: 'Kiểm tra đăng nhập',
      icon: '🛡',
      group: 'system',
      core: true,
      desc: 'Kiểm tra tài khoản đã đăng nhập TikTok chưa. Hủy kịch bản nếu chưa login.',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var loginState = (TF.getLoginState && typeof TF.getLoginState === 'function') ? TF.getLoginState() : null;
        if (loginState && loginState.loggedIn) {
          return { ok: true, note: 'logged_in:' + (loginState.username || 'unknown') };
        }
        var profileLink = TF.q('profileLink');
        var loginBtn = TF.q('loginBtn');
        if (profileLink || (!loginBtn && TF.q('uploadBtn'))) {
          return { ok: true, note: 'logged_in' };
        }
        return { ok: false, note: 'not_logged_in' };
      }
    },

    kiem_tran_ngay: {
      id: 'kiem_tran_ngay',
      name: 'Kiểm tra trần ngày',
      icon: '📊',
      group: 'system',
      core: true,
      desc: 'Kiểm tra giới hạn an toàn trong ngày (like, save, follow, minutes)',
      params: [
        { key: 'capKey', label: 'Loại trần kiểm tra', type: 'select', def: 'minutes', options: ['like', 'follow', 'save', 'comment', 'minutes'] }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var cap = (params && params.capKey) ? params.capKey : 'minutes';
        if (!api.supervisorCan(cap)) {
          return { ok: false, note: 'cap_exceeded:' + cap };
        }
        return { ok: true, note: 'within_cap:' + cap };
      }
    },

    ghi_log: {
      id: 'ghi_log',
      name: 'Ghi nhật ký',
      icon: '📝',
      group: 'system',
      core: true,
      desc: 'Ghi thông điệp vào nhật ký hoạt động',
      params: [
        { key: 'text', label: 'Nội dung thông điệp', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var txt = (params && params.text) ? params.text : 'Ghi log';
        api.log(txt);
        return { ok: true, note: 'logged' };
      }
    },

    goi_workflow: {
      id: 'goi_workflow',
      name: 'Gọi Workflow con',
      icon: '📞',
      group: 'system',
      core: true,
      desc: 'Gọi thực thi một workflow khác đồng bộ (engine tự xử lý kind call)',
      params: [
        { key: 'wfId', label: 'ID Workflow cần gọi', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        return { ok: true, note: 'handled_by_engine' };
      }
    },

    phat_hien_captcha: {
      id: 'phat_hien_captcha',
      name: 'Phát hiện Captcha',
      icon: '🚨',
      group: 'system',
      core: true,
      desc: 'Kiểm tra lớp phủ captcha trên màn hình (Safety Supervisor)',
      params: [],
      capsUsed: [],
      run: async function (ctx, params, api) {
        if (TF.isCaptchaVisible && TF.isCaptchaVisible()) {
          return { ok: false, note: 'captcha_detected' };
        }
        return { ok: true, note: 'no_captcha' };
      }
    },

    // ==========================================
    // NHÓM 6: ĐIỀU KHIỂN LUỒNG (flow) — catalog entries
    // ==========================================
    lap_lai: {
      id: 'lap_lai',
      name: 'Lặp lại',
      icon: '🔁',
      group: 'flow',
      desc: 'Lặp các bước con theo số lần hoặc thời gian tối đa (engine xử lý qua kind loop)',
      params: [
        { key: 'times', label: 'Số lần lặp', type: 'number', def: 10, min: 1, max: 100 },
        { key: 'maxMinutes', label: 'Thời gian tối đa (phút)', type: 'number', def: 30, min: 1, max: 120 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        return { ok: true, note: 'handled_by_engine' };
      }
    },

    neu_thi: {
      id: 'neu_thi',
      name: 'Nếu - Thì (Điều kiện)',
      icon: '🔀',
      group: 'flow',
      desc: 'Rẽ nhánh luồng dựa theo biến trong Context (engine xử lý qua kind if)',
      params: [
        { key: 'ctxKey', label: 'Biến kiểm tra (vd: video.isNiche)', type: 'text', def: 'video.isNiche' },
        { key: 'op', label: 'Toán tử', type: 'select', def: 'truthy', options: ['truthy', 'falsy', 'eq', 'ne', 'gte', 'lte'] },
        { key: 'value', label: 'Giá trị so sánh', type: 'text', def: '' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        return { ok: true, note: 'handled_by_engine' };
      }
    },

    theo_xac_suat: {
      id: 'theo_xac_suat',
      name: 'Theo xác suất',
      icon: '🎲',
      group: 'flow',
      desc: 'Thực thi các bước con theo tỉ lệ xác suất % (engine xử lý qua kind prob)',
      params: [
        { key: 'pct', label: 'Tỉ lệ xác suất (%)', type: 'number', def: 12, min: 1, max: 100 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        return { ok: true, note: 'handled_by_engine' };
      }
    },

    cho_ngau_nhien: {
      id: 'cho_ngau_nhien',
      name: 'Chờ ngẫu nhiên',
      icon: '⏳',
      group: 'flow',
      desc: 'Tạm dừng ngẫu nhiên từ min đến max phút (hoặc step wait trong engine)',
      params: [
        { key: 'min', label: 'Phút tối thiểu', type: 'number', def: 1, min: 1, max: 60 },
        { key: 'max', label: 'Phút tối đa', type: 'number', def: 5, min: 1, max: 120 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var minMin = (params && params.min != null) ? params.min : 1;
        var maxMin = (params && params.max != null) ? params.max : 5;
        var ms = Math.round(api.rand(minMin, maxMin) * 60000);
        await api.sleep(ms);
        return { ok: true, note: 'waited_' + Math.round(ms / 1000) + 's' };
      }
    },

    nghi_vi_mo: {
      id: 'nghi_vi_mo',
      name: 'Nghỉ vi mô',
      icon: '☕',
      group: 'flow',
      desc: 'Nghỉ 20-90 giây không thao tác sau mỗi cụm video',
      params: [
        { key: 'minSec', label: 'Giây tối thiểu', type: 'number', def: 20, min: 10, max: 60 },
        { key: 'maxSec', label: 'Giây tối đa', type: 'number', def: 90, min: 30, max: 180 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var minSec = (params && params.minSec != null) ? params.minSec : 20;
        var maxSec = (params && params.maxSec != null) ? params.maxSec : 90;
        var ms = Math.round(api.rand(minSec, maxSec) * 1000);
        await api.sleep(ms);
        return { ok: true, note: 'micro_break_' + Math.round(ms / 1000) + 's' };
      }
    },

    nghi_dai: {
      id: 'nghi_dai',
      name: 'Nghỉ dài',
      icon: '🛌',
      group: 'flow',
      desc: 'Nghỉ dài vài phút giữa các phiên hoặc chu kỳ',
      params: [
        { key: 'minutes', label: 'Số phút nghỉ', type: 'number', def: 5, min: 2, max: 30 }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var m = (params && params.minutes != null) ? params.minutes : 5;
        await api.sleep(m * 60000);
        return { ok: true, note: 'long_break_' + m + 'm' };
      }
    },

    cho_den_gio: {
      id: 'cho_den_gio',
      name: 'Chờ đến giờ',
      icon: '⏰',
      group: 'flow',
      desc: 'Tạm dừng kịch bản đến một mốc giờ cụ thể trong ngày (HH:MM)',
      params: [
        { key: 'time', label: 'Giờ đích (HH:MM)', type: 'text', def: '12:00' }
      ],
      capsUsed: [],
      run: async function (ctx, params, api) {
        var t = (params && params.time) ? params.time : '12:00';
        var parts = t.split(':');
        var now = new Date();
        var target = new Date(now);
        target.setHours(+parts[0] || 0, +parts[1] || 0, 0, 0);
        var ms = Math.max(0, target.getTime() - now.getTime());
        if (ms > 0) {
          await api.sleep(ms);
        }
        return { ok: true, note: 'waited_until_' + t };
      }
    }
  };
})();
