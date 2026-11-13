#!/usr/bin/env node
// check-syntax.js — kiểm tra nhanh trước khi phát hành, không cần cài gói nào:
//  (1) mọi file .js qua `node --check`;
//  (2) manifest.json parse được, version khớp package.json, và mọi file mà
//      manifest tham chiếu (service worker, content script, popup, icon,
//      web_accessible_resources) đều tồn tại;
//  (3) mọi file kernel mà modules/bridge.js nạp đều tồn tại.
// Chạy: node tools/check-syntax.js — mã thoát 1 nếu có lỗi.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const SKIP_DIRS = new Set([".git", "node_modules"]);
const errors = [];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const jsFiles = walk(root, []);
for (const file of jsFiles) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) errors.push(`Lỗi cú pháp: ${path.relative(root, file)}\n${(res.stderr || "").trim()}`);
}

function mustExist(rel, why) {
  if (!rel || /[*?]/.test(rel)) return;
  if (!fs.existsSync(path.join(root, rel))) errors.push(`Thiếu file "${rel}" (${why})`);
}

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
} catch (err) {
  errors.push(`manifest.json không parse được: ${err.message}`);
}
if (manifest) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.version !== manifest.version) {
    errors.push(`Lệch version: manifest.json ${manifest.version} ≠ package.json ${pkg.version}`);
  }
  mustExist(manifest.background && manifest.background.service_worker, "background.service_worker");
  mustExist(manifest.action && manifest.action.default_popup, "action.default_popup");
  for (const icon of Object.values(manifest.icons || {})) mustExist(icon, "icons");
  for (const cs of manifest.content_scripts || []) {
    for (const f of [...(cs.js || []), ...(cs.css || [])]) mustExist(f, "content_scripts");
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const f of war.resources || []) mustExist(f, "web_accessible_resources");
  }
}

const bridge = fs.readFileSync(path.join(root, "modules", "bridge.js"), "utf8");
for (const m of bridge.matchAll(/'(modules\/[^']+\.js)'/g)) mustExist(m[1], "modules/bridge.js");

if (errors.length) {
  console.error(errors.join("\n\n"));
  console.error(`\n${errors.length} lỗi.`);
  process.exit(1);
}
console.log(`OK — ${jsFiles.length} file .js qua kiểm tra cú pháp; manifest ${manifest.version} và các file tham chiếu đầy đủ.`);
