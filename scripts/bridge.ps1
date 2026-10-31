#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SceneJson,
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [switch]$Inspect
)
$ErrorActionPreference = 'Stop'
$openProcess = Get-Process -Name Illustrator -ErrorAction SilentlyContinue
if (-not $openProcess) { throw 'Open Illustrator and the intended document before using the desktop bridge.' }
$runtime = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'native-runtime.jsx')).Path
if (-not $Inspect -and -not $SceneJson) { throw 'SceneJson is required for drawing.' }
$configuration = @{ operation = $(if ($Inspect) {'inspect'} else {'draw'}) }
if ($SceneJson) { $configuration.scenePath = (Resolve-Path -LiteralPath $SceneJson).Path }
$configJson = $configuration | ConvertTo-Json -Compress
$runtimeJson = ConvertTo-Json -InputObject ($runtime -replace '\\','/') -Compress
$bootstrap = "var NATIVE_REBUILD_CONFIG = $configJson; `$`.evalFile(new File($runtimeJson));"
$illustrator = $null
try {
    # GetActiveObject attaches to an existing COM instance and never starts Illustrator.
    foreach ($progId in @('Illustrator.Application', 'Illustrator.Application.30')) {
        try { $illustrator = [Runtime.InteropServices.Marshal]::GetActiveObject($progId); break } catch { }
    }
    if ($null -eq $illustrator) { throw 'Illustrator is running but its COM instance is unavailable. No new instance was started.' }
    $result = [string]$illustrator.DoJavaScript($bootstrap)
    $parsed = $result | ConvertFrom-Json
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath), $result, (New-Object Text.UTF8Encoding($false)))
    if (-not $parsed.ok) { throw "Illustrator: $($parsed.error) Report: $ReportPath" }
    Write-Output $result
} finally {
    if ($null -ne $illustrator) { [Runtime.InteropServices.Marshal]::ReleaseComObject($illustrator) | Out-Null }
}
