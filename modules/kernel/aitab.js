/* Auto vjp — kernel aitab: AI caption qua tab web ChatGPT/Gemini đã đăng nhập (kiểu MUT, không API key).
 * Port logic từ MUT ai-bridge-service.requestAiCaptionFromTab, bỏ phần Meta-AI-task/server.
 * Content script cầu nối: modules/aitab/ai-bridge.js (port nguyên khối từ MUT tools/ai-bridge.js),
 * được inject bằng scripting (fork không khai content-script tĩnh cho chatgpt/gemini).
 * Nhận diện provider: storage key `mut_ai_caption_provider` ('chatgpt'|'gemini', mặc định gemini) — giữ tên key của MUT.
 */
(() => {
  globalThis.AVJP = globalThis.AVJP || {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function generateCaption(prompt, requestedProvider) {
    const settings = await chrome.storage.local.get(['mut_ai_caption_provider']);
    const provider = requestedProvider === 'chatgpt' || requestedProvider === 'gemini'
      ? requestedProvider
      : (settings.mut_ai_caption_provider === 'chatgpt' ? 'chatgpt' : 'gemini');
    const tab = await chrome.tabs.create({
      url: provider === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/',
      active: false
    });
    if (!tab?.id) throw new Error('Không thể mở tab AI.');
    const tabId = tab.id;
    let injected = false;
    const deadline = Date.now() + 85000;
    let lastError = 'Trang AI chưa sẵn sàng';
    try {
      while (Date.now() < deadline) {
        try {
          const current = await chrome.tabs.get(tabId);
          if (current.status !== 'complete') { await sleep(1200); continue; }
          const response = await Promise.race([
            chrome.tabs.sendMessage(tabId, { action: 'generate_ai_caption', provider, prompt }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('AI tab timeout 70s')), 70000))
          ]);
          if (response?.success && response.caption) {
            chrome.tabs.remove(tabId).catch(() => {});
            return String(response.caption).trim();
          }
          lastError = response?.error || 'AI không trả caption';
          break;
        } catch (err) {
          lastError = err?.message || String(err);
          if (!injected) {
            injected = true;
            await chrome.scripting.executeScript({ target: { tabId }, files: ['modules/aitab/ai-bridge.js'] }).catch(() => {});
          }
          await sleep(1500);
        }
      }
      throw new Error(lastError);
    } catch (err) {
      chrome.tabs.remove(tabId).catch(() => {});
      throw err;
    }
  }

  globalThis.AVJP.aitab = { generateCaption };
})();
