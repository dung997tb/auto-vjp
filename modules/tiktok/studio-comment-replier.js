// Select the observed TikTok Studio filter before inspecting any comment rows.
async function ensureTikTokUnrepliedFilter({ wait, visible, text }) {
  const unreplied = /^(chưa trả lời|chưa phản hồi|not replied|unreplied|unanswered)$/i;
  const status = /^(tất cả bình luận|all comments|đã trả lời|replied|chưa trả lời|chưa phản hồi|not replied|unreplied|unanswered)$/i;
  const trigger = () => Array.from(document.querySelectorAll('[data-tt="components_FilterButton_TUXText"]')).find(el => visible(el) && status.test(text(el)));
  const current = await wait(trigger);
  if (!current) throw new Error('Không tìm thấy bộ lọc trạng thái TikTok Studio; chưa gửi bình luận.');
  if (unreplied.test(text(current))) return;
  current.click();
  const option = await wait(() => Array.from(document.querySelectorAll('[data-tt="components_Select_TUXText"]')).find(el => visible(el) && unreplied.test(text(el))));
  if (!option) throw new Error('Không tìm thấy lựa chọn Chưa trả lời; chưa gửi bình luận.');
  option.click();
  if (!await wait(() => { const el = trigger(); return el && unreplied.test(text(el)); })) throw new Error('TikTok chưa xác nhận bộ lọc Chưa trả lời.');
}

(async () => {
  const key = 'currentCommentReplyTask_tiktok';
  const { [key]: task } = await chrome.storage.local.get(key);
  if (!task || task.source_type !== 'comments_manager') return;
  const identity = `${task.id}:${task.run_id || ''}:${task.source_key || ''}`;
  if (window.mutTikTokStudioRunning === identity) return;
  window.mutTikTokStudioRunning = identity;
  const text = el => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el?.isConnected && !!el.getClientRects().length;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const previous = task.tiktok_checkpoint?.identity === identity ? task.tiktok_checkpoint : {};
  const items = previous.items || [];
  const processed = new Set([...(task.processed_keys || []), ...(previous.attempted || [])]);
  const guard = async () => {
    const stored = await chrome.storage.local.get([key, 'isPaused']);
    const current = stored[key];
    if (!current || `${current.id}:${current.run_id || ''}:${current.source_key || ''}` !== identity || stored.isPaused) throw new Error('Tác vụ bị hủy hoặc tạm dừng.');
    if (location.pathname !== '/tiktokstudio/comment') throw new Error('Tab không còn ở TikTok Studio.');
  };
  const wait = async (check, timeout = 15000) => {
    const end = Date.now() + timeout;
    do { await guard(); const value = check(); if (value) return value; await pause(250); } while (Date.now() < end);
    return null;
  };
  const save = async phase => {
    const response = await chrome.runtime.sendMessage({ action: 'tiktokReplyCheckpoint', campaignId: task.id, runId: task.run_id, sourceKey: task.source_key, checkpoint: { identity, phase, items, attempted: [...processed] } });
    if (!response?.success) throw new Error('Không lưu được trạng thái; dừng để tránh gửi trùng.');
  };
  const done = error => chrome.runtime.sendMessage({ action: 'commentReplyDone', campaignId: task.id, sourceUrl: task.source_url, sourceKey: task.source_key, items, error: error || '' });
  const rowSelector = '[data-tt="components_MessageCell_FlexRow_3"]';
  try {
    if (['submitting', 'verifying'].includes(previous.phase)) throw new Error('Lần gửi trước chưa được xác nhận; không tự gửi lại.');
    const menu = await wait(() => document.querySelector('button[data-tt="Header_NewHeader_Clickable"]'));
    if (!menu) throw new Error('Không tìm thấy menu tài khoản TikTok Studio.');
    if (menu.getAttribute('aria-expanded') !== 'true') menu.click();
    const profile = await wait(() => Array.from(document.querySelectorAll('a[data-tt="Header_NewHeader_TUXMenuItem"]')).find(el => visible(el) && /\/@[\w.-]+\/?$/.test(el.href)));
    const actor = profile?.href.match(/\/@([\w.-]+)\/?$/)?.[1]?.toLowerCase();
    const expected = String(task.social_username || task.social_uid || '').replace(/^@/, '').toLowerCase();
    if (!actor || actor !== expected) throw new Error(`Sai tài khoản TikTok Studio: yêu cầu @${expected}, hiện tại ${actor || 'chưa xác định'}.`);
    menu.click();
    await ensureTikTokUnrepliedFilter({ wait, visible, text });
    await save('acting');
    const rows = await wait(() => {
      const found = Array.from(document.querySelectorAll(rowSelector)).filter(visible);
      return found.length ? found : null;
    });
    if (!rows) throw new Error('Bộ lọc Chưa trả lời đã bật nhưng không có bình luận có thể xử lý.');
    const limit = Math.max(1, Number(task.reply_limit) || 1);
    let completed = 0;
    for (const row of rows) {
      if (completed >= limit) break;
      await guard();
      if (!visible(row)) continue;
      const reply = Array.from(row.querySelectorAll('[data-tt="components_MessageCell_TUXText"]')).find(el => /^(trả lời|reply)$/i.test(text(el)) && visible(el));
      const parentText = text(row);
      const keyId = `tiktok-studio:${parentText.slice(0, 160)}`;
      if (!reply || processed.has(keyId)) continue;
      let content = '';
      if (task.smart_reply_enabled) {
        const suggestion = await chrome.runtime.sendMessage({ action: 'getSmartCommentReply', campaignId: task.id, commentText: parentText });
        content = suggestion?.data?.reply_text || '';
      }
      const templates = (task.reply_templates || []).filter(Boolean);
      content = String(content || templates[completed % templates.length] || '').trim();
      if (!content) continue;
      await guard();
      reply.click();
      // The editor belongs to this row, never to another comment on the page.
      let scope = row;
      for (let i = 0; i < 3 && scope && !scope.querySelector('#comment-input'); i++) scope = scope.parentElement;
      const editor = await wait(() => scope?.querySelector('#comment-input'));
      if (!editor || !visible(editor)) throw new Error('Không xác minh được ô trả lời của bình luận đã chọn.');
      if (content.length > editor.maxLength && editor.maxLength > 0) throw new Error(`Nội dung vượt giới hạn ${editor.maxLength} ký tự của TikTok Studio.`);
      await save('composing');
      editor.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, content);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      if (editor.value !== content) throw new Error('Nội dung trong ô trả lời không khớp.');
      const send = await wait(() => Array.from(scope.querySelectorAll('[data-tt="components_CommentInputEditor_TUXButton"]')).find(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true'), 5000);
      if (!send) throw new Error('Nút gửi trong ô trả lời chưa sẵn sàng.');
      await guard();
      processed.add(keyId);
      await save('submitting');
      const nonce = `${Date.now()}:${Math.random()}`;
      document.documentElement.removeAttribute('data-mut-studio-reply-result');
      document.documentElement.setAttribute('data-mut-studio-reply-request', JSON.stringify({ nonce, text: content }));
      send.click();
      await save('verifying');
      let goneSince = 0;
      const confirmed = await wait(() => {
        const raw = document.documentElement.getAttribute('data-mut-studio-reply-result');
        if (raw) {
          try {
            const result = JSON.parse(raw);
            if (result.nonce === nonce) {
              if (result.success) return true;
              throw new Error(`TikTok từ chối phản hồi (HTTP ${result.status}); không tự gửi lại.`);
            }
          } catch (error) {
            if (error instanceof SyntaxError) return false;
            throw error;
          }
        }
        if (!row.isConnected) {
          if (!goneSince) goneSince = Date.now();
          if (Date.now() - goneSince >= 2000) return true;
        } else {
          goneSince = 0;
        }
        return false;
      }, 20000);
      document.documentElement.removeAttribute('data-mut-studio-reply-request');
      if (!confirmed) throw new Error('Chưa xác nhận phản hồi thành công; không tự gửi lại.');
      items.push({ parent_comment_key: keyId, parent_comment_text: parentText.slice(0, 500), target_url: task.source_url, action_type: 'reply_comment', action_content: content, status: 'success', progress_credit: 1 });
      completed++;
      await save('acting');
      if (completed < limit) {
        const min = Math.max(10, Number(task.delay_min_seconds) || 30);
        const max = Math.max(min, Number(task.delay_max_seconds) || min);
        const until = Date.now() + (min + Math.random() * (max - min)) * 1000;
        while (Date.now() < until) { await guard(); await pause(Math.min(1000, until - Date.now())); }
      }
    }
    await save('finished');
    await done(items.length ? '' : 'Không có bình luận mới phù hợp để trả lời.');
  } catch (error) {
    await done(error.message || 'Không xử lý được TikTok Studio');
  } finally {
    document.documentElement.removeAttribute('data-mut-studio-reply-request');
  }
})();
