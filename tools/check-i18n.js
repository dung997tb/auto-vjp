#!/usr/bin/env node
// check-i18n.js — kiểm tra từ điển i18n.js của Auto vjp.
// Báo: (1) khóa định nghĩa trùng trong cùng một từ điển, (2) khóa có ở vi
// nhưng thiếu ở en và ngược lại. Chạy: node tools/check-i18n.js [đường/dẫn/i18n.js]
// Mã thoát 1 nếu có khóa trùng; lệch vi/en chỉ liệt kê (nợ cũ), không fail.
"use strict";

const fs = require("fs");
const path = require("path");

const file = process.argv[2] || path.join(__dirname, "..", "i18n.js");
const src = fs.readFileSync(file, "utf8");

// Tìm từng block Object.assign(I18N.<lang>, { ... }) và trích khóa.
// Đếm ngoặc nhọn có ý thức chuỗi (bỏ qua { } nằm trong "..." / '...').
function extractBlocks(source) {
  const blocks = [];
  const re = /Object\.assign\(\s*I18N\.(vi|en)\s*,\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const lang = m[1];
    let i = re.lastIndex; // ngay sau dấu { mở block
    let depth = 1;
    let quote = null;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") i++; // bỏ qua ký tự thoát
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
      i++;
    }
    blocks.push({ lang, text: source.slice(re.lastIndex, i) });
    re.lastIndex = i;
  }
  return blocks;
}

function extractKeys(blockText) {
  const keys = [];
  const keyRe = /^\s*"((?:[^"\\]|\\.)*)"\s*:/gm;
  let m;
  while ((m = keyRe.exec(blockText)) !== null) {
    keys.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return keys;
}

const byLang = { vi: new Map(), en: new Map() }; // key -> số lần định nghĩa
for (const block of extractBlocks(src)) {
  const map = byLang[block.lang];
  for (const key of extractKeys(block.text)) {
    map.set(key, (map.get(key) || 0) + 1);
  }
}

let hasDup = false;
for (const lang of Object.keys(byLang)) {
  const map = byLang[lang];
  const dups = [...map.entries()].filter(([, n]) => n > 1);
  console.log(`[${lang}] ${map.size} khóa duy nhất, ${[...map.values()].reduce((a, b) => a + b, 0)} lượt định nghĩa`);
  if (dups.length) {
    hasDup = true;
    console.log(`[${lang}] KHÓA TRÙNG (${dups.length}):`);
    for (const [key, n] of dups.sort()) console.log(`  - ${key} x${n}`);
  } else {
    console.log(`[${lang}] không có khóa trùng`);
  }
}

const viKeys = new Set(byLang.vi.keys());
const enKeys = new Set(byLang.en.keys());
const onlyVi = [...viKeys].filter((k) => !enKeys.has(k)).sort();
const onlyEn = [...enKeys].filter((k) => !viKeys.has(k)).sort();
console.log(`[vi->en] có ở vi, thiếu ở en (${onlyVi.length}):`);
for (const k of onlyVi) console.log(`  - ${k}`);
console.log(`[en->vi] có ở en, thiếu ở vi (${onlyEn.length}):`);
for (const k of onlyEn) console.log(`  - ${k}`);

process.exit(hasDup ? 1 : 0);
