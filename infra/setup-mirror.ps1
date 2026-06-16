# Настройка зеркала Docker Hub для работы в России (Windows / Docker Desktop).
# Запустите в PowerShell от имени администратора, затем перезапустите Docker Desktop.
#
# Использование:
#   .\infra\setup-mirror.ps1               # показать инструкцию
#   .\infra\setup-mirror.ps1 -Apply        # применить зеркало

param(
    [switch]$Apply
)

$mirrors = @("https://huecker.io", "https://dockerhub.timeweb.cloud", "https://mirror.gcr.io")
$daemonJson = "$env:USERPROFILE\.docker\daemon.json"

Write-Host "==> Целевой файл: $daemonJson"
Write-Host "==> Зеркала    : $($mirrors -join ', ')"
Write-Host ""

if ($Apply) {
    $dir = Split-Path $daemonJson
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

    if (Test-Path $daemonJson) {
        $cfg = Get-Content $daemonJson -Raw | ConvertFrom-Json
    } else {
        $cfg = [pscustomobject]@{}
    }

    $cfg | Add-Member -Force -MemberType NoteProperty -Name "registry-mirrors" -Value $mirrors
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $daemonJson -Encoding UTF8

    Write-Host "==> Файл обновлён: $daemonJson"
    Write-Host "==> Перезапустите Docker Desktop, затем выполните 'make up'."
} else {
    Write-Host "Чтобы применить настройки, выполните от имени администратора:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File infra\setup-mirror.ps1 -Apply"
    Write-Host ""
    Write-Host "Или добавьте вручную в $daemonJson:"
    Write-Host '  { "registry-mirrors": ["https://huecker.io","https://dockerhub.timeweb.cloud","https://mirror.gcr.io"] }'
    Write-Host ""
    Write-Host "Для Docker Desktop: Настройки (шестерёнка) -> Docker Engine -> вставьте конфиг -> Apply & Restart."
}
