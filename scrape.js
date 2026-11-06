// scrape.js - Cào bài viết profile/page -> xuất md/json/txt
(() => {
  let isScraping = false;
  let collected = [];
  let seen = new Set();
  let targetCount = 20;
  let idleCount = 0;
  let skipSponsored = true;
  let runSerial = 0;
  let scrapeCaptureMedia = true;
  let scrapeWithComments = true;
  let scrapeMaxComments = 20;
  let videoPool = [];
  let mediaCapturing = false;

  function sourceKey(url=location.href){
    try{
      const u=new URL(url,location.href),host=String(u.hostname||"").toLowerCase().replace(/\.$/,"");
      // Facebook thường đổi m./www./web. sang hostname khác sau điều hướng.
      // Chỉ chuẩn hoá các hostname Facebook đã tin cậy; path vẫn là định danh
      // bắt buộc để không dùng dữ liệu của một nguồn khác.
      const canonicalHost=host==="facebook.com"||host.endsWith(".facebook.com")?"facebook.com":host;
      const origin=canonicalHost==="facebook.com"?"https://facebook.com":`${u.protocol.toLowerCase()}//${u.host.toLowerCase()}`;
      return `${origin}${u.pathname}`.replace(/\/$/g,"").toLowerCase();
    }catch{return String(url||"").split(/[?#]/)[0].replace(/\/$/g,"").toLowerCase();}
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function taskKeyOfUrls(urls){
    return (Array.isArray(urls)?urls:[]).map(u=>String(u||"").split(/[?#]/)[0].toLowerCase()).sort().join("|");
  }

  // Cuộn bằng wheel "thật" qua chrome.debugger (trustedMouse) vì `window.scrollTo`
  // KHÔNG kích hoạt lazy-load của Facebook (đã xác nhận trên timeline profile mới).
  // Fallback về window.scrollBy nếu debugger không gắn được.
  async function trustedScrollStep(deltaY){
    try{
      const x = Math.round((window.innerWidth || 800) / 2);
      const y = Math.round((window.innerHeight || 900) * 0.6);
      const r = await chrome.runtime.sendMessage({ action:"trustedMouse", kind:"wheel", x, y, deltaX:0, deltaY:Math.round(deltaY) });
      if (r && r.ok) return true;
    }catch(_){}
    try{ window.scrollBy(0, Math.round(deltaY)); }catch(_){}
    return false;
  }

  // Popup ghi cờ dừng trực tiếp vào storage để Stop vẫn có hiệu lực khi
  // message tới content script bị lỡ. Mọi nhịp chờ của scraper phải đọc cờ
  // này, đồng thời khoá đúng nguồn đang cào để không tiếp tục ở route khác.
  async function scrapeRunActive(runId){
    if(!isScraping||runId!==runSerial)return false;
    try{
      const state=await chrome.storage.local.get(["isScraping","scrapeRunSourceUrl"]);
      const sameSource=!state.scrapeRunSourceUrl||sourceKey(state.scrapeRunSourceUrl)===sourceKey(location.href);
      if(!state.isScraping||!sameSource){isScraping=false;return false;}
      return true;
    }catch{return false;}
  }

  async function scrapeSleep(ms,runId){
    const end=Date.now()+Math.max(0,ms);
    while(Date.now()<end){
      if(!await scrapeRunActive(runId))return false;
      await sleep(Math.min(500,end-Date.now()));
    }
    return scrapeRunActive(runId);
  }

  function expandSeeMore() {
    let clicked = 0;
    // FB dung div[role=button] chua text Xem them / See more
    document.querySelectorAll('div[role="button"]').forEach(btn => {
      const t = (btn.innerText || "").trim();
      if (t === "Xem thêm" || t === "See more" || t === "Xem Thêm" || t === "See More") {
        try { btn.click(); clicked++; } catch {}
      }
    });
    // mot so truong hop la span
    document.querySelectorAll('span').forEach(s => {
      const t = (s.innerText || "").trim();
      if (t === "Xem thêm" || t === "See more") {
        const btn = s.closest('div[role="button"]');
        if (btn) { try { btn.click(); clicked++; } catch {} }
        else if (s.parentElement && s.parentElement.getAttribute("role")==="button") { try { s.parentElement.click(); clicked++; } catch {} }
      }
    });
    return clicked;
  }

  function isSponsoredArticle(el) {
    if(!el) return false;
    // LƯU Ý: `[data-ad-comet-preview]`/`[data-ad-preview]` giờ là marker của MỌI bài
    // viết (phần text), không phải dấu hiệu quảng cáo — không dùng để loại nữa.
    if(el.querySelector('a[href*="/ads/about"],a[href*="facebook.com/ads/about"],a[href*="/ads/library"],a[href*="/ads/library"],a[href*="ads_library"]')) return true;
    if(el.querySelector('[aria-label="Được tài trợ" i],[aria-label="Sponsored" i],[aria-label="Quảng cáo" i]')) return true;
    return [...el.querySelectorAll('h2,h3,h4,h5,[role="heading"],span[dir="auto"]')]
      .some(node=>/^(?:được tài trợ|sponsored|quảng cáo|advertisement|ad)$/i.test((node.innerText||node.textContent||'').trim()));
  }

  // Comment trên Facebook thường cũng dùng role="article" nhưng nằm lồng
  // trong article của bài chính. Chỉ nhận article ngoài cùng làm bài viết.
  function isCommentCandidate(el) {
    if(!el) return true;
    if(el.closest('ul[role="list"], [aria-label*="Bình luận" i], [aria-label*="Comment" i], [data-pagelet*="Comment" i]')) return true;
    // Article lồng nhau CHƯA CHẮC là comment: card bài thật trong feed/group
    // cũng nằm lồng trong feed-unit wrapper. Giữ lại nếu có chữ ký bài viết
    // (story_message + link bài); dedup theo id loai trùng lặp sau này.
    if (el.matches && el.matches('div[role="article"]')) {
      const hasMsg = el.querySelector('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]');
      const hasPostLink = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/photos/"]');
      if (hasMsg && hasPostLink) return false;
    }
    if(el.matches('div[role="article"]') && el.parentElement?.closest('div[role="article"]')) return true;
    if(!el.matches('div[role="article"]') && el.closest('div[role="article"]')) return true;
    const rawText=(el.innerText||"").replace(/\s+/g," ").trim().slice(0,1400);
    // Các cửa sổ Messenger cũng dùng role="article" nhưng có chuỗi đặc trưng
    // của tin nhắn/ô nhập; không được đưa vào dữ liệu bài viết.
    if(/(?:Nhập,?\s*Tin nhắn do|Tin nhắn do|đã gửi\s+\d+\s+ảnh|Hình ảnh trong tin nhắn|Mở đoạn chat|Đóng đoạn chat|type\s+(?:a\s+)?message|message\s+(?:sent|by)|images?\s+in\s+(?:a\s+)?message|open\s+chat|close\s+chat)/i.test(rawText)) return true;
    const head=(el.querySelector('h2,h3,h4,[role="heading"]')?.innerText||'').trim();
    return /^(trả lời|reply)\b/i.test(head);
  }

  // Phân loại "bài nền màu": chỉ nhận màu đặc (hex/rgb/hsl), loại gradient/label
  // minh hoạ để không nhầm bài thường thành bài nền màu.
  function postBackgroundColor(el){
    if(!el) return "";
    const nodes=el.querySelectorAll('div[style*="background-color"], div[style*="background"]');
    for(const n of nodes){
      const style=String(n.getAttribute("style")||"").toLowerCase();
      const m=style.match(/background-color\s*:\s*([^;"']+)/)||style.match(/background\s*:\s*([^;"']+)/);
      if(!m) continue;
      const v=m[1].trim();
      if(/linear-gradient|radial-gradient/i.test(v)) continue;
      if(/^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i.test(v)) return v;
    }
    return "";
  }

  function videoDurationText(el){
    if(!el) return "";
    for(const s of el.querySelectorAll('span,div')){
      const t=(s.innerText||"").trim();
      if(t.length<=8&&/^\d{1,3}:\d{2}(?::\d{2})?$/.test(t))return t;
    }
    // Player mới để thời lượng trong aria-label (VD nút play "1:23").
    for(const n of el.querySelectorAll('[aria-label]')){
      const label=String(n.getAttribute("aria-label")||"");
      const m=label.match(/(\d{1,3}:\d{2}(?::\d{2})?)/);
      if(m&&m[1].length<=8)return m[1];
    }
    return "";
  }

  // Hash gọn cho id fallback (ổn định hơn slice text thô 120 ký tự).
  function textHash(s){
    const str=String(s||"").replace(/\s+/g," ").trim().slice(0,200);
    let h=0;
    for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))|0;
    return "tx_"+(Math.abs(h)>>>0).toString(36);
  }

  // Từ chối card không phải bài viết (panel gợi ý kết bạn, header profile...)
  // khi root không có link/video/ảnh: tránh rác lọt vào dataset học văn phong.
  function isNonPostCard(el, link, hasVideo, hasPhoto){
    if(!el||link||hasVideo||hasPhoto)return false;
    const txt=String(el.innerText||"");
    const addCount=(txt.match(/Thêm bạn bè|Add Friend/g)||[]).length;
    if(addCount>=2)return true;
    if(/Những người bạn có thể biết|People You May Know|Gợi ý kết bạn/i.test(txt))return true;
    if(/người theo dõi/i.test(txt)&&/Nhắn tin|\bMessage\b/i.test(txt)&&addCount>=1)return true;
    return false;
  }

  // Facebook đổi DOM timeline: bài viết thật không còn `role="article"` (chỉ
  // comment/khung xương giữ), thay vào đó phần text bài nằm trong node
  // `[data-ad-rendering-role="story_message"]`. Trèo lên ancestor nhỏ nhất chỉ
  // chứa ĐÚNG 1 node đó để có root của bài (kèm tác giả, permalink, ảnh/video).
  // KHÔNG dùng `a[href*="/posts/"]` làm điều kiện dừng vì trong root 1 bài vẫn có
  // thể có nhiều link /posts/ (permalink + link ảnh/video), gây cắt nhầm trước header.
  function postRootFor(messageEl, sel){
    const SEL = sel || '[data-ad-rendering-role="story_message"]';
    let cur = messageEl;
    while (cur.parentElement) {
      const p = cur.parentElement;
      const tag = p.tagName;
      const role = p.getAttribute && p.getAttribute("role");
      if (tag === "BODY" || tag === "HTML" || role === "feed" || role === "main" || p.id === "content") break;
      if (p.querySelectorAll(SEL).length > 1) break;
      cur = p;
    }
    return cur;
  }

  // Tên tác giả thường nằm trong link profile có text là tên (VD
  // `a[href*="__cft__"]`, `a[href*="comment_id="]`) trên timeline mới.
  const AUTHOR_ALT_BLOCK = /(?:có thể là (?:hình ảnh|ảnh)|may be (?:an? )?(?:image|photo)|no photo description|không có mô tả ảnh|image|photo|ảnh|hình ảnh)/i;
  function authorFromNameLink(el){
    if(!el) return "";
    const links = [...el.querySelectorAll('a[href]')];
    for (const a of links) {
      const href = String(a.getAttribute("href") || "");
      if (!/__cft__|comment_id=|refid|hc_ref=|fref=/i.test(href)) continue;
      // Link ảnh thường bọc `<img alt="...">`; innerText lúc đó trả alt của ảnh.
      if (a.querySelector('img, svg')) continue;
      const t = (a.innerText || "").trim();
      if (t && t.length >= 2 && t.length < 60 && /[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯ]/i.test(t) && !AUTHOR_ALT_BLOCK.test(t) && !/Xem thêm|See more|Thích|Bình luận|Chia sẻ|Like|Comment|Share/i.test(t)) {
        return t;
      }
    }
    return "";
  }

  // Với shared post, root có thể chỉ là phần body (chứa story_message gốc + story_message
  // được share), còn header (tác giả, permalink, thời gian) nằm ở sibling phía trên.
  // Hàm này trèo theo nhánh chứa story_message và tìm header ở các sibling khác nhánh.
  function extractHeaderInfo(root) {
    const msgEl = root.querySelector('[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"]');
    let branch = msgEl || root;
    let p = branch.parentElement;
    const timeRe = /^\d+\s*(năm|tháng|ngày|giờ|phút|tuần)\b/i;
    const POST_LINK_RE = /\/posts\/|\/permalink|\/videos\/|\/photos\/|photo\.php\?fbid|story_fbid=|\/watch/;
    let found = null;
    for (let depth = 0; depth < 40 && p && p.tagName !== "BODY"; depth++) {
      const siblings = [...p.children].filter(c => c !== branch);
      for (const sib of siblings) {
        let a = authorFromNameLink(sib);
        if (!a) {
          const h = sib.querySelector('h2, h3');
          if (h) {
            const t = (h.innerText || "").split("\n")[0].split("·")[0].trim();
            if (t.length >= 3 && t.length < 60 && /[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯ]/i.test(t)) a = t;
          }
        }
        if (!a) continue;
        if (!found) found = { author: a, time: "", link: "" };
        else if (!found.author) found.author = a;
        if (!found.time) {
          for (const span of sib.querySelectorAll('span, abbr')) {
            const t = (span.innerText || "").trim();
            if (t.length < 30 && timeRe.test(t)) { found.time = t; break; }
          }
          if (!found.time) {
            for (const aLink of sib.querySelectorAll('a[href]')) {
              const t = (aLink.innerText || "").trim();
              if (t.length < 30 && timeRe.test(t)) { found.time = t; break; }
            }
          }
        }
        if (!found.link) {
          for (const aLink of sib.querySelectorAll('a[href]')) {
            const href = aLink.href || "";
            if (POST_LINK_RE.test(href)) { found.link = href.split("?")[0]; break; }
          }
          if (!found.link) {
            for (const aLink of sib.querySelectorAll('a[href]')) {
              if ((aLink.href || "").includes('comment_id=')) { found.link = aLink.href; break; }
            }
          }
        }
      }
      if (found && found.author && (found.link || found.time)) return found;
      branch = p;
      p = p.parentElement;
    }
    if (found && found.author) return found;
    // Header nam phia TREN root (root chi la khoi body): leo to tien gan nhat,
    // lay link/time bai dau tien gap (header luon dung truoc comment trong DOM).
    if (!found || !found.link || !found.time) {
      let anc = root.parentElement;
      for (let depth = 0; depth < 6 && anc && anc.tagName !== "BODY"; depth++) {
        if (!found) found = { author: "", time: "", link: "" };
        // To tien chua qua 1 bai thi moi lay (nhieu story_message = nhieu bai,
        // lay link o day se nham sang bai khac).
        try {
          if (anc.querySelectorAll('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"]').length > 1) break;
        } catch {}
        if (!found.link) {
          const aLink = anc.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/videos/"], a[href*="/photos/"]');
          if (aLink && POST_LINK_RE.test(aLink.href || "")) found.link = aLink.href.split("?")[0];
        }
        if (!found.time) {
          for (const span of anc.querySelectorAll('span, abbr, a[aria-label]')) {
            const src = span.getAttribute && span.getAttribute("aria-label") ? String(span.getAttribute("aria-label")) : (span.innerText || "");
            const t = String(src || "").split("\n")[0].trim();
            if (t.length < 30 && timeRe.test(t)) { found.time = t; break; }
          }
        }
        if (found.link && found.time) break;
        anc = anc.parentElement;
      }
      if (found && (found.author || found.link || found.time)) return found;
    }
    return found || {};
  }

  function parseArticle(el) {
    if (el.dataset.scraped === "1") return null;
    if (skipSponsored && isSponsoredArticle(el)) return null;

    function isInComment(node) {
      if(node.closest('ul, div[aria-label*="Bình luận"], div[aria-label*="Comment"], div[data-pagelet*="Comment"]')) return true;
      const nestedArticle=node.closest('div[role="article"]');
      return !!nestedArticle && nestedArticle!==el;
    }
    let text = "";
    // 1) bai thuong
    const msgDiv = el.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
    if (msgDiv && msgDiv.innerText.trim().length > 0 && !isInComment(msgDiv)) {
      text = msgDiv.innerText.trim();
    }
    // 2) bai nen mau (vang/xanh/do) - text nam trong div co background
    if (!text || text.length < 20) {
      const bgDiv = el.querySelector('div[style*="background-color"], div[style*="background"]');
      if (bgDiv && bgDiv.innerText.trim().length > 10 && !isInComment(bgDiv)) {
        // lay text trong div nen mau, thuong la chinh bai
        const t = bgDiv.innerText.trim();
        if (t.length > text.length) text = t;
      }
    }
    // 3) lay div[dir="auto"] dai nhat ngoai comment - khong cat cut
    if (!text || text.length < 20) {
      const candidates = el.querySelectorAll('div[dir="auto"]');
      let longest = "";
      candidates.forEach(c => {
        if (isInComment(c)) return;
        const t = (c.innerText || "").trim();
        // lay doan dai nhat, khong gioi han 5 ky tu, giu nguyen
        if (t.length > longest.length) longest = t;
      });
      if (longest.length > 0) text = longest;
    }
    // 4) fallback: clone bo comment roi lay toan bo text, khong slice 800 nua
    if (!text || text.length < 20) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('ul, div[aria-label*="Bình luận"], div[aria-label*="Comment"], div[data-pagelet*="Comment"], div[role="article"]').forEach(n => n.remove());
      let full = (clone.innerText || "").trim();
      // bo dong dau la ten + time neu co
      const lines = full.split("\n").map(s=>s.trim()).filter(Boolean);
      // bo 2 dong dau neu la ten/time
      if (lines.length > 3 && lines[0].length < 60 && (lines[1].includes("Tháng") || lines[1].includes("năm") || lines[1].includes("·"))) {
        full = lines.slice(2).join("\n").trim();
      }
      text = full;
    }
    if (!text || text.length === 0) text = "[Bai nen mau - khong boc duoc text]";
    // cat header con sot dang "Doc To Hoe · 5 năm" hoac "Tháng 11, 2020" o dau bai
    text = text.replace(/^.*·\s*\d+\s*năm\s*/s, "").trim();
    text = text.replace(/^Tháng\s*\d+.*?\d{4}\s*·?\s*/s, "").trim();
    if (text.includes("Xem thêm bình luận") || text.includes("Xem them binh luan")) {
      text = text.split(/Xem thêm bình luận|Xem them binh luan/)[0].trim();
    }

    const imgs = [...el.querySelectorAll('img[src*="scontent"]')].map(i => i.src).filter(src=>src&&!src.startsWith("data:")).slice(0, 20);

    // Header của shared post có thể nằm ngoài root (sibling phía trên nhánh story_message).
    const header = extractHeaderInfo(el);

    // link bai viet - uu tien link co /posts/ that
    let link = "";
    const postLinks = [...el.querySelectorAll('a[href*="/posts/"]')].map(a=>a.href.split("?")[0]).filter(h=>h.includes("/posts/pfbid") || h.includes("/posts/"));
    if (postLinks.length > 0) link = postLinks[0];
    else {
      const linkEl = el.querySelector('a[href*="/permalink/"], a[href*="/videos/"], a[href*="/photos/"], a[href*="photo.php?fbid"]');
      if (linkEl) link = linkEl.href.split("?")[0];
      else {
        const anchors = [...el.querySelectorAll('a[href]')];
        for (const a of anchors) {
          if (a.href.includes("/posts/") || a.href.includes("/permalink.php")) { link = a.href.split("?")[0]; break; }
          if (/\/videos\/|\/photos\/|photo\.php\?fbid|story_fbid=|\/watch/.test(a.href)) { link = a.href.split("?")[0]; break; }
          if (a.href.includes("comment_id=")) { link = a.href; break; }
        }
      }
    }
    if (!link && header.link) link = header.link;
    if (!link) {
      // Nhom/marketplace: card khong co permalink /posts/; id bai nam trong
      // set=pcb.<postId> cua link anh. Dung photo permalink lam link mo bai.
      for (const a of [...el.querySelectorAll('a[href]')]) {
        const href = String(a.href || "");
        const fb = href.match(/[?&]fbid=(\d+)/);
        const pcb = href.match(/[?&]set=pcb\.(\d+)/);
        if (fb && pcb) { link = `https://www.facebook.com/photo/?fbid=${fb[1]}&set=pcb.${pcb[1]}`; break; }
      }
    }
    if (!link || link.includes("?locale=")) link = ""; // bo link rac nhu ?locale=vi_VN
    // bo card rac (panel goi y ket ban, header profile) khi khong co bat cu
    // dinh danh bai that nao (link/video/anh)
    const _imgsEarly = [...el.querySelectorAll('img[src*="scontent"]')].map(i => i.src).filter(src=>src&&!src.startsWith("data:"));
    const _hasVideoEarly = !!el.querySelector('video') || !!el.querySelector('a[href*="/videos/"]') || /\/videos\//.test(link);
    if (isNonPostCard(el, link, _hasVideoEarly, _imgsEarly.length > 0)) return null;
    const id = link || textHash(text);
    if (seen.has(id) && id.length > 0) return null;

    // thoi gian - tim span co chua nam/thang/gio
    let time = "";
    const timeCandidates = [...el.querySelectorAll('a[href*="/posts/"] span, abbr, span')];
    for (const c of timeCandidates) {
      const t = (c.innerText || "").trim();
      if (/^\d+\s*(năm|tháng|ngày|giờ|phút|tuần)/i.test(t) || /Tháng\s*\d+\s*năm\s*\d{4}/i.test(t) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(t) || /5 năm|6 năm|7 năm|8 năm|9 năm/.test(t)) {
        if (t.length < 30) { time = t; break; }
      }
    }
    if (!time) {
      // fallback: tim text co "·" + thoi gian
      const dotSpans = [...el.querySelectorAll('span')].map(s=>s.innerText.trim()).filter(s=>/^\d+\s*(năm|tháng|ngày|giờ|phút|tuần)\b/i.test(s)||/^Tháng\s*\d+.*\d{4}/i.test(s));
      if (dotSpans.length > 0) time = dotSpans[0].slice(0,30);
    }
    if (!time) {
      // timeline moi: thoi gian tuong doi nam trong text cua link bat ky
      for (const a of [...el.querySelectorAll('a[href]')]) {
        const t = (a.innerText || "").trim();
        if (t.length < 30 && /^\d+\s*(năm|tháng|ngày|giờ|phút|tuần)\b/i.test(t)) { time = t; break; }
      }
    }
    if (!time) {
      // player/timestamp moi: thoi gian nam trong aria-label (VD "3 ngày trước")
      const timeRe2 = /^\d+\s*(năm|tháng|ngày|giờ|phút|tuần)\b/i;
      for (const n of [...el.querySelectorAll('[aria-label]')]) {
        const t = String(n.getAttribute("aria-label") || "").trim();
        if (t.length < 30 && timeRe2.test(t)) { time = t; break; }
      }
    }
    if (!time && header.time) time = header.time;
    // chuan hoa: chi lay dong dau, cat duoi "·" thua ("3 ngày trước\n \n·")
    time = String(time || "").split("\n")[0].replace(/[\s·•|\-]+$/u, "").trim();

    // tac gia - lay tu h2/h3/strong dau tien, bo qua "Xem them"
    let author = "";
    const authorSelectors = ['h2 a span','h2 span','h3 a span','h3 span','a strong span','strong'];
    for (const sel of authorSelectors) {
      const aEl = el.querySelector(sel);
      if (aEl) {
        const t = aEl.innerText.trim();
        if (t && t.length >= 3 && t.length < 60 && !t.includes("Xem") && !t.includes("Thích") && !t.includes("Bình luận")) {
          // ten thuong co chu hoa, khong phai so
          if (/[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯ]/i.test(t)) { author = t; break; }
        }
      }
    }
    if (!author) {
      const h = el.querySelector('h2, h3');
      if (h) {
        const t = h.innerText.split("\n")[0].trim().split("·")[0].trim();
        if (t.length >=3 && t.length < 60) author = t;
      }
    }
    if (!author) author = authorFromNameLink(el);
    if (!author && header.author) author = header.author;
    // lam sach text: bo prefix tac gia + time neu lap lai trong text
    if (author && text.startsWith(author)) text = text.slice(author.length).trim();
    text = text.replace(/^[·\s-]+/, "").trim();
    if (time && text.startsWith(time)) text = text.slice(time.length).trim();
    text = text.replace(/^[·\s-]+/, "").trim();
    // bo duoi Xem them / Thich / Binh luan con sot (ke ca "An bot" khi bai da bung het)
    text = text.replace(/\s*Xem thêm.*$/s, "").replace(/\s*Xem them.*$/s, "").trim();
    text = text.replace(/\s*(Ẩn bớt|Show less|Ẩn đi)\s*$/u, "").trim();
    text = text.replace(/\s*Thích.*$/s, "").replace(/\s*Like.*$/s, "").trim();
    // bo doan "· 5 năm" con dinh dau text
    text = text.replace(/^·\s*\d+\s*năm\s*/i, "").trim();
    text = text.replace(/\s{2,}/g, " ");

    const path=location.pathname||"";
    const sourceType=/^\/groups\//i.test(path)?"group":(/^\/pages\//i.test(path)?"page":"profile");
    const sourceTitle=(document.title||"").replace(/^\(\d+\)\s*/g,"").replace(/\s*\|\s*Facebook\s*$/i,"").trim();

    // Phân loại 4 kiểu để "Học văn phong" chọn theo nguồn + kiểu:
    //   1 text (bài text dài) / 2 textBg (bài ngắn nền màu) / 3 photo / 4 video.
    const videoEl = el.querySelector('video');
    const videoLinkEl = el.querySelector('a[href*="/videos/"]');
    const hasVideo = !!videoEl || !!videoLinkEl || /\/videos\//.test(link);
    const hasPhoto = imgs.length > 0 || /\/photos\//.test(link) || /\/photo\.php/.test(link) || !!el.querySelector('a[href*="/media/"]');
    // Nen mau chi xet cho bai text/video-anh: bai video/photo co poster nhieu
    // mau nhung KHONG phai bai nen mau.
    const bgColor = (!hasVideo && !hasPhoto) ? postBackgroundColor(el) : "";
    let contentClass = "text";
    if (hasVideo) contentClass = "video";
    else if (hasPhoto) contentClass = "photo";
    else if (bgColor) contentClass = "textBg";

    // Metadata video (không tự tải file — chỉ poster, thời lượng và permalink).
    let video = null;
    if (hasVideo) {
      const posterUrl = videoEl ? (videoEl.poster || videoEl.getAttribute("poster") || "") : "";
      const durationText = videoDurationText(el);
      const permalink = /\/videos\//.test(link) ? link : (videoLinkEl ? videoLinkEl.href.split("?")[0] : "");
      video = { posterUrl, durationText, permalink, capturedUrl: "" };
    }

    return { id, author: author || (sourceTitle && !/^Facebook$/i.test(sourceTitle)?sourceTitle:t("sc.unknownAuthorDiac")), time: time || "", text: text || t("sc.noText"), link: link || "", images: imgs, isSponsored:isSponsoredArticle(el), sourceType, sourceUrl:location.href, sourceTitle:document.title||"", scrapedAt: new Date().toISOString(), contentClass, hasBackground:!!bgColor, hasVideo, hasPhoto, video };
  }

  // Comment that: article long nhau (feed) hoac article doc lap (permalink)
  // nhung KHONG phai bai/share long nhau (co story_message rieng).
  function looksLikeComment(art, rootEl){
    if (!art || art === rootEl) return false;
    if (art.querySelector('[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]')) return false;
    if (isCommentCandidate(art)) return true;
    const txt = art.innerText || "";
    if (!/(Trả lời|Reply)/.test(txt)) return false;
    if (isSponsoredArticle(art)) return false;
    return true;
  }
  function collectVisibleComments(el, out, maxN){
    const keyOf = c => ((c.author || "") + "|" + String(c.text || "").slice(0, 80)).toLowerCase();
    const have = new Set(out.map(keyOf));
    const timeRe = /^\d+\s*(năm|tháng|ngày|giờ|phút|tuần)\b/i;
    for (const art of el.querySelectorAll('div[role="article"]')) {
      if (out.length >= maxN) break;
      if (!looksLikeComment(art, el)) continue;
      if (art.offsetParent === null && (art.innerText||"").trim().length < 5) continue;
      // text comment: ban sao loai article long nhau de khong vo reply
      let text = "";
      try {
        const clone = art.cloneNode(true);
        clone.querySelectorAll('div[role="article"]').forEach(n => n.remove());
        const cands = [...clone.querySelectorAll('div[dir="auto"], div[data-ad-comet-preview="message"], div[data-ad-preview="message"]')];
        let longest = "";
        cands.forEach(c => { const t = (c.innerText || "").trim(); if (t.length > longest.length) longest = t; });
        text = longest.replace(/\s{2,}/g, " ").trim();
      } catch {}
      if (!text || text.length < 2) continue;
      if (/^(Thích|Like|Trả lời|Reply|Xem thêm|See more)$/i.test(text)) continue;
      let author = "";
      const h = art.querySelector('h3 a, h3, strong');
      if (h) {
        const t = (h.innerText || "").split("\n")[0].trim();
        if (t.length >= 2 && t.length < 60) author = t;
      }
      if (!author) author = authorFromNameLink(art);
      let time = "";
      for (const s of art.querySelectorAll('span, abbr, a[aria-label]')) {
        const src = s.getAttribute && s.getAttribute("aria-label") ? String(s.getAttribute("aria-label")) : (s.innerText || "");
        const t = String(src || "").split("\n")[0].trim();
        if (t.length < 30 && timeRe.test(t)) { time = t; break; }
      }
      let likes = "";
      for (const s of art.querySelectorAll('[aria-label]')) {
        const label = String(s.getAttribute("aria-label") || "");
        const m = label.match(/([\d.,]+(?:\s?[KMB])?)\s*(lượt thích|thích|likes?|reactions?)/i);
        if (m) { likes = m[1].trim(); break; }
      }
      const key = (author + "|" + text.slice(0, 80)).toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      out.push({ author: author || "", text, time, likes });
    }
    return out;
  }

  // Nút mở rộng comment HỢP LỆ phải nằm trong thread bình luận thật (ul /
  // aria-label bình luận / pagelet comment) Ở GẦN (tối đa 6 bậc cha) và scope
  // đó phải chứa sẵn ≥1 article comment. Nút "Xem thêm bình luận" trôi nổi
  // (thực chất là overlay mở reel viewer) tuyệt đối không bấm.
  function expansionScope(btn){
    let el = null;
    try { el = btn.parentElement; } catch { return null; }
    for (let depth = 0; depth < 6 && el; depth++) {
      const tag = el.tagName || "";
      if (tag === "UL") return el;
      const al = (el.getAttribute && el.getAttribute("aria-label")) || "";
      if (/bình luận|comment/i.test(al)) return el;
      const dp = (el.getAttribute && el.getAttribute("data-pagelet")) || "";
      if (/comment/i.test(dp)) return el;
      el = el.parentElement;
    }
    return null;
  }

  async function extractPostComments(el, maxN, runId){
    const out = [];
    const cap = Math.max(0, Math.min(100000, parseInt(maxN) || 0));
    if (!el || !cap) return out;
    const expectedRoute = sourceKey(location.href);
    collectVisibleComments(el, out, cap);
    // Bai video/reel-preview: nut mo rong comment thuong mo luon trinh xem
    // reel (doi route) thay vi bung inline — chi lay comment dang hien.
    try {
      if (el.querySelector('video, a[href*="/reel/"], a[href*="/watch"]')) return out.slice(0, cap);
    } catch { return out.slice(0, cap); }
    const moreRe = /^(xem thêm bình luận|xem thêm \d+ bình luận|see more comments|view more comments|view previous comments|xem các bình luận trước)/i;
    for (let round = 0; round < 3; round++) {
      collectVisibleComments(el, out, cap);
      if (out.length >= cap) break;
      if (!await scrapeRunActive(runId)) break;
      if (sourceKey(location.href) !== expectedRoute) break;
      // Chi bam nut nam trong scope thread THAT (co san article comment).
      // Nut troi noi (overlay mo reel viewer) khong bao gio co scope nay.
      const scoped = [];
      for (const b of [...el.querySelectorAll('div[role="button"], span[role="button"]')]) {
        if (b.offsetParent === null) continue;
        if (!moreRe.test((b.innerText || "").trim())) continue;
        const scope = expansionScope(b);
        if (scope && scope.querySelector('div[role="article"]')) scoped.push(b);
      }
      if (!scoped.length) break;
      try { scoped[0].click(); } catch {}
      if (!await scrapeSleep(900, runId)) break;
      if (sourceKey(location.href) !== expectedRoute) break;
    }
    if (sourceKey(location.href) === expectedRoute) collectVisibleComments(el, out, cap);
    return out.slice(0, cap);
  }

  // Ban mirror luu chrome.storage.local: cat comments de nhe quota (comments
  // van day du trong bo nho + IndexedDB + file tai).
  function stripCommentsForMirror(list){
    return (Array.isArray(list)?list:[]).map(p=>{
      if(!p||typeof p!=="object"||!p.comments)return p;
      const {comments,...rest}=p;
      return rest;
    });
  }

  async function extractPosts(runId) {
    let diagOn = false;
    try { const _d = await chrome.storage.local.get("scrapeDiag"); diagOn = !!(_d && _d.scrapeDiag); } catch {}
    const diag = [];
    // Thu thap tu nhieu loai container cua FB (profile, page, group)
    let candidates = [];
    const sels = [
      'div[role="article"]',
      'div[data-pagelet^="FeedUnit"]',
      'div[data-pagelet="ProfileTileAbout"]',
      'div[data-pagelet="FeedUnit_0"] div'
    ];
    // gom tat ca - khong loai theo do dai
    const seenEl = new Set();
    // for-of + try/catch: 1 phan tu loi khong duoc lam dung ca vong gom (forEach truoc day se gay ca callback)
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        try {
          let target = el;
          if (el.getAttribute("data-pagelet") && el.getAttribute("data-pagelet").startsWith("FeedUnit")) {
            const art = el.querySelector('div[role="article"]');
            if (art) target = art;
          }
          if (el.hasAttribute("data-ad-preview")) {
            target = el.closest('div[role="article"]') || el.closest('div[data-pagelet^="FeedUnit"]') || el;
          }
          if(isCommentCandidate(target)) continue;
          // chi bo phan tu an (offsetParent null) nhung van giu lai neu co noi dung
          if (!seenEl.has(target) && (target.innerText || "").trim().length > 0) {
            // cho ca phan tu an neu la article (FB virtualized)
            if (target.offsetParent !== null || target.getAttribute("role") === "article") {
              seenEl.add(target);
              candidates.push(target);
            } else if ((target.innerText || "").length > 10) {
              seenEl.add(target);
              candidates.push(target);
            }
          }
        } catch (error) {
          console.warn("[Scrape] gather candidate error", error);
        }
      }
    }
    // Timeline mới: bài thật không còn role="article". Neo theo phần text bài
    // ([data-ad-rendering-role="story_message"] / [data-ad-preview="message"])
    // rồi trèo lên root chứa đúng 1 bài (có tác giả + permalink + media).
    const msgSels = ['[data-ad-rendering-role="story_message"]', '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]'];
    for (const sel of msgSels) {
      for (const el of document.querySelectorAll(sel)) {
        try {
          const target = postRootFor(el, sel);
          if (isCommentCandidate(target)) continue;
          if (!seenEl.has(target) && (target.innerText || "").trim().length > 0) {
            seenEl.add(target);
            candidates.push(target);
          }
        } catch (error) {
          console.warn("[Scrape] gather candidate error", error);
        }
      }
    }
    if (candidates.length < 3) {
      document.querySelectorAll('div[data-pagelet^="FeedUnit"]').forEach(el => {
        if (!seenEl.has(el) && (el.innerText || "").trim().length > 0) {
          if(isCommentCandidate(el)) return;
          candidates.push(el);
          seenEl.add(el);
        }
      });
    }

    let added = 0;
    let rawCount = candidates.length;
    for (const el of candidates) {
      if (collected.length >= targetCount) break;
      if (el.dataset.scraped === "1") continue;
      // Khi cào comment: dua bai vao giua viewport + cho FB hydrate action bar/
      // thread truoc khi boc (feed thuong render luoi cac phan nay).
      if (scrapeWithComments && scrapeMaxComments > 0) {
        try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
        if (!await scrapeSleep(700, runId)) { await scrapeExitUnclean(runId); return added; }
        if (!await scrapeRunActive(runId)) { await scrapeExitUnclean(runId); return added; }
      }
      if (diagOn && diag.length < 12) {
        try {
          const anchors = [...el.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')||'');
          diag.push({
            tag: el.tagName, txtLen: (el.innerText||"").length,
            anchors: anchors.length,
            samples: anchors.filter(h=>/posts|permalink|story_fbid|fbid|reel|watch|video|photo/i.test(h)).slice(0,4),
            hasMsg: !!el.querySelector('[data-ad-rendering-role="story_message"],[data-ad-comet-preview="message"]'),
            dataFt: (()=>{const n=el.querySelector('[data-ft]');return n?String(n.getAttribute('data-ft')).slice(0,160):null;})()
          });
        } catch {}
      }
      let data = null;
      try {
        data = parseArticle(el);
      } catch (error) {
        // 1 bai loi khi parse khong duoc lam dung ca luot quet - danh dau bo qua roi sang bai ke
        console.warn("[Scrape] parseArticle error", error);
        el.dataset.scraped = "1";
        continue;
      }
      if (data) {
        el.dataset.scraped = "1";
        el.style.outline = "2px solid #00c851";
        seen.add(data.id);
        if (scrapeWithComments) {
          try { data.comments = await extractPostComments(el, scrapeMaxComments, runId); }
          catch { data.comments = []; }
        } else data.comments = [];
        collected.push(data);
        added++;
      } else {
        // khong loai - van danh dau de khong lap lai
        el.dataset.scraped = "1";
      }
    }
    if (rawCount > 0) console.log(`[Scrape] raw candidates=${rawCount}, added=${added}, total=${collected.length}`);
    if (diagOn && diag.length) {
      try { await chrome.storage.local.set({ scrapeDiagResult: diag }); } catch {}
    }
    return added;
  }

  function postCommentsOf(p){ return (p && Array.isArray(p.comments)) ? p.comments : []; }

  function mdCommentsBlock(p){
    const cs = postCommentsOf(p);
    if (!cs.length) return "";
    let s = `\n${t("sc.mdComments",{n:cs.length})}\n`;
    cs.forEach(c => { s += `- **${c.author || "?"}**${c.time ? ` (${c.time})` : ""}${c.likes ? ` [${c.likes}👍]` : ""}: ${c.text || ""}\n`; });
    return s;
  }

  function generateMD(data, scope) {
    scope = String(scope || "all");
    const onlyComments = scope === "comments";
    const list = onlyComments ? data.filter(p => postCommentsOf(p).length > 0) : data;
    if (!list.length) return "";
    let md = t("sc.mdTitle",{d:new Date().toLocaleString(I18N_LANG==="en"?"en-US":"vi-VN")})+`\n`;
    md += t("sc.mdHead",{src:window.location.href,n:list.length});
    list.forEach((p, i) => {
      const titleTime = p.time ? ` - ${p.time}` : "";
      md += `## ${i + 1}. ${p.author || t("sc.unknownAuthor")}${titleTime}\n\n`;
      if (p.link) md += `Link: ${p.link}\n\n`;
      else md += t("sc.noLink")+`\n\n`;
      if (!onlyComments) {
        const cleanText = (p.text || "").replace(/\s{2,}/g, " ").trim();
        md += `${cleanText}\n`;
        md += mdCommentsBlock(p);
        if (scope !== "text" && p.images.length > 0) {
          p.images.forEach(img => md += `![${t("sc.imgAlt")}](${img})\n`);
        }
        md += `\n`;
      } else {
        md += mdCommentsBlock(p);
      }
      md += `---\n\n`;
    });
    return md;
  }

  function generateTXT(data, scope) {
    scope = String(scope || "all");
    const onlyComments = scope === "comments";
    const list = onlyComments ? data.filter(p => postCommentsOf(p).length > 0) : data;
    if (!list.length) return "";
    const source=list.find(p=>p?.sourceUrl)?.sourceUrl||window.location.href;
    const sourceTitle=list.find(p=>p?.sourceTitle)?.sourceTitle||document.title||"Facebook";
    const header=t("sc.txtHead",{src:source,title:sourceTitle,n:list.length});
    return header+list.map((p, i) => {
      let s = `=== ${t("sc.txtPost")} ${i + 1} ===\n${t("sc.txtAuthor")} ${p.author || "N/A"}\n${t("sc.txtTime")} ${p.time || "N/A"}\nLink: ${p.link}\n`;
      if (!onlyComments) s += `${t("sc.txtContent")}\n${p.text}\n`;
      const cs = postCommentsOf(p);
      if (cs.length) s += `${t("sc.txtComments",{n:cs.length})}\n` + cs.map(c => `- ${c.author || "?"}${c.time ? ` (${c.time})` : ""}: ${c.text || ""}`).join("\n") + "\n";
      if (!onlyComments && scope !== "text" && p.images.length) s += t("sc.txtImages") + " " + p.images.join(", ") + "\n";
      return s;
    }).join("\n\n----------------\n\n");
  }

  function generateJSON(data, scope) {
    scope = String(scope || "all");
    let posts = data;
    if (scope === "text") posts = data.map(p => ({ id:p.id, author:p.author, time:p.time, link:p.link, text:p.text, contentClass:p.contentClass, sourceUrl:p.sourceUrl, scrapedAt:p.scrapedAt }));
    else if (scope === "comments") posts = data.filter(p => postCommentsOf(p).length > 0).map(p => ({ id:p.id, author:p.author, time:p.time, link:p.link, comments:postCommentsOf(p) }));
    return JSON.stringify({ source: window.location.href, exportedAt: new Date().toISOString(), scope, count: posts.length, posts }, null, 2);
  }

  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Luu lai lan cao gan nhat de tai lai theo format tu chon
  let lastCollected = [];
  let lastDownloadReason = "";

  // Tai rieng file anh (moi anh 1 file, toi da 100 file/luot).
  async function downloadImages(data) {
    const seen = new Set();
    const jobs = [];
    (Array.isArray(data) ? data : []).forEach((p, i) => {
      (Array.isArray(p?.images) ? p.images : []).slice(0, 8).forEach(u => {
        const url = String(u || "");
        if (!url || seen.has(url)) return;
        seen.add(url);
        jobs.push({ url, post:i + 1 });
      });
      if (p?.video?.posterUrl && !seen.has(p.video.posterUrl)) {
        seen.add(p.video.posterUrl);
        jobs.push({ url: p.video.posterUrl, post:i + 1, poster:true });
      }
    });
    const capped = jobs.slice(0, 100);
    if (!capped.length) { lastDownloadReason = "no-data"; return false; }
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    let okCount = 0;
    for (let k = 0; k < capped.length; k++) {
      const job = capped[k];
      try {
        // Khong gui credentials: CDN anh FB chap nhan request khong cookie
        // (giong background captureImages); gui cookie de bi CORS reject.
        const res = await fetch(job.url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        if (!blob.size) throw new Error("empty");
        const mime = String(blob.type || "").split(";")[0] || "image/jpeg";
        const ext = mime.includes("png") ? "png" : (mime.includes("webp") ? "webp" : (mime.includes("gif") ? "gif" : "jpg"));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `fb_img_${ts}_p${job.post}_${k + 1}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        okCount++;
      } catch (e) { console.warn("[Scrape] download image failed", String(job.url).slice(0, 80), String((e && e.message) || e)); }
      await sleep(300);
    }
    chrome.storage.local.set({ scrapeStatus: t("sc.imgDownloaded",{ok:okCount,total:capped.length}) });
    return okCount > 0;
  }

  async function doDownload(format, scope) {
    scope = String(scope || "all");
    lastDownloadReason = "";
    if (collected.length === 0 && lastCollected.length === 0) { lastDownloadReason="no-data"; return false; }
    const data = collected.length > 0 ? collected : lastCollected;
    const sourceKeys=[...new Set(data.map(p=>p?.sourceUrl?sourceKey(p.sourceUrl):"").filter(Boolean))];
    if(sourceKeys.length && (sourceKeys.length>1 || sourceKeys[0]!==sourceKey(location.href))){
      chrome.storage.local.set({scrapeStatus:t("sc.wrongSourceDl")});
      lastDownloadReason="source-mismatch";
      return false;
    }
    if (scope === "images") return downloadImages(data);
    const ts = new Date().toISOString().replace(/[:.]/g,"-").slice(0, 19);
    const sourceName=(document.title||"facebook").replace(/[^\p{L}\p{N}_-]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,50)||"facebook";
    const scopeSuffix = scope && scope !== "all" ? `_${scope}` : "";
    let content, filename, mime;
    if (format === "json") {
      content = generateJSON(data, scope);
      filename = `fb_posts${scopeSuffix}_${sourceName}_${ts}.json`;
      mime = "application/json";
    } else if (format === "txt") {
      content = generateTXT(data, scope);
      filename = `fb_posts${scopeSuffix}_${sourceName}_${ts}.txt`;
      mime = "text/plain";
    } else {
      content = generateMD(data, scope);
      filename = `fb_posts${scopeSuffix}_${sourceName}_${ts}.md`;
      mime = "text/markdown";
    }
    if (!content) { lastDownloadReason = "no-data"; chrome.storage.local.set({ scrapeStatus: t("p.scNoData") }); return false; }
    download(content, filename, mime);
    chrome.storage.local.set({ scrapeStatus: t("sc.downloaded",{n:data.length,file:filename}) });
    return true;
  }

  // Lưu dataset + toàn bộ bài đã cào vào IndexedDB (qua background) để
  // chọn nguồn/kiểu cho Học văn phong, tải lại hoặc xoá sau này. Không ghi
  // API key/cookie/token — chỉ text, link, host ảnh và phân loại bài.
  function datasetHash(srcKey){
    let h = 0;
    const s = String(srcKey || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (Math.abs(h) >>> 0).toString(36).padStart(8, "0") + s.length.toString(36);
  }

  async function persistRunToStore(posts){
    const data = Array.isArray(posts) ? posts : collected;
    if (!data || !data.length) return null;
    const srcKey = sourceKey(data[0].sourceUrl || location.href);
    const id = `ds_${datasetHash(srcKey)}`;
    let prev = null;
    try {
      const r = await chrome.runtime.sendMessage({ action: "scrapeStore", op: "get", store: "datasets", id });
      if (r?.ok && r.value) prev = r.value;
    } catch (error) { console.warn("[Scrape] scrapeStore get failed", error); }
    const dataset = {
      id,
      sourceKey: srcKey,
      sourceUrl: srcKey,
      sourceType: data[0].sourceType || "profile",
      sourceTitle: String(data[0].sourceTitle || document.title || "").replace(/\s*\|\s*Facebook\s*$/i, "").trim(),
      createdAt: prev?.createdAt || Date.now(),
      updatedAt: Date.now(),
      postCount: data.length,
      commentCount: data.reduce((n,p)=>n+((p&&Array.isArray(p.comments))?p.comments.length:0),0),
      options: { skipAds: skipSponsored, captureMedia: scrapeCaptureMedia, withComments: scrapeWithComments, maxComments: scrapeMaxComments },
      videoPool: videoPool.slice(0, 50)
    };
    try {
      const r = await chrome.runtime.sendMessage({ action: "scrapeStore", op: "saveRun", dataset, posts: data });
      if (r?.ok) {
        if (scrapeCaptureMedia) captureRunMedia(r.value.id, data).catch(()=>{});
        return r.value;
      }
    } catch (error) { console.warn("[Scrape] scrapeStore saveRun failed", error); }
    return null;
  }

  // Tải ảnh/poster vào kho media (IndexedDB qua background) sau khi lưu dataset.
  // Không tải file video ở bước này — video chỉ lưu URL bắt được từ trang để
  // người dùng tự chọn tải từ kho dữ liệu.
  async function mediaCancelRequested(){
    try { const s = await chrome.storage.local.get("scrapeMediaCancel"); return !!s.scrapeMediaCancel; } catch(_) { return true; }
  }
  async function captureRunMedia(datasetId, posts){
    if (mediaCapturing) return;
    mediaCapturing = true;
    let savedCount = 0, videoCount = 0;
    // chuan hoa URL video (cat query/token het han) de khong luu trung
    const normMediaUrl=u=>String(u||"").split(/[?#]/)[0].toLowerCase();
    try {
      const tasks = [];
      (Array.isArray(posts) ? posts : []).forEach(p => {
        const postKey = String(p?.id || "").slice(0, 120);
        const urls = (Array.isArray(p?.images) ? p.images : []).slice(0, 8);
        if (urls.length) tasks.push({ type: "images", postKey, urls });
        if (p?.video?.posterUrl) tasks.push({ type: "poster", postKey, url: p.video.posterUrl });
        if (p?.video?.capturedUrl) tasks.push({ type: "video", postKey, url: p.video.capturedUrl });
      });
      for (const urlEntry of videoPool.slice(0, 50)) tasks.push({ type: "video", postKey: "pool", url: urlEntry.url });
      const seenTaskUrl = new Set();
      const capped = tasks.filter(t=>{
        const key = t.type === "images" ? ("images:" + taskKeyOfUrls(t.urls)) : (t.type + ":" + normMediaUrl(t.url));
        if (seenTaskUrl.has(key)) return false;
        seenTaskUrl.add(key);
        return true;
      }).slice(0, 300);
      for (const task of capped) {
        if (await mediaCancelRequested()) break;
        try {
          if (task.type === "images") {
            const r = await chrome.runtime.sendMessage({ action: "scrapeMedia", op: "captureImages", datasetId, postKey: task.postKey, urls: task.urls, limit: 8 });
            if (r?.ok) savedCount += (r.saved || []).length;
          } else if (task.type === "poster") {
            const r = await chrome.runtime.sendMessage({ action: "scrapeMedia", op: "putPoster", datasetId, postKey: task.postKey, url: task.url });
            if (r?.ok) savedCount += 1;
          } else {
            const r = await chrome.runtime.sendMessage({ action: "scrapeMedia", op: "putVideoUrl", datasetId, postKey: task.postKey, url: task.url });
            if (r?.ok) videoCount += 1;
          }
        } catch (error) { console.warn("[Scrape] captureRunMedia task failed", task.type, error); }
        await chrome.storage.local.set({ scrapeMediaCount: savedCount, scrapeVideoCount: videoCount, scrapeMediaStatus: `${savedCount} ảnh/poster · ${videoCount} video URL` });
        if (await mediaCancelRequested()) break;
        await sleep(500 + Math.random() * 600);
      }
    } finally {
      mediaCapturing = false;
      chrome.storage.local.set({ scrapeMediaStatus: `Xong: ${savedCount} ảnh/poster · ${videoCount} video URL` }).catch(()=>{});
    }
  }

  // Thoat sach khi phien chet giua chung (lac route/reload nham nguon):
  // chi don c/storage khi co isScraping van true (Stop/Reset cua nguoi dung
  // da tu ghi false + status rieng truoc, khong duoc ghi de).
  async function scrapeExitUnclean(runId){
    if(runId!==runSerial)return;
    isScraping=false;
    try{
      const s=await chrome.storage.local.get(["isScraping","scrapeTarget"]);
      if(s.isScraping){
        await chrome.storage.local.set({isScraping:false,scrapeStatus:t("sc.leftSource")});
        await chrome.storage.local.remove(["scrapeTarget"]);
      }
    }catch{}
  }

  async function scrapeLoop(resume=false) {
    const runId=++runSerial;
    isScraping = true;
    try {
      if(resume){
        const saved=await chrome.storage.local.get("scrapePosts");
        collected=Array.isArray(saved.scrapePosts)?saved.scrapePosts.slice(0,500):[];
        lastCollected=[...collected];
        seen=new Set(collected.map(p=>String(p?.id||"")).filter(Boolean));
      }else{
        collected = [];
        lastCollected = [];
        seen.clear();
        await chrome.storage.local.remove("scrapePosts");
      }
      idleCount = 0;
      document.querySelectorAll('[data-scraped="1"]').forEach(el => { delete el.dataset.scraped; el.style.outline = ""; });

      await chrome.storage.local.set({ scrapeStatus: resume?t("sc.resumed",{from:collected.length,to:targetCount}):t("sc.starting"), scrapeCount: collected.length, scrapeReady: false, scrapeRunSourceUrl:sourceKey(location.href), scrapeSkipAds:skipSponsored, scrapeStartedAt:Date.now(), isScraping:true });

      // Chờ trang/ảnh ổn định trước khi bóc lượt đầu (ảnh/video vẫn đang tải).
      if(!await scrapeSleep(2500, runId)){await scrapeExitUnclean(runId);return;}

      // Tran an toan tho, khong thay the idle-count stall detection ben duoi -
      // chi de chan feed qua thua (loi rai vai bai moi vai vong) chay vo han.
      const loopStartedAt = Date.now();
      let loopRounds = 0;
      const MAX_LOOP_ROUNDS = 400;
      const MAX_LOOP_MS = 20 * 60 * 1000;

      while (collected.length < targetCount) {
        if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
        loopRounds++;
        if (loopRounds > MAX_LOOP_ROUNDS || Date.now() - loopStartedAt > MAX_LOOP_MS) {
          await chrome.storage.local.set({ scrapeStatus: t("sc.stalled",{n:collected.length}) });
          break;
        }
        // mo rong tat ca bai bi cat "Xem them" truoc khi boc
        const expanded = expandSeeMore();
        if (expanded > 0 && !await scrapeSleep(800,runId)){await scrapeExitUnclean(runId);return;}
        if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
        const added = await extractPosts(runId);
        if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
        await chrome.storage.local.set({ scrapePosts:stripCommentsForMirror(collected).slice(-500), scrapeCount: collected.length, scrapeStatus: t("sc.progress",{from:collected.length,to:targetCount}) });

        if (added === 0) idleCount++;
        else idleCount = 0;

        // scroll bang wheel thật, theo nhịp dần để FB lazy-load bài mới
        if (idleCount >= 3) {
          if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
          await trustedScrollStep(window.innerHeight * 1.2 || 1200);
          if(!await scrapeSleep(3000,runId)){await scrapeExitUnclean(runId);return;}
          const added2 = await extractPosts(runId);
          if (added2 === 0) {
            // thu scroll nguoc len 1 chut roi xuong lai kich hoat lazy load
            if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
            await trustedScrollStep(-600);
            if(!await scrapeSleep(1000,runId)){await scrapeExitUnclean(runId);return;}
            if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
            await trustedScrollStep(window.innerHeight * 1.2 || 1200);
            if(!await scrapeSleep(3000,runId)){await scrapeExitUnclean(runId);return;}
            if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
            if (await extractPosts(runId) === 0 && idleCount >= 6) {
              await chrome.storage.local.set({ scrapeStatus: t("sc.stalled",{n:collected.length}) });
              break;
            }
          } else idleCount = 0;
        } else {
          if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
          await trustedScrollStep(window.innerHeight * 0.9 || 900);
          if(!await scrapeSleep(1800 + Math.random() * 700,runId)){await scrapeExitUnclean(runId);return;}
        }

        if (collected.length >= targetCount) break;
      }

      // Một phiên mới có thể đã được bắt đầu trong lúc phiên cũ đang chờ
      // Facebook render; phiên cũ tuyệt đối không được ghi đè state mới.
      if(!await scrapeRunActive(runId)){await scrapeExitUnclean(runId);return;}
      isScraping = false;
      await chrome.storage.local.set({ isScraping:false });
      await chrome.storage.local.remove(["scrapeTarget"]);

      if (collected.length === 0) {
        await chrome.storage.local.set({ scrapeStatus: t("sc.noPosts"), scrapeReady: false });
        return;
      }

      lastCollected = [...collected];
      const commentTotal = lastCollected.reduce((n,p)=>n+((p&&Array.isArray(p.comments))?p.comments.length:0),0);
      await chrome.storage.local.set({ scrapePosts:stripCommentsForMirror(lastCollected).slice(-500), scrapeStatus: commentTotal>0?t("sc.doneFull",{n:collected.length,c:commentTotal,src:document.title||sourceKey(location.href)}):t("sc.done",{n:collected.length,src:document.title||sourceKey(location.href)}), scrapeCount: collected.length, lastScrapeCount: collected.length, scrapeCommentCount: commentTotal, scrapeReady: true, scrapeHasData: true });
      console.log("[Scrape] done",{count:collected.length});
      persistRunToStore(lastCollected).then(saved=>{
        if (saved) chrome.storage.local.set({ scrapeDatasetId: saved.id });
      }).catch(()=>{});
    } catch(error) {
      console.warn("[Scrape] scrapeLoop error", error);
      // Chi ghi de state neu phien nay van la phien hien tai - phien cu bi
      // thay the (runId!==runSerial) tuyet doi khong duoc ghi de state cua phien moi.
      if (runId === runSerial) {
        isScraping = false;
        await chrome.storage.local.set({ isScraping:false, scrapeStatus: "Lỗi: "+String(error?.message||error||"") }).catch(()=>{});
      }
    } finally {
      // Luon reset co trong bo nho neu day van la phien hien tai, de "isScraping"
      // khong bao gio bi treo true mai sau 1 throw bat ngo.
      if (runId === runSerial) isScraping = false;
    }
  }

  function resetScrape() {
    runSerial++;
    isScraping = false;
    collected = [];
    lastCollected = [];
    seen.clear();
    idleCount = 0;
    videoPool = [];
    document.querySelectorAll('[data-scraped="1"]').forEach(el => { delete el.dataset.scraped; el.style.outline = ""; });
    chrome.storage.local.set({ scrapeCount: 0, scrapeStatus: t("sc.resetDone"), scrapeReady: false, scrapeHasData: false, isScraping:false, scrapeMediaCancel:true, scrapeMediaStatus:"" });
    chrome.storage.local.remove(["scrapePosts","scrapeTarget","scrapeRunSourceUrl","scrapeRequestedSourceUrl","scrapeSkipAds","scrapeStartedAt","scrapeMediaCount","scrapeVideoCount"]);
  }

  // tu dong tiep tuc sau reload - luu target de phuc hoi
  (async ()=>{
    const s = await chrome.storage.local.get(["isScraping","scrapeTarget","scrapeCountStored","scrapePosts","scrapeRunSourceUrl","scrapeSkipAds","scrapeSaveMedia","scrapeCommentsEnabled","scrapeMaxComments","scrapeOwnerTabId"]);
    if(s.scrapeOwnerTabId){
      try{
        const r=await chrome.runtime.sendMessage({action:"getSenderTabId"});
        const myId=r&&r.tabId;
        if(myId&&myId!==s.scrapeOwnerTabId)return;
      }catch{}
    }
    if(Array.isArray(s.scrapePosts)&&s.scrapePosts.length){lastCollected=s.scrapePosts.slice(-500);}
    scrapeCaptureMedia = s.scrapeSaveMedia !== false;
    scrapeWithComments = s.scrapeCommentsEnabled !== false;
    scrapeMaxComments = Math.max(1, Math.min(100000, parseInt(s.scrapeMaxComments) || 20));
    const sameSource=!!s.scrapeRunSourceUrl&&sourceKey(s.scrapeRunSourceUrl)===sourceKey(location.href);
    if(s.isScraping && s.scrapeTarget && sameSource){
      targetCount = s.scrapeTarget;
      skipSponsored = s.scrapeSkipAds !== false;
      console.log("[Scrape] Tu dong tiep tuc sau reload, target", targetCount);
      await new Promise(r=>setTimeout(r,2500));
      const live=await chrome.storage.local.get("isScraping");
      if(live.isScraping&&!isScraping){ isScraping=true; await chrome.storage.local.set({ isScraping:true }); scrapeLoop(true); }
    }else if(s.isScraping){
      // Cờ cũ từ nguồn khác không được phép khôi phục sang profile/page mới.
      await chrome.storage.local.set({isScraping:false,scrapeReady:false,scrapeHasData:false,scrapeCount:0});
      await chrome.storage.local.remove(["scrapePosts","scrapeTarget","scrapeRunSourceUrl","scrapeRequestedSourceUrl","scrapeSkipAds","scrapeStartedAt"]);
    }
  })();

  // Cầu nối page-world scrape-network.js: chỉ nhận URL video đã lọc, không
  // nhận payload/cookie/token. Các URL này được lưu vào dataset.videoPool để
  // người dùng tự quyết tải từ kho dữ liệu.
  window.addEventListener("message", (ev) => {
    const d = ev && ev.data ? ev.data : {};
    if (d.source !== "fb-auto-scrape-network" || d.kind !== "video-url") return;
    const url = String(d.url || "");
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (videoPool.length >= 100) return;
    // Phong thu sau cung: khong bao gio dua URL anh vao pool video.
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test(url.split("#")[0])) return;
    const norm = url.split(/[?#]/)[0].toLowerCase();
    if (!videoPool.some(v => String(v.url||"").split(/[?#]/)[0].toLowerCase() === norm)) videoPool.push({ url, capturedAt: Date.now() });
  });

  // Stop/Reset từ popup ghi storage trực tiếp trước, vì vậy listener này là
  // phương án an toàn khi chrome.tabs.sendMessage không tới tab đang chạy.
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.isScraping?.newValue===false){
      isScraping=false;
      runSerial++;
    }
  });

  // ── Nguồn bài Facebook (Page/Profile) cho Đăng tường & Đăng nhóm ──────────
  // Chỉ ĐỌC, không ghi ScrapeStore, không bật isScraping. Dùng lại parser của
  // scrape.js để selector bài/author/permalink/media luôn khớp nhau.
  function fbSourceCandidates(){
    const out=[],seenEl=new Set();
    const sels=['div[role="article"]','div[data-pagelet^="FeedUnit"]'];
    for(const sel of sels){
      for(const el of document.querySelectorAll(sel)){
        try{
          let target=el;
          if(el.getAttribute("data-pagelet")&&el.getAttribute("data-pagelet").startsWith("FeedUnit")){
            const art=el.querySelector('div[role="article"]');if(art)target=art;
          }
          if(target.getAttribute("data-ad-preview"))target=target.closest('div[role="article"]')||target;
          if(isCommentCandidate(target))continue;
          if(!seenEl.has(target)&&(target.innerText||"").trim().length>0){seenEl.add(target);out.push(target);}
        }catch(_){}
      }
    }
    const msgSels=['[data-ad-rendering-role="story_message"]','[data-ad-preview="message"]','[data-ad-comet-preview="message"]'];
    for(const sel of msgSels){
      for(const el of document.querySelectorAll(sel)){
        try{
          const target=postRootFor(el,sel);
          if(isCommentCandidate(target))continue;
          if(!seenEl.has(target)&&(target.innerText||"").trim().length>0){seenEl.add(target);out.push(target);}
        }catch(_){}
      }
    }
    return out;
  }
  function fbSourceTimeMs(text,el){
    try{
      const s=String(text||"").toLowerCase();
      // Ưu tiên text thời gian của CHÍNH bài (parseArticle đã lấy từ header);
      // abbr/time trong DOM có thể là của bài quote/comment cũ nằm lồng bên trong.
      const m=s.match(/(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm)/);
      if(m){
        const n=parseInt(m[1])||0,unit=m[2];
        const ms={phút:60e3,giờ:3600e3,ngày:86400e3,tuần:7*86400e3,tháng:30*86400e3,năm:365*86400e3}[unit]||0;
        if(ms)return Date.now()-n*ms;
      }
      const d=s.match(/(?:thứ\s*\w+\s*)?(\d{1,2})\s*(?:thg|tháng)\s*(\d{1,2})(?:\s*,?\s*(\d{4}))?/);
      if(d){
        const y=parseInt(d[3])||new Date().getFullYear();
        const ms=Date.parse(`${y}-${String(parseInt(d[2])).padStart(2,"0")}-${String(parseInt(d[1])).padStart(2,"0")}T00:00:00`);
        if(!isNaN(ms))return ms;
      }
      for(const n of el.querySelectorAll('abbr[data-utime], time[datetime]')){
        const u=n.getAttribute("data-utime");if(u)return parseInt(u)*1000;
        const dt=n.getAttribute("datetime");if(dt)return Date.parse(dt)||0;
      }
    }catch(_){}
    return 0;
  }
  function fbSourceParse(el){
    let data=null;
    try{
      delete el.dataset.scraped;
      data=parseArticle(el);
    }catch(_){}
    if(!data){el.dataset.scraped="1";return null;}
    el.dataset.scraped="1";
    const nested=[...el.querySelectorAll('div[role="article"]')].filter(a=>a!==el);
    const inNested=n=>nested.some(a=>a.contains(n));
    const imgEls=[...el.querySelectorAll('img[src*="scontent"]')]
      .filter(i=>(i.naturalWidth||0)>=250&&(i.naturalHeight||0)>=150)
      .sort((a,b)=>(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight));
    data.postImages=[...new Set(imgEls.filter(i=>!inNested(i)).map(i=>String(i.currentSrc||i.src||"")).filter(Boolean))].slice(0,20);
    data.quotedImages=[...new Set(imgEls.filter(i=>inNested(i)).map(i=>String(i.currentSrc||i.src||"")).filter(Boolean))].slice(0,20);
    const comments=[];
    try{collectVisibleComments(el,comments,3);}catch(_){}
    data.comments=comments;
    data.timeMs=fbSourceTimeMs(data.time,el);
    data.fbSource=true;
    return data;
  }
  async function fbSourceReadPosts(count){
    const want=Math.max(1,parseInt(count)||30);
    try{document.querySelectorAll('[data-scraped="1"]').forEach(el=>{delete el.dataset.scraped;});}catch(_){}
    const out=[],keys=new Set();
    const push=data=>{
      if(!data)return;
      const key=String(data.link||data.id||data.text||"").slice(0,200);
      if(!key||keys.has(key))return;
      keys.add(key);out.push(data);
    };
    try{window.scrollTo(0,0);}catch(_){}
    await new Promise(r=>setTimeout(r,600));
    let idle=0,lastLen=0;
    for(let round=0;round<10&&out.length<want;round++){
      try{expandSeeMore();}catch(_){}
      for(const el of fbSourceCandidates()){
        if(out.length>=want)break;
        push(fbSourceParse(el));
      }
      if(out.length>=want)break;
      try{window.scrollBy(0,Math.max(700,Math.floor(window.innerHeight*0.9)));}catch(_){}
      await new Promise(r=>setTimeout(r,1400));
      if(out.length===lastLen)idle++;else{idle=0;lastLen=out.length;}
      if(idle>=3)break;
    }
    return out;
  }
  function fbSourceFindRoot(){
    try{
      const msg=document.querySelector('[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"]');
      if(msg)return postRootFor(msg);
      const arts=[...document.querySelectorAll('div[role="article"]')].filter(a=>!isCommentCandidate(a));
      return arts[0]||null;
    }catch(_){return null;}
  }
  function fbSourceFindComment(root){
    if(!root)return null;
    try{
      const nested=[...root.querySelectorAll('div[role="article"]')].filter(a=>a!==root);
      for(const a of nested){if(looksLikeComment(a,root))return a;}
      const arts=[...document.querySelectorAll('div[role="article"]')];
      for(const a of arts){if(a!==root&&looksLikeComment(a,root))return a;}
    }catch(_){}
    return null;
  }
  function fbSourcePageRect(el){
    if(!el)return null;
    const r=el.getBoundingClientRect();
    const sx=window.scrollX||document.documentElement.scrollLeft||0;
    const sy=window.scrollY||document.documentElement.scrollTop||0;
    return {x:Math.max(0,r.left+sx),y:Math.max(0,r.top+sy),width:Math.max(1,Math.round(r.width)),height:Math.max(1,Math.round(r.height))};
  }
  async function fbSourceShotRect(includeComment){
    try{expandSeeMore();}catch(_){}
    const root=fbSourceFindRoot();
    if(!root)return {ok:false,error:"no-post"};
    let comment=null;
    if(includeComment){
      // Mở thread nếu đang đóng, rồi cuộn comment vào khung để media hydrate.
      try{
        for(const b of document.querySelectorAll('[role="button"]')){
          const t=(b.innerText||"").trim();
          if(/^(bình luận|comment|xem thêm bình luận|view more comments)$/i.test(t)&&!b.getAttribute("aria-expanded")){try{b.click();}catch(_){}}
        }
      }catch(_){}
      await new Promise(r=>setTimeout(r,800));
      comment=fbSourceFindComment(root);
      if(comment){try{comment.scrollIntoView({block:"center"});}catch(_){}await new Promise(r=>setTimeout(r,1200));}
    }
    try{root.scrollIntoView({block:"start"});}catch(_){}
    await new Promise(r=>setTimeout(r,700));
    const mainRect=fbSourcePageRect(root);
    let rect=mainRect;
    if(comment){
      const cRect=fbSourcePageRect(comment);
      if(cRect&&mainRect){
        const x=Math.min(mainRect.x,cRect.x),y=Math.min(mainRect.y,cRect.y);
        const x2=Math.max(mainRect.x+mainRect.width,cRect.x+cRect.width);
        const y2=Math.max(mainRect.y+mainRect.height,cRect.y+cRect.height);
        rect={x,y,width:Math.max(1,x2-x),height:Math.max(1,y2-y)};
      }
    }
    if(!rect)return {ok:false,error:"no-rect"};
    return {ok:true,rect,withComment:!!comment,dpr:window.devicePixelRatio||1,title:document.title||""};
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if(msg.action==="fbSourceReadPosts"){
      (async()=>{
        try{
          const posts=await fbSourceReadPosts(msg.count);
          sendResponse({ok:true,posts});
        }catch(e){sendResponse({ok:false,error:String(e?.message||e).slice(0,160)});}
      })();
      return true;
    }
    if(msg.action==="fbSourceShotRect"){
      (async()=>{
        try{sendResponse(await fbSourceShotRect(!!msg.includeComment));}
        catch(e){sendResponse({ok:false,error:String(e?.message||e).slice(0,160)});}
      })();
      return true;
    }
    if (msg.action === "startScrape") {
      // Bắt đầu nguồn mới luôn thay thế phiên cũ (kể cả phiên khôi phục bị treo).
      if(msg.sourceUrl && sourceKey(msg.sourceUrl)!==sourceKey(location.href)){
        sendResponse({ok:false,error:t("sc.leftSource")});
        return true;
      }
      if (isScraping) isScraping=false;
      targetCount = Math.max(1, parseInt(msg.count) || 20);
      skipSponsored = msg.skipAds !== false;
      scrapeCaptureMedia = msg.saveMedia !== false;
      scrapeWithComments = msg.withComments !== false;
      scrapeMaxComments = Math.max(1, Math.min(100000, parseInt(msg.maxComments) || 20));
      videoPool = [];
      chrome.storage.local.set({ isScraping: true, scrapeTarget: targetCount, scrapeSkipAds:skipSponsored, scrapeSaveMedia:scrapeCaptureMedia, scrapeCommentsEnabled:scrapeWithComments, scrapeMaxComments, scrapeRunSourceUrl:sourceKey(location.href), scrapeRequestedSourceUrl:msg.sourceUrl||sourceKey(location.href), scrapeStartedAt:Date.now() });
      chrome.storage.local.remove(["scrapeMediaCancel","scrapeMediaCount","scrapeVideoCount","scrapeMediaStatus"]);
      scrapeLoop(false);
      sendResponse({ ok: true });
    } else if (msg.action === "stopScrape") {
      isScraping = false;
      runSerial++;
      chrome.storage.local.set({ scrapeStatus: t("sc.stopped"), isScraping:false, scrapeMediaCancel:true });
      chrome.storage.local.remove(["scrapeTarget"]);
      if (collected.length) persistRunToStore([...collected]).then(saved=>{ if(saved) chrome.storage.local.set({ scrapeDatasetId: saved.id }); }).catch(()=>{});
      sendResponse({ ok: true });
    } else if (msg.action === "resetScrape") {
      resetScrape();
      sendResponse({ ok: true });
    } else if (msg.action === "downloadScrape") {
      doDownload(msg.format, msg.scope).then(ok => {
        sendResponse({ ok, reason:lastDownloadReason, count: (collected.length || lastCollected.length) });
      }).catch(() => sendResponse({ ok:false, reason:"error", count:0 }));
    } else if (msg.action === "getScrapeData") {
      (async()=>{
        const saved=await chrome.storage.local.get("scrapePosts");
        const data=collected.length?collected:(lastCollected.length?lastCollected:(Array.isArray(saved.scrapePosts)?saved.scrapePosts:[]));
        sendResponse({ok:true,posts:data.slice(-500),count:data.length});
      })();
    } else if (msg.action === "getScrapeStatus") {
      sendResponse({ isScraping, count: collected.length, ready: collected.length > 0 || lastCollected.length > 0 });
    }
    return true;
  });

  console.log("[Scrape] scrape.js loaded v1.9.363-c2");
})();
