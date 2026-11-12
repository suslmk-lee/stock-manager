# Windows 용 버전이 들어간 빌드를 만든다 (앱 안 업데이트 확인이 켜진다).
#   powershell -File scripts\build-windows.ps1
# 결과: build\bin\stock-manager.exe
# 그냥 `wails build` 로 만들면 버전이 "dev" 라 업데이트를 확인하지 않는다.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$version = $null
try { $version = (git describe --tags --dirty 2>$null) } catch { }
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) { $version = 'dev' }
$version = "$version".Trim()

Write-Host "버전: $version"
wails build -platform windows/amd64 -ldflags "-X main.appVersion=$version"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "완료: build\bin\stock-manager.exe (버전 $version)"
