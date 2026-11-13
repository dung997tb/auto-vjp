// MUT VN - AI Bridge (ChatGPT & Gemini)

if (!globalThis.__mutAiCaptionBridgeInstalled) chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generate_ai_caption') {
    console.log('[MUT AI] Nhận yêu cầu tạo caption', {
      provider: window.location.hostname,
      promptLength: request.prompt?.length || 0
    });
    handleGenerateCaption(request.prompt)
      .then(caption => {
        console.log('[MUT AI] Đã nhận caption', { captionLength: caption.length });
        sendResponse({ success: true, caption });
      })
      .catch(err => {
        console.error('[MUT AI] Tạo caption thất bại:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep the message channel open for async response
  }
});
globalThis.__mutAiCaptionBridgeInstalled = true;

async function handleGenerateCaption(promptText) {
  const isChatGPT = window.location.hostname.includes('chatgpt.com');
  const isGemini = window.location.hostname.includes('gemini.google.com');

  if (isChatGPT) {
    return await handleChatGPT(promptText);
  } else if (isGemini) {
    return await handleGemini(promptText);
  } else {
    throw new Error('Không nhận diện được AI Platform (chỉ hỗ trợ chatgpt.com và gemini.google.com)');
  }
}

async function handleChatGPT(promptText) {
  const editor = await waitForVisibleElement([
    '#prompt-textarea',
    'div[contenteditable="true"][data-virtualkeyboard]',
    'div[contenteditable="true"]'
  ], 15000);
  if (!editor) {
    const isLogin = document.body.innerText.includes('Sign in') || document.body.innerText.includes('Log in') || window.location.href.includes('auth') || window.location.href.includes('login');
    if (isLogin) {
      throw new Error('Bạn chưa đăng nhập ChatGPT. Hãy mở một tab mới, đăng nhập vào ChatGPT rồi thử lại.');
    }
    throw new Error('Không tìm thấy khung nhập liệu của ChatGPT. Hãy đăng nhập và kiểm tra lại.');
  }
  const previousResponses = document.querySelectorAll('[data-message-author-role="assistant"]').length;
  console.log('[MUT AI] Đã tìm thấy ô nhập ChatGPT');
  setEditorText(editor, promptText);

  let sendBtn = null;
  const startWait = Date.now();
  while (Date.now() - startWait < 3000) {
    sendBtn = document.querySelector('[data-testid="send-button"]');
    if (sendBtn && !sendBtn.disabled) break;
    await sleep(200);
  }

  if (!sendBtn || sendBtn.disabled) throw new Error('Nút gửi ChatGPT không sẵn sàng');
  
  sendBtn.click();
  console.log('[MUT AI] Đã gửi prompt tới ChatGPT');

  const response = await waitForNewStableResponse(
    () => Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).slice(previousResponses),
    120000
  );
  if (!response) throw new Error('Quá thời gian chờ ChatGPT trả lời');
  return response;
}

async function handleGemini(promptText) {
  const editor = await waitForVisibleElement([
    'rich-textarea div[contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[aria-label*="prompt" i]',
    'textarea'
  ], 15000);
  if (!editor) {
    const isLogin = document.body.innerText.includes('Sign in') || document.body.innerText.includes('Đăng nhập') || window.location.href.includes('accounts.google.com') || window.location.href.includes('login');
    if (isLogin) {
      throw new Error('Bạn chưa đăng nhập Gemini. Hãy mở một tab mới, đăng nhập vào tài khoản Google Gemini rồi thử lại.');
    }
    throw new Error('Không tìm thấy khung nhập liệu của Gemini. Hãy đăng nhập và kiểm tra lại.');
  }
  const responseSelector = 'message-content, model-response, [data-test-id="model-response"], .model-response-text';
  const previousResponses = document.querySelectorAll(responseSelector).length;
  console.log('[MUT AI] Đã tìm thấy ô nhập Gemini');
  setEditorText(editor, promptText);

  await sleep(500);

  // Thử nhiều selector cho nút Gửi
  const sendBtn = await waitForVisibleElement([
    'button[data-test-id="send-button"]',
    'button[aria-label*="Send prompt" i]',
    'button[aria-label*="Gửi tin nhắn" i]',
    'button[aria-label*="Gửi" i]',
    'button[aria-label*="Send" i]',
    '.send-button',
    'button[mattooltip*="Send" i]'
  ], 6000);
  if (sendBtn && !sendBtn.disabled) {
    sendBtn.click();
  } else {
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  console.log('[MUT AI] Đã gửi prompt tới Gemini');

  const response = await waitForNewStableResponse(
    () => Array.from(document.querySelectorAll(responseSelector)).slice(previousResponses),
    65000
  );
  if (!response) throw new Error('Quá thời gian chờ Gemini trả lời');
  return response;
}

async function waitForVisibleElement(selectors, timeout = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      const visible = elements.find(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      if (visible) return visible;
    }
    await sleep(300);
  }
  return null;
}

function setEditorText(editor, text) {
  editor.focus();
  if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
    const prototype = editor.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(editor, text);
    else editor.value = text;
    // Dispatch standard input and change events to update React state
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('insertText', false, text)) {
      editor.replaceChildren(document.createTextNode(text));
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function waitForNewStableResponse(getNewElements, timeout) {
  const startedAt = Date.now();
  let lastText = '';
  let stableSince = 0;

  const isChatGPT = window.location.hostname.includes('chatgpt.com');
  const isGemini = window.location.hostname.includes('gemini.google.com');

  while (Date.now() - startedAt < timeout) {
    const elements = getNewElements();
    let text = '';
    if (elements.length) {
      const el = elements[elements.length - 1];
      const contentEl = el.querySelector('.markdown, .prose') || el;
      text = (contentEl.innerText || '').trim();
      // Chỉ bỏ nhãn nút "Edit" ở một dòng riêng, không xóa caption thật bắt đầu bằng từ "Edit".
      text = text.replace(/^(?:Edit[\t ]*(?:\r?\n|$))+/i, '');
      
      // Tự động cuộn xuống cuối câu trả lời để hiển thị cho người dùng và cập nhật DOM
      try {
        el.scrollIntoView({ behavior: 'auto', block: 'end' });
      } catch (e) { console.debug("[Auto vjp][ai-bridge] bỏ qua lỗi:", e); }
    }

    // Kiểm tra các tín hiệu đang sinh nội dung trong DOM để tránh lấy nội dung quá sớm
    let isStillGenerating = false;

    if (isChatGPT) {
      const hasStreamingClass = document.querySelector('.result-streaming') !== null;
      const hasStopBtn = document.querySelector('button[data-testid="stop-button"]') !== null ||
                          document.querySelector('button[aria-label*="Stop" i]') !== null;

      let hasActionButtons = false;
      if (elements.length) {
        const el = elements[elements.length - 1];
        hasActionButtons = el.querySelector('button[aria-label*="Copy" i]') !== null ||
                           el.querySelector('button[aria-label*="Sao chép" i]') !== null ||
                           el.querySelector('button[aria-label*="Share" i]') !== null ||
                           el.querySelector('button[aria-label*="Good" i]') !== null ||
                           el.querySelector('button[aria-label*="Like" i]') !== null;
      }

      if ((hasStreamingClass || hasStopBtn) && !hasActionButtons) {
        isStillGenerating = true;
      }
    } else if (isGemini) {
      const hasLoadingIndicator = document.querySelector('mat-progress-bar') !== null ||
                                  document.querySelector('.model-response-loading') !== null ||
                                  document.querySelector('.model-response-text-loading') !== null;

      let hasActionButtons = false;
      if (elements.length) {
        const el = elements[elements.length - 1];
        hasActionButtons = el.querySelector('button[aria-label*="Share" i]') !== null ||
                           el.querySelector('button[aria-label*="Chia sẻ" i]') !== null ||
                           el.querySelector('button[aria-label*="Like" i]') !== null ||
                           el.querySelector('button[aria-label*="Thích" i]') !== null;
      }

      if (hasLoadingIndicator && !hasActionButtons) {
        isStillGenerating = true;
      }
    }

    if (isStillGenerating) {
      // Nếu AI vẫn đang gõ/suy nghĩ, reset bộ đếm thời gian ổn định
      stableSince = 0;
      lastText = text;
    } else if (text && text === lastText) {
      if (!stableSince) stableSince = Date.now();
      // Tăng thời gian kiểm tra văn bản không đổi lên 5.0 giây để an toàn cho bài dài
      if (Date.now() - stableSince >= 5000) return text;
    } else {
      lastText = text;
      stableSince = text ? Date.now() : 0;
    }
    await sleep(400);
  }
  return lastText;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(document.querySelector(selector));
    
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        resolve(document.querySelector(selector));
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function waitForElementToDisappear(selector, timeout = 30000) {
  return new Promise((resolve) => {
    if (!document.querySelector(selector)) return resolve(true);
    
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) {
        resolve(true);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
