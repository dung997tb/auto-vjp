// Auto vjp — HEALTHSCAN-MICRO (2.11.17): handler dùng chung cho các
// hành động nhỏ dạng `healthscan_<anchor>` trong registry micro
// (modules/kernel/contract-data.js MICRO_ACTIONS). Contract nạp file
// này TRƯỚC micro.js ở nhánh micro_action của instagram / youtube /
// threads / tiktok; micro.js gặp action bắt đầu bằng 'healthscan_'
// thì uỷ quyền sang đây và kết thúc lượt inject.
//
// Hành vi = đúng healthscan.js thu gọn cho 1 neo: chờ trang ổn định,
// chạy AVJP.heal.locate() cho neo mẫu của nền tảng, KHÔNG bấm / không
// tương tác thật — chỉ định vị + báo cáo qua report() của micro.js
// (action 'microActionDone'). found -> success; không thấy ->
// failed 'selector_not_found'. Kỷ luật học giữ nguyên như healthscan:
// locate ở đây KHÔNG markProven (không kèm hành động thật).
// Bảng neo dưới đây chép đúng ANCHORS của modules/shared/healthscan.js
// (nguồn sự thật là file đó — sửa neo thì sửa cả hai nơi).
(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const SPECS = {
    healthscan_ig_post_createbtn: {
      platform: 'instagram',
      key: 'ig.post.createBtn',
      intent: 'Nút Tạo bài viết mới (Create / dấu +) ở thanh điều hướng bên trái của Instagram, dùng để mở trình tạo bài viết/reel/story',
      builtins: [
        { by: 'aria', value: 'New post' },
        { by: 'svgTitle', value: 'New post' },
        { by: 'aria', value: 'Create' },
        { by: 'aria', value: 'Tạo mới' },
        { by: 'aria', value: 'Tạo' }
      ]
    },
    healthscan_yt_reply_commentbox: {
      platform: 'youtube',
      key: 'yt.reply.commentBox',
      intent: 'Ô soạn bình luận của YouTube trên trang xem video — khung placeholder "Add a comment…" / "Viết bình luận…" dưới video, bấm vào để gõ bình luận',
      builtins: [
        { by: 'css', value: '#simplebox-placeholder' },
        { by: 'css', value: 'ytd-comment-simplebox-renderer' }
      ],
      prepare: async () => {
        // Giống healthscan.js: comment lazy-load — cuộn tới #comments
        // nhiều vòng trước khi locate.
        for (let i = 0; i < 10; i++) {
          const a = document.querySelector('ytd-comments, #comments');
          if (a) {
            a.scrollIntoView({ block: 'start' });
            const r = a.getBoundingClientRect();
            if (r.top > window.innerHeight || r.top < -200) window.scrollBy(0, r.top - 80);
            if (document.querySelector('ytd-comment-simplebox-renderer')) return;
          } else {
            window.scrollBy(0, Math.floor(window.innerHeight * 1.2));
          }
          await sleep(700);
        }
      }
    },
    healthscan_th_feed_likebtn: {
      platform: 'threads',
      key: 'th.feed.likeBtn',
      intent: 'Nút Like (Thích, icon trái tim) của bài viết đầu tiên trên trang chủ Threads',
      builtins: [
        { by: 'svgTitle', value: 'Like' },
        { by: 'aria', value: 'Like' },
        { by: 'aria', value: 'Thích' }
      ]
    },
    healthscan_tt_fyp_likebtn: {
      platform: 'tiktok',
      key: 'tt.fyp.likeBtn',
      intent: 'Nút Thích (Like, icon trái tim) của video đang phát trên trang For You của TikTok, ở cột nút bên phải video',
      builtins: [
        { by: 'css', value: '[data-e2e="like-icon"]' },
        { by: 'aria', value: 'Like' },
        { by: 'aria', value: 'Thích' }
      ]
    }
  };

  async function run({ action, report }) {
    const spec = SPECS[action];
    if (!spec) {
      report('failed', { action, error: 'healthscan_anchor_unknown' }, 'execution_error',
        `Không có neo healthscan cho hành động ${action}`);
      return;
    }
    const heal = globalThis.AVJP && AVJP.heal;
    if (!heal || typeof heal.locate !== 'function') {
      report('failed', { action, anchor: spec.key, error: 'healer_missing' }, 'execution_error',
        'AVJP.heal chưa được nạp — không định vị được neo');
      return;
    }
    await sleep(3500);
    if (typeof spec.prepare === 'function') {
      try { await spec.prepare(); } catch (_) { /* chuẩn bị lỗi vẫn thử locate */ }
    }
    // Trần cứng 75s cho locate: trên tab lạnh (neo chưa render) heal
    // có thể rơi vào đường gợi ý AI rất chậm — thực tế 2026-11-12 trên
    // nuc, task healthscan micro bị watchdog đóng uncertain ở 300s
    // không kịp báo. Quá trần -> coi như không tìm thấy (failed
    // selector_not_found + details.locate_timeout) thay vì treo câm.
    const LOCATE_HARD_TIMEOUT_MS = 75000;
    const found = await Promise.race([
      heal.locate({
        platform: spec.platform, key: spec.key, intent: spec.intent,
        builtins: spec.builtins, timeoutMs: 45000
      }).catch(() => null),
      sleep(LOCATE_HARD_TIMEOUT_MS).then(() => 'locate_timeout')
    ]);
    if (found === 'locate_timeout') {
      report('failed', { action, anchor: spec.key, found_via: 'none', locate_timeout: true }, 'selector_not_found',
        `Quét selector ${spec.key}: locate quá ${LOCATE_HARD_TIMEOUT_MS / 1000}s (tab lạnh / neo chưa render) — không tìm thấy`);
      return;
    }
    try {
      chrome.storage.local.set({ lastStatus: `🩺 Micro healthscan ${spec.platform}: ${spec.key} -> ${found ? found.via : 'none'}` });
    } catch (_) { console.debug("[Auto vjp][healthscan-micro] bỏ qua lỗi:", _); }
    if (found) {
      report('success', { action, anchor: spec.key, found_via: found.via, spec: found.spec || null }, null,
        `Quét selector ${spec.key}: tìm thấy (${found.via})`);
    } else {
      report('failed', { action, anchor: spec.key, found_via: 'none' }, 'selector_not_found',
        `Quét selector ${spec.key}: không tìm thấy neo trên trang hiện tại`);
    }
  }

  globalThis.AVJP = globalThis.AVJP || {};
  globalThis.AVJP.healthscanMicro = { run, SPECS };
})();
