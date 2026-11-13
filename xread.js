// xread.js — đọc bài từ tab X đang mở (nguồn phụ cho Đăng tường tin tức).
// Chỉ match x.com, không đụng Facebook DOM/state. Thất bại thì báo rõ để
// luồng dùng RSS thay thế — X đổi giao diện liên tục nên không kỳ vọng 100%.
(() => {
  const clean = v => String(v || "").replace(/\s+/g, " ").trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const authorOf = href => {
    const m = String(href || "").match(/\/([A-Za-z0-9_]{1,15})\/status\//);
    return m ? m[1] : "";
  };
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "xReadPosts") {
      (async () => {
        try {
          const n = Math.max(1, Math.min(100000, parseInt(message.count) || 10));
          const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
          const out = [];
          const seen = new Set();
          for (const a of arts) {
            const t = clean(a.innerText || a.textContent);
            if (t.length < 30 || seen.has(t.slice(0, 80))) continue;
            seen.add(t.slice(0, 80));
            let link = "";
            try {
              const al = [...a.querySelectorAll('a[href*="/status/"]')][0];
              if (al) link = al.href;
            } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
            let time = "";
            try { time = a.querySelector("time")?.getAttribute("datetime") || ""; } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
            out.push({ text: t.slice(0, 900), link, author: authorOf(link), time });
            if (out.length >= n) break;
          }
          sendResponse({ ok: true, posts: out });
        } catch (e) { sendResponse({ ok: false, error: String(e?.message || e).slice(0, 120) }); }
      })();
      return true;
    }
    // Chụp màn hình 1 bài X theo URL: tìm đúng article, cuộn vào giữa khung
    // hình rồi trả tọa độ để background clip-capture qua debugger.
    if (message.action === "xShotPost") {
      (async () => {
        try {
          const want = String(message.url || "");
          const m = want.match(/\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
          const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
          let hit = null;
          if (m) {
            const key = `${m[1].toLowerCase()}/status/${m[2]}`;
            hit = arts.find(a => [...a.querySelectorAll('a[href*="/status/"]')].some(al => String(al.href || "").toLowerCase().includes(key))) || null;
          }
          if (!hit) hit = arts[0] || null;
          if (!hit) { sendResponse({ ok: false, error: "no-article" }); return; }
          // Video live (duration vô cực) không render frame ở tab nền — trả
          // poster để background tải ảnh tĩnh thay vì chụp màn hình trắng.
          try {
            const lv = hit.querySelector("video");
            if (lv && !isFinite(lv.duration) && lv.poster) {
              const am = String(message.url || "").match(/\/([A-Za-z0-9_]{1,15})\/status\//);
              sendResponse({ ok: true, live: true, poster: lv.poster, author: am ? am[1] : "" });
              return;
            }
          } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
          try { hit.scrollIntoView({ block: "center" }); } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
          // Chờ ảnh/avatar/media trong bài tải xong mới đo khung (chụp sớm
          // là ảnh mờ — bắt live: avatar chưa hiện đã chụp; media video còn
          // spinner sau 9s). Hết budget mà media vẫn loading thì báo lỗi để
          // luồng đăng chữ thay vì đính ảnh spinner.
          const mediaBusy = () => {
            try {
              if ([...hit.querySelectorAll("img")].some(im => !im.complete || (im.naturalWidth || 0) === 0)) return true;
              if ([...hit.querySelectorAll("video")].some(v => (v.readyState || 0) < 2 && !v.poster)) return true;
              if (hit.querySelector('[role="progressbar"],[aria-label*="Loading" i],[aria-label*="Đang tải" i]')) return true;
            } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
            return false;
          };
          try {
            const end = Date.now() + 12000;
            while (Date.now() < end && mediaBusy()) await sleep(400);
            // Avatar X đôi khi là background-image (thẻ img không thấy) —
            // preload riêng mọi URL ảnh trong bài, tối đa ~6s nữa.
            try {
              const urls = new Set();
              for (const im of hit.querySelectorAll("img")) {
                const s = im.currentSrc || im.src || "";
                if (/^https?:\/\//i.test(s)) urls.add(s);
              }
              const walker = document.createTreeWalker(hit, NodeFilter.SHOW_ELEMENT);
              let el = null, guarded = 0;
              while ((el = walker.nextNode()) && guarded++ < 400) {
                try {
                  const m = String(getComputedStyle(el).backgroundImage || "").match(/url\(["']?(https:[^"')]+)["']?\)/);
                  if (m) urls.add(m[1]);
                } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
              }
              await Promise.all([...urls].slice(0, 30).map(u => new Promise(res => {
                const im = new Image();
                const to = setTimeout(() => res(false), 6000);
                im.onload = () => { clearTimeout(to); res(true); };
                im.onerror = () => { clearTimeout(to); res(false); };
                im.src = u;
              })));
            } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
            try { await Promise.race([document.fonts.ready, sleep(1500)]); } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
            await sleep(400);
          } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
          if (mediaBusy()) { sendResponse({ ok: false, error: "media-loading" }); return; }
          // Video X hiện spinner khi chưa phát (kể cả đã tải xong data) —
          // bấm phát (tắt tiếng để qua autoplay-policy) rồi chụp frame.
          // Không phát được thì báo lỗi để đăng chữ thay vì đính ảnh spinner.
          try {
            const player = hit.querySelector('[data-testid="videoPlayer"]');
            const vid = hit.querySelector("video");
            if (player && vid && (vid.readyState || 0) >= 1) {
              try { vid.muted = true; } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
              const url0 = location.href;
              const pb = [...player.querySelectorAll('[role="button"],button')].find(b => /play|phát/i.test(`${b.getAttribute?.("aria-label") || ""} ${b.innerText || ""}`));
              try { (pb || vid).click(); } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
              let playing = false;
              for (let w = 0; w < 10 && !playing; w++) {
                await sleep(600);
                if (location.href !== url0 || !hit.isConnected) { sendResponse({ ok: false, error: "navigated" }); return; }
                try { playing = !vid.paused && vid.currentTime > 0; } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
              }
              if (!playing) { sendResponse({ ok: false, error: "video-not-playing" }); return; }
              // Đợi frame hình render thật (vừa phát vẫn có thể trắng vài giây).
              try {
                let ticks = 0;
                const t0 = vid.currentTime;
                const end2 = Date.now() + 6000;
                while (Date.now() < end2 && ticks < 2) {
                  await sleep(500);
                  try { if (vid.currentTime > t0 + 0.2) ticks++; } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
                }
                await sleep(1200);
              } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
            }
          } catch (_) { console.debug("[Auto vjp][xread] bỏ qua lỗi:", _); }
          const r = hit.getBoundingClientRect();
          const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
          const x = Math.max(0, Math.round(r.left)), y = Math.max(0, Math.round(r.top));
          const w = Math.min(Math.round(r.width), vw - x), h = Math.min(Math.round(r.height), vh - y);
          if (!hit.isConnected || w < 50 || h < 50) { sendResponse({ ok: false, error: "bad-rect" }); return; }
          sendResponse({ ok: true, rect: { x, y, width: w, height: h } });
        } catch (e) { sendResponse({ ok: false, error: String(e?.message || e).slice(0, 120) }); }
      })();
      return true;
    }
    return false;
  });
})();
