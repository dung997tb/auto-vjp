// Auto vjp — modules/youtube/interaction.js (2.6.0, MỚI).
// Task comment ĐỘC LẬP cho YouTube (type 'reply'): mở 1 trang watch từ
// task.source_url và đăng đúng 1 comment lên video đó, có proof.
// Trước 2.6.0 YouTube không có type 'reply' trong contract (chỉ module
// nuôi comment được, kèm cả phiên xem) — file này lấp đúng khoảng đó,
// bám khuôn modules/threads/interaction.js + instagram/interaction.js
// (đọc task qua canonical-task-storage: key currentCommentReplyTask_youtube,
// báo kết quả bằng commentReplyDone) và dùng lại các primitives comment
// của modules/youtube-nurture/adapter.js (ô soạn ytd-comment-simplebox-
// renderer, gõ insertText, proof = chữ ký comment hiện trong #comments).
//
// Kỷ luật (khớp họ interaction + adapter nuôi):
// - Trang live (chỉ có live chat) -> failed 'live_chat_not_comments'.
// - Video tắt bình luận -> failed 'comments_disabled'.
// - #comments không render sau 30s -> failed 'comments_not_rendered'.
// - Vá 2.6.2 (bằng chứng live: kênh đã tạo @LinhVu-t2g nhưng reply vẫn
//   fail comment_box_not_found oan): chờ render + chờ ô soạn gộp thành
//   MỘT vòng lặp ~30s, mỗi vòng CUỘN TỨC THỜI lại tới #comments — bản
//   cũ chỉ scrollIntoView smooth 1 lần ở đầu rồi chờ thụ động, probe
//   giữa lúc module chạy thấy scrollY = 0, #comments ở top=2232px chưa
//   vào viewport nên YouTube không lazy-load nội dung comment, và
//   commentsSectionRendered báo 'ready' giả vì '#header' rỗng có sẵn
//   trong vỏ ytd-comments. Selector ô soạn KHÔNG đổi (probe tay: chờ
//   trang ổn định + cuộn tức thời thì simplebox hiện đầy đủ).
// - Đã gửi mà không thấy proof sau 15s -> failed 'comment_proof_timeout',
//   KHÔNG gửi lại.
// - Nội dung: task.content; thiếu content + smart_reply_enabled -> sinh
//   AI qua action getNurtureAiComment (đường API lõi của kernel, cùng
//   đường adapter nuôi dùng); AI không có -> reply_templates[0].
// - Tự chữa selector (2.9.0): ô soạn không hiện sau vòng chờ 30s ->
//   AVJP.heal.locate (key yt.reply.commentBox); spec qua AI chỉ được
//   markProven SAU proof chữ ký comment. Heal vắng/fail -> giữ nguyên
//   fail comment_box_not_found như cũ.
// - Tài khoản CHƯA CÓ kênh (2.6.1, bằng chứng live: danh tính trong
//   profile công nhân chưa có kênh YouTube): bấm ô comment thì YouTube
//   bật hộp thoại bắt tạo kênh thay cho editor -> failed
//   'channel_required' ngay, không chờ treo, không thử lại.
if (!window.__avjpYoutubeInteractionLoaded) {
window.__avjpYoutubeInteractionLoaded = true;

(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => Boolean(el && el.getBoundingClientRect && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
  const textOf = el => String(el?.innerText || el?.textContent || '').trim();

  const stored = await chrome.storage.local.get('currentCommentReplyTask_youtube');
  const task = stored.currentCommentReplyTask_youtube;
  if (!task || String(task.platform || '').toLowerCase() !== 'youtube') {
    window.__avjpYoutubeInteractionLoaded = false;
    return;
  }
  const taskId = task.id || task.task_id;
  const finish = (items, error = '') => chrome.runtime.sendMessage({
    action: 'commentReplyDone', campaignId: taskId, items, error,
    sourceUrl: task.source_url || location.href
  });
  const fail = code => finish([], code);

  const videoIdFromUrl = u => {
    const m = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(String(u || ''));
    return m ? m[1] : null;
  };
  const isWatchPage = () => /^\/watch/.test(location.pathname);
  const isLivePage = () => {
    if (/^\/live\//.test(location.pathname)) return true;
    if (!isWatchPage()) return false;
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy && (flexy.hasAttribute('is-live-video') || flexy.getAttribute('is-live-video') === 'true')) return true;
    const badge = document.querySelector('.ytp-live-badge');
    if (badge && visible(badge)) return true;
    const v = document.querySelector('#movie_player video, video.html5-main-video');
    const chat = document.querySelector('ytd-live-chat-frame, #chat-frame, ytd-live-chat-renderer');
    if (v && !Number.isFinite(v.duration) && v.readyState >= 1 && chat && visible(chat)) return true;
    return false;
  };
  const commentsOff = () => {
    const c = document.querySelector('ytd-comments, #comments');
    if (!c) return false;
    const t = c.textContent || '';
    return ['Comments are turned off', 'Đã tắt tính năng bình luận', 'tính năng bình luận đã bị tắt'].some(s => t.includes(s));
  };
  const commentsSectionRendered = () => {
    const c = document.querySelector('ytd-comments, #comments');
    if (!c) return false;
    if (commentsOff()) return true;
    // Siết điều kiện render (2.6.2): bản cũ tính cả '#header' — vỏ
    // ytd-comments có sẵn #header RỖNG ngay từ đầu nên báo 'ready' giả
    // dù nội dung comment chưa hề lazy-load. Render thật = simplebox
    // đã có trong DOM hoặc đã có ít nhất 1 thread comment.
    if (c.querySelector('ytd-comment-simplebox-renderer')) return true;
    return c.querySelectorAll('ytd-comment-thread-renderer').length > 0;
  };
  const commentBoxParts = () => {
    const box = document.querySelector('ytd-comment-simplebox-renderer');
    if (!box) return null;
    const editable = box.querySelector('#contenteditable-root[contenteditable="true"], div[contenteditable="true"]');
    const placeholder = box.querySelector('#simplebox-placeholder');
    const submitWrap = box.querySelector('#submit-button');
    const submitBtn = submitWrap ? (submitWrap.querySelector('button') || submitWrap) : null;
    return { box, editable, placeholder, submitBtn };
  };
  // Hộp thoại bắt tạo kênh (2.6.1): khi tài khoản chưa có kênh, bấm ô
  // comment thì YouTube hiện dialog tạo kênh (nút/link "Tạo kênh" /
  // "Create channel") thay cho editor. Quét các dialog ĐANG HIỆN; thấy
  // nút tạo kênh bên trong = kết luận channel_required.
  const CHANNEL_REQUIRED = 'channel_required: cần tạo kênh YouTube mới bình luận được';
  const channelCreationPrompt = () => {
    const dialogs = document.querySelectorAll(
      'ytd-modal-with-title-and-button-renderer, tp-yt-paper-dialog, [role="dialog"]');
    for (const d of dialogs) {
      if (!visible(d)) continue;
      const hit = [...d.querySelectorAll('button, a')]
        .find(el => /tạo kênh|create channel/i.test(textOf(el)));
      if (hit) return d;
    }
    return null;
  };
  const signatureInComments = text => {
    const frag = normalize(text).toLowerCase().slice(0, 60);
    if (!frag) return null;
    for (const el of document.querySelectorAll('#comments #content-text')) {
      if (normalize(el.textContent || '').toLowerCase().includes(frag)) return el;
    }
    return null;
  };
  const waitFor = async (finder, timeout = 15000, interval = 400) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = finder();
      if (found) return found;
      await sleep(interval);
    }
    return null;
  };

  try {
    // Runner mở tab ở task.source_url (contract startUrl nhánh reply).
    // Lạc bề mặt khác mà có source_url -> điều hướng thẳng tới video;
    // bản inject ở trang watch chạy tiếp (cờ chống trùng nằm trong
    // document nên trang mới không bị chặn).
    if (!isWatchPage() && !/^\/live\//.test(location.pathname)) {
      if (task.source_url && location.href !== task.source_url) {
        location.href = task.source_url;
        await sleep(60000); // chờ trang watch thay thế
        return;
      }
      return fail('not_a_watch_page: source_url không trỏ tới trang xem video YouTube');
    }
    await sleep(1200);

    // Chưa đăng nhập: masthead chỉ có nút Sign in, không có avatar.
    const mast = document.querySelector('ytd-masthead, #masthead');
    if (mast && mast.querySelector('a[href*="ServiceLogin"]') && !mast.querySelector('#avatar-btn, button#avatar-btn')) {
      return fail('session_expired: chưa đăng nhập YouTube');
    }
    if (document.querySelector('iframe[src*="recaptcha"], form[action*="/sorry/"]')) {
      return fail('session_expired: YouTube hiện captcha — dừng, không lách');
    }
    // Trang live chỉ có live chat, không có khung comment thường.
    if (isLivePage()) {
      return fail('live_chat_not_comments: video đang phát trực tiếp chỉ có live chat, không có khung bình luận');
    }

    // --- Nội dung comment ---
    let text = String(task.content || '').trim();
    let source = 'task';
    if (!text && task.smart_reply_enabled) {
      const title = textOf(document.querySelector('ytd-watch-metadata h1, #title h1, h1.ytd-watch-metadata'))
        || document.title.replace(/ - YouTube$/, '');
      const desc = textOf(document.querySelector('#description-inline-expander, ytd-text-inline-expander#description, #description')).slice(0, 600);
      const postText = [title, desc].filter(Boolean).join('\n').slice(0, 1200);
      if (postText.length >= 10) {
        const prompt = 'Đọc bài viết công khai sau và viết 1 bình luận ngắn (<20 từ) bằng tiếng Việt, lịch sự và trung tính như người mới biết, nhắc 1 chi tiết cụ thể trong bài. Không thân mật quá, không bán hàng, không link, không hashtag, không sao chép nguyên văn. Tuyệt đối không nhắc tên người, địa danh hay số liệu không có trong bài viết. CHỈ xuất ra đúng câu bình luận sẽ đăng, không giải thích, không phân tích, không mô tả lại bài viết.\n\nBài viết: ' + postText;
        try {
          const res = await chrome.runtime.sendMessage({ action: 'getNurtureAiComment', prompt });
          if (res && res.success && res.text) { text = String(res.text).trim(); source = 'ai'; }
        } catch (_) { /* AI lỗi -> rơi về mẫu */ }
      }
    }
    if (!text) {
      const templates = (Array.isArray(task.reply_templates) ? task.reply_templates : [])
        .map(s => String(s || '').trim()).filter(Boolean);
      if (templates.length) { text = templates[0]; source = 'template'; }
    }
    if (!text) return fail('missing_comment_content: task không có content, AI không sinh được và không có reply_templates');

    // --- MỘT vòng chờ hợp nhất ~30s: cuộn TỨC THỜI tới #comments ở
    // MỌI vòng poll cho tới khi ô soạn hiện (2.6.2 — bằng chứng live ở
    // header file: cuộn smooth 1 lần bị SPA nuốt/reset, scrollY vẫn 0
    // nên YouTube không lazy-load comment). Mỗi vòng: (a) cuộn tức
    // thời tới anchor (scrollBy dự phòng khi scrollIntoView chưa đưa
    // anchor vào viewport), (b) dialog tạo kênh -> channel_required,
    // (c) tắt bình luận -> comments_disabled, (d) có placeholder/
    // editable -> thoát vòng sang bước gõ. Hết 30s mà section CHƯA
    // TỪNG render (điều kiện siết: simplebox hoặc >=1 thread) ->
    // comments_not_rendered; đã render mà ô soạn không có ->
    // comment_box_not_found. ---
    const scrollToCommentsNow = () => {
      const a = document.querySelector('ytd-comments, #comments');
      if (!a) { window.scrollBy(0, Math.floor(window.innerHeight * 1.2)); return; }
      a.scrollIntoView({ block: 'start' });
      const r = a.getBoundingClientRect();
      if (r.top > window.innerHeight || r.top < -200) window.scrollBy(0, r.top - 80);
    };
    let parts = null;
    let healBoxSpec = null; // (2.9.0) spec AI đã định vị được ô comment — chỉ markProven sau proof
    let sectionSeen = false;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 30000 && !parts) {
      scrollToCommentsNow();
      if (channelCreationPrompt()) return fail(CHANNEL_REQUIRED);
      if (commentsOff()) return fail('comments_disabled: video đã tắt tính năng bình luận');
      if (commentsSectionRendered()) sectionSeen = true;
      const p = commentBoxParts();
      if (p && (p.placeholder || p.editable)) parts = p;
      else await sleep(400);
    }
    if (!parts) {
      if (!sectionSeen) return fail('comments_not_rendered: #comments không render sau 30s');
      // (2.9.0) Tự chữa selector: ô soạn không hiện theo finder gốc
      // -> AVJP.heal.locate (đã học -> builtin -> AI từ snapshot).
      // Định vị được thì bấm mở editor như bấm placeholder; không
      // được thì giữ nguyên fail comment_box_not_found như cũ.
      const heal = window.AVJP?.heal;
      if (heal) {
        const found = await heal.locate({
          platform: 'youtube', key: 'yt.reply.commentBox',
          intent: 'Ô soạn bình luận của YouTube trên trang xem video — khung placeholder "Add a comment…" / "Viết bình luận…" dưới video, bấm vào để gõ bình luận',
          builtins: [
            { by: 'css', value: '#simplebox-placeholder' },
            { by: 'css', value: 'ytd-comment-simplebox-renderer #contenteditable-root' }
          ],
          root: document.querySelector('ytd-comments, #comments') || null,
          timeoutMs: 30000
        }).catch(() => null);
        if (found) {
          if (found.via === 'ai') healBoxSpec = found.spec;
          if (channelCreationPrompt()) return fail(CHANNEL_REQUIRED);
          try { found.el.click(); } catch (_) { console.debug("[Auto vjp][interaction] bỏ qua lỗi:", _); }
          const opened = await waitFor(() => {
            const p = commentBoxParts();
            return p && p.editable ? p : null;
          }, 5000, 300);
          if (opened) parts = opened;
        }
      }
      if (!parts) return fail('comment_box_not_found: #comments đã render nhưng ô soạn không xuất hiện sau 30s');
    }
    if (!parts.editable && parts.placeholder) {
      parts.placeholder.click();
      // Bấm placeholder là thời điểm YouTube bật dialog tạo kênh (nếu
      // tài khoản chưa có kênh) — poll cả dialog trong lúc chờ editor.
      let opened = null;
      const openStart = Date.now();
      while (Date.now() - openStart < 5000 && !opened) {
        if (channelCreationPrompt()) return fail(CHANNEL_REQUIRED);
        const p = commentBoxParts();
        if (p && p.editable) opened = p;
        else await sleep(300);
      }
      if (!opened) return fail('comment_editor_not_opened: bấm ô soạn nhưng editor không mở');
      parts = opened;
    }
    const ed = parts.editable;
    ed.focus();
    try { ed.click(); } catch (_) { console.debug("[Auto vjp][interaction] bỏ qua lỗi:", _); }
    await sleep(300);
    try { document.execCommand('insertText', false, text); } catch (_) { console.debug("[Auto vjp][interaction] bỏ qua lỗi:", _); }
    if (!normalize(ed.textContent).includes(normalize(text).slice(0, 20))) {
      for (const ch of text) {
        try { document.execCommand('insertText', false, ch); } catch (_) { break; }
      }
    }
    if (!normalize(ed.textContent).includes(normalize(text).slice(0, 20))) {
      ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    if (!normalize(ed.textContent).includes(normalize(text).slice(0, 20))) {
      return fail('comment_text_not_entered: editor không nhận nội dung comment');
    }
    await sleep(500);
    const fresh = commentBoxParts();
    const submitBtn = (fresh && fresh.submitBtn) || parts.submitBtn;
    if (!submitBtn) return fail('comment_submit_not_found: không thấy nút gửi bình luận');
    submitBtn.click();

    // --- Proof: chữ ký comment hiện trong danh sách (tối đa 15s).
    // Không thấy = failed, KHÔNG gửi lại (kỷ luật họ interaction). ---
    const proof = await waitFor(() => signatureInComments(text), 15000, 700);
    if (!proof) return fail('comment_proof_timeout: đã bấm gửi nhưng comment không hiện trong danh sách sau 15s — không gửi lại');
    // (2.9.0) Proof comment thật đã đạt -> lưu selector ô comment
    // nếu nó đến từ AI (markProven phía SW validate lại format).
    if (healBoxSpec) {
      try { window.AVJP?.heal?.markProven({ platform: 'youtube', key: 'yt.reply.commentBox', spec: healBoxSpec }); } catch (_) { console.debug("[Auto vjp][interaction] bỏ qua lỗi:", _); }
    }
    const videoId = videoIdFromUrl(location.href);
    const title = textOf(document.querySelector('ytd-watch-metadata h1, #title h1, h1.ytd-watch-metadata'))
      || document.title.replace(/ - YouTube$/, '');
    finish([{
      target_url: location.href,
      parent_comment_key: `youtube-video:${videoId || location.href}`,
      parent_comment_text: title.slice(0, 300),
      action_type: 'comment_post',
      action_content: text,
      status: 'success',
      source,
      progress_credit: 1
    }]);
  } catch (error) {
    finish([], error?.message || 'Lỗi tương tác YouTube');
  }
})();
}
