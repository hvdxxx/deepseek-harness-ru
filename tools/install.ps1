#Requires -Version 5.1
<#
.SYNOPSIS
    Устанавливает русский языковой пакет в профиль DeepSeek Harness (desktop).

.DESCRIPTION
    Пакет объявляет `dsh.bundle`, поэтому `dsh plugin add` сам добавляет его в
    dsh.profile.bundles профиля, а его cordis.patch.yml вставляет запись плагина
    в дерево Loader. Ручная правка профиля не нужна.

    Скрипт:
      1. проверяет сборку плагина;
      2. делает резервные копии package.json и cordis.patch.yml;
      3. ставит пакет через `dsh plugin --profile desktop add`;
      4. убирает запись от старой (ручной) схемы установки, если она осталась;
      5. печатает дальнейшие шаги.

    После установки нужно один раз перезапустить DeepSeek Harness: при следующем
    запуске в Settings → General → Language появится «Русский».

.PARAMETER DshHome
    Каталог DSH_HOME. По умолчанию $env:USERPROFILE\.dsh.

.PARAMETER Profile
    Имя профиля. По умолчанию desktop.
#>
param(
    [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$packageJson = Join-Path $projectRoot 'packages\dsh-ru-lang\package.json'
$clientBundle = Join-Path $projectRoot 'packages\dsh-ru-lang\lib\client.js'
$bundlePatch = Join-Path $projectRoot 'packages\dsh-ru-lang\cordis.patch.yml'
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileManifest = Join-Path $profileDir 'cordis.patch.yml'
$profilePackage = Join-Path $profileDir 'package.json'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }

if (-not (Test-Path $packageJson)) { throw "Не найден пакет плагина: $packageJson" }
if (-not (Test-Path $clientBundle)) { throw "Не собрана клиентская часть: $clientBundle. Запустите tools\build-plugin.js" }
if (-not (Test-Path $bundlePatch)) { throw "Не найден bundle-патч: $bundlePatch" }
if (-not (Test-Path $profileDir)) { throw "Не найден профиль DSH: $profileDir" }
if (-not (Test-Path $cli)) { throw "Не найден CLI DeepSeek Harness: $cli" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Write-Step "Резервные копии профиля ($stamp)"
Copy-Item $profilePackage "$profilePackage.bak-$stamp"
Copy-Item $profileManifest "$profileManifest.bak-$stamp"

Write-Step 'Установка пакета в профиль через dsh plugin add'
& $cli plugin --profile $Profile add "file:$($projectRoot)\packages\dsh-ru-lang"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add завершился с кодом $LASTEXITCODE" }

Write-Step 'Удаление записи от старой схемы установки'
$manifest = [IO.File]::ReadAllText($profileManifest)
$pattern = '(?ms)^# >>> dsh-ru-lang\r?\n(?:- insert:\r?\n    - id: ru-lang\r?\n      name: dsh-ru-lang|- id: ru-lang\r?\n  name: dsh-ru-lang)\r?\n'
$updated = [regex]::Replace($manifest, $pattern, '')
if ($updated -ne $manifest) {
    [IO.File]::WriteAllText($profileManifest, $updated, [Text.UTF8Encoding]::new($false))
    Write-Host '    старая запись удалена (теперь плагин подключается как bundle)'
} else {
    Write-Host '    старых записей нет'
}

Write-Step 'Проверка профиля'
$manifestJson = [IO.File]::ReadAllText($profilePackage) | ConvertFrom-Json
$bundles = @($manifestJson.dsh.profile.bundles)
if ($bundles -contains 'dsh-ru-lang') {
    Write-Host '    пакет входит в dsh.profile.bundles' -ForegroundColor Green
} else {
    Write-Warning 'dsh-ru-lang не попал в dsh.profile.bundles — проверьте вывод pnpm выше'
}
$installed = Join-Path $profileDir 'node_modules\dsh-ru-lang'
if (Test-Path $installed) { Write-Host "    пакет: $installed" -ForegroundColor Green }
else { Write-Warning "Ожидался каталог $installed" }

Write-Host ''
Write-Host 'Готово. Перезапустите DeepSeek Harness, затем откройте Settings → General → Language и выберите «Русский».' -ForegroundColor Green
Write-Host "Откат: tools\uninstall.ps1 (резервные копии: *.bak-$stamp)"
