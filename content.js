// Trợ lý AI cho Facebook - three-source friend request engine.
(() => {
  const MODE_SUGGESTIONS="suggestions";
  const MODE_GROUP_COMMON="group-common";
  const MODE_CONFIRM="confirm";
  const MODE_FRIEND_OF_FRIEND="friend-of-friend";
  const HISTORY_UNCERTAIN_TTL=24*60*60*1000;
  const MAX_TRACKED_PROFILES=20000;
  const GROUP_LOAD_WAIT_MS=120000;
  const GROUP_LOADING_GRACE_MS=30000;
  const GROUP_LOAD_RELOADS=1;
  const FOF_OWN_FRIENDS_URL="/friends/list/";
  const FOF_MAX_SOURCE_PROFILES=5000;
  const FOF_MAX_CANDIDATES=5000;
  const FOF_MAX_SCROLL_ROUNDS=320;
  const FOF_LIST_WAIT_MS=60000;
  const FOF_SOURCE_WAIT_MS=45000;
  const FOF_SCROLL_PROGRESS_WAIT_MS=7000;
  const FOF_SCROLL_POLL_MS=500;
  const FOF_SCROLL_MIN_SETTLE_MS=1800;
  const FOF_END_CONFIRMATIONS=2;
  const FOF_NO_PROGRESS_TIMEOUT_MS=300000;
  const RESERVED_PATHS=new Set([
    "about","ads","bookmarks","events","friends","gaming","groups","help","home.php",
    "marketplace","messages","notifications","pages","photo","privacy","profile.php","reel",
    "search","settings","stories","watch"
  ]);

  let loopActive=false;
  let localRunId="";
  let stopRequested=false;
  let confirmLoopActive=false;
  let confirmLocalRunId="";
  let confirmStopRequested=false;
  let fofScanLoopActive=false;
  let fofScanLocalRunId="";
  let fofScanStopRequested=false;
  let fofSendLoopActive=false;
  let fofSendLocalRunId="";
  let fofSendStopRequested=false;
  let fofSendResumeTimer=0;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const cleanText=value=>String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim();
  const lower=value=>cleanText(value).toLocaleLowerCase("vi");
  const rand=(min,max)=>Math.floor(Math.random()*(Math.max(min,max)-Math.min(min,max)+1))+Math.min(min,max);

  function isVisible(el){
    if(!el?.isConnected)return false;
    const rect=el.getBoundingClientRect();
    if(rect.width<8||rect.height<8)return false;
    const style=getComputedStyle(el);
    return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>0;
  }

  function buttonLabel(el){
    return cleanText(el?.getAttribute?.("aria-label")||el?.innerText||el?.textContent);
  }

  function isExactAddFriendButton(el){
    if(!el||!isVisible(el)||el.matches('[aria-disabled="true"],:disabled'))return false;
    const text=lower(buttonLabel(el));
    if(!text||text.length>150)return false;
    if(/^(?:kết bạn|thêm bạn|thêm bạn bè|gửi lời mời kết bạn|gửi yêu cầu kết bạn|gửi lời mời|add friend)(?:\s+(?:với|with|cho|tới|đến)\s+.{1,100})?$/.test(text))return true;
    if(/^thêm\s+.{1,100}\s+(?:làm bạn bè|vào danh sách bạn bè|vào bạn bè)$/.test(text))return true;
    if(/^(?:gửi lời mời kết bạn|gửi yêu cầu kết bạn|kết bạn|thêm bạn|add friend)\s+.{1,100}$/.test(text))return true;
    return false;
  }

  function isPendingFriendLabel(value){
    return /^(?:đã gửi|đã gửi lời mời|hủy lời mời|hủy yêu cầu|request sent|cancel request)(?:\s+.*)?$/.test(lower(value));
  }

  function profileKeyFromHref(href){
    let url;
    try{url=new URL(href,location.origin);}catch{return "";}
    if(!/(^|\.)facebook\.com$/i.test(url.hostname))return "";
    const id=url.searchParams.get("id");
    if(id&&/^\d+$/.test(id))return `id:${id}`;
    const groupUser=url.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)/i);
    if(groupUser)return `id:${groupUser[1]}`;
    const peopleMatch=url.pathname.match(/^\/people\/[^/]+\/(\d+)/i)||url.pathname.match(/^\/people\/(\d+)/i);
    if(peopleMatch)return `id:${peopleMatch[1]}`;
    const parts=url.pathname.split("/").filter(Boolean);
    if(parts.length===1){
      const username=decodeURIComponent(parts[0]).toLocaleLowerCase("vi");
      if(!username||RESERVED_PATHS.has(username)||(username.includes(".")&&/^(?:home|login)\./.test(username)))return "";
      if(!/^[\p{L}\p{N}._-]{2,100}$/u.test(username))return "";
      return `user:${username}`;
    }
    if(parts.length===2&&parts[0].toLowerCase()==="people"){
      const username=decodeURIComponent(parts[1]).toLocaleLowerCase("vi");
      if(username&&!RESERVED_PATHS.has(username)&&/^[\p{L}\p{N}._-]{2,100}$/u.test(username))return `user:${username}`;
    }
    return "";
  }

  function findPrimaryProfileLink(cardNode){
    const links=[...cardNode.querySelectorAll('a[href]')];
    let bestLink=null;
    let bestScore=-1;
    for(const link of links){
      const href=link.href||"";
      if(/mutual|friends_mutual|\/friends\//i.test(href))continue;
      // Avatar của bạn chung trong card gợi ý mang href hồ sơ bình thường
      // (không có "mutual" trong URL) nhưng aria-label ghi "… đây là bạn
      // chung" / "… mutual friend". Nếu climb dừng ở tầng chỉ chứa link này,
      // candidateFromButton sẽ gán KEY = bạn chung thay vì ứng viên → gửi lời
      // mời sai người và nhảy cóc sang card khác khi candidateCard tìm lại
      // theo key sai. Loại thẳng các link avatar bạn chung ở đây.
      const aria=lower(link.getAttribute("aria-label")||"");
      if(/bạn chung|mutual friend/.test(aria))continue;
      const key=profileKeyFromHref(href);
      if(!key)continue;
      let score=1;
      if(link.querySelector('img'))score+=5;
      if(link.closest('h1,h2,h3,h4,strong,[role="heading"]'))score+=3;
      if(link.getAttribute("aria-label"))score+=2;
      if(score>bestScore){
        bestScore=score;
        bestLink=link;
      }
    }
    return bestLink;
  }

  function candidateFromButton(button,sourceRoot){
    if(!isExactAddFriendButton(button)||button.closest('[role="dialog"],[role="menu"]'))return null;
    const main=sourceRoot||button.closest('div[role="main"],main')||document.querySelector('div[role="main"],main');
    if(!main||!main.contains(button))return null;
    let node=button.parentElement;
    for(let depth=0;node&&node!==main&&depth<10;depth++,node=node.parentElement){
      const link=findPrimaryProfileLink(node);
      if(!link)continue;
      const key=profileKeyFromHref(link.href);
      if(!key)continue;
      // A normal suggestion card legitimately contains a second, small link —
      // the mutual-friend's own avatar next to "X bạn chung" — so rejecting
      // on multiple distinct profile keys here throws out real candidates
      // (confirmed live: rejected every row on Facebook's current Suggestions
      // layout). findPrimaryProfileLink's own scoring already picks the best
      // (named, imaged) link in this node, which is enough.
      const linkText=cleanText(link.getAttribute("aria-label")||link.innerText||link.textContent);
      const name=(linkText||cleanText(node.innerText||node.textContent).split(" ").slice(0,8).join(" ")).slice(0,120);
      const cardText=cleanText(node.innerText||node.textContent);
      const mutualMatch=cardText.match(/(\d{1,4})\s+(?:bạn chung|mutual friends?)/i);
      return {key,name,url:link.href,button,card:node,mutualCount:mutualMatch?parseInt(mutualMatch[1]):null};
    }
    return null;
  }

  // Facebook can recycle/replace a candidate's card or button node after the
  // initial click (list virtualization); re-find the current card by profile
  // key instead of trusting node references captured at scan time.
  function candidateCard(mode,key){
    if(!key)return null;
    const root=currentSourceRoot(mode);
    if(!root)return null;
    for(const link of [...root.querySelectorAll('a[href]')]){
      if(profileKeyFromHref(link.href||"")!==key)continue;
      for(let node=link.parentElement,depth=0;node&&node!==root&&depth<14;node=node.parentElement,depth++){
        const keys=new Set([...node.querySelectorAll('a[href]')].map(a=>profileKeyFromHref(a.href||"")).filter(Boolean));
        if(keys.size!==1||!keys.has(key))break;
        if(node.querySelector('button,[role="button"]'))return node;
      }
    }
    return null;
  }

  function rawAddButtons(root){
    if(!root)return [];
    return [...root.querySelectorAll('button,[role="button"]')].filter(isExactAddFriendButton);
  }

  function findGroupCommonHeadings(){
    const main=document.querySelector('div[role="main"],main');
    if(!main)return [];
    const headingPattern=/(?:thành viên có điểm chung|những thành viên có điểm chung|cùng có điểm chung|members? with things in common|people with things in common|things in common)/i;
    return [...main.querySelectorAll('[role="heading"],h1,h2,h3,h4,span,div')].filter(el=>{
      if(!isVisible(el))return false;
      const value=lower(el.getAttribute("aria-label")||(el.children.length?el.innerText:el.textContent));
      return value.length<=120&&headingPattern.test(value);
    });
  }

  function findGroupCommonSection(){
    const main=document.querySelector('div[role="main"],main');
    if(!main)return null;
    for(const heading of findGroupCommonHeadings()){
      let node=heading.parentElement;
      for(let depth=0;node&&node!==main&&depth<9;depth++,node=node.parentElement){
        if(rawAddButtons(node).length)return node;
      }
    }
    return null;
  }

  function isGroupCommonAllPage(){
    return /^\/groups\/[^/]+\/members\/things_in_common(?:\/|$)/i.test(location.pathname);
  }

  function findGroupCommonAllLink(){
    const main=document.querySelector('div[role="main"],main');
    if(!main)return null;
    for(const heading of findGroupCommonHeadings()){
      let node=heading.parentElement;
      for(let depth=0;node&&node!==main&&depth<10;depth++,node=node.parentElement){
        const link=[...node.querySelectorAll('a[href]')].find(el=>{
          if(!isVisible(el)||!/^(?:xem tất cả|see all)$/.test(lower(buttonLabel(el))))return false;
          try{
            const url=new URL(el.href,location.origin);
            return /^\/groups\/[^/]+\/members\/things_in_common(?:\/|$)/i.test(url.pathname);
          }catch{return false;}
        });
        if(link)return link;
      }
    }
    return null;
  }

  function groupCommonFullListReady(){
    if(isGroupCommonAllPage()){
      const main=document.querySelector('div[role="main"],main');
      return !!(main && rawAddButtons(main).length>0);
    }
    return findGroupCommonHeadings().length>0&&!findGroupCommonAllLink();
  }

  function currentSourceRoot(mode){
    if(mode===MODE_GROUP_COMMON){
      if(isGroupCommonAllPage()){
        const section=findGroupCommonSection();
        return section||document.querySelector('div[role="main"],main');
      }
      const section=findGroupCommonSection();
      return section||document.querySelector('div[role="main"],main');
    }
    if(mode===MODE_SUGGESTIONS){
      const headings=[...document.querySelectorAll('[role="heading"],h1,h2,h3')]
        .filter(h=>isVisible(h)&&/(?:những người bạn có thể biết|gợi ý|gợi ý kết bạn|people you may know|suggestions)/i.test(lower(h.innerText||h.textContent)));
      for(const heading of headings){
        let node=heading.parentElement;
        for(let depth=0;node&&node!==document.body&&depth<12;depth++,node=node.parentElement){
          if(rawAddButtons(node).length)return node;
        }
      }
      const namedNav=[...document.querySelectorAll('nav,[role="navigation"]')]
        .find(root=>isVisible(root)&&/(?:gợi ý|suggestions)/i.test(lower(root.getAttribute("aria-label")))&&rawAddButtons(root).length);
      if(namedNav)return namedNav;
      // Facebook has shipped a two-pane Suggestions layout where the whole
      // "Gợi ý"/"Những người bạn có thể biết" list renders outside
      // div[role="main"] entirely (a left-rail panel, not a heading with a
      // real heading role) — neither strategy above finds a container in
      // that case even though real candidates are on the page. Fall back to
      // the whole document; isExactAddFriendButton's own text matching is
      // strict enough to avoid picking up unrelated buttons elsewhere.
      if(rawAddButtons(document.body).length)return document.body;
    }
    return document.querySelector('div[role="main"],main');
  }

  function sourceReady(mode){
    if(mode===MODE_SUGGESTIONS)return /\/friends\/suggestions(?:\/|$)/.test(location.pathname);
    return mode===MODE_GROUP_COMMON&&/^\/groups\/[^/]+\/members(?:\/|$)/.test(location.pathname);
  }

  function groupMembersUrl(group){
    const id=String(group?.id||"").trim();
    if(!id)return "";
    return `${location.origin}/groups/${encodeURIComponent(id)}/members/`;
  }

  function groupCommonAllUrl(group){
    const id=String(group?.id||"").trim();
    if(!id)return "";
    return `${location.origin}/groups/${encodeURIComponent(id)}/members/things_in_common/`;
  }

  function expectedSourceUrl(state){
    if(state.mode===MODE_SUGGESTIONS)return `${location.origin}/friends/suggestions`;
    const group=state.config?.groups?.[state.groupIndex||0];
    return groupMembersUrl(group);
  }

  function isCorrectSource(state){
    if(!sourceReady(state.mode))return false;
    if(state.mode!==MODE_GROUP_COMMON)return true;
    const group=state.config?.groups?.[state.groupIndex||0];
    const current=location.pathname.match(/^\/groups\/([^/]+)/i)?.[1]||"";
    return decodeURIComponent(current)===String(group?.id||"");
  }

  async function ownTabId(){
    try{return (await chrome.runtime.sendMessage({action:"getSenderTabId"}))?.tabId||null;}catch{return null;}
  }

  async function loadHistory(){
    const stored=await chrome.storage.local.get("friendProfileHistory");
    const history=stored.friendProfileHistory&&typeof stored.friendProfileHistory==="object"?stored.friendProfileHistory:{};
    const now=Date.now();
    for(const [key,item] of Object.entries(history)){
      if(!item?.time||(item.status==="uncertain"&&now-item.time>HISTORY_UNCERTAIN_TTL))delete history[key];
    }
    return history;
  }

  async function saveHistory(history){
    const entries=Object.entries(history).sort((a,b)=>(b[1]?.time||0)-(a[1]?.time||0)).slice(0,MAX_TRACKED_PROFILES);
    await chrome.storage.local.set({friendProfileHistory:Object.fromEntries(entries)});
  }

  async function loadConfirmHistory(){
    const stored=await chrome.storage.local.get("friendConfirmHistory");
    const history=stored.friendConfirmHistory&&typeof stored.friendConfirmHistory==="object"?stored.friendConfirmHistory:{};
    const now=Date.now();
    for(const [key,item] of Object.entries(history)){
      if(!item?.time||(item.status==="uncertain"&&now-item.time>HISTORY_UNCERTAIN_TTL))delete history[key];
    }
    return history;
  }

  async function saveConfirmHistory(history){
    const entries=Object.entries(history).sort((a,b)=>(b[1]?.time||0)-(a[1]?.time||0)).slice(0,MAX_TRACKED_PROFILES);
    await chrome.storage.local.set({friendConfirmHistory:Object.fromEntries(entries)});
  }

  function normalizeConfig(input={}){
    const min=Math.max(1000,parseInt(input.minDelay)||5000);
    const max=Math.max(1000,parseInt(input.maxDelay)||15000);
    const mode=[MODE_SUGGESTIONS,MODE_GROUP_COMMON].includes(input.mode)?input.mode:MODE_SUGGESTIONS;
    return {
      mode,
      minDelay:Math.min(min,max),
      maxDelay:Math.max(min,max),
      maxRequests:Math.max(1,Math.min(100000,parseInt(input.maxRequests)||20)),
      minMutual:Math.max(0,parseInt(input.minMutual)||0),
      groups:Array.isArray(input.groups)?input.groups.filter(g=>g?.id).map(g=>({id:String(g.id),name:cleanText(g.name),url:g.url||""})):[]
    };
  }

  function normalizeConfirmConfig(input={}){
    // Popup persists a durable state before navigating to /friends/requests.
    // That provisional state uses `confirmFilters`; a resumed content script
    // may already have the normalized `filters` shape. Accept both forms.
    const source=input.confirmFilters&&typeof input.confirmFilters==="object"
      ?input.confirmFilters
      :(input.filters&&typeof input.filters==="object"?input.filters:{});
    return {
      mode:MODE_CONFIRM,
      minDelay:Math.min(Math.max(1000,parseInt(input.minDelay)||5000),Math.max(1000,parseInt(input.maxDelay)||15000)),
      maxDelay:Math.max(Math.max(1000,parseInt(input.minDelay)||5000),Math.max(1000,parseInt(input.maxDelay)||15000)),
      maxRequests:Math.max(1,Math.min(100000,parseInt(input.maxRequests)||20)),
      filters:{
        minMutual:Math.max(0,Math.min(100000,parseInt(source.minMutual)||0))
      }
    };
  }

  async function publishState(state,message){
    if(message)state.status=message;
    state.updatedAt=Date.now();
    await chrome.storage.local.set({
      friendRunState:state,
      isRunning:!!state.active,
      sentCount:state.sentCount||0,
      friendSkipped:state.skippedCount||0,
      friendUncertain:state.uncertainCount||0,
      friendStatus:state.status||"",
      lastMessage:state.status||""
    });
  }

  async function readActiveState(runId){
    const stored=await chrome.storage.local.get("friendRunState");
    const state=stored.friendRunState;
    if(!state?.active||state.runId!==runId||stopRequested)return null;
    return state;
  }

  async function stopRun(reason,runId=""){
    try{
      const stored=await chrome.storage.local.get("friendRunState");
      const state=stored.friendRunState||{};
      if(runId&&state.runId&&state.runId!==runId)return;
      state.active=false;
      state.nextAllowedAt=0;
      stopRequested=true;
      await publishState(state,reason||t("c.frStopped"));
    }catch(error){
      // Context có thể đã invalidate lúc cleanup (đổi tab/reload extension);
      // vẫn phải giữ cờ in-memory tắt dù không ghi được storage.
      console.warn("[Friend] stopRun",error);
      stopRequested=true;
    }
  }

  function pageRestriction(){
    if(/checkpoint|login|recover/i.test(location.pathname))return t("c.frLogin");
    const text=[...document.querySelectorAll('[role="alert"],[role="dialog"]')]
      .filter(isVisible).map(el=>lower(el.innerText||el.textContent)).join(" ");
    if(/tạm thời bị chặn|bạn không thể gửi lời mời kết bạn|không thể gửi lời mời kết bạn lúc này|temporarily blocked|you can.t send friend requests|friend request limit|xác minh tài khoản/.test(text)){
      return t("c.frLimited");
    }
    if(/bạn có biết người này|do you know this person/.test(text))return t("c.frWarnDlg");
    return "";
  }

  function collectCandidates(state,history){
    const root=currentSourceRoot(state.mode);
    // Thống kê quét để status nêu rõ lý do khi hàng đợi cạn (đêm 16/9: dừng
    // 0/50 mà popup không thấy card nào bị loại thầm lặng vì minMutual).
    const stats={buttons:0,noCard:0,seen:0,mutualFiltered:0,candidates:0};
    state.lastScan=stats;
    if(!root)return {ready:false,candidates:[]};
    const attempted=new Set(state.attemptedKeys||[]);
    const map=new Map();
    // Facebook can reflow/recycle cards while the page is scrolled. Sorting by
    // viewport coordinates therefore changes the queue between iterations
    // even though the DOM list order is stable. Keep the first matching button
    // in querySelectorAll order so the Suggestions flow advances top-to-bottom
    // through Facebook's actual card sequence.
    const buttons=rawAddButtons(root);
    stats.buttons=buttons.length;
    for(let domOrder=0;domOrder<buttons.length;domOrder++){
      const button=buttons[domOrder];
      const candidate=candidateFromButton(button,root);
      if(!candidate){stats.noCard++;continue;}
      if(attempted.has(candidate.key)||history[candidate.key]){stats.seen++;continue;}
      if(state.config.minMutual>0&&(candidate.mutualCount==null||candidate.mutualCount<state.config.minMutual)){stats.mutualFiltered++;continue;}
      candidate.domOrder=domOrder;
      if(!map.has(candidate.key))map.set(candidate.key,candidate);
    }
    const candidates=[...map.values()];
    stats.candidates=candidates.length;
    candidates.sort((a,b)=>(a.domOrder??0)-(b.domOrder??0));
    return {ready:true,candidates};
  }

  function highlightCandidates(candidates){
    document.querySelectorAll('[data-friend-scan="1"]').forEach(el=>{delete el.dataset.friendScan;el.style.outline="";});
    for(const candidate of candidates){
      candidate.button.dataset.friendScan="1";
      candidate.button.style.outline="3px solid #1877f2";
      candidate.button.title=`Auto vjp: ${candidate.name||candidate.key}`;
    }
  }

  async function trustedClick(el,telem){
    if(telem&&typeof telem==="object"){telem.path="failed";telem.x=0;telem.y=0;}
    if(!isVisible(el))return false;
    try{
      el.scrollIntoView({behavior:"instant",block:"center"});
    }catch{
      try{el.scrollIntoView({behavior:"smooth",block:"center"});}catch{}
    }
    await sleep(400);
    const rect=el.getBoundingClientRect();
    const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2);
    if(telem&&typeof telem==="object"){telem.x=x;telem.y=y;}
    let debuggerSuccess=false;
    if(x>=0&&y>=0&&x<=window.innerWidth&&y<=window.innerHeight){
      const hit=document.elementFromPoint(x,y);
      if(hit&&(hit===el||el.contains(hit)||hit.contains(el))){
        try{
          const result=await chrome.runtime.sendMessage({action:"trustedMouse",kind:"click",x,y});
          if(result?.ok)debuggerSuccess=true;
        }catch{}
      }
    }
    if(debuggerSuccess){if(telem&&typeof telem==="object")telem.path="debugger";return true;}
    // Fallback DOM click: chỉ báo đã bắn, KHÔNG đảm bảo Facebook đã nhận.
    // Nơi gọi phải tự xác minh hiệu ứng (dialog/label đổi) sau click.
    try{el.click();if(telem&&typeof telem==="object")telem.path="fallback";return true;}catch{return false;}
  }

  async function maybeConfirmFriendDialog(runId){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(isVisible);
    for(const dialog of dialogs){
      const dialogText=lower(dialog.innerText||dialog.textContent);
      if(/bạn có biết người này|do you know this person|tạm thời bị chặn|temporarily blocked/.test(dialogText))return "blocked";
      const confirm=[...dialog.querySelectorAll('button,[role="button"]')].find(el=>/^(?:gửi lời mời kết bạn|gửi lời mời|send friend request|send request)$/.test(lower(buttonLabel(el)))&&isVisible(el));
      // Một số luồng Facebook cần cú xác nhận thứ hai mới gửi lời mời.
      // Kiểm tra cờ Dừng ngay trước cú bấm không đảo ngược này.
      if(confirm){
        if(!await readActiveState(runId))return "stopped";
        return await trustedClick(confirm)?"clicked":"failed";
      }
    }
    return "none";
  }

  async function attemptCandidate(candidate,runId,mode){
    // DỪNG BẰNG MỌI GIÁ: kiểm tra lại ngay trước cú bấm gửi lời mời.
    if(!await readActiveState(runId))return {kind:"stopped"};
    const successBefore=new Set([...document.querySelectorAll('[role="alert"],[role="status"]')]
      .filter(isVisible).map(el=>lower(el.innerText||el.textContent)).filter(Boolean));
    candidate.button.style.outline="3px solid #00a400";
    const clickTelem={};
    const labelBefore=buttonLabel(candidate.button);
    if(!await trustedClick(candidate.button,clickTelem))return {kind:"failed",message:t("c.frNoBtn")};
    // Click (debugger hay fallback) chỉ mới "đã bắn". Sáng 17/9 tái hiện:
    // nút đúng, tọa độ đúng, debugger khỏe, nhưng Facebook không có phản
    // ứng gì 6/6 lần. Xác minh hiệu ứng trong ~1.5 giây trước khi tin click.
    const clickEngaged=async()=>{
      for(let i=0;i<3;i++){
        await sleep(500);
        if(!await readActiveState(runId))return "stopped";
        if([...document.querySelectorAll('[role="dialog"]')].filter(isVisible).length>0)return true;
        const cardNow=candidateCard(mode,candidate.key)||candidate.card;
        const btnNow=(cardNow&&cardNow.querySelector('button,[role="button"]'))||candidate.button;
        if(!btnNow||!btnNow.isConnected)return true;
        if(btnNow.matches('[aria-disabled="true"],:disabled'))return true;
        if(buttonLabel(btnNow)!==labelBefore)return true;
      }
      return false;
    };
    let engaged=await clickEngaged();
    if(engaged==="stopped")return {kind:"stopped"};
    if(!engaged){
      // Lượt đầu không để lại dấu vết nào: tìm lại nút mới rồi bấm lại MỘT
      // lần duy nhất. Chỉ bấm lại khi chắc lượt đầu chưa có tác dụng nên
      // không thể gửi trùng.
      const fresh=candidateCard(mode,candidate.key);
      const freshBtn=fresh?fresh.querySelector('button,[role="button"]'):null;
      if(freshBtn&&freshBtn.isConnected&&isExactAddFriendButton(freshBtn)){
        candidate.button=freshBtn;
        candidate.card=fresh;
        if(await trustedClick(freshBtn,clickTelem))engaged=await clickEngaged();
        if(engaged==="stopped")return {kind:"stopped"};
      }
    }
    if(!engaged)return {kind:"failed",message:t("c.frClickDead",{path:clickTelem.path||"unknown"})};
    await sleep(500);
    const dialogResult=await maybeConfirmFriendDialog(runId);
    if(dialogResult==="stopped")return {kind:"stopped"};
    if(dialogResult==="blocked")return {kind:"blocked",message:t("c.frWarnShown")};
    if(dialogResult==="failed")return {kind:"uncertain",message:t("c.frNoConfirm")};
    // Facebook commonly recycles/replaces the card or button node after the
    // click; re-find the current card by profile key rather than reading
    // the stale references captured at scan time.
    const readProof=()=>{
      const card=candidateCard(mode,candidate.key)||candidate.card;
      const currentButton=(card&&card.querySelector('button,[role="button"]'))||candidate.button;
      const currentLabel=buttonLabel(currentButton);
      const cardText=cleanText(card?.innerText||card?.textContent);
      const successAlert=[...document.querySelectorAll('[role="alert"],[role="status"]')]
        .filter(isVisible).map(el=>lower(el.innerText||el.textContent))
        .some(text=>!successBefore.has(text)&&/đã gửi lời mời kết bạn|friend request (?:was )?sent/.test(text));
      return isPendingFriendLabel(currentLabel)||/(?:đã gửi lời mời|hủy lời mời|request sent|cancel request)/i.test(cardText)||successAlert;
    };
    // Đêm 16/9 tái hiện trực tiếp: Facebook xử lý chậm khiến proof 7 giây
    // không bao giờ nổ dù click đã bắn (5/5 uncertain liên tiếp). Chờ tối đa
    // 20 giây, mỗi vòng vẫn kiểm tra stop flag/run ID.
    for(let i=0;i<40;i++){
      if(!await readActiveState(runId))return {kind:"stopped"};
      const restriction=pageRestriction();
      if(restriction)return {kind:"blocked",message:restriction};
      if(readProof())return {kind:"confirmed"};
      await sleep(500);
    }
    // Facebook đôi khi áp trạng thái đã gửi sau vài giây kể từ lần render
    // đầu; nhìn lại một lần sau 5 giây (vẫn polling stop flag) trước khi
    // kết luận uncertain để không nhầm render chậm thành click thất bại.
    // Không bấm lại: tránh gửi trùng khi lượt đầu thật ra đã đi.
    for(let i=0;i<10;i++){
      if(!await readActiveState(runId))return {kind:"stopped"};
      await sleep(500);
    }
    if(readProof())return {kind:"confirmed"};
    return {kind:"uncertain",message:t("c.frNoProof")};
  }

  async function waitForSchedule(runId){
    while(true){
      const state=await readActiveState(runId);
      if(!state)return false;
      const remain=(parseInt(state.nextAllowedAt)||0)-Date.now();
      if(remain<=0)return true;
      const seconds=Math.max(1,Math.ceil(remain/1000));
      if(state.lastShownSecond!==seconds){
        state.lastShownSecond=seconds;
        await publishState(state,t("c.frWait",{s:seconds,from:state.sentCount,to:state.config.maxRequests}));
      }
      await sleep(Math.min(500,remain));
    }
  }

  function scanStatsNote(state){
    const s=state.lastScan;
    if(!s)return "";
    return " "+t("c.frScanStats",{buttons:s.buttons||0,ok:s.candidates||0,mutual:s.mutualFiltered||0,seen:s.seen||0,nocard:s.noCard||0});
  }

  async function moveOrFinishEmpty(state,runId){
    if(state.mode===MODE_GROUP_COMMON){
      return waitForGroupContent(state,runId,isGroupCommonAllPage()?"full":"members");
    }
    state.emptyRounds=(parseInt(state.emptyRounds)||0)+1;
    if(state.emptyRounds<9){
      await publishState(state,t("c.frLoadingMore",{n:state.emptyRounds})+scanStatsNote(state));
      window.scrollBy({top:Math.max(650,innerHeight*.72),behavior:"smooth"});
      await sleep(1400);
      return "continue";
    }
    if((parseInt(state.sourceReloads)||0)<1){
      state.sourceReloads=(parseInt(state.sourceReloads)||0)+1;
      state.emptyRounds=0;
      await publishState(state,t("c.frReloadOnce"));
      location.reload();
      return "navigate";
    }
    await stopRun(t("c.frNoMore",{from:state.sentCount,to:state.config.maxRequests})+scanStatsNote(state),runId);
    return "stop";
  }

  function mainIsStillLoading(){
    const main=document.querySelector('div[role="main"],main');
    if(!main)return true;
    return [...main.querySelectorAll('[role="status"],[aria-busy="true"]')].some(el=>{
      if(!isVisible(el))return false;
      const text=lower(el.getAttribute("aria-label")||el.innerText||el.textContent);
      return el.getAttribute("aria-busy")==="true"||/^(?:đang tải|loading)(?:\.{0,3})?$/.test(text);
    });
  }

  function prepareGroupWait(state,phase){
    const group=state.config?.groups?.[state.groupIndex||0];
    const key=`${String(group?.id||"")}:${phase}`;
    if(state.groupWaitKey!==key){
      state.groupWaitKey=key;
      state.groupWaitStartedAt=Date.now();
      state.emptyRounds=0;
      state.sourceReloads=0;
    }
    if(!Number.isFinite(Number(state.groupWaitStartedAt))||Number(state.groupWaitStartedAt)<=0){
      state.groupWaitStartedAt=Date.now();
    }
    return group;
  }

  async function advanceGroup(state,runId){
    state.groupIndex=(parseInt(state.groupIndex)||0)+1;
    state.emptyRounds=0;
    state.sourceReloads=0;
    state.groupWaitKey="";
    state.groupWaitStartedAt=0;
    if(state.groupIndex>=state.config.groups.length){
      await stopRun(t("c.frGroupsDone",{from:state.sentCount,to:state.config.maxRequests}),runId);
      return "stop";
    }
    const group=state.config.groups[state.groupIndex];
    await publishState(state,t("c.frNextGroup",{i:state.groupIndex+1,total:state.config.groups.length,name:group.name}));
    location.assign(expectedSourceUrl(state));
    return "navigate";
  }

  async function waitForGroupContent(state,runId,phase){
    const group=prepareGroupWait(state,phase);
    state.emptyRounds=(parseInt(state.emptyRounds)||0)+1;
    const elapsed=Math.max(0,Date.now()-Number(state.groupWaitStartedAt));
    const loading=mainIsStillLoading();
    const limit=GROUP_LOAD_WAIT_MS+(loading?GROUP_LOADING_GRACE_MS:0);
    if(elapsed<limit){
      const elapsedSeconds=Math.floor(elapsed/1000);
      const limitSeconds=Math.ceil(limit/1000);
      const groupName=group?.name||t("c.frGroupN",{n:state.groupIndex+1});
      const message=phase==="members"
        ? t("c.frWaitMembers",{name:groupName,from:elapsedSeconds,to:limitSeconds})
        : t("c.frWaitList",{from:elapsedSeconds,to:limitSeconds});
      await publishState(state,message);
      window.scrollBy({top:Math.max(520,innerHeight*.58),behavior:"smooth"});
      await sleep(2200);
      return "continue";
    }
    if((parseInt(state.sourceReloads)||0)<GROUP_LOAD_RELOADS){
      state.sourceReloads=(parseInt(state.sourceReloads)||0)+1;
      state.groupWaitStartedAt=Date.now();
      state.emptyRounds=0;
      await publishState(state,phase==="members"
        ? t("c.frReloadMembers")
        : t("c.frReloadList"));
      location.reload();
      return "navigate";
    }
    if(phase==="members"){
      const target=groupCommonAllUrl(group);
      if(target){
        state.groupWaitKey="";
        state.groupWaitStartedAt=0;
        state.sourceReloads=0;
        await publishState(state,t("c.frNoSeeAll"));
        location.assign(target);
        return "navigate";
      }
    }
    return advanceGroup(state,runId);
  }

  async function openGroupCommonFullList(state,runId){
    if(state.mode!==MODE_GROUP_COMMON||isGroupCommonAllPage())return "ready";
    const link=findGroupCommonAllLink();
    if(!link){
      const action=await moveOrFinishEmpty(state,runId);
      return action;
    }
    state.emptyRounds=0;
    const href=new URL(link.href,location.origin).href;
    await publishState(state,t("c.frClickSeeAll"));
    const clicked=await trustedClick(link);
    if(clicked){
      for(let i=0;i<20&&!isGroupCommonAllPage();i++){
        if(!await readActiveState(runId))return "stop";
        await sleep(250);
      }
    }
    if(isGroupCommonAllPage()){
      state.emptyRounds=0;
      state.sourceReloads=0;
      state.groupWaitKey="";
      state.groupWaitStartedAt=0;
      await publishState(state,t("c.frListReady"));
      return "continue";
    }
    await publishState(state,t("c.frSeeAllStuck"));
    location.assign(href);
    return "navigate";
  }

  // ---- Friends-of-friends source engine: separate read/queue/send flow ----
  // This mode first reads the current account's friend list (or one explicit
  // source profile), then reads the source's visible Friends section. It does
  // not reuse the Suggestions/Common-members queue or their counters/proof.
  function fofOwnFriendsUrl(){return `${location.origin}${FOF_OWN_FRIENDS_URL}`;}

  function fofIsOwnFriendsRoute(){
    const path=location.pathname.replace(/\/+$/g,"").toLowerCase()||"/";
    return path==="/friends/list";
  }

  function fofProfileKeyFromFriendsUrl(href){
    let url;
    try{url=new URL(href,location.origin);}catch{return "";}
    const id=url.searchParams.get("id");
    if(id&&/^\d+$/.test(id))return `id:${id}`;
    const parts=url.pathname.split("/").filter(Boolean);
    const friendsIndex=parts.findIndex(part=>part.toLowerCase()==="friends");
    if(friendsIndex<=0)return "";
    return profileKeyFromHref(`${url.origin}/${parts.slice(0,friendsIndex).join("/")}`);
  }

  function fofCurrentProfileKey(){
    const key=profileKeyFromHref(location.href);
    if(key)return key;
    return fofProfileKeyFromFriendsUrl(location.href);
  }

  function fofNormalizeProfileUrl(value){
    let url;
    try{url=new URL(String(value||""),location.origin);}catch{return "";}
    if(!/(^|\.)facebook\.com$/i.test(url.hostname))return "";
    // strip /friends suffix so user can paste profile/friends URLs directly
    const friendsIdx=url.pathname.split("/").filter(Boolean).findIndex(p=>p.toLowerCase()==="friends");
    if(friendsIdx>0){
      const profilePath="/"+url.pathname.split("/").filter(Boolean).slice(0,friendsIdx).join("/");
      try{url=new URL(url.origin+profilePath);}catch{return "";}
    }
    if(!profileKeyFromHref(url.href))return "";
    url.hash="";
    ["ref","refid","__tn__","__cft__","mibextid","locale"].forEach(key=>url.searchParams.delete(key));
    return url.toString().replace(/\/$/,"");
  }

  function fofNormalizeUrlForNavigation(value){
    let url;
    try{url=new URL(String(value||""),location.origin);}catch{return "";}
    if(!/(^|\.)facebook\.com$/i.test(url.hostname))return "";
    url.hash="";
    ["ref","refid","__tn__","__cft__","mibextid","locale"].forEach(key=>url.searchParams.delete(key));
    return url.toString().replace(/\/$/,"");
  }

  function fofProfileLinks(root){
    if(!root)return [];
    return [...root.querySelectorAll("a[href]")].filter(link=>{
      const href=link.href||"";
      if(/mutual|friends_mutual|\/friends\/(?:suggestions|requests)/i.test(href))return false;
      const label=lower(link.getAttribute("aria-label")||"");
      if(/(?:bạn chung|mutual friend|common friend)/i.test(label))return false;
      return !!profileKeyFromHref(href);
    });
  }

  function fofFriendsViewRestricted(){
    const main=document.querySelector('div[role="main"],main');
    if(!main)return false;
    const restricted=/^(?:bạn chung|mutual friends?|common friends?|người theo dõi|người theo dõi chung|followers?|following|mutual followers?)$/i;
    return [...main.querySelectorAll('[role="tab"][aria-selected="true"],[role="tab"][data-state="active"]')]
      .some(tab=>restricted.test(cleanText(tab.getAttribute("aria-label")||tab.innerText||tab.textContent)));
  }

  function fofFriendsListRoot(){
    const main=document.querySelector('div[role="main"],main');
    // `/friends/list/` is currently mounted inside Facebook's left
    // `role=navigation` pane, while a source profile's Friends section lives
    // in `role=main`. Resolve those layouts separately so a valid own-list is
    // not rejected and a source scan cannot absorb unrelated global links.
    const ownRoute=fofIsOwnFriendsRoute();
    if(!ownRoute&&!main)return null;
    const searchScope=ownRoute?document:main;
    const headings=[...searchScope.querySelectorAll('[role="heading"],h1,h2,h3,h4')].filter(el=>{
      if(!isVisible(el))return false;
      const text=lower(el.getAttribute("aria-label")||el.innerText||el.textContent).replace(/\s*\(\d+\)\s*$/g,"");
      return /^(?:(?:tất cả|all)\s+)?(?:bạn bè|friends)$/.test(text);
    });
    let fallback=null;
    for(const heading of headings){
      const boundary=ownRoute?(heading.closest('[role="navigation"]')||document.body):main;
      let node=heading.parentElement;
      for(let depth=0;node&&node!==document.body&&depth<14;depth++,node=node.parentElement){
        if(node===boundary)break;
        const count=fofProfileLinks(node).length;
        // Stop at the first ancestor that contains the actual repeated list.
        // Climbing farther would absorb Facebook's sidebar/header profile
        // links and could make a source page look like a larger friend list.
        if(count>=2)return node;
        if(count===1&&!fallback)fallback=node;
      }
    }
    if(fallback)return fallback;
    // Some Facebook layouts expose the list without a heading but do expose
    // a list/grid role. Use that bounded container; never fall back to the
    // entire main region, which may contain unrelated profile links.
    let best=null,bestCount=0;
    const fallbackScope=ownRoute?(headings[0]?.closest('[role="navigation"]')||document.body):main;
    for(const node of fallbackScope.querySelectorAll('[role="grid"],[role="list"]')){
      const count=fofProfileLinks(node).length;
      if(count>bestCount){best=node;bestCount=count;}
    }
    return bestCount?best:null;
  }

  function fofFindScrollContainer(anchor){
    let node=anchor?.parentElement;
    for(let depth=0;node&&node!==document.body&&depth<28;depth++,node=node.parentElement){
      const style=getComputedStyle(node);
      if(node.scrollHeight>node.clientHeight+80&&/(?:auto|scroll|overlay)/i.test(style.overflowY||""))return node;
    }
    return document.scrollingElement||document.documentElement;
  }

  function fofScrollList(root){
    if(!root?.isConnected)root=fofFriendsListRoot();
    if(!root)return null;
    const links=fofProfileLinks(root);
    const anchor=links[links.length-1];
    const scroller=fofFindScrollContainer(anchor||root);
    const before=fofListSnapshot(root,scroller);
    if(anchor?.scrollIntoView)anchor.scrollIntoView({block:"end",inline:"nearest",behavior:"auto"});
    const distance=Math.max(650,(scroller?.clientHeight||innerHeight)*.85);
    if(scroller&&scroller!==document.documentElement&&scroller!==document.body){
      scroller.scrollBy({top:distance,behavior:"auto"});
      return before;
    }
    window.scrollBy({top:distance,behavior:"auto"});
    return before;
  }

  function fofListLoading(root){
    if(!root)return true;
    return [...root.querySelectorAll('[role="status"],[aria-busy="true"]')].some(el=>{
      if(!isVisible(el))return false;
      const value=lower(el.getAttribute("aria-label")||el.innerText||el.textContent);
      return el.getAttribute("aria-busy")==="true"||/^(?:đang tải|loading)(?:\.{0,3})?$/.test(value);
    });
  }

  function fofListSnapshot(root,knownScroller=null){
    if(!root?.isConnected)return null;
    const links=fofProfileLinks(root);
    const keys=[];
    const seen=new Set();
    for(const link of links){
      const key=profileKeyFromHref(link.href||"");
      if(!key||seen.has(key))continue;
      seen.add(key);keys.push(key);
    }
    const anchor=links[links.length-1]||root;
    const scroller=knownScroller?.isConnected?knownScroller:fofFindScrollContainer(anchor);
    const doc=document.scrollingElement||document.documentElement;
    const isDocument=!scroller||scroller===doc||scroller===document.documentElement||scroller===document.body;
    const scrollTop=Math.max(0,Number(isDocument?(doc?.scrollTop||window.scrollY):scroller.scrollTop)||0);
    const scrollHeight=Math.max(0,Number(isDocument?Math.max(doc?.scrollHeight||0,document.body?.scrollHeight||0):scroller.scrollHeight)||0);
    const clientHeight=Math.max(1,Number(isDocument?(window.innerHeight||doc?.clientHeight):scroller.clientHeight)||1);
    const bottomGap=Math.max(0,scrollHeight-clientHeight-scrollTop);
    const bottomTolerance=Math.max(80,Math.min(240,clientHeight*.18));
    return {
      profileCount:keys.length,
      tailKey:keys.slice(-5).join("|"),
      loading:fofListLoading(root),
      scrollTop,
      scrollHeight,
      clientHeight,
      atBottom:bottomGap<=bottomTolerance
    };
  }

  function fofListAdvanced(before,after){
    if(!before||!after)return false;
    return after.profileCount>before.profileCount||
      (!!after.tailKey&&after.tailKey!==before.tailKey)||
      after.scrollHeight>before.scrollHeight+24||
      after.scrollTop>before.scrollTop+24;
  }

  async function fofWaitForListProgress(runId,before){
    const startedAt=Date.now();
    let latest=before;
    let progressed=false;
    while(Date.now()-startedAt<FOF_SCROLL_PROGRESS_WAIT_MS){
      await sleep(FOF_SCROLL_POLL_MS);
      if(!await readFoFScanState(runId))return {stopped:true,progressed:false,snapshot:latest};
      const root=fofFriendsListRoot();
      if(root){
        latest=fofListSnapshot(root);
        if(fofListAdvanced(before,latest))progressed=true;
      }
      if(progressed&&Date.now()-startedAt>=FOF_SCROLL_MIN_SETTLE_MS)break;
    }
    return {stopped:false,progressed,snapshot:latest};
  }

  function fofNameFromLink(link,card){
    const label=cleanText(link?.getAttribute("aria-label")||link?.innerText||link?.textContent);
    if(label)return label.slice(0,120);
    const alt=cleanText(link?.querySelector("img")?.alt);
    if(alt)return alt.slice(0,120);
    return cleanText(card?.innerText||card?.textContent).split(" ").slice(0,8).join(" ").slice(0,120);
  }

  function fofCollectListProfiles(root,source={}){
    const map=new Map();
    for(const link of fofProfileLinks(root)){
      const key=profileKeyFromHref(link.href||"");
      const url=fofNormalizeProfileUrl(link.href||"");
      if(!key||!url||key===source.key||map.has(key))continue;
      let card=link.parentElement;
      for(let depth=0;card&&card!==root&&depth<8;depth++,card=card.parentElement){
        if(fofProfileLinks(card).length>1)break;
      }
      // Số bạn chung trên hàng danh sách (nếu Facebook render, vd "72 bạn chung").
      // Không có thì để null để vòng gửi quyết định theo minMutual.
      let mutualCount=null;
      try{
        const m=cleanText(card?.innerText||card?.textContent||"").match(/(\d{1,4})\s+(?:bạn chung|mutual friends?)/i);
        if(m)mutualCount=parseInt(m[1]);
      }catch(_){}
      map.set(key,{key,name:fofNameFromLink(link,card),url,mutualCount,sourceKey:source.key||"",sourceName:source.name||""});
      if(map.size>=FOF_MAX_CANDIDATES)break;
    }
    return [...map.values()];
  }

  function fofFindFriendsLink(sourceKey){
    const main=document.querySelector('div[role="main"],main');
    if(!main)return null;
    const links=[...main.querySelectorAll('a[href]')].filter(link=>{
      if(!isVisible(link))return false;
      const label=lower(link.getAttribute("aria-label")||link.innerText||link.textContent);
      const href=link.href||"";
      if(/^https?:\/\/[^/]+\/friends(?:\/|\?|$)/i.test(href)||/\/friends\/(?:suggestions|requests)/i.test(href))return false;
      return /^(?:bạn bè|friends)(?:\s*\(\d+\))?$/.test(label)||/\/friends(?:\/|\?|$)/i.test(href)||/[?&]sk=friends\b/i.test(href);
    });
    let best=null,bestScore=-1;
    for(const link of links){
      const href=link.href||"";
      const linkKey=fofProfileKeyFromFriendsUrl(href);
      let score=1;
      if(linkKey&&linkKey===sourceKey)score+=8;
      if(/^[^?]*\/friends(?:\/|\?|$)/i.test(href))score+=2;
      if(/^(?:bạn bè|friends)/i.test(lower(link.getAttribute("aria-label")||link.innerText||link.textContent)))score+=2;
      if(score>bestScore){best=link;bestScore=score;}
    }
    return best;
  }

  function fofSourceProfileEvidence(sourceKey){
    if(!sourceKey)return false;
    if(fofCurrentProfileKey()===sourceKey)return true;
    const main=document.querySelector('div[role="main"],main');
    return !!main&&fofProfileLinks(main).some(link=>profileKeyFromHref(link.href||"")===sourceKey);
  }

  function fofSourceFriendsPageMatches(state){
    if(state.listUrl&&fofNormalizeUrlForNavigation(state.listUrl)===fofNormalizeUrlForNavigation(location.href))return true;
    if(!/\/friends(?:\/|$)/i.test(location.pathname)||/\/friends\/(?:suggestions|requests|list)(?:\/|$)/i.test(location.pathname))return false;
    const routeKey=fofProfileKeyFromFriendsUrl(location.href);
    if(routeKey&&routeKey===state.source?.key)return true;
    return fofSourceProfileEvidence(state.source?.key||"");
  }

  async function saveFoFSourceList(list){
    const map=new Map();
    for(const item of Array.isArray(list)?list:[]){
      if(item?.key&&!map.has(item.key))map.set(item.key,item);
      if(map.size>=FOF_MAX_SOURCE_PROFILES)break;
    }
    await chrome.storage.local.set({friendFoFSourceList:[...map.values()]});
    return [...map.values()];
  }

  async function loadFoFSourceList(){
    const stored=await chrome.storage.local.get("friendFoFSourceList");
    return Array.isArray(stored.friendFoFSourceList)?stored.friendFoFSourceList:[];
  }

  async function saveFoFCandidates(list){
    const map=new Map();
    for(const item of Array.isArray(list)?list:[]){
      if(!item?.key||!item.url)continue;
      const existing=map.get(item.key);
      if(existing){
        const sources=[...new Set([...(existing.sourceNames||[]),item.sourceName].filter(Boolean))];
        existing.sourceNames=sources.slice(0,12);
      }else map.set(item.key,{...item,sourceNames:item.sourceName?[item.sourceName]:[]});
      if(map.size>=FOF_MAX_CANDIDATES)break;
    }
    const candidates=[...map.values()];
    await chrome.storage.local.set({friendFoFCandidates:candidates,friendFoFCandidateCount:candidates.length});
    return candidates;
  }

  async function publishFoFScanState(state,message){
    if(message)state.status=message;
    state.updatedAt=Date.now();
    await chrome.storage.local.set({
      friendFoFScanState:state,
      friendFoFScanActive:!!state.active,
      friendFoFStatus:state.status||"",
      friendFoFSourceScanned:state.sourceCount||0,
      friendFoFCandidateCount:state.candidateCount||0
    });
  }

  async function readFoFScanState(runId){
    const stored=await chrome.storage.local.get("friendFoFScanState");
    const state=stored.friendFoFScanState;
    if(!state?.active||state.runId!==runId||fofScanStopRequested)return null;
    return state;
  }

  async function stopFoFScan(reason,runId=""){
    try{
      const stored=await chrome.storage.local.get("friendFoFScanState");
      const state=stored.friendFoFScanState||{};
      if(runId&&state.runId&&state.runId!==runId)return;
      state.active=false;state.nextAllowedAt=0;fofScanStopRequested=true;
      await publishFoFScanState(state,reason||t("c.frFoFStopped"));
    }catch(error){
      console.warn("[FriendFoFScan] stopFoFScan",error);
      fofScanStopRequested=true;
    }
  }

  async function recordFoFSourceResult(source,result){
    const stored=await chrome.storage.local.get("friendFoFSourceResults");
    const rows=Array.isArray(stored.friendFoFSourceResults)?stored.friendFoFSourceResults:[];
    const next=rows.filter(row=>row?.key!==source.key);
    next.push({key:source.key,name:source.name||source.key,url:source.url,status:result.status,count:Math.max(0,parseInt(result.count)||0),updatedAt:Date.now()});
    await chrome.storage.local.set({friendFoFSourceResults:next.slice(-200)});
  }

  async function startFoFOwnScan(){
    const busy=await chrome.storage.local.get(["friendFoFActive","friendFoFScanActive","friendWarmActive","isRunning","friendConfirmActive","isFeedInteracting","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.values(busy).some(Boolean))return {ok:false,error:t("c.frFoFBusy")};
    const tabId=await ownTabId();
    const runId=`friend-fof-sources-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const now=Date.now();
    const state={active:true,kind:"own",phase:"own-list",runId,ownerTabId:tabId,sourceCount:0,candidateCount:0,scrollRounds:0,stableRounds:0,endConfirmations:0,reloads:0,startedAt:now,waitStartedAt:now,lastDomProgressAt:now,status:t("c.frFoFPreparing")};
    fofScanStopRequested=false;
    await chrome.storage.local.set({friendFoFSourceList:[],friendFoFSourceListComplete:false,friendFoFSourceResults:[],friendFoFSourceScanned:0,friendFoFStatus:state.status});
    await publishFoFScanState(state,state.status);
    setTimeout(()=>friendFoFScanLoop(runId),100);
    return {ok:true,runId};
  }

  function normalizeFoFSource(input={}){
    const url=fofNormalizeProfileUrl(input.url||"");
    const key=profileKeyFromHref(url);
    if(!url||!key)return null;
    return {key,url,name:cleanText(input.name||"").slice(0,120)};
  }

  async function startFoFSourceScan(input){
    const source=normalizeFoFSource(input);
    if(!source)return {ok:false,error:t("c.frFoFBadSource")};
    const busy=await chrome.storage.local.get(["friendFoFActive","friendFoFScanActive","friendWarmActive","isRunning","friendConfirmActive","isFeedInteracting","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.values(busy).some(Boolean))return {ok:false,error:t("c.frFoFBusy")};
    const tabId=await ownTabId();
    const runId=`friend-fof-source-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const now=Date.now();
    const state={active:true,kind:"source",phase:"source-profile",runId,ownerTabId:tabId,source,sourceCount:0,candidateCount:0,listUrl:"",scrollRounds:0,stableRounds:0,endConfirmations:0,reloads:0,startedAt:now,waitStartedAt:now,lastDomProgressAt:now,status:t("c.frFoFPreparing")};
    fofScanStopRequested=false;
    await chrome.storage.local.set({friendFoFCandidates:[],friendFoFCandidateCount:0,friendFoFSourceResults:[],friendFoFStatus:state.status});
    await publishFoFScanState(state,state.status);
    setTimeout(()=>friendFoFScanLoop(runId),100);
    return {ok:true,runId};
  }

  async function finishFoFOwnScan(state,runId,partial=false){
    state.active=false;state.completed=true;state.partial=!!partial;
    await chrome.storage.local.set({friendFoFSourceListComplete:!partial,friendFoFSourceScanned:state.sourceCount});
    await publishFoFScanState(state,partial?t("c.frFoFPartialSources",{n:state.sourceCount}):t("c.frFoFOwnDone",{n:state.sourceCount}));
    return "stop";
  }

  async function finishFoFSourceScan(state,partial=false){
    const count=Math.max(0,parseInt(state.candidateCount)||0);
    const status=partial?"partial":count?"viewable":"viewable-empty";
    await recordFoFSourceResult(state.source,{status,count});
    state.active=false;state.completed=true;state.partial=!!partial;state.sourceStatus=status;
    await publishFoFScanState(state,partial?t("c.frFoFSourcePartial",{name:state.source.name||state.source.key,n:count}):t("c.frFoFSourceDone",{name:state.source.name||state.source.key,n:count}));
    return "stop";
  }

  async function scanFoFOwnList(state,runId){
    const root=fofFriendsListRoot();
    if(!root){
      const elapsed=Date.now()-Number(state.waitStartedAt||state.startedAt||Date.now());
      if(elapsed<FOF_LIST_WAIT_MS){
        await publishFoFScanState(state,t("c.frFoFWaitOwn",{s:Math.floor(elapsed/1000)}));
        await sleep(1800);return "continue";
      }
      if((parseInt(state.reloads)||0)<1){
        state.reloads=(parseInt(state.reloads)||0)+1;
        state.waitStartedAt=Date.now();
        await publishFoFScanState(state,t("c.frReloadOnce"));
        location.reload();
        return "navigate";
      }
      return finishFoFOwnScan(state,runId,true);
    }
    const previous=await loadFoFSourceList();
    const found=fofCollectListProfiles(root);
    const merged=await saveFoFSourceList([...previous,...found]);
    const added=merged.length-previous.length;
    state.sourceCount=merged.length;
    state.lastDomProgressAt=Number(state.lastDomProgressAt)||Date.now();
    state.endConfirmations=Math.max(0,parseInt(state.endConfirmations??state.stableRounds)||0);
    if(added>0){state.lastDomProgressAt=Date.now();state.endConfirmations=0;}
    // A hard cap prevents an unexpectedly large/virtualized list from
    // turning into an unbounded scan. Reaching it is explicitly partial, not
    // proof that the whole Friends list has been read.
    if(merged.length>=FOF_MAX_SOURCE_PROFILES)return finishFoFOwnScan(state,runId,true);
    if(state.scrollRounds>=FOF_MAX_SCROLL_ROUNDS)return finishFoFOwnScan(state,runId,true);
    // Facebook mounts a loading spinner before it fetches the next batch. The
    // spinner is a reason to keep scrolling, not a reason to wait in place.
    // Re-find the root here because storage writes above may span a SPA render.
    const before=fofScrollList(fofFriendsListRoot()||root);
    if(!before){await sleep(FOF_SCROLL_POLL_MS);return "continue";}
    const outcome=await fofWaitForListProgress(runId,before);
    if(outcome.stopped)return "stop";
    state.scrollRounds=(parseInt(state.scrollRounds)||0)+1;
    if(outcome.progressed){
      state.lastDomProgressAt=Date.now();
      state.endConfirmations=0;
    }else if(outcome.snapshot&&!outcome.snapshot.loading&&outcome.snapshot.atBottom){
      state.endConfirmations+=1;
    }else state.endConfirmations=0;
    state.stableRounds=state.endConfirmations;
    await publishFoFScanState(state,t("c.frFoFScanningOwn",{n:merged.length,r:state.scrollRounds}));
    if(state.endConfirmations>=FOF_END_CONFIRMATIONS)return finishFoFOwnScan(state,runId,false);
    if(state.scrollRounds>=FOF_MAX_SCROLL_ROUNDS||Date.now()-state.lastDomProgressAt>=FOF_NO_PROGRESS_TIMEOUT_MS)return finishFoFOwnScan(state,runId,true);
    return "continue";
  }

  async function scanFoFSourceList(state,runId){
    if(!fofSourceFriendsPageMatches(state)){
      if(state.listUrl){await publishFoFScanState(state,t("c.frFoFReturningSource"));location.assign(state.listUrl);return "navigate";}
      return stopFoFScan(t("c.frFoFWrongSource"),runId);
    }
    if(fofFriendsViewRestricted()){
      await recordFoFSourceResult(state.source,{status:"restricted",count:0});
      return stopFoFScan(t("c.frFoFRestricted"),runId);
    }
    const root=fofFriendsListRoot();
    if(!root){
      const elapsed=Date.now()-Number(state.waitStartedAt||state.startedAt||Date.now());
      if(elapsed<FOF_LIST_WAIT_MS){await publishFoFScanState(state,t("c.frFoFWaitSource",{s:Math.floor(elapsed/1000)}));await sleep(1800);return "continue";}
      if((parseInt(state.reloads)||0)<1){
        state.reloads=(parseInt(state.reloads)||0)+1;
        state.waitStartedAt=Date.now();
        await publishFoFScanState(state,t("c.frReloadOnce"));
        location.reload();
        return "navigate";
      }
      await recordFoFSourceResult(state.source,{status:"unknown",count:0});
      return stopFoFScan(t("c.frFoFSourceUnavailable"),runId);
    }
    const current=await chrome.storage.local.get("friendFoFCandidates");
    const previous=Array.isArray(current.friendFoFCandidates)?current.friendFoFCandidates:[];
    const found=fofCollectListProfiles(root,state.source);
    const candidates=await saveFoFCandidates([...previous,...found]);
    const beforeCount=previous.length;
    state.candidateCount=candidates.length;
    state.lastDomProgressAt=Number(state.lastDomProgressAt)||Date.now();
    state.endConfirmations=Math.max(0,parseInt(state.endConfirmations??state.stableRounds)||0);
    if(candidates.length>beforeCount){state.lastDomProgressAt=Date.now();state.endConfirmations=0;}
    if(candidates.length>=FOF_MAX_CANDIDATES)return finishFoFSourceScan(state,true);
    if(state.scrollRounds>=FOF_MAX_SCROLL_ROUNDS)return finishFoFSourceScan(state,true);
    const before=fofScrollList(fofFriendsListRoot()||root);
    if(!before){await sleep(FOF_SCROLL_POLL_MS);return "continue";}
    const outcome=await fofWaitForListProgress(runId,before);
    if(outcome.stopped)return "stop";
    state.scrollRounds=(parseInt(state.scrollRounds)||0)+1;
    if(outcome.progressed){
      state.lastDomProgressAt=Date.now();
      state.endConfirmations=0;
    }else if(outcome.snapshot&&!outcome.snapshot.loading&&outcome.snapshot.atBottom){
      state.endConfirmations+=1;
    }else state.endConfirmations=0;
    state.stableRounds=state.endConfirmations;
    await publishFoFScanState(state,t("c.frFoFScanningSource",{name:state.source.name||state.source.key,n:candidates.length,r:state.scrollRounds}));
    if(state.endConfirmations>=FOF_END_CONFIRMATIONS)return finishFoFSourceScan(state,false);
    if(state.scrollRounds>=FOF_MAX_SCROLL_ROUNDS||Date.now()-state.lastDomProgressAt>=FOF_NO_PROGRESS_TIMEOUT_MS)return finishFoFSourceScan(state,true);
    return "continue";
  }

  async function friendFoFScanLoop(runId){
    if(fofScanLoopActive)return;
    fofScanLoopActive=true;fofScanLocalRunId=runId;fofScanStopRequested=false;
    try{
      while(true){
        const state=await readFoFScanState(runId);
        if(!state)return;
        // Cuộn danh sách dài có thể chạm checkpoint/giới hạn tốc độ; trước đây
        // không kiểm tra nên chỉ âm thầm timeout. Dùng chung pageRestriction().
        const restriction=pageRestriction();
        if(restriction){await stopFoFScan(restriction,runId);return;}
        if(state.kind==="own"){
          if(!fofIsOwnFriendsRoute()){
            await publishFoFScanState(state,t("c.frFoFOpeningOwn"));location.assign(fofOwnFriendsUrl());return;
          }
          const action=await scanFoFOwnList(state,runId);if(action!=="continue")return;
          continue;
        }
        if(state.phase==="source-profile"){
          if(!fofSourceProfileEvidence(state.source?.key)){
            await publishFoFScanState(state,t("c.frFoFOpeningSource",{name:state.source?.name||state.source?.key||""}));
            location.assign(state.source.url);return;
          }
          const link=fofFindFriendsLink(state.source.key);
          if(link){
            state.listUrl=fofNormalizeUrlForNavigation(link.href||"")||link.href;
            state.phase="source-list";state.waitStartedAt=Date.now();state.scrollRounds=0;state.stableRounds=0;state.endConfirmations=0;state.lastDomProgressAt=Date.now();
            await publishFoFScanState(state,t("c.frFoFOpeningFriends",{name:state.source.name||state.source.key}));
            location.assign(state.listUrl);return;
          }
          const elapsed=Date.now()-Number(state.waitStartedAt||state.startedAt||Date.now());
          if(elapsed<FOF_SOURCE_WAIT_MS){await publishFoFScanState(state,t("c.frFoFWaitFriendsLink",{s:Math.floor(elapsed/1000)}));await sleep(1800);continue;}
          await recordFoFSourceResult(state.source,{status:"restricted",count:0});
          await stopFoFScan(t("c.frFoFNoFriendsLink"),runId);return;
        }
        const action=await scanFoFSourceList(state,runId);if(action!=="continue")return;
      }
    }catch(error){
      console.error("[FriendFoFScan]",error);
      await stopFoFScan(t("c.frFoFError",{err:error.message}),runId);
    }finally{
      fofScanLoopActive=false;
      if(fofScanLocalRunId===runId)fofScanLocalRunId="";
      const next=(await chrome.storage.local.get("friendFoFScanState")).friendFoFScanState;
      if(next?.active&&next.runId&&next.runId!==runId)setTimeout(()=>friendFoFScanLoop(next.runId),0);
    }
  }

  async function loadFoFHistory(){
    const stored=await chrome.storage.local.get("friendFoFHistory");
    const history=stored.friendFoFHistory&&typeof stored.friendFoFHistory==="object"?stored.friendFoFHistory:{};
    return history;
  }

  async function saveFoFHistory(history){
    await chrome.storage.local.set({friendFoFHistory:history});
  }

  async function publishFoFSendState(state,message){
    if(message)state.status=message;
    state.updatedAt=Date.now();
    await chrome.storage.local.set({friendFoFRunState:state,friendFoFActive:!!state.active,friendFoFSent:state.sentCount||0,friendFoFSkipped:state.skippedCount||0,friendFoFUncertain:state.uncertainCount||0,friendFoFStatus:state.status||""});
  }

  async function readFoFSendState(runId){
    const stored=await chrome.storage.local.get(["friendFoFRunState","friendFoFActive"]);
    const state=stored.friendFoFRunState;
    if(!state?.active||!stored.friendFoFActive||state.runId!==runId||fofSendStopRequested)return null;
    return state;
  }

  // Facebook often completes location.assign() as an SPA transition, so the
  // content script survives while the current DOM is replaced. Keep the
  // write-ahead run alive and re-enter the same owner tab after that route
  // transition instead of requiring another popup click.
  function scheduleFoFSendResume(runId,delay=1600){
    if(fofSendResumeTimer)clearTimeout(fofSendResumeTimer);
    fofSendResumeTimer=setTimeout(async()=>{
      fofSendResumeTimer=0;
      try{
        const stored=await chrome.storage.local.get(["friendFoFRunState","friendFoFActive"]);
        const state=stored.friendFoFRunState;
        if(!state?.active||!stored.friendFoFActive||state.runId!==runId||fofSendStopRequested)return;
        const tabId=await ownTabId();
        if(state.ownerTabId&&tabId&&state.ownerTabId!==tabId)return;
        if(fofSendLoopActive){scheduleFoFSendResume(runId,500);return;}
        friendFoFSendLoop(runId);
      }catch(error){
        console.error("[FriendFoFResume]",error);
      }
    },Math.max(0,delay));
  }

  async function stopFoFSend(reason,runId=""){
    try{
      const stored=await chrome.storage.local.get("friendFoFRunState");
      const state=stored.friendFoFRunState||{};
      if(runId&&state.runId&&state.runId!==runId)return;
      if(fofSendResumeTimer){clearTimeout(fofSendResumeTimer);fofSendResumeTimer=0;}
      state.active=false;state.nextAllowedAt=0;fofSendStopRequested=true;
      await publishFoFSendState(state,reason||t("c.frFoFStopped"));
    }catch(error){
      console.warn("[FriendFoFSend] stopFoFSend",error);
      if(fofSendResumeTimer){clearTimeout(fofSendResumeTimer);fofSendResumeTimer=0;}
      fofSendStopRequested=true;
    }
  }

  function fofSendRestriction(){
    if(/checkpoint|login|recover/i.test(location.pathname))return t("c.frLogin");
    const text=[...document.querySelectorAll('[role="alert"],[role="status"],[role="dialog"]')].filter(isVisible).map(el=>lower(el.innerText||el.textContent)).join(" ");
    if(/tạm thời bị chặn|không thể gửi lời mời kết bạn|friend request limit|temporarily blocked|you can.t send friend requests|verify your identity|xác minh tài khoản/.test(text))return t("c.frLimited");
    if(/bạn có biết người này|do you know this person/.test(text))return t("c.frWarnDlg");
    return "";
  }

  // Streaming Friends-list sending. Resolve a single-profile card for every
  // action/proof; an ancestor containing another profile is never a card.
  function fofStreamCard(root,key){
    if(!root||!key)return null;
    for(const link of fofProfileLinks(root)){
      if(profileKeyFromHref(link.href)!==key)continue;
      for(let node=link.parentElement,depth=0;node&&node!==root&&depth<14;node=node.parentElement,depth++){
        const keys=new Set(fofProfileLinks(node).map(a=>profileKeyFromHref(a.href)));
        if(keys.size!==1||!keys.has(key))break;
        if(node.querySelector('button,[role="button"]'))return node;
      }
    }
    return null;
  }

  function fofStreamRelationship(card){
    if(!card)return false;
    return [...card.querySelectorAll('button,[role="button"],a[role="link"]')].some(button=>{
      const label=lower(buttonLabel(button));
      return isPendingFriendLabel(label)||/^(?:bạn bè|đã là bạn bè|already friends?|friends|đã gửi lời mời kết bạn|hủy lời mời kết bạn|cancel friend request)$/.test(label);
    });
  }

  function fofStreamButton(root,key){
    const card=fofStreamCard(root,key);
    if(!card||fofStreamRelationship(card)||card.closest('[role="dialog"],[role="menu"]'))return null;
    return [...card.querySelectorAll('button,[role="button"]')].find(isExactAddFriendButton)||null;
  }

  async function startFoFSend(input={}){
    const source=normalizeFoFSource(input.source||{});
    if(!source)return {ok:false,error:t("c.frFoFBadSource")};
    const stored=await chrome.storage.local.get(["friendFoFActive","friendFoFScanActive","friendWarmActive","isRunning","friendConfirmActive","isFeedInteracting","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.values(stored).some(Boolean))return {ok:false,error:t("c.frFoFBusy")};
    const tabId=await ownTabId();
    const minDelay=Math.max(1000,parseInt(input.minDelay)||5000),maxDelay=Math.max(minDelay,parseInt(input.maxDelay)||15000);
    const maxRequests=Math.max(1,Math.min(100000,parseInt(input.maxRequests)||20));
    const minMutual=Math.max(0,Math.min(100000,parseInt(input.minMutual)||0));
    const runId="friend-fof-stream-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
    const state={active:true,stream:true,source,listUrl:"",phase:"source-profile",runId,ownerTabId:tabId,
      config:{mode:MODE_FRIEND_OF_FRIEND,minDelay,maxDelay,maxRequests,minMutual},
      sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],currentCandidateKey:"",currentStage:"",
      scrollRounds:0,endConfirmations:0,lastDomProgressAt:Date.now(),waitStartedAt:Date.now(),
      nextAllowedAt:Date.now()+rand(minDelay,maxDelay),startedAt:Date.now(),status:t("c.frFoFPreparingSend")};
    if(fofSendResumeTimer){clearTimeout(fofSendResumeTimer);fofSendResumeTimer=0;}
    fofSendStopRequested=false;
    await publishFoFSendState(state,state.status);
    setTimeout(()=>friendFoFSendLoop(runId),100);
    return {ok:true,runId};
  }

  async function waitFoFSendSchedule(runId){
    while(true){
      const state=await readFoFSendState(runId);if(!state)return false;
      const remain=(parseInt(state.nextAllowedAt)||0)-Date.now();if(remain<=0)return true;
      const seconds=Math.max(1,Math.ceil(remain/1000));
      if(state.lastShownSecond!==seconds){state.lastShownSecond=seconds;await publishFoFSendState(state,t("c.frFoFWaitSend",{s:seconds,from:state.sentCount,to:state.config.maxRequests}));}
      await sleep(Math.min(500,remain));
    }
  }

  async function fofStreamWait(runId,ms){
    const end=Date.now()+ms;
    while(Date.now()<end){
      if(!await readFoFSendState(runId))return false;
      await sleep(Math.min(500,end-Date.now()));
    }
    return !!await readFoFSendState(runId);
  }

  async function fofStreamAttempt(candidate,state,runId){
    let button=fofStreamButton(fofFriendsListRoot(),candidate.key);
    if(!button)return "skipped";
    try{button.scrollIntoView({behavior:"instant",block:"center"});}
    catch{try{button.scrollIntoView({behavior:"smooth",block:"center"});}catch{}}
    if(!await fofStreamWait(runId,500))return "stopped";
    // Durable write-ahead guard survives Stop, Reset, reload and a new run.
    const history=await loadFoFHistory();
    if(history[candidate.key])return "skipped";
    history[candidate.key]={status:"uncertain",time:Date.now()};
    await saveFoFHistory(history);
    state.currentCandidateKey=candidate.key;state.currentStage="armed";
    await publishFoFSendState(state,t("c.frFoFSending",{name:candidate.name||candidate.key}));
    if(!await readFoFSendState(runId))return "stopped";
    if(fofSendRestriction()||!fofSourceFriendsPageMatches(state)||fofFriendsViewRestricted())return "blocked";
    if([...document.querySelectorAll('[role="dialog"],[role="menu"]')].some(isVisible))return "uncertain";
    button=fofStreamButton(fofFriendsListRoot(),candidate.key);
    if(!button||!button.isConnected||!isExactAddFriendButton(button))return "uncertain";
    // Synchronous dispatch after the final label check: no coordinate retry
    // or fallback can hit a replacement Cancel Request button.
    try{button.click();}catch{return "uncertain";}
    for(let i=0;i<24;i++){
      if(!await fofStreamWait(runId,500))return "stopped";
      if(fofSendRestriction())return "blocked";
      if(!fofSourceFriendsPageMatches(state)||fofFriendsViewRestricted())return "uncertain";
      const card=fofStreamCard(fofFriendsListRoot(),candidate.key);
      if(fofStreamRelationship(card))return "confirmed";
      // A confirmation dialog requires attention; never click unrelated
      // global dialog controls or infer success from another card/toast.
      if([...document.querySelectorAll('[role="dialog"]')].some(isVisible))return "uncertain";
    }
    return "uncertain";
  }

  async function friendFoFSendLoop(runId){
    if(fofSendLoopActive)return;
    fofSendLoopActive=true;fofSendLocalRunId=runId;fofSendStopRequested=false;
    try{
      while(true){
        let state=await readFoFSendState(runId);if(!state)return;
        // Old preview jobs must be explicitly restarted with a chosen source.
        if(!state.stream||!state.source){await stopFoFSend(t("c.frFoFBadSource"),runId);return;}
        const restriction=fofSendRestriction();
        if(restriction){await stopFoFSend(restriction,runId);return;}
        if(state.sentCount>=state.config.maxRequests){await stopFoFSend(t("c.frFoFDone",{from:state.sentCount,to:state.config.maxRequests}),runId);return;}
        if(state.phase==="source-profile"){
          if(fofCurrentProfileKey()!==state.source.key){
            await publishFoFSendState(state,t("c.frFoFOpeningSource",{name:state.source.name||state.source.key}));
            if(!await readFoFSendState(runId))return;
            scheduleFoFSendResume(runId);
            location.assign(state.source.url);return;
          }
          const link=fofFindFriendsLink(state.source.key);
          if(!link){
            if(Date.now()-state.waitStartedAt>FOF_SOURCE_WAIT_MS){await stopFoFSend(t("c.frFoFNoFriendsLink"),runId);return;}
            if(!await fofStreamWait(runId,1000))return;
            continue;
          }
          const listUrl=fofNormalizeUrlForNavigation(link.href);
          if(!listUrl||fofProfileKeyFromFriendsUrl(listUrl)!==state.source.key){await stopFoFSend(t("c.frFoFWrongSource"),runId);return;}
          state.listUrl=listUrl;state.phase="source-list";state.waitStartedAt=Date.now();
          await publishFoFSendState(state,t("c.frFoFOpeningFriends",{name:state.source.name||state.source.key}));
          if(!await readFoFSendState(runId))return;
          scheduleFoFSendResume(runId);
          location.assign(listUrl);return;
        }
        if(!fofSourceFriendsPageMatches(state)){
          state.waitStartedAt=Date.now();
          await publishFoFSendState(state,t("c.frFoFReturningSource"));
          if(!await readFoFSendState(runId))return;
          scheduleFoFSendResume(runId);
          location.assign(state.listUrl);return;
        }
        if(fofFriendsViewRestricted()){await stopFoFSend(t("c.frFoFRestricted"),runId);return;}
        let root=fofFriendsListRoot();
        if(!root){
          if(Date.now()-state.waitStartedAt>FOF_LIST_WAIT_MS){await stopFoFSend(t("c.frFoFSourceUnavailable"),runId);return;}
          if(!await fofStreamWait(runId,1000))return;
          continue;
        }
        const history=await loadFoFHistory();
        const seen=new Set(state.attemptedKeys||[]);
        const profiles=fofCollectListProfiles(root,state.source);
        const minMutual=Math.max(0,parseInt(state.config&&state.config.minMutual)||0);
        let candidate=null;
        let historyChanged=false;
        for(const profile of profiles){
          if(history[profile.key]||seen.has(profile.key))continue;
          if(minMutual>0&&(profile.mutualCount==null||profile.mutualCount<minMutual)){
            // Không đủ bạn chung (hoặc hàng không hiện số) → bỏ qua trong lượt
            // này, vẫn nhớ vào attemptedKeys để không nhặt lại vô hạn.
            seen.add(profile.key);state.skippedCount++;continue;
          }
          const card=fofStreamCard(root,profile.key);
          if(fofStreamRelationship(card)){
            // Persist visible Friends/Pending state too. Facebook may later
            // rerender the card without the relationship label; the durable
            // guard must still prevent a second invite or a cancel click.
            history[profile.key]={status:"existing",time:Date.now(),name:profile.name||profile.key};
            historyChanged=true;
            seen.add(profile.key);state.skippedCount++;
          }else if(fofStreamButton(root,profile.key)){candidate=profile;break;}
        }
        if(historyChanged)await saveFoFHistory(history);
        state.attemptedKeys=[...seen];
        if(candidate){
          state.endConfirmations=0;state.lastDomProgressAt=Date.now();
          await publishFoFSendState(state);
          if(!await waitFoFSendSchedule(runId))return;
          state=await readFoFSendState(runId);if(!state)return;
          // The card is resolved again after the delay in fofStreamAttempt.
          const result=await fofStreamAttempt(candidate,state,runId);
          state=await readFoFSendState(runId);if(!state||result==="stopped")return;
          if(result==="blocked"){await stopFoFSend(fofSendRestriction()||t("c.frWarnShown"),runId);return;}
          const latest=await loadFoFHistory();
          if(result==="confirmed"){
            latest[candidate.key]={status:"confirmed",time:Date.now()};
            await saveFoFHistory(latest);state.sentCount++;
          }else if(result==="uncertain"){
            state.uncertainCount++;
          }else state.skippedCount++;
          state.attemptedKeys=[...new Set([...(state.attemptedKeys||[]),candidate.key])];
          state.currentCandidateKey="";state.currentStage="";
          state.nextAllowedAt=Date.now()+rand(state.config.minDelay,state.config.maxDelay);
          state.lastDomProgressAt=Date.now();
          await publishFoFSendState(state,result==="confirmed"?t("c.frFoFConfirmed",{from:state.sentCount,to:state.config.maxRequests,name:candidate.name||candidate.key}):t("c.frFoFUncertain",{name:candidate.name||candidate.key}));
          // "uncertain" chỉ bỏ qua ứng viên này (đã ghi write-ahead history ở
          // fofStreamAttempt nên không gửi trùng), không dừng cả phiên — khớp
          // cách friendLoop/friendConfirmLoop xử lý uncertain trong file này.
          continue;
        }
        if(!await readFoFSendState(runId))return;
        root=fofFriendsListRoot();
        const before=fofScrollList(root);
        if(!await fofStreamWait(runId,FOF_SCROLL_PROGRESS_WAIT_MS))return;
        if(!fofSourceFriendsPageMatches(state)||fofFriendsViewRestricted())continue;
        const after=fofListSnapshot(fofFriendsListRoot());
        const progressed=fofListAdvanced(before,after);
        state.scrollRounds++;
        if(progressed){state.lastDomProgressAt=Date.now();state.endConfirmations=0;}
        else if(after?.atBottom&&!after.loading)state.endConfirmations++;
        else state.endConfirmations=0;
        await publishFoFSendState(state,t("c.frFoFStreaming",{n:state.sentCount,r:state.scrollRounds}));
        if(state.endConfirmations>=FOF_END_CONFIRMATIONS){await stopFoFSend(t("c.frFoFNoMore",{from:state.sentCount,to:state.config.maxRequests}),runId);return;}
        if(state.scrollRounds>=FOF_MAX_SCROLL_ROUNDS||Date.now()-state.lastDomProgressAt>=FOF_NO_PROGRESS_TIMEOUT_MS){
          await stopFoFSend(t("c.frFoFStreamPartial"),runId);return;
        }
      }
    }catch(error){
      await stopFoFSend(t("c.frFoFError",{err:error.message}),runId);
    }finally{
      fofSendLoopActive=false;
      if(fofSendLocalRunId===runId)fofSendLocalRunId="";
      const next=(await chrome.storage.local.get("friendFoFRunState")).friendFoFRunState;
      if(next?.active&&next.runId&&next.runId!==runId)setTimeout(()=>friendFoFSendLoop(next.runId),0);
    }
  }

  async function resetFoFRun(reason){
    if(fofSendResumeTimer){clearTimeout(fofSendResumeTimer);fofSendResumeTimer=0;}
    fofSendStopRequested=true;
    const saved=await chrome.storage.local.get("friendFoFRunState");
    const state=saved.friendFoFRunState&&typeof saved.friendFoFRunState==="object"?{...saved.friendFoFRunState,active:false,nextAllowedAt:0,candidateIndex:0,sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],currentCandidateKey:"",currentStage:""}:{active:false,candidateIndex:0,sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],currentCandidateKey:"",currentStage:""};
    await publishFoFSendState(state,reason||t("c.frFoFReset"));
  }

  // ---- Incoming friend-request confirmation: separate state machine ----
  // This flow intentionally does not reuse outgoing-invite selectors, counters,
  // history or proof. It only reads public UI text exposed by Facebook.
  function isConfirmSource(){
    return /^\/friends\/requests(?:\/|$)/i.test(location.pathname);
  }

  function confirmTargetUrl(){
    return `${location.origin}/friends/requests`;
  }

  function isExactConfirmButton(el){
    if(!el||!isVisible(el)||el.matches('[aria-disabled="true"],:disabled'))return false;
    const text=lower(buttonLabel(el));
    return /^(?:xác nhận|chap nhan|chấp nhận|accept|confirm)(?:\s+(?:lời mời|request|friend request))?$/.test(text);
  }

  function findConfirmSourceRoot(){
    const roots=[...document.querySelectorAll('div[role="main"],main')];
    const usableRoot=roots.find(root=>rawConfirmButtons(root).length);
    if(usableRoot)return usableRoot;
    const requestHeadings=[...document.querySelectorAll('[role="heading"],h1,h2,h3,h4')]
      .filter(heading=>/(?:lời mời kết bạn|friend requests?)/i.test(cleanText(heading.innerText||heading.textContent)));
    for(const heading of requestHeadings){
      let node=heading.parentElement;
      for(let depth=0;node&&node!==document.body&&depth<14;depth++,node=node.parentElement){
        if(rawConfirmButtons(node).length)return node;
      }
    }
    return rawConfirmButtons(document.body).length?document.body:null;
  }

  function findConfirmProfileLink(cardNode){
    let best=null;
    let bestScore=-1;
    for(const link of [...(cardNode?.querySelectorAll?.("a[href]")||[])]){
      const key=profileKeyFromHref(link.href||"");
      const ariaLabel=lower(link.getAttribute("aria-label")||"");
      if(!key||/\/friends\/requests|\/friends\/suggestions|\/friends\//i.test(link.href||""))continue;
      if(link.closest("table")||/(?:bạn chung|mutual friend|common friend)/i.test(ariaLabel))continue;
      let score=1;
      if(link.querySelector("img"))score+=5;
      if(link.closest('h1,h2,h3,h4,strong,[role="heading"]'))score+=3;
      if(link.getAttribute("aria-label"))score+=2;
      if(score>bestScore){bestScore=score;best=link;}
    }
    return best;
  }

  function confirmCandidateFromButton(button,sourceRoot){
    if(!isExactConfirmButton(button)||button.closest('[role="dialog"],[role="menu"]'))return null;
    const main=sourceRoot||document.querySelector('div[role="main"],main');
    if(!main||!main.contains(button))return null;
    let node=button.parentElement;
    for(let depth=0;node&&node!==main&&depth<12;depth++,node=node.parentElement){
      const link=findConfirmProfileLink(node);
      if(!link)continue;
      const key=profileKeyFromHref(link.href||"");
      if(!key)continue;
      // See candidateFromButton above: a normal card can legitimately contain
      // a second small profile link (e.g. a mutual-friend avatar), so
      // rejecting on multiple distinct keys here throws out real candidates.
      const cardText=cleanText(node.innerText||node.textContent);
      const linkText=cleanText(link.getAttribute("aria-label")||link.innerText||link.textContent);
      const name=(linkText||cardText.split(" ").slice(0,8).join(" ")).slice(0,120);
      const mutualMatch=cardText.match(/(?:^|\s)(\d{1,4})\s+(?:bạn chung|mutual friends?)(?:\s|$)/i)
        ||cardText.match(/(?:có|has)\s+(\d{1,4})\s+(?:bạn chung|mutual friends?)/i);
      return {
        key,name,url:link.href,button,card:node,
        mutualCount:mutualMatch?parseInt(mutualMatch[1]):null
      };
    }
    return null;
  }

  function rawConfirmButtons(root){
    return root?[...root.querySelectorAll('button,[role="button"]')].filter(isExactConfirmButton):[];
  }

  function findConfirmScrollContainer(anchor){
    let node=anchor?.parentElement;
    for(let depth=0;node&&node!==document.body&&depth<18;depth++,node=node.parentElement){
      const style=getComputedStyle(node);
      if(node.scrollHeight>node.clientHeight+80&&/(?:auto|scroll|overlay)/i.test(style.overflowY||""))return node;
    }
    return document.scrollingElement||document.documentElement;
  }

  function scrollConfirmSource(sourceRoot){
    const buttons=rawConfirmButtons(sourceRoot);
    const anchor=buttons[buttons.length-1];
    if(anchor?.scrollIntoView)anchor.scrollIntoView({block:"end",inline:"nearest",behavior:"auto"});
    const scroller=findConfirmScrollContainer(anchor);
    const distance=Math.max(650,(scroller?.clientHeight||innerHeight)*.72);
    if(scroller&&scroller!==document.documentElement&&scroller!==document.body){
      scroller.scrollBy({top:distance,behavior:"smooth"});
      return;
    }
    window.scrollBy({top:distance,behavior:"smooth"});
  }

  function evaluateConfirmCandidate(candidate,filters){
    if(filters.minMutual>0){
      if(candidate.mutualCount==null)return {decision:"reject",reasonCodes:["mutual-unknown"]};
      if(candidate.mutualCount<filters.minMutual)return {decision:"reject",reasonCodes:["mutual-too-low"]};
    }
    return {decision:"pass",reasonCodes:["eligible"]};
  }

  function collectConfirmCandidates(state,history){
    const main=findConfirmSourceRoot();
    if(!main)return {ready:false,candidates:[]};
    const attempted=new Set(state.attemptedKeys||[]);
    const map=new Map();
    for(const button of rawConfirmButtons(main)){
      const candidate=confirmCandidateFromButton(button,main);
      if(!candidate||attempted.has(candidate.key)||history[candidate.key])continue;
      const evaluated=evaluateConfirmCandidate(candidate,state.config.filters);
      Object.assign(candidate,evaluated);
      if(!map.has(candidate.key))map.set(candidate.key,candidate);
    }
    const candidates=[...map.values()];
    candidates.sort((a,b)=>{
      const rectA=a.button.getBoundingClientRect(),rectB=b.button.getBoundingClientRect();
      if(Math.abs(rectA.top-rectB.top)>12)return rectA.top-rectB.top;
      return rectA.left-rectB.left;
    });
    return {ready:true,candidates};
  }

  function highlightConfirmCandidates(candidates){
    document.querySelectorAll('[data-friend-confirm-scan="1"]').forEach(el=>{delete el.dataset.friendConfirmScan;el.style.outline="";});
    for(const candidate of candidates){
      candidate.button.dataset.friendConfirmScan="1";
      candidate.button.style.outline=`3px solid ${candidate.decision==="pass"?"#00a400":candidate.decision==="reject"?"#d93025":"#f0a000"}`;
      candidate.button.title=`Auto vjp: ${candidate.name||candidate.key}`;
    }
  }

  function confirmRestriction(){
    if(/checkpoint|login|recover/i.test(location.pathname))return t("c.frLogin");
    const text=[...document.querySelectorAll('[role="alert"],[role="status"],[role="dialog"]')]
      .filter(isVisible).map(el=>lower(el.innerText||el.textContent)).join(" ");
    if(/tạm thời bị chặn|không thể xác nhận|không thể chấp nhận|temporarily blocked|you can.t confirm|can.t accept|verify your identity|xác minh tài khoản/.test(text))return t("c.frConfirmLimited");
    if(/bạn có biết người này|do you know this person/.test(text))return t("c.frWarnDlg");
    return "";
  }

  function confirmLiveMessages(){
    return [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live="polite"],[aria-live="assertive"]')]
      .filter(isVisible).map(el=>lower(el.innerText||el.textContent)).filter(Boolean);
  }

  function confirmCardShowsAccepted(profileKey){
    if(!profileKey)return false;
    const root=findConfirmSourceRoot()||document.body;
    const accepted=/(?:đã xác nhận|đã chấp nhận lời mời kết bạn|bây giờ là bạn bè|request accepted|you are now friends|now friends)/i;
    for(const link of [...root.querySelectorAll('a[href]')]){
      if(profileKeyFromHref(link.href||"")!==profileKey)continue;
      let node=link.parentElement;
      for(let depth=0;node&&node!==root&&depth<10;depth++,node=node.parentElement){
        // A request card is a small subtree with at most its own action. Do
        // not accept a matching phrase inherited from the whole request list.
        if(rawConfirmButtons(node).length<=1&&accepted.test(cleanText(node.innerText||node.textContent)))return true;
      }
    }
    return false;
  }

  async function publishConfirmState(state,message){
    if(message)state.status=message;
    state.updatedAt=Date.now();
    await chrome.storage.local.set({
      friendConfirmRunState:state,
      friendConfirmActive:!!state.active,
      friendConfirmAccepted:state.acceptedCount||0,
      friendConfirmSkipped:state.skippedCount||0,
      friendConfirmUncertain:state.uncertainCount||0,
      friendConfirmStatus:state.status||""
    });
  }

  async function readConfirmActiveState(runId){
    const stored=await chrome.storage.local.get("friendConfirmRunState");
    const state=stored.friendConfirmRunState;
    if(!state?.active||state.runId!==runId||confirmStopRequested)return null;
    return state;
  }

  async function stopConfirmRun(reason,runId=""){
    try{
      const stored=await chrome.storage.local.get("friendConfirmRunState");
      const state=stored.friendConfirmRunState||{};
      if(runId&&state.runId&&state.runId!==runId)return;
      state.active=false;
      state.nextAllowedAt=0;
      confirmStopRequested=true;
      await publishConfirmState(state,reason||t("c.frConfirmStopped"));
    }catch(error){
      console.warn("[FriendConfirm] stopConfirmRun",error);
      confirmStopRequested=true;
    }
  }

  async function waitConfirmSchedule(runId){
    while(true){
      const state=await readConfirmActiveState(runId);
      if(!state)return false;
      const remain=(parseInt(state.nextAllowedAt)||0)-Date.now();
      if(remain<=0)return true;
      const seconds=Math.max(1,Math.ceil(remain/1000));
      if(state.lastShownSecond!==seconds){
        state.lastShownSecond=seconds;
        await publishConfirmState(state,t("c.frConfirmWait",{s:seconds,from:state.acceptedCount,to:state.config.maxRequests}));
      }
      await sleep(Math.min(500,remain));
    }
  }

  async function attemptConfirmCandidate(candidate,runId){
    if(!await readConfirmActiveState(runId))return {kind:"stopped"};
    const beforeAlerts=new Set(confirmLiveMessages());
    candidate.button.style.outline="3px solid #00a400";
    if(!await trustedClick(candidate.button))return {kind:"failed",message:t("c.frConfirmNoBtn")};
    for(let i=0;i<30;i++){
      if(!await readConfirmActiveState(runId))return {kind:"stopped"};
      const restriction=confirmRestriction();
      if(restriction)return {kind:"blocked",message:restriction};
      const successAlert=confirmLiveMessages()
        .some(text=>!beforeAlerts.has(text)&&/(?:đã xác nhận|đã chấp nhận|bây giờ là bạn bè|request accepted|you are now friends|now friends)/.test(text));
      // Facebook commonly destroys the old card/button node on confirmation.
      // Re-find the profile card by key rather than reading the stale button.
      if(successAlert||confirmCardShowsAccepted(candidate.key))return {kind:"confirmed"};
      await sleep(500);
    }
    return {kind:"uncertain",message:t("c.frConfirmNoProof")};
  }

  async function friendConfirmLoop(runId){
    if(confirmLoopActive)return;
    confirmLoopActive=true;
    confirmLocalRunId=runId;
    confirmStopRequested=false;
    try{
      while(true){
        let state=await readConfirmActiveState(runId);
        if(!state)return;
        // A resume can run before the popup's Start command replaces its
        // provisional config. Normalize before any filter field is read.
        if(!state.config?.filters){
          state.config=normalizeConfirmConfig(state.config||{});
          await publishConfirmState(state);
        }
        if(state.acceptedCount>=state.config.maxRequests){await stopConfirmRun(t("c.frConfirmDone",{from:state.acceptedCount,to:state.config.maxRequests}),runId);return;}
        if(!isConfirmSource()){
          await publishConfirmState(state,t("c.frConfirmOpening"));
          location.assign(confirmTargetUrl());
          return;
        }
        const restriction=confirmRestriction();
        if(restriction){await stopConfirmRun(restriction,runId);return;}
        if(!await waitConfirmSchedule(runId))return;
        state=await readConfirmActiveState(runId);
        if(!state)return;
        // Start is self-contained: evaluate the saved filters here on every
        // candidate. The optional popup scan is preview-only and never gates
        // the confirmation loop.
        await publishConfirmState(state,t("c.frConfirmAutoFilter"));
        const history=await loadConfirmHistory();
        const found=collectConfirmCandidates(state,history);
        if(!found.candidates.length){
          state.emptyRounds=(parseInt(state.emptyRounds)||0)+1;
          if(state.emptyRounds<9){
            await publishConfirmState(state,t("c.frConfirmLoading",{n:state.emptyRounds}));
            scrollConfirmSource(findConfirmSourceRoot());
            await sleep(1400);
            continue;
          }
          if((parseInt(state.sourceReloads)||0)<1){
            state.sourceReloads=(parseInt(state.sourceReloads)||0)+1;
            state.emptyRounds=0;
            await publishConfirmState(state,t("c.frConfirmReload"));
            location.reload();
            return;
          }
          await stopConfirmRun(t("c.frConfirmNoMore",{from:state.acceptedCount,to:state.config.maxRequests}),runId);
          return;
        }
        state.emptyRounds=0;
        state.sourceReloads=0;
        const candidate=found.candidates[0];
        state.attemptedKeys=[...(state.attemptedKeys||[]),candidate.key].slice(-20000);
        if(candidate.decision!=="pass"){
          state.skippedCount=(parseInt(state.skippedCount)||0)+1;
          history[candidate.key]={status:candidate.decision,time:Date.now()};
          await saveConfirmHistory(history);
          const reason=candidate.reasonCodes.map(code=>t(`fr.confirmReason_${code}`)||code).join(", ");
          await publishConfirmState(state,t("c.frConfirmSkipped",{name:candidate.name||t("c.frSomeone"),reason}));
          continue;
        }
        await publishConfirmState(state,t("c.frConfirmChecking",{name:candidate.name||t("c.frSomeone")}));
        const result=await attemptConfirmCandidate(candidate,runId);
        state=await readConfirmActiveState(runId);
        if(!state||result.kind==="stopped")return;
        if(result.kind==="blocked"){await stopConfirmRun(result.message||t("c.frConfirmLimited"),runId);return;}
        if(result.kind==="confirmed"){
          state.acceptedCount=(parseInt(state.acceptedCount)||0)+1;
          history[candidate.key]={status:"confirmed",time:Date.now()};
          await saveConfirmHistory(history);
          state.nextAllowedAt=state.acceptedCount<state.config.maxRequests?Date.now()+rand(state.config.minDelay,state.config.maxDelay):0;
          await publishConfirmState(state,t("c.frConfirmAccepted",{from:state.acceptedCount,to:state.config.maxRequests,name:candidate.name||candidate.key}));
        }else if(result.kind==="uncertain"){
          state.uncertainCount=(parseInt(state.uncertainCount)||0)+1;
          history[candidate.key]={status:"uncertain",time:Date.now()};
          await saveConfirmHistory(history);
          state.nextAllowedAt=Date.now()+rand(state.config.minDelay,state.config.maxDelay);
          await publishConfirmState(state,t("c.frConfirmUncertain",{name:candidate.name||t("c.frSomeone")}));
        }else{
          state.skippedCount=(parseInt(state.skippedCount)||0)+1;
          history[candidate.key]={status:"skipped",time:Date.now()};
          await saveConfirmHistory(history);
          state.nextAllowedAt=Date.now()+rand(state.config.minDelay,state.config.maxDelay);
          await publishConfirmState(state,t("c.frConfirmSkipped",{name:candidate.name||t("c.frSomeone"),reason:result.message||t("c.frConfirmNoBtn")}));
        }
      }
    }catch(error){
      console.error("[FriendConfirm]",error);
      await stopConfirmRun(t("c.frConfirmError",{err:error.message}),runId);
    }finally{
      confirmLoopActive=false;
      if(confirmLocalRunId===runId)confirmLocalRunId="";
      // Resume and Start can overlap after navigation. When the old loop
      // releases the lock, continue the newer active run automatically.
      const next=await chrome.storage.local.get("friendConfirmRunState");
      const nextRun=next.friendConfirmRunState;
      if(nextRun?.active&&nextRun.runId&&nextRun.runId!==runId){
        setTimeout(()=>friendConfirmLoop(nextRun.runId),0);
      }
    }
  }

  async function startFriendConfirm(inputConfig){
    const other=await chrome.storage.local.get(["isRunning","friendFoFActive","friendFoFScanActive","isFeedInteracting","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.values(other).some(Boolean))return {ok:false,error:t("c.frBusyOther")};
    const config=normalizeConfirmConfig(inputConfig);
    const tabId=await ownTabId();
    const runId=`friend-confirm-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const state={active:true,runId,ownerTabId:tabId,mode:MODE_CONFIRM,config,acceptedCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],emptyRounds:0,sourceReloads:0,nextAllowedAt:Date.now()+rand(config.minDelay,config.maxDelay),status:t("c.frConfirmPreparing"),startedAt:Date.now()};
    confirmStopRequested=false;
    await publishConfirmState(state,state.status);
    setTimeout(()=>friendConfirmLoop(runId),100);
    return {ok:true,runId};
  }

  async function scanFriendConfirm(inputConfig){
    const config=normalizeConfirmConfig(inputConfig);
    if(!isConfirmSource())return {ok:false,needsNavigation:true,targetUrl:confirmTargetUrl()};
    const state={mode:MODE_CONFIRM,config,attemptedKeys:[]};
    const history=await loadConfirmHistory();
    const found=collectConfirmCandidates(state,history);
    highlightConfirmCandidates(found.candidates);
    return {ok:true,count:found.candidates.length,sourceReady:found.ready,candidates:found.candidates.slice(0,50).map(candidate=>({key:candidate.key,name:candidate.name,mutualCount:candidate.mutualCount,decision:candidate.decision,reasonCodes:candidate.reasonCodes}))};
  }

  async function friendLoop(runId){
    if(loopActive)return;
    loopActive=true;
    localRunId=runId;
    stopRequested=false;
    try{
      while(true){
        let state=await readActiveState(runId);
        if(!state)return;
        if(state.sentCount>=state.config.maxRequests){
          await stopRun(t("c.frDoneAll",{from:state.sentCount,to:state.config.maxRequests}),runId);
          return;
        }
        const restriction=pageRestriction();
        if(restriction){await stopRun(restriction,runId);return;}
        if(!isCorrectSource(state)){
          const target=expectedSourceUrl(state);
          if(!target){await stopRun(t("c.frNoSource"),runId);return;}
          await publishState(state,t("c.frOpening"));
          location.assign(target);
          return;
        }
        if(state.mode===MODE_GROUP_COMMON&&!isGroupCommonAllPage()){
          const action=await openGroupCommonFullList(state,runId);
          if(action==="continue")continue;
          return;
        }
        if(state.mode===MODE_GROUP_COMMON&&!groupCommonFullListReady()){
          const action=await waitForGroupContent(state,runId,"full");
          if(action==="continue")continue;
          return;
        }
        if(!await waitForSchedule(runId))return;
        state=await readActiveState(runId);
        if(!state)return;
        const history=await loadHistory();
        const found=collectCandidates(state,history);
        if(!found.candidates.length){
          const action=await moveOrFinishEmpty(state,runId);
          if(action!=="continue")return;
          continue;
        }
        state.emptyRounds=0;
        state.sourceReloads=0;
        state.groupWaitStartedAt=Date.now();
        const candidate=found.candidates[0];
        state.attemptedKeys=[...(state.attemptedKeys||[]),candidate.key].slice(-20000);
        const mutualText=candidate.mutualCount==null?"":t("c.frMutual",{n:candidate.mutualCount});
        await publishState(state,t("c.frSending",{name:candidate.name||t("c.frSomeone")}));
        const result=await attemptCandidate(candidate,runId,state.mode);
        state=await readActiveState(runId);
        if(!state||result.kind==="stopped")return;
        if(result.kind==="blocked"){
          await stopRun(result.message||t("c.frBlockedOp"),runId);
          return;
        }
        if(result.kind==="confirmed"){
          state.sentCount=(parseInt(state.sentCount)||0)+1;
          history[candidate.key]={status:"confirmed",time:Date.now(),name:candidate.name,mode:state.mode};
          await saveHistory(history);
          state.nextAllowedAt=state.sentCount<state.config.maxRequests?Date.now()+rand(state.config.minDelay,state.config.maxDelay):0;
          await publishState(state,t("c.frConfirmed",{from:state.sentCount,to:state.config.maxRequests,name:candidate.name||candidate.key}));
        }else if(result.kind==="uncertain"){
          state.uncertainCount=(parseInt(state.uncertainCount)||0)+1;
          history[candidate.key]={status:"uncertain",time:Date.now(),name:candidate.name,mode:state.mode};
          await saveHistory(history);
          state.nextAllowedAt=Date.now()+rand(state.config.minDelay,state.config.maxDelay);
          await publishState(state,t("c.frSkippedDup",{msg:result.message,from:state.sentCount,to:state.config.maxRequests}));
        }else{
          state.skippedCount=(parseInt(state.skippedCount)||0)+1;
          state.nextAllowedAt=Date.now()+rand(state.config.minDelay,state.config.maxDelay);
          await publishState(state,t("c.frSkipped",{msg:result.message||t("c.frSkippedOne"),from:state.sentCount,to:state.config.maxRequests}));
        }
      }
    }catch(error){
      console.error("[Friend]",error);
      await stopRun(t("c.frError",{err:error.message}),runId);
    }finally{
      loopActive=false;
      if(localRunId===runId)localRunId="";
      // Popup luôn persist run trước khi đưa tab tới trang Gợi ý. Lúc trang
      // vừa tải, resume của run cũ và lệnh Start mới có thể chồng nhau: run
      // mới thấy `loopActive` rồi trả về, còn run cũ chỉ kết thúc sau đó. Nếu
      // không handoff ở đây, state mới bị kẹt mãi ở "Đang chuẩn bị nguồn" dù
      // Facebook đã có các nút Thêm bạn bè hợp lệ.
      const next=await chrome.storage.local.get("friendRunState");
      const nextRun=next.friendRunState;
      if(nextRun?.active&&nextRun.runId&&nextRun.runId!==runId){
        setTimeout(()=>friendLoop(nextRun.runId),0);
      }
    }
  }

  async function startFriend(inputConfig){
    if(inputConfig?.mode===MODE_CONFIRM)return startFriendConfirm(inputConfig);
    if(inputConfig?.mode===MODE_FRIEND_OF_FRIEND)return startFoFSend(inputConfig);
    const other=await chrome.storage.local.get(["friendConfirmActive","friendFoFActive","friendFoFScanActive","isFeedInteracting","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.values(other).some(Boolean))return {ok:false,error:t("c.frBusyOther")};
    const config=normalizeConfig(inputConfig);
    if(config.mode===MODE_GROUP_COMMON&&!config.groups.length)return {ok:false,error:t("p.frNeedGroups")};
    const tabId=await ownTabId();
    const runId=`friend-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const state={
      active:true,runId,ownerTabId:tabId,mode:config.mode,config,sentCount:0,skippedCount:0,uncertainCount:0,
      attemptedKeys:[],groupIndex:0,emptyRounds:0,sourceReloads:0,nextAllowedAt:Date.now()+rand(config.minDelay,config.maxDelay),
      groupWaitKey:"",groupWaitStartedAt:0,
      status:t("c.frPreparing"),startedAt:Date.now()
    };
    stopRequested=false;
    await chrome.storage.sync.set({minDelay:config.minDelay,maxDelay:config.maxDelay,maxRequests:config.maxRequests,friendMode:config.mode,friendMinMutual:config.minMutual});
    await publishState(state,state.status);
    setTimeout(()=>friendLoop(runId),100);
    return {ok:true,runId};
  }

  async function scanFriend(inputConfig){
    const config=normalizeConfig(inputConfig);
    const state={mode:config.mode,config,groupIndex:0,attemptedKeys:[]};
    if(!isCorrectSource(state))return {ok:false,needsNavigation:true,targetUrl:expectedSourceUrl(state)};
    if(config.mode===MODE_GROUP_COMMON&&!isGroupCommonAllPage()){
      const link=findGroupCommonAllLink();
      return link
        ? {ok:false,needsNavigation:true,targetUrl:new URL(link.href,location.origin).href,message:t("c.frOpeningFull")}
        : {ok:false,sourceReady:false,error:t("c.frNoSeeAllBtn")};
    }
    if(config.mode===MODE_GROUP_COMMON&&!groupCommonFullListReady()){
      return {ok:false,sourceReady:false,error:t("c.frFullLoading")};
    }
    const history=await loadHistory();
    const found=collectCandidates(state,history);
    highlightCandidates(found.candidates);
    return {ok:true,count:found.candidates.length,sourceReady:found.ready,candidates:found.candidates.slice(0,20).map(c=>({key:c.key,name:c.name,mutualCount:c.mutualCount}))};
  }

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg.action==="friendFoFScanOwn"){
      startFoFOwnScan().then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="friendFoFScanSource"){
      startFoFSourceScan(msg.source||{}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="friendFoFStart"){
      startFoFSend(msg.config||{}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="friendFoFStop"){
      Promise.all([stopFoFScan(t("p.frStoppedByUser")),stopFoFSend(t("p.frStoppedByUser"))]).then(()=>sendResponse({ok:true}));
      return true;
    }
    if(msg.action==="friendFoFReset"){
      Promise.all([stopFoFScan(t("p.frResetDone")),resetFoFRun(t("p.frResetDone"))]).then(()=>sendResponse({ok:true}));
      return true;
    }
    if(msg.action==="friendFoFClearHistory"){
      chrome.storage.local.remove("friendFoFHistory").then(()=>sendResponse({ok:true}));
      return true;
    }
    if(msg.action==="friendConfirmStart"){
      startFriendConfirm(msg.config||{}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="friendConfirmStop"){
      stopConfirmRun(t("p.frStoppedByUser")).then(()=>sendResponse({ok:true}));
      return true;
    }
    if(msg.action==="friendConfirmReset"){
      stopConfirmRun(t("p.frResetDone")).then(async()=>{
        const stored=await chrome.storage.local.get("friendConfirmRunState"),state=stored.friendConfirmRunState||{};
        Object.assign(state,{acceptedCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],emptyRounds:0,sourceReloads:0});
        await publishConfirmState(state,t("p.frResetDone"));
        sendResponse({ok:true});
      });
      return true;
    }
    if(msg.action==="friendConfirmScan"){
      scanFriendConfirm(msg.config||{}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="friendStart"||msg.action==="start"){
      startFriend(msg.config||{}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="friendStop"||msg.action==="stop"){
      stopRun(t("p.frStoppedByUser")).then(()=>sendResponse({ok:true}));
      return true;
    }
    if(msg.action==="friendReset"){
      stopRun(t("p.frResetDone")).then(async()=>{
        const stored=await chrome.storage.local.get("friendRunState"),state=stored.friendRunState||{};
        Object.assign(state,{sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],groupIndex:0,emptyRounds:0,sourceReloads:0,groupWaitKey:"",groupWaitStartedAt:0});
        await publishState(state,t("p.frResetDone"));
        sendResponse({ok:true});
      });
      return true;
    }
    if(msg.action==="friendClearHistory"){
      chrome.storage.local.remove("friendProfileHistory").then(()=>sendResponse({ok:true}));
      return true;
    }
    if(msg.action==="friendScan"||msg.action==="scan"){
      scanFriend(msg.config||{}).then(sendResponse).catch(e=>sendResponse({ok:false,error:e.message}));
      return true;
    }
    if(msg.action==="getStatus"){
      chrome.storage.local.get(["friendRunState","sentCount","isRunning","friendFoFRunState","friendFoFActive"]).then(s=>sendResponse({isRunning:!!s.isRunning||!!s.friendFoFActive,sentCount:s.sentCount||s.friendFoFRunState?.sentCount||0,state:s.friendRunState||s.friendFoFRunState||null}));
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.friendRunState?.newValue?.active===false||changes.isRunning?.newValue===false)stopRequested=true;
    if(changes.friendConfirmRunState?.newValue?.active===false||changes.friendConfirmActive?.newValue===false)confirmStopRequested=true;
    if(changes.friendFoFScanState?.newValue?.active===false||changes.friendFoFScanActive?.newValue===false)fofScanStopRequested=true;
    if(changes.friendFoFRunState?.newValue?.active===false||changes.friendFoFActive?.newValue===false)fofSendStopRequested=true;
  });

  (async()=>{
    const stored=await chrome.storage.local.get("friendFoFScanState");
    const state=stored.friendFoFScanState;
    if(!state?.active||!state.runId)return;
    const tabId=await ownTabId();
    if(state.ownerTabId&&tabId&&state.ownerTabId!==tabId)return;
    await sleep(1800);
    friendFoFScanLoop(state.runId);
  })();

  (async()=>{
    const stored=await chrome.storage.local.get("friendFoFRunState");
    const state=stored.friendFoFRunState;
    if(!state?.active||!state.runId)return;
    const tabId=await ownTabId();
    if(state.ownerTabId&&tabId&&state.ownerTabId!==tabId)return;
    await sleep(1800);
    friendFoFSendLoop(state.runId);
  })();

  (async()=>{
    const stored=await chrome.storage.local.get("friendRunState");
    const state=stored.friendRunState;
    if(!state?.active||!state.runId)return;
    const tabId=await ownTabId();
    if(state.ownerTabId&&tabId&&state.ownerTabId!==tabId)return;
    await sleep(1800);
    friendLoop(state.runId);
  })();

  (async()=>{
    const stored=await chrome.storage.local.get("friendConfirmRunState");
    const state=stored.friendConfirmRunState;
    if(!state?.active||!state.runId)return;
    const tabId=await ownTabId();
    if(state.ownerTabId&&tabId&&state.ownerTabId!==tabId)return;
    await sleep(1800);
    friendConfirmLoop(state.runId);
  })();

  console.log("[Friend] Friend request and confirmation engines loaded");
})();
