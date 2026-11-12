/* Auto vjp — kernel results: listener message DUY NHẤT của tầng module.
 * Hai nhóm action:
 *  A) Action thi hành của content-script đã port từ MUT (postCompleted, commentReplyDone, mediaFetch*...)
 *     -> dịch sang outbox local (thay MUT message-router + result-reporter bản server).
 *  B) Action quản lý `autovjp.*` cho manage.html: tạo task/lịch, xem trạng thái, huỷ, probe.
 * Action lạ: KHÔNG trả lời (để listener của lõi FB xử lý việc của nó).
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const S = globalThis.AVJP.store;
  const K = S.KEYS;
  const outbox = () => globalThis.AVJP.outbox;

  // (2.11.10) Khớp host theo hostname thật (parse URL) — KHÔNG dùng
  // url.includes(h): chuỗi 'instagram.com' cũng xuất hiện trong
  // 'instagram.com.attacker.example' và trong path/query, includes cho
  // qua hết. Đúng khi hostname bằng host hoặc là subdomain của host.
  function hostMatches(url, hosts) {
    try {
      const hostname = new URL(url || '').hostname.toLowerCase();
      if (!hostname) return false;
      return (hosts || []).some(h => {
        const host = String(h || '').toLowerCase();
        return host && (hostname === host || hostname.endsWith('.' + host));
      });
    } catch (_) { return false; }
  }

  function senderPlatform(sender, fallback) {
    try {
      const url = sender?.tab?.url || '';
      for (const [name, pl] of Object.entries(globalThis.AVJP.contract.PLATFORMS)) {
        if (hostMatches(url, pl.hosts)) return name;
      }
    } catch (_) {}
    return fallback || 'facebook';
  }

  async function touchActive() {
    const run = await S.getRun();
    if (run) await S.touchRun({ lastActiveAt: Date.now() });
  }

  const EXEC_ACTIONS = new Set([
    'postCompleted', 'postFailed', 'postResultUnknown', 'updatePostStatus',
    'storyCompleted', 'storyFailed',
    'uploadCompleted', 'uploadFailed',
    'postSubmitStarted', 'postUploadStarted', 'postSubmitAwaitingResult',
    'affiliateCommentDone', 'affiliateCommentProgress',
    'commentReplyDone', 'commentReplyProgress', 'tiktokReplyCheckpoint',
    'nurtureProgress', 'nurtureDone', 'nurtureOwnerPing', 'getNurtureAiComment',
    'microActionDone',
    'healGetLearned', 'healSuggest', 'healMarkProven',
    'healthscanCompleted', 'healthscanFailed',
    'mediaFetchStart', 'mediaFetchChunk', 'mediaFetchEnd', 'fetchImage',
    'getSmartCommentReply', 'socialAccountsScannerResult'
  ]);

  async function handleExec(message, sender, sendResponse) {
    const action = message.action;
    const tabId = sender?.tab?.id || null;
    const platform = senderPlatform(sender, message.platform);
    await touchActive().catch(() => {});

    switch (action) {
      case 'postCompleted':
      case 'storyCompleted':
      case 'uploadCompleted': {
        const confirmed = await outbox().deliver({
          type: action === 'storyCompleted' ? 'story' : (action === 'uploadCompleted' ? 'upload' : 'post'), taskId: message.postId, platform,
          status: 'success', tabId,
          resultUrl: message.resultUrl || null,
          resultUrlType: message.resultUrlType || null,
          actorUrl: message.actorUrl || null, actorName: message.actorName || null,
          targetName: message.targetName || null,
          resultMessage: message.error || undefined,
          details: message.details || null,
          runId: message.runId, deliveryId: message.deliveryId
        });
        return sendResponse({ success: confirmed });
      }
      case 'postResultUnknown': {
        // (2.11.10) Automator đã bấm đăng nhưng KHÔNG proof được bài lên
        // thật — trước đây đi chung nhánh success làm sai thống kê và dễ
        // mất bài vì tưởng đã đăng. Tách riêng: ghi 'uncertain' (kỷ luật
        // kernel: uncertain không tự chạy lại, người kiểm tra tay sau).
        const confirmed = await outbox().deliver({
          type: 'post', taskId: message.postId, platform,
          status: 'uncertain', tabId,
          resultUrl: message.resultUrl || null,
          resultUrlType: message.resultUrlType || (message.actorUrl ? 'profile_fallback' : 'unavailable'),
          actorUrl: message.actorUrl || null, actorName: message.actorName || null,
          targetName: message.targetName || null,
          resultMessage: message.error || undefined,
          details: message.details || null,
          runId: message.runId, deliveryId: message.deliveryId
        });
        return sendResponse({ success: confirmed });
      }
      case 'postFailed':
      case 'storyFailed':
      case 'uploadFailed': {
        const confirmed = await outbox().deliver({
          type: action === 'storyFailed' ? 'story' : (action === 'uploadFailed' ? 'upload' : 'post'), taskId: message.postId, platform,
          status: 'failed', tabId,
          // (2.11.10) Gắn failure_code để tầng retry (runner) phân loại
          // được fail nào thử lại được; thiếu cả hai nguồn thì để null
          // (không phân loại được -> fail chung cuộc như cũ).
          failure_code: message.failure_code || (message.details && message.details.failure_code) || null,
          actorUrl: message.actorUrl || null, actorName: message.actorName || null,
          targetName: message.targetName || null,
          resultMessage: message.error || 'Extension không thể hoàn tất đăng bài',
          details: message.details || null,
          runId: message.runId, deliveryId: message.deliveryId
        });
        return sendResponse({ success: confirmed });
      }
      case 'updatePostStatus': {
        const confirmed = await outbox().deliver({
          type: 'post', taskId: message.postId, platform, status: message.status,
          resultUrl: message.resultUrl, actorUrl: message.actorUrl,
          actorName: message.actorName, targetName: message.targetName,
          resultMessage: message.resultMessage, tabId
        });
        return sendResponse({ success: confirmed });
      }
      case 'postSubmitStarted':
      case 'postUploadStarted':
      case 'postSubmitAwaitingResult': {
        await S.set({ [K.LAST_STATUS]: `Auto vjp: ${action}` });
        return sendResponse({ success: true });
      }
      case 'affiliateCommentProgress':
      case 'commentReplyProgress': {
        const run = await S.getRun();
        if (run && Array.isArray(message.items) && message.items.length) {
          await S.touchRun({ items: message.items });
        }
        return sendResponse({ success: true });
      }
      case 'affiliateCommentDone': {
        const items = Array.isArray(message.items) ? message.items : [];
        const confirmed = await outbox().deliver({
          type: 'affiliate', taskId: message.campaignId, platform, tabId,
          items, error: message.error || '', exhausted: Boolean(message.exhausted),
          sourceUrl: message.sourceGroupUrl || '', sourceKey: message.sourceKey || ''
        });
        return sendResponse({ success: confirmed });
      }
      case 'commentReplyDone': {
        const confirmed = await outbox().deliver({
          type: 'reply', taskId: message.campaignId, platform, tabId,
          items: message.items || [], error: message.error || '',
          sourceUrl: message.sourceUrl || '', sourceKey: message.sourceKey || ''
        });
        return sendResponse({ success: confirmed });
      }
      case 'nurtureProgress': {
        // Mọi module nuôi (tiktok-nurture, instagram-nurture...) báo tiến độ
        // định kỳ: chỉ chạm run để watchdog thấy phiên còn sống + lưu counters
        // gần nhất lên run. Không gắn cứng nền tảng nào.
        const run = await S.getRun();
        if (run && run.type === 'nurture' && String(run.task_id) === String(message.taskId || '')) {
          await S.touchRun({ nurture_counters: message.counters || null, nurture_progress_at: Date.now() });
        }
        return sendResponse({ success: true });
      }
      case 'nurtureOwnerPing': {
        // Module nuôi (kiểu friendWarmAmIOwner của bản gốc) hỏi tab id của
        // chính tab gửi để ghi <prefix>OwnerTabId vào state run.
        return sendResponse({ success: true, tabId });
      }
      case 'getNurtureAiComment': {
        // Đường AI comment dùng chung của họ nuôi: prompt đã được lõi nuôi
        // (nurture-core) dựng sẵn kèm nội dung bài.
        // Ưu tiên 1: API của lõi fork (hàm của background.js nằm cùng global
        // scope của SW; cấu hình sync aiProvider/aiApiKey/aiModel — vd 9router
        // qua provider custom). Ưu tiên 2: aitab (tab ChatGPT/Gemini).
        // Lỗi cả hai -> {success:false} để adapter rơi về mẫu comment trong task.
        const prompt = String(message.prompt || '');
        try {
          const g = globalThis;
          if (typeof g.getPageAiConfig === 'function' && typeof g.callConfiguredText === 'function') {
            const ai = await g.getPageAiConfig({});
            if (ai && (ai.provider === 'meta-free' || ai.key)) {
              const raw = await g.callConfiguredText(ai.provider, ai.key, ai.model, ai.url, '', prompt, null, 'nurture-comment');
              const text = typeof g.cleanGeneratedComment === 'function' ? g.cleanGeneratedComment(raw) : String(raw || '').trim();
              if (text) return sendResponse({ success: true, text, via: 'core-api' });
            }
          }
        } catch (_) { /* API lõi lỗi -> rơi xuống aitab */ }
        try {
          const text = await globalThis.AVJP.aitab.generateCaption(prompt, message.provider);
          return sendResponse(text ? { success: true, text, via: 'aitab' } : { success: false, error: 'AI không trả nội dung' });
        } catch (err) {
          return sendResponse({ success: false, error: err?.message || String(err) });
        }
      }
      case 'healGetLearned': {
        // Tự chữa selector (2.9.0): module hỏi spec đã học cho
        // platform:key của nó. Không có -> {success:false} để module
        // rơi xuống builtins. Xem modules/kernel/heal.js.
        const entry = await globalThis.AVJP.healCore.getLearned(message.platform || platform, message.key);
        return sendResponse(entry ? { success: true, spec: entry.spec, hits: entry.hits || 0 } : { success: false });
      }
      case 'healSuggest': {
        // AI lỗi/sai format -> specs rỗng, module fail như cũ (kỷ luật
        // heal: không treo, không đoán bừa).
        const specs = await globalThis.AVJP.healCore.suggest({
          platform: message.platform || platform, key: message.key,
          intent: message.intent, snapshot: message.snapshot
        });
        return sendResponse({ success: specs.length > 0, specs });
      }
      case 'healMarkProven': {
        // CHỈ module đã đạt proof thật mới gọi action này; heal.js
        // validate spec lại lần nữa trước khi lưu.
        const okSaved = await globalThis.AVJP.healCore.markProven(message.platform || platform, message.key, message.spec);
        return sendResponse({ success: okSaved });
      }
      case 'healthscanCompleted':
      case 'healthscanFailed': {
        const confirmed = await outbox().deliver({
          type: 'healthscan', taskId: message.postId, platform, tabId,
          status: action === 'healthscanCompleted' ? 'success' : 'failed',
          resultMessage: message.error || undefined,
          items: Array.isArray(message.items) ? message.items : [],
          runId: message.runId, deliveryId: message.deliveryId
        });
        return sendResponse({ success: confirmed });
      }
      case 'nurtureDone': {
        const confirmed = await outbox().deliver({
          type: 'nurture', taskId: message.taskId, platform, tabId,
          status: message.status || 'failed',
          failure_code: message.failure_code || null,
          resultMessage: message.resultMessage || '',
          items: Array.isArray(message.items) ? message.items : []
        });
        return sendResponse({ success: confirmed });
      }
      case 'microActionDone': {
        // (2.11.16) Hành động nhỏ test lẻ (modules/<platform>/micro.js):
        // một action duy nhất mang status sẵn — cùng khuôn nurtureDone,
        // cộng details (vd {action:'like_first', liked:true}) để trang
        // quản lý hiển thị đúng việc đã làm.
        // (2.11.17) Gắn nhãn tiếng Việt từ registry MICRO_ACTIONS vào
        // details.label (nếu tra được) để biên lai/nhật ký đọc được tên
        // hành động thay vì chỉ khoá key.
        const microDetails = message.details || null;
        try {
          const reg = globalThis.AVJP?.contractData?.MICRO_ACTIONS;
          const actKey = microDetails && microDetails.action;
          const entry = reg && actKey ? (reg[platform] || []).find(e => e.key === actKey) : null;
          if (entry && microDetails && !microDetails.label) microDetails.label = entry.label;
        } catch (_) {}
        const confirmed = await outbox().deliver({
          type: 'micro_action', taskId: message.taskId, platform, tabId,
          status: message.status || 'failed',
          failure_code: message.failure_code || null,
          resultMessage: message.resultMessage || '',
          resultUrl: message.resultUrl || undefined,
          details: microDetails
        });
        return sendResponse({ success: confirmed });
      }
      case 'tiktokReplyCheckpoint': {
        const run = await S.getRun();
        if (run?.type === 'reply' && run.platform === 'tiktok' && run.tabId === tabId) {
          await S.touchRun({ tiktok_checkpoint: message.checkpoint });
          return sendResponse({ success: true });
        }
        return sendResponse({ success: false });
      }
      case 'mediaFetchStart':
        return sendResponse(await globalThis.AVJP.media.start(message.url));
      case 'mediaFetchChunk':
        return sendResponse(globalThis.AVJP.media.chunk(message.id, message.offset, message.length));
      case 'mediaFetchEnd':
        return sendResponse(globalThis.AVJP.media.end(message.id));
      case 'fetchImage':
        return sendResponse(await globalThis.AVJP.media.fetchImage(message.url));
      case 'getSmartCommentReply': {
        // MUT gọi server xin gợi ý; fork thay bằng web-tab AI (S8). Lỗi -> null để script rơi về reply_templates.
        try {
          const prompt = `Viết 1 câu trả lời ngắn, thân thiện bằng tiếng Việt cho bình luận sau trên mạng xã hội. Chỉ trả về câu trả lời.\nTác giả: ${message.commentAuthor || ''}\nBình luận: ${message.commentText || ''}`;
          const text = await globalThis.AVJP.aitab.generateCaption(prompt, message.provider);
          return sendResponse(text ? { data: { reply_text: text } } : null);
        } catch (_) {
          return sendResponse(null);
        }
      }
      case 'socialAccountsScannerResult': {
        const accounts = Array.isArray(message.accounts) ? message.accounts : [];
        const plat = message.platform || platform;
        if (accounts.length) {
          await S.withLock(async () => {
            const stored = (await S.get(K.ACCOUNTS)) || {};
            const list = Array.isArray(stored[plat]) ? stored[plat] : [];
            for (const acc of accounts) {
              const key = String(acc.social_uid || acc.social_username || '');
              if (!key) continue;
              const idx = list.findIndex(a => String(a.social_uid || a.social_username || '') === key);
              const entry = { ...acc, platform: plat, scanned_at: Date.now() };
              if (idx >= 0) list[idx] = entry; else list.push(entry);
            }
            stored[plat] = list;
            await S.set({ [K.ACCOUNTS]: stored });
          });
        }
        const run = await S.getRun();
        if (run && run.type === 'scan_account') {
          const exact = String(run.task_id) === String(message.scanId || '');
          // (2.11.11) Dự phòng scanId lạc: vài scanner (vd TikTok) gửi kết
          // quả KHÔNG kèm scanId — trước đây bị nuốt sạch, run treo tới khi
          // user tự đóng tab mới ra receipt failed. Nay scanId thiếu/không
          // khớp nhưng run scan_account đang chạy có platform khớp
          // (message.platform / platform suy từ tab gửi / platform của
          // account đầu tiên) thì vẫn nhận kết quả cho run đó. CHỈ nới cho
          // scan_account; type khác giữ nguyên kỷ luật khớp taskId.
          const msgPlat = message.platform || platform;
          const accPlat = accounts.length ? String(accounts[0].platform || '') : '';
          const platformHit = run.platform === msgPlat || (accPlat !== '' && run.platform === accPlat);
          if (exact || platformHit) {
            if (!exact) {
              console.warn('[Auto vjp][results] Nhận kết quả quét lạc scanId cho run scan_account hiện tại', {
                scanId: message.scanId || null, runTask: run.task_id, platform: run.platform
              });
            }
            await outbox().deliver({
              type: 'scan_account', taskId: run.task_id, platform: run.platform, tabId,
              status: message.error && !accounts.length ? 'failed' : 'success',
              resultMessage: message.error || `Quét được ${accounts.length} tài khoản`,
              items: accounts
            });
          }
        }
        return sendResponse({ success: true });
      }
    }
  }

  async function handleManage(message, sendResponse) {
    const action = message.action;
    try {
      switch (action) {
        case 'autovjp.createTask': {
          const task = await globalThis.AVJP.source.enqueue(message.task || {});
          return sendResponse({ success: true, task });
        }
        case 'autovjp.createSchedule': {
          const sch = {
            id: S.newId('sch'),
            template: message.template,
            run_at: Number(message.run_at),
            repeat: message.repeat === 'daily' ? 'daily' : null,
            created_at: Date.now()
          };
          globalThis.AVJP.source.validateTask(sch.template || {});
          if (!sch.run_at) throw new Error('Thiếu run_at');
          await S.withLock(async () => {
            const list = (await S.get(K.SCHEDULES)) || [];
            list.push(sch);
            await S.set({ [K.SCHEDULES]: list });
          });
          globalThis.AVJP.source.kick().catch(() => {});
          return sendResponse({ success: true, schedule: sch });
        }
        case 'autovjp.deleteSchedule': {
          await S.withLock(async () => {
            const list = (await S.get(K.SCHEDULES)) || [];
            await S.set({ [K.SCHEDULES]: list.filter(sch => sch.id !== message.id) });
          });
          return sendResponse({ success: true });
        }
        case 'autovjp.cancelTask': {
          const run = await S.getRun();
          if (run && String(run.task_id) === String(message.taskId || '')) {
            await globalThis.AVJP.runner.cancelCurrent('User huỷ từ trang quản lý.');
            return sendResponse({ success: true, cancelled: 'running' });
          }
          await S.withLock(async () => {
            const queue = (await S.get(K.QUEUE)) || [];
            await S.set({ [K.QUEUE]: queue.filter(t => String(t.id) !== String(message.taskId || '')) });
          });
          return sendResponse({ success: true, cancelled: 'queued' });
        }
        case 'autovjp.setPaused': {
          await S.set({ [K.PAUSED]: Boolean(message.paused) });
          if (!message.paused) globalThis.AVJP.source.kick().catch(() => {});
          return sendResponse({ success: true });
        }
        case 'autovjp.listState': {
          const stored = await S.getMany([K.QUEUE, K.SCHEDULES, K.RECEIPTS, K.OUTBOX, K.ACCOUNTS, K.PAUSED, K.CANONICAL, K.LEARNED]);
          return sendResponse({
            success: true,
            queue: stored[K.QUEUE] || [],
            schedules: stored[K.SCHEDULES] || [],
            receipts: (stored[K.RECEIPTS] || []).slice(-50).reverse(),
            outbox: stored[K.OUTBOX] || [],
            accounts: stored[K.ACCOUNTS] || {},
            paused: Boolean(stored[K.PAUSED]),
            currentRun: stored[K.CANONICAL] || null,
            learnedSelectors: stored[K.LEARNED] || {},
            platforms: globalThis.AVJP.contract.platformNames.filter(p => p !== 'probe')
          });
        }
        case 'autovjp.healForget': {
          const okForgot = await globalThis.AVJP.healCore.forget(String(message.id || ''));
          return sendResponse({ success: okForgot });
        }
        case 'autovjp.healForgetAll': {
          await globalThis.AVJP.healCore.forgetAll();
          return sendResponse({ success: true });
        }
        case 'autovjp.probe': {
          const result = await globalThis.AVJP.source.probe(message.echo);
          return sendResponse(result);
        }
        case 'autovjp.clearReceipts': {
          await S.set({ [K.RECEIPTS]: [], [K.RECEIPT_KEYS]: [] });
          return sendResponse({ success: true });
        }
      }
    } catch (err) {
      return sendResponse({ success: false, error: err?.message || String(err) });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.action !== 'string') return;
    if (EXEC_ACTIONS.has(message.action)) {
      handleExec(message, sender, sendResponse).catch(err => {
        console.error('[Auto vjp][results]', message.action, err);
        try { sendResponse({ success: false, error: err?.message || String(err) }); } catch (_) {}
      });
      return true;
    }
    if (message.action.startsWith('autovjp.')) {
      handleManage(message, sendResponse);
      return true;
    }
    // Action lạ: không trả lời — listener của lõi FB sẽ xử lý.
  });

  globalThis.AVJP.results = { ready: true };
})();
