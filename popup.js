const $ = id => document.getElementById(id);
const FEED_SCOPED_ACTIVE_KEYS=["feedBantinActive","feedFriendsActive","feedGroupsActive","feedPagesActive"];
// Prompt không bao giờ được để trống: mọi ô prompt trong popup.html đều có
// default cứng. Restore từ storage CHỈ ghi đè khi giá trị đã lưu non-empty
// (bắt live bản khách 1.9.455: blankPageDataset "" + saved "" xóa sạch default
// của tab Page, khách thấy toàn ô trống).
function setPromptIf(el,val){
  if(!el)return;
  if(typeof val==="string"&&val.trim())el.value=val;
}

// ============================================================
// LICENSE GATE — chạy trước tất cả, block UI nếu chưa kích hoạt
// ============================================================
(async function licenseGate() {
  // === Auto vjp: huy hieu ten ban ===
  try {
    const badge = document.createElement("span");
    badge.id = "licenseBadge";
    badge.textContent = "Auto vjp";
    badge.title = "Auto vjp";
    badge.style.cssText = "font-size:10px;background:#e6f4ea;color:#1a7a2e;border-radius:6px;padding:2px 7px;margin-left:6px;font-weight:600;";
    document.addEventListener("DOMContentLoaded", () => {
      const ver = document.getElementById("appVersion");
      if (ver) ver.after(badge);
    });
  } catch (_) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  return;
  // === het phan chen; toan bo gate goc ben duoi khong chay nua ===
})();

// Nhúng "Cấu hình dùng chung" vào friend-main (liền mạch với 4 chế độ),
// nhưng giữ card "Làm ấm" là grid item độc lập.
(()=>{
  const compose=()=>{
    const panel=document.getElementById("panelAdd");
    const main=panel?.querySelector(":scope > .friend-main");
    const shared=[...(panel?.children||[])].find(el=>el.classList?.contains("card")&&el.querySelector("#minDelay"));
    if(!main||!shared||main.querySelector("[data-inline-shared]"))return false;
    const wrap=document.createElement("div");
    wrap.className="friend-inline-shared";
    wrap.dataset.inlineShared="1";
    while(shared.firstChild)wrap.append(shared.firstChild);
    main.append(wrap);
    shared.remove();
    return true;
  };
  const timer=setInterval(()=>{if(compose())clearInterval(timer);},100);
  setTimeout(()=>clearInterval(timer),6000);
})();

/* ===== APPEARANCE ===== */
const ACCENT_PRESETS={
  "#0A84FF":"#5E5CE7","#5E5CE7":"#9B59B6","#BF5AF2":"#9B59B6",
  "#FF375F":"#C0392B","#FF9F0A":"#E67E22","#30D158":"#27AE60",
  "#00C7BE":"#1ABC9C","#636366":"#4A4A4F"
};
function applyAppearance(s={}){
  const root=document.documentElement;
  const theme=s.theme||"light";
  const isDark=theme==="dark"||(theme==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  const alpha=(s.glassAlpha??58)/100;
  const blur=s.blur??22;
  if(isDark){
    root.setAttribute("data-theme","dark");
    root.style.setProperty("--glass",`rgba(18,28,52,${alpha})`);
    root.style.setProperty("--stroke",`rgba(255,255,255,${Math.min(alpha*.22,.18)})`);
  }else{
    root.removeAttribute("data-theme");
    root.style.setProperty("--glass",`rgba(255,255,255,${alpha})`);
    root.style.setProperty("--stroke",`rgba(255,255,255,${Math.min(alpha+.22,.98)})`);
  }
  root.style.setProperty("--blur",`${blur}px`);
  if(s.accent){
    root.style.setProperty("--accent",s.accent);
    root.style.setProperty("--accent2",ACCENT_PRESETS[s.accent]||s.accent);
  }
  if(s.fontSize)document.body.style.fontSize=s.fontSize+"px";
  if(s.compact)document.body.classList.add("compact");
  else document.body.classList.remove("compact");
}
function syncAppearanceUI(s={}){
  document.querySelectorAll(".theme-chip").forEach(el=>{
    el.classList.toggle("active",el.dataset.themeVal===(s.theme||"light"));
  });
  document.querySelectorAll(".accent-swatch").forEach(el=>{
    el.classList.toggle("active",el.dataset.accent===(s.accent||"#0A84FF"));
  });
  document.querySelectorAll(".appear-size-chip").forEach(el=>{
    el.classList.toggle("active",Number(el.dataset.size)===(s.fontSize||13));
  });
  const alphaSlider=$("glassAlphaSlider"),alphaVal=$("glassAlphaVal");
  if(alphaSlider){alphaSlider.value=s.glassAlpha??58;if(alphaVal)alphaVal.textContent=(s.glassAlpha??58)+"%";}
  const blurSlider=$("blurSlider"),blurVal=$("blurVal");
  if(blurSlider){blurSlider.value=s.blur??22;if(blurVal)blurVal.textContent=(s.blur??22)+"px";}
  const compact=$("compactToggle");
  if(compact)compact.checked=!!s.compact;
}
async function loadAndApplyAppearance(){
  const {uiAppearance}=await chrome.storage.sync.get("uiAppearance").catch(()=>({}));
  const s=uiAppearance||{};
  applyAppearance(s);
  syncAppearanceUI(s);
  return s;
}
async function saveAppearance(patch){
  const {uiAppearance}=await chrome.storage.sync.get("uiAppearance").catch(()=>({}));
  const next=Object.assign({},uiAppearance||{},patch);
  await chrome.storage.sync.set({uiAppearance:next}).catch(()=>{});
  applyAppearance(next);
  syncAppearanceUI(next);
}
(()=>{
  // Load ngay khi popup mở
  loadAndApplyAppearance();
  // Auto theme listener
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{
    chrome.storage.sync.get("uiAppearance").then(({uiAppearance})=>{
      if((uiAppearance||{}).theme==="auto")applyAppearance(uiAppearance||{});
    }).catch(()=>{});
  });
  // Toggle panel
  const btn=$("appearBtn"),panel=$("appearPanel");
  if(btn&&panel){
    btn.addEventListener("click",e=>{e.stopPropagation();panel.classList.toggle("hidden");});
    document.addEventListener("click",e=>{if(!panel.contains(e.target)&&e.target!==btn)panel.classList.add("hidden");});
  }
  // Theme chips
  document.querySelectorAll(".theme-chip").forEach(el=>{
    el.addEventListener("click",()=>saveAppearance({theme:el.dataset.themeVal}));
  });
  // Accent swatches
  document.querySelectorAll(".accent-swatch").forEach(el=>{
    el.addEventListener("click",()=>saveAppearance({accent:el.dataset.accent}));
  });
  // Size chips
  document.querySelectorAll(".appear-size-chip").forEach(el=>{
    el.addEventListener("click",()=>saveAppearance({fontSize:Number(el.dataset.size)}));
  });
  // Glass alpha slider
  const alphaSlider=$("glassAlphaSlider"),alphaVal=$("glassAlphaVal");
  if(alphaSlider){
    alphaSlider.addEventListener("input",()=>{
      const v=Number(alphaSlider.value);
      if(alphaVal)alphaVal.textContent=v+"%";
      saveAppearance({glassAlpha:v});
    });
  }
  // Blur slider
  const blurSlider=$("blurSlider"),blurVal=$("blurVal");
  if(blurSlider){
    blurSlider.addEventListener("input",()=>{
      const v=Number(blurSlider.value);
      if(blurVal)blurVal.textContent=v+"px";
      saveAppearance({blur:v});
    });
  }
  // Compact toggle
  const compactToggle=$("compactToggle");
  if(compactToggle){
    compactToggle.addEventListener("change",()=>saveAppearance({compact:compactToggle.checked}));
  }
})();

// Read straight from manifest.json instead of a hardcoded string in
// popup.html, so this label can never drift out of sync with the version
// that was actually just bumped after a code fix.
(() => { const el = $("appVersion"); if (el) el.textContent = `v${chrome.runtime.getManifest().version}`; })();

// Hiện banner nếu background đã phát hiện có bản mới
(async () => {
  try {
    const { updateAvailable, updateLatestVer } = await chrome.storage.local.get(['updateAvailable', 'updateLatestVer']);
    const banner = document.getElementById('updateBanner');
    const txt = document.getElementById('updateBannerText');
    const link = document.getElementById('updateBannerLink');
    if (banner && updateAvailable && updateLatestVer) {
      txt.textContent = `Có bản cập nhật mới v${updateLatestVer}!`;
      banner.classList.remove('hidden');
    }
    if (link) {
      link.onclick = async (e) => {
        e.preventDefault();
        link.textContent = '⏳ Đang kiểm tra...';
        link.style.pointerEvents = 'none';
        try {
          const status = await new Promise(resolve => chrome.runtime.requestUpdateCheck(resolve));
          if (status === 'update_available') {
            link.textContent = '✅ Đang tải bản mới — đóng & mở lại Chrome';
            chrome.runtime.reload();
          } else if (status === 'throttled') {
            link.textContent = '⚠️ Vừa check — thử lại sau 1 phút';
            link.style.pointerEvents = '';
          } else {
            link.textContent = '✅ Đang cài — khởi động lại Chrome';
            setTimeout(() => chrome.runtime.reload(), 1500);
          }
        } catch (_) {
          link.textContent = 'Mở chrome://extensions để cập nhật';
          link.style.pointerEvents = '';
          link.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions' }); };
        }
      };
    }
    const dl = document.getElementById('updateBannerDl');
    if (dl) {
      dl.onclick = async (e) => {
        e.preventDefault();
        dl.textContent = t("upd.downloading");
        dl.style.pointerEvents = 'none';
        try {
          const r = await chrome.runtime.sendMessage({ action: "downloadUpdateZip" });
          if (!r?.ok) throw new Error(r?.error || "download failed");
          await chrome.downloads.download({ url: r.dataUrl, filename: r.filename, saveAs: false });
          txt.textContent = t("upd.guide", { file: r.filename });
          dl.style.display = 'none';
        } catch (err) {
          dl.textContent = t("upd.retry", { err: String(err?.message || err).slice(0, 60) });
          dl.style.pointerEvents = '';
        }
      };
    }
  } catch (_) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
})();

function mountAiTypingControls(){
  const template=$("aiTypingControlTemplate");
  if(!template?.content)return;
  document.querySelectorAll("[data-ai-typing-slot]").forEach(slot=>{
    const key=slot.getAttribute("data-ai-typing-slot")||"";
    const fragment=template.content.cloneNode(true);
    const root=fragment.querySelector("[data-ai-typing-control]");
    if(!root)return;
    root.setAttribute("data-ai-typing-control",key);
    slot.replaceWith(fragment);
  });
}
mountAiTypingControls();

function getAiTypingControls(){
  return [...document.querySelectorAll("[data-ai-typing-control]")];
}
function getAiTypingControl(target=""){
  const roots=getAiTypingControls();
  if(target&&typeof target!="object")return roots.find(root=>root.dataset.aiTypingControl===target)||roots[0]||null;
  return target&&typeof target==="object"?target:roots[0]||null;
}
function getAiTypingConfig(target=""){
  const root=getAiTypingControl(target);
  const modeEl=root?.querySelector("[data-ai-typing-mode]");
  const mode=modeEl?.value||AI_TYPING_DEFAULT_MODE;
  return normalizeAiTypingConfig({
    mode,
    minDelayMs: mode === "custom" ? root?.querySelector("[data-ai-typing-min]")?.value : undefined,
    maxDelayMs: mode === "custom" ? root?.querySelector("[data-ai-typing-max]")?.value : undefined,
    chunkSize: mode === "custom" ? root?.querySelector("[data-ai-typing-chunk]")?.value : undefined
  });
}

function renderAiTypingSettings(config=null){
  const safe = normalizeAiTypingConfig(config||getAiTypingConfig());
  getAiTypingControls().forEach(root=>{
    const modeEl=root.querySelector("[data-ai-typing-mode]");
    const customOptions=root.querySelector("[data-ai-typing-custom-options]");
    const minEl=root.querySelector("[data-ai-typing-min]");
    const maxEl=root.querySelector("[data-ai-typing-max]");
    const chunkEl=root.querySelector("[data-ai-typing-chunk]");
    const summaryEl=root.querySelector("[data-ai-typing-summary]");
    if(modeEl)modeEl.value=safe.mode;
    if(minEl)minEl.value=String(safe.minDelayMs);
    if(maxEl)maxEl.value=String(safe.maxDelayMs);
    if(chunkEl)chunkEl.value=String(safe.chunkSize);
    if(customOptions)customOptions.style.display=safe.mode==="custom"?"flex":"none";
    if(summaryEl){
      const name=t(`ait.${safe.mode}`);
      summaryEl.textContent=t("ait.summaryPreset",{name,chunk:safe.chunkSize,min:safe.minDelayMs,max:safe.maxDelayMs});
    }
  });
  return safe;
}

async function saveAiTypingSettings(source=null){
  const safe = renderAiTypingSettings(getAiTypingConfig(source));
  await chrome.storage.sync.set({
    aiTypingMode: safe.mode,
    aiTypingMinDelayMs: safe.minDelayMs,
    aiTypingMaxDelayMs: safe.maxDelayMs,
    aiTypingChunkSize: safe.chunkSize
  });
  return safe;
}

async function initAiTypingSettings() {
  const saved = await chrome.storage.sync.get(["aiTypingMode", "aiTypingMinDelayMs", "aiTypingMaxDelayMs", "aiTypingChunkSize"]);
  const mode = ["fast", "balanced", "human", "custom"].includes(String(saved.aiTypingMode || "")) ? saved.aiTypingMode : AI_TYPING_DEFAULT_MODE;
  renderAiTypingSettings(normalizeAiTypingConfig({
    mode,
    minDelayMs: saved.aiTypingMinDelayMs,
    maxDelayMs: saved.aiTypingMaxDelayMs,
    chunkSize: saved.aiTypingChunkSize
  }));
}

getAiTypingControls().forEach(root=>root.addEventListener("change",()=>{saveAiTypingSettings(root).catch(()=>{});}));

async function getUnifiedAiConfig(preferredProvider=""){
  const [sync,local]=await Promise.all([chrome.storage.sync.get(["aiProvider","aiApiKey","aiModel","aiCustomUrl","aiKeys","groupPostAiProvider","groupPostAiKey","groupPostAiModel","groupPostAiUrl"]),chrome.storage.local.get("unifiedAiProfiles")]);
  const currentHasKey=!!(sync.aiKeys?.[sync.aiProvider]?.key||sync.aiApiKey),legacyHasKey=!!sync.groupPostAiKey;
  const provider=preferredProvider||(currentHasKey?sync.aiProvider:"")||(legacyHasKey?sync.groupPostAiProvider:"")||sync.aiProvider||sync.groupPostAiProvider||"gemini",profile=sync.aiKeys?.[provider]||local.unifiedAiProfiles?.[provider]||{};
  const isCurrent=provider===sync.aiProvider,isLegacy=provider===sync.groupPostAiProvider;
  return {provider,key:profile.key||(isCurrent?sync.aiApiKey:"")||(isLegacy?sync.groupPostAiKey:"")||"",model:profile.model||(isCurrent?sync.aiModel:"")||(isLegacy?sync.groupPostAiModel:"")||(provider==="gemini"?"gemini-3.5-flash-lite":""),url:profile.url||(isCurrent?sync.aiCustomUrl:"")||(isLegacy?sync.groupPostAiUrl:"")||""};
}
async function persistUnifiedAiConfig(config){
  const c={provider:config.provider||"gemini",key:String(config.key||"").trim(),model:String(config.model||"").trim(),url:String(config.url||"").trim()};
  const [sync,local]=await Promise.all([chrome.storage.sync.get("aiKeys"),chrome.storage.local.get("unifiedAiProfiles")]);
  const keys={...(sync.aiKeys||{}),[c.provider]:{key:c.key,model:c.model,url:c.url}},profiles={...(local.unifiedAiProfiles||{}),[c.provider]:{key:c.key,model:c.model,url:c.url}};
  await Promise.all([chrome.storage.sync.set({aiProvider:c.provider,aiApiKey:c.key,aiModel:c.model,aiCustomUrl:c.url,aiKeys:keys,groupPostAiProvider:c.provider,groupPostAiKey:c.key,groupPostAiModel:c.model,groupPostAiUrl:c.url}),chrome.storage.local.set({unifiedAiProfiles:profiles})]);
  return c;
}
getUnifiedAiConfig().then(c=>{if(c.key)persistUnifiedAiConfig(c);}).catch(()=>{});

// === Hồ sơ AI dùng chung (multi-profile, tab AI riêng) ===
// Một tính năng luôn chạy bằng đúng 1 profile: mapping ở aiProfileByFeature,
// thiếu mapping thì dùng default. getUnifiedAiConfig() giữ nguyên = default
// để mọi luồng cũ/background không đổi vẫn chạy.
const AI_FEATURES=[
  {key:"feedBantin",label:"Bản tin"},
  {key:"feedFriends",label:"Bảng feed — Bạn bè"},{key:"feedGroups",label:"Bảng feed — Nhóm"},
  {key:"feedPages",label:"Bảng feed — Page"},{key:"aiFeed",label:"Tương tác bản tin"},
  {key:"groupPost",label:"Đăng bài nhóm"},{key:"groupComment",label:"Comment AI trong nhóm"},
  {key:"groupInteract",label:"Tương tác nhóm (AI)"},{key:"keyword",label:"Tham gia nhóm từ khóa"},
  {key:"discover",label:"Tham gia nhóm khám phá"},{key:"share",label:"Share bài vào nhóm"},
  {key:"sales",label:"Đăng bài bán hàng"},{key:"newsWall",label:"Đăng tường tin tức"},{key:"fbStory",label:"Đăng Story Facebook"},{key:"fbReels",label:"Đăng Reels Facebook"},{key:"trendLearn",label:"Học bài theo Trend"},
  {key:"trendPost",label:"Đăng bài Trend"},{key:"pageGroupJoin",label:"Page tham gia nhóm"},
  {key:"pageGroupPost",label:"Page đăng bài nhóm"},{key:"pageSales",label:"Đăng bán bằng Page"},
  {key:"pageGroupComment",label:"Comment nhóm bằng Page"},{key:"pageComment",label:"Comment AI bằng Page"},
  {key:"friendReengage",label:"Lấy Lại Tương Tác"},{key:"friendWarm",label:"Làm ấm kết bạn (FoF)"},{key:"styleLearn",label:"Học văn phong"}
];
function aiProfileId(){return `aip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;}
function sanitizeAiProfile(raw={}){
  return {id:String(raw.id||aiProfileId()),name:String(raw.name||"").trim().slice(0,60)||"Hồ sơ AI",
    provider:String(raw.provider||"gemini").trim()||"gemini",key:String(raw.key||"").trim(),
    model:String(raw.model||"").trim(),url:String(raw.url||"").trim()};
}
async function getAiProfilesState(){
  const saved=await chrome.storage.sync.get(["aiProfiles","aiDefaultProfileId","aiProfileByFeature"]).catch(()=>({}));
  let profiles=Array.isArray(saved.aiProfiles)?saved.aiProfiles.map(sanitizeAiProfile).filter(p=>p.key||p.model||p.provider==="meta-free"):[];
  if(!profiles.length){
    // Migrate 1 lần từ cấu hình đơn cũ: default + mỗi provider đã lưu thành 1 hồ sơ.
    try{
      const current=await getUnifiedAiConfig();
      const syncExtra=await chrome.storage.sync.get(["aiKeys"]).catch(()=>({}));
      const seen=new Set();
      if(current.key||current.model){profiles.push(sanitizeAiProfile({name:"Mặc định",provider:current.provider,key:current.key,model:current.model,url:current.url}));seen.add(current.provider);}
      for(const [prov,prof] of Object.entries(syncExtra.aiKeys||{})){
        if(seen.has(prov)||(!prof?.key&&!prof?.model&&prov!=="meta-free"))continue;seen.add(prov);
        profiles.push(sanitizeAiProfile({name:String(prov[0].toUpperCase()+prov.slice(1)),provider:prov,key:prof.key||"",model:prof.model||"",url:prof.url||""}));
      }
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  if(!profiles.length)profiles=[sanitizeAiProfile({name:"Mặc định",provider:"gemini"})];
  // Khách mới chưa có hồ sơ Meta AI miễn phí thì tự thêm 1 hồ sơ để Đăng bán
  // (nick + Page) dùng được ngay không cần key. Chỉ thêm khi chưa có — hồ sơ
  // của user cũ không bị đụng. (Bắt từ bản khách 1.9.455: khách mới chỉ có
  // default gemini nên sales báo thiếu key, tưởng "không dùng được Meta AI".)
  if(!profiles.some(p=>p.provider==="meta-free")){
    profiles.push(sanitizeAiProfile({name:"Meta AI (miễn phí)",provider:"meta-free",model:"meta-ai"}));
  }
  let defaultId=saved.aiDefaultProfileId||"";
  if(!profiles.some(p=>p.id===defaultId))defaultId=profiles[0].id;
  const mapping=(saved.aiProfileByFeature&&typeof saved.aiProfileByFeature==="object")?saved.aiProfileByFeature:{};
  // Khách mới (hoặc máy chưa có key) chưa gán Đăng bán cho hồ sơ nào thì mặc
  // định dùng Meta miễn phí để chạy được ngay. Máy đã có key ở default thì
  // giữ nguyên hành vi cũ (không lật sales của người đang dùng key ổn định).
  const metaId=(profiles.find(p=>p.provider==="meta-free")||{}).id||"";
  const defProf=profiles.find(p=>p.id===defaultId);
  if(metaId&&!defProf?.key){
    if(!mapping.sales)mapping.sales=metaId;
    if(!mapping.pageSales)mapping.pageSales=metaId;
  }
  // Chốt vào storage khi chưa có gì được lưu: id hồ sơ auto-tạo là ngẫu nhiên,
  // không persist thì mỗi lần gọi sinh id mới — mapping trỏ vào id ma và
  // background resolveAiProfile cũng không thấy gì (bắt live profile trắng:
  // sales rớt về gemini dù mapping đã gán meta). Chỉ ghi khi kho còn trống,
  // không bao giờ đụng dữ liệu user đã lưu.
  if(!Array.isArray(saved.aiProfiles)){
    try{ await chrome.storage.sync.set({aiProfiles:profiles,aiDefaultProfileId:defaultId,aiProfileByFeature:mapping}); }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  return {profiles,defaultId,mapping};
}
async function saveAiProfilesState(patch){
  const cur=await getAiProfilesState();
  const next={profiles:Array.isArray(patch.profiles)?patch.profiles:cur.profiles,
    defaultId:patch.defaultId||cur.defaultId,mapping:patch.mapping||cur.mapping};
  if(!next.profiles.some(p=>p.id===next.defaultId))next.defaultId=next.profiles[0]?.id||"";
  await chrome.storage.sync.set({aiProfiles:next.profiles,aiDefaultProfileId:next.defaultId,aiProfileByFeature:next.mapping}).catch(()=>{});
  // Sync sang aiKeys để background.js getPageAiConfig vẫn tìm được key khi profileId không có (resume cũ).
  try{
    const keys={};
    for(const p of next.profiles){if(p.provider&&(p.key||p.provider==="meta-free"))keys[p.provider]={key:p.key||"",model:p.model||"",url:p.url||""};}
    const def=next.profiles.find(p=>p.id===next.defaultId)||next.profiles[0];
    const legacy={aiKeys:keys};
    if(def){legacy.aiProvider=def.provider;legacy.aiApiKey=def.key||"";legacy.aiModel=def.model||"";legacy.aiCustomUrl=def.url||"";}
    await chrome.storage.sync.set(legacy).catch(()=>{});
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  return next;
}
async function getAiProfileById(id){
  const {profiles,defaultId}=await getAiProfilesState();
  return profiles.find(p=>p.id===id)||profiles.find(p=>p.id===defaultId)||profiles[0]||sanitizeAiProfile({});
}
async function getAiDefaultProfile(){return getAiProfileById();}
// meta-free hỏi qua tab meta.ai đã login nên không cần key/model ở mọi chốt kiểm tra.
function aiKeyRequired(aiConfig){return aiConfig?.provider!=="meta-free";}
async function getAiProfileFor(feature){
  try{
    const {mapping,defaultId}=await getAiProfilesState();
    const id=mapping?.[feature]||defaultId;
    const p=await getAiProfileById(id);
    if(p?.key||p?.model||p?.provider==="meta-free")return {provider:p.provider,key:p.key||"",model:p.model||"",url:p.url||"",profileId:p.id,profileName:p.name};
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  const fallback=await getUnifiedAiConfig();
  return {...fallback,profileId:"",profileName:""};
}
function aiFeatureForSnapshot(feature,opts){
  if(feature==="feed"){
    const src=opts?.feedSource||feedScheduleSource?.value||"friends";
    return {bantin:"feedBantin",friends:"feedFriends",groups:"feedGroups",pages:"feedPages"}[src]||"feedFriends";
  }
  return feature;
}
async function aiProfileIdFor(feature,opts){
  // Gắn vào snapshot lịch/chuỗi để background resolve đúng hồ sơ lúc chạy.
  try{const p=await getAiProfileFor(aiFeatureForSnapshot(feature,opts));return p?.profileId||"";}catch(_){return "";}
}

// === Tab AI chung: render + CRUD hồ sơ + bảng gán tính năng ===
let aiProfileEditingId="";
function aiProfileEsc(s){return String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));}
function aiProfileMasked(key){
  const k=String(key||"");
  if(k.length<=8)return k?"••••":"—";
  return k.slice(0,4)+"••••"+k.slice(-3);
}
function aiProfileFillModels(provider,selected=""){
  const input=$("aiProfileModel"),dl=$("aiProfileModelList");
  if(!input)return;
  let models=[];
  try{models=modelsForProvider(provider);}catch(_){models=[];}
  const opts=[...new Set([...(models||[]),selected].filter(Boolean))].slice(0,500);
  if(dl)dl.innerHTML=opts.map(m=>`<option value="${aiProfileEsc(m)}">`).join("");
  // Không đè chữ user đang gõ — chỉ đặt khi có giá trị được chọn/gán rõ ràng.
  if(selected!==undefined&&selected!==""&&document.activeElement!==input)input.value=selected;
}
async function renderAiProfilesTab(){
  const listEl=$("aiProfileList"),mapEl=$("aiProfileMapList");
  if(!listEl||!mapEl)return;
  const {profiles,defaultId,mapping}=await getAiProfilesState();
  const byId=new Map(profiles.map(p=>[p.id,p]));
  listEl.innerHTML=profiles.length?profiles.map(p=>`
    <div class="schedule-item"><div><div class="schedule-item-title">${p.id===defaultId?"⭐ ":""}${aiProfileEsc(p.name)}</div>
    <div class="schedule-item-meta">${aiProfileEsc(p.provider)} · ${aiProfileEsc(p.model||"—")} · key ${aiProfileEsc(aiProfileMasked(p.key))}</div></div>
    <div class="schedule-item-actions">
      <button type="button" data-aip-edit="${aiProfileEsc(p.id)}">✏️</button>
      ${p.id===defaultId?"":`<button type="button" data-aip-default="${aiProfileEsc(p.id)}" title="${aiProfileEsc(t("aip.setDefault"))}">⭐</button>`}
      <button type="button" data-aip-del="${aiProfileEsc(p.id)}">🗑</button>
    </div></div>`).join(""):`<div class="hint">${aiProfileEsc(t("aip.noProfiles"))}</div>`;
  listEl.querySelectorAll("[data-aip-edit]").forEach(b=>b.onclick=()=>aiProfileStartEdit(b.getAttribute("data-aip-edit")));
  listEl.querySelectorAll("[data-aip-default]").forEach(b=>b.onclick=async()=>{await saveAiProfilesState({defaultId:b.getAttribute("data-aip-default")});renderAiProfilesTab();});
  listEl.querySelectorAll("[data-aip-del]").forEach(b=>b.onclick=async()=>{
    const id=b.getAttribute("data-aip-del");
    if(!confirm(t("aip.confirmDelete")))return;
    const cur=await getAiProfilesState();
    const rest=cur.profiles.filter(p=>p.id!==id);
    if(!rest.length){$("aiProfileStatus").textContent=t("aip.needOne");return;}
    const map2={...(cur.mapping||{})};
    for(const k of Object.keys(map2))if(map2[k]===id)delete map2[k];
    await saveAiProfilesState({profiles:rest,mapping:map2});
    if(aiProfileEditingId===id)aiProfileResetForm();
    $("aiProfileStatus").textContent=t("aip.deleted");
    renderAiProfilesTab();
    renderAiProfileRows().catch(()=>{});
  });
  mapEl.innerHTML=AI_FEATURES.map(f=>{
    const selId=`aip-map-${f.key}`;
    const cur=mapping?.[f.key]||"";
    const opts=[`<option value="">⭐ ${aiProfileEsc(t("aip.useDefault"))}</option>`,
      ...profiles.map(p=>`<option value="${aiProfileEsc(p.id)}" ${p.id===cur?"selected":""}>${aiProfileEsc(p.name)} (${aiProfileEsc(p.provider)})</option>`)].join("");
    return `<label style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:8px;align-items:center;margin:0;font-size:12px"><span>${aiProfileEsc(f.label)}</span><select id="${selId}" data-aip-map="${aiProfileEsc(f.key)}" style="margin:0">${opts}</select></label>`;
  }).join("");
  mapEl.querySelectorAll("[data-aip-map]").forEach(sel=>sel.onchange=async()=>{
    const cur=await getAiProfilesState();
    const map2={...(cur.mapping||{})};
    if(sel.value)map2[sel.getAttribute("data-aip-map")]=sel.value;
    else delete map2[sel.getAttribute("data-aip-map")];
    await saveAiProfilesState({mapping:map2});
  });
  if(!aiProfileEditingId)aiProfileResetForm(false);
}
function aiProfileResetForm(clearStatus=true){
  aiProfileEditingId="";
  const nameEl=$("aiProfileName"),provEl=$("aiProfileProvider"),keyEl=$("aiProfileKey"),urlEl=$("aiProfileUrl");
  if(nameEl)nameEl.value="";if(provEl)provEl.value="gemini";if(keyEl)keyEl.value="";if(urlEl)urlEl.value="";
  const modelEl=$("aiProfileModel");if(modelEl&&document.activeElement!==modelEl)modelEl.value="";
  aiProfileFillModels("gemini","");
  const saveBtn=$("aiProfileSaveBtn");
  if(saveBtn)saveBtn.textContent=t("aip.save");
  if(clearStatus&&$("aiProfileStatus"))$("aiProfileStatus").textContent=t("aip.ready");
}
async function aiProfileStartEdit(id){
  const p=await getAiProfileById(id);
  if(!p?.id)return;
  aiProfileEditingId=p.id;
  $("aiProfileName").value=p.name||"";
  $("aiProfileProvider").value=p.provider||"gemini";
  $("aiProfileKey").value=p.key||"";
  $("aiProfileUrl").value=p.url||"";
  aiProfileFillModels(p.provider||"gemini",p.model||"");
  $("aiProfileSaveBtn").textContent=t("aip.update");
  $("aiProfileStatus").textContent=t("aip.ready");
  showTab("ai");
}
// Dọn chat worker Meta AI (tab AI chung): toggle + N giữ lại + nút Dọn ngay.
// Chỉ xóa đúng chat do tool tạo (track theo uuid), không đụng chat của user.
function wireMetaFreeCleanOnce(){
  if(window.__metaFreeCleanWired)return;
  window.__metaFreeCleanWired=true;
  const box=$("metaFreeAutoClean"),num=$("metaFreeKeepN"),max=$("metaFreeMaxChats"),btn=$("metaFreeCleanNowBtn"),st=$("metaFreeCleanStatus"),mode=$("metaFreeChatMode");
  if(!box||!num||!btn)return;
  chrome.storage.sync.get(["metaFreeAutoClean","metaFreeKeepN","metaFreeMaxChats","metaFreeChatMode"]).then(cfg=>{
    box.checked=cfg.metaFreeAutoClean!==false;
    const n=parseInt(cfg.metaFreeKeepN,10);
    num.value=Number.isFinite(n)?Math.max(0,Math.min(10000,n)):20;
    const m=parseInt(cfg.metaFreeMaxChats,10);
    if(max)max.value=Number.isFinite(m)?Math.max(1,Math.min(20000,m)):200;
    if(mode)mode.value=cfg.metaFreeChatMode==="fresh"?"fresh":"session";
  }).catch(()=>{});
  box.addEventListener("change",()=>chrome.storage.sync.set({metaFreeAutoClean:box.checked}).catch(()=>{}));
  num.addEventListener("change",()=>{
    const n=Math.max(0,Math.min(10000,parseInt(num.value,10)||0));
    num.value=n;chrome.storage.sync.set({metaFreeKeepN:n}).catch(()=>{});
  });
  if(max)max.addEventListener("change",()=>{
    const m=Math.max(1,Math.min(20000,parseInt(max.value,10)||200));
    max.value=m;chrome.storage.sync.set({metaFreeMaxChats:m}).catch(()=>{});
  });
  if(mode)mode.addEventListener("change",()=>chrome.storage.sync.set({metaFreeChatMode:mode.value==="fresh"?"fresh":"session"}).catch(()=>{}));
  // Ngôn ngữ bài đăng theo profile (mỗi nick nhớ riêng): background thay biến
  // {language} trong prompt lúc chạy nên lịch/chat/preview ăn theo hết.
  const langSel=$("postLanguage");
  if(langSel){
    chrome.storage.sync.get(["postLanguage"]).then(cfg=>{
      const v=String(cfg.postLanguage||"").trim();
      if(v&&[...langSel.options].some(o=>o.value===v))langSel.value=v;
    }).catch(()=>{});
    langSel.addEventListener("change",()=>chrome.storage.sync.set({postLanguage:langSel.value}).catch(()=>{}));
  }
  // Migrate 1 lần: prompt đã lưu từ bản cũ chốt cứng "tiếng Việt/English" thì
  // đổi sang biến {language} để ăn theo ô chọn trên. Với mặc định "tiếng Việt",
  // output sau migrate giống hệt trước (không đổi hành vi nick Việt); nick
  // ngoại ngữ chỉ cần đổi ô chọn là chạy.
  (async()=>{
    try{
      const flag=await chrome.storage.sync.get(["postLangMigrated"]).catch(()=>({}));
      if(flag.postLangMigrated)return;
      const pairs=[
        ["bài thảo luận tiếng Việt","bài thảo luận bằng {language}"],
        ["Viết bài bằng tiếng Việt.","Viết bài bằng {language}."],
        ["viết một bài đăng bán hàng tự nhiên bằng tiếng Việt","viết một bài đăng bán hàng tự nhiên bằng {language}"],
        ["viết một lời dẫn ngắn bằng tiếng Việt","viết một lời dẫn ngắn bằng {language}"],
        ["write a discussion post in English","write a discussion post in {language}"],
        ["Write the post in Vietnamese.","Write the post in {language}."],
        ["natural Vietnamese sales post","natural sales post in {language}"],
        ["short English lead","short lead in {language}"]
      ];
      const keys=["groupPostPrompt","pageGroupPostPrompt","salesPrompt","groupSharePrompt","trendPrompt","trendGroupPrompt"];
      const saved=await chrome.storage.sync.get(keys).catch(()=>({}));
      const patch={};
      for(const k of keys){
        const v=String(saved[k]||"");
        if(!v||v.includes("{language}"))continue;
        let nv=v;
        for(const [a,b] of pairs)nv=nv.split(a).join(b);
        if(nv!==v)patch[k]=nv;
      }
      // Prompt Đăng bán của Page lưu riêng theo từng Page (local).
      try{
        const all=await chrome.storage.local.get(null).catch(()=>({}));
        for(const k of Object.keys(all||{})){
          if(!k.startsWith("pageSalesPrompt_")||typeof all[k]!=="string")continue;
          const v=all[k];
          if(!v||v.includes("{language}"))continue;
          let nv=v;
          for(const [a,b] of pairs)nv=nv.split(a).join(b);
          if(nv!==v)await chrome.storage.local.set({[k]:nv}).catch(()=>{});
        }
      }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
      if(Object.keys(patch).length)await chrome.storage.sync.set(patch).catch(()=>{});
      await chrome.storage.sync.set({postLangMigrated:true}).catch(()=>{});
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  })();
  btn.onclick=async()=>{
    btn.disabled=true;
    if(st)st.textContent=t("mf.cleaning");
    try{
      const res=await chrome.runtime.sendMessage({action:"metaFreeCleanNow"});
      const del=(res&&res.deleted||[]).length,fail=(res&&res.failed||[]).length;
      if(st)st.textContent=res&&res.ok?t("mf.cleaned",{n:del,left:res.remaining||0}):t("mf.cleanFail",{ok:del,fail:fail});
    }catch(e){if(st)st.textContent=t("mf.cleanFail",{ok:0,fail:"?"})+": "+String(e?.message||e).slice(0,120);}
    finally{btn.disabled=false;}
  };
}
// Dòng chọn hồ sơ gọn trong từng card tính năng (thay cụm nhập key cũ).
// Tự gắn trước mỗi ô tốc độ AI chưa có mount riêng; mount viết tay trong HTML
// được giữ nguyên. Một dòng có thể gán chung nhiều tính năng (VD: keyword+discover).
const AI_ROW_SLOT_FEATURES={pageGroupJoin:["pageGroupJoin"],pageGroupPost:["pageGroupPost"],pageNewsWall:["pageNewsWall"],pageSales:["pageSales"],pageGroupComment:["pageGroupComment"],pageComment:["pageComment"],share:["share"],sales:["sales"],trendPost:["trendPost"],groupPost:["groupPost"],groupComment:["groupComment"],groupJoin:["keyword","discover"],feedBantin:["feedBantin"],feedFriends:["feedFriends"],feedGroups:["feedGroups"],feedPages:["feedPages"],fbStory:["fbStory"],fbReels:["fbReels"]};
async function renderAiProfileRows(){
  const explicit=new Set([...document.querySelectorAll("[data-ai-profile-row]")].flatMap(m=>String(m.getAttribute("data-ai-profile-row")||"").split(",")));
  document.querySelectorAll("[data-ai-typing-slot],[data-ai-typing-control]").forEach(slot=>{
    const key=slot.getAttribute("data-ai-typing-slot")||slot.getAttribute("data-ai-typing-control")||"";
    const feats=(AI_ROW_SLOT_FEATURES[key]||[]).filter(k=>k&&!explicit.has(k));
    if(!feats.length||!slot.parentElement)return;
    if(slot.previousElementSibling&&slot.previousElementSibling.hasAttribute&&slot.previousElementSibling.hasAttribute("data-ai-profile-row"))return;
    const mount=document.createElement("div");
    mount.setAttribute("data-ai-profile-row",feats.join(","));
    slot.parentElement.insertBefore(mount,slot);
  });
  const mounts=[...document.querySelectorAll("[data-ai-profile-row]")];
  if(!mounts.length)return;
  const {profiles,defaultId,mapping}=await getAiProfilesState().catch(()=>({profiles:[],defaultId:"",mapping:{}}));
  for(const mount of mounts){
    const feats=String(mount.getAttribute("data-ai-profile-row")||"").split(",").map(s=>s.trim()).filter(Boolean);
    if(!feats.length)continue;
    const feat=feats[0];
    const cur=feats.map(k=>mapping?.[k]||"").find(Boolean)||"";
    const opts=[`<option value="">⭐ ${aiProfileEsc(t("aip.useDefault"))}</option>`,
      ...profiles.map(p=>`<option value="${aiProfileEsc(p.id)}" ${p.id===cur?"selected":""}>${aiProfileEsc(p.name)} (${aiProfileEsc(p.provider)}${p.id===defaultId?" ⭐":""})</option>`)].join("");
    mount.innerHTML=`
      <label>${aiProfileEsc(t("aip.rowLabel"))}</label>
      <div class="row" style="align-items:end">
        <div style="flex:1;min-width:0"><select data-aip-row-sel="${aiProfileEsc(feat)}" style="margin:0">${opts}</select></div>
        <div style="flex:none;display:flex;gap:6px">
          <button type="button" data-aip-row-test="${aiProfileEsc(feat)}" class="btn-purple" style="width:auto;padding:9px 10px" title="${aiProfileEsc(t("aip.test"))}">🧪</button>
          <button type="button" data-aip-row-open="${aiProfileEsc(feat)}" class="btn-load" style="width:auto;padding:9px 10px" title="${aiProfileEsc(t("aip.openTab"))}">⚙️</button>
        </div>
      </div>
      <div class="hint" data-aip-row-status="${aiProfileEsc(feat)}" style="min-height:0;margin-top:3px"></div>`;
  }
  mounts.forEach(mount=>{
    const feats=String(mount.getAttribute("data-ai-profile-row")||"").split(",").map(s=>s.trim()).filter(Boolean);
    if(!feats.length)return;
    const feat=feats[0];
    const sel=mount.querySelector("[data-aip-row-sel]"),status=mount.querySelector("[data-aip-row-status]");
    if(sel)sel.onchange=async()=>{
      const cur=await getAiProfilesState();
      const map2={...(cur.mapping||{})};
      for(const k of feats){if(sel.value)map2[k]=sel.value;else delete map2[k];}
      await saveAiProfilesState({mapping:map2});
      if(status){const p=await getAiProfileFor(feat);status.textContent=p?.profileName?`${p.provider} · ${p.model||"—"} · ${p.profileName}`:"";}
    };
    const testBtn=mount.querySelector("[data-aip-row-test]");
    if(testBtn)testBtn.onclick=async()=>{
      const p=await getAiProfileFor(feat);
      if(!p.key&&p.provider!=="meta-free"){if(status)status.textContent=t("aip.needKey");return;}
      await testAiConnection(p,status||$("aiProfileStatus"),testBtn);
    };
    const openBtn=mount.querySelector("[data-aip-row-open]");
    if(openBtn)openBtn.onclick=()=>showTab("ai");
  });
}
function wireAiProfilesTabOnce(){
  if(window.__aiProfilesWired)return;
  window.__aiProfilesWired=true;
  wireMetaFreeCleanOnce();
  $("aiProfileProvider").addEventListener("change",()=>{
    // meta-free không cần key: tự điền model mặc định để lưu được ngay.
    if($("aiProfileProvider").value==="meta-free"&&!$("aiProfileModel").value.trim())$("aiProfileModel").value="meta-ai";
    aiProfileFillModels($("aiProfileProvider").value,$("aiProfileModel").value);
  });
  $("aiProfileSaveBtn").onclick=async()=>{
    const provider=$("aiProfileProvider").value;
    const data=sanitizeAiProfile({id:aiProfileEditingId||undefined,name:$("aiProfileName").value||provider,provider,key:cleanPastedApiKey($("aiProfileKey").value),model:$("aiProfileModel").value.trim(),url:$("aiProfileUrl").value.trim()});
    // meta-free hỏi qua tab meta.ai đã login nên không cần key; tự điền model mặc định.
    if(data.provider==="meta-free"&&!data.model)data.model="meta-ai";
    if(!data.key&&data.provider!=="meta-free"){$("aiProfileStatus").textContent=t("aip.needKey");return;}
    const cur=await getAiProfilesState();
    const ix=cur.profiles.findIndex(p=>p.id===data.id);
    const profiles=[...cur.profiles];
    if(ix>=0)profiles[ix]=data;else profiles.push(data);
    await saveAiProfilesState({profiles});
    aiProfileResetForm(false);
    $("aiProfileStatus").textContent=t("aip.saved");
    renderAiProfilesTab();
    renderAiProfileRows().catch(()=>{});
  };
  $("aiProfileTestBtn").onclick=async()=>{
    const cfg={provider:$("aiProfileProvider").value,key:cleanPastedApiKey($("aiProfileKey").value),model:$("aiProfileModel").value.trim(),url:$("aiProfileUrl").value.trim()};
    await testAiConnection(cfg,$("aiProfileStatus"),$("aiProfileTestBtn"));
  };
  chrome.storage.onChanged.addListener((changes,area)=>{
    // store.js chuyển ghi sync→local nên nhận cả 2 area (máy cũ còn sót sync).
    if(area!=="sync"&&area!=="local")return;
    if(changes.aiProfiles||changes.aiDefaultProfileId||changes.aiProfileByFeature){
      if(panelAi&&!panelAi.classList.contains("hidden"))renderAiProfilesTab().catch(()=>{});
      renderAiProfileRows().catch(()=>{});
    }
  });
  renderAiProfileRows().catch(()=>{});
}
try{wireAiProfilesTabOnce();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }

// Tabs - moi tinh nang lon co panel va state rieng
const tabAdd = $("tabAdd");
const tabScrape = $("tabScrape");
const tabGroup = $("tabGroup");
const tabPage = $("tabPage");
const tabShare = $("tabShare");
const tabSales = $("tabSales");
const tabTrend = $("tabTrend");
const tabFeed = $("tabFeed");
const tabReengage = $("tabReengage");
const tabAi = $("tabAi");
const tabSchedule = $("tabSchedule");
const tabLog = $("tabLog");
const headerSchedule = $("headerSchedule");
const panelAdd = $("panelAdd");
const panelScrape = $("panelScrape");
const panelGroup = $("panelGroup");
const panelPage = $("panelPage");
const panelShare = $("panelShare");
const panelSales = $("panelSales");
const panelTrend = $("panelTrend");
const panelFeed = $("panelFeed");
const panelReengage = $("panelReengage");
const panelAi = $("panelAi");
const panelSchedule = $("panelSchedule");
const panelLog = $("panelLog");
// Feed: clear stale run/pending flags from older sessions so they cannot
// resume or block the Feed sources on popup open.
chrome.storage.local.set({isFeedInteracting:false}).catch(()=>{});
chrome.storage.local.remove(["pendingFeedInteract","pendingFeedConfig"]).catch(()=>{});
// Nuôi Page UI was temporarily hidden in v1.9.129 (not broken — just kept out
// of the tab bar while other work landed); its state machines and saved
// settings were never touched. Re-enabled so its 4 features can be scheduled
// and added to chains like every other feature.
const PAGE_UI_ENABLED=true;
function showTab(which){
  if(which==="page"&&!PAGE_UI_ENABLED)which="add";
  [tabAdd,tabScrape,tabGroup,tabPage,tabShare,tabSales,tabTrend,tabFeed,tabReengage,tabAi,tabSchedule,tabLog].forEach(t=>t&&t.classList.remove("active"));
  [panelAdd,panelScrape,panelGroup,panelPage,panelShare,panelSales,panelTrend,panelFeed,panelReengage,panelAi,panelSchedule,panelLog].forEach(p=>p&&p.classList.add("hidden"));
  if(which==="add"){ tabAdd.classList.add("active"); panelAdd.classList.remove("hidden"); }
  else if(which==="scrape"){ tabScrape.classList.add("active"); panelScrape.classList.remove("hidden"); }
  else if(which==="group"){ tabGroup.classList.add("active"); panelGroup.classList.remove("hidden"); }
  else if(which==="page"&&PAGE_UI_ENABLED){ tabPage?.classList.add("active"); panelPage?.classList.remove("hidden"); try{refreshPageAiSummary();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); } }
  else if(which==="share"){ tabShare.classList.add("active"); panelShare.classList.remove("hidden"); }
  else if(which==="sales"){ tabSales.classList.add("active"); panelSales.classList.remove("hidden"); try{refreshSalesAiSummary();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); } }
  else if(which==="reengage"){ tabReengage.classList.add("active"); panelReengage.classList.remove("hidden"); }
  else if(which==="trend"){ tabTrend.classList.add("active"); panelTrend.classList.remove("hidden"); try{refreshTrendAiSummary();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); } }
  else if(which==="ai"){ tabAi?.classList.add("active"); panelAi?.classList.remove("hidden"); try{renderAiProfilesTab();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); } }
  else if(which==="schedule"){ tabSchedule.classList.add("active"); panelSchedule.classList.remove("hidden"); try{refreshScheduleList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); } }
  else if(which==="log"){ tabLog.classList.add("active"); panelLog.classList.remove("hidden"); try{refreshActivityLog();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); } }
  else { tabFeed.classList.add("active"); panelFeed.classList.remove("hidden"); }
  try{chrome.storage.local.set({popupLastTab:which});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
tabAdd.onclick = () => showTab("add");
tabScrape.onclick = () => showTab("scrape");
tabGroup.onclick = () => {showTab("group");refreshUnifiedAiUi();};
if(PAGE_UI_ENABLED&&tabPage)tabPage.onclick = () => {showTab("page");refreshPageAiSummary();};
tabShare.onclick = () => {showTab("share");refreshShareAiSummary();};
tabSales.onclick = () => {showTab("sales");refreshSalesAiSummary();};
tabTrend.onclick = () => {showTab("trend");try{refreshTrendAiSummary();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }};
tabFeed.onclick = () => {showTab("feed");refreshUnifiedAiUi();};
if(tabReengage)tabReengage.onclick = () => showTab("reengage");
if(tabAi)tabAi.onclick = () => showTab("ai");
tabSchedule.onclick = () => showTab("schedule");
if(tabLog) tabLog.onclick = () => showTab("log");
if(headerSchedule) headerSchedule.onclick = () => showTab("schedule");

// Ngôn ngữ giao diện (popup + mọi content script dùng chung qua i18n.js).
// applyI18n chạy đồng bộ trước mọi lần đọc storage bất đồng bộ nên prompt
// mặc định theo đúng ngôn ngữ, cấu hình đã lưu của người dùng vẫn giữ nguyên.
(async()=>{
  await initI18n();
  applyI18n({initial:true});
  try{await initAiTypingSettings();}catch(_){renderAiTypingSettings();}
  const sel=$("uiLang");
  if(sel){
    sel.value=I18N_LANG;
    sel.addEventListener("change",async()=>{
      await setUILang(sel.value);
      applyI18n();
      try{renderAiTypingSettings();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
      try{await refreshShareAiSummary();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
      try{loadSalesProducts();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
      try{loadPageSalesProducts();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
      try{refreshRunCenter();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    });
  }
  // Mô tả provider và tóm tắt AI phụ thuộc ngôn ngữ — vẽ lại sau khi biết lang.
  try{await refreshShareAiSummary();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
})();

// ADD FRIEND
const startBtn = $("startBtn");
const scanBtn = $("scanBtn");
const minEl = $("minDelay");
const maxEl = $("maxDelay");
const maxReqEl = $("maxRequests");
const friendMinMutual=$("friendMinMutual");
const friendConfirmMinMutual=$("friendConfirmMinMutual");
const statusEl = $("status");
const countEl = $("count");
const friendSkippedEl=$("friendSkipped"),friendUncertainEl=$("friendUncertain");
const friendResetBtn=$("friendResetBtn"),friendClearHistoryBtn=$("friendClearHistoryBtn");
const friendSuggestionsPanel=$("friendSuggestionsPanel"),friendGroupPanel=$("friendGroupPanel"),friendConfirmPanel=$("friendConfirmPanel"),friendFoFPanel=$("friendFoFPanel"),friendConfirmFilters=$("friendConfirmFilters");
const friendOpenSuggestionsBtn=$("friendOpenSuggestionsBtn"),friendOpenConfirmBtn=$("friendOpenConfirmBtn"),loadFriendGroupsBtn=$("loadFriendGroupsBtn"),selectAllFriendGroupsBtn=$("selectAllFriendGroupsBtn");
const friendGroupKeyword=$("friendGroupKeyword"),friendGroupList=$("friendGroupList");
const friendConfirmResults=$("friendConfirmResults");
const friendOutgoingMutualWrap=$("friendOutgoingMutualWrap");
const friendModeButtons=[...document.querySelectorAll(".friend-mode-btn")];
const friendFoFLinkModeBtn=$("friendFoFLinkModeBtn"),friendFoFMyListModeBtn=$("friendFoFMyListModeBtn");
const friendFoFLinkPanel=$("friendFoFLinkPanel"),friendFoFMyListPanel=$("friendFoFMyListPanel");
const friendFoFSourceLink=$("friendFoFSourceLink"),friendFoFLoadMineBtn=$("friendFoFLoadMineBtn"),friendFoFSourceKeyword=$("friendFoFSourceKeyword");
const friendFoFSourceListEl=$("friendFoFSourceList"),friendFoFScanLinkBtn=$("friendFoFScanLinkBtn"),friendFoFScanSelectedBtn=$("friendFoFScanSelectedBtn");
const friendFoFMinMutual=$("friendFoFMinMutual");
const friendFoFStatus=$("friendFoFStatus"),friendFoFCandidateList=$("friendFoFCandidateList");
let isRunning = false;
let friendMode="suggestions";
let friendGroups=[];
let friendFoFKind="link";
let friendFoFSources=[];

const friendEsc=value=>String(value||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));

function renderFriendConfirmScan(candidates){
  if(!friendConfirmResults)return;
  if(!candidates.length){friendConfirmResults.innerHTML='<div class="hint" style="padding:6px">'+friendEsc(t("fr.confirmNoCandidates"))+'</div>';return;}
  friendConfirmResults.innerHTML=candidates.map(candidate=>{
    const state=candidate.decision||"unknown";
    const color=state==="pass"?"#0b7a35":state==="reject"?"#b42318":"#8a5a00";
    const reason=(candidate.reasonCodes||[]).map(code=>t(`fr.confirmReason_${code}`)||code).join(" · ");
    const mutual=candidate.mutualCount==null?"?":candidate.mutualCount;
    return `<div style="padding:6px;border-bottom:1px solid #eee;font-size:11px"><b>${friendEsc(candidate.name||candidate.key)}</b><span style="float:right;color:${color};font-weight:700">${friendEsc(t("fr.confirmDecision_"+state))}</span><div style="color:#65676b">${friendEsc(t("fr.confirmEvidence",{mutual}))}</div><div style="color:${color}">${friendEsc(reason||t("fr.confirmNoReason"))}</div></div>`;
  }).join("");
}

function setFriendFoFKind(kind){
  friendFoFKind=kind==="mine"?"mine":"link";
  friendFoFLinkModeBtn.classList.toggle("active",friendFoFKind==="link");
  friendFoFMyListModeBtn.classList.toggle("active",friendFoFKind==="mine");
  friendFoFLinkPanel.classList.toggle("hidden",friendFoFKind!=="link");
  friendFoFMyListPanel.classList.toggle("hidden",friendFoFKind!=="mine");
  chrome.storage.sync.set({friendFoFKind});
}

function selectedFriendFoFSource(){
  const key=friendFoFSourceListEl.querySelector(".friend-fof-source-radio:checked")?.value||"";
  return friendFoFSources.find(source=>String(source.key)===String(key))||null;
}

function renderFriendFoFSources(sources,selectedKey=""){
  friendFoFSources=Array.isArray(sources)?sources.filter(source=>source?.key&&source.url):[];
  const key=selectedKey||"";
  if(!friendFoFSources.length){friendFoFSourceListEl.innerHTML='<div class="hint" style="padding:6px">'+friendEsc(t("fr.fofNoSources"))+'</div>';return;}
  friendFoFSourceListEl.innerHTML=friendFoFSources.map((source,index)=>`<label data-name="${friendEsc(String(source.name||"").toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid #eee;cursor:pointer"><input class="friend-fof-source-radio" type="radio" name="friendFoFSource" value="${friendEsc(source.key)}" ${String(source.key)===String(key)?"checked":""} style="width:auto"><span style="display:flex;flex-direction:column;min-width:0"><b style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${friendEsc(source.name||t("fr.fofSourceFallback",{n:index+1}))}</b><small style="color:#65676b;overflow:hidden;text-overflow:ellipsis">${friendEsc(source.url)}</small></span></label>`).join("");
}

function renderFriendFoFCandidates(candidates){
  const rows=Array.isArray(candidates)?candidates:[];
  if(!rows.length){friendFoFCandidateList.innerHTML='<div class="hint" style="padding:6px">'+friendEsc(t("fr.fofNoCandidates"))+'</div>';return;}
  friendFoFCandidateList.innerHTML=rows.map(candidate=>{
    const sources=Array.isArray(candidate.sourceNames)&&candidate.sourceNames.length?candidate.sourceNames.join(", "):candidate.sourceName||t("fr.fofUnknownSource");
    const mutual=candidate.mutualCount==null?"":`<div style="color:#65676b">${friendEsc(t("fr.fofMutualCount",{n:candidate.mutualCount}))}</div>`;
    return `<div style="padding:6px;border-bottom:1px solid #eee;font-size:11px"><b>${friendEsc(candidate.name||candidate.key)}</b><div style="color:#65676b">${friendEsc(t("fr.fofFoundVia",{name:sources}))}</div>${mutual}</div>`;
  }).join("");
}

function setFriendMode(mode){
  if(isRunning&&mode!==friendMode){statusEl.textContent=t("p.frModeLocked");return;}
  friendMode=["suggestions","group-common","confirm","friend-of-friend"].includes(mode)?mode:"suggestions";
  friendModeButtons.forEach(button=>button.classList.toggle("active",button.dataset.friendMode===friendMode));
  friendSuggestionsPanel.classList.toggle("hidden",friendMode!=="suggestions");
  friendGroupPanel.classList.toggle("hidden",friendMode!=="group-common");
  friendConfirmPanel.classList.toggle("hidden",friendMode!=="confirm");
  friendFoFPanel.classList.toggle("hidden",friendMode!=="friend-of-friend");
  friendConfirmFilters.classList.toggle("hidden",friendMode!=="confirm");
  friendOutgoingMutualWrap.classList.toggle("hidden",friendMode==="confirm"||friendMode==="friend-of-friend");
  // The generic preview action is read-only for the other friend modes. The
  // FoF mode has direct-send buttons and must never route a preview click into
  // the real invitation state machine.
  scanBtn.classList.toggle("hidden",friendMode==="friend-of-friend");
  chrome.storage.sync.set({friendMode});
  updateCount();
}

friendModeButtons.forEach(button=>button.addEventListener("click",()=>setFriendMode(button.dataset.friendMode)));
friendFoFLinkModeBtn.onclick=()=>setFriendFoFKind("link");
friendFoFMyListModeBtn.onclick=()=>setFriendFoFKind("mine");

function selectedFriendGroups(){
  const ids=[...friendGroupList.querySelectorAll(".friend-group-check:checked")].map(box=>box.value);
  return friendGroups.filter(group=>ids.includes(String(group.id)));
}

function renderFriendGroups(groups,selectedIds=[]){
  friendGroups=Array.isArray(groups)?groups:[];
  const selected=new Set((selectedIds||[]).map(String));
  if(!friendGroups.length){friendGroupList.innerHTML='<div class="hint" style="padding:6px">'+t("p.frNoGroupsJoined")+'</div>';return;}
  friendGroupList.innerHTML=friendGroups.map(group=>`<label data-name="${friendEsc(group.name.toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee;min-width:0"><input class="friend-group-check" type="checkbox" value="${friendEsc(group.id)}" ${selected.has(String(group.id))?"checked":""} style="width:auto"><img src="${friendEsc(group.icon||"icon128.png")}" style="width:28px;height:28px;border-radius:50%;object-fit:cover"><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${friendEsc(group.name)}</span></label>`).join("");
}

function saveConfig() {
  const cfg = {
    minDelay: Math.max(1, parseInt(minEl.value) || 5) * 1000,
    maxDelay: Math.max(1, parseInt(maxEl.value) || 15) * 1000,
    maxRequests: Math.max(1, Math.min(100000, parseInt(maxReqEl.value) || 10)),
    minMutual:Math.max(0,parseInt(friendMinMutual.value)||0),
    mode:friendMode,
    groups:selectedFriendGroups(),
    confirmFilters:{
      minMutual:Math.max(0,parseInt(friendConfirmMinMutual.value)||0)
    }
  };
  chrome.storage.sync.set({
    minDelay:cfg.minDelay,maxDelay:cfg.maxDelay,maxRequests:cfg.maxRequests,
    friendMinMutual:cfg.minMutual,friendMode:cfg.mode,friendGroupIds:cfg.groups.map(g=>String(g.id)),friendFoFKind,friendFoFSourceLink:friendFoFSourceLink.value.trim(),friendFoFSourceKeyword:friendFoFSourceKeyword.value.trim(),
    friendConfirmMinMutual:cfg.confirmFilters.minMutual
  });
  chrome.storage.sync.remove(["friendConfirmMinGroups","friendConfirmHometown","friendConfirmSchool","friendConfirmRequirePhoto","friendConfirmSkipUnknown"]);
  return cfg;
}

async function loadConfig() {
  const [sync,local]=await Promise.all([
    chrome.storage.sync.get(["minDelay","maxDelay","maxRequests","friendMinMutual","friendMode","friendGroupIds","friendConfirmMinMutual","friendFoFKind","friendFoFSourceLink","friendFoFSourceKeyword","friendFoFMinMutual"]),
    chrome.storage.local.get(["joinedGroups","friendRunState","sentCount","isRunning","friendStatus","friendSkipped","friendUncertain","friendConfirmRunState","friendConfirmAccepted","friendConfirmActive","friendConfirmSkipped","friendConfirmUncertain","friendConfirmStatus","friendFoFScanState","friendFoFScanActive","friendFoFRunState","friendFoFActive","friendFoFSourceList","friendFoFSelectedSource","friendFoFCandidates","friendFoFStatus","friendFoFSourceScanned","friendFoFCandidateCount","friendFoFSent","friendFoFSkipped","friendFoFUncertain"])
  ]);
  if(sync.minDelay)minEl.value=Math.round(sync.minDelay/1000);
  if(sync.maxDelay)maxEl.value=Math.round(sync.maxDelay/1000);
  if(sync.maxRequests)maxReqEl.value=sync.maxRequests;
  if(sync.friendMinMutual!==undefined)friendMinMutual.value=sync.friendMinMutual;
  if(sync.friendConfirmMinMutual!==undefined)friendConfirmMinMutual.value=sync.friendConfirmMinMutual;
  if(sync.friendFoFSourceLink!==undefined)friendFoFSourceLink.value=sync.friendFoFSourceLink;
  if(sync.friendFoFMinMutual!==undefined&&friendFoFMinMutual)friendFoFMinMutual.value=sync.friendFoFMinMutual;
  if(sync.friendFoFSourceKeyword!==undefined)friendFoFSourceKeyword.value=sync.friendFoFSourceKeyword;
  setFriendFoFKind(sync.friendFoFKind||"link");
  renderFriendFoFSources(local.friendFoFSourceList||[],local.friendFoFSelectedSource?.key||"");
  friendFoFSourceKeyword.oninput();
  renderFriendFoFCandidates(local.friendFoFCandidates||[]);
  if(local.friendFoFStatus)friendFoFStatus.textContent=local.friendFoFStatus;
  const restoredMode=local.friendFoFActive||local.friendFoFScanActive||local.friendFoFRunState?.active||local.friendFoFScanState?.active?"friend-of-friend":(local.friendConfirmActive||local.friendConfirmRunState?.active?"confirm":(sync.friendMode||local.friendRunState?.mode||"suggestions"));
  setFriendMode(restoredMode);
  renderFriendGroups(local.joinedGroups||[],sync.friendGroupIds||[]);
  setRunning(restoredMode==="confirm"?!!local.friendConfirmActive:restoredMode==="friend-of-friend"?!!(local.friendFoFActive||local.friendFoFScanActive):!!local.isRunning);
  updateCount();
}

function updateCount() {
  chrome.storage.local.get(["sentCount","isRunning","friendStatus","lastMessage","friendSkipped","friendUncertain","friendConfirmAccepted","friendConfirmActive","friendConfirmStatus","friendConfirmSkipped","friendConfirmUncertain","friendFoFSent","friendFoFActive","friendFoFStatus","friendFoFSkipped","friendFoFUncertain","friendFoFCandidateCount"], res => {
    const confirming=friendMode==="confirm";
    const fof=friendMode==="friend-of-friend";
    const sent = confirming ? (res.friendConfirmAccepted||0) : fof ? (res.friendFoFSent||0) : (res.sentCount||0);
    const max = parseInt(maxReqEl.value) || 10;
    countEl.textContent = `${sent} / ${max}`;
    friendSkippedEl.textContent=confirming?(res.friendConfirmSkipped||0):fof?(res.friendFoFSkipped||0):(res.friendSkipped||0);
    friendUncertainEl.textContent=confirming?(res.friendConfirmUncertain||0):fof?(res.friendFoFUncertain||0):(res.friendUncertain||0);
    const status=confirming?(res.friendConfirmStatus||""):fof?(res.friendFoFStatus||""):(res.friendStatus||res.lastMessage||"");
    if(status)statusEl.textContent=status;
  });
}
function setRunning(running) {
  isRunning = running;
  startBtn.textContent = running ? t("c.stop") : t("fr.start");
  startBtn.classList.toggle("running", running);
  [friendFoFScanLinkBtn,friendFoFScanSelectedBtn,friendFoFLoadMineBtn].forEach(button=>button.disabled=!!running);
}
async function getActiveTab() {
  // The extension popup can be hosted in a separate Chrome popup window.
  // In that case `currentWindow: true` may resolve to the popup/internal
  // window instead of the user's active Facebook tab, so messages such as
  // trendDiagnose and scanJoinedGroups never reach the content script.
  // Prefer an active Facebook tab from any window, then fall back to the
  // current window, and finally to any open Facebook tab.
  const isFacebookTab=tab=>{
    try{
      const host=new URL(tab?.url||"").hostname.toLowerCase();
      return host==="facebook.com"||host.endsWith(".facebook.com");
    }catch{return false;}
  };
  const activeFacebook=await chrome.tabs.query({active:true,url:["*://facebook.com/*","*://*.facebook.com/*"]});
  if(activeFacebook[0])return activeFacebook[0];
  const [current]=await chrome.tabs.query({active:true,currentWindow:true});
  if(isFacebookTab(current))return current;
  const facebookTabs=await chrome.tabs.query({url:["*://facebook.com/*","*://*.facebook.com/*"]});
  // Ưu tiên www.facebook.com (host chính) trước các subdomain như business.facebook.com
  // để tránh lấy nhầm tab quản lý Page/Business không chạy được actor check.
  // Ưu tiên www.facebook.com trước các subdomain như business.facebook.com
  // vì business.facebook.com không có actor picker khi nick có managed Pages.
  const isMainFbHost=tab=>{try{const h=new URL(tab?.url||"").hostname.toLowerCase();return h==="www.facebook.com"||h==="facebook.com";}catch{return false;}};
  return facebookTabs.find(isMainFbHost)||facebookTabs.find(isFacebookTab)||null;
}
// Tải danh sách "Nhóm đã tham gia" dùng chung cho mọi tab (Nhóm, Đăng nhóm,
// Share bài, Đăng bán, Học nhóm). Việc điều hướng tab + chờ trang tải chạy
// hẳn trong background.js (xem runJoinedGroupsScan) thay vì ngay trong popup:
// điều hướng tab đang active có thể khiến popup mất focus và bị Chrome tự
// đóng trên một số bản build, làm chết luôn await đang chờ — đúng lý do
// trước đây phải bấm "Tải danh sách" hai lần mới ra kết quả. background.js
// không bị ảnh hưởng bởi việc popup đóng/mở nên luôn hoàn tất lượt quét.
async function requestJoinedGroupsScan(statusEl,loadingText,loadedText,pageActorUrl,pageKey,pageData){
  if(statusEl)statusEl.textContent=loadingText||t("p.giLoadGroups");
  const tab=await getActiveTab();
  if(!tab){
    const errMsg=t("p.giLoadGroupsNoTab");
    if(statusEl)statusEl.textContent=errMsg;
    chrome.runtime.sendMessage({action:"logActivityFromPopup",feature:"scanGroups",msg:`Tải danh sách nhóm thất bại: ${errMsg}`,level:"error"}).catch(()=>{});
    return {ok:false,groups:[]};
  }
  // Lắng nghe live counter từ content script trong khi scan đang chạy
  let liveWatcher=null;
  if(statusEl){
    liveWatcher=(changes,area)=>{
      if(area!=="local")return;
      const val=changes.joinedGroupsScanStatus?.newValue;
      if(val&&String(val).startsWith("⏳"))statusEl.textContent=val;
    };
    chrome.storage.onChanged.addListener(liveWatcher);
  }
  const msg={action:"scanJoinedGroupsStart",tabId:tab.id};
  if(pageActorUrl)msg.pageActorUrl=pageActorUrl;
  if(pageKey)msg.pageKey=pageKey;
  if(pageData)msg.pageData=pageData;
  const res=await chrome.runtime.sendMessage(msg).catch(error=>({ok:false,error:String(error?.message||error)}));
  if(liveWatcher)chrome.storage.onChanged.removeListener(liveWatcher);
  const groups=Array.isArray(res?.groups)?res.groups:[];
  const totalShown=Math.max(0,parseInt(res?.totalShown)||0);
  if(res?.ok){
    let label=loadedText?loadedText(groups.length):t("p.giLoadedGroups",{n:groups.length});
    if(totalShown>0&&totalShown>groups.length){
      label+=` (FB: ${totalShown}, thiếu ${totalShown-groups.length})`;
    }else if(totalShown>0){
      label+=` (FB: ${totalShown})`;
    }
    if(statusEl)statusEl.textContent=label;
  }else{
    if(statusEl)statusEl.textContent=res?.error||t("p.giLoadGroupsNoResponse");
  }
  return {ok:!!res?.ok,groups,totalShown};
}
async function autoReloadAndRetry(tabId, msg, statusEl){
  const sendOnce=()=>new Promise(resolve=>{
    chrome.tabs.sendMessage(tabId,msg,res=>{
      resolve(chrome.runtime.lastError?{ok:false}:{ok:true,res});
    });
  });
  // A healthy content script must receive the first message directly. Reloading
  // first closes the popup on some Chrome builds, so loaders never get the
  // response needed to save a newly scanned list.
  const first=await sendOnce();
  if(first.ok) return first;
  statusEl.textContent = t("p.autoReload");
  try{ await chrome.tabs.reload(tabId); }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  await new Promise(r=>setTimeout(r, 3500));
  const retry=await sendOnce();
  if(retry.ok) return retry;
  statusEl.textContent = t("p.reloading");
  await new Promise(r=>setTimeout(r,2000));
  const last=await sendOnce();
  if(!last.ok) statusEl.textContent=t("p.noConnRetry");
  return last;
}

function friendTargetUrl(cfg){
  if(cfg.mode==="suggestions")return "https://www.facebook.com/friends/suggestions";
  if(cfg.mode==="confirm")return "https://www.facebook.com/friends/requests";
  return cfg.groups[0]?`https://www.facebook.com/groups/${encodeURIComponent(cfg.groups[0].id)}/members/`:"https://www.facebook.com/friends/suggestions";
}

// Dù tab đang ở trang nào, mỗi nút Bắt đầu phải đưa về đúng route nhiệm vụ
// trước khi gửi lệnh cho content script.
function isPopupMainFeedUrl(url){
  try{
    const u=new URL(url);
    if(!(u.hostname==="facebook.com"||u.hostname.endsWith(".facebook.com")))return false;
    if(!(u.pathname==="/"||u.pathname==="/home.php"))return false;
    // Bắt live luồng AI: tab còn đứng ở ?filter=pages từ run trước vẫn qua
    // cửa này (pathname "/") nên run mới quét nhầm nguồn Page thay vì Bảng
    // tin. Bảng tin chính phải có filter=all (hoặc không có filter).
    return ((u.searchParams.get("filter")||"all").toLowerCase()==="all");
  }catch{return false;}
}
// Mọi tính năng NGOÀI tab Nuôi Page đều chạy bằng trang cá nhân. Đây là cửa ngõ
// chung của mọi lượt khởi chạy nên ép danh tính tại đây, thay vì rải vào từng
// content script. Các tính năng Nuôi Page truyền actor:"page" để được miễn trừ
// (chúng tự chuyển sang Page bằng logic riêng trong page.js).
async function ensurePersonalActorForTab(tabId,statusEl){
  try{
    const probe=()=>new Promise(resolve=>{
      chrome.tabs.sendMessage(tabId,{action:"ensurePersonalActor"},reply=>{
        void chrome.runtime.lastError;resolve(reply||null);
      });
    });
    const recoverActorBridge=async()=>{
      try{
        await chrome.scripting.executeScript({target:{tabId},files:["personalActor.js"]});
        return true;
      }catch(_){ return false; }
    };
    let res=null;
    // Facebook can have the tab visible while the isolated content script is
    // still attaching after SPA navigation. A single empty response used to
    // make Comment AI report a false "nick cá nhân" failure. Retry briefly;
    // do not reload or switch actor merely because the channel was late.
    for(let attempt=0;attempt<4;attempt++){
      res=await probe();
      if(res)break;
      let switching=false;
      try{
        const s=await chrome.storage.local.get("personalActorSwitching");
        const fl=s.personalActorSwitching;
        switching=!!(fl&&Date.now()-(fl.at||0)<45000);
      }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      if(switching&&attempt<3){await new Promise(r=>setTimeout(r,900));continue;}
      if(attempt<3)await new Promise(r=>setTimeout(r,500+attempt*300));
    }
    if(res&&res.ok===false){
      if(res.code==="ACTOR_PROBE_ERROR"){
        if(statusEl)statusEl.textContent="Không xác minh được nick cá nhân, chưa chạy tính năng";
        return res;
      }
      if(statusEl)statusEl.textContent=t("gj.actingAsPage",{name:res.page||"?"});
      return res;
    }
    if(!res){
      try{
        const s=await chrome.storage.local.get("personalActorSwitching");
        const fl=s.personalActorSwitching;
        if(fl&&Date.now()-(fl.at||0)<45000){
          if(statusEl)statusEl.textContent=t("gj.switchedToPersonal");
          return {ok:true,switched:true};
        }
      }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      // Extension reloads and Facebook SPA navigations can leave the already
      // loaded page without the actor listener. Recover only this small,
      // self-contained bridge in the existing tab, then probe again. This
      // avoids restarting the user's browser and remains fail-closed if the
      // injection is blocked.
      if(await recoverActorBridge()){
        await new Promise(r=>setTimeout(r,250));
        for(let attempt=0;attempt<3;attempt++){
          res=await probe();
          if(res)break;
          if(attempt<2)await new Promise(r=>setTimeout(r,450+attempt*350));
        }
      }
      if(!res){
        if(statusEl)statusEl.textContent="Không xác minh được nick cá nhân, chưa chạy tính năng";
        return {ok:false,code:"ACTOR_UNVERIFIED"};
      }
    }
    let switched=!!(res&&res.switched);
    if(!switched){
      // Facebook reload trang ngay khi đổi danh tính thật → kênh trả lời chết
      // cùng content script nên switched:true không bao giờ về tới đây.
      // Content script đã ghi cờ personalActorSwitching TRƯỚC khi bấm chuyển;
      // đọc cờ để vẫn đi đúng nhánh chờ ổn định, tránh thao tác trên trang
      // đang reload dở.
      try{
        const s=await chrome.storage.local.get("personalActorSwitching");
        const fl=s.personalActorSwitching;
        if(fl&&Date.now()-(fl.at||0)<45000)switched=true;
      }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    }
    if(switched){
      try{await chrome.storage.local.remove("personalActorSwitching");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      if(statusEl)statusEl.textContent=t("gj.switchedToPersonal");
      return {ok:true,switched:true};
    }
    if(res.verified===true)return {ok:true,verified:true};
    if(statusEl)statusEl.textContent="Không xác minh được nick cá nhân, chưa chạy tính năng";
    return {ok:false,code:"ACTOR_UNVERIFIED"};
  }catch{return {ok:false,code:"ACTOR_UNVERIFIED"};}
}
async function ensureTaskTab(targetUrl,statusEl,statusText,routeMatches,beforeNavigate,opts){
  let tab=await getActiveTab();
  // A run must be durable before a navigation starts.  Creating an inert tab
  // first also gives the persisted run a stable owner when there was no tab.
  if(!tab)tab=await chrome.tabs.create({url:"about:blank",active:true});
  const wantsPageActor=opts?.actor==="page";
  if(!wantsPageActor&&tab.url?.includes("facebook.com")){
    const actor=await ensurePersonalActorForTab(tab.id,statusEl);
    if(actor.ok===false)return null;
    // Vừa đổi danh tính: trang hiện tại vẫn render theo danh tính cũ nên phải
    // tải lại trước khi bất kỳ tính năng nào bấm vào đó.
    if(actor.switched){
      await chrome.tabs.update(tab.id,{url:targetUrl});
      await new Promise(r=>setTimeout(r,4500));
      if(typeof beforeNavigate==="function")await beforeNavigate(tab,true);
      try{return await chrome.tabs.get(tab.id);}catch{return null;}
    }
  }
  const needsNav=!tab.url?.includes("facebook.com")||(typeof routeMatches==="function"&&!routeMatches(tab.url||""));
  if(typeof beforeNavigate==="function")await beforeNavigate(tab,needsNav);
  if(!needsNav)return tab;
  if(statusEl&&statusText)statusEl.textContent=statusText;
  await chrome.tabs.update(tab.id,{url:targetUrl});
  await new Promise(r=>setTimeout(r,4500));
  // Do not accidentally hand a run to a different tab if the user changed
  // the active tab while the target route was loading.
  try{return await chrome.tabs.get(tab.id);}catch{return null;}
}
function isJoinedGroupHomeUrl(url){
  try{
    const u=new URL(url),parts=u.pathname.split("/").filter(Boolean);
    return (u.hostname==="facebook.com"||u.hostname.endsWith(".facebook.com"))&&parts.length===2&&parts[0].toLowerCase()==="groups"&&!new Set(["feed","joins","discover","create","notifications","your_groups"]).has(parts[1].toLowerCase());
  }catch{return false;}
}
// Quy tắc chung: persist phiên TRƯỚC khi chuyển trang/gửi lệnh để tab tự
// resume sau mọi điều hướng/reload/gửi hụt. Khi gửi thất bại, chỉ coi là lỗi
// nếu cờ chạy đã tắt (từ chối thật); cờ còn bật nghĩa là phiên đang tự chạy.
async function runStillActive(flag){
  try{const live=await chrome.storage.local.get(flag);return !!(live&&live[flag]);}catch{return false;}
}
// Quy tắc DỪNG BẰNG MỌI GIÁ: lệnh dừng gửi tới TẤT CẢ tab Facebook (phiên có
// thể đang chạy ở tab khác tab đang mở), đồng thời ghi cờ dừng trực tiếp để
// các điểm resume không hồi sinh phiên đã dừng.
async function broadcastToFacebookTabs(msg){
  try{
    const tabs=await chrome.tabs.query({url:"*://*.facebook.com/*"});
    await Promise.all((tabs||[]).map(t=>new Promise(resolve=>{try{chrome.tabs.sendMessage(t.id,msg,()=>resolve());}catch{resolve();}})));
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}

async function buildFriendConfig(){
  const cfg=saveConfig();
  const tab=await getActiveTab();
  return {cfg,tab};
}

async function sendFriendCommand(tab,msg){
  return new Promise(resolve=>chrome.tabs.sendMessage(tab.id,msg,async response=>{
    if(chrome.runtime.lastError){
      const retry=await autoReloadAndRetry(tab.id,msg,statusEl);
      resolve(retry.ok?(retry.res||{ok:true}):{ok:false,error:t("p.frNoConn")});
    }else resolve(response||{ok:false,error:t("p.frNoResp")});
  }));
}

function friendFoFConfig(){
  const minSeconds=Math.max(1,parseInt(minEl.value)||5);
  const maxSeconds=Math.max(1,parseInt(maxEl.value)||15);
  return {
    mode:"friend-of-friend",
    minDelay:minSeconds*1000,
    maxDelay:maxSeconds*1000,
    maxRequests:Math.max(1,Math.min(100000,parseInt(maxReqEl.value)||10)),
    minMutual:friendFoFMinMutual?Math.max(0,Math.min(100000,parseInt(friendFoFMinMutual.value)||0)):0
  };
}

async function sendFriendFoFAction(message){
  const tab=await getActiveTab();
  if(!tab?.url?.includes("facebook.com")){friendFoFStatus.textContent=t("p.frFoFNeedFb");return null;}
  const response=await sendFriendCommand(tab,message);
  if(!response?.ok)friendFoFStatus.textContent=response?.error||t("p.frFoFScanFail");
  return response;
}

async function scanFriendFoFOwnList(){
  friendFoFStatus.textContent=t("p.frFoFScanningOwn");
  const response=await sendFriendFoFAction({action:"friendFoFScanOwn"});
  if(response?.ok){setRunning(true);friendFoFStatus.textContent=t("p.frFoFScanningOwn");}
}

async function scanFriendFoFSource(){
  if(isRunning)return;
  const config=friendFoFConfig();
  if(config.minDelay>config.maxDelay){friendFoFStatus.textContent=t("p.gjBadDelay");return;}
  let source=null;
  if(friendFoFKind==="link"){
    const url=friendFoFSourceLink.value.trim();
    if(!url){friendFoFStatus.textContent=t("p.frFoFNeedLink");return;}
    try{
      const parsed=new URL(url);
      const host=String(parsed.hostname||"").toLowerCase().replace(/\.$/,"");
      if(!(host==="facebook.com"||host.endsWith(".facebook.com")))throw new Error("facebook");
    }catch{friendFoFStatus.textContent=t("p.frFoFBadLink");return;}
    source={url};
  }else{
    source=selectedFriendFoFSource();
    if(!source){friendFoFStatus.textContent=t("p.frFoFNeedSource");return;}
  }
  await chrome.storage.sync.set({friendFoFKind,friendFoFSourceLink:friendFoFSourceLink.value.trim(),friendFoFMinMutual:friendFoFMinMutual?friendFoFMinMutual.value:"0"});
  if(friendFoFKind==="mine")await chrome.storage.local.set({friendFoFSelectedSource:source});
  setRunning(true);
  try{
    const response=await sendFriendFoFAction({action:"friendFoFStart",config:{...config,source}});
    if(response?.ok){friendFoFStatus.textContent=t("p.frFoFSending");}
    else setRunning(false);
  }catch(error){setRunning(false);friendFoFStatus.textContent=error.message;}
}

async function startFriendFoFSend(){
  await scanFriendFoFSource();
}

startBtn.addEventListener("click", async () => {
  if(friendMode==="friend-of-friend"){
    if(isRunning){
      await chrome.storage.local.set({friendFoFActive:false,friendFoFScanActive:false,friendFoFStatus:t("p.frStoppedByUser")});
      broadcastToFacebookTabs({action:"friendFoFStop"});
      setRunning(false);updateCount();return;
    }
    await startFriendFoFSend();
    return;
  }
  if(isRunning){
    if(friendMode==="confirm"){
      const stored=await chrome.storage.local.get("friendConfirmRunState"),state=stored.friendConfirmRunState||{};
      state.active=false;state.nextAllowedAt=0;
      await chrome.storage.local.set({friendConfirmRunState:state,friendConfirmActive:false,friendConfirmStatus:t("p.frStoppedByUser")});
      broadcastToFacebookTabs({action:"friendConfirmStop"});
    }else{
      const stored=await chrome.storage.local.get("friendRunState"),state=stored.friendRunState||{};
      state.active=false;state.nextAllowedAt=0;
      await chrome.storage.local.set({friendRunState:state,isRunning:false,friendStatus:t("p.frStoppedByUser"),lastMessage:t("p.frStoppedByUser")});
      broadcastToFacebookTabs({action:"friendStop"});
    }
    const tab=await getActiveTab();
    if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:friendMode==="confirm"?"friendConfirmStop":"friendStop"});
    setRunning(false);updateCount();return;
  }
  const {cfg,tab:initialTab}=await buildFriendConfig();
  if(cfg.minDelay>cfg.maxDelay){statusEl.textContent=t("p.gjBadDelay");return;}
  if(cfg.mode==="group-common"&&!cfg.groups.length){statusEl.textContent=t("p.frNeedGroups");return;}
  const busyOther=await chrome.storage.local.get(["isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","friendWarmActive","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isAICommenting","isGroupJoining","isDiscoverJoining","pageGroupJoinActive","pageGroupPostActive","pageNewsWallActive","pageCommentActive","pageSalesPostActive","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive"]);
  if(Object.values(busyOther).some(Boolean)){statusEl.textContent=t("c.frBusyOther");return;}
  const targetUrl=friendTargetUrl(cfg);
  const friendRunId=`friend-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const friendDelayMs=cfg.minDelay+Math.random()*Math.max(0,cfg.maxDelay-cfg.minDelay);
  const confirming=cfg.mode==="confirm";
  let tab=await ensureTaskTab(
    targetUrl,
    statusEl,
    t("p.frOpenSource"),
    url=>{try{return new URL(url).pathname.replace(/\/$/,"")===new URL(targetUrl).pathname.replace(/\/$/,"");}catch{return false;}},
    async owner=>{
      if(confirming){
        await chrome.storage.local.set({friendConfirmActive:true,friendConfirmAccepted:0,friendConfirmSkipped:0,friendConfirmUncertain:0,friendConfirmRunState:{active:true,runId:friendRunId,ownerTabId:owner.id,mode:cfg.mode,config:cfg,acceptedCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],emptyRounds:0,sourceReloads:0,nextAllowedAt:Date.now()+friendDelayMs,status:t("c.frConfirmPreparing"),startedAt:Date.now()},friendConfirmStatus:t("c.frConfirmPreparing")});
      }else{
        await chrome.storage.local.set({isRunning:true,sentCount:0,friendSkipped:0,friendUncertain:0,friendRunState:{active:true,runId:friendRunId,ownerTabId:owner.id,mode:cfg.mode,config:cfg,sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],groupIndex:0,emptyRounds:0,sourceReloads:0,nextAllowedAt:Date.now()+friendDelayMs,groupWaitKey:"",groupWaitStartedAt:0,status:t("c.frPreparing"),startedAt:Date.now()},friendStatus:t("c.frPreparing")});
      }
    }
  );
  if(!tab){setRunning(false);await chrome.storage.local.set({isRunning:false});statusEl.textContent=t("p.frStartFail");return;}
  statusEl.textContent=t("p.frStarting");
  setRunning(true);
  const response=await sendFriendCommand(tab,{action:confirming?"friendConfirmStart":"friendStart",config:cfg});
  if(response?.ok){setRunning(true);updateCount();}
  else if(response?.error&&response.error===t("c.frBusyOther")){
    setRunning(false);
    if(confirming){const st=await chrome.storage.local.get("friendConfirmRunState"),fs=st.friendConfirmRunState||{};fs.active=false;await chrome.storage.local.set({friendConfirmRunState:fs,friendConfirmActive:false});}
    else{const st=await chrome.storage.local.get("friendRunState"),fs=st.friendRunState||{};fs.active=false;await chrome.storage.local.set({friendRunState:fs,isRunning:false});}
    statusEl.textContent=response.error;
  }
  else if(await runStillActive(confirming?"friendConfirmActive":"isRunning")){setRunning(true);updateCount();}
  else if(confirming){setRunning(false);const st2=await chrome.storage.local.get("friendConfirmRunState"),fs2=st2.friendConfirmRunState||{};fs2.active=false;await chrome.storage.local.set({friendConfirmRunState:fs2,friendConfirmActive:false});statusEl.textContent=response?.error||t("p.frStartFail");}
  else{setRunning(false);const st2=await chrome.storage.local.get("friendRunState"),fs2=st2.friendRunState||{};fs2.active=false;await chrome.storage.local.set({friendRunState:fs2,isRunning:false});statusEl.textContent=response?.error||t("p.frStartFail");}
});

scanBtn.addEventListener("click", async () => {
  if(friendMode==="friend-of-friend"){
    return;
  }
  const {cfg,tab}=await buildFriendConfig();
  if(cfg.mode==="group-common"&&!cfg.groups.length){statusEl.textContent=t("p.frNeedScanGroups");return;}
  if(!tab?.url?.includes("facebook.com")){statusEl.textContent=t("p.frNeedFb");return;}
  statusEl.textContent=t("p.frScanning");
  const response=await sendFriendCommand(tab,{action:cfg.mode==="confirm"?"friendConfirmScan":"friendScan",config:cfg});
  if(response?.needsNavigation&&response.targetUrl){
    await chrome.tabs.update(tab.id,{url:response.targetUrl});
    await chrome.storage.local.set({[cfg.mode==="confirm"?"friendConfirmStatus":"friendStatus"]:t("p.frReopened")});
    return;
  }
  if(response?.ok){
    if(cfg.mode==="confirm"){
      const candidates=response.candidates||[];
      const totals=candidates.reduce((sum,candidate)=>{
        const decision=["pass","reject","unknown"].includes(candidate.decision)?candidate.decision:"unknown";
        sum[decision]+=1;
        return sum;
      },{pass:0,reject:0,unknown:0});
      statusEl.textContent=t("p.frConfirmFound",{total:candidates.length,pass:totals.pass,unknown:totals.unknown,reject:totals.reject});
      countEl.textContent=t("p.frConfirmFoundCount",{pass:totals.pass,total:candidates.length});
      renderFriendConfirmScan(candidates);
    }else{
      statusEl.textContent=response.sourceReady===false?t("p.frNoSection"):t("p.frFound",{n:response.count||0});
      countEl.textContent=t("p.frFoundCount",{n:response.count||0});
    }
  }
  else statusEl.textContent=response?.error||t("p.frScanFail");
});

friendOpenSuggestionsBtn.onclick=async()=>{const tab=await getActiveTab();if(tab)await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/friends/suggestions"});};
friendOpenConfirmBtn.onclick=async()=>{const tab=await getActiveTab();if(tab)await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/friends/requests"});};
friendFoFLoadMineBtn.onclick=scanFriendFoFOwnList;
friendFoFScanLinkBtn.onclick=async()=>{setFriendFoFKind("link");await scanFriendFoFSource();};
friendFoFScanSelectedBtn.onclick=async()=>{setFriendFoFKind("mine");await scanFriendFoFSource();};
friendFoFSourceKeyword.oninput=()=>{
  const key=friendFoFSourceKeyword.value.trim().toLocaleLowerCase("vi");
  friendFoFSourceListEl.querySelectorAll("label[data-name]").forEach(row=>{row.style.display=!key||row.dataset.name.includes(key)?"flex":"none";});
};
friendFoFSourceListEl.addEventListener("change",event=>{
  if(!event.target.classList.contains("friend-fof-source-radio"))return;
  const source=selectedFriendFoFSource();
  if(source)chrome.storage.local.set({friendFoFSelectedSource:source});
});

loadFriendGroupsBtn.onclick=async()=>{
  let tab=await getActiveTab();if(!tab)return;
  statusEl.textContent=t("p.loadAllGroups");
  if(!/facebook\.com\/groups\/joins/.test(tab.url||"")){
    await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/groups/joins/?nav_source=tab"});
    await new Promise(resolve=>setTimeout(resolve,5000));
    tab=await getActiveTab();
  }
  const response=await sendFriendCommand(tab,{action:"scanJoinedGroups"});
  if(!response?.ok){statusEl.textContent=response?.error||t("p.loadGroupsFail");return;}
  const groups=response.groups||[];
  renderFriendGroups(groups,groups.map(g=>String(g.id)));
  await chrome.storage.local.set({joinedGroups:groups});
  await chrome.storage.sync.set({friendGroupIds:groups.map(g=>String(g.id))});
  statusEl.textContent=t("p.frLoadedGroups",{n:groups.length});
};

selectAllFriendGroupsBtn.onclick=()=>{
  const visible=[...friendGroupList.querySelectorAll('label[data-name]')].filter(row=>row.style.display!=="none");
  const boxes=visible.map(row=>row.querySelector(".friend-group-check")).filter(Boolean);
  const turnOn=boxes.some(box=>!box.checked);boxes.forEach(box=>box.checked=turnOn);saveConfig();
};
friendGroupKeyword.oninput=()=>{const key=friendGroupKeyword.value.trim().toLocaleLowerCase("vi");friendGroupList.querySelectorAll('label[data-name]').forEach(row=>row.style.display=!key||row.dataset.name.includes(key)?"flex":"none");};
friendGroupList.addEventListener("change",event=>{if(event.target.classList.contains("friend-group-check"))saveConfig();});

friendResetBtn.onclick=async()=>{
  if(friendMode==="friend-of-friend"){
    const saved=await chrome.storage.local.get(["friendFoFRunState","friendFoFScanState"]);
    const run=saved.friendFoFRunState&&typeof saved.friendFoFRunState==="object"?{...saved.friendFoFRunState,active:false,nextAllowedAt:0,candidateIndex:0,sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],currentCandidateKey:"",currentStage:""}:{active:false,candidateIndex:0,sentCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],currentCandidateKey:"",currentStage:""};
    const scan=saved.friendFoFScanState&&typeof saved.friendFoFScanState==="object"?{...saved.friendFoFScanState,active:false}:{active:false};
    await chrome.storage.local.set({friendFoFActive:false,friendFoFScanActive:false,friendFoFSent:0,friendFoFSkipped:0,friendFoFUncertain:0,friendFoFStatus:t("p.frResetDone"),friendFoFRunState:run,friendFoFScanState:scan});
    const tab=await getActiveTab();
    if(tab?.url?.includes("facebook.com"))await sendFriendCommand(tab,{action:"friendFoFReset"});
    broadcastToFacebookTabs({action:"friendFoFReset"});
    setRunning(false);updateCount();return;
  }
  if(friendMode==="confirm"){
    const saved=await chrome.storage.local.get("friendConfirmRunState");
    const state=saved.friendConfirmRunState&&typeof saved.friendConfirmRunState==="object"?{...saved.friendConfirmRunState,active:false,nextAllowedAt:0,acceptedCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[],emptyRounds:0,sourceReloads:0}:{active:false,nextAllowedAt:0,acceptedCount:0,skippedCount:0,uncertainCount:0,attemptedKeys:[]};
    await chrome.storage.local.set({friendConfirmActive:false,friendConfirmAccepted:0,friendConfirmSkipped:0,friendConfirmUncertain:0,friendConfirmStatus:t("p.frResetDone"),friendConfirmRunState:state});
  }else{
    const saved=await chrome.storage.local.get("friendRunState");
    const friendRunState=saved.friendRunState&&typeof saved.friendRunState==="object"?{...saved.friendRunState,active:false,nextAllowedAt:0}:{active:false,nextAllowedAt:0};
    // Persist the stop first; the owner tab may have navigated or its message
    // port may already be gone.
    await chrome.storage.local.set({isRunning:false,sentCount:0,friendSkipped:0,friendUncertain:0,friendStatus:t("p.frResetDone"),friendRunState});
  }
  const tab=await getActiveTab();
  const resetAction=friendMode==="confirm"?"friendConfirmReset":"friendReset";
  if(tab?.url?.includes("facebook.com"))await sendFriendCommand(tab,{action:resetAction});
  broadcastToFacebookTabs({action:resetAction});
  setRunning(false);updateCount();
};
friendClearHistoryBtn.onclick=async()=>{
  if(!confirm(t("p.frClearConfirm")))return;
  await chrome.storage.local.remove(friendMode==="confirm"?"friendConfirmHistory":friendMode==="friend-of-friend"?"friendFoFHistory":"friendProfileHistory");
  statusEl.textContent=t("p.frClearDone");
};

chrome.storage.onChanged.addListener(changes => {
  if (changes.sentCount||changes.friendConfirmAccepted||changes.friendConfirmActive||changes.friendStatus||changes.friendConfirmStatus||changes.friendFoFSent||changes.friendFoFActive||changes.friendFoFStatus||changes.friendFoFCandidateCount||changes.friendFoFSkipped||changes.friendFoFUncertain) updateCount();
  if(changes.friendFoFCandidates)renderFriendFoFCandidates(changes.friendFoFCandidates.newValue||[]);
  if(changes.friendFoFSourceList){
    chrome.storage.local.get("friendFoFSelectedSource",saved=>{
      const selectedKey=saved.friendFoFSelectedSource?.key||selectedFriendFoFSource()?.key||"";
      renderFriendFoFSources(changes.friendFoFSourceList.newValue||[],selectedKey);
      friendFoFSourceKeyword.oninput();
    });
  }
  if(changes.friendFoFStatus&&friendMode==="friend-of-friend")friendFoFStatus.textContent=changes.friendFoFStatus.newValue||"";
  if(changes.friendFoFActive&&friendMode==="friend-of-friend")setRunning(changes.friendFoFActive.newValue);
  if(changes.friendFoFScanActive&&friendMode==="friend-of-friend")setRunning(changes.friendFoFScanActive.newValue||!!changes.friendFoFActive?.newValue);
  if (changes.isRunning&&friendMode!=="confirm"&&friendMode!=="friend-of-friend") setRunning(changes.isRunning.newValue);
  if (changes.friendConfirmActive&&friendMode==="confirm") setRunning(changes.friendConfirmActive.newValue);
  if (changes.friendStatus&&friendMode!=="confirm"&&friendMode!=="friend-of-friend") statusEl.textContent = changes.friendStatus.newValue;
  else if (changes.friendConfirmStatus&&friendMode==="confirm") statusEl.textContent = changes.friendConfirmStatus.newValue;
  else if (changes.lastMessage&&friendMode!=="confirm"&&friendMode!=="friend-of-friend") statusEl.textContent = changes.lastMessage.newValue;
  if(changes.friendSkipped&&friendMode!=="confirm"&&friendMode!=="friend-of-friend")friendSkippedEl.textContent=changes.friendSkipped.newValue||0;
  if(changes.friendUncertain&&friendMode!=="confirm"&&friendMode!=="friend-of-friend")friendUncertainEl.textContent=changes.friendUncertain.newValue||0;
  if(changes.friendConfirmSkipped&&friendMode==="confirm")friendSkippedEl.textContent=changes.friendConfirmSkipped.newValue||0;
  if(changes.friendConfirmUncertain&&friendMode==="confirm")friendUncertainEl.textContent=changes.friendConfirmUncertain.newValue||0;
  if (changes.scrapeCount) { $("scrapeCount").textContent = t("sc.countPosts",{n:changes.scrapeCount.newValue}); }
  if (changes.scrapeStatus) { $("scrapeStatus").textContent = changes.scrapeStatus.newValue; }
  if (changes.groupStatus) { $("groupStatus").textContent = changes.groupStatus.newValue; }
  if (changes.groupAiUsage) { $("groupAiUsage").textContent = changes.groupAiUsage.newValue; }
  if (changes.groupJoined !== undefined) { const t=parseInt($("groupTarget").value)||10; $("groupCount").textContent = `${changes.groupJoined.newValue} / ${t}`; }
  if (changes.groupFound !== undefined) { /* optional */ }
  if (changes.isGroupJoining !== undefined) setGroupRunning(changes.isGroupJoining.newValue);
});
loadConfig();
[minEl,maxEl,maxReqEl,friendMinMutual,friendConfirmMinMutual].forEach(el=>el.addEventListener("change",saveConfig));

// SCRAPE - khong tu tai, chon format moi tai
const scrapeBtn = $("scrapeBtn");
const stopScrapeBtn = $("stopScrapeBtn");
const scrapeNum = $("scrapeNum");
const scrapeStatus = $("scrapeStatus");
const scrapeCountEl = $("scrapeCount");
const scrapeSourceUrl = $("scrapeSourceUrl");
const scrapeSkipAds = $("scrapeSkipAds");
const scrapeSaveMedia = $("scrapeSaveMedia");
const scrapeCommentsEnabled = $("scrapeCommentsEnabled"), scrapeMaxComments = $("scrapeMaxComments");
const scrapeMediaStatusEl = $("scrapeMediaStatus");
const openScrapeLibraryBtn = $("openScrapeLibraryBtn");
const downloadGroup = $("downloadGroup");
const dlFormat = $("dlFormat"), dlScope = $("dlScope");
const dlBtn = $("dlBtn");
let isScraping = false;

function scrapeSourceKey(url=""){
  try{
    const u=new URL(url,location.href);
    const host=String(u.hostname||"").toLowerCase().replace(/\.$/,"");
    const origin=host==="facebook.com"||host.endsWith(".facebook.com")?"https://facebook.com":u.origin.toLowerCase();
    return `${origin}${u.pathname}`.replace(/\/$/,"").toLowerCase();
  }catch{return String(url||"").split(/[?#]/)[0].replace(/\/$/,"").toLowerCase();}
}

function setScraping(v) {
  isScraping = v;
  scrapeBtn.textContent = v ? t("p.scraping") : t("sc.start");
  scrapeBtn.classList.toggle("running", v);
  if (v) downloadGroup.classList.add("hidden");
}

function updateDownloadVisibility(ready) {
  if (ready) downloadGroup.classList.remove("hidden");
}

async function requestDownload(format) {
  const scope = (dlScope && dlScope.value) || "all";
  let tab = await getActiveTab();
  if (!tab || !tab.url.includes("facebook.com")) {
    scrapeStatus.textContent = t("p.scAutoDl");
    if(tab) await chrome.tabs.update(tab.id, { url: "https://www.facebook.com/" });
    else tab = await chrome.tabs.create({ url: "https://www.facebook.com/" });
    await new Promise(r=>setTimeout(r,3000));
    tab = await getActiveTab();
  }
  chrome.tabs.sendMessage(tab.id, { action: "downloadScrape", format, scope }, async res => {
    if (chrome.runtime.lastError) {
      const retry = await autoReloadAndRetry(tab.id, { action: "downloadScrape", format, scope }, scrapeStatus);
      if(retry.ok && retry.res?.ok) scrapeStatus.textContent = t("p.scDlDone",{n:retry.res.count,fmt:format.toUpperCase()});
      else if(retry.res?.reason === "source-mismatch") scrapeStatus.textContent = t("p.scWrongSource");
      else scrapeStatus.textContent = t("p.scNoData");
      return;
    }
    if (res && res.ok) scrapeStatus.textContent = t("p.scDlDone",{n:res.count,fmt:format.toUpperCase()});
    else scrapeStatus.textContent = res?.reason === "source-mismatch" ? t("p.scWrongSource") : t("p.scNoData");
  });
}

scrapeBtn.addEventListener("click", async () => {
  const shareRun=await chrome.storage.local.get(["groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive",...FEED_SCOPED_ACTIVE_KEYS]);if(Object.values(shareRun).some(Boolean)){scrapeStatus.textContent=(shareRun.pageGroupJoinActive||shareRun.pageGroupPostActive||shareRun.pageCommentActive||shareRun.pageSalesPostActive||FEED_SCOPED_ACTIVE_KEYS.some(key=>shareRun[key]))?t("pg.busyOther"):t("p.shBusyScrape");return;}
  if(isScraping)return;
  const sourceUrl = scrapeSourceUrl.value.trim();
  if(sourceUrl){
    let parsed;
    try{ parsed=new URL(sourceUrl); }catch{ scrapeStatus.textContent=t("p.scBadUrl"); return; }
    const hostname=String(parsed.hostname||"").toLowerCase().replace(/\.$/,"");
    const isFacebookHost=hostname==="facebook.com"||hostname.endsWith(".facebook.com");
    if(!isFacebookHost){ scrapeStatus.textContent=t("p.scNeedFbUrl"); return; }
  }
  const count = parseInt(scrapeNum.value) || 20;
  const skipAds = scrapeSkipAds.checked;
  const saveMedia = scrapeSaveMedia.checked;
  const withComments = scrapeCommentsEnabled ? scrapeCommentsEnabled.checked : true;
  const maxComments = Math.max(1, Math.min(100000, parseInt(scrapeMaxComments && scrapeMaxComments.value) || 20));
  if (scrapeMaxComments) scrapeMaxComments.value = maxComments;
  chrome.storage.sync.set({ scrapeNum: count, scrapeSourceUrl: sourceUrl, scrapeSkipAds: skipAds, scrapeSaveMedia: saveMedia, scrapeCommentsEnabled: withComments, scrapeMaxComments: maxComments });
  setScraping(true);
  const activeTab=await getActiveTab();
  const targetUrl=sourceUrl||(activeTab?.url?.includes("facebook.com")?activeTab.url:"https://www.facebook.com/");
  const wantedSource=scrapeSourceKey(sourceUrl||targetUrl);
  // Store the exact source and option before the tab navigates.  The content
  // script will only resume after it sees this same path, so an old route
  // cannot scrape during the redirect.
  let tab=await ensureTaskTab(
    targetUrl,
    scrapeStatus,
    sourceUrl?t("p.scOpeningSource"):t("p.scAutoOpen"),
    url=>sourceUrl?scrapeSourceKey(url)===wantedSource:!!String(url||"").includes("facebook.com"),
    async owner=>{
      await chrome.storage.local.set({isScraping:true,scrapeTarget:count,scrapeOwnerTabId:owner.id,scrapeRunSourceUrl:wantedSource,scrapeRequestedSourceUrl:sourceUrl||wantedSource,scrapeSkipAds:skipAds,scrapeStartedAt:Date.now(),scrapeStatus:t("p.scRunning",{n:count})});
    }
  );
  if(!tab||!tab.url?.includes("facebook.com")||(sourceUrl&&scrapeSourceKey(tab.url)!==wantedSource)){
    scrapeStatus.textContent=sourceUrl?t("p.scLeftSource"):t("p.scMismatch");
    await chrome.storage.local.set({isScraping:false,scrapeReady:false,scrapeHasData:false,scrapeCount:0});
    await chrome.storage.local.remove(["scrapePosts","scrapeTarget","scrapeRunSourceUrl","scrapeRequestedSourceUrl","scrapeSkipAds","scrapeStartedAt"]);
    setScraping(false);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { action: "startScrape", count, skipAds, saveMedia, sourceUrl, withComments, maxComments }, async res => {
    if (chrome.runtime.lastError) {
      const retry = await autoReloadAndRetry(tab.id, { action: "startScrape", count, skipAds, saveMedia, sourceUrl, withComments, maxComments }, scrapeStatus);
      if(retry.ok&&retry.res?.ok){ setScraping(true); scrapeStatus.textContent = t("p.scRunning",{n:count}); }
      else if(await runStillActive("isScraping")){ setScraping(true); scrapeStatus.textContent = t("p.scRunning",{n:count}); }
      else{setScraping(false);scrapeStatus.textContent=retry.res?.error||t("p.scMismatch");}
      return;
    }
    if (res && res.ok) { setScraping(true); scrapeStatus.textContent = t("p.scRunning",{n:count}); }
    else if(res && !res.ok){await chrome.storage.local.set({isScraping:false});await chrome.storage.local.remove(["scrapeTarget"]);setScraping(false);scrapeStatus.textContent=res.error||t("p.scMismatch");}
  });
});

stopScrapeBtn.addEventListener("click", async () => {
  setScraping(false);
  await chrome.storage.local.set({isScraping:false});
  await chrome.storage.local.remove(["scrapeTarget"]);
  broadcastToFacebookTabs({action:"stopScrape"});
  const tab = await getActiveTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "stopScrape" }, () => setScraping(false));
  scrapeStatus.textContent = t("p.stoppedX");
});

dlBtn.onclick = () => requestDownload(dlFormat.value || "md");
chrome.storage.sync.get(["scrapeDlFormat","scrapeDlScope"], res => { if (res.scrapeDlFormat) dlFormat.value = res.scrapeDlFormat; if (res.scrapeDlScope && dlScope) dlScope.value = res.scrapeDlScope; });
dlFormat.addEventListener("change", () => chrome.storage.sync.set({ scrapeDlFormat: dlFormat.value }));
if (dlScope) dlScope.addEventListener("change", () => chrome.storage.sync.set({ scrapeDlScope: dlScope.value }));

const resetBtn = $("resetScrapeBtn");
resetBtn.onclick = async () => {
  // Reset must work even if the tab was closed, redirected, or is no longer
  // on Facebook.  Broadcast is only the fast path; storage is the authority.
  await chrome.storage.local.set({scrapeCount:0,scrapeStatus:t("p.scResetDone"),scrapeReady:false,scrapeHasData:false,isScraping:false});
  await chrome.storage.local.remove(["scrapePosts","scrapeTarget","scrapeRunSourceUrl","scrapeRequestedSourceUrl","scrapeSkipAds","scrapeStartedAt"]);
  scrapeCountEl.textContent=t("sc.countPosts",{n:0});
  downloadGroup.classList.add("hidden");
  scrapeStatus.textContent=t("p.scResetDone");
  setScraping(false);
  broadcastToFacebookTabs({action:"resetScrape"});
  const tab = await getActiveTab();
  if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"resetScrape"},()=>{});
};

// load scrape config
chrome.storage.sync.get(["scrapeNum","scrapeSourceUrl","scrapeSkipAds","scrapeSaveMedia","scrapeCommentsEnabled","scrapeMaxComments"], res => {
  if (res.scrapeNum) scrapeNum.value = res.scrapeNum;
  if (res.scrapeSourceUrl !== undefined) scrapeSourceUrl.value = res.scrapeSourceUrl;
  if (res.scrapeSkipAds !== undefined) scrapeSkipAds.checked = res.scrapeSkipAds;
  if (res.scrapeSaveMedia !== undefined) scrapeSaveMedia.checked = res.scrapeSaveMedia;
  if (scrapeCommentsEnabled && res.scrapeCommentsEnabled !== undefined) scrapeCommentsEnabled.checked = res.scrapeCommentsEnabled;
  if (scrapeMaxComments && res.scrapeMaxComments) scrapeMaxComments.value = res.scrapeMaxComments;
});
chrome.storage.local.get(["scrapeMediaStatus"], res => {
  if (res.scrapeMediaStatus) scrapeMediaStatusEl.textContent = res.scrapeMediaStatus;
});
openScrapeLibraryBtn.onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
};
// Auto vjp (S8): nút header mở trang quản lý đa nền tảng local — xem modules/MODULE-CONTRACT.md
const autovjpManageBtn = document.getElementById("autovjpManageBtn");
if (autovjpManageBtn) autovjpManageBtn.onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") });
};
chrome.storage.local.get(["scrapeCount", "scrapeStatus", "scrapeReady", "isScraping"], res => {
  if (res.scrapeCount !== undefined) scrapeCountEl.textContent = t("sc.countPosts",{n:res.scrapeCount});
  if (res.scrapeStatus) scrapeStatus.textContent = res.scrapeStatus;
  if (res.scrapeReady) updateDownloadVisibility(true);
  if (res.isScraping) setScraping(true);
});
// khi scrape xong, reset nút
chrome.storage.onChanged.addListener(changes => {
  if (changes.isScraping !== undefined && !changes.isScraping.newValue) setScraping(false);
  if (changes.scrapeReady) updateDownloadVisibility(changes.scrapeReady.newValue);
  if (changes.scrapeMediaStatus) scrapeMediaStatusEl.textContent = changes.scrapeMediaStatus.newValue || "";
});

// NUÔI PAGE - chọn Page đang quản trị + tham gia nhóm theo nguồn riêng.
// Không dùng lại state/counter/selector/proof của group.js.
const pageStatus=$("pageStatus"),pageJoinStatus=$("pageJoinStatus"),managedPageList=$("managedPageList");
const loadManagedPagesBtn=$("loadManagedPagesBtn"),refreshManagedPagesBtn=$("refreshManagedPagesBtn");
const pageModeKeywordBtn=$("pageModeKeywordBtn"),pageModeDiscoverBtn=$("pageModeDiscoverBtn"),pageKeywordOptions=$("pageKeywordOptions");
const pageGroupKeyword=$("pageGroupKeyword"),pageGroupTarget=$("pageGroupTarget"),pageGroupMinDelay=$("pageGroupMinDelay"),pageGroupMaxDelay=$("pageGroupMaxDelay");
const pageGroupKeywordList=$("pageGroupKeywordList");
// Nhiều từ khóa chạy nối tiếp 1 lượt: mỗi dòng "từ khóa | số nhóm".
// Số nhóm bỏ trống thì dùng ô pageGroupTarget. Tối đa 20 dòng.
function parsePageKeywordList(fallbackTarget){
  const raw=String(pageGroupKeywordList?.value||"").split(/\r?\n/);
  const out=[];
  for(const line of raw){
    const text=line.trim();
    if(!text)continue;
    const parts=text.split("|");
    const kw=String(parts[0]||"").trim();
    const n=parts.length>1?parseInt(parts[1],10):fallbackTarget;
    if(!kw)continue;
    out.push({keyword:kw.slice(0,120),target:Math.max(1,Math.min(100000,Number.isFinite(n)?n:fallbackTarget))});
    if(out.length>=1000)break;
  }
  return out;
}
const pageGroupMinMembers=$("pageGroupMinMembers"),pageGroupMinPostsPerDay=$("pageGroupMinPostsPerDay");
const pageGroupAnswers=$("pageGroupAnswers"),pageGroupAiEnabled=$("pageGroupAiEnabled"),pageGroupAiPrompt=$("pageGroupAiPrompt");
const pageGroupStartBtn=$("pageGroupStartBtn"),pageGroupStopBtn=$("pageGroupStopBtn"),pageGroupResetBtn=$("pageGroupResetBtn"),pageGroupCount=$("pageGroupCount");
let managedPages=[],selectedManagedPage=null,pageJoinMode="keyword",pageJoinRunning=false;

function pageEsc(value){return String(value||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));}
function pageKeyForPopup(page){
  try{const u=new URL(String(page?.url||""));return u.searchParams.get("id")||u.pathname.replace(/\/+$/g,"").toLowerCase()||String(page?.name||"").toLowerCase();}catch{return String(page?.id||page?.name||"").toLowerCase();}
}
// Chuẩn hóa giống background.js: loại bỏ slash đầu để tránh double underscore
function pageGroupStorageKeyForPopup(pageKey){
  const safe=String(pageKey||"").replace(/^\/+/,"").replace(/[^a-zA-Z0-9_\-]/g,"_");
  return safe?`pageJoinedGroups_${safe}`:"";
}
// ===== KHO DỮ LIỆU THEO PAGE (pageDatasets, chrome.storage.local) =====
// Mỗi Page giữ 1 dataset: config UI + tick chọn nhóm + tóm tắt lần chạy cuối.
// Đổi Page: lưu UI hiện tại vào dataset Page cũ, nạp dataset Page mới lên UI.
// Chạy/Reset/Hẹn lịch không đổi logic — chỉ thêm 1 lệnh save/load dataset.
const PAGE_DATASETS_KEY="pageDatasets";
let pageDatasetsCache=null;
async function getPageDatasets(){
  if(pageDatasetsCache&&typeof pageDatasetsCache==="object")return pageDatasetsCache;
  try{const s=await chrome.storage.local.get(PAGE_DATASETS_KEY);pageDatasetsCache=s[PAGE_DATASETS_KEY]&&typeof s[PAGE_DATASETS_KEY]==="object"?s[PAGE_DATASETS_KEY]:{};}catch{pageDatasetsCache={};}
  return pageDatasetsCache;
}
// Cache trong RAM + ghi nguyên object: thay đổi từ bên ngoài (tab/tool khác)
// giữa lúc đọc và ghi sẽ bị ghi đè mất. Hủy cache khi storage đổi từ ngoài.
try{chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local"&&changes[PAGE_DATASETS_KEY])pageDatasetsCache=null;});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
function pageSafeKeyOf(pageOrKey){
  const raw=(pageOrKey&&typeof pageOrKey==="object")?pageKeyForPopup(pageOrKey):String(pageOrKey||"");
  return raw.replace(/^\/+/,"").replace(/[^a-zA-Z0-9_\-]/g,"_").toLowerCase();
}
function blankPageDataset(page){
  let ident=null;
  try{ident=typeof schedulePageValue==="function"?schedulePageValue(page):null;}catch{ident=null;}
  return {page:ident||{id:"",name:"",url:""},updatedAt:0,
    join:{mode:"keyword",keyword:"",target:10,minDelay:15,maxDelay:30,minMembers:10000,minPostsPerDay:5,answers:"",aiEnabled:true,aiPrompt:"",sel:[]},
    post:{target:5,minDelay:30,maxDelay:60,prompt:"",bgEnabled:false,bgMode:"random",fixedColor:"pink",bgColors:[],bgMaxChars:100,styleProfile:"",sel:[]},
    sales:{targetGroups:1,postsPerGroup:1,minDelay:30,maxDelay:60,styleProfile:"",sel:[]},
    gcomment:{perGroup:3,targetGroups:"",minDelay:20,maxDelay:45,prompt:"",tag:{enabled:false,urls:"",entities:"[]",order:"seq",rate:70},sel:[]},
    fcomment:{source:"feed",target:10,minDelay:20,maxDelay:45,prompt:"",tagPrompt:"",tag:{enabled:false,urls:"",entities:"[]",order:"seq",rate:70},sel:[]},
    last:{join:null,post:null,sales:null,gcomment:null,fcomment:null}};
}
function pageCheckedValues(containerId,checkClass){
  try{const el=typeof containerId==="string"?document.getElementById(containerId):containerId;if(!el)return [];return [...el.querySelectorAll(`.${checkClass}:checked`)].map(b=>String(b.value));}catch{return [];}
}
// Tick chờ áp sau render (render nào cũng dựng lại innerHTML nên tick DOM-only sẽ mất).
let pagePendingTicks={join:null,post:null,sales:null,gcomment:null,fcomment:null};
function pageTickChecked(list,key){
  const sel=pagePendingTicks[list];
  if(!Array.isArray(sel))return null;
  return sel.includes(String(key));
}
function pageSyncTicksFromDOM(){
  try{
    pagePendingTicks.join=pageCheckedValues("pageJoinSavedList","pjs-group-check");
    pagePendingTicks.post=pageCheckedValues("pageGroupPostList","pgp-group-check");
    pagePendingTicks.sales=pageCheckedValues("pageSalesGroupList","pgs-group-check");
    pagePendingTicks.gcomment=pageCheckedValues("pageGroupCommentGroupList","pggc-group-check");
    pagePendingTicks.fcomment=pageCheckedValues("pageCommentGroupList","pgc-group-check");
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
// Tick tay từng ô: đồng bộ ngay để render sau (Tải lại/Nạp log) không mất lựa chọn.
document.addEventListener("change",event=>{
  try{
    const box=event.target;
    if(!box||box.type!=="checkbox"||!box.classList) return;
    const hit=["pjs-group-check","pgp-group-check","pgs-group-check","pggc-group-check","pgc-group-check"].some(c=>box.classList.contains(c));
    if(hit)pageSyncTicksFromDOM();
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
});
// Trả "checked"/"" cho template render: có dataset thì theo tick đã lưu,
// chưa có thì giữ mặc định cũ (defChecked).
function pageTickAttr(list,key,defChecked){
  const v=pageTickChecked(list,key);
  if(v===null)return defChecked?"checked":"";
  return v?"checked":"";
}
const PAGE_TICK_CLASS_MAP={"pjs-group-check":"join","pgp-group-check":"post","pgs-group-check":"sales","pggc-group-check":"gcomment","pgc-group-check":"fcomment"};
function pageTickAttrByClass(checkClass,key,defChecked){
  const list=PAGE_TICK_CLASS_MAP[checkClass];
  if(!list)return defChecked?"checked":"";
  return pageTickAttr(list,key,defChecked);
}
async function pageTagSnapshot(prefix){
  let entities="[]";
  try{const s=await chrome.storage.sync.get([prefix+"TagEntities"]);const v=s[prefix+"TagEntities"];entities=typeof v==="string"?v:(v?"[]":"[]");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  const orderEl=document.querySelector(`[name="${prefix}TagOrder"]:checked`);
  const rateEl=document.getElementById(prefix+"TagRate"),enEl=document.getElementById(prefix+"TagEnabled");
  return {enabled:!!enEl?.checked,urls:document.getElementById(prefix+"TagUrls")?.value||"",entities,order:orderEl?.value||"seq",rate:rateEl?parseInt(rateEl.value)||70:70};
}
async function savePageUIToDataset(safeKey,pageObj){
  if(!safeKey)return null;
  const all=await getPageDatasets();
  const ds=all[safeKey]||blankPageDataset(pageObj||selectedManagedPage);
  try{ds.page=typeof schedulePageValue==="function"?(schedulePageValue(pageObj||selectedManagedPage)||ds.page):ds.page;}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  ds.updatedAt=Date.now();
  const val=(id,def)=>{const el=document.getElementById(id);return el?el.value:def;};
  const num=(id,def)=>Math.max(0,parseInt(val(id,""))||def);
  ds.join={mode:pageJoinMode,keyword:pageGroupKeyword?.value||"",keywordList:pageGroupKeywordList?.value||"",target:num("pageGroupTarget",10),minDelay:num("pageGroupMinDelay",15),maxDelay:num("pageGroupMaxDelay",30),minMembers:num("pageGroupMinMembers",0),minPostsPerDay:num("pageGroupMinPostsPerDay",0),answers:pageGroupAnswers?.value||"",aiEnabled:!!pageGroupAiEnabled?.checked,aiPrompt:pageGroupAiPrompt?.value||"",sel:pageCheckedValues("pageJoinSavedList","pjs-group-check")};
  ds.post={target:num("pageGroupPostTarget",5),minDelay:num("pageGroupPostMinDelay",30),maxDelay:num("pageGroupPostMaxDelay",60),prompt:pageGroupPostPrompt?.value||"",bgEnabled:!!pageGroupPostBgEnabled?.checked,bgMode:pageGroupPostBgMode?.value||"random",fixedColor:pageGroupPostFixedColor?.value||"pink",bgColors:[...document.querySelectorAll(".pgp-bg-color:checked")].map(el=>el.value),bgMaxChars:num("pageGroupPostBgMaxChars",100),styleProfile:pageGroupPostStyleProfile?.value||"",sel:pageCheckedValues("pageGroupPostList","pgp-group-check")};
  ds.sales={targetGroups:num("pageSalesPostTargetGroups",1),postsPerGroup:num("pageSalesPostsPerGroup",1),minDelay:num("pageSalesMinDelay",30),maxDelay:num("pageSalesMaxDelay",60),styleProfile:pageSalesStyleProfile?.value||"",sel:pageCheckedValues("pageSalesGroupList","pgs-group-check")};
  ds.gcomment={perGroup:num("pageGroupCommentPerGroup",3),targetGroups:val("pageGroupCommentTargetGroups",""),minDelay:num("pageGroupCommentMinDelay",20),maxDelay:num("pageGroupCommentMaxDelay",45),prompt:pageGroupCommentPrompt?.value||"",tag:await pageTagSnapshot("pageGroupComment"),sel:pageCheckedValues("pageGroupCommentGroupList","pggc-group-check")};
  ds.fcomment={source:["feed","groups","pages"].includes(pageCommentSource?.value)?pageCommentSource.value:"feed",target:num("pageCommentTarget",10),minDelay:num("pageCommentMinDelay",20),maxDelay:num("pageCommentMaxDelay",45),prompt:pageCommentPrompt?.value||"",tagPrompt:pageCommentTagPrompt?.value||"",tag:await pageTagSnapshot("pageComment"),sel:pageCheckedValues("pageCommentGroupList","pgc-group-check")};
  all[safeKey]=ds;pageDatasetsCache=all;
  try{await chrome.storage.local.set({[PAGE_DATASETS_KEY]:all});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  return ds;
}
function pageApplyTagSnapshot(prefix,snap){
  try{
    const enEl=document.getElementById(prefix+"TagEnabled"),detailsEl=document.getElementById(prefix+"TagDetails"),
      urlsEl=document.getElementById(prefix+"TagUrls"),rateEl=document.getElementById(prefix+"TagRate"),
      rateValEl=document.getElementById(prefix+"TagRateVal");
    if(enEl)enEl.checked=!!snap?.enabled;
    if(detailsEl)detailsEl.style.display=snap?.enabled?"":"none";
    if(urlsEl)urlsEl.value=snap?.urls||"";
    const orderEl=document.querySelector(`[name="${prefix}TagOrder"][value="${snap?.order||"seq"}"]`);
    if(orderEl)orderEl.checked=true;
    if(rateEl)rateEl.value=snap?.rate??70;
    if(rateValEl)rateValEl.textContent=(snap?.rate??70)+"%";
    let arr=[];try{arr=JSON.parse(snap?.entities||"[]");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    if(tagSections[prefix]&&typeof tagSections[prefix].setEntities==="function"&&Array.isArray(arr)&&arr.length)tagSections[prefix].setEntities(arr);
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
async function loadPageDatasetToUI(safeKey){
  const all=await getPageDatasets();
  const ds=all[safeKey]||blankPageDataset(selectedManagedPage);
  const set=(id,v)=>{const el=document.getElementById(id);if(el&&v!==undefined&&v!==null)el.value=v;};
  const setCheck=(id,v)=>{const el=document.getElementById(id);if(el)el.checked=!!v;};
  if(!pageJoinRunning&&typeof setPageMode==="function"){try{setPageMode(ds.join.mode||"keyword");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  set("pageGroupKeyword",ds.join.keyword);
  if(ds.join.keywordList!==undefined&&pageGroupKeywordList)pageGroupKeywordList.value=ds.join.keywordList;
  try{migrateSingleKeywordToList();syncSingleKeywordFromList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  set("pageGroupTarget",ds.join.target);
  set("pageGroupMinDelay",ds.join.minDelay);set("pageGroupMaxDelay",ds.join.maxDelay);
  set("pageGroupMinMembers",ds.join.minMembers);set("pageGroupMinPostsPerDay",ds.join.minPostsPerDay);
  if(document.getElementById("pageGroupAnswers"))setPromptIf(pageGroupAnswers,ds.join.answers);
  setCheck("pageGroupAiEnabled",ds.join.aiEnabled);
  if(document.getElementById("pageGroupAiPrompt"))setPromptIf(pageGroupAiPrompt,ds.join.aiPrompt);
  set("pageGroupPostTarget",ds.post.target);set("pageGroupPostMinDelay",ds.post.minDelay);set("pageGroupPostMaxDelay",ds.post.maxDelay);
  if(document.getElementById("pageGroupPostPrompt"))setPromptIf(pageGroupPostPrompt,ds.post.prompt);
  setCheck("pageGroupPostBgEnabled",ds.post.bgEnabled);
  set("pageGroupPostBgMode",ds.post.bgMode);set("pageGroupPostFixedColor",ds.post.fixedColor);set("pageGroupPostBgMaxChars",ds.post.bgMaxChars);
  document.querySelectorAll(".pgp-bg-color").forEach(el=>{el.checked=(ds.post.bgColors||[]).includes(el.value);});
  if(typeof togglePageGroupPostBgOptions==="function"){try{togglePageGroupPostBgOptions();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  set("pageGroupPostStyleProfile",ds.post.styleProfile);
  set("pageSalesPostTargetGroups",ds.sales.targetGroups);set("pageSalesPostsPerGroup",ds.sales.postsPerGroup);
  set("pageSalesMinDelay",ds.sales.minDelay);set("pageSalesMaxDelay",ds.sales.maxDelay);
  set("pageSalesStyleProfile",ds.sales.styleProfile);
  set("pageGroupCommentPerGroup",ds.gcomment.perGroup);set("pageGroupCommentTargetGroups",ds.gcomment.targetGroups);
  set("pageGroupCommentMinDelay",ds.gcomment.minDelay);set("pageGroupCommentMaxDelay",ds.gcomment.maxDelay);
  if(document.getElementById("pageGroupCommentPrompt"))setPromptIf(pageGroupCommentPrompt,ds.gcomment.prompt);
  pageApplyTagSnapshot("pageGroupComment",ds.gcomment.tag);
  set("pageCommentSource",ds.fcomment.source);
  if(typeof togglePageCommentGroupSection==="function"){try{togglePageCommentGroupSection();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  set("pageCommentTarget",ds.fcomment.target);set("pageCommentMinDelay",ds.fcomment.minDelay);set("pageCommentMaxDelay",ds.fcomment.maxDelay);
  if(document.getElementById("pageCommentPrompt"))setPromptIf(pageCommentPrompt,ds.fcomment.prompt);
  if(document.getElementById("pageCommentTagPrompt"))setPromptIf(pageCommentTagPrompt,ds.fcomment.tagPrompt);
  pageApplyTagSnapshot("pageComment",ds.fcomment.tag);
  pagePendingTicks={join:ds.join.sel||[],post:ds.post.sel||[],sales:ds.sales.sel||[],gcomment:ds.gcomment.sel||[],fcomment:ds.fcomment.sel||[]};
  await restorePageLastCounters(safeKey);
  return ds;
}
// Hiện tóm tắt lần chạy cuối của Page khi tính năng đang rảnh (có run thì số live thắng).
async function restorePageLastCounters(safeKey){
  const all=await getPageDatasets();
  const last=(all[safeKey]||{}).last||{};
  let live={};
  try{live=await chrome.storage.local.get(["pageGroupJoinActive","pageGroupPostActive","pageSalesPostActive","pageGroupCommentActive","pageCommentActive"]);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  const rows=[
    {on:live.pageGroupJoinActive,count:"pageGroupCount",status:"pageJoinStatus",v:last.join},
    {on:live.pageGroupPostActive,count:"pageGroupPostCount",status:"pageGroupPostStatus",v:last.post},
    {on:live.pageSalesPostActive,count:"pageSalesCount",status:"pageSalesStatus",v:last.sales},
    {on:live.pageGroupCommentActive,count:"pageGroupCommentCount",status:"pageGroupCommentStatus",v:last.gcomment},
    {on:live.pageCommentActive,count:"pageCommentCount",status:"pageCommentStatus",v:last.fcomment},
  ];
  for(const r of rows){
    if(r.on||!r.v)continue;
    const c=document.getElementById(r.count),s=document.getElementById(r.status);
    if(c&&Number.isFinite(r.v.done))c.textContent=`${r.v.done} / ${r.v.total??r.v.done}`;
    if(s&&r.v.status)s.textContent=r.v.status;
  }
}
async function notePageRunEnd(feat,done,skipped,status){
  try{
    const keys={join:"pageGroupJoinConfig",post:"pageGroupPostConfig",sales:"pageSalesPostConfig",gcomment:"pageGroupCommentConfig",fcomment:"pageCommentConfig"};
    const ck=keys[feat];if(!ck)return;
    const s=await chrome.storage.local.get([ck]);
    const page=s[ck]?.page;if(!page) return;
    const safeKey=pageSafeKeyOf(page);if(!safeKey)return;
    const all=await getPageDatasets();
    const ds=all[safeKey]||blankPageDataset(page);
    const num=v=>typeof v==="number"?v:(v&&typeof v==="object"?Object.keys(v).length:0);
    let total=done;
    try{
      if(feat==="post"){const t=await chrome.storage.local.get(["pageGroupPostConfig"]);total=t.pageGroupPostConfig?.groups?.length??done;}
      if(feat==="sales"){const t=await chrome.storage.local.get(["pageSalesPostConfig"]);total=(t.pageSalesPostConfig?.groups?.length??0)||done;}
    }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    ds.last[feat]={done:num(done),skipped:num(skipped),total, status:String(status||"").slice(0,200),at:Date.now()};
    all[safeKey]=ds;pageDatasetsCache=all;
    await chrome.storage.local.set({[PAGE_DATASETS_KEY]:all});
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
function pageDatasetClearLast(feat){
  try{
    const safeKey=pageSafeKeyOf(selectedManagedPage);if(!safeKey)return;
    getPageDatasets().then(all=>{
      const ds=all[safeKey];if(!ds||!ds.last)return;
      ds.last[feat]=null;pageDatasetsCache=all;
      chrome.storage.local.set({[PAGE_DATASETS_KEY]:all}).catch(()=>{});
    });
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
// Promise dùng chung: dataset của Page đang chọn (đọc 1 lần, mọi chỗ init cùng chờ).
function selectedPageDatasetPromise(){
  if(window._pageDsP)return window._pageDsP;
  window._pageDsP=(async()=>{
    try{
      const s=await chrome.storage.sync.get(["pageSelected"]);
      const sel=s.pageSelected||null;
      if(!sel)return null;
      try{if(!selectedManagedPage)selectedManagedPage=sel;}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      const all=await getPageDatasets();
      const ds=all[pageSafeKeyOf(sel)]||null;
      return ds?{ds,page:sel}:null;
    }catch{return null;}
  })();
  return window._pageDsP;
}
// Render lại toàn bộ list theo Page đang chọn (dùng chung switch + mở popup).
function refreshPageListsForSelected(){
  try{
    try{renderPageSalesGroups().then(()=>{try{renderPageSalesProducts().catch(()=>{});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}).catch(()=>{});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{loadPageSalesPrompt().catch(()=>{});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{renderPageSavedGroupsList();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{renderPageGroupCommentGroups();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{renderPageJoinSavedList();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{if(pageCommentSource?.value==="groups")ensurePageSavedGroups(selectedManagedPage).then(rows=>renderPageCommentGroups(rows)).catch(()=>{});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{const _hn=$("pagePostGroupsHintName");if(_hn)_hn.textContent=selectedManagedPage?.name||"";}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    try{
      const _pgKey2=selectedManagedPage?pageGroupStorageKeyForPopup(pageKeyForPopup(selectedManagedPage)):"";
      if(_pgKey2){chrome.storage.local.get([_pgKey2],data=>{const groups=data[_pgKey2];if(Array.isArray(groups)&&groups.length&&groups[0]?._actorVerified!==false)renderPagePostGroups(groups);else renderPagePostGroups([]);});}
      else renderPagePostGroups([]);
    }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
function renderManagedPages(pages,selectedKey=""){
  managedPages=Array.isArray(pages)?pages:[];
  if(!managedPages.length){managedPageList.innerHTML='<div class="hint" style="padding:6px">'+t("pg.noPages")+'</div>';return;}
  const chosen=selectedKey||pageKeyForPopup(selectedManagedPage);
  managedPageList.innerHTML=managedPages.map((page,index)=>{
    const key=pageKeyForPopup(page),checked=key===chosen?"checked":"";
    return `<label style="display:flex;align-items:center;gap:8px;padding:7px;margin:0;border-bottom:1px solid #eee;cursor:pointer"><input class="managed-page-radio" type="radio" name="managedPage" value="${pageEsc(key)}" ${checked} style="width:auto"><span style="display:flex;flex-direction:column;min-width:0"><b style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${pageEsc(page.name||t("pg.pageFallback",{n:index+1}))}</b><small style="color:#65676b;overflow:hidden;text-overflow:ellipsis">${pageEsc(page.url||"")}</small></span></label>`;
  }).join("");
  const picked=managedPages.find(page=>pageKeyForPopup(page)===chosen);
  if(picked)selectedManagedPage=picked;
  try{renderPageQueueList().catch(()=>{});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
// ===== CHẠY NỐI TIẾP NHIỀU PAGE: dùng chung cơ chế chuỗi trung tâm =====
// Thêm bước từ nút "Thêm vào chuỗi" trên từng card tính năng (đọc đúng UI
// đang hiển thị), gộp ở tab Lịch chạy. Nút dưới chỉ mở tab Lịch chạy.
const pgqGotoScheduleBtn=$("pgqGotoScheduleBtn");
if(pgqGotoScheduleBtn)pgqGotoScheduleBtn.onclick=()=>{try{document.querySelector("#tabSchedule")?.click();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }};
async function renderPageQueueList(){}
function setPageMode(mode){  if(pageJoinRunning&&mode!==pageJoinMode){pageJoinStatus.textContent=t("pg.modeLocked");return;}
  pageJoinMode=mode==="discover"?"discover":"keyword";
  pageModeKeywordBtn.style.background=pageJoinMode==="keyword"?"#1565c0":"#e4e6eb";
  pageModeKeywordBtn.style.color=pageJoinMode==="keyword"?"#fff":"#050505";
  pageModeDiscoverBtn.style.background=pageJoinMode==="discover"?"#00897b":"#e4e6eb";
  pageModeDiscoverBtn.style.color=pageJoinMode==="discover"?"#fff":"#050505";
  pageKeywordOptions.classList.toggle("hidden",pageJoinMode!=="keyword");
  chrome.storage.sync.set({pageJoinMode});
}
function setPageRunning(value){
  pageJoinRunning=!!value;
  pageGroupStartBtn.textContent=pageJoinRunning?t("pg.btnBusy"):t("pg.start");
  pageGroupStartBtn.classList.toggle("running",pageJoinRunning);
}
async function refreshPageAiSummary(){
  // Giữ cấu hình AI thống nhất; không tạo ô API key riêng cho Nuôi Page.
  try{const cfg=await getUnifiedAiConfig();pageStatus.dataset.aiReady=cfg.key&&cfg.model?"true":"false";}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
async function scanManagedPages(){
  let tab=await getActiveTab();
  if(!tab){pageStatus.textContent=t("pg.noFb");return;}
  pageStatus.textContent=t("pg.openManager");
  // Điều kiện trước đây bị đảo dấu (thiếu phủ định ở vế "category=your_pages")
  // nên LUÔN điều hướng + chờ lại từ đầu dù tab đã đúng sẵn trang quản lý Page
  // — vừa chậm vừa huỷ mất trạng thái đã tải, khiến lượt bấm đầu hay ra rỗng.
  // Chỉ điều hướng khi tab CHƯA ở đúng URL quản lý Page.
  const onManagerUrl=/facebook\.com\/pages(?:[/?]|$)/i.test(tab.url||"")&&/category=your_pages/i.test(tab.url||"");
  if(!onManagerUrl){
    await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/pages/?category=your_pages"});
    // Chờ đủ để page load xong và React render tất cả card Page
    await new Promise(resolve=>setTimeout(resolve,7000));
  }
  const response=await new Promise(resolve=>chrome.tabs.sendMessage(tab.id,{action:"scanManagedPages"},async result=>{
    if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"scanManagedPages"},pageStatus);resolve(retry.ok?(retry.res||{ok:false}):{ok:false});}
    else resolve(result||{ok:false});
  }));
  if(!response?.ok){pageStatus.textContent=response?.error||t("pg.scanFail");return;}
  renderManagedPages(response.pages||[],pageKeyForPopup(selectedManagedPage));
  await chrome.storage.local.set({managedPages:response.pages||[]});
  pageStatus.textContent=response.pages?.length?t("pg.loadedPages",{n:response.pages.length}):t("pg.noPages");
}
loadManagedPagesBtn.onclick=scanManagedPages;
refreshManagedPagesBtn.onclick=scanManagedPages;
// Đổi Page đang chọn: lưu UI vào dataset Page cũ, nạp dataset Page mới lên UI.
async function switchPageUI(next){
  if(!next)return false;
  const oldKey=pageSafeKeyOf(selectedManagedPage),nextKey=pageSafeKeyOf(next);
  if(oldKey&&oldKey!==nextKey){try{await savePageUIToDataset(oldKey,selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  selectedManagedPage=next;
  try{chrome.storage.sync.set({pageSelected:next});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  try{pageStatus.textContent=t("pg.selected",{name:next.name});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  try{await loadPageDatasetToUI(nextKey);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  try{refreshPageListsForSelected();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  try{
    document.querySelectorAll('#managedPageList .managed-page-radio').forEach(r=>{r.checked=pageKeyForPopup(next)===r.value;});
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  return true;
}
managedPageList.addEventListener("change",async event=>{
  if(!event.target.classList.contains("managed-page-radio"))return;
  const next=managedPages.find(page=>pageKeyForPopup(page)===event.target.value)||null;
  if(!next)return;
  await switchPageUI(next);
});
pageModeKeywordBtn.onclick=()=>setPageMode("keyword");
pageModeDiscoverBtn.onclick=()=>setPageMode("discover");
bindPromptPersistence("pageGroupAiPrompt",pageGroupAiPrompt);
pageGroupAnswers.addEventListener("change",()=>chrome.storage.sync.set({pageGroupAnswers:pageGroupAnswers.value}));
pageGroupAiEnabled.addEventListener("change",()=>chrome.storage.sync.set({pageGroupAiEnabled:pageGroupAiEnabled.checked}));
pageGroupKeyword.addEventListener("change",()=>chrome.storage.sync.set({pageGroupKeyword:pageGroupKeyword.value}));
if(pageGroupKeywordList)pageGroupKeywordList.addEventListener("change",()=>{syncSingleKeywordFromList();chrome.storage.sync.set({pageGroupKeywordList:pageGroupKeywordList.value});});
if(pageGroupKeywordList)pageGroupKeywordList.addEventListener("input",()=>{try{syncSingleKeywordFromList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }});
// Ô từ khóa đơn đã ẩn (giữ element để mọi đường Start/lịch cũ chạy nguyên):
// nó luôn mirror từ khóa đầu của danh sách; khi danh sách trống mà ô đơn còn
// chữ (máy cũ) thì migrate 1 lần vào danh sách.
function syncSingleKeywordFromList(){
  if(!pageGroupKeyword||!pageGroupKeywordList)return;
  const tg=Math.max(1,Math.min(100000,parseInt(pageGroupTarget?.value)||10));
  const list=parsePageKeywordList(tg);
  pageGroupKeyword.value=list.length?list[0].keyword:"";
}
function migrateSingleKeywordToList(){
  if(!pageGroupKeywordList||pageGroupKeywordList.value.trim())return;
  const kw=String(pageGroupKeyword?.value||"").trim();
  if(!kw)return;
  const tg=Math.max(1,Math.min(100000,parseInt(pageGroupTarget?.value)||10));
  pageGroupKeywordList.value=`${kw} | ${tg}`;
  chrome.storage.sync.set({pageGroupKeywordList:pageGroupKeywordList.value}).catch(()=>{});
  syncSingleKeywordFromList();
}
pageGroupAiPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageGroupAiPrompt:pageGroupAiPrompt.value}));
async function pageBusyWithOtherRun(){
  const keys=["isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageNewsWallActive","pageCommentActive","pageSalesPostActive","pageGroupCommentActive"];
  const state=await chrome.storage.local.get(keys);return keys.some(key=>!!state[key]);
}
pageGroupStartBtn.onclick=async()=>{
  if(pageJoinRunning){pageJoinStatus.textContent=t("pg.alreadyRunning");return;}
  if(!selectedManagedPage){pageJoinStatus.textContent=t("pg.needPage");return;}
  const keyword=pageGroupKeyword.value.trim();
  if(pageJoinMode==="keyword"&&!keyword&&!String(pageGroupKeywordList?.value||"").trim()){pageJoinStatus.textContent=t("pg.needKeyword");return;}
  const target=Math.max(1,Math.min(100000,parseInt(pageGroupTarget.value)||10));
  // Một lượt chạy hết danh sách từ khóa: ô list có dòng hợp lệ thì dùng,
  // không thì chạy đúng 1 từ khóa ở ô trên (giữ hành vi cũ).
  let keywords=[];
  if(pageJoinMode==="keyword"){
    const listed=parsePageKeywordList(target);
    if(String(pageGroupKeywordList?.value||"").trim()&&!listed.length){pageJoinStatus.textContent=t("pg.needKeywords");return;}
    keywords=listed.length?listed:(keyword?[{keyword,target}]:[]);
    if(!keywords.length){pageJoinStatus.textContent=t("pg.needKeyword");return;}
  }
  const minDelay=Math.max(5,Math.min(604800,parseInt(pageGroupMinDelay.value)||15));
  const maxDelay=Math.max(5,Math.min(604800,parseInt(pageGroupMaxDelay.value)||30));
  if(minDelay>maxDelay){pageJoinStatus.textContent=t("pg.badDelay");return;}
  if(await pageBusyWithOtherRun()){pageJoinStatus.textContent=t("pg.busyOther");return;}
  try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  const aiConfig=await getAiProfileFor("pageGroupJoin");
  const runId=`page-group-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const minMembers=Math.max(0,parseInt(pageGroupMinMembers?.value)||0);
  const minPostsPerDay=Math.max(0,parseInt(pageGroupMinPostsPerDay?.value)||0);
  const cfg={page:selectedManagedPage,mode:pageJoinMode,keyword:keywords.length?keywords[0].keyword:keyword,target:keywords.length?keywords[0].target:target,keywords,minDelay,maxDelay,minMembers,minPostsPerDay,answers:pageGroupAnswers.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),aiEnabled:!!pageGroupAiEnabled.checked,aiPrompt:pageGroupAiPrompt.value.trim(),aiConfig,typingConfig:getAiTypingConfig("pageGroupJoin"),runId};
  const safeCfg={...cfg,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""}};
  await chrome.storage.sync.set({pageSelected:selectedManagedPage,pageJoinMode,pageGroupKeyword:keyword,pageGroupKeywordList:pageGroupKeywordList?.value||"",pageGroupTarget:target,pageGroupMinDelay:minDelay,pageGroupMaxDelay:maxDelay,pageGroupMinMembers:minMembers,pageGroupMinPostsPerDay:minPostsPerDay,pageGroupAnswers:pageGroupAnswers.value,pageGroupAiEnabled:cfg.aiEnabled,pageGroupAiPrompt:cfg.aiPrompt});
  setPageRunning(true);
  const firstKw=keywords.length?keywords[0].keyword:keyword;
  const targetUrl=pageJoinMode==="discover"?"https://www.facebook.com/groups/discover":"https://www.facebook.com/search/groups/?q="+encodeURIComponent(firstKw);
  const tab=await ensureTaskTab(targetUrl,pageJoinStatus,t("pg.openRoute"),url=>pageJoinMode==="discover"?/\/groups\/discover(?:\/|\?|$)/.test(url):/\/search\/groups(?:\/|\?|$)/.test(url)&&new URL(url).searchParams.get("q")===firstKw,async owner=>{
    // Start mới PHẢI xóa tiến triển từ khóa cũ (keywordIndex/keywordDone):
    // resume sau reload ưu tiên STATE > key riêng, mà key riêng còn sót lượt
    // trước sẽ ghi đè tiến triển mới về số cũ (bắt live: lượt 2×10 dừng ở 9
    // vì kw2 mang 1 stale từ lượt test trước). Không reset là bug.
    await chrome.storage.local.set({pageGroupJoinActive:true,pageGroupJoinRunId:runId,pageGroupJoinOwnerTabId:owner.id,pageGroupJoinConfig:{...safeCfg,ownerTabId:owner.id},pageGroupJoinRunState:{active:true,runId,ownerTabId:owner.id,config:{...safeCfg,ownerTabId:owner.id},joined:0,skipped:0,keywordIndex:0,keywordDone:[],attemptedKeys:[],nextAllowedAt:Date.now()+minDelay*1000,status:t("pg.starting")},pageGroupJoinJoined:0,pageGroupJoinSkipped:0,pageGroupJoinKeywordIndex:0,pageGroupJoinKeywordDone:[],pageGroupJoinAttemptedKeys:[],pageGroupJoinNextAt:Date.now()+minDelay*1000,pageGroupJoinStatus:t("pg.starting")});
  },{actor:"page"});
  if(!tab){setPageRunning(false);await chrome.storage.local.set({pageGroupJoinActive:false});return;}
  chrome.tabs.sendMessage(tab.id,{action:"startPageGroupJoin",config:cfg,ownerTabId:tab.id,nextAllowedAt:Date.now()+minDelay*1000,joined:0,skipped:0,keywordIndex:0,keywordDone:[],attemptedKeys:[]},async result=>{
    if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startPageGroupJoin",config:cfg,ownerTabId:tab.id},pageJoinStatus);if(retry.ok||await runStillActive("pageGroupJoinActive")){pageJoinStatus.textContent=t("pg.running");return;}setPageRunning(false);pageJoinStatus.textContent=t("pg.startFail");return;}
    if(result?.ok||await runStillActive("pageGroupJoinActive")){pageJoinStatus.textContent=t("pg.running");return;}
    setPageRunning(false);pageJoinStatus.textContent=result?.error||t("pg.startFail");
  });
};
pageGroupStopBtn.onclick=async()=>{
  setPageRunning(false);
  await chrome.storage.local.set({pageGroupJoinActive:false,pageGroupJoinStatus:t("pg.stopped")});
  broadcastToFacebookTabs({action:"stopPageGroupJoin"});
};
pageGroupResetBtn.onclick=async()=>{
  setPageRunning(false);
  await chrome.storage.local.set({pageGroupJoinActive:false,pageGroupJoinJoined:0,pageGroupJoinSkipped:0,pageGroupJoinNextAt:0,pageGroupJoinLifetimeJoined:0,pageGroupJoinStatus:t("pg.reset")});
  try{pageDatasetClearLast("join");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  // Xóa trực tiếp để không còn runState/config cũ nếu broadcast tới tab FB trượt
  await chrome.storage.local.remove(["pageGroupJoinConfig","pageGroupJoinRunState","pageGroupJoinAttemptedKeys"]).catch(()=>{});
  broadcastToFacebookTabs({action:"resetPageGroupJoin"});
};
// Trước đây 2 lệnh get(sync)/get(local) này chạy song song độc lập; nếu lệnh
// local (render danh sách Page) trả về trước lệnh sync (biết Page nào đã
// chọn) thì danh sách hiện ra không tick đúng Page đã lưu — trông như
// "chưa chọn đúng Page" dù selectedManagedPage vẫn đúng ở tầng dữ liệu.
// Chờ đọc xong pageSelected rồi mới render để luôn tick đúng ngay từ đầu.
(async()=>{
  const saved=await chrome.storage.sync.get(["pageSelected","pageJoinMode","pageGroupKeyword","pageGroupKeywordList","pageGroupTarget","pageGroupMinDelay","pageGroupMaxDelay","pageGroupMinMembers","pageGroupMaxMembers","pageGroupMinPostsPerDay","pageGroupAnswers","pageGroupAiEnabled","pageGroupAiPrompt"]);
  if(saved.pageSelected)selectedManagedPage=saved.pageSelected;
  const _hn=$("pagePostGroupsHintName");if(_hn&&selectedManagedPage?.name)_hn.textContent=selectedManagedPage.name;
  if(saved.pageJoinMode)setPageMode(saved.pageJoinMode);
  if(saved.pageGroupKeyword!==undefined)pageGroupKeyword.value=saved.pageGroupKeyword;
  if(saved.pageGroupKeywordList!==undefined&&pageGroupKeywordList)pageGroupKeywordList.value=saved.pageGroupKeywordList;
  try{migrateSingleKeywordToList();syncSingleKeywordFromList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  if(saved.pageGroupTarget!==undefined)pageGroupTarget.value=saved.pageGroupTarget;
  if(saved.pageGroupMinDelay!==undefined)pageGroupMinDelay.value=saved.pageGroupMinDelay;
  if(saved.pageGroupMaxDelay!==undefined)pageGroupMaxDelay.value=saved.pageGroupMaxDelay;
  if(saved.pageGroupMinMembers!==undefined&&pageGroupMinMembers)pageGroupMinMembers.value=saved.pageGroupMinMembers;
  if(saved.pageGroupMinPostsPerDay!==undefined&&pageGroupMinPostsPerDay)pageGroupMinPostsPerDay.value=saved.pageGroupMinPostsPerDay;
  if(saved.pageGroupAnswers!==undefined)setPromptIf(pageGroupAnswers,saved.pageGroupAnswers);
  if(saved.pageGroupAiEnabled!==undefined)pageGroupAiEnabled.checked=saved.pageGroupAiEnabled;
  if(saved.pageGroupAiPrompt!==undefined)setPromptIf(pageGroupAiPrompt,saved.pageGroupAiPrompt);
  const local=await chrome.storage.local.get(["managedPages","pageGroupJoinStatus","pageGroupJoinJoined","pageGroupJoinSkipped","pageGroupJoinActive","pageGroupJoinLifetimeJoined","pageGroupJoinRunState"]);
  if(local.managedPages)renderManagedPages(local.managedPages,pageKeyForPopup(selectedManagedPage));
  if(selectedManagedPage){updatePageFeatureLogFilters();updatePageJoinLogFilter();loadPageSalesPrompt().catch(()=>{});renderPageSalesProducts().catch(()=>{});}
  if(local.pageGroupJoinStatus)pageJoinStatus.textContent=local.pageGroupJoinStatus;
  pageGroupCount.textContent=`${local.pageGroupJoinJoined||0} / ${local.pageGroupJoinRunState?.config?.target||pageGroupTarget.value||0}`+(local.pageGroupJoinLifetimeJoined?` • ${t("pg.lifetimeJoined",{n:local.pageGroupJoinLifetimeJoined})}`:"");
  if(local.pageGroupJoinActive)setPageRunning(true);
  // Dataset theo Page (nếu có) thắng config global vừa nạp ở trên.
  try{
    const r=await selectedPageDatasetPromise();
    if(r&&r.page){
      try{if(!selectedManagedPage)selectedManagedPage=r.page;}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      await loadPageDatasetToUI(pageSafeKeyOf(r.page));
      refreshPageListsForSelected();
    }
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
})();
// Trước đây đổi "Số nhóm muốn tham gia" không cập nhật ngay ô đếm "0 / X" —
// vẫn hiện target cũ (mặc định 10) tới khi có tiến độ join/skip đầu tiên,
// khiến người dùng tưởng mục tiêu chưa được lưu.
pageGroupTarget.addEventListener("input",()=>{
  chrome.storage.local.get(["pageGroupJoinJoined","pageGroupJoinSkipped","pageGroupJoinLifetimeJoined","pageGroupJoinRunState"],r=>{
    pageGroupCount.textContent=`${r.pageGroupJoinJoined||0} / ${r.pageGroupJoinRunState?.config?.target||pageGroupTarget.value||0}`+(r.pageGroupJoinSkipped?` (bỏ qua ${r.pageGroupJoinSkipped})`:"")+(r.pageGroupJoinLifetimeJoined?` • ${t("pg.lifetimeJoined",{n:r.pageGroupJoinLifetimeJoined})}`:"");
  });
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  if(changes.pageGroupJoinStatus)pageJoinStatus.textContent=changes.pageGroupJoinStatus.newValue||"";
  if(changes.pageGroupJoinJoined||changes.pageGroupJoinSkipped||changes.pageGroupJoinLifetimeJoined)chrome.storage.local.get(["pageGroupJoinJoined","pageGroupJoinSkipped","pageGroupJoinLifetimeJoined","pageGroupJoinRunState"],r=>{pageGroupCount.textContent=`${r.pageGroupJoinJoined||0} / ${r.pageGroupJoinRunState?.config?.target||pageGroupTarget.value||0} (bỏ qua ${r.pageGroupJoinSkipped||0})`+(r.pageGroupJoinLifetimeJoined?` • ${t("pg.lifetimeJoined",{n:r.pageGroupJoinLifetimeJoined})}`:"");});
  if(changes.pageGroupJoinActive)setPageRunning(!!changes.pageGroupJoinActive.newValue);
  // Mỗi lượt join ghi thêm 1 dòng vào pageSavedGroups — cập nhật nhãn Nạp log
  // và dòng đếm ngay, nhưng KHÔNG render lại list (giữ tick/cuộn của user).
  if(changes.pageSavedGroups)refreshPageSavedCountsLive();
});
// Phiên Page kết thúc (cờ Active true→false): ghi tóm tắt vào dataset của Page
// đã chạy, để đổi Page sau vẫn thấy đúng số Page đó. Không chạm UI live.
const PAGE_RUN_END_FLAGS=[
  {flag:"pageGroupJoinActive",feat:"join",done:["pageGroupJoinJoined"],skipped:["pageGroupJoinSkipped"],status:"pageGroupJoinStatus"},
  {flag:"pageGroupPostActive",feat:"post",done:["pageGroupPostDone"],skipped:["pageGroupPostSkipped"],status:"pageGroupPostStatus"},
  {flag:"pageSalesPostActive",feat:"sales",done:["pageSalesPostDone"],skipped:["pageSalesPostSkipped"],status:"pageSalesPostStatus"},
  {flag:"pageGroupCommentActive",feat:"gcomment",done:["pageGroupCommentDone"],skipped:["pageGroupCommentSkipped"],status:"pageGroupCommentStatus"},
  {flag:"pageCommentActive",feat:"fcomment",done:["pageCommentDone"],skipped:[],status:"pageCommentStatus"},
];
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  for(const m of PAGE_RUN_END_FLAGS){
    const c=changes[m.flag];
    if(c&&c.newValue===false&&c.oldValue===true){
      (async()=>{
        try{
          const s=await chrome.storage.local.get([...m.done,...m.skipped,m.status]);
          const pick=ks=>{for(const k of ks){if(s[k]!==undefined)return s[k];}return 0;};
          await notePageRunEnd(m.feat,pick(m.done),pick(m.skipped),s[m.status]);
        }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      })();
    }
  }
});
// Đếm nhóm đã lưu + options Nạp log theo storage hiện tại (chỉ chữ, không
// đụng checkbox/list). Được gọi khi pageSavedGroups đổi trong lúc join chạy.
function refreshPageSavedCountsLive(){
  if(!selectedManagedPage)return;
  try{updatePageJoinLogFilter();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  try{updatePageFeatureLogFilters();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  if(!pageJoinSavedCount)return;
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  chrome.storage.local.get("pageSavedGroups",r=>{
    const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
    const rows=Array.isArray(all[pk])?all[pk]:[];
    if(!rows.length){pageJoinSavedCount.textContent="";return;}
    const kw=(pageJoinSavedKeyword?.value||"").trim().toLocaleLowerCase("vi");
    const filtered=kw?rows.filter(g=>(g.name||"").toLocaleLowerCase("vi").includes(kw)):rows;
    pageJoinSavedCount.textContent=`${filtered.length}/${rows.length} nhóm đã lưu`;
  });
}

// Page Care: group posts, followed Pages and Page Comment AI. These handlers
// only use page* state and message names; personal Comment AI remains in feed.js.
const pageGroupPostTarget=$("pageGroupPostTarget"),pageGroupPostMinDelay=$("pageGroupPostMinDelay"),pageGroupPostMaxDelay=$("pageGroupPostMaxDelay"),pageGroupPostPrompt=$("pageGroupPostPrompt");
const pageGroupPostStartBtn=$("pageGroupPostStartBtn"),pageGroupPostStopBtn=$("pageGroupPostStopBtn"),pageGroupPostResetBtn=$("pageGroupPostResetBtn"),pageGroupPostStatus=$("pageGroupPostStatus"),pageGroupPostCount=$("pageGroupPostCount");
const pageNewsSourceType=$("pageNewsSourceType"),pageNewsXUsers=$("pageNewsXUsers"),pageNewsUrl=$("pageNewsUrl"),pageNewsTopic=$("pageNewsTopic"),pageNewsWallTarget=$("pageNewsWallTarget"),pageNewsWallDelay=$("pageNewsWallDelay"),pageNewsWallWithImage=$("pageNewsWallWithImage"),pageNewsWallPrompt=$("pageNewsWallPrompt"),pageNewsXWrap=$("pageNewsXWrap"),pageNewsUrlWrap=$("pageNewsUrlWrap");
const pageNewsWallStartBtn=$("pageNewsWallStartBtn"),pageNewsWallStopBtn=$("pageNewsWallStopBtn"),pageNewsWallResetBtn=$("pageNewsWallResetBtn"),pageNewsWallStatus=$("pageNewsWallStatus"),pageNewsWallCount=$("pageNewsWallCount");
const pageNewsWallScheduleWhen=$("pageNewsWallScheduleWhen"),pageNewsWallScheduleBtn=$("pageNewsWallScheduleBtn"),pageNewsWallScheduleStatus=$("pageNewsWallScheduleStatus");
let pageNewsWallRunning=false;
function setPageNewsWallRunning(value){pageNewsWallRunning=!!value;if(pageNewsWallStartBtn){pageNewsWallStartBtn.textContent=pageNewsWallRunning?t("pgn.btnBusy"):t("pgn.start");pageNewsWallStartBtn.classList.toggle("running",pageNewsWallRunning);}}
function pageNewsSourceConfig(){
  const type=pageNewsSourceType?.value==="url"?"url":"xread";
  if(type==="xread")return {type,users:String(pageNewsXUsers?.value||"").split(/\r?\n|[,\s]+/).map(v=>v.trim().replace(/^@/,"")).filter(v=>/^[A-Za-z0-9_]{1,15}$/.test(v)).slice(0,1000)};
  return {type,url:String(pageNewsUrl?.value||"").trim()};
}
function togglePageNewsSource(){const x=pageNewsSourceType?.value!=="url";if(pageNewsXWrap)pageNewsXWrap.style.display=x?"":"none";if(pageNewsUrlWrap)pageNewsUrlWrap.style.display=x?"none":"";}
if(pageNewsSourceType)pageNewsSourceType.onchange=togglePageNewsSource;
togglePageNewsSource();
if(pageNewsWallPrompt)pageNewsWallPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageNewsWallPrompt:pageNewsWallPrompt.value}));
if(pageNewsXUsers)pageNewsXUsers.addEventListener("change",()=>chrome.storage.sync.set({pageNewsXUsers:pageNewsXUsers.value}));
if(pageNewsUrl)pageNewsUrl.addEventListener("change",()=>chrome.storage.sync.set({pageNewsUrl:pageNewsUrl.value}));
if(pageNewsTopic)pageNewsTopic.addEventListener("change",()=>chrome.storage.sync.set({pageNewsTopic:pageNewsTopic.value}));
if(pageNewsWallTarget)pageNewsWallTarget.addEventListener("change",()=>chrome.storage.sync.set({pageNewsWallTarget:pageNewsWallTarget.value}));
if(pageNewsWallDelay)pageNewsWallDelay.addEventListener("change",()=>chrome.storage.sync.set({pageNewsWallDelay:pageNewsWallDelay.value}));
if(pageNewsWallWithImage)pageNewsWallWithImage.addEventListener("change",()=>chrome.storage.sync.set({pageNewsWallWithImage:pageNewsWallWithImage.checked}));
// ---- Danh sách nhóm trung tâm của Page (dùng chung cho Đăng bài/Đăng bán/Comment nhóm) ----
const loadPageSavedGroupsBtn=$("loadPageSavedGroupsBtn"),selectAllPageSavedGroupsBtn=$("selectAllPageSavedGroupsBtn"),pageSavedGroupsKeyword=$("pageSavedGroupsKeyword"),pageSavedGroupsList=$("pageSavedGroupsList"),pageSavedGroupsStatus=$("pageSavedGroupsStatus"),pageSavedGroupsCount=$("pageSavedGroupsCount");
let pageSavedGroupsAll=[];
const loadPagePostGroupsBtn=$("loadPagePostGroupsBtn"),selectAllPagePostGroupsBtn=$("selectAllPagePostGroupsBtn"),pageGroupPostList=$("pageGroupPostList"),pageGroupPostKeyword=$("pageGroupPostKeyword"),pagePostGroupsHint=$("pagePostGroupsHint");
const pageJoinLoadSavedBtn=$("pageJoinLoadSavedBtn"),pageJoinScanGroupsBtn=$("pageJoinScanGroupsBtn"),pageJoinSavedKeyword=$("pageJoinSavedKeyword"),pageJoinSavedList=$("pageJoinSavedList"),pageJoinSavedCount=$("pageJoinSavedCount");
const pageJoinLogFilter=$("pageJoinLogFilter"),pageJoinLoadFromLogBtn=$("pageJoinLoadFromLogBtn"),pageJoinSelectAllBtn=$("pageJoinSelectAllBtn"),pageJoinPickKeywordBtn=$("pageJoinPickKeywordBtn");
const pagePostLogFilter=$("pagePostLogFilter"),pagePostLoadFromLogBtn=$("pagePostLoadFromLogBtn");
const pageSalesLogFilter=$("pageSalesLogFilter"),pageSalesLoadFromLogBtn=$("pageSalesLoadFromLogBtn");
const pageGroupCommentLogFilter=$("pageGroupCommentLogFilter"),pageGroupCommentLoadFromLogBtn=$("pageGroupCommentLoadFromLogBtn");
const pageGroupPostStyleProfile=$("pageGroupPostStyleProfile");
const pageGroupPostBgEnabled=$("pageGroupPostBgEnabled"),pageGroupPostBgOptions=$("pageGroupPostBgOptions"),pageGroupPostBgMode=$("pageGroupPostBgMode"),pageGroupPostFixedColorWrap=$("pageGroupPostFixedColorWrap"),pageGroupPostFixedColor=$("pageGroupPostFixedColor"),pageGroupPostBgMaxChars=$("pageGroupPostBgMaxChars");
const PAGE_POST_BG_COLORS={pink:"#e91e63",green:"#2e7d32",red:"#d32f2f",orange:"#ef6c00",yellow:"#f9a825",blue:"#1976d2",purple:"#7b1fa2",burgundy:"#8e244d",beige:"#b9a07e",brown:"#6d4c41",gray:"#78909c",black:"#263238"};
let pagePostGroups=[];
const pageCommentSource=$("pageCommentSource"),pageCommentTarget=$("pageCommentTarget"),pageCommentMinDelay=$("pageCommentMinDelay"),pageCommentMaxDelay=$("pageCommentMaxDelay"),pageCommentPrompt=$("pageCommentPrompt"),pageCommentTagEnabled=$("pageCommentTagEnabled"),pageCommentTagPrompt=$("pageCommentTagPrompt");
// ---- Đăng bán bằng Page: sản phẩm riêng, độc lập với nick cá nhân ----
const pageSalesGroupList=$("pageSalesGroupList"),pageSalesProductList=$("pageSalesProductList"),pageSalesAddProductBtn=$("pageSalesAddProductBtn"),pageSalesOverrideText=$("pageSalesOverrideText"),pageSalesOverridePrompt=$("pageSalesOverridePrompt"),pageSalesMediaMode=$("pageSalesMediaMode"),pageSalesSkipMedia=$("pageSalesSkipMedia"),pageSalesMinDelay=$("pageSalesMinDelay"),pageSalesMaxDelay=$("pageSalesMaxDelay");
const pageSalesStartBtn=$("pageSalesStartBtn"),pageSalesStopBtn=$("pageSalesStopBtn"),pageSalesResetBtn=$("pageSalesResetBtn"),pageSalesStatus=$("pageSalesStatus"),pageSalesCount=$("pageSalesCount"),pageSalesReloadGroupsBtn=$("pageSalesReloadGroupsBtn"),pageSalesSelectAllGroupsBtn=$("pageSalesSelectAllGroupsBtn");
const pageSalesPrompt=$("pageSalesPrompt"),pageSalesStyleProfile=$("pageSalesStyleProfile"),pageSalesPostTargetGroups=$("pageSalesPostTargetGroups"),pageSalesPostsPerGroup=$("pageSalesPostsPerGroup"),pageSalesGroupKeyword=$("pageSalesGroupKeyword"),pageSalesPreviewBtn=$("pageSalesPreviewBtn"),pageSalesPreview=$("pageSalesPreview"),pageSalesScheduleWhen=$("pageSalesScheduleWhen"),pageSalesScheduleBtn=$("pageSalesScheduleBtn"),pageSalesScheduleStatus=$("pageSalesScheduleStatus");
let pageSalesGroups=[],pageSalesProducts=[],pageSalesRunning=false;
function setPageSalesRunning(value){pageSalesRunning=!!value;if(pageSalesStartBtn){pageSalesStartBtn.textContent=pageSalesRunning?t("pgs.btnBusy"):t("pgs.start");pageSalesStartBtn.classList.toggle("running",pageSalesRunning);}}
async function renderPageSalesGroups(){
  if(!pageSalesGroupList)return;
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  const rows=selectedManagedPage?await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]):[];
  const seen=new Set();
  pageSalesGroups=(rows||[]).filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  if(!pageSalesGroups.length){pageSalesGroupList.innerHTML=`<div class="hint" style="padding:6px">${t("pgs.noGroups")}</div>`;return;}
  pageSalesGroupList.innerHTML=pageSalesGroups.map(g=>`<label style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee" data-name="${esc(pageGroupLabel(g))}"><input class="pgs-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pgs-group-check",groupPostKey(g),false)}><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
}
function selectedPageSalesGroups(){const keys=new Set([...document.querySelectorAll('.pgs-group-check:checked')].map(b=>b.value));return pageSalesGroups.filter(g=>keys.has(groupPostKey(g)));}
function createPageProductItem(product){
  const id=product.id;
  const num=pageSalesProducts.findIndex(p=>p.id===id)+1||pageSalesProducts.length;
  const item=document.createElement("div");
  item.className="sales-product-item";
  item.style.flexShrink="0";
  item.dataset.pspid=id;
  const isEnabled=product.enabled!==false;
  if(!isEnabled)item.classList.add("sp-disabled");
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  item.innerHTML=`
    <div class="sp-badge">
      <input class="psp-check" type="checkbox" ${isEnabled?"checked":""} title="Tích để đăng sản phẩm này">
      <span class="sp-badge-num">${num}</span> SẢN PHẨM PAGE ${num}
      ${!isEnabled?'<span class="sp-disabled-label">TẮT</span>':""}
    </div>
    <div class="sp-body">
      <div class="sp-name-row">
        <input class="psp-name sp-name" type="text" placeholder="Tên sản phẩm" value="${esc(product.name||"")}" style="flex:1;min-width:0">
        <button class="psp-del sp-del" style="width:auto;flex-shrink:0">✕ Xoá</button>
      </div>
      <div class="sp-fields">
        <div class="sp-field"><label>📝 Thông tin / bài gốc</label><textarea class="psp-source" rows="5" placeholder="Nhập thông tin sản phẩm...">${product.sourceText||""}</textarea></div>
        <div class="sp-field"><label>📌 Ghi chú bán hàng</label><textarea class="psp-info" rows="5" placeholder="Tình trạng, khu vực, giá kỳ vọng...">${product.productInfo||""}</textarea></div>
        <div class="sp-field sp-field-full"><label>🤖 Prompt riêng cho sản phẩm này</label><textarea class="psp-prompt" rows="4" placeholder="Viết bài bán {sourceText} cho {groupName}. {productInfo}">${esc(product.prompt||"")}</textarea></div>
      </div>
      <div class="sp-media-zone">
        <label>📷 Ảnh / Video sản phẩm (tùy chọn, nhiều file)</label>
        <div class="sp-media-mode">
          <button type="button" class="sp-mmode-btn psp-mmode-btn ${(product.mediaMode||"random")==="random"?"active":""}" data-mode="random">🎲 Random</button>
          <button type="button" class="sp-mmode-btn psp-mmode-btn ${(product.mediaMode||"random")==="all"?"active":""}" data-mode="all">📂 Tất cả file</button>
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:6px"><span>${typeof t==="function"?t("sales.mediaRandomCount"):"Số media mỗi nhóm khi Random"}</span><input class="psp-mediacount" type="number" min="1" max="20" step="1" value="${Number(product.mediaCount)||1}" style="width:70px" ${(product.mediaMode||"random")!=="random"?"disabled":""}></label>
        <input class="psp-media-input" type="file" accept="image/*,video/*" multiple>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer"><input class="psp-skipmedia" type="checkbox" ${product.skipMedia?"checked":""}> 🚫 Đăng bài không kèm ảnh (vẫn giữ file đã chọn)</label>
        <div class="psp-media-preview sp-media-preview">Chưa chọn — bài vẫn đăng được</div>
      </div>
    </div>`;
  item.querySelector(".psp-del").onclick=()=>{item.remove();pageSalesProducts=pageSalesProducts.filter(p=>p.id!==id);savePageSalesProducts();};
  item.querySelector(".psp-check").addEventListener("change",function(){
    const enabled=this.checked;
    item.classList.toggle("sp-disabled",!enabled);
    const badge=item.querySelector(".sp-badge");
    let lbl=badge.querySelector(".sp-disabled-label");
    if(!enabled&&!lbl){lbl=document.createElement("span");lbl.className="sp-disabled-label";lbl.textContent="TẮT";badge.appendChild(lbl);}
    else if(enabled&&lbl){lbl.remove();}
    const prod=pageSalesProducts.find(p=>p.id===id);if(prod)prod.enabled=enabled;
    savePageSalesProducts();
  });
  item.querySelector(".psp-name").addEventListener("input",()=>savePageSalesProducts());
  item.querySelector(".psp-source").addEventListener("input",()=>savePageSalesProducts());
  item.querySelector(".psp-info").addEventListener("input",()=>savePageSalesProducts());
  item.querySelector(".psp-prompt").addEventListener("input",()=>savePageSalesProducts());
  const skipCb=item.querySelector(".psp-skipmedia");
  if(skipCb)skipCb.addEventListener("change",function(){
    const prod=pageSalesProducts.find(p=>p.id===id);if(prod)prod.skipMedia=this.checked;
    savePageSalesProducts();
  });
  item.querySelectorAll(".psp-mmode-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      item.querySelectorAll(".psp-mmode-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const prod=pageSalesProducts.find(p=>p.id===id);if(prod)prod.mediaMode=btn.dataset.mode;
      const countInput=item.querySelector(".psp-mediacount");
      if(countInput)countInput.disabled=btn.dataset.mode!=="random";
      savePageSalesProducts();
    });
  });
  const pspCountInput=item.querySelector(".psp-mediacount");
  if(pspCountInput)pspCountInput.addEventListener("change",()=>{
    const prod=pageSalesProducts.find(p=>p.id===id);
    const total=prod?.media?.length||20;
    const next=normalizeSalesMediaCount(pspCountInput.value,total);
    pspCountInput.value=next;
    if(prod)prod.mediaCount=next;
    savePageSalesProducts();
  });
  const fileInput=item.querySelector(".psp-media-input");
  const previewEl=item.querySelector(".psp-media-preview");
  if(product.media&&product.media.length)renderProductMediaPreview(previewEl,product.media);
  fileInput.onchange=async()=>{
    const files=[...(fileInput.files||[])];
    if(!files.length){const prod=pageSalesProducts.find(p=>p.id===id);if(prod)prod.media=[];renderProductMediaPreview(previewEl,[]);savePageSalesProducts();return;}
    const maxBytes=35*1024*1024;
    const invalid=files.find(f=>!/^(image|video)\//i.test(String(f.type||""))||f.size>maxBytes);
    if(invalid){fileInput.value="";previewEl.textContent=invalid.size>maxBytes?`"${invalid.name}" vượt 35 MB`:`"${invalid.name}" không phải ảnh/video`;return;}
    previewEl.textContent=`Đang đọc ${files.length} file...`;
    try{
      const media=[];
      for(const file of files){
        const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
        media.push({name:file.name,type:file.type,size:file.size,dataUrl});
      }
      const prod=pageSalesProducts.find(p=>p.id===id);if(prod)prod.media=media;
      renderProductMediaPreview(previewEl,media);savePageSalesProducts();
    }catch(err){fileInput.value="";previewEl.textContent=`Lỗi đọc file: ${err.message}`;}
  };
  return item;
}
function addPageSalesProduct(product={}){
  const id=product.id||`psp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const prod={id,name:product.name||"",sourceText:product.sourceText||"",productInfo:product.productInfo||"",prompt:product.prompt||SALES_DEFAULT_PROMPT,enabled:product.enabled!==false,mediaMode:product.mediaMode||"random",mediaCount:normalizeSalesMediaCount(product.mediaCount??product.mediaPerGroup??1,Array.isArray(product.media)?product.media.length:20),skipMedia:!!product.skipMedia,media:salesMediaListRaw(product.media)};
  pageSalesProducts.push(prod);
  if(pageSalesProductList)pageSalesProductList.appendChild(createPageProductItem(prod));
  return prod;
}
function pageSalesPageKeyStr(){
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  return pk.replace(/^\/+/,"").replace(/[^a-zA-Z0-9_\-]/g,"_");
}
function savePageSalesProducts(){
  if(!pageSalesProductList)return;
  const safe=pageSalesPageKeyStr();
  if(!safe)return;
  pageSalesProductList.querySelectorAll(".sales-product-item").forEach(item=>{
    const id=item.dataset.pspid,prod=pageSalesProducts.find(p=>p.id===id);
    if(!prod)return;
    const cb=item.querySelector(".psp-check");if(cb)prod.enabled=cb.checked;
    prod.name=item.querySelector(".psp-name")?.value||"";
    prod.sourceText=item.querySelector(".psp-source")?.value||"";
    prod.productInfo=item.querySelector(".psp-info")?.value||"";
    prod.prompt=item.querySelector(".psp-prompt")?.value||"";
    const countEl=item.querySelector(".psp-mediacount");
    if(countEl)prod.mediaCount=normalizeSalesMediaCount(countEl.value,prod?.media?.length||20);
  });
  const metaKey=`pageSalesProductsMeta_${safe}`;
  const mediaKey=`pageSalesProductsMedia_${safe}`;
  const keep=pageSalesProducts.filter(p=>!isBlankSalesProduct(p));
  const meta=keep.map(p=>({id:p.id,name:p.name,sourceText:p.sourceText,productInfo:p.productInfo,prompt:p.prompt||"",enabled:p.enabled!==false,mediaMode:p.mediaMode||"random",mediaCount:normalizeSalesMediaCount(p.mediaCount??1,p?.media?.length||20),skipMedia:!!p.skipMedia}));
  chrome.storage.local.set({[metaKey]:meta}).catch(()=>{});
  const mediaParts=keep.map(p=>({id:p.id,media:p.media||[]}));
  chrome.storage.local.set({[mediaKey]:mediaParts}).catch(()=>{});
}
function savePageSalesPrompt(){
  if(!pageSalesPrompt)return;
  const safe=pageSalesPageKeyStr();
  if(!safe)return;
  chrome.storage.local.set({[`pageSalesPrompt_${safe}`]:pageSalesPrompt.value}).catch(()=>{});
}
async function loadPageSalesPrompt(){
  if(!pageSalesPrompt)return;
  const safe=pageSalesPageKeyStr();
  if(!safe)return;
  const r=await chrome.storage.local.get(`pageSalesPrompt_${safe}`).catch(()=>({}));
  const val=r[`pageSalesPrompt_${safe}`];
  setPromptIf(pageSalesPrompt,val);
}
async function loadPageSalesProducts(){
  const safe=pageSalesPageKeyStr();
  if(!safe){if(!pageSalesProducts.length)addPageSalesProduct();return;}
  const metaKey=`pageSalesProductsMeta_${safe}`;
  const mediaKey=`pageSalesProductsMedia_${safe}`;
  const local=await chrome.storage.local.get([metaKey,mediaKey]).catch(()=>({}));
  const metaList=Array.isArray(local[metaKey])?local[metaKey]:[];
  const mediaMap={};
  if(Array.isArray(local[mediaKey]))local[mediaKey].forEach(entry=>{if(entry?.id)mediaMap[entry.id]=salesMediaListRaw(entry.media);});
  if(metaList.length)metaList.forEach(meta=>{if(meta?.id)addPageSalesProduct({...meta,media:mediaMap[meta.id]||[]});});
  if(!pageSalesProducts.length)addPageSalesProduct();
}
async function renderPageSalesProducts(){
  pageSalesProducts=[];
  if(pageSalesProductList)pageSalesProductList.innerHTML="";
  await loadPageSalesProducts();
}
function selectedPageSalesProducts(){
  return pageSalesProducts.filter(p=>p.enabled!==false&&(p.sourceText||"").trim());
}
async function buildPageSalesConfig(){
  if(!selectedManagedPage)throw new Error(t("pg.needPage"));
  savePageSalesProducts();
  const targetGroups=Math.min(500,Math.max(1,parseInt(pageSalesPostTargetGroups?.value)||1));
  const postsPerGroup=Math.min(100000,Math.max(1,parseInt(pageSalesPostsPerGroup?.value)||1));
  const allGroups=selectedPageSalesGroups();
  const groups=allGroups.slice(0,targetGroups);
  if(!groups.length)throw new Error(t("pgs.needGroups"));
  const picked=selectedPageSalesProducts();
  if(!picked.length)throw new Error(t("pgs.needProducts"));
  const overrideText=pageSalesOverrideText?.value?.trim()||"",overridePrompt=pageSalesOverridePrompt?.value?.trim()||"";
  const skipMedia=!!pageSalesSkipMedia?.checked,modeOverride=pageSalesMediaMode?.value||"per-sp";
  const pageSalesFallback=(pageSalesPrompt?.value||"").trim();
  const fallbackPrompt=pageSalesFallback||(typeof salesPrompt!=="undefined"?salesPrompt.value:"").trim();
  const needsGlobalPrompt=picked.some(p=>!String(overridePrompt||p.prompt||"").trim());
  if(needsGlobalPrompt&&(!fallbackPrompt.includes("{groupName}")||!fallbackPrompt.includes("{sourceText}")||!fallbackPrompt.includes("{productInfo}")))throw new Error(t("pgs.needPrompt"));
  const products=picked.map(p=>{
    const prompt=String(overridePrompt||p.prompt||"").trim()||fallbackPrompt;
    if(!prompt.includes("{groupName}")||!prompt.includes("{sourceText}")||!prompt.includes("{productInfo}"))throw new Error(t("pgs.badPrompt",{name:p.name||p.sourceText.slice(0,20)}));
    const total=p.media?.length||0,mode=modeOverride==="per-sp"?(p.mediaMode||"random"):modeOverride;
    const perGroup=mode==="random"?normalizeSalesMediaCount(p.mediaCount??1,total||20):total;
    return {id:p.id,name:p.name||p.sourceText.slice(0,30),sourceText:(overrideText||p.sourceText).trim(),productInfo:(p.productInfo||"").trim(),prompt,media:{enabled:total>0,count:total,mode,perGroup,skip:skipMedia,manifest:(p.media||[]).map(item=>({name:String(item.name||"media"),type:String(item.type||""),size:Number(item.size)||0}))}};
  });
  const aiConfig=await salesAiConfig("pageSales");
  const _minD=Math.min(604800,Math.max(5,parseInt(pageSalesMinDelay?.value)||30));const _maxD=Math.min(604800,Math.max(_minD,parseInt(pageSalesMaxDelay?.value)||60));
  // mediaKey: content script đọc blob ảnh qua background (salesGetProductMedia);
  // không có key này background chỉ tìm kho nick nên Page sales có ảnh luôn lỗi thiếu media.
  const _mediaKey=`pageSalesProductsMedia_${pageSalesPageKeyStr()}`;
  return {groups:groups.map(g=>({key:groupPostKey(g),url:g.url||`https://www.facebook.com${groupPostKey(g)}/`,name:g.name||""})),products,prompt:fallbackPrompt,postsPerGroup,minDelay:_minD,maxDelay:_maxD,aiConfig,typingConfig:getAiTypingConfig("sales"),styleProfileId:pageSalesStyleProfile?.value||"",mediaKey:_mediaKey};
}
pageSalesReloadGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageSalesStatus)pageSalesStatus.textContent=t("pg.needPage");return;}
  let rows=selectedPageJoinedGroups();
  if(!rows.length)rows=await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]);
  // renderPageSalesGroups đọc từ storage; nếu có lựa chọn từ danh sách trung tâm thì truyền trực tiếp
  if(rows.length){
    const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
    const seen=new Set();
    const uniq=rows.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
    // sync mảng nội bộ để Start đọc được (trước đây chỉ render mà không gán)
    pageSalesGroups=uniq;
    pageSalesGroupList.innerHTML=uniq.map(g=>`<label style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee" data-name="${esc(pageGroupLabel(g))}"><input class="pgs-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pgs-group-check",groupPostKey(g),true)}><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
    if(pageSalesStatus)pageSalesStatus.textContent=t("p.gpLoaded",{n:uniq.length})+" (đã lưu)";
  } else {
    await renderPageSalesGroups();
    if(pageSalesStatus)pageSalesStatus.textContent="Chưa có nhóm — hãy tải danh sách trong phần Tham gia nhóm";
  }
  await renderPageSalesProducts();
};
if(pageSalesSelectAllGroupsBtn)pageSalesSelectAllGroupsBtn.onclick=()=>{const bs=[...pageSalesGroupList.querySelectorAll('.pgs-group-check')];const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);pageSyncTicksFromDOM();};
if(pageSalesAddProductBtn)pageSalesAddProductBtn.onclick=()=>{addPageSalesProduct();savePageSalesProducts();pageSalesProductList?.lastElementChild?.scrollIntoView({behavior:"smooth",block:"nearest"});};
if(pageSalesGroupKeyword)pageSalesGroupKeyword.oninput=()=>{const k=pageSalesGroupKeyword.value.trim().toLocaleLowerCase("vi");pageSalesGroupList.querySelectorAll('label[data-name]').forEach(r=>r.style.display=!k||r.dataset.name.toLocaleLowerCase("vi").includes(k)?"flex":"none");};
if(pageSalesPreviewBtn)pageSalesPreviewBtn.onclick=async()=>{
  pageSalesPreviewBtn.disabled=true;if(pageSalesStatus)pageSalesStatus.textContent="AI đang tạo bài thử — chưa đăng lên Facebook";
  try{
    const cfg=await buildPageSalesConfig();
    const prod=cfg.products[0];
    const response=await chrome.runtime.sendMessage({action:"aiGenerateSalesPost",groupName:cfg.groups[0].name,sourceText:prod.sourceText,productInfo:prod.productInfo,prompt:prod.prompt||cfg.prompt,aiConfig:cfg.aiConfig,styleProfileId:cfg.styleProfileId,variant:1});
    if(!response?.ok)throw new Error(response?.error||"AI không tạo được bài");
    if(pageSalesPreview){pageSalesPreview.textContent=response.content;pageSalesPreview.classList.remove("hidden");}
    if(pageSalesStatus)pageSalesStatus.textContent=`Bài thử "${prod.name||prod.sourceText.slice(0,20)}" — ${response.content.length} ký tự — nhóm: ${cfg.groups[0].name}`;
  }catch(error){if(pageSalesStatus)pageSalesStatus.textContent=`Lỗi tạo bài thử: ${error.message}`;}
  finally{pageSalesPreviewBtn.disabled=false;}
};
if(pageSalesPrompt)pageSalesPrompt.addEventListener("change",()=>savePageSalesPrompt());
if(pageSalesStyleProfile)pageSalesStyleProfile.addEventListener("change",()=>chrome.storage.sync.set({pageSalesStyleProfile:pageSalesStyleProfile.value}));
[pageSalesPostTargetGroups,pageSalesPostsPerGroup,pageSalesMinDelay,pageSalesMaxDelay].filter(Boolean).forEach(el=>el.addEventListener("change",()=>chrome.storage.sync.set({pageSalesPostTargetGroups:pageSalesPostTargetGroups?.value,pageSalesPostsPerGroup:pageSalesPostsPerGroup?.value,pageSalesMinDelay:pageSalesMinDelay?.value,pageSalesMaxDelay:pageSalesMaxDelay?.value})));
pageSalesStartBtn.onclick=async()=>{
  if(pageSalesRunning)return;
  setPageSalesRunning(true);
  try{
    if(!selectedManagedPage)throw new Error(t("pg.needPage"));
    if(await pageFeatureBusy())throw new Error(t("pg.busyOther"));
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const cfg=await buildPageSalesConfig();
    const aiConfig=cfg.aiConfig,runId=`page-sales-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error(t("p.gpNeedKeyModel"));
    const runtimeCfg={...cfg,page:selectedManagedPage,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""}};
    const first=cfg.groups[0];
    const tab=await ensureTaskTab(first.url,pageSalesStatus,t("pgs.running"),url=>pageGroupKeyFromUrl(url)===first.key,async owner=>{await chrome.storage.local.set({pageSalesPostActive:true,pageSalesPostRunId:runId,pageSalesPostOwnerTabId:owner.id,pageSalesPostConfig:{...runtimeCfg,ownerTabId:owner.id},pageSalesPostDone:0,pageSalesPostSkipped:0,pageSalesPostIndex:0,pageSalesPostTotal:cfg.groups.length*cfg.products.length,pageSalesPostStatus:t("pgs.running")});},{actor:"page"});
    if(!tab){setPageSalesRunning(false);await chrome.storage.local.set({pageSalesPostActive:false});return;}
    chrome.tabs.sendMessage(tab.id,{action:"startPageSalesPost",config:runtimeCfg,runId,ownerTabId:tab.id},async res=>{if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startPageSalesPost",config:runtimeCfg,runId,ownerTabId:tab.id},pageSalesStatus);if(retry.ok||await runStillActive("pageSalesPostActive")){pageSalesStatus.textContent=t("pgs.running");return;}setPageSalesRunning(false);return;}if(res?.ok||await runStillActive("pageSalesPostActive"))pageSalesStatus.textContent=t("pgs.running");else{setPageSalesRunning(false);pageSalesStatus.textContent=res?.error||t("pgs.busy");}});
  }catch(error){setPageSalesRunning(false);pageSalesStatus.textContent=error.message;}
};
pageSalesStopBtn.onclick=async()=>{setPageSalesRunning(false);await chrome.storage.local.set({pageSalesPostActive:false,pageSalesPostStatus:t("pgs.stopped")});broadcastToFacebookTabs({action:"stopPageSalesPost"});};
pageSalesResetBtn.onclick=async()=>{setPageSalesRunning(false);await chrome.storage.local.set({pageSalesPostActive:false,pageSalesPostDone:0,pageSalesPostSkipped:0,pageSalesPostIndex:0,pageSalesPostTotal:0,pageSalesPostStatus:t("pgs.resetStatus")});try{pageDatasetClearLast("sales");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }await chrome.storage.local.remove(["pageSalesPostConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetPageSalesPost"});};
const pageCommentStartBtn=$("pageCommentStartBtn"),pageCommentStopBtn=$("pageCommentStopBtn"),pageCommentResetBtn=$("pageCommentResetBtn"),pageCommentStatus=$("pageCommentStatus"),pageCommentCount=$("pageCommentCount");
// ---- Comment AI trong nhóm bằng Page (tính năng mới, state pageGroupComment* riêng) ----
const pageGroupCommentGroupList=$("pageGroupCommentGroupList"),pageGroupCommentPrompt=$("pageGroupCommentPrompt"),pageGroupCommentPerGroup=$("pageGroupCommentPerGroup"),pageGroupCommentMinDelay=$("pageGroupCommentMinDelay"),pageGroupCommentMaxDelay=$("pageGroupCommentMaxDelay"),pageGroupCommentTargetGroups=$("pageGroupCommentTargetGroups");
const pageGroupCommentStartBtn=$("pageGroupCommentStartBtn"),pageGroupCommentStopBtn=$("pageGroupCommentStopBtn"),pageGroupCommentResetBtn=$("pageGroupCommentResetBtn"),pageGroupCommentStatus=$("pageGroupCommentStatus"),pageGroupCommentCount=$("pageGroupCommentCount"),pageGroupCommentReloadGroupsBtn=$("pageGroupCommentReloadGroupsBtn"),pageGroupCommentSelectAllGroupsBtn=$("pageGroupCommentSelectAllBtn");
let pageGroupCommentGroups=[],pageGroupCommentRunning=false;
function setPageGroupCommentRunning(value){pageGroupCommentRunning=!!value;if(pageGroupCommentStartBtn){pageGroupCommentStartBtn.textContent=pageGroupCommentRunning?t("pggc.btnBusy"):t("pggc.start");pageGroupCommentStartBtn.classList.toggle("running",pageGroupCommentRunning);}}
async function renderPageGroupCommentGroups(){
  if(!pageGroupCommentGroupList)return;
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  const rows=selectedManagedPage?await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]):[];
  const seen=new Set();
  pageGroupCommentGroups=(rows||[]).filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  if(!pageGroupCommentGroups.length){pageGroupCommentGroupList.innerHTML=`<div class="hint" style="padding:6px">${t("pggc.noGroups")}</div>`;return;}
  pageGroupCommentGroupList.innerHTML=pageGroupCommentGroups.map(g=>`<label data-name="${esc(pageGroupLabel(g).toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="pggc-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pggc-group-check",groupPostKey(g),false)}><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
}
function selectedPageGroupCommentGroups(){const keys=new Set([...document.querySelectorAll('.pggc-group-check:checked')].map(b=>b.value));return pageGroupCommentGroups.filter(g=>keys.has(groupPostKey(g)));}
pageGroupCommentReloadGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageGroupCommentStatus)pageGroupCommentStatus.textContent=t("pg.needPage");return;}
  let rows=selectedPageJoinedGroups();
  if(!rows.length)rows=await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]);
  if(rows.length){
    const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
    const seen=new Set();
    pageGroupCommentGroups=(rows).filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
    pageGroupCommentGroupList.innerHTML=pageGroupCommentGroups.map(g=>`<label data-name="${esc(pageGroupLabel(g).toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="pggc-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pggc-group-check",groupPostKey(g),true)}><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
    if(pageGroupCommentStatus)pageGroupCommentStatus.textContent=t("p.gpLoaded",{n:pageGroupCommentGroups.length})+" (đã lưu)";
  } else {
    await renderPageGroupCommentGroups();
    if(pageGroupCommentStatus)pageGroupCommentStatus.textContent="Chưa có nhóm — hãy tải danh sách trong phần Tham gia nhóm";
  }
};
pageGroupCommentSelectAllGroupsBtn.onclick=()=>{const bs=[...document.querySelectorAll('.pggc-group-check')];const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);pageSyncTicksFromDOM();};
pageGroupCommentPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageGroupCommentPrompt:pageGroupCommentPrompt.value}));
const pageGroupCommentTagPrompt=$("pageGroupCommentTagPrompt");
if(pageGroupCommentTagPrompt)pageGroupCommentTagPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageGroupCommentTagPrompt:pageGroupCommentTagPrompt.value}));
// Nạp lại cấu hình đã lưu khi mở popup (trước đây chỉ lưu mà không nạp nên
// mở lại là prompt trống → Start luôn báo thiếu {postText}).
chrome.storage.sync.get(["pageGroupCommentPrompt","pageGroupCommentPerGroup","pageGroupCommentMinDelay","pageGroupCommentMaxDelay","pageGroupCommentTargetGroups","pageGroupCommentTagPrompt"],async saved=>{
  try{const r=await selectedPageDatasetPromise();if(r&&r.ds)return;}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  if(saved.pageGroupCommentPrompt!==undefined&&pageGroupCommentPrompt&&!pageGroupCommentPrompt.value)setPromptIf(pageGroupCommentPrompt,saved.pageGroupCommentPrompt);
  if(saved.pageGroupCommentPerGroup!==undefined&&pageGroupCommentPerGroup)pageGroupCommentPerGroup.value=saved.pageGroupCommentPerGroup;
  if(saved.pageGroupCommentMinDelay!==undefined&&pageGroupCommentMinDelay)pageGroupCommentMinDelay.value=saved.pageGroupCommentMinDelay;
  if(saved.pageGroupCommentMaxDelay!==undefined&&pageGroupCommentMaxDelay)pageGroupCommentMaxDelay.value=saved.pageGroupCommentMaxDelay;
  if(saved.pageGroupCommentTargetGroups!==undefined&&pageGroupCommentTargetGroups)pageGroupCommentTargetGroups.value=saved.pageGroupCommentTargetGroups;
  if(saved.pageGroupCommentTagPrompt!==undefined&&pageGroupCommentTagPrompt)setPromptIf(pageGroupCommentTagPrompt,saved.pageGroupCommentTagPrompt);
});
pageGroupCommentStartBtn.onclick=async()=>{
  if(pageGroupCommentRunning)return;
  await tagSectionsReady;
  setPageGroupCommentRunning(true);
  try{
    if(!selectedManagedPage)throw new Error(t("pg.needPage"));
    if(await pageFeatureBusy())throw new Error(t("pg.busyOther"));
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const picked=selectedPageGroupCommentGroups();
    if(!picked.length)throw new Error(t("pggc.needGroups"));
    const limit=Math.max(1,Math.min(picked.length,parseInt(pageGroupCommentTargetGroups.value)||picked.length));
    const groups=picked.slice(0,limit).map(g=>({key:groupPostKey(g),url:g.url||`https://www.facebook.com${groupPostKey(g)}/`,name:g.name||""}));
    const perGroup=Math.max(1,Math.min(100000,parseInt(pageGroupCommentPerGroup.value)||3));
    const minDelay=Math.min(604800,Math.max(5,parseInt(pageGroupCommentMinDelay.value)||20));
    const maxDelay=Math.min(604800,Math.max(minDelay,parseInt(pageGroupCommentMaxDelay.value)||45));
    const prompt=pageGroupCommentPrompt.value.trim();
    if(!prompt.includes("{postText}"))throw new Error(t("pggc.needPostText"));
    const aiConfig=await getAiProfileFor("pageGroupComment"),runId=`page-gcomment-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error(t("p.gpNeedKeyModel"));
    const tagOn=!!document.getElementById("pageGroupCommentTagEnabled")?.checked;
    if(tagOn&&tagSections["pageGroupComment"]?.isResolving?.()){
      setPageGroupCommentRunning(false);
      pageGroupCommentStatus.textContent="Đang lấy tên tag, đợi hoàn tất rồi bấm Bắt đầu lại.";
      return;
    }
    const tagConfig=tagSections["pageGroupComment"]?.getTagConfig(tagOn)||null;
    let pgcTagPrompt=String(pageGroupCommentTagPrompt?.value||"").trim();
    if(tagOn&&!pgcTagPrompt.includes("{tagName}")){
      pgcTagPrompt=t("fd.aiTagPromptDefault");
      if(pageGroupCommentTagPrompt)pageGroupCommentTagPrompt.value=pgcTagPrompt;
      chrome.storage.sync.set({pageGroupCommentTagPrompt:pgcTagPrompt}).catch(()=>{});
    }
    if(tagConfig)tagConfig.tagPrompt=tagOn?pgcTagPrompt:"";
    const cfg={page:selectedManagedPage,groups,perGroup,minDelay,maxDelay,prompt,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""},typingConfig:getAiTypingConfig("pageGroupComment"),tagConfig,done:0,skipped:0,index:0,runId};
    await chrome.storage.sync.set({pageSelected:selectedManagedPage,pageGroupCommentPrompt:prompt,pageGroupCommentTagPrompt:tagOn?pgcTagPrompt:(String(pageGroupCommentTagPrompt?.value||"")),pageGroupCommentPerGroup:perGroup,pageGroupCommentMinDelay:minDelay,pageGroupCommentMaxDelay:maxDelay});
    const first=groups[0];
    const tab=await ensureTaskTab(first.url,pageGroupCommentStatus,t("pggc.running"),url=>pageGroupKeyFromUrl(url)===first.key,async owner=>{await chrome.storage.local.set({pageGroupCommentActive:true,pageGroupCommentRunId:runId,pageGroupCommentOwnerTabId:owner.id,pageGroupCommentConfig:{...cfg,ownerTabId:owner.id},pageGroupCommentDone:0,pageGroupCommentSkipped:0,pageGroupCommentIndex:0,pageGroupCommentGroupDone:0,pageGroupCommentStatus:t("pggc.running")});},{actor:"page"});
    if(!tab){setPageGroupCommentRunning(false);await chrome.storage.local.set({pageGroupCommentActive:false});return;}
    chrome.tabs.sendMessage(tab.id,{action:"startPageGroupComment",config:cfg,runId,ownerTabId:tab.id},async res=>{if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startPageGroupComment",config:cfg,runId,ownerTabId:tab.id},pageGroupCommentStatus);if(retry.ok||await runStillActive("pageGroupCommentActive")){pageGroupCommentStatus.textContent=t("pggc.running");return;}setPageGroupCommentRunning(false);return;}if(res?.ok||await runStillActive("pageGroupCommentActive"))pageGroupCommentStatus.textContent=t("pggc.running");else{setPageGroupCommentRunning(false);pageGroupCommentStatus.textContent=res?.error||t("pggc.busy");}});
  }catch(error){setPageGroupCommentRunning(false);pageGroupCommentStatus.textContent=error.message;}
};
pageGroupCommentStopBtn.onclick=async()=>{setPageGroupCommentRunning(false);await chrome.storage.local.set({pageGroupCommentActive:false,pageGroupCommentStatus:t("pggc.stopped")});broadcastToFacebookTabs({action:"stopPageGroupComment"});};
pageGroupCommentResetBtn.onclick=async()=>{setPageGroupCommentRunning(false);await chrome.storage.local.set({pageGroupCommentActive:false,pageGroupCommentDone:0,pageGroupCommentSkipped:0,pageGroupCommentIndex:0,pageGroupCommentGroupDone:0,pageGroupCommentStatus:t("pggc.resetStatus")});try{pageDatasetClearLast("gcomment");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }await chrome.storage.local.remove(["pageGroupCommentConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetPageGroupComment"});};
// Scan buttons in pgp / pgs / pggc cards — triggers same scan as Tham gia nhóm
const scanPagePostGroupsBtn=$("scanPagePostGroupsBtn");
if(scanPagePostGroupsBtn)scanPagePostGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){pageGroupPostStatus.textContent=t("pg.needPage");return;}
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  scanPagePostGroupsBtn.disabled=true;
  const result=await requestJoinedGroupsScan(pageGroupPostStatus,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}),"__page__",pk,selectedManagedPage);
  scanPagePostGroupsBtn.disabled=false;
  await renderPageJoinSavedList();
  const groups=result?.groups||[];
  if(groups.length){renderPagePostGroups(groups);await renderPageSalesGroups();await renderPageGroupCommentGroups();}
  else if(result?.error)pageGroupPostStatus.textContent=result.error;
};
const scanPageSalesGroupsBtn=$("scanPageSalesGroupsBtn");
if(scanPageSalesGroupsBtn)scanPageSalesGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageSalesStatus)pageSalesStatus.textContent=t("pg.needPage");return;}
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  scanPageSalesGroupsBtn.disabled=true;
  const result=await requestJoinedGroupsScan(pageSalesStatus,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}),"__page__",pk,selectedManagedPage);
  scanPageSalesGroupsBtn.disabled=false;
  await renderPageJoinSavedList();
  const groups=result?.groups||[];
  if(groups.length){renderPagePostGroups(groups);await renderPageSalesGroups();await renderPageGroupCommentGroups();}
  else if(result?.error&&pageSalesStatus)pageSalesStatus.textContent=result.error;
};
const scanPageGroupCommentGroupsBtn=$("scanPageGroupCommentGroupsBtn");
if(scanPageGroupCommentGroupsBtn)scanPageGroupCommentGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageGroupCommentStatus)pageGroupCommentStatus.textContent=t("pg.needPage");return;}
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  scanPageGroupCommentGroupsBtn.disabled=true;
  const result=await requestJoinedGroupsScan(pageGroupCommentStatus,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}),"__page__",pk,selectedManagedPage);
  scanPageGroupCommentGroupsBtn.disabled=false;
  await renderPageJoinSavedList();
  const groups=result?.groups||[];
  if(groups.length){renderPagePostGroups(groups);await renderPageSalesGroups();await renderPageGroupCommentGroups();}
  else if(result?.error&&pageGroupCommentStatus)pageGroupCommentStatus.textContent=result.error;
};
// pgc group section (hiện khi source="groups")
let pageCommentGroups=[];
const pageCommentGroupSection=$("pageCommentGroupSection"),pageCommentGroupList=$("pageCommentGroupList"),pageCommentGroupKeyword=$("pageCommentGroupKeyword"),pageCommentGroupLogFilter=$("pageCommentGroupLogFilter");
  const pageCommentGroupLoadFromLogBtn=$("pageCommentGroupLoadFromLogBtn"),scanPageCommentGroupsBtn=$("scanPageCommentGroupsBtn"),pageCommentReloadGroupsBtn=$("pageCommentReloadGroupsBtn"),pageCommentSelectAllGroupsBtn=$("pageCommentSelectAllGroupsBtn");
if(pageCommentGroupLoadFromLogBtn)pageCommentGroupLoadFromLogBtn.onclick=async()=>{
  // Nút Nạp log của Page Comment từng không có handler (bấm không hiện gì).
  if(!selectedManagedPage||!pageCommentGroupList)return;
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const r=await chrome.storage.local.get("pageSavedGroups");
  const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
  let groups=Array.isArray(all[pk])?all[pk]:[];
  const kw=(pageCommentGroupLogFilter?.value||"").trim();
  if(kw)groups=groups.filter(g=>(g.keyword||"").trim()===kw);
  await renderPageCommentGroups(groups);
  if(pageCommentStatus)pageCommentStatus.textContent=`✅ Nạp ${pageCommentGroups.length} nhóm từ log${kw?` · "${kw}"`:""}`;
};
async function renderPageCommentGroups(rows){
  if(!pageCommentGroupList)return;
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  if(!rows?.length){pageCommentGroupList.innerHTML=`<div class="hint" style="padding:6px">Chưa có nhóm — bấm Tải danh sách nhóm</div>`;pageCommentGroups=[];return;}
  const seen=new Set();
  pageCommentGroups=rows.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  pageCommentGroupList.innerHTML=pageCommentGroups.map(g=>`<label style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee" data-name="${esc(g.name)}"><input class="pgc-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pgc-group-check",groupPostKey(g),true)}><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
}
function selectedPageCommentGroups(){const keys=new Set([...document.querySelectorAll('.pgc-group-check:checked')].map(b=>b.value));return pageCommentGroups.filter(g=>keys.has(groupPostKey(g)));}
function togglePageCommentGroupSection(){if(pageCommentGroupSection)pageCommentGroupSection.style.display=pageCommentSource?.value==="groups"?"block":"none";}
if(scanPageCommentGroupsBtn)scanPageCommentGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageCommentStatus)pageCommentStatus.textContent=t("pg.needPage");return;}
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  scanPageCommentGroupsBtn.disabled=true;
  const result=await requestJoinedGroupsScan(null,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}),"__page__",pk,selectedManagedPage);
  scanPageCommentGroupsBtn.disabled=false;
  await renderPageJoinSavedList();
  const groups=result?.groups||[];
  if(groups.length){await renderPageCommentGroups(groups);renderPagePostGroups(groups);await renderPageSalesGroups();await renderPageGroupCommentGroups();}
  else if(result?.error&&pageCommentStatus)pageCommentStatus.textContent=result.error;
};
if(pageCommentReloadGroupsBtn)pageCommentReloadGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageCommentStatus)pageCommentStatus.textContent=t("pg.needPage");return;}
  let rows=selectedPageJoinedGroups();
  if(!rows.length)rows=await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]);
  if(rows.length){await renderPageCommentGroups(rows);}
  else{await renderPageCommentGroups([]);if(pageCommentStatus)pageCommentStatus.textContent="Chưa có nhóm — hãy tải danh sách trong phần Tham gia nhóm";}
};
if(pageCommentSelectAllGroupsBtn)pageCommentSelectAllGroupsBtn.onclick=()=>{const bs=[...document.querySelectorAll('.pgc-group-check')];const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);pageSyncTicksFromDOM();};
if(pageCommentGroupKeyword)pageCommentGroupKeyword.oninput=()=>{const k=pageCommentGroupKeyword.value.trim().toLocaleLowerCase("vi");document.querySelectorAll('#pageCommentGroupList label[data-name]').forEach(r=>r.style.display=!k||r.dataset.name.toLocaleLowerCase("vi").includes(k)?"flex":"none");};
let pagePostRunning=false,pageCommentRunning=false;
function setPageCommentRunning(value){pageCommentRunning=!!value;if(pageCommentStartBtn){pageCommentStartBtn.textContent=pageCommentRunning?t("pgc.btnBusy"):t("pgc.start");pageCommentStartBtn.classList.toggle("running",pageCommentRunning);}}
function setPagePostRunning(value){pagePostRunning=!!value;if(pageGroupPostStartBtn){pageGroupPostStartBtn.textContent=pagePostRunning?t("pgp.btnBusy"):t("pgp.start");pageGroupPostStartBtn.classList.toggle("running",pagePostRunning);}}
function pageParseLines(value){return String(value||"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const [url,...nameParts]=line.split("|");return {url:canonicalFacebookUrl(url.trim()),name:nameParts.join("|").trim()};}).filter(row=>row.url);}
function canonicalFacebookUrl(value){try{const u=new URL(String(value||""));if(!(u.hostname==="facebook.com"||u.hostname.endsWith(".facebook.com")))return "";u.hash="";["ref","refid","__tn__","__cft__","mibextid","locale"].forEach(k=>u.searchParams.delete(k));return u.toString().replace(/\/$/,"");}catch{return "";}}
function pageGroupKeyFromUrl(value){try{const u=new URL(value);const m=u.pathname.match(/^\/groups\/([^/?#]+)/i);return m?`/groups/${String(m[1]).toLowerCase()}`:"";}catch{return "";}}
async function pageGroupPostTargets(){
  const picked=selectedPagePostGroups();
  if(picked.length)return picked.map(g=>({key:groupPostKey(g),url:g.url||`https://www.facebook.com${groupPostKey(g)}/`,name:g.name||""}));
  // fallback: danh sách đã lưu của Page đang chọn
  const rows=selectedManagedPage?await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]):[];
  const seen=new Set();
  return rows.filter(g=>{const k=groupPostKey(g);return k&&!seen.has(k)&&seen.add(k);}).map(g=>({key:groupPostKey(g),url:g.url||`https://www.facebook.com${groupPostKey(g)}/`,name:g.name||""}));
}
async function pageFeatureBusy(){
    const state=await chrome.storage.local.get(["isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageNewsWallActive","pageCommentActive","pageSalesPostActive","pageGroupCommentActive"]);
  return Object.values(state).some(Boolean);
}
function pageStoreMessage(message){return new Promise(resolve=>chrome.runtime.sendMessage(message,response=>resolve(response||{ok:false})));}

pageGroupPostPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageGroupPostPrompt:pageGroupPostPrompt.value}));
pageGroupPostTarget.addEventListener("change",()=>chrome.storage.sync.set({pageGroupPostTarget:pageGroupPostTarget.value}));
pageGroupPostMinDelay.addEventListener("change",()=>chrome.storage.sync.set({pageGroupPostMinDelay:pageGroupPostMinDelay.value}));
pageGroupPostMaxDelay.addEventListener("change",()=>chrome.storage.sync.set({pageGroupPostMaxDelay:pageGroupPostMaxDelay.value}));

function renderPagePostGroups(groups){
  const seen=new Set();
  pagePostGroups=(groups||[]).filter(g=>{const key=groupPostKey(g);if(!key||seen.has(key))return false;seen.add(key);return true;});
  if(!pagePostGroups.length){pageGroupPostList.innerHTML='<div class="hint" style="padding:6px">'+t("sh.noGroups")+'</div>';return;}
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  pageGroupPostList.innerHTML=pagePostGroups.map(g=>`<label data-key="${esc(groupPostKey(g))}" data-name="${esc(pageGroupLabel(g).toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="pgp-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pgp-group-check",groupPostKey(g),false)}><img src="${esc(g.icon||"icon128.png")}" style="width:30px;height:30px;border-radius:50%;object-fit:cover"><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
}
function selectedPagePostGroups(){const keys=new Set([...pageGroupPostList.querySelectorAll('.pgp-group-check:checked')].map(b=>b.value));return pagePostGroups.filter(g=>keys.has(groupPostKey(g)));}
// Danh sách nhóm đã lưu theo Page (dùng chung Đăng bài / Comment nhóm /
// Đăng bán): đọc registry pageSavedGroups; lần đầu migrate từ lịch sử join
// confirmed + cache scan cũ. Đổi Page → hiện đúng danh sách của Page đó.
async function ensurePageSavedGroups(page) {
  const pk = String(pageKeyForPopup(page) || "").toLowerCase();
  if (!pk) return [];
  const cacheKey = `pageJoinedGroups_${pk.replace(/^\/+/, "").replace(/[^a-zA-Z0-9_\-]/g, "_")}`;
  const stored = await chrome.storage.local.get(["pageSavedGroups", "pageGroupJoinHistory", cacheKey]).catch(() => ({}));
  const all = stored.pageSavedGroups && typeof stored.pageSavedGroups === "object" ? stored.pageSavedGroups : {};
  if (Array.isArray(all[pk]) && all[pk].length) return all[pk];
  const rows = [];
  const push = (g, source) => {
    let gk = String(g?.key || g?.groupKey || "").toLowerCase();
    if (!/^\/groups\//i.test(gk)) {
      try {
        const m = new URL(String(g?.url || ""), "https://www.facebook.com").pathname.match(/^\/groups\/([^/?#]+)/i);
        gk = m ? `/groups/${String(m[1]).toLowerCase()}` : "";
      } catch (_) { gk = ""; }
    }
    if (!gk || rows.some(r => r.key === gk)) return;
    rows.push({ key: gk, url: g.url || `https://www.facebook.com${gk}/`, name: g.name || "", at: g.at || 0, source });
  };
  (Array.isArray(stored.pageGroupJoinHistory) ? stored.pageGroupJoinHistory : [])
    .filter(h => h.status === "confirmed" && String(h.pageKey || "").toLowerCase() === pk)
    .forEach(h => push(h, "join"));
  (Array.isArray(stored[cacheKey]) ? stored[cacheKey] : []).forEach(g => push(g, "scan"));
  if (rows.length) {
    const next = { ...all, [pk]: rows.slice(-500) };
    chrome.storage.local.set({ pageSavedGroups: next }).catch(() => {});
    return next[pk];
  }
  return [];
}
// Auto-load cache khi chọn Page
async function loadPagePostGroupsFromCache(){
  if(!selectedManagedPage)return;
  const rows=await ensurePageSavedGroups(selectedManagedPage);
  if(rows.length>0){
    renderPagePostGroups(rows);
    pageGroupPostStatus.textContent=t("p.gpLoaded",{n:rows.length})+" (đã lưu)";
  } else {
    renderPagePostGroups([]);
    pageGroupPostStatus.textContent="Chưa có nhóm đã lưu. Hãy bấm 'Tải danh sách'.";
  }
}

// ---- Danh sách nhóm trung tâm của Page ----
const pageSavedGroupsEmpty=$("pageSavedGroupsEmpty"),pageSavedGroupsContent=$("pageSavedGroupsContent");
async function renderPageSavedGroupsList(){
  if(!pageSavedGroupsList)return;
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  const rows=selectedManagedPage?await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]):[];
  const seen=new Set();
  pageSavedGroupsAll=(rows||[]).filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  if(!pageSavedGroupsAll.length){
    if(pageSavedGroupsEmpty)pageSavedGroupsEmpty.style.display="";
    if(pageSavedGroupsContent)pageSavedGroupsContent.style.display="none";
    if(pageSavedGroupsCount)pageSavedGroupsCount.textContent="";
    return;
  }
  if(pageSavedGroupsEmpty)pageSavedGroupsEmpty.style.display="none";
  if(pageSavedGroupsContent)pageSavedGroupsContent.style.display="";
  if(pageSavedGroupsCount)pageSavedGroupsCount.textContent=`${pageSavedGroupsAll.length} nhóm đã lưu`;
  pageSavedGroupsList.innerHTML=pageSavedGroupsAll.map(g=>`<label style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee" data-name="${esc(pageGroupLabel(g))}"><input class="psg-group-check" type="checkbox" value="${esc(groupPostKey(g))}" style="width:auto" checked><span style="font-size:12px">${esc(pageGroupLabel(g))}</span></label>`).join("");
}
if(loadPageSavedGroupsBtn)loadPageSavedGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageSavedGroupsStatus)pageSavedGroupsStatus.textContent=t("pg.needPage");return;}
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const result=await requestJoinedGroupsScan(pageSavedGroupsStatus,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}),"__page__",pk,selectedManagedPage);
  if(result?.ok){
    await renderPageSavedGroupsList();
    renderPagePostGroups(result.groups||[]);
    await renderPageSalesGroups();
    await renderPageGroupCommentGroups();
  } else {
    if(result?.error&&pageSavedGroupsStatus)pageSavedGroupsStatus.textContent=result.error;
  }
};
if(selectAllPageSavedGroupsBtn)selectAllPageSavedGroupsBtn.onclick=()=>{const bs=[...pageSavedGroupsList.querySelectorAll('.psg-group-check')];const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);};
if(pageSavedGroupsKeyword)pageSavedGroupsKeyword.oninput=()=>{const k=pageSavedGroupsKeyword.value.trim().toLocaleLowerCase("vi");pageSavedGroupsList.querySelectorAll('label[data-name]').forEach(r=>r.style.display=!k||r.dataset.name.toLocaleLowerCase("vi").includes(k)?"flex":"none");};

// ---- Nhóm đã lưu trong card Tham gia nhóm (dùng chung cho tất cả tính năng Page) ----
const _pjEsc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
// Tên hiển thị nhóm Page: ưu tiên tên thật; tên rỗng hoặc lẫn URL thì suy từ
// key (/groups/slug → "slug", /groups/id số → "Nhóm id"), cuối cùng mới hiện URL.
function pageGroupLabel(g){
  const n=String(g?.name||"").trim();
  if(n&&!/^https?:\/\//i.test(n))return n;
  const m=String(g?.key||"").match(/^\/groups\/([^/?#]+)/i);
  if(m&&m[1]){
    if(/^\d+$/.test(m[1]))return "Nhóm "+m[1];
    const slug=m[1].replace(/[-_.]+/g," ").trim();
    if(slug)return slug;
  }
  return n;
}

function updatePageJoinLogFilter(){
  if(!pageJoinLogFilter||!selectedManagedPage)return;
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  chrome.storage.local.get("pageSavedGroups",r=>{
    const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
    const groups=Array.isArray(all[pk])?all[pk]:[];
    const kwCount={};
    groups.forEach(g=>{const k=(g.keyword||"").trim();if(k)kwCount[k]=(kwCount[k]||0)+1;});
    const keywords=Object.keys(kwCount).sort();
    const prev=pageJoinLogFilter.value;
    pageJoinLogFilter.innerHTML='<option value="">-- Tất cả ('+groups.length+' nhóm) --</option>'+
      keywords.map(k=>`<option value="${_pjEsc(k)}">${_pjEsc(k)} (${kwCount[k]})</option>`).join('');
    if(keywords.includes(prev))pageJoinLogFilter.value=prev;
  });
}

// Populate keyword dropdown cho 3 tính năng Page (đọc từ pageSavedGroups như Nạp log nhóm nick cá nhân)
function updatePageFeatureLogFilters(){
  if(!selectedManagedPage)return;
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  chrome.storage.local.get("pageSavedGroups",r=>{
    const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
    const groups=Array.isArray(all[pk])?all[pk]:[];
    const kwCount={};
    groups.forEach(g=>{const k=(g.keyword||"").trim();if(k)kwCount[k]=(kwCount[k]||0)+1;});
    const keywords=Object.keys(kwCount).sort();
    const opts='<option value="">-- Tất cả ('+groups.length+' nhóm) --</option>'+
      keywords.map(k=>`<option value="${_pjEsc(k)}">${_pjEsc(k)} (${kwCount[k]})</option>`).join('');
    [pagePostLogFilter,pageSalesLogFilter,pageGroupCommentLogFilter].forEach(sel=>{
      if(!sel)return;
      const prev=sel.value;
      sel.innerHTML=opts;
      if(keywords.includes(prev))sel.value=prev;
    });
  });
}

// Helper: lấy nhóm từ pageSavedGroups lọc theo keyword, render vào list với checkbox checked
async function applyPageLogToList(filterSel, listEl, checkClass, statusEl){
  if(!selectedManagedPage||!listEl)return;
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const r=await chrome.storage.local.get("pageSavedGroups");
  const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
  let groups=Array.isArray(all[pk])?all[pk]:[];
  const kw=(filterSel?.value||"").trim();
  if(kw)groups=groups.filter(g=>(g.keyword||"").trim()===kw);
  const seen=new Set();
  const uniq=groups.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  // Nạp log là tải mới: xoá tick chọn cũ của list này để render mặc định
  // check hết (tick cũ còn sót khiến Nạp log chỉ check một phần — user tưởng
  // "chọn tất cả" hỏng). Tải lại/dataset vẫn giữ tick như cũ.
  try{const _tl=(typeof PAGE_TICK_CLASS_MAP!=="undefined"&&PAGE_TICK_CLASS_MAP[checkClass])||"";if(_tl&&typeof pagePendingTicks!=="undefined")pagePendingTicks[_tl]=null;}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  listEl.innerHTML=uniq.length
    ?uniq.map(g=>`<label data-name="${_pjEsc((pageGroupLabel(g)||"").toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="${checkClass}" type="checkbox" value="${_pjEsc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass(checkClass,groupPostKey(g),true)}><span style="font-size:12px">${_pjEsc(pageGroupLabel(g)||g.url||"")}</span></label>`).join("")
    :'<div class="hint" style="padding:6px">Không có nhóm nào</div>';
  if(statusEl)statusEl.textContent=`✅ Nạp ${uniq.length} nhóm từ log${kw?` · "${kw}"`:""}`;
}

async function applyPageJoinLog(){
  if(!selectedManagedPage||!pageJoinSavedList)return;
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const r=await chrome.storage.local.get("pageSavedGroups");
  const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
  let groups=Array.isArray(all[pk])?all[pk]:[];
  const kw=(pageJoinLogFilter?.value||"").trim();
  if(kw)groups=groups.filter(g=>(g.keyword||"").trim()===kw);
  const seen=new Set();
  const uniq=groups.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  try{if(typeof pagePendingTicks!=="undefined")pagePendingTicks.join=null;}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  if(pageJoinSavedCount)pageJoinSavedCount.textContent=`${uniq.length} nhóm${kw?` · "${kw}"`:""}`;
  pageJoinSavedList.innerHTML=uniq.length
    ?uniq.map(g=>`<label style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="pjs-group-check" type="checkbox" value="${_pjEsc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pjs-group-check",groupPostKey(g),true)}><span style="font-size:12px">${_pjEsc(pageGroupLabel(g)||g.url||"")}</span></label>`).join("")
    :'<div class="hint" style="padding:6px">Không có nhóm nào</div>';
}

async function renderPageJoinSavedList(){
  if(!pageJoinSavedList)return;
  if(!selectedManagedPage){
    pageJoinSavedList.innerHTML='<div class="hint" style="padding:6px">Chọn Page trước</div>';
    if(pageJoinSavedCount)pageJoinSavedCount.textContent="";
    return;
  }
  const rows=await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]);
  updatePageJoinLogFilter();
  updatePageFeatureLogFilters();
  // Cập nhật pageSavedGroupsAll để selectedPageJoinedGroups() đọc được đủ field
  const seenAll=new Set();
  pageSavedGroupsAll=(rows||[]).filter(g=>{const k=groupPostKey(g);if(!k||seenAll.has(k))return false;seenAll.add(k);return true;});
  if(!pageSavedGroupsAll.length){
    pageJoinSavedList.innerHTML='<div class="hint" style="padding:6px">Chưa có nhóm — bấm Tải danh sách hoặc Quét từ Facebook</div>';
    if(pageJoinSavedCount)pageJoinSavedCount.textContent="";
    return;
  }
  const kw=(pageJoinSavedKeyword?.value||"").trim().toLocaleLowerCase("vi");
  const filtered=kw?pageSavedGroupsAll.filter(g=>(g.name||"").toLocaleLowerCase("vi").includes(kw)):pageSavedGroupsAll;
  if(pageJoinSavedCount)pageJoinSavedCount.textContent=`${filtered.length}/${pageSavedGroupsAll.length} nhóm đã lưu`;
  pageJoinSavedList.innerHTML=filtered.length
    ?filtered.map(g=>`<label style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="pjs-group-check" type="checkbox" value="${_pjEsc(groupPostKey(g))}" style="width:auto" ${pageTickAttrByClass("pjs-group-check",groupPostKey(g),true)}><span style="font-size:12px">${_pjEsc(pageGroupLabel(g)||g.url||"")}</span></label>`).join("")
    :'<div class="hint" style="padding:6px">Không tìm thấy nhóm nào</div>';
}

// Đọc các nhóm đang được tích trong danh sách trung tâm (dùng cho feature "Dùng nhóm đã lưu")
function selectedPageJoinedGroups(){
  if(!pageJoinSavedList)return[];
  const all=pageSavedGroupsAll.length?pageSavedGroupsAll:[];
  const checked=new Set([...pageJoinSavedList.querySelectorAll('.pjs-group-check:checked')].map(cb=>cb.value));
  if(!checked.size)return[];
  // Dùng array gốc để giữ đủ field (url, name, key)
  const rowMap=new Map();
  all.forEach(g=>{const k=groupPostKey(g);if(k)rowMap.set(k,g);});
  return [...checked].map(k=>rowMap.get(k)||{key:k,url:`https://www.facebook.com${k}/`,name:k}).filter(Boolean);
}

if(pageJoinLoadSavedBtn)pageJoinLoadSavedBtn.onclick=async()=>renderPageJoinSavedList();
if(pageJoinSavedKeyword)pageJoinSavedKeyword.oninput=()=>renderPageJoinSavedList();
if(pageJoinSelectAllBtn)pageJoinSelectAllBtn.onclick=()=>{const bs=[...pageJoinSavedList.querySelectorAll('.pjs-group-check')];const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);pageSyncTicksFromDOM();};
if(pageJoinPickKeywordBtn)pageJoinPickKeywordBtn.onclick=()=>{
  const kw=(pageJoinSavedKeyword?.value||"").trim().toLocaleLowerCase("vi");
  if(!kw)return;
  pageJoinSavedList.querySelectorAll('label[style]').forEach(el=>{
    const span=el.querySelector('span');
    const cb=el.querySelector('input');
    if(span&&cb)cb.checked=(span.textContent||"").toLocaleLowerCase("vi").includes(kw);
  });
  pageSyncTicksFromDOM();
};
if(pageJoinLoadFromLogBtn)pageJoinLoadFromLogBtn.onclick=()=>applyPageJoinLog();
if(pagePostLoadFromLogBtn)pagePostLoadFromLogBtn.onclick=async()=>{
  await applyPageLogToList(pagePostLogFilter,pageGroupPostList,"pgp-group-check",pagePostGroupsHint);
  // sync pagePostGroups để selectedPagePostGroups() đọc được
  // Dùng pageKeyForPopup để khớp registry pageSavedGroups (id/username thô
  // thiếu slash đầu + sai case nên lookup luôn rỗng, làm mất lọc keyword).
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const r=await chrome.storage.local.get("pageSavedGroups");
  const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
  let groups=Array.isArray(all[pk])?all[pk]:[];
  const kw=(pagePostLogFilter?.value||"").trim();
  if(kw)groups=groups.filter(g=>(g.keyword||"").trim()===kw);
  const seen=new Set();
  pagePostGroups=groups.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
};
if(pageSalesLoadFromLogBtn)pageSalesLoadFromLogBtn.onclick=async()=>{
  await applyPageLogToList(pageSalesLogFilter,pageSalesGroupList,"pgs-group-check",pageSalesStatus);
  // sync pageSalesGroups cho Start dùng (cùng lỗi như Page Post/Comment nhóm:
  // chỉ render checkbox mà không sync mảng nội bộ thì Start luôn báo thiếu nhóm)
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const r=await chrome.storage.local.get("pageSavedGroups");
  const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
  let groups=Array.isArray(all[pk])?all[pk]:[];
  const kw=(pageSalesLogFilter?.value||"").trim();
  if(kw)groups=groups.filter(g=>(g.keyword||"").trim()===kw);
  const seen=new Set();
  pageSalesGroups=groups.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
};
if(pageGroupCommentLoadFromLogBtn)pageGroupCommentLoadFromLogBtn.onclick=async()=>{
  await applyPageLogToList(pageGroupCommentLogFilter,pageGroupCommentGroupList,"pggc-group-check",pageGroupCommentStatus);
  // sync pageGroupCommentGroups cho startBtn dùng (cùng lý do như trên)
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  const r=await chrome.storage.local.get("pageSavedGroups");
  const all=r.pageSavedGroups&&typeof r.pageSavedGroups==="object"?r.pageSavedGroups:{};
  let groups=Array.isArray(all[pk])?all[pk]:[];
  const kw=(pageGroupCommentLogFilter?.value||"").trim();
  if(kw)groups=groups.filter(g=>(g.keyword||"").trim()===kw);
  const seen=new Set();
  pageGroupCommentGroups=groups.filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
};
if(pageJoinScanGroupsBtn)pageJoinScanGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageJoinSavedCount)pageJoinSavedCount.textContent=t("pg.needPage");return;}
  // pageKeyForPopup để storage key khớp với ensurePageSavedGroups/render list;
  // id thô ghi nhầm key khác khiến quét xong list vẫn cũ/trống.
  const pk=pageKeyForPopup(selectedManagedPage)||"";
  pageJoinScanGroupsBtn.disabled=true;
  const result=await requestJoinedGroupsScan(pageJoinSavedCount,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}),"__page__",pk,selectedManagedPage);
  pageJoinScanGroupsBtn.disabled=false;
  await renderPageJoinSavedList();
  const groups=result?.groups||[];
  if(groups.length){
    renderPagePostGroups(groups);
    await renderPageSalesGroups();
    await renderPageGroupCommentGroups();
  } else if(result?.error&&pageJoinSavedCount){
    pageJoinSavedCount.textContent=result.error;
  }
};
// Lấy tên thật cho các nhóm đang lưu thiếu tên (hiện URL/slug): mở từng trang
// nhóm ở tab nền qua background rồi ghi lại registry, tối đa 50 nhóm/lượt.
const pageJoinFetchNamesBtn=$("pageJoinFetchNamesBtn");
if(pageJoinFetchNamesBtn)pageJoinFetchNamesBtn.onclick=async()=>{
  if(!selectedManagedPage){if(pageJoinSavedCount)pageJoinSavedCount.textContent=t("pg.fetchNamesNeedPage");return;}
  pageJoinFetchNamesBtn.disabled=true;
  const baseLabel=t("pg.fetchNames");
  try{
    const rows=await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]);
    const need=rows.filter(g=>{const n=String(g?.name||"").trim();return (!n||/^https?:\/\//i.test(n))&&String(g?.url||"").includes("facebook.com");}).slice(0,50);
    if(!need.length){pageJoinFetchNamesBtn.textContent=t("pg.fetchNamesNone");setTimeout(()=>{pageJoinFetchNamesBtn.textContent=baseLabel;},2000);return;}
    let done=0;
    for(let i=0;i<need.length;i++){
      pageJoinFetchNamesBtn.textContent=`⏳ ${i+1}/${need.length}…`;
      try{
        const res=await chrome.runtime.sendMessage({action:"fetchFbEntityName",url:need[i].url});
        const name=String(res?.name||"").trim();
        if(res?.ok&&name&&!/^https?:\/\//i.test(name)){need[i].name=name;done++;}
      }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    }
    if(done){
      const pk=String(pageKeyForPopup(selectedManagedPage)||"").toLowerCase();
      const s=await chrome.storage.local.get(["pageSavedGroups"]);
      const all=s.pageSavedGroups&&typeof s.pageSavedGroups==="object"?s.pageSavedGroups:{};
      if(Array.isArray(all[pk])){
        const byKey={};
        need.forEach(g=>{if(g.name)byKey[String(g.key||"").toLowerCase()]=g.name;});
        all[pk]=all[pk].map(g=>{const nm=byKey[String(g.key||"").toLowerCase()];return nm?{...g,name:nm}:g;});
        await chrome.storage.local.set({pageSavedGroups:all});
      }
      try{await renderPageJoinSavedList();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      try{await renderPageGroupCommentGroups();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    }
    pageJoinFetchNamesBtn.textContent=t("pg.fetchNamesDone",{ok:done,total:need.length});
    setTimeout(()=>{pageJoinFetchNamesBtn.textContent=baseLabel;},3000);
  }finally{pageJoinFetchNamesBtn.disabled=false;}
};

loadPagePostGroupsBtn.onclick=async()=>{
  if(!selectedManagedPage){pageGroupPostStatus.textContent=t("pg.needPage");return;}
  // Ưu tiên nhóm đang tích trong danh sách trung tâm; nếu chưa tải thì load từ storage
  let rows=selectedPageJoinedGroups();
  if(!rows.length)rows=await ensurePageSavedGroups(selectedManagedPage).catch(()=>[]);
  if(rows.length){
    renderPagePostGroups(rows);
    pageGroupPostStatus.textContent=t("p.gpLoaded",{n:rows.length})+" (đã lưu)";
  } else {
    renderPagePostGroups([]);
    pageGroupPostStatus.textContent="Chưa có nhóm — hãy tải danh sách trong phần Tham gia nhóm";
  }
};
selectAllPagePostGroupsBtn.onclick=()=>{const rows=[...pageGroupPostList.querySelectorAll('label')].filter(r=>r.style.display!=="none"&&r.querySelector('.pgp-group-check')),bs=rows.map(r=>r.querySelector('.pgp-group-check')).filter(Boolean);const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);pageSyncTicksFromDOM();};
pageGroupPostKeyword.oninput=()=>{const k=pageGroupPostKeyword.value.trim().toLocaleLowerCase("vi");pageGroupPostList.querySelectorAll('label').forEach(r=>{const name=(r.dataset?.name||r.textContent||"").toLocaleLowerCase("vi");if(r.querySelector('.pgp-group-check'))r.style.display=!k||name.includes(k)?"flex":"none";});};
function readPageGroupPostBgConfig(){
  const mode=pageGroupPostBgMode.value==="fixed"?"fixed":"random";
  const fixedColor=PAGE_POST_BG_COLORS[pageGroupPostFixedColor.value]?pageGroupPostFixedColor.value:"pink";
  const colors=[...document.querySelectorAll('.pgp-bg-color:checked')].map(el=>el.value).filter(v=>PAGE_POST_BG_COLORS[v]);
  return {enabled:!!pageGroupPostBgEnabled.checked,mode,fixedColor,colors:colors.length?colors:Object.keys(PAGE_POST_BG_COLORS),maxChars:Math.min(130,Math.max(40,parseInt(pageGroupPostBgMaxChars.value)||100)),fallback:"skip"};
}
function togglePageGroupPostBgOptions(){pageGroupPostBgOptions.style.display=pageGroupPostBgEnabled.checked?"":"none";pageGroupPostFixedColorWrap.style.display=pageGroupPostBgMode.value==="fixed"?"":"none";}
async function savePageGroupPostBgDraft(){const bg=readPageGroupPostBgConfig();await chrome.storage.sync.set({pageGroupPostBgEnabled:bg.enabled,pageGroupPostBgMode:bg.mode,pageGroupPostFixedColor:bg.fixedColor,pageGroupPostBgColors:bg.colors,pageGroupPostBgMaxChars:bg.maxChars});}
pageGroupPostBgEnabled.addEventListener("change",()=>{togglePageGroupPostBgOptions();savePageGroupPostBgDraft();});
pageGroupPostBgMode.addEventListener("change",()=>{togglePageGroupPostBgOptions();savePageGroupPostBgDraft();});
pageGroupPostFixedColor.addEventListener("change",savePageGroupPostBgDraft);
document.querySelectorAll('.pgp-bg-color').forEach(el=>el.addEventListener("change",savePageGroupPostBgDraft));
pageGroupPostBgMaxChars.addEventListener("change",savePageGroupPostBgDraft);
pageGroupPostStyleProfile.addEventListener("change",()=>chrome.storage.sync.set({pageGroupPostStyleProfile:pageGroupPostStyleProfile.value}));
pageCommentSource.addEventListener("change",()=>{chrome.storage.sync.set({pageCommentSource:pageCommentSource.value});togglePageCommentGroupSection();});
pageCommentPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageCommentPrompt:pageCommentPrompt.value}));
pageCommentTagPrompt.addEventListener("change",()=>chrome.storage.sync.set({pageCommentTagPrompt:pageCommentTagPrompt.value}));
pageCommentTarget.addEventListener("change",()=>chrome.storage.sync.set({pageCommentTarget:pageCommentTarget.value}));
pageCommentMinDelay.addEventListener("change",()=>chrome.storage.sync.set({pageCommentMinDelay:pageCommentMinDelay.value}));
pageCommentMaxDelay.addEventListener("change",()=>chrome.storage.sync.set({pageCommentMaxDelay:pageCommentMaxDelay.value}));

pageGroupPostStartBtn.onclick=async()=>{
  if(pagePostRunning){pageGroupPostStatus.textContent=t("pgp.busy");return;}
  if(!selectedManagedPage){pageGroupPostStatus.textContent=t("pg.needPage");return;}
  const groups=await pageGroupPostTargets();if(!groups.length){pageGroupPostStatus.textContent=t("pgp.groups");return;}
  const target=Math.max(1,Math.min(groups.length,parseInt(pageGroupPostTarget.value)||groups.length)),minDelay=Math.max(5,Math.min(604800,parseInt(pageGroupPostMinDelay.value)||30)),maxDelay=Math.max(5,Math.min(604800,parseInt(pageGroupPostMaxDelay.value)||60));
  if(minDelay>maxDelay){pageGroupPostStatus.textContent=t("pg.badDelay");return;}
  if(!String(pageGroupPostPrompt.value||"").includes("{groupName}")){pageGroupPostStatus.textContent=t("pgp.needGroupName");return;}
  if(await pageFeatureBusy()){pageGroupPostStatus.textContent=t("pg.busyOther");return;}
  try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  const aiConfig=await getAiProfileFor("pageGroupPost"),runId=`page-post-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const bgConfig=readPageGroupPostBgConfig();
  const typingConfig=getAiTypingConfig("pageGroupPost");
  const styleProfileId=pageGroupPostStyleProfile.value||"";
  const styleProfile=styleProfileId&&styleProfileCache[styleProfileId]?styleProfileCache[styleProfileId]:null;
  const cfg={page:selectedManagedPage,groups,target,minDelay,maxDelay,prompt:pageGroupPostPrompt.value.trim(),aiConfig,bgConfig,typingConfig,styleProfile,pageProfile:styleProfile,done:0,skipped:0,index:0,runId};
  const safeCfg={...cfg,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""}};
  await chrome.storage.sync.set({pageSelected:selectedManagedPage,pageGroupPostTarget:target,pageGroupPostMinDelay:minDelay,pageGroupPostMaxDelay:maxDelay,pageGroupPostPrompt:cfg.prompt});
  setPagePostRunning(true);
  const first=groups[0];
  const tab=await ensureTaskTab(first.url,pageGroupPostStatus,t("pgp.running"),url=>pageGroupKeyFromUrl(url)===first.key,async owner=>{await chrome.storage.local.set({pageGroupPostActive:true,pageGroupPostRunId:runId,pageGroupPostOwnerTabId:owner.id,pageGroupPostConfig:{...safeCfg,ownerTabId:owner.id},pageGroupPostDone:0,pageGroupPostSkipped:0,pageGroupPostIndex:0,pageGroupPostRetriedIdx:-1,pageGroupPostStatus:t("pgp.running")});},{actor:"page"});
  if(!tab){setPagePostRunning(false);await chrome.storage.local.set({pageGroupPostActive:false});return;}
  chrome.tabs.sendMessage(tab.id,{action:"startPageGroupPost",config:cfg,runId,ownerTabId:tab.id},async response=>{if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startPageGroupPost",config:cfg,runId,ownerTabId:tab.id},pageGroupPostStatus);if(retry.ok||await runStillActive("pageGroupPostActive")){pageGroupPostStatus.textContent=t("pgp.running");return;}setPagePostRunning(false);return;}if(response?.ok||await runStillActive("pageGroupPostActive"))pageGroupPostStatus.textContent=t("pgp.running");else{setPagePostRunning(false);pageGroupPostStatus.textContent=response?.error||t("pgp.busy");}});
};
pageGroupPostStopBtn.onclick=async()=>{setPagePostRunning(false);await chrome.storage.local.set({pageGroupPostActive:false,pageGroupPostStatus:t("pgp.stopped")});broadcastToFacebookTabs({action:"stopPageGroupPost"});};
pageGroupPostResetBtn.onclick=async()=>{setPagePostRunning(false);await chrome.storage.local.set({pageGroupPostActive:false,pageGroupPostDone:0,pageGroupPostSkipped:0,pageGroupPostIndex:0,pageGroupPostRetriedIdx:-1,pageGroupPostStatus:t("pgp.resetStatus")});try{pageDatasetClearLast("post");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }await chrome.storage.local.remove(["pageGroupPostConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetPageGroupPost"});};

pageNewsWallStartBtn.onclick=async()=>{
  if(pageNewsWallRunning){pageNewsWallStatus.textContent=t("pgn.busy");return;}
  if(!selectedManagedPage){pageNewsWallStatus.textContent=t("pg.needPage");return;}
  if(await pageFeatureBusy()){pageNewsWallStatus.textContent=t("pg.busyOther");return;}
  const source=pageNewsSourceConfig(),count=Math.max(1,Math.min(100000,parseInt(pageNewsWallTarget?.value)||1)),interDelay=Math.max(0,Math.min(604800,parseInt(pageNewsWallDelay?.value)||30));
  if(source.type==="xread"&&!source.users.length){pageNewsWallStatus.textContent=t("pgn.needX");return;}
  if(source.type==="url"&&!/^https?:\/\//i.test(source.url)){pageNewsWallStatus.textContent=t("pgn.needUrl");return;}
  const prompt=String(pageNewsWallPrompt?.value||"").trim();
  if(!prompt.includes("{newsText}")){pageNewsWallStatus.textContent=t("pgn.needNewsText");return;}
  const aiConfig=await getAiProfileFor("pageNewsWall");
  if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model)){pageNewsWallStatus.textContent=t("p.gpNeedKeyModel");return;}
  const runId=`page-news-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const cfg={page:selectedManagedPage,source,topic:String(pageNewsTopic?.value||"").trim(),count,interDelay,withImage:pageNewsWallWithImage?.checked!==false,prompt,aiConfig,typingConfig:getAiTypingConfig("pageNewsWall"),styleProfileId:"",runId};
  const safeCfg={...cfg,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""}};
  await chrome.storage.sync.set({pageSelected:selectedManagedPage,pageNewsSourceType:source.type,pageNewsXUsers:pageNewsXUsers?.value||"",pageNewsUrl:pageNewsUrl?.value||"",pageNewsTopic:cfg.topic,pageNewsWallTarget:count,pageNewsWallDelay:interDelay,pageNewsWallWithImage:cfg.withImage,pageNewsWallPrompt:prompt});
  setPageNewsWallRunning(true);
  const tab=await ensureTaskTab(selectedManagedPage.url,pageNewsWallStatus,t("pgn.running"),url=>pageKeyForPopup({url})===pageKeyForPopup(selectedManagedPage),async owner=>{await chrome.storage.local.set({pageNewsWallActive:true,pageNewsWallActiveRunId:runId,pageNewsWallOwnerTabId:owner.id,pageNewsWallConfig:{...safeCfg,ownerTabId:owner.id},pageNewsWallDone:0,pageNewsWallSkipped:0,pageNewsWallIndex:0,pageNewsWallStatus:t("pgn.running")});},{actor:"page"});
  if(!tab){setPageNewsWallRunning(false);await chrome.storage.local.set({pageNewsWallActive:false});return;}
  chrome.tabs.sendMessage(tab.id,{action:"startPageNewsWall",config:cfg,runId,ownerTabId:tab.id},async response=>{
    if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startPageNewsWall",config:cfg,runId,ownerTabId:tab.id},pageNewsWallStatus);if(retry.ok||await runStillActive("pageNewsWallActive")){pageNewsWallStatus.textContent=t("pgn.running");return;}setPageNewsWallRunning(false);return;}
    if(response?.ok||await runStillActive("pageNewsWallActive"))pageNewsWallStatus.textContent=t("pgn.running");else{setPageNewsWallRunning(false);pageNewsWallStatus.textContent=response?.error||t("pgn.busy");}
  });
};
pageNewsWallStopBtn.onclick=async()=>{setPageNewsWallRunning(false);await chrome.storage.local.set({pageNewsWallActive:false,pageNewsWallStatus:t("pgn.stopped")});broadcastToFacebookTabs({action:"stopPageNewsWall"});};
pageNewsWallResetBtn.onclick=async()=>{setPageNewsWallRunning(false);await chrome.storage.local.set({pageNewsWallActive:false,pageNewsWallDone:0,pageNewsWallSkipped:0,pageNewsWallIndex:0,pageNewsWallStatus:t("pgn.resetStatus")});await chrome.storage.local.remove(["pageNewsWallConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetPageNewsWall"});};

pageCommentStartBtn.onclick=async()=>{
  if(pageCommentRunning){pageCommentStatus.textContent=t("pgc.busy");return;}
  await tagSectionsReady;
  if(!selectedManagedPage){pageCommentStatus.textContent=t("pg.needPage");return;}
  const source=["feed","groups","pages"].includes(pageCommentSource.value)?pageCommentSource.value:"feed";
  if(await pageFeatureBusy()){pageCommentStatus.textContent=t("pgc.busyOther");return;}
  try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  const target=Math.max(1,Math.min(100000,parseInt(pageCommentTarget.value)||10)),minDelay=Math.max(5,Math.min(604800,parseInt(pageCommentMinDelay.value)||20)),maxDelay=Math.max(5,Math.min(604800,parseInt(pageCommentMaxDelay.value)||45));
  if(minDelay>maxDelay){pageCommentStatus.textContent=t("pg.badDelay");return;}
  const aiConfig=await getAiProfileFor("pageComment"),runId=`page-comment-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const tagOn=!!pageCommentTagEnabled?.checked;
  if(tagOn&&tagSections["pageComment"]?.isResolving?.()){
    pageCommentStatus.textContent="Đang lấy tên tag, đợi hoàn tất rồi bấm Bắt đầu lại.";
    return;
  }
  let tagPrompt=String(pageCommentTagPrompt?.value||"").trim();
  if(tagOn&&!tagPrompt.includes("{tagName}")){
    tagPrompt=t("fd.aiTagPromptDefault");
    if(pageCommentTagPrompt)pageCommentTagPrompt.value=tagPrompt;
    chrome.storage.sync.set({pageCommentTagPrompt:tagPrompt}).catch(()=>{});
  }
  const tagConfig=tagSections["pageComment"]?.getTagConfig(tagOn)||null;
  const pickedGroups=source==="groups"?selectedPageCommentGroups():[],sourceGroups=pickedGroups.map(g=>({key:groupPostKey(g),url:g.url||`https://www.facebook.com${groupPostKey(g)}/`,name:g.name||""}));
  const cfg={page:selectedManagedPage,source,groups:sourceGroups,pages:[],target,minDelay,maxDelay,prompt:pageCommentPrompt.value.trim(),tagPrompt:tagOn?tagPrompt:"",tagConfig,aiConfig,typingConfig:getAiTypingConfig("pageComment"),done:0,pageIndex:0,runId};
  const safeCfg={...cfg,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""}};
  await chrome.storage.sync.set({pageSelected:selectedManagedPage,pageCommentSource:source,pageCommentTarget:target,pageCommentMinDelay:minDelay,pageCommentMaxDelay:maxDelay,pageCommentPrompt:cfg.prompt,pageCommentTagPrompt:tagPrompt});
  setPageCommentRunning(true);
  const firstGroupUrl=source==="groups"&&sourceGroups.length?sourceGroups[0].url:"";
  const targetUrl=firstGroupUrl||(source==="feed"?"https://www.facebook.com/":`https://www.facebook.com/?filter=${source}&sk=h_chr`);
  const route=value=>{try{const u=new URL(value);if(firstGroupUrl){const wanted=new URL(firstGroupUrl);return u.pathname.replace(/\/$/,"").toLowerCase()===wanted.pathname.replace(/\/$/,"").toLowerCase();}const path=u.pathname,filter=(u.searchParams.get("filter")||"all").toLowerCase();if(path!=="/"&&path!=="/home.php")return false;return source==="feed"?filter==="all":filter===source;}catch{return false;}};
  const tab=await ensureTaskTab(targetUrl,pageCommentStatus,t("pgc.running"),route,async owner=>{await chrome.storage.local.set({pageCommentActive:true,pageCommentRunId:runId,pageCommentOwnerTabId:owner.id,pageCommentConfig:{...safeCfg,ownerTabId:owner.id},pageCommentDone:0,pageCommentPageIndex:0,pageCommentStatus:t("pgc.running")});},{actor:"page"});
  if(!tab){setPageCommentRunning(false);await chrome.storage.local.set({pageCommentActive:false});return;}
  chrome.tabs.sendMessage(tab.id,{action:"startPageComment",config:cfg,runId,ownerTabId:tab.id},async response=>{if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startPageComment",config:cfg,runId,ownerTabId:tab.id},pageCommentStatus);if(retry.ok||await runStillActive("pageCommentActive")){pageCommentStatus.textContent=t("pgc.running");return;}setPageCommentRunning(false);return;}if(response?.ok||await runStillActive("pageCommentActive"))pageCommentStatus.textContent=t("pgc.running");else{setPageCommentRunning(false);pageCommentStatus.textContent=response?.error||t("pgc.busy");}});
};
pageCommentStopBtn.onclick=async()=>{setPageCommentRunning(false);await chrome.storage.local.set({pageCommentActive:false,pageCommentStatus:t("pgc.stopped")});broadcastToFacebookTabs({action:"stopPageComment"});};
pageCommentResetBtn.onclick=async()=>{setPageCommentRunning(false);await chrome.storage.local.set({pageCommentActive:false,pageCommentDone:0,pageCommentStatus:t("pgc.resetStatus")});try{pageDatasetClearLast("fcomment");}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }await chrome.storage.local.remove(["pageCommentConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetPageComment"});};

chrome.storage.sync.get(["pageGroupPostTarget","pageGroupPostMinDelay","pageGroupPostMaxDelay","pageGroupPostPrompt","pageGroupPostStyleProfile","pageGroupPostBgEnabled","pageGroupPostBgMode","pageGroupPostFixedColor","pageGroupPostBgColors","pageCommentSource","pageCommentTarget","pageCommentMinDelay","pageCommentMaxDelay","pageCommentPrompt","pageCommentTagPrompt","pageNewsSourceType","pageNewsXUsers","pageNewsUrl","pageNewsTopic","pageNewsWallTarget","pageNewsWallDelay","pageNewsWallWithImage","pageNewsWallPrompt"],async saved=>{
  try{const r=await selectedPageDatasetPromise();if(r&&r.ds)return;}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  if(saved.pageGroupPostTarget!==undefined)pageGroupPostTarget.value=saved.pageGroupPostTarget;
  if(saved.pageGroupPostMinDelay!==undefined)pageGroupPostMinDelay.value=saved.pageGroupPostMinDelay;
  if(saved.pageGroupPostMaxDelay!==undefined)pageGroupPostMaxDelay.value=saved.pageGroupPostMaxDelay;
  if(saved.pageGroupPostPrompt!==undefined)setPromptIf(pageGroupPostPrompt,saved.pageGroupPostPrompt);
  if(saved.pageGroupPostStyleProfile!==undefined)pageGroupPostStyleProfile.value=saved.pageGroupPostStyleProfile;
  if(saved.pageGroupPostBgEnabled!==undefined){pageGroupPostBgEnabled.checked=!!saved.pageGroupPostBgEnabled;togglePageGroupPostBgOptions();}
  if(saved.pageGroupPostBgMode!==undefined)pageGroupPostBgMode.value=saved.pageGroupPostBgMode;
  if(saved.pageGroupPostFixedColor!==undefined)pageGroupPostFixedColor.value=saved.pageGroupPostFixedColor;
  if(Array.isArray(saved.pageGroupPostBgColors)){document.querySelectorAll('.pgp-bg-color').forEach(el=>{el.checked=saved.pageGroupPostBgColors.includes(el.value);});}
  if(saved.pageGroupPostBgMaxChars!==undefined)pageGroupPostBgMaxChars.value=saved.pageGroupPostBgMaxChars;
  togglePageGroupPostBgOptions();
  if(saved.pageCommentSource!==undefined){pageCommentSource.value=["feed","groups","pages"].includes(saved.pageCommentSource)?saved.pageCommentSource:"feed";togglePageCommentGroupSection();}
  if(saved.pageCommentTarget!==undefined)pageCommentTarget.value=saved.pageCommentTarget;
  if(saved.pageCommentMinDelay!==undefined)pageCommentMinDelay.value=saved.pageCommentMinDelay;
  if(saved.pageCommentMaxDelay!==undefined)pageCommentMaxDelay.value=saved.pageCommentMaxDelay;
  if(saved.pageCommentPrompt!==undefined)setPromptIf(pageCommentPrompt,saved.pageCommentPrompt);
  if(saved.pageCommentTagPrompt!==undefined&&pageCommentTagPrompt)setPromptIf(pageCommentTagPrompt,saved.pageCommentTagPrompt);
  if(saved.pageNewsSourceType!==undefined&&pageNewsSourceType)pageNewsSourceType.value=saved.pageNewsSourceType==="url"?"url":"xread";
  if(saved.pageNewsXUsers!==undefined&&pageNewsXUsers)pageNewsXUsers.value=saved.pageNewsXUsers;
  if(saved.pageNewsUrl!==undefined&&pageNewsUrl)pageNewsUrl.value=saved.pageNewsUrl;
  if(saved.pageNewsTopic!==undefined&&pageNewsTopic)pageNewsTopic.value=saved.pageNewsTopic;
  if(saved.pageNewsWallTarget!==undefined&&pageNewsWallTarget)pageNewsWallTarget.value=saved.pageNewsWallTarget;
  if(saved.pageNewsWallDelay!==undefined&&pageNewsWallDelay)pageNewsWallDelay.value=saved.pageNewsWallDelay;
  if(saved.pageNewsWallWithImage!==undefined&&pageNewsWallWithImage)pageNewsWallWithImage.checked=saved.pageNewsWallWithImage!==false;
  if(saved.pageNewsWallPrompt!==undefined&&pageNewsWallPrompt)setPromptIf(pageNewsWallPrompt,saved.pageNewsWallPrompt);
  togglePageNewsSource();
});
// Migrate cache pageJoinedGroups cũ (chưa có _actorVerified) → đánh dấu actorVerified:true
// pageJoinedGroups_* luôn là dữ liệu Page (nick cá nhân lưu ở joinedGroups riêng) nên an toàn
(()=>{chrome.storage.local.get(null,all=>{const updates={};Object.keys(all).forEach(k=>{if(k.startsWith("pageJoinedGroups")&&Array.isArray(all[k])&&all[k].length>0&&all[k][0]?._actorVerified===undefined){updates[k]=all[k].map(g=>({...g,_actorVerified:true}));}});if(Object.keys(updates).length)chrome.storage.local.set(updates);});})();
chrome.storage.local.get(["pageGroupPostActive","pageGroupPostStatus","pageGroupPostDone","pageGroupPostSkipped","pageGroupPostConfig","pageCommentActive","pageCommentStatus","pageCommentDone","pageCommentConfig","pageJoinedGroups","pageSalesPostActive","pageSalesPostStatus","pageSalesPostDone","pageSalesPostSkipped","pageSalesPostTotal","pageSalesPostConfig","pageGroupCommentActive","pageGroupCommentStatus","pageGroupCommentDone","pageGroupCommentSkipped","pageGroupCommentConfig","pageNewsWallActive","pageNewsWallStatus","pageNewsWallDone","pageNewsWallSkipped","pageNewsWallConfig"],saved=>{
  const _pgKey=pageGroupStorageKeyForPopup(pageKeyForPopup(selectedManagedPage));
  if(_pgKey){
    chrome.storage.local.get([_pgKey],extra=>{
      const groups=extra[_pgKey];
      if(Array.isArray(groups)&&groups.length&&groups[0]?._actorVerified!==false)renderPagePostGroups(groups);
      else renderPagePostGroups([]);
    });
  } else { renderPagePostGroups([]); }
  if(saved.pageGroupPostStatus)pageGroupPostStatus.textContent=saved.pageGroupPostStatus;
  pageGroupPostCount.textContent=`${saved.pageGroupPostDone||0} / ${saved.pageGroupPostConfig?.target||pageGroupPostTarget.value||0}`;
  if(saved.pageCommentStatus)pageCommentStatus.textContent=saved.pageCommentStatus;
  pageCommentCount.textContent=`${saved.pageCommentDone||0} / ${saved.pageCommentConfig?.target||pageCommentTarget.value||0}`;
  if(saved.pageGroupPostActive)setPagePostRunning(true);if(saved.pageCommentActive)setPageCommentRunning(true);
  if(saved.pageGroupCommentStatus&&pageGroupCommentStatus)pageGroupCommentStatus.textContent=saved.pageGroupCommentStatus;
  if(pageGroupCommentCount)pageGroupCommentCount.textContent=`${saved.pageGroupCommentDone||0} / ${saved.pageGroupCommentConfig?.perGroup||0}`;
  if(saved.pageGroupCommentActive)setPageGroupCommentRunning(true);
  if(saved.pageSalesPostStatus)pageSalesStatus.textContent=saved.pageSalesPostStatus;
  pageSalesCount.textContent=`${saved.pageSalesPostDone||0} / ${saved.pageSalesPostTotal||0} (bỏ qua ${saved.pageSalesPostSkipped||0})`;
  if(saved.pageSalesPostActive)setPageSalesRunning(true);
  if(saved.pageNewsWallStatus)pageNewsWallStatus.textContent=saved.pageNewsWallStatus;
  pageNewsWallCount.textContent=`${saved.pageNewsWallDone||0} / ${(saved.pageNewsWallDone||0)+(saved.pageNewsWallSkipped||0)}`;
  if(saved.pageNewsWallActive)setPageNewsWallRunning(true);
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  if(changes.pageSalesPostStatus)pageSalesStatus.textContent=changes.pageSalesPostStatus.newValue||"";
  if(changes.pageSalesPostDone||changes.pageSalesPostSkipped||changes.pageSalesPostTotal)chrome.storage.local.get(["pageSalesPostDone","pageSalesPostSkipped","pageSalesPostTotal"],r=>{pageSalesCount.textContent=`${r.pageSalesPostDone||0} / ${r.pageSalesPostTotal||0} (bỏ qua ${r.pageSalesPostSkipped||0})`;});
  if(changes.pageSalesPostActive)setPageSalesRunning(!!changes.pageSalesPostActive.newValue);
  if(changes.pageGroupPostStatus)pageGroupPostStatus.textContent=changes.pageGroupPostStatus.newValue||"";
  if(changes.pageGroupPostDone||changes.pageGroupPostSkipped)chrome.storage.local.get(["pageGroupPostDone","pageGroupPostSkipped","pageGroupPostConfig"],r=>{pageGroupPostCount.textContent=`${r.pageGroupPostDone||0} / ${r.pageGroupPostConfig?.target||pageGroupPostTarget.value||0} (bỏ qua ${r.pageGroupPostSkipped||0})`;});
  if(changes.pageCommentStatus)pageCommentStatus.textContent=changes.pageCommentStatus.newValue||"";
  if(changes.pageCommentDone)chrome.storage.local.get(["pageCommentDone","pageCommentConfig"],r=>{pageCommentCount.textContent=`${r.pageCommentDone||0} / ${r.pageCommentConfig?.target||pageCommentTarget.value||0}`;});
  if(changes.pageGroupPostActive)setPagePostRunning(!!changes.pageGroupPostActive.newValue);
  if(changes.pageCommentActive)setPageCommentRunning(!!changes.pageCommentActive.newValue);
  if(changes.pageGroupCommentStatus&&pageGroupCommentStatus)pageGroupCommentStatus.textContent=changes.pageGroupCommentStatus.newValue||"";
  if(changes.pageGroupCommentDone||changes.pageGroupCommentSkipped)chrome.storage.local.get(["pageGroupCommentDone","pageGroupCommentSkipped","pageGroupCommentConfig"],r=>{if(pageGroupCommentCount)pageGroupCommentCount.textContent=`${r.pageGroupCommentDone||0} / ${r.pageGroupCommentConfig?.perGroup||0} (bỏ qua ${r.pageGroupCommentSkipped||0})`;});
  if(changes.pageGroupCommentActive)setPageGroupCommentRunning(!!changes.pageGroupCommentActive.newValue);
  if(changes.pageNewsWallStatus)pageNewsWallStatus.textContent=changes.pageNewsWallStatus.newValue||"";
  if(changes.pageNewsWallDone||changes.pageNewsWallSkipped)chrome.storage.local.get(["pageNewsWallDone","pageNewsWallSkipped"],r=>{pageNewsWallCount.textContent=`${r.pageNewsWallDone||0} / ${(r.pageNewsWallDone||0)+(r.pageNewsWallSkipped||0)}`;});
  if(changes.pageNewsWallActive)setPageNewsWallRunning(!!changes.pageNewsWallActive.newValue);
});


// GROUP - sub tabs
const subTabSearch = $("subTabSearch");
const subTabDiscover = $("subTabDiscover");
const groupSearchPanel = $("groupSearchPanel");
const groupDiscoverPanel = $("groupDiscoverPanel");
function showGroupSub(which){
  if(which==="discover"){
    subTabDiscover.style.background="#009688"; subTabDiscover.style.color="#fff";
    subTabSearch.style.background="#e4e6eb"; subTabSearch.style.color="#050505";
    groupDiscoverPanel.classList.remove("hidden"); groupSearchPanel.classList.add("hidden");
  } else {
    subTabSearch.style.background="#1877F2"; subTabSearch.style.color="#fff";
    subTabDiscover.style.background="#e4e6eb"; subTabDiscover.style.color="#050505";
    groupSearchPanel.classList.remove("hidden"); groupDiscoverPanel.classList.add("hidden");
  }
  chrome.storage.sync.set({ groupSubTab: which });
}
subTabSearch.onclick = ()=> showGroupSub("search");
subTabDiscover.onclick = ()=> showGroupSub("discover");
chrome.storage.sync.get(["groupSubTab"], res=>{ showGroupSub(res.groupSubTab==="discover"?"discover":"search"); });

// GROUP JOIN - SEARCH
const groupKeyword = $("groupKeyword");
const groupKeywordList = $("groupKeywordList");
// Nhiều từ khóa nick chạy nối tiếp 1 lượt: mỗi dòng "từ khoá | số nhóm".
// Ô đơn đã ẩn (giữ element để mọi đường Start/lịch chạy nguyên): mirror từ
// khóa đầu của danh sách; máy cũ chỉ có single thì migrate 1 lần vào list.
function parseNickKeywordList(fallbackTarget){
  const raw=String(groupKeywordList?.value||"").split(/\r?\n/);
  const out=[];
  for(const line of raw){
    const text=line.trim();
    if(!text)continue;
    const parts=text.split("|");
    const kw=String(parts[0]||"").trim();
    const n=parts.length>1?parseInt(parts[1],10):fallbackTarget;
    if(!kw)continue;
    out.push({keyword:kw.slice(0,120),target:Math.max(1,Math.min(100000,Number.isFinite(n)?n:fallbackTarget))});
    if(out.length>=1000)break;
  }
  return out;
}
function syncNickSingleFromList(){
  if(!groupKeyword||!groupKeywordList)return;
  const tg=Math.max(1,Math.min(100000,parseInt(groupTarget?.value)||10));
  const list=parseNickKeywordList(tg);
  groupKeyword.value=list.length?list[0].keyword:"";
}
function migrateNickSingleToList(){
  if(!groupKeywordList||groupKeywordList.value.trim())return;
  const kw=String(groupKeyword?.value||"").trim();
  if(!kw)return;
  const tg=Math.max(1,Math.min(100000,parseInt(groupTarget?.value)||10));
  groupKeywordList.value=`${kw} | ${tg}`;
  chrome.storage.sync.set({groupKeywordList:groupKeywordList.value}).catch(()=>{});
  syncNickSingleFromList();
}
if(groupKeywordList){
  groupKeywordList.addEventListener("input",()=>{try{syncNickSingleFromList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }});
  groupKeywordList.addEventListener("change",()=>{try{syncNickSingleFromList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }chrome.storage.sync.set({groupKeywordList:groupKeywordList.value}).catch(()=>{});});
}
const groupMinMembers = $("groupMinMembers");
const groupMinPosts = $("groupMinPosts");
const groupTarget = $("groupTarget");
const groupMinDelay = $("groupMinDelay");
const groupMaxDelay = $("groupMaxDelay");
const groupConfirmWait = $("groupConfirmWait");
const groupAnswers = $("groupAnswers");
const groupAiAnswersEnabled=$("groupAiAnswersEnabled"),groupAiAnswersPrompt=$("groupAiAnswersPrompt");
const groupStartBtn = $("groupStartBtn");
const groupStopBtn = $("groupStopBtn");
const groupResetBtn = $("groupResetBtn");
const groupStatus = $("groupStatus");
const groupCount = $("groupCount");
const groupAiUsage=$("groupAiUsage");

// Prompt được lưu ngay khi người dùng chỉnh sửa, không đợi bấm nút chạy.
// Dùng debounce nhẹ để không ghi storage cho từng phím ở tốc độ quá nhanh.
function bindPromptPersistence(storageKey,field){
  if(!field)return;
  let timer=0;
  const saveNow=()=>{if(field.readOnly)return Promise.resolve();return chrome.storage.sync.set({[storageKey]:field.value});};
  const save=()=>{
    clearTimeout(timer);
    timer=setTimeout(saveNow,250);
  };
  field.addEventListener("input",save);
  field.addEventListener("change",()=>{clearTimeout(timer);saveNow();});
  field.addEventListener("blur",()=>{clearTimeout(timer);saveNow();});
}
// Mỗi phiên đăng nhóm dùng một snapshot prompt đã lưu trong storage.local.
// Giữ ô prompt ở chế độ chỉ đọc trong lúc chạy để người dùng không tưởng
// prompt mới đang áp dụng cho phiên hiện tại hoặc làm lệch cấu hình khi popup
// đóng/mở giữa các lần điều hướng. Dừng/hoàn tất sẽ mở khóa để chuẩn bị lượt sau.
function setPromptEditorState(locked,fields,hintId){
  (Array.isArray(fields)?fields:[fields]).filter(Boolean).forEach(field=>{
    field.readOnly=!!locked;
    field.classList.toggle("prompt-locked",!!locked);
    field.setAttribute("aria-readonly",locked?"true":"false");
    field.title=locked?t("prompt.lockedTitle"):"";
  });
  const hint=hintId&&$(hintId);
  if(hint)hint.classList.toggle("hidden",!locked);
}
bindPromptPersistence("groupAiAnswersPrompt",groupAiAnswersPrompt);

// GROUP DISCOVER
const discoverTarget = $("discoverTarget");
const discoverMinDelay = $("discoverMinDelay");
const discoverMaxDelay = $("discoverMaxDelay");
const discoverConfirmWait = $("discoverConfirmWait");
const discoverAnswers = $("discoverAnswers");
const discoverStartBtn = $("discoverStartBtn");
const discoverStopBtn = $("discoverStopBtn");
const discoverResetBtn = $("discoverResetBtn");
const discoverStatus = $("discoverStatus");
const discoverCount = $("discoverCount");
let isGroupJoining=false;
const JOIN_CONFIRM_DEFAULT_SECONDS=90;
const JOIN_CONFIRM_MIN_SECONDS=5;
const JOIN_CONFIRM_MAX_SECONDS=600;
function readJoinConfirmSeconds(input){
  const parsed=Number.parseInt(input?.value,10);
  const value=Number.isFinite(parsed)?parsed:JOIN_CONFIRM_DEFAULT_SECONDS;
  const safe=Math.min(JOIN_CONFIRM_MAX_SECONDS,Math.max(JOIN_CONFIRM_MIN_SECONDS,value));
  if(input)input.value=String(safe);
  return safe;
}
function saveJoinConfirmSeconds(input,key){
  const value=readJoinConfirmSeconds(input);
  chrome.storage.sync.set({[key]:value});
}
function setGroupRunning(v){
  isGroupJoining=v;
  groupStartBtn.textContent = v ? t("p.busyJoin") : t("p.gjIdle");
  groupStartBtn.classList.toggle("running", v);
}
groupStartBtn.onclick = async ()=>{
  const shareRun=await chrome.storage.local.get(["groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive",...FEED_SCOPED_ACTIVE_KEYS]);if(Object.values(shareRun).some(Boolean)){groupStatus.textContent=(shareRun.pageGroupJoinActive||shareRun.pageGroupPostActive||shareRun.pageCommentActive||shareRun.pageSalesPostActive||FEED_SCOPED_ACTIVE_KEYS.some(key=>shareRun[key]))?t("pg.busyOther"):t("p.shBusyJoin");return;}
  const crossRun=await chrome.storage.local.get(["isDiscoverJoining"]);
  if(crossRun.isDiscoverJoining){groupStatus.textContent=t("p.gjDiscoverBusy");return;}
  const keyword = groupKeyword.value.trim();
  if(!keyword){ groupStatus.textContent=t("p.gjNeedKeyword"); return; }
  const defTarget=Math.max(1,Math.min(100000,parseInt(groupTarget.value)||10));
  // Một lượt chạy hết danh sách từ khoá (ô đơn luôn mirror dòng đầu nên mọi
  // đường cũ vẫn thấy đúng từ khoá hiện tại).
  const keywords=parseNickKeywordList(defTarget);
  if(!keywords.length){ groupStatus.textContent=t("p.gjNeedKeyword"); return; }
  // Phiên cũ khác từ khóa vẫn chạy thì không đè cấu hình — nếu không tab
  // reload giữa chừng sẽ resume nhầm sang từ khóa mới.
  const runningState=await chrome.storage.local.get(["isGroupJoining","groupJoinRunConfig"]);
  if(runningState.isGroupJoining&&runningState.groupJoinRunConfig&&runningState.groupJoinRunConfig.keyword&&runningState.groupJoinRunConfig.keyword!==keyword){
    groupStatus.textContent=t("p.gjDiffKeywordKw",{kw:runningState.groupJoinRunConfig.keyword});
    setGroupRunning(true);return;
  }
  const answersText = groupAnswers.value.trim();
  const aiSaved=await getAiProfileFor("keyword");
  const cfg = {
    keyword:keywords[0].keyword,
    keywords,
    minMembers: parseInt(groupMinMembers.value)||0,
    minPostsPerDay: parseInt(groupMinPosts.value)||0,
    targetJoin: keywords[0].target,
    minDelay: parseInt(groupMinDelay.value)||5,
    maxDelay: parseInt(groupMaxDelay.value)||15,
    confirmWaitSeconds: readJoinConfirmSeconds(groupConfirmWait),
    answersText,aiJoinEnabled:groupAiAnswersEnabled.checked,aiJoinPrompt:groupAiAnswersPrompt.value.trim(),aiConfig:aiSaved,typingConfig:getAiTypingConfig("groupJoin")
  };
  if(cfg.minDelay > cfg.maxDelay){ groupStatus.textContent=t("p.gjBadDelay2"); return; }
  chrome.storage.sync.set({ groupKeyword:keyword, groupKeywordList:groupKeywordList?.value||"", groupMinMembers:cfg.minMembers, groupMinPosts:cfg.minPostsPerDay, groupTarget:cfg.targetJoin, groupMinDelay:cfg.minDelay, groupMaxDelay:cfg.maxDelay, groupConfirmWait:cfg.confirmWaitSeconds, groupAnswers: answersText,groupAiAnswersEnabled:cfg.aiJoinEnabled,groupAiAnswersPrompt:cfg.aiJoinPrompt });
  // Lưu phiên trước điều hướng để tab tự resume đúng từ khóa sau mọi reload.
  setGroupRunning(true);
  const searchUrl="https://www.facebook.com/search/groups/?q="+encodeURIComponent(keyword);
  let tab = await ensureTaskTab(
    searchUrl,
    groupStatus,
    t("p.gjOpening"),
    url=>{
      // Tab đang ở từ khóa CŨ vẫn là sai route — phải so cả query q.
      try{
        const u=new URL(url);
        if(!u.pathname.startsWith("/search/groups"))return false;
        return u.searchParams.get("q")===keyword;
      }catch{return url.includes("/search/groups/?q="+encodeURIComponent(keyword));}
    },
    async owner=>{
      await chrome.storage.local.set({isGroupJoining:true,groupJoined:0,groupFound:0,groupAiUsage:t("gq.aiWaiting"),groupJoinRunConfig:{...cfg,ownerTabId:owner.id},groupStatus:t("p.gjOpeningKw",{kw:keyword})});
    }
  );if(!tab){setGroupRunning(false);await chrome.storage.local.set({isGroupJoining:false});await chrome.storage.local.remove(["groupJoinRunConfig"]);return;}
  chrome.tabs.sendMessage(tab.id, { action:"startGroupJoin", ...cfg,ownerTabId:tab.id }, async res=>{
    if(chrome.runtime.lastError){
      const retry = await autoReloadAndRetry(tab.id, { action:"startGroupJoin", ...cfg,ownerTabId:tab.id }, groupStatus);
      // Gửi không tới cũng không sao: phiên đã lưu, tab tự tiếp tục.
      groupStatus.textContent=retry.ok?t("p.gjRunning",{kw:keyword}):t("p.gjSaved",{kw:keyword});
      return;
    }
    if(res && res.ok){ setGroupRunning(true); groupStatus.textContent=t("p.gjRunning",{kw:keyword});}
    else if(res && (res.code==="join-busy"||(res.msg && /luồng tham gia nhóm khác/.test(res.msg)))){ setGroupRunning(true); groupStatus.textContent=t("p.gjRunning",{kw:keyword}); }
    else{setGroupRunning(false);await chrome.storage.local.set({isGroupJoining:false});await chrome.storage.local.remove(["groupJoinRunConfig"]);groupStatus.textContent=res?.msg||t("p.gjStartFail");}
  });
};
groupStopBtn.onclick = async ()=>{
  setGroupRunning(false);
  await chrome.storage.local.set({isGroupJoining:false,groupStatus:t("p.stoppedX")});
  await chrome.storage.local.remove(["groupJoinRunConfig","pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
  broadcastToFacebookTabs({action:"stopGroupJoin"});
  const tab=await getActiveTab();
  if(tab) chrome.tabs.sendMessage(tab.id, {action:"stopGroupJoin"}, ()=>setGroupRunning(false));
};
groupResetBtn.onclick = async ()=>{
  await chrome.storage.local.set({groupJoined:0,groupFound:0,isGroupJoining:false,groupStatus:t("p.resetDone")});
  await chrome.storage.local.remove(["groupJoinRunConfig","pendingSearchJoin","pendingSearchKeyword","pendingSearchConfig"]);
  broadcastToFacebookTabs({action:"resetGroupJoin"});
  const tab=await getActiveTab();
  if(tab) chrome.tabs.sendMessage(tab.id, {action:"resetGroupJoin"}, ()=>{
    groupCount.textContent="0 / "+(parseInt(groupTarget.value)||10);
    groupStatus.textContent=t("p.resetDone");
    setGroupRunning(false);
  });
};
// load group config
chrome.storage.sync.get(["groupKeyword","groupKeywordList","groupMinMembers","groupMinPosts","groupTarget","groupMinDelay","groupMaxDelay","groupConfirmWait","groupAnswers","groupAiAnswersEnabled","groupAiAnswersPrompt"], res=>{
  if(res.groupKeyword) groupKeyword.value=res.groupKeyword;
  if(res.groupKeywordList!==undefined&&groupKeywordList)groupKeywordList.value=res.groupKeywordList;
  try{migrateNickSingleToList();syncNickSingleFromList();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  if(res.groupMinMembers!==undefined) groupMinMembers.value=res.groupMinMembers;
  if(res.groupMinPosts!==undefined) groupMinPosts.value=res.groupMinPosts;
  if(res.groupTarget) groupTarget.value=res.groupTarget;
  if(res.groupMinDelay) groupMinDelay.value=res.groupMinDelay;
  if(res.groupMaxDelay) groupMaxDelay.value=res.groupMaxDelay;
  if(res.groupConfirmWait!==undefined) groupConfirmWait.value=readJoinConfirmSeconds({value:res.groupConfirmWait});
  if(res.groupAnswers) groupAnswers.value=res.groupAnswers;
  if(res.groupAiAnswersEnabled!==undefined)groupAiAnswersEnabled.checked=res.groupAiAnswersEnabled;
  if(res.groupAiAnswersPrompt!==undefined)groupAiAnswersPrompt.value=res.groupAiAnswersPrompt;
  groupCount.textContent = `0 / ${parseInt(groupTarget.value)||10}`;
});
chrome.storage.local.get(["groupStatus","groupJoined","groupFound","groupAiUsage","isGroupJoining"], res=>{
  if(res.groupStatus) groupStatus.textContent=res.groupStatus;
  if(res.groupAiUsage) groupAiUsage.textContent=res.groupAiUsage;
  if(res.groupJoined!==undefined) groupCount.textContent=`${res.groupJoined} / ${parseInt(groupTarget.value)||10}`;
  if(res.isGroupJoining) setGroupRunning(true);
});
groupTarget.addEventListener("change", ()=>{ groupCount.textContent=`${0} / ${parseInt(groupTarget.value)||10}`; });
groupConfirmWait.addEventListener("change",()=>saveJoinConfirmSeconds(groupConfirmWait,"groupConfirmWait"));

// DISCOVER JOIN handlers
let isDiscoverJoining=false;
function setDiscoverRunning(v){
  isDiscoverJoining=v;
  discoverStartBtn.textContent = v ? t("p.busyJoin") : t("gd.start");
  discoverStartBtn.classList.toggle("running", v);
}
discoverStartBtn.onclick = async ()=>{
  const shareRun=await chrome.storage.local.get(["groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive",...FEED_SCOPED_ACTIVE_KEYS]);if(Object.values(shareRun).some(Boolean)){discoverStatus.textContent=(shareRun.pageGroupJoinActive||shareRun.pageGroupPostActive||shareRun.pageCommentActive||shareRun.pageSalesPostActive||FEED_SCOPED_ACTIVE_KEYS.some(key=>shareRun[key]))?t("pg.busyOther"):t("p.shBusyJoin");return;}
  const keywordRun=await chrome.storage.local.get(["isGroupJoining","groupJoinRunConfig"]);
  if(keywordRun.isGroupJoining){discoverStatus.textContent=keywordRun.groupJoinRunConfig?.keyword?t("p.gdKeywordBusyKw",{kw:keywordRun.groupJoinRunConfig.keyword}):t("p.gdKeywordBusy");return;}
  const aiSaved=await getAiProfileFor("discover");
  const cfg = {
    target: parseInt(discoverTarget.value)||10,
    minDelay: parseInt(discoverMinDelay.value)||5,
    maxDelay: parseInt(discoverMaxDelay.value)||15,
    confirmWaitSeconds: readJoinConfirmSeconds(discoverConfirmWait),
    answersText: discoverAnswers.value.trim(),aiJoinEnabled:groupAiAnswersEnabled.checked,aiJoinPrompt:groupAiAnswersPrompt.value.trim(),aiConfig:aiSaved,typingConfig:getAiTypingConfig("groupJoin")
  };
  if(cfg.minDelay > cfg.maxDelay){ discoverStatus.textContent=t("p.delayBad"); return; }
  chrome.storage.sync.set({ discoverTarget:cfg.target, discoverMinDelay:cfg.minDelay, discoverMaxDelay:cfg.maxDelay, discoverConfirmWait:cfg.confirmWaitSeconds, discoverAnswers: cfg.answersText });
  setDiscoverRunning(true);
  const discoverRunConfig={target:cfg.target,minDelay:cfg.minDelay,maxDelay:cfg.maxDelay,confirmWaitSeconds:cfg.confirmWaitSeconds,answersText:cfg.answersText,aiJoinEnabled:cfg.aiJoinEnabled,aiJoinPrompt:cfg.aiJoinPrompt,aiConfig:cfg.aiConfig,typingConfig:cfg.typingConfig};
  let tab = await ensureTaskTab(
    "https://www.facebook.com/groups/discover",
    discoverStatus,
    t("p.gdOpening"),
    url=>/\/groups\/discover(\/|\?|$)/.test(url),
    async owner=>{
      await chrome.storage.local.set({isDiscoverJoining:true,discoverJoined:0,discoverRunConfig:{...discoverRunConfig,ownerTabId:owner.id},discoverStatus:t("p.gdRunning",{n:cfg.target})});
    }
  );if(!tab){setDiscoverRunning(false);await chrome.storage.local.set({isDiscoverJoining:false});await chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);return;}
  chrome.tabs.sendMessage(tab.id, { action:"startDiscoverJoin", ...cfg,ownerTabId:tab.id }, async res=>{
    if(chrome.runtime.lastError){
      const retry = await autoReloadAndRetry(tab.id, { action:"startDiscoverJoin", ...cfg,ownerTabId:tab.id }, discoverStatus);
      if(retry.ok){ setDiscoverRunning(true); discoverStatus.textContent=t("p.gdRunning",{n:cfg.target}); }
      else if(await runStillActive("isDiscoverJoining")){ setDiscoverRunning(true); discoverStatus.textContent=t("p.gdRunning",{n:cfg.target}); }
      else{await chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);setDiscoverRunning(false);}
      return;
    }
    if(res && res.ok){ setDiscoverRunning(true); discoverStatus.textContent=t("p.gdRunning",{n:cfg.target}); }
    else if(res && res.code==="join-busy"){ setDiscoverRunning(true); discoverStatus.textContent=t("p.gdRunning",{n:cfg.target}); }
    else if(await runStillActive("isDiscoverJoining")){ setDiscoverRunning(true); discoverStatus.textContent=t("p.gdRunning",{n:cfg.target}); }
    else{setDiscoverRunning(false);discoverStatus.textContent=res?.msg||t("p.gdStartFail");}
  });
};
discoverStopBtn.onclick = async ()=>{
  setDiscoverRunning(false);
  await chrome.storage.local.set({isDiscoverJoining:false,discoverStatus:t("p.stoppedX")});
  await chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);
  broadcastToFacebookTabs({action:"stopDiscoverJoin"});
  const tab=await getActiveTab();
  if(tab) chrome.tabs.sendMessage(tab.id, {action:"stopDiscoverJoin"}, ()=>setDiscoverRunning(false));
};
discoverResetBtn.onclick = async ()=>{
  await chrome.storage.local.set({discoverJoined:0,isDiscoverJoining:false,discoverStatus:t("p.resetDone")});
  await chrome.storage.local.remove(["discoverRunConfig","pendingDiscoverJoin","pendingDiscoverConfig"]);
  broadcastToFacebookTabs({action:"resetDiscoverJoin"});
  const tab=await getActiveTab();
  if(tab) chrome.tabs.sendMessage(tab.id, {action:"resetDiscoverJoin"}, ()=>{
    discoverCount.textContent="0 / "+(parseInt(discoverTarget.value)||10);
    discoverStatus.textContent=t("p.resetDone");
    setDiscoverRunning(false);
  });
};
chrome.storage.sync.get(["discoverTarget","discoverMinDelay","discoverMaxDelay","discoverConfirmWait","discoverAnswers"], res=>{
  if(res.discoverTarget) discoverTarget.value=res.discoverTarget;
  if(res.discoverMinDelay) discoverMinDelay.value=res.discoverMinDelay;
  if(res.discoverMaxDelay) discoverMaxDelay.value=res.discoverMaxDelay;
  if(res.discoverConfirmWait!==undefined) discoverConfirmWait.value=readJoinConfirmSeconds({value:res.discoverConfirmWait});
  if(res.discoverAnswers) discoverAnswers.value=res.discoverAnswers;
  discoverCount.textContent=`0 / ${parseInt(discoverTarget.value)||10}`;
});
chrome.storage.local.get(["discoverStatus","discoverJoined","isDiscoverJoining"], res=>{
  if(res.discoverStatus) discoverStatus.textContent=res.discoverStatus;
  if(res.discoverJoined!==undefined) discoverCount.textContent=`${res.discoverJoined} / ${parseInt(discoverTarget.value)||10}`;
  if(res.isDiscoverJoining) setDiscoverRunning(true);
});
chrome.storage.onChanged.addListener(changes=>{
  if(changes.discoverStatus) discoverStatus.textContent=changes.discoverStatus.newValue;
  if(changes.discoverJoined!==undefined) discoverCount.textContent=`${changes.discoverJoined.newValue} / ${parseInt(discoverTarget.value)||10}`;
  if(changes.isDiscoverJoining!==undefined) setDiscoverRunning(changes.isDiscoverJoining.newValue);
});
discoverTarget.addEventListener("change", ()=>{ discoverCount.textContent=`${0} / ${parseInt(discoverTarget.value)||10}`; });
discoverConfirmWait.addEventListener("change",()=>saveJoinConfirmSeconds(discoverConfirmWait,"discoverConfirmWait"));

// FEED & AI — nguồn Bạn bè / Nhóm / Page dùng filter thật của Bảng feed.
// Cache 2 chiều prompt thường/tag mỗi scope: textarea chỉ hiện 1 cái tại một
// thời điểm (tuỳ tick "Bật tag"), nhưng khi chạy cần gửi CẢ HAI xuống content
// script để nó tự chọn đúng prompt theo tỉ lệ % tag từng bài — nếu không, bài
// "không tag" vẫn dùng prompt tag (nhét tên page vào câu) do đó là prompt đang
// hiển thị trên UI lúc bấm Bắt đầu.
const feedDualPromptCache={};
const FEED_SCOPE_UI=Object.freeze({
  bantin:{id:"bantin",activeKey:"feedBantinActive",countKey:"feedBantinCount",statusKey:"feedBantinStatus",configKey:"feedBantinConfig",runIdKey:"feedBantinRunId",pendingKey:"pendingFeedBantin",pendingConfigKey:"pendingFeedBantinConfig",aiCountKey:"feedBantinAiCount",aiStatusKey:"feedBantinAiStatus",actionMode:$("feedBantinActionMode"),modeBadge:$("feedBantinModeBadge"),commentSettings:$("feedBantinCommentSettings"),aiPrompt:$("feedBantinAiPrompt"),aiTarget:$("feedBantinAiTarget"),aiStatus:$("feedBantinAiStatus"),aiCount:$("feedBantinAiCount"),reaction:$("feedBantinReaction"),target:$("feedBantinTarget"),minDelay:$("feedBantinMinDelay"),maxDelay:$("feedBantinMaxDelay"),economyMode:$("feedBantinEconomyMode"),cacheDays:$("feedBantinCacheDays"),start:$("feedBantinStartBtn"),stop:$("feedBantinStopBtn"),reset:$("feedBantinResetBtn"),scan:$("feedBantinScanBtn"),status:$("feedBantinStatus"),count:$("feedBantinCount"),tagEnabled:$("feedBantinTagEnabled")},
  friends:{id:"friends",activeKey:"feedFriendsActive",countKey:"feedFriendsCount",statusKey:"feedFriendsStatus",configKey:"feedFriendsConfig",runIdKey:"feedFriendsRunId",pendingKey:"pendingFeedFriends",pendingConfigKey:"pendingFeedFriendsConfig",aiCountKey:"feedFriendsAiCount",aiStatusKey:"feedFriendsAiStatus",actionMode:$("feedFriendsActionMode"),modeBadge:$("feedFriendsModeBadge"),commentSettings:$("feedFriendsCommentSettings"),aiPrompt:$("feedFriendsAiPrompt"),aiTarget:$("feedFriendsAiTarget"),aiStatus:$("feedFriendsAiStatus"),aiCount:$("feedFriendsAiCount"),reaction:$("feedFriendsReaction"),target:$("feedFriendsTarget"),minDelay:$("feedFriendsMinDelay"),maxDelay:$("feedFriendsMaxDelay"),economyMode:$("feedFriendsEconomyMode"),cacheDays:$("feedFriendsCacheDays"),start:$("feedFriendsStartBtn"),stop:$("feedFriendsStopBtn"),reset:$("feedFriendsResetBtn"),scan:$("feedFriendsScanBtn"),status:$("feedFriendsStatus"),count:$("feedFriendsCount"),tagEnabled:$("feedFriendsTagEnabled")},
  groups:{id:"groups",activeKey:"feedGroupsActive",countKey:"feedGroupsCount",statusKey:"feedGroupsStatus",configKey:"feedGroupsConfig",runIdKey:"feedGroupsRunId",pendingKey:"pendingFeedGroups",pendingConfigKey:"pendingFeedGroupsConfig",aiCountKey:"feedGroupsAiCount",aiStatusKey:"feedGroupsAiStatus",actionMode:$("feedGroupsActionMode"),modeBadge:$("feedGroupsModeBadge"),commentSettings:$("feedGroupsCommentSettings"),aiPrompt:$("feedGroupsAiPrompt"),aiTarget:$("feedGroupsAiTarget"),aiStatus:$("feedGroupsAiStatus"),aiCount:$("feedGroupsAiCount"),reaction:$("feedGroupsReaction"),target:$("feedGroupsTarget"),minDelay:$("feedGroupsMinDelay"),maxDelay:$("feedGroupsMaxDelay"),economyMode:$("feedGroupsEconomyMode"),cacheDays:$("feedGroupsCacheDays"),start:$("feedGroupsStartBtn"),stop:$("feedGroupsStopBtn"),reset:$("feedGroupsResetBtn"),scan:$("feedGroupsScanBtn"),status:$("feedGroupsStatus"),count:$("feedGroupsCount"),tagEnabled:$("feedGroupsTagEnabled")},
  pages:{id:"pages",activeKey:"feedPagesActive",countKey:"feedPagesCount",statusKey:"feedPagesStatus",configKey:"feedPagesConfig",runIdKey:"feedPagesRunId",pendingKey:"pendingFeedPages",pendingConfigKey:"pendingFeedPagesConfig",aiCountKey:"feedPagesAiCount",aiStatusKey:"feedPagesAiStatus",actionMode:$("feedPagesActionMode"),modeBadge:$("feedPagesModeBadge"),commentSettings:$("feedPagesCommentSettings"),aiPrompt:$("feedPagesAiPrompt"),aiTarget:$("feedPagesAiTarget"),aiStatus:$("feedPagesAiStatus"),aiCount:$("feedPagesAiCount"),reaction:$("feedPagesReaction"),target:$("feedPagesTarget"),minDelay:$("feedPagesMinDelay"),maxDelay:$("feedPagesMaxDelay"),economyMode:$("feedPagesEconomyMode"),cacheDays:$("feedPagesCacheDays"),start:$("feedPagesStartBtn"),stop:$("feedPagesStopBtn"),reset:$("feedPagesResetBtn"),scan:$("feedPagesScanBtn"),status:$("feedPagesStatus"),count:$("feedPagesCount"),tagEnabled:$("feedPagesTagEnabled")}
});
const feedScopeUiList=Object.values(FEED_SCOPE_UI);
const feedScheduleSource=$("feedScheduleSource");
// Compatibility aliases used by the existing one-time schedule snapshot;
// the snapshot below now reads the selected source dynamically.
const feedReaction=FEED_SCOPE_UI.friends.reaction,feedTarget=FEED_SCOPE_UI.friends.target,feedMinDelay=FEED_SCOPE_UI.friends.minDelay,feedMaxDelay=FEED_SCOPE_UI.friends.maxDelay;
function feedUiRouteMatches(url,source){
  try{const u=new URL(String(url||"")),host=u.hostname.toLowerCase();if(host!=="facebook.com"&&!host.endsWith(".facebook.com"))return false;const path=u.pathname.replace(/\/+$/g,"")||"/";return (path==="/"||path==="/home.php")&&(u.searchParams.get("filter")||"all").toLowerCase()===source;}catch{return false;}
}
const FEED_OTHER_ACTIVE_KEYS=["isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageNewsWallActive","pageCommentActive","pageSalesPostActive"];
function feedUiActionMode(ui){
  const mode=String(ui.actionMode?.value||"").toLowerCase();
  if(["like","comment","both"].includes(mode))return mode;
  return "like";
}
function feedUiUsesLike(ui){const mode=feedUiActionMode(ui);return mode==="like"||mode==="both";}
function feedUiUsesComment(ui){const mode=feedUiActionMode(ui);return mode==="comment"||mode==="both";}
function renderFeedMode(ui){
  const mode=feedUiActionMode(ui),comment=mode==="comment"||mode==="both";
  if(ui.modeBadge)ui.modeBadge.textContent=t(`fd.mode${mode[0].toUpperCase()+mode.slice(1)}`);
  if(ui.commentSettings)ui.commentSettings.hidden=!comment;
  const showLike=mode==="like"||mode==="both";
  [ui.reaction,ui.target].forEach(field=>{const wrapper=field?.parentElement;if(wrapper?.parentElement?.classList.contains("feed-core-grid"))wrapper.hidden=!showLike;});
}
const FEED_PROFILE_BY_SCOPE={bantin:"feedBantin",friends:"feedFriends",groups:"feedGroups",pages:"feedPages"};
async function feedUiSourceConfig(ui){
  const actionMode=feedUiActionMode(ui),aiEnabled=actionMode!=="like",shownPrompt=String(ui.aiPrompt?.value||"").trim();
  const cap2=ui.id[0].toUpperCase()+ui.id.slice(1);
  const prof=await getAiProfileFor(FEED_PROFILE_BY_SCOPE[ui.id]||"feedBantin").catch(()=>null);
  const tagOn=!!ui.tagEnabled?.checked;
  const nKey=`feed${cap2}AiPrompt`,tKey=`feed${cap2}AiTagPrompt`;
  // Textarea đang hiện prompt tương ứng trạng thái tick hiện tại; prompt còn
  // lại (không hiện) lấy từ cache 2 chiều, fallback về prompt mặc định i18n.
  const aiPrompt=tagOn?(feedDualPromptCache[nKey]||t("fd.aiPromptDefault")):shownPrompt;
  const aiTagPrompt=tagOn?shownPrompt:(feedDualPromptCache[tKey]||t("fd.aiTagPromptDefault"));
  const tagConfig=tagSections["feed"+cap2]?.getTagConfig(tagOn)||null;
  return {source:ui.id,actionMode,reaction:ui.reaction.value||"random",target:Math.max(1,Math.min(100000,parseInt(ui.target.value)||20)),minDelay:Math.max(1,parseInt(ui.minDelay.value)||3),maxDelay:Math.max(1,parseInt(ui.maxDelay.value)||8),aiEnabled,aiPrompt,aiTagPrompt,aiTarget:Math.max(1,Math.min(100000,parseInt(ui.aiTarget?.value)||5)),aiEconomyMode:["max","balanced","personal"].includes(ui.economyMode?.value)?ui.economyMode.value:"balanced",aiCacheDays:ui.cacheDays?Math.max(0,Math.min(3650,parseInt(ui.cacheDays.value)||7)):7,aiStyleProfileId:typeof aiStyleProfile!=="undefined"?String(aiStyleProfile?.value||""):"",aiConfig:{provider:prof?.provider||"",model:prof?.model||"",url:prof?.url||"",profileId:prof?.profileId||"",profileName:prof?.profileName||""},aiModerationEnabled:!!$("feedAiModerationEnabled")?.checked,aiTypingConfig:getAiTypingConfig("feed"+ui.id[0].toUpperCase()+ui.id.slice(1)),tagConfig};
}
function feedUiRunningStatus(ui,cfg){
  const mode=feedUiActionMode(ui),label=t(`fd.mode${mode[0].toUpperCase()+mode.slice(1)}`);
  return t("p.fdRunningMode",{mode:label,likeTarget:feedUiUsesLike(ui)?cfg.target:"—",commentTarget:feedUiUsesComment(ui)?cfg.aiTarget:"—"});
}
function setFeedScopeRunning(ui,value){ui.running=!!value;ui.start.textContent=ui.running?t("p.fdBusy"):t("fd.start");ui.start.classList.toggle("running",ui.running);[ui.actionMode,ui.aiTarget,ui.aiPrompt,ui.reaction,ui.target,ui.minDelay,ui.maxDelay].filter(Boolean).forEach(field=>field.disabled=ui.running);renderFeedMode(ui);}
function renderFeedScopeCounts(ui,likeCount,aiCount,likeTarget,aiTarget){
  const mode=feedUiActionMode(ui),showLike=mode==="like"||mode==="both",showComment=mode==="comment"||mode==="both";
  if(ui.count)ui.count.textContent=showLike?`${Math.max(0,parseInt(likeCount)||0)} / ${Math.max(1,parseInt(likeTarget)||parseInt(ui.target.value)||20)}`:"—";
  if(ui.aiCount)ui.aiCount.textContent=showComment?`${Math.max(0,parseInt(aiCount)||0)} / ${Math.max(1,parseInt(aiTarget)||parseInt(ui.aiTarget?.value)||5)}`:"—";
}
async function startFeedScope(source){
  const ui=FEED_SCOPE_UI[source];if(!ui)return;
  await tagSectionsReady;
  if(ui.running){ui.status.textContent=t("fd2.alreadyRunning");return;}
  const cfg=await feedUiSourceConfig(ui);
  if(cfg.minDelay>cfg.maxDelay){ui.status.textContent=t("p.delayBad");return;}
  if(cfg.aiEnabled&&(!cfg.aiPrompt.includes("{postText}")||(cfg.tagConfig&&!cfg.aiTagPrompt.includes("{postText}")))){ui.aiStatus.textContent=t("p.fdNeedPrompt");return;}
  if(cfg.aiEnabled&&cfg.tagConfig&&!cfg.aiTagPrompt.includes("{tagName}"))ui.aiStatus.textContent="⚠️ Prompt tag chưa có {tagName} — AI sẽ không nhúng tên vào comment (chỉ gắn @tag). Thêm {tagName} vào prompt tag để comment tự nhiên hơn.";
  const busy=await chrome.storage.local.get([...FEED_OTHER_ACTIVE_KEYS,"isFeedInteracting",...feedScopeUiList.map(item=>item.activeKey)]);
  const otherBusy=Object.entries(busy).some(([key,value])=>key!=="isFeedInteracting"&&Boolean(value));
  if(otherBusy){ui.status.textContent=t("p.shBusyFeed");return;}
  // Stop the legacy generic Feed loop before launching a scoped run. This is
  // also broadcast to old content-script tabs, where the loop may still be in
  // memory even after its storage flag was left behind by a previous run.
  if(busy.isFeedInteracting===true){
    await chrome.storage.local.set({isFeedInteracting:false});
    await chrome.storage.local.remove(["pendingFeedInteract","pendingFeedConfig"]);
    await broadcastToFacebookTabs({action:"stopFeedInteract"});
  }
  const runId=`feed-${source}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  cfg.runId=runId;
  const cap=source[0].toUpperCase()+source.slice(1);
  if(ui.tagEnabled)chrome.storage.sync.set({[`feed${cap}TagEnabled`]:ui.tagEnabled.checked});
  const _pKey=ui.tagEnabled?.checked?`feed${cap}AiTagPrompt`:`feed${cap}AiPrompt`;
  await chrome.storage.sync.set({[`feed${cap}ActionMode`]:cfg.actionMode,[`feed${cap}Reaction`]:cfg.reaction,[`feed${cap}Target`]:cfg.target,[`feed${cap}MinDelay`]:cfg.minDelay,[`feed${cap}MaxDelay`]:cfg.maxDelay,[`feed${cap}AiEnabled`]:cfg.aiEnabled,[_pKey]:cfg.aiPrompt,[`feed${cap}AiTarget`]:cfg.aiTarget});
  setFeedScopeRunning(ui,true);
  const targetUrl=`https://www.facebook.com/?filter=${source}&sk=h_chr`;
  const tab=await ensureTaskTab(targetUrl,ui.status,t("p.fdOpening"),url=>feedUiRouteMatches(url,source),async owner=>{
    const storedCfg={...cfg,ownerTabId:owner.id};
    await chrome.storage.local.set({[ui.activeKey]:true,[ui.runIdKey]:runId,[ui.configKey]:storedCfg,[ui.countKey]:0,[ui.aiCountKey]:0,[ui.aiStatusKey]:cfg.aiEnabled?t("fd2.aiWaiting",{done:0,target:cfg.aiTarget}):"",[ui.pendingKey]:true,[ui.pendingConfigKey]:storedCfg,[ui.statusKey]:t("p.fdOpening")});
  });
  if(!tab){setFeedScopeRunning(ui,false);await chrome.storage.local.set({[ui.activeKey]:false});await chrome.storage.local.remove([ui.pendingKey,ui.pendingConfigKey]);return;}
  const message={action:"startFeedScoped",source,...cfg,ownerTabId:tab.id,runId};
  chrome.tabs.sendMessage(tab.id,message,async response=>{
    if(chrome.runtime.lastError){
      const retry=await autoReloadAndRetry(tab.id,message,ui.status);
      if(retry.ok||await runStillActive(ui.activeKey)){setFeedScopeRunning(ui,true);ui.status.textContent=feedUiRunningStatus(ui,cfg);}
      else{setFeedScopeRunning(ui,false);ui.status.textContent=t("p.fdStartFail");}
      return;
    }
    if(response?.ok||await runStillActive(ui.activeKey)){setFeedScopeRunning(ui,true);ui.status.textContent=feedUiRunningStatus(ui,cfg);}
    else{setFeedScopeRunning(ui,false);ui.status.textContent=response?.error||t("p.fdStartFail");}
  });
}
async function stopFeedScope(source){
  const ui=FEED_SCOPE_UI[source];if(!ui)return;
  setFeedScopeRunning(ui,false);
  await chrome.storage.local.set({[ui.activeKey]:false,[ui.statusKey]:t("p.stoppedX"),[ui.aiStatusKey]:t("p.stoppedX")});
  await chrome.storage.local.remove([ui.pendingKey,ui.pendingConfigKey]);
  const tab=await getActiveTab();if(tab)chrome.tabs.sendMessage(tab.id,{action:"stopFeedScoped",source},()=>{});
  broadcastToFacebookTabs({action:"stopFeedScoped",source});
}
async function resetFeedScope(source){
  const ui=FEED_SCOPE_UI[source];if(!ui)return;
  setFeedScopeRunning(ui,false);
  await chrome.storage.local.set({[ui.activeKey]:false,[ui.countKey]:0,[ui.aiCountKey]:0,[ui.statusKey]:t("p.resetDone"),[ui.aiStatusKey]:t("p.resetDone")});
  await chrome.storage.local.remove([ui.pendingKey,ui.pendingConfigKey]);
  renderFeedScopeCounts(ui,0,0,ui.target.value,ui.aiTarget.value);
  const tab=await getActiveTab();if(tab)chrome.tabs.sendMessage(tab.id,{action:"resetFeedScoped",source},()=>{});
  broadcastToFacebookTabs({action:"resetFeedScoped",source});
}
async function scanFeedScope(source){
  const ui=FEED_SCOPE_UI[source],tab=await getActiveTab();if(!ui)return;
  if(!tab||!tab.url?.includes("facebook.com")){ui.status.textContent=t("p.fdNeedFb");return;}
  if(!feedUiRouteMatches(tab.url,source)){ui.status.textContent=t("fd2.openSource");return;}
  chrome.tabs.sendMessage(tab.id,{action:"scanFeedScope",source,actionMode:feedUiActionMode(ui)},res=>{
    if(chrome.runtime.lastError){ui.status.textContent=t("p.reloadRetry");return;}
    ui.status.textContent=t("p.fdScanOk",{n:res?.count||0});
    renderFeedScopeCounts(ui,0,0,ui.target.value,ui.aiTarget.value);
  });
}
feedScopeUiList.forEach(ui=>{
  ui.start.onclick=()=>startFeedScope(ui.id);
  ui.stop.onclick=()=>stopFeedScope(ui.id);
  ui.reset.onclick=()=>resetFeedScope(ui.id);
  ui.scan.onclick=()=>scanFeedScope(ui.id);
  ui.actionMode.addEventListener("change",()=>{
    const cap=ui.id[0].toUpperCase()+ui.id.slice(1);
    renderFeedMode(ui);renderFeedScopeCounts(ui,0,0,ui.target.value,ui.aiTarget.value);
    chrome.storage.sync.set({[`feed${cap}ActionMode`]:feedUiActionMode(ui),[`feed${cap}AiEnabled`]:feedUiUsesComment(ui)});
  });
  ui.target.addEventListener("change",()=>renderFeedScopeCounts(ui,0,0,ui.target.value,ui.aiTarget.value));
  const _tagCap=ui.id[0].toUpperCase()+ui.id.slice(1);
  const _nKey=`feed${_tagCap}AiPrompt`,_tKey=`feed${_tagCap}AiTagPrompt`;
  const _tagToggleEl=document.getElementById(`feed${_tagCap}TagEnabled`);
  const _isTagOn=()=>!!_tagToggleEl?.checked;
  if(ui.aiPrompt){let _pt=0;const _sv=()=>{feedDualPromptCache[_isTagOn()?_tKey:_nKey]=ui.aiPrompt.value;clearTimeout(_pt);_pt=setTimeout(()=>chrome.storage.sync.set({[_isTagOn()?_tKey:_nKey]:ui.aiPrompt.value}),250);};ui.aiPrompt.addEventListener("input",_sv);ui.aiPrompt.addEventListener("change",_sv);ui.aiPrompt.addEventListener("blur",_sv);}
  if(_tagToggleEl&&ui.aiPrompt){_tagToggleEl.addEventListener("change",()=>{if(_tagToggleEl.checked){if(!ui.aiPrompt.value.includes("{tagName}")){feedDualPromptCache[_nKey]=ui.aiPrompt.value;chrome.storage.sync.set({[_nKey]:ui.aiPrompt.value});}chrome.storage.sync.get([_tKey],r=>{const s=r[_tKey];const v=(s&&s.includes("{tagName}"))?s:t("fd.aiTagPromptDefault");ui.aiPrompt.value=v;feedDualPromptCache[_tKey]=v;});}else{if(ui.aiPrompt.value.includes("{tagName}")){feedDualPromptCache[_tKey]=ui.aiPrompt.value;chrome.storage.sync.set({[_tKey]:ui.aiPrompt.value});}chrome.storage.sync.get([_nKey],r=>{const s=r[_nKey];const v=(s&&!s.includes("{tagName}"))?s:t("fd.aiPromptDefault");ui.aiPrompt.value=v;feedDualPromptCache[_nKey]=v;});}});}
  ui.aiTarget.addEventListener("change",()=>chrome.storage.sync.set({[`feed${_tagCap}AiTarget`]:Math.max(1,Math.min(100000,parseInt(ui.aiTarget.value)||5))}));
  if(ui.economyMode)ui.economyMode.addEventListener("change",()=>chrome.storage.sync.set({[`feed${_tagCap}EconomyMode`]:ui.economyMode.value}));
  if(ui.cacheDays)ui.cacheDays.addEventListener("change",()=>chrome.storage.sync.set({[`feed${_tagCap}CacheDays`]:Math.max(0,Math.min(3650,parseInt(ui.cacheDays.value)||7))}));
  renderFeedMode(ui);
});
if($("feedAiModerationEnabled")){
  $("feedAiModerationEnabled").addEventListener("change",()=>{
    chrome.storage.sync.set({feedAiModerationEnabled:$("feedAiModerationEnabled").checked});
  });
}
chrome.storage.sync.get(["feedAiModerationEnabled",...feedScopeUiList.flatMap(ui=>{const cap=ui.id[0].toUpperCase()+ui.id.slice(1);return [`feed${cap}ActionMode`,`feed${cap}Reaction`,`feed${cap}Target`,`feed${cap}MinDelay`,`feed${cap}MaxDelay`,`feed${cap}AiEnabled`,`feed${cap}AiPrompt`,`feed${cap}AiTagPrompt`,`feed${cap}AiTarget`,`feed${cap}EconomyMode`,`feed${cap}CacheDays`,`feed${cap}TagEnabled`];})],saved=>{
  if($("feedAiModerationEnabled")&&saved.feedAiModerationEnabled!==undefined)$("feedAiModerationEnabled").checked=!!saved.feedAiModerationEnabled;
  feedScopeUiList.forEach(ui=>{const cap=ui.id[0].toUpperCase()+ui.id.slice(1);const savedMode=saved[`feed${cap}ActionMode`];ui.actionMode.value=["like","comment","both"].includes(savedMode)?savedMode:(saved[`feed${cap}AiEnabled`]?"both":"like");if(saved[`feed${cap}Reaction`])ui.reaction.value=saved[`feed${cap}Reaction`];if(saved[`feed${cap}Target`]!==undefined)ui.target.value=saved[`feed${cap}Target`];if(saved[`feed${cap}MinDelay`]!==undefined)ui.minDelay.value=saved[`feed${cap}MinDelay`];if(saved[`feed${cap}MaxDelay`]!==undefined)ui.maxDelay.value=saved[`feed${cap}MaxDelay`];if(saved[`feed${cap}AiTarget`]!==undefined)ui.aiTarget.value=saved[`feed${cap}AiTarget`];if(ui.economyMode&&["max","balanced","personal"].includes(saved[`feed${cap}EconomyMode`]))ui.economyMode.value=saved[`feed${cap}EconomyMode`];if(ui.cacheDays&&saved[`feed${cap}CacheDays`]!==undefined)ui.cacheDays.value=saved[`feed${cap}CacheDays`];feedDualPromptCache[`feed${cap}AiPrompt`]=saved[`feed${cap}AiPrompt`]||t("fd.aiPromptDefault");const _tpRaw=saved[`feed${cap}AiTagPrompt`];const _tpVal=(_tpRaw&&_tpRaw.includes("{tagName}"))?_tpRaw:t("fd.aiTagPromptDefault");if(_tpRaw!==_tpVal)chrome.storage.sync.set({[`feed${cap}AiTagPrompt`]:_tpVal});feedDualPromptCache[`feed${cap}AiTagPrompt`]=_tpVal;if(ui.tagEnabled&&saved[`feed${cap}TagEnabled`]){ui.tagEnabled.checked=true;if(ui.aiPrompt)ui.aiPrompt.value=_tpVal;}else if(ui.aiPrompt){const _sp=saved[`feed${cap}AiPrompt`];if(_sp&&!_sp.includes("{tagName}"))ui.aiPrompt.value=_sp;else if(ui.aiPrompt.value.includes("{tagName}"))ui.aiPrompt.value=t("fd.aiPromptDefault");}renderFeedMode(ui);renderFeedScopeCounts(ui,0,0,ui.target.value,ui.aiTarget.value);});
});
chrome.storage.local.get(feedScopeUiList.flatMap(ui=>[ui.activeKey,ui.countKey,ui.statusKey,ui.configKey,ui.aiCountKey,ui.aiStatusKey]),saved=>{
  feedScopeUiList.forEach(ui=>{const cfg=saved[ui.configKey]||{},active=Boolean(saved[ui.activeKey]);if(active&&cfg.actionMode&&ui.actionMode)ui.actionMode.value=cfg.actionMode;if(saved[ui.statusKey])ui.status.textContent=saved[ui.statusKey];if(saved[ui.aiStatusKey])ui.aiStatus.textContent=saved[ui.aiStatusKey];renderFeedMode(ui);renderFeedScopeCounts(ui,saved[ui.countKey],saved[ui.aiCountKey],active&&cfg.target?cfg.target:ui.target.value,active&&cfg.aiTarget?cfg.aiTarget:ui.aiTarget.value);if(active)setFeedScopeRunning(ui,true);});
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  feedScopeUiList.forEach(ui=>{if(changes[ui.statusKey])ui.status.textContent=changes[ui.statusKey].newValue||"";if(changes[ui.aiStatusKey])ui.aiStatus.textContent=changes[ui.aiStatusKey].newValue||"";if(changes[ui.countKey]||changes[ui.aiCountKey]||changes[ui.configKey]||changes[ui.activeKey]){const cfg=changes[ui.configKey]?.newValue||{},active=changes[ui.activeKey]?.newValue??ui.running,currentLike=parseInt(String(ui.count?.textContent||"").split("/")[0])||0,currentComment=parseInt(String(ui.aiCount?.textContent||"").split("/")[0])||0;if(active&&cfg.actionMode&&!ui.running)ui.actionMode.value=cfg.actionMode;renderFeedMode(ui);renderFeedScopeCounts(ui,changes[ui.countKey]?.newValue??currentLike,changes[ui.aiCountKey]?.newValue??currentComment,active&&cfg.target?cfg.target:ui.target.value,active&&cfg.aiTarget?cfg.aiTarget:ui.aiTarget.value);}if(changes[ui.activeKey])setFeedScopeRunning(ui,!!changes[ui.activeKey].newValue);});
});

// TUONG TAC NHOM DA THAM GIA (card Like + card Comment AI dùng chung 1 selection, 2 list mirror nhau)
const joinedGroupList=$("joinedGroupList"), loadJoinedGroupsBtn=$("loadJoinedGroupsBtn"), selectAllGroupsBtn=$("selectAllGroupsBtn");
const groupInteractKeyword=$("groupInteractKeyword"),selectKeywordGroupsBtn=$("selectKeywordGroupsBtn");
const joinedGroupListComment=$("joinedGroupListComment"), loadCommentGroupsBtn=$("loadCommentGroupsBtn"), selectAllCommentGroupsBtn=$("selectAllCommentGroupsBtn");
const groupCommentKeyword=$("groupCommentKeyword"),selectKeywordCommentGroupsBtn=$("selectKeywordCommentGroupsBtn");
const groupLogFilterComment=$("groupLogFilterComment"),loadFromLogCommentBtn=$("loadFromLogCommentBtn");
function joinedGroupLists(){return [joinedGroupList,joinedGroupListComment].filter(el=>el);}
const groupInteractReaction=$("groupInteractReaction"), groupInteractTarget=$("groupInteractTarget");
const groupInteractActionMode=$("groupInteractActionMode");
const groupInteractGroupLimit=$("groupInteractGroupLimit");
const groupCommentGroupLimit=$("groupCommentGroupLimit"), groupCommentTarget=$("groupCommentTarget");
const groupCommentMinDelay=$("groupCommentMinDelay"), groupCommentMaxDelay=$("groupCommentMaxDelay");
const groupCommentEconomyMode=$("groupCommentEconomyMode"), groupCommentCacheDays=$("groupCommentCacheDays");
const groupInteractMinDelay=$("groupInteractMinDelay"), groupInteractMaxDelay=$("groupInteractMaxDelay");
const groupInteractStartBtn=$("groupInteractStartBtn"), groupInteractStopBtn=$("groupInteractStopBtn"), groupInteractResetBtn=$("groupInteractResetBtn");
const groupCommentStartBtn=$("groupCommentStartBtn"), groupCommentStopBtn=$("groupCommentStopBtn"), groupCommentResetBtn=$("groupCommentResetBtn");
const groupInteractStatus=$("groupInteractStatus"), groupInteractCount=$("groupInteractCount");
const groupInteractAiPrompt=$("groupInteractAiPrompt");
if(groupInteractAiPrompt){const _isTagGI=()=>!!commentTagEnabled?.checked;let _giPt=0;const _giSv=()=>{const _k=_isTagGI()?"groupInteractAiTagPrompt":"groupInteractAiPrompt";feedDualPromptCache[_k]=groupInteractAiPrompt.value;clearTimeout(_giPt);_giPt=setTimeout(()=>chrome.storage.sync.set({[_k]:groupInteractAiPrompt.value}),250);};groupInteractAiPrompt.addEventListener("input",_giSv);groupInteractAiPrompt.addEventListener("change",_giSv);groupInteractAiPrompt.addEventListener("blur",_giSv);}
const groupCommentStatus=$("groupCommentStatus"), groupCommentCount=$("groupCommentCount");
const commentTagEnabled=document.getElementById("commentTagEnabled");
if(commentTagEnabled&&groupInteractAiPrompt){commentTagEnabled.addEventListener("change",()=>{if(commentTagEnabled.checked){if(!groupInteractAiPrompt.value.includes("{tagName}")){feedDualPromptCache.groupInteractAiPrompt=groupInteractAiPrompt.value;chrome.storage.sync.set({groupInteractAiPrompt:groupInteractAiPrompt.value});}chrome.storage.sync.get(["groupInteractAiTagPrompt"],r=>{const s=r.groupInteractAiTagPrompt;const v=(s&&s.includes("{tagName}"))?s:t("fd.aiTagPromptDefault");groupInteractAiPrompt.value=v;feedDualPromptCache.groupInteractAiTagPrompt=v;});}else{if(groupInteractAiPrompt.value.includes("{tagName}")){feedDualPromptCache.groupInteractAiTagPrompt=groupInteractAiPrompt.value;chrome.storage.sync.set({groupInteractAiTagPrompt:groupInteractAiPrompt.value});}chrome.storage.sync.get(["groupInteractAiPrompt"],r=>{const s=r.groupInteractAiPrompt;const v=(s&&!s.includes("{tagName}"))?s:t("fd.aiPromptDefault");groupInteractAiPrompt.value=v;feedDualPromptCache.groupInteractAiPrompt=v;});}});}
async function fetchFbEntityName(url,nameEl,fetchBtn){
  if(!url)return;
  if(nameEl)nameEl.textContent="⏳ Đang lấy tên...";
  if(fetchBtn)fetchBtn.disabled=true;
  try{
    const res=await chrome.runtime.sendMessage({action:"fetchFbEntityName",url});
    if(res?.ok&&res.name){
      if(nameEl)nameEl.textContent="✅ "+res.name;
      return res.name;
    }else{
      if(nameEl)nameEl.textContent="❌ "+(res?.error||"Không lấy được tên");
    }
  }catch(e){if(nameEl)nameEl.textContent="❌ Lỗi kết nối";}
  finally{if(fetchBtn)fetchBtn.disabled=false;}
  return null;
}
// ── Unified multi-entity tag section (textarea + checkbox list + seq/rand) ──
function setupTagSection(prefix,enabledId){
  const eKey=enabledId||prefix+"TagEnabled";
  const enabledEl=document.getElementById(eKey);
  const detailsEl=document.getElementById(prefix+"TagDetails");
  const urlsEl=document.getElementById(prefix+"TagUrls");
  const fetchAllBtn=document.getElementById(prefix+"TagFetchAllBtn");
  const entityListEl=document.getElementById(prefix+"TagEntityList");
  const rateEl=document.getElementById(prefix+"TagRate");
  const rateValEl=document.getElementById(prefix+"TagRateVal");
  const getOrder=()=>document.querySelector(`[name="${prefix}TagOrder"]:checked`)?.value||"seq";
  let entities=[];
  let resolving=false;
  function saveEntities(){
    chrome.storage.sync.set({[prefix+"TagUrls"]:urlsEl?.value||"",[prefix+"TagEntities"]:JSON.stringify(entities)});
  }
  function renderEntityList(){
    if(!entityListEl)return;
    entityListEl.innerHTML="";
    entities.forEach((e,i)=>{
      const row=document.createElement("label");
      row.style.cssText="font-size:11px;cursor:pointer;display:flex;align-items:center;gap:5px;padding:1px 0";
      const cb=document.createElement("input");
      cb.type="checkbox";cb.checked=e.enabled!==false;
      if(!e.name)cb.disabled=true;
      cb.addEventListener("change",()=>{entities[i].enabled=cb.checked;saveEntities();});
      const icon=e.name?"✅":"❌";
      const label=e.name?e.name:(e.url.replace(/^https?:\/\/(?:www\.)?facebook\.com\//,"").slice(0,35)+"…");
      const type=e.url.includes("/groups/")?" 👥":" 📄";
      row.appendChild(cb);row.appendChild(document.createTextNode(" "+icon+" "+label+type));
      entityListEl.appendChild(row);
    });
  }
  if(enabledEl)enabledEl.addEventListener("change",()=>{
    if(detailsEl)detailsEl.style.display=enabledEl.checked?"":"none";
    chrome.storage.sync.set({[eKey]:enabledEl.checked});
  });
  document.querySelectorAll(`[name="${prefix}TagOrder"]`).forEach(r=>{
    r.addEventListener("change",()=>chrome.storage.sync.set({[prefix+"TagOrder"]:getOrder()}));
  });
  if(rateEl){
    rateEl.addEventListener("input",()=>{if(rateValEl)rateValEl.textContent=rateEl.value+"%";});
    rateEl.addEventListener("change",()=>chrome.storage.sync.set({[prefix+"TagRate"]:rateEl.value}));
  }
  if(fetchAllBtn)fetchAllBtn.onclick=async()=>{
    const raw=(urlsEl?.value||"").trim();
    if(!raw)return;
    const urls=[...new Set(raw.split("\n").map(l=>l.trim()).filter(l=>l.startsWith("http")))];
    if(!urls.length)return;
    fetchAllBtn.disabled=true;
    resolving=true;
    const oldState={};entities.forEach(e=>{oldState[e.url]={enabled:e.enabled!==false,hadName:!!e.name,name:String(e.name||"")};});
    entities=[];
    for(let i=0;i<urls.length;i++){
      const url=urls[i];
      fetchAllBtn.textContent=`⏳ ${i+1}/${urls.length}…`;
      try{
        const res=await chrome.runtime.sendMessage({action:"fetchFbEntityName",url});
        const name=res?.ok?String(res.name||"").trim():"";
        // Re-enable nếu entity trước không có tên (fetch fail cũ), nhưng giữ disabled nếu user đã tắt thủ công (hadName=true)
        // Nếu Facebook trả về một chuỗi UI rác hoặc timeout, giữ nguyên tên
        // đúng đã lưu thay vì ghi đè thành rỗng/sai (bảo toàn cấu hình tag).
        const fallback=oldState[url]?.name||"";
        const finalName=name||fallback;
        const enabled=finalName?(!oldState[url]?.hadName||oldState[url]?.enabled):false;
        entities.push({url,name:finalName,enabled});
      }catch(err){entities.push({url,name:oldState[url]?.name||"",enabled:oldState[url]?.name?oldState[url].enabled:false});}
      renderEntityList();
    }
    fetchAllBtn.textContent="✓ Lấy tên tất cả";fetchAllBtn.disabled=false;resolving=false;
    saveEntities();
    // Sync cả URLs lẫn entities sang tất cả các section khác
    Object.keys(tagSections).forEach(p=>{if(p!==prefix)tagSections[p]?.setUrlsAndEntities(raw,entities.map(e=>({...e})));});
  };
  function setEntities(arr){entities=arr;renderEntityList();saveEntities();}
  function setUrlsAndEntities(rawUrls,arr){if(urlsEl&&rawUrls)urlsEl.value=rawUrls;entities=arr;renderEntityList();saveEntities();}
  function getTagConfig(enabled){
    if(!enabled)return null;
    // User đổi URL trong textarea mà chưa bấm "Lấy tên tất cả" thì entities
    // cũ còn giữ tên của URL cũ — tag theo tên đó sẽ tag SAI page/group
    // (user báo Bảng Feed tag sai tên). Chỉ giữ entity có URL vẫn còn trong
    // danh sách hiện tại (so khớp bỏ slash cuối); không còn entity nào khớp
    // thì trả null để luồng chạy không tag thay vì tag bừa tên cũ.
    let urlSet=null;
    try{
      const raw=String(urlsEl?.value||"").split(/\r?\n/).map(l=>l.trim()).filter(l=>l.startsWith("http"));
      if(raw.length)urlSet=new Set(raw.map(u=>u.replace(/\/+$/,"")));
    }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const active=entities.filter(e=>{
      if(e.enabled===false||!e.name)return false;
      if(urlSet&&!urlSet.has(String(e.url||"").trim().replace(/\/+$/,"")))return false;
      return true;
    });
    if(!active.length)return null;
    return{entities:active.map(e=>({url:e.url,name:e.name})),mode:getOrder(),rate:rateEl?parseInt(rateEl.value)||70:70};
  }
  function loadFrom(r){
    if(r[eKey]&&enabledEl){enabledEl.checked=true;if(detailsEl)detailsEl.style.display="";}
    if(r[prefix+"TagUrls"]&&urlsEl)urlsEl.value=r[prefix+"TagUrls"];
    if(r[prefix+"TagEntities"]){try{entities=JSON.parse(r[prefix+"TagEntities"]);}catch(ex){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", ex); }renderEntityList();}
    const order=r[prefix+"TagOrder"];
    if(order){const el=document.querySelector(`[name="${prefix}TagOrder"][value="${order}"]`);if(el)el.checked=true;}
    if(r[prefix+"TagRate"]!=null&&rateEl){rateEl.value=r[prefix+"TagRate"];if(rateValEl)rateValEl.textContent=rateEl.value+"%";}
  }
  return{getTagConfig,loadFrom,setEntities,setUrlsAndEntities,isResolving:()=>resolving};
}
const tagSections={};
// A Start click can happen before chrome.storage.sync has hydrated the tag
// entity list.  Running in that gap silently produces tagConfig:null, which
// turns a requested tagged Comment AI run into an untagged one.  All tag-aware
// starts await this barrier before taking their config snapshot.
let resolveTagSectionsReady;
const tagSectionsReady=new Promise(resolve=>{resolveTagSectionsReady=resolve;});
tagSections["commentTag"]=setupTagSection("commentTag","commentTagEnabled");
tagSections["pageComment"]=setupTagSection("pageComment","pageCommentTagEnabled");
tagSections["pageGroupComment"]=setupTagSection("pageGroupComment","pageGroupCommentTagEnabled");
["feedBantin","feedFriends","feedGroups","feedPages","ai"].forEach(p=>{tagSections[p]=setupTagSection(p);});
const TAG_ALL_KEYS=["feedBantin","feedFriends","feedGroups","feedPages","ai","pageComment","pageGroupComment"].flatMap(p=>[p+"TagEnabled",p+"TagUrls",p+"TagEntities",p+"TagOrder",p+"TagRate"]).concat(["commentTagEnabled","commentTagTagUrls","commentTagTagEntities","commentTagTagOrder","commentTagTagRate","groupInteractAiPrompt","groupInteractAiTagPrompt"]);
chrome.storage.sync.get(TAG_ALL_KEYS,saved=>{
  Object.keys(tagSections).forEach(p=>tagSections[p]?.loadFrom(saved));
  // On first load: if only some sections have saved URLs, propagate the first non-empty to the rest
  const TAG_URL_PREFIXES=["feedBantin","feedFriends","feedGroups","feedPages","ai","commentTag","pageComment"];
  const masterUrl=TAG_URL_PREFIXES.map(p=>saved[p+"TagUrls"]).find(v=>v);
  if(masterUrl){const toFill={};TAG_URL_PREFIXES.forEach(p=>{if(!saved[p+"TagUrls"]){const el=document.getElementById(p+"TagUrls");if(el)el.value=masterUrl;toFill[p+"TagUrls"]=masterUrl;}});if(Object.keys(toFill).length)chrome.storage.sync.set(toFill);}
  // Load groupInteract prompt based on commentTag state
  if(groupInteractAiPrompt){feedDualPromptCache.groupInteractAiPrompt=saved.groupInteractAiPrompt||t("fd.aiPromptDefault");feedDualPromptCache.groupInteractAiTagPrompt=saved.groupInteractAiTagPrompt||t("fd.aiTagPromptDefault");if(saved.commentTagEnabled){const s=saved.groupInteractAiTagPrompt;groupInteractAiPrompt.value=s||t("fd.aiTagPromptDefault");}else{const s=saved.groupInteractAiPrompt;if(s)groupInteractAiPrompt.value=s;}}
  // Dataset theo Page (nếu có) thắng tag global vừa nạp ở trên.
  try{selectedPageDatasetPromise().then(r=>{if(!r||!r.ds)return;try{pageApplyTagSnapshot("pageGroupComment",r.ds.gcomment.tag);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }try{pageApplyTagSnapshot("pageComment",r.ds.fcomment.tag);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}).catch(()=>{});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  resolveTagSectionsReady?.();
});
// Sync tag URL textareas in real-time: typing in one propagates to all others
(function(){
  const TAG_URL_PREFIXES=["feedBantin","feedFriends","feedGroups","feedPages","ai","commentTag","pageComment"];
  const els=TAG_URL_PREFIXES.map(p=>document.getElementById(p+"TagUrls")).filter(Boolean);
  let _sync=false;
  els.forEach(el=>{
    el.addEventListener("input",()=>{
      if(_sync)return;_sync=true;
      const v=el.value;const toSave={};
      TAG_URL_PREFIXES.forEach(p=>{const o=document.getElementById(p+"TagUrls");if(o&&o!==el)o.value=v;toSave[p+"TagUrls"]=v;});
      chrome.storage.sync.set(toSave);
      _sync=false;
    });
  });
})();
let isGroupInteractRunning=false,isGroupCommentRunning=false;
function setGroupInteractRunning(v){isGroupInteractRunning=!!v;groupInteractStartBtn.textContent=v?t("p.giBusy"):t("gi.reactionStart");groupInteractStartBtn.classList.toggle("running",!!v);}
function setGroupCommentRunning(v){isGroupCommentRunning=!!v;groupCommentStartBtn.textContent=v?t("p.giCommentBusy"):t("gi.commentStart");groupCommentStartBtn.classList.toggle("running",!!v);}
let joinedGroups=[];
let joinedGroupSelectionIds=new Set();
const localizeJoinedGroupStatus=value=>{
  const s=String(value||"");
  return /^gi2\./.test(s)?t(s):s;
};
function persistJoinedGroupSelection(){
  chrome.storage.local.set({groupInteractSelectedIds:[...joinedGroupSelectionIds]}).catch(()=>{});
}
// Đếm "Đã chọn" trên 3 card Đăng/Like/Comment (chỉ đọc DOM + state, không đổi logic chạy)
function updateGroupPickCounts(){
  try{
    const pc=document.getElementById("groupPostSelectedCount");
    if(pc){
      let total=0,sel=0;
      try{
        if(Array.isArray(postGroups))total=postGroups.length;
        if(typeof selectedPostGroups==="function")sel=selectedPostGroups().length;
        else{const pl=document.getElementById("groupPostList");if(pl)sel=pl.querySelectorAll(".post-group-check:checked").length;}
      }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
      pc.textContent=`${sel} / ${total}`;
    }
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  try{
    const n=Array.isArray(joinedGroups)?joinedGroups.length:0;
    const s=(joinedGroupSelectionIds instanceof Set)?joinedGroupSelectionIds.size:0;
    const a=document.getElementById("groupInteractSelectedCount"),b=document.getElementById("groupCommentSelectedCount");
    if(a)a.textContent=`${s} / ${n}`;
    if(b)b.textContent=`${s} / ${n}`;
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
document.addEventListener("change",e=>{
  const t=e.target;
  if(t&&t.matches&&(t.matches(".joined-group-check")||t.matches(".post-group-check")))updateGroupPickCounts();
});
// Đổ state tick sang cả 2 list để Like và Comment luôn thấy cùng selection
function paintJoinedGroupChecks(){
  joinedGroupLists().forEach(list=>{list.querySelectorAll('.joined-group-check').forEach(box=>{box.checked=joinedGroupSelectionIds.has(String(box.value));});});
}
// Nhận selection từ list đang thao tác rồi mirror sang list còn lại
function adoptJoinedSelectionFrom(listEl){
  if(!listEl)return [...joinedGroupSelectionIds];
  joinedGroupSelectionIds=new Set([...listEl.querySelectorAll('.joined-group-check:checked')].map(b=>String(b.value)));
  paintJoinedGroupChecks();
  persistJoinedGroupSelection();
  updateGroupPickCounts();
  return [...joinedGroupSelectionIds];
}
function syncJoinedGroupSelection(){
  if(joinedGroupList)adoptJoinedSelectionFrom(joinedGroupList);
  return [...joinedGroupSelectionIds];
}
function bindJoinedGroupSelectionHandlers(listEl){
  (listEl||joinedGroupList).querySelectorAll('.joined-group-check').forEach(box=>{
    const syncOne=()=>{const host=box.closest('#joinedGroupListComment')?joinedGroupListComment:joinedGroupList;adoptJoinedSelectionFrom(host||joinedGroupList);};
    box.addEventListener('change',syncOne);
    box.addEventListener('click',()=>setTimeout(syncOne,0));
  });
}
function getSelectedJoinedGroups(){
  syncJoinedGroupSelection();
  const ids=new Set(joinedGroupSelectionIds);
  return joinedGroups.filter(g=>ids.has(String(g.id)));
}
function renderJoinedGroups(groups,selectedIds=[]){
  joinedGroups=groups||[];
  const escapeHtml=value=>String(value||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  if(!joinedGroups.length){
    joinedGroupLists().forEach(list=>{list.innerHTML='<div class="hint" style="padding:6px">'+t("p.giNotFound")+'</div>';});
    joinedGroupSelectionIds=new Set();
    persistJoinedGroupSelection();
    updateGroupPickCounts();
    return;
  }
  joinedGroupSelectionIds=new Set((selectedIds||[]).map(String));
  const selected=joinedGroupSelectionIds;
  const html=joinedGroups.map(g=>{
    const name=String(g?.name||""),id=String(g?.id||""),icon=String(g?.icon||"icon128.png");
    return `<label data-group-id="${escapeHtml(id)}" data-group-name="${escapeHtml(name.toLowerCase())}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee;cursor:pointer"><input class="joined-group-check" type="checkbox" value="${escapeHtml(id)}" ${selected.has(id)?"checked":""} style="width:auto"><img src="${escapeHtml(icon)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover"><span style="font-size:12px;line-height:1.2">${escapeHtml(name)}</span></label>`;
  }).join("");
  joinedGroupLists().forEach(list=>{list.innerHTML=html;bindJoinedGroupSelectionHandlers(list);});
  persistJoinedGroupSelection();
  updateGroupPickCounts();
}
function toggleSelectAllJoined(listEl,btnEl){
  if(!listEl)return;
  const boxes=[...listEl.querySelectorAll('.joined-group-check')];
  const shouldCheck=boxes.some(b=>!b.checked); boxes.forEach(b=>b.checked=shouldCheck);
  adoptJoinedSelectionFrom(listEl);
  if(btnEl)btnEl.textContent=shouldCheck?t("p.selNone"):t("c.selectAll");
}
function applyJoinedKeywordFilter(listEl,inputEl,statusEl){
  if(!listEl||!inputEl)return;
  const keys=(inputEl.value||"").toLowerCase().split(",").map(s=>s.trim()).filter(Boolean);
  if(!keys.length){if(statusEl)statusEl.textContent=t("p.giNeedKeyword");return;}
  let matched=0;
  listEl.querySelectorAll('label[data-group-name]').forEach(row=>{
    const ok=keys.some(k=>row.dataset.groupName.includes(k));
    row.style.display=ok?"flex":"none";
    const box=row.querySelector('.joined-group-check'); if(box)box.checked=ok;
    if(ok)matched++;
  });
  adoptJoinedSelectionFrom(listEl);
  if(statusEl)statusEl.textContent=t("p.giMatched",{n:matched,keys:keys.join(", ")});
}
function resetJoinedKeywordFilter(inputEl,listEl){if(inputEl&&listEl&&!inputEl.value.trim())listEl.querySelectorAll('label[data-group-name]').forEach(row=>row.style.display="flex");}
loadJoinedGroupsBtn.onclick=async()=>{
  const {ok,groups}=await requestJoinedGroupsScan(groupInteractStatus);
  if(ok)renderJoinedGroups(groups,groups.map(g=>g.id));
};
if(loadCommentGroupsBtn)loadCommentGroupsBtn.onclick=async()=>{
  const {ok,groups}=await requestJoinedGroupsScan(groupCommentStatus);
  if(ok)renderJoinedGroups(groups,groups.map(g=>g.id));
};
selectAllGroupsBtn.onclick=()=>toggleSelectAllJoined(joinedGroupList,selectAllGroupsBtn);
if(selectAllCommentGroupsBtn)selectAllCommentGroupsBtn.onclick=()=>toggleSelectAllJoined(joinedGroupListComment,selectAllCommentGroupsBtn);
selectKeywordGroupsBtn.onclick=()=>applyJoinedKeywordFilter(joinedGroupList,groupInteractKeyword,groupInteractStatus);
if(selectKeywordCommentGroupsBtn)selectKeywordCommentGroupsBtn.onclick=()=>applyJoinedKeywordFilter(joinedGroupListComment,groupCommentKeyword,groupCommentStatus);
groupInteractKeyword.addEventListener("input",()=>resetJoinedKeywordFilter(groupInteractKeyword,joinedGroupList));
if(groupCommentKeyword)groupCommentKeyword.addEventListener("input",()=>resetJoinedKeywordFilter(groupCommentKeyword,joinedGroupListComment));

// ── Log nhóm đã tham gia (tự động khi join + thêm tay + xuất CSV) ────────
const groupLogCountJoin=$("groupLogCountJoin"),exportGroupLogCsvBtn=$("exportGroupLogCsvBtn"),clearGroupLogBtn=$("clearGroupLogBtn"),manualGroupUrl=$("manualGroupUrl"),manualGroupKeyword=$("manualGroupKeyword"),addManualGroupBtn=$("addManualGroupBtn"),manualGroupStatus=$("manualGroupStatus");
const groupLogFilterInteract=$("groupLogFilterInteract"),loadFromLogInteractBtn=$("loadFromLogInteractBtn");
const groupLogFilterPost=$("groupLogFilterPost"),loadFromLogPostBtn=$("loadFromLogPostBtn");
const groupLogFilterSales=$("groupLogFilterSales"),loadFromLogSalesBtn=$("loadFromLogSalesBtn");
const groupLogFilterShare=$("groupLogFilterShare"),loadFromLogShareBtn=$("loadFromLogShareBtn");
const batchTagFilterSel=$("batchTagFilterSel"),batchTagNewKeyword=$("batchTagNewKeyword"),batchTagApplyBtn=$("batchTagApplyBtn"),batchTagStatus=$("batchTagStatus");
function updateGroupLogCount(){
  chrome.storage.local.get(["joinedGroupsLog"],r=>{
    const n=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog.length:0;
    if(groupLogCountJoin)groupLogCountJoin.textContent=n;
  });
}
function updateLogKeywordSelects(){
  chrome.storage.local.get(["joinedGroupsLog"],r=>{
    const log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
    const kwCount={};
    log.forEach(g=>{const k=(g.keyword||"").trim();if(k)kwCount[k]=(kwCount[k]||0)+1;});
    const keywords=Object.keys(kwCount).sort();
    const emptyCount=log.filter(g=>!(g.keyword||"").trim()).length;
    // Populate interact + comment + post + sales + share dropdowns
    [groupLogFilterInteract,groupLogFilterComment,groupLogFilterPost,groupLogFilterSales,groupLogFilterShare].forEach(sel=>{
      if(!sel)return;
      const prev=sel.value;
      sel.innerHTML='<option value="">-- Tất cả ('+log.length+' nhóm) --</option>'+
        keywords.map(k=>`<option value="${k}">${k} (${kwCount[k]})</option>`).join('');
      if(keywords.includes(prev))sel.value=prev;
    });
    // Populate batch tag filter dropdown
    if(batchTagFilterSel){
      const prev=batchTagFilterSel.value;
      batchTagFilterSel.innerHTML='<option value="__all__">-- Tất cả ('+log.length+') --</option>'+
        (emptyCount?`<option value="__empty__">-- Chưa có tag (${emptyCount}) --</option>`:'')+
        keywords.map(k=>`<option value="${k}">${k} (${kwCount[k]})</option>`).join('');
      if(prev==='__empty__'||prev==='__all__'||keywords.includes(prev))batchTagFilterSel.value=prev;
    }
  });
}
updateGroupLogCount();
updateLogKeywordSelects();
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==="local"&&changes.joinedGroupsLog){updateGroupLogCount();updateLogKeywordSelects();}
});
// Xuất CSV
if(exportGroupLogCsvBtn)exportGroupLogCsvBtn.onclick=async()=>{
  const r=await chrome.storage.local.get(["joinedGroupsLog"]);
  const log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  if(!log.length){exportGroupLogCsvBtn.textContent="Chưa có dữ liệu";setTimeout(()=>exportGroupLogCsvBtn.textContent="⬇ Xuất CSV",1500);return;}
  const esc=v=>'"'+String(v||"").replace(/"/g,'""')+'"';
  const csv=[["id","name","url","keyword","dateJoined"],...log.map(g=>[esc(g.id),esc(g.name),esc(g.url),esc(g.keyword),esc(g.dateJoined)])].map(row=>row.join(",")).join("\n");
  const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const today=new Date().toISOString().split("T")[0];
  await chrome.downloads.download({url,filename:`fb-groups-log-${today}.csv`,saveAs:false}).catch(()=>{});
  URL.revokeObjectURL(url);
  exportGroupLogCsvBtn.textContent="✅ Đã tải";setTimeout(()=>exportGroupLogCsvBtn.textContent="⬇ Xuất CSV",2000);
};
// Nạp từ log cho Tương tác nhóm (chỉ dùng log, không merge scan cũ)
// Gắn / sửa tag hàng loạt
if(batchTagApplyBtn)batchTagApplyBtn.onclick=async()=>{
  const filter=batchTagFilterSel?.value||"__all__";
  const newKw=(batchTagNewKeyword?.value||"").trim();
  if(!newKw){if(batchTagStatus)batchTagStatus.textContent="Nhập tag mới";return;}
  const r=await chrome.storage.local.get(["joinedGroupsLog"]);
  const log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  let count=0;
  const updated=log.map(g=>{
    const match=filter==="__all__"||(filter==="__empty__"&&!(g.keyword||"").trim())||(filter===g.keyword);
    if(match){count++;return{...g,keyword:newKw};}
    return g;
  });
  await chrome.storage.local.set({joinedGroupsLog:updated}).catch(()=>{});
  updateGroupLogCount();updateLogKeywordSelects();
  if(batchTagStatus){batchTagStatus.textContent=`✅ Đã gắn tag "${newKw}" cho ${count} nhóm`;setTimeout(()=>batchTagStatus.textContent="",3000);}
};
function dedupById(arr){
  const seen=new Set();
  return arr.filter(g=>{const k=String(g.id||"");if(seen.has(k))return false;seen.add(k);return true;});
}
async function applyLogToInteract(){
  const r=await chrome.storage.local.get(["joinedGroupsLog","joinedGroups"]);
  let log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  const kw=(groupLogFilterInteract?.value||"").trim();
  if(kw)log=log.filter(g=>(g.keyword||"").trim()===kw);
  else log=dedupById(log); // Tất cả: dedup theo ID tránh đăng trùng nhóm
  const scanMap=new Map((r.joinedGroups||[]).map(g=>[String(g.id),g]));
  const result=log.map(g=>scanMap.has(String(g.id))?{...g,...scanMap.get(String(g.id))}:g);
  await chrome.storage.local.set({joinedGroups:result}).catch(()=>{});
  renderJoinedGroups(result,result.map(g=>g.id));
  groupInteractStatus.textContent=`✅ Nạp ${result.length} nhóm từ log${kw?` · "${kw}"`:""}`;
}
async function applyLogToPost(){
  const r=await chrome.storage.local.get(["joinedGroupsLog"]);
  let log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  const kw=(groupLogFilterPost?.value||"").trim();
  if(kw)log=log.filter(g=>(g.keyword||"").trim()===kw);
  else log=dedupById(log); // Tất cả: dedup theo ID tránh đăng trùng nhóm
  renderPostGroups(log);
  groupPostList.querySelectorAll('.post-group-check').forEach(cb=>{cb.checked=true;});
  groupPostStatus.textContent=`✅ Nạp ${log.length} nhóm từ log${kw?` · "${kw}"`:""}`;
}
async function applyLogToSales(){
  const r=await chrome.storage.local.get(["joinedGroupsLog"]);
  let log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  const kw=(groupLogFilterSales?.value||"").trim();
  if(kw)log=log.filter(g=>(g.keyword||"").trim()===kw);
  else log=dedupById(log);
  renderSalesGroups(log,[]);
  salesGroupList.querySelectorAll('.sales-group-check').forEach(cb=>{cb.checked=true;});
  if(salesPostStatus)salesPostStatus.textContent=`✅ Nạp ${log.length} nhóm từ log${kw?` · "${kw}"`:""}`;
}
async function applyLogToShare(){
  const r=await chrome.storage.local.get(["joinedGroupsLog"]);
  let log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  const kw=(groupLogFilterShare?.value||"").trim();
  if(kw)log=log.filter(g=>(g.keyword||"").trim()===kw);
  else log=dedupById(log); // Tất cả: dedup theo ID tránh share trùng nhóm
  renderShareGroups(log,log.map(groupPostKey));
  groupShareList.querySelectorAll('.share-group-check').forEach(cb=>{cb.checked=true;});
  await chrome.storage.local.set({groupShareSelectedIds:log.map(groupPostKey)}).catch(()=>{});
  groupShareStatus.textContent=`✅ Nạp ${log.length} nhóm từ log${kw?` · "${kw}"`:""}`;
}
async function applyLogToComment(){
  const r=await chrome.storage.local.get(["joinedGroupsLog","joinedGroups"]);
  let log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  const kw=(groupLogFilterComment?.value||"").trim();
  if(kw)log=log.filter(g=>(g.keyword||"").trim()===kw);
  else log=dedupById(log); // Tất cả: dedup theo ID tránh đăng trùng nhóm
  const scanMap=new Map((r.joinedGroups||[]).map(g=>[String(g.id),g]));
  const result=log.map(g=>scanMap.has(String(g.id))?{...g,...scanMap.get(String(g.id))}:g);
  await chrome.storage.local.set({joinedGroups:result}).catch(()=>{});
  renderJoinedGroups(result,result.map(g=>g.id));
  groupCommentStatus.textContent=`✅ Nạp ${result.length} nhóm từ log${kw?` · "${kw}"`:""}`;
}
if(loadFromLogInteractBtn)loadFromLogInteractBtn.onclick=applyLogToInteract;
if(loadFromLogCommentBtn)loadFromLogCommentBtn.onclick=applyLogToComment;
if(loadFromLogPostBtn)loadFromLogPostBtn.onclick=applyLogToPost;
if(loadFromLogSalesBtn)loadFromLogSalesBtn.onclick=applyLogToSales;
if(loadFromLogShareBtn)loadFromLogShareBtn.onclick=applyLogToShare;
// Xóa log
if(clearGroupLogBtn)clearGroupLogBtn.onclick=async()=>{
  const r=await chrome.storage.local.get(["joinedGroupsLog"]).catch(()=>({}));
  const n=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog.length:0;
  if(!n)return;
  if(!confirm(`Xóa TOÀN BỘ log ${n} nhóm đã tham gia? Mất hết từ khóa đã gắn — các bộ lọc theo từ khóa sẽ trống và chuỗi/lịch dùng nhóm theo từ khóa không còn gì để chạy. KHÔNG thể hoàn tác!`))return;
  await chrome.storage.local.set({joinedGroupsLog:[]}).catch(()=>{});
  updateGroupLogCount();
};
// Thêm nhóm thủ công
if(addManualGroupBtn)addManualGroupBtn.onclick=async()=>{
  const raw=(manualGroupUrl?.value||"").trim();
  const kw=(manualGroupKeyword?.value||"").trim();
  if(!raw){if(manualGroupStatus)manualGroupStatus.textContent="Nhập link nhóm";return;}
  let id,cleanUrl;
  try{
    const u=new URL(raw.startsWith("http")?raw:"https://"+raw);
    const m=u.pathname.match(/\/groups\/([^/?#]+)/i);
    if(!m){if(manualGroupStatus)manualGroupStatus.textContent="Link không đúng định dạng /groups/...";return;}
    id=m[1];cleanUrl=`https://www.facebook.com/groups/${id}/`;
  }catch{if(manualGroupStatus)manualGroupStatus.textContent="Link không hợp lệ";return;}
  const r=await chrome.storage.local.get(["joinedGroupsLog"]);
  const log=Array.isArray(r.joinedGroupsLog)?r.joinedGroupsLog:[];
  if(log.some(e=>e.id===id)){if(manualGroupStatus)manualGroupStatus.textContent="Nhóm đã có trong log";return;}
  const name=/^\d+$/.test(id)?id:id.replace(/[-_.]/g," ").replace(/\b./,c=>c.toUpperCase());
  const today=new Date().toISOString().split("T")[0];
  log.push({id,name,url:cleanUrl,keyword:kw||"thủ công",dateJoined:today});
  await chrome.storage.local.set({joinedGroupsLog:log}).catch(()=>{});
  updateGroupLogCount();
  if(manualGroupUrl)manualGroupUrl.value="";if(manualGroupKeyword)manualGroupKeyword.value="";
  if(manualGroupStatus){manualGroupStatus.textContent=`✅ Đã thêm ${cleanUrl}`;setTimeout(()=>manualGroupStatus.textContent="",3000);}
};

function groupInteractUiMode(){
  const m=String(groupInteractActionMode?.value||"like").toLowerCase();
  return (m==="comment"||m==="both")?m:"like";
}
async function startJoinedGroupMode(mode,opts={}){
  if(mode==="comment")await tagSectionsReady;
  const isComment=mode==="comment",statusEl=isComment?groupCommentStatus:groupInteractStatus;
  const activeKey=isComment?"groupCommentActive":"groupInteractActive";
  const runIdKey=isComment?"groupCommentRunId":"groupInteractRunId";
  const configKey=isComment?"groupCommentConfig":"groupInteractConfig";
  const indexKey=isComment?"groupCommentIndex":"groupInteractIndex";
  const doneKey=isComment?"groupCommentDone":"groupInteractDone";
  const totalKey=isComment?"groupCommentTotal":"groupInteractTotal";
  const statusKey=isComment?"groupCommentStatus":"groupInteractStatus";
  const shareRun=await chrome.storage.local.get(["groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","groupInteractActive","groupCommentActive",...FEED_SCOPED_ACTIVE_KEYS]);
  if(Object.values(shareRun).some(Boolean)){statusEl.textContent=(shareRun.pageGroupJoinActive||shareRun.pageGroupPostActive||shareRun.pageCommentActive)?t("pg.busyOther"):t("p.shBusyInteract");return;}
  const selectedGroups=getSelectedJoinedGroups();
  // Comment AI có ô "số nhóm" và "số comment mỗi nhóm" riêng; Like/Random dùng ô của nó.
  // Chế độ comment khởi từ card Tương tác dùng giới hạn nhóm của card đó (opts.groupLimit).
  const groupLimitEl=isComment?groupCommentGroupLimit:groupInteractGroupLimit;
  const perGroupEl=isComment?groupCommentTarget:groupInteractTarget;
  const requestedGroups=Math.max(1,parseInt(opts.groupLimit!=null?opts.groupLimit:groupLimitEl.value)||1);
  const groups=selectedGroups.slice(0,Math.min(requestedGroups,selectedGroups.length));
  const runId=`group-${mode}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const aiUnified=isComment?await getAiProfileFor(isComment?"groupComment":"groupInteract"):null;
  const minDel=isComment?parseInt(groupCommentMinDelay?.value)||30:parseInt(groupInteractMinDelay.value)||5;
  const maxDel=isComment?parseInt(groupCommentMaxDelay?.value)||60:parseInt(groupInteractMaxDelay.value)||12;
  const _giTagOn=isComment&&!!commentTagEnabled?.checked;
  if(_giTagOn&&tagSections["commentTag"]?.isResolving?.()){
    statusEl.textContent="Đang lấy tên tag, đợi hoàn tất rồi bấm Bắt đầu lại.";
    return;
  }
  const tagConfig=isComment?tagSections["commentTag"]?.getTagConfig(_giTagOn)||null:null;
  const _giShown=String(groupInteractAiPrompt?.value||"").trim();
  // Textarea đang hiện prompt tương ứng trạng thái tick; prompt còn lại lấy
  // cache 2 chiều — content script cần cả hai để tự chọn theo tỉ lệ % tag.
  const giPrompt=isComment?(_giTagOn?(feedDualPromptCache.groupInteractAiPrompt||t("fd.aiPromptDefault")):_giShown):"";
  const giTagPrompt=isComment?(_giTagOn?_giShown:(feedDualPromptCache.groupInteractAiTagPrompt||t("fd.aiTagPromptDefault"))):"";
  const cfg={groups,perGroup:Math.max(1,parseInt(perGroupEl.value)||(isComment?3:5)),minDelay:minDel,maxDelay:maxDel,reaction:groupInteractReaction.value,targetGroups:requestedGroups,runId,mode,typingConfig:isComment?getAiTypingConfig("groupComment"):undefined,prompt:giPrompt,tagPrompt:giTagPrompt,aiConfig:aiUnified?{provider:aiUnified.provider,model:aiUnified.model,url:aiUnified.url}:undefined,tagConfig,economyMode:isComment?(["max","balanced","personal"].includes(groupCommentEconomyMode?.value)?groupCommentEconomyMode.value:"balanced"):undefined,cacheDays:isComment?Math.max(0,parseInt(groupCommentCacheDays?.value)||7):undefined};
  if(!selectedGroups.length){statusEl.textContent=t("p.giNeedGroups");return;}
  if(requestedGroups>selectedGroups.length){statusEl.textContent=t("p.giOnlyReal",{n:selectedGroups.length});}
  if(cfg.minDelay>cfg.maxDelay){statusEl.textContent=t("p.gjBadDelay");return;}
  // Chỉ ghi lại ô giới hạn của đúng card đã bấm (comment khởi từ card Tương
  // tác không được đè ô của card Comment).
  if(opts.groupLimit==null)groupLimitEl.value=requestedGroups;
  if(isComment&&opts.groupLimit==null)chrome.storage.sync.set({groupCommentTargetGroups:requestedGroups,groupCommentPerGroup:cfg.perGroup,groupCommentMinDelay:cfg.minDelay,groupCommentMaxDelay:cfg.maxDelay,groupCommentEconomyMode:cfg.economyMode,groupCommentCacheDays:cfg.cacheDays});
  else chrome.storage.sync.set({groupInteractTargetGroups:requestedGroups,groupInteractPerGroup:cfg.perGroup,groupInteractMinDelay:cfg.minDelay,groupInteractMaxDelay:cfg.maxDelay,groupInteractReaction:cfg.reaction});
  if(isComment)setGroupCommentRunning(true);else setGroupInteractRunning(true);
  const tab=await ensureTaskTab(
    groups[0].url,
    statusEl,
    t("p.openFirstGroup",{name:groups[0].name}),
    isJoinedGroupHomeUrl,
    async owner=>{
      const base={ [activeKey]:true,[runIdKey]:runId,[configKey]:{...cfg,ownerTabId:owner.id},[indexKey]:0,[doneKey]:0,[totalKey]:groups.length*cfg.perGroup,[statusKey]:t(isComment?"gi2.commentStarting":"gi2.starting") };
      if(isComment)Object.assign(base,{groupCommentCurrentGroupIndex:0,groupCommentCurrentGroupDone:0,groupCommentSubmissionGuard:{},groupCommentProcessedKeys:[],groupCommentRetryCounts:{},groupCommentSkipped:{}});
      else Object.assign(base,{groupInteractCurrentGroupIndex:0,groupInteractCurrentGroupDone:0,groupInteractReactedKeys:{},groupInteractReactionGuard:{}});
      await chrome.storage.local.set(base);
    }
  );if(!tab){if(isComment)setGroupCommentRunning(false);else setGroupInteractRunning(false);await chrome.storage.local.set({[activeKey]:false});return;}
  const action=isComment?"startGroupComment":"startGroupInteract",stopState=isComment?"groupCommentActive":"groupInteractActive";
  chrome.tabs.sendMessage(tab.id,{action,...cfg,ownerTabId:tab.id},async res=>{
    if(chrome.runtime.lastError){
      const retry=await autoReloadAndRetry(tab.id,{action,...cfg,ownerTabId:tab.id},statusEl);
      if(retry.ok&&retry.res?.ok){statusEl.textContent=t(isComment?"p.giCommentRunningCount":"p.giRunningCount",{n:groups.length});return;}
      if(await runStillActive(stopState)){statusEl.textContent=t(isComment?"p.giCommentRunningCount":"p.giRunningCount",{n:groups.length});return;}
      if(isComment)setGroupCommentRunning(false);else setGroupInteractRunning(false);return;
    }
    if(res&&res.ok){statusEl.textContent=t(isComment?"p.giCommentRunningCount":"p.giRunningCount",{n:groups.length});return;}
    if(await runStillActive(stopState)){statusEl.textContent=t(isComment?"p.giCommentRunningCount":"p.giRunningCount",{n:groups.length});return;}
    await chrome.storage.local.set({[activeKey]:false});
    if(isComment)setGroupCommentRunning(false);else setGroupInteractRunning(false);statusEl.textContent=res?.error||t("p.giStartFail");return;
  });
}
groupInteractStartBtn.onclick=async()=>{
  // Dropdown chế độ của card Tương tác: like chạy luồng cũ; comment chạy máy
  // comment với giới hạn nhóm của card này; both chạy Like rồi tự nối Comment.
  const m=groupInteractUiMode();
  if(m==="comment")await startJoinedGroupMode("comment",{groupLimit:Math.max(1,parseInt(groupInteractGroupLimit?.value)||1)});
  else if(m==="both")await startJoinedGroupBoth();
  else await startJoinedGroupMode("reaction");
};
groupCommentStartBtn.onclick=()=>startJoinedGroupMode("comment");
// Chế độ Both: Like trước theo card Tương tác, rồi nối Comment theo card
// Comment (prompt/tag/AI/delay của card đó). Followup snapshot + cờ
// groupBothActive nằm ở storage để content tự nối cuối phase Like.
async function startJoinedGroupBoth(){
  if(isGroupInteractRunning||isGroupCommentRunning){groupInteractStatus.textContent=t("p.shBusyInteract");return;}
  const selectedGroups=getSelectedJoinedGroups();
  if(!selectedGroups.length){groupInteractStatus.textContent=t("p.giNeedGroups");return;}
  const requestedGroups=Math.max(1,parseInt(groupInteractGroupLimit?.value)||1);
  const groups=selectedGroups.slice(0,Math.min(requestedGroups,selectedGroups.length));
  const minDel=parseInt(groupCommentMinDelay?.value)||30,maxDel=parseInt(groupCommentMaxDelay?.value)||60;
  if(minDel>maxDel){groupInteractStatus.textContent=t("p.gjBadDelay");return;}
  const tagConfig=tagSections["commentTag"]?.getTagConfig(!!commentTagEnabled?.checked)||null;
  const aiUnified=await getAiProfileFor("groupComment");
  const _bTagOn=!!commentTagEnabled?.checked,_bShown=String(groupInteractAiPrompt?.value||"").trim();
  const followup={
    groups,targetGroups:requestedGroups,
    perGroup:Math.max(1,parseInt(groupCommentTarget.value)||3),
    minDelay:minDel,maxDelay:maxDel,
    typingConfig:getAiTypingConfig("groupComment"),
    prompt:_bTagOn?(feedDualPromptCache.groupInteractAiPrompt||t("fd.aiPromptDefault")):_bShown,
    tagPrompt:_bTagOn?_bShown:(feedDualPromptCache.groupInteractAiTagPrompt||t("fd.aiTagPromptDefault")),
    aiConfig:aiUnified?{provider:aiUnified.provider,model:aiUnified.model,url:aiUnified.url}:undefined,
    tagConfig
  };
  await chrome.storage.local.set({groupCommentFollowupConfig:followup,groupBothActive:true});
  await startJoinedGroupMode("reaction");
  // Reaction từ chối (bận/thiếu nhóm): dọn followup cho sạch, không treo cờ.
  try{
    const still=await chrome.storage.local.get(["groupInteractActive"]);
    if(!still.groupInteractActive)await chrome.storage.local.set({groupBothActive:false,groupCommentFollowupConfig:null});
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
async function stopJoinedGroupMode(mode){
  const isComment=mode==="comment",activeKey=isComment?"groupCommentActive":"groupInteractActive",statusKey=isComment?"groupCommentStatus":"groupInteractStatus",action=isComment?"stopGroupComment":"stopGroupInteract";
  if(isComment)setGroupCommentRunning(false);else setGroupInteractRunning(false);
  await chrome.storage.local.set({[activeKey]:false,[statusKey]:t("p.stopped")});
  broadcastToFacebookTabs({action});
  const tab=await getActiveTab();if(tab)chrome.tabs.sendMessage(tab.id,{action},()=>{});
  // Both-mode: dừng luôn máy comment nối tiếp (chỉ khi chính Both đã khởi nó).
  if(!isComment){
    try{
      const st=await chrome.storage.local.get(["groupBothActive"]);
      if(st.groupBothActive){
        setGroupCommentRunning(false);
        await chrome.storage.local.set({groupCommentActive:false,groupCommentStatus:t("p.stopped"),groupBothActive:false,groupCommentFollowupConfig:null});
        broadcastToFacebookTabs({action:"stopGroupComment"});
        const tab2=await getActiveTab();if(tab2)chrome.tabs.sendMessage(tab2.id,{action:"stopGroupComment"},()=>{});
      }
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }else{
    try{await chrome.storage.local.set({groupBothActive:false});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
}
groupInteractStopBtn.onclick=()=>stopJoinedGroupMode("reaction");
groupCommentStopBtn.onclick=()=>stopJoinedGroupMode("comment");
async function resetJoinedGroupMode(mode){
  const isComment=mode==="comment";
  const countEl=isComment?groupCommentCount:groupInteractCount;
  const statusEl=isComment?groupCommentStatus:groupInteractStatus;
  if(isComment)setGroupCommentRunning(false);else setGroupInteractRunning(false);
  // Ghi cờ dừng + zero bộ đếm trực tiếp vào storage để Reset có tác dụng
  // ngay cả khi tab Facebook không còn reachable (mất message giữa
  // điều hướng). Lịch sử chống trùng được giữ lại như Reset Comment AI
  // Bản tin để phiên mới không thả cảm xúc/comment lặp vào cùng bài.
  const patch=isComment
    ?{groupCommentActive:false,groupCommentRunId:"",groupCommentIndex:0,groupCommentDone:0,groupCommentTotal:0,groupCommentCurrentGroupIndex:0,groupCommentCurrentGroupDone:0,groupCommentSubmissionGuard:{},groupCommentProcessedKeys:[],groupCommentRetryCounts:{},groupCommentSkipped:{},groupCommentStatus:t("gi.commentResetDone")}
    :{groupInteractActive:false,groupInteractRunId:"",groupInteractIndex:0,groupInteractDone:0,groupInteractAiDone:0,groupInteractTotal:0,groupInteractCurrentGroupIndex:0,groupInteractCurrentGroupDone:0,groupInteractCurrentGroupAiDone:0,groupInteractReactionGuard:{},groupInteractCommentGuard:{},groupInteractAiSkipped:{},groupInteractStatus:t("gi.reactionResetDone")};
  await chrome.storage.local.set(patch);
  // Both-mode: reset luôn máy comment nối tiếp + dọn snapshot/cờ (chỉ khi
  // chính Both đã khởi nó; run comment độc lập không bị đụng).
  if(!isComment){
    try{
      const st=await chrome.storage.local.get(["groupBothActive"]);
      if(st.groupBothActive)await resetJoinedGroupMode("comment");
      await chrome.storage.local.set({groupBothActive:false});
      await chrome.storage.local.remove(["groupCommentFollowupConfig"]);
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }else{
    try{await chrome.storage.local.set({groupBothActive:false});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  const action=isComment?"resetGroupComment":"resetGroupInteract";
  broadcastToFacebookTabs({action});
  const tab=await getActiveTab();if(tab)chrome.tabs.sendMessage(tab.id,{action},()=>{});
  countEl.textContent="0 / 0";
  statusEl.textContent=t(isComment?"gi.commentResetDone":"gi.reactionResetDone");
}
groupInteractResetBtn.onclick=()=>resetJoinedGroupMode("reaction");
groupCommentResetBtn.onclick=()=>resetJoinedGroupMode("comment");
chrome.storage.local.get(["joinedGroups","groupInteractSelectedIds","groupInteractStatus","groupInteractDone","groupInteractTotal","groupInteractActive","groupCommentStatus","groupCommentDone","groupCommentTotal","groupCommentActive"],r=>{if(r.joinedGroups)renderJoinedGroups(r.joinedGroups,r.groupInteractSelectedIds||[]);if(r.groupInteractStatus)groupInteractStatus.textContent=localizeJoinedGroupStatus(r.groupInteractStatus);if(r.groupInteractDone!==undefined)groupInteractCount.textContent=`${r.groupInteractDone} / ${r.groupInteractTotal||0}`;if(r.groupCommentStatus)groupCommentStatus.textContent=localizeJoinedGroupStatus(r.groupCommentStatus);if(r.groupCommentDone!==undefined)groupCommentCount.textContent=`${r.groupCommentDone} / ${r.groupCommentTotal||0}`;if(r.groupInteractActive)setGroupInteractRunning(true);if(r.groupCommentActive)setGroupCommentRunning(true);});
chrome.storage.sync.get(["groupInteractTargetGroups","groupInteractPerGroup","groupInteractMinDelay","groupInteractMaxDelay","groupInteractReaction","groupCommentTargetGroups","groupCommentPerGroup","groupCommentMinDelay","groupCommentMaxDelay","groupCommentEconomyMode","groupCommentCacheDays"],r=>{if(r.groupInteractTargetGroups)groupInteractGroupLimit.value=r.groupInteractTargetGroups;if(r.groupInteractPerGroup)groupInteractTarget.value=r.groupInteractPerGroup;if(r.groupInteractMinDelay)groupInteractMinDelay.value=r.groupInteractMinDelay;if(r.groupInteractMaxDelay)groupInteractMaxDelay.value=r.groupInteractMaxDelay;if(r.groupInteractReaction)groupInteractReaction.value=r.groupInteractReaction;if(r.groupCommentTargetGroups&&groupCommentGroupLimit)groupCommentGroupLimit.value=r.groupCommentTargetGroups;if(r.groupCommentPerGroup&&groupCommentTarget)groupCommentTarget.value=r.groupCommentPerGroup;if(r.groupCommentMinDelay&&groupCommentMinDelay)groupCommentMinDelay.value=r.groupCommentMinDelay;if(r.groupCommentMaxDelay&&groupCommentMaxDelay)groupCommentMaxDelay.value=r.groupCommentMaxDelay;if(r.groupCommentEconomyMode&&groupCommentEconomyMode&&["max","balanced","personal"].includes(r.groupCommentEconomyMode))groupCommentEconomyMode.value=r.groupCommentEconomyMode;if(r.groupCommentCacheDays!=null&&groupCommentCacheDays)groupCommentCacheDays.value=r.groupCommentCacheDays;});
[groupCommentGroupLimit,groupCommentTarget,groupCommentMinDelay,groupCommentMaxDelay].forEach(el=>el&&el.addEventListener("change",()=>{
  const g=Math.max(1,parseInt(groupCommentGroupLimit.value)||1);groupCommentGroupLimit.value=g;
  const per=Math.max(1,parseInt(groupCommentTarget.value)||3);groupCommentTarget.value=per;
  const minD=Math.max(5,parseInt(groupCommentMinDelay?.value)||30);if(groupCommentMinDelay)groupCommentMinDelay.value=minD;
  const maxD=Math.max(minD,parseInt(groupCommentMaxDelay?.value)||60);if(groupCommentMaxDelay)groupCommentMaxDelay.value=maxD;
  chrome.storage.sync.set({groupCommentTargetGroups:g,groupCommentPerGroup:per,groupCommentMinDelay:minD,groupCommentMaxDelay:maxD});
}));
[groupInteractGroupLimit,groupInteractTarget,groupInteractMinDelay,groupInteractMaxDelay,groupInteractReaction].forEach(el=>el&&el.addEventListener("change",()=>{
  const target=Math.max(1,parseInt(groupInteractGroupLimit.value)||1);
  groupInteractGroupLimit.value=target;
  chrome.storage.sync.set({groupInteractTargetGroups:target,groupInteractPerGroup:Math.max(1,parseInt(groupInteractTarget.value)||5),groupInteractMinDelay:Math.max(1,parseInt(groupInteractMinDelay.value)||5),groupInteractMaxDelay:Math.max(1,parseInt(groupInteractMaxDelay.value)||12),groupInteractReaction:groupInteractReaction.value});
}));
if(groupInteractActionMode){
  groupInteractActionMode.addEventListener("change",()=>chrome.storage.sync.set({groupInteractActionMode:groupInteractUiMode()}));
  chrome.storage.sync.get(["groupInteractActionMode"],r=>{const m=String(r.groupInteractActionMode||"like");if(groupInteractActionMode&&["like","comment","both"].includes(m))groupInteractActionMode.value=m;});
}
if(groupCommentEconomyMode)groupCommentEconomyMode.addEventListener("change",()=>chrome.storage.sync.set({groupCommentEconomyMode:groupCommentEconomyMode.value}));
if(groupCommentCacheDays)groupCommentCacheDays.addEventListener("change",()=>chrome.storage.sync.set({groupCommentCacheDays:Math.max(0,parseInt(groupCommentCacheDays.value)||7)}));
chrome.storage.onChanged.addListener(c=>{if(c.groupInteractStatus)groupInteractStatus.textContent=localizeJoinedGroupStatus(c.groupInteractStatus.newValue);if(c.groupInteractActive!==undefined)setGroupInteractRunning(c.groupInteractActive.newValue);if(c.groupInteractDone||c.groupInteractTotal)chrome.storage.local.get(["groupInteractDone","groupInteractTotal"],r=>groupInteractCount.textContent=`${r.groupInteractDone||0} / ${r.groupInteractTotal||0}`);if(c.groupCommentStatus)groupCommentStatus.textContent=localizeJoinedGroupStatus(c.groupCommentStatus.newValue);if(c.groupCommentActive!==undefined)setGroupCommentRunning(c.groupCommentActive.newValue);if(c.groupCommentDone||c.groupCommentTotal)chrome.storage.local.get(["groupCommentDone","groupCommentTotal"],r=>groupCommentCount.textContent=`${r.groupCommentDone||0} / ${r.groupCommentTotal||0}`);if(c.groupCommentActive&&c.groupCommentActive.newValue===false)chrome.storage.local.set({groupBothActive:false});});

// DANG BAI AI LEN NHOM
const groupPostList=$("groupPostList"),loadPostGroupsBtn=$("loadPostGroupsBtn"),selectAllPostGroupsBtn=$("selectAllPostGroupsBtn");
const groupPostKeyword=$("groupPostKeyword"),groupPostPrompt=$("groupPostPrompt");
const groupPostStartBtn=$("groupPostStartBtn"),groupPostStopBtn=$("groupPostStopBtn"),groupPostResetBtn=$("groupPostResetBtn"),groupPostStatus=$("groupPostStatus"),groupPostCount=$("groupPostCount");
const groupPostTargetGroups=$("groupPostTargetGroups"),groupPostInterDelay=$("groupPostInterDelay");
const groupPostBackgroundEnabled=$("groupPostBackgroundEnabled"),groupPostBackgroundOptions=$("groupPostBackgroundOptions"),groupPostBackgroundMode=$("groupPostBackgroundMode"),groupPostFixedColorWrap=$("groupPostFixedColorWrap"),groupPostFixedColor=$("groupPostFixedColor"),groupPostMaxChars=$("groupPostMaxChars");
const groupPostPreviewBtn=$("groupPostPreviewBtn"),groupPostPreview=$("groupPostPreview");
const groupPostSource=$("groupPostSource"),groupPostXWrap=$("groupPostXWrap"),groupPostXList=$("groupPostXList"),groupPostXUsers=$("groupPostXUsers"),groupPostXPhoto=$("groupPostXPhoto"),groupPostXPrompt=$("groupPostXPrompt"),groupPostXHours=$("groupPostXHours");
const groupPostWebWrap=$("groupPostWebWrap"),groupPostWebUseShared=$("groupPostWebUseShared"),groupPostWebSharedHint=$("groupPostWebSharedHint"),groupPostWebSeparateWrap=$("groupPostWebSeparateWrap"),groupPostWebSiteList=$("groupPostWebSiteList"),groupPostWebKeyword=$("groupPostWebKeyword"),groupPostWebHours=$("groupPostWebHours"),groupPostWebPrompt=$("groupPostWebPrompt"),groupPostWebList=$("groupPostWebList"),groupPostWebListName=$("groupPostWebListName"),groupPostWebListSaveBtn=$("groupPostWebListSaveBtn"),groupPostWebListRenameBtn=$("groupPostWebListRenameBtn"),groupPostWebListDeleteBtn=$("groupPostWebListDeleteBtn"),groupPostWebWithPhoto=$("groupPostWebWithPhoto");
const groupPostXUseShared=$("groupPostXUseShared"),groupPostXSharedHint=$("groupPostXSharedHint"),groupPostXSeparateWrap=$("groupPostXSeparateWrap"),groupPostXListName=$("groupPostXListName"),groupPostXListSaveBtn=$("groupPostXListSaveBtn"),groupPostXListRenameBtn=$("groupPostXListRenameBtn"),groupPostXListDeleteBtn=$("groupPostXListDeleteBtn");
const groupPostFbWrap=$("groupPostFbWrap"),groupPostFbUseShared=$("groupPostFbUseShared"),groupPostFbSharedHint=$("groupPostFbSharedHint"),groupPostFbSeparateWrap=$("groupPostFbSeparateWrap"),groupPostFbUrls=$("groupPostFbUrls"),groupPostFbHours=$("groupPostFbHours"),groupPostFbMode=$("groupPostFbMode"),groupPostFbIncludeComment=$("groupPostFbIncludeComment"),groupPostFbRewritePrompt=$("groupPostFbRewritePrompt"),groupPostFbOpinionPrompt=$("groupPostFbOpinionPrompt"),groupPostFbList=$("groupPostFbList"),groupPostFbListName=$("groupPostFbListName"),groupPostFbListSaveBtn=$("groupPostFbListSaveBtn"),groupPostFbListRenameBtn=$("groupPostFbListRenameBtn"),groupPostFbListDeleteBtn=$("groupPostFbListDeleteBtn");
const groupPostFbBackgroundOnly=$("groupPostFbBackgroundOnly");
function groupPostSourceMode(){const v=groupPostSource?.value||"ai";return v==="x"?"x":v==="web"?"web":v==="fb"?"fb":"ai";}
function groupPostToggleSourceUI(){
  const m=groupPostSourceMode();
  if(groupPostXWrap)groupPostXWrap.style.display=m==="x"?"":"none";
  if(groupPostWebWrap)groupPostWebWrap.style.display=m==="web"?"":"none";
  if(groupPostFbWrap)groupPostFbWrap.style.display=m==="fb"?"":"none";
  const fShared=!!groupPostFbUseShared?.checked;
  if(groupPostFbSharedHint)groupPostFbSharedHint.style.display=fShared?"":"none";
  if(groupPostFbSeparateWrap)groupPostFbSeparateWrap.style.display=fShared?"none":"";
  // toggle shared vs separate for X
  const xShared=!!groupPostXUseShared?.checked;
  if(groupPostXSharedHint)groupPostXSharedHint.style.display=xShared?"":"none";
  if(groupPostXSeparateWrap)groupPostXSeparateWrap.style.display=xShared?"none":"";
  // toggle shared vs separate for Web
  const wShared=!!groupPostWebUseShared?.checked;
  if(groupPostWebSharedHint)groupPostWebSharedHint.style.display=wShared?"":"none";
  if(groupPostWebSeparateWrap)groupPostWebSeparateWrap.style.display=wShared?"none":"";
}
if(groupPostSource)groupPostSource.addEventListener("change",()=>{groupPostToggleSourceUI();persistGroupPostDraft();});
function groupPostResolveXUsers(){
  const useShared=!!groupPostXUseShared?.checked;
  if(useShared){
    const sel=String($("newsXListPicker")?.value||"");
    if(sel){
      const hit=(groupPostXListCache||[]).find(l=>String(l.id||"")===sel);
      if(hit?.users?.length)return hit.users.slice(0,1000);
    }
    return parseXUsersText($("newsXUsers")?.value||"");
  }
  const sel=String(groupPostXList?.value||"");
  if(sel&&sel!=="__custom__"){
    const hit=(groupPostXListCache||[]).find(l=>String(l.id||"")===sel);
    if(hit?.users?.length)return hit.users.slice(0,1000);
  }
  return parseXUsersText(groupPostXUsers?.value||"");
}
async function groupPostResolveXUsersLive(){
  const useShared=!!groupPostXUseShared?.checked;
  if(useShared){
    const sel=String($("newsXListPicker")?.value||"");
    if(sel){
      let hit=(groupPostXListCache||[]).find(l=>String(l.id||"")===sel);
      if(!hit){
        const lists=await loadXUserLists();
        hit=lists.find(l=>String(l.id||"")===sel);
        if(hit)groupPostXListCache=lists;
      }
      if(hit?.users?.length)return hit.users.slice(0,1000);
    }
    return parseXUsersText($("newsXUsers")?.value||"");
  }
  const sel=String(groupPostXList?.value||"");
  if(sel&&sel!=="__custom__"){
    let hit=(groupPostXListCache||[]).find(l=>String(l.id||"")===sel);
    if(!hit){
      const lists=await loadXUserLists();
      hit=lists.find(l=>String(l.id||"")===sel);
      if(hit)groupPostXListCache=lists;
    }
    if(hit?.users?.length)return hit.users.slice(0,1000);
  }
  return parseXUsersText(groupPostXUsers?.value||"");
}
let groupPostXListCache=[];
async function refreshGroupPostXListUI(keep=""){
  groupPostXListCache=await loadXUserLists();
  if(groupPostXList){
    groupPostXList.innerHTML=`<option value="__custom__">${t("gp.xCustom")}</option>`+groupPostXListCache.map(l=>`<option value="${String(l.id||"")}">${String(l.name||"")}</option>`).join("");
    if(keep)groupPostXList.value=keep;
  }
}
function persistGroupPostDraft(){
  try{
    chrome.storage.sync.set({groupPostSource:groupPostSourceMode(),groupPostXList:groupPostXList?.value||"__custom__",groupPostXUsers:groupPostXUsers?.value||"",groupPostXPhoto:!!groupPostXPhoto?.checked,groupPostXPrompt:groupPostXPrompt?.value||"",groupPostXHours:groupPostXHours?.value||"24",groupPostXUseShared:!!groupPostXUseShared?.checked,groupPostWebUseShared:!!groupPostWebUseShared?.checked,groupPostWebSiteList:groupPostWebSiteList?.value||"",groupPostWebKeyword:groupPostWebKeyword?.value||"",groupPostWebHours:groupPostWebHours?.value||"24",groupPostWebPrompt:groupPostWebPrompt?.value||"",groupPostWebWithPhoto:!!groupPostWebWithPhoto?.checked,groupPostFbUseShared:!!groupPostFbUseShared?.checked,groupPostFbList:groupPostFbList?.value||"__custom__",groupPostFbUrls:groupPostFbUrls?.value||"",groupPostFbHours:groupPostFbHours?.value||"24",groupPostFbMode:groupPostFbMode?.value||"rewrite",groupPostFbBackgroundOnly:!!groupPostFbBackgroundOnly?.checked,groupPostFbIncludeComment:groupPostFbIncludeComment?.checked!==false,groupPostFbRewritePrompt:groupPostFbRewritePrompt?.value||"",groupPostFbOpinionPrompt:groupPostFbOpinionPrompt?.value||""}).catch(()=>{});
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
if(groupPostFbBackgroundOnly)groupPostFbBackgroundOnly.addEventListener("change",persistGroupPostDraft);
if(groupPostXHours)groupPostXHours.addEventListener("change",persistGroupPostDraft);
if(groupPostXUseShared)groupPostXUseShared.addEventListener("change",()=>{groupPostToggleSourceUI();persistGroupPostDraft();});
if(groupPostWebUseShared)groupPostWebUseShared.addEventListener("change",()=>{groupPostToggleSourceUI();persistGroupPostDraft();});
if(groupPostWebSiteList)groupPostWebSiteList.addEventListener("change",persistGroupPostDraft);
if(groupPostWebKeyword)groupPostWebKeyword.addEventListener("change",persistGroupPostDraft);
if(groupPostWebHours)groupPostWebHours.addEventListener("change",persistGroupPostDraft);
if(groupPostWebPrompt)groupPostWebPrompt.addEventListener("change",persistGroupPostDraft);
if(groupPostWebWithPhoto)groupPostWebWithPhoto.addEventListener("change",persistGroupPostDraft);
if(groupPostFbUseShared)groupPostFbUseShared.addEventListener("change",()=>{groupPostToggleSourceUI();persistGroupPostDraft();});
if(groupPostFbUrls)groupPostFbUrls.addEventListener("change",persistGroupPostDraft);
if(groupPostFbHours)groupPostFbHours.addEventListener("change",persistGroupPostDraft);
if(groupPostFbMode)groupPostFbMode.addEventListener("change",()=>{groupPostToggleSourceUI();persistGroupPostDraft();});
if(groupPostFbIncludeComment)groupPostFbIncludeComment.addEventListener("change",persistGroupPostDraft);
if(groupPostFbRewritePrompt)groupPostFbRewritePrompt.addEventListener("change",persistGroupPostDraft);
if(groupPostFbOpinionPrompt)groupPostFbOpinionPrompt.addEventListener("change",persistGroupPostDraft);
chrome.storage.sync.get(["groupPostFbBackgroundOnly"],r=>{if(groupPostFbBackgroundOnly)groupPostFbBackgroundOnly.checked=!!r.groupPostFbBackgroundOnly;});
function groupPostParseWebSites(s){return String(s||"").split(/\r?\n/).map(x=>x.trim()).filter(x=>/^https?:\/\//i.test(x)).slice(0,100);}
async function groupPostResolveWebConfigLive(){
  const useShared=!!groupPostWebUseShared?.checked;
  let urls=[],q="",hours=24;
  if(useShared){
    try{
      const r=await chrome.storage.sync.get(["newsSiteList","newsKeyword","newsTimeRange"]);
      urls=String(r.newsSiteList||"").split(/\r?\n/).map(x=>x.trim()).filter(x=>/^https?:\/\//i.test(x)).slice(0,100);
      q=String(r.newsKeyword||"").trim();
      const h=parseInt(r.newsTimeRange||"24");
      hours=[0,24,48,72,168,720].includes(h)?h:24;
      // if hours is 72/168, map to closest 24/48 for group (keep as is)
      if(hours===72) hours=48;
      if(hours===168) hours=48;
      if(hours===720) hours=48;
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }else{
    urls=groupPostParseWebSites(groupPostWebSiteList?.value||"");
    q=String(groupPostWebKeyword?.value||"").trim();
    const h=parseInt(groupPostWebHours?.value||"24");
    hours=[0,24,48,72,168].includes(h)?h:24;
  }
  return {urls,q,hours};
}
function groupPostParseFbUrls(s){return String(s||"").split(/\r?\n/).map(x=>x.trim()).filter(x=>/^https?:\/\/(?:www\.|m\.)?facebook\.com\//i.test(x)).slice(0,100);}
async function groupPostResolveFbConfigLive(){
  const useShared=!!groupPostFbUseShared?.checked;
  let urls=[],hours=24,mode="rewrite",includeComment=true;
  if(useShared){
    try{
      const r=await chrome.storage.sync.get(["newsFbUrls","newsTimeRange","newsFbMode","newsFbIncludeComment"]);
      urls=String(r.newsFbUrls||"").split(/\r?\n/).map(x=>x.trim()).filter(x=>/^https?:\/\/(?:www\.|m\.)?facebook\.com\//i.test(x)).slice(0,100);
      const h=parseInt(r.newsTimeRange||"24");
      hours=[0,24,48,72,168,720].includes(h)?h:24;
      mode=["rewrite","rewrite_original","opinion_screenshot"].includes(r.newsFbMode)?r.newsFbMode:"rewrite";
      includeComment=r.newsFbIncludeComment!==false;
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }else{
    // Ưu tiên danh sách đã lưu khi có chọn (đồng bộ với ô nhập bên dưới).
    try{
      const sel=String(groupPostFbList?.value||"");
      if(sel&&sel!=="__custom__"){
        const lists=await loadGroupPostFbLists();
        const hit=lists.find(l=>String(l.id||"")===sel);
        if(hit){
          urls=Array.isArray(hit.urls)?hit.urls.slice(0,100):groupPostParseFbUrls(groupPostFbUrls?.value||"");
          const h=parseInt(hit.hours??groupPostFbHours?.value??"24");
          hours=[0,24,48,72,168,720].includes(h)?h:24;
        }else{
          urls=groupPostParseFbUrls(groupPostFbUrls?.value||"");
          const h=parseInt(groupPostFbHours?.value||"24");
          hours=[0,24,48,72,168,720].includes(h)?h:24;
        }
      }else{
        urls=groupPostParseFbUrls(groupPostFbUrls?.value||"");
        const h=parseInt(groupPostFbHours?.value||"24");
        hours=[0,24,48,72,168,720].includes(h)?h:24;
      }
    }catch(_){
      urls=groupPostParseFbUrls(groupPostFbUrls?.value||"");
      const h=parseInt(groupPostFbHours?.value||"24");
      hours=[0,24,48,72,168,720].includes(h)?h:24;
    }
    mode=["rewrite","rewrite_original","opinion_screenshot"].includes(groupPostFbMode?.value)?groupPostFbMode.value:"rewrite";
    includeComment=groupPostFbIncludeComment?.checked!==false;
  }
  return {urls,hours,mode,includeComment};
}
let groupPostFbListCache=[];
async function loadGroupPostFbLists(){
  try{const r=await chrome.storage.sync.get(["groupPostFbLists"]);return Array.isArray(r.groupPostFbLists)?r.groupPostFbLists:[];}catch(_){return[];}
}
async function saveGroupPostFbLists(list){
  try{await chrome.storage.sync.set({groupPostFbLists:Array.isArray(list)?list:[]});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
async function refreshGroupPostFbListUI(keep=""){
  groupPostFbListCache=await loadGroupPostFbLists();
  if(groupPostFbList){
    groupPostFbList.innerHTML=`<option value="__custom__">${t("gp.fbCustom")||t("gp.xCustom")}</option>`+groupPostFbListCache.map(l=>`<option value="${String(l.id||"")}">${String(l.name||"")}</option>`).join("");
    if(keep)groupPostFbList.value=keep;
  }
}
let groupPostWebListCache=[];
async function loadGroupPostWebLists(){
  try{const r=await chrome.storage.sync.get(["groupPostWebLists"]);return Array.isArray(r.groupPostWebLists)?r.groupPostWebLists:[];}catch(_){return[];}
}
async function saveGroupPostWebLists(list){
  try{await chrome.storage.sync.set({groupPostWebLists:Array.isArray(list)?list:[]});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
async function refreshGroupPostWebListUI(keep=""){
  groupPostWebListCache=await loadGroupPostWebLists();
  if(groupPostWebList){
    groupPostWebList.innerHTML=`<option value="__custom__">${t("gp.webCustom")||t("gp.xCustom")}</option>`+groupPostWebListCache.map(l=>`<option value="${String(l.id||"")}">${String(l.name||"")}</option>`).join("");
    if(keep)groupPostWebList.value=keep;
  }
}
if(groupPostXList)groupPostXList.addEventListener("change",()=>{
  // Chọn danh sách thì nạp user vào ô tự nhập để nhìn thấy + sửa được
  // (giống card Đăng tường); chọn "-- Tự nhập --" thì giữ nguyên ô.
  const sel=String(groupPostXList.value||"");
  if(sel&&sel!=="__custom__"){
    const hit=(groupPostXListCache||[]).find(l=>String(l.id||"")===sel);
    const users=hit?.users?.length?hit.users:[];
    if(!users.length){loadXUserLists().then(lists=>{const h=lists.find(x=>String(x.id||"")===sel);if(h?.users?.length&&groupPostXUsers){groupPostXUsers.value=h.users.join("\n");persistGroupPostDraft();}});}
    else if(groupPostXUsers){groupPostXUsers.value=users.join("\n");}
  }
  persistGroupPostDraft();
});
if(groupPostXUsers)groupPostXUsers.addEventListener("change",persistGroupPostDraft);
if(groupPostXPhoto)groupPostXPhoto.addEventListener("change",persistGroupPostDraft);
if(groupPostXPrompt)bindPromptPersistence("groupPostXPrompt",groupPostXPrompt);
if(groupPostXListSaveBtn)groupPostXListSaveBtn.onclick=async()=>{
  const users=parseXUsersText(groupPostXUsers?.value||"");
  if(!users.length){groupPostStatus.textContent=t("bg.newsNoXUsers");return;}
  let name=String(groupPostXListName?.value||"").trim().slice(0,60);
  const lists=await loadXUserLists();
  if(!name){
    const sel=String(groupPostXList?.value||"");
    const ix=sel?lists.findIndex(l=>String(l.id||"")===sel):-1;
    if(ix<0){groupPostStatus.textContent=t("gp.xNeedSelect");return;}
    lists[ix]={...lists[ix],users};
    await saveXUserLists(lists);
    if(groupPostXListName)groupPostXListName.value="";
    await refreshGroupPostXListUI(String(lists[ix].id));
    try{await refreshNewsXListPicker(String(lists[ix].id));}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    groupPostStatus.textContent=t("gp.xListUpdated")||"Đã cập nhật danh sách X";
    persistGroupPostDraft();
    return;
  }
  const dup=lists.findIndex(l=>l.name===name);
  const id=dup>=0?lists[dup].id:"xl"+Date.now().toString(36);
  const entry={id,name,users};
  if(dup>=0)lists[dup]=entry;else lists.push(entry);
  await saveXUserLists(lists.slice(-30));
  if(groupPostXListName)groupPostXListName.value="";
  await refreshGroupPostXListUI(id);
  try{await refreshNewsXListPicker(id);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  groupPostStatus.textContent=t("gp.xListSaved")||"Đã lưu danh sách X";
  persistGroupPostDraft();
};
if(groupPostXListRenameBtn)groupPostXListRenameBtn.onclick=async()=>{
  const sel=String(groupPostXList?.value||"");
  if(!sel||sel==="__custom__"){groupPostStatus.textContent=t("gp.xNeedSelect");return;}
  const name=String(groupPostXListName?.value||"").trim().slice(0,60);
  if(!name){groupPostStatus.textContent=t("gp.xNeedName");return;}
  const lists=await loadXUserLists();
  const ix=lists.findIndex(l=>String(l.id||"")===sel);
  if(ix<0)return;
  const clash=lists.findIndex((l,i)=>i!==ix&&l.name===name);
  if(clash>=0){
    const merged=[...lists[clash].users||[],...lists[ix].users||[]].filter((u,i,a)=>a.indexOf(u)===i).slice(0,1000);
    lists[clash]={...lists[clash],users:merged};
    lists.splice(ix,1);
    await saveXUserLists(lists);
    if(groupPostXListName)groupPostXListName.value="";
    await refreshGroupPostXListUI(String(lists[clash].id));
    try{await refreshNewsXListPicker(String(lists[clash].id));}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    groupPostStatus.textContent=t("gp.xRenamed")||"Đã đổi tên";
    persistGroupPostDraft();
    return;
  }
  lists[ix]={...lists[ix],name};
  await saveXUserLists(lists);
  if(groupPostXListName)groupPostXListName.value="";
  await refreshGroupPostXListUI(sel);
  try{await refreshNewsXListPicker(sel);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  groupPostStatus.textContent=t("gp.xRenamed")||"Đã đổi tên";
  persistGroupPostDraft();
};
if(groupPostXListDeleteBtn)groupPostXListDeleteBtn.onclick=async()=>{
  const sel=String(groupPostXList?.value||"");
  if(!sel||sel==="__custom__")return;
  if(!confirm(t("gp.xConfirmDelete")||"Xóa danh sách X này?"))return;
  const lists=(await loadXUserLists()).filter(l=>String(l.id||"")!==sel);
  await saveXUserLists(lists);
  await refreshGroupPostXListUI();
  try{await refreshNewsXListPicker();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  groupPostStatus.textContent=t("gp.xDeleted")||"Đã xóa";
  persistGroupPostDraft();
};
if(groupPostFbList)groupPostFbList.addEventListener("change",async()=>{
  const sel=String(groupPostFbList.value||"");
  if(sel&&sel!=="__custom__"){
    const hit=(groupPostFbListCache||[]).find(l=>String(l.id||"")===sel);
    if(hit){
      if(groupPostFbUrls)groupPostFbUrls.value=(hit.urls||[]).join("\n");
      if(groupPostFbHours)groupPostFbHours.value=String(hit.hours||"24");
      persistGroupPostDraft();
    }else{
      const lists=await loadGroupPostFbLists();
      const h=lists.find(x=>String(x.id||"")===sel);
      if(h){
        if(groupPostFbUrls)groupPostFbUrls.value=(h.urls||[]).join("\n");
        if(groupPostFbHours)groupPostFbHours.value=String(h.hours||"24");
        persistGroupPostDraft();
      }
    }
  }else persistGroupPostDraft();
});
if(groupPostFbListSaveBtn)groupPostFbListSaveBtn.onclick=async()=>{
  const urls=groupPostParseFbUrls(groupPostFbUrls?.value||"");
  if(!urls.length){groupPostStatus.textContent=t("bg.newsNoFbUrls");return;}
  const hours=parseInt(groupPostFbHours?.value||"24");
  let name=String(groupPostFbListName?.value||"").trim().slice(0,60);
  const lists=await loadGroupPostFbLists();
  if(!name){
    const sel=String(groupPostFbList?.value||"");
    const ix=sel?lists.findIndex(l=>String(l.id||"")===sel):-1;
    if(ix>=0){
      lists[ix]={...lists[ix],urls,hours};
      await saveGroupPostFbLists(lists);
      await refreshGroupPostFbListUI(String(lists[ix].id));
      groupPostStatus.textContent=t("gp.fbListUpdated")||"Đã cập nhật danh sách Page/Profile";
      persistGroupPostDraft();
      return;
    }
    name="fb-"+new Date().toISOString().slice(0,10);
  }
  const id="fb_"+Date.now().toString(36);
  lists.push({id,name,urls,hours});
  await saveGroupPostFbLists(lists);
  await refreshGroupPostFbListUI(id);
  if(groupPostFbListName)groupPostFbListName.value="";
  groupPostStatus.textContent=t("gp.fbListSaved")||"Đã lưu danh sách Page/Profile";
  persistGroupPostDraft();
};
if(groupPostFbListRenameBtn)groupPostFbListRenameBtn.onclick=async()=>{
  const sel=String(groupPostFbList?.value||"");
  if(!sel||sel==="__custom__"){groupPostStatus.textContent=t("gp.fbNeedSelect")||"Chọn danh sách cần đổi tên";return;}
  const name=String(groupPostFbListName?.value||"").trim().slice(0,60);
  if(!name){groupPostStatus.textContent=t("gp.fbNeedName")||"Nhập tên mới";return;}
  const lists=await loadGroupPostFbLists();
  const ix=lists.findIndex(l=>String(l.id||"")===sel);
  if(ix>=0){lists[ix].name=name;await saveGroupPostFbLists(lists);await refreshGroupPostFbListUI(sel);groupPostStatus.textContent=t("gp.fbRenamed")||"Đã đổi tên";persistGroupPostDraft();}
};
if(groupPostFbListDeleteBtn)groupPostFbListDeleteBtn.onclick=async()=>{
  const sel=String(groupPostFbList?.value||"");
  if(!sel||sel==="__custom__")return;
  if(!confirm(t("gp.fbConfirmDelete")||"Xóa danh sách Page/Profile này?"))return;
  const lists=await loadGroupPostFbLists();
  await saveGroupPostFbLists(lists.filter(l=>String(l.id||"")!==sel));
  await refreshGroupPostFbListUI();
  groupPostStatus.textContent=t("gp.fbDeleted")||"Đã xóa";
  persistGroupPostDraft();
};

refreshGroupPostXListUI();
refreshGroupPostWebListUI();
refreshGroupPostFbListUI();
if(groupPostWebList)groupPostWebList.addEventListener("change",async()=>{
  const sel=String(groupPostWebList.value||"");
  if(sel&&sel!=="__custom__"){
    const hit=(groupPostWebListCache||[]).find(l=>String(l.id||"")===sel);
    if(hit){
      if(groupPostWebSiteList)groupPostWebSiteList.value=(hit.urls||[]).join("\n");
      if(groupPostWebKeyword)groupPostWebKeyword.value=hit.q||"";
      if(groupPostWebHours)groupPostWebHours.value=String(hit.hours||"24");
      if(groupPostWebPrompt)groupPostWebPrompt.value=hit.webPrompt||"";
      persistGroupPostDraft();
    }
  }
});
if(groupPostWebListSaveBtn)groupPostWebListSaveBtn.onclick=async()=>{
  const urls=groupPostParseWebSites(groupPostWebSiteList?.value||"");
  if(!urls.length){groupPostStatus.textContent=t("bg.newsSitesEmpty");return;}
  const q=String(groupPostWebKeyword?.value||"").trim();
  const hours=parseInt(groupPostWebHours?.value||"24");
  const wp=String(groupPostWebPrompt?.value||"").trim()||t("gp.webPromptDefault");
  let name=String(groupPostWebListName?.value||"").trim();
  const lists=await loadGroupPostWebLists();
  if(!name){
    const sel=String(groupPostWebList?.value||"");
    const ix=sel?lists.findIndex(l=>String(l.id||"")===sel):-1;
    if(ix>=0){
      lists[ix]={...lists[ix],urls,q,hours,webPrompt:wp};
      await saveGroupPostWebLists(lists);
      await refreshGroupPostWebListUI(String(lists[ix].id));
      groupPostStatus.textContent=t("gp.webListUpdated")||"Đã cập nhật danh sách Web";
      return;
    }
    name="web-"+new Date().toISOString().slice(0,10);
  }
  const id="web_"+Date.now().toString(36);
  lists.push({id,name,urls,q,hours,webPrompt:wp});
  await saveGroupPostWebLists(lists);
  await refreshGroupPostWebListUI(id);
  if(groupPostWebListName)groupPostWebListName.value="";
  groupPostStatus.textContent=t("gp.webListSaved")||"Đã lưu danh sách Web";
};
if(groupPostWebListRenameBtn)groupPostWebListRenameBtn.onclick=async()=>{
  const sel=String(groupPostWebList?.value||"");
  if(!sel||sel==="__custom__"){groupPostStatus.textContent=t("gp.webNeedSelect")||"Chọn danh sách cần đổi tên";return;}
  const name=String(groupPostWebListName?.value||"").trim();
  if(!name){groupPostStatus.textContent=t("gp.webNeedName")||"Nhập tên mới";return;}
  const lists=await loadGroupPostWebLists();
  const ix=lists.findIndex(l=>String(l.id||"")===sel);
  if(ix>=0){ lists[ix].name=name; await saveGroupPostWebLists(lists); await refreshGroupPostWebListUI(sel); groupPostStatus.textContent=t("gp.webRenamed")||"Đã đổi tên"; }
};
if(groupPostWebListDeleteBtn)groupPostWebListDeleteBtn.onclick=async()=>{
  const sel=String(groupPostWebList?.value||"");
  if(!sel||sel==="__custom__")return;
  if(!confirm(t("gp.webConfirmDelete")||"Xóa danh sách Web này?"))return;
  const lists=await loadGroupPostWebLists();
  const filtered=lists.filter(l=>String(l.id||"")!==sel);
  await saveGroupPostWebLists(filtered);
  await refreshGroupPostWebListUI();
  groupPostStatus.textContent=t("gp.webDeleted")||"Đã xóa";
};
let isGroupPostRunning=false;
function setGroupPostRunning(v){isGroupPostRunning=v;groupPostStartBtn.textContent=v?t("p.gpBusy"):t("gp.start");groupPostStartBtn.classList.toggle("running",v);setPromptEditorState(v,groupPostPrompt,"groupPostPromptLockHint");}
const GROUP_POST_PREVIEW_COLORS={pink:"#e91e63",green:"#2e7d32",red:"#d32f2f",orange:"#ef6c00",yellow:"#f9a825",blue:"#1976d2",purple:"#7b1fa2",burgundy:"#8e244d",beige:"#b9a07e",brown:"#6d4c41",gray:"#78909c",black:"#263238"};
const GROUP_POST_AUTO_TIMING=Object.freeze({minDelay:25,maxDelay:45});
// Ngữ cảnh nhóm: auto-phân loại chợ/cư dân (24h) vs kiến thức (48h), nhớ tay từng nhóm (sync).
const GROUP_POST_KNOWLEDGE_RE=/(chứng khoán|chung khoan|đầu tư|dau tu|tài chính|tai chinh|crypto|coin|forex|bất động sản|bat dong san|marketing|khởi nghiệp|khoi nghiep|\bhọc\b|\bhoc\b|kiến thức|kinh nghiệm|lập trình|lap trinh|thiết kế|thiet ke|công nghệ|tiếng anh|ielts|\bluật\b|sức khỏe|suc khoe|khoa học|bác sĩ|mẹ và bé|nuôi con|giáo dục|chứng chỉ|tuyển dụng|việc làm)/;
function classifyGroupPostKind(name){
  const s=` ${String(name||"").toLocaleLowerCase("vi")} `;
  return GROUP_POST_KNOWLEDGE_RE.test(s)?{type:"knowledge",windowHours:48}:{type:"market",windowHours:24};
}
let groupPostWindowOverrides={},groupPostSearchOverrides={},groupPostWebSearchDefault=false;
async function loadGroupPostCtxPrefs(){try{const r=await chrome.storage.sync.get(["groupPostWindowOverrides","groupPostSearchOverrides","groupPostWebSearchDefault","groupPostCtxEnabled","groupPostCtxMode","groupPostMinLen"]);if(r.groupPostWindowOverrides&&typeof r.groupPostWindowOverrides==="object")groupPostWindowOverrides=r.groupPostWindowOverrides;if(r.groupPostSearchOverrides&&typeof r.groupPostSearchOverrides==="object")groupPostSearchOverrides=r.groupPostSearchOverrides;groupPostWebSearchDefault=r.groupPostWebSearchDefault===true;if(r.groupPostCtxEnabled!==undefined)groupPostCtxOn=r.groupPostCtxEnabled!==false;if(r.groupPostCtxMode==="deep"){groupPostCtxModeVal="deep";if(groupPostCtxMode)groupPostCtxMode.value="deep";}if(parseInt(r.groupPostMinLen)){groupPostMinLenVal=Math.min(1000,Math.max(30,parseInt(r.groupPostMinLen)));if(groupPostMinLen)groupPostMinLen.value=groupPostMinLenVal;}}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
function groupPostWindowOf(key,name){
  const o=groupPostWindowOverrides[key];
  if(o===24||o===48)return{windowHours:o,auto:false,groupType:o===48?"knowledge":"market"};
  const k=classifyGroupPostKind(name);
  return{windowHours:k.windowHours===48?48:24,auto:true,groupType:k.type};
}
function groupPostSearchOf(key){const o=groupPostSearchOverrides[key];return o===undefined?groupPostWebSearchDefault:o===true;}
function enrichGroupPostGroups(groups){
  return (groups||[]).map(g=>{const key=groupPostKey(g);const w=groupPostWindowOf(key,g.name);return{key,url:g.url||`https://www.facebook.com${key}/`,name:g.name||"",windowHours:w.windowHours,groupType:w.groupType,webSearch:groupPostSearchOf(key)};});
}
let postGroups=[];
bindPromptPersistence("groupPostPrompt",groupPostPrompt);
[groupPostTargetGroups,groupPostInterDelay].forEach(el=>el.addEventListener("change",()=>{
  const target=Math.max(1,parseInt(groupPostTargetGroups.value)||1),delay=Math.min(604800,Math.max(5,parseInt(groupPostInterDelay.value)||30));
  groupPostTargetGroups.value=target;groupPostInterDelay.value=delay;
  chrome.storage.sync.set({groupPostTargetGroups:target,groupPostInterDelay:delay});
}));
function groupPostKey(g){
  try{
    const u=new URL(String(g?.url||""),location.origin);
    const path=u.pathname.match(/^\/groups\/([^/?#]+)/i)?.[1];
    if(path)return `/groups/${String(path).toLowerCase()}`;
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  return String(g?.id||g?.name||"").trim().toLowerCase();
}
function renderPostGroups(groups){
  const seen=new Set();
  postGroups=(groups||[]).filter(g=>{const key=groupPostKey(g);if(!key||seen.has(key))return false;seen.add(key);return true;});
  if(!postGroups.length){groupPostList.innerHTML='<div class="hint" style="padding:6px">'+t("c.noGroups")+'</div>';updateGroupPickCounts();return;}
  const esc=s=>String(s||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
  groupPostList.innerHTML=postGroups.map(g=>{
    const key=groupPostKey(g),w=groupPostWindowOf(key,g.name),sel=groupPostWindowOverrides[key];
    const autoLabel=`Auto·${w.windowHours}h`;
    return `<label data-key="${esc(key)}" data-name="${esc(String(g.name||"").toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee"><input class="post-group-check" type="checkbox" value="${esc(key)}" style="width:auto"><img src="${esc(g.icon||"icon128.png")}" style="width:30px;height:30px;border-radius:50%;object-fit:cover"><span style="font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name)}</span><select class="gp-win" data-key="${esc(key)}" title="Cửa sổ ngữ cảnh"><option value="auto"${sel===undefined?" selected":""}>${esc(autoLabel)}</option><option value="24"${sel===24?" selected":""}>24h</option><option value="48"${sel===48?" selected":""}>48h</option></select></label>`;
  }).join("");
  paintGroupPostSearchToggle();
  updateGroupPickCounts();
}
const groupPostWebSearch=$("groupPostWebSearch"),groupPostCtxEnabled=$("groupPostCtxEnabled");
const groupPostCtxMode=$("groupPostCtxMode"),groupPostMinLen=$("groupPostMinLen");
let groupPostCtxOn=false,groupPostCtxModeVal="saving",groupPostMinLenVal=200;
function readGroupPostDepthPrefs(){
  groupPostCtxModeVal=groupPostCtxMode&&groupPostCtxMode.value==="deep"?"deep":"saving";
  groupPostMinLenVal=Math.min(1000,Math.max(30,parseInt(groupPostMinLen&&groupPostMinLen.value)||200));
  if(groupPostMinLen)groupPostMinLen.value=groupPostMinLenVal;
}
async function saveGroupPostDepthPrefs(){try{await chrome.storage.sync.set({groupPostCtxMode:groupPostCtxModeVal,groupPostMinLen:groupPostMinLenVal});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
if(groupPostCtxMode)groupPostCtxMode.addEventListener("change",async()=>{readGroupPostDepthPrefs();await saveGroupPostDepthPrefs();});
if(groupPostMinLen)groupPostMinLen.addEventListener("change",async()=>{readGroupPostDepthPrefs();await saveGroupPostDepthPrefs();});
function paintGroupPostCtxEnabled(){
  if(groupPostCtxEnabled)groupPostCtxEnabled.checked=groupPostCtxOn;
  const row=document.querySelector(".gp-search-row");
  if(row)row.classList.toggle("gp-dim",!groupPostCtxOn);
  if(groupPostWebSearch)groupPostWebSearch.disabled=!groupPostCtxOn;
}
if(groupPostCtxEnabled)groupPostCtxEnabled.addEventListener("change",async()=>{
  groupPostCtxOn=!!groupPostCtxEnabled.checked;
  try{await chrome.storage.sync.set({groupPostCtxEnabled:groupPostCtxOn});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  paintGroupPostCtxEnabled();
});
function paintGroupPostSearchToggle(){
  if(!groupPostWebSearch)return;
  const sel=[...groupPostList.querySelectorAll(".post-group-check:checked")].map(b=>b.value);
  groupPostWebSearch.checked=!sel.length?groupPostWebSearchDefault:groupPostSearchOf(sel[0]);
}
if(groupPostWebSearch)groupPostWebSearch.addEventListener("change",async()=>{
  const on=!!groupPostWebSearch.checked;
  const sel=[...groupPostList.querySelectorAll(".post-group-check:checked")].map(b=>b.value);
  try{
    if(!sel.length){groupPostWebSearchDefault=on;await chrome.storage.sync.set({groupPostWebSearchDefault:on});}
    else{sel.forEach(k=>{groupPostSearchOverrides[k]=on;});await chrome.storage.sync.set({groupPostSearchOverrides});}
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
});
groupPostList.addEventListener("change",async e=>{
  const win=e.target.closest?e.target.closest(".gp-win"):null;
  if(win&&win.dataset.key){
    const v=win.value,key=win.dataset.key;
    if(v==="24")groupPostWindowOverrides[key]=24;
    else if(v==="48")groupPostWindowOverrides[key]=48;
    else delete groupPostWindowOverrides[key];
    try{await chrome.storage.sync.set({groupPostWindowOverrides});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    return;
  }
  if(e.target.classList&&e.target.classList.contains("post-group-check"))paintGroupPostSearchToggle();
});
loadPostGroupsBtn.onclick=async()=>{
  const {groups}=await requestJoinedGroupsScan(groupPostStatus,t("p.gpLoadGroups"),n=>t("p.gpLoaded",{n}));
  renderPostGroups(groups);
};
selectAllPostGroupsBtn.onclick=()=>{const rows=[...groupPostList.querySelectorAll('label[data-name]')].filter(r=>r.style.display!=="none"),bs=rows.map(r=>r.querySelector('.post-group-check')).filter(Boolean);const on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);updateGroupPickCounts();};
groupPostKeyword.oninput=()=>{const k=groupPostKeyword.value.trim().toLocaleLowerCase("vi");groupPostList.querySelectorAll('label[data-name]').forEach(r=>r.style.display=!k||r.dataset.name.toLocaleLowerCase("vi").includes(k)?"flex":"none");};
function selectedPostGroups(){const keys=new Set([...groupPostList.querySelectorAll('.post-group-check:checked')].map(b=>b.value));return postGroups.filter(g=>keys.has(groupPostKey(g)));}
function readGroupPostBackgroundConfig(){
  const mode=groupPostBackgroundMode.value==="fixed"?"fixed":"random";
  const fixedColor=GROUP_POST_PREVIEW_COLORS[groupPostFixedColor.value]?groupPostFixedColor.value:"pink";
  const colors=[...document.querySelectorAll('.group-post-bg-color:checked')].map(el=>el.value).filter(v=>GROUP_POST_PREVIEW_COLORS[v]);
  return {
    enabled:!!groupPostBackgroundEnabled.checked,
    mode,
    fixedColor,
    colors:colors.length?colors:Object.keys(GROUP_POST_PREVIEW_COLORS),
    maxChars:Math.min(130,Math.max(40,parseInt(groupPostMaxChars.value)||100)),
    fallback:"skip"
  };
}
function toggleGroupPostBackgroundOptions(){const en=!!groupPostBackgroundEnabled.checked,isFixed=groupPostBackgroundMode.value==="fixed";groupPostBackgroundOptions.classList.toggle("hidden",!en);groupPostFixedColorWrap.classList.toggle("hidden",!isFixed);const colorsDiv=$("groupPostBackgroundColors"),paletteHint=colorsDiv?.previousElementSibling;if(colorsDiv)colorsDiv.classList.toggle("palette-hidden",isFixed);if(paletteHint&&paletteHint.classList.contains("hint"))paletteHint.style.display=isFixed?"none":"";}
async function saveGroupPostBackgroundDraft(){const bg=readGroupPostBackgroundConfig();await chrome.storage.sync.set({groupPostBackgroundEnabled:bg.enabled,groupPostBackgroundMode:bg.mode,groupPostFixedColor:bg.fixedColor,groupPostBackgroundColors:bg.colors,groupPostMaxChars:bg.maxChars,groupPostBackgroundFallback:"skip"});}
groupPostBackgroundEnabled.addEventListener("change",()=>{toggleGroupPostBackgroundOptions();saveGroupPostBackgroundDraft();});
groupPostBackgroundMode.addEventListener("change",()=>{toggleGroupPostBackgroundOptions();saveGroupPostBackgroundDraft();});
groupPostFixedColor.addEventListener("change",saveGroupPostBackgroundDraft);
document.querySelectorAll('.group-post-bg-color').forEach(el=>el.addEventListener("change",saveGroupPostBackgroundDraft));
[groupPostMaxChars].forEach(el=>el.addEventListener("change",saveGroupPostBackgroundDraft));
function cleanPastedApiKey(value){return String(value||"").trim().replace(/^GEMINI_API_KEY\s*=\s*/i,"").replace(/^['"]|['"]$/g,"").trim();}
async function refreshUnifiedAiUi(){try{await renderAiProfileRows();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
groupPostPreviewBtn.onclick=async()=>{
  const group=selectedPostGroups()[0];
  if(!group){groupPostStatus.textContent=t("p.gpNeedPreviewGroups");return;}
  const prompt=groupPostPrompt.value.trim(),background=readGroupPostBackgroundConfig();
  const aiConfig=await getAiProfileFor("groupPost");
  if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model)){groupPostStatus.textContent=t("p.gpNeedKeyModel");return;}
  if(!prompt.includes("{groupName}")){groupPostStatus.textContent=t("p.gpNeedPrompt");return;}
  if(background.enabled&&background.mode==="random"&&!background.colors.length){groupPostStatus.textContent=t("p.gpNeedColor");return;}
  groupPostPreviewBtn.disabled=true;groupPostStatus.textContent=t("p.gpPreviewRun",{name:group.name});
  try{
    // Nguồn tin X: lấy 1 tin mới nhất rồi viết lại bằng prompt X (không đăng).
    if(groupPostSourceMode()==="x"){
      const users=await groupPostResolveXUsersLive();
      if(!users.length)throw new Error(t("bg.newsNoXUsers"));
      const xp=String(groupPostXPrompt?.value||"").trim()||t("gp.xPromptDefault");
      if(!xp.includes("{newsText}"))throw new Error(t("nw.needNewsText"));
      if(!xp.includes("{groupName}"))throw new Error(t("p.gpNeedPrompt"));
      const fres=await chrome.runtime.sendMessage({action:"newsFetch",source:{type:"xread",users},count:3});
      if(!fres?.ok)throw new Error(fres?.error||"?");
      const it=(fres.items||[])[0];
      if(!it)throw new Error(t("bg.newsXEmpty"));
      const photo=groupPostXPhoto?.checked!==false;
      const gen=await chrome.runtime.sendMessage({action:"aiGenerateNewsPost",news:{title:it.title,desc:it.desc,pubDate:it.pubDate||""},topic:group.name,mode:photo?"long":"long",kind:photo?"photo":"text",maxChars:0,prompt:xp,groupName:group.name,aiConfig});
      if(!gen?.ok)throw new Error(gen?.error||t("p.gpAiFail"));
      groupPostPreview.textContent=gen.content+(photo?"\n\n[ kèm ảnh chụp bài X ]":"");
      groupPostPreview.style.background="#f0f2f5";groupPostPreview.style.color="#050505";
      groupPostPreview.classList.remove("hidden");
      groupPostStatus.textContent=t("p.gpPreviewOk",{len:gen.content.length,max:"1800"});
      return;
    }
    if(groupPostSourceMode()==="web"){
      const webCfg=await groupPostResolveWebConfigLive();
      if(!webCfg.urls.length)throw new Error(t("bg.newsSitesEmpty"));
      const fres=await chrome.runtime.sendMessage({action:"newsFetch",source:{type:"sites",urls:webCfg.urls,q:webCfg.q,hours:webCfg.hours},count:3});
      if(!fres?.ok)throw new Error(fres?.error||"?");
      const it=(fres.items||[])[0];
      if(!it)throw new Error(t("bg.newsEmpty"));
      const wp=String(groupPostWebPrompt?.value||"").trim()||t("gp.webPromptDefault");
      if(!wp.includes("{newsText}"))throw new Error(t("nw.needNewsText"));
      const gen=await chrome.runtime.sendMessage({action:"aiGenerateNewsPost",news:{title:it.title,desc:it.desc,pubDate:it.pubDate||""},topic:group.name,mode:"long",kind:"text",maxChars:0,prompt:wp,groupName:group.name,aiConfig});
      if(!gen?.ok)throw new Error(gen?.error||t("p.gpAiFail"));
      groupPostPreview.textContent=gen.content;
      groupPostPreview.style.background="#f0f2f5";groupPostPreview.style.color="#050505";
      groupPostPreview.classList.remove("hidden");
      groupPostStatus.textContent=t("p.gpPreviewOk",{len:gen.content.length,max:"1800"});
      return;
    }
    const meta=enrichGroupPostGroups([group])[0];
    let today="";
    try{today=new Date().toLocaleDateString("vi-VN");}catch(_){today=new Date().toISOString().slice(0,10);}
    const ai=await chrome.runtime.sendMessage({action:"aiGenerateGroupPost",groupName:group.name,prompt,aiConfig,background,groupContext:groupPostCtxOn?{groupName:group.name,groupType:meta.groupType,windowHours:meta.windowHours,today,digest:null}:null,useSearch:groupPostCtxOn&&meta.webSearch});
    if(!ai?.ok)throw new Error(ai?.error||t("p.gpAiFail"));
    const color=background.enabled?(background.mode==="fixed"?background.fixedColor:background.colors[Math.floor(Math.random()*background.colors.length)]):"plain";
    groupPostPreview.textContent=ai.content;
    groupPostPreview.style.background=color==="plain"?"#f0f2f5":GROUP_POST_PREVIEW_COLORS[color];
    groupPostPreview.style.color=color==="plain"?"#050505":"#fff";
    groupPostPreview.classList.remove("hidden");
    groupPostStatus.textContent=t("p.gpPreviewOk",{len:ai.content.length,max:background.enabled?background.maxChars:"1800"});
  }catch(e){groupPostStatus.textContent=t("p.gpPreviewFail",{err:e.message});}
  finally{groupPostPreviewBtn.disabled=false;}
};
groupPostStartBtn.onclick=async()=>{
  if(isGroupPostRunning){groupPostStatus.textContent=t("p.gpBusy");return;}
  const shareRun=await chrome.storage.local.get(["groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive",...FEED_SCOPED_ACTIVE_KEYS]);if(Object.values(shareRun).some(Boolean)){groupPostStatus.textContent=(shareRun.pageGroupJoinActive||shareRun.pageGroupPostActive||shareRun.pageCommentActive||shareRun.pageSalesPostActive||FEED_SCOPED_ACTIVE_KEYS.some(key=>shareRun[key]))?t("pg.busyOther"):t("p.shBusyPost");return;}
  const selectedGroups=selectedPostGroups();
  const requestedGroups=Math.max(1,parseInt(groupPostTargetGroups.value)||1);
  const groups=enrichGroupPostGroups(selectedGroups.slice(0,Math.min(requestedGroups,selectedGroups.length)));
  const prompt=groupPostPrompt.value.trim(),minDelay=GROUP_POST_AUTO_TIMING.minDelay,maxDelay=GROUP_POST_AUTO_TIMING.maxDelay,background=readGroupPostBackgroundConfig();
  if(!selectedGroups.length){groupPostStatus.textContent=t("p.gpNeedGroups");return;}
  if(requestedGroups>selectedGroups.length){groupPostStatus.textContent=t("p.gpOnlyReal",{n:selectedGroups.length});}
  const interGroupDelay=Math.min(604800,Math.max(5,parseInt(groupPostInterDelay.value)||30));
  groupPostInterDelay.value=interGroupDelay;
  // Lượt chạy dùng hồ sơ AI đã gán cho groupPost (tab AI chung).
  const aiConfig=await getAiProfileFor("groupPost");
  if(aiKeyRequired(aiConfig)&&!aiConfig.key){groupPostStatus.textContent=t("p.gpNeedKey");return;}
  if(aiKeyRequired(aiConfig)&&!aiConfig.model){groupPostStatus.textContent=t("p.gpNeedModel");return;}
  if(!prompt.includes("{groupName}")){groupPostStatus.textContent=t("p.gpNeedPrompt");return;}
  const runId=`group-post-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  readGroupPostDepthPrefs();
  // Nguồn tin X/Web: user/site từ danh sách đã lưu hoặc tự nhập; prompt riêng.
  const gpSrcMode=groupPostSourceMode();
  let gpXUsers=[],gpXPrompt="",gpWithXPhoto=false;
  let gpWebUrls=[],gpWebQ="",gpWebHours=24,gpWebPrompt="";
  let gpFbUrls=[],gpFbHours=24,gpFbMode="rewrite",gpFbIncludeComment=true,gpFbPrompt="";
  if(gpSrcMode==="x"){
    gpXUsers=await groupPostResolveXUsersLive();
    if(!gpXUsers.length){groupPostStatus.textContent=t("bg.newsNoXUsers");return;}
    gpXPrompt=String(groupPostXPrompt?.value||"").trim()||t("gp.xPromptDefault");
    if(!gpXPrompt.includes("{newsText}")){groupPostStatus.textContent=t("nw.needNewsText");return;}
    if(!gpXPrompt.includes("{groupName}")){groupPostStatus.textContent=t("p.gpNeedPrompt");return;}
    gpWithXPhoto=groupPostXPhoto?.checked!==false;
  }else if(gpSrcMode==="web"){
    const webCfg=await groupPostResolveWebConfigLive();
    gpWebUrls=webCfg.urls; gpWebQ=webCfg.q; gpWebHours=webCfg.hours;
    gpWebPrompt=String(groupPostWebPrompt?.value||"").trim()||t("gp.webPromptDefault");
    if(!gpWebUrls.length){groupPostStatus.textContent=t("bg.newsSitesEmpty");return;}
    if(!gpWebQ) { /* allow empty keyword = lấy tất cả */ }
    if(!gpWebPrompt.includes("{newsText}")){groupPostStatus.textContent=t("nw.needNewsText");return;}
    if(!gpWebPrompt.includes("{groupName}")){groupPostStatus.textContent=t("p.gpNeedPrompt");return;}
  }else if(gpSrcMode==="fb"){
    const fb=await groupPostResolveFbConfigLive();
    gpFbUrls=fb.urls;gpFbHours=fb.hours;gpFbMode=fb.mode;gpFbIncludeComment=fb.includeComment;
    const promptEl=gpFbMode==="opinion_screenshot"?groupPostFbOpinionPrompt:groupPostFbRewritePrompt;
    gpFbPrompt=String(promptEl?.value||"").trim();
    if(!gpFbUrls.length){groupPostStatus.textContent=t("bg.newsNoFbUrls");return;}
    if(gpFbPrompt&&!gpFbPrompt.includes("{newsText}")){groupPostStatus.textContent=t("nw.needNewsText");return;}
    if(gpFbPrompt&&!gpFbPrompt.includes("{groupName}")){groupPostStatus.textContent=t("p.gpNeedPrompt");return;}
  }
  const cfg={groups,prompt,minDelay,maxDelay,interGroupDelay,aiConfig,background,typingConfig:getAiTypingConfig("groupPost"),runId,ctxEnabled:groupPostCtxOn,ctxMode:groupPostCtxModeVal,minLen:groupPostMinLenVal,source:gpSrcMode==="x"?{type:"x",users:gpXUsers}:gpSrcMode==="web"?{type:"sites",urls:gpWebUrls,q:gpWebQ,hours:gpWebHours}:gpSrcMode==="fb"?{type:"fb",urls:gpFbUrls,hours:gpFbHours,mode:gpFbMode,includeComment:gpFbIncludeComment}:null,xPrompt:gpXPrompt,withXPhoto:gpWithXPhoto,xHours:gpSrcMode==="x"?Math.min(100000,Math.max(0,parseInt(groupPostXHours?.value)||0)):0,webPrompt:gpWebPrompt,withWebPhoto:gpSrcMode==="web"?!!groupPostWebWithPhoto?.checked:false,fbPrompt:gpFbPrompt,withFbPhoto:gpSrcMode==="fb"};await chrome.storage.sync.set({groupPostPrompt:prompt,groupPostTargetGroups:requestedGroups,groupPostInterDelay:interGroupDelay,groupPostBackgroundEnabled:background.enabled,groupPostBackgroundMode:background.mode,groupPostFixedColor:background.fixedColor,groupPostBackgroundColors:background.colors,groupPostMaxChars:background.maxChars,groupPostBackgroundFallback:"skip"});persistGroupPostDraft();
  if(gpSrcMode==="fb"&&cfg.source)cfg.source.backgroundOnly=!!groupPostFbBackgroundOnly?.checked;
  setGroupPostRunning(true);
  const tab=await ensureTaskTab(
    groups[0].url,
    groupPostStatus,
    t("p.openFirstGroup",{name:groups[0].name}),
    url=>url.includes("facebook.com/groups/"),
    async owner=>{
      await chrome.storage.local.set({groupPostActive:true,groupPostRunId:runId,groupPostConfig:{...cfg,ownerTabId:owner.id},groupPostIndex:0,groupPostDone:0,groupPostSkipped:0,groupPostTotal:groups.length,groupPostNextAt:0,groupPostLastColor:"",groupPostRetryCount:0,groupPostGroupReadyRetry:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostStage:"",groupPostSubmitRunId:"",groupPostSubmitIndex:-1,groupPostSubmitDispatchedAt:0,groupPostStatus:t("gp2.starting")});
    }
  );if(!tab){setGroupPostRunning(false);await chrome.storage.local.set({groupPostActive:false});return;}
  chrome.tabs.sendMessage(tab.id,{action:"startGroupPost",...cfg,ownerTabId:tab.id},async res=>{
    if(chrome.runtime.lastError){
      const retry=await autoReloadAndRetry(tab.id,{action:"startGroupPost",...cfg,ownerTabId:tab.id},groupPostStatus);
      if(retry.ok&&retry.res?.ok){groupPostStatus.textContent=t("p.gpRunning",{n:groups.length,d:interGroupDelay});return;}
      if(await runStillActive("groupPostActive")){groupPostStatus.textContent=t("p.gpRunning",{n:groups.length,d:interGroupDelay});return;}
      setGroupPostRunning(false);groupPostStatus.textContent=retry.res?.error||t("p.gpStartFail");return;
    }
    if(res&&res.ok){groupPostStatus.textContent=t("p.gpRunning",{n:groups.length,d:interGroupDelay});return;}
    if(await runStillActive("groupPostActive")){groupPostStatus.textContent=t("p.gpRunning",{n:groups.length,d:interGroupDelay});return;}
    await chrome.storage.local.set({groupPostActive:false});
    setGroupPostRunning(false);groupPostStatus.textContent=res?.error||t("p.gpStartFail");return;
  });
};
groupPostStopBtn.onclick=async()=>{setGroupPostRunning(false);await chrome.storage.local.set({groupPostActive:false,groupPostNextAt:0,groupPostStage:"",groupPostStatus:t("p.gpStopped"),groupPostStopOrigin:{by:"popup-stop-btn",at:Date.now()}});broadcastToFacebookTabs({action:"stopGroupPost"});const tab=await getActiveTab();if(tab)chrome.tabs.sendMessage(tab.id,{action:"stopGroupPost"});};
groupPostResetBtn.onclick=async()=>{setGroupPostRunning(false);await chrome.storage.local.set({groupPostActive:false,groupPostRunId:"",groupPostIndex:0,groupPostDone:0,groupPostSkipped:0,groupPostTotal:0,groupPostNextAt:0,groupPostLastColor:"",groupPostRetryCount:0,groupPostGroupReadyRetry:0,groupPostPendingContent:"",groupPostPendingIndex:-1,groupPostPendingWebItem:null,groupPostPendingFbItem:null,groupPostStage:"",groupPostSubmitRunId:"",groupPostSubmitIndex:-1,groupPostSubmitDispatchedAt:0,groupPostStatus:t("gp.resetDone")});broadcastToFacebookTabs({action:"stopGroupPost"});const tab=await getActiveTab();if(tab)chrome.tabs.sendMessage(tab.id,{action:"stopGroupPost"});};
chrome.storage.local.get(["joinedGroups","groupPostStatus","groupPostDone","groupPostSkipped","groupPostTotal","groupPostActive"],r=>{if(r.joinedGroups)renderPostGroups(r.joinedGroups);if(r.groupPostStatus)groupPostStatus.textContent=r.groupPostStatus;groupPostCount.textContent=t("p.gpCount",{d:r.groupPostDone||0,t:r.groupPostTotal||0,s:r.groupPostSkipped||0});if(r.groupPostActive)setGroupPostRunning(true);});
loadGroupPostCtxPrefs().then(()=>{if(postGroups.length)renderPostGroups(postGroups);paintGroupPostSearchToggle();paintGroupPostCtxEnabled();});
chrome.storage.sync.get(["groupPostPrompt","groupPostTargetGroups","groupPostInterDelay","groupPostBackgroundEnabled","groupPostBackgroundMode","groupPostFixedColor","groupPostBackgroundColors","groupPostMaxChars","groupPostSource","groupPostXList","groupPostXUsers","groupPostXPhoto","groupPostXPrompt","groupPostXHours","groupPostXUseShared","groupPostWebUseShared","groupPostWebSiteList","groupPostWebKeyword","groupPostWebHours","groupPostWebPrompt","groupPostWebWithPhoto","groupPostFbUseShared","groupPostFbList","groupPostFbUrls","groupPostFbHours","groupPostFbMode","groupPostFbIncludeComment","groupPostFbRewritePrompt","groupPostFbOpinionPrompt"],async r=>{if(r.groupPostPrompt!==undefined)setPromptIf(groupPostPrompt,r.groupPostPrompt);if(r.groupPostTargetGroups!==undefined)groupPostTargetGroups.value=r.groupPostTargetGroups;if(r.groupPostInterDelay!==undefined)groupPostInterDelay.value=Math.min(604800,Math.max(5,r.groupPostInterDelay));groupPostBackgroundEnabled.checked=r.groupPostBackgroundEnabled!==false;if(r.groupPostBackgroundMode)groupPostBackgroundMode.value=r.groupPostBackgroundMode==="fixed"?"fixed":"random";if(r.groupPostFixedColor&&GROUP_POST_PREVIEW_COLORS[r.groupPostFixedColor])groupPostFixedColor.value=r.groupPostFixedColor;if(Array.isArray(r.groupPostBackgroundColors)){document.querySelectorAll('.group-post-bg-color').forEach(el=>el.checked=r.groupPostBackgroundColors.includes(el.value));}if(r.groupPostMaxChars)groupPostMaxChars.value=Math.min(130,Math.max(40,parseInt(r.groupPostMaxChars)||100));toggleGroupPostBackgroundOptions();if(groupPostSource&&r.groupPostSource)groupPostSource.value=(r.groupPostSource==="x"||r.groupPostSource==="web"||r.groupPostSource==="fb")?r.groupPostSource:"ai";if(r.groupPostXUsers!==undefined&&groupPostXUsers)groupPostXUsers.value=r.groupPostXUsers;if(groupPostXPhoto)groupPostXPhoto.checked=r.groupPostXPhoto!==false;if(r.groupPostXPrompt!==undefined)setPromptIf(groupPostXPrompt,r.groupPostXPrompt);if(groupPostXHours&&["0","24","72","168"].includes(String(r.groupPostXHours??"24")))groupPostXHours.value=String(r.groupPostXHours);if(groupPostXUseShared)groupPostXUseShared.checked=r.groupPostXUseShared!==false;if(groupPostWebUseShared)groupPostWebUseShared.checked=r.groupPostWebUseShared!==false;if(r.groupPostWebSiteList!==undefined&&groupPostWebSiteList)groupPostWebSiteList.value=r.groupPostWebSiteList;if(r.groupPostWebKeyword!==undefined&&groupPostWebKeyword)groupPostWebKeyword.value=r.groupPostWebKeyword;if(groupPostWebHours&&["0","24","48","72","168"].includes(String(r.groupPostWebHours??"24")))groupPostWebHours.value=String(r.groupPostWebHours);if(r.groupPostWebPrompt!==undefined&&groupPostWebPrompt)setPromptIf(groupPostWebPrompt,r.groupPostWebPrompt);if(r.groupPostWebWithPhoto!==undefined&&groupPostWebWithPhoto)groupPostWebWithPhoto.checked=!!r.groupPostWebWithPhoto;if(groupPostFbUseShared)groupPostFbUseShared.checked=r.groupPostFbUseShared!==false;if(r.groupPostFbUrls!==undefined&&groupPostFbUrls)groupPostFbUrls.value=r.groupPostFbUrls;if(groupPostFbHours&&["0","24","48","72","168"].includes(String(r.groupPostFbHours??"24")))groupPostFbHours.value=String(r.groupPostFbHours);if(groupPostFbMode)groupPostFbMode.value=["rewrite","rewrite_original","opinion_screenshot"].includes(r.groupPostFbMode)?r.groupPostFbMode:"rewrite";if(groupPostFbIncludeComment)groupPostFbIncludeComment.checked=r.groupPostFbIncludeComment!==false;if(r.groupPostFbRewritePrompt!==undefined&&groupPostFbRewritePrompt)groupPostFbRewritePrompt.value=r.groupPostFbRewritePrompt;if(r.groupPostFbOpinionPrompt!==undefined&&groupPostFbOpinionPrompt)groupPostFbOpinionPrompt.value=r.groupPostFbOpinionPrompt;groupPostToggleSourceUI();refreshGroupPostXListUI(r.groupPostXList||"");refreshGroupPostFbListUI(r.groupPostFbList||"");});
// Nâng prompt stock cũ (1-2 câu hỏi ngắn chung chung) lên prompt sâu mới — chỉ khi
// user chưa từng sửa prompt (nhận diện bằng cụm đặc trưng), prompt tay giữ nguyên.
chrome.storage.sync.get(["groupPostPrompt","groupPostPromptVer"],async r=>{
  try{
    if(r.groupPostPromptVer===2)return;
    const cur=String(r.groupPostPrompt!==undefined?r.groupPostPrompt:(groupPostPrompt.value||""));
    if(cur.includes("có một câu hỏi ngắn để thành viên dễ phản hồi")||cur.includes("with one short question members can reply to")){
      groupPostPrompt.value=t("gp.promptDefault");
      await chrome.storage.sync.set({groupPostPrompt:groupPostPrompt.value});
    }
    await chrome.storage.sync.set({groupPostPromptVer:2});
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
});
chrome.storage.onChanged.addListener(c=>{if(c.groupPostStatus)groupPostStatus.textContent=c.groupPostStatus.newValue;if(c.groupPostActive!==undefined)setGroupPostRunning(c.groupPostActive.newValue);if(c.groupPostDone||c.groupPostSkipped||c.groupPostTotal)chrome.storage.local.get(["groupPostDone","groupPostSkipped","groupPostTotal"],r=>groupPostCount.textContent=t("p.gpCount",{d:r.groupPostDone||0,t:r.groupPostTotal||0,s:r.groupPostSkipped||0}));});

// SHARE BAI FACEBOOK VAO NHOM - state va logic tach rieng voi dang bai AI
const groupShareSourceUrl=$("groupShareSourceUrl"),groupShareTargetGroups=$("groupShareTargetGroups"),groupShareInterDelay=$("groupShareInterDelay"),groupSharePrompt=$("groupSharePrompt");
const groupShareCount=$("groupShareCount"),groupShareStatus=$("groupShareStatus"),groupShareAiSummary=$("groupShareAiSummary"),groupShareAiTestBtn=$("groupShareAiTestBtn");
const groupShareStartBtn=$("groupShareStartBtn"),groupShareStopBtn=$("groupShareStopBtn"),groupShareResetBtn=$("groupShareResetBtn");
let isGroupShareRunning=false;
function setGroupShareRunning(v){isGroupShareRunning=v;groupShareStartBtn.textContent=v?t("p.shBusy"):t("sh.start");groupShareStartBtn.classList.toggle("running",v);setPromptEditorState(v,groupSharePrompt,"groupSharePromptLockHint");}
const loadShareGroupsBtn=$("loadShareGroupsBtn"),selectAllShareGroupsBtn=$("selectAllShareGroupsBtn"),groupShareKeyword=$("groupShareKeyword"),groupShareList=$("groupShareList");
const groupShareSourceText=$("groupShareSourceText"),groupShareAiTranscript=$("groupShareAiTranscript"),groupShareAiActivity=$("groupShareAiActivity"),groupShareAiChatInput=$("groupShareAiChatInput"),groupShareAiChatBtn=$("groupShareAiChatBtn"),groupShareAiClearBtn=$("groupShareAiClearBtn");
let shareGroups=[],shareAiMessages=[],shareAiSourceUrl="",shareSourceSaveTimer=0,shareSourceDirty=false,shareSourceManualEdit=false;
bindPromptPersistence("groupSharePrompt",groupSharePrompt);
function shareEscape(value){return String(value||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));}
function normalizeFacebookShareSource(value){
  const raw=String(value||"").trim();if(!raw)throw new Error(t("p.shNeedLink"));
  let url;try{url=new URL(raw);}catch{throw new Error(t("p.shBadUrl"));}
  const host=url.hostname.toLowerCase();
  if(!(host==="facebook.com"||host.endsWith(".facebook.com")||host==="fb.watch"))throw new Error(t("p.shNeedFb"));
  if(!/^https?:$/.test(url.protocol))throw new Error(t("p.shBadProto"));
  const isPostLink=host==="fb.watch"||/\/(?:posts?|permalink|photos?|videos?|reel|watch)\/|\/groups\/[^/]+\/(?:posts?|permalink)\/|\/share\/(?:p|r|v)\/|\/(?:story|permalink)\.php/i.test(url.pathname)||url.searchParams.has("story_fbid")||url.searchParams.has("fbid");
  if(!isPostLink)throw new Error(t("p.shNotPost"));
  url.hash="";
  ["__cft__","__tn__","mibextid","ref","refid","locale","comment_id","reply_comment_id"].forEach(key=>url.searchParams.delete(key));
  return url.toString();
}
function renderShareGroups(groups,selectedIds=[]){
  const selected=new Set((selectedIds||[]).map(String)),seen=new Set();
  shareGroups=(groups||[]).filter(group=>{const key=groupPostKey(group);if(!key||seen.has(key))return false;seen.add(key);return true;});
  if(!shareGroups.length){groupShareList.innerHTML='<div class="hint" style="padding:6px">'+t("c.noGroups")+'</div>';return;}
  groupShareList.innerHTML=shareGroups.map(group=>{const key=groupPostKey(group);return `<label data-name="${shareEscape(String(group.name||"").toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee;min-width:0"><input class="share-group-check" type="checkbox" value="${shareEscape(key)}" ${selected.has(key)?"checked":""} style="width:auto"><img src="${shareEscape(group.icon||"icon128.png")}" style="width:28px;height:28px;border-radius:50%;object-fit:cover"><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${shareEscape(group.name)}</span></label>`;}).join("");
}
function selectedShareGroups(){const keys=new Set([...groupShareList.querySelectorAll(".share-group-check:checked")].map(box=>box.value));return shareGroups.filter(group=>keys.has(groupPostKey(group)));}
function shareComparableUrl(value){try{return normalizeFacebookShareSource(value).replace(/\/$/,"");}catch{return String(value||"").trim().replace(/\/$/,"");}}
function renderShareAiTranscript(){
  if(!shareAiMessages.length){groupShareAiTranscript.innerHTML='<div class="hint">'+t("sh.noChat")+'</div>';return;}
  groupShareAiTranscript.innerHTML=shareAiMessages.slice(-20).map(item=>`<div class="share-ai-message ${item.role==="assistant"?"assistant":"user"}"><b>${item.role==="assistant"?t("p.shRoleAi"):t("p.shRoleYou")}:</b> ${shareEscape(item.content)}</div>`).join("");
  groupShareAiTranscript.scrollTop=groupShareAiTranscript.scrollHeight;
}
async function persistShareSourceDraft(manual=shareSourceManualEdit){
  const sourceUrl=shareComparableUrl(groupShareSourceUrl.value),text=groupShareSourceText.value.trim();
  shareAiSourceUrl=sourceUrl;shareSourceDirty=false;shareSourceManualEdit=!!manual;
  await chrome.storage.local.set({groupShareSourceDraftText:text,groupShareSourceDraftUrl:sourceUrl,groupShareSourceDraftManual:!!manual});
}
async function resetShareAiForNewUrl(){
  const sourceUrl=shareComparableUrl(groupShareSourceUrl.value);
  if(!shareAiSourceUrl||sourceUrl===shareComparableUrl(shareAiSourceUrl))return;
  shareAiSourceUrl=sourceUrl;shareAiMessages=[];shareSourceManualEdit=false;shareSourceDirty=false;groupShareSourceText.value="";renderShareAiTranscript();
  groupShareAiActivity.textContent=t("p.shLinkChanged");
  await chrome.storage.local.set({groupShareSourceDraftText:"",groupShareSourceDraftUrl:sourceUrl,groupShareSourceDraftManual:false,groupShareAiChatMessages:[],groupShareAiChatSourceUrl:sourceUrl,groupShareAiActivity:groupShareAiActivity.textContent});
}
async function saveShareDraft(){
  const target=Math.max(1,parseInt(groupShareTargetGroups.value)||1),delay=Math.min(604800,Math.max(5,parseInt(groupShareInterDelay.value)||30));
  groupShareTargetGroups.value=target;groupShareInterDelay.value=delay;
  await Promise.all([chrome.storage.sync.set({groupShareSourceUrl:groupShareSourceUrl.value.trim(),groupShareTargetGroups:target,groupShareInterDelay:delay}),chrome.storage.local.set({groupShareSelectedIds:selectedShareGroups().map(groupPostKey)})]);
}
async function refreshShareAiSummary(){const config=await getAiProfileFor("share");const who=config.profileName?` · ${config.profileName}`:"";groupShareAiSummary.textContent=(config.key||!aiKeyRequired(config))?t("p.shAiSummaryUse",{prov:config.provider,model:(config.model||t("p.noModelYet"))+who}):t("p.gpNeedKeyTab");groupShareAiChatBtn.textContent=config.provider==="gemini"?t("p.shChatSendGemini"):t("p.shChatSendProv",{prov:config.provider||"AI"});}
[groupShareSourceUrl,groupShareTargetGroups,groupShareInterDelay].forEach(el=>el.addEventListener("change",saveShareDraft));
groupShareSourceUrl.addEventListener("change",resetShareAiForNewUrl);
groupShareSourceText.addEventListener("input",()=>{shareSourceDirty=true;shareSourceManualEdit=true;clearTimeout(shareSourceSaveTimer);shareSourceSaveTimer=setTimeout(()=>persistShareSourceDraft(true),350);});
groupShareList.addEventListener("change",event=>{if(event.target.classList.contains("share-group-check"))saveShareDraft();});
groupShareKeyword.oninput=()=>{const key=groupShareKeyword.value.trim().toLocaleLowerCase("vi");groupShareList.querySelectorAll("label[data-name]").forEach(row=>row.style.display=!key||row.dataset.name.includes(key)?"flex":"none");};
selectAllShareGroupsBtn.onclick=()=>{const rows=[...groupShareList.querySelectorAll("label[data-name]")].filter(row=>row.style.display!=="none"),boxes=rows.map(row=>row.querySelector(".share-group-check")).filter(Boolean),turnOn=boxes.some(box=>!box.checked);boxes.forEach(box=>box.checked=turnOn);saveShareDraft();};
loadShareGroupsBtn.onclick=async()=>{
  const {ok,groups}=await requestJoinedGroupsScan(groupShareStatus,t("p.loadAllGroups"),n=>t("p.shLoaded",{n}));
  if(!ok)return;
  renderShareGroups(groups,groups.map(groupPostKey));
  await chrome.storage.local.set({groupShareSelectedIds:groups.map(groupPostKey)});
};
groupShareStartBtn.onclick=async()=>{
  if(isGroupShareRunning){groupShareStatus.textContent=t("p.shBusySelf");return;}
  let sourceUrl;try{sourceUrl=normalizeFacebookShareSource(groupShareSourceUrl.value);}catch(error){groupShareStatus.textContent=error.message;return;}
  const picked=selectedShareGroups(),target=Math.max(1,parseInt(groupShareTargetGroups.value)||1),groups=picked.slice(0,Math.min(target,picked.length));
  if(!picked.length){groupShareStatus.textContent=t("p.shNeedGroups");return;}
  const prompt=groupSharePrompt.value.trim();
  if(!prompt.includes("{postText}")||!prompt.includes("{groupName}")){groupShareStatus.textContent=t("p.shNeedPrompt");return;}
  const interGroupDelay=Math.min(604800,Math.max(5,parseInt(groupShareInterDelay.value)||30)),aiConfig=await getAiProfileFor("share");
  if(aiKeyRequired(aiConfig)&&!aiConfig.key){groupShareStatus.textContent=t("p.shNeedLeadKey");return;}
  if(!aiConfig.model){groupShareStatus.textContent=t("p.shNeedLeadModel");return;}
    const running=await chrome.storage.local.get(["groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","groupInteractActive","groupCommentActive","isAICommenting","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isGroupJoining","isDiscoverJoining","isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping"]);
  if(Object.entries(running).some(([key,value])=>key!=="groupShareActive"&&!!value)){groupShareStatus.textContent=t("p.shBusyOther");return;}
  if(running.groupShareActive){groupShareStatus.textContent=t("p.shBusySelf");return;}
  const draftUrl=shareComparableUrl(groupShareSourceUrl.value),storedDraftUrl=shareComparableUrl(shareAiSourceUrl),typedSource=groupShareSourceText.value.replace(/\s+/g," ").trim();
  // Text loaded from a previous AI read is not a manual source override.  A
  // manual override is only valid after the user has edited the source-text
  // box (or an older run explicitly persisted that origin), otherwise a
  // repeated Share of the same URL skips source DOM/identity extraction and
  // later rejects a valid preview because no canonical key/media was captured.
  const manualSourceText=typedSource.length>=10&&shareSourceManualEdit?typedSource:"";
  if(typedSource&&typedSource.length<10){groupShareStatus.textContent=t("p.shShortPost");return;}
  if(manualSourceText)await chrome.storage.local.set({groupShareSourceDraftText:manualSourceText,groupShareSourceDraftUrl:sourceUrl,groupShareSourceDraftManual:true});
  let tab=await getActiveTab();
  if(!tab)tab=await chrome.tabs.create({url:"about:blank"});
  const runId=`group-share-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const cfg={sourceUrl,groups,prompt,interGroupDelay,aiConfig,typingConfig:getAiTypingConfig("share"),runId,ownerTabId:tab.id,manualSourceText};
  await Promise.all([
    chrome.storage.sync.set({groupShareSourceUrl:sourceUrl,groupShareTargetGroups:target,groupShareInterDelay:interGroupDelay,groupSharePrompt:prompt}),
    chrome.storage.local.set({groupShareActive:true,groupShareConfig:cfg,groupShareSelectedIds:picked.map(groupPostKey),groupShareRunId:runId,groupShareOwnerTabId:tab.id,groupShareStage:manualSourceText?"groups":"source",groupShareSourceText:manualSourceText,groupShareSourceKey:"",groupShareSourceResolvedUrl:manualSourceText?sourceUrl:"",groupShareSourceMediaKeys:[],groupShareSourceDraftManual:!!manualSourceText,groupSharePreviewRejected:false,groupSharePreviewKey:"",groupSharePreviewLinks:[],groupSharePreviewImages:[],groupShareSourceNavigationAt:Date.now(),groupShareIndex:0,groupShareDone:0,groupShareSkipped:0,groupShareTotal:groups.length,groupShareNextAt:0,groupSharePendingCaption:"",groupSharePendingIndex:-1,groupShareRecentCaptions:[],groupShareSubmitDispatchedAt:0,groupShareStatus:manualSourceText?t("p.shManualReady"):t("p.shOpeningSource")})
  ]);
  shareAiSourceUrl=sourceUrl;shareSourceDirty=false;shareSourceManualEdit=!!manualSourceText;groupShareSourceUrl.value=sourceUrl;groupShareStatus.textContent=manualSourceText?t("p.shManual",{n:groups.length}):t("p.shReading",{n:groups.length});
  setGroupShareRunning(true);
  await chrome.tabs.update(tab.id,{url:sourceUrl});
};
groupShareStopBtn.onclick=async()=>{
  setGroupShareRunning(false);
  await chrome.storage.local.set({groupShareActive:false,groupShareNextAt:0,groupShareStatus:t("p.shStopped")});
  broadcastToFacebookTabs({action:"stopGroupShare"});
  const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"stopGroupShare"});
};
groupShareResetBtn.onclick=async()=>{
  setGroupShareRunning(false);
  await chrome.storage.local.set({groupShareActive:false,groupShareRunId:"",groupShareOwnerTabId:0,groupShareStage:"",groupShareSourceText:"",groupShareSourceKey:"",groupShareSourceResolvedUrl:"",groupShareSourceMediaKeys:[],groupShareSourceDraftManual:false,groupSharePreviewRejected:false,groupSharePreviewKey:"",groupSharePreviewLinks:[],groupSharePreviewImages:[],groupShareIndex:0,groupShareDone:0,groupShareSkipped:0,groupShareTotal:0,groupShareNextAt:0,groupSharePendingCaption:"",groupSharePendingIndex:-1,groupShareRecentCaptions:[],groupShareSubmitDispatchedAt:0,groupShareStatus:t("p.shResetDone")});
  broadcastToFacebookTabs({action:"resetGroupShare"});
  groupShareCount.textContent="0 / 0";
};
groupShareAiTestBtn.onclick=async()=>{const config=await getAiProfileFor("share");await testAiConnection(config,groupShareStatus,groupShareAiTestBtn);await refreshShareAiSummary();};
groupShareAiClearBtn.onclick=async()=>{
  shareAiMessages=[];renderShareAiTranscript();groupShareAiActivity.textContent=t("p.shChatCleared");
  await chrome.storage.local.set({groupShareAiChatMessages:[],groupShareAiChatSourceUrl:shareComparableUrl(groupShareSourceUrl.value),groupShareAiActivity:groupShareAiActivity.textContent,groupShareLastAiReply:""});
};
groupShareAiChatBtn.onclick=async()=>{
  const message=groupShareAiChatInput.value.trim();if(!message){groupShareAiActivity.textContent=t("p.shNeedChat");return;}
  const postText=groupShareSourceText.value.replace(/\s+/g," ").trim();if(postText.length<10){groupShareAiActivity.textContent=t("p.shNeedPost");return;}
  let aiConfig=await getAiProfileFor("share");if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model)){groupShareAiActivity.textContent=t("p.shNeedLeadBoth");return;}
  const sourceUrl=shareComparableUrl(groupShareSourceUrl.value);
  if(shareAiSourceUrl&&sourceUrl!==shareComparableUrl(shareAiSourceUrl)){shareAiMessages=[];}
  shareAiSourceUrl=sourceUrl;shareAiMessages=[...shareAiMessages,{role:"user",content:message,at:Date.now()}].slice(-20);renderShareAiTranscript();
  groupShareAiChatInput.value="";groupShareAiChatBtn.disabled=true;groupShareAiActivity.textContent=t("p.shAiWorking",{prov:aiConfig.provider==="gemini"?"Gemini":aiConfig.provider});
  await chrome.storage.local.set({groupShareSourceDraftText:postText,groupShareSourceDraftUrl:sourceUrl,groupShareSourceDraftManual:shareSourceManualEdit,groupShareAiChatMessages:shareAiMessages,groupShareAiChatSourceUrl:sourceUrl,groupShareAiActivity:groupShareAiActivity.textContent});
  try{
    const response=await chrome.runtime.sendMessage({action:"aiGroupShareChat",postText,sourceUrl,messages:shareAiMessages,aiConfig});
    if(!response?.ok)throw new Error(response?.error||t("p.shAiNoReply"));
    shareAiMessages=[...shareAiMessages,{role:"assistant",content:String(response.reply||"").trim(),at:Date.now()}].slice(-20);renderShareAiTranscript();
    groupShareAiActivity.textContent=t("p.shAiDone",{prov:response.provider||aiConfig.provider,model:response.model||aiConfig.model});
    await chrome.storage.local.set({groupShareAiChatMessages:shareAiMessages,groupShareAiChatSourceUrl:sourceUrl,groupShareAiActivity:groupShareAiActivity.textContent,groupShareLastAiReply:response.reply||""});
  }catch(error){groupShareAiActivity.textContent=t("p.shAiFail",{err:error.message});await chrome.storage.local.set({groupShareAiActivity:groupShareAiActivity.textContent});}
  finally{groupShareAiChatBtn.disabled=false;}
};
groupShareAiChatInput.addEventListener("keydown",event=>{if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();groupShareAiChatBtn.click();}});
chrome.storage.local.get(["joinedGroups","groupShareSelectedIds","groupShareStatus","groupShareDone","groupShareSkipped","groupShareTotal","groupShareActive","groupShareSourceText","groupShareSourceResolvedUrl","groupShareSourceDraftText","groupShareSourceDraftUrl","groupShareSourceDraftManual","groupShareAiChatMessages","groupShareAiChatSourceUrl","groupShareAiActivity"],async local=>{
  const sync=await chrome.storage.sync.get(["groupShareSourceUrl","groupShareTargetGroups","groupShareInterDelay","groupSharePrompt"]);
  renderShareGroups(local.joinedGroups||[],local.groupShareSelectedIds||[]);
  if(sync.groupShareSourceUrl!==undefined)groupShareSourceUrl.value=sync.groupShareSourceUrl;
  if(sync.groupShareTargetGroups!==undefined)groupShareTargetGroups.value=sync.groupShareTargetGroups;
  if(sync.groupShareInterDelay!==undefined)groupShareInterDelay.value=Math.min(604800,Math.max(5,sync.groupShareInterDelay));
  if(sync.groupSharePrompt!==undefined)setPromptIf(groupSharePrompt,sync.groupSharePrompt);
  if(local.groupShareStatus)groupShareStatus.textContent=local.groupShareStatus;
  const currentUrl=shareComparableUrl(groupShareSourceUrl.value),runtimeUrl=shareComparableUrl(local.groupShareSourceResolvedUrl||"");
  const draftUrl=shareComparableUrl(local.groupShareSourceDraftUrl||"");
  const runtimeText=runtimeUrl&&runtimeUrl===currentUrl&&local.groupShareSourceText?local.groupShareSourceText:"";
  groupShareSourceText.value=runtimeText||(draftUrl===currentUrl?local.groupShareSourceDraftText||"":"");
  shareSourceManualEdit=local.groupShareSourceDraftManual===true&&((!!runtimeText&&runtimeUrl===currentUrl)||draftUrl===currentUrl);
  shareAiSourceUrl=shareComparableUrl(local.groupShareAiChatSourceUrl||draftUrl||currentUrl);
  shareAiMessages=shareAiSourceUrl===currentUrl&&Array.isArray(local.groupShareAiChatMessages)?local.groupShareAiChatMessages:[];renderShareAiTranscript();
  if(local.groupShareAiActivity)groupShareAiActivity.textContent=local.groupShareAiActivity;
  if(local.groupShareActive)setGroupShareRunning(true);
  groupShareCount.textContent=t("p.shCount",{d:local.groupShareDone||0,t:local.groupShareTotal||0,s:local.groupShareSkipped||0});
  refreshShareAiSummary();
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=="local")return;if(changes.groupShareStatus)groupShareStatus.textContent=changes.groupShareStatus.newValue;if(changes.groupShareActive!==undefined)setGroupShareRunning(changes.groupShareActive.newValue);if(changes.groupShareSourceText?.newValue&&document.activeElement!==groupShareSourceText){groupShareSourceText.value=changes.groupShareSourceText.newValue;const runProvidedManual=changes.groupShareSourceDraftManual?.newValue===true;persistShareSourceDraft(runProvidedManual);}if(changes.groupShareAiActivity)groupShareAiActivity.textContent=changes.groupShareAiActivity.newValue||t("sh.aiWaiting");if(changes.groupShareDone||changes.groupShareSkipped||changes.groupShareTotal)chrome.storage.local.get(["groupShareDone","groupShareSkipped","groupShareTotal"],state=>groupShareCount.textContent=t("p.shCount",{d:state.groupShareDone||0,t:state.groupShareTotal||0,s:state.groupShareSkipped||0}));});

// AI COMMENT
const aiPrompt = $("aiPrompt");
const aiTarget = $("aiTarget");
const aiMinDelay = $("aiMinDelay");
const aiMaxDelay = $("aiMaxDelay");
const aiEconomyMode=$("aiEconomyMode"),aiBatchSize=$("aiBatchSize"),aiCacheDays=$("aiCacheDays");
const aiActionMode = $("aiActionMode");
const aiStartBtn = $("aiStartBtn");
const aiStopBtn = $("aiStopBtn");
const aiResetBtn = $("aiResetBtn");
const aiStatus = $("aiStatus");
const aiCountEl = $("aiCount");
const aiLikeCountEl = $("aiLikeCount");
const aiScanBtn = $("aiScanBtn");
const aiReaction = $("aiReaction");
const aiFeedCommentSettings = $("aiFeedCommentSettings");
const aiFeedModeBadgeEl = $("aiFeedModeBadge");
function renderAiFeedMode(){
  const mode=aiActionMode?.value||"comment";
  const isLike=mode==="like"||mode==="comment-like";
  const isComment=mode==="comment"||mode==="comment-like";
  if(aiFeedModeBadgeEl)aiFeedModeBadgeEl.textContent=mode==="like"?t("fd.modeLike"):mode==="comment-like"?t("fd.modeBoth"):t("fd.modeComment");
  if(aiLikeCountEl)aiLikeCountEl.textContent=isLike?`0 / ${parseInt($("aiTarget")?.value)||10}`:"—";
  if(aiCountEl)aiCountEl.textContent=isComment?`0 / ${parseInt($("aiTarget")?.value)||10}`:"—";
  if(aiFeedCommentSettings)aiFeedCommentSettings.style.display=isComment?"block":"none";
  const reactionWrapper=aiReaction?.parentElement;
  if(reactionWrapper)reactionWrapper.hidden=!isLike;
}
aiActionMode?.addEventListener("change",()=>{renderAiFeedMode();chrome.storage.sync.set({aiActionMode:aiActionMode.value});});
const providerDesc = {
  openai: t("ai.dp.openai"),
  gemini: t("ai.dp.gemini"),
  claude: t("ai.dp.Muse"),
  groq: t("ai.dp.groq"),
  openrouter: t("ai.dp.openrouter"),
  deepseek: t("ai.dp.deepseek"),
  vilao: "Vilao AI — 300+ models qua 1 API. Model ID dùng format provider/tên (vd: deepseek/deepseek-v4-pro). Bấm Refresh để load model đã subscribe. Đăng ký: vilao.ai",
  mistral: t("ai.dp.mistral"),
  custom: t("ai.dp.custom")
};
const providerModels={
  openai:["gpt-5-mini","gpt-4.1-mini","gpt-4o-mini"],
  gemini:[
    // --- Miễn phí (free tier) ---
    "gemini-3.5-flash-lite",      // nhẹ nhất, nhanh nhất ✓
    "gemini-flash-lite-latest",   // alias latest lite ✓
    "gemini-3.1-flash-lite",      // lite ổn định ✓
    "gemini-3.1-flash-lite-preview",
    "gemini-3-flash-preview",
    "gemini-3.5-flash",           // cân bằng tốt ✓
    "gemini-3.6-flash",           // mới hơn ✓
    "gemini-3.7-flash",           // mới hơn ✓
    "gemini-flash-latest",        // alias latest flash ✓
    // --- Trả phí (paid) ---
    "gemini-3.1-pro-preview",
    "gemini-3.5-pro",
  ],
  claude:["claude-haiku-4-5-20251001","claude-sonnet-4-6","claude-opus-4-6"],
  groq:["openai/gpt-oss-20b","openai/gpt-oss-120b","qwen/qwen3.6-27b"],
  openrouter:["openai/gpt-4o-mini","openai/gpt-4.1-mini","google/gemini-2.5-flash","anthropic/claude-sonnet-4"],
  deepseek:["deepseek-v4-flash","deepseek-v4-pro"],
  vilao:[
    // DeepSeek — format: provider/model
    "deepseek/deepseek-v4-pro","ds/deepseek-v4-flash","llms/deepseek-v4-flash","llms/deepseek-v4.1-flash",
    // Claude (qua stali provider)
    "stali/claude-haiku-4-5","stali/claude-sonnet-4-6-medium","stali/claude-sonnet-5-medium",
    "stali/claude-opus-4-6-medium","stali/claude-opus-4-7-medium","stali/claude-opus-4-8-medium","stali/claude-opus-5-medium",
    "stali/claude-opus-4-6-max-thinking","stali/claude-opus-4-7-max-thinking","stali/claude-opus-4-8-max-thinking","stali/claude-opus-5-max-thinking",
    "stali/claude-sonnet-4-6-max-thinking","stali/claude-sonnet-5-max-thinking",
    "ag/claude-sonnet-4-6","ag/claude-opus-4-6-thinking",
    // GPT / OpenAI
    "quick/gpt-5.4","quick/gpt-5.4-mini","quick/gpt-5.5","quick/gpt-5.6-terra",
    "cx/gpt-5.5","cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna",
    "plus/gpt-5.5","plus/gpt-5.6-sol","plus/gpt-5.6-terra","plus/gpt-5.6-luna",
    "stali/gpt-5.6-sol","stali/gpt-5.6-terra","stali/gpt-5.6-luna","llms/gpt-5.6-luna",
    // Gemini
    "llms/gemini-3.1-flash-lite","llms/gemini-3.5-flash-lite","llms/gemini-3.6-flash","llms/gemini-3.7-flash","llms/gemini-3.8-flash",
    "ag/gemini-3.6-flash-medium","ag/gemini-3.6-flash-high","ag/gemini-3.7-flash-medium","ag/gemini-3.7-flash-high","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high",
    // Grok / xAI
    "llms/grok-4.6",
    // Qwen / Alibaba
    "qwen/qwen3-235b-a22b-2507","llms/qwen-3.7-plus","stali/qwen3-codex",
    // Kimi / Moonshot
    "moonshotai/kimi-k3","habibi/kimi-k3",
    // GLM / Zhipu
    "glm/glm-5.2","glm/glm-5.3","habibi/glm-5.3","habibi/glm-5.3-flash","llms/glm-5.2","llms/glm-5.3","stali/glm-5",
    // MiniMax
    "stali/minimax-m2.1","stali/minimax-m2.5",
    // Tencent
    "tencent/hy4-preview",
    // Nvidia
    "nvidia/nemotron-3-super-120b-a12b","nvidia/nemotron-3-ultra-550b-a55b",
  ],
  mistral:["mistral-small-latest","mistral-medium-latest","mistral-large-latest"],
  "meta-free":["meta-ai"],
  custom:[]
};
const MODEL_CACHE_TTL_MS=6*60*60*1000;
let dynamicProviderModels={};
let modelCatalogRequestId=0;
function normalizedModelProvider(provider){return provider==="Muse"?"claude":provider;}
function modelsForProvider(provider){
  const normalized=normalizedModelProvider(provider);
  const dynamic=dynamicProviderModels[normalized];
  const staticList=providerModels[provider]||providerModels[normalized]||[];
  // Chỉ dùng dynamic nếu fetch được nhiều hơn static preset (tránh overwrite khi API trả về ít model do chưa có key)
  if(dynamic?.length&&dynamic.length>=staticList.length)return dynamic;
  return staticList.length?staticList:(dynamic||[]);
}
function cachedTextModels(provider,models){
  const normalized=normalizedModelProvider(provider),excluded=normalized==="gemini"?/(embedding|image|tts|live|transcrib|veo|robotics|lyria|banana|computer-use|antigravity|deep-research|audio|music)/i:normalized==="openai"?/(embedding|moderation|dall-e|gpt-image|sora|realtime|audio|transcrib|whisper|search-preview|computer-use|codex)/i:null;
  return [...new Set((Array.isArray(models)?models:[]).map(model=>String(model||"").trim()).filter(model=>model&&(!excluded||!excluded.test(model))))].slice(0,500);
}
function renderModelCatalogInOpenPanels(provider,savedModel=""){

}
async function loadProviderModels(provider,key,savedModel="",force=false,ui={}){
  const normalized=normalizedModelProvider(provider),requestId=++modelCatalogRequestId;
  let cache={};
  try{cache=(await chrome.storage.local.get("aiModelCatalogCache")).aiModelCatalogCache||{};}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  const cached=cache[normalized];
  const cachedModels=cachedTextModels(normalized,cached?.models);
  if(!force&&cachedModels.length&&Date.now()-Number(cached?.fetchedAt||0)<MODEL_CACHE_TTL_MS){
    dynamicProviderModels[normalized]=cachedModels;
    renderModelCatalogInOpenPanels(provider,savedModel);
    return {ok:true,models:cachedModels,source:"cache"};
  }
  if(!key||normalized==="custom"){
    renderModelCatalogInOpenPanels(provider,savedModel);
    return {ok:false,error:key?t("p.modelsDynamicUnsupported"):t("p.needKey")};
  }
  if(ui.button){ui.button.disabled=true;ui.button.textContent=t("p.refreshModelsBusy");}
  try{
    const response=await chrome.runtime.sendMessage({action:"aiListModels",provider:normalized,key:cleanPastedApiKey(key)});
    if(requestId!==modelCatalogRequestId)return {ok:false,error:t("p.modelsSuperseded")};
    if(!response?.ok||!Array.isArray(response.models)||!response.models.length)throw new Error(response?.error||t("p.modelsLoadFailShort"));
    dynamicProviderModels[normalized]=response.models;
    cache[normalized]={models:response.models,fetchedAt:Date.now()};
    try{await chrome.storage.local.set({aiModelCatalogCache:cache});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    renderModelCatalogInOpenPanels(provider,savedModel);
    if(ui.statusEl&&ui.manual)ui.statusEl.textContent=t("p.modelsUpdated",{n:response.models.length,provider:provider});
    return {ok:true,models:response.models,source:"network"};
  }catch(error){
    renderModelCatalogInOpenPanels(provider,savedModel);
    if(ui.statusEl&&ui.manual)ui.statusEl.textContent=t("p.modelsLoadFail",{err:error.message||String(error)});
    return {ok:false,error:error.message||String(error)};
  }finally{if(ui.button){ui.button.disabled=false;ui.button.textContent=t("p.refreshModels");}}
}
async function testAiConnection(aiConfig,statusEl,button){
  // meta-free không cần key/model — test bằng 1 câu hỏi thật qua tab meta.ai.
  if(aiConfig.provider!=="meta-free"){
    if(!aiConfig.key){statusEl.textContent=t("p.needKey");return;}
    if(!aiConfig.model){statusEl.textContent=t("p.needModel");return;}
  }
  if(aiConfig.provider==="custom"&&!aiConfig.url){statusEl.textContent=t("p.needUrl");return;}
  const old=button.innerHTML;button.disabled=true;button.textContent=t("p.testing");statusEl.textContent=t("p.sendingTest");
  try{const res=await chrome.runtime.sendMessage({action:"aiTest",aiConfig});statusEl.textContent=res?.ok?t("p.testOk",{res:res.result}):t("p.testFail",{err:res?.error||t("p.noResponse")});}
  catch(e){statusEl.textContent=t("p.testFail",{err:e.message});}
  finally{button.disabled=false;button.innerHTML=old;}
}

// Context-aware prompt persistence for AI tab (2 keys: aiPrompt / aiTagPrompt)
if(aiPrompt){const _aiTagEl=document.getElementById("aiTagEnabled");const _aiIsTagOn=()=>!!_aiTagEl?.checked;let _aiPt=0;const _aiSv=()=>{clearTimeout(_aiPt);_aiPt=setTimeout(()=>chrome.storage.sync.set({[_aiIsTagOn()?"aiTagPrompt":"aiPrompt"]:aiPrompt.value}),250);};aiPrompt.addEventListener("input",_aiSv);aiPrompt.addEventListener("change",()=>{clearTimeout(_aiPt);chrome.storage.sync.set({[_aiIsTagOn()?"aiTagPrompt":"aiPrompt"]:aiPrompt.value});});aiPrompt.addEventListener("blur",()=>{clearTimeout(_aiPt);chrome.storage.sync.set({[_aiIsTagOn()?"aiTagPrompt":"aiPrompt"]:aiPrompt.value});});}

// ĐĂNG BÀI BÁN HÀNG - state và tiến trình tách riêng với Đăng bài AI/Share bài
const salesPrompt=$("salesPrompt"),salesStyleProfile=$("salesStyleProfile"),salesPostTargetGroups=$("salesPostTargetGroups"),salesPostsPerGroup=$("salesPostsPerGroup"),salesMinDelay=$("salesMinDelay"),salesMaxDelay=$("salesMaxDelay");
const salesPreviewBtn=$("salesPreviewBtn"),salesAiTestBtn=$("salesAiTestBtn"),salesPreview=$("salesPreview"),salesStartBtn=$("salesStartBtn"),salesStopBtn=$("salesStopBtn"),salesResetBtn=$("salesResetBtn");
const salesAiChatInput=$("salesAiChatInput"),salesAiChatTranscript=$("salesAiChatTranscript"),salesAiChatActivity=$("salesAiChatActivity"),salesAiChatBtn=$("salesAiChatBtn"),salesAiChatClearBtn=$("salesAiChatClearBtn"),salesAiChatUseLastBtn=$("salesAiChatUseLastBtn");
const pageSalesAiChatInput=$("pageSalesAiChatInput"),pageSalesAiChatTranscript=$("pageSalesAiChatTranscript"),pageSalesAiChatActivity=$("pageSalesAiChatActivity"),pageSalesAiChatBtn=$("pageSalesAiChatBtn"),pageSalesAiChatClearBtn=$("pageSalesAiChatClearBtn"),pageSalesAiChatUseLastBtn=$("pageSalesAiChatUseLastBtn"),pageSalesAiTestBtn=$("pageSalesAiTestBtn");
const salesPostStatus=$("salesPostStatus"),salesPostCount=$("salesPostCount"),salesAiSummary=$("salesAiSummary"),salesGroupKeyword=$("salesGroupKeyword"),salesGroupList=$("salesGroupList"),loadSalesGroupsBtn=$("loadSalesGroupsBtn"),selectAllSalesGroupsBtn=$("selectAllSalesGroupsBtn");
const salesProductList=$("salesProductList"),salesAddProductBtn=$("salesAddProductBtn");
let salesGroups=[];
let salesIsRunning=false;
let salesAiMessages=[],salesAiAcceptedPosts=[],salesAiChatContextKey="";
let pageSalesAiMessages=[],pageSalesAiAcceptedPosts=[],pageSalesAiChatContextKey="";
// Multi-product state
let salesProducts=[]; // [{id, name, sourceText, productInfo, prompt, enabled, media:[]}]
const SALES_DEFAULT_PROMPT='Viết một bài đăng bán hàng bằng {language} cho nhóm "{groupName}", phong cách gần gũi như người thật chia sẻ — không phải quảng cáo. Bài cần: (1) mở đầu tự nhiên tạo sự kết nối với cộng đồng, (2) giới thiệu ngắn gọn sản phẩm với 1-2 điểm nổi bật thực tế, (3) kết bằng câu hỏi mở mời mọi người tương tác (hỏi giá, góp ý, chia sẻ kinh nghiệm). Chỉ dùng thông tin có trong nguồn, không bịa giá/bảo hành/cam kết. Không hashtag, không URL, không Markdown, không lời dẫn AI. Bài 3-5 câu, thân thiện, chỉ trả về nội dung bài đăng. Thông tin sản phẩm: {sourceText}. Ghi chú thêm: {productInfo}.';
function salesNextProductId(){return `sp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;}
function setSalesRunning(value){
  salesIsRunning=!!value;
  salesStartBtn.innerHTML=salesIsRunning?"⏳ Đang đăng bài bán hàng...":"▶ Tạo và đăng bài bán hàng";
  salesStartBtn.classList.toggle("running",salesIsRunning);
  // disable product inputs khi đang chạy
  salesProductList.querySelectorAll("textarea,input").forEach(el=>{el.disabled=!!value;});
  salesProductList.querySelectorAll("button").forEach(el=>{el.disabled=!!value;});
  salesAddProductBtn.disabled=!!value;
  if(!value){
    // Trả ô số media về đúng trạng thái theo chế độ (chỉ Random mới nhập được)
    salesProductList.querySelectorAll(".sales-product-item").forEach(item=>{
      const active=item.querySelector(".sp-mmode-btn.active")?.dataset?.mode
        || salesProducts.find(p=>p.id===item.dataset.spid)?.mediaMode || "random";
      const countEl=item.querySelector(".sp-mediacount");
      if(countEl)countEl.disabled=active!=="random";
    });
  }
  setPromptEditorState(salesIsRunning,salesPrompt,"salesPromptLockHint");
}
function salesEsc(value){return String(value||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));}
function salesChatFingerprint(value){let hash=2166136261;for(const ch of String(value||"")){hash^=ch.codePointAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16);}
function salesChatContextFingerprint(){const prodKey=salesProducts.map(p=>`${p.sourceText||""}|${p.productInfo||""}`).join("\u001e");return salesChatFingerprint([prodKey,salesPrompt.value].map(value=>String(value||"").trim()).join("\u001f"));}
function cleanSalesChatPost(value){
  let text=String(value||"").replace(/```[a-z]*|```/gi," ").replace(/\*\*/g,"").split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
    .filter(line=>!/^(dưới đây|sau đây|gợi ý|phương án|bài đăng|nội dung|đây là)\s*:/i.test(line)).join(" ");
  text=text.replace(/^[-*•\d.)\s]+/,"").replace(/^['"""]+|['"""]+$/g,"").replace(/https?:\/\/\S+/gi," ").replace(/(^|\s)#[\p{L}\p{N}_-]+/gu," ").replace(/\s+/g," ").trim();
  return [...text].length>900?[...text].slice(0,900).join("").replace(/\s+\S*$/g,"").trim():text;
}
function renderSalesAiChat(){
  if(!salesAiMessages.length){salesAiChatTranscript.innerHTML='<div class="hint">'+t("sales.noChat")+'</div>';salesAiChatUseLastBtn.disabled=true;return;}
  salesAiChatTranscript.innerHTML=salesAiMessages.slice(-20).map((item,index)=>{
    const assistant=item.role==="assistant";
    return `<div class="share-ai-message ${assistant?"assistant":"user"}"><b>${assistant?"AI":"Bạn"}:</b> ${salesEsc(item.content)}${assistant?`<br><button class="sales-chat-use" data-index="${index}" style="margin-top:5px;background:#e8f5e9;color:#1b5e20;border:1px solid #81c784">${t("sales.chatUse")}</button>`:""}</div>`;
  }).join("");
  salesAiChatTranscript.scrollTop=salesAiChatTranscript.scrollHeight;
  salesAiChatUseLastBtn.disabled=!salesAiMessages.some(item=>item.role==="assistant");
}
async function persistSalesAiChat(){
  await chrome.storage.local.set({salesAiChatMessages:salesAiMessages.slice(-20),salesAiChatAcceptedPosts:salesAiAcceptedPosts.slice(0,50),salesAiChatContextKey:salesAiChatContextKey,salesAiChatActivity:salesAiChatActivity.textContent||"",salesAiChatLastReply:[...salesAiMessages].reverse().find(item=>item.role==="assistant")?.content||""});
}
async function restoreSalesAiChat(){
  const saved=await chrome.storage.local.get(["salesAiChatMessages","salesAiChatAcceptedPosts","salesAiChatContextKey","salesAiChatActivity"]),current=salesChatContextFingerprint();
  if(saved.salesAiChatContextKey&&saved.salesAiChatContextKey===current){
    salesAiChatContextKey=current;
    salesAiMessages=Array.isArray(saved.salesAiChatMessages)?saved.salesAiChatMessages.filter(item=>item&&item.content).slice(-20):[];
    salesAiAcceptedPosts=Array.isArray(saved.salesAiChatAcceptedPosts)?saved.salesAiChatAcceptedPosts.map(cleanSalesChatPost).filter(Boolean).slice(0,50):[];
    renderSalesAiChat();
    if(saved.salesAiChatActivity)salesAiChatActivity.textContent=saved.salesAiChatActivity;
  }
}
async function useSalesChatMessage(index){
  const item=salesAiMessages[index];if(item?.role!=="assistant")return;
  const post=cleanSalesChatPost(item.content);if([...post].length<20){salesAiChatActivity.textContent=t("sales.chatNoReply");return;}
  const key=post.toLocaleLowerCase("vi").replace(/\s+/g," ").trim();
  if(!salesAiAcceptedPosts.some(value=>value.toLocaleLowerCase("vi").replace(/\s+/g," ").trim()===key))salesAiAcceptedPosts=[...salesAiAcceptedPosts,post].slice(0,50);
  salesAiChatContextKey=salesChatContextFingerprint();
  salesAiChatActivity.textContent=t("sales.chatUsed",{n:salesAiAcceptedPosts.length});
  await persistSalesAiChat();
}
function renderSalesGroups(groups,selected=[]){
  const chosen=new Set((selected||[]).map(String)),seen=new Set();
  salesGroups=(groups||[]).filter(g=>{const key=groupPostKey(g);if(!key||seen.has(key))return false;seen.add(key);return true;});
  if(!salesGroups.length){salesGroupList.innerHTML='<div class="hint" style="padding:6px">Chưa có danh sách nhóm</div>';return;}
  salesGroupList.innerHTML=salesGroups.map(g=>{const key=groupPostKey(g);return `<label data-name="${salesEsc(String(g.name||"").toLocaleLowerCase("vi"))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee;min-width:0"><input class="sales-group-check" type="checkbox" value="${salesEsc(key)}" ${chosen.has(key)?"checked":""} style="width:auto"><img src="${salesEsc(g.icon||"icon128.png")}" style="width:28px;height:28px;border-radius:50%;object-fit:cover"><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${salesEsc(g.name)}</span></label>`;}).join("");
}
function selectedSalesGroups(){const keys=new Set([...salesGroupList.querySelectorAll(".sales-group-check:checked")].map(b=>b.value));return salesGroups.filter(g=>keys.has(groupPostKey(g)));}
function saveSalesGroupSelection(){const keys=[...salesGroupList.querySelectorAll(".sales-group-check:checked")].map(b=>b.value);chrome.storage.local.set({salesSelectedGroupKeys:keys});}
salesGroupList.addEventListener("change",e=>{if(e.target.classList.contains("sales-group-check"))saveSalesGroupSelection();});
function salesAiConfig(feature="sales"){return getAiProfileFor(feature);}
async function refreshSalesAiSummary(){const c=await salesAiConfig("sales");const who=c.profileName?` · ${c.profileName}`:"";salesAiSummary.textContent=(!aiKeyRequired(c)||c.key)?`Đang dùng ${c.provider} • ${(c.model||"chưa chọn model")+who}${c.key?" • API Key đã lưu":" • miễn phí, không cần key"}`:`Chưa có API Key dùng chung. Hãy cấu hình ở tab AI chung.`;}
function persistSalesDraft(){
  const target=Math.max(1,Math.min(100000,parseInt(salesPostTargetGroups.value)||1));
  const postsPerGroup=Math.max(1,Math.min(100000,parseInt(salesPostsPerGroup.value)||1));
  const minDelay=Math.min(604800,Math.max(5,parseInt(salesMinDelay.value)||30));
  const maxDelay=Math.min(604800,Math.max(minDelay,parseInt(salesMaxDelay.value)||60));
  salesPostTargetGroups.value=target;salesPostsPerGroup.value=postsPerGroup;salesMinDelay.value=minDelay;salesMaxDelay.value=maxDelay;
  return chrome.storage.sync.set({salesPrompt:salesPrompt.value,salesPostTargetGroups:target,salesPostsPerGroup:postsPerGroup,salesMinDelay:minDelay,salesMaxDelay:maxDelay,salesStyleProfile:salesStyleProfile.value});
}
bindPromptPersistence("salesPrompt",salesPrompt);
[salesPostTargetGroups,salesPostsPerGroup,salesMinDelay,salesMaxDelay,salesStyleProfile].forEach(el=>el.addEventListener("change",persistSalesDraft));
salesAiChatTranscript.addEventListener("click",event=>{const button=event.target.closest?.(".sales-chat-use");if(button)useSalesChatMessage(Number(button.dataset.index));});
salesAiChatUseLastBtn.onclick=async()=>{const index=[...salesAiMessages].map((item,i)=>item.role==="assistant"?i:-1).filter(i=>i>=0).pop();if(index!==undefined&&index>=0)await useSalesChatMessage(index);};
salesAiChatClearBtn.onclick=async()=>{salesAiMessages=[];salesAiAcceptedPosts=[];salesAiChatContextKey=salesChatContextFingerprint();salesAiChatActivity.textContent=t("sales.chatCleared");renderSalesAiChat();await persistSalesAiChat();};
salesAiChatBtn.onclick=async()=>{
  const message=salesAiChatInput.value.trim();if(!message){salesAiChatActivity.textContent=t("sales.chatNeedMessage");return;}
  // Lấy sản phẩm đầu tiên có sourceText để chat
  const firstProd=salesProducts.find(p=>p.sourceText&&p.sourceText.trim().length>=10);
  const source=firstProd?.sourceText?.trim()||"";
  if(source.length<10){salesAiChatActivity.textContent=t("sales.chatNeedSource");return;}
  const aiConfig=await salesAiConfig("sales");if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model)){salesAiChatActivity.textContent=t("p.gpNeedKeyTab");return;}
  const contextKey=salesChatContextFingerprint();
  if(salesAiChatContextKey&&salesAiChatContextKey!==contextKey){salesAiMessages=[];salesAiAcceptedPosts=[];}
  salesAiChatContextKey=contextKey;salesAiMessages=[...salesAiMessages,{role:"user",content:message,at:Date.now()}].slice(-20);renderSalesAiChat();
  salesAiChatInput.value="";salesAiChatBtn.disabled=true;salesAiChatActivity.textContent=t("sales.chatWorking",{prov:aiConfig.provider==="gemini"?"Gemini":aiConfig.provider});await persistSalesAiChat();
  try{
    const response=await chrome.runtime.sendMessage({action:"aiSalesPostChat",sourceText:source,productInfo:firstProd?.productInfo?.trim()||"",prompt:salesPrompt.value,messages:salesAiMessages,aiConfig});
    if(!response?.ok)throw new Error(response?.error||t("sales.chatNoReply"));
    const reply=cleanSalesChatPost(response.reply);if(!reply)throw new Error(t("sales.chatNoReply"));
    salesAiMessages=[...salesAiMessages,{role:"assistant",content:reply,at:Date.now()}].slice(-20);renderSalesAiChat();salesAiChatActivity.textContent=t("sales.chatDone",{prov:response.provider||aiConfig.provider,model:response.model||aiConfig.model});await persistSalesAiChat();
  }catch(error){salesAiChatActivity.textContent=t("sales.chatNoReply")+": "+error.message;await persistSalesAiChat();}
  finally{salesAiChatBtn.disabled=false;}
};
salesAiChatInput.addEventListener("keydown",event=>{if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();salesAiChatBtn.click();}});

// ── Page Sales Chat AI (dùng riêng: sản phẩm + prompt + storage của Page) ──
function renderPageSalesAiChat(){
  if(!pageSalesAiChatTranscript)return;
  if(!pageSalesAiMessages.length){pageSalesAiChatTranscript.innerHTML='<div class="hint">'+t("sales.noChat")+'</div>';if(pageSalesAiChatUseLastBtn)pageSalesAiChatUseLastBtn.disabled=true;return;}
  pageSalesAiChatTranscript.innerHTML=pageSalesAiMessages.slice(-20).map((item,index)=>{
    const isUser=item.role==="user";
    return `<div style="margin-bottom:6px;padding:5px 7px;border-radius:6px;background:${isUser?"#e8f5e9":"#f3e5f5"};border:1px solid ${isUser?"#a5d6a7":"#ce93d8"}"><div style="font-size:10px;color:#888;margin-bottom:2px">${isUser?"Bạn":"AI"}</div><div style="white-space:pre-wrap;font-size:12px">${String(item.content||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]))}${!isUser?`<button class="page-sales-chat-use" data-index="${index}" style="display:block;margin-top:5px;font-size:11px;padding:2px 8px;background:#7b1fa2;color:#fff;border:none;border-radius:4px;cursor:pointer">✅ Dùng bài này</button>`:""}</div>`;
  }).join("");
  pageSalesAiChatTranscript.scrollTop=pageSalesAiChatTranscript.scrollHeight;
  if(pageSalesAiChatUseLastBtn)pageSalesAiChatUseLastBtn.disabled=!pageSalesAiMessages.some(item=>item.role==="assistant");
}
async function usePageSalesChatMessage(index){
  const item=pageSalesAiMessages[index];if(!item||item.role!=="assistant")return;
  const post=String(item.content||"").trim();if(post.length<20)return;
  pageSalesAiAcceptedPosts=[post,...pageSalesAiAcceptedPosts].slice(0,50);
  if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=`Đã chọn ${pageSalesAiAcceptedPosts.length} bài`;
  renderPageSalesAiChat();
}
if(pageSalesAiChatTranscript)pageSalesAiChatTranscript.addEventListener("click",event=>{const button=event.target.closest?.(".page-sales-chat-use");if(button)usePageSalesChatMessage(Number(button.dataset.index));});
if(pageSalesAiChatUseLastBtn)pageSalesAiChatUseLastBtn.onclick=async()=>{const index=[...pageSalesAiMessages].map((item,i)=>item.role==="assistant"?i:-1).filter(i=>i>=0).pop();if(index!==undefined&&index>=0)await usePageSalesChatMessage(index);};
if(pageSalesAiChatClearBtn)pageSalesAiChatClearBtn.onclick=()=>{pageSalesAiMessages=[];pageSalesAiAcceptedPosts=[];if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("sales.chatCleared");renderPageSalesAiChat();};
if(pageSalesAiChatBtn)pageSalesAiChatBtn.onclick=async()=>{
  const message=pageSalesAiChatInput?.value?.trim();if(!message){if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("sales.chatNeedMessage");return;}
  // Lấy sản phẩm đầu tiên từ pageSalesProducts
  const firstProd=pageSalesProducts.find(p=>p.sourceText&&p.sourceText.trim().length>=10);
  const source=firstProd?.sourceText?.trim()||"";
  if(source.length<10){if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("sales.chatNeedSource");return;}
  const aiConfig=await salesAiConfig("pageSales");if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model)){if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("p.gpNeedKeyTab");return;}
  pageSalesAiMessages=[...pageSalesAiMessages,{role:"user",content:message,at:Date.now()}].slice(-20);renderPageSalesAiChat();
  if(pageSalesAiChatInput)pageSalesAiChatInput.value="";
  pageSalesAiChatBtn.disabled=true;
  if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("sales.chatWorking",{prov:aiConfig.provider==="gemini"?"Gemini":aiConfig.provider});
  try{
    const prompt=(pageSalesPrompt?.value||"").trim()||(salesPrompt?.value||"").trim();
    const response=await chrome.runtime.sendMessage({action:"aiSalesPostChat",sourceText:source,productInfo:firstProd?.productInfo?.trim()||"",prompt,messages:pageSalesAiMessages,aiConfig});
    if(!response?.ok)throw new Error(response?.error||t("sales.chatNoReply"));
    const reply=String(response.reply||"").trim();if(!reply)throw new Error(t("sales.chatNoReply"));
    pageSalesAiMessages=[...pageSalesAiMessages,{role:"assistant",content:reply,at:Date.now()}].slice(-20);renderPageSalesAiChat();
    if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("sales.chatDone",{prov:response.provider||aiConfig.provider,model:response.model||aiConfig.model});
  }catch(error){if(pageSalesAiChatActivity)pageSalesAiChatActivity.textContent=t("sales.chatNoReply")+": "+error.message;}
  finally{pageSalesAiChatBtn.disabled=false;}
};
if(pageSalesAiChatInput)pageSalesAiChatInput.addEventListener("keydown",event=>{if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)){event.preventDefault();pageSalesAiChatBtn?.click();}});
if(pageSalesAiTestBtn)pageSalesAiTestBtn.onclick=()=>salesAiTestBtn?.click();

salesGroupKeyword.oninput=()=>{const key=salesGroupKeyword.value.trim().toLocaleLowerCase("vi");salesGroupList.querySelectorAll("label[data-name]").forEach(row=>row.style.display=!key||row.dataset.name.includes(key)?"flex":"none");};
selectAllSalesGroupsBtn.onclick=()=>{const rows=[...salesGroupList.querySelectorAll("label[data-name]")].filter(row=>row.style.display!=="none"),boxes=rows.map(row=>row.querySelector(".sales-group-check")).filter(Boolean),on=boxes.some(b=>!b.checked);boxes.forEach(b=>b.checked=on);};
loadSalesGroupsBtn.onclick=async()=>{
  const {groups}=await requestJoinedGroupsScan(salesPostStatus,"Đang tải đầy đủ danh sách nhóm đã tham gia...",n=>`Đã tải ${n} nhóm đã tham gia`);
  const saved=await chrome.storage.local.get("salesSelectedGroupKeys");
  const allKeys=groups.map(groupPostKey);
  const selectedKeys=Array.isArray(saved.salesSelectedGroupKeys)&&saved.salesSelectedGroupKeys.length?saved.salesSelectedGroupKeys:allKeys;
  renderSalesGroups(groups,selectedKeys);
};
// ── Multi-product helpers ──────────────────────────────────────────────────
function salesMediaSize(bytes){const value=Number(bytes)||0;return value>=1048576?`${Math.round(value/1048576*10)/10} MB`:`${Math.round(value/1024)} KB`;}
function salesMediaListRaw(value){const raw=Array.isArray(value)?value:(value?[value]:[]);return raw.filter(item=>item&&typeof item==="object"&&item.dataUrl&&/^(image|video)\//i.test(String(item.type||"")));}

function renderProductMediaPreview(el,media){
  if(!media||!media.length){el.textContent="Chưa chọn ảnh/video";return;}
  el.textContent=`${media.length} file: ${media.map(item=>`${item.name||"media"} (${salesMediaSize(item.size)})`).slice(0,3).join(", ")}${media.length>3?" ...":""}`;
}

function createProductItem(product){
  const id=product.id;
  const num=salesProducts.findIndex(p=>p.id===id)+1||salesProducts.length;
  const item=document.createElement("div");
  item.className="sales-product-item";
  item.dataset.spid=id;
  const isEnabled=product.enabled!==false;
  if(!isEnabled)item.classList.add("sp-disabled");
  item.innerHTML=`
    <div class="sp-badge">
      <input class="sp-check" type="checkbox" ${isEnabled?"checked":""} title="Tích để đăng sản phẩm này">
      <span class="sp-badge-num">${num}</span> SẢN PHẨM ${num}
      ${!isEnabled?'<span class="sp-disabled-label">TẮT</span>':""}
    </div>
    <div class="sp-body">
      <div class="sp-name-row">
        <input class="sp-name" type="text" placeholder="Tên sản phẩm (VD: Mac Mini M4 Pro)" value="${(product.name||"").replace(/"/g,"&quot;")}">
        <button class="sp-del">✕ Xoá</button>
      </div>
      <div class="sp-fields">
        <div class="sp-field"><label>📝 Thông tin / bài gốc</label><textarea class="sp-source" rows="5" placeholder="Mac mini M4, chip Apple M4, RAM 16GB...">${product.sourceText||""}</textarea></div>
        <div class="sp-field"><label>📌 Ghi chú bán hàng</label><textarea class="sp-info" rows="5" placeholder="Tình trạng, khu vực, giá kỳ vọng...">${product.productInfo||""}</textarea></div>
        <div class="sp-field sp-field-full"><label>🤖 Prompt riêng cho sản phẩm này</label><textarea class="sp-prompt" rows="4" placeholder="Viết bài bán {sourceText} cho {groupName}. {productInfo}">${(product.prompt||"").replace(/</g,"&lt;")}</textarea></div>
      </div>
      <div class="sp-media-zone">
        <label>📷 Ảnh / Video sản phẩm (tùy chọn, nhiều file)</label>
        <div class="sp-media-mode">
          <button type="button" class="sp-mmode-btn ${(product.mediaMode||"random")==="random"?"active":""}" data-mode="random">🎲 Random</button>
          <button type="button" class="sp-mmode-btn ${(product.mediaMode||"random")==="all"?"active":""}" data-mode="all">📂 Tất cả file</button>
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-top:6px"><span>${typeof t==="function"?t("sales.mediaRandomCount"):"Số media mỗi nhóm khi Random"}</span><input class="sp-mediacount" type="number" min="1" max="20" step="1" value="${Number(product.mediaCount)||1}" style="width:70px" ${(product.mediaMode||"random")!=="random"?"disabled":""}></label>
        <input class="sp-media-input" type="file" accept="image/*,video/*" multiple>
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer"><input class="sp-skipmedia" type="checkbox" ${product.skipMedia?"checked":""}> 🚫 Đăng bài không kèm ảnh (vẫn giữ file đã chọn)</label>
        <div class="sp-media-preview">Chưa chọn — bài vẫn đăng được</div>
      </div>
    </div>`;

  item.querySelector(".sp-del").onclick=()=>{item.remove();salesProducts=salesProducts.filter(p=>p.id!==id);saveSalesProducts();};
  item.querySelector(".sp-check").addEventListener("change",function(){
    const enabled=this.checked;
    item.classList.toggle("sp-disabled",!enabled);
    let badge=item.querySelector(".sp-badge");
    let lbl=badge.querySelector(".sp-disabled-label");
    if(!enabled&&!lbl){lbl=document.createElement("span");lbl.className="sp-disabled-label";lbl.textContent="TẮT";badge.appendChild(lbl);}
    else if(enabled&&lbl){lbl.remove();}
    const prod=salesProducts.find(p=>p.id===id);if(prod)prod.enabled=enabled;
    saveSalesProducts();
  });
  item.querySelector(".sp-name").addEventListener("input",()=>saveSalesProducts());
  const skipCb=item.querySelector(".sp-skipmedia");
  if(skipCb)skipCb.addEventListener("change",function(){
    const prod=salesProducts.find(p=>p.id===id);if(prod)prod.skipMedia=this.checked;
    saveSalesProducts();
  });
  item.querySelector(".sp-source").addEventListener("input",()=>saveSalesProducts());
  item.querySelector(".sp-info").addEventListener("input",()=>saveSalesProducts());
  item.querySelector(".sp-prompt").addEventListener("input",()=>saveSalesProducts());
  item.querySelectorAll(".sp-mmode-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      item.querySelectorAll(".sp-mmode-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const prod=salesProducts.find(p=>p.id===id);if(prod)prod.mediaMode=btn.dataset.mode;
      const countInput=item.querySelector(".sp-mediacount");
      if(countInput)countInput.disabled=btn.dataset.mode!=="random";
      saveSalesProducts();
    });
  });
  const countInput=item.querySelector(".sp-mediacount");
  if(countInput)countInput.addEventListener("change",()=>{
    const prod=salesProducts.find(p=>p.id===id);
    const total=prod?.media?.length||20;
    const next=normalizeSalesMediaCount(countInput.value,total);
    countInput.value=next;
    if(prod)prod.mediaCount=next;
    saveSalesProducts();
  });

  const fileInput=item.querySelector(".sp-media-input");
  const previewEl=item.querySelector(".sp-media-preview");
  if(product.media&&product.media.length)renderProductMediaPreview(previewEl,product.media);
  fileInput.onchange=async()=>{
    const files=[...(fileInput.files||[])];
    if(!files.length){const prod=salesProducts.find(p=>p.id===id);if(prod)prod.media=[];renderProductMediaPreview(previewEl,[]);saveSalesProducts();return;}
    const maxBytes=35*1024*1024;
    const invalid=files.find(f=>!/^(image|video)\//i.test(String(f.type||""))||f.size>maxBytes);
    if(invalid){fileInput.value="";previewEl.textContent=invalid.size>maxBytes?`"${invalid.name}" vượt 35 MB`:`"${invalid.name}" không phải ảnh/video`;return;}
    previewEl.textContent=`Đang đọc ${files.length} file...`;
    try{
      const media=[];
      for(const file of files){
        const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
        media.push({name:file.name,type:file.type,size:file.size,dataUrl});
      }
      const prod=salesProducts.find(p=>p.id===id);if(prod)prod.media=media;
      renderProductMediaPreview(previewEl,media);saveSalesProducts();
    }catch(err){fileInput.value="";previewEl.textContent=`Lỗi đọc file: ${err.message}`;}
  };
  return item;
}

function normalizeSalesMediaCount(value,total){
  const cap=Math.max(1,Math.min(20,Number(total)||20));
  const n=parseInt(value,10);
  if(!Number.isFinite(n))return 1;
  return Math.max(1,Math.min(cap,n));
}
function addSalesProduct(product={}){
  const id=product.id||`sp-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const prod={id,name:product.name||"",sourceText:product.sourceText||"",productInfo:product.productInfo||"",prompt:product.prompt||SALES_DEFAULT_PROMPT,enabled:product.enabled!==false,mediaMode:product.mediaMode||"random",mediaCount:normalizeSalesMediaCount(product.mediaCount??product.mediaPerGroup??1,Array.isArray(product.media)?product.media.length:20),skipMedia:!!product.skipMedia,media:salesMediaListRaw(product.media)};
  salesProducts.push(prod);
  salesProductList.appendChild(createProductItem(prod));
  return prod;
}

function saveSalesProducts(){
  salesProductList.querySelectorAll(".sales-product-item").forEach(item=>{
    const id=item.dataset.spid,prod=salesProducts.find(p=>p.id===id);
    if(prod){const cb=item.querySelector(".sp-check");if(cb)prod.enabled=cb.checked;}
    if(!prod)return;
    prod.name=item.querySelector(".sp-name")?.value||"";
    prod.sourceText=item.querySelector(".sp-source")?.value||"";
    prod.productInfo=item.querySelector(".sp-info")?.value||"";
    prod.prompt=item.querySelector(".sp-prompt")?.value||"";
    const countEl=item.querySelector(".sp-mediacount");
    if(countEl)prod.mediaCount=normalizeSalesMediaCount(countEl.value,prod?.media?.length||20);
  });
  // Không persist sản phẩm trống hoàn toàn (ô mẫu auto-thêm lúc mở tab):
  // trước đây ô trống cũng bị lưu, reload hiện toàn hàng trống trông như "mất hết".
  const keep=salesProducts.filter(p=>!isBlankSalesProduct(p));
  const meta=keep.map(p=>({id:p.id,name:p.name,sourceText:p.sourceText,productInfo:p.productInfo,prompt:p.prompt||"",enabled:p.enabled!==false,mediaMode:p.mediaMode||"random",mediaCount:normalizeSalesMediaCount(p.mediaCount??1,p?.media?.length||20),skipMedia:!!p.skipMedia}));
  // Meta PHẢI nằm ở storage.local (unlimited): bản cũ để ở storage.sync (tối đa
  // 8KB/mục, 100KB tổng) nên 3 sản phẩm nội dung dài là set() rớt thầm
  // (.catch(()=>{}) nuốt lỗi) → reload là mất sạch sản phẩm. Bắt live đúng ca này.
  chrome.storage.local.set({salesProductsMeta:meta}).then(()=>{
    try{if(salesPostStatus)delete salesPostStatus.dataset.saveFail;}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }).catch((err)=>{
    try{
      if(salesPostStatus&&!salesPostStatus.dataset.saveFail){
        salesPostStatus.dataset.saveFail="1";
        salesPostStatus.textContent="⚠️ Không lưu được sản phẩm ("+String(err?.message||err).slice(0,80)+"). Hãy rút ngắn nội dung rồi thêm lại.";
      }
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  });
  const mediaParts=keep.map(p=>({id:p.id,media:p.media||[]}));
  chrome.storage.local.set({salesProductsMedia:mediaParts}).catch(()=>{});
  renderSalesScheduleProducts();
}
// Sản phẩm trống hoàn toàn (chỉ là ô mẫu) thì không persist — xem saveSalesProducts.
function isBlankSalesProduct(p){
  if(!p||typeof p!=="object")return true;
  if(String(p.name||"").trim()||String(p.sourceText||"").trim()||String(p.productInfo||"").trim())return false;
  return !(Array.isArray(p.media)&&p.media.length);
}

// Checkbox chọn sản phẩm cho từng lịch hẹn: mỗi sản phẩm hẹn giờ riêng.
// Lưu lựa chọn vào sync để giữ qua các lần mở popup.
const salesScheduleProducts=$("salesScheduleProducts");
function salesSchedulePickedIds(){
  if(!salesScheduleProducts)return [];
  return [...salesScheduleProducts.querySelectorAll('input[type="checkbox"][data-spid]:checked')].map(cb=>cb.dataset.spid);
}
async function renderSalesScheduleProducts(){
  if(!salesScheduleProducts)return;
  let saved=[];
  try{const r=await chrome.storage.sync.get("salesScheduleProductIds");if(Array.isArray(r.salesScheduleProductIds))saved=r.salesScheduleProductIds;}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  const list=salesProducts.filter(p=>p.enabled!==false&&(p.sourceText||"").trim());
  salesScheduleProducts.replaceChildren();
  if(!list.length){salesScheduleProducts.innerHTML=`<div class="hint">${t("sales.noProductsForSchedule")}</div>`;return;}
  // Lần đầu (chưa lưu lựa chọn): tick tất cả
  const picked=new Set(saved.length?saved:list.map(p=>p.id));
  for(const p of list){
    const label=document.createElement("label");
    label.style.cssText="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer";
    const cb=document.createElement("input");
    cb.type="checkbox";cb.dataset.spid=p.id;cb.checked=picked.has(p.id);
    cb.onchange=()=>{chrome.storage.sync.set({salesScheduleProductIds:salesSchedulePickedIds()}).catch(()=>{});};
    const name=document.createElement("span");
    name.textContent=`${p.name||p.sourceText.slice(0,30)} (${(p.media||[]).length} ảnh)`;
    label.append(cb,name);
    salesScheduleProducts.appendChild(label);
  }
}

// Đọc meta sản phẩm: ưu tiên local (bản mới); rớt về sync bản cũ rồi migrate
// sang local 1 lần (xóa key sync cũ để lần sau không đọc nhầm).
function resolveSalesProductsMeta(localVal, syncVal) {
  if (Array.isArray(localVal) && localVal.length) return { list: localVal, fromLegacy: false };
  if (Array.isArray(syncVal) && syncVal.length) return { list: syncVal, fromLegacy: true };
  return { list: [], fromLegacy: false };
}
async function loadSalesProducts(){
  const local=await chrome.storage.local.get(["salesProductsMeta","salesProductsMedia"]).catch(()=>({}));
  const sync=await chrome.storage.sync.get("salesProductsMeta").catch(()=>({}));
  const { list: metaList, fromLegacy } = resolveSalesProductsMeta(local.salesProductsMeta, sync.salesProductsMeta);
  if (fromLegacy) {
    try {
      await chrome.storage.local.set({ salesProductsMeta: metaList });
      await chrome.storage.sync.remove("salesProductsMeta");
    } catch (_) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  const mediaMap={};
  if(Array.isArray(local.salesProductsMedia))local.salesProductsMedia.forEach(entry=>{if(entry?.id)mediaMap[entry.id]=salesMediaListRaw(entry.media);});
  if(metaList.length)metaList.forEach(meta=>{if(meta?.id)addSalesProduct({...meta,media:mediaMap[meta.id]||[]});});
  if(!salesProducts.length)addSalesProduct();
  renderSalesScheduleProducts();
}

salesAddProductBtn.onclick=()=>{
  addSalesProduct();saveSalesProducts();
  salesProductList.lastElementChild?.scrollIntoView({behavior:"smooth",block:"nearest"});
};

async function buildSalesConfig(){
  const picked=selectedSalesGroups(),target=Math.max(1,Math.min(100000,parseInt(salesPostTargetGroups.value)||1)),groups=picked.slice(0,target),prompt=salesPrompt.value.trim(),aiConfig=await salesAiConfig("sales");
  // Đồng bộ text từ DOM trước khi validate
  saveSalesProducts();
  const validProducts=salesProducts.filter(p=>p.enabled!==false&&p.sourceText&&p.sourceText.trim().length>=5);
  if(!validProducts.length)throw new Error("Hãy nhập thông tin cho ít nhất một sản phẩm");
  if(!groups.length)throw new Error("Hãy tích chọn ít nhất một nhóm");
  // Prompt chung bắt buộc nếu có sản phẩm không đặt prompt riêng
  const needsGlobalPrompt=validProducts.some(p=>!String(p.prompt||"").trim());
  if(needsGlobalPrompt&&(!prompt.includes("{groupName}")||!prompt.includes("{sourceText}")||!prompt.includes("{productInfo}")))throw new Error("Prompt chung phải có {groupName}, {sourceText} và {productInfo} (hoặc đặt prompt riêng cho mỗi sản phẩm)");
  // Validate prompt riêng của từng sản phẩm (nếu có)
  for(const p of validProducts){const pp=String(p.prompt||"").trim();if(pp&&(!pp.includes("{groupName}")||!pp.includes("{sourceText}")||!pp.includes("{productInfo}")))throw new Error(`Prompt riêng của sản phẩm "${p.name||p.sourceText.slice(0,20)}" phải có {groupName}, {sourceText} và {productInfo}`);}
  if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error("Chưa có API Key/Model AI dùng chung");
  const contextKey=salesChatContextFingerprint(),acceptedChatPosts=salesAiChatContextKey===contextKey?salesAiAcceptedPosts.slice(0,groups.length):[];
  const postsPerGroup=Math.max(1,Math.min(100000,parseInt(salesPostsPerGroup.value)||1));
  const minDelay=Math.min(604800,Math.max(5,parseInt(salesMinDelay.value)||30));
  const maxDelay=Math.min(604800,Math.max(minDelay,parseInt(salesMaxDelay.value)||60));
  // Build products array with media manifest (no dataUrl in config — background reads media separately)
  const products=validProducts.map(p=>{
    const total=p.media?.length||0,mode=p.mediaMode||"random";
    const perGroup=mode==="random"?normalizeSalesMediaCount(p.mediaCount??1,total||20):total;
    return {id:p.id,name:p.name||p.sourceText.slice(0,30),sourceText:p.sourceText.trim(),productInfo:(p.productInfo||"").trim(),prompt:String(p.prompt||"").trim(),media:{enabled:total>0,count:total,mode,perGroup,skip:!!p.skipMedia,manifest:(p.media||[]).map(item=>({name:String(item.name||"media"),type:String(item.type||""),size:Number(item.size)||0}))}};
  });
  return {groups,products,prompt,postsPerGroup,minDelay,maxDelay,aiConfig,typingConfig:getAiTypingConfig("sales"),styleProfileId:salesStyleProfile.value||"",acceptedChatPosts};
}
salesPreviewBtn.onclick=async()=>{
  salesPreviewBtn.disabled=true;salesPostStatus.textContent="AI đang tạo bài thử — chưa đăng lên Facebook";
  try{
    const cfg=await buildSalesConfig();
    const prod=cfg.products[0];
    const accepted=cfg.acceptedChatPosts?.[0];
    const response=accepted?{ok:true,content:accepted,fromChat:true}:await chrome.runtime.sendMessage({action:"aiGenerateSalesPost",groupName:cfg.groups[0].name,sourceText:prod.sourceText,productInfo:prod.productInfo,prompt:cfg.prompt,aiConfig:cfg.aiConfig,styleProfileId:cfg.styleProfileId,variant:1});
    if(!response?.ok)throw new Error(response?.error||"AI không tạo được bài");
    salesPreview.textContent=response.content;salesPreview.classList.remove("hidden");
    salesPostStatus.textContent=accepted?`Đang xem bài đã chọn từ chat (${[...response.content].length} ký tự)`:`Bản thử sản phẩm "${prod.name||prod.sourceText.slice(0,20)}" — ${response.content.length} ký tự — nhóm: ${cfg.groups[0].name}`;
  }catch(error){salesPostStatus.textContent=`Lỗi tạo bài thử: ${error.message}`;}
  finally{salesPreviewBtn.disabled=false;}
};
salesAiTestBtn.onclick=async()=>{const c=await salesAiConfig("sales");await testAiConnection(c,salesPostStatus,salesAiTestBtn);await refreshSalesAiSummary();};
salesStartBtn.onclick=async()=>{
  if(salesIsRunning)return;
  setSalesRunning(true);
  try{
    const other=await chrome.storage.local.get(["groupPostActive","groupShareActive","isAICommenting","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isGroupJoining","isDiscoverJoining","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.entries(other).some(([key,value])=>key!=="salesPostActive"&&!!value))throw new Error("Một tính năng Facebook khác đang chạy; hãy dừng trước khi đăng bán hàng");
    if(other.salesPostActive)throw new Error("Một phiên đăng bán hàng đang chạy");
    const cfg=await buildSalesConfig(),tab=await getActiveTab();if(!tab)throw new Error("Không tìm thấy tab Facebook");
    // Không ghi API key vào chrome.storage.local; background resolve key từ
    // profileId trong kho hồ sơ (không lưu secret vào storage chạy).
    const runtimeCfg={...cfg,aiConfig:{provider:cfg.aiConfig.provider,model:cfg.aiConfig.model,url:cfg.aiConfig.url,profileId:cfg.aiConfig.profileId||""}};
    const runId=`sales-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const totalPosts=cfg.groups.length*(cfg.products?.length||1)*Math.max(1,cfg.postsPerGroup||1);
    await persistSalesDraft();await chrome.storage.local.set({salesPostConfig:runtimeCfg,salesPostRunId:runId,salesPostOwnerTabId:tab.id,salesPostActive:true,salesPostIndex:0,salesPostDone:0,salesPostSkipped:0,salesPostTotal:totalPosts,salesPostNextAt:0,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:`Đang chuẩn bị đăng ${cfg.products?.length||1} sản phẩm × ${cfg.groups.length} nhóm...`});
    salesPostStatus.textContent=`Đang chuẩn bị đăng lên ${cfg.groups.length} nhóm...`;
    if(!tab.url?.includes("facebook.com/groups/")){await chrome.tabs.update(tab.id,{url:cfg.groups[0].url});await new Promise(r=>setTimeout(r,4500));}
    chrome.tabs.sendMessage(tab.id,{action:"startSalesPost",runId,config:runtimeCfg},async res=>{if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startSalesPost",runId,config:runtimeCfg},salesPostStatus);if(!retry.ok)salesPostStatus.textContent="Không kết nối được với trang Facebook";}else if(!res?.ok){salesPostStatus.textContent=res?.error||"Không khởi động được đăng bán hàng";}});
  }catch(error){setSalesRunning(false);salesPostStatus.textContent=error.message;}
};
salesStopBtn.onclick=async()=>{setSalesRunning(false);await chrome.storage.local.set({salesPostActive:false,salesPostNextAt:0,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostStatus:"Đã dừng đăng bài bán hàng"});broadcastToFacebookTabs({action:"stopSalesPost"});const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"stopSalesPost"});};
salesResetBtn.onclick=async()=>{setSalesRunning(false);const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"resetSalesPost"});await chrome.storage.local.set({salesPostActive:false,salesPostRunId:"",salesPostOwnerTabId:0,salesPostConfig:null,salesPostIndex:0,salesPostDone:0,salesPostSkipped:0,salesPostTotal:0,salesPostNextAt:0,salesPostPendingContent:"",salesPostPendingIndex:-1,salesPostStage:"",salesPostProofSeenAt:0,salesPostProofMethod:"",salesPostSubmitIndex:-1,salesPostSubmitDispatchedAt:0,salesPostStatus:"Đã reset tiến trình đăng bán hàng"});broadcastToFacebookTabs({action:"resetSalesPost"});};
chrome.storage.sync.get(["salesPrompt","salesPostTargetGroups","salesPostsPerGroup","salesMinDelay","salesMaxDelay","salesStyleProfile","pageSalesPostTargetGroups","pageSalesPostsPerGroup","pageSalesMinDelay","pageSalesMaxDelay","pageSalesStyleProfile"],async r=>{if(r.salesPrompt!==undefined)setPromptIf(salesPrompt,r.salesPrompt);if(r.salesPostTargetGroups!==undefined)salesPostTargetGroups.value=r.salesPostTargetGroups;if(r.salesPostsPerGroup!==undefined)salesPostsPerGroup.value=r.salesPostsPerGroup;if(r.salesMinDelay!==undefined)salesMinDelay.value=r.salesMinDelay;if(r.salesMaxDelay!==undefined)salesMaxDelay.value=r.salesMaxDelay;if(r.salesStyleProfile!==undefined)salesStyleProfile.value=r.salesStyleProfile;try{const ds=await selectedPageDatasetPromise();if(!(ds&&ds.ds)){if(r.pageSalesPostTargetGroups!==undefined&&pageSalesPostTargetGroups)pageSalesPostTargetGroups.value=r.pageSalesPostTargetGroups;if(r.pageSalesPostsPerGroup!==undefined&&pageSalesPostsPerGroup)pageSalesPostsPerGroup.value=r.pageSalesPostsPerGroup;if(r.pageSalesMinDelay!==undefined&&pageSalesMinDelay)pageSalesMinDelay.value=r.pageSalesMinDelay;if(r.pageSalesMaxDelay!==undefined&&pageSalesMaxDelay)pageSalesMaxDelay.value=r.pageSalesMaxDelay;if(r.pageSalesStyleProfile!==undefined&&pageSalesStyleProfile)pageSalesStyleProfile.value=r.pageSalesStyleProfile;}}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }restoreSalesAiChat();});
loadSalesProducts().then(()=>{try{renderPageSalesGroups();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}).catch(()=>{});
chrome.storage.local.get(["joinedGroups","salesPostStatus","salesPostDone","salesPostSkipped","salesPostTotal","salesPostLifetimeDone","salesPostActive"],r=>{if(r.joinedGroups)renderSalesGroups(r.joinedGroups);if(r.salesPostStatus)salesPostStatus.textContent=r.salesPostStatus;salesPostCount.textContent=`${r.salesPostDone||0} / ${r.salesPostTotal||0} (bỏ qua ${r.salesPostSkipped||0}) • ${t("sales2.lifetimeTotal",{n:r.salesPostLifetimeDone||0})}`;setSalesRunning(!!r.salesPostActive);});
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=="local")return;if(changes.salesPostStatus)salesPostStatus.textContent=changes.salesPostStatus.newValue||"";if(changes.salesPostActive)setSalesRunning(!!changes.salesPostActive.newValue);if(changes.salesPostDone||changes.salesPostSkipped||changes.salesPostTotal||changes.salesPostLifetimeDone)chrome.storage.local.get(["salesPostDone","salesPostSkipped","salesPostTotal","salesPostLifetimeDone"],r=>salesPostCount.textContent=`${r.salesPostDone||0} / ${r.salesPostTotal||0} (bỏ qua ${r.salesPostSkipped||0}) • ${t("sales2.lifetimeTotal",{n:r.salesPostLifetimeDone||0})}`);if(changes.salesPostIndex){const oldIdx=Number(changes.salesPostIndex.oldValue)||0,newIdx=Number(changes.salesPostIndex.newValue)||0;if(newIdx>oldIdx){chrome.storage.local.get("salesPostConfig",r=>{const cfg=r.salesPostConfig;if(!cfg?.groups?.length)return;for(let i=oldIdx;i<newIdx&&i<cfg.groups.length;i++){const key=groupPostKey(cfg.groups[i]);const cb=salesGroupList.querySelector(`.sales-group-check[value="${CSS.escape(key)}"]`);if(cb&&cb.checked){cb.checked=false;}}saveSalesGroupSelection();});}}});
refreshSalesAiSummary();


// HỌC BÀI NHÓM NGUỒN -> VIẾT LẠI -> ĐĂNG NHÓM ĐÍCH (state trend* riêng)
const trendSourceList=$("trendSourceList"),trendTargetList=$("trendTargetList");
const trendSourceKeyword=$("trendSourceKeyword"),trendTargetKeyword=$("trendTargetKeyword");
const trendSourceLinks=$("trendSourceLinks"),trendTargetLinks=$("trendTargetLinks");
const loadTrendGroupsBtn=$("loadTrendGroupsBtn"),selectAllTrendSourceBtn=$("selectAllTrendSourceBtn"),selectAllTrendTargetBtn=$("selectAllTrendTargetBtn");
const trendPerGroup=$("trendPerGroup"),trendPerGroupWrap=$("trendPerGroupWrap"),trendLearnUnlimited=$("trendLearnUnlimited"),trendPrompt=$("trendPrompt"),trendGroupPrompt=$("trendGroupPrompt"),trendStyleProfile=$("trendStyleProfile");
const trendTargetGroups=$("trendTargetGroups"),trendPostsPerGroup=$("trendPostsPerGroup"),trendPostsPerGroupWrap=$("trendPostsPerGroupWrap"),trendPostDelay=$("trendPostDelay"),trendPostSourceMode=$("trendPostSourceMode"),trendDistributionModes=$("trendDistributionModes"),trendDistributionHint=$("trendDistributionHint"),trendPostPlan=$("trendPostPlan");
const trendAnonymousEnabled=$("trendAnonymousEnabled");
const trendBackgroundEnabled=$("trendBackgroundEnabled"),trendBackgroundOptions=$("trendBackgroundOptions"),trendBackgroundMode=$("trendBackgroundMode"),trendFixedColorWrap=$("trendFixedColorWrap"),trendFixedColor=$("trendFixedColor"),trendBackgroundMaxChars=$("trendBackgroundMaxChars");
const trendLearnBtn=$("trendLearnBtn"),trendLearnStopBtn=$("trendLearnStopBtn"),trendLearnResetBtn=$("trendLearnResetBtn");
const trendLearnSourceMode=$("trendLearnSourceMode"),trendSourceWrap=$("trendSourceWrap");
const trendRewriteBtn=$("trendRewriteBtn"),trendAiTestBtn=$("trendAiTestBtn");
const trendPostBtn=$("trendPostBtn"),trendPostStopBtn=$("trendPostStopBtn"),trendPostResetBtn=$("trendPostResetBtn");
const trendLearnStatus=$("trendLearnStatus"),trendLearnCount=$("trendLearnCount"),trendPostStatus=$("trendPostStatus"),trendPostCount=$("trendPostCount");
const trendOutline=$("trendOutline"),trendPreview=$("trendPreview"),trendAiSummary=$("trendAiSummary");
const trendLearnedList=$("trendLearnedList"),trendSelectedPostCount=$("trendSelectedPostCount"),trendSelectAllPostsBtn=$("trendSelectAllPostsBtn"),trendClearPostsBtn=$("trendClearPostsBtn"),trendDeleteSelectedPostsBtn=$("trendDeleteSelectedPostsBtn"),trendDownloadPostsBtn=$("trendDownloadPostsBtn"),trendCopyPostsBtn=$("trendCopyPostsBtn");
let trendGroups=[],trendLearnRunning=false,trendPostRunning=false,trendPostSelectedIds=new Set(),trendTargetGroupKeys=new Set();
function trendEsc(v){return String(v||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));}
function normalizeTrendGroupSearch(v){
  return String(v||"").normalize("NFD").replace(/\p{M}/gu,"").toLocaleLowerCase("vi").trim();
}
function trendGroupMatchesKeyword(name,keyword){
  const query=normalizeTrendGroupSearch(keyword),candidate=normalizeTrendGroupSearch(name);
  if(!query)return true;
  // A two-letter abbreviation such as "AI" must be its own word. Otherwise
  // it also matches unrelated Vietnamese names such as "Chai" or "Main".
  if(query.length<=2){
    const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,"u").test(candidate);
  }
  return candidate.includes(query);
}
function trendLearnMode(){
  const mode=String(trendLearnSourceMode?.value||"").trim();
  if(["links","source-selected","target-selected"].includes(mode))return mode;
  // Tương thích cấu hình cũ trước khi có bộ chọn rõ ràng.
  if(String(trendSourceLinks?.value||"").trim())return "links";
  return "target-selected";
}
function trendPostDistributionMode(){
  const value=document.querySelector('.trend-distribution-mode:checked')?.value;
  return ["auto","many-to-one","one-to-many","many-to-many"].includes(value)?value:"auto";
}
function trendLearnIdleLabel(){
  const mode=trendLearnMode();
  if(mode==="links")return t("trend2.learnLinksBtn");
  if(mode==="source-selected")return t("trend2.learnSourceListBtn");
  return t("trend2.learnTargetListBtn");
}
function setTrendLearnRunning(v){trendLearnRunning=!!v;trendLearnBtn.innerHTML=trendLearnRunning?"⏳ Đang học bài...":trendLearnIdleLabel();trendLearnBtn.classList.toggle("running",trendLearnRunning);}
function setTrendPostRunning(v){trendPostRunning=!!v;trendPostBtn.innerHTML=trendPostRunning?"⏳ Đang đăng bài viết lại...":"▶ Đăng bài viết lại";trendPostBtn.classList.toggle("running",trendPostRunning);setPromptEditorState(trendPostRunning,[trendPrompt,trendGroupPrompt],"trendPostPromptLockHint");}
function renderTrendGroups(groups){
  const seen=new Set();
  trendGroups=(groups||[]).filter(g=>{const k=groupPostKey(g);if(!k||seen.has(k))return false;seen.add(k);return true;});
  const groupRows=(restoreTargets=false)=>trendGroups.length?trendGroups.map(g=>{const k=groupPostKey(g),checked=restoreTargets&&trendTargetGroupKeys.has(k)?" checked":"";return `<label data-name="${trendEsc(String(g.name||""))}" style="display:flex;align-items:center;gap:7px;padding:5px;margin:0;border-bottom:1px solid #eee;min-width:0"><input class="trend-check" type="checkbox" value="${trendEsc(k)}"${checked} style="width:auto"><img src="${trendEsc(g.icon||"icon128.png")}" style="width:28px;height:28px;border-radius:50%;object-fit:cover"><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${trendEsc(g.name)}</span></label>`;}).join(""):'<div class="hint" style="padding:6px">Chưa có danh sách nhóm</div>';
  if(trendSourceList)trendSourceList.innerHTML=groupRows(false);
  if(trendTargetList)trendTargetList.innerHTML=groupRows(true);
  updateTrendPostPlan();
}
function rememberTrendTargetGroups(){
  if(!trendTargetList)return Promise.resolve();
  trendTargetGroupKeys=new Set([...trendTargetList.querySelectorAll(".trend-check:checked")].map(input=>String(input.value||"")).filter(Boolean));
  return chrome.storage.sync.set({trendTargetGroupKeys:[...trendTargetGroupKeys]});
}
function selectedTrendGroups(listEl){
  if(!listEl)return [];
  const keys=new Set([...listEl.querySelectorAll(".trend-check:checked")].map(b=>b.value));
  return trendGroups.filter(g=>keys.has(groupPostKey(g)));
}
const TREND_GROUP_LINK_RESERVED=new Set(["feed","discover","joins","create","notifications","your_groups"]);
function trendFallbackGroupName(id){
  const raw=String(id||"").trim();
  if(/^\d+$/.test(raw))return `Nhóm ${raw}`;
  return raw.replace(/[-_]+/g," ").replace(/\s+/g," ").trim()||"Nhóm Facebook";
}
function parseTrendGroupLinks(raw,label="Link nhóm"){
  const text=String(raw||"").trim();
  if(!text)return [];
  const groups=[],bad=[];
  text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).forEach((line,index)=>{
    const divider=line.indexOf("|");
    const linkText=(divider>=0?line.slice(0,divider):line).trim();
    const explicitName=(divider>=0?line.slice(divider+1):"").trim().replace(/\s+/g," ");
    let href=linkText;
    if(!/^https?:\/\//i.test(href))href=`https://${href}`;
    try{
      const u=new URL(href);
      if(!/(^|\.)facebook\.com$/i.test(u.hostname))throw new Error("hostname");
      const match=u.pathname.match(/^\/groups\/([^/?#]+)(?:\/)?$/i);
      if(!match)throw new Error("path");
      const id=decodeURIComponent(match[1]).trim();
      if(!id||TREND_GROUP_LINK_RESERVED.has(id.toLocaleLowerCase("vi")))throw new Error("reserved");
      groups.push({id,name:explicitName||trendFallbackGroupName(id),url:`https://www.facebook.com/groups/${encodeURIComponent(id)}/`,icon:"",manualLink:true,explicitName:!!explicitName});
    }catch{bad.push(index+1);}
  });
  if(bad.length)throw new Error(`${label} không hợp lệ ở dòng ${bad.join(", ")}. Dùng URL dạng https://www.facebook.com/groups/... hoặc URL | Tên nhóm`);
  return groups;
}
function mergeTrendGroups(base=[],manual=[]){
  const out=[],byKey=new Map();
  const add=group=>{
    const key=groupPostKey(group);if(!key)return;
    const existing=byKey.get(key);
    if(!existing){byKey.set(key,group);out.push(group);return;}
    if(group.explicitName){Object.assign(existing,{name:group.name,explicitName:true});}
    if(!existing.url&&group.url)existing.url=group.url;
  };
  (Array.isArray(base)?base:[]).forEach(add);
  (Array.isArray(manual)?manual:[]).forEach(add);
  return out;
}
function trendSourceGroupsForRun(){
  const mode=trendLearnMode();
  if(mode==="links")return parseTrendGroupLinks(trendSourceLinks?.value,"Link nhóm nguồn");
  if(mode==="target-selected")return trendTargetGroupsForRun();
  return selectedTrendGroups(trendSourceList);
}
function trendTargetGroupsForRun(){
  const raw=String(trendTargetLinks?.value||"").trim();
  const manual=parseTrendGroupLinks(raw,"Link nhóm đích");
  // Link targets are an alternative to the checkbox list, not an addition to
  // it. When present, navigate/post only to the exact URLs supplied here.
  return raw?manual:selectedTrendGroups(trendTargetList);
}
function trendRewritePrompt(){
  const base=String(trendPrompt?.value||"").trim();
  const byGroup=String(trendGroupPrompt?.value||"").trim();
  if(!base.includes("{groupName}"))throw new Error("Prompt viết lại phải có {groupName}");
  if(byGroup&&!byGroup.includes("{groupName}"))throw new Error("Prompt theo group name phải có {groupName}");
  return [base,byGroup].filter(Boolean).join("\n\n");
}
function readTrendBackgroundConfig(){
  const allowed=Object.keys(GROUP_POST_PREVIEW_COLORS||{});
  const mode=trendBackgroundMode?.value==="fixed"?"fixed":"random";
  const fixedColor=allowed.includes(trendFixedColor?.value)?trendFixedColor.value:"pink";
  const colors=[...document.querySelectorAll(".trend-post-bg-color:checked")].map(el=>el.value).filter(v=>allowed.includes(v));
  return {
    enabled:!!trendBackgroundEnabled?.checked,
    mode,
    fixedColor,
    colors:colors.length?[...new Set(colors)]:allowed,
    maxChars:Math.min(130,Math.max(40,parseInt(trendBackgroundMaxChars?.value)||100)),
    fallback:"skip"
  };
}
function toggleTrendBackgroundOptions(){
  if(trendBackgroundOptions)trendBackgroundOptions.style.display=trendBackgroundEnabled?.checked?"":"none";
  if(trendFixedColorWrap)trendFixedColorWrap.style.display=trendBackgroundMode?.value==="fixed"?"":"none";
}
async function saveTrendBackgroundDraft(){
  const bg=readTrendBackgroundConfig();
  if(trendBackgroundMaxChars)trendBackgroundMaxChars.value=bg.maxChars;
  await chrome.storage.sync.set({trendBackgroundEnabled:bg.enabled,trendBackgroundMode:bg.mode,trendBackgroundFixedColor:bg.fixedColor,trendBackgroundColors:bg.colors,trendBackgroundMaxChars:bg.maxChars});
}
function trendLearnedPostId(post){return String(post?.id||post?.link||post?.text||"").trim().slice(0,300);}
function updateTrendSelectedPostCount(){
  if(trendSelectedPostCount)trendSelectedPostCount.textContent=t("trend2.selectedPostsCount",{n:trendPostSelectedIds.size});
}
function renderTrendLearned(posts){
  const box=trendLearnedList||$("trendLearnedList");
  if(!box)return;
  const rows=Array.isArray(posts)?posts:[];
  const available=new Set(rows.map(trendLearnedPostId).filter(Boolean));
  const beforeSelected=trendPostSelectedIds.size;
  trendPostSelectedIds=new Set([...trendPostSelectedIds].filter(id=>available.has(id)));
  if(beforeSelected!==trendPostSelectedIds.size)chrome.storage.sync.set({trendPostSelectedIds:[...trendPostSelectedIds]}).catch(()=>{});
  if(!rows.length){box.innerHTML='<div class="hint" style="padding:6px">Chưa học được bài nào</div>';updateTrendSelectedPostCount();updateTrendPostPlan();return;}
  box.innerHTML=rows.slice(-50).reverse().map((p,i)=>{
    const postId=trendLearnedPostId(p),checked=postId&&trendPostSelectedIds.has(postId)?" checked":"";
    const src=trendEsc(p.sourceGroupName||"nhóm nguồn");
    const text=trendEsc(String(p.text||"").replace(/\s+/g," ").trim().slice(0,140));
    const link=String(p.link||"");
    const a=/^https?:\/\//i.test(link)?` <a href="${trendEsc(link)}" target="_blank" style="font-size:11px">mở bài</a>`:"";
    const deleteTitle=trendEsc(t("trend2.deleteOnePost"));
    return `<div style="display:flex;align-items:flex-start;gap:6px;padding:5px;border-bottom:1px solid #eee;font-size:12px"><label style="display:flex;align-items:flex-start;gap:6px;flex:1;cursor:pointer"><input class="trend-source-post-check" type="checkbox" data-post-id="${trendEsc(postId)}"${checked} style="width:auto;margin-top:2px"><span><b>${rows.length-i}. [${src}]</b> ${text}…${a}</span></label><button type="button" class="trend-delete-post-btn" data-post-id="${trendEsc(postId)}" title="${deleteTitle}" aria-label="${deleteTitle}" style="padding:2px 6px;background:#ffebe6;color:#c0392b;border:1px solid #f5c6c6;font-size:11px">🗑</button></div>`;
  }).join("");
  updateTrendSelectedPostCount();
  updateTrendPostPlan();
}
function renderTrendDiag(diag){
  const box=$("trendLearnedList");
  if(!box||!diag||!diag.ok||!diag.stage)return;
  const s=diag.stage,f=diag.fail||{},g=diag.signals||{};
  const lines=[
    `Chẩn đoán trang: ${diag.url||""}`,
    `Ô article: toàn trang=${s.docArticles}, vùng chính=${s.mainArticles}, bóc được=${s.parsed}`,
    `Bị loại: chat/comment=${f.comment||0}, rỗng=${f.empty||0}, quảng cáo=${f.sponsored||0}, rớt=${f.parseFail||0}`
  ];
  if(g.loginForm)lines.push("⚠ Thấy form đăng nhập — tab này CHƯA đăng nhập Facebook!");
  else if(g.joinPrompt)lines.push("⚠ Thấy chữ tham gia nhóm — có thể chưa vào nhóm / đang chờ duyệt / nhóm kín.");
  else if(g.notAvailable)lines.push("⚠ Trang đang báo lỗi hiển thị nội dung.");
  (diag.samples||[]).forEach((sm,i)=>lines.push(`Mẫu ${i+1}: ${String(sm.text||"").slice(0,140)}`));
  box.innerHTML=`<div style="font-size:12px;white-space:pre-wrap;word-break:break-word;padding:6px">${trendEsc(lines.join("\n"))}</div>`;
}
async function refreshTrendAiSummary(){try{const c=await getUnifiedAiConfig();if(trendAiSummary)trendAiSummary.textContent=c.key?`Đang dùng ${c.provider} • ${c.model||"chưa chọn model"} • API Key đã lưu`:`Chưa có API Key dùng chung. Hãy cấu hình ở tab Nhóm.`;}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
function persistTrendDraft(){
  const unlimited=trendLearnUnlimited?trendLearnUnlimited.checked:true;
  const distributionMode=trendPostDistributionMode();
  const per=Math.max(1,parseInt(trendPerGroup.value)||10),target=Math.max(1,Math.min(100000,parseInt(trendTargetGroups.value)||3)),postsPerGroup=Math.max(1,Math.min(100000,parseInt(trendPostsPerGroup?.value)||1)),postDelay=Math.min(604800,Math.max(5,parseInt(trendPostDelay?.value)||30));
  trendPerGroup.value=per;trendTargetGroups.value=target;if(trendPostsPerGroup)trendPostsPerGroup.value=postsPerGroup;if(trendPostDelay)trendPostDelay.value=postDelay;
  const background=readTrendBackgroundConfig();
  const learnMode=trendLearnMode();
  return chrome.storage.sync.set({trendPerGroup:per,trendLearnUnlimited:unlimited,trendPrompt:trendPrompt.value,trendGroupPrompt:trendGroupPrompt?.value||"",trendSourceLinks:trendSourceLinks?.value||"",trendTargetLinks:trendTargetLinks?.value||"",trendStyleProfile:trendStyleProfile.value,trendTargetGroups:target,trendInterDelay:postDelay,trendPostsPerGroup:postsPerGroup,trendPostDelay:postDelay,trendPostSourceMode:trendPostSourceMode?.value==="sequential"?"sequential":"selected",trendPostDistributionMode:distributionMode,trendPostSelectedIds:[...trendPostSelectedIds],trendLearnSourceMode:learnMode,trendLearnFromTarget:learnMode==="target-selected",trendAnonymousMode:!!(trendAnonymousEnabled&&trendAnonymousEnabled.checked),trendBackgroundEnabled:background.enabled,trendBackgroundMode:background.mode,trendBackgroundFixedColor:background.fixedColor,trendBackgroundColors:background.colors,trendBackgroundMaxChars:background.maxChars});
}
function applyTrendLearnMode(){
  const linksMode=trendLearnMode()==="links";
  // Luôn hiện danh sách nhóm nguồn để người dùng có thể chuyển chế độ;
  // ô link chỉ hoạt động khi chọn chế độ học theo link.
  if(trendSourceWrap)trendSourceWrap.style.display="";
  if(trendSourceLinks){trendSourceLinks.disabled=!linksMode;trendSourceLinks.style.opacity=linksMode?"1":".65";}
  if(trendLearnBtn)trendLearnBtn.innerHTML=trendLearnRunning?"⏳ Đang học bài...":trendLearnIdleLabel();
}
function toggleTrendLearnLimit(){
  if(trendPerGroupWrap)trendPerGroupWrap.style.display=trendLearnUnlimited?.checked?"none":"";
}
toggleTrendLearnLimit();
toggleTrendPostDistributionUI();
if(trendLearnSourceMode)trendLearnSourceMode.addEventListener("change",()=>{applyTrendLearnMode();persistTrendDraft();});
if(trendSourceLinks)trendSourceLinks.addEventListener("input",()=>{if(trendLearnMode()==="links")applyTrendLearnMode();});
if(typeof bindPromptPersistence==="function")bindPromptPersistence("trendPrompt",trendPrompt);
if(typeof bindPromptPersistence==="function")bindPromptPersistence("trendGroupPrompt",trendGroupPrompt);
[trendSourceLinks,trendTargetLinks,trendPerGroup,trendTargetGroups,trendPostsPerGroup,trendPostDelay,trendStyleProfile,trendAnonymousEnabled].forEach(el=>el&&el.addEventListener("change",persistTrendDraft));
trendLearnUnlimited?.addEventListener("change",()=>{toggleTrendLearnLimit();persistTrendDraft();});
trendPostSourceMode?.addEventListener("change",()=>{toggleTrendPostDistributionUI();persistTrendDraft();updateTrendPostPlan();});
document.querySelectorAll(".trend-distribution-mode").forEach(input=>input.addEventListener("change",()=>{
  if(input.checked&&input.value==="many-to-one"&&trendTargetGroups)trendTargetGroups.value=1;
  persistTrendDraft();
  updateTrendPostPlan();
}));
[trendTargetGroups,trendPostsPerGroup].forEach(el=>el?.addEventListener("change",updateTrendPostPlan));
trendTargetLinks?.addEventListener("input",updateTrendPostPlan);
trendTargetList?.addEventListener("change",()=>{rememberTrendTargetGroups();updateTrendPostPlan();});
trendBackgroundEnabled?.addEventListener("change",()=>{toggleTrendBackgroundOptions();saveTrendBackgroundDraft();});
trendBackgroundMode?.addEventListener("change",()=>{toggleTrendBackgroundOptions();saveTrendBackgroundDraft();});
trendFixedColor?.addEventListener("change",saveTrendBackgroundDraft);
trendBackgroundMaxChars?.addEventListener("change",saveTrendBackgroundDraft);
document.querySelectorAll(".trend-post-bg-color").forEach(el=>el.addEventListener("change",saveTrendBackgroundDraft));
if(trendSourceKeyword)trendSourceKeyword.oninput=()=>{const k=trendSourceKeyword.value;trendSourceList.querySelectorAll("label[data-name]").forEach(r=>r.style.display=trendGroupMatchesKeyword(r.dataset.name,k)?"flex":"none");};
if(trendTargetKeyword)trendTargetKeyword.oninput=()=>{const k=trendTargetKeyword.value;trendTargetList.querySelectorAll("label[data-name]").forEach(r=>r.style.display=trendGroupMatchesKeyword(r.dataset.name,k)?"flex":"none");};
if(selectAllTrendSourceBtn)selectAllTrendSourceBtn.onclick=()=>{const rows=[...trendSourceList.querySelectorAll("label[data-name]")].filter(r=>r.style.display!=="none"),bs=rows.map(r=>r.querySelector(".trend-check")).filter(Boolean),on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);};
if(selectAllTrendTargetBtn)selectAllTrendTargetBtn.onclick=()=>{const rows=[...trendTargetList.querySelectorAll("label[data-name]")].filter(r=>r.style.display!=="none"),bs=rows.map(r=>r.querySelector(".trend-check")).filter(Boolean),on=bs.some(b=>!b.checked);bs.forEach(b=>b.checked=on);rememberTrendTargetGroups();updateTrendPostPlan();};
if(trendLearnedList)trendLearnedList.addEventListener("change",e=>{const input=e.target.closest?.(".trend-source-post-check");if(!input)return;const id=String(input.dataset.postId||"");if(!id)return;if(input.checked)trendPostSelectedIds.add(id);else trendPostSelectedIds.delete(id);updateTrendSelectedPostCount();chrome.storage.sync.set({trendPostSelectedIds:[...trendPostSelectedIds]});updateTrendPostPlan();});
async function deleteTrendLearnedPosts(ids,confirmDelete=true){
  const wanted=new Set((Array.isArray(ids)?ids:[]).map(String).filter(Boolean));
  if(!wanted.size){if(trendLearnStatus)trendLearnStatus.textContent=t("trend2.noPostsSelected");return;}
  if(confirmDelete&&!window.confirm(t("trend2.deleteConfirm",{n:wanted.size})))return;
  const saved=await chrome.storage.local.get(["trendLearnPosts"]),posts=Array.isArray(saved.trendLearnPosts)?saved.trendLearnPosts:[],remaining=posts.filter(post=>!wanted.has(trendLearnedPostId(post)));
  const removed=posts.length-remaining.length;
  trendPostSelectedIds=new Set([...trendPostSelectedIds].filter(id=>!wanted.has(id)));
  await chrome.storage.local.set({trendLearnPosts:remaining,trendLearnCount:remaining.length,trendLearnReady:remaining.length>0,trendLearnStatus:t("trend2.deletedPosts",{n:removed})});
  await chrome.storage.sync.set({trendPostSelectedIds:[...trendPostSelectedIds]});
  renderTrendLearned(remaining);
}
if(trendSelectAllPostsBtn)trendSelectAllPostsBtn.onclick=async()=>{const saved=await chrome.storage.local.get(["trendLearnPosts"]),ids=(Array.isArray(saved.trendLearnPosts)?saved.trendLearnPosts:[]).map(trendLearnedPostId).filter(Boolean);trendPostSelectedIds=new Set(ids);renderTrendLearned(saved.trendLearnPosts||[]);await chrome.storage.sync.set({trendPostSelectedIds:ids});await updateTrendPostPlan();};
if(trendClearPostsBtn)trendClearPostsBtn.onclick=async()=>{trendPostSelectedIds=new Set();updateTrendSelectedPostCount();renderTrendLearned((await chrome.storage.local.get(["trendLearnPosts"])).trendLearnPosts||[]);await chrome.storage.sync.set({trendPostSelectedIds:[]});await updateTrendPostPlan();};
if(trendDeleteSelectedPostsBtn)trendDeleteSelectedPostsBtn.onclick=async()=>{await deleteTrendLearnedPosts([...trendPostSelectedIds]);};
if(trendLearnedList)trendLearnedList.addEventListener("click",async e=>{const btn=e.target.closest?.(".trend-delete-post-btn");if(!btn)return;await deleteTrendLearnedPosts([String(btn.dataset.postId||"")]);});
function trendGetExportPosts(posts,selectedIds){const sel=[...selectedIds];if(sel.length>0)return posts.filter(p=>sel.includes(trendLearnedPostId(p)));return posts;}
function trendFormatPostsText(posts){return posts.map((p,i)=>{const group=p.sourceGroupName||"Nhóm nguồn";const time=p.time?new Date(p.time).toLocaleString("vi-VN"):"";const text=String(p.text||"").trim();return `===== Bài ${i+1} — ${group}${time?` — ${time}`:""} =====\n${text}`;}).join("\n\n");}
if(trendDownloadPostsBtn)trendDownloadPostsBtn.onclick=async()=>{
  const saved=await chrome.storage.local.get(["trendLearnPosts"]);
  const all=Array.isArray(saved.trendLearnPosts)?saved.trendLearnPosts:[];
  const posts=trendGetExportPosts(all,trendPostSelectedIds);
  if(!posts.length){if(trendLearnStatus)trendLearnStatus.textContent="Chưa có bài nào để tải xuống";return;}
  const content=trendFormatPostsText(posts);
  const blob=new Blob([content],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`bai-hoc-nhom-${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  if(trendLearnStatus)trendLearnStatus.textContent=`Đã tải xuống ${posts.length} bài`;
};
if(trendCopyPostsBtn)trendCopyPostsBtn.onclick=async()=>{
  const saved=await chrome.storage.local.get(["trendLearnPosts"]);
  const all=Array.isArray(saved.trendLearnPosts)?saved.trendLearnPosts:[];
  const posts=trendGetExportPosts(all,trendPostSelectedIds);
  if(!posts.length){if(trendLearnStatus)trendLearnStatus.textContent="Chưa có bài nào để sao chép";return;}
  const content=trendFormatPostsText(posts);
  try{await navigator.clipboard.writeText(content);if(trendLearnStatus)trendLearnStatus.textContent=`Đã sao chép ${posts.length} bài vào clipboard`;}
  catch{const ta=document.createElement("textarea");ta.value=content;document.body.appendChild(ta);ta.select();document.execCommand("copy");document.body.removeChild(ta);if(trendLearnStatus)trendLearnStatus.textContent=`Đã sao chép ${posts.length} bài vào clipboard`;}
};
if(loadTrendGroupsBtn)loadTrendGroupsBtn.onclick=async()=>{
  if(!trendLearnStatus)return;
  const {groups}=await requestJoinedGroupsScan(trendLearnStatus,"Đang tải danh sách nhóm đã tham gia...",n=>`Đã tải ${n} nhóm. Tích nhóm nguồn rồi bấm Học bài.`);
  renderTrendGroups(groups);
};
function trendSourceText(posts,maxChars=6000){
  return (Array.isArray(posts)?posts:[]).filter(p=>p&&String(p.text||"").trim().length>=30).slice(0,12).map((p,i)=>`[Bài ${i+1} từ ${p.sourceGroupName||"nhóm nguồn"}]: ${String(p.text||"").replace(/\s+/g," ").trim().slice(0,700)}`).join("\n\n").slice(0,maxChars);
}
function trendSelectedPostPlan(posts,groups){
  const sourcePosts=Array.isArray(posts)?posts:[],targets=Array.isArray(groups)?groups:[];
  if(!sourcePosts.length||!targets.length)return {entries:[],counts:[],reuseSingle:false};
  if(sourcePosts.length===1){
    return {entries:targets.map((group,groupIndex)=>({group,groupIndex,posts:[sourcePosts[0]]})),counts:targets.map(()=>1),reuseSingle:true};
  }
  if(sourcePosts.length<targets.length)throw new Error(t("trend2.planNeedMore",{posts:sourcePosts.length,groups:targets.length}));
  const base=Math.floor(sourcePosts.length/targets.length),extra=sourcePosts.length%targets.length;
  let cursor=0;
  const entries=targets.map((group,groupIndex)=>{
    const count=base+(groupIndex<extra?1:0),assigned=sourcePosts.slice(cursor,cursor+count);
    cursor+=count;
    return {group,groupIndex,posts:assigned};
  });
  return {entries,counts:entries.map(entry=>entry.posts.length),reuseSingle:false};
}
function trendSelectedPostPlanForMode(posts,groups,mode=trendPostDistributionMode()){
  const sourcePosts=Array.isArray(posts)?posts:[],targets=Array.isArray(groups)?groups:[];
  if(mode==="many-to-one"){
    if(sourcePosts.length<2)throw new Error(t("trend2.modeNeedsManyPosts"));
    if(targets.length!==1)throw new Error(t("trend2.modeNeedsOneGroup"));
  }else if(mode==="one-to-many"){
    if(sourcePosts.length!==1)throw new Error(t("trend2.modeNeedsOnePost"));
    if(targets.length<2)throw new Error(t("trend2.modeNeedsManyGroups"));
  }else if(mode==="many-to-many"){
    if(sourcePosts.length<2)throw new Error(t("trend2.modeNeedsManyPosts"));
    if(targets.length<2)throw new Error(t("trend2.modeNeedsManyGroups"));
  }
  return trendSelectedPostPlan(sourcePosts,targets);
}
function trendSequentialPostPlan(posts,groups,postsPerGroup){
  const sourcePosts=Array.isArray(posts)?posts:[],targets=Array.isArray(groups)?groups:[];
  const perGroup=Math.max(1,Number(postsPerGroup)||1),total=targets.length*perGroup;
  if(sourcePosts.length<total)throw new Error(t("trend2.notEnoughUniquePosts",{total,groups:targets.length,perGroup,available:sourcePosts.length}));
  let cursor=0;
  const entries=targets.map((group,groupIndex)=>{
    const assigned=sourcePosts.slice(cursor,cursor+perGroup);cursor+=perGroup;
    return {group,groupIndex,posts:assigned};
  });
  return {entries,counts:entries.map(entry=>entry.posts.length),reuseSingle:false};
}
function trendPlanSummary(plan,postCount,groupCount){
  if(plan.reuseSingle)return t("trend2.planReuse",{groups:groupCount});
  const counts=plan.counts||[],unique=[...new Set(counts)];
  if(unique.length===1)return t("trend2.planEqual",{posts:postCount,groups:groupCount,perGroup:unique[0]||0});
  return t("trend2.planUneven",{posts:postCount,groups:groupCount,counts:counts.join(" / ")});
}
function toggleTrendPostDistributionUI(){
  const selected=trendPostSourceMode?.value!=="sequential";
  if(trendPostsPerGroupWrap)trendPostsPerGroupWrap.style.display=selected?"none":"";
  if(trendDistributionModes){
    trendDistributionModes.style.display="";
    trendDistributionModes.style.opacity=selected?"1":".58";
    trendDistributionModes.setAttribute("aria-disabled",String(!selected));
  }
  if(trendDistributionHint)trendDistributionHint.textContent=selected?t("trend2.distributionHint"):t("trend2.distributionSequentialHint");
  document.querySelectorAll(".trend-distribution-mode").forEach(input=>input.disabled=!selected);
}
async function updateTrendPostPlan(){
  if(!trendPostPlan)return;
  try{
    const picked=trendTargetGroupsForRun();
    const target=Math.max(1,Math.min(100000,parseInt(trendTargetGroups?.value)||3)),groups=picked.slice(0,target);
    if(!groups.length){trendPostPlan.textContent=t("trend2.planEmpty");return;}
    const mode=trendPostSourceMode?.value==="sequential"?"sequential":"selected";
    const perGroup=Math.max(1,Math.min(100000,parseInt(trendPostsPerGroup?.value)||1));
    const required=mode==="sequential"?groups.length*perGroup:null;
    const selection=await trendPostSourcePostsForRun(required),posts=selection.posts;
    if(!posts.length){trendPostPlan.textContent=mode==="sequential"?t("trend2.planSequentialEmpty"):t("trend2.planSelectPosts");return;}
    const plan=mode==="selected"?trendSelectedPostPlanForMode(posts,groups):trendSequentialPostPlan(posts,groups,perGroup);
    trendPostPlan.textContent=mode==="selected"?trendPlanSummary(plan,posts.length,groups.length):t("trend2.planSequential",{groups:groups.length,perGroup,total:groups.length*perGroup});
  }catch(e){trendPostPlan.textContent=String(e?.message||e||t("trend2.planEmpty"));}
}
async function trendPostSourcePostsForRun(requiredCount=null){
  const saved=await chrome.storage.local.get(["trendLearnPosts"]),posts=Array.isArray(saved.trendLearnPosts)?saved.trendLearnPosts:[];
  const mode=trendPostSourceMode?.value==="sequential"?"sequential":"selected";
  const perGroup=Math.max(1,Math.min(100000,parseInt(trendPostsPerGroup?.value)||1));
  const hasRequiredCount=requiredCount!==null&&requiredCount!==undefined&&Number.isFinite(Number(requiredCount));
  const limit=hasRequiredCount?Math.max(1,Number(requiredCount)):perGroup;
  if(mode==="sequential")return {mode,posts:posts.slice(0,limit)};
  const selected=new Set([...trendPostSelectedIds]);
  return {mode,posts:posts.filter(post=>selected.has(trendLearnedPostId(post)))};
}
if(trendLearnBtn)trendLearnBtn.onclick=async()=>{
  // Bấm Học khi phiên cũ còn cờ = dừng phiên cũ rồi học lại từ đầu,
  // tránh kẹt vì cờ running sót lại từ lần bấm trước.
  if(trendLearnRunning){
    setTrendLearnRunning(false);
    try{
      await chrome.storage.local.set({trendLearnActive:false,trendLearnStatus:"Đang dừng phiên học cũ để học lại..."});
      broadcastToFacebookTabs({action:"stopTrendLearn"});
      const tab0=await getActiveTab();if(tab0?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab0.id,{action:"stopTrendLearn"});
    }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    await new Promise(r=>setTimeout(r,900));
  }
  setTrendLearnRunning(true);
  try{
    const other=await chrome.storage.local.get(["groupPostActive","groupShareActive","isAICommenting","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isGroupJoining","isDiscoverJoining","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping","salesPostActive","trendPostActive"]);
    if(Object.values(other).some(Boolean))throw new Error("Một tính năng khác đang chạy; hãy dừng trước khi học bài");
    const mode=trendLearnMode();
    let picked=trendSourceGroupsForRun();
    const learnNote=mode==="links"?" (theo link nguồn)":mode==="source-selected"?" (theo danh sách nhóm nguồn đã chọn)":" (theo danh sách nhóm đích đã chọn)";
    if(mode==="links"&&!String(trendSourceLinks?.value||"").trim())throw new Error("Hãy nhập ít nhất một link nhóm nguồn");
    if(!picked.length)throw new Error(mode==="target-selected"?"Hãy tích ít nhất một nhóm đích ở B2":"Hãy tích ít nhất một nhóm nguồn trong danh sách bên dưới");
    const unlimited=trendLearnUnlimited?trendLearnUnlimited.checked:true;
    const per=Math.max(1,parseInt(trendPerGroup.value)||10);
    const tab=await getActiveTab();if(!tab)throw new Error("Không tìm thấy tab Facebook");
    const runId=`trend-learn-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const learnCfg={groups:picked.slice(0,1000),perGroup:unlimited?0:per,unlimited};
    await persistTrendDraft();
    await chrome.storage.local.set({trendLearnConfig:learnCfg,trendLearnRunId:runId,trendLearnOwnerTabId:tab.id,trendLearnActive:true,trendLearnIndex:0,trendLearnPosts:[],trendLearnCount:0,trendLearnReady:false,trendLearnOutline:"",trendRewriteDrafts:[],trendLastDiag:null,trendLearnStatus:`Đang chuẩn bị học ${learnCfg.groups.length} nhóm${learnNote}${unlimited?" — không giới hạn số bài":""}...`});
    if(trendOutline)trendOutline.classList.add("hidden");
    if(trendPreview)trendPreview.classList.add("hidden");
    trendLearnStatus.textContent=`Đang chuẩn bị học ${learnCfg.groups.length} nhóm${learnNote}${unlimited?" — không giới hạn số bài":""}...`;
    const first=learnCfg.groups[0];
    if(!tab.url?.includes("facebook.com/groups/")){await chrome.tabs.update(tab.id,{url:first.url});await new Promise(r=>setTimeout(r,4500));}
    chrome.tabs.sendMessage(tab.id,{action:"startTrendLearn",runId,config:learnCfg},async res=>{
      if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startTrendLearn",runId,config:learnCfg},trendLearnStatus);if(!retry.ok){setTrendLearnRunning(false);trendLearnStatus.textContent="Không kết nối được với trang Facebook";}}
      else if(!res?.ok){const still=await runStillActive("trendLearnActive");if(!still){setTrendLearnRunning(false);trendLearnStatus.textContent=res?.error||"Không khởi động được học bài";}}
    });
  }catch(e){setTrendLearnRunning(false);trendLearnStatus.textContent=e.message;}
};
if(trendLearnStopBtn)trendLearnStopBtn.onclick=async()=>{setTrendLearnRunning(false);await chrome.storage.local.set({trendLearnActive:false,trendLearnStatus:"Đã dừng học bài"});broadcastToFacebookTabs({action:"stopTrendLearn"});const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"stopTrendLearn"});};
const trendDiagnoseBtn=$("trendDiagnoseBtn");
if(trendDiagnoseBtn)trendDiagnoseBtn.onclick=async()=>{
  const box=$("trendLearnedList");
  trendDiagnoseBtn.disabled=true;
  try{
    const tab=await getActiveTab();
    if(!tab||!/facebook\.com/i.test(tab.url||""))throw new Error("Hãy mở một trang Facebook (tốt nhất là đúng nhóm cần học) rồi bấm lại");
    const res=await new Promise(resolve=>{
      chrome.tabs.sendMessage(tab.id,{action:"trendDiagnose"},r=>{
        if(chrome.runtime.lastError)resolve({ok:false,error:"Không kết nối được tab (hãy reload extension + reload tab Facebook)"});
        else resolve(r||{ok:false,error:"Không phản hồi"});
      });
    });
    if(!res?.ok)throw new Error(res?.error||"Chẩn đoán thất bại");
    const s=res.stage,f=res.fail,g=res.signals;
    const lines=[
      `URL: ${res.url}`,
      `Tiêu đề: ${res.title}`,
      `Vùng chính role=main: ${res.hasMain?"có":"KHÔNG"}`,
      `Tổng ô article: toàn trang=${s.docArticles}, trong vùng chính=${s.mainArticles}`,
      `Ứng viên bài có hành động: ${s.postCandidates||0}`,
      `Qua lọc comment/chat: ${s.notComment} | có chữ: ${s.hasText} | không quảng cáo: ${s.notSponsored} | bóc được: ${s.parsed}`,
      `Bị loại: chat/comment=${f.comment}, rỗng=${f.empty}, quảng cáo=${f.sponsored}, parse rớt=${f.parseFail}`,
      `Dấu hiệu trang: đăng nhập=${g.loginForm?"CÓ (chưa đăng nhập!)":"không"} | nút tham gia=${g.joinPrompt?"CÓ (chưa vào nhóm!)":"không"} | lỗi hiển thị=${g.notAvailable?"CÓ":"không"} | role=feed=${g.feedRole}`
    ];
    (res.samples||[]).forEach((sm,i)=>lines.push(`Mẫu ${i+1}: ${sm.text}${sm.link?" | "+sm.link:""}`));
    if(box)box.innerHTML=`<div style="font-size:12px;white-space:pre-wrap;word-break:break-word;padding:6px">${trendEsc(lines.join("\n"))}</div>`;
    trendLearnStatus.textContent=`Chẩn đoán xong: ${s.parsed} bài bóc được trên trang đang mở.`;
  }catch(e){
    trendLearnStatus.textContent=`Lỗi chẩn đoán: ${e.message}`;
    if(box)box.innerHTML=`<div class="hint" style="padding:6px">Lỗi chẩn đoán: ${trendEsc(e.message)}</div>`;
  }finally{trendDiagnoseBtn.disabled=false;}
};
if(trendLearnResetBtn)trendLearnResetBtn.onclick=async()=>{setTrendLearnRunning(false);const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"resetTrendLearn"});await chrome.storage.local.set({trendLearnActive:false,trendLearnRunId:"",trendLearnOwnerTabId:0,trendLearnConfig:null,trendLearnIndex:0,trendLearnPosts:[],trendLearnCount:0,trendLearnReady:false,trendLearnOutline:"",trendRewriteDrafts:[],trendLastDiag:null,trendLearnStatus:"Đã reset học bài"});broadcastToFacebookTabs({action:"resetTrendLearn"});if(trendOutline)trendOutline.classList.add("hidden");if(trendPreview)trendPreview.classList.add("hidden");};
async function trendBuildRewrite(showStatus=true){
  const pickedPosts=await trendPostSourcePostsForRun(),posts=pickedPosts.posts;
  if(posts.length<1)throw new Error("Chưa có bài đã học. Hãy học bài trước.");
  const source=trendSourceText(posts);
  if(source.length<30)throw new Error("Bài đã học quá ngắn, hãy học thêm nhóm khác.");
  const prompt=trendRewritePrompt();
  const aiConfig=await getAiProfileFor("trendLearn");
  if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error("Chưa có API Key/Model AI dùng chung");
  const targets=trendTargetGroupsForRun();
  if(!targets.length)throw new Error("Hãy tích ít nhất một nhóm đích để xem trước bài viết lại");
  const first=targets[0];
  if(showStatus)trendLearnStatus.textContent="AI đang đọc bài đã học và viết lại...";
  const runtimeAi={provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url};
  const res=await chrome.runtime.sendMessage({action:"aiRewriteTrend",sourceText:source,groupName:first.name,prompt,aiConfig:runtimeAi,styleProfileId:trendStyleProfile.value||"",variant:1,background:readTrendBackgroundConfig()});
  if(!res?.ok)throw new Error(res?.error||"AI không viết lại được");
  return {posts,source,content:res.content,first};
}
if(trendRewriteBtn)trendRewriteBtn.onclick=async()=>{
  trendRewriteBtn.disabled=true;
  try{
    await persistTrendDraft();
    const r=await trendBuildRewrite(true);
    const saved=await chrome.storage.local.get(["trendLearnPosts"]);
    const outline=`Đã học ${saved.trendLearnPosts?.length||r.posts.length} bài. Nguồn: ${[...new Set(r.posts.slice(0,12).map(p=>p.sourceGroupName).filter(Boolean))].join(", ").slice(0,200)}`;
    await chrome.storage.local.set({trendLearnOutline:outline,trendRewriteDrafts:[r.content]});
    if(trendOutline){trendOutline.textContent=outline;trendOutline.classList.remove("hidden");}
    if(trendPreview){trendPreview.textContent=`Bài viết lại thử cho "${r.first.name}":\n\n${r.content}`;trendPreview.classList.remove("hidden");}
    trendLearnStatus.textContent=`Đã viết lại xong 1 bản thử cho ${r.first.name}. Bấm Đăng để AI viết biến thể cho từng nhóm đích.`;
  }catch(e){trendLearnStatus.textContent=`Lỗi viết lại: ${e.message}`;}
  finally{trendRewriteBtn.disabled=false;}
};
if(trendAiTestBtn)trendAiTestBtn.onclick=async()=>{const c=await getAiProfileFor("trendLearn");await testAiConnection(c,trendLearnStatus,trendAiTestBtn);await refreshTrendAiSummary();};
if(trendPostBtn)trendPostBtn.onclick=async()=>{
  if(trendPostRunning)return;
  setTrendPostRunning(true);
  try{
    const other=await chrome.storage.local.get(["groupPostActive","groupShareActive","isAICommenting","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isGroupJoining","isDiscoverJoining","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isScraping","salesPostActive","trendLearnActive"]);
    if(Object.values(other).some(Boolean))throw new Error("Một tính năng khác đang chạy; hãy dừng trước khi đăng");
    const picked=trendTargetGroupsForRun();
    if(!picked.length)throw new Error("Hãy tích ít nhất một nhóm đích");
    const target=Math.max(1,Math.min(100000,parseInt(trendTargetGroups.value)||3)),requestedPostsPerGroup=Math.max(1,Math.min(100000,parseInt(trendPostsPerGroup?.value)||1)),postDelay=Math.min(604800,Math.max(5,parseInt(trendPostDelay?.value)||30)),groups=picked.slice(0,target);
    const sourceMode=trendPostSourceMode?.value==="sequential"?"sequential":"selected";
    const requestedSlots=groups.length*requestedPostsPerGroup;
    const sourceSelection=await trendPostSourcePostsForRun(sourceMode==="sequential"?requestedSlots:null),posts=sourceSelection.posts;
    if(!posts.length)throw new Error(sourceSelection.mode==="sequential"?"Không còn bài học chưa dùng để đăng.":"Hãy tích ít nhất một bài học để đăng trong lượt B2.");
    const distributionMode=sourceSelection.mode==="selected"?trendPostDistributionMode():"sequential";
    const postPlan=sourceSelection.mode==="selected"
      ?trendSelectedPostPlanForMode(posts,groups,distributionMode)
      :trendSequentialPostPlan(posts,groups,requestedPostsPerGroup);
    const postsPerGroup=Math.max(1,...postPlan.counts);
    const source=trendSourceText(posts);
    const prompt=trendRewritePrompt();
    const background=readTrendBackgroundConfig();
    const aiConfig=await getAiProfileFor("trendPost");
    if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error("Chưa có API Key/Model AI dùng chung");
    const sourcePostIds=[...new Set(posts.map(trendLearnedPostId).filter(Boolean))],jobs=[];
    postPlan.entries.forEach(entry=>entry.posts.forEach((sourcePost,postIndex)=>{
      const jobSourceId=trendLearnedPostId(sourcePost),jobSourceText=trendSourceText([sourcePost]);
      jobs.push({group:{...entry.group},groupIndex:entry.groupIndex,postIndex,groupPostTotal:entry.posts.length,sourcePostIds:jobSourceId?[jobSourceId]:[],sourceText:jobSourceText,draft:"",variant:jobs.length+1});
    }));
    trendLearnStatus.textContent=`${trendPlanSummary(postPlan,posts.length,groups.length)} AI đang viết ${jobs.length} bài...`;
    const runtimeAi={provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url};
    const drafts=[];
    for(let i=0;i<jobs.length;i++){
      const job=jobs[i],group=job.group;
      // Link-only targets may contain a numeric ID/slug but not the displayed
      // Facebook group name. Let trend.js resolve that name after opening the
      // actual group, then generate the draft there instead of guessing it.
      if(group.manualLink&&!group.explicitName){
        drafts.push("");
        job.draft="";
        trendLearnStatus.textContent=`Sẽ lấy tên thật của nhóm ${job.groupIndex+1}/${groups.length} khi mở nhóm...`;
        continue;
      }
      const res=await chrome.runtime.sendMessage({action:"aiRewriteTrend",sourceText:job.sourceText,groupName:group.name,prompt,aiConfig:runtimeAi,styleProfileId:trendStyleProfile.value||"",variant:job.variant,background});
      if(!res?.ok)throw new Error(`AI lỗi ở nhóm ${group.name}: ${res?.error||"unknown"}`);
      drafts.push(res.content);
      job.draft=res.content;
      trendLearnStatus.textContent=`AI đã viết ${i+1}/${jobs.length} bài...`;
    }
    await chrome.storage.local.set({trendRewriteDrafts:drafts});
    if(trendPreview){const previewDraft=drafts.find(Boolean)||"AI sẽ lấy tên thật của nhóm sau khi mở từng link đích.";trendPreview.textContent=`Đã chuẩn bị ${drafts.length} bài. Bản đầu cho "${groups[0].name}":\n\n${previewDraft}`;trendPreview.classList.remove("hidden");}
    const tab=await getActiveTab();if(!tab)throw new Error("Không tìm thấy tab Facebook");
    const runId=`trend-post-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const cfg={groups,jobs,drafts,sourceText:source,sourcePostIds,sourceMode:sourceSelection.mode,distribution:distributionMode,postsPerGroup,postDelay,prompt,styleProfileId:trendStyleProfile.value||"",interDelay:postDelay,anonymousMode:!!(trendAnonymousEnabled&&trendAnonymousEnabled.checked),background,typingConfig:getAiTypingConfig("trendPost")};
    await persistTrendDraft();
    const postConfig={groups,jobs,drafts,sourceText:cfg.sourceText,sourcePostIds,sourceMode:cfg.sourceMode,distribution:cfg.distribution,postsPerGroup,postDelay,prompt,styleProfileId:cfg.styleProfileId,interDelay:cfg.interDelay,anonymousMode:cfg.anonymousMode,background:cfg.background,typingConfig:cfg.typingConfig};
    await chrome.storage.local.set({trendPostConfig:postConfig,trendPostRunId:runId,trendPostOwnerTabId:tab.id,trendPostActive:true,trendPostIndex:0,trendPostDone:0,trendPostSkipped:0,trendPostTotal:jobs.length,trendPostNextAt:0,trendPostLastColor:"",trendPostStage:"",trendPostSubmitIndex:-1,trendPostSubmitDispatchedAt:0,trendPostAnonymousMode:cfg.anonymousMode?"anonymous":"normal",trendPostStatus:`Đang chuẩn bị đăng ${jobs.length} bài vào ${groups.length} nhóm...`});
    trendPostStatus.textContent=`Đang chuẩn bị đăng ${jobs.length} bài vào ${groups.length} nhóm...`;
    if(!tab.url?.includes("facebook.com/groups/")){await chrome.tabs.update(tab.id,{url:groups[0].url});await new Promise(r=>setTimeout(r,4500));}
    chrome.tabs.sendMessage(tab.id,{action:"startTrendPost",runId,config:postConfig},async res=>{
      if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startTrendPost",runId,config:postConfig},trendPostStatus);if(!retry.ok){setTrendPostRunning(false);trendPostStatus.textContent="Không kết nối được trang Facebook";}}
      else if(!res?.ok){const still=await runStillActive("trendPostActive");if(!still){setTrendPostRunning(false);trendPostStatus.textContent=res?.error||"Không khởi động được đăng bài";}}
    });
  }catch(e){setTrendPostRunning(false);trendPostStatus.textContent=e.message;}
};
if(trendPostStopBtn)trendPostStopBtn.onclick=async()=>{setTrendPostRunning(false);await chrome.storage.local.set({trendPostActive:false,trendPostNextAt:0,trendPostStage:"",trendPostStatus:"Đã dừng đăng bài viết lại"});broadcastToFacebookTabs({action:"stopTrendPost"});const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"stopTrendPost"});};
if(trendPostResetBtn)trendPostResetBtn.onclick=async()=>{setTrendPostRunning(false);const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"resetTrendPost"});await chrome.storage.local.set({trendPostActive:false,trendPostRunId:"",trendPostOwnerTabId:0,trendPostConfig:null,trendPostIndex:0,trendPostDone:0,trendPostSkipped:0,trendPostTotal:0,trendPostNextAt:0,trendPostLastColor:"",trendPostStage:"",trendPostSubmitIndex:-1,trendPostSubmitDispatchedAt:0,trendPostStatus:"Đã reset đăng bài viết lại"});broadcastToFacebookTabs({action:"resetTrendPost"});};
try{
  chrome.storage.sync.get(["trendPerGroup","trendLearnUnlimited","trendPrompt","trendGroupPrompt","trendSourceLinks","trendTargetLinks","trendStyleProfile","trendTargetGroups","trendTargetGroupKeys","trendInterDelay","trendPostsPerGroup","trendPostDelay","trendPostSourceMode","trendPostDistributionMode","trendPostSelectedIds","trendLearnSourceMode","trendLearnFromTarget","trendBackgroundEnabled","trendBackgroundMode","trendBackgroundFixedColor","trendBackgroundColors","trendBackgroundMaxChars"],r=>{
    if(r.trendPerGroup!==undefined&&trendPerGroup)trendPerGroup.value=Math.max(1,parseInt(r.trendPerGroup)||10);
    if(trendLearnUnlimited)trendLearnUnlimited.checked=r.trendLearnUnlimited!==false;
    toggleTrendLearnLimit();
    if(r.trendPrompt!==undefined&&trendPrompt)setPromptIf(trendPrompt,r.trendPrompt);
    if(r.trendGroupPrompt!==undefined&&trendGroupPrompt)setPromptIf(trendGroupPrompt,r.trendGroupPrompt);
    if(r.trendSourceLinks!==undefined&&trendSourceLinks)trendSourceLinks.value=r.trendSourceLinks;
    if(r.trendTargetLinks!==undefined&&trendTargetLinks)trendTargetLinks.value=r.trendTargetLinks;
    if(r.trendTargetGroups!==undefined&&trendTargetGroups)trendTargetGroups.value=r.trendTargetGroups;
    if(trendPostsPerGroup)trendPostsPerGroup.value=Math.max(1,Math.min(100000,parseInt(r.trendPostsPerGroup)||1));
    if(trendPostDelay)trendPostDelay.value=Math.min(604800,Math.max(5,parseInt(r.trendPostDelay??r.trendInterDelay)||30));
    if(trendPostSourceMode)trendPostSourceMode.value=r.trendPostSourceMode==="sequential"?"sequential":"selected";
    trendTargetGroupKeys=new Set(Array.isArray(r.trendTargetGroupKeys)?r.trendTargetGroupKeys.map(String).filter(Boolean):[]);
    if(trendTargetList)trendTargetList.querySelectorAll(".trend-check").forEach(input=>input.checked=trendTargetGroupKeys.has(String(input.value||"")));
    const savedDistribution=["auto","many-to-one","one-to-many","many-to-many"].includes(r.trendPostDistributionMode)?r.trendPostDistributionMode:"auto";
    document.querySelectorAll(".trend-distribution-mode").forEach(input=>input.checked=input.value===savedDistribution);
    toggleTrendPostDistributionUI();
    trendPostSelectedIds=new Set(Array.isArray(r.trendPostSelectedIds)?r.trendPostSelectedIds.map(String):[]);
    chrome.storage.local.get(["trendLearnPosts"]).then(s=>renderTrendLearned(s.trendLearnPosts||[])).catch(()=>{});
    if(r.trendStyleProfile!==undefined&&trendStyleProfile)trendStyleProfile.value=r.trendStyleProfile;
    if(trendLearnSourceMode){
      const legacyMode=String(r.trendSourceLinks||"").trim()?"links":(r.trendLearnFromTarget===false?"source-selected":"target-selected");
      trendLearnSourceMode.value=["links","source-selected","target-selected"].includes(r.trendLearnSourceMode)?r.trendLearnSourceMode:legacyMode;
    }
    if(trendAnonymousEnabled)trendAnonymousEnabled.checked=r.trendAnonymousMode!==false;
    if(trendBackgroundEnabled)trendBackgroundEnabled.checked=r.trendBackgroundEnabled===true;
    if(trendBackgroundMode)trendBackgroundMode.value=r.trendBackgroundMode==="fixed"?"fixed":"random";
    if(trendFixedColor&&GROUP_POST_PREVIEW_COLORS[r.trendBackgroundFixedColor])trendFixedColor.value=r.trendBackgroundFixedColor;
    if(Array.isArray(r.trendBackgroundColors))document.querySelectorAll(".trend-post-bg-color").forEach(el=>el.checked=r.trendBackgroundColors.includes(el.value));
    if(trendBackgroundMaxChars&&r.trendBackgroundMaxChars)trendBackgroundMaxChars.value=Math.min(130,Math.max(40,parseInt(r.trendBackgroundMaxChars)||100));
    toggleTrendBackgroundOptions();
    applyTrendLearnMode();
    updateTrendPostPlan();
  });
  chrome.storage.local.get(["joinedGroups","trendLearnStatus","trendLearnCount","trendLearnActive","trendLearnPosts","trendLastDiag","trendLearnOutline","trendRewriteDrafts","trendPostStatus","trendPostDone","trendPostSkipped","trendPostTotal","trendPostActive"],r=>{
    if(r.joinedGroups)renderTrendGroups(r.joinedGroups);
    if(r.trendLearnStatus&&trendLearnStatus)trendLearnStatus.textContent=r.trendLearnStatus;
    if(trendLearnCount)trendLearnCount.textContent=`${r.trendLearnCount||0} bài`;
    renderTrendLearned(r.trendLearnPosts||[]);
    if(!(r.trendLearnPosts||[]).length&&r.trendLastDiag)renderTrendDiag(r.trendLastDiag);
    setTrendLearnRunning(!!r.trendLearnActive);
    if(r.trendLearnOutline&&trendOutline){trendOutline.textContent=r.trendLearnOutline;trendOutline.classList.remove("hidden");}
    if(r.trendRewriteDrafts?.[0]&&trendPreview){trendPreview.textContent=r.trendRewriteDrafts[0];trendPreview.classList.remove("hidden");}
    if(r.trendPostStatus&&trendPostStatus)trendPostStatus.textContent=r.trendPostStatus;
    if(trendPostCount)trendPostCount.textContent=`${r.trendPostDone||0} / ${r.trendPostTotal||0} (bỏ qua ${r.trendPostSkipped||0})`;
    setTrendPostRunning(!!r.trendPostActive);
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.joinedGroups&&changes.joinedGroups.newValue)renderTrendGroups(changes.joinedGroups.newValue);
    if(changes.trendLearnStatus&&trendLearnStatus)trendLearnStatus.textContent=changes.trendLearnStatus.newValue||"";
    if(changes.trendLearnCount&&trendLearnCount)trendLearnCount.textContent=`${changes.trendLearnCount.newValue||0} bài`;
    if(changes.trendLearnPosts)renderTrendLearned(changes.trendLearnPosts.newValue||[]);
    if(changes.trendLastDiag&&changes.trendLastDiag.newValue)renderTrendDiag(changes.trendLastDiag.newValue);
    if(changes.trendLearnActive)setTrendLearnRunning(!!changes.trendLearnActive.newValue);
    if(changes.trendPostStatus&&trendPostStatus)trendPostStatus.textContent=changes.trendPostStatus.newValue||"";
    if(changes.trendPostActive)setTrendPostRunning(!!changes.trendPostActive.newValue);
    if(changes.trendPostDone||changes.trendPostSkipped||changes.trendPostTotal)chrome.storage.local.get(["trendPostDone","trendPostSkipped","trendPostTotal"],r=>{if(trendPostCount)trendPostCount.textContent=`${r.trendPostDone||0} / ${r.trendPostTotal||0} (bỏ qua ${r.trendPostSkipped||0})`;});
  });
  refreshTrendAiSummary();
}catch(e){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }


// ĐĂNG TƯỜNG NICK TỪ TIN TỨC (state newsWall* riêng — không dùng ké máy đăng nhóm)
const newsSourceType=$("newsSourceType"),newsKeyword=$("newsKeyword"),newsCategory=$("newsCategory"),newsRssUrl=$("newsRssUrl"),newsSiteList=$("newsSiteList"),
  newsGoogleWrap=$("newsGoogleWrap"),newsCategoryWrap=$("newsCategoryWrap"),newsUrlWrap=$("newsUrlWrap"),newsSitesWrap=$("newsSitesWrap"),newsXHint=$("newsXHint"),
  newsCount=$("newsCount"),newsInterDelay=$("newsInterDelay"),newsMode=$("newsMode"),newsBgMaxChars=$("newsBgMaxChars"),
  newsMinDelay=$("newsMinDelay"),newsWithImage=$("newsWithImage"),newsStampSource=$("newsStampSource"),newsXUsers=$("newsXUsers"),newsXUsersWrap=$("newsXUsersWrap"),newsFbWrap=$("newsFbWrap"),newsFbUrls=$("newsFbUrls"),newsFbMode=$("newsFbMode"),newsFbIncludeComment=$("newsFbIncludeComment"),newsFbRewritePrompt=$("newsFbRewritePrompt"),newsFbOpinionPrompt=$("newsFbOpinionPrompt"),newsTimeRange=$("newsTimeRange"),newsPrompt=$("newsPrompt"),newsPromptBg=$("newsPromptBg"),newsPromptPhoto=$("newsPromptPhoto"),newsPromptBgWrap=$("newsPromptBgWrap"),newsPromptWrap=$("newsPromptWrap"),newsPromptPhotoWrap=$("newsPromptPhotoWrap"),newsPromptResetBtn=$("newsPromptResetBtn"),newsPreview=$("newsPreview"),
  newsPreviewBtn=$("newsPreviewBtn"),newsFetchTestBtn=$("newsFetchTestBtn"),
  newsStartBtn=$("newsStartBtn"),newsStopBtn=$("newsStopBtn"),newsResetBtn=$("newsResetBtn"),
  newsStatus=$("newsWallStatus"),newsCountEl=$("newsWallCount"),
  newsScheduleWhen=$("newsScheduleWhen"),newsScheduleBtn=$("newsScheduleBtn"),newsScheduleStatus=$("newsScheduleStatus"),
  newsPublishMode=$("newsPublishMode"),newsFbScheduleWrap=$("newsFbScheduleWrap"),newsFbScheduleAt=$("newsFbScheduleAt"),newsFbScheduleGap=$("newsFbScheduleGap");
const NEWS_VNEXPRESS_CATS=["Tin mới nhất","Kinh doanh","Bất động sản","Công nghệ","Thể thao","Giải trí","Sức khỏe","Du lịch","Khoa học","Giáo dục","Ô tô - Xe máy"];
if(newsCategory&&!newsCategory.options.length)NEWS_VNEXPRESS_CATS.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;newsCategory.appendChild(o);});
function newsSplitKeywords(s){
  return String(s||"").split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean).slice(0,5);
}
// Danh sách user X lưu theo tên, dùng chung Đăng tường + Đăng nhóm.
function parseXUsersText(s){
  return String(s||"").split(/[\r\n,;]+/).map(x=>x.trim().replace(/^@/,"")).filter(x=>/^[A-Za-z0-9_]{1,15}$/.test(x)).slice(0,1000);
}
async function loadXUserLists(){
  try{const r=await chrome.storage.sync.get(["xUserLists"]);return Array.isArray(r.xUserLists)?r.xUserLists:[];}catch(_){return[];}
}
async function saveXUserLists(list){
  try{await chrome.storage.sync.set({xUserLists:Array.isArray(list)?list:[]});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
function newsParseXUsers(){
  return parseXUsersText(newsXUsers?.value||"");
}
function newsParseSiteList(){
  return String(newsSiteList?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(s=>/^https?:\/\//i.test(s)).slice(0,100);
}
function newsSelectedHours(){
  const v=parseInt(newsTimeRange?.value||"0");
  return [0,24,48,72,168,720].includes(v)?v:0;
}
function newsParseFbList(){
  return String(newsFbUrls?.value||"").split(/\r?\n/).map(s=>s.trim())
    .filter(s=>/^https?:\/\/(?:www\.|m\.)?facebook\.com\//i.test(s)).slice(0,100);
}
function newsCurrentSource(){
  const t=newsSourceType?.value||"google";
  const hours=newsSelectedHours();
  if(t==="fb")return {type:"fb",urls:newsParseFbList(),hours,mode:newsFbMode?.value||"rewrite",includeComment:!!newsFbIncludeComment?.checked};
  if(t==="vnexpress")return {type:"vnexpress",category:newsCategory?.value||"Tin mới nhất",hours};
  if(t==="url")return {type:"url",url:String(newsRssUrl?.value||"").trim(),hours};
  if(t==="sites")return {type:"sites",urls:newsParseSiteList(),q:String(newsKeyword?.value||"").trim(),hours};
  if(t==="xread")return {type:"xread",users:newsParseXUsers(),hours};
  return {type:"google",q:String(newsKeyword?.value||"").trim(),hours};
}
function newsToggleSourceUI(){
  const t=newsSourceType?.value||"google";
  if(newsGoogleWrap)newsGoogleWrap.style.display=(t==="google"||t==="sites")?"":"none";
  if(newsCategoryWrap)newsCategoryWrap.style.display=t==="vnexpress"?"":"none";
  if(newsUrlWrap)newsUrlWrap.style.display=t==="url"?"":"none";
  if(newsSitesWrap)newsSitesWrap.style.display=t==="sites"?"":"none";
  if(newsXHint)newsXHint.style.display=t==="xread"?"":"none";
  if(newsXUsersWrap)newsXUsersWrap.style.display=t==="xread"?"":"none";
  if(newsFbWrap)newsFbWrap.style.display=t==="fb"?"":"none";
}
if(newsSourceType)newsSourceType.addEventListener("change",()=>{newsToggleSourceUI();chrome.storage.sync.set({newsSourceType:newsSourceType.value}).catch(()=>{});});
function newsTogglePublishUI(){
  const fb=newsPublishMode?.value==="fbSchedule";
  if(newsFbScheduleWrap)newsFbScheduleWrap.style.display=fb?"":"none";
}
if(newsPublishMode)newsPublishMode.addEventListener("change",()=>{newsTogglePublishUI();persistNewsDraft();});
function setNewsRunning(v){
  if(newsStartBtn){newsStartBtn.innerHTML=v?"⏳ Đang đăng tường...":"▶ Đăng tường từ tin mới";newsStartBtn.classList.toggle("running",!!v);}
  setPromptEditorState(!!v,newsPrompt,"newsPromptLockHint");
}
async function newsReadXPosts(count){
  const tabs=await chrome.tabs.query({url:["*://x.com/*","*://twitter.com/*"]}).catch(()=>[]);
  const tab=tabs.find(t=>t.url&&!/login/i.test(t.url))||tabs[0];
  if(!tab)throw new Error(t("nw.needXTab"));
  const res=await new Promise(resolve=>chrome.tabs.sendMessage(tab.id,{action:"xReadPosts",count},r=>resolve(chrome.runtime.lastError?null:r)));
  if(!res?.ok)throw new Error(res?.error||t("nw.xReadFail"));
  return res.posts||[];
}
if(newsFetchTestBtn)newsFetchTestBtn.onclick=async()=>{
  newsFetchTestBtn.disabled=true;
  try{
    const src=newsCurrentSource();
    let items=[];
    if(src.type==="xread"){
      const posts=await newsReadXPosts(5);
      items=posts.map(p=>({title:String(p.text||"").slice(0,120),desc:String(p.text||"").slice(0,400),link:p.link||"",image:"",pubDate:""}));
    }else{
      const res=await chrome.runtime.sendMessage({action:"newsFetch",source:src,count:5});
      if(!res?.ok)throw new Error(res?.error||"?");
      items=res.items||[];
    }
    if(newsStatus)newsStatus.textContent=t("nw.fetched",{n:items.length})+(items[0]?` — ${items[0].title.slice(0,80)}`:"");
  }catch(e){if(newsStatus)newsStatus.textContent=t("nw.fetchFail",{err:String(e?.message||e).slice(0,120)});}
  finally{newsFetchTestBtn.disabled=false;}
};
if(newsPreviewBtn)newsPreviewBtn.onclick=async()=>{
  newsPreviewBtn.disabled=true;
  if(newsStatus)newsStatus.textContent=t("nw.previewing");
  try{
    const built=await buildNewsWallConfig(true);
    const gen=await chrome.runtime.sendMessage({action:"aiGenerateNewsPost",news:built.news,topic:built.topic,mode:built.mode,kind:built.kind,maxChars:built.maxChars,prompt:built.prompt,aiConfig:built.aiConfig,styleProfileId:built.styleProfileId});
    if(!gen?.ok)throw new Error(gen?.error||"?");
    if(newsPreview){newsPreview.textContent=gen.content;newsPreview.classList.remove("hidden");}
    if(newsStatus)newsStatus.textContent=t("nw.previewDone",{n:gen.length});
  }catch(e){if(newsStatus)newsStatus.textContent=t("nw.previewFail",{err:String(e?.message||e).slice(0,150)});}
  finally{newsPreviewBtn.disabled=false;}
};
async function buildNewsWallConfig(previewOnly=false){
  const src=newsCurrentSource();
  if(src.type==="google"&&!newsSplitKeywords(src.q).length)throw new Error(t("nw.needKeyword"));
  if(src.type==="url"&&!/^https?:\/\//i.test(src.url||""))throw new Error(t("nw.needUrl"));
  if(src.type==="sites"&&!(src.urls||[]).length)throw new Error(t("nw.needSites"));
  if(src.type==="sites"&&!newsSplitKeywords(src.q).length)throw new Error(t("nw.needKeyword"));
  if(src.type==="fb"&&!(src.urls||[]).length)throw new Error(t("bg.newsNoFbUrls"));
  let mode=["bg","photo","text"].includes(newsMode?.value)?newsMode.value:"bg";
  const count=Math.max(1,Math.min(100000,parseInt(newsCount?.value)||1));
  const interDelay=Math.min(604800,Math.max(0,parseInt(newsInterDelay?.value)||60));
  const minDelay=Math.min(604800,Math.max(0,parseInt(newsMinDelay?.value)||15));
  const maxChars=Math.min(500,Math.max(40,parseInt(newsBgMaxChars?.value)||130));
  // Mỗi kiểu bài 1 prompt riêng, tự chọn theo mode (trống = dùng mặc định).
  // Nguồn Facebook có 2 prompt riêng: viết lại và quan điểm cá nhân.
  const fbPromptEl=src.type==="fb"?(src.mode==="opinion_screenshot"?newsFbOpinionPrompt:newsFbRewritePrompt):null;
  const promptEl=src.type==="fb"?fbPromptEl:(mode==="bg"?newsPromptBg:mode==="photo"?newsPromptPhoto:newsPrompt);
  const prompt=String(promptEl?.value||"").trim();
  if(prompt&&(!prompt.includes("{newsText}")))throw new Error(t("nw.needNewsText"));
  const aiConfig=await getAiProfileFor("newsWall");
  if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error(t("p.gpNeedKeyModel"));
  const styleProfileId=typeof salesStyleProfile!=="undefined"?String(salesStyleProfile?.value||""):"";
  let news=null,topic="";
  if(src.type==="xread"){
    if((src.users||[]).length){
      // Có nhập user: background tự mở từng profile X đọc tin (preview/start
      // và vòng chạy đều đi đường newsFetch này).
      const res=await chrome.runtime.sendMessage({action:"newsFetch",source:src,count:previewOnly?3:Math.max(3,count*2)});
      if(!res?.ok)throw new Error(res?.error||"?");
      const used=await chrome.storage.local.get(["newsUsedUrls"]).catch(()=>({}));
      const usedSet=new Set(Array.isArray(used.newsUsedUrls)?used.newsUsedUrls:[]);
      const it=(res.items||[]).find(x=>x.link&&!usedSet.has(x.link))||(res.items||[])[0];
      if(!it)throw new Error(t("bg.newsEmpty"));
      news={title:it.title,desc:it.desc,link:it.link,image:"",pubDate:it.pubDate||"",author:it.author||"",site:"x.com",topic:it.topic||""};
    }else{
      const posts=await newsReadXPosts(previewOnly?1:count);
      if(!posts.length)throw new Error(t("nw.xEmpty"));
      const p=posts[0];
      news={title:String(p.text||"").slice(0,200),desc:String(p.text||"").slice(0,900),link:p.link||"",image:"",pubDate:""};
    }
    topic=String(newsKeyword?.value||"").trim();
  }else{
    const res=await chrome.runtime.sendMessage({action:"newsFetch",source:src,count:previewOnly?3:Math.max(3,count*2)});
    if(!res?.ok)throw new Error(res?.error||"?");
    const used=await chrome.storage.local.get(["newsUsedUrls"]).catch(()=>({}));
    const usedSet=new Set(Array.isArray(used.newsUsedUrls)?used.newsUsedUrls:[]);
    news=(res.items||[]).find(it=>it.link&&!usedSet.has(it.link))||(res.items||[])[0];
    if(!news)throw new Error(t("bg.newsEmpty"));
    topic=src.type==="fb"?String(news.author||"Facebook"):((src.type==="google"||src.type==="sites")?String(src.q||""):String(src.category||""));
  }
  persistNewsDraft();
  const publishMode=newsPublishMode?.value==="fbSchedule"?"fbSchedule":"now";
  let fbScheduleAt=0;
  if(publishMode==="fbSchedule"&&!previewOnly){
    const raw=String(newsFbScheduleAt?.value||"").trim();
    if(!raw)throw new Error(t("nw.needFbAt"));
    fbScheduleAt=new Date(raw).getTime();
    if(!fbScheduleAt||isNaN(fbScheduleAt))throw new Error(t("nw.needFbAt"));
    if(fbScheduleAt<Date.now()+30*60*1000)throw new Error(t("nw.fbTooSoon"));
  }
  const fbScheduleGap=Math.min(10080,Math.max(5,parseInt(newsFbScheduleGap?.value)||30));
  return {source:src,news,topic,mode,kind:mode,count,interDelay,minDelay,maxDelay:minDelay,maxChars,prompt,
    publishMode,fbScheduleAt,fbScheduleGap,
    withImage:mode==="photo"?(newsWithImage?.checked!==false):false,
    stampSource:newsStampSource?.checked!==false,
    aiConfig,typingConfig:getAiTypingConfig("newsWall"),styleProfileId};
}
function persistNewsDraft(){
  try{
    chrome.storage.sync.set({
      newsSourceType:newsSourceType?.value||"google",newsKeyword:newsKeyword?.value||"",newsXUsers:newsXUsers?.value||"",
      newsCategory:newsCategory?.value||"",newsRssUrl:newsRssUrl?.value||"",newsSiteList:newsSiteList?.value||"",
      newsFbUrls:newsFbUrls?.value||"",newsFbMode:newsFbMode?.value||"rewrite",newsFbIncludeComment:!!newsFbIncludeComment?.checked,
      newsFbRewritePrompt:newsFbRewritePrompt?.value||"",newsFbOpinionPrompt:newsFbOpinionPrompt?.value||"",
      newsCount:newsCount?.value,newsInterDelay:newsInterDelay?.value,newsMode:newsMode?.value||"bg",newsTimeRange:newsTimeRange?.value||"0",
      newsBgMaxChars:newsBgMaxChars?.value,newsMinDelay:newsMinDelay?.value,
      newsPublishMode:newsPublishMode?.value||"now",newsFbScheduleAt:newsFbScheduleAt?.value||"",newsFbScheduleGap:newsFbScheduleGap?.value||"30",
      newsWithImage:!!newsWithImage?.checked,newsStampSource:!!newsStampSource?.checked,newsPrompt:newsPrompt?.value||"",newsPromptBg:newsPromptBg?.value||"",newsPromptPhoto:newsPromptPhoto?.value||""
    }).catch(()=>{});
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}
if(newsPrompt)bindPromptPersistence("newsPrompt",newsPrompt);
if(newsPromptBg)bindPromptPersistence("newsPromptBg",newsPromptBg);
if(newsPromptPhoto)bindPromptPersistence("newsPromptPhoto",newsPromptPhoto);
function newsTogglePromptUI(){
  const m=["bg","photo","text"].includes(newsMode?.value)?newsMode.value:"bg";
  if(newsPromptBgWrap)newsPromptBgWrap.style.display=m==="bg"?"":"none";
  if(newsPromptWrap)newsPromptWrap.style.display=m==="text"?"":"none";
  if(newsPromptPhotoWrap)newsPromptPhotoWrap.style.display=m==="photo"?"":"none";
}
if(newsMode)newsMode.addEventListener("change",()=>{newsTogglePromptUI();});
if(newsPromptResetBtn)newsPromptResetBtn.onclick=()=>{
  const m=["bg","photo","text"].includes(newsMode?.value)?newsMode.value:"bg";
  const def=m==="bg"?t("bg.newsBgDefault"):m==="photo"?t("bg.newsPhotoDefault"):t("bg.newsDefault");
  const el=m==="bg"?newsPromptBg:m==="photo"?newsPromptPhoto:newsPrompt;
  if(el){el.value=def;persistNewsDraft();}
};
  [newsCount,newsInterDelay,newsMode,newsBgMaxChars,newsMinDelay,newsWithImage,newsStampSource,newsTimeRange,newsFbMode,newsFbIncludeComment,newsFbScheduleAt,newsFbScheduleGap].filter(Boolean).forEach(el=>el.addEventListener("change",persistNewsDraft));
if(newsKeyword)bindPromptPersistence("newsKeyword",newsKeyword);
if(newsCategory)newsCategory.addEventListener("change",()=>chrome.storage.sync.set({newsCategory:newsCategory.value}).catch(()=>{}));
if(newsRssUrl)bindPromptPersistence("newsRssUrl",newsRssUrl);
if(newsSiteList)bindPromptPersistence("newsSiteList",newsSiteList);
if(newsXUsers)bindPromptPersistence("newsXUsers",newsXUsers);
if(newsFbUrls)bindPromptPersistence("newsFbUrls",newsFbUrls);
if(newsFbRewritePrompt)bindPromptPersistence("newsFbRewritePrompt",newsFbRewritePrompt);
if(newsFbOpinionPrompt)bindPromptPersistence("newsFbOpinionPrompt",newsFbOpinionPrompt);
// Quản lý danh sách user X lưu theo tên (dùng chung Đăng tường + Đăng nhóm).
const newsXListPicker=$("newsXListPicker"),newsXListName=$("newsXListName"),newsXListSaveBtn=$("newsXListSaveBtn"),newsXListDeleteBtn=$("newsXListDeleteBtn");
async function refreshNewsXListPicker(keep=""){
  const lists=await loadXUserLists();
  if(newsXListPicker){
    newsXListPicker.innerHTML=`<option value="">—</option>`+lists.map(l=>`<option value="${String(l.id||"")}">${String(l.name||"")}</option>`).join("");
    if(keep)newsXListPicker.value=keep;
  }
  return lists;
}
async function refreshGroupPostXList(keep=""){
  const el=$("groupPostXList");
  if(!el)return [];
  const lists=await loadXUserLists();
  groupPostXListCache=lists;
  el.innerHTML=`<option value="__custom__">${t("gp.xCustom")}</option>`+lists.map(l=>`<option value="${String(l.id||"")}">${String(l.name||"")}</option>`).join("");
  if(keep)el.value=keep;
  return lists;
}
if(newsXListPicker)newsXListPicker.addEventListener("change",async()=>{
  const lists=await loadXUserLists();
  const hit=lists.find(l=>String(l.id||"")===newsXListPicker.value);
  if(hit&&newsXUsers){newsXUsers.value=(hit.users||[]).join("\n");persistNewsDraft();}
});
if(newsXListSaveBtn)newsXListSaveBtn.onclick=async()=>{
  const users=newsParseXUsers();
  if(!users.length)return;
  const name=String(newsXListName?.value||"").trim().slice(0,60);
  const lists=await loadXUserLists();
  if(!name){
    // Để trống tên + đang chọn 1 list → cập nhật user cho list đó.
    const sel=String(newsXListPicker?.value||"");
    const ix=sel?lists.findIndex(l=>String(l.id||"")===sel):-1;
    if(ix<0)return;
    lists[ix]={...lists[ix],users};
    await saveXUserLists(lists);
    if(newsXListName)newsXListName.value="";
    await refreshNewsXListPicker(lists[ix].id);
    await refreshGroupPostXList();
    return;
  }
  const id="xl"+Date.now().toString(36);
  const ix=lists.findIndex(l=>l.name===name);
  const entry={id:ix>=0?lists[ix].id:id,name,users};
  if(ix>=0)lists[ix]=entry;else lists.push(entry);
  await saveXUserLists(lists.slice(-30));
  if(newsXListName)newsXListName.value="";
  await refreshNewsXListPicker(entry.id);
  await refreshGroupPostXList();
};
const newsXListRenameBtn=$("newsXListRenameBtn");
if(newsXListRenameBtn)newsXListRenameBtn.onclick=async()=>{
  const sel=String(newsXListPicker?.value||"");
  const name=String(newsXListName?.value||"").trim().slice(0,60);
  if(!sel||!name)return;
  const lists=await loadXUserLists();
  const ix=lists.findIndex(l=>String(l.id||"")===sel);
  if(ix<0)return;
  // Trùng tên list khác thì gộp user (lấy hợp, giữ id của list đích).
  const clash=lists.findIndex((l,i)=>i!==ix&&l.name===name);
  if(clash>=0){
    const merged=[...lists[clash].users||[],...lists[ix].users||[]].filter((u,i,a)=>a.indexOf(u)===i).slice(0,1000);
    lists[clash]={...lists[clash],users:merged};
    lists.splice(ix,1);
    await saveXUserLists(lists);
    if(newsXListName)newsXListName.value="";
    await refreshNewsXListPicker(lists[clash].id);
    await refreshGroupPostXList();
    return;
  }
  lists[ix]={...lists[ix],name};
  await saveXUserLists(lists);
  if(newsXListName)newsXListName.value="";
  await refreshNewsXListPicker(lists[ix].id);
  await refreshGroupPostXList();
};
if(newsXListDeleteBtn)newsXListDeleteBtn.onclick=async()=>{
  if(!newsXListPicker?.value)return;
  const lists=(await loadXUserLists()).filter(l=>String(l.id||"")!==newsXListPicker.value);
  await saveXUserLists(lists);
  await refreshNewsXListPicker();
  await refreshGroupPostXList();
};
const newsXListExportBtn=$("newsXListExportBtn"),newsXListImportBtn=$("newsXListImportBtn"),newsXListFile=$("newsXListFile");
// Xuất backup JSON (phòng gỡ nhầm extension / chuyển máy). Update extension
// KHÔNG mất danh sách (nằm ở chrome.storage.sync, update giữ nguyên).
if(newsXListExportBtn)newsXListExportBtn.onclick=async()=>{
  const lists=await loadXUserLists();
  const blob=new Blob([JSON.stringify({app:"fb-auto-tool",kind:"x-user-lists",version:1,exportedAt:new Date().toISOString(),lists},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  try{await chrome.downloads.download({url,filename:"x-user-lists.json",saveAs:true});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  setTimeout(()=>{try{URL.revokeObjectURL(url);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }},30000);
};
if(newsXListImportBtn&&newsXListFile){
  newsXListImportBtn.onclick=()=>{try{newsXListFile.click();}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }};
  newsXListFile.addEventListener("change",async()=>{
    try{
      const f=newsXListFile.files?.[0];
      if(!f)return;
      const data=JSON.parse(await f.text());
      const arr=Array.isArray(data)?data:data.lists;
      if(!Array.isArray(arr))return;
      const cur=await loadXUserLists();
      for(const e of arr){
        const name=String(e?.name||"").trim().slice(0,60);
        const users=(Array.isArray(e?.users)?e.users:[]).map(u=>String(u||"").replace(/^@/,"").trim()).filter(u=>/^[A-Za-z0-9_]{1,15}$/.test(u)).slice(0,1000);
        if(!name||!users.length)continue;
        const ix=cur.findIndex(l=>l.name===name);
        const entry={id:ix>=0?cur[ix].id:"xl"+Date.now().toString(36)+Math.floor(Math.random()*99),name,users};
        if(ix>=0)cur[ix]=entry;else cur.push(entry);
      }
      await saveXUserLists(cur.slice(-30));
      await refreshNewsXListPicker();
      await refreshGroupPostXList();
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    finally{try{newsXListFile.value="";}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
  });
}
refreshNewsXListPicker();
// Giờ hẹn Facebook mặc định: hiện tại +60p, làm tròn lên khung 5 phút của FB.
function newsDefaultFbAt(){
  const d=new Date(Date.now()+60*60000);
  d.setSeconds(0,0);
  d.setMinutes(Math.ceil(d.getMinutes()/5)*5);
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
newsStartBtn.onclick=async()=>{
  if(!newsStartBtn)return;
  setNewsRunning(true);
  try{
    const other=await chrome.storage.local.get(["groupPostActive","groupShareActive","isAICommenting","isFeedInteracting",...FEED_SCOPED_ACTIVE_KEYS,"isGroupJoining","isDiscoverJoining","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive","pageGroupCommentActive","isRunning","isScraping"]);
    if(Object.values(other).some(Boolean))throw new Error(t("pg.busyOther"));
    const cfg=await buildNewsWallConfig(false);
    const tab=await getActiveTab();if(!tab||!tab.url?.includes("facebook.com"))throw new Error(t("pg.noFb"));
    const runId=`newswall-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const runtimeCfg={...cfg,aiConfig:{provider:cfg.aiConfig.provider,model:cfg.aiConfig.model,url:cfg.aiConfig.url,profileId:cfg.aiConfig.profileId||""}};
    await chrome.storage.local.set({newsWallActive:true,newsWallRunId:runId,newsWallOwnerTabId:tab.id,newsWallConfig:{...runtimeCfg,ownerTabId:tab.id},newsWallDone:0,newsWallSkipped:0,newsWallStatus:t("nw.starting")});
    newsWallStatus.textContent=t("nw.starting");
    if(!tab.url.startsWith("https://www.facebook.com/")){await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/"});await new Promise(r=>setTimeout(r,4500));}
    chrome.tabs.sendMessage(tab.id,{action:"startNewsWallPost",runId,config:runtimeCfg},async res=>{
      if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startNewsWallPost",runId,config:runtimeCfg},newsWallStatus);if(!retry.ok)setNewsRunning(false);return;}
      if(!res?.ok){setNewsRunning(false);newsWallStatus.textContent=res?.error||t("pgs.busy");}
    });
  }catch(error){setNewsRunning(false);newsWallStatus.textContent=error.message;}
};
newsStopBtn.onclick=async()=>{setNewsRunning(false);await chrome.storage.local.set({newsWallActive:false,newsWallStatus:t("nw.stopped")});broadcastToFacebookTabs({action:"stopNewsWallPost"});const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"stopNewsWallPost"});};
newsResetBtn.onclick=async()=>{setNewsRunning(false);await chrome.storage.local.set({newsWallActive:false,newsWallDone:0,newsWallSkipped:0,newsWallStatus:t("nw.resetStatus")});await chrome.storage.local.remove(["newsWallConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetNewsWallPost"});};

// ---- Đăng tường từ nội dung có sẵn (readyWall): hàng chờ soạn tay, AI viết
// lại hoặc giữ nguyên, hẹn bằng lịch gốc Facebook (không treo máy chờ giờ).
const readyWallList=$("readyWallList"),readyWallText=$("readyWallText"),readyWallFiles=$("readyWallFiles"),readyWallAt=$("readyWallAt"),readyWallAddBtn=$("readyWallAddBtn"),readyWallClearBtn=$("readyWallClearBtn"),readyWallMode=$("readyWallMode"),readyWallPrompt=$("readyWallPrompt"),readyWallFirstAt=$("readyWallFirstAt"),readyWallGap=$("readyWallGap"),readyWallStartBtn=$("readyWallStartBtn"),readyWallStopBtn=$("readyWallStopBtn"),readyWallResetBtn=$("readyWallResetBtn"),readyWallStatus=$("readyWallStatus"),readyWallCount=$("readyWallCount");
const READY_WALL_MAX_FILE=25*1024*1024,READY_WALL_MAX_ITEMS=10000;
function readyWallTimeText(ms){try{return new Date(ms).toLocaleString("vi-VN",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"});}catch(_){return"";}}
async function readyWallGetDraft(){try{const r=await chrome.storage.local.get(["readyWallDraft"]);return Array.isArray(r.readyWallDraft)?r.readyWallDraft:[];}catch(_){return[];}}
async function readyWallSetDraft(items){try{await chrome.storage.local.set({readyWallDraft:items});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
function readyWallItemLabel(it,i){
  const tm=it.at?readyWallTimeText(it.at):"";
  return `${i+1}. ${String(it.text||"").slice(0,60)}${(it.files||[]).length?` [${(it.files||[]).length} tệp]`:""}${tm?" · "+tm:""}${it.done?" ✓":""}${it.skipped?" (bỏ qua)":""}`;
}
async function readyWallRender(){
  if(!readyWallList)return;
  const items=await readyWallGetDraft();
  if(!items.length){readyWallList.innerHTML=`<div class="hint">${t("rw.empty")}</div>`;return;}
  const frag=document.createDocumentFragment();
  items.forEach((it,idx)=>{
    const row=document.createElement("div");row.className="schedule-item";
    const text=document.createElement("div");text.textContent=readyWallItemLabel(it,idx);
    const actions=document.createElement("div");actions.className="schedule-item-actions";
    const up=document.createElement("button");up.type="button";up.textContent="▲";up.disabled=idx<=0;
    up.onclick=async()=>{const l=await readyWallGetDraft();if(idx<=0)return;[l[idx-1],l[idx]]=[l[idx],l[idx-1]];await readyWallSetDraft(l);readyWallRender();};
    const down=document.createElement("button");down.type="button";down.textContent="▼";down.disabled=idx>=items.length-1;
    down.onclick=async()=>{const l=await readyWallGetDraft();if(idx>=l.length-1)return;[l[idx+1],l[idx]]=[l[idx],l[idx+1]];await readyWallSetDraft(l);readyWallRender();};
    const del=document.createElement("button");del.type="button";del.textContent="✕";
    del.onclick=async()=>{const l=await readyWallGetDraft();l.splice(idx,1);await readyWallSetDraft(l);readyWallRender();};
    actions.append(up,down,del);row.append(text,actions);frag.appendChild(row);
  });
  readyWallList.replaceChildren(frag);
}
function readyWallReadFile(file){
  return new Promise(resolve=>{
    try{
      if(!file||!(/^(image|video)\//.test(file.type||"")))return resolve({ok:false,error:file?.name||"?"});
      if(file.size>READY_WALL_MAX_FILE)return resolve({ok:false,error:file.name});
      const fr=new FileReader();
      fr.onload=()=>resolve({ok:true,name:file.name,type:file.type,dataUrl:String(fr.result||"")});
      fr.onerror=()=>resolve({ok:false,error:file.name});
      fr.readAsDataURL(file);
    }catch(e){resolve({ok:false,error:String(e?.message||e).slice(0,60)});}
  });
}
if(readyWallAddBtn)readyWallAddBtn.onclick=async()=>{
  const text=String(readyWallText?.value||"").trim();
  if(!text){if(readyWallStatus)readyWallStatus.textContent=t("rw.needText");return;}
  const files=Array.from(readyWallFiles?.files||[]).slice(0,1000);
  const packed=[];
  for(const f of files){
    const r=await readyWallReadFile(f);
    if(!r.ok){if(readyWallStatus)readyWallStatus.textContent=t("rw.tooBig")+": "+String(r.error||"").slice(0,60);return;}
    packed.push({name:r.name,type:r.type,dataUrl:r.dataUrl});
  }
  let at=0;
  const raw=String(readyWallAt?.value||"").trim();
  if(raw){const ms=new Date(raw).getTime();if(Number.isFinite(ms))at=ms;}
  const items=await readyWallGetDraft();
  if(items.length>=READY_WALL_MAX_ITEMS)return;
  items.push({id:`rw${Date.now().toString(36)}${Math.floor(Math.random()*36).toString(36)}`,text,files:packed,at,done:false,skipped:""});
  await readyWallSetDraft(items);
  if(readyWallText)readyWallText.value="";
  if(readyWallFiles)readyWallFiles.value="";
  if(readyWallAt)readyWallAt.value="";
  readyWallRender();
};
if(readyWallClearBtn)readyWallClearBtn.onclick=async()=>{
  const items=await readyWallGetDraft();
  await readyWallSetDraft(items.filter(it=>!it.done));
  readyWallRender();
};
function setReadyWallRunning(v){
  if(readyWallStartBtn){readyWallStartBtn.innerHTML=v?"⏳ Đang đăng tường...":"▶ Đăng các bài đã soạn";readyWallStartBtn.classList.toggle("running",!!v);}
  setPromptEditorState(!!v,readyWallPrompt,"");
}
if(readyWallPrompt)bindPromptPersistence("readyWallPrompt",readyWallPrompt);
[readyWallMode,readyWallFirstAt,readyWallGap].filter(Boolean).forEach(el=>el.addEventListener("change",()=>{
  try{chrome.storage.sync.set({readyWallMode:readyWallMode?.value||"ai",readyWallFirstAt:readyWallFirstAt?.value||"",readyWallGap:readyWallGap?.value||"180"}).catch(()=>{});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}));
readyWallStartBtn.onclick=async()=>{
  if(!readyWallStartBtn)return;
  setReadyWallRunning(true);
  try{
    const other=await chrome.storage.local.get(["groupPostActive","groupShareActive","isAICommenting","isFeedInteracting","isGroupJoining","isDiscoverJoining","salesPostActive","trendLearnActive","trendPostActive"]);
    if(Object.values(other).some(Boolean))throw new Error(t("pg.busyOther"));
    // Run cũ mồ côi (tab chủ đã đóng mà cờ còn bật): dọn để chạy mới được.
    try{
      const st=await chrome.storage.local.get(["readyWallActive","readyWallOwnerTabId"]);
      if(st.readyWallActive){
        const tb=st.readyWallOwnerTabId?await chrome.tabs.get(st.readyWallOwnerTabId).catch(()=>null):null;
        if(!tb)await chrome.storage.local.set({readyWallActive:false,readyWallStatus:t("rw.reset"),readyWallNextAt:0});
      }
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    const items=(await readyWallGetDraft()).filter(it=>!it.done);
    if(!items.length)throw new Error(t("rw.empty"));
    const mode=readyWallMode?.value==="asis"?"asis":"ai";
    let prompt=String(readyWallPrompt?.value||"").trim();
    if(mode==="ai"){
      if(!prompt)prompt=t("rw.promptDefault");
      if(!prompt.includes("{postText}"))throw new Error(t("nw.needNewsText"));
    }
    const aiConfig=await getAiProfileFor("readyWall");
    if(aiKeyRequired(aiConfig)&&(!aiConfig.key||!aiConfig.model))throw new Error(t("p.gpNeedKeyModel"));
    // Gán giờ cho bài chưa có: bài đầu = giờ đã chọn (trống = +2 phút),
    // các bài sau cộng dồn giãn cách. Lưu luôn để reload/resume giữ nguyên.
    let base=Date.now()+2*60000;
    const rawFirst=String(readyWallFirstAt?.value||"").trim();
    if(rawFirst){const ms=new Date(rawFirst).getTime();if(Number.isFinite(ms)&&ms>Date.now()+30000)base=ms;}
    const gap=Math.min(604800,Math.max(30,parseInt(readyWallGap?.value)||180))*1000;
    let cursor=base;
    const queued=items.map(it=>{const at=it.at&&it.at>Date.now()?it.at:(cursor);if(!(it.at&&it.at>Date.now()))cursor+=gap;return {...it,at,mode,prompt};});
    const lastAt=Math.max(...queued.map(q=>q.at));
    if(lastAt<Date.now()+30000)throw new Error(t("sch.needFuture"));
    await chrome.storage.local.set({readyWallDraft:queued});
    const runId=`readywall-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const runtimeCfg={items:queued.map(q=>({id:q.id,text:q.text,files:q.files,at:q.at,mode:q.mode})),prompt,aiConfig:{provider:aiConfig.provider,model:aiConfig.model,url:aiConfig.url,profileId:aiConfig.profileId||""},typingConfig:getAiTypingConfig("readyWall"),gapMs:gap};
    const tab=await getActiveTab();if(!tab||!tab.url?.includes("facebook.com"))throw new Error(t("pg.noFb"));
    await chrome.storage.local.set({readyWallActive:true,readyWallRunId:runId,readyWallOwnerTabId:tab.id,readyWallConfig:runtimeCfg,readyWallDone:0,readyWallSkipped:0,readyWallStatus:t("rw.starting"),readyWallNextAt:0,readyWallSkipLog:[]});
    readyWallStatus.textContent=t("rw.starting");
    if(!tab.url.startsWith("https://www.facebook.com/")){await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/"});await new Promise(r=>setTimeout(r,4500));}
    chrome.tabs.sendMessage(tab.id,{action:"startReadyWallPost",runId,config:runtimeCfg,ownerTabId:tab.id},async res=>{
      if(chrome.runtime.lastError){const retry=await autoReloadAndRetry(tab.id,{action:"startReadyWallPost",runId,config:runtimeCfg,ownerTabId:tab.id},readyWallStatus);if(!retry.ok)setReadyWallRunning(false);return;}
      if(!res?.ok){setReadyWallRunning(false);readyWallStatus.textContent=res?.error||t("pgs.busy");}
    });
  }catch(error){setReadyWallRunning(false);readyWallStatus.textContent=error.message;}
};
readyWallStopBtn.onclick=async()=>{setReadyWallRunning(false);await chrome.storage.local.set({readyWallActive:false,readyWallStatus:t("rw.stopped")});broadcastToFacebookTabs({action:"stopReadyWallPost"});const tab=await getActiveTab();if(tab?.url?.includes("facebook.com"))chrome.tabs.sendMessage(tab.id,{action:"stopReadyWallPost"});};
readyWallResetBtn.onclick=async()=>{setReadyWallRunning(false);await chrome.storage.local.set({readyWallActive:false,readyWallDone:0,readyWallSkipped:0,readyWallStatus:t("rw.resetStatus"),readyWallNextAt:0,readyWallSkipLog:[]});await chrome.storage.local.remove(["readyWallConfig"]).catch(()=>{});broadcastToFacebookTabs({action:"resetReadyWallPost"});readyWallRender();};
chrome.storage.sync.get(["readyWallMode","readyWallPrompt","readyWallFirstAt","readyWallGap"],async r=>{
  if(readyWallMode&&r.readyWallMode)readyWallMode.value=r.readyWallMode==="asis"?"asis":"ai";
  if(r.readyWallPrompt!==undefined)setPromptIf(readyWallPrompt,r.readyWallPrompt);
  if(readyWallFirstAt&&r.readyWallFirstAt)readyWallFirstAt.value=r.readyWallFirstAt;
  if(r.readyWallGap!==undefined)readyWallGap.value=Math.min(604800,Math.max(30,parseInt(r.readyWallGap)||180));
});
chrome.storage.local.get(["readyWallActive","readyWallDone","readyWallSkipped","readyWallStatus"],r=>{
  if(r.readyWallStatus&&readyWallStatus)readyWallStatus.textContent=r.readyWallStatus;
  if(readyWallCount)readyWallCount.textContent=`${r.readyWallDone||0} / ${(r.readyWallDone||0)+(r.readyWallSkipped||0)}`;
  setReadyWallRunning(!!r.readyWallActive);
  readyWallRender();
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  if(changes.readyWallStatus&&readyWallStatus)readyWallStatus.textContent=changes.readyWallStatus.newValue||"";
  if(changes.readyWallActive)setReadyWallRunning(!!changes.readyWallActive.newValue);
  if(changes.readyWallDone||changes.readyWallSkipped||changes.readyWallDraft)chrome.storage.local.get(["readyWallDone","readyWallSkipped"],r=>{if(readyWallCount)readyWallCount.textContent=`${r.readyWallDone||0} / ${(r.readyWallDone||0)+(r.readyWallSkipped||0)}`;readyWallRender();});
});
if(newsScheduleBtn)newsScheduleBtn.onclick=async()=>{
  try{
    const when=newsScheduleWhen?.value||"";
    if(!when)throw new Error(t("sch.needWhen"));
    const cfg=await buildNewsWallConfig(false);
    const res=await chrome.runtime.sendMessage({action:"scheduleCreate",task:{feature:"newsWall",runAt:new Date(when).getTime(),config:{...cfg,aiConfig:{provider:cfg.aiConfig.provider,model:cfg.aiConfig.model,url:cfg.aiConfig.url,profileId:cfg.aiConfig.profileId||""}}}});
    if(newsScheduleStatus)newsScheduleStatus.textContent=res?.ok?t("sch.scheduled"):String(res?.error||"?");
  }catch(e){if(newsScheduleStatus)newsScheduleStatus.textContent=String(e?.message||e).slice(0,150);}
};
  chrome.storage.sync.get(["newsSourceType","newsKeyword","newsCategory","newsRssUrl","newsSiteList","newsXUsers","newsFbUrls","newsFbMode","newsFbIncludeComment","newsFbRewritePrompt","newsFbOpinionPrompt","newsCount","newsInterDelay","newsMode","newsTimeRange","newsBgMaxChars","newsMinDelay","newsWithImage","newsStampSource","newsPrompt","newsPromptBg","newsPromptPhoto","newsPublishMode","newsFbScheduleAt","newsFbScheduleGap"],async r=>{
  if(newsSourceType&&r.newsSourceType)newsSourceType.value=r.newsSourceType;
  if(newsKeyword&&r.newsKeyword!==undefined)newsKeyword.value=r.newsKeyword;
  if(newsCategory&&r.newsCategory)newsCategory.value=r.newsCategory;
  if(newsRssUrl&&r.newsRssUrl!==undefined)newsRssUrl.value=r.newsRssUrl;
  if(newsSiteList&&r.newsSiteList!==undefined)newsSiteList.value=r.newsSiteList;
  if(newsXUsers&&r.newsXUsers!==undefined)newsXUsers.value=r.newsXUsers;
  if(newsFbUrls&&r.newsFbUrls!==undefined)newsFbUrls.value=r.newsFbUrls;
  if(newsFbMode&&r.newsFbMode)newsFbMode.value=["rewrite","rewrite_original","opinion_screenshot"].includes(r.newsFbMode)?r.newsFbMode:"rewrite";
  if(newsFbIncludeComment&&r.newsFbIncludeComment!==undefined)newsFbIncludeComment.checked=r.newsFbIncludeComment!==false;
  if(newsFbRewritePrompt&&r.newsFbRewritePrompt!==undefined)newsFbRewritePrompt.value=r.newsFbRewritePrompt;
  if(newsFbOpinionPrompt&&r.newsFbOpinionPrompt!==undefined)newsFbOpinionPrompt.value=r.newsFbOpinionPrompt;
  if(newsCount)newsCount.value=Math.max(1,Math.min(100000,parseInt(r.newsCount)||1));
  if(newsInterDelay)newsInterDelay.value=Math.min(604800,Math.max(0,parseInt(r.newsInterDelay??60)||60));
  if(newsMode)newsMode.value=["bg","photo","text"].includes(r.newsMode)?r.newsMode:"bg";
  if(newsTimeRange&&["0","24","72","168","720"].includes(String(r.newsTimeRange??"0")))newsTimeRange.value=String(r.newsTimeRange);
  if(newsBgMaxChars)newsBgMaxChars.value=Math.min(500,Math.max(40,parseInt(r.newsBgMaxChars)||130));
  if(newsMinDelay)newsMinDelay.value=Math.min(604800,Math.max(0,parseInt(r.newsMinDelay??15)||15));
  if(newsPublishMode)newsPublishMode.value=r.newsPublishMode==="fbSchedule"?"fbSchedule":"now";
  // Giờ hẹn đã lưu mà quá khứ/quá gần (Start luôn văng fbTooSoon) thì tự đặt
  // lại giờ mặc định cho user thấy trước khi bấm — không đụng giờ tương lai tốt.
  if(newsFbScheduleAt){
    const raw=String(r.newsFbScheduleAt||"");
    const ms=raw?new Date(raw).getTime():0;
    if(raw&&ms&&!isNaN(ms)&&ms>=Date.now()+35*60000){newsFbScheduleAt.value=raw;}
    else{const def=newsDefaultFbAt();newsFbScheduleAt.value=def;chrome.storage.sync.set({newsFbScheduleAt:def}).catch(()=>{});}
  }
  if(newsFbScheduleGap)newsFbScheduleGap.value=Math.min(10080,Math.max(5,parseInt(r.newsFbScheduleGap)||30));
  if(newsWithImage)newsWithImage.checked=r.newsWithImage!==false;
  if(newsStampSource)newsStampSource.checked=r.newsStampSource!==false;
  if(r.newsPrompt!==undefined)setPromptIf(newsPrompt,r.newsPrompt);
  if(newsPromptBg&&r.newsPromptBg!==undefined)newsPromptBg.value=r.newsPromptBg;
  if(newsPromptPhoto&&r.newsPromptPhoto!==undefined)newsPromptPhoto.value=r.newsPromptPhoto;
  newsToggleSourceUI();newsTogglePublishUI();newsTogglePromptUI();
});
chrome.storage.local.get(["newsWallActive","newsWallDone","newsWallSkipped","newsWallStatus"],r=>{
  if(r.newsWallStatus&&newsWallStatus)newsWallStatus.textContent=r.newsWallStatus;
  if(newsCountEl)newsCountEl.textContent=`${r.newsWallDone||0} / ${(r.newsWallDone||0)+(r.newsWallSkipped||0)}`;
  setNewsRunning(!!r.newsWallActive);
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local")return;
  if(changes.newsWallStatus&&newsWallStatus)newsWallStatus.textContent=changes.newsWallStatus.newValue||"";
  if(changes.newsWallActive)setNewsRunning(!!changes.newsWallActive.newValue);
  if(changes.newsWallDone||changes.newsWallSkipped)chrome.storage.local.get(["newsWallDone","newsWallSkipped"],r=>{if(newsCountEl)newsCountEl.textContent=`${r.newsWallDone||0} / ${(r.newsWallDone||0)+(r.newsWallSkipped||0)}`;});
});


// ── ĐĂNG STORY FACEBOOK (fbStory) ───────────────────────────────────────────
const fbStoryMediaUrls = $("fbStoryMediaUrls"),
  fbStoryText = $("fbStoryText"),
  fbStoryDelay = $("fbStoryDelay"),
  fbStoryAiEnabled = $("fbStoryAiEnabled"),
  fbStoryAiPrompt = $("fbStoryAiPrompt"),
  fbStoryAiPromptWrap = $("fbStoryAiPromptWrap"),
  fbStoryCrossIg = $("fbStoryCrossIg"),
  fbStoryStartBtn = $("fbStoryStartBtn"),
  fbStoryStopBtn = $("fbStoryStopBtn"),
  fbStoryResetBtn = $("fbStoryResetBtn"),
  fbStoryStatus = $("fbStoryStatus"),
  fbStoryCount = $("fbStoryCount"),
  fbStoryScheduleWhen = $("fbStoryScheduleWhen"),
  fbStoryScheduleBtn = $("fbStoryScheduleBtn"),
  fbStoryScheduleStatus = $("fbStoryScheduleStatus");

function setFbStoryRunning(running) {
  if (fbStoryStartBtn) fbStoryStartBtn.disabled = running;
  if (fbStoryStopBtn) fbStoryStopBtn.disabled = !running;
}

if (fbStoryAiEnabled) {
  fbStoryAiEnabled.addEventListener("change", () => {
    if (fbStoryAiPromptWrap) fbStoryAiPromptWrap.style.display = fbStoryAiEnabled.checked ? "" : "none";
    chrome.storage.sync.set({ fbStoryAiEnabled: !!fbStoryAiEnabled.checked }).catch(() => {});
  });
}

function persistFbStoryDraft() {
  try {
    chrome.storage.sync.set({
      fbStoryMediaUrls: fbStoryMediaUrls?.value || "",
      fbStoryText: fbStoryText?.value || "",
      fbStoryDelay: fbStoryDelay?.value || "30",
      fbStoryAiEnabled: !!fbStoryAiEnabled?.checked,
      fbStoryAiPrompt: fbStoryAiPrompt?.value || "",
      fbStoryCrossIg: !!fbStoryCrossIg?.checked
    }).catch(() => {});
  } catch (_) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}

[fbStoryMediaUrls, fbStoryText, fbStoryDelay, fbStoryAiPrompt, fbStoryCrossIg].filter(Boolean).forEach(el => {
  el.addEventListener("change", persistFbStoryDraft);
});

chrome.storage.sync.get(["fbStoryMediaUrls", "fbStoryText", "fbStoryDelay", "fbStoryAiEnabled", "fbStoryAiPrompt", "fbStoryCrossIg"], r => {
  if (fbStoryMediaUrls && r.fbStoryMediaUrls !== undefined) fbStoryMediaUrls.value = r.fbStoryMediaUrls;
  if (fbStoryText && r.fbStoryText !== undefined) fbStoryText.value = r.fbStoryText;
  if (fbStoryDelay && r.fbStoryDelay !== undefined) fbStoryDelay.value = r.fbStoryDelay;
  if (fbStoryAiEnabled && r.fbStoryAiEnabled !== undefined) {
    fbStoryAiEnabled.checked = !!r.fbStoryAiEnabled;
    if (fbStoryAiPromptWrap) fbStoryAiPromptWrap.style.display = fbStoryAiEnabled.checked ? "" : "none";
  }
  if (fbStoryAiPrompt && r.fbStoryAiPrompt !== undefined) fbStoryAiPrompt.value = r.fbStoryAiPrompt;
  if (fbStoryCrossIg && r.fbStoryCrossIg !== undefined) fbStoryCrossIg.checked = !!r.fbStoryCrossIg;
});

chrome.storage.local.get(["fbStoryActive", "fbStoryDone", "fbStorySkipped", "fbStoryStatus"], r => {
  if (r.fbStoryStatus && fbStoryStatus) fbStoryStatus.textContent = r.fbStoryStatus;
  if (fbStoryCount) fbStoryCount.textContent = `${r.fbStoryDone || 0} / ${(r.fbStoryDone || 0) + (r.fbStorySkipped || 0)}`;
  setFbStoryRunning(!!r.fbStoryActive);
});

if (fbStoryStartBtn) fbStoryStartBtn.onclick = async () => {
  setFbStoryRunning(true);
  try {
    const urls = String(fbStoryMediaUrls?.value || "").trim();
    if (!urls) throw new Error(t("fbStory.needMedia"));
    const other = await chrome.storage.local.get([
      "groupPostActive", "groupShareActive", "isAICommenting", "isFeedInteracting",
      ...FEED_SCOPED_ACTIVE_KEYS, "isGroupJoining", "isDiscoverJoining", "salesPostActive",
      "trendLearnActive", "trendPostActive", "newsWallActive", "fbReelsActive",
      "pageGroupJoinActive", "pageGroupPostActive", "pageCommentActive", "pageSalesPostActive",
      "pageGroupCommentActive", "isRunning", "isScraping"
    ]);
    if (Object.values(other).some(Boolean)) throw new Error(t("pg.busyOther"));
    const tab = await getActiveTab();
    if (!tab || !tab.url?.includes("facebook.com")) throw new Error(t("pg.noFb"));
    const aiConfig = await getAiProfileFor("fbStory").catch(() => ({}));
    const runId = `fbstory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runtimeCfg = {
      mediaUrls: urls,
      text: String(fbStoryText?.value || "").trim(),
      delay: Math.max(0, parseInt(fbStoryDelay?.value) || 30),
      aiEnabled: !!fbStoryAiEnabled?.checked,
      aiPrompt: String(fbStoryAiPrompt?.value || "").trim(),
      crossIg: !!fbStoryCrossIg?.checked,
      ownerTabId: tab.id,
      aiConfig: aiConfig ? { provider: aiConfig.provider, model: aiConfig.model, url: aiConfig.url, profileId: aiConfig.profileId || "" } : undefined
    };
    await chrome.storage.local.set({
      fbStoryActive: true,
      fbStoryRunId: runId,
      fbStoryOwnerTabId: tab.id,
      fbStoryConfig: runtimeCfg,
      fbStoryDone: 0,
      fbStorySkipped: 0,
      fbStoryStatus: t("fbStory.starting")
    });
    if (fbStoryStatus) fbStoryStatus.textContent = t("fbStory.starting");
    if (!tab.url.startsWith("https://www.facebook.com/stories/create")) {
      await chrome.tabs.update(tab.id, { url: "https://www.facebook.com/stories/create" });
      await new Promise(r => setTimeout(r, 4000));
    }
    chrome.tabs.sendMessage(tab.id, { action: "startFbStory", runId, config: runtimeCfg }, async res => {
      if (chrome.runtime.lastError) {
        const retry = await autoReloadAndRetry(tab.id, { action: "startFbStory", runId, config: runtimeCfg }, fbStoryStatus);
        if (!retry.ok) setFbStoryRunning(false);
        return;
      }
      if (!res?.ok) {
        setFbStoryRunning(false);
        if (fbStoryStatus) fbStoryStatus.textContent = res?.error || t("pgs.busy");
      }
    });
  } catch (error) {
    setFbStoryRunning(false);
    if (fbStoryStatus) fbStoryStatus.textContent = error.message;
  }
};

if (fbStoryStopBtn) fbStoryStopBtn.onclick = async () => {
  setFbStoryRunning(false);
  await chrome.storage.local.set({ fbStoryActive: false, fbStoryStatus: t("fbStory.stopped") });
  broadcastToFacebookTabs({ action: "stopFbStory" });
};

if (fbStoryResetBtn) fbStoryResetBtn.onclick = async () => {
  setFbStoryRunning(false);
  await chrome.storage.local.set({ fbStoryActive: false, fbStoryDone: 0, fbStorySkipped: 0, fbStoryStatus: t("fbStory.resetStatus") });
  await chrome.storage.local.remove(["fbStoryConfig"]).catch(() => {});
  broadcastToFacebookTabs({ action: "resetFbStory" });
};

// ── ĐĂNG REELS FACEBOOK (fbReels) ───────────────────────────────────────────
const fbReelsVideoUrl = $("fbReelsVideoUrl"),
  fbReelsCaption = $("fbReelsCaption"),
  fbReelsAiEnabled = $("fbReelsAiEnabled"),
  fbReelsAiPrompt = $("fbReelsAiPrompt"),
  fbReelsAiPromptWrap = $("fbReelsAiPromptWrap"),
  fbReelsCrossIg = $("fbReelsCrossIg"),
  fbReelsStartBtn = $("fbReelsStartBtn"),
  fbReelsStopBtn = $("fbReelsStopBtn"),
  fbReelsResetBtn = $("fbReelsResetBtn"),
  fbReelsStatus = $("fbReelsStatus"),
  fbReelsCount = $("fbReelsCount"),
  fbReelsScheduleWhen = $("fbReelsScheduleWhen"),
  fbReelsScheduleBtn = $("fbReelsScheduleBtn"),
  fbReelsScheduleStatus = $("fbReelsScheduleStatus");

function setFbReelsRunning(running) {
  if (fbReelsStartBtn) fbReelsStartBtn.disabled = running;
  if (fbReelsStopBtn) fbReelsStopBtn.disabled = !running;
}

if (fbReelsAiEnabled) {
  fbReelsAiEnabled.addEventListener("change", () => {
    if (fbReelsAiPromptWrap) fbReelsAiPromptWrap.style.display = fbReelsAiEnabled.checked ? "" : "none";
    chrome.storage.sync.set({ fbReelsAiEnabled: !!fbReelsAiEnabled.checked }).catch(() => {});
  });
}

function persistFbReelsDraft() {
  try {
    chrome.storage.sync.set({
      fbReelsVideoUrl: fbReelsVideoUrl?.value || "",
      fbReelsCaption: fbReelsCaption?.value || "",
      fbReelsAiEnabled: !!fbReelsAiEnabled?.checked,
      fbReelsAiPrompt: fbReelsAiPrompt?.value || "",
      fbReelsCrossIg: !!fbReelsCrossIg?.checked
    }).catch(() => {});
  } catch (_) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}

[fbReelsVideoUrl, fbReelsCaption, fbReelsAiPrompt, fbReelsCrossIg].filter(Boolean).forEach(el => {
  el.addEventListener("change", persistFbReelsDraft);
});

chrome.storage.sync.get(["fbReelsVideoUrl", "fbReelsCaption", "fbReelsAiEnabled", "fbReelsAiPrompt", "fbReelsCrossIg"], r => {
  if (fbReelsVideoUrl && r.fbReelsVideoUrl !== undefined) fbReelsVideoUrl.value = r.fbReelsVideoUrl;
  if (fbReelsCaption && r.fbReelsCaption !== undefined) fbReelsCaption.value = r.fbReelsCaption;
  if (fbReelsAiEnabled && r.fbReelsAiEnabled !== undefined) {
    fbReelsAiEnabled.checked = !!r.fbReelsAiEnabled;
    if (fbReelsAiPromptWrap) fbReelsAiPromptWrap.style.display = fbReelsAiEnabled.checked ? "" : "none";
  }
  if (fbReelsAiPrompt && r.fbReelsAiPrompt !== undefined) fbReelsAiPrompt.value = r.fbReelsAiPrompt;
  if (fbReelsCrossIg && r.fbReelsCrossIg !== undefined) fbReelsCrossIg.checked = !!r.fbReelsCrossIg;
});

chrome.storage.local.get(["fbReelsActive", "fbReelsDone", "fbReelsSkipped", "fbReelsStatus"], r => {
  if (r.fbReelsStatus && fbReelsStatus) fbReelsStatus.textContent = r.fbReelsStatus;
  if (fbReelsCount) fbReelsCount.textContent = `${r.fbReelsDone || 0} / ${(r.fbReelsDone || 0) + (r.fbReelsSkipped || 0)}`;
  setFbReelsRunning(!!r.fbReelsActive);
});

if (fbReelsStartBtn) fbReelsStartBtn.onclick = async () => {
  setFbReelsRunning(true);
  try {
    const videoUrl = String(fbReelsVideoUrl?.value || "").trim();
    if (!videoUrl) throw new Error(t("fbReels.needVideo"));
    const other = await chrome.storage.local.get([
      "groupPostActive", "groupShareActive", "isAICommenting", "isFeedInteracting",
      ...FEED_SCOPED_ACTIVE_KEYS, "isGroupJoining", "isDiscoverJoining", "salesPostActive",
      "trendLearnActive", "trendPostActive", "newsWallActive", "fbStoryActive",
      "pageGroupJoinActive", "pageGroupPostActive", "pageCommentActive", "pageSalesPostActive",
      "pageGroupCommentActive", "isRunning", "isScraping"
    ]);
    if (Object.values(other).some(Boolean)) throw new Error(t("pg.busyOther"));
    const tab = await getActiveTab();
    if (!tab || !tab.url?.includes("facebook.com")) throw new Error(t("pg.noFb"));
    const aiConfig = await getAiProfileFor("fbReels").catch(() => ({}));
    const runId = `fbreels-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runtimeCfg = {
      videoUrl,
      content: String(fbReelsCaption?.value || "").trim(),
      aiEnabled: !!fbReelsAiEnabled?.checked,
      aiPrompt: String(fbReelsAiPrompt?.value || "").trim(),
      crossIg: !!fbReelsCrossIg?.checked,
      ownerTabId: tab.id,
      aiConfig: aiConfig ? { provider: aiConfig.provider, model: aiConfig.model, url: aiConfig.url, profileId: aiConfig.profileId || "" } : undefined
    };
    await chrome.storage.local.set({
      fbReelsActive: true,
      fbReelsRunId: runId,
      fbReelsOwnerTabId: tab.id,
      fbReelsConfig: runtimeCfg,
      fbReelsDone: 0,
      fbReelsSkipped: 0,
      fbReelsStatus: t("fbReels.starting")
    });
    if (fbReelsStatus) fbReelsStatus.textContent = t("fbReels.starting");
    // 2.11.1: /reel/create đã chết cho nick chuyên nghiệp — mở trang chủ,
    // fbReels.js tự dò cửa tạo Reel (menu Tạo / composer / mục Reels của
    // profile / Meta Business Suite).
    if (!/^https:\/\/www\.facebook\.com\/?($|[?#])/.test(tab.url || "")) {
      await chrome.tabs.update(tab.id, { url: "https://www.facebook.com/" });
      await new Promise(r => setTimeout(r, 4000));
    }
    chrome.tabs.sendMessage(tab.id, { action: "startFbReels", runId, config: runtimeCfg }, async res => {
      if (chrome.runtime.lastError) {
        const retry = await autoReloadAndRetry(tab.id, { action: "startFbReels", runId, config: runtimeCfg }, fbReelsStatus);
        if (!retry.ok) setFbReelsRunning(false);
        return;
      }
      if (!res?.ok) {
        setFbReelsRunning(false);
        if (fbReelsStatus) fbReelsStatus.textContent = res?.error || t("pgs.busy");
      }
    });
  } catch (error) {
    setFbReelsRunning(false);
    if (fbReelsStatus) fbReelsStatus.textContent = error.message;
  }
};

if (fbReelsStopBtn) fbReelsStopBtn.onclick = async () => {
  setFbReelsRunning(false);
  await chrome.storage.local.set({ fbReelsActive: false, fbReelsStatus: t("fbReels.stopped") });
  broadcastToFacebookTabs({ action: "stopFbReels" });
};

if (fbReelsResetBtn) fbReelsResetBtn.onclick = async () => {
  setFbReelsRunning(false);
  await chrome.storage.local.set({ fbReelsActive: false, fbReelsDone: 0, fbReelsSkipped: 0, fbReelsStatus: t("fbReels.resetStatus") });
  await chrome.storage.local.remove(["fbReelsConfig"]).catch(() => {});
  broadcastToFacebookTabs({ action: "resetFbReels" });
};

// Listeners chung cho storage fbStory và fbReels
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.fbStoryStatus && fbStoryStatus) fbStoryStatus.textContent = changes.fbStoryStatus.newValue || "";
  if (changes.fbStoryActive) setFbStoryRunning(!!changes.fbStoryActive.newValue);
  if (changes.fbStoryDone || changes.fbStorySkipped) {
    chrome.storage.local.get(["fbStoryDone", "fbStorySkipped"], r => {
      if (fbStoryCount) fbStoryCount.textContent = `${r.fbStoryDone || 0} / ${(r.fbStoryDone || 0) + (r.fbStorySkipped || 0)}`;
    });
  }
  if (changes.fbReelsStatus && fbReelsStatus) fbReelsStatus.textContent = changes.fbReelsStatus.newValue || "";
  if (changes.fbReelsActive) setFbReelsRunning(!!changes.fbReelsActive.newValue);
  if (changes.fbReelsDone || changes.fbReelsSkipped) {
    chrome.storage.local.get(["fbReelsDone", "fbReelsSkipped"], r => {
      if (fbReelsCount) fbReelsCount.textContent = `${r.fbReelsDone || 0} / ${(r.fbReelsDone || 0) + (r.fbReelsSkipped || 0)}`;
    });
  }
});

// HỒ SƠ KIẾN THỨC & VĂN PHONG DÙNG CHUNG CHO CÁC TÍNH NĂNG AI
const styleProfileName = $("styleProfileName");
const createStyleProfileBtn = $("createStyleProfileBtn");
const refreshStyleProfilesBtn = $("refreshStyleProfilesBtn");
const deleteStyleProfileBtn = $("deleteStyleProfileBtn");
const styleProfileStatus = $("styleProfileStatus");
const styleProfileSelects = [$("scrapeStyleProfile"),$("groupPostStyleProfile"),$("pageGroupPostStyleProfile"),$("aiStyleProfile"),$("salesStyleProfile"),$("pageSalesStyleProfile"),$("trendStyleProfile")].filter(Boolean);
let styleProfileCache = {};

function renderStyleProfileOptions(profiles, activeId=""){
  styleProfileCache = profiles && typeof profiles === "object" ? profiles : {};
  styleProfileSelects.forEach(select=>{
    const previous=select.value;
    select.textContent="";
    const empty=document.createElement("option");
    empty.value=""; empty.textContent=t("st.none"); select.appendChild(empty);
    Object.values(styleProfileCache).sort((a,b)=>String(a?.name||"").localeCompare(String(b?.name||""),"vi")).forEach(profile=>{
      if(!profile?.id)return;
      const option=document.createElement("option");
      option.value=profile.id;
      option.textContent=t("p.profileLabel",{name:profile.name||profile.id,n:profile.sampleCount||0});
      select.appendChild(option);
    });
    select.value=activeId && styleProfileCache[activeId] ? activeId : (styleProfileCache[previous]?previous:"");
  });
}

async function refreshStyleProfiles(){
  const saved=await chrome.storage.local.get(["styleProfiles","activeStyleProfileId","styleProfileStatus"]);
  renderStyleProfileOptions(saved.styleProfiles||{},saved.activeStyleProfileId||"");
  if(styleProfileStatus && saved.styleProfileStatus)styleProfileStatus.textContent=saved.styleProfileStatus;
  return saved;
}

async function setActiveStyleProfile(id){
  const activeId=styleProfileCache[id]?id:"";
  styleProfileSelects.forEach(select=>{select.value=activeId;});
  await chrome.storage.local.set({activeStyleProfileId:activeId,styleProfileStatus:activeId?t("p.profileUsing",{name:styleProfileCache[activeId]?.name||activeId}):t("p.profileOff")});
}

styleProfileSelects.forEach(select=>select.addEventListener("change",()=>setActiveStyleProfile(select.value)));
refreshStyleProfilesBtn.onclick=()=>refreshStyleProfiles();

createStyleProfileBtn.onclick=async()=>{
  const oldText=createStyleProfileBtn.innerHTML;
  createStyleProfileBtn.disabled=true;
  styleProfileStatus.textContent=t("p.fetchingPosts");
  try{
    // Ưu tiên lấy bài từ chính các nguồn/kiểu đã chọn ở panel "Chọn nguồn & kiểu".
    let posts=[];
    try{ posts = await collectStyleLearningPosts(); }catch(_){ posts=[]; }
    if(posts.length<3){
      let stored=await chrome.storage.local.get("scrapePosts"),fallbackPosts=Array.isArray(stored.scrapePosts)?stored.scrapePosts:[];
      if(fallbackPosts.length<3){
        const tab=await getActiveTab();
        if(tab?.id){
          const response=await new Promise(resolve=>chrome.tabs.sendMessage(tab.id,{action:"getScrapeData"},res=>resolve(chrome.runtime.lastError?null:res)));
          if(response?.ok&&Array.isArray(response.posts))fallbackPosts=response.posts;
        }
      }
      posts=fallbackPosts;
    }
    if(posts.length<3)throw new Error(t("p.needPosts"));
    const name=styleProfileName.value.trim()||t("st.defaultName");
    const classes=await sldReadClassIds();
    const approxTokens=Math.max(1,Math.ceil(posts.reduce((n,p)=>n+String(p?.text||"").length,0)/3.5));
    styleProfileStatus.textContent=t("p.digesting",{n:posts.length,tokens:approxTokens});
    const result=await chrome.runtime.sendMessage({action:"aiBuildStyleProfile",posts:posts.slice(-500),name,classes,aiConfig:await getAiProfileFor("styleLearn")});
    if(!result?.ok)throw new Error(result?.error||t("p.profileFail"));
    const tokens=result.profile?.digest?.estimatedTokens||approxTokens;
    styleProfileStatus.textContent=t("p.profileBuilt",{name:result.profile?.name||name,n:result.profile?.sampleCount||posts.length})+t("p.digestTokens",{tokens});
    await refreshStyleProfiles();
  }catch(error){styleProfileStatus.textContent=t("p.profileErr",{err:error.message||error});}
  finally{createStyleProfileBtn.disabled=false;createStyleProfileBtn.innerHTML=oldText;}
};

deleteStyleProfileBtn.onclick=async()=>{
  const active=(await chrome.storage.local.get("activeStyleProfileId")).activeStyleProfileId||styleProfileSelects[0]?.value||"";
  if(!active||!styleProfileCache[active]){styleProfileStatus.textContent=t("p.needProfile");return;}
  if(!confirm(t("p.profileConfirmDel",{name:styleProfileCache[active].name||active})))return;
  const profiles={...styleProfileCache};delete profiles[active];
  await chrome.storage.local.set({styleProfiles:profiles,activeStyleProfileId:"",styleProfileStatus:t("p.profileDeleted")});
  await refreshStyleProfiles();
};

refreshStyleProfiles();
chrome.storage.onChanged.addListener(changes=>{
  if(changes.styleProfiles||changes.activeStyleProfileId||changes.styleProfileStatus)refreshStyleProfiles();
});

// CHỌN NGUỒN & KIỂU BÀI CHO HỌC VĂN PHONG (dùng chung toàn dự án).
function scrapeStoreMessage(message){return new Promise(resolve=>chrome.runtime.sendMessage(message,response=>resolve(response||{ok:false})));}
function sldEsc(value){return String(value||"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));}

let sldDatasetsCache=[];

async function sldLoadConfig(){
  const saved=await chrome.storage.sync.get("styleLearningConfig");
  const cfg=saved.styleLearningConfig||{};
  const classes=new Set(Array.isArray(cfg.contentClasses)?cfg.contentClasses:["text","textBg","photo","video"]);
  $("sldClassText").checked=classes.has("text");
  $("sldClassTextBg").checked=classes.has("textBg");
  $("sldClassPhoto").checked=classes.has("photo");
  $("sldClassVideo").checked=classes.has("video");
  try{ sldRefreshPresets(); }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  return cfg;
}

async function sldSaveConfig(patch){
  const saved=await chrome.storage.sync.get("styleLearningConfig");
  const cfg=saved.styleLearningConfig||{};
  await chrome.storage.sync.set({styleLearningConfig:{...cfg,...patch}});
}

async function sldReadClassIds(){
  return [( $("sldClassText").checked?"text":""),($("sldClassTextBg").checked?"textBg":""),($("sldClassPhoto").checked?"photo":""),($("sldClassVideo").checked?"video":"")].filter(Boolean);
}

function updateSldEstimate(){
  const el=$("sldEstimate");if(!el)return;
  const selectedIds=new Set([...$("sldDataSources").querySelectorAll(".sld-source-check:checked")].map(i=>i.value));
  const classes=[($("sldClassText").checked?"text":""),($("sldClassTextBg").checked?"textBg":""),($("sldClassPhoto").checked?"photo":""),($("sldClassVideo").checked?"video":"")].filter(Boolean);
  let posts=0;
  sldDatasetsCache.filter(d=>selectedIds.has(String(d.id))).forEach(d=>{
    const c=d.contentClassCounts||{};
    classes.forEach(k=>{ posts+=Number(c[k])||0; });
  });
  if(!posts){ el.textContent=t("sld.estEmpty"); }
  else el.textContent=t("sld.est",{n:posts,tokens:Math.max(1,Math.round(posts*40))});
  try{ sldRefreshPresets(); }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
}

async function refreshSldDataSources(){
  sldStatus.textContent="";
  const saved=await chrome.storage.sync.get("styleLearningConfig");
  const selected=new Set(Array.isArray(saved.styleLearningConfig?.datasetIds)?saved.styleLearningConfig.datasetIds:[]);
  const res=await scrapeStoreMessage({action:"scrapeStore",op:"list",store:"datasets",limit:500});
  const datasets=(res?.ok&&Array.isArray(res.values)?res.values:[]).sort((a,b)=>(Number(b?.updatedAt)||0)-(Number(a?.updatedAt)||0));
  sldDatasetsCache=datasets;
  if(!datasets.length){
    $("sldDataSources").innerHTML='<div class="hint" style="padding:6px">'+t("sld.noData")+'</div>';
    return;
  }
  $("sldDataSources").innerHTML=datasets.map(ds=>{
    const id=String(ds.id||""),name=String(ds.sourceTitle||ds.sourceKey||id);
    const c=ds.contentClassCounts||{};
    const when=ds.updatedAt?new Date(Number(ds.updatedAt)).toLocaleString():"";
    const meta=(ds.postCount||0)+" bài"+(when?" · "+sldEsc(when):"");
    const badge=(cls,label,n)=>'<span class="sld-badge '+cls+(n?"":" zero")+'">'+sldEsc(label)+" "+(n||0)+'</span>';
    const badges=badge("text",t("lib.fText"),c.text)+badge("textBg",t("lib.fTextBg"),c.textBg)+badge("photo",t("lib.fPhoto"),c.photo)+badge("video",t("lib.fVideo"),c.video);
    return '<div class="sld-row">'
      +'<label>'
      +'<input class="sld-source-check" type="checkbox" value="'+sldEsc(id)+'" '+(selected.has(id)?"checked":"")+'>'
      +'<span class="sld-info">'
      +'<span class="sld-name">'+sldEsc(name)+'</span>'
      +'<span class="sld-badges">'+badges+'</span>'
      +'<span class="sld-meta">'+meta+'</span>'
      +'</span>'
      +'</label>'
      +'<span class="sld-actions">'
      +'<button type="button" class="sld-view-btn" data-id="'+sldEsc(id)+'" title="'+t("sld.view")+'" style="background:#f3e9ff;color:#6a1b9a">👁 '+t("sld.view")+'</button>'
      +'<button type="button" class="sld-dl-btn" data-id="'+sldEsc(id)+'" title="'+t("sld.dl")+'" style="background:#e7f3ff;color:#0866ff">⬇</button>'
      +'<button type="button" class="sld-del-btn" data-id="'+sldEsc(id)+'" title="'+t("sld.del")+'" style="background:#ffebe6;color:#c0392b">🗑</button>'
      +'</span>'
      +'</div>';
  }).join("");
  bindSldListHandlers();
  updateSldEstimate();
}

function bindSldListHandlers(){
  $("sldDataSources").querySelectorAll(".sld-source-check").forEach(input=>{
    input.addEventListener("change",async()=>{
      const checked=[...$("sldDataSources").querySelectorAll(".sld-source-check:checked")].map(i=>i.value);
      await sldSaveConfig({datasetIds:checked});
      sldStatus.textContent=t("sld.saved");
      updateSldEstimate();
    });
  });
  $("sldDataSources").querySelectorAll(".sld-del-btn").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const id=btn.dataset.id;
      const ds=sldDatasetsCache.find(d=>String(d.id)===id);
      const label=String(ds?.sourceTitle||ds?.sourceKey||id);
      if(!confirm(t("sld.confirmDel",{name:label})))return;
      const r1=await scrapeStoreMessage({action:"scrapeStore",op:"remove",store:"datasets",id});
      await scrapeStoreMessage({action:"scrapeStore",op:"removePosts",datasetId:id});
      await scrapeStoreMessage({action:"scrapeStore",op:"removeMedia",datasetId:id});
      if(r1?.ok){ sldStatus.textContent=t("sld.deleted"); }
      else { sldStatus.textContent=t("sld.exportErr",{err:r1?.error||""}); }
      // bỏ nguồn vừa xóa khỏi config đã chọn
      const saved=await chrome.storage.sync.get("styleLearningConfig");
      const ids=(saved.styleLearningConfig?.datasetIds||[]).filter(x=>x!==id);
      await sldSaveConfig({datasetIds:ids});
      await refreshSldDataSources();
    });
  });
  $("sldDataSources").querySelectorAll(".sld-dl-btn").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const id=btn.dataset.id;
      try{ await exportDataset(id,"json"); sldStatus.textContent=t("sld.downloaded"); }
      catch(e){ sldStatus.textContent=t("sld.exportErr",{err:e?.message||e}); }
    });
  });
  // Panel này chỉ liệt kê nguồn (không đủ chỗ hiện chi tiết từng bài) — bấm
  // "Xem" mở thẳng đúng dataset trong Kho dữ liệu, nơi xem được từng bài,
  // ảnh/video đã lưu và chọn bài cụ thể cho AI học văn phong.
  $("sldDataSources").querySelectorAll(".sld-view-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const id=btn.dataset.id;
      chrome.tabs.create({url:chrome.runtime.getURL("library.html")+"?ds="+encodeURIComponent(id)});
    });
  });
}

// Gom bài từ các nguồn/kiểu đã chọn để đưa vào Gemini học văn phong.
async function collectStyleLearningPosts(){
  const saved=await chrome.storage.sync.get("styleLearningConfig");
  const cfg=saved.styleLearningConfig||{};
  const ids=Array.isArray(cfg.datasetIds)?cfg.datasetIds:[];
  const classes=new Set(Array.isArray(cfg.contentClasses)&&cfg.contentClasses.length?cfg.contentClasses:["text","textBg","photo","video"]);
  const out=[];
  for(const id of ids){
    const r=await scrapeStoreMessage({action:"scrapeStore",op:"listPosts",datasetId:id,limit:5000});
    if(r?.ok&&Array.isArray(r.values)){
      r.values.forEach(p=>{
        if(!p)return;
        const c=String(p.contentClass||"text");
        if(classes.has(c))out.push(p);
      });
    }
  }
  return out;
}

// Tải dataset đã lưu xuống JSON (popup có Blob/URL.createObjectURL nên đơn giản,
// không cần qua debugger/offscreen).
async function exportDataset(datasetId,format="json"){
  const dsRes=await scrapeStoreMessage({action:"scrapeStore",op:"get",store:"datasets",id:datasetId});
  const ds=dsRes?.ok?dsRes.value:null;
  const pRes=await scrapeStoreMessage({action:"scrapeStore",op:"listPosts",datasetId,limit:20000});
  const posts=pRes?.ok&&Array.isArray(pRes.values)?pRes.values:[];
  const src=String(ds?.sourceUrl||datasetId);
  const name=(String(ds?.sourceTitle||"facebook").replace(/[^\p{L}\p{N}_-]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,50))||"facebook";
  const ts=new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
  let content,mime,ext;
  if(format==="md"){
    content=generateDatasetMD(src,name,posts,ts); mime="text/markdown"; ext="md";
  }else if(format==="txt"){
    content=generateDatasetTXT(src,name,posts); mime="text/plain"; ext="txt";
  }else{
    content=JSON.stringify({source:src,datasetId:datasetId,exportedAt:new Date().toISOString(),count:posts.length,dataset:ds,posts},null,2);
    mime="application/json"; ext="json";
  }
  const filename=`fb_scan_${name}_${ts}.${ext}`;
  const blob=new Blob([content],{type:mime+";charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return filename;
}

function generateDatasetMD(src,name,posts,ts){
  let md=t("sld.mdTitle",{d:new Date().toLocaleString(I18N_LANG==="en"?"en-US":"vi-VN")})+"\n";
  md+=t("sld.mdHead",{src:src,n:posts.length});
  posts.forEach((p,i)=>{
    md+=`## ${i+1}. ${p.author||""}${p.time?" - "+p.time:""}\n\n`;
    md+=(p.link?`Link: ${p.link}\n\n`:"")+`${(p.text||"").replace(/\s{2,}/g," ").trim()}\n\n`;
    if(Array.isArray(p.images)&&p.images.length)p.images.forEach(img=>md+=`![${t("sc.imgAlt")}](${img})\n`);
    md+="\n---\n\n";
  });
  return md;
}
function generateDatasetTXT(src,name,posts){
  const header=`Nguon cao: ${src}\nTieu de nguon: ${name}\nSo bai: ${posts.length}\n\n`;
  return header+posts.map((p,i)=>`=== Bai ${i+1} ===\nTac gia: ${p.author||""}\nThoi gian: ${p.time||""}\nLink: ${p.link||""}\nNoi dung:\n${p.text||""}\n`).join("\n----------------\n\n");
}

const sldStatus=$("sldStatus");
$("sldRefreshBtn").onclick=()=>refreshSldDataSources();
// Preset 1 chạm: "Chỉ bài viết" = text dài + nền màu (bỏ caption ảnh/video),
// "Tất cả" = cả 4 kiểu, "Tùy chỉnh" = giữ nguyên để tick tay từng kiểu.
async function sldApplyClasses(classes){
  $("sldClassText").checked=classes.includes("text");
  $("sldClassTextBg").checked=classes.includes("textBg");
  $("sldClassPhoto").checked=classes.includes("photo");
  $("sldClassVideo").checked=classes.includes("video");
  await sldSaveConfig({contentClasses:[...classes]});
  sldStatus.textContent=t("sld.saved");
  updateSldEstimate();
}
$("sldPresetText").onclick=()=>sldApplyClasses(["text","textBg"]);
$("sldPresetAll").onclick=()=>sldApplyClasses(["text","textBg","photo","video"]);
$("sldPresetCustom").onclick=()=>{sldStatus.textContent=t("sld.saved");};
// Đếm live theo nguồn đã tick: preset + từng kiểu hiện đúng số bài sẽ học.
function sldSelectedClassCounts(){
  const selectedIds=new Set([...$("sldDataSources").querySelectorAll(".sld-source-check:checked")].map(i=>i.value));
  const counts={text:0,textBg:0,photo:0,video:0};
  sldDatasetsCache.filter(d=>selectedIds.has(String(d.id))).forEach(d=>{
    const c=d.contentClassCounts||{};
    for(const k of Object.keys(counts))counts[k]+=Number(c[k])||0;
  });
  return counts;
}
function sldRefreshPresets(){
  const counts=sldSelectedClassCounts();
  document.querySelectorAll("[data-sld-count]").forEach(el=>{el.textContent=counts[el.dataset.sldCount]||0;});
  const on=id=>{const el=$(id);return !!(el&&el.checked);};
  const classOf={sldClassText:"text",sldClassTextBg:"textBg",sldClassPhoto:"photo",sldClassVideo:"video"};
  const curTotal=Object.entries(classOf).reduce((n,[id,k])=>n+(on(id)?counts[k]:0),0);
  const checkedCount=Object.keys(classOf).filter(on).length;
  const setN=(k,v)=>{const el=document.querySelector(`[data-sld-preset-n="${k}"]`);if(el)el.textContent=v;};
  setN("text",counts.text+counts.textBg);
  setN("all",counts.text+counts.textBg+counts.photo+counts.video);
  setN("custom",curTotal);
  const isText=on("sldClassText")&&on("sldClassTextBg")&&!on("sldClassPhoto")&&!on("sldClassVideo");
  const isAll=checkedCount===4;
  const presetText=$("sldPresetText"),presetAll=$("sldPresetAll"),presetCustom=$("sldPresetCustom");
  if(presetText)presetText.classList.toggle("active",isText);
  if(presetAll)presetAll.classList.toggle("active",isAll);
  if(presetCustom)presetCustom.classList.toggle("active",!isText&&!isAll);
}
["sldClassText","sldClassTextBg","sldClassPhoto","sldClassVideo"].forEach(id=>{
  $(id).addEventListener("change",async()=>{
    const classes=await sldReadClassIds();
    await sldSaveConfig({contentClasses:classes});
    sldStatus.textContent=t("sld.saved");
    updateSldEstimate();
  });
});
sldLoadConfig();
refreshSldDataSources();

let isAICommenting=false;
function setAIRunning(v){ isAICommenting=v; aiStartBtn.textContent=v?t("p.aiBusy"):t("fd.start"); aiStartBtn.classList.toggle("running",v); }
aiStartBtn.onclick = async ()=>{
  await tagSectionsReady;
  const shareRun=await chrome.storage.local.get(["groupShareActive","salesPostActive","trendLearnActive","trendPostActive","pageGroupJoinActive","pageGroupPostActive","pageCommentActive","pageSalesPostActive",...FEED_SCOPED_ACTIVE_KEYS]);if(Object.values(shareRun).some(Boolean)){aiStatus.textContent=(shareRun.pageGroupJoinActive||shareRun.pageGroupPostActive||shareRun.pageCommentActive||shareRun.pageSalesPostActive||FEED_SCOPED_ACTIVE_KEYS.some(key=>shareRun[key]))?t("pg.busyOther"):t("p.shBusyAi");return;}
  const typingConfig=await saveAiTypingSettings(getAiTypingControl("aiFeed"));
  const _mode=aiActionMode?.value||"comment";
  const _isComment=_mode==="comment"||_mode==="comment-like";
  const prompt = aiPrompt.value.trim();
  if(_isComment&&!prompt.includes("{postText}")){ aiStatus.textContent=t("p.aiNeedPrompt"); return; }
  // Prompt thường cho nhánh comment không-tag: khi đang bật tag, textarea hiện
  // prompt tag nên phải lấy bản thường từ kho đã lưu (trước đây content script
  // không mang theo nên background luôn dùng prompt legacy toàn cục — bài tab
  // cấu hình bị bỏ qua, comment kém bám sát).
  const tagOnNow=!!document.getElementById("aiTagEnabled")?.checked;
  let basePrompt=prompt;
  if(_isComment&&tagOnNow){
    let saved="";
    try{saved=String((await chrome.storage.sync.get(["aiPrompt"])).aiPrompt||"");}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    basePrompt=saved.includes("{postText}")?saved:t("fd.aiPromptDefault");
  }
  if(_isComment&&!basePrompt.includes("{postText}")){ aiStatus.textContent=t("p.aiNeedPrompt"); return; }
  if(_isComment&&document.getElementById("aiTagEnabled")?.checked&&!prompt.includes("{tagName}"))aiStatus.textContent="⚠️ Prompt tag chưa có {tagName} — AI sẽ không nhúng tên vào comment (chỉ gắn @tag). Thêm {tagName} vào prompt tag để comment tự nhiên hơn.";
  // Ô nhập cũ giữ để sửa nhanh default; lượt chạy dùng hồ sơ đã gán cho aiFeed.
  const aiProf=await getAiProfileFor("aiFeed");
  if(_isComment&&aiKeyRequired(aiProf)&&!aiProf.key){ aiStatus.textContent=t("p.aiNeedKeyFor",{p:aiProf.provider}); return; }
  if(_isComment&&aiKeyRequired(aiProf)&&!aiProf.model){ aiStatus.textContent=t("p.aiNeedModel"); return; }
  const aiTagEnabled=document.getElementById("aiTagEnabled");
  const aiRunMode=["comment-like","like","comment"].includes(aiActionMode?.value)?aiActionMode.value:"comment";
  const cfg={ mode:aiRunMode, reaction:aiReaction?.value||"like", target: parseInt(aiTarget.value)||10, minDelay: parseInt(aiMinDelay.value)||10, maxDelay: parseInt(aiMaxDelay.value)||20,economyMode:aiEconomyMode.value,batchSize:Math.max(2,parseInt(aiBatchSize.value)||5),cacheDays:Math.max(0,parseInt(aiCacheDays.value)||7),typingConfig,prompt:basePrompt,tagConfig:tagSections["ai"]?.getTagConfig(!!aiTagEnabled?.checked)||null,aiConfig:{provider:aiProf.provider,key:aiProf.key,model:aiProf.model,url:aiProf.url} };
  if(cfg.minDelay>cfg.maxDelay){ aiStatus.textContent=t("p.delayBad"); return; }
  chrome.storage.sync.set({ aiTarget:cfg.target, aiMinDelay:cfg.minDelay, aiMaxDelay:cfg.maxDelay,aiEconomyMode:cfg.economyMode,aiBatchSize:cfg.batchSize,aiCacheDays:cfg.cacheDays,aiActionMode:cfg.mode });
  setAIRunning(true);
  let tab=await ensureTaskTab(
    "https://www.facebook.com/",
    aiStatus,
    t("p.aiOpening"),
    isPopupMainFeedUrl,
    async owner=>{
      // A new Start resets only its own counter; reload-resume never reaches
      // this callback, so the in-progress count remains intact.
      await chrome.storage.local.set({isAICommenting:true,pendingAIComment:true,pendingAIConfig:{...cfg,ownerTabId:owner.id},aiCount:0,aiFeedReloadAttempts:0,aiStatus:t("p.aiOpening")});
    }
  );if(!tab){setAIRunning(false);await chrome.storage.local.set({isAICommenting:false});await chrome.storage.local.remove(["pendingAIComment","pendingAIConfig"]);return;}
  chrome.tabs.sendMessage(tab.id, {action:"startAIComment", ...cfg,ownerTabId:tab.id}, async res=>{
    if(chrome.runtime.lastError){
      const retry = await autoReloadAndRetry(tab.id, {action:"startAIComment", ...cfg,ownerTabId:tab.id}, aiStatus);
      if(retry.ok){ setAIRunning(true); aiStatus.textContent=t("p.aiRunning",{n:cfg.target}); }
      else if(await runStillActive("isAICommenting")||await runStillActive("pendingAIComment")){setAIRunning(true);aiStatus.textContent=t("p.aiRunning",{n:cfg.target});}
      else{await chrome.storage.local.remove(["pendingAIComment","pendingAIConfig"]);setAIRunning(false);aiStatus.textContent=retry.res?.error||t("p.aiStartFail");}
      return;
    }
    if(res&&res.ok){ setAIRunning(true); aiStatus.textContent=t("p.aiRunning",{n:cfg.target}); }
    else if(await runStillActive("isAICommenting")){ setAIRunning(true); aiStatus.textContent=t("p.aiRunning",{n:cfg.target}); }
    else{await chrome.storage.local.remove(["pendingAIComment","pendingAIConfig"]);setAIRunning(false);aiStatus.textContent=res?.error||t("p.aiStartFail");}
  });
};
aiStopBtn.onclick = async ()=>{ setAIRunning(false); await chrome.storage.local.set({isAICommenting:false,aiStatus:t("p.stoppedX"),aiActiveConfig:null,aiNextAllowedAt:0,pendingAIComment:false,aiFeedReloadAttempts:0}); const tab=await getActiveTab(); if(tab)chrome.tabs.sendMessage(tab.id,{action:"stopAIComment"},()=>{}); broadcastToFacebookTabs({action:"stopAIComment"}); };
aiResetBtn.onclick = async ()=>{ const _rm=aiActionMode?.value||"comment";const _isLikeR=_rm==="like"||_rm==="comment-like";const _isCmtR=_rm==="comment"||_rm==="comment-like";setAIRunning(false); if(aiCountEl)aiCountEl.textContent=_isCmtR?`0 / ${parseInt(aiTarget.value)||10}`:"—"; if(aiLikeCountEl)aiLikeCountEl.textContent=_isLikeR?`0 / ${parseInt(aiTarget.value)||10}`:"—"; await chrome.storage.local.set({aiCount:0,aiStatus:t("p.resetDone"),isAICommenting:false,aiActiveConfig:null,pendingAIComment:false,aiNextAllowedAt:0,aiFeedReloadAttempts:0}); const tab=await getActiveTab(); if(tab)chrome.tabs.sendMessage(tab.id,{action:"resetAIComment"},()=>{}); broadcastToFacebookTabs({action:"resetAIComment"}); };
if(aiScanBtn)aiScanBtn.onclick=async()=>{const tab=await getActiveTab();if(!tab||!tab.url?.includes("facebook.com")){aiStatus.textContent=t("p.fdNeedFb");return;}chrome.tabs.sendMessage(tab.id,{action:"scanFeedScope",source:"all",actionMode:"comment"},res=>{if(chrome.runtime.lastError){aiStatus.textContent=t("p.reloadRetry");return;}aiStatus.textContent=t("p.fdScanOk",{n:res?.count||0});});};
chrome.storage.sync.get(["aiProvider","aiPrompt","aiTagPrompt","aiTarget","aiMinDelay","aiMaxDelay","aiKeys","aiEconomyMode","aiBatchSize","aiCacheDays","aiTagEnabled","aiActionMode"], res=>{
  if(res.aiActionMode&&aiActionMode)aiActionMode.value=["comment-like","like","comment"].includes(res.aiActionMode)?res.aiActionMode:"comment";
  if(res.aiTarget) aiTarget.value=res.aiTarget;
  if(res.aiMinDelay) aiMinDelay.value=res.aiMinDelay;
  if(res.aiMaxDelay) aiMaxDelay.value=res.aiMaxDelay;
  if(res.aiEconomyMode)aiEconomyMode.value=res.aiEconomyMode;
  if(res.aiBatchSize)aiBatchSize.value=res.aiBatchSize;
  if(res.aiCacheDays!==undefined)aiCacheDays.value=res.aiCacheDays;
  if(res.aiTagEnabled){const el=document.getElementById("aiTagEnabled");if(el)el.checked=true;if(aiPrompt)aiPrompt.value=res.aiTagPrompt||t("fd.aiTagPromptDefault");}else if(aiPrompt){const _sp=res.aiPrompt;if(_sp&&!_sp.includes("{tagName}"))aiPrompt.value=_sp;else if(aiPrompt.value.includes("{tagName}"))aiPrompt.value=t("fd.aiPromptDefault");}
  // aiKeys se load trong updateAiDesc
  aiCountEl.textContent=`0 / ${parseInt(aiTarget.value)||10}`;
  renderAiFeedMode();
});
document.getElementById("aiTagEnabled")?.addEventListener("change",e=>{
  chrome.storage.sync.set({aiTagEnabled:e.target.checked});
  if(aiPrompt){if(e.target.checked){if(!aiPrompt.value.includes("{tagName}"))chrome.storage.sync.set({aiPrompt:aiPrompt.value});chrome.storage.sync.get(["aiTagPrompt"],r=>{const s=r.aiTagPrompt;aiPrompt.value=(s&&s.includes("{tagName}"))?s:t("fd.aiTagPromptDefault");});}else{if(aiPrompt.value.includes("{tagName}"))chrome.storage.sync.set({aiTagPrompt:aiPrompt.value});chrome.storage.sync.get(["aiPrompt"],r=>{const s=r.aiPrompt;aiPrompt.value=(s&&!s.includes("{tagName}"))?s:t("fd.aiPromptDefault");})}}
});
chrome.storage.local.get(["aiStatus","aiCount","isAICommenting"], res=>{
  if(res.aiStatus) aiStatus.textContent=res.aiStatus;
  if(res.aiCount!==undefined){const n=res.aiCount,tgt=parseInt(aiTarget.value)||10,md=aiActionMode?.value;if(md==="comment"||md==="comment-like")aiCountEl.textContent=`${n} / ${tgt}`;else if(aiCountEl)aiCountEl.textContent="—";if(aiLikeCountEl)aiLikeCountEl.textContent=(md==="comment-like"||md==="like")?`${n} / ${tgt}`:"—";}
  if(res.isAICommenting) setAIRunning(true);
});
chrome.storage.onChanged.addListener(changes=>{
  if(changes.aiStatus) aiStatus.textContent=changes.aiStatus.newValue;
  if(changes.aiCount!==undefined){const n=changes.aiCount.newValue,tgt=parseInt(aiTarget.value)||10,md=aiActionMode?.value;if(md==="comment"||md==="comment-like")aiCountEl.textContent=`${n} / ${tgt}`;else if(aiCountEl)aiCountEl.textContent="—";if(aiLikeCountEl)aiLikeCountEl.textContent=(md==="comment-like"||md==="like")?`${n} / ${tgt}`:"—";}
  if(changes.isAICommenting!==undefined) setAIRunning(changes.isAICommenting.newValue);
});
aiTarget.addEventListener("change", ()=>{ const tgt=parseInt(aiTarget.value)||10,md=aiActionMode?.value;if(md==="comment"||md==="comment-like")aiCountEl.textContent=`0 / ${tgt}`;else if(aiCountEl)aiCountEl.textContent="—";if(aiLikeCountEl)aiLikeCountEl.textContent=(md==="comment-like"||md==="like")?`0 / ${tgt}`:"—"; });

// ICON SVG cho nút/tab — thay emoji đầu nút bằng icon nét mảnh đồng bộ.
// Chạy 1 lần khi mở popup + tự gắn lại mỗi khi JS đổi text nút (observer).
const ICON_MAP={"🤝":"i-users","📄":"i-file","👥":"i-layers","🔁":"i-repeat","📰":"i-news","▶":"i-play","⏹":"i-stop","⏳":"i-load","↺":"i-reset","🔍":"i-search","🔎":"i-search","☑":"i-checksq","☐":"i-square","🔄":"i-refresh","🧪":"i-flask","👁":"i-eye","✨":"i-spark","🤖":"i-spark","⬇":"i-down","🗑":"i-trash","🧹":"i-x","💬":"i-send","🧭":"i-compass"};
const ICON_KEYS=Object.keys(ICON_MAP).sort((a,b)=>b.length-a.length);
const SVG_NS="http://www.w3.org/2000/svg";
const ICON_SYMBOLS=`<symbol id="i-play" viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20 7 4" fill="currentColor" stroke="none"/></symbol>`
+`<symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/></symbol>`
+`<symbol id="i-load" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></symbol>`
+`<symbol id="i-reset" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></symbol>`
+`<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>`
+`<symbol id="i-checksq" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m9 12 2 2 4-4"/></symbol>`
+`<symbol id="i-square" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5"/></symbol>`
+`<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></symbol>`
+`<symbol id="i-flask" viewBox="0 0 24 24"><path d="M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.5a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5L14.2 10.4a2 2 0 0 1-.2-.9V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></symbol>`
+`<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>`
+`<symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.9 5.8 5.8 1.9-5.8 1.9L12 18.4l-1.9-5.8L4.3 10.7l5.8-1.9L12 3Z"/><path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8L19 3Z"/></symbol>`
+`<symbol id="i-down" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>`
+`<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></symbol>`
+`<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>`
+`<symbol id="i-send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></symbol>`
+`<symbol id="i-compass" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></symbol>`
+`<symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>`
+`<symbol id="i-file" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></symbol>`
+`<symbol id="i-layers" viewBox="0 0 24 24"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></symbol>`
+`<symbol id="i-repeat" viewBox="0 0 24 24"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></symbol>`
+`<symbol id="i-news" viewBox="0 0 24 24"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0V9"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></symbol>`;
function mountIconSprite(){
  if(document.getElementById("fbIconSprite"))return;
  const svg=document.createElementNS(SVG_NS,"svg");
  svg.setAttribute("id","fbIconSprite");
  svg.setAttribute("width","0");svg.setAttribute("height","0");
  svg.setAttribute("aria-hidden","true");
  svg.style.position="absolute";
  const defs=document.createElementNS(SVG_NS,"defs");
  defs.innerHTML=ICON_SYMBOLS;
  svg.appendChild(defs);
  document.body.insertBefore(svg,document.body.firstChild);
}
function iconizeEl(el){
  const node=el.firstChild;
  if(!node||node.nodeType!==3)return;
  const text=node.nodeValue;
  for(const key of ICON_KEYS){
    if(text.startsWith(key)){
      const svg=document.createElementNS(SVG_NS,"svg");
      svg.setAttribute("class","ic"+(key==="⏳"?" spin":""));
      svg.setAttribute("viewBox","0 0 24 24");
      svg.setAttribute("fill","none");
      svg.setAttribute("stroke","currentColor");
      svg.setAttribute("stroke-width","2");
      svg.setAttribute("stroke-linecap","round");
      svg.setAttribute("stroke-linejoin","round");
      svg.setAttribute("aria-hidden","true");
      const use=document.createElementNS(SVG_NS,"use");
      use.setAttribute("href","#"+ICON_MAP[key]);
      svg.appendChild(use);
      node.nodeValue=text.slice(key.length);
      el.insertBefore(svg,node);
      break;
    }
  }
}
function iconize(root=document){
  root.querySelectorAll("button,.tab").forEach(iconizeEl);
}
mountIconSprite();
iconize();
let iconizeQueued=false;
new MutationObserver(()=>{
  if(iconizeQueued)return;
  iconizeQueued=true;
  queueMicrotask(()=>{iconizeQueued=false;try{iconize();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }});
}).observe(document.body,{childList:true,characterData:true,subtree:true});

// LỊCH CHẠY — kho lịch tập trung. Lịch chỉ chứa snapshot cấu hình không
// nhạy cảm; background lấy AI profile thống nhất đúng lúc chạy nếu cần.
const scheduleFeature=$("scheduleFeature"),scheduleWhen=$("scheduleWhen"),scheduleCreateBtn=$("scheduleCreateBtn"),scheduleStatus=$("scheduleStatus"),scheduleList=$("scheduleList");
const scheduleChainPicker=$("scheduleChainPicker"),scheduleChainWhen=$("scheduleChainWhen"),scheduleChainGap=$("scheduleChainGap"),scheduleChainOnFailure=$("scheduleChainOnFailure"),scheduleChainCreateBtn=$("scheduleChainCreateBtn"),scheduleChainStatus=$("scheduleChainStatus"),scheduleChainList=$("scheduleChainList");
const scheduleChainStopWarn=$("scheduleChainStopWarn");
if(scheduleChainOnFailure&&scheduleChainStopWarn){
  const updateStopWarn=()=>{scheduleChainStopWarn.style.display=scheduleChainOnFailure.value==="stop"?"":"none";};
  scheduleChainOnFailure.addEventListener("change",updateStopWarn);
  updateStopWarn();
}
const groupScheduleWhen=$("groupScheduleWhen"),groupScheduleBtn=$("groupScheduleBtn"),groupScheduleStatus=$("groupScheduleStatus");
const discoverScheduleWhen=$("discoverScheduleWhen"),discoverScheduleBtn=$("discoverScheduleBtn"),discoverScheduleStatus=$("discoverScheduleStatus");
const inlineScheduleBindings=[
  {feature:"friend",when:"friendScheduleWhen",button:"friendScheduleBtn",status:"friendScheduleStatus"},
  {feature:"scrape",when:"scrapeScheduleWhen",button:"scrapeScheduleBtn",status:"scrapeScheduleStatus"},
  {feature:"feed",when:"feedScheduleWhen",button:"feedScheduleBtn",status:"feedScheduleStatus"},
  {feature:"aiFeed",when:"aiFeedScheduleWhen",button:"aiFeedScheduleBtn",status:"aiFeedScheduleStatus"},
  {feature:"groupInteract",when:"groupInteractScheduleWhen",button:"groupInteractScheduleBtn",status:"groupInteractScheduleStatus"},
  {feature:"groupComment",when:"groupCommentScheduleWhen",button:"groupCommentScheduleBtn",status:"groupCommentScheduleStatus"},
  {feature:"groupPost",when:"groupPostScheduleWhen",button:"groupPostScheduleBtn",status:"groupPostScheduleStatus"},
  {feature:"share",when:"shareScheduleWhen",button:"shareScheduleBtn",status:"shareScheduleStatus"},
  {feature:"sales",when:"salesScheduleWhen",button:"salesScheduleBtn",status:"salesScheduleStatus"},
  {feature:"trendLearn",when:"trendLearnScheduleWhen",button:"trendLearnScheduleBtn",status:"trendLearnScheduleStatus"},
  {feature:"trendPost",when:"trendPostScheduleWhen",button:"trendPostScheduleBtn",status:"trendPostScheduleStatus"}
];
const scheduleDateText=value=>{
  const time=Number(value)||0;
  if(!time)return t("sch.unknownTime");
  try{return new Intl.DateTimeFormat(I18N_LANG||"vi",{dateStyle:"medium",timeStyle:"short"}).format(new Date(time));}catch{return new Date(time).toLocaleString();}
};
const scheduleFeatureLabel=feature=>t(`sch.feature.${feature}`)||feature;
const scheduleErrorText=error=>t("sch.error",{error:String(error||t("sch.unknownTime"))});
function scheduleGroupValue(group={}){
  const url=canonicalFacebookUrl(group.url||"");
  if(!url)return null;
  return {id:String(group.id||""),name:String(group.name||group.id||"Nhóm Facebook").trim().slice(0,180),url,manualLink:!!group.manualLink,explicitName:!!group.explicitName};
}
function scheduleGroupValues(groups=[]){return (Array.isArray(groups)?groups:[]).map(scheduleGroupValue).filter(Boolean);}
function schedulePageValue(page){
  if(!page?.url)return null;
  const url=canonicalFacebookUrl(page.url);if(!url)return null;
  return {id:String(page.id||"").slice(0,180),name:String(page.name||"Trang Facebook").trim().slice(0,180),url};
}
async function scheduleSelectedPage(){
  let page=selectedManagedPage;
  if(!page){
    const saved=await chrome.storage.sync.get("pageSelected");page=saved.pageSelected||null;
  }
  if(!page){
    const saved=await chrome.storage.local.get("managedPages");page=Array.isArray(saved.managedPages)?saved.managedPages[0]:null;
  }
  const safe=schedulePageValue(page);if(!safe)throw new Error(t("sch.needPage"));
  return safe;
}
async function scheduleSnapshot(feature,opts){
  if(feature==="keyword"){
    const keyword=String(groupKeyword?.value||"").trim();
    const defT=Math.max(1,parseInt(groupTarget?.value)||10);
    const listed=parseNickKeywordList(defT);
    if(String(groupKeywordList?.value||"").trim()&&!listed.length)throw new Error(t("p.gjNeedKeyword"));
    if(!keyword&&!listed.length)throw new Error(t("sch.needKeyword"));
    const keywords=listed.length?listed:(keyword?[{keyword,target:defT}]:[]);
    const firstKw=keywords.length?keywords[0].keyword:keyword;
    return {feature,label:scheduleFeatureLabel(feature),config:{keyword:firstKw,keywords,minMembers:Math.max(0,parseInt(groupMinMembers?.value)||0),minPostsPerDay:Math.max(0,parseInt(groupMinPosts?.value)||0),targetJoin:keywords.length?keywords[0].target:defT,minDelay:Math.max(1,parseInt(groupMinDelay?.value)||5),maxDelay:Math.max(1,parseInt(groupMaxDelay?.value)||15),confirmWaitSeconds:readJoinConfirmSeconds(groupConfirmWait),answersText:String(groupAnswers?.value||"").trim(),aiJoinEnabled:!!groupAiAnswersEnabled?.checked,aiJoinPrompt:String(groupAiAnswersPrompt?.value||"").trim(),typingConfig:getAiTypingConfig("groupJoin")}};
  }
  if(feature==="discover")return {feature,label:scheduleFeatureLabel(feature),config:{target:Math.max(1,parseInt(discoverTarget?.value)||10),minDelay:Math.max(1,parseInt(discoverMinDelay?.value)||5),maxDelay:Math.max(1,parseInt(discoverMaxDelay?.value)||15),confirmWaitSeconds:readJoinConfirmSeconds(discoverConfirmWait),answersText:String(discoverAnswers?.value||"").trim(),aiJoinEnabled:!!groupAiAnswersEnabled?.checked,aiJoinPrompt:String(groupAiAnswersPrompt?.value||"").trim(),typingConfig:getAiTypingConfig("groupJoin")}};
  if(feature==="friend"){
    const raw=saveConfig();
    if(raw.mode==="friend-of-friend"){
      // FoF vào chuỗi/lịch: nguồn link/mine + cấu hình FoF (content tự stream
      // từ nguồn lúc chạy, như bấm Start tay). Bỏ chặn sch.friendFoFUnsupported.
      let source=null;
      if(friendFoFKind==="link"){
        const url=String(friendFoFSourceLink?.value||"").trim();
        if(!url)throw new Error(t("p.frFoFNeedLink"));
        try{
          const host=String(new URL(url).hostname||"").toLowerCase().replace(/\.$/,"");
          if(!(host==="facebook.com"||host.endsWith(".facebook.com")))throw new Error("facebook");
        }catch{throw new Error(t("p.frFoFBadLink"));}
        source={url};
      }else{
        const stored=await chrome.storage.local.get(["friendFoFSelectedSource"]);
        source=stored.friendFoFSelectedSource||null;
        if(!source?.url)throw new Error(t("p.frFoFNeedSource"));
      }
      const fcfg=friendFoFConfig();
      return {feature,label:scheduleFeatureLabel("friendFoF"),config:{...fcfg,source,groups:[]}};
    }
    if(raw.mode==="group-common"&&!raw.groups.length)throw new Error(t("sch.needFriendGroups"));
    return {feature,label:scheduleFeatureLabel(raw.mode==="confirm"?"friendConfirm":"friend"),config:{...raw,groups:scheduleGroupValues(raw.groups)}};
  }
  if(feature==="scrape"){
    const active=await getActiveTab(),source=String(scrapeSourceUrl?.value||"").trim()||(active?.url?.includes("facebook.com")?active.url:"");
    if(!source)throw new Error(t("sch.needScrapeSource"));
    try{new URL(source);}catch{throw new Error(t("p.scBadUrl"));}
    return {feature,label:scheduleFeatureLabel(feature),config:{count:Math.max(1,Math.min(100000,parseInt(scrapeNum?.value)||200)),skipAds:!!scrapeSkipAds?.checked,sourceUrl:source}};
  }
  if(feature==="feed"){
    // opts.feedSource cho phép mỗi thẻ Bạn bè/Nhóm/Page trong tab Bảng feed tự
    // hẹn lịch/thêm vào chuỗi đúng phạm vi của chính nó, không phụ thuộc vào ô
    // "Nguồn chạy" dùng chung ở khối lịch gộp bên dưới.
    const forced=FEED_SCOPE_UI[opts?.feedSource];
    const source=forced||FEED_SCOPE_UI[feedScheduleSource?.value]||FEED_SCOPE_UI.friends,cfg=await feedUiSourceConfig(source);
    const sourceLabel=t(`fd.source${source.id[0].toUpperCase()}${source.id.slice(1)}`);
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${sourceLabel}`,config:{...cfg}};
  }
  if(feature==="aiFeed")return {feature,label:scheduleFeatureLabel(feature),config:{mode:aiActionMode?.value==="comment-like"?"comment-like":"comment",target:Math.max(1,Math.min(100000,parseInt(aiTarget?.value)||10)),minDelay:Math.max(1,parseInt(aiMinDelay?.value)||10),maxDelay:Math.max(1,parseInt(aiMaxDelay?.value)||20),economyMode:aiEconomyMode?.value||"balanced",batchSize:Math.max(2,Math.min(1000,parseInt(aiBatchSize?.value)||5)),cacheDays:Math.max(0,parseInt(aiCacheDays?.value)||7),typingConfig:getAiTypingConfig("aiFeed")}};
  if(feature==="groupInteract"||feature==="groupComment"){
    const selected=scheduleGroupValues(getSelectedJoinedGroups()),limit=Math.max(1,Math.min(100000,parseInt(groupInteractGroupLimit?.value)||1)),groups=selected.slice(0,limit);
    if(!groups.length)throw new Error(t("sch.needJoinedGroups"));
    // Lịch hẹn từ card Tương tác tôn trọng dropdown chế độ: comment hẹn thẳng
    // feature groupComment; both hẹn reaction kèm followup comment.
    const schedMode=feature==="groupInteract"?groupInteractUiMode():"comment";
    const outFeature=(feature==="groupInteract"&&schedMode==="comment")?"groupComment":feature;
    let giPrompt="",giTagPrompt="",giTagConfig=null,giAiConfig;
    if(outFeature==="groupComment"||(feature==="groupInteract"&&schedMode==="both")){
      const _giTagOn=!!commentTagEnabled?.checked;
      const _giShown=String(groupInteractAiPrompt?.value||"").trim();
      giPrompt=_giTagOn?(feedDualPromptCache.groupInteractAiPrompt||t("fd.aiPromptDefault")):_giShown;
      giTagPrompt=_giTagOn?_giShown:(feedDualPromptCache.groupInteractAiTagPrompt||t("fd.aiTagPromptDefault"));
      giTagConfig=tagSections["commentTag"]?.getTagConfig(_giTagOn)||null;
      const _aiU=await getAiProfileFor("groupComment").catch(()=>null);
      if(_aiU?.key&&_aiU?.model)giAiConfig={provider:_aiU.provider,model:_aiU.model,url:_aiU.url};
    }
    const followup=(feature==="groupInteract"&&schedMode==="both")?{
      groups,targetGroups:limit,
      perGroup:Math.max(1,Math.min(100000,parseInt(groupCommentTarget?.value)||3)),
      minDelay:Math.max(1,parseInt(groupCommentMinDelay?.value)||30),
      maxDelay:Math.max(1,parseInt(groupCommentMaxDelay?.value)||60),
      typingConfig:getAiTypingConfig("groupComment"),
      prompt:giPrompt,tagPrompt:giTagPrompt,tagConfig:giTagConfig,aiConfig:giAiConfig
    }:undefined;
    const gcEco=outFeature==="groupComment"?(["max","balanced","personal"].includes(groupCommentEconomyMode?.value)?groupCommentEconomyMode.value:"balanced"):undefined;
    const gcCacheDays=outFeature==="groupComment"?Math.max(0,parseInt(groupCommentCacheDays?.value)||7):undefined;
    return {feature:outFeature,label:scheduleFeatureLabel(outFeature),config:{groups,perGroup:Math.max(1,Math.min(100000,parseInt(groupInteractTarget?.value)||5)),minDelay:Math.max(1,parseInt(groupInteractMinDelay?.value)||5),maxDelay:Math.max(1,parseInt(groupInteractMaxDelay?.value)||12),reaction:groupInteractReaction?.value||"random",targetGroups:limit,typingConfig:outFeature==="groupComment"?getAiTypingConfig("groupComment"):undefined,prompt:giPrompt,tagPrompt:giTagPrompt,tagConfig:giTagConfig,aiConfig:giAiConfig,actionMode:schedMode,economyMode:gcEco,cacheDays:gcCacheDays,...(followup?{followup}:{})}};
  }
  if(feature==="groupPost"){
    // Nguồn tin X (chuỗi/lịch): snapshot user + prompt + ảnh từ card, nhóm đã
    // chọn trên danh sách (thường sau Nạp log theo từ khóa).
    if(groupPostSourceMode()==="x"){
      const users=await groupPostResolveXUsersLive();
      if(!users.length)throw new Error(t("bg.newsNoXUsers"));
      const xp=String(groupPostXPrompt?.value||"").trim()||t("gp.xPromptDefault");
      if(!xp.includes("{newsText}"))throw new Error(t("nw.needNewsText"));
      if(!xp.includes("{groupName}"))throw new Error(t("p.gpNeedPrompt"));
      const xgroups=scheduleGroupValues(selectedPostGroups());
      if(!xgroups.length)throw new Error(t("sch.needPostGroups"));
      const xai=await getAiProfileFor("groupPost");
      if(aiKeyRequired(xai)&&(!xai.key||!xai.model))throw new Error(t("p.gpNeedKeyModel"));
      return {feature,label:`${scheduleFeatureLabel(feature)} — X (${users.length} user)`,config:{groups:enrichGroupPostGroups(xgroups),prompt:String(groupPostPrompt?.value||"").trim(),minDelay:GROUP_POST_AUTO_TIMING.minDelay,maxDelay:GROUP_POST_AUTO_TIMING.maxDelay,interGroupDelay:Math.min(604800,Math.max(5,parseInt(groupPostInterDelay?.value)||30)),background:readGroupPostBackgroundConfig(),typingConfig:getAiTypingConfig("groupPost"),source:{type:"x",users},xPrompt:xp,withXPhoto:groupPostXPhoto?.checked!==false,aiConfig:{provider:xai.provider,model:xai.model,url:xai.url,profileId:xai.profileId||""}}};
    }
    if(groupPostSourceMode()==="web"){
      const webCfg=await groupPostResolveWebConfigLive();
      if(!webCfg.urls.length)throw new Error(t("bg.newsSitesEmpty"));
      if(!webCfg.q)throw new Error(t("bg.newsNoKeyword"));
      const wp=String(groupPostWebPrompt?.value||"").trim()||t("gp.webPromptDefault");
      if(!wp.includes("{newsText}"))throw new Error(t("nw.needNewsText"));
      if(!wp.includes("{groupName}"))throw new Error(t("p.gpNeedPrompt"));
      const wgroups=scheduleGroupValues(selectedPostGroups());
      if(!wgroups.length)throw new Error(t("sch.needPostGroups"));
      const wai=await getAiProfileFor("groupPost");
      if(aiKeyRequired(wai)&&(!wai.key||!wai.model))throw new Error(t("p.gpNeedKeyModel"));
      return {feature,label:`${scheduleFeatureLabel(feature)} — Web (${webCfg.urls.length} RSS)`,config:{groups:enrichGroupPostGroups(wgroups),prompt:String(groupPostPrompt?.value||"").trim(),minDelay:GROUP_POST_AUTO_TIMING.minDelay,maxDelay:GROUP_POST_AUTO_TIMING.maxDelay,interGroupDelay:Math.min(604800,Math.max(5,parseInt(groupPostInterDelay?.value)||30)),background:readGroupPostBackgroundConfig(),typingConfig:getAiTypingConfig("groupPost"),source:{type:"sites",urls:webCfg.urls,q:webCfg.q,hours:webCfg.hours},webPrompt:wp,withWebPhoto:!!groupPostWebWithPhoto?.checked,aiConfig:{provider:wai.provider,model:wai.model,url:wai.url,profileId:wai.profileId||""}}};
    }
    if(groupPostSourceMode()==="fb"){
      const fbCfg=await groupPostResolveFbConfigLive();
      if(!fbCfg.urls.length)throw new Error(t("bg.newsNoFbUrls"));
      const fbp=String((fbCfg.mode==="opinion_screenshot"?groupPostFbOpinionPrompt:groupPostFbRewritePrompt)?.value||"").trim();
      if(fbp&&!fbp.includes("{newsText}"))throw new Error(t("nw.needNewsText"));
      if(fbp&&!fbp.includes("{groupName}"))throw new Error(t("p.gpNeedPrompt"));
      const fgroups=scheduleGroupValues(selectedPostGroups());
      if(!fgroups.length)throw new Error(t("sch.needPostGroups"));
      const fai=await getAiProfileFor("groupPost");
      if(aiKeyRequired(fai)&&(!fai.key||!fai.model))throw new Error(t("p.gpNeedKeyModel"));
      return {feature,label:`${scheduleFeatureLabel(feature)} — FB Page/Profile (${fbCfg.urls.length})`,config:{groups:enrichGroupPostGroups(fgroups),prompt:String(groupPostPrompt?.value||"").trim(),minDelay:GROUP_POST_AUTO_TIMING.minDelay,maxDelay:GROUP_POST_AUTO_TIMING.maxDelay,interGroupDelay:Math.min(604800,Math.max(5,parseInt(groupPostInterDelay?.value)||30)),background:readGroupPostBackgroundConfig(),typingConfig:getAiTypingConfig("groupPost"),source:{type:"fb",urls:fbCfg.urls,hours:fbCfg.hours,mode:fbCfg.mode,includeComment:fbCfg.includeComment},fbPrompt:fbp,withFbPhoto:true,aiConfig:{provider:fai.provider,model:fai.model,url:fai.url,profileId:fai.profileId||""}}};
    }
    readGroupPostDepthPrefs();
    const selected=scheduleGroupValues(selectedPostGroups()),limit=Math.max(1,Math.min(500,parseInt(groupPostTargetGroups?.value)||1)),groups=enrichGroupPostGroups(selected.slice(0,limit)).map(g=>({key:g.key,url:g.url,name:g.name,windowHours:g.windowHours,groupType:g.groupType,webSearch:g.webSearch})),prompt=String(groupPostPrompt?.value||"").trim();
    if(!groups.length)throw new Error(t("sch.needPostGroups"));
    if(!prompt.includes("{groupName}"))throw new Error(t("p.gpNeedPrompt"));
    const ai=await getAiProfileFor("groupPost");if(aiKeyRequired(ai)&&(!ai.key||!ai.model))throw new Error(t("p.gpNeedKeyModel"));
    return {feature,label:scheduleFeatureLabel(feature),config:{groups,prompt,minDelay:GROUP_POST_AUTO_TIMING.minDelay,maxDelay:GROUP_POST_AUTO_TIMING.maxDelay,interGroupDelay:Math.min(604800,Math.max(5,parseInt(groupPostInterDelay?.value)||30)),background:readGroupPostBackgroundConfig(),typingConfig:getAiTypingConfig("groupPost"),ctxEnabled:groupPostCtxOn,ctxMode:groupPostCtxModeVal,minLen:groupPostMinLenVal}};
  }
  if(feature==="share"){
    let sourceUrl;try{sourceUrl=normalizeFacebookShareSource(groupShareSourceUrl?.value);}catch(error){throw new Error(error.message);}
    const picked=scheduleGroupValues(selectedShareGroups()),limit=Math.max(1,parseInt(groupShareTargetGroups?.value)||1),groups=picked.slice(0,limit),prompt=String(groupSharePrompt?.value||"").trim(),typed=String(groupShareSourceText?.value||"").replace(/\s+/g," ").trim();
    if(!groups.length)throw new Error(t("sch.needShareGroups"));
    if(!prompt.includes("{postText}")||!prompt.includes("{groupName}"))throw new Error(t("p.shNeedPrompt"));
    const ai=await getAiProfileFor("share");if(aiKeyRequired(ai)&&(!ai.key||!ai.model))throw new Error(t("p.shNeedLeadBoth"));
    if(typed&&typed.length<10)throw new Error(t("p.shShortPost"));
    return {feature,label:scheduleFeatureLabel(feature),config:{sourceUrl,groups,prompt,interGroupDelay:Math.min(604800,Math.max(5,parseInt(groupShareInterDelay?.value)||30)),manualSourceText:typed.length>=10&&shareSourceManualEdit?typed:"",typingConfig:getAiTypingConfig("share")}};
  }
  if(feature==="sales"){
    const raw=await buildSalesConfig();
    const {aiConfig:_salesAi,...snapshot}=raw;
    // Lịch theo từng sản phẩm: chỉ giữ sản phẩm được tick trong lịch này.
    // Không tick gì → báo lỗi để người dùng chọn rõ, tránh hẹn nhầm cả loạt.
    const pickedIds=new Set(salesSchedulePickedIds());
    const pickedProducts=(raw.products||[]).filter(p=>pickedIds.has(p.id));
    if(!pickedProducts.length)throw new Error(t("sch.needSalesProducts"));
    const names=pickedProducts.map(p=>p.name||p.sourceText.slice(0,30)).join(", ");
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${names.slice(0,120)}`,config:{...snapshot,products:pickedProducts,groups:scheduleGroupValues(raw.groups)}};
  }
  if(feature==="trendLearn"){
    const mode=trendLearnMode(),picked=scheduleGroupValues(trendSourceGroupsForRun());
    if(mode==="links"&&!String(trendSourceLinks?.value||"").trim())throw new Error(t("sch.needTrendSources"));
    if(!picked.length)throw new Error(t("sch.needTrendSources"));
    return {feature,label:scheduleFeatureLabel(feature),config:{groups:picked.slice(0,1000),perGroup:trendLearnUnlimited?.checked?0:Math.max(1,parseInt(trendPerGroup?.value)||10),unlimited:trendLearnUnlimited?.checked!==false}};
  }
  if(feature==="trendPost"){
    const picked=scheduleGroupValues(trendTargetGroupsForRun()),target=Math.max(1,Math.min(100000,parseInt(trendTargetGroups?.value)||3)),groups=picked.slice(0,target),sourceMode=trendPostSourceMode?.value==="sequential"?"sequential":"selected",requested=groups.length*Math.max(1,Math.min(100000,parseInt(trendPostsPerGroup?.value)||1)),sourceSelection=await trendPostSourcePostsForRun(sourceMode==="sequential"?requested:null),posts=sourceSelection.posts;
    if(!groups.length)throw new Error(t("sch.needTrendTargets"));
    if(!posts.length)throw new Error(t("sch.needTrendPosts"));
    const distribution=sourceSelection.mode==="selected"?trendPostDistributionMode():"sequential",plan=sourceSelection.mode==="selected"?trendSelectedPostPlanForMode(posts,groups,distribution):trendSequentialPostPlan(posts,groups,Math.max(1,parseInt(trendPostsPerGroup?.value)||1)),jobs=[];
    plan.entries.forEach(entry=>entry.posts.forEach((post,postIndex)=>{const sourcePostId=trendLearnedPostId(post);jobs.push({group:{...entry.group},groupIndex:entry.groupIndex,postIndex,groupPostTotal:entry.posts.length,sourcePostIds:sourcePostId?[sourcePostId]:[],sourceText:trendSourceText([post]),draft:"",variant:jobs.length+1});}));
    if(!jobs.length)throw new Error(t("sch.needTrendPosts"));
    const ai=await getAiProfileFor("trendPost");if(aiKeyRequired(ai)&&(!ai.key||!ai.model))throw new Error(t("p.gpNeedKeyModel"));
    return {feature,label:scheduleFeatureLabel(feature),config:{groups,jobs,drafts:[],sourceText:trendSourceText(posts),sourcePostIds:[...new Set(posts.map(trendLearnedPostId).filter(Boolean))],sourceMode:sourceSelection.mode,distribution,postsPerGroup:Math.max(1,...plan.counts),postDelay:Math.min(604800,Math.max(5,parseInt(trendPostDelay?.value)||30)),prompt:trendRewritePrompt(),styleProfileId:trendStyleProfile?.value||"",interDelay:Math.min(604800,Math.max(5,parseInt(trendPostDelay?.value)||30)),anonymousMode:!!(trendAnonymousEnabled?.checked),background:readTrendBackgroundConfig(),typingConfig:getAiTypingConfig("trendPost")}};
  }
  if(feature==="pageGroupJoin"){
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const page=await scheduleSelectedPage(),mode=pageJoinMode,keyword=String(pageGroupKeyword?.value||"").trim();
    const schedTarget=Math.max(1,Math.min(100000,parseInt(pageGroupTarget?.value)||10));
    const schedListed=parsePageKeywordList(schedTarget);
    if(mode==="keyword"&&String(pageGroupKeywordList?.value||"").trim()&&!schedListed.length)throw new Error(t("pg.needKeywords"));
    if(mode==="keyword"&&!keyword&&!schedListed.length)throw new Error(t("sch.needPageKeyword"));
    const schedKeywords=schedListed.length?schedListed:(keyword?[{keyword,target:schedTarget}]:[]);
    const firstKw=schedKeywords.length?schedKeywords[0].keyword:keyword;
    return {feature,label:scheduleFeatureLabel(feature),config:{page,mode,keyword:firstKw,target:schedKeywords.length?schedKeywords[0].target:schedTarget,keywords:schedKeywords,minDelay:Math.max(5,Math.min(604800,parseInt(pageGroupMinDelay?.value)||15)),maxDelay:Math.max(5,Math.min(604800,parseInt(pageGroupMaxDelay?.value)||30)),answers:String(pageGroupAnswers?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean),aiEnabled:!!pageGroupAiEnabled?.checked,aiPrompt:String(pageGroupAiPrompt?.value||"").trim(),typingConfig:getAiTypingConfig("pageGroupJoin")}};
  }
  if(feature==="pageGroupPost"){
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const page=await scheduleSelectedPage(),picked=await pageGroupPostTargets(),limit=Math.max(1,Math.min(100000,parseInt(pageGroupPostTarget?.value)||picked.length)),groups=scheduleGroupValues(picked).slice(0,limit);
    if(!groups.length)throw new Error(t("sch.needPagePostGroups"));
    const prompt=String(pageGroupPostPrompt?.value||"").trim();
    if(!prompt.includes("{groupName}"))throw new Error(t("pgp.needGroupName"));
    return {feature,label:scheduleFeatureLabel(feature),config:{page,groups,target:groups.length,minDelay:Math.max(5,Math.min(604800,parseInt(pageGroupPostMinDelay?.value)||30)),maxDelay:Math.max(5,Math.min(604800,parseInt(pageGroupPostMaxDelay?.value)||60)),prompt}};
  }
  if(feature==="pageNewsWall"){
    const page=await scheduleSelectedPage(),source=pageNewsSourceConfig(),count=Math.max(1,Math.min(100000,parseInt(pageNewsWallTarget?.value)||1)),prompt=String(pageNewsWallPrompt?.value||"").trim();
    if(source.type==="xread"&&!source.users.length)throw new Error(t("pgn.needX"));
    if(source.type==="url"&&!/^https?:\/\//i.test(source.url))throw new Error(t("pgn.needUrl"));
    if(!prompt.includes("{newsText}"))throw new Error(t("pgn.needNewsText"));
    const ai=await getAiProfileFor("pageNewsWall");
    if(aiKeyRequired(ai)&&(!ai.key||!ai.model))throw new Error(t("p.gpNeedKeyModel"));
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${page.name||"Page"}`,config:{page,source,topic:String(pageNewsTopic?.value||"").trim(),count,interDelay:Math.max(0,Math.min(604800,parseInt(pageNewsWallDelay?.value)||30)),withImage:pageNewsWallWithImage?.checked!==false,prompt,styleProfileId:"",typingConfig:getAiTypingConfig("pageNewsWall")}};
  }
  if(feature==="pageComment"){
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const page=await scheduleSelectedPage(),source=["feed","groups","pages"].includes(pageCommentSource?.value)?pageCommentSource.value:"feed";
    const sourceLabel=t(source==="feed"?"fd.sourceBantin":`fd.source${source[0].toUpperCase()}${source.slice(1)}`)||source;
    const tagOn=!!pageCommentTagEnabled?.checked;
    let tagPrompt=String(pageCommentTagPrompt?.value||"").trim();
    if(tagOn&&!tagPrompt.includes("{tagName}"))tagPrompt=t("fd.aiTagPromptDefault");
    const tagConfig=tagSections["pageComment"]?.getTagConfig(tagOn)||null;
    const schedGroups=source==="groups"?scheduleGroupValues(selectedPageCommentGroups()):[];
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${sourceLabel}${tagOn&&tagConfig?" + tag":""}`,config:{page,source,groups:schedGroups,pages:[],target:Math.max(1,Math.min(100000,parseInt(pageCommentTarget?.value)||10)),minDelay:Math.max(5,Math.min(604800,parseInt(pageCommentMinDelay?.value)||20)),maxDelay:Math.max(5,Math.min(604800,parseInt(pageCommentMaxDelay?.value)||45)),prompt:String(pageCommentPrompt?.value||"").trim(),tagPrompt:tagOn?tagPrompt:"",tagConfig,typingConfig:getAiTypingConfig("pageComment")}};
  }
  if(feature==="pageSales"){
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const page=await scheduleSelectedPage();
    const cfg=await buildPageSalesConfig();
    const {aiConfig:_ai,...snapshot}=cfg;
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${page.name||"Page"}`,config:{...snapshot,page,groups:scheduleGroupValues(cfg.groups)}};
  }
  if(feature==="pageGroupComment"){
    try{await savePageUIToDataset(pageSafeKeyOf(selectedManagedPage),selectedManagedPage);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const page=await scheduleSelectedPage();
    const picked=selectedPageGroupCommentGroups();
    if(!picked.length)throw new Error(t("pggc.needGroups"));
    const limit=Math.max(1,Math.min(picked.length,parseInt(pageGroupCommentTargetGroups.value)||picked.length));
    const groups=scheduleGroupValues(picked).slice(0,limit);
    const perGroup=Math.max(1,Math.min(100000,parseInt(pageGroupCommentPerGroup.value)||3));
    const minDelay=Math.min(604800,Math.max(5,parseInt(pageGroupCommentMinDelay.value)||20));
    const maxDelay=Math.min(604800,Math.max(minDelay,parseInt(pageGroupCommentMaxDelay.value)||45));
    const prompt=String(pageGroupCommentPrompt.value||"").trim();
    if(!prompt.includes("{postText}"))throw new Error(t("pggc.needPostText"));
    const tagOn=!!document.getElementById("pageGroupCommentTagEnabled")?.checked;
    const tagConfig=tagSections["pageGroupComment"]?.getTagConfig(tagOn)||null;
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${page.name||"Page"}`,config:{page,groups,perGroup,targetGroups:groups.length,minDelay,maxDelay,prompt,tagConfig,typingConfig:getAiTypingConfig("pageGroupComment")}};
  }
  if(feature==="newsWall"){
    // Snapshot cấu hình hiện tại trên card (không giữ tin đã lấy — phiên chạy
    // sẽ lấy tin mới theo nguồn lúc đó). Giờ hẹn FB tuyệt đối có thể qua lúc
    // chuỗi nổ máy → background dời về +60p ở launchScheduledTask.
    const full=await buildNewsWallConfig(false);
    const {news,...snap}=full;
    if(snap.aiConfig)snap.aiConfig={provider:snap.aiConfig.provider,model:snap.aiConfig.model,url:snap.aiConfig.url,profileId:snap.aiConfig.profileId||""};
    const modeLabel=full.mode==="bg"?"Nền":full.mode==="photo"?"Ảnh":"Chữ";
    return {feature,label:`${scheduleFeatureLabel(feature)} — ${modeLabel}`,config:snap};
  }
  if(feature==="fbStory"){
    const urls=String($("fbStoryMediaUrls")?.value||"").trim();
    if(!urls)throw new Error(t("fbStory.needMedia"));
    const aiConfig=await getAiProfileFor("fbStory").catch(()=>({}));
    return {
      feature,
      label:scheduleFeatureLabel(feature),
      config:{
        mediaUrls:urls,
        text:String($("fbStoryText")?.value||"").trim(),
        delay:Math.max(0,parseInt($("fbStoryDelay")?.value)||30),
        aiEnabled:!!$("fbStoryAiEnabled")?.checked,
        aiPrompt:String($("fbStoryAiPrompt")?.value||"").trim(),
        crossIg:!!$("fbStoryCrossIg")?.checked,
        profileId:aiConfig?.profileId||""
      }
    };
  }
  if(feature==="fbReels"){
    const url=String($("fbReelsVideoUrl")?.value||"").trim();
    if(!url)throw new Error(t("fbReels.needVideo"));
    const aiConfig=await getAiProfileFor("fbReels").catch(()=>({}));
    return {
      feature,
      label:scheduleFeatureLabel(feature),
      config:{
        videoUrl:url,
        content:String($("fbReelsCaption")?.value||"").trim(),
        aiEnabled:!!$("fbReelsAiEnabled")?.checked,
        aiPrompt:String($("fbReelsAiPrompt")?.value||"").trim(),
        crossIg:!!$("fbReelsCrossIg")?.checked,
        profileId:aiConfig?.profileId||""
      }
    };
  }
  if(feature==="friendReengage"){
    const g=id=>{const el=$(id);return el?(el.type==="checkbox"?el.checked:el.value):undefined;};
    const num=(id,fb)=>{const raw=g(id);if(raw===undefined||raw===null||String(raw).trim()==="")return fb;const n=Number(raw);return Number.isFinite(n)?n:fb;};
    const cfg={mode:String(g("friendReengageMode")||"like"),likePerDay:Math.min(100000,Math.max(1,num("friendReengageLikePerDay",25))),likePerFriend:num("friendReengageLikePerFriend",2),commentPerDay:Math.min(100000,Math.max(1,num("friendReengageCommentPerDay",12))),commentPerFriend:num("friendReengageCommentPerFriend",1),likeSource:String(g("friendReengageLikeSource")||"new"),commentSource:String(g("friendReengageCommentSource")||"liked"),recentDays:num("friendReengageRecentDays",14),deadDays:num("friendReengageDeadDays",90),likeCooldownDays:num("friendReengageLikeCooldownDays",30),commentCooldownDays:num("friendReengageCommentCooldownDays",30),likeToCommentGapDays:num("friendReengageLikeToCommentGapDays",3),commentToLikeGapDays:num("friendReengageCommentToLikeGapDays",3),delayFriendMin:num("friendReengageDelayFriendMin",3),delayFriendMax:num("friendReengageDelayFriendMax",8),delayPostMin:num("friendReengageDelayPostMin",30),delayPostMax:num("friendReengageDelayPostMax",60),endMode:String(g("friendReengageEndMode")||"stop"),restDays:num("friendReengageRestDays",10),prompt:String(g("friendReengagePrompt")||""),storyEnabled:String(g("friendReengageStoryEnabled")||"1")==="1",storyPerDay:num("friendReengageStoryPerDay",20),storyViewSec:num("friendReengageStoryViewSec",5),storyReaction:String(g("friendReengageStoryReaction")||"random"),storyHours:num("friendReengageStoryHours",24),profileId:await aiProfileIdFor("friendReengage").catch(()=>""),storyDelayMin:20,storyDelayMax:45};
    return {feature,label:scheduleFeatureLabel(feature),config:cfg};
  }
  throw new Error(t("sch.unsupported"));
}
function renderScheduleList(items=[]){
  if(!scheduleList)return;
  const rows=Array.isArray(items)?items.filter(item=>item?.kind!=="chain").sort((a,b)=>(Number(a.runAt)||0)-(Number(b.runAt)||0)):[];
  if(!rows.length){scheduleList.innerHTML=`<div class="hint">${t("sch.empty")}</div>`;return;}
  const fragment=document.createDocumentFragment();
  rows.forEach(item=>{
    const row=document.createElement("div");row.className="schedule-item";
    const copy=document.createElement("div");
    const title=document.createElement("div");title.className="schedule-item-title";title.textContent=item.label||scheduleFeatureLabel(item.feature);
    const meta=document.createElement("div");meta.className="schedule-item-meta";meta.textContent=scheduleDateText(item.runAt);
    const status=document.createElement("span");const state=item.status||"scheduled";status.className=`schedule-item-status ${state}`;status.textContent=t(`sch.state.${state}`);
    copy.append(title,meta,status);
    const actions=document.createElement("div");actions.className="schedule-item-actions";
    if(state==="scheduled"||state==="waiting"){
      const cancel=document.createElement("button");cancel.type="button";cancel.textContent=t("sch.cancel");cancel.onclick=()=>chrome.runtime.sendMessage({action:"scheduleCancel",id:item.id},res=>{if(chrome.runtime.lastError||!res?.ok)scheduleStatus.textContent=scheduleErrorText(chrome.runtime.lastError?.message||res?.error);});actions.appendChild(cancel);
    }
    const remove=document.createElement("button");remove.type="button";remove.textContent=t("sch.remove");remove.onclick=()=>chrome.runtime.sendMessage({action:"scheduleRemove",id:item.id},res=>{if(chrome.runtime.lastError||!res?.ok)scheduleStatus.textContent=scheduleErrorText(chrome.runtime.lastError?.message||res?.error);});actions.appendChild(remove);
    row.append(copy,actions);fragment.appendChild(row);
  });
  scheduleList.replaceChildren(fragment);
}
// CHẠY XUYÊN ĐÊM — mỗi bước là một snapshot cấu hình được thêm trực tiếp từ
// ô "Tính năng" phía trên bằng nút "🌙 Thêm vào chuỗi qua đêm", không cần tạo
// lịch đơn giả trước. Danh sách bước (scheduleChainDraft) được lưu vào storage
// để không mất khi đóng popup giữa chừng lúc đang gộp nhiều bước.
let scheduleChainDraft=[];
function genChainDraftId(){return `draft_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;}
function saveScheduleChainDraft(){chrome.storage.local.set({scheduleChainDraft}).catch(()=>{});}
const scheduleChainAddBtn=$("scheduleChainAddBtn");
// Dùng chung cho cả nút trung tâm (tab Lịch chạy, theo ô Tính năng đang chọn)
// và các nút "🔗 Thêm vào chuỗi" gắn trực tiếp trên từng tính năng — chuỗi
// không còn gắn với "ban đêm": có thể tạo và chạy bất cứ lúc nào cần.
async function addToScheduleChainDraft(feature,statusEl,button,opts){
  try{
    const task=await scheduleSnapshot(feature,opts);
    try{task.config={...(task.config||{}),profileId:await aiProfileIdFor(task.feature||feature,opts)};}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    try{
      const pg=task.config?.page;
      const pgName=pg?String(pg.name||pg.id||""):"";
      if(task.feature&&task.feature.startsWith("page")&&pgName&&!String(task.label||"").includes(pgName))task.label=`${pgName} — ${task.label}`;
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    if(button)button.disabled=true;
    scheduleChainDraft=[...scheduleChainDraft,{id:genChainDraftId(),feature:task.feature,label:task.label,config:task.config,addedAt:Date.now()}];
    saveScheduleChainDraft();
    renderScheduleChainPicker();
    if(statusEl)statusEl.textContent=t("sch.overnightAdded",{n:scheduleChainDraft.length});
  }catch(error){
    if(statusEl)statusEl.textContent=error.message||t("sch.error");
  }finally{if(button)button.disabled=false;}
}
if(scheduleChainAddBtn)scheduleChainAddBtn.onclick=()=>addToScheduleChainDraft(scheduleFeature?.value||"discover",scheduleStatus,scheduleChainAddBtn);
function renderScheduleChainPicker(){
  if(!scheduleChainPicker)return;
  if(!scheduleChainDraft.length){scheduleChainPicker.innerHTML=`<div class="hint">${t("sch.overnightPickEmpty")}</div>`;return;}
  const fragment=document.createDocumentFragment();
  scheduleChainDraft.forEach((item,pos)=>{
    const row=document.createElement("div");row.className="schedule-item";
    const text=document.createElement("div");
    const title=document.createElement("div");title.className="schedule-item-title";
    title.textContent=`${pos+1}. ${item.label||scheduleFeatureLabel(item.feature)}`;
    text.append(title);
    const actions=document.createElement("div");actions.className="schedule-item-actions";
    const up=document.createElement("button");up.type="button";up.textContent="▲";up.disabled=pos<=0;
    up.onclick=()=>{if(pos<=0)return;const copyOrder=[...scheduleChainDraft];[copyOrder[pos-1],copyOrder[pos]]=[copyOrder[pos],copyOrder[pos-1]];scheduleChainDraft=copyOrder;saveScheduleChainDraft();renderScheduleChainPicker();};
    const down=document.createElement("button");down.type="button";down.textContent="▼";down.disabled=pos>=scheduleChainDraft.length-1;
    down.onclick=()=>{if(pos>=scheduleChainDraft.length-1)return;const copyOrder=[...scheduleChainDraft];[copyOrder[pos+1],copyOrder[pos]]=[copyOrder[pos],copyOrder[pos+1]];scheduleChainDraft=copyOrder;saveScheduleChainDraft();renderScheduleChainPicker();};
    const remove=document.createElement("button");remove.type="button";remove.textContent=t("sch.remove");
    remove.onclick=()=>{scheduleChainDraft=scheduleChainDraft.filter(x=>x.id!==item.id);saveScheduleChainDraft();renderScheduleChainPicker();};
    actions.append(up,down,remove);
    row.append(text,actions);fragment.appendChild(row);
  });
  scheduleChainPicker.replaceChildren(fragment);
}
async function createScheduleChain(){
  if(!scheduleChainCreateBtn)return;
  try{
    const runAt=new Date(scheduleChainWhen?.value||"").getTime();
    if(!Number.isFinite(runAt)||runAt<Date.now()+30*1000)throw new Error(t("sch.needFuture"));
    if(scheduleChainDraft.length<2)throw new Error(t("sch.overnightNeedSteps"));
    if(scheduleChainDraft.length>20)throw new Error(t("sch.overnightTooMany"));
    const gapSeconds=Math.min(604800,Math.max(0,parseInt(scheduleChainGap?.value)||0));
    const pageGap=document.querySelector("#scheduleChainPageGap")?Math.min(604800,Math.max(0,parseInt(document.querySelector("#scheduleChainPageGap").value)||30)):gapSeconds;
    const autoFresh=!document.querySelector("#scheduleChainAutoFresh")||document.querySelector("#scheduleChainAutoFresh").checked;
    const onFailure=["auto","continue","stop"].includes(scheduleChainOnFailure?.value)?scheduleChainOnFailure.value:"auto";
    const actorOf=step=>{try{const p=step?.config?.page;return p?String(p.id||p.url||"page"):"nick";}catch{return "nick";}};
    const steps=scheduleChainDraft.map((step,i)=>{
      const config={...(step.config||{})};
      if(autoFresh&&!String(step.feature||"").startsWith("trend")&&Array.isArray(config.groups)&&config.groups.length&&!config.groups.some(g=>g&&typeof g.auto==="object")){
        if(config.page)config.groups=[...config.groups,{auto:{source:"pageRegistry",pageKey:pageSafeKeyOf(config.page),limit:50}}];
        else if(step.feature!=="friend"||config.mode==="group-common")config.groups=[...config.groups,{auto:{source:"nickGroups",limit:20}}];
      }
      const last=i===scheduleChainDraft.length-1;
      const changed=!last&&actorOf(scheduleChainDraft[i+1])!==actorOf(step);
      return {feature:step.feature,label:step.label,config,gapAfter:last?0:(changed?pageGap:gapSeconds)};
    });
    scheduleChainCreateBtn.disabled=true;
    chrome.runtime.sendMessage({action:"scheduleCreate",task:{kind:"chain",runAt,gapSeconds,onFailure,steps}},res=>{
      scheduleChainCreateBtn.disabled=false;
      if(chrome.runtime.lastError||!res?.ok){
        if(scheduleChainStatus)scheduleChainStatus.textContent=scheduleErrorText(chrome.runtime.lastError?.message||res?.error);
        return;
      }
      if(scheduleChainStatus)scheduleChainStatus.textContent=t("sch.overnightSaved",{n:scheduleChainDraft.length,time:scheduleDateText(runAt)});
      scheduleChainDraft=[];
      saveScheduleChainDraft();
      renderScheduleChainPicker();
      refreshScheduleList();
    });
  }catch(error){if(scheduleChainStatus)scheduleChainStatus.textContent=error.message||t("sch.error");}
}
if(scheduleChainCreateBtn)scheduleChainCreateBtn.onclick=createScheduleChain;
function renderScheduleChainList(items=[]){
  if(!scheduleChainList)return;
  const rows=Array.isArray(items)?items.filter(item=>item?.kind==="chain").sort((a,b)=>(Number(a.runAt)||0)-(Number(b.runAt)||0)):[];
  if(!rows.length){scheduleChainList.innerHTML=`<div class="hint">${t("sch.overnightNone")}</div>`;return;}
  const fragment=document.createDocumentFragment();
  rows.forEach(chain=>{
    const row=document.createElement("div");row.className="schedule-item";
    const copy=document.createElement("div");
    const title=document.createElement("div");title.className="schedule-item-title";title.textContent=chain.label||t("sch.overnightTitle");
    const step=chain.steps?.[chain.currentIndex];
    const metaLines=[scheduleDateText(chain.runAt)];
    if(Array.isArray(chain.steps)&&chain.steps.length)metaLines.push(t("sch.overnightCurrent",{n:Math.min(chain.currentIndex+1,chain.steps.length),total:chain.steps.length})+(step?` — ${step.label||scheduleFeatureLabel(step.feature)}`:""));
    if(chain.error)metaLines.push(chain.error);
    const meta=document.createElement("div");meta.className="schedule-item-meta";meta.textContent=metaLines.join(" · ");
    const status=document.createElement("span");const state=chain.status||"scheduled";status.className=`schedule-item-status ${state}`;status.textContent=t(`sch.state.${state}`)||state;
    copy.append(title,meta,status);
    // Liệt kê đủ các bước với trạng thái từng bước (trước đây chỉ hiện bước
    // đang chạy nên thêm nhiều bước mà nhìn như thiếu).
    if(Array.isArray(chain.steps)&&chain.steps.length>1){
      const icon=st=>st==="completed"?"✓":st==="running"?"⏳":(st==="failed"?"✗":(st==="cancelled"?"—":"·"));
      const steps=document.createElement("div");steps.className="schedule-item-meta";
      steps.textContent=chain.steps.map((s,i)=>`${i+1}. ${String(s.label||scheduleFeatureLabel(s.feature)||"").slice(0,28)} ${icon(s.status)}`).join(" › ");
      copy.append(steps);
    }
    const actions=document.createElement("div");actions.className="schedule-item-actions";
    if(["scheduled","waiting","starting","running","stopping"].includes(state)){
      const stop=document.createElement("button");stop.type="button";stop.textContent=t("sch.stopChain");
      stop.onclick=()=>chrome.runtime.sendMessage({action:"scheduleChainStop",id:chain.id},res=>{if(chrome.runtime.lastError||!res?.ok)scheduleChainStatus.textContent=scheduleErrorText(chrome.runtime.lastError?.message||res?.error);});
      actions.appendChild(stop);
    }
    if(["needs_attention","failed"].includes(state)){
      const resume=document.createElement("button");resume.type="button";resume.textContent=t("sch.resume");
      resume.onclick=()=>chrome.runtime.sendMessage({action:"scheduleChainResume",id:chain.id},res=>{if(chrome.runtime.lastError||!res?.ok)scheduleChainStatus.textContent=scheduleErrorText(chrome.runtime.lastError?.message||res?.error);});
      actions.appendChild(resume);
    }
    if(state!=="running"){
      const remove=document.createElement("button");remove.type="button";remove.textContent=t("sch.remove");
      remove.onclick=()=>chrome.runtime.sendMessage({action:"scheduleRemove",id:chain.id},res=>{if(chrome.runtime.lastError||!res?.ok)scheduleChainStatus.textContent=scheduleErrorText(chrome.runtime.lastError?.message||res?.error);});
      actions.appendChild(remove);
    }
    row.append(copy,actions);fragment.appendChild(row);
  });
  scheduleChainList.replaceChildren(fragment);
}
function refreshScheduleList(){
  chrome.storage.local.get("scheduledTasks",state=>{
    const raw=state.scheduledTasks;
    // scheduledTasks luôn là mảng (background chỉ đọc mảng); gặp chuỗi/object
    // lạ (vd script ngoài ghi nhầm) thì coi như rỗng thay vì throw làm trắng UI.
    const items=Array.isArray(raw)?raw:[];
    renderScheduleList(items);
    renderScheduleChainList(items);
  });
}
function defaultScheduleTime(input){
  if(!input)return;
  const next=new Date(Date.now()+5*60*1000);next.setSeconds(0,0);
  input.value=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}T${String(next.getHours()).padStart(2,"0")}:${String(next.getMinutes()).padStart(2,"0")}`;
}
function setSchedulePreset(input,preset){
  if(!input)return;
  const at=new Date();
  if(preset==="30")at.setTime(Date.now()+30*60*1000);
  else if(preset==="tonight"){at.setHours(22,0,0,0);if(at.getTime()<Date.now()+35*1000)at.setDate(at.getDate()+1);}
  else if(preset==="morning"){at.setHours(7,0,0,0);if(at.getTime()<Date.now()+35*1000)at.setDate(at.getDate()+1);}
  else return;
  at.setSeconds(0,0);
  input.value=`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,"0")}-${String(at.getDate()).padStart(2,"0")}T${String(at.getHours()).padStart(2,"0")}:${String(at.getMinutes()).padStart(2,"0")}`;
}
document.querySelectorAll("[data-schedule-preset]").forEach(btn=>{btn.onclick=()=>setSchedulePreset($("scheduleWhen"),btn.dataset.schedulePreset);});
document.querySelectorAll("[data-chain-preset]").forEach(btn=>{btn.onclick=()=>setSchedulePreset($("scheduleChainWhen"),btn.dataset.chainPreset);});
async function createFeatureSchedule(feature,whenInput,statusEl,button,opts){
  try{
    const runAt=new Date(whenInput?.value||"").getTime();
    if(!Number.isFinite(runAt)||runAt<Date.now()+30*1000)throw new Error(t("sch.needFuture"));
    const task=await scheduleSnapshot(feature,opts);
    try{task.config={...(task.config||{}),profileId:await aiProfileIdFor(task.feature||feature,opts)};}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    if(button)button.disabled=true;
    chrome.runtime.sendMessage({action:"scheduleCreate",task:{...task,runAt}},res=>{
      if(button)button.disabled=false;
      if(statusEl)statusEl.textContent=res?.ok?t("sch.saved",{time:scheduleDateText(runAt)}):scheduleErrorText(chrome.runtime.lastError?.message||res?.error);
      refreshScheduleList();
    });
  }catch(error){if(button)button.disabled=false;if(statusEl)statusEl.textContent=error.message||t("sch.error");}
}
// Mỗi thẻ Bạn bè/Nhóm/Page trong tab Bảng feed tự hẹn lịch/thêm vào chuỗi
// đúng phạm vi của chính nó (opts.feedSource) thay vì chỉ dùng chung 1 khối
// lịch có ô "Nguồn chạy" bên dưới — đồng bộ với mọi tính năng khác, mỗi thẻ
// đều có sẵn nút lịch + chuỗi ngay tại chỗ.
const feedScopeScheduleBindings=["bantin","friends","groups","pages"].map(source=>({
  feature:"feed",
  when:`feed${source[0].toUpperCase()}${source.slice(1)}ScheduleWhen`,
  button:`feed${source[0].toUpperCase()}${source.slice(1)}ScheduleBtn`,
  status:`feed${source[0].toUpperCase()}${source.slice(1)}ScheduleStatus`,
  opts:{feedSource:source}
}));
const ALL_SCHEDULE_BINDINGS=[
  ...inlineScheduleBindings,
  ...feedScopeScheduleBindings,
  {feature:"keyword",when:"groupScheduleWhen",button:"groupScheduleBtn",status:"groupScheduleStatus"},
  {feature:"discover",when:"discoverScheduleWhen",button:"discoverScheduleBtn",status:"discoverScheduleStatus"},
  {feature:"pageGroupJoin",when:"pageGroupJoinScheduleWhen",button:"pageGroupJoinScheduleBtn",status:"pageGroupJoinScheduleStatus"},
  {feature:"pageGroupPost",when:"pageGroupPostScheduleWhen",button:"pageGroupPostScheduleBtn",status:"pageGroupPostScheduleStatus"},
  {feature:"pageNewsWall",when:"pageNewsWallScheduleWhen",button:"pageNewsWallScheduleBtn",status:"pageNewsWallScheduleStatus"},
  {feature:"pageComment",when:"pageCommentScheduleWhen",button:"pageCommentScheduleBtn",status:"pageCommentScheduleStatus"},
  {feature:"pageSales",when:"pageSalesScheduleWhen",button:"pageSalesScheduleBtn",status:"pageSalesScheduleStatus"},
  {feature:"pageGroupComment",when:"pageGroupCommentScheduleWhen",button:"pageGroupCommentScheduleBtn",status:"pageGroupCommentScheduleStatus"},
  {feature:"newsWall",when:"newsScheduleWhen",button:"newsScheduleBtn",status:"newsScheduleStatus"},
  {feature:"fbStory",when:"fbStoryScheduleWhen",button:"fbStoryScheduleBtn",status:"fbStoryScheduleStatus"},
  {feature:"fbReels",when:"fbReelsScheduleWhen",button:"fbReelsScheduleBtn",status:"fbReelsScheduleStatus"},
  {feature:"friendReengage",when:"friendReengageScheduleWhen",button:"friendReengageScheduleBtn",status:"friendReengageScheduleStatus"},
];
[scheduleWhen,scheduleChainWhen,...ALL_SCHEDULE_BINDINGS.map(item=>$(item.when))].forEach(defaultScheduleTime);
if(scheduleCreateBtn)scheduleCreateBtn.onclick=()=>createFeatureSchedule(scheduleFeature?.value||"discover",scheduleWhen,scheduleStatus,scheduleCreateBtn);
// Mọi nút "📅 Hẹn lịch cấu hình này" gắn trên từng tính năng (kể cả các nút
// vốn chưa được gắn onclick như Nuôi Page/Tìm nhóm/Khám phá) đều đi qua đúng
// một chỗ này, đảm bảo tính năng nào cũng thực sự hẹn lịch được, không chỉ
// hiện nút cho có.
ALL_SCHEDULE_BINDINGS.forEach(({feature,when,button,status,opts})=>{
  const whenInput=$(when),buttonEl=$(button),statusEl=$(status);
  if(buttonEl)buttonEl.onclick=()=>createFeatureSchedule(feature,whenInput,statusEl,buttonEl,opts);
});
// Gắn thêm nút "🔗 Thêm vào chuỗi" ngay cạnh từng nút "Hẹn lịch cấu hình này"
// hiện có, để không phải quay lại tab Lịch chạy chọn lại tính năng trong ô
// dropdown mỗi lần muốn gộp một tính năng vào chuỗi.
ALL_SCHEDULE_BINDINGS.forEach(({feature,button,status,opts})=>{
  const buttonEl=$(button),statusEl=$(status);
  if(!buttonEl||!buttonEl.parentElement)return;
  const chainBtn=document.createElement("button");
  chainBtn.type="button";
  chainBtn.textContent=t("sch.overnightAdd");
  chainBtn.style.cssText="background:#ede7f6;color:#4527a0;border:1px solid #b39ddb";
  chainBtn.onclick=()=>addToScheduleChainDraft(feature,statusEl,chainBtn,opts);
  buttonEl.insertAdjacentElement("afterend",chainBtn);
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local"||!changes.scheduledTasks)return;
  const items=Array.isArray(changes.scheduledTasks.newValue)?changes.scheduledTasks.newValue:[];
  renderScheduleList(items);
  renderScheduleChainList(items);
});
refreshScheduleList();
chrome.storage.local.get("scheduleChainDraft",state=>{
  scheduleChainDraft=Array.isArray(state.scheduleChainDraft)?state.scheduleChainDraft:[];
  renderScheduleChainPicker();
});

// TRUNG TÂM TIẾN TRÌNH
// Chỉ đọc các cờ/counter/status vốn có của từng state machine. Mỗi card gọi
// đúng nút Dừng hiện có, nên không tạo đường Stop song song hoặc can thiệp
// selector, proof và logic Facebook của bất kỳ tính năng nào.
const runCenter=$("runCenter"),runCenterList=$("runCenterList");
function feedRunCenterProgress(source,state){
  const cap=String(source||"").replace(/^./,char=>char.toUpperCase());
  const cfg=state[`feed${cap}Config`]||{};
  const mode=["like","comment","both"].includes(String(cfg.actionMode||""))?cfg.actionMode:(cfg.aiEnabled?"both":"like");
  const likeDone=runCenterNumber(state[`feed${cap}Count`]),commentDone=runCenterNumber(state[`feed${cap}AiCount`]);
  const likeTarget=Math.max(1,parseInt(cfg.target)||20),commentTarget=Math.max(1,parseInt(cfg.aiTarget)||5);
  if(mode==="comment")return `${commentDone} / ${commentTarget}`;
  if(mode==="both")return `👍 ${likeDone}/${likeTarget} · 🤖 ${commentDone}/${commentTarget}`;
  return `${likeDone} / ${likeTarget}`;
}
function friendReengageRunCenterProgress(state){
  const cfg=state.friendReengageConfig||{},mode=String(cfg.mode||"like"),parts=[];
  if(mode==="like"||mode==="both")parts.push(`👍 ${runCenterNumber(state.friendReengageDoneLike)}/${Math.max(1,parseInt(cfg.likePerDay)||25)}`);
  if(mode==="comment"||mode==="both")parts.push(`💬 ${runCenterNumber(state.friendReengageDoneComment)}/${Math.max(1,parseInt(cfg.commentPerDay)||12)}`);
  if(mode==="story"||cfg.storyEnabled)parts.push(`📸 ${runCenterNumber(state.friendReengageDoneStory)}/${Math.max(1,parseInt(cfg.storyPerDay)||20)}`);
  return parts.join(" · ")||"0";
}
const RUN_CENTER_FEATURES=[
  {active:"isRunning",name:"rc.friend",tab:"add",anchor:"panelAdd",stop:"startBtn",status:"friendStatus",done:"sentCount",total:s=>s.friendRunState?.config?.maxRequests},
  {active:"friendConfirmActive",name:"rc.confirm",tab:"add",anchor:"panelAdd",stop:"startBtn",status:"friendConfirmStatus",done:"friendConfirmAccepted",total:s=>s.friendConfirmRunState?.config?.maxRequests},
  {active:"friendFoFScanActive",name:"rc.friendFoFScan",tab:"add",anchor:"friendFoFStatus",stop:"startBtn",status:"friendFoFStatus",progress:state=>{const scan=state.friendFoFScanState||{};return `${runCenterNumber(scan.kind==="source"?scan.candidateCount:scan.sourceCount)}${t(scan.kind==="source"?"rc.candidates":"rc.sources")}`}},
  {active:"friendFoFActive",name:"rc.friendFoF",tab:"add",anchor:"friendFoFStatus",stop:"startBtn",status:"friendFoFStatus",done:"friendFoFSent",total:s=>s.friendFoFRunState?.config?.maxRequests},
  {active:"isScraping",name:"rc.scrape",tab:"scrape",anchor:"panelScrape",stop:"stopScrapeBtn",status:"scrapeStatus",done:"scrapeCount",total:"scrapeTarget",unit:"rc.posts"},
  {active:"feedBantinActive",name:"rc.feed",tab:"feed",anchor:"feedBantinStatus",stop:"feedBantinStopBtn",status:"feedBantinStatus",progress:state=>feedRunCenterProgress("bantin",state)},
  {active:"feedFriendsActive",name:"rc.feedFriends",tab:"feed",anchor:"feedFriendsStatus",stop:"feedFriendsStopBtn",status:"feedFriendsStatus",progress:state=>feedRunCenterProgress("friends",state)},
  {active:"feedGroupsActive",name:"rc.feedGroups",tab:"feed",anchor:"feedGroupsStatus",stop:"feedGroupsStopBtn",status:"feedGroupsStatus",progress:state=>feedRunCenterProgress("groups",state)},
  {active:"feedPagesActive",name:"rc.feedPages",tab:"feed",anchor:"feedPagesStatus",stop:"feedPagesStopBtn",status:"feedPagesStatus",progress:state=>feedRunCenterProgress("pages",state)},
  {active:"friendReengageActive",name:"rc.reengage",tab:"reengage",anchor:"friendReengageStatus",stop:"friendReengageStopBtn",status:"friendReengageStatus",progress:friendReengageRunCenterProgress},
  {active:"isAICommenting",name:"rc.aiFeed",tab:"feed",anchor:"panelFeed",stop:"aiStopBtn",status:"aiStatus",done:"aiCount",total:s=>s.aiActiveConfig?.target||s.pendingAIConfig?.target},
  {active:"groupInteractActive",name:"rc.groupReact",tab:"group",anchor:"groupInteractStatus",stop:"groupInteractStopBtn",status:"groupInteractStatus",done:"groupInteractDone",total:"groupInteractTotal"},
  {active:"groupCommentActive",name:"rc.groupComment",tab:"group",anchor:"groupCommentStatus",stop:"groupCommentStopBtn",status:"groupCommentStatus",done:"groupCommentDone",total:"groupCommentTotal"},
  {active:"groupPostActive",name:"rc.groupPost",tab:"group",anchor:"groupPostStatus",stop:"groupPostStopBtn",status:"groupPostStatus",done:"groupPostDone",total:"groupPostTotal"},
  {active:"isGroupJoining",name:"rc.groupJoin",tab:"group",subTab:"search",anchor:"groupStatus",stop:"groupStopBtn",status:"groupStatus",done:"groupJoined",total:s=>s.groupJoinRunConfig?.targetJoin},
  {active:"isDiscoverJoining",name:"rc.groupDiscover",tab:"group",subTab:"discover",anchor:"discoverStatus",stop:"discoverStopBtn",status:"discoverStatus",done:"discoverJoined",total:s=>s.discoverRunConfig?.target},
  {active:"groupShareActive",name:"rc.share",tab:"share",anchor:"groupShareStatus",stop:"groupShareStopBtn",status:"groupShareStatus",done:"groupShareDone",total:"groupShareTotal"},
  {active:"salesPostActive",name:"rc.sales",tab:"sales",anchor:"salesPostStatus",stop:"salesStopBtn",status:"salesPostStatus",done:"salesPostDone",total:"salesPostTotal"},
  {active:"trendLearnActive",name:"rc.trendLearn",tab:"trend",anchor:"trendLearnStatus",stop:"trendLearnStopBtn",status:"trendLearnStatus",done:"trendLearnCount",unit:"rc.posts"},
  {active:"trendPostActive",name:"rc.trendPost",tab:"trend",anchor:"trendPostStatus",stop:"trendPostStopBtn",status:"trendPostStatus",done:"trendPostDone",total:"trendPostTotal"},
  {active:"pageGroupJoinActive",name:"rc.pageJoin",tab:"page",anchor:"pageJoinStatus",stop:"pageGroupStopBtn",status:"pageGroupJoinStatus",done:"pageGroupJoinJoined",total:s=>s.pageGroupJoinConfig?.target},
  {active:"pageGroupPostActive",name:"rc.pagePost",tab:"page",anchor:"pageGroupPostStatus",stop:"pageGroupPostStopBtn",status:"pageGroupPostStatus",done:"pageGroupPostDone",total:"pageGroupPostTotal"},
  {active:"pageNewsWallActive",name:"rc.pageNewsWall",tab:"page",anchor:"pageNewsWallStatus",stop:"pageNewsWallStopBtn",status:"pageNewsWallStatus",done:"pageNewsWallDone",total:s=>(s.pageNewsWallDone||0)+(s.pageNewsWallSkipped||0)},
  {active:"pageSalesPostActive",name:"rc.pageSales",tab:"page",anchor:"pageSalesStatus",stop:"pageSalesStopBtn",status:"pageSalesStatus",done:"pageSalesPostDone",total:"pageSalesPostTotal"},
  {active:"pageGroupCommentActive",name:"rc.pageGroupComment",tab:"page",anchor:"pageGroupCommentStatus",stop:"pageGroupCommentStopBtn",status:"pageGroupCommentStatus",done:"pageGroupCommentDone",total:s=>(s.pageGroupCommentConfig?.groups?.length||0)*(s.pageGroupCommentConfig?.perGroup||0)},
  {active:"pageCommentActive",name:"rc.pageComment",tab:"page",anchor:"pageCommentStatus",stop:"pageCommentStopBtn",status:"pageCommentStatus",done:"pageCommentDone",total:s=>s.pageCommentConfig?.target},
];
const RUN_CENTER_KEYS=[...new Set(RUN_CENTER_FEATURES.flatMap(feature=>[feature.active,feature.status,feature.done,typeof feature.total==="string"?feature.total:null]).filter(Boolean).concat([
  "friendRunState","friendConfirmRunState","friendFoFRunState","friendFoFScanState","friendFoFScanActive","friendFoFSourceScanned","friendFoFActive","friendFoFStatus","friendFoFSent","pendingFeedConfig","aiActiveConfig","pendingAIConfig","feedBantinConfig","feedBantinCount","feedBantinAiCount","feedFriendsConfig","feedGroupsConfig","feedPagesConfig","feedFriendsAiCount","feedGroupsAiCount","feedPagesAiCount","friendReengageConfig","friendReengageDoneLike","friendReengageDoneComment","friendReengageDoneStory","friendReengageSkipped","friendReengageCycle","groupJoinRunConfig","discoverRunConfig","pageGroupJoinConfig","pageGroupJoinRunState","pageGroupPostConfig","pageNewsWallConfig","pageNewsWallSkipped","pageGroupCommentConfig","pageCommentConfig"
]))];
const runCenterText=value=>String(value||"").replace(/\s+/g," ").trim();
const runCenterNumber=value=>Math.max(0,parseInt(value)||0);
function runCenterTotal(feature,state){
  const value=typeof feature.total==="function"?feature.total(state):feature.total?state[feature.total]:null;
  const total=runCenterNumber(value);
  return total||null;
}
function runCenterProgress(feature,state){
  if(typeof feature.progress==="function")return feature.progress(state);
  const done=runCenterNumber(state[feature.done]);
  const total=runCenterTotal(feature,state);
  if(total)return `${done} / ${total}`;
  return feature.unit?`${done}${t(feature.unit)}`:`${done}`;
}
function openRunCenterFeature(feature){
  showTab(feature.tab);
  if(feature.subTab&&typeof showGroupSub==="function")showGroupSub(feature.subTab);
  const anchor=$(feature.anchor);
  if(anchor)setTimeout(()=>anchor.scrollIntoView({behavior:"smooth",block:"center"}),0);
}
function renderRunCenter(state){
  if(!runCenter||!runCenterList)return;
  const running=RUN_CENTER_FEATURES.filter(feature=>!!state[feature.active]);
  runCenter.classList.toggle("hidden",!running.length);
  if(!running.length){runCenterList.replaceChildren();return;}
  const fragment=document.createDocumentFragment();
  running.forEach(feature=>{
    const card=document.createElement("div");
    card.className="run-card";
    card.tabIndex=0;
    card.setAttribute("role","button");
    card.setAttribute("aria-label",t("rc.open",{name:t(feature.name)}));
    const copy=document.createElement("div");
    const title=document.createElement("div");title.className="run-card-title";
    const name=document.createElement("span");name.textContent=t(feature.name);
    const progress=document.createElement("span");progress.className="run-card-progress";progress.textContent=runCenterProgress(feature,state);
    title.append(name,progress);
    const status=document.createElement("div");status.className="run-card-status";status.textContent=runCenterText(state[feature.status])||t("rc.preparing");
    status.title=status.textContent;
    copy.append(title,status);
    const stop=document.createElement("button");stop.type="button";stop.className="run-card-stop";stop.textContent=t("rc.stop");
    stop.addEventListener("click",event=>{
      event.stopPropagation();
      const button=$(feature.stop);
      if(button&&!button.disabled)button.click();
    });
    const open=()=>openRunCenterFeature(feature);
    card.addEventListener("click",open);
    card.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open();}});
    card.append(copy,stop);
    fragment.appendChild(card);
  });
  runCenterList.replaceChildren(fragment);
}
let runCenterRefreshQueued=false;
function refreshRunCenter(){
  if(runCenterRefreshQueued)return;
  runCenterRefreshQueued=true;
  queueMicrotask(async()=>{
    runCenterRefreshQueued=false;
    try{renderRunCenter(await chrome.storage.local.get(RUN_CENTER_KEYS));}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  });
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=="local"||!Object.keys(changes).some(key=>RUN_CENTER_KEYS.includes(key)))return;
  refreshRunCenter();
});
refreshRunCenter();

// Mở popup: tự về đúng panel của phiên đang chạy (ưu tiên Share > Nhóm >
// Bản tin & AI > Cào bài > Kết bạn); không có phiên chạy thì mở lại tab
// của lần trước. Popup không tự đóng — trạng thái cập nhật trực tiếp.
(async()=>{
  try{
    const r=await chrome.storage.local.get(["salesPostActive","trendLearnActive","trendPostActive","newsWallActive","fbStoryActive","fbReelsActive","groupShareActive","groupPostActive","groupInteractActive","groupCommentActive","isGroupJoining","isDiscoverJoining","pageGroupJoinActive","pageGroupPostActive","pageNewsWallActive","pageGroupCommentActive","pageCommentActive","pageSalesPostActive","friendReengageActive","isAICommenting","feedFriendsActive","feedGroupsActive","feedPagesActive","isScraping","isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","popupLastTab"]);
    const panel=r.salesPostActive?"sales"
      :(r.trendLearnActive||r.trendPostActive)?"trend"
      :r.groupShareActive?"share"
      :(r.groupPostActive||r.groupInteractActive||r.groupCommentActive||r.isGroupJoining||r.isDiscoverJoining)?"group"
      :(r.pageGroupJoinActive||r.pageGroupPostActive||r.pageNewsWallActive||r.pageGroupCommentActive||r.pageCommentActive)?"page"
      :(r.isAICommenting||r.feedFriendsActive||r.feedGroupsActive||r.feedPagesActive)?"feed"
      :r.friendReengageActive?"reengage"
      :r.isScraping?"scrape"
      :(r.isRunning||r.friendConfirmActive||r.friendFoFActive||r.friendFoFScanActive||r.newsWallActive||r.fbStoryActive||r.fbReelsActive)?"add"
      :(r.popupLastTab||"");
    if(panel)showTab(panel);
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
})();

// ---- Nhật ký hoạt động: xem lại sau khi một lượt chạy dài đã dừng ----
const ACTIVITY_LOG_FEATURE_LABELS={
  groupPost:"Đăng nhóm",groupComment:"Comment AI nhóm",groupInteract:"Like/Random nhóm",
  friend:"Kết bạn",share:"Share bài",scrape:"Cào bài",aiFeed:"Comment AI feed",
  keyword:"Tham gia theo từ khóa",discover:"Khám phá nhóm",sales:"Đăng bán",
  trendLearn:"Học nhóm (thu thập)",trendPost:"Học nhóm (đăng)",
  pageGroupJoin:"Trang: tham gia nhóm",pageGroupPost:"Trang: đăng nhóm",
  pageWatch:"Trang: theo dõi",pageComment:"Trang: comment",
  feed:"Bảng feed",feedBantin:"Feed → Bản tin",feedFriends:"Feed → Bạn bè",feedGroups:"Feed → Nhóm",feedPages:"Feed → Page",
  scanGroups:"Tải danh sách nhóm",
  chain:"Chuỗi"
};
const LOG_LEVEL_META={
  error:{badge:"⛔ LỖI",   bg:"#fff0f0",border:"#ffcdd2",color:"#c62828"},
  warn: {badge:"⚠️ CẢNH BÁO",bg:"#fffde7",border:"#fff176",color:"#e65100"},
  done: {badge:"✅ XONG",   bg:"#f1f8e9",border:"#c5e1a5",color:"#2e7d32"},
  start:{badge:"▶ BẮT ĐẦU",bg:"#e3f2fd",border:"#90caf9",color:"#1565c0"},
  info: {badge:"ℹ️",        bg:"",        border:"#eee",  color:"#455a64"}
};
const logList=$("logList"),logFilterFeature=$("logFilterFeature"),logRefreshBtn=$("logRefreshBtn"),logClearBtn=$("logClearBtn"),logCopyBtn=$("logCopyBtn");
let lastActivityLog=[];
function activityLogFeatureLabel(feature){return ACTIVITY_LOG_FEATURE_LABELS[feature]||feature||"?";}
function detectLogLevelClient(e){
  if(e.level&&LOG_LEVEL_META[e.level])return e.level;
  const s=String(e.msg||"");
  if(/lỗi|error|thất bại|failed|dừng hẳn|quota|timeout|unauthorized|blocked|sai key|captcha/i.test(s))return"error";
  if(/bỏ qua|skip|cảnh báo|thử lại|retry|rate.?limit|không tìm thấy|thiếu/i.test(s))return"warn";
  if(/hoàn tất|hoàn thành|done|completed|xong|thành công/i.test(s))return"done";
  if(/bắt đầu|starting|started|đang chạy/i.test(s))return"start";
  return"info";
}
function renderActivityLog(){
  if(!logList)return;
  const filter=logFilterFeature?logFilterFeature.value:"";
  const rows=(filter?lastActivityLog.filter(e=>e.feature===filter):lastActivityLog).slice(-300).reverse();
  if(!rows.length){logList.innerHTML=`<div class="hint">${t("log.empty")}</div>`;return;}
  const frag=document.createDocumentFragment();
  for(const e of rows){
    const lvl=detectLogLevelClient(e);
    const meta=LOG_LEVEL_META[lvl]||LOG_LEVEL_META.info;
    const row=document.createElement("div");
    const d=new Date(e.t||0);
    const time=`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")} ${d.toLocaleDateString("vi-VN")}`;
    row.style.cssText=`padding:5px 7px;border-bottom:1px solid ${meta.border};border-left:3px solid ${meta.border};margin-bottom:2px;white-space:pre-wrap;word-break:break-word;font-size:11px;${meta.bg?"background:"+meta.bg+";":""}`;
    const featureTag=document.createElement("span");
    featureTag.style.cssText=`font-weight:bold;color:${meta.color};margin-right:4px`;
    featureTag.textContent=`[${activityLogFeatureLabel(e.feature)}]`;
    const levelBadge=document.createElement("span");
    levelBadge.style.cssText=`color:${meta.color};font-size:10px;margin-right:5px;opacity:0.85`;
    levelBadge.textContent=meta.badge;
    const timeSpan=document.createElement("span");
    timeSpan.style.cssText="color:#90a4ae;font-size:10px;margin-right:5px";
    timeSpan.textContent=`[${time}]`;
    const msgSpan=document.createElement("span");
    msgSpan.style.color=meta.color||"#333";
    msgSpan.textContent=String(e.msg||"");
    row.appendChild(timeSpan);
    row.appendChild(featureTag);
    if(lvl!=="info")row.appendChild(levelBadge);
    row.appendChild(msgSpan);
    frag.appendChild(row);
  }
  logList.replaceChildren(frag);
}
async function refreshActivityLog(){
  try{
    const {activityLog}=await chrome.storage.local.get("activityLog");
    lastActivityLog=Array.isArray(activityLog)?activityLog:[];
    if(logFilterFeature){
      const current=logFilterFeature.value;
      const features=[...new Set(lastActivityLog.map(e=>e.feature).filter(Boolean))].sort();
      const opts=[`<option value="">${t("log.filterAll")}</option>`,...features.map(f=>`<option value="${f}">${activityLogFeatureLabel(f)}</option>`)];
      logFilterFeature.innerHTML=opts.join("");
      logFilterFeature.value=features.includes(current)?current:"";
    }
    renderActivityLog();
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
}
if(logRefreshBtn)logRefreshBtn.onclick=()=>refreshActivityLog();
if(logFilterFeature)logFilterFeature.onchange=()=>renderActivityLog();
if(logClearBtn)logClearBtn.onclick=async()=>{
  if(!confirm(t("log.confirmClear")))return;
  await chrome.storage.local.set({activityLog:[]});
  await refreshActivityLog();
};
if(logCopyBtn)logCopyBtn.onclick=async()=>{
  const filter=logFilterFeature?logFilterFeature.value:"";
  const rows=filter?lastActivityLog.filter(e=>e.feature===filter):lastActivityLog;
  const text=rows.map(e=>`[${new Date(e.t||0).toLocaleString()}] [${activityLogFeatureLabel(e.feature)}] ${e.msg||""}`).join("\n");
  try{await navigator.clipboard.writeText(text||"");logCopyBtn.textContent=t("log.copied");setTimeout(()=>{logCopyBtn.textContent=t("log.copy");},1500);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
};
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==="local"&&changes.activityLog&&panelLog&&!panelLog.classList.contains("hidden"))refreshActivityLog();
});

// ── EXPORT / IMPORT SETTINGS (full backup) ─────────────────────────────────
// Xuất: toàn bộ sync + local durable + IndexedDB text. Cố ý KHÔNG xuất cờ chạy
// transient (*Active/*RunId/pending*/ownerTabId/status now). License mang theo để
// nhập lại sau update (model 1 key = 20 seats: mỗi profile là 1 seat riêng).
const EXPORT_LOCAL_KEYS=[
  "joinedGroupsLog","unifiedAiProfiles","salesPostMedia","joinedGroups",
  // bản quyền (để nhập lại sau update không mất key kể cả khi giải nén thư mục mới)
  "licenseToken","licenseKey","licenseGmail","licenseLastVerified","licenseValid","licenseReason","licenseExpiry","licensePlan",
  // config phiên chạy cuối (durable, resume sau reload dùng)
  "feedBantinConfig","feedFriendsConfig","feedGroupsConfig","feedPagesConfig",
  "groupPostConfig","groupInteractConfig","groupCommentConfig","groupJoinRunConfig","discoverRunConfig",
  "groupShareConfig","salesPostConfig","trendLearnConfig","trendPostConfig","topCommentConfig",
  "pageGroupJoinConfig","pageGroupPostConfig","pageSalesPostConfig","pageCommentConfig","pageGroupCommentConfig",
  // lựa chọn đã tick
  "groupInteractSelectedIds","groupShareSelectedIds",
  // lịch sử/guard chống trùng
  "friendProfileHistory","friendConfirmHistory","friendFoFHistory","friendWarmHistory",
  "aiCommentHistory","aiCommentSubmissionGuard",
  "feedBantinAiHistory","feedFriendsAiHistory","feedGroupsAiHistory","feedPagesAiHistory",
  "feedBantinAiSubmissionGuard","feedFriendsAiSubmissionGuard","feedGroupsAiSubmissionGuard","feedPagesAiSubmissionGuard",
  "groupCommentHistory","groupCommentProcessedKeys","groupCommentSubmissionGuard",
  "groupInteractReactionGuard","groupInteractReactedKeys","groupInteractCommentGuard","groupInteractCommentHistory",
  "groupShareSharedGroupIds","groupShareRecentCaptions",
  "topCommentHistory","topCommentSubmissionGuard",
  "pageGroupJoinHistory","pageGroupJoinAttemptedKeys","pageCommentHistory","pageGroupCommentGroupDone",
  // lịch chạy
  "scheduledTasks","scheduleChainDraft",
  // hồ sơ văn phong đã học
  "styleProfiles","activeStyleProfileId","styleProfileStatus","styleDigestCache",
  // Page: nhóm đã lưu + nhóm đã join
  "pageSavedGroups","pageJoinedGroups",
  // Kho dữ liệu theo Page (config + tick + tóm tắt lần chạy cuối từng Page)
  "pageDatasets",
  // Đăng bán: kho ảnh sản phẩm + chat AI
  "salesProductsMedia","salesAiChatMessages",
  // Cào bài: mirror 500 bài
  "scrapePosts",
  // nhật ký hoạt động
  "activityLog",
];
// IndexedDB text (datasets/bài viết/cache Page). Media blob chỉ kèm khi tổng <= budget.
const EXPORT_IDB_TEXT={fbAutoScrape:["datasets","posts","analyses"],fbAutoPageCare:["pageProfiles","groupProfiles","followedPages","contentCache","usage"]};
const EXPORT_IDB_VERSIONS={fbAutoScrape:2,fbAutoPageCare:1};
const EXPORT_MEDIA_BUDGET=8*1024*1024;
function idbOpenReadable(dbName){
  return new Promise((resolve,reject)=>{
    try{
      const q=indexedDB.open(dbName);
      q.onsuccess=()=>resolve(q.result);
      q.onerror=()=>reject(q.error||new Error("IDB open failed: "+dbName));
    }catch(e){reject(e);}
  });
}
function idbGetAll(db,store){
  return new Promise((resolve,reject)=>{
    try{
      if(!db.objectStoreNames.contains(store))return resolve(null);
      const req=db.transaction(store,"readonly").objectStore(store).getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error||new Error("IDB read failed: "+store));
    }catch(e){reject(e);}
  });
}
function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    try{
      const fr=new FileReader();
      fr.onload=()=>resolve(fr.result);
      fr.onerror=()=>reject(fr.error||new Error("blob read failed"));
      fr.readAsDataURL(blob);
    }catch(e){reject(e);}
  });
}
async function collectIdbForExport(){
  const out={dbs:{},mediaOmitted:0,mediaBytes:0};
  for(const [dbName,stores] of Object.entries(EXPORT_IDB_TEXT)){
    let db=null;
    try{db=await idbOpenReadable(dbName);}catch{continue;}
    try{
      out.dbs[dbName]={};
      for(const s of stores){
        try{out.dbs[dbName][s]=await idbGetAll(db,s);}catch{out.dbs[dbName][s]=null;}
      }
    }finally{try{db.close();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  }
  // media scrape: kèm blob trong budget, quá budget chỉ giữ manifest
  try{
    const db=await idbOpenReadable("fbAutoScrape");
    try{
      const rows=(await idbGetAll(db,"media"))||[];
      const total=rows.reduce((a,r)=>a+(r&&r.bytes||0),0);
      out.mediaBytes=total;
      if(total<=EXPORT_MEDIA_BUDGET){
        out.media=[];
        for(const r of rows){
          const rec={...(r||{})};
          if(rec.blob instanceof Blob)rec.blob=await blobToDataUrl(rec.blob);
          out.media.push(rec);
        }
      }else{
        out.mediaOmitted=rows.length;
        out.mediaManifest=rows.map(r=>({id:r&&r.id,datasetId:r&&r.datasetId,postKey:r&&r.postKey,kind:r&&r.kind,mime:r&&r.mime,bytes:r&&r.bytes,sourceUrl:r&&r.sourceUrl,status:"blob-omitted-too-large"}));
      }
    }finally{try{db.close();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  }catch{/* chưa từng cào media: bỏ qua */}
  return out;
}
function idbOpenWritable(dbName){
  return new Promise((resolve,reject)=>{
    try{
      const want=EXPORT_IDB_VERSIONS[dbName]||1;
      const q=indexedDB.open(dbName,want);
      q.onupgradeneeded=()=>{
        const db=q.result;
        const stores=[...(EXPORT_IDB_TEXT[dbName]||[]),"media"];
        stores.forEach(s=>{if(!db.objectStoreNames.contains(s)){try{db.createObjectStore(s,{keyPath:"id"});}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}});
      };
      q.onsuccess=()=>resolve(q.result);
      q.onerror=()=>reject(q.error||new Error("IDB open failed: "+dbName));
    }catch(e){reject(e);}
  });
}
async function restoreIdbFromImport(idb){
  if(!idb||!idb.dbs)return {rows:0,media:0};
  let rows=0,media=0;
  const putAll=(db,store,records)=>{
    const list=(Array.isArray(records)?records:[]).filter(r=>r&&r.id!==undefined&&r.id!==null);
    if(!list.length)return Promise.resolve(0);
    return new Promise((resolve,reject)=>{
      try{
        if(!db.objectStoreNames.contains(store))return resolve(0);
        const tx=db.transaction(store,"readwrite");
        const os=tx.objectStore(store);
        list.forEach(r=>{try{os.put(r);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }});
        tx.oncomplete=()=>resolve(list.length);
        tx.onerror=()=>reject(tx.error||new Error("IDB write failed: "+store));
      }catch(e){reject(e);}
    });
  };
  for(const [dbName,stores] of Object.entries(idb.dbs||{})){
    let db=null;
    try{db=await idbOpenWritable(dbName);}catch{continue;}
    try{
      for(const [s,records] of Object.entries(stores||{})){
        try{rows+=await putAll(db,s,records);}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      }
    }finally{try{db.close();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
  }
  if(Array.isArray(idb.media)&&idb.media.length){
    let db=null;
    try{db=await idbOpenWritable("fbAutoScrape");}catch{db=null;}
    if(db){
      try{
        const recs=[];
        for(const r of idb.media){
          const rec={...(r||{})};
          if(typeof rec.blob==="string"&&rec.blob.startsWith("data:")){
            try{rec.blob=await (await fetch(rec.blob)).blob();}catch{delete rec.blob;}
          }
          recs.push(rec);
        }
        media=await putAll(db,"media",recs);
      }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
      finally{try{db.close();}catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }}
    }
  }
  return {rows,media};
}
const exportSettingsBtn=$("exportSettingsBtn"),importSettingsBtn=$("importSettingsBtn");
const importSettingsFile=$("importSettingsFile"),settingsBackupStatus=$("settingsBackupStatus");
function showBackupStatus(msg,ok=true){if(!settingsBackupStatus)return;settingsBackupStatus.textContent=msg;settingsBackupStatus.style.color=ok?"#2e7d32":"#c62828";setTimeout(()=>{settingsBackupStatus.textContent="";},4000);}
if(exportSettingsBtn)exportSettingsBtn.onclick=async()=>{
  try{
    if(document.getElementById("exportConfigOnly")?.checked){
      showBackupStatus("⏳ Đang gom cấu hình (không key, không nhóm)...");
      const built=await buildConfigOnlyPayload();
      const payload={_version:2,_profile:"config-only",_exportedAt:new Date().toISOString(),sync:built.sync,local:built.local};
      downloadJsonFile(`fb-auto-config-${new Date().toISOString().slice(0,10)}.json`,payload);
      const dropped=built.dropped||[];
      showBackupStatus(`✅ Đã xuất cấu hình: ${Object.keys(payload.sync).length} mục${dropped.length?` (bỏ ${dropped.length} lịch cần nhóm: ${dropped.slice(0,3).join(", ")})`:""} — key và nhóm ở lại máy này`);
      return;
    }
    // (2.11.10) Xuất ĐẦY ĐỦ chứa API key + thông tin license trong file
    // JSON — ai có file là dùng được key. Hỏi rõ trước khi gom; huỷ thì
    // dừng hẳn, không tạo file nào.
    if(!confirm("⚠️ Xuất bản ĐẦY ĐỦ?\n\nFile backup này chứa API key và thông tin license của bạn. Ai có file này đều dùng được key của bạn.\nChỉ tiếp tục nếu bạn chắc chắn lưu file ở nơi an toàn.\n\nTiếp tục xuất đầy đủ?")){
      showBackupStatus("Đã huỷ xuất đầy đủ — không có file nào được tạo.",false);
      return;
    }
    showBackupStatus("⏳ Đang gom dữ liệu xuất...");
    const [sync,baseLocal]=await Promise.all([chrome.storage.sync.get(null),chrome.storage.local.get(EXPORT_LOCAL_KEYS)]);
    // Bù key per-Page (pageJoinedGroups_*): allowlist ghi literal nên get trực tiếp sẽ sót.
    const local={...baseLocal};
    try{
      const everything=await chrome.storage.local.get(null);
      for(const k of Object.keys(everything||{})){
        if(k==="pageDatasets"||k.startsWith("pageJoinedGroups_"))local[k]=everything[k];
      }
    }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    const idb=await collectIdbForExport().catch(()=>({dbs:{},mediaOmitted:0,mediaBytes:0}));
    const payload={_version:2,_exportedAt:new Date().toISOString(),sync,local,idb};
    const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`fb-auto-settings-${new Date().toISOString().slice(0,10)}.json`;a.click();
    URL.revokeObjectURL(url);
    const idbRows=Object.values(idb.dbs||{}).reduce((acc,stores)=>acc+Object.values(stores||{}).reduce((n,l)=>n+(Array.isArray(l)?l.length:0),0),0);
    const mediaNote=(idb.mediaOmitted||0)?` (bỏ ${idb.mediaOmitted} blob media quá nặng)`:(idb.media&&idb.media.length?` (+${idb.media.length} media)`:"");
    showBackupStatus(`✅ Đã xuất: ${Object.keys(sync).length} sync + ${Object.keys(local).length} local + ${idbRows} IDB${mediaNote}`);
  }catch(e){showBackupStatus("❌ Lỗi xuất: "+e.message,false);}
};
if(importSettingsBtn)importSettingsBtn.onclick=()=>importSettingsFile&&importSettingsFile.click();
// ── EXPORT/IMPORT CẤU HÌNH (không key, không nhóm): chép nick1 → nick2 ──────
// Tái dùng khung full backup ở trên, khác 3 điểm: (1) bỏ secrets + nhóm,
// (2) hồ sơ AI gộp theo tên (giữ key nick2), (3) lịch cần nhóm thì bỏ + báo rõ.
const CONFIG_ONLY_SECRET_KEYS=new Set(["aiApiKey","aiKeys","groupPostAiKey","licenseToken","licenseKey","licenseGmail","licenseMachineId","licenseLastVerified","licenseValid","licenseReason","licenseExpiry","licensePlan","licenseKeyBackup","licenseGmailBackup"]);
// (2.11.10) Lớp lọc secret THỨ HAI cho bản config-only: đệ quy quét mọi
// object/array và loại thêm key lạ mà tên (lowercase) khớp mẫu secret —
// phòng key bí mật lồng sâu trong config/lịch mà set tên cố định ở trên
// không biết. NGOẠI LỆ tường minh: các key cấu hình/thống kê chứa chữ
// "token" nhưng KHÔNG phải bí mật — giới hạn token đầu ra của AI
// (maxTokensOverride, maxOutputTokens, max_tokens, max_completion_tokens)
// và thống kê digest hồ sơ (estimatedTokens, tokens, approxTokens). Các
// key chứa "keyword" (friendGroupKeyword...) không khớp mẫu vì mẫu đòi
// "api" đứng ngay trước "key".
const CONFIG_ONLY_SECRET_NAME_RE=/(api[-_]?key|secret|token|password|passwd)/;
const CONFIG_ONLY_SAFE_TOKEN_KEYS=new Set(["maxtokensoverride","maxoutputtokens","max_tokens","max_completion_tokens","estimatedtokens","tokens","approxtokens"]);
function configOnlyIsSecretKey(k){
  if(CONFIG_ONLY_SECRET_KEYS.has(k))return true;
  const lk=String(k).toLowerCase();
  if(CONFIG_ONLY_SAFE_TOKEN_KEYS.has(lk))return false;
  return CONFIG_ONLY_SECRET_NAME_RE.test(lk);
}
function configOnlyStripSecretsDeep(v){
  if(Array.isArray(v))return v.map(configOnlyStripSecretsDeep);
  if(v&&typeof v==="object"){
    const out={};
    for(const [k,val] of Object.entries(v)){
      if(configOnlyIsSecretKey(k))continue;
      out[k]=configOnlyStripSecretsDeep(val);
    }
    return out;
  }
  return v;
}
const CONFIG_ONLY_GROUP_FEATURES=new Set(["share","sales","trendPost","pageGroupPost","pageSales","pageGroupComment","groupComment","groupInteract","groupPost"]);
function configOnlyStripGroupsDeep(task){
  // Trả bản sao task đã xóa nhóm CỨNG, giữ entry {auto} (tự phân giải theo
  // nick lúc chạy nên portable qua nick khác).
  try{
    const t=JSON.parse(JSON.stringify(task));
    const clean=c=>{if(c&&typeof c==="object"&&Array.isArray(c.groups))c.groups=c.groups.filter(g=>g&&typeof g.auto==="object");};
    clean(t.config);
    if(Array.isArray(t.steps))t.steps.forEach(s=>clean(s.config||s));
    return t;
  }catch{return task;}
}
async function buildConfigOnlyPayload(){
  const syncAll=await chrome.storage.sync.get(null).catch(()=>({}));
  const sync={};
  for(const [k,v] of Object.entries(syncAll||{})){
    if(CONFIG_ONLY_SECRET_KEYS.has(k))continue;
    // (2.11.10) Giá trị cũng phải quét đệ quy: secret có thể lồng trong
    // object con (hồ sơ AI, config từng tính năng) chứ không chỉ ở key gốc.
    sync[k]=configOnlyStripSecretsDeep(v);
  }
  if(Array.isArray(sync.aiProfiles))sync.aiProfiles=sync.aiProfiles.map(p=>({...p,key:""}));
  delete sync.salesScheduleProductIds;
  delete sync.pageSelected;
  const local={};
  const dropped=[];
  try{
    const keep=await chrome.storage.local.get(["salesProductsMeta","scheduledTasks","scheduleChainDraft"]).catch(()=>({}));
    if(Array.isArray(keep.salesProductsMeta))local.salesProductsMeta=configOnlyStripSecretsDeep(keep.salesProductsMeta);
    try{
      const everything=await chrome.storage.local.get(null).catch(()=>({}));
      for(const k of Object.keys(everything||{})){
        if(k.startsWith("pageSalesProductsMeta_"))local[k]=configOnlyStripSecretsDeep(everything[k]);
      }
    }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
    if(Array.isArray(keep.scheduledTasks)){
      local.scheduledTasks=[];
      for(const task of keep.scheduledTasks){
        if(!task||typeof task!=="object")continue;
        if(task.kind==="chain"){
          const steps=Array.isArray(task.steps)?task.steps:[];
          const keptSteps=steps.filter(s=>{
            const f=s?.feature||s?.config?.feature;
            if(!CONFIG_ONLY_GROUP_FEATURES.has(f))return true;
            const gs=Array.isArray(s?.config?.groups)?s.config.groups:[];
            return gs.some(g=>g&&typeof g.auto==="object");
          });
          if(!keptSteps.length){dropped.push(task.name||task.label||task.id||"chain");continue;}
          const t={...task,steps:keptSteps.map(s=>configOnlyStripGroupsDeep(s))};
          local.scheduledTasks.push(configOnlyStripSecretsDeep(configOnlyStripGroupsDeep(t)));
        }else if(CONFIG_ONLY_GROUP_FEATURES.has(task.feature)){
          const cleaned=configOnlyStripGroupsDeep(task);
          const leftovers=Array.isArray(cleaned.config?.groups)?cleaned.config.groups.length:0;
          if(!leftovers){dropped.push(task.name||task.label||task.feature||task.id);continue;}
          local.scheduledTasks.push(configOnlyStripSecretsDeep(cleaned));
        }else{
          local.scheduledTasks.push(configOnlyStripSecretsDeep(configOnlyStripGroupsDeep(task)));
        }
      }
    }
    if(Array.isArray(keep.scheduleChainDraft))local.scheduleChainDraft=configOnlyStripSecretsDeep(keep.scheduleChainDraft);
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  return {sync,local,dropped};
}
function downloadJsonFile(name,obj){
  const blob=new Blob([JSON.stringify(obj)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function importConfigOnlyPayload(payload,fileName){
  // 0. Tự backup cấu hình hiện tại trước khi ghi đè (phòng muốn về lại).
  try{
    const cur=await buildConfigOnlyPayload();
    downloadJsonFile(`fb-auto-config-BEFORE-IMPORT-${new Date().toISOString().slice(0,10)}.json`,{_version:2,_profile:"config-only",_exportedAt:new Date().toISOString(),sync:cur.sync,local:cur.local});
  }catch (e) { console.debug("[Auto vjp][popup] bỏ qua lỗi:", e); }
  if(!confirm(`Nhập cấu hình (không key) từ "${fileName}"?\nCấu hình hiện tại sẽ bị ghi đè (đã tự tải 1 bản backup). Key và nhóm của máy này được giữ nguyên.`))return;
  showBackupStatus("⏳ Đang nhập cấu hình...");
  const syncIn={...(payload.sync||{})};
  // Phòng file bị sửa tay: quét lại secrets + license.
  for(const k of CONFIG_ONLY_SECRET_KEYS)delete syncIn[k];
  // 1. Hồ sơ AI: chỉ mang sang profile ĐƯỢC mapping trỏ tới (tránh rác trùng
  // provider), id mới để không đụng nick gốc; key nick này giữ nguyên.
  let addedProfiles=0;
  try{
    const stored=await chrome.storage.sync.get(["aiProfiles","aiDefaultProfileId","aiProfileByFeature"]).catch(()=>({}));
    const incoming=Array.isArray(syncIn.aiProfiles)?syncIn.aiProfiles:[];
    const inMap=(syncIn.aiProfileByFeature&&typeof syncIn.aiProfileByFeature==="object")?syncIn.aiProfileByFeature:{};
    // Tên profile cần mang: có trong mapping file (không thì lấy hết nếu file không mapping).
    let needed=new Set();
    for(const pid of Object.values(inMap)){
      const src=incoming.find(p=>p&&p.id===pid);
      if(src&&String(src.name||"").trim())needed.add(String(src.name).trim().toLowerCase());
    }
    if(!needed.size)for(const p of incoming){if(p&&String(p.name||"").trim())needed.add(String(p.name).trim().toLowerCase());}
    const base=Array.isArray(stored.aiProfiles)?stored.aiProfiles.map(sanitizeAiProfile).filter(p=>p.key||p.model||p.provider==="meta-free"):[];
    if(!base.length){
      // Nick2 trắng: dựng default từ default file (không key) hoặc gemini rỗng.
      const inDef=incoming.find(p=>p&&p.id===stored.aiDefaultProfileId)||incoming[0];
      base.push(sanitizeAiProfile({...(inDef||{name:"Mặc định",provider:"gemini"}),key:"",id:undefined}));
    }
    const byName=new Map(base.map(p=>[String(p.name||"").toLowerCase(),p]));
    for(const name of needed){
      if(byName.has(name))continue;
      const src=incoming.find(p=>String(p?.name||"").trim().toLowerCase()===name);
      if(!src)continue;
      const prof=sanitizeAiProfile({...src,key:""});
      prof.id=aiProfileId();
      base.push(prof);byName.set(name,prof);addedProfiles++;
    }
    let defaultId=stored.aiDefaultProfileId||"";
    if(!base.some(p=>p.id===defaultId))defaultId=base[0].id;
    const nameToId=new Map(base.map(p=>[String(p.name||"").toLowerCase(),p.id]));
    const curMap=(stored.aiProfileByFeature&&typeof stored.aiProfileByFeature==="object")?{...stored.aiProfileByFeature}:{};
    for(const [feat,pid] of Object.entries(inMap)){
      const src=(incoming.find(p=>p&&p.id===pid)||{});
      const targetId=nameToId.get(String(src.name||"").toLowerCase());
      if(targetId)curMap[feat]=targetId;
      else delete curMap[feat];
    }
    await saveAiProfilesState({profiles:base,defaultId,mapping:curMap});
  }catch(e){showBackupStatus("❌ Lỗi gộp hồ sơ AI: "+String(e?.message||e).slice(0,80),false);return;}
  delete syncIn.aiProfiles;delete syncIn.aiDefaultProfileId;delete syncIn.aiProfileByFeature;
  // 2. Ghi đè toàn bộ cấu hình còn lại.
  await chrome.storage.sync.set(syncIn).catch(()=>{});
  // 3. Local: chỉ các key cấu hình (sản phẩm chữ + lịch đã lọc), ghi từng key.
  const failed=[];
  for(const [k,v] of Object.entries(payload.local||{})){
    if(k==="salesProductsMeta"||k.startsWith("pageSalesProductsMeta_")||k==="scheduledTasks"||k==="scheduleChainDraft"){
      try{await chrome.storage.local.set({[k]:v});}
      catch{failed.push(k);}
    }
  }
  const nSched=Array.isArray(payload.local?.scheduledTasks)?payload.local.scheduledTasks.length:0;
  showBackupStatus(`✅ Đã nhập: ${Object.keys(syncIn).length} mục + ${addedProfiles} hồ sơ AI mới + ${nSched} lịch${failed.length?` (rớt ${failed.length} key)`:""} — chọn Page/nhóm rồi chạy, reload popup`);
  setTimeout(()=>location.reload(),2200);
}
if(importSettingsFile)importSettingsFile.onchange=async(e)=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const text=await file.text();
    const payload=JSON.parse(text);
    if(!payload||(payload._version!==1&&payload._version!==2)||!payload.sync||!payload.local)throw new Error("File không hợp lệ");
    if(payload._profile==="config-only"){
      await importConfigOnlyPayload(payload,file.name);
      importSettingsFile.value="";
      return;
    }
    if(!confirm(`Nhập cài đặt từ "${file.name}"?\nSẽ ghi đè API key và config hiện tại.`)){importSettingsFile.value="";return;}
    showBackupStatus("⏳ Đang nhập...");
    await chrome.storage.sync.set(payload.sync||{});
    // local ghi từng key để 1 key quá quota không làm hỏng cả file
    const failed=[];
    for(const [k,v] of Object.entries(payload.local||{})){
      try{await chrome.storage.local.set({[k]:v});}
      catch(err){failed.push(k);}
    }
    let idbMsg="";
    if(payload.idb){
      try{
        const r=await restoreIdbFromImport(payload.idb);
        idbMsg=` + ${r.rows} IDB${r.media?` (+${r.media} media)`:""}`;
      }catch(err){idbMsg=" (IDB lỗi: "+String(err&&err.message||err).slice(0,60)+")";}
    }
    showBackupStatus(`✅ Đã nhập${failed.length?` (rớt ${failed.length} key: ${failed.slice(0,5).join(", ")})`:""}${idbMsg} — reload popup`);
    importSettingsFile.value="";
    setTimeout(()=>location.reload(),1800);
  }catch(err){showBackupStatus("❌ Lỗi nhập: "+err.message,false);importSettingsFile.value="";}
};

// ---- Pop-out: mở popup như 1 tab web riêng ----
(()=>{
  const btn=$("popoutBtn");
  if(!btn)return;
  // Nút luôn hiện — detect tab mode để add class is-tab (wide layout)
  chrome.tabs.getCurrent(tab=>{
    if(tab)document.body.classList.add("is-tab");
  });
  btn.onclick=()=>{
    chrome.tabs.create({url:chrome.runtime.getURL("popup.html")});
  };
})();

// ==== FRIEND REENGAGE (Tab Lấy Lại Tương Tác) — state riêng friendReengage* ====
(()=>{
  const startBtn=$("friendReengageStartBtn"),stopBtn=$("friendReengageStopBtn"),resetBtn=$("friendReengageResetBtn");
  const statusEl=$("friendReengageStatus"),countEl=$("friendReengageCount");
  const modeSel=$("friendReengageMode");
  const frLikeIds=["friendReengageLikePerDay","friendReengageLikePerFriend"];
  const frCmtIds=["friendReengageCommentPerDay","friendReengageCommentPerFriend","friendReengagePrompt"];
  function frSetOff(id,off){const el=$(id);if(!el)return;el.disabled=off;el.classList.toggle("fr-off",off);const lab=el.previousElementSibling;if(lab&&lab.tagName==="LABEL")lab.classList.toggle("fr-off",off);}
  function refreshModeFields(){const m=modeSel?modeSel.value:"like";const likeOn=(m==="like"||m==="both"),cmtOn=(m==="comment"||m==="both");frLikeIds.forEach(id=>frSetOff(id,!likeOn));frCmtIds.forEach(id=>frSetOff(id,!cmtOn));}
  if(modeSel)modeSel.addEventListener("change",refreshModeFields);
  const headerProgress=$("friendReengageHeaderProgress"),headerCount=$("friendReengageHeaderCount"),headerStatus=$("friendReengageHeaderStatus"),headerStopBtn=$("friendReengageHeaderStopBtn"),appHeader=document.querySelector(".app-header");
  const SYNC_KEYS=["friendReengageMode","friendReengageLikePerDay","friendReengageLikePerFriend","friendReengageCommentPerDay","friendReengageCommentPerFriend","friendReengageLikeSource","friendReengageCommentSource","friendReengageRecentDays","friendReengageDeadDays","friendReengageLikeCooldownDays","friendReengageCommentCooldownDays","friendReengageLikeToCommentGapDays","friendReengageCommentToLikeGapDays","friendReengageDelayFriendMin","friendReengageDelayFriendMax","friendReengageDelayPostMin","friendReengageDelayPostMax","friendReengageEndMode","friendReengageRestDays","friendReengagePrompt","friendReengageStoryEnabled","friendReengageStoryPerDay","friendReengageStoryViewSec","friendReengageStoryReaction","friendReengageStoryHours"];
  const LOCAL_KEYS=["friendReengageActive","friendReengageRunId","friendReengageOwnerTabId","friendReengageConfig","friendReengageDoneLike","friendReengageDoneComment","friendReengageDoneStory","friendReengageSkipped","friendReengageStatus","friendReengageCursor","friendReengageCycle"];
  if(!startBtn||!statusEl)return;
  function setRunning(v){try{startBtn.textContent=v?"⏳ Đang chạy…":"▶ Bắt đầu";startBtn.classList.toggle("running",!!v);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
  function paintHeader(s){
    const active=!!s.friendReengageActive;
    if(headerProgress)headerProgress.classList.toggle("hidden",!active);
    if(appHeader)appHeader.classList.toggle("reengage-running",active);
    if(!active)return;
    const cfg=s.friendReengageConfig||{},mode=String(cfg.mode||"like"),parts=[];
    if(mode==="like"||mode==="both")parts.push(`👍 ${Number(s.friendReengageDoneLike)||0}/${Math.max(1,parseInt(cfg.likePerDay)||25)}`);
    if(mode==="comment"||mode==="both")parts.push(`💬 ${Number(s.friendReengageDoneComment)||0}/${Math.max(1,parseInt(cfg.commentPerDay)||12)}`);
    if(mode==="story"||cfg.storyEnabled)parts.push(`📸 ${Number(s.friendReengageDoneStory)||0}/${Math.max(1,parseInt(cfg.storyPerDay)||20)}`);
    if(headerCount)headerCount.textContent=parts.join(" · ");
    if(headerStatus){headerStatus.textContent=String(s.friendReengageStatus||"Đang chuẩn bị…");headerStatus.title=headerStatus.textContent;}
    if(headerStopBtn){headerStopBtn.title=t("rc.stop");headerStopBtn.setAttribute("aria-label",t("rc.stop"));}
  }
  function paint(s){
    try{
      const like=Number(s.friendReengageDoneLike)||0, cmt=Number(s.friendReengageDoneComment)||0, story=Number(s.friendReengageDoneStory)||0;
      if(countEl)countEl.textContent=like+" 👍 • "+cmt+" 💬 • "+story+" 📸 • skip "+(Number(s.friendReengageSkipped)||0);
      if(statusEl&&s.friendReengageStatus)statusEl.textContent=String(s.friendReengageStatus);
      setRunning(!!s.friendReengageActive);
      paintHeader(s);
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  async function readSync(){
    const out={};
    for(const id of SYNC_KEYS){const el=$(id);if(!el)continue;out[id]=el.type==="checkbox"?el.checked:el.value;}
    // Chuẩn hóa trần an toàn (không cho vượt 50/ngày).
    out.friendReengageLikePerDay=Math.min(100000,Math.max(1,parseInt(out.friendReengageLikePerDay)||25));
    out.friendReengageCommentPerDay=Math.min(100000,Math.max(1,parseInt(out.friendReengageCommentPerDay)||12));
    return out;
  }
  async function persistSync(cfg){try{await chrome.storage.sync.set(cfg);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
  if(startBtn)startBtn.onclick=async()=>{
    const syncCfg=await readSync();await persistSync(syncCfg);
    const num=(id,fallback)=>{const raw=syncCfg[id];if(raw===undefined||raw===null||String(raw).trim()==="")return fallback;const n=Number(raw);return Number.isFinite(n)?n:fallback;};
    const cfg={mode:String(syncCfg.friendReengageMode||"like"),likePerDay:num("friendReengageLikePerDay",25),likePerFriend:num("friendReengageLikePerFriend",2),commentPerDay:num("friendReengageCommentPerDay",12),commentPerFriend:num("friendReengageCommentPerFriend",1),likeSource:String(syncCfg.friendReengageLikeSource||"new"),commentSource:String(syncCfg.friendReengageCommentSource||"liked"),recentDays:num("friendReengageRecentDays",14),deadDays:num("friendReengageDeadDays",90),likeCooldownDays:num("friendReengageLikeCooldownDays",30),commentCooldownDays:num("friendReengageCommentCooldownDays",30),likeToCommentGapDays:num("friendReengageLikeToCommentGapDays",3),commentToLikeGapDays:num("friendReengageCommentToLikeGapDays",3),delayFriendMin:num("friendReengageDelayFriendMin",3),delayFriendMax:num("friendReengageDelayFriendMax",8),delayPostMin:num("friendReengageDelayPostMin",30),delayPostMax:num("friendReengageDelayPostMax",60),endMode:String(syncCfg.friendReengageEndMode||"stop"),restDays:num("friendReengageRestDays",10),prompt:String(syncCfg.friendReengagePrompt||""),storyEnabled:String(syncCfg.friendReengageStoryEnabled||"1")==="1",storyPerDay:num("friendReengageStoryPerDay",20),storyViewSec:num("friendReengageStoryViewSec",5),storyReaction:String(syncCfg.friendReengageStoryReaction||"random"),storyHours:num("friendReengageStoryHours",24),profileId:await aiProfileIdFor("friendReengage"),storyDelayMin:20,storyDelayMax:45};
    setRunning(true);statusEl.textContent="Đang mở danh sách bạn bè…";
    const runId="fr"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    try{
      const tabs=await chrome.tabs.query({url:["*://*.facebook.com/*"]});
      let tab=tabs&&tabs[0];
      if(!tab){statusEl.textContent="Mở 1 tab Facebook rồi bấm lại.";setRunning(false);return;}
       const cycleState=await chrome.storage.local.get("friendReengageCycle");
       const nextCycle=(Number(cycleState.friendReengageCycle)||0)+1;
       await chrome.storage.local.set({friendReengageActive:true,friendReengageRunId:runId,friendReengageOwnerTabId:tab.id,friendReengageConfig:cfg,friendReengageCycle:nextCycle,friendReengageIndex:0,friendReengageDoneLike:0,friendReengageDoneComment:0,friendReengageDoneStory:0,friendReengageSkipped:0,friendReengageCursor:"",friendReengageStatus:"Bắt đầu…"});
      await chrome.tabs.update(tab.id,{url:"https://www.facebook.com/friends/list/"});
      setTimeout(()=>{try{chrome.tabs.sendMessage(tab.id,{action:"startFriendReengage",config:cfg,runId,ownerTabId:tab.id},()=>{void chrome.runtime.lastError;});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }},3500);
      try{chrome.storage.local.set({popupLastTab:"reengage"});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    }catch(e){statusEl.textContent="Không khởi động được: "+String(e&&e.message||e).slice(0,120);setRunning(false);}
  };
  async function broadcast(msg){try{const tabs=await chrome.tabs.query({url:["*://*.facebook.com/*"]});for(const tb of tabs){try{await chrome.tabs.sendMessage(tb.id,msg);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
  if(stopBtn)stopBtn.onclick=async()=>{setRunning(false);await chrome.storage.local.set({friendReengageActive:false,friendReengageStatus:"Đã dừng."});broadcast({action:"stopFriendReengage"});};
  if(headerStopBtn)headerStopBtn.onclick=event=>{event.stopPropagation();if(stopBtn)stopBtn.click();};
  if(resetBtn)resetBtn.onclick=async()=>{setRunning(false);await chrome.storage.local.set({friendReengageActive:false,friendReengageRunId:"",friendReengageOwnerTabId:0,friendReengageIndex:0,friendReengageDoneLike:0,friendReengageDoneComment:0,friendReengageDoneStory:0,friendReengageSkipped:0,friendReengageCursor:"",friendReengageStatus:"Đã reset."});broadcast({action:"resetFriendReengage",keepHistory:false});paint(await chrome.storage.local.get(LOCAL_KEYS));};
  const viewLike=$("friendReengageViewLikeBtn"),viewCmt=$("friendReengageViewCommentBtn"),copyBtn=$("friendReengageCopyLikeBtn"),dsView=$("friendReengageDsView");
  async function showDs(kind){
    try{
      const s=await chrome.storage.local.get(["friendReengageLikeHistory","friendReengageCommentHistory"]);
      const h=kind==="like"?(s.friendReengageLikeHistory||{}):(s.friendReengageCommentHistory||{});
      const keys=Object.keys(h).filter(k=>!/:d\d+$/.test(k)&&h[k]&&!h[k].skip&&!h[k].attempted);
      if(dsView)dsView.textContent=(kind==="like"?"DS Like ":"DS Comment ")+keys.length+" bạn • mới nhất: "+keys.slice(-5).join(", ");
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  if(viewLike)viewLike.onclick=()=>showDs("like");
  if(viewCmt)viewCmt.onclick=()=>showDs("comment");
  if(copyBtn)copyBtn.onclick=async()=>{if(dsView)dsView.textContent="Đã chọn nguồn Comment = DS đã Like cho lần chạy sau (đổi dropdown Nguồn cho Comment sang 'Dùng lại DS đã Like').";try{await chrome.storage.sync.set({friendReengageCommentSource:"liked"});const el=$("friendReengageCommentSource");if(el)el.value="liked";}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }};
  (async()=>{
    try{
      const sync=await chrome.storage.sync.get(SYNC_KEYS);
      for(const id of SYNC_KEYS){const el=$(id);if(!el||sync[id]===undefined)continue;if(el.tagName==="SELECT"||el.tagName==="TEXTAREA"||el.tagName==="INPUT")el.value=sync[id];}
      refreshModeFields();
      const s=await chrome.storage.local.get(LOCAL_KEYS);paint(s);
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  })();
  try{
    chrome.storage.onChanged.addListener((ch,area)=>{
      if(area!=="local")return;
      if(ch.friendReengageStatus&&statusEl)statusEl.textContent=String(ch.friendReengageStatus.newValue||"");
      if(ch.friendReengageActive!==undefined)setRunning(!!ch.friendReengageActive.newValue);
      if(ch.friendReengageActive||ch.friendReengageConfig||ch.friendReengageStatus||ch.friendReengageDoneLike||ch.friendReengageDoneComment||ch.friendReengageDoneStory||ch.friendReengageSkipped)chrome.storage.local.get(LOCAL_KEYS).then(paint).catch(()=>{});
    });
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  const schedBtn=$("friendReengageScheduleBtn");
  if(schedBtn)schedBtn.onclick=async()=>{
    const st=$("friendReengageScheduleStatus");const when=$("friendReengageScheduleWhen");
    try{
      if(typeof createFeatureSchedule==="function"){
        const syncCfg=await readSync();
        await createFeatureSchedule("friendReengage",{when:when&&when.value?new Date(when.value).getTime():Date.now()+3600000,config:syncCfg});
        if(st)st.textContent="Đã tạo lịch.";
      }else if(st)st.textContent="Mở tab Lịch chạy để hẹn (tính năng lịch dùng chung).";
    }catch(e){if(st)st.textContent="Lỗi lịch: "+String(e&&e.message||e).slice(0,100);}
  };
})();

// === Làm ấm trước khi kết bạn (FoF): state riêng friendWarm*, không dùng chung
// state/counter của FoF send hay reengage. Chỉ đọc friendFoFCandidates, chỉ ghi
// friendWarmHistory sau proof Facebook.
(()=>{
  const startBtn=$("friendWarmStartBtn"),stopBtn=$("friendWarmStopBtn"),
    resetBtn=$("friendWarmResetBtn"),viewBtn=$("friendWarmViewBtn"),
    clearBtn=$("friendWarmClearBtn"),
    statusEl=$("friendWarmStatus"),countEl=$("friendWarmCount"),dsView=$("friendWarmDsView");
  const modeSel=$("friendWarmMode");
  if(!startBtn||!statusEl)return;
  const SYNC_KEYS=["friendWarmMode","friendWarmTarget","friendWarmMinMutual","friendWarmLikePerPerson","friendWarmCommentPerPerson","friendWarmDelayMin","friendWarmDelayMax","friendWarmPostMin","friendWarmPostMax","friendWarmPrompt"];
  const LOCAL_KEYS=["friendWarmActive","friendWarmDoneLike","friendWarmDoneComment","friendWarmSkipped","friendWarmStatus","friendWarmConfig"];
  const WARM_LIKE_IDS=["friendWarmLikePerPerson"];
  const WARM_CMT_IDS=["friendWarmPrompt","friendWarmCommentPerPerson"];
  function warmSetOff(id,off){const el=$(id);if(!el)return;el.disabled=off;el.classList.toggle("fr-off",off);}
  // Chỉ mờ ô không dùng theo chế độ (mẫu v1.9.401); các ô số KHÔNG trần nên
  // không bao giờ disabled vì giá trị — hint gợi ý bên dưới mỗi ô.
  function refreshModeFields(){
    const m=modeSel?modeSel.value:"like";
    const likeOn=(m==="like"||m==="both"),cmtOn=(m==="comment"||m==="both");
    WARM_LIKE_IDS.forEach(id=>warmSetOff(id,!likeOn));
    WARM_CMT_IDS.forEach(id=>warmSetOff(id,!cmtOn));
  }
  if(modeSel)modeSel.addEventListener("change",refreshModeFields);
  function setRunning(v){try{startBtn.innerHTML=v?"⏳ "+t("c.stop"):t("fr.start");startBtn.classList.toggle("running",!!v);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
  function paint(s){
    try{
      const like=Number(s.friendWarmDoneLike)||0,cmt=Number(s.friendWarmDoneComment)||0;
      if(countEl)countEl.textContent=like+" 👍 • "+cmt+" 💬 • skip "+(Number(s.friendWarmSkipped)||0);
      if(statusEl&&s.friendWarmStatus)statusEl.textContent=String(s.friendWarmStatus);
      setRunning(!!s.friendWarmActive);
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  }
  async function broadcast(msg){try{const tabs=await chrome.tabs.query({url:["*://*.facebook.com/*"]});for(const tb of tabs){try{await chrome.tabs.sendMessage(tb.id,msg);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }}
  if(startBtn)startBtn.onclick=async()=>{
    const syncCfg={};
    for(const id of SYNC_KEYS){const el=$(id);if(el)syncCfg[id]=el.value;}
    try{await chrome.storage.sync.set(syncCfg);}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    // Không kẹp trần: chỉ chặn sàn, số lớn do user tự chịu trách nhiệm.
    const num=(v,fb,lo)=>{const n=Number(v);return Number.isFinite(n)?Math.max(lo,n):fb;};
    const cfg={
      mode:["like","comment","both"].includes(syncCfg.friendWarmMode)?syncCfg.friendWarmMode:"like",
      target:num(syncCfg.friendWarmTarget,20,1),
      minMutual:num(syncCfg.friendWarmMinMutual,0,0),
      likePerPerson:num(syncCfg.friendWarmLikePerPerson,1,1),
      commentPerPerson:num(syncCfg.friendWarmCommentPerPerson,1,1),
      delayMin:num(syncCfg.friendWarmDelayMin,3,0),
      delayMax:Math.max(num(syncCfg.friendWarmDelayMax,8,0),num(syncCfg.friendWarmDelayMin,3,0)),
      postMin:num(syncCfg.friendWarmPostMin,30,0),
      postMax:Math.max(num(syncCfg.friendWarmPostMax,60,0),num(syncCfg.friendWarmPostMin,30,0)),
      prompt:String(syncCfg.friendWarmPrompt||""),
      profileId:await aiProfileIdFor("friendWarm"),
    };
    if(cfg.delayMin>cfg.delayMax||cfg.postMin>cfg.postMax){statusEl.textContent=t("p.gjBadDelay");return;}
    // Nguồn chung với FoF: link nhập tay hoặc nguồn đã chọn trong DS bạn bè.
    let source=null;
    try{
      if(typeof friendFoFKind!=="undefined"&&friendFoFKind==="mine"){
        source=selectedFriendFoFSource();
      }else{
        const url=(typeof friendFoFSourceLink!=="undefined"&&friendFoFSourceLink)?friendFoFSourceLink.value.trim():"";
        if(url)source={url};
      }
    }catch(_){source=null;}
    if(!source||!source.url){statusEl.textContent=t("fr.warmNeedSource");return;}
    try{await chrome.storage.sync.set({friendWarmSourceName:source.name||""});}catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
    const busy=await chrome.storage.local.get(["isRunning","friendConfirmActive","friendFoFActive","friendFoFScanActive","isFeedInteracting","isAICommenting","isGroupJoining","isDiscoverJoining","groupInteractActive","groupCommentActive","groupPostActive","groupShareActive","salesPostActive","trendLearnActive","trendPostActive","friendReengageActive"]);
    if(Object.values(busy).some(Boolean)){statusEl.textContent=t("fr.warmBusy");return;}
    const tab=await getActiveTab();
    if(!tab?.url?.includes("facebook.com")){statusEl.textContent=t("fr.warmNeedFb");return;}
    setRunning(true);statusEl.textContent=t("fr.warmStarted",{n:"…"});
    const runId="fw"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    try{
      const resp=await sendFriendCommand(tab,{action:"startFriendWarm",config:{...cfg,source},runId,ownerTabId:tab.id});
      if(resp?.ok){statusEl.textContent=t("fr.warmStarted",{n:source.name||source.url||""});}
      else{setRunning(false);statusEl.textContent=resp?.error||t("fr.warmNeedSource");}
    }catch(e){setRunning(false);statusEl.textContent=String(e&&e.message||e).slice(0,160);}
  };
  if(stopBtn)stopBtn.onclick=async()=>{setRunning(false);await chrome.storage.local.set({friendWarmActive:false,friendWarmStatus:t("fr.warmStopped")});broadcast({action:"stopFriendWarm"});};
  if(resetBtn)resetBtn.onclick=async()=>{
    setRunning(false);
    await chrome.storage.local.set({friendWarmActive:false,friendWarmRunId:"",friendWarmOwnerTabId:0,friendWarmSource:null,friendWarmListUrl:"",friendWarmPhase:"source-profile",friendWarmQueue:[],friendWarmQIndex:0,friendWarmDoneLike:0,friendWarmDoneComment:0,friendWarmSkipped:0,friendWarmTouched:[],friendWarmPendingWall:null,friendWarmScrollRounds:0,friendWarmEndConfirmations:0,friendWarmNextAllowedAt:0,friendWarmStatus:t("fr.warmResetDone")});
    broadcast({action:"resetFriendWarm",keepHistory:true});
    paint(await chrome.storage.local.get(LOCAL_KEYS));
  };
  if(viewBtn)viewBtn.onclick=async()=>{
    try{
      const s=await chrome.storage.local.get(["friendWarmHistory"]);
      const h=s.friendWarmHistory||{};
      const keys=Object.keys(h).filter(k=>h[k]&&(h[k].like||h[k].comment));
      if(dsView)dsView.textContent=keys.length?t("fr.warmHistoryCount",{n:keys.length,latest:keys.slice(-5).join(", ")}):t("fr.warmHistoryEmpty");
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  };
  if(clearBtn)clearBtn.onclick=async()=>{
    await chrome.storage.local.set({friendWarmHistory:{},friendWarmDead:{}});
    broadcast({action:"resetFriendWarm"});
    if(dsView)dsView.textContent=t("fr.warmHistoryCleared");
    paint(await chrome.storage.local.get(LOCAL_KEYS));
  };
  (async()=>{
    try{
      const sync=await chrome.storage.sync.get(SYNC_KEYS);
      for(const id of SYNC_KEYS){const el=$(id);if(!el||sync[id]===undefined)continue;el.value=sync[id];}
      refreshModeFields();
      paint(await chrome.storage.local.get(LOCAL_KEYS));
    }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
  })();
  try{
    chrome.storage.onChanged.addListener((ch,area)=>{
      if(area!=="local")return;
      if(ch.friendWarmStatus&&statusEl)statusEl.textContent=String(ch.friendWarmStatus.newValue||"");
      if(ch.friendWarmActive!==undefined)setRunning(!!ch.friendWarmActive.newValue);
      if(ch.friendWarmActive||ch.friendWarmDoneLike||ch.friendWarmDoneComment||ch.friendWarmSkipped||ch.friendWarmStatus)chrome.storage.local.get(LOCAL_KEYS).then(paint).catch(()=>{});
    });
  }catch(_){ console.debug("[Auto vjp][popup] bỏ qua lỗi:", _); }
})();
