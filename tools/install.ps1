#Requires -Version 5.1
<#
.SYNOPSIS
    Устанавливает русский языковой пакет в профиль DeepSeek Harness (desktop).

.DESCRIPTION
    1. Проверяет сборку плагина.
    2. Делает резервные копии package.json и cordis.patch.yml профиля.
    3. Ставит пакет в профиль через штатную команду `dsh plugin --profile desktop add`.
    4. Добавляет запись плагина в cordis.patch.yml (идемпотентно).

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
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileManifest = Join-Path $profileDir 'cordis.patch.yml'
$profilePackage = Join-Path $profileDir 'package.json'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }

if (-not (Test-Path $packageJson)) { throw "Не найден пакет плагина: $packageJson" }
if (-not (Test-Path $clientBundle)) { throw "Не собрана клиентская часть: $clientBundle. Запустите tools\build-plugin.js" }
if (-not (Test-Path $profileDir)) { throw "Не найден профиль DSH: $profileDir" }
if (-not (Test-Path $cli)) { throw "Не найден CLI DeepSeek Harness: $cli" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Write-Step "Резервные копии профиля ($stamp)"
Copy-Item $profilePackage "$profilePackage.bak-$stamp"
Copy-Item $profileManifest "$profileManifest.bak-$stamp"

Write-Step 'Установка пакета в профиль через dsh plugin add'
& $cli plugin --profile $Profile add "file:$($projectRoot)\packages\dsh-ru-lang"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add завершился с кодом $LASTEXITCODE" }

Write-Step 'Регистрация записи в cordis.patch.yml'
$marker = '# >>> dsh-ru-lang'
$manifest = [IO.File]::ReadAllText($profileManifest)
if ($manifest.Contains('id: ru-lang')) {
    Write-Host '    запись уже есть, пропускаю'
} else {
    # Патч-слой умеет править существующие записи по id и вставлять новые
    # списком `insert:` — без него loader сообщает `entry "ru-lang" not found`.
    $entry = @(
        '',
        $marker,
        '- insert:',
        '    - id: ru-lang',
        '      name: dsh-ru-lang'
    ) -join "`n"
    if (-not $manifest.EndsWith("`n")) { $entry = "`n" + $entry }
    [IO.File]::AppendAllText($profileManifest, $entry + "`n", [Text.UTF8Encoding]::new($false))
    Write-Host '    запись добавлена'
}

Write-Step 'Проверка файлов'
$installed = Join-Path $profileDir 'node_modules\dsh-ru-lang'
if (Test-Path $installed) { Write-Host "    пакет: $installed" -ForegroundColor Green }
else { Write-Warning "Ожидался каталог $installed — проверьте вывод pnpm выше" }

Write-Host ''
Write-Host 'Готово. Перезапустите DeepSeek Harness, затем откройте Settings → General → Language и выберите «Русский».' -ForegroundColor Green
Write-Host "Откат: $PSCommandPath -> ..\tools\uninstall.ps1  (или верните $profileManifest.bak-$stamp)"
