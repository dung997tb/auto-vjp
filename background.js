// background.js - xu ly goi da API AI de tao comment
try { importScripts("store.js", "i18n.js", "aiTyping.js", "pageStore.js", "scrapeStore.js"); } catch (_) { }
// Nhật ký hoạt động bền vững dùng chung với feed.js/popup.js (cùng key
// storage "activityLog") — xem chú thích đầy đủ ở bản trong feed.js. Ghi ở
// đây các mốc điều phối chuỗi (chain) mà content script không thấy được:
// bắt đầu mỗi bước, và khi cả chuỗi dừng do một bước lỗi.
const ACTIVITY_LOG_LIMIT=2000;
let activityLogQueue=Promise.resolve();
// Xác định mức độ log từ nội dung câu trạng thái.
function detectLogLevel(msg){
  const s=String(msg||"");
  if(/lỗi|error|thất bại|failed|dừng hẳn|DỪNG HẲN|quota|timeout|unauthorized|forbidden|không thể|cannot|hết key|hết hạn|blocked|bị chặn|sai key|invalid key|bị khoá|bị khóa|captcha|checkpoint/i.test(s))return"error";
  if(/bỏ qua|skip|warning|cảnh báo|thử lại|retry|chậm|rate.?limit|giới hạn|không tìm thấy|not found|thiếu/i.test(s))return"warn";
  if(/hoàn tất|hoàn thành|done|completed|xong|thành công|success/i.test(s))return"done";
  if(/bắt đầu|starting|started|đang chạy|running/i.test(s))return"start";
  return"info";
}
async function logActivity(feature,msg,level){
  // Nối tiếp các lần ghi: nhiều tính năng cùng ghi song song sẽ đọc–sửa–ghi
  // đè nhau và mất dòng nhật ký.
  const lvl=level||detectLogLevel(msg);
  activityLogQueue=activityLogQueue.then(async()=>{
    try{
      const {activityLog}=await chrome.storage.local.get("activityLog");
      const log=Array.isArray(activityLog)?activityLog:[];
      log.push({t:Date.now(),feature,msg:String(msg||"").slice(0,600),level:lvl});
      if(log.length>ACTIVITY_LOG_LIMIT)log.splice(0,log.length-ACTIVITY_LOG_LIMIT);
      await chrome.storage.local.set({activityLog:log});
    }catch(_){}
  }).catch(()=>{});
  return activityLogQueue;
}

// Trước đây chỉ feed.js và vài mốc điều phối chuỗi gọi logActivity, nên chạy
// bất kỳ tính năng nào khác là nhật ký trống trơn — không truy được đã hỏng ở
// đâu. Mọi tính năng đều đã ghi câu trạng thái của mình vào storage, nên phản
// chiếu đúng những câu đó sang nhật ký tại MỘT chỗ, thay vì rải lệnh ghi log
// khắp các content script.
const ACTIVITY_STATUS_KEYS={
  friendStatus:"friend",friendConfirmStatus:"friend",friendFoFStatus:"friend",
  scrapeStatus:"scrape",scrapeMediaStatus:"scrape",
  aiStatus:"aiFeed",feedStatus:"feed",
  feedBantinStatus:"feedBantin",feedBantinAiStatus:"feedBantin",
  feedFriendsStatus:"feedFriends",feedGroupsStatus:"feedGroups",feedPagesStatus:"feedPages",
  feedFriendsAiStatus:"feedFriends",feedGroupsAiStatus:"feedGroups",feedPagesAiStatus:"feedPages",
  groupStatus:"keyword",discoverStatus:"discover",
  groupInteractStatus:"groupInteract",groupCommentStatus:"groupComment",groupPostStatus:"groupPost",
  groupShareStatus:"share",salesPostStatus:"sales",
  trendLearnStatus:"trendLearn",trendPostStatus:"trendPost",
  pageGroupJoinStatus:"pageGroupJoin",pageGroupPostStatus:"pageGroupPost",
  pageCommentStatus:"pageComment",pageSalesPostStatus:"pageSales",
  pageGroupCommentStatus:"pageGroupComment"
};
// Đếm ngược và các câu lặp lại chỉ làm trôi mất dòng quan trọng.
const ACTIVITY_NOISE=/^(?:chờ|waiting|đang chờ)\s+\d+\s*(?:giây|s|second)/i;
const activityLastMsg=new Map();
function mirrorStatusToActivityLog(changes){
  for(const key of Object.keys(changes)){
    const feature=ACTIVITY_STATUS_KEYS[key];
    if(!feature)continue;
    const msg=String(changes[key]?.newValue||"").trim();
    if(!msg||ACTIVITY_NOISE.test(msg))continue;
    if(activityLastMsg.get(key)===msg)continue;
    activityLastMsg.set(key,msg);
    logActivity(feature,msg);
  }
}
const AI_DEFAULTS = {
  openai: { url: "https://api.openai.com/v1/chat/completions", model: "gpt-5-mini" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models", model: "gemini-2.5-flash-lite" },
  claude: { url: "https://api.anthropic.com/v1/messages", model: "claude-haiku-4-5-20251001" },
  Muse: { url: "https://api.anthropic.com/v1/messages", model: "claude-haiku-4-5-20251001" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-20b" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-4o-mini" },
  deepseek: { url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
  vilao: { url: "https://api.vilao.ai/v1/chat/completions", model: "ts/deepseek-v4-flash" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" },
  custom: { url: "", model: "" },
  // Meta AI Free: không gọi HTTP API mà hỏi qua tab meta.ai (metaai.js).
  // Không cần key/url; model chỉ là nhãn hiển thị.
  "meta-free": { url: "", model: "meta-ai" }
};

const MODEL_CATALOG_URLS = {
  openai: "https://api.openai.com/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  claude: "https://api.anthropic.com/v1/models",
  Muse: "https://api.anthropic.com/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
  deepseek: "https://api.deepseek.com/models",
  vilao: "https://api.vilao.ai/v1/models",
  mistral: "https://api.mistral.ai/v1/models"
};

function normalizeApiKey(value){
  return String(value||"").trim().replace(/^GEMINI_API_KEY\s*=\s*/i,"").replace(/^['"]|['"]$/g,"").trim();
}
// Dấu vân tay key để chẩn đoán (đủ nhận biết key nào, không lộ secret).
function maskApiKey(value){
  const k=String(value||"");
  if(!k)return "trống";
  if(k.length<=8)return k.slice(0,2)+"...";
  return k.slice(0,4)+"..."+k.slice(-3);
}
function friendlyAiError(error,provider){
  const raw=String(error?.message||error||t("bg.errApi"));
  if(/API_KEY_INVALID|API key not valid|incorrect API key|invalid API key|invalid authentication credentials|authentication failed|unauthorized/i.test(raw)){
    // Mỗi provider tạo key ở nơi khác nhau — hướng dẫn sai chỗ (vd bảo key Vilao
    // vào Google AI Studio) khiến user đi sai đường. Bắt live từ video user quay.
    if(String(provider||"").toLowerCase()==="vilao")return t("bg.errKeyInvalidVilao");
    return t("bg.errKeyInvalid",{provider:provider});
  }
  if(/PERMISSION_DENIED|permission denied|insufficient permission|forbidden/i.test(raw))return t("bg.errPermDenied",{provider:provider});
  // Vilao "subscribe to model" error — extract model name before redaction mangled it
  const subscribeMatch=raw.match(/subscribe to model[^:]*:\s*([^\s"']+)/i);
  if(subscribeMatch)return `Model "${subscribeMatch[1]}" chưa được subscribe. Vào vilao.ai → API Keys → chọn đúng model này rồi bấm Refresh.`;
  return raw
    .replace(/(Incorrect API key provided:\s*)[^\s]+/ig,"$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9]{10,})/g,"[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/ig,"$1[redacted]");
}

function modelCatalogId(item){
  return String(item?.id||item?.baseModelId||item?.name||"").trim().replace(/^models\//i,"");
}
function isTextModelForProvider(provider,item,id){
  const value=String(id||"").toLowerCase();
  if(!value)return false;
  if(item?.active===false||item?.archived===true)return false;
  if(provider==="gemini"){
    const methods=Array.isArray(item?.supportedGenerationMethods)?item.supportedGenerationMethods:[];
    return (!methods.length||methods.includes("generateContent"))&&!/(embedding|image|tts|live|transcrib|veo|robotics|lyria|banana|computer-use|antigravity|deep-research|audio|music)/i.test(value);
  }
  if(provider==="openai"){
    return /^(gpt-|o\d|chatgpt-)/i.test(value)&&!/(embedding|moderation|dall-e|gpt-image|sora|realtime|audio|transcrib|whisper|search-preview|computer-use|codex)/i.test(value);
  }
  if(provider==="claude")return /^claude-/i.test(value);
  if(provider==="groq")return !/(whisper|embedding|moderation|guard|safety)/i.test(value);
  if(provider==="openrouter")return !/(embedding|moderation|tts|transcrib|whisper|image|audio|video)/i.test(value);
  if(provider==="deepseek")return !/(embedding|moderation|coder)/i.test(value);
  if(provider==="mistral")return item?.capabilities?.completion_chat!==false&&!/(embedding|moderation|ocr|transcrib|tts|fim)/i.test(value);
  return true;
}
async function listProviderModels(provider,key){
  const normalizedProvider=provider==="Muse"?"claude":provider;
  const url=MODEL_CATALOG_URLS[normalizedProvider]||MODEL_CATALOG_URLS[provider];
  if(!url)throw new Error(t("bg.noProvider",{provider:provider}));
  const headers={"Content-Type":"application/json"};
  if(normalizedProvider==="gemini")headers["x-goog-api-key"]=key;
  else if(normalizedProvider==="claude"){headers["x-api-key"]=key;headers["anthropic-version"]="2023-06-01";}
  else headers.Authorization=`Bearer ${key}`;
  const res=await fetch(url,{method:"GET",headers});
  let data={};try{data=await res.json();}catch{}
  if(!res.ok)throw new Error(data.error?.message||data.message||JSON.stringify(data).slice(0,300)||`HTTP ${res.status}`);
  const items=Array.isArray(data.models)?data.models:(Array.isArray(data.data)?data.data:[]);
  const models=[];
  for(const item of items){
    const id=modelCatalogId(item);
    if(id&&isTextModelForProvider(normalizedProvider,item,id)&&!models.includes(id))models.push(id);
  }
  if(!models.length)throw new Error(t("bg.modelsEmpty"));
  return models.slice(0,500);
}

// Ký tự thay thế U+FFFD (AI đôi khi sinh ra) và surrogate lẻ (do cắt chuỗi
// giữa cặp emoji) hiện thành ký tự lỗi và khiến Facebook từ chối bài. Cắt chuỗi
// luôn theo code-point, không bao giờ theo UTF-16 unit.
function sanitizePostedText(value){
  return String(value||"")
    .replace(/\uFFFD/g,"")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g,"")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,"");
}
function sliceByCodePoints(value,max){
  const chars=[...String(value||"")];
  return chars.length>max?chars.slice(0,max).join(""):chars.join("");
}
// Cắt ngắn nhưng KHÔNG bao giờ cụt giữa câu: ưu tiên câu hoàn chỉnh dài nhất
// vừa giới hạn, cùng lắm cắt tại ranh giới từ. Mọi cleaner (nhóm/trend/bán/
// share/Page) đều phải qua đây thay vì sliceByCodePoints trần.
function truncateAtSentence(value,max){
  const text=sanitizePostedText(String(value||"")).trim();
  if([...text].length<=max||!text)return text;
  const parts=text.match(/[^.!?。！？]+[.!?。！？]+/g)||[];
  let complete="";
  for(const part of parts){
    const candidate=`${complete}${part}`.trim();
    if([...candidate].length>max)break;
    complete=candidate;
  }
  if(complete)return complete;
  return sliceByCodePoints(text,max).replace(/\s+\S*$/,"").replace(/[,:;.!?…\-]+\s*$/g,"").trim();
}
function normalizeBackgroundMaxChars(value){
  // Facebook drops colored backgrounds once the post exceeds its practical
  // 130-character limit, even though the composer can still accept text.
  return Math.min(130,Math.max(40,parseInt(value)||100));
}
function backgroundTargetRange(value){
  const max=normalizeBackgroundMaxChars(value);
  return {min:max>=60?Math.max(40,max-15):max,max};
}
function backgroundTextLength(value){
  return [...sanitizePostedText(value||"")].length;
}
function backgroundPromptRules(background={}){
  if(!background.enabled)return "";
  return `${t("bg.postBgRules",backgroundTargetRange(background.maxChars))} ${t("bg.postBgSemantic")}`;
}
function commentSharesPostDetail(comment,postText){
  // Stopwords inline trong hàm để hàm thuần khiết (unit-test trích được).
  const STOP=new Set("các,của,và,là,có,không,một,những,được,trong,với,cho,đến,từ,để,như,rất,hay,này,đó,bạn,mình,tôi,em,anh,chị,ạ,nhé,quá,lắm,thì,mà,cũng,vẫn,sẽ,đã,đang,ở,tại,về,ra,vào,lên,xuống,qua,lại,ai,gì,nào,sao,thế,nên,nếu,khi,mỗi,mọi,cùng,the,a,an,to,of,in,on,for,with,by,is,are,this,that".split(","));
  try{
    const tok=s=>String(s||"").toLowerCase().normalize("NFC").match(/[\p{L}\p{N}]+/gu)||[];
    const postSet=new Set(tok(postText).filter(w=>w.length>=2&&!STOP.has(w)));
    // Bài ít hơn 2 từ chất liệu thì không đủ cơ sở chấm → không chặn oan.
    if(postSet.size<2)return true;
    // Đòi ÍT NHẤT 2 từ chung khác nhau: tiếng Việt nhiều từ đơn âm tiết nên
    // 1 từ chung (VD "cầu" trong "yêu cầu" vs "Cầu Giấy") vẫn lọt câu rác.
    const hits=new Set(tok(comment).filter(w=>w.length>=2&&!STOP.has(w)&&postSet.has(w)));
    return hits.size>=2;
  }catch(_){return true;}
}
function cleanGeneratedComment(raw, maxLines=1){
  // Tag 2 câu (câu 2 dệt tên) phải giữ cả 2 dòng — trước đây cleaner chỉ lấy
  // dòng đầu nên câu tag bị vứt, comment đăng lên mất tên (bắt live). maxLines
  // chỉ bật khi content báo tag (mặc định 1 giữ nguyên mọi hành vi cũ).
  const keepN=Math.max(1,Math.min(2,parseInt(maxLines)||1));
  const META_LINE_RE=/^(dưới đây|sau đây|gợi ý|lựa chọn|option|phương án|bình luận\s*:|comment\s*:|soạn\s+(bình luận|bài|câu hỏi|câu|comment|nội dung|mở bài|kết bài)|draft\s*:|\*\*|#+\s)/i;
  const cleanLine=(line)=>String(line||"")
    .replace(/^[-*•\d.)\s]+/,"")
    .replace(/\*\*/g,"")
    .replace(/["""]/g,"")
    .replace(/^(bình luận|comment)\s*:\s*/i,"")
    .replace(/^(soạn\s+(bình luận|bài|câu hỏi|câu|comment|nội dung|mở bài|kết bài)|draft)\s*:?\s*/i,"")
    .trim();
  let text=String(raw||"").replace(/```[a-z]*|```/gi,"").trim();
  let lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  // Lột dòng nháp mở đầu ("Soạn bình luận món đêm", "Draft:", ...). Không lột
  // là cleaner chọn nhầm dòng nháp làm comment (bắt live: đăng lên "Soạn bình
  // luận món đêm" trong khi câu hay nằm dòng sau).
  lines=lines.filter(line=>!META_LINE_RE.test(line) && !/^[-*•]\s*$/.test(line));
  let pickedRaw=lines.find(line=>line.length>=5 && line.length<=300) || lines[0] || text;
  let picked=cleanLine(pickedRaw);
  // Dòng chọn được vẫn là nháp (lọt lưới filter) mà còn dòng khác dài hơn
  // phía sau → lấy dòng dài nhất. Không đụng comment ngắn thật ("Ngon quá!").
  if(/^(soạn|draft)\b/i.test(picked)||!picked){
    const longer=lines.filter(l=>l.length>picked.length&&l.length<=300).sort((a,b)=>b.length-a.length)[0];
    if(longer){pickedRaw=longer;picked=cleanLine(longer);}
  }
  // Neu model van noi dai dong trong cung mot dong, lay phan sau dau hai cham.
  if(/^(dưới đây|gợi ý|lựa chọn|option)/i.test(picked) && picked.includes(":")) picked=picked.split(":").slice(1).join(":").trim();
  if(keepN>1){
    const rest=lines.filter(l=>l!==pickedRaw&&l.length>=5&&l.length<=300&&!META_LINE_RE.test(l));
    for(const l of rest.slice(0,keepN-1)){
      const c=cleanLine(l);
      if(c)picked=(picked+" "+c).trim();
    }
  }
  // Khong de AI ket thuc binh luan bang dau cham than, ke ca bien the full-width.
  picked=guardAiPostText(picked);
  return sanitizePostedText(sliceByCodePoints(picked,keepN>1?500:400)).replace(/[!！]+\s*$/g,"").trimEnd();
}
function strictCommentPrompt(text){
  return `${text}\n\n${t("bg.commentRules")}`;
}
function strictGroupPostPrompt(text,background={}){
  const backgroundRules=backgroundPromptRules(background);
  const plainRule=background&&background.enabled?"":` ${t("bg.postPlainLength")}`;
  return `${text}\n\n${t("bg.postRules")}${backgroundRules}${plainRule} ${t("bg.postOnlyContent")}`;
}
// Neo chủ đề nhóm (đặt ĐẦU prompt vì model nghe đầu hơn cuối): bài phải lộ rõ
// thuộc về đúng nhóm này, chặn kiểu viết chung chung đăng nhóm nào cũng được.
// Dùng cho cả bài nền lẫn bài thường, nick lẫn Page.
function groupTopicAnchorBlock(groupName){
  const name=String(groupName||"").trim().slice(0,180);
  if(!name)return "";
  return t("bg.topicAnchor",{groupName:name});
}
// Xoay góc cưỡng bức: mỗi bài 1 góc mở khác nhau theo vòng, chống rập khuôn
// khi chạy nhiều nhóm liên tiếp (bổ sung cho khối chống lặp nội dung).
const GROUP_POST_ANGLES=[
  "mở bằng một câu hỏi gây tò mò, thân bài trả lời ngắn gọn",
  "mở bằng trải nghiệm cá nhân cụ thể (con số, thời gian, kết quả rõ ràng)",
  "mở bằng một sự kiện hoặc con số nóng hổi liên quan chủ đề nhóm",
  "mở bằng một quan điểm hơi trái chiều rồi lý giải ngắn gọn",
  "mở bằng câu chuyện của người khác rồi rút ra bài học",
];
function groupPostAngleFor(n){
  if(!GROUP_POST_ANGLES.length)return "";
  const i=((parseInt(n)||0)%GROUP_POST_ANGLES.length+GROUP_POST_ANGLES.length)%GROUP_POST_ANGLES.length;
  return GROUP_POST_ANGLES[i];
}
// Lấy góc tiếp theo và tăng bộ đếm (mỗi nhóm 1 góc khác nhau).
// Xoay vị trí tag theo lượt gọi (đầu/giữa/cuối câu 2): AI không nhớ các lượt
// trước nên dặn "khác nhau mỗi bài" trong prompt không có tác dụng — log live
// 7/8 tag nằm inline. Chỉ gắn khi content báo tag (maxLines=2).
async function nextTagPositionLine(){
  try{
    const cs=await chrome.storage.local.get("tagPositionIndex").catch(()=>({}));
    const idx=Math.max(0,parseInt(cs.tagPositionIndex)||0);
    await chrome.storage.local.set({tagPositionIndex:idx+1}).catch(()=>{});
    const modes=[
      "Đặt tên được yêu cầu ở ĐẦU câu 2.",
      "Đặt tên được yêu cầu ở GIỮA câu 2 (sau vài từ đầu).",
      "Đặt tên được yêu cầu ở CUỐI câu 2."
    ];
    return modes[idx%modes.length]+" Chỉ thể hiện qua cách viết, tuyệt đối không nhắc tới yêu cầu này.";
  }catch(_){return "";}
}
async function nextGroupPostAngleLine(){  try{
    const cs=await chrome.storage.local.get("groupPostAngleIndex").catch(()=>({}));
    const idx=Math.max(0,parseInt(cs.groupPostAngleIndex)||0);
    const angle=groupPostAngleFor(idx);
    await chrome.storage.local.set({groupPostAngleIndex:idx+1});
    // Diễn đạt dạng giọng viết trực tiếp + cấm nhắc tới (dạng danh từ "GÓC
    // BÀI NÀY" từng bị Meta echo nguyên văn thành lời tường thuật "Tôi đang
    // viết bài mở bằng góc nhìn..." rồi đăng lên — bắt live Page đăng nhóm).
    if(angle)return `Viết bài này đúng giọng sau (khác hẳn các bài trước; chỉ thể hiện qua cách viết, tuyệt đối không tường thuật hay nhắc tới yêu cầu này): ${angle}.`;
  }catch(_){}
  return "";
}
// Khối chống lặp góc: nhét 2-3 bài vừa đăng gần nhất vào prompt, ép AI đổi
// hẳn mở bài/góc nhìn/câu hỏi. Chạy cùng session Meta rất dễ rập khuôn.
function groupPostAvoidBlock(recent){
  const rows=(Array.isArray(recent)?recent:[]).map(x=>String(x||"").trim()).filter(Boolean).slice(0,3);
  if(!rows.length)return "";
  return t("bg.avoidRecent")+"\n"+rows.map((r,i)=>`${i+1}. ${r.slice(0,200)}`).join("\n");
}
// Lột chữ nháp AI để lọt vào đầu bài ("Soạn bài X:", "Dàn ý:", hoặc dính liền
// "Soạn bài X Soạn câu hỏi Y NỘI DUNG"). Chạy lặp vì AI xếp nhiều nhãn liên
// tiếp. Chỉ lột ở ĐẦU, không đụng nội dung thật ở giữa/cuối. Trường hợp dính
// liền: chỉ lột khi phần còn lại dài và mở đầu bằng chữ hoa/số (chắc chắn là
// nội dung), không thì giữ nguyên để lớp validation bỏ qua nhóm (fail-closed).
function stripAiScaffolding(text){
  let s=String(text||"");
  const label=/^(?:bài đăng|bài viết|nội dung|gợi ý|gợi ý bài|post|content|draft|nháp|title|tiêu đề|mở bài|kết bài|câu hỏi|question|soạn bài|soạn câu hỏi|dàn ý|outline|caption|chú thích|rút gọn|tóm tắt|viết lại|mở rộng|bổ sung|chỉnh sửa|kết quả|bản rút gọn|bản tóm tắt|bản viết lại)\s*[:：\-–—]\s*/i;
  for(let i=0;i<5&&label.test(s);i++)s=s.replace(label,"");
  // Header hành động Meta echo khi nén/viết lại ("Rút gọn câu chuyện ...",
  // "Tóm tắt bài viết ...") — dính liền bằng khoảng trắng, không hai chấm,
  // không xuống dòng. Chỉ lột khi cụm đầu ngắn, phần còn lại dài và mở đầu
  // Hoa/số (chắc chắn là nội dung thật), nếu không giữ nguyên để fail-closed.
  for(let i=0;i<2;i++){
    const m=s.match(/^(rút gọn|tóm tắt|viết lại|nén(?: gọn)?|mở rộng|bổ sung|chỉnh sửa|soạn lại)\s+(câu chuyện|bài viết|bài đăng|nội dung|đoạn văn|bản thảo|bản tóm tắt|bản rút gọn|dàn ý)\b\s*/i);
    if(!m)break;
    const rest=s.slice(m[0].length).trim();
    if(rest.length>=40&&/^[\p{Lu}0-9]/u.test(rest))s=rest;
    else break;
  }
  // Dính liền "Soạn bài X Soạn câu hỏi Y NỘI DUNG": lột cụm mở đầu thường cho tới
  // trước token Hoa/số đầu tiên (dùng \p{Lu}/\p{Ll} cho đúng chữ Việt, vì range
  // à-ỹ lẫn cả hoa lẫn thường). Chỉ lột khi phần còn lại dài và mở đầu Hoa/số.
  for(let i=0;i<3;i++){
    const h=s.match(/^(soạn (?:bài|câu hỏi)\s+)/i);
    if(!h)break;
    let rest=s.slice(h[1].length);
    const tail=(rest.match(/^([\p{Ll}0-9\s,.()]{0,80}?)(?=[\p{Lu}0-9]|$)/u)||[])[1];
    if(tail===undefined)break;
    rest=rest.slice(tail.length).trim();
    if(rest.length>=20&&/^[\p{Lu}0-9]/u.test(rest))s=rest;
    else break;
  }
  // Rớt câu mở đầu mà toàn bộ chỉ là chữ nháp (không còn nội dung gì khác).
  for(let i=0;i<2;i++){
    const m=s.match(/^[^.!?…。！？]+[.!?…。！？]+/);
    if(!m)break;
    if(/soạn (bài|câu hỏi|nội dung|mở bài|kết bài|dàn ý)|dàn ý\s*:/i.test(m[0])){
      const cleaned=m[0].replace(/soạn (?:bài|câu hỏi|nội dung|mở bài|kết bài|dàn ý)[^.!?…]*/gi,"").trim();
      if(cleaned.length<15)s=s.slice(m[0].length).trim();
      else break;
    }
    else break;
  }
  // Header nháp "Soạn <gì đó>" đứng một dòng riêng ở đầu bài (VD Meta echo
  // yêu cầu xoay góc thành "Soạn góc nhìn trái chiều"). Chỉ lột khi dòng đầu
  // ngắn, không có dấu kết câu, và phần còn lại đủ dài. Câu thật mở đầu bằng
  // "Soạn" nhưng có dấu kết câu (VD: "Soạn xong rồi, giờ đi chơi.") giữ nguyên.
  for(let i=0;i<2;i++){
    const m=s.match(/^soạn\b([^.!?…\n]{0,120})\n([\s\S]+)$/i);
    if(!m)break;
    if(m[2].trim().length>=20)s=m[2].trim();
    else break;
  }
  return s.trim();
}
// Meta có thể trả kèm các dòng giao diện/thinking chip vào innerText của câu
// trả lời dù người dùng nhìn trên tab thấy chúng là UI riêng. Chỉ lột ở vài
// dòng đầu để không đụng nội dung thật giữa bài.
const AI_META_UI_LINE_RE=/^\s*(?:hiển thị|ẩn)\s+suy nghĩ|^\s*(?:show|hide)\s+thinking|^\s*(?:drafting|reasoning|analyzing|thinking|searching|working)(?:\s|$)|^\s*(?:đang\s+)?(?:suy nghĩ|soạn thảo|phân tích|tìm kiếm|đang viết)(?:\s|$)|^\s*(?:đã\s+)?suy nghĩ\s+(?:trong|for)\s+\d+\s*(?:giây|seconds?|s)?|^\s*thought\s+for\s+\d+/i;
function stripAiMetaUi(text){
  return String(text||"").split(/\r?\n/).filter((line,index)=>index>3||!AI_META_UI_LINE_RE.test(line.trim())).join("\n").trim();
}
// Lột lời dẫn/lời kết của AI, nhưng chỉ những mẫu chắc chắn là lời dẫn chứ
// không cắt câu nội dung bình thường của người dùng.
function stripAiEnvelope(text){
  let value=String(text||"").trim();
  for(let i=0;i<3;i++){
    const before=value;
    value=value
      .replace(/^\s*(?:chắc chắn rồi|tất nhiên|được thôi|sure|of course)[!,.：:\s]+/i,"")
      .replace(/^\s*(?:dưới đây là|sau đây là|đây là)\s+(?:một\s+)?(?:bài đăng|bài viết|nội dung|caption|post)(?:\s+[^:\n]{0,120})?\s*[:：-]\s*/i,"");
    if(value===before)break;
  }
  // Không để lời nhắn của trợ lý sau bài lọt lên Facebook.
  value=value.replace(/\n+\s*(?:hy vọng (?:bài|nội dung) này|nếu bạn muốn (?:chỉnh|sửa|thay đổi)|hãy cho tôi biết nếu|tôi có thể chỉnh sửa)[\s\S]*$/i,"").trim();
  return value;
}
function hasAiPostLeak(text){
  const value=String(text||"");
  if(AI_META_UI_LINE_RE.test(value))return true;
  if(/(^|\n)\s*(?:soạn\s+(?:bài|câu hỏi|nội dung)|draft(?:ing)?|reasoning|analyzing|hiển thị suy nghĩ|show thinking)\s*[:：-]?/i.test(value))return true;
  // Header hành động còn sót ("Rút gọn câu chuyện", "Tóm tắt bài viết", ...),
  // kể cả dạng dính liền không hai chấm. Câu thật không mở đầu bằng các cụm này.
  if(/(^|\n)\s*(?:rút gọn|tóm tắt|viết lại|mở rộng|bổ sung|chỉnh sửa)\s+(?:câu chuyện|bài viết|bài đăng|nội dung|đoạn văn|bản thảo|bản tóm tắt|bản rút gọn|dàn ý)\b/i.test(value))return true;
  if(/(^|\n)\s*(?:hỏi|đáp|question|answer|q|a)\s*[:：]/i.test(value))return true;
  if(/(^|\n)\s*(?:dưới đây là|sau đây là|chắc chắn rồi|tất nhiên)[^\n]{0,160}[:：]/i.test(value))return true;
  if(/(^|\n)\s*(?:hy vọng (?:bài|nội dung) này|nếu bạn muốn (?:chỉnh|sửa|thay đổi)|hãy cho tôi biết nếu|tôi có thể chỉnh sửa)/i.test(value))return true;
  // Header nháp "Soạn ..." còn sót ở đầu dòng mà không có dấu kết câu (VD:
  // "Soạn góc nhìn trái chiều"). Câu hỏi/thật có dấu ?!. ở cuối dòng không dính.
  if(/(^|\n)\s*soạn\b[^.!?…\n]{0,100}\s*(\n|$)/i.test(value))return true;
  // Meta đôi khi không viết bài mà phản hồi về chính prompt (VD: "Prompt
  // dài không hay đâu... bạn hay viết kiểu nào?"). Đây là câu trao đổi với
  // người dùng, không phải nội dung Facebook — phải chặn dù không có nhãn Draft.
  // NHƯNG "prompt" cũng là vốn từ vựng bình thường trong bài về AI ("một
  // prompt ra 10 bài" — bắt live sales 10/10: 4 nhóm skip oan liên tiếp) nên
  // chỉ chặn khi đi kèm câu hỏi/hướng dẫn user về cách viết ("bạn ... viết
  // ... kiểu nào", "bạn muốn prompt ..."). Cụm "giới hạn cứng..." luôn chặn.
  if(/(^|[\s\n])prompt(?:\s|$)/i.test(value)
    && /(?:bạn\s+(?:muốn|hay)?\s*(?:viết|làm|dùng|chạy|prompt)|(?:viết|làm)\s+[^\n]{0,60}kiểu nào)/i.test(value))return true;
  if(/giới hạn cứng|bỏ qua mọi yêu cầu|chỉ giữ lại chủ đề/i.test(value))return true;
  if(/(?:bạn muốn|bạn hay)\s+(?:tôi|mình|viết|làm|kiểu nào)|(?:tôi|mình)\s+(?:có thể|sẽ)\s+(?:viết|chỉnh|làm)/i.test(value)&&/(?:viết|bài|nội dung|ai|prompt)/i.test(value))return true;
  // Meta tường thuật việc đang soạn bài ở ngôi thứ nhất ("Tôi đang viết bài
  // mở bằng góc nhìn trái chiều..., rồi đặt câu hỏi..." — bắt live Page đăng
  // nhóm: lên sóng nguyên văn + cắt cụt). Bài thật không bao giờ tường thuật
  // cơ chế soạn của chính nó, nên yêu cầu ĐỒNG THỜI khung tự thuật (đang/sẽ +
  // viết/soạn/mở + bài) và từ vựng góc máy (góc nhìn/góc mở/mở bài/theo yêu
  // cầu/đặt câu hỏi để...) để không nuốt câu thật ("mình đang viết dở bài").
  if(/(?:tôi|mình|em|anh|chị|tớ|mình)\s+(?:đang|sẽ)\s+(?:viết|soạn|mở|trình bày)\s+(?:bài|đoạn|phần)/i.test(value)
    &&/(góc nhìn|góc mở|mở bài|mở đầu bằng|theo yêu cầu|đặt câu hỏi để|luân phiên|xoay góc|biến thể|dưới đây là|sau đây là)/i.test(value))return true;
  if(/(?:^|[\s\n])(?:i am|i'm|i will)\s+(?:writing|drafting|opening|composing)\s+(?:this|the|my)\s+(?:post|article|piece)/i.test(value))return true;
  return false;
}
// Gate bắt buộc cho mọi nội dung AI chuẩn bị đưa lên Facebook. Nếu còn dấu
// hiệu câu lệnh/UI/lời giải thích của AI sau khi làm sạch thì dừng fail-closed;
// tuyệt đối không cố đăng một bài chưa xác minh.
function guardAiPostText(raw){
  let value=stripAiMetaUi(sanitizePostedText(String(raw||"")))
    .replace(/```[a-z]*|```/gi,"")
    .replace(/\*\*/g,"")
    .trim();
  value=stripAiScaffolding(value);
  value=stripAiEnvelope(value);
  value=stripAiMetaUi(value);
  value=sanitizePostedText(value).trim();
  if(!value||hasAiPostLeak(value)){
    const error=new Error(t("bg.aiContentGuard"));
    error.aiEmpty=true;
    error.code="AI_EMPTY";
    try{ error.rawSample=String(raw||"").slice(0,220); }catch(_){}
    throw error;
  }
  return value;
}
function newsWordSet(value){
  return new Set(String(value||"").toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g,"").match(/[a-z0-9À-ỹĐđ]{2,}/gi)||[]);
}
function newsLooksVietnamese(value){
  const text=String(value||"").trim();
  if(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text))return true;
  return /\b(?:mình|tôi|bạn|anh|chị|em|này|được|với|cho|nhưng|vì|nên|thấy|rằng|theo|đang|sẽ|có|không|một|những|và|là|của|trong|sau|trước|hôm)\b/i.test(text);
}
async function validateNewsRewriteContent(value,sourceText){
  const text=String(value||"").trim();
  const lang=String(await postLanguageSetting()).trim().toLocaleLowerCase("vi");
  if(/tiếng\s*việt|vietnamese/.test(lang)&&!newsLooksVietnamese(text)){
    const e=new Error(t("bg.aiWrongLanguage"));e.aiEmpty=true;e.code="AI_WRONG_LANGUAGE";throw e;
  }
  const sourceWords=newsWordSet(sourceText),outWords=newsWordSet(text);
  if(sourceWords.size>=10&&outWords.size>=8){
    let overlap=0;for(const word of outWords)if(sourceWords.has(word))overlap++;
    const ratio=overlap/Math.max(1,Math.min(sourceWords.size,outWords.size));
    const sourceLower=String(sourceText||"").toLocaleLowerCase("vi").replace(/\s+/g," ").trim();
    const outLower=text.toLocaleLowerCase("vi").replace(/\s+/g," ").trim();
    if(ratio>=0.86&&(sourceLower.includes(outLower)||outLower.includes(sourceLower)||text.length<=String(sourceText||"").length*1.35)){
      const e=new Error(t("bg.aiUnrewritten"));e.aiEmpty=true;e.code="AI_UNREWRITTEN";throw e;
    }
  }
  return text;
}
// Bài còn sót chữ nháp sau mọi vòng lọc → cấm đăng (fail-closed từng nhóm).
// Chỉ bắt "Soạn" hoa (đầu bài/đầu câu — dạng nháp AI nhả ra), tránh nuốt câu
// thật kiểu "mình soạn bài thuyết trình" (soạn thường giữa câu).
function groupPostHasScaffolding(text){
  const t=String(text||"");
  if(/Soạn (bài|câu hỏi|nội dung|mở bài|kết bài|dàn ý)/.test(t.slice(0,60)))return true;
  if(/(^|\n)\s*Soạn\b[^.!?…\n]{0,100}\s*(\n|$)/.test(t))return true;
  if(/(^|[.!?…]\s+|\n)\s*Soạn (bài|câu hỏi)/.test(t))return true;
  if(/(dàn ý|draft|nháp)\s*:/i.test(t))return true;
  // Header hành động Meta echo khi nén/viết lại còn sót ("Rút gọn câu chuyện",
  // "Tóm tắt bài viết", ...). Câu thật không mở đầu bằng các cụm này.
  if(/(^|\n)\s*(?:rút gọn|tóm tắt|viết lại|mở rộng|bổ sung|chỉnh sửa)\s+(?:câu chuyện|bài viết|bài đăng|nội dung|đoạn văn|bản thảo|bản tóm tắt|bản rút gọn|dàn ý)\b/i.test(t))return true;
  if(/^[QqAa]\s*:\s*\S/m.test(t))return true;
  return false;
}
function fitGroupPostToBackground(text,maxChars){  const max=normalizeBackgroundMaxChars(maxChars);
  let value=sanitizePostedText(text).replace(/\s+/g," ").trim();
  if([...value].length<=max)return value;
  // Emergency fallback only. AI repair normally runs before this path, so
  // prefer a complete sentence/clause instead of cutting the middle of one.
  const sentenceParts=value.match(/[^.!?。！？]+[.!?。！？]+/g)||[];
  let complete="";
  for(const part of sentenceParts){
    const candidate=`${complete}${part}`.trim();
    if([...candidate].length>max)break;
    complete=candidate;
  }
  if(complete)return complete;
  // Không có câu trọn nào vừa (bài toàn dấu phẩy): cắt ở ranh giới mệnh đề
  // gần nhất để không treo lơ lửng giữa chừng ("...để mọi" — bắt live Page
  // đăng nhóm). Dấu phẩy cuối được giữ (vẫn là câu đầy đặn hơn cụt từ).
  const clauseParts=value.match(/[^,;:—–\-!?。！？]+[,;:—–\-!?。！？]+/g)||[];
  let cut="";
  for(const part of clauseParts){
    const candidate=`${cut}${part}`.trim();
    if([...candidate].length>max)break;
    cut=candidate;
  }
  if(cut)return cut;
  const keepQuestion=/\?\s*$/.test(value),room=Math.max(1,max-(keepQuestion?1:0));
  let shortened=sliceByCodePoints(value,room).replace(/\s+\S*$/,"").replace(/[,:;.!?…\-]+\s*$/g,"").trim();
  if(!shortened)shortened=sliceByCodePoints(value,room).trim();
  shortened=sanitizePostedText(shortened);
  return sliceByCodePoints(`${shortened}${keepQuestion?"?":""}`,max).trim();
}
function cleanGroupPost(raw,background={}){
  let content=guardAiPostText(raw).replace(/```[a-z]*|```/gi,"").split(/\r?\n/)
    .map(s=>s.trim()).filter(s=>s&&!/^(hỏi|đáp|q|a)\s*:/i.test(s)&&!/^\*\*(hỏi|đáp|q|a)/i.test(s))
    .join(background.enabled?" ":"\n").replace(/\*\*/g,"").trim();
  content=stripAiScaffolding(content);
  if(background.enabled){
    content=content.replace(/https?:\/\/\S+/gi,"").replace(/(^|\s)#[\p{L}\p{N}_-]+/gu," ").replace(/\s+/g," ").trim();
    return sanitizePostedText(content);
  }
  // Như sales: model đôi khi trả về một khối duy nhất. Cưỡng chế xuống dòng
  // theo câu khi bài dài mà không có \n nào — nếu không, bài đăng dài luôn
  // thành một khối đặc dù khâu gõ đã hỗ trợ ngắt dòng đầy đủ.
  if(!content.includes("\n")&&[...content].length>180){
    const sentences=content.split(/(?<=[.!?…])\s+/).map(s=>s.trim()).filter(Boolean);
    if(sentences.length>1){
      const paras=[];let cur="";
      for(const s of sentences){
        const add=(cur?cur.length+1:0)+[...s].length;
        if(cur&&([...cur].length>=140||add>220)){paras.push(cur);cur=s;}
        else cur=cur?cur+" "+s:s;
      }
      if(cur)paras.push(cur);
      if(paras.length>1)content=paras.join("\n\n");
    }
  }
  // Bài thường (không nền): GIỮ NGUYÊN độ dài đầy đủ, không cắt ngắn —
  // Facebook cho đăng bài dài, cắt chỉ làm mất ý. Chỉ chuẩn hoá cấu trúc đoạn.
  return sanitizePostedText(content);
}
function strictSalesPostPrompt(text,groupName,sourceText,productInfo,variant){
  const hasFooter=String(productInfo||"").trim().includes("\n");
  const footerNote=hasFooter?"\nLƯU Ý: GHI CHÚ SẢN PHẨM có nhiều dòng (thông tin liên hệ/địa chỉ). Hệ thống tự gắn phần đó vào cuối bài nguyên văn — KHÔNG đưa thông tin liên hệ vào bài viết của bạn, chỉ viết phần nội dung giới thiệu/câu chuyện.":"";
  return String(text||"")+"\n\nBỐI CẢNH: Nhóm đích là \""+String(groupName||"").slice(0,180)+"\"; đây là biến thể số "+Math.max(1,parseInt(variant)||1)+".\nTHÔNG TIN GỐC: "+String(sourceText||"").slice(0,3500)+"\nGHI CHÚ SẢN PHẨM: "+String(productInfo||"").slice(0,1800)+footerNote+"\nYÊU CẦU AN TOÀN: Chỉ dùng dữ kiện xuất hiện trong thông tin gốc và ghi chú; không tự bịa giá, tình trạng, bảo hành, địa điểm, công dụng hay cam kết. Không mạo danh, không khẳng định chắc chắn điều chưa có nguồn. Viết tự nhiên như một người đang hỏi ý kiến để bán/định giá sản phẩm, không giật tít, không spam, không lặp nguyên văn giữa các biến thể, không hashtag, không URL, không Markdown, không nhãn Hỏi/Đáp, không lời giải thích của AI.\nTRÌNH BÀY: Viết thành nhiều đoạn ngắn (mỗi đoạn 1–2 câu, mỗi ý chính một đoạn), các đoạn cách nhau bằng một dòng trống; không dồn toàn bộ bài thành một khối văn bản duy nhất. Chỉ trả về duy nhất nội dung bài đăng bằng tiếng Việt.";
}
function compactSalesChat(messages=[]){
  const rows=(Array.isArray(messages)?messages:[]).slice(-12).map(item=>({
    role:item?.role==="assistant"?"assistant":"user",
    content:String(item?.content||"").replace(/\s+/g," ").trim().slice(0,1200)
  })).filter(item=>item.content);
  let used=0;
  return rows.reverse().filter(item=>{used+=item.content.length;return used<=6000;}).reverse();
}
function strictSalesChatPrompt(template,sourceText,productInfo,messages=[]){
  const conversation=compactSalesChat(messages).map(item=>`${item.role==="assistant"?"AI":"Người dùng"}: ${item.content}`).join("\n");
  return `${String(template||"")}\n\nTHÔNG TIN SẢN PHẨM: ${String(sourceText||"").slice(0,5000)}\nGHI CHÚ BỔ SUNG: ${String(productInfo||"").slice(0,2200)}\n${conversation?`CUỘC TRAO ĐỔI GẦN NHẤT:\n${conversation}\n`:""}YÊU CẦU CHAT: Hãy áp dụng yêu cầu mới nhất của người dùng để viết lại bài đăng bán hàng. Chỉ trả về duy nhất một phương án bài đăng hoàn chỉnh bằng tiếng Việt, dài 2-4 câu, tự nhiên như người thật vừa bán hàng vừa hỏi ý kiến. Chỉ dùng dữ kiện đã cung cấp; không bịa giá/thông số/tình trạng, không URL, hashtag, Markdown, nhãn Hỏi/Đáp, lời giải thích hay danh sách nhiều phương án.`;
}
function extractSalesFooter(productInfo){
  // Extract contact/footer section from productInfo, stop at AI-instruction sections.
  // Uses toLocaleLowerCase("vi") instead of regex /i to correctly fold Vietnamese chars.
  const lines=String(productInfo||"").split("\n").map(l=>l.trim()).filter(Boolean);
  const CONTACT=["liên hệ","zalo","facebook","fb:","điện thoại","sđt","hotline","địa chỉ","address","email","shopee","lazada","inbox","fanpage"];
  const STOP=["nguyên tắc","quy tắc","lưu ý quan trọng","ghi chú quan trọng"];
  const lo=l=>l.toLocaleLowerCase("vi");
  const isContact=l=>{const s=lo(l);return CONTACT.some(k=>s.startsWith(k));};
  const isStop=l=>{const s=lo(l);return STOP.some(k=>s.startsWith(k));};
  const start=lines.findIndex(isContact);
  if(start===-1)return"";
  const footer=[];
  for(let i=start;i<lines.length;i++){if(isStop(lines[i]))break;footer.push(lines[i]);}
  return footer.join("\n");
}
function cleanSalesPost(raw){
  // Giữ nguyên cấu trúc đoạn của AI: dòng trống = ngắt đoạn (\n\n),
  // xuống dòng đơn trong đoạn được giữ lại. (Bản cũ gộp mọi dòng bằng
  // một \n nên vô tình xóa khoảng cách đoạn của AI.)
  let text=guardAiPostText(raw).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"");
  const paras=[];let cur=[];
  for(const line of text.split(/\r?\n/)){
    const t=line.replace(/[^\S\n]+/g," ").trim();
    if(t)cur.push(t);
    else if(cur.length){paras.push(cur);cur=[];}
  }
  if(cur.length)paras.push(cur);
  text=paras.map(p=>p.join("\n")).join("\n\n");
  text=text.replace(/^(?:bài đăng|nội dung|tiêu đề|gợi ý)\s*:\s*/i,"").replace(/^["""]+|["""]+$/g,"").replace(/(^|\s)#[\p{L}\p{N}_-]+/gu," ").replace(/https?:\/\/\S+/gi," ").replace(/[^\S\n]+/g," ").replace(/^ +| +$/gm,"").replace(/^\s*\n/gm,"").replace(/\n{3,}/g,"\n\n").trim();
  // Model đôi khi trả về một khối duy nhất dù prompt yêu cầu nhiều đoạn.
  // Cưỡng chế xuống dòng theo câu (deterministic): chỉ khi không có \n nào
  // và bài đủ dài; gom 1–2 câu (~140–220 ký tự) thành một đoạn.
  if(!text.includes("\n")&&[...text].length>180){
    const sentences=text.split(/(?<=[.!?…])\s+/).map(s=>s.trim()).filter(Boolean);
    if(sentences.length>1){
      const paras=[];let cur="";
      for(const s of sentences){
        const add=(cur?cur.length+1:0)+[...s].length;
        if(cur&&([...cur].length>=140||add>220)){paras.push(cur);cur=s;}
        else cur=cur?cur+" "+s:s;
      }
      if(cur)paras.push(cur);
      if(paras.length>1)text=paras.join("\n\n");
    }
  }
  if([...text].length>900)text=truncateAtSentence(text,900);
  return sanitizePostedText(text);
}
// Học bài nhóm (trend): đọc bài đã cào từ nhóm nguồn, rút dàn ý rồi viết
// thành bài của mình cho nhóm đích. Không sao chép nguyên văn/giả mạo.
function strictTrendRewritePrompt(template,sourceText,groupName,variant,background={}){
  const sentenceRule=background?.enabled
    ?" Với bài đăng nền màu, chỉ viết 1-2 câu hoàn chỉnh; ưu tiên chủ đề và một ý chính rõ ràng, chỉ thêm câu hỏi khi còn đủ chỗ."
    :" Viết 2-5 câu tự nhiên.";
  return String(template||"")
    +"\n\nBỐI CẢNH: Nhóm đích là \""+String(groupName||"").slice(0,180)+"\"; đây là biến thể số "+Math.max(1,parseInt(variant)||1)+"."
    +"\nBÀI ĐÃ HỌC TỪ NHÓM NGUỒN:\n"+String(sourceText||"").slice(0,6000)
    +"\nYÊU CẦU AN TOÀN: Đọc các bài trên để nắm dàn ý, góc nhìn và điểm được quan tâm, sau đó viết thành bài của chính mình theo dàn ý đó. Không sao chép nguyên văn câu nào, không bịa tên/người/giá/số liệu, không mạo danh tác giả, không giật tít, không spam, không lặp nguyên văn giữa các biến thể, không hashtag, không URL, không Markdown, không lời giải thích của AI. Chỉ trả về duy nhất nội dung bài đăng bằng tiếng Việt."+sentenceRule;
}
function cleanTrendPost(raw){
  let text=guardAiPostText(raw).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join("\n");
  text=text.replace(/^(?:dàn ý|outline|bài đăng|nội dung|gợi ý)\s*:\s*/i,"").replace(/^["""]+|["""]+$/g,"").replace(/(^|\s)#[\p{L}\p{N}_-]+/gu," ").replace(/https?:\/\/\S+/gi," ").replace(/[^\S\n]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
  if([...text].length>1200)text=truncateAtSentence(text,1200);
  return sanitizePostedText(text);
  return sanitizePostedText(text);
}
function imageDataParts(dataUrl){
  const m=String(dataUrl||"").match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if(!m)return null;
  return {mime:m[1],data:m[2].replace(/\s+/g,"")};
}
async function callConfiguredText(provider,key,model,customUrl,postText,prompt,maxTokensOverride=null,metaFeature="",imageDataUrl=""){
  // Nhánh miễn phí: hỏi qua tab meta.ai, không đụng đường API trả phí bên dưới.
  // meta.ai không đọc ảnh → báo rõ thay vì viết mù khi caller cần vision.
  if(provider==="meta-free"){
    if(imageDataUrl)throw new Error(t("bg.visionNeeded"));
    return callMetaFreeText(String(prompt||postText||""),metaFeature||"");
  }
  if(provider==="gemini")return callGemini(key,model||AI_DEFAULTS.gemini.model,postText,prompt,false,maxTokensOverride,imageDataUrl);
  if(provider==="claude"||provider==="Muse")return callClaude(key,model,postText,prompt,false,maxTokensOverride,imageDataUrl);
  const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;
  return callOpenAICompatible(key,customUrl||def.url,model||def.model,postText,prompt,false,maxTokensOverride,imageDataUrl);
}
// ===== META AI FREE (provider "meta-free") =====
// Hỏi đáp qua tab meta.ai đã login (content script metaai.js). Chỉ thêm mới,
// không thay đổi bất kỳ đường gọi API trả phí nào ở trên.
// Hàng đợi FIFO trong SW: meta.ai xử lý tuần tự từng việc (1 tab làm 1 việc).
// Hỏi và dọn dùng chung hàng đợi để không giằng tab worker lẫn nhau.
let metaFreeChain=Promise.resolve();
function metaFreeEnqueue(fn){
  metaFreeChain=metaFreeChain.catch(()=>{}).then(fn);
  return metaFreeChain;
}
// Ngân sách tối đa cho MỘT lượt hỏi (phải nhỏ hơn race 150s phía feed để SW
// luôn kịp trả verdict chi tiết, không bao giờ để feed timeout mù).
const META_ASK_DEADLINE_MS=140000;
let metaFreeSeq=0;
function callMetaFreeText(prompt,feature){
  const job=String(prompt||"").trim();
  const feat=String(feature||"meta").slice(0,40)||"meta";
  return metaFreeEnqueue(()=>metaFreeAskOnce(job,feat));
}
// Ghép prompt đầy đủ cho Meta khi caller truyền postText/prompt rời nhau
// (luồng comment legacy). Prompt đã nhúng sẵn bài thì giữ nguyên.
function buildMetaFreePrompt(postText,promptTemplate){
  const tpl=String(promptTemplate||"").trim();
  const post=String(postText||"").replace(/\s+/g," ").trim();
  if(!tpl)return post;
  if(/\{(postText|post|bài viết)\}/i.test(tpl))return tpl.replace(/\{(postText|post|bài viết)\}/gi,post);
  if(post&&post.length>30&&tpl.includes(post.slice(0,60)))return tpl;
  return post?`${tpl}\n\nBài viết:\n${post}`:tpl;
}
// Lột dòng "Hiển thị suy nghĩ" của Meta (phòng khi content script sót).
// Build mới thêm chip "Drafting/Reasoning/Analyzing..." đầu câu trả lời.
// Lưu ý: KHÔNG dùng \b — dấu tiếng Việt là non-word với regex JS thường nên
// \b không bao giờ khớp cuối từ tiếng Việt.
function metaFreeStripThinking(text){
  return String(text||"").split(/\r?\n/).filter((line,i)=>{
    if(i>2)return true;
    return !/^\s*(hiển thị suy nghĩ|show thinking|đang suy nghĩ|thinking|drafting|reasoning|analyzing|đang soạn|đang nghĩ)(\s|$)/i.test(line);
  }).join("\n").trim();
}
// Bóc mảng JSON từ câu trả lời Meta (hay kèm lời dẫn trước/sau mảng).
// Quét khối [...] cân ngoặc đầu tiên rồi parse; không thì null để caller fallback.
function metaFreeExtractJsonArray(raw){
  const text=String(raw||"").replace(/```json|```/gi,"");
  const start=text.indexOf("[");
  if(start<0)return null;
  let depth=0,inStr=false,esc=false;
  for(let i=start;i<text.length;i++){
    const ch=text[i];
    if(inStr){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch==='"')inStr=false;continue;}
    if(ch==='"')inStr=true;
    else if(ch==="[")depth++;
    else if(ch==="]"){depth--;if(depth===0){try{const v=JSON.parse(text.slice(start,i+1));return Array.isArray(v)?v:null;}catch(_){return null;}}}
  }
  return null;
}
// Bóc object JSON từ câu trả lời Meta (hay kèm lời dẫn trước/sau).
function metaFreeExtractJsonObject(raw){
  const text=String(raw||"").replace(/```json|```/gi,"");
  const start=text.indexOf("{");
  if(start<0)return null;
  let depth=0,inStr=false,esc=false;
  for(let i=start;i<text.length;i++){
    const ch=text[i];
    if(inStr){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch==='"')inStr=false;continue;}
    if(ch==='"')inStr=true;
    else if(ch==="{")depth++;
    else if(ch==="}"){depth--;if(depth===0)return text.slice(start,i+1);}
  }
  return null;
}
// Prompt trung tính cho Meta khi trả lời câu hỏi nhóm: hỏi-đáp thẳng, không
// yêu cầu bịa thông tin cá nhân (Meta từ chối kiểu đó). Prompt tay của user
// (khác prompt mặc định) vẫn được tôn trọng.
function metaFreeJoinBase(msgPrompt,defaultPrompt,metaDefault){
  const custom=String(msgPrompt||"").trim();
  if(custom&&custom!==String(defaultPrompt||"").trim())return msgPrompt;
  return metaDefault;
}
// Dọn output của JSON tree-viewer Meta: nhãn tab (JSON/Tree/Raw), nút mở
// "▶", node gộp ("5 keys"/"0 items" — nội dung gộp coi như mất), và xuống dòng
// thô nằm TRONG string (pretty-print của viewer, JSON.parse không chịu).
// asArray=true thì bóc khối [...] thay vì {...}.
function metaFreeCleanJsonViewer(raw,asArray){
  const text=String(raw||"");
  const s=asArray?text.indexOf("["):text.indexOf("{");
  const e=asArray?text.lastIndexOf("]"):text.lastIndexOf("}");
  if(s<0||e<=s)return "";
  const lines=text.slice(s,e+1).split(/\r?\n/).filter(line=>{
    const t=line.trim();
    return t!=="▶"&&!/^\d+\s+(keys|items)$/.test(t);
  });
  // UI viewer đôi khi dính expander/cụm gộp ngay trong dòng (không xuống dòng
  // riêng) — lột nốt ở cấp ký tự (bài tiếng Việt thực tế không chứa các token này).
  const joined=lines.join("\n").replace(/▶/g,"").replace(/\b\d+\s+(keys|items)\b/g,"");
  let out="",inStr=false,esc=false;
  for(const ch of joined){
    if(inStr){
      if(esc)esc=false;
      else if(ch==="\\")esc=true;
      else if(ch==='"')inStr=false;
      else if(ch==="\n"){out+="\\n";continue;}
      else if(ch==="\r"){continue;}
      else if(ch==="\t"){out+="\\t";continue;}
      out+=ch;continue;
    }
    if(ch==='"')inStr=true;
    out+=ch;
  }
  return out.replace(/\[\s*(,\s*)+/g,"[").replace(/(,\s*)+\s*\]/g,"]").replace(/{\s*(,\s*)+/g,"{").replace(/(,\s*)+\s*}/g,"}");
}
// Nhận diện câu từ chối bịa thông tin để join nhóm.
// Phải có CẢ chủ đề gian dối (giả mạo/che giấu/...) cùng thái độ từ chối thì
// mới tính — câu thật kiểu "Em không thể đến offline được" không dính.
function metaFreeIsRefusal(text){
  const t=String(text||"").trim();
  if(!/giả mạo|giả làm|giả danh|che giấu|lừa dối/i.test(t))return false;
  return /không thể|rất tiếc|xin lỗi|từ chối|không giúp|i'm sorry|i can/i.test(t);
}
// Nhận diện đáp án AI TỪ CHỐI / lộ thân phận AI cho luồng xin vào nhóm — áp
// cho MỌI provider (2.11.8), cộng thêm lớp metaFreeIsRefusal ở trên. Đem đáp
// án từ chối điền vào form thì hại hơn không điền -> handler ném lỗi để nơi
// gọi rơi xuống luồng dự phòng (tự tính toán + câu mẫu). Mẫu bắt thận trọng
// để không bắt nhầm câu thật: "I can't wait to join" không dính (nhánh EN
// đòi động từ help/answer/provide đi kèm), "không thể đến offline" không
// dính (nhánh VI đòi giúp/trả lời/cung cấp/hỗ trợ đi kèm).
function aiJoinIsRefusal(text){
  const a=String(text||"").trim();
  if(!a)return false;
  if(metaFreeIsRefusal(a))return true;
  if(/as an ai\b|as a language model|i'?m an ai\b|i am an ai\b/i.test(a))return true;
  if(/(?:tôi|mình) là (?:một )?(?:ai|trí tuệ nhân tạo|mô hình ngôn ngữ|trợ lý ảo)\b/i.test(a))return true;
  if(/^(?:i'?m sorry|sorry|xin lỗi|rất tiếc|thật tiếc)\b[^]{0,60}?\b(?:cannot|can'?t|unable|không thể)\b/i.test(a))return true;
  if(/\b(?:i cannot|i can'?t|i am unable|i'?m unable)\s+(?:help|answer|provide|assist|do that)\b/i.test(a))return true;
  if(/\b(?:tôi|mình) không thể (?:giúp|trả lời|cung cấp|hỗ trợ)\b/i.test(a))return true;
  return false;
}
// Nhận diện tường login meta.ai từ text trang (để báo user login 1 lần).
function metaFreeIsLoginWall(bodyText){
  const txt=String(bodyText||"").slice(0,2000);
  if(/hỏi meta ai|composer-input/i.test(txt))return false;
  return /log in|đăng nhập/i.test(txt);
}
function metaFreeTabAlive(tabId){
  return new Promise(resolve=>{
    if(!Number(tabId))return resolve(null);
    chrome.tabs.get(Number(tabId),tab=>{
      if(chrome.runtime.lastError||!tab)return resolve(null);
      const url=String(tab.url||"");
      if(!/\.meta\.ai\//.test(url))return resolve(null);
      resolve(tab);
    });
  });
}
// Tab worker meta.ai được bật tạm ~2-3s cho React mount composer rồi trả lại
// tab user đang xem (build Meta mới chỉ mount contenteditable khi tab hiển
// thị). metaFreePrevActiveTab giữ tab cần trả focus; alarm 8s là lưới an toàn.
let metaFreePrevActiveTab=null;
async function metaFreeRestoreFocus(tabId){
  try{
    const id=metaFreePrevActiveTab;
    metaFreePrevActiveTab=null;
    try{await chrome.alarms.clear("metaFreeRestoreFocus");}catch(_){}
    if(id&&Number(id)!==Number(tabId)){
      const tab=await chrome.tabs.get(Number(id)).catch(()=>null);
      if(tab)await chrome.tabs.update(Number(id),{active:true});
    }
  }catch(_){}
}
async function ensureMetaFreeTab(){
  try{
    const sess=await chrome.storage.session.get("metaFreeTabId").catch(()=>({}));
    const alive=await metaFreeTabAlive(sess.metaFreeTabId);
    if(alive)return alive;
  }catch(_){}
  // Không chiếm tab meta.ai của user (nếu có): chỉ dùng lại tab worker của mình,
  // còn lại luôn mở tab nền mới.
  const tab=await chrome.tabs.create({url:"https://www.meta.ai/",active:false}).catch(()=>null);
  if(!tab||tab.id===undefined)throw new Error(t("bg.metaNoTab"));
  try{await chrome.storage.session.set({metaFreeTabId:tab.id});}catch(_){}
  // Chống Chrome Memory Saver dọn tab worker đang chạy nền giữa chừng.
  try{await chrome.tabs.update(tab.id,{autoDiscardable:false});}catch(_){}
  // Đợi trang tải xong để content script kịp gắn listener.
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(fn);resolve();},20000);
    function fn(id,info){if(id===tab.id&&info.status==="complete"){chrome.tabs.onUpdated.removeListener(fn);clearTimeout(timer);resolve();}}
    chrome.tabs.onUpdated.addListener(fn);
  });
  await new Promise(r=>setTimeout(r,1500));
  return tab;
}
function metaFreeSend(tabId,prompt,timeoutMs,seq){
  return new Promise(resolve=>{
    let done=false;
    // Hết giờ mà content script không đáp gì (treo/crash) — khác với META_TIMEOUT
    // là content đã đáp "chờ streaming quá lâu". Phân biệt để chẩn đoán đúng.
    const timer=setTimeout(()=>{if(!done){done=true;resolve({ok:false,error:"META_NO_RESPONSE"});}},timeoutMs);
    try{
      chrome.tabs.sendMessage(tabId,{action:"metaFreeAsk",prompt,seq},resp=>{
        if(done)return;done=true;clearTimeout(timer);
        if(chrome.runtime.lastError)return resolve({ok:false,error:"META_NO_RECEIVER"});
        resolve(resp||{ok:false,error:"META_EMPTY"});
      });
    }catch(e){if(!done){done=true;clearTimeout(timer);resolve({ok:false,error:String(e?.message||e).slice(0,200)});}}
  });
}
async function metaFreeAskOnce(prompt,feature){
  if(!prompt)throw new Error(t("bg.aiEmpty"));
  feature=String(feature||"meta").slice(0,40)||"meta";
  // Chẩn đoán ghi vào storage để luồng đăng nhóm (feed.js) đọc kèm khi chính nó
  // hết giờ 150s trước — trước đây lỗi chi tiết của SW luôn bị race che mất.
  const askStartedAt=Date.now();
  const writeDiag=async(code,detail)=>{
    try{await chrome.storage.local.set({metaFreeDiag:{feature,code:String(code||"").slice(0,60),detail:String(detail||"").slice(0,180),at:Date.now(),durationMs:Date.now()-askStartedAt}});}catch(_){}
  };
  // Deadline nội bộ NHỎ HƠN race 150s phía feed: SW luôn trả verdict chi tiết
  // trước khi feed bỏ cuộc mù. Không có nó, một lượt chậm kẹt cả hàng đợi FIFO
  // (mọi lượt sau chờ sau lưng) thành chuỗi "AI quá 150 giây" dù Meta vẫn sống.
  // Mỗi lượt có seq riêng; content script tự dừng khi thấy seq mới hơn.
  const mySeq=++metaFreeSeq;
  const askExpired=()=>Date.now()-askStartedAt>META_ASK_DEADLINE_MS;
  const remainingMs=()=>Math.max(10000,META_ASK_DEADLINE_MS-(Date.now()-askStartedAt));
  const throwAbandoned=async phase=>{
    await writeDiag("ASK_ABANDONED",phase);
    const e=new Error(t("bg.metaAbandoned",{phase}));
    e.code="AI_TIMEOUT";
    throw e;
  };
  let cfg={};
  try{cfg=await chrome.storage.sync.get(["metaFreeSessionMax","metaFreeChatMode"]).catch(()=>({}));}catch(_){}
  const maxSession=Math.max(2,Math.min(200,parseInt(cfg.metaFreeSessionMax)||30));
  // Chế độ "fresh": mỗi câu chat mới (bỏ session). Dùng khi nick bị bóp ở chat
  // cũ nối dài mà chat mới vẫn chạy mượt.
  const freshMode=cfg.metaFreeChatMode==="fresh";
  let sessions={};
  try{
    const s=await chrome.storage.local.get("metaFreeSessions").catch(()=>({}));
    if(s.metaFreeSessions&&typeof s.metaFreeSessions==="object")sessions=s.metaFreeSessions;
  }catch(_){}
  const saveSessions=async next=>{try{await chrome.storage.local.set({metaFreeSessions:next});}catch(_){}};
  // 1 session/tính năng: tái dùng chat cũ, đủ N lượt (gần đầy) thì xóa mở mới.
  // Chế độ fresh: luôn chat mới, không ghi session.
  const target=freshMode?{chatId:"",fresh:true,rotateId:""}:metaFreeSessionTarget(sessions,feature,maxSession);
  if(target.rotateId){
    try{await metaFreeCleanIds([target.rotateId]);}catch(_){}
    delete sessions[feature];
    await saveSessions(sessions);
  }
  if(askExpired())await throwAbandoned("rotating-clean");
  const tab=await ensureMetaFreeTab();
  // Navigate từ SW (không phải từ content script) để context mới nhận message.
  const gotoAndWait=async url=>{
    await chrome.tabs.update(tab.id,{url}).catch(()=>{});
    await new Promise(resolve=>{
      const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(fn);resolve();},25000);
      function fn(id,info){if(id===tab.id&&info.status==="complete"){chrome.tabs.onUpdated.removeListener(fn);clearTimeout(timer);resolve();}}
      chrome.tabs.onUpdated.addListener(fn);
    });
    await new Promise(r=>setTimeout(r,2500));
  };
  const targetUrl=target.chatId?`https://www.meta.ai/prompt/${target.chatId}`:"https://www.meta.ai/";
  // Không navigate khi tab đã đứng đúng chat cần hỏi: reload vô ích làm mất
  // composer đang mount (build Meta mới chỉ mount khi tab hiển thị) khiến
  // lượt hỏi sau chắc chắn rớt META_NO_COMPOSER/META_TYPE_FAIL.
  const curUrl=String(tab.url||"");
  if(curUrl!==targetUrl)await gotoAndWait(targetUrl);
  else await new Promise(r=>setTimeout(r,1200));
  if(askExpired())await throwAbandoned("navigating");
  // Trần mỗi lượt gửi theo ngân sách còn lại của deadline 140s (tối thiểu 10s
  // để tab chậm vẫn có cơ hội đáp) — SW luôn verdict trước race 150s của feed.
  let res=await metaFreeSend(tab.id,prompt,Math.min(160000,remainingMs()),mySeq);
  if(askExpired()&&!res.ok)await throwAbandoned("waiting-send");
  if(!res.ok&&res.error==="META_NO_RECEIVER"){
    // Tab chưa có content script (vừa tạo/xong reload): tải lại 1 lần rồi thử lại.
    await chrome.tabs.reload(tab.id).catch(()=>{});
    await new Promise(r=>setTimeout(r,4000));
    if(askExpired())await throwAbandoned("reloading-tab");
    res=await metaFreeSend(tab.id,prompt,Math.min(160000,remainingMs()),mySeq);
  }
  if(!res.ok&&(res.error==="META_NO_COMPOSER"||res.error==="META_NEED_LOGIN")&&target.chatId){
    // Session chết (user xóa tay / hết hạn): bỏ session, mở chat mới thử lại 1 lần.
    delete sessions[feature];
    await saveSessions(sessions);
    await gotoAndWait("https://www.meta.ai/");
    if(askExpired())await throwAbandoned("reopening-chat");
    res=await metaFreeSend(tab.id,prompt,Math.min(160000,remainingMs()),mySeq);
  }
  if(!res.ok){
    const code=String(res.error||"META_ERROR");
    const detail=String(res.detail||"").slice(0,120);
    const withDetail=msg=>detail?`${msg} [${detail}]`:msg;
    // Lượt cũ bị lượt mới hơn vượt mặt (feed đã bỏ sau race): không tính là
    // Meta treo, không xoay session oan — báo timeout để feed skip/retry.
    if(code==="META_SUPERSEDED"){await writeDiag(code,detail||"superseded-by-newer-ask");const e=new Error(t("bg.metaAbandoned",{phase:"superseded"}));e.code="AI_TIMEOUT";throw e;}
    if(code==="META_NEED_LOGIN"){await writeDiag(code,detail);throw new Error(t("bg.metaNeedLogin"));}
    // Treo 2 lần liên tiếp trên cùng session → tự xoay sang chat mới (tự chữa
    // session kẹt) rồi mới báo lỗi lượt này; lượt sau dùng chat mới.
    if(code==="META_TIMEOUT"||code==="META_NO_RESPONSE"){
      try{
        const prev=sessions[feature];
        const n=(parseInt(prev&&prev.timeouts)||0)+1;
        if(prev)prev.timeouts=n;else sessions[feature]={chatId:"",asks:0,timeouts:n,at:Date.now()};
        await saveSessions(sessions);
        if(n>=2){
          const oldId=prev&&prev.chatId?prev.chatId:"";
          delete sessions[feature];
          await saveSessions(sessions);
          if(oldId){try{await metaFreeCleanIds([oldId]);}catch(_){}}
        }
      }catch(_){}
    }
    await writeDiag(code,detail);
    if(code==="META_TIMEOUT")throw new Error(withDetail(t("bg.metaTimeout")));
    // Tab Meta không đáp gì (treo/crash/content chết giữa chừng).
    if(code==="META_NO_RESPONSE")throw new Error(withDetail(t("bg.metaNoResponse")));
    if(code==="META_BUSY")throw new Error(t("bg.metaBusy"));
    throw new Error(withDetail(`${t("bg.metaFail")}: ${code}`));
  }
  const text=metaFreeStripThinking(res.text);
  if(!text){await writeDiag("AI_EMPTY","");throw new Error(t("bg.aiEmpty"));}
  await writeDiag("OK",`${[...String(text)].length} chars`);
  // Ghi session (chỉ uuid + số lượt, không lưu nội dung) + track để dọn sau.
  // Chế độ fresh không ghi session (mỗi câu chat mới hoàn toàn).
  try{
    const live=await chrome.tabs.get(tab.id).catch(()=>null);
    const chatId=metaFreeChatIdFromUrl(String(res.chatId||""))||metaFreeChatIdFromUrl(String(live?.url||""));
    if(chatId){
      if(!freshMode){
        const prev=sessions[feature];
        const same=prev&&prev.chatId===chatId;
        sessions[feature]={chatId,asks:(same?parseInt(prev.asks)||0:0)+1,at:Date.now(),timeouts:0};
        await saveSessions(sessions);
      }
      await metaFreeTrackChat(chatId);
    }
  }catch(_){}
  // Tự dọn chat cũ vượt ngưỡng giữ lại: bắn-fire-and-forget để lượt dọn
  // (navigate home + xóa sidebar, có thể tốn hàng chục giây) không chặn verdict
  // của lượt hỏi này — trước đây await ở đây làm SW trả muộn hơn race feed.
  try{metaFreeCleanOld().catch(e=>console.warn("[meta-free] autoclean:",String(e?.message||e).slice(0,120)));}catch(e){console.warn("[meta-free] autoclean:",String(e?.message||e).slice(0,120));}
  return text;
}
// Parse uuid từ URL /prompt/<uuid> — chỉ nhận đúng uuid worker trả về.
function metaFreeChatIdFromUrl(url){
  const m=String(url||"").match(/\/prompt\/([0-9a-f-]{8,60})/i);
  return m?m[1]:"";
}
// Session 1 chat/tính năng: tái dùng chat cũ cho cùng tính năng, đủ N lượt
// (gần đầy) thì xóa mở mới. Trả về chat dùng tiếp, hoặc rỗng để mở chat mới.
function metaFreeSessionTarget(sessions,feature,maxAsks){
  const max=Math.max(2,Math.min(200,parseInt(maxAsks)||30));
  const entry=sessions&&typeof sessions==="object"?sessions[feature]:null;
  const id=entry&&typeof entry.chatId==="string"?entry.chatId:"";
  const asks=Math.max(0,parseInt(entry&&entry.asks)||0);
  if(id&&asks<max)return {chatId:id,fresh:false,rotateId:""};
  return {chatId:"",fresh:true,rotateId:id||""};
}
async function metaFreeTrackChat(chatId){
  if(!chatId)return;
  try{
    const s=await chrome.storage.local.get("metaFreeWorkerChats").catch(()=>({}));
    const list=Array.isArray(s.metaFreeWorkerChats)?s.metaFreeWorkerChats:[];
    if(!list.some(e=>e&&e.id===chatId)){
      list.push({id:chatId,at:Date.now()});
      await chrome.storage.local.set({metaFreeWorkerChats:list.slice(-500)});
    }
  }catch(_){}
}
// Chat nào cần dọn: CHỈ khi tổng vượt trần (gần đầy) mới xóa bớt, giữ lại N
// mới nhất cho user dùng lại ngữ cảnh/đối chiếu. Chưa tới trần thì giữ hết.
function metaFreeCleanTargets(tracked,keepN,maxN){
  const list=Array.isArray(tracked)?tracked.filter(e=>e&&e.id):[];
  const keep=Math.max(0,Math.min(10000,parseInt(keepN)||0));
  const max=Math.max(keep+1,Math.min(20000,parseInt(maxN)||200));
  if(list.length<=max)return [];
  return list.slice(0,list.length-keep).map(e=>e.id);
}
async function metaFreeCleanIds(ids){
  const targets=(Array.isArray(ids)?ids:[]).map(x=>String(x||"").trim()).filter(Boolean);
  if(!targets.length)return {ok:true,deleted:[],failed:[]};
  const tab=await ensureMetaFreeTab();
  // Sidebar lịch sử nằm ở trang chủ — về HOME trước khi dọn.
  const onHome=/^https:\/\/www\.meta\.ai\/(\?|#|$)/.test(String(tab.url||""));
  if(!onHome){
    await chrome.tabs.update(tab.id,{url:"https://www.meta.ai/"}).catch(()=>{});
    await new Promise(resolve=>{
      const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(fn);resolve();},25000);
      function fn(id,info){if(id===tab.id&&info.status==="complete"){chrome.tabs.onUpdated.removeListener(fn);clearTimeout(timer);resolve();}}
      chrome.tabs.onUpdated.addListener(fn);
    });
    await new Promise(r=>setTimeout(r,2500));
  }
  const res=await new Promise(resolve=>{
    let done=false;
    // Trần 60s cho một lượt dọn (xóa 1 chat chỉ tốn vài giây): rotation dọn
    // xong vẫn còn ngân sách cho lượt hỏi trong deadline 140s của SW.
    const timer=setTimeout(()=>{if(!done){done=true;resolve({ok:false,error:"META_TIMEOUT"});}},60000);
    try{
      chrome.tabs.sendMessage(tab.id,{action:"metaFreeClean",chatIds:targets},resp=>{
        if(done)return;done=true;clearTimeout(timer);
        if(chrome.runtime.lastError)return resolve({ok:false,error:"META_NO_RECEIVER",deleted:[],failed:targets});
        resolve(resp||{ok:false,error:"META_EMPTY",deleted:[],failed:targets});
      });
    }catch(e){if(!done){done=true;clearTimeout(timer);resolve({ok:false,error:String(e?.message||e).slice(0,200),deleted:[],failed:targets});}}
  });
  // Bỏ khỏi danh sách track những chat đã xóa được (thất bại giữ lại thử sau).
  try{
    const s=await chrome.storage.local.get("metaFreeWorkerChats").catch(()=>({}));
    const gone=new Set(res.deleted||[]);
    const list=(Array.isArray(s.metaFreeWorkerChats)?s.metaFreeWorkerChats:[]).filter(e=>e&&!gone.has(e.id));
    await chrome.storage.local.set({metaFreeWorkerChats:list.slice(-200)});
  }catch(_){}
  return res;
}
// Dọn tự động sau mỗi câu hỏi: chỉ dọn khi số chat worker vượt trần.
async function metaFreeCleanOld(){
  let cfg={};
  try{cfg=await chrome.storage.sync.get(["metaFreeAutoClean","metaFreeKeepN","metaFreeMaxChats"]).catch(()=>({}));}catch(_){}
  if(cfg.metaFreeAutoClean===false)return {ok:true,deleted:[],failed:[],skipped:true};
  let tracked=[];
  try{
    const s=await chrome.storage.local.get("metaFreeWorkerChats").catch(()=>({}));
    tracked=Array.isArray(s.metaFreeWorkerChats)?s.metaFreeWorkerChats:[];
  }catch(_){}
  const targets=metaFreeCleanTargets(tracked,cfg.metaFreeKeepN===undefined?20:cfg.metaFreeKeepN,cfg.metaFreeMaxChats===undefined?200:cfg.metaFreeMaxChats);
  if(!targets.length)return {ok:true,deleted:[],failed:[]};
  return metaFreeCleanIds(targets);
}
// Đăng bài nhóm kèm ngữ cảnh: dựng khối context từ digest đã tóm tắt cục bộ
// ở content script (chỉ digest nhỏ đi qua AI, quota không phụ thuộc số bài).
// Không sao chép nguyên văn sample, không bịa tên/giá/số liệu.
function buildGroupPostContextBlock(ctx,background){
  if(!ctx||typeof ctx!=="object")return "";
  const d=ctx.digest&&typeof ctx.digest==="object"?ctx.digest:null;
  const type=ctx.groupType==="knowledge"?t("bg.ctxTypeKnowledge"):t("bg.ctxTypeMarket");
  const win=Math.max(1,Math.min(72,parseInt(ctx.windowHours)||24));
  const lines=[t("bg.ctxHead")];
  lines.push(`${t("bg.ctxGroup")}: "${String(ctx.groupName||"").slice(0,180)}" (${t("bg.ctxType")}: ${type}; ${t("bg.ctxWindow")} ${win} ${t("bg.ctxHours")}; ${t("bg.ctxToday")}: ${String(ctx.today||"").slice(0,20)})`);
  if(d){
    // Bài nền màu bị giới hạn ~130 ký tự: chỉ đưa topics gọn để AI khỏi viết
    // dài rồi nén không vừa (fail-closed cả run trước đây). Bài thường mới kèm hooks.
    const topicN=background&&background.enabled?5:8;
    if(Array.isArray(d.topics)&&d.topics.length)lines.push(`${t("bg.ctxTopics")}: ${d.topics.slice(0,topicN).join(", ")}`);
    if(parseInt(d.questionPosts)||0)lines.push(`${t("bg.ctxQuestions")}: ${parseInt(d.questionPosts)}`);
    if(!(background&&background.enabled)&&Array.isArray(d.hooks)&&d.hooks.length)lines.push(d.hooks.slice(0,4).map((h,i)=>`${i+1}. ${String(h||"").slice(0,120)}`).join("\n"));
    if(d.oldestHours!==undefined&&d.oldestHours!==null)lines.push(`${t("bg.ctxOldest")}: ${d.oldestHours}h`);
    if(d.shortFallback)lines.push(t("bg.ctxShortNote"));
  }
  // Chế độ Cá nhân hoá + bài thường: kèm 2 bài mẫu nguyên văn để AI bám case
  // thật (không copy, không bịa). Bài nền giữ slim vì trần 130 ký tự.
  if(ctx.mode==="deep"&&!(background&&background.enabled)&&Array.isArray(ctx.exemplars)&&ctx.exemplars.length){
    lines.push(t("bg.ctxExHead")+"\n"+ctx.exemplars.slice(0,2).map((x,i)=>`M${i+1}. ${String(x||"").slice(0,800)}`).join("\n"));
  }
  if(Array.isArray(ctx.avoid)&&ctx.avoid.length)lines.push(t("bg.ctxAvoid")+"\n"+ctx.avoid.slice(0,5).join("\n"));
  lines.push(background&&background.enabled?t("bg.ctxBgRule"):t("bg.ctxPlainRule"));
  if(ctx.useSearch)lines.push(t("bg.ctxSearchNote"));
  return lines.filter(Boolean).join("\n");
}
// Gemini grounding (Google Search) — chỉ dùng khi user bật toggle và provider
// là Gemini, dùng đúng key Gemini sẵn có (không thêm kho key mới). Lỗi tool
// không hỗ trợ thì ném cờ searchUnsupported để caller fallback digest thuần.
async function callGeminiWithSearch(apiKey,model,prompt){
  const chosenModel=String(model||AI_DEFAULTS.gemini.model).trim()||AI_DEFAULTS.gemini.model;
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`;
  const body={contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.8,maxOutputTokens:500},tools:[{google_search:{}}]};
  const res=await fetchWithTimeout(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},body:JSON.stringify(body)});
  let data={};
  try{data=await res.json();}catch{data={};}
  if(!res.ok){
    const raw=JSON.stringify(data).slice(0,300);
    if(/google_?search|tools?|not supported|not found|invalid/i.test(raw)){const err=new Error(raw||"search unsupported");err.searchUnsupported=true;throw err;}
    throw new Error(data.error?.message||(Object.keys(data).length?raw:`HTTP ${res.status}`));
  }
  const out=String((data.candidates||[]).flatMap(c=>c.content?.parts||[]).filter(p=>typeof p.text==="string").map(p=>p.text).join("\n")||"").trim().replace(/^["']|["']$/g,"");
  if(!out)throw new Error("Gemini không trả về nội dung");
  return out;
}
async function repairBackgroundPost(content,background,requestText,cleaner,freshText=null,skipAiRepair=false){
  if(!background.enabled)return cleaner(content);
  const range=backgroundTargetRange(background.maxChars);
  // Ngưỡng sàn chống rác (VD chuỗi rỗng/cụt lủn): dưới ngưỡng này thì bỏ qua
  // nhóm. Câu tròn ≥50 ký tự vẫn đăng bình thường (kết câu tròn là đủ, ngắn
  // không có nghĩa là cụt); bài 49 ký tự cụt dở vẫn bị loại như cũ.
  const gate=Math.min(range.min,50);
  const endsRound=s=>/[.!?…。！？]$/.test(String(s||"").trim());
  // Bài dùng được: vừa trần nền, qua ngưỡng stub, kết bằng câu tròn.
  const usable=s=>{const v=cleaner(s);const l=backgroundTextLength(v);return v&&l>=gate&&l<=range.max&&endsRound(v)?v:"";};
  const current=cleaner(content);
  const initialLength=backgroundTextLength(current);
  if(initialLength>=range.min&&initialLength<=range.max)return current;
  // 1) Dài quá: cắt cơ học ở câu tròn TRƯỚC — xác định 100%, không tốn lượt
  // AI. (AI đếm ký tự tiếng Việt rất kém nên bắt nó nén vào band hẹp 115-130
  // hụt hàng loạt; cắt cơ học luôn trúng.) Ưu tiên khối từ đầu bài, nếu khối
  // đầu cụt (câu mở ngắn + thân dài) thì lấy cửa sổ câu ngon nhất ở giữa —
  // vì opener ngắn kiểu hook hay làm khối prefix rớt ngưỡng stub.
  if(initialLength>range.max){
    const fitted=truncateAtSentence(current,range.max);
    let ok=usable(fitted);
    if(!ok){
      const sents=current.match(/[^.!?。！？]+[.!?。！？]+/g)||[];
      let best="";
      for(let i=0;i<sents.length&&!ok;i++){
        let cur="";
        for(let j=i;j<sents.length;j++){
          const cand=`${cur}${sents[j]}`.trim();
          if(backgroundTextLength(cand)>range.max)break;
          cur=cand;
        }
        if(backgroundTextLength(cur)>=gate&&backgroundTextLength(cur)>backgroundTextLength(best))best=cur;
      }
      ok=usable(best);
    }
    if(ok)return ok;
  }
  // 2) AI sửa tối đa 2 lượt (nén khi dài / mở rộng khi cụt). Lượt gieo lại
  // (skipAiRepair) bỏ qua để khỏi đốt quota — chỉ còn cắt cơ học + viết mới.
  const belowMin=initialLength<range.min;
  if(!skipAiRepair){
  const repairKey=belowMin?"bg.postBgExpand":"bg.postBgRepair";
  const repairLabel=belowMin?"NỘI DUNG CẦN BỔ SUNG Ý":"NỘI DUNG CẦN NÉN";
  let repaired=cleaner(await requestText(t(repairKey,range)+`\n\n${repairLabel}:\n`+current));
  if(!repaired)throw new Error(t("bg.contentEmpty"));
  let hit=usable(repaired);
  if(hit)return hit;
  // Lượt hai bỏ mục tiêu cận dưới, chỉ ép trần cứng.
  const hardLimitPrompt=t("bg.postBgHardRepair",{max:range.max})+"\n\nNỘI DUNG CẦN NÉN:\n"+repaired;
  repaired=cleaner(await requestText(hardLimitPrompt));
  if(!repaired)throw new Error(t("bg.contentEmpty"));
  hit=usable(repaired);
  if(hit)return hit;
  // 3) Viết mới 1 lần từ prompt đầy đủ (stub/cụt hoặc nén mãi không vừa).
  // Chỉ tốn thêm 1 lượt gọi trong nhánh hiếm này.
  if(typeof freshText==="function"){
    try{
      const fresh=usable(await freshText());
      if(fresh)return fresh;
    }catch(_){}
  }
  }
  // 4) Fallback cục bộ: câu tròn dài nhất vừa trần. Không bao giờ cắt giữa
  // câu để ép vào nền màu.
  const completeParts=current.match(/[^.!?。！？]+[.!?。！？]+/g)||[];
  let complete="";
  for(const part of completeParts){
    const candidate=`${complete}${part}`.trim();
    if(backgroundTextLength(candidate)>range.max)break;
    complete=candidate;
  }
  hit=usable(complete);
  if(hit)return hit;
  const error=new Error(t("bg.postTooLong",{max:range.max}));
  error.backgroundTooLong=true;
  throw error;
}

function strictGroupShareCaptionPrompt(text,recentCaptions=[]){
  const avoid=(Array.isArray(recentCaptions)?recentCaptions:[]).slice(-8).map((caption,index)=>`${index+1}. ${String(caption||"").slice(0,260)}`).join("\n");
  return `${text}\n\n${t("bg.leadRules")}${avoid?`${t("bg.leadAvoided")}\n${avoid}`:""}`;
}
function normalizeGroupShareCaption(value){return String(value||"").toLocaleLowerCase("vi").replace(/https?:\/\/\S+/gi,"").replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();}
function cleanGroupShareCaption(raw){
  let caption=guardAiPostText(raw).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean).join(" ");
  caption=sanitizePostedText(caption.replace(/^(?:tiêu đề|lời dẫn|caption|nội dung)\s*:\s*/i,"").replace(/^[-*•\d.)\s]+/,"").replace(/^['"""]+|['"""]+$/g,"").replace(/https?:\/\/\S+/gi,"").replace(/(^|\s)#[\p{L}\p{N}_-]+/gu," ").replace(/\s+/g," ").trim());
  if([...caption].length>280)caption=truncateAtSentence(caption,280);
  return sanitizePostedText(caption).replace(/[!！]+\s*$/g,"").trimEnd();
}

function compactGroupShareChat(messages=[]){
  const rows=(Array.isArray(messages)?messages:[]).slice(-12).map(item=>({
    role:item?.role==="assistant"?"assistant":"user",
    content:String(item?.content||"").replace(/\s+/g," ").trim().slice(0,1000)
  })).filter(item=>item.content);
  let used=0;
  return rows.reverse().filter(item=>{used+=item.content.length;return used<=5000;}).reverse();
}
function formatGroupShareChatContext(messages=[]){
  return compactGroupShareChat(messages).map(item=>`${item.role==="assistant"?t("bg.chatAi"):t("bg.chatUser")}: ${item.content}`).join("\n");
}

function compactProfilePosts(posts){
  return (Array.isArray(posts)?posts:[]).map(p=>({
    text:String(p?.text||"").replace(/\s+/g," ").trim().slice(0,700),
    author:String(p?.author||"").slice(0,80),
    sourceType:String(p?.sourceType||"").slice(0,30),
    isSponsored:!!p?.isSponsored,
    contentClass:String(p?.contentClass||"text").slice(0,20)
  })).filter(p=>p.text.length>=15).slice(0,80);
}
function profileIdFromName(name){
  const base=String(name||t("bg.profileShort")).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,40)||"ho-so";
  return `sp_${base}_${Date.now().toString(36)}`;
}
function heuristicStyleProfile(posts,name){
  const rows=compactProfilePosts(posts),texts=rows.map(p=>p.text),all=texts.join(" ");
  const words=all.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[],stop=new Set(t("bg.stopwords").split(/\s+/));
  const freq=new Map();for(const w of words){if(stop.has(w))continue;freq.set(w,(freq.get(w)||0)+1);}
  const commonTerms=[...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([w])=>w);
  const sentences=all.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean),avgWords=sentences.length?Math.round(sentences.reduce((n,s)=>n+(s.match(/[\p{L}\p{N}]+/gu)||[]).length,0)/sentences.length):0;
  const emojiCount=(all.match(/[\p{Extended_Pictographic}]/gu)||[]).length;
  const punctuation=["?","!",":","…"].map(ch=>({ch,count:(all.split(ch).length-1)})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).map(x=>x.ch);
  const first=texts.slice(0,3);
  return {name:String(name||t("st.defaultName")).trim().slice(0,80)||t("st.defaultName"),source:"heuristic",createdAt:new Date().toISOString(),sampleCount:rows.length,knowledge:{topics:commonTerms.slice(0,8),commonTerms,knownFacts:[],doNotInvent:[t("bg.hDoNotInvent")]},style:{tone:t("bg.hTone"),voice:t("bg.hVoice"),averageWordsPerSentence:avgWords,emojiUsage:emojiCount?t("bg.hEmojiSometimes"):t("bg.hEmojiRare"),punctuation,commonOpeners:first.map(t=>t.slice(0,80))},examples:first};
}
function parseProfileJson(raw){
  let text=String(raw||"").replace(/```json|```/gi," ").trim();
  const first=text.indexOf("{"),last=text.lastIndexOf("}");
  if(first>=0&&last>first)text=text.slice(first,last+1);
  try{const parsed=JSON.parse(text);return parsed&&typeof parsed==="object"?parsed:null;}catch{return null;}
}
function profilePrompt(rows,name){
  const sample=(Array.isArray(rows)?rows:[]).slice(0,40).map(row=>({...row,text:String(row?.text||"").slice(0,500)}));
  return t("bg.profilePrompt",{name:String(name||t("bg.profileShort")).slice(0,80)})+"\n"+JSON.stringify(sample);
}

// --- Tóm tắt cục bộ (miễn phí, không gọi API) trước khi đưa Gemini học văn phong.
// Gemini chỉ đọc digest nhỏ gọn nên quota gần như không phụ thuộc số bài gốc.
function estimateTokens(text){ return Math.max(1, Math.ceil(String(text||"").length / 3.5)); }
function medianValues(nums){ if(!nums.length)return 0; const s=[...nums].sort((a,b)=>a-b); const m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
function stopWordsSet(){ return new Set(String(t("bg.stopwords")||"").split(/\s+/)); }
function styleDigestKey(rows){
  const ids=(Array.isArray(rows)?rows:[]).slice(0,200).map(r=>String(r?.id||r?.link||"").slice(0,60)).join("|");
  const len=(Array.isArray(rows)?rows:[]).reduce((n,r)=>n+String(r?.text||"").length,0);
  const s=ids+"|"+len;let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;
  return (Math.abs(h)>>>0).toString(36)+s.length.toString(36);
}
function buildStyleDigest(rows,classes){
  const filtered=(Array.isArray(rows)?rows:[]).filter(p=>{const c=String(p?.contentClass||"text");return !classes||!classes.length||classes.includes(c);});
  const texts=filtered.map(p=>String(p.text||"").replace(/\s+/g," ").trim()).filter(Boolean);
  const all=texts.join("\n");
  const words=(all.match(/[\p{L}\p{N}]+/gu)||[]);
  const sentences=all.split(/[.!?…]+/).map(s=>s.trim()).filter(Boolean);
  const lengths=texts.map(t=>(t.match(/[\p{L}\p{N}]+/gu)||[]).length);
  const stop=stopWordsSet(),freq=new Map();
  for(const w of words){const lw=w.toLowerCase();if(lw.length<3||stop.has(lw))continue;freq.set(lw,(freq.get(lw)||0)+1);}
  const dedupe=(arr,n)=>[...new Set((Array.isArray(arr)?arr:[]).map(x=>String(x||"").trim()).filter(Boolean))].slice(0,n);
  const firstSentence=t=>String(t||"").split(/[.!?…\n]+/)[0].trim().slice(0,90);
  const lastSentence=t=>{const parts=String(t||"").split(/[.!?…\n]+/).map(s=>s.trim()).filter(Boolean);return (parts[parts.length-1]||"").slice(0,90);};
  const emojis=(all.match(/[\p{Extended_Pictographic}]/gu)||[]);
  const emojiFreq=new Map();emojis.forEach(e=>emojiFreq.set(e,(emojiFreq.get(e)||0)+1));
  const classCounts={text:0,textBg:0,photo:0,video:0,other:0};
  filtered.forEach(p=>{const c=String(p?.contentClass||"other");classCounts[c]=(classCounts[c]||0)+1;});
  return {
    summary:{ postCount:texts.length, wordCount:words.length, avgWordsPerPost:Math.round(words.length/Math.max(1,texts.length)), medianWordsPerPost:Math.round(medianValues(lengths)), classCounts },
    sentence:{ count:sentences.length, avgWordsPerSentence:Math.round(sentences.reduce((n,s)=>n+(s.match(/[\p{L}\p{N}]+/gu)||[]).length,0)/Math.max(1,sentences.length)) },
    topics:[...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([w])=>w),
    hooks:dedupe(texts.map(firstSentence),8),
    closers:dedupe(texts.map(lastSentence),8),
    emoji:{ count:emojis.length, top:[...emojiFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([e,n])=>`${e}x${n}`) },
    punctuation:["?","!",":","…","-"].map(ch=>({ch,count:(all.split(ch).length-1)})).filter(x=>x.count>0),
    hashtags:dedupe(all.match(/#[\p{L}\p{N}_]+/gu)||[],20),
    samples:dedupe(texts.map(t=>t.length>140?t.slice(0,140)+"…":t),12),
    structure:{ questionPosts:texts.filter(t=>t.includes("?")).length, bulletPosts:texts.filter(t=>/^[-*•▪▫◦]\s|^\d+[.)]\s|\n[-*•▪▫◦\d]/u.test(t)).length, avgParagraphs:Math.round(texts.reduce((n,t)=>n+String(t).split(/\n+/).filter(Boolean).length,0)/Math.max(1,texts.length)) }
  };
}
async function digestCacheGet(key){ try{ const s=await chrome.storage.local.get("styleDigestCache"); const c=s.styleDigestCache&&typeof s.styleDigestCache==="object"?s.styleDigestCache:{}; return c[key]?.digest||null; }catch(_){ return null; } }
async function digestCachePut(key,digest){
  try{
    const s=await chrome.storage.local.get("styleDigestCache");
    const c=s.styleDigestCache&&typeof s.styleDigestCache==="object"?s.styleDigestCache:{};
    c[key]={digest,at:Date.now()};
    const keys=Object.keys(c).sort((a,b)=>(Number(c[b]?.at)||0)-(Number(c[a]?.at)||0));
    keys.slice(5).forEach(k=>{ if(k!==key) delete c[k]; });
    await chrome.storage.local.set({styleDigestCache:c});
  }catch(_){}
}
function profilePromptV2(name,digest){
  return t("bg.profilePromptV2",{name:String(name||t("bg.profileShort")).slice(0,80)})+"\n"+JSON.stringify(digest);
}
async function getActiveStyleContext(profileId=""){
  const saved=await chrome.storage.local.get(["styleProfiles","activeStyleProfileId"]),profile=saved.styleProfiles?.[profileId||saved.activeStyleProfileId];
  if(!profile)return "";
  const compact={name:profile.name,knowledge:profile.knowledge||{},style:profile.style||{},examples:(profile.examples||[]).slice(0,3).map(x=>String(x).slice(0,300))};
  return `${t("bg.styleCtx")} ${JSON.stringify(compact)}`;
}

const AI_FETCH_TIMEOUT_MS=45000;
// A stalled AI provider request (dead connection, provider hang) must never
// block forever: every caller awaits this before deciding a feature has
// failed, and an un-timed-out fetch here leaves that feature's "active" flag
// stuck true, locking out every other feature that checks it.
async function fetchWithTimeout(url,options={},timeoutMs=AI_FETCH_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(url,{...options,signal:controller.signal});
  }catch(error){
    if(error?.name==="AbortError")throw new Error(t("bg.aiTimeout")||"AI không phản hồi kịp thời, đã hủy yêu cầu");
    throw error;
  }finally{clearTimeout(timer);}
}
// 2.11.9 — Lớp chặn SSRF cho fbFetchMedia: URL media do caller/task/nội dung
// web đưa vào nên không cho fetch đích nội bộ. Kiểm cả URL ban đầu lẫn URL
// cuối sau redirect (response.url) — xem assertPublicMediaUrl.
function mediaHostBlocked(hostname){
  const host=String(hostname||"").toLowerCase().replace(/\.$/,"").replace(/^\[|\]$/g,"");
  if(!host)return true;
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local"))return true;
  if(host.includes(":")){
    // IPv6: loopback ::1, unspecified ::, link-local fe80::/10, unique-local fc00::/7
    if(host==="::1"||host==="::")return true;
    if(/^fe[89ab]/.test(host))return true;
    if(/^f[cd]/.test(host))return true;
    const mapped=host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if(mapped)return mediaHostBlocked(mapped[1]);
    // URL parser chuẩn hoá IPv4-mapped về dạng hex ::ffff:7f00:1 (= 127.0.0.1)
    const mappedHex=host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if(mappedHex){
      const hi=parseInt(mappedHex[1],16),lo=parseInt(mappedHex[2],16);
      return mediaHostBlocked(`${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`);
    }
    return false;
  }
  const m=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if(m){
    const a=+m[1],b=+m[2];
    if(a===127||a===10||a===0)return true;                 // loopback / private A / "this host"
    if(a===172&&b>=16&&b<=31)return true;                  // private B
    if(a===192&&b===168)return true;                       // private C
    if(a===169&&b===254)return true;                       // link-local (metadata)
  }
  return false;
}
function assertPublicMediaUrl(urlStr){
  let u=null;
  try{u=new URL(String(urlStr||""));}catch(_){throw new Error("mediaFetch: invalid URL");}
  if(u.protocol!=="http:"&&u.protocol!=="https:")throw new Error("mediaFetch: blocked non-http(s) URL");
  if(mediaHostBlocked(u.hostname))throw new Error("mediaFetch: blocked internal host");
}
// Đọc body có trần cứng: không tin content-length mù quáng — đếm byte thật
// khi stream, vượt trần là huỷ ngay (server báo thiếu/không báo length vẫn
// không xả quá trần được).
async function readMediaBodyWithCap(res,maxBytes){
  const tooBig=()=>new Error(`Media file exceeds size limit (> ${Math.round(maxBytes/1024/1024)}MB)`);
  if(res.body&&typeof res.body.getReader==="function"){
    const reader=res.body.getReader();
    const chunks=[];let total=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes){try{await reader.cancel();}catch(_){} throw tooBig();}
      chunks.push(value);
    }
    const buf=new Uint8Array(total);
    let off=0;
    for(const c of chunks){buf.set(c,off);off+=c.byteLength;}
    return buf;
  }
  const ab=await res.arrayBuffer();
  if(ab.byteLength>maxBytes)throw tooBig();
  return new Uint8Array(ab);
}
// Gateway AI (vd Vilao) đôi khi trả về trang HTML (lỗi gateway/bảo trì) thay vì
// JSON — res.json() lúc đó ném SyntaxError khó hiểu ("Unexpected token '<'...").
// Bắt riêng để báo rõ: kiểm tra Custom URL + thử lại sau.
function aiHtmlErrorMessage(status, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (/json/i.test(ct)) return "";
  // Chỉ kết luận "trang web" khi header nói rõ (text/html); thiếu header thì giữ
  // HTTP status chung để không đoán bừa (có gateway không gửi content-type).
  if (!/html|text\/plain/i.test(ct)) return "";
  return `HTTP ${status || "?"} — máy chủ AI trả về trang web thay vì dữ liệu. Kiểm tra lại Custom URL (Vilao phải là https://api.vilao.ai/v1) rồi thử lại sau.`;
}
async function callOpenAICompatible(apiKey, url, model, postText, promptTemplate, strictOutput=true, maxTokensOverride=null, imageDataUrl=""){
  // Chuẩn hoá URL: nếu chỉ nhập base URL (vd https://api.vilao.ai/v1) thì tự thêm /chat/completions
  if(url&&!/\/chat\/completions\s*$/i.test(url))url=url.replace(/\/+$/,"")+"/chat/completions";
  const base=(promptTemplate || t("bg.commentDefaultFull")).replaceAll("{postText}", postText.slice(0,1500)).replaceAll("{groupName}",postText.slice(0,200));
  const prompt = strictOutput?strictCommentPrompt(base):base;
  const isOpenAiNative=/^https:\/\/api\.openai\.com\//i.test(String(url||""));
  const isReasoningModel=/^(gpt-(?:5|6)|o\d)/i.test(String(model||""));
  // Reasoning models (deepseek-v4-pro, o-series, v4-pro variants) cần max_tokens lớn hơn vì dùng nhiều tokens cho thinking
  const isThinkingModel=/(?:v4-pro|v4-flash|r1|r2|think|reason|o\d[-/]|\/o\d)/i.test(String(model||""));
  const baseTokens=(maxTokensOverride&&!isThinkingModel)?maxTokensOverride:(isThinkingModel?(strictOutput?800:1200):(strictOutput?220:400));
  const imageParts=imageDataParts(imageDataUrl);
  const requestBody={
    model: model,
    messages: [{ role: "user", content: imageParts?[{type:"text",text:prompt},{type:"image_url",image_url:{url:imageDataUrl}}]:prompt }],
    stream: false
  };
  if(isOpenAiNative&&isReasoningModel){
    requestBody.max_completion_tokens=baseTokens;
  }else{
    requestBody.max_tokens=baseTokens;
    if(!isThinkingModel)requestBody.temperature=0.8;
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody)
  });
  let data={};
  try{data=await res.json();}catch{
    const htmlErr=aiHtmlErrorMessage(res.status,res.headers.get("content-type"));
    throw new Error(htmlErr||`HTTP ${res.status||"?"}`);
  }
  if(!res.ok) throw new Error(data.error?.message || JSON.stringify(data).slice(0,300));
  const content=(data.choices?.[0]?.message?.content||"").trim().replace(/^["']|["']$/g,"");
  // Fallback: nếu content rỗng mà có reasoning_content (model đã dùng hết tokens cho thinking), retry với tokens lớn hơn
  if(!content&&data.choices?.[0]?.finish_reason==="length"&&data.choices?.[0]?.message?.reasoning_content){
    const retry=await fetchWithTimeout(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey}`},body:JSON.stringify({...requestBody,max_tokens:2000,temperature:undefined})});
    let data2={};
    try{data2=await retry.json();}catch{
      const htmlErr=aiHtmlErrorMessage(retry.status,retry.headers.get("content-type"));
      throw new Error(htmlErr||`HTTP ${retry.status||"?"}`);
    }
    if(retry.ok)return (data2.choices?.[0]?.message?.content||"").trim().replace(/^["']|["']$/g,"");
  }
  return content;
}

async function callGemini(apiKey, model, postText, promptTemplate, strictOutput=true, maxTokensOverride=null, imageDataUrl=""){
  const basePrompt = (promptTemplate || t("bg.commentDefaultFull")).replace("{postText}", postText.slice(0,1500));
  const prompt=strictOutput?strictCommentPrompt(basePrompt):basePrompt.replaceAll("{groupName}",postText.slice(0,200));
  // Gemini API keys are accepted by generateContent; Interactions requires OAuth.
  const chosenModel=String(model||AI_DEFAULTS.gemini.model).trim()||AI_DEFAULTS.gemini.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`;
  let res,data;
  for(let attempt=0;attempt<3;attempt++){
    res=await fetchWithTimeout(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},body:JSON.stringify({contents:[{role:"user",parts:(()=>{const parts=[{text:prompt}];const im=imageDataParts(imageDataUrl);if(im)parts.push({inlineData:{mimeType:im.mime,data:im.data}});return parts;})()}],generationConfig:{temperature:0.8,maxOutputTokens:maxTokensOverride||(strictOutput?220:500)}})});
    try{data=await res.json();}catch{data={};}
    if(res.ok)break;
    const message=data.error?.message||(data&&Object.keys(data).length?JSON.stringify(data).slice(0,500):`HTTP ${res.status}`);
    if(res.status!==429||attempt===2){
      if(res.status===429)throw new Error(`${t("bg.quotaGemini",{model:chosenModel})} ${t("bg.detail")} ${message}`);
      throw new Error(message);
    }
    const retryText=JSON.stringify(data.error?.details||[]),match=retryText.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    const waitMs=Math.min(30000,Math.max(5000,(parseInt(match?.[1])||10)*1000));
    await new Promise(resolve=>setTimeout(resolve,waitMs));
  }
  const candidateText=(data.candidates||[]).flatMap(c=>c.content?.parts||[]).filter(p=>typeof p.text==="string").map(p=>p.text).join("\n");
  const output=String(candidateText||"").trim().replace(/^["']|["']$/g,"");
  if(!output)throw new Error("Gemini không trả về nội dung");
  return output;
}

async function callClaude(apiKey, model, postText, promptTemplate, strictOutput=true, maxTokensOverride=null, imageDataUrl=""){
  const base=(promptTemplate || t("bg.commentDefaultFull")).replaceAll("{postText}",postText.slice(0,1500)).replaceAll("{groupName}",postText.slice(0,200));
  const prompt = strictOutput?strictCommentPrompt(base):base;
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model||AI_DEFAULTS.claude.model, max_tokens:maxTokensOverride||(strictOutput?220:400), messages: [{ role: "user", content:(()=>{const im=imageDataParts(imageDataUrl);return im?[{type:"text",text:prompt},{type:"image",source:{type:"base64",media_type:im.mime,data:im.data}}]:prompt;})() }] })
  });
  let data={};
  try{data=await res.json();}catch{throw new Error(`HTTP ${res.status||"?"}`);}
  if(!res.ok) throw new Error(data.error?.message || JSON.stringify(data).slice(0,300));
  return (data.content?.[0]?.text || "").trim().replace(/^["']|["']$/g,"");
}

function normalizeSalesMedia(value){
  const raw=Array.isArray(value)?value:(value?[value]:[]);
  return raw.filter(item=>item&&typeof item==="object"&&item.dataUrl&&/^(image|video)\//i.test(String(item.type||"")));
}

async function getPageAiConfig(own={}){
  // Nếu có profileId nhưng không có key: resolve từ hệ thống profiles mới (aiProfiles).
  // Cần thiết vì saveAiProfilesState chỉ lưu vào aiProfiles, không sync sang aiKeys.
  if(!own.key&&own.profileId){
    try{
      const rp=await resolveAiProfile(own.profileId);
      if(rp&&(rp.key||rp.provider==="meta-free"))return rp;
    }catch(_){}
  }
  const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]);
  const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
  return {
    provider,
    key:normalizeApiKey(own.key||saved.key||(provider===cfg.aiProvider?cfg.aiApiKey:"")||""),
    model:own.model||saved.model||(provider===cfg.aiProvider?cfg.aiModel:"")||AI_DEFAULTS[provider]?.model||"",
    url:own.url||saved.url||(provider===cfg.aiProvider?cfg.aiCustomUrl:"")||""
  };
}
// Ngôn ngữ bài đăng theo từng Chrome profile (mỗi nick nhớ riêng): prompt nào
// chứa biến {language} thì resolve lúc chạy. Không có biến thì giữ nguyên,
// prompt custom của user không bao giờ bị sửa.
async function postLanguageSetting(){
  try{
    const s=await chrome.storage.sync.get(["postLanguage"]);
    const v=String(s.postLanguage||"").trim();
    return v||"tiếng Việt";
  }catch(_){ return "tiếng Việt"; }
}
async function withPostLanguage(prompt){
  try{
    const text=String(prompt||"");
    if(!text.includes("{language}"))return text;
    const lang=await postLanguageSetting();
    let out=text.replaceAll("{language}",lang);
    // Khung prompt xung quanh (rule/chống-bịa) viết bằng tiếng Việt nên với
    // nick ngoại ngữ phải chốt output ở cuối template — không là AI vẫn trả
    // tiếng Việt theo quán tính (bắt live: cả Meta lẫn Gemini).
    if(!/^tiếng\s*việt$/i.test(lang.trim()))out+=`\n\nYÊU CẦU BẮT BUỘC: Toàn bộ nội dung tạo ra phải viết bằng ${lang}.`;
    return out;
  }catch(_){ return String(prompt||""); }
}
function pageProfilePromptContext(profile){
  if(!profile||typeof profile!=="object")return "";
  const compact={name:profile.name||"",niche:profile.niche||profile.topic||"",products:profile.products||profile.offer||"",tone:profile.tone||profile.style||"",rules:profile.rules||profile.doNotInvent||""};
  return `HỒ SƠ PAGE: ${JSON.stringify(compact)}`;
}
function cleanPageGroupPost(raw){
  let text=guardAiPostText(raw).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join(" ");
  text=text.replace(/^(?:bài đăng|nội dung|gợi ý|post|content)\s*:\s*/i,"").replace(/^['"""]+|['"""]+$/g,"").replace(/https?:\/\/\S+/gi," ").replace(/(^|\s)#[\p{L}\p{N}_-]+/gu," ").replace(/\s+/g," ").trim();
  return truncateAtSentence(stripAiScaffolding(text),1800);
}

// ===== LỊCH CHẠY =====
// Lịch chỉ là lớp điều phối: nó giữ một snapshot cấu hình của *một* feature
// và đến giờ gọi lại đúng message Start của feature đó. Không dùng chung loop,
// selector hay bộ đếm với các state machine ở content scripts.
const SCHEDULE_STORAGE_KEY="scheduledTasks";
const SCHEDULE_ALARM_PREFIX="fb-auto-schedule:";
const SCHEDULE_CHAIN_ALARM_PREFIX="fb-auto-chain:";
function normTagCfg(tc){
  return tc&&Array.isArray(tc.entities)&&tc.entities.length?{entities:tc.entities.slice(0,1000).map(e=>({name:scheduleSafeText(e.name,180),url:scheduleSafeText(e.url,300)})).filter(e=>e.name),order:["random","round-robin"].includes(tc.order)?tc.order:"random",rate:Math.max(0,Math.min(100,parseInt(tc.rate)||70))}:null;
}
function newsSplitKeywords(s){
  return String(s||"").split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,5);
}
const SCHEDULE_CHAIN_TICK_MINUTES=0.5;
const SCHEDULE_CHAIN_MAX_STEPS=100;
const SCHEDULE_CHAIN_MAX_RECOVERIES=3;
const SCHEDULE_CHAIN_HEARTBEAT_TIMEOUT_MS=180000;
// overnight.js only proves that the document is alive. A feature can keep
// sending that heartbeat while its own counter/proof is stuck, so give the
// feature-progress watchdog a separate, longer window for slow Facebook DOM
// and AI/API work.
const SCHEDULE_CHAIN_PROGRESS_TIMEOUT_MS=600000;
const SCHEDULE_CHAIN_RETRY_MS=60000;
const SCHEDULE_CHAIN_MAX_START_RETRIES=3;
const SCHEDULE_CHAIN_MAX_START_ATTEMPTS=1+SCHEDULE_CHAIN_MAX_START_RETRIES;
const SCHEDULE_CHAIN_START_RETRY_BASE_MS=15000;
const SCHEDULE_CHAIN_START_RETRY_MAX_MS=300000;
// Khi service worker vừa thức dậy đúng lúc alarm đến hạn, onAlarm và
// restoreScheduleAlarms() có thể chạy cạnh nhau. Cho phép alarm được dựng
// lại trong một cửa sổ rất ngắn để không biến race này thành lịch thất bại;
// lịch quá hạn thật sự vẫn bị đánh dấu failed bên dưới.
const SCHEDULE_RESTORE_GRACE_MS=15000;
const SCHEDULE_ACTIVE_KEYS=["isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","friendWarmActive","isScraping","isFeedInteracting","feedBantinActive","feedFriendsActive","feedGroupsActive","feedPagesActive","isAICommenting","groupInteractActive","groupCommentActive","groupPostActive","isGroupJoining","isDiscoverJoining","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","newsWallActive","pageGroupJoinActive","pageGroupPostActive","pageNewsWallActive","pageCommentActive","pageSalesPostActive","pageGroupCommentActive","friendReengageActive","fbStoryActive","fbReelsActive"];
const SCHEDULE_FEATURES=new Set(["friend","scrape","feed","aiFeed","groupInteract","groupComment","groupPost","keyword","discover","share","sales","trendLearn","trendPost","newsWall","pageGroupJoin","pageGroupPost","pageNewsWall","pageComment","pageSales","pageGroupComment","friendReengage","fbStory","fbReels"]);
const SCHEDULE_ACTIVE_BY_FEATURE={friend:"isRunning",scrape:"isScraping",aiFeed:"isAICommenting",groupInteract:"groupInteractActive",groupComment:"groupCommentActive",groupPost:"groupPostActive",keyword:"isGroupJoining",discover:"isDiscoverJoining",share:"groupShareActive",sales:"salesPostActive",trendLearn:"trendLearnActive",trendPost:"trendPostActive",newsWall:"newsWallActive",pageGroupJoin:"pageGroupJoinActive",pageGroupPost:"pageGroupPostActive",pageNewsWall:"pageNewsWallActive",pageComment:"pageCommentActive",pageSales:"pageSalesPostActive",pageGroupComment:"pageGroupCommentActive",friendReengage:"friendReengageActive",fbStory:"fbStoryActive",fbReels:"fbReelsActive"};
const SCHEDULE_GROUP_COLORS=["pink","green","red","orange","yellow","blue","purple","burgundy","beige","brown","gray","black"];
const scheduleAlarmName=id=>SCHEDULE_ALARM_PREFIX+id;
const scheduleChainAlarmName=id=>SCHEDULE_CHAIN_ALARM_PREFIX+id;
const scheduleSafeText=(value,max=1000)=>String(value||"").trim().slice(0,Math.max(1,Number(max)||1000));
const scheduleConfirmWaitSeconds=value=>{
  const parsed=Number.parseInt(value,10);
  const seconds=Number.isFinite(parsed)?parsed:90;
  return Math.min(3600,Math.max(5,seconds));
};
function scheduleFacebookUrl(value,allowFbWatch=false){
  const raw=String(value||"").trim();
  let url;
  try{url=new URL(raw); }catch{throw new Error("URL Facebook trong lịch không hợp lệ");}
  const host=String(url.hostname||"").toLowerCase().replace(/\.$/,"");
  const facebook=host==="facebook.com"||host.endsWith(".facebook.com");
  if(!facebook&&!(allowFbWatch&&host==="fb.watch"))throw new Error("Lịch chỉ nhận URL Facebook");
  if(!/^https?:$/.test(url.protocol))throw new Error("URL Facebook trong lịch không hợp lệ");
  url.hash="";
  return url.toString();
}
function scheduleUrlKey(value){
  try{
    const url=new URL(String(value||""));
    const host=String(url.hostname||"").toLowerCase().replace(/^www\./,"");
    return `${host}${url.pathname.replace(/\/+$/g,"").toLowerCase()}`;
  }catch{return String(value||"").split(/[?#]/)[0].replace(/\/+$/g,"").toLowerCase();}
}
function normalizeScheduleGroup(raw={}){
  const url=scheduleFacebookUrl(raw.url||`https://www.facebook.com/groups/${raw.id||""}/`);
  let parsed;
  try{parsed=new URL(url);}catch{throw new Error("Nhóm trong lịch không hợp lệ");}
  const match=parsed.pathname.match(/^\/groups\/([^/?#]+)/i);
  if(!match)throw new Error("Nhóm trong lịch không hợp lệ");
  const id=String(raw.id||decodeURIComponent(match[1])||"").trim();
  if(!id)throw new Error("Nhóm trong lịch không hợp lệ");
  const out={id,name:scheduleSafeText(raw.name||id,180),url:`https://www.facebook.com/groups/${encodeURIComponent(id)}/`,manualLink:!!raw.manualLink,explicitName:!!raw.explicitName};
  const wh=parseInt(raw.windowHours);
  if(wh===24||wh===48)out.windowHours=wh;
  if(raw.groupType==="knowledge"||raw.groupType==="market")out.groupType=raw.groupType;
  if(raw.webSearch===true)out.webSearch=true;
  return out;
}
function normalizeScheduleAutoGroup(raw={}){
  const auto=raw&&typeof raw.auto==="object"?raw.auto:null;
  if(!auto)throw new Error("Nhóm tự động trong lịch không hợp lệ");
  const source=String(auto.source||"");
  if(!["pageRegistry","joinedLog","nickGroups"].includes(source))throw new Error("Nguồn nhóm tự động trong lịch không hợp lệ");
  const pageKey=scheduleSafeText(auto.pageKey,120);
  if(source==="pageRegistry"&&!pageKey)throw new Error("Thiếu Page cho nguồn nhóm tự động");
  return {auto:{source,pageKey,keyword:scheduleSafeText(auto.keyword,180),limit:Math.min(100000,Math.max(1,parseInt(auto.limit)||50))}};
}
function normalizeScheduleGroups(value,required=true){
  const groups=[];
  for(const raw of Array.isArray(value)?value:[]){
    if(raw&&typeof raw.auto==="object"){
      try{const marker=normalizeScheduleAutoGroup(raw);if(!groups.some(item=>item.auto&&item.auto.source===marker.auto.source&&item.auto.pageKey===marker.auto.pageKey&&item.auto.keyword===marker.auto.keyword))groups.push(marker);}catch{}
      continue;
    }
    try{const group=normalizeScheduleGroup(raw);if(!groups.some(item=>item.id===group.id))groups.push(group);}catch{}
  }
  if(required&&!groups.length)throw new Error("Cần chọn ít nhất một nhóm trước khi hẹn lịch");
  return groups.slice(0,100000);
}
// Nhóm "tự động" (auto marker) được chốt thành danh sách thật lúc BƯỚC CHẠY,
// không phải lúc tạo lịch — nhóm mới join giữa chừng vẫn được dùng. Gọi trong
// launchScheduledTask nên áp dụng cho cả lịch đơn lẫn từng bước chain.
async function resolveScheduledAutoGroups(feature,config={}){
  const groups=Array.isArray(config.groups)?config.groups:[];
  if(!groups.some(g=>g&&typeof g.auto==="object"))return config;
  const concrete=groups.filter(g=>!(g&&typeof g.auto==="object"));
  const resolved=[];
  for(const g of groups){
    if(!(g&&typeof g.auto==="object"))continue;
    const auto=g.auto;
    const limit=Math.min(100000,Math.max(1,parseInt(auto.limit)||50));
    try{
      if(auto.source==="pageRegistry"){
        const saved=await chrome.storage.local.get(`pageJoinedGroups_${auto.pageKey}`);
        const reg=Array.isArray(saved[`pageJoinedGroups_${auto.pageKey}`])?saved[`pageJoinedGroups_${auto.pageKey}`]:[];
        const items=[...reg].reverse().filter(e=>e&&(e.id||e.key));
        for(const e of items){
          const id=String(e.id||e.key||"").trim();if(!id)continue;
          const url=e.url||`https://www.facebook.com/groups/${encodeURIComponent(id)}/`;
          resolved.push({id,name:scheduleSafeText(e.name||id,180),url,manualLink:false,explicitName:!!e.name});
          if(resolved.length>=limit)break;
        }
      }else{
        const saved=await chrome.storage.local.get(["joinedGroupsLog","joinedGroups"]);
        const log=Array.isArray(saved.joinedGroupsLog)?saved.joinedGroupsLog:[];
        const scan=Array.isArray(saved.joinedGroups)?saved.joinedGroups:[];
        const kw=String(auto.keyword||"").toLowerCase();
        const pool=[];
        for(const e of [...log].reverse()){
          if(!e||!e.id)continue;
          if(auto.source==="joinedLog"&&kw&&String(e.keyword||"").toLowerCase()!==kw)continue;
          pool.push(e);
        }
        if(auto.source==="nickGroups"){
          for(const e of scan){
            if(!e||!e.id)continue;
            pool.push(e);
          }
        }
        for(const e of pool){
          const id=String(e.id||"").trim();if(!id)continue;
          if(resolved.some(r=>r.id===id)||concrete.some(c=>c.id===id))continue;
          const url=e.url||`https://www.facebook.com/groups/${encodeURIComponent(id)}/`;
          resolved.push({id,name:scheduleSafeText(e.name||id,180),url,manualLink:false,explicitName:!!e.name});
          if(resolved.length>=limit)break;
        }
      }
    }catch{}
  }
  const merged=[...concrete];
  for(const r of resolved){if(!merged.some(m=>m.id===r.id))merged.push(r);}
  const required=!(feature==="friend"&&config.mode!=="group-common");
  if(required&&!merged.length)throw new Error("Không còn nhóm nào trong danh sách tự động lúc chạy (chưa join nhóm nào hoặc đã rời hết)");
  return {...config,groups:merged.slice(0,500)};
}
function normalizeSchedulePage(raw={}){
  const url=scheduleFacebookUrl(raw.url);
  return {id:scheduleSafeText(raw.id||"",180),name:scheduleSafeText(raw.name||"Trang Facebook",180),url};
}
function normalizeSchedulePages(value){
  const pages=[];
  for(const raw of Array.isArray(value)?value:[]){
    try{const page=normalizeSchedulePage(raw);if(!pages.some(item=>scheduleUrlKey(item.url)===scheduleUrlKey(page.url)))pages.push(page);}catch{}
  }
  return pages.slice(0,1000);
}
function normalizeScheduleBackground(raw={}){
  const colors=(Array.isArray(raw.colors)?raw.colors:[]).filter(color=>SCHEDULE_GROUP_COLORS.includes(color));
  return {enabled:!!raw.enabled,mode:raw.mode==="fixed"?"fixed":"random",fixedColor:SCHEDULE_GROUP_COLORS.includes(raw.fixedColor)?raw.fixedColor:"pink",colors:colors.length?[...new Set(colors)]:SCHEDULE_GROUP_COLORS,maxChars:Math.min(130,Math.max(40,parseInt(raw.maxChars)||100)),fallback:"skip"};
}
function normalizeScheduleSalesMedia(raw){
  if(!raw||typeof raw!=="object")return null;
  const plan=Array.isArray(raw.plan)?raw.plan.slice(0,500).map(row=>Array.isArray(row)?row.map(value=>Math.max(0,parseInt(value)||0)).slice(0,20):[]):[];
  const manifest=Array.isArray(raw.manifest)?raw.manifest.slice(0,20).map(item=>({name:scheduleSafeText(item?.name||"media",180),type:scheduleSafeText(item?.type||"",80),size:Math.max(0,Number(item?.size)||0)})):[];
  return {enabled:!!raw.enabled,required:!!raw.required,count:Math.max(0,Math.min(100000,parseInt(raw.count)||0)),random:!!raw.random,perGroup:Math.max(1,Math.min(100000,parseInt(raw.perGroup)||1)),plan,manifest};
}
function scheduleSalesMediaPerGroup(raw){
  const n=parseInt(raw?.perGroup ?? raw?.mediaCount,10);
  if(!Number.isFinite(n))return 1;
  return Math.max(1,Math.min(20,n));
}
function scheduleDefaultLabel(feature){
  return ({friend:"Kết bạn",scrape:"Cào bài",feed:"Tương tác bản tin",aiFeed:"Comment AI bản tin",groupInteract:"Like/Random trong nhóm",groupComment:"Comment AI trong nhóm",groupPost:"Đăng bài AI lên nhóm",keyword:"Tham gia nhóm từ khóa",discover:"Tham gia nhóm khám phá",share:"Share bài vào nhóm",sales:"Đăng bài bán hàng",trendLearn:"Học bài theo Trend",trendPost:"Đăng bài Trend",pageGroupJoin:"Page tham gia nhóm",pageGroupPost:"Page đăng bài nhóm",pageNewsWall:"Page đăng tin tức",pageComment:"Page Comment AI",pageSales:"Đăng bán bằng Page",pageGroupComment:"Comment nhóm bằng Page"}[feature]||feature);
}
function scheduleRestoreDecision(runAt,now=Date.now()){
  const when=Number(runAt);
  if(!Number.isFinite(when))return {kind:"invalid"};
  if(when<=now){
    if(now-when<=SCHEDULE_RESTORE_GRACE_MS)return {kind:"rearm",when:now+1000};
    return {kind:"expired"};
  }
  return {kind:"rearm",when};
}
function scheduleId(){return "sch_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);}
async function scheduledTasks(){
  const saved=await chrome.storage.local.get(SCHEDULE_STORAGE_KEY);
  return Array.isArray(saved[SCHEDULE_STORAGE_KEY])?saved[SCHEDULE_STORAGE_KEY]:[];
}
async function saveScheduledTasks(tasks){await chrome.storage.local.set({[SCHEDULE_STORAGE_KEY]:tasks});}
async function setScheduledTask(id,change){
  const tasks=await scheduledTasks(),index=tasks.findIndex(task=>task.id===id);
  if(index<0)return null;
  tasks[index]={...tasks[index],...change};
  await saveScheduledTasks(tasks);
  return tasks[index];
}
function normalizeScheduledTask(raw={}){
  const feature=SCHEDULE_FEATURES.has(raw.feature)?raw.feature:"";
  const runAt=Number(raw.runAt);
  if(!feature)throw new Error("Tính năng hẹn giờ chưa được hỗ trợ");
  if(!Number.isFinite(runAt)||runAt<Date.now()+25000)throw new Error("Thời điểm chạy phải sau hiện tại ít nhất 30 giây");
  const config=raw.config&&typeof raw.config==="object"?raw.config:{};
  let normalized;
  if(feature==="keyword"){
    if(!scheduleSafeText(config.keyword))throw new Error("Cần nhập từ khóa trước khi hẹn lịch");
    normalized={keyword:scheduleSafeText(config.keyword,180),minMembers:Math.max(0,parseInt(config.minMembers)||0),minPostsPerDay:Math.max(0,parseInt(config.minPostsPerDay)||0),targetJoin:Math.max(1,parseInt(config.targetJoin)||10),minDelay:Math.max(1,parseInt(config.minDelay)||5),maxDelay:Math.max(1,parseInt(config.maxDelay)||15),confirmWaitSeconds:scheduleConfirmWaitSeconds(config.confirmWaitSeconds),answersText:scheduleSafeText(config.answersText,4000),aiJoinEnabled:!!config.aiJoinEnabled,aiJoinPrompt:scheduleSafeText(config.aiJoinPrompt,4000),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
  }else if(feature==="discover"){
    normalized={target:Math.max(1,parseInt(config.target)||10),minDelay:Math.max(1,parseInt(config.minDelay)||5),maxDelay:Math.max(1,parseInt(config.maxDelay)||15),confirmWaitSeconds:scheduleConfirmWaitSeconds(config.confirmWaitSeconds),answersText:scheduleSafeText(config.answersText,4000),aiJoinEnabled:!!config.aiJoinEnabled,aiJoinPrompt:scheduleSafeText(config.aiJoinPrompt,4000),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
  }else if(feature==="friend"){
    if(config.mode==="friend-of-friend"){
      const src=(config.source&&typeof config.source==="object")?config.source:{};
      const surl=String(src.url||"").trim();
      if(!/^https?:\/\/(www\.)?facebook\.com\//i.test(surl))throw new Error(t("p.frFoFNeedLink"));
      normalized={mode:"friend-of-friend",source:{url:surl.slice(0,300)},minDelay:Math.max(1000,parseInt(config.minDelay)||5000),maxDelay:Math.max(1000,parseInt(config.maxDelay)||15000),maxRequests:Math.max(1,Math.min(100000,parseInt(config.maxRequests)||20)),minMutual:Math.max(0,Math.min(100000,parseInt(config.minMutual)||0))};
    }else{
    const mode=["suggestions","group-common","confirm"].includes(config.mode)?config.mode:"suggestions";
    normalized={mode,minDelay:Math.max(1000,parseInt(config.minDelay)||5000),maxDelay:Math.max(1000,parseInt(config.maxDelay)||15000),maxRequests:Math.max(1,Math.min(100000,parseInt(config.maxRequests)||20)),minMutual:Math.max(0,parseInt(config.minMutual)||0),groups:normalizeScheduleGroups(config.groups,mode==="group-common"),confirmFilters:{minMutual:Math.max(0,Math.min(100000,parseInt(config.confirmFilters?.minMutual)||0))}};
    }
  }else if(feature==="scrape"){
    normalized={count:Math.max(1,Math.min(100000,parseInt(config.count)||200)),skipAds:config.skipAds!==false,sourceUrl:scheduleFacebookUrl(config.sourceUrl)};
  }else if(feature==="feed"){
    const source=["bantin","friends","groups","pages"].includes(String(config.source||""))?String(config.source):"friends";
    const actionMode=["like","comment","both"].includes(String(config.actionMode||""))?String(config.actionMode):(config.aiEnabled?"both":"like");
    normalized={source,actionMode,reaction:scheduleSafeText(config.reaction||"random",40)||"random",target:Math.max(1,Math.min(100000,parseInt(config.target)||20)),minDelay:Math.max(1,parseInt(config.minDelay)||3),maxDelay:Math.max(1,parseInt(config.maxDelay)||8),aiEnabled:actionMode!=="like",aiPrompt:scheduleSafeText(config.aiPrompt,4000),aiTagPrompt:scheduleSafeText(config.aiTagPrompt,4000),tagConfig:normTagCfg(config.tagConfig),aiTarget:Math.max(1,Math.min(100000,parseInt(config.aiTarget)||5)),aiEconomyMode:config.aiEconomyMode==="max"?"max":"personal",aiCacheDays:Math.max(0,Math.min(3650,parseInt(config.aiCacheDays)||7)),aiStyleProfileId:scheduleSafeText(config.aiStyleProfileId,180),aiTypingConfig:config.aiTypingConfig?normalizeAiTypingConfig(config.aiTypingConfig):undefined};
    if(normalized.aiEnabled&&!normalized.aiPrompt.includes("{postText}"))throw new Error("Prompt Comment AI phải có {postText}");
  }else if(feature==="aiFeed"){
    normalized={mode:config.mode==="comment-like"?"comment-like":"comment",target:Math.max(1,Math.min(100000,parseInt(config.target)||10)),minDelay:Math.max(1,parseInt(config.minDelay)||10),maxDelay:Math.max(1,parseInt(config.maxDelay)||20),economyMode:scheduleSafeText(config.economyMode||"balanced",30)||"balanced",batchSize:Math.max(2,Math.min(1000,parseInt(config.batchSize)||5)),cacheDays:Math.max(0,parseInt(config.cacheDays)||7),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
  }else if(feature==="groupInteract"||feature==="groupComment"){
    normalized={groups:normalizeScheduleGroups(config.groups),perGroup:Math.max(1,Math.min(100000,parseInt(config.perGroup)||5)),minDelay:Math.max(1,parseInt(config.minDelay)||5),maxDelay:Math.max(1,parseInt(config.maxDelay)||12),reaction:scheduleSafeText(config.reaction||"random",40)||"random",targetGroups:Math.max(1,Math.min(100000,parseInt(config.targetGroups)||1)),typingConfig:feature==="groupComment"&&config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined,prompt:feature==="groupComment"?scheduleSafeText(config.prompt,4000):"",tagPrompt:feature==="groupComment"?scheduleSafeText(config.tagPrompt,4000):"",tagConfig:feature==="groupComment"?(normTagCfg(config.tagConfig)):null,aiConfig:feature==="groupComment"&&config.aiConfig&&typeof config.aiConfig==="object"?{provider:scheduleSafeText(config.aiConfig.provider,100),model:scheduleSafeText(config.aiConfig.model,100),url:scheduleSafeText(config.aiConfig.url,300)}:undefined};
  }else if(feature==="groupPost"){
    const gpSrc=(config.source&&typeof config.source==="object")?config.source:{};
    const gpType=String(gpSrc.type||"");
    const gpSource=gpType==="x"
      ?{type:"x",users:(Array.isArray(gpSrc.users)?gpSrc.users:[]).map(u=>String(u||"").replace(/^@/,"").trim()).filter(u=>/^[A-Za-z0-9_]{1,15}$/.test(u)).slice(0,1000)}
      :gpType==="sites"
        ?{type:"sites",urls:(Array.isArray(gpSrc.urls)?gpSrc.urls:[]).map(u=>scheduleSafeText(u,500)).filter(u=>/^https?:\/\//i.test(u)).slice(0,100),q:scheduleSafeText(gpSrc.q,180),hours:Math.min(720,Math.max(0,parseInt(gpSrc.hours)||0))}
        :gpType==="fb"
          ?{type:"fb",urls:(Array.isArray(gpSrc.urls)?gpSrc.urls:[]).map(u=>scheduleSafeText(u,500)).filter(u=>/^https?:\/\/(?:www\.|m\.)?facebook\.com\//i.test(u)).slice(0,100),hours:Math.min(720,Math.max(0,parseInt(gpSrc.hours)||0)),mode:["rewrite","rewrite_original","opinion_screenshot"].includes(gpSrc.mode)?gpSrc.mode:"rewrite",backgroundOnly:gpSrc.backgroundOnly===true,includeComment:gpSrc.includeComment!==false}
          :null;
    if(gpSource?.type==="sites"){
      if(!gpSource.urls.length)throw new Error("Cần ít nhất 1 link RSS web trước khi hẹn lịch");
      if(!newsSplitKeywords(gpSource.q).length)throw new Error("Cần nhập từ khóa tin tức trước khi hẹn lịch");
    }
    if(gpSource?.type==="fb"&&!gpSource.urls.length)throw new Error("Cần ít nhất 1 link Page/Profile Facebook trước khi hẹn lịch");
    normalized={groups:normalizeScheduleGroups(config.groups),prompt:scheduleSafeText(config.prompt,4000),minDelay:Math.max(5,parseInt(config.minDelay)||25),maxDelay:Math.max(5,parseInt(config.maxDelay)||45),interGroupDelay:Math.min(604800,Math.max(5,parseInt(config.interGroupDelay)||30)),background:normalizeScheduleBackground(config.background),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined,ctxEnabled:config.ctxEnabled!==false,ctxMode:config.ctxMode==="deep"?"deep":"saving",minLen:Math.min(1000,Math.max(30,parseInt(config.minLen)||200)),source:gpSource,xPrompt:scheduleSafeText(config.xPrompt,4000),withXPhoto:config.withXPhoto!==false,xHours:Math.min(100000,Math.max(0,parseInt(config.xHours)||0)),webPrompt:scheduleSafeText(config.webPrompt,4000),withWebPhoto:config.withWebPhoto!==false,fbPrompt:scheduleSafeText(config.fbPrompt,4000)};
  }else if(feature==="share"){
    normalized={sourceUrl:scheduleFacebookUrl(config.sourceUrl,true),groups:normalizeScheduleGroups(config.groups),prompt:scheduleSafeText(config.prompt,4000),interGroupDelay:Math.min(604800,Math.max(5,parseInt(config.interGroupDelay)||30)),manualSourceText:scheduleSafeText(config.manualSourceText,6000),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
  }else if(feature==="sales"){
    // Lịch theo từng sản phẩm: snapshot mang products[] (id/name/sourceText/
    // productInfo/prompt + manifest media, KHÔNG kèm dataUrl/API key); media
    // thật được đọc từ salesProductsMedia lúc lịch chạy qua salesGetProductMedia.
    const schedSalesProducts=(Array.isArray(config.products)?config.products:[]).map(p=>({id:scheduleSafeText(p.id,120),name:scheduleSafeText(p.name,180),sourceText:scheduleSafeText(p.sourceText,6000),productInfo:scheduleSafeText(p.productInfo,3000),prompt:scheduleSafeText(p.prompt,4000),media:p.media&&typeof p.media==="object"?{enabled:!!p.media.enabled,count:Math.max(0,parseInt(p.media.count)||0),mode:p.media.mode==="all"?"all":"random",perGroup:scheduleSalesMediaPerGroup(p.media),skip:!!p.media.skip}:{enabled:false,count:0,mode:"random",perGroup:1,skip:false}})).filter(p=>p.sourceText);
    normalized={groups:normalizeScheduleGroups(config.groups),products:schedSalesProducts,postsPerGroup:Math.max(1,Math.min(100000,parseInt(config.postsPerGroup)||1)),minDelay:Math.min(604800,Math.max(5,parseInt(config.minDelay)||30)),maxDelay:Math.min(604800,Math.max(parseInt(config.minDelay)||30,parseInt(config.maxDelay)||60)),sourceText:scheduleSafeText(config.sourceText,6000),productInfo:scheduleSafeText(config.productInfo,3000),prompt:scheduleSafeText(config.prompt,4000),interGroupDelay:Math.min(604800,Math.max(5,parseInt(config.interGroupDelay)||45)),styleProfileId:scheduleSafeText(config.styleProfileId,180),acceptedChatPosts:(Array.isArray(config.acceptedChatPosts)?config.acceptedChatPosts:[]).map(value=>scheduleSafeText(value,2000)).filter(Boolean).slice(0,500),media:normalizeScheduleSalesMedia(config.media),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
    if(!normalized.products.length&&!normalized.sourceText)throw new Error("Cần nhập thông tin sản phẩm trước khi hẹn lịch");
  }else if(feature==="trendLearn"){
    normalized={groups:normalizeScheduleGroups(config.groups),perGroup:Math.max(0,Math.min(100000,parseInt(config.perGroup)||0)),unlimited:config.unlimited!==false};
  }else if(feature==="trendPost"){
    const groups=normalizeScheduleGroups(config.groups),jobs=(Array.isArray(config.jobs)?config.jobs:[]).map(job=>{let group;try{group=normalizeScheduleGroup(job?.group||{});}catch{return null;}return {group,groupIndex:Math.max(0,parseInt(job.groupIndex)||0),postIndex:Math.max(0,parseInt(job.postIndex)||0),groupPostTotal:Math.max(1,parseInt(job.groupPostTotal)||1),sourcePostIds:(Array.isArray(job.sourcePostIds)?job.sourcePostIds:[]).map(value=>scheduleSafeText(value,300)).filter(Boolean).slice(0,20),sourceText:scheduleSafeText(job.sourceText,1200),draft:scheduleSafeText(job.draft,2000),variant:Math.max(1,parseInt(job.variant)||1)};}).filter(Boolean);
    if(!jobs.length)throw new Error("Cần có bài đã học và nhóm đích trước khi hẹn lịch Trend");
    normalized={groups,jobs,drafts:(Array.isArray(config.drafts)?config.drafts:[]).map(value=>scheduleSafeText(value,2000)).slice(0,500),sourceText:scheduleSafeText(config.sourceText,6000),sourcePostIds:(Array.isArray(config.sourcePostIds)?config.sourcePostIds:[]).map(value=>scheduleSafeText(value,300)).filter(Boolean).slice(0,500),sourceMode:config.sourceMode==="sequential"?"sequential":"selected",distribution:scheduleSafeText(config.distribution||"auto",40)||"auto",postsPerGroup:Math.max(1,Math.min(100000,parseInt(config.postsPerGroup)||1)),postDelay:Math.min(604800,Math.max(5,parseInt(config.postDelay)||30)),prompt:scheduleSafeText(config.prompt,4000),styleProfileId:scheduleSafeText(config.styleProfileId,180),interDelay:Math.min(604800,Math.max(5,parseInt(config.interDelay)||30)),anonymousMode:config.anonymousMode!==false,background:normalizeScheduleBackground(config.background),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
  }else if(feature==="newsWall"){
    const src=(config.source&&typeof config.source==="object")?config.source:{};
    const st=String(src.type||"google");
    const source={type:["google","vnexpress","url","xread","sites","fb"].includes(st)?st:"google",q:scheduleSafeText(src.q||"",120),category:scheduleSafeText(src.category||"",80),url:scheduleSafeText(src.url||"",500),hours:Math.min(720,Math.max(0,parseInt(src.hours)||0)),users:Array.isArray(src.users)?src.users.map(u=>String(u||"").replace(/^@/,"").trim()).filter(u=>/^[A-Za-z0-9_]{1,15}$/.test(u)).slice(0,1000):[],urls:Array.isArray(src.urls)?src.urls.map(u=>scheduleSafeText(u,500)).filter(u=>/^https?:\/\//i.test(u)).slice(0,100):[],mode:["rewrite","rewrite_original","opinion_screenshot"].includes(src.mode)?src.mode:"rewrite",backgroundOnly:src.backgroundOnly===true,includeComment:src.includeComment!==false};
    if(source.type==="google"&&!newsSplitKeywords(source.q).length)throw new Error("Cần nhập chủ đề tin tức trước khi hẹn lịch");
    if(source.type==="url"&&!/^https?:\/\//i.test(source.url))throw new Error("Cần link RSS hợp lệ trước khi hẹn lịch");
    if(source.type==="sites"&&!source.urls.length)throw new Error("Cần ít nhất 1 link RSS web trước khi hẹn lịch");
    if(source.type==="sites"&&!newsSplitKeywords(source.q).length)throw new Error("Cần nhập từ khóa tin tức trước khi hẹn lịch");
    if(source.type==="fb"&&!source.urls.length)throw new Error("Cần ít nhất 1 link Page/Profile Facebook trước khi hẹn lịch");
    const mode=["bg","photo","text"].includes(config.mode)?config.mode:"bg";
    normalized={source,topic:scheduleSafeText(config.topic,120),mode,kind:["bg","photo","text"].includes(config.kind)?config.kind:mode,count:Math.max(1,Math.min(100000,parseInt(config.count)||1)),interDelay:Math.min(604800,Math.max(0,parseInt(config.interDelay)||60)),minDelay:Math.min(604800,Math.max(0,parseInt(config.minDelay)||15)),maxDelay:Math.min(604800,Math.max(0,parseInt(config.maxDelay)||15)),maxChars:Math.min(500,Math.max(40,parseInt(config.maxChars)||130)),prompt:scheduleSafeText(config.prompt,4000),withImage:config.withImage!==false,hours:Math.min(720,Math.max(0,parseInt(config.hours)||0)),styleProfileId:scheduleSafeText(config.styleProfileId,180),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined,publishMode:config.publishMode==="fbSchedule"?"fbSchedule":"now",fbScheduleAt:Math.max(0,parseInt(config.fbScheduleAt)||0),fbScheduleGap:Math.min(10080,Math.max(5,parseInt(config.fbScheduleGap)||30))};
  }else if(feature==="pageGroupJoin"){
    normalized={page:normalizeSchedulePage(config.page),mode:config.mode==="discover"?"discover":"keyword",keyword:scheduleSafeText(config.keyword,180),target:Math.max(1,Math.min(100000,parseInt(config.target)||10)),minDelay:Math.max(5,Math.min(604800,parseInt(config.minDelay)||15)),maxDelay:Math.max(5,Math.min(604800,parseInt(config.maxDelay)||30)),answers:Array.isArray(config.answers)?config.answers.map(value=>scheduleSafeText(value,500)).filter(Boolean).slice(0,1000):[],aiEnabled:!!config.aiEnabled,aiPrompt:scheduleSafeText(config.aiPrompt,4000)};
    if(normalized.mode==="keyword"&&!normalized.keyword)throw new Error("Cần nhập từ khóa Page trước khi hẹn lịch");
  }else if(feature==="pageGroupPost"){
    normalized={page:normalizeSchedulePage(config.page),groups:normalizeScheduleGroups(config.groups),target:Math.max(1,Math.min(100000,parseInt(config.target)||1)),minDelay:Math.max(5,Math.min(604800,parseInt(config.minDelay)||30)),maxDelay:Math.max(5,Math.min(604800,parseInt(config.maxDelay)||60)),prompt:scheduleSafeText(config.prompt,4000)};
    if(!normalized.prompt.includes("{groupName}"))throw new Error("Prompt đăng bài Page phải có {groupName}");
  }else if(feature==="pageNewsWall"){
    const src=(config.source&&typeof config.source==="object")?config.source:{};
    const type=src.type==="url"?"url":"xread";
    const source=type==="url"
      ?{type,url:scheduleSafeText(src.url,500)}
      :{type,users:Array.isArray(src.users)?src.users.map(u=>String(u||"").replace(/^@/,"").trim()).filter(u=>/^[A-Za-z0-9_]{1,15}$/.test(u)).slice(0,1000):[]};
    if(type==="url"&&!/^https?:\/\//i.test(source.url))throw new Error("Cần link báo hoặc RSS hợp lệ trước khi hẹn lịch");
    if(type==="xread"&&!source.users.length)throw new Error("Cần ít nhất một user X trước khi hẹn lịch");
    normalized={page:normalizeSchedulePage(config.page),source,topic:scheduleSafeText(config.topic,180),count:Math.max(1,Math.min(100000,parseInt(config.count)||1)),interDelay:Math.min(604800,Math.max(0,parseInt(config.interDelay)||30)),withImage:config.withImage!==false,prompt:scheduleSafeText(config.prompt,4000),styleProfileId:scheduleSafeText(config.styleProfileId,180),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
    if(!normalized.prompt.includes("{newsText}"))throw new Error("Prompt đăng tin Page phải có {newsText}");
  }else if(feature==="pageSales"){
    const schedPageSalesProducts=(Array.isArray(config.products)?config.products:[]).map(p=>({id:scheduleSafeText(p.id,120),name:scheduleSafeText(p.name,180),sourceText:scheduleSafeText(p.sourceText,6000),productInfo:scheduleSafeText(p.productInfo,3000),prompt:scheduleSafeText(p.prompt,4000),media:p.media&&typeof p.media==="object"?{enabled:!!p.media.enabled,count:Math.max(0,parseInt(p.media.count)||0),mode:p.media.mode==="all"?"all":"random",perGroup:scheduleSalesMediaPerGroup(p.media),skip:!!p.media.skip}:{enabled:false,count:0,mode:"random",perGroup:1,skip:false}})).filter(p=>p.sourceText);
    const _psMediaKey=/^pageSalesProductsMedia_[A-Za-z0-9_\-]+$/.test(String(config.mediaKey||""))?String(config.mediaKey):"";
    normalized={page:normalizeSchedulePage(config.page),groups:normalizeScheduleGroups(config.groups),products:schedPageSalesProducts,postsPerGroup:Math.max(1,Math.min(100000,parseInt(config.postsPerGroup)||1)),minDelay:Math.min(604800,Math.max(5,parseInt(config.minDelay)||30)),maxDelay:Math.min(604800,Math.max(parseInt(config.minDelay)||30,parseInt(config.maxDelay)||60)),prompt:scheduleSafeText(config.prompt,4000),styleProfileId:scheduleSafeText(config.styleProfileId,180),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined,mediaKey:_psMediaKey};
    if(!normalized.products.length)throw new Error("Cần chọn ít nhất một sản phẩm của Page trước khi hẹn lịch");
    if(!normalized.prompt.includes("{groupName}")||!normalized.prompt.includes("{sourceText}")||!normalized.prompt.includes("{productInfo}"))throw new Error("Prompt đăng bán Page phải có {groupName}, {sourceText} và {productInfo}");
  }else if(feature==="pageGroupComment"){
    normalized={page:normalizeSchedulePage(config.page),groups:normalizeScheduleGroups(config.groups),perGroup:Math.max(1,Math.min(100000,parseInt(config.perGroup)||3)),targetGroups:Math.max(1,Math.min(100000,parseInt(config.targetGroups)||parseInt(config.target)||(Array.isArray(config.groups)?config.groups.length:1))),minDelay:Math.max(5,Math.min(604800,parseInt(config.minDelay)||20)),maxDelay:Math.max(5,Math.min(604800,parseInt(config.maxDelay)||45)),prompt:scheduleSafeText(config.prompt,4000),tagPrompt:scheduleSafeText(config.tagPrompt,4000),tagConfig:normTagCfg(config.tagConfig),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
    if(!normalized.prompt.includes("{postText}"))throw new Error("Prompt Comment nhóm Page phải có {postText}");
  }else if(feature==="pageComment"){
    const source=["feed","groups","pages"].includes(String(config.source||""))?String(config.source):"feed";
    normalized={page:normalizeSchedulePage(config.page),source,groups:normalizeScheduleGroups(config.groups),pages:[],target:Math.max(1,Math.min(100000,parseInt(config.target)||10)),minDelay:Math.max(5,Math.min(604800,parseInt(config.minDelay)||20)),maxDelay:Math.max(5,Math.min(604800,parseInt(config.maxDelay)||45)),prompt:scheduleSafeText(config.prompt,4000),tagPrompt:scheduleSafeText(config.tagPrompt,4000),tagConfig:normTagCfg(config.tagConfig),typingConfig:config.typingConfig?normalizeAiTypingConfig(config.typingConfig):undefined};
  }else if(feature==="friendReengage"){
    const mode=["like","comment","both","story"].includes(String(config.mode||""))?String(config.mode):"like";
    normalized={mode,likePerDay:Math.min(100000,Math.max(1,parseInt(config.likePerDay)||25)),likePerFriend:Math.max(1,Math.min(100000,parseInt(config.likePerFriend)||2)),commentPerDay:Math.min(100000,Math.max(1,parseInt(config.commentPerDay)||12)),commentPerFriend:Math.max(1,Math.min(100000,parseInt(config.commentPerFriend)||1)),likeSource:scheduleSafeText(config.likeSource,40)||"new",commentSource:scheduleSafeText(config.commentSource,40)||"liked",recentDays:Math.max(1,Math.min(36500,parseInt(config.recentDays)||14)),deadDays:Math.max(1,Math.min(36500,parseInt(config.deadDays)||90)),likeCooldownDays:Math.max(0,Math.min(36500,parseInt(config.likeCooldownDays)||30)),commentCooldownDays:Math.max(0,Math.min(36500,parseInt(config.commentCooldownDays)||30)),likeToCommentGapDays:Math.max(0,Math.min(36500,parseInt(config.likeToCommentGapDays)||3)),commentToLikeGapDays:Math.max(0,Math.min(36500,parseInt(config.commentToLikeGapDays)||3)),delayFriendMin:Math.max(1,Math.min(604800,parseInt(config.delayFriendMin)||3)),delayFriendMax:Math.max(1,Math.min(604800,parseInt(config.delayFriendMax)||8)),delayPostMin:Math.max(1,Math.min(604800,parseInt(config.delayPostMin)||30)),delayPostMax:Math.max(1,Math.min(604800,parseInt(config.delayPostMax)||60)),endMode:config.endMode==="continue"?"continue":"stop",restDays:Math.max(0,Math.min(36500,parseInt(config.restDays)||10)),prompt:scheduleSafeText(config.prompt,4000),storyEnabled:config.storyEnabled!==false,storyPerDay:Math.min(100000,Math.max(1,parseInt(config.storyPerDay)||20)),storyViewSec:Math.max(3,Math.min(3600,parseInt(config.storyViewSec)||5)),storyReaction:scheduleSafeText(config.storyReaction,40)||"random",storyHours:Math.max(1,Math.min(8760,parseInt(config.storyHours)||24)),storyDelayMin:Math.max(1,Math.min(604800,parseInt(config.storyDelayMin)||20)),storyDelayMax:Math.max(1,Math.min(604800,parseInt(config.storyDelayMax)||45))};
  }else if(feature==="fbStory"){
    normalized={mediaUrls:scheduleSafeText(config.mediaUrls||config.mediaUrl,10000),text:scheduleSafeText(config.text,500),delay:Math.max(0,parseInt(config.delay)||30),aiEnabled:!!config.aiEnabled,aiPrompt:scheduleSafeText(config.aiPrompt,2000)};
  }else if(feature==="fbReels"){
    normalized={videoUrl:scheduleSafeText(config.videoUrl||config.url,2000),content:scheduleSafeText(config.content||config.caption,5000),aiEnabled:!!config.aiEnabled,aiPrompt:scheduleSafeText(config.aiPrompt,2000)};
  }
  normalized.profileId=scheduleSafeText(config.profileId,80)||"";
  return {
    id:scheduleId(),feature,label:scheduleSafeText(raw.label,120)||scheduleDefaultLabel(feature),runAt,createdAt:Date.now(),status:"scheduled",config:normalized
  };
}

// A chain is only an orchestration record. Each step still uses the existing
// feature snapshot, route, active flag, counter and proof. The chain never
// merges those state machines; it waits for one step to reach a terminal
// proof before it arms the next step.
function normalizeScheduledChain(raw={}){
  const runAt=Number(raw.runAt);
  if(!Number.isFinite(runAt)||runAt<Date.now()+25000)throw new Error("Thời điểm bắt đầu chuỗi phải sau hiện tại ít nhất 30 giây");
  const input=Array.isArray(raw.steps)?raw.steps.slice(0,SCHEDULE_CHAIN_MAX_STEPS):[];
  if(input.length<2)throw new Error("Chuỗi chạy cần ít nhất 2 bước");
  const steps=input.map((step,index)=>{
    const normalized=normalizeScheduledTask({feature:step?.feature,label:step?.label,runAt,config:step?.config});
    if(normalized.feature==="trendLearn"&&normalized.config?.unlimited)throw new Error("Học Trend không giới hạn phải đặt giới hạn trước khi đưa vào chuỗi");
    const gapAfter=step&&step.gapAfter!==undefined&&step.gapAfter!==null?Math.min(604800,Math.max(0,parseInt(step.gapAfter)||0)):null;
    return {id:`step_${index+1}`,feature:normalized.feature,label:normalized.label,config:normalized.config,status:"queued",attempt:0,gapAfter};
  });
  return {
    id:scheduleId(),kind:"chain",label:scheduleSafeText(raw.label,120)||"Chạy xuyên đêm",runAt,createdAt:Date.now(),
    status:"scheduled",gapSeconds:Math.min(604800,Math.max(0,parseInt(raw.gapSeconds)||60)),
    onFailure:raw.onFailure==="stop"?"stop":raw.onFailure==="continue"?"continue":"auto",currentIndex:0,steps,
    ownerTabId:0,heartbeatAt:0,lastProgressAt:0,recoveryCount:0,error:""
  };
}

function scheduleChainStepTask(chain,step){
  return {id:`${chain.id}:${step.id}`,feature:step.feature,label:step.label,runAt:chain.runAt,config:step.config};
}
// Nghỉ sau 1 bước: ưu tiên gapAfter của bước đó (hàng đợi Page gán riêng
// nghỉ-giữa-tính-năng vs nghỉ-giữa-Page), thiếu thì về gapSeconds chung.
function scheduleChainStepGap(chain,step){
  const own=step&&step.gapAfter!==undefined&&step.gapAfter!==null?Number(step.gapAfter):NaN;
  const gap=Number.isFinite(own)?own:Number(chain.gapSeconds);
  return Math.min(604800,Math.max(0,gap||0));
}
function scheduledError(code,message){
  const error=new Error(message);
  error.code=code;
  return error;
}
function scheduleChainRetryDelay(attempt){
  const n=Math.max(1,parseInt(attempt)||1);
  return Math.min(SCHEDULE_CHAIN_START_RETRY_MAX_MS,SCHEDULE_CHAIN_START_RETRY_BASE_MS*Math.pow(2,n-1));
}
function scheduleChainRetryableStartError(error){
  return !["SCHEDULE_ACTIVE_NOT_HELD","SCHEDULE_AMBIGUOUS"].includes(String(error?.code||""));
}
function scheduleChainSkipCount(value){
  if(Number.isFinite(Number(value)))return Math.max(0,Number(value));
  if(!value||typeof value!=="object")return 0;
  return Object.values(value).reduce((sum,item)=>sum+(Number.isFinite(Number(item))?Number(item):0),0);
}
function scheduleChainCompletionEvidence(task,state){
  const cfg=task.config||{}, groups=Array.isArray(cfg.groups)?cfg.groups.length:0;
  const done=(value)=>Math.max(0,parseInt(value)||0);
  switch(task.feature){
    case "friend":
      if(cfg.mode==="confirm")return done(state.friendConfirmAccepted)+done(state.friendConfirmSkipped)+done(state.friendConfirmUncertain)>=done(cfg.maxRequests);
      if(cfg.mode==="friend-of-friend")return done(state.friendFoFSent)+done(state.friendFoFSkipped)+done(state.friendFoFUncertain)>=done(cfg.maxRequests);
      return done(state.sentCount)+done(state.friendSkipped)+done(state.friendUncertain)>=done(cfg.maxRequests);
    case "scrape":return state.scrapeReady===true;
    case "feed":{
      const source=String(cfg.source||"friends"),cap=source[0].toUpperCase()+source.slice(1),mode=["like","comment","both"].includes(cfg.actionMode)?cfg.actionMode:(cfg.aiEnabled?"both":"like");
      const likeOk=mode==="comment"||done(state[`feed${cap}Count`])>=done(cfg.target);
      const commentOk=mode==="like"||done(state[`feed${cap}AiCount`])>=done(cfg.aiTarget);
      return likeOk&&commentOk;
    }
    case "aiFeed":return done(state.aiCount)>=done(cfg.target);
    case "groupInteract":return done(state.groupInteractIndex)>=groups||done(state.groupInteractDone)+scheduleChainSkipCount(state.groupInteractSkipped)>=groups*Math.max(1,done(cfg.perGroup));
    case "groupComment":return done(state.groupCommentIndex)>=groups||done(state.groupCommentDone)+scheduleChainSkipCount(state.groupCommentSkipped)>=groups*Math.max(1,done(cfg.perGroup));
    case "groupPost":return done(state.groupPostIndex)>=groups||done(state.groupPostDone)+done(state.groupPostSkipped)>=groups;
    case "keyword":return done(state.groupJoined)>=done(cfg.targetJoin);
    case "discover":return done(state.discoverJoined)>=done(cfg.target);
    case "share":return done(state.groupShareIndex)>=groups||done(state.groupShareDone)+done(state.groupShareSkipped)>=groups;
    case "sales":return done(state.salesPostIndex)>=groups||done(state.salesPostDone)+done(state.salesPostSkipped)>=Math.max(groups,salesScheduledPostCount(cfg));
    case "trendLearn":return state.trendLearnReady===true&&!state.trendLearnActive;
    case "trendPost":return done(state.trendPostIndex)>=done(Array.isArray(cfg.jobs)?cfg.jobs.length:0)||done(state.trendPostDone)+done(state.trendPostSkipped)>=done(Array.isArray(cfg.jobs)?cfg.jobs.length:0);
    case "newsWall":return done(state.newsWallDone)+done(state.newsWallSkipped)>=Math.max(1,parseInt(cfg.count)||1);
    case "fbStory":return done(state.fbStoryDone)+done(state.fbStorySkipped)>=Math.max(1,String(cfg.mediaUrls||cfg.mediaUrl||"").split(/[\r\n,]+/).filter(Boolean).length||1);
    case "fbReels":return done(state.fbReelsDone)+done(state.fbReelsSkipped)>=1;
    case "pageGroupJoin":return done(state.pageGroupJoinJoined)+done(state.pageGroupJoinSkipped)>=done(cfg.target);
    case "pageGroupPost":return done(state.pageGroupPostIndex)>=groups||done(state.pageGroupPostDone)+done(state.pageGroupPostSkipped)>=groups;
    case "pageComment":return done(state.pageCommentDone)>=done(cfg.target);
    case "pageSales":return done(state.pageSalesPostIndex)>=groups||done(state.pageSalesPostDone)+done(state.pageSalesPostSkipped)>=Math.max(groups,salesScheduledPostCount(cfg));
    case "pageNewsWall":return done(state.pageNewsWallDone)+done(state.pageNewsWallSkipped)>=Math.max(1,parseInt(cfg.count)||1);
    case "pageGroupComment":return done(state.pageGroupCommentIndex)>=groups||done(state.pageGroupCommentDone)+scheduleChainSkipCount(state.pageGroupCommentSkipped)>=groups*Math.max(1,done(cfg.perGroup));
    case "friendReengage":{const mode=String(cfg.mode||"like"),needLike=(mode==="like"||mode==="both")?Math.max(1,parseInt(cfg.likePerDay)||25):0,needCmt=(mode==="comment"||mode==="both")?Math.max(1,parseInt(cfg.commentPerDay)||12):0,needStory=(mode==="story"||cfg.storyEnabled)?Math.max(1,parseInt(cfg.storyPerDay)||20):0;const likeOk=needLike?done(state.friendReengageDoneLike)>=needLike:true,cmtOk=needCmt?done(state.friendReengageDoneComment)>=needCmt:true,storyOk=needStory?done(state.friendReengageDoneStory)>=needStory:true;if(needLike+needCmt+needStory>0)return likeOk&&cmtOk&&storyOk;return done(state.friendReengageDoneLike)+done(state.friendReengageDoneComment)+done(state.friendReengageDoneStory)+done(state.friendReengageSkipped)>0;}
    default:return false;
  }
}

const SCHEDULE_CHAIN_STATE_KEYS=[
  "sentCount","friendSkipped","friendUncertain","friendConfirmAccepted","friendConfirmSkipped","friendConfirmUncertain",
  "scrapeReady","feedCount","feedFriendsAiCount","feedGroupsAiCount","feedPagesAiCount","aiCount","groupInteractIndex","groupInteractDone","groupInteractSkipped","groupCommentIndex","groupCommentDone","groupCommentSkipped",
  "groupPostIndex","groupPostDone","groupPostSkipped","groupJoined","discoverJoined","groupShareIndex","groupShareDone","groupShareSkipped",
  "salesPostIndex","salesPostDone","salesPostSkipped","trendLearnReady","trendLearnActive","trendPostIndex","trendPostDone","trendPostSkipped",
  "newsWallDone","newsWallSkipped","newsWallActive",
  "friendReengageDoneLike","friendReengageDoneComment","friendReengageDoneStory","friendReengageSkipped","friendReengageActive","friendReengageCycle",
  "pageGroupJoinJoined","pageGroupJoinSkipped","pageGroupPostIndex","pageGroupPostDone","pageGroupPostSkipped","pageCommentDone",
  "pageSalesPostIndex","pageSalesPostDone","pageSalesPostSkipped","pageNewsWallDone","pageNewsWallSkipped","pageNewsWallActive","pageGroupCommentIndex","pageGroupCommentDone","pageGroupCommentSkipped",
  "isRunning","friendConfirmActive","isScraping","isFeedInteracting","feedFriendsActive","feedGroupsActive","feedPagesActive","feedBantinActive","feedFriendsCount","feedGroupsCount","feedPagesCount","feedBantinCount","feedBantinAiCount","isAICommenting","groupInteractActive","groupCommentActive","groupPostActive","isGroupJoining","isDiscoverJoining","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","newsWallActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","pageGroupCommentActive","friendReengageActive"
];
const scheduleChainActiveKey=task=>scheduledActiveKey(task);
  const scheduleChainStatusKey=task=>task.feature==="friend"?(task.config?.mode==="confirm"?"friendConfirmStatus":task.config?.mode==="friend-of-friend"?"friendFoFStatus":"friendStatus"):task.feature==="feed"?`${scheduledFeedPrefix(task.config?.source)}Status`:({friend:"friendStatus",scrape:"scrapeStatus",aiFeed:"aiStatus",groupInteract:"groupInteractStatus",groupComment:"groupCommentStatus",groupPost:"groupPostStatus",keyword:"groupStatus",discover:"discoverStatus",share:"groupShareStatus",sales:"salesPostStatus",trendLearn:"trendLearnStatus",trendPost:"trendPostStatus",newsWall:"newsWallStatus",pageGroupJoin:"pageGroupJoinStatus",pageGroupPost:"pageGroupPostStatus",pageNewsWall:"pageNewsWallStatus",pageComment:"pageCommentStatus",pageSales:"pageSalesPostStatus",pageGroupComment:"pageGroupCommentStatus",friendReengage:"friendReengageStatus"}[task.feature]);
const scheduleChainStopAction=task=>{
  if(task.feature==="friend")return task.config?.mode==="confirm"?"friendConfirmStop":"friendStop";
  if(task.feature==="feed")return "stopFeedScoped";
  return {scrape:"stopScrape",aiFeed:"stopAIComment",groupInteract:"stopGroupInteract",groupComment:"stopGroupComment",groupPost:"stopGroupPost",keyword:"stopGroupJoin",discover:"stopDiscoverJoin",share:"stopGroupShare",sales:"stopSalesPost",trendLearn:"stopTrendLearn",trendPost:"stopTrendPost",newsWall:"stopNewsWallPost",pageGroupJoin:"stopPageGroupJoin",pageGroupPost:"stopPageGroupPost",pageNewsWall:"stopPageNewsWall",pageComment:"stopPageComment",pageSales:"stopPageSalesPost",pageGroupComment:"stopPageGroupComment",friendReengage:"stopFriendReengage"}[task.feature];
};
async function hasActiveFeature(){const state=await chrome.storage.local.get(SCHEDULE_ACTIVE_KEYS);return SCHEDULE_ACTIVE_KEYS.some(key=>!!state[key]);}
async function scheduleAiConfig(){return getPageAiConfig({});}
// Lịch/chuỗi gắn profileId lúc snapshot (tab AI) — đến giờ chạy resolve hồ sơ
// tương ứng, thiếu/không có thì về default để lịch cũ vẫn chạy.
async function resolveAiProfile(profileId){
  try{
    const saved=await chrome.storage.sync.get(["aiProfiles","aiDefaultProfileId"]);
    const profiles=Array.isArray(saved.aiProfiles)?saved.aiProfiles:[];
    let found=profiles.find(p=>p&&p.id===profileId)||profiles.find(p=>p&&p.id===saved.aiDefaultProfileId)||profiles[0];
    if(found&&(found.key||found.model||found.provider==="meta-free"))return {provider:found.provider||"gemini",key:found.key||"",model:found.model||"",url:found.url||""};
  }catch(_){}
  return getPageAiConfig({});
}
async function scheduleFacebookTab(preferredTabId=0){
  if(Number(preferredTabId)>0){
    const preferred=await chrome.tabs.get(Number(preferredTabId)).catch(()=>null);
    let host="";
    try{host=new URL(String(preferred?.url||"")).hostname.toLowerCase().replace(/\.$/,"");}catch{}
    if(preferred?.id!==undefined&&(host==="facebook.com"||host.endsWith(".facebook.com")||host==="fb.watch"))return {id:preferred.id};
    throw scheduledError("SCHEDULE_OWNER_TAB_UNAVAILABLE","Tab Facebook cố định của chuỗi không còn khả dụng");
  }
  const tabs=await chrome.tabs.query({url:["*://*.facebook.com/*"]});
  const tab=tabs.find(item=>item.active)||tabs[0];
  // Need a tab id before persisting ownerTabId. A blank tab is intentional:
  // state must be written before the Facebook content script can load.
  if(tab?.id!==undefined)return {id:tab.id};
  return chrome.tabs.create({url:"about:blank",active:true});
}
async function navigateScheduledTab(tabId,url,timeout=18000){
  return new Promise(resolve=>{
    let done=false;
    const finish=ok=>{if(done)return;done=true;chrome.tabs.onUpdated.removeListener(onUpdated);clearTimeout(timer);resolve(ok);};
    const onUpdated=(id,info)=>{if(id===tabId&&info.status==="complete")finish(true);};
    const timer=setTimeout(()=>finish(false),timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId,{url,active:true}).catch(()=>finish(false));
  });
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Gửi CDP mouse events thực sự để trigger Facebook IntersectionObserver lazy-load.
// DOM mousemove events không đủ; cần chrome.debugger để dispatch ở level browser.
async function triggerTabContentLoad(tabId){
  let attached=false;
  try{
    await new Promise((res,rej)=>chrome.debugger.attach({tabId},"1.3",()=>chrome.runtime.lastError?rej(chrome.runtime.lastError):res()));
    attached=true;
    await new Promise(res=>chrome.debugger.sendCommand({tabId},"Page.bringToFront",{},()=>res()));
    const sizeRes=await new Promise(res=>chrome.debugger.sendCommand({tabId},"Runtime.evaluate",
      {expression:'JSON.stringify({w:window.innerWidth,h:window.innerHeight})',returnByValue:true},res));
    let w=1280,h=900;
    try{const sz=JSON.parse(sizeRes?.result?.value||"{}");if(sz.w)w=sz.w;if(sz.h)h=sz.h;}catch{}
    const cx=Math.round(w*0.65);
    for(let y=120;y<Math.min(h-30,850);y+=80){
      await new Promise(res=>chrome.debugger.sendCommand({tabId},"Input.dispatchMouseEvent",
        {type:"mouseMoved",x:cx,y,modifiers:0},()=>res()));
    }
    await new Promise(res=>chrome.debugger.detach({tabId},()=>res()));
    return true;
  }catch(e){
    if(attached)try{await new Promise(res=>chrome.debugger.detach({tabId},()=>res()));}catch{}
    return false;
  }
}
async function sendScheduledTabMessage(tabId,message){
  return new Promise(resolve=>chrome.tabs.sendMessage(tabId,message,result=>resolve(chrome.runtime.lastError?null:result)));
}
// Tính năng nick (không phải page*) phải chạy bằng nick cá nhân. Bước trước
// (hoặc người dùng) có thể để tab đang hoạt động với Page — phát hiện và
// chuyển về TRƯỚC khi persist/điều hướng, giống ensureTaskTab ở popup.
// Tính năng Page tự switch actor trong loop của nó nên được miễn.
async function scheduledEnsurePersonalActor(tabId){
  let res=null;
  // Một content script cũ hoặc chưa mount trước đây bị coi như {ok:true},
  // khiến lịch có thể tiếp tục trên Page. Retry một lượt ngắn rồi chặn hẳn.
  for(let attempt=0;attempt<3&&!res;attempt++){
    try{res=await sendScheduledTabMessage(tabId,{action:"ensurePersonalActor"});}catch{res=null;}
    if(!res)await wait(900);
  }
  if(!res)return {ok:false,code:"ACTOR_UNVERIFIED"};
  if(res&&res.ok===false)return res;
  if(res&&res.switched)return res;
  // Facebook reload trang ngay khi đổi danh tính thật nên câu trả lời có thể
  // mất cùng content script — đọc cờ personalActorSwitching (ghi trước khi
  // bấm chuyển, hạn 45s, tự dọn) thay vì tưởng "không cần chuyển".
  try{
    const s=await chrome.storage.local.get("personalActorSwitching");
    const fl=s.personalActorSwitching;
    if(fl&&Date.now()-(fl.at||0)<45000){
      try{await chrome.storage.local.remove("personalActorSwitching");}catch{}
      return {ok:true,switched:true};
    }
  }catch{}
  if(res&&res.verified===true)return res;
  return {ok:false,code:"ACTOR_UNVERIFIED"};
}
// Chờ tab về trạng thái complete (dùng sau khi actor switch có thể gây navigation phụ)
async function waitForTabReady(tabId,timeout=20000){
  const tab=await chrome.tabs.get(tabId).catch(()=>null);
  if(!tab)return false;
  if(tab.status==="complete")return true;
  return new Promise(resolve=>{
    let done=false;
    const finish=ok=>{if(done)return;done=true;chrome.tabs.onUpdated.removeListener(cb);clearTimeout(timer);resolve(ok);};
    const cb=(id,info)=>{if(id===tabId&&info.status==="complete")finish(true);};
    const timer=setTimeout(()=>finish(false),timeout);
    chrome.tabs.onUpdated.addListener(cb);
  });
}
async function sendScheduledStart(tabId,message,attempts=12){
  // `tabs.onUpdated: complete` can arrive before a Facebook content script is
  // ready after a cold extension/service-worker wake. Retrying a message that
  // was not delivered is safe; once it is delivered we stop immediately, so a
  // Join/Post action is never retried by this helper.
  for(let attempt=0;attempt<attempts;attempt++){
    const response=await sendScheduledTabMessage(tabId,message);
    if(response!==null)return response;
    await wait(650);
  }
  return null;
}

// Tải danh sách "Nhóm đã tham gia" dùng chung cho mọi tab (Nhóm, Đăng nhóm,
// Share bài, Đăng bán, Học nhóm). Trước đây mỗi nút tự điều hướng tab bằng
// chrome.tabs.update() rồi chờ (await sleep) NGAY TRONG SCRIPT CỦA POPUP.
// Điều hướng tab đang active có thể khiến popup mất focus và bị Chrome tự
// đóng trên một số bản build — làm chết toàn bộ chuỗi await đang chạy dở,
// kể cả bước gửi scanJoinedGroups sau đó. Người dùng phải mở lại popup và
// bấm lần 2: lúc đó tab đã ở đúng trang nên bỏ qua bước điều hướng và chạy
// trót lọt — đúng triệu chứng "phải bấm 2 lần mới tải". Chuyển toàn bộ việc
// điều hướng + chờ + quét vào service worker (không phụ thuộc vòng đời của
// popup) và ghi kết quả vào storage để mọi popup (kể cả popup mới mở sau
// khi cái cũ đã đóng) đều thấy được.
let joinedGroupsScanPromise=null;
let pageJoinedGroupsScanPromise=null;
function isJoinedGroupsListUrl(url){return /facebook\.com\/groups\/joins\/?\?[^#]*ordering=viewer_added/i.test(String(url||""));}
// Chuẩn hóa pageKey thành storage key, loại bỏ slash đầu để tránh double underscore
function pageGroupStorageKey(pageKey){
  const safe=String(pageKey||"").replace(/^\/+/,"").replace(/[^a-zA-Z0-9_\-]/g,"_");
  return safe?`pageJoinedGroups_${safe}`:"";
}
async function runJoinedGroupsScan(tabId,pageActorUrl,pageKey,pageData){
  const isPageScan=pageActorUrl==="__page__";
  const storageKey=isPageScan?(pageGroupStorageKey(pageKey)||"pageJoinedGroups_unknown"):"joinedGroups";
  if(isPageScan){if(pageJoinedGroupsScanPromise)return pageJoinedGroupsScanPromise;}
  else{if(joinedGroupsScanPromise)return joinedGroupsScanPromise;}
  const scanStatusKey=isPageScan?"pageJoinedGroupsScanActive":"joinedGroupsScanActive";
  const pageName=pageData?.name||"Page";
  const promise=(async()=>{
    try{
      await chrome.storage.local.set({[scanStatusKey]:true,joinedGroupsScanStatus:t("p.giLoadGroups")});
      const tab=await chrome.tabs.get(tabId).catch(()=>null);
      if(!tab)throw new Error(t("p.giLoadGroupsNoTab"));
      // bringToFront TRƯỚC navigate: FB cần tab có focus khi load để IntersectionObserver kích hoạt
      await triggerTabContentLoad(tabId);
      await wait(500);
      if(!isJoinedGroupsListUrl(tab.url)){
        const navigated=await navigateScheduledTab(tabId,"https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added",18000);
        if(!navigated)throw new Error(t("p.giLoadGroupsNavTimeout"));
        await wait(3000);
      } else {
        await wait(1500);
      }
      // Sau khi navigate, kiểm tra trang có bị lỗi "Trang này hiện không hiển thị" không
      // Tab status="complete" nhưng main content có thể rỗng → chỉ lấy được sidebar (~240 nhóm)
      for(let reloadAttempt=0;reloadAttempt<2;reloadAttempt++){
        const pageCheck=await sendScheduledTabMessage(tabId,{action:"checkGroupsPageReady"});
        if(pageCheck?.ok)break; // trang đã load đúng
        if(!pageCheck?.isError)break; // không phải lỗi rõ ràng (có thể đang load) → tiếp tục
        // Trang lỗi → reload và thử lại
        await chrome.storage.local.set({joinedGroupsScanStatus:`Trang lỗi, đang tải lại (${reloadAttempt+1}/2)...`});
        await chrome.tabs.reload(tabId).catch(()=>{});
        await waitForTabReady(tabId,18000);
        await triggerTabContentLoad(tabId);
        await wait(3000);
      }
      // Với Page scan: switch actor về Page đã chọn trước khi scan
      // /groups/joins/ hiển thị nhóm theo actor đang hoạt động
      if(isPageScan&&pageData){
        await chrome.storage.local.set({joinedGroupsScanStatus:`Đang chuyển sang ${pageName}...`});
        const switchResult=await new Promise(resolve=>{
          chrome.tabs.sendMessage(tabId,{action:"switchPageActor",page:pageData},res=>{
            void chrome.runtime.lastError;resolve(res||{ok:false});
          });
        });
        if(!switchResult?.ok){
          // Switch thất bại: có thể đã ở đúng actor rồi, ghi cảnh báo nhưng tiếp tục
          await chrome.storage.local.set({joinedGroupsScanStatus:`Không xác nhận được actor ${pageName} — kết quả có thể không chính xác, hãy thử lại`});
          await wait(1000);
        } else {
          // Chờ navigation phụ (nếu có) do FB kích hoạt sau switch actor, rồi chờ thêm để content script init
          await waitForTabReady(tabId, 12000);
          await wait(1500);
        }
      }
      const res=await sendScheduledStart(tabId,{action:"scanJoinedGroups"},20);
      if(!res?.ok)throw new Error(res?.error||t("p.giLoadGroupsNoResponse"));
      const groups=Array.isArray(res.groups)?res.groups:[];
      const totalShown=Math.max(0,parseInt(res.totalShown)||0);
      // Đánh dấu _actorVerified để popup biết dữ liệu này đã được scan đúng actor
      const newPayload=groups.map(g=>({...g,_actorVerified:isPageScan}));
      // Gộp với dữ liệu cũ: ưu tiên kết quả mới, giữ nhóm cũ mà lần scan này không thấy
      // (FB lazy-load có thể bỏ sót nhóm hợp lệ → merge bảo vệ dữ liệu người dùng)
      const prevStored=(await chrome.storage.local.get(storageKey))[storageKey];
      const prevGroups=Array.isArray(prevStored)?prevStored:[];
      const newKeySet=new Set(newPayload.map(g=>g.key||g.url||"").filter(Boolean));
      const keptOld=prevGroups.filter(g=>{const k=g.key||g.url||"";return k&&!newKeySet.has(k);});
      const payload=[...newPayload,...keptOld];
      const scanContext=isPageScan?`(Page: ${pageName})`:"(cá nhân)";
      let scanMsg=`Tải danh sách nhóm ${scanContext}: đã lưu ${payload.length} nhóm`;
      if(keptOld.length)scanMsg+=` (${newPayload.length} mới + ${keptOld.length} giữ lại từ lần trước)`;
      if(totalShown>0&&totalShown>groups.length){
        const missing=totalShown-groups.length;
        scanMsg+=` / FB hiển thị ${totalShown} nhóm — thiếu ${missing} nhóm (FB lazy-load chưa tải hết)`;
      }else if(totalShown>0){
        scanMsg+=` / FB hiển thị ${totalShown} nhóm`;
      }
      const statusMsg=totalShown>0?`✅ ${payload.length}/${totalShown} nhóm${isPageScan?` — ${pageName}`:""}`:`✅ ${payload.length} nhóm${isPageScan?` — ${pageName}`:""}`;
      await chrome.storage.local.set({[storageKey]:payload,[scanStatusKey]:false,joinedGroupsScanStatus:statusMsg,joinedGroupsScanTotal:totalShown,joinedGroupsScanCount:payload.length});
      // Gộp vào registry nhóm đã lưu của Page (dùng chung Đăng bài/Comment/Đăng bán).
      if (isPageScan && pageKey) {
        try {
          const pk = String(pageKey).toLowerCase();
          const saved = await chrome.storage.local.get("pageSavedGroups");
          const all = saved.pageSavedGroups && typeof saved.pageSavedGroups === "object" ? saved.pageSavedGroups : {};
          const rows = Array.isArray(all[pk]) ? all[pk] : [];
          const keyOf = (g) => {
            const k = String(g.key || "").toLowerCase();
            if (/^\/groups\//i.test(k)) return k;
            try {
              const m = new URL(String(g.url || ""), "https://www.facebook.com").pathname.match(/^\/groups\/([^/?#]+)/i);
              if (m) return `/groups/${String(m[1]).toLowerCase()}`;
            } catch (_) {}
            const id = String(g.id || "").trim().toLowerCase();
            if (id) return `/groups/${id}`;
            return "";
          };
          for (const g of groups) {
            const gk = keyOf(g);
            if (!gk || rows.some(r => String(r.key || "").toLowerCase() === gk)) continue;
            rows.push({ key: gk, url: g.url || `https://www.facebook.com${gk}/`, name: g.name || "", at: 0, source: "scan" });
          }
          all[pk] = rows.slice(-500);
          await chrome.storage.local.set({ pageSavedGroups: all });
        } catch (_) {}
      }
      await logActivity("scanGroups",scanMsg,"done");
      return {ok:true,groups:payload,storageKey,totalShown};
    }catch(error){
      const message=String(error?.message||error);
      await chrome.storage.local.set({[scanStatusKey]:false,joinedGroupsScanStatus:message});
      const scanContext=isPageScan?`(Page: ${pageName})`:"(cá nhân)";
      await logActivity("scanGroups",`Tải danh sách nhóm ${scanContext} thất bại: ${message}`,"error");
      return {ok:false,error:message};
    }finally{
      if(isPageScan)pageJoinedGroupsScanPromise=null;
      else joinedGroupsScanPromise=null;
    }
  })();
  if(isPageScan)pageJoinedGroupsScanPromise=promise;
  else joinedGroupsScanPromise=promise;
  return promise;
}
function scheduledFeedPrefix(source){const value=["bantin","friends","groups","pages"].includes(String(source||""))?String(source):"friends";return `feed${value[0].toUpperCase()+value.slice(1)}`;}
// Tổng số bài của một lịch Đăng bán: nhóm × sản phẩm × lượt/nhóm.
// Lịch legacy (chỉ sourceText, không products[]) tính là 1 sản phẩm.
function salesScheduledPostCount(cfg){
  const groups=Array.isArray(cfg?.groups)?cfg.groups.length:0;
  const prods=Array.isArray(cfg?.products)&&cfg.products.length?cfg.products.length:(cfg?.sourceText?1:0);
  const rep=Math.max(1,Math.min(100000,parseInt(cfg?.postsPerGroup)||1));
  return groups*Math.max(0,prods)*rep;
}
function scheduledActiveKey(task){
  if(task.feature==="friend"&&task.config?.mode==="confirm")return "friendConfirmActive";
  if(task.feature==="friend"&&task.config?.mode==="friend-of-friend")return "friendFoFActive";
  if(task.feature==="feed")return `${scheduledFeedPrefix(task.config?.source)}Active`;
  return SCHEDULE_ACTIVE_BY_FEATURE[task.feature];
}
function scheduledScrapeSourceKey(value){
  try{const url=new URL(String(value||"")),host=String(url.hostname||"").toLowerCase().replace(/\.$/,"");return `https://${host==="facebook.com"||host.endsWith(".facebook.com")?"facebook.com":host}${url.pathname}`.replace(/\/$/,"").toLowerCase();}catch{return scheduleUrlKey(value);}
}
function scheduledTargetUrl(task,cfg){
  switch(task.feature){
      case "friend":
        if(cfg.mode==="friend-of-friend")return (cfg.source&&cfg.source.url)||"https://www.facebook.com/friends/";
        if(cfg.mode==="suggestions")return "https://www.facebook.com/friends/suggestions";
      if(cfg.mode==="confirm")return "https://www.facebook.com/friends/requests";
      return `https://www.facebook.com/groups/${encodeURIComponent(cfg.groups[0].id)}/members/`;
    case "scrape":return cfg.sourceUrl;
    case "feed":{const f=String(cfg.source||"friends").toLowerCase();return `https://www.facebook.com/?filter=${f==="bantin"?"all":f}&sk=h_chr`;}
    case "aiFeed":return "https://www.facebook.com/";
    case "keyword":return "https://www.facebook.com/search/groups/?q="+encodeURIComponent(cfg.keyword);
    case "discover":return "https://www.facebook.com/groups/discover";
    case "groupInteract":case "groupComment":case "groupPost":case "sales":case "trendLearn":case "trendPost":case "pageGroupPost":case "pageSales":case "pageGroupComment":return cfg.groups[0].url;
    case "pageNewsWall":return cfg.page.url;
    case "newsWall":return "https://www.facebook.com/";
    case "fbStory":return "https://www.facebook.com/stories/create";
    case "fbReels":return "https://www.facebook.com/";
    case "share":return cfg.sourceUrl;
    case "friendReengage":return "https://www.facebook.com/friends/list/";
    case "pageGroupJoin":return cfg.mode==="discover"?"https://www.facebook.com/groups/discover":"https://www.facebook.com/search/groups/?q="+encodeURIComponent(cfg.keyword);
    case "pageComment":return cfg.source==="feed"?"https://www.facebook.com/":`https://www.facebook.com/?filter=${encodeURIComponent(cfg.source)}&sk=h_chr`;
    default:return "https://www.facebook.com/";
  }
}
function scheduledRouteMatches(task,cfg,url){
  try{
    const current=new URL(String(url||"")),host=current.hostname.toLowerCase();
    if(!(host==="facebook.com"||host.endsWith(".facebook.com")||host==="fb.watch"))return false;
    const path=current.pathname.replace(/\/+$/g,"").toLowerCase()||"/";
    switch(task.feature){
      case "friend":
        if(cfg.mode==="friend-of-friend")return /facebook\.com$/i.test(current.hostname||"");
        if(cfg.mode==="suggestions")return path==="/friends/suggestions";
        if(cfg.mode==="confirm")return path==="/friends/requests";
        return path.startsWith(`/groups/${String(cfg.groups[0].id).toLowerCase()}/members`);
      case "scrape":return scheduledScrapeSourceKey(url)===scheduledScrapeSourceKey(cfg.sourceUrl);
      case "feed":{const want=String(cfg.source||"friends").toLowerCase(),got=(current.searchParams.get("filter")||"all").toLowerCase();return want==="bantin"?got==="all":got===want;}
      case "aiFeed":return path==="/"||path==="/home.php";
      case "keyword":return path.startsWith("/search/groups")&&current.searchParams.get("q")===cfg.keyword;
      case "discover":return path==="/groups/discover";
      case "groupInteract":case "groupComment":case "groupPost":case "sales":case "trendLearn":case "trendPost":case "pageGroupPost":case "pageSales":case "pageGroupComment":return scheduleUrlKey(url)===scheduleUrlKey(cfg.groups[0].url);
      case "pageNewsWall":return scheduleUrlKey(url)===scheduleUrlKey(cfg.page.url);
      case "newsWall":return path==="/"||path==="/home.php";
      case "fbStory":return path.startsWith("/stories/create")||path==="/"||path==="/home.php";
      case "fbReels":return host==="business.facebook.com"||path.startsWith("/reel")||path.startsWith("/me")||path==="/"||path==="/home.php";
      case "share":return true; // Facebook canonicalizes /share/* and fb.watch before share.js resolves the source.
      case "friendReengage":return path==="/friends/list"||path==="/friends";
      case "pageGroupJoin":return cfg.mode==="discover"?path==="/groups/discover":path.startsWith("/search/groups")&&current.searchParams.get("q")===cfg.keyword;
      case "pageComment":return (path==="/"||path==="/home.php")&&(cfg.source==="feed"?((current.searchParams.get("filter")||"all").toLowerCase()==="all"):(current.searchParams.get("filter")||"all").toLowerCase()===String(cfg.source||"").toLowerCase());
      default:return false;
    }
  }catch{return false;}
}
async function persistScheduledFeatureState(task,cfg,tabId,runId){
  const ownerCfg={...cfg,ownerTabId:tabId,runId};
  await logActivity(task.feature,`[bắt đầu] runId=${runId}`+(String(task.id||"").includes(":")?` (bước trong chuỗi ${String(task.id).split(":")[0]})`:""));
  switch(task.feature){
    case "friend":{
      const delay=Number(cfg.minDelay)||5000;
      if(cfg.mode==="friend-of-friend"){
        // FoF tự set friendFoFActive lúc content khởi động — ở đây chỉ ghi
        // status để vòng busy-check của content không tưởng phiên khác chạy.
        await chrome.storage.local.set({friendFoFStatus:t("sch.launching")});
      }else if(cfg.mode==="confirm"){
        await chrome.storage.local.set({friendConfirmActive:true,friendConfirmAccepted:0,friendConfirmSkipped:0,friendConfirmUncertain:0,friendConfirmRunState:{active:true,runId,ownerTabId:tabId,mode:cfg.mode,config:cfg,acceptedCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],emptyRounds:0,sourceReloads:0,nextAllowedAt:Date.now()+delay,status:t("sch.launching"),startedAt:Date.now()},friendConfirmStatus:t("sch.launching")});
      }else{
        await chrome.storage.local.set({isRunning:true,sentCount:0,friendSkipped:0,friendUncertain:0,friendRunState:{active:true,runId,ownerTabId:tabId,mode:cfg.mode,config:cfg,sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],groupIndex:0,emptyRounds:0,sourceReloads:0,nextAllowedAt:Date.now()+delay,groupWaitKey:"",groupWaitStartedAt:0,status:t("sch.launching"),startedAt:Date.now()},friendStatus:t("sch.launching"),lastMessage:t("sch.launching")});
      }
      break;
    }
    case "scrape":
      await chrome.storage.local.set({isScraping:true,scrapeTarget:cfg.count,scrapeOwnerTabId:tabId,scrapeRunSourceUrl:scheduledScrapeSourceKey(cfg.sourceUrl),scrapeRequestedSourceUrl:cfg.sourceUrl,scrapeSkipAds:cfg.skipAds,scrapeStartedAt:Date.now(),scrapeStatus:t("sch.launching"),scrapeCount:0,scrapeReady:false,scrapeHasData:false});
      break;
    case "feed":{
      const prefix=scheduledFeedPrefix(cfg.source);
      await chrome.storage.local.set({[`${prefix}Active`]:true,[`${prefix}RunId`]:runId,[`${prefix}Config`]:{...ownerCfg,source:prefix.slice(4).toLowerCase()},[`${prefix}Count`]:0,[`${prefix}Status`]:t("sch.launching"),[`pendingFeed${prefix.slice(4)}`]:true,[`pendingFeed${prefix.slice(4)}Config`]:{...ownerCfg,source:prefix.slice(4).toLowerCase()}});
      break;
    }
    case "aiFeed":
      await chrome.storage.local.set({isAICommenting:true,pendingAIComment:true,pendingAIConfig:{...ownerCfg},aiCount:0,aiFeedReloadAttempts:0,aiStatus:t("sch.launching")});
      break;
    case "groupInteract":
      await chrome.storage.local.set({groupInteractActive:true,groupInteractRunId:runId,groupInteractConfig:ownerCfg,groupInteractIndex:0,groupInteractDone:0,groupInteractAiDone:0,groupInteractTotal:cfg.groups.length*cfg.perGroup,groupInteractCurrentGroupIndex:0,groupInteractCurrentGroupDone:0,groupInteractCurrentGroupAiDone:0,groupInteractReactedKeys:{},groupInteractReactionGuard:{},groupInteractCommentGuard:{},groupInteractStatus:t("sch.launching"),...(cfg.followup?{groupCommentFollowupConfig:cfg.followup,groupBothActive:true}:{})});
      break;
    case "groupComment":
      {
        // Lịch chỉ khởi tạo counter/run state; history và submission guard là
        // dữ liệu chống trùng/audit của người dùng, không được reset mỗi lần
        // alarm chạy (giữ nguyên type object và toàn bộ mục đã có).
        const previous=await chrome.storage.local.get(["groupCommentHistory","groupCommentSubmissionGuard"]);
        const history=previous.groupCommentHistory&&typeof previous.groupCommentHistory==="object"&&!Array.isArray(previous.groupCommentHistory)?previous.groupCommentHistory:{};
        const submissionGuard=previous.groupCommentSubmissionGuard&&typeof previous.groupCommentSubmissionGuard==="object"&&!Array.isArray(previous.groupCommentSubmissionGuard)?previous.groupCommentSubmissionGuard:{};
        await chrome.storage.local.set({groupCommentActive:true,groupCommentRunId:runId,groupCommentConfig:ownerCfg,groupCommentIndex:0,groupCommentDone:0,groupCommentTotal:cfg.groups.length*cfg.perGroup,groupCommentCurrentGroupIndex:0,groupCommentCurrentGroupDone:0,groupCommentHistory:history,groupCommentSubmissionGuard:submissionGuard,groupCommentProcessedKeys:[],groupCommentRetryCounts:{},groupCommentSkipped:{},groupCommentStatus:t("sch.launching")});
      }
      break;
    case "groupPost":
      await chrome.storage.local.set({groupPostActive:true,groupPostRunId:runId,groupPostConfig:ownerCfg,groupPostIndex:0,groupPostDone:0,groupPostSkipped:0,groupPostTotal:cfg.groups.length,groupPostNextAt:0,groupPostLastColor:"",groupPostRetryCount:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStage:"",groupPostSubmitRunId:"",groupPostSubmitIndex:-1,groupPostSubmitDispatchedAt:0,groupPostStatus:t("sch.launching")});
      break;
    case "keyword":
      await chrome.storage.local.set({isGroupJoining:true,groupJoined:0,groupFound:0,groupJoinRunConfig:ownerCfg,groupStatus:t("sch.launching")});
      break;
    case "discover":
      await chrome.storage.local.set({isDiscoverJoining:true,discoverJoined:0,discoverRunConfig:ownerCfg,discoverStatus:t("sch.launching")});
      break;
    case "share":
      await chrome.storage.local.set({groupShareActive:true,groupShareConfig:ownerCfg,groupShareRunId:runId,groupShareOwnerTabId:tabId,groupShareStage:cfg.manualSourceText?"groups":"source",groupShareSourceText:cfg.manualSourceText||"",groupShareSourceKey:"",groupShareSourceResolvedUrl:cfg.manualSourceText?cfg.sourceUrl:"",groupShareSourceMediaKeys:[],groupSharePreviewRejected:false,groupSharePreviewKey:"",groupSharePreviewLinks:[],groupSharePreviewImages:[],groupShareSourceNavigationAt:Date.now(),groupShareIndex:0,groupShareDone:0,groupShareSkipped:0,groupShareTotal:cfg.groups.length,groupShareNextAt:0,groupSharePendingCaption:"",groupSharePendingIndex:-1,groupShareRecentCaptions:[],groupShareSubmitDispatchedAt:0,groupShareStatus:t("sch.launching")});
      break;
    case "sales":
      await chrome.storage.local.set({salesPostActive:true,salesPostRunId:runId,salesPostOwnerTabId:tabId,salesPostConfig:ownerCfg,salesPostIndex:0,salesPostDone:0,salesPostSkipped:0,salesPostTotal:salesScheduledPostCount(cfg),salesPostNextAt:0,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:t("sch.launching")});
      break;
    case "trendLearn":
      await chrome.storage.local.set({trendLearnActive:true,trendLearnRunId:runId,trendLearnOwnerTabId:tabId,trendLearnConfig:ownerCfg,trendLearnIndex:0,trendLearnPosts:[],trendLearnCount:0,trendLearnReady:false,trendLearnOutline:"",trendRewriteDrafts:[],trendLastDiag:null,trendLearnStatus:t("sch.launching")});
      break;
    case "trendPost":
      await chrome.storage.local.set({trendPostActive:true,trendPostRunId:runId,trendPostOwnerTabId:tabId,trendPostConfig:ownerCfg,trendPostIndex:0,trendPostDone:0,trendPostSkipped:0,trendPostTotal:cfg.jobs.length,trendPostNextAt:0,trendPostLastColor:"",trendPostStage:"",trendPostSubmitIndex:-1,trendPostSubmitDispatchedAt:0,trendPostAnonymousMode:cfg.anonymousMode?"anonymous":"normal",trendPostStatus:t("sch.launching")});
      break;
    case "pageGroupJoin":
      await chrome.storage.local.set({pageGroupJoinActive:true,pageGroupJoinRunId:runId,pageGroupJoinOwnerTabId:tabId,pageGroupJoinConfig:ownerCfg,pageGroupJoinRunState:{active:true,runId,ownerTabId:tabId,config:ownerCfg,joined:0,skipped:0,attemptedKeys:[],nextAllowedAt:Date.now()+cfg.minDelay*1000,status:t("sch.launching")},pageGroupJoinJoined:0,pageGroupJoinSkipped:0,pageGroupJoinAttemptedKeys:[],pageGroupJoinNextAt:Date.now()+cfg.minDelay*1000,pageGroupJoinStatus:t("sch.launching")});
      break;
    case "pageGroupPost":
      await chrome.storage.local.set({pageGroupPostActive:true,pageGroupPostRunId:runId,pageGroupPostOwnerTabId:tabId,pageGroupPostConfig:ownerCfg,pageGroupPostDone:0,pageGroupPostSkipped:0,pageGroupPostIndex:0,pageGroupPostStatus:t("sch.launching")});
      break;
    case "pageNewsWall":
      await chrome.storage.local.set({pageNewsWallActive:true,pageNewsWallActiveRunId:runId,pageNewsWallOwnerTabId:tabId,pageNewsWallConfig:ownerCfg,pageNewsWallDone:0,pageNewsWallSkipped:0,pageNewsWallIndex:0,pageNewsWallStatus:t("sch.launching")});
      break;
    case "pageComment":
      await chrome.storage.local.set({pageCommentActive:true,pageCommentRunId:runId,pageCommentOwnerTabId:tabId,pageCommentConfig:ownerCfg,pageCommentDone:0,pageCommentPageIndex:0,pageCommentStatus:t("sch.launching")});
      break;
    case "pageSales":
      await chrome.storage.local.set({pageSalesPostActive:true,pageSalesPostRunId:runId,pageSalesPostOwnerTabId:tabId,pageSalesPostConfig:ownerCfg,pageSalesPostDone:0,pageSalesPostSkipped:0,pageSalesPostIndex:0,pageSalesPostTotal:salesScheduledPostCount(cfg),pageSalesPostStatus:t("sch.launching")});
      break;
    case "pageGroupComment":
      await chrome.storage.local.set({pageGroupCommentActive:true,pageGroupCommentRunId:runId,pageGroupCommentOwnerTabId:tabId,pageGroupCommentConfig:ownerCfg,pageGroupCommentDone:0,pageGroupCommentSkipped:0,pageGroupCommentIndex:0,pageGroupCommentGroupDone:0,pageGroupCommentStatus:t("sch.launching")});
      break;
    case "friendReengage":
      {const old=await chrome.storage.local.get("friendReengageCycle");await chrome.storage.local.set({friendReengageActive:true,friendReengageRunId:runId,friendReengageOwnerTabId:tabId,friendReengageConfig:ownerCfg,friendReengageCycle:(Number(old.friendReengageCycle)||0)+1,friendReengageCursor:"",friendReengageIndex:0,friendReengageDoneLike:0,friendReengageDoneComment:0,friendReengageDoneStory:0,friendReengageSkipped:0,friendReengageStatus:t("sch.launching")});}
      break;
    case "newsWall":
      await chrome.storage.local.set({newsWallActive:true,newsWallRunId:runId,newsWallOwnerTabId:tabId,newsWallConfig:ownerCfg,newsWallDone:0,newsWallSkipped:0,newsWallStatus:t("sch.launching")});
      break;
    case "fbStory":
      await chrome.storage.local.set({fbStoryActive:true,fbStoryRunId:runId,fbStoryOwnerTabId:tabId,fbStoryConfig:ownerCfg,fbStoryDone:0,fbStorySkipped:0,fbStoryStatus:t("sch.launching")});
      break;
    case "fbReels":
      await chrome.storage.local.set({fbReelsActive:true,fbReelsRunId:runId,fbReelsOwnerTabId:tabId,fbReelsConfig:ownerCfg,fbReelsDone:0,fbReelsSkipped:0,fbReelsStatus:t("sch.launching")});
      break;
  }
}
function scheduledStartMessage(task,cfg,tabId){
  const base={ownerTabId:tabId};
  switch(task.feature){
    case "friend":return {action:cfg.mode==="confirm"?"friendConfirmStart":cfg.mode==="friend-of-friend"?"friendFoFStart":"friendStart",config:cfg,...base};
    case "scrape":return {action:"startScrape",count:cfg.count,skipAds:cfg.skipAds,sourceUrl:cfg.sourceUrl,...base};
    case "feed":return {action:"startFeedScoped",source:cfg.source,...cfg,...base};
    case "aiFeed":return {action:"startAIComment",...cfg,...base};
    case "groupInteract":return {action:"startGroupInteract",...cfg,...base};
    case "groupComment":return {action:"startGroupComment",...cfg,...base};
    case "groupPost":return {action:"startGroupPost",...cfg,...base};
    case "keyword":return {action:"startGroupJoin",...cfg,...base};
    case "discover":return {action:"startDiscoverJoin",...cfg,...base};
    case "share":return {action:"resumeGroupShare",...base};
    case "sales":return {action:"startSalesPost",runId:cfg.runId,config:cfg,...base};
    case "trendLearn":return {action:"startTrendLearn",runId:cfg.runId,config:cfg,...base};
    case "trendPost":return {action:"startTrendPost",runId:cfg.runId,config:cfg,...base};
    case "newsWall":return {action:"startNewsWallPost",runId:cfg.runId,config:cfg,...base};
    case "fbStory":return {action:"startFbStory",runId:cfg.runId,config:cfg,...base};
    case "fbReels":return {action:"startFbReels",runId:cfg.runId,config:cfg,...base};
    case "pageGroupJoin":return {action:"startPageGroupJoin",config:cfg,joined:0,skipped:0,attemptedKeys:[],nextAllowedAt:Date.now()+cfg.minDelay*1000,...base};
    case "pageGroupPost":return {action:"startPageGroupPost",config:cfg,runId:cfg.runId,...base};
    case "pageNewsWall":return {action:"startPageNewsWall",config:cfg,runId:cfg.runId,...base};
    case "pageComment":return {action:"startPageComment",config:cfg,runId:cfg.runId,...base};
    case "pageSales":return {action:"startPageSalesPost",config:cfg,runId:cfg.runId,...base};
    case "pageGroupComment":return {action:"startPageGroupComment",config:cfg,runId:cfg.runId,...base};
    case "friendReengage":return {action:"startFriendReengage",config:cfg,runId:cfg.runId,...base};
    default:return null;
  }
}
async function waitScheduledFeatureActive(tabId,task,timeout=9000){
  const activeKey=scheduledActiveKey(task)||task.feature;
  const until=Date.now()+timeout;
  while(Date.now()<until){
    const state=await chrome.storage.local.get(activeKey);
    if(state[activeKey])return true;
    await wait(650);
  }
  return false;
}
async function launchScheduledTask(task,preferredTabId=0){
  if(await hasActiveFeature())throw new Error("Đang có một tính năng khác chạy");
  const aiConfig=await resolveAiProfile(task.config?.profileId);
  const resolvedConfig=await resolveScheduledAutoGroups(task.feature,task.config||{});
  const cfg={...resolvedConfig,aiConfig,runId:`schedule-${task.feature}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`};
  // Lịch tin hẹn giờ FB: giờ hẹn tuyệt đối có thể đã qua lúc lịch nổ (đặt từ
  // chiều cho chuỗi đêm, hoặc lịch đơn tới trễ) → dời về +60p làm tròn khung
  // 5 phút, giữ nguyên gap các bài sau. Không đụng giờ tương lai tốt.
  if(task.feature==="newsWall"&&cfg.publishMode==="fbSchedule"){
    const base=Math.max(0,parseInt(cfg.fbScheduleAt)||0);
    if(base<Date.now()+30*60000){
      const d=new Date(Date.now()+60*60000);
      d.setSeconds(0,0);d.setMinutes(Math.ceil(d.getMinutes()/5)*5);
      cfg.fbScheduleAt=d.getTime();
    }
  }
  const safeAi={provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url};
  const safeCfg={...resolvedConfig,aiConfig:safeAi,runId:cfg.runId};
  const runtimeCfg=task.feature==="keyword"||task.feature==="discover"?cfg:safeCfg;
  const url=scheduledTargetUrl(task,runtimeCfg);
  const tab=await scheduleFacebookTab(preferredTabId);
  if(!tab?.id)throw scheduledError("SCHEDULE_TAB_UNAVAILABLE","Không mở được tab Facebook");
  if(!/^page/.test(String(task.feature||""))){
    const actor=await scheduledEnsurePersonalActor(tab.id);
    if(actor&&actor.ok===false)throw scheduledError("SCHEDULE_WRONG_ACTOR",t("gj.actingAsPage",{name:actor.page||"?"}));
    if(actor&&actor.switched){
      try{await logActivity(task.feature,t("gj.switchedToPersonal"));}catch{}
      await waitForTabReady(tab.id,20000);
      await wait(4500);
    }
  }
  await persistScheduledFeatureState(task,runtimeCfg,tab.id,cfg.runId);
  // Persist first, subscribe to onUpdated second, then navigate. This makes
  // automatic resume and the direct Start message reliable after a cold load.
  const loaded=await navigateScheduledTab(tab.id,url);
  const current=await chrome.tabs.get(tab.id).catch(()=>null);
  const onExpectedRoute=!!current?.url&&scheduledRouteMatches(task,runtimeCfg,current.url);
  if(!loaded||!onExpectedRoute)throw scheduledError("SCHEDULE_ROUTE_FAILED","Tab Facebook chưa tải đúng trang của lịch");
  // Xác minh lần cuối sau navigation. Đổi actor trước navigation chỉ là ý
  // định; proof phải đến từ DOM của chính route sắp chạy.
  if(!/^page/.test(String(task.feature||""))){
    const finalActor=await scheduledEnsurePersonalActor(tab.id);
    if(finalActor&&finalActor.ok===false)throw scheduledError("SCHEDULE_WRONG_ACTOR","Không xác minh được nick cá nhân sau khi mở route lịch");
    if(finalActor?.switched){
      await waitForTabReady(tab.id,20000);
      await wait(4500);
      const checkedAgain=await scheduledEnsurePersonalActor(tab.id);
      if(!checkedAgain?.verified)throw scheduledError("SCHEDULE_WRONG_ACTOR","Không xác minh được nick cá nhân sau khi chuyển actor");
    }
  }
  const message=scheduledStartMessage(task,runtimeCfg,tab.id);
  const response=await sendScheduledStart(tab.id,message);
  if(response===null)throw scheduledError("SCHEDULE_NOT_DELIVERED","Tab Facebook chưa nhận được lệnh khởi động");
  const activeKey=scheduledActiveKey(task),activeState=await chrome.storage.local.get(activeKey);
  if(response&&response.ok===false&&!activeState[activeKey])throw scheduledError("SCHEDULE_START_REJECTED",response.msg||response.error||"Không thể khởi động lịch");
  if(!await waitScheduledFeatureActive(tab.id,task))throw scheduledError("SCHEDULE_ACTIVE_NOT_HELD","Tab Facebook chưa giữ được phiên chạy của lịch");
  return {tabId:tab.id,runId:cfg.runId};
}

const scheduledChainLocks=new Set();
const scheduledChainProgressThrottle=new Map();
async function armScheduledChain(id,when=Date.now()+60000){
  const name=scheduleChainAlarmName(id);
  await chrome.alarms.clear(name);
  chrome.alarms.create(name,{when:Math.max(Date.now()+1000,Number(when)||Date.now()+60000),periodInMinutes:SCHEDULE_CHAIN_TICK_MINUTES});
}
async function disarmScheduledChain(id){await chrome.alarms.clear(scheduleChainAlarmName(id));}
async function updateScheduledChain(id,change){const result=await setScheduledTask(id,change);syncChainKeepAwake().catch(()=>{});return result;}
// Chuỗi "chạy xuyên đêm" vô nghĩa nếu máy ngủ: alarm không nổ, heartbeat đứng,
// tới sáng chuỗi chỉ chạy được một đoạn. Giữ máy thức trong lúc còn chuỗi đang
// chạy và nhả ra ngay khi xong để không giữ pin vô ích.
const CHAIN_AWAKE_STATUSES=["scheduled","waiting","starting","running","stopping"];
let chainKeepAwakeOn=false;
async function syncChainKeepAwake(){
  if(!chrome.power?.requestKeepAwake)return;
  let want=false;
  try{
    const tasks=await scheduledTasks();
    want=tasks.some(item=>item.kind==="chain"&&CHAIN_AWAKE_STATUSES.includes(item.status));
  }catch(_){return;}
  if(want===chainKeepAwakeOn)return;
  try{
    if(want)chrome.power.requestKeepAwake("system");
    else chrome.power.releaseKeepAwake();
    chainKeepAwakeOn=want;
  }catch(_){ }
}
async function chainTaskById(id){return (await scheduledTasks()).find(item=>item.id===id&&item.kind==="chain")||null;}
async function scheduleChainStateForStep(step){
  const activeKey=scheduledActiveKey(step),keys=[...new Set([activeKey,...SCHEDULE_CHAIN_STATE_KEYS])];
  return chrome.storage.local.get(keys);
}
async function transitionScheduledChainAfterFailure(chain,error){
  const message=scheduleSafeText(error||"Bước không hoàn tất");
  const failedStep=chain.steps?.[chain.currentIndex];
  // Bỏ một bước hỏng mà để nguyên cờ "đang chạy" của nó thì
  // startScheduledChainStep() luôn thấy hasActiveFeature() = true và hoãn bước
  // kế tiếp mãi mãi. Phải dọn cờ SAU khi đã ghi trạng thái mới: xoá cờ làm
  // storage.onChanged bắn, listener đó cập nhật lastProgressAt cho chuỗi đang
  // "running" bằng bản đọc cũ và ghi đè ngược trạng thái vừa chuyển.
  const releaseFailedStep=async()=>{
    if(!failedStep)return;
    try{
      const stepTask=scheduleChainStepTask(chain,failedStep);
      const action=scheduleChainStopAction(stepTask);
      if(action&&chain.ownerTabId){
        await sendScheduledTabMessage(chain.ownerTabId,{action,...(stepTask?.feature==="feed"?{source:stepTask.config?.source||"friends"}:{})});
      }
      const activeKey=scheduledActiveKey(stepTask);
      if(activeKey)await chrome.storage.local.set({[activeKey]:false});
    }catch(_){ }
  };
  const failedSteps=chain.steps.map((item,index)=>index===chain.currentIndex?{...item,status:"failed",error:message,finishedAt:Date.now()}:item);
  const nextIndex=chain.currentIndex+1;
  if(["continue","auto"].includes(chain.onFailure)&&nextIndex<chain.steps.length){
    const nextRunAt=Date.now()+scheduleChainStepGap(chain,failedStep)*1000;
    await updateScheduledChain(chain.id,{status:"waiting",steps:failedSteps,currentIndex:nextIndex,nextRunAt,error:message,lastProgressAt:Date.now(),resumeAllowed:false});
    await releaseFailedStep();
    await armScheduledChain(chain.id,nextRunAt);
    await logActivity(failedStep?.feature||"chain",`[chuỗi ${chain.id}: bước ${chain.currentIndex+1}/${chain.steps.length} "${failedStep?.label||failedStep?.feature||""}" lỗi, tự chuyển bước tiếp theo] ${message}`);
    return true;
  }
  if(["continue","auto"].includes(chain.onFailure)){
    await updateScheduledChain(chain.id,{status:"completed_with_errors",steps:failedSteps,error:message,finishedAt:Date.now(),lastProgressAt:Date.now(),resumeAllowed:false});
    await releaseFailedStep();
    await disarmScheduledChain(chain.id);
    await logActivity(failedStep?.feature||"chain",`[chuỗi ${chain.id}: kết thúc có lỗi ở bước cuối "${failedStep?.label||failedStep?.feature||""}"] ${message}`);
    return false;
  }
  await updateScheduledChain(chain.id,{status:"needs_attention",steps:failedSteps,error:message,finishedAt:Date.now(),resumeAllowed:false});
  await releaseFailedStep();
  await disarmScheduledChain(chain.id);
  await logActivity(failedStep?.feature||"chain",`[chuỗi ${chain.id}: DỪNG HẲN, cần người dùng xử lý] bước ${chain.currentIndex+1}/${chain.steps.length} "${failedStep?.label||failedStep?.feature||""}": ${message}`);
  return false;
}
async function startScheduledChainStep(chain){
  const step=chain.steps?.[chain.currentIndex];
  if(!step)throw new Error("Chuỗi không còn bước hợp lệ");
  if(await hasActiveFeature()){
    await updateScheduledChain(chain.id,{status:"waiting",nextRunAt:Date.now()+SCHEDULE_CHAIN_RETRY_MS,error:"Đang chờ phiên hiện tại hoàn tất"});
    await armScheduledChain(chain.id,Date.now()+SCHEDULE_CHAIN_RETRY_MS);
    return {deferred:true};
  }
  const attempt=(step.attempt||0)+1;
  const steps=chain.steps.map((item,index)=>index===chain.currentIndex?{...item,status:"starting",attempt,lastAttemptAt:Date.now()}:item);
  await updateScheduledChain(chain.id,{status:"starting",steps,error:"",nextRunAt:0});
  const task=scheduleChainStepTask(chain,{...step,status:"starting"});
  try{
    const launched=await launchScheduledTask(task,chain.ownerTabId);
    const runningSteps=steps.map((item,index)=>index===chain.currentIndex?{...item,status:"running",startedAt:Date.now(),runId:launched.runId}:item);
    await updateScheduledChain(chain.id,{status:"running",steps:runningSteps,ownerTabId:launched.tabId,heartbeatAt:Date.now(),lastProgressAt:Date.now(),stepStartedAt:Date.now(),recoveryCount:0,resumeAllowed:true,error:""});
    await armScheduledChain(chain.id);
    return {started:true};
  }catch(error){
    const message=scheduleSafeText(error?.message||error);
    const busy=/Đang có một tính năng khác chạy/.test(message);
    if(busy){
      await updateScheduledChain(chain.id,{status:"waiting",nextRunAt:Date.now()+SCHEDULE_CHAIN_RETRY_MS,error:message});
      await armScheduledChain(chain.id,Date.now()+SCHEDULE_CHAIN_RETRY_MS);
      return {deferred:true};
    }
    // launchScheduledTask writes the feature's resume state before navigation.
    // If navigation/message delivery fails, clear only this feature's active
    // flag so the chain retry cannot wait forever on a phantom run.
    const statusKey=scheduleChainStatusKey(task),activeKey=scheduleChainActiveKey(task);
    await chrome.storage.local.set({[activeKey]:false,...(statusKey?{[statusKey]:t("sch.launchFailed",{error:message})}:{})}).catch(()=>{});
    if(chain.onFailure==="auto"&&scheduleChainRetryableStartError(error)&&attempt<SCHEDULE_CHAIN_MAX_START_ATTEMPTS){
      const retryAt=Date.now()+scheduleChainRetryDelay(attempt);
      const retrySteps=steps.map((item,index)=>index===chain.currentIndex?{...item,status:"queued",error:message,lastError:message,nextAttemptAt:retryAt}:item);
      await updateScheduledChain(chain.id,{status:"waiting",steps:retrySteps,nextRunAt:retryAt,error:`Tự thử lại lần ${attempt}/${SCHEDULE_CHAIN_MAX_START_RETRIES}: ${message}`});
      await armScheduledChain(chain.id,retryAt);
      return {retrying:true};
    }
    await transitionScheduledChainAfterFailure(chain,message);
    return {failed:true};
  }
}
async function recoverScheduledChainTab(chain,step){
  const now=Date.now();
  let tab=await chrome.tabs.get(chain.ownerTabId).catch(()=>null);
  if(!tab?.id)throw new Error("Tab Facebook của chuỗi không còn tồn tại");
  const recoveryCount=Math.max(0,parseInt(chain.recoveryCount)||0);
  if(recoveryCount>=SCHEDULE_CHAIN_MAX_RECOVERIES)throw new Error("Tab Facebook không phản hồi sau nhiều lần khôi phục");
  const hbBefore=Math.max(Number(chain.heartbeatAt)||0,Number(chain.lastProgressAt)||0);
  const settled=async(timeoutMs)=>{
    const end=Date.now()+timeoutMs;
    while(Date.now()<end){
      const c=await chainTaskById(chain.id).catch(()=>null);
      const hb=Math.max(Number(c?.heartbeatAt)||0,Number(c?.lastProgressAt)||0);
      if(hb>hbBefore)return true;
      await new Promise(r=>setTimeout(r,Math.min(5000,end-Date.now())));
    }
    return false;
  };
  // Cấp 1: reload tab hiện tại (nhẹ, giữ nguyên ownerTabId).
  try{await chrome.tabs.reload(tab.id);}catch(_){}
  await updateScheduledChain(chain.id,{status:"running",ownerTabId:tab.id,recoveryCount:recoveryCount+1,lastRecoveryAt:Date.now(),heartbeatAt:Date.now(),error:"Đã reload tab để khôi phục phiên chạy"});
  if(await settled(90000))return true;
  // Cấp 2: tab cũ đã chết hẳn (renderer treo/crash, reload không cứu được) —
  // đóng nó, mở tab mới và chạy tiếp ở đó (resume theo ownerTabId mới).
  // Bắt live 18/10: reload mãi không có heartbeat mới, chuỗi gãy oan.
  try{await chrome.tabs.remove(tab.id);}catch(_){}
  try{
    const task=scheduleChainStepTask(chain,step);
    const url=scheduledTargetUrl(task,task.config||{})||"https://www.facebook.com/";
    const fresh=await chrome.tabs.create({url,active:false});
    await updateScheduledChain(chain.id,{status:"running",ownerTabId:fresh.id,recoveryCount:recoveryCount+1,lastRecoveryAt:Date.now(),heartbeatAt:Date.now(),error:"Đã mở tab mới để khôi phục phiên chạy"});
    if(await settled(90000))return true;
  }catch(_){}
  throw new Error("Tab Facebook không phản hồi sau nhiều lần khôi phục (đã thử tab mới)");
}
async function superviseScheduledChain(id){
  if(scheduledChainLocks.has(id))return;
  scheduledChainLocks.add(id);
  try{
    let chain=await chainTaskById(id);
    if(!chain||!["scheduled","waiting","starting","running","stopping"].includes(chain.status))return;
    if(chain.status==="scheduled"||chain.status==="waiting"){
      const due=Number(chain.nextRunAt||chain.runAt);
      if(Number.isFinite(due)&&Date.now()<due)return;
      await startScheduledChainStep(chain);
      return;
    }
    const step=chain.steps?.[chain.currentIndex];
    if(!step)return;
    const task=scheduleChainStepTask(chain,step),activeKey=scheduledActiveKey(task),state=await scheduleChainStateForStep(task);
    if(chain.status==="starting"&&!state[activeKey]){
      const startedAt=Number(step.lastAttemptAt||chain.lastRunAt||Date.now());
      if(Date.now()-startedAt<30000)return;
      await transitionScheduledChainAfterFailure(chain,"Bước không giữ được active flag sau khi khởi động");
      return;
    }
    if(state[activeKey]){
      // The document heartbeat and feature progress are intentionally
      // separate. A live content script must not mask a feature that has
      // stopped changing its counter/proof; that was the failure mode where
      // Comment AI stayed active forever with a draft and 0/N progress.
      const now=Date.now();
      // Máy ngủ, Chrome đóng băng tab nền hoặc service worker bị treo lâu đều
      // làm heartbeat/progress đứng im dù KHÔNG có gì hỏng. Nếu chính bộ giám
      // sát cũng ngừng tick quá lâu thì đó là dấu hiệu bị treo hệ thống: lấy
      // lại mốc thời gian và bỏ qua lượt này thay vì đốt một lượt khôi phục
      // (3 lượt là chuỗi chết hẳn tới sáng).
      const lastTickAt=Number(chain.lastTickAt)||0;
      const supervisorGap=lastTickAt>0?now-lastTickAt:0;
      if(supervisorGap>SCHEDULE_CHAIN_HEARTBEAT_TIMEOUT_MS){
        await updateScheduledChain(chain.id,{lastTickAt:now,heartbeatAt:now,lastProgressAt:now,stepStartedAt:now,error:""});
        return;
      }
      await updateScheduledChain(chain.id,{lastTickAt:now});
      const heartbeatAt=Math.max(Number(chain.heartbeatAt)||0,Number(chain.stepStartedAt)||0);
      const progressAt=Math.max(Number(chain.lastProgressAt)||0,Number(chain.stepStartedAt)||0);
      const heartbeatStale=now-heartbeatAt>SCHEDULE_CHAIN_HEARTBEAT_TIMEOUT_MS;
      const progressStale=now-progressAt>SCHEDULE_CHAIN_PROGRESS_TIMEOUT_MS;
      const recoveryCoolingDown=Number(chain.lastRecoveryAt)>0&&now-Number(chain.lastRecoveryAt)<SCHEDULE_CHAIN_HEARTBEAT_TIMEOUT_MS;
      // Khôi phục đã thành công và chuỗi chạy ổn định trở lại => trả lại lượt.
      // Không có bước này thì 3 trục trặc thoáng qua cách nhau nhiều giờ trong
      // một đêm cũng đủ giết chuỗi.
      if(!heartbeatStale&&!progressStale&&Number(chain.recoveryCount)>0
        &&Number(chain.lastRecoveryAt)>0&&now-Number(chain.lastRecoveryAt)>SCHEDULE_CHAIN_PROGRESS_TIMEOUT_MS){
        await updateScheduledChain(chain.id,{recoveryCount:0});
        return;
      }
      if((heartbeatStale||progressStale)&&!recoveryCoolingDown){
        try{await recoverScheduledChainTab(chain,step);}catch(error){
          // Hết lượt khôi phục KHÔNG được mặc định dừng hẳn: chuỗi xuyên đêm
          // chạy lúc người dùng không ngồi máy, mà needs_attention lại huỷ
          // alarm nên chuỗi nằm im tới sáng. Đi theo đúng chính sách onFailure
          // người dùng đã chọn ("auto"/"continue" => bỏ bước hỏng, chạy tiếp);
          // chỉ onFailure="stop" mới dừng chờ người xử lý.
          await transitionScheduledChainAfterFailure(chain,error?.message||error);
        }
      }
      return;
    }
    if(chain.status==="stopping"||chain.cancelRequested){
      const steps=chain.steps.map((item,index)=>index===chain.currentIndex?{...item,status:"cancelled",finishedAt:Date.now()}:item);
      await updateScheduledChain(chain.id,{status:"cancelled",steps,finishedAt:Date.now(),error:""});
      await disarmScheduledChain(chain.id);
      return;
    }
    if(!scheduleChainCompletionEvidence(task,state)){
      await transitionScheduledChainAfterFailure(chain,"Phiên đã dừng nhưng chưa có đủ bằng chứng hoàn tất; không tự chạy bước tiếp theo");
      return;
    }
    const completedSteps=chain.steps.map((item,index)=>index===chain.currentIndex?{...item,status:"completed",finishedAt:Date.now()}:item);
    if(chain.currentIndex>=chain.steps.length-1){
      await updateScheduledChain(chain.id,{status:"completed",steps:completedSteps,finishedAt:Date.now(),lastProgressAt:Date.now(),error:""});
      await disarmScheduledChain(chain.id);
      return;
    }
    const nextIndex=chain.currentIndex+1,nextRunAt=Date.now()+scheduleChainStepGap(chain,chain.steps[chain.currentIndex])*1000;
    await updateScheduledChain(chain.id,{status:"waiting",steps:completedSteps.map((item,index)=>index===nextIndex?{...item,status:"queued"}:item),currentIndex:nextIndex,nextRunAt,lastProgressAt:Date.now(),error:""});
    await armScheduledChain(chain.id,nextRunAt);
  }finally{scheduledChainLocks.delete(id);}
}
async function fireScheduledTask(id){
  const task=(await scheduledTasks()).find(item=>item.id===id);
  if(!task||task.status!=="scheduled")return;
  if(task.kind==="chain"){
    await updateScheduledChain(id,{status:"waiting",nextRunAt:Date.now(),lastRunAt:Date.now(),error:""});
    await armScheduledChain(id,Date.now()+1000);
    await superviseScheduledChain(id);
    return;
  }
  await setScheduledTask(id,{status:"starting",lastRunAt:Date.now(),error:""});
  try{
    await launchScheduledTask(task);
    await setScheduledTask(id,{status:"started",startedAt:Date.now()});
  }catch(error){
    const blocked=/Đang có một tính năng khác chạy/.test(String(error?.message||error));
    await setScheduledTask(id,{status:blocked?"blocked":"failed",error:scheduleSafeText(error?.message||error),finishedAt:Date.now()});
    // Do not leave an active flag behind if this scheduler itself failed before
    // a feature was able to receive its Start message.
    if(!blocked){
      const detail=String(error?.message||error);
      const statusKey=task.feature==="friend"?(task.config?.mode==="confirm"?"friendConfirmStatus":task.config?.mode==="friend-of-friend"?"friendFoFStatus":"friendStatus"):task.feature==="feed"?`${scheduledFeedPrefix(task.config?.source)}Status`:{friend:"friendStatus",scrape:"scrapeStatus",aiFeed:"aiStatus",groupInteract:"groupInteractStatus",groupComment:"groupCommentStatus",groupPost:"groupPostStatus",keyword:"groupStatus",discover:"discoverStatus",share:"groupShareStatus",sales:"salesPostStatus",trendLearn:"trendLearnStatus",trendPost:"trendPostStatus",pageGroupJoin:"pageGroupJoinStatus",pageGroupPost:"pageGroupPostStatus",pageComment:"pageCommentStatus",pageSales:"pageSalesPostStatus",pageGroupComment:"pageGroupCommentStatus"}[task.feature];
      await chrome.storage.local.set({[scheduledActiveKey(task)]:false,...(statusKey?{[statusKey]:t("sch.launchFailed",{error:detail})}:{})});
    }
  }
}
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name.startsWith(SCHEDULE_CHAIN_ALARM_PREFIX))superviseScheduledChain(alarm.name.slice(SCHEDULE_CHAIN_ALARM_PREFIX.length));
  else if(alarm.name.startsWith(SCHEDULE_ALARM_PREFIX))fireScheduledTask(alarm.name.slice(SCHEDULE_ALARM_PREFIX.length));
});
async function restoreScheduleAlarms(){
  // Reloading an unpacked MV3 extension can discard its alarms.  Rebuild all
  // future alarms from the durable task record instead of trusting the old
  // alarm to still exist. This is also safe after a worker suspension.
  const now=Date.now();
  const tasks=await scheduledTasks();
  let changed=false;
  for(const task of tasks){
    if(task.kind==="chain"){
      // Reloading the worker/extension/Chrome must not strand a chain: rebuild
      // its tick alarm from the durable record instead of trusting the old
      // alarm. Terminal states (cancelled/completed/completed_with_errors) and
      // needs_attention/failed (which require an explicit scheduleChainResume)
      // are left alone — arming them here could restart a step the user has
      // not agreed to resume.
      if(["cancelled","completed","completed_with_errors","needs_attention","failed"].includes(task.status))continue;
      if(task.status==="scheduled"){
        const decision=scheduleRestoreDecision(task.runAt,now);
        if(decision.kind==="invalid"){
          task.status="failed";task.error="Thời điểm bắt đầu chuỗi không hợp lệ; hãy tạo chuỗi mới";task.finishedAt=now;changed=true;continue;
        }
        if(decision.kind==="expired"){
          task.status="failed";task.error="Đã quá giờ bắt đầu chuỗi; hãy tạo chuỗi mới";task.finishedAt=now;changed=true;continue;
        }
        await chrome.alarms.clear(scheduleChainAlarmName(task.id));
        chrome.alarms.create(scheduleChainAlarmName(task.id),{when:decision.when,periodInMinutes:SCHEDULE_CHAIN_TICK_MINUTES});
        continue;
      }
      // waiting/starting/running/stopping: re-arm immediately so the next tick
      // lets superviseScheduledChain re-evaluate heartbeat/progress itself —
      // it already fails closed to needs_attention when the owner tab or
      // completion proof cannot be confirmed after a restart.
      await chrome.alarms.clear(scheduleChainAlarmName(task.id));
      chrome.alarms.create(scheduleChainAlarmName(task.id),{when:now+2000,periodInMinutes:SCHEDULE_CHAIN_TICK_MINUTES});
      continue;
    }
    if(task.status!=="scheduled")continue;
    const decision=scheduleRestoreDecision(task.runAt,now);
    if(decision.kind==="invalid"){
      task.status="failed";
      task.error="Thời điểm lịch không hợp lệ; hãy tạo lịch mới";
      task.finishedAt=now;
      changed=true;
      continue;
    }
    const name=scheduleAlarmName(task.id);
    if(decision.kind==="expired"){
      task.status="failed";
      task.error="Đã quá giờ chạy; hãy tạo lịch mới";
      task.finishedAt=now;
      changed=true;
      continue;
    }
    // A same-name alarm may carry a stale time from before reload.
    await chrome.alarms.clear(name);
    chrome.alarms.create(name,{when:decision.when});
  }
  if(changed)await saveScheduledTasks(tasks);
}
restoreScheduleAlarms().catch(()=>{});
chrome.runtime.onStartup.addListener(()=>{restoreScheduleAlarms().catch(()=>{});syncChainKeepAwake().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{restoreScheduleAlarms().catch(()=>{});syncChainKeepAwake().catch(()=>{});});

// Khi tab FB bị đóng/navigate, reset activeKey của feed scoped để tránh bị kẹt mãi
chrome.tabs.onRemoved.addListener(async(tabId)=>{
  try{
    const stored=await chrome.storage.local.get(["feedFriendsConfig","feedGroupsConfig","feedPagesConfig","feedFriendsActive","feedGroupsActive","feedPagesActive"]);
    const patch={};
    if(stored.feedFriendsActive&&stored.feedFriendsConfig?.ownerTabId===tabId)patch.feedFriendsActive=false;
    if(stored.feedGroupsActive&&stored.feedGroupsConfig?.ownerTabId===tabId)patch.feedGroupsActive=false;
    if(stored.feedPagesActive&&stored.feedPagesConfig?.ownerTabId===tabId)patch.feedPagesActive=false;
    if(Object.keys(patch).length)await chrome.storage.local.set(patch);
  }catch(_){}
});

// (Slice 1: da go relay test CDP va kenh onMessageExternal — xem FORK-CHANGES.md)

// The content-script bridge supplies liveness without owning any feature
// state. Persist only a throttled heartbeat so a popup is not redrawn every
// 15 seconds and a worker restart can still reconstruct the watchdog state.
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.action!=="overnightHeartbeat")return;
  (async()=>{
    const tabId=sender.tab?.id;
    if(tabId===undefined){sendResponse({ok:false});return;}
    const now=Date.now(),tasks=await scheduledTasks();
    const chain=tasks.find(item=>item.kind==="chain"&&item.status==="running"&&Number(item.ownerTabId)===Number(tabId));
    if(chain){
      const last=scheduledChainProgressThrottle.get(chain.id)||0;
      if(now-last>=30000){
        scheduledChainProgressThrottle.set(chain.id,now);
        await setScheduledTask(chain.id,{heartbeatAt:now,lastProgressAt:chain.lastProgressAt||now});
      }
    }
    sendResponse({ok:true});
  })().catch(()=>sendResponse({ok:false}));
  return true;
});

// Any progress write from the current feature counts as activity, while the
// feature's own proof still decides whether the step may complete. This is a
// supervisor signal only; it does not change counters or selectors.
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  mirrorStatusToActivityLog(changes);
  const changedKeys=Object.keys(changes);
  if(!changedKeys.some(key=>SCHEDULE_CHAIN_STATE_KEYS.includes(key)))return;
  scheduledTasks().then(tasks=>{
    const now=Date.now();
    tasks.filter(item=>item.kind==="chain"&&item.status==="running").forEach(chain=>{
      const last=scheduledChainProgressThrottle.get(`progress:${chain.id}`)||0;
      if(now-last<10000)return;
      scheduledChainProgressThrottle.set(`progress:${chain.id}`,now);
      setScheduledTask(chain.id,{lastProgressAt:now}).catch(()=>{});
    });
  }).catch(()=>{});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  if(msg.action==="logActivityFromPopup"){
    logActivity(String(msg.feature||"info"),String(msg.msg||""),msg.level||undefined);
    sendResponse({ok:true});
    return false;
  }
  if(msg.action==="scanJoinedGroupsStart"){
    (async()=>{
      try{
        const tabId=Number(msg.tabId);
        if(!tabId)throw new Error(t("p.giLoadGroupsNoTab"));
        sendResponse(await runJoinedGroupsScan(tabId,msg.pageActorUrl||null,msg.pageKey||null,msg.pageData||null));
      }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}
    })();
    return true;
  }
  if(msg.action==="scheduleCreate"){
    (async()=>{try{
      const isChain=msg.task?.kind==="chain";
      const task=isChain?normalizeScheduledChain(msg.task):normalizeScheduledTask(msg.task);
      const tasks=await scheduledTasks();
      tasks.push(task);await saveScheduledTasks(tasks);
      if(isChain)await armScheduledChain(task.id,task.runAt);
      else chrome.alarms.create(scheduleAlarmName(task.id),{when:task.runAt});
      sendResponse({ok:true,task});
    }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}})();
    return true;
  }
  if(msg.action==="scheduleChainResume"){
    (async()=>{try{const task=await chainTaskById(String(msg.id||""));if(!task)throw new Error("Không tìm thấy chuỗi");if(!["needs_attention","failed"].includes(task.status))throw new Error("Chuỗi chưa ở trạng thái cần tiếp tục");const step=task.steps?.[task.currentIndex],stepTask=step?scheduleChainStepTask(task,step):null,activeKey=stepTask&&scheduledActiveKey(stepTask),state=activeKey?await chrome.storage.local.get(activeKey):{};if(task.resumeAllowed===false&&!state[activeKey])throw new Error("Bước trước dừng mà chưa có completion proof; không tự chạy lại để tránh trùng hành động");await updateScheduledChain(task.id,{status:"waiting",nextRunAt:Date.now()+1000,error:"",recoveryCount:0,resumeAllowed:true});await armScheduledChain(task.id,Date.now()+1000);sendResponse({ok:true});}catch(error){sendResponse({ok:false,error:String(error?.message||error)});}})();
    return true;
  }
  if(msg.action==="scheduleChainStop"){
    (async()=>{try{
      const task=await chainTaskById(String(msg.id||""));if(!task)throw new Error("Không tìm thấy chuỗi");
      await chrome.alarms.clear(scheduleAlarmName(task.id));await chrome.alarms.clear(scheduleChainAlarmName(task.id));
      const step=task.steps?.[task.currentIndex],stepTask=step?scheduleChainStepTask(task,step):null,action=stepTask&&scheduleChainStopAction(stepTask);
      if(["scheduled","waiting"].includes(task.status)){await updateScheduledChain(task.id,{status:"cancelled",cancelledAt:Date.now(),error:""});sendResponse({ok:true});return;}
      if(task.status==="needs_attention"){
        const activeKey=stepTask&&scheduledActiveKey(stepTask),state=activeKey?await chrome.storage.local.get(activeKey):{};
        if(!activeKey||!state[activeKey]){await updateScheduledChain(task.id,{status:"cancelled",cancelledAt:Date.now(),error:""});sendResponse({ok:true});return;}
      }
      await updateScheduledChain(task.id,{status:"stopping",cancelRequested:true,error:"Đang dừng bước hiện tại"});
      if(action&&task.ownerTabId)await sendScheduledTabMessage(task.ownerTabId,{action,...(stepTask?.feature==="feed"?{source:stepTask.config?.source||"friends"}: {})});
      await armScheduledChain(task.id,Date.now()+1000);sendResponse({ok:true});
    }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}})();
    return true;
  }
  if(msg.action==="scheduleCancel"||msg.action==="scheduleRemove"){
    (async()=>{try{const id=String(msg.id||"");await chrome.alarms.clear(scheduleAlarmName(id));await chrome.alarms.clear(scheduleChainAlarmName(id));const tasks=await scheduledTasks();const index=tasks.findIndex(task=>task.id===id);if(index<0)throw new Error("Không tìm thấy lịch chạy");if(tasks[index].kind==="chain"&&tasks[index].status==="running")throw new Error("Chuỗi đang chạy; dùng nút Dừng chuỗi");if(msg.action==="scheduleRemove")tasks.splice(index,1);else tasks[index]={...tasks[index],status:"cancelled",cancelledAt:Date.now()};await saveScheduledTasks(tasks);sendResponse({ok:true});}catch(error){sendResponse({ok:false,error:String(error?.message||error)});}})();
    return true;
  }
  if(msg.action==="pageStore"){
    (async()=>{
      try{
        if(!globalThis.PageStore)throw new Error("Page Care database unavailable");
        const op=String(msg.op||"list"),store=String(msg.store||"");
        if(op==="put")sendResponse({ok:true,value:await PageStore.put(store,msg.value||{})});
        else if(op==="get")sendResponse({ok:true,value:await PageStore.get(store,msg.id)});
        else if(op==="list")sendResponse({ok:true,values:await PageStore.list(store,msg.limit)});
        else if(op==="remove")sendResponse({ok:true,value:await PageStore.remove(store,msg.id)});
        else if(op==="clear")sendResponse({ok:true,value:await PageStore.clear(store)});
        else throw new Error("Unknown Page Care database operation");
      }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}
    })();
    return true;
  }
  if(msg.action==="scrapeStore"){
    (async()=>{
      try{
        if(!globalThis.ScrapeStore)throw new Error("Scrape database unavailable");
        const op=String(msg.op||"list"),store=String(msg.store||"");
        if(op==="put")sendResponse({ok:true,value:await ScrapeStore.put(store,msg.value||{})});
        else if(op==="get")sendResponse({ok:true,value:await ScrapeStore.get(store,msg.id)});
        else if(op==="list")sendResponse({ok:true,values:await ScrapeStore.list(store,msg.limit)});
        else if(op==="remove")sendResponse({ok:true,value:await ScrapeStore.remove(store,msg.id)});
        else if(op==="clear")sendResponse({ok:true,value:await ScrapeStore.clear(store)});
        else if(op==="listPosts")sendResponse({ok:true,values:await ScrapeStore.listPosts(msg.datasetId,msg.limit)});
        else if(op==="removePosts")sendResponse({ok:true,value:await ScrapeStore.removePosts(msg.datasetId)});
        else if(op==="listMedia")sendResponse({ok:true,values:await ScrapeStore.listMedia(msg.datasetId,msg.limit)});
        else if(op==="removeMedia")sendResponse({ok:true,value:await ScrapeStore.removeMedia(msg.datasetId)});
        else if(op==="saveRun")sendResponse({ok:true,value:await ScrapeStore.saveRun(msg.dataset||{},msg.posts||[])});
        else throw new Error("Unknown Scrape database operation");
      }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}
    })();
    return true;
  }
  if(msg.action==="scrapeMedia"){
    (async()=>{
      try{
        if(!globalThis.ScrapeStore)throw new Error("Scrape database unavailable");
        const op=String(msg.op||"");
        if(op==="captureImages"){
          const {datasetId="",postKey="",urls=[],maxBytes=10*1024*1024,limit=50}=msg;
          const saved=[],failed=[];
          const dedup=[...new Set((Array.isArray(urls)?urls:[]).map(String).filter(Boolean))].slice(0,limit);
          for(const url of dedup){
            try{
              const res=await fetchWithTimeout(url,{method:"GET"},30000);
              if(!res.ok)throw new Error("HTTP "+res.status);
              const blob=await res.blob();
              if(blob.size>maxBytes)throw new Error("too large");
              const mime=String(blob.type||"").split(";")[0]||"image/jpeg";
              const id=`${datasetId}::${postKey}::img::${hashStringForMedia(url)}`;
              await ScrapeStore.put("media",{id,datasetId,postKey,kind:"image",mime,bytes:blob.size,sourceUrl:url,blob,capturedAt:Date.now(),status:"stored"});
              saved.push(url);
            }catch(e){ failed.push({url,error:String(e?.message||e)}); }
          }
          sendResponse({ok:true,saved,failed});
        }else if(op==="putVideoUrl"){
          const {datasetId="",postKey="",url="",posterUrl="",durationText=""}=msg;
          const clean=String(url||"").trim();
          if(!clean)throw new Error("Empty video url");
          // id dedup theo URL chuan hoa (cat query/token) de khong luu trung
          const normKey=clean.split(/[?#]/)[0].toLowerCase();
          const id=`${datasetId}::${postKey}::vid::${hashStringForMedia(normKey)}`;
          await ScrapeStore.put("media",{id,datasetId,postKey,kind:"video",mime:"video/mp4",bytes:0,sourceUrl:clean,posterUrl:String(posterUrl||""),durationText:String(durationText||""),capturedAt:Date.now(),status:"url-only"});
          sendResponse({ok:true,id});
        }else if(op==="putPoster"){
          const {datasetId="",postKey="",url="",maxBytes=10*1024*1024}=msg;
          const clean=String(url||"").trim();
          if(!clean)throw new Error("Empty poster url");
          try{
            const res=await fetchWithTimeout(clean,{method:"GET"},30000);
            if(!res.ok)throw new Error("HTTP "+res.status);
            const blob=await res.blob();
            if(blob.size>maxBytes)throw new Error("too large");
            const mime=String(blob.type||"").split(";")[0]||"image/jpeg";
            const id=`${datasetId}::${postKey}::poster::${hashStringForMedia(clean)}`;
            await ScrapeStore.put("media",{id,datasetId,postKey,kind:"poster",mime,bytes:blob.size,sourceUrl:clean,blob,capturedAt:Date.now(),status:"stored"});
            sendResponse({ok:true,id});
          }catch(e){sendResponse({ok:false,error:String(e?.message||e)});}
        }else throw new Error("Unknown scrapeMedia operation");
      }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}
    })();
    return true;
  }
  function hashStringForMedia(value){
    const s=String(value||"");let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;
    return (Math.abs(h)>>>0).toString(36);
  }
  if(msg.action==="aiGeneratePageGroupPost"){
    (async()=>{
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const own0=msg.aiConfig||{};
        // Resume sau reload chỉ còn provider+profileId (key đã strip): resolve
        // key tươi từ hồ sơ giống luồng sales, không rớt về default sai provider.
        if(!own0.key&&own0.profileId){
          try{
            const rp=await resolveAiProfile(own0.profileId);
            if(rp&&(rp.key||rp.model||rp.provider==="meta-free"))Object.assign(own0,{provider:rp.provider||own0.provider,key:rp.key,model:own0.model||rp.model,url:own0.url||rp.url});
          }catch(_){}
        }
        const ai=await getPageAiConfig(own0);
        const isMetaFree=ai.provider==="meta-free";
        if(!isMetaFree){
          if(!ai.key)throw new Error(t("bg.noKeyProv",{provider:ai.provider}));
          if(!ai.model)throw new Error(t("bg.noModelProv",{provider:ai.provider}));
        }
        if(ai.provider==="custom"&&!ai.url)throw new Error(t("bg.noCustomUrlAi"));
        const groupName=String(msg.groupName||"").trim().slice(0,180),pageName=String(msg.pageName||"").trim().slice(0,180);
        const recent=(Array.isArray(msg.recentPosts)?msg.recentPosts:[]).map((text,i)=>`${i+1}. ${String(text||"").replace(/\s+/g," ").trim().slice(0,900)}`).filter(Boolean).slice(0,8).join("\n");
        const template=String(msg.prompt||t("pgp.promptDefault"))
          .replaceAll("{groupName}",groupName).replaceAll("{pageName}",pageName).replaceAll("{recentPosts}",recent||t("pgp.noRecent"));
        const maxChars=Number(msg.maxChars)||0;
        const minChars=maxChars>0?Math.round(maxChars*0.75):0;
        const targetMin=maxChars>0?Math.round(maxChars*0.88):0;
        const lengthRule=maxChars>0?`ĐộDài: nhắm đúng ${targetMin}–${maxChars} ký tự (bao gồm dấu cách). Không vượt quá ${maxChars} ký tự. Đây là yêu cầu bắt buộc để áp dụng nền màu.`:``;

        const prompt=[groupTopicAnchorBlock(groupName),await nextGroupPostAngleLine(),template,pageProfilePromptContext(msg.pageProfile),["YÊU CẦU: Chỉ trả về duy nhất nội dung bài đăng. Viết tự nhiên, tạo thảo luận đúng chủ đề nhóm, không bịa số liệu, không sao chép nguyên văn bài khác, không hashtag, không URL, không giải thích của AI.",lengthRule].filter(Boolean).join(" ")].filter(Boolean).join("\n\n");
        async function callAI(p){
          if(ai.provider==="meta-free")return callMetaFreeText(p,"page-group-post");
          if(ai.provider==="gemini")return callGemini(ai.key,ai.model,"",p,false);
          if(ai.provider==="claude"||ai.provider==="Muse")return callClaude(ai.key,ai.model,"",p,false);
          const def=AI_DEFAULTS[ai.provider]||AI_DEFAULTS.openai;
          return callOpenAICompatible(ai.key,ai.url||def.url,ai.model||def.model,"",p,false);
        }
        let raw=await callAI(prompt);
        let content=cleanPageGroupPost(raw);
        // Retry tối đa 2 lần nếu AI trả về rỗng (timeout/rate limit tạm thời)
        for(let emptyRetry=0;!content&&emptyRetry<2;emptyRetry++){
          await new Promise(r=>setTimeout(r,3000+emptyRetry*2000));
          raw=await callAI(prompt);
          content=cleanPageGroupPost(raw);
        }
        if(!content)throw new Error(t("bg.contentEmpty"));
        if(maxChars>0)content=fitGroupPostToBackground(content,maxChars);
        if(!content)throw new Error(t("bg.contentEmpty"));
        if(groupPostHasScaffolding(content))throw new Error(t("bg.scaffoldContent"));
        // Retry tối đa 2 lần nếu quá ngắn
        for(let attempt=0;attempt<2&&minChars>0&&[...content].length<minChars;attempt++){
          const cur=[...content].length;
          const retryPrompt=`Viết lại bài đăng sau, thêm chi tiết cụ thể, ví dụ thực tế hoặc mở rộng câu hỏi để đạt đúng ${minChars}–${maxChars} ký tự (hiện tại chỉ ${cur} ký tự, cần thêm ${minChars-cur} ký tự nữa). Giữ giọng tự nhiên, không giải thích. Chỉ trả về nội dung bài. Bài gốc: "${content}"`;
          const raw2=await callAI(retryPrompt);
          const c2=cleanPageGroupPost(raw2);
          if(c2){
            const fitted=fitGroupPostToBackground(c2,maxChars);
            if(fitted&&[...fitted].length>[...content].length)content=fitted;
          }
        }
        sendResponse({ok:true,content,provider:ai.provider,model:ai.model});
      }catch(error){
        // Lưu mẫu raw bị gate chặn (vòng 5) để chẩn đoán lệch pattern mà không
        // cần tái hiện live — chỉ text rút gọn, không secret.
        try{
          if(error&&error.code==="AI_EMPTY"&&error.rawSample){
            chrome.storage.local.get(["pageGroupPostBlocked"]).then(s=>{
              const arr=Array.isArray(s.pageGroupPostBlocked)?s.pageGroupPostBlocked:[];
              arr.push({at:Date.now(),group:String(msg.groupName||"").slice(0,80),raw:String(error.rawSample||"").slice(0,220)});
              chrome.storage.local.set({pageGroupPostBlocked:arr.slice(-5)}).catch(()=>{});
            }).catch(()=>{});
          }
        }catch(_){}
        sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});
      }
    })();
    return true;
  }
  if(msg.action==="aiGeneratePageComment"){
    (async()=>{
      try{
        const ai=await getPageAiConfig(msg.aiConfig||{});
        const isMetaFreePageComment=ai.provider==="meta-free";
        if(!isMetaFreePageComment){
          if(!ai.key)throw new Error(t("bg.noKeyProv",{provider:ai.provider}));
          if(!ai.model)throw new Error(t("bg.noModelProv",{provider:ai.provider}));
        }
        if(ai.provider==="custom"&&!ai.url)throw new Error(t("bg.noCustomUrlAi"));
        const postText=String(msg.postText||"").replace(/\s+/g," ").trim().slice(0,2200),pageName=String(msg.pageName||"").trim().slice(0,180);
        if(postText.length<10)throw new Error(t("bg.postTooShort"));
        const template=String(msg.prompt||t("pgc.promptDefault")).replaceAll("{postText}",postText).replaceAll("{pageName}",pageName).replaceAll("{source}",String(msg.source||"Bản tin"));
        let prompt=[template,pageProfilePromptContext(msg.pageProfile)].filter(Boolean).join("\n\n");
        if(Number(msg.maxLines)===2){try{const pl=await nextTagPositionLine();if(pl)prompt+="\n\n"+pl;}catch(_){}}
        let raw="";
        if(ai.provider==="meta-free")raw=await callMetaFreeText(prompt,"page-comment");
        else if(ai.provider==="gemini")raw=await callGemini(ai.key,ai.model,postText,prompt,true);
        else if(ai.provider==="claude"||ai.provider==="Muse")raw=await callClaude(ai.key,ai.model,postText,prompt,true);
        else{const def=AI_DEFAULTS[ai.provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(ai.key,ai.url||def.url,ai.model||def.model,postText,prompt,true);}
        const comment=cleanGeneratedComment(raw,msg.maxLines);
        if(!comment)throw new Error(t("bg.aiEmpty"));
        if(Number(msg.maxLines)===2&&!commentSharesPostDetail(comment,postText))throw Object.assign(new Error(t("bg.noPostDetail")),{aiEmpty:true,code:"AI_EMPTY"});
        sendResponse({ok:true,comment,provider:ai.provider,model:ai.model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="getUnifiedAiConfigForFeature"){
    (async()=>{
      try{
        const ai=await getPageAiConfig({});
        sendResponse({ok:true,config:{provider:ai.provider,model:ai.model,url:ai.url,key:ai.key}});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateFeedComment"){
    (async()=>{
      try{
        const ai=await getPageAiConfig(msg.aiConfig||{});
        const isMetaFree=ai.provider==="meta-free";
        // meta-free không cần key/model (hỏi qua tab meta.ai đã login).
        if(!isMetaFree){
          if(!ai.key)throw new Error(t("bg.noKeyProv",{provider:ai.provider}));
          if(!ai.model)throw new Error(t("bg.noModelProv",{provider:ai.provider}));
        }
        if(ai.provider==="custom"&&!ai.url)throw new Error(t("bg.noCustomUrlAi"));
        const postText=String(msg.postText||"").replace(/\s+/g," ").trim().slice(0,1500);
        if(postText.length<10)throw new Error(t("bg.postTooShort"));
        const template=String(msg.prompt||t("bg.commentDefaultFull"))
          .replaceAll("{postText}",postText);
        const profileContext=await getActiveStyleContext(msg.styleProfileId||"");
        let prompt=[template,profileContext,t("bg.commentRules")]
          .filter(Boolean).join("\n\n");
        if(Number(msg.maxLines)===2){try{const pl=await nextTagPositionLine();if(pl)prompt+="\n\n"+pl;}catch(_){}}
        const raw=await callConfiguredText(ai.provider,ai.key,ai.model,ai.url,postText,prompt,null,msg.metaFeature||"feed-comment");
        const comment=cleanGeneratedComment(raw,msg.maxLines);
        if(!comment)throw new Error(t("bg.aiEmpty"));
        if(Number(msg.maxLines)===2&&!commentSharesPostDetail(comment,postText))throw Object.assign(new Error(t("bg.noPostDetail")),{aiEmpty:true,code:"AI_EMPTY"});
        sendResponse({ok:true,comment,provider:ai.provider,model:ai.model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="fetchFbEntityName"){
    (async()=>{
      let tabId=null;
      try{
        const url=String(msg.url||"");
        if(!url.includes("facebook.com"))throw new Error("Không phải URL Facebook");
        const tab=await chrome.tabs.create({url,active:false});
        tabId=tab.id;
        await new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(fn);reject(new Error("Timeout tải trang"));},15000);
          function fn(id,info){if(id===tabId&&info.status==="complete"){chrome.tabs.onUpdated.removeListener(fn);clearTimeout(timeout);resolve();}}
          chrome.tabs.onUpdated.addListener(fn);
        });
        // Trang nền render chậm (panel thông báo chứa tên thật tới sau):
        // chờ 4s thay vì 1.8s để resolver khỏi vớ mốc thời gian rác.
        await new Promise(r=>setTimeout(r,4000));
        const results=await chrome.scripting.executeScript({
          target:{tabId},
          args:[url],
          func:(targetUrl)=>{
            const targetPath=(()=>{try{return new URL(targetUrl,location.href).pathname.replace(/\/+$/i,"").toLowerCase()||"/";}catch{return "";}})();
            // Strip cả tiền tố đếm chưa đọc "(5) " / "(20+) " — title tab khi
            // login luôn có dạng "(N) Facebook" khiến resolver trước đây trả tên
            // rác "(20+) Facebook" (bắt live 11/10: refetch ToNgheMeme).
            const clean=s=>String(s||"").replace(/^\s*\(\d+\+?\)\s*/,"").replace(/\s*[|–\-]\s*Facebook\s*$/i,"").replace(/\s*-\s*Facebook\s*$/i,"").trim();
            // "Đoạn chat" (và các nhãn chat/UI khác) từng lọt qua đây rồi lưu thành
            // tên entity, gây tag sai hàng loạt (bắt live Bảng tin 10/10: page
            // ToNgheMeme bị lưu tên "Đoạn chat"). Những nhãn này không bao giờ
            // là tên Page/Nhóm thật.
            // innerText của Facebook hay lẫn \xa0/xuống dòng/dấu cách đôi
            // ("Mới\xa0Xem tất cả" lọt qua regex dù "Mới Xem tất cả" đã có
            // trong danh sách — bắt live refetch page ToNgheMeme) nên chuẩn
            // hóa khoảng trắng trước khi so khớp.
            const normName=s=>String(s||"").replace(/\s+/g," ").trim();
            // Facebook đôi khi render panel Thông báo/Chat trước header thật
            // của entity. Các chuỗi này có thể trông như một tên dài nhưng là
            // UI state (bắt live: "Chưa đọc... đã theo dõi bạn" bị lưu thành
            // tên Page). Không bao giờ coi chúng là tên tag hợp lệ.
            const isUiFragment=s=>/(?:^|\s)(?:chưa\s*đọc|đã\s*đọc|unread|read)\b/i.test(normName(s))
              || /(?:đã\s*theo\s*dõi\s*bạn|followed\s*you|đã\s*nhắc\s*đến\s*bạn|mentioned\s*you|has\s*mentioned\s*you|đã\s*thích\s*bài|liked\s*your|đã\s*bình\s*luận|commented\s*on|và\s+\d+\s+người\s+khác|and\s+\d+\s+others)/i.test(normName(s));
            // Mốc thời gian bài viết ("1 phút", "5h", "2 ngày") không bao giờ
            // là tên Page/Nhóm (bắt live refetch page ToNgheMeme).
            const isTimestamp=s=>/^\d+\s*(?:phút|phut|giờ|gio|giây|giay|ngày|ngay|tuần|tuan|tháng|thang|năm|nam|sec(?:onds?)?|s|min(?:ute)?s?|m|h(?:ours?|rs?)?|d(?:ays?)?|w(?:eeks?)?|mo(?:nths?)?|y(?:ears?)?)$/i.test(normName(s));
            // Hàng thông báo của FB dán tên sau mốc thời gian ("41 phút ·
            // Truyền Thông Meme") — tách lấy phần tên thật thay vì bỏ cả cụm.
            const splitStampedName=s=>{
              const t=normName(s);
              let m=t.match(/^\d+\s*(?:\S+\s*)?[·•]\s*(.+)$/)||t.match(/^(.+?)\s*[·•]\s*\d+\s*\S*$/);
              return m?m[1].trim():"";
            };
            const isGeneric=s=>isUiFragment(s)||isTimestamp(s)||/^\(\d+\+?\)\s*facebook$/i.test(normName(s))
              // Các thẻ meta của bài Facebook đôi khi bị lấy nhầm làm tên Page,
              // ví dụ "1 cảm xúc · 1 phản hồi". Không được lưu chuỗi này rồi
              // đưa vào prompt/tag, vì nó là UI rác chứ không phải entity.
              ||/^\d+\s*(?:cảm xúc|phản hồi|likes?|comments?)(?:\s*[·•]\s*\d+\s*(?:cảm xúc|phản hồi|likes?|comments?))*$/i.test(normName(s))
              // Một biến thể khác ghép cả mốc thời gian của bài vào trước
              // cụm thống kê (ví dụ "41 phút·1 cảm xúc · 1 phản hồi").
              // Đây vẫn là metadata của bài, tuyệt đối không phải tên Page/nhóm.
              ||/^\d+\s*(?:phút|phut|giờ|gio|giây|giay|ngày|ngay|tuần|tuan|tháng|thang|năm|nam|sec(?:onds?)?|s|min(?:ute)?s?|m|h(?:ours?|rs?)?|d(?:ays?)?|w(?:eeks?)?|mo(?:nths?)?|y(?:ears?)?)?\s*[·•]\s*\d+\s*(?:cảm xúc|phản hồi|likes?|comments?)(?:\s*[·•]\s*\d+\s*(?:cảm xúc|phản hồi|likes?|comments?))*$/i.test(normName(s))
              ||/^(quản lý trang|manage page|home|trang chủ|bảng điều khiển|thông tin chi tiết|công cụ lập kế hoạch|kiếm tiền|trung tâm quảng cáo|tạo quảng cáo|cài đặt|notifications?|facebook|messenger|thông báo|trang chủ|bạn bè|nhóm|videos?|reels?|giới thiệu|about|events?|xem thêm|tìm kiếm|tất cả|all|mới nhất|mới|most recent|recent|bài viết|posts?|đáng chú ý|featured|chưa đọc|unread|đã đọc|tin nhắn đã đọc|xem tất cả|see all|mới xem tất cả|đoạn chat(?: chung)?|cuộc trò chuyện|tin nhắn|hộp thư|chat|conversation|bình luận|comment|thích|like|chia sẻ|share|theo dõi|follow)$/i.test(normName(s));
            // og:title
            const og=document.querySelector('meta[property="og:title"]')?.content;
            if(og&&!isGeneric(og))return clean(og);
            // title tag
            const title=clean(document.title);
            if(title&&title.toLowerCase()!=="facebook"&&!isGeneric(title))return title;
            // Ảnh đại diện Page có aria-label "Ảnh đại diện của <Tên>" — chính
            // xác hơn mọi heading (heading hay vớ phải tab lọc/chrome labels).
            for(const el of document.querySelectorAll('[aria-label]')){
              const m=String(el.getAttribute("aria-label")||"").match(/^(?:ảnh đại diện của|profile picture of|photo of)\s+(.+)$/i);
              if(m&&m[1].trim().length>=2&&m[1].trim().length<=80&&!isGeneric(m[1]))return m[1].trim();
            }
            // Tên ứng viên: thử tách mốc thời gian trước ("41 phút · Tên"),
            // rồi mới xét chuỗi thô. Cả hai đều phải qua isGeneric.
            const candidateName=txt=>{
              const raw=String(txt||"").trim();
              if(!raw||raw.length<3||raw.length>160)return "";
              const split=splitStampedName(raw);
              const best=(split&&split.length>=3&&split.length<=80&&!isGeneric(split))?split:"";
              if(best)return best;
              if(raw.length<=80&&!/^\d+$/.test(raw)&&!isGeneric(raw))return raw;
              return "";
            };
            // Ưu tiên tên nằm trong link có cùng pathname với URL người dùng
            // nhập. Không quét toàn bộ sidebar trước, vì sidebar có thể chứa
            // tên Page đang quản lý hoặc nhãn Thông báo của một tài khoản khác.
            if(targetPath){
              for(const a of document.querySelectorAll('a[href]')){
                try{
                  const path=new URL(a.href,location.href).pathname.replace(/\/+$/i,"").toLowerCase()||"/";
                  if(path!==targetPath)continue;
                  const name=candidateName(a.innerText||a.textContent);
                  if(name)return name;
                }catch{}
              }
            }
            // Khi Facebook đổi vanity URL sau redirect, dùng tên trong câu
            // chuyển sang Page của chính profile, không dùng tên ở sidebar.
            const bodyText=normName(document.body?.textContent||"");
            const switchMatch=bodyText.match(/(?:chuyển\s+sang\s+trang\s+của|switch\s+to\s+page\s+)([^.]{2,100}?)(?:\s+để|\s+to\s+)/i);
            if(switchMatch){const name=candidateName(switchMatch[1]);if(name)return name;}
            // scan heading trước (tên Page thường là heading lớn nhất), rồi mới
            // tới strong/span — tab lọc ("Tất cả") hay đứng trước trong DOM.
            for(const el of document.querySelectorAll('h1,[role="heading"]')){
              const name=candidateName(el.innerText||el.textContent);
              if(name)return name;
            }
            for(const el of document.querySelectorAll('strong,span[dir]')){
              const name=candidateName(el.innerText||el.textContent);
              if(name)return name;
            }
            return null;
          }
        });
        await chrome.tabs.remove(tabId).catch(()=>{});tabId=null;
        const name=results?.[0]?.result;
        if(!name)throw new Error("Không tìm thấy tên — thử mở trang và copy tên thủ công");
        sendResponse({ok:true,name});
      }catch(e){
        if(tabId)chrome.tabs.remove(tabId).catch(()=>{});
        sendResponse({ok:false,error:e.message});
      }
    })();
    return true;
  }
  if(msg.action==="aiClassifyFeedPost"){
    (async()=>{
      try{
        const ai=await getPageAiConfig(msg.aiConfig||{});
        const postText=String(msg.postText||"").replace(/\s+/g," ").trim().slice(0,1500);
        // Không có key/model hoặc nội dung quá ngắn: bỏ qua lớp kiểm duyệt AI
        // một cách im lặng, không chặn luồng chính. Bộ lọc từ khóa trong
        // feed.js vẫn luôn hoạt động độc lập với lớp này.
        // meta-free không cần key/model (hỏi qua tab meta.ai đã login).
        if((!ai.key||!ai.model)&&ai.provider!=="meta-free"){sendResponse({ok:true,sensitive:false});return;}
        if(postText.length<10){sendResponse({ok:true,sensitive:false});return;}
        const prompt=t("bg.moderationPrompt",{postText});
        const raw=await callConfiguredText(ai.provider,ai.key,ai.model,ai.url,postText,prompt,null,"moderation");
        const answer=String(raw||"").trim().toUpperCase();
        const sensitive=/NHAY.?CAM|NHẠY.?CẢM|SENSITIVE/.test(answer);
        sendResponse({ok:true,sensitive});
      }catch(error){
        // Lỗi mạng/API/hết quota khi gọi lớp kiểm duyệt AI không được chặn
        // luồng Like/Comment chính; chỉ bỏ qua lớp kiểm duyệt bổ sung này.
        sendResponse({ok:true,sensitive:false,error:String(error?.message||error).slice(0,200)});
      }
    })();
    return true;
  }
  if(msg.action==="getSenderTabId"){
    sendResponse({tabId:sender.tab?.id||null});
    return true;
  }
  if(msg.action==="friendReengageAmIOwner"){
    (async()=>{
      try{
        const s=await chrome.storage.local.get(["friendReengageActive","friendReengageRunId","friendReengageOwnerTabId"]);
        const owner=Number(s.friendReengageOwnerTabId)||0;
        const myTab=Number(sender.tab?.id)||0;
        if(!s.friendReengageActive){sendResponse({ok:false,reason:"inactive"});return;}
        if(s.friendReengageRunId&&msg.runId&&s.friendReengageRunId!==msg.runId){sendResponse({ok:false,reason:"run-mismatch"});return;}
        if(owner&&myTab&&owner!==myTab){sendResponse({ok:false,reason:"not-owner"});return;}
        sendResponse({ok:true,tabId:myTab});
      }catch(e){sendResponse({ok:false,reason:String(e&&e.message||e)});}
    })();
    return true;
  }
  if(msg.action==="friendWarmAmIOwner"){
    (async()=>{
      try{
        const s=await chrome.storage.local.get(["friendWarmActive","friendWarmRunId","friendWarmOwnerTabId"]);
        const owner=Number(s.friendWarmOwnerTabId)||0;
        const myTab=Number(sender.tab?.id)||0;
        if(!s.friendWarmActive){sendResponse({ok:false,reason:"inactive"});return;}
        if(s.friendWarmRunId&&msg.runId&&s.friendWarmRunId!==msg.runId){sendResponse({ok:false,reason:"run-mismatch"});return;}
        if(owner&&myTab&&owner!==myTab){sendResponse({ok:false,reason:"not-owner"});return;}
        sendResponse({ok:true,tabId:myTab});
      }catch(e){sendResponse({ok:false,reason:String(e&&e.message||e)});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateCommentBatch"){
    (async()=>{try{
      const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiPrompt","aiCustomUrl","aiKeys"]);
      const ownB=(msg.aiConfig&&typeof msg.aiConfig==="object")?msg.aiConfig:{},provider=ownB.provider||cfg.aiProvider||"gemini",saved=ownB.key?{}:(cfg.aiKeys?.[provider]||{});
      const key=normalizeApiKey(ownB.key||saved.key||cfg.aiApiKey||""),model=ownB.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=ownB.url||saved.url||cfg.aiCustomUrl||"";
      if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
      const posts=(msg.posts||[]).slice(0,10).map((p,i)=>({id:i+1,text:String(p||"").replace(/\s+/g," ").trim().slice(0,500)}));
      if(!posts.length)throw new Error(t("bg.noPosts"));
      const style=(cfg.aiPrompt||t("bg.commentDefaultStyle")).replaceAll("{postText}",t("bg.eachPost")),profileContext=await getActiveStyleContext();
      // meta-free không có batch API: hỏi từng bài nối tiếp qua hàng đợi chung.
      // Dùng prompt của phiên gọi tới (tab AI), không phải prompt legacy toàn
      // cục — và luôn đảm bảo nội dung bài đi kèm (bắt live: template thiếu
      // placeholder khiến Meta nhận chỉ dẫn suông, comment chung chung).
      if(provider==="meta-free"){
        const perStyle=String(msg.prompt||cfg.aiPrompt||t("bg.commentDefaultStyle"));
        const comments=[];
        for(const p of posts){
          const perPrompt=[buildMetaFreePrompt(p.text,perStyle),profileContext].filter(Boolean).join("\n\n");
          const one=cleanGeneratedComment(await callMetaFreeText(perPrompt,"comment"));
          if(!one)throw new Error(t("bg.batchEmpty"));
          comments.push(one);
        }
        sendResponse({ok:true,comments});
        return;
      }
      const prompt=`${style}${profileContext?`\n${profileContext}`:""}\n${t("bg.batchPrompt",{n:posts.length})}\n${JSON.stringify(posts)}`;
      let raw="";
      if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
      else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,"",prompt,false);
      else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
      let comments;try{comments=JSON.parse(String(raw).replace(/```json|```/gi,"").trim());}catch{comments=String(raw).split(/\r?\n/).map(s=>s.replace(/^[-*\d.)\s]+/,"").trim()).filter(Boolean);}
      if(!Array.isArray(comments)||comments.length<posts.length)throw new Error(t("bg.batchShort"));
      comments=comments.slice(0,posts.length).map(cleanGeneratedComment);
      if(comments.some(c=>!c))throw new Error(t("bg.batchEmpty"));
      sendResponse({ok:true,comments});
    }catch(e){sendResponse({ok:false,error:friendlyAiError(e,"AI")});}})();return true;
  }
  if(msg.action==="aiAnswerJoinQuestions"){
    (async()=>{try{
      const own=msg.aiConfig||{},provider=own.provider||"gemini",key=normalizeApiKey(own.key),model=own.model||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||"";
      if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyJoin"));
      const groupName=String(msg.groupName||"").slice(0,150);
      // Chuẩn hoá câu hỏi: chuỗi thuần, hoặc {text, options} khi nơi gọi có
      // sẵn lựa chọn trắc nghiệm (đáp án trắc nghiệm = nguyên văn 1 lựa chọn).
      const qList=(msg.questions||[]).slice(0,20).map(q=>{
        if(q&&typeof q==="object")return {text:String(q.text||q.question||"").replace(/\s+/g," ").trim().slice(0,400),options:(Array.isArray(q.options)?q.options:[]).map(o=>String(o).replace(/\s+/g," ").trim().slice(0,120)).filter(Boolean).slice(0,8)};
        return {text:String(q||"").replace(/\s+/g," ").trim().slice(0,400),options:[]};
      }).filter(q=>q.text);
      if(!qList.length)throw new Error(t("bg.joinInvalid"));
      // Annotate each question with a hint for AI so it knows what type it is
      const questions=qList.map((q,i)=>{
        // Detect math pattern — hint AI to return only the number
        const isMath=/\d+\s*[+\-\*×xX÷/:^]\s*\d+/.test(q.text)||/(?:cộng|trừ|nhân|chia|bằng mấy|bằng bao nhiêu|tính ra|kết quả)/i.test(q.text);
        let hint=isMath?" [TOÁN — chỉ trả về đúng con số]":"";
        if(q.options.length)hint+=" [TRẮC NGHIỆM — chỉ trả về nguyên văn 1 lựa chọn bên dưới]";
        const opts=q.options.length?`\n   Lựa chọn: ${q.options.join(" | ")}`:"";
        return `${i+1}.${hint} ${q.text}${opts}`;
      }).join("\n");
      // Prompt hệ thống SIẾT SẴN trong code (2.11.8): AI đóng vai chủ tài
      // khoản, format JSON thuần, quy tắc theo từng loại câu (bg.joinSystem;
      // meta-free dùng biến thể trung tính bg.joinSystemMeta vì Meta từ chối
      // khi bị yêu cầu bịa thông tin cá nhân). Chỉ dẫn tay của người dùng
      // (msg.prompt — ô "Chỉ dẫn cho AI khi trả lời câu hỏi vào nhóm" ở
      // popup) KHÔNG còn thay cả prompt như bản cũ: nó được chích vào dưới
      // mục "Chỉ dẫn bổ sung của chủ tài khoản" (persona / lý do tham gia /
      // phong cách); {groupName} trong chỉ dẫn được thay bằng tên nhóm thật,
      // {questions} bị gỡ vì danh sách câu hỏi do hệ thống liệt kê bên dưới.
      const sysTemplate=provider==="meta-free"?t("bg.joinSystemMeta"):t("bg.joinSystem");
      const system=sysTemplate.replaceAll("{groupName}",groupName).replaceAll("{n}",String(qList.length));
      const guidance=String(msg.prompt||"").replaceAll("{groupName}",groupName).replaceAll("{questions}","").trim().slice(0,2000);
      const prompt=[system,
        guidance?`${t("bg.joinGuidanceHead")}\n${guidance}`:"",
        `${t("bg.joinQuestionsHead")}\n${questions}`,
        t("bg.joinTail",{n:qList.length})
      ].filter(Boolean).join("\n");
      let raw="";
      if(provider==="meta-free")raw=await callMetaFreeText(prompt,"join");
      else if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,msg.groupName,prompt,false);
      else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,msg.groupName,prompt,false);
      else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,msg.groupName,prompt,false);}
      // Fallback khi AI không trả JSON: chỉ lột đúng dấu gạch đầu dòng ("- ",
      // "* ", "• ") hoặc số thứ tự ("1. ", "2) ") — regex cũ lột cả số đầu câu
      // ("25 tuổi" thành "tuổi", số điện thoại/mã cũng mất số).
      // Meta hay kèm lời dẫn quanh mảng nên bóc khối [...] trước để khỏi lệch thứ tự.
      let answers=provider==="meta-free"?metaFreeExtractJsonArray(raw):null;
      if(!answers&&provider==="meta-free"){
        // Meta có thể render mảng JSON qua tree-viewer (gộp node, kèm nhãn UI).
        const cleaned=metaFreeCleanJsonViewer(raw,true);
        if(cleaned){try{const v=JSON.parse(cleaned);if(Array.isArray(v))answers=v;}catch{}}
      }
      if(!answers){try{answers=JSON.parse(String(raw).replace(/```json|```/gi,"").trim());}catch{answers=String(raw).split(/\r?\n/).map(s=>s.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/,"").trim()).filter(Boolean);}}
      if(!answers)answers=[];
      if(!Array.isArray(answers)||!answers.length)throw new Error(t("bg.joinInvalid"));
      // Đáp án từ chối / lộ thân phận AI (mọi provider) mà đem điền vào form
      // thì hại hơn không điền — ném lỗi để luồng gọi rơi xuống luồng 2
      // (tự tính câu toán + câu mẫu dự phòng).
      if(answers.some(a=>aiJoinIsRefusal(a)))throw new Error(t("bg.joinInvalid"));
      sendResponse({ok:true,answers:answers.map(a=>String(a).trim().slice(0,500))});
    }catch(e){sendResponse({ok:false,error:friendlyAiError(e,msg.aiConfig?.provider||"Gemini")});}})();return true;
  }
  if(msg.action==="aiListModels"){
    (async()=>{
      try{
        const provider=msg.provider||"gemini",key=normalizeApiKey(msg.key);
        if(!key)throw new Error(t("bg.noKeyProv",{provider:provider}));
        const models=await listProviderModels(provider,key);
        sendResponse({ok:true,provider,models});
      }catch(e){sendResponse({ok:false,error:friendlyAiError(e,msg.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="aiTest"){
    (async()=>{
      try{
        const own=msg.aiConfig||{},provider=own.provider||"gemini",key=normalizeApiKey(own.key),model=own.model||"",customUrl=own.url||"";
        // meta-free không cần key/model — test bằng 1 câu hỏi thật qua tab meta.ai.
        if(provider==="meta-free"){
          const result=await callMetaFreeText(`${t("bg.testPrompt")}. ${t("bg.testPostText")}`,"test");
          if(!String(result||"").trim())throw new Error(t("bg.testEmpty"));
          sendResponse({ok:true,result:String(result).trim().slice(0,120)});
          return;
        }
        if(!key)throw new Error(t("bg.noKey"));
        if(!model)throw new Error(t("bg.noModel"));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrl"));
        const testPrompt=t("bg.testPrompt");let result="";
        if(provider==="gemini")result=await callGemini(key,model,t("bg.testPostText"),testPrompt,false);
        else if(provider==="claude"||provider==="Muse")result=await callClaude(key,model,t("bg.testPostText"),testPrompt,false);
        else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;result=await callOpenAICompatible(key,customUrl||def.url,model||def.model,t("bg.testPostText"),testPrompt,false);}
        if(!String(result||"").trim())throw new Error(t("bg.testEmpty"));
        sendResponse({ok:true,result:String(result).trim().slice(0,120)});
      }catch(e){sendResponse({ok:false,error:friendlyAiError(e,msg.aiConfig?.provider||"Gemini")});}
    })();
    return true;
  }
  if(msg.action==="metaFreeCleanNow"){
    (async()=>{
      try{
        const res=await metaFreeEnqueue(async()=>{
          let tracked=[];
          try{
            const s=await chrome.storage.local.get("metaFreeWorkerChats").catch(()=>({}));
            tracked=Array.isArray(s.metaFreeWorkerChats)?s.metaFreeWorkerChats:[];
          }catch(_){}
          const ids=tracked.map(e=>e&&e.id).filter(Boolean);
          if(!ids.length)return {ok:true,deleted:[],failed:[],remaining:0};
          const r=await metaFreeCleanIds(ids);
          let remaining=0;
          try{
            const s2=await chrome.storage.local.get("metaFreeWorkerChats").catch(()=>({}));
            remaining=Array.isArray(s2.metaFreeWorkerChats)?s2.metaFreeWorkerChats.length:0;
          }catch(_){}
          return {ok:!(r.failed||[]).length,deleted:r.deleted||[],failed:r.failed||[],remaining};
        });
        sendResponse({ok:res.ok,deleted:res.deleted||[],failed:res.failed||[],remaining:res.remaining||0});
      }catch(e){sendResponse({ok:false,error:friendlyAiError(e,"Meta AI")});}
    })();
    return true;
  }
  // Build mới của meta.ai chỉ mount ô soạn contenteditable khi tab ĐƯỢC HIỂN
  // THỊ; tab worker nền chỉ có textarea mirror (gõ không ăn). Content script
  // gọi cặp action này: bật tab worker ~2-3s cho React mount rồi trả lại tab
  // user đang xem. Alarm dự phòng trả focus nếu content script chết giữa chừng.
  if(msg.action==="metaFreeNeedVisible"){
    const tabId=sender.tab?.id;
    (async()=>{
      try{
        if(!Number(tabId))throw new Error("no tab");
        const active=await chrome.tabs.query({active:true,lastFocusedWindow:true});
        const prev=Array.isArray(active)?active.find(t=>Number(t.id)!==Number(tabId)):null;
        if(prev)metaFreePrevActiveTab=prev.id;
        await chrome.tabs.update(Number(tabId),{active:true});
        // Lưới an toàn: content script chết giữa chừng thì 8s sau vẫn trả focus.
        try{await chrome.alarms.create("metaFreeRestoreFocus",{delayInMinutes:3});}catch(_){}
        sendResponse({ok:true});
      }catch(e){sendResponse({ok:false,error:String(e?.message||e)});}
    })();
    return true;
  }
  if(msg.action==="metaFreeRestoreFocus"){
    const tabId=sender.tab?.id;
    metaFreeRestoreFocus(tabId);
    sendResponse({ok:true});
    return true;
  }
  if(msg.action==="aiBuildStyleProfile"){
    (async()=>{
      try{
        const classes=(Array.isArray(msg.classes)&&msg.classes.length)?msg.classes:[];
        let rows=compactProfilePosts(msg.posts),name=String(msg.name||t("st.defaultName")).trim().slice(0,80)||t("st.defaultName");
        if(rows.length<3)throw new Error(t("bg.profileNeed3"));
        // Tóm tắt cục bộ (miễn phí) để Gemini không phải đọc toàn bộ bài — tiết kiệm quota.
        const digest=buildStyleDigest(rows,classes);
        const dk=`${styleDigestKey(rows)}|${[...classes].sort().join(",")}`;
        const cached=await digestCacheGet(dk);
        const usedDigest=cached&&cached.summary&&cached.summary.postCount?cached:digest;
        if(!cached)await digestCachePut(dk,digest);
        const localProfile=heuristicStyleProfile(rows,name);
        localProfile.style={...localProfile.style,topKeywords:digest.topics.slice(0,10),hooks:digest.hooks,closers:digest.closers,structure:digest.structure,classCounts:digest.summary.classCounts};
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{},key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        let parsed=null,source="heuristic";
        if(key||provider==="meta-free"){
          try{
            const prompt=profilePromptV2(name,usedDigest);let raw="";
            if(provider==="meta-free")raw=await callMetaFreeText(prompt,"style");
            else if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
            else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,"",prompt,false);
            else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
            // Meta bọc JSON trong lời dẫn/tree-viewer → bóc + dọn trước khi parse.
            const parsable=provider==="meta-free"?(metaFreeCleanJsonViewer(raw,false)||raw):raw;
            parsed=parseProfileJson(parsable);if(parsed)source=provider;
          }catch(error){
            // Hồ sơ vẫn được tạo bằng digest heuristic nếu API hết quota/lỗi mạng.
            console.warn("[AI profile] API failed, using local digest heuristic",friendlyAiError(error,provider));
          }
        }
        const profile={...localProfile,...parsed, id:profileIdFromName(name),name,source,sampleCount:rows.length,createdAt:new Date().toISOString(),examples:Array.isArray(parsed?.examples)&&parsed.examples.length?parsed.examples.slice(0,3).map(x=>String(x).slice(0,400)):localProfile.examples,digest:{key:dk,inputPosts:rows.length,estimatedTokens:estimateTokens(JSON.stringify(usedDigest)),classes}};
        profile.knowledge={...localProfile.knowledge,...(parsed?.knowledge||{})};
        profile.style={...localProfile.style,...(parsed?.style||{})};
        const store=await chrome.storage.local.get("styleProfiles"),profiles=store.styleProfiles&&typeof store.styleProfiles==="object"?store.styleProfiles:{};
        profiles[profile.id]=profile;
        await chrome.storage.local.set({styleProfiles:profiles,activeStyleProfileId:profile.id,styleProfileStatus:t("bg.profileSaved",{name:name,n:rows.length,source:source})});
        sendResponse({ok:true,profile});
      }catch(e){sendResponse({ok:false,error:friendlyAiError(e,t("bg.profileProvider"))});}
    })();
    return true;
  }
  if(msg.action==="salesGetProductMedia"){
    (async()=>{try{
      // Page sales lưu blob ở kho riêng pageSalesProductsMedia_<page> (popup buildPageSalesConfig
      // truyền mediaKey theo config); thiếu nhánh này mọi Page sales có ảnh đều lỗi thiếu media.
      let entry=null;
      const mediaKey=String(msg.mediaKey||"");
      if(/^pageSalesProductsMedia_[A-Za-z0-9_\-]+$/.test(mediaKey)){
        const psaved=await chrome.storage.local.get(mediaKey);
        const pparts=Array.isArray(psaved[mediaKey])?psaved[mediaKey]:[];
        entry=pparts.find(p=>p.id===msg.productId)||null;
      }
      if(!entry){const saved=await chrome.storage.local.get("salesProductsMedia");const parts=Array.isArray(saved.salesProductsMedia)?saved.salesProductsMedia:[];entry=parts.find(p=>p.id===msg.productId)||null;}
      sendResponse({ok:true,media:normalizeSalesMedia(entry?.media)});
    }catch(error){sendResponse({ok:false,error:error.message});}})();
    return true;
  }
  if(msg.action==="salesGetMedia"){
    (async()=>{try{const saved=await chrome.storage.local.get("salesPostMedia");sendResponse({ok:true,media:normalizeSalesMedia(saved.salesPostMedia)});}catch(error){sendResponse({ok:false,error:error.message});}})();
    return true;
  }
  if(msg.action==="aiGenerateSalesPost"){
    (async()=>{
      let errKey = "";
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        // Run snapshot KHÔNG mang key (không lưu secret) mà mang profileId —
        // resolve key tại đây từ kho hồ sơ (tươi lúc chạy, đúng hồ sơ đã gán).
        // Không có profileId (lịch cũ) thì về fallback legacy như trước.
        // Bắt live: Start strip key + profileId nên run luôn rớt về key legacy
        // đã chết, trong khi Test/Preview (mang key) vẫn xanh.
        if(!own.key&&own.profileId){
          try{
            const rp=await resolveAiProfile(own.profileId);
            // Hồ sơ meta-free không có key nhưng vẫn merge provider/model/url.
            if(rp&&(rp.key||rp.provider==="meta-free"))own={...own,provider:rp.provider||own.provider,key:rp.key,model:own.model||rp.model,url:own.url||rp.url};
          }catch(_){}
        }
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        errKey = maskApiKey(key);
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        if(!model&&provider!=="meta-free")throw new Error(t("bg.noModelProv",{provider:provider}));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrlAi"));
        const sourceText=String(msg.sourceText||"").replace(/[^\S\n]+/g," ").trim().slice(0,5000),productInfo=String(msg.productInfo||"").replace(/[^\S\n]+/g," ").trim().slice(0,2200),groupName=String(msg.groupName||"").trim().slice(0,180);
        if(sourceText.length<10)throw new Error(t("bg.postTooShort"));
        const profileContext=await getActiveStyleContext(String(msg.styleProfileId||""));
        const template=String(msg.prompt||t("bg.salesDefault")).replaceAll("{groupName}",groupName).replaceAll("{sourceText}",sourceText).replaceAll("{productInfo}",productInfo);
        const prompt=strictSalesPostPrompt([template,profileContext].filter(Boolean).join("\n\n"),groupName,sourceText,productInfo,msg.variant);
        let raw="";
        if(provider==="meta-free")raw=await callMetaFreeText(prompt,"sales");
        else if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
        else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,"",prompt,false);
        else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
        const content=cleanSalesPost(raw);if(!content)throw new Error(t("bg.contentEmpty"));
        const footer=extractSalesFooter(productInfo);
        const finalContent=footer?content+"\n\n"+footer:content;
        sendResponse({ok:true,content:finalContent,length:finalContent.length,provider,model});
      }catch(error){
        let errMsg=friendlyAiError(error,msg.aiConfig?.provider||"AI");
        // Lỗi auth thì kèm vân tay key đang chạy để biết key nào (không lộ secret).
        if(/không hợp lệ|invalid|unauthorized|401/i.test(errMsg)&&errKey)errMsg+=` [key ${errKey}]`;
        sendResponse({ok:false,error:errMsg});
      }
    })();
    return true;
  }
  if(msg.action==="aiSalesPostChat"){
    (async()=>{
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        if(!own.key&&own.profileId){
          try{
            const rp=await resolveAiProfile(own.profileId);
            if(rp&&(rp.key||rp.provider==="meta-free"))own={...own,provider:rp.provider||own.provider,key:rp.key,model:own.model||rp.model,url:own.url||rp.url};
          }catch(_){}
        }
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        if(!model&&provider!=="meta-free")throw new Error(t("bg.noModelProv",{provider:provider}));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrlAi"));
        const sourceText=String(msg.sourceText||"").replace(/[^\S\n]+/g," ").trim().slice(0,5000),productInfo=String(msg.productInfo||"").replace(/[^\S\n]+/g," ").trim().slice(0,2200),messageList=compactSalesChat(msg.messages||[]);
        if(sourceText.length<10)throw new Error(t("bg.salesChatNoSource"));
        if(!messageList.some(item=>item.role==="user"))throw new Error(t("bg.salesChatNoUser"));
        const groupName=String(msg.groupName||"").trim().slice(0,180),template=String(msg.prompt||t("bg.salesDefault")).replaceAll("{groupName}",groupName).replaceAll("{sourceText}",sourceText).replaceAll("{productInfo}",productInfo);
        const prompt=strictSalesChatPrompt(template,sourceText,productInfo,messageList);
        let raw="";
        if(provider==="meta-free")raw=await callMetaFreeText(prompt,"sales");
        else if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
        else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,"",prompt,false);
        else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
        const reply=cleanSalesPost(raw);if(!reply)throw new Error(t("bg.salesChatNoReply"));
        sendResponse({ok:true,reply,length:[...reply].length,provider,model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateGroupPost"){
    (async()=>{
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        const provider=own.provider||cfg.aiProvider||"gemini", saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""), model=own.model||saved.model||cfg.aiModel||"", customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        // meta-free hỏi qua tab meta.ai nên miễn kiểm tra key (repair nhiều lượt
        // nối tiếp qua hàng đợi chung nên mỗi nhóm sẽ chậm hơn API).
        if(!key&&provider!=="meta-free") throw new Error(t("bg.noKeyProv",{provider:provider}));
        let content="",firstEmpty=false;
        const background=msg.background&&typeof msg.background==="object"?msg.background:{};
        const profileContext=await getActiveStyleContext(msg.styleProfileId||"");
        const gctx=(msg.groupContext&&typeof msg.groupContext==="object")?msg.groupContext:null;
        if(gctx&&!gctx.groupName)gctx.groupName=msg.groupName;
        if(gctx&&msg.useSearch)gctx.useSearch=true;
        const contextBlock=buildGroupPostContextBlock(gctx,background);
        let userPrompt=String(msg.prompt||"");
        if(gctx&&userPrompt.includes("{groupContext}")){
          const d=gctx.digest&&typeof gctx.digest==="object"?gctx.digest:null;
          const short=d&&Array.isArray(d.topics)&&d.topics.length?d.topics.slice(0,6).join(", "):"";
          userPrompt=userPrompt.replaceAll("{groupContext}",short);
        }
        const topicAnchor=groupTopicAnchorBlock(msg.groupName);
        let recentBlock="";
        try{
          const rs=await chrome.storage.local.get("groupPostRecentContents").catch(()=>({}));
          recentBlock=groupPostAvoidBlock(rs.groupPostRecentContents);
        }catch(_){}
        // Xoay góc cưỡng bức theo bộ đếm để mỗi nhóm 1 kiểu mở khác nhau.
        const angleLine=await nextGroupPostAngleLine();
        const minLenLine=msg.minLen>0&&!background.enabled?`Độ dài tối thiểu: viết ít nhất ${msg.minLen} ký tự (bao gồm khoảng trắng). Đây là yêu cầu bắt buộc — không được viết ngắn hơn.`:"";
        const groupPrompt=strictGroupPostPrompt([topicAnchor,angleLine,userPrompt,contextBlock,recentBlock,profileContext,minLenLine].filter(Boolean).join("\n\n"),background);
        // Bài nền: viết ngắn ngay từ nhát đầu (lệnh cứng đầu prompt + trần token)
        // thay vì viết dài rồi nén lại — nén hụt là nguyên nhân skip hàng loạt.
        // Neo chủ đề nằm ngay sau lệnh giới hạn (vẫn thuộc phần đầu prompt).
        const bgFirst=background.enabled?[t("bg.postBgFirst",{max:normalizeBackgroundMaxChars(background.maxChars)}),groupPrompt].join("\n\n"):groupPrompt;
        const bgTokenCap=background.enabled?320:null;
        let searchApplied=false;
        const genOnce=async()=>{
          if(msg.useSearch&&provider==="gemini"){
            try{const c=await callGeminiWithSearch(key,model||AI_DEFAULTS.gemini.model,bgFirst);searchApplied=true;return c;}
            catch(e){if(!e||!e.searchUnsupported)throw e;}
          }
          return callConfiguredText(provider,key,model,customUrl,msg.groupName,bgFirst,bgTokenCap,"group-post");
        };
        const doRepair=(draft,light)=>repairBackgroundPost(draft,background,
          repairPrompt=>callConfiguredText(provider,key,model,customUrl,msg.groupName,topicAnchor?`${topicAnchor}\n\n${repairPrompt}`:repairPrompt,null,"group-post"),
          value=>cleanGroupPost(value,background),
          light?null:()=>callConfiguredText(provider,key,model,customUrl,msg.groupName,bgFirst,bgTokenCap,"group-post"),
          light);
        content=await genOnce();
        firstEmpty=!String(content||"").trim();
        try{
          content=await doRepair(content,false);
        }catch(e){
          // Nén hụt: xúc xắc nhiệt độ nên nước đầu xui là thường — gieo lại đúng
          // 1 lần rồi cho qua cắt cơ học, không đốt thêm lượt AI vô ích.
          // Lỗi khác (key/quota/rỗng) ném tiếp để fail-fast như cũ.
          if(e&&e.backgroundTooLong){
            const content2=await genOnce();
            content=await doRepair(content2,true);
          }else throw e;
        }
        if(!content) throw new Error(t("bg.contentEmpty"));
        // Chữ nháp AI lọt mọi vòng lọc ("Soạn bài X") thì cấm đăng: bỏ qua nhóm
        // này (code AI_EMPTY để luồng đi tiếp), không bao giờ đăng rác lên.
        if(groupPostHasScaffolding(content)){const bad=new Error(t("bg.scaffoldContent"));bad.aiEmpty=true;throw bad;}
        // Nhớ bài vừa đăng để bài sau đổi hẳn góc (chống rập khuôn cùng session).
        try{
          const rs=await chrome.storage.local.get("groupPostRecentContents").catch(()=>({}));
          const arr=Array.isArray(rs.groupPostRecentContents)?rs.groupPostRecentContents:[];
          arr.unshift(String(content).slice(0,300));
          await chrome.storage.local.set({groupPostRecentContents:arr.slice(0,3)});
        }catch(_){}
        sendResponse({ok:true,content,length:backgroundTextLength(content),backgroundEligible:!!background.enabled&&backgroundTextLength(content)<=normalizeBackgroundMaxChars(background.maxChars),searchApplied,contextApplied:!!contextBlock});
      }catch(e){const rawMsg=String(e&&e.message||e||"");const code=e&&e.backgroundTooLong?"BACKGROUND_TOO_LONG":(e&&e.code==="AI_TIMEOUT"?"AI_TIMEOUT":(firstEmpty||(e&&e.aiEmpty)||/nội dung rỗng|empty content|không trả về nội dung/i.test(rawMsg)?"AI_EMPTY":undefined));sendResponse({ok:false,error:friendlyAiError(e,msg.aiConfig?.provider||"Gemini"),...(code?{code}:{})});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateGroupShareCaption"){
    (async()=>{
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        if(!model&&provider!=="meta-free")throw new Error(t("bg.noModelProv",{provider:provider}));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrlAi"));
        const postText=String(msg.postText||"").replace(/\s+/g," ").trim().slice(0,4000);
        if(postText.length<10)throw new Error(t("bg.postTooShort"));
        const groupName=String(msg.groupName||"").trim().slice(0,180),sourceUrl=String(msg.sourceUrl||"").slice(0,1000);
        const base=(msg.prompt||t("bg.leadDefault"))
          .replaceAll("{postText}",postText).replaceAll("{groupName}",groupName).replaceAll("{sourceUrl}",sourceUrl);
        const profileContext=await getActiveStyleContext(),chatContext=formatGroupShareChatContext(msg.chatMessages||[]);
        const prompt=strictGroupShareCaptionPrompt([
          base,
          profileContext,
          chatContext?`${t("bg.chatCtx")}\n${chatContext}`:"",
          t("bg.variantNote",{n:Math.max(1,parseInt(msg.variant)||1),group:groupName})
        ].filter(Boolean).join("\n\n"),msg.recentCaptions||[]);
        let raw="";
        if(provider==="meta-free")raw=await callMetaFreeText(prompt,"share");
        else if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
        else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,"",prompt,false);
        else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
        const caption=cleanGroupShareCaption(raw);
        if(!caption)throw new Error(t("bg.leadEmpty"));
        const normalized=normalizeGroupShareCaption(caption),used=(msg.recentCaptions||[]).some(value=>normalizeGroupShareCaption(value)===normalized);
        if(used)throw new Error(t("bg.leadDup"));
        sendResponse({ok:true,caption});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="aiGroupShareChat"){
    (async()=>{
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        if(!model&&provider!=="meta-free")throw new Error(t("bg.noModelProv",{provider:provider}));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrlAi"));
        const postText=String(msg.postText||"").replace(/\s+/g," ").trim().slice(0,6000);
        if(postText.length<10)throw new Error(t("bg.chatNoPost"));
        const conversation=formatGroupShareChatContext(msg.messages||[]);
        if(!conversation||!compactGroupShareChat(msg.messages||[]).some(item=>item.role==="user"))throw new Error(t("bg.chatNoUser"));
        const prompt=t("bg.chatPrompt",{post:postText,conv:conversation});
        let reply="";
        if(provider==="meta-free")reply=await callMetaFreeText(prompt,"share");
        else if(provider==="gemini")reply=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
        else if(provider==="claude"||provider==="Muse")reply=await callClaude(key,model,"",prompt,false);
        else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;reply=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
        reply=String(reply||"").replace(/```[a-z]*|```/gi,"").trim().slice(0,3000);
        if(!reply)throw new Error(t("bg.chatEmpty"));
        sendResponse({ok:true,reply,provider,model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"Gemini")});}
    })();
    return true;
  }
  // ===== TIN TỨC CHO ĐĂNG TƯỜNG NICK (news) =====
  // Nguồn RSS miễn phí, không key: VnExpress chuyên mục / URL RSS tùy ý /
  // Google News theo từ khóa. SW không có DOMParser nên parse RSS bằng regex
  // (RSS 2.0 đơn giản, đủ title/desc/link/ảnh/giờ). Sổ tin-đã-dùng do content
  // (news.js) ghi sau proof, không ghi ở đây (gen chưa chắc đã đăng).
  const NEWS_VNEXPRESS_CATS={
    "Tin mới nhất":"https://vnexpress.net/rss/tin-moi-nhat.rss",
    "Kinh doanh":"https://vnexpress.net/rss/kinh-doanh.rss",
    "Bất động sản":"https://vnexpress.net/rss/bat-dong-san.rss",
    "Công nghệ":"https://vnexpress.net/rss/so-hoa-cong-nghe.rss",
    "Thể thao":"https://vnexpress.net/rss/the-thao.rss",
    "Giải trí":"https://vnexpress.net/rss/giai-tri.rss",
    "Sức khỏe":"https://vnexpress.net/rss/suc-khoe.rss",
    "Du lịch":"https://vnexpress.net/rss/du-lich.rss",
    "Khoa học":"https://vnexpress.net/rss/khoa-hoc.rss",
    "Giáo dục":"https://vnexpress.net/rss/giao-duc.rss",
    "Ô tô - Xe máy":"https://vnexpress.net/rss/oto-xe-may.rss"
  };
  function newsDecodeEntities(s){
    return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
      .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
      .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(m,n)=>{try{return String.fromCodePoint(parseInt(n,10));}catch(_){return m;}});
  }
  function newsStripHtml(s){
    return newsDecodeEntities(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")).replace(/<[^>]+>/g," ").replace(/[^\S\n]+/g," ").trim();
  }
  function newsField(block,tag){
    const m=String(block||"").match(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+tag+">","i"));
    return m?newsDecodeEntities(m[1]).trim():"";
  }
  function parseRssItems(xml,baseUrl=""){
    const out=[];
    const blocks=String(xml||"").split(/<item[\s>]/i).slice(1);
    // Ảnh RSS hay gặp: media:content/media:thumbnail (có thể là URL tương đối),
    // enclosure, <img> trong description hoặc content:encoded. Chuẩn hoá &amp;
    // + URL tương đối để newsFetchImage không nhận URL hỏng.
    const fixImage=u=>{
      let v=newsDecodeEntities(String(u||"").trim()).replace(/&amp;/g,"&");
      if(!v)return "";
      if(v.startsWith("//"))v=`https:${v}`;
      if(baseUrl){try{v=new URL(v,baseUrl).href;}catch(_){}}
      return /^https?:\/\//i.test(v)?v.slice(0,500):"";
    };
    for(const b of blocks){
      const title=newsStripHtml(newsField(b,"title")).slice(0,300);
      const descRaw=newsField(b,"description")||newsField(b,"content:encoded");
      const desc=newsStripHtml(descRaw).slice(0,900);
      const link=(newsField(b,"link")||newsField(b,"guid")).trim().split(/\s+/)[0]||"";
      const pub=newsField(b,"pubDate").slice(0,80);
      let image="";
      // media:content có thể xuất hiện nhiều lần (thumbnail nhỏ + ảnh lớn);
      // chọn ảnh có width lớn nhất thay vì lấy cái đầu tiên.
      const media=[...b.matchAll(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/gi)].map(m=>{
        const w=(m[0].match(/width=["']?(\d+)/i)||[])[1];
        return {url:m[1],w:parseInt(w)||0};
      }).sort((a,b)=>b.w-a.w);
      if(media.length)image=fixImage(media[0].url);
      if(!image){
        const enc=b.match(/<enclosure[^>]*url=["']([^"']+)["']/i)
          ||b.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i)
          ||b.match(/<itunes:image[^>]*href=["']([^"']+)["']/i)
          ||b.match(/<image[^>]*>[\s\S]*?<url>([^<]+)<\/url>/i);
        if(enc)image=fixImage(enc[1]);
      }
      if(!image){
        const im=descRaw.match(/<img[^>]*src=["']([^"']+)["']/i);
        if(im)image=fixImage(im[1]);
      }
      if(!image){
        const encoded=newsField(b,"content:encoded");
        const im=encoded.match(/<img[^>]*src=["']([^"']+)["']/i);
        if(im)image=fixImage(im[1]);
      }
      if(!image){
        const og=b.match(/<media:group[\s\S]*?<media:content[^>]*url=["']([^"']+)["']/i);
        if(og)image=fixImage(og[1]);
      }
      if(title&&link)out.push({title,desc,link,image,pubDate:pub});
      if(out.length>=60)break;
    }
    return out;
  }
  function parseWebPageItems(html,baseUrl=""){
    const source=String(html||"");
    const decode=v=>newsDecodeEntities(String(v||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
    const attr=(tag,name)=>{const m=String(tag||"").match(new RegExp(`${name}=["']([^"']*)["']`,'i'));return m?newsDecodeEntities(m[1]):"";};
    const abs=u=>{try{const v=new URL(newsDecodeEntities(String(u||"").trim()),baseUrl).href;return /^https?:\/\//i.test(v)?v:"";}catch(_){return "";}};
    const meta=(name)=>{const re=new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`,'i');return decode((source.match(re)||[])[1]||"");};
    const pageTitle=decode((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
    const pageDesc=meta("og:description")||meta("description");
    const pageImage=abs(meta("og:image")||meta("twitter:image"));
    const published=meta("article:published_time")||meta("date");
    const out=[],seen=new Set();
    const push=(link,title,desc,image,pub)=>{
      const u=abs(link);let t=decode(title),d=decode(desc);if(!u||!t||seen.has(u))return;
      if(t.length<12||/^(trang chủ|home|xem thêm|đọc thêm|read more|menu)$/i.test(t))return;
      if(/(?:\/dichvu\/|^https?:\/\/dichvu\.|lich-su-kien\.htm|san-giao-dich-tai-chinh\.htm|du-lieu\.chn|thi-truong-chung-khoan\.chn|\/tag\/|\/tags?\/|\/category\/|\/chuyen-muc\/)/i.test(u)||/^(lịch sự kiện|sàn giao dịch tài chính|online pr|khóa học online|tin tức thị trường chứng khoán|dịch vụ|dữ liệu|thị trường chứng khoán|chứng khoán hôm nay)$/i.test(t))return;
      seen.add(u);out.push({title:t.slice(0,300),desc:(d||t).slice(0,900),link:u,image:abs(image)||pageImage,pubDate:String(pub||published||"").slice(0,80)});
    };
    const articleRe=/<article\b[^>]*>[\s\S]*?<\/article>/gi;
    for(const block of source.match(articleRe)||[]){
      const a=block.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/i);
      const href=a?attr(a[0],"href"):"";
      const title=(block.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)||[])[1]||decode(a?.[0]||"");
      const desc=(block.match(/<(?:p|h4)\b[^>]*>([\s\S]*?)<\/(?:p|h4)>/i)||[])[1]||"";
      const img=(block.match(/<img\b[^>]*(?:src|data-src)=["'][^"']+["'][^>]*>/i)||[])[0]||"";
      push(href,title,desc,attr(img,"src")||attr(img,"data-src"),attr(block.match(/<(?:time|meta)\b[^>]*>/i)?.[0]||"","datetime")||"");
      if(out.length>=60)break;
    }
    if(!out.length){
      const headingRe=/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
      for(const m of source.matchAll(headingRe)){
        const title=decode(m[1]);
        if(title.length<20)continue;
        const after=source.slice(m.index,Math.min(source.length,m.index+1400));
        const before=source.slice(Math.max(0,m.index-1200),m.index);
        const hm=after.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)||before.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
        push(hm?.[1]||baseUrl,title,pageDesc,pageImage,published);
        if(out.length>=60)break;
      }
    }
    if(!out.length){
      const re=/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi;
      for(const a of source.match(re)||[]){
        const href=attr(a,"href"),text=decode(a.replace(/<[^>]+>/g," "));
        if(!href||text.length<25)continue;
        const u=abs(href);if(!u)continue;
        try{
          const parsed=new URL(u),root=new URL(baseUrl);
          if(parsed.hostname!==root.hostname)continue;
          if(/^(dichvu\.|static\.|media\.|images?\.)/i.test(parsed.hostname))continue;
        }catch(_){continue;}
        push(u,text,pageDesc,pageImage,published);if(out.length>=60)break;
      }
    }
    if(!out.length&&pageTitle&&/^https?:\/\//i.test(baseUrl))push(baseUrl,pageTitle,pageDesc,pageImage,published);
    return out;
  }
  async function enrichWebPageItem(item){
    const link=String(item?.link||"");
    if(!/^https?:\/\//i.test(link))return item;
    try{
      const r=await fetchWithTimeout(link,{headers:{"Accept":"text/html,application/xhtml+xml"}},20000);
      if(!r.ok)return item;
      const html=await r.text();
      const get=(name)=>{const m=html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`,'i'));return m?newsDecodeEntities(m[1]).trim():"";};
      const title=newsStripHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
      const desc=get("og:description")||get("description");
      const image=get("og:image")||get("twitter:image");
      const pub=get("article:published_time")||get("date");
      const isGenericImage=u=>/logo|favicon|icon|avatar|default|placeholder|share\.(?:jpg|png)|vst-share|sprite|no-image/i.test(String(u||""));
      const candidate=image||item.image||"";
      return {...item,title:(title||item.title).slice(0,300),desc:(desc||item.desc||item.title).slice(0,900),image:isGenericImage(candidate)?"":candidate,pubDate:(pub||item.pubDate||"").slice(0,80)};
    }catch(_){return item;}
  }
  // Chạy TRONG tab bài báo (chrome.scripting.executeScript): tìm ảnh đại diện
  // của bài (ưu tiên đúng URL ảnh RSS, rồi og:image, rồi ảnh lớn nhất trong
  // article/main), dựng overlay trắng ở góc trên-trái và trả rect để background
  // chụp bằng debugger. Canvas chỉ là đường nhanh; ảnh cross-origin bị taint
  // thì trả rect để chụp màn hình (không phụ thuộc CORS/hotlink).
  async function articleImagePick(imageUrl){
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const abs=u=>{try{return new URL(String(u||""),location.href).href;}catch(_){return "";}};
    const keyOf=u=>{try{const x=new URL(u,location.href);return (x.hostname+x.pathname).toLowerCase();}catch(_){return String(u||"").toLowerCase();}};
    const want=imageUrl?abs(imageUrl):"";
    const wantKey=want?keyOf(want):"";
    const wantFile=(()=>{try{return new URL(want).pathname.split("/").pop().toLowerCase();}catch(_){return "";}})();
    const usable=el=>{try{return el.complete&&(el.naturalWidth||0)>=240&&(el.naturalHeight||0)>=140;}catch(_){return false;}};
    // Kích hoạt lazy-load: cuộn nhanh xuống rồi về đầu trang.
    try{window.scrollTo(0,Math.min(document.body.scrollHeight*0.4,3000));await sleep(350);window.scrollTo(0,0);}catch(_){}
    let chosen=null,chosenSrc="";
    const end=Date.now()+12000;
    while(Date.now()<end){
      const imgs=[...document.querySelectorAll("img")].filter(usable);
      let hit=null;
      if(wantKey)hit=imgs.find(el=>keyOf(el.currentSrc||el.src)===wantKey)||null;
      if(!hit&&wantFile)hit=imgs.find(el=>String(el.currentSrc||el.src).toLowerCase().includes(wantFile))||null;
      if(hit){chosenSrc=hit.currentSrc||hit.src;break;}
      const og=document.querySelector('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]');
      const ogUrl=og?abs(og.getAttribute("content")||""):"";
      if(ogUrl&&/^https?:\/\//i.test(ogUrl)){chosenSrc=ogUrl;break;}
      const scope=document.querySelector("article")||document.querySelector('[role="main"]')||document.body;
      const inScope=[...scope.querySelectorAll("img")].filter(usable);
      const pool=inScope.length?inScope:imgs;
      if(pool.length){const big=pool.slice().sort((a,b)=>(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight))[0];chosenSrc=big.currentSrc||big.src;chosen=big;break;}
      await sleep(400);
    }
    if(!chosenSrc)return {ok:false,error:"no-img"};
    if(!/^https?:\/\//i.test(chosenSrc)&&!/^data:image\//i.test(chosenSrc))return {ok:false,error:"bad-src"};
    // Dựng overlay sạch: ảnh đặt tại (0,0), nền trắng, ẩn phần còn lại.
    const host=document.createElement("div");
    host.style.cssText="position:fixed;left:0;top:0;width:100vw;height:100vh;background:#fff;z-index:2147483647;overflow:hidden";
    const img=document.createElement("img");
    img.src=chosenSrc;
    img.style.cssText="position:absolute;left:0;top:0;background:#fff;border:0";
    host.appendChild(img);
    try{document.documentElement.appendChild(host);}catch(_){return {ok:false,error:"no-overlay"};}
    try{window.scrollTo(0,0);}catch(_){}
    const loaded=await new Promise(resolve=>{
      let done=false;
      const fin=ok=>{if(done)return;done=true;resolve(ok);};
      img.onload=()=>fin(true);
      img.onerror=()=>fin(false);
      try{if(img.complete&&img.naturalWidth)fin(true);}catch(_){}
      setTimeout(()=>fin(!!img.naturalWidth),8000);
    });
    if(!loaded)return {ok:false,error:"img-load-fail"};
    const w=img.naturalWidth||0,h=img.naturalHeight||0;
    if(!w||!h)return {ok:false,error:"no-size"};
    // Canvas nhanh (cùng origin/CDN cho CORS); lỗi taint → chụp màn hình.
    try{
      const cv=document.createElement("canvas");cv.width=w;cv.height=h;
      const cx=cv.getContext("2d");cx.drawImage(img,0,0,w,h);
      const dataUrl=cv.toDataURL("image/jpeg",0.92);
      if(dataUrl&&dataUrl.length>200)return {ok:true,dataUrl};
    }catch(_){}
    const maxSide=4096;
    const scale=Math.min(1,maxSide/w,maxSide/h);
    const dw=Math.max(1,Math.round(w*scale)),dh=Math.max(1,Math.round(h*scale));
    img.style.width=`${dw}px`;img.style.height=`${dh}px`;
    try{for(const el of [...document.body.children]){if(el!==host)el.style.visibility="hidden";}}catch(_){}
    // KHÔNG dùng requestAnimationFrame: tab tạo bằng active:false (và headless)
    // bị coi là hidden nên rAF bị treo → handler không bao giờ trả về (bắt live
    // 20/10: tab bài báo kẹt lại, không attach debugger). Timer vẫn chạy.
    await sleep(600);
    return {ok:false,rect:{x:0,y:0,width:dw,height:dh},error:"screenshot"};
  }
  function newsNormSearch(s){
    return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\u1dc0-\u1dff]/g,"");
  }
  // Nhiều từ khóa cách nhau phẩy/chấm phẩy/xuống dòng (tối đa 5): khớp BẤT KỲ
  // từ khóa nào (OR giữa các từ khóa, AND các từ trong 1 từ khóa như cũ).
  function newsSplitKeywords(s){
    return String(s||"").split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,5);
  }
  // Lọc tuổi tin: chỉ giữ bài đăng trong `hours` giờ qua (0 = tất cả).
  // Bài không đọc được ngày thì giữ lại (tránh rỗng oan khi thiếu pubDate).
  function newsFreshOnly(items,hours){
    const h=Math.max(0,parseInt(hours)||0);
    if(!h)return {items,filtered:false};
    const cutoff=Date.now()-h*3600000;
    const kept=(Array.isArray(items)?items:[]).filter(it=>{
      const ms=Date.parse(it?.pubDate||"");
      return isNaN(ms)||ms>=cutoff;
    });
    return {items:kept,filtered:true};
  }
  function newsWords(s){
    return String(s||"").toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  }
  // Chấm khớp từ khóa theo từ nguyên (không \b — regex JS coi dấu tiếng Việt
  // là non-word nên \b không khớp). Exact (giữ dấu) xếp trước vì tiếng Việt
  // đơn âm tiết: "bão" và "báo" (họp báo) sau khi lột dấu đều thành "bao".
  function newsKeywordScore(item,q){
    const toks=String(q||"").toLowerCase().split(/[^\p{L}\p{N}]+/gu).map(w=>w.trim()).filter(w=>w.length>=2)
      .map(w=>({raw:w,norm:newsNormSearch(w)})).filter(tk=>tk.norm.length>=2);
    if(!toks.length)return {exact:0,norm:0,total:0};
    const rawSet=new Set(newsWords(`${item.title||""} ${item.desc||""}`));
    const normSet=new Set(newsWords(newsNormSearch(`${item.title||""} ${item.desc||""}`)));
    let exact=0,norm=0;
    for(const tk of toks){
      if(rawSet.has(tk.raw))exact++;
      else if(normSet.has(tk.norm))norm++;
    }
    return {exact,norm,total:toks.length};
  }
  function newsMatchKeyword(item,q){
    const s=newsKeywordScore(item,q);
    return s.total>0&&(s.exact+s.norm)>=s.total;
  }
  function newsSiteName(u){
    try{return new URL(u).hostname.replace(/^www\./i,"");}catch(_){return String(u||"").slice(0,60);}
  }
  // ---- Nguồn X: đọc qua tab X đang đăng nhập (user tự login tay) ----
  async function findXTab(){
    try{
      const tabs=await chrome.tabs.query({url:["*://x.com/*","*://twitter.com/*"]});
      return (tabs||[]).find(t=>t && !/login/i.test(t.url||""))||tabs[0]||null;
    }catch(_){return null;}
  }
  async function ensureXTab(){
    const tab=await findXTab();
    if(tab?.id) return tab;
    return await chrome.tabs.create({url:"https://x.com/",active:false});
  }
  function waitTabComplete(tabId,timeout=25000){
    return new Promise(resolve=>{
      const end=Date.now()+timeout;
      const tick=()=>{
        chrome.tabs.get(tabId,tab=>{
          if(chrome.runtime.lastError||!tab)return resolve(false);
          if(tab.status==="complete")return resolve(true);
          if(Date.now()>end)return resolve(false);
          setTimeout(tick,500);
        });
      };
      tick();
    });
  }
  function sendXMessage(tabId,msg,timeout=30000){
    return new Promise(resolve=>{
      let done=false;
      const to=setTimeout(()=>{if(!done){done=true;resolve(null);}},timeout);
      try{
        chrome.tabs.sendMessage(tabId,msg,res=>{
          if(done)return;done=true;clearTimeout(to);
          resolve(chrome.runtime.lastError?{ok:false,error:"no-x-tab"}:res);
        });
      }catch(_){if(!done){done=true;clearTimeout(to);resolve(null);}}
    });
  }
  // Đọc N bài từ 1 user X: điều hướng tab X tới profile rồi đọc DOM.
  async function readXUserPosts(tabId,user,count){
    await chrome.tabs.update(tabId,{url:`https://x.com/${user}`});
    await waitTabComplete(tabId);
    await new Promise(r=>setTimeout(r,3500));
    const res=await sendXMessage(tabId,{action:"xReadPosts",count});
    if(!res?.ok)throw new Error(res?.error||"x-read-fail");
    return (res.posts||[]).map(p=>({
      title:String(p.text||"").slice(0,200),desc:String(p.text||"").slice(0,900),
      link:p.link||"",image:"",pubDate:String(p.time||""),author:String(p.author||user).slice(0,30),
      site:"x.com",topic:String(p.author||user).slice(0,30)
    }));
  }
  async function fetchXUsers(users,count){
    const list=(Array.isArray(users)?users:[]).map(u=>String(u||"").replace(/^@/,"").trim())
      .filter(u=>/^[A-Za-z0-9_]{1,15}$/.test(u)).slice(0,1000);
    if(!list.length)throw new Error(t("bg.newsNoXUsers"));
    const tab=await ensureXTab();
    if(!tab?.id)throw new Error(t("bg.newsNoXTab"));
    const seen=new Set(),pool=[];
    for(const u of list){
      try{
        const items=await readXUserPosts(tab.id,u,Math.max(3,Math.ceil(count/Math.max(1,list.length))+2));
        for(const it of items){
          if(!it.link||seen.has(it.link))continue;
          seen.add(it.link);pool.push(it);
          if(pool.length>=count)break;
        }
      }catch(_){}
      if(pool.length>=count)break;
    }
    if(!pool.length)throw new Error(t("bg.newsXEmpty"));
    return pool.slice(0,count);
  }
  // Nguồn bài Page/Profile Facebook: mở từng link trong tab ẩn, nhờ content
  // script (scrape.js) đọc bài bằng parser chuẩn, rồi chọn ảnh theo mode:
  //   rewrite          -> ảnh media của chính bài
  //   rewrite_original -> ảnh gốc lớn nhất (ưu tiên ảnh trong bài quote/comment)
  //   opinion_screenshot -> không tải ảnh; tab capture sẽ chụp màn hình bài.
  async function fetchFacebookPosts(source,count){
    const urls=(Array.isArray(source?.urls)?source.urls:[]).map(u=>String(u||"").trim())
      .filter(u=>/^https?:\/\/(?:www\.|m\.)?facebook\.com\//i.test(u)).slice(0,100);
    if(!urls.length)throw new Error(t("bg.newsNoFbUrls"));
    const hours=Math.max(0,parseInt(source?.hours)||0);
    const mode=["rewrite","rewrite_original","opinion_screenshot"].includes(String(source?.mode))?String(source?.mode):"rewrite";
    // Chụp màn hình chỉ dành cho bài chữ có nền màu. Bài thường/bài dài có
    // ảnh thật vẫn đi theo mode rewrite/rewrite_original; không biến thành
    // một ảnh chụp dọc rất dài làm bài đăng xấu và khó đọc.
    const backgroundOnly=source?.backgroundOnly===true||mode==="opinion_screenshot";
    const want=Math.max(1,Math.min(100000,parseInt(count)||30));
    const per=Math.max(5,Math.min(50,Math.ceil(want/urls.length)+4));
    const out=[],seen=new Set();
    const readTimeoutMs=12000;
    for(const url of urls){
      let tab=null;
      try{
        tab=await chrome.tabs.create({url,active:false});
        if(!await waitTabComplete(tab.id,30000))throw new Error("FB_SOURCE_PAGE_TIMEOUT");
        await new Promise(r=>setTimeout(r,3500));
        let res=null;
        for(let attempt=0;attempt<2;attempt++){
          if(attempt>0)await new Promise(r=>setTimeout(r,2000));
          res=await new Promise(resolve=>{
            let settled=false;
            const timer=setTimeout(()=>{if(!settled){settled=true;resolve({ok:false,error:"FB_SOURCE_READ_TIMEOUT"});}},readTimeoutMs);
            try{chrome.tabs.sendMessage(tab.id,{action:"fbSourceReadPosts",count:per},r=>{if(settled)return;settled=true;clearTimeout(timer);resolve(chrome.runtime.lastError?{ok:false,error:"FB_SOURCE_NO_RECEIVER"}:r);});}
            catch(_){resolve(null);}
          });
          if(res?.ok&&(res.posts||[]).length)break;
        }
        if(!res?.ok&&res?.error==="FB_SOURCE_READ_TIMEOUT")throw new Error("FB_SOURCE_READ_TIMEOUT");
        if(res?.ok&&Array.isArray(res.posts)){
          for(const p of res.posts){
            if(!p?.link||seen.has(p.link))continue;
            seen.add(p.link);out.push(p);
          }
        }
      }catch(_){}
      finally{if(tab?.id)try{await chrome.tabs.remove(tab.id);}catch(_){}}
    }
    if(!out.length)throw new Error(t("bg.newsNoFbPosts"));
    const cutoff=hours?Date.now()-hours*3600000:0;
    // FB 24h/48h/... phải fail-closed: không có timeMs thì không thể chứng
    // minh bài nằm trong cửa sổ thời gian, vì vậy loại bài đó thay vì cho lọt.
    const fresh=out.filter(p=>(!cutoff||(Number(p.timeMs)>0&&p.timeMs>=cutoff))&&(!backgroundOnly||p.contentClass==="textBg"||p.hasBackground===true));
    if(!fresh.length)throw new Error(t("bg.newsNoFbRecent"));
    fresh.sort((a,b)=>(Number(b.timeMs)||0)-(Number(a.timeMs)||0));
    return fresh.slice(0,want).map(p=>{
      const postImgs=Array.isArray(p.postImages)?p.postImages:[];
      const quoted=Array.isArray(p.quotedImages)?p.quotedImages:[];
      const fallback=(Array.isArray(p.images)?p.images:[])[0]||"";
      const image=(mode==="rewrite_original"?(quoted[0]||postImgs[0]):postImgs[0])||fallback;
      const text=String(p.text||"").trim();
      return {
        title:(text.split(/\r?\n/)[0]||String(p.author||"Facebook")).slice(0,200),
        desc:text.slice(0,1800),
        link:String(p.link||""),
        image,
        images:[...new Set([...postImgs,...quoted,...(Array.isArray(p.images)?p.images:[])])].slice(0,30),
        author:String(p.author||"").slice(0,120),
        pubDate:String(p.time||"").slice(0,80),
        timeMs:Number(p.timeMs)||0,
        site:"facebook.com",
        topic:String(p.author||"Facebook").slice(0,60),
        fbSource:true,
        contentClass:String(p.contentClass||"text"),
        hasBackground:p.hasBackground===true||p.contentClass==="textBg",
        fbMode:mode,
        comments:(Array.isArray(p.comments)?p.comments:[]).slice(0,3).map(c=>({
          author:String(c.author||"").slice(0,80),
          text:String(c.text||"").slice(0,800),
          images:(Array.isArray(c.images)?c.images:[]).slice(0,3)
        }))
      };
    });
  }
  async function fetchNewsList(source,count){
    const n=Math.max(1,Math.min(100000,parseInt(count)||10));
    const sourceType=String(source?.type||"vnexpress");
    if(sourceType==="xread"){
      const users=(Array.isArray(source?.users)?source.users:[]);
      if(users.length){
        const got=await fetchXUsers(users,n);
        const f=newsFreshOnly(got,source.hours);
        if(!f.items.length)throw new Error(t("bg.newsNoRecent"));
        return f.items;
      }
      // Cũ: đọc tab X đang mở (không nhập user).
      const tab=await findXTab();
      if(!tab?.id)throw new Error(t("bg.newsNoXTab"));
      const res=await sendXMessage(tab.id,{action:"xReadPosts",count:n});
      if(!res?.ok)throw new Error(res?.error||t("bg.newsXEmpty"));
      const got=(res.posts||[]).map(p=>({
        title:String(p.text||"").slice(0,200),desc:String(p.text||"").slice(0,900),
        link:p.link||"",image:"",pubDate:String(p.time||""),author:String(p.author||"").slice(0,30),
        site:"x.com",topic:String(p.author||"").slice(0,30)
      }));
      if(!got.length)throw new Error(t("bg.newsXEmpty"));
      const f=newsFreshOnly(got,source.hours);
      if(!f.items.length)throw new Error(t("bg.newsNoRecent"));
      return f.items;
    }
    if(sourceType==="fb"){
      const items=await fetchFacebookPosts(source,count);
      if(!items.length)throw new Error(globalThis.t("bg.newsNoFbPosts"));
      return items;
    }
    if(sourceType==="sites"){
      // Web của tôi: quét song song nhiều RSS, lọc theo từ khóa, mới nhất trước.
      const kws=newsSplitKeywords(source?.q);
      if(!kws.length)throw new Error(t("bg.newsNoKeyword"));
      const urls=(Array.isArray(source?.urls)?source.urls:[]).map(u=>String(u||"").trim()).filter(u=>/^https?:\/\//i.test(u)).slice(0,100);
      if(!urls.length)throw new Error(t("bg.newsSitesEmpty"));
      const settled=await Promise.allSettled(urls.map(u=>fetchWithTimeout(u,{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}},25000).then(async r=>{if(!r.ok)throw new Error(`HTTP ${r.status||"?"}`);return {url:u,xml:await r.text()};})));
      let pool=[];
      for(const s of settled){
        if(s.status!=="fulfilled")continue;
        try{
          const looksHtml=/<!doctype\s+html|<html\b/i.test(String(s.value.xml||""));
          let rss=looksHtml?[]:parseRssItems(s.value.xml,s.value.url);
          // Link thường có thể là trang chủ/chuyên mục, không phải RSS. Nếu
          // trang tự khai báo feed thì đọc feed đó trước để tránh nhặt menu,
          // banner và link dịch vụ từ HTML trang chủ.
          if(looksHtml&&!rss.length){
            const feeds=[...String(s.value.xml||"").matchAll(/<link\b[^>]*(?:type=["']application\/(?:rss|atom)\+xml["'][^>]*|rel=["'][^"']*alternate[^"']*["'][^>]*)[^>]*>/gi)]
              .map(m=>{const tag=m[0];const href=(tag.match(/href=["']([^"']+)["']/i)||[])[1]||"";try{return new URL(newsDecodeEntities(href),s.value.url).href;}catch(_){return "";}})
              .filter(Boolean).slice(0,3);
            for(const feedUrl of feeds){
              try{
                const fr=await fetchWithTimeout(feedUrl,{headers:{"Accept":"application/rss+xml, application/atom+xml, application/xml, text/xml"}},20000);
                if(fr.ok){const parsed=parseRssItems(await fr.text(),feedUrl);if(parsed.length){rss=parsed;break;}}
              }catch(_){ }
            }
          }
          const items=rss.length?rss:parseWebPageItems(s.value.xml,s.value.url);
          const enriched=await Promise.all(items.slice(0,60).map(enrichWebPageItem));
          for(const it of enriched)pool.push({...it,site:newsSiteName(s.value.url)});
        }catch(_){}
      }
      // Giữ tin khớp ≥1 từ khóa, gắn topic = từ khóa khớp nhất (exact nhiều
      // nhất) để bundle gom cùng topic.
      let scored=[];
      for(const it of pool){
        let best=null;
        for(const k of kws){
          const sc=newsKeywordScore(it,k);
          if(sc.total>0&&(sc.exact+sc.norm)>=sc.total){
            if(!best||sc.exact>best.sc.exact||(sc.exact===best.sc.exact&&sc.norm>best.sc.norm))best={sc,kw:k};
          }
        }
        if(best)scored.push({...it,_kw:best.sc,_kwTopic:best.kw});
      }
      pool=scored;
      if(!pool.length)throw new Error(t("bg.newsNoMatch"));
      // Khớp giữ dấu xếp trước (chính xác, theo từ khóa đã gắn), rồi mới nhất.
      pool.sort((a,b)=>{
        if((b._kw.exact||0)!==(a._kw.exact||0))return (b._kw.exact||0)-(a._kw.exact||0);
        const ta=Date.parse(a.pubDate||""),tb=Date.parse(b.pubDate||"");
        if(isNaN(ta)&&isNaN(tb))return 0;
        if(isNaN(ta))return 1;
        if(isNaN(tb))return -1;
        return tb-ta;
      });
      const fresh=newsFreshOnly(pool,source.hours);
      if(!fresh.items.length)throw new Error(fresh.filtered&&pool.length?t("bg.newsNoRecent"):t("bg.newsNoMatch"));
      // Cùng một bài có thể nằm trong nhiều RSS/chuyên mục (link khác nhau,
      // tiêu đề y hệt) → chỉ giữ bản đầu (điểm khớp cao/mới nhất) để 20 nhóm
      // không nhận trùng nội dung.
      const seenTitles=new Set();
      const deduped=fresh.items.filter(it=>{
        const k=newsNormSearch(String(it.title||"").replace(/\s+/g," ").trim()).slice(0,160);
        if(!k)return true;
        if(seenTitles.has(k))return false;
        seenTitles.add(k);return true;
      });
      return deduped.slice(0,n).map(({_kw,_kwTopic,...rest})=>({...rest,topic:_kwTopic||""}));
    }
    let url="";
    if(sourceType==="google"){
      const kws=newsSplitKeywords(String(source?.q||""));
      if(!kws.length)throw new Error(t("bg.newsNoKeyword"));
      // Mỗi từ khóa 1 lượt tìm song song rồi gộp (dedupe theo link), gắn topic.
      const settled=await Promise.allSettled(kws.map(k=>fetchWithTimeout(`https://news.google.com/rss/search?q=${encodeURIComponent(k)}&hl=vi&gl=VN&ceid=VN:vi`,{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}},30000).then(async r=>{if(!r.ok)throw new Error(`HTTP ${r.status||"?"}`);return {kw:k,base:`https://news.google.com/rss/search?q=${encodeURIComponent(k)}&hl=vi&gl=VN&ceid=VN:vi`,items:parseRssItems(await r.text(),`https://news.google.com/rss/search?q=${encodeURIComponent(k)}&hl=vi&gl=VN&ceid=VN:vi`)};})));
      const seen=new Set();
      let pool=[];
      for(const s of settled){
        if(s.status!=="fulfilled")continue;
        for(const it of s.value.items){
          if(!it.link||seen.has(it.link))continue;
          seen.add(it.link);
          pool.push({...it,topic:s.value.kw});
        }
      }
      if(!pool.length)throw new Error(t("bg.newsEmpty"));
      const f=newsFreshOnly(pool,source.hours);
      if(!f.items.length)throw new Error(t("bg.newsNoRecent"));
      return f.items.slice(0,n);
    }else if(sourceType==="url"){
      const u=String(source?.url||"").trim();
      if(!/^https?:\/\//i.test(u))throw new Error(t("bg.newsBadSource"));
      url=u;
    }else{
      url=NEWS_VNEXPRESS_CATS[source?.category]||NEWS_VNEXPRESS_CATS["Tin mới nhất"];
    }
    const res=await fetchWithTimeout(url,{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}},30000);
    if(!res.ok)throw new Error(`HTTP ${res.status||"?"}`);
    const xml=await res.text();
    const items=parseRssItems(xml,url);
    if(!items.length)throw new Error(t("bg.newsEmpty"));
    const fresh=newsFreshOnly(items,source.hours);
    if(!fresh.items.length)throw new Error(t("bg.newsNoRecent"));
    return fresh.items.slice(0,n);
  }
  if(msg.action==="newsFetch"){
    (async()=>{
      try{
        const items=await fetchNewsList(msg.source||{},msg.count);
        sendResponse({ok:true,items,source:msg.source||{}});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error).slice(0,200)});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateNewsPost"){
    (async()=>{
      try{
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        if(!own.key&&own.profileId){
          try{
            const rp=await resolveAiProfile(own.profileId);
            if(rp&&(rp.key||rp.provider==="meta-free"))own={...own,provider:rp.provider||own.provider,key:rp.key,model:own.model||rp.model,url:own.url||rp.url};
          }catch(_){}
        }
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        if(!model&&provider!=="meta-free")throw new Error(t("bg.noModelProv",{provider:provider}));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrlAi"));
        const news=msg.news||{};
        const newsDate=String(news.pubDate||"").trim().slice(0,80);
        const newsAuthor=String(news.author||msg.sourceAuthor||"").trim().slice(0,120);
        const fbComments=(Array.isArray(news.comments)?news.comments:[]).slice(0,3)
          .map(c=>`${String(c.author||"?").slice(0,60)}: ${String(c.text||"").trim().slice(0,500)}`).filter(Boolean).join("\n");
        const newsText=(`${String(news.title||"").trim()}\n${String(news.desc||"").trim()}`.trim()+(newsAuthor?`\n(Tác giả: ${newsAuthor})`:"")+(fbComments?`\n(Bình luận nổi bật:\n${fbComments})`:"")).slice(0,2200)+(newsDate?`\n(Ngày đăng nguồn: ${newsDate})`:"");
        if(newsText.length<10)throw new Error(t("bg.postTooShort"));
        // Tổng hợp nhiều nguồn (Web của tôi): các tin cùng từ khóa, mới nhất.
        // Tin chính vẫn là msg.news (giữ {newsText}); các nguồn kèm chỉ để đối
        // chiếu, tăng trung thực — AI chỉ được dùng chi tiết có trong nguồn.
        const multi=(Array.isArray(msg.multiSources)?msg.multiSources:[]).filter(s=>s&&s!==news).slice(0,3)
          .map(s=>`[Nguồn ${String(s.site||"web").slice(0,60)}${s.pubDate?`, ngày ${String(s.pubDate).slice(0,40)}`:""}] ${String(s.title||"").trim().slice(0,200)}${s.desc?` — ${String(s.desc).trim().slice(0,400)}`:""}`).filter(Boolean).join("\n");
        const mode=msg.mode==="bg"?"bg":"long";
        const kind=["bg","photo","text"].includes(msg.kind)?msg.kind:(msg.mode==="bg"?"bg":(msg.mode==="photo"?"photo":"text"));
        const sourceMode=String(msg.sourceMode||"");
        const defaultTemplate=(sourceMode==="opinion"||sourceMode==="opinion_screenshot")
          ?t("bg.fbOpinionDefault")
          :(sourceMode==="rewrite"||sourceMode==="rewrite_original")
            ?t("bg.fbRewriteDefault")
            :(kind==="bg"?t("bg.newsBgDefault"):kind==="photo"?t("bg.newsPhotoDefault"):t("bg.newsDefault"));
        let template=String(msg.prompt||defaultTemplate);
        template=template.replaceAll("{newsText}",newsText).replaceAll("{topic}",String(msg.topic||"").slice(0,120)).replaceAll("{groupName}",String(msg.groupName||"").slice(0,180)).replaceAll("{sourceAuthor}",newsAuthor);
        if(!template.includes("{language}"))template+="\nViết bài bằng {language}.";
        template=await withPostLanguage(template);
        // Prompt nền tảng vẫn được người dùng tùy chỉnh, nhưng biến thể đăng
        // phải luôn có luật riêng: bài thường, bài kèm ảnh/chụp, và nền màu
        // không được dùng lẫn giọng hoặc độ dài. Append ở đây để không ghi đè
        // prompt đã lưu và áp dụng đồng nhất cho X/RSS/FB.
        const variantRule=(()=>{
          if(sourceMode==="x"||sourceMode==="web"){
            if(kind==="bg")return "\n\nQUY TẮC BIẾN THỂ NỀN MÀU: Viết 1-2 câu hoàn chỉnh, tự trọn nghĩa, cô đọng theo giới hạn ký tự nền màu; không dùng emoji, hashtag, URL, tiêu đề hay lời giải thích. Chỉ dùng thông tin có trong nguồn, không chép nguyên văn.";
            if(kind==="photo")return "\n\nQUY TẮC BIẾN THỂ KÈM ẢNH/CHỤP MÀN HÌNH: Viết bài đăng tự nhiên dài khoảng 120-250 từ, nêu ít nhất một chi tiết cụ thể từ nguồn và diễn giải lại bằng tiếng của người đăng. Không mô tả hoặc khẳng định chi tiết không nhìn thấy trong ảnh; không chép nguyên văn; kết bài bằng đúng một câu hỏi mở phù hợp với nhóm.";
            return "\n\nQUY TẮC BIẾN THỂ BÀI THƯỜNG: Viết bài đăng tự nhiên dài khoảng 120-250 từ, giữ đúng dữ kiện nguồn, nêu một nhận định có căn cứ và kết bài bằng đúng một câu hỏi mở. Không chép nguyên văn, không thêm số liệu hoặc diễn biến không có trong nguồn.";
          }
          if(sourceMode==="opinion"||sourceMode==="opinion_screenshot")return "\n\nQUY TẮC FB QUAN ĐIỂM + ẢNH CHỤP: Viết lại thành quan điểm cá nhân bằng tiếng Việt, giữ đúng dữ kiện nguồn, bổ sung nhận xét thận trọng và tự nhiên; ảnh chỉ là bằng chứng đính kèm, không bịa chi tiết ngoài phần chữ/ảnh được cung cấp; kết bằng đúng một câu hỏi mở.";
          if(sourceMode==="rewrite"||sourceMode==="rewrite_original")return "\n\nQUY TẮC FB VIẾT LẠI: Viết lại mạch lạc bằng tiếng Việt, giữ nguyên dữ kiện và số liệu, không bê nguyên câu chữ, không thêm thông tin ngoài nguồn; nếu có ảnh gốc thì nội dung phải phù hợp với ảnh đính kèm.";
          return "";
        })();
        template+=variantRule;
        const maxChars=Number(msg.maxChars)||0;
        if(mode==="bg"&&maxChars>0){
          // Ràng buộc độ dài ngay trong prompt (bắt live: prompt cũ chỉ bảo
          // "viết 1-2 câu" nên AI trả 180-250 ký tự, trim phải cắt ở mệnh đề →
          // bài nền cụt nghĩa "...bão nhiệt đới Rachel,").
          const lo=Math.round(maxChars*0.8);
          const vi=/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(template);
          template+=vi
            ?`\nYÊU CẦU BẮT BUỘC (nền màu chỉ hiển thị đúng khi không quá ${maxChars} ký tự): toàn bộ bài đúng 1-2 câu hoàn chỉnh, tự trọn nghĩa, tổng ${lo}–${maxChars} ký tự tính cả dấu cách, TUYỆT ĐỐI không vượt quá ${maxChars} ký tự.`
            :`\nMANDATORY (color background only renders correctly under ${maxChars} characters): the whole post must be 1-2 complete, self-contained sentences, ${lo}-${maxChars} characters including spaces, NEVER exceeding ${maxChars} characters.`;
        }
        const profileContext=await getActiveStyleContext(String(msg.styleProfileId||""));
        const multiRule=multi?`\nYÊU CẦU TRUNG THỰC (bài tổng hợp từ nhiều nguồn): chỉ dùng chi tiết, số liệu, tên riêng XUẤT HIỆN trong các nguồn dưới đây; chi tiết nào chỉ 1 nguồn có thì diễn đạt thận trọng, không khẳng định chắc nịch; TUYỆT ĐỐI không bịa thêm số liệu, diễn biến ngoài nguồn. Các nguồn tham khảo:\n${multi}`:"";
        const prompt=[template+multiRule,profileContext].filter(Boolean).join("\n\n");
        const raw=await callConfiguredText(provider,key,model||AI_DEFAULTS[provider]?.model||"",customUrl,newsText,prompt,null,String(msg.metaFeature||"news-post"),String(msg.imageDataUrl||""));
        let content=guardAiPostText(raw).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join(mode==="bg"?" ":"\n");
        content=truncateAtSentence(stripAiScaffolding(content),mode==="bg"?1800:1800);
        if(groupPostHasScaffolding(content)){const bad=new Error(t("bg.scaffoldContent"));bad.aiEmpty=true;throw bad;}
        if(mode==="bg"&&maxChars>0){
          content=fitGroupPostToBackground(content,maxChars);
          const bgMin=Math.max(40,Math.round(normalizeBackgroundMaxChars(maxChars)*0.8));
          const bgComplete=/[.!?…。！？]$/.test(String(content||"").trim());
          if(!content||backgroundTextLength(content)<bgMin||!bgComplete){
            // Một câu quá ngắn vẫn có thể vừa trần nhưng không đủ ý. Gọi một
            // lượt sửa có band 80–130 và cấm cắt cơ học; nếu AI vẫn không đạt
            // thì bỏ bài thay vì đăng nền cụt/nhạt.
            const repairPrompt=`Viết lại nội dung sau thành 1-2 câu tiếng Việt hoàn chỉnh, tự trọn nghĩa, dài ${bgMin}-${normalizeBackgroundMaxChars(maxChars)} ký tự tính cả dấu cách. Giữ đúng dữ kiện chính, không emoji, hashtag, URL, tiêu đề hay giải thích. Chỉ trả về nội dung bài, kết thúc bằng dấu câu rõ ràng. Nội dung cần sửa: ${String(content||"")}`;
            const repairedRaw=await callConfiguredText(provider,key,model||AI_DEFAULTS[provider]?.model||"",customUrl,newsText,repairPrompt,null,String(msg.metaFeature||"news-post"),String(msg.imageDataUrl||""));
            content=fitGroupPostToBackground(guardAiPostText(repairedRaw).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join(" "),maxChars);
            if(!content||backgroundTextLength(content)<bgMin||!/[.!?…。！？]$/.test(content.trim())){
              throw new Error(t("bg.postTooLong",{max:normalizeBackgroundMaxChars(maxChars)}));
            }
          }
          if(content&&/[,;:…\-–—]\s*$/.test(content)){
            // Trim phải cắt ở ranh giới mệnh đề → cụt nghĩa (bắt live bài nền
            // "...bão nhiệt đới Rachel,"). Cho AI gọn lại đúng 1 lần; vẫn cụt
            // thì bỏ bài thay vì đăng câu lơ lửng (fail-closed).
            try{
              const core=content.replace(/[,;:…\-–—]+\s*$/,"");
              const fixPrompt=`Viết gọn lại câu sau còn đúng dưới ${maxChars} ký tự (tính cả dấu cách), giữ trọn nghĩa gốc, phải là câu hoàn chỉnh có kết thúc rõ ràng, không được bỏ lửng ở dấu phẩy. Chỉ trả về nội dung, không giải thích. Câu gốc: "${core}"`;
              const raw2=await callConfiguredText(provider,key,model||AI_DEFAULTS[provider]?.model||"",customUrl,newsText,fixPrompt,null,String(msg.metaFeature||"news-post"),String(msg.imageDataUrl||""));
              const c2=fitGroupPostToBackground(guardAiPostText(raw2).replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join(" "),maxChars);
              if(c2&&!/[,;:…\-–—]\s*$/.test(c2))content=c2;
              else content="";
            }catch(_){content="";}
            if(!content)throw new Error(t("bg.newsBgCut"));
          }
        }
        if(!content)throw new Error(t("bg.contentEmpty"));
        // Không đăng nguyên văn nguồn hoặc sai ngôn ngữ dù Facebook/Meta đã
        // nhận được một chuỗi hợp lệ về mặt kỹ thuật.
        content=await validateNewsRewriteContent(content,newsText);
        sendResponse({ok:true,content,length:[...content].length,provider,model});
      }catch(error){
        sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});
      }
    })();
    return true;
  }
  if(msg.action==="newsFetchImage"){
    (async()=>{
      try{
        const url=newsDecodeEntities(String(msg.url||"").trim()).replace(/&amp;/g,"&");
        if(!/^https?:\/\//i.test(url))throw new Error(t("bg.newsBadSource"));
        // 2.11.10: áp cùng lớp chặn SSRF như fbFetchMedia — URL ảnh lấy từ
        // nội dung web/RSS, không cho trỏ vào đích nội bộ; URL cuối sau
        // redirect cũng được kiểm lại ở dưới trước khi đọc body.
        assertPublicMediaUrl(url);
        // Một số CDN báo chí chặn request thiếu Accept/referrer (hay gặp 401 với
        // ảnh RSS); gửi Accept ảnh + no-store, lỗi thì caller fallback tab capture.
        const res=await fetchWithTimeout(url,{cache:"no-store",headers:{"Accept":"image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}},30000);
        if(!res.ok)throw new Error(`HTTP ${res.status||"?"}`);
        if(res.url&&res.url!==url)assertPublicMediaUrl(res.url);
        const buf=new Uint8Array(await res.arrayBuffer());
        if(!buf.length||buf.length>8*1024*1024)throw new Error(t("bg.newsImgTooBig"));
        let mime="image/jpeg";
        try{const ct=String(res.headers.get("content-type")||"").split(";")[0].trim();if(/^image\//i.test(ct))mime=ct;}catch(_){}
        let bin="";
        for(let i=0;i<buf.length;i++)bin+=String.fromCharCode(buf[i]);
        sendResponse({ok:true,dataUrl:`data:${mime};base64,${btoa(bin)}`,bytes:buf.length});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error).slice(0,200)});}
    })();
    return true;
  }
  if(msg.action==="fbFetchMedia"){
    (async()=>{
      try{
        const rawUrl=String(msg.url||"").trim();
        if(!rawUrl)throw new Error("Missing media URL");
        if(rawUrl.startsWith("data:")){
          sendResponse({ok:true,dataUrl:rawUrl});
          return;
        }
        if(!/^https?:\/\//i.test(rawUrl))throw new Error("Invalid media URL");
        // 2.11.9: siết fbFetchMedia — chặn đích nội bộ (URL đầu + URL cuối sau
        // redirect) và trần cứng 50MB caller không nâng lên được (fbReels từng
        // xin 100MB): media Story/Reels là video ngắn, và handler trả cả file
        // dạng base64 qua message nên lớn hơn cũng không thực tế.
        assertPublicMediaUrl(rawUrl);
        const MEDIA_HARD_CAP=50*1024*1024;
        const maxBytes=Math.min(Number(msg.maxBytes)||MEDIA_HARD_CAP,MEDIA_HARD_CAP);
        const timeoutMs=Number(msg.timeoutMs)||60000;
        const res=await fetchWithTimeout(rawUrl,{cache:"no-store",headers:{"Accept":"image/*,video/*,*/*;q=0.8"}},timeoutMs);
        if(!res.ok)throw new Error(`HTTP ${res.status||"?"}`);
        if(res.url&&res.url!==rawUrl)assertPublicMediaUrl(res.url);
        const declaredLen=Number(res.headers.get("content-length")||0);
        if(declaredLen>maxBytes)throw new Error(`Media file exceeds size limit (${Math.round(declaredLen/1024/1024)}MB > ${Math.round(maxBytes/1024/1024)}MB)`);
        const buf=await readMediaBodyWithCap(res,maxBytes);
        if(!buf.length)throw new Error("Empty media file");
        let mime="application/octet-stream";
        try{
          const ct=String(res.headers.get("content-type")||"").split(";")[0].trim();
          if(ct)mime=ct;
        }catch(_){}
        if(mime==="application/octet-stream"){
          if(/\.(jpe?g|jpg)$/i.test(rawUrl))mime="image/jpeg";
          else if(/\.png$/i.test(rawUrl))mime="image/png";
          else if(/\.webp$/i.test(rawUrl))mime="image/webp";
          else if(/\.gif$/i.test(rawUrl))mime="image/gif";
          else if(/\.(mp4|m4v)$/i.test(rawUrl))mime="video/mp4";
          else if(/\.mov$/i.test(rawUrl))mime="video/quicktime";
          else if(/\.webm$/i.test(rawUrl))mime="video/webm";
          else mime=msg.isReels?"video/mp4":"image/jpeg";
        }
        let bin="";
        const chunk=8192;
        for(let i=0;i<buf.length;i+=chunk){
          bin+=String.fromCharCode.apply(null,buf.subarray(i,Math.min(i+chunk,buf.length)));
        }
        sendResponse({ok:true,dataUrl:`data:${mime};base64,${btoa(bin)}`,mime,bytes:buf.length});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error).slice(0,200)});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateStoryText"){
    (async()=>{
      try{
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        if(!own.key&&own.profileId){
          try{
            const rp=await resolveAiProfile(own.profileId);
            if(rp&&(rp.key||rp.provider==="meta-free"))own={...own,provider:rp.provider||own.provider,key:rp.key,model:own.model||rp.model,url:own.url||rp.url};
          }catch(_){}
        }
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        const userPrompt=String(msg.prompt||"").trim();
        const baseContext=String(msg.text||"").trim();
        const fullPrompt=`Bạn là chuyên gia viết content Story Facebook ngắn gọn và tự nhiên. Hãy viết DUY NHẤT 1 câu chữ để chèn lên Story Facebook.
Yêu cầu bắt buộc:
- Độ dài tối đa 80 ký tự (bao gồm cả dấu câu và khoảng trắng). Càng ngắn gọn, cảm xúc hoặc thu hút càng tốt.
- CHỈ trả về đúng câu chữ hiển thị trên Story, không để trong ngoặc kép, không kèm lời giải thích, không tiêu đề hay hashtag.
${userPrompt?`Chủ đề/Yêu cầu: ${userPrompt}\n`:""}${baseContext?`Chất liệu: ${baseContext}\n`:""}`;
        let res=await callConfiguredText(provider,key,model,customUrl,"",fullPrompt,100,"fb-story");
        let text=String(res||"").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g,"").replace(/\s+/g," ");
        if([...text].length>80)text=[...text].slice(0,80).join("").trim();
        sendResponse({ok:true,text,length:[...text].length,provider,model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="aiGenerateReelsCaption"){
    (async()=>{
      try{
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        if(!own.key&&own.profileId){
          try{
            const rp=await resolveAiProfile(own.profileId);
            if(rp&&(rp.key||rp.provider==="meta-free"))own={...own,provider:rp.provider||own.provider,key:rp.key,model:own.model||rp.model,url:own.url||rp.url};
          }catch(_){}
        }
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        const userPrompt=String(msg.prompt||"").trim();
        const content=String(msg.content||"").trim();
        const fullPrompt=`Bạn là chuyên gia sáng tạo nội dung Facebook Reels / Video ngắn. Nhiệm vụ: Viết một đoạn caption ngắn cuốn hút cho video Reel Facebook.
Yêu cầu:
- Tự nhiên, hấp dẫn, kích thích tương tác hoặc chia sẻ, kèm 3-5 hashtag liên quan.
- CHỈ trả về đúng nội dung caption, không kèm lời mở đầu hay giải thích của AI.
${userPrompt?`Yêu cầu: ${userPrompt}\n`:""}${content?`Chất liệu video: ${content}\n`:""}`;
        let res=await callConfiguredText(provider,key,model,customUrl,"",fullPrompt,350,"fb-reels");
        let caption=String(res||"").trim();
        sendResponse({ok:true,caption,provider,model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI")});}
    })();
    return true;
  }
  if(msg.action==="webCaptureImage"){
    (async()=>{
      const target={tabId:0};let attached=false;
      try{
        const articleUrl=String(msg.articleUrl||"").trim();
        const imageUrl=newsDecodeEntities(String(msg.imageUrl||"").trim()).replace(/&amp;/g,"&");
        if(!/^https?:\/\//i.test(articleUrl))throw new Error("bad article url");
        const tab=await chrome.tabs.create({url:articleUrl,active:false});
        target.tabId=tab.id;
        await waitTabComplete(tab.id,30000);
        await new Promise(r=>setTimeout(r,600));
        // Inject trực tiếp (không phụ thuộc content script chỉ có trên
        // vnexpress): mọi host tin tức đều lấy được ảnh.
        const picked=await chrome.scripting.executeScript({target:{tabId:tab.id},func:articleImagePick,args:[imageUrl]})
          .then(r=>r?.[0]?.result||null).catch(()=>null);
        if(picked?.ok&&picked.dataUrl){sendResponse({ok:true,dataUrl:picked.dataUrl,via:"canvas"});return;}
        if(!picked?.rect||!picked.rect.width||!picked.rect.height)throw new Error(picked?.error||"no capture");
        await chrome.debugger.attach(target,"1.3");attached=true;
        const shot=await chrome.debugger.sendCommand(target,"Page.captureScreenshot",{format:"jpeg",quality:92,captureBeyondViewport:true,clip:{x:0,y:0,width:picked.rect.width,height:picked.rect.height,scale:1}});
        if(!shot?.data)throw new Error("no-shot-data");
        sendResponse({ok:true,dataUrl:`data:image/jpeg;base64,${shot.data}`,via:"screenshot"});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error).slice(0,200)});}
      finally{
        if(attached){try{await chrome.debugger.detach(target);}catch(_){}}
        if(target.tabId)try{await chrome.tabs.remove(target.tabId);}catch(_){}
      }
    })();
    return true;
  }
  // Chụp màn hình 1 bài X: mở URL bài trong tab X, đo khung bài rồi
  // clip-capture qua debugger (ảnh đã có sẵn tên tác giả nên không đóng dấu).
  if(msg.action==="fbShotPost"){
    (async()=>{
      const target={tabId:0};let attached=false;
      try{
        const url=String(msg.url||"").trim();
        if(!/^https?:\/\/(?:www\.|m\.)?facebook\.com\//i.test(url))throw new Error(t("bg.newsBadSource"));
        // Tạo tab blank trước để attach debugger và set mobile viewport trước khi navigate
        const tab=await chrome.tabs.create({url:"about:blank",active:false});
        target.tabId=tab.id;
        await chrome.debugger.attach(target,"1.3");attached=true;
        // Mobile viewport kiểu iPhone 14 (390×844, dpr=3)
        await chrome.debugger.sendCommand(target,"Emulation.setDeviceMetricsOverride",{
          width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844
        });
        await chrome.debugger.sendCommand(target,"Page.navigate",{url});
        await waitTabComplete(tab.id,30000);
        await new Promise(r=>setTimeout(r,2500));
        const found=await new Promise(resolve=>{
          try{chrome.tabs.sendMessage(tab.id,{action:"fbSourceShotRect",includeComment:!!msg.includeComment},r=>resolve(chrome.runtime.lastError?null:r));}
          catch(_){resolve(null);}
        });
        if(!found?.ok||!found.rect)throw new Error(found?.error||"no-shot-rect");
        const clip={
          x:Math.max(0,Math.round(found.rect.x)),
          y:Math.max(0,Math.round(found.rect.y)),
          width:Math.max(1,Math.round(found.rect.width)),
          height:Math.min(8000,Math.max(1,Math.round(found.rect.height))),
          scale:3
        };
        const shot=await chrome.debugger.sendCommand(target,"Page.captureScreenshot",{format:"jpeg",quality:90,captureBeyondViewport:true,clip});
        if(!shot?.data)throw new Error("no-shot-data");
        sendResponse({ok:true,dataUrl:`data:image/jpeg;base64,${shot.data}`,withComment:!!found.withComment,width:clip.width,height:clip.height});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error).slice(0,200)});}
      finally{
        if(attached){try{await chrome.debugger.detach(target);}catch(_){}}
        if(target.tabId)try{await chrome.tabs.remove(target.tabId);}catch(_){}
      }
    })();
    return true;
  }
  if(msg.action==="xShotPost"){
    (async()=>{
      const target={tabId:0};let attached=false;
      try{
        const url=String(msg.url||"").trim();
        if(!/^https:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(url))throw new Error(t("bg.newsBadSource"));
        const tab=await ensureXTab();
        if(!tab?.id)throw new Error(t("bg.newsNoXTab"));
        target.tabId=tab.id;
        await chrome.tabs.update(tab.id,{url});
        await waitTabComplete(tab.id);
        await new Promise(r=>setTimeout(r,3000));
        const found=await sendXMessage(tab.id,{action:"xShotPost",url});
        if(!found?.ok)throw new Error(found?.error||"no-shot-rect");
        if(found.live){
          // Video live: tải poster tĩnh, ghi nguồn @tác giả (poster không có tên).
          if(!found.poster)throw new Error("no-poster");
          const pr=await fetchWithTimeout(found.poster,{},30000);
          if(!pr.ok)throw new Error(`HTTP ${pr.status||"?"}`);
          const pbuf=new Uint8Array(await pr.arrayBuffer());
          if(!pbuf.length||pbuf.length>8*1024*1024)throw new Error(t("bg.newsImgTooBig"));
          let pbin="";
          for(let i=0;i<pbuf.length;i++)pbin+=String.fromCharCode(pbuf[i]);
          const au=String(found.author||"").replace(/^@/,"");
          sendResponse({ok:true,dataUrl:`data:image/jpeg;base64,${btoa(pbin)}`,credit:au?`@${au}`:"x.com"});
          return;
        }
        if(!found.rect)throw new Error("no-shot-rect");
        await chrome.debugger.attach(target,"1.3");attached=true;
        const shot=await chrome.debugger.sendCommand(target,"Page.captureScreenshot",{format:"jpeg",quality:85,clip:{x:found.rect.x,y:found.rect.y,width:found.rect.width,height:found.rect.height,scale:1}});
        if(!shot?.data)throw new Error("no-shot-data");
        sendResponse({ok:true,dataUrl:`data:image/jpeg;base64,${shot.data}`});
      }catch(error){sendResponse({ok:false,error:String(error?.message||error).slice(0,200)});}
      finally{if(attached){try{await chrome.debugger.detach(target);}catch(_){}}}
    })();
    return true;
  }
  if(msg.action==="aiRewriteTrend"){    (async()=>{
      try{
        if(typeof msg.prompt==="string"&&msg.prompt.includes("{language}"))msg.prompt=await withPostLanguage(msg.prompt);
        const cfg=await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys"]),own=msg.aiConfig||{};
        const provider=own.provider||cfg.aiProvider||"gemini",saved=cfg.aiKeys?.[provider]||{};
        const key=normalizeApiKey(own.key||saved.key||cfg.aiApiKey||""),model=own.model||saved.model||cfg.aiModel||AI_DEFAULTS[provider]?.model||"",customUrl=own.url||saved.url||cfg.aiCustomUrl||"";
        if(!key&&provider!=="meta-free")throw new Error(t("bg.noKeyProv",{provider:provider}));
        if(!model&&provider!=="meta-free")throw new Error(t("bg.noModelProv",{provider:provider}));
        if(provider==="custom"&&!customUrl)throw new Error(t("bg.noCustomUrlAi"));
        const sourceText=String(msg.sourceText||"").replace(/\s+/g," ").trim().slice(0,6000);
        if(sourceText.length<30)throw new Error(t("bg.postTooShort"));
        const groupName=String(msg.groupName||"").trim().slice(0,180);
        const profileContext=await getActiveStyleContext(String(msg.styleProfileId||""));
        const background=msg.background&&typeof msg.background==="object"&&msg.background.enabled?{enabled:true,maxChars:normalizeBackgroundMaxChars(msg.background.maxChars)}:{enabled:false,maxChars:100};
        const template=String(msg.prompt||"Đọc các bài đã học rồi viết thành bài của mình theo dàn ý đó cho nhóm \"{groupName}\".").replaceAll("{groupName}",groupName);
        const bgPrompt=backgroundPromptRules(background)?`\n${backgroundPromptRules(background)}`:"";
        const prompt=strictTrendRewritePrompt([template,profileContext].filter(Boolean).join("\n\n")+bgPrompt,sourceText,groupName,msg.variant,background);
        let raw="";
        if(provider==="meta-free")raw=await callMetaFreeText(prompt,"trend");
        else if(provider==="gemini")raw=await callGemini(key,model||AI_DEFAULTS.gemini.model,"",prompt,false);
        else if(provider==="claude"||provider==="Muse")raw=await callClaude(key,model,"",prompt,false);
        else{const def=AI_DEFAULTS[provider]||AI_DEFAULTS.openai;raw=await callOpenAICompatible(key,customUrl||def.url,model||def.model,"",prompt,false);}
        let content="",backgroundFallback=false;
        try{
          content=cleanTrendPost(raw);
        }catch(error){
          // Một số model trả thêm lời dẫn/chip giao diện dù prompt đã yêu cầu
          // văn bản thuần. Cho Trend đúng một lượt sửa lại có kiểm soát; vẫn
          // chạy lại guard và fail-closed nếu còn rác, không đăng mù.
          const repair=`Tách và viết lại phần nội dung bài đăng từ bản nháp sau. Bỏ toàn bộ lời dẫn của AI, nhãn, chip giao diện, markdown, giải thích và câu lệnh. Chỉ trả về duy nhất 1-2 câu tiếng Việt hoàn chỉnh, giữ đúng dữ kiện trong bản nháp, không thêm thông tin mới. Bản nháp:\n${String(raw||"").slice(0,5000)}`;
          const repaired=await callConfiguredText(provider,key,model,customUrl,"",repair,null,"trend");
          content=cleanTrendPost(repaired);
        }
        try{
          content=await repairBackgroundPost(content,background,
            repairPrompt=>callConfiguredText(provider,key,model,customUrl,"",repairPrompt,null,"trend"),
            value=>cleanTrendPost(value));
        }catch(error){
          // Không fallback sang bài chữ thường: người dùng đã chọn nền màu,
          // nên bản nháp không đạt trần/độ dài phải dừng rõ ràng.
          throw error;
        }
        if(!content)throw new Error(t("bg.contentEmpty"));
        sendResponse({ok:true,content,length:[...content].length,backgroundEligible:!backgroundFallback&&[...content].length<=background.maxChars,backgroundFallback,provider,model});
      }catch(error){sendResponse({ok:false,error:friendlyAiError(error,msg.aiConfig?.provider||"AI"),debugSample:error?.rawSample||""});}
    })();
    return true;
  }
  if(msg.action==="trustedInput"){
    (async ()=>{
      const tabId=sender.tab?.id;
      if(!tabId) throw new Error("Khong xac dinh duoc tab Facebook");
      const target={tabId}; let attached=false;
      try{
        await chrome.debugger.attach(target,"1.3"); attached=true;
        const inputText=String(msg.text||"");
        const hasLegacyTyping=msg.typingMinDelay!==undefined||msg.typingMaxDelay!==undefined||msg.typingChunkSize!==undefined||msg.humanLike!==undefined;
        const typing=msg.typingConfig
          ? normalizeAiTypingConfig(msg.typingConfig)
          : hasLegacyTyping
            ? normalizeAiTypingConfig({
                mode:"custom",
                minDelayMs:msg.typingMinDelay,
                maxDelayMs:msg.typingMaxDelay,
                chunkSize:parseInt(msg.typingChunkSize)||1,
                humanLike:msg.humanLike!==false,
                punctuationPauseMinMs:140,
                punctuationPauseMaxMs:320,
                spacePauseMinMs:10,
                spacePauseMaxMs:40
              })
            : null;
        const checkTypingActive=async()=>{
          if(!msg.abortStorageKey)return true;
          const runIdKey=String(msg.abortRunIdKey||"groupShareRunId");
          const guard=await chrome.storage.local.get([msg.abortStorageKey,runIdKey]);
          return !!guard[msg.abortStorageKey]&&(!msg.abortRunId||guard[runIdKey]===msg.abortRunId);
        };
        const abortTyping=()=>{
          const stopped=new Error(t("bg.stoppedTyping"));
          stopped.code="ABORT_TYPING";
          return stopped;
        };
        const waitTypingPause=async(ms)=>{
          const end=Date.now()+Math.max(0,Number(ms)||0);
          while(Date.now()<end){
            if(!(await checkTypingActive()))throw abortTyping();
            await new Promise(resolve=>setTimeout(resolve,Math.min(250,end-Date.now())));
          }
        };
        const pressEnterKey=async()=>{
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"char",key:"Enter",code:"Enter",text:"\r",unmodifiedText:"\r",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
        };
        // Ngắt dòng trong khung soạn (khác với Enter gửi bài): dùng
        // Shift+Enter để Lexical chèn ngắt dòng thật thay vì tách đoạn
        // (Enter thường trong khung comment còn gửi luôn bài giữa chừng).
        const pressShiftEnterKey=async()=>{
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,modifiers:8});
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,modifiers:8});
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"char",key:"Enter",code:"Enter",text:"\r",unmodifiedText:"\r",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,modifiers:8});
          await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,modifiers:8});
        };
        // Input.insertText does not turn an embedded "\n" into a real line
        // break inside a contenteditable box (React just drops/ignores it),
        // so a caption+URL joined with "\n\n" ends up glued together with no
        // separator at all — Facebook then never recognizes the URL as a
        // link to unfurl. Split on real newlines and dispatch an actual
        // Shift+Enter keypress between segments instead.
        const segments=inputText.split(/\r?\n/);
        for(let segIndex=0;segIndex<segments.length;segIndex++){
          const segment=segments[segIndex];
          if(segment){
            if(typing&&typing.maxDelayMs>0){
              // Gõ theo cụm code-point để giảm số mutation mà React phải xử lý,
              // nhưng vẫn giữ nhịp nghỉ theo từng code-point trong cụm.
              const chars=[...segment];
              const chunkSize=typing.chunkSize;
              for(let index=0;index<chars.length;){
                if(!(await checkTypingActive()))throw abortTyping();
                const chunk=chars.slice(index,index+chunkSize);
                await chrome.debugger.sendCommand(target,"Input.insertText",{text:chunk.join("")});
                await waitTypingPause(aiTypingPauseForChunk(typing,chunk));
                index+=chunk.length;
              }
            }else{
              if(!(await checkTypingActive()))throw abortTyping();
              await chrome.debugger.sendCommand(target,"Input.insertText",{text:segment});
            }
          }
          if(segIndex<segments.length-1){
            if(!(await checkTypingActive()))throw abortTyping();
            await pressShiftEnterKey();
            // React re-renders the contenteditable around the new paragraph
            // break; inserting the next segment's text immediately can land
            // before that settles and get dropped or truncated. 120ms proved
            // unreliable under load; 350ms is a safer margin.
            await new Promise(resolve=>setTimeout(resolve,350));
          }
        }
        if(msg.pressEnter){
          if(!(await checkTypingActive()))throw abortTyping();
          await pressEnterKey();
        }
        sendResponse({ok:true});
      }catch(e){ sendResponse({ok:false,error:e.message,code:e.code||""}); }
      finally{ if(attached){try{await chrome.debugger.detach(target);}catch(_){}} }
    })().catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg.action==="trustedInsertText"){
    (async()=>{
      const tabId=sender.tab?.id;
      if(!tabId){sendResponse({ok:false,error:"no tab"});return;}
      const target={tabId};let attached=false;
      try{
        await chrome.debugger.attach(target,"1.3");attached=true;
        await chrome.debugger.sendCommand(target,"Input.insertText",{text:String(msg.text||"")});
        sendResponse({ok:true});
      }catch(e){sendResponse({ok:false,error:e.message});}
      finally{if(attached){try{await chrome.debugger.detach(target);}catch(_){}}}
    })();
    return true;
  }
  if(msg.action==="trustedKey"){
    (async()=>{
      const tabId=sender.tab?.id;
      if(!tabId){sendResponse({ok:false,error:"Khong xac dinh duoc tab Facebook"});return;}
      const target={tabId};let attached=false;
      try{
        if(msg.abortStorageKey){const guard=await chrome.storage.local.get([msg.abortStorageKey,"groupShareRunId"]);if(!guard[msg.abortStorageKey]||(msg.abortRunId&&guard.groupShareRunId!==msg.abortRunId))throw new Error(t("bg.stoppedEdit"));}
        await chrome.debugger.attach(target,"1.3");attached=true;
        const key=String(msg.key||"Backspace"),code=String(msg.code||key),vk=Number(msg.windowsVirtualKeyCode)||8,modifiers=Number(msg.modifiers)||0;
        await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"rawKeyDown",key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers});
        // Lexical/Facebook trên Chrome for Testing đôi lúc chỉ xử lý
        // keyDown chuẩn, còn rawKeyDown một mình làm Meta+A không chọn draft.
        // Gửi cả hai event của cùng một phím, rồi mới keyUp.
        await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"keyDown",key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers});
        await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{type:"keyUp",key,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,modifiers});
        sendResponse({ok:true});
      }catch(error){sendResponse({ok:false,error:error.message});}
      finally{if(attached){try{await chrome.debugger.detach(target);}catch(_){}}}
    })();
    return true;
  }
  if(msg.action==="trustedMouse"){
    (async ()=>{
      const tabId=sender.tab?.id;
      if(!tabId) throw new Error("Khong xac dinh duoc tab Facebook");
      const target={tabId};
      let attached=false;
      try{
        await chrome.debugger.attach(target,"1.3");
        attached=true;
        await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
          type:"mouseMoved", x:msg.x, y:msg.y, button:"none", buttons:0
        });
        if(msg.kind==="click"){
          await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
            type:"mousePressed", x:msg.x, y:msg.y, button:"left", buttons:1, clickCount:1
          });
          await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
            type:"mouseReleased", x:msg.x, y:msg.y, button:"left", buttons:0, clickCount:1
          });
        }else if(msg.kind==="wheel"){
          await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
            type:"mouseWheel", x:msg.x, y:msg.y,
            deltaX:Number(msg.deltaX)||0, deltaY:Number(msg.deltaY)||0,
            modifiers:Number(msg.modifiers)||0
          });
        }
        sendResponse({ok:true,kind:msg.kind||"click"});
      }catch(e){
        console.error("[Mouse]",e);
        sendResponse({ok:false,error:e.message});
      }finally{
        if(attached){ try{ await chrome.debugger.detach(target); }catch(_){} }
      }
    })().catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
  if(msg.action==="aiGenerateComment"){
    (async ()=>{
      try{
        const cfg = await chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiPrompt","aiCustomUrl","aiKeys"]);
        // aiKeys luu theo provider de ho tro nhieu API
        // Tab AI gán hồ sơ riêng cho Comment độc lập: ưu tiên aiConfig kèm theo.
        const suppliedCfg=(msg.aiConfig&&typeof msg.aiConfig==="object")?msg.aiConfig:{};
        const resolvedCfg=(!suppliedCfg.key&&msg.aiProfileId)?await resolveAiProfile(msg.aiProfileId):{};
        const ownCfg={...resolvedCfg,...suppliedCfg,key:suppliedCfg.key||resolvedCfg.key||""};
        let provider = ownCfg.provider||cfg.aiProvider || "gemini";
        let apiKey = ownCfg.key||cfg.aiApiKey || "";
        let model = ownCfg.model||cfg.aiModel || "";
        let promptTemplate = msg.prompt || cfg.aiPrompt || "";
        const profileContext=await getActiveStyleContext();
        if(profileContext)promptTemplate=[promptTemplate,profileContext].filter(Boolean).join("\n\n");
        if(Number(msg.maxLines)===2){try{const pl=await nextTagPositionLine();if(pl)promptTemplate+="\n\n"+pl;}catch(_){}}
        let customUrl = ownCfg.url||cfg.aiCustomUrl || "";
        // neu co aiKeys multi (bỏ qua khi đã có hồ sơ riêng kèm theo)
        if(!ownCfg.key&&cfg.aiKeys && cfg.aiKeys[provider]){
          const p = cfg.aiKeys[provider];
          apiKey = p.key || apiKey;
          model = p.model || model;
          customUrl = p.url || customUrl;
        }
        // meta-free hỏi qua tab meta.ai đã login nên miễn kiểm tra API key.
        if(!apiKey && provider!=="meta-free") throw new Error(t("bg.noKeyTabAi",{provider:provider}));

        let comment="";
        if(provider==="meta-free"){
          comment = await callMetaFreeText(buildMetaFreePrompt(msg.postText, promptTemplate),"comment");
        } else if(provider==="openai" || provider==="groq" || provider==="openrouter" || provider==="deepseek" || provider==="mistral"){
          const def = AI_DEFAULTS[provider] || AI_DEFAULTS.openai;
          const url = customUrl || def.url;
          const m = model || def.model;
          comment = await callOpenAICompatible(apiKey, url, m, msg.postText, promptTemplate);
        } else if(provider==="gemini"){
          const m = model || AI_DEFAULTS.gemini.model;
          comment = await callGemini(apiKey, m, msg.postText, promptTemplate);
        } else if(provider==="claude" || provider==="Muse"){
          const m = model || AI_DEFAULTS.claude.model;
          comment = await callClaude(apiKey, m, msg.postText, promptTemplate);
        } else if(provider==="custom"){
          if(!customUrl) throw new Error(t("bg.noCustomUrlApi"));
          const m = model || "gpt-3.5-turbo";
          comment = await callOpenAICompatible(apiKey, customUrl, m, msg.postText, promptTemplate);
        } else {
          throw new Error(t("bg.noProvider",{provider:provider}));
        }
        comment=cleanGeneratedComment(comment,msg.maxLines);
        if(!comment) throw new Error(t("bg.aiEmpty"));
        if(Number(msg.maxLines)===2&&!commentSharesPostDetail(comment,String(msg.postText||"")))throw Object.assign(new Error(t("bg.noPostDetail")),{aiEmpty:true,code:"AI_EMPTY"});
        sendResponse({ ok:true, comment });
      } catch(e){
        console.error("[AI] loi",e);
        sendResponse({ ok:false, error: e.message });
      }
    })();
    return true; // async
  }
});

// ============================================================
// LICENSE SYSTEM - Floating single-seat, JWT-based
// ============================================================

async function getLicenseState() {
  const s = await chrome.storage.local.get(["licenseToken","licenseKey","licenseGmail","licenseMachineId","licenseLastVerified","licenseValid","licenseReason","licenseExpiry","licensePlan"]);
  return s;
}

async function activateLicense(licenseKey, gmail) {
  return { ok: true }; // Auto vjp (fork noi bo): license da go — khong kich hoat qua server
}

async function verifyLicense() {
  try { await chrome.storage.local.set({ licenseValid: true, licenseReason: "", licenseToken: "preview-local", licenseLastVerified: Date.now(), licensePlan: "lifetime" }); } catch (_) {}
  return true; // Auto vjp (fork noi bo): license da go — khong verify qua server
}

// Alarm verify mỗi 3 ngày
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "licenseVerify") verifyLicense().catch(() => {});
  if (alarm.name === "metaFreeRestoreFocus") metaFreeRestoreFocus(0);
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("licenseVerify", { periodInMinutes: 3 * 24 * 60 });
});
chrome.runtime.onStartup.addListener(() => {
  verifyLicense().catch(() => {});
  checkForUpdate().catch(() => {});
});

// ── Auto-update notification ──────────────────────────────────────────────
async function checkForUpdate() {
  return; // Auto vjp (fork noi bo): tat han check update ve server tac gia
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'updateCheck') checkForUpdate().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('updateCheck', { periodInMinutes: 4 * 60 });
  checkForUpdate().catch(() => {});
});

// Auto vjp (fork noi bo): da go han co che tu tai ban moi — khong con server cap nhat.
async function downloadUpdateZipData(){
  throw new Error("Auto vjp: tinh nang tai ban moi da bi go bo");
}

// Message handlers
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "activateLicense") {
    activateLicense(msg.licenseKey, msg.gmail)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.action === "verifyLicense") {
    verifyLicense()
      .then(ok => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.action === "getLicenseState") {
    getLicenseState().then(s => sendResponse(s)).catch(() => sendResponse({}));
    return true;
  }
  if (msg.action === "resetLicense") {
    chrome.storage.local.remove(["licenseToken","licenseKey","licenseGmail","licenseLastVerified","licenseValid","licenseReason","licenseExpiry","licensePlan"])
      .then(() => chrome.storage.sync.remove(["licenseKeyBackup","licenseGmailBackup"]).catch(()=>{}))
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.action === "downloadUpdateZip") {
    downloadUpdateZipData()
      .then(d => sendResponse({ ok: true, ...d }))
      .catch(e => sendResponse({ ok: false, error: String(e?.message||e) }));
    return true;
  }
});

// === Auto vjp module layer (S2, 2026-11-04) — ĐIỂM CHẠM DUY NHẤT vào lõi FB ===
// Nạp tầng module đa nền tảng (modules/) — xem modules/MODULE-CONTRACT.md.
// Bọc try/catch: tầng module lỗi thì lõi FB vẫn chạy bình thường.
try {
  importScripts('modules/bridge.js');
} catch (e) {
  console.error('[Auto vjp] module layer load failed:', e);
}
