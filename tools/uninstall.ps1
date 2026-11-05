#Requires -Version 5.1
<#
.SYNOPSIS
    Удаляет русский языковой пакет из профиля DeepSeek Harness.

.DESCRIPTION
    Убирает пакет из профиля (вместе с его записью в dsh.profile.bundles) и
    удаляет запись от старой схемы установки, если она где-то осталась.
    После отката интерфейс возвращается к английскому (или китайскому) языку.
#>
param(
    [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileManifest = Join-Path $profileDir 'cordis.patch.yml'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'

function Write-Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }

if (-not (Test-Path $profileDir)) { throw "Не найден профиль DSH: $profileDir" }

if (Test-Path $profileManifest) {
    Write-Step 'Удаление записи от старой схемы установки'
    $manifest = [IO.File]::ReadAllText($profileManifest)
    $pattern = '(?ms)^# >>> dsh-ru-lang\r?\n(?:- insert:\r?\n    - id: ru-lang\r?\n      name: dsh-ru-lang|- id: ru-lang\r?\n  name: dsh-ru-lang)\r?\n'
    $updated = [regex]::Replace($manifest, $pattern, '')
    if ($updated -ne $manifest) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        Copy-Item $profileManifest "$profileManifest.bak-$stamp"
        [IO.File]::WriteAllText($profileManifest, $updated, [Text.UTF8Encoding]::new($false))
        Write-Host '    запись удалена'
    } else {
        Write-Host '    старых записей нет'
    }
}

Write-Step 'Удаление пакета из профиля'
if (Test-Path $cli) {
    & $cli plugin --profile $Profile remove dsh-ru-lang
    if ($LASTEXITCODE -ne 0) { Write-Warning "dsh plugin remove завершился с кодом $LASTEXITCODE" }
} else {
    Write-Warning "CLI не найден: $cli"
}

Write-Host ''
Write-Host 'Готово. Перезапустите DeepSeek Harness — интерфейс вернётся к исходному языку.' -ForegroundColor Green
