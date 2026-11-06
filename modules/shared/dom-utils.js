/**
 * DOM Utils - Reusable helpers for Content Scripts
 * Auto Post MUT Extension
 * Universal Script format (safe for regular Content Script injection and CommonJS/Node)
 */

(function (root, factory) {
  const api = factory();
  if (typeof root !== 'undefined') {
    root.DOMUtils = api;
    root.__MUT_DOM_UTILS = api;
  }
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  const DOMUtils = {
    /**
     * Chờ một khoảng thời gian (ms)
     */
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Tạo độ trễ ngẫu nhiên trong khoảng [min, max]
     */
    async randomDelay(min = 1000, max = 3000) {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      await this.sleep(delay);
      return delay;
    },

    /**
     * Kiểm tra phần tử có hiển thị và kết nối trong DOM hay không
     */
    isVisible(element) {
      if (!element || !element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : {};
      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden';
    },

    /**
     * Chờ một phần tử xuất hiện trong DOM
     */
    waitForElement(selector, timeout = 10000, root = typeof document !== 'undefined' ? document : null) {
      return new Promise((resolve, reject) => {
        if (!root) return reject(new Error('Document root not available'));
        const element = root.querySelector(selector);
        if (element) return resolve(element);

        const observer = new MutationObserver(() => {
          const el = root.querySelector(selector);
          if (el) {
            observer.disconnect();
            resolve(el);
          }
        });

        observer.observe(root === document ? document.body : root, {
          childList: true,
          subtree: true
        });

        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`Timeout waiting for element: ${selector}`));
        }, timeout);
      });
    },

    /**
     * Giả lập gõ phím người dùng vào thẻ input/textarea/contenteditable
     */
    async simulateTyping(element, text, minDelay = 20, maxDelay = 60) {
      element.focus();
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const keyEventInit = { key: char, char: char, keyCode: char.charCodeAt(0), which: char.charCodeAt(0), bubbles: true, cancelable: true };
        
        element.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
        element.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));
        
        if (element.isContentEditable) {
          document.execCommand('insertText', false, char);
        } else if ('value' in element) {
          element.value += char;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        element.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
        await this.randomDelay(minDelay, maxDelay);
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },

    /**
     * Giả lập click chuột của người thật
     */
    async humanClick(element) {
      if (!element) return false;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.sleep(200);

      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2 + (Math.random() * 6 - 3);
      const y = rect.top + rect.height / 2 + (Math.random() * 6 - 3);

      const mouseEvents = ['mousedown', 'mouseup', 'click'];
      for (const evt of mouseEvents) {
        element.dispatchEvent(new MouseEvent(evt, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y
        }));
        await this.sleep(50);
      }
      return true;
    },

    /**
     * Cuộn trang mượt mà
     */
    async smoothScroll(distance = 500, steps = 10) {
      const stepDist = distance / steps;
      for (let i = 0; i < steps; i++) {
        window.scrollBy({ top: stepDist, behavior: 'smooth' });
        await this.sleep(100);
      }
    }
  };

  return DOMUtils;
});
