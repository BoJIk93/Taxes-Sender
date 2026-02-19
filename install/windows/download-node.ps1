param([ValidateSet("x64","x86","arm64","")][string]$Arch = "");
$ErrorActionPreference = "Stop";
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
$nodeVer = "v20.11.0";
if ($Arch -eq "") { $p = [System.Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE", "Machine"); if ($p -eq "AMD64") { $Arch = "x64" } elseif ($p -eq "ARM64") { $Arch = "arm64" } else { $Arch = "x86" } };
$url = "https://nodejs.org/dist/" + $nodeVer + "/node-" + $nodeVer + "-win-" + $Arch + ".zip";
$zip = Join-Path $env:TEMP "node.zip";
$tmp = Join-Path $env:TEMP "node-temp";
$dest = Join-Path $env:TAXES_PROJECT "node";
New-Item -ItemType Directory -Path $dest -Force | Out-Null;
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing;
Expand-Archive -Path $zip -DestinationPath $tmp -Force;
Copy-Item -Path (Join-Path $tmp ("node-" + $nodeVer + "-win-" + $Arch + "\*")) -Destination $dest -Recurse -Force;
Remove-Item $zip -Force -ErrorAction SilentlyContinue;
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue