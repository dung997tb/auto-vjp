// Auto vjp — HEALTHSCAN (task type 'healthscan', 2.9.0).
// Task nhẹ phát hiện DOM trôi TRƯỚC khi task thật fail: mở bề mặt mẫu
// của nền tảng (contract.startUrl), chạy AVJP.heal.locate() cho các neo
// mẫu, KHÔNG bấm/không tương tác thật — chỉ định vị + báo cáo.
// Receipt (results.js healthscanCompleted -> outbox type 'healthscan',
// items): mỗi neo {key, found_via: 'learned'|'builtin'|'ai'|'none',
// spec} — spec là cách tìm đã định vị được phần tử (kể cả qua AI).
// LƯU Ý KỶ LUẬT HỌC: healthscan KHÔNG gọi markProven — locate ở đây
// không kèm hành động thật nên không có proof; spec AI gợi ý chỉ được
// ghi vào receipt để người xem, muốn thành "đã học" phải do module
// thật dùng nó đạt proof (xem modules/shared/HEALER.md).
// File dùng chung cho instagram/youtube/threads/tiktok (contract nạp
// [CANONICAL, HEALER, file này]); nền tảng lấy từ canonical run.
(async function() {
  const stored = await chrome.storage.local.get('currentAutomationRun');
  const run = stored.currentAutomationRun;
  if (!run || run.type !== 'healthscan') return;
  const platform = String(run.platform || '');
  const taskId = String(run.task_id || run.id || '');
  if (!taskId) return;
  if (window.__avjpHealthscanTaskId === taskId) return;
  window.__avjpHealthscanTaskId = taskId;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Neo mẫu theo nền tảng (≤3 neo/nền tảng). builtins lấy từ finder
  // thật của các module — healthscan và module dùng chung 1 key để
  // selector đã học áp được cho cả hai.
  const ANCHORS = {
    instagram: [
      {
        key: 'ig.post.createBtn',
        intent: 'Nút Tạo bài viết mới (Create / dấu +) ở thanh điều hướng bên trái của Instagram, dùng để mở trình tạo bài viết/reel/story',
        builtins: [
          { by: 'aria', value: 'New post' },
          { by: 'svgTitle', value: 'New post' },
          { by: 'aria', value: 'Create' },
          { by: 'aria', value: 'Tạo mới' },
          { by: 'aria', value: 'Tạo' }
        ]
      }
    ],
    youtube: [
      {
        key: 'yt.reply.commentBox',
        intent: 'Ô soạn bình luận của YouTube trên trang xem video — khung placeholder "Add a comment…" / "Viết bình luận…" dưới video, bấm vào để gõ bình luận',
        builtins: [
          { by: 'css', value: '#simplebox-placeholder' },
          { by: 'css', value: 'ytd-comment-simplebox-renderer' }
        ],
        prepare: async () => {
          // Comment lazy-load: cuộn TỨC THỜI xuống #comments nhiều
          // vòng như interaction.js (2.6.2) trước khi locate.
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
      }
    ],
    threads: [
      {
        key: 'th.feed.likeBtn',
        intent: 'Nút Like (Thích, icon trái tim) của bài viết đầu tiên trên trang chủ Threads',
        builtins: [
          { by: 'svgTitle', value: 'Like' },
          { by: 'aria', value: 'Like' },
          { by: 'aria', value: 'Thích' }
        ]
      }
    ],
    tiktok: [
      {
        key: 'tt.fyp.likeBtn',
        intent: 'Nút Thích (Like, icon trái tim) của video đang phát trên trang For You của TikTok, ở cột nút bên phải video',
        builtins: [
          { by: 'css', value: '[data-e2e="like-icon"]' },
          { by: 'aria', value: 'Like' },
          { by: 'aria', value: 'Thích' }
        ]
      }
    ]
  };

  let reported = false;
  const send = (action, extra) => new Promise(resolve => {
    if (reported) { resolve(null); return; }
    reported = true;
    chrome.runtime.sendMessage({ action, postId: taskId, runId: run.run_id, deliveryId: run.delivery_id, ...extra },
      response => resolve(response));
  });

  try {
    const anchors = ANCHORS[platform];
    if (!anchors) {
      await send('healthscanFailed', { error: `healthscan chưa có neo mẫu cho nền tảng ${platform}` });
      return;
    }
    // Chờ trang ổn định (SPA render) trước khi định vị.
    await sleep(3500);
    const heal = window.AVJP?.heal;
    const items = [];
    for (const anchor of anchors) {
      if (typeof anchor.prepare === 'function') {
        try { await anchor.prepare(); } catch (_) { /* chuẩn bị lỗi vẫn thử locate */ }
      }
      let found = null;
      if (heal) {
        found = await heal.locate({
          platform, key: anchor.key, intent: anchor.intent,
          builtins: anchor.builtins, timeoutMs: 45000
        }).catch(() => null);
      }
      items.push({
        key: anchor.key,
        found_via: found ? found.via : 'none',
        spec: found ? found.spec : null
      });
      try { chrome.storage.local.set({ lastStatus: `🩺 Healthscan ${platform}: ${anchor.key} -> ${found ? found.via : 'none'}` }); } catch (_) { console.debug("[Auto vjp][healthscan] bỏ qua lỗi:", _); }
    }
    await send('healthscanCompleted', { items });
  } catch (error) {
    reported = false;
    await send('healthscanFailed', { error: error?.message || String(error) });
  }
})();
