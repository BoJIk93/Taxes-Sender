# Creates logs folder and service-err.log / service-out.log with initial line.
# Usage: run from HTA with env TAXES_PROJECT set, or: .\ensure-service-logs.ps1 -ProjectDir "C:\taxes-sender"
param([string]$ProjectDir = $env:TAXES_PROJECT);
if (-not $ProjectDir) { $ProjectDir = "C:\taxes-sender" }
$logDir = Join-Path $ProjectDir "logs";
$errLog = Join-Path $logDir "service-err.log";
$outLog = Join-Path $logDir "service-out.log";
$line = "[ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ] Log created. Service output will appear here.";
New-Item -ItemType Directory -Path $logDir -Force | Out-Null;
if (-not (Test-Path $errLog) -or (Get-Item $errLog -ErrorAction SilentlyContinue).Length -eq 0) {
    Set-Content -Path $errLog -Value $line -Encoding UTF8;
}
if (-not (Test-Path $outLog) -or (Get-Item $outLog -ErrorAction SilentlyContinue).Length -eq 0) {
    Set-Content -Path $outLog -Value $line -Encoding UTF8;
}
