// group.js - Tham gia nhóm theo từ khoá + lọc thành viên + bài/ngày + tự trả lời câu hỏi
(() => {
  // Ghi log nhóm vừa tham gia thành công — dùng chung cho joinLoop và discoverLoop
  function logGroupJoined(name, url, keyword, extra={}){
    try{
      const m=String(url||"").match(/\/groups\/([^/?#]+)/i);
      if(!m||!name||name.length<2)return;
      const id=m[1];
      const today=new Date().toISOString().split("T")[0];
      chrome.storage.local.get(["joinedGroupsLog"]).then(r=>{
        const log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
        const kw=keyword||"";
        // Dedup theo (id + keyword): cùng nhóm cùng keyword thì skip, khác keyword thì cho thêm
        if(log.some(e=>e.id===id&&(e.keyword||"")===kw))return;
        const entry={id,name,url:`https://www.facebook.com/groups/${id}/`,keyword:kw,dateJoined:today};
        // Lưu câu hỏi + câu trả lời AI để review sau
        if(extra.hadQuestions) entry.hadQuestions=true;
        if(Array.isArray(extra.questions)&&extra.questions.length) entry.questions=extra.questions;
        if(Array.isArray(extra.answers)&&extra.answers.length) entry.answers=extra.answers;
        if(extra.aiUsed) entry.aiUsed=true;
        log.push(entry);
        chrome.storage.local.set({joinedGroupsLog:log}).catch(()=>{});
      }).catch(()=>{});
    }catch{}
  }
  // Lưu tạm câu hỏi + câu trả lời của lần autoAnswer gần nhất để logGroupJoined ghi lại
  let _lastJoinQA = null;
  // Sổ Q&A review sau (user duyệt): ghi ngay khi điền xong, không chờ submit
  // thành công — vì submit có thể được xác nhận ở nhánh direct (nút card) làm
  // mất Q&A như ca live 15/10 (AI đáp 2 nhóm, join ok cả 2 nhưng log trắng).
  function appendJoinQALog(entry){
    try{
      chrome.storage.local.get(["groupJoinQaLog"]).then(r=>{
        const log=Array.isArray(r.groupJoinQaLog)?r.groupJoinQaLog:[];
        log.push({at:Date.now(),submitted:false,...entry});
        chrome.storage.local.set({groupJoinQaLog:log.slice(-50)}).catch(()=>{});
      }).catch(()=>{});
    }catch{}
  }
  function markJoinQASubmitted(){
    try{
      chrome.storage.local.get(["groupJoinQaLog"]).then(r=>{
        const log=Array.isArray(r.groupJoinQaLog)?r.groupJoinQaLog:[];
        if(log.length){log[log.length-1].submitted=true;chrome.storage.local.set({groupJoinQaLog:log}).catch(()=>{});}
      }).catch(()=>{});
    }catch{}
  }
  let isJoining = false;
  let joinedCount = 0;
  let targetJoin = 10;
  let minMembers = 10000;
  let minPostsPerDay = 5;
  let minDelay = 5000, maxDelay = 15000;
  let autoAnswers = t("gj.answersDefault").split("\n");
  const defJoinAnswers=()=>t("gj.answersDefault").split("\n");
  let aiJoinEnabled=false,aiJoinPrompt="",aiJoinConfig={},aiJoinTypingConfig=null;
  // Hàng đợi nhiều từ khóa chạy nối tiếp 1 lượt (giống Page Join): mỗi entry
  // {keyword,target}. kwIndex = entry đang chạy, kwDone[i] = số nhóm đã join
  // ở entry i. Discover và config cũ 1 từ khóa đi đường list 1 phần tử.
  let kwQueue=[], kwIndex=0, kwDone=[];
  function normalizeNickKeywords(cfg){
    const out=[];
    if(Array.isArray(cfg?.keywords))for(const e of cfg.keywords){
      const kw=String(e?.keyword??e??"").trim();
      const tg=Math.max(1,Math.min(100000,parseInt(e?.target)||0));
      if(kw&&tg>0)out.push({keyword:kw.slice(0,120),target:tg});
      if(out.length>=1000)break;
    }
    if(!out.length&&String(cfg?.keyword||"").trim())out.push({keyword:String(cfg.keyword).trim().slice(0,120),target:Math.max(1,Math.min(100000,parseInt(cfg.targetJoin)||10))});
    return out;
  }
  function syncNickEntry(){
    const list=kwQueue.length?kwQueue:[{keyword:"",target:targetJoin}];
    const ix=Math.min(Math.max(0,kwIndex),list.length-1);
    kwIndex=ix;
    targetJoin=Math.max(1,parseInt(list[ix].target)||10);
    if(kwDone.length!==list.length)kwDone=list.map((_,i)=>Math.max(0,parseInt(kwDone[i])||0));
    return list[ix];
  }
  function kwTotal(){ return kwQueue.length?kwQueue.reduce((s,e)=>s+Math.max(1,parseInt(e.target)||0),0):targetJoin; }
  // Quota/done TÍNH THEO TỪNG TỪ KHÓA (không dùng joinedCount toàn cục so với
  // target từng entry — entry sau sẽ dừng sớm oan). Legacy 1 từ khóa: 2 số này
  // trùng nhau nên hành vi cũ giữ nguyên.
  function entryTarget(){ const e=kwQueue[kwIndex]; return Math.max(1,parseInt((e&&e.target)||targetJoin)||10); }
  function entryDone(){ return kwDone[kwIndex]||0; }
  function kwPrefix(){
    if(kwQueue.length<2)return "";
    return t("kj.kwPrefix",{i:kwIndex+1,n:kwQueue.length,kw:(kwQueue[kwIndex]||{}).keyword||""});
  }
  async function saveNickQueue(){
    try{
      const s=await chrome.storage.local.get(["groupJoinRunConfig"]);
      const base=s.groupJoinRunConfig||{};
      await chrome.storage.local.set({groupJoinRunConfig:{...base,keywords:kwQueue,keywordIndex:kwIndex,keywordDone:[...kwDone]}});
    }catch(_){}
  }
  // Sang từ khóa kế: lưu queue, hẹn resume qua pendingSearch*, điều hướng.
  // Hết danh sách thì false để caller dừng run.
  async function advanceNickKeyword(){
    if(kwIndex+1>=kwQueue.length)return false;
    kwIndex++;
    syncNickEntry();
    await saveNickQueue();
    const next=kwQueue[kwIndex];
    chrome.storage.local.set({pendingSearchJoin:true,pendingSearchKeyword:next.keyword,
      pendingSearchConfig:{minMembers,minPostsPerDay,targetJoin,minDelay,maxDelay,autoAnswers,confirmWaitSeconds:joinConfirmTimeout/1000,aiJoinEnabled,aiJoinPrompt,aiJoinConfig,typingConfig:aiJoinTypingConfig||undefined,keywords:kwQueue,keywordIndex:kwIndex,keywordDone:[...kwDone]},
      groupStatus:kwPrefix()+t("kj.searching",{kw:next.keyword})});
    location.href=`https://www.facebook.com/search/groups/?q=${encodeURIComponent(next.keyword)}`;
    return true;
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function randDelay(){ return Math.floor(Math.random()*(maxDelay-minDelay+1))+minDelay; }
  async function waitJoinDelay(){
    const until=Date.now()+randDelay();
    let lastShown=-1;
    while(true){
      if(!isJoining)return false;
      try{
        const live=await chrome.storage.local.get("isGroupJoining");
        if(!live.isGroupJoining){isJoining=false;return false;}
      }catch{return false;}
      const remaining=until-Date.now();
      if(remaining<=0)return true;
      const seconds=Math.max(1,Math.ceil(remaining/1000));
      if(seconds!==lastShown){
        lastShown=seconds;
        chrome.storage.local.set({groupStatus:t("kj.waitDelay",{s:seconds,from:joinedCount,to:targetJoin})});
      }
      await sleep(Math.min(500,remaining));
    }
  }
  // Chống 2 vòng lặp cùng chạy trên 1 tab (Start trực tiếp + resume sau reload
  // do điều hướng của chính Start đó — bắt live: joined 1 rồi rớt về 0 vì loop
  // thứ hai reset bộ đếm). Claim qua storage: ai tới sau thắng, ai tới trước
  // tự rút. Chỉ áp dụng cùng tab; khác tab đã có ownerTabId chặn.
  async function claimJoinLoop(){
    const key=`jf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    try{ await chrome.storage.local.set({groupJoinLoopClaim:{key,at:Date.now()}}); }catch(_){ return key; }
    await sleep(1200);
    try{
      const s=await chrome.storage.local.get(["groupJoinLoopClaim","isGroupJoining"]);
      if(!s.isGroupJoining)return null;
      if(s.groupJoinLoopClaim&&s.groupJoinLoopClaim.key!==key)return null;
    }catch(_){}
    return key;
  }
  // Quy tắc DỪNG BẰNG MỌI GIÁ + chống chạy trùng: phiên resume sau reload chỉ
  // được chạy trên đúng tab sở hữu (ownerTabId). Tab khác thấy cờ nhưng bỏ qua.
  async function runOwnedByThisTab(ownerTabId){
    if(!ownerTabId)return true;
    try{
      const r=await chrome.runtime.sendMessage({action:"getSenderTabId"});
      const myId=r&&r.tabId;
      return !myId||myId===ownerTabId;
    }catch{return true;}
  }
  const cleanText=value=>String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim();
  const isVisible=el=>{if(!el?.isConnected||el.offsetParent===null)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
  const isJoinActive=()=>isJoining||isDiscoverJoining;
  // Dùng chung personalActor.js (nạp trước trong manifest) — cùng isolated
  // world nên gọi trực tiếp; không nhân bản logic bộ chọn danh tính ở đây.
  const ensurePersonalActor=()=>window.ensurePersonalActor
    ?window.ensurePersonalActor()
    :Promise.resolve({ok:true});
  // Facebook đôi khi giữ aria-label cũ ("Tham gia nhóm …") trong khi
  // chữ hiển thị trên nút đã đổi sang "Truy cập vào nhóm". Ưu tiên phần
  // chữ đang nhìn thấy để xác nhận đúng trạng thái; chỉ dùng aria-label
  // khi nút không có text (ví dụ nút đóng hộp thoại).
  const labelOf=el=>cleanText(el?.innerText||el?.textContent||el?.getAttribute?.("aria-label"));
  // Facebook có lúc chỉ hiện "Truy cập" sau khi tham gia, có lúc hiện
  // "Truy cập vào nhóm"; cả hai đều là trạng thái thành công.
  const successJoinLabel=/(?:truy cập(?:\s+vào nhóm)?|visit group|đã tham gia|joined|đã gửi yêu cầu|request sent|hủy yêu cầu|cancel request|xem xét quyền tham gia|review (?:your )?(?:membership|join))/i;
  async function waitForCondition(predicate,timeout=3000){
    const end=Date.now()+timeout;
    while(Date.now()<end){
      if(!isJoinActive())return false;
      try{if(await predicate())return true;}catch{}
      await sleep(180);
    }
    return false;
  }
  async function clickGroupControl(el){
    if(!isJoinActive()||!isVisible(el)||el.matches?.('[aria-disabled="true"],:disabled'))return false;
    // inline:"center" là bắt buộc — trang Khám phá xếp thẻ nhóm trong băng
    // chuyền NGANG, nút Tham gia nằm ngoài viewport theo chiều ngang nên chỉ
    // cuộn dọc thì elementFromPoint không bao giờ khớp và cú click bị bỏ.
    try{el.scrollIntoView({behavior:"instant",block:"center",inline:"center"});}catch{try{el.scrollIntoView({block:"center",inline:"center"});}catch{}}
    await sleep(220);
    // The popup writes the stop flag directly because a content-script
    // message can be lost during navigation. Re-read it immediately before
    // any join/checkbox/submit click so a stale local flag cannot act.
    try{
      const live=await chrome.storage.local.get(["isGroupJoining","isDiscoverJoining"]);
      if(!live.isGroupJoining&&!live.isDiscoverJoining)return false;
    }catch{return false;}
    const clickOnce=async()=>{
      if(!isJoinActive())return false;
      try{const live=await chrome.storage.local.get(["isGroupJoining","isDiscoverJoining"]);if(!live.isGroupJoining&&!live.isDiscoverJoining)return false;}catch{return false;}
      const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
      const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===el||el.contains(hit)||hit.contains(el))){
        try{const trusted=await chrome.runtime.sendMessage({action:"trustedMouse",kind:"click",x,y});if(trusted?.ok)return true;}catch{}
      }
      try{el.click();return true;}catch{return false;}
    };
    // Nút Tham gia/Gửi có tác dụng phụ; tuyệt đối không bấm lần hai khi
    // Facebook chỉ phản hồi chậm, nếu không có thể gửi/cancel hai lần.
    // Chỉ trả về việc click đã được phát đi. Việc chờ dialog/trạng thái
    // được thực hiện riêng để phản hồi chậm không làm bỏ qua nhóm.
    return clickOnce();
  }
  function isMembershipReviewText(value){
    const text=cleanText(value).toLocaleLowerCase("vi");
    // Facebook có nhiều biến thể tiêu đề cho cùng một dialog. Đặc biệt,
    // một số nhóm hiện chỉ hiển thị "Trả lời câu hỏi" và thông báo
    // "Yêu cầu tham gia của bạn đang chờ phê duyệt", không còn chữ
    // "Câu hỏi dành cho người tham gia" như phiên bản cũ.
    return /trả lời (?:các )?câu hỏi|hãy trả lời những câu hỏi|yêu cầu tham gia của bạn đang chờ(?:\s+phê duyệt|\s+duyệt)?|câu hỏi dành cho người tham gia|membership questions|answer (?:the )?questions|gửi yêu cầu tham gia|xem xét quyền tham gia|review (?:your )?(?:membership|join)|review membership|your membership request is pending|quy tắc nhóm|group rules|điều khoản(?:\s+tham gia)?|chào mừng bạn đến với nhóm|welcome to the group|trước khi tham gia|before you join|nội quy nhóm|community guidelines|yêu cầu thành viên/i.test(text);
  }
  function visibleMembershipDialog(){
    const dialogs=[...document.querySelectorAll('div[role="dialog"],[aria-modal="true"]')].filter(isVisible);
    // Ưu tiên dialog khớp label rõ ràng
    const byLabel=dialogs.find(d=>isMembershipReviewText(d.innerText?.slice(0,600)||d.getAttribute("aria-label")||""));
    if(byLabel)return byLabel;
    // Fallback: dialog có checkbox hoặc textarea + nút Gửi/Tiếp (có thể FB dùng text khác)
    return dialogs.find(d=>{
      const hasInput=d.querySelector('input[type="checkbox"],[role="checkbox"],textarea,input[type="text"],[role="textbox"]');
      if(!hasInput)return false;
      return [...d.querySelectorAll('button,[role="button"]')].some(b=>isVisible(b)&&/gửi|send|tiếp|next|tham gia|join|submit|hoàn tất|done|xác nhận|confirm/i.test(labelOf(b)));
    });
  }
  async function closeMembershipDialog(){
    const d=visibleMembershipDialog();if(!d)return true;
    const close=[...d.querySelectorAll('[aria-label],div[role="button"],button')].find(b=>isVisible(b)&&/^(đóng|close)$/i.test(labelOf(b)));
    if(!close)return false;
    if(!await clickGroupControl(close))return false;
    return await waitForCondition(()=>!visibleMembershipDialog(),3500);
  }
  // FB đôi khi hiện dialog "Xin chào!" (giới thiệu bản thân) không có ô
  // nhập nào — visibleMembershipDialog() bỏ qua vì bắt buộc phải có input.
  // Phát hiện + đóng riêng để dialog này không chặn luồng tham gia.
  function findGroupGreetingDialog(){
    const dialogs=[...document.querySelectorAll('div[role="dialog"],[aria-modal="true"]')].filter(isVisible);
    return dialogs.find(d=>{
      const text=cleanText(d.innerText||d.textContent||d.getAttribute("aria-label")||"");
      if(!/xin\s*chào|giới thiệu bản thân/i.test(text))return false;
      return [...d.querySelectorAll('[aria-label],div[role="button"],button')].some(b=>isVisible(b)&&/^(bỏ qua|skip|không,?\s*cảm ơn|không|đóng|close)$/i.test(labelOf(b)));
    })||null;
  }
  async function dismissGroupGreetingDialog(){
    for(let attempt=0;attempt<3;attempt++){
      const dialog=findGroupGreetingDialog();
      if(!dialog)return true;
      const btns=[...dialog.querySelectorAll('[aria-label],div[role="button"],button')];
      const btn=btns.find(b=>isVisible(b)&&/^(bỏ qua|skip|không,?\s*cảm ơn|không)$/i.test(labelOf(b)))
        ||btns.find(b=>isVisible(b)&&/^(đóng|close)$/i.test(labelOf(b)));
      if(!btn)break;
      if(!await clickGroupControl(btn))break;
      await waitForCondition(()=>!findGroupGreetingDialog(),3500);
      if(!findGroupGreetingDialog())return true;
      await sleep(300);
    }
    return !findGroupGreetingDialog();
  }
  // Facebook can leave a request in a transient state for noticeably longer
  // than a normal DOM rerender.  This is deliberately a single post-click
  // wait: never click the Join control again while it is pending. The user
  // can configure the wait in seconds; old runs without this field keep 90s.
  const DEFAULT_JOIN_CONFIRM_SECONDS=90;
  const MIN_JOIN_CONFIRM_SECONDS=5;
  const MAX_JOIN_CONFIRM_SECONDS=3600;
  let joinConfirmTimeout=DEFAULT_JOIN_CONFIRM_SECONDS*1000;
  function normalizeJoinConfirmTimeout(value){
    const seconds=Number.parseInt(value,10);
    const safe=Number.isFinite(seconds)?seconds:DEFAULT_JOIN_CONFIRM_SECONDS;
    return Math.min(MAX_JOIN_CONFIRM_SECONDS,Math.max(MIN_JOIN_CONFIRM_SECONDS,safe))*1000;
  }
  async function waitForJoinConfirmation(button,container,timeout=joinConfirmTimeout,href="",initialLabel="",statusKey="",groupName=""){
    // Dùng nhãn chụp trước cú bấm. Facebook đôi khi đổi nút sang
    // "Truy cập" trước khi hàm xác nhận bắt đầu chạy.
    const initialButton=cleanText(initialLabel||labelOf(button));
    const end=Date.now()+timeout;
    let detachedAt=0;
    let lastReported=-1;
    let lateQuestionHandled=false;
    while(Date.now()<end){
      if(!isJoinActive())return false;
      const elapsed=Math.max(0,Math.floor((timeout-(end-Date.now()))/1000));
      // A 700ms poll rarely lands on an exact 5-second boundary. Report the
      // highest elapsed 5-second bucket instead of requiring `elapsed % 5`
      // to be zero, otherwise the visible status can freeze at 30/90.
      const reported=Math.floor(elapsed/5)*5;
      if(statusKey&&reported>lastReported){
        lastReported=reported;
        chrome.storage.local.set({[statusKey]:t("gq.waitJoinProof",{name:groupName||t("kj.groupAny"),seconds:reported,max:Math.ceil(timeout/1000)})});
      }
      // Dialog "Xin chào!" không có ô nhập có thể che nút xác nhận — đóng
      // ngay để không chờ hết timeout một cách vô ích.
      if(findGroupGreetingDialog()){
        await dismissGroupGreetingDialog();
        await sleep(300);
        continue;
      }
      // A membership dialog can arrive after the initial short dialog wait.
      // Handle it once here so a slow Facebook response still gets the same
      // AI/question flow, without ever re-clicking the original Join button.
      if(visibleMembershipDialog()){
        if(!lateQuestionHandled){
          lateQuestionHandled=true;
          const answered=await autoAnswerGroupQuestions(groupName,button);
          if(!answered&&visibleMembershipDialog())return false;
        }
        await sleep(500);
        continue;
      }
      // React có thể thay toàn bộ card sau khi gửi yêu cầu. Tìm lại card
      // theo URL nhóm để không mất tín hiệu thành công khi node cũ detached.
      let currentContainer=container;
      if((!currentContainer||!currentContainer.isConnected)&&href){
        const link=[...document.querySelectorAll('a[href*="/groups/"]')].find(a=>a.href.split("?")[0]===href);
        currentContainer=link?.closest('div[role="article"],div[data-pagelet]')||link?.parentElement?.parentElement||link?.parentElement||null;
      }
      const liveButtons=[];
      if(button?.isConnected)liveButtons.push(button);
      if(currentContainer?.isConnected)liveButtons.push(...currentContainer.querySelectorAll('button,[role="button"],a'));
      const buttonText=liveButtons.map(labelOf).find(text=>successJoinLabel.test(text)&&text!==initialButton);
      if(buttonText)return true;
      // Một số thẻ bị Facebook gỡ khỏi DOM ngay sau khi gửi yêu cầu thay vì
      // đổi nhãn nút. Nếu đã có URL nhóm và nút cũ bị detach, chờ một nhịp
      // ngắn để loại trừ rerender rồi coi đó là xác nhận thành công.
      if(href&&button&&!button.isConnected){
        if(!detachedAt)detachedAt=Date.now();
        const liveLink=[...document.querySelectorAll('a[href*="/groups/"]')].find(a=>a.href.split("?")[0]===href);
        if(!liveLink&&Date.now()-detachedAt>=1800)return true;
      }else if(button?.isConnected){
        detachedAt=0;
      }
      await sleep(700);
    }
    return false;
  }

  function questionForInput(inp,idx){
    const labelled=inp.getAttribute("aria-label")||inp.getAttribute("placeholder")||"";
    if(labelled&&!/trả lời|answer|viết câu trả lời|write an answer/i.test(labelled))return labelled.trim();
    const currentVal=cleanText(inp.value||inp.innerText||inp.textContent||"");
    // Check aria-label on parent elements (FB often wraps the question in a parent div)
    let p=inp.parentElement;
    for(let i=0;i<8&&p;i++,p=p.parentElement){
      const al=(p.getAttribute("aria-label")||"").trim();
      if(al&&al.length>5&&al.length<400&&!/trả lời|answer|viết câu trả lời|write an answer/i.test(al)&&al!==currentVal)return al;
    }
    // Walk siblings going up the tree
    let node=inp;
    for(let level=0;level<14&&node;level++,node=node.parentElement){
      // Check previous siblings for heading/label/span text
      let prev=node.previousElementSibling;
      while(prev){
        const text=(prev.innerText||prev.textContent||"").trim().replace(/\s+/g," ");
        if(text.length>5&&text.length<400
          &&!/viết câu trả lời|write an answer/i.test(text)
          &&text!==currentVal)
          return text;
        prev=prev.previousElementSibling;
      }
      // Also check if current parent has a heading/label child
      if(node.parentElement){
        const heading=node.parentElement.querySelector('[role="heading"],label,legend,h1,h2,h3,h4,strong');
        if(heading){
          const ht=(heading.innerText||heading.textContent||"").trim().replace(/\s+/g," ");
          if(ht.length>5&&ht.length<400&&!/viết câu trả lời|write an answer/i.test(ht)&&ht!==currentVal)return ht;
        }
      }
    }
    return t("kj.qFallback",{n:idx+1});
  }
  function isConsentQuestion(question){
    const text=cleanText(question).toLocaleLowerCase("vi");
    return /(?:đồng ý|đồng tình|chấp nhận|cam kết|tuân thủ|quy tắc|nội quy|quy định|không quảng cáo|không spam|không bán hàng|không đăng bài|không mua bán|không làm phiền|giữ sạch|ra về|rác|tôn trọng thành viên)/i.test(text);
  }
  // Bộ tính biểu thức số học VIẾT TAY (tokenizer + recursive descent) — thay
  // hẳn cơ chế eval động trước đây (2.11.8): chỉ nhận số thập phân, + - * / % ^ (**),
  // ngoặc và dấu cộng/trừ đơn; ký tự lạ hoặc biểu thức hỏng -> ném lỗi để
  // caller trả null. Ngữ pháp: expr := term (('+'|'-') term)* ;
  // term := unary (('*'|'/'|'%') unary)* ; unary := ('-'|'+') unary | power ;
  // power := primary (('**'|'^') unary)? — luỹ thừa kết hợp phải, mũ âm được;
  // primary := số | '(' expr ')'.
  function evalMathExpr(src){
    const s=String(src||"");
    const tokens=[];
    let i=0;
    while(i<s.length){
      const ch=s[i];
      if(ch===" "||ch==="\t"){i++;continue;}
      if((ch>="0"&&ch<="9")||ch==="."){
        let j=i,dot=false;
        while(j<s.length&&((s[j]>="0"&&s[j]<="9")||s[j]===".")){
          if(s[j]==="."){if(dot)throw new Error("bad-number");dot=true;}
          j++;
        }
        const num=Number(s.slice(i,j));
        if(!isFinite(num))throw new Error("bad-number");
        tokens.push({k:"num",v:num});
        i=j;continue;
      }
      if(ch==="*"&&s[i+1]==="*"){tokens.push({k:"op",v:"**"});i+=2;continue;}
      if("+-*/%^()".includes(ch)){tokens.push({k:"op",v:ch});i++;continue;}
      throw new Error("bad-token");
    }
    let pos=0;
    const peek=()=>tokens[pos];
    const next=()=>tokens[pos++];
    function parseExpr(){
      let v=parseTerm();
      while(peek()&&peek().k==="op"&&(peek().v==="+"||peek().v==="-")){
        const op=next().v;const rhs=parseTerm();
        v=op==="+"?v+rhs:v-rhs;
      }
      return v;
    }
    function parseTerm(){
      let v=parseUnary();
      while(peek()&&peek().k==="op"&&(peek().v==="*"||peek().v==="/"||peek().v==="%")){
        const op=next().v;const rhs=parseUnary();
        v=op==="*"?v*rhs:op==="/"?v/rhs:v%rhs;
      }
      return v;
    }
    function parseUnary(){
      const tk=peek();
      if(tk&&tk.k==="op"&&(tk.v==="-"||tk.v==="+")){next();const v=parseUnary();return tk.v==="-"?-v:v;}
      return parsePower();
    }
    function parsePower(){
      const base=parsePrimary();
      const tk=peek();
      if(tk&&tk.k==="op"&&(tk.v==="**"||tk.v==="^")){next();const exp=parseUnary();return Math.pow(base,exp);}
      return base;
    }
    function parsePrimary(){
      const tk=next();
      if(!tk)throw new Error("eof");
      if(tk.k==="num")return tk.v;
      if(tk.k==="op"&&tk.v==="("){
        const v=parseExpr();
        const close=next();
        if(!close||close.k!=="op"||close.v!==")")throw new Error("no-close");
        return v;
      }
      throw new Error("bad-primary");
    }
    const result=parseExpr();
    if(pos!==tokens.length)throw new Error("trailing");
    return result;
  }
  // Giải câu hỏi toán CAPTCHA → trả về chuỗi kết quả hoặc null nếu không phải toán
  function solveMathCaptcha(question){
    const text=cleanText(question).replace(/\s+/g," ");
    // Dạng 1: biểu thức số trực tiếp: "2 + 9 = ??" hoặc "(3+2)*4=?"
    const m1=text.match(/(\(?\d[\d\s()+\-\*×xX÷/:^%]*\)?\s*[+\-\*×xX÷/:^%]\s*[\d\s()+\-\*×xX÷/:^%]*\d)\s*[=＝]\s*[?？*…\._]{1,4}/);
    if(m1){
      try{
        const expr=m1[1].replace(/[×xX]/g,"*").replace(/[÷]/g,"/").replace(/\^/g,"**").replace(/\s+/g,"");
        // Vá kèm (2.11.8): bản cũ thay ** bằng "X" rồi kiểm theo bảng ký tự
        // không có X -> MỌI biểu thức luỹ thừa đều bị loại oan (trả null).
        // Nay gộp ** về * khi kiểm và cho phép ^; evalMathExpr vẫn là cổng
        // kiểm cuối (tokenizer loại mọi ký tự lạ).
        if(!/^[\d+\-*/().%^]+$/.test(expr.replace(/\*\*/g,"*")))return null;
        const result=evalMathExpr(expr);
        if(typeof result!=="number"||!isFinite(result))return null;
        return String(Math.round(result*1000)/1000);
      }catch{/* fall through */}
    }
    // Dạng 2: word-form tiếng Việt: "bao nhiêu là 3 cộng 5" / "3 cộng 5 bằng bao nhiêu"
    const w=text.replace(/cộng/gi,"+").replace(/trừ/gi,"-").replace(/nhân/gi,"*").replace(/chia/gi,"/").replace(/bằng\s*(?:bao\s+nhiêu|mấy)?/gi,"=").replace(/bao\s*nhiêu/gi,"?");
    const m2=w.match(/(\d+)\s*([+\-\*\/]\s*\d+(?:\s*[+\-\*\/]\s*\d+)*)\s*[=＝]\s*[?？]/);
    if(m2){
      try{
        const expr=(m2[1]+m2[2]).replace(/\s+/g,"");
        if(!/^[\d+\-*/().]+$/.test(expr))return null;
        const result=evalMathExpr(expr);
        if(typeof result!=="number"||!isFinite(result))return null;
        return String(Math.round(result*1000)/1000);
      }catch{return null;}
    }
    return null;
  }
  // Kiểm tra câu hỏi có phải dạng toán (để gửi AI giải nếu solveMathCaptcha không xử lý được)
  function looksLikeMath(question){
    const t=cleanText(question);
    return /\d+\s*[+\-\*×xX÷/:=<>]\s*\d+/.test(t)||/(?:cộng|trừ|nhân|chia|bằng mấy|bằng bao nhiêu|tính|kết quả|phép tính)/i.test(t);
  }
  // Câu hỏi invite bạn bè - không cần AI, trả lời canned
  function isInviteQuestion(text){
    return /(?:mời\s+(?:thêm\s+)?bạn\s+bè|mời\s+người\s+thân|invite\s+(?:your\s+)?friends|tag\s+bạn\s+bè)/i.test(text);
  }
  // LUỒNG TRẢ LỜI CÂU HỎI XIN VÀO NHÓM (2.11.8 — ĐẢO THỨ TỰ theo lệnh Dũng):
  // Luồng 1: AI qua API là luồng CHÍNH — khi bật AI, MỌI câu hỏi đều gửi AI
  // trước, kể cả câu toán và câu đồng ý nội quy (bản cũ loại câu toán giải
  // được local khỏi đường AI — cổng lọc đó đã bỏ hẳn).
  // Luồng 2 (dự phòng khi AI tắt / thiếu key / lỗi / từ chối / thiếu đáp án):
  // cannedAnswerForQuestion — tự tính câu toán -> câu mẫu mời bạn bè / đồng ý
  // nội quy / mục đích -> xoay vòng câu mẫu của người dùng (giữ nguyên như cũ).
  // Nhận diện đáp án AI dạng TỪ CHỐI / lộ thân phận AI -> coi như không có
  // đáp án để rơi xuống luồng 2 (background còn chặn thêm 1 lớp khi parse).
  // Mẫu bắt thận trọng: "I can't wait to join" hay "không thể đến offline"
  // KHÔNG dính vì các nhánh từ chối đều đòi động từ help/answer/provide hoặc
  // giúp/trả lời/cung cấp/hỗ trợ đi kèm.
  function isJoinAiRefusal(answer){
    const a=String(answer||"").trim();
    if(!a)return true;
    if(/as an ai\b|as a language model|i'?m an ai\b|i am an ai\b/i.test(a))return true;
    if(/(?:tôi|mình) là (?:một )?(?:ai|trí tuệ nhân tạo|mô hình ngôn ngữ|trợ lý ảo)\b/i.test(a))return true;
    if(/^(?:i'?m sorry|sorry|xin lỗi|rất tiếc|thật tiếc)\b[^]{0,60}?\b(?:cannot|can'?t|unable|không thể)\b/i.test(a))return true;
    if(/\b(?:i cannot|i can'?t|i am unable|i'?m unable)\s+(?:help|answer|provide|assist|do that)\b/i.test(a))return true;
    if(/\b(?:tôi|mình) không thể (?:giúp|trả lời|cung cấp|hỗ trợ)\b/i.test(a))return true;
    return false;
  }
  function cannedAnswerForQuestion(question,index){
    const text=cleanText(question).toLocaleLowerCase("vi");
    // Toán CAPTCHA: "2 + 9 = ??" → "11"
    const math=solveMathCaptcha(question);
    if(math!==null)return math;
    // Câu invite bạn bè → trả lời ngắn
    if(isInviteQuestion(text))return "Tôi sẽ cố gắng ạ";
    if(isConsentQuestion(text))return autoAnswers[0]||defJoinAnswers()[0];
    if(/(?:mục đích|lý do|mong muốn|tham gia để|đóng góp|bạn sẽ làm gì|what.*join|why.*join)/i.test(text))return autoAnswers[1]||defJoinAnswers()[1];
    return autoAnswers[index % Math.max(1,autoAnswers.length)]||autoAnswers[0]||defJoinAnswers()[0];
  }
  function isMembershipCheckboxChecked(box){
    if(!box)return false;
    if(box.matches?.('input[type="checkbox"]'))return !!box.checked;
    const aria=box.getAttribute?.("aria-checked");
    if(aria!=null)return aria.toLowerCase()==="true";
    const data=box.getAttribute?.("data-checked");
    if(data!=null)return data.toLowerCase()==="true";
    return box.getAttribute?.("aria-pressed")==="true";
  }
  function membershipCheckboxTarget(box){
    if(!box)return null;
    if(box.matches?.('input[type="checkbox"]')){
      const label=box.closest("label");
      if(label)return label;
    }
    return box.closest?.('[role="checkbox"],label')||box;
  }
  function membershipCheckboxLabel(box){
    const aria=box.getAttribute("aria-label")||"";
    if(aria)return aria.trim();
    const lbl=box.closest("label");
    if(lbl)return (lbl.innerText||lbl.textContent||"").trim();
    let node=box.parentElement;
    for(let i=0;i<4&&node;i++,node=node.parentElement){
      const t=(node.innerText||node.textContent||"").trim();
      if(t.length>2&&t.length<200)return t;
    }
    return "";
  }
  function isAgreeCheckbox(box){
    const label=membershipCheckboxLabel(box).toLowerCase();
    if(!label)return true; // không xác định được → tick để an toàn
    const disagree=/không đồng ý|không chấp nhận|từ chối|không tham gia|không tuân thủ|disagree|decline|reject|no i don't|không muốn/i;
    return !disagree.test(label);
  }
  async function selectMembershipCheckboxes(dialog){
    // Checkbox của Facebook có thể là input ẩn nằm trong label hoặc một
    // div[role=checkbox]. Quét lại sau mỗi lượt click để không giữ node cũ
    // khi React thay DOM. Chỉ tích checkbox "đồng ý", bỏ "không đồng ý".
    for(let pass=0;pass<8;pass++){
      if(!isJoinActive())return false;
      const current=visibleMembershipDialog()||dialog;
      const boxes=[...current.querySelectorAll('input[type="checkbox"],[role="checkbox"]')];
      // Chỉ tích các checkbox "agree"
      const toCheck=boxes.filter(box=>isAgreeCheckbox(box)&&!isMembershipCheckboxChecked(box));
      if(!toCheck.length)return true;
      for(const box of toCheck){
        const target=membershipCheckboxTarget(box);
        let clicked=false;
        if(target&&isVisible(target))clicked=await clickGroupControl(target);
        if(!clicked){try{(target||box).click();clicked=true;}catch{}}
        await sleep(350);
      }
      await sleep(500);
    }
    // Sau 8 pass đã click tất cả agree-checkbox, chấp nhận dù aria-checked
    // chưa cập nhật (React-controlled component không sync DOM ngay)
    return true;
  }
  async function autoAnswerGroupQuestions(groupName="",triggerButton=null,activeStorageKey="isGroupJoining"){
    _lastJoinQA = null; // reset mỗi lần gọi
    // Dialog hỏi thành viên có thể xuất hiện trễ, nhưng không nên cộng thêm
    // 24 giây cho mọi nhóm không có câu hỏi. Chờ tối đa khoảng 11 giây;
    // nếu nút đã đổi trạng thái thì thoát ngay để áp dụng delay cấu hình.
    for(let tries=0; tries<16; tries++){
      if(!isJoinActive())return false;
      await sleep(700);
      const dialog=visibleMembershipDialog();
      if(!dialog){
        // Không có câu hỏi và nút đã đổi sang trạng thái thành công thì
        // chuyển ngay sang bước xác nhận, tránh chờ đủ 20 giây vô ích.
        if(triggerButton&&successJoinLabel.test(labelOf(triggerButton)))return false;
        continue;
      }
      chrome.storage.local.set({groupStatus:t("gq.reviewing",{name:groupName||t("kj.groupSel")})});
      // Một số nhóm mở màn hình "Xem xét quyền tham gia" với checkbox quy
      // tắc thay vì ô câu hỏi. Chọn tất cả checkbox trước khi điền câu hỏi;
      // nếu không tích đủ thì dừng an toàn, không bấm Gửi khi Facebook chưa
      // nhận lựa chọn.
      const checkboxesOk=await selectMembershipCheckboxes(dialog);
      if(!checkboxesOk){
        chrome.storage.local.set({groupStatus:t("gq.notEnoughChecks",{name:groupName||t("kj.groupAny")})});
        return false;
      }
      // Checkbox có thể làm React dựng lại phần nội dung dialog; lấy lại
      // dialog hiện tại trước khi giữ các ô nhập câu trả lời.
      const currentDialog=visibleMembershipDialog()||dialog;
      const inputs = [...currentDialog.querySelectorAll('textarea, input[type="text"], [role="textbox"]')].filter(inp=>isVisible(inp)&&!inp.disabled&&inp.getAttribute("aria-disabled")!=="true");
      const questions=inputs.map(questionForInput);
      const answers=Array(inputs.length).fill("");
      // Luồng 1 (2.11.8): AI bật -> MỌI câu hỏi đều qua AI trước (kể cả câu
      // toán + đồng ý nội quy); câu nào AI không trả được/từ chối thì vòng
      // điền bên dưới tự rơi xuống luồng 2 (canned) như cũ.
      const aiIndexes=questions.map((_,index)=>index);
      if(aiJoinEnabled&&aiIndexes.length){
        const aiQuestions=aiIndexes.map(index=>questions[index]);
        chrome.storage.local.set({groupStatus:t("gq.aiThinking",{n:aiQuestions.length,name:groupName||t("kj.groupSel")})});
        chrome.storage.local.set({groupAiUsage:t("gq.aiWriting",{n:aiQuestions.length,name:groupName||t("kj.groupSel")})});
        try{
          const ai=await chrome.runtime.sendMessage({action:"aiAnswerJoinQuestions",groupName:groupName||document.title,questions:aiQuestions,prompt:aiJoinPrompt,aiConfig:aiJoinConfig});
          if(ai?.ok){
            (ai.answers||[]).slice(0,aiIndexes.length).forEach((answer,index)=>{
              const a=String(answer||"").trim().slice(0,500);
              // Đáp án rỗng/từ chối/lộ thân phận AI -> bỏ trống để luồng 2 lo.
              answers[aiIndexes[index]]=isJoinAiRefusal(a)?"":a;
            });
          }else console.warn("[Group AI]",ai?.error);
        }catch(e){console.warn("[Group AI]",e);}
        const missing=aiIndexes.filter(index=>!answers[index]);
        if(missing.length){
          // AI thiếu câu trả lời → dùng câu mẫu (canned) thay vì bỏ qua nhóm
          missing.forEach(index=>{ answers[index]=cannedAnswerForQuestion(questions[index],index); });
          chrome.storage.local.set({groupAiUsage:t("gq.aiShort",{from:aiIndexes.length-missing.length,to:aiIndexes.length,name:groupName||t("kj.groupAny")})});
        }
        chrome.storage.local.set({groupAiUsage:t("gq.aiReady",{n:aiIndexes.length,name:groupName||t("kj.groupSel")})});
      }else if(aiIndexes.length){
        // AI tắt: mọi câu hỏi đi thẳng luồng 2 (canned) ở vòng điền bên dưới.
        chrome.storage.local.set({groupAiUsage:t("gq.aiOff",{n:aiIndexes.length,name:groupName||t("kj.groupSel")})});
      }
      let filled=0;
      for(let idx=0;idx<inputs.length;idx++){
        if(!isJoinActive())return false;
        const inp=inputs[idx];
        const ans = answers[idx]||cannedAnswerForQuestion(questions[idx],idx);
        try{
          inp.scrollIntoView({block:"center"});inp.click();inp.focus();document.execCommand("selectAll",false,null);
          const typed=await chrome.runtime.sendMessage({action:"trustedInput",text:ans,pressEnter:false,typingConfig:aiJoinTypingConfig||undefined,abortStorageKey:activeStorageKey});
          if(!typed?.ok)throw new Error(typed?.error||t("gq.typeFail"));
          // trustedInput báo ok → đếm là đã điền; không đọc lại .value vì
          // React-controlled textarea không sync DOM value ngay sau insertText
          filled++;
        }catch(e){ console.warn("[Group] dien cau hoi loi",e); }
      }
      // Chỉ fail nếu có input nhưng không gõ được bất kỳ câu nào
      if(inputs.length&&filled===0){chrome.storage.local.set({groupStatus:t("gq.notFilled",{from:filled,to:inputs.length,name:groupName||t("kj.groupAny")})});return false;}
      let submitBtn = null;
      // Facebook đôi khi cập nhật trạng thái nút Gửi trễ hơn lần nhập cuối.
      // Chờ ngắn và tìm lại trong dialog hiện tại thay vì bỏ qua ngay.
      for(let buttonTry=0;buttonTry<12&&!submitBtn;buttonTry++){
        const liveDialog=visibleMembershipDialog()||dialog;
        const btns = [...liveDialog.querySelectorAll('div[role="button"], button, [role="button"]')];
        for(const b of btns){
          const t=labelOf(b).toLowerCase();
          if(/^(?:gửi|gửi yêu cầu|gửi yêu cầu tham gia|gui|send|submit|hoàn tất|done|tham gia nhóm|join group|yêu cầu tham gia|đồng ý|tôi đồng ý|đồng ý với quy tắc|tôi đồng ý với quy tắc nhóm|chấp nhận|xác nhận|tiếp|tiếp tục|continue|next)$/i.test(t)){
            if(isVisible(b)&&b.getAttribute("aria-disabled")!=="true"&&!b.disabled) { submitBtn = b; break; }
          }
        }
        if(!submitBtn)await sleep(350);
      }
      if(submitBtn){
        await sleep(600);
        const clicked=await clickGroupControl(submitBtn);
        if(clicked){
          const beforeDialogText=cleanText((visibleMembershipDialog()||currentDialog).innerText||"");
          const changed=await waitForCondition(()=>{
            const live=visibleMembershipDialog();
            return !live||!submitBtn.isConnected||submitBtn.getAttribute("aria-disabled")==="true"||cleanText(live.innerText||"")!==beforeDialogText;
          },8000);
          if(!visibleMembershipDialog()){
            console.log("[Group] Auto tra loi + bam Gui");
            _lastJoinQA={questions,answers,aiUsed:aiJoinEnabled&&aiIndexes.length>0};
            await sleep(700);return true;
          }
          // "Tiếp/Tiếp tục" can advance from the rules screen to the
          // questions screen. Re-scan the new dialog instead of treating the
          // first step as a completed membership request.
          if(changed){await sleep(700);continue;}
        }
        chrome.storage.local.set({groupStatus:t("gq.noSendBtn",{name:groupName||t("kj.groupAny")})});
        return false;
      }
      chrome.storage.local.set({groupStatus:t("gq.sendNotReady",{name:groupName||t("kj.groupAny")})});
      return false;
    }
    return false;
  }

  function parseNumber(str){
    if(!str) return 0;
    str = str.toLowerCase().replace(/,/g,".").trim();
    let m = str.match(/([\d\.]+)\s*([km]?)/);
    if(!m) return parseInt(str.replace(/\D/g,""))||0;
    let num = parseFloat(m[1]);
    let unit = m[2];
    if(unit==="k") num*=1000;
    if(unit==="m") num*=1000000;
    return Math.round(num);
  }

  function groupNameFromCard(container,href,fallbackLink){
    const links=[...(container?.querySelectorAll?.('a[href*="/groups/"]')||[])]
      .filter(link=>link.href.split("?")[0]===href);
    for(const link of links){
      const name=cleanText(link.innerText||link.textContent||"");
      if(name&&name.length<=120&&!successJoinLabel.test(name))return name;
    }
    const aria=cleanText(fallbackLink?.getAttribute?.("aria-label")||"")
      .replace(/^ảnh đại diện của\s+/i,"").trim();
    return aria||href;
  }

  function findGroupJoinControl(container){
    if(!container)return null;
    const controls=[...container.querySelectorAll('button,[role="button"],a[role="button"]')];
    return controls.find(control=>/^(?:tham gia(?:\s+nhóm)?|join(?:\s+group)?)(?:\s|$)/i.test(labelOf(control)))||null;
  }

  function extractGroupCards(){
    const candidates = [];
    document.querySelectorAll('a[href*="/groups/"]').forEach(a=>{
      const href = a.href.split("?")[0];
      if(!href.match(/\/groups\/\d+|\/groups\/[^\/]+\/?$/)) return;
      const card = a.closest('div[data-visualcompletion="ignore-dynamic"], div[role="article"], div') || a.parentElement;
      let container = a.closest('div[data-pagelet], div[role="article"]');
      if(!container) container = card.parentElement ? card.parentElement.parentElement : card;
      if(!container) return;
      if(container.dataset.groupParsed==="1") return;
      const txt = (container.innerText || "").toLowerCase();
      if(!txt.includes("thành viên") && !txt.includes("member")) return;
      let memberText = "";
      const memMatch = (container.innerText || "").match(/([\d\.,]+[KkMm]?)\s*(thành viên|member)/i);
      if(memMatch) memberText = memMatch[0];
      let members = parseNumber(memberText);
      let postsPerDay = 0;
      const txtOrig = container.innerText || "";
      let postMatch = txtOrig.match(/(\d+)\+?\s*bài viết\/?\s*(ngày|một ngày|day)/i);
      if(postMatch) postsPerDay = parseInt(postMatch[1]);
      else {
        postMatch = txtOrig.match(/(\d+)\+?\s*posts?\s*(a day|per day|\/day)/i);
        if(postMatch) postsPerDay = parseInt(postMatch[1]);
        else {
          const alt = txtOrig.match(/(\d+)\s*bài viết/i);
          if(alt) postsPerDay = parseInt(alt[1]) > 50 ? 10 : parseInt(alt[1]);
        }
      }
      const joinBtn=findGroupJoinControl(container);
      const joinedTxt = txt.includes("đã tham gia") || txt.includes("joined") || txt.includes("đã gửi yêu cầu") || txt.includes("request sent");
      if(joinedTxt) return;
      container.dataset.groupParsed="1";
      candidates.push({ container, href, name:groupNameFromCard(container,href,a).slice(0,120), members, memberText, postsPerDay, joinBtn, rawText: txtOrig.slice(0,300) });
    });
    return candidates;
  }

  function isPassFilter(g){
    return g.members >= minMembers && (minPostsPerDay===0 || g.postsPerDay >= minPostsPerDay || g.postsPerDay===0);
  }

  async function joinLoop(keyword, restoredJoined){
    try{
    syncNickEntry();
    keyword=(kwQueue[kwIndex]||{}).keyword||keyword;
    if(!location.href.includes("/search/groups")){
      chrome.storage.local.set({ pendingSearchJoin: true, pendingSearchKeyword: keyword, pendingSearchConfig: { minMembers, minPostsPerDay, targetJoin, minDelay, maxDelay, autoAnswers,confirmWaitSeconds:joinConfirmTimeout/1000,aiJoinEnabled,aiJoinPrompt,aiJoinConfig,typingConfig:aiJoinTypingConfig||undefined,keywords:kwQueue,keywordIndex:kwIndex,keywordDone:[...kwDone] } });
      const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`;
      location.href = url;
      return;
    }
    const actor = await ensurePersonalActor();
    if (!actor.ok) {
      chrome.storage.local.set({ isGroupJoining: false, groupStatus: t("gj.actingAsPage", { name: actor.page }) });
      return;
    }
    if (actor.switched) {
      // Trang hiện tại đã render theo danh tính Page; phải tải lại để danh sách
      // nhóm và nút Tham gia thuộc đúng ngữ cảnh trang cá nhân.
      chrome.storage.local.set({
        pendingSearchJoin: true, pendingSearchKeyword: keyword,
        pendingSearchConfig: { minMembers, minPostsPerDay, targetJoin, minDelay, maxDelay, autoAnswers, confirmWaitSeconds: joinConfirmTimeout/1000, aiJoinEnabled, aiJoinPrompt, aiJoinConfig, typingConfig: aiJoinTypingConfig||undefined, keywords: kwQueue, keywordIndex: kwIndex, keywordDone: [...kwDone] },
        groupStatus: t("gj.switchedToPersonal")
      });
      location.replace(`https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`);
      return;
    }
    chrome.storage.local.remove(["pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
    isJoining = true;
    joinedCount = Math.max(0,parseInt(restoredJoined)||0);
    chrome.storage.local.set({ groupStatus: restoredJoined?kwPrefix()+t("kj.resumed",{kw:keyword,from:joinedCount,to:targetJoin}):kwPrefix()+t("kj.searching",{kw:keyword}), groupJoined:joinedCount, groupFound:0,groupAiUsage:t("gq.aiWaiting") });
    let idle=0;
    let seenHrefs = new Set();
    let totalFound=0;
    let endStatus="";
    while(isJoining && entryDone() < entryTarget()){
      const cards = extractGroupCards();
      const filtered = cards.filter(c=>{ if(seenHrefs.has(c.href)) return false; seenHrefs.add(c.href); return isPassFilter(c); });
      totalFound += filtered.length;
      chrome.storage.local.set({ groupFound: totalFound, groupStatus: `Tim thay ${totalFound} nhom dat tieu chi, da tham gia ${joinedCount}/${targetJoin}` });
      filtered.forEach(g=>{ if(g.joinBtn) g.joinBtn.style.outline="2px dashed #1877F2"; if(g.container) g.container.style.outline="1px solid #00c851"; });
      for(const g of filtered){
        if(!isJoining || entryDone() >= entryTarget()) break;
        const live=await chrome.storage.local.get("isGroupJoining");
        if(!live.isGroupJoining){isJoining=false;break;}
        if(!g.joinBtn||!isVisible(g.joinBtn)||!g.joinBtn.isConnected) continue;
        try{
          // scrollIntoView/sleep nay nam trong try: neu bi throw giua chung
          // thi loi duoc bat per-candidate thay vi thoat ca vong lap ngoai.
          g.joinBtn.scrollIntoView({behavior:"smooth", block:"center", inline:"center"});
          await sleep(800);
          const beforeJoinLabel=labelOf(g.joinBtn);
          const clicked=await clickGroupControl(g.joinBtn);
          if(!clicked){chrome.storage.local.set({groupStatus:t("kj.noJoinBtn",{name:g.name})});continue;}
          await dismissGroupGreetingDialog();
          const answered = await autoAnswerGroupQuestions(g.name,g.joinBtn,"isGroupJoining");
          if(!answered&&visibleMembershipDialog()){chrome.storage.local.set({groupStatus:t("kj.notEnoughAnswers",{name:g.name})});await closeMembershipDialog();await sleep(700);continue;}
          // Khi answered=true: form đã submit xong → ghi nhận ngay, không chờ nút card đổi
          if(answered){
            joinedCount++;
            kwDone[kwIndex]=(kwDone[kwIndex]||0)+1;
            logGroupJoined(g.name, g.href, keyword, _lastJoinQA ? {hadQuestions:true, questions:_lastJoinQA.questions, answers:_lastJoinQA.answers, aiUsed:_lastJoinQA.aiUsed} : {});
            chrome.storage.local.set({ groupJoined: joinedCount, groupStatus: kwPrefix()+t("kj.confirmedAnswered",{from:joinedCount,to:targetJoin,name:g.name,members:g.memberText||""}) });
            console.log(`[Group] Join confirmed (answered) ${joinedCount}/${targetJoin}`);
          }else{
            // Không có dialog → tham gia thẳng → chờ nút card xác nhận
            chrome.storage.local.set({groupStatus:t("kj.waitConfirm",{name:g.name})});
            let confirmed=await waitForJoinConfirmation(g.joinBtn,g.container,joinConfirmTimeout,g.href,beforeJoinLabel,"groupStatus",g.name);
            if(!confirmed&&isJoining&&g.joinBtn?.isConnected&&isVisible(g.joinBtn)&&!successJoinLabel.test(labelOf(g.joinBtn))){
              // Thu lai mot lan (bam lai + cho lai) truoc khi bo qua han nhom nay.
              // Chi thu lai khi nhan nut chua chuyen sang trang thai thanh cong/huy —
              // bam lai luc do co the huy mot yeu cau da gui thanh cong.
              if(await clickGroupControl(g.joinBtn)){
                confirmed=await waitForJoinConfirmation(g.joinBtn,g.container,joinConfirmTimeout,g.href,beforeJoinLabel,"groupStatus",g.name);
              }
            }
            if(!confirmed){
              chrome.storage.local.set({groupStatus:t("kj.unconfirmed",{name:g.name})});
              if(!await waitJoinDelay())break;
              continue;
            }
            joinedCount++;
            kwDone[kwIndex]=(kwDone[kwIndex]||0)+1;
            logGroupJoined(g.name, g.href, keyword);
            chrome.storage.local.set({ groupJoined: joinedCount, groupStatus: kwPrefix()+`Da gui yeu cau ${joinedCount}/${targetJoin}: ${g.name} (${g.memberText})` });
            console.log(`[Group] Join confirmed (direct) ${joinedCount}/${targetJoin}`);
          }
        }catch(e){ console.warn("[Group] click loi",e); await closeMembershipDialog().catch(()=>{}); }
        if(entryDone() >= entryTarget()) break;
        if(!await waitJoinDelay())break;
      }
      if(entryDone() >= entryTarget()){
        // Đủ quota từ khóa này → sang từ khóa kế (hết thì dừng, tổng toàn lượt).
        if(await advanceNickKeyword())return;
        endStatus=kwPrefix()+t("kj.doneTarget",{from:joinedCount,to:kwTotal()});break;
      }
      const before = document.body.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(2500);
      if(document.body.scrollHeight === before){ idle++; if(idle>=3){
        // Hết nhóm ở từ khóa này nhưng còn từ khóa sau → sang tiếp thay vì dừng.
        if(await advanceNickKeyword())return;
        endStatus=kwPrefix()+t("kj.outOfGroups",{from:joinedCount,to:kwTotal(),n:totalFound}); break;
      } } else idle=0;
      if(filtered.length===0){ idle++; if(idle>=4){
        if(await advanceNickKeyword())return;
        endStatus=kwPrefix()+t("kj.noNew",{from:joinedCount,to:kwTotal()});break;
      } }
    }
    if(!isJoining&&!endStatus)endStatus=kwPrefix()+t("kj.stoppedAt",{from:joinedCount,to:kwTotal()});
    if(!endStatus&&joinedCount>=kwTotal())endStatus=kwPrefix()+t("kj.doneTarget",{from:joinedCount,to:kwTotal()});
    if(!endStatus)endStatus=kwPrefix()+t("kj.endedAt",{from:joinedCount,to:kwTotal()});
    isJoining=false;
    chrome.storage.local.set({ groupStatus:endStatus, groupJoined: joinedCount, isGroupJoining:false });
    chrome.storage.local.remove(["groupJoinRunConfig","pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
    }catch(error){
      // Trước đây không có catch: một lỗi bất ngờ sẽ thoát vòng lặp mà
      // không tắt cờ isGroupJoining, khiến busy-check ở startGroupJoin chặn
      // vĩnh viễn các lần Start sau trên tab này.
      console.warn("[GroupJoin]",error);
      await chrome.storage.local.set({ isGroupJoining:false, groupStatus:"Lỗi: "+String(error?.message||error||"") });
    }finally{
      isJoining=false; // in-memory guard, ALWAYS reset
    }
  }

  function applySearchRunConfig(cfg={}){
    targetJoin=parseInt(cfg.targetJoin)||10;
    minMembers=parseInt(cfg.minMembers)||10000;
    minPostsPerDay=parseInt(cfg.minPostsPerDay)||0;
    minDelay=(parseInt(cfg.minDelay)||5)*1000;
    maxDelay=(parseInt(cfg.maxDelay)||15)*1000;
    joinConfirmTimeout=normalizeJoinConfirmTimeout(cfg.confirmWaitSeconds);
    if(cfg.answers && Array.isArray(cfg.answers) && cfg.answers.length>0){
      autoAnswers = cfg.answers;
    } else if(cfg.answersText!==undefined){
      autoAnswers = String(cfg.answersText||"").split("\n").map(s=>s.trim()).filter(Boolean);
      if(autoAnswers.length===0)autoAnswers=[defJoinAnswers()[0]];
    }
    aiJoinEnabled=!!cfg.aiJoinEnabled;aiJoinPrompt=cfg.aiJoinPrompt||"";aiJoinConfig=cfg.aiConfig||{};aiJoinTypingConfig=cfg.typingConfig?normalizeAiTypingConfig(cfg.typingConfig):null;
    kwQueue=normalizeNickKeywords(cfg);
    kwIndex=Math.max(0,parseInt(cfg.keywordIndex)||0);
    if(kwIndex>=kwQueue.length)kwIndex=0;
    kwDone=Array.isArray(cfg.keywordDone)?cfg.keywordDone.map(v=>Math.max(0,parseInt(v)||0)):[];
    syncNickEntry();
    kwDone=[...kwQueue.map((_,i)=>Math.max(0,parseInt(kwDone[i])||0))];
  }

  function resetGroup(){
    isJoining=false;
    joinedCount=0;
    document.querySelectorAll('[data-group-parsed="1"]').forEach(el=>{ delete el.dataset.groupParsed; el.style.outline=""; });
    chrome.storage.local.set({ groupStatus:t("kj.resetDone"), groupJoined:0, groupFound:0, isGroupJoining:false });
    chrome.storage.local.remove(["discoverGroups","discoverIndex","groupJoinRunConfig","pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
  }

  // ===== THAM GIA THEO KHAM PHA (Goi y khac) =====
  let isDiscoverJoining = false;
  let discoverJoined = 0;
  let discoverTarget = 10;
  let discoverMinDelay = 5000, discoverMaxDelay = 15000;
  const DISCOVER_URL = "https://www.facebook.com/groups/discover";
  const isDiscoverPage = ()=>/^\/groups\/discover\/?$/i.test(location.pathname);
  let discoverRouteGuardTimer=0;
  let discoverRedirecting=false;
  function discoverRunConfig(){
    return {
      target: discoverTarget,
      minDelay: discoverMinDelay/1000,
      maxDelay: discoverMaxDelay/1000,
      confirmWaitSeconds: joinConfirmTimeout/1000,
      answersText: autoAnswers.join("\n"),
      aiJoinEnabled,
      aiJoinPrompt,
      aiConfig: aiJoinConfig,
      typingConfig: aiJoinTypingConfig||undefined
    };
  }
  function applyDiscoverConfig(cfg={}){
    discoverTarget = Math.max(1,parseInt(cfg.target)||10);
    discoverMinDelay = Math.max(1,parseInt(cfg.minDelay)||5)*1000;
    discoverMaxDelay = Math.max(discoverMinDelay,Math.max(1,parseInt(cfg.maxDelay)||15)*1000);
    joinConfirmTimeout=normalizeJoinConfirmTimeout(cfg.confirmWaitSeconds);
    if(cfg.answersText!==undefined){
      autoAnswers = String(cfg.answersText||"").split("\n").map(s=>s.trim()).filter(Boolean);
      if(autoAnswers.length===0)autoAnswers=[defJoinAnswers()[0]];
    }
    aiJoinEnabled=!!cfg.aiJoinEnabled;
    aiJoinPrompt=cfg.aiJoinPrompt||"";
    aiJoinConfig=cfg.aiConfig||{};
    aiJoinTypingConfig=cfg.typingConfig?normalizeAiTypingConfig(cfg.typingConfig):null;
  }
  async function requestDiscoverReturn(){
    if(!isDiscoverJoining||isDiscoverPage())return isDiscoverPage();
    if(discoverRedirecting)return false;
    discoverRedirecting=true;
    const config=discoverRunConfig();
    try{
      await chrome.storage.local.set({
        pendingDiscoverJoin:true,
        pendingDiscoverConfig:config,
        discoverRunConfig:config,
        isDiscoverJoining:true,
        discoverStatus:t("dj.back",{from:discoverJoined,to:discoverTarget})
      });
      if(isDiscoverJoining&&!isDiscoverPage())location.replace(DISCOVER_URL);
    }catch(_){
      discoverRedirecting=false;
    }
    return false;
  }
  function startDiscoverRouteGuard(){
    if(discoverRouteGuardTimer)return;
    discoverRouteGuardTimer=setInterval(()=>{
      if(!isDiscoverJoining){clearDiscoverRouteGuard();return;}
      if(!isDiscoverPage())requestDiscoverReturn();
    },800);
  }
  function clearDiscoverRouteGuard(){
    if(discoverRouteGuardTimer){clearInterval(discoverRouteGuardTimer);discoverRouteGuardTimer=0;}
    discoverRedirecting=false;
  }
  function randDiscoverDelay(){ return Math.floor(Math.random()*(discoverMaxDelay-discoverMinDelay+1))+discoverMinDelay; }

  async function waitDiscoverDelay(){
    const until=Date.now()+randDiscoverDelay();
    let lastShown=-1;
    while(true){
      if(!isDiscoverJoining)return false;
      try{
        const live=await chrome.storage.local.get("isDiscoverJoining");
        if(!live.isDiscoverJoining){isDiscoverJoining=false;return false;}
      }catch{return false;}
      const remaining=until-Date.now();
      if(remaining<=0)return true;
      const seconds=Math.max(1,Math.ceil(remaining/1000));
      if(seconds!==lastShown){
        lastShown=seconds;
        chrome.storage.local.set({discoverStatus:t("dj.waitDelay",{s:seconds,from:discoverJoined,to:discoverTarget})});
      }
      await sleep(Math.min(500,remaining));
    }
  }

  function discoverSuggestionsRoot(){
    const heading=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')].find(el=>/^(?:gợi ý khác|other suggestions|more suggestions|suggested groups)$/i.test(cleanText(el.innerText||el.textContent||"")));
    if(!heading)return null;
    // Facebook đặt heading và các card cùng một container. Lấy ancestor nhỏ
    // nhất thực sự có nút Tham gia, không quét cả trang /groups/discover
    // (vốn còn khu "Nhóm của bạn bè" ở phía trên).
    for(let node=heading.parentElement,depth=0;node&&depth<6;node=node.parentElement,depth++){
      const controls=[...node.querySelectorAll('button,[role="button"],a[role="button"]')];
      if(controls.some(control=>/^(?:tham gia(?:\s+nhóm)?|join(?:\s+group)?)(?:\s|$)/i.test(labelOf(control))))return node;
    }
    return null;
  }

  function discoverCardForButton(button,root){
    for(let node=button.parentElement,depth=0;node&&node!==root&&depth<10;node=node.parentElement,depth++){
      const text=cleanText(node.innerText||"");
      const link=[...node.querySelectorAll('a[href*="/groups/"]')].find(a=>a.href&&!/\/groups\/(?:discover|joins|feed)(?:\/|$)/i.test(a.href));
      if(link&&/(?:thành viên|members?)/i.test(text))return {container:node,link};
    }
    return {container:button.parentElement||button,link:null};
  }

  function extractDiscoverCards(){
    const candidates = [];
    const root=discoverSuggestionsRoot();
    if(!root)return candidates;
    // Chỉ quét controls trong khu "Gợi ý khác". Facebook có thể dùng div
    // role=button hoặc button thật tùy bản render, vì vậy không khóa theo tag.
    root.querySelectorAll('button,[role="button"],a[role="button"]').forEach(btn=>{
      if(!/^(?:tham gia(?:\s+nhóm)?|join(?:\s+group)?)(?:\s|$)/i.test(labelOf(btn))) return;
      if(btn.dataset.discoverParsed==="1") return;
      if(!isVisible(btn)) return;
      // bo nut da tham gia / da gui
      const card=discoverCardForButton(btn,root),container=card.container;
      const txt = (container?.innerText||"").toLowerCase();
      if(txt.includes("đã tham gia") || txt.includes("joined") || txt.includes("đã gửi")) return;
      const href=card.link?.href?.split("?")[0]||"";
      const name=href?groupNameFromCard(container,href,card.link).slice(0,120):"";
      btn.dataset.discoverParsed="1";
      candidates.push({ btn, href, name, container });
    });
    return candidates;
  }

  async function discoverLoop(resume=false){
    try{
    const config=discoverRunConfig();
    // Chỉ trang /groups/discover mới là nguồn dữ liệu của luồng Khám phá.
    // Nếu người dùng bấm về Bảng tin, vào nhóm khác hoặc mở URL Facebook
    // khác, giữ nguyên tiến độ rồi tự quay lại đúng trang này.
    if(!isDiscoverPage()){
      await requestDiscoverReturn();
      return;
    }
    const actor = await ensurePersonalActor();
    if (!actor.ok) {
      chrome.storage.local.set({ isDiscoverJoining: false, discoverStatus: t("gj.actingAsPage", { name: actor.page }) });
      return;
    }
    if (actor.switched) {
      // Trang Khám phá đang render theo danh tính Page — tải lại để các thẻ
      // nhóm thuộc đúng ngữ cảnh trang cá nhân rồi mới quét.
      chrome.storage.local.set({ discoverStatus: t("gj.switchedToPersonal") });
      location.replace("https://www.facebook.com/groups/discover");
      return;
    }
    if(resume){
      const saved=await chrome.storage.local.get(["discoverJoined","discoverRunConfig"]);
      if(saved.discoverRunConfig){applyDiscoverConfig(saved.discoverRunConfig);}
      discoverJoined=Math.max(0,parseInt(saved.discoverJoined)||0);
    }else{
      discoverJoined=0;
    }
    // Xóa cờ chờ chỉ sau khi đã vào đúng trang; runConfig vẫn được giữ để
    // khôi phục nếu người dùng rời trang lần nữa giữa chừng.
    await chrome.storage.local.set({
      discoverJoined,
      discoverRunConfig:discoverRunConfig(),
      isDiscoverJoining:true,
      discoverStatus:resume&&discoverJoined?t("dj.resumed",{from:discoverJoined,to:discoverTarget}):t("dj.joining")
    });
    chrome.storage.local.remove(["pendingDiscoverJoin","pendingDiscoverConfig"]);
    startDiscoverRouteGuard();
    let idle=0;
    let endStatus="";
    while(isDiscoverJoining && discoverJoined < discoverTarget){
      if(!isDiscoverPage()){
        await requestDiscoverReturn();
        return;
      }
      const cards = extractDiscoverCards();
      if(cards.length===0){
        idle++;
        // /groups/discover thường dựng heading trước, nhưng card "Gợi ý
        // khác" có thể về muộn 15–30 giây (đặc biệt sau route do lịch chạy
        // mở tab nền). Bốn lượt cũ chỉ chờ ~9 giây nên báo hết nhóm giả.
        // Chờ tối đa 18 lượt x 2,5 giây, vẫn polling Stop trong sleep ở các
        // bước sau và chỉ cuộn nhẹ định kỳ để kích hoạt lazy render.
        if(idle>=18){
          endStatus=t("dj.outOfGroups",{from:discoverJoined,to:discoverTarget});
          break;
        }
        chrome.storage.local.set({discoverStatus:t("dj.waitCards",{n:idle,max:18,from:discoverJoined,to:discoverTarget})});
        if(idle%3===0)window.scrollTo(0,document.body.scrollHeight);
        else window.scrollBy(0,700);
        await sleep(2500);
        continue;
      } else idle=0;

      for(const c of cards){
        if(!isDiscoverJoining || discoverJoined >= discoverTarget) break;
        if(!isDiscoverPage()){
          await requestDiscoverReturn();
          return;
        }
        if(!c.btn?.isConnected||!isVisible(c.btn))continue;
        try{
          // scrollIntoView/sleep nay nam trong try: neu bi throw giua chung
          // thi loi duoc bat per-candidate thay vi thoat ca vong lap ngoai.
          c.btn.scrollIntoView({behavior:"smooth", block:"center", inline:"center"});
          await sleep(700);
          const beforeJoinLabel=labelOf(c.btn);
          const clicked=await clickGroupControl(c.btn);
          if(!clicked){chrome.storage.local.set({discoverStatus:t("dj.noJoinBtn")});continue;}
          await dismissGroupGreetingDialog();
          const answered = await autoAnswerGroupQuestions(c.name||"",c.btn,"isDiscoverJoining");
          if(!answered&&visibleMembershipDialog()){chrome.storage.local.set({discoverStatus:t("dj.notEnoughAnswers")});await closeMembershipDialog();await sleep(700);continue;}
          if(answered){
            discoverJoined++;
            logGroupJoined(c.name||"", c.href, "khám phá");
            chrome.storage.local.set({ discoverJoined, discoverStatus: t("dj.confirmedAnswered",{from:discoverJoined,to:discoverTarget,name:c.name||t("kj.groupAny")}) });
            console.log(`[Discover] Join confirmed (answered) ${discoverJoined}/${discoverTarget}`);
          }else{
            chrome.storage.local.set({discoverStatus:t("dj.waitConfirm",{name:c.name||t("kj.groupAny"),from:discoverJoined+1,to:discoverTarget})});
            let confirmed=await waitForJoinConfirmation(c.btn,c.container,joinConfirmTimeout,c.href,beforeJoinLabel,"discoverStatus",c.name||t("kj.groupAny"));
            if(!confirmed&&isDiscoverJoining&&c.btn?.isConnected&&isVisible(c.btn)&&!successJoinLabel.test(labelOf(c.btn))){
              // Thu lai mot lan (bam lai + cho lai) truoc khi bo qua han nhom nay.
              // Chi thu lai khi nhan nut chua chuyen sang trang thai thanh cong/huy —
              // bam lai luc do co the huy mot yeu cau da gui thanh cong.
              if(await clickGroupControl(c.btn)){
                confirmed=await waitForJoinConfirmation(c.btn,c.container,joinConfirmTimeout,c.href,beforeJoinLabel,"discoverStatus",c.name||t("kj.groupAny"));
              }
            }
            if(!confirmed){
              chrome.storage.local.set({discoverStatus:t("dj.unconfirmed",{name:c.name||t("kj.groupAny")})});
              if(!await waitDiscoverDelay())break;
              continue;
            }
            discoverJoined++;
            logGroupJoined(c.name||"", c.href, "khám phá");
            chrome.storage.local.set({ discoverJoined, discoverStatus: `Da tham gia ${discoverJoined}/${discoverTarget}: ${c.name||t("kj.groupAny")}` });
            console.log(`[Discover] Join confirmed (direct) ${discoverJoined}/${discoverTarget}`);
          }
        }catch(e){ console.warn(e); await closeMembershipDialog().catch(()=>{}); }
        if(discoverJoined >= discoverTarget) break;
        if(!await waitDiscoverDelay())break;
      }
      if(discoverJoined >= discoverTarget) break;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(2200);
    }
    if(!isDiscoverJoining&&!endStatus)endStatus=t("dj.stoppedAt",{from:discoverJoined,to:discoverTarget});
    if(!endStatus&&discoverJoined>=discoverTarget)endStatus=t("dj.doneTarget",{from:discoverJoined,to:discoverTarget});
    if(!endStatus)endStatus=t("dj.endedAt",{from:discoverJoined,to:discoverTarget});
    isDiscoverJoining=false;
    clearDiscoverRouteGuard();
    chrome.storage.local.set({ isDiscoverJoining:false, discoverStatus:endStatus });
    chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);
    }catch(error){
      // Trước đây không có catch: một lỗi bất ngờ sẽ thoát vòng lặp mà
      // không tắt cờ isDiscoverJoining lẫn route-guard, khiến setInterval
      // cứ ép điều hướng về /groups/discover mãi mãi.
      console.warn("[Discover]",error);
      await chrome.storage.local.set({ isDiscoverJoining:false, discoverStatus:"Lỗi: "+String(error?.message||error||"") });
    }finally{
      isDiscoverJoining=false; // in-memory guard, ALWAYS reset
      clearDiscoverRouteGuard();
    }
  }

  function resetDiscover(){
    isDiscoverJoining=false;
    clearDiscoverRouteGuard();
    discoverJoined=0;
    document.querySelectorAll('[data-discover-parsed="1"]').forEach(el=>{ delete el.dataset.discoverParsed; el.style.outline=""; });
    chrome.storage.local.set({ discoverJoined:0, discoverStatus:t("dj.resetDone"), isDiscoverJoining:false });
    chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);
  }

  // Direct storage Stop/Reset is authoritative even when the tab missed the
  // broadcast message or Facebook is still rendering a dialog.
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.isGroupJoining?.newValue===false)isJoining=false;
    if(changes.isDiscoverJoining?.newValue===false){isDiscoverJoining=false;clearDiscoverRouteGuard();}
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
    if(msg.action==="startGroupJoin"){
      if(isJoining||isDiscoverJoining){ sendResponse({ok:false, msg:t("kj.busy"), code:"join-busy"}); return true; }
      applySearchRunConfig(msg);
      chrome.storage.local.set({ isGroupJoining:true });
      sendResponse({ok:true});
      // Claim chống đúp loop với resume-block sau reload (không await ở trên
      // để popup nhận phản hồi ngay như cũ).
      (async()=>{
        const claim=await claimJoinLoop();
        if(!claim)return;
        try{
          const live=await chrome.storage.local.get("isGroupJoining");
          if(!live.isGroupJoining)return;
        }catch{return;}
        if(isJoining||isDiscoverJoining)return; // resume đã vào trước → nhường
        joinLoop(msg.keyword);
      })();
      return true;
    } else if(msg.action==="startDiscoverJoin"){
      if(isDiscoverJoining||isJoining){ sendResponse({ok:false, msg:t("kj.busy"), code:"join-busy"}); return true; }
      // Storage là nguồn để resume sau điều hướng, còn cờ nội bộ quyết định
      // vòng lặp đang sống trong document hiện tại. Phải bật cả hai trước
      // discoverLoop(); nếu chỉ ghi storage, while(isDiscoverJoining) sẽ kết
      // thúc ngay trên lượt Start trực tiếp từ popup hoặc scheduler.
      isDiscoverJoining=true;
      discoverJoined=0;
      discoverTarget = parseInt(msg.target)||10;
      discoverMinDelay = (parseInt(msg.minDelay)||5)*1000;
      discoverMaxDelay = (parseInt(msg.maxDelay)||15)*1000;
      joinConfirmTimeout=normalizeJoinConfirmTimeout(msg.confirmWaitSeconds);
      if(msg.answersText){
        autoAnswers = msg.answersText.split("\n").map(s=>s.trim()).filter(Boolean);
        if(autoAnswers.length===0) autoAnswers = [defJoinAnswers()[0]];
      }
      aiJoinEnabled=!!msg.aiJoinEnabled;aiJoinPrompt=msg.aiJoinPrompt||"";aiJoinConfig=msg.aiConfig||{};aiJoinTypingConfig=msg.typingConfig?normalizeAiTypingConfig(msg.typingConfig):null;
      const runConfig=discoverRunConfig();
      runConfig.ownerTabId=(sender&&sender.tab&&sender.tab.id)||msg.ownerTabId||0;
      chrome.storage.local.set({ isDiscoverJoining:true,discoverJoined:0,discoverRunConfig:runConfig,discoverStatus:t("dj.starting",{n:discoverTarget}) });
      discoverLoop(false);
      sendResponse({ok:true});
    } else if(msg.action==="stopGroupJoin"){
      isJoining=false;
      chrome.storage.local.set({ isGroupJoining:false, groupStatus:t("p.stoppedX") });
      chrome.storage.local.remove(["groupJoinRunConfig","pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
      sendResponse({ok:true});
    } else if(msg.action==="stopDiscoverJoin"){
      isDiscoverJoining=false;
      clearDiscoverRouteGuard();
      chrome.storage.local.set({ isDiscoverJoining:false, discoverStatus:t("p.stoppedX") });
      chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);
      sendResponse({ok:true});
    } else if(msg.action==="resetGroupJoin"){
      resetGroup();
      sendResponse({ok:true});
    } else if(msg.action==="resetDiscoverJoin"){
      resetDiscover();
      sendResponse({ok:true});
    } else if(msg.action==="getGroupStatus"){
      sendResponse({isJoining, joinedCount});
    } else if(msg.action==="getDiscoverStatus"){
      sendResponse({isDiscoverJoining, discoverJoined});
    }
    return true;
  });

  // Tự khôi phục luồng Khám phá sau mọi điều hướng. Không chỉ kiểm tra
  // /groups: /groups/{id}, /home và các trang Facebook khác đều phải quay
  // lại /groups/discover nếu phiên đang hoạt động.
  (async ()=>{
    const p = await chrome.storage.local.get(["pendingDiscoverJoin","pendingDiscoverConfig","isDiscoverJoining","discoverRunConfig","discoverJoined"]);
    const cfg=p.discoverRunConfig||p.pendingDiscoverConfig||(p.isDiscoverJoining?{target:10,minDelay:5,maxDelay:15,answersText:"",aiJoinEnabled:false,aiJoinPrompt:"",aiConfig:{},typingConfig:null}:null);
    if(p.isDiscoverJoining&&cfg){
      if(!(await runOwnedByThisTab(cfg.ownerTabId)))return;
      applyDiscoverConfig(cfg);
      discoverJoined=Math.max(0,parseInt(p.discoverJoined)||0);
      isDiscoverJoining=true;
      if(!isDiscoverPage()){
        await requestDiscoverReturn();
        return;
      }
      await sleep(1800);
      if(isDiscoverJoining)discoverLoop(true);
    }else if(p.pendingDiscoverJoin&&p.pendingDiscoverConfig&&isDiscoverPage()){
      // Tương thích với các phiên cũ chỉ lưu pendingDiscoverConfig.
      if(!(await runOwnedByThisTab(p.discoverRunConfig&&p.discoverRunConfig.ownerTabId)))return;
      applyDiscoverConfig(p.pendingDiscoverConfig);
      discoverJoined=Math.max(0,parseInt(p.discoverJoined)||0);
      isDiscoverJoining=true;
      await sleep(1800);
      discoverLoop(true);
    }
  })();

  // tu dong tiep tuc tim nhom theo tu khoa sau khi redirect / reload /
  // gui lenh that bai — phien tu chay lai ma khong can bam Start lan nua.
  (async ()=>{
    const s = await chrome.storage.local.get(["pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig","isGroupJoining","groupJoinRunConfig","groupJoined"]);
    if(s.pendingSearchJoin && s.pendingSearchKeyword && location.href.includes("/search/groups")){
      if(!(await runOwnedByThisTab(s.groupJoinRunConfig&&s.groupJoinRunConfig.ownerTabId)))return;
      const cfg = s.pendingSearchConfig;
      if(cfg){
        minMembers = cfg.minMembers; minPostsPerDay = cfg.minPostsPerDay; targetJoin = cfg.targetJoin; minDelay=cfg.minDelay; maxDelay=cfg.maxDelay; autoAnswers=cfg.autoAnswers||autoAnswers;joinConfirmTimeout=normalizeJoinConfirmTimeout(cfg.confirmWaitSeconds);aiJoinEnabled=!!cfg.aiJoinEnabled;aiJoinPrompt=cfg.aiJoinPrompt||"";aiJoinConfig=cfg.aiJoinConfig||{};aiJoinTypingConfig=cfg.typingConfig?normalizeAiTypingConfig(cfg.typingConfig):null;
        kwQueue=normalizeNickKeywords(cfg);kwIndex=Math.max(0,parseInt(cfg.keywordIndex)||0);if(kwIndex>=kwQueue.length)kwIndex=0;
        kwDone=Array.isArray(cfg.keywordDone)?cfg.keywordDone.map(v=>Math.max(0,parseInt(v)||0)):[];
        syncNickEntry();kwDone=[...kwQueue.map((_,i)=>Math.max(0,parseInt(kwDone[i])||0))];
      }
      chrome.storage.local.remove(["pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
      await sleep(2500);
      if(!isJoining && !isDiscoverJoining){
        isJoining=true;
        chrome.storage.local.set({ isGroupJoining:true, groupStatus:`Tu dong bat dau tim "${s.pendingSearchKeyword}"...` });
        joinLoop(s.pendingSearchKeyword);
      }
    }else if(s.isGroupJoining && s.groupJoinRunConfig && s.groupJoinRunConfig.keyword && !isJoining && !isDiscoverJoining && !location.pathname.startsWith("/groups/discover")){
      // Phien dang chay bi mat ket noi (chuyen trang, reload giua chung,
      // gui lenh khong toi tab): dung cau hinh da luu de tu chay lai va
      // giu nguyen bo dem da tham gia truoc do.
      if(!(await runOwnedByThisTab(s.groupJoinRunConfig.ownerTabId)))return;
      applySearchRunConfig(s.groupJoinRunConfig);
      const restored=Math.max(0,parseInt(s.groupJoined)||0);
      await sleep(2500);
      if(!isJoining && !isDiscoverJoining){
        isJoining=true;
        chrome.storage.local.set({ isGroupJoining:true });
        joinLoop(s.groupJoinRunConfig.keyword, restored);
      }
    }
  })();

  console.log("[Group] group.js loaded v1.9.4");
})();
