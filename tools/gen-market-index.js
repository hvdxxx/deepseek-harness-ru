#!/usr/bin/env node
/**
 * Regenerate market/index.json — the DSH plugin-market index for this pack.
 *
 * The index pins one exact commit, so it must be regenerated (and committed)
 * after every release of the package. Format reference:
 * .agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md
 * in deepseek-ai/deepseek-harness.
 *
 * usage: node gen-market-index.js <projectRoot> [commit]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.argv[2];
const pkgDir = path.join(root, 'packages', 'dsh-ru-lang');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

const commit = process.argv[3] || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('commit must be a 40-hex sha, got: ' + commit);

const engines = pkg.engines?.dsh;
if (!engines) throw new Error('package.json must declare engines.dsh — the market rejects versions without it');
if (!pkg.dsh?.bundle) throw new Error('package.json must declare dsh.bundle — installation refuses packages without a bundle patch');
if (!pkg.repository?.url) throw new Error('package.json must declare repository');

const repoUrl = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
const directory = pkg.repository.directory;

const index = {
  format: 1,
  title: { en: 'DSH Russian language pack', ru: 'Русский языковой пакет DSH' },
  description: {
    en: 'Russian localization of the DeepSeek Harness web GUI, installed as an ordinary DSH bundle.',
    ru: 'Русификация веб-интерфейса DeepSeek Harness, ставится как обычный bundle DSH.',
  },
  metadata: {
    categories: { localization: { title: { en: 'Localization', ru: 'Локализация' } } },
    labels: { community: { title: { en: 'Community', ru: 'Сообщество' } } },
    sortKeys: {
      coverage: { title: { en: 'Translated strings', ru: 'Переведено строк' }, order: 'desc' },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'Russian language pack', ru: 'Русский язык' },
      description: {
        en: 'Adds the `ru` locale to Settings → General → Language: 63 namespaces, 2660 of 2725 UI strings. Untranslated keys fall back to English.',
        ru: 'Добавляет локаль `ru` в Settings → General → Language: 63 пространства имён, 2660 из 2725 строк. Непереведённые ключи берутся из английского словаря.',
      },
      icon: 'icon.svg',
      author: typeof pkg.author === 'string' ? pkg.author.replace(/\s*\(.*\)$/, '') : pkg.author?.name,
      homepage: pkg.homepage,
      repository: { url: repoUrl, directory },
      metadata: {
        category: 'localization',
        labels: ['community'],
        keywords: ['russian', 'ru', 'language pack', 'localization', 'i18n'],
        sortKeys: { coverage: 2660 },
      },
      'dist-tags': { latest: pkg.version },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: { type: 'git', url: repoUrl, commit, path: directory },
          engines: { dsh: engines },
        },
      ],
    },
  ],
};

const out = path.join(root, 'market', 'index.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(index, null, 2) + '\n');
console.log('market index: ' + pkg.name + '@' + pkg.version + ' @ ' + commit.slice(0, 7) + ' -> ' + out);
