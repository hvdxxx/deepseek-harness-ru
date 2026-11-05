#!/usr/bin/env node
/**
 * Validate Russian dictionaries against the English source corpus.
 *
 * Checks:
 *  - every dict/ru/*.json parses and has no keys absent from the English source;
 *  - placeholders ({name}) survive translation unchanged;
 *  - leading/trailing spaces of the English value survive;
 *  - reports empty values and still-English values (both suspicious in a UI string).
 *
 * usage: node validate.js <projectRoot>
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const dictDir = path.join(root, 'dict', 'ru');
const sourcePath = path.join(root, 'corpus.namespaces.json');

if (!fs.existsSync(sourcePath)) {
  console.error('нет ' + sourcePath + ' — сначала запустите tools/gen-corpus.js');
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const placeholder = /\{(\w+)\}/g;
const placeholders = (text) => {
  const found = [];
  let m;
  placeholder.lastIndex = 0;
  while ((m = placeholder.exec(text)) !== null) found.push(m[1]);
  return found.sort().join(',');
};
const edgeSpaces = (text) => `${text.startsWith(' ') ? 'L' : ''}${text.endsWith(' ') ? 'R' : ''}`;

const problems = [];
let checked = 0;
let stillEnglish = 0;
let empty = 0;

for (const file of fs.readdirSync(dictDir).filter((f) => f.endsWith('.json')).sort()) {
  const ns = file.replace(/\.json$/, '');
  let dict;
  try {
    dict = JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8'));
  } catch (error) {
    problems.push(`${file}: невалидный JSON — ${error.message}`);
    continue;
  }
  const english = source[ns];
  if (!english) {
    problems.push(`${file}: пространства имён нет в исходном корпусе`);
    continue;
  }
  for (const [key, value] of Object.entries(dict)) {
    checked++;
    if (typeof value !== 'string') {
      problems.push(`${ns}/${key}: значение не строка`);
      continue;
    }
    if (english[key] === undefined) {
      problems.push(`${ns}/${key}: ключа нет в английском словаре (устарел?)`);
      continue;
    }
    if (value === '') {
      empty++;
      continue;
    }
    if (placeholders(value) !== placeholders(english[key])) {
      problems.push(`${ns}/${key}: плейсхолдеры не совпадают: «${english[key]}» -> «${value}»`);
    }
    if (edgeSpaces(value) !== edgeSpaces(english[key])) {
      problems.push(`${ns}/${key}: изменились краевые пробелы: «${english[key]}» -> «${value}»`);
    }
    if (!/[А-Яа-яЁё]/.test(value) && /[A-Za-z]{3}/.test(value)) stillEnglish++;
  }
  for (const key of Object.keys(english)) {
    if (dict[key] === undefined) problems.push(`${ns}/${key}: отсутствует в переводе`);
  }
}

console.log('проверено значений: ' + checked);
console.log('проблем: ' + problems.length);
for (const p of problems.slice(0, 40)) console.log('  - ' + p);
if (problems.length > 40) console.log(`  ... ещё ${problems.length - 40}`);
console.log('пустых: ' + empty + ', без кириллицы (похоже на непереведённое): ' + stillEnglish);
process.exit(problems.length ? 1 : 0);
