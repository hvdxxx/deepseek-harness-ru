#!/usr/bin/env node
/**
 * Build the browser bundle of the Russian language pack.
 *
 * Source of truth: dict/ru/<namespace>.json — one file per locale namespace,
 * values already translated. The script embeds them into
 * packages/dsh-ru-lang/lib/client.js, which registers the `ru` language and
 * every namespace as owned effects.
 *
 * usage: node build-plugin.js <projectRoot>
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const dictDir = path.join(root, 'dict', 'ru');
const outFile = path.join(root, 'packages', 'dsh-ru-lang', 'lib', 'client.js');

const files = fs.existsSync(dictDir)
  ? fs.readdirSync(dictDir).filter((f) => f.endsWith('.json')).sort()
  : [];

const dicts = {};
let totalKeys = 0;
let translated = 0;
const perNs = [];

for (const file of files) {
  const ns = file.replace(/\.json$/, '');
  const raw = JSON.parse(fs.readFileSync(path.join(dictDir, file), 'utf8'));
  const entries = Object.entries(raw);
  let nsTranslated = 0;
  const clean = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue;
    clean[key] = value;
    if (/[А-Яа-яЁё]/.test(value)) nsTranslated++;
  }
  dicts[ns] = clean;
  totalKeys += entries.length;
  translated += nsTranslated;
  perNs.push({ ns, keys: entries.length, translated: nsTranslated });
}

perNs.sort((a, b) => b.keys - a.keys);

const bundle = `window.__ModuleLoader__.load({
	id: "dsh-ru-lang",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		//#region russian dictionaries
		/** Locale id registered by this pack. */
		const LOCALE_ID = "ru";
		/** External locale label shown in Settings -> General -> Language. */
		const LOCALE_LABEL = "Русский";
		/** Fallback locale: every unresolved key falls through to English. */
		const LOCALE_FALLBACK = "en";
		/** Namespace dictionaries: namespace -> key -> Russian text. */
		const DICTS = ${JSON.stringify(dicts, null, '\t').replace(/\n/g, '\n\t\t')};
		//#endregion
		//#region plugin body
		/** Required service: the client locale runtime. */
		const inject = ["locale"];
		/**
		 * Register the Russian language definition and each translated namespace.
		 * Definitions and dictionaries may arrive in either order; the runtime
		 * accepts a language whose fallback ("en") is already registered.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.addLanguage({
				id: LOCALE_ID,
				label: LOCALE_LABEL,
				fallback: LOCALE_FALLBACK
			}), "ru-lang: language definition");
			for (const [namespace, dict] of Object.entries(DICTS)) ctx.effect(() => ctx.locale.register(namespace, LOCALE_ID, dict), "ru-lang: " + namespace + " dictionary");
		}
		//#endregion
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, bundle);

console.log('namespaces: ' + files.length);
console.log('keys: ' + totalKeys + ', translated: ' + translated + ' (' + Math.round((translated / Math.max(totalKeys, 1)) * 100) + '%)');
console.log('bundle: ' + outFile);
console.log('least translated namespaces:');
perNs
  .filter((s) => s.keys >= 10)
  .sort((a, b) => a.translated / a.keys - b.translated / b.keys)
  .slice(0, 8)
  .forEach((s) => console.log('  ' + String(s.translated).padStart(4) + '/' + String(s.keys).padStart(4) + '  ' + s.ns));
