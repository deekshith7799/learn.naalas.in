# Build the two app images (API and web) and push them to Docker Hub (Windows PowerShell).
#   docker login                          (once)
#   .\deploy\push-images.ps1              (tag = date, e.g. 20261015-1430)
#   .\deploy\push-images.ps1 v1.2         (your own tag)
param([string]$Tag = (Get-Date -Format 'yyyyMMdd-HHmm'))
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$u = $env:DOCKERHUB_USER
if (-not $u -and (Test-Path .env)) {
  $line = Select-String -Path .env -Pattern '^DOCKERHUB_USER=(.*)$' | Select-Object -Last 1
  if ($line) { $u = $line.Matches[0].Groups[1].Value.Trim() }
}
if (-not $u) { Write-Host 'Set DOCKERHUB_USER=<your Docker Hub username> in .env'; exit 1 }

foreach ($s in @(@('server', 'server'), @('web', 'client'))) {
  $img = "$u/dba-academy-$($s[0])"
  Write-Host ">> Building ${img}:$Tag"
  docker build --platform linux/amd64 -t "${img}:$Tag" -t "${img}:latest" ".\$($s[1])"
  if ($LASTEXITCODE) { exit 1 }
  Write-Host ">> Pushing $img"
  docker push "${img}:$Tag";    if ($LASTEXITCODE) { exit 1 }
  docker push "${img}:latest";  if ($LASTEXITCODE) { exit 1 }
}
Write-Host ""
Write-Host "Pushed $u/dba-academy-server and $u/dba-academy-web with tags: $Tag and latest"
Write-Host "On the server:  bash k8s/deploy.sh $Tag"
