// library.js - Kho dữ liệu cào: xem/lọc/tải/xóa dataset, xem media, tạo hồ sơ
// văn phong từ bộ lọc. Chạy trong extension page nên dùng trực tiếp IndexedDB
// (globalThis.ScrapeStore) — không cần round-trip qua background; media blob
// cũng đọc thẳng từ IDB mà không mất dữ liệu nhị phân khi qua message.
(() => {
  const $ = id => document.getElementById(id);
  const libEsc = value => String(value || "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const classBadge = c => {
    const label = { text: t("lib.fText"), textBg: t("lib.fTextBg"), photo: t("lib.fPhoto"), video: t("lib.fVideo") }[c] || t("lib.fOther");
    return `<span class="badge ${libEsc(c || "other")}">${libEsc(label)}</span>`;
  };
  let currentDatasetId = null;
  let postsCache = [];
  let mediaCache = [];
  let objectUrls = [];
  // Bài do người dùng tự tay tick chọn (để "Học văn phong" AI học đúng những
  // bài họ ưng ý, không bắt buộc học cả bộ lọc). Rỗng = dùng toàn bộ bài đang
  // hiển thị theo bộ lọc (hành vi cũ, vẫn giữ để không phá luồng có sẵn).
  let selectedIds = new Set();

  function revokeObjectUrls() {
    objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
    objectUrls = [];
  }
  function blobUrl(blob) {
    if (!blob) return "";
    if (objectUrls.length > 400) {
      const old = objectUrls.shift();
      try { URL.revokeObjectURL(old); } catch (_) {}
    }
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return url;
  }
  function message(request) {
    return new Promise(resolve => chrome.runtime.sendMessage(request, response => resolve(response || { ok: false })));
  }
  function download(content, filename, mime) {
    const blob = new Blob([content], { type: (mime || "text/plain") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function filteredPosts() {
    const search = String($("libSearch").value || "").toLowerCase();
    const classes = [];
    if ($("libFText").checked) classes.push("text");
    if ($("libFTextBg").checked) classes.push("textBg");
    if ($("libFPhoto").checked) classes.push("photo");
    if ($("libFVideo").checked) classes.push("video");
    return postsCache.filter(p => {
      const c = String(p.contentClass || "text");
      if (classes.length && !classes.includes(c)) return false;
      if (search) {
        const hay = `${p.text || ""} ${p.author || ""} ${p.link || ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  async function renderDatasets() {
    const el = $("libDatasets");
    const res = await ScrapeStore.list("datasets", 500);
    const datasets = (Array.isArray(res) ? res : []).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    if (!datasets.length) { el.innerHTML = `<div class="hint">${t("lib.noData")}</div>`; return; }
    el.innerHTML = datasets.map(ds => {
      const id = String(ds.id || "");
      const c = ds.contentClassCounts || {};
      const meta = `${ds.postCount || 0} bài · ${c.text || 0}/${c.textBg || 0}/${c.photo || 0}/${c.video || 0}${ds.commentCount ? ` · 💬 ${ds.commentCount}` : ""} · ${new Date(Number(ds.updatedAt) || Date.now()).toLocaleString()}`;
      return `<div class="ds ${id === currentDatasetId ? "active" : ""}" data-id="${libEsc(id)}">
        <b>${libEsc(String(ds.sourceTitle || ds.sourceKey || id))}</b>
        <div class="meta">${libEsc(meta)}</div>
        <div class="row">
          <button class="primary view" data-id="${libEsc(id)}">📂 ${t("lib.view")}</button>
          <button class="dl" data-id="${libEsc(id)}">⬇ ${t("lib.download")}</button>
          <button class="danger del" data-id="${libEsc(id)}">🗑 ${t("lib.del")}</button>
        </div>
      </div>`;
    }).join("");
  }

  async function selectDataset(id) {
    currentDatasetId = id;
    revokeObjectUrls();
    postsCache = (await ScrapeStore.listPosts(id, 20000)) || [];
    mediaCache = (await ScrapeStore.listMedia(id, 5000)) || [];
    selectedIds = new Set();
    renderPosts();
    renderMedia();
    renderDatasets();
    updateSelectCount();
  }

  function selectedOrFiltered() {
    const filtered = filteredPosts();
    if (!selectedIds.size) return filtered;
    const chosen = filtered.filter(p => selectedIds.has(String(p.id || "")));
    return chosen.length ? chosen : filtered;
  }

  function updateSelectCount() {
    const el = $("libSelectCount");
    if (!el) return;
    el.textContent = selectedIds.size ? t("lib.selectedN", { n: selectedIds.size }) : t("lib.selectNone");
  }

  function mediaForPost(postKey, kind) {
    return mediaCache.filter(m => String(m.postKey) === String(postKey) && m.kind === kind);
  }

  function renderPosts() {
    const el = $("libPosts");
    const posts = filteredPosts();
    if (!posts.length) { el.innerHTML = `<div class="hint">${t("lib.noPosts")}</div>`; return; }
    el.innerHTML = posts.map((p, i) => {
      const id = String(p.id || "");
      const checked = selectedIds.has(id) ? "checked" : "";
      const text = String(p.text || "");
      const brief = text.length > 240 ? text.slice(0, 240) + "…" : text;
      const cCount = Array.isArray(p.comments) ? p.comments.length : 0;
      const cBadge = cCount ? ` <span title="${libEsc(t("lib.comments", { n: cCount }))}">💬${cCount}</span>` : "";
      const briefHtml = `<div class="head"><input type="checkbox" class="selChk" ${checked}> ${classBadge(p.contentClass)} <b>${libEsc(String(p.author || ""))}</b> ${libEsc(String(p.time || ""))}${cBadge}</div><div class="text">${libEsc(brief)}</div>`;
      return `<div class="post${selectedIds.has(id) ? " selected" : ""}" data-i="${i}" data-id="${libEsc(id)}" data-brief="${libEsc(briefHtml)}">${briefHtml}</div>`;
    }).join("");
    el.querySelectorAll(".post").forEach(node => {
      node.querySelector(".selChk").addEventListener("click", ev => {
        ev.stopPropagation();
        toggleSelect(node.dataset.id, node, ev.target.checked);
      });
      node.addEventListener("click", () => openPostDetail(Number(node.dataset.i), node));
    });
  }

  function toggleSelect(id, node, on) {
    if (on) selectedIds.add(id); else selectedIds.delete(id);
    if (node) node.classList.toggle("selected", on);
    updateSelectCount();
  }

  function openPostDetail(i, node) {
    if (node.classList.contains("detail")) return;
    const posts = filteredPosts();
    const p = posts[i];
    if (!p) return;
    node.classList.add("detail");
    node.innerHTML = "";
    // `p.id` đã bị gắn tiền tố "<datasetId>::" khi lưu (xem scrapeStore.saveRun),
    // còn media được lưu theo id GỐC (postKey) — ưu tiên field postKey mới; với
    // dataset cào từ trước khi có field này, tự tách bỏ tiền tố để vẫn khớp được.
    const prefix = currentDatasetId ? `${currentDatasetId}::` : "";
    const rawId = String(p.id || "");
    const postKey = String(p.postKey || (prefix && rawId.startsWith(prefix) ? rawId.slice(prefix.length) : rawId)).slice(0, 120);
    let html = `<div class="text">${libEsc(String(p.text || ""))}</div>`;
    const images = mediaForPost(postKey, "image");
    const poster = mediaForPost(postKey, "poster");
    const mediaHtml = [];
    images.forEach(m => mediaHtml.push(`<img src="${libEsc(blobUrl(m.blob))}" alt="media">`));
    poster.forEach(m => mediaHtml.push(`<img src="${libEsc(blobUrl(m.blob))}" alt="poster">`));
    if (!mediaHtml.length && Array.isArray(p.images) && p.images.length) {
      p.images.slice(0, 12).forEach(src => mediaHtml.push(`<img src="${libEsc(src)}" alt="media" loading="lazy">`));
    }
    if (mediaHtml.length) html += `<div class="media">${mediaHtml.join("")}</div>`;
    if (p.video) {
      const dur = p.video.durationText ? ` · ${libEsc(p.video.durationText)}` : "";
      html += `<div class="hint">🎬 ${t("lib.video")}${dur}</div>`;
      if (p.video.permalink) html += `<div class="hint">${t("lib.permalink")} <a href="${libEsc(p.video.permalink)}" target="_blank" rel="noopener">${libEsc(p.video.permalink)}</a></div>`;
    }
    if (p.link) html += `<div class="hint">${t("lib.permalink")} <a href="${libEsc(p.link)}" target="_blank" rel="noopener">${libEsc(p.link)}</a></div>`;
    if (Array.isArray(p.comments) && p.comments.length) {
      const items = p.comments.slice(0, 100).map(c => `<div class="hint" style="margin:2px 0">💬 <b>${libEsc(String(c.author || "?"))}</b>${c.time ? ` <span>(${libEsc(String(c.time))})</span>` : ""}: ${libEsc(String(c.text || ""))}</div>`).join("");
      const more = p.comments.length > 100 ? `<div class="hint">… +${p.comments.length - 100}</div>` : "";
      html += `<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:700">${libEsc(t("lib.comments", { n: p.comments.length }))}</summary><div style="max-height:300px;overflow:auto">${items}${more}</div></details>`;
    }
    html += `<div class="actions"><button class="copy">📋 ${t("lib.copy")}</button><button class="collapse">${t("lib.collapse")}</button></div>`;
    node.innerHTML = html;
    node.querySelector(".copy").addEventListener("click", ev => {
      ev.stopPropagation();
      try { navigator.clipboard.writeText(String(p.text || "")); } catch (_) {}
    });
    node.querySelector(".collapse").addEventListener("click", ev => {
      ev.stopPropagation();
      node.classList.remove("detail");
      node.innerHTML = node.dataset.brief || "";
      // innerHTML replace không giữ listener cũ trên checkbox chọn bài -> gắn lại.
      const chk = node.querySelector(".selChk");
      if (chk) chk.addEventListener("click", ev2 => {
        ev2.stopPropagation();
        toggleSelect(node.dataset.id, node, ev2.target.checked);
      });
    });
  }

  function renderMedia() {
    const el = $("libMedia");
    revokeObjectUrls();
    const items = mediaCache || [];
    if (!items.length) { el.innerHTML = `<div class="hint">${t("lib.noMedia")}</div>`; return; }
    const images = items.filter(m => m.kind === "image" || m.kind === "poster");
    const videos = items.filter(m => m.kind === "video");
    const parts = [];
    if (images.length) {
      parts.push(images.slice(0, 400).map(m => {
        const size = m.bytes ? (Number(m.bytes) / 1048576).toFixed(2) + " MB" : "";
        return `<div class="mediaItem"><img src="${libEsc(blobUrl(m.blob))}" alt="media"><div>${libEsc(size)}</div></div>`;
      }).join(""));
    }
    if (videos.length) {
      parts.push(videos.slice(0, 50).map(m => {
        const u = String(m.sourceUrl || "");
        const short = u.length > 60 ? u.slice(0, 60) + "…" : u;
        const posterHtml = m.posterUrl ? `<img src="${libEsc(m.posterUrl)}" alt="poster" loading="lazy">` : "";
        return `<div class="mediaItem">${posterHtml}<div class="hint">${libEsc(short)}</div><button class="primary vid" data-url="${libEsc(u)}">⬇ ${t("lib.dlVideo")}</button></div>`;
      }).join(""));
    }
    el.innerHTML = parts.join("");
    el.querySelectorAll(".vid").forEach(btn => {
      btn.addEventListener("click", () => downloadVideo(btn.dataset.url, btn));
    });
  }

  async function downloadVideo(url, btn) {
    const old = btn.textContent;
    btn.textContent = t("lib.downloading");
    btn.disabled = true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      if (blob.size > 80 * 1024 * 1024) throw new Error(t("lib.tooBig"));
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = `fb_video_${Date.now()}.mp4`;
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
      btn.textContent = t("lib.dlDone");
    } catch (e) {
      btn.textContent = t("lib.dlErr", { err: String(e?.message || e) });
    } finally { setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 4000); }
  }

  function buildMD(name, posts) {
    let md = `${t("lib.mdTitle")} ${new Date().toLocaleString()}\n\n${t("lib.mdHead", { src: name, n: posts.length })}`;
    posts.forEach((p, i) => {
      md += `## ${i + 1}. ${p.author || ""}${p.time ? " - " + p.time : ""}\n\n`;
      if (p.link) md += `Link: ${p.link}\n\n`;
      md += `${String(p.text || "").replace(/\s{2,}/g, " ").trim()}\n\n`;
      if (Array.isArray(p.images) && p.images.length) p.images.slice(0, 12).forEach(img => md += `![anh](${img})\n`);
      if (Array.isArray(p.comments) && p.comments.length) {
        md += `\n${t("lib.comments", { n: p.comments.length })}\n`;
        p.comments.forEach(c => { md += `- **${c.author || "?"}**${c.time ? ` (${c.time})` : ""}: ${c.text || ""}\n`; });
      }
      md += "\n---\n\n";
    });
    return md;
  }
  function buildTXT(posts) {
    return posts.map((p, i) => {
      let s = `=== ${t("lib.post")} ${i + 1} ===\n${t("lib.author")} ${p.author || ""}\n${t("lib.time")} ${p.time || ""}\nLink: ${p.link || ""}\n${t("lib.content")}\n${p.text || ""}\n`;
      if (Array.isArray(p.comments) && p.comments.length) s += `${t("lib.comments", { n: p.comments.length })}\n` + p.comments.map(c => `- ${c.author || "?"}${c.time ? ` (${c.time})` : ""}: ${c.text || ""}`).join("\n") + "\n";
      return s;
    }).join("\n----------------\n\n");
  }
  function fileNameBase(ds, ext) {
    const name = String(ds?.sourceTitle || ds?.id || "dataset").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "dataset";
    return `fb_scan_${name}_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.${ext}`;
  }
  async function exportDataset(id, format) {
    const ds = await ScrapeStore.get("datasets", id);
    const posts = (await ScrapeStore.listPosts(id, 20000)) || [];
    if (!posts.length) throw new Error(t("lib.noPosts"));
    if (format === "md") download(buildMD(String(ds?.sourceTitle || id), posts), fileNameBase(ds, "md"), "text/markdown");
    else if (format === "txt") download(buildTXT(posts), fileNameBase(ds, "txt"), "text/plain");
    else download(JSON.stringify({ source: ds?.sourceUrl || "", datasetId: id, exportedAt: new Date().toISOString(), count: posts.length, dataset: ds, posts }, null, 2), fileNameBase(ds, "json"), "application/json");
  }
  function exportFiltered(format) {
    const ds = { sourceTitle: currentDatasetId ? currentDatasetId : "filter" };
    const posts = selectedOrFiltered();
    if (!posts.length) { $("libProfileStatus").textContent = t("lib.noPosts"); return; }
    if (format === "md") download(buildMD(String(ds.sourceTitle), posts), fileNameBase(ds, "md"), "text/markdown");
    else if (format === "txt") download(buildTXT(posts), fileNameBase(ds, "txt"), "text/plain");
    else download(JSON.stringify({ source: ds.sourceTitle, exportedAt: new Date().toISOString(), count: posts.length, posts }, null, 2), fileNameBase(ds, "json"), "application/json");
  }

  async function deleteDataset(id) {
    const ds = await ScrapeStore.get("datasets", id);
    const label = String(ds?.sourceTitle || ds?.sourceKey || id);
    if (!confirm(t("lib.confirmDel", { name: label }))) return;
    await ScrapeStore.remove("datasets", id);
    await ScrapeStore.removePosts(id);
    await ScrapeStore.removeMedia(id);
    if (currentDatasetId === id) {
      currentDatasetId = null;
      postsCache = [];
      mediaCache = [];
      revokeObjectUrls();
      $("libPosts").innerHTML = `<div class="hint">${t("lib.noPosts")}</div>`;
      $("libMedia").innerHTML = `<div class="hint">${t("lib.noMedia")}</div>`;
    }
    renderDatasets();
  }

  async function buildProfileFromFilter() {
    const status = $("libProfileStatus");
    const posts = selectedOrFiltered();
    if (posts.length < 3) { status.textContent = t("lib.need3"); return; }
    const name = prompt(t("lib.profileName"), "");
    if (!name) return;
    const classes = [];
    if ($("libFText").checked) classes.push("text");
    if ($("libFTextBg").checked) classes.push("textBg");
    if ($("libFPhoto").checked) classes.push("photo");
    if ($("libFVideo").checked) classes.push("video");
    status.textContent = t("lib.building", { n: posts.length });
    const result = await message({ action: "aiBuildStyleProfile", posts: posts.slice(-500), name, classes });
    if (result?.ok) status.textContent = t("lib.built", { name: result.profile?.name || name, tokens: result.profile?.digest?.estimatedTokens || 0 });
    else status.textContent = t("lib.buildErr", { err: result?.error || "" });
  }

  async function refreshStorage() {
    try {
      const est = await navigator.storage.estimate();
      const mb = Math.round((est.usage || 0) / 1048576);
      $("libStorage").textContent = `💾 ${mb} MB`;
    } catch (_) { $("libStorage").textContent = ""; }
  }

  async function importFile(file) {
    const status = $("libImportStatus");
    status.textContent = t("lib.importing");
    try {
      const raw = await file.text();
      let posts = [];
      const trimmed = raw.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        posts = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.posts) ? parsed.posts : []);
      } else {
        posts = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
          try { return JSON.parse(line); } catch (_) { return null; }
        }).filter(Boolean);
      }
      posts = posts.filter(p => p && typeof p === "object" && String(p.text || "").length > 0).map(p => ({ ...p, contentClass: p.contentClass || "text" }));
      if (!posts.length) throw new Error(t("lib.importEmpty"));
      const dataset = {
        id: `ds_import_${Date.now().toString(36)}`,
        sourceKey: `import:${file.name}`,
        sourceUrl: posts[0].sourceUrl || `import:${file.name}`,
        sourceType: posts[0].sourceType || "import",
        sourceTitle: String(file.name || "import").replace(/\.(json|jsonl|txt)$/i, "").slice(0, 80),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        postCount: posts.length,
        options: {}
      };
      await ScrapeStore.saveRun(dataset, posts);
      status.textContent = t("lib.imported", { n: posts.length });
      renderDatasets();
    } catch (e) {
      status.textContent = t("lib.importErr", { err: String(e?.message || e) });
    }
  }

  $("libDatasets").addEventListener("click", async ev => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains("view")) selectDataset(id);
    else if (btn.classList.contains("dl")) exportDataset(id, $("libFormat").value);
    else if (btn.classList.contains("del")) deleteDataset(id);
  });
  $("libRefreshBtn").onclick = () => { renderDatasets(); refreshStorage(); };
  $("libSearch").addEventListener("input", () => renderPosts());
  ["libFText", "libFTextBg", "libFPhoto", "libFVideo"].forEach(id => $(id).addEventListener("change", () => renderPosts()));
  $("libSelectAllBtn").onclick = () => {
    filteredPosts().forEach(p => selectedIds.add(String(p.id || "")));
    renderPosts();
    updateSelectCount();
  };
  $("libSelectClearBtn").onclick = () => {
    selectedIds.clear();
    renderPosts();
    updateSelectCount();
  };
  $("libBuildProfileBtn").onclick = buildProfileFromFilter;
  $("libExportBtn").onclick = () => exportFiltered($("libFormat").value);
  try { $("libFormat").value = localStorage.getItem("libDlFormat") || "md"; } catch (_) {}
  $("libFormat").addEventListener("change", () => {
    try { localStorage.setItem("libDlFormat", $("libFormat").value); } catch (_) {}
  });
  $("libDeleteMediaBtn").onclick = async () => {
    if (!currentDatasetId) return;
    if (!confirm(t("lib.confirmDelMedia"))) return;
    await ScrapeStore.removeMedia(currentDatasetId);
    mediaCache = [];
    renderMedia();
  };
  $("libImportBtn").onclick = () => {
    const file = $("libImportFile").files && $("libImportFile").files[0];
    if (file) importFile(file);
  };
  $("libLang").onchange = async () => {
    await setUILang($("libLang").value);
    applyI18n();
    renderDatasets();
    renderPosts();
    renderMedia();
    updateSelectCount();
  };

  (async () => {
    const lang = await initI18n();
    $("libLang").value = lang;
    applyI18n();
    await renderDatasets();
    refreshStorage();
    updateSelectCount();
    // Mở từ nút "👁 Xem" ở panel "Chọn nguồn & kiểu bài" trong popup
    // (library.html?ds=<id>) -> vào thẳng đúng nguồn thay vì phải tự bấm chọn.
    const wantedId = new URLSearchParams(location.search).get("ds");
    if (wantedId) {
      await selectDataset(wantedId);
      const row = document.querySelector(`.ds[data-id="${CSS.escape(wantedId)}"]`);
      if (row) row.scrollIntoView({ block: "nearest" });
    }
  })();
})();
