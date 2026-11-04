# WeiDu local launcher. Double-click start.bat, or run: powershell -ExecutionPolicy Bypass -File start.ps1
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js LTS is not installed, so WeiDu cannot start."
  Write-Host "Install Node.js LTS (20.9 or newer; 22, 24, or 26) from https://nodejs.org/"
  Write-Host "Then double-click start.bat again."
  exit 1
}

& node "scripts/check-node.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "npm was not found. Reinstall Node.js LTS from https://nodejs.org/ so npm is included."
  exit 1
}

if (-not (Test-Path -LiteralPath ".env")) {
  if (-not (Test-Path -LiteralPath ".env.example")) {
    Write-Host ".env is missing and .env.example is not in this folder, so WeiDu cannot create one."
    exit 1
  }
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env from .env.example."
  Write-Host "Empty OPENAI_BASE_URL and OPENAI_API_KEY are fine. The page will ask you to configure an API."
  Write-Host "No login on this machine. Set WEIDU_AUTH=on in .env only if you want APP_PASSWORD."
}

$needInstall = -not (Test-Path -LiteralPath "node_modules\next\package.json")
$lockPath = "package-lock.json"
$stampPath = "node_modules\.package-lock.json"
if ((Test-Path -LiteralPath $lockPath) -and -not $needInstall) {
  if (-not (Test-Path -LiteralPath $stampPath)) {
    $needInstall = $true
  } else {
    $lockTime = (Get-Item -LiteralPath $lockPath).LastWriteTimeUtc
    $stampTime = (Get-Item -LiteralPath $stampPath).LastWriteTimeUtc
    if ($lockTime -gt $stampTime) { $needInstall = $true }
  }
}
if ($needInstall) {
  Write-Host "Installing dependencies (npm install)..."
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed. Fix the error above, then run start.bat again."
    exit 1
  }
}

$url = (& node --input-type=module -e "import { readListenTarget } from './scripts/listen.mjs'; const t = readListenTarget(process.cwd()); process.stdout.write(t.url);").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($url)) {
  Write-Host "Could not decide the local URL. Check WEIDU_HOST and PORT in .env."
  exit 1
}

Write-Host "Starting WeiDu at $url"
Write-Host "Leave this window open. Close it, or press Ctrl+C, to stop WeiDu."

if ($env:WEIDU_NO_BROWSER -ne "1") {
  Start-Job -ScriptBlock {
    param($Target)
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
      try {
        $uri = [Uri]$Target
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect($uri.Host, $uri.Port)
        $client.Close()
        Start-Process $Target
        return
      } catch {
        Start-Sleep -Seconds 1
      }
    }
  } -ArgumentList $url | Out-Null
}

& npm run dev
if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
