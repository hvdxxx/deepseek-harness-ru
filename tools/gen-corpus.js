#!/usr/bin/env node
/**
 * Build the translation corpus for the DSH web GUI out of app.asar.
 *
 * Reads every client plugin bundle, locates the English dictionary of each
 * `ctx.locale.register(<namespace>, { zh, en })` call, and writes:
 *   - corpus.json            : namespaces -> { key: English } plus flat phrase stats
 *   - dict/ru/<ns>.json      : skeleton translation files (English values)
 *
 * Existing ru files are preserved: new keys are appended with the English
 * value, keys that disappeared from the bundle are reported (not deleted).
 *
 * usage: node gen-corpus.js <app.asar> <workDir>
 */
const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2];
const workDir = process.argv[3];

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const sb = Buffer.alloc(8);
  fs.readSync(fd, sb, 0, 8, 0);
  const size = sb.readUInt32LE(4);
  const hb = Buffer.alloc(size);
  fs.readSync(fd, hb, 0, size, 8);
  const hs = hb.readUInt32LE(4);
  const header = JSON.parse(hb.toString('utf8', 8, 8 + hs));
  return { fd, header, base: 8 + size };
}

function walk(node, prefix, out) {
  for (const [k, v] of Object.entries(node.files || {})) {
    const name = prefix ? prefix + '/' + k : k;
    if (v.files) walk(v, name, out);
    else out.push({ name, size: v.size, offset: Number(v.offset || 0) });
  }
  return out;
}

function readEntry(ar, e) {
  const buf = Buffer.alloc(e.size);
  if (e.size) fs.readSync(ar.fd, buf, 0, e.size, ar.base + e.offset);
  return buf.toString('utf8');
}

/** Body of the object literal that starts at src[i] === '{'. */
function objectBody(src, i) {
  let depth = 0;
  let quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(i + 1, j);
    }
  }
  return null;
}

const KEY = /^\s*(?:"([^"\\\n]+)"|'([^'\\\n]+)'|([A-Za-z_$][\w$]*))\s*:\s*$/;
const STRING = /^\s*"((?:\\.|[^"\\\n])*)"\s*$|^\s*'((?:\\.|[^'\\\n])*)'\s*$/;

/** Split an object-literal body into its top-level `key: value` segments. */
function topLevelSegments(body) {
  const segments = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      segments.push(body.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(body.slice(start));
  return segments;
}

function unescape(value) {
  return value.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

/** Extract top-level `key: "string"` pairs, accepting bare or quoted keys. */
function parseDict(body) {
  const out = {};
  for (const segment of topLevelSegments(body)) {
    const colon = KEY.exec(segment.slice(0, segment.indexOf(':') + 1));
    if (!colon) continue;
    const key = colon[1] ?? colon[2] ?? colon[3];
    if (!/^[A-Za-z][\w.-]*$/.test(key)) continue;
    const value = STRING.exec(segment.slice(segment.indexOf(':') + 1));
    if (!value) continue;
    out[key] = unescape(value[1] ?? value[2] ?? '');
  }
  return out;
}

function collectStringConsts(src) {
  const map = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])([^"'\\\n]{1,120})\2/g;
  let m;
  while ((m = re.exec(src)) !== null) map.set(m[1], m[3]);
  return map;
}

/** Return the dictionary body for a variable declared as `<var> = { ... }`. */
function dictFor(src, varName) {
  const re = new RegExp('\\b(?:const|let|var)\\s+' + varName.replace(/\$/g, '\\$') + '\\s*=\\s*\\{', 'g');
  const m = re.exec(src);
  if (!m) return null;
  const body = objectBody(src, m.index + m[0].length - 1);
  if (!body) return null;
  const dict = parseDict(body);
  return Object.keys(dict).length ? dict : null;
}

const ar = openAsar(asarPath);
const entries = walk(ar.header, '', []).filter(
  (e) =>
    e.name.startsWith('dsh/node_modules/@deepseek-ai/') &&
    /\/lib\/client\.js$/.test(e.name) &&
    e.size > 1000 &&
    e.size < 4 * 1024 * 1024,
);

const namespaces = {};
const unresolved = [];
const phrases = new Map();

for (const e of entries) {
  const src = readEntry(ar, e);
  const consts = collectStringConsts(src);
  const regRe = /locale.register\(\s*([^,(){]+?)\s*,\s*\{([^{}]*)\}/g;
  let m;
  while ((m = regRe.exec(src)) !== null) {
    let ns = m[1].trim();
    if (/^["']/.test(ns)) ns = ns.slice(1, -1);
    else ns = consts.get(ns) ?? null;
    const fields = m[2];
    // `en: en$1` names the dictionary variable; shorthand `{ zh, en }` uses `en`.
    const namedEn = /(?:^|,)\s*en\s*:\s*([A-Za-z_$][\w$]*)/.exec(fields)?.[1];
    const shorthandEn = /(?:^|,)\s*en\s*(?:,|$)/.test(fields);
    const enVar = namedEn || (shorthandEn ? 'en' : null);
    if (!ns || !enVar) {
      unresolved.push({ file: e.name, reason: 'namespace or en variable not resolved', call: m[0].slice(0, 120) });
      continue;
    }
    const dict = dictFor(src, enVar);
    if (!dict) {
      unresolved.push({ file: e.name, reason: 'english dictionary body not found for ' + enVar, ns });
      continue;
    }
    const target = namespaces[ns] ?? (namespaces[ns] = {});
    for (const [k, v] of Object.entries(dict)) {
      if (target[k] === undefined) target[k] = v;
      const key = v;
      const rec = phrases.get(key);
      if (rec) rec.count++;
      else phrases.set(key, { count: 1, ns, key: k });
    }
  }
}

const nsNames = Object.keys(namespaces).sort();
const allKeys = nsNames.reduce((n, ns) => n + Object.keys(namespaces[ns]).length, 0);

// Skeleton files: keep existing translations, append new keys, drop nothing.
// `--read-only` refreshes corpus.json/corpus.namespaces.json only, so a run
// during translation cannot race with files being edited right now.
const readOnly = process.argv.includes('--read-only');
const ruDir = path.join(workDir, 'dict', 'ru');
fs.mkdirSync(ruDir, { recursive: true });
let added = 0;
let stale = 0;
const summary = [];
for (const ns of nsNames) {
  if (readOnly) {
    summary.push({ ns, keys: Object.keys(namespaces[ns]).length, added: 0, stale: 0 });
    continue;
  }
  const file = path.join(ruDir, ns + '.json');
  let current = {};
  if (fs.existsSync(file)) current = JSON.parse(fs.readFileSync(file, 'utf8'));
  let localAdded = 0;
  for (const [k, v] of Object.entries(namespaces[ns])) {
    if (current[k] === undefined) {
      current[k] = v;
      localAdded++;
    }
  }
  const known = new Set(Object.keys(namespaces[ns]));
  const localStale = Object.keys(current).filter((k) => !known.has(k));
  stale += localStale.length;
  added += localAdded;
  const ordered = {};
  for (const k of Object.keys(namespaces[ns]).sort()) ordered[k] = current[k];
  fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n');
  summary.push({ ns, keys: Object.keys(namespaces[ns]).length, added: localAdded, stale: localStale.length });
}

const corpus = {
  generatedAt: new Date().toISOString(),
  bundles: entries.length,
  namespaces: nsNames.length,
  keys: allKeys,
  summary,
  unresolved,
  phrases: [...phrases.entries()].map(([en, meta]) => ({ en, ...meta })).sort((a, b) => b.en.length - a.en.length),
};
fs.writeFileSync(path.join(workDir, 'corpus.json'), JSON.stringify(corpus, null, 2) + '\n');
// English source per namespace/key, used by tools/validate.js to compare placeholders.
fs.writeFileSync(path.join(workDir, 'corpus.namespaces.json'), JSON.stringify(namespaces, null, 2) + '\n');

console.log('bundles: ' + entries.length);
console.log('namespaces: ' + nsNames.length + ', keys: ' + allKeys);
console.log('new keys in skeletons: ' + added + ', stale keys kept: ' + stale);
console.log('unresolved register calls: ' + unresolved.length);
for (const u of unresolved) console.log('  ! ' + u.file + ' — ' + u.reason);
console.log('namespaces by size:');
summary
  .sort((a, b) => b.keys - a.keys)
  .forEach((s) => console.log('  ' + String(s.keys).padStart(4) + '  ' + s.ns));
