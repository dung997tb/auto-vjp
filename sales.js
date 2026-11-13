// sales.js - Đăng bài bán hàng theo nhóm, state/selector/success proof riêng
(function(){
  "use strict";
  if(window.__fbSalesPostV196||window.__fbSalesPostV197||window.__fbSalesPostV198)return;
  window.__fbSalesPostV196=true;
  window.__fbSalesPostV197=true;
  window.__fbSalesPostV198=true;
  console.log("[SalesPost] loaded v1.9.52");

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const clean=value=>String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/g," ").replace(/\s+/g," ").trim();
  const labelOf=el=>clean(el?.innerText||el?.textContent||el?.getAttribute?.("aria-label")||el?.getAttribute?.("title")).toLocaleLowerCase("vi");
  const visible=el=>{
    if(!el?.isConnected)return false;
    const style=getComputedStyle(el),r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&style.display!=="none"&&style.visibility!=="hidden"&&style.opacity!=="0";
  };
  const rand=(min,max)=>Math.floor(Math.random()*(Math.max(min,max)-Math.min(min,max)+1))+Math.min(min,max);
  const normalizedPost=value=>clean(value).toLocaleLowerCase("vi");
  let loopActive=false,stopRequested=false,currentRunId="",ownerTabId=0;
  const salesLastMediaSig={};
  const debug=(event,details={})=>{try{console.log("[SalesPost]",event,JSON.stringify(details));}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }};
  const SALES_POST_AUTO={
    groupReadyWait:45000,groupStableWait:1600,
    composerOpenWait:45000,composerReadyWait:45000,
    mediaInputWait:30000,mediaProofWait:45000,
    submitButtonWait:30000,submitProofWait:30000,
    postVisibleWait:30000,afterPostMin:8,afterPostMax:12
  };

  async function getThisTabId(){
    if(ownerTabId)return ownerTabId;
    try{const result=await chrome.runtime.sendMessage({action:"getSenderTabId"});ownerTabId=Number(result?.tabId)||0;}catch(_){ownerTabId=0;}
    return ownerTabId;
  }

  async function isActive(){
    if(stopRequested)return false;
    const state=await chrome.storage.local.get(["salesPostActive","salesPostRunId","salesPostOwnerTabId"]);
    const expectedOwner=Number(state.salesPostOwnerTabId)||0,actualOwner=await getThisTabId();
    return !!state.salesPostActive&&(!expectedOwner||expectedOwner===actualOwner)&&(!currentRunId||state.salesPostRunId===currentRunId);
  }
  async function status(message,extra={}){await chrome.storage.local.set({salesPostStatus:String(message),...extra});}
  async function waitActive(ms){
    const end=Date.now()+Math.max(0,ms);
    while(Date.now()<end){if(!await isActive())return false;await sleep(Math.min(500,end-Date.now()));}
    return await isActive();
  }
  async function trustedClick(el){
    if(!visible(el))return false;
    try{el.scrollIntoView({block:"center",inline:"center"});}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    await sleep(250);
    const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
    // Click theo toạ độ trúng phần tử TRÊN CÙNG tại điểm đó: khi có overlay
    // (bộ chọn danh tính, bảng thông báo) che lên, cú click rơi vào menu bên
    // dưới con trỏ — đã ghi nhận thực tế bấm trúng "Đăng xuất". Chỉ gửi trusted
    // click khi điểm giữa thật sự thuộc về chính element.
    const hit=document.elementFromPoint(x,y);
    if(hit&&(hit===el||el.contains(hit)||hit.contains(el))){
      try{const res=await chrome.runtime.sendMessage({action:"trustedMouse",kind:"click",x,y});if(res?.ok)return true;}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    }
    try{el.click();return true;}catch(_){return false;}
  }
  function currentGroupId(){return String(location.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1]||"").toLowerCase();}
function groupIds(group){
    const ids=[];
    try{const id=new URL(String(group?.url||""),location.href).pathname.match(/^\/groups\/([^/?#]+)/i)?.[1];if(id)ids.push(String(id).toLowerCase());}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    const legacy=String(group?.id||"").trim().toLowerCase();if(legacy&&!ids.includes(legacy))ids.push(legacy);
    return ids;
  }
  function onExpectedGroup(group){
    const ids=groupIds(group),current=currentGroupId();
    if(current&&ids.includes(current))return true;
    const expected=normalizedPost(group?.name);if(!expected)return false;
    return [...document.querySelectorAll("h1,[role=main] h1,meta[property='og:title']")].some(el=>{
      const value=normalizedPost(el.getAttribute?.("content")||el.innerText||el.textContent);
      return value===expected||value.startsWith(`${expected} |`)||value.includes(expected);
    });
  }
  async function waitSalesGroupReady(group){
    const deadline=Date.now()+SALES_POST_AUTO.groupReadyWait;
    let lastMarker="",stableSince=0;
    while(Date.now()<deadline){
      if(!await isActive())return false;
      const main=document.querySelector('[role="main"]'),heading=document.querySelector('h1,[role="main"] h1');
      if(onExpectedGroup(group)&&main&&heading){
        const marker=`${currentGroupId()}|${clean(heading.innerText||heading.textContent)}|${main.childElementCount}`;
        if(marker===lastMarker&&Date.now()-stableSince>=SALES_POST_AUTO.groupStableWait)return true;
        if(marker!==lastMarker){lastMarker=marker;stableSince=Date.now();}
      }else{lastMarker="";stableSince=0;}
      const left=Math.max(1,Math.ceil((deadline-Date.now())/1000));
      await status(t("sales2.waitGroup",{name:group.name,left}));
      await sleep(500);
    }
    return false;
  }
  function editorIn(root=document){
    const candidates=[...root.querySelectorAll('[contenteditable="true"],textarea[aria-label],textarea')].filter(visible);
    return candidates.sort((a,b)=>{
      const as=labelOf(a),bs=labelOf(b),ap=/bạn (?:viết|bán) gì|tạo bài|write something|create post|nội dung/.test(as)?1:0,bp=/bạn (?:viết|bán) gì|tạo bài|write something|create post|nội dung/.test(bs)?1:0;
      return (bp-ap)||((b.getBoundingClientRect().width*b.getBoundingClientRect().height)-(a.getBoundingClientRect().width*a.getBoundingClientRect().height));
    })[0]||null;
  }
  function dialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    return dialogs.reverse().find(d=>{
      if(!editorIn(d))return false;
      const text=labelOf(d);
      return /tạo bài|bạn (?:viết|bán)|đăng bài|create post|write something/.test(text)||!!postButton(d);
    })||null;
  }
  function opener(){
    const normalize=s=>String(s||"").replace(/[​-‍⁠﻿]/g,"").replace(/\s+/g," ").trim();
    const matches=label=>{
      const v=normalize(label).replace(/[.…]+$/g,"").trim();
      return /^(?:bạn\s+(?:đang\s+)?(?:viết|bán)\s+gì(?:\s+đi)?(?:\s+thế)?\s*\??|bạn\s+đang\s+nghĩ\s+gì(?:\s+thế)?\s*\??|viết\s+gì\s+đó\s*\.?|tạo\s+bài\s+viết|write\s+something|create\s+post)$/i.test(v);
    };
    const roots=[document.querySelector('[role="main"]'),document.body].filter(Boolean);
    for(const root of roots){
      const found=[];
      for(const el of root.querySelectorAll('[role="button"],button,div[tabindex],span[tabindex]')){
        if(!visible(el)||el.closest('[role="dialog"]'))continue;
        const label=labelOf(el);
        if(!matches(label)||label.length>80)continue;
        const r=el.getBoundingClientRect();
        if(r.width<20||r.height<10)continue;
        const clickable=el.matches('[role="button"],button,[tabindex]')?el:(el.closest('[role="button"],button,[tabindex]')||el);
        if(!found.some(c=>c===clickable))found.push(clickable);
      }
      if(found.length)return found.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)[0];
    }
    return null;
  }
  function postButton(root){
    return [...(root||document).querySelectorAll('[role="button"],button')].find(el=>{
      const l=labelOf(el);return visible(el)&&/^(đăng|post|publish)$/.test(l)&&el.getAttribute("aria-disabled")!=="true"&&!el.disabled;
    })||null;
  }
  async function waitFor(predicate,timeout=15000){
    const end=Date.now()+timeout;
    while(Date.now()<end){if(!await isActive())return null;try{const value=predicate();if(value)return value;}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }await sleep(220);}
    return null;
  }
  // Một số nhóm hiện dialog "Xin chào!" (giới thiệu bản thân) hoặc "Trả lời
  // câu hỏi" trước/thay cho composer. Không phải composer thật → phát hiện
  // và bỏ qua để tiếp tục mở composer, tránh treo ở bước tìm nút Tạo bài viết.
  function findSalesPostBlockingDialog(){
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    return dialogs.find(d=>{
      if(editorIn(d))return false;
      const text=labelOf(d);
      return /xin\s*ch[àa]o|gi[oớ]i thi[eệ]u b[aả]n th[aâ]n|tr[aả] l[oờ]i c[aâ]u h[oỏ]i|c[aâ]u h[oỏ]i.{0,60}tr[uướ][oớ]c khi [dđ][aă]ng|answer.{0,40}question|question.{0,40}before.{0,40}post/i.test(text);
    })||null;
  }
  async function dismissSalesPostBlockingDialog(){
    for(let attempt=0;attempt<3;attempt++){
      const d=findSalesPostBlockingDialog();
      if(!d)return true;
      const skip=[...d.querySelectorAll('[role="button"],button')].find(el=>visible(el)&&/^(b[oỏ] qua|skip|kh[oô]ng,?\s*c[aả]m [oơ]n|kh[oô]ng)$/i.test(labelOf(el)));
      const close=!skip&&[...d.querySelectorAll('[role="button"],button')].find(el=>visible(el)&&/^([dđ][oó]ng|close)$/i.test(labelOf(el)));
      const btn=skip||close;
      if(!btn)break;
      if(!await trustedClick(btn))break;
      if(await waitFor(()=>!findSalesPostBlockingDialog(),3500))return true;
      await sleep(300);
    }
    return !findSalesPostBlockingDialog();
  }
  // Nhóm Mua-và-bán chỉ có ô "Bán gì đó" (không phải composer thường) —
  // opener() không khớp nên chờ mòn 45s×2. Phát hiện sớm để fail-fast.
  function salesUnsupportedReason(){
    try{
      const btns=[...document.querySelectorAll('[role="main"] [role="button"],[role="main"] button,button,[role="button"]')].filter(visible);
      if(btns.some(b=>/^(bán gì đó|sell something)/i.test(labelOf(b))))return "Nhóm Mua-và-bán (chỉ có ô “Bán gì đó”, chưa hỗ trợ)";
    }catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    return "";
  }
  async function openComposer(groupName){
    const existing=currentComposer();if(existing)return existing;
    await dismissSalesPostBlockingDialog();
    // Tìm nút mở ô đăng có tick (bắt live: "Đang mở ô..." đứng yên suốt 45s).
    const openEnd=Date.now()+SALES_POST_AUTO.composerOpenWait;
    let button=null;
    while(Date.now()<openEnd){
      if(!await isActive())throw new Error("Đã dừng khi tìm nút mở ô đăng bài");
      try{button=opener();if(button)break;}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
      const left=Math.max(1,Math.ceil((openEnd-Date.now())/1000));
      await status(t("sales2.waitOpener",{name:groupName||"",left}));
      await sleep(500);
    }
    if(!button)throw new Error("Không tìm thấy nút Tạo bài viết trong nhóm");
    if(!await trustedClick(button))throw new Error("Không bấm được nút Tạo bài viết");
    // Đợi ô soạn hiện, có tick riêng (đừng lẫn với tìm nút ở trên).
    const readyEnd=Date.now()+SALES_POST_AUTO.composerReadyWait;
    let opened=null;
    while(Date.now()<readyEnd){
      if(!await isActive())throw new Error("Đã dừng khi đợi ô soạn bài");
      opened=await waitComposer(null,1200);
      if(opened)break;
      const left=Math.max(1,Math.ceil((readyEnd-Date.now())/1000));
      await status(t("sales2.waitComposer",{name:groupName||"",left}));
      await sleep(400);
    }
    if(!opened)throw new Error("Facebook chưa tải xong ô đăng bài");
    return opened;
  }
  async function closeComposer(root){
    const current=dialog()||(root?.isConnected?root:null);if(!current)return true;
    const close=[...current.querySelectorAll('[role="button"],button')].find(el=>visible(el)&&/^(đóng|close)\b|đóng hộp thoại|close dialog/i.test(labelOf(el)));
    if(!close)return false;
    if(!await trustedClick(close))return false;
    return !!await waitFor(()=>!dialog(),6000);
  }
  function findFileInput(root){
    const inputs=[...(root||document).querySelectorAll('input[type="file"]')].filter(el=>el.isConnected);
    return inputs.find(el=>/video|image|photo|media/i.test(el.accept||""))||inputs[0]||null;
  }
  function composerRoot(fallback){
    const current=dialog();
    return current||(fallback?.isConnected?fallback:null);
  }
  function currentComposer(fallback){
    const root=composerRoot(fallback),editor=root&&editorIn(root);
    return root&&editor?{dialog:root,editor}:null;
  }
  async function waitComposer(fallback,timeout=SALES_POST_AUTO.composerReadyWait){
    const end=Date.now()+timeout;let stableDialog=null,stableEditor=null,stableAt=0;
    while(Date.now()<end){
      if(!await isActive())return null;
      const current=currentComposer(fallback);
      if(current){
        if(current.dialog===stableDialog&&current.editor===stableEditor&&Date.now()-stableAt>=800)return current;
        if(current.dialog!==stableDialog||current.editor!==stableEditor){stableDialog=current.dialog;stableEditor=current.editor;stableAt=Date.now();}
      }else{stableDialog=null;stableEditor=null;stableAt=0;}
      await sleep(250);
    }
    return null;
  }
  function editorText(editor){
    return clean(editor?.innerText||editor?.textContent||editor?.value||"");
  }
  function domReplaceEditor(editor,content){
    if(!editor||!editor.isConnected)return false;
    try{
      editor.focus();
      const selection=window.getSelection(),range=document.createRange();
      range.selectNodeContents(editor);selection?.removeAllRanges();selection?.addRange(range);
      const inserted=document.execCommand("insertText",false,content);
      if(!inserted||!editorText(editor)){
        // Facebook's contenteditable uses <p>/<br> for line breaks, not \n text nodes.
        // Build DOM nodes so paragraph breaks render correctly in the fallback path.
        editor.innerHTML="";
        const lines=content.split("\n");
        lines.forEach((line,i)=>{
          if(i>0){const br=document.createElement("br");editor.appendChild(br);}
          if(line)editor.appendChild(document.createTextNode(line));
        });
        editor.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,inputType:"insertText",data:content}));
        editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:content}));
      }
      return true;
    }catch(_){return false;}
  }
  function mediaPreviewCount(root){
    const scope=composerRoot(root);if(!scope)return 0;
    const thumbs=[...scope.querySelectorAll("img,video")].filter(el=>{
      if(!visible(el))return false;
      if(el.tagName==="VIDEO")return true;
      const rect=el.getBoundingClientRect(),src=String(el.currentSrc||el.src||el.getAttribute("src")||"");
      const hint=labelOf(el);
      return /^blob:|^data:/i.test(src)||Math.max(rect.width,rect.height)>=72||/remove|xóa|delete|gỡ|photo|video|ảnh/i.test(hint)&&Math.max(rect.width,rect.height)>=48;
    }).length;
    // Facebook virtualizes the attachment grid. The visible thumbnails may be
    // only a subset while a "+N" tile reports the remaining files. Include the
    // overflow count so a large selection is not mistaken for a failed upload.
    const overflowMatches=clean(scope.innerText||scope.textContent).match(/(?:^|\s)\+(\d+)(?=\s|$)/g)||[];
    const overflow=overflowMatches.reduce((total,value)=>total+(Number(value.match(/\d+/)?.[0])||0),0);
    return thumbs+overflow;
  }
  function mediaInputCount(root){
    const scope=composerRoot(root);if(!scope)return 0;
    return [...scope.querySelectorAll('input[type="file"]')].reduce((max,input)=>Math.max(max,input.files?.length||0),0);
  }
  function visibleMediaNameCount(root,files){
    const scope=composerRoot(root);if(!scope)return 0;
    const text=clean(scope.innerText||scope.textContent).toLocaleLowerCase("vi");
    return files.filter(file=>{const name=clean(file.name).toLocaleLowerCase("vi");return name.length>=3&&text.includes(name);}).length;
  }
  function dataUrlFile(data){
    const match=String(data?.dataUrl||"").match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);if(!match)return null;
    const mime=match[1]||data.type||"application/octet-stream",raw=match[2]||"";
    try{
      const binary=atob(raw),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      return new File([bytes],String(data.name||"media"),{type:mime,lastModified:Date.now()});
    }catch(_){return null;}
  }
  async function attachMedia(root,mediaConfig={},groupIndex=-1){
    const stored=await chrome.runtime.sendMessage({action:"salesGetMedia",runId:currentRunId});
    const allRecords=Array.isArray(stored?.media)?stored.media:(stored?.media?[stored.media]:[]);
    const configuredSelection=Array.isArray(mediaConfig?.plan?.[groupIndex])?mediaConfig.plan[groupIndex].map(Number).filter(index=>Number.isInteger(index)&&index>=0):null;
    const records=configuredSelection?configuredSelection.map(index=>allRecords[index]).filter(Boolean):allRecords;
    const expected=Math.max(1,configuredSelection?configuredSelection.length:Number(mediaConfig?.perGroup)||Number(mediaConfig?.count)||records.length);
    const files=records.map(dataUrlFile).filter(Boolean);
    if(!stored?.ok||!records.length)return {ok:true,attached:false,count:0,expected};
    if(configuredSelection&&records.length!==configuredSelection.length)throw new Error("Kế hoạch random media không còn khớp với kho media đã chọn");
    const manifest=Array.isArray(mediaConfig?.manifest)?mediaConfig.manifest:null;
    if(configuredSelection&&manifest&&configuredSelection.some(index=>{
      const actual=allRecords[index],expectedRecord=manifest[index];
      return !actual||!expectedRecord||String(actual.name||"media")!==String(expectedRecord.name||"media")||String(actual.type||"")!==String(expectedRecord.type||"")||(Number(actual.size)||0)!==(Number(expectedRecord.size)||0);
    }))throw new Error("Kho media đã thay đổi sau khi tạo kế hoạch random; hãy dừng và Start lại");
    if(files.length!==records.length)throw new Error("Không đọc được đầy đủ media đã chọn");
    if(records.length<expected)throw new Error(`Thiếu media đã chọn (${records.length}/${expected})`);
    let scope=composerRoot(root),input=findFileInput(scope);
    if(!input){
      const mediaButton=[...(scope||document).querySelectorAll('[role="button"],button')].find(el=>visible(el)&&/ảnh|video|photo|photo\/video|add photo|add media|thêm ảnh|thêm video/i.test(labelOf(el)));
      if(mediaButton)await trustedClick(mediaButton);
    }
    input=await waitFor(()=>{scope=composerRoot(root);return findFileInput(scope);},SALES_POST_AUTO.mediaInputWait);if(!input)throw new Error("Facebook chưa có ô tải ảnh/video");
    const beforeCount=mediaPreviewCount(root),beforeNames=visibleMediaNameCount(root,files);
    debug("media-proof-wait",{expected:files.length,beforeCount,beforeNames});
    // Chỉ dùng tên file làm bằng chứng để tránh coi avatar/ảnh UI sẵn có trong
    // dialog là media đã gắn. Nếu Facebook không hiển thị tên, gửi lại toàn bộ
    // selection qua cùng một input để lần thử hiện tại tự tạo proof mới.
    // Khi Random chọn một tập con, chỉ thấy đủ tên file chưa đủ: composer có
    // thể đang giữ draft cũ với nhiều media hơn selection hiện tại. Chỉ reuse
    // khi số media hiện có không vượt quá selection cần gắn.
    if(beforeNames>=files.length&&(!configuredSelection||beforeCount<=files.length))return {ok:true,attached:true,count:files.length,expected,reused:true};
    if(!await isActive())throw new Error("Đã dừng trước khi đính kèm media");
    try{input.multiple=true;}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));input.files=transfer.files;
    input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
    const loaded=await waitFor(()=>{
      const nowCount=mediaPreviewCount(root),nowNames=visibleMediaNameCount(root,files),nowInput=mediaInputCount(root);
      // Prefer exact evidence from the current file input. The preview grid is
      // virtualized, so its visible thumbnail count alone is not sufficient.
      return nowInput>=files.length||nowNames-beforeNames>=files.length||nowCount-beforeCount>=files.length||nowCount>=files.length&&beforeCount===0;
    },SALES_POST_AUTO.mediaProofWait);
    if(!loaded){
      const error=new Error(`Facebook chưa xác nhận đủ ${files.length} media`);
      error.salesIntegrity=true;
      throw error;
    }
    debug("media-proof-ok",{expected:files.length,previewCount:mediaPreviewCount(root),inputCount:mediaInputCount(root)});
    if(!await waitActive(1200))throw new Error("Đã dừng sau khi đính kèm media");
    return {ok:true,attached:true,count:files.length,expected,names:files.map(file=>file.name)};
  }
  async function typeContent(composer,content,typingConfig=null,groupName){
    const value=String(content||"").trim(),expected=normalizedPost(value);
    const expectedBreaks=(value.match(/\n/g)||[]).length;
    // clean() gộp mọi whitespace thành space nên so text không phát hiện mất
    // xuống dòng — đếm thêm ngắt dòng thật (<br>, biên đoạn) trong HTML.
    const breaksOk=editor=>{
      if(!expectedBreaks)return true;
      try{
        const html=String(editor?.innerHTML||"");
        const breaks=(html.match(/<br[\s>]/gi)||[]).length
          + (html.match(/<\/(p|div|li)>\s*<(p|div|li)/gi)||[]).length;
        return breaks>=expectedBreaks;
      }catch(_){return false;}
    };
    if(!expected)throw new Error("AI trả về nội dung bài bán hàng rỗng");
    const ready=await waitComposer(composer?.dialog||composer,SALES_POST_AUTO.composerReadyWait);
    if(!ready)throw new Error("Facebook chưa có ô nội dung để nhập bài bán hàng");
    const initial=normalizedPost(editorText(ready.editor));
    if(initial===expected&&breaksOk(ready.editor))return;
    if(initial){
      try{await trustedClick(ready.editor);ready.editor.focus();}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
      const modifier=/Mac|iPhone|iPad/i.test(navigator.platform||"")?4:2;
      try{await chrome.runtime.sendMessage({action:"trustedKey",key:"a",code:"KeyA",windowsVirtualKeyCode:65,modifiers:modifier,abortStorageKey:"salesPostActive",abortRunId:currentRunId,abortRunIdKey:"salesPostRunId"});}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
      try{await chrome.runtime.sendMessage({action:"trustedKey",key:"Backspace",code:"Backspace",windowsVirtualKeyCode:8,abortStorageKey:"salesPostActive",abortRunId:currentRunId,abortRunIdKey:"salesPostRunId"});}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
      if(!await waitFor(()=>!normalizedPost(editorText(ready.editor)),2500)){const error=new Error("Facebook còn bản nháp cũ trong ô đăng bán hàng");error.salesIntegrity=true;throw error;}
    }
    debug("content-input-start");
    await status(t("sales2.typing",{name:groupName||""}));
    const verify=()=>{
      const current=currentComposer(ready.dialog);if(!current)return false;
      return normalizedPost(editorText(current.editor))===expected&&breaksOk(current.editor);
    };
    // Establish the real browser focus after Facebook has replaced the
    // composer. A page-level .focus() alone can leave CDP input targeted at
    // the previous dialog.
    try{await trustedClick(ready.editor);}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    try{ready.editor.focus();}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    await sleep(350);
    let response=null;
    const typing=typingConfig
      ? normalizeAiTypingConfig(typingConfig)
      : normalizeAiTypingConfig({mode:"custom",minDelayMs:24,maxDelayMs:70,chunkSize:1,humanLike:true,punctuationPauseMinMs:140,punctuationPauseMaxMs:320,spacePauseMinMs:10,spacePauseMaxMs:40});
    try{response=await chrome.runtime.sendMessage({action:"trustedInput",text:value,typingConfig:typing,abortStorageKey:"salesPostActive",abortRunId:currentRunId,abortRunIdKey:"salesPostRunId"});}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    if(response?.code==="ABORT_TYPING")throw new Error(response.error||"Đã dừng khi đang điền nội dung");
    if(response?.ok&&await waitFor(verify,12000)){debug("content-input-ok",{method:"trustedInput"});return;}
    debug("content-input-fallback",{trustedInput:!!response?.ok});

    // Facebook may acknowledge the debugger input while React drops the
    // resulting mutation during a dialog rerender. Reacquire the live editor,
    // replace its contents once, then verify the rendered text before submit.
    for(let attempt=0;attempt<2;attempt++){
      const current=await waitComposer(null,12000);if(!current)break;
      try{await trustedClick(current.editor);}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
      try{current.editor.focus();}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
      domReplaceEditor(current.editor,value);
      if(await waitFor(verify,12000)){debug("content-input-ok",{method:"dom-replace",attempt:attempt+1});return;}
      await sleep(450);
    }
    const error=new Error("Facebook chưa nhận đủ nội dung bài bán hàng");
    error.salesIntegrity=true;
    throw error;
  }
  const SALES_SUCCESS_RE=/(?:(?:bài viết|post).{0,100}(?:đã (?:được )?đăng|published|posted|submitted)|(?:đã (?:được )?đăng|published|posted|submitted).{0,100}(?:bài viết|post))/i;
  const SALES_PENDING_RE=/(?:(?:bài viết|post).{0,140}(?:(?:đang )?chờ|pending|awaiting|(?:đã )?(?:gửi|submitted|sent)).{0,100}(?:phê duyệt|xét duyệt|xem xét|review|approval|moderation)|(?:(?:đang )?chờ|pending|awaiting).{0,100}(?:phê duyệt|xét duyệt|xem xét|review|approval|moderation).{0,40}(?:\d+\s*)?(?:bài viết|post))/i;
  function salesVisibleAlerts(){
    return [...document.querySelectorAll('[role="alert"],[role="status"]')]
      .filter(visible).map(el=>normalizedPost(el.innerText||el.textContent)).filter(Boolean);
  }
  function salesNewConfirmation(beforeAlerts=new Set()){
    return salesVisibleAlerts().find(text=>!beforeAlerts.has(text)&&(SALES_SUCCESS_RE.test(text)||SALES_PENDING_RE.test(text)))||"";
  }
  function salesVisiblePendingSignals(){
    const main=document.querySelector('[role="main"]');
    const links=[...document.querySelectorAll('a[href*="my_pending_content"],a[href*="pending"]')];
    const candidates=[...(main?.children||[]),...links.flatMap(link=>[link,link.parentElement,link.parentElement?.parentElement])];
    return [...new Set(candidates.filter(visible)
      .map(el=>normalizedPost(el.innerText||el.textContent)).filter(text=>text&&SALES_PENDING_RE.test(text)))];
  }
  function salesNewPendingSignal(beforePending=new Set()){
    return salesVisiblePendingSignals().find(text=>!beforePending.has(text))||"";
  }
  // Proof chống khớp nhầm bài cũ: khi cùng nội dung đã hiện trong feed
  // (ví dụ phiên trước đăng bypass nguyên văn sourceText), proof bài mới
  // phải gắn với permalink chưa từng thấy trước cú bấm Đăng. Key là chuỗi
  // (không giữ DOM node) nên an toàn qua SPA rerender.
  function salesArticleKey(node){
    try{
      const scope=node?.closest?.('[role="article"]')||node;
      if(!scope?.querySelectorAll)return "";
      const links=[...scope.querySelectorAll('a[href]')];
      for(const a of links){
        const href=String(a.getAttribute("href")||"");
        if(/\/(posts|permalink|photo|videos|reel)\//i.test(href)||/[?&](story_fbid|fbid)=/i.test(href)){
          return href.split("?")[0].toLowerCase()+"|"+href.toLowerCase().replace(/^[^?]*\?/,"").split("&").filter(p=>/^(story_fbid|fbid|v|set)=/i.test(p)).sort().join("&");
        }
      }
      return "";
    }catch(_){return "";}
  }
  function salesFeedKeysWith(expected80){
    const keys=new Set();
    try{
      const roots=[document.querySelector('[role="main"]'),document.body].filter(Boolean);
      const candidates=[...new Set(roots.flatMap(root=>[
        ...root.querySelectorAll('[role="article"],[data-pagelet^="FeedUnit_"],[data-ad-preview="message"],[role="feed"] > *')
      ]))];
      for(const node of candidates){
        if(!visible(node)||node.closest('[role="dialog"]'))continue;
        if(!normalizedPost(node.innerText||node.textContent).includes(expected80))continue;
        const key=salesArticleKey(node);
        if(key)keys.add(key);
      }
    }catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    return keys;
  }
  function salesPostContentVisible(content,beforeKeys){
    const expected=normalizedPost(content).slice(0,80);
    if(expected.length<10)return false;
    const strict=beforeKeys instanceof Set&&beforeKeys.size>0;
    const roots=[document.querySelector('[role="main"]'),document.body].filter(Boolean);
    const candidates=[...new Set(roots.flatMap(root=>[
      ...root.querySelectorAll('[role="article"],[data-pagelet^="FeedUnit_"],[data-ad-preview="message"],[role="feed"] > *')
    ]))];
    // Một thẻ bài hợp lệ thường có luôn ô bình luận contenteditable bên trong.
    // Chỉ loại composer trong dialog; loại cả article sẽ làm mất proof bài vừa đăng.
    if(candidates.some(node=>{
      if(!visible(node)||node.closest('[role="dialog"]'))return false;
      if(!normalizedPost(node.innerText||node.textContent).includes(expected))return false;
      if(!strict)return true;
      const key=salesArticleKey(node);
      return !!key&&!beforeKeys.has(key);
    }))return true;
    if(strict)return false;
    const dialogHasExpected=[...document.querySelectorAll('[role="dialog"]')]
      .some(dialog=>visible(dialog)&&normalizedPost(dialog.innerText||dialog.textContent).includes(expected));
    return !dialogHasExpected&&normalizedPost(document.body?.innerText||"").includes(expected);
  }
  function salesPendingPostVisible(content){
    const expected=normalizedPost(content).slice(0,80);
    if(expected.length<10)return false;
    const roots=[document.querySelector('[role="main"]'),document.body].filter(Boolean);
    const candidates=[...new Set(roots.flatMap(root=>[
      ...root.querySelectorAll('[role="article"],[data-pagelet^="FeedUnit_"],[data-ad-preview="message"],[role="feed"] > *')
    ]))];
    return candidates.some(node=>{
      if(!visible(node)||node.closest('[role="dialog"]'))return false;
      const text=normalizedPost(node.innerText||node.textContent);
      return text.includes(expected)&&SALES_PENDING_RE.test(text);
    });
  }
  async function waitForSalesPostDisplayed(content,groupName,proofOptions={}){
    const visibilityDeadline=Date.now()+SALES_POST_AUTO.postVisibleWait;
    const holdMs=SALES_POST_AUTO.afterPostMin*1000+Math.floor(Math.random()*(SALES_POST_AUTO.afterPostMax-SALES_POST_AUTO.afterPostMin+1))*1000;
    const beforeAlerts=proofOptions.beforeAlerts instanceof Set?proofOptions.beforeAlerts:new Set(proofOptions.beforeAlerts||[]);
    const beforePending=proofOptions.beforePending instanceof Set?proofOptions.beforePending:new Set(proofOptions.beforePending||[]);
    const beforeKeys=proofOptions.beforeKeys instanceof Set?proofOptions.beforeKeys:new Set();
    let proofSeenAt=0,proofMethod="";
    while(!proofSeenAt&&Date.now()<visibilityDeadline){
      if(!await isActive())return false;
      const confirmation=proofOptions.confirmation||salesNewConfirmation(beforeAlerts);
      if(confirmation){proofSeenAt=Date.now();proofMethod=SALES_PENDING_RE.test(confirmation)?"pending-confirmation":"confirmation";}
      else if(salesNewPendingSignal(beforePending)){proofSeenAt=Date.now();proofMethod="pending-banner";}
      else if(salesPendingPostVisible(content)){proofSeenAt=Date.now();proofMethod="pending-card";}
      else if(salesPostContentVisible(content,beforeKeys)){proofSeenAt=Date.now();proofMethod=beforeKeys.size?"feed-new":"feed";}
      if(proofSeenAt)break;
      const left=Math.max(1,Math.ceil((visibilityDeadline-Date.now())/1000));
      await status(t("sales2.waitVisible",{name:groupName,left}),{salesPostStage:"waiting-visible"});
      await sleep(500);
    }
    if(!proofSeenAt){const error=new Error(t("sales2.postNotVisible",{name:groupName}));error.submitDispatched=true;throw error;}
    await chrome.storage.local.set({salesPostStage:"post-proof-seen",salesPostProofSeenAt:proofSeenAt,salesPostProofMethod:proofMethod});
    while(Date.now()-proofSeenAt<holdMs){
      if(!await isActive())return false;
      const left=Math.max(1,Math.ceil((holdMs-(Date.now()-proofSeenAt))/1000));
      await status(proofMethod.startsWith("pending")?t("sales2.waitPending",{name:groupName,left}):t("sales2.waitVerify",{name:groupName,left}),{salesPostStage:proofMethod.startsWith("pending")?"waiting-pending":"waiting-visible"});
      await sleep(500);
    }
    await chrome.storage.local.set({salesPostStage:proofMethod.startsWith("pending")?"post-pending":"post-visible"});
    debug("post-proof-ok",{method:proofMethod});
    return true;
  }
  async function submitComposer(composer,content,groupName,index){
    const ready=await waitFor(()=>{
      const current=currentComposer(composer?.dialog||composer),button=current&&postButton(current.dialog);
      return current&&button?{...current,button}:null;
    },SALES_POST_AUTO.submitButtonWait);
    if(!ready)throw new Error("Nút Đăng chưa sẵn sàng");
    const expectedContent=normalizedPost(content),editorBefore=normalizedPost(editorText(ready.editor));
    if(editorBefore!==expectedContent){const error=new Error("Facebook nhận nội dung khác bài AI đã duyệt");error.salesIntegrity=true;throw error;}
    const before=normalizedPost(content).slice(0,45),beforeAlerts=new Set(salesVisibleAlerts()),beforePending=new Set(salesVisiblePendingSignals());
    // Snapshot permalink của các bài đã khớp nội dung TRƯỚC cú bấm: proof
    // feed sau submit chỉ chấp nhận permalink mới, tránh khớp nhầm bài cũ
    // có cùng nội dung còn nằm trong feed (ví dụ phiên bypass trước đó).
    const beforeKeys=salesFeedKeysWith(normalizedPost(content).slice(0,80));
    let confirmation="";
    if(!await isActive())throw new Error("Đã dừng trước khi bấm Đăng");
    await chrome.storage.local.set({salesPostStage:"submit-armed",salesPostSubmitIndex:index,salesPostSubmitDispatchedAt:0});
    if(!await isActive())throw new Error("Đã dừng trước khi bấm Đăng");
    debug("submit-dispatch");
    if(!await trustedClick(ready.button))throw new Error("Không bấm được nút Đăng");
    await chrome.storage.local.set({salesPostStage:"submitted",salesPostSubmitIndex:index,salesPostSubmitDispatchedAt:Date.now()});
    const proof=await waitFor(()=>{
      confirmation=salesNewConfirmation(beforeAlerts);
      if(confirmation)return true;
      confirmation=salesNewPendingSignal(beforePending);
      if(confirmation)return true;
      const d=dialog();
      if(!d)return true;
      const ed=editorIn(d),now=normalizedPost(ed?.innerText||ed?.textContent||ed?.value);
      return !now||!now.includes(before);
    },SALES_POST_AUTO.submitProofWait);
    if(!proof){
      const error=new Error("Facebook chưa xác nhận đăng bài sau cú bấm");
      error.submitDispatched=true;
      throw error;
    }
    debug("submit-proof-ok");
    await waitForSalesPostDisplayed(content,groupName,{beforeAlerts,beforePending,confirmation,beforeKeys});
    return true;
  }
  async function generate(group,cfg,globalIndex,product){
    const saved=await chrome.storage.local.get(["salesPostPendingContent","salesPostPendingIndex"]);
    if(Number(saved.salesPostPendingIndex)===globalIndex&&clean(saved.salesPostPendingContent))return {ok:true,content:saved.salesPostPendingContent};
    const accepted=Array.isArray(cfg.acceptedChatPosts)?String(cfg.acceptedChatPosts[globalIndex]||"").trim():"";
    if(accepted){
      await chrome.storage.local.set({salesPostPendingContent:accepted,salesPostPendingIndex:globalIndex});
      debug("content-from-chat",{globalIndex});
      return {ok:true,content:accepted,source:"chat"};
    }
    const src=product?.sourceText||cfg.sourceText||"";
    const info=product?.productInfo||cfg.productInfo||"";
    const prompt=String(product?.prompt||"").trim()||cfg.prompt;
    const response=await chrome.runtime.sendMessage({action:"aiGenerateSalesPost",groupName:group.name,sourceText:src,productInfo:info,prompt,aiConfig:cfg.aiConfig,styleProfileId:cfg.styleProfileId,variant:globalIndex+1});
    if(!response?.ok)throw new Error(response?.error||"AI không tạo được bài bán hàng");
    await chrome.storage.local.set({salesPostPendingContent:response.content,salesPostPendingIndex:globalIndex});
    return response;
  }

  async function salesGetProductMedia(productId){
    const stored=await chrome.runtime.sendMessage({action:"salesGetProductMedia",productId,runId:currentRunId});
    return Array.isArray(stored?.media)?stored.media:[];
  }
  async function attachProductMedia(composerRoot,product){
    // Người dùng tick "đăng không kèm ảnh": bỏ qua media dù vẫn còn file đã chọn
    if(product?.media?.skip)return {ok:true,attached:false,count:0,expected:0,skipped:true};
    if(!product?.media?.enabled||!product.media.count)return {ok:true,attached:false,count:0,expected:0};
    const allRecords=await salesGetProductMedia(product.id);
    const allFiles=allRecords.map(item=>{
      try{const match=item.dataUrl.match(/^data:([^;]+);base64,(.+)$/);if(!match)return null;const mime=match[1],raw=atob(match[2]),buf=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)buf[i]=raw.charCodeAt(i);return new File([buf],String(item.name||"media"),{type:mime,lastModified:Date.now()});}catch(_){return null;}
    }).filter(Boolean);
    // mediaMode: "random" → chọn N file ngẫu nhiên (ô "Số media mỗi nhóm");
    // "all" → dùng tất cả. perGroup kẹp 1..min(20, tổng file).
    const mode=String(product.media?.mode||"random");
    const wantCount=mode==="random"
      ?Math.max(1,Math.min(allFiles.length||1,20,Number(product.media?.perGroup)||Number(product.media?.mediaCount)||1))
      :allFiles.length;
    const shuffled=[...allFiles];
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    let files=mode==="all"?allFiles:shuffled.slice(0,wantCount);
    // Tránh lặp y hệt nhóm liền trước khi có thể (chỉ khi random thiếu file)
    try{
      const sig=list=>list.map(f=>f.name).sort().join("|");
      const lastSig=String(salesLastMediaSig[product.id]||"");
      if(mode==="random"&&files.length<allFiles.length&&lastSig&&sig(files)===lastSig&&shuffled.length>files.length){
        const alt=shuffled.find(f=>!files.includes(f));
        if(alt)files=[...files.slice(0,-1),alt];
      }
      salesLastMediaSig[product.id]=sig(files);
    }catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    if(!files.length)return {ok:true,attached:false,count:0,expected:product.media.count};
    let scope=composerRoot,input=findFileInput(scope);
    if(!input){
      const mediaButton=[...(scope||document).querySelectorAll('[role="button"],button')].find(el=>visible(el)&&/ảnh|video|photo|photo\/video|add photo|add media|thêm ảnh|thêm video/i.test(labelOf(el)));
      if(mediaButton)await trustedClick(mediaButton);
    }
    input=await waitFor(()=>{scope=composerRoot;return findFileInput(scope);},SALES_POST_AUTO.mediaInputWait);
    if(!input)throw new Error("Facebook chưa có ô tải ảnh/video");
    const beforeCount=mediaPreviewCount(composerRoot),beforeNames=visibleMediaNameCount(composerRoot,files);
    if(beforeNames>=files.length&&beforeCount<=files.length)return {ok:true,attached:true,count:files.length,expected:files.length,reused:true};
    if(!await isActive())throw new Error("Đã dừng trước khi đính kèm media");
    try{input.multiple=true;}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }
    const transfer=new DataTransfer();files.forEach(file=>transfer.items.add(file));input.files=transfer.files;
    input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
    const loaded=await waitFor(()=>{
      const nowCount=mediaPreviewCount(composerRoot),nowNames=visibleMediaNameCount(composerRoot,files),nowInput=mediaInputCount(composerRoot);
      return nowInput>=files.length||nowNames-beforeNames>=files.length||nowCount-beforeCount>=files.length||nowCount>=files.length&&beforeCount===0;
    },SALES_POST_AUTO.mediaProofWait);
    if(!loaded)throw new Error(`Facebook chưa xác nhận đủ ${files.length} media của sản phẩm`);
    if(!await waitActive(1200))throw new Error("Đã dừng sau khi đính kèm media");
    return {ok:true,attached:true,count:files.length,expected:files.length};
  }

  async function run(){
    if(loopActive)return;loopActive=true;stopRequested=false;
    try{
      const state=await chrome.storage.local.get(["salesPostActive","salesPostRunId","salesPostConfig","salesPostIndex","salesPostDone","salesPostSkipped","salesPostNextAt","salesPostStage","salesPostSubmitIndex","salesPostSubmitDispatchedAt"]);
      currentRunId=String(state.salesPostRunId||"");const cfg=state.salesPostConfig;
      if(!state.salesPostActive||!cfg?.groups?.length)return;
      // Hỗ trợ cả config cũ (sourceText đơn) lẫn config mới (products[])
      const products=Array.isArray(cfg.products)&&cfg.products.length?cfg.products:[{id:"legacy",name:"",sourceText:cfg.sourceText||"",productInfo:cfg.productInfo||"",media:{enabled:false,count:0}}];
      // "Số bài mỗi nhóm": lặp toàn bộ lượt sản phẩm trong cùng nhóm (mỗi lượt
      // có globalIndex/variant AI riêng nên nội dung khác nhau, không trùng bài)
      const repeat=Math.max(1,Math.min(100000,Number(cfg.postsPerGroup)||1));
      let index=Number(state.salesPostIndex)||0,done=Number(state.salesPostDone)||0,skipped=Number(state.salesPostSkipped)||0;
      const totalPosts=cfg.groups.length*products.length*repeat;
      if(index>=cfg.groups.length){await status(`Hoàn tất: đã đăng ${done}/${totalPosts} bài, bỏ qua ${skipped} nhóm`,{salesPostActive:false,salesPostNextAt:0});return;}
      const group=cfg.groups[index];
      const minDelay=Math.min(604800,Math.max(5,Number(cfg.minDelay)||30));
      const maxDelay=Math.min(604800,Math.max(minDelay,Number(cfg.maxDelay)||60));
      if(!onExpectedGroup(group)){await status(`Đang mở đúng nhóm ${index+1}/${cfg.groups.length}: ${group.name}`);location.assign(group.url);return;}
      if((state.salesPostStage==="submit-armed"||state.salesPostStage==="submitted"||state.salesPostStage==="waiting-visible"||state.salesPostStage==="waiting-pending"||state.salesPostStage==="post-proof-seen"||state.salesPostStage==="post-visible"||state.salesPostStage==="post-pending")&&Number(state.salesPostSubmitIndex)===index){
        await status(`Đã dừng tại nhóm ${group.name}: Facebook đã nhận cú bấm Đăng nhưng phiên bị tải lại trước khi xác minh bài hiển thị`,{salesPostActive:false,salesPostNextAt:0});return;
      }
      // Giãn cách giữa 2 nhóm CHẠY TRƯỚC khi chờ giao diện (bắt live: chờ câm
      // ~48s sau khi đã ghi "chờ ổn định còn 44s" khiến đồng hồ đứng yên).
      // Có tick riêng để không lẫn với countdown chờ giao diện.
      const nextAt=Number(state.salesPostNextAt)||0;
      if(nextAt>Date.now()){
        const end=nextAt;
        while(Date.now()<end){
          if(!await isActive())return;
          const left=Math.max(1,Math.ceil((end-Date.now())/1000));
          await status(t("sales2.waitDelay",{name:group.name,left}));
          await sleep(500);
        }
      }
      if(!await waitActive(1800))return;
      if(!await waitSalesGroupReady(group)){
        if(!await isActive())return;
        skipped++;
        await chrome.storage.local.set({salesPostSkipped:skipped,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:`Bỏ qua nhóm ${group.name}: ${t("sales2.groupLoading")}; đã đăng ${done}/${totalPosts}`});
        index++;
        if(index<cfg.groups.length&&await isActive()){
          await chrome.storage.local.set({salesPostIndex:index,salesPostNextAt:0});
          location.assign(cfg.groups[index].url);
        }else{
          await status(`Hoàn tất: đã đăng ${done} bài tại ${index} nhóm, bỏ qua ${skipped} nhóm`,{salesPostActive:false,salesPostNextAt:0,salesPostIndex:index});
        }
        return;
      }
      await dismissSalesPostBlockingDialog();
      if(!await waitActive(1800))return;
      let postedCount=0,lastError="",halted=false;
      // Gắn provider/model vào log để lần sau lỗi AI là biết ngay đang dùng key nào
      // (chỉ provider/model, KHÔNG bao giờ ghi key). Bắt live: key gemini hỏng mà
      // log chỉ hiện text lỗi Google, không biết key nào đang chạy.
      const aiTag=`[${cfg.aiConfig?.provider||"?"}:${cfg.aiConfig?.model||"?"}]`;
      // Loop từng sản phẩm trong nhóm, lặp lại theo "Số bài mỗi nhóm"
      repeatLoop:
      for(let rep=0;rep<repeat&&!halted;rep++){
      productLoop:
      for(let pIdx=0;pIdx<products.length&&!halted;pIdx++){
        const product=products[pIdx];
        const globalIndex=(index*repeat+rep)*products.length+pIdx; // index duy nhất cho cache pending + variant AI
        const productLabel=product.name||product.sourceText?.slice(0,25)||`SP${pIdx+1}`;
        const turnLabel=repeat>1?` (lượt ${rep+1}/${repeat})`:"";
        await status(`Đang chuẩn bị sản phẩm ${pIdx+1}/${products.length}${turnLabel} tại nhóm ${index+1}/${cfg.groups.length}: ${productLabel} — ${group.name}`);
        let posted=false;
        for(let attempt=1;attempt<=2&&!posted;attempt++){
          let composer=null;
          try{
            // Fail-fast TRƯỚC khi tốn lượt AI (bắt live: nhóm Mua-và-bán mất
            // ~1 lượt AI + 90s chờ opener mới skip). Trang đã ổn định nên probe
            // nhanh 5s là đủ; opener() rẻ (quét DOM, không gọi mạng).
            const probe=await waitFor(opener,5000);
            if(!probe){
              if(!await isActive())return;
              const why=salesUnsupportedReason();
              const error=new Error(why?`${why} — bỏ qua, không tốn AI`:t("sales2.noComposer"));
              error.noComposer=true;
              throw error;
            }
            await status(`AI ${aiTag} đang viết bài cho sản phẩm "${productLabel}" tại: ${group.name}`);
            const ai=await generate(group,cfg,globalIndex,product);if(!ai?.content)throw new Error("AI trả về nội dung rỗng");
            await status(`Đang mở ô đăng bài lần ${attempt}/2 tại: ${group.name} (${productLabel})`);
            composer=await openComposer(group.name);
            if(product.media?.enabled){
              const media=await attachProductMedia(composer.dialog,product);
              if(product.media.enabled&&!media.attached&&media.expected>0)throw new Error("Chưa đính kèm đủ media của sản phẩm");
            }
            composer=await waitComposer(composer.dialog,SALES_POST_AUTO.composerReadyWait);
            if(!composer){const error=new Error("Facebook chưa dựng lại ô nội dung sau khi chuẩn bị media");error.salesIntegrity=true;throw error;}
            await typeContent(composer,ai.content,cfg.typingConfig||null,group.name);
            if(!await waitActive(1500))return;
            await submitComposer(composer,ai.content,group.name,globalIndex);
            if(!await isActive())return;
            posted=true;
          }catch(error){
            lastError=String(error?.message||error);
            await status(`Lần ${attempt}/2 chưa thành công ${aiTag} — "${productLabel}" tại ${group.name}: ${lastError}`);
            if(error?.submitDispatched){halted=true;break;}
            // Không mở được ô đăng thì mọi sản phẩm còn lại cùng chung số phận
            // → thoát cả nhóm ngay, khỏi thử lại vô ích.
            if(error?.noComposer){break productLoop;}
            if(!await isActive())return;
            if(attempt<2){
              const reset=await closeComposer(composer?.dialog);
              if(!reset){lastError="Không thể làm mới ô đăng bài sau lỗi; bỏ qua nhóm này";break productLoop;}
              if(!await waitActive(2500))return;
            }
          }
        }
        if(posted){postedCount++;done++;await chrome.storage.local.set({salesPostDone:done,salesPostStatus:`Đã đăng ${done}/${totalPosts} bài tổng (nhóm ${index+1}/${cfg.groups.length}, SP ${pIdx+1}/${products.length}${repeat>1?`, lượt ${rep+1}/${repeat}`:""}): ${productLabel} — ${group.name}`});try{const life=await chrome.storage.local.get("salesPostLifetimeDone");await chrome.storage.local.set({salesPostLifetimeDone:(Number(life.salesPostLifetimeDone)||0)+1});}catch(_){ console.debug("[Auto vjp][sales] bỏ qua lỗi:", _); }}
        if(!posted&&!halted)lastError=lastError||"Không đăng được";
        // Delay ngắn giữa các bài trong cùng nhóm (kể cả khác lượt)
        const isLastItem=rep===repeat-1&&pIdx===products.length-1;
        if(!isLastItem&&posted&&!halted){if(!await waitActive(3000))return;}
      }
      }
      if(halted){
        // submitDispatched: bài đã gửi nhưng không xác nhận được → bỏ qua nhóm này, tiếp tục nhóm tiếp theo
        skipped++;
        await chrome.storage.local.set({salesPostSkipped:skipped,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0});
        index++;
        if(index<cfg.groups.length&&await isActive()){
          await chrome.storage.local.set({salesPostIndex:index,salesPostNextAt:0,salesPostStatus:`Bỏ qua nhóm ${group.name} (bài đã gửi, chưa xác nhận): sang ${cfg.groups[index].name}`});
          location.assign(cfg.groups[index].url);
        }else{
          await status(`Hoàn tất: đã đăng ${done} bài tại ${index-1} nhóm, bỏ qua ${skipped} nhóm`,{salesPostActive:false,salesPostNextAt:0,salesPostIndex:index});
        }
        return;
      }
      if(postedCount===0){skipped++;await chrome.storage.local.set({salesPostSkipped:skipped,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:`Bỏ qua nhóm ${group.name}: ${lastError}; đã đăng ${done}/${totalPosts}`});index++;}
      else{index++;await chrome.storage.local.set({salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:`Đã đăng ${postedCount}/${products.length*repeat} bài tại nhóm ${group.name}; tổng ${done}/${totalPosts} bài`});}
      if(index<cfg.groups.length&&await isActive()){
        const delay=Math.round(minDelay+Math.random()*Math.max(0,maxDelay-minDelay)),nextRun=Date.now()+delay*1000;
        await chrome.storage.local.set({salesPostIndex:index,salesPostNextAt:nextRun,salesPostStatus:`Đã xong nhóm ${group.name}; chờ ${delay}s trước khi sang ${cfg.groups[index].name}`});
        if(await isActive())location.assign(cfg.groups[index].url);
      }else await status(`Hoàn tất: đã đăng ${done} bài tại ${index} nhóm, bỏ qua ${skipped} nhóm`,{salesPostActive:false,salesPostNextAt:0,salesPostIndex:index});
    }catch(error){console.warn("[SalesPost]",error);await status(`Lỗi đăng bài bán hàng: ${error.message}`,{salesPostActive:false});}
    finally{loopActive=false;}
  }
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes.salesPostActive?.newValue===false)stopRequested=true;});
  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg.action==="startSalesPost"){
      currentRunId=String(msg.runId||"");stopRequested=false;ownerTabId=Number(sender.tab?.id)||ownerTabId;
      chrome.storage.local.set({salesPostActive:true,salesPostRunId:currentRunId,salesPostOwnerTabId:ownerTabId,salesPostConfig:msg.config,salesPostIndex:0,salesPostDone:0,salesPostSkipped:0,salesPostTotal:(msg.config?.groups?.length||0)*(Array.isArray(msg.config?.products)&&msg.config.products.length?msg.config.products.length:1)*Math.max(1,Math.min(100000,Number(msg.config?.postsPerGroup)||1)),salesPostNextAt:0,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:"Đang bắt đầu đăng bài bán hàng..."}).then(()=>{setTimeout(run,200);sendResponse({ok:true});});
      return true;
    }
    if(msg.action==="stopSalesPost"){
      stopRequested=true;chrome.storage.local.set({salesPostActive:false,salesPostNextAt:0,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostStatus:"Đã dừng đăng bài bán hàng"}).then(()=>sendResponse({ok:true}));return true;
    }
    if(msg.action==="resetSalesPost"){
      stopRequested=true;chrome.storage.local.set({salesPostActive:false,salesPostRunId:"",salesPostOwnerTabId:0,salesPostConfig:null,salesPostIndex:0,salesPostDone:0,salesPostSkipped:0,salesPostTotal:0,salesPostLifetimeDone:0,salesPostNextAt:0,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:"Đã reset tiến trình đăng bán hàng"}).then(()=>sendResponse({ok:true}));return true;
    }
    return false;
  });
  chrome.storage.local.get(["salesPostActive","salesPostRunId","salesPostOwnerTabId"]).then(async state=>{if(state.salesPostActive){currentRunId=String(state.salesPostRunId||"");ownerTabId=Number(state.salesPostOwnerTabId)||0;if(await isActive())setTimeout(run,700);}}).catch(()=>{});
})();
