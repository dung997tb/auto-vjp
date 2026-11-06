/* metaai.js — Meta AI Free worker (provider "meta-free", 0đ qua meta.ai).
 *
 * File ĐỘC LẬP: chỉ chạy trên meta.ai (match riêng trong manifest), không dùng
 * chung state machine/selector/counter/proof với bất kỳ tính năng Facebook nào.
 * Nhiệm vụ duy nhất: nhận prompt từ background -> hỏi Meta AI web -> trả text.
 * Không đọc cookie/token, không đụng Facebook DOM.
 */
(function () {
  "use strict";
  if (globalThis.__metaFreeLoaded) return;
  globalThis.__metaFreeLoaded = true;

  const HOME = "https://www.meta.ai/";
  const ASK_TIMEOUT_MS = 150000;
  const LOGIN_WAIT_MS = 20000;
  const POLL_MS = 1000;
  // Ổn định theo THỜI GIAN (không đếm vòng): tab nền bị Chrome dồn timer
  // 60s/lần thì đếm vòng không bao giờ đủ 3 vòng trong 150s dù Meta đã trả
  // xong từ lâu — đây là nguyên nhân treo oan "AI quá 150 giây" trên Chrome
  // thường (Chrome test để cửa sổ nổi nên không dính).
  const STABLE_MS = 3000;
  const STABLE_FALLBACK_MS = 9000;

  let busy = false;
  // Seq của lượt hỏi mới nhất: SW tăng mỗi ask; ask cũ (orphan do feed đã bỏ
  // sau 150s) thấy seq mới thì tự dừng trước mọi thao tác ghi/click để 2 lượt
  // không giằng nhau trên cùng composer.
  let activeSeq = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Chờ có thay đổi DOM hoặc hết khoảng chờ: immune với timer-throttling của
  // tab nền (MutationObserver vẫn bắn khi network/stream render DOM, còn
  // setTimeout có thể bị dồn 60s/lần). Trả true nếu có mutation.
  function waitDomChange(timeoutMs) {
    return new Promise((resolve) => {
      let done = false, obs = null;
      const timer = setTimeout(() => {
        if (!done) { done = true; try { obs && obs.disconnect(); } catch (_) {} resolve(false); }
      }, Math.max(50, timeoutMs));
      try {
        obs = new MutationObserver(() => {
          if (!done) { done = true; clearTimeout(timer); try { obs.disconnect(); } catch (_) {} resolve(true); }
        });
        obs.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
      } catch (_) { /* fallback: timer decides */ }
    });
  }

  function composerInput() {
    // Build 2026: ô soạn là DIV contenteditable[data-testid=composer-input]
    // (KHÔNG còn role=textbox); textarea cùng testid chỉ là mirror ẩn 0x0.
    // Ưu tiên DIV hiển thị trước, nếu không sẽ gõ vào mirror và fail câm.
    const editable =
      document.querySelector('div[role="textbox"][data-testid="composer-input"]') ||
      document.querySelector('div[contenteditable="true"][data-testid="composer-input"]') ||
      document.querySelector('div[contenteditable="true"]');
    if (editable) return editable;
    return (
      document.querySelector('textarea[data-testid="composer-input"]') ||
      document.querySelector('textarea[placeholder]') ||
      null
    );
  }
  function sendButton() {
    return (
      document.querySelector('button[data-testid="composer-send-button"]') ||
      // Dự phòng khi Meta đổi build/testid: nút Gửi theo aria gần composer.
      (() => {
        const input = composerInput();
        const scope = input ? (input.closest("form") || input.parentElement) : document;
        if (!scope || scope === document) return null;
        const btns = Array.from(scope.querySelectorAll('button[aria-label]'));
        return btns.find((b) => /^(gửi|send|dừng|stop)/i.test((b.getAttribute("aria-label") || "").trim())) || null;
      })() ||
      null
    );
  }
  function assistantMessages() {
    const direct = Array.from(document.querySelectorAll('div[data-testid="assistant-message"]'));
    if (direct.length) return direct;
    // Dự phòng build Meta khác: class nhóm assistant-message hoặc role author.
    const byClass = Array.from(document.querySelectorAll('div[class*="assistant-message"]'))
      .filter((el) => !el.querySelector('div[class*="assistant-message"]'));
    if (byClass.length) return byClass;
    return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
  }
  // Tường login: không có ô chat sau khi chờ (user chưa login meta.ai lần nào).
  function looksLoggedOut() {
    if (composerInput()) return false;
    const txt = (document.body?.innerText || "").slice(0, 2000);
    return /log in|đăng nhập/i.test(txt);
  }

  function stripThinking(text) {
    return String(text || "")
      .split(/\r?\n/)
      .filter((line, i) => {
        if (i > 2) return true;
        // KHÔNG dùng \b: dấu tiếng Việt là non-word với regex JS thường.
        return !/^\s*(hiển thị suy nghĩ|show thinking|đang suy nghĩ|thinking|drafting|reasoning|analyzing|đang soạn|đang nghĩ)(\s|$)/i.test(line);
      })
      .join("\n")
      .trim();
  }

  // Meta có 2 build composer khác nhau:
  // - Build cũ: div contenteditable role=textbox (textarea chỉ là mirror ẩn 0x0).
  // - Build mới: CHỈ có textarea thật (không còn div role=textbox nào) — bản
  //   cũ trả META_NO_COMPOSER oan cho build này dù ô nhập vẫn có trong DOM.
  // editorDiv() = div contenteditable (build cũ), null ở build mới.
  function editorDiv() {
    return document.querySelector('div[role="textbox"][data-testid="composer-input"]') ||
      document.querySelector('div[contenteditable="true"][data-testid="composer-input"]') ||
      document.querySelector('div[contenteditable="true"]');
  }
  // Ô nhập thực dùng để gõ (build mới dùng textarea; build cũ ưu tiên div vì
  // textarea chỉ là mirror). Trả {el, kind} để chỗ gõ/đặt caret xử lý đúng.
  function composerTarget() {
    const div = editorDiv();
    if (div) return { el: div, kind: "div" };
    const ta = document.querySelector('textarea[data-testid="composer-input"]');
    if (ta) return { el: ta, kind: "textarea" };
    return null;
  }
  function editorText() {
    const div = editorDiv();
    if (div) return String(div.innerText || div.textContent || "");
    const ta = document.querySelector('textarea[data-testid="composer-input"]');
    return String((ta && ta.value) || "");
  }

  async function waitComposer(timeoutMs) {
    // Tab worker chạy nền (inactive) nên không đòi hỏi phần tử phải "nhìn thấy"
    // (offsetParent null ở tab chưa paint) — chỉ cần có trong DOM là gõ/click được.
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const el = composerInput();
      if (el) return el;
      await sleep(500);
    }
    return null;
  }

  async function askOnce(prompt, mySeq) {
    if (busy) {
      // Đừng từ chối ngay (bắt live 17/10: cả trăm lượt "bận câu trước" dồn
      // dập khi nhịp các luồng nhanh hơn ask trước): lượt trước có thể đang
      // dọn cuối/streaming nốt — chờ tối đa 60s cho nó nhả rồi mới chịu thua.
      const idleEnd = Date.now() + 60000;
      while (busy && Date.now() < idleEnd) {
        if (mySeq !== undefined && mySeq !== activeSeq) return { ok: false, error: "META_SUPERSEDED" };
        await sleep(500);
      }
      if (busy) return { ok: false, error: "META_BUSY" };
    }
    busy = true;
    // Lượt cũ thấy seq mới (SW đã chuyển sang ask khác sau khi feed bỏ lượt
    // này) thì dừng ngay, không gõ/click vào composer của lượt mới.
    const superseded = () => mySeq !== undefined && mySeq !== activeSeq;
    try {
      // SW đã reset tab về chat mới trước mỗi câu nên vào là hỏi ngay.
      // (Không tự navigate ở đây: navigate giết context đang chạy.)
      const input = await waitComposer(30000);
      if (!input) {
        return { ok: false, error: looksLoggedOut() ? "META_NEED_LOGIN" : "META_NO_COMPOSER" };
      }
      // Build mới của meta.ai chỉ mount div contenteditable khi tab ĐƯỢC HIỂN
      // THỊ; tab worker nền chỉ còn textarea mirror 0x0 (gõ không ăn). Xin SW
      // bật tab vài giây cho React mount rồi trả lại tab user đang xem.
      if (!editorDiv()) {
        try { await chrome.runtime.sendMessage({ action: "metaFreeNeedVisible" }); } catch (_) {}
        const mountEnd = Date.now() + 10000;
        while (!editorDiv() && Date.now() < mountEnd) {
          if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
          await waitDomChange(400);
        }
        // KHÔNG trả focus ngay: tab phải còn hiển thị trong lúc gõ/bấm Gửi.
        // Background có alarm 8s tự trả focus nếu content script chết giữa chừng.
        if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
      }
      // 1) Dọn sạch bản nháp cũ (lượt fail trước có thể để lại chữ trong ô).
      for (let i = 0; i < 3; i++) {
        try {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          if (setter) setter.call(input, "");
          else input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const div = editorDiv();
          if (div) { div.focus(); document.execCommand("selectAll", false, null); document.execCommand("delete", false, null); }
        } catch (_) {}
        await sleep(400);
        if (!editorText().trim()) break;
      }
      if (editorText().trim()) return { ok: false, error: "META_CLEAR_FAIL" };
      if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
      // 2) Gõ prompt bằng trusted input qua SW (chrome.debugger): Lexical của
      // Meta chỉ nhận phím thật, synthetic input bị bỏ qua. Đặt caret vào ô
      // soạn thật trước để chữ rơi đúng chỗ.
      const target = composerTarget();
      if (!target) return { ok: false, error: "META_NO_COMPOSER" };
      try {
        target.el.focus();
        if (target.kind === "div") {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target.el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          const len = String(target.el.value || "").length;
          try { target.el.setSelectionRange(len, len); } catch (_) {}
        }
      } catch (_) {}
      let typeOk = false;
      try {
        // SW bận/treo thì sendMessage này treo theo — race 30s để không kẹt vĩnh viễn.
        const ins = await Promise.race([
          chrome.runtime.sendMessage({ action: "trustedInsertText", text: prompt }),
          sleep(30000).then(() => ({ ok: false, error: "TYPE_TIMEOUT" })),
        ]);
        typeOk = !!(ins && ins.ok);
        if (!typeOk && ins && ins.error) return { ok: false, error: "META_TYPE_FAIL", detail: String(ins.error).slice(0, 60) };
      } catch (_) { typeOk = false; }
      if (!typeOk) return { ok: false, error: "META_TYPE_FAIL", detail: `div=${!!editorDiv()} taLen=${editorText().length}` };
      let typed = false;
      // Vòng verify có trần giờ tường (tab nền bị dồn timer: 10 vòng × 500ms
      // danh nghĩa có thể thành 10 phút). Đọc DOM là đồng bộ nên chỉ chậm chứ
      // không sai — trần giờ giữ ask không vượt quá ngân sách SW.
      const typedEnd = Date.now() + 15000;
      for (let i = 0; i < 10 && Date.now() < typedEnd; i++) {
        if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
        if (editorText().includes(prompt.slice(0, 30))) { typed = true; break; }
        await waitDomChange(500);
      }
      if (!typed) return { ok: false, error: "META_TYPE_FAIL", detail: `typedLen=${editorText().length}` };
      // 3) Đợi nút Gửi sẵn sàng (tab mới cần hydration) rồi bấm.
      let btn = null;
      for (let i = 0; i < 20; i++) {
        btn = sendButton();
        if (btn && !btn.disabled) break;
        btn = null;
        await sleep(500);
      }
      if (!btn) return { ok: false, error: "META_NO_SEND" };
      const beforeCount = assistantMessages().length;
      const beforeUrl = location.href;
      if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
      btn.click();
      // Xác nhận đã gửi: URL sang /prompt/, có câu trả lời mới, hoặc ô trống lại.
      // Bấm không ăn (hydration) thì Enter 1 lần rồi mới kết luận. Vòng có trần
      // giờ tường để tab nền bị dồn timer không treo ask.
      let sent = false, enterTried = false;
      const sentEnd = Date.now() + 35000;
      let sentRounds = 0;
      while (!sent && Date.now() < sentEnd) {
        if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
        await waitDomChange(500);
        sentRounds++;
        if (assistantMessages().length > beforeCount || location.href !== beforeUrl) { sent = true; break; }
        if (!editorText().trim()) { sent = true; break; }
        if (sentRounds === 16 && !enterTried) {
          enterTried = true;
          try {
            const div = editorDiv() || input;
            div.focus();
            div.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            const b2 = sendButton();
            if (b2) b2.click();
          } catch (_) {}
        }
      }
      if (!sent) return { ok: false, error: "META_SEND_FAIL" };
      // Đợi streaming xong: nút Gửi sẵn sàng + câu cuối đứng yên đủ mili giây.
      // Ghi lại chẩn đoán (đã gửi? đã thấy chữ? nút còn báo đang chạy?) để log
      // ngoài phân biệt "Meta đứng im" với "Meta trả chậm".
      // Ổn định tính bằng THỜI GIAN, mỗi lần DOM đổi là một lần kiểm tra
      // (MutationObserver vẫn bắn trên tab nền bị dồn timer, còn đếm vòng
      // sleep thì không bao giờ đủ vòng trong 150s). Tab khỏe: ~3s là chốt,
      // đúng bằng hành vi cũ (3 vòng × 1s).
      // Lưới phụ: kể cả khi không đọc được nút (build Meta lạ), câu đứng yên
      // đủ lâu (gấp 3 lần) thì vẫn chốt — tránh mù nút mà treo cả run.
      const end = Date.now() + ASK_TIMEOUT_MS;
      let lastText = "", maxLen = 0, lastSending = "?", sawButton = false, lastChangeAt = 0;
      while (Date.now() < end) {
        if (superseded()) return { ok: false, error: "META_SUPERSEDED" };
        await waitDomChange(POLL_MS);
        const list = assistantMessages();
        const last = list[list.length - 1];
        const raw = last ? (last.innerText || "") : "";
        if (raw.trim().length > maxLen) maxLen = raw.trim().length;
        const btn = sendButton();
        if (btn) sawButton = true;
        const sending = (() => {
          if (!btn) return true;
          // Nút Gửi DISABLE khi ô trống = đã xong (idle), KHÔNG phải đang chạy.
          // Đang chạy = aria chuyển sang Dừng/Stop (nút dừng luôn bấm được).
          const label = String(btn.getAttribute("aria-label") || "");
          return /dừng|stop|đang (tạo|sinh|trả lời|viết)/i.test(label);
        })();
        lastSending = sending;
        if (raw.trim() && raw !== lastText) {
          lastText = raw;
          lastChangeAt = Date.now();
        }
        const quietMs = lastText ? Date.now() - lastChangeAt : -1;
        if (raw.trim() && !sending && quietMs >= STABLE_MS) {
          const text = stripThinking(raw);
          if (text) return { ok: true, text, chatId: chatIdFromUrl(location.href) };
        }
        // Lưới phụ khi mù nút: text đứng yên gấp 3 lần thì chốt.
        if (raw.trim() && !sawButton && quietMs >= STABLE_FALLBACK_MS) {
          const text = stripThinking(raw);
          if (text) return { ok: true, text, chatId: chatIdFromUrl(location.href), viaFallback: true };
        }
      }
      return { ok: false, error: "META_TIMEOUT", detail: `streaming maxLen=${maxLen} sending=${lastSending ? "yes" : "no"} sawButton=${sawButton ? "yes" : "no"}` };
    } finally {
      busy = false;
      // Trả focus sau khi đã nhận xong câu trả lời (hoặc lỗi). Không trả sớm
      // khi Meta còn stream: tab nền bị ẩn làm câu trả lời không render kịp
      // (bắt live 21/10: prompt gửi xong, answer chỉ hiện khi bật lại tab).
      try { await chrome.runtime.sendMessage({ action: "metaFreeRestoreFocus" }); } catch (_) {}
    }
  }

  // Parse chat uuid từ URL /prompt/<uuid> (để background track worker chats).
  function chatIdFromUrl(url) {
    const m = String(url || "").match(/\/prompt\/([0-9a-f-]{8,60})/i);
    return m ? m[1] : "";
  }

  // ===== DỌN CHAT WORKER =====
  // Chỉ xóa đúng uuid background yêu cầu (chat do worker tạo). Không bao giờ
  // xóa theo tiêu đề/text để khỏi đụng chat của user. Proof: link biến mất.
  function sidebarLink(chatId) {
    return document.querySelector(`a[href="/prompt/${chatId}"]`);
  }
  function menuDeleteItem() {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    return items.find((el) => /^(xóa|delete)$/i.test((el.innerText || "").trim())) || null;
  }
  function confirmDeleteButton() {
    for (const dlg of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const btns = Array.from(dlg.querySelectorAll("button"));
      const hit = btns.find((b) => /^(xóa|delete|xác nhận|confirm)$/i.test((b.innerText || "").trim()));
      if (hit) return hit;
    }
    return null;
  }
  async function trustedClickAt(el) {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    if (!(x > 0 && y > 0)) return false;
    try {
      const res = await chrome.runtime.sendMessage({ action: "trustedMouse", kind: "click", x, y });
      return !!(res && res.ok);
    } catch (_) { return false; }
  }
  function domClick(el) {
    try { el.click(); return true; } catch (_) { return false; }
  }
  async function waitFor(fn, timeoutMs, stepMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(stepMs || 500);
    }
    return null;
  }
  async function deleteOneChat(chatId) {
    const link = sidebarLink(chatId);
    // Không thấy link = đã mất (xóa rồi hoặc chưa persist) → coi như xong.
    if (!link) return true;
    try { link.scrollIntoView({ block: "nearest" }); } catch (_) {}
    await sleep(400);
    const li = link.closest("li");
    const scope = li || link.parentElement;
    const moreBtn = scope ? scope.querySelector('button[aria-label="Lựa chọn khác"]') : null;
    if (!moreBtn) return false;
    // Menu Meta chỉ mở bằng click chuột thật (DOM click không ăn).
    if (!(await trustedClickAt(moreBtn))) return false;
    const delItem = await waitFor(menuDeleteItem, 6000);
    if (!delItem) { try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (_) {} return false; }
    if (!domClick(delItem) && !(await trustedClickAt(delItem))) return false;
    const confirmBtn = await waitFor(confirmDeleteButton, 6000);
    if (!confirmBtn) return false;
    if (!domClick(confirmBtn) && !(await trustedClickAt(confirmBtn))) return false;
    // Proof: link biến mất khỏi sidebar trong 10s.
    const gone = await waitFor(() => !sidebarLink(chatId), 10000);
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch (_) {}
    return !!gone;
  }
  async function cleanChats(chatIds) {
    const deleted = [], failed = [];
    for (const id of chatIds || []) {
      const chatId = String(id || "").trim();
      if (!chatId) continue;
      try {
        if (await deleteOneChat(chatId)) deleted.push(chatId);
        else failed.push(chatId);
      } catch (_) { failed.push(chatId); }
      await sleep(800);
    }
    return { ok: failed.length === 0, deleted, failed };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || (msg.action !== "metaFreeAsk" && msg.action !== "metaFreeClean")) return undefined;
    if (msg.action === "metaFreeClean") {
      (async () => {
        try { sendResponse({ ...(await cleanChats(msg.chatIds)), action: "metaFreeClean" }); }
        catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e || "META_CLEAN_ERROR").slice(0, 200) }); }
      })();
      return true;
    }
    const mySeq = ++activeSeq;
    (async () => {
      try {
        const prompt = String(msg.prompt || "").slice(0, 6000);
        if (!prompt.trim()) { sendResponse({ ok: false, error: "META_EMPTY_PROMPT" }); return; }
        sendResponse(await askOnce(prompt, mySeq));
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e || "META_ERROR").slice(0, 200) });
      }
    })();
    return true;
  });
})();
