#!/usr/bin/env node
/**
 * Minimal ASAR reader/writer (no external deps).
 *
 * Commands:
 *   node asar.js list  <archive> [prefix]
 *   node asar.js cat   <archive> <innerPath>
 *   node asar.js grep  <archive> <regex> [prefix] [-i]
 *   node asar.js extract <archive> <outDir> [prefix]
 *   node asar.js pack  <srcDir> <outArchive>
 */
const fs = require('fs');
const path = require('path');

function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, 0);
  const headerSize = sizeBuf.readUInt32LE(4);
  const headerBuf = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBuf, 0, headerSize, 8);
  const jsonSize = headerBuf.readUInt32LE(4);
  const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonSize));
  return { fd, header, baseOffset: 8 + headerSize };
}

function walk(node, prefix, out) {
  for (const [k, v] of Object.entries(node.files || {})) {
    const name = prefix ? prefix + '/' + k : k;
    if (v.files) walk(v, name, out);
    else out.push({ name, size: v.size, offset: Number(v.offset || 0), unpacked: !!v.unpacked });
  }
  return out;
}

function archive(file) {
  const { fd, header, baseOffset } = readHeader(file);
  return { fd, header, baseOffset, entries: walk(header, '', []) };
}

function readFileBytes(ar, entry) {
  const buf = Buffer.alloc(entry.size);
  if (entry.size) fs.readSync(ar.fd, buf, 0, entry.size, ar.baseOffset + entry.offset);
  return buf;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function cmdList(file, prefix) {
  const ar = archive(file);
  let total = 0;
  for (const e of ar.entries) {
    if (prefix && !e.name.startsWith(prefix)) continue;
    total++;
    console.log(String(e.size).padStart(10) + '  ' + e.name + (e.unpacked ? '  [unpacked]' : ''));
  }
  console.error('entries: ' + total);
}

function cmdCat(file, inner) {
  const ar = archive(file);
  const e = ar.entries.find((x) => x.name === inner.replace(/\\/g, '/'));
  if (!e) {
    console.error('not found: ' + inner);
    process.exit(1);
  }
  process.stdout.write(readFileBytes(ar, e));
}

function cmdGrep(file, pattern, prefix, ignoreCase) {
  const ar = archive(file);
  const re = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
  for (const e of ar.entries) {
    if (prefix && !e.name.startsWith(prefix)) continue;
    if (e.size > 8 * 1024 * 1024) continue;
    const buf = readFileBytes(ar, e);
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    re.lastIndex = 0;
    let m;
    const hits = [];
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 60);
      const end = Math.min(text.length, m.index + m[0].length + 60);
      hits.push(text.slice(start, end).replace(/\n/g, '\\n'));
      if (hits.length >= 5) break;
    }
    if (hits.length) {
      console.log('=== ' + e.name);
      for (const h of hits) console.log('   ' + h);
    }
  }
}

function cmdExtract(file, outDir, prefix) {
  const ar = archive(file);
  let n = 0;
  let bytes = 0;
  for (const e of ar.entries) {
    if (prefix && !e.name.startsWith(prefix)) continue;
    const dest = path.join(outDir, e.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, readFileBytes(ar, e));
    n++;
    bytes += e.size;
  }
  console.log('extracted ' + n + ' files, ' + (bytes / 1048576).toFixed(1) + ' MiB');
}

function cmdPack(srcDir, outFile) {
  const root = path.resolve(srcDir);
  const files = [];
  (function collect(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) collect(abs, r);
      else if (ent.isFile()) files.push({ rel: r, abs });
    }
  })(root, '');
  files.sort((a, b) => (a.rel < b.rel ? -1 : 1));

  // Build the asar header tree with sequential offsets.
  const tree = { files: {} };
  let offset = 0;
  const blobs = [];
  for (const f of files) {
    const parts = f.rel.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      node.files[parts[i]] = node.files[parts[i]] || { files: {} };
      node = node.files[parts[i]];
    }
    const data = fs.readFileSync(f.abs);
    node.files[parts[parts.length - 1]] = {
      size: data.length,
      offset: String(offset),
    };
    blobs.push(data);
    offset += data.length;
  }

  const json = Buffer.from(JSON.stringify(tree), 'utf8');
  // Pickle: uint32 payload size (= 4 + json length), uint32 string length, json, pad to 4.
  const pad = (4 - (json.length % 4)) % 4;
  const headerPayload = 4 + json.length;
  const headerBuf = Buffer.alloc(8 + json.length + pad);
  headerBuf.writeUInt32LE(headerPayload, 0);
  headerBuf.writeUInt32LE(json.length, 4);
  json.copy(headerBuf, 8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerBuf.length, 4);

  const fd = fs.openSync(outFile, 'w');
  fs.writeSync(fd, sizeBuf);
  fs.writeSync(fd, headerBuf);
  for (const b of blobs) fs.writeSync(fd, b);
  fs.closeSync(fd);
  console.log('packed ' + files.length + ' files -> ' + outFile + ' (' + (offset / 1048576).toFixed(1) + ' MiB payload)');
}

const [cmd, file, a, b] = process.argv.slice(2);
switch (cmd) {
  case 'list': cmdList(file, a); break;
  case 'cat': cmdCat(file, a); break;
  case 'grep': cmdGrep(file, a, b, process.argv.includes('-i')); break;
  case 'extract': cmdExtract(file, a, b); break;
  case 'pack': cmdPack(file, a); break;
  default:
    console.error('usage: asar.js <list|cat|grep|extract|pack> ...');
    process.exit(2);
}
