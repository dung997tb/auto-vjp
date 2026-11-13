/* Auto vjp — MODULE CONTRACT: platform registry (kernel).
 * Mọi module nền tảng (modules/<platform>/) chỉ được kernel biết qua bảng này.
 * Thêm nền tảng mới = thêm 1 mục ở đây + 1 thư mục module, không sửa module khác.
 * Xem MODULE-CONTRACT.md để biết toàn bộ hợp đồng message/storage.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const D = globalThis.AVJP.contractData;

  const CANONICAL = 'modules/shared/canonical-task-storage.js';
  const SCAN_UTILS = 'modules/shared/account-scan-utils.js';
  // Đọc số followers dùng chung AVJP.metrics (2.11.15): nạp TRƯỚC
  // accounts-scanner của instagram/tiktok/x (đã xoá 3 bản sao cục bộ).
  const METRICS = 'modules/shared/metrics.js';
  // Tự chữa selector (2.9.0): helper phía trang AVJP.heal — nạp TRƯỚC
  // module ở các spec có điểm hay gãy; module không thấy AVJP.heal thì
  // tự rơi về finder gốc. Xem modules/shared/HEALER.md.
  const HEALER = 'modules/shared/healer.js';
  const HEALTHSCAN = 'modules/shared/healthscan.js';
  // (2.11.17) Handler dùng chung cho hành động nhỏ healthscan_<anchor>
  // ở nhánh micro_action (chỉ 4 nền tảng có neo mẫu: ig/yt/threads/
  // tiktok) — nạp TRƯỚC micro.js, micro.js uỷ quyền khi action bắt đầu
  // bằng 'healthscan_'. Xem modules/shared/healthscan-micro.js.
  const HEALTHSCAN_MICRO = 'modules/shared/healthscan-micro.js';
  // Ảnh mặc định của riêng Auto vjp (2.11.7): AVJP.defaultImage — nạp
  // TRƯỚC automator ở spec 'post' (instagram/threads/x); automator không
  // thấy helper thì tự rơi về asset gói sẵn. Xem modules/shared/default-image.js.
  const DEFAULT_IMAGE = 'modules/shared/default-image.js';
  // Chuột người (2.11.16): AVJP.human (clickEl/scrollBy mô phỏng thao tác
  // tay) — nạp TRƯỚC micro.js ở spec 'micro_action'; micro.js tự rơi về
  // click thường khi AVJP.human vắng mặt. Xem modules/shared/humanmouse.js.
  const HUMAN_MOUSE = 'modules/shared/humanmouse.js';

  // scriptsFor(platform, type, task) -> { files:[...], mainWorldBefore:[...], frameTopOnly:bool }
  // Khớp bảng inject của MUT tab-automation-runner (đã đối chiếu file:dòng ở TONG-HOP②),
  // trừ watermark-service: KHÔNG port (luật fork §3-4, không watermark ép buộc;
  // automator chỉ dùng nó khi task có watermark_config — task local không bao giờ set).
  const PLATFORMS = {
    instagram: {
      label: 'Instagram',
      hosts: ['instagram.com'],
      home: 'https://www.instagram.com',
      scripts(task) {
        // (2.9.0) post/story nạp thêm HEALER trước module: automator +
        // story.js định vị nút Tạo/Share/công cụ text qua AVJP.heal.
        if (task.type === 'post') return { files: [CANONICAL, HEALER, DEFAULT_IMAGE, 'modules/instagram/automator.js'] };
        // story (2.11.16): viết lại theo giao diện MOBILE web — bản
        // desktop 2.7.0 đã chết (IG web desktop không có trình tạo
        // story, probe live 2026-11-05). Runner đọc cờ emulation:
        // 'mobile' để gắn giả lập thiết bị TRƯỚC khi điều hướng (xem
        // runner.js). story.js neo theo text + URL /create/story/
        // (bản đồ spike 2026-11-12) nên không cần HEALER nữa;
        // HUMAN_MOUSE đứng trước story.js cho AVJP.human.clickEl.
        if (task.type === 'story') return { files: [CANONICAL, HUMAN_MOUSE, 'modules/instagram/story.js'], emulation: 'mobile' };
        if (task.type === 'healthscan') return { files: [CANONICAL, HEALER, HEALTHSCAN] };
        if (task.type === 'reply') return { files: [CANONICAL, 'modules/instagram/interaction.js'] };
        if (task.type === 'affiliate') return { files: [CANONICAL, 'modules/instagram/affiliate-commenter.js'] };
        if (task.type === 'scan_account') return { files: [SCAN_UTILS, METRICS, 'modules/instagram/accounts-scanner.js'], scan: true };
        // micro_action (2.11.16): hành động nhỏ test lẻ (lướt feed, like
        // bài đầu, xem story...) — script riêng modules/instagram/micro.js.
        if (task.type === 'micro_action') return { files: [HUMAN_MOUSE, HEALER, HEALTHSCAN_MICRO, 'modules/instagram/micro.js'], frameTopOnly: true };
        // nurture (2.2.0): lõi nuôi dùng chung + adapter Instagram. Xem
        // modules/nurture-core/README.md + modules/instagram-nurture/MODULE.md.
        if (task.type === 'nurture') {
          return {
            files: [CANONICAL,
              'modules/nurture-core/nurture-core.js',
              'modules/instagram-nurture/adapter.js'],
            frameTopOnly: true
          };
        }
        return null;
      }
    },
    threads: {
      label: 'Threads',
      hosts: ['threads.net', 'threads.com'],
      home: 'https://www.threads.net',
      scanHome: 'https://www.threads.com',
      scripts(task) {
        if (task.type === 'post') return { files: [CANONICAL, DEFAULT_IMAGE, 'modules/threads/automator.js'] };
        if (task.type === 'reply') return { files: [CANONICAL, 'modules/threads/interaction.js'] };
        if (task.type === 'affiliate') return { files: [CANONICAL, 'modules/threads/affiliate-commenter.js'] };
        if (task.type === 'scan_account') return { files: [SCAN_UTILS, 'modules/threads/accounts-scanner.js'], scan: true };
        // micro_action (2.11.17): đủ 22 hành động nguyên tử trong
        // modules/threads/micro.js. File tự chứa (bộ chọn/logic port từ
        // automator/interaction/affiliate-commenter/threads-nurture
        // adapter) — KHÔNG nạp kèm các file nguồn đó: chúng là IIFE
        // khép kín tự chạy theo task post/reply/affiliate/nurture
        // riêng, nạp vào nhánh micro sẽ tranh chấp tab.
        if (task.type === 'micro_action') return { files: [HUMAN_MOUSE, HEALER, HEALTHSCAN_MICRO, 'modules/threads/micro.js'], frameTopOnly: true };
        if (task.type === 'healthscan') return { files: [CANONICAL, HEALER, HEALTHSCAN] };
        // nurture (2.3.0): lõi nuôi dùng chung + adapter Threads. Xem
        // modules/nurture-core/README.md + modules/threads-nurture/MODULE.md.
        if (task.type === 'nurture') {
          return {
            files: [CANONICAL,
              'modules/nurture-core/nurture-core.js',
              'modules/threads-nurture/adapter.js'],
            frameTopOnly: true
          };
        }
        return null;
      }
    },
    tiktok: {
      label: 'TikTok',
      hosts: ['tiktok.com'],
      home: 'https://www.tiktok.com',
      // Quét tài khoản TikTok phải mở /foryou thay vì trang gốc: trang gốc
      // (https://www.tiktok.com/) trong môi trường headless KHÔNG render
      // nội dung app (0 anchor /@, không có rehydration) nên scanner không
      // bao giờ nhận diện được nick khi quét lạnh; /foryou render đầy đủ
      // sidebar + rehydration. scanHome chỉ dùng cho scan_account (xem
      // startUrl), không đổi hành vi post/reply/nurture của TikTok.
      scanHome: 'https://www.tiktok.com/foryou',
      scripts(task) {
        if (task.type === 'post') return { files: [CANONICAL, 'modules/tiktok/automator.js'], frameTopOnly: true };
        if (task.type === 'reply') {
          const studio = task.source_type === 'comments_manager';
          return {
            files: [CANONICAL, studio ? 'modules/tiktok/studio-comment-replier.js' : 'modules/tiktok/comment-replier.js'],
            mainWorldBefore: [studio ? 'modules/tiktok/studio-reply-bridge.js' : 'modules/tiktok/reply-bridge.js'],
            frameTopOnly: true
          };
        }
        if (task.type === 'scan_account') return { files: [SCAN_UTILS, METRICS, 'modules/tiktok/accounts-scanner.js'], scan: true };
        // micro_action (2.11.17): ngoài HUMAN_MOUSE + micro.js, nạp thêm
        // bộ script nurture TikTok (selectors -> modules -> engine ->
        // content, đúng thứ tự nhánh nurture) để micro.js có TF.q/TF.qa
        // cho 36 hành động nền tảng và TF.engine + TF.MODULES cho 36 step
        // Farmer tf_* chạy lẻ 1 step. content.js dựng TF.engine (hooks
        // ghi storage tf_*) — adapter.js KHÔNG nạp (nó chỉ chạy task
        // nurture đầy đủ, sẽ giành engine với micro).
        if (task.type === 'micro_action') return { files: [CANONICAL, HUMAN_MOUSE,
          'modules/tiktok-nurture/selectors.js',
          'modules/tiktok-nurture/modules.js',
          'modules/tiktok-nurture/engine.js',
          'modules/tiktok-nurture/content.js',
          HEALER, HEALTHSCAN_MICRO,
          'modules/tiktok/micro.js'], frameTopOnly: true };
        if (task.type === 'healthscan') return { files: [CANONICAL, HEALER, HEALTHSCAN], frameTopOnly: true };
        // nurture (2.1.0): engine TikTok Farmer port nguyên khối — thứ tự nạp
        // đúng manifest gốc của Farmer (selectors -> modules -> engine ->
        // content) + adapter.js của Auto vjp nạp cuối. Xem modules/tiktok-nurture/MODULE.md.
        if (task.type === 'nurture') {
          return {
            files: [CANONICAL, HUMAN_MOUSE,
              'modules/tiktok-nurture/selectors.js',
              'modules/tiktok-nurture/modules.js',
              'modules/tiktok-nurture/engine.js',
              'modules/tiktok-nurture/content.js',
              'modules/tiktok-nurture/adapter.js'],
            frameTopOnly: true
          };
        }
        return null;
      }
    },
    x: {
      label: 'X (Twitter)',
      hosts: ['x.com', 'twitter.com'],
      home: 'https://x.com/home',
      scripts(task) {
        if (task.type === 'post') return { files: [CANONICAL, DEFAULT_IMAGE, 'modules/x/automator.js'] };
        if (task.type === 'reply') return { files: [CANONICAL, 'modules/x/interaction.js'] };
        if (task.type === 'affiliate') return { files: [CANONICAL, 'modules/x/affiliate-commenter.js'] };
        if (task.type === 'scan_account') return { files: [SCAN_UTILS, METRICS, 'modules/x/accounts-scanner.js'], scan: true };
        // micro_action (2.11.17): 32 hành động nguyên tử. Nạp thêm
        // nurture-core TRƯỚC micro.js: micro dùng hàm THẬT
        // AVJP.nurture.util (normalizeText/commentSignature) cho các
        // bước verify/nurture. Các file nguồn automator.js /
        // interaction.js / affiliate-commenter.js / x-nurture/adapter.js
        // là script TỰ CHẠY theo task-key riêng (không export hàm) nên
        // KHÔNG nạp ở nhánh này — nạp vào sẽ kích hoạt luồng đăng/trả
        // lời/affiliate/nuôi thật giữa phiên micro; micro.js bám đúng
        // selector + kỹ thuật của chúng (ghi nguồn tại từng handler).
        if (task.type === 'micro_action') return { files: [HUMAN_MOUSE, 'modules/nurture-core/nurture-core.js', 'modules/x/micro.js'], frameTopOnly: true };
        // nurture (2.4.0): lõi nuôi dùng chung + adapter X. Xem
        // modules/nurture-core/README.md + modules/x-nurture/MODULE.md.
        if (task.type === 'nurture') {
          return {
            files: [CANONICAL,
              'modules/nurture-core/nurture-core.js',
              'modules/x-nurture/adapter.js'],
            frameTopOnly: true
          };
        }
        return null;
      }
    },
    youtube: {
      label: 'YouTube',
      hosts: ['youtube.com', 'studio.youtube.com'],
      home: 'https://www.youtube.com',
      // Scan YouTube chạy trên channel_switcher bằng discovery.js (2.6.0):
      // nó đọc __accountScanContext và báo qua sendDiscovery CÓ scanId —
      // accounts-scanner.js cũ gửi socialAccountsScannerResult THIẾU scanId
      // nên kernel (results.js, nhánh socialAccountsScannerResult) không
      // bao giờ khớp được run, task scan luôn treo tới timeout. File cũ
      // vẫn giữ trong module, chỉ hết được tham chiếu.
      scanHome: 'https://www.youtube.com/channel_switcher',
      scripts(task) {
        if (task.type === 'post') return { files: [CANONICAL, 'modules/youtube/automator.js'] };
        // upload (2.8.0): type MỚI chỉ cho youtube — tải video FULL qua
        // YouTube Studio (video thường + Shorts chung 1 luồng). Type
        // 'post' giữ nguyên là Community poster; chặn enqueue post kèm
        // video ở source.js giữ nguyên — video chỉ đi qua uploader này.
        // Xem modules/youtube/upload.js + MODULE.md §11.
        if (task.type === 'upload') return { files: [CANONICAL, 'modules/youtube/upload.js'] };
        // reply (2.6.0): task comment độc lập trên 1 video — xem
        // modules/youtube/interaction.js + modules/youtube/MODULE.md.
        // (2.9.0) reply nạp thêm HEALER: ô comment đi qua AVJP.heal.
        if (task.type === 'reply') return { files: [CANONICAL, HEALER, 'modules/youtube/interaction.js'] };
        if (task.type === 'healthscan') return { files: [CANONICAL, HEALER, HEALTHSCAN] };
        if (task.type === 'scan_account') return { files: [SCAN_UTILS, 'modules/youtube/discovery.js'], scan: true };
        if (task.type === 'micro_action') return { files: [HUMAN_MOUSE, HEALER, HEALTHSCAN_MICRO, 'modules/youtube/micro.js'], frameTopOnly: true };
        // nurture (2.5.0): lõi nuôi dùng chung + adapter YouTube. Xem
        // modules/nurture-core/README.md + modules/youtube-nurture/MODULE.md.
        if (task.type === 'nurture') {
          return {
            files: [CANONICAL,
              'modules/nurture-core/nurture-core.js',
              'modules/youtube-nurture/adapter.js'],
            frameTopOnly: true
          };
        }
        return null;
      }
    },
    // (2.13.0) Facebook: KHÔNG inject script của tầng module. Task fb_feature
    // được chuyển cho bộ hẹn giờ của lõi FB qua modules/kernel/fbtask.js.
    facebook: {
      label: 'Facebook (tính năng của lõi)',
      hosts: [],
      home: null,
      core: true,
      scripts(run) { return run && run.type === 'fb_feature' ? { core: true } : null; }
    },
    probe: {
      label: 'Probe (kiểm tra vòng đời, không mở tab)',
      hosts: [],
      home: null,
      scripts() { return null; }
    }
  };

  // URL mở tab theo loại task — port logic từ MUT post-automation-service.processPost
  // (chỉ phần không-phải-Facebook; Facebook là việc của lõi gốc, module layer không nhận).
  function startUrl(task) {
    const p = task.platform;
    const pl = PLATFORMS[p];
    if (!pl) return null;
    if (task.type === 'scan_account') return pl.scanHome || pl.home;
    if (task.type === 'story') return pl.home;
    // micro_action (2.11.16): mở trang chủ nền tảng; TikTok phải vào
    // /foryou (trang gốc headless render rỗng — cùng lý do scanHome).
    if (task.type === 'micro_action') {
      if (p === 'tiktok') return 'https://www.tiktok.com/foryou';
      return pl.home;
    }
    // healthscan (2.9.0): mở bề mặt chứa neo mẫu của từng nền tảng —
    // YouTube cần 1 trang watch mẫu để ô comment tồn tại trong DOM.
    if (task.type === 'healthscan') {
      if (p === 'instagram') return 'https://www.instagram.com';
      if (p === 'youtube') return 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
      if (p === 'threads') return 'https://www.threads.net';
      if (p === 'tiktok') return 'https://www.tiktok.com/foryou';
      return pl.home;
    }
    // upload (2.8.0): mở thẳng YouTube Studio — upload.js tự mở dialog
    // tải lên từ nút Create của Studio.
    if (task.type === 'upload') return 'https://studio.youtube.com';
    if (task.type === 'nurture') {
      if (p === 'instagram') return 'https://www.instagram.com';
      if (p === 'threads') return 'https://www.threads.net';
      if (p === 'x') return 'https://x.com/home';
      if (p === 'youtube') return 'https://www.youtube.com';
      return 'https://www.tiktok.com/foryou';
    }
    if (task.type === 'reply' || task.type === 'affiliate') return task.source_url || pl.home;
    if (task.type === 'post') {
      if (p === 'instagram') return 'https://www.instagram.com';
      if (p === 'threads') return 'https://www.threads.net';
      if (p === 'x') return 'https://x.com/compose/post';
      if (p === 'tiktok') return isVideoPost(task)
        ? 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video'
        : 'https://www.tiktok.com/tiktokstudio/upload/post/photo';
      if (p === 'youtube') {
        // Bề mặt đăng Community thật là tab /community của kênh (2.6.0 —
        // bằng chứng live: khung soạn nằm ở /@<handle>/community, không
        // phải /posts). Thiếu actor thì mở trang chủ, automator tự suy
        // handle kênh đang đăng nhập rồi điều hướng sang /community.
        const actor = task.social_username || task.social_uid || task.actor_uid;
        if (actor) return `https://www.youtube.com/@${String(actor).replace(/^@/, '')}/community`;
        return 'https://www.youtube.com';
      }
    }
    return pl.home;
  }

  function isVideoPost(task) {
    const raw = task.images || task.media_urls || [];
    let urls = raw;
    if (typeof raw === 'string') { try { urls = JSON.parse(raw); } catch (_) { urls = [raw]; } }
    if (!Array.isArray(urls)) return false;
    if (String(task.resolved_media_type || '').startsWith('video/')) return true;
    return urls.some(u => {
      const s = String(typeof u === 'string' ? u : (u && (u.url || u.src)) || '').toLowerCase();
      return s.endsWith('.mp4') || s.endsWith('.webm') || s.endsWith('.mov');
    });
  }

  function defaultTimeoutMs(type) {
    const meta = D && D.getTaskMetadata ? D.getTaskMetadata(type) : null;
    if (meta && meta.default_timeout_ms) return meta.default_timeout_ms;
    if (type === 'fb_feature') return 4 * 3600 * 1000; // tính năng lõi FB chạy dài (đăng nhiều nhóm, tương tác...)
    return type === 'reply' ? 12 * 60 * 1000 : 20 * 60 * 1000;
  }

  globalThis.AVJP.contract = {
    VERSION: D ? D.CONTRACT_VERSION : 2,
    CANONICAL_KEY: 'currentAutomationRun',
    PLATFORMS,
    platformNames: Object.keys(PLATFORMS),
    startUrl,
    isVideoPost,
    defaultTimeoutMs,
    INACTIVITY_TIMEOUT_MS: 5 * 60 * 1000,
    TASK_TYPES: ['post', 'reply', 'affiliate', 'scan_account', 'probe', 'nurture', 'story', 'upload', 'healthscan', 'micro_action', 'fb_feature'],
    // (2.13.0) Tên tính năng lõi FB nhận qua task fb_feature. Nguồn sự thật là
    // SCHEDULE_FEATURES trong background.js; tests/fbtask.test.js canh hai bên khớp nhau.
    FB_FEATURES: ['friend', 'scrape', 'feed', 'aiFeed', 'groupInteract', 'groupComment', 'groupPost', 'keyword', 'discover', 'share', 'sales', 'trendLearn', 'trendPost', 'newsWall', 'pageGroupJoin', 'pageGroupPost', 'pageNewsWall', 'pageComment', 'pageSales', 'pageGroupComment', 'friendReengage', 'fbStory', 'fbReels']
  };
})();
