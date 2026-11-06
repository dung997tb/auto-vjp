// [Auto vjp — modules/tiktok-nurture] Port NGUYÊN BẢN từ TikTok Farmer v1.2.10, không sửa dòng nào.
// selectors.js — Selector contract theo CONTRACT.md v1.0
// Global window.TF, classic script, không dùng import/export/eval.
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  root.TF = root.TF || {};
  var TF = root.TF;

  // Bảng selector theo thứ tự ưu tiên: [data-e2e="..."] -> aria-label (VI + EN) -> cấu trúc dự phòng
  TF.SEL = {
    // 1. Ô tìm kiếm
    searchInput: [
      'input[data-e2e="search-box-input"]',
      'input[data-e2e="search-user-input"]',
      'input[type="search"]',
      'input[role="searchbox"]',
      'input[aria-label*="Tìm kiếm"]',
      'input[aria-label*="Search"]',
      'input[placeholder*="Tìm kiếm"]',
      'input[placeholder*="Search"]',
      'form[role="search"] input'
    ],

    // 2. Phần tử video
    videoEl: [
      'div[data-e2e="feed-video"] video',
      'div[data-e2e="recommend-list-item-container"] video',
      'div[data-e2e="browse-video"] video',
      'article video',
      'main video',
      'div[class*="DivVideoContainer"] video',
      'video'
    ],

    // 3. Khung chứa bài viết/video item
    videoArticle: [
      'div[data-e2e="recommend-list-item-container"]',
      'article[data-e2e="recommend-list-item-container"]',
      'div[data-e2e="feed-video"]',
      'article[role="article"]',
      'div[class*="DivItemContainer"]',
      'div[class*="FeedVideoItem"]',
      'article'
    ],

    // 4. Nút thích video
    likeBtn: [
      'button[data-e2e="like-icon"]',
      'button[data-e2e="feed-like-icon"]',
      'button[data-e2e="browse-like-icon"]',
      '[data-e2e="like-icon"]',
      '[data-e2e="feed-like-icon"]',
      'button[aria-label*="Thích video"]',
      'button[aria-label*="Like video"]',
      'button[aria-label*="Thích"]',
      'button[aria-label*="Like"]',
      'span[data-e2e="like-icon"]'
    ],

    // 5. Nút mở/đọc bình luận
    commentBtn: [
      'button[data-e2e="comment-icon"]',
      'button[data-e2e="feed-comment-icon"]',
      'button[data-e2e="browse-comment-icon"]',
      '[data-e2e="comment-icon"]',
      '[data-e2e="feed-comment-icon"]',
      'button[aria-label*="Đọc hoặc viết bình luận"]',
      'button[aria-label*="Read or write comments"]',
      'button[aria-label*="bình luận"]',
      'button[aria-label*="Comment"]',
      'span[data-e2e="comment-icon"]'
    ],

    // 6. Nút yêu thích / lưu video
    saveBtn: [
      'button[data-e2e="favorite-icon"]',
      'button[data-e2e="feed-favorite-icon"]',
      'button[data-e2e="undefined-icon"]',
      '[data-e2e="favorite-icon"]',
      '[data-e2e="feed-favorite-icon"]',
      'button[aria-label*="Thêm vào mục Yêu thích"]',
      'button[aria-label*="Add to Favorites"]',
      'button[aria-label*="Yêu thích"]',
      'button[aria-label*="Favorite"]',
      'button[aria-label*="Lưu"]',
      'button[aria-label*="Save"]',
      'span[data-e2e="favorite-icon"]'
    ],

    // 7. Nút chia sẻ video
    shareBtn: [
      'button[data-e2e="share-icon"]',
      'button[data-e2e="feed-share-icon"]',
      '[data-e2e="share-icon"]',
      '[data-e2e="feed-share-icon"]',
      'button[aria-label*="Chia sẻ video"]',
      'button[aria-label*="Share video"]',
      'button[aria-label*="Chia sẻ"]',
      'button[aria-label*="Share"]',
      'span[data-e2e="share-icon"]'
    ],

    // 8. Nút theo dõi creator
    followBtn: [
      'button[data-e2e="follow-button"]',
      'button[data-e2e="feed-follow-button"]',
      'button[data-e2e="user-card-follow-button"]',
      '[data-e2e="follow-button"]',
      'button[aria-label*="Follow"]',
      'button[aria-label*="Theo dõi"]',
      'button[aria-label*="Đang follow"]'
    ],

    // 9. Đường dẫn tới hồ sơ tác giả
    authorLink: [
      'a[data-e2e="video-author-uniqueid"]',
      'a[data-e2e="video-author-avatar"]',
      'a[data-e2e="feed-author-uniqueid"]',
      'a[data-e2e="author-uniqueid"]',
      'a[data-e2e="video-author"]',
      'article a[href^="/@"]',
      'a[href^="/@"]'
    ],

    // 10. Khung mô tả / caption video
    captionText: [
      'div[data-e2e="video-desc"]',
      'span[data-e2e="video-desc"]',
      'h1[data-e2e="video-desc"]',
      'div[data-e2e="browse-caption"]',
      'div[class*="DivDescription"]',
      'div[class*="VideoDesc"]',
      'article div[data-e2e="video-desc"]'
    ],

    // 11. Thanh trượt tiến độ video
    progressSlider: [
      'div[data-e2e="video-progress-bar"]',
      'div[data-e2e="progress-bar"]',
      'div[role="slider"][aria-label*="Tiến độ video"]',
      'div[role="slider"][aria-label*="Progress"]',
      'div[role="slider"]',
      'div[class*="ProgressBar"]',
      'div[class*="SeekBar"]'
    ],

    // 12. Lớp phủ / container captcha
    captchaOverlay: [
      '#captcha-verify-image',
      '.captcha-verify-container',
      '.captcha_verify_container',
      'div[id*="captcha"]',
      'div[class*="captcha"]',
      'div[class*="secsdk"]',
      'div[class*="captcha-verify"]',
      'div[class*="secsdk-captcha"]',
      'div[id*="verify-bar"]'
    ],

    // 13. Dòng chữ / phần tử gợi ý captcha
    captchaText: [
      '.secsdk-captcha-drag-wrapper',
      '.captcha-slider',
      'div[class*="captcha"] [class*="tip"]',
      'div[class*="captcha"] [class*="text"]',
      'div[class*="captcha"] [class*="title"]',
      'div[id*="captcha"] span',
      'div[id*="captcha"] p'
    ],

    // 14. Nút đăng nhập
    loginBtn: [
      'button[data-e2e="top-login-button"]',
      'button[data-e2e="login-button"]',
      'a[data-e2e="login-button"]',
      'a[href*="/login"]',
      'button[aria-label*="Đăng nhập"]',
      'button[aria-label*="Log in"]',
      'button[aria-label*="Login"]'
    ],

    // 15. Đường dẫn đến hồ sơ cá nhân
    profileLink: [
      'a[data-e2e="profile-icon"]',
      'a[data-e2e="nav-profile"]',
      'header a[href^="/@"]',
      'a[href*="/@"][aria-label*="Hồ sơ"]',
      'a[href*="/@"][aria-label*="Profile"]',
      'a[aria-label*="Hồ sơ"]',
      'a[aria-label*="Profile"]'
    ],

    // 16. Nút điều hướng tải lên video
    uploadBtn: [
      'a[data-e2e="upload-icon"]',
      'a[data-e2e="nav-upload"]',
      'button[data-e2e="upload-icon"]',
      'a[href*="/upload"]',
      'a[aria-label*="Tải lên"]',
      'a[aria-label*="Upload"]'
    ],

    // 17. Ô nhập nội dung bình luận
    commentInput: [
      'div[data-e2e="comment-input"] [contenteditable="true"]',
      '[data-e2e="comment-text-area"]',
      'div[contenteditable="true"][data-e2e="comment-text-area"]',
      'div[data-e2e="comment-input"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[data-e2e="comment-input"]',
      'div[class*="DraftEditor"] [contenteditable="true"]'
    ],

    // 18. Nút gửi bình luận
    commentSubmit: [
      'button[data-e2e="comment-post"]',
      'button[data-e2e="comment-post-button"]',
      '[data-e2e="comment-post"]',
      '[data-e2e="comment-post-button"]',
      'div[data-e2e="comment-post"]',
      'button[aria-label*="Đăng"]',
      'button[aria-label*="Post"]'
    ],

    // 18b. Item bình luận trong danh sách (v1.2.4 — kiểm chứng comment đã đăng thật)
    commentItem: [
      '[data-e2e="comment-level-1"]',
      '[data-e2e="comment-item"]',
      'div[class*="DivCommentItemContainer"]'
    ],

    // 19. Input chọn file tải lên
    uploadFileInput: [
      'input[type="file"][accept*="video"]',
      'input[type="file"][data-e2e="upload-file-input"]',
      'input[type="file"]',
      '[data-e2e="upload-input"]'
    ],

    // 20. Ô nhập caption / chú thích tải lên
    uploadCaption: [
      '[data-e2e="caption_container"] [contenteditable="true"]',
      'div[data-e2e="caption-input"]',
      'div[data-e2e="upload-caption"]',
      'div[contenteditable="true"][aria-label*="caption" i]',
      'div[contenteditable="true"][aria-label*="chú thích" i]',
      'div[class*="caption-input"] [contenteditable="true"]',
      'div[class*="public-DraftEditor-content"]',
      'textarea[placeholder*="caption" i]'
    ],

    // 21. Nút bấm đăng video tải lên
    uploadPostBtn: [
      'button[data-e2e="post_video_button"]',
      'button[data-e2e="post-button"]',
      'button[data-e2e="upload-post-button"]',
      'button:not([disabled])[data-e2e="post_video_button"]',
      'button[aria-label*="Đăng"]',
      'button[aria-label*="Post"]'
    ],

    // 21b. Khối trạng thái tải lên ở TikTok Studio (v1.1.0)
    uploadStatus: [
      '[data-e2e="upload_status_container"]'
    ],

    // 21c. Item video trong lưới bài đăng trên trang profile (v1.1.0)
    profilePostItem: [
      '[data-e2e="user-post-item"]',
      '[data-e2e="user-post-item-list"] a[href*="/video/"]',
      '[data-e2e="user-post-item-list"] a[href*="/photo/"]'
    ],

    // 22. Nút chuyển video tiếp theo
    // v1.2.7 — Layout cửa sổ mới của TikTok dùng feed-navigation-next
    // (đo thật 2026-11-01 trên nuc: <button data-e2e="feed-navigation-next"
    // aria-label="Go to next video">); bản cũ chỉ có arrow-down nên
    // luot_next hụt nút ở layout này.
    nextBtn: [
      'button[data-e2e="feed-navigation-next"]',
      '[data-e2e="feed-navigation-next"]',
      'button[data-e2e="arrow-down"]',
      'button[data-e2e="feed-action-down"]',
      '[data-e2e="arrow-down"]',
      'button[aria-label*="Video tiếp theo"]',
      'button[aria-label*="Next video"]',
      'button[aria-label*="tiếp"]',
      'button[aria-label*="Next"]'
    ],

    // 23. Thẻ / item phiên LIVE
    liveCard: [
      'div[data-e2e="live-card"]',
      'div[data-e2e="live-item"]',
      'a[href*="/live"]',
      'div[data-e2e="live-container"]',
      'div[class*="DivLiveCard"]'
    ],

    // 24. Phần tử thông báo / tin nhắn trong inbox
    notificationItem: [
      'div[data-e2e="notification-item"]',
      'div[data-e2e="inbox-item"]',
      'li[data-e2e="inbox-list-item"]',
      'div[class*="notification-item"]',
      'div[class*="inbox-item"]',
      'div[class*="DivNotificationItem"]'
    ]
  };

  /**
   * Truy vấn 1 phần tử theo khóa đã định nghĩa trong TF.SEL (hoặc raw selector dự phòng)
   * @param {string} key - Khóa trong TF.SEL hoặc chuỗi CSS selector
   * @param {Element|Document} [root] - Node gốc tìm kiếm (mặc định document)
   * @returns {Element|null}
   */
  TF.q = function (key, rootEl) {
    var doc = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelector !== 'function') return null;
    var selList = TF.SEL[key];
    if (Array.isArray(selList)) {
      for (var i = 0; i < selList.length; i++) {
        try {
          var el = doc.querySelector(selList[i]);
          if (el) return el;
        } catch (e) {
          // Bỏ qua lỗi cú pháp selector đặc thù
        }
      }
      // Fallback theo TEXT nút (v1.0.2): vài nút TikTok (vd Post ở TikTok Studio)
      // không có data-e2e/aria-label ổn định — khớp theo nhãn nhìn thấy được.
      var spec = (TF.SEL_TEXT || {})[key];
      if (spec) {
        try {
          var els = doc.querySelectorAll(spec.tag || 'button');
          for (var j = 0; j < els.length; j++) {
            var t = (els[j].textContent || '').trim();
            if (spec.texts.indexOf(t) >= 0) return els[j];
          }
        } catch (e) {}
      }
      return null;
    }
    if (typeof key === 'string') {
      try {
        return doc.querySelector(key);
      } catch (e) {}
    }
    return null;
  };

  // Khớp dự phòng theo text nhìn thấy (v1.0.2) — dùng khi nút không có
  // data-e2e ổn định. Text phải khớp NGUYÊN VĂN sau khi trim.
  TF.SEL_TEXT = {
    uploadPostBtn: { tag: 'button', texts: ['Post', 'Đăng', 'Post now', 'Đăng ngay'] }
  };

  // Truy cập chrome.storage.local dạng Promise (v1.1.0) — module dùng để đọc
  // hàng đợi duyệt / ghi trạng thái tạm giữa 2 pha điều hướng. Môi trường không
  // có chrome.storage (node test) thì trả null/false, không ném lỗi.
  TF.storeGet = function (key) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(null);
        chrome.storage.local.get(key, function (r) { resolve(r ? r[key] : null); });
      } catch (e) { resolve(null); }
    });
  };
  TF.storeSet = function (obj) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(false);
        chrome.storage.local.set(obj, function () { resolve(true); });
      } catch (e) { resolve(false); }
    });
  };

  // Click chuẩn toàn extension (v1.0.2): bắn chuỗi sự kiện pointer/mouse TỔNG HỢP
  // lên đúng phần tử, tọa độ sự kiện lấy từ chính khung phần tử tại thời điểm bấm
  // nên không phụ thuộc kích thước cửa sổ (nguyên tắc Dũng chốt 31/10: tuyệt đối
  // không click theo tọa độ màn hình). Bài học thực tế: vài nút TikTok (chọn cách
  // xác minh lúc đăng nhập, nút Post ở TikTok Studio) không nuốt .click() thường
  // lẫn click chuột CDP, nhưng nuốt chuỗi sự kiện này. Mọi lỗi đều fallback về
  // .click() thường để không bao giờ tệ hơn cách cũ.
  TF.clickEl = function (el) {
    if (!el) return false;
    try {
      var r = (typeof el.getBoundingClientRect === 'function') ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
      var cx = r.x + (r.width || 0) / 2, cy = r.y + (r.height || 0) / 2;
      var opts = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, view: (typeof window !== 'undefined' ? window : undefined) };
      var seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      for (var i = 0; i < seq.length; i++) {
        var type = seq[i];
        var Ev = (type.indexOf('pointer') === 0 && typeof PointerEvent !== 'undefined') ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Ev(type, opts));
      }
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (e2) { return false; }
    }
  };

  /**
   * Như TF.q nhưng chờ phần tử xuất hiện — feed TikTok render trễ vài trăm ms
   * sau khi lướt/mở trang nên TF.q ngay lập tức hay hụt (not_found oan).
   * Poll mỗi 200ms tới khi hết timeoutMs (mặc định 3000) thì trả null như TF.q.
   */
  TF.qWait = function (key, timeoutMs, rootEl) {
    var deadline = Date.now() + (timeoutMs || 3000);
    return new Promise(function (resolve) {
      (function tick() {
        var el = TF.q(key, rootEl);
        if (el) return resolve(el);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, 200);
      })();
    });
  };

  /**
   * Truy vấn toàn bộ phần tử theo khóa đã định nghĩa trong TF.SEL
   * @param {string} key - Khóa trong TF.SEL hoặc chuỗi CSS selector
   * @param {Element|Document} [root] - Node gốc tìm kiếm
   * @returns {Element[]}
   */
  TF.qa = function (key, rootEl) {
    var doc = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    var selList = TF.SEL[key];
    if (Array.isArray(selList)) {
      var found = [];
      var seen = typeof Set !== 'undefined' ? new Set() : null;
      for (var i = 0; i < selList.length; i++) {
        try {
          var nodes = doc.querySelectorAll(selList[i]);
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (seen) {
              if (!seen.has(n)) {
                seen.add(n);
                found.push(n);
              }
            } else if (found.indexOf(n) === -1) {
              found.push(n);
            }
          }
        } catch (e) {}
      }
      return found;
    }
    if (typeof key === 'string') {
      try {
        return Array.prototype.slice.call(doc.querySelectorAll(key));
      } catch (e) {}
    }
    return [];
  };

  /**
   * Quét toàn bộ phần tử có data-e2e trên trang hiện tại để debug chốt selector thật
   * @returns {Array<{tag: string, dataE2e: string, text: string}>}
   */
  TF.dumpDataE2E = function () {
    if (typeof document === 'undefined') return [];
    var els = document.querySelectorAll('[data-e2e]');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (txt.length > 80) txt = txt.slice(0, 77) + '...';
      out.push({
        tag: (el.tagName || '').toLowerCase(),
        dataE2e: el.getAttribute('data-e2e') || '',
        text: txt
      });
    }
    return out;
  };

  /**
   * Kiểm tra lớp phủ captcha / yêu cầu xác minh có đang hiển thị trên trang hay không
   * @returns {boolean}
   */
  TF.isCaptchaVisible = function () {
    if (typeof document === 'undefined') return false;

    // 1. Kiểm tra phần tử captchaOverlay định nghĩa sẵn
    var overlay = TF.q('captchaOverlay');
    if (overlay) {
      var style = (typeof window !== 'undefined' && window.getComputedStyle) ? window.getComputedStyle(overlay) : null;
      var isHidden = style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
      if (!isHidden) return true;
    }

    // 2. Quét các phần tử id/class chứa captcha / secsdk
    var captchaNodes = document.querySelectorAll('[id*="captcha" i], [class*="captcha" i], [class*="secsdk" i], .captcha-verify-container, #captcha-verify-image');
    for (var i = 0; i < captchaNodes.length; i++) {
      var node = captchaNodes[i];
      if (node.offsetParent !== null || ((typeof window !== 'undefined' && window.getComputedStyle) && window.getComputedStyle(node).display !== 'none')) {
        var text = (node.innerText || node.textContent || '').toLowerCase();
        if (
          text.indexOf('kéo thanh trượt') >= 0 ||
          text.indexOf('drag the slider') >= 0 ||
          text.indexOf('ghép hình') >= 0 ||
          text.indexOf('puzzle') >= 0 ||
          text.indexOf('xác minh') >= 0 ||
          text.indexOf('verify') >= 0
        ) {
          return true;
        }
        var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
        if (rect && rect.width > 50 && rect.height > 50) {
          return true;
        }
      }
    }

    // 3. Quét các modal / dialog lớp phủ có chứa text đặc thù captcha
    var dialogs = document.querySelectorAll('[role="dialog"], div[class*="modal" i], div[class*="mask" i]');
    for (var j = 0; j < dialogs.length; j++) {
      var dlg = dialogs[j];
      var dtext = (dlg.innerText || dlg.textContent || '').toLowerCase();
      if (
        dtext.indexOf('kéo thanh trượt') >= 0 ||
        dtext.indexOf('drag the slider') >= 0 ||
        (dtext.indexOf('xác minh') >= 0 && dtext.indexOf('robot') >= 0)
      ) {
        return true;
      }
    }

    // 4. (v1.1.2) Chốt chặn cuối: biến thể puzzle tròn mới (gặp thật 31/10 trên
    // trang profile) render trong container KHÔNG mang class/id/modal nào khớp
    // các bước trên, nhưng câu chữ của nó nằm trong innerText toàn trang. Các
    // cụm dưới đây chỉ xuất hiện khi thử thách đang mở, không có trong nội
    // dung trang thường. Kèm kiểm tra iframe SDK xác minh.
    try {
      var ifr = document.querySelector('iframe[src*="captcha"], iframe[src*="secsdk"], iframe[src*="verify"]');
      if (ifr && ifr.offsetParent !== null) return true;
      var bt = ((document.body && document.body.innerText) || '').toLowerCase();
      if (
        bt.indexOf('drag the slider to fit the puzzle') >= 0 ||
        bt.indexOf('kéo thanh trượt để khớp') >= 0 ||
        bt.indexOf('fit the puzzle') >= 0
      ) return true;
    } catch (e) {}

    return false;
  };
})();
