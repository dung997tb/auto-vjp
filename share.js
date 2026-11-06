// share.js - chia se mot bai Facebook vao cac nhom da tham gia
// Logic nay co state, selector va xac nhan rieng; khong dung lai vong lap Comment AI/Group Post.
(function(){
  "use strict";
  if(window.__fbGroupShareV1825)return;
  window.__fbGroupShareV1825=true;
  console.log("[GroupShare] share.js loaded v1.9.13");

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const rand=(min,max)=>Math.floor(Math.random()*(Math.max(min,max)-Math.min(min,max)+1))+Math.min(min,max);
  // Every internal wait loop here is bounded by its own deadline check, but a
  // single stuck await inside one iteration (e.g. an unusually slow
  // chrome.storage call) can still keep the whole attempt from ever reaching
  // that check again. A hard outer race guarantees the group is always
  // skipped/retried instead of the feature hanging forever.
  function withHardTimeout(promise,ms,message){
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(message),{timedOut:true})),ms);});
    return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
  }
  const GROUP_SHARE_AUTO={
    groupReadyWait:45000,groupStableWait:1600,captionWait:45000,
    composerWait:45000,previewWait:30000,submitWait:30000,
    postVisibleWait:30000,afterPostMin:8,afterPostMax:12
  };
  let loopActive=false,stopRequested=false,currentRunId="",ownTabIdCache=0;

  function normalized(value){return String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").replace(/\s+/g," ").trim();}
  function isVisible(element){
    if(!element||!element.isConnected)return false;
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    return rect.width>0&&rect.height>0&&style.display!=="none"&&style.visibility!=="hidden";
  }
  function labelOf(element){return normalized(element?.getAttribute?.("aria-label")||element?.innerText||element?.textContent).toLocaleLowerCase("vi");}
  function facebookHost(host){const value=String(host||"").toLowerCase();return value==="facebook.com"||value.endsWith(".facebook.com")||value==="fb.watch";}
  function cleanedFacebookUrl(value){
    try{
      const url=new URL(String(value||""),location.href);if(!facebookHost(url.hostname))return "";
      url.hash="";["__cft__","__tn__","mibextid","ref","refid","locale","comment_id","reply_comment_id"].forEach(key=>url.searchParams.delete(key));
      return url.toString();
    }catch{return "";}
  }
  function postUrlKey(value){
    try{
      const url=new URL(String(value||""),location.href),path=url.pathname.replace(/\/+$/,"");
      const group=path.match(/^\/groups\/([^/]+)\/(?:posts?|permalink)\/([^/?#]+)/i);
      const post=path.match(/^\/([^/]+)\/posts?\/([^/?#]+)/i);
      const share=path.match(/^\/share\/(p|r|v)\/([^/?#]+)/i);
      const reel=path.match(/^\/(?:reel|videos?|watch)\/([^/?#]+)/i);
      const story=url.searchParams.get("story_fbid"),fbid=url.searchParams.get("fbid");
      if(group)return `group:${group[1].toLowerCase()}:${group[2].toLowerCase()}`;
      if(post)return `post:${post[1].toLowerCase()}:${post[2].toLowerCase()}`;
      if(story)return `story:${String(story).toLowerCase()}`;
      if(fbid)return `media:${String(fbid).toLowerCase()}`;
      if(share)return `share:${share[1].toLowerCase()}:${share[2].toLowerCase()}`;
      if(reel)return `media:${reel[1].toLowerCase()}`;
      return `${url.hostname.toLowerCase()}${path.toLowerCase()}`;
    }catch{return "";}
  }
  function sourceUrlMatches(current,expected){
    const a=postUrlKey(current),b=postUrlKey(expected);if(a&&b&&a===b)return true;
    try{
      const currentUrl=new URL(current),expectedUrl=new URL(expected);
      return currentUrl.hostname.toLowerCase()===expectedUrl.hostname.toLowerCase()&&currentUrl.pathname.replace(/\/+$/,"")===expectedUrl.pathname.replace(/\/+$/,"");
    }catch{return false;}
  }

  async function ownTabId(){
    if(ownTabIdCache)return ownTabIdCache;
    try{const response=await chrome.runtime.sendMessage({action:"getSenderTabId"});ownTabIdCache=parseInt(response?.tabId)||0;}catch(_){ }
    return ownTabIdCache;
  }
  async function readRun(runId=currentRunId){
    const state=await chrome.storage.local.get(["groupShareActive","groupShareConfig","groupShareRunId","groupShareOwnerTabId","groupShareStage","groupShareSourceText","groupShareSourceKey","groupShareSourceResolvedUrl","groupShareSourceMediaKeys","groupShareSourceNavigationAt","groupShareIndex","groupShareDone","groupShareSkipped","groupShareTotal","groupShareNextAt","groupSharePendingCaption","groupSharePendingIndex","groupShareRecentCaptions","groupShareSubmitDispatchedAt"]);
    const tabId=await ownTabId();
    if(!state.groupShareActive||!state.groupShareConfig)return null;
    if(runId&&state.groupShareRunId!==runId)return null;
    if(state.groupShareOwnerTabId&&tabId&&Number(state.groupShareOwnerTabId)!==Number(tabId))return null;
    return state;
  }
  async function stillActive(runId,index){
    if(stopRequested)return false;
    const state=await readRun(runId);if(!state)return false;
    return index===undefined||Number(state.groupShareIndex||0)===Number(index);
  }
  // All mutable run state goes through this gate.  A stale callback from a
  // previous navigation/run must not advance counters or overwrite the status
  // of the currently active Share session.
  async function writeRunState(runId,index,values){
    if(!await stillActive(runId,index))return false;
    await chrome.storage.local.set(values);return true;
  }
  async function setStatus(runId,status,extra={},index){
    return writeRunState(runId,index,{groupShareStatus:status,...extra});
  }
  async function stopRun(runId,status,extra={}){
    const state=await chrome.storage.local.get(["groupShareActive","groupShareRunId"]);
    if(runId&&state.groupShareRunId!==runId)return;
    if(!state.groupShareActive)return;
    stopRequested=true;
    await chrome.storage.local.set({groupShareActive:false,groupShareNextAt:0,groupShareStatus:status,...extra});
  }
  async function shareSleep(ms,runId,index){
    const end=Date.now()+Math.max(0,ms);
    while(Date.now()<end){if(!await stillActive(runId,index))return false;await sleep(Math.min(500,end-Date.now()));}
    return stillActive(runId,index);
  }
  async function waitSchedule(nextAt,runId,index,total,name){
    while(Date.now()<nextAt){
      if(!await stillActive(runId,index))return false;
      const seconds=Math.max(1,Math.ceil((nextAt-Date.now())/1000));
      if(!await setStatus(runId,t("sh2.wait",{s:seconds,i:index+1,total:total,name:name}),{},index))return false;
      if(!await shareSleep(Math.min(1000,Math.max(1,nextAt-Date.now())),runId,index))return false;
    }
    return stillActive(runId,index);
  }
  async function trustedMouse(element,runId,index){
    if(!await stillActive(runId,index)||!isVisible(element))return false;
    element.scrollIntoView({block:"center",inline:"center"});
    if(!await shareSleep(180,runId,index)||!isVisible(element))return false;
    const rect=element.getBoundingClientRect(),x=Math.max(1,Math.min(innerWidth-2,rect.left+rect.width/2)),y=Math.max(1,Math.min(innerHeight-2,rect.top+rect.height/2));
    // Chỉ gửi trusted click khi điểm giữa element không bị overlay che; nếu bị
    // che, cú click theo toạ độ rơi vào menu đang đè lên (đã trúng "Đăng xuất"
    // thực tế) — rơi về click thẳng trên element cho an toàn.
    const hit=document.elementFromPoint(x,y);
    if(hit&&(hit===element||element.contains(hit)||hit.contains(element))){
      try{const response=await chrome.runtime.sendMessage({action:"trustedMouse",kind:"click",x,y});if(response?.ok)return true;}catch{}
    }
    try{element.click();return true;}catch{return false;}
  }
  async function clickOnce(element,runId,index){
    if(!await stillActive(runId,index)||!isVisible(element))return false;
    return trustedMouse(element,runId,index);
  }

  const SOURCE_MESSAGE_SELECTOR='[data-ad-preview="message"],[data-ad-comet-preview="message"]';
  function isRenderedInside(node,boundary){
    if(!node||!node.isConnected||!boundary?.contains(node))return false;
    for(let current=node;current&&current!==boundary;current=current.parentElement){
      const style=getComputedStyle(current);if(style.display==="none"||style.visibility==="hidden")return false;
    }
    return true;
  }
  function isPostDialog(dialog){
    if(!isVisible(dialog))return false;
    const labelled=[...dialog.querySelectorAll('[aria-label]')].map(node=>node.getAttribute("aria-label")).filter(value=>/bài viết của|post (?:by|from)|['’]s post/i.test(value||"")).slice(0,4);
    const headings=[dialog.getAttribute("aria-label"),...[...dialog.querySelectorAll('h1,h2,[role="heading"]')].slice(0,4).map(node=>node.innerText||node.textContent),...labelled].map(normalized).filter(Boolean).join(" | ").toLowerCase();
    return /bài viết của|post (?:by|from)|(?:^|\s)[^|]{1,80}['’]s post(?:\s|$)/i.test(headings);
  }
  function visiblePostDialogs(){return [...document.querySelectorAll('[role="dialog"]')].filter(isPostDialog).reverse();}
  function hasCommentQuery(value){
    try{const url=new URL(String(value||""),location.href);return url.searchParams.has("comment_id")||url.searchParams.has("reply_comment_id");}catch{return true;}
  }
  function isPostPermalink(value){
    if(hasCommentQuery(value))return false;
    const url=cleanedFacebookUrl(value);return !!url&&/\/(?:posts?|permalink|photos?|videos?|reel|watch)\/|\/groups\/[^/]+\/(?:posts?|permalink)\/|\/share\/(?:p|r|v)\/|[?&](?:story_fbid|fbid)=/i.test(url);
  }
  function expectedSourceKeys(sourceUrl){return new Set([postUrlKey(sourceUrl),postUrlKey(location.href)].filter(Boolean));}
  function nodeInCommentBranch(node,boundary,primaryArticle){
    if(!node||!boundary?.contains(node)||node.closest("ul"))return true;
    const article=node.closest('[role="article"]');
    if(primaryArticle&&article&&article!==primaryArticle)return true;
    let parent=node;
    for(let depth=0;parent&&parent!==boundary&&depth<14;depth++,parent=parent.parentElement){
      const aria=normalized(parent.getAttribute?.("aria-label")).toLowerCase();
      if(/bình luận (?:của|bởi)|comment (?:by|from)|trả lời (?:của|bởi)|reply (?:by|from)|danh sách bình luận|comments list/.test(aria))return true;
    }
    return false;
  }
  function isNestedPostMessage(message,dialog){
    const article=message.closest('[role="article"]');
    if(!article||!dialog.contains(article))return false;
    const parentArticle=article.parentElement?.closest('[role="article"]');
    return !!parentArticle&&dialog.contains(parentArticle);
  }
  function candidateRootForMessage(message,dialog,sourceUrl){
    const keys=expectedSourceKeys(sourceUrl);let nearestArticle=message.closest('[role="article"]'),bestRoot=null,bestLink="";
    for(let parent=message.parentElement;parent&&parent!==dialog;parent=parent.parentElement){
      for(const link of parent.querySelectorAll(':scope > a[href],:scope > div a[href],:scope > span a[href]')){
        if(!isPostPermalink(link.href)||nodeInCommentBranch(link,parent,nearestArticle))continue;
        const resolved=cleanedFacebookUrl(link.href),key=postUrlKey(resolved);
        if(keys.has(key)){bestRoot=parent;bestLink=resolved;break;}
      }
      if(bestRoot)break;
    }
    const root=bestRoot||nearestArticle||message.parentElement||dialog;
    return {root,message,dialog,primaryArticle:nearestArticle,exact:!!bestLink,permalink:bestLink};
  }
  function candidateNodes(candidate,selector){
    const nodes=[];if(candidate.root.matches?.(selector))nodes.push(candidate.root);
    nodes.push(...candidate.root.querySelectorAll(selector));return nodes;
  }
  function belongsToSource(node,candidate){
    if(!node||!candidate.root.contains(node)&&node!==candidate.root)return false;
    if(candidate.message&&(node===candidate.message||candidate.message.contains(node)))return true;
    const message=node.closest(SOURCE_MESSAGE_SELECTOR);if(message&&message!==candidate.message)return false;
    return !nodeInCommentBranch(node,candidate.root,candidate.primaryArticle);
  }
  function safePermalinks(candidate){
    const keys=expectedSourceKeys(candidate.sourceUrl),links=[];
    for(const link of candidateNodes(candidate,"a[href]")){
      if(!belongsToSource(link,candidate)||!isPostPermalink(link.href))continue;
      const url=cleanedFacebookUrl(link.href);if(!url)continue;
      links.push({url,exact:keys.has(postUrlKey(url))});
    }
    return links.sort((a,b)=>Number(b.exact)-Number(a.exact));
  }
  function findArticlePermalink(candidate){
    if(!candidate?.root)return "";if(candidate.permalink)return candidate.permalink;
    const links=safePermalinks(candidate),exact=links.find(item=>item.exact)?.url;if(exact)return exact;
    if(isPostPermalink(location.href))return cleanedFacebookUrl(location.href);
    return links[0]?.url||"";
  }
  function extractSourceText(candidate){
    if(!candidate?.root)return "";
    const direct=normalized(candidate.message?.innerText||candidate.message?.textContent);
    if(direct.length>=10)return direct.slice(0,4000);
    const values=[];
    for(const node of candidateNodes(candidate,SOURCE_MESSAGE_SELECTOR)){
      if(!belongsToSource(node,candidate))continue;
      const text=normalized(node.innerText||node.textContent);if(text.length>=10)values.push(text);
    }
    for(const node of candidateNodes(candidate,'div[dir="auto"],span[dir="auto"]')){
      if(!belongsToSource(node,candidate)||node.closest('[role="button"],button'))continue;
      const text=normalized(node.innerText||node.textContent);
      if(text.length>=15&&text.length<=5000&&!/^(?:thích|bình luận|chia sẻ|like|comment|share|theo dõi|follow)$/i.test(text))values.push(text);
    }
    values.sort((a,b)=>b.length-a.length);let text=values[0]||"";
    if(text.length<10&&candidate.exact){
      const meta=document.querySelector('meta[property="og:description"],meta[name="description"]'),value=normalized(meta?.getAttribute("content"));
      if(value.length>=15&&!/facebook giúp bạn kết nối|facebook helps you connect/i.test(value))text=value;
    }
    return text.slice(0,4000);
  }
  function sourceArticleScore(candidate){
    const text=extractSourceText(candidate);if(text.length<10)return -1;
    let score=Math.min(500,text.length)+(candidate.exact?5000:0)+(candidate.message?1200:0)+(candidate.dialog?300:0);
    const labels=candidateNodes(candidate,'[role="button"],button').filter(node=>belongsToSource(node,candidate)).map(labelOf);
    if(labels.some(value=>/^(?:chia sẻ|share)/.test(value)))score+=160;
    if(labels.some(value=>/^(?:bình luận|comment)/.test(value)))score+=80;
    if(candidate.root.matches?.('[data-pagelet^="FeedUnit_"]'))score+=100;
    return score;
  }
  function candidatesFromDialog(dialog,sourceUrl){
    const candidates=[],representedRoots=new Set();
    for(const message of dialog.querySelectorAll(SOURCE_MESSAGE_SELECTOR)){
      if(!isRenderedInside(message,dialog)||isNestedPostMessage(message,dialog))continue;
      const candidate=candidateRootForMessage(message,dialog,sourceUrl);candidate.sourceUrl=sourceUrl;
      // Giữ message đầu tiên của mỗi bài. Message nằm sâu hơn thường là nội dung
      // của bài được nhúng/chia sẻ lại, không phải lời của bài nguồn đang mở.
      if(representedRoots.has(candidate.root)||nodeInCommentBranch(message,dialog,candidate.primaryArticle))continue;
      candidates.push(candidate);representedRoots.add(candidate.root);
    }
    // Một số layout không gắn data-ad-preview="message". Chỉ nhận article cấp cao
    // có permalink đúng hoặc có cả hai hành động Bình luận + Chia sẻ; comment thường
    // chỉ có Thích/Trả lời/Chia sẻ nên không lọt vào fallback này.
    for(const article of dialog.querySelectorAll('div[role="article"],[data-pagelet^="FeedUnit_"]')){
      const parentArticle=article.parentElement?.closest('[role="article"]');
      if(representedRoots.has(article)||parentArticle&&dialog.contains(parentArticle))continue;
      const candidate=candidateFromArticle(article,sourceUrl,dialog),links=safePermalinks(candidate),match=links.find(item=>expectedSourceKeys(sourceUrl).has(postUrlKey(item.url))),labels=candidateNodes(candidate,'[role="button"],button').filter(node=>belongsToSource(node,candidate)).map(labelOf);
      candidate.exact=!!match;candidate.permalink=match?.url||links[0]?.url||"";
      if(candidate.exact||labels.some(value=>/^(?:bình luận|comment)/.test(value))&&labels.some(value=>/^(?:chia sẻ|share)/.test(value)))candidates.push(candidate);
    }
    return candidates;
  }
  function candidateFromArticle(article,sourceUrl,dialog=null){
    const message=[...article.querySelectorAll(SOURCE_MESSAGE_SELECTOR)].find(node=>!isNestedPostMessage(node,article))||null;
    return {root:article,message,dialog,primaryArticle:article.matches('[role="article"]')?article:null,exact:false,permalink:"",sourceUrl};
  }
  function findSourceArticle(sourceUrl){
    const dialogs=visiblePostDialogs(),candidates=[];
    if(dialogs.length){
      for(const dialog of dialogs)candidates.push(...candidatesFromDialog(dialog,sourceUrl));
      // Khi Facebook mo bai trong modal, tuyet doi khong roi xuong Feed dang nam phia sau.
      return candidates.map(candidate=>({candidate,score:sourceArticleScore(candidate)})).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score)[0]?.candidate||null;
    }
    for(const article of document.querySelectorAll('div[role="article"],[data-pagelet^="FeedUnit_"]')){
      if(!isVisible(article)||article.closest('[role="dialog"],ul')||article.parentElement?.closest('[role="article"]'))continue;
      const candidate=candidateFromArticle(article,sourceUrl),links=safePermalinks(candidate),match=links.find(item=>expectedSourceKeys(sourceUrl).has(postUrlKey(item.url)));
      candidate.exact=!!match;candidate.permalink=match?.url||links[0]?.url||"";candidates.push(candidate);
    }
    return candidates.map(candidate=>({candidate,score:sourceArticleScore(candidate)})).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score)[0]?.candidate||null;
  }
  async function expandSourceArticle(candidate,runId){
    const more=candidateNodes(candidate,'[role="button"],button,span,div').find(element=>isVisible(element)&&/^(?:xem thêm|see more)$/.test(labelOf(element))&&belongsToSource(element,candidate));
    if(!more)return;
    const control=more.matches('[role="button"],button')?more:more.closest('[role="button"],button');
    if(control&&await clickOnce(control,runId))await sleep(500);
  }
  async function readSourceArticle(sourceUrl,runId){
    const end=Date.now()+30000;let last="",stable=0,bestCandidate=null;
    while(Date.now()<end){
      if(!await stillActive(runId))return null;
      const candidate=findSourceArticle(sourceUrl);
      if(candidate){
        bestCandidate=candidate;await expandSourceArticle(candidate,runId);
        const text=extractSourceText(candidate);
        if(text.length>=10){if(text===last)stable++;else{last=text;stable=0;}if(stable>=2)return {text,article:candidate.root,dialog:candidate.dialog,permalink:findArticlePermalink(candidate)};}
      }
      await sleep(500);
    }
    const fallback=bestCandidate&&extractSourceText(bestCandidate);
    return fallback?.length>=10?{text:fallback,article:bestCandidate.root,dialog:bestCandidate.dialog,permalink:findArticlePermalink(bestCandidate)}:null;
  }

  function groupRouteIds(group){
    const ids=[];
    try{const id=new URL(String(group?.url||""),location.href).pathname.match(/^\/groups\/([^/?#]+)/i)?.[1];if(id)ids.push(String(id).toLowerCase());}catch(_){ }
    const legacy=String(group?.id||"").trim().toLowerCase();if(legacy&&!ids.includes(legacy))ids.push(legacy);return ids;
  }
  function currentGroupMatches(group){
    const current=String(location.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1]||"").toLowerCase(),ids=groupRouteIds(group);
    if(current&&ids.includes(current))return true;
    const expected=normalized(group?.name).toLocaleLowerCase("vi");if(!expected)return false;
    const heading=document.querySelector('h1,[role="main"] h1'),meta=document.querySelector('meta[property="og:title"]');
    const actual=normalized(heading?.innerText||meta?.getAttribute("content")).replace(/\s*\|\s*facebook.*$/i,"").toLocaleLowerCase("vi");
    return !!actual&&(actual===expected||actual.startsWith(`${expected} |`));
  }
  // Ledger bền vững chặn share trùng nhóm cho cùng bài nguồn khi run bị dừng
  // rồi chạy lại (namespaced theo groupShareSourceKey — stable key từ URL bài gốc).
  function groupLedgerId(group){return groupRouteIds(group)[0]||normalized(group?.name).toLocaleLowerCase("vi");}
  async function groupAlreadyShared(sourceKey,group){
    if(!sourceKey)return false;
    const id=groupLedgerId(group);if(!id)return false;
    const state=await chrome.storage.local.get("groupShareSharedGroupIds");
    const ledger=state.groupShareSharedGroupIds&&typeof state.groupShareSharedGroupIds==="object"?state.groupShareSharedGroupIds:{};
    return Array.isArray(ledger[sourceKey])&&ledger[sourceKey].includes(id);
  }
  async function markGroupShared(sourceKey,group){
    const id=groupLedgerId(group);if(!sourceKey||!id)return;
    const state=await chrome.storage.local.get("groupShareSharedGroupIds");
    const ledger=state.groupShareSharedGroupIds&&typeof state.groupShareSharedGroupIds==="object"?{...state.groupShareSharedGroupIds}:{};
    const existing=Array.isArray(ledger[sourceKey])?ledger[sourceKey]:[];
    if(!existing.includes(id)){ledger[sourceKey]=[...existing,id].slice(-500);await chrome.storage.local.set({groupShareSharedGroupIds:ledger});}
  }
  // Nhóm "die" (bị xóa/khóa/chặn xem/không còn quyền) phải được phát hiện
  // NHANH để bỏ qua ngay, thay vì chờ hết 45s groupReadyWait + 45s
  // composerWait vô ích cho mỗi nhóm chết (user báo: die mà không chuyển).
  let lastShareDeadReason="";
  function shareGroupDeadSignal(){
    try{
      const path=String(location.pathname||"");
      // Facebook điều hướng nhóm die về trang lỗi chung / checkpoint.
      if(/^\/checkpoint(?:\/|$)/i.test(path))return "Facebook checkpoint";
      const main=document.querySelector('[role="main"]');
      const text=normalized(((main?.innerText||main?.textContent)||"")+" "+(document.title||"")).toLocaleLowerCase("vi").slice(0,2000);
      if(!text||text.length<10)return "";
      if(/nội dung này không khả dụng|trang này không khả dụng|nhóm này không tồn tại|không tìm thấy (?:trang|nhóm)|this content isn't available|content not found|this page isn't available|page not found|group .* (?:doesn't exist|not found)|liên kết bạn đã theo dõi có thể đã hết hạn|the link you followed may have expired|bạn không có quyền (?:xem|truy cập)|you (?:don't|do not) have permission|only members can (?:see|view)|chỉ thành viên (?:mới|có thể)|nhóm (?:đã bị xóa|đã bị khóa|đã bị vô hiệu)|group has been (?:removed|disabled|deleted)|đã xảy ra lỗi khi tải|something went wrong|error loading|không xem được nội dung|can'?t view this content|you can'?t view/i.test(text))return "Nhóm die/không khả dụng";
      // Trang lỗi kiểu ảnh user gửi (10/10): tiêu đề "Bạn hiện không xem được
      // nội dung này" + câu giải thích "chủ sở hữu chỉ chia sẻ ... nhóm nhỏ,
      // thay đổi người được xem hoặc đã xóa nội dung" + nút "Đi đến Bảng feed".
      // Từng cụm yếu riêng lẻ có thể lọt vào bài viết thường nên chỉ kết luận
      // die khi gặp ≥2 cụm trên trang NGẮN (trang lỗi chỉ ~400 chữ, feed nhóm
      // thật luôn dài hơn nhiều).
      const weakHits=["nhóm nhỏ","thay đổi người được xem","đã xóa nội dung","small group","changing who can see","deleting it","đi đến bảng feed","go to news feed","trung tâm trợ giúp","help center"].filter(phrase=>text.includes(phrase));
      if(weakHits.length>=2&&text.length<1500)return "Nhóm die/không khả dụng";
      return "";
    }catch{return "";}
  }
  function shareGroupNotMemberSignal(){
    try{
      const main=document.querySelector('[role="main"]')||document.body;
      const joinBtn=[...main.querySelectorAll('[role="button"],button')].find(b=>isVisible(b)&&/^(?:tham gia nhóm|join group)$/i.test(labelOf(b)));
      return joinBtn?"Page/nick chưa tham gia nhóm (thấy nút Tham gia nhóm)":"";
    }catch{return "";}
  }
  async function waitGroupShareGroupReady(group,runId,index,total){
    const deadline=Date.now()+GROUP_SHARE_AUTO.groupReadyWait;
    let lastMarker="",stableSince=0,deadSince=0,lastDead="";
    while(Date.now()<deadline){
      if(!await stillActive(runId,index))return false;
      const dead=shareGroupDeadSignal();
      if(dead){
        if(dead!==lastDead){lastDead=dead;deadSince=Date.now();}
        // Tín hiệu die ổn định ~3s (tránh nhầm lúc trang đang tải dở) thì
        // bỏ qua NHANH, không chờ hết 45s.
        if(Date.now()-deadSince>=3000){lastShareDeadReason=dead;return false;}
      }else{lastDead="";deadSince=0;}
      const main=document.querySelector('[role="main"]'),heading=document.querySelector('h1,[role="main"] h1');
      if(currentGroupMatches(group)&&main&&heading){
        await dismissWelcome(runId,index);
        await dismissShareBlockingDialog(runId,index);
        const marker=`${location.pathname}|${normalized(heading.innerText||heading.textContent)}|${main.childElementCount}`;
        if(marker===lastMarker&&Date.now()-stableSince>=GROUP_SHARE_AUTO.groupStableWait)return true;
        if(marker!==lastMarker){lastMarker=marker;stableSince=Date.now();}
      }else{lastMarker="";stableSince=0;}
      const left=Math.max(1,Math.ceil((deadline-Date.now())/1000));
      if(!await setStatus(runId,t("sh2.waitGroup",{name:group.name,left}),{},index))return false;
      await sleep(500);
    }
    lastShareDeadReason=shareGroupDeadSignal()||"";
    return false;
  }
  // Chờ nút mở composer nhưng thoát SỚM khi nhóm die / chưa tham gia:
  // giữ nguyên trần 45s cho mạng chậm, chỉ rút ngắn ca đã rõ kết quả.
  async function waitShareOpener(runId,index,timeout=GROUP_SHARE_AUTO.composerWait){
    const deadline=Date.now()+timeout;
    let deadSince=0,lastDead="",notMemberSince=0;
    while(Date.now()<deadline){
      if(!await stillActive(runId,index))return null;
      const dead=shareGroupDeadSignal();
      if(dead){
        if(dead!==lastDead){lastDead=dead;deadSince=Date.now();}
        if(Date.now()-deadSince>=3000){lastShareDeadReason=dead;return null;}
      }else{lastDead="";deadSince=0;}
      try{
        const opener=findComposerOpener();
        if(opener)return opener;
      }catch(_){ }
      const notMember=shareGroupNotMemberSignal();
      if(notMember){
        if(!notMemberSince)notMemberSince=Date.now();
        if(Date.now()-notMemberSince>=8000){lastShareDeadReason=notMember;return null;}
      }else notMemberSince=0;
      if(!await shareSleep(400,runId,index))return null;
    }
    if(!lastShareDeadReason)lastShareDeadReason=shareGroupDeadSignal()||shareGroupNotMemberSignal()||"";
    return null;
  }
  function findVisibleButton(root,patterns){
    return [...(root||document).querySelectorAll('[role="button"],button')].find(element=>isVisible(element)&&patterns.some(pattern=>pattern.test(labelOf(element))))||null;
  }
  function findWelcomeDialog(){
    return [...document.querySelectorAll('[role="dialog"]')].filter(isVisible).find(dialog=>{
      const text=normalized(dialog.innerText||dialog.textContent).toLowerCase();
      return /chào mừng(?: bạn)?(?: đến với)?|welcome(?:\s+to)?/.test(text)&&!!findVisibleButton(dialog,[/^(?:đóng|close)$/,/(?:đóng|close).*(?:hộp thoại|dialog)/,/^(?:tiếp|next)$/]);
    })||null;
  }
  async function dismissWelcome(runId,index){
    for(let attempt=0;attempt<3;attempt++){
      const dialog=findWelcomeDialog();if(!dialog)return true;
      const button=findVisibleButton(dialog,[/^(?:đóng|close)$/,/(?:đóng|close).*(?:hộp thoại|dialog)/,/^(?:tiếp|next)$/]);
      if(!button||!await clickOnce(button,runId,index))return false;
      for(let i=0;i<12&&findWelcomeDialog();i++)await sleep(250);
    }
    return !findWelcomeDialog();
  }
  // Một số nhóm hiện dialog "Xin chào!" (giới thiệu bản thân) hoặc "Trả lời
  // câu hỏi" trước/thay cho composer. Không phải welcome card, không phải
  // composer thật → phát hiện và bỏ qua để tiếp tục mở composer (port từ
  // findGroupPostBlockingDialog/dismissGroupPostBlockingDialog trong feed.js).
  function findShareBlockingDialog(){
    return [...document.querySelectorAll('[role="dialog"]')].filter(isVisible).find(dialog=>{
      if(findComposerEditor(dialog))return false;
      const text=normalized(dialog.innerText||dialog.textContent||dialog.getAttribute("aria-label")).toLowerCase();
      return /xin\s*ch[àa]o|gi[oớ]i thi[eệ]u b[aả]n th[aâ]n|tr[aả] l[oờ]i c[aâ]u h[oỏ]i|c[aâ]u h[oỏ]i.{0,60}tr[uướ][oớ]c khi [dđ][aă]ng|answer.{0,40}question|question.{0,40}before.{0,40}post/i.test(text);
    })||null;
  }
  async function dismissShareBlockingDialog(runId,index){
    for(let attempt=0;attempt<3;attempt++){
      const dialog=findShareBlockingDialog();if(!dialog)return true;
      const skip=findVisibleButton(dialog,[/^(?:b[oỏ] qua|skip|kh[oô]ng,?\s*c[aả]m [oơ]n|kh[oô]ng)$/i]);
      const close=!skip&&findVisibleButton(dialog,[/^(?:[dđ][oó]ng|close)$/i,/(?:[dđ][oó]ng|close).*(?:h[oộ]p tho[aạ]i|dialog)/i]);
      const button=skip||close;
      if(!button||!await clickOnce(button,runId,index))return false;
      for(let i=0;i<12&&findShareBlockingDialog();i++)await sleep(250);
    }
    return !findShareBlockingDialog();
  }
  function composerEditorHint(editor){return normalized(editor?.getAttribute?.("aria-label")||editor?.getAttribute?.("aria-placeholder")||editor?.getAttribute?.("data-placeholder")||editor?.getAttribute?.("title")||editor?.getAttribute?.("role")).toLocaleLowerCase("vi");}
  function findComposerEditor(dialog){return [...dialog.querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"]')].find(editor=>isVisible(editor)&&!/bình luận|comment|tin nhắn|message/.test(composerEditorHint(editor)))||null;}
  function findComposerDialog(){
    return [...document.querySelectorAll('[role="dialog"]')].filter(isVisible).find(dialog=>{
      const editor=findComposerEditor(dialog);if(!editor)return false;
      const text=normalized(dialog.innerText||dialog.getAttribute("aria-label")).toLowerCase();
      return /tạo bài viết|create post/.test(text)||!!findVisibleButton(dialog,[/^(?:đăng|post)$/]);
    })||null;
  }
  function composerDialogFromEditor(editor){return editor?.closest?.('[role="dialog"]')||null;}
  function findVisibleComposerEditors(){
    const editors=[];
    for(const dialog of [...document.querySelectorAll('[role="dialog"]')].filter(isVisible)){
      const editor=findComposerEditor(dialog);
      if(editor&&!editors.includes(editor))editors.push(editor);
    }
    return editors;
  }
  function findComposerOpener(){
    const matches=value=>/^(?:bạn\s+(?:đang\s+)?(?:viết|bán)\s+gì(?:\s+đi)?(?:\s+thế)?\s*\??|bạn\s+đang\s+nghĩ\s+gì(?:\s+thế)?\s*\??|viết\s+gì\s+đó|tạo\s+bài\s+viết|write\s+something|create\s+post)$/.test(normalized(value).replace(/[.…]+$/g,"").toLowerCase());
    const root=document.querySelector('[role="main"]')||document.body,candidates=[];
    for(const element of root.querySelectorAll('[role="button"],button,[tabindex],div,span')){
      if(!isVisible(element)||element.closest('[role="dialog"]')||!matches(labelOf(element)))continue;
      const clickable=element.matches('[role="button"],button,[tabindex]')?element:element.closest('[role="button"],button,[tabindex]');
      if(clickable&&!candidates.includes(clickable))candidates.push(clickable);
    }
    return candidates.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)[0]||null;
  }
  async function waitComposer(runId,index,timeout=GROUP_SHARE_AUTO.composerWait){
    const end=Date.now()+timeout;let stableDialog=null,stableEditor=null,stableAt=0;
    while(Date.now()<end){
      if(!await stillActive(runId,index))return null;
      if(findWelcomeDialog()){await dismissWelcome(runId,index);await sleep(250);continue;}
      const dialog=findComposerDialog(),editor=dialog&&findComposerEditor(dialog);
      if(dialog&&editor){
        if(dialog===stableDialog&&editor===stableEditor&&Date.now()-stableAt>=700)return {dialog,editor};
        if(dialog!==stableDialog||editor!==stableEditor){stableDialog=dialog;stableEditor=editor;stableAt=Date.now();}
      }else{stableDialog=null;stableEditor=null;stableAt=0;}
      await sleep(250);
    }
    return null;
  }
  async function waitShareControl(runId,index,predicate,timeout=GROUP_SHARE_AUTO.composerWait){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      if(!await stillActive(runId,index))return null;
      try{const value=predicate();if(value)return value;}catch(_){ }
      if(!await shareSleep(300,runId,index))return null;
    }
    return null;
  }
  function linkTarget(value){
    try{const url=new URL(String(value||""),location.href);if(/l\.facebook\.com$/.test(url.hostname)&&url.searchParams.get("u"))return decodeURIComponent(url.searchParams.get("u"));return url.href;}catch{return "";}
  }
  function sameSourceLink(value,sourceUrl){const target=linkTarget(value),a=postUrlKey(target),b=postUrlKey(sourceUrl);return !!a&&!!b&&a===b;}
  function mediaKey(value){
    try{
      const url=new URL(String(value||""),location.href),path=url.pathname.toLowerCase();
      if(!/\.(?:jpe?g|png|webp|gif|avif)(?:$|\?)/i.test(path))return "";
      // Giữ tên file media (thường chứa ID ảnh), bỏ host/query kích thước CDN.
      return path.split("/").pop()||"";
    }catch{return "";}
  }
  function profileKey(value){
    try{
      const path=new URL(String(value||""),location.href).pathname.replace(/^\/+|\/+$/g,"").split("/").filter(Boolean);
      if(!path.length||/^(?:groups?|share|watch|reel|photo|photos|videos?|permalink|story|stories)$/i.test(path[0]))return "";
      return path[0].toLocaleLowerCase("vi");
    }catch{return "";}
  }
  function extractSourceMediaKeys(article){
    if(!article)return [];
    const seen=new Set(),keys=[];
    for(const image of article.querySelectorAll("img[src]")){
      const src=image.currentSrc||image.src,key=mediaKey(src);if(!key||seen.has(key))continue;
      const rect=image.getBoundingClientRect(),width=Math.max(rect.width,Number(image.naturalWidth)||0,Number(image.width)||0),height=Math.max(rect.height,Number(image.naturalHeight)||0,Number(image.height)||0);
      // Avatar/icon thường có kích thước nhỏ, tên CDN s50/p50 hoặc chỉ trỏ về profile.
      const looksMediaFile=/\d{6,}(?:[_-]\d{6,}){1,}(?:[_-][a-z]+)?\.(?:jpe?g|png|webp|gif|avif)$/i.test(key);
      if((width<90||height<70)&&!looksMediaFile||/(?:^|[-_])(?:s|p)?50x50(?:[-_.]|$)|profile|avatar/i.test(src))continue;
      seen.add(key);keys.push(key);
    }
    return keys.slice(0,24);
  }
  function previewSnapshot(dialog,editor,sourceUrl,sourceMediaKeys=[],expectedFingerprint=""){
    // Facebook tạo card theo nhiều bước. Chỉ có nút Xóa/Remove không chứng minh
    // card đã đúng bài (và trước đây đã khiến share nhầm profile/bài khác).
    if(!dialog||!editor||!sourceUrl)return {ready:false,reason:"missing"};
    const dialogText=normalized(dialog.innerText||dialog.textContent).toLocaleLowerCase("vi");
    const loading=/đang tạo bản xem trước|đang tải bản xem trước|creating (?:a )?link preview|loading (?:a )?link preview|generating link preview/.test(dialogText);
    const expectedKey=postUrlKey(sourceUrl);
    const links=[...dialog.querySelectorAll("a[href]")]
      .filter(link=>!link.closest('[contenteditable="true"]')&&isVisible(link))
      .map(link=>({href:linkTarget(link.href),key:postUrlKey(link.href),text:normalized(link.innerText||link.textContent).slice(0,120)}));
    const expectedMedia=new Set((Array.isArray(sourceMediaKeys)?sourceMediaKeys:[]).map(String).filter(Boolean));
    const images=[...dialog.querySelectorAll("img[src]")]
      .filter(image=>!image.closest('[contenteditable="true"]')&&isVisible(image))
      .map(image=>mediaKey(image.currentSrc||image.src)).filter(Boolean);
    const exact=!!expectedKey&&links.some(link=>link.key===expectedKey||sameSourceLink(link.href,sourceUrl));
    const mediaExact=expectedMedia.size>0&&images.some(key=>expectedMedia.has(key));
    const expectedProfile=profileKey(sourceUrl);
    let cardRoot=null;
    const cardMeta=dialog.querySelector('[data-ad-rendering-role="title"],[data-ad-rendering-role="description"],[data-ad-rendering-role="meta"]');
    for(let node=cardMeta,depth=0;node&&depth<10;node=node.parentElement,depth++){
      if(node.querySelector?.('img[src]')&&node.querySelector?.('a[href]')){cardRoot=node;break;}
    }
    const cardLinks=cardRoot?[...cardRoot.querySelectorAll('a[href]')].filter(link=>!link.closest('[contenteditable="true"]')):[];
    const profileMatch=!!expectedProfile&&(cardLinks.length?cardLinks:links).some(link=>profileKey(link.href)===expectedProfile);
    const sourceStillInEditor=editorTextContainsSource(editor.innerText||editor.textContent||"",sourceUrl);
    const meta=[...dialog.querySelectorAll('[data-ad-rendering-role="meta"],[data-ad-rendering-role="title"],[data-ad-rendering-role="description"]')].map(node=>normalized(node.textContent)).filter(Boolean).slice(-8);
    const fingerprint=[...new Set([...images,...meta])].sort().join("|");
    const stableCard=!!fingerprint;
    // Khi Facebook không expose permalink của card mà chỉ link về profile, cho
    // phép giữ card nếu URL nguồn vẫn còn trong editor và profile đúng nguồn.
    // Nếu đã có media nguồn nhưng ảnh card khác, luôn coi là xung đột và chặn.
    const mediaConflict=expectedMedia.size>0&&images.length>0&&!mediaExact;
    const authorFallback=!mediaConflict&&stableCard&&sourceStillInEditor&&profileMatch;
    const retained=!!expectedFingerprint&&stableCard&&fingerprint===expectedFingerprint;
    return {ready:!loading&&(exact||mediaExact||authorFallback||retained),loading,exact,mediaExact,authorFallback,retained,profileMatch,stableCard,expectedKey,expectedProfile,expectedMedia:[...expectedMedia],images:images.slice(-12),meta:meta.slice(-8),links:links.slice(-12),fingerprint,sourceStillInEditor,text:dialogText.slice(-240)};
  }
  function previewReady(dialog,editor,sourceUrl,sourceMediaKeys=[]){return previewSnapshot(dialog,editor,sourceUrl,sourceMediaKeys).ready;}
  function previewIdentityPreserved(before,after){
    if(!after||after.loading||!after.stableCard)return false;
    if(after.exact||after.mediaExact||after.retained)return true;
    const oldImages=new Set(before?.images||[]),oldMeta=new Set(before?.meta||[]);
    const imageOverlap=(after.images||[]).some(key=>oldImages.has(key));
    const metaOverlap=(after.meta||[]).some(value=>oldMeta.has(value));
    // Khi Facebook thay DOM sau Backspace, giữ card nếu định danh bên trong
    // (ảnh/meta/profile) vẫn trùng card vừa được xác nhận trước đó.
    return !!before?.authorFallback&&(imageOverlap||(!!after.profileMatch&&(metaOverlap||(!before.expectedMedia?.length&&after.stableCard))));
  }
  function previewLogSummary(snapshot){
    // Diagnostics must be useful without retaining source post URLs, post IDs,
    // CDN media names, or preview metadata in the console.
    return {
      ready:!!snapshot?.ready,
      loading:!!snapshot?.loading,
      exact:!!snapshot?.exact,
      mediaExact:!!snapshot?.mediaExact,
      retained:!!snapshot?.retained,
      profileMatch:!!snapshot?.profileMatch,
      authorFallback:!!snapshot?.authorFallback,
      sourceStillInEditor:!!snapshot?.sourceStillInEditor,
      expectedMediaCount:Array.isArray(snapshot?.expectedMedia)?snapshot.expectedMedia.length:0,
      linkCount:Array.isArray(snapshot?.links)?snapshot.links.length:0,
      imageCount:Array.isArray(snapshot?.images)?snapshot.images.length:0
    };
  }
  function selectSourceUrlText(editor,sourceUrl){
    if(!editor||!sourceUrl)return false;
    const target=String(sourceUrl),variants=[target];
    try{const decoded=decodeURIComponent(target);if(decoded!==target)variants.push(decoded);}catch(_){ }
    const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT),nodes=[];let node;
    while(node=walker.nextNode())nodes.push(node);
    let found=null;
    for(const variant of variants.sort((a,b)=>b.length-a.length)){
      for(const textNode of nodes){
        const value=String(textNode.nodeValue||""),start=value.lastIndexOf(variant);
        if(start>=0){found={node:textNode,start,end:start+variant.length};break;}
        const loose=findLooseTextOccurrence(value,variant);
        if(loose){found={node:textNode,...loose};break;}
      }
      if(found)break;
    }
    if(!found)return false;
    // Nội dung được nhập theo mẫu "lời dẫn\\n\\nURL"; chọn cả khoảng trắng ngay trước URL
    // để sau khi xoá không còn một dòng trống nằm trên thẻ preview.
    while(found.start>0&&/[\r\n\t ]/.test(String(found.node.nodeValue||"")[found.start-1]))found.start--;
    const selection=window.getSelection();selection.removeAllRanges();const range=document.createRange();
    range.setStart(found.node,found.start);range.setEnd(found.node,found.end);selection.addRange(range);editor.focus();return true;
  }
  function findLooseTextOccurrence(value,target){
    const compactTarget=String(target||"").replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g,"");if(!compactTarget)return null;
    let matched=0,start=-1;
    for(let index=0;index<String(value||"").length;index++){
      const char=String(value)[index];if(/[\s\u200B-\u200D\u2060\uFEFF]/.test(char))continue;
      if(char===compactTarget[matched]){if(matched===0)start=index;matched++;if(matched===compactTarget.length)return {start,end:index+1};}
      else{matched=char===compactTarget[0]?1:0;start=matched?index:-1;}
    }
    return null;
  }
  async function removeSourceUrlFromEditor(editor,sourceUrl,runId,index){
    if(!editor||!await stillActive(runId,index))return false;
    const current=String(editor.innerText||editor.textContent||"");
    if(!editorTextContainsSource(current,sourceUrl))return true;
    if(!selectSourceUrlText(editor,sourceUrl))return false;
    let removed=false;
    if(!await stillActive(runId,index))return false;
    try{const response=await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8,abortStorageKey:"groupShareActive",abortRunId:runId});removed=!!response?.ok;}catch(_){ }
    if(!removed){
      if(!await stillActive(runId,index))return false;
      try{removed=!!document.execCommand("delete",false,null);}catch(_){removed=false;}
    }
    if(!await shareSleep(450,runId,index))return false;
    const liveDialog=findComposerDialog(),liveEditor=liveDialog&&findComposerEditor(liveDialog)||editor;
    let left=normalized(liveEditor?.innerText||liveEditor?.textContent||"");
    if(removed&&!editorTextContainsSource(left,sourceUrl))return true;
    // Facebook có thể dựng lại contenteditable sau phím Backspace; thử lại một lần
    // bằng execCommand trên selection mới, tuyệt đối không bấm Đăng nếu URL còn đó.
    if(selectSourceUrlText(liveEditor,sourceUrl)){
      if(!await stillActive(runId,index))return false;
      try{document.execCommand("delete",false,null);}catch(_){ }
    }
    if(!await shareSleep(450,runId,index))return false;
    // Facebook có thể dựng lại contenteditable lần nữa trong lúc chờ; đọc lại
    // node hiện tại thay vì tin vào liveEditor đã lấy trước đó, nếu không có
    // thể đọc nhầm nội dung cũ và báo "đã xoá" trong khi URL vẫn còn hiển thị.
    const finalDialog=findComposerDialog(),finalEditor=finalDialog&&findComposerEditor(finalDialog)||liveEditor;
    left=normalized(finalEditor?.innerText||finalEditor?.textContent||"");
    return !editorTextContainsSource(left,sourceUrl);
  }
  function decodeURIComponentSafe(value){try{return decodeURIComponent(String(value||""));}catch{return String(value||"");}}
  function editorTextContainsSource(value,sourceUrl){
    const raw=String(value||""),compact=raw.replace(/\s+/g,"");
    return [String(sourceUrl||""),decodeURIComponentSafe(sourceUrl)].some(variant=>{
      const normalizedVariant=normalized(variant),compactVariant=normalizedVariant.replace(/\s+/g,"");
      return !!normalizedVariant&&(normalized(raw).includes(normalizedVariant)||compact.includes(compactVariant));
    });
  }
  async function focusAndType(editor,caption,sourceUrl,runId,index,typingConfig=null){
    const existing=normalized(editor.innerText||editor.textContent);
    if(existing)throw new Error(t("sh2.draftBusy"));
    if(!await clickOnce(editor,runId,index))throw new Error(t("sh2.noFocus"));
    const content=`${caption}\n\n${sourceUrl}`;
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedTyping"));
    const typing=typingConfig
      ? normalizeAiTypingConfig(typingConfig)
      : normalizeAiTypingConfig({mode:"custom",minDelayMs:35,maxDelayMs:85,chunkSize:1,humanLike:true,punctuationPauseMinMs:140,punctuationPauseMaxMs:320,spacePauseMinMs:10,spacePauseMaxMs:40});
    const normalizedCaption=normalized(caption),prefix=normalizedCaption.slice(0,45);
    const captionPresent=value=>{
      const text=normalized(value);
      if(!text||!prefix)return false;
      // Facebook can replace the contenteditable node while it builds the
      // link card. Check both the freshly found editor and the still-live
      // node we typed into so a valid caption is not reported as missing
      // during that DOM swap.
      return text.includes(prefix)||text.includes(normalizedCaption);
    };
    for(let attempt=0;attempt<2;attempt++){
      if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedTyping"));
      const response=await chrome.runtime.sendMessage({action:"trustedInput",text:content,pressEnter:false,typingConfig:typing,abortStorageKey:"groupShareActive",abortRunId:runId,abortRunIdKey:"groupShareRunId"});
      if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedTyping"));
      if(!response?.ok)throw new Error(response?.error||t("sh2.fillFail"));
      const end=Date.now()+GROUP_SHARE_AUTO.captionWait;
      while(Date.now()<end){
        if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedTyping"));
        const live=findComposerDialog(),box=live&&findComposerEditor(live);
        const candidates=[box,editor,...findVisibleComposerEditors()].filter(candidate=>candidate&&candidate.isConnected&&isVisible(candidate));
        const confirmed=candidates.find(candidate=>captionPresent(candidate.innerText||candidate.textContent));
        if(confirmed)return {dialog:live||composerDialogFromEditor(confirmed)||null,editor:confirmed,content};
        if(!await shareSleep(250,runId,index))throw new Error(t("sh2.stoppedTyping"));
      }
      if(attempt===0){
        // Under load, Facebook can occasionally drop part of a typed segment
        // right after a paragraph break. Clear whatever landed and retype
        // once from scratch before giving up on this group entirely.
        if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedTyping"));
        const live=findComposerDialog(),box=(live&&findComposerEditor(live))||editor;
        try{box.focus();document.execCommand("selectAll",false,null);document.execCommand("delete",false,null);}catch(_){ }
        if(!await shareSleep(400,runId,index))throw new Error(t("sh2.stoppedTyping"));
      }
    }
    throw new Error(t("sh2.fbNoCaption"));
  }
  function visibleAlerts(){return [...document.querySelectorAll('[role="alert"],[role="status"]')].filter(isVisible).map(element=>normalized(element.innerText||element.textContent)).filter(Boolean);}
  function groupShareContentVisible(caption){
    const expected=normalized(caption).slice(0,80).toLocaleLowerCase("vi");
    if(expected.length<10)return false;
    const main=document.querySelector('[role="main"]')||document.body;
    const feed=main.querySelector('[role="feed"]');
    const candidates=[...main.querySelectorAll('[role="article"],[data-pagelet^="FeedUnit_"],[data-ad-preview="message"]'),...(feed?[...feed.children]:[])];
    return candidates.some(node=>{
      if(!isVisible(node)||node.closest('[role="dialog"]')||node.querySelector('[contenteditable="true"]'))return false;
      return normalized(node.innerText||node.textContent).toLocaleLowerCase("vi").includes(expected);
    });
  }
  async function waitForGroupShareDisplayed(caption,groupName,runId,index){
    const deadline=Date.now()+GROUP_SHARE_AUTO.postVisibleWait;
    while(Date.now()<deadline){
      if(!await stillActive(runId,index))return false;
      const left=Math.max(1,Math.ceil((deadline-Date.now())/1000));
      if(!await setStatus(runId,t("sh2.waitVisible",{name:groupName,left}),{groupShareStage:"waiting-visible"},index))return false;
      if(groupShareContentVisible(caption))return true;
      if(!await shareSleep(500,runId,index))return false;
    }
    const error=new Error(t("sh2.postNotVisible",{name:groupName}));error.submittedUnconfirmed=true;throw error;
  }
  async function submitComposer(dialog,editor,caption,runId,index){
    let postButton=null;
    for(let i=0;i<80&&!postButton;i++){
      if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
      const live=findComposerDialog()||dialog;
      postButton=[...live.querySelectorAll('[role="button"],button')].find(button=>isVisible(button)&&button.getAttribute("aria-disabled")!=="true"&&!button.disabled&&/^(?:đăng|post)$/.test(labelOf(button)))||null;
      if(!postButton&&!await shareSleep(250,runId,index))throw new Error(t("sh2.stoppedPosting"));
    }
    if(!postButton)throw new Error(t("sh2.notReady"));
    if(!await shareSleep(rand(2200,4000),runId,index))throw new Error(t("sh2.stoppedPosting"));
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
    const liveForProof=findComposerDialog()||dialog,editorForProof=liveForProof&&findComposerEditor(liveForProof)||editor;
    if(normalized(editorForProof?.innerText||editorForProof?.textContent||"")!==normalized(caption))throw new Error(t("sh2.contentMismatch"));
    const beforeAlerts=new Set(visibleAlerts());
    if(!await setStatus(runId,t("sh2.armed"),{groupShareStage:"submit-armed",groupShareSubmitDispatchedAt:0},index))throw new Error(t("sh2.stoppedPosting"));
    // DỪNG BẰNG MỌI GIÁ: kiểm tra lại ngay trước cú bấm Đăng duy nhất.
    if(!await stillActive(runId,index))throw new Error(t("p.shStopped"));
    if(!await trustedMouse(postButton,runId,index))throw new Error(t("sh2.clickFail"));
    const dispatchedAt=Date.now();
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
    if(!await writeRunState(runId,index,{groupShareStage:"submitted",groupShareSubmitDispatchedAt:dispatchedAt}))throw new Error(t("sh2.stoppedPosting"));
    const success=/đã chia sẻ|đã đăng|bài viết của bạn.*(?:đăng|chia sẻ)|đang chờ phê duyệt|chờ quản trị viên|shared|your post.*(?:published|posted)|submitted for review|pending/i;
    const failure=/không thể (?:chia sẻ|đăng)|không đăng được|bị chặn|spam|thử lại sau|can't (?:share|post)|cannot (?:share|post)|blocked|try again later/i;
    const end=Date.now()+GROUP_SHARE_AUTO.submitWait;
    while(Date.now()<end){
      if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
      const alerts=visibleAlerts().filter(text=>!beforeAlerts.has(text));
      const error=alerts.find(text=>failure.test(text));if(error)throw new Error(error);
      const proof=alerts.find(text=>success.test(text));if(proof)return {ok:true,proof};
      const dialogGone=!dialog.isConnected||!isVisible(dialog),editorText=normalized(editor?.innerText||editor?.textContent);
      if(Date.now()-dispatchedAt>900&&dialogGone)return {ok:true,proof:t("sh2.proofClosed")};
      if(Date.now()-dispatchedAt>900&&(postButton.getAttribute("aria-disabled")==="true"||postButton.disabled)&&!editorText)return {ok:true,proof:t("sh2.proofLocked")};
      if(!await shareSleep(300,runId,index))throw new Error(t("sh2.stoppedPosting"));
    }
    const error=new Error(t("sh2.unconfirmed"));error.submittedUnconfirmed=true;throw error;
  }
  async function closeShareComposer(){
    const dialog=findComposerDialog();
    if(!dialog)return;
    const close=findVisibleButton(dialog,[/^(?:[dđ][oó]ng|close)$/i,/(?:[dđ][oó]ng|close).*(?:h[oộ]p tho[aạ]i|dialog|t[aạ]o b[aà]i vi[eế]t|create post)/i]);
    if(close){close.click();await sleep(400);return;}
    // No close button — try Escape
    const discard=findVisibleButton(document,[/^(?:b[oỏ]|b[oỏ] b[aà]i vi[eế]t|b[oỏ] b[aả]n nh[aá]p|discard|discard post)$/i]);
    if(discard){discard.click();await sleep(400);return;}
    dialog.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",code:"Escape",bubbles:true}));
    await sleep(400);
  }
  async function createGroupSharePost(caption,sourceUrl,runId,index,groupName="",typingConfig=null){
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
    if(!await dismissWelcome(runId,index)||!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
    if(!await dismissShareBlockingDialog(runId,index)||!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
    const opener=await waitShareOpener(runId,index,GROUP_SHARE_AUTO.composerWait);if(!opener){const why=lastShareDeadReason;lastShareDeadReason="";const error=new Error(why||t("sh2.noOpener"));error.skippable=true;throw error;}
    if(!await setStatus(runId,t("sh2.openingComposer"),{},index))throw new Error(t("sh2.stoppedPosting"));
    if(!await clickOnce(opener,runId,index)){const error=new Error(t("sh2.openFail"));error.skippable=true;throw error;}
    let composer=await waitComposer(runId,index);if(!composer){const error=new Error(t("sh2.composerLoading"));error.skippable=true;throw error;}
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPosting"));
    if(!await setStatus(runId,t("sh2.filling",{n:caption.length}),{},index))throw new Error(t("sh2.stoppedPosting"));
    composer=await focusAndType(composer.editor,caption,sourceUrl,runId,index,typingConfig);
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPreview"));
    if(!await setStatus(runId,t("sh2.waitPreview"),{},index))throw new Error(t("sh2.stoppedPreview"));
    const mediaState=await chrome.storage.local.get("groupShareSourceMediaKeys");
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPreview"));
    const sourceMediaKeys=Array.isArray(mediaState.groupShareSourceMediaKeys)?mediaState.groupShareSourceMediaKeys:[];
    const previewEnd=Date.now()+GROUP_SHARE_AUTO.previewWait;
    // The loop's own deadline check only runs between iterations, so a single
    // unusually slow await inside one iteration (e.g. a stalled storage read)
    // could keep this from ever reaching that check again. Race it against a
    // hard backstop; this section never clicks anything, so abandoning it is
    // safe — the snapshot check right after still runs and fails closed.
    const previewLoop=(async()=>{
      while(Date.now()<previewEnd){
        if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedPreview"));
        const dialog=findComposerDialog()||composer.dialog,editor=dialog&&findComposerEditor(dialog);
        if(dialog&&editor&&previewReady(dialog,editor,sourceUrl,sourceMediaKeys)){composer={dialog,editor};return;}
        if(!await shareSleep(300,runId,index))throw new Error(t("sh2.stoppedPreview"));
      }
    })();
    try{
      await withHardTimeout(previewLoop,GROUP_SHARE_AUTO.previewWait+15000,"Cho ban xem truoc qua lau");
    }catch(waitError){
      previewLoop.catch(()=>{});
      if(!waitError?.timedOut)throw waitError;
      console.warn("[GroupShare] preview-wait backstop timeout fired",waitError);
    }
    const preview=previewSnapshot(composer.dialog,composer.editor,sourceUrl,sourceMediaKeys);
    if(!preview.ready){
      const reason=preview.loading
        ? t("sh2.pvLoading")
        : preview.exact===false
          ? t("sh2.pvWrong")
          : t("sh2.pvNone");
      console.warn("[GroupShare] preview rejected",{reason,...previewLogSummary(preview)});
      if(!await setStatus(runId,t("sh2.notPosted",{reason:reason}),{groupSharePreviewRejected:true,groupSharePreviewKey:preview.expectedKey||"",groupSharePreviewLinks:preview.links||[],groupSharePreviewImages:preview.images||[]},index))throw new Error(t("sh2.stoppedPreview"));
      throw new Error(t("sh2.notPostedSafe",{reason:reason}));
    }
    if(!await setStatus(runId,t("sh2.cardOk"),{},index))throw new Error(t("sh2.stoppedPreview"));
    const cleanEditor=await removeSourceUrlFromEditor(composer.editor,sourceUrl,runId,index);
    if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedVerify"));
    if(!cleanEditor)throw new Error(t("sh2.unlinkFail"));
    const cleanDialog=findComposerDialog()||composer.dialog,cleanComposerEditor=cleanDialog&&findComposerEditor(cleanDialog)||composer.editor;
    let cleanPreview=null;const cleanEnd=Date.now()+8000;
    while(Date.now()<cleanEnd){
      if(!await stillActive(runId,index))throw new Error(t("sh2.stoppedVerify"));
      const liveDialog=findComposerDialog()||cleanDialog,liveEditor=liveDialog&&findComposerEditor(liveDialog);
      const snapshot=previewSnapshot(liveDialog,liveEditor,sourceUrl,sourceMediaKeys,preview.fingerprint);
      if(previewIdentityPreserved(preview,snapshot)){cleanPreview=snapshot;break;}
      if(!await shareSleep(300,runId,index))throw new Error(t("sh2.stoppedVerify"));
    }
    if(!cleanPreview){
      const lastDialog=findComposerDialog()||cleanDialog,lastEditor=lastDialog&&findComposerEditor(lastDialog),snapshot=previewSnapshot(lastDialog,lastEditor,sourceUrl,sourceMediaKeys,preview.fingerprint);
      console.warn("[GroupShare] preview lost/rejected after URL removal",previewLogSummary(snapshot));
      throw new Error(snapshot.loading
        ? t("sh2.rebuilding")
        : t("sh2.cardLost"));
    }
    const finalDialog=findComposerDialog()||cleanDialog,finalEditor=finalDialog&&findComposerEditor(finalDialog);
    if(finalDialog&&finalEditor){composer={dialog:finalDialog,editor:finalEditor};}
    if(!await setStatus(runId,t("sh2.urlRemoved"),{},index))throw new Error(t("sh2.stoppedVerify"));
    const result=await submitComposer(composer.dialog,composer.editor,caption,runId,index);
    await waitForGroupShareDisplayed(caption,groupName,runId,index);
    return result;
  }

  async function handleSource(state,runId){
    const cfg=state.groupShareConfig,expected=cfg.sourceUrl,recent=Date.now()-Number(state.groupShareSourceNavigationAt||0)<30000;
    let alias=false;try{const url=new URL(expected);alias=url.hostname==="fb.watch"||/\/share\/(?:p|r|v)\/|\/(?:story|permalink|photo)\.php/i.test(url.pathname)||url.searchParams.has("story_fbid")||url.searchParams.has("fbid");}catch(_){ }
    if(!sourceUrlMatches(location.href,expected)&&!(alias&&recent)){
      if(!await setStatus(runId,t("sh2.renavSource"),{groupShareSourceNavigationAt:Date.now()}))return;
      if(!await stillActive(runId))return;
      location.assign(expected);return;
    }
    if(!await setStatus(runId,t("sh2.waitSource")))return;
    const source=await readSourceArticle(expected,runId);
    if(!await stillActive(runId))return;
    if(!source){await stopRun(runId,t("sh2.noSource",{box:t("sh.sourceRead")}),{groupShareAiActivity:t("sh2.noSourceChat")});return;}
    const resolved=cleanedFacebookUrl(source.permalink||location.href)||expected,sourceKey=postUrlKey(resolved)||postUrlKey(expected);
    if(!sourceKey){await stopRun(runId,t("sh2.noSourceKey"));return;}
    let sourceMediaKeys=extractSourceMediaKeys(source.article);
    // Một số layout đặt ảnh ngoài node message/article. Chỉ dùng dialog làm
    // fallback khi article không có media, để không trộn ảnh của comment vào bài nguồn.
    if(!sourceMediaKeys.length&&source.dialog)sourceMediaKeys=extractSourceMediaKeys(source.dialog);
    if(!await writeRunState(runId,undefined,{groupShareStage:"groups",groupShareSourceText:source.text,groupShareSourceKey:sourceKey,groupShareSourceResolvedUrl:resolved,groupShareSourceMediaKeys:sourceMediaKeys,groupShareSourceDraftText:source.text,groupShareSourceDraftUrl:expected,groupShareSourceDraftManual:false,groupShareAiActivity:`Đã đọc ${source.text.length} ký tự. Bạn có thể chat với AI để bổ sung cách hiểu hoặc yêu cầu viết lời dẫn`,groupShareStatus:`Đã đọc ${source.text.length} ký tự từ bài gốc; đang mở nhóm đầu tiên...`}))return;
    const first=cfg.groups?.[0];if(!first){await stopRun(runId,t("sh2.noGroups"));return;}
    if(!await stillActive(runId))return;
    location.assign(first.url);
  }
  async function generateCaption(state,group,runId,index){
    if(!state||!await stillActive(runId,index))return "";
    if(Number(state.groupSharePendingIndex)===index&&normalized(state.groupSharePendingCaption))return state.groupSharePendingCaption;
    const recent=Array.isArray(state.groupShareRecentCaptions)?state.groupShareRecentCaptions:[];
    const sourceUrl=state.groupShareSourceResolvedUrl||state.groupShareConfig.sourceUrl,chatState=await chrome.storage.local.get(["groupShareAiChatMessages","groupShareAiChatSourceUrl"]);
    if(!await stillActive(runId,index))return "";
    const chatMatches=!chatState.groupShareAiChatSourceUrl||sourceUrlMatches(chatState.groupShareAiChatSourceUrl,sourceUrl),chatMessages=chatMatches&&Array.isArray(chatState.groupShareAiChatMessages)?chatState.groupShareAiChatMessages:[];
    if(!await setStatus(runId,t("sh2.aiWriting",{name:group.name}),{groupShareStage:"ai-generating",groupShareAiActivity:t("sh2.aiActivity",{name:group.name,ctx:chatMessages.length?t("sh2.aiCtx",{n:chatMessages.length}):""})},index))return "";
    if(!await stillActive(runId,index))return "";
    let response=await chrome.runtime.sendMessage({action:"aiGenerateGroupShareCaption",postText:state.groupShareSourceText,sourceUrl,groupName:group.name,prompt:state.groupShareConfig.prompt,variant:index+1,recentCaptions:recent,chatMessages,aiConfig:state.groupShareConfig.aiConfig});
    if(!response?.ok&&/trùng|duplicate/i.test(response?.error||"")){
      if(!await stillActive(runId,index))return "";
      response=await chrome.runtime.sendMessage({action:"aiGenerateGroupShareCaption",postText:state.groupShareSourceText,sourceUrl,groupName:group.name,prompt:state.groupShareConfig.prompt,variant:index+101,recentCaptions:recent,chatMessages,aiConfig:state.groupShareConfig.aiConfig});
    }
    if(!await stillActive(runId,index))return "";
    if(!response?.ok){
      if(!await writeRunState(runId,index,{groupShareAiActivity:t("sh2.apiFail",{err:response?.error||t("sh2.aiNoReply")})}))return "";
      throw new Error(response?.error||t("sh2.captionFail"));
    }
    const caption=normalized(response.caption);if(!caption)throw new Error(t("sh2.emptyCaption"));
    if(!await writeRunState(runId,index,{groupSharePendingCaption:caption,groupSharePendingIndex:index,groupShareStage:"caption-ready",groupShareLastAiCaption:caption,groupShareAiActivity:t("sh2.captionReady",{name:group.name,caption:caption})}))return "";
    console.log(`[GroupShare] caption ready index=${index+1} chars=${caption.length}`);
    return caption;
  }
  async function advanceSkipped(state,runId,index,reason){
    if(!await stillActive(runId,index))return;
    const cfg=state.groupShareConfig,skipped=Number(state.groupShareSkipped||0)+1,nextIndex=index+1;
    if(!await writeRunState(runId,index,{groupShareIndex:nextIndex,groupShareSkipped:skipped,groupSharePendingCaption:"",groupSharePendingIndex:-1,groupShareStage:"groups",groupShareStatus:`Bỏ qua ${cfg.groups[index].name}: ${reason} (${skipped} nhóm bỏ qua)`}))return;
    if(nextIndex>=cfg.groups.length){await stopRun(runId,t("sh2.done",{d:state.groupShareDone||0,t:cfg.groups.length,s:skipped}),{groupShareIndex:nextIndex,groupShareSkipped:skipped});return;}
    if(await shareSleep(1200,runId,nextIndex))location.assign(cfg.groups[nextIndex].url);
  }
  async function handleGroup(state,runId){
    const cfg=state.groupShareConfig,index=Math.max(0,parseInt(state.groupShareIndex)||0),done=Math.max(0,parseInt(state.groupShareDone)||0),skipped=Math.max(0,parseInt(state.groupShareSkipped)||0);
    if(!await stillActive(runId,index))return;
    if(index>=cfg.groups.length){await stopRun(runId,t("sh2.done",{d:done,t:cfg.groups.length,s:skipped}),{groupShareIndex:index});return;}
    if((state.groupShareStage==="submit-armed"||state.groupShareStage==="submitted"||state.groupShareStage==="waiting-visible"||state.groupShareStage==="post-visible")){
      await stopRun(runId,t("sh2.unconfirmed"),{groupShareStage:"submitted-unconfirmed"});return;
    }
    if(!state.groupShareSourceText){
      if(!await writeRunState(runId,index,{groupShareStage:"source",groupShareSourceNavigationAt:Date.now()}))return;
      if(!await stillActive(runId,index))return;
      location.assign(cfg.sourceUrl);return;
    }
    const group=cfg.groups[index];
    console.log(`[GroupShare] route index=${index+1} current=${location.pathname} expected=${groupRouteIds(group).join(",")||"unknown"}`);
    // Chặn share trùng: nhóm này đã share thành công cho đúng bài nguồn ở lần
    // chạy trước (kể cả sau khi dừng/chạy lại) thì bỏ qua ngay, không mở lại.
    if(state.groupShareSourceKey&&await groupAlreadyShared(state.groupShareSourceKey,group)){
      await advanceSkipped(state,runId,index,"Nhóm này đã được share cho bài viết hiện tại, bỏ qua để tránh trùng");return;
    }
    if(!currentGroupMatches(group)){
      if(!await setStatus(runId,t("sh2.openingGroup",{i:index+1,t:cfg.groups.length,name:group.name}),{},index))return;
      if(!await stillActive(runId,index))return;
      location.assign(group.url);return;
    }
    if(!await waitGroupShareGroupReady(group,runId,index,cfg.groups.length)){
      const why=lastShareDeadReason;lastShareDeadReason="";
      await advanceSkipped(state,runId,index,why||t("sh2.composerLoading"));return;
    }
    const nextAt=Number(state.groupShareNextAt)||0;if(nextAt>Date.now()&&!await waitSchedule(nextAt,runId,index,cfg.groups.length,group.name))return;
    if(!await shareSleep(1800,runId,index))return;
    try{
      const live=await readRun(runId);if(!live||!await stillActive(runId,index))return;
      const caption=await generateCaption(live,group,runId,index);if(!caption)return;
      if(!await stillActive(runId,index))return;
      if(!await setStatus(runId,t("sh2.preparing",{name:group.name}),{groupShareStage:"composer"},index))return;
      let result=null;
      for(let attempt=1;attempt<=2;attempt++){
        try{
          result=await createGroupSharePost(caption,live.groupShareSourceResolvedUrl||cfg.sourceUrl,runId,index,group.name,cfg.typingConfig||null);
          break;
        }catch(attemptError){
          if(!await stillActive(runId,index))return;
          const dispatched=Number((await chrome.storage.local.get("groupShareSubmitDispatchedAt")).groupShareSubmitDispatchedAt||0);
          // Đã (có thể) bấm Đăng thì không thử lại — nguy cơ share trùng.
          if(attemptError.submittedUnconfirmed||dispatched||attempt>=2)throw attemptError;
          await closeShareComposer();
          if(!await shareSleep(rand(2000,3500),runId,index))return;
        }
      }
      if(!result?.ok)throw new Error(t("sh2.noConfirm"));
      await markGroupShared(live.groupShareSourceKey,group);
      if(!await stillActive(runId,index))return;
      const confirmedAt=Date.now(),newDone=done+1,nextIndex=index+1,recent=[...(live.groupShareRecentCaptions||[]),caption].slice(-20),delay=Math.min(604800,Math.max(5,parseInt(cfg.interGroupDelay)||30)),nextRun=confirmedAt+delay*1000;
      if(!await writeRunState(runId,index,{groupShareDone:newDone,groupShareIndex:nextIndex,groupShareRecentCaptions:recent,groupSharePendingCaption:"",groupSharePendingIndex:-1,groupShareSubmitDispatchedAt:0,groupShareStage:"confirmed",groupShareNextAt:nextIndex<cfg.groups.length?nextRun:0,groupShareStatus:`Đã share ${newDone}/${cfg.groups.length} vào ${group.name}. ${result.proof}`}))return;
      console.log(`[GroupShare] confirmed ${newDone}/${cfg.groups.length}`);
      const holdUntil=Math.min(nextRun,Date.now()+rand(GROUP_SHARE_AUTO.afterPostMin*1000,GROUP_SHARE_AUTO.afterPostMax*1000));
      while(Date.now()<holdUntil){
        if(!await stillActive(runId,nextIndex))return;
        const left=Math.max(1,Math.ceil((holdUntil-Date.now())/1000));
        if(!await setStatus(runId,t("sh2.holdWait",{d:newDone,t:cfg.groups.length,left:left}),{},nextIndex))return;
        if(!await shareSleep(Math.min(500,holdUntil-Date.now()),runId,nextIndex))return;
      }
      if(nextIndex>=cfg.groups.length){await stopRun(runId,t("sh2.done",{d:newDone,t:cfg.groups.length,s:skipped}),{groupShareIndex:nextIndex,groupShareDone:newDone,groupShareStage:"completed"});return;}
      if(!await writeRunState(runId,nextIndex,{groupShareStage:"groups",groupShareStatus:t("sh2.waitNext",{d:newDone,t:cfg.groups.length,delay:delay,next:cfg.groups[nextIndex].name})}))return;
      if(await stillActive(runId,nextIndex))location.assign(cfg.groups[nextIndex].url);
    }catch(error){
      console.warn("[GroupShare]",error);
      const activeState=await readRun(runId);if(!activeState)return;
      // Hầu hết lỗi trước khi bấm Đăng (busy/focus/điền lời dẫn/preview/xoá
      // URL/nút Đăng/click Đăng/AI lời dẫn) chỉ nên bỏ nhóm này và tiếp tục —
      // giống skippableGroupError của feed.js. Chỉ dừng hẳn khi có thể đã bấm
      // Đăng rồi (groupShareSubmitDispatchedAt khác 0) hoặc lỗi thật sự lạ.
      const skippableShareError=/đang có sẵn nội dung|already has content|không đặt được con trỏ|could not focus the composer|không điền được lời dẫn|could not fill the ai lead|chưa nhận đủ lời dẫn ai|did not accept the full ai lead|chưa bấm đăng để tránh share|post not pressed to avoid|chưa xoá được url chữ|text url could not be removed|đã dừng trước khi bấm đăng|stopped before pressing post|nút đăng chưa sẵn sàng|post button not ready|không nhận thao tác bấm nút đăng|did not accept the post click|ai không tạo được lời dẫn|ai could not generate the share lead|ai trả về lời dẫn rỗng|ai returned an empty lead/i.test(String(error.message||""));
      const dispatched=Number((await chrome.storage.local.get("groupShareSubmitDispatchedAt")).groupShareSubmitDispatchedAt||0);
      if((error.skippable||skippableShareError)&&!dispatched){await advanceSkipped(activeState,runId,index,error.message);return;}
      await stopRun(runId,error.submittedUnconfirmed?error.message:t("sh2.groupError",{name:group.name,err:error.message}),{groupShareStage:error.submittedUnconfirmed?"submitted-unconfirmed":"paused"});
    }
  }
  async function continueGroupShare(runId){
    if(loopActive)return;loopActive=true;currentRunId=runId;stopRequested=false;
    try{
      const state=await readRun(runId);if(!state)return;
      if(state.groupShareStage==="source"||!state.groupShareSourceText)await handleSource(state,runId);
      else await handleGroup(state,runId);
    }catch(error){
      console.error("[GroupShare] fatal",error);
      try{
        await stopRun(runId,`Lỗi Share bài: ${error.message}`,{groupShareStage:"paused"});
      }catch(stopError){
        // Nếu chính stopRun cũng lỗi (vd storage tạm mất kết nối khi trang
        // đang điều hướng), vẫn phải ép tắt cờ active bằng mọi giá — nếu
        // không mọi tính năng khác sẽ bị khoá vĩnh viễn bởi cờ groupShareActive.
        console.error("[GroupShare] stopRun cũng lỗi, ép tắt cờ active",stopError);
        try{await chrome.storage.local.set({groupShareActive:false});}catch{}
      }
    }
    finally{loopActive=false;}
  }

  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.groupShareActive?.newValue===false)stopRequested=true;
  });
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message.action==="stopGroupShare"){
      stopRequested=true;chrome.storage.local.set({groupShareActive:false,groupShareNextAt:0,groupShareStatus:t("p.shStopped")}).then(()=>sendResponse({ok:true}));return true;
    }
    if(message.action==="resumeGroupShare"){
      chrome.storage.local.get(["groupShareActive","groupShareRunId"]).then(state=>{if(state.groupShareActive&&state.groupShareRunId){continueGroupShare(state.groupShareRunId);sendResponse({ok:true});}else sendResponse({ok:false,error:"Không có phiên Share bài đang chạy"});});return true;
    }
    if(message.action==="resetGroupShare"){
      stopRequested=true;chrome.storage.local.set({groupShareActive:false,groupShareRunId:"",groupShareOwnerTabId:0,groupShareStage:"",groupShareSourceText:"",groupShareSourceKey:"",groupShareSourceResolvedUrl:"",groupShareSourceMediaKeys:[],groupShareSourceDraftManual:false,groupSharePreviewRejected:false,groupSharePreviewKey:"",groupSharePreviewLinks:[],groupSharePreviewImages:[],groupShareIndex:0,groupShareDone:0,groupShareSkipped:0,groupShareTotal:0,groupShareNextAt:0,groupSharePendingCaption:"",groupSharePendingIndex:-1,groupShareRecentCaptions:[],groupShareSubmitDispatchedAt:0,groupShareStatus:t("p.shResetDone")}).then(()=>sendResponse({ok:true}));return true;
    }
  });

  setTimeout(async()=>{
    const state=await chrome.storage.local.get(["groupShareActive","groupShareRunId","groupShareOwnerTabId"]),tabId=await ownTabId();
    if(state.groupShareActive&&state.groupShareRunId&&(!state.groupShareOwnerTabId||Number(state.groupShareOwnerTabId)===Number(tabId)))continueGroupShare(state.groupShareRunId);
  },900);
})();
