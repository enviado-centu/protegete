<#
  phone.ps1 — build the PWA, serve it, and expose it to a phone over HTTPS
  via a cloudflared quick tunnel, for a live demo.

  Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File scripts\phone.ps1

  Requires cloudflared installed at the path below (the free "quick tunnel"
  mode needs no Cloudflare account or config file).
#>

$ErrorActionPreference = 'Stop'

# Resolve the frontend/ root relative to this script's own location, so the
# script works no matter which directory it's invoked from.
$frontendRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $frontendRoot

Write-Host "==> Building the PWA (npm run build)..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
}

# Start `vite preview` in the background so this script can also run the
# tunnel in the foreground (cloudflared prints the public URL to stderr and
# we want that visible live, not buried behind a blocking preview process).
Write-Host "==> Starting 'vite preview' on port 4173 (background job)..." -ForegroundColor Cyan
$previewJob = Start-Job -ScriptBlock {
    param($cwd)
    Set-Location $cwd
    npx vite preview --port 4173
} -ArgumentList $frontendRoot.Path

# Give the preview server a moment to come up before pointing the tunnel at it.
Start-Sleep -Seconds 3

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
    Stop-Job $previewJob -ErrorAction SilentlyContinue
    Remove-Job $previewJob -ErrorAction SilentlyContinue
    throw "cloudflared.exe not found at $cloudflared"
}

try {
    Write-Host "==> Starting cloudflared tunnel -> http://localhost:4173" -ForegroundColor Cyan
    Write-Host "    Watch below for the printed https://*.trycloudflare.com URL." -ForegroundColor Yellow
    # Run in the foreground so cloudflared's own stdout/stderr (which is
    # where the public URL is printed) is fully visible in this terminal.
    & $cloudflared tunnel --url http://localhost:4173
}
finally {
    # Always clean up the background preview server, whether the tunnel
    # exited normally, errored, or was interrupted with Ctrl+C.
    Write-Host "==> Stopping 'vite preview'..." -ForegroundColor Cyan
    Stop-Job $previewJob -ErrorAction SilentlyContinue
    Receive-Job $previewJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job $previewJob -ErrorAction SilentlyContinue
}
