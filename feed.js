// feed.js - Tuong tac ban tin + Comment AI
(() => {
  // Nhật ký hoạt động bền vững: mỗi lần một tính năng chạy dài (đăng nhóm,
  // tương tác nhóm, comment AI...) dừng giữa chừng, groupPostStatus/... chỉ
  // là dòng trạng thái TẠM THỜI bị đè ngay khi có hành động tiếp theo — không
  // còn cách nào tra lại SAU KHI nó đã dừng. Ghi mọi mốc quan trọng (bắt đầu,
  // lỗi, bỏ qua, dừng hẳn, hoàn tất) vào một mảng persist trong storage để
  // popup có thể hiển thị lại và người dùng dò được dừng ở đâu, vì sao.
  async function logActivity(feature,msg){
    try{
      const {activityLog}=await chrome.storage.local.get("activityLog");
      const log=Array.isArray(activityLog)?activityLog:[];
      log.push({t:Date.now(),feature,msg:String(msg||"").slice(0,300)});
      if(log.length>500)log.splice(0,log.length-500);
      await chrome.storage.local.set({activityLog:log});
    }catch(_){}
  }
  let isFeedInteracting = false;
  let feedCount = 0, feedTarget = 20;
  let feedMinDelay = 3000, feedMaxDelay = 8000;
  let feedReaction = "random";

  let isAICommenting = false;
  let aiCount = 0, aiTarget = 10;
  let aiMinDelay = 10000, aiMaxDelay = 20000;
  let aiEconomyMode="balanced",aiBatchSize=5,aiCacheDays=7;
  // Hồ sơ AI của phiên Comment độc lập (tab AI gán) — resume đọc lại từ config.
  let aiRunProfile={};
  // Chế độ chạy của tab AI (comment/comment-like/like) + reaction cho Like.
  // Trước đây startAIComment không lưu mode nên tab chọn Like vẫn chạy loop
  // comment (bắt live: chọn like nhưng vẫn đăng comment) — đã chốt lưu/khôi
  // phục đầy đủ như các cấu hình khác.
  let aiRunMode="comment",aiReactionPref="like";
  // Cờ like-sau-comment của phiên (trước đây chỉ gán mà không khai báo → toàn cục ngầm).
  let aiLikeAfterComment=false;
// Prompt thường (không tag) của phiên — trước đây content script không mang
// theo nên background luôn dùng prompt legacy toàn cục, bài tab cấu hình bị
// bỏ qua (bắt live: comment kém bám sát dù prompt đã gửi).
let aiBasePrompt="";
  let aiTypingConfig=normalizeAiTypingConfig({mode:AI_TYPING_DEFAULT_MODE});
  let aiTagConfig=null;
  const tagSeqMap=new Map();
  function pickTagEntity(tagConfig){
    if(!tagConfig)return null;
    if(tagConfig.entities?.length){
      const arr=tagConfig.entities;
      if(tagConfig.mode==="rand")return arr[Math.floor(Math.random()*arr.length)];
      const key=arr.map(e=>e.url).join("|");
      const idx=(tagSeqMap.get(key)||0)%arr.length;
      tagSeqMap.set(key,idx+1);
      return arr[idx];
    }
    return tagConfig.page?.name?tagConfig.page:(tagConfig.group?.name?tagConfig.group:null);
  }
  // Luân phiên vị trí đặt tên entity trong câu comment (mở đầu/giữa/cuối) để
  // mention rải đều vị trí thay vì dồn cuối. Gắn hậu tố chỉ dẫn cụ thể vào prompt
  // (AI không tự đa dạng khi chỉ dặn chung chung — đã verify live: toàn dồn cuối).
  const TAG_POSITIONS=["open","mid","close"];
  let tagPositionIdx=0;
  function buildTagPrompt(basePrompt,entityName){
    let p=String(basePrompt||"").replace(/\{tagName\}/g,entityName||"");
    if(!entityName)return p;
    // Dệt khéo (user 29/10: tag phải tự nhiên, sát bài): tên là một phần ngữ
    // pháp của câu (rủ/tag bạn cùng quan tâm đúng chủ đề bài, hỏi ý entity),
    // cấm thả tên trơ trụi cuối câu không liên quan; comment phải nêu một chi
    // tiết cụ thể trong bài, cấm chung chung.
    p+=' Tên "'+entityName+'" phải hòa vào câu một cách tự nhiên như đang rủ đúng người cùng quan tâm chủ đề bài viết (ví dụ hỏi ý, rủ xem, nhờ chia sẻ kinh nghiệm đúng chủ đề), tuyệt đối không thả tên trơ trụi không liên quan. Viết đúng 2 câu (câu 2 là chỗ nhắc tên), mỗi câu phải nhắc tới một chi tiết cụ thể trong bài, không viết chung chung.';
    // Chỉ dẫn vị trí đặt TRƯỚC prompt (AI tuân thủ đầu prompt tốt hơn cuối).
    // Xoay vòng open/mid/close để rải đều thay vì random (random dễ dồn cụm).
    const slot=TAG_POSITIONS[tagPositionIdx%TAG_POSITIONS.length];
    tagPositionIdx++;
    if(slot==="open")return 'Câu nhắc đến "'+entityName+'" phải MỞ ĐẦU bằng chính tên này (đặt tên ở đầu câu). '+p;
    if(slot==="mid")return 'Tên "'+entityName+'" phải đứng GIỮA câu (có chữ trước và sau tên). '+p;
    return 'Câu nhắc đến "'+entityName+'" phải KẾT THÚC bằng chính tên này (được thêm dấu chấm hoặc dấu cảm ngay sau tên cho câu trọn vẹn). '+p;
  }
  // Tên entity chung chung ("Đoạn chat", "Tin nhắn", "Trang chủ"...) là bằng
  // chứng resolver lấy nhầm nhãn UI thay vì tên Page/Nhóm thật (bắt live Bảng
  // tin: URL page ToNgheMeme bị lưu tên "Đoạn chat" rồi @tag bừa vào thread
  // chat lạ). Những tên này không bao giờ được tag — thà bỏ tag còn hơn tag sai.
  function isGenericTagName(name){
    const norm=String(name||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLocaleLowerCase("vi");
    if(!norm||norm.length<3||/^\d+$/.test(norm))return true;
    // Mốc thời gian ("1 phút", "5h") không bao giờ là tên tag được.
    if(/^\d+\s*(?:phút|phut|giờ|gio|giây|giay|ngày|ngay|tuần|tuan|tháng|thang|năm|nam|sec(?:onds?)?|s|min(?:ute)?s?|m|h(?:ours?|rs?)?|d(?:ays?)?|w(?:eeks?)?|mo(?:nths?)?|y(?:ears?)?)$/i.test(norm))return true;
    return /^(đoạn chat(?: chung)?|cuộc trò chuyện|tin nhắn|hộp thư|chat|conversation|messenger|trang chủ|bảng tin|news feed|home|xem thêm|see more|tìm kiếm|tất cả|all|mới nhất|most recent|recent|ảnh|hình ảnh|video|photos?|videos?|reels?|nhóm|group|trang|page|bài viết|posts?|bình luận|comment|thích|like|chia sẻ|share|theo dõi|follow|giới thiệu|about|sự kiện|events?|thông báo|notifications?|cài đặt|settings?|quảng cáo|ads?)$/i.test(norm);
  }
  // Quyết định TRƯỚC khi sinh comment: bài này có được gắn tag hay không,
  // theo đúng tỉ lệ % cấu hình (tagConfig.rate). Phải gọi hàm này TRƯỚC khi
  // chọn prompt (tag/thường) — nếu chỉ áp tỉ lệ ở bước chèn @mention như cũ,
  // AI vẫn dùng prompt tag và nhét tên page vào câu dù cuối cùng không tag,
  // khiến các bài "không tag" đọc lên vẫn gượng ép, không tự nhiên.
  function decideTagForPost(tagConfig,decisionIndex=null){
    const entity=pickTagEntity(tagConfig);
    if(!entity?.name)return null;
    if(isGenericTagName(entity.name)){
      try{logActivity("tag","@tag bỏ qua (generic-name: \""+String(entity.name).slice(0,40)+"\" giống nhãn UI, không phải tên Page/Nhóm)");}catch(_){}
      return null;
    }
    // Slider cho phép 0% (bật tag nhưng không gắn) nên không được dùng `||70`
    // (0||70 thành 70% — bug live). Chỉ fallback 70 khi thiếu/không phải số.
    const rateRaw=Number(tagConfig.rate);
    const rate=(Number.isFinite(rateRaw)?Math.max(0,Math.min(100,rateRaw)):70)/100;
    if(Number.isInteger(decisionIndex)&&decisionIndex>=0){
      const before=Math.floor(decisionIndex*rate);
      const after=Math.floor((decisionIndex+1)*rate);
      if(after<=before)return null;
    }else if(Math.random()>rate)return null;
    return entity;
  }
  // A 100% tag run is an explicit verification/strict mode.  Never publish a
  // plain comment if Facebook did not confirm the mention in that mode.
  function tagProofRequired(tagConfig){
    return Number(tagConfig?.rate) >= 100;
  }
  // Entity nhóm: lột {tagName} xong phải dọn nốt câu dệt tag dở dang còn lại
  // (VD "lồng ghép tự nhiên ..." — không để AI nhận lệnh nhắc tên rỗng).
  function stripTagWeaveForGroup(prompt){
    let p=String(prompt||"").replace(/\{tagName\}/g,"").replace(/""/g,"");
    p=p.split(/(?<=[.!?…])\s+/).filter(s=>{
      const t=String(s||"").trim();
      if(!t)return false;
      return !/lồng ghép|nhắc đến|đề cập|mention|weave|gắn tag|chèn tag|đặt tên ở/i.test(t);
    }).join(" ").replace(/\s{2,}/g," ").trim();
    return p;
  }
  // Tag prompt có thể khiến model tự viết tên entity vào câu. Nếu Facebook
  // không đưa entity vào autocomplete, tên đó không được để rơi lại thành
  // plain text (trông như đã tag nhưng thực tế không có mention). Mention
  // thật vẫn do appendTagMention chèn và verify bằng DOM/ID riêng.
  function stripLiteralTagEntity(text, entityName){
    const name=String(entityName||"").trim();
    if(!name)return String(text||"");
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return String(text||"")
      .replace(new RegExp(`(^|\\s)${escaped}(?=\\s|[,.!?;:…]|$)`,'giu'),"$1")
      .replace(/[ \t]{2,}/g," ")
      .replace(/\s+([,.!?;:…])/g,"$1")
      .trim();
  }
  // Chỉ theo dõi composer do Comment AI vừa mở và nhập. Không đụng vào
  // composer người dùng chưa được luồng này sở hữu.
  let aiCommentDraftBox=null, aiCommentDraftScope=null;
  let aiCommentDraftIdentity="", aiCommentDraftSignature="";
  let aiCommentDraftExpectedText="";
  let aiActivationActive=false,aiActivationBox=null,aiActivationScope=null;

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
  // Mọi lượt gọi AI đều qua sendMessage tới service worker. SW có deadline
  // nội bộ (~140s) nên verdict (kể cả lỗi) luôn về trước — TRỪ khi SW bị
  // Chrome thu hồi giữa chừng khiến response mất hẳn: await trần sẽ treo
  // vĩnh viễn, cờ chạy vẫn true mà status đóng băng (bắt live luồng AI
  // 10/10: kẹt 13 phút ở "post" không heartbeat). Race 150s để luôn có lối
  // thoát về fallback; response muộn (nếu có) bị bỏ qua, không tác dụng phụ
  // vì sinh comment không ghi gì trước khi caller dùng nó.
  function sendAiMessageWithTimeout(message,timeoutMs=150000){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("AI quá 150 giây không trả lời (kênh nền mất phản hồi)")),timeoutMs);});
    return Promise.race([chrome.runtime.sendMessage(message),timeout]).finally(()=>clearTimeout(timer));
  }
  // Heartbeat vòng Comment AI: mỗi nhịp ghi stage+thời gian. Nếu loop chết
  // bất thường (exception/treo await), cờ isAICommenting vẫn true và status
  // đóng băng mãi — load-time check bên dưới sẽ chốt dừng an toàn thay vì treo.
  async function aiHeartbeat(stage){
    try{await chrome.storage.local.set({aiHeartbeat:{stage:String(stage||"").slice(0,40),at:Date.now()}});}catch(_){}
  }
  // Quy tắc DỪNG BẰNG MỌI GIÁ + chống chạy trùng: resume sau reload chỉ chạy
  // trên đúng tab sở hữu. Tab khác thấy cờ nhưng bỏ qua (Dừng thì dọn cờ).
  async function runOwnedByThisTab(ownerTabId){
    if(!ownerTabId)return true;
    try{
      const r=await chrome.runtime.sendMessage({action:"getSenderTabId"});
      const myId=r&&r.tabId;
      return !myId||myId===ownerTabId;
    }catch{return true;}
  }
  function setAiDelayRange(minValue,maxValue){
    const minSec=Math.max(1,parseInt(minValue)||10);
    const maxSec=Math.max(1,parseInt(maxValue)||20);
    aiMinDelay=Math.min(minSec,maxSec)*1000;
    aiMaxDelay=Math.max(minSec,maxSec)*1000;
  }
  function aiCommentRunConfig(extra={}){
    return {target:aiTarget,minDelay:aiMinDelay/1000,maxDelay:aiMaxDelay/1000,economyMode:aiEconomyMode,batchSize:aiBatchSize,cacheDays:aiCacheDays,typingConfig:normalizeAiTypingConfig(aiTypingConfig),aiConfig:aiRunProfile||{},prompt:aiBasePrompt||"",tagConfig:aiTagConfig||null,mode:aiRunMode,reaction:aiReactionPref,...extra};
  }
  async function persistAICommentStop(status){
    const message=String(status||t("ai2.stoppedPost")).slice(0,500);
    isAICommenting=false;
    await chrome.storage.local.set({
      isAICommenting:false,
      pendingAIComment:false,
      aiActiveConfig:null,
      aiNextAllowedAt:0,
      aiFeedReloadAttempts:0,
      aiStatus:message
    });
  }
  function isRenderedElement(el){
    if(!el?.isConnected || el.getClientRects().length===0) return false;
    const style=getComputedStyle(el);
    if(style.display==="none" || style.visibility==="hidden" || style.visibility==="collapse" || Number(style.opacity)===0) return false;
    const r=el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  }
  function commentCacheKey(text){let h=2166136261;for(const c of String(text).slice(0,500)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return "p"+(h>>>0).toString(36);}
  function postContentKey(text){
    const normalized=String(text||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g," ").replace(/\s+/g," ").trim().toLowerCase();
    return normalized.length>=15?commentCacheKey(normalized):"";
  }
  // Sổ cái chống đăng trùng chéo phiên/tag-không-tag: khóa theo 120 ký tự đầu
  // nội dung bài (ổn định qua mọi markup, không phụ thuộc permalink/DOM).
  async function postSigMarked(text){
    try{
      const s=String(text||"").replace(/\s+/g," ").trim().toLowerCase().slice(0,120);
      if(s.length<20)return false;
      const {postedSignatures}=await chrome.storage.local.get("postedSignatures");
      const arr=Array.isArray(postedSignatures)?postedSignatures:[];
      return arr.some(e=>e&&e.sig===s);
    }catch(_){return false;}
  }
  async function markPostSig(text){
    try{
      const s=String(text||"").replace(/\s+/g," ").trim().toLowerCase().slice(0,120);
      if(s.length<20)return;
      const {postedSignatures}=await chrome.storage.local.get("postedSignatures");
      const arr=Array.isArray(postedSignatures)?postedSignatures:[];
      if(!arr.some(e=>e&&e.sig===s)){arr.push({sig:s,t:Date.now()});if(arr.length>2000)arr.splice(0,arr.length-2000);await chrome.storage.local.set({postedSignatures:arr});}
    }catch(_){}
  }
  // Chốt chặn cuối trước khi đăng: loại U+FFFD và surrogate lẻ (emoji bị chẻ)
  // để comment không dính ký tự lỗi và không bị Facebook từ chối.
  function sanitizeCommentOutput(value){
    return String(value||"")
      .replace(/\uFFFD/g,"")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g,"")
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,"");
  }
  function fallbackComment(text){const lowerText=String(text).toLowerCase();const pools=lowerText.match(/tuyển dụng|việc làm|ứng tuyển|job|hiring|career|apply/i)?[t("ai.fb.hire1"),t("ai.fb.hire2")]:lowerText.match(/bán|giá|sản phẩm|mua|buy|price|product|sale|shop/i)?[t("ai.fb.sale1"),t("ai.fb.sale2")]:lowerText.match(/công nghệ|ai|máy tính|phần mềm|tech|software|computer|gadget/i)?[t("ai.fb.tech1"),t("ai.fb.tech2")]:[t("ai.fb.gen1"),t("ai.fb.gen2"),t("ai.fb.gen3")];return pools[Math.floor(Math.random()*pools.length)];}

  async function trustedMouse(el, kind, isStillActive){
    if(isStillActive&&!await isStillActive())return false;
    if(!isRenderedElement(el)) return false;
    try {
      el.scrollIntoView({behavior:"instant",block:"center"});
    } catch {
      try { el.scrollIntoView({behavior:"smooth",block:"center"}); } catch {}
    }
    await sleep(200);
    if(isStillActive&&!await isStillActive())return false;
    const r=el.getBoundingClientRect();
    const x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
    let debuggerOk = false;
    if(x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight){
      const hit=document.elementFromPoint(x,y);
      if(hit && (hit===el || el.contains(hit) || hit.contains(el))){
        try{
          const res=await chrome.runtime.sendMessage({action:"trustedMouse",kind,x,y});
          if(res?.ok) debuggerOk = true;
        }catch(_){}
      }
    }
    if(debuggerOk) return true;
    try {
      if(kind==="click") {
        el.focus();
        el.click();
      } else if (kind==="hover") {
        el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
        el.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
      }
      return true;
    } catch {
      return false;
    }
  }

  const REACTION_LABELS = {
    like: ["Thích","Like"],
    love: ["Yêu thích","Love"],
    haha: ["Haha"],
    wow: ["Wow","Ngạc nhiên"],
    sad: ["Buồn","Sad"],
    angry: ["Phẫn nộ","Angry","Giận dữ"]
  };
  function findReactionBtn(type){
    const labels = REACTION_LABELS[type]||[];
    // FB moi dat cac nut trong dialog "Cam xuc", moi nut co wrapper rieng nen
    // khong the dem sibling nhu giao dien cu.
    const picker = document.querySelector('[role="dialog"][aria-label="Cảm xúc"], [role="dialog"][aria-label="Reactions"]');
    if(!picker) return null;
    const all = [...picker.querySelectorAll('[role="button"][aria-label], div[aria-label]')];
    for(const lab of labels){
      for(const btn of all){
        const lb=(btn.getAttribute("aria-label")||"").trim();
        if(lb!==lab) continue;
        if(!isRenderedElement(btn)) continue;
        return btn;
      }
    }
    return null;
  }
  async function doReact(btn, type, isStillActive){
    const t = type==="random" ? ["like","love","haha","wow","sad","angry"][Math.floor(Math.random()*6)] : type;
    if(t==="like"){
      if(!await trustedMouse(btn,"click",isStillActive)) return {used:t,success:false};
      await sleep(900);
      const changed=!btn.isConnected || !isLabel(btn,["thích","thich","like"]);
      return {used:t,success:changed};
    }
    // Dung su kien chuot that qua trinh duyet; Facebook bo qua click gia lap.
    for(let attempt=0;attempt<2;attempt++){
      if(!await trustedMouse(btn,"hover",isStillActive)) return {used:t,success:false};
      await sleep(1100);
      const rBtn=findReactionBtn(t);
      if(!rBtn) continue;
      if(!await trustedMouse(rBtn,"click",isStillActive)) continue;
      await sleep(1000);
      const labels=REACTION_LABELS[t]||[];
      const state=(btn.getAttribute("aria-label")||"").toLowerCase();
      const changed=!btn.isConnected || labels.some(x=>state.includes(x.toLowerCase()));
      if(changed) return {used:t,success:true};
    }
    return {used:t,success:false};
  }

  function isInCommentLike(btn){
    if(btn.closest('ul')) return true;
    if(btn.closest('div[aria-label*="Bình luận"]') && !btn.closest('div[role="article"]')?.querySelector('div[role="button"][aria-label*="Like"]')?.contains(btn)) {
      // neu nam trong vung binh luan va khong phai action bar chinh
    }
    // cach chac chan: neu btn nam trong 1 comment item (co avatar nho + "Trả lời")
    let cur = btn.parentElement;
    for(let i=0;i<6 && cur; i++){
      if(cur.innerText && cur.innerText.includes("Trả lời") && cur.innerText.includes("Thích")) {
        // neu container chua ca Thich + Tra loi thi la comment like
        if(cur.querySelector('span') && cur.innerText.length < 200) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function buttonLabel(btn){
    return ((btn.getAttribute("aria-label")||btn.innerText||btn.textContent||"").trim().toLowerCase());
  }

  function isMainCommentActionLabel(value){
    const label=typeof value==="string" ? value.trim().toLowerCase() : buttonLabel(value);
    if(!label) return false;
    // Facebook dùng aria-label dạng "Bình luận dưới tên ..." cho từng
    // comment con. Đây không phải nút comment của bài viết gốc.
    if(/^(?:bình luận|comment)\s+(?:dưới|vào|của|by|on|to)\b/i.test(label)) return false;
    if(/^(?:bình luận|viết bình luận|comment|write a comment)(?:\s+.*)?$/i.test(label)) return true;
    if(/^(?:viết|đăng)\s+bình luận/i.test(label)) return true;
    return label==="bình luận" || label==="comment";
  }

  function isMainLikeActionLabel(value){
    const label=typeof value==="string" ? value.trim().toLowerCase() : buttonLabel(value);
    if(!label)return false;
    // Facebook hiện dùng aria-label dạng "Bày tỏ cảm xúc Thích về bài viết
    // ..." thay vì chỉ "Thích"/"Like". Chỉ cần nhận đúng thanh action của
    // bài viết; không dựa vào class hash vốn đổi theo mỗi lần Facebook render.
    return /(?:^|\s)(?:thích|thich|like)(?:\s|$)/i.test(label)
      && !/(?:bình luận|comment|trả lời|reply)/i.test(label);
  }

  function isLabel(btn, labels){
    const label=buttonLabel(btn);
    return labels.some(x=>label===x || label.startsWith(x+" "));
  }

  function findMainActionBar(likeBtn){
    if(!likeBtn) return null;
    let node=likeBtn.parentElement;
    for(let depth=0; depth<6 && node; depth++, node=node.parentElement){
      const buttons=[...node.querySelectorAll('[role="button"]')];
      const hasComment=buttons.some(b=>{ const l=buttonLabel(b); return l.includes("bình luận")||l.includes("comment"); });
      const hasLikeOrShare=buttons.some(b=>{ const l=buttonLabel(b); return l.includes("thích")||l.includes("like")||l.includes("chia sẻ")||l.includes("share"); });
      if(hasComment && hasLikeOrShare) return node;
    }
    return likeBtn.parentElement?.parentElement || null;
  }

  function findFeedPostContainer(btn){
    if(!btn) return null;
    const semantic=btn.closest('[data-pagelet^="FeedUnit_"], div[role="article"], div[aria-describedby]');
    if(semantic) return semantic;

    // Facebook hiện tại có nhiều bài không còn data-pagelet/role="article".
    // Ba parent cố định trước đây thường chỉ là thanh Like/Comment (text rất
    // ngắn), làm extension tưởng bài không có nội dung rồi tải bài khác.
    let best=null;
    let node=btn.parentElement;
    for(let depth=0;depth<22&&node;depth++,node=node.parentElement){
      const text=(node.innerText||"").trim();
      const hasPermalink=!!findPostPermalink(node);
      const buttons=[...node.querySelectorAll('[role="button"]')];
      const hasLike=buttons.some(b=>isMainLikeActionLabel(b)||b.getAttribute("data-ad-rendering-role")==="like_button");
      const hasComment=buttons.some(b=>isMainCommentActionLabel(buttonLabel(b)));
      if(hasPermalink&&hasLike&&hasComment&&text.length>=15) return node;
      if(hasLike&&hasComment&&text.length>=60&&!best) best=node;
    }
    return best||btn.parentElement?.parentElement?.parentElement||btn.parentElement;
  }
  function findGroupCommentPostContainer(btn){
    if(!btn)return null;
    const semantic=btn.closest('[data-pagelet^="FeedUnit_"], div[role="article"], div[aria-describedby]');
    if(semantic)return semantic;
    let best=null,node=btn.parentElement;
    for(let depth=0;depth<24&&node;depth++,node=node.parentElement){
      const text=String(node.innerText||"").trim();
      const hasPermalink=!!findPostPermalink(node);
      const labels=[...node.querySelectorAll('[role="button"]')].map(buttonLabel);
      const hasReaction=labels.some(label=>/(?:thích|like|tym|love|haha|wow|buồn|sad|phẫn nộ|angry|gỡ|thay đổi cảm xúc|change reaction)/i.test(label));
      const hasComment=labels.some(isMainCommentActionLabel);
      if(hasPermalink&&hasReaction&&hasComment&&text.length>=15)return node;
      if(hasReaction&&hasComment&&text.length>=60&&!best)best=node;
    }
    return best||btn.parentElement;
  }
  function findGroupCommentPosts(){
    const posts=[],seen=new Set(),seenIds=new Set();
    const candidates=[...document.querySelectorAll('[role="button"], [aria-label*="bình luận" i], [aria-label*="comment" i]')]
      .filter(btn=>isRenderedElement(btn)&&!btn.closest('ul')&&isMainCommentActionLabel(buttonLabel(btn)));
    for(const btn of candidates){
      const post=findGroupCommentPostContainer(btn);
      if(!post||seen.has(post)||post.dataset.aiGcommentDone==="1"||isSponsoredPost(post,{ignoreGenericPreview:true})||post.querySelector('a[href*="/reel/"],a[href*="/watch/"]'))continue;
      // Khi lớp chi tiết "Bài viết" đang mở, cùng một bài xuất hiện hai lần
      // (card dưới feed + hộp thoại overlay). Chặn trùng theo identity ngay
      // từ khâu quét để không sinh hai comment khác nhau chồng lên cùng bài.
      let pid="";
      try{pid=postIdentity(post)||"";}catch(_){pid="";}
      if(pid&&seenIds.has(pid))continue;
      post._commentBtn=btn;seen.add(post);if(pid)seenIds.add(pid);posts.push(post);
    }
    return posts;
  }

  function isSponsoredPost(article,options={}){
    if(!article) return false;
    // Chuẩn hoá: xoá ký tự zero-width (soft-hyphen, CGJ, ZWSP, ZWJ, WJ, BOM, line/para sep).
    const normalizeAdMarker=value=>String(value||"")
      .replace(/[\u00AD\u034F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g,"")
      .replace(/\s+/g," ").trim();
    const isAdMarker=value=>/^(?:được tài trợ|sponsored|quảng cáo|advertisement|ad)$/i.test(normalizeAdMarker(value));
    // Kiểm tra link quảng cáo — bổ sung /adchoices và /privacy_sandbox
    if(article.querySelector([
      'a[href*="/ads/about"]',
      'a[href*="facebook.com/ads/about"]',
      'a[href*="facebook.com/about/ads"]',
      'a[href*="/ads/library"]',
      'a[href*="/adpreferences"]',
      'a[href*="/adchoices"]',
      'a[href*="facebook.com/ads"]',
      'a[href*="/privacy_sandbox/browsing_topics"]',
    ].join(','))) return true;
    if(!options.ignoreGenericPreview&&article.querySelector('[data-ad-comet-preview], [data-ad-preview]')) return true;
    // aria-label + title rộng hơn, bắt cả partial match
    if(article.querySelector([
      '[aria-label="Được tài trợ" i]',
      '[aria-label="Sponsored" i]',
      '[aria-label="Quảng cáo" i]',
      '[aria-label*="nội dung được tài trợ" i]',
      '[aria-label*="được tài trợ" i]',
      '[aria-label*="sponsored" i][role="link"]',
      '[title="Được tài trợ" i]',
      '[title="Sponsored" i]',
    ].join(','))) return true;

    const headerCands = article.querySelectorAll('h2, h3, h4, h5, [role="heading"], span[dir="auto"]');
    for(const h of headerCands){
      const t = (h.innerText || h.textContent || "").trim();
      if(isAdMarker(t)){
        if(t.length < 25) return true;
      }
    }
    // aria-labelledby — link ký tự zero-width trỏ tới node văn bản ẩn.
    for(const labeled of article.querySelectorAll('[aria-labelledby]')){
      const ids=String(labeled.getAttribute('aria-labelledby')||"").split(/\s+/).filter(Boolean);
      const labelText=ids.map(id=>document.getElementById(id)?.innerText||document.getElementById(id)?.textContent||"").join(" ");
      if(isAdMarker(labelText))return true;
    }
    // Visible markers: cho phép children.length<=3 (bắt [icon]+[text]+[dot])
    const visibleMarkers=article.querySelectorAll('span, a, [role="link"], [role="text"]');
    for(const marker of visibleMarkers){
      if(!isRenderedElement(marker)||marker.children.length>3)continue;
      const t=normalizeAdMarker(marker.innerText||marker.textContent||"");
      if(isAdMarker(t)&&t.length<25)return true;
    }
    // Node ẩn có textContent sạch (innerText rỗng vì bị clip 0×0).
    for(const marker of article.querySelectorAll('span, div, a, [role="link"], [role="text"]')){
      if(marker.children.length>3)continue;
      const t=normalizeAdMarker(marker.textContent||"");
      if(t.length<25&&isAdMarker(t))return true;
    }
    // Nhãn bị xáo trộn ký tự (Facebook CSS order trick): dựng lại chuỗi hiển
    // thị từ leaf node trong vùng header ≤250px.
    try{
      const box=article.getBoundingClientRect();
      const leaves=[];
      for(const el of article.querySelectorAll('span,a,[role="text"]')){
        if(el.children.length!==0)continue;
        const tc=(el.textContent||"").replace(/[\u00AD\u034F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g,"");
        if(!tc||tc.length>5)continue;
        if(!isRenderedElement(el))continue;
        const r=el.getBoundingClientRect();
        if(r.top-box.top>250)continue;
        if(r.left<box.left-8||r.right>box.right+8)continue;
        leaves.push({t:tc,x:r.left,y:r.top});
        if(leaves.length>=180)break;
      }
      leaves.sort((a,b)=>Math.abs(a.y-b.y)>4?a.y-b.y:a.x-b.x);
      const assembled=leaves.map(o=>o.t).join("").replace(/\s+/g,"").toLocaleLowerCase("vi");
      if(/sponsored|đượctàitrợ|quảngcáo/.test(assembled))return true;
    }catch(_){}
    return false;
  }
  // Bài bán hàng organic (không có marker tài trợ nên isSponsoredPost không
  // bắt): yêu cầu 1 dấu hiệu rất mạnh, hoặc ≥2 dấu hiệu mạnh — giá đơn lẻ
  // không đủ (bảo vệ bài thảo luận thị trường có con số). Bắt live 15/10: AI
  // comment vào 6 bài rao (nhãn $125, livestream Viettel, sữa 390k, tuyển dụng,
  // hạt kê freeship, pass Sony).
  function isSalesLikePostText(text){
    const t=String(text||"").toLowerCase();
    if(t.length<20)return false;
    const veryStrong=[
      /(?:\+84|0)(?:[\s.]?\d){9}\b/,
      /tuyển\s+(dụng|nhân viên|người|pha chế|phục vụ|bảo vệ|shipper|ctv|đại lý|cộng tác)/,
      /\blương\s*\d/,
      /inbox\s+(đặt|mua|chốt|ngay|liền|giá|shop)/,
      /\bib\b.*(đặt|mua|chốt|giá|ship|shop)/,
      /sỉ\s*(và|&|,)?\s*lẻ|lẻ\s*sỉ/,
      /freeship|free\s*ship|miễn phí ship|bao ship|ship (toàn|mọi|khắp)/,
      /chốt đơn|chốt bill|cọc (trước|giúp|bill|đơn)/,
      /livestream.*(bán|giá|săn|chốt|mua)/,
      /pass\s+.*(\d|giá|tr\b|k\b)/,
    ];
    if(veryStrong.some(re=>re.test(t)))return true;
    const strong=[
      /giá(\s*(chỉ|còn|bán|niêm yết))?\s*[\d]/,
      /\d[\d.,]*\s*(k\b|tr\b|triệu|tỷ|vnđ|vnd|\$|usd)(\b|\s)/,
      /\b(bán|thanh lý|xả (hàng|kho)|sale off|giảm giá)\b/,
      /\b(ship|giao hàng|vận chuyển)\b/,
      /bảo hành\s*\d+\s*tháng/,
      /sẵn hàng|còn hàng|hàng (mới )?về|về (thêm|lô|hàng)/,
      /\border\b|\bđặt hàng\b/,
      /zalo|shopee|tiktokshop|lazada/,
      /tuyển/,
    ];
    let n=0;
    for(const re of strong)if(re.test(t)){n++;if(n>=2)return true;}
    return false;
  }
  // Comment dở dang (AI đang sinh bị chộp giữa chừng): "Mình đang",
  // "Tôi đang viết một câu bình..." (bắt live 15/10, đã đăng thật 2 bài).
  function isPartialAiComment(text){
    const t=String(text||"").trim();
    if(t.length<15)return true;
    return /^(tôi|mình|em|m|tao|tớ)\s+đang\s+(viết|nghĩ|suy\s*nghĩ|tìm|soạn|gõ|trả\s*lời)/i.test(t)
      || /^(đang\s+(viết|nghĩ|suy nghĩ|tìm|soạn)|writing|thinking|searching)\b/i.test(t)
      || /hiển thị suy nghĩ|đang viết\.\.\./i.test(t);
  }

  // Bỏ qua bài có dấu hiệu kích động bạo lực, kêu gọi lật đổ chính quyền,
  // hoặc nội dung phản động để tài khoản không tự động Like/Comment vào
  // nội dung có rủi ro vi phạm pháp luật. Đây là bộ lọc từ khóa thủ công,
  // không phải phân loại pháp lý đầy đủ — chỉ chặn các trường hợp rõ ràng.
  const SENSITIVE_INCITEMENT_PATTERNS=[
    /kích\s*động\s*(bạo\s*lực|biểu\s*tình|bạo\s*loạn|khủng\s*bố|lật\s*đổ|thù\s*hận)/,
    /kêu\s*gọi\s*(biểu\s*tình|bạo\s*loạn|lật\s*đổ|nổi\s*dậy|khủng\s*bố|xuống\s*đường)/,
    /lật\s*đổ\s*(chính\s*quyền|nhà\s*nước|chế\s*độ|đảng)/,
    /chống\s*phá\s*(nhà\s*nước|chính\s*quyền|chế\s*độ|đảng|cách\s*mạng)/,
    /phản\s*động/,
    /khủng\s*bố/,
    /bạo\s*loạn/,
    /ám\s*sát/,
    /đánh\s*bom/,
    /ly\s*khai/,
    /tuyên\s*truyền\s*chống\s*(nhà\s*nước|chính\s*quyền|đảng)/,
  ];
  function isSensitiveOrIncitingPost(article){
    if(!article) return false;
    const text=String(extractPostText(article)||"").replace(/\s+/g," ").toLowerCase();
    if(!text) return false;
    return SENSITIVE_INCITEMENT_PATTERNS.some(re=>re.test(text));
  }
  // Lớp kiểm duyệt bổ sung bằng chính AI Provider đã cấu hình (tùy chọn,
  // người dùng tự bật). Dùng chung hạ tầng gọi AI đa nhà cung cấp
  // (getPageAiConfig/callConfiguredText trong background.js) nên hoạt động
  // với mọi provider đã chọn, không riêng Gemini. Lỗi mạng/API không chặn
  // luồng chính — chỉ bỏ qua lớp kiểm duyệt AI cho bài đó, bộ lọc từ khóa
  // ở trên vẫn luôn hoạt động độc lập.
  async function isAiFlaggedSensitivePost(article,runtime){
    const text=String(extractPostText(article)||"").replace(/\s+/g," ").trim().slice(0,1500);
    if(text.length<10)return false;
    try{
      const response=await sendAiMessageWithTimeout({
        action:"aiClassifyFeedPost",
        postText:text,
        aiConfig:runtime?.aiConfig||{}
      });
      return !!response?.sensitive;
    }catch(_){
      return false;
    }
  }

  function isUnsupportedFeedMediaPost(article){
    if(!article)return false;
    if(article.querySelector('video, a[href*="/reel/"], a[href*="/watch/"], a[href*="/videos/"], a[href*="/video/"]'))return true;
    return [...article.querySelectorAll('[aria-label]')].some(el=>/^(?:video player|phát video|mở trong tab video|live video|video trực tiếp)$/i.test(String(el.getAttribute('aria-label')||'').trim()));
  }

  function isMessengerChatBox(el){
    if(!el) return false;
    if(el.closest('[role="dialog"][aria-label*="Chat" i], [role="dialog"][aria-label*="Messenger" i], [role="dialog"][aria-label*="Trò chuyện" i], [role="dialog"][aria-label*="Tin nhắn" i], [aria-label*="Nhắn tin" i], [data-pagelet*="ChatTab"], [data-pagelet*="Messenger"], [data-pagelet*="Chat"]')) return true;
    
    const label = ((el.getAttribute("aria-label")||"") + " " + (el.getAttribute("aria-placeholder")||"") + " " + (el.getAttribute("placeholder")||"")).toLowerCase();
    if(/(?:nhập tin nhắn|type a message|viết tin nhắn|tin nhắn|message|chat)/.test(label) && !/(?:bình luận|comment)/.test(label)){
      return true;
    }
    
    let parent = el.parentElement;
    for(let i=0; i<8 && parent; i++){
      const parentLabel = (parent.getAttribute("aria-label")||"").toLowerCase();
      if(/(?:tin nhắn|messenger|chat|hộp thoại trò chuyện)/.test(parentLabel) && !/(?:bình luận|comment)/.test(parentLabel)){
        return false;
      }
      if(parent.querySelector('a[href*="/messages/t/"], a[href*="/messages/read/"]')) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function findFeedPosts(){
    if(!isMainFacebookFeed())return [];
    const posts=[], seen=new Set(), seenKeys=new Set(), seenContentKeys=new Set();
    const candidates = [...document.querySelectorAll('[role="button"], [aria-label*="bình luận" i], [aria-label*="comment" i]')].filter(b => {
      if(!isRenderedElement(b)) return false;
      const label = buttonLabel(b);
      return isMainCommentActionLabel(label);
    });

    for(const btn of candidates){
      if(btn.closest('ul') || isInCommentLike(btn)) continue;
      const post = findFeedPostContainer(btn);
      if(!post || seen.has(post)) continue;
      
      if(isUnsupportedFeedMediaPost(post)) continue;
      // Facebook gắn data-ad-preview/data-ad-comet-preview cho cả bài bình
      // thường trên Feed. Chỉ loại các tín hiệu quảng cáo rõ ràng ở bước này;
      // nếu dùng mặc định, Comment-only sẽ thấy 0 bài và tự quay lại Feed.
      if(isSponsoredPost(post,{ignoreGenericPreview:true})) continue;
      if(isSensitiveOrIncitingPost(post)) continue;
      const postKey=postIdentity(post);
      const contentKey=postContentKey(extractPostText(post));
      if((postKey&&seenKeys.has(postKey))||(contentKey&&seenContentKeys.has(contentKey))) continue;
      post._commentBtn = btn; // Lưu trực tiếp tham chiếu nút Bình luận
      post.dataset.aiFeedCandidate="1";
      seen.add(post);
      if(postKey) seenKeys.add(postKey);
      if(contentKey) seenContentKeys.add(contentKey);
      posts.push(post);
    }
    return posts;
  }

  function findPostPermalink(article){
    const links=[...article.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>/\/posts\/|\/permalink(?:\.php|\/)|\/story\.php|\/photo(?:\.php|\/)|\/videos?\/|\/share\/p\/|[?&](?:story_fbid|fbid)=/i.test(h));
    const score=h=>{
      if(/\/groups\/[^/]+\/(?:posts|permalink)\/[^/?#]+/i.test(h))return 500;
      if(/\/[^/]+\/posts\/[^/?#]+/i.test(h))return 450;
      if(/[?&]story_fbid=/i.test(h))return 400;
      if(/\/permalink\.php/i.test(h))return 350;
      if(/\/share\/p\//i.test(h))return 300;
      if(/[?&]fbid=|\/photo/i.test(h))return 200;
      return 100;
    };
    return links.sort((a,b)=>score(b)-score(a))[0]||"";
  }

  function postIdentity(article){
    if(!article) return "";
    // Giữ khóa ổn định khi Facebook bổ sung permalink sau lần render đầu.
    // Không giữ khóa DOM ngẫu nhiên vì Facebook có thể tái sử dụng node cho
    // một bài khác khi cuộn.
    const existing=String(article.dataset?.postUid||"");
    if(/^fb:(?:group|post|media|id|text):/.test(existing))return existing;
    // DOM của Facebook thường bị thay mới sau khi mở/đăng comment. Mã ngẫu
    // nhiên theo DOM cũ khiến cùng một bài bị coi là bài mới và comment lặp.
    const permalink=findPostPermalink(article);
    if(permalink){
      try{
        const url=new URL(permalink,location.href);
        const groupMatch=url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/([^/?#]+)/i);
        const postMatch=url.pathname.match(/^\/([^/]+)\/posts\/([^/?#]+)/i);
        const storyId=url.searchParams.get("story_fbid");
        const mediaId=url.searchParams.get("fbid");
        let canonical="";
        if(groupMatch)canonical=`fb:group:${groupMatch[1].toLowerCase()}:${groupMatch[2].toLowerCase()}`;
        else if(postMatch)canonical=`fb:post:${postMatch[1].toLowerCase()}:${postMatch[2].toLowerCase()}`;
        else if(storyId)canonical=`fb:post:${String(storyId).toLowerCase()}`;
        else if(mediaId)canonical=`fb:media:${String(mediaId).toLowerCase()}`;
        if(canonical){article.dataset.postUid=canonical;return canonical;}
        const path=url.pathname.replace(/\/+$/,"/").toLowerCase();
        const keep=["story_fbid","fbid","id"].filter(k=>url.searchParams.has(k))
          .map(k=>`${k}=${url.searchParams.get(k)}`).join("&");
        const stable=`fb:${url.origin.toLowerCase()}${path}${keep?`?${keep}`:""}`;
        article.dataset.postUid=stable;
        return stable;
      }catch(_){
        // Nếu href không parse được, tiếp tục thử các định danh trong DOM.
      }
    }

    const dataFt=article.getAttribute("data-ft");
    if(dataFt){
      try{
        const parsed=JSON.parse(dataFt);
        const id=parsed.top_level_post_id||parsed.story_id||parsed.mf_story_key||parsed.content_id;
        if(id){
          const stable=`fb:id:${String(id)}`;
          article.dataset.postUid=stable;
          return stable;
        }
      }catch(_){ }
    }

    const attrId=article.getAttribute("data-story-id")||article.getAttribute("data-post-id")||article.getAttribute("data-id");
    if(attrId){
      const stable=`fb:id:${attrId}`;
      article.dataset.postUid=stable;
      return stable;
    }

    // Fallback ổn định theo nội dung, để vẫn chặn lặp khi Facebook không
    // cung cấp permalink trong DOM. Có thể bỏ qua hai bài trùng nội dung,
    // nhưng an toàn hơn việc đăng lặp cùng một bài.
    const content=extractPostText(article).trim();
    const contentKey=commentCacheKey(content);
    if(content.length>=15){
      const stable=`fb:text:${contentKey}`;
      article.dataset.postUid=stable;
      return stable;
    }

    if(article.dataset.postUid?.startsWith("fb:")) return article.dataset.postUid;
    article.dataset.postUid = "fb:dom:" + Math.random().toString(36).slice(2, 10) + "_" + Date.now();
    return article.dataset.postUid;
  }

  function findFeedPostByIdentity(identity){
    if(!identity) return null;
    const exact=findFeedPosts().find(post=>postIdentity(post)===identity);
    if(exact) return exact;

    // Sau khi Facebook render lại, nút comment có thể chưa xuất hiện ngay.
    // Tìm lại đúng container có cùng permalink nhưng không chọn comment con.
    const roots=[...document.querySelectorAll('[data-pagelet^="FeedUnit_"], div[role="article"], div[aria-describedby]')];
    const matches=[];
    const seen=new Set();
    for(const root of roots){
      if(seen.has(root)) continue;
      seen.add(root);
      if(postIdentity(root)===identity) matches.push(root);
    }
    return matches.find(post=>findCommentButton(post))||matches[0]||null;
  }

  function commentProofExists(root, proof){
    if(!root||!proof) return false;
    const normalize=s=>String(s||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLowerCase();
    const expected=normalize(proof).slice(0,60);
    if(!expected) return false;
    const nodes=[...root.querySelectorAll('[role="article"], [aria-label*="bình luận" i], [aria-label*="comment" i]')]
      .filter(node=>node!==root)
      // Nội dung còn nằm trong ô nhập chưa phải là bình luận đã được đăng.
      .filter(node=>!node.matches('[contenteditable="true"],[role="textbox"]')&&!node.closest('[contenteditable="true"],[role="textbox"]'))
      .filter(node=>{
        const label=(node.getAttribute("aria-label")||"").toLowerCase();
        return label.includes("bình luận")||label.includes("comment")||!!node.closest("ul");
      });
    return nodes.some(node=>normalize(node.innerText||node.textContent).includes(expected));
  }
  // Chữ ký nội dung comment đã đăng: dùng để chờ render ỔN ĐỊNH (mạng nhanh
  // hiện đủ ngay, mạng chậm chữ về từng đợt). Ổn định = sig không đổi.
  function commentProofSig(root, proof){
    if(!root||!proof) return "";
    const normalize=s=>String(s||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLowerCase();
    const expected=normalize(proof).slice(0,60);
    if(!expected) return "";
    const nodes=[...root.querySelectorAll('[role="article"], [aria-label*="bình luận" i], [aria-label*="comment" i]')]
      .filter(node=>node!==root)
      .filter(node=>!node.matches('[contenteditable="true"],[role="textbox"]')&&!node.closest('[contenteditable="true"],[role="textbox"]'))
      .filter(node=>{
        const label=(node.getAttribute("aria-label")||"").toLowerCase();
        return label.includes("bình luận")||label.includes("comment")||!!node.closest("ul");
      });
    for(const node of nodes){
      const t=normalize(node.innerText||node.textContent);
      if(t.includes(expected)) return t.length+":"+t.slice(-40);
    }
    return "";
  }
  // Lõi GỬI + CHỜ PROOF + NÁN DÙNG CHUNG mọi luồng comment Bản tin & AI
  // (scope Bản tin/Bạn bè/Nhóm/Page + Comment AI độc lập): tag và không tag
  // đi đúng một cơ chế — gõ đã verify ở ngoài, lõi chỉ lo gửi, proof 30s,
  // nán linh hoạt tới khi render ổn định (trần 15s).
  // o = { box, text, proof, tagEntity, tagConfig,
  //       alive(), onEvent('verifying'|'waitProof'|'unconfirmed'),
  //       clearDraft(), findSend(), sendEnter(), onProofTick(), proofRoots(),
  //       scrollIntoView(), onCounted(hit),
  //       proofExists(root,proof)?, doSend(btn)? }
  // proofExists/doSend: cho page.js dùng pageCommentProof/pageFeatureClick;
  // mặc định là commentProofExists + trustedMouse (luồng nick).
  // Trả: true | "skip" | "stopped" | "unconfirmed-skip" |
  //       "tag-proof-missing" | "navigated"
  async function unifiedSendProofDwell(o){
    if(!await o.alive()){ try{await o.clearDraft();}catch(_){} return "stopped"; }
    let tagApplied=!o.tagEntity;
    try{
      if(o.tagEntity&&o.box?.isConnected)
        tagApplied=await appendTagMention(o.box,o.tagConfig,()=>o.alive(),o.tagEntity);
      else if(o.tagEntity){ try{logActivity("tag","@tag bỏ qua (unified: box-chết)");}catch(_){} }
    }catch(e){ tagApplied=false; try{logActivity("tag","@tag lỗi (unified): "+String(e?.message||e).slice(0,80));}catch(_){} }
    if(o.tagEntity&&tagProofRequired(o.tagConfig)&&!tagApplied){ try{await o.clearDraft();}catch(_){} return "tag-proof-missing"; }
    if(!await o.alive()){ try{await o.clearDraft();}catch(_){} return "stopped"; }
    const sendBtn=await o.findSend();
    const doSend=o.doSend||(async (btn)=>{ try{return !!await trustedMouse(btn,"click",()=>o.alive());}catch(_){return false;} });
    let submitted=false;
    if(sendBtn){ try{submitted=!!await doSend(sendBtn);}catch(_){} }
    else if(o.sendEnter){ try{submitted=!!await o.sendEnter();}catch(_){} }
    if(!submitted)return "skip";
    o.onEvent("verifying");
    const proofFn=o.proofExists||commentProofExists;
    const deadline=Date.now()+30000;
    while(await o.alive()){
      await sleep(500);
      if(o.onProofTick){ const tick=await o.onProofTick(); if(tick)return tick; }
      const roots=await o.proofRoots();
      const hit=roots.find(r=>r&&proofFn(r,o.proof));
      if(hit){
        try{await o.clearDraft();}catch(_){}
        try{await o.scrollIntoView();}catch(_){}
        let lastSig="",stablePolls=0;
        for(let hold=0;hold<30;hold++){
          if(!await o.alive())return "stopped";
          const roots2=await o.proofRoots();
          const sig=roots2.map(r=>commentProofSig(r,o.proof)).find(Boolean)||"";
          if(sig&&sig===lastSig&&++stablePolls>=4)break;
          if(sig&&sig!==lastSig){lastSig=sig;stablePolls=0;}
          await sleep(500);
        }
        if(o.onCounted){ let fin=false; try{ fin=await o.onCounted(hit); }catch(e){ try{logActivity("tag","@lõi chung onCounted lỗi: "+String(e?.message||e).slice(0,120));}catch(_){} return "stopped"; } if(fin===false)return "stopped"; }
        return true;
      }
      if(Date.now()>=deadline)break;
      o.onEvent("waitProof");
    }
    if(!await o.alive()){ try{await o.clearDraft();}catch(_){} return "stopped"; }
    try{await o.clearDraft();}catch(_){}
    o.onEvent("unconfirmed");
    return "unconfirmed-skip";
  }
  function hasOwnComment(root){
    if(!root)return false;
    // Khi comment của chính tài khoản đã hiển thị, Facebook đặt nút
    // "Chỉnh sửa hoặc xóa bình luận này" lên comment đó. Đây là tín hiệu
    // ổn định hơn tên tài khoản (có thể bị rút gọn/đổi ngôn ngữ).
    return [...root.querySelectorAll('[aria-label]')].some(el=>/chỉnh sửa hoặc xóa bình luận này|edit or delete this comment/i.test(el.getAttribute('aria-label')||""));
  }
  function existingGroupCommentTexts(article){
    if(!article)return [];
    const normalize=s=>String(s||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLowerCase();
    // Cùng cách chọn node với commentProofExists, nhưng trả về nội dung các
    // comment đã có (loại nội dung còn nằm trong ô nhập của chính mình).
    const nodes=[...article.querySelectorAll('[role="article"], [aria-label*="bình luận" i], [aria-label*="comment" i]')]
      .filter(node=>node!==article)
      .filter(node=>!node.matches('[contenteditable="true"],[role="textbox"]')&&!node.closest('[contenteditable="true"],[role="textbox"]'))
      .filter(node=>{
        const label=(node.getAttribute("aria-label")||"").toLowerCase();
        return label.includes("bình luận")||label.includes("comment")||!!node.closest("ul");
      });
    const texts=[];
    for(const node of nodes){
      const text=normalize(node.innerText||node.textContent);
      if(text.length>=20)texts.push(text);
    }
    return [...new Set(texts)].slice(0,60);
  }
  function groupCommentDuplicatesExisting(article, commentText){
    const normalize=s=>String(s||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLowerCase();
    const mine=normalize(commentText);
    if(mine.length<25)return false;
    // Câu AI trùng gần nguyên văn comment đã có: hoặc toàn bộ câu AI đã
    // được người khác nói, hoặc câu AI ôm trọn một comment dài của người
    // khác. Cả hai đều là đăng chồng — phải bỏ qua, không được gửi.
    return existingGroupCommentTexts(article).some(existing=>{
      if(existing.includes(mine))return true;
      return existing.length>=30&&mine.includes(existing);
    });
  }

  function isValidFeedLike(btn, expectedBar){
    if(!isRenderedElement(btn)) return false;
    if(btn.dataset.feedInteracted==="1" || btn.getAttribute("aria-pressed")==="true") return false;
    if(!isLabel(btn,["thích","thich","like"])) return false;
    const bar=findMainActionBar(btn);
    return !!bar && (!expectedBar || bar===expectedBar);
  }

  function findFeedLikeButtons(){
    const btns=[];
    const seenBars=new Set();
    const candidates=document.querySelectorAll('[role="button"][aria-label="Thích"], [role="button"][aria-label="Thich"], [role="button"][aria-label="Like"]');
    for(const btn of candidates){
      if(!isValidFeedLike(btn)) continue;
      const bar=findMainActionBar(btn);
      const post=findFeedPostContainer(btn);
      if(!bar || seenBars.has(bar) || post?.dataset.feedInteracted==="1") continue;
      // Trước đây Like không lọc quảng cáo/nội dung nhạy cảm như Comment,
      // khiến tool tự bấm Like cả bài "Được tài trợ" hoặc bài có dấu hiệu
      // kích động/phản động. Áp cùng bộ lọc để nhất quán và tránh rủi ro.
      if(isSponsoredPost(post,{ignoreGenericPreview:true})||isSensitiveOrIncitingPost(post)) continue;
      seenBars.add(bar);
      btns.push(btn);
    }
    if(btns.length===0 && document.querySelectorAll('div[role="article"]').length>0){
      console.log(`[Feed] khong tim thay nut bai goc trong ${document.querySelectorAll('div[role="article"]').length} bai, tong nut Like:`, document.querySelectorAll('div[role="button"][aria-label="Thích"], div[role="button"][aria-label="Like"]').length);
    }
    return btns;
  }
  function scanFeedLikes(){
    const btns=findFeedLikeButtons();
    btns.forEach(b=>{ b.style.outline="3px dashed #00c851"; b.scrollIntoView({behavior:"smooth", block:"center"}); });
    // highlight comment like do de phan biet
    document.querySelectorAll('div[role="button"][aria-label="Thích"], div[role="button"][aria-label="Like"]').forEach(b=>{
      if(!btns.includes(b) && isRenderedElement(b) && b.closest('div[role="article"]')){
        if(b.closest('ul') || (b.parentElement && b.parentElement.innerText.includes("Trả lời"))){
          b.style.outline="2px solid red";
        }
      }
    });
    return btns.length;
  }
  function scanFeedScope(actionMode="like"){
    const mode=feedScopeActionMode(actionMode),seen=new Set();
    if(mode==="like")return scanFeedLikes();
    if(mode==="both"){
      findFeedLikeButtons().forEach(button=>{
        const article=findFeedPostContainer(button);if(article){article.style.outline="3px dashed #00c851";seen.add(article);}
      });
    }
    const posts=findFeedPosts();
    posts.forEach(article=>{article.style.outline="3px dashed #9c27b0";seen.add(article);});
    const first=posts[0]||[...seen][0];
    first?.scrollIntoView({behavior:"smooth",block:"center"});
    return seen.size;
  }

  // Bảng feed có ba nguồn Facebook tách biệt. Mỗi nguồn giữ active flag,
  // run id, counter, pending state và status riêng; selector/proof bên dưới
  // chỉ được dùng sau khi route đã xác nhận đúng filter tương ứng.
  const FEED_SCOPE_DEFS=Object.freeze({
    bantin:Object.freeze({id:"bantin",filter:"all",activeKey:"feedBantinActive",countKey:"feedBantinCount",statusKey:"feedBantinStatus",configKey:"feedBantinConfig",runIdKey:"feedBantinRunId",pendingKey:"pendingFeedBantin",pendingConfigKey:"pendingFeedBantinConfig",aiCountKey:"feedBantinAiCount",aiStatusKey:"feedBantinAiStatus",aiHistoryKey:"feedBantinAiHistory",aiGuardKey:"feedBantinAiSubmissionGuard",commentMarkKey:"feedCommentBantin"}),
    friends:Object.freeze({id:"friends",filter:"friends",activeKey:"feedFriendsActive",countKey:"feedFriendsCount",statusKey:"feedFriendsStatus",configKey:"feedFriendsConfig",runIdKey:"feedFriendsRunId",pendingKey:"pendingFeedFriends",pendingConfigKey:"pendingFeedFriendsConfig",aiCountKey:"feedFriendsAiCount",aiStatusKey:"feedFriendsAiStatus",aiHistoryKey:"feedFriendsAiHistory",aiGuardKey:"feedFriendsAiSubmissionGuard",commentMarkKey:"feedCommentFriends"}),
    groups:Object.freeze({id:"groups",filter:"groups",activeKey:"feedGroupsActive",countKey:"feedGroupsCount",statusKey:"feedGroupsStatus",configKey:"feedGroupsConfig",runIdKey:"feedGroupsRunId",pendingKey:"pendingFeedGroups",pendingConfigKey:"pendingFeedGroupsConfig",aiCountKey:"feedGroupsAiCount",aiStatusKey:"feedGroupsAiStatus",aiHistoryKey:"feedGroupsAiHistory",aiGuardKey:"feedGroupsAiSubmissionGuard",commentMarkKey:"feedCommentGroups"}),
    pages:Object.freeze({id:"pages",filter:"pages",activeKey:"feedPagesActive",countKey:"feedPagesCount",statusKey:"feedPagesStatus",configKey:"feedPagesConfig",runIdKey:"feedPagesRunId",pendingKey:"pendingFeedPages",pendingConfigKey:"pendingFeedPagesConfig",aiCountKey:"feedPagesAiCount",aiStatusKey:"feedPagesAiStatus",aiHistoryKey:"feedPagesAiHistory",aiGuardKey:"feedPagesAiSubmissionGuard",commentMarkKey:"feedCommentPages"})
  });
  const feedScopeList=Object.values(FEED_SCOPE_DEFS);
  const feedScopedRuntimes=new Map();
  function feedScopeDef(source){return FEED_SCOPE_DEFS[String(source||"").toLowerCase()]||null;}
  function feedScopeUrl(scope){return `https://www.facebook.com/?filter=${scope.filter}&sk=h_chr`;}
  function feedScopeRouteMatches(url,scope){
    try{
      const u=new URL(String(url||""));
      const host=u.hostname.toLowerCase();
      if(host!=="facebook.com"&&!host.endsWith(".facebook.com"))return false;
      const path=u.pathname.replace(/\/+$/g,"")||"/";
      return (path==="/"||path==="/home.php")&&(u.searchParams.get("filter")||"all").toLowerCase()===scope.filter;
    }catch{return false;}
  }
  function feedScopePostRouteMatches(url,identity,signature="",permalink=""){
    const key=String(identity||"").toLowerCase();
    try{
      const u=new URL(String(url||""));
      const path=u.pathname.replace(/\/+$/,"/").toLowerCase();
      // Facebook không phải lúc nào cũng thêm "/" cuối cho các permalink
      // dạng pfbid (vd: /trang/posts/pfbid0284...). Regex yêu cầu bắt buộc
      // "/" cuối trước đây khiến các bài này luôn bị coi sai route dù đúng
      // bài, làm Comment AI dừng ngay không gõ được gì.
      const isPagePostRoute=/^\/[^/]+\/posts\/[^/]+\/?$/.test(path);
      const isGroupPostRoute=/^\/groups\/[^/]+\/(?:posts|permalink)\/[^/]+\/?$/.test(path);
      // Facebook vẫn dùng dạng URL cũ /permalink.php?story_fbid=...&id=...
      // cho một số bài (đặc biệt bài chia sẻ vào Bảng feed → Bạn bè) khi mở
      // Comment. Thiếu nhánh này khiến route luôn bị coi là sai nguồn dù
      // đúng bài, làm Comment AI dừng ngay không gõ được gì.
      const isLegacyPermalinkRoute=path==="/permalink.php";
      if(!key)return false;

      // Khi click Comment, Facebook đôi lúc đi qua URL /photo/?fbid=... trước
      // khi dựng permalink /page/posts/... . Identity của card lúc đó thường
      // là fb:media, nên chỉ kiểm tra post route/signature sẽ hết thời gian
      // chờ trước khi Facebook kịp render composer. Permalink được chụp từ
      // chính article vừa chọn, vì vậy so khớp path + id này là bằng chứng
      // đủ chặt để cho phép đúng context media/post tạm thời.
      if(permalink){
        const picked=new URL(String(permalink),location.href);
        const pickedPath=picked.pathname.replace(/\/+$/,"/").toLowerCase();
        const pickedFbid=String(picked.searchParams.get("fbid")||"").toLowerCase();
        const currentFbid=String(u.searchParams.get("fbid")||"").toLowerCase();
        const pickedStory=String(picked.searchParams.get("story_fbid")||"").toLowerCase();
        const currentStory=String(u.searchParams.get("story_fbid")||"").toLowerCase();
        if(pickedPath===path){
          if(pickedFbid||currentFbid)return !!pickedFbid&&pickedFbid===currentFbid;
          if(pickedStory||currentStory)return !!pickedStory&&pickedStory===currentStory;
          return false;
        }
        if(pickedFbid&&pickedFbid===currentFbid)return true;
        if(pickedStory&&pickedStory===currentStory)return true;
      }
      const postMatch=key.match(/^fb:post:([^:]+):([^:]+)$/);
      if(postMatch){
        const pathMatch=path.match(/^\/([^/]+)\/posts\/([^/]+)\/?$/);
        if(pathMatch&&pathMatch[1]===postMatch[1]&&pathMatch[2]===postMatch[2])return true;
        const storyId=u.searchParams.get("story_fbid");
        if(storyId&&key===`fb:post:${String(storyId).toLowerCase()}`)return true;
        // Card identity và permalink có thể khác dạng sau khi Facebook
        // chuyển từ Feed sang modal/page. Không trả false sớm: bên dưới sẽ
        // chứng minh lại bằng signature của đúng nội dung bài đã chọn.
      }
      const groupMatch=key.match(/^fb:group:([^:]+):([^:]+)$/);
      if(groupMatch){
        const pathMatch=path.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/([^/]+)\/?$/);
        if(pathMatch&&pathMatch[1]===groupMatch[1]&&pathMatch[2]===groupMatch[2])return true;
        // Tiếp tục xuống signature fallback nếu Facebook đổi representation
        // của identity trong lúc dựng post detail.
      }
      const storyOnly=key.match(/^fb:post:([^:]+)$/);
      if(storyOnly&&String(u.searchParams.get("story_fbid")||"").toLowerCase()===storyOnly[1])return true;
      // Một số Feed card chỉ giữ media/text identity, dù click Comment đã
      // mở đúng permalink. Xác minh bằng phần đầu nội dung bài trên trang
      // chi tiết để không nhận nhầm một bài khác.
      if((isPagePostRoute||isGroupPostRoute||isLegacyPermalinkRoute)&&signature){
        const wanted=String(signature).replace(/\s+/g," ").trim().toLowerCase().slice(0,60);
        if(wanted.length<15)return false;
        const nodes=[...document.querySelectorAll('[data-ad-rendering-role="story_message"],[data-ad-preview="message"],[data-ad-comet-preview="message"],[dir="auto"],main,[role="article"],[role="dialog"]')]
          .filter(node=>isRenderedElement(node))
          .map(node=>String(node.innerText||node.textContent||"").replace(/\s+/g," ").trim().toLowerCase())
          .filter(text=>text.length>=wanted.length);
        return nodes.some(text=>text.includes(wanted));
      }
      return false;
    }catch{return false;}
  }
  function feedScopeStateKeys(scope){return [scope.activeKey,scope.countKey,scope.statusKey,scope.configKey,scope.runIdKey,scope.pendingKey,scope.pendingConfigKey,scope.aiCountKey,scope.aiStatusKey,scope.aiHistoryKey,scope.aiGuardKey];}
  async function feedScopeIsAlive(scope,runtime){
    if(!runtime?.active)return false;
    const state=await chrome.storage.local.get([scope.activeKey,scope.runIdKey]);
    if(state[scope.activeKey]!==true)return false;
    return !runtime.runId||!state[scope.runIdKey]||state[scope.runIdKey]===runtime.runId;
  }
  async function feedScopeWritePending(scope,runtime,status){
    const savedConfig=runtime?.config||runtime;
    await chrome.storage.local.set({
      [scope.activeKey]:true,
      [scope.runIdKey]:runtime.runId,
      [scope.configKey]:savedConfig,
      [scope.pendingKey]:true,
      [scope.pendingConfigKey]:savedConfig,
      [scope.statusKey]:status
    });
  }
  async function feedScopeCommentAlive(scope,runtime){
    return feedScopeUsesComment(runtime)&&runtime.aiCount<runtime.aiTarget&&await feedScopeIsAlive(scope,runtime);
  }
  async function ensureFeedScopeRoute(scope,runtime,identity="",signature="",permalink=""){
    // Mở composer có thể làm Facebook chuyển sang permalink của đúng bài.
    // Đây vẫn là context hợp lệ để comment; chỉ dừng khi route không phải
    // feed nguồn hoặc permalink của chính bài vừa chọn.
    for(let attempt=0;attempt<24;attempt++){
      if(!await feedScopeIsAlive(scope,runtime)){runtime.active=false;return false;}
      const onFeed=feedScopeRouteMatches(location.href,scope);
      const onPost=feedScopePostRouteMatches(location.href,identity,signature,permalink);
      if(attempt===0||onFeed||onPost||attempt===23){
        console.info(`[Feed] scope route check ${scope.id}: attempt=${attempt+1}/24 feed=${onFeed} post=${onPost} permalink=${!!permalink} signature=${!!signature}`);
      }
      if(onFeed||onPost){runtime.routeRecoveries=0;return true;}
      await sleep(500);
    }
    // Lạc route (thường do click Bình luận mở permalink rồi render chậm):
    // quay lại feed nguồn và cho lượt này bỏ bài — chỉ dừng thật khi trượt
    // 3 lần liên tiếp. Caller thấy true sẽ chạy tiếp với node cũ (đa số rẽ
    // vào nhánh skip vì node đã detached sau điều hướng).
    runtime.routeRecoveries=(runtime.routeRecoveries||0)+1;
    if(runtime.routeRecoveries>3){
      console.warn(`[Feed] scope route rejected ${scope.id}: post context was not proven`);
      runtime.active=false;
      const routeStatus=t("fd2.routeChanged");
      await chrome.storage.local.set({[scope.activeKey]:false,[scope.statusKey]:routeStatus,[scope.aiStatusKey]:routeStatus});
      await chrome.storage.local.remove([scope.pendingKey,scope.pendingConfigKey]);
      return false;
    }
    console.warn(`[Feed] scope route recover #${runtime.routeRecoveries} ${scope.id}: back to feed`);
    try{if(!feedScopeRouteMatches(location.href,scope))location.assign(feedScopeUrl(scope));}catch(_){}
    try{logActivity("tag","["+scope.id+"] route-recover #"+runtime.routeRecoveries+" (quay lại feed, bỏ bài lạc route)");}catch(_){}
    return true;
  }
  function feedScopeActionMode(value,legacyAiEnabled=false){
    const mode=String(value||"").toLowerCase();
    return ["like","comment","both"].includes(mode)?mode:(legacyAiEnabled?"both":"like");
  }
  function feedScopeUsesLike(runtime){const mode=feedScopeActionMode(runtime?.actionMode,runtime?.aiEnabled);return mode==="like"||mode==="both";}
  function feedScopeUsesComment(runtime){const mode=feedScopeActionMode(runtime?.actionMode,runtime?.aiEnabled);return mode==="comment"||mode==="both";}
  function feedScopeWorkRemaining(runtime){return (feedScopeUsesLike(runtime)&&runtime.count<runtime.target)||(feedScopeUsesComment(runtime)&&runtime.aiCount<runtime.aiTarget);}
  function findFeedScopeCandidates(scope,runtime){
    const candidates=[],byKey=new Map();
    const add=(article,likeButton=null)=>{
      if(!article)return;
      let key="",contentKey="";
      try{key=postIdentity(article)||"";}catch(_){ }
      // Một số card trên feed Bạn bè không có permalink/identity ổn định.
      // Dùng thêm hash nội dung để card quảng cáo đã fail-closed không bị
      // chọn lại vô hạn sau mỗi vòng quét/SPA rerender.
      if(feedScopeUsesComment(runtime)){
        try{contentKey=postContentKey(extractPostText(article))||"";}catch(_){ }
        if(runtime.aiSkippedKeys?.has(key)||runtime.aiSkippedKeys?.has(contentKey))return;
      }
      const mapKey=key||contentKey||article;
      const existing=byKey.get(mapKey);
      if(existing){if(likeButton)existing.likeButton=likeButton;return;}
      const item={article,likeButton,identity:key,contentKey};
      byKey.set(mapKey,item);candidates.push(item);
    };
    if(feedScopeUsesLike(runtime)){
      for(const button of findFeedLikeButtons())add(findFeedPostContainer(button),button);
    }
    if(feedScopeUsesComment(runtime)){
      for(const article of findFeedPosts()){
        if(scope.commentMarkKey&&article.dataset[scope.commentMarkKey]==="1")continue;
        add(article,null);
      }
    }
    return candidates;
  }
  function findFeedScopeLikeButton(identity,fallback){
    if(fallback?.isConnected&&isRenderedElement(fallback))return fallback;
    if(!identity)return fallback||null;
    return findFeedLikeButtons().find(button=>{
      const article=findFeedPostContainer(button);
      try{return article&&postIdentity(article)===identity;}catch(_){return false;}
    })||null;
  }
  async function clearFeedScopeCommentDraft(scope,box){
    if(box?.isConnected)await clearAICommentDraft(box);
    const clean=!box||!commentDraftText(box);
    if(clean&&scope?.isConnected)await closeExactCommentOverlay(scope);
    return clean;
  }
  // "Cân bằng" dùng chung một cache theo contentKey cho cả 3 nguồn Bảng feed,
  // để bài nội dung giống/tương tự (chia sẻ lại, spam cùng nội dung...) không
  // tốn thêm request AI trong số ngày cấu hình. Không phải batch nhiều bài
  // trong 1 request như Comment AI độc lập — mỗi bài mới vẫn gọi AI riêng,
  // chỉ khác là kết quả được lưu lại để tái dùng cho lần gặp tiếp theo.
  async function feedScopeCacheLookup(contentKey,maxAgeMs){
    if(!contentKey)return null;
    const stored=await chrome.storage.local.get("feedAiCommentCache");
    const cache=stored.feedAiCommentCache&&typeof stored.feedAiCommentCache==="object"?stored.feedAiCommentCache:{};
    const hit=cache[contentKey];
    if(hit?.comment&&(!maxAgeMs||Date.now()-hit.time<=maxAgeMs))return hit.comment;
    return null;
  }
  async function feedScopeCacheStore(contentKey,comment,maxAgeMs){
    if(!contentKey)return;
    const stored=await chrome.storage.local.get("feedAiCommentCache");
    const cache=stored.feedAiCommentCache&&typeof stored.feedAiCommentCache==="object"?stored.feedAiCommentCache:{};
    cache[contentKey]={comment,time:Date.now()};
    for(const [k,v] of Object.entries(cache)){if(maxAgeMs&&Date.now()-(v?.time||0)>maxAgeMs)delete cache[k];}
    await chrome.storage.local.set({feedAiCommentCache:cache});
  }
  async function generateFeedScopeComment(scope,runtime,postText,contentKey){
    const tagEntity=decideTagForPost(runtime.tagConfig,runtime.aiCount);
    try{logActivity("tag","["+scope.id+"] decide: cfg="+(!!runtime.tagConfig)+" rate="+(runtime.tagConfig?.rate)+" ent="+(tagEntity?tagEntity.name.slice(0,30):"null"));}catch(_){}
    if(runtime.aiEconomyMode==="max")return {comment:fallbackComment(postText),cached:false,fallback:true,tagEntity};
    const cacheMaxAge=Math.max(0,parseInt(runtime.aiCacheDays)||7)*86400000;
    // Cache chỉ dùng cho nhánh KHÔNG tag: comment có tag phải luôn sinh mới,
    // vừa để không lỡ tái dùng câu tag cũ khi bài này quyết định không tag
    // (và ngược lại), vừa tránh lặp y hệt một câu quảng cáo gây spam.
    if(runtime.aiEconomyMode==="balanced"&&!tagEntity){
      const cached=await feedScopeCacheLookup(contentKey,cacheMaxAge);
      if(cached)return {comment:cached,cached:true,tagEntity};
    }
    await chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiStarting",{done:runtime.aiCount,target:runtime.aiTarget})});
    try{
      let effectivePrompt=tagEntity?(runtime.aiTagPrompt||runtime.aiPrompt):runtime.aiPrompt;
      if(tagEntity?.name)effectivePrompt=buildTagPrompt(effectivePrompt,tagEntity.name);
      else effectivePrompt=effectivePrompt.replace(/\{tagName\}/g,"");
      const response=await sendAiMessageWithTimeout({
        action:"aiGenerateFeedComment",
        postText:String(postText).slice(0,1500),
        prompt:effectivePrompt,
        maxLines:tagEntity?2:1,
        styleProfileId:runtime.aiStyleProfileId||"",
        aiConfig:runtime.aiConfig||{}
      });
      if(!response?.ok)throw new Error(response?.error||t("bg.aiEmpty"));
      const comment=sanitizeCommentOutput(String(response.comment||"").trim()).replace(/[!！]+\s*$/g,"").trimEnd();
      if(!comment)throw new Error(t("bg.aiEmpty"));
      if(isPartialAiComment(comment))throw new Error(t("bg.aiEmpty"));
      if(runtime.aiEconomyMode==="balanced"&&!tagEntity)await feedScopeCacheStore(contentKey,comment,cacheMaxAge);
      return {comment,cached:false,tagEntity};
    }catch(error){
      const fallback=fallbackComment(postText);
      await chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiFallback",{error:String(error?.message||error).slice(0,180)})});
      return {comment:fallback,cached:false,fallback:true,tagEntity};
    }
  }
  async function postFeedScopeComment(scope,runtime,article,commentText,tagEntity=null){
    const stillActive=()=>feedScopeIsAlive(scope,runtime);
    if(!await feedScopeCommentAlive(scope,runtime)||!feedScopeRouteMatches(location.href,scope))return "stopped";
    if(!article?.isConnected)return "skip";
    article.dataset.aiFeedCandidate="1";
    const gateText=String(extractPostText(article)||"");
    if(isSponsoredPost(article,{ignoreGenericPreview:true})||isUnsupportedFeedMediaPost(article)||isSensitiveOrIncitingPost(article))return "skip";
    const identity=postIdentity(article),permalink=findPostPermalink(article),signature=String(gateText||"").replace(/\s+/g," ").trim().toLowerCase().slice(0,60);
    if(!identity)return "skip";
    const proof=String(commentText||"").replace(/\s+/g," ").trim().toLowerCase().slice(0,60);
    if(!proof)return "skip";
    if(hasOwnComment(article)||commentProofExists(article,proof))return "already-commented";
    const guardStored=await chrome.storage.local.get(scope.aiGuardKey),existingGuards=guardStored[scope.aiGuardKey]&&typeof guardStored[scope.aiGuardKey]==="object"?guardStored[scope.aiGuardKey]:{};
    if(existingGuards[identity]?.state==="submitting")return "unconfirmed-skip";
    let commentScope=article,box=null;
    const exact=findExactCommentBox(article,identity,signature);
    if(exact){box=exact.box;commentScope=exact.scope;}
    if(!box){
      const previousBoxes=new Set(visibleCommentBoxes());
      const commentBtn=findCommentButton(article);
      if(!commentBtn)return "skip";
      if(!await trustedMouse(commentBtn,"click",stillActive))return "skip";
      for(let wait=0;wait<60;wait++){
        if(!await feedScopeCommentAlive(scope,runtime))return "stopped";
        if(!feedScopeRouteMatches(location.href,scope)&&!await ensureFeedScopeRoute(scope,runtime,identity,signature,permalink))return "stopped";
        const current=findFeedPostByIdentity(identity)||article;
        const found=findExactCommentBox(current,identity,signature);
        const opened=findCommentBoxOpenedByClick(previousBoxes);
        if(found){box=found.box;commentScope=found.scope;break;}
        if(opened?.box){box=opened.box;commentScope=opened.scope;break;}
        if(opened?.scope)commentScope=opened.scope;
        await sleep(500);
      }
    }
    if(!box){await clearFeedScopeCommentDraft(commentScope,box);return "box-timeout";}
    const resolveReplacement=preferred=>{
      const current=findFeedPostByIdentity(identity)||article;
      const found=findExactCommentBox(current,identity,signature);
      return found?.box||preferred||null;
    };
    const filled=await fillAndVerifyCommentBox(box,commentText,resolveReplacement,stillActive,{
      storageKey:scope.activeKey,runId:runtime.runId,runIdKey:scope.runIdKey,typingConfig:runtime.aiTypingConfig||aiTypingConfig
    });
    if(!filled.ok){
      // `draft` means the editor already contained text before this state
      // machine owned it. Leave the user's draft untouched; only clean an
      // editor after AI has actually started typing into it.
      if(filled.reason!=="draft")await clearFeedScopeCommentDraft(commentScope,filled.box||box);
      return filled.reason==="stopped"?"stopped":filled.reason==="draft"?"draft-blocked":"skip";
    }
    box=filled.box||box;
    if(!await feedScopeCommentAlive(scope,runtime)){await clearFeedScopeCommentDraft(commentScope,box);return "stopped";}
    // Tag do lõi chung gắn (unifiedSendProofDwell) — không gắn ở đây để khỏi mention 2 lần.
    const guards=existingGuards;
    guards[identity]={time:Date.now(),state:"submitting"};
    await chrome.storage.local.set({[scope.aiGuardKey]:guards});
    // Gửi + proof + nán qua lõi chung của Bản tin & AI (tag/không tag một cơ chế).
    const sendRes=await unifiedSendProofDwell({
      box, commentScope, proof, tagEntity, tagConfig:runtime.tagConfig,
      alive:()=>feedScopeCommentAlive(scope,runtime),
      onEvent:(name)=>{
        if(name==="unconfirmed")chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiUnconfirmed",{done:runtime.aiCount,target:runtime.aiTarget})});
        else chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiVerifying",{done:runtime.aiCount+1,target:runtime.aiTarget})});
      },
      clearDraft:()=>clearFeedScopeCommentDraft(commentScope,box),
      findSend:()=>findCommentSendButton(box),
      sendEnter:()=>chrome.runtime.sendMessage({action:"trustedInput",text:"",pressEnter:true,typingMinDelay:0,typingMaxDelay:0,abortStorageKey:scope.activeKey,abortRunId:runtime.runId,abortRunIdKey:scope.runIdKey}).then(r=>!!r?.ok).catch(()=>false),
      onProofTick:async()=>{
        if(!feedScopeRouteMatches(location.href,scope)&&!await ensureFeedScopeRoute(scope,runtime,identity,signature,permalink))return "stopped";
        return null;
      },
      proofRoots:()=>{const live=findFeedPostByIdentity(identity)||article;return [commentScope,live];},
      scrollIntoView:()=>{const live=findFeedPostByIdentity(identity)||article;try{(live&&live.isConnected?live:article)?.scrollIntoView({behavior:"smooth",block:"center"});}catch(_){}},
      onCounted:()=>true,
    });
    if(sendRes==="stopped")return "stopped";
    if(sendRes==="tag-proof-missing"){await clearFeedScopeCommentDraft(commentScope,box);return "tag-proof-missing";}
    if(sendRes==="skip"){delete guards[identity];await chrome.storage.local.set({[scope.aiGuardKey]:guards});await clearFeedScopeCommentDraft(commentScope,box);return "skip";}
    if(sendRes!==true)return sendRes;
    return true;
  }
  async function runFeedScopeComment(scope,runtime,article){
    if(!await feedScopeCommentAlive(scope,runtime)||!article)return "skip";
    // Mở rộng bài thu gọn trước để AI đọc toàn văn, không đọc cụt "... Xem thêm".
    try{await expandArticleSeeMore(article);}catch(_){}
    const text=extractPostText(article),identity=postIdentity(article),contentKey=postContentKey(text);
    const history=runtime.aiHistory&&typeof runtime.aiHistory==="object"?runtime.aiHistory:{};
    // Facebook có thể tái sử dụng cùng một DOM identity khi feed recycle bài.
    // Nếu nội dung đã khác, tách khóa lịch sử bằng contentKey để counter/history
    // không bị lệch (không ghi đè bằng chứng của bài trước).
    const baseHistoryKey=identity||contentKey;
    const historyKey=(identity&&contentKey&&history[identity]?.contentKey&&history[identity].contentKey!==contentKey)
      ? identity+"::"+contentKey : baseHistoryKey;
    if(!text||text.trim().length<15){await chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiNoText",{done:runtime.aiCount,target:runtime.aiTarget})});return "skip";}
    if(isSponsoredPost(article,{ignoreGenericPreview:true})){await chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiSalesSkip",{done:runtime.aiCount,target:runtime.aiTarget})});return "skip";}
    // Chỉ bỏ qua bài được tài trợ; bài bán hàng organic vẫn comment bình thường (user chốt 29/10)
    // Đã có comment của chính tài khoản trên bài này: ghi vào lịch sử theo
    // post-identity để các lần quét sau bỏ qua ngay mà không phải dò lại DOM
    // (trên feed comment thường bị thu gọn nên hasOwnComment dễ trượt lần sau).
    if(hasOwnComment(article)){
      const k=historyKey||contentKey;
      if(k){history[k]={time:Date.now(),contentKey:contentKey||"",comment:""};runtime.aiHistory=history;await chrome.storage.local.set({[scope.aiHistoryKey]:history});}
      return "skip";
    }
    const now=Date.now(),maxAge=Math.max(0,parseInt(runtime.aiCacheDays)||7)*86400000;
    const previous=historyKey&&history[historyKey];
    const previousByContent=contentKey&&Object.values(history).find(item=>item?.contentKey===contentKey);
    if((previous?.time&&(!maxAge||now-previous.time<=maxAge))||(previousByContent?.time&&(!maxAge||now-previousByContent.time<=maxAge)))return "skip";
    // Sổ cái chữ ký: chặn đăng trùng chéo phiên/tag-không-tag khi khóa
    // history bất ổn (markup đổi, counts đổi text). Bỏ qua trước khi tốn AI.
    if(await postSigMarked(text))return "skip";
    const generated=await generateFeedScopeComment(scope,runtime,text,contentKey);
    const result=await postFeedScopeComment(scope,runtime,article,generated.comment,generated.tagEntity);
    const backToFeedIfLost=async()=>{
      // Click nút Bình luận có thể khiến Facebook pushState sang permalink.
      // Dùng history.back() trước (SPA, không reload trang); chỉ fallback
      // location.assign nếu sau 1.5s vẫn chưa về feed.
      if(feedScopeRouteMatches(location.href,scope))return;
      try{history.back();}catch(_){}
      await sleep(1500);
      if(!feedScopeRouteMatches(location.href,scope)){try{location.assign(feedScopeUrl(scope));}catch(_){}}
    };
    if(result===true||result==="already-commented"){
      await markPostSig(text);
      const key=historyKey||contentKey;if(key)history[key]={time:now,contentKey:contentKey||"",comment:generated.comment};
      runtime.aiHistory=history;runtime.aiCount++;runtime.routeRecoveries=0;
      await chrome.storage.local.set({[scope.aiCountKey]:runtime.aiCount,[scope.aiHistoryKey]:history,[scope.aiStatusKey]:t("fd2.aiCounted",{done:runtime.aiCount,target:runtime.aiTarget}),[scope.statusKey]:t("fd2.commented",{done:runtime.aiCount,target:runtime.aiTarget})});
      await backToFeedIfLost();
      return result;
    }
    if(result==="stopped"){
      // "stopped" ngay từ cổng vào (lạc route trước khi xử lý bài, chưa qua
      // ensure): quay lại feed và bỏ bài này. Không đếm vào routeRecoveries
      // (bộ đếm đó thuộc về ensureFeedScopeRoute); chỉ dừng thật khi cờ đã
      // tắt hoặc target đã đủ.
      try{
        const st=await chrome.storage.local.get([scope.activeKey]);
        if(st[scope.activeKey]===true&&runtime.aiCount<runtime.aiTarget){
          await backToFeedIfLost();
          await chrome.storage.local.set({[scope.aiStatusKey]:t("fd2.aiUnconfirmed",{done:runtime.aiCount,target:runtime.aiTarget})});
          return "skip";
        }
      }catch(_){}
      return "stopped";
    }
    // Thất bại thường (box-timeout/skip/...) mà đang lạc khỏi feed: quay lại
    // feed để bài tiếp theo đúng route rồi vòng lặp chạy tiếp bình thường.
    await backToFeedIfLost();
    return result;
  }
  async function feedScopedLoop(scope,runtime){
    if(!feedScopeRouteMatches(location.href,scope)){
      await feedScopeWritePending(scope,runtime,t("p.fdOpening"));
      location.assign(feedScopeUrl(scope));
      return;
    }
    await chrome.storage.local.remove([scope.pendingKey,scope.pendingConfigKey]);
    runtime.active=true;
    const saved=await chrome.storage.local.get([scope.countKey,scope.activeKey,scope.aiCountKey,scope.aiHistoryKey]);
    runtime.count=Math.max(0,parseInt(saved[scope.countKey])||0);
    runtime.aiCount=Math.max(0,parseInt(saved[scope.aiCountKey])||0);
    runtime.aiHistory=saved[scope.aiHistoryKey]&&typeof saved[scope.aiHistoryKey]==="object"?saved[scope.aiHistoryKey]:{};
    if(saved[scope.activeKey]!==true)return;
    await chrome.storage.local.set({[scope.statusKey]:t("fd2.starting"),[scope.countKey]:runtime.count,[scope.configKey]:runtime.config});
    let idle=0,scrollTries=0;
    while(await feedScopeIsAlive(scope,runtime)&&feedScopeWorkRemaining(runtime)){
      let candidates=findFeedScopeCandidates(scope,runtime);
      if(candidates.length)idle=0,scrollTries=0;
      if(!candidates.length){
        idle++;
        if(idle>=2){
          window.scrollTo(0,document.body.scrollHeight);
          await sleep(3500);
          if(!await feedScopeIsAlive(scope,runtime))break;
          scrollTries++;
          const afterScroll=findFeedScopeCandidates(scope,runtime);
          if(afterScroll.length){candidates=afterScroll;idle=0;scrollTries=0;}
          else if(idle>=20||scrollTries>=18){
            await chrome.storage.local.set({[scope.statusKey]:t("fd2.noTargets",{n:scrollTries})});
            break;
          }
        }else{
          window.scrollBy(0,900);
          await sleep(1600);
          continue;
        }
      }
      for(const candidate of candidates){
        if(!(await feedScopeIsAlive(scope,runtime))||!feedScopeWorkRemaining(runtime))break;
        let art=candidate.article;
        let btn=feedScopeUsesLike(runtime)?findFeedScopeLikeButton(candidate.identity,candidate.likeButton):null;
        try{
          if(!art?.isConnected&&candidate.identity)art=findFeedPostByIdentity(candidate.identity)||art;
          if(!art?.isConnected)continue;
          if(btn)btn.scrollIntoView({behavior:"smooth",block:"center"});else art.scrollIntoView({behavior:"smooth",block:"center"});
          await sleep(600);
          // Lớp kiểm duyệt AI (tùy chọn, mặc định tắt): chỉ gọi một lần cho
          // mỗi bài SẮP được tương tác, không gọi ở bước quét hàng loạt để
          // tránh tốn request AI cho những bài không bao giờ được xử lý tới.
          if(runtime.aiModerationEnabled&&await isAiFlaggedSensitivePost(art,runtime))continue;
          if(feedScopeUsesLike(runtime)&&runtime.count<runtime.target&&btn){
            const actionBar=findMainActionBar(btn);
            if(isValidFeedLike(btn,actionBar)){
              if(!(await feedScopeIsAlive(scope,runtime)))break;
              const result=await doReact(btn,runtime.reaction,()=>feedScopeIsAlive(scope,runtime));
              // A click is not proof. Only count after doReact sees Facebook's
              // changed reaction label/state.
              btn.dataset.feedInteracted="1";
              if(result.success){
                if(art)art.dataset.feedInteracted="1";
                if(art)art.style.outline="2px solid #1877F2";else btn.style.outline="2px solid #1877F2";
                runtime.count++;
                await chrome.storage.local.set({[scope.countKey]:runtime.count,[scope.statusKey]:t("fd2.reacted",{reaction:result.used,done:runtime.count,target:runtime.target})});
              }
            }
          }
          if(feedScopeUsesComment(runtime)&&runtime.aiCount<runtime.aiTarget){
            const liveArticle=candidate.identity?findFeedPostByIdentity(candidate.identity)||art:art;
            const aiResult=await runFeedScopeComment(scope,runtime,liveArticle);
            if(aiResult==="page-reloading")return;
            if(aiResult!=="stopped"){
              const skipKey=candidate.contentKey||postContentKey(extractPostText(liveArticle))||candidate.identity;
              if(skipKey)runtime.aiSkippedKeys.add(skipKey);
              if(candidate.identity)runtime.aiSkippedKeys.add(candidate.identity);
              if(scope.commentMarkKey&&liveArticle?.isConnected)liveArticle.dataset[scope.commentMarkKey]="1";
            }
          }
        }catch(error){console.warn(`[Feed:${scope.id}]`,error);}
        if(!feedScopeWorkRemaining(runtime))break;
        const waitUntil=Date.now()+rand(runtime.minDelay*1000,runtime.maxDelay*1000);
        while(Date.now()<waitUntil){
          if(!(await feedScopeIsAlive(scope,runtime))){runtime.active=false;break;}
          await sleep(Math.min(500,waitUntil-Date.now()));
        }
      }
      if(!feedScopeWorkRemaining(runtime))break;
      if(!(await feedScopeIsAlive(scope,runtime)))break;
      window.scrollTo(0,document.body.scrollHeight);
      await sleep(1800);
    }
    const finalState=await chrome.storage.local.get([scope.activeKey]);
    if(!runtime.active||finalState[scope.activeKey]!==true)return;
    runtime.active=false;
    const finalStatus=feedScopeUsesLike(runtime)&&feedScopeUsesComment(runtime)
      ?t("fd2.bothDone",{likeDone:runtime.count,likeTarget:runtime.target,commentDone:runtime.aiCount,commentTarget:runtime.aiTarget})
      :feedScopeUsesLike(runtime)
        ?(runtime.count?t("fd2.doneAll",{done:runtime.count,target:runtime.target}):t("fd2.zeroFound",{target:runtime.target}))
        :(runtime.aiCount?t("fd2.commentDone",{done:runtime.aiCount,target:runtime.aiTarget}):t("fd2.commentZero",{target:runtime.aiTarget}));
    const finalPatch={[scope.activeKey]:false,[scope.statusKey]:finalStatus};
    if(runtime.aiEnabled&&runtime.aiCount>=runtime.aiTarget)finalPatch[scope.aiStatusKey]=t("fd2.aiDone",{done:runtime.aiCount,target:runtime.aiTarget});
    await chrome.storage.local.set(finalPatch);
  }
  async function startFeedScoped(source,msg={}){
    const scope=feedScopeDef(source);
    if(!scope)return {ok:false,error:"Nguồn Bảng feed không hợp lệ"};
    const current=feedScopedRuntimes.get(scope.id);
    if(current?.active)return {ok:false,error:t("fd2.alreadyRunning")};
    // The old generic Feed loop is kept only for migration compatibility. It
    // must never coexist with a scoped Friends/Groups/Pages run, otherwise a
    // Comment-only run can still inherit the old Like loop in another tab.
    isFeedInteracting=false;
    await chrome.storage.local.set({isFeedInteracting:false});
    await chrome.storage.local.remove(["pendingFeedInteract","pendingFeedConfig"]);
    const actionMode=feedScopeActionMode(msg.actionMode,msg.aiEnabled);
    const config={source:scope.id,actionMode,target:Math.max(1,Math.min(100000,parseInt(msg.target)||20)),minDelay:Math.max(1,parseInt(msg.minDelay)||3),maxDelay:Math.max(1,parseInt(msg.maxDelay)||8),reaction:msg.reaction||"random",aiEnabled:actionMode!=="like",aiPrompt:String(msg.aiPrompt||"").trim(),aiTagPrompt:String(msg.aiTagPrompt||"").trim(),aiTarget:Math.max(1,Math.min(100000,parseInt(msg.aiTarget)||5)),aiEconomyMode:["max","balanced","personal"].includes(msg.aiEconomyMode)?msg.aiEconomyMode:"balanced",aiCacheDays:Math.max(0,Math.min(3650,parseInt(msg.aiCacheDays)||7)),aiStyleProfileId:String(msg.aiStyleProfileId||"").slice(0,180),aiConfig:msg.aiConfig&&typeof msg.aiConfig==="object"?{provider:String(msg.aiConfig.provider||""),model:String(msg.aiConfig.model||""),url:String(msg.aiConfig.url||""),profileId:String(msg.aiConfig.profileId||"")}:{},aiModerationEnabled:!!msg.aiModerationEnabled,aiTypingConfig:msg.aiTypingConfig||null,tagConfig:msg.tagConfig||null,ownerTabId:msg.ownerTabId||0};
    if(config.minDelay>config.maxDelay)[config.minDelay,config.maxDelay]=[config.maxDelay,config.minDelay];
    const runId=String(msg.runId||`${scope.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    const runtime={...config,config,runId,count:0,active:true,aiSkippedKeys:new Set()};
    feedScopedRuntimes.set(scope.id,runtime);
    await chrome.storage.local.set({[scope.activeKey]:true,[scope.runIdKey]:runId,[scope.configKey]:config,[scope.countKey]:0,[scope.aiCountKey]:0,[scope.aiStatusKey]:config.aiEnabled?t("fd2.aiWaiting",{done:0,target:config.aiTarget}):"",[scope.statusKey]:t("fd2.starting"),[scope.pendingKey]:true,[scope.pendingConfigKey]:config});
    void feedScopedLoop(scope,runtime).finally(()=>{if(feedScopedRuntimes.get(scope.id)===runtime)feedScopedRuntimes.delete(scope.id);});
    return {ok:true,runId};
  }
  async function stopFeedScoped(source,status=t("p.stoppedX")){
    const scope=feedScopeDef(source);if(!scope)return;
    const runtime=feedScopedRuntimes.get(scope.id);if(runtime)runtime.active=false;
    await chrome.storage.local.set({[scope.activeKey]:false,[scope.statusKey]:status,[scope.aiStatusKey]:status});
    await chrome.storage.local.remove([scope.pendingKey,scope.pendingConfigKey]);
  }
  async function resetFeedScoped(source){
    const scope=feedScopeDef(source);if(!scope)return;
    const runtime=feedScopedRuntimes.get(scope.id);if(runtime)runtime.active=false;
    document.querySelectorAll('[data-feed-interacted="1"]').forEach(el=>{delete el.dataset.feedInteracted;el.style.outline="";});
    await chrome.storage.local.set({[scope.activeKey]:false,[scope.countKey]:0,[scope.aiCountKey]:0,[scope.statusKey]:t("p.resetDone"),[scope.aiStatusKey]:t("p.resetDone")});
    await chrome.storage.local.remove([scope.pendingKey,scope.pendingConfigKey]);
  }

  // Lay noi dung bai viet de gui AI
  // Mô tả ảnh Facebook render (alt) — dùng khi bài ít chữ để AI vẫn thấy nội
  // dung ảnh. Bỏ avatar/icon UI, bỏ ảnh trong vùng comment, mỗi alt phải đủ dài.
  function isMeaningfulAlt(t){
    const s=String(t||"").trim();
    if(s.length<8)return false;
    return !/^(?:profile picture|ảnh đại diện|avatar|thích|like|bình luận|comment|chia sẻ|share|ảnh|image|photo|biểu tượng|icon|emoji)$/i.test(s);
  }
  function articleImageAlts(article){
    if(!article?.querySelectorAll)return "";
    const seen=new Set(),out=[];
    for(const img of article.querySelectorAll("img[alt]")){
      if(img.closest('ul, div[aria-label*="Bình luận"], div[aria-label*="Comment"]'))continue;
      const t=String(img.getAttribute("alt")||"").trim();
      if(!isMeaningfulAlt(t)||seen.has(t))continue;
      seen.add(t);out.push(t);
      if(out.length>=3)break;
    }
    return out.join(" ").slice(0,600);
  }
  // Lột đuôi thu gọn/mở rộng của Facebook ("… Xem thêm", "Ẩn bớt", "See less").
  // Chỉ lột ở CUỐI, không đụng chữ "xem thêm" nằm giữa nội dung thật.
  // Giữ dấu chấm câu cuối câu. (Không dùng \b trước chữ Việt vì \b ASCII
  // không nhận biên sau dấu cách với ký tự không dấu.)
  function stripSeeMoreTail(text){
    return String(text||"")
      .replace(/[\s.…]*\b(see more|see less|show less)\b\s*\.?$/i,"")
      .replace(/[\s.…]*(xem thêm|ẩn bớt)\s*\.?$/i,"")
      .replace(/(\s*\.{2,}\s*|\s*…+\s*)$/,"")
      .trim();
  }
  // Bấm nút "Xem thêm" để mở rộng toàn văn bài viết trước khi đọc cho AI.
  // Chỉ bấm marker khớp CHÍNH XÁC trong vùng text bài (không đụng "xem thêm
  // bình luận", không đụng link); mỗi bài tối đa 2 nút.
  async function expandArticleSeeMore(article){
    if(!article?.querySelectorAll)return 0;
    let expanded=0;
    try{
      const msgRoots=[...article.querySelectorAll('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]')];
      const scopes=msgRoots.length?msgRoots:[article];
      for(const root of scopes){
        const cands=[...root.querySelectorAll("span, div, a")].filter(el=>{
          if(el.closest('ul, div[aria-label*="Bình luận"], div[aria-label*="Comment"]'))return false;
          if(!/^([.…]*\s*)?(xem thêm|see more)$/i.test((el.innerText||"").trim()))return false;
          const sib=((el.parentElement?.innerText||"").slice(0,120));
          if(/(bình luận|comment)/i.test(sib))return false;
          const r=el.getBoundingClientRect();
          return r.width>0&&r.height>0;
        });
        for(const el of cands.slice(0,2)){
          try{el.click();expanded++;}catch(_){}
          await sleep(700);
          if(!article.isConnected)return expanded;
        }
      }
    }catch(_){}
    return expanded;
  }
  function extractPostText(article){
    function isInComment(n){ return !!n?.closest?.('ul, div[aria-label*="Bình luận"], div[aria-label*="Comment"]'); }
    // Comment con trong overlay/feed thường là role="article" lồng bên trong
    // article gốc. Phân biệt với bài chia sẻ lồng (shared post) qua nút "Bình luận":
    // bài/shared post có nút Bình luận, comment chỉ có "Trả lời" (không có "Bình luận").
    // Không dùng "Chia sẻ" làm discriminator vì Facebook cũng hiện nút Chia sẻ trên comment.
    function isInNestedCommentItem(n){
      if(!n?.closest)return true;
      const inner=n.closest('div[role="article"]');
      if(!inner||inner===article)return false;
      // Nested article có nút "Bình luận" → là shared post, giữ lại làm context.
      const btns=[...inner.querySelectorAll('[role="button"]')].map(buttonLabel);
      if(btns.some(isMainCommentActionLabel))return false;
      // Không có "Bình luận" → là comment, loại bỏ khỏi fallback.
      return true;
    }
    let text="";
    const msgDiv = article.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
    if(msgDiv && !isInComment(msgDiv) && msgDiv.innerText.trim().length>0) text=msgDiv.innerText.trim();
    if(!text || text.length<20){
      const bgDiv = article.querySelector('div[style*="background-color"], div[style*="background"]');
      if(bgDiv && !isInComment(bgDiv) && bgDiv.innerText.trim().length>10) text=bgDiv.innerText.trim();
    }
    if(!text || text.length<20){
      const cands = article.querySelectorAll('div[dir="auto"]');
      let longest="";
      cands.forEach(c=>{
        if(isInComment(c)||isInNestedCommentItem(c))return;
        const t=(c.innerText||"").trim();
        // Bỏ ứng viên toàn nút UI (Thích/Bình luận/Chia sẻ) — đó là chữ rác,
        // không phải nội dung bài (bắt live: vớ nhầm là AI viết chung chung).
        const actions=(t.match(/thích|like|bình luận|comment|chia sẻ|share|bày tỏ cảm xúc|nhắn tin|message|theo dõi|follow/gi)||[]).length;
        if(actions>=2&&t.length<300)return;
        if(t.length>longest.length)longest=t;
      });
      if(longest) text=longest;
    }
    if(!text) text = article.innerText ? article.innerText.slice(0,800).trim() : "";
    // bo header
    text = text.replace(/^.*·\s*\d+\s*năm\s*/s,"").trim();
    text = text.replace(/^Tháng\s*\d+.*?\d{4}\s*·?\s*/s,"").trim();
    // Lột "Bài viết của <Tên>" dính đầu khi vớ nhầm node header/author.
    text = text.replace(/^Bài viết của\s+.{1,80}?(\s+[·•]|\s*\n|$)/s,"").trim();
    // lột đuôi thu gọn của Facebook ("… Xem thêm") để khỏi gửi rác cho AI
    text = stripSeeMoreTail(text);
    // Bài ít chữ (ảnh là chính): kèm mô tả ảnh để AI có gì bám vào viết.
    if(text.length<60){
      const alts=articleImageAlts(article);
      if(alts)text=`${text}\n[Mô tả ảnh: ${alts}]`.trim();
    }
    return text.slice(0, 2000); // gioi han gui AI
  }

  function groupCommentSourceText(article){
    const primary=String(extractPostText(article)||"").trim();
    if(primary)return primary;
    // Bài chỉ có ảnh đôi khi không có message div. Lấy mô tả ảnh công khai
    // nếu Facebook đã render alt text, để AI vẫn có dữ liệu thay vì bỏ qua.
    const alts=[...article.querySelectorAll("img[alt]")]
      .map(img=>String(img.getAttribute("alt")||"").trim())
      .filter(text=>text.length>=2&&!/^(?:profile picture|ảnh đại diện|thích|like|avatar)$/i.test(text));
    if(alts.length)return alts.join(" ").slice(0,2000);
    // Không có text/alt vẫn là bài có thể bình luận. Gửi một nguồn tối thiểu
    // để AI biết đây là bài hình ảnh đang hiển thị, thay vì loại bài vì ngắn.
    return "Bài viết hình ảnh đang hiển thị trong nhóm; hãy phản hồi tự nhiên và hỏi thêm một chi tiết phù hợp với bài.";
  }

  function isReplyCommentBox(el){
    if(!el?.getAttribute)return false;
    // Chỉ loại ô trả lời comment con khi Facebook nêu rõ đích trả lời. Trên
    // giao diện tiếng Việt hiện tại, ô comment chính cũng có nhãn
    // "Trả lời dưới tên X", còn ô reply con có nhãn "Trả lời với vai trò X".
    // Regex cũ chỉ tìm chữ "trả lời" nên đã loại nhầm composer chính trong
    // trang permalink, làm Comment AI báo không thấy ô nhập.
    // Chỉ loại ở khâu CHỌN ô để gõ; khâu dọn draft vẫn quét cả ô reply để
    // không sót bản nháp do phiên cũ để lại.
    const label=((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("aria-placeholder")||"")+" "+(el.getAttribute("placeholder")||"")).toLowerCase();
    return /(?:trả lời\s+(?:với\s+vai\s+trò|cho|lại)|reply(?:ing)?\s+(?:as|to)|respond(?:ing)?\s+to)/.test(label);
  }
  function findCommentBox(article){
    if(!article) return null;
    const boxes=[...article.querySelectorAll('div[contenteditable="true"], [role="textbox"]')].filter(el => {
      if(!isRenderedElement(el)) return false;
      if(isMessengerChatBox(el)) return false; // Không lấy ô chat Messenger
      if(isReplyCommentBox(el)) return false; // Không gõ vào ô Trả lời comment con
      const isEditable = el.isContentEditable || el.getAttribute("contenteditable")==="true" || el.getAttribute("role")==="textbox";
      if(!isEditable) return false;
      const label = ((el.getAttribute("aria-label")||"") + " " + (el.getAttribute("aria-placeholder")||"") + " " + (el.getAttribute("placeholder")||"")).toLowerCase();
      if(/(?:nhập tin nhắn|message|chat)/.test(label) && !/(?:bình luận|comment)/.test(label)) return false;
      return true;
    });
    return boxes[0] || null;
  }
  function exactCommentScopeForBox(box, identity, signature){
    if(!box || isMessengerChatBox(box)) return null;
    let node=box.parentElement, fallback=null;
    for(let depth=0;depth<18&&node;depth++,node=node.parentElement){
      if(node.getAttribute("role")==="dialog") fallback=node;
      const r=node.getBoundingClientRect(), style=getComputedStyle(node);
      if(style.position==="fixed"&&r.width>280&&r.height>220){fallback=node;break;}
    }
    if(!fallback) return null;
    if(identity&&postIdentity(fallback)===identity) return fallback;
    const wanted=String(signature||"").replace(/\s+/g," ").trim().toLowerCase().slice(0,60);
    const actual=String(fallback.innerText||fallback.textContent||"").replace(/\s+/g," ").trim().toLowerCase();
    return wanted&&actual.includes(wanted)?fallback:null;
  }
  function findExactCommentBox(article, identity, signature){
    const inline=findCommentBox(article);
    if(inline) return {box:inline,scope:article};
    // Một số layout Facebook mở khung "Bài viết" ngay trên Bảng tin thay vì
    // tạo contenteditable trong card gốc. Chỉ nhận ô trong lớp phủ khớp đúng
    // permalink hoặc phần đầu nội dung của bài hiện tại.
    const boxes=[...document.querySelectorAll('div[contenteditable="true"], [role="textbox"]')].filter(el=>{
      if(!isRenderedElement(el)||isMessengerChatBox(el)||isReplyCommentBox(el))return false;
      const label=((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("aria-placeholder")||"")+" "+(el.getAttribute("placeholder")||"")).toLowerCase();
      return !/(?:nhập tin nhắn|message|chat)/.test(label)||/(?:bình luận|comment)/.test(label);
    });
    for(const box of boxes){
      const scope=exactCommentScopeForBox(box,identity,signature);
      if(scope)return {box,scope};
    }
    return null;
  }
  function visibleCommentBoxes(){
    return [...document.querySelectorAll('div[contenteditable="true"], [role="textbox"]')].filter(el=>{
      if(!isRenderedElement(el)||isMessengerChatBox(el))return false;
      const label=((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("aria-placeholder")||"")+" "+(el.getAttribute("placeholder")||"")).toLowerCase();
      return !/(?:nhập tin nhắn|type a message|viết tin nhắn|tin nhắn|message|chat)/.test(label)||/(?:bình luận|comment)/.test(label);
    });
  }
  function rememberAIActivation(box,scope){
    aiActivationActive=true;
    if(box)aiActivationBox=box;
    if(scope)aiActivationScope=scope;
  }
  function clearAIActivationMemory(){
    aiActivationActive=false;
    aiActivationBox=null;
    aiActivationScope=null;
  }
  function aiDraftMatchesExpected(box){
    const actual=normalizeCommentComposerText(commentComposerText(box));
    const wanted=normalizeCommentComposerText(aiCommentDraftExpectedText);
    if(!actual||!wanted)return false;
    if(actual===wanted)return true;
    // Cho phép dọn một editor bị Facebook thay DOM giữa lúc đang gõ, nhưng
    // không nhận một bản nháp người dùng chỉ vì nó nằm trong cùng bài.
    const prefixLength=Math.min(8,wanted.length);
    return wanted.length>8&&actual.length>=prefixLength&&wanted.startsWith(actual);
  }
  function trackedAICommentDraftText(){
    return [aiCommentDraftBox,aiActivationBox].some(box=>box?.isConnected&&commentDraftText(box));
  }
  function aiTransitionScopes(){
    const scopes=[];
    for(const node of [aiCommentDraftScope,aiActivationScope,aiCommentDraftBox,aiActivationBox]){
      if(!node?.isConnected)continue;
      const scope=node.matches?.('[role="dialog"],[role="alertdialog"]')
        ? node
        : node.closest?.('[role="dialog"],[role="alertdialog"]');
      if(scope&&!scopes.includes(scope))scopes.push(scope);
    }
    return scopes;
  }
  function findAIActivationDialog(){
    return [...document.querySelectorAll('[role="dialog"]')].reverse().find(dialog=>{
      if(!isRenderedElement(dialog))return false;
      const text=String(dialog.innerText||dialog.textContent||"");
      return /bài viết|post|bình luận|comment/i.test(text);
    })||null;
  }
  async function cleanupAIActivation(reason=""){
    if(!aiActivationActive)return true;
    let box=aiActivationBox?.isConnected?aiActivationBox:null;
    let scope=aiActivationScope?.isConnected?aiActivationScope:null;
    scope=scope||findAIActivationDialog();
    if(box&&commentDraftText(box)){
      const cleared=aiDraftMatchesExpected(box)&&await clearAICommentDraft(box);
      if(!cleared){
        console.warn(`[AI] Không thể xóa bản nháp trước khi ${reason||"điều hướng"}`);
        chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
        return false;
      }
    }
    if(scope?.isConnected)await closeExactCommentOverlay(scope);
    clearAIActivationMemory();
    return true;
  }
  async function prepareAIPageTransition(reason=""){
    const warningScopes=aiTransitionScopes();
    const activationCleaned=await cleanupAIActivation(reason);
    const composerCleaned=activationCleaned&&await cleanupAICommentComposer(undefined,undefined,reason);
    // Chỉ chặn vì draft còn lại trong editor mà Comment AI đã theo dõi. Ô
    // comment của người dùng ở bài khác (hoặc composer khác đang visible) là
    // dữ liệu không thuộc state machine này và không được làm phiên dừng nhầm.
    // Cảnh báo rời trang cũng chỉ được quy cho lớp phủ do AI vừa mở.
    if(!composerCleaned||trackedAICommentDraftText()||(warningScopes.length&&aiLeaveWarningVisible(warningScopes))){
      isAICommenting=false;
      await chrome.storage.local.set({isAICommenting:false,pendingAIComment:false,aiStatus:t("ai2.transitionBlocked",{from:aiCount,to:aiTarget})});
      return false;
    }
    return true;
  }
  function aiLeaveWarningVisible(scopes=[]){
    const ownedScopes=Array.isArray(scopes)?scopes.filter(scope=>scope?.isConnected):[];
    if(!ownedScopes.length)return false;
    return [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(el=>{
      if(!isRenderedElement(el)||!/chưa hoàn tất bình luận|chưa hoàn thành bình luận|haven.t finished your comment|unfinished comment|leave (?:this )?page/i.test(el.innerText||el.textContent||""))return false;
      return ownedScopes.some(scope=>el===scope||el.contains(scope)||scope.contains(el));
    });
  }
  let aiFeedNavigationDispatched=false;
  async function navigateAIToMainFeed(){
    if(aiFeedNavigationDispatched)return true;
    if(!await prepareAIPageTransition("quay lại Bảng tin"))return false;
    const state=await chrome.storage.local.get(["isAICommenting","aiActiveConfig","pendingAIConfig"]);
    if(state.isAICommenting===false)return false;
    const ownerTabId=(await chrome.runtime.sendMessage({action:"getSenderTabId"}))?.tabId;
    const owner=state.aiActiveConfig?.ownerTabId||state.pendingAIConfig?.ownerTabId;
    if(owner&&owner!==ownerTabId)return false;
    await chrome.storage.local.set({pendingAIComment:true,pendingAIConfig:aiCommentRunConfig({ownerTabId})});
    if((await chrome.storage.local.get("isAICommenting")).isAICommenting===false)return false;
    aiFeedNavigationDispatched=true;
    location.assign("https://www.facebook.com/");
    return true;
  }
  function findCommentBoxOpenedByClick(previousBoxes){
    const opened=visibleCommentBoxes().filter(box=>!previousBoxes.has(box)&&!isReplyCommentBox(box));
    const box=opened.find(b=>b.closest('[role="dialog"]'))||opened[0]||null;
    if(!box)return null;
    const scope=box.closest('[role="dialog"]')||findFeedPostContainer(box)||box.parentElement;
    return {box,scope};
  }
  function findGroupPostDetailComposer(identity,signature){
    // Khi Facebook chuyển một bài nhóm sang permalink, nó vẫn giữ card cũ
    // phía sau lớp phủ. Hai card đều có thể có composer, nhưng chỉ composer
    // nằm trong lớp phủ mới là nơi người dùng đang nhìn thấy và là đích của
    // route permalink. Không cho phép fallback sang card nền trong trường
    // hợp này, nếu không chữ sẽ bị gõ "ở bên dưới" còn ô trong bài nổi trống.
    if(!identity||!isFacebookPostDetailPage()||!groupCommentRouteMatchesIdentity(identity))return null;
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(isRenderedElement).reverse();
    for(const dialog of dialogs){
      const boxes=[...dialog.querySelectorAll('div[contenteditable="true"], [role="textbox"]')].filter(box=>{
        if(!isRenderedElement(box)||isMessengerChatBox(box)||isReplyCommentBox(box))return false;
        const label=((box.getAttribute("aria-label")||"")+" "+(box.getAttribute("aria-placeholder")||"")+" "+(box.getAttribute("placeholder")||"")).toLowerCase();
        return !/(?:nhập tin nhắn|type a message|viết tin nhắn|tin nhắn|message|chat)/.test(label)||/(?:bình luận|comment)/.test(label);
      });
      if(!boxes.length)continue;
      // Một dialog xác nhận/nháp không phải bài viết không được dùng làm
      // fallback; dialog post phải chứa ngữ cảnh post/comment hoặc khớp
      // identity/signature đã chọn trước đó.
      const text=String(dialog.innerText||dialog.textContent||"");
      const matched=postIdentity(dialog)===identity||exactCommentScopeForBox(boxes[0],identity,signature)===dialog;
      if(matched||/(?:bài viết|post|bình luận|comment)/i.test(text))return {box:boxes[0],scope:dialog};
    }
    return null;
  }
  function findGroupCommentBoxOpenedByClick(previousBoxes,identity,signature){
    const detail=findGroupPostDetailComposer(identity,signature);
    if(detail&&!previousBoxes.has(detail.box))return detail;
    const opened=visibleCommentBoxes().filter(box=>!previousBoxes.has(box)&&!isReplyCommentBox(box));
    if(!opened.length)return null;
    const candidates=opened.map(box=>{
      const label=((box.getAttribute("aria-label")||"")+" "+(box.getAttribute("aria-placeholder")||"")+" "+(box.getAttribute("placeholder")||"")).toLowerCase();
      const exactScope=exactCommentScopeForBox(box,identity,signature);
      const postScope=findFeedPostContainer(box);
      const postMatches=!!(postScope&&identity&&postIdentity(postScope)===identity);
      // Route permalink chỉ là bằng chứng khi composer thuộc dialog chi tiết.
      // Không cộng điểm cho mọi ô ở card nền, vì Facebook giữ chúng sống phía
      // sau lớp phủ và chúng có thể trùng permalink do SPA render.
      const detailMatches=!!(box.closest('[role="dialog"]')&&identity&&groupCommentRouteMatchesIdentity(identity)&&isFacebookPostDetailPage());
      const mainLabel=/(?:bình luận|comment)/.test(label)&&!/(?:trả lời|reply)/.test(label);
      const score=(exactScope?100:0)+(postMatches?90:0)+(mainLabel?40:0)+(box.closest('[role="dialog"]')?20:0)+(detailMatches?10:0);
      return {box,scope:exactScope||postScope||box.closest('[role="dialog"]')||box.parentElement,score,exactScope,postMatches,detailMatches};
    }).sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    // Không lấy một composer mới của bài khác. Khi Facebook vừa mở trang
    // permalink, route + composer chính là bằng chứng đủ để nhận đúng bài;
    // trên feed thì phải khớp container/permalink của bài vừa bấm.
    if(!best||(!best.exactScope&&!best.postMatches&&!best.detailMatches))return null;
    return {box:best.box,scope:best.scope};
  }
  async function closeExactCommentOverlay(scope){
    if(!scope||scope===document.body||scope===document.documentElement)return;
    // Trên trang chi tiết bài (permalink), nút "Đóng/Quay lại" là nút điều
    // hướng của Facebook (history.back về feed), KHÔNG phải dismiss overlay —
    // bấm vào sẽ lôi phiên khỏi context đang xử lý (bắt live Bảng tin:
    // click Bình luận mở permalink → dọn draft bấm Đóng → văng về feed →
    // yank-cycle, aiCount kẹt 0). Draft text đã xóa ở bước trước nên ở đây
    // không còn gì để dọn; việc quay lại feed (nếu cần) do caller quyết định
    // rõ ràng bằng location.assign.
    try{if(typeof isFacebookPostDetailPage==="function"&&isFacebookPostDetailPage())return;}catch(_){}
    const close=[...scope.querySelectorAll('[role="button"],button')].filter(btn=>{
      if(!isRenderedElement(btn))return false;
      const label=buttonLabel(btn);
      return /^(đóng|close|thoát|quay lại|back)(?:\s|$)/i.test(label);
    });
    if(close[0]){try{await trustedMouse(close[0],"click");}catch(_){}}
  }
  function commentDraftText(box){
    if(!box)return "";
    return String(box.innerText??box.textContent??box.value??"")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").trim();
  }
  function normalizeCommentComposerText(value){
    return String(value||"")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g,"")
      .replace(/\u00A0/g," ")
      .replace(/\s+/g," ")
      .trim();
  }
  function commentComposerText(box){
    return normalizeCommentComposerText(box?.innerText??box?.textContent??box?.value??"");
  }
  async function waitForExactCommentDraft(box,expected,resolveReplacement,stillActive,timeout=5000){
    const wanted=normalizeCommentComposerText(expected);
    if(!wanted)return null;
    const deadline=Date.now()+timeout;
    let current=box;
    while(Date.now()<deadline){
      if(stillActive&&!await stillActive())return null;
      if(current?.isConnected&&normalizeCommentComposerText(commentComposerText(current))===wanted)return current;
      // Facebook can keep the old editor connected while mounting a new
      // editor for the same post. Inspect the resolver on every poll and
      // prefer a replacement that already contains the complete text.
      if(typeof resolveReplacement==="function"){
        const replacement=resolveReplacement(current)||null;
        if(replacement?.isConnected&&normalizeCommentComposerText(commentComposerText(replacement))===wanted)return replacement;
        if(replacement?.isConnected&&replacement!==current&&(!current?.isConnected||!commentComposerText(current)))current=replacement;
      }
      await sleep(150);
    }
    return null;
  }
  async function fillAndVerifyCommentBox(box,commentText,resolveReplacement,stillActive,typingGuard={}){
    if(!box?.isConnected||isMessengerChatBox(box))return {ok:false,reason:"box-timeout",box};
    // Không ghi đè bản nháp có sẵn của người dùng. Chỉ khi ô rỗng tại thời
    // điểm bắt đầu, tiện ích mới sở hữu ô đó và được phép dọn nếu nhập hụt.
    if(commentComposerText(box))return {ok:false,reason:"draft",box};
    // Facebook thường mount lại editor ngay sau khi mở khung bình luận.
    // Chờ editor ổn định và ưu tiên replacement cùng bài trước khi gõ để
    // không làm mất các code-point đầu câu khi React đổi node đang focus.
    await sleep(850);
    const readyReplacement=typeof resolveReplacement==="function"?resolveReplacement(box):null;
    if(readyReplacement?.isConnected&&readyReplacement!==box&&!commentComposerText(readyReplacement))box=readyReplacement;
    if(!box?.isConnected||isMessengerChatBox(box))return {ok:false,reason:"box-timeout",box};
    if(commentComposerText(box))return {ok:false,reason:"draft",box};
    try{box.focus();box.click();}catch(_){ }
    if(document.activeElement!==box&&!box.contains(document.activeElement))return {ok:false,reason:"box-timeout",box};
    let typed=await chrome.runtime.sendMessage({
      action:"trustedInput",
      text:commentText,
      pressEnter:false,
      // Gõ chậm, có nhịp ngẫu nhiên và dừng nhẹ sau dấu câu để giống người
      // thật hơn; vẫn xác nhận đủ nội dung trước khi cho phép gửi.
      typingConfig:typingGuard.typingConfig||aiTypingConfig,
      abortStorageKey:typingGuard.storageKey||"",
      abortRunId:typingGuard.runId||"",
      abortRunIdKey:typingGuard.runIdKey||""
    }).catch(()=>null);
    if(typed?.code==="ABORT_TYPING"){
      if(box?.isConnected)await clearAICommentDraft(box);
      return {ok:false,reason:"stopped",box};
    }
    if(!typed?.ok){
      try{box.focus();document.execCommand("insertText",false,commentText);}catch{ }
    }
    const exact=await waitForExactCommentDraft(box,commentText,resolveReplacement,stillActive);
    if(exact)return {ok:true,box:exact};
    // Không bao giờ bấm Gửi khi editor chỉ nhận một phần (ví dụ "Chuẩ")
    // hoặc Facebook vừa thay DOM giữa lúc nhập. Ô này ban đầu rỗng nên việc
    // dọn phần nhập hụt không chạm vào bản nháp của người dùng.
    // Facebook có thể thay hẳn composer trong lúc gõ. Khi đó box cũ vẫn còn
    // connected hoặc đã rời DOM, còn phần nhập hụt nằm ở một node mới; luôn
    // thử dọn cả replacement trước khi cho phép luồng đổi bài/đổi nhóm để
    // tránh hộp thoại "Rời khỏi trang?" và bản nháp bị bỏ lại.
    const replacement=typeof resolveReplacement==="function"?resolveReplacement():null;
    const cleanupCandidates=[];
    for(const candidate of [replacement,box]){
      if(candidate?.isConnected&&!cleanupCandidates.includes(candidate))cleanupCandidates.push(candidate);
    }
    for(const candidate of cleanupCandidates)await clearAICommentDraft(candidate);
    return {ok:false,reason:"typeincomplete",box};
  }
  function isAICommentComposer(box){
    if(!box?.isConnected||isMessengerChatBox(box))return false;
    const editable=box.isContentEditable||box.getAttribute("contenteditable")==="true"||box.getAttribute("role")==="textbox";
    if(!editable||box.getClientRects().length===0)return false;
    const label=((box.getAttribute("aria-label")||"")+" "+(box.getAttribute("aria-placeholder")||"")+" "+(box.getAttribute("placeholder")||"")).toLowerCase();
    return !/(?:nhập tin nhắn|type a message|viết tin nhắn|tin nhắn|message|chat)/.test(label)||/(?:bình luận|comment)/.test(label);
  }
  function findLiveAICommentDraftBox(scope,preferred){
    const preferredLive=isAICommentComposer(preferred);
    if(preferredLive&&aiDraftMatchesExpected(preferred))return preferred;
    const roots=[];
    for(const root of [scope,aiCommentDraftScope]){
      if(root?.isConnected&&!roots.includes(root))roots.push(root);
    }
    for(const root of roots){
      const candidate=[...root.querySelectorAll('div[contenteditable="true"],[role="textbox"]')]
        .find(box=>isAICommentComposer(box)&&aiDraftMatchesExpected(box));
      if(candidate)return candidate;
    }
    // Facebook đôi khi thay hẳn composer sau khi gửi/xác minh nhưng giữ
    // đúng bài trong một node mới. Tìm lại theo identity của bài, không lấy
    // draft không liên quan của người dùng ở bài khác.
    if(aiCommentDraftIdentity){
      const candidate=visibleCommentBoxes().find(box=>{
        if(!isAICommentComposer(box)||!aiDraftMatchesExpected(box))return false;
        const matched=exactCommentScopeForBox(box,aiCommentDraftIdentity,aiCommentDraftSignature);
        return !!matched;
      });
      if(candidate)return candidate;
    }
    return preferredLive?preferred:null;
  }
  async function clearAICommentDraft(box){
    if(!box?.isConnected||isMessengerChatBox(box))return true;
    if(!commentDraftText(box))return true;
    try{box.focus();box.click();}catch(_){ }
    // Facebook đôi khi nhận focus DOM nhưng không cập nhật composer nội bộ;
    // click tin cậy trước khi gửi phím giúp đồng bộ đúng editor trong modal.
    try{await trustedMouse(box,"click");}catch(_){ }
    // Facebook giữ draft ở contenteditable; Ctrl+A + Backspace qua CDP làm
    // thay đổi giống thao tác người dùng và cập nhật state nội bộ của Facebook.
    const selectModifier=/Mac|iPhone|iPad/i.test(navigator.platform||"")?4:2;
    try{await chrome.runtime.sendMessage({action:"trustedKey",key:"a",code:"KeyA",windowsVirtualKeyCode:65,modifiers:selectModifier});}catch(_){ }
    try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8});}catch(_){ }
    await sleep(250);
    if(commentDraftText(box)){
      // Fallback cho layout Facebook không nhận Ctrl+A từ debugger.
      try{
        const selection=window.getSelection(),range=document.createRange();
        range.selectNodeContents(box);selection.removeAllRanges();selection.addRange(range);
        try{document.execCommand("selectAll",false,null);}catch(_){ }
        document.execCommand("delete",false,null);
        box.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,inputType:"deleteContentBackward",data:null}));
        box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));
      }catch(_){ }
      await sleep(250);
    }
    if(commentDraftText(box)){
      // Last resort chỉ áp dụng cho composer đã được Comment AI sở hữu. Việc
      // phát sự kiện đầy đủ giúp React/Facebook ghi nhận trạng thái rỗng.
      try{
        box.textContent="";
        box.innerHTML="";
        try{document.execCommand("insertText",false,"");}catch(_){ }
        box.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,inputType:"deleteContentBackward",data:null}));
        box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));
        box.dispatchEvent(new Event("change",{bubbles:true}));
      }catch(_){ }
      await sleep(250);
    }
    return !commentDraftText(box);
  }
  async function cleanupAICommentComposer(scope=aiCommentDraftScope,box=aiCommentDraftBox,reason="",closeView=true){
    const draftScope=scope||aiCommentDraftScope;
    // Chỉ dọn composer mà Comment AI đã sở hữu. Trước đây khi đang xử lý
    // một bài đã có comment, helper quét mọi ô nhập trong scope và có thể
    // đụng vào bản nháp do người dùng tự gõ; nếu Facebook không cho xóa ô
    // đó, cả phiên bị báo "Đã dừng xử lý bài hiện tại" dù không phải lỗi AI.
    const ownedDraft=box||aiCommentDraftBox;
    const hasOwnedDraft=!!ownedDraft||!!aiCommentDraftIdentity;
    let draftBox=hasOwnedDraft?findLiveAICommentDraftBox(draftScope,ownedDraft):null;
    // Nếu editor đang được theo dõi vẫn có chữ nhưng chữ không còn khớp nội
    // dung AI dự kiến, đó có thể là người dùng vừa tiếp tục gõ. Không xóa nó;
    // báo blocked để caller giữ trang, tránh làm mất bản nháp.
    if(!draftBox){
      if(trackedAICommentDraftText()){
        chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
        return false;
      }
      return true;
    }
    let cleared=false;
    // Facebook có thể thay composer ngay trong lúc Ctrl+A/Backspace chạy.
    // Luôn tìm lại node do phiên AI sở hữu sau mỗi lần dọn, kể cả khi node
    // cũ báo thất bại; nếu chỉ retry trên node cũ, draft replacement sẽ giữ
    // phiên ở trạng thái active vô hạn.
    for(let attempt=0;attempt<4;attempt++){
      draftBox=findLiveAICommentDraftBox(draftScope,draftBox);
      if(!draftBox){
        if(!trackedAICommentDraftText()){
          aiCommentDraftBox=null;aiCommentDraftScope=null;
          aiCommentDraftIdentity="";aiCommentDraftSignature="";aiCommentDraftExpectedText="";
          if(closeView&&draftScope?.isConnected)await closeExactCommentOverlay(draftScope);
          return true;
        }
        await sleep(350);
        continue;
      }
      cleared=await clearAICommentDraft(draftBox);
      await sleep(250);
      const replacement=findLiveAICommentDraftBox(draftScope,draftBox);
      if(!replacement&&!trackedAICommentDraftText()){
        aiCommentDraftBox=null;aiCommentDraftScope=null;
        aiCommentDraftIdentity="";aiCommentDraftSignature="";aiCommentDraftExpectedText="";
        if(closeView&&draftScope?.isConnected)await closeExactCommentOverlay(draftScope);
        return true;
      }
      if(replacement)draftBox=replacement;
      if(!cleared)await sleep(Math.min(1200,350+attempt*300));
    }
    if(!cleared||trackedAICommentDraftText()){
      console.warn(`[AI] Không thể xóa bản nháp trước khi ${reason||"kết thúc thao tác"}`);
      chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
      return false;
    }
    if(draftBox===aiCommentDraftBox||!commentDraftText(aiCommentDraftBox)){
      aiCommentDraftBox=null;aiCommentDraftScope=null;
      aiCommentDraftIdentity="";aiCommentDraftSignature="";aiCommentDraftExpectedText="";
    }
    if(closeView&&draftScope?.isConnected)await closeExactCommentOverlay(draftScope);
    return true;
  }
  function findVisibleCommentBox(root=document){
    const boxes=[...root.querySelectorAll('div[contenteditable="true"], [role="textbox"]')].filter(el=>{
      if(!isRenderedElement(el)) return false;
      if(isMessengerChatBox(el)) return false; // Không lấy ô chat Messenger
      const isEditable = el.isContentEditable || el.getAttribute("contenteditable")==="true" || el.getAttribute("role")==="textbox";
      if(!isEditable) return false;
      const label = ((el.getAttribute("aria-label")||"") + " " + (el.getAttribute("aria-placeholder")||"") + " " + (el.getAttribute("placeholder")||"")).toLowerCase();
      if(/(?:nhập tin nhắn|message|chat)/.test(label) && !/(?:bình luận|comment)/.test(label)) return false;
      return true;
    });
    return boxes.find(b=>b.closest('[role="dialog"]') && !isMessengerChatBox(b))||boxes[0]||null;
  }
  function findCommentSendButton(box){
    if(!box) return null;
    const br=box.getBoundingClientRect();
    let node=box.parentElement;
    for(let depth=0;depth<7&&node;depth++,node=node.parentElement){
      const buttons=[...node.querySelectorAll('[role="button"],button')].filter(b=>{
        if(!isRenderedElement(b)||b.getAttribute("aria-disabled")==="true"||b.disabled) return false;
        const label=buttonLabel(b);
        if(/gửi nội dung|share|clip âm thanh|lượt thích|gif|nhãn dán|sticker|ảnh|camera|emoji|cảm xúc/.test(label)) return false;
        const r=b.getBoundingClientRect();
        const named=/^(đăng bình luận|post comment|gửi bình luận|send comment|gửi|send|bình luận|comment)/.test(label);
        const arrowPosition=r.left>=br.right-90 && r.top<br.bottom+15 && r.bottom>br.top && !!b.querySelector("svg");
        return named||arrowPosition;
      });
      const exact=buttons.find(b=>/^(đăng bình luận|post comment|gửi bình luận|send comment)$/.test(buttonLabel(b)));
      if(exact)return exact;
      if(buttons.length) return buttons[buttons.length-1];
    }
    return null;
  }
  function findCommentButton(article){
    if(!article) return null;

    if(article._commentBtn && isRenderedElement(article._commentBtn)){
      return article._commentBtn;
    }

    const buttons=[...article.querySelectorAll('[role="button"]')].filter(b=>{
      if(!isRenderedElement(b)) return false;
      const label=buttonLabel(b);
      if(!isMainCommentActionLabel(label)) return false;
      if(b.closest('ul')) return false;
      return true;
    });

    if(buttons.length > 0) return buttons[0];

    const candidates=[...article.querySelectorAll('div, span, a')].filter(el => {
      if(!isRenderedElement(el) || el.children.length > 2) return false;
      const text=(el.innerText || el.textContent || "").trim().toLowerCase();
      return /^(?:bình luận|viết bình luận|comment)$/i.test(text);
    });

    return candidates[0] || null;
  }
  function isFacebookPostDetailPage(){
    return location.hostname.endsWith("facebook.com")&&(
      /^\/groups\/[^/]+\/(?:permalink|posts)\/[^/]+/i.test(location.pathname)||
      /^\/[^/]+\/posts\/[^/]+/i.test(location.pathname)||
      /^\/(?:photo|story\.php|permalink\.php)/i.test(location.pathname)
    );
  }

  async function postAIComment(article, commentText, expectedIdentity, tagEntity=null){
    // Chỉ nhận bài được quét trực tiếp từ Bảng tin. Trang chi tiết chỉ được
    // dùng tiếp nếu chính nút Bình luận của bài này vừa mở nó.
    if(!isMainFacebookFeed())return "skip";
    if(!article?.isConnected){
      // Node bài có thể đã bị Bảng tin thay mới trong lúc chờ AI — tìm lại
      // đúng bài theo định danh, chỉ bỏ khi thật sự không còn.
      const refound=expectedIdentity?findFeedPostByIdentity(expectedIdentity):null;
      if(refound){ article=refound; article.dataset.aiFeedCandidate="1"; }
      else return "skip";
    }
    if(article.dataset.aiFeedCandidate!=="1")return "skip";
    if(isSponsoredPost(article,{ignoreGenericPreview:true}))return "skip";
    let currentArticle=article;
    const targetIdentity=expectedIdentity||postIdentity(currentArticle);
    const normalize=s=>String(s||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLowerCase();
    const proof=normalize(commentText).slice(0,60);
    const postSignature=normalize(extractPostText(currentArticle)).slice(0,60);
    let routeRetries=0,targetDetailOpened=false,commentActivationStarted=false;
    let boxWaitStartedAt=0,refindStartedAt=0;
    let activationPreviousBoxes=new Set(),activatedBox=null,activatedScope=null;
    const cleanupUnfinishedActivation=async()=>{
      // Facebook đôi khi mở lớp phủ bài viết nhưng chưa dựng contenteditable.
      // Chỉ đóng lớp phủ vừa xuất hiện sau cú click này; nếu ô đó đã có chữ,
      // coi là draft cần bảo toàn và dừng fail-closed thay vì xóa của người dùng.
      const opened=findCommentBoxOpenedByClick(activationPreviousBoxes)||(()=>{
        const dialog=[...document.querySelectorAll('[role="dialog"]')].find(d=>{
          if(!isRenderedElement(d))return false;
          const text=String(d.innerText||d.textContent||"");
          return /bài viết|post|bình luận|comment/i.test(text);
        });
        if(!dialog)return null;
        const box=visibleCommentBoxes().find(b=>b.closest('[role="dialog"]')===dialog);
        return {box:null,scope:dialog,openedWithoutBox:!box};
      })();
      if(!opened)return true;
      if(opened.box&&commentDraftText(opened.box))return false;
      await closeExactCommentOverlay(opened.scope);
      clearAIActivationMemory();
      return true;
    };
    const finishCommentView=async scope=>{
      // Facebook đôi lúc giữ composer cũ thêm vài nhịp, nhất là khi tab bị
      // background-throttle lúc màn hình tắt. Không kết thúc toàn bộ phiên
      // vì lỗi dọn giao diện tạm thời; giữ đúng bài và thử lại cho tới khi
      // người dùng bấm Dừng. Bộ đếm/lịch sử chỉ được cập nhật sau khi hàm
      // này trả về thành công.
      let cleanupAttempt=0;
      while(isAICommenting){
        const cleaned=await cleanupAICommentComposer(scope,undefined,"xác minh và rời bài");
        if(cleaned)break;
        cleanupAttempt++;
        if(cleanupAttempt>=5){
          await persistAICommentStop(t("ai2.draftBlocked",{from:aiCount,to:aiTarget}));
          return false;
        }
        await chrome.storage.local.set({aiStatus:t("ai2.draftRetry",{from:aiCount+1,to:aiTarget,attempt:cleanupAttempt})});
        await sleep(Math.min(3000,800+cleanupAttempt*400));
      }
      if(!isAICommenting)return false;
      if(targetDetailOpened){
        await chrome.storage.local.set({aiStatus:t("ai2.verified",{from:aiCount+1,to:aiTarget})});
        return returnToMainFeedViaHistory();
      }
      await closeExactCommentOverlay(scope);
      clearAIActivationMemory();
      return true;
    };

    // Chỉ kết thúc khi người dùng dừng hoặc đã tìm thấy và xác minh được
    // comment trong đúng container của bài hiện tại. Không chuyển sang bài
    // khác trong lúc đang chờ Facebook render.
    while(isAICommenting){
      if(!isMainFacebookFeed()&&!(targetDetailOpened&&isFacebookPostDetailPage())){
        const cleaned=await cleanupAICommentComposer(undefined,undefined,"quay lại Bảng tin");
        if(!cleaned){isAICommenting=false;return "stopped";}
        const returned=await returnToMainFeedViaHistory();
        if(!returned){
          await chrome.storage.local.set({pendingAIComment:true,pendingAIConfig:aiCommentRunConfig(),aiStatus:t("ai2.offFeed")});
          if(!await navigateAIToMainFeed())return "stopped";
          return "navigated";
        }
        currentArticle=null;
        await sleep(1000);
      }

      if(!targetDetailOpened&&(!currentArticle?.isConnected || (targetIdentity && postIdentity(currentArticle)!==targetIdentity))){
        currentArticle=findFeedPostByIdentity(targetIdentity);
        if(!currentArticle){
          if(!refindStartedAt)refindStartedAt=Date.now();
          const refindSeconds=Math.floor((Date.now()-refindStartedAt)/1000);
          if(refindSeconds>=20){
            const reloadState=await chrome.storage.local.get("aiFeedReloadAttempts");
            const reloadAttempts=(parseInt(reloadState.aiFeedReloadAttempts)||0)+1;
            if(reloadAttempts<=10){
              const cleaned=await cleanupUnfinishedActivation();
              if(!cleaned){
                await chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
                return "stopped";
              }
              await chrome.storage.local.set({
                pendingAIComment:true,
                pendingAIConfig:aiCommentRunConfig(),
                aiFeedReloadAttempts:reloadAttempts,
                isAICommenting:true,
                aiStatus:t("ai2.reloading",{n:reloadAttempts,from:aiCount,to:aiTarget})
              });
              if(!await prepareAIPageTransition("tải lại Bảng tin")||(await chrome.storage.local.get("isAICommenting")).isAICommenting===false)return "stopped";
              location.reload();
              return "page-reloading";
            }
            await chrome.storage.local.set({aiStatus:t("ai2.gaveUp",{from:aiCount,to:aiTarget}),aiFeedReloadAttempts:0});
            return "stopped";
          }
          chrome.storage.local.set({aiStatus:t("ai2.refinding",{from:aiCount,to:aiTarget})});
          await sleep(1000);
          continue;
        }
        refindStartedAt=0;
      }

      // Sau khi nút Bình luận đã mở đúng trang chi tiết, tuyệt đối không
      // bấm lại nút đó. Facebook có thể cần khá lâu mới dựng ô contenteditable.
      if(targetDetailOpened&&commentActivationStarted){
        const opened=findCommentBoxOpenedByClick(activationPreviousBoxes);
        const candidate=opened||(()=>{const b=visibleCommentBoxes().find(x=>x.closest('main'))||visibleCommentBoxes()[0];return b?{box:b,scope:findFeedPostContainer(b)||b.closest('main')||b.parentElement}:null;})();
        if(candidate){activatedBox=candidate.box;activatedScope=candidate.scope;currentArticle=candidate.scope;rememberAIActivation(candidate.box,candidate.scope);}
        else{
          await chrome.storage.local.set({aiStatus:t("ai2.waitBoxOpen",{from:aiCount,to:aiTarget})});
          await sleep(1000);
          continue;
        }
      }

      if(isSponsoredPost(currentArticle,{ignoreGenericPreview:true})){
        console.warn("[AI] Bài viết là quảng cáo / được tài trợ, bỏ qua bài này");
        return "skip";
      }
      if(currentArticle.querySelector('a[href*="/reel/"],a[href*="/watch/"],a[href^="https://l.facebook.com/l.php"],a[href^="http://l.facebook.com/l.php"]')) return "skip";

      try { currentArticle.scrollIntoView({behavior:"instant",block:"center"}); } catch {}
      await sleep(400);
      if(!currentArticle.isConnected) continue;

      let commentScope=currentArticle;
      let exactBox=findExactCommentBox(currentArticle,targetIdentity,postSignature);
      let box=exactBox?.box||activatedBox||null;
      if(exactBox)commentScope=exactBox.scope;
      else if(activatedBox&&activatedScope)commentScope=activatedScope;
      if(!box){
        if(commentActivationStarted){
          const opened=findCommentBoxOpenedByClick(activationPreviousBoxes);
          if(opened){box=opened.box;commentScope=opened.scope;activatedBox=box;activatedScope=commentScope;rememberAIActivation(box,commentScope);}
          if(!box){
            const waitedSec=boxWaitStartedAt?Math.max(1,Math.round((Date.now()-boxWaitStartedAt)/1000)):0;
            await chrome.storage.local.set({aiStatus:t("ai2.waitBoxSecs",{secs:waitedSec,from:aiCount,to:aiTarget})});
            // Facebook đôi khi giữ lớp phủ mở nhưng không dựng contenteditable;
            // chờ vô hạn sẽ làm phiên mắc kẹt và khi reload tạo cảnh báo
            // "Bạn chưa hoàn tất bình luận". Sau 60 giây, chỉ dọn lớp phủ do
            // chính Comment AI mở (draft có chữ thì fail-closed), giữ nguyên
            // bộ đếm/guard rồi reload có kiểm soát để dựng lại bài.
            if(waitedSec>=60){
              const cleaned=await cleanupUnfinishedActivation();
              if(!cleaned){
                await chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
                return "stopped";
              }
              const reloadState=await chrome.storage.local.get("aiFeedReloadAttempts");
              const reloadAttempts=(parseInt(reloadState.aiFeedReloadAttempts)||0)+1;
              if(reloadAttempts<=10){
                await chrome.storage.local.set({
                  pendingAIComment:true,
                  pendingAIConfig:aiCommentRunConfig(),
                  aiFeedReloadAttempts:reloadAttempts,
                  isAICommenting:true,
                  aiStatus:t("ai2.reloading",{n:reloadAttempts,from:aiCount,to:aiTarget})
                });
                if(!await prepareAIPageTransition("tải lại Bảng tin")||(await chrome.storage.local.get("isAICommenting")).isAICommenting===false)return "stopped";
                location.reload();
                return "page-reloading";
              }
              await chrome.storage.local.set({aiStatus:t("ai2.gaveUp",{from:aiCount,to:aiTarget}),aiFeedReloadAttempts:0});
              return "stopped";
            }
            await sleep(1000);
            continue;
          }
        }
      }
      if(!box){
        const commentBtn=findCommentButton(currentArticle);
        if(!commentBtn){
          chrome.storage.local.set({aiStatus:t("ai2.waitBtn",{from:aiCount,to:aiTarget})});
          await sleep(1000);
          continue;
        }

        activationPreviousBoxes=new Set(visibleCommentBoxes());
        commentActivationStarted=true;
        rememberAIActivation(null,currentArticle);
        boxWaitStartedAt=Date.now();
        try{commentBtn.click();}catch(_){ }
        await sleep(500);

        // Tuyệt đối không bình luận ở trang chi tiết hoặc trong nhóm. Nếu
        // click làm Facebook điều hướng, quay lại Bảng tin và thử lại bài này.
        if(!isMainFacebookFeed()){
          if(isFacebookPostDetailPage()){
            targetDetailOpened=true;
            await chrome.storage.local.set({aiStatus:t("ai2.detailOpened",{from:aiCount,to:aiTarget})});
          }else{
            routeRetries++;
            console.warn(`[AI] Nút Bình luận điều hướng sai khỏi bài hiện tại (lần ${routeRetries})`);
            chrome.storage.local.set({aiStatus:t("ai2.wrongRoute",{n:routeRetries})});
            const cleaned=await cleanupAICommentComposer(undefined,undefined,"xử lý route sai");
            if(!cleaned){isAICommenting=false;return "stopped";}
            const returned=await returnToMainFeedViaHistory();
            if(!returned){
              await chrome.storage.local.set({pendingAIComment:true,pendingAIConfig:aiCommentRunConfig(),aiStatus:t("ai2.findPost")});
              if(!await navigateAIToMainFeed())return "stopped";
              return "navigated";
            }
            currentArticle=null;
            await sleep(1000);
            continue;
          }
        }

        // Chờ vô hạn có kiểm soát cho chính bài này; không fallback sang
        // findVisibleCommentBox(document) vì có thể lấy nhầm bài khác.
        for(let wait=0; wait<30 && isAICommenting; wait++){
          await sleep(400);
          {
            const errDialog=[...document.querySelectorAll('[role="dialog"]')].find(d=>{
              const txt=String(d.innerText||d.textContent||"");
              return /trang này hiện không hiển thị|this page isn't available|something went wrong|đã xảy ra sự cố/i.test(txt);
            });
            if(errDialog){
              console.warn("[AI] Dialog lỗi bài không hiển thị, đóng và bỏ qua bài này");
              const closeBtn=errDialog.querySelector('[aria-label="Đóng"],[aria-label="Close"],[role="button"]');
              if(closeBtn)try{closeBtn.click();}catch(_){}
              commentActivationStarted=false;activationPreviousBoxes=new Set();
              clearAIActivationMemory();
              return "skip";
            }
          }
          if(!isMainFacebookFeed()){
            if(targetDetailOpened&&isFacebookPostDetailPage()){
              const opened=findCommentBoxOpenedByClick(activationPreviousBoxes);
              const fallback=opened||(()=>{const b=visibleCommentBoxes().find(x=>x.closest('main'))||visibleCommentBoxes()[0];return b?{box:b,scope:findFeedPostContainer(b)||b.closest('main')||b.parentElement}:null;})();
              if(fallback){box=fallback.box;commentScope=fallback.scope;currentArticle=commentScope;rememberAIActivation(box,commentScope);}
            }else{currentArticle=null;break;}
          }
           if(currentArticle?.isConnected){
             exactBox=findExactCommentBox(currentArticle,targetIdentity,postSignature);
             box=exactBox?.box||null;
             if(exactBox)commentScope=exactBox.scope;
           }
           if(!box){
            const opened=findCommentBoxOpenedByClick(activationPreviousBoxes);
            if(opened){box=opened.box;commentScope=opened.scope;rememberAIActivation(box,commentScope);}
           }
           if(!box){
            const replacement=findFeedPostByIdentity(targetIdentity);
            if(replacement){
              currentArticle=replacement;
              exactBox=findExactCommentBox(currentArticle,targetIdentity,postSignature);
              box=exactBox?.box||null;
              if(exactBox)commentScope=exactBox.scope;
            }
          }
          if(box) break;
          if(wait%5===4) chrome.storage.local.set({aiStatus:t("ai2.waitBoxDots",{secs:Math.ceil((wait+1)*0.4),from:aiCount,to:aiTarget})});
        }
        if(!isAICommenting) return "stopped";
        if(!box){
          const cleaned=await cleanupUnfinishedActivation();
          if(!cleaned){
            await chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
            return "stopped";
          }
          targetDetailOpened=false;
          commentActivationStarted=false;
          boxWaitStartedAt=0;
          activationPreviousBoxes=new Set();
          activatedBox=null;
          activatedScope=null;
          clearAIActivationMemory();
          currentArticle=null;
          chrome.storage.local.set({aiStatus:t("ai2.refinding",{from:aiCount,to:aiTarget})});
          await sleep(700);
          continue;
        }
        activatedBox=box;activatedScope=commentScope;
      }

      routeRetries=0;

      if(isMessengerChatBox(box)){
        console.warn("[AI] Phát hiện nhầm khung chat Messenger, tiếp tục tìm đúng ô comment trong bài");
        await sleep(1000);
        continue;
      }
      if(!targetDetailOpened&&targetIdentity && postIdentity(currentArticle)!==targetIdentity) continue;

      // Nếu comment đã tồn tại trong đúng bài (ví dụ phiên trước đã gửi),
      // coi bài là đã xử lý và không gửi lại.
      if(commentProofExists(commentScope,proof)||commentProofExists(currentArticle,proof)){
        console.log("[AI] Bài đã có comment này, không đăng lặp");
        return (await finishCommentView(commentScope))?"already-commented":"stopped";
      }

      try { box.scrollIntoView({behavior:"instant",block:"center"}); } catch {}
      await sleep(300);
      // Ưu tiên focus trực tiếp. Gọi chuột hệ thống dù ô đã focus có thể
      // trúng một khung Messenger nổi khi Facebook vừa render lại bố cục.
      let boxFocused=false;
      try{box.focus();box.click();boxFocused=document.activeElement===box||box.contains(document.activeElement);}catch(_){ }
      if(!boxFocused&&box.isConnected){
        try{await trustedMouse(box,"click");boxFocused=document.activeElement===box||box.contains(document.activeElement);}catch(_){ }
      }
      await sleep(300);
      if(!boxFocused||isMessengerChatBox(document.activeElement)){
        console.warn("[AI] Đang focus nhầm vào ô Messenger chat, tiếp tục tìm đúng ô comment");
        await sleep(1000);
        continue;
      }

      chrome.storage.local.set({aiStatus:t("ai2.typing",{from:aiCount,to:aiTarget})});
      aiCommentDraftBox=box;aiCommentDraftScope=commentScope;
      aiCommentDraftIdentity=targetIdentity||"";aiCommentDraftSignature=postSignature||"";
      aiCommentDraftExpectedText=normalizeCommentComposerText(commentText);
      // Chỉ nhập chữ ở bước này. Enter và click nút gửi trước đây cùng được
      // gọi, gây nguy cơ đăng một comment hai lần. Chờ đủ toàn bộ nội dung
      // trong đúng editor trước khi cho phép bấm Gửi.
      const filled=await fillAndVerifyCommentBox(
        box,
        commentText,
        (preferred)=>{
          const exact=findExactCommentBox(currentArticle,targetIdentity,postSignature);
          const exactBox=exact?.box||null;
          if(exactBox&&normalizeCommentComposerText(commentComposerText(exactBox))===normalizeCommentComposerText(commentText))return exactBox;
          const replacement=visibleCommentBoxes().find(candidate=>{
            if(!isAICommentComposer(candidate)||!commentDraftText(candidate))return false;
            return !!exactCommentScopeForBox(candidate,targetIdentity,postSignature);
          });
          return replacement||exactBox||preferred||null;
        },
        ()=>isAICommenting&&((chrome.storage.local.get("isAICommenting").then(state=>state.isAICommenting!==false))),
        {storageKey:"isAICommenting",typingConfig:aiTypingConfig}
      );
      if(filled.box?.isConnected)box=filled.box;
      if(!filled.ok){
        if(filled.reason==="draft"){
          await chrome.storage.local.set({aiStatus:t("ai2.draftBlocked",{from:aiCount,to:aiTarget})});
          return "stopped";
        }
        if(filled.reason==="stopped"){
          await cleanupAICommentComposer(commentScope,box,"Dừng");
          isAICommenting=false;
          return "stopped";
        }
        await cleanupAICommentComposer(commentScope,box,"thử lại bước nhập",false);
        chrome.storage.local.set({aiStatus:t("ai2.typeFailRetry",{from:aiCount,to:aiTarget})});
        await sleep(1000);
        continue;
      }
      // Khóa bài trước cú gửi (lõi chung không tự khóa). Giữ đúng thứ tự cũ:
      // khóa → kiểm tra Dừng → gửi.
      const guardKey=targetIdentity||postIdentity(currentArticle);
      const guardStored=await chrome.storage.local.get("aiCommentSubmissionGuard");
      const submissionGuard=guardStored.aiCommentSubmissionGuard&&typeof guardStored.aiCommentSubmissionGuard==="object"?guardStored.aiCommentSubmissionGuard:{};
      if(guardKey){submissionGuard[guardKey]={time:Date.now(),source:"feed",state:"submitting"};await chrome.storage.local.set({aiCommentSubmissionGuard:submissionGuard});}
      const liveAtSubmit=await chrome.storage.local.get("isAICommenting");
      if(!isAICommenting||liveAtSubmit.isAICommenting===false) {
        await cleanupAICommentComposer(commentScope,box,"Dừng");
        isAICommenting=false;
        return "stopped";
      }
      // Tag + alive-check trước gửi do lõi chung lo (unifiedSendProofDwell).
      // Gửi + proof + nán qua lõi chung của Bản tin & AI (tag/không tag một cơ chế).
      const sendRes=await unifiedSendProofDwell({
        box, commentScope, proof, tagEntity, tagConfig:aiTagConfig,
        alive:async()=>{ if(!isAICommenting)return false; const s=await chrome.storage.local.get("isAICommenting"); return s.isAICommenting!==false; },
        onEvent:(name)=>{
          if(name==="verifying")chrome.storage.local.set({aiStatus:t("ai2.sentVerifying",{from:aiCount+1,to:aiTarget})});
          else if(name==="waitProof")chrome.storage.local.set({aiStatus:t("ai2.waitProof",{from:aiCount+1,to:aiTarget})});
          else if(name==="unconfirmed")chrome.storage.local.set({aiStatus:t("ai2.unconfirmedLock",{from:aiCount,to:aiTarget})});
        },
        clearDraft:()=>cleanupAICommentComposer(commentScope,box,"lõi chung"),
        findSend:()=>{ const b=findCommentSendButton(box); return (b&&!isMessengerChatBox(b))?b:null; },
        sendEnter:()=>chrome.runtime.sendMessage({action:"trustedInput",text:"",pressEnter:true,typingMinDelay:0,typingMaxDelay:0}).then(r=>!!r?.ok).catch(()=>false),
        onProofTick:async()=>{
          if(!isMainFacebookFeed()&&!(targetDetailOpened&&isFacebookPostDetailPage())){
            const cleaned=await cleanupAICommentComposer(undefined,undefined,"xác minh sau khi Facebook lạc route");
            if(!cleaned){isAICommenting=false;return "stopped";}
            const returned=await returnToMainFeedViaHistory();
            if(!returned){
              await chrome.storage.local.set({pendingAIComment:true,pendingAIConfig:aiCommentRunConfig(),aiStatus:t("ai2.sentOffFeed")});
              if(!await navigateAIToMainFeed())return "stopped";
              return "navigated";
            }
          }
          let scope=commentScope;
          if(!scope?.isConnected){
            scope=findFeedPostByIdentity(targetIdentity);
            if(scope)currentArticle=scope;
          }
          return null;
        },
        proofRoots:()=>[commentScope,currentArticle],
        scrollIntoView:()=>{ try{(currentArticle&&currentArticle.isConnected?currentArticle:commentScope)?.scrollIntoView?.({behavior:"smooth",block:"center"});}catch(_){} },
        onCounted:async (hit)=>{
          // Proof đã xác nhận ở trên: dù dọn overlay/quay feed trục trặc
          // (returnToMainFeedViaHistory false) vẫn phải tính bài đã đăng —
          // vòng lặp sẽ tự về feed ở lượt sau. Mất đếm ở đây từng làm ca
          // dừng 0/3 dù comment đã hiện (bắt live 29/10).
          try{ if(await finishCommentView(hit))return true; }catch(e){
            try{logActivity("tag","@lõi chung onCounted lỗi: "+String(e?.message||e).slice(0,120));}catch(_){}
          }
          try{
            const s=await chrome.storage.local.get("isAICommenting");
            if(isAICommenting&&s.isAICommenting!==false){
              try{logActivity("tag","@lõi chung giữ đếm dù finishCommentView trục trặc (proof đã thấy)");}catch(_){}
              return true;
            }
          }catch(_){}
          return false;
        },
      });
      if(sendRes==="navigated")return "navigated";
      if(sendRes==="stopped"||sendRes==="tag-proof-missing"){
        if(sendRes==="tag-proof-missing")await cleanupAICommentComposer(commentScope,box,"Không có proof tag");
        return "stopped";
      }
      if(sendRes==="skip"){
        await cleanupAICommentComposer(commentScope,box,"thử lại vì chưa có nút gửi",false);
        if(guardKey){delete submissionGuard[guardKey];await chrome.storage.local.set({aiCommentSubmissionGuard:submissionGuard});}
        chrome.storage.local.set({aiStatus:t("ai2.noSendBtn",{from:aiCount,to:aiTarget})});
        await sleep(1000);
        continue;
      }
      if(sendRes==="unconfirmed-skip"){
        return (await finishCommentView(commentScope))?"unconfirmed-skip":"stopped";
      }
      if(sendRes!==true)return "stopped";
      return true;
    }
    return "stopped";
  }

  async function feedInteractLoop(){
    if(!location.href.includes("facebook.com")){
      chrome.storage.local.set({ pendingFeedInteract: true, pendingFeedConfig: { target: feedTarget, minDelay: feedMinDelay/1000, maxDelay: feedMaxDelay/1000, reaction: feedReaction } });
      location.href = "https://www.facebook.com/";
      return;
    }
    if(!isMainFacebookFeed()){
      chrome.storage.local.set({ pendingFeedInteract: true, pendingFeedConfig: { target: feedTarget, minDelay: feedMinDelay/1000, maxDelay: feedMaxDelay/1000, reaction: feedReaction }, feedStatus:t("p.fdOpening") });
      location.href = "https://www.facebook.com/";
      return;
    }
    chrome.storage.local.remove(["pendingFeedInteract"]);
    isFeedInteracting=true;
    feedCount=0;
    chrome.storage.local.set({ feedStatus:t("fd2.starting"), feedCount:0, isFeedInteracting:true });
    let idle=0;
    let scrollTries=0;
    while(isFeedInteracting && feedCount < feedTarget){
      let btns = findFeedLikeButtons();
      // debug log
      if(btns.length>0) console.log(`[Feed] tim thay ${btns.length} nut Like bai goc`);
      if(btns.length===0){
        idle++;
        // tu dong scroll lien tuc thay vi bao xong ngay
        if(idle>=2){
          window.scrollTo(0, document.body.scrollHeight);
          await sleep(3000);
          scrollTries++;
          btns=findFeedLikeButtons();
          if(btns.length>0){ idle=0; scrollTries=0; }
          else if(idle>=20 || scrollTries>=18){
            if(feedCount===0){
              chrome.storage.local.set({ feedStatus:t("fd2.noButtons",{n:scrollTries}) });
            } else {
              chrome.storage.local.set({ feedStatus:t("fd2.outOfPosts",{done:feedCount,target:feedTarget}) });
            }
            break;
          }
        } else { window.scrollBy(0,900); await sleep(1800); continue; }
      } else { idle=0; scrollTries=0; }
      for(const btn of btns){
        if(!isFeedInteracting || feedCount>=feedTarget) break;
        const actionBar=findMainActionBar(btn);
        const art=findFeedPostContainer(btn);
        btn.scrollIntoView({behavior:"smooth", block:"center"});
        await sleep(600);
          try{
            // Facebook co the tai lai/recycle DOM sau khi cuon. Kiem tra lai de
            // khong bam vao mot nut vua bi doi sang bai khac.
          if(!isValidFeedLike(btn, actionBar)) continue;
          const liveBeforeReact=await chrome.storage.local.get("isFeedInteracting");
          if(!isFeedInteracting||liveBeforeReact.isFeedInteracting===false){isFeedInteracting=false;break;}
          const result = await doReact(btn, feedReaction);
          if(!result.success){
            console.warn(`[Feed] Facebook khong ghi nhan ${result.used}, bo qua bai nay`);
            btn.dataset.feedInteracted="1";
            continue;
          }
          const used=result.used;
          btn.dataset.feedInteracted="1";
          if(art) art.dataset.feedInteracted="1";
          if(art) art.style.outline="2px solid #1877F2";
          else btn.style.outline="2px solid #1877F2";
          feedCount++;
          chrome.storage.local.set({ feedCount, feedStatus:t("fd2.reacted",{reaction:used,done:feedCount,target:feedTarget}) });
        }catch(e){ console.warn(e); }
        if(feedCount>=feedTarget) break;
        await sleep(rand(feedMinDelay, feedMaxDelay));
        if(!isFeedInteracting) break;
      }
      if(feedCount>=feedTarget) break;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(2000);
    }
    const feedStillActive=await chrome.storage.local.get("isFeedInteracting");
    if(!isFeedInteracting||feedStillActive.isFeedInteracting===false)return;
    isFeedInteracting=false;
    if(feedCount===0){
      chrome.storage.local.set({ isFeedInteracting:false, feedStatus:t("fd2.zeroFound",{target:feedTarget}) });
    } else {
      chrome.storage.local.set({ isFeedInteracting:false, feedStatus:t("fd2.doneAll",{done:feedCount,target:feedTarget}) });
    }
  }

  function isMainFacebookFeed(){return location.hostname.endsWith("facebook.com")&&(location.pathname==="/"||location.pathname==="/home.php");}
  async function returnToMainFeedViaHistory(){
    const warningScopes=aiTransitionScopes();
    if(!await prepareAIPageTransition("quay lại Bảng tin"))return false;
    if(isMainFacebookFeed())return true;
    // Only one back action: repeated history.go queued leave prompts and
    // eventually landed on an unrelated old group. Stop during every wait.
    if((await chrome.storage.local.get("isAICommenting")).isAICommenting===false)return false;
    const previousUrl=location.href;
    history.go(-1);
    for(let i=0;i<32;i++){
      await sleep(250);
      if((await chrome.storage.local.get("isAICommenting")).isAICommenting===false||aiLeaveWarningVisible(warningScopes))return false;
      if(isMainFacebookFeed())return true;
      if(location.href!==previousUrl)break;
    }
    return false;
  }
  async function aiCommentLoop(resume=false){
    if(!isMainFacebookFeed()){
      chrome.storage.local.set({ pendingAIComment: true, pendingAIConfig: aiCommentRunConfig() });
      await navigateAIToMainFeed();
      return;
    }
    chrome.storage.local.remove(["pendingAIComment"]);
    isAICommenting=true;
    if(!resume)aiCount=0;
    let loopOwnerTabId=0;
    try{loopOwnerTabId=(await chrome.runtime.sendMessage({action:"getSenderTabId"}))?.tabId||0;}catch{}
    chrome.storage.local.set({ aiStatus:resume?t("ai2.resumed",{from:aiCount,to:aiTarget}):t("ai2.starting"), aiCount, isAICommenting:true,aiActiveConfig:aiCommentRunConfig({ownerTabId:loopOwnerTabId}) });
    let idle=0;
    let sawPost=false;
    let lastAiFailure="";
    const cacheStored=await chrome.storage.local.get(["aiCommentCache","aiRecentPostKeys","aiRecentPostContentKeys","aiCommentHistory","aiCommentSubmissionGuard"]),commentCache=cacheStored.aiCommentCache||{};
    const commentHistory=cacheStored.aiCommentHistory&&typeof cacheStored.aiCommentHistory==="object"?cacheStored.aiCommentHistory:{};
    const submissionGuard=cacheStored.aiCommentSubmissionGuard&&typeof cacheStored.aiCommentSubmissionGuard==="object"?cacheStored.aiCommentSubmissionGuard:{};
    const persistedCommentedKeys=new Set(Array.isArray(cacheStored.aiRecentPostKeys)?cacheStored.aiRecentPostKeys:[]);
    const seenContentKeys=new Set(Array.isArray(cacheStored.aiRecentPostContentKeys)?cacheStored.aiRecentPostContentKeys:[]);
    Object.values(commentHistory).forEach(entry=>{if(entry?.contentKey)seenContentKeys.add(String(entry.contentKey));});
    for(const key of persistedCommentedKeys)if(!commentHistory[key])commentHistory[key]={time:0,legacy:true};
    const seenPostKeys = new Set([...persistedCommentedKeys,...Object.keys(commentHistory),...Object.keys(submissionGuard)]);
    // Chỉ dùng trong phiên hiện tại: Facebook có thể recycle card trong lúc
    // chờ API nhanh (Gemini), khiến node cũ rời DOM và identity cũng không còn
    // tìm lại được. Nếu không nhớ card này, vòng for gọi AI lại liên tục nhưng
    // `foundNew=true`, nên idle/reload guard không bao giờ chạy và counter treo.
    const staleCandidateKeys=new Set();
    const cacheMaxAge=Math.max(0,aiCacheDays)*86400000;let apiRequests=0,cacheHits=0;
    for(const [k,v] of Object.entries(commentCache)){if(!v?.time||Date.now()-v.time>cacheMaxAge)delete commentCache[k];}
    // Dùng chung công tắc kiểm duyệt AI với Bảng feed (checkbox nằm cùng
    // panel), để Comment AI độc lập cũng được bảo vệ như 3 luồng kia.
    const aiModerationEnabled=!!(await chrome.storage.sync.get("feedAiModerationEnabled")).feedAiModerationEnabled;
    while(isAICommenting && aiCount < aiTarget){
      void aiHeartbeat("scan");
      const articles = findFeedPosts();
      if(articles.length) sawPost=true;
      let foundNew=false;
      for(let artIndex=0;artIndex<articles.length;artIndex++){
        const art=articles[artIndex];
        if(!isAICommenting || aiCount>=aiTarget) break;
        if(!isMainFacebookFeed()){await navigateAIToMainFeed();return;}
        if(art.dataset.aiCommented==="1") continue;
        if(art.dataset.aiFeedCandidate!=="1"||isSponsoredPost(art,{ignoreGenericPreview:true})){
          chrome.storage.local.set({aiStatus:t("ai2.adSkipped",{from:aiCount,to:aiTarget})});
          continue;
        }
        if(isSensitiveOrIncitingPost(art)){
          chrome.storage.local.set({aiStatus:t("ai2.sensitiveSkipped",{from:aiCount,to:aiTarget})});
          continue;
        }
        const postKey=postIdentity(art);
        try{await expandArticleSeeMore(art);}catch(_){}
        const text = extractPostText(art);
        if(!text || text.trim().length < 15){
          console.warn("[AI] Không lấy được đủ nội dung bài viết để tạo comment, bỏ qua bài này");
          chrome.storage.local.set({aiStatus:t("ai2.unreadable",{from:aiCount,to:aiTarget})});
          continue;
        }
        const contentKey=postContentKey(text);
        if(staleCandidateKeys.has(postKey)||(contentKey&&staleCandidateKeys.has(contentKey)))continue;
        if(seenPostKeys.has(postKey)||contentKey&&seenContentKeys.has(contentKey)) continue;
        if(hasOwnComment(art)){
          seenPostKeys.add(postKey);
          if(contentKey)seenContentKeys.add(contentKey);
          console.log("[AI] Bài đã có comment của tài khoản, bỏ qua để chống trùng");
          continue;
        }
        // Sổ cái chữ ký: chặn đăng trùng chéo phiên/tag-không-tag.
        if(await postSigMarked(text)){seenPostKeys.add(postKey);continue;}
        if(aiModerationEnabled&&await isAiFlaggedSensitivePost(art,{aiConfig:{}})){
          chrome.storage.local.set({aiStatus:t("ai2.sensitiveSkipped",{from:aiCount,to:aiTarget})});
          continue;
        }
        if(aiRunMode==="like"){
          // Chế độ chỉ Like: không sinh comment, chỉ bấm Like có proof đổi
          // trạng thái nút (giống chuẩn doReact của Bảng feed). Đếm sau khi
          // Facebook xác nhận, bỏ qua âm thầm nếu đã Like/không bấm được.
          const likeBtn=[...art.querySelectorAll('[role="button"],button')].find(b=>{
            const r=b.getBoundingClientRect();if(!r.width||!r.height)return false;
            const lb=((b.getAttribute("aria-label")||b.innerText)||"").trim();
            return /^(thích|thich|like)$/i.test(lb);
          });
          let liked=false;
          if(likeBtn){
            const actionBar=(typeof findMainActionBar==="function")?findMainActionBar(likeBtn):null;
            if((typeof isValidFeedLike!=="function")||isValidFeedLike(likeBtn,actionBar)){
              try{
                const result=await doReact(likeBtn,aiReactionPref,()=>isAICommenting);
                if(result&&result.success)liked=true;
              }catch(e){}
            }
          }
          seenPostKeys.add(postKey);
          if(contentKey)seenContentKeys.add(contentKey);
          if(liked){
            aiCount++;
            await chrome.storage.local.set({aiCount,aiStatus:t("ai2.likedCount",{from:aiCount,to:aiTarget})});
          }
          if(aiCount<aiTarget){
            const delayMs=rand(aiMinDelay,aiMaxDelay),nextAt=Date.now()+delayMs;
            await chrome.storage.local.set({aiStatus:t("ai2.waitNextLike",{from:aiCount,to:aiTarget,secs:Math.ceil(delayMs/1000)})});
            while(isAICommenting&&Date.now()<nextAt){
              await sleep(Math.min(1000,nextAt-Date.now()));
            }
          }
          continue;
        }
        // bo bai da tuong tac qua roi? van comment duoc
        art.scrollIntoView({behavior:"smooth", block:"center"});
        await sleep(800);
        let commentText = "";
        const cacheKey=contentKey||commentCacheKey(text);
        // Bài trúng tag: sinh riêng bằng prompt tag (định hướng entity + luân
        // phiên vị trí), không dùng cache/batch chung để khỏi lẫn câu thường.
        let aiPostTagEntity=null;
        if(aiTagConfig){
          try{
            aiPostTagEntity=decideTagForPost(aiTagConfig,aiCount);
            if(aiPostTagEntity){
              const stored=await chrome.storage.sync.get(["aiTagPrompt"]);
              // aiTagPrompt có thể chưa từng được lưu (user chưa đụng tới ô
              // prompt) — buildTagPrompt("") chỉ còn mỗi câu chỉ dẫn vị trí,
              // AI trả về câu lạc đề/không nhúng tên. Fallback prompt tag chuẩn.
              const rawTagPrompt=String(stored.aiTagPrompt||"").trim()||t("fd.aiTagPromptDefault");
              const tagPrompt=buildTagPrompt(rawTagPrompt,aiPostTagEntity.name);
              const res=await sendAiMessageWithTimeout({action:"aiGenerateComment",postText:text.slice(0,500),prompt:tagPrompt,maxLines:2,aiConfig:aiRunProfile||{}});apiRequests++;
              if(!res?.ok)throw new Error(res?.error||t("ai2.genFail"));commentText=stripLiteralTagEntity(res.comment,aiPostTagEntity.name);
            }
          }catch(e){console.warn("[AI] tag comment rieng loi, dung cau mau",e);commentText=fallbackComment(text);aiPostTagEntity=null;}
        }
        try{logActivity("tag","[ai] decide: cfg="+(!!aiTagConfig)+" ent="+(aiPostTagEntity?aiPostTagEntity.name.slice(0,30):"null"));}catch(_){}
        if(!aiPostTagEntity&&!commentText){
        if(cacheMaxAge&&commentCache[cacheKey]?.comment){commentText=commentCache[cacheKey].comment;cacheHits++;}
        else if(aiEconomyMode==="max")commentText=fallbackComment(text);
        else try{
          if(aiEconomyMode==="personal"){
            const res=await sendAiMessageWithTimeout({action:"aiGenerateComment",postText:text.slice(0,500),prompt:aiBasePrompt||"",aiConfig:aiRunProfile||{}});apiRequests++;
            if(!res?.ok)throw new Error(res?.error||t("ai2.genFail"));commentText=res.comment;
            if(cacheMaxAge)commentCache[cacheKey]={comment:commentText,time:Date.now()};
          }else{
            // Luôn đưa bài hiện tại vào batch. Trước đây việc đọc lại DOM sau
            // khi cuộn có thể trả về chuỗi rỗng, khiến request được gửi với
            // posts=[] và bị báo nhầm là lỗi API.
            const batch=[text.slice(0,500)];
            const batchKeys=new Set([cacheKey]);
            for(const candidate of articles.slice(artIndex+1)){
              try{await expandArticleSeeMore(candidate);}catch(_){}
              const tx=extractPostText(candidate);
              const candidateKey=tx&&tx.length>=15?postContentKey(tx):"";
              if(tx&&tx.length>=15&&!batchKeys.has(candidateKey)&&!commentCache[candidateKey]){
                batch.push(tx.slice(0,500));
                batchKeys.add(candidateKey);
              }
              if(batch.length>=aiBatchSize)break;
            }
            // Batch meta-free hỏi nối tiếp từng bài nên trần phải rộng hơn
            // single (mặc định 150s): chậm thật thì fallback, treo mất phản
            // hồi thì cũng chỉ kẹt tối đa 10 phút thay vì vĩnh viễn.
            const res=await sendAiMessageWithTimeout({action:"aiGenerateCommentBatch",posts:batch,prompt:aiBasePrompt||"",aiConfig:aiRunProfile||{}},600000);apiRequests++;
            if(!res?.ok)throw new Error(res?.error||t("ai2.genBatchFail"));
            batch.forEach((tx,i)=>{if(res.comments?.[i]){const key=postContentKey(tx)||commentCacheKey(tx);commentCache[key]={comment:res.comments[i],time:Date.now()};}});
            commentText=commentCache[cacheKey]?.comment||res.comments?.[0]||"";
          }
          await chrome.storage.local.set({aiCommentCache:commentCache,aiApiRequests:apiRequests,aiCacheHits:cacheHits});
        }catch(e){console.warn("[AI] dung cau mau du phong",e);lastAiFailure=`API lỗi, đang dùng câu mẫu dự phòng: ${e.message}`;commentText=fallbackComment(text);chrome.storage.local.set({aiStatus:lastAiFailure});}
        }
        // Chuan hoa lan cuoi de ca comment cu trong cache cung khong con dau ! o cuoi.
        commentText=sanitizeCommentOutput(String(commentText||"").trim()).replace(/[!！]+\s*$/g,"").trimEnd();
        if(!commentText) continue;
        let liveArt = (art && art.isConnected) ? art : null;
        if(!liveArt && postKey){
          // Bảng tin ảo hóa node trong lúc cuộn/chờ AI — tìm lại đúng bài
          // theo định danh thay vì bỏ qua.
          chrome.storage.local.set({aiStatus:t("ai2.refound",{from:aiCount,to:aiTarget})});
          liveArt = findFeedPostByIdentity(postKey);
          if(liveArt) liveArt.dataset.aiFeedCandidate="1";
        }
        if(!liveArt){
          if(postKey)staleCandidateKeys.add(postKey);
          if(contentKey)staleCandidateKeys.add(contentKey);
          console.warn("[AI] Bài đã rời khỏi DOM và không tìm lại được, bỏ qua bài này");
          chrome.storage.local.set({aiStatus:t("ai2.refoundGone",{from:aiCount,to:aiTarget})});
          continue;
        }
        foundNew=true;
        let ok=false,attemptError="";
        void aiHeartbeat("post");
        try{ ok=await postAIComment(liveArt,commentText,postKey,aiPostTagEntity); }
        catch(e){ console.warn("[AI] comment loi",e); attemptError=`Lỗi đăng bình luận: ${e.message}`;lastAiFailure=attemptError; chrome.storage.local.set({aiStatus:lastAiFailure}); }
        if((ok===false||ok==null)&&!attemptError)ok="unconfirmed";
        if(ok==="stale"){
          lastAiFailure=t("ai2.staleKept");
          chrome.storage.local.set({aiStatus:lastAiFailure});
          isAICommenting=false;
          break;
        }
        if(ok==="skip"){console.log("[AI] Bỏ qua bài không đủ điều kiện, không phải lỗi comment");continue;}
        if(ok==="box-timeout"||ok==="unconfirmed"){
          // Không được đánh dấu thành công hoặc chuyển bài khi chưa xác minh
          // comment xuất hiện đúng trong bài hiện tại.
          lastAiFailure=t("ai2.unconfirmedRetry");
          chrome.storage.local.set({aiStatus:lastAiFailure});
          // Nếu một phiên bản Facebook cũ trả về trạng thái này, lùi chỉ số
          // để vòng for thử lại đúng bài; tuyệt đối không nhảy sang bài kế.
          artIndex=Math.max(-1,artIndex-1);
          continue;
        }
        if(ok==="unconfirmed-skip"){
          // Đã bấm gửi nhưng Facebook không trả bằng chứng: giữ khóa bài để
          // lần sau không gửi trùng, đồng thời vẫn cho phép phiên chạy tiếp.
          seenPostKeys.add(postKey);
          if(contentKey){
            seenContentKeys.add(contentKey);
            await chrome.storage.local.set({aiRecentPostContentKeys:[...seenContentKeys].slice(-500)});
          }
          continue;
        }
        if(ok==="stopped"){
          const liveStopped=await chrome.storage.local.get("isAICommenting");
          if(liveStopped.isAICommenting===false)return;
          lastAiFailure=t("ai2.stoppedPost");
          await persistAICommentStop(lastAiFailure);
          break;
        }
        if(ok==="page-reloading"){
          return;
        }
        if(ok==="navigated"){
          await navigateAIToMainFeed();return;
        }
        if(ok===true||ok==="already-commented"){
          if(liveArt.isConnected){
            liveArt.dataset.aiCommented="1";
            liveArt.style.outline="2px solid #9c27b0";
          }
          aiCount++;
          persistedCommentedKeys.add(postKey);
          seenPostKeys.add(postKey);
          if(contentKey)seenContentKeys.add(contentKey);
          commentHistory[postKey]={time:Date.now(),source:"feed",contentKey:contentKey||""};
          await markPostSig(text);
          const recentKeys=[...persistedCommentedKeys].slice(-500);
          const recentContentKeys=[...seenContentKeys].slice(-500);
          const handledAsExisting=ok==="already-commented";
          chrome.storage.local.set({ aiCount, aiApiRequests:apiRequests,aiCacheHits:cacheHits,aiRecentPostKeys:recentKeys,aiRecentPostContentKeys:recentContentKeys,aiCommentHistory:commentHistory,aiFeedReloadAttempts:0,aiStatus:handledAsExisting?t("ai2.existing",{from:aiCount,to:aiTarget}):t("ai2.counted",{from:aiCount,to:aiTarget,api:apiRequests,hits:cacheHits}) });
          console.log(handledAsExisting?`[AI] Bài đã có comment, bỏ qua đăng lặp (${aiCount})`:`[AI] Comment ${aiCount}: ${commentText}`);
          // Chế độ Comment + Like: thả Like cho đúng bài vừa comment (best-effort).
          if(ok===true&&aiLikeAfterComment&&liveArt.isConnected){
            try{
              const likeBtn=[...liveArt.querySelectorAll('[role="button"],button')].find(b=>{
                const r=b.getBoundingClientRect();if(!r.width||!r.height)return false;
                const lb=((b.getAttribute("aria-label")||b.innerText)||"").trim();
                return /^(thích|thich|like)$/i.test(lb);
              });
              if(likeBtn){likeBtn.click();await sleep(600);}
            }catch(_){}
          }
          if(aiCount<aiTarget){
            const delayMs=rand(aiMinDelay,aiMaxDelay),nextAt=Date.now()+delayMs;
            await chrome.storage.local.set({aiNextAllowedAt:nextAt,aiStatus:t("ai2.waitNext",{from:aiCount,to:aiTarget,secs:Math.ceil(delayMs/1000)})});
            while(isAICommenting&&Date.now()<nextAt){
              const seconds=Math.max(1,Math.ceil((nextAt-Date.now())/1000));
              chrome.storage.local.set({aiStatus:t("ai2.waitNext",{from:aiCount,to:aiTarget,secs:seconds})});
              await sleep(Math.min(1000,nextAt-Date.now()));
            }
            window.scrollBy(0,Math.max(650,innerHeight*.65));
            await sleep(1000);
          }
        }else{
          if(!lastAiFailure) lastAiFailure=t("ai2.unknownOp");
          chrome.storage.local.set({aiStatus:lastAiFailure});
          isAICommenting=false;
          break;
        }
        if(aiCount>=aiTarget) break;
      }
      if(!foundNew){
        idle++;
        // Cho Facebook mot nhip render tai vi tri hien tai truoc khi cuon. Ban cu
        // cuon ngay moi vong nen de vuot qua bai vua tai xong.
        if(idle%2===0){
          chrome.storage.local.set({aiStatus:t("ai2.loadingMore",{from:aiCount,to:aiTarget})});
          window.scrollBy(0,Math.max(520,innerHeight*.62));
          await sleep(idle%6===0?2600:1700);
        }else{
          chrome.storage.local.set({aiStatus:t("ai2.checkingNow",{from:aiCount,to:aiTarget})});
          await sleep(1200);
        }
        if(idle>=16){
          const reloadState=await chrome.storage.local.get("aiFeedReloadAttempts");
          const reloadAttempts=(parseInt(reloadState.aiFeedReloadAttempts)||0)+1;
          if(reloadAttempts<=10){
            await chrome.storage.local.set({
              pendingAIComment:true,
              pendingAIConfig:aiCommentRunConfig(),
              aiFeedReloadAttempts:reloadAttempts,
              isAICommenting:true,
              aiStatus:t("ai2.reloading",{n:reloadAttempts,from:aiCount,to:aiTarget})
            });
            await sleep(rand(2500,4500));
            if(!isAICommenting)return;
            const prepared=await prepareAIPageTransition("tải lại Bảng tin");
            if(!prepared){isAICommenting=false;return;}
            location.reload();
            return;
          }
          lastAiFailure=t("ai2.gaveUp",{from:aiCount,to:aiTarget});
          chrome.storage.local.set({aiStatus:lastAiFailure,aiFeedReloadAttempts:0});
          break;
        }
      } else idle=0;
      if(aiCount>=aiTarget) break;
    }
    const aiStillActive=await chrome.storage.local.get("isAICommenting");
    if(!isAICommenting||aiStillActive.isAICommenting===false)return;
    isAICommenting=false;
    const zeroMessage=lastAiFailure || (!sawPost
      ? t("ai2.noPostHere")
      : t("ai2.seenNoComment"));
    const finalMessage=aiCount>=aiTarget
      ? (aiRunMode==="like"?t("ai2.doneLikeAll",{from:aiCount,to:aiTarget}):t("ai2.doneAll",{from:aiCount,to:aiTarget}))
      : lastAiFailure || (aiCount>0 ? t("ai2.pausedAt",{from:aiCount,to:aiTarget}) : zeroMessage);
    chrome.storage.local.set({ isAICommenting:false, aiActiveConfig:null,aiStatus:finalMessage });
  }

  function resetFeed(){
    isFeedInteracting=false; feedCount=0;
    document.querySelectorAll('[data-feed-interacted="1"]').forEach(el=>{ delete el.dataset.feedInteracted; el.style.outline=""; });
    chrome.storage.local.set({ feedCount:0, feedStatus:t("p.resetDone"), isFeedInteracting:false });
    chrome.storage.local.remove(["pendingFeedInteract","pendingFeedConfig"]);
  }
  function resetAI(){
    isAICommenting=false; aiCount=0;aiRunMode="comment";aiLikeAfterComment=false;aiReactionPref="like";
    void cleanupAICommentComposer(undefined,undefined,"Reset");
    document.querySelectorAll('[data-ai-commented="1"]').forEach(el=>{ delete el.dataset.aiCommented; el.style.outline=""; });
    // Reset chỉ mở một phiên mới; giữ lịch sử/dấu vân tay để không gửi lại
    // những bài đã xử lý ở phiên trước. Xóa lịch sử phải là thao tác riêng,
    // không được xảy ra khi người dùng chỉ muốn đặt bộ đếm về 0.
    chrome.storage.local.set({ aiCount:0, aiStatus:t("ai2.resetKept"), isAICommenting:false,aiActiveConfig:null,pendingAIComment:false,aiNextAllowedAt:0,aiFeedReloadAttempts:0 });
  }

  async function scanJoinedGroups(){
    const skip=new Set(["feed","discover","joins","create","notifications","your_groups"]);
    const map=new Map();
    // Facebook can concatenate notification words with the actor name, e.g.
    // "Chưa đọcLão Già...". Do not require a trailing word boundary here.
    const notificationText=/(?:^|\s)(?:chưa\s*đọc|unread|đã nhắc đến bạn|đã gắn thẻ|đã từ chối|đã gỡ bài(?: viết)?|đã bày tỏ cảm xúc|đã phản hồi bình luận|thích bài viết của bạn|mentioned you|tagged (?:you|everyone)|removed your post|replied to your comment)/i;
    function collect(){
      for(const a of document.querySelectorAll('a[href*="/groups/"]')){
        let url;
        try{ url=new URL(a.href,location.origin); }catch{ continue; }
        if(url.hostname!==location.hostname) continue;
        const m=url.pathname.match(/^\/groups\/([^/?#]+)/);
        if(!m || skip.has(m[1].toLowerCase())) continue;
        // The joined-groups screen has notification links and post permalinks
        // that also start with /groups/<id>. Only a group-home link can be a
        // selectable destination; never turn a notification into a group.
        if(!/^\/groups\/[^/?#]+\/?$/i.test(url.pathname)) continue;
        const id=m[1];
        const box=a.closest('div[role="listitem"], li, [data-pagelet], div[role="article"]')||a.parentElement;
        // Bỏ qua pending request cards (nhóm chưa được chấp nhận)
        if(/đã yêu cầu tham gia|request(?:ed)? to join/i.test(box?.innerText||"")) continue;
        // Try heading first (more reliable on Page-groups tab), then aria-label, then innerText
        const heading=box?.querySelector('h1,h2,h3,h4,[role="heading"]');
        // Generic action labels — không phải tên nhóm
        const genericLabel=/^(xem nhóm|view group|tham gia nhóm?|join group|tham gia|join|đã tham gia|joined|gửi yêu cầu|cancel request|hủy yêu cầu|xem tất cả|see all|view all|tất cả|all|tạo nhóm mới|create new group|nhóm của bạn|your groups|sắp xếp|sort|nhóm)$/i;
        const genericPrefix=/^(mới\s+|new\s+)/i;
        const ariaRaw=(a.getAttribute("aria-label")||"").trim().replace(/\s+/g," ");
        let name=(!genericLabel.test(ariaRaw))?ariaRaw:"";
        if(!name){
          // Take only first line of headingText to avoid activity suffix
          const headingText=(heading?.innerText||"").trim().split(/\n/)[0].trim().replace(/\s+/g," ");
          const linkText=(a.innerText||a.textContent||"").trim().replace(/\s+/g," ").split(/\n/)[0];
          if(headingText && !notificationText.test(headingText) && !genericLabel.test(headingText)){
            name=headingText;
          } else if(linkText && !notificationText.test(linkText) && !genericLabel.test(linkText) && linkText.length<=150){
            name=linkText;
          } else {
            // Walk up DOM: tìm span/strong chứa tên nhóm thực
            let el=a.parentElement;
            for(let i=0;i<6&&el;i++){
              const cand=el.querySelector('strong,span[dir="auto"]');
              const t=(cand?.innerText||"").trim().split(/\n/)[0].replace(/\s+/g," ");
              if(t&&t.length>=2&&t.length<=150&&!genericLabel.test(t)&&!notificationText.test(t)){name=t;break;}
              el=el.parentElement;
            }
          }
        }
        // Strip trailing activity text like "Lần hoạt động gần nhất: X phút trước"
        name=name.replace(/\s+(?:lần hoạt động|last active|hoạt động gần đây|\d+\s+(?:phút|giờ|ngày|tuần|tháng|năm)\s+trước).*/i,"").trim();
        if(!name || name.length<2 || name.length>150 || notificationText.test(name) || genericLabel.test(name) || genericPrefix.test(name)) continue;
        const img=a.querySelector("img")||box?.querySelector("img");
        const icon=img?.src||"";
        const cleanUrl=`${location.origin}/groups/${id}/`;
        if(!map.has(id) || name.length>map.get(id).name.length) map.set(id,{id,name,url:cleanUrl,icon});
      }
    }
    // Tìm TẤT CẢ scrollable container chứa group links — bao gồm cả sidebar trái
    // (nằm ngoài role="main", thường trong role="navigation"/"complementary")
    function findScrollableGroupContainers(){
      const results=[];
      const seen=new Set();
      for(const d of document.querySelectorAll('div,nav,aside,[role="navigation"],[role="complementary"]')){
        if(seen.has(d))continue;
        const cs=getComputedStyle(d);
        if((cs.overflowY==="auto"||cs.overflowY==="scroll")&&d.scrollHeight>d.clientHeight+50){
          const links=d.querySelectorAll('a[href*="/groups/"]');
          if(links.length>=2){results.push(d);seen.add(d);}
        }
      }
      // Ưu tiên: đưa sidebar trái lên đầu (thường có x nhỏ hơn main content)
      results.sort((a,b)=>{
        const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
        return ra.left-rb.left;
      });
      return results;
    }
    // Bấm nút "Xem thêm" / "Xem tất cả" / "See more" để mở rộng danh sách
    function clickExpandButtons(){
      const btns=document.querySelectorAll('div[role="button"], span[role="button"], a[role="button"], a');
      let clicked=false;
      for(const btn of btns){
        const txt=(btn.textContent||"").trim();
        if(/^(xem thêm|xem tất cả|see more|see all|show all|hiển thị tất cả|view all)/i.test(txt)&&btn.offsetHeight>0&&btn.offsetWidth>0){
          btn.click();
          clicked=true;
        }
      }
      return clicked;
    }
    // Kích FB lazy-load: mousemove qua cả main lẫn sidebar trái
    function triggerContentLoad(){
      const targets=[
        document.querySelector('[role="main"]'),
        document.querySelector('[role="navigation"]'),
        document.querySelector('[role="complementary"]'),
        ...findScrollableGroupContainers().slice(0,2),
      ].filter(Boolean);
      for(const el of targets){
        const rect=el.getBoundingClientRect();
        if(rect.width<10||rect.height<10)continue;
        const cx=Math.round(Math.min(rect.left+rect.width/2,window.innerWidth-50));
        for(let y=Math.round(rect.top)+20;y<Math.min(Math.round(rect.bottom),window.innerHeight-20);y+=80){
          el.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:cx,clientY:y}));
          document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:cx,clientY:y}));
        }
      }
      window.dispatchEvent(new Event('scroll'));
    }
    // Đọc tổng số nhóm FB hiển thị trên trang (dùng xuyên suốt vòng lặp)
    function readPageTotalShown(){
      let total=0;
      try{
        const allText=[...document.querySelectorAll('*')]
          .filter(el=>el.children.length===0||el.tagName==="SPAN"||el.tagName==="STRONG")
          .map(el=>(el.innerText||el.textContent||"").trim())
          .filter(t=>t.length>=2&&t.length<=80);
        for(const t of allText){
          const m=t.match(/^(\d[\d.,]*)\s*nhóm$/i)||t.match(/(\d[\d.,]*)\s*groups?(?:\s+total|\s+you[' ]|$)/i)||t.match(/member(?:s)? of\s+(\d[\d.,]*)\s+groups?/i);
          if(m){const n=parseInt(m[1].replace(/[.,]/g,""));if(n>0&&n>total)total=n;}
        }
      }catch{}
      return total;
    }
    // Phát hiện spinner đang load thêm nhóm trong sidebar/main
    function isLoadingMore(panels){
      const roots=[...panels,document.querySelector('[role="navigation"]'),document.querySelector('[role="complementary"]'),document.querySelector('[role="main"]')].filter(Boolean);
      for(const el of roots){
        const s=el.querySelector('[role="progressbar"],[aria-busy="true"],svg[aria-label*="load" i],svg[aria-label*="tải" i],div[aria-label*="load" i],div[aria-label*="đang tải" i]');
        if(s&&s.offsetWidth>0&&s.offsetHeight>0)return true;
      }
      return false;
    }
    // Chờ thích ứng: poll 300ms/lần cho đến khi có nhóm mới hoặc hết maxWaitMs
    async function waitForNewGroups(maxWaitMs){
      const before=map.size,end=Date.now()+maxWaitMs;
      while(Date.now()<end){
        await sleep(300);
        collect();
        if(map.size>before)return true;
      }
      return false;
    }
    // Chờ content load ban đầu (tối đa 12s) — tìm link nhóm ở bất cứ đâu
    for(let w=0;w<12;w++){
      triggerContentLoad();
      if(document.querySelector('a[href*="/groups/"]'))break;
      await sleep(1000);
    }
    let stable=0,lastSize=0,maxIterations=120,stableThreshold=30;
    let targetTotal=readPageTotalShown();
    for(let i=0;i<maxIterations && stable<stableThreshold;i++){
      collect();
      const grew=map.size>lastSize;
      stable=grew?0:stable+1;
      lastSize=map.size;
      // Cập nhật totalShown định kỳ hoặc khi vừa có thêm nhóm
      if(grew||i%8===0){const t=readPageTotalShown();if(t>targetTotal)targetTotal=t;}
      // Cập nhật trạng thái live
      if(grew||i%4===0){
        const dots=".".repeat((i%3)+1);
        const suffix=targetTotal>0?`/${targetTotal}`:"";
        chrome.storage.local.set({joinedGroupsScanStatus:`⏳ Đang tải${dots} ${map.size}${suffix} nhóm`}).catch(()=>{});
      }
      // Đã tải đủ số nhóm FB hiển thị → dừng sớm
      if(targetTotal>0&&map.size>=targetTotal){
        chrome.storage.local.set({joinedGroupsScanStatus:`✅ Đã tải đủ ${map.size}/${targetTotal} nhóm`}).catch(()=>{});
        break;
      }
      // Còn thiếu so với totalShown → không để stable chạm ngưỡng dừng
      if(targetTotal>0&&map.size<targetTotal&&stable>=stableThreshold-5)stable=stableThreshold-6;
      // Kích lazy-load định kỳ
      if(i%3===0)triggerContentLoad();
      // Bấm expand sớm khi stable hoặc gần cuối
      if(stable>=5||i>60)clickExpandButtons();
      // Cuộn tất cả panels (sidebar + main)
      const panels=findScrollableGroupContainers();
      if(panels.length>0){
        panels.forEach(p=>{p.scrollTop=Math.min(p.scrollHeight,p.scrollTop+Math.max(600,p.clientHeight*0.8));});
        if(stable>=5&&stable%3===0){
          panels.forEach(p=>{p.scrollTop=Math.max(0,p.scrollTop-400);});
          await sleep(200);
          panels.forEach(p=>{p.scrollTop=p.scrollHeight;});
        }
      }
      window.scrollTo(0,document.body.scrollHeight);
      if(stable>=5&&stable%3===0){
        window.scrollTo(0,Math.max(0,window.scrollY-400));
        await sleep(200);
        window.scrollTo(0,document.body.scrollHeight);
      }
      // Chờ thích ứng thay vì sleep cứng: thoát sớm khi có nhóm mới
      // Nếu spinner đang hiện → chờ lâu hơn (mạng chậm, FB đang fetch)
      const loading=isLoadingMore(panels);
      const maxWait=loading?3500:(grew?1500:(stable<8?1000:700));
      const found=await waitForNewGroups(maxWait);
      if(found){stable=0;lastSize=map.size;}
    }
    // Thu thập lần cuối + click expand
    clickExpandButtons();
    await sleep(400);
    collect();
    window.scrollTo(0,0);
    const totalShown=Math.max(targetTotal,readPageTotalShown());
    const groups=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,"vi"));
    return {groups,totalShown};
  }

  let isGroupInteracting=false;
  let groupStopRequested=false;
  let isGroupCommenting=false;
  let groupCommentStopRequested=false;
  // Comment cache cho chế độ Cân bằng: tránh gọi lại AI cho bài có nội dung
  // giống nhau trong cùng một run. Xóa khi run mới bắt đầu.
  let groupCommentCache={};
  // Composer riêng của Comment AI theo nhóm. Không dùng chung với luồng
  // Comment AI Bản tin để tránh dọn nhầm bản nháp khi hai state machine đổi
  // route gần nhau.
  let groupCommentDraftBox=null;
  let groupCommentDraftArticle=null;
  let groupCommentDraftScope=null;
  let groupCommentDraftIdentity="";
  let groupCommentDraftSignature="";
  let groupCommentDraftExpected="";
  // Facebook có thể giữ một composer nổi của bài trước sau khi đã gửi và
  // đổi URL sang permalink bài kế tiếp. Giữ một danh sách ngắn các đoạn text
  // mà chính lượt Comment AI đã sở hữu để dọn orphan composer về sau; không
  // dùng selector/counter của Comment AI Bản tin hoặc luồng khác.
  let groupCommentDraftOwnedHistory=[];
  function groupCommentDraftMatchesExpected(draft,expected){
    const actual=normalizeCommentComposerText(draft);
    const wanted=normalizeCommentComposerText(expected);
    if(actual.length<12||!wanted)return false;
    return actual===wanted||wanted.startsWith(actual)||wanted.endsWith(actual)||(actual.length>=12&&wanted.includes(actual));
  }
  function rememberGroupCommentDraftOwnership(expected,identity,signature){
    const wanted=normalizeCommentComposerText(expected);
    if(wanted.length<12)return;
    groupCommentDraftOwnedHistory=groupCommentDraftOwnedHistory.filter(entry=>entry.text!==wanted);
    groupCommentDraftOwnedHistory.push({text:wanted,identity:identity||"",signature:signature||"",time:Date.now()});
    if(groupCommentDraftOwnedHistory.length>40)groupCommentDraftOwnedHistory=groupCommentDraftOwnedHistory.slice(-40);
  }
  function clearGroupCommentDraftOwnedHistory(){groupCommentDraftOwnedHistory=[];}
  function rememberGroupCommentDraft(box,article,identity,signature,expectedText=""){
    groupCommentDraftBox=box||null;
    groupCommentDraftArticle=article||null;
    // Giữ chính lớp chi tiết đã chứa composer được xác nhận rỗng trước khi
    // gõ. Sau khi gửi, Facebook có thể thay editor bằng một node mới và
    // tạm thời làm identity/signature của node cha không còn khớp; vẫn được
    // phép dọn replacement nếu nó nằm trong đúng dialog do lượt này mở.
    groupCommentDraftScope=box?.closest?.('[role="dialog"]')||null;
    groupCommentDraftIdentity=identity||"";
    groupCommentDraftSignature=signature||"";
    groupCommentDraftExpected=normalizeCommentComposerText(expectedText);
    rememberGroupCommentDraftOwnership(groupCommentDraftExpected,groupCommentDraftIdentity,groupCommentDraftSignature);
  }
  function clearGroupCommentDraftMemory(){
    groupCommentDraftBox=null;
    groupCommentDraftArticle=null;
    groupCommentDraftScope=null;
    groupCommentDraftIdentity="";
    groupCommentDraftSignature="";
    groupCommentDraftExpected="";
  }
  function groupCommentRouteMatchesIdentity(identity){
    const key=String(identity||"").toLowerCase();
    const match=key.match(/^fb:group:([^:]+):([^:]+)$/);
    // .replace(/\/+$/,"/") chỉ RÚT GỌN dấu "/" cuối nếu đã có, không TỰ
    // THÊM khi pathname vốn không có (permalink dạng pfbid thường không có
    // "/" cuối) — khiến các so khớp bên dưới luôn trượt dù đang đúng trang.
    let path=String(location.pathname||"").toLowerCase();
    if(!path.endsWith("/"))path+="/";
    // Trang chi tiết nhóm của Facebook có thể bỏ hẳn role="dialog" và thay
    // toàn bộ ancestor của composer. Khi đó, permalink hiện tại cùng với
    // ownership memory của lượt AI là scope hẹp nhất còn lại để nhận diện
    // replacement; không dùng fallback này trên feed nhóm thông thường.
    if(!match)return /\/groups\/[^/]+\/(?:posts|permalink)\/[^/]+\//.test(path);
    const groupPrefix=`/groups/${match[1]}/`;
    if(!path.includes(groupPrefix))return false;
    return path.includes(`/posts/${match[2]}/`)||path.includes(`/permalink/${match[2]}/`);
  }
  function findGroupCommentDraftReplacement(preferred){
    const entries=[];
    if(groupCommentDraftExpected)entries.push({text:groupCommentDraftExpected,identity:groupCommentDraftIdentity,signature:groupCommentDraftSignature});
    for(const entry of groupCommentDraftOwnedHistory){
      if(!entries.some(current=>current.text===entry.text))entries.push(entry);
    }
    const owned=visibleCommentBoxes().find(candidate=>{
      const draft=commentDraftText(candidate);
      // Chỉ dọn text đã được ghi nhận khi ô ban đầu còn rỗng và sau đó được
      // lượt AI sở hữu. Điều này xử lý cả composer mồ côi sau khi URL đổi,
      // đồng thời không quét/xóa bản nháp người dùng không khớp text AI.
      return entries.some(entry=>groupCommentDraftMatchesExpected(draft,entry.text));
    });
    if(owned)return owned;
    const article=groupCommentDraftArticle?.isConnected?groupCommentDraftArticle:null;
    if(article&&groupCommentDraftIdentity){
      const exact=findExactCommentBox(article,groupCommentDraftIdentity,groupCommentDraftSignature);
      if(exact?.box&&commentDraftText(exact.box))return exact.box;
    }
    if(groupCommentDraftIdentity){
      const exact=visibleCommentBoxes().find(candidate=>{
        if(!isAICommentComposer(candidate)||!commentDraftText(candidate))return false;
        return !!exactCommentScopeForBox(candidate,groupCommentDraftIdentity,groupCommentDraftSignature);
      });
      if(exact)return exact;
    }
    return preferred?.isConnected&&commentDraftText(preferred)?preferred:null;
  }
  function findAllGroupCommentDraftReplacements(){
    const entries=[];
    if(groupCommentDraftExpected)entries.push(groupCommentDraftExpected);
    for(const entry of groupCommentDraftOwnedHistory){
      if(!entries.includes(entry.text))entries.push(entry.text);
    }
    if(!entries.length)return [];
    return visibleCommentBoxes().filter(candidate=>entries.some(expected=>groupCommentDraftMatchesExpected(commentDraftText(candidate),expected)));
  }
  async function cleanupGroupCommentDraft(preferred){
    let candidate=preferred||groupCommentDraftBox;
    const ownedScopes=new Set();
    for(let attempt=0;attempt<3;attempt++){
      // Besides the original composer, Facebook may have mounted an overlay
      // composer for the same post. Clear every owned fragment before a route
      // change, otherwise Facebook raises its "Rời khỏi trang web?" warning.
      const candidates=[];
      for(const box of [candidate,groupCommentDraftBox,findGroupCommentDraftReplacement(candidate),...findAllGroupCommentDraftReplacements()]){
        if(box?.isConnected&&!candidates.includes(box))candidates.push(box);
      }
      for(const box of candidates){
        if(!commentDraftText(box))continue;
        const scope=groupCommentDraftIdentity?exactCommentScopeForBox(box,groupCommentDraftIdentity,groupCommentDraftSignature):null;
        if(scope?.isConnected)ownedScopes.add(scope);
        const cleared=await clearAICommentDraft(box);
        if(!cleared)return false;
      }
      // The detail overlay can be mounted just after the visible composer
      // becomes empty, then restore a trailing fragment of the AI text a few
      // hundred milliseconds later. Keep the ownership memory and wait for a
      // quiet settle period before closing/navigating, otherwise Facebook
      // raises its native "Rời khỏi trang?" warning on the next post.
      await sleep(600);
      candidate=findGroupCommentDraftReplacement(candidate);
      if(!candidate||!commentDraftText(candidate)){
        if(attempt<2) continue;
        for(const scope of ownedScopes)await closeExactCommentOverlay(scope);
        clearGroupCommentDraftMemory();
        return true;
      }
    }
    return !candidate?.isConnected||!commentDraftText(candidate);
  }
  function groupCommentLeaveWarningVisible(){
    return [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(el=>
      isRenderedElement(el)&&/chưa hoàn tất bình luận|chưa hoàn thành bình luận|rời khỏi trang|haven.t finished your comment|unfinished comment|leave (?:this )?page|discard (?:comment|changes)|bỏ bình luận|hủy bình luận/i.test(el.innerText||el.textContent||""));
  }
  // Dismiss hộp thoại "Rời khỏi trang?" của Facebook (không phải Chrome native)
  async function dismissLeaveWarningDialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
      .filter(el=>isRenderedElement(el)&&/rời khỏi|leave|discard|bỏ bình luận|hủy bình luận/i.test(el.innerText||""));
    if(!dialogs.length)return false;
    for(const dlg of dialogs){
      const btns=[...dlg.querySelectorAll('[role="button"],button')];
      // Ưu tiên nút "Rời khỏi" / "Leave" / "Discard" để thoát và chuyển nhóm
      const leaveBtn=btns.find(b=>/^(rời khỏi|leave|discard|bỏ qua|hủy bình luận|bỏ bình luận)$/i.test((b.textContent||"").trim()));
      if(leaveBtn){leaveBtn.click();await sleep(400);}
    }
    return true;
  }
  // Guard chung trước mọi lần đổi nhóm của Tương tác nhóm/Comment AI.
  async function prepareGroupCommentTransition(mode="reaction",reason="đổi nhóm"){
    // Xóa beforeunload để Chrome không bật dialog native "Rời khỏi trang web?"
    try{window.onbeforeunload=null;}catch(_){}
    // Dismiss hộp thoại Facebook nếu đang hiện
    if(groupCommentLeaveWarningVisible()){
      await dismissLeaveWarningDialog();
      await sleep(500);
    }
    // Dọn draft (3 attempts bên trong cleanupGroupCommentDraft)
    const cleaned=await cleanupGroupCommentDraft();
    const hasDraft=visibleCommentBoxes().some(box=>commentDraftText(box));
    // Nếu còn dialog sau khi dismiss, thử lần 2
    if(groupCommentLeaveWarningVisible()){
      await dismissLeaveWarningDialog();
      await sleep(400);
    }
    // Nếu vẫn còn draft: force-close tất cả overlay rồi tiếp tục
    if(!cleaned||hasDraft){
      const overlays=[...document.querySelectorAll('[role="dialog"],[aria-label*="Comment"],[aria-label*="Bình luận"]')]
        .filter(el=>isRenderedElement(el));
      for(const ov of overlays){
        const closeBtn=ov.querySelector('[aria-label*="Đóng"],[aria-label*="Close"],[aria-label*="close"]');
        if(closeBtn)closeBtn.click();
      }
      await sleep(400);
      // Vẫn cứ cho phép chuyển — tốt hơn là dừng hẳn phiên
    }
    return true;
  }
  // Tìm text trong contenteditable và select nó — trả về true nếu tìm được
  // Hỗ trợ cả trường hợp text nằm trải trên nhiều text node (Facebook Lexical)
  function selectTextInContentEditable(box,text){
    const walker=document.createTreeWalker(box,NodeFilter.SHOW_TEXT,null);
    const nodes=[];
    let node;
    while((node=walker.nextNode()))nodes.push(node);
    // Fast path: tìm trong từng node đơn lẻ
    for(const n of nodes){
      const idx=n.textContent.indexOf(text);
      if(idx>=0){
        try{
          const range=document.createRange();
          range.setStart(n,idx);
          range.setEnd(n,idx+text.length);
          const sel=window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }catch(_){return false;}
      }
    }
    // Multi-node path: ghép nội dung các node lại để tìm vị trí
    let acc="";
    const offs=[];
    for(const n of nodes){offs.push({node:n,start:acc.length});acc+=n.textContent;}
    const gi=acc.indexOf(text);
    if(gi<0)return false;
    const ge=gi+text.length;
    let sn=null,so=0,en=null,eo=0;
    for(const {node:n,start} of offs){
      const end=start+n.textContent.length;
      if(!sn&&gi>=start&&gi<end){sn=n;so=gi-start;}
      if(!en&&ge>start&&ge<=end){en=n;eo=ge-start;break;}
    }
    if(!sn||!en)return false;
    try{
      const range=document.createRange();
      range.setStart(sn,so);
      range.setEnd(en,eo);
      const sel=window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }catch(_){return false;}
  }

  // Chọn option mention trong dropdown (hàm thuần để unit-test được).
  // descs: [{id, text, hrefs[], html}] theo đúng thứ tự DOM.
  // Trả về {index, via} | {index:-1, via:"ambiguous"} | null.
  // NGUYÊN TẮC (bắt live): khớp tên mà không xác nhận id thì KHÔNG được chọn bừa
  // option đầu tiên — dropdown thường chứa cả Page lẫn Group trùng tên
  // (live: "La bàn chứng khoán" vừa là Page idx0 vừa là Group idx2). Nhiều ứng
  // viên trùng tên mà không có id khớp → skip "ambiguous", tuyệt đối không tag nhầm.
  function pickMentionOption(descs, entityUrlId, nameNorm) {
    const list = Array.isArray(descs) ? descs : [];
    const norm = String(nameNorm || "").toLowerCase().trim();
    // Tên generic ("Đoạn chat", "Tin nhắn"...) khớp bừa vào gợi ý lạ — chặn
    // ngay từ matching, độc lập với lớp lọc ở decideTagForPost.
    if (isGenericTagName(norm)) return { index: -1, via: "generic" };
    const idOf = (d) => (d && d.id != null ? String(d.id) : "");
    // P0: khớp id trực tiếp (chính xác nhất).
    if (entityUrlId) {
      for (let i = 0; i < list.length; i++) {
        if (idOf(list[i]) && idOf(list[i]) === String(entityUrlId)) return { index: i, via: "P0-id" };
      }
    }
    // P1: khớp URL id trong href/HTML.
    if (entityUrlId) {
      for (let i = 0; i < list.length; i++) {
        const d = list[i] || {};
        const hrefs = Array.isArray(d.hrefs) ? d.hrefs : [];
        const html = String(d.html || "");
        if (hrefs.some((h) => String(h).includes("/" + entityUrlId) || String(h).includes("id=" + entityUrlId)) ||
          html.includes("/" + entityUrlId) || html.includes('"' + entityUrlId + '"')) {
          return { index: i, via: "P1-url" };
        }
      }
    }
    const poolByName = (pred) => {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        if (pred(String((list[i] && list[i].text) || "").toLowerCase())) out.push(i);
      }
      return out;
    };
    // Ứng viên trùng tên: ưu tiên id khớp, đơn nhất thì lấy, còn lại là mơ hồ.
    // Thắt thêm (bắt live verify): entityUrlId là số (id Facebook thật — nhóm/Page
    // dạng số) mà KHÔNG option nào mang id đó thì entity không được gợi ý — kể cả
    // chỉ còn 1 ứng viên trùng tên (thường là Page trùng tên nhóm) cũng phải skip,
    // không được tag bừa. Entity dạng slug chữ (Page link tên) giữ đường đơn-nhất
    // vì slug không bao giờ khớp id số.
    const numericId = entityUrlId && /^\d+$/.test(String(entityUrlId)) ? String(entityUrlId) : "";
    const disambiguate = (idxs, viaName) => {
      if (!idxs.length) return null;
      if (entityUrlId) {
        for (const i of idxs) {
          if (idOf(list[i]) && idOf(list[i]) === String(entityUrlId)) return { index: i, via: viaName + "-id" };
        }
      }
      if (idxs.length === 1) {
        if (numericId && idOf(list[idxs[0]]) !== numericId) return { index: -1, via: "ambiguous" };
        return { index: idxs[0], via: viaName };
      }
      return { index: -1, via: "ambiguous" };
    };
    // P2: tên đầy đủ xuất hiện trong option.
    if (norm) {
      const r = disambiguate(poolByName((t) => t.includes(norm)), "P2-fullname");
      if (r) return r;
    }
    // P3: dòng đầu option (display name ≥6 ký tự) là tiền tố của entity.name.
    if (norm) {
      const r = disambiguate(poolByName((t) => {
        const first = (t.split("\n")[0] || "").trim();
        return first.length >= 6 && norm.startsWith(first);
      }), "P3-prefix");
      if (r) return r;
    }
    return null;
  }
  // Đếm token tên (span/a chứa tên mà không có "@") trong box — dùng để xác minh
  // mention thật sự được chèn (so trước/sau Enter), thay vì đoán qua độ dài text.
  function countNameSpans(box, displayText) {
    try {
      const needle = String(displayText || "").slice(0, 12).trim();
      if (!needle || !box || !box.querySelectorAll) return 0;
      let n = 0;
      const els = box.querySelectorAll("span,a");
      for (const el of els) {
        const t = (el.textContent || "").trim();
        if (t && t.includes(needle) && !t.includes("@")) n++;
      }
      return n;
    } catch (_) { return 0; }
  }
  async function appendTagMention(box,tagConfig,isActive,prePickedEntity=null){
    if(!box?.isConnected||!tagConfig){
      try{logActivity("tag","@tag bỏ qua (invalid-box)");}catch(_){}
      return false;
    }
    const entity=prePickedEntity||pickTagEntity(tagConfig);
    if(!entity?.name){
      try{logActivity("tag","@tag bỏ qua (no-entity)");}catch(_){}
      return false;
    }
    if(!prePickedEntity){
      // Giống decideTagForPost: rate 0% phải nghĩa là không tag (không `||70`).
      const rateRaw=Number(tagConfig.rate);
      const rate=(Number.isFinite(rateRaw)?Math.max(0,Math.min(100,rateRaw)):70)/100;
      if(Math.random()>rate)return false;
    }
    const entityUrlId=(()=>{
      try{
        const u=new URL(entity.url);
        const id=u.searchParams.get('id');
        if(id)return id;
        return u.pathname.replace(/\/$/,'').split('/').filter(Boolean).pop()||null;
      }catch(_){return null;}
    })();
    // Entity nhóm (/groups/...) hiếm khi được FB gợi ý mention; khi tag thất bại
    // thì KHÔNG nhồi lại tên nhóm dạng text thường vào comment (bắt live: comment
    // đăng lên chỉ còn text tên nhóm, không có mention). Page giữ nguyên restore.
    const isGroupEntity=/\/groups\//i.test(String(entity.url||""));
    // Gõ từng ký tự qua trustedInsertText (CDP trusted) — kích Lexical mention autocomplete
    // trustedInsertText gửi 1 ký tự/lần (CDP attach/detach mỗi lần) — phải dùng delay giữa chars
    const trustedType=async(ch)=>{
      try{const r=await chrome.runtime.sendMessage({action:"trustedInsertText",text:ch});if(r?.ok)return;}catch(_){}
      document.execCommand('insertText',false,ch);
      box.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:ch}));
    };
    // Gõ cả chuỗi qua 1 lần sendMessage (ít round-trip hơn cho tiền tố @)
    const trustedTypeString=async(str,delayMs=60)=>{
      for(const ch of str){
        await trustedType(ch);
        await sleep(delayMs+Math.random()*40);
        if(!await isActive())return false;
      }
      return true;
    };
    // Đặt caret theo offset ký tự (xấp xỉ theo text nodes) trong contenteditable.
    const setCaretAtOffset=(root,offset)=>{
      try{
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        let node,acc=0;
        while((node=walker.nextNode())){
          const len=(node.textContent||"").length;
          if(acc+len>=offset){
            const r=document.createRange();
            r.setStart(node,Math.min(Math.max(0,offset-acc),len));
            r.collapse(true);
            const sel=window.getSelection();
            sel.removeAllRanges();sel.addRange(r);
            return true;
          }
          acc+=len;
        }
      }catch(_){}
      try{
        const r=document.createRange();r.selectNodeContents(box);r.collapse(false);
        const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
      }catch(_){}
      return true;
    };
    // Caret về ngay sau "@partial" trước khi Backspace (vị trí tag giờ ngẫu
    // nhiên; box.focus() có thể đẩy caret về đầu). Offset tính trên textContent
    // cho khớp với TreeWalker trong setCaretAtOffset.
    const caretAfterQuery=(q)=>{
      try{
        const t=box.textContent||"";
        const i=t.indexOf("@"+q);
        if(i>=0)setCaretAtOffset(box,i+1+q.length);
      }catch(_){}
    };
  // Vòng xoay vị trí tag bền qua chrome.storage.local (tagPosRotateIdx).
    let tagPos="inline";
    const typeTagAtRandomPos=async(prefix)=>{
      const t=box.innerText||box.textContent||"";
      const m=t.match(/[.!?…\n]/);
      // "open" (đầu text) không trigger Lexical mention typeahead — bỏ khỏi choices.
      // Xoay vòng mid/end bền qua storage (chỉ tiến khi tag THÀNH CÔNG): RAM
      // module bị reset mỗi lần chuyển trang và fail cũng tiêu bước xoay,
      // từng gây 3/3 mid liên tiếp (bắt live 29/10).
      const canMid=!!(m&&m.index>10);
      let rIdx=0;
      try{ rIdx=parseInt((await chrome.storage.local.get(["tagPosRotateIdx"])).tagPosRotateIdx)||0; }catch(_){}
      if(!canMid)tagPos="end";
      else{ tagPos=(rIdx%2===0)?"mid":"end"; }
      box.focus();
      await sleep(100);
      const sel=window.getSelection();
      if(tagPos==="open"){
        setCaretAtOffset(box,0);
      }else if(tagPos==="mid"){
        setCaretAtOffset(box,m.index+1);
      }else{
        const r=document.createRange();r.selectNodeContents(box);r.collapse(false);
        sel.removeAllRanges();sel.addRange(r);
      }
      await sleep(100);
      return await trustedTypeString(" @"+prefix,70);
    };
    try{
      box.focus();
      await sleep(100);
      // partial = 2 từ đầu, max 15 chars (VD "Shopee người").
      // LƯU Ý từ DOM thực tế (v1.9.345): FB mention search AND-match từng từ đã gõ —
      // "@Shopee người" trả về ZERO gợi ý trong khi "@Shopee" trả về 5-10 option.
      // Nên partial 2 từ chỉ là lần thử đầu; vòng lặp bên dưới tự nới rộng về 1 từ
      // đầu nếu dropdown không mở sau 3s.
      let partial=(()=>{
        const name=entity.name.trim();
        // Lấy tối đa 2 từ đầu (tách bởi khoảng trắng), không quá 15 ký tự
        const words=name.split(/\s+/);
        let p=words[0]||name;
        if(words.length>1&&(p+' '+words[1]).length<=15) p+=' '+words[1];
        // Cắt ở dấu gạch ngang nếu có
        const dashIdx=p.indexOf('-');
        if(dashIdx>2) p=p.slice(0,dashIdx).trim();
        return p.slice(0,15);
      })();
      let inlineSelectFound=false;
      let deleteActuallyWorked=false;

      const currentText=box.innerText||box.textContent||"";
      const nameInText=currentText.includes(entity.name);
      if(nameInText){
        const found=selectTextInContentEditable(box,entity.name);
        inlineSelectFound=found;
        if(found){
          // Xóa text đã chọn + dispatch InputEvent để Lexical sync
          document.execCommand('delete',false,null);
          box.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,cancelable:true,inputType:"deleteContentBackward"}));
          box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}));
          await sleep(150);
          // Verify xóa thật sự thành công
          const textAfterDel=box.innerText||box.textContent||"";
          deleteActuallyWorked=!textAfterDel.includes(entity.name);
          if(!deleteActuallyWorked){
            // Xóa thất bại — fallback sang vị trí ngẫu nhiên
            inlineSelectFound=false;
            await sleep(100);
            if(!await typeTagAtRandomPos(partial))return false;
          }else{
            // Xóa thành công — đặt lại mention ở vị trí ngẫu nhiên thay vì giữ
            // vị trí literal mà model đã chèn tên entity.
            if(!await typeTagAtRandomPos(partial))return false;
          }
        }else{
          // Select thất bại: chèn ở vị trí ngẫu nhiên
          await sleep(100);
          if(!await typeTagAtRandomPos(partial))return false;
        }
      }else{
        // Tên không có trong text → chèn @partial ở vị trí ngẫu nhiên
        await sleep(150);
        if(!await typeTagAtRandomPos(partial))return false;
      }
      // Ranh giới từ cho mention query (inline-replace path): @partial gõ giữa text
      // mà dính với từ tiếp theo ("@ShopeeFood VNcòn...") khiến Lexical coi cả cụm
      // dính là query → dropdown không bao giờ mở (allLb=0 thực tế). Chèn 1 space
      // sau caret khi ký tự kế tiếp không phải khoảng trắng/cuối text.
      if(!await isActive())return false;
      try{
        const sel=window.getSelection();
        const node=sel?.anchorNode;
        const off=sel?.anchorOffset||0;
        let nextChar="";
        if(node){
          if(node.nodeType===3)nextChar=(node.textContent||"").charAt(off)||"";
          else{
            const sib=node.childNodes[off];
            nextChar=sib?(((sib.innerText||sib.textContent)||"").charAt(0)||""):"";
          }
        }
        if(nextChar&&!/[\s\u00A0]/.test(nextChar)){
          await trustedTypeString(" ",40);
          await sleep(200);
        }
      }catch(_){}
      // Tìm và click đúng option trong dropdown
      let deadline=Date.now()+9000;
      const typedAt=Date.now();
      // Snapshot listbox TRƯỚC khi type để lọc đúng mention dropdown mới (tránh nhầm
      // emoji panel / reaction picker luôn visible với allLb≥2 trong dialog comment).
      const preExistingLbs=new Set(Array.from(document.querySelectorAll('[role="listbox"]')).filter(el=>{
        const r=el.getBoundingClientRect();return el.isConnected&&r.width>0&&r.height>0;
      }));
      let selected=false;
      let matchVia="";
      let matchedText="";
      let matchedId="";
      let abortDropdown=false;
      let skipReasonOverride="";
      // Verify query đã gõ thật sự nằm trong box: nếu focus mất giữa chừng,
      // CDP insertText không vào box → dropdown không bao giờ mở. Thử refocus
      // + gõ lại 1 lần trước khi chờ dropdown.
      const queryLanded=()=>((box.innerText||"")+" "+(box.textContent||"")).includes("@"+partial);
      // "@" phải đứng sau khoảng trắng/đầu text thì Lexical mới mở typeahead —
      // thực tế dialog composer từng ghi "tại@ShopeeFood" (dính, không trigger).
      const leftBoundaryOk=()=>{
        const t=(box.innerText||"")+"\n"+(box.textContent||"");
        const i=t.indexOf("@"+partial);
        if(i<0)return false;
        return i===0||/[\s\u00A0]/.test(t[i-1]);
      };
      let typedLanded=queryLanded();
      if(!typedLanded){
        try{
          box.focus();
          await sleep(150);
          const sel=window.getSelection();
          if(sel){const r=document.createRange();r.selectNodeContents(box);r.collapse(false);sel.removeAllRanges();sel.addRange(r);}
          await sleep(100);
          if(await trustedTypeString(" @"+partial,70)){await sleep(400);typedLanded=queryLanded();}
        }catch(_){}
      }
      if(!typedLanded){
        try{
          globalThis.FbTagMention.lastResult={ok:false,reason:"untyped",entity:String(entity.name).slice(0,80),partial,urlId:entityUrlId||null};
        }catch(_){}
        logActivity("tag","@tag bỏ qua (untyped: @"+partial+" không vào được box) entity="+String(entity.name).slice(0,60));
        return false;
      }
      // Query vào box nhưng dính vào từ phía trước → xóa occurrence đó và gõ lại
      // sạch ở cuối thật. Nếu vẫn dính thì bỏ qua (tránh chờ dropdown vô ích).
      if(!leftBoundaryOk()){
        try{
          if(selectTextInContentEditable(box,"@"+partial)){
            document.execCommand("delete",false,null);
            box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}));
            await sleep(200);
          }
          box.focus();
          await sleep(100);
          const sel2=window.getSelection();
          if(sel2){const r2=document.createRange();r2.selectNodeContents(box);r2.collapse(false);sel2.removeAllRanges();sel2.addRange(r2);}
          await sleep(100);
          if(await trustedTypeString(" @"+partial,70))await sleep(400);
        }catch(_){}
        if(!queryLanded()||!leftBoundaryOk()){
          const tailNow=String(box.innerText||box.textContent||"").slice(-40);
          try{
            globalThis.FbTagMention.lastResult={ok:false,reason:"glued",entity:String(entity.name).slice(0,80),partial,urlId:entityUrlId||null};
          }catch(_){}
          logActivity("tag","@tag bỏ qua (glued: @"+partial+" dính từ trước, tail="+tailNow.slice(-30)+") entity="+String(entity.name).slice(0,60));
          // Dọn query dính để comment submit sạch
          try{
            if(selectTextInContentEditable(box,"@"+partial)){
              document.execCommand("delete",false,null);
              box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}));
              await sleep(150);
            }
          }catch(_){}
          return false;
        }
      }
      // Dispatch input event ngay sau khi type @partial để Lexical luôn nhận trigger mention.
      // CDP trustedInsertText insert text OK nhưng không luôn fire đủ events Lexical cần.
      try{
        box.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:partial.slice(-1)||"a"}));
      }catch(_){}
      await sleep(300);
      const triedOpts=new WeakSet();
      let retrigger=false;
      let seenListbox=false;
      let widened=false;
      // Đã thấy option mang đúng id entity trong dropdown chưa. Dùng để quyết
      // định nới query (listbox mở nhưng toàn gợi ý sai vẫn phải nới).
      let idMatched=false;
      let triedLastWord=false;

      while(Date.now()<deadline&&!selected){
        if(!await isActive())return false;
        if(retrigger){
          box.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
          box.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:partial.slice(-1)||"a"}));
          await sleep(700);
          retrigger=false;
        }
        // Nới rộng query khi dropdown không mở HOẶC mở mà không có id khớp:
        // "@La bàn" có thể chỉ gợi ý Page trùng tên (id lạ), trong khi "@La"
        // mới hiện thêm nhóm đúng id. DOM thực tế: partial 2 từ có thể cho ZERO
        // gợi ý, trong khi 1 từ đầu cho 5-10 option. Chỉ nới 1 lần; matching
        // chính xác (P0/P1) không bị ảnh hưởng.
        if(!widened&&Date.now()-typedAt>3000&&partial.includes(" ")&&(!seenListbox||!idMatched)){
          const firstWord=partial.split(/\s+/)[0]||partial;
          const delCount=partial.length-firstWord.length;
          box.focus();
          await sleep(100);
          caretAfterQuery(partial);
          for(let d=0;d<delCount;d++){
            try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8});}catch(_){}
            await sleep(30);
            if(!await isActive())return false;
          }
          await sleep(200);
          partial=firstWord;
          widened=true;
        }
        // Fallback URL slug sau 6s: khi tìm bằng display name không có id match.
        // Facebook mention search tìm được page theo username slug (e.g. "ToNgheMeme").
        // Xóa "@firstWord" cũ bằng trustedKey Backspace (caret đã đứng sau "@partial"),
        // rồi type "@slug". Chỉ chạy 1 lần, chỉ khi entityUrlId là slug (chứa chữ, không thuần số).
        if(widened&&!triedLastWord&&!idMatched&&Date.now()-typedAt>6000&&entityUrlId&&/[a-zA-Z]/.test(entityUrlId)){
          triedLastWord=true;
          const slugQuery=String(entityUrlId).slice(0,20);// tối đa 20 chars
          if(slugQuery!==partial){
            const delCount=partial.length;
            box.focus();
            await sleep(100);
            caretAfterQuery(partial);
            // Xóa "@partial" (delCount+1 ký tự kể @ )
            for(let d=0;d<delCount+1;d++){
              try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8});}catch(_){}
              await sleep(25);
              if(!await isActive())return false;
            }
            await sleep(200);
            // Gõ "@slug" (với space trước để leftBoundary OK)
            if(await trustedTypeString(" @"+slugQuery,60)){
              await sleep(400);
              partial=slugQuery;
              seenListbox=false;
              if(Date.now()+5000>deadline)deadline=Date.now()+5000;
              try{
                box.dispatchEvent(new InputEvent("input",{bubbles:true,composed:true,inputType:"insertText",data:slugQuery.slice(-1)||"a"}));
              }catch(_){}
            }
          }
        }
        // Chỉ tìm dropdown mention THẬT SỰ — loại trừ emoji panel / reaction picker luôn
        // visible trong dialog comment (chúng gây allLb=2 dù mention chưa mở).
        // Ưu tiên: listbox MỚI (không có trong preExistingLbs snapshot) → mention thật.
        // Fallback: bao gồm aria-label/data-testid đặc thù của mention.
        const allVisLbs=Array.from(document.querySelectorAll(
          '[role="listbox"],[aria-label*="mention"],[aria-label*="Gợi ý"],[aria-label*="suggestion"],[data-testid*="mention"]'
        )).filter(el=>{
          const r=el.getBoundingClientRect();
          return el.isConnected&&r.width>0&&r.height>0;
        });
        const lbs=allVisLbs.filter(el=>!preExistingLbs.has(el)||
          el.getAttribute('aria-label')?.includes('mention')||
          el.getAttribute('aria-label')?.includes('Gợi ý')||
          el.getAttribute('aria-label')?.includes('suggestion')||
          el.dataset?.testid?.includes('mention')
        );
        let clickedThisRound=false;
        if(lbs.length)seenListbox=true;
        for(const lb of lbs){
          if(abortDropdown)break;
          const opts=Array.from(lb.querySelectorAll('[role="option"],[role="listitem"],li'))
            .filter(o=>o.isConnected&&!triedOpts.has(o)&&o.getBoundingClientRect().height>0);
          if(!opts.length)continue;
          const nameNorm=entity.name.toLowerCase().trim();
          // Chọn option qua helper thuần (unit-test được): P0-id / P1-url chính xác;
          // P2/P3 theo tên nhưng MƠ HỒ (nhiều option trùng tên mà không có id khớp)
          // thì skip "ambiguous" — tuyệt đối không chọn bừa option đầu (live: Page và
          // Group cùng tên "La bàn chứng khoán" nằm chung dropdown).
          const descs=opts.map((opt)=>({
            id:opt.getAttribute("id")||opt.id||"",
            text:(opt.innerText||opt.textContent||""),
            hrefs:Array.from(opt.querySelectorAll("a")).map((a)=>a.href||a.getAttribute("href")||""),
            html:opt.innerHTML||"",
          }));
          // Ghi nhận đã thấy id đúng (dù pick chưa chốt) để khỏi nới query oan.
          if(entityUrlId&&!idMatched){
            const want=String(entityUrlId);
            idMatched=opts.some((o)=>{
              const dId=o.getAttribute("id")||o.id||"";
              if(dId&&dId===want)return true;
              const hs=Array.from(o.querySelectorAll("a")).map((a)=>a.href||a.getAttribute("href")||"");
              const html=o.innerHTML||"";
              return hs.some((h)=>String(h).includes("/"+want)||String(h).includes("id="+want))||html.includes("/"+want)||html.includes('"'+want+'"');
            });
          }
          const pick=pickMentionOption(descs,entityUrlId,nameNorm);
          if(pick&&pick.index<0){
            // Mơ hồ/generic: KHÔNG abort ngay — gợi ý đúng id có thể render trễ
            // hơn gợi ý sai (bắt live DOM: Page trùng tên hiện trước, nhóm đúng
            // id tới sau). Giữ lý do, chờ tiếp tới deadline rồi mới chốt skip.
            // Chỉ generic (tên lẫn nhãn UI) abort ngay vì không bao giờ đúng.
            if(pick.via==="generic"){
              skipReasonOverride="generic";
              try{
                globalThis.FbTagMention.lastResult={ok:false,reason:"generic",entity:String(entity.name).slice(0,80),partial,urlId:entityUrlId||null};
              }catch(_){}
              logActivity("tag","@tag bỏ qua (generic: tên giống nhãn UI, không phải tên Page/Nhóm) pos="+tagPos+" partial=@"+partial+" entity="+String(entity.name).slice(0,60));
              abortDropdown=true;
              break;
            }
            skipReasonOverride="ambiguous";
            try{
              globalThis.FbTagMention.lastResult={ok:false,reason:"ambiguous-wait",entity:String(entity.name).slice(0,80),partial,urlId:entityUrlId||null};
            }catch(_){}
            continue;
          }
          if(!pick)continue;
          const best=opts[pick.index];
          if(!best)continue;
          matchVia=pick.via;
          triedOpts.add(best);
          clickedThisRound=true;
          matchedText=((best.innerText||best.textContent||"").split("\n")[0]||"").trim().slice(0,60);
          matchedId=String((descs[pick.index]&&descs[pick.index].id)||"");
          // Dùng keyboard navigation thay vì mouse click:
          // Facebook Lexical mention dropdown mở với option 0 đã highlight sẵn.
          // Cần ArrowDown × idx lần (idx=0 → 0 lần, idx=1 → 1 lần, ...) rồi Enter.
          const targetIdx=opts.indexOf(best);
          // Đếm token tên TRƯỚC Enter để verify sau: mention thật làm tăng số token.
          const nameSpansBefore=countNameSpans(box,matchedText);
          // Gửi ArrowDown qua trustedKey (CDP Input.dispatchKeyEvent, isTrusted=true)
          for(let k=0;k<targetIdx;k++){
            try{await chrome.runtime.sendMessage({action:"trustedKey",key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40});}catch(_){}
            await sleep(120);
            if(!await isActive())return false;
          }
          // Enter để chọn option đang được highlight
          try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});}catch(_){}
          await sleep(800);
          const innerAfter=box.innerText||'';
          // Verify CHẶT (bắt live báo OK giả): @query phải biến mất KHỎI box VÀ số
          // token tên phải tăng (mention node thật được chèn). Quy tắc cũ chấp nhận
          // "text co lại <5 ký tự" đã cho qua trường hợp Enter không chọn gì nhưng
          // Lexical chuẩn hoá mất ký tự "@" — comment đăng lên chỉ còn text thường.
          const atPartialGone=!innerAfter.includes('@'+partial.slice(0,4));
          const nameSpansAfter=countNameSpans(box,matchedText);
          if(atPartialGone&&nameSpansAfter>nameSpansBefore){
            selected=true;break;
          }
          // Keyboard không có tác dụng — thử lại
          retrigger=true;
          break;
        }
        if(abortDropdown)break;
        if(!selected&&!clickedThisRound)await sleep(300);
      }
      if(!selected){
        // Ghi lý do skip để user biết TẠI SAO không tag (thay vì fail câm):
        // "no-dropdown" = FB không mở gợi ý (query không khớp ai / box mất focus),
        // "not-suggested" = dropdown có mở nhưng entity không nằm trong gợi ý,
        // "ambiguous" = nhiều gợi ý trùng tên, không xác định được đúng entity.
        const reason=skipReasonOverride||(seenListbox?"not-suggested":"no-dropdown");
        let dbg="";
        try{
          const ae=document.activeElement;
          const allLb=document.querySelectorAll('[role="listbox"]').length;
          const newLb=Array.from(document.querySelectorAll('[role="listbox"]')).filter(el=>{const r=el.getBoundingClientRect();return el.isConnected&&r.width>0&&r.height>0&&!preExistingLbs.has(el);}).length;
          const tail=String(box.innerText||box.textContent||"").slice(-30);
          const cls=String(box.className||"").split(" ").slice(0,4).join(".");
          const inDlg=!!(box.closest&&box.closest('[role="dialog"]'));
          dbg=" focusInBox="+(ae===box||(box.contains&&box.contains(ae)))+" allLb="+allLb+" newLb="+newLb+" inDlg="+inDlg+" boxCls="+cls.slice(0,60)+" route="+location.href.slice(0,80)+" tail="+tail;
        }catch(_){}
        try{
          globalThis.FbTagMention.lastResult={ok:false,reason,entity:String(entity.name).slice(0,80),partial,urlId:entityUrlId||null,dbg};
        }catch(_){}
        logActivity("tag","@tag bỏ qua ("+reason+") pos="+tagPos+" partial=@"+partial+" entity="+String(entity.name).slice(0,60)+dbg);
        box.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true,cancelable:true}));
        await sleep(150);
        // Dùng trusted Backspace để xóa @partial (execCommand delete không hoạt động trong Lexical).
        // Caret phải đứng ngay sau query (vị trí tag ngẫu nhiên) trước khi xóa.
        box.focus();
        await sleep(100);
        caretAfterQuery(partial);
        const charsToDelete=('@'+partial).length;
        for(let i=0;i<charsToDelete;i++){
          try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8});}catch(_){}
          await sleep(30);
        }
        await sleep(100);
        // Chỉ restore nếu đã xóa entity.name khỏi text (inline replace case)
        // KHÔNG chèn plain text khi append fallback fail — comment vẫn submit bình thường, chỉ thiếu tag.
        // Ngoại lệ: entity NHÓM thì không restore — tên nhóm dạng text thường trong
        // comment chính là bug user báo (không tag được mà thành text tên nhóm).
        if(inlineSelectFound&&deleteActuallyWorked&&!isGroupEntity){
          for(const ch of entity.name){document.execCommand('insertText',false,ch);await sleep(20);}
        }
      }else{
        try{
          globalThis.FbTagMention.lastResult={ok:true,entity:String(entity.name).slice(0,80),partial,via:matchVia,matched:matchedText,matchedId:matchedId||null};
        }catch(_){}
        // Tag thành công mới tiến vòng xoay để lần sau đổi vị trí mid/end.
        try{
          const cur=await chrome.storage.local.get(["tagPosRotateIdx"]);
          await chrome.storage.local.set({tagPosRotateIdx:(parseInt(cur.tagPosRotateIdx)||0)+1});
        }catch(_){}
        logActivity("tag","@tag OK ["+matchVia+"→"+matchedText+" id="+(matchedId||"?")+" pos="+tagPos+"]: "+String(entity.name).slice(0,60));
      }
      return selected;
    }catch(e){console.warn("[TagMention]",e);try{logActivity("tag","@tag lỗi: "+String(e?.message||e).slice(0,100));}catch(_){}return false;}
  }
  function isGroupPendingMembership(){
    const btns=document.querySelectorAll('[role="button"],[type="button"],button');
    for(const b of btns){
      const txt=(b.innerText||b.textContent||"").trim();
      if(/hủy yêu cầu|cancel request|yêu cầu đã gửi|request sent/i.test(txt)) return true;
      if(/^(tham gia nhóm|join group|ask to join|gửi yêu cầu tham gia)$/i.test(txt)) return true;
    }
    return false;
  }
  async function safeGroupNavigate(url,mode="reaction",runId="",reason="đổi nhóm"){
    if(!url)return false;
    if(runId&&!await groupModeRunActive(mode,runId))return false;
    if(!await prepareGroupCommentTransition(mode,reason))return false;
    if(runId&&!await groupModeRunActive(mode,runId))return false;
    location.href=url;
    return true;
  }
  function groupModeState(mode="reaction"){
    return mode==="comment"?{
      activeKey:"groupCommentActive",runIdKey:"groupCommentRunId",configKey:"groupCommentConfig",indexKey:"groupCommentIndex",doneKey:"groupCommentDone",totalKey:"groupCommentTotal",statusKey:"groupCommentStatus",stopKey:"comment",runFn:groupCommentRunActive
    }:{
      activeKey:"groupInteractActive",runIdKey:"groupInteractRunId",configKey:"groupInteractConfig",indexKey:"groupInteractIndex",doneKey:"groupInteractDone",totalKey:"groupInteractTotal",statusKey:"groupInteractStatus",stopKey:"reaction",runFn:groupInteractRunActive
    };
  }
  async function groupInteractRunActive(runId){
    if(groupStopRequested)return false;
    const live=await chrome.storage.local.get(["groupInteractActive","groupInteractRunId"]);
    return !!live.groupInteractActive&&!!runId&&live.groupInteractRunId===runId;
  }
  async function groupCommentRunActive(runId){
    if(groupCommentStopRequested)return false;
    const live=await chrome.storage.local.get(["groupCommentActive","groupCommentRunId"]);
    return !!live.groupCommentActive&&!!runId&&live.groupCommentRunId===runId;
  }
  async function groupModeRunActive(mode,runId){return mode==="comment"?groupCommentRunActive(runId):groupInteractRunActive(runId);}
  async function groupSleep(ms,runId=""){
    const end=Date.now()+ms;
    while(Date.now()<end){
      if(groupStopRequested||(runId&&!await groupInteractRunActive(runId))) return false;
      await sleep(Math.min(250,end-Date.now()));
    }
    return !groupStopRequested&&(!runId||await groupInteractRunActive(runId));
  }
  async function groupCommentSleep(ms,runId=""){
    const end=Date.now()+ms;
    while(Date.now()<end){
      if(groupCommentStopRequested||(runId&&!await groupCommentRunActive(runId))) return false;
      await sleep(Math.min(250,end-Date.now()));
    }
    return !groupCommentStopRequested&&(!runId||await groupCommentRunActive(runId));
  }
  chrome.storage.onChanged.addListener((changes,areaName)=>{
    if(areaName!=="local") return;
    if(changes.isFeedInteracting?.newValue===false) isFeedInteracting=false;
    if(changes.isAICommenting?.newValue===false){
      isAICommenting=false;
      void cleanupAICommentComposer(undefined,undefined,"Dừng");
    }
    if(changes.groupInteractActive?.newValue===false) groupStopRequested=true;
    if(changes.groupCommentActive?.newValue===false) groupCommentStopRequested=true;
  });
  async function groupInteractPostAIComment(article, commentText, expectedIdentity, wantedPath, runId="",mode="reaction",typingConfig=null,tagConfig=null,tagEntity=null){
    const modeStopped=()=>mode==="comment"?groupCommentStopRequested:groupStopRequested;
    if(runId&&!await groupModeRunActive(mode,runId)) return "stopped";
    if(!article?.isConnected) return "skip";
    if(isSponsoredPost(article,{ignoreGenericPreview:mode==="comment"})) return "skip";
    if(article.querySelector('a[href*="/reel/"],a[href*="/watch/"]')) return "skip";
    const normalize=s=>String(s||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim().toLowerCase();
    const proof=normalize(commentText).slice(0,60);
    if(!proof) return "skip";
    const signature=normalize(extractPostText(article)).slice(0,60);
    let currentArticle=article;
    if(commentProofExists(currentArticle,proof)) return "already-commented";
    // Dọn orphan composer của các lượt AI trước ngay trước khi mở bài mới.
    // Nếu chờ tới lúc Facebook đã đổi permalink, chính click mở bài kế tiếp
    // có thể kích hoạt cảnh báo "Rời khỏi trang?" trước khi cleanup kịp chạy.
    if(groupCommentDraftOwnedHistory.length||groupCommentDraftExpected){
      const previousCleaned=await cleanupGroupCommentDraft();
      if(!previousCleaned)return "draft";
    }
    const previousBoxes=new Set(visibleCommentBoxes());
    const commentBtn=findCommentButton(currentArticle);
    if(!commentBtn) return "skip";
    if(runId&&!await groupModeRunActive(mode,runId)) return "stopped";
    try{await trustedMouse(commentBtn,"click",()=>groupModeRunActive(mode,runId));}catch(_){ }
    let box=null,scope=currentArticle;
    for(let wait=0;wait<30;wait++){
      if(modeStopped()||(runId&&!await groupModeRunActive(mode,runId))) return "stopped";
      const live=await chrome.storage.local.get(mode==="comment"?["groupCommentActive","groupCommentRunId"]:["groupInteractActive","groupInteractRunId"]);
      if(!(mode==="comment"?live.groupCommentActive:live.groupInteractActive)||(runId&&(mode==="comment"?live.groupCommentRunId:live.groupInteractRunId)!==runId)) return "stopped";
      if(wantedPath && !location.pathname.startsWith(wantedPath)) return "navigated";
      if(!currentArticle.isConnected){
        const replacement=expectedIdentity?findFeedPostByIdentity(expectedIdentity):null;
        if(replacement) currentArticle=replacement;
        else{
          // Bài đã rời DOM (Facebook mở trang chi tiết/lớp phủ) nhưng ô nhập
          // có thể đã mở — vẫn nhận ô mới thay vì chờ mù rồi báo timeout.
          const openedEarly=findGroupCommentBoxOpenedByClick(previousBoxes,expectedIdentity,signature);
          if(openedEarly?.box){box=openedEarly.box;scope=openedEarly.scope;currentArticle=openedEarly.scope;break;}
          await sleep(400);continue;
        }
      }
      // Ở permalink Facebook dựng song song card cũ phía sau và bài trong
      // cửa sổ nổi. Luôn lấy editor trong cửa sổ nổi trước khi xét card cũ;
      // đây là composer mà người dùng thấy và cũng tránh để lại draft ẩn ở
      // nền khi chuyển sang bài/nhóm tiếp theo.
      const detailComposer=findGroupPostDetailComposer(expectedIdentity,signature);
      if(detailComposer?.box){box=detailComposer.box;scope=detailComposer.scope;currentArticle=detailComposer.scope;break;}
      // Facebook thường giữ composer rỗng của card cũ rồi mount một composer
      // mới ở lớp chi tiết. Ưu tiên node mới xuất hiện sau cú click; nếu chọn
      // node cũ ngay lập tức thì React sẽ chuyển phần gõ xuống node mới, làm
      // người dùng thấy ô phía trên mở nhưng không có chữ.
      const opened=findGroupCommentBoxOpenedByClick(previousBoxes,expectedIdentity,signature);
      if(opened?.box){box=opened.box;scope=opened.scope;break;}
      const exact=findExactCommentBox(currentArticle,expectedIdentity,signature);
      const exactIsNew=!!(exact?.box&&!previousBoxes.has(exact.box));
      if(exact?.box&&(exactIsNew||wait>=8)){box=exact.box;scope=exact.scope;break;}
      await sleep(400);
    }
    if(!box||!box.isConnected) return "box-timeout";
    if(isMessengerChatBox(box)) return "box-timeout";
    try{box.scrollIntoView({behavior:"instant",block:"center"});}catch{ }
    await sleep(300);
    let focused=false;
    try{box.focus();box.click();focused=document.activeElement===box||box.contains(document.activeElement);}catch(_){ }
    if(!focused&&box.isConnected){
      try{await trustedMouse(box,"click");focused=document.activeElement===box||box.contains(document.activeElement);}catch(_){ }
    }
    if(!focused||isMessengerChatBox(document.activeElement)) return "box-timeout";
    // Ghi nhớ ngay khi đã xác nhận ô đang rỗng. Nếu Facebook thay composer
    // giữa lúc gõ, nhánh nhập hụt vẫn phải lần lại đúng bài để dọn phần nháp
    // do chính lượt Comment AI này tạo ra. Không ghi nhớ ô đã có draft để
    // không bao giờ dọn nhầm nội dung người dùng.
    const ownsComposer=!commentComposerText(box);
    if(ownsComposer) rememberGroupCommentDraft(box,currentArticle,expectedIdentity,signature,commentText);
    const resolveGroupComposer=(preferred)=>{
      const detailComposer=findGroupPostDetailComposer(expectedIdentity,signature);
      if(detailComposer?.box){
        scope=detailComposer.scope;
        if(normalizeCommentComposerText(commentComposerText(detailComposer.box))===normalizeCommentComposerText(commentText))return detailComposer.box;
        if(!commentComposerText(detailComposer.box))return detailComposer.box;
      }
      const exact=findExactCommentBox(currentArticle,expectedIdentity,signature);
      const exactBox=exact?.box||null;
      if(exact){scope=exact.scope;}
      if(exactBox&&normalizeCommentComposerText(commentComposerText(exactBox))===normalizeCommentComposerText(commentText))return exactBox;
      // `preferred` là composer vừa được mở sau cú click. Nếu nó còn rỗng,
      // giữ focus ở chính node này; không quay ngược về composer cũ đang nằm
      // phía trên vì Facebook có thể thay node trong lúc bắt đầu gõ.
      if(preferred?.isConnected&&!commentComposerText(preferred))return preferred;
      const replacement=findGroupCommentDraftReplacement(preferred||exactBox);
      return replacement||exactBox||preferred||null;
    };
    const typingGuard={
      storageKey:mode==="comment"?"groupCommentActive":"groupInteractActive",
      runId,
      runIdKey:mode==="comment"?"groupCommentRunId":"groupInteractRunId",
      typingConfig:typingConfig||aiTypingConfig
    };
    let filled=await fillAndVerifyCommentBox(box,commentText,resolveGroupComposer,()=>groupModeRunActive(mode,runId),typingGuard);
    // Facebook có thể thay composer đúng lúc đang gõ. Nếu lần đầu chỉ tạo
    // được bản nháp hụt, đã dọn sạch ô do AI sở hữu thì thử lại một lần trên
    // composer mới của chính bài đó; không chuyển bài và không gửi nội dung
    // chưa được xác nhận đủ.
    if(!filled.ok&&filled.reason==="typeincomplete"&&!modeStopped()&&await groupModeRunActive(mode,runId)){
      await cleanupGroupCommentDraft(filled.box||box);
      await sleep(500);
      const retryBox=resolveGroupComposer(box);
      if(retryBox?.isConnected&&!commentComposerText(retryBox)){
        rememberGroupCommentDraft(retryBox,currentArticle,expectedIdentity,signature,commentText);
        filled=await fillAndVerifyCommentBox(retryBox,commentText,resolveGroupComposer,()=>groupModeRunActive(mode,runId),typingGuard);
      }
    }
    if(filled.box?.isConnected)box=filled.box;
    if(!filled.ok){
      if(filled.reason==="typeincomplete"||filled.reason==="stopped"){
        await cleanupGroupCommentDraft(box);
      }else{
        clearGroupCommentDraftMemory();
      }
      return filled.reason||"typeincomplete";
    }
    if(!ownsComposer) clearGroupCommentDraftMemory();
    // Tag do lõi chung gắn (unifiedSendProofDwell) — không gắn ở đây để khỏi mention 2 lần.
    // DỪNG BẰNG MỌI GIÁ: kiểm tra lại ngay trước cú gửi. Nếu đã sở hữu
    // composer và đã gõ nội dung, phải dọn draft trước khi trả về để lần
    // điều hướng kế tiếp không bật cảnh báo "Rời khỏi trang?".
    if(modeStopped()||(runId&&!await groupModeRunActive(mode,runId))){
      await cleanupGroupCommentDraft(box);
      return "stopped";
    }
    const guardKey=expectedIdentity||postIdentity(currentArticle);
    const guardKeyName=mode==="comment"?"groupCommentSubmissionGuard":"groupInteractCommentGuard";
    const guardStored=await chrome.storage.local.get(guardKeyName);
    const guard=guardStored[guardKeyName]&&typeof guardStored[guardKeyName]==="object"?guardStored[guardKeyName]:{};
    if(guardKey){guard[guardKey]={time:Date.now(),source:mode==="comment"?"group-comment":"group-interact",state:"submitting",runId};await chrome.storage.local.set({[guardKeyName]:guard});}
    if(runId&&!await groupModeRunActive(mode,runId)){
      await cleanupGroupCommentDraft(box);
      await closeExactCommentOverlay(scope);
      return "stopped";
    }
    // Gửi + proof + nán qua lõi chung (tag/không tag một cơ chế với Bản tin & AI).
    // Giữ hasOwnComment-confirm 8s (server đã nhận) và guard riêng của nhóm.
    const gSendRes=await unifiedSendProofDwell({
      box, commentScope:scope, proof, tagEntity, tagConfig,
      alive:async()=>{
        if(modeStopped())return false;
        if(runId&&!await groupModeRunActive(mode,runId))return false;
        const live=await chrome.storage.local.get(mode==="comment"?["groupCommentActive","groupCommentRunId"]:["groupInteractActive","groupInteractRunId"]);
        if(!(mode==="comment"?live.groupCommentActive:live.groupInteractActive))return false;
        if(runId&&(mode==="comment"?live.groupCommentRunId:live.groupInteractRunId)!==runId)return false;
        return true;
      },
      onEvent:()=>{},
      clearDraft:()=>cleanupGroupCommentDraft(box),
      findSend:()=>{ const b=findCommentSendButton(box); return (b&&!isMessengerChatBox(b))?b:null; },
      sendEnter:()=>chrome.runtime.sendMessage({action:"trustedInput",text:"",pressEnter:true,typingMinDelay:0,typingMaxDelay:0}).then(r=>!!r?.ok).catch(()=>false),
      onProofTick:async()=>{
        if(wantedPath&&!location.pathname.startsWith(wantedPath))return "navigated";
        return null;
      },
      proofRoots:()=>{
        const s=scope?.isConnected?scope:findFeedPostByIdentity(expectedIdentity);
        const arr=[s,currentArticle];
        if(location.pathname.includes("/groups/"))arr.push(document);
        return arr;
      },
      scrollIntoView:()=>{ try{box.scrollIntoView({behavior:"instant",block:"center"});}catch{} },
      onCounted:async (hit)=>{
        const confirmScope=(hit&&hit.isConnected)?hit:(currentArticle?.isConnected?currentArticle:null);
        const confirmDeadline=Date.now()+8000;
        while(confirmScope&&!hasOwnComment(confirmScope)&&Date.now()<confirmDeadline){
          if(modeStopped()||(runId&&!await groupModeRunActive(mode,runId)))break;
          await sleep(500);
        }
        const cleaned=await cleanupGroupCommentDraft(box);
        await closeExactCommentOverlay(scope);
        return cleaned?true:"draft";
      },
    });
    if(gSendRes==="stopped")return "stopped";
    if(gSendRes==="navigated")return "navigated";
    if(gSendRes==="tag-proof-missing"){await cleanupGroupCommentDraft(box);return "tag-proof-missing";}
    if(gSendRes==="skip"){
      if(guardKey){delete guard[guardKey];await chrome.storage.local.set({[guardKeyName]:guard});}
      return "box-timeout";
    }
    if(gSendRes==="unconfirmed-skip")return "unconfirmed-skip";
    if(gSendRes!==true)return "stopped";
    return true;
  }
  async function continueGroupInteraction(){
    if(isGroupInteracting) return;
    isGroupInteracting=true;
    let activeRunId="";
    try{
      let stored=await chrome.storage.local.get(["groupInteractActive","groupInteractRunId","groupInteractConfig","groupInteractIndex","groupInteractDone","groupInteractAiDone","groupInteractCommentHistory","groupInteractCommentGuard","groupInteractAiSkipped","groupInteractCurrentGroupIndex","groupInteractCurrentGroupDone","groupInteractCurrentGroupAiDone","groupInteractReactedKeys","groupInteractReactionGuard"]);
      let cfg=stored.groupInteractConfig;
      if(!stored.groupInteractActive || !cfg?.groups?.length) return;
      activeRunId=String(stored.groupInteractRunId||cfg.runId||"");
      if(!activeRunId){
        activeRunId=`group-interact-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        cfg={...cfg,runId:activeRunId};
        await chrome.storage.local.set({groupInteractRunId:activeRunId,groupInteractConfig:cfg});
      }
      if(!await groupInteractRunActive(activeRunId))return;
      if(cfg.targetGroups) cfg={...cfg,groups:cfg.groups.slice(0,Math.max(1,parseInt(cfg.targetGroups)||cfg.groups.length))};
      // Like/Random is a standalone run. AI comments have their own start,
      // counters, guards and resume state below; an old persisted aiComment
      // flag must never silently combine the two actions again.
      const aiCommentEnabled=false;
      let index=parseInt(stored.groupInteractIndex)||0;
      let totalDone=parseInt(stored.groupInteractDone)||0;
      let totalAiDone=parseInt(stored.groupInteractAiDone)||0;
      let commentHistory=stored.groupInteractCommentHistory&&typeof stored.groupInteractCommentHistory==="object"?stored.groupInteractCommentHistory:{};
      const commentGuard=stored.groupInteractCommentGuard&&typeof stored.groupInteractCommentGuard==="object"?stored.groupInteractCommentGuard:{};
      const seenCommentKeys=new Set(Object.keys(commentHistory));
      // A reload after a comment send is ambiguous.  Treat its pre-send guard
      // as seen for this run so the same post is never sent twice.
      Object.entries(commentGuard).forEach(([key,value])=>{if(value?.runId===activeRunId)seenCommentKeys.add(key);});
      let reactedKeys=stored.groupInteractReactedKeys&&typeof stored.groupInteractReactedKeys==="object"?stored.groupInteractReactedKeys:{};
      let reactionGuard=stored.groupInteractReactionGuard&&typeof stored.groupInteractReactionGuard==="object"?stored.groupInteractReactionGuard:{};
      const seenReactionKeys=new Set(Object.keys(reactedKeys));
      Object.entries(reactionGuard).forEach(([key,value])=>{if(value?.runId===activeRunId)seenReactionKeys.add(key);});
      let aiSkipped=(stored.groupInteractAiSkipped&&typeof stored.groupInteractAiSkipped==="object")?stored.groupInteractAiSkipped:{};
      const AI_SKIP_NAMES={short:t("ai.skip.short"),seen:t("ai.skip.seen"),own:t("ai.skip.own"),nobutton:t("ai.skip.nobutton"),boxtimeout:t("ai.skip.boxtimeout"),draft:t("ai.skip.draft"),typeincomplete:t("ai.skip.typeincomplete"),unconfirmed:t("ai.skip.unconfirmed"),navigated:t("ai.skip.navigated"),duplicate:t("ai.skip.duplicate")};
      const aiSkippedTotal=()=>Object.values(aiSkipped).reduce((s,n)=>s+(parseInt(n)||0),0);
      const aiSkipSummary=()=>{const parts=Object.entries(aiSkipped).filter(([,n])=>(parseInt(n)||0)>0).map(([k,n])=>`${n} ${AI_SKIP_NAMES[k]||k}`);return parts.length?t("ai.skippedSummary",{total:aiSkippedTotal(),parts:parts.join(", ")}):"";};
      const noteAiSkip=(reason)=>{aiSkipped[reason]=(parseInt(aiSkipped[reason])||0)+1;};
      const groupAiStatus=(groupDoneNow,groupAiDoneNow)=>aiCommentEnabled?" • "+t("ai.aiDoneCount",{n:groupAiDoneNow})+(aiSkippedTotal()?` • ${t("ai.skippedN",{n:aiSkippedTotal()})}`:""):"";
      const statusSuffix=()=>aiCommentEnabled?" • "+t("ai.aiDoneCount",{n:totalAiDone})+aiSkipSummary():"";
      let groupDone=Number(stored.groupInteractCurrentGroupIndex)===index?Math.max(0,parseInt(stored.groupInteractCurrentGroupDone)||0):0;
      let groupAiDone=Number(stored.groupInteractCurrentGroupIndex)===index?Math.max(0,parseInt(stored.groupInteractCurrentGroupAiDone)||0):0;
      if(index>=cfg.groups.length){
        if(await maybeHandoffGroupComment(activeRunId))return;
        await chrome.storage.local.set({groupInteractActive:false,groupInteractStatus:t("gi2.allDone",{n:cfg.groups.length,done:totalDone,suffix:statusSuffix()})});
        return;
      }
      const group=cfg.groups[index];
      const wantedPath=new URL(group.url).pathname.replace(/\/$/,"");
      if(!location.pathname.startsWith(wantedPath)){
        if(!await groupInteractRunActive(activeRunId)) return;
        await chrome.storage.local.set({groupInteractStatus:t("gi2.opening",{i:index+1,t:cfg.groups.length,name:group.name})});
        if(!await groupInteractRunActive(activeRunId)) return;
        await safeGroupNavigate(group.url,"reaction",activeRunId,"mở nhóm");
        return;
      }
      await chrome.storage.local.set({groupInteractStatus:t("gi2.interacting",{i:index+1,t:cfg.groups.length,name:group.name})});
      if(!await groupSleep(2500,activeRunId)) return;
      if(isGroupPendingMembership()){
        totalDone+=0;
        await chrome.storage.local.set({groupInteractIndex:index+1,groupInteractCurrentGroupIndex:index+1,groupInteractCurrentGroupDone:0,groupInteractStatus:t("gi2.skippedPending",{name:group.name,i:index+1,t:cfg.groups.length})});
        if(index+1<cfg.groups.length){
          if(!await groupSleep(1200,activeRunId))return;
          await safeGroupNavigate(cfg.groups[index+1].url,"reaction",activeRunId,"bỏ qua nhóm pending");
        }else{
          if(await maybeHandoffGroupComment(activeRunId))return;
          await chrome.storage.local.set({groupInteractActive:false,groupInteractStatus:t("gi2.allDone",{n:cfg.groups.length,done:totalDone,suffix:statusSuffix()})});
        }
        return;
      }
      let emptyTries=0;
      let noProgressRounds=0;
      while(groupDone<cfg.perGroup){
        if(!await groupInteractRunActive(activeRunId)) return;
        const groupDoneBeforeRound=groupDone;
        let buttons=findFeedLikeButtons();
        if(!buttons.length){
          emptyTries++;
          window.scrollBy(0,Math.max(850,innerHeight*.8));
          if(!await groupSleep(1800,activeRunId)) return;
          if(emptyTries>=7) break;
          continue;
        }
        emptyTries=0;
        for(const btn of buttons){
          if(groupDone>=cfg.perGroup || !await groupInteractRunActive(activeRunId)) break;
          const bar=findMainActionBar(btn),post=findFeedPostContainer(btn);
          btn.scrollIntoView({behavior:"smooth",block:"center"});
          if(!await groupSleep(650,activeRunId)) return;
          if(!isValidFeedLike(btn,bar)) continue;
          try{
            const postTextBefore=post?extractPostText(post):"";
            const reactionKey=post?(postIdentity(post)||postContentKey(postTextBefore)):"";
            if(reactionKey&&seenReactionKeys.has(reactionKey))continue;
            if(!await groupInteractRunActive(activeRunId))return;
            if(reactionKey){
              reactionGuard[reactionKey]={time:Date.now(),runId:activeRunId,state:"reacting"};
              await chrome.storage.local.set({groupInteractReactionGuard:reactionGuard});
              if(!await groupInteractRunActive(activeRunId))return;
            }
            const result=await doReact(btn,cfg.reaction,()=>groupInteractRunActive(activeRunId));
            if(!await groupInteractRunActive(activeRunId)) return;
            btn.dataset.feedInteracted="1";
            if(post) post.dataset.feedInteracted="1";
            if(!result.success){
              if(reactionKey){delete reactionGuard[reactionKey];await chrome.storage.local.set({groupInteractReactionGuard:reactionGuard});}
              continue;
            }
            if(reactionKey){
              seenReactionKeys.add(reactionKey);
              reactedKeys[reactionKey]={time:Date.now(),runId:activeRunId};
              delete reactionGuard[reactionKey];
            }
            groupDone++; totalDone++;
            if(post) post.style.outline="2px solid #00897b";
            if(aiCommentEnabled&&post&&post.isConnected){
              const postKey=postIdentity(post);
              try{await expandArticleSeeMore(post);}catch(_){}
              const postText=extractPostText(post);
              const contentKey=postContentKey(postText);
              const alreadySeen=(postKey&&seenCommentKeys.has(postKey))||(contentKey&&Object.values(commentHistory).some(e=>e?.contentKey===contentKey));
              const ownComment=hasOwnComment(post);
              if(!postText||postText.trim().length<15)noteAiSkip("short");
              else if(alreadySeen)noteAiSkip("seen");
              else if(ownComment){
                noteAiSkip("own");
                if(postKey&&!seenCommentKeys.has(postKey)){seenCommentKeys.add(postKey);commentHistory[postKey]={time:Date.now(),source:"group-interact",contentKey:contentKey||"",existing:true};}
              }
              else if(await postSigMarked(postText)){noteAiSkip("seen");}
              else{
                let commentText="";
    try{
                  const aiRes=await chrome.runtime.sendMessage({action:"aiGenerateFeedComment",postText:postText.slice(0,1500),prompt:cfg.prompt||"",aiConfig:cfg.aiConfig||{},metaFeature:"group-comment"});
                  if(!aiRes?.ok) throw new Error(aiRes?.error||t("ai2.genFailAi"));
                  commentText=sanitizeCommentOutput(String(aiRes.comment||"").trim()).replace(/[!！]+\s*$/g,"").trimEnd();
                }catch(e){console.warn("[Group Interact AI]",e);commentText=fallbackComment(postText);}
                if(!commentText){}
                else if(/không thể|rất tiếc|xin lỗi|từ chối|không giúp|i'm sorry|i can't|tôi không thể|chưa thể giúp/i.test(commentText)){noteAiSkip("airefusal");console.warn("[Group Interact AI] Bỏ qua vì AI từ chối:",commentText.slice(0,80));}
                else if(commentText){
                  const aiResult=await groupInteractPostAIComment(post,commentText,postKey,wantedPath,activeRunId,"reaction",cfg.typingConfig);
                  if(!await groupInteractRunActive(activeRunId)) return;
                  if(aiResult===true||aiResult==="already-commented"){
                    groupAiDone++;totalAiDone++;
                    await markPostSig(postText);
                    if(postKey){seenCommentKeys.add(postKey);commentHistory[postKey]={time:Date.now(),source:"group-interact",contentKey:contentKey||""};}
                    if(post.isConnected) post.style.outline="2px solid #9c27b0";
                  }else if(aiResult==="unconfirmed-skip"){
                    noteAiSkip("unconfirmed");
                    if(postKey){seenCommentKeys.add(postKey);commentHistory[postKey]={time:Date.now(),source:"group-interact",contentKey:contentKey||"",unconfirmed:true};}
                  }else if(aiResult==="navigated"){
                    // Nút Bình luận đưa Facebook sang trang khác (viewer ảnh,
                    // permalink lạ...): khóa bài chống lặp rồi quay lại nhóm,
                    // phiên tự tiếp tục sau khi tải lại.
                    noteAiSkip("navigated");
                    if(postKey){seenCommentKeys.add(postKey);commentHistory[postKey]={time:Date.now(),source:"group-interact",contentKey:contentKey||"",navigated:true};}
                    await chrome.storage.local.set({groupInteractDone:totalDone,groupInteractAiDone:totalAiDone,groupInteractCurrentGroupIndex:index,groupInteractCurrentGroupDone:groupDone,groupInteractCurrentGroupAiDone:groupAiDone,groupInteractReactedKeys:reactedKeys,groupInteractReactionGuard:reactionGuard,groupInteractAiSkipped:aiSkipped,groupInteractCommentHistory:commentHistory,groupInteractStatus:t("gi2.postDone",{name:group.name,done:groupDone,per:cfg.perGroup,ai:groupAiStatus(groupDone,groupAiDone)})+t("gi2.navBack")});
                    await safeGroupNavigate(group.url,"reaction",activeRunId,"quay lại nhóm sau khi Facebook chuyển trang");
                    return;
                  }else if(aiResult==="stopped"){
                    return;
                  }else{
                    noteAiSkip(aiResult==="skip"?"nobutton":"boxtimeout");
                  }
                }
              }
            }
            await chrome.storage.local.set({groupInteractDone:totalDone,groupInteractAiDone:totalAiDone,groupInteractCurrentGroupIndex:index,groupInteractCurrentGroupDone:groupDone,groupInteractCurrentGroupAiDone:groupAiDone,groupInteractReactedKeys:reactedKeys,groupInteractReactionGuard:reactionGuard,groupInteractAiSkipped:aiSkipped,groupInteractCommentHistory:commentHistory,groupInteractStatus:t("gi2.postDone",{name:group.name,done:groupDone,per:cfg.perGroup,ai:groupAiStatus(groupDone,groupAiDone)})});
            if(groupDone<cfg.perGroup && !await groupSleep(rand(cfg.minDelay*1000,cfg.maxDelay*1000),activeRunId)) return;
          }catch(e){ console.warn("[Group Interact]",e); }
        }
        if(groupDone<cfg.perGroup){
          // Facebook can keep the same already-processed reaction buttons in
          // the DOM forever. A non-empty list is not proof that this round
          // made progress, so stop retrying the same nodes after a few rounds.
          noProgressRounds=groupDone===groupDoneBeforeRound?noProgressRounds+1:0;
          if(noProgressRounds>=3)break;
          window.scrollBy(0,innerHeight*.9);
          if(!await groupSleep(1500,activeRunId)) return;
        }
      }
      if(!await groupInteractRunActive(activeRunId)) return;
      index++;
      if(aiCommentEnabled) console.warn("[Group Interact AI] chi tiết bỏ comment:",{...aiSkipped});
      await chrome.storage.local.set({groupInteractIndex:index,groupInteractAiDone:totalAiDone,groupInteractCurrentGroupIndex:index,groupInteractCurrentGroupDone:0,groupInteractCurrentGroupAiDone:0,groupInteractReactedKeys:{},groupInteractReactionGuard:{},groupInteractAiSkipped:aiSkipped,groupInteractCommentHistory:commentHistory,groupInteractStatus:t("gi2.groupDone",{name:group.name,done:groupDone,per:cfg.perGroup,ai:aiCommentEnabled?" • "+t("ai.aiDoneCount",{n:groupAiDone})+aiSkipSummary():""})});
      if(index<cfg.groups.length){
        if(!await groupSleep(rand(cfg.minDelay*1000,cfg.maxDelay*1000),activeRunId)) return;
        if(!await groupInteractRunActive(activeRunId)) return;
        await safeGroupNavigate(cfg.groups[index].url,"reaction",activeRunId,"sang nhóm kế tiếp");
      }else{
        if(await groupInteractRunActive(activeRunId)){
          if(await maybeHandoffGroupComment(activeRunId))return;
          await chrome.storage.local.set({groupInteractActive:false,groupInteractStatus:t("gi2.allDone",{n:cfg.groups.length,done:totalDone,suffix:statusSuffix()})});
        }
      }
    }finally{
      isGroupInteracting=false;
      const next=await chrome.storage.local.get(["groupInteractActive","groupInteractRunId"]);
      if(next.groupInteractActive&&next.groupInteractRunId&&next.groupInteractRunId!==activeRunId)setTimeout(continueGroupInteraction,0);
    }
  }

  // Khởi động máy comment-nhóm dùng chung cho nút Comment riêng và nối tiếp
  // sau phase Like (mode both). Giữ nguyên mọi giá trị mặc định/flag của logic
  // message handler cũ, chỉ tách ra để tái dùng mà không lệch hành vi.
  async function startGroupCommentRun(o){
    const runId=String(o.runId||`group-comment-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    const requestedGroups=Math.max(1,parseInt(o.targetGroups)||(o.groups||[]).length||1);
    const limitedGroups=(o.groups||[]).slice(0,Math.min(requestedGroups,(o.groups||[]).length));
    const cfg={groups:limitedGroups,perGroup:Math.max(1,parseInt(o.perGroup)||5),minDelay:Math.max(1,parseInt(o.minDelay)||5),maxDelay:Math.max(1,parseInt(o.maxDelay)||12),targetGroups:requestedGroups,typingConfig:o.typingConfig?normalizeAiTypingConfig(o.typingConfig):null,prompt:String(o.prompt||"").trim(),tagPrompt:String(o.tagPrompt||"").trim(),aiConfig:o.aiConfig&&typeof o.aiConfig==="object"?o.aiConfig:{},tagConfig:o.tagConfig||null,runId,ownerTabId:o.ownerTabId||0,economyMode:["max","balanced","personal"].includes(o.economyMode)?o.economyMode:"personal",cacheDays:Math.max(0,parseInt(o.cacheDays)||7)};
    groupCommentStopRequested=false;
    groupCommentCache={};
    clearGroupCommentDraftMemory();
    clearGroupCommentDraftOwnedHistory();
    // Lịch sử và submission guard là kho chống trùng/audit của người dùng,
    // không phải state của một run mới. Trước đây Start ghi {} vào hai key này,
    // làm mất lịch sử sau mỗi lần chạy (vi phạm bảo toàn dữ liệu). Đọc trước,
    // giữ nguyên đúng object shape; chỉ reset các counter/processed keys thuộc
    // riêng run hiện tại.
    const previous=await chrome.storage.local.get(["groupCommentHistory","groupCommentSubmissionGuard"]);
    const history=previous.groupCommentHistory&&typeof previous.groupCommentHistory==="object"&&!Array.isArray(previous.groupCommentHistory)?previous.groupCommentHistory:{};
    const submissionGuard=previous.groupCommentSubmissionGuard&&typeof previous.groupCommentSubmissionGuard==="object"&&!Array.isArray(previous.groupCommentSubmissionGuard)?previous.groupCommentSubmissionGuard:{};
    await chrome.storage.local.set({groupCommentActive:true,groupCommentRunId:runId,groupCommentConfig:cfg,groupCommentIndex:0,groupCommentDone:0,groupCommentTotal:cfg.groups.length*cfg.perGroup,groupCommentCurrentGroupIndex:0,groupCommentCurrentGroupDone:0,groupCommentHistory:history,groupCommentSubmissionGuard:submissionGuard,groupCommentProcessedKeys:[],groupCommentRetryCounts:[],groupCommentSkipped:{},groupCommentStatus:t("gi2.commentStarting")});
    setTimeout(continueGroupComment,200);
    return {runId,cfg};
  }
  // Nối tiếp Both: cuối phase Like mà popup đã chốt followup comment thì khởi
  // động máy comment-nhóm ngay trong tab, thay vì kết thúc run. Trả false
  // (kết thúc bình thường) khi: không có followup, máy comment đang bận, hoặc
  // run đã bị dừng — tuyệt đối không giằng máy của run khác.
  async function maybeHandoffGroupComment(activeRunId){
    try{
      const st=await chrome.storage.local.get(["groupBothActive","groupCommentFollowupConfig","groupCommentActive"]);
      const snap=st.groupCommentFollowupConfig;
      if(!st.groupBothActive||!snap||!Array.isArray(snap.groups)||!snap.groups.length)return false;
      if(st.groupCommentActive)return false;
      if(!await groupInteractRunActive(activeRunId))return false;
      let ownerTabId=0;
      try{ownerTabId=(await chrome.runtime.sendMessage({action:"getSenderTabId"}))?.tabId||0;}catch(_){}
      await startGroupCommentRun({...snap,ownerTabId});
      await chrome.storage.local.set({groupInteractActive:false,groupInteractStatus:t("gi2.bothPhaseComment",{n:snap.groups.length})});
      return true;
    }catch(e){return false;}
  }

  async function continueGroupComment(){
    if(isGroupCommenting)return;
    isGroupCommenting=true;
    let activeRunId="";
    try{
      let stored=await chrome.storage.local.get(["groupCommentActive","groupCommentRunId","groupCommentConfig","groupCommentIndex","groupCommentDone","groupCommentTotal","groupCommentHistory","groupCommentSubmissionGuard","groupCommentProcessedKeys","groupCommentSkipped","groupCommentRetryCounts","groupCommentCurrentGroupIndex","groupCommentCurrentGroupDone"]);
      let cfg=stored.groupCommentConfig;
      if(!stored.groupCommentActive||!cfg?.groups?.length)return;
      activeRunId=String(stored.groupCommentRunId||cfg.runId||"");
      if(!activeRunId){
        activeRunId=`group-comment-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        cfg={...cfg,runId:activeRunId};
        await chrome.storage.local.set({groupCommentRunId:activeRunId,groupCommentConfig:cfg});
      }
      if(!await groupCommentRunActive(activeRunId))return;
      if(cfg.targetGroups)cfg={...cfg,groups:cfg.groups.slice(0,Math.max(1,parseInt(cfg.targetGroups)||cfg.groups.length))};
      let index=parseInt(stored.groupCommentIndex)||0;
      let totalDone=parseInt(stored.groupCommentDone)||0;
      let commentHistory=stored.groupCommentHistory&&typeof stored.groupCommentHistory==="object"?stored.groupCommentHistory:{};
      const submissionGuard=stored.groupCommentSubmissionGuard&&typeof stored.groupCommentSubmissionGuard==="object"?stored.groupCommentSubmissionGuard:{};
      // Lịch sử cũ chỉ là nhật ký/audit, không phải bộ lọc của lượt mới.
      // Người dùng yêu cầu mọi bài đang thấy được AI đọc và comment; dùng
      // history xuyên phiên ở đây từng làm các bài mới bị báo nhầm là
      // "đã xử lý" sau khi Facebook tái dùng permalink/DOM. Chỉ guard của
      // CHÍNH run hiện tại mới chặn gửi lại một submit còn mơ hồ sau reload.
      const activeRunSubmissionKeys=new Set();
      Object.entries(submissionGuard).forEach(([key,value])=>{if(value?.runId===activeRunId)activeRunSubmissionKeys.add(key);});
      const processedKeys=new Set(Array.isArray(stored.groupCommentProcessedKeys)?stored.groupCommentProcessedKeys:[]);
      const skipped=stored.groupCommentSkipped&&typeof stored.groupCommentSkipped==="object"?stored.groupCommentSkipped:{};
      const retryCounts=stored.groupCommentRetryCounts&&typeof stored.groupCommentRetryCounts==="object"?stored.groupCommentRetryCounts:{};
      const skipNames={short:t("ai.skip.short"),seen:t("ai.skip.seen"),own:t("ai.skip.own"),nobutton:t("ai.skip.nobutton"),boxtimeout:t("ai.skip.boxtimeout"),draft:t("ai.skip.draft"),typeincomplete:t("ai.skip.typeincomplete"),unconfirmed:t("ai.skip.unconfirmed"),navigated:t("ai.skip.navigated"),duplicate:t("ai.skip.duplicate")};
      const skipTotal=()=>Object.values(skipped).reduce((sum,n)=>sum+(parseInt(n)||0),0);
      const skipSummary=()=>{const parts=Object.entries(skipped).filter(([,n])=>(parseInt(n)||0)>0).map(([key,n])=>`${n} ${skipNames[key]||key}`);return parts.length?` • ${t("ai.skippedSummary",{total:skipTotal(),parts:parts.join(", ")})}`:"";};
      const noteSkip=reason=>{skipped[reason]=(parseInt(skipped[reason])||0)+1;};
      let groupDone=Number(stored.groupCommentCurrentGroupIndex)===index?Math.max(0,parseInt(stored.groupCommentCurrentGroupDone)||0):0;
      let noProgressRounds=0;
      if(index>=cfg.groups.length){
        await chrome.storage.local.set({groupCommentActive:false,groupCommentStatus:t("gi2.commentAllDone",{n:cfg.groups.length,done:totalDone,suffix:skipSummary()})});
        return;
      }
      const group=cfg.groups[index];
      const wantedPath=new URL(group.url).pathname.replace(/\/$/,"");
      if(!location.pathname.startsWith(wantedPath)){
        if(!await groupCommentRunActive(activeRunId))return;
        await chrome.storage.local.set({groupCommentStatus:t("gi2.commentOpening",{i:index+1,t:cfg.groups.length,name:group.name})});
        if(!await groupCommentRunActive(activeRunId))return;
        await safeGroupNavigate(group.url,"comment",activeRunId,"mở nhóm");
        return;
      }
      await chrome.storage.local.set({groupCommentStatus:t("gi2.commentInteracting",{i:index+1,t:cfg.groups.length,name:group.name})});
      // A group navigation can resolve before Facebook has mounted the first
      // feed card. On a slow connection the old 2.5s grace period ended the
      // run while the page was still a skeleton, reporting 0 comments even
      // though posts appeared a few seconds later. Give the route a longer
      // bounded settle period, then keep polling below while the feed grows.
      if(!await groupCommentSleep(6000,activeRunId))return;
      if(isGroupPendingMembership()){
        await chrome.storage.local.set({groupCommentIndex:index+1,groupCommentCurrentGroupIndex:index+1,groupCommentCurrentGroupDone:0,groupCommentStatus:t("gi2.skippedPending",{name:group.name,i:index+1,t:cfg.groups.length})});
        if(index+1<cfg.groups.length){
          if(!await groupCommentSleep(1200,activeRunId))return;
          await safeGroupNavigate(cfg.groups[index+1].url,"comment",activeRunId,"bỏ qua nhóm pending");
        }else{
          await chrome.storage.local.set({groupCommentActive:false,groupCommentStatus:t("gi2.commentAllDone",{n:cfg.groups.length,done:totalDone,suffix:""})});
        }
        return;
      }
      let emptyTries=0;
      while(groupDone<cfg.perGroup){
        if(!await groupCommentRunActive(activeRunId))return;
        const posts=findGroupCommentPosts();
        if(!posts.length){
          emptyTries++;
          await chrome.storage.local.set({groupCommentStatus:`${t("gi2.commentInteracting",{i:index+1,t:cfg.groups.length,name:group.name})} ${t("gi2.commentWaiting",{try:emptyTries,max:18})}`});
          window.scrollBy(0,Math.max(850,innerHeight*.8));
          if(emptyTries>=18)break;
          if(!await groupCommentSleep(2500,activeRunId))return;
          continue;
        }
        emptyTries=0;
        const groupDoneBeforeRound=groupDone;
        for(const post of posts){
          if(groupDone>=cfg.perGroup||!await groupCommentRunActive(activeRunId))break;
          if(!post||!post.isConnected)continue;
          try{await expandArticleSeeMore(post);}catch(_){}
          const postText=groupCommentSourceText(post);
          const postKey=postIdentity(post)||postContentKey(postText);
          if(postKey&&processedKeys.has(postKey))continue;
          if(postKey)processedKeys.add(postKey);
          if(post.isConnected)post.dataset.aiGcommentDone="1";
          let result="";
          if(isSponsoredPost(post,{ignoreGenericPreview:true})||post.querySelector('a[href*="/reel/"],a[href*="/watch/"]')){noteSkip("nobutton");}
          else if(postKey&&activeRunSubmissionKeys.has(postKey)){noteSkip("seen");}
          // commentHistory lưu persistent qua các run — bắt được bài đã comment
          // kể cả khi DOM thu gọn và hasOwnComment không thấy nút Edit/Delete.
          else if(postKey&&commentHistory[postKey]){noteSkip("seen");}
          // Không comment chồng lên chính comment đang hiển thị của tài khoản.
          // Đây là proof trực tiếp từ Facebook, khác với lịch sử nội bộ cũ.
          else if(hasOwnComment(post)){
            noteSkip("own");
            if(postKey)commentHistory[postKey]={time:Date.now(),source:"group-comment",contentKey:postContentKey(postText),existing:true,runId:activeRunId};
          }
          // Sổ cái chữ ký: chặn đăng trùng chéo phiên/tag-không-tag.
          else if(await postSigMarked(postText)){noteSkip("seen");}
          else{
            let commentText="";
            let tagEntity=null;
            const economyMode=cfg.economyMode||"personal";
            const cacheMaxAge=(cfg.cacheDays||0)*86400000;
            const postCacheKey=postContentKey(postText)||commentCacheKey(postText);
            // Tiết kiệm tối đa: không gọi AI, dùng câu mẫu ngay.
            if(economyMode==="max"){
              commentText=fallbackComment(postText);
            } else {
            try{
              // Cân bằng: kiểm tra cache trước — tái dùng comment đã tạo cho
              // nội dung tương tự trong cùng run (hoặc nếu cache vẫn còn hạn).
              if(economyMode==="balanced"&&postCacheKey&&groupCommentCache[postCacheKey]){
                const cached=groupCommentCache[postCacheKey];
                if(!cacheMaxAge||Date.now()-cached.time<=cacheMaxAge){
                  commentText=cached.comment;
                }
              }
              if(!commentText){
              // Quyết định TRƯỚC bài này có tag hay không (theo tỉ lệ), rồi mới
              // chọn prompt tag/thường — tránh bài không tag vẫn bị AI nhét tên
              // page vào câu (do lỡ dùng prompt tag) khiến nội dung gượng ép.
              tagEntity=decideTagForPost(cfg.tagConfig,totalDone);
              let effectivePrompt=tagEntity?(cfg.tagPrompt||cfg.prompt||""):(cfg.prompt||"");
              // Entity NHÓM hiếm khi được FB gợi ý mention; nhồi tên nhóm vào câu AI
              // (bắt buộc vị trí open/mid/close) thì lúc tag thất bại comment còn lại
              // text tên nhóm trơ trụi — đúng bug user báo. Với nhóm: dùng prompt
              // thường (xóa {tagName}), vẫn thử gắn mention kiểu append; trúng thì
              // có tag, trượt thì comment sạch không dính text thừa.
              if(tagEntity&&/\/groups\//i.test(String(tagEntity.url||""))){
                effectivePrompt=stripTagWeaveForGroup(effectivePrompt);
              }
              else if(tagEntity?.name) effectivePrompt=buildTagPrompt(effectivePrompt,tagEntity.name);
              else effectivePrompt=effectivePrompt.replace(/\{tagName\}/g,"");
              const aiRes=await chrome.runtime.sendMessage({action:"aiGenerateFeedComment",postText:postText.slice(0,1500),prompt:effectivePrompt,maxLines:(tagEntity&&!/\/groups\//i.test(String(tagEntity.url||"")))?2:1,aiConfig:cfg.aiConfig||{},metaFeature:"group-comment"});
              if(!aiRes?.ok)throw new Error(aiRes?.error||"AI failed");
              commentText=stripLiteralTagEntity(sanitizeCommentOutput(String(aiRes.comment||"").trim()).replace(/[!！]+\s*$/g,"").trimEnd(),tagEntity?.name);
              // Cân bằng: lưu kết quả vào cache để tái dùng cho bài tương tự.
              if(economyMode==="balanced"&&commentText&&postCacheKey){
                groupCommentCache[postCacheKey]={comment:commentText,time:Date.now()};
              }
              }
            }catch(error){console.warn("[Group Comment AI]",error);commentText=fallbackComment(postText);}
            }
            if(!commentText){noteSkip("nobutton");}
            else if(/không thể|rất tiếc|xin lỗi|từ chối|không giúp|i'm sorry|i can't|tôi không thể|chưa thể giúp/i.test(commentText)){noteSkip("airefusal");console.warn("[Group Comment AI] Bỏ qua vì AI từ chối:",commentText.slice(0,80));}
            else if(groupCommentDuplicatesExisting(post,commentText)){noteSkip("duplicate");}
            else{
              result=await groupInteractPostAIComment(post,commentText,postKey,wantedPath,activeRunId,"comment",cfg.typingConfig,tagEntity?(cfg.tagConfig||null):null,tagEntity);
              if(result===true||result==="already-commented"){
                groupDone++;totalDone++;
                await markPostSig(postText);
                if(postKey)delete retryCounts[postKey];
                if(postKey){activeRunSubmissionKeys.add(postKey);commentHistory[postKey]={time:Date.now(),source:"group-comment",contentKey:postContentKey(postText),runId:activeRunId};}
                if(post.isConnected)post.style.outline="2px solid #9c27b0";
              }else if(result==="unconfirmed-skip"){
                noteSkip("unconfirmed");
                if(postKey){activeRunSubmissionKeys.add(postKey);commentHistory[postKey]={time:Date.now(),source:"group-comment",contentKey:postContentKey(postText),unconfirmed:true,runId:activeRunId};}
              }else if(result==="navigated"){
                const attempts=postKey?(parseInt(retryCounts[postKey])||0)+1:4;
                if(postKey&&attempts<=3){
                  retryCounts[postKey]=attempts;
                  processedKeys.delete(postKey);
                  await chrome.storage.local.set({groupCommentIndex:index,groupCommentDone:totalDone,groupCommentCurrentGroupIndex:index,groupCommentCurrentGroupDone:groupDone,groupCommentHistory:commentHistory,groupCommentProcessedKeys:[...processedKeys].slice(-500),groupCommentRetryCounts:retryCounts,groupCommentSkipped:skipped,groupCommentStatus:`${t("gi2.commentNavBack")} Thử lại bài ${attempts}/3`});
                  await safeGroupNavigate(group.url,"comment",activeRunId,"quay lại nhóm để thử lại bài");
                  return;
                }
                noteSkip("navigated");
                await chrome.storage.local.set({groupCommentIndex:index,groupCommentDone:totalDone,groupCommentCurrentGroupIndex:index,groupCommentCurrentGroupDone:groupDone,groupCommentHistory:commentHistory,groupCommentProcessedKeys:[...processedKeys].slice(-500),groupCommentSkipped:skipped,groupCommentStatus:t("gi2.commentNavBack")});
                await safeGroupNavigate(group.url,"comment",activeRunId,"quay lại nhóm sau khi Facebook chuyển trang");
                return;
              }else if(result==="stopped")return;
              else if(result==="boxtimeout"||result==="typeincomplete"){
                const attempts=postKey?(parseInt(retryCounts[postKey])||0)+1:4;
                if(postKey&&attempts<=3){
                  retryCounts[postKey]=attempts;
                  processedKeys.delete(postKey);
                }else noteSkip(result==="typeincomplete"?"typeincomplete":"boxtimeout");
              }else noteSkip(result==="skip"?"nobutton":result==="draft"?"draft":"boxtimeout");
            }
          }
          await chrome.storage.local.set({groupCommentDone:totalDone,groupCommentCurrentGroupIndex:index,groupCommentCurrentGroupDone:groupDone,groupCommentHistory:commentHistory,groupCommentProcessedKeys:[...processedKeys].slice(-500),groupCommentRetryCounts:retryCounts,groupCommentSkipped:skipped,groupCommentStatus:t("gi2.commentPostDone",{name:group.name,done:groupDone,per:cfg.perGroup,suffix:skipSummary()})});
          // Sau proof Facebook đôi lúc giữ URL permalink và dialog của bài
          // vừa comment thêm một nhịp. Nếu tiếp tục quét ở route đó, mọi card
          // nền có thể mang cùng permalink và editor của bài kế tiếp không
          // còn mở đúng chỗ, dẫn tới nhiều lần "không thấy ô nhập". Quay về
          // route gốc của nhóm sau từng lượt đã xử lý; tiến trình/history đã
          // được persist ở trên nên reload/resume không đăng lặp.
          const currentPath=location.pathname.replace(/\/$/,"");
          if((result===true||result==="already-commented")&&groupDone<cfg.perGroup&&currentPath!==wantedPath){
            await safeGroupNavigate(group.url,"comment",activeRunId,"quay lại nhóm sau khi comment");
            return;
          }
          if(groupDone<cfg.perGroup&&!await groupCommentSleep(rand(cfg.minDelay*1000,cfg.maxDelay*1000),activeRunId))return;
        }
        if(groupDone<cfg.perGroup){
          // Facebook often leaves the same visible cards in place while the
          // next batch is still loading. Give the group feed several bounded
          // scroll/load rounds before concluding there are no more candidates;
          // two rounds was too short on a slow connection and could end a
          // configured 5-post run while the third card was arriving.
          // The cap still prevents an unchanged DOM from running forever.
          noProgressRounds=groupDone===groupDoneBeforeRound?noProgressRounds+1:0;
          if(noProgressRounds>=6)break;
          window.scrollBy(0,innerHeight*.9);
          if(!await groupCommentSleep(2500,activeRunId))return;
        }
      }
      if(!await groupCommentRunActive(activeRunId))return;
      index++;
      await chrome.storage.local.set({groupCommentIndex:index,groupCommentDone:totalDone,groupCommentCurrentGroupIndex:index,groupCommentCurrentGroupDone:0,groupCommentProcessedKeys:[],groupCommentRetryCounts:{},groupCommentSkipped:skipped,groupCommentHistory:commentHistory,groupCommentStatus:t("gi2.commentGroupDone",{name:group.name,done:groupDone,per:cfg.perGroup,suffix:skipSummary()})});
      if(index<cfg.groups.length){
        if(!await groupCommentSleep(rand(cfg.minDelay*1000,cfg.maxDelay*1000),activeRunId))return;
        if(!await groupCommentRunActive(activeRunId))return;
        await safeGroupNavigate(cfg.groups[index].url,"comment",activeRunId,"sang nhóm kế tiếp");
      }else if(await groupCommentRunActive(activeRunId)){
        await chrome.storage.local.set({groupCommentActive:false,groupCommentStatus:t("gi2.commentAllDone",{n:cfg.groups.length,done:totalDone,suffix:skipSummary()})});
      }
    }catch(error){
      // Trước đây không có catch: một lỗi bất ngờ (vd. tham chiếu biến sai)
      // sẽ thoát khỏi vòng lặp mà không tắt cờ groupCommentActive, làm
      // popup hiển thị "đang chạy" mãi dù không còn gì thực sự chạy.
      console.warn("[GroupComment]",error);
      await chrome.storage.local.set({groupCommentActive:false,groupCommentStatus:t("gi2.commentAllDone",{n:0,done:0,suffix:""})+` (lỗi: ${String(error?.message||error).slice(0,150)})`});
    }finally{
      isGroupCommenting=false;
      const next=await chrome.storage.local.get(["groupCommentActive","groupCommentRunId"]);
      if(next.groupCommentActive&&next.groupCommentRunId&&next.groupCommentRunId!==activeRunId)setTimeout(continueGroupComment,0);
    }
  }

  let isGroupPosting=false,groupPostStopRequested=false;
  const GROUP_POST_AUTO={
    interGroupMin:25,interGroupMax:45,
    afterPostMin:8,afterPostMax:12,
    afterBgMin:3,afterBgMax:5,
    typingMin:60,typingMax:130,
    beforePostMin:3,beforePostMax:6,
    groupReadyWait:45000,groupStableWait:1600,
    composerOpenWait:45000,composerReadyWait:45000,
    paletteWait:20000,backgroundConfirmWait:20000,submitWait:30000,
    // Nhóm đông thành viên/đang hoạt động sôi nổi có thể mất hơn 30 giây để
    // Facebook render bài mới vào feed (đã ghi nhận bài đăng thành công thật
    // nhưng bị báo "chưa xác nhận" và tự dừng oan vì hết giờ quá sớm).
    postVisibleWait:60000,contentVerifyWait:20000
  };
  async function groupPostRunActive(runId){
    if(groupPostStopRequested)return false;
    const live=await chrome.storage.local.get(["groupPostActive","groupPostRunId"]);
    return !!live.groupPostActive&&!!runId&&live.groupPostRunId===runId;
  }
  async function groupPostSleep(ms,runId=""){
    const end=Date.now()+ms;
    while(Date.now()<end){
      if(groupPostStopRequested||(runId&&!await groupPostRunActive(runId)))return false;
      await sleep(Math.min(250,end-Date.now()));
    }
    return !groupPostStopRequested&&(!runId||await groupPostRunActive(runId));
  }
  async function waitForGroupPostSchedule(nextAt,index,total,name,runId=""){
    while(Date.now()<nextAt){
      if(groupPostStopRequested||(runId&&!await groupPostRunActive(runId)))return false;
      const live=await chrome.storage.local.get(["groupPostActive","groupPostRunId"]);
      if(!live.groupPostActive||(runId&&live.groupPostRunId!==runId))return false;
      const seconds=Math.max(1,Math.ceil((nextAt-Date.now())/1000));
      await chrome.storage.local.set({groupPostStatus:t("gp2.waitPost",{s:seconds,i:index+1,t:total,name:name})});
      await sleep(Math.min(1000,Math.max(1,nextAt-Date.now())));
    }
    return !groupPostStopRequested&&(!runId||await groupPostRunActive(runId));
  }
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes.groupPostActive?.newValue===false)groupPostStopRequested=true;});
  const GROUP_POST_COLOR_NAMES={pink:"hồng",green:"xanh lá",red:"đỏ",orange:"cam",yellow:"vàng",blue:"xanh dương",purple:"tím",burgundy:"đỏ thẫm",beige:"be",brown:"nâu",gray:"xám",black:"đen"};
  function groupPostColorName(color){const key="c.color"+String(color||"").charAt(0).toUpperCase()+String(color||"").slice(1);return GROUP_POST_COLOR_NAMES[color]?t(key):t("gp2.colorPlain");}
  function normalizeGroupPostBackground(input){
    const allowed=Object.keys(GROUP_POST_COLOR_NAMES),chosen=Array.isArray(input?.colors)?input.colors.filter(c=>allowed.includes(c)):[];
    const colors=chosen.length?[...new Set(chosen)]:allowed;
    const mode=input?.mode==="fixed"?"fixed":"random",fixedColor=allowed.includes(input?.fixedColor)?input.fixedColor:"pink";
    // khi bật nền nhưng nhóm không có bảng màu: đăng chữ thay vì bỏ qua nhóm.
    const enabled=input?.enabled!==false;
    return {enabled,mode,fixedColor,colors,maxChars:Math.min(130,Math.max(40,parseInt(input?.maxChars)||100)),fallback:"plain",afterBgMin:GROUP_POST_AUTO.afterBgMin,afterBgMax:GROUP_POST_AUTO.afterBgMax,typingMin:GROUP_POST_AUTO.typingMin,typingMax:GROUP_POST_AUTO.typingMax,beforePostMin:GROUP_POST_AUTO.beforePostMin,beforePostMax:GROUP_POST_AUTO.beforePostMax};
  }
  function chooseGroupPostColor(background,lastColor){
    if(background.mode==="fixed")return background.fixedColor;
    const valid=(background.colors||[]).filter(c=>GROUP_POST_COLOR_NAMES[c]);
    const pool=valid.length>1?valid.filter(c=>c!==lastColor):valid;
    return pool.length?pool[Math.floor(Math.random()*pool.length)]:"";
  }
  // ===== NGỮ CẢNH NHÓM cho Đăng bài (học nhẹ trước, thiếu thì cào sâu) =====
  // State machine, selector, counter và proof của Đăng bài giữ nguyên; khối này
  // chỉ đọc text đang hiển thị trên feed để dựng digest cục bộ (quota-safe:
  // chỉ digest nhỏ đi qua AI). Không chạm Messenger/comment con/quảng cáo.
  const GROUP_POST_KNOWLEDGE_RE=/(chứng khoán|chung khoan|đầu tư|dau tu|tài chính|tai chinh|crypto|coin|forex|bất động sản|bat dong san|marketing|khởi nghiệp|khoi nghiep|\bhọc\b|\bhoc\b|kiến thức|kinh nghiệm|lập trình|lap trinh|thiết kế|thiet ke|công nghệ|tiếng anh|ielts|\bluật\b|sức khỏe|suc khoe|khoa học|bác sĩ|mẹ và bé|nuôi con|giáo dục|chứng chỉ|tuyển dụng|việc làm)/;
  function classifyGroupPostKind(name){
    const s=` ${String(name||"").toLocaleLowerCase("vi")} `;
    return GROUP_POST_KNOWLEDGE_RE.test(s)?{type:"knowledge",windowHours:48}:{type:"market",windowHours:24};
  }
  function parseGroupPostHoursAgo(text){
    const s=String(text||"").toLocaleLowerCase("vi").trim();
    if(!s||s.length>40)return null;
    if(/^(vừa xong|just now|mới đây)/.test(s))return 0;
    if(/hôm qua|yesterday/.test(s))return 24;
    // Lưu ý: KHÔNG dùng \b sau đơn vị tiếng Việt ("giờ"/"phút" tận cùng bằng
    // ký tự non-ASCII nên \b ASCII không bao giờ khớp) — neo bằng ^…$ lỏng.
    let m=s.match(/(\d+)\s*(phút|phut|minutes?|mins?)/);
    if(m)return Math.max(0,parseInt(m[1],10)/60);
    m=s.match(/(\d+)\s*(giờ|gio|hours?|hrs?)/);
    if(m)return parseInt(m[1],10);
    m=s.match(/(\d+)\s*(ngày|ngay|days?)/);
    if(m)return parseInt(m[1],10)*24;
    m=s.match(/(\d+)\s*(tuần|tuan|weeks?)/);
    if(m)return parseInt(m[1],10)*24*7;
    m=s.match(/(\d+)\s*(tháng|thang|months?)/);
    if(m)return parseInt(m[1],10)*24*30;
    m=s.match(/(\d+)\s*(năm|nam|years?)/);
    if(m)return parseInt(m[1],10)*24*365;
    return null;
  }
  function groupPostCardHoursAgo(node){
    try{
      const cands=[...node.querySelectorAll("abbr,span")];
      for(const c of cands){
        const h=parseGroupPostHoursAgo(c.innerText||c.textContent||"");
        if(h!==null&&h!==undefined)return h;
      }
    }catch(_){}
    return null;
  }
  function readGroupPostFeedRows(){
    const out=[],seen=new Set();
    for(const node of [...document.querySelectorAll('[role="article"],article,[data-pagelet^="FeedUnit_"]')]){
      try{
        if(!isRenderedElement(node)||node.closest('[role="dialog"]'))continue;
        const text=String(node.innerText||node.textContent||"").replace(/\s+/g," ").trim();
        if(text.length<30||/được tài trợ|sponsored|tin nhắn|messenger/i.test(text))continue;
        const key=text.slice(0,180).toLocaleLowerCase("vi");
        if(seen.has(key))continue;
        seen.add(key);
        out.push({text:text.slice(0,900),hoursAgo:groupPostCardHoursAgo(node)});
        if(out.length>=40)break;
      }catch(_){}
    }
    return out;
  }
  function buildGroupPostDigest(rows,windowHours,minLen){
    const win=windowHours===48?48:24;
    const minL=Math.min(1000,Math.max(30,parseInt(minLen)||200));
    let pool=(Array.isArray(rows)?rows:[]).filter(r=>r&&String(r.text||"").trim().length>=30);
    const fresh=pool.filter(r=>r.hoursAgo===null||r.hoursAgo===undefined||r.hoursAgo<=win);
    if(fresh.length>=3)pool=fresh;
    // Ưu tiên bài dài đủ ngưỡng để AI hiểu sâu; thiếu bài dài thì giữ bài ngắn
    // và gắn cờ shortFallback để background dặn AI viết gọn thay vì bịa.
    let shortFallback=false;
    const longs=pool.filter(r=>String(r.text||"").replace(/\s+/g," ").trim().length>=minL);
    if(longs.length>=3)pool=longs;
    else shortFallback=true;
    pool=pool.slice(0,20);
    const texts=pool.map(r=>String(r.text).replace(/\s+/g," ").trim());
    const all=texts.join("\n");
    const words=all.match(/[\p{L}\p{N}]+/gu)||[];
    const stop=new Set(String(t("bg.stopwords")||"").split(/\s+/));
    const freq=new Map();
    for(const w of words){const lw=w.toLowerCase();if(lw.length<3||stop.has(lw))continue;freq.set(lw,(freq.get(lw)||0)+1);}
    const topics=[...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([w])=>w);
    const first=x=>String(x||"").split(/[.!?…\n]+/)[0].trim().slice(0,120);
    const hooks=[...new Set(texts.map(first).filter(Boolean))].slice(0,6);
    const known=pool.map(r=>r.hoursAgo).filter(h=>typeof h==="number");
    return{
      postCount:texts.length,
      topics,
      hooks,
      questionPosts:texts.filter(x=>x.includes("?")).length,
      samples:texts.slice(0,5).map(x=>x.length>140?x.slice(0,140)+"…":x),
      oldestHours:known.length?Math.round(Math.max(...known)):null,
      shortFallback,
      minLen:minL
    };
  }
  // Chọn 2 bài dài nguyên văn làm mẫu sâu (chế độ Cá nhân hoá): ưu tiên bài có
  // câu hỏi rồi tới bài dài nhất, mỗi bài cắt 800 ký tự. Không tốn lượt gọi AI.
  function pickGroupPostExemplars(rows,windowHours,minLen){
    const win=windowHours===48?48:24;
    const minL=Math.min(1000,Math.max(30,parseInt(minLen)||200));
    let pool=(Array.isArray(rows)?rows:[]).filter(r=>r&&String(r.text||"").replace(/\s+/g," ").trim().length>=100);
    const fresh=pool.filter(r=>r.hoursAgo===null||r.hoursAgo===undefined||r.hoursAgo<=win);
    if(fresh.length>=2)pool=fresh;
    const longs=pool.filter(r=>String(r.text||"").replace(/\s+/g," ").trim().length>=minL);
    if(longs.length>=2)pool=longs;
    pool=[...pool].sort((a,b)=>((String(b.text||"").includes("?")?1:0)-(String(a.text||"").includes("?")?1:0))||String(b.text||"").length-String(a.text||"").length);
    return pool.slice(0,2).map(r=>String(r.text||"").replace(/\s+/g," ").trim().slice(0,800)).filter(Boolean);
  }
  function formatGroupPostAvoid(posted){
    return (Array.isArray(posted)?posted:[]).slice(-5).map(p=>{
      const topics=(Array.isArray(p.topics)?p.topics:[]).slice(0,5).join(", ");
      const hook=String(p.hook||"").slice(0,90);
      if(!topics&&!hook)return "";
      return `- ${topics}${hook?` — "${hook}"`:""}`;
    }).filter(Boolean);
  }
  // Ghi nhớ góc vừa đăng (chỉ khi bài được Facebook xác nhận): topics + câu mở
  // đầu, giữ 5 lượt/nhóm để lần sau ép AI đổi góc, diệt câu hỏi lặp.
  async function recordGroupPostAngle(groupKey,digest,content){
    if(!digest||!String(content||"").trim())return;
    try{
      const s=await chrome.storage.local.get("groupPostContextCache");
      const c=s.groupPostContextCache&&typeof s.groupPostContextCache==="object"?s.groupPostContextCache:{};
      const e=c[groupKey]&&typeof c[groupKey]==="object"?c[groupKey]:{at:Date.now()};
      const posted=Array.isArray(e.posted)?e.posted:[];
      posted.push({topics:(digest.topics||[]).slice(0,5),hook:String(content).split(/[.!?…\n]+/)[0].trim().slice(0,90),at:Date.now()});
      e.posted=posted.slice(-5);
      c[groupKey]=e;
      const ordered=Object.keys(c).sort((a,b)=>(Number(c[b]?.at)||0)-(Number(c[a]?.at)||0));
      ordered.slice(20).forEach(k=>{delete c[k];});
      await chrome.storage.local.set({groupPostContextCache:c});
    }catch(_){}
  }
  function groupPostCtxKey(group){
    try{
      const u=new URL(String(group?.url||""),location.origin);
      const m=u.pathname.match(/^\/groups\/([^/?#]+)/i);
      if(m)return `/groups/${String(m[1]).toLowerCase()}`;
    }catch(_){}
    return String(group?.key||group?.id||group?.name||"").trim().toLowerCase();
  }
  async function groupPostCtxRawGet(key){
    try{
      const s=await chrome.storage.local.get("groupPostContextCache");
      const c=s.groupPostContextCache&&typeof s.groupPostContextCache==="object"?s.groupPostContextCache:{};
      const e=c[key];
      return e&&typeof e==="object"?e:null;
    }catch(_){return null;}
  }
  async function groupPostCtxCacheGet(key,windowHours){
    try{
      const e=await groupPostCtxRawGet(key);
      if(!e||typeof e.at!=="number")return null;
      if(Date.now()-e.at>Math.max(1,windowHours)*3600*1000)return null;
      if(!e.digest||(e.digest.postCount||0)<5)return null;
      return e;
    }catch(_){return null;}
  }
  async function groupPostCtxCachePut(key,entry){
    try{
      const s=await chrome.storage.local.get("groupPostContextCache");
      const c=s.groupPostContextCache&&typeof s.groupPostContextCache==="object"?s.groupPostContextCache:{};
      c[key]={...entry,at:Date.now()};
      const ordered=Object.keys(c).sort((a,b)=>(Number(c[b]?.at)||0)-(Number(c[a]?.at)||0));
      ordered.slice(20).forEach(k=>{delete c[k];});
      await chrome.storage.local.set({groupPostContextCache:c});
    }catch(_){}
  }
  // Vòng treo đêm 20 nhóm: lời gọi AI có thể không bao giờ trả về (SW kẹt/
  // mất response mà promise không reject) khiến cả run treo active=true mãi,
  // chặn mọi tính năng khác. Chốt 150 giây: quá hạn coi như AI lỗi 1 nhóm.
  function sendGroupPostAi(message,timeoutMs=150000){
    return Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,code:"AI_TIMEOUT",error:t("gp2.aiTimeout")}),timeoutMs))
    ]);
  }
  async function collectGroupPostContext(group,runId,mode,minLen){
    const base=(group&&group.groupType==="knowledge")||(group&&group.groupType==="market")
      ?{type:group.groupType,windowHours:group.windowHours===48?48:24}
      :classifyGroupPostKind(group?.name);
    const windowHours=base.windowHours===48?48:24;
    const deepMode=mode==="deep";
    const key=groupPostCtxKey(group);
    const cached=await groupPostCtxCacheGet(key,windowHours);
    // Lịch sử góc đã đăng đọc riêng (kể cả khi digest hết hạn) để luôn chống lặp.
    const avoid=formatGroupPostAvoid((await groupPostCtxRawGet(key))?.posted);
    if(cached){
      const topics=(cached.digest.topics||[]).slice(0,3).join(", ");
      await chrome.storage.local.set({groupPostStatus:t("gp2.learnCache",{n:cached.digest.postCount,h:Math.max(1,Math.round((Date.now()-cached.at)/3600000)),topics:topics||"…"})});
      const rows=readGroupPostFeedRows();
      return{type:cached.groupType||base.type,windowHours,digest:cached.digest,cached:true,exemplars:deepMode?pickGroupPostExemplars(rows,windowHours,minLen):null,avoid};
    }
    let rows=readGroupPostFeedRows();
    let digest=buildGroupPostDigest(rows,windowHours,minLen);
    if(digest.postCount<5){
      // Fallback cào sâu: cuộn tối đa ~90s, mỗi vòng đều kiểm tra stop/run id.
      const deadline=Date.now()+90000;
      let noProgress=0,before=rows.length,rounds=0;
      while(Date.now()<deadline&&rows.length<20&&noProgress<6&&rounds<36){
        if(!await groupPostRunActive(runId))return null;
        await chrome.storage.local.set({groupPostStatus:t("gp2.learning",{name:group?.name||"",n:Math.min(20,rows.length)})});
        try{window.scrollBy(0,innerHeight*.9);}catch(_){}
        if(!await groupPostSleep(2500,runId))return null;
        rows=readGroupPostFeedRows();
        rounds++;
        noProgress=rows.length>before?0:noProgress+1;
        before=rows.length;
      }
      if(!await groupPostRunActive(runId))return null;
      digest=buildGroupPostDigest(rows,windowHours,minLen);
    }
    if(digest.postCount<3){
      await chrome.storage.local.set({groupPostStatus:t("gp2.learnFallback")});
      return{type:base.type,windowHours,digest:null,cached:false,exemplars:null,avoid};
    }
    await groupPostCtxCachePut(key,{digest,postCount:digest.postCount,windowHours,groupType:base.type});
    await chrome.storage.local.set({groupPostStatus:t("gp2.learned",{n:digest.postCount,topics:digest.topics.slice(0,3).join(", ")||"…"})});
    return{type:base.type,windowHours,digest,cached:false,exemplars:deepMode?pickGroupPostExemplars(rows,windowHours,minLen):null,avoid};
  }
  function findVisibleButton(root,patterns){
    return [...(root||document).querySelectorAll('[role="button"],button')].find(el=>{
      if(!isRenderedElement(el))return false;
      const label=buttonLabel(el);
      return patterns.some(pattern=>pattern.test(label));
    })||null;
  }
  function isViewportInteractive(el){
    if(!isRenderedElement(el))return false;
    const r=el.getBoundingClientRect();
    if(r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
    const x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2));
    const hit=document.elementFromPoint(x,y);
    return !!hit&&(el.contains(hit)||hit.contains(el));
  }
  function isInsideViewport(el){
    if(!isRenderedElement(el))return false;
    const r=el.getBoundingClientRect();
    return r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
  }
  // Chờ có thay đổi DOM hoặc hết giờ: tab nền bị Chrome dồn timer 60s/lần
  // thì sleep-poll bỏ lỡ sự kiện (dialog mở rồi mà không thấy). MutationObserver
  // vẫn bắn khi DOM đổi nên kiểm tra ngay sau mỗi mutation + backstop timer.
  function waitGroupPostDomChange(timeoutMs){
    return new Promise((resolve)=>{
      let done=false,obs=null;
      const timer=setTimeout(()=>{if(!done){done=true;try{obs&&obs.disconnect();}catch(_){}resolve(false);}},Math.max(50,timeoutMs));
      try{
        obs=new MutationObserver(()=>{if(!done){done=true;clearTimeout(timer);try{obs.disconnect();}catch(_){}resolve(true);}});
        obs.observe(document.documentElement||document.body,{childList:true,subtree:true,characterData:true});
      }catch(_){/* fallback: timer decides */}
    });
  }
  async function waitGroupPostCondition(predicate,timeoutMs=3000){
    const end=Date.now()+timeoutMs;
    while(Date.now()<end){
      if(groupPostStopRequested)return false;
      try{if(await predicate())return true;}catch(_){ }
      await waitGroupPostDomChange(Math.min(1000,Math.max(50,end-Date.now())));
    }
    return false;
  }
  async function clickGroupPostControl(el,predicate,timeoutMs=3000,fallbackDelayMs=900){
    if(!el?.isConnected)return false;
    el.scrollIntoView({block:"center",inline:"center"});await sleep(220);
    try{el.click();}catch(_){ }
    const firstWait=Math.min(timeoutMs,Math.max(300,fallbackDelayMs));
    if(await waitGroupPostCondition(predicate,firstWait))return true;
    if(!el.isConnected)return false;
    try{await trustedMouse(el,"click");}catch(_){return false;}
    return waitGroupPostCondition(predicate,Math.max(300,timeoutMs-firstWait));
  }
  async function pacedGroupPostWait(minSeconds,maxSeconds,label,runId=""){
    const total=rand(Math.max(1,minSeconds)*1000,Math.max(minSeconds,maxSeconds)*1000),end=Date.now()+total;
    while(Date.now()<end){
      if(groupPostStopRequested||(runId&&!await groupPostRunActive(runId)))return false;
      const left=Math.max(1,Math.ceil((end-Date.now())/1000));
      await chrome.storage.local.set({groupPostStatus:t("gp2.waitLeft",{label:label,left:left})});
      await sleep(Math.min(500,Math.max(1,end-Date.now())));
    }
    return !groupPostStopRequested&&(!runId||await groupPostRunActive(runId));
  }
  function isDecorativeGroupPostBackground(label){
    const text=String(label||"").toLowerCase();
    // Block gradients always — they mention a solid-color word just as part of
    // the transition description (e.g. "vàng, cam sang hồng").
    if(/gradient|chuyển\s*sắc|nền\s*chuyển\s*màu|illustration/.test(text))return true;
    // Block complex multi-color illustrations (sóng, lấp lánh, mờ ảo, "và màuX")
    if(/hình\s*minh\s*họa/.test(text)){
      if(/sóng\s+màu|lấp\s*lánh|mờ\s*ảo|trừu\s*tượng|và\s+(?:tím|hồng|đỏ|cam|vàng|xanh|xám|đen|trắng)/.test(text))return true;
      return false; // simple single-color illustration — allow
    }
    return false;
  }
  function backgroundLabelScore(color,label){
    const text=String(label||"").toLowerCase();
    if(!/phông nền|background/.test(text))return -1;
    if(isDecorativeGroupPostBackground(text))return -1;
    let matched=false,score=0;
    if(color==="pink")    matched=/màu hồng|hồng\b|pink/.test(text)&&!/đỏ/.test(text);
    if(color==="green")   matched=/xanh lá cây|màu xanh lá|green/.test(text);
    if(color==="red")     matched=/(?:màu )?đỏ(?:[,\s]|$)|red/.test(text)&&!/hồng|sẫm|thẫm|điều|burgundy/.test(text);
    if(color==="orange")  matched=/màu cam|\bcam\b|orange/.test(text);
    if(color==="yellow")  matched=/màu vàng(?:[,\s]|$)|\bvàng\b|yellow/.test(text);
    if(color==="blue")    matched=/xanh da trời|xanh dương|xanh bạc|blue/.test(text);
    if(color==="purple")  matched=/màu tím(?:[,\s]|$)|tím đậm|tím sẫm|tím thẫm|\btím\b|purple/.test(text)&&!/hồng/.test(text);
    if(color==="burgundy")matched=/đỏ sẫm|đỏ thẫm|đỏ điều|burgundy/.test(text);
    if(color==="beige")   matched=/màu be(?:[,\s]|$)|beige/.test(text);
    if(color==="brown")   matched=/màu nâu|\bnâu\b|brown/.test(text);
    if(color==="gray")    matched=/màu xám|\bxám\b|gray|grey/.test(text);
    if(color==="black")   matched=/\bđen\b|màu đen|minh họa đen|black/.test(text);
    if(!matched)return -1;
    score+=100;
    if(/một màu trơn|solid/.test(text))score+=30;
    if(/hình\s*minh\s*họa/.test(text))score-=20; // illustration: lower priority than solid
    if(/chuyển sắc|gradient|minh họa.*(?:hoa|trái tim|sóng|đồi|cát)/.test(text))score-=35;
    if(/nhạt|light/.test(text))score-=8;
    if(/sẫm|thẫm|dark/.test(text))score-=4;
    if(new RegExp(`màu ${GROUP_POST_COLOR_NAMES[color]},`).test(text))score+=15;
    return score;
  }
  function findBackgroundChooser(){
    const isColorButton=el=>{
      // Palette items can be below the visible fold while Facebook is
      // animating the composer. They are still valid controls; the click
      // helper scrolls the chosen item into view before activating it.
      if(!isRenderedElement(el))return false;
      const label=buttonLabel(el).toLowerCase();
      return /phông nền|background/.test(label)&&!/^không có phông nền$|^no background$/.test(label)&&!/^(?:ẩn|hiển thị) các lựa chọn phông nền$/.test(label)&&!/^(?:tùy chọn phông nền|background options)$/.test(label);
    };
    const colors=[...document.querySelectorAll('[role="button"],button')].filter(isColorButton);
    if(!colors.length)return null;
    // Facebook thường không render tiêu đề "Chọn phông nền"; bảng màu chỉ
    // còn các nút aria-label "..., phông nền, phông nền N". Tìm tổ tiên nhỏ
    // nhất chứa cả cụm nút màu thay vì phụ thuộc vào một tiêu đề dễ đổi.
    let best=null;
    for(const button of colors){
      let node=button.parentElement;
      for(let depth=0;node&&depth<8;depth++,node=node.parentElement){
        const count=[...node.querySelectorAll('[role="button"],button')].filter(isColorButton).length;
        if(count>=Math.min(3,colors.length)&&count<=150){
          const size=node.querySelectorAll('*').length;
          if(!best||size<best.size)best={node,size};
        }
      }
    }
    return best?.node||colors[0].parentElement||null;
  }
  function findSolidBackgroundRoot(chooser){
    if(!chooser)return null;
    const heading=[...chooser.querySelectorAll('[role="heading"],h1,h2,h3')].find(h=>/^(một màu trơn|solid colors?)$/.test(buttonLabel(h)));
    if(!heading)return chooser;
    let node=heading.parentElement;
    for(let depth=0;node&&node!==chooser&&depth<7;depth++,node=node.parentElement){
      const count=[...node.querySelectorAll('[role="button"],button')].filter(b=>/phông nền|background/.test(buttonLabel(b))).length;
      if(count>=4&&count<=40)return node;
    }
    return chooser;
  }
  async function closeBackgroundChooserOnly(){
    // Tìm "Quay lại" trong toàn dialog — nút này chỉ xuất hiện khi view full-screen
    // "Chọn phông nền" đang mở. findBackgroundChooser() trả về palette ban đầu (nhỏ hơn)
    // không có nút này nên phải tìm ở scope rộng hơn.
    const dialog=findGroupPostDialog();
    const back=dialog&&findVisibleButton(dialog,[/^(quay lại|back)$/]);
    if(!back)return;
    await clickGroupPostControl(back,()=>!findVisibleButton(findGroupPostDialog()||document,[/^(quay lại|back)$/]),2000);
  }
  async function closeBackgroundPickerToPlain(dialog){
    await closeBackgroundChooserOnly();
    const noBackground=findVisibleButton(dialog,[/^(không có phông nền|no background)$/]);
    if(noBackground)await clickGroupPostControl(noBackground,()=>{
      const live=findGroupPostDialog(),box=live&&findGroupPostEditor(live);return !box||!editorStillHasBackground(box,live);
    },2000);
  }
  function groupPostBackgroundApplied(color,dialog){
    const live=findGroupPostDialog()||dialog,box=live&&findGroupPostEditor(live);
    const selectedPreview=[...(live||document).querySelectorAll('[role="button"],button')].some(b=>{
      const label=buttonLabel(b);
      const selected=b.getAttribute("aria-current")==="true"||b.getAttribute("aria-pressed")==="true"||b.getAttribute("data-selected")==="true";
      const matches=color==="auto"?/phông nền\s+\d+\s*$|background\s+\d+\s*$/.test(label):backgroundLabelScore(color,label)>=0;
      // A visible palette item is not proof that it was selected.  Facebook
      // can leave every color rendered while the editor still has the old
      // background, which made random mode appear stuck on one color.
      return isRenderedElement(b)&&matches&&selected;
    });
    return selectedPreview||!!(box&&editorStillHasBackground(box,live));
  }
  async function applyGroupPostBackground(dialog,preferredColor,allowedColors,lastColor="",strictColor=false){
    // Debug: dump tất cả button trong dialog để xem label thực tế
    const _dbgLabels=[...(dialog||document).querySelectorAll('[role="button"],button')].filter(b=>isRenderedElement(b)).map(b=>buttonLabel(b)).filter(Boolean);
    chrome.storage.local.set({groupPostDebugAllBtns:{labels:_dbgLabels.slice(0,40),ts:Date.now()}});
    console.log('[GroupPost] dialog buttons at open:',_dbgLabels.slice(0,12).join(' | '));
    const expanded=findVisibleButton(dialog,[/^(ẩn các lựa chọn phông nền|hide background options)$/]);
    const toggle=findVisibleButton(dialog,[/^(hiển thị các tùy chọn phông nền|show background options)$/]);
    console.log('[GroupPost] expanded:',expanded?'YES':'NO','toggle:',toggle?'YES':'NO');
    if(!expanded&&!toggle)return {applied:false,reason:t("gp2.errNoPaletteBtn")};
    await chrome.storage.local.set({groupPostStatus:t("gp2.paletteOpening")});
    console.log("[GroupPost] background palette requested");
    if(!expanded&&!await clickGroupPostControl(toggle,()=>!!findVisibleButton(dialog,[/^(ẩn các lựa chọn phông nền|hide background options)$/]),GROUP_POST_AUTO.paletteWait,1500))return {applied:false,reason:t("gp2.errPaletteClosed")};
    await waitGroupPostCondition(()=>!!findBackgroundChooser(),GROUP_POST_AUTO.paletteWait);
    // Debug: lưu tất cả button labels trong dialog trước khi expand
    const allBtnsBeforeExpand=[...(dialog||document).querySelectorAll('[role="button"],button')].filter(b=>isRenderedElement(b)).map(b=>buttonLabel(b)).filter(Boolean);
    chrome.storage.local.set({groupPostDebugAllBtns:{labels:allBtnsBeforeExpand.slice(0,30),ts:Date.now()}});
    console.log('[GroupPost] all dialog buttons before expand:', allBtnsBeforeExpand.slice(0,10).join(' | '));
    // Nếu nút "Tùy chọn phông nền" vẫn còn hiển thị thì chưa mở full palette.
    // Dùng single click + sleep thay vì clickGroupPostControl vì nút này KHÔNG
    // biến mất sau khi expand — nếu dùng clickGroupPostControl nó sẽ click lần 2
    // (do condition timeout) và đóng lại palette vừa mở.
    const more=findVisibleButton(dialog,[/^(tùy chọn phông nền|background options)$/]);
    console.log('[GroupPost] more button found:', more?'YES — "'+buttonLabel(more)+'"':'NO');
    if(more){
      more.scrollIntoView({block:"center",inline:"center"});
      await sleep(250);
      try{more.click();}catch(_){}
      await sleep(1800); // đợi full palette render
      console.log('[GroupPost] expanded full palette');
    }
    // Sau khi "Tùy chọn phông nền" mở, Facebook hiển thị view riêng "Chọn phông nền"
    // (full-screen). Các nút palette ban đầu (Đỏ đậm, Tím thẫm...) vẫn trong DOM
    // nhưng bị che — click vào chúng không có tác dụng. Cần dùng chỉ nút trong view mới.
    let fullscreenChooser=null;
    if(more){
      const backBtn=findVisibleButton(dialog,[/^(quay lại|back)$/]);
      if(backBtn){
        let node=backBtn.parentElement;
        for(let d=0;node&&node!==dialog&&d<10;d++,node=node.parentElement){
          const colorBtns=[...node.querySelectorAll('[role="button"],button')].filter(b=>isRenderedElement(b)&&/phông nền|background/i.test(buttonLabel(b)));
          if(colorBtns.length>=5){fullscreenChooser=node;break;}
        }
        if(fullscreenChooser){
          // Scroll xuống để load hết màu (section "Một màu trơn" ở dưới cùng)
          fullscreenChooser.scrollTop=fullscreenChooser.scrollHeight;
          let sp=fullscreenChooser.parentElement;
          for(let d=0;sp&&sp!==dialog&&d<6;d++,sp=sp.parentElement){
            if(sp.scrollHeight>sp.clientHeight+5){sp.scrollTop=sp.scrollHeight;break;}
          }
          await sleep(900);
          console.log('[GroupPost] full-screen chooser found, scrolled to load all colors');
        }
      }
    }
    const scopeEl=fullscreenChooser||dialog;
    const chooser=fullscreenChooser||findBackgroundChooser(),root=findSolidBackgroundRoot(chooser)||dialog;
    const paletteButtons=[...scopeEl.querySelectorAll('[role="button"],button')].filter(b=>isRenderedElement(b)&&/phông nền|background/i.test(buttonLabel(b)));
    const paletteLabels=paletteButtons.map(b=>buttonLabel(b));
    console.log(`[GroupPost] palette candidates ${paletteButtons.length}:`,paletteLabels.slice(0,6).join(" | "));
    chrome.storage.local.set({groupPostDebugPalette:{labels:paletteLabels,ts:Date.now()}});
    const ordered=[...(allowedColors||[])].filter((c,i,a)=>GROUP_POST_COLOR_NAMES[c]&&a.indexOf(c)===i);
    const availableByColor=new Map();
    for(const color of ordered){
      const candidates=[...scopeEl.querySelectorAll('[role="button"],button')].map(button=>({button,score:backgroundLabelScore(color,buttonLabel(button))})).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score);
      if(candidates.length){
        // Randomise within the top-score tier so the same background isn't
        // always chosen when multiple variants share an equal score.
        const topScore=candidates[0].score;
        const topTier=candidates.filter(c=>c.score===topScore);
        availableByColor.set(color,topTier[Math.floor(Math.random()*topTier.length)]);
      }
    }
    const available=[...availableByColor.entries()].map(([color,item])=>({color,...item}));
    console.log(`[GroupPost] solid backgrounds available ${available.map(item=>item.color).join(",")||"none"}`);
    let selected=null,selectedColor="",selectedScore=-1;
    // Keep the configured random choice when that solid color exists. If the
    // current group exposes a smaller palette, choose randomly from the
    // available solid colors instead of falling through the configured color
    // list in a fixed order (which previously caused repeated red posts).
    const preferred=preferredColor&&availableByColor.get(preferredColor);
    if(preferred){selected=preferred.button;selectedColor=preferredColor;selectedScore=preferred.score;}
    else if(available.length){
      const nonRepeat=lastColor?available.filter(item=>item.color!==lastColor):available;
      const pool=nonRepeat.length?nonRepeat:available;
      const picked=pool[Math.floor(Math.random()*pool.length)];
      selected=picked.button;selectedColor=picked.color;selectedScore=picked.score;
    }
    // strictColor không còn skip nữa — nếu màu cố định không có, fallback xuống
    // bất kỳ màu nào sẵn có trong palette (đăng được còn hơn bỏ nhóm).
    if(!selected){
      // Nếu nhóm có bảng nền nhưng không có đúng màu đã tích, vẫn chọn một
      // nền khả dụng để không bỏ qua nhầm nhóm có thể đăng kèm nền.
      const fallback=paletteButtons.map(button=>{
        if(!isRenderedElement(button))return null;
        const label=buttonLabel(button);
        if(!/phông nền|background/.test(label)||isDecorativeGroupPostBackground(label)||/^không có phông nền$|^no background$/.test(label)||/^(?:ẩn|hiển thị) các lựa chọn phông nền$/.test(label)||/^(?:tùy chọn phông nền|background options)$/.test(label))return null;
        const detectedColor=Object.keys(GROUP_POST_COLOR_NAMES).find(color=>backgroundLabelScore(color,label)>=0)||"auto";
        return {button,color:detectedColor,score:detectedColor==="auto"?1:backgroundLabelScore(detectedColor,label)};
      }).filter(Boolean);
      // If the selected colors are not offered by this group, choose a
      // random *solid* fallback. Never use the first palette item: Facebook
      // often puts a decorative gradient first, which looked like a fixed
      // color across the whole run.
      if(fallback.length){
        const nonRepeat=lastColor?fallback.filter(item=>item.color!==lastColor):fallback;
        const pool=nonRepeat.length?nonRepeat:fallback;
        const picked=pool[Math.floor(Math.random()*pool.length)];
        selected=picked.button;selectedColor=picked.color;selectedScore=picked.score;
      }
    }
    if(!selected){await closeBackgroundPickerToPlain(dialog);return {applied:false,reason:t("gp2.errNoColor")};}
    await chrome.storage.local.set({groupPostStatus:t("gp2.picking",{color:groupPostColorName(selectedColor)})});
    console.log(`[GroupPost] selecting background ${selectedColor}`);
    if(!await clickGroupPostControl(selected,()=>groupPostBackgroundApplied(selectedColor,dialog),GROUP_POST_AUTO.backgroundConfirmWait,1800)){
      await closeBackgroundPickerToPlain(dialog);return {applied:false,reason:t("gp2.errNoConfirm",{color:groupPostColorName(selectedColor)})};
    }
    await closeBackgroundChooserOnly();
    await chrome.storage.local.set({groupPostStatus:t("gp2.pickedReady",{color:groupPostColorName(selectedColor)})});
    console.log(`[GroupPost] background confirmed ${selectedColor}`);
    return {applied:true,color:selectedColor,label:buttonLabel(selected),score:selectedScore};
  }
  function findGroupPostEditor(dialog){
    return [...dialog.querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"]')].find(b=>isRenderedElement(b)&&!/bình luận|comment/.test((b.getAttribute("aria-label")||"").toLowerCase()))||null;
  }
  function editorStillHasBackground(box,dialog){
    let node=box;
    for(let depth=0;node&&node!==dialog&&depth<8;depth++,node=node.parentElement){
      const style=getComputedStyle(node),image=style.backgroundImage,color=style.backgroundColor;
      if(image&&image!=="none")return true;
      if(color&&!/^(?:rgba?\(0, 0, 0, 0\)|transparent|rgb\(255, 255, 255\)|rgb\(240, 242, 245\))$/.test(color))return true;
    }
    return false;
  }
  function findGroupPostDialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(isRenderedElement);
    return dialogs.find(d=>{
      if(!findGroupPostEditor(d))return false;
      const text=(d.innerText||d.getAttribute("aria-label")||"").toLowerCase();
      if(/tạo bài viết|create post/.test(text))return true;
      const hasPostButton=!!findVisibleButton(d,[/^(đăng|post)$/]);
      const hasPostTools=!!findVisibleButton(d,[/phông nền|background/,/thêm vào bài viết|add to your post/]);
      return hasPostButton&&hasPostTools;
    })||null;
  }
  async function waitForGroupPostComposer(timeoutMs=10000,stableMs=700){
    const end=Date.now()+timeoutMs;
    let stableDialog=null,stableBox=null,stableSince=0;
    while(Date.now()<end){
      if(groupPostStopRequested)return null;
      if(findGroupWelcomeDialog()){
        await dismissGroupWelcomeDialog();
        await sleep(250);
        continue;
      }
      if(findGroupPostBlockingDialog()){
        const dismissed=await dismissGroupPostBlockingDialog();
        // Nếu không có nút nào để dismiss → composer sẽ không bao giờ mở được,
        // không cần chờ thêm đến hết timeout 45s.
        if(!dismissed)return null;
        await sleep(400);
        continue;
      }
      const dialog=findGroupPostDialog(),box=dialog&&findGroupPostEditor(dialog);
      if(dialog&&box){
        if(dialog===stableDialog&&box===stableBox){if(Date.now()-stableSince>=stableMs)return {dialog,box};}
        else{stableDialog=dialog;stableBox=box;stableSince=Date.now();}
      }else{stableDialog=null;stableBox=null;stableSince=0;}
      await sleep(250);
    }
    return null;
  }
  // Matcher thuần cho placeholder ô THẢO LUẬN (không dính dáng "bán").
  // Giữ nguyên tập chuỗi của bản cũ trừ nhánh "bán" đã tách riêng.
  function groupPostDiscussionLabelMatches(label){
    const value=normalizedGroupPostText(label).replace(/[.…]+$/g,"").trim();
    return /^(?:bạn\s+(?:đang\s+)?viết\s+gì(?:\s+đi)?(?:\s+thế)?\s*\??|bạn\s+đang\s+nghĩ\s+gì(?:\s+thế)?\s*\??|viết\s+gì\s+đó\s*\.?|tạo\s+bài\s+viết|write\s+something|create\s+post)$/i.test(value);
  }
  // Matcher thuần cho placeholder ô BÁN HÀNG (nhóm chợ chỉ cho đăng bán).
  // Chỉ khớp chữ mở ô bán, không khớp nội dung bài viết (cấm dịch/sửa chuỗi
  // Facebook — chỉ mở rộng khi soi DOM thật).
  function groupPostSellLabelMatches(label){
    const value=normalizedGroupPostText(label).replace(/[.…]+$/g,"").trim();
    return /^(?:bạn\s+(?:muốn\s+)?bán\s+gì(?:\s+nào|\s+đi)?\s*\??|đăng\s+bán(?:\s+hàng)?|tạo\s+(?:tin\s+)?bán\s+hàng|tạo\s+bài\s+niêm\s+yết|bán\s+hàng|sell\s+something|what\s+are\s+you\s+selling\??|create\s+(?:a\s+)?listing|sell\s+an\s+item)$/i.test(value);
  }
  function findGroupPostOpenerByLabel(labelMatches){
    // Facebook bọc nút mở composer trong nhiều div/span có cùng innerText
    // placeholder ("Bạn viết gì đi..."). Phải trả về đúng control bấm được:
    // el.click() trên div bọc ngoài là no-op (event không bao giờ tới nút con
    // bên dưới) khiến cả 2 lượt thử đều rớt "Không bấm được nút Tạo bài viết"
    // dù nút vẫn hiển thị (đã bắt live qua CDP).
    const resolveClickable=el=>{
      if(el.matches('[role="button"],button,[tabindex]'))return el;
      const inner=el.querySelector('[role="button"],button,[tabindex]');
      if(inner&&labelMatches(buttonLabel(inner)))return inner;
      return el.closest('[role="button"],button,[tabindex]')||el;
    };
    const roots=[document.querySelector('[role="main"]'),document.body].filter(Boolean);
    const candidates=[];
    for(const root of roots){
      for(const el of root.querySelectorAll('[role="button"],button,[tabindex],div,span')){
        if(!isRenderedElement(el)||el.closest('[role="dialog"]'))continue;
        const label=buttonLabel(el);
        if(!labelMatches(label)||label.length>80)continue;
        const r=el.getBoundingClientRect();
        if(r.width<20||r.height<10)continue;
        const clickable=resolveClickable(el);
        if(!candidates.some(c=>c===clickable))candidates.push(clickable);
      }
      if(candidates.length)break;
    }
    // Ưu tiên control bấm được thật trước rồi mới tới vị trí trên cùng: div
    // bọc ngoài luôn nằm trên nút thật nên sort-top thuần sẽ luôn chọn nhầm.
    return candidates.sort((a,b)=>{
      const ac=a.matches('[role="button"],button,[tabindex]')?0:1;
      const bc=b.matches('[role="button"],button,[tabindex]')?0:1;
      if(ac!==bc)return ac-bc;
      return a.getBoundingClientRect().top-b.getBoundingClientRect().top;
    })[0]||null;
  }
  function findGroupPostOpener(){
    const direct=findGroupPostOpenerByLabel(groupPostDiscussionLabelMatches);
    if(direct)return direct;
    // Facebook đôi lúc render thẻ composer trong một subtree không nằm dưới
    // role=main và aria-label chỉ có ở span con. Fallback này bám đúng thẻ
    // có placeholder + các nút công cụ của composer, không dựa vào class CSS
    // biến động của Facebook.
    const cards=[...document.querySelectorAll('div,section')].filter(el=>{
      if(!isRenderedElement(el)||el.closest('[role="dialog"]'))return false;
      const text=normalizedGroupPostText(el.innerText||el.textContent||'');
      if(!/^Bạn viết gì đi\.\.\.(?:\s|$)/i.test(text)&&!/^Bạn đang nghĩ gì/i.test(text))return false;
      return [...el.querySelectorAll('[role="button"],button,[tabindex]')].some(x=>{
        const value=normalizedGroupPostText(x.getAttribute('aria-label')||x.innerText||x.textContent||'');
        return groupPostDiscussionLabelMatches(value);
      });
    }).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height);
    if(cards[0]){
      const opener=[...cards[0].querySelectorAll('[role="button"],button,[tabindex]')].find(x=>{
        if(!isRenderedElement(x))return false;
        const value=normalizedGroupPostText(x.getAttribute('aria-label')||x.innerText||x.textContent||'');
        return groupPostDiscussionLabelMatches(value);
      });
      if(opener)return opener;
    }
    return null;
  }
  function findGroupSellOpener(){
    return findGroupPostOpenerByLabel(groupPostSellLabelMatches);
  }
  async function detectGroupPostComposerKind(runId=""){
    // Trả về "discussion" ngay khi thấy ô thảo luận; "sell" chỉ khi hết chờ mà
    // có ô bán nhưng không có ô thảo luận; "unknown" thì giữ hành vi cũ (để
    // createGroupPost báo noOpener thay vì bỏ qua oan nhóm render chậm).
    const end=Date.now()+6000;
    let seenSell=false;
    while(Date.now()<end){
      if(groupPostStopRequested||(runId&&!await groupPostRunActive(runId)))return "unknown";
      try{
        if(findGroupPostOpener())return "discussion";
        if(findGroupSellOpener())seenSell=true;
      }catch(_){ }
      await sleep(500);
    }
    return seenSell?"sell":"unknown";
  }
  function normalizedGroupPostText(value){
    return String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim();
  }
  // Verify ngắt dòng thật trong HTML của khung soạn: mọi hàm chuẩn hoá đều
  // gộp \s+ thành space nên so text không bao giờ phát hiện mất xuống dòng.
  // Đếm <br> và biên đoạn (</p><p>, </div><div>) rồi đối chiếu số \n gốc.
  function groupPostBreaksOk(box,expectedBreaks){
    if(!expectedBreaks)return true;
    try{
      const html=String(box?.innerHTML||"");
      const breaks=(html.match(/<br[\s>]/gi)||[]).length
        + (html.match(/<\/(p|div|li)>\s*<(p|div|li)/gi)||[]).length;
      return breaks>=expectedBreaks;
    }catch(_){return false;}
  }
  async function clearGroupPostDraft(box,runId=""){
    if(!box?.isConnected)return false;
    const read=()=>normalizedGroupPostText(box.innerText||box.textContent||box.value||"");
    if(!read())return true;
    try{box.focus();box.click();}catch(_){ }
    if(document.activeElement!==box&&!box.contains(document.activeElement)){
      try{await trustedMouse(box,"click");}catch(_){ }
    }
    if(document.activeElement!==box&&!box.contains(document.activeElement))return false;
    const selectModifier=/Mac|iPhone|iPad/i.test(navigator.platform||"")?4:2;
    // Meta+A phải gửi key hoa thật trên Chrome for Testing/macOS; một số bản
    // Lexical bỏ qua biến thể key thường dù vẫn nhận Backspace. Gửi lại cùng
    // tổ hợp theo chuẩn CDP sau lần đầu để chọn toàn bộ draft chắc chắn hơn.
    try{await chrome.runtime.sendMessage({action:"trustedKey",key:"a",code:"KeyA",windowsVirtualKeyCode:65,modifiers:selectModifier,abortStorageKey:"groupPostActive",abortRunId:runId});}catch(_){ }
    try{await chrome.runtime.sendMessage({action:"trustedKey",key:"A",code:"KeyA",windowsVirtualKeyCode:65,modifiers:selectModifier,abortStorageKey:"groupPostActive",abortRunId:runId});}catch(_){ }
    try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8,abortStorageKey:"groupPostActive",abortRunId:runId});}catch(_){ }
    await sleep(250);
    let liveDialog=findGroupPostDialog(),liveBox=liveDialog&&findGroupPostEditor(liveDialog)||box;
    let remaining=normalizedGroupPostText(liveBox?.innerText||liveBox?.textContent||liveBox?.value||"");
    if(remaining){
      try{
        const selection=window.getSelection(),range=document.createRange();
        range.selectNodeContents(liveBox);selection.removeAllRanges();selection.addRange(range);
        document.execCommand("delete",false,null);
        liveBox.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));
      }catch(_){ }
      await sleep(250);
      liveDialog=findGroupPostDialog();liveBox=liveDialog&&findGroupPostEditor(liveDialog)||liveBox;
      remaining=normalizedGroupPostText(liveBox?.innerText||liveBox?.textContent||liveBox?.value||"");
    }
    return !remaining;
  }
  async function typeGroupPostContent(box,content,typingConfig,runId=""){
    const typing=typingConfig
      ? normalizeAiTypingConfig(typingConfig)
      : normalizeAiTypingConfig({mode:"custom",minDelayMs:60,maxDelayMs:130,chunkSize:1,humanLike:false,punctuationPauseMinMs:0,punctuationPauseMaxMs:0,spacePauseMinMs:0,spacePauseMaxMs:0});
    const expected=normalizedGroupPostText(content);
    const expectedBreaks=(String(content||"").match(/\n/g)||[]).length;
    try{box.focus();box.click();}catch(_){ }
    if(document.activeElement!==box&&!box.contains(document.activeElement)){
      try{await trustedMouse(box,"click");}catch(_){ }
    }
    if(document.activeElement!==box&&!box.contains(document.activeElement))return {ok:false,error:t("gp2.noCursor")};
    // Facebook can restore a draft from an earlier failed/aborted attempt.
    // Clear it before typing so retries never concatenate two posts.
    let draftBox=box;
    const liveDraftDialog=findGroupPostDialog(),liveDraftBox=liveDraftDialog&&findGroupPostEditor(liveDraftDialog);
    if(liveDraftBox?.isConnected)draftBox=liveDraftBox;
    let cleared=await clearGroupPostDraft(draftBox,runId);
    if(!cleared){
      // Facebook đôi khi thay contenteditable sau lần Ctrl+A/Backspace đầu.
      // Chỉ thử cưỡng bức dọn lại khi draft hiện tại khớp đúng nội dung AI của
      // phiên này (hoặc đúng content sắp gõ); draft khác vẫn được bảo toàn.
      const current=normalizedGroupPostText(draftBox.innerText||draftBox.textContent||draftBox.value||"");
      let owned=current===expected;
      if(!owned){
        try{
          const ps=await chrome.storage.local.get(["groupPostPendingContent","groupPostRunId"]);
          const pending=normalizedGroupPostText(ps.groupPostPendingContent||"");
          // A failed trustedInput may leave only a prefix of the exact AI
          // draft. It is still owned by this run when the prefix is long and
          // matches the pending text from the same run; unrelated drafts are
          // never auto-cleared.
          let common=0;
          while(common<Math.min(pending.length,current.length)&&pending[common]===current[common])common++;
          // Facebook có thể thay/nuốt 1–2 ký tự khi Lexical re-render. Một
          // draft có chung >=85% prefix của bài đang chờ vẫn là draft của run
          // hiện tại; draft khác hoàn toàn vẫn được bảo toàn.
          owned=String(ps.groupPostRunId||"")===String(runId||"")&&pending.length>current.length&&current.length>=120&&common>=Math.floor(current.length*0.85);
        }catch(_){ }
      }
      if(owned){
        for(let attempt=0;attempt<3&&!cleared;attempt++){
          const refreshedDialog=findGroupPostDialog(),refreshedBox=refreshedDialog&&findGroupPostEditor(refreshedDialog);
          if(refreshedBox?.isConnected)draftBox=refreshedBox;
          // Facebook thường thay contenteditable ngay sau Ctrl+A/Backspace.
          // Gọi lại helper trên node mới trước khi dùng execCommand fallback,
          // nhưng chỉ trong trường hợp draft đã được chứng minh là của run này.
          cleared=await clearGroupPostDraft(draftBox,runId);
          if(cleared)break;
          try{draftBox.focus();draftBox.click();}catch(_){ }
          try{
            const sel=window.getSelection(),range=document.createRange();
            range.selectNodeContents(draftBox);sel.removeAllRanges();sel.addRange(range);
            document.execCommand("delete",false,null);
            draftBox.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));
          }catch(_){ }
          await sleep(350);
          const afterDialog=findGroupPostDialog(),afterBox=afterDialog&&findGroupPostEditor(afterDialog);
          if(afterBox?.isConnected)draftBox=afterBox;
          cleared=!normalizedGroupPostText(draftBox.innerText||draftBox.textContent||draftBox.value||"");
        }
      }
    }
    if(!cleared)return {ok:false,error:t("gp2.draftBusy")};
    // Lexical nuốt ký tự xuống dòng trong insertText nên nội dung nhiều dòng
    // bỏ qua đường execCommand, đi thẳng trustedInput (Shift+Enter thật).
    // Bài nguồn Web/FB thường dài 800–1200 ký tự. Gõ từng ký tự qua
    // execCommand làm Facebook/React thay contenteditable giữa chừng, để lại
    // prefix cụt dù chưa đủ nội dung. Bài dài dùng trustedInput ngay từ đầu;
    // đường từng ký tự chỉ giữ cho bài ngắn không xuống dòng.
    if(!expectedBreaks&&expected.length<=300){
    const chars=[...String(content||"")];
    for(let index=0;index<chars.length;){
      if(groupPostStopRequested||(runId&&!await groupPostRunActive(runId)))return {ok:false,error:t("bg.stoppedTyping")};
      if(!box.isConnected)break;
      let inserted=false;
      const chunk=chars.slice(index,index+typing.chunkSize).join("");
      try{inserted=!!document.execCommand("insertText",false,chunk);}catch(_){ }
      if(!inserted)break;
      if(!await groupPostSleep(aiTypingPauseForChunk(typing,chunk),runId))return {ok:false,error:t("bg.stoppedTyping")};
      index+=chunk.length;
    }
    }
    await sleep(350);
    let composer=await waitForGroupPostComposer(GROUP_POST_AUTO.contentVerifyWait,250),liveBox=composer?.box;
    let actual=normalizedGroupPostText(liveBox?.innerText||liveBox?.textContent);
    // Kiểm tra nội dung đầy đủ (không chỉ prefix) — popup dạng tab thiếu window
    // focus khiến execCommand dừng giữa chừng; trustedInput (Chrome debugger)
    // không cần focus nên được dùng làm fallback cho cả trường hợp trống lẫn cắt.
    // So text gộp whitespace nên phải đếm thêm ngắt dòng thật trong HTML.
    // Exact proof: prefix/length-only proof allowed an old Facebook draft to
    // remain after the new AI text and still pass, so the wrong concatenated
    // content was published. Whitespace is already normalized above.
    if(expected&&actual===expected&&groupPostBreaksOk(liveBox,expectedBreaks))return {ok:true,composer,actual};
    liveBox=liveBox||box;
    try{liveBox.focus();liveBox.click();}catch(_){ }
    // Xóa nội dung một phần (nếu có) để tránh lặp khi gõ lại bằng trustedInput.
    if(actual)await clearGroupPostDraft(liveBox,runId);
    if(actual)await sleep(350);
    composer=await waitForGroupPostComposer(GROUP_POST_AUTO.contentVerifyWait,250);
    liveBox=composer?.box||liveBox;
    // Debugger input can remain pending forever when Facebook has replaced the
    // composer or the tab is not accepting CDP input. Never leave the run
    // stuck at “Đang điền…”; fail closed so the state machine can record a
    // skip/error and release Stop.
    // Bài X/Web/FB thường 800–1200 ký tự. Với chế độ gõ người thật,
    // timeout cố định 20s luôn cắt bài giữa chừng rồi để lại draft cụt.
    // Tính thời gian chờ theo số code-point và nhịp gõ thực tế, vẫn có trần
    // an toàn để không treo vô hạn.
    const inputTimeoutMs=Math.min(180000,Math.max(45000,
      expected.length*Math.max(typing.maxDelayMs||0,typing.minDelayMs||0,1)
      +expectedBreaks*1200+12000));
    const typed=await Promise.race([
      chrome.runtime.sendMessage({action:"trustedInput",text:content,pressEnter:false,typingConfig:typing,abortStorageKey:"groupPostActive",abortRunId:runId,abortRunIdKey:"groupPostRunId"}),
      new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:"GROUP_POST_INPUT_TIMEOUT",code:"INPUT_TIMEOUT"}),inputTimeoutMs))
    ]);
    if(!typed?.ok)return {ok:false,error:typed?.error||t("gp2.typeFailText")};
    await sleep(500);
    composer=await waitForGroupPostComposer(GROUP_POST_AUTO.contentVerifyWait,250);liveBox=composer?.box;
    actual=normalizedGroupPostText(liveBox?.innerText||liveBox?.textContent);
    if(expected&&actual===expected&&groupPostBreaksOk(liveBox,expectedBreaks))return {ok:true,composer,actual};
    return {ok:false,error:actual?t("gp2.partialContent"):t("gp2.noContent")};
  }
  async function dismissGroupPostComposer(){
    await closeBackgroundChooserOnly();
    let dialog=findGroupPostDialog();
    if(dialog){
      const close=findVisibleButton(dialog,[/^(đóng|close)$/,/(đóng|close).*(tạo bài viết|create post|hộp thoại|dialog)/]);
      if(close)await clickGroupPostControl(close,()=>!findGroupPostDialog(),2200,700);
    }
    const discard=findVisibleButton(document,[/^(bỏ|bỏ bài viết|bỏ bản nháp|discard|discard post)$/]);
    if(discard)await clickGroupPostControl(discard,()=>!findGroupPostDialog(),2200,700);
    return !findGroupPostDialog();
  }
  function findGroupWelcomeDialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(isRenderedElement);
    return dialogs.find(dialog=>{
      if(findGroupPostEditor(dialog))return false;
      const text=normalizedGroupPostText(dialog.innerText||dialog.textContent||dialog.getAttribute("aria-label")||"").toLowerCase();
      // Facebook shows a first-visit welcome card over some groups. It blocks
      // the composer until it is closed, but is unrelated to the post itself.
      if(!/chào mừng(?: bạn)?(?: đến với)?|welcome(?:\s+to)?/.test(text))return false;
      // Keep this scoped to a dismissible welcome card. Other Facebook
      // dialogs (reports, post composer, etc.) must never be closed here.
      return !!findVisibleButton(dialog,[/^(đóng|close)$/i,/(?:đóng|close).*(?:hộp thoại|dialog|cửa sổ)/i,/^(tiếp|next)$/i]);
    })||null;
  }
  async function dismissGroupWelcomeDialog(){
    for(let attempt=0;attempt<3;attempt++){
      const dialog=findGroupWelcomeDialog();
      if(!dialog)return true;
      const close=findVisibleButton(dialog,[/^(đóng|close)$/i,/(?:đóng|close).*(?:hộp thoại|dialog|cửa sổ)/i]);
      const next=!close&&findVisibleButton(dialog,[/^(tiếp|next)$/i]);
      const control=close||next;
      if(!control)break;
      console.log(`[GroupPost] ${close?"closing":"advancing"} group welcome dialog`);
      await clickGroupPostControl(control,()=>!findGroupWelcomeDialog(),3500,700);
      if(!findGroupWelcomeDialog())return true;
      await sleep(250);
    }
    return !findGroupWelcomeDialog();
  }
  // Một số nhóm hiện dialog "Xin chào!" (giới thiệu bản thân) hoặc "Trả lời
  // câu hỏi" trước/thay cho composer. Không phải welcome card, không phải
  // composer thật → phát hiện và bỏ qua để tiếp tục mở composer.
  function findGroupPostBlockingDialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(isRenderedElement);
    return dialogs.find(dialog=>{
      if(findGroupPostEditor(dialog))return false;
      const text=normalizedGroupPostText(dialog.innerText||dialog.textContent||dialog.getAttribute("aria-label")||"").toLowerCase();
      return /xin\s*ch[àa]o|gi[oớ]i thi[eệ]u b[aả]n th[aâ]n|tr[aả] l[oờ]i c[aâ]u h[oỏ]i|c[aâ]u h[oỏ]i.{0,60}tr[uướ][oớ]c khi [dđ][aă]ng|answer.{0,40}question|question.{0,40}before.{0,40}post/i.test(text);
    })||null;
  }
  async function dismissGroupPostBlockingDialog(){
    for(let attempt=0;attempt<3;attempt++){
      const dialog=findGroupPostBlockingDialog();
      if(!dialog)return true;
      // Ưu tiên nút "Bỏ qua" / "Skip" / "Không, cảm ơn" / "Không"
      const skip=findVisibleButton(dialog,[/^(b[oỏ] qua|skip|kh[oô]ng,?\s*c[aả]m [oơ]n|kh[oô]ng)$/i]);
      const close=!skip&&findVisibleButton(dialog,[/^([dđ][oó]ng|close)$/i,/(?:[dđ][oó]ng|close).*(?:h[oộ]p tho[aạ]i|dialog)/i]);
      const btn=skip||close;
      if(!btn){console.log("[GroupPost] blocking dialog found but no dismiss button");break;}
      console.log(`[GroupPost] dismissing blocking dialog (${skip?"skip":"close"})`);
      await clickGroupPostControl(btn,()=>!findGroupPostBlockingDialog(),3500,700);
      if(!findGroupPostBlockingDialog())return true;
      await sleep(300);
    }
    return !findGroupPostBlockingDialog();
  }
  function groupPostSuccessConfirmed(dialog){
    if(!dialog?.isConnected||!isRenderedElement(dialog))return true;
    // Facebook giữ lại một dialog shell connected nhưng đã ẩn sau khi gửi
    // bài (đặc biệt với Page/Profile kèm ảnh và nhóm chờ duyệt). Khi editor
    // composer thật đã biến mất thì coi là đóng thành công, không đòi shell
    // ẩn phải bị remove khỏi DOM mới xác nhận.
    if(!findGroupPostEditor(dialog))return true;
    const statusText=[...document.querySelectorAll('[role="status"],[role="alert"]')]
      .filter(isRenderedElement).map(el=>normalizedGroupPostText(el.innerText||el.textContent)).join(" ").toLowerCase();
    // A disabled button or an emptied editor only says the click changed the
    // composer; it does not prove Facebook accepted the post.  Accept only a
    // closed composer or Facebook's explicit publish/review acknowledgement.
    return /(?:bài viết.{0,80}(?:đã (?:được )?đăng|đang chờ.{0,40}phê duyệt)|post.{0,80}(?:published|(?:is )?pending.{0,40}(?:review|approval)))/i.test(statusText);
  }
  let groupPostLastBroadScanAt=0;
  function groupPostContentVisible(content){
    const expected=normalizedGroupPostText(content).slice(0,80).toLocaleLowerCase("vi");
    if(expected.length<10)return false;
    const main=document.querySelector('[role="main"]')||document.body;
    const mainText=normalizedGroupPostText(main.innerText||main.textContent||"").toLocaleLowerCase("vi");
    // A group can publish the post into the feed immediately while marking
    // it as pending moderator approval. Facebook renders that acknowledgement
    // in the post card, not in role=status/alert, so treat matching content
    // plus the explicit pending proof as visible instead of reporting a
    // false "accepted but not displayed" failure.
    if(mainText.includes(expected)&&/(?:bài viết.{0,100}đang chờ.{0,60}phê duyệt|post.{0,100}(?:pending|awaiting).{0,60}(?:review|approval))/i.test(mainText))return true;
    if(!mainText.includes(expected))return false;
    const feed=main.querySelector('[role="feed"]');
    const candidates=[...main.querySelectorAll('[role="article"],[data-pagelet^="FeedUnit_"],[data-ad-preview="message"]'),...(feed?[...feed.children]:[])];
    const matchedCandidate=candidates.some(node=>{
      if(!isRenderedElement(node)||node.closest('[role="dialog"]')||node.querySelector('[contenteditable="true"]'))return false;
      const text=normalizedGroupPostText(node.innerText||node.textContent).toLocaleLowerCase("vi");
      return text.includes(expected);
    });
    if(matchedCandidate)return true;
    // A fast-engagement post can get surfaced by Facebook into its own
    // "Đáng chú ý"/Highlights module instead of (or before) a plain
    // FeedUnit_ card, which the scoped scan above never matches — a real
    // published post was then wrongly reported as "not displayed". Since
    // mainText already confirms our exact text is somewhere on the page,
    // fall back to a leaf-node scan (outside any dialog/composer) as proof.
    // Throttled to once every 2s since it walks the whole main region.
    const now=Date.now();
    if(now-groupPostLastBroadScanAt<2000)return false;
    groupPostLastBroadScanAt=now;
    return [...main.querySelectorAll("*")].some(node=>{
      if(node.children.length)return false;
      if(!isRenderedElement(node)||node.closest('[role="dialog"]')||node.closest('[contenteditable="true"]'))return false;
      const text=normalizedGroupPostText(node.textContent||"").toLocaleLowerCase("vi");
      return text.includes(expected);
    });
  }
  async function waitForGroupPostDisplayed(content,groupName,runId,index){
    const deadline=Date.now()+GROUP_POST_AUTO.postVisibleWait,holdMs=rand(GROUP_POST_AUTO.afterPostMin*1000,GROUP_POST_AUTO.afterPostMax*1000);
    const started=Date.now();
    while(Date.now()<deadline){
      if(!await groupPostRunActive(runId))return false;
      const left=Math.max(1,Math.ceil((deadline-Date.now())/1000));
      await chrome.storage.local.set({groupPostStage:"waiting-visible",groupPostStatus:t("gp2.waitVisible",{name:groupName,left})});
      if(groupPostContentVisible(content)&&Date.now()-started>=holdMs){
        await chrome.storage.local.set({groupPostStage:"post-visible"});
        return true;
      }
      await sleep(500);
    }
    const error=new Error(t("gp2.postNotVisible",{name:groupName}));
    error.postDisplayUnconfirmed=true;
    throw error;
  }
  async function submitGroupPostOnce(postBtn,dialog,runId,index){
    if(!await groupPostRunActive(runId))return false;
    await chrome.storage.local.set({groupPostStage:"submit-armed",groupPostSubmitRunId:runId,groupPostSubmitIndex:index,groupPostSubmitDispatchedAt:0});
    if(!await groupPostRunActive(runId))return false;
    // One trusted click only.  Retrying the Post control after a slow UI
    // update can create duplicate posts, so an ambiguous result fails closed.
    if(!await trustedMouse(postBtn,"click",()=>groupPostRunActive(runId)))return false;
    if(!await groupPostRunActive(runId))return false;
    await chrome.storage.local.set({groupPostStage:"submit-dispatched",groupPostSubmitRunId:runId,groupPostSubmitIndex:index,groupPostSubmitDispatchedAt:Date.now()});
    const deadline=Date.now()+GROUP_POST_AUTO.submitWait;
    while(Date.now()<deadline){
      if(!await groupPostRunActive(runId))return false;
      if(groupPostSuccessConfirmed(dialog))return true;
      await sleep(400);
    }
    return groupPostSuccessConfirmed(dialog);
  }
  async function createGroupPost(content,backgroundInput={},preferredColor="",lastColor="",runId="",index=-1,groupName="",typingConfig=null,media=null){
    const background=normalizeGroupPostBackground(backgroundInput);
    if(runId&&!await groupPostRunActive(runId))throw new Error(t("gp2.stoppedBeforePost"));
    // Dismiss Facebook's first-visit welcome card and greeting/question dialogs
    // before looking for the composer; otherwise they intercept the click.
    await dismissGroupWelcomeDialog();
    await dismissGroupPostBlockingDialog();
    const opener=findGroupPostOpener();if(!opener)throw new Error(t("gp2.noOpener"));
    console.log("[GroupPost] opening composer");
    if(!await clickGroupPostControl(opener,()=>!!findGroupPostDialog(),GROUP_POST_AUTO.composerOpenWait,1800)){
      // Chẩn đoán cho ca "có nút mà bấm không mở" (hay gặp trên Chrome thường
      // khi tab bị che/không focus): ghi lại opener/dialog để log sau chỉ rõ.
      try{
        const r=opener.getBoundingClientRect();
        await chrome.storage.local.set({groupPostDiag:{phase:"openFail",at:Date.now(),
          openerLabel:String(buttonLabel(opener)||"").slice(0,80),
          openerRect:[Math.round(r.top),Math.round(r.left),Math.round(r.width),Math.round(r.height)].join(","),
          dialogCount:document.querySelectorAll('[role="dialog"]').length,
          url:String(location.href).slice(0,120)}});
        await logActivity("groupPost",`[chẩn đoán mở khung soạn] nút="${String(buttonLabel(opener)||"").slice(0,60)}" dialog=${document.querySelectorAll('[role="dialog"]').length} url=${location.href}`);
      }catch(_){ }
      throw new Error(t("gp2.openFail"));
    }
    let composer=await waitForGroupPostComposer(GROUP_POST_AUTO.composerReadyWait);
    if(!composer)throw new Error(t("gp2.composerLoading"));
    let {dialog,box}=composer;
    let backgroundResult={applied:false,color:"",reason:t("gp2.bgOff")};
    if(background.enabled){
      const usableColors=background.mode==="fixed"?[background.fixedColor]:background.colors;
      backgroundResult=await applyGroupPostBackground(dialog,preferredColor,usableColors,lastColor,background.mode==="fixed");
      if(!backgroundResult.applied){
        if(background.fallback==="skip")throw new Error(t("gp2.skippedBySetting",{reason:backgroundResult.reason}));
        // fallback "plain": đăng chữ không nền thay vì bỏ qua nhóm
        console.warn(`[GroupPost] nền không áp dụng được (${backgroundResult.reason}), tiếp tục đăng không nền`);
        await logActivity("groupPost",`[nền không áp dụng: ${backgroundResult.reason}] đăng không nền tại nhóm "${groupName}"`);
      }
      if(backgroundResult.applied&&!await pacedGroupPostWait(background.afterBgMin,background.afterBgMax,t("gp2.restAfterBg",{color:groupPostColorName(backgroundResult.color)}),runId))throw new Error(t("gp2.stoppedAfterBg"));
    }
    composer=await waitForGroupPostComposer(GROUP_POST_AUTO.composerReadyWait);
    if(!composer)throw new Error(t("gp2.reloadInputFail"));
    ({dialog,box}=composer);
    box.scrollIntoView({block:"center"});await sleep(250);
    await chrome.storage.local.set({groupPostStatus:t("gp2.filling",{n:content.length})});
    const typed=await typeGroupPostContent(box,content,typingConfig,runId);
    if(!typed.ok)throw new Error(typed.error);
    if(normalizedGroupPostText(typed.actual)!==normalizedGroupPostText(content))throw new Error(t("gp2.contentMismatch"));
    console.log(`[GroupPost] content filled ${content.length} chars`);
    composer=typed.composer;
    if(!composer)throw new Error("Facebook làm mới ô nhập sau khi điền nội dung");
    ({dialog,box}=composer);
    if(backgroundResult.applied&&!editorStillHasBackground(box,dialog)){
      backgroundResult={applied:false,color:"",reason:t("gp2.bgDropped")};
      if(background.fallback==="skip")throw new Error(t("gp2.skippedBySetting",{reason:backgroundResult.reason}));
      // fallback "plain": nội dung đã gõ xong, tiếp tục đăng chữ không nền
      console.warn(`[GroupPost] nền bị mất sau khi nhập (${backgroundResult.reason}), đăng không nền`);
      await logActivity("groupPost",`[nền bị mất: ${backgroundResult.reason}] đăng không nền tại nhóm "${groupName}"`);
    }
    // Ảnh chụp bài X (nguồn X + bật ảnh): đính sau khi gõ xong, trước nút Đăng.
    if(media?.dataUrl){
      if(runId&&!await groupPostRunActive(runId))throw new Error(t("gp2.stoppedBeforePost"));
      await chrome.storage.local.set({groupPostStatus:t(media.kind==="web"?"gp2.attachingWebPhoto":media.kind==="fb"?"gp2.attachingFbPhoto":"gp2.attachingPhoto")});
      const at=await attachGroupPostPhoto(media.dataUrl,media.credit||"",dialog,runId);
      if(!at.ok&&at.error==="stopped")throw new Error(t("gp2.stoppedBeforePost"));
      if(!at.ok)await logActivity("groupPost",`[ảnh không đính được (${at.error})] nhóm "${groupName}" — đăng chữ`);
      dialog=findGroupPostDialog()||dialog;
    }
    let postBtn=null;
    for(let i=0;i<80&&!postBtn;i++){
      dialog=findGroupPostDialog()||dialog;
      postBtn=[...dialog.querySelectorAll('[role="button"],button')].find(b=>{
        const l=buttonLabel(b);return isRenderedElement(b)&&b.getAttribute("aria-disabled")!=="true"&&!b.disabled&&(l==="đăng"||l==="post");
      })||null;
      if(!postBtn)await sleep(250);
    }
    if(!postBtn)throw new Error(t("gp2.notReady"));
    if(!await pacedGroupPostWait(background.beforePostMin,background.beforePostMax,t("gp2.restBeforePost"),runId))throw new Error(t("gp2.stoppedBeforePost"));
    // Facebook có thể re-render/khôi phục draft trong lúc chờ trước khi đăng.
    // Đọc lại ngay sát cú click; chỉ cho đăng khi ô nhập vẫn đúng 100% bài AI.
    const finalDialog=findGroupPostDialog()||dialog,finalBox=findGroupPostEditor(finalDialog)||box;
    if(normalizedGroupPostText(finalBox?.innerText||finalBox?.textContent||finalBox?.value)!==normalizedGroupPostText(content))throw new Error(t("gp2.contentMismatch"));
    await chrome.storage.local.set({groupPostStatus:t("gp2.readyToPost")});
    // DỪNG BẰNG MỌI GIÁ: kiểm tra lại ngay trước cú bấm Đăng.
    if(groupPostStopRequested||(runId&&!await groupPostRunActive(runId)))throw new Error(t("gp2.stoppedBeforePost"));
    const submitted=await submitGroupPostOnce(postBtn,dialog,runId,index);
    if(!submitted)throw new Error(t("gp2.submitFail"));
    if(!await waitForGroupPostDisplayed(content,groupName,runId,index))throw new Error(t("gp2.submitFail"));
    console.log("[GroupPost] submit dispatched");
    return {ok:true,backgroundApplied:backgroundResult.applied,color:backgroundResult.color,reason:backgroundResult.reason};
  }
  function groupPostRouteIds(group){
    const ids=[];
    try{
      const raw=new URL(String(group?.url||""),location.href).pathname.match(/^\/groups\/([^/?#]+)/i)?.[1];
      if(raw)ids.push(String(raw).toLowerCase());
    }catch(_){ }
    const legacy=String(group?.id||"").trim().toLowerCase();
    if(legacy&&!ids.includes(legacy))ids.push(legacy);
    return ids;
  }
  function groupPostCanonicalUrl(group){
    const ids=groupPostRouteIds(group);
    if(ids.length){
      try{return new URL("/groups/"+ids[0],location.origin).href;}catch(_){}
    }
    return String(group?.url||"");
  }
  function groupPostCurrentGroupMatches(group,currentId,wantedIds){
    if(currentId&&wantedIds.includes(currentId))return true;
    // Facebook có thể đổi slug thành ID số sau khi mở nhóm. Khi đó dùng tiêu đề
    // nhóm đang hiển thị để xác nhận đúng trang, không reload về chính nhóm đó.
    const expected=normalizedGroupPostText(group?.name).toLocaleLowerCase("vi");
    if(!expected||expected.length<2)return false;
    const candidates=[document.querySelector('h1'),document.querySelector('[role="main"] h1'),document.querySelector('meta[property="og:title"]')];
    return candidates.some(el=>{
      const value=el?.getAttribute?.("content")||el?.innerText||el?.textContent||"";
      const actual=normalizedGroupPostText(value).toLocaleLowerCase("vi");
      return actual===expected||actual.startsWith(`${expected} |`)||actual.includes(expected);
    });
  }
  async function waitForGroupPostGroupReady(group,runId,index,total){
    const deadline=Date.now()+GROUP_POST_AUTO.groupReadyWait;
    let lastMarker="",stableSince=0,pendingHits=0;
    while(Date.now()<deadline){
      if(!await groupPostRunActive(runId))return false;
      const bodyText=normalizedGroupPostText(document.body?.innerText||'');
      if(/bạn hiện không xem được nội dung này|you can't view this content|content isn't available|nội dung này hiện không khả dụng/i.test(bodyText))return "unavailable";
      // Banner "chờ duyệt" có thể hiện thoáng qua lúc trang đang tải nên đòi
      // thấy 2 lần liên tiếp mới kết luận pending, tránh bỏ qua oan.
      if(isGroupPendingMembership()){pendingHits++;if(pendingHits>=2)return "pending";}
      else pendingHits=0;
      const ids=groupPostRouteIds(group),currentId=String(location.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1]||"").toLowerCase();
      const matched=groupPostCurrentGroupMatches(group,currentId,ids),main=document.querySelector('[role="main"]'),heading=document.querySelector('h1,[role="main"] h1');
      if(matched&&main&&heading){
        // Facebook đôi lúc khôi phục tab cuối của nhóm (/media, /files,
        // /members...) thay vì tab Thảo luận. Các route này không có
        // composer; chuyển về Discussion trước khi kết luận nhóm đã sẵn sàng.
        if(/\/(?:media|files|members|events)(?:\/|$)/i.test(location.pathname)){
          // Dùng URL nhóm gốc trực tiếp. Click tab bằng DOM không ổn định vì
          // Facebook có thể giữ lại route media dù link "Thảo luận" đang hiện.
          // Lần tải tiếp theo sẽ chạy lại state machine và tự resume.
          location.assign(groupPostCanonicalUrl(group));return "navigating";
        }
        await dismissGroupWelcomeDialog();
        await dismissGroupPostBlockingDialog();
        const marker=`${currentId}|${normalizedGroupPostText(heading.innerText||heading.textContent)}|${main.childElementCount}`;
        if(marker===lastMarker&&Date.now()-stableSince>=GROUP_POST_AUTO.groupStableWait)return true;
        if(marker!==lastMarker){lastMarker=marker;stableSince=Date.now();}
      }else{lastMarker="";stableSince=0;}
      const left=Math.max(1,Math.ceil((deadline-Date.now())/1000));
      await chrome.storage.local.set({groupPostStatus:t("gp2.waitGroup",{i:index+1,t:total,name:group.name,left})});
      await sleep(500);
    }
    return false;
  }
    // Pool tin X cho Đăng nhóm nguồn X: lấy 1 lần, chia mỗi nhóm 1 tin chưa
  // dùng, persist để sống qua reload (tag theo đúng users của run).
  let groupPostXPool=[],groupPostXPoolKey="";
  async function groupPostReadUsedUrls(){
    try{const s=await chrome.storage.local.get(["newsUsedUrls"]);return Array.isArray(s.newsUsedUrls)?s.newsUsedUrls:[];}catch(_){return[];}
  }
  async function groupPostMarkUrlUsed(url){
    if(!url)return;
    try{
      const list=await groupPostReadUsedUrls();
      if(!list.includes(url)){list.push(url);await chrome.storage.local.set({newsUsedUrls:list.slice(-500)});}
    }catch(_){}
  }
  function groupPostTrimXItem(it){
    return {link:String(it?.link||""),title:String(it?.title||"").slice(0,200),desc:String(it?.desc||"").slice(0,900),author:String(it?.author||"").slice(0,30),pubDate:String(it?.pubDate||"").slice(0,80),site:String(it?.site||"x.com").slice(0,30),topic:String(it?.topic||it?.author||"").slice(0,60)};
  }
  async function groupPostEnsureXPool(cfg){
    const users=Array.isArray(cfg.source?.users)?cfg.source.users:[];
    const key=users.map(u=>String(u||"").toLowerCase()).sort().join(",");
    const used=await groupPostReadUsedUrls();
    let pool=[],fetchError="";
    try{
      const s=await chrome.storage.local.get(["groupPostXPool"]);
      if(s.groupPostXPool&&s.groupPostXPool.key===key&&Array.isArray(s.groupPostXPool.items)){
        pool=s.groupPostXPool.items.filter(it=>it?.link&&!used.includes(it.link));
      }
    }catch(_){}
    if(!pool.length&&users.length){
      await chrome.storage.local.set({groupPostStatus:t("gp2.xFetching")});
      const hours=Math.min(100000,Math.max(0,parseInt(cfg.xHours)||0));
      const res=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"newsFetch",source:{type:"xread",users,hours}},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      if(res&&!res.ok)fetchError=String(res.error||"").trim();
      pool=((res&&res.ok?res.items:[])||[]).filter(it=>it?.link&&!used.includes(it.link)).map(groupPostTrimXItem);
      try{await chrome.storage.local.set({groupPostXPool:{key,items:pool.slice(0,60)}});}catch(_){}
    }
    groupPostXPool=pool;
    groupPostXPoolKey=key;
    return {pool,error:fetchError};
  }
  function groupPostNextXItem(){
    while(groupPostXPool.length){
      const it=groupPostXPool[0];
      groupPostXPool=groupPostXPool.slice(1);
      chrome.storage.local.set({groupPostXPool:{key:groupPostXPoolKey,items:groupPostXPool.slice(0,60)}}).catch(()=>{});
      if(it?.link)return it;
    }
    return null;
  }
  let groupPostWebPool=[],groupPostWebPoolKey="";
  // Cùng một bản tin có thể lên nhiều báo với tiêu đề gần giống nhau; đăng
  // vào nhiều nhóm sẽ bị trùng nội dung. So khớp token tiêu đề (bỏ từ chung)
  // và bỏ bản trùng ≥50%.
  function groupPostWebTitleTokens(it){
    const stop=new Set(["the","and","for","with","from","new","launch","launches","raise","raises","announce","announces","ai"]);
    try{
      return [...new Set((String(it?.title||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9]+/g)||[]).filter(w=>w.length>2&&!stop.has(w)))];
    }catch(_){return [];}
  }
  function groupPostDedupeWebItems(items){
    const kept=[];
    for(const it of items){
      const k=groupPostWebTitleTokens(it);
      const dup=kept.some(prev=>{
        const p=prev.k;
        if(!k.length||!p.length)return false;
        const set=new Set(k);let hit=0;for(const w of p)if(set.has(w))hit++;
        return hit/Math.min(k.length,p.length)>=0.5;
      });
      if(!dup)kept.push({item:it,k});
    }
    return kept.map(x=>x.item);
  }
  function groupPostTrimWebItem(it){
    return {link:String(it?.link||""),title:String(it?.title||"").slice(0,200),desc:String(it?.desc||"").slice(0,900),image:String(it?.image||"").slice(0,500),author:String(it?.author||"").slice(0,30),pubDate:String(it?.pubDate||"").slice(0,80),site:String(it?.site||"web").slice(0,30),topic:String(it?.topic||"").slice(0,60)};
  }
  async function groupPostEnsureWebPool(cfg){
    const urls=Array.isArray(cfg.source?.urls)?cfg.source.urls:[];
    const q=String(cfg.source?.q||"").trim();
    const hours=Math.min(720,Math.max(0,parseInt(cfg.source?.hours)||0));
    const key=urls.slice().sort().join(",").toLowerCase()+"|"+q.toLowerCase()+"|"+hours+"|img2";
    const used=await groupPostReadUsedUrls();
    let pool=[];
    try{
      const s=await chrome.storage.local.get(["groupPostWebPool"]);
      if(s.groupPostWebPool&&s.groupPostWebPool.key===key&&Array.isArray(s.groupPostWebPool.items)){
        pool=s.groupPostWebPool.items.filter(it=>it?.link&&!used.includes(it.link));
      }
    }catch(_){}
    if(!pool.length&&urls.length){
      await chrome.storage.local.set({groupPostStatus:t("gp2.webFetching")});
      const res=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"newsFetch",source:{type:"sites",urls,q,hours},count:30},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      const fetched=((res&&res.ok?res.items:[])||[]).filter(it=>it?.link&&!used.includes(it.link)).map(groupPostTrimWebItem);
      pool=groupPostDedupeWebItems(fetched).filter(it=>it?.link&&!used.includes(it.link));
      try{await chrome.storage.local.set({groupPostWebPool:{key,items:pool.slice(0,60)}});}catch(_){}
    }
    groupPostWebPool=pool;
    groupPostWebPoolKey=key;
    return pool;
  }
  function groupPostNextWebItem(preferImage=false){
    // Khi bật đính ảnh, ưu tiên bài có sẵn ảnh RSS để khỏi phải mở tab bài
    // báo (chậm hơn); bài không có ảnh vẫn được xử lý bằng tab capture.
    if(preferImage&&groupPostWebPool.length>1){
      const i=groupPostWebPool.findIndex(it=>it?.image);
      if(i>0){const[it]=groupPostWebPool.splice(i,1);groupPostWebPool.unshift(it);}
    }
    while(groupPostWebPool.length){
      const it=groupPostWebPool[0];
      groupPostWebPool=groupPostWebPool.slice(1);
      chrome.storage.local.set({groupPostWebPool:{key:groupPostWebPoolKey,items:groupPostWebPool.slice(0,60)}}).catch(()=>{});
      if(it?.link)return it;
    }
    return null;
  }
  let groupPostFbPool=[],groupPostFbPoolKey="";
  function groupPostTrimFbItem(it){
    return {
      link:String(it?.link||""),title:String(it?.title||"").slice(0,200),desc:String(it?.desc||"").slice(0,1800),
      image:String(it?.image||"").slice(0,500),images:(Array.isArray(it?.images)?it.images:[]).slice(0,30),
      author:String(it?.author||"").slice(0,120),pubDate:String(it?.pubDate||"").slice(0,80),
      site:"facebook.com",topic:String(it?.topic||"Facebook").slice(0,60),
      fbMode:String(it?.fbMode||"rewrite"),
      contentClass:String(it?.contentClass||"text").slice(0,20),hasBackground:it?.hasBackground===true||it?.contentClass==="textBg",
      timeMs:Number(it?.timeMs)||0,
      comments:(Array.isArray(it?.comments)?it.comments:[]).slice(0,3)
    };
  }
  async function groupPostEnsureFbPool(cfg){
    const urls=Array.isArray(cfg.source?.urls)?cfg.source.urls:[];
    const hours=Math.min(720,Math.max(0,parseInt(cfg.source?.hours)||0));
    const mode=["rewrite","rewrite_original","opinion_screenshot"].includes(cfg.source?.mode)?cfg.source.mode:"rewrite";
    const includeComment=cfg.source?.includeComment!==false;
    const backgroundOnly=cfg.source?.backgroundOnly===true||mode==="opinion_screenshot";
    const key=urls.slice().sort().join(",").toLowerCase()+"|"+hours+"|"+mode+"|"+(backgroundOnly?"bg1":"bg0")+"|"+(includeComment?"c1":"c0");
    const used=await groupPostReadUsedUrls();
    let pool=[];
    try{
      const s=await chrome.storage.local.get(["groupPostFbPool"]);
      if(s.groupPostFbPool&&s.groupPostFbPool.key===key&&Array.isArray(s.groupPostFbPool.items)){
        pool=s.groupPostFbPool.items.filter(it=>it?.link&&!used.includes(it.link));
      }
    }catch(_){}
    if(!pool.length&&urls.length){
      await chrome.storage.local.set({groupPostStatus:t("gp2.fbFetching")||t("gp2.webFetching")});
      const res=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"newsFetch",source:{type:"fb",urls,hours,mode,backgroundOnly,includeComment},count:30},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      pool=((res&&res.ok?res.items:[])||[]).filter(it=>it?.link&&!used.includes(it.link)).map(groupPostTrimFbItem);
      try{await chrome.storage.local.set({groupPostFbPool:{key,items:pool.slice(0,60)}});}catch(_){}
    }
    groupPostFbPool=pool;
    groupPostFbPoolKey=key;
    return pool;
  }
  function groupPostNextFbItem(preferImage=false){
    if(preferImage&&groupPostFbPool.length>1){
      const i=groupPostFbPool.findIndex(it=>it?.image);
      if(i>0){const[it]=groupPostFbPool.splice(i,1);groupPostFbPool.unshift(it);}
    }
    while(groupPostFbPool.length){
      const it=groupPostFbPool[0];
      groupPostFbPool=groupPostFbPool.slice(1);
      chrome.storage.local.set({groupPostFbPool:{key:groupPostFbPoolKey,items:groupPostFbPool.slice(0,60)}}).catch(()=>{});
      if(it?.link)return it;
    }
    return null;
  }
  async function groupPostPrepareFbImage(cfg,group,fbItem,runId){
    const mode=cfg.source?.mode||"rewrite";
    try{await chrome.storage.local.set({groupPostStatus:t(mode==="opinion_screenshot"?"gp2.fbShooting":"gp2.fbImage")});}catch(_){}
    if(mode==="opinion_screenshot"){
      if(!(fbItem?.hasBackground===true||fbItem?.contentClass==="textBg"))return "";
      const shot=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"fbShotPost",url:fbItem.link,includeComment:cfg.source?.includeComment!==false},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      if(!await groupPostRunActive(runId))return "";
      return shot?.ok&&shot.dataUrl?shot.dataUrl:"";
    }
    if(fbItem.image){
      const im=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"newsFetchImage",url:fbItem.image},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      if(!await groupPostRunActive(runId))return "";
      if(im?.ok&&im.dataUrl)return im.dataUrl;
    }
    // CDN chặn: chỉ được chụp dự phòng nếu chính bài là nền màu. Bài thường
    // sẽ đăng chữ/ảnh gốc (nếu có), tuyệt đối không tạo ảnh chụp dài.
    if(!(fbItem?.hasBackground===true||fbItem?.contentClass==="textBg"))return "";
    const shot=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"fbShotPost",url:fbItem.link,includeComment:false},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
    if(!await groupPostRunActive(runId))return "";
    return shot?.ok&&shot.dataUrl?shot.dataUrl:"";
  }
  async function groupPostAiFromFb(cfg,group,fbItem,runId,imageDataUrl){
    try{
      if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      await chrome.storage.local.set({groupPostStatus:t("gp2.aiWriting",{name:group.name})});
      const sourceMode=cfg.source?.mode||"rewrite";
      // meta-free không đọc ảnh (background ném bg.visionNeeded): viết chay bằng
      // chữ ngay từ đầu, ảnh/screenshot đã lấy vẫn đính vào bài ở bước sau.
      const noVisionAi=String(cfg.aiConfig?.provider||"")==="meta-free";
      let gen=null,lastErr="";
      for(let att=0;att<3;att++){
        if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
        if(att>0){
          await chrome.storage.local.set({groupPostStatus:t("gp2.aiRetry",{n:att,name:group.name})});
          const until=Date.now()+30000;
          let alive=true;
          while(Date.now()<until){if(!await groupPostRunActive(runId)){alive=false;break;}await new Promise(r=>setTimeout(r,300));}
          if(!alive)return {ok:false,error:"stopped"};
        }
        gen=await new Promise(resolve=>{try{chrome.runtime.sendMessage({
          action:"aiGenerateNewsPost",
          news:{title:fbItem.title,desc:fbItem.desc,pubDate:fbItem.pubDate||"",author:fbItem.author||"",comments:fbItem.comments||[]},
          topic:group.name,mode:"long",kind:"photo",maxChars:0,
          prompt:cfg.fbPrompt||"",groupName:group.name,metaFeature:"group-post",
          sourceMode,
          imageDataUrl:noVisionAi?"":(imageDataUrl||""),
          aiConfig:cfg.aiConfig||{}
        },r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
        if(gen?.ok)break;
        lastErr=String(gen?.error||"AI fail").slice(0,150);
        // Provider có vision nhưng vẫn báo thiếu vision (lạ): thử lại 1 lần
        // không ảnh ngay trong lượt này, không chờ 30s. Regex khớp cả vi/en.
        if(!noVisionAi&&att===0&&/vision|xem ảnh/i.test(lastErr)){
          gen=await new Promise(resolve=>{try{chrome.runtime.sendMessage({
            action:"aiGenerateNewsPost",
            news:{title:fbItem.title,desc:fbItem.desc,pubDate:fbItem.pubDate||"",author:fbItem.author||"",comments:fbItem.comments||[]},
            topic:group.name,mode:"long",kind:"photo",maxChars:0,
            prompt:cfg.fbPrompt||"",groupName:group.name,metaFeature:"group-post",
            sourceMode,
            imageDataUrl:"",
            aiConfig:cfg.aiConfig||{}
          },r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
          if(gen?.ok)break;
          lastErr=String(gen?.error||"AI fail").slice(0,150);
        }
        if(!/bận câu trước|treo|timeout|quá tải|busy|không trả lời|trống|empty|thử lại sau|quá chậm|chậm/i.test(lastErr))break;
      }
      if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      if(!gen?.ok)return {ok:false,error:lastErr||"AI fail"};
      return {ok:true,content:String(gen.content||"")};
    }catch(e){return {ok:false,error:String(e?.message||e).slice(0,150)};}
  }
  // Đính ảnh chụp bài X vào composer nhóm (proof: ảnh giải mã được + ổn định).
  // credit (poster video live) → đóng dấu @tác giả như Đăng tường.
  async function attachGroupPostPhoto(dataUrl,credit,dialog,runId){
    try{
      let blob=await (await fetch(dataUrl)).blob();
      if(!blob?.size)return {ok:false,error:"no-image"};
      if(credit){
        const stamped=await new Promise(resolve=>{
          let objUrl="";
          const done=v=>{if(objUrl)try{URL.revokeObjectURL(objUrl);}catch(_){}resolve(v);};
          try{
            objUrl=URL.createObjectURL(blob);
            const img=new Image();
            img.onload=()=>{
              try{
                const w=img.naturalWidth||0,h=img.naturalHeight||0;
                if(!w||!h||w<320){done({tooSmall:true});return;}
                const cv=document.createElement("canvas");cv.width=w;cv.height=h;
                const cx=cv.getContext("2d");if(!cx){done(null);return;}
                cx.drawImage(img,0,0,w,h);
                const text=`Nguồn: ${credit}`;
                const fs=Math.max(13,Math.round(w*0.032));
                cx.font=`600 ${fs}px Arial, sans-serif`;
                const padX=Math.round(fs*0.7),padY=Math.round(fs*0.45);
                const bw=Math.ceil(cx.measureText(text).width+padX*2),bh=Math.ceil(fs+padY*2);
                const m=Math.round(fs*0.6),bx=Math.max(0,w-bw-m),by=Math.max(0,h-bh-m);
                const r=Math.min(bh/2,Math.round(fs*0.5));
                cx.fillStyle="rgba(0,0,0,0.55)";cx.beginPath();
                cx.moveTo(bx+r,by);cx.arcTo(bx+bw,by,bx+bw,by+bh,r);cx.arcTo(bx+bw,by+bh,bx,by+bh,r);cx.arcTo(bx,by+bh,bx,by,r);cx.arcTo(bx,by,bx+bw,by,r);cx.closePath();cx.fill();
                cx.fillStyle="#fff";cx.textBaseline="middle";cx.fillText(text,bx+padX,by+bh/2+1);
                cv.toBlob(b=>done(b?{blob:b}:null),"image/jpeg",0.92);
              }catch(_){done(null);}
            };
            img.onerror=()=>done(null);
            img.src=objUrl;
          }catch(_){done(null);}
        });
        if(stamped?.tooSmall)return {ok:false,error:"too-small"};
        if(stamped?.blob)blob=stamped.blob;
      }
      const inputs=[...(dialog||document).querySelectorAll('input[type="file"]'),...document.querySelectorAll('input[type="file"]')].filter(el=>el?.isConnected);
      const input=inputs.find(el=>/image|photo|media/i.test(el.accept||""))||inputs[0];
      if(!input)return {ok:false,error:"no-input"};
      const dt=new DataTransfer();dt.items.add(new File([blob],`gpx-${Date.now()}.jpg`,{type:blob.type||"image/jpeg"}));
      input.files=dt.files;
      input.dispatchEvent(new Event("change",{bubbles:true}));
      input.dispatchEvent(new Event("input",{bubbles:true}));
    }catch(e){return {ok:false,error:String(e?.message||e).slice(0,60)};}
    let stableW=0;
    const end=Date.now()+25000;
    while(Date.now()<end){
      if(runId&&!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      const scope=dialog?.isConnected?dialog:document;
      const shots=[...scope.querySelectorAll("img")].filter(el=>{
        try{if(typeof isRenderedElement==="function"&&!isRenderedElement(el))return false;}catch(_){}
        const src=String(el.currentSrc||el.src||"");
        if(!(/^blob:|^data:/i.test(src)))return false;
        try{if(!el.complete)return false;}catch(_){return false;}
        return (el.naturalWidth||0)>=200;
      });
      if(shots.length){
        const w=Math.max(...shots.map(e=>e.naturalWidth||0));
        if(w>0&&w===stableW)return {ok:true};
        stableW=w;
      }else stableW=0;
      await sleep(700);
    }
    return {ok:false,error:"no-thumb"};
  }
  // Ảnh bài báo cho Đăng nhóm nguồn Web: RSS thường chỉ có thumbnail hoặc
  // không có ảnh (bị trim mất trước đây). Ưu tiên mở tab bài báo để lấy đúng
  // ảnh lớn của bài (kể cả ảnh hotlink/CORS), rồi mới tải trực tiếp URL RSS.
  async function fetchGroupPostWebImage(webItem,runId){
    const imageUrl=String(webItem?.image||"").trim();
    const articleUrl=String(webItem?.link||"").trim();
    if(!imageUrl&&!articleUrl)return "";
    try{await chrome.storage.local.set({groupPostStatus:t("gp2.webImage")});}catch(_){}
    if(articleUrl){
      const cap=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"webCaptureImage",articleUrl,imageUrl},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      if(runId&&!await groupPostRunActive(runId))return "";
      if(cap?.ok&&/^data:image\//i.test(String(cap.dataUrl||"")))return cap.dataUrl;
    }
    if(imageUrl){
      const res=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"newsFetchImage",url:imageUrl},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
      if(runId&&!await groupPostRunActive(runId))return "";
      if(res?.ok&&/^data:image\//i.test(String(res.dataUrl||"")))return res.dataUrl;
    }
    return "";
  }
  // Viết bài nhóm từ tin X bằng đường aiGenerateNewsPost (có sẵn quy tắc
  // ngày đăng/trung thực/giọng từng kiểu bài), tailor theo tên nhóm.
  async function groupPostAiFromX(cfg,group,xItem,runId){
    try{
      if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      await chrome.storage.local.set({groupPostStatus:t("gp2.aiWriting",{name:group.name})});
      const photo=!!cfg.withXPhoto;
      const bg=normalizeGroupPostBackground(cfg.background);
      const isBg=!photo&&bg.enabled;
      // Lỗi bận/timeout thì chờ 30s thử lại tối đa 3 lần (bắt live 17/10: cả
      // trăm skip "bận câu trước" vì bỏ ngay lượt đầu) — chỉ bỏ nhóm khi lỗi
      // dứt khoát (prompt sai...). Tuân stop flag trong lúc chờ.
      let gen=null,lastErr="";
      for(let att=0;att<3;att++){
        if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
        if(att>0){
          await chrome.storage.local.set({groupPostStatus:t("gp2.aiRetry",{n:att,name:group.name})});
          const until=Date.now()+30000;
          let alive=true;
          while(Date.now()<until){if(!await groupPostRunActive(runId)){alive=false;break;}await new Promise(r=>setTimeout(r,300));}
          if(!alive)return {ok:false,error:"stopped"};
        }
        gen=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"aiGenerateNewsPost",news:{title:xItem.title,desc:xItem.desc,pubDate:xItem.pubDate||""},topic:group.name,mode:isBg?"bg":"long",kind:photo?"photo":(isBg?"bg":"text"),maxChars:isBg?bg.maxChars:0,prompt:cfg.xPrompt||"",groupName:group.name,sourceMode:"x",metaFeature:"group-post",aiConfig:cfg.aiConfig||{}},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
        if(gen?.ok)break;
        lastErr=String(gen?.error||"AI fail").slice(0,150);
        if(!/bận câu trước|treo|timeout|quá tải|busy|không trả lời|trống|empty|thử lại sau|quá chậm|chậm/i.test(lastErr))break;
      }
      if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      if(!gen?.ok)return {ok:false,error:lastErr||"AI fail"};
      let shotUrl="",shotCredit="";
      if(photo&&xItem.link){
        await chrome.storage.local.set({groupPostStatus:t("gp2.xShooting")});
        const shot=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"xShotPost",url:xItem.link},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
        if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
        if(!shot?.ok||!shot.dataUrl)return {ok:false,error:`Không chụp được ảnh bài X: ${String(shot?.error||"X chưa mở/không tải được bài").slice(0,120)}`};
        shotUrl=shot.dataUrl;shotCredit=shot.credit||"";
      }
      return {ok:true,content:String(gen.content||""),shotUrl,shotCredit};
    }catch(e){return {ok:false,error:String(e?.message||e).slice(0,150)};}
  }
  async function groupPostAiFromWeb(cfg,group,webItem,runId){
    try{
      if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      await chrome.storage.local.set({groupPostStatus:t("gp2.aiWriting",{name:group.name})});
      const bg=normalizeGroupPostBackground(cfg.background);
      // Ảnh bài báo và nền màu loại trừ nhau (giống Đăng tường): bật đính ảnh
      // thì bài viết dài kiểu photo, không ép ngắn cho nền.
      const photo=!!cfg.withWebPhoto;
      const isBg=!photo&&bg.enabled;
      const kind=photo?"photo":(isBg?"bg":"text");
      let gen=null,lastErr="";
      for(let att=0;att<3;att++){
        if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
        if(att>0){
          await chrome.storage.local.set({groupPostStatus:t("gp2.aiRetry",{n:att,name:group.name})});
          const until=Date.now()+30000;
          let alive=true;
          while(Date.now()<until){if(!await groupPostRunActive(runId)){alive=false;break;}await new Promise(r=>setTimeout(r,300));}
          if(!alive)return {ok:false,error:"stopped"};
        }
        gen=await new Promise(resolve=>{try{chrome.runtime.sendMessage({action:"aiGenerateNewsPost",news:{title:webItem.title,desc:webItem.desc,pubDate:webItem.pubDate||""},topic:group.name,mode:isBg?"bg":"long",kind,maxChars:isBg?bg.maxChars:0,prompt:cfg.webPrompt||"",groupName:group.name,sourceMode:"web",metaFeature:"group-post",aiConfig:cfg.aiConfig||{}},r=>resolve(chrome.runtime.lastError?null:r));}catch(_){resolve(null);}});
        if(gen?.ok)break;
        lastErr=String(gen?.error||"AI fail").slice(0,150);
        if(!/bận câu trước|treo|timeout|quá tải|busy|không trả lời|trống|empty|thử lại sau|quá chậm|chậm/i.test(lastErr))break;
      }
      if(!await groupPostRunActive(runId))return {ok:false,error:"stopped"};
      if(!gen?.ok)return {ok:false,error:lastErr||"AI fail"};
      return {ok:true,content:String(gen.content||""),shotUrl:"",shotCredit:""};
    }catch(e){return {ok:false,error:String(e?.message||e).slice(0,150)};}
  }
  async function clearGroupPostDraftBeforeNavigate(){
    try{
      window.onbeforeunload=null;
      for(let i=0;i<2;i++){
        const dlg=(typeof findDialog==="function"?findDialog():null);
        if(!dlg)break;
        try{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",keyCode:27,bubbles:true}));}catch(_){}
        await sleep(400);
      }
      const ed=(typeof findEditor==="function"?findEditor(document):null);
      if(ed){ try{ed.focus();document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);}catch(_){} }
      await sleep(300);
    }catch(_){}
  }
  async function clearOwnedGroupPostDraftFromPreviousIndex(pendingContent,pendingIndex,currentIndex,runId){
    if(Number(pendingIndex)<0||Number(pendingIndex)===Number(currentIndex)||!String(pendingContent||"").trim())return true;
    const dialog=findGroupPostDialog(),box=dialog&&findGroupPostEditor(dialog);
    if(!box)return true;
    const current=normalizedGroupPostText(box.innerText||box.textContent||box.value||"");
    const pending=normalizedGroupPostText(pendingContent),cur=normalizedGroupPostText(current);
    if(!cur||!(cur===pending||(cur.length>=120&&pending.length>cur.length&&pending.startsWith(cur))))return true;
    const cleared=await clearGroupPostDraft(box,runId);
    if(cleared)await chrome.storage.local.set({groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostPendingWebItem:null,groupPostPendingFbItem:null});
    return cleared;
  }
  async function continueGroupPost(){
    if(isGroupPosting)return;
    isGroupPosting=true;
    let activeRunId="";    try{
      const s=await chrome.storage.local.get(["groupPostActive","groupPostRunId","groupPostConfig","groupPostIndex","groupPostDone","groupPostSkipped","groupPostNextAt","groupPostLastColor","groupPostRetryCount","groupPostPendingContent","groupPostPendingIndex","groupPostPendingWebItem","groupPostPendingFbItem","groupPostStage","groupPostSubmitRunId","groupPostSubmitIndex","groupPostSubmitDispatchedAt"]);
      let cfg=s.groupPostConfig;
      if(!s.groupPostActive||!cfg?.groups?.length)return;
      activeRunId=String(s.groupPostRunId||cfg.runId||"");      // Backward-compatible migration for an in-progress run from the
      // previous release.  New runs always receive a durable ID in popup.js.
      if(!activeRunId){
        activeRunId=`group-post-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        cfg={...cfg,runId:activeRunId};
        await chrome.storage.local.set({groupPostRunId:activeRunId,groupPostConfig:cfg});
      }
      // Nguồn tin X: nạp pool 1 lần (sống qua reload nhờ storage).
      if(cfg.source?.type==="x"){
        const {pool:xPool,error:xErr}=await groupPostEnsureXPool(cfg);
        if(!xPool.length){
          const msg=xErr||t("gp2.noXNews");
          await chrome.storage.local.set({groupPostActive:false,groupPostStatus:msg});
          await logActivity("groupPost",`[dừng: không lấy được tin X mới] ${msg}`);
          return;
        }
      }
      if(cfg.source?.type==="sites"){
        const pool=await groupPostEnsureWebPool(cfg);
        if(!pool.length){
          await chrome.storage.local.set({groupPostActive:false,groupPostStatus:t("gp2.webNoNews")||t("gp2.noXNews")});
          await logActivity("groupPost","[dừng: không lấy được tin Web mới] kiểm tra danh sách RSS và từ khóa");
          return;
        }
      }
      if(cfg.source?.type==="fb"){
        const pool=await groupPostEnsureFbPool(cfg);
        if(!pool.length){
          await chrome.storage.local.set({groupPostActive:false,groupPostStatus:t("bg.newsNoFbPosts")});
          await logActivity("groupPost","[dừng: không lấy được bài Page/Profile mới] kiểm tra link và quyền xem");
          return;
        }
      }
      if(!await groupPostRunActive(activeRunId))return;
      let index=parseInt(s.groupPostIndex)||0,done=parseInt(s.groupPostDone)||0;
      let skipped=parseInt(s.groupPostSkipped)||0;
      // Reloading after the one Post click but before Facebook's confirmation
      // is ambiguous.  Stop at the same group rather than opening a second
      // composer and risking a duplicate post.
      if((s.groupPostStage==="submit-armed"||s.groupPostStage==="submit-dispatched"||s.groupPostStage==="waiting-visible"||s.groupPostStage==="post-visible")&&s.groupPostSubmitRunId===activeRunId&&Number(s.groupPostSubmitIndex)===index){
        const stopMsg=t("gp2.stoppedAt",{name:cfg.groups[index]?.name||"",err:t("gp2.unconfirmed"),d:done,t:cfg.groups.length,s:skipped});
        await chrome.storage.local.set({groupPostActive:false,groupPostNextAt:0,groupPostStatus:stopMsg});
        await logActivity("groupPost",`[dừng: reload giữa lúc chờ xác nhận] ${stopMsg}`);
        return;
      }
      if(index>=cfg.groups.length){
        const doneMsg=t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped});
        await chrome.storage.local.set({groupPostActive:false,groupPostNextAt:0,groupPostSkipped:skipped,groupPostStatus:doneMsg});
        await logActivity("groupPost",`[hoàn tất] ${doneMsg}`);
        return;
      }
      const group=cfg.groups[index],wantedIds=groupPostRouteIds(group);
      const currentId=String(location.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1]||"").toLowerCase();
      console.log(`[GroupPost] checking selected group index=${index+1}`);
      if(!wantedIds.length||!groupPostCurrentGroupMatches(group,currentId,wantedIds)){
        if(!await groupPostRunActive(activeRunId))return;
        await chrome.storage.local.set({groupPostStatus:t("gp2.openingGroup",{i:index+1,t:cfg.groups.length,name:group.name})});
        await clearGroupPostDraftBeforeNavigate();
        location.assign(groupPostCanonicalUrl(group));return;
      }
      // Some groups display a welcome dialog only after the route settles.
      // Close it before waiting or opening the post composer.
      await dismissGroupWelcomeDialog();
      const groupReady=await waitForGroupPostGroupReady(group,activeRunId,index,cfg.groups.length);
      if(groupReady==="navigating"){
        // Route đã được đưa về trang thảo luận của đúng nhóm. Không được
        // tính skip ở vòng hiện tại; trang mới sẽ tự resume theo run state.
        return;
      }
      if(groupReady==="unavailable"){
        if(!await groupPostRunActive(activeRunId))return;
        skipped++;
        const unavailableMsg="Facebook báo nhóm không thể xem nội dung; không gọi AI và không thử đăng lại";
        await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:unavailableMsg,d:done,t:cfg.groups.length,s:skipped})});
        await logActivity("groupPost",`[bỏ qua: nhóm không truy cập được] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
        index++;
        if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
          await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostGroupReadyRetry:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
          await clearGroupPostDraftBeforeNavigate();
          location.assign(groupPostCanonicalUrl(cfg.groups[index]));
        }else{
          await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostGroupReadyRetry:0,groupPostNextAt:0,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
        }
        return;
      }
      if(!groupReady){
        if(!await groupPostRunActive(activeRunId))return;
        const readyRetry=Number(s.groupPostGroupReadyRetry)||0;
        if(readyRetry<2){
          const nextRetry=readyRetry+1;
          await chrome.storage.local.set({
            groupPostGroupReadyRetry:nextRetry,
            groupPostStatus:"Facebook đang tải chậm; thử lại đúng nhóm "+(index+1)+"/"+cfg.groups.length+" ("+nextRetry+"/2)..."
          });
          await clearGroupPostDraftBeforeNavigate();
          await groupPostSleep(2500,activeRunId);
          if(await groupPostRunActive(activeRunId))location.assign(groupPostCanonicalUrl(group));
          return;
        }
        skipped++;
        await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:t("gp2.groupLoadingSkip"),d:done,t:cfg.groups.length,s:skipped})});
        await logActivity("groupPost",`[bỏ qua: nhóm không tải xong] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
        index++;
        if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
          await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostGroupReadyRetry:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
          await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
        }else{
          await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostGroupReadyRetry:0,groupPostNextAt:0,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
        }
        return;
      }
      // Đã xác nhận nhóm hiện tại ổn định; retry tải nhóm chỉ thuộc nhóm
      // trước, không được ảnh hưởng nhóm kế tiếp.
      if(Number(s.groupPostGroupReadyRetry)||0){
        await chrome.storage.local.set({groupPostGroupReadyRetry:0});
      }
      if(groupReady==="pending"){
        if(!await groupPostRunActive(activeRunId))return;
        skipped++;
        await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:"chưa được duyệt vào nhóm",d:done,t:cfg.groups.length,s:skipped})});
        await logActivity("groupPost",`[bỏ qua: chưa được duyệt] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
        index++;
        if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
          await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
          await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
        }else{
          await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostNextAt:0,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
        }
        return;
      }
      // Facebook có thể giữ composer của nhóm trước sau khi SPA đổi route.
      // Nếu nội dung khớp đúng pending AI của index cũ thì dọn nó trước khi
      // xử lý nhóm mới; draft khác vẫn được giữ và createGroupPost sẽ dừng.
      if(!await clearOwnedGroupPostDraftFromPreviousIndex(s.groupPostPendingContent,s.groupPostPendingIndex,index,activeRunId)){
        const stopMsg=t("gp2.stoppedDraft",{name:group.name,err:t("gp2.draftBusy")});
        await chrome.storage.local.set({groupPostActive:false,groupPostStatus:stopMsg});
        await logActivity("groupPost",`[dừng: không dọn được draft AI cũ] nhóm ${index+1}/${cfg.groups.length} "${group.name}"`);
        return;
      }
      // Nhóm chỉ cho đăng bán (có ô bán hàng nhưng không có ô thảo luận):
      // bỏ qua TRƯỚC khi gọi AI để khỏi tốn lượt Meta/API và timeout vô ích,
      // rồi chuyển ngay sang nhóm đăng được. Không thấy ô nào thì giữ hành vi
      // cũ (createGroupPost sẽ báo noOpener sau).
      const composerKind=await detectGroupPostComposerKind(activeRunId);
      if(composerKind==="sell"){
        if(!await groupPostRunActive(activeRunId))return;
        skipped++;
        await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:t("gp2.sellOnlySkip"),d:done,t:cfg.groups.length,s:skipped})});
        await logActivity("groupPost",`[bỏ qua: chỉ bán hàng] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
        index++;
        if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
          await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
          await clearGroupPostDraftBeforeNavigate();
          await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
        }else{
          await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
        }
        return;
      }
      const nextAt=Number(s.groupPostNextAt)||0;
      if(nextAt>Date.now()&&!await waitForGroupPostSchedule(nextAt,index,cfg.groups.length,group.name,activeRunId))return;
      if(!await groupPostSleep(2200,activeRunId))return;
      // Nguồn tin X/Web: mỗi nhóm 1 tin chưa dùng (bỏ qua nhóm khi cạn tin).
      const xMode=cfg.source?.type==="x";
      const webMode=cfg.source?.type==="sites";
      const fbMode=cfg.source?.type==="fb";
      const isNewsMode=xMode||webMode||fbMode;
      let xItem=null,webItem=null,fbItem=null,xShotUrl="",xShotCredit="",webImageDataUrl="",fbImageDataUrl="";
      if(xMode){
        xItem=groupPostNextXItem();
        if(!xItem){
          skipped++;
          await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:t("gp2.xEmptyLeft"),d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[bỏ qua: hết tin X] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
          index++;
          if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
            await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
            await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
          }else{
            await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
          }
          return;
        }
      }else if(webMode){
        // Reload giữa lúc đã có bài AI nhưng chưa đăng: dùng lại đúng tin đã
        // viết (không lấy tin kế tiếp rồi đính nhầm ảnh của bài khác).
        const pendingWeb=Number(s.groupPostPendingIndex)===index&&s.groupPostPendingWebItem&&typeof s.groupPostPendingWebItem==="object"?s.groupPostPendingWebItem:null;
        webItem=pendingWeb?groupPostTrimWebItem(pendingWeb):groupPostNextWebItem(!!cfg.withWebPhoto);
        if(!webItem){
          skipped++;
          await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:t("gp2.webEmptyLeft")||t("gp2.xEmptyLeft"),d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[bỏ qua: hết tin Web] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
          index++;
          if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
            await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
            await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
          }else{
            await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
          }
          return;
        }
      }else if(fbMode){
        const pendingFb=Number(s.groupPostPendingIndex)===index&&s.groupPostPendingFbItem&&typeof s.groupPostPendingFbItem==="object"?s.groupPostPendingFbItem:null;
        fbItem=pendingFb?groupPostTrimFbItem(pendingFb):groupPostNextFbItem(cfg.source?.mode!=="opinion_screenshot");
        if(!fbItem){
          skipped++;
          await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:t("bg.newsNoFbPosts"),d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[bỏ qua: hết bài Page/Profile] nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}`);
          index++;
          if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
            await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
          }else{
            await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
          }
          return;
        }
      }
      const gpCtxOn=!isNewsMode&&cfg.ctxEnabled!==false;
      const gpCtxMode=cfg.ctxMode==="deep"?"deep":"saving";
      const gpMinLen=Math.min(1000,Math.max(30,parseInt(cfg.minLen)||200));
      const gpCtx=gpCtxOn?await collectGroupPostContext(group,activeRunId,gpCtxMode,gpMinLen):null;
      if(!await groupPostRunActive(activeRunId))return;
      await chrome.storage.local.set({groupPostStatus:t("gp2.aiWriting",{name:group.name})});
      const background=normalizeGroupPostBackground(cfg.background);
      // Ảnh chụp + nền màu loại trừ nhau (như Đăng tường): bài ảnh X/Web bỏ nền.
      if((xMode&&cfg.withXPhoto) || (webMode&&cfg.withWebPhoto) || fbMode)background.enabled=false;
      const preferredColor=background.enabled?chooseGroupPostColor(background,s.groupPostLastColor):"";
      const groupPostAiMsg={action:"aiGenerateGroupPost",groupName:group.name,prompt:cfg.prompt,aiConfig:cfg.aiConfig,background,groupContext:null,useSearch:gpCtxOn&&!!group.webSearch,minLen:gpMinLen};
      if(gpCtx)groupPostAiMsg.groupContext={groupName:group.name,groupType:gpCtx.type,windowHours:gpCtx.windowHours,today:(()=>{let today="";try{today=new Date().toLocaleDateString("vi-VN");}catch(_){today=new Date().toISOString().slice(0,10);}return today;})(),digest:gpCtx.digest,mode:gpCtxMode,exemplars:gpCtx.exemplars,avoid:gpCtx.avoid};
      let ai;
      if(Number(s.groupPostPendingIndex)===index&&String(s.groupPostPendingContent||"").trim())ai={ok:true,content:String(s.groupPostPendingContent).trim()};
      else if(xMode){
        const xr=await groupPostAiFromX(cfg,group,xItem,activeRunId);
        if(xr.ok){
          ai={ok:true,content:xr.content};
          xShotUrl=xr.shotUrl||"";xShotCredit=xr.shotCredit||"";
          if(await groupPostRunActive(activeRunId))await chrome.storage.local.set({groupPostPendingContent:ai.content,groupPostPendingIndex:index});
        }else if(xr.error==="stopped"){
          return;
        }else{
          skipped++;
          await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:xr.error||t("p.gpAiFail"),d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[bỏ qua: AI tin X lỗi] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${xr.error||""} — đã đăng ${done}, bỏ qua ${skipped}`);
          index++;
          if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
            await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
            await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
          }else{
            await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
          }
          return;
        }
      }else if(webMode){
        const wr=await groupPostAiFromWeb(cfg,group,webItem,activeRunId);
        if(wr.ok){
          ai={ok:true,content:wr.content};
          if(await groupPostRunActive(activeRunId))await chrome.storage.local.set({groupPostPendingContent:ai.content,groupPostPendingIndex:index,groupPostPendingWebItem:{link:webItem.link,image:webItem.image||"",title:webItem.title||"",desc:webItem.desc||"",pubDate:webItem.pubDate||"",site:webItem.site||""}});
        }else if(wr.error==="stopped"){
          return;
        }else{
          skipped++;
          await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:wr.error||t("p.gpAiFail"),d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[bỏ qua: AI tin Web lỗi] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${wr.error||""} — đã đăng ${done}, bỏ qua ${skipped}`);
          index++;
          if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
            await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
            await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
          }else{
            await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
          }
          return;
        }
      }else if(fbMode){
        fbImageDataUrl=await groupPostPrepareFbImage(cfg,group,fbItem,activeRunId);
        if(!await groupPostRunActive(activeRunId))return;
        if(!fbImageDataUrl)await logActivity("groupPost",`[không lấy được ảnh Page/Profile — đăng chữ] nhóm ${index+1}/${cfg.groups.length} "${group.name}"`);
        const fr=await groupPostAiFromFb(cfg,group,fbItem,activeRunId,fbImageDataUrl);
        if(fr.ok){
          ai={ok:true,content:fr.content};
          if(await groupPostRunActive(activeRunId))await chrome.storage.local.set({groupPostPendingContent:ai.content,groupPostPendingIndex:index,groupPostPendingFbItem:{link:fbItem.link,image:fbItem.image||"",title:fbItem.title||"",desc:fbItem.desc||"",author:fbItem.author||"",pubDate:fbItem.pubDate||"",site:"facebook.com",fbMode:fbItem.fbMode||cfg.source?.mode||"rewrite",comments:fbItem.comments||[]}});
        }else if(fr.error==="stopped"){
          return;
        }else{
          skipped++;
          await chrome.storage.local.set({groupPostSkipped:skipped,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:fr.error||t("p.gpAiFail"),d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[bỏ qua: AI bài Page/Profile lỗi] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${fr.error||""} — đã đăng ${done}, bỏ qua ${skipped}`);
          index++;
          if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
            await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
          }else{
            await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
          }
          return;
        }
      }
      else{
        ai=await sendGroupPostAi(groupPostAiMsg);
        if(ai?.ok&&await groupPostRunActive(activeRunId))await chrome.storage.local.set({groupPostPendingContent:ai.content,groupPostPendingIndex:index});
      }
      // Meta-free hay bị Meta giới hạn/hỏng session nhưng thường tự hồi ở chat
      // mới (SW tự xoay chat sau 2 lượt treo liên tiếp). Thử lại đúng 1 lần cho
      // nhóm này thay vì bỏ qua ngay lượt treo đầu — không bao giờ đăng trùng
      // vì chưa có bài nào được gửi ở giai đoạn AI viết.
      let metaFreeRetried=false;
      if(!ai?.ok&&ai?.code==="AI_TIMEOUT"&&cfg.aiConfig?.provider==="meta-free"&&await groupPostRunActive(activeRunId)){
        metaFreeRetried=true;
        await chrome.storage.local.set({groupPostStatus:t("gp2.aiRetryWait",{name:group.name})});
        await logActivity("groupPost",`[meta-free: treo lượt đầu, chờ SW trả chẩn đoán rồi thử lại] nhóm ${index+1}/${cfg.groups.length} "${group.name}"`);
        if(await groupPostSleep(20000,activeRunId)){
          ai=await sendGroupPostAi(groupPostAiMsg);
          if(ai?.ok&&await groupPostRunActive(activeRunId))await chrome.storage.local.set({groupPostPendingContent:ai.content,groupPostPendingIndex:index});
        }
      }
      if(!ai?.ok&&((ai?.code==="BACKGROUND_TOO_LONG"||ai?.code==="AI_EMPTY"||ai?.code==="AI_TIMEOUT")||/chưa nén được bài|could not compress|cut-off sentence|nội dung rỗng|empty content|không trả về nội dung|không trả lời/i.test(String(ai?.error||"")))){
        // AI viết hụt (nền quá dài không nén vừa / trả về rỗng): bỏ qua nhóm
        // này và đi tiếp, không dừng cả run (lỗi key/quota vẫn dừng fail-fast
        // ở nhánh throw dưới vì message của chúng không khớp pattern trên).
        let diagSuffix="";
        if(cfg.aiConfig?.provider==="meta-free"){
          try{
            const ds=await chrome.storage.local.get("metaFreeDiag");
            const diag=ds.metaFreeDiag;
            if(diag&&Date.now()-(diag.at||0)<10*60*1000)diagSuffix=` [meta-free: ${diag.code}${diag.detail?` ${diag.detail}`:""}]`;
          }catch(_){ }
        }
        const skipTag=(ai?.code==="AI_TIMEOUT"||/không trả lời/i.test(String(ai?.error||"")))?(metaFreeRetried?"[bỏ qua: AI vẫn treo sau khi thử lại]":"[bỏ qua: AI treo quá 150s]"):(ai?.code==="AI_EMPTY"||/nội dung rỗng|empty content|không trả về nội dung/i.test(String(ai?.error||""))?"[bỏ qua: AI trả về rỗng]":"[bỏ qua: bài nền quá dài không nén vừa]");
        skipped++;
        await chrome.storage.local.set({groupPostSkipped:skipped,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:`${ai?.error||t("p.gpAiFail")}${diagSuffix}`,d:done,t:cfg.groups.length,s:skipped})});
        await logActivity("groupPost",`${skipTag} nhóm ${index+1}/${cfg.groups.length} "${group.name}" — đã đăng ${done}, bỏ qua ${skipped}${diagSuffix}`);
        index++;
        if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
          await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:0,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1});
          await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
        }else{
          await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostNextAt:0,groupPostStatus:t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped})});
          await logActivity("groupPost",`[kết thúc] đã đăng ${done}/${cfg.groups.length}, bỏ qua ${skipped}`);
        }
        return;
      }
      if(!ai?.ok)throw new Error(ai?.error||t("p.gpAiFail"));
      // Web + đính ảnh: lấy ảnh SAU khi có bài (kể cả bài đã lưu từ lượt trước),
      // trước khi mở composer để không phải ngồi chờ trong dialog.
      if(webMode&&cfg.withWebPhoto){
        if(!await groupPostRunActive(activeRunId))return;
        webImageDataUrl=await fetchGroupPostWebImage(webItem,activeRunId)||"";
        if(!await groupPostRunActive(activeRunId))return;
        if(!webImageDataUrl)await logActivity("groupPost",`[không lấy được ảnh bài báo — đăng chữ] nhóm ${index+1}/${cfg.groups.length} "${group.name}"`);
      }
      console.log(`[GroupPost] AI content ready index=${index+1}`);
      if(!await groupPostRunActive(activeRunId))return;
      console.log(`[GroupPost] preparing composer index=${index+1}`);
      const colorText=preferredColor?` ${t("gp2.withBg",{color:groupPostColorName(preferredColor)})}`:"";
      await chrome.storage.local.set({groupPostStatus:t("gp2.posting",{len:ai.content.length,color:colorText,name:group.name})});
      let completedCurrent=false,skippedCurrent=false;
      for(let attempt=1;attempt<=3&&!completedCurrent&&!skippedCurrent;attempt++){
        await chrome.storage.local.set({groupPostRetryCount:attempt-1,groupPostStatus:t("gp2.retrying",{n:attempt,name:group.name})});
        try{
          const posted=await createGroupPost(ai.content,background,preferredColor,s.groupPostLastColor,activeRunId,index,group.name,cfg.typingConfig||null,(xMode&&cfg.withXPhoto&&xShotUrl)?{dataUrl:xShotUrl,credit:xShotCredit||"",kind:"x"}:(webMode&&cfg.withWebPhoto&&webImageDataUrl?{dataUrl:webImageDataUrl,credit:"",kind:"web"}:(fbMode&&fbImageDataUrl?{dataUrl:fbImageDataUrl,credit:"",kind:"fb"}:null)));
          if(!await groupPostRunActive(activeRunId))return;
          done++;completedCurrent=true;
          if(xItem?.link)await groupPostMarkUrlUsed(xItem.link);
          if(webItem?.link)await groupPostMarkUrlUsed(webItem.link);
          if(fbItem?.link)await groupPostMarkUrlUsed(fbItem.link);
          const detail=posted.backgroundApplied?t("gp2.bgDetail",{color:groupPostColorName(posted.color)}):t("gp2.plainPost");
          await recordGroupPostAngle(groupPostCtxKey(group),gpCtx?.digest,ai.content);
          await chrome.storage.local.set({groupPostDone:done,groupPostLastColor:posted.backgroundApplied?posted.color:s.groupPostLastColor||"",groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostPendingWebItem:null,groupPostPendingFbItem:null,groupPostStage:"",groupPostSubmitRunId:"",groupPostSubmitIndex:-1,groupPostSubmitDispatchedAt:0,groupPostStatus:t("gp2.posted",{d:done,t:cfg.groups.length,detail:detail,name:group.name})});
          console.log(`[GroupPost] posted ${done}/${cfg.groups.length} background=${posted.backgroundApplied?posted.color:"plain"}`);
          await logActivity("groupPost",`[đã đăng ${done}/${cfg.groups.length}] nhóm ${index+1} "${group.name}" (${ai.content.length} ký tự, ${detail})`);
          // waitForGroupPostDisplayed đã vừa xác minh bài trong feed vừa giữ
          // nguyên nhóm 8–12 giây; không chờ lặp thêm ở đây.
        }catch(e){
          if(!await groupPostRunActive(activeRunId))return;
          const explicitSkip=/đã bỏ qua theo cài đặt|skipped per setting/i.test(e.message);
          // "Nút Đăng chưa sẵn sàng" xảy ra khi nhóm yêu cầu trả lời câu hỏi
          // trước khi đăng bài — nút Đăng bị disabled cho đến khi điền câu hỏi.
          // Extension không tự trả lời câu hỏi → bỏ qua nhóm thay vì dừng run.
          const skippableGroupError=/không tìm thấy nút tạo bài viết|không bấm được nút tạo bài viết|chưa tải xong cửa sổ tạo bài viết|chưa tải lại ô nhập|nội dung trong ô Facebook khác nội dung AI đã duyệt|nhóm không có nút chọn nền màu|không mở được bảng nền màu|chưa mở toàn bộ bảng màu|không tìm thấy màu nền|không xác nhận nền|nút [dđ]ăng ch[uư]a s[aẵ]n s[aà]ng|create-post button not found|could not click the create-post button|did not load the composer in time|did not reload the input after background pick|composer differs from the approved AI content|no background palette button|could not open the background palette|did not open the full palette|no usable background color|did not confirm the .* background|post button not ready/i.test(String(e.message||""));
          const mayAlreadyBePosted=e.postDisplayUnconfirmed||/chưa xác nhận đăng bài|không nhận thao tác bấm nút đăng|hasn't confirmed the post|did not accept the Post click/i.test(e.message);
          console.log(`[GroupPost] attempt ${attempt}/3 failed index=${index+1}: ${String(e.message||" lỗi không rõ").slice(0,180)}`);
          if(explicitSkip){
            skippedCurrent=true;
            skipped++;
            await dismissGroupPostComposer();
            await chrome.storage.local.set({groupPostSkipped:skipped,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStatus:t("gp2.skippedWithErr",{name:group.name,err:e.message,d:done,t:cfg.groups.length,s:skipped})});
            await logActivity("groupPost",`[bỏ qua] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${e.message}`);
            break;
          }
          if(skippableGroupError&&attempt>=2){
            skippedCurrent=true;
            skipped++;
            await dismissGroupPostComposer();
            await chrome.storage.local.set({groupPostSkipped:skipped,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:e.message,d:done,t:cfg.groups.length,s:skipped})});
            console.log(`[GroupPost] skipped index=${index+1} reason=${String(e.message||" lỗi không rõ").slice(0,160)}`);
            await logActivity("groupPost",`[bỏ qua sau ${attempt} lần thử] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${e.message}`);
            break;
          }
          if(mayAlreadyBePosted){
            // Đã bấm Đăng nhưng Facebook chưa xác nhận (chậm/chờ duyệt/lỗi proof):
            // KHÔNG mở composer thứ hai trong cùng nhóm (tránh đăng trùng) mà bỏ
            // qua nhóm này và đi tiếp — user kiểm tra tay nhóm vừa rồi. Đi tiếp
            // không bao giờ gây trùng bài, còn dừng cả run thì quá đáng.
            skippedCurrent=true;
            skipped++;
            await dismissGroupPostComposer();
            await chrome.storage.local.set({groupPostSkipped:skipped,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStatus:t("gp2.skippedGroup",{name:group.name,err:e.message,d:done,t:cfg.groups.length,s:skipped})});
            console.log(`[GroupPost] skipped unconfirmed index=${index+1} reason=${String(e.message||" lỗi không rõ").slice(0,160)}`);
            await logActivity("groupPost",`[bỏ qua: chưa xác nhận đăng — kiểm tra tay] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${e.message} — đã đăng ${done}, bỏ qua ${skipped}`);
            break;
          }
          if(attempt>=3){
            const stopMsg=t("gp2.stoppedAt",{name:group.name,err:e.message,d:done,t:cfg.groups.length,s:skipped});
            await chrome.storage.local.set({groupPostActive:false,groupPostNextAt:0,groupPostIndex:index,groupPostRetryCount:attempt,groupPostStatus:stopMsg});
            await logActivity("groupPost",`[dừng hẳn: hết ${attempt} lần thử] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${e.message}`);
            return;
          }
          let closed=await dismissGroupPostComposer();
          // Facebook có thể giữ một dialog shell/portal trong DOM sau khi
          // cửa sổ soạn bài đã đóng thật. Chỉ coi là chưa đóng khi vẫn còn
          // editor composer hiển thị; shell ẩn không được làm dừng retry.
          await sleep(500);
          const visibleComposer=[...document.querySelectorAll('[role="dialog"]')].some(d=>{
            try{return isRenderedElement(d)&&!!findGroupPostEditor(d);}catch(_){return false;}
          });
          // Nếu nút đóng trả kết quả âm nhưng editor đã biến mất thì thao tác
          // thực tế đã hoàn tất; tiếp tục retry thay vì dừng oan vì portal ẩn.
          if(!visibleComposer)closed=true;
          // Timeout xảy ra trước cú bấm Đăng nên không có rủi ro bài đã gửi
          // trùng. Cho phép mở lại composer; guard nội dung ở lượt kế tiếp sẽ
          // tiếp tục chặn nếu draft Facebook vẫn không khớp.
          if(!closed&&/GROUP_POST_INPUT_TIMEOUT|INPUT_TIMEOUT/i.test(String(e.message||"")))closed=true;
          if(!closed){
            await chrome.storage.local.set({groupPostActive:false,groupPostNextAt:0,groupPostIndex:index,groupPostRetryCount:attempt,groupPostStatus:t("gp2.stoppedDraft",{name:group.name,err:e.message})});
            await logActivity("groupPost",`[dừng hẳn: không đóng được cửa sổ soạn bài] nhóm ${index+1}/${cfg.groups.length} "${group.name}": ${e.message}`);
            return;
          }
          await chrome.storage.local.set({groupPostStatus:t("gp2.retryWait",{n:attempt,err:e.message})});
          if(!await pacedGroupPostWait(2,3,t("gp2.reopenComposer"),activeRunId))return;
        }
      }
      if(!completedCurrent&&!skippedCurrent)return;
      index++;
      if(index<cfg.groups.length&&await groupPostRunActive(activeRunId)){
        const configuredDelay=Number(cfg.interGroupDelay);
        const delaySeconds=Number.isFinite(configuredDelay)&&configuredDelay>=5?Math.min(604800,configuredDelay):rand(GROUP_POST_AUTO.interGroupMin,GROUP_POST_AUTO.interGroupMax);
        const nextRun=Date.now()+delaySeconds*1000;
        await chrome.storage.local.set({groupPostIndex:index,groupPostNextAt:nextRun,groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStatus:t("gp2.nextGroup",{d:done,t:cfg.groups.length,delay:Math.round(delaySeconds),next:cfg.groups[index].name,s:skipped})});
        const live=await chrome.storage.local.get(["groupPostActive","groupPostRunId"]);
        if(live.groupPostActive&&live.groupPostRunId===activeRunId&&!groupPostStopRequested){
          const nextIds=groupPostRouteIds(cfg.groups[index]);
          if(nextIds.includes(String(location.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1]||"").toLowerCase())){
            setTimeout(continueGroupPost,250);
          }else await clearGroupPostDraftBeforeNavigate();
            await clearGroupPostDraftBeforeNavigate();
            location.assign(groupPostCanonicalUrl(cfg.groups[index]));
        }
      } else if(await groupPostRunActive(activeRunId)){
        const doneMsg=t("gp2.doneAll",{d:done,t:cfg.groups.length,s:skipped});
        await chrome.storage.local.set({groupPostActive:false,groupPostIndex:index,groupPostSkipped:skipped,groupPostNextAt:0,groupPostStatus:doneMsg});
        await logActivity("groupPost",`[hoàn tất] ${doneMsg}`);
      }
    }catch(e){
      console.warn("[GroupPost] error",e);
      if(activeRunId&&await groupPostRunActive(activeRunId)){
        await chrome.storage.local.set({groupPostActive:false,groupPostStatus:`Lỗi đăng nhóm: ${e.message}`});
        await logActivity("groupPost",`[dừng hẳn: lỗi ngoài dự kiến] ${e.message}`);
      }
    }finally{
      isGroupPosting=false;
      // A newly started run can arrive while the old one is unwinding.  Let
      // it take over only after the old run has released this in-tab lock.
      const next=await chrome.storage.local.get(["groupPostActive","groupPostRunId"]);
      if(next.groupPostActive&&next.groupPostRunId&&next.groupPostRunId!==activeRunId)setTimeout(continueGroupPost,0);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
    if(msg.action==="scanFeedLikes"){
      const n=scanFeedLikes();
      sendResponse({count:n});
      return true;
    } else if(msg.action==="scanFeedScope"){
      const n=scanFeedScope(msg.actionMode||"like");
      sendResponse({count:n,actionMode:feedScopeActionMode(msg.actionMode)});
      return true;
    } else if(msg.action==="checkGroupsPageReady"){
      // Kiểm tra trang /groups/joins/ có load đúng không hay bị lỗi "Trang này hiện không hiển thị"
      const body=document.body?.innerText||"";
      const isError=/trang này hiện không hiển thị|this page isn't available|something went wrong|đã xảy ra sự cố/i.test(body);
      const main=document.querySelector('[role="main"]')||document.body;
      const mainGroupLinks=main.querySelectorAll('a[href*="/groups/"]');
      sendResponse({ok:!isError&&mainGroupLinks.length>=3,isError,mainCount:mainGroupLinks.length});
      return true;
    } else if(msg.action==="scanJoinedGroups"){
      scanJoinedGroups().then(result=>sendResponse({ok:true,groups:result.groups,totalShown:result.totalShown})).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    } else if(msg.action==="startGroupInteract"){
      const runId=String(msg.runId||`group-interact-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
      const requestedGroups=Math.max(1,parseInt(msg.targetGroups)||(msg.groups||[]).length||1);
      const limitedGroups=(msg.groups||[]).slice(0,Math.min(requestedGroups,(msg.groups||[]).length));
      const cfg={groups:limitedGroups,perGroup:Math.max(1,parseInt(msg.perGroup)||5),minDelay:Math.max(1,parseInt(msg.minDelay)||5),maxDelay:Math.max(1,parseInt(msg.maxDelay)||12),reaction:msg.reaction||"random",targetGroups:requestedGroups,runId,ownerTabId:(sender&&sender.tab&&sender.tab.id)||msg.ownerTabId||0};
      chrome.storage.local.get(["groupInteractActive","groupInteractRunId","groupCommentActive"]).then(current=>{
        if(current.groupCommentActive){sendResponse({ok:false,error:t("p.giBusyOtherMode")});return;}
        if(current.groupInteractActive&&current.groupInteractRunId===runId){
          groupStopRequested=false;
          sendResponse({ok:true,resumed:true});
          setTimeout(continueGroupInteraction,0);
          return;
        }
        if(current.groupInteractActive&&current.groupInteractRunId!==runId){sendResponse({ok:false,error:t("p.giStartFail")});return;}
        groupStopRequested=false;
        clearGroupCommentDraftMemory();
        clearGroupCommentDraftOwnedHistory();
        chrome.storage.local.set({groupInteractActive:true,groupInteractRunId:runId,groupInteractConfig:cfg,groupInteractIndex:0,groupInteractDone:0,groupInteractAiDone:0,groupInteractTotal:cfg.groups.length*cfg.perGroup,groupInteractCurrentGroupIndex:0,groupInteractCurrentGroupDone:0,groupInteractCurrentGroupAiDone:0,groupInteractReactedKeys:{},groupInteractReactionGuard:{},groupInteractCommentGuard:{},groupInteractStatus:t("gi2.starting")}).then(()=>{sendResponse({ok:true});setTimeout(continueGroupInteraction,200);});
      });
      return true;
    } else if(msg.action==="startGroupPost"){
      const runId=String(msg.runId||`group-post-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
      const cfg={groups:msg.groups||[],prompt:msg.prompt||"",minDelay:Math.max(5,parseInt(msg.minDelay)||20),maxDelay:Math.max(5,parseInt(msg.maxDelay)||40),interGroupDelay:Math.min(604800,Math.max(5,parseInt(msg.interGroupDelay)||30)),aiConfig:msg.aiConfig||{},background:normalizeGroupPostBackground(msg.background),typingConfig:msg.typingConfig?normalizeAiTypingConfig(msg.typingConfig):null,runId,ownerTabId:(sender&&sender.tab&&sender.tab.id)||msg.ownerTabId||0};
      chrome.storage.local.get(["groupShareActive","groupPostActive","groupPostRunId"]).then(other=>{
        if(other.groupShareActive){sendResponse({ok:false,error:t("p.shBusyPost")});return;}
        // Popup persisted this exact run before navigating.  Do not reset its
        // counters/config when the delayed message reaches the reloaded tab.
        if(other.groupPostActive&&other.groupPostRunId===runId){
          groupPostStopRequested=false;
          sendResponse({ok:true,resumed:true});
          setTimeout(continueGroupPost,0);
          return;
        }
        if(other.groupPostActive&&other.groupPostRunId!==runId){sendResponse({ok:false,error:t("p.gpStartFail")});return;}
        groupPostStopRequested=false;
        chrome.storage.local.set({groupPostActive:true,groupPostRunId:runId,groupPostConfig:cfg,groupPostIndex:0,groupPostDone:0,groupPostSkipped:0,groupPostTotal:cfg.groups.length,groupPostNextAt:0,groupPostLastColor:"",groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStage:"",groupPostSubmitRunId:"",groupPostSubmitIndex:-1,groupPostSubmitDispatchedAt:0,groupPostStatus:t("gp2.starting")}).then(()=>{sendResponse({ok:true});setTimeout(continueGroupPost,200);});
      });return true;
    } else if(msg.action==="stopGroupPost"){
      groupPostStopRequested=true;chrome.storage.local.set({groupPostActive:false,groupPostNextAt:0,groupPostStatus:t("p.gpStopped")}).then(()=>sendResponse({ok:true}));return true;
    } else if(msg.action==="startGroupComment"){
      const runId=String(msg.runId||`group-comment-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
      chrome.storage.local.get(["groupCommentActive","groupCommentRunId","groupInteractActive"]).then(current=>{
        if(current.groupInteractActive){sendResponse({ok:false,error:t("p.giBusyOtherMode")});return;}
        if(current.groupCommentActive&&current.groupCommentRunId===runId){
          groupCommentStopRequested=false;sendResponse({ok:true,resumed:true});setTimeout(continueGroupComment,0);return;
        }
        if(current.groupCommentActive&&current.groupCommentRunId!==runId){sendResponse({ok:false,error:t("p.giStartFail")});return;}
        startGroupCommentRun({...msg,runId,ownerTabId:(sender&&sender.tab&&sender.tab.id)||msg.ownerTabId||0})
          .then(()=>sendResponse({ok:true}))
          .catch(error=>sendResponse({ok:false,error:error?.message||String(error)}));
      });
      return true;
    } else if(msg.action==="startGroupCommentFromStr"){
      try{
        const cfg=JSON.parse(msg.configStr||"{}");
        const runId=String(`group-comment-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
        chrome.storage.local.get(["groupCommentActive","groupCommentRunId","groupInteractActive"]).then(current=>{
          if(current.groupInteractActive){sendResponse({ok:false,error:"groupInteract busy"});return;}
          if(current.groupCommentActive&&current.groupCommentRunId!==runId){sendResponse({ok:false,error:"already active"});return;}
          startGroupCommentRun({...cfg,runId,ownerTabId:(sender&&sender.tab&&sender.tab.id)||cfg.ownerTabId||0})
            .then(()=>sendResponse({ok:true}))
            .catch(e=>sendResponse({ok:false,error:e?.message||String(e)}));
        });
      }catch(e){sendResponse({ok:false,error:e.message});}
      return true;
    } else if(msg.action==="stopGroupInteract"){
      groupStopRequested=true;
      chrome.storage.local.set({groupInteractActive:false,groupInteractStatus:t("p.stopped")}).then(()=>{
        void (async()=>{await cleanupGroupCommentDraft();clearGroupCommentDraftMemory();clearGroupCommentDraftOwnedHistory();})();
        sendResponse({ok:true});
      });
      return true;
    } else if(msg.action==="stopGroupComment"){
      groupCommentStopRequested=true;
      chrome.storage.local.set({groupCommentActive:false,groupCommentStatus:t("p.stopped")}).then(()=>{
        void (async()=>{await cleanupGroupCommentDraft();clearGroupCommentDraftMemory();clearGroupCommentDraftOwnedHistory();})();
        sendResponse({ok:true});
      });
      return true;
    } else if(msg.action==="resetGroupInteract"){
      groupStopRequested=true;
      // Reset mở phiên mới nhưng giữ lịch sử chống trùng để không thả cảm
      // xúc lặp vào cùng bài; chỉ zero bộ đếm/guards/tiến trình nhóm hiện tại.
      document.querySelectorAll('[data-feed-interacted="1"]').forEach(el=>{delete el.dataset.feedInteracted;el.style.outline="";});
      void (async()=>{await cleanupGroupCommentDraft();clearGroupCommentDraftMemory();clearGroupCommentDraftOwnedHistory();})();
      chrome.storage.local.set({groupInteractActive:false,groupInteractRunId:"",groupInteractIndex:0,groupInteractDone:0,groupInteractAiDone:0,groupInteractTotal:0,groupInteractCurrentGroupIndex:0,groupInteractCurrentGroupDone:0,groupInteractCurrentGroupAiDone:0,groupInteractReactionGuard:{},groupInteractCommentGuard:{},groupInteractAiSkipped:{},groupInteractStatus:t("gi.reactionResetDone")}).then(()=>sendResponse({ok:true}));
      return true;
    } else if(msg.action==="resetGroupComment"){
      groupCommentStopRequested=true;
      // Reset chỉ zero bộ đếm/phiên đang chạy, giữ groupCommentHistory để
      // phiên mới không comment lặp vào bài đã xử lý (giống Reset Comment AI
      // Bản tin). Dọn luôn draft do AI sở hữu để không kẹt cảnh báo rời trang.
      void (async()=>{await cleanupGroupCommentDraft();clearGroupCommentDraftMemory();clearGroupCommentDraftOwnedHistory();})();
      chrome.storage.local.set({groupCommentActive:false,groupCommentRunId:"",groupCommentIndex:0,groupCommentDone:0,groupCommentTotal:0,groupCommentCurrentGroupIndex:0,groupCommentCurrentGroupDone:0,groupCommentSubmissionGuard:{},groupCommentProcessedKeys:[],groupCommentRetryCounts:{},groupCommentSkipped:{},groupCommentStatus:t("gi.commentResetDone")}).then(()=>sendResponse({ok:true}));
      return true;
    } else if(msg.action==="startFeedScoped"){
      startFeedScoped(msg.source,msg).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message||String(error)}));
      return true;
    } else if(msg.action==="stopFeedScoped"){
      stopFeedScoped(msg.source).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message||String(error)}));
      return true;
    } else if(msg.action==="resetFeedScoped"){
      resetFeedScoped(msg.source).then(()=>sendResponse({ok:true})).catch(error=>sendResponse({ok:false,error:error.message||String(error)}));
      return true;
    } else if(msg.action==="startFeedInteract"){
      if(isFeedInteracting){ sendResponse({ok:false}); return true; }
      feedTarget=parseInt(msg.target)||20;
      feedMinDelay=(parseInt(msg.minDelay)||3)*1000;
      feedMaxDelay=(parseInt(msg.maxDelay)||8)*1000;
      feedReaction=msg.reaction||"random";
      chrome.storage.local.set({ isFeedInteracting:true });
      feedInteractLoop();
      sendResponse({ok:true});
    } else if(msg.action==="stopFeedInteract"){
      isFeedInteracting=false;
      chrome.storage.local.set({ isFeedInteracting:false, feedStatus:t("p.stoppedX") });
      chrome.storage.local.remove(["pendingFeedInteract","pendingFeedConfig"]);
      sendResponse({ok:true});
    } else if(msg.action==="resetFeedInteract"){
      resetFeed(); sendResponse({ok:true});
    } else if(msg.action==="startAIComment"){
      if(isAICommenting){ sendResponse({ok:false}); return true; }
      aiTarget=parseInt(msg.target)||10;
      setAiDelayRange(msg.minDelay,msg.maxDelay);
      aiTypingConfig=msg.typingConfig?normalizeAiTypingConfig(msg.typingConfig):aiTypingConfig;
      aiEconomyMode=msg.economyMode||"balanced";aiBatchSize=Math.max(2,Math.min(1000,parseInt(msg.batchSize)||5));aiCacheDays=Math.max(0,parseInt(msg.cacheDays)||7);aiTagConfig=msg.tagConfig||null;aiRunProfile=(msg.aiConfig&&typeof msg.aiConfig==="object")?msg.aiConfig:{};aiBasePrompt=String(msg.prompt||"");aiRunMode=["comment-like","like","comment"].includes(msg.mode)?msg.mode:"comment";aiLikeAfterComment=aiRunMode==="comment-like";aiReactionPref=String(msg.reaction||"like");
      chrome.storage.local.get("aiCount").then(saved=>{
        aiCount=Math.max(0,parseInt(saved.aiCount)||0);
        if(aiCount>=aiTarget)aiCount=0;
        chrome.storage.local.set({ isAICommenting:true,aiNextAllowedAt:0,aiFeedReloadAttempts:0 });
        aiCommentLoop(aiCount>0);
        sendResponse({ok:true,resumed:aiCount>0,aiCount});
      }).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    } else if(msg.action==="stopAIComment"){
      isAICommenting=false;
      void cleanupAICommentComposer(undefined,undefined,"Dừng");
      chrome.storage.local.set({ isAICommenting:false, aiStatus:t("p.stoppedX"),aiActiveConfig:null,aiNextAllowedAt:0,pendingAIComment:false,aiFeedReloadAttempts:0 });
      sendResponse({ok:true});
    } else if(msg.action==="resetAIComment"){
      resetAI(); sendResponse({ok:true});
    }
    return true;
  });

  // tu dong tiep tuc sau khi redirect tu popup
  (async ()=>{
    const p = await chrome.storage.local.get(["pendingFeedInteract","pendingFeedConfig","isFeedInteracting","pendingAIComment","pendingAIConfig","groupInteractActive","groupInteractConfig","groupInteractIndex","groupCommentActive","groupCommentConfig","groupCommentIndex","groupPostActive","groupPostConfig","groupPostIndex","isAICommenting","aiActiveConfig","aiCount","aiNextAllowedAt","aiHeartbeat",...feedScopeList.flatMap(scope=>feedScopeStateKeys(scope))]);
    // Loop Comment AI chết bất thường (exception/treo await): cờ vẫn true,
    // status đóng băng, heartbeat quá 5 phút mà không có pending resume.
    // Chốt dừng an toàn thay vì treo mãi.
    try{
      const hbAge=p.aiHeartbeat?.at?Date.now()-p.aiHeartbeat.at:Infinity;
      if(p.isAICommenting&&!p.pendingAIComment&&hbAge>5*60*1000){
        const owner=p.aiActiveConfig?.ownerTabId;
        let mine=true;
        try{mine=await runOwnedByThisTab(owner);}catch(_){mine=true;}
        if(mine){
          await chrome.storage.local.set({isAICommenting:false,aiStatus:t("ai2.stalledSafe")});
          return;
        }
      }
    }catch(_){}
    // Phiên nhóm đang chạy nhưng tab không ở route nhóm (vd: reload rớt ra
    // ngoài, người dùng chuyển trang): tự về đúng nhóm rồi tiếp tục.
    const groupTaskUrl=(cfgKey,indexKey)=>{
      try{
        const cfg=p[cfgKey],groups=cfg&&cfg.groups;
        if(!groups||!groups.length)return "";
        const index=Math.min(Math.max(0,parseInt(p[indexKey])||0),groups.length-1);
        return groups[index].url||"";
      }catch{return "";}
    };
    if(p.groupPostActive && (await runOwnedByThisTab(p.groupPostConfig&&p.groupPostConfig.ownerTabId))){
      if(location.href.includes("facebook.com/groups/")){await sleep(1000);continueGroupPost();}
      else{const targetUrl=groupTaskUrl("groupPostConfig","groupPostIndex");if(targetUrl)location.assign(targetUrl);}
    }
    if(p.groupInteractActive && (await runOwnedByThisTab(p.groupInteractConfig&&p.groupInteractConfig.ownerTabId))){
      if(location.href.includes("facebook.com/groups/")){
        await sleep(1200);
        continueGroupInteraction();
      }
      else{const targetUrl=groupTaskUrl("groupInteractConfig","groupInteractIndex");if(targetUrl)location.assign(targetUrl);}
    }
    if(p.groupCommentActive && (await runOwnedByThisTab(p.groupCommentConfig&&p.groupCommentConfig.ownerTabId))){
      if(location.href.includes("facebook.com/groups/")){await sleep(1200);continueGroupComment();}
      else{const targetUrl=groupTaskUrl("groupCommentConfig","groupCommentIndex");if(targetUrl)location.assign(targetUrl);}
    }
    for(const scope of feedScopeList){
      const config=p[scope.configKey]||p[scope.pendingConfigKey];
      if(!p[scope.activeKey]||!config||!(await runOwnedByThisTab(config.ownerTabId))||!location.href.includes("facebook.com"))continue;
      const runtime={...config,config,runId:String(p[scope.runIdKey]||config.runId||""),count:Math.max(0,parseInt(p[scope.countKey])||0),aiCount:Math.max(0,parseInt(p[scope.aiCountKey])||0),active:true,aiSkippedKeys:new Set()};
      feedScopedRuntimes.set(scope.id,runtime);
      if(!feedScopeRouteMatches(location.href,scope)){
        await feedScopeWritePending(scope,runtime,t("p.fdOpening"));
        location.assign(feedScopeUrl(scope));
        return;
      }
      await sleep(1800);
      if(await feedScopeIsAlive(scope,runtime))void feedScopedLoop(scope,runtime).finally(()=>{if(feedScopedRuntimes.get(scope.id)===runtime)feedScopedRuntimes.delete(scope.id);});
      break;
    }
    const hasScopedFeedRun=feedScopeList.some(scope=>p[scope.activeKey]===true);
    if(!hasScopedFeedRun && p.pendingFeedInteract && p.pendingFeedConfig && p.isFeedInteracting===true && (await runOwnedByThisTab(p.pendingFeedConfig.ownerTabId)) && location.href.includes("facebook.com")){
      if(!isMainFacebookFeed()){ location.href="https://www.facebook.com/"; return; }
      const cfg = p.pendingFeedConfig;
      feedTarget = parseInt(cfg.target)||20;
      feedMinDelay = (parseInt(cfg.minDelay)||3)*1000;
      feedMaxDelay = (parseInt(cfg.maxDelay)||8)*1000;
      feedReaction = cfg.reaction||"random";
      chrome.storage.local.remove(["pendingFeedInteract","pendingFeedConfig"]);
      await sleep(2500);
      if(!isFeedInteracting){ isFeedInteracting=true; chrome.storage.local.set({ isFeedInteracting:true }); feedInteractLoop(); }
    }
    if(p.pendingAIComment && p.pendingAIConfig && p.isAICommenting!==false && (await runOwnedByThisTab(p.pendingAIConfig.ownerTabId)) && location.href.includes("facebook.com")){
      const cfg = p.pendingAIConfig;
      aiRunProfile=(cfg.aiConfig&&typeof cfg.aiConfig==="object")?cfg.aiConfig:aiRunProfile;
      aiBasePrompt=String(cfg.prompt||aiBasePrompt||"");aiTagConfig=cfg.tagConfig||aiTagConfig||null;
      aiLikeAfterComment=cfg.mode==="comment-like";
      aiTarget = parseInt(cfg.target)||10;
      setAiDelayRange(cfg.minDelay,cfg.maxDelay);
      aiTypingConfig=cfg.typingConfig?normalizeAiTypingConfig(cfg.typingConfig):aiTypingConfig;
      aiEconomyMode=cfg.economyMode||"balanced";aiRunMode=cfg.mode==="comment-like"||cfg.mode==="like"?cfg.mode:"comment";aiLikeAfterComment=aiRunMode==="comment-like";aiReactionPref=String(cfg.reaction||"like");aiBatchSize=Math.max(2,Math.min(1000,parseInt(cfg.batchSize)||5));aiCacheDays=Math.max(0,parseInt(cfg.cacheDays)||7);
      chrome.storage.local.remove(["pendingAIComment","pendingAIConfig"]);
      await sleep(2500);
      aiCount=parseInt(p.aiCount)||0;
      if(aiCount>=aiTarget)aiCount=0;
      if(!isMainFacebookFeed()){await navigateAIToMainFeed();return;}
      // DỪNG BẰNG MỌI GIÁ: thoát ngay nếu cờ chạy đã tắt trong lúc chờ.
      while(Date.now()<(parseInt(p.aiNextAllowedAt)||0)){
        const aliveNow=await chrome.storage.local.get("isAICommenting");
        if(aliveNow.isAICommenting===false)return;
        const seconds=Math.max(1,Math.ceil(((parseInt(p.aiNextAllowedAt)||0)-Date.now())/1000));
        await chrome.storage.local.set({aiStatus:t("ai2.waitNext",{from:aiCount,to:aiTarget,secs:seconds})});
        await sleep(Math.min(1000,(parseInt(p.aiNextAllowedAt)||0)-Date.now()));
      }
      {
        const aliveNow=await chrome.storage.local.get("isAICommenting");
        if(aliveNow.isAICommenting===false)return;
      }
      if(!isAICommenting){ isAICommenting=true; chrome.storage.local.set({ isAICommenting:true }); aiCommentLoop(aiCount>0); }
    }else if(p.isAICommenting&&p.aiActiveConfig&&(await runOwnedByThisTab(p.aiActiveConfig.ownerTabId))){
      const cfg=p.aiActiveConfig;aiRunProfile=(cfg.aiConfig&&typeof cfg.aiConfig==="object")?cfg.aiConfig:aiRunProfile;aiBasePrompt=String(cfg.prompt||aiBasePrompt||"");aiTagConfig=cfg.tagConfig||aiTagConfig||null;aiRunMode=cfg.mode==="comment-like"||cfg.mode==="like"?cfg.mode:"comment";aiLikeAfterComment=aiRunMode==="comment-like";aiReactionPref=String(cfg.reaction||aiReactionPref||"like");aiTarget=parseInt(cfg.target)||10;setAiDelayRange(cfg.minDelay,cfg.maxDelay);aiTypingConfig=cfg.typingConfig?normalizeAiTypingConfig(cfg.typingConfig):aiTypingConfig;aiEconomyMode=cfg.economyMode||"balanced";aiBatchSize=parseInt(cfg.batchSize)||5;aiCacheDays=parseInt(cfg.cacheDays)||7;aiCount=parseInt(p.aiCount)||0;
      if(!isMainFacebookFeed()){await navigateAIToMainFeed();return;}
      await sleep(1800);if(!isAICommenting){isAICommenting=true;aiCommentLoop(true);}
    }
  })();

  console.log("[Feed] feed.js loaded v1.9.45");
  // Chia sẻ có kiểm soát cho content script khác (page.js Comment AI bằng
  // Page): chỉ 3 hàm thuần túy chọn/chèn @mention, không lộ state machine,
  // selector, counter hay proof của feed.
  try {
    globalThis.FbTagMention = { pickTagEntity, decideTagForPost, appendTagMention, logActivity, buildTagPrompt, postSigMarked, markPostSig, pickMentionOption, countNameSpans };
    // Lõi gửi/proof/nán dùng chung mọi luồng comment (page.js,
    // friendWarm/Reengage gọi qua đây để cùng một cơ chế với Bản tin & AI).
    globalThis.UnifiedComment = { sendProofDwell: unifiedSendProofDwell, proofSig: commentProofSig, proofExists: commentProofExists };
  } catch (_) {}
})();
