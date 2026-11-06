// web-image.js — capture article image on vnexpress.net for group posting
(() => {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "webCaptureImage") {
      (async () => {
        try {
          const url = String(msg.url || "");
          if (!url) { sendResponse({ok:false, error:"no url"}); return; }
          // Find the first large image in the article
          const imgs = [...document.querySelectorAll('article img, .fig-picture img, .thumb-art img')].filter(img => {
            try {
              const r = img.getBoundingClientRect();
              return r.width >= 200 && r.height >= 200 && img.complete && img.naturalWidth >= 200;
            } catch(_) { return false; }
          });
          let target = imgs[0];
          if (!target) {
            // Fallback: any img with src matching the requested url
            target = [...document.querySelectorAll('img')].find(img => (img.src||"").includes(url.slice(-30)) || img.src === url);
          }
          if (!target) { sendResponse({ok:false, error:"no img found"}); return; }
          // Ensure image is loaded
          if (!target.complete) {
            await new Promise(res => { target.onload = res; target.onerror = res; setTimeout(res, 5000); });
          }
          const w = target.naturalWidth || 0, h = target.naturalHeight || 0;
          if (!w || !h || w < 200) { sendResponse({ok:false, error:"too small"}); return; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { sendResponse({ok:false, error:"no ctx"}); return; }
          ctx.drawImage(target, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          sendResponse({ok:true, dataUrl});
        } catch (e) { sendResponse({ok:false, error:String(e.message||e).slice(0,100)}); }
      })();
      return true;
    }
  });
})();
