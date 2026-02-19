param(
    [string]$ProjectDir = $env:TAXES_PROJECT,
    [ValidateSet("x64","x86","")][string]$Arch = ""
);
if (-not $ProjectDir) { $ProjectDir = "C:\taxes-sender" }
$ErrorActionPreference = "Stop";
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;

if ($Arch -eq "") {
    $p = [System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE", "Machine");
    if ($p -eq "AMD64") { $Arch = "x64" } else { $Arch = "x86" }
}

$zip = Join-Path $env:TEMP "nssm.zip";
$tmp = Join-Path $env:TEMP "nssm-temp";
$dest = Join-Path $ProjectDir "install\windows\nssm";
New-Item -ItemType Directory -Path $dest -Force | Out-Null;

$urls = @(
    "https://nssm.cc/release/nssm-2.24.zip",
    "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip"
);

$logFile = Join-Path $ProjectDir "install\windows\download-nssm.log";
$done = $false;
$lastErr = "";

foreach ($url in $urls) {
    try {
        Remove-Item $zip -Force -ErrorAction SilentlyContinue;
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue;
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 30;
        Expand-Archive -Path $zip -DestinationPath $tmp -Force;
        $all = Get-ChildItem -Path $tmp -Recurse -Filter "nssm.exe";
        $nssmExe = $all | Where-Object { $_.FullName -like "*\win$Arch\nssm.exe" } | Select-Object -First 1;
        if (-not $nssmExe) { $nssmExe = $all | Select-Object -First 1 }
        if ($nssmExe) {
            Copy-Item -Path $nssmExe.FullName -Destination (Join-Path $dest "nssm.exe") -Force;
            $done = $true;
            break;
        }
    } catch {
        $lastErr = $_.Exception.Message;
    }
}

Remove-Item $zip -Force -ErrorAction SilentlyContinue;
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue;

if (-not $done) {
    Set-Content -Path $logFile -Value ("NSSM download failed. Last error: " + $lastErr) -Encoding UTF8 -ErrorAction SilentlyContinue;
    exit 1;
}
Remove-Item $logFile -Force -ErrorAction SilentlyContinue;
