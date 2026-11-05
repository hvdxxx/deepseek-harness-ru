# Русификация DeepSeek Harness

[![DeepSeek Harness](https://img.shields.io/badge/%D0%B4%D0%BB%D1%8F-DeepSeek%20Harness-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-7c4dff)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Русский языковой пакет для веб-интерфейса DSH, собранный как **штатный плагин**, а не как патч
приложения. Установленный `app.asar` не меняется: пакет объявляет `dsh.bundle`, поэтому
`dsh plugin add` сам подключает его к профилю
(`%USERPROFILE%\.dsh\profiles\desktop`) — без ручной правки конфигурации.

## Как это устроено

В DSH есть встроенная локализация (`@deepseek-ai/dsh-client-locale`): каталог языков плюс
пословарная регистрация по пространствам имён. Язык добавляется клиентским плагином:

```js
export const inject = ['locale']
ctx.effect(() => ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }))
ctx.effect(() => ctx.locale.register('namespace', 'ru', { key: 'текст' }))
```

Пакет `packages/dsh-ru-lang` делает ровно это: регистрирует язык `ru` и словари для каждого
пространства имён. Ненайденный ключ автоматически берётся из английского словаря, поэтому
частичный перевод не ломает интерфейс.

## Структура

```
dsh-ru/
├── dict/ru/               словари по пространствам имён (источник истины, значения — русский текст)
├── market/                индекс каталога плагинов DSH (index.json + icon.svg)
├── packages/dsh-ru-lang/  сам плагин
│   ├── package.json       dsh.bundle (слой профиля) + dsh.client (platform: web, inject: locale)
│   ├── cordis.patch.yml   bundle-патч: вставляет запись плагина в дерево Loader
│   └── lib/
│       ├── index.js       хост-часть (пустая: вся работа в браузере)
│       └── client.js      СБОРКА: словари + регистрация языка (генерируется)
└── tools/
    ├── gen-corpus.js      извлекает английские словари из установленного app.asar
    ├── build-plugin.js    собирает lib/client.js из dict/ru
    ├── validate.js        сверяет переводы с английским корпусом (ключи, плейсхолдеры, пробелы)
    ├── test-plugin.js     офлайн-проверка регистрации, фолбэка и выключения
    ├── gen-market-index.js пересобирает market/index.json под текущий коммит
    ├── install.ps1        установка в профиль desktop (с резервными копиями)
    └── uninstall.ps1      откат
```

`dict/ru/*.json` — то, что переводят. Ключи и число записей должны совпадать с английским
словарём; при обновлении DSH их список обновляет `gen-corpus.js` (существующие переводы
сохраняются, новые ключи добавляются с английским значением).

## Сборка

Node берётся из самого DSH (в PATH его нет):

```powershell
$node = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
& $node tools\build-plugin.js .
& $node tools\test-plugin.js .
```

Первая команда пересобирает `packages/dsh-ru-lang/lib/client.js`, вторая проверяет, что
регистрация языка и словарей проходит, фолбэк на английский работает, а выключение плагина
возвращает исходный интерфейс.

## Обновление корпуса после обновления DSH

```powershell
$asar = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar"
& $node tools\gen-corpus.js $asar .
```

Скрипт читает `app.asar` напрямую (временные файлы не нужны), обновляет `dict/ru` и пишет
`corpus.json` со статистикой.

## Установка

```powershell
git clone https://github.com/hvdxxx/deepseek-harness-ru.git
cd deepseek-harness-ru
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

Если репозиторий уже склонирован, достаточно последней строки.

Скрипт делает резервные копии `package.json` и `cordis.patch.yml` и ставит пакет командой
`dsh plugin --profile desktop add file:...`. Дальше всё делает сам пакет:

- `package.json` объявляет `dsh.bundle.patch`, поэтому `dsh plugin add` добавляет `dsh-ru-lang`
  в `dsh.profile.bundles` профиля;
- `packages/dsh-ru-lang/cordis.patch.yml` вставляет запись плагина в дерево Loader:

```yaml
- insert:
    - id: ru-lang
      name: dsh-ru-lang
```

Ручная правка `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` не нужна. Если запись
добавить в патч плоским `- id: ru-lang` (без `insert:`), loader ответит
`patch: entry "ru-lang" not found` и плагин молча не появится — это ошибка старой схемы,
`install.ps1` теперь её вычищает.

После этого **один раз перезапустите DeepSeek Harness** и выберите язык:
Settings → General → Language → «Русский».

Откат:

```powershell
powershell -ExecutionPolicy Bypass -File tools\uninstall.ps1
```

## Каталог плагинов DSH

Пакет можно поставить как из каталога плагинов внутри DSH, не клонируя репозиторий. В
`market/index.json` лежит индекс формата 1 (его проверяет `@deepseek-ai/dsh-plugin-market-index`),
который пинит точный коммит и каталог пакета:

1. Settings → Plugins → каталог плагинов → добавьте индекс
   `https://raw.githubusercontent.com/hvdxxx/deepseek-harness-ru/main/market/index.json`;
2. в списке появится «Русский язык» → установить;
3. перезапустить DSH и выбрать язык в Settings → General → Language.

Индекс пересобирается командой `node tools/gen-market-index.js .` после каждого релиза: он
всегда указывает на конкретный коммит, поэтому обновления не подхватываются сами.

## Как найти проект

- GitHub: темы `dsh-plugin`, `deepseek-harness`, `localization` — поиск по ним находит репозиторий.
- Внутри DSH — через индекс маркета выше.
- В сообществе DSH — категория
  [Show Your Plugins!](https://github.com/deepseek-ai/deepseek-harness/discussions/categories/show-your-plugins)
  (у upstream отключены issues и pull requests, поэтому обсуждения — единственный канал).
- `package.json` содержит `repository`, `homepage` и `keywords`, поэтому npm-страница (если
  пакет когда-нибудь опубликуют) и локальные инструменты связывают пакет с этим репозиторием.

## Что переведено

Полный корпус — **63 пространства имён, 2725 строк**; переведено **2660 (98%)**.

| Покрыто | Осталось английским |
|---|---|
| Чат, диалог, траектория, сайдбар и все его панели, поле ввода, подтверждения, вопросы агента, план, цель, навыки, субагенты, фоновые задачи, настройки (общие, модели, аккаунт, тема, оболочка, разрешения, субагенты, веб-поиск, плагины, журнал сессии), каталог плагинов, расписание, голосовой ввод, инспектор сессий, результаты, Cordis | 65 значений — технические: `{d}.{m}`, `, `, ` · `, `JSON`, `HTTP`, `Bash`/`Glob`/`Grep`/`Pwsh`, `Bing`/`Google`, `Markdown`, `HTML`, `Finder`, `T/S`, `EXP`, названия протоколов (`Anthropic Messages`, `OpenAI Responses`), URL-примеры, токены слэш-команд (`compact`, `export`, …) |

Пересчитанная статистика — в `corpus.json`; отчёт о покрытии печатает `build-plugin.js`,
проверку словарей (ключи, плейсхолдеры, краевые пробелы) — `validate.js`.

## Как проверить

1. Перезагрузите страницу интерфейса (Ctrl+R). Если пункт «Русский» не появился —
   перезапустите DeepSeek Harness: состав плагинов применяется при старте Host-а.
2. Settings → General → Language → выберите «Русский». Переключение действует сразу,
   без перезагрузки, и запоминается.
3. Вернуться на английский можно там же, выбрав «English».

При установке `dsh plugin add` печатает предупреждение
`declares no dsh.bundle — installed as a plain dependency, not a profile layer` — это нормально:
запись в `cordis.patch.yml` добавляется отдельно, именно она включает плагин.

## Диагностика

Если после перезапуска в списке языков нет «Русского», проверьте слой конфигурации на копии
профиля (для имени `desktop` CLI запрещает дамп, поэтому копируем):

```powershell
$src = "$env:USERPROFILE\.dsh\profiles\desktop"
$dst = "$env:USERPROFILE\.dsh\profiles\ru-dbg"
Copy-Item $src $dst -Recurse
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile ru-dbg --dump-config | Select-String ru-lang
```

- запись видна в дампе и нет строки `patch: entry "ru-lang" not found` — слой в порядке,
  значит Host не перезапускался;
- есть `not found` — запись добавлена не через `insert:` (см. выше).

Дополнительно можно поднять копию профиля отдельно (`dsh --profile ru-dbg --port 55999`) и
убедиться, что в `window.__DSH_BOOT__` есть строка `dsh-ru-lang`, а
`/plugins/??dsh-ru-lang/client.js&rev=...` отдаёт бандл со словарями.

## Обновление после пересборки

`node_modules\dsh-ru-lang` в профиле — копия пакета (pnpm hard-link). После `build-plugin.js`
перезапустите `tools\install.ps1`. Если pnpm ответит `Already up to date` (метаданные пакета
изменились, путь — нет), переустановите явно:

```powershell
$cli = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $cli plugin --profile desktop remove dsh-ru-lang
& $cli plugin --profile desktop add "file:$PWD\packages\dsh-ru-lang"
```

Затем перезапустите приложение.

## Ограничения

- **Строки с серверной стороны** (описания инструментов, часть системных ошибок, названия
  плагинов из `locale/*.json` пакетов) приходят из Host-части и остаются английскими: у них
  другой механизм локализации.
- **Новые строки будущих версий DSH** появляются в интерфейсе на английском до обновления
  словарей: фолбэк штатный, ошибок не будет.
- **Числа, даты и склонения**: пакет не добавляет правил плюрализации (это ограничение самого
  locale-сервиса), поэтому строки с `{count}` переведены в форме, которая читается при любом
  числе.

## Как помочь с переводом

1. Правьте значения в `dict/ru/<пространство имён>.json` (ключи и порядок не трогайте).
2. `build-plugin.js` → `test-plugin.js` → `install.ps1`.
3. `validate.js` покажет расхождения по плейсхолдерам, краевым пробелам и устаревшие ключи.

Новые строки появляются так: после обновления DSH запустите `gen-corpus.js` — он дочитает
английские словари из `app.asar` и допишет недостающие ключи, не трогая готовый перевод.

## Благодарности и лицензия

Проект не связан с DeepSeek. Английские строки интерфейса и сам DeepSeek Harness —
[MIT](https://github.com/deepseek-ai/deepseek-harness), Copyright (c) DeepSeek.
Перевод распространяется по MIT (см. [LICENSE](LICENSE)).

Спасибо команде DSH за то, что языковые пакеты сделаны штатным расширением, а не патчем
приложения: `ctx.locale.addLanguage` + словари на пространство имён — и весь интерфейс
переключается без пересборки.

