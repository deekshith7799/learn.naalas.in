# Admin wrapper for DBA Academy (Windows PowerShell). Run from the project folder.
# If scripts are blocked, run once in this window:  Set-ExecutionPolicy -Scope Process Bypass
#   .\academy.ps1 users          .\academy.ps1 add-user ravi@x.com "Ravi K"
#   .\academy.ps1 backup         .\academy.ps1 restore backup-2026-10-10.sql
Set-Location $PSScriptRoot
$cmd = if ($args.Count) { $args[0] } else { 'help' }

switch ($cmd) {
  'backup' {
    $f = "backup-$(Get-Date -Format 'yyyy-MM-dd-HHmm').sql"
    docker compose exec -T db pg_dump -U academy -f /tmp/backup.sql academy
    docker compose cp db:/tmp/backup.sql $f
    Write-Host "Saved $f"
  }
  'restore' {
    if (-not $args[1] -or -not (Test-Path $args[1])) { Write-Host 'usage: .\academy.ps1 restore <file.sql>'; exit 1 }
    docker compose cp $args[1] db:/tmp/restore.sql
    docker compose exec -T db psql -U academy -d academy -f /tmp/restore.sql
    Write-Host "Restored $($args[1])"
  }
  'status' {
    docker compose ps
    docker compose exec -T server wget -qO- http://127.0.0.1:4000/api/health *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host 'API: healthy' } else { Write-Host 'API: NOT responding (see: .\academy.ps1 logs)'; exit 1 }
  }
  'psql' { docker compose exec db psql -U academy -d academy }
  'logs' { docker compose logs -f server }
  default { docker compose exec -T server node src/cli.js @args }
}
