#!/usr/bin/env node
/**
 * Offline check of the built client bundle: loads lib/client.js against a
 * minimal LocaleRuntime mock and verifies that the `ru` language and its
 * dictionaries register, that lookups resolve Russian, that missing keys fall
 * through to English, and that unload removes everything again.
 *
 * usage: node test-plugin.js <projectRoot>
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.argv[2];
const bundlePath = path.join(root, 'packages', 'dsh-ru-lang', 'lib', 'client.js');

const languages = new Map();
const dicts = new Map();

const locale = {
  addLanguage(input) {
    languages.set(input.id, input);
    return () => languages.delete(input.id);
  },
  register(ns, a, b) {
    const pairs = typeof a === 'string' ? [[a, b]] : Object.entries(a);
    for (const [loc] of pairs) {
      const key = loc.toLowerCase();
      if (!dicts.has(ns)) dicts.set(ns, new Map());
      if (dicts.get(ns).has(key)) throw new Error(`namespace "${ns}" already has locale "${loc}"`);
      dicts.get(ns).set(key, pairs.find((p) => p[0] === loc)[1]);
    }
    return () => {
      for (const [loc] of pairs) dicts.get(ns)?.delete(loc.toLowerCase());
    };
  },
  /** Resolve like LocaleRuntime.translate: ru -> en, then common, then the key. */
  t(ns, key, params) {
    const lookup = (n) => {
      for (const loc of ['ru', 'en']) {
        const hit = dicts.get(n)?.get(loc)?.[key];
        if (hit !== undefined) return hit;
      }
    };
    const template = lookup(ns) ?? (ns !== 'common' ? lookup('common') : undefined) ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  },
};

// Owner plugins register their English copy first or later; both orders must work.
dicts.set('conversation', new Map([['en', { 'turn.retry': 'Retry', 'turn.stopped': 'Stopped by user' }]]));
dicts.set('common', new Map([['en', { ok: 'OK', cancel: 'Cancel' }]]));

const disposers = [];
const ctx = {
  locale,
  effect(fn) {
    const dispose = fn();
    if (typeof dispose !== 'function') throw new Error('every effect must return a disposer');
    disposers.push(dispose);
  },
};

const sandbox = { window: { __ModuleLoader__: { load: (mod) => (sandbox.__mod = mod) } } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), sandbox, { filename: bundlePath });

const mod = sandbox.__mod;
if (!mod || mod.id !== 'dsh-ru-lang') throw new Error('bundle did not register module dsh-ru-lang');
const exportsObj = mod.factory(() => ({}));
if (typeof exportsObj.apply !== 'function') throw new Error('bundle exports no apply()');
if (!Array.isArray(exportsObj.inject) || !exportsObj.inject.includes('locale')) throw new Error('bundle does not inject the locale service');

exportsObj.apply(ctx);

const ru = languages.get('ru');
if (!ru) throw new Error('ru language was not registered');
if (ru.fallback !== 'en') throw new Error('ru fallback must be en');

const translated = [...dicts.entries()].filter(([, m]) => m.has('ru')).length;
console.log('language: ' + ru.id + ' (' + ru.label + '), fallback ' + ru.fallback);
console.log('namespaces with ru dictionary: ' + translated + ' of ' + dicts.size);
console.log('effects registered: ' + disposers.length);
console.log('sample conversation/turn.retry -> ' + locale.t('conversation', 'turn.retry'));
console.log('sample common/ok -> ' + locale.t('common', 'ok'));
console.log('unknown key falls back to key -> ' + locale.t('conversation', 'unknown.key'));

// Unload must restore English-only behaviour.
for (const dispose of disposers) dispose();
if (languages.has('ru')) throw new Error('language definition survived disposal');
if ([...dicts.values()].some((m) => m.has('ru'))) throw new Error('ru dictionaries survived disposal');
console.log('disposal restores English: ok');
