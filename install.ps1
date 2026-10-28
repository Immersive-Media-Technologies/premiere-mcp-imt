# Premiere-MCP-IMT - install on Windows (PowerShell 5.1+).
#   .\install.ps1              check -> build -> Premiere connector (asks) -> live self-test -> client configs (asks)
#   .\install.ps1 -Yes         same, without questions
#   .\install.ps1 -NoConfig    check, build, connector and self-test only; print the config instead
# If scripts are blocked: powershell -ExecutionPolicy Bypass -File .\install.ps1
# The Premiere side is a CEP extension (MCPBridgeCEP) copied into %APPDATA%\Adobe\CEP\extensions;
# unsigned CEP extensions are enabled through PlayerDebugMode (HKCU). scripts\uninstall-cep.ps1 removes it.
param([switch]$Yes, [switch]$NoConfig)
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Fail = $false
function Ok($m)   { Write-Host "  ok   $m" -ForegroundColor Green }
function Warn($m) { Write-Host " warn  $m" -ForegroundColor Yellow }
function Bad($m)  { Write-Host " FAIL  $m" -ForegroundColor Red; $script:Fail = $true }
function Ask($q)  { if ($Yes) { return $true }; $r = Read-Host "$q [y/N]"; return ($r -eq 'y' -or $r -eq 'Y') }
function Cep($diag) {
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$Here\scripts\install-cep.ps1")
  if ($diag) { $a += '-Diagnose' }
  & powershell.exe @a *> $null
  return ($LASTEXITCODE -eq 0)
}

Write-Host "`nPremiere-MCP-IMT - environment check`n-----------------------------------------------"
$PrExe = $null
foreach ($y in 2026, 2025, 2024) {
  $c = "$env:ProgramFiles\Adobe\Adobe Premiere Pro $y\Adobe Premiere Pro.exe"
  if (Test-Path $c) { $PrExe = $c; break }
}
if ($PrExe) { Ok "Premiere Pro: $PrExe" } else { Bad "Premiere Pro 2024-2026 not found under $env:ProgramFiles\Adobe" }

$NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($NodeBin) {
  # Compared in PowerShell: Windows PowerShell 5.1 strips the double quotes of a `node -e` script.
  $nodeVersion = [version]((& $NodeBin -v).Trim().TrimStart('v'))
  if ($nodeVersion -ge [version]'20.19.0') { Ok "Node v$nodeVersion - $NodeBin" } else { Bad "Node.js >= 20.19 required (found v$nodeVersion)" }
} else { Bad "Node.js >= 20.19 not found - install from https://nodejs.org or use the Claude Desktop extension (.mcpb), which needs no Node" }
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Ok 'ffmpeg found (audio/video analysis operations)' }
else { Warn 'ffmpeg not found - analysis operations (loudness, silence, beats, scene changes) need it: winget install Gyan.FFmpeg' }
if ($Fail) { Write-Host "`nStopped." -ForegroundColor Red; exit 1 }

Write-Host "`nBuild`n-----------------------------------------------"
Set-Location $Here
if (Test-Path 'package-lock.json') { npm ci --no-audit --no-fund 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { npm install --no-audit --no-fund 2>&1 | Out-Null } }
else { npm install --no-audit --no-fund 2>&1 | Out-Null }
if (Test-Path 'node_modules') { Ok 'dependencies installed' } else { Bad 'npm install failed'; exit 1 }
npm run build 2>&1 | Out-Null
if (Test-Path 'dist\index.js') { Ok 'server built: dist\index.js' } else { Bad 'build produced no dist\index.js (run npm run build to see why)'; exit 1 }

Write-Host "`nPremiere connector`n-----------------------------------------------"
$JustInstalled = $false
if (Cep $true) { Ok 'connector installed and unsigned CEP extensions enabled' }
else {
  Warn 'connector missing or CEP debug mode off'
  if (Ask 'Install the Premiere connector (copy MCPBridgeCEP into your CEP extensions folder, enable PlayerDebugMode)?') {
    if (Cep $false) { Ok 'connector installed'; $JustInstalled = $true }
    else { Bad 'connector install failed - run: powershell -ExecutionPolicy Bypass -File scripts\install-cep.ps1' }
  } else { Warn 'skipped - the agent can install it later (pr_install_connector)' }
}

Write-Host "`nLive check against Premiere Pro`n-----------------------------------------------"
if (-not (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue)) {
  Warn 'Premiere Pro is not running - skipping the live check (open it with a project and run .\install.ps1 again)'
} elseif ($JustInstalled) {
  Warn 'the connector was just installed - quit Premiere Pro completely, reopen it, then run .\install.ps1 again'
} else {
  $out = & $NodeBin "$Here\tools\selftest.mjs" 2>$null | Out-String
  if ($out -match '"ok":\s*true') {
    $p = [regex]::Match($out, '"project":\s*"([^"]*)"').Groups[1].Value
    $s = [regex]::Match($out, '"sequence":\s*"([^"]*)"').Groups[1].Value
    Ok "Premiere answers - project: $p, sequence: $s"
  } else {
    Bad 'Premiere did not answer (close any open dialog; quit and reopen Premiere after installing the connector)'
    Write-Host $out
  }
}

$entry = "$Here\dist\index.js"
$serverJson = @"
{
      "command": "$($NodeBin -replace '\\', '\\')",
      "args": ["$($entry -replace '\\', '\\')"]
    }
"@
Write-Host "`nConnect`n-----------------------------------------------"
function Write-ClientConfig($file, $label) {
  if (-not (Ask "Add the server to $label ($file)?")) { return }
  $dir = Split-Path -Parent $file
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (Test-Path $file) { Copy-Item $file "$file.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
  $js = @'
const fs = require('fs'); const [file, node, entry] = process.argv.slice(2);
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.premiere = { command: node, args: [entry] };
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
'@
  $tmp = Join-Path $env:TEMP 'prmcp-write-config.js'
  Set-Content -Path $tmp -Value $js -Encoding UTF8
  & $NodeBin $tmp $file $NodeBin $entry
  Ok "$label`: mcpServers.premiere written (restart $label)"
}
if ($NoConfig) {
  Write-Host "Add to your client's MCP config:`n`n  `"mcpServers`": { `"premiere`": $serverJson }`n"
} else {
  Write-ClientConfig "$env:APPDATA\Claude\claude_desktop_config.json" 'Claude Desktop'
  Write-ClientConfig "$env:USERPROFILE\.cursor\mcp.json" 'Cursor'
  Write-ClientConfig "$env:USERPROFILE\.gemini\config\mcp_config.json" 'Google Antigravity'
  Write-Host ""
  Write-Host "Other clients: `"mcpServers`": { `"premiere`": $serverJson }"
}
Write-Host "`nFirst session on a new machine: add `"env`": { `"PR_MCP_READONLY`": `"1`" } and work on a COPY of the"
Write-Host "project - the server edits the open project and Premiere has no scripted undo.`n"
